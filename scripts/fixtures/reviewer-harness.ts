/**
 * Shared PGlite harness for the reviewer-decision suites: a disposable
 * database with lib/db/client's pool routed through it, real route
 * handlers, and helpers that create households, policies with real
 * wording pages, and claim evidence that goes through the real upload
 * route, the malware-scan transition, a real structuredCompletion()
 * extraction (provider simulated at global.fetch only, so model-execution
 * provenance is produced by the production boundary) and the review
 * transitions. Reviewers and assignments are created only through the
 * operator module, exactly as in production.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { NextRequest } from "next/server";
import { pool } from "@/lib/db/client";
import { setTelemetryAdapter } from "@/lib/telemetry";
import { NoopTelemetryAdapter } from "@/lib/telemetry/adapters";
import { ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/auth/request-context";
import { EMPTY_CLAIM_FACTS, type ClaimFacts } from "@/lib/claims/types";
import { confirmedOwnedCoverages } from "@/lib/coverage/facts";
import { loadDeathEvidence } from "@/lib/claims/death-evidence";
import { loadCIEvidence } from "@/lib/claims/ci-evidence";
import { loadDisabilityEvidence } from "@/lib/claims/disability-evidence";
import { loadTravelEvidence } from "@/lib/claims/travel-evidence";
import { loadCauseDefinitionMatchesForFacts } from "@/lib/claims/evidence/session-matches";
import { loadCIDefinitionMatchesForFacts } from "@/lib/claims/evidence/ci-session-matches";
import { loadDisabilityDefinitionMatchesForFacts } from "@/lib/claims/evidence/disability-session-matches";
import { assessClaim } from "@/lib/claims/rules";
import { enforceMonetarySafety } from "@/lib/claims/monetary-gate";
import { composeClaim } from "@/lib/claims/composition/engine";

const SQL_FILES = ["sql/schema.sql", "sql/claim-evidence.sql", "sql/household-rls.sql", "sql/background-jobs.sql", "sql/lifecycle.sql", "sql/model-provenance.sql"];
export const DEFINITION_ROUTES = ["match", "ci-match", "disability-match", "travel-match"] as const;
export type DefinitionRoute = (typeof DEFINITION_ROUTES)[number];
export const RESOLVED_MODEL = "claude-haiku-4-5-20250620";

export function asUser(userId: string) { process.env.DEV_AUTH_ENABLED = "1"; process.env.DEV_ACCOUNT_ID = userId; }
export const fixedUuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export async function startReviewerHarness() {
  setTelemetryAdapter(new NoopTelemetryAdapter());
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.READING_MODEL = "anthropic:claude-haiku-4-5";
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of SQL_FILES) await db.exec(await readFile(path.resolve(file), "utf8"));
  let tail = Promise.resolve();
  const acquire = async () => { const previous = tail; let release!: () => void; tail = new Promise<void>((r) => { release = r; }); await previous; return release; };
  const execute = async (text: string, params: unknown[] = []) => {
    if (params.length === 0) {
      const results = await db.exec(text); const last = results[results.length - 1];
      return { rows: last?.rows ?? [], rowCount: (last as { affectedRows?: number } | undefined)?.affectedRows ?? last?.rows?.length ?? 0 };
    }
    const result = await db.query(text, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };
  const originalQuery = pool.query, originalConnect = pool.connect, originalFetch = global.fetch;
  pool.query = (async (text: string, params: unknown[] = []) => { const release = await acquire(); try { return await execute(text, params); } finally { release(); } }) as typeof pool.query;
  pool.connect = (async () => { const release = await acquire(); return { query: execute, release }; }) as typeof pool.connect;

  const { ensureCriticalIllnessSchema } = await import("@/lib/claims/evidence/ci-schema");
  const { ensureDisabilitySchema } = await import("@/lib/claims/evidence/disability-schema");
  const { ensureClaimReviewerSchema } = await import("@/lib/claims/reviewers/schema");
  await ensureCriticalIllnessSchema();
  await ensureDisabilitySchema();
  await db.exec(await readFile(path.resolve("sql/lifecycle.sql"), "utf8"));
  await ensureClaimReviewerSchema();
  // Re-apply the household policies now that every decision table exists,
  // exactly as production applies sql/household-rls.sql last (after the
  // broad test grant, so its narrowing is what is actually in force).
  await db.exec("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;");
  await db.exec(await readFile(path.resolve("sql/household-rls.sql"), "utf8"));

  const admin = await import("@/lib/claims/reviewers/admin");
  const { POST: postUpload } = await import("@/app/api/claims/evidence/upload/route");
  const { GET: listEvidence } = await import("@/app/api/claims/evidence/route");
  const { GET: getAssignment } = await import("@/app/api/reviewer/assignments/[id]/route");
  const { GET: getDocument } = await import("@/app/api/reviewer/assignments/[id]/documents/[documentId]/route");
  const routes: Record<DefinitionRoute, (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>> = {
    match: (await import("@/app/api/claims/evidence/[id]/match/route")).POST,
    "ci-match": (await import("@/app/api/claims/evidence/[id]/ci-match/route")).POST,
    "disability-match": (await import("@/app/api/claims/evidence/[id]/disability-match/route")).POST,
    "travel-match": (await import("@/app/api/claims/evidence/[id]/travel-match/route")).POST,
  };
  const { transitionEvidenceStatus, recordExtraction } = await import("@/lib/claims/evidence/store");
  const { extractClaimEvidence } = await import("@/lib/claims/evidence/extract");

  async function createHousehold(id: string, ownerUserId: string, name = "Household") {
    await pool.query(`INSERT INTO accounts(id,name) VALUES($1,$2)`, [id, name]);
    await pool.query(`INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner')`, [id, ownerUserId]);
    return id;
  }
  async function createMember(accountId: string, id: string, displayName: string, relationship = "self") {
    await pool.query(`INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,$3,$3,$4)`, [id, accountId, displayName, relationship]);
    return id;
  }
  async function createClaim(accountId: string, memberId: string, id: string, eventType: string) {
    await pool.query(`INSERT INTO claim_sessions(id,account_id,family_member_id,status,event_type) VALUES($1,$2,$3,'fact_finding',$4)`, [id, accountId, memberId, eventType]);
    return id;
  }
  /** A confirmed personal policy (own document tier) with real wording
   * pages, linked to the member, and one confirmed, evidence-verified
   * coverage row. */
  async function createPolicy(args: {
    accountId: string; memberId: string; policyId: string; coverageId: string; insurer: string; productName: string;
    groupPolicyNumber?: string | null; policyNumber?: string | null; category: string; amount: number | null; currency: string; pages: { pageNumber: number; text: string }[];
    effectiveDate?: string;
    /** Defaults model a complete personal certificate: the coverage row
     * states its currency on page 1 of a known document version. */
    coverageCurrency?: string | null; sourcePage?: number | null; fileHash?: string | null;
    /** The certificate line DearPolicy read for this cover. Defaults to one
     * that writes the cover's currency and amount, as a real schedule does;
     * pass null (or a line without a currency) to model a certificate that
     * states no currency. A stored currency alone never verifies it. */
    coverageEvidenceText?: string | null;
  }) {
    await pool.query(
      `INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,group_policy_number,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,document_authority,effective_date,file_hash,quarantine_status,policy_number)
       VALUES($1,$2,$3,$4,$5,$6,'certificate',true,'ready',$7,'k',90,$8,$9,'scan_clean',$10)`,
      [args.policyId, args.accountId, args.memberId, args.insurer, args.productName, args.groupPolicyNumber ?? null, `${args.productName}.pdf`, args.effectiveDate ?? "2020-01-01",
        args.fileHash === undefined ? `sha256:policy-${args.policyId}` : args.fileHash, args.policyNumber ?? null]);
    for (const p of args.pages) await pool.query(`INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)`, [args.accountId, args.policyId, p.pageNumber, p.text]);
    await pool.query(`INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'upload')`, [args.policyId, args.memberId, args.accountId]);
    const coverageCurrency = args.coverageCurrency === undefined ? args.currency : args.coverageCurrency;
    const evidenceText = args.coverageEvidenceText !== undefined ? args.coverageEvidenceText
      : coverageCurrency ? `${args.productName} sum insured: ${coverageCurrency} ${args.amount == null ? "as scheduled" : args.amount.toLocaleString("en-US")}` : null;
    await pool.query(`INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,confirmed,evidence_verified,product_name,source_page,evidence_text)
       VALUES($1,$2,$3,$4,$5,$6,$7,true,true,$8,$9,$10)`, [args.coverageId, args.accountId, args.policyId, args.memberId, args.category, args.amount,
        coverageCurrency, args.productName, args.sourcePage === undefined ? 1 : args.sourcePage, evidenceText]);
    return { policyId: args.policyId, coverageId: args.coverageId };
  }

  let seq = 0;
  /** Real upload route -> clean scan -> processing -> real extraction with
   * provider-reported model -> needs_review (identity confirmed). */
  async function uploadEvidence(args: {
    accountId: string; ownerUserId: string; memberId: string; claimId: string; documentType: string;
    payload: Record<string, unknown>; pages: { pageNumber: number; text: string }[]; withProvenance?: boolean;
  }) {
    seq++;
    asUser(args.ownerUserId);
    const form = new FormData();
    form.set("file", new File([new Uint8Array(Buffer.from(`%PDF-1.4\n%harness-${seq}\n%%EOF\n`, "latin1"))], `evidence-${seq}.pdf`, { type: "application/pdf" }));
    form.set("familyMemberId", args.memberId); form.set("claimSessionId", args.claimId); form.set("documentType", args.documentType);
    const res = await postUpload(new NextRequest("http://localhost/api/claims/evidence/upload", { method: "POST", headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${args.accountId}` }, body: form }));
    assert.equal(res.status, 202, await res.clone().text());
    const id = (await res.json()).documentId as string;
    assert.ok(await transitionEvidenceStatus({ accountId: args.accountId, id, from: "uploaded", to: "quarantined", scanStatus: "clean" }));
    assert.ok(await transitionEvidenceStatus({ accountId: args.accountId, id, from: "quarantined", to: "processing" }));
    const hash = (await pool.query<{ file_hash: string }>(`SELECT file_hash FROM claim_evidence_documents WHERE id=$1`, [id])).rows[0].file_hash;
    global.fetch = (async () => new Response(JSON.stringify({
      id: `msg_${id}`, model: RESOLVED_MODEL,
      content: [{ type: "text", text: JSON.stringify(args.payload) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 },
    }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    const extraction = await extractClaimEvidence({ pages: args.pages, documentType: args.documentType as never, documentId: id });
    await recordExtraction({
      accountId: args.accountId, evidenceDocumentId: id, sourceDocumentVersion: hash, extractedFields: extraction.fields,
      extractionModel: extraction.model, extractionProvider: extraction.provider, extractionVersion: extraction.version, identityConflicts: [],
      modelExecution: args.withProvenance === false ? null : extraction.execution,
    });
    assert.ok(await transitionEvidenceStatus({ accountId: args.accountId, id, from: "processing", to: "extracted", identityStatus: "confirmed" }));
    assert.ok(await transitionEvidenceStatus({ accountId: args.accountId, id, from: "extracted", to: "needs_review" }));
    return id;
  }

  async function decide(route: DefinitionRoute, reviewerUserId: string, documentId: string, body: Record<string, unknown>) {
    asUser(reviewerUserId);
    return routes[route](new NextRequest(`http://localhost/api/claims/evidence/${documentId}/${route}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: documentId }) });
  }
  async function workspace(reviewerUserId: string, assignmentId: string) {
    asUser(reviewerUserId);
    return getAssignment(new NextRequest(`http://localhost/api/reviewer/assignments/${assignmentId}`), { params: Promise.resolve({ id: assignmentId }) });
  }
  async function download(reviewerUserId: string, assignmentId: string, documentId: string) {
    asUser(reviewerUserId);
    return getDocument(new NextRequest(`http://localhost/api/reviewer/assignments/${assignmentId}/documents/${documentId}`), { params: Promise.resolve({ id: assignmentId, documentId }) });
  }
  async function householdStatuses(accountId: string, ownerUserId: string, memberId: string, claimId: string) {
    asUser(ownerUserId);
    const res = await listEvidence(new NextRequest(`http://localhost/api/claims/evidence?familyMemberId=${memberId}&claimSessionId=${claimId}`, { headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${accountId}` } }));
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes("reviewer:") && !text.includes("operator:"), "the household never sees reviewer or operator identity");
    return Object.fromEntries((JSON.parse(text).documents as { id: string; reviewStatus: string | null }[]).map((d) => [d.id, d.reviewStatus]));
  }

  /** The orchestrator's own assessment pipeline for one claim, run from the
   * database with the same production functions and in the same order as
   * lib/claims/orchestrator.ts's handleClaimTurn() (decisions reloaded
   * from their tables -> wording loaders -> assessClaim() ->
   * enforceMonetarySafety() -> composeClaim()), minus the chat-text fact
   * extraction, whose facts are passed in directly. */
  async function assess(accountId: string, memberId: string, claimId: string, factsIn: Partial<ClaimFacts>) {
    const facts: ClaimFacts = { ...EMPTY_CLAIM_FACTS, ...factsIn };
    const coverages = await confirmedOwnedCoverages(accountId, memberId);
    if (facts.eventType === "death") facts.causeDefinitionMatches = await loadCauseDefinitionMatchesForFacts(accountId, memberId, claimId);
    if (facts.eventType === "diagnosis") facts.ciDefinitionMatches = await loadCIDefinitionMatchesForFacts(accountId, memberId, claimId);
    if (facts.eventType === "disability") facts.disabilityDefinitionMatches = await loadDisabilityDefinitionMatchesForFacts(accountId, memberId, claimId);
    const empty = { rules: [], gaps: [], pages: [] };
    const deathEvidence = facts.eventType === "death" ? await loadDeathEvidence(accountId, memberId, coverages) : empty;
    const ciEvidence = facts.eventType === "diagnosis" ? await loadCIEvidence(accountId, memberId, coverages) : empty;
    const disabilityEvidence = facts.eventType === "disability" ? await loadDisabilityEvidence(accountId, memberId, coverages) : empty;
    const travelEvidence = facts.eventType === "death" && coverages.some((c) => c.category === "Travel") ? await loadTravelEvidence(accountId, memberId, coverages) : empty;
    const raw = facts.eventType === "death" ? assessClaim(facts, coverages, deathEvidence.rules, deathEvidence.gaps, claimId, [], [], undefined, undefined, travelEvidence)
      : facts.eventType === "diagnosis" ? assessClaim(facts, coverages, [], [], claimId, ciEvidence.rules, ciEvidence.gaps)
      : facts.eventType === "disability" ? assessClaim(facts, coverages, [], [], claimId, [], [], undefined, disabilityEvidence)
      : [];
    const assessments = enforceMonetarySafety(raw, facts, coverages, { householdId: accountId, resourceId: claimId });
    const composition = composeClaim({
      claimEventId: claimId, familyMemberId: memberId, facts, coverages, assessments, accountId,
      wordingPages: [...deathEvidence.pages, ...ciEvidence.pages, ...disabilityEvidence.pages, ...travelEvidence.pages] as { policy_id: string; page_number: number; text: string }[],
    });
    const included = composition.policies.flatMap((p) => p.benefits).filter((b) => b.status === "included");
    return { facts, assessments, composition, included };
  }

  async function close() {
    global.fetch = originalFetch;
    pool.query = originalQuery; pool.connect = originalConnect;
    await db.close();
  }

  return { db, admin, routes, assess, createHousehold, createMember, createClaim, createPolicy, uploadEvidence, decide, workspace, download, householdStatuses, close };
}

export type ReviewerHarness = Awaited<ReturnType<typeof startReviewerHarness>>;
