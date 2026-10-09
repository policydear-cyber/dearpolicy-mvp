/**
 * A1 (r6): rate units and caps, and cached tokens in usage accounting (node --import tsx scripts/rag2-units-regressions.ts).
 *
 * PGlite with the real schema and this suite's own synthetic household (every insurer, product, person and number is
 * invented; the wordings differ from the other suites').
 *  P  value terms (lib/rag2/value-terms.ts): a rate, its unit, its duration rule and each cap with its own reset
 *     period and source span -- "each complete 24 hours, max 90 per year" is a per-period rate plus a 90-period annual
 *     cap; reordered / equivalent wordings read the same; a genuinely annual benefit stays annual.
 *  H  hospital cash through the calculate tool: the cap's earlier use within its reset period is settled by the
 *     household (words or a figure), stated as an assumption in a what-if, or left unresolved with the specific fact;
 *     a per-admission cap never asks; a daily rate with an annual monetary cap; exactly at / one over the cap; prior use
 *     known vs unknown; annual benefits refused as per-day rates.
 *  R  the record carries the unit terms with page spans, and checkUnitTerms rejects a tampered record.
 *  C  cached input tokens: read from OpenAI / Anthropic replies, priced at the cached rate (full input price when none
 *     is on file), recorded in model_executions and model_usage; the reservation stays separate from the actual cost.
 * Exit 1 if any check failed.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

function row(cells: string[], widths: number[]): string {
  return cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(Math.max(widths[i] ?? 0, c.length + 3)))).join("").replace(/\s+$/, "");
}
const ACCOUNT = "00000000-0000-0000-0000-00000000a101";
const pid = (n: number) => "a1000000-0000-4000-8000-" + String(n).padStart(12, "0");
const M = { ana: { id: pid(1), name: "Ana Tay Hui Min", pref: "Ana", rel: "self" }, ben: { id: pid(2), name: "Ben Tay Wei Jie", pref: "Ben", rel: "child" } };
const W = [62, 14, 14], W1 = [62];
const C24 = (b: string) => `${b} is payable for each complete period of 24 hours that the insured person is confined in hospital as an inpatient. Any period shorter than 24 hours is not counted.`;
const NIGHT = (b: string) => `${b} is paid for each night spent in hospital.`;
type Doc = { key: string; id: string; product: string; members: string[]; pages: Record<number, string> };
const head = (insurer: string, product: string, who: string) => [insurer, `${product} - Schedule`, who, ""];
const DOCS: Doc[] = [
  { key: "CARE", id: pid(101), product: "Orchid Family Hospital Cash", members: [M.ana.id, M.ben.id], pages: {
    1: [...head("Orchid Mutual", "Orchid Family Hospital Cash", "Insured: Ana Tay Hui Min (adult); Ben Tay Wei Jie (child)"), row(["Benefit", "Adult", "Child"], W), row(["Hospital cash (each complete 24 hours, max 90 per year)", "S$100", "S$60"], W)].join("\n"),
    2: ["Conditions", C24("Hospital cash")].join("\n") } },
  { key: "REORD", id: pid(102), product: "Teak Hospital Cash", members: [M.ana.id, M.ben.id], pages: {
    1: [...head("Teak Assurance", "Teak Hospital Cash", "Insured: Ana Tay Hui Min (adult); Ben Tay Wei Jie (child)"), row(["Benefit", "Adult", "Child"], W), row(["Hospital cash (max 90 per year, each complete 24 hours)", "S$80", "S$40"], W)].join("\n"),
    2: ["Conditions", C24("Hospital cash")].join("\n") } },
  { key: "PY", id: pid(103), product: "Banyan Hospital Income", members: [M.ana.id], pages: {
    1: [...head("Banyan General", "Banyan Hospital Income", "Insured person: Ana Tay Hui Min"), row(["Benefit", "Amount"], W1), row(["Hospital income per complete 24-hour period (up to 90 per policy year)", "S$70"], W1)].join("\n"),
    2: ["Conditions", C24("Hospital income")].join("\n") } },
  { key: "DAYS", id: pid(104), product: "Saga Daily Cash", members: [M.ana.id], pages: {
    1: [...head("Saga Insurance", "Saga Daily Cash", "Insured person: Ana Tay Hui Min"), row(["Benefit", "Amount"], W1), row(["Daily hospital cash (90 days per year maximum)", "S$50"], W1)].join("\n"),
    2: ["Conditions", NIGHT("Daily hospital cash")].join("\n") } },
  { key: "MONEY", id: pid(105), product: "Kapok Hospital Allowance", members: [M.ana.id], pages: {
    1: [...head("Kapok Life", "Kapok Hospital Allowance", "Insured person: Ana Tay Hui Min"), row(["Benefit", "Amount"], [30]), row(["Hospital allowance", "S$100 per day, maximum S$3,000 per year"], [30])].join("\n"),
    2: ["Conditions", NIGHT("Hospital allowance")].join("\n") } },
  { key: "ANNUAL", id: pid(106), product: "Frangipani Wellness", members: [M.ana.id], pages: {
    1: [...head("Frangipani Life", "Frangipani Wellness", "Insured person: Ana Tay Hui Min"), row(["Benefit", "Amount"], [30]), row(["Wellness benefit", "S$500 per year"], [30]), row(["Annual allowance", "S$1,000"], [30])].join("\n"),
    2: ["Conditions", "The wellness benefit and the annual allowance are paid for each night spent in hospital."].join("\n") } },
  { key: "ADMIT", id: pid(107), product: "Mahogany Hospital Income", members: [M.ana.id], pages: {
    1: [...head("Mahogany Assurance", "Mahogany Hospital Income", "Insured person: Ana Tay Hui Min"), row(["Benefit", "Amount"], W1), row(["Hospital income (each complete 24 hours, max 30 per admission)", "S$90"], W1)].join("\n"),
    2: ["Conditions", C24("Hospital income")].join("\n") } },
];
const doc = (k: string) => DOCS.find((d) => d.key === k)!;
const ON = { DEARPOLICY_RAG_TOOLS: "1", NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv;

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 8).join("\n     ")); }
}

async function main() {
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
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Household A1')", [ACCOUNT]);
  for (const p of Object.values(M)) await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,$3,$4,$5)", [p.id, ACCOUNT, p.name, p.pref, p.rel]);
  for (const d of DOCS) {
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,file_hash)
      VALUES($1,$2,$3,'Synthetic',$4,$5,'Hospital cash','schedule',true,'ready',$6,$6,'scan_clean','active',$7)`, [d.id, ACCOUNT, M.ana.id, d.product, "A1-" + d.key, d.key.toLowerCase() + ".pdf", "sha256:a1-" + d.key.toLowerCase()]);
    for (const m of d.members) await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$3,'test',1)", [d.id, m, ACCOUNT]);
    for (const [page, text] of Object.entries(d.pages)) await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [ACCOUNT, d.id, Number(page), text]);
  }
  const VT = await import("@/lib/rag2/value-terms");
  const UT = await import("@/lib/rag2/calc/unit-terms");
  const CR = await import("@/lib/claims/calc-record");
  const R = await import("@/lib/rag2/tools");
  const CT = await import("@/lib/rag2/calc/tool");
  type Out = import("@/lib/rag2/calc/engine").CalcOutcome;
  type Rec = import("@/lib/rag2/calc/unit-terms").RecordWithUnitTerms;
  const pageText = (policyId: string, page: number) => DOCS.find((d) => d.id === policyId)?.pages[page] ?? null;

  const ctxFor = () => R.createToolContext({ accountId: ACCOUNT, asOf: "2026-10-09" });
  const sel = async (ctx: ReturnType<typeof ctxFor>, key: string, benefit: string, who: string) => {
    const r = await R.runTool(ctx, "select_table_value", { policy_id: doc(key).id, benefit, subject_id: who, want: "amount" }, ON);
    assert.ok(r.ok, JSON.stringify(r)); const d = r.data as { status: string; valueId: string; value: number };
    assert.equal(d.status, "ok", `select ${key}/${benefit}: ${JSON.stringify(d).slice(0, 300)}`); return d;
  };
  const calc = async (ctx: ReturnType<typeof ctxFor>, args: Record<string, unknown>) => {
    const r = await R.runTool(ctx, "calculate", args, ON);
    if (!r.ok) return { refused: (r as { error: string }).error } as const;
    const d = r.data as { calc_id: string; missing: { key: string; ask: string; why: string }[] };
    return Object.assign(CT.calcOutcomes(ctx).get(d.calc_id)! as Out, { missing: d.missing });
  };
  const at = (iso: string, words: string, assumed = false) => ({ at: iso, words, ...(assumed ? { assumed: true } : {}) });
  /** One hospital-cash calculation for `who` under `key`. */
  const hc = async (key: string, benefit: string, who: string, adm: string, dis: string, extra: Record<string, unknown> = {}) => {
    const ctx = ctxFor(); const v = await sel(ctx, key, benefit, who);
    return calc(ctx, { calculator: "hospital_cash", purpose: "claim", subject_id: who, policy_id: doc(key).id, benefit, rate_value_id: v.valueId, admission: at(adm, "admitted " + adm.slice(0, 10)), discharge: at(dis, "discharged " + dis.slice(0, 10)), ...extra });
  };
  const ok = (c: Awaited<ReturnType<typeof hc>>) => { assert.ok(!("refused" in c), "refused: " + JSON.stringify(c)); return c as Out & { missing: { key: string; ask: string; why: string }[] }; };
  const NONE = (id = "c_cap_prior_use", words = "she had no other hospital stays this year") => ({ settled: [{ condition_id: id, status: "established", words }] });
  const recordOk = (c: Out) => {
    assert.ok(c.record, "a record"); const rec = c.record as Rec;
    assert.ok(CR.recomputeCalculation(rec).ok, "the record re-runs");
    assert.equal(UT.checkUnitTerms(rec, pageText), null, "the unit terms re-check against the stored pages");
    for (const s of [rec.unitTerms!.rate.span, ...rec.unitTerms!.caps.map((x) => x.span)]) if (s && s.page != null) assert.equal(pageText(rec.policyId, s.page)!.slice(s.start, s.end), s.text, "span is verbatim on its page");
    return rec;
  };

  // ------------------------------------------------------------------------------------------------ P: parsing
  await check("P1 'each complete 24 hours, max 90 per year': per-period rate + 90-period annual cap (not an annual rate)", () => {
    const v = VT.parseCell("S$60", null, "Hospital cash (each complete 24 hours, max 90 per year) Insured Child");
    assert.equal(v.kind, "money"); assert.equal((v as { period: string }).period, "day");
    const t = (v as { terms: import("@/lib/rag2/value-terms").ValueTerms }).terms;
    assert.equal(t.rateUnit?.unit, "complete_24h"); assert.equal(t.durationRule?.rule, "completed_24h");
    assert.deepEqual(t.caps.map((c) => [c.kind, c.kind === "count" ? c.max : c.cents, c.reset, c.span.text]), [["count", 90, "year", "max 90 per year"]]);
    assert.equal(t.rate?.cents, 6000);
  });
  await check("P2 equivalent / reordered wordings read the same cap and unit", () => {
    const cases: [string, string, number, string, string][] = [
      ["Hospital cash (max 90 per year, each complete 24 hours)", "complete_24h", 90, "year", "max 90 per year"],
      ["Hospital income per complete 24-hour period (up to 90 per policy year)", "complete_24h", 90, "policy_year", "up to 90 per policy year"],
      ["Daily hospital cash (90 days per year maximum)", "day", 90, "year", "90 days per year maximum"],
      ["Daily hospital cash (max 90 days per year)", "day", 90, "year", "max 90 days per year"],
      ["Night cash (per night, maximum of 30 nights in any policy year)", "night", 30, "policy_year", "maximum of 30 nights in any policy year"],
      ["Hospital income (each complete 24 hours, max 60)", "complete_24h", 60, "null", "max 60"],
    ];
    for (const [ctx, unit, max, reset, span] of cases) {
      const t = VT.readValueTerms([{ source: "label", text: ctx }]);
      assert.equal(t.rateUnit?.unit, unit, ctx); const c = t.caps[0];
      assert.ok(c && c.kind === "count", ctx + ": a count cap"); assert.equal((c as { max: number }).max, max, ctx); assert.equal(String(c.reset), reset, ctx); assert.equal(c.span.text, span, ctx);
      assert.equal(ctx.slice(c.span.start, c.span.end), span, "span offsets");
    }
  });
  await check("P3 a daily rate with an annual MONETARY cap; a genuinely annual benefit stays annual (negative cases)", () => {
    const v = VT.parseCell("S$100 per day, maximum S$3,000 per year", null, "Hospital allowance") as { period: string; cents: number; terms: import("@/lib/rag2/value-terms").ValueTerms };
    assert.equal(v.cents, 10000); assert.equal(v.period, "day");
    assert.deepEqual(v.terms.caps.map((c) => [c.kind, c.kind === "money" ? c.cents : 0, c.reset]), [["money", 300000, "year"]]);
    const first = VT.parseCell("max S$3,000 per year, S$100 per day") as { cents: number };
    assert.equal(first.cents, 10000, "the rate is the amount outside the cap clause, whatever the order");
    for (const [cell, ctx, period] of [["S$500 per year", "Wellness benefit", "year"], ["S$1,000", "Annual allowance", "year"], ["S$3,500", "Deductible (per policy year)", "policy_year"], ["S$1,000,000", "Annual claim limit", "year"]] as const) {
      const p = VT.parseCell(cell, null, ctx) as { period: string; terms: { caps: unknown[] } };
      assert.equal(p.period, period, ctx); assert.equal(p.terms.caps.length, 0, ctx + ": no cap clause (the period belongs to the value)");
    }
    assert.equal(VT.readValueTerms([{ source: "x", text: "Co-insurance (up to 80%)" }]).caps.length, 0, "a percentage is not a count cap");
    assert.equal(VT.periodIn("Hospital cash (each complete 24 hours, max 90 per year)"), "day");
  });

  // ------------------------------------------------------------------------------------------------ H: hospital cash
  const B_ADM = "2026-09-03T22:15+08:00", B_DIS = "2026-09-06T09:30+08:00"; // 59 h 15 min: 2 complete periods
  await check("H1 L4 shape, earlier use unknown, not a what-if -> unresolved with the specific fact (asked of the household); never refused as 'per year'", async () => {
    const c = ok(await hc("CARE", "Hospital cash", M.ben.id, B_ADM, B_DIS));
    assert.equal(c.kind, "unresolved"); assert.equal(c.amount, null);
    assert.ok(c.requirements.some((r) => /already been paid for this year/.test(r) && /90/.test(r)), c.requirements.join(" | "));
    assert.ok(c.missing.some((m) => m.key === "c_cap_prior_use" && m.ask === "household"), JSON.stringify(c.missing));
    assert.equal(c.printed[0].value, 60, "the child's rate is still cited");
  });
  await check("H2 earlier use settled in the household's words -> indicative estimate 2 x S$60 = S$120, cap applied with its reset", async () => {
    const c = ok(await hc("CARE", "Hospital cash", M.ben.id, B_ADM, B_DIS, NONE()));
    assert.equal(c.kind, "indicative_estimate"); assert.equal(c.amount, 120);
    const rec = recordOk(c);
    assert.equal(rec.unitTerms!.rate.unit, "complete_24h");
    assert.deepEqual(rec.unitTerms!.caps.map((x) => [x.max, x.reset, x.priorUse, x.span.text]), [[90, "year", "household_none", "max 90 per year"]]);
    assert.ok(rec.steps.some((s) => s.op === "min_count" && s.inputs.includes("day_cap")));
    assert.equal(rec.conditions.find((x) => x.id === "c_cap_prior_use")?.basis, "household");
  });
  await check("H3 what-if, earlier use unknown -> conditional illustration that states the assumption", async () => {
    const ctx = ctxFor(); const v = await sel(ctx, "CARE", "Hospital cash", M.ben.id);
    const c = ok(await calc(ctx, { calculator: "hospital_cash", purpose: "what_if", subject_id: M.ben.id, policy_id: doc("CARE").id, benefit: "Hospital cash", rate_value_id: v.valueId, admission: at(B_ADM, "if he goes in on 3 Sep at 10.15pm", true), discharge: at(B_DIS, "and comes out on 6 Sep at 9.30am", true) }));
    assert.equal(c.kind, "conditional_illustration"); assert.equal(c.amount, 120);
    assert.match(c.record!.assumption ?? "", /assuming no earlier use of the 90-.* limit this year/);
    assert.equal((c.record as Rec).unitTerms!.caps[0].priorUse, "assumed_none"); recordOk(c);
  });
  await check("H4 reordered wording (max 90 per year, each complete 24 hours) and per policy year: same model", async () => {
    const a = ok(await hc("REORD", "Hospital cash", M.ana.id, B_ADM, B_DIS, NONE()));
    assert.equal(a.amount, 160); assert.equal((a.record as Rec).unitTerms!.caps[0].reset, "year"); recordOk(a);
    const u = ok(await hc("PY", "Hospital income", M.ana.id, B_ADM, B_DIS));
    assert.equal(u.kind, "unresolved"); assert.ok(u.requirements.some((r) => /this policy year/.test(r)), u.requirements.join(" | "));
    const p = ok(await hc("PY", "Hospital income", M.ana.id, B_ADM, B_DIS, NONE("c_cap_prior_use", "nothing claimed this policy year")));
    assert.equal(p.amount, 140); assert.equal((p.record as Rec).unitTerms!.caps[0].reset, "policy_year"); recordOk(p);
  });
  await check("H5 '90 days per year maximum' with a per-night rule: 3 nights x S$50 = S$150 once earlier use is settled", async () => {
    const c = ok(await hc("DAYS", "Daily hospital cash", M.ana.id, "2026-05-01", "2026-05-04", NONE()));
    assert.equal(c.kind, "indicative_estimate"); assert.equal(c.amount, 150);
    assert.deepEqual((c.record as Rec).unitTerms!.caps.map((x) => [x.max, x.unit, x.reset]), [[90, "days", "year"]]); recordOk(c);
  });
  await check("H6 cap boundary, prior use known: 85 used + 5 = exactly at the cap; + 6 = one over (only 5 paid); 90 used -> nothing; unknown -> unresolved", async () => {
    const A = "2026-03-01T08:00+08:00";
    const plus = (h: number) => new Date(Date.parse(A) + h * 3_600_000).toISOString().replace(/\.000Z$/, "Z");
    const pu = (n: number) => ({ prior_use: { periods: n, words: `Ana already had ${n} days of hospital cash this year` } });
    const at5 = ok(await hc("CARE", "Hospital cash", M.ana.id, A, plus(5 * 24 + 1), pu(85)));
    assert.equal(at5.kind, "indicative_estimate"); assert.equal(at5.amount, 500); recordOk(at5);
    const over = ok(await hc("CARE", "Hospital cash", M.ana.id, A, plus(6 * 24 + 1), pu(85)));
    assert.equal(over.amount, 500, "6 periods, 5 left: S$500"); const rec = recordOk(over);
    assert.equal(rec.unitTerms!.caps[0].priorUse, "household_figure"); assert.ok(rec.operands.some((o) => o.id === "prior_periods" && o.source === "household" && o.value === 85));
    const used = ok(await hc("CARE", "Hospital cash", M.ana.id, A, plus(2 * 24 + 1), pu(90)));
    assert.equal(used.kind, "not_payable"); assert.match(used.reason ?? "", /already used/);
    const bad = await hc("CARE", "Hospital cash", M.ana.id, A, plus(25), { prior_use: { periods: 12, words: "she was in hospital earlier this year" } });
    assert.ok("refused" in bad, "a figure not in the household's words is refused");
    const unknown = ok(await hc("CARE", "Hospital cash", M.ana.id, A, plus(6 * 24 + 1)));
    assert.equal(unknown.kind, "unresolved");
  });
  await check("H7 cap boundary, no earlier use: 90 complete periods = 90 x S$100; 91 periods -> still S$9,000", async () => {
    const A = "2026-01-02T08:00+08:00";
    const plus = (h: number) => new Date(Date.parse(A) + h * 3_600_000).toISOString().replace(/\.000Z$/, "Z");
    const n90 = ok(await hc("CARE", "Hospital cash", M.ana.id, A, plus(90 * 24 + 2), NONE()));
    assert.equal(n90.amount, 9000); recordOk(n90);
    const n91 = ok(await hc("CARE", "Hospital cash", M.ana.id, A, plus(91 * 24 + 2), NONE()));
    assert.equal(n91.amount, 9000, "one over the cap pays the cap"); recordOk(n91);
  });
  await check("H8 daily rate with an annual monetary cap: 5 nights S$500; 40 nights capped at S$3,000; S$2,800 already paid -> S$200; S$3,000 paid -> nothing; unknown -> unresolved", async () => {
    const MC = "c_money_cap_prior_use";
    const five = ok(await hc("MONEY", "Hospital allowance", M.ana.id, "2026-05-01", "2026-05-06", NONE(MC)));
    assert.equal(five.kind, "indicative_estimate"); assert.equal(five.amount, 500);
    const rec = recordOk(five); assert.deepEqual(rec.unitTerms!.caps.map((x) => [x.kind, x.max, x.currency, x.reset]), [["money", 3000, "SGD", "year"]]);
    assert.ok(rec.steps.some((s) => s.op === "min" && s.inputs.includes("money_cap")));
    const forty = ok(await hc("MONEY", "Hospital allowance", M.ana.id, "2026-06-01", "2026-07-11", NONE(MC)));
    assert.equal(forty.amount, 3000); recordOk(forty);
    const left = ok(await hc("MONEY", "Hospital allowance", M.ana.id, "2026-05-01", "2026-05-06", { prior_use: { amount: 2800, currency: "SGD", words: "S$2,800 was already paid this year" } }));
    assert.equal(left.amount, 200); recordOk(left);
    const none = ok(await hc("MONEY", "Hospital allowance", M.ana.id, "2026-05-01", "2026-05-06", { prior_use: { amount: 3000, currency: "SGD", words: "they already paid S$3,000 this year" } }));
    assert.equal(none.kind, "not_payable");
    const unk = ok(await hc("MONEY", "Hospital allowance", M.ana.id, "2026-05-01", "2026-05-06"));
    assert.equal(unk.kind, "unresolved"); assert.ok(unk.requirements.some((r) => /S\$3,000 per year/.test(r)), unk.requirements.join(" | "));
  });
  await check("H9 genuinely annual benefits are still refused as a per-day rate", async () => {
    for (const b of ["Wellness benefit", "Annual allowance"]) {
      const c = await hc("ANNUAL", b, M.ana.id, "2026-05-01", "2026-05-04");
      assert.ok("refused" in c && /per year, not per day/.test(c.refused), b + ": " + JSON.stringify(c).slice(0, 200));
    }
  });
  await check("H10 a per-admission cap never asks about earlier use: 2 x S$90 = S$180 directly", async () => {
    const c = ok(await hc("ADMIT", "Hospital income", M.ana.id, B_ADM, B_DIS));
    assert.equal(c.kind, "indicative_estimate"); assert.equal(c.amount, 180);
    assert.ok(!c.conditions.some((x) => x.id === "c_cap_prior_use"));
    assert.deepEqual((recordOk(c)).unitTerms!.caps.map((x) => [x.max, x.reset, x.priorUse]), [[30, "admission", "not_counted"]]);
  });

  // ------------------------------------------------------------------------------------------------ R: record re-check
  await check("R1 checkUnitTerms rejects a tampered record (cap, reset, prior use, unit, missing step, span)", async () => {
    const c = ok(await hc("CARE", "Hospital cash", M.ben.id, B_ADM, B_DIS, NONE()));
    const base = c.record as Rec; const clone = () => JSON.parse(JSON.stringify(base)) as Rec;
    const tamper: [string, (r: Rec) => void, RegExp][] = [
      ["cap value", (r) => { r.unitTerms!.caps[0].max = 120; }, /re-read|not an operand/],
      ["reset period", (r) => { r.unitTerms!.caps[0].reset = "admission"; }, /re-read/],
      ["earlier use dropped", (r) => { r.unitTerms!.caps[0].priorUse = "not_counted"; }, /earlier use counts/],
      ["prior-use condition removed", (r) => { r.conditions = r.conditions.filter((x) => x.id !== "c_cap_prior_use"); }, /not addressed/],
      ["prior use left unresolved in an estimate", (r) => { const x = r.conditions.find((y) => y.id === "c_cap_prior_use")!; x.status = "unresolved"; x.basis = "none"; }, /not settled/],
      ["rate unit changed to a year", (r) => { r.unitTerms!.rate.unit = "year"; }, /re-read|per year/],
      ["cap step removed", (r) => { r.steps = r.steps.map((s) => s.op === "min_count" ? { ...s, inputs: [s.inputs[0], s.inputs[0]] } : s) as typeof r.steps; }, /not applied/],
      ["span moved", (r) => { r.unitTerms!.caps[0].span.start += 2; }, /not on its page/],
      ["no unit terms", (r) => { delete r.unitTerms; }, /does not carry/],
    ];
    for (const [name, f, re] of tamper) { const r = clone(); f(r); const p = UT.checkUnitTerms(r, pageText); assert.ok(p && re.test(p), `${name}: ${p}`); }
  });

  // ------------------------------------------------------------------------------------------------ C: cached tokens
  const HM = await import("@/lib/rag2/loop/hosted-model");
  const UM = await import("@/lib/rag2/loop/usage-meter");
  const P = await import("@/lib/ai/providers");
  const U = await import("@/lib/ai/usage");
  const LUNA = { provider: "openai" as const, model: "gpt-6-luna" };
  await check("C1 cached input tokens are read from OpenAI and Anthropic replies (and are 0 when none are reported)", () => {
    assert.deepEqual(HM.openAiReply({ choices: [{ message: {} }], usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 800 } } }).usage, { input: 1000, output: 50, cached: 800 });
    assert.deepEqual(HM.openAiReply({ choices: [{ message: {} }], usage: { prompt_tokens: 1000, completion_tokens: 50 } }).usage, { input: 1000, output: 50, cached: 0 });
    assert.deepEqual(HM.anthropicReply({ content: [], usage: { input_tokens: 150, cache_read_input_tokens: 800, cache_creation_input_tokens: 50, output_tokens: 40 } }).usage, { input: 1000, output: 40, cached: 800 }, "Anthropic input_tokens exclude cache reads / writes");
    assert.deepEqual(HM.anthropicReply({ content: [], usage: { input_tokens: 1000, output_tokens: 40 } }).usage, { input: 1000, output: 40, cached: 0 });
  });
  await check("C2 actual cost prices cached input at the cached rate (gpt-6-luna US$0.01/M); full input price when no cached rate is on file", () => {
    assert.equal(P.priceFor(LUNA)?.cachedInput, 0.01);
    const withCache = UM.actualCallCostUsd(LUNA, { input: 1000, output: 50, cached: 800 })!, without = UM.actualCallCostUsd(LUNA, { input: 1000, output: 50 })!;
    assert.ok(Math.abs(withCache - (200 * 0.1 + 800 * 0.01 + 50 * 0.5) / 1e6) < 1e-15, String(withCache));
    assert.ok(Math.abs(without - (1000 * 0.1 + 50 * 0.5) / 1e6) < 1e-15, String(without));
    const flash = { provider: "gemini" as const, model: "gemini-2.5-flash" };
    assert.equal(P.priceFor(flash)?.cachedInput, undefined);
    assert.ok(Math.abs(UM.actualCallCostUsd(flash, { input: 1000, output: 50, cached: 800 })! - (1000 * 0.3 + 50 * 2.5) / 1e6) < 1e-15, "no cached rate on file: full input price");
  });
  await check("C3 meter: model_executions / model_usage record cached_tokens and the cached-rate cost; the reservation stays separate from the actual cost", async () => {
    type MT = import("@/lib/rag2/loop/types").ModelTurnOutput;
    const outs: MT[] = [
      { toolCalls: [], text: null, usage: { input: 1000, output: 50, cached: 800 } as MT["usage"], modelId: "openai:gpt-6-luna", resolvedModel: "gpt-6-luna-test", latencyMs: 1 },
      { toolCalls: [], text: null, usage: { input: 1000, output: 50 }, modelId: "openai:gpt-6-luna", resolvedModel: "gpt-6-luna-test", latencyMs: 1 },
    ];
    let n = 0;
    const model = { kind: "hosted" as const, id: "openai:gpt-6-luna", choice: LUNA, async next() { return outs[n++]; } };
    U.resetLoopRunUsage();
    const meter = new UM.LoopUsageMeter({ model, accountId: ACCOUNT, limits: U.loopLimits(), startedAt: Date.now(), promptVersion: "rag2-loop-a1-test" });
    const input = { messages: [{ role: "user" as const, content: "hello" }], tools: [], maxOutputTokens: 500 };
    const reservation = UM.maxCallCostUsd(P.priceFor(LUNA)!, UM.reserveInputTokens(input), 500);
    for (let i = 0; i < 2; i++) { const r = await meter.next(input); assert.ok(r.ok, JSON.stringify(r)); }
    const ex = (await db.query<{ cached_tokens: number; cost_usd: string }>("SELECT cached_tokens, cost_usd::text FROM model_executions WHERE prompt_version='rag2-loop-a1-test' ORDER BY attempt_index")).rows;
    assert.deepEqual(ex.map((x) => x.cached_tokens), [800, 0]);
    assert.ok(Math.abs(Number(ex[0].cost_usd) - 0.000053) < 1e-9 && Math.abs(Number(ex[1].cost_usd) - 0.000125) < 1e-9, JSON.stringify(ex));
    const mu = (await db.query<{ cached_tokens: number; cost_usd: string }>("SELECT cached_tokens, cost_usd::text FROM model_usage WHERE account_id=$1 ORDER BY at, id", [ACCOUNT])).rows;
    assert.deepEqual(mu.map((x) => x.cached_tokens), [800, 0]);
    assert.ok(Math.abs(Number(mu[0].cost_usd) - 0.000053) < 1e-9, JSON.stringify(mu));
    const run = U.loopRunUsage();
    assert.ok(Math.abs(run.usd - 0.000178) < 1e-9, "the run budget is settled at the actual costs: " + run.usd);
    assert.ok(reservation > 0.000125, "the reservation (worst case) is above the actual cost");
    assert.equal(meter.calls[0].costUsd !== null && Math.abs(meter.calls[0].costUsd - 0.000053) < 1e-12, true);
    const report = await U.usageByOperationAndModel(ACCOUNT, new Date(Date.now() - 3_600_000));
    assert.equal(report.cachedTokens, 800);
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
