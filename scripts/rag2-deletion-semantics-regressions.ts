/**
 * Round 8: what deleting an uploaded amendment document means (node --import tsx scripts/rag2-deletion-semantics-regressions.ts).
 *
 * Deleting an uploaded endorsement does not mean the insurer reversed it. Built from the live run's OWN stored rows
 * (docs/rag-migration/ingest-live/RUN-ingest-live-2-*: dump-final -- the endorsement S$80 -> S$110 was deleted before
 * D1) plus synthetic households with a different, space-aligned layout. Four cases:
 *  (a) an amendment of the policy was deleted -> tools flag the policy (role, policy number, removal date, effective
 *      date when known -- metadata only, never its text); the gate rejects a schedule figure presented as current cover
 *      without that limitation, and "no recorded amendments";
 *  (b) an unrelated document was deleted -> no effect;
 *  (c) the amendment was replaced by a newer valid one -> the newer one applies, no caveat;
 *  (d) a remaining document states the change was reversed / cancelled -> reversal, no caveat.
 * Also: saved answers that relied on the deleted document are served as out of date; deleted text never appears in
 * any tool result or evidence. Positive and negative checks; exit 1 on a failure.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 8).join("\n     ")); }
}
const SQL = ["schema.sql", "chat-upgrade.sql", "benefit-catalog.sql", "model-usage.sql", "model-provenance.sql", "coverage-ledger.sql", "cover-conditions.sql", "background-jobs.sql", "household-rls.sql", "lifecycle.sql", "v11-ingestion-evidence.sql"];
const ROOT = path.resolve("docs/rag-migration/ingest-live");
const RUN_DIR = path.join(ROOT, readdirSync(ROOT).filter((d) => d.startsWith("RUN-ingest-live-2-")).sort()[0]);
type Row = Record<string, unknown>;
const dump = JSON.parse(readFileSync(path.join(RUN_DIR, "dump-final/dump.json"), "utf8")) as { tables: Record<string, Row[]> };
const T = dump.tables;
const iso = (v: unknown) => (v == null ? null : String(v).slice(0, 10));
const hashes = new Map<string, string>();
for (const m of (JSON.stringify(dump).match(/"policyId":\s*"[0-9a-f-]{36}"[^{}]*?"documentHash":\s*"[0-9a-f]{64}"/g) ?? [])) hashes.set(m.match(/"policyId":\s*"([0-9a-f-]{36})"/)![1], m.match(/"documentHash":\s*"([0-9a-f]{64})"/)![1]);
const ACCOUNT = String(T.policies[0].account_id);
const member = (re: RegExp) => T.family_members.find((m) => re.test(String(m.display_name)))! as { id: string };
const doc = (role: string) => T.policies.find((p) => p.document_role === role)! as { id: string; lifecycle_state: string };
type Binding = import("@/types").BoundFigure;
const answers = T.chat_messages.filter((m) => m.role === "assistant").map((m) => (typeof m.answer_json === "string" ? JSON.parse(m.answer_json as string) : m.answer_json) as import("@/types").ChatAnswer);
const ENDT = doc("endorsement"), SCHED = doc("personal_schedule");
const ENDT_TEXT = String(T.policy_pages.find((p) => p.policy_id === ENDT.id)!.text);
/** Strings only the deleted endorsement prints (never to appear in any tool result or evidence). */
const DELETED_MARKS = ["S$110", ...(ENDT_TEXT.match(/\bME-\d{2}-\d{3,}\b/g) ?? []), "Revised"];

// ---- synthetic households (invented; space-aligned layout) ------------------------------------------------------
const acct = (n: number) => `7b200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sid = (n: number) => `7b210000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sp = (cells: string[]) => cells.map((c, i) => (i < cells.length - 1 ? c.padEnd(40) : c)).join("");
type SDoc = { id: string; account: string; product: string; number: string; role: string; state: string; eff: string | null; created: string; supersedes?: string; superseded?: boolean; page: string };
const X = acct(1), Y = acct(2), Z = acct(3), W = acct(4);
const OWNER: Record<string, string> = { [X]: sid(1), [Y]: sid(2), [Z]: sid(3), [W]: sid(4) };
const base = (id: string, account: string, number: string, ward: string) => ({ id, account, product: "Orchid Shield Hospital Plan", number, role: "schedule", state: "active", eff: "2026-01-01", created: "2026-01-02T00:00:00Z",
  page: ["Orchid Mutual (fictional) - Orchid Shield Hospital Plan - Schedule", `Policy no. ${number}`, "", sp(["Benefit", "Amount"]), sp(["Ward allowance (per day)", ward]), sp(["Surgical limit (per operation)", "S$8,000"])].join("\n") });
const endt = (id: string, account: string, number: string, state: string, eff: string, from: string, to: string, created: string, extra: Partial<SDoc> = {}): SDoc => ({ id, account, product: "Orchid Shield Hospital Plan - Endorsement", number, role: "endorsement", state, eff, created,
  page: [`Endorsement to policy ${number}`, `Effective date: ${eff}`, "", sp(["Benefit", "Before", "After"]).replace(/ +After/, "      After"), ["Ward allowance (per day)".padEnd(40), from.padEnd(14), to].join("")].join("\n"), ...extra });
const SDOCS: SDoc[] = [
  // (a) with a known effective date: amendment of 1 Aug 2026 deleted.
  base(sid(101), X, "OS-HP-55120", "S$200"), endt(sid(102), X, "OS-HP-55120", "soft_deleted", "2026-08-01", "S$200", "S$260", "2026-08-02T00:00:00Z"),
  // (b) an unrelated document deleted (another policy's schedule).
  base(sid(201), Y, "OS-HP-66001", "S$180"), { ...base(sid(202), Y, "OS-TR-90002", "S$999"), product: "Orchid Travel Plan", state: "soft_deleted" },
  // (c) replaced: E1 superseded by E2 (supersedes link); an older deleted E0 with a newer live amendment.
  base(sid(301), Z, "OS-HP-77003", "S$150"),
  endt(sid(302), Z, "OS-HP-77003", "active", "2026-03-01", "S$150", "S$170", "2026-03-02T00:00:00Z", { superseded: true }),
  endt(sid(303), Z, "OS-HP-77003", "active", "2026-06-01", "S$150", "S$190", "2026-06-02T00:00:00Z", { supersedes: sid(302) }),
  endt(sid(304), Z, "OS-HP-77003", "soft_deleted", "2026-02-01", "S$150", "S$160", "2026-02-02T00:00:00Z"),
  // (d) reversal printed by a remaining document.
  base(sid(401), W, "OS-HP-88004", "S$210"), endt(sid(402), W, "OS-HP-88004", "soft_deleted", "2026-04-01", "S$210", "S$240", "2026-04-02T00:00:00Z"),
  { id: sid(403), account: W, product: "Orchid Shield Hospital Plan - Policy Services letter", number: "OS-HP-88004", role: "correspondence", state: "active", eff: "2026-07-01", created: "2026-07-02T00:00:00Z",
    page: ["Orchid Mutual (fictional) - Policy Services", "Policy no. OS-HP-88004", "At your request, the endorsement dated 1 April 2026 is hereby cancelled with effect from 1 July 2026. All benefits revert to the schedule as issued."].join("\n") },
];

async function main() {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite/vector");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { pool } = await import("@/lib/db/client");
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of SQL) await db.exec(await readFile(path.resolve("sql/" + file), "utf8"));
  const execute = async (text: string, params: unknown[] = []) => { if (!params.length && /;\s*\S/.test(text)) { await db.exec(text); return { rows: [], rowCount: 0 }; } const r = await db.query(text, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; };
  pool.query = (async (text: string, params: unknown[] = []) => execute(text, params)) as typeof pool.query;
  pool.connect = (async () => ({ query: execute, release() {} })) as unknown as typeof pool.connect;
  globalThis.fetch = (async () => { throw new Error("network disabled in rag2-deletion"); }) as typeof fetch;
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'run household')", [ACCOUNT]);
  for (const a of [X, Y, Z, W]) await db.query("INSERT INTO accounts(id,name) VALUES($1,'synthetic')", [a]);
  for (const m of T.family_members) await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship,notes,date_of_birth) VALUES($1,$2,$3,$4,$5,$6,$7)", [m.id, ACCOUNT, m.display_name, m.preferred_name, m.relationship, m.notes, iso(m.date_of_birth)]);
  // The run's rows as stored -- the deleted endorsement stays pending_deletion with its stored page (what the database
  // held when D1 was asked); nothing may surface from it.
  for (const p of T.policies) await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,file_hash,effective_date,renewal_or_expiry_date,document_date,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ready',$10,$10,$11,$12,$13,$14,$15,$16,$17,$18)`, [p.id, ACCOUNT, p.family_member_id, p.insurer, p.product_name, p.policy_number, p.policy_type, p.document_role, !!p.personal_coverage_confirmed, p.original_filename, p.quarantine_status, p.lifecycle_state, hashes.get(String(p.id)) ?? `h-${p.id}`, iso(p.effective_date), iso(p.renewal_or_expiry_date), iso(p.document_date), p.created_at, p.updated_at]);
  for (const m of T.policy_members) await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence,benefit_tier) VALUES($1,$2,$3,$4,$5,$6)", [m.policy_id, m.family_member_id, ACCOUNT, m.source ?? "test", m.confidence ?? 1, m.benefit_tier ?? null]);
  for (const pg of T.policy_pages) await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [ACCOUNT, pg.policy_id, pg.page_number, pg.text]);
  for (const [a, o] of Object.entries(OWNER)) await db.query("INSERT INTO family_members(id,account_id,display_name,relationship,date_of_birth) VALUES($1,$2,'Mira Tan','self','1980-01-01')", [o, a]);
  for (const d of SDOCS) {
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,file_hash,effective_date,renewal_or_expiry_date,created_at,updated_at,supersedes_id,superseded_at)
      VALUES($1,$2,$3,'Orchid Mutual',$4,$5,'hospital',$6,true,'ready',$7,$7,'scan_clean',$8,$9,$10,'2026-12-31',$11,$12,$13,$14)`, [d.id, d.account, OWNER[d.account], d.product, d.number, d.role, d.id + ".pdf", d.state, "h-" + d.id, d.eff, d.created, d.state === "active" ? d.created : "2026-09-30T10:00:00Z", d.supersedes ?? null, d.superseded ? "2026-06-02T00:00:00Z" : null]);
    await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$3,'test',1)", [d.id, OWNER[d.account], d.account]);
    await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [d.account, d.id, d.page]);
  }

  const Tb = await import("@/lib/rag2/tables");
  const { policiesFor } = await import("@/lib/rag2/policies");
  const { searchPassages } = await import("@/lib/rag2/search");
  const { toFigureBinding } = await import("@/lib/rag2/evidence");
  const { verifyAnswerFigures, FIGURE_LEFT_OUT_NOTE } = await import("@/lib/chat/answer-verification");
  const { invalidateAnswersWithDeletedPolicies } = await import("@/lib/chat/stale-answers");
  type Ans = import("@/types").ChatAnswer;
  const isla = member(/^Isla/), felix = member(/^Felix/);
  const mkAnswer = (summary: string, figureBindings: Binding[], account: string, citations: string[] = []): Ans => ({ mode: "answer", summary, details: [], claimItems: [], nextSteps: [], confidence: null, citations: [...new Set([...figureBindings.map((b) => b.policyId), ...citations])].map((policyId) => ({ chunkId: "c", policyId, policyName: "x", pageStart: 1, pageEnd: 1 })), disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [], figureBindings, accountHint: account } as unknown as Ans);
  const gate = async (label: string, account: string, text: string, bs: Omit<Binding, "sentence">[], expect: "accepted" | "rejected", reason?: RegExp, userText = "what does the policy pay now?", citations: string[] = []) => {
    const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z“"(])/);
    const a = mkAnswer(text, bs.map((b) => ({ ...b, sentence: sentences.find((s) => s.includes("S$" + b.value.toLocaleString("en-US"))) ?? text } as Binding)), account, citations);
    const problems = await verifyAnswerFigures(a, { accountId: account, userText });
    if (expect === "accepted") assert.deepEqual(problems.map((p) => `${p.figure}: ${p.reason}`), [], label);
    else { assert.ok(problems.length >= 1, `${label}: accepted`); if (reason) assert.match(problems.map((p) => p.reason).join(" | "), reason, label); }
  };
  const noDeletedText = (label: string, v: unknown) => { const j = JSON.stringify(v); for (const m of DELETED_MARKS) assert.ok(!j.includes(m), `${label}: deleted text “${m}” surfaced`); assert.ok(!j.includes(`"policyId":"${ENDT.id}","documentHash"`), `${label}: evidence on the deleted document`); };
  const sel = async (account: string, policyId: string, who: string, benefit: string, asOf = "2026-10-09") => Tb.selectTableValue({ accountId: account, policyId, benefit, subject: { memberId: who }, asOf });

  // =========================================================================== (a) the live run
  const d1 = answers[answers.length - 1];
  await check("A1 tools flag the policy whose endorsement was deleted -- metadata only, no deleted text", async () => {
    const r = await sel(ACCOUNT, SCHED.id, isla.id, "hospital daily allowance");
    assert.equal(r.status, "ok"); if (r.status !== "ok") return;
    assert.equal(r.value, 80);
    const f = r.removedAmendments?.[0];
    assert.ok(f && f.kind === "amendment_removed", JSON.stringify(r.removedAmendments));
    if (f?.kind === "amendment_removed") { assert.equal(f.documentRole, "endorsement"); assert.equal(f.policyNumber, String(T.policies.find((p) => p.id === ENDT.id)!.policy_number)); assert.equal(f.removal, "deleted"); assert.ok(f.removedOn); assert.ok(!/no recorded amendments/i.test(f.note)); }
    noDeletedText("select_table_value", r);
    const pf = await policiesFor({ accountId: ACCOUNT, subjectId: isla.id, topic: "hospital", asOf: "2026-10-09" });
    const safe = pf.covering.find((c) => c.policyId === SCHED.id)!;
    assert.ok(safe.version.removedAmendments?.length, "policies_for flag");
    assert.match(safe.version.current, /removed from the library.*may differ/);
    noDeletedText("policies_for", pf);
    const s = await searchPassages({ accountId: ACCOUNT, query: "endorsement hospital daily allowance revised existing child", k: 20 });
    assert.ok(!s.hits.some((h) => h.evidence.policyId === ENDT.id), "a hit on the deleted document");
    assert.ok(s.removedAmendments?.some((x) => x.policyId === SCHED.id), "search flag");
    noDeletedText("search_passages", s);
  });
  await check("A2 the gate rejects D1 as saved: S$80 presented as current, and \"no recorded amendments\"", async () => {
    const b80 = (d1.figureBindings ?? []).find((b) => b.value === 80)!;
    assert.ok(b80, "stored S$80 binding");
    const a = { ...d1, figureBindings: [b80], details: [], summary: b80.sentence } as Ans;
    const problems = await verifyAnswerFigures(a, { accountId: ACCOUNT, userText: "Did that endorsement letter change anything? How much is the daily hospital allowance for the kids now?" });
    assert.match(problems.map((p) => p.reason).join(" | "), /removed from the library/);
    assert.ok(a.summary.includes(FIGURE_LEFT_OUT_NOTE) || !a.summary.includes(b80.sentence));
    await gate("no recorded amendments, no figure", ACCOUNT, "The current documents I can see show no recorded amendments to the SafeStay plan.", [], "rejected", /does not establish/, "did it change?", [SCHED.id]);
  });
  await check("A3 the remaining schedule's figure passes with the limitation stated (same or previous sentence)", async () => {
    const r = await sel(ACCOUNT, SCHED.id, isla.id, "hospital daily allowance");
    if (r.status !== "ok") throw new Error("not ok");
    const b = { ...toFigureBinding({ ...r.evidence, subjectId: isla.id }, r.rowLabel, 80, "SGD")!, value: 80, currency: "SGD" };
    await gate("same sentence", ACCOUNT, "The remaining SafeStay schedule lists S$80 per day for Isla's hospital daily allowance, but an amendment document for this policy was removed from the library, so the current amount may differ.", [b], "accepted");
    await gate("previous sentence", ACCOUNT, "An amendment document for the SafeStay policy was removed from your library, so I can't confirm the current amount. The remaining schedule lists Isla's hospital daily allowance as S$80 per day.", [b], "accepted");
    await gate("without the limitation", ACCOUNT, "Isla's hospital daily allowance is S$80 per day.", [b], "rejected", /not confirmed current cover/);
    const f = await sel(ACCOUNT, SCHED.id, felix.id, "hospital daily allowance");
    if (f.status !== "ok") throw new Error("not ok");
    await gate("another benefit of the same policy, plain", ACCOUNT, "Felix's simple fracture benefit is S$600.", [{ ...toFigureBinding({ ...(await sel(ACCOUNT, SCHED.id, felix.id, "simple fracture") as { evidence: import("@/lib/rag2/evidence").EvidenceRef }).evidence, subjectId: felix.id }, "Fractured bones (per Accident) — Simple (closed) fracture", 600, "SGD")!, value: 600, currency: "SGD" }], "rejected", /removed from the library/);
  });
  await check("A4 a figure from another policy of the household is unaffected (JuniorShield)", async () => {
    const b150 = (d1.figureBindings ?? []).find((b) => b.value === 150)!;
    await gate("JuniorShield S$150", ACCOUNT, b150.sentence, [b150], "accepted");
  });
  await check("A5 saved conclusions that relied on the deleted endorsement are served as out of date; others are not", async () => {
    const out = await invalidateAnswersWithDeletedPolicies(ACCOUNT, answers);
    const relied = answers.map((a, i) => ({ a, o: out[i] })).filter(({ a }) => (a.citations ?? []).some((c) => c.policyId === ENDT.id));
    assert.ok(relied.length >= 1, "no saved answer cited the endorsement");
    for (const { o } of relied) { assert.ok((o as Ans).invalidated, "not invalidated"); assert.equal((o as Ans).figureBindings?.length ?? 0, (o as Ans).figureBindings?.length ?? 0); noDeletedText("invalidated answer body", { s: (o as Ans).summary, d: (o as Ans).details, c: (o as Ans).citations }); }
    const kept = answers.map((a, i) => ({ a, o: out[i] })).filter(({ a }) => !(a.citations ?? []).some((c) => c.policyId === ENDT.id));
    for (const { o } of kept) assert.ok(!(o as Ans).invalidated, "an answer that did not rely on it was invalidated");
  });

  // =========================================================================== synthetic layouts
  const sb = async (account: string, policyId: string, benefit: string, value: number, asOf = "2026-10-09") => {
    const r = await sel(account, policyId, OWNER[account], benefit, asOf);
    assert.equal(r.status, "ok", JSON.stringify(r).slice(0, 300)); if (r.status !== "ok") throw new Error("x");
    assert.equal(r.value, value, `${benefit}: ${r.value}`);
    return { r, b: { ...toFigureBinding({ ...r.evidence, subjectId: OWNER[account] }, r.rowLabel, value, "SGD")!, value, currency: "SGD" } };
  };
  await check("S1 (a) synthetic: a deleted amendment with a known effective date -- current figure needs the limitation; an earlier date does not", async () => {
    const { r, b } = await sb(X, sid(101), "ward allowance", 200);
    assert.equal(r.removedAmendments?.[0]?.kind, "amendment_removed");
    if (r.removedAmendments?.[0]?.kind === "amendment_removed") assert.equal(r.removedAmendments[0].effectiveDate, "2026-08-01");
    noDeletedText("synthetic select", r); assert.ok(!JSON.stringify(r).includes("S$260"));
    await gate("current, plain", X, "Your ward allowance is S$200 per day.", [b], "rejected", /removed from the library/);
    await gate("current, with limitation", X, "The schedule lists a ward allowance of S$200 per day; an endorsement for this policy was deleted from your documents, so the current amount may differ.", [b], "accepted");
    await gate("before the amendment took effect", X, "On 15 March 2026 your ward allowance was S$200 per day.", [b], "accepted");
    const before = await sel(X, sid(101), OWNER[X], "ward allowance", "2026-05-01");
    assert.ok(before.status === "ok" && !before.removedAmendments?.length, "flag before the amendment's effective date");
  });
  await check("S2 (b) an unrelated document deleted has no effect", async () => {
    const { r, b } = await sb(Y, sid(201), "ward allowance", 180);
    assert.ok(!r.removedAmendments?.length);
    await gate("plain", Y, "Your ward allowance is S$180 per day.", [b], "accepted");
  });
  await check("S3 (c) replaced by a newer valid amendment: the newer one applies, no caveat", async () => {
    const { r, b } = await sb(Z, sid(301), "ward allowance", 190);
    assert.ok(!r.removedAmendments?.length, JSON.stringify(r.removedAmendments));
    await gate("amended, plain", Z, "Your ward allowance is now S$190 per day.", [b], "accepted");
    const pf = await policiesFor({ accountId: Z, subjectId: OWNER[Z], asOf: "2026-10-09" });
    assert.ok(!pf.covering[0]?.version.removedAmendments?.length);
  });
  await check("S4 (d) a remaining document states the change was cancelled: reversal, no caveat", async () => {
    const { r, b } = await sb(W, sid(401), "ward allowance", 210);
    assert.ok(!r.removedAmendments?.length);
    const pf = await policiesFor({ accountId: W, subjectId: OWNER[W], asOf: "2026-10-09" });
    const v = pf.covering.find((c) => c.policyId === sid(401))!.version;
    assert.equal(v.removedAmendments?.[0]?.kind, "amendment_reversed", JSON.stringify(v));
    assert.match(v.current, /reversed/);
    await gate("plain", W, "Your ward allowance is S$210 per day.", [b], "accepted");
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nrag2:deletion-semantics-test ${results.length - failed.length}/${results.length} passed`);
  await db.close();
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
