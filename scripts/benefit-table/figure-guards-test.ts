/** Scripted tests for the figure guards (lib/benefit-table/guards.ts, guard-run.ts, and their use in service.ts): five
 * readers must agree on a figure before the table uses it, up to 3 re-reads, then the household confirms, and what the
 * household confirms is final. Made-up documents and names only, fake readers, no network, no paid call.
 *   npm run benefit-table:figure-guards-test */
import assert from "node:assert/strict";
import { checkReading, type CheckedReading, type SourceDoc } from "@/lib/benefit-table/check";
import { MAX_REREADS, applyGuards, claimsOf, judge, renderQuestions, type GuardNote, type GuardRecord, type Per, type Verdict } from "@/lib/benefit-table/guards";
import { BATCH_CLAIMS, batches, runGuards, type GuardReader } from "@/lib/benefit-table/guard-run";
import { DEFAULT_GUARDS, figureGuardsEnabled, guardCapUsd, guardRoster, supportsEffort } from "@/lib/benefit-table/guard-flag";
import { anthropicTableModel, type TableCall, type TableModel, type TableReply } from "@/lib/benefit-table/model";
import { coverKeyOf, sectionKeyOf } from "@/lib/benefit-table/assemble";
import { guardStoredReading, readDocument, setFigureConfirmation, tableFor, type Db, type GuardSetup } from "@/lib/benefit-table/service";
import { FIGURE_CHECK_JOB_TYPE, MAX_FIGURE_CHECK_RUNS, enqueueFigureCheck, figureCheckPayload } from "@/lib/benefit-table/figure-check-job";
import { checkingCount } from "@/lib/benefit-table/guards";

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`); }
}

// ---- A made-up travel policy: a schedule page and a plan table with two columns. ----
const PAGES = [
  { page: 1, text: "POLICY SCHEDULE\nInsured: Lim Ah Kow\nPlan: Business\nCover\tSum Insured\tPremium\nTravel Basic Plan\tS$100,000\tS$120.50 (monthly)" },
  { page: 2, text: "Section 2 Travel inconvenience\nBenefit\tClassic\tBusiness\nTrip postponement\tS$500\tS$1,000\nDaily hospital cash\tS$100 per day\tS$200 per day\nBaggage delay\tS$200\tS$300" },
];
const DOC: SourceDoc = { id: "doc-1", name: "Example Travel Policy", readable: true, people: ["Lim Ah Kow"], pages: PAGES };
const row = (column: string, benefit: string, pays: string, value: number, quote: string) => ({ section: "Section 2 Travel inconvenience", column, benefit, pays, value, period: null, basis: null,
  percentOf: null, baseAmount: null, baseQuote: null, cap: null, capQuote: null, conditions: [], page: 2, quote });
/** Reader 1's reading. businessTrip: the figure it read for Trip postponement under Business (the truth is 1000). */
const reading = (businessTrip = 1000) => ({
  document: { kind: "personal_proof", product: "Example Travel Policy", namedPeople: ["Lim Ah Kow"], plan: "Business" },
  covers: [{ person: "Lim Ah Kow", product: "Example Travel Policy", cover: "Travel Basic Plan", plan: "Business", policyNumber: null, sumInsured: 100000, premium: 120.5,
    premiumFrequency: "monthly", asOf: null, page: 1, quote: "Travel Basic Plan\tS$100,000\tS$120.50 (monthly)" }],
  benefits: [
    row("Classic", "Trip postponement", "up_to", 500, "Trip postponement\tS$500\tS$1,000"),
    row("Business", "Trip postponement", "up_to", businessTrip, "Trip postponement\tS$500\tS$1,000"),
    row("Business", "Daily hospital cash", "per_day", 200, "Daily hospital cash\tS$100 per day\tS$200 per day"),
    row("Business", "Baggage delay", "up_to", 300, "Baggage delay\tS$200\tS$300"),
  ],
});
const checked = (businessTrip = 1000) => checkReading(DOC, reading(businessTrip));

/** What the page truly prints for each question, found from the question's own words (where it points, never a figure). */
type Truth = { amount: number; per: Per };
function truthOf(q: string): Truth | null {
  if (/sum insured/.test(q)) return { amount: 100000, per: "once" };
  if (/premium/.test(q)) return { amount: 120.5, per: "month" };
  const col = /column "(\w+)"/.exec(q)?.[1];
  const table: Record<string, Record<string, Truth>> = {
    "Trip postponement": { Classic: { amount: 500, per: "once" }, Business: { amount: 1000, per: "once" } },
    "Daily hospital cash": { Classic: { amount: 100, per: "day" }, Business: { amount: 200, per: "day" } },
    "Baggage delay": { Classic: { amount: 200, per: "once" }, Business: { amount: 300, per: "once" } },
  };
  for (const [name, cols] of Object.entries(table)) if (q.includes(`"${name}"`) && col) return cols[col] ?? null;
  return null;
}
/** A fake reader: answers each question from truthOf, or from `misread` when it returns an answer (a misreading). */
type Misread = (q: string, call: TableCall, n: number) => Truth | "not_found" | null | undefined;
function reader(name: string, misread?: Misread, opts: { broken?: boolean } = {}) {
  const calls: TableCall[] = [];
  const model: TableModel = { choice: { provider: "anthropic", model: name }, async call(c) {
    calls.push(c);
    const qs = [...c.user.matchAll(/<q id="(q\d+)">([\s\S]*?)<\/q>/g)];
    const answers = qs.map(([, id, q]) => {
      const t = misread?.(q, c, calls.length) ?? truthOf(q);
      if (!t || t === "not_found") return { id, found: false, amount: null, per: null, line: "" };
      return { id, found: true, amount: t.amount, per: t.per, line: "as printed" };
    });
    return { json: opts.broken ? null : { answers }, stopReason: opts.broken ? "max_tokens" : "end_turn", model: name, input: 1000, output: 200, ms: 1 } satisfies TableReply;
  } };
  return { model, calls };
}
type Fake = ReturnType<typeof reader>;
const five = (overrides: Partial<Record<0 | 1 | 2 | 3 | 4, Fake>> = {}) => [0, 1, 2, 3, 4].map((i) => overrides[i as 0] ?? reader(`guard-${i}`));
const readersOf = (fakes: Fake[]): GuardReader[] => fakes.map((f, i) => ({ model: f.model, prompt: i % 2 ? "copyFirst" : "direct" }));
const calls = (fakes: Fake[]) => fakes.reduce((n, f) => n + f.calls.length, 0);
const run = (r: CheckedReading, fakes: Fake[], capUsd = 3, callTime?: () => number | null) => runGuards(DOC, r, readersOf(fakes), { capUsd, ...(callTime ? { callTime } : {}), now: () => new Date("2026-11-06T00:00:00Z") });
const keyOf = (r: CheckedReading, where: RegExp, field = "value") => claimsOf(r).find((c) => c.field === field && where.test(c.where))!.key;
const businessTripKey = (r: CheckedReading) => keyOf(r, /"Trip postponement".*"Business"/);

async function main() {
  await test("the made-up document's reading passes the existing checks, with 6 figures to guard", () => {
    const r = checked();
    assert.deepEqual(r.dropped, []);
    assert.equal(claimsOf(r).length, 6);
  });

  await test("guards are blind: the questions never carry the figure reader 1 read", () => {
    const r = checked(), q = renderQuestions(claimsOf(r));
    for (const figure of ["500", "1,000", "1000", "200", "300", "100,000", "100000", "120.50", "120.5"]) assert.ok(!q.includes(figure), `question text holds ${figure}`);
  });

  await test("all five agree: every figure is used, with no re-read (4 guard calls)", async () => {
    const r = checked(), fakes = five(), g = await run(r, fakes);
    assert.equal(calls(fakes), 4, "reader 1 is not called in the first round");
    assert.equal(fakes[0].calls.length, 0);
    assert.ok(Object.values(g.verdicts).every((v) => v.status === "agreed" && v.rounds === 0));
    assert.deepEqual(applyGuards(r, g), r, "an all-agreed reading is used exactly as checked");
  });

  await test("one guard misreads a column, then reads it right: settled on the first re-read, only that figure is re-read", async () => {
    const r = checked();
    const fakes = five({ 2: reader("guard-2", (q, _c, n) => n === 1 && /"Trip postponement".*"Business"/.test(q) ? { amount: 500, per: "once" } : null) });
    const g = await run(r, fakes);
    const v = g.verdicts[businessTripKey(r)];
    assert.equal(v.status, "agreed"); assert.equal(v.rounds, 1); assert.equal(v.value, 1000);
    assert.equal(calls(fakes), 4 + 5, "the re-read asks all five, reader 1 included");
    const reread = fakes[0].calls[0].user;
    assert.equal([...reread.matchAll(/<q id=/g)].length, 1, "only the disputed figure is read again");
    assert.match(fakes[0].calls[0].system, /disagreed/);
  });

  await test("reader 1 took the wrong plan column: all five agree on the right one in the re-read, and it replaces reader 1's", async () => {
    const r = checked(500);
    const fakes = five();
    const g = await run(r, fakes);
    const v = g.verdicts[businessTripKey(r)];
    assert.equal(v.status, "corrected"); assert.equal(v.value, 1000);
    const shown = applyGuards(r, g).benefits.find((b) => b.benefit === "Trip postponement" && b.column === "Business")!;
    assert.equal(shown.value, 1000);
  });

  await test("a figure the five never agree on: 3 re-reads, then the household is asked, and it is used nowhere until then", async () => {
    const r = checked();
    const stubborn = reader("guard-3", (q) => /"Trip postponement".*"Business"/.test(q) ? { amount: 500, per: "once" } : null);
    const fakes = five({ 3: stubborn });
    const g = await run(r, fakes);
    const v = g.verdicts[businessTripKey(r)];
    assert.equal(v.status, "confirm"); assert.equal(v.rounds, 1 + MAX_REREADS);
    assert.equal(calls(fakes), 4 + 5 * MAX_REREADS);
    assert.deepEqual(v.candidates, [1000, 500], "the readers' figures, each printed on the page");
    const shown = applyGuards(r, g);
    const b = shown.benefits.find((x) => x.benefit === "Trip postponement" && x.column === "Business")! as CheckedReading["benefits"][number] & { figureCheck?: { status: string; line: string }[] };
    assert.equal(b.value, null); assert.equal(b.pays, "words", "the row stays, as its printed words");
    assert.equal(b.figureCheck?.[0].status, "confirm");
    assert.match(b.figureCheck![0].line, /Trip postponement/);
    // Every other figure is still used.
    assert.equal(shown.benefits.filter((x) => x.value != null).length, 3);
    assert.equal(shown.covers[0].sumInsured, 100000);
  });

  await test("five readers agreeing on a figure the row does not print is not enough: it goes to the household", async () => {
    const r = checked(500);
    const wrong = (name: string) => reader(name, (q) => /"Trip postponement".*"Business"/.test(q) ? { amount: 750, per: "once" } : null);
    const g = await run(r, [wrong("r1"), wrong("g1"), wrong("g2"), wrong("g3"), wrong("g4")]);
    assert.equal(g.verdicts[businessTripKey(r)].status, "confirm");
  });

  await test("a re-read can overrule what reader 1 read a figure is per: a limit printed per year, read by reader 1 as a lump sum", async () => {
    const r = checked();
    const perYear = (name: string) => reader(name, (q, c) => /"Baggage delay".*"Business"/.test(q) ? { amount: 300, per: "year" } : null);
    const g = await run(r, [perYear("r1"), perYear("g1"), perYear("g2"), perYear("g3"), perYear("g4")]);
    const v = g.verdicts[keyOf(r, /"Baggage delay".*"Business"/)];
    assert.equal(v.status, "agreed"); assert.equal(v.rounds, 1); assert.equal(v.per, "year");
  });

  await test("an unsettled figure keeps what every reader answered in every round, for audit", async () => {
    const r = checked();
    const g = await run(r, five({ 3: reader("g3", (q) => /"Trip postponement".*"Business"/.test(q) ? { amount: 500, per: "once" } : null) }));
    const seen = g.verdicts[businessTripKey(r)].seen!;
    assert.equal(seen.length, 1 + MAX_REREADS);
    assert.deepEqual(seen[0], [[1000, "once"], [1000, "once"], [1000, "once"], [500, "once"], [1000, "once"]]);
  });

  await test("a plain-number plan row (cells joined by spaces, \"50 100 150\") still prints its middle cell (live run fg-live-20261106-03)", () => {
    const claim = { key: "k", field: "value" as const, page: 2, where: "w", ask: "a", value: 100, per: "day" as const, excerpt: "3 Overseas hospital cash (per day, up to 30 days) 50 100 150" };
    assert.equal(judge(claim, Array(5).fill({ amount: 100, per: "day" }), 5).settled, true);
    assert.equal(judge({ ...claim, value: 5010 }, Array(5).fill({ amount: 5010, per: "day" }), 5).settled, false, "a figure no cell prints");
  });

  await test("a figure no page prints is never offered to the household", async () => {
    const r = checked();
    const odd = reader("guard-1", (q) => /"Trip postponement".*"Business"/.test(q) ? { amount: 9999, per: "once" } : null);
    const g = await run(r, five({ 1: odd }));
    assert.deepEqual(g.verdicts[businessTripKey(r)].candidates, [1000]);
  });

  await test("the household's figure is final: it wins over a verdict, a later re-check and a new reading", async () => {
    const r = checked(), key = businessTripKey(r);
    const confirmations = [{ documentId: DOC.id, claimKey: key, value: 1000 }];
    const record: GuardRecord = { version: "x", at: "x", spentUsd: 0, calls: 0, verdicts: { [key]: { status: "confirm", value: null, per: null, page: 2, line: "", candidates: [], rounds: 4 } } };
    const pick = (x: CheckedReading) => x.benefits.find((b) => b.benefit === "Trip postponement" && b.column === "Business")!.value;
    assert.equal(pick(applyGuards(r, record, confirmations)), 1000);
    const later: GuardRecord = { ...record, verdicts: { [key]: { status: "corrected", value: 500, per: "once", page: 2, line: "", candidates: [], rounds: 1 } } };
    assert.equal(pick(applyGuards(r, later, confirmations)), 1000, "a later re-check does not overwrite it");
    const reread = checked(500);
    assert.equal(businessTripKey(reread), key, "the key names where the figure is, not the figure");
    assert.equal(pick(applyGuards(reread, null, confirmations)), 1000, "a new reading does not overwrite it");
    assert.equal(pick(applyGuards(r, record, [{ ...confirmations[0], documentId: "another-doc" }])), null, "another document's figure is not used");
  });

  await test("the readers must agree on what a figure is per: a daily rate read as a lump sum is not settled", async () => {
    const r = checked();
    const g = await run(r, five({ 4: reader("guard-4", (q) => /"Daily hospital cash"/.test(q) ? { amount: 200, per: "once" } : null) }));
    assert.equal(g.verdicts[keyOf(r, /"Daily hospital cash"/)].status, "confirm");
  });

  await test("a guard that cannot answer (no reply) counts as a disagreement and the figures are read again", async () => {
    const r = checked();
    let n = 0;
    const flaky: Fake = reader("guard-1");
    const broken = reader("guard-1", undefined, { broken: true });
    const model: TableModel = { choice: flaky.model.choice, call: (c) => (n++ === 0 ? broken.model : flaky.model).call(c) };
    const g = await run(r, [reader("r1"), { model, calls: [] }, reader("g2"), reader("g3"), reader("g4")]);
    assert.ok(Object.values(g.verdicts).every((v) => v.status === "agreed" && v.rounds === 1));
  });

  await test("spend limit: a call whose worst case would pass the limit is not made, and its figures go to the household", async () => {
    const r = checked(), fakes = five(), g = await run(r, fakes, 0.000001);
    assert.equal(calls(fakes), 0);
    assert.equal(g.stopped, "spend");
    assert.ok(Object.values(g.verdicts).every((v) => v.status === "confirm"));
  });

  await test("time limit: figures not checked in time stay 'checking' and are never used", async () => {
    const r = checked(), fakes = five(), g = await run(r, fakes, 3, () => 0);
    assert.equal(calls(fakes), 0);
    assert.ok(Object.values(g.verdicts).every((v) => v.status === "checking"));
    const shown = applyGuards(r, g);
    assert.ok(shown.benefits.every((b) => b.value == null));
    assert.equal(shown.covers[0].sumInsured, null); assert.equal(shown.covers[0].premium, null);
  });

  await test("a run cut off by its time limit is resumed: settled figures are kept, only the unchecked ones are read", async () => {
    const r = checked();
    let left = 1_000_000;
    const g1 = await run(r, five(), 3, () => left);
    const cut: GuardRecord = { ...g1, verdicts: Object.fromEntries(Object.entries(g1.verdicts).map(([k, v], i) => [k, i < 2 ? { ...v, status: "checking" as const, value: null } : v])) };
    const fakes = five();
    const g2 = await runGuards(DOC, r, readersOf(fakes), { capUsd: 3, previous: cut });
    assert.equal([...fakes[1].calls[0].user.matchAll(/<q id=/g)].length, 2, "only the two unchecked figures are asked");
    assert.ok(Object.values(g2.verdicts).every((v) => v.status === "agreed"));
    left = 0;
  });

  await test("with the guards on, a reading never checked uses no figure (it is 'still being checked')", () => {
    const shown = applyGuards(checked(), undefined);
    assert.ok(shown.benefits.every((b) => b.value == null && (b as { figureCheck?: { status: string }[] }).figureCheck?.[0].status === "checking"));
  });

  await test("a long table is checked in batches of at most 30 figures", () => {
    const lines = Array.from({ length: 75 }, (_, i) => `Item ${i + 1}\tS$${(i + 1) * 10}`);
    const doc: SourceDoc = { id: "d2", name: "Long schedule", readable: true, pages: [{ page: 1, text: "Schedule of benefits\n" + lines.join("\n") }] };
    const r = checkReading(doc, { document: { kind: "scheme_terms", product: "Example Group Plan", namedPeople: [], plan: null }, covers: [],
      benefits: lines.map((l, i) => ({ section: "Schedule of benefits", column: null, benefit: `Item ${i + 1}`, pays: "amount", value: (i + 1) * 10, period: null, basis: null, percentOf: null,
        baseAmount: null, baseQuote: null, cap: null, capQuote: null, conditions: [], page: 1, quote: l })) });
    const b = batches(doc, claimsOf(r));
    assert.equal(claimsOf(r).length, 75);
    assert.deepEqual(b.map((x) => x.length), [BATCH_CLAIMS, BATCH_CLAIMS, 15]);
  });

  await test("switch: off by default, on only for an alpha account (or all accounts), refused in production without its own allow", () => {
    const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
    assert.equal(figureGuardsEnabled(env({}), "a"), false);
    assert.equal(figureGuardsEnabled(env({ DEARPOLICY_FIGURE_GUARDS: "1", DEARPOLICY_ALPHA_ACCOUNTS: "someone-else" }), "a"), false, "not in the alpha list");
    assert.equal(figureGuardsEnabled(env({ DEARPOLICY_FIGURE_GUARDS: "1", VERCEL: "1", DEARPOLICY_FIGURE_GUARDS_ALLOW_PRODUCTION: "1" }), "a"), false, "production with no alpha list");
    assert.equal(figureGuardsEnabled(env({ DEARPOLICY_FIGURE_GUARDS: "1", DEARPOLICY_ALPHA_ACCOUNTS: "a" }), "a"), true);
    assert.equal(figureGuardsEnabled(env({ DEARPOLICY_FIGURE_GUARDS: "1", DEARPOLICY_ALPHA_ACCOUNTS: "a" })), false, "no account named");
    assert.equal(figureGuardsEnabled(env({ DEARPOLICY_FIGURE_GUARDS: "1", DEARPOLICY_FIGURE_GUARDS_ALL_ACCOUNTS: "1" }), "b"), true);
    assert.equal(figureGuardsEnabled(env({ DEARPOLICY_FIGURE_GUARDS: "1", DEARPOLICY_ALPHA_ACCOUNTS: "a", VERCEL: "1" }), "a"), false);
    assert.equal(figureGuardsEnabled(env({ DEARPOLICY_FIGURE_GUARDS: "1", DEARPOLICY_ALPHA_ACCOUNTS: "a", VERCEL: "1", DEARPOLICY_FIGURE_GUARDS_ALLOW_PRODUCTION: "1" }), "a"), true);
    assert.deepEqual(guardRoster(env({})), DEFAULT_GUARDS);
    assert.equal(new Set(DEFAULT_GUARDS.map((g) => g.choice.model)).size, 4, "four different models");
    assert.throws(() => guardRoster(env({ DEARPOLICY_FIGURE_GUARD_MODELS: "anthropic:x:direct" })));
    assert.equal(guardCapUsd(env({})), 3);
  });

  // ---- Through the service, with an in-memory database. ----
  const A = "acct-a";
  let stamp = 0;
  function fakeDb(opts: { figureTable?: boolean } = {}) {
    const s = {
      readings: new Map<string, { account_id: string; reading: string; read_at?: string }>(),
      figures: new Map<string, { account_id: string; policy_id: string; claim_key: string; value: number }>(),
    };
    const db: Db = async (sql, p) => {
      const q = sql.replace(/\s+/g, " ").trim();
      if (q.includes("to_regclass('public.benefit_figure_confirmations')")) return [{ ok: opts.figureTable !== false }];
      if (q.startsWith("SELECT to_regclass")) return [{ ok: true }];
      if (q.startsWith("SELECT id, display_name, preferred_name FROM family_members")) return p[0] === A ? [{ id: "p1", display_name: "Lim Ah Kow", preferred_name: null }] : [];
      if (q.startsWith("SELECT id, original_filename, processing_status"))
        return p[0] === A && (p.length < 2 || p[1] === DOC.id) ? [{ id: DOC.id, account_id: A, original_filename: "Example Travel Policy.pdf", processing_status: "ready", lifecycle_state: "active", superseded_at: null, reading_live: true }] : [];
      if (q.startsWith("SELECT policy_id, page_number, text FROM policy_pages"))
        return p[0] === A ? PAGES.map((x) => ({ policy_id: DOC.id, page_number: x.page, text: x.text })) : [];
      if (q.startsWith("INSERT INTO benefit_readings")) { s.readings.set(p[0] as string, { account_id: p[1] as string, reading: p[2] as string, read_at: `t${++stamp}` }); return []; }
      if (q.startsWith("SELECT reading, read_at::text AS read_at FROM benefit_readings WHERE policy_id=$1")) { const r = s.readings.get(p[0] as string); return r && r.account_id === p[1] ? [{ reading: r.reading, read_at: r.read_at }] : []; }
      if (q.startsWith("SELECT reading FROM benefit_readings WHERE policy_id=$1")) { const r = s.readings.get(p[0] as string); return r && r.account_id === p[1] ? [{ reading: r.reading }] : []; }
      if (q.startsWith("UPDATE benefit_readings SET reading=jsonb_set(reading, '{guards}'")) {
        const r = s.readings.get(p[0] as string);
        if (!r || r.account_id !== p[1] || r.read_at !== p[3]) return [];
        r.reading = JSON.stringify({ ...JSON.parse(r.reading), guards: JSON.parse(p[2] as string) });
        return [{ ok: 1 }];
      }
      if (q.startsWith("SELECT policy_id, reading FROM benefit_readings"))
        return [...s.readings].filter(([, r]) => r.account_id === p[0]).map(([policy_id, r]) => ({ policy_id, reading: r.reading }));
      if (q.startsWith("SELECT section_key, cover_key, why, chosen_by FROM benefit_links"))
        return [{ section_key: sectionKeyOf(DOC.id, { section: "Section 2 Travel inconvenience", column: "Business" }), cover_key: coverKeyOf({ product: "Example Travel Policy", cover: "Travel Basic Plan", plan: "Business" }), why: "test", chosen_by: "household" }];
      if (q.startsWith("SELECT family_member_id, cover_key, status, sum_insured, updated_at FROM benefit_confirmations")) return [];
      if (q.startsWith("SELECT policy_id, claim_key, value FROM benefit_figure_confirmations")) return [...s.figures.values()].filter((f) => f.account_id === p[0]);
      if (q.startsWith("INSERT INTO benefit_figure_confirmations")) { s.figures.set(`${p[0]}|${p[1]}|${p[2]}`, { account_id: p[0] as string, policy_id: p[1] as string, claim_key: p[2] as string, value: p[3] as number }); return []; }
      if (q.startsWith("DELETE FROM benefit_figure_confirmations")) { s.figures.delete(`${p[0]}|${p[1]}|${p[2]}`); return []; }
      if (q.startsWith("UPDATE policies") || q.startsWith("DELETE FROM benefit_links") || q.startsWith("INSERT INTO benefit_links")) return [];
      throw new Error("fake db: unexpected statement " + q.slice(0, 90));
    };
    return { db, s };
  }
  const readerModel = (json: unknown) => { const calls: TableCall[] = []; const model: TableModel = { choice: { provider: "anthropic", model: "reader-1" },
    async call(c) { calls.push(c); if (c.system.includes("checker") || c.system.includes("disagreed") || c.system.includes("without seeing")) return reader("reader-1").model.call(c);
      return { json, stopReason: "end_turn", model: "reader-1", input: 100, output: 50, ms: 1 }; } }; return { model, calls }; };
  const setup = (r1: TableModel, fakes: Fake[]): GuardSetup => ({ readers: [{ model: r1, prompt: "direct" }, ...readersOf(fakes).slice(1)], capUsd: 3 });
  const envOn = () => { process.env.DEARPOLICY_FIGURE_GUARDS = "1"; process.env.DEARPOLICY_ALPHA_ACCOUNTS = A; };
  const envOff = () => { delete process.env.DEARPOLICY_FIGURE_GUARDS; delete process.env.DEARPOLICY_ALPHA_ACCOUNTS; };
  const tripFigure = (t: Awaited<ReturnType<typeof tableFor>>) => t.table.people[0]?.rows.find((x) => x.benefit === "Trip postponement" && x.column === "Business")?.figure;

  await test("switch off: reading stores no guards and makes no extra call; the table is the same as before", async () => {
    envOff();
    const f = fakeDb(), r1 = readerModel(reading());
    await readDocument(f.db, r1.model, A, DOC.id);
    assert.equal(r1.calls.length, 1);
    assert.equal("guards" in JSON.parse(f.s.readings.get(DOC.id)!.reading), false);
    const t = await tableFor(f.db, A);
    assert.equal("figureChecks" in t, false);
  });

  await test("switch off: a stored guard record changes nothing on any page (byte-identical table)", async () => {
    envOff();
    const plain = fakeDb(), withGuards = fakeDb();
    await readDocument(plain.db, readerModel(reading(500)).model, A, DOC.id);
    const fakes = five({ 3: reader("g3", (q) => /"Trip postponement".*"Business"/.test(q) ? { amount: 500, per: "once" } : null) });
    const r1 = readerModel(reading(500));
    await readDocument(withGuards.db, r1.model, A, DOC.id, undefined, {}, setup(r1.model, fakes));
    assert.ok("guards" in JSON.parse(withGuards.s.readings.get(DOC.id)!.reading));
    assert.deepEqual(JSON.stringify(await tableFor(withGuards.db, A)), JSON.stringify(await tableFor(plain.db, A)));
  });

  await test("switch on, end to end: reader 1's wrong column is corrected on Coverage; an unsettled figure is listed to confirm, and the household's answer is final", async () => {
    envOn();
    try {
      const f = fakeDb(), r1 = readerModel(reading(500));
      await readDocument(f.db, r1.model, A, DOC.id, undefined, {}, setup(r1.model, five()));
      const t = await tableFor(f.db, A);
      assert.equal(tripFigure(t)?.kind, "printed");
      assert.equal((tripFigure(t) as { amount: number }).amount, 1000, "corrected to the column all five read");
      assert.deepEqual(t.figureChecks, []);

      const g = fakeDb(), r2 = readerModel(reading());
      await readDocument(g.db, r2.model, A, DOC.id, undefined, {}, setup(r2.model, five({ 3: reader("g3", (q) => /"Trip postponement".*"Business"/.test(q) ? { amount: 500, per: "once" } : null) })));
      const before = await tableFor(g.db, A);
      assert.equal(before.figureChecks?.length, 1);
      assert.equal(before.figureChecks![0].status, "confirm");
      assert.equal(tripFigure(before)?.kind, "none", "not used until the household answers");
      await assert.rejects(setFigureConfirmation(g.db, A, "u1", DOC.id, "not-a-key", 1000), /not in your documents/);
      await assert.rejects(setFigureConfirmation(g.db, A, "u1", DOC.id, before.figureChecks![0].claimKey, -5), /more than 0/);
      await setFigureConfirmation(g.db, A, "u1", DOC.id, before.figureChecks![0].claimKey, 1000);
      const after = await tableFor(g.db, A);
      assert.deepEqual(after.figureChecks, []);
      assert.equal((tripFigure(after) as { amount: number }).amount, 1000);
      // A fresh reading of the same document keeps the household's figure.
      const r3 = readerModel(reading(500));
      await readDocument(g.db, r3.model, A, DOC.id, undefined, {}, setup(r3.model, five({ 3: reader("g3", (q) => /"Trip postponement".*"Business"/.test(q) ? { amount: 500, per: "once" } : null) })));
      assert.equal((tripFigure(await tableFor(g.db, A)) as { amount: number }).amount, 1000);
    } finally { envOff(); }
  });

  await test("switch on but the confirmations table not applied: nothing breaks, and the household cannot save yet", async () => {
    envOn();
    try {
      const f = fakeDb({ figureTable: false }), r1 = readerModel(reading());
      await readDocument(f.db, r1.model, A, DOC.id, undefined, {}, setup(r1.model, five()));
      const t = await tableFor(f.db, A);
      assert.equal((tripFigure(t) as { amount: number }).amount, 1000);
      await assert.rejects(setFigureConfirmation(f.db, A, "u1", DOC.id, "k", 1), /not set up/);
    } finally { envOff(); }
  });

  await test("a check cut off by the time limit: the reading says so, and the continuation finishes only what was left, within the same spend limit", async () => {
    envOff();
    // A finished check, then three of its figures marked as cut off by the time limit.
    const g = fakeDb(), r2 = readerModel(reading());
    const read = await readDocument(g.db, r2.model, A, DOC.id, undefined, {}, setup(r2.model, five()));
    assert.equal(read.figuresChecking, 0);
    const stored = JSON.parse(g.s.readings.get(DOC.id)!.reading);
    const keys = Object.keys(stored.guards.verdicts);
    for (const k of keys.slice(0, 3)) stored.guards.verdicts[k] = { ...stored.guards.verdicts[k], status: "checking", value: null };
    stored.guards.spentUsd = 0.5; stored.guards.calls = 4;
    g.s.readings.get(DOC.id)!.reading = JSON.stringify(stored);
    const at = stored.guards.at;
    // A continuation for another reading does nothing.
    const idle = five();
    assert.equal((await guardStoredReading(g.db, A, DOC.id, setup(idle[0].model, idle), {}, "some-other-reading")).checked, false);
    assert.equal(calls(idle), 0);
    const more = five();
    const done = await guardStoredReading(g.db, A, DOC.id, setup(more[0].model, more), {}, at);
    assert.equal(done.checked, true);
    assert.equal([...more[1].calls[0].user.matchAll(/<q id=/g)].length, 3, "only the 3 unchecked figures are asked");
    const after = JSON.parse(g.s.readings.get(DOC.id)!.reading).guards;
    assert.equal(after.at, at, "the check keeps its start");
    assert.equal(checkingCount(after), 0);
    assert.ok(after.spentUsd > 0.5 && after.calls === 4 + 4, "spend and calls count the whole check");
    // Nothing left: a further continuation pays nothing.
    const none = five();
    assert.equal((await guardStoredReading(g.db, A, DOC.id, setup(none[0].model, none), {}, at)).checked, false);
    assert.equal(calls(none), 0);
  });

  await test("a guard call that throws (an overload) never loses the paid reading: it is stored, and its figures wait for the continuation", async () => {
    envOff();
    const f = fakeDb(), r1 = readerModel(reading());
    const boom: Fake = { model: { choice: { provider: "anthropic", model: "boom" }, async call() { throw Object.assign(new Error("overloaded"), { status: 529 }); } }, calls: [] };
    const res = await readDocument(f.db, r1.model, A, DOC.id, undefined, {}, setup(r1.model, five({ 2: boom })));
    assert.equal(res.read, true);
    assert.equal(res.figuresChecking, 6);
    const g = JSON.parse(f.s.readings.get(DOC.id)!.reading).guards as GuardRecord;
    assert.equal(g.stopped, "error");
    assert.ok(Object.values(g.verdicts).every((v) => v.status === "checking"));
  });

  await test("a confirmation binds to its exact row: two tables with the same row label and column never swap figures (Critic R389b)", () => {
    const doc: SourceDoc = { id: "two-tables", name: "Example Travel with add-on", readable: true, pages: [
      { page: 1, text: "Section 1 Medical\nBenefit\tClassic\tPremier\nMedical expenses\tS$250,000\tS$500,000" },
      { page: 2, text: "Winter sports add-on\nBenefit\tClassic\tPremier\nMedical expenses\tS$20,000\tS$50,000" }] };
    const main = { section: "Section 1 Medical", column: "Premier", benefit: "Medical expenses", pays: "up_to", value: 500000, period: null, basis: null, percentOf: null, baseAmount: null, baseQuote: null, cap: null, capQuote: null, conditions: [], page: 1, quote: "Medical expenses\tS$250,000\tS$500,000" };
    const addOn = { ...main, section: "Winter sports add-on", value: 50000, page: 2, quote: "Medical expenses\tS$20,000\tS$50,000" };
    const read = (benefits: unknown[]) => checkReading(doc, { document: { kind: "policy_wording", product: "Example Travel", namedPeople: [], plan: null }, covers: [], benefits });
    const first = read([main, addOn]);
    assert.equal(first.benefits.length, 2);
    const addOnKey = claimsOf(first).find((c) => c.page === 2)!.key;
    const confirmations = [{ documentId: doc.id, claimKey: addOnKey, value: 50000 }];
    const fresh = read([addOn, main]);
    const shown = applyGuards(fresh, null, confirmations);
    const at = (page: number) => shown.benefits.find((b) => b.source.page === page)!.value;
    assert.equal(at(2), 50000, "the add-on keeps its confirmed figure");
    assert.equal(at(1), null, "the main row is not given the add-on's figure (it waits for its own check)");
    // Two rows printing the very same words: told apart by page, heading and order, or asked again.
    const twin: SourceDoc = { ...doc, id: "twins", pages: [{ page: 1, text: "Part A\nMedical expenses\tS$500,000" }, { page: 2, text: "Part B\nMedical expenses\tS$500,000" }] };
    const t = (benefits: unknown[]) => checkReading(twin, { document: { kind: "policy_wording", product: "Example Travel", namedPeople: [], plan: null }, covers: [], benefits });
    const rowA = { ...main, section: "Part A", column: null, quote: "Medical expenses\tS$500,000", page: 1 }, rowB = { ...rowA, section: "Part B", page: 2 };
    const keys = claimsOf(t([rowA, rowB])).map((c) => c.key);
    assert.equal(new Set(keys).size, 2);
  });

  await test("identical rows in two tables: the household's figure is never replaced by a guard's figure (Critic R389c)", () => {
    const line = "Medical expenses\tS$20,000\tS$50,000";
    const doc: SourceDoc = { id: "twin-tables", name: "Example Travel with add-on", readable: true, pages: [
      { page: 1, text: "Cover\nExample Travel" },
      { page: 2, text: `Section 1 Medical\nBenefit\tClassic\tPremier\n${line}` },
      { page: 3, text: `Winter sports add-on\nBenefit\tClassic\tPremier\n${line}` }] };
    const main = { section: "Section 1 Medical", column: "Premier", benefit: "Medical expenses", pays: "up_to", value: 50000, period: null, basis: null, percentOf: null, baseAmount: null, baseQuote: null, cap: null, capQuote: null, conditions: [], page: 2, quote: line };
    const addOn = { ...main, section: "Winter sports add-on", page: 3 };
    const read = (benefits: unknown[]) => checkReading(doc, { document: { kind: "policy_wording", product: "Example Travel", namedPeople: [], plan: null }, covers: [], benefits });
    // Every guard agrees on 50,000 for every row: the household's 20,000 must still win wherever it applies.
    const agreed = (x: CheckedReading): GuardRecord => ({ version: "t", at: "t", spentUsd: 0, calls: 0, verdicts: Object.fromEntries(claimsOf(x).map((c) =>
      [c.key, { status: "agreed", value: 50000, per: "once", page: c.page, line: c.excerpt, candidates: [50000], rounds: 0 } as Verdict])) });
    const first = read([main, addOn]);
    assert.equal(first.benefits.length, 2);
    const confirmations = [{ documentId: doc.id, claimKey: claimsOf(first).find((c) => c.page === 3)!.key, value: 20000 }];
    const show = (x: CheckedReading) => applyGuards(x, agreed(x), confirmations);
    const at = (x: CheckedReading, page: number) => x.benefits.find((b) => b.source.page === page);
    const only = show(read([addOn]));
    assert.equal(at(only, 3)!.value, 20000, "add-on read alone keeps the household's figure");
    const swapped = show(read([addOn, main]));
    assert.equal(at(swapped, 3)!.value, 20000, "add-on listed first keeps the household's figure");
    assert.equal(at(swapped, 2)!.value, 50000, "the main table keeps its own agreed figure");
    const back = show(read([main, addOn]));
    assert.equal(at(back, 3)!.value, 20000);
    // Only the main table in a fresh reading (Critic R389d): the add-on's figure never lands on the main row.
    const mainOnly = show(read([main]));
    assert.equal(at(mainOnly, 2)!.value, null, "the main row is not given the add-on's figure");
    assert.equal((at(mainOnly, 2) as { figureCheck?: GuardNote[] }).figureCheck?.[0].status, "confirm");
    // Both rows cited on a page the household never confirmed: the reading cannot tell them apart, so ask again.
    const moved = read([main, addOn]);
    for (const b of moved.benefits) b.source = { ...b.source, page: 1 };
    const asked = applyGuards(moved, agreed(moved), confirmations);
    for (const b of asked.benefits) {
      assert.equal(b.value, null, "no guard figure over the household's");
      const note = (b as { figureCheck?: GuardNote[] }).figureCheck?.[0];
      assert.equal(note?.status, "confirm");
      assert.ok(note!.candidates.includes(20000));
    }
  });

  await test("a fresh reading that cites another page or words the heading differently asks the household again, offering their figure", () => {
    const r = checked(), key = businessTripKey(r);
    const moved = structuredClone(r);
    for (const b of moved.benefits) { b.section = "SECTION 2 - TRAVEL INCONVENIENCE BENEFITS"; b.source = { ...b.source, page: 3 }; }
    assert.equal(businessTripKey(moved).split(".")[0], key.split(".")[0], "the same printed row");
    const pick = (x: CheckedReading) => x.benefits.find((b) => b.benefit === "Trip postponement" && b.column === "Business")!;
    const agreedAll: GuardRecord = { version: "t", at: "t", spentUsd: 0, calls: 0, verdicts: Object.fromEntries(claimsOf(moved).map((c) =>
      [c.key, { status: "agreed", value: c.value, per: c.per, page: c.page, line: c.excerpt, candidates: [c.value], rounds: 0 } as Verdict])) };
    const row = pick(applyGuards(moved, agreedAll, [{ documentId: DOC.id, claimKey: key, value: 1000 }]));
    assert.equal(row.value, null, "no guard figure over the household's");
    const note = (row as { figureCheck?: GuardNote[] }).figureCheck?.[0];
    assert.equal(note?.status, "confirm");
    assert.ok(note!.candidates.includes(1000));
    assert.equal(pick(applyGuards(r, agreedAll, [{ documentId: DOC.id, claimKey: key, value: 1000 }])).value, 1000, "the same reading keeps it");
  });

  await test("Haiku 4.5 is sent no effort setting (it refuses one); the other guards keep it", () => {
    assert.equal(supportsEffort("claude-haiku-4-5"), false);
    assert.equal(supportsEffort("claude-opus-5-5"), true);
    assert.equal(supportsEffort("claude-sonnet-5"), true);
    const sent: Record<string, unknown>[] = [];
    const client = { messages: { stream(p: Record<string, unknown>) { sent.push(p); return { finalMessage: async () => ({ content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", model: "m", usage: {} }) }; } } };
    const call = { system: "s", user: "u", schema: {}, maxTokens: 10 };
    return Promise.all([anthropicTableModel({ provider: "anthropic", model: "claude-haiku-4-5" }, client as never, { effort: false }).call(call),
      anthropicTableModel({ provider: "anthropic", model: "claude-sonnet-5-5" }, client as never).call(call)]).then(() => {
      assert.equal("effort" in (sent[0].output_config as object), false);
      assert.equal((sent[1].output_config as { effort?: string }).effort, "medium", "main's reading call is unchanged");
    });
  });

  await test("a continuation never writes its check onto a newer reading stored by Read again meanwhile", async () => {
    envOff();
    const f = fakeDb(), r1 = readerModel(reading());
    await readDocument(f.db, r1.model, A, DOC.id, undefined, {}, setup(r1.model, five()));
    const stored = JSON.parse(f.s.readings.get(DOC.id)!.reading);
    for (const k of Object.keys(stored.guards.verdicts)) stored.guards.verdicts[k] = { ...stored.guards.verdicts[k], status: "checking", value: null };
    f.s.readings.get(DOC.id)!.reading = JSON.stringify(stored);
    // While the continuation's guards are reading, the household's Read again stores a new reading with no guards.
    const newer = JSON.stringify({ ...stored, guards: undefined, marker: "newer" });
    const sneaky = reader("g1", (_q, _c, n) => { if (n === 1) { f.s.readings.set(DOC.id, { account_id: A, reading: newer, read_at: "t-newer" }); } return null; });
    const fakes = five({ 1: sneaky });
    const res = await guardStoredReading(f.db, A, DOC.id, setup(fakes[0].model, fakes), {}, stored.guards.at);
    assert.equal(res.checked, false);
    assert.equal(f.s.readings.get(DOC.id)!.reading, newer, "the newer reading is untouched");
  });

  await test("the spend limit is per document: a Read again counts what earlier checks of the document spent", async () => {
    envOff();
    const f = fakeDb(), r1 = readerModel(reading());
    await readDocument(f.db, r1.model, A, DOC.id, undefined, {}, setup(r1.model, five()));
    const stored = JSON.parse(f.s.readings.get(DOC.id)!.reading);
    stored.guards.spentUsd = 2.9999;
    f.s.readings.get(DOC.id)!.reading = JSON.stringify(stored);
    const again = readerModel(reading()), fakes = five();
    await readDocument(f.db, again.model, A, DOC.id, undefined, {}, { ...setup(again.model, fakes), capUsd: 3 });
    assert.equal(calls(fakes), 0, "no guard call fits in what is left of the document's US$3");
    const g = JSON.parse(f.s.readings.get(DOC.id)!.reading).guards as GuardRecord;
    assert.equal(g.spentUsd, 2.9999);
    assert.ok(Object.values(g.verdicts).every((v) => v.status === "confirm"));
  });

  await test("continuation jobs: one attempt each, idempotent per reading and run, at most MAX_FIGURE_CHECK_RUNS", async () => {
    const sent: unknown[][] = [];
    const db = { query: (async (_sql: string, params: unknown[]) => { sent.push(params); return { rows: [{ id: "j" }], rowCount: 1 }; }) as never };
    await enqueueFigureCheck(db, A, DOC.id, "2026-11-06T00:00:00.000Z", 1);
    assert.equal(sent[0][1], FIGURE_CHECK_JOB_TYPE);
    assert.equal(sent[0][2], `${DOC.id}:figure-check:2026-11-06T00:00:00.000Z:1`);
    assert.equal(sent[0][5], 1, "max attempts 1: a failed paid run is never retried by the queue");
    assert.equal(await enqueueFigureCheck(db, A, DOC.id, "x", MAX_FIGURE_CHECK_RUNS + 1), null);
    assert.equal(sent.length, 1);
    assert.throws(() => figureCheckPayload({ policyId: "p" }));
    assert.deepEqual(figureCheckPayload({ policyId: "p", at: "t", run: 2 }), { policyId: "p", at: "t", run: 2 });
  });

  await test("the continuation job does nothing while the guards are off", async () => {
    envOff();
    const { processFigureCheckJob } = await import("@/lib/benefit-table/app");
    await processFigureCheckJob({ account_id: A, payload: { policyId: DOC.id, at: "t", run: 1 } });
  });

  if (failures.length) { console.error(`${failures.length} failed, ${passed} passed:\n- ${failures.join("\n- ")}`); process.exit(1); }
  console.log(`figure guards: ${passed} passed`);
}
void main();
