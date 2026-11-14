/** Scripted tests for the page-image figure check (lib/benefit-table/image-check.ts, page-source.ts, and its use in
 * service.ts): a figure on a page read by OCR is used only when a checker shown the page copies the same figure, blind;
 * otherwise the household is asked, and the figure is used nowhere until then. Made-up documents and names only, fake
 * checkers, no network, no paid call.
 *   npm run benefit-table:image-check-test */
import assert from "node:assert/strict";
import { checkReading, type CheckedReading, type SourceDoc } from "@/lib/benefit-table/check";
import { applyGuards, claimsOf, type GuardRecord } from "@/lib/benefit-table/guards";
import { IMAGE_BATCH, IMAGE_CHECK_PROMPT, IMAGE_CHECK_VERSION, copyConfirms, readCopies, runImageCheck, type ImageChecker, type PageSource } from "@/lib/benefit-table/image-check";
import { figureCheckMode, figureChecksOn, imageCheckEnabled, imageCheckModels } from "@/lib/benefit-table/guard-flag";
import { userContent, type Attachment, type TableCall, type TableModel } from "@/lib/benefit-table/model";
import { coverKeyOf, sectionKeyOf } from "@/lib/benefit-table/assemble";
import { guardStoredReading, readDocument, setFigureConfirmation, tableFor, type Db, type GuardSetup } from "@/lib/benefit-table/service";
import { ocrPagesOf, pageSourceFor } from "@/lib/benefit-table/page-source";

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`); }
}

// ---- A made-up travel policy whose page 2 was read by OCR, with one OCR misread: "S$1,000" read as "$51,000". ----
const PAGES = [
  { page: 1, text: "POLICY SCHEDULE\nInsured: Lim Ah Kow\nPlan: Business\nCover\tSum Insured\tPremium\nTravel Basic Plan\tS$100,000\tS$120.50 (monthly)" },
  { page: 2, text: "Section 2 Travel inconvenience\nBenefit\tClassic\tBusiness\nTrip postponement\tS$500\t$51,000\nDaily hospital cash\tS$100 per day\tS$200 per day" },
];
const DOC: SourceDoc = { id: "doc-1", name: "Example Travel Policy", readable: true, people: ["Lim Ah Kow"], pages: PAGES };
const row = (column: string, benefit: string, pays: string, value: number, quote: string) => ({ section: "Section 2 Travel inconvenience", column, benefit, pays, value, period: null, basis: null,
  percentOf: null, baseAmount: null, baseQuote: null, cap: null, capQuote: null, conditions: [], page: 2, quote });
const reading = () => ({
  document: { kind: "personal_proof", product: "Example Travel Policy", namedPeople: ["Lim Ah Kow"], plan: "Business" },
  covers: [{ person: "Lim Ah Kow", product: "Example Travel Policy", cover: "Travel Basic Plan", plan: "Business", policyNumber: null, sumInsured: 100000, premium: 120.5,
    premiumFrequency: "monthly", asOf: null, page: 1, quote: "Travel Basic Plan\tS$100,000\tS$120.50 (monthly)" }],
  benefits: [
    row("Classic", "Trip postponement", "up_to", 500, "Trip postponement\tS$500\t$51,000"),
    row("Business", "Trip postponement", "up_to", 51000, "Trip postponement\tS$500\t$51,000"),
    row("Business", "Daily hospital cash", "per_day", 200, "Daily hospital cash\tS$100 per day\tS$200 per day"),
  ],
});
const checked = (): CheckedReading => checkReading(DOC, reading());

/** What the page image truly prints in each cell, found from the question's own words. */
const PRINTED: [RegExp, string][] = [
  [/sum insured/, "S$100,000"], [/premium/, "S$120.50 (monthly)"],
  [/"Trip postponement".*"Classic"/, "S$500"], [/"Trip postponement".*"Business"/, "S$1,000"],
  [/"Daily hospital cash".*"Business"/, "S$200 per day"],
];
const truth = (q: string) => PRINTED.find(([re]) => re.test(q))?.[1] ?? null;
/** A fake checker: copies each cell from PRINTED, or what `copy` returns for it. */
function checker(name: string, copy?: (q: string) => string | null | undefined, opts: { throws?: boolean; timeout?: boolean } = {}) {
  const calls: TableCall[] = [];
  const model: TableModel = { choice: { provider: "anthropic", model: name }, async call(c) {
    calls.push(c);
    if (opts.throws) throw Object.assign(new Error("overloaded"), { status: 529 });
    if (opts.timeout) return { json: null, stopReason: "timeout", model: name, input: 500, output: 10, ms: 1 };
    const answers = [...c.user.matchAll(/<q id="(q\d+)">([\s\S]*?)<\/q>/g)].map(([, id, q]) => ({ id, printed: copy?.(q) !== undefined ? copy!(q) : truth(q) }));
    return { json: { answers }, stopReason: "end_turn", model: name, input: 2000, output: 100, ms: 1 };
  } };
  return { model, calls, checker: { model } as ImageChecker };
}
const PAGE: Attachment = { kind: "pdf", mediaType: "application/pdf", data: "JVBERi0=" };
const source = (imagePages: number[], page: (n: number) => Promise<Attachment | null> = async () => PAGE): PageSource => ({ imagePages, page });
const run = (r: CheckedReading, src: PageSource, a: ReturnType<typeof checker>, b: ReturnType<typeof checker>, o: Partial<Parameters<typeof runImageCheck>[4]> = {}) =>
  runImageCheck(r, src, a.checker, b.checker, { capUsd: 1, now: () => new Date("2026-11-14T00:00:00Z"), ...o });
const keyOf = (r: CheckedReading, where: RegExp, field = "value") => claimsOf(r).find((c) => c.field === field && where.test(c.where))!.key;
const businessKey = (r: CheckedReading) => keyOf(r, /"Trip postponement".*"Business"/);

async function main() {
  await test("the made-up reading passes the existing checks, with 5 figures; the misread one is in it as 51000", () => {
    const r = checked();
    assert.equal(claimsOf(r).length, 5);
    assert.equal(r.benefits[1].value, 51000);
  });

  await test("figures on pages with their own text layer are confirmed by the reading's checks: no call, no spend", async () => {
    const a = checker("first"), b = checker("second");
    const g = await run(checked(), source([]), a, b);
    assert.equal(a.calls.length + b.calls.length, 0);
    assert.ok(Object.values(g.verdicts).every((v) => v.status === "agreed" && v.rounds === 0));
    assert.equal(g.version, IMAGE_CHECK_VERSION);
    assert.equal(g.spentUsd, 0);
  });

  await test("the checker is shown the page and is blind: one call per page, the page attached, and no figure in the questions", async () => {
    const a = checker("first"), b = checker("second");
    await run(checked(), source([1, 2]), a, b);
    assert.equal(a.calls.length, 2, "one call for each page with figures");
    for (const c of a.calls) {
      assert.deepEqual(c.attachments, [PAGE]);
      assert.equal(c.system, IMAGE_CHECK_PROMPT);
      for (const n of ["51000", "51,000", "500", "100,000", "120.5", "200"]) assert.ok(!c.user.includes(n), `question carries ${n}`);
    }
  });

  await test("an OCR misread ($5 for S$) is caught: the figure is not used, the second checker is asked about it alone, and the household is offered the copied figure", async () => {
    const r = checked(), a = checker("first"), b = checker("second");
    const g = await run(r, source([1, 2]), a, b);
    assert.equal(b.calls.length, 1);
    assert.equal([...b.calls[0].user.matchAll(/<q id=/g)].length, 1, "only the doubted figure goes to the second checker");
    const v = g.verdicts[businessKey(r)];
    assert.equal(v.status, "confirm");
    assert.deepEqual(v.candidates, [1000], "the figure the page prints, never the OCR's 51000");
    const others = Object.entries(g.verdicts).filter(([k]) => k !== businessKey(r));
    assert.ok(others.every(([, x]) => x.status === "agreed" && x.rounds === 1));
    const shown = applyGuards(r, g);
    assert.equal(shown.benefits[1].value, null, "never shown with an amount");
    assert.equal(shown.benefits[0].value, 500);
  });

  await test("the second checker's copy confirms a figure the first misread: it is used (2 rounds)", async () => {
    const r = checked(), a = checker("first", (q) => /"Classic"/.test(q) && /Trip/.test(q) ? "S$600" : undefined), b = checker("second");
    const g = await run(r, source([2]), a, b);
    assert.equal(g.verdicts[keyOf(r, /"Trip postponement".*"Classic"/)].status, "agreed");
    assert.equal(g.verdicts[keyOf(r, /"Trip postponement".*"Classic"/)].rounds, 2);
  });

  await test("a copy that prints the same number in another currency does not confirm it", async () => {
    const r = checked(), other = (q: string) => /"Trip postponement".*"Classic"/.test(q) ? "US$500" : undefined;
    const g = await run(r, source([2]), checker("first", other), checker("second", other));
    assert.equal(g.verdicts[keyOf(r, /"Trip postponement".*"Classic"/)].status, "confirm");
  });

  await test("copyConfirms: same number, and no other currency named", () => {
    assert.equal(copyConfirms("S$20,000", 20000, "SGD"), true);
    assert.equal(copyConfirms("S$20,000", 520000, null), false, "the $5 misread");
    assert.equal(copyConfirms("S$1,372,820", 1372.82, "SGD"), false, "dot thousands read as decimals");
    assert.equal(copyConfirms("RM20,000", 20000, "SGD"), false);
    assert.equal(copyConfirms("S$20,000", 20000, null), true, "a currency the reading lost confirms the number only");
    assert.equal(copyConfirms("20,000", 20000, "SGD"), true);
    assert.equal(copyConfirms("25%", 25, null), true);
    assert.equal(copyConfirms("S$200 per day", 200, "SGD"), true);
    assert.equal(copyConfirms(null, 200, "SGD"), false);
  });

  await test("readCopies: a malformed, missing or doubled answer is no copy", () => {
    const c = claimsOf(checked()).slice(0, 3);
    assert.deepEqual(readCopies(null, c), [null, null, null]);
    assert.deepEqual(readCopies({ answers: [{ id: "q1", printed: " S$5 " }, { id: "q1", printed: "S$9" }, { id: "q3", printed: "" }, { id: 2, printed: "x" }] }, c), ["S$5", null, null]);
  });

  await test("a page the stored file cannot give: its figures are not confirmed, and no call is made", async () => {
    const r = checked(), a = checker("first"), b = checker("second");
    const g = await run(r, source([2], async () => null), a, b);
    assert.equal(a.calls.length, 0);
    assert.ok(claimsOf(r).filter((c) => c.page === 2).every((c) => g.verdicts[c.key].status === "confirm"));
    assert.ok(claimsOf(r).filter((c) => c.page === 1).every((c) => g.verdicts[c.key].status === "agreed"));
  });

  await test("spend limit: a call whose worst case would pass it is not made, and those figures go to the household", async () => {
    const r = checked(), a = checker("first"), b = checker("second");
    const g = await run(r, source([1, 2]), a, b, { capUsd: 0.0001 });
    assert.equal(a.calls.length, 0);
    assert.equal(g.stopped, "spend");
    assert.ok(Object.values(g.verdicts).every((v) => v.status === "confirm"));
  });

  await test("time limit and a failed call: the figures stay 'checking' for the continuation job, never used", async () => {
    for (const [a, o] of [[checker("first"), { callTime: () => 1000 }], [checker("first", undefined, { timeout: true }), {}], [checker("first", undefined, { throws: true }), {}]] as const) {
      const r = checked();
      const g = await run(r, source([1, 2]), a, checker("second"), o);
      assert.ok(g.stopped === "time" || g.stopped === "error");
      assert.ok(Object.values(g.verdicts).every((v) => v.status === "checking"));
      assert.ok(applyGuards(r, g).benefits.every((x) => x.value == null));
    }
  });

  await test("a resumed check keeps what was settled and asks only what was left", async () => {
    const r = checked(), first = await run(r, source([1, 2]), checker("first"), checker("second"));
    const previous: GuardRecord = { ...first, verdicts: { ...first.verdicts } };
    for (const c of claimsOf(r).filter((x) => x.page === 1)) previous.verdicts[c.key] = { ...previous.verdicts[c.key], status: "checking", value: null };
    const a = checker("first");
    const g = await run(r, source([1, 2]), a, checker("second"), { previous });
    assert.equal(a.calls.length, 1, "page 1 only");
    assert.equal(g.at, first.at);
    assert.equal(g.calls, first.calls + 1);
    assert.equal(g.verdicts[businessKey(r)].status, "confirm");
  });

  await test("a page with more figures than one call takes is asked in batches", async () => {
    const lines = Array.from({ length: IMAGE_BATCH + 5 }, (_, i) => `Item ${i + 1}\tS$${(i + 1) * 10}`);
    const doc: SourceDoc = { id: "d2", name: "Long schedule", readable: true, pages: [{ page: 1, text: "Schedule of benefits\n" + lines.join("\n") }] };
    const r = checkReading(doc, { document: { kind: "scheme_terms", product: "Example Group Plan", namedPeople: [], plan: null }, covers: [],
      benefits: lines.map((l, i) => ({ section: "Schedule of benefits", column: null, benefit: `Item ${i + 1}`, pays: "amount", value: (i + 1) * 10, period: null, basis: null, percentOf: null,
        baseAmount: null, baseQuote: null, cap: null, capQuote: null, conditions: [], page: 1, quote: l })) });
    const a = checker("first", (q) => `S$${Number(/"Item (\d+)"/.exec(q)?.[1]) * 10}`);
    const g = await run(r, source([1]), a, checker("second"));
    assert.deepEqual(a.calls.map((c) => [...c.user.matchAll(/<q id=/g)].length), [IMAGE_BATCH, 5]);
    assert.ok(Object.values(g.verdicts).every((v) => v.status === "agreed"));
  });

  await test("the model call sends the attached page before the questions; with none, the plain prompt as before", () => {
    const base = { system: "s", user: "u", schema: {}, maxTokens: 1 };
    assert.equal(userContent(base), "u");
    assert.deepEqual(userContent({ ...base, attachments: [PAGE, { kind: "image", mediaType: "image/png", data: "iVBO" }] }), [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" } },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBO" } },
      { type: "text", text: "u" },
    ]);
  });

  await test("switch: off by default, same production and account gates as the guards; it replaces the guards when both are on", () => {
    const env = (e: Record<string, string>) => ({ NODE_ENV: "test", ...e }) as NodeJS.ProcessEnv;
    assert.equal(imageCheckEnabled(env({}), "a"), false);
    assert.equal(imageCheckEnabled(env({ DEARPOLICY_IMAGE_FIGURE_CHECK: "1", DEARPOLICY_ALPHA_ACCOUNTS: "b" }), "a"), false);
    assert.equal(imageCheckEnabled(env({ DEARPOLICY_IMAGE_FIGURE_CHECK: "1", DEARPOLICY_ALPHA_ACCOUNTS: "a" }), "a"), true);
    assert.equal(imageCheckEnabled(env({ DEARPOLICY_IMAGE_FIGURE_CHECK: "1", DEARPOLICY_ALPHA_ACCOUNTS: "a" })), false);
    assert.equal(imageCheckEnabled(env({ DEARPOLICY_IMAGE_FIGURE_CHECK: "1", DEARPOLICY_ALPHA_ACCOUNTS: "a", VERCEL: "1" }), "a"), false);
    assert.equal(imageCheckEnabled(env({ DEARPOLICY_IMAGE_FIGURE_CHECK: "1", DEARPOLICY_ALPHA_ACCOUNTS: "a", VERCEL: "1", DEARPOLICY_FIGURE_GUARDS_ALLOW_PRODUCTION: "1" }), "a"), true);
    assert.equal(imageCheckEnabled(env({ DEARPOLICY_IMAGE_FIGURE_CHECK: "1", DEARPOLICY_FIGURE_GUARDS_ALL_ACCOUNTS: "1" }), "z"), true);
    assert.equal(figureCheckMode(env({ DEARPOLICY_FIGURE_GUARDS: "1", DEARPOLICY_ALPHA_ACCOUNTS: "a" }), "a"), "guards");
    assert.equal(figureCheckMode(env({ DEARPOLICY_FIGURE_GUARDS: "1", DEARPOLICY_IMAGE_FIGURE_CHECK: "1", DEARPOLICY_ALPHA_ACCOUNTS: "a" }), "a"), "image");
    assert.equal(figureChecksOn(env({}), "a"), false);
    assert.deepEqual(imageCheckModels(env({})).map((m) => m.model), ["claude-sonnet-5-5", "claude-opus-5-5"]);
    assert.deepEqual(imageCheckModels(env({ DEARPOLICY_IMAGE_CHECK_MODELS: "claude-x, claude-y" })).map((m) => m.model), ["claude-x", "claude-y"]);
    assert.throws(() => imageCheckModels(env({ DEARPOLICY_IMAGE_CHECK_MODELS: "claude-x" })));
    assert.throws(() => imageCheckModels(env({ DEARPOLICY_IMAGE_CHECK_MODELS: "gpt-4,claude-y" })));
  });

  await test("page source: only pages without their own text layer are checked; the file is read once; a file with no pages to show gives none", async () => {
    const rows = [{ page_number: 1, m: "native" }, { page_number: 2, m: "ocr" }, { page_number: 3, m: "part_checked" }, { page_number: 4, m: "" }];
    let reads = 0;
    const db: Db = async (sql) => sql.includes("FROM policy_pages") ? rows : sql.includes("FROM policies") ? [{ storage_key: "k" }] : [];
    assert.deepEqual(await ocrPagesOf(db, "a", "p"), [2, 3, 4]);
    const tools = { readFile: async () => { reads++; return new Uint8Array([1]); }, asPdf: async (b: Uint8Array) => b, onePage: async (_pdf: Uint8Array, n: number) => new Uint8Array([n]) };
    const s = await pageSourceFor(db, "a", "p", tools);
    assert.deepEqual(s.imagePages, [2, 3, 4]);
    assert.deepEqual(await s.page(2), { kind: "pdf", mediaType: "application/pdf", data: Buffer.from([2]).toString("base64") });
    await s.page(3);
    assert.equal(reads, 1);
    const none = await pageSourceFor(db, "a", "p", { ...tools, asPdf: async () => null });
    assert.equal(await none.page(2), null);
    const broken = await pageSourceFor(db, "a", "p", { ...tools, onePage: async () => { throw new Error("bad page"); } });
    assert.equal(await broken.page(2), null);
    const gone = await pageSourceFor(db, "a", "p", { ...tools, readFile: async () => { throw new Error("gone"); } });
    assert.equal(await gone.page(2), null);
  });

  // ---- End to end through readDocument and the Coverage table, with a fake database. ----
  const A = "acct-1";
  let stamp = 0;
  function fakeDb() {
    const s = { readings: new Map<string, { account_id: string; reading: string; read_at?: string }>(), figures: new Map<string, { account_id: string; policy_id: string; claim_key: string; value: number }>() };
    const db: Db = async (sql, p) => {
      const q = sql.replace(/\s+/g, " ").trim();
      if (q.includes("to_regclass('public.benefit_figure_confirmations')")) return [{ ok: true }];
      if (q.startsWith("SELECT to_regclass")) return [{ ok: true }];
      if (q.startsWith("SELECT id, display_name, preferred_name FROM family_members")) return p[0] === A ? [{ id: "p1", display_name: "Lim Ah Kow", preferred_name: null }] : [];
      if (q.startsWith("SELECT id, original_filename, processing_status"))
        return p[0] === A && (p.length < 2 || p[1] === DOC.id) ? [{ id: DOC.id, account_id: A, original_filename: "Example Travel Policy.pdf", processing_status: "ready", lifecycle_state: "active", superseded_at: null, reading_live: true }] : [];
      if (q.startsWith("SELECT policy_id, page_number, text FROM policy_pages")) return p[0] === A ? PAGES.map((x) => ({ policy_id: DOC.id, page_number: x.page, text: x.text })) : [];
      if (q.startsWith("INSERT INTO benefit_readings")) { s.readings.set(p[0] as string, { account_id: p[1] as string, reading: p[2] as string, read_at: `t${++stamp}` }); return []; }
      if (q.startsWith("SELECT reading, read_at::text AS read_at FROM benefit_readings WHERE policy_id=$1")) { const r = s.readings.get(p[0] as string); return r && r.account_id === p[1] ? [{ reading: r.reading, read_at: r.read_at }] : []; }
      if (q.startsWith("SELECT reading FROM benefit_readings WHERE policy_id=$1")) { const r = s.readings.get(p[0] as string); return r && r.account_id === p[1] ? [{ reading: r.reading }] : []; }
      if (q.startsWith("UPDATE benefit_readings SET reading=jsonb_set(reading, '{guards}'")) {
        const r = s.readings.get(p[0] as string);
        if (!r || r.account_id !== p[1] || r.read_at !== p[3]) return [];
        r.reading = JSON.stringify({ ...JSON.parse(r.reading), guards: JSON.parse(p[2] as string) });
        return [{ ok: 1 }];
      }
      if (q.startsWith("SELECT policy_id, reading FROM benefit_readings")) return [...s.readings].filter(([, r]) => r.account_id === p[0]).map(([policy_id, r]) => ({ policy_id, reading: r.reading }));
      if (q.startsWith("SELECT section_key, cover_key, why, chosen_by FROM benefit_links"))
        return [{ section_key: sectionKeyOf(DOC.id, { section: "Section 2 Travel inconvenience", column: "Business" }), cover_key: coverKeyOf({ product: "Example Travel Policy", cover: "Travel Basic Plan", plan: "Business" }), why: "test", chosen_by: "household" }];
      if (q.startsWith("SELECT family_member_id, cover_key, status, sum_insured, updated_at FROM benefit_confirmations")) return [];
      if (q.startsWith("SELECT policy_id, claim_key, value FROM benefit_figure_confirmations")) return [...s.figures.values()].filter((f) => f.account_id === p[0]);
      if (q.startsWith("INSERT INTO benefit_figure_confirmations")) { s.figures.set(`${p[0]}|${p[1]}|${p[2]}`, { account_id: p[0] as string, policy_id: p[1] as string, claim_key: p[2] as string, value: p[3] as number }); return []; }
      if (q.startsWith("UPDATE policies") || q.startsWith("DELETE FROM benefit_links") || q.startsWith("INSERT INTO benefit_links")) return [];
      throw new Error("fake db: unexpected statement " + q.slice(0, 90));
    };
    return { db, s };
  }
  const readerModel = () => { const calls: TableCall[] = []; const model: TableModel = { choice: { provider: "anthropic", model: "reader-1" },
    async call(c) { calls.push(c); return { json: reading(), stopReason: "end_turn", model: "reader-1", input: 100, output: 50, ms: 1 }; } }; return { model, calls }; };
  const setup = (a: ReturnType<typeof checker>, b: ReturnType<typeof checker>, pages = [2]): GuardSetup => ({ kind: "image", first: a.checker, second: b.checker, capUsd: 1, source: async () => source(pages) });
  const envOn = () => { process.env.DEARPOLICY_IMAGE_FIGURE_CHECK = "1"; process.env.DEARPOLICY_ALPHA_ACCOUNTS = A; };
  const envOff = () => { delete process.env.DEARPOLICY_IMAGE_FIGURE_CHECK; delete process.env.DEARPOLICY_ALPHA_ACCOUNTS; };
  const tripFigure = (t: Awaited<ReturnType<typeof tableFor>>) => t.table.people[0]?.rows.find((x) => x.benefit === "Trip postponement" && x.column === "Business")?.figure;

  await test("switch on, end to end: the OCR misread is never shown; the household is asked with the page's figure, and their answer is used", async () => {
    envOn();
    try {
      const f = fakeDb(), r1 = readerModel(), a = checker("first"), b = checker("second");
      const res = await readDocument(f.db, r1.model, A, DOC.id, undefined, {}, setup(a, b));
      assert.equal(res.read, true);
      assert.equal(res.figuresChecking, 0);
      assert.equal(a.calls.length, 1, "page 2 only: page 1 has its own text layer");
      const t = await tableFor(f.db, A);
      assert.equal(tripFigure(t)?.kind, "none", "51000 is never shown");
      assert.equal(t.figureChecks?.length, 1);
      assert.deepEqual(t.figureChecks![0].candidates, [1000]);
      await setFigureConfirmation(f.db, A, "u1", DOC.id, t.figureChecks![0].claimKey, 1000);
      const after = await tableFor(f.db, A);
      assert.deepEqual(after.figureChecks, []);
      assert.equal((tripFigure(after) as { amount: number }).amount, 1000);
    } finally { envOff(); }
  });

  await test("a check call that fails never loses the paid reading; the continuation finishes it on the same reading", async () => {
    envOff();
    const f = fakeDb(), r1 = readerModel();
    const res = await readDocument(f.db, r1.model, A, DOC.id, undefined, {}, setup(checker("first", undefined, { throws: true }), checker("second")));
    assert.equal(res.read, true);
    assert.equal(res.figuresChecking, 3);
    const g = JSON.parse(f.s.readings.get(DOC.id)!.reading).guards as GuardRecord;
    assert.equal(g.stopped, "error");
    const a = checker("first");
    const done = await guardStoredReading(f.db, A, DOC.id, setup(a, checker("second")), {}, g.at);
    assert.equal(done.checked, true);
    assert.equal(a.calls.length, 1);
    const after = JSON.parse(f.s.readings.get(DOC.id)!.reading).guards as GuardRecord;
    assert.equal(Object.values(after.verdicts).filter((v) => v.status === "checking").length, 0);
  });

  await test("a source that cannot be opened (a database error) stores the reading, with its figures left to the continuation", async () => {
    envOff();
    const f = fakeDb(), r1 = readerModel();
    const res = await readDocument(f.db, r1.model, A, DOC.id, undefined, {}, { ...setup(checker("first"), checker("second")), source: async () => { throw new Error("db down"); } } as GuardSetup);
    assert.equal(res.read, true);
    assert.ok((res.figuresChecking ?? 0) > 0);
    assert.equal((JSON.parse(f.s.readings.get(DOC.id)!.reading).guards as GuardRecord).version, IMAGE_CHECK_VERSION);
  });

  await test("switch off: a stored image check changes nothing on any page", async () => {
    envOff();
    const f = fakeDb(), r1 = readerModel();
    await readDocument(f.db, r1.model, A, DOC.id, undefined, {}, setup(checker("first"), checker("second")));
    const t = await tableFor(f.db, A);
    assert.equal(t.figureChecks, undefined);
    assert.equal((tripFigure(t) as { amount: number }).amount, 51000, "with the switch off the table is exactly as before");
  });

  await test("the continuation job does nothing while the check is off", async () => {
    envOff();
    const { processFigureCheckJob } = await import("@/lib/benefit-table/app");
    await processFigureCheckJob({ account_id: A, payload: { policyId: DOC.id, at: "t", run: 1 } });
  });

  if (failures.length) { console.error(`${failures.length} failed, ${passed} passed:\n- ${failures.join("\n- ")}`); process.exit(1); }
  console.log(`image figure check: ${passed} passed`);
}
void main();
