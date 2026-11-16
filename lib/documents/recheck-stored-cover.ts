/** Re-runs the plain-code fact check (lib/rag/ingest verifiedExtraction, which runs lib/documents/fact-check
 * checkCoverage) on a document's STORED page text and STORED reading, so a fix to the check (such as the document-level
 * currency, lib/documents/document-currency) reaches documents already read, with no model call and no re-read.
 *
 * What it may change, and nothing else:
 * - policy_coverages.confirmed and evidence_verified, which the intake always writes together as one "proven line" flag
 *   (lib/policies/linking.ts syncInsuredPersonToMember), and
 * - the same line's evidenceVerified in policies.extracted_json, which a later re-link rebuilds those rows from.
 * Never an amount, a currency, a category, a person or a page. A stored line is matched to the re-checked one by its
 * person, category, page, evidence text and amount; a line with no single match, or whose two flags disagree (set by
 * hand), is left as it is and counted.
 *
 * A line that would go from proven to unproven is reported and, unless `allowDowngrade`, left proven: what the stored
 * pages do not hold (a currency the page image printed, lib/documents/image-currency, is not stored) may have proven it
 * at intake. Dry run (the default) writes nothing and reports the same counts. Idempotent: a second run finds nothing to
 * change. Scoped to one household, and optionally one document in it. */
import { PolicyExtractionSchema, type PolicyExtraction } from "@/lib/ai/extract-policy";
import { withServiceTransaction } from "@/lib/db/authz-client";
import { normalizeCoverageCategory } from "@/lib/insurance";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { trustedPolicyStatePredicate } from "@/lib/policies/trusted";
import { verifiedExtraction } from "@/lib/rag/ingest";

export type RecheckChange = { policyId: string; coverageId: string; category: string; sourcePage: number | null; from: boolean; to: boolean; applied: boolean };
export type RecheckReport = {
  apply: boolean; documents: number; documentsSkipped: number; lines: number; unchanged: number;
  upgrades: number; downgrades: number; downgradesApplied: number; unmatched: number; changes: RecheckChange[];
};

const nameKey = (v: string) => String(v ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const amountKey = (v: unknown) => v == null || v === "" ? "" : String(Number(v));
const lineKey = (person: string, category: string, page: number | null | undefined, evidence: string | null | undefined, amount: unknown) =>
  JSON.stringify([nameKey(person), normalizeCoverageCategory(category), page ?? null, String(evidence ?? "").trim(), amountKey(amount)]);
const proven = (c: { sourcePage?: number | null; evidenceText?: string | null; evidenceVerified?: boolean | null }) => Boolean(c.sourcePage && c.evidenceText && c.evidenceVerified);

type Coverage = PolicyExtraction["insuredPeople"][number]["coverages"][number];
const coverageCategory = (c: Coverage) => c.category || c.productName || "Other";

export async function recheckStoredCover(scope: { accountId: string; policyId?: string | null }, opts: { apply?: boolean; allowDowngrade?: boolean } = {}): Promise<RecheckReport> {
  const apply = opts.apply === true;
  const report: RecheckReport = { apply, documents: 0, documentsSkipped: 0, lines: 0, unchanged: 0, upgrades: 0, downgrades: 0, downgradesApplied: 0, unmatched: 0, changes: [] };
  const ids = await withServiceTransaction(async (db) => (await db.query<{ id: string }>(
    `SELECT p.id::text FROM policies p WHERE p.account_id=$1 AND ($2::uuid IS NULL OR p.id=$2::uuid) AND ${activePredicate("p")} AND ${trustedPolicyStatePredicate("p")}
       AND p.processing_status='ready' AND p.personal_coverage_confirmed=true AND p.extracted_json IS NOT NULL ORDER BY p.created_at, p.id`,
    [scope.accountId, scope.policyId ?? null])).rows.map((r) => r.id));
  for (const policyId of ids) {
    // One transaction per document, holding its row, so a reading or re-link running at the same time is never half-overwritten.
    await withServiceTransaction(async (db) => {
      const row = (await db.query<{ extracted_json: Record<string, unknown> | null }>(
        `SELECT p.extracted_json FROM policies p WHERE p.id=$1 AND p.account_id=$2 AND ${activePredicate("p")} FOR UPDATE`, [policyId, scope.accountId])).rows[0];
      const parsed = PolicyExtractionSchema.safeParse(row?.extracted_json);
      if (!row?.extracted_json || !parsed.success || !parsed.data.personalCoverageConfirmed) { report.documentsSkipped++; return; }
      const pages = (await db.query<{ page_number: number; text: string; method: string | null }>(
        `SELECT page_number, text, to_jsonb(pp)->>'extraction_method' AS method FROM policy_pages pp WHERE pp.policy_id=$1 AND pp.account_id=$2 ORDER BY page_number`,
        [policyId, scope.accountId])).rows;
      if (!pages.length) { report.documentsSkipped++; return; }
      report.documents++;
      const all = pages.map((p) => ({ pageNumber: p.page_number, text: p.text }));
      // A page the intake could not check confirms nothing, as at intake (lib/rag/ingest.ts).
      const checked = verifiedExtraction(parsed.data, pages.filter((p) => p.method !== "unchecked").map((p) => ({ pageNumber: p.page_number, text: p.text })), { allPages: all });

      // The re-checked verdict for each stored line; a key two lines share with different verdicts gives none.
      const verdict = new Map<string, boolean | null>();
      for (const person of checked.insuredPeople) for (const c of person.coverages) {
        const k = lineKey(person.name, coverageCategory(c), c.sourcePage, c.evidenceText, c.amount), v = proven(c);
        verdict.set(k, verdict.has(k) && verdict.get(k) !== v ? null : v);
      }
      // Stored rows, through the name each person was read under on this document.
      const rows = (await db.query<{ id: string; category: string; source_page: number | null; evidence_text: string | null; amount: string | null; confirmed: boolean; evidence_verified: boolean | null; names: string[] }>(
        `SELECT pc.id::text, pc.category, pc.source_page, pc.evidence_text, pc.amount::text, pc.confirmed, pc.evidence_verified,
                ARRAY(SELECT d.detected_name FROM policy_detected_people d WHERE d.policy_id=pc.policy_id AND d.account_id=pc.account_id AND d.matched_family_member_id=pc.family_member_id) AS names
           FROM policy_coverages pc WHERE pc.policy_id=$1 AND pc.account_id=$2 AND pc.authority='personal_document' ORDER BY pc.created_at, pc.id`, [policyId, scope.accountId])).rows;
      const flips = new Map<string, boolean>();
      for (const r of rows) {
        report.lines++;
        if (r.confirmed !== (r.evidence_verified === true)) { report.unmatched++; continue; }
        const found = [...new Set(r.names.map((n) => verdict.get(lineKey(n, r.category, r.source_page, r.evidence_text, r.amount))).filter((v) => v !== undefined))];
        if (found.length !== 1 || found[0] == null) { report.unmatched++; continue; }
        const from = r.confirmed, to = found[0];
        if (from === to) { report.unchanged++; continue; }
        const applied = apply && (to || opts.allowDowngrade === true);
        if (to) report.upgrades++; else { report.downgrades++; if (applied) report.downgradesApplied++; }
        report.changes.push({ policyId, coverageId: r.id, category: r.category, sourcePage: r.source_page, from, to, applied });
        if (!applied) continue;
        await db.query(`UPDATE policy_coverages SET confirmed=$3, evidence_verified=$3 WHERE id=$1 AND account_id=$2 AND confirmed=$4 AND evidence_verified=$4`, [r.id, scope.accountId, to, from]);
        for (const n of r.names) flips.set(lineKey(n, r.category, r.source_page, r.evidence_text, r.amount), to);
      }
      if (!flips.size) return;
      // The stored reading says the same, so a re-link rebuilds the same rows. Only evidenceVerified is touched.
      const json = structuredClone(row.extracted_json) as { insuredPeople?: { name: string; coverages?: (Coverage & Record<string, unknown>)[] }[] };
      let touched = false;
      for (const person of json.insuredPeople ?? []) for (const c of person.coverages ?? []) {
        const to = flips.get(lineKey(person.name, coverageCategory(c), c.sourcePage, c.evidenceText, c.amount));
        if (to === undefined || (c.evidenceVerified === true) === to) continue;
        c.evidenceVerified = to; touched = true;
      }
      if (touched) await db.query(`UPDATE policies SET extracted_json=$3::jsonb, updated_at=now() WHERE id=$1 AND account_id=$2 AND ${activePredicate()}`, [policyId, scope.accountId, JSON.stringify(json)]);
    });
  }
  return report;
}

/** The counts a dry run or a run prints: lines that change, and in which direction. */
export function recheckSummary(r: RecheckReport): string {
  return [`${r.apply ? "Applied" : "Dry run (nothing written)"}: ${r.documents} document(s) re-checked, ${r.documentsSkipped} skipped; ${r.lines} line(s).`,
    `Unconfirmed -> confirmed: ${r.upgrades}${r.apply ? " (applied)" : ""}.`,
    `Confirmed -> unconfirmed: ${r.downgrades}${r.downgrades ? r.apply ? ` (${r.downgradesApplied} applied, ${r.downgrades - r.downgradesApplied} left confirmed; pass --allow-downgrade to apply)` : " (reported only; a run leaves them confirmed unless --allow-downgrade)" : ""}.`,
    `Unchanged: ${r.unchanged}. Not matched or set by hand (left as they are): ${r.unmatched}.`].join("\n");
}
