import type { OwnedCoverage } from "@/lib/coverage/facts";

export type PolicyVersionReasonCode = "DUPLICATE_POLICY_OR_VERSION" | "AMBIGUOUS_POLICY_VERSION" | "POLICY_NOT_IN_FORCE_AT_EVENT";

export type PolicyVersionDecision =
  | { status: "in_force"; policyId: string }
  | { status: "not_in_force"; policyId: string; reasonCode: "POLICY_NOT_IN_FORCE_AT_EVENT" }
  | { status: "ambiguous"; policyIds: string[]; reasonCode: "DUPLICATE_POLICY_OR_VERSION" | "AMBIGUOUS_POLICY_VERSION" };

function parseDate(value: string | null) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/** Whether a policy's own stated effective/expiry window covers the given
 * event date. A policy with no effective date on file is treated as
 * "unknown, not excluded" (never silently treated as always-in-force AND
 * never silently excluded) -- callers decide what to do with `"unknown"`;
 * V1 keeps such a policy in the candidate set rather than blocking it,
 * since the monetary gate (lib/claims/monetary-gate.ts) already requires a
 * confirmed event date before any amount is shown, and death-benefit
 * calculators already separately reject a death date before their own
 * cover's effective date. */
function coversEventDate(coverage: OwnedCoverage, eventDate: string | null): "in_force" | "not_in_force" | "unknown" {
  const event = parseDate(eventDate);
  if (event == null) return "unknown";
  const effective = parseDate(coverage.effectiveDate);
  const expiry = parseDate(coverage.renewalOrExpiryDate);
  if (effective != null && event < effective) return "not_in_force";
  if (expiry != null && event > expiry) return "not_in_force";
  if (effective == null && expiry == null) return "unknown";
  return "in_force";
}

/** A single (unclustered, or alone in its identity cluster) coverage still
 * has its OWN effective/expiry window checked against the event date --
 * point-in-time validity applies to every policy, not only to disambiguating
 * between duplicates/versions that share an identity. */
function ownWindowDecision(coverage: OwnedCoverage): PolicyVersionDecision {
  return { status: "in_force", policyId: coverage.policyId };
}

function decisionForLoneCoverage(coverage: OwnedCoverage, eventDate: string | null): PolicyVersionDecision {
  const window = coversEventDate(coverage, eventDate);
  if (window === "not_in_force") return { status: "not_in_force", policyId: coverage.policyId, reasonCode: "POLICY_NOT_IN_FORCE_AT_EVENT" };
  return ownWindowDecision(coverage);
}

function identityKey(coverage: OwnedCoverage) {
  const insurer = (coverage.insurer ?? "").trim().toLowerCase();
  const policyNumber = (coverage.policyNumber ?? "").trim().toUpperCase();
  if (!insurer || !policyNumber) return null; // no persistent identifier -- cannot be clustered, see module doc
  return `${insurer}::${policyNumber}`;
}

/**
 * Groups the account's owned policies (by insurer + policy number -- the
 * only persistent cross-document identifiers this schema carries; a group
 * policy number is deliberately NOT used here because many different
 * people's individual certificates share one group policy number, which
 * would falsely cluster unrelated people's cover) into "same underlying
 * contract" clusters, then decides which member of each cluster (if any) is
 * the version in force on the claim-event date.
 *
 * This is the point-in-time-validity and duplicate/version-handling
 * building block the composition engine uses before it will ever add two
 * policies together: two policies clustered here are versions of the same
 * contract (a renewal, a reissued schedule, a duplicate upload), never two
 * independent policies, however different their wording extraction turned
 * out. A policy with no persistent identifier on file (no policy number
 * captured) is never clustered with anything -- it is treated as
 * independent, which is the conservative default (a false negative here
 * only means DearPolicy fails to catch a duplicate it can't prove, never
 * that it silently drops or merges two policies it has no basis to link).
 *
 * Point-in-time validity applies to EVERY policy, not only ones sharing an
 * identity cluster: a single, unclustered policy (or the sole member of an
 * identity cluster) still has its own effective/expiry window checked
 * against the claim-event date via decisionForLoneCoverage() below -- a
 * policy whose own dates already exclude the event is never silently
 * treated as in force just because there was nothing to disambiguate it
 * from.
 */
export function resolvePolicyVersions(coverages: OwnedCoverage[], eventDate: string | null): Map<string, PolicyVersionDecision> {
  const byIdentity = new Map<string, OwnedCoverage[]>();
  const unclustered: OwnedCoverage[] = [];
  const seenPolicyIds = new Set<string>();
  for (const coverage of coverages) {
    if (seenPolicyIds.has(coverage.policyId)) continue;
    seenPolicyIds.add(coverage.policyId);
    const key = identityKey(coverage);
    if (key == null) { unclustered.push(coverage); continue; }
    byIdentity.set(key, [...(byIdentity.get(key) ?? []), coverage]);
  }

  const decisions = new Map<string, PolicyVersionDecision>();
  for (const coverage of unclustered) decisions.set(coverage.policyId, decisionForLoneCoverage(coverage, eventDate));

  for (const cluster of byIdentity.values()) {
    if (cluster.length === 1) { decisions.set(cluster[0].policyId, decisionForLoneCoverage(cluster[0], eventDate)); continue; }
    const withKnownWindow = cluster.filter((c) => coversEventDate(c, eventDate) !== "unknown");
    const inForce = withKnownWindow.filter((c) => coversEventDate(c, eventDate) === "in_force");
    const notInForce = withKnownWindow.filter((c) => coversEventDate(c, eventDate) === "not_in_force");
    for (const c of notInForce) decisions.set(c.policyId, { status: "not_in_force", policyId: c.policyId, reasonCode: "POLICY_NOT_IN_FORCE_AT_EVENT" });

    if (inForce.length === 1) {
      decisions.set(inForce[0].policyId, { status: "in_force", policyId: inForce[0].policyId });
      continue;
    }
    // Either 0 policies in this cluster have a known window (every upload's
    // effective/expiry date is missing -- a genuine duplicate upload with
    // no way to tell which is current), or 2+ overlap the event date (a
    // true version conflict, e.g. two "current" schedules for one
    // contract). Both are ambiguous: never guess which is the applicable
    // version by insurer/wording similarity, the same rule death-evidence's
    // resolveDeathEvidence() now enforces for wording-document selection.
    const ambiguousMembers = inForce.length > 1 ? inForce : cluster.filter((c) => coversEventDate(c, eventDate) === "unknown");
    const reasonCode: PolicyVersionReasonCode = inForce.length > 1 ? "AMBIGUOUS_POLICY_VERSION" : "DUPLICATE_POLICY_OR_VERSION";
    const ids = ambiguousMembers.map((c) => c.policyId);
    for (const c of ambiguousMembers) decisions.set(c.policyId, { status: "ambiguous", policyIds: ids, reasonCode });
  }
  return decisions;
}
