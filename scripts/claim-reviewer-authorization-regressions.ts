/**
 * Internal claim-reviewer authorization and workflow regressions (real
 * route handlers against PGlite).
 *
 * Proves that a policy-definition decision can be recorded only by an
 * active, provisioned DearPolicy reviewer acting inside an active,
 * unexpired, unrevoked assignment -- with household, family member, claim,
 * document, contract and coverage all resolved server-side from that
 * assignment -- and that nothing a household (or a reviewer) can send
 * creates reviewers or assignments. Also proves the household only ever
 * sees one of four review statuses, and that a reviewed match still unlocks
 * an amount only through the unchanged provenance gate.
 */
import { readFile, readdir } from "node:fs/promises";
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
import { POLICY_DEFINITION_REVIEW_REQUIRED_MESSAGE } from "@/lib/claims/evidence/document-catalogue";
import { HOUSEHOLD_REVIEW_STATUS_COPY, INDICATIVE_ESTIMATE_NOTICE } from "@/lib/claims/reviewers/copy";
import { REVIEWER_DECISION_CHOICES, buildReviewerDecisionRequest, resultForChoice } from "@/lib/claims/reviewers/decision-request";
import fixture from "./fixtures/singlife-death-wording.json";

const SQL_FILES = ["sql/schema.sql", "sql/claim-evidence.sql", "sql/household-rls.sql", "sql/background-jobs.sql", "sql/lifecycle.sql", "sql/model-provenance.sql"];
const PROMISE_LANGUAGE = /\b(approv\w*|guarantee\w*|will be paid|you will receive|payout|entitled to)\b/i;
const DEFINITION_ROUTES = ["match", "ci-match", "disability-match", "travel-match"] as const;
type DefinitionRoute = (typeof DEFINITION_ROUTES)[number];

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void> | void) {
  try { await fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}
function asUser(userId: string) { process.env.DEV_AUTH_ENABLED = "1"; process.env.DEV_ACCOUNT_ID = userId; }

const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CAUSE_TEXT = "Blunt force trauma from a road traffic accident";
const PAGES = [{ pageNumber: 1, text: `Police report. Deceased: Tan Jia Ming Raymond. Date of death 2026-09-14. Cause of death: ${CAUSE_TEXT}.` }];
const EXTRACTION = {
  deceasedName: "Tan Jia Ming Raymond", otherNamesMentioned: [], personIdentifiers: [],
  dateOfDeath: "2026-09-14", statedCauseOfDeath: CAUSE_TEXT, mannerOfDeath: "accident",
  issuingAuthority: "SPF", documentReference: "REF-1", documentType: "police_report",
  pageCitations: [{ field: "statedCauseOfDeath", pageStart: 1, pageEnd: 1, excerpt: CAUSE_TEXT }],
  confidence: {},
};

async function main() {
  await testAsync("the reviewer UI offers exactly three decisions, requires a reason, and never sends identity or scope", () => {
    assert.deepEqual(REVIEWER_DECISION_CHOICES.map((c) => c.value), ["matches", "does_not_match", "needs_further_review"]);
    assert.equal(resultForChoice("match", "needs_further_review"), "needs_review");
    assert.equal(resultForChoice("travel-match", "needs_further_review"), "needs_review");
    assert.equal(resultForChoice("ci-match", "needs_further_review"), "insufficient_evidence");
    assert.equal(resultForChoice("disability-match", "matches"), "matches");
    const target = { route: "ci-match" as const, contractId: "c", coverageId: "v", benefitCode: "ci-major", illnessName: "Major Cancer" };
    assert.equal(buildReviewerDecisionRequest({ assignmentId: "a", evidenceDocumentId: "d", target, choice: "matches", reason: " " }).ok, false);
    assert.equal(buildReviewerDecisionRequest({ assignmentId: "a", evidenceDocumentId: "d", target, choice: "", reason: "Because." }).ok, false);
    const built = buildReviewerDecisionRequest({ assignmentId: "a", evidenceDocumentId: "d", target, choice: "matches", reason: "Diagnosis meets the wording." });
    assert.ok(built.ok);
    if (!built.ok) return;
    assert.equal(built.url, "/api/claims/evidence/d/ci-match");
    assert.deepEqual(Object.keys(built.body).sort(), ["assignmentId", "benefitCode", "contractId", "coverageId", "illnessName", "reason", "result"]);
  });

  await testAsync("the reviewer area sits outside household navigation and the household page shows only the four statuses", async () => {
    const shell = await readFile(path.resolve("components/AppShell.tsx"), "utf8");
    assert.match(shell, /pathname\.startsWith\("\/reviewer"\)/);
    const nav = shell.slice(shell.indexOf("const nav"), shell.indexOf("];", shell.indexOf("const nav")));
    assert.ok(!nav.includes("/reviewer"), "the household navigation never links to the reviewer area");
    for (const file of ["app/reviewer/page.tsx", "app/reviewer/assignments/[id]/page.tsx"]) {
      const source = await readFile(path.resolve(file), "utf8");
      assert.ok(!/\/api\/(family|policies|household|ledger|claims\/evidence\?)/.test(source), `${file} must read only reviewer endpoints`);
      assert.ok(!/(sumInsured|formula|amount|model_execution|modelExecution)\s*[:=]\s*/.test(source.replace(/amountText/g, "")), `${file} must not edit amounts, formulas or provenance`);
    }
    const household = await readFile(path.resolve("app/claims/[id]/page.tsx"), "utf8");
    assert.match(household, /HOUSEHOLD_REVIEW_STATUS_COPY/);
    assert.match(household, /INDICATIVE_ESTIMATE_NOTICE/);
    assert.ok(!/reviewedBy|reviewed_by|\.reason\b/.test(household), "the household page never shows who reviewed or why");
  });

  setTelemetryAdapter(new NoopTelemetryAdapter());
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.READING_MODEL = "anthropic:claude-haiku-4-5";
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of SQL_FILES) await db.exec(await readFile(path.resolve(file), "utf8"));
  await db.exec("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;");
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

  try {
    const { ensureCriticalIllnessSchema } = await import("@/lib/claims/evidence/ci-schema");
    const { ensureDisabilitySchema } = await import("@/lib/claims/evidence/disability-schema");
    const { ensureClaimReviewerSchema } = await import("@/lib/claims/reviewers/schema");
    await ensureCriticalIllnessSchema();
    await ensureDisabilitySchema();
    await db.exec(await readFile(path.resolve("sql/lifecycle.sql"), "utf8"));
    await ensureClaimReviewerSchema();
    await db.exec("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;");

    const admin = await import("@/lib/claims/reviewers/admin");
    const { POST: postUpload } = await import("@/app/api/claims/evidence/upload/route");
    const { GET: listEvidence } = await import("@/app/api/claims/evidence/route");
    const { GET: listAssignments } = await import("@/app/api/reviewer/assignments/route");
    const { GET: getAssignment } = await import("@/app/api/reviewer/assignments/[id]/route");
    const { GET: getDocument } = await import("@/app/api/reviewer/assignments/[id]/documents/[documentId]/route");
    const routes: Record<DefinitionRoute, (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>> = {
      match: (await import("@/app/api/claims/evidence/[id]/match/route")).POST,
      "ci-match": (await import("@/app/api/claims/evidence/[id]/ci-match/route")).POST,
      "disability-match": (await import("@/app/api/claims/evidence/[id]/disability-match/route")).POST,
      "travel-match": (await import("@/app/api/claims/evidence/[id]/travel-match/route")).POST,
    };
    const { transitionEvidenceStatus, recordExtraction, loadEvidenceProvenanceContext } = await import("@/lib/claims/evidence/store");
    const { extractClaimEvidence } = await import("@/lib/claims/evidence/extract");
    const { loadCauseDefinitionMatchesForFacts } = await import("@/lib/claims/evidence/session-matches");
    const { calculateAccidentalDeath } = await import("@/lib/claims/calculators/accidental-death");
    const { validatePolicyEvidence } = await import("@/lib/claims/calculators/evidence");
    const { evaluateEvidenceAuthority } = await import("@/lib/claims/evidence-authority");
    const { resolveMatchProvenance } = await import("@/lib/claims/evidence/extraction-provenance");

    // --- People and households --------------------------------------------
    const householdA = uuid("a1000000", 1), householdB = uuid("a1000000", 2);
    const ownerA = uuid("b1000000", 1), memberUserA = uuid("b1000000", 2), ownerB = uuid("b1000000", 3);
    const reviewer = uuid("c1000000", 1), suspended = uuid("c1000000", 2), idle = uuid("c1000000", 3), insider = uuid("c1000000", 4), unprovisioned = uuid("c1000000", 5);
    const raymond = uuid("d1000000", 1), spouse = uuid("d1000000", 2), memberB = uuid("d1000000", 3);
    const claimA1 = uuid("e1000000", 1), claimA2 = uuid("e1000000", 2), claimB1 = uuid("e1000000", 3);
    const policyA = uuid("f1000000", 1), policySpouse = uuid("f1000000", 2), policyB = uuid("f1000000", 3);
    const coverageA = uuid("f2000000", 1), coverageSpouse = uuid("f2000000", 2), coverageB = uuid("f2000000", 3);
    await pool.query(`INSERT INTO accounts(id,name) VALUES($1,'Household A'),($2,'Household B')`, [householdA, householdB]);
    await pool.query(`INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member'),($4,$5,'owner')`, [householdA, ownerA, memberUserA, householdB, ownerB]);
    await pool.query(`INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,'Tan Jia Ming Raymond','Raymond','self'),($3,$2,'Casey Tan','Casey','spouse'),($4,$5,'Blake Lim','Blake','self')`,
      [raymond, householdA, spouse, memberB, householdB]);
    await pool.query(`INSERT INTO claim_sessions(id,account_id,family_member_id,status,event_type) VALUES($1,$2,$3,'fact_finding','death'),($4,$2,$3,'fact_finding','death'),($5,$6,$7,'fact_finding','death')`,
      [claimA1, householdA, raymond, claimA2, claimB1, householdB, memberB]);
    const pages = fixture.benefitSummary.pages.map((p) => ({ page_number: p.pageNumber, text: p.text }));
    for (const [policyId, account, member, coverageId] of [[policyA, householdA, raymond, coverageA], [policySpouse, householdA, spouse, coverageSpouse], [policyB, householdB, memberB, coverageB]]) {
      await pool.query(
        `INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,group_policy_number,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,document_authority,quarantine_status)
         VALUES($1,$2,$3,'Singlife','Group Personal Accident','G007500','certificate',true,'ready','cert.pdf','k',90,'scan_clean')`, [policyId, account, member]);
      for (const p of pages) await pool.query(`INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)`, [account, policyId, p.page_number, p.text]);
      await pool.query(`INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'upload')`, [policyId, member, account]);
      await pool.query(`INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,confirmed,evidence_verified,product_name)
         VALUES($1,$2,$3,$4,'Personal Accident',600000,'SGD',true,true,'Group Personal Accident')`, [coverageId, account, policyId, member]);
    }

    // --- Documents: real upload route, then the pipeline's own transitions.
    let seq = 0;
    async function readyDocument(account: string, owner: string, member: string, claim: string, withProvenance = true) {
      seq++;
      asUser(owner);
      const form = new FormData();
      form.set("file", new File([new Uint8Array(Buffer.from(`%PDF-1.4\n%reviewer-${seq}\n%%EOF\n`, "latin1"))], `police-${seq}.pdf`, { type: "application/pdf" }));
      form.set("familyMemberId", member); form.set("claimSessionId", claim); form.set("documentType", "police_report");
      const res = await postUpload(new NextRequest("http://localhost/api/claims/evidence/upload", { method: "POST", headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${account}` }, body: form }));
      assert.equal(res.status, 202, await res.clone().text());
      const id = (await res.json()).documentId as string;
      await transitionEvidenceStatus({ accountId: account, id, from: "uploaded", to: "quarantined", scanStatus: "clean" });
      await transitionEvidenceStatus({ accountId: account, id, from: "quarantined", to: "processing" });
      const hash = (await pool.query<{ file_hash: string }>(`SELECT file_hash FROM claim_evidence_documents WHERE id=$1`, [id])).rows[0].file_hash;
      global.fetch = (async () => new Response(JSON.stringify({
        id: `msg_${id}`, model: "claude-haiku-4-5-20250620",
        content: [{ type: "text", text: JSON.stringify(EXTRACTION) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 },
      }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
      const extraction = await extractClaimEvidence({ pages: PAGES, documentType: "police_report", documentId: id });
      await recordExtraction({
        accountId: account, evidenceDocumentId: id, sourceDocumentVersion: hash, extractedFields: extraction.fields,
        extractionModel: extraction.model, extractionProvider: extraction.provider, extractionVersion: extraction.version, identityConflicts: [],
        modelExecution: withProvenance ? extraction.execution : null,
      });
      await transitionEvidenceStatus({ accountId: account, id, from: "processing", to: "extracted", identityStatus: "confirmed" });
      await transitionEvidenceStatus({ accountId: account, id, from: "extracted", to: "needs_review" });
      return id;
    }
    const docA1 = await readyDocument(householdA, ownerA, raymond, claimA1);
    const docA1b = await readyDocument(householdA, ownerA, raymond, claimA1);
    const docA2 = await readyDocument(householdA, ownerA, raymond, claimA2);
    const docB1 = await readyDocument(householdB, ownerB, memberB, claimB1);

    // --- Reviewers: only through the operator procedure.
    for (const [userId, label] of [[reviewer, "Reviewer One"], [suspended, "Reviewer Two"], [idle, "Reviewer Three"], [insider, "Reviewer Four"]]) {
      await admin.provisionClaimReviewer({ userId, displayLabel: label, operator: "ops.lead" });
    }
    const claimAssignment = (await admin.assignClaimReview({ reviewerUserId: reviewer, accountId: householdA, claimSessionId: claimA1, expiresInHours: 48, operator: "ops.lead" })).assignmentId;
    const householdBAssignment = (await admin.assignClaimReview({ reviewerUserId: reviewer, accountId: householdB, claimSessionId: claimB1, expiresInHours: 48, operator: "ops.lead" })).assignmentId;

    const decide = (route: DefinitionRoute, documentId: string, body: Record<string, unknown>) =>
      routes[route](new NextRequest(`http://localhost/api/claims/evidence/${documentId}/${route}`, {
        method: "POST", headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${householdA}`, "content-type": "application/json" }, body: JSON.stringify(body),
      }), { params: Promise.resolve({ id: documentId }) });
    const assignmentGet = (id: string) => getAssignment(new NextRequest(`http://localhost/api/reviewer/assignments/${id}`), { params: Promise.resolve({ id }) });
    const documentGet = (id: string, documentId: string) =>
      getDocument(new NextRequest(`http://localhost/api/reviewer/assignments/${id}/documents/${documentId}`), { params: Promise.resolve({ id, documentId }) });
    const listGet = () => listAssignments(new NextRequest("http://localhost/api/reviewer/assignments"));
    const decisionBody = (overrides: Record<string, unknown> = {}) => ({
      assignmentId: claimAssignment, contractId: policyA, coverageId: coverageA, result: "needs_review", reason: "Checked the police report against the wording.", ...overrides,
    });
    const matchRowCount = async () => {
      let total = 0;
      for (const table of ["claim_cause_definition_matches", "claim_ci_definition_matches", "claim_disability_definition_matches"]) {
        total += Number((await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`)).rows[0].n);
      }
      return total;
    };
    const assignmentCount = async () => Number((await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM claim_review_assignments`)).rows[0].n);
    const householdStatuses = async (claim = claimA1) => {
      asUser(ownerA);
      const res = await listEvidence(new NextRequest(`http://localhost/api/claims/evidence?familyMemberId=${raymond}&claimSessionId=${claim}`, { headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${householdA}` } }));
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(!text.includes("reviewer:") && !text.includes("Reviewer One") && !text.includes("ops.lead"), "the household never sees who reviewed, or who assigned");
      const docs = JSON.parse(text).documents as { id: string; reviewStatus: string | null }[];
      return Object.fromEntries(docs.map((d) => [d.id, d.reviewStatus]));
    };
    async function asDatabaseUser(userId: string, fn: () => Promise<void>) {
      await db.query("BEGIN");
      try {
        await db.query("SET LOCAL ROLE authenticated");
        await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
        await fn();
      } finally { await db.query("ROLLBACK"); }
    }

    await testAsync("1. a household owner cannot create or assign a reviewer -- through the database API or any route", async () => {
      await asDatabaseUser(ownerA, async () => {
        await assert.rejects(db.query(`INSERT INTO claim_reviewers(user_id,display_label,provisioned_by) VALUES($1,'Me','household')`, [ownerA]), /row-level security|permission denied/);
      });
      await asDatabaseUser(ownerA, async () => {
        await assert.rejects(db.query(`INSERT INTO claim_review_assignments(reviewer_user_id,account_id,family_member_id,claim_session_id,expires_at,assigned_by) VALUES($1,$2,$3,$4,now()+interval '1 day','household')`,
          [reviewer, householdA, raymond, claimA1]), /row-level security|permission denied/);
      });
      await asDatabaseUser(ownerA, async () => {
        const visible = await db.query(`SELECT 1 FROM claim_reviewers UNION ALL SELECT 1 FROM claim_review_assignments UNION ALL SELECT 1 FROM claim_reviewer_audit_log`);
        assert.equal(visible.rows.length, 0, "reviewer tables are invisible to a household session");
      });
      await asDatabaseUser(ownerA, async () => {
        await assert.rejects(db.query(
          `INSERT INTO claim_cause_definition_matches(account_id,family_member_id,claim_session_id,contract_id,evidence_document_id,cause_evidence,definition_evidence,result,reviewed_by)
           VALUES($1,$2,$3,$4,$5,'{}'::jsonb,'{}'::jsonb,'matches','household')`, [householdA, raymond, claimA1, policyA, docA1]), /row-level security|permission denied/,
          "a household session can no longer write its own definition decision directly");
      });
      asUser(ownerA);
      assert.equal((await listGet()).status, 403, "the reviewer area refuses a household owner");
    });

    await testAsync("2. a household owner or member cannot call any definition-match route, even with a real assignment id", async () => {
      const before = await matchRowCount();
      for (const user of [ownerA, memberUserA]) {
        asUser(user);
        for (const route of DEFINITION_ROUTES) {
          const res = await decide(route, docA1, decisionBody({ result: "matches", benefitCode: "ci-major", illnessName: "Major Cancer", matchKey: "tpd" }));
          assert.equal(res.status, 403, `${route} as ${user}`);
          const json = await res.json();
          assert.equal(json.reasonCode, "POLICY_DEFINITION_REVIEW_REQUIRED");
          assert.equal(json.error, POLICY_DEFINITION_REVIEW_REQUIRED_MESSAGE);
        }
      }
      assert.equal(await matchRowCount(), before);
    });

    await testAsync("4. an unprovisioned signed-in user is refused everywhere", async () => {
      asUser(unprovisioned);
      assert.equal((await decide("match", docA1, decisionBody())).status, 403);
      assert.equal((await listGet()).status, 403);
      assert.equal((await assignmentGet(claimAssignment)).status, 403);
      assert.equal((await documentGet(claimAssignment, docA1)).status, 403);
    });

    await testAsync("5. a suspended reviewer is refused immediately and loses their assignments", async () => {
      const own = (await admin.assignClaimReview({ reviewerUserId: suspended, accountId: householdA, claimSessionId: claimA2, expiresInHours: 24, operator: "ops.lead" })).assignmentId;
      asUser(suspended);
      assert.equal((await assignmentGet(own)).status, 200);
      const result = await admin.setClaimReviewerStatus({ userId: suspended, status: "suspended", reason: "Left the team", operator: "ops.lead" });
      assert.equal(result.assignmentsRevoked, 1);
      assert.equal((await assignmentGet(own)).status, 403);
      assert.equal((await decide("match", docA2, { ...decisionBody(), assignmentId: own })).status, 403);
      await admin.setClaimReviewerStatus({ userId: suspended, status: "active", reason: "Returned", operator: "ops.lead" });
      assert.equal((await assignmentGet(own)).status, 404, "reactivation never silently restores an old assignment");
    });

    await testAsync("6. an active reviewer without an assignment sees nothing and cannot borrow another reviewer's", async () => {
      asUser(idle);
      const list = await listGet();
      assert.equal(list.status, 200);
      assert.deepEqual((await list.json()).assignments, []);
      assert.equal((await assignmentGet(claimAssignment)).status, 404);
      assert.equal((await documentGet(claimAssignment, docA1)).status, 404);
      assert.equal((await decide("match", docA1, decisionBody())).status, 404);
    });

    await testAsync("7. an expired assignment grants nothing", async () => {
      const expiring = (await admin.assignClaimReview({ reviewerUserId: idle, accountId: householdA, claimSessionId: claimA1, expiresInHours: 1, operator: "ops.lead" })).assignmentId;
      asUser(idle);
      assert.equal((await assignmentGet(expiring)).status, 200);
      await pool.query(`UPDATE claim_review_assignments SET assigned_at=now()-interval '3 days', expires_at=now()-interval '1 day' WHERE id=$1`, [expiring]);
      assert.equal((await assignmentGet(expiring)).status, 404);
      assert.equal((await documentGet(expiring, docA1)).status, 404);
      assert.equal((await decide("match", docA1, { ...decisionBody(), assignmentId: expiring })).status, 404);
      assert.deepEqual((await (await listGet()).json()).assignments, []);
    });

    asUser(reviewer);

    await testAsync("8/9. an assignment for claim A1 never reaches claim A2, and never another household", async () => {
      asUser(reviewer);
      const before = await matchRowCount();
      assert.equal((await decide("match", docA2, decisionBody())).status, 404, "another claim of the same household");
      assert.equal((await documentGet(claimAssignment, docA2)).status, 404);
      assert.equal((await decide("match", docB1, decisionBody())).status, 404, "another household's document");
      assert.equal((await documentGet(claimAssignment, docB1)).status, 404);
      assert.equal((await decide("match", docA1, { ...decisionBody(), assignmentId: householdBAssignment })).status, 404, "household B's assignment cannot touch household A");
      assert.equal((await documentGet(householdBAssignment, docA1)).status, 404);
      assert.equal(await matchRowCount(), before);
    });

    await testAsync("10. a reviewer can never review their own household's claim", async () => {
      // Assigned while an outsider, then joins the household: refused from that moment on.
      const assignment = (await admin.assignClaimReview({ reviewerUserId: insider, accountId: householdA, claimSessionId: claimA1, expiresInHours: 24, operator: "ops.lead" })).assignmentId;
      asUser(insider);
      assert.equal((await assignmentGet(assignment)).status, 200);
      await pool.query(`INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'member')`, [householdA, insider]);
      assert.equal((await assignmentGet(assignment)).status, 404);
      assert.equal((await decide("match", docA1, { ...decisionBody(), assignmentId: assignment })).status, 404);
      assert.equal((await documentGet(assignment, docA1)).status, 404);
      await assert.rejects(
        admin.assignClaimReview({ reviewerUserId: insider, accountId: householdA, claimSessionId: claimA2, expiresInHours: 24, operator: "ops.lead" }),
        (error: { code?: string }) => error.code === "SELF_REVIEW_FORBIDDEN",
      );
      asUser(reviewer);
    });

    await testAsync("11. a single-document assignment never unlocks another document of the same claim", async () => {
      asUser(idle);
      const single = (await admin.assignClaimReview({ reviewerUserId: idle, accountId: householdA, claimSessionId: claimA1, evidenceDocumentId: docA1, expiresInHours: 24, operator: "ops.lead" })).assignmentId;
      assert.equal((await documentGet(single, docA1)).status, 200);
      assert.equal((await documentGet(single, docA1b)).status, 404);
      assert.equal((await decide("match", docA1b, { ...decisionBody(), assignmentId: single })).status, 404);
      const workspace = await (await assignmentGet(single)).json();
      assert.deepEqual(workspace.documents.map((d: { id: string }) => d.id), [docA1]);
      await admin.revokeClaimReviewAssignment({ assignmentId: single, reason: "Test complete", operator: "ops.lead" });
      asUser(reviewer);
    });

    await testAsync("12. contract/coverage substitution across member, policy or household is refused", async () => {
      const before = await matchRowCount();
      for (const scope of [
        { contractId: policySpouse, coverageId: coverageSpouse },
        { contractId: policyB, coverageId: coverageB },
        { contractId: policyA, coverageId: coverageSpouse },
        { contractId: policyA, coverageId: coverageB },
        { contractId: "not-a-uuid", coverageId: null },
        { contractId: null, coverageId: coverageA },
      ]) {
        const res = await decide("match", docA1, decisionBody(scope));
        assert.equal(res.status, 404, JSON.stringify(scope));
      }
      assert.equal(await matchRowCount(), before);
    });

    await testAsync("household status is 'awaiting reviewer' with no assignment and 'in review' once assigned", async () => {
      const statuses = await householdStatuses(claimA2);
      assert.equal(statuses[docA2], "awaiting_assignment", "claim A2 has no active assignment");
      assert.equal((await householdStatuses())[docA1], "in_review");
      asUser(reviewer);
    });

    await testAsync("13a. the decision needs a reason and a supported result", async () => {
      assert.equal((await (await decide("match", docA1, decisionBody({ reason: "" }))).json()).reasonCode, "REASON_REQUIRED");
      assert.equal((await (await decide("match", docA1, decisionBody({ reason: undefined }))).json()).reasonCode, "REASON_REQUIRED");
      assert.equal((await (await decide("match", docA1, decisionBody({ result: "approved" }))).json()).reasonCode, "INVALID_RESULT");
    });

    await testAsync("3/13/14/15. an assigned reviewer records every supported result; forged identity/scope fields are ignored; history is superseded, never deleted", async () => {
      const forged = { reviewerName: "Insurer claims adjuster", reviewedBy: "Insurer", accountId: householdB, familyMemberId: spouse, claimSessionId: claimA2, causeEvidence: { pageStart: 9, pageEnd: 9 } };
      for (const result of ["needs_review", "does_not_match", "matches"]) {
        const res = await decide("match", docA1, decisionBody({ ...forged, result, reason: `Decision ${result}: compared page 1 with the definition.` }));
        assert.equal(res.status, 200, await res.clone().text());
        const json = await res.json();
        assert.equal(json.match.result, result);
        assert.equal(json.notice, INDICATIVE_ESTIMATE_NOTICE);
      }
      const rows = (await pool.query<{ account_id: string; family_member_id: string; claim_session_id: string; reviewed_by: string; result: string; superseded_at: string | null; cause_evidence: { pageStart: number } }>(
        `SELECT account_id::text, family_member_id::text, claim_session_id::text, reviewed_by, result, superseded_at::text, cause_evidence FROM claim_cause_definition_matches WHERE evidence_document_id=$1 ORDER BY reviewed_at, id`, [docA1])).rows;
      assert.equal(rows.length, 3, "every decision is kept");
      for (const row of rows) {
        assert.equal(row.reviewed_by, `reviewer:${reviewer}`, "the authenticated reviewer, never a name from the body");
        assert.equal(row.account_id, householdA); assert.equal(row.family_member_id, raymond); assert.equal(row.claim_session_id, claimA1);
        assert.equal(row.cause_evidence.pageStart, 1, "page overrides from the body are ignored");
      }
      assert.equal(rows.filter((r) => r.superseded_at === null).length, 1, "only one decision is active");
      assert.equal(rows.find((r) => r.superseded_at === null)!.result, "matches", "the newest decision is the active one");
      const audit = (await pool.query<{ actor: string; details: { result: string; route: string } }>(
        `SELECT actor, details FROM claim_reviewer_audit_log WHERE action='definition_decision_recorded' AND evidence_document_id=$1 ORDER BY id`, [docA1])).rows;
      assert.deepEqual(audit.map((a) => [a.actor, a.details.route, a.details.result]), ["needs_review", "does_not_match", "matches"].map((r) => [`reviewer:${reviewer}`, "match", r]));
      const evidenceAudit = (await pool.query<{ actor: string }>(`SELECT actor FROM claim_evidence_audit_log WHERE evidence_document_id=$1 AND action='cause_definition_match_recorded'`, [docA1])).rows;
      assert.ok(evidenceAudit.length === 3 && evidenceAudit.every((a) => a.actor === `reviewer:${reviewer}`));
      await assert.rejects(pool.query(`UPDATE claim_reviewer_audit_log SET actor='someone-else'`), /append-only/);
      await assert.rejects(pool.query(`DELETE FROM claim_reviewer_audit_log`), /append-only/);
      const workspace = await (await assignmentGet(claimAssignment)).json();
      const history = (workspace.history as { evidenceDocumentId: string; supersededAt: string | null }[]).filter((h) => h.evidenceDocumentId === docA1);
      assert.equal(history.length, 3);
      assert.equal(history.filter((h) => h.supersededAt !== null).length, 2);
      assert.ok((workspace.definitions as { route: string; contractId: string }[]).some((d) => d.route === "match" && d.contractId === policyA), "the cited policy definition is shown");
    });

    await testAsync("13b. the CI, disability and travel routes pass the reviewer boundary and reach the policy's own definition checks", async () => {
      const before = await matchRowCount();
      for (const [route, extra] of [
        ["ci-match", { result: "matches", benefitCode: "ci-major", illnessName: "Major Cancer" }],
        ["disability-match", { result: "insufficient_evidence", benefitCode: "tpd-lump-sum", matchKey: "total_permanent_disability" }],
        ["travel-match", { result: "matches" }],
      ] as const) {
        const res = await decide(route, docA1, decisionBody(extra));
        const text = await res.text();
        // A police report is not medical evidence, and this GPA policy has no
        // travel wording: each refusal comes from the unchanged domain
        // checks, after authorization succeeded.
        assert.equal(res.status, 409, `${route}: ${text}`);
        assert.ok(!/POLICY_DEFINITION_REVIEW_REQUIRED|REVIEWER_ACCESS_REQUIRED/.test(text), text);
      }
      assert.equal(await matchRowCount(), before);
      assert.equal((await (await decide("ci-match", docA1, decisionBody({ result: "needs_review", benefitCode: "ci-major", illnessName: "x" }))).json()).reasonCode, "INVALID_RESULT");
    });

    await testAsync("17/18. a reviewed match on verified, current provenance unlocks the deterministic estimate for its own scope only; missing, mismatched or stale provenance still blocks", async () => {
      const facts = await loadCauseDefinitionMatchesForFacts(householdA, raymond, claimA1);
      const loaded = facts.find((m) => (m.causeEvidence as { documentId?: string }).documentId === docA1);
      assert.ok(loaded?.provenance, "provenance is snapshotted server-side from the stored extraction");
      const check = validatePolicyEvidence(loaded!.definitionEvidence, "MALFORMED_POLICY_DEFINITION_EVIDENCE");
      assert.ok(check.valid);
      if (!check.valid) return;
      const input = (match: NonNullable<typeof loaded>, contractId = policyA, coverageId = coverageA) => ({
        ownership: { contractId, coverageId }, familyMember: { id: raymond, confirmed: true }, claimEventId: claimA1,
        deathConfirmed: true, dateOfDeath: "2026-09-14", policyEffectiveDate: "2020-01-01", sumInsured: 600_000, currency: "SGD",
        formula: { kind: "sum_insured_fraction" as const, fraction: 1, evidence: check.evidence },
        ruleEvidence: check.evidence, ownershipEvidence: { policyId: contractId, chunkId: `coverage:${coverageId}`, coverageId, familyMemberId: raymond },
        accidentalDeathDefinitionEvidence: check.evidence, causeDefinitionMatch: match,
      });
      const result = calculateAccidentalDeath(input(loaded!));
      assert.equal(result.status, "calculated", JSON.stringify(result));
      if (result.status === "calculated") assert.equal(result.potentialAmount, 600_000);
      assert.equal(calculateAccidentalDeath(input(loaded!, policySpouse, coverageSpouse)).status, "blocked", "never another member's policy");

      const swapped = { ...loaded!, causeEvidence: { ...(loaded!.causeEvidence as object), documentId: docA1b } };
      assert.equal(calculateAccidentalDeath(input(swapped)).status, "blocked", "provenance bound to another document");
      const context = (await loadEvidenceProvenanceContext(householdA, [docA1])).get(docA1)!;
      const stale = resolveMatchProvenance(loaded!.provenance, { ...context, fileHash: "sha256:a-corrected-upload" }, { documentId: docA1, familyMemberId: raymond, claimSessionId: claimA1 });
      assert.equal(evaluateEvidenceAuthority(stale).authorized, false, "a changed document version");

      const withoutProvenance = await readyDocument(householdA, ownerA, raymond, claimA2, false);
      const second = (await admin.assignClaimReview({ reviewerUserId: reviewer, accountId: householdA, claimSessionId: claimA2, expiresInHours: 24, operator: "ops.lead" })).assignmentId;
      asUser(reviewer);
      const res = await decide("match", withoutProvenance, decisionBody({ assignmentId: second, result: "matches", reason: "Matches, but the reading has no provenance." }));
      assert.equal(res.status, 200, await res.clone().text());
      const unverified = (await loadCauseDefinitionMatchesForFacts(householdA, raymond, claimA2)).find((m) => (m.causeEvidence as { documentId?: string }).documentId === withoutProvenance)!;
      const blocked = calculateAccidentalDeath({ ...input(unverified), claimEventId: claimA2 });
      assert.equal(blocked.status, "blocked");
      if (blocked.status === "blocked") assert.equal(blocked.reasonCode, "EVIDENCE_PROVENANCE_MISSING");
    });

    await testAsync("household sees 'reviewed' or 'more evidence needed' -- and no reviewer identity or notes", async () => {
      assert.equal((await householdStatuses())[docA1], "reviewed");
      asUser(ownerA);
      const text = await (await listEvidence(new NextRequest(`http://localhost/api/claims/evidence?familyMemberId=${raymond}&claimSessionId=${claimA1}`, { headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${householdA}` } }))).text();
      assert.ok(!text.includes("compared page 1 with the definition"), "the reviewer's reason is internal");
      asUser(reviewer);
      const res = await decide("match", docA1b, decisionBody({ result: "needs_review", reason: "Page 2 is missing; ask for the full report." }));
      assert.equal(res.status, 200);
      const after = await householdStatuses();
      assert.equal(after[docA1b], "more_evidence_required");
      assert.equal(after[docA1], "reviewed", "a decision on another document never changes this document's status");
      asUser(reviewer);
    });

    await testAsync("16. revocation immediately blocks document download and new decisions", async () => {
      asUser(reviewer);
      const before = await documentGet(claimAssignment, docA1);
      assert.equal(before.status, 200);
      assert.equal(before.headers.get("cache-control"), "private, no-store");
      assert.match(Buffer.from(await before.arrayBuffer()).toString("latin1"), /^%PDF-1\.4/);
      const viewed = await pool.query(`SELECT 1 FROM claim_reviewer_audit_log WHERE action='document_viewed' AND actor=$1 AND evidence_document_id=$2`, [`reviewer:${reviewer}`, docA1]);
      assert.ok(viewed.rows.length >= 1, "document access is audited");
      await admin.revokeClaimReviewAssignment({ assignmentId: claimAssignment, reason: "Reassigned", operator: "ops.lead" });
      assert.equal((await documentGet(claimAssignment, docA1)).status, 404);
      assert.equal((await decide("match", docA1, decisionBody())).status, 404);
      assert.equal((await assignmentGet(claimAssignment)).status, 404);
      const statuses = await householdStatuses(claimA1);
      assert.equal(statuses[docA1b], "more_evidence_required", "a past decision stays; revocation removes only access");
      assert.equal(statuses[docA1], "reviewed", "a completed decision survives revocation");
    });

    await testAsync("19. reviewer and household wording never promises approval or payment", async () => {
      const copy = [INDICATIVE_ESTIMATE_NOTICE, POLICY_DEFINITION_REVIEW_REQUIRED_MESSAGE, ...Object.values(HOUSEHOLD_REVIEW_STATUS_COPY).flatMap((c) => [c.label, c.detail])];
      for (const text of copy) assert.ok(!PROMISE_LANGUAGE.test(text), text);
      assert.match(INDICATIVE_ESTIMATE_NOTICE, /indicative/);
      for (const file of ["app/reviewer/page.tsx", "app/reviewer/assignments/[id]/page.tsx", "app/claims/[id]/page.tsx"]) {
        let source: string;
        try { source = await readFile(path.resolve(file), "utf8"); } catch { continue; }
        assert.ok(!PROMISE_LANGUAGE.test(source), `${file} contains approval or payout-promise wording`);
      }
    });

    await testAsync("20. no route -- reviewer or household -- can provision a reviewer or create an assignment", async () => {
      const before = await assignmentCount();
      const files: string[] = [];
      const walk = async (dir: string) => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) await walk(full); else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
        }
      };
      await walk(path.resolve("app"));
      for (const file of files) {
        const source = await readFile(file, "utf8");
        assert.ok(!/(from\s*|import\s*\(\s*)["'][^"']*reviewers\/admin["']/.test(source), `${file} imports the operator-only reviewer module`);
        assert.ok(!/(INSERT INTO|UPDATE)\s+claim_review(ers|_assignments)/i.test(source), `${file} writes reviewer tables`);
      }
      const reviewerRoutes = files.filter((f) => f.includes(`${path.sep}api${path.sep}reviewer${path.sep}`));
      assert.equal(reviewerRoutes.length, 3);
      for (const file of reviewerRoutes) {
        const source = await readFile(file, "utf8");
        assert.ok(!/export (async )?function (POST|PUT|PATCH|DELETE)\b/.test(source), `${file} must be read-only`);
      }
      asUser(reviewer);
      await listGet();
      assert.equal(await assignmentCount(), before);
      assert.equal(Number((await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM claim_reviewers`)).rows[0].n), 4, "reviewers exist only through the operator procedure");
      const operatorRows = await pool.query<{ actor: string }>(`SELECT actor FROM claim_reviewer_audit_log WHERE action IN ('reviewer_provisioned','assignment_created','assignment_revoked') ORDER BY id`);
      assert.ok(operatorRows.rows.length > 0 && operatorRows.rows.every((r) => r.actor === "operator:ops.lead"));
    });
  } finally {
    global.fetch = originalFetch;
    pool.query = originalQuery; pool.connect = originalConnect;
    await db.close();
  }
  console.log(`DearPolicy claim-reviewer authorization regressions passed (${cases} cases).`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
