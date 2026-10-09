/**
 * V1 (r7c): `calculate` on documents the real ingestion pipeline stored (node --import tsx scripts/rag2-calc-ingested-regressions.ts).
 *
 * The household, document, link and page rows are the ones the live ingestion run stored
 * (docs/rag-migration/ingest-live/RUN-ingest-live-1-2026-10-09T13-04-18/dump-processing/dump.json -- the dump taken
 * while every upload was active), and every page text is read from extracted/*.txt (asserted equal to the stored row).
 * Nothing is hand-edited. The calls replay the live run's two failing `calculate` calls and their neighbours:
 *  R  document reference: a product / insurer name or a policy number resolves to the policy's schedule; an endorsement
 *     id calculates on the schedule; an unreadable id (another household's, pending deletion) stays refused.
 *  V  values: a value read through the schedule but printed by the endorsement is the same policy's; a value of
 *     another policy is refused; the rate in force for the stay's DATES is used (the child's revised rate from
 *     01 Jul 2026; the base rate before; an adult's rate is not changed by the endorsement's child row; a stay that
 *     spans the change is not split).
 *  D  the schedule's own counting rule (clause 4.2: each complete 24 hours, plus one more day for a remainder of 12
 *     hours or more): 14 Mar 21:40 -> 18 Mar 08:20 = 82 h 40 min = 3 days x S$120 = S$360.
 * Exit 1 if any check failed.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const RUN = path.resolve("docs/rag-migration/ingest-live/RUN-ingest-live-1-2026-10-09T13-04-18");
const ON = { DEARPOLICY_RAG_TOOLS: "1", NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv;
type Row = Record<string, unknown>;
const results: { name: string; ok: boolean }[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { results.push({ name, ok: false }); console.log("FAIL " + name + "\n     " + String(error instanceof Error ? error.message : error).split("\n").slice(0, 8).join("\n     ")); }
}

async function main() {
  const dump = JSON.parse(await readFile(path.join(RUN, "dump-processing/dump.json"), "utf8")) as { householdId: string; tables: Record<string, Row[]> };
  const T = dump.tables, ACCOUNT = dump.householdId, OTHER = "00000000-0000-4000-8000-0000000000e1";
  const policy = (file: string) => T.policies.find((p) => p.original_filename === file)!;
  const SCHED = String(policy("hx-text.pdf").id), ENDO = String(policy("hx-endorsement.pdf").id), JUNIOR = String(policy("hx-scanned.pdf").id);
  const member = (name: string) => String(T.family_members.find((m) => String(m.display_name).startsWith(name))!.id);
  const SIMON = member("Simon"), FELIX = member("Felix"), ISLA = member("Isla");
  /** The page texts as extracted (the "===== page N (method) =====" blocks), keyed by file and page. */
  const extracted = new Map<string, string>();
  for (const p of T.policies) {
    const raw = await readFile(path.join(RUN, "extracted", `${p.original_filename}.txt`), "utf8");
    const parts = raw.split(/^===== page (\d+) \((\w+)\) =====\n/m);
    for (let i = 1; i < parts.length; i += 3) extracted.set(`${p.id}|${parts[i]}`, parts[i + 2].replace(/\n+$/, ""));
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite/vector");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { pool } = await import("@/lib/db/client");
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of ["schema.sql", "chat-upgrade.sql", "benefit-catalog.sql", "model-usage.sql", "model-provenance.sql", "coverage-ledger.sql", "cover-conditions.sql", "background-jobs.sql", "household-rls.sql", "lifecycle.sql", "v11-ingestion-evidence.sql"])
    await db.exec(await readFile(path.resolve("sql/" + file), "utf8"));
  const execute = async (text: string, params: unknown[] = []) => { if (!params.length && /;\s*\S/.test(text)) { await db.exec(text); return { rows: [], rowCount: 0 }; } const r = await db.query(text, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; };
  pool.query = (async (text: string, params: unknown[] = []) => execute(text, params)) as typeof pool.query;
  pool.connect = (async () => ({ query: execute, release() {} })) as unknown as typeof pool.connect;
  /** Inserts a stored row as it is (only the columns this schema has). */
  const cols = new Map<string, Set<string>>();
  const insert = async (table: string, row: Row) => {
    if (!cols.has(table)) cols.set(table, new Set((await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name=$1", [table])).rows.map((r) => r.column_name)));
    const keys = Object.keys(row).filter((k) => cols.get(table)!.has(k) && row[k] !== undefined);
    const vals = keys.map((k) => (row[k] !== null && typeof row[k] === "object" ? JSON.stringify(row[k]) : row[k]));
    await db.query(`INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")})`, vals);
  };
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Ingested household'),($2,'Other household')", [ACCOUNT, OTHER]);
  for (const m of T.family_members) await insert("family_members", m);
  // (The dump leaves out the storage key -- an internal file location; it is not read by anything tested here.)
  for (const p of T.policies) await insert("policies", { storage_key: `dump/${p.original_filename}`, ...p });
  for (const m of T.policy_members) await insert("policy_members", m);
  for (const pg of T.policy_pages) await insert("policy_pages", { ...pg, id: undefined, text: extracted.get(`${pg.policy_id}|${pg.page_number}`) ?? null });
  // Another household holding a copy of the same schedule (its id must stay unreadable here).
  const COPY = "00000000-0000-4000-8000-0000000000c1";
  const OTHER_MEMBER = "00000000-0000-4000-8000-0000000000e2";
  await db.query("INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Other Person','self')", [OTHER_MEMBER, OTHER]);
  await insert("policies", { storage_key: "dump/copy.pdf", ...policy("hx-text.pdf"), id: COPY, account_id: OTHER, family_member_id: OTHER_MEMBER });

  const R = await import("@/lib/rag2/tools");
  const CT = await import("@/lib/rag2/calc/tool");
  const CR = await import("@/lib/claims/calc-record");
  const DC = await import("@/lib/claims/day-count");
  type Out = import("@/lib/rag2/calc/engine").CalcOutcome;
  const ctxFor = () => R.createToolContext({ accountId: ACCOUNT, asOf: "2026-10-09" });
  const sel = async (ctx: ReturnType<typeof ctxFor>, policyId: string, benefit: string, who: string, extra: Row = {}) => {
    const r = await R.runTool(ctx, "select_table_value", { policy_id: policyId, benefit, subject_id: who, want: "amount", ...extra }, ON);
    assert.ok(r.ok, JSON.stringify(r)); const d = r.data as { status: string; valueId: string; value: number };
    assert.equal(d.status, "ok", JSON.stringify(d).slice(0, 300)); return d;
  };
  const calc = async (ctx: ReturnType<typeof ctxFor>, args: Row) => {
    const r = await R.runTool(ctx, "calculate", args, ON);
    if (!r.ok) return { refused: (r as { error: string }).error } as const;
    return CT.calcOutcomes(ctx).get((r.data as { calc_id: string }).calc_id)! as Out;
  };
  const okc = (c: Awaited<ReturnType<typeof calc>>) => { assert.ok(!("refused" in c), "refused: " + JSON.stringify(c)); return c as Out; };
  const HDA = "Hospital daily allowance (per day of confinement, max 60 days per policy year)";
  const ADM = { at: "2026-03-14T21:40+08:00", words: "They admitted me at 9:40pm on 14 March" }, DIS = { at: "2026-03-18T08:20+08:00", words: "I was discharged at 8:20am on 18 March" };
  const NONE = { settled: [{ condition_id: "c_cap_prior_use", status: "established", words: "no other hospital stays this policy year" }] };
  const hc = async (policyRef: string, who: string, adm: Row, dis: Row, extra: Row = {}, selectOn = SCHED) => {
    const ctx = ctxFor(); const v = await sel(ctx, selectOn, HDA, who);
    return calc(ctx, { calculator: "hospital_cash", purpose: "claim", subject_id: who, policy_id: policyRef, benefit: HDA, rate_value_id: v.valueId, admission: adm, discharge: dis, ...extra });
  };
  const at = (iso: string) => ({ at: iso, words: "on " + iso.slice(0, 16).replace("T", " at ") });

  // ------------------------------------------------------------------------------------------------ stored rows
  await check("S1 the stored page rows are the extracted text (no hand edits)", () => {
    for (const pg of T.policy_pages) assert.equal(extracted.get(`${pg.policy_id}|${pg.page_number}`), pg.text, `page ${pg.page_number} of ${pg.policy_id}`);
  });

  // ------------------------------------------------------------------------------------------------ D: counting rule
  await check("D1 clause 4.2 (complete 24 hours, plus one day for a remainder of 12 hours or more) is read as completed_24h_remainder / 12 h", () => {
    const p2 = extracted.get(`${SCHED}|2`)!;
    const clause = p2.slice(p2.indexOf("4.2 How days"), p2.indexOf("4.3 "));
    const r = DC.dayRuleFromWording(clause);
    assert.equal(r?.rule, "completed_24h_remainder"); assert.equal(r?.remainderHours, 12);
    const para = DC.dayRuleFromWording("each period of 24 consecutive hours counts as one day, plus one more day if the remainder is 12 hours or more");
    assert.equal(para?.rule, "completed_24h_remainder"); assert.equal(para?.remainderHours, 12);
    assert.equal(DC.dayRuleFromWording("paid for every complete 24 hours in hospital")?.rule, "completed_24h", "no remainder clause: unchanged");
    assert.equal(DC.dayRuleFromWording("Any remaining period of 6 hours or more counts as a further day, after each complete period of 24 hours.")?.remainderHours, 6);
    assert.equal(DC.dayRuleFromWording("Any remaining period of 12 hours or more counts as one further day."), null, "a remainder clause alone is not a rule");
  });
  await check("D2 day counts under completed_24h_remainder (12 h): boundaries, minimum, offsets", () => {
    const n = (a: string, b: string, h = 12) => { const r = DC.payableDaysUnderRule("completed_24h_remainder", a, b, [], { remainderHours: h }); return r.status === "calculated" ? r.grossNights : r.reasonCode; };
    const A = "2026-03-14T21:40+08:00", plus = (min: number) => new Date(Date.parse(A) + min * 60_000).toISOString().replace(/\.000Z$/, "Z");
    assert.equal(n(A, "2026-03-18T08:20+08:00"), 3, "82h40m: 3 days, 10h40m remainder disregarded");
    assert.equal(n(A, plus(84 * 60)), 4, "84h: a remainder of exactly 12 h counts");
    assert.equal(n(A, plus(84 * 60 - 1)), 3);
    assert.equal(n(A, plus(12 * 60 - 1)), 0, "under 12 hours in total: not payable");
    assert.equal(n(A, plus(12 * 60)), 1);
    assert.equal(n(A, plus(24 * 60)), 1);
    assert.equal(n(A, plus(36 * 60)), 2);
    assert.equal(n(A, plus(6 * 60), 6), 1, "a 6-hour remainder rule");
    assert.equal(n("2026-03-14T21:40", "2026-03-18T08:20+08:00"), "MISSING_TIMEZONE_OFFSET");
    assert.equal(n("2026-03-18T08:20+08:00", A), "INVALID_DATE_RANGE");
    assert.equal(DC.dayRuleNeedsTimes("completed_24h_remainder"), true);
  });

  // ------------------------------------------------------------------------------------------------ V / R: the live calls
  await check("V1 live call 2 replayed: the value read through the schedule (printed by the endorsement) is accepted; Simon's stay = 3 x S$120 = S$360 under clause 4.2", async () => {
    const c = okc(await hc(SCHED, SIMON, ADM, DIS, NONE));
    assert.equal(c.amount, 360, JSON.stringify({ kind: c.kind, req: c.requirements, steps: c.steps }));
    assert.equal(c.kind, "indicative_estimate");
    const rec = c.record!;
    const dc = rec.steps.find((s) => s.op === "day_count")!;
    assert.ok(dc.op === "day_count" && dc.rule === "completed_24h_remainder" && dc.remainderHours === 12 && dc.out === 3, JSON.stringify(dc));
    const rate = rec.operands.find((o) => o.id === "rate")!;
    assert.equal(rate.value, 120); assert.equal(rate.source === "document" && rate.binding.policyId, SCHED, "the schedule's rate (the endorsement is not in force in March)");
    assert.equal(rec.policyId, SCHED);
    assert.ok(CR.recomputeCalculation(rec).ok, "the record re-runs");
    assert.ok(c.conditions.some((x) => x.kind === "day_count_rule" && x.status === "established" && /24 consecutive hours/.test(x.text) && /12 hours or more/.test(x.text)), "the schedule's own counting clause");
  });
  await check("V2 the live call's exact arguments (no settled facts) no longer fail with 'from another document'", async () => {
    const c = await hc(SCHED, SIMON, ADM, DIS);
    assert.ok(!("refused" in c), JSON.stringify(c));
  });
  await check("R1 policy_id = the endorsement's id: calculated on the policy's schedule (its counting rule), same S$360", async () => {
    const c = okc(await hc(ENDO, SIMON, ADM, DIS, NONE));
    assert.equal(c.policyId, SCHED); assert.equal(c.amount, 360);
  });
  await check("R2 live call 1 replayed: policy_id 'Meridian' (an insurer name) resolves to the SafeStay schedule; the policy number does too", async () => {
    const ctx = ctxFor();
    const live = await calc(ctx, { benefit: "Fractured bones (per Accident) — Simple (closed) fracture", purpose: "claim", settled: [{ words: "The doctor said it's a closed fracture, the X-ray confirmed it, and the bone didn't come through the skin.", status: "established", condition_id: "fracture_confirmation" }], condition: "closed wrist fracture confirmed by X-ray and certified in writing by a registered medical practitioner", policy_id: "Meridian", calculator: "lump_sum", subject_id: FELIX });
    assert.ok("refused" in live && !/not one of this household's readable documents/.test(live.refused) && /sum_insured_value_id/.test(live.refused), JSON.stringify(live));
    const v = await sel(ctx, SCHED, "Fractured bones (per Accident) — Simple (closed) fracture", FELIX, { tier: "Child" });
    assert.equal(v.value, 600);
    for (const ref of ["Meridian", "MHA-HC-2025-0748213", "SafeStay Family Hospital Cash"]) {
      const c = okc(await calc(ctx, { calculator: "lump_sum", purpose: "claim", subject_id: FELIX, policy_id: ref, benefit: "Fractured bones (per Accident) — Simple (closed) fracture", sum_insured_value_id: v.valueId, condition: "closed wrist fracture" }));
      assert.equal(c.policyId, SCHED, ref); assert.equal(c.printed[0].value, 600, ref);
    }
  });
  await check("R3 protections: another household's document id, an unknown name, and a document pending deletion stay unreadable", async () => {
    const ctx = ctxFor();
    const other = await calc(ctx, { calculator: "hospital_cash", purpose: "claim", subject_id: SIMON, policy_id: COPY, benefit: HDA });
    assert.ok("refused" in other && /not one of this household's readable documents/.test(other.refused), JSON.stringify(other));
    assert.ok(!("refused" in other && other.refused.includes(COPY + " (")), "the other household's document is not listed");
    const unknown = await calc(ctx, { calculator: "hospital_cash", purpose: "claim", subject_id: SIMON, policy_id: "Aurora Life", benefit: HDA });
    assert.ok("refused" in unknown && /policy_id must be a document id/.test(unknown.refused) && unknown.refused.includes(SCHED), JSON.stringify(unknown));
    const v = await sel(ctx, SCHED, HDA, SIMON);
    await db.query("UPDATE policies SET lifecycle_state='pending_deletion' WHERE id=$1", [SCHED]);
    try {
      const gone = await calc(ctx, { calculator: "hospital_cash", purpose: "claim", subject_id: SIMON, policy_id: SCHED, benefit: HDA, rate_value_id: v.valueId, admission: ADM, discharge: DIS });
      assert.ok("refused" in gone && /not one of this household's readable documents/.test(gone.refused), JSON.stringify(gone));
    } finally { await db.query("UPDATE policies SET lifecycle_state='active' WHERE id=$1", [SCHED]); }
  });
  await check("V3 a value of a genuinely different policy (JuniorShield, Isla) is refused for SafeStay", async () => {
    const ctx = ctxFor(); const v = await sel(ctx, JUNIOR, "Daily hospital income", ISLA);
    const c = await calc(ctx, { calculator: "hospital_cash", purpose: "claim", subject_id: ISLA, policy_id: SCHED, benefit: HDA, rate_value_id: v.valueId, admission: ADM, discharge: DIS });
    assert.ok("refused" in c && /another policy/.test(c.refused), JSON.stringify(c));
  });
  await check("V4 the rate in force for the dates: Felix 3 days in August = 3 x S$110 (endorsement, from 01 Jul 2026); in March = 3 x S$80; spanning 01 Jul -> not split", async () => {
    const aug = okc(await hc(SCHED, FELIX, at("2026-08-03T10:00+08:00"), at("2026-08-06T10:00+08:00"), NONE));
    assert.equal(aug.amount, 330, JSON.stringify({ kind: aug.kind, steps: aug.steps, req: aug.requirements }));
    const r = aug.record!.operands.find((o) => o.id === "rate")!;
    assert.ok(r.source === "document" && r.binding.policyId === ENDO && r.value === 110, JSON.stringify(r));
    assert.ok(CR.recomputeCalculation(aug.record!).ok);
    const mar = okc(await hc(SCHED, FELIX, at("2026-03-03T10:00+08:00"), at("2026-03-06T10:00+08:00"), NONE));
    assert.equal(mar.amount, 240);
    const span = await hc(SCHED, FELIX, at("2026-06-29T10:00+08:00"), at("2026-07-02T10:00+08:00"), NONE);
    assert.ok("refused" in span && /changes during the stay/.test(span.refused) && /2026-07-01/.test(span.refused), JSON.stringify(span));
  });
  await check("V5 an adult's rate is not changed by the endorsement's child row: Simon 3 days in August = 3 x S$120", async () => {
    const c = okc(await hc(SCHED, SIMON, at("2026-08-03T10:00+08:00"), at("2026-08-06T10:00+08:00"), NONE));
    assert.equal(c.amount, 360, JSON.stringify(c.steps));
    const r = c.record!.operands.find((o) => o.id === "rate")!;
    assert.ok(r.source === "document" && r.binding.policyId === SCHED, JSON.stringify(r));
  });

  // ------------------------------------------------------------------------------------------------ save-time gate
  // Integration (r7): the gate re-checks these records -- the remainder rule's hours against the cited wording, and an
  // endorsement's in-force rate on a record of the policy it amends (same policy number); another policy is refused.
  const V = await import("@/lib/chat/answer-verification");
  type Rec = import("@/types").CalculationRecord;
  const gateOf = async (rec: Omit<Rec, "sentence">, sentence: string, user: string) => V.verifyAnswerFigures({ mode: "answer", summary: sentence, details: [], claimItems: [], nextSteps: [], confidence: null, citations: [], disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [], calculations: [{ ...rec, sentence }] } as unknown as import("@/types").ChatAnswer, { accountId: ACCOUNT, userText: user });
  // The processing dump leaves file_hash out; the gate needs each document's version. The run's own stored bindings
  // (dump-final) carry it, as scripts/rag2-ingested-gate-regressions.ts reads them.
  const finalDump = await readFile(path.join(RUN, "dump-final/dump.json"), "utf8");
  for (const m of finalDump.match(/"policyId":\s*"[0-9a-f-]{36}"[^{}]*?"documentHash":\s*"[0-9a-f]{64}"/g) ?? []) {
    const pid = m.match(/"policyId":\s*"([0-9a-f-]{36})"/)![1], h = m.match(/"documentHash":\s*"([0-9a-f]{64})"/)![1];
    await db.query("UPDATE policies SET file_hash=$1 WHERE id=$2 AND file_hash IS NULL", [h, pid]);
  }
  for (const id of [SCHED, ENDO, JUNIOR]) assert.ok((await db.query<{ h: string | null }>("SELECT file_hash AS h FROM policies WHERE id=$1", [id])).rows[0]?.h, "a stored version hash for " + id);
  const SIMON_USER = `${ADM.words} and ${DIS.words}. No other hospital stays this policy year.`;
  await check("G1 gate: Simon's S$360 under clause 4.2 is kept; a tampered remainderHours (6 h, re-run consistently to 4 days = S$480) is rejected", async () => {
    const c = okc(await hc(SCHED, SIMON, ADM, DIS, NONE));
    const sentence = "Indicative estimate: SafeStay hospital daily allowance of S$120 per day for 3 days comes to S$360.";
    const ok = await gateOf(c.record!, sentence, SIMON_USER);
    assert.deepEqual(ok.map((p) => p.reason), [], "the record as calculated passes");
    const t = structuredClone(c.record!) as Omit<Rec, "sentence">;
    const dc = t.steps.find((s) => s.op === "day_count")!; if (dc.op === "day_count") { dc.remainderHours = 6; dc.out = 4; }
    for (const s of t.steps) if (s.op === "min_count") s.out = 4;
    const mul = t.steps.find((s) => s.op === "multiply")!; mul.out = 48000; t.result = { ...t.result, value: 480 };
    assert.ok(CR.recomputeCalculation(t).ok, "the tampered record is self-consistent: only the wording can catch it");
    const bad = await gateOf(t, "Indicative estimate: SafeStay hospital daily allowance of S$120 per day for 4 days comes to S$480.", SIMON_USER);
    assert.ok(bad.some((p) => /remaining part from another number of hours/.test(p.reason)), JSON.stringify(bad.map((p) => p.reason)));
  });
  await check("G2 gate: Felix's August S$330 (the endorsement's in-force S$110 on the schedule's record) is kept; the same rate bound to another policy is refused", async () => {
    const aug = okc(await hc(SCHED, FELIX, at("2026-08-03T10:00+08:00"), at("2026-08-06T10:00+08:00"), NONE));
    const user = "Felix was admitted on 2026-08-03 at 10:00 and discharged on 2026-08-06 at 10:00. No other hospital stays this policy year.";
    const sentence = "Indicative estimate: SafeStay hospital daily allowance of S$110 per day for 3 days comes to S$330.";
    const ok = await gateOf(aug.record!, sentence, user);
    assert.deepEqual(ok.map((p) => p.reason), [], "the endorsement's rate serves the policy it amends");
    const t = structuredClone(aug.record!) as Omit<Rec, "sentence">;
    const rate = t.operands.find((o) => o.id === "rate")!;
    if (rate.source === "document") rate.binding = { ...rate.binding, policyId: JUNIOR };
    const bad = await gateOf(t, sentence, user);
    assert.ok(bad.some((p) => /bound to another document than the calculation/.test(p.reason)), JSON.stringify(bad.map((p) => p.reason)));
  });
  await check("G3 V3's report: select_table_value with tier 'Adult' for Simon never returns the endorsement's child-only revised S$110", async () => {
    for (const policyId of [SCHED, ENDO]) {
      const ctx = ctxFor();
      const r = await R.runTool(ctx, "select_table_value", { policy_id: policyId, benefit: HDA, subject_id: SIMON, want: "amount", tier: "Adult", as_of: "2026-08-04" }, ON);
      const d = (r.ok ? r.data : {}) as { status?: string; value?: number };
      assert.ok(!(d.status === "ok" && d.value === 110), `${policyId === ENDO ? "endorsement" : "schedule"}: ${JSON.stringify(d).slice(0, 300)}`);
      if (d.status === "ok") assert.equal(d.value, 120, "the adult's own rate");
    }
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nrag2:calc-ingested-test ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
