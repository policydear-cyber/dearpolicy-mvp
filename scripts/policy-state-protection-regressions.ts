/**
 * Policy-processing and coverage-verification state, protected at the
 * database and proven harmless end to end.
 *
 * `policies` rows belong to a household, but their quarantine/scan,
 * processing, storage/version, extraction and verification columns are
 * derived by the trusted server; `policy_coverages` rows are written only
 * by the extraction/linking pipeline, and `confirmed` / `evidence_verified`
 * are what let a coverage count toward an estimate. This suite:
 *
 *   1. requires every live column of both tables to be classified in
 *      lib/db/table-inventory.ts (POLICY_STATE_COLUMNS);
 *   2. for anon, a household member, a household owner, a reviewer and
 *      another household, attempts every direct UPDATE (every column), the
 *      named forgeries, INSERTs with trusted flags pre-set and DELETEs;
 *   3. proves the trusted paths still work: upload route, malware-scan
 *      gate and scan callback, reprocess route, family-member linking with
 *      server-side coverage extraction, policy deletion lifecycle, chat
 *      retrieval and the claim calculator;
 *   4. proves no attempted forgery (and no stale, superseded, rejected or
 *      unscanned policy, even if its flags were somehow set) can reach chat,
 *      a calculator, composition totals or an indicative amount.
 *
 * Every cell is recorded; every failure is printed; the suite fails if it
 * exits before its completion sentinel.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { pool } from "@/lib/db/client";
import { ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/auth/request-context";
import { POLICY_STATE_COLUMNS, BROWSER_WRITABLE_COLUMNS } from "@/lib/db/table-inventory";
import { asUser, fixedUuid, startReviewerHarness } from "./fixtures/reviewer-harness";
import { BENEFIT_FIXTURES } from "./fixtures/reviewer-benefit-wording";

let finished = false;
process.on("beforeExit", () => {
  if (!finished && !process.exitCode) { console.error("policy-state protection regressions did not finish (a pending operation never settled)"); process.exitCode = 1; }
});
const failures: string[] = [];
let checks = 0;
function record(ok: boolean, label: string) { checks++; if (!ok) failures.push(label); }
async function control(name: string, fn: () => Promise<void>) {
  checks++;
  try { await fn(); } catch (e) { failures.push(`control failed: ${name}: ${(e as Error).message}`); }
}
const DENIED = /permission denied|may only move an active/i;

async function main() {
  const h = await startReviewerHarness();
  const db = h.db;
  // The harness applies only the migrations the reviewer suites need. The
  // policies table's production shape also carries columns from
  // cover-conditions.sql (runbook step 3) and coverage-ledger.sql (step 4), so
  // apply those, then re-run household-rls.sql and infrastructure-rls.sql in
  // runbook order (16, 17) exactly as a production migration would.
  for (const file of ["sql/cover-conditions.sql", "sql/coverage-ledger.sql", "sql/household-rls.sql", "sql/infrastructure-rls.sql"]) {
    if (existsSync(path.resolve(file))) await db.exec(await readFile(path.resolve(file), "utf8"));
  }

  // Lock-free pool on the same database: service statements run as the
  // owner; a client that switches to `authenticated` (createUserSupabaseClient)
  // runs its statements as that role, one statement at a time.
  let lock = Promise.resolve();
  const serial = async <T>(fn: () => Promise<T>): Promise<T> => {
    const prev = lock; let release!: () => void; lock = new Promise<void>((r) => { release = r; });
    await prev; try { return await fn(); } finally { release(); }
  };
  const run = async (text: string, params: unknown[] = []) => {
    if (params.length === 0) {
      const results = await db.exec(text); const last = results[results.length - 1];
      return { rows: last?.rows ?? [], rowCount: (last as { affectedRows?: number } | undefined)?.affectedRows ?? last?.rows?.length ?? 0 };
    }
    const result = await db.query(text, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };
  pool.query = ((text: string, params: unknown[] = []) => serial(() => run(text, params))) as typeof pool.query;
  pool.connect = (async () => {
    let userRole = false;
    return {
      query: (text: string, params: unknown[] = []) => serial(async () => {
        const sql = text.trim();
        if (/^SET LOCAL ROLE authenticated$/i.test(sql)) { userRole = true; return { rows: [], rowCount: 0 }; }
        if (!userRole || /^(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return run(text, params);
        await db.query("SET ROLE authenticated");
        try { return await run(text, params); } finally { await db.query("RESET ROLE"); }
      }),
      release: () => {},
    };
  }) as typeof pool.connect;
  async function asBrowser<T>(who: { role: "anon" | "authenticated"; userId: string | null }, fn: () => Promise<T>): Promise<T> {
    return serial(async () => {
      await db.query("BEGIN");
      try {
        await db.query(`SET LOCAL ROLE ${who.role}`);
        await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [who.userId ?? ""]);
        return await fn();
      } finally { await db.query("ROLLBACK"); }
    });
  }
  const attempt = (who: { role: "anon" | "authenticated"; userId: string | null }, sql: string, params: unknown[] = []) =>
    asBrowser(who, async () => { try { const r = await db.query(sql, params); return { ok: true as const, rows: r.affectedRows ?? r.rows.length, error: "" }; } catch (e) { return { ok: false as const, rows: 0, error: (e as Error).message }; } });

  const f = BENEFIT_FIXTURES[0];
  const ownerA = fixedUuid("b9800000", 1), memberUserA = fixedUuid("b9800000", 2), ownerB = fixedUuid("b9800000", 3), reviewer = fixedUuid("b9800000", 4);
  const householdA = fixedUuid("a9800000", 1), householdB = fixedUuid("a9800000", 2);
  const identities = [
    { name: "anon", role: "anon" as const, userId: null },
    { name: "household member", role: "authenticated" as const, userId: memberUserA },
    { name: "household owner", role: "authenticated" as const, userId: ownerA },
    { name: "reviewer", role: "authenticated" as const, userId: reviewer },
    { name: "other household", role: "authenticated" as const, userId: ownerB },
  ];

  try {
    // --- fixtures: a real reviewed accidental-death estimate --------------
    await h.admin.provisionClaimReviewer({ userId: reviewer, displayLabel: "Reviewer", operator: "ops.lead" });
    await h.createHousehold(householdA, ownerA);
    await pool.query(`INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'member')`, [householdA, memberUserA]);
    await h.createHousehold(householdB, ownerB, "Other household");
    const member = await h.createMember(householdA, fixedUuid("d9800000", 1), "Tan Yi Chuen Desmond");
    const spouse = await h.createMember(householdA, fixedUuid("d9800000", 2), "Jordan Rivera", "spouse");
    const otherMember = await h.createMember(householdB, fixedUuid("d9800000", 3), "Other Person");
    const claim = await h.createClaim(householdA, member, fixedUuid("e9800000", 1), f.claimEventType);
    const { policyId, coverageId } = await h.createPolicy({ accountId: householdA, memberId: member, policyId: fixedUuid("f9800000", 1), coverageId: fixedUuid("f9900000", 1), ...f.policy });
    const doc = await h.uploadEvidence({ accountId: householdA, ownerUserId: ownerA, memberId: member, claimId: claim, ...f.evidence });
    const assignment = (await h.admin.assignClaimReview({ reviewerUserId: reviewer, accountId: householdA, claimSessionId: claim, expiresInHours: 24, operator: "ops.lead" })).assignmentId;
    const decided = await h.decide(f.route, reviewer, doc, { assignmentId: assignment, contractId: policyId, coverageId, result: "matches", reason: "Checked.", ...f.decisionScope });
    assert.equal(decided.status, 200, await decided.clone().text());
    await pool.query(`INSERT INTO policy_chunks(account_id,family_member_id,policy_id,page_start,page_end,heading,text) VALUES($1,$2,$3,1,1,'Benefits','Death due to accident: 100% of Sum Insured is payable.')`, [householdA, member, policyId]);

    // An UNSCANNED document with an (unverified) coverage and a chunk, as the
    // pipeline would leave it before a clean scan.
    const unscanned = fixedUuid("f9800000", 2), unscannedCoverage = fixedUuid("f9900000", 2);
    await pool.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,document_authority,file_hash,quarantine_status)
      VALUES($1,$2,$3,'Forged Insurer','Group Personal Accident','certificate',false,'queued','forged.pdf','k2',95,'sha256:forged','uploaded')`, [unscanned, householdA, member]);
    await pool.query(`INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'upload')`, [unscanned, member, householdA]);
    await pool.query(`INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,confirmed,evidence_verified,product_name,source_page)
      VALUES($1,$2,$3,$4,$5,9999999,'SGD',false,false,'Group Personal Accident',1)`, [unscannedCoverage, householdA, unscanned, member, f.policy.category]);
    await pool.query(`INSERT INTO policy_chunks(account_id,family_member_id,policy_id,page_start,page_end,heading,text) VALUES($1,$2,$3,1,1,'Forged','Death due to accident: forged unlimited benefit payable.')`, [householdA, member, unscanned]);

    const { confirmedOwnedCoverages } = await import("@/lib/coverage/facts");
    const { retrieveRelevantChunks } = await import("@/lib/rag/retrieve");
    const snapshot = async () => {
      const out = await h.assess(householdA, member, claim, f.facts);
      const coverages = await confirmedOwnedCoverages(householdA, member);
      const chunks = await retrieveRelevantChunks({ accountId: householdA, familyMemberId: member, question: "death benefit payable" });
      return {
        amount: out.assessments.find((a) => a.id === f.itemId && a.coverageId === coverageId)?.calculatedAmount,
        forgedItems: out.assessments.filter((a) => a.coverageId === unscannedCoverage && a.calculatedAmount !== undefined).length,
        totals: JSON.stringify(out.composition.totalsByCurrency),
        coverageIds: coverages.map((c) => c.id).sort(),
        chunkPolicies: [...new Set(chunks.map((c) => c.policyId))].sort(),
      };
    };

    const baseline = await snapshot();
    await control("baseline: the clean, reviewed policy produces its estimate, is cited by chat, and is the only verified coverage", async () => {
      assert.equal(baseline.amount, f.expectedAmount);
      assert.deepEqual(baseline.coverageIds, [coverageId]);
      assert.deepEqual(baseline.chunkPolicies, [policyId]);
      assert.equal(baseline.forgedItems, 0);
    });

    // === 1. every live column classified ===============================
    for (const t of ["policies", "policy_coverages"] as const) {
      const live = (await pool.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [t])).rows.map((r) => r.column_name);
      for (const c of live) record(c in POLICY_STATE_COLUMNS[t], `${t}.${c} is not classified in POLICY_STATE_COLUMNS`);
      for (const c of Object.keys(POLICY_STATE_COLUMNS[t])) record(live.includes(c), `POLICY_STATE_COLUMNS lists ${t}.${c}, which does not exist`);
    }

    // === 2. browser-role matrix =========================================
    let matrix = 0;
    const liveColumns = async (t: string) => (await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND is_identity='NO' AND is_generated='NEVER' ORDER BY ordinal_position`, [t])).rows.map((r) => r.column_name);
    const refused = (r: { ok: boolean; rows: number; error: string }) => (!r.ok && DENIED.test(r.error));
    for (const who of identities) {
      // Every column not on the browser-writable list, on both tables.
      for (const [t, id] of [["policies", unscanned], ["policy_coverages", unscannedCoverage]] as const) {
        for (const c of await liveColumns(t)) {
          if ((BROWSER_WRITABLE_COLUMNS[t].update as readonly string[]).includes(c)) continue;
          const r = await attempt(who, `UPDATE public.${t} SET ${c}=${c} WHERE id=$1`, [id]); matrix++;
          record(refused(r), `${who.name} can UPDATE ${t}.${c}${r.ok ? ` (${r.rows} rows)` : ` (${r.error})`}`);
        }
      }
      const forgeries: [string, string, unknown[]][] = [
        ["mark a policy clean / released", `UPDATE public.policies SET quarantine_status='scan_clean', scanned_at=now(), scan_provider='virustotal' WHERE id=$1`, [unscanned]],
        ["change processing status", `UPDATE public.policies SET processing_status='ready', processing_stage='complete' WHERE id=$1`, [unscanned]],
        ["change checksum", `UPDATE public.policies SET file_hash='sha256:other' WHERE id=$1`, [policyId]],
        ["change storage identity", `UPDATE public.policies SET storage_key='other/key.pdf' WHERE id=$1`, [policyId]],
        ["change document identity/version", `UPDATE public.policies SET supersedes_id=NULL, superseded_at=now() WHERE id=$1`, [policyId]],
        ["mark personal cover confirmed", `UPDATE public.policies SET personal_coverage_confirmed=true, document_authority=100 WHERE id=$1`, [unscanned]],
        ["reassign a policy to another household", `UPDATE public.policies SET account_id=$2 WHERE id=$1`, [policyId, householdB]],
        ["reassign a policy to another person", `UPDATE public.policies SET family_member_id=$2 WHERE id=$1`, [policyId, spouse]],
        ["create a policy already marked clean", `INSERT INTO public.policies(account_id,family_member_id,original_filename,storage_key,file_hash,quarantine_status,processing_status) VALUES($1,$2,'x.pdf','k','h','scan_clean','ready')`, [householdA, member]],
        ["delete a policy row", `DELETE FROM public.policies WHERE id=$1`, [unscanned]],
        ["set confirmed=true", `UPDATE public.policy_coverages SET confirmed=true WHERE id=$1`, [unscannedCoverage]],
        ["set evidence_verified=true", `UPDATE public.policy_coverages SET evidence_verified=true WHERE id=$1`, [unscannedCoverage]],
        ["modify an extracted amount", `UPDATE public.policy_coverages SET amount=5000000 WHERE id=$1`, [coverageId]],
        ["modify currency", `UPDATE public.policy_coverages SET currency='USD' WHERE id=$1`, [coverageId]],
        ["modify benefit type", `UPDATE public.policy_coverages SET category='Death' WHERE id=$1`, [coverageId]],
        ["modify citations", `UPDATE public.policy_coverages SET source_page=99, evidence_text='forged' WHERE id=$1`, [coverageId]],
        ["move a coverage to another person", `UPDATE public.policy_coverages SET family_member_id=$2 WHERE id=$1`, [coverageId, spouse]],
        ["move a coverage to another policy", `UPDATE public.policy_coverages SET policy_id=$2 WHERE id=$1`, [unscannedCoverage, policyId]],
        ["move a coverage to another household", `UPDATE public.policy_coverages SET account_id=$2, family_member_id=$3 WHERE id=$1`, [coverageId, householdB, otherMember]],
        ["create a coverage with both flags true", `INSERT INTO public.policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,confirmed,evidence_verified) VALUES($1,$2,$3,'Personal Accident',1000000,'SGD',true,true)`, [householdA, policyId, member]],
        ["create a coverage with confirmed=true", `INSERT INTO public.policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,confirmed) VALUES($1,$2,$3,'Personal Accident',1000000,'SGD',true)`, [householdA, policyId, member]],
        ["delete a coverage", `DELETE FROM public.policy_coverages WHERE id=$1`, [coverageId]],
        ["touch lifecycle bookkeeping without a deletion", `UPDATE public.policies SET updated_at=now() WHERE id=$1`, [policyId]],
        ["skip straight to soft_deleted", `UPDATE public.policies SET lifecycle_state='soft_deleted', lifecycle_version=lifecycle_version+1 WHERE id=$1`, [policyId]],
      ];
      for (const [label, sql, params] of forgeries) {
        const r = await attempt(who, sql, params); matrix++;
        // A row-scoped attempt by a session that cannot see the row affects 0
        // rows; that is also a refusal (and gives no existence signal).
        const ok = refused(r) || (r.ok && r.rows === 0 && who.role === "authenticated" && (who.name === "reviewer" || who.name === "other household") && sql.startsWith("UPDATE"));
        record(ok, `${who.name} can ${label}${r.ok ? ` (${r.rows} rows)` : ` (${r.error})`}`);
      }
    }
    // Control: the one browser write that is allowed (rolled back).
    const allowed = await attempt(identities[2], `UPDATE public.policies SET lifecycle_state='pending_deletion', lifecycle_version=lifecycle_version+1, updated_at=now() WHERE id=$1`, [policyId]);
    record(allowed.ok && allowed.rows === 1, `control: the owner's guarded move to pending_deletion must be accepted (${allowed.error})`);
    const otherView = await attempt(identities[4], `UPDATE public.policies SET lifecycle_state='pending_deletion', lifecycle_version=lifecycle_version+1 WHERE id=$1`, [policyId]);
    record(otherView.ok && otherView.rows === 0, "another household can reach household A's policy lifecycle");

    // === 4a. every attempted forgery left chat and money untouched ======
    const afterForgery = await snapshot();
    await control("after every attempted forgery: estimate, totals, verified coverage and chat citations are unchanged", async () => {
      assert.deepEqual(afterForgery, baseline);
      const row = (await pool.query(`SELECT quarantine_status, processing_status FROM policies WHERE id=$1`, [unscanned])).rows[0] as { quarantine_status: string; processing_status: string };
      assert.equal(row.quarantine_status, "uploaded"); assert.equal(row.processing_status, "queued");
    });
    await control("a forged coverage supplied in request/chat facts is ignored", async () => {
      const forged = { id: unscannedCoverage, policyId: unscanned, familyMemberId: member, category: f.policy.category, amount: 9999999, currency: "SGD", productName: "Group Personal Accident", sourcePage: 1, evidenceText: "forged", currencyVerified: true };
      const out = await h.assess(householdA, member, claim, { ...f.facts, coverages: [forged], ownedCoverages: [forged], confirmedCoverages: [forged] } as never);
      assert.equal(out.assessments.find((a) => a.id === f.itemId && a.coverageId === coverageId)?.calculatedAmount, f.expectedAmount);
      assert.equal(out.assessments.filter((a) => a.coverageId === unscannedCoverage).length, 0);
      assert.equal(JSON.stringify(out.composition.totalsByCurrency), baseline.totals);
    });

    // === 3. trusted server paths still work =============================
    const { __registerFileScanAdapterForTests } = await import("@/lib/scanning/adapter");
    __registerFileScanAdapterForTests({ name: "test-clean", async scanFile() { return { status: "clean" as const }; } } as never);
    process.env.MALWARE_SCANNER_PROVIDER = "test-clean";
    const { runPolicyQuarantineGate, recordPolicyScanResult } = await import("@/lib/policies/quarantine/store");
    let uploadedId = "";
    await control("policy upload through the real route (server writes the row)", async () => {
      const { POST } = await import("@/app/api/policies/upload/route");
      asUser(ownerA);
      const form = new FormData();
      form.set("file", new File([new Uint8Array(Buffer.from("%PDF-1.4\n%policy-state\n%%EOF\n", "latin1"))], "certificate.pdf", { type: "application/pdf" }));
      form.set("familyMemberId", member);
      const res = await POST(new NextRequest("http://localhost/api/policies/upload", { method: "POST", headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${householdA}` }, body: form }));
      assert.ok(res.status === 200 || res.status === 202, `${res.status} ${await res.clone().text()}`);
      uploadedId = ((await res.json()) as { policyId?: string; id?: string }).policyId ?? "";
      if (!uploadedId) uploadedId = (await pool.query<{ id: string }>(`SELECT id::text FROM policies WHERE original_filename='certificate.pdf'`)).rows[0].id;
      const row = (await pool.query(`SELECT quarantine_status, processing_status FROM policies WHERE id=$1`, [uploadedId])).rows[0] as { quarantine_status: string; processing_status: string };
      assert.notEqual(row.quarantine_status, "scan_clean", "a fresh upload is never pre-cleared");
    });
    await control("malware scan gate releases a clean upload (server)", async () => {
      const gate = await runPolicyQuarantineGate({ accountId: householdA, policyId: uploadedId, readBytes: async () => new Uint8Array(Buffer.from("%PDF-1.4\n")) });
      assert.equal(gate.cleared, true);
      assert.equal((await pool.query(`SELECT quarantine_status FROM policies WHERE id=$1`, [uploadedId])).rows[0].quarantine_status, "scan_clean");
    });
    const callbackPolicy = fixedUuid("f9800000", 3);
    await control("scan-callback result recorded by the server", async () => {
      await pool.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,quarantine_status,extracted_json)
        VALUES($1,$2,$3,'callback.pdf','k3','sha256:cb','ready','scan_pending',$4::jsonb)`, [callbackPolicy, householdA, spouse, JSON.stringify({
          insuredPeople: [{ name: "Jordan Rivera", coverages: [{ category: "Hospital Cash", amount: 100, currency: "SGD", productName: "Hospital Cash", sourcePage: 2, evidenceText: "Daily hospital cash S$100", evidenceVerified: true }] }],
          personalCoverageConfirmed: true, paymentRecords: [],
        })]);
      assert.equal(await recordPolicyScanResult({ accountId: householdA, policyId: callbackPolicy, status: "scan_clean", scanProvider: "virustotal", scanEventId: "evt-policy-1" }), "applied");
    });
    await control("reprocess route re-queues a clean document (server writes processing state)", async () => {
      const { POST } = await import("@/app/api/policies/reprocess/route");
      asUser(ownerA);
      const res = await POST(new NextRequest("http://localhost/api/policies/reprocess", { method: "POST", headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${householdA}`, "content-type": "application/json" }, body: JSON.stringify({ policyId: callbackPolicy }) }));
      assert.equal(res.status, 202, await res.clone().text());
      assert.equal((await pool.query(`SELECT processing_status FROM policies WHERE id=$1`, [callbackPolicy])).rows[0].processing_status, "queued");
      await pool.query(`UPDATE policies SET processing_status='ready' WHERE id=$1`, [callbackPolicy]);
    });
    await control("family-member linking with server-side coverage extraction (link-person route)", async () => {
      const { POST } = await import("@/app/api/policies/link-person/route");
      asUser(ownerA);
      const res = await POST(new NextRequest("http://localhost/api/policies/link-person", { method: "POST", headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${householdA}`, "content-type": "application/json" }, body: JSON.stringify({ policyId: callbackPolicy, familyMemberId: spouse, detectedName: "Jordan Rivera" }) }));
      assert.equal(res.status, 200, await res.clone().text());
      const cov = (await pool.query(`SELECT confirmed, evidence_verified FROM policy_coverages WHERE policy_id=$1 AND family_member_id=$2`, [callbackPolicy, spouse])).rows as { confirmed: boolean; evidence_verified: boolean }[];
      assert.equal(cov.length, 1); assert.equal(cov[0].confirmed, true); assert.equal(cov[0].evidence_verified, true);
      assert.equal((await confirmedOwnedCoverages(householdA, spouse)).length, 1, "the server-verified coverage counts for the linked person");
    });
    await control("linking another person does not move verified coverage to them", async () => {
      const { POST } = await import("@/app/api/policies/link-person/route");
      asUser(ownerA);
      const res = await POST(new NextRequest("http://localhost/api/policies/link-person", { method: "POST", headers: { cookie: `${ACTIVE_HOUSEHOLD_COOKIE}=${householdA}`, "content-type": "application/json" }, body: JSON.stringify({ policyId, familyMemberId: spouse, declared: true }) }));
      assert.equal(res.status, 200, await res.clone().text());
      assert.equal((await confirmedOwnedCoverages(householdA, spouse)).some((c) => c.policyId === policyId), false);
      assert.deepEqual((await confirmedOwnedCoverages(householdA, member)).map((c) => c.id).sort(), baseline.coverageIds);
    });

    // === 4b. independent read-path defence ==============================
    // Even if a coverage row somehow carried both flags, a policy that is not
    // scanned clean, or is superseded, rejected or deleted, contributes nothing.
    await control("an unscanned policy never contributes, even with both coverage flags set", async () => {
      await pool.query(`UPDATE policy_coverages SET confirmed=true, evidence_verified=true WHERE id=$1`, [unscannedCoverage]);
      await pool.query(`UPDATE policies SET processing_status='ready' WHERE id=$1`, [unscanned]);
      try {
        const s = await snapshot();
        assert.deepEqual(s.coverageIds, baseline.coverageIds, "an unscanned policy's coverage must not be a verified coverage");
        assert.equal(s.forgedItems, 0);
        assert.deepEqual(s.chunkPolicies, baseline.chunkPolicies, "chat must not cite an unscanned policy");
        assert.equal(s.amount, f.expectedAmount); assert.equal(s.totals, baseline.totals);
      } finally {
        await pool.query(`UPDATE policy_coverages SET confirmed=false, evidence_verified=false WHERE id=$1`, [unscannedCoverage]);
        await pool.query(`UPDATE policies SET processing_status='queued' WHERE id=$1`, [unscanned]);
      }
    });
    for (const [label, set, reset] of [
      ["rejected by the malware scan", `quarantine_status='scan_rejected'`, `quarantine_status='scan_clean'`],
      ["superseded by a newer version", `superseded_at=now()`, `superseded_at=NULL`],
      ["pending deletion", `lifecycle_state='pending_deletion'`, `lifecycle_state='active'`],
    ] as const) {
      await control(`a verified coverage stops counting once its policy is ${label}`, async () => {
        await pool.query(`UPDATE policies SET ${set} WHERE id=$1`, [policyId]);
        try {
          const s = await snapshot();
          assert.equal(s.coverageIds.includes(coverageId), false, "excluded from verified coverage");
          assert.equal(s.amount, undefined, "no indicative amount");
          assert.equal(s.chunkPolicies.includes(policyId), false, "not cited by chat");
        } finally { await pool.query(`UPDATE policies SET ${reset} WHERE id=$1`, [policyId]); }
      });
    }
    record(JSON.stringify(await snapshot()) === JSON.stringify(baseline), "restoring the policy restores the baseline estimate");

    // === 3b. policy deletion lifecycle through the household's RLS-scoped client
    await control("policy deletion lifecycle (coordinator, RLS-scoped) and no revival", async () => {
      const { createUserSupabaseClient } = await import("@/lib/db/authz-client");
      const { requestPolicyDocumentDeletion } = await import("@/lib/lifecycle/coordinator");
      const out = await createUserSupabaseClient(ownerA, (client) => requestPolicyDocumentDeletion({ client, accountId: householdA, actorUserId: ownerA, policyId: unscanned, reasonCategory: "user_requested", idempotencyKey: "del-unscanned" }));
      assert.equal(out.status, "accepted");
      assert.equal((await pool.query(`SELECT lifecycle_state FROM policies WHERE id=$1`, [unscanned])).rows[0].lifecycle_state, "pending_deletion");
      const revive = await attempt(identities[2], `UPDATE public.policies SET lifecycle_state='active', lifecycle_version=lifecycle_version+1 WHERE id=$1`, [unscanned]);
      assert.ok(refused(revive), `reviving a deleted policy must be refused (${revive.error || revive.rows})`);
    });

    console.log(`policy-state protection: ${matrix} browser-role matrix cells over policies/policy_coverages; ${checks} checks.`);
    if (failures.length) {
      console.error(`UNAUTHORIZED OR BROKEN PATHS (${failures.length}):\n - ${failures.join("\n - ")}`);
      process.exitCode = 1;
    } else {
      console.log(`DearPolicy policy-state protection regressions passed (${checks} checks, ${matrix} matrix cells).`);
    }
  } finally {
    delete process.env.MALWARE_SCANNER_PROVIDER;
    await h.close();
  }
  finished = true;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
