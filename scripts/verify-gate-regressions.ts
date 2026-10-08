/**
 * Gate R17: the save-time answer gate (lib/chat/answer-verification.ts verifyAnswerFigures) -- three confirmed
 * loopholes closed, each with negative cases and positive controls (npm run verify:gate-test).
 *
 *  U  rule 1, the household's own numbers: no more "any number the user typed is exempt". A user figure stands only
 *     with attribution in the same sentence, exactly as they wrote it (value AND currency -- a bare number gets no
 *     currency, a bare "$" is not S$), and never in a sentence that states cover, a limit, a payable amount or a total.
 *  B  rule 2, scope binding: a figure is grounded only by its own sentence's binding -- that policy, person, benefit
 *     row, version (file hash), page range and passage, and the person's / tier's column of a per-person table.
 *     A figure printed on another page, another policy, another row, another column, a superseded version not
 *     presented as superseded, or only another sentence's citation, is removed.
 *  C  rule 3, computed figures: no subset-sum search, no loose /12, no "N ×" heuristic, no derived-from-derived chaining.
 *     A total / restatement / multiple stands only with an explicit computation record the gate recomputes.
 *  L  a policy-stated limit card stands only with its own binding.
 *  D  a deleted (non-active) document grounds nothing (the lifecycle predicate on the gate's reads).
 *  W  the gate is wired: saveTurn attaches the turn's bindings and runs the gate before storing; the workflow runs
 *     every turn in a provenance scope.
 *
 * PGlite with the real schema; every check runs; exit 1 if any failed.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 6).join("\n     ")); }
}

async function main() {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite/vector");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { pool } = await import("@/lib/db/client");
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of ["schema.sql", "chat-upgrade.sql", "benefit-catalog.sql", "model-usage.sql", "model-provenance.sql", "coverage-ledger.sql", "cover-conditions.sql", "background-jobs.sql", "household-rls.sql", "lifecycle.sql"])
    await db.exec(await readFile(path.resolve("sql/" + file), "utf8"));
  const execute = async (text: string, params: unknown[] = []) => { const r = await db.query(text, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; };
  pool.query = (async (text: string, params: unknown[] = []) => execute(text, params)) as typeof pool.query;
  pool.connect = (async () => ({ query: execute, release() {} })) as unknown as typeof pool.connect;

  const A = "00000000-0000-0000-0000-0000000000b1";
  const id = (n: number) => "50000000-0000-4000-8000-" + String(n).padStart(12, "0");
  const me = { id: id(1), name: "Lim Wei Ming", pref: "Wei Ming", rel: "self" }, spouse = { id: id(2), name: "Tan Hui Ling", pref: "Hui Ling", rel: "spouse" }, child = { id: id(3), name: "Lim Jia Hui", pref: "Jia Hui", rel: "child" };
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Household B')", [A]);
  for (const p of [me, spouse, child]) await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,$3,$4,$5)", [p.id, A, p.name, p.pref, p.rel]);
  type D = { id: string; member: string; product: string; hash: string; superseded?: boolean; deleted?: boolean; members?: string[]; pages: Record<number, string> };
  const docs: Record<string, D> = {
    TERM: { id: id(101), member: me.id, product: "Term Shield", hash: "sha256:term", pages: { 2: "Term Shield schedule\nLife assured: Lim Wei Ming\nDeath benefit S$300,000\nTotal and permanent disability S$150,000\nAnnual premium S$1,200 per year", 3: "Critical illness S$500,000" } },
    ACC: { id: id(102), member: me.id, product: "Accident Plan", hash: "sha256:acc", pages: { 2: "Accident Plan schedule\nAccidental death S$500,000\nHospital cash S$100 per day\nLifetime limit S$50,000\nAnnual premium S$300 per year" } },
    GROUP: { id: id(103), member: me.id, product: "Staff GHS", hash: "sha256:ghs", members: [spouse.id, child.id], pages: { 4: "Group Hospital & Surgical schedule of benefits\nBenefit\tEmployee\tSpouse\tChild\nHospital room & board\tS$500 per day\tS$300 per day\tS$200 per day\nDependants' premiums (deducted from salary)\nSpouse S$612.00 per year\nEach child S$298.00 per year" } },
    OLD: { id: id(104), member: me.id, product: "Term Shield (2019)", hash: "sha256:old", superseded: true, pages: { 2: "Term Shield schedule 2019\nDeath benefit S$250,000" } },
    SPOUSE: { id: id(105), member: spouse.id, product: "Spouse Life", hash: "sha256:spouse", pages: { 2: "Spouse Life schedule\nLife assured: Tan Hui Ling\nDeath benefit S$200,000\nAnnual premium S$800 per year" } },
    MULTI: { id: id(106), member: me.id, product: "Hospital Plan", hash: "sha256:multi", pages: { 5: "Hospitalisation benefits (continued on next page)\nRoom and board", 6: "Room and board limit S$1,000 per day\nSurgical fees as charged" } },
    USD: { id: id(107), member: me.id, product: "Dollar Life", hash: "sha256:usd", pages: { 2: "Dollar Life schedule\nDeath benefit US$100,000\nAnnual premium US$500 per year" } },
    GONE: { id: id(108), member: me.id, product: "Deleted Life", hash: "sha256:gone", deleted: true, pages: { 2: "Deleted Life schedule\nDeath benefit S$900,000" } },
  };
  for (const d of Object.values(docs)) {
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,superseded_at,file_hash)
      VALUES($1,$2,$3,'Example Insurer',$4,$5,'Life','certificate',true,90,'ready',$6,$6,'scan_clean',$7,$8,$9)`, [d.id, A, d.member, d.product, "N-" + d.id.slice(-3), d.product + ".pdf", d.deleted ? "soft_deleted" : "active", d.superseded ? new Date().toISOString() : null, d.hash]);
    await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$3,'test',1) ON CONFLICT DO NOTHING", [d.id, d.member, A]);
    for (const m of d.members ?? []) await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$3,'test',1) ON CONFLICT DO NOTHING", [d.id, m, A]);
    for (const [page, text] of Object.entries(d.pages)) await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [A, d.id, Number(page), text]);
  }
  const { verifyAnswerFigures, FIGURE_LEFT_OUT_NOTE } = await import("@/lib/chat/answer-verification");
  type Any = Record<string, unknown>;
  const cite = (d: D, p1: number, p2 = p1) => ({ chunkId: "page:" + d.id + ":" + p1, policyId: d.id, policyName: d.product, pageStart: p1, pageEnd: p2 });
  /** A binding: policy, person, benefit, version, page range, passage. */
  const bind = (d: D, subjectId: string, benefit: string, page: number, passage: string, o: Any = {}) => ({ policyId: d.id, subjectId, benefit, documentHash: d.hash, pageStart: page, pageEnd: page, passage, ...o });
  const fig = (sentence: string, value: number, currency: string, b: Any) => ({ ...b, sentence, value, currency });
  const answer = (summary: string, details: string[], cites: Any[], extra: Any = {}) => ({ mode: "answer", summary, details, claimItems: [], nextSteps: [], confidence: null, citations: cites, disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [], ...extra }) as unknown as import("@/types").ChatAnswer;
  const run = async (a: import("@/types").ChatAnswer, userText?: string) => verifyAnswerFigures(a, { accountId: A, userText });
  const text = (a: import("@/types").ChatAnswer) => [a.summary, ...a.details].join(" ");
  const rejected = async (label: string, a: import("@/types").ChatAnswer, figure: RegExp, userText?: string) => {
    const p = await run(a, userText);
    assert.ok(p.length >= 1, label + ": accepted -- " + text(a));
    assert.ok(!figure.test(text(a)), label + ": the figure is still shown -- " + text(a));
    assert.ok(text(a).includes(FIGURE_LEFT_OUT_NOTE), label + ": the answer does not say a figure was left out");
  };
  const accepted = async (label: string, a: import("@/types").ChatAnswer, userText?: string) => {
    const before = text(a);
    const p = await run(a, userText);
    assert.deepEqual(p, [], label + ": rejected -- " + JSON.stringify(p));
    assert.equal(text(a), before, label + ": the text changed");
  };
  const P = docs;
  const termDeath = (s: string) => fig(s, 300000, "SGD", bind(P.TERM, me.id, "Death benefit", 2, "Death benefit S$300,000"));
  const premiumOp = (d: D, who: string, v: number, cur = "SGD", passage = "Annual premium S$" + v.toLocaleString("en-US") + " per year") => ({ value: v, currency: cur, period: "year", role: "premium", binding: bind(d, who, "Annual premium", 2, passage) });

  // ================================================================ U rule 1: the household's own numbers
  await check("U01 'is my cover 500000?' never makes 'your cover is S$500,000' true (the document says S$300,000)", async () => {
    await rejected("no binding", answer("Your cover is S$500,000.", [], [cite(P.TERM, 2)]), /500,000/, "is my cover 500000?");
    const s = "Your death benefit cover is S$500,000.";
    await rejected("bound to a passage that prints S$300,000", answer(s, [], [cite(P.TERM, 2)], { figureBindings: [fig(s, 500000, "SGD", bind(P.TERM, me.id, "Death benefit", 2, "Death benefit S$300,000"))] }), /500,000/, "is my cover 500000?");
  });
  await check("U02 the household's '3 days' never grounds 'S$3'", async () => {
    await rejected("3 days", answer("Hospital cash is S$3 per day.", [], [cite(P.ACC, 2)]), /S\$3\b/, "I was in hospital for 3 days");
  });
  await check("U03 a figure from the household's message without attribution is removed", async () => {
    await rejected("no attribution", answer("The bill of S$5,000 has been noted.", [], [cite(P.TERM, 2)]), /5,000/, "the bill was S$5,000");
  });
  await check("U04 a user figure never states or feeds a limit, cover or total", async () => {
    await rejected("as a limit", answer("You mentioned S$300,000, which is your death benefit limit.", [], [cite(P.TERM, 2)]), /300,000/, "my bill was S$300,000");
    const s = "You mentioned a bill of S$5,000, so together with the death benefit that totals S$305,000.";
    const rec = { sentence: s, result: { value: 305000, currency: "SGD" }, operation: "sum", period: null, currency: "SGD", rounding: { mode: "half_up", precision: 2 },
      operands: [{ value: 5000, currency: "SGD", period: null, role: "user", user: true }, { value: 300000, currency: "SGD", period: null, role: "benefit", binding: bind(P.TERM, me.id, "Death benefit", 2, "Death benefit S$300,000") }] };
    await rejected("as a total operand", answer(s, [], [cite(P.TERM, 2)], { computations: [rec] }), /305,000/, "the bill was S$5,000");
  });
  await check("U05 a currency the household did not give is never added (5000 -> S$5,000; $5,000 -> S$5,000)", async () => {
    await rejected("bare number", answer("You mentioned a bill of S$5,000.", [], []), /5,000/, "the bill was 5000");
    await rejected("bare $", answer("You mentioned a bill of S$5,000.", [], []), /5,000/, "the bill was $5,000");
  });
  await check("U06 positive: an exact, attributed echo of the household's figure stays", async () => {
    await accepted("S$ echo", answer("You mentioned a bill of S$5,000.", [], []), "the bill was S$5,000");
    await accepted("bare $ echo", answer("You mentioned a bill of $5,000.", [], []), "the bill was $5,000");
  });

  // ================================================================ B rule 2: scope binding
  await check("B01 a figure printed only on another page of the same policy is removed", async () => {
    const s = "Term Shield critical illness cover is S$500,000.";
    await rejected("other page", answer(s, [], [cite(P.TERM, 2)], { figureBindings: [fig(s, 500000, "SGD", bind(P.TERM, me.id, "Critical illness", 2, "Term Shield schedule"))] }), /500,000/);
  });
  await check("B02 a figure printed only in another cited policy is removed", async () => {
    const s = "Term Shield death benefit is S$500,000.";
    await rejected("other policy", answer(s, [], [cite(P.TERM, 2), cite(P.ACC, 2)], { figureBindings: [fig(s, 500000, "SGD", bind(P.TERM, me.id, "Death benefit", 2, "Death benefit S$300,000"))] }), /500,000/);
  });
  await check("B03 a figure on another benefit's row of the same page is removed", async () => {
    const s = "Term Shield total and permanent disability benefit is S$300,000.";
    await rejected("other row", answer(s, [], [cite(P.TERM, 2)], { figureBindings: [fig(s, 300000, "SGD", bind(P.TERM, me.id, "Total and permanent disability", 2, "Death benefit S$300,000\nTotal and permanent disability S$150,000"))] }), /300,000/);
  });
  await check("B04 a figure from another person's / tier's column is removed", async () => {
    const row = "Hospital room & board\tS$500 per day\tS$300 per day\tS$200 per day";
    const s = "Hui Ling’s hospital room & board benefit is S$500 per day.";
    await rejected("wrong column", answer(s, [], [cite(P.GROUP, 4)], { figureBindings: [fig(s, 500, "SGD", bind(P.GROUP, spouse.id, "Hospital room & board", 4, row, { column: "Spouse" }))] }), /S\$500/);
    await rejected("employee column for the spouse", answer(s, [], [cite(P.GROUP, 4)], { figureBindings: [fig(s, 500, "SGD", bind(P.GROUP, spouse.id, "Hospital room & board", 4, row, { column: "Employee" }))] }), /S\$500/);
    await rejected("no column at all", answer(s, [], [cite(P.GROUP, 4)], { figureBindings: [fig(s, 500, "SGD", bind(P.GROUP, spouse.id, "Hospital room & board", 4, row))] }), /S\$500/);
  });
  await check("B05 a superseded version not presented as superseded is removed", async () => {
    const s = "Your death benefit is S$250,000.";
    await rejected("superseded", answer(s, [], [cite(P.OLD, 2)], { figureBindings: [fig(s, 250000, "SGD", bind(P.OLD, me.id, "Death benefit", 2, "Death benefit S$250,000", { presentedAsSuperseded: true }))] }), /250,000/);
  });
  await check("B06 a sentence without its own binding is not grounded by another sentence's citation", async () => {
    const s1 = "Term Shield death benefit is S$300,000.", s2 = "Spouse Life death benefit is S$200,000.";
    const a = answer(s1 + " " + s2, [], [cite(P.TERM, 2), cite(P.SPOUSE, 2)], { figureBindings: [termDeath(s1)] });
    const p = await run(a);
    assert.equal(p.length, 1, JSON.stringify(p)); assert.match(a.summary, /300,000/); assert.ok(!/200,000/.test(a.summary), a.summary);
  });
  await check("B07 the wrong version (file hash), the wrong person, or the wrong benefit named is removed", async () => {
    const s = "Term Shield death benefit is S$300,000.";
    await rejected("hash", answer(s, [], [cite(P.TERM, 2)], { figureBindings: [fig(s, 300000, "SGD", bind(P.TERM, me.id, "Death benefit", 2, "Death benefit S$300,000", { documentHash: "sha256:other" }))] }), /300,000/);
    await rejected("person", answer(s, [], [cite(P.TERM, 2)], { figureBindings: [fig(s, 300000, "SGD", bind(P.TERM, spouse.id, "Death benefit", 2, "Death benefit S$300,000"))] }), /300,000/);
    const s2 = "Term Shield pays S$300,000.";
    await rejected("benefit not named", answer(s2, [], [cite(P.TERM, 2)], { figureBindings: [fig(s2, 300000, "SGD", bind(P.TERM, me.id, "Death benefit", 2, "Death benefit S$300,000"))] }), /300,000/);
  });
  await check("B08 positives: the right page / row / person, a multi-page cited range, a superseded figure labelled superseded", async () => {
    const s = "Term Shield death benefit is S$300,000.";
    await accepted("own binding", answer(s, [], [cite(P.TERM, 2)], { figureBindings: [termDeath(s)] }));
    const row = "Hospital room & board\tS$500 per day\tS$300 per day\tS$200 per day";
    const s2 = "Hui Ling’s hospital room & board benefit is S$300 per day.";
    await accepted("spouse column", answer(s2, [], [cite(P.GROUP, 4)], { figureBindings: [fig(s2, 300, "SGD", bind(P.GROUP, spouse.id, "Hospital room & board", 4, row, { column: "Spouse" }))] }));
    const s3 = "Hospital Plan room and board limit is S$1,000 per day.";
    await accepted("multi-page", answer(s3, [], [cite(P.MULTI, 5, 6)], { figureBindings: [fig(s3, 1000, "SGD", bind(P.MULTI, me.id, "Room and board", 5, "Room and board\nRoom and board limit S$1,000 per day", { pageEnd: 6 }))] }));
    const s4 = "The earlier schedule, since replaced, stated a death benefit of S$250,000.";
    await accepted("labelled superseded", answer(s4, [], [cite(P.OLD, 2)], { figureBindings: [fig(s4, 250000, "SGD", bind(P.OLD, me.id, "Death benefit", 2, "Death benefit S$250,000", { presentedAsSuperseded: true }))] }));
  });

  // ================================================================ C rule 3: computed figures
  const detailsBound = () => { const d1 = "Term Shield death benefit is S$300,000.", d2 = "Term Shield total and permanent disability benefit is S$150,000.";
    return { details: [d1, d2], bindings: [termDeath(d1), fig(d2, 150000, "SGD", bind(P.TERM, me.id, "Total and permanent disability", 2, "Total and permanent disability S$150,000"))] }; };
  await check("C01 a coincidental subset sum of stated figures is not a total", async () => {
    const { details, bindings } = detailsBound();
    await rejected("subset sum", answer("Your cover adds up to S$450,000.", details, [cite(P.TERM, 2)], { figureBindings: bindings }), /450,000/);
  });
  await check("C02 a premium plus a benefit is never a total", async () => {
    const s = "Altogether that is S$301,200.";
    const rec = { sentence: s, result: { value: 301200, currency: "SGD" }, operation: "sum", period: null, currency: "SGD", rounding: { mode: "half_up", precision: 2 },
      operands: [{ ...premiumOp(P.TERM, me.id, 1200), period: null }, { value: 300000, currency: "SGD", period: null, role: "benefit", binding: bind(P.TERM, me.id, "Death benefit", 2, "Death benefit S$300,000") }] };
    await rejected("premium + benefit", answer(s, [], [cite(P.TERM, 2)], { computations: [rec] }), /301,200/);
    const lie = { ...rec, operands: [{ ...rec.operands[0], role: "benefit" }, rec.operands[1]] };
    await rejected("premium declared a benefit", answer(s, [], [cite(P.TERM, 2)], { computations: [lie] }), /301,200/);
  });
  await check("C03 different people's figures are not added unless stated as a household total", async () => {
    const s = "You pay S$2,000 a year in premiums.";
    const rec = { sentence: s, result: { value: 2000, currency: "SGD" }, operation: "sum", period: "year", currency: "SGD", rounding: { mode: "half_up", precision: 2 }, scope: "person", operands: [premiumOp(P.TERM, me.id, 1200), premiumOp(P.SPOUSE, spouse.id, 800)] };
    await rejected("mixed persons", answer(s, [], [cite(P.TERM, 2), cite(P.SPOUSE, 2)], { computations: [rec] }), /2,000/);
  });
  await check("C04 a per-day figure plus a lifetime limit is never a total", async () => {
    const s = "The accident cover adds up to S$50,100.";
    const rec = { sentence: s, result: { value: 50100, currency: "SGD" }, operation: "sum", period: "day", currency: "SGD", rounding: { mode: "half_up", precision: 2 },
      operands: [{ value: 100, currency: "SGD", period: "day", role: "benefit", binding: bind(P.ACC, me.id, "Hospital cash", 2, "Hospital cash S$100 per day") }, { value: 50000, currency: "SGD", period: "day", role: "benefit", binding: bind(P.ACC, me.id, "Lifetime limit", 2, "Lifetime limit S$50,000") }] };
    await rejected("day + lifetime", answer(s, [], [cite(P.ACC, 2)], { computations: [rec] }), /50,100/);
  });
  await check("C05 currencies are never mixed in one total", async () => {
    const s = "Your death cover adds up to S$400,000.";
    const rec = { sentence: s, result: { value: 400000, currency: "SGD" }, operation: "sum", period: null, currency: "SGD", rounding: { mode: "half_up", precision: 2 },
      operands: [{ value: 300000, currency: "SGD", period: null, role: "benefit", binding: bind(P.TERM, me.id, "Death benefit", 2, "Death benefit S$300,000") }, { value: 100000, currency: "USD", period: null, role: "benefit", binding: bind(P.USD, me.id, "Death benefit", 2, "Death benefit US$100,000") }] };
    await rejected("mixed currency", answer(s, [], [cite(P.TERM, 2), cite(P.USD, 2)], { computations: [rec] }), /400,000/);
  });
  await check("C06 the stated rounding is applied exactly (S$800 a year is S$66.67 a month half-up, never S$67 or rounded down)", async () => {
    const op = premiumOp(P.SPOUSE, spouse.id, 800);
    for (const [shown, value, mode] of [["S$67", 67, "half_up"], ["S$66.67", 66.67, "down"]] as const) {
      const s = "Spouse Life premium works out to " + shown + " a month.";
      const rec = { sentence: s, result: { value, currency: "SGD" }, operation: "per_period", fromPeriod: "year", toPeriod: "month", factor: 12, period: "year", currency: "SGD", rounding: { mode, precision: 2 }, operands: [op] };
      await rejected("rounding " + shown + " " + mode, answer(s, [], [cite(P.SPOUSE, 2)], { computations: [rec] }), new RegExp(shown.replace("$", "\\$")));
    }
  });
  await check("C07 a monthly figure from a yearly one needs an explicit conversion record", async () => {
    const s1 = "Term Shield annual premium is S$1,200 a year.";
    await rejected("no record", answer(s1 + " That is about S$100 a month.", [], [cite(P.TERM, 2)], { figureBindings: [fig(s1, 1200, "SGD", bind(P.TERM, me.id, "Annual premium", 2, "Annual premium S$1,200 per year"))] }), /S\$100 a month/);
  });
  await check("C08 a figure derived from a derived figure needs its own record ('about' proves nothing)", async () => {
    const s1 = "Your household pays S$2,000 a year in premiums.";
    const rec = { sentence: s1, result: { value: 2000, currency: "SGD" }, operation: "sum", period: "year", currency: "SGD", rounding: { mode: "half_up", precision: 2 }, scope: "household", operands: [premiumOp(P.TERM, me.id, 1200), premiumOp(P.SPOUSE, spouse.id, 800)] };
    const a = answer(s1 + " That is about S$166.67 a month.", [], [cite(P.TERM, 2), cite(P.SPOUSE, 2)], { computations: [rec] });
    const p = await run(a);
    assert.equal(p.length, 1, JSON.stringify(p)); assert.match(a.summary, /2,000/); assert.ok(!/166\.67/.test(a.summary), a.summary);
    const { details, bindings } = detailsBound();
    await rejected("about, no record", answer("Altogether that is about S$301,200.", [...details, "Term Shield annual premium is S$1,200 a year."], [cite(P.TERM, 2)], { figureBindings: [...bindings, fig("Term Shield annual premium is S$1,200 a year.", 1200, "SGD", bind(P.TERM, me.id, "Annual premium", 2, "Annual premium S$1,200 per year"))] }), /301,200/);
  });
  await check("C09 positives: an explicit sum of two bound premiums; 3 × a bound dependant premium; yearly -> monthly with factor 12 half-up; a household total per currency", async () => {
    const s = "You pay S$1,500 a year in premiums.";
    await accepted("sum", answer(s, [], [cite(P.TERM, 2), cite(P.ACC, 2)], { computations: [{ sentence: s, result: { value: 1500, currency: "SGD" }, operation: "sum", period: "year", currency: "SGD", rounding: { mode: "half_up", precision: 2 }, scope: "person", operands: [premiumOp(P.TERM, me.id, 1200), premiumOp(P.ACC, me.id, 300)] }] }));
    const s2 = "The child premium for three children is 3 × S$298.00 = S$894 a year.";
    const childB = bind(P.GROUP, child.id, "Each child premium", 4, "Dependants' premiums (deducted from salary)\nSpouse S$612.00 per year\nEach child S$298.00 per year");
    await accepted("product", answer(s2, [], [cite(P.GROUP, 4)], { figureBindings: [fig(s2, 298, "SGD", childB)], computations: [{ sentence: s2, result: { value: 894, currency: "SGD" }, operation: "product", factor: 3, period: "year", currency: "SGD", rounding: { mode: "half_up", precision: 2 }, operands: [{ value: 298, currency: "SGD", period: "year", role: "premium", binding: childB }] }] }));
    const s3 = "Spouse Life annual premium is S$800 a year, which is S$66.67 a month.";
    await accepted("per period", answer(s3, [], [cite(P.SPOUSE, 2)], { figureBindings: [fig(s3, 800, "SGD", bind(P.SPOUSE, spouse.id, "Annual premium", 2, "Annual premium S$800 per year"))],
      computations: [{ sentence: s3, result: { value: 66.67, currency: "SGD" }, operation: "per_period", fromPeriod: "year", toPeriod: "month", factor: 12, period: "year", currency: "SGD", rounding: { mode: "half_up", precision: 2 }, operands: [premiumOp(P.SPOUSE, spouse.id, 800)] }] }));
    const s4 = "Your household pays S$2,000 and US$500 a year in premiums.";
    await accepted("household per currency", answer(s4, [], [cite(P.TERM, 2), cite(P.SPOUSE, 2), cite(P.USD, 2)], {
      figureBindings: [fig(s4, 500, "USD", bind(P.USD, me.id, "Annual premium", 2, "Annual premium US$500 per year"))],
      computations: [{ sentence: s4, result: { value: 2000, currency: "SGD" }, operation: "sum", period: "year", currency: "SGD", rounding: { mode: "half_up", precision: 2 }, scope: "household", operands: [premiumOp(P.TERM, me.id, 1200), premiumOp(P.SPOUSE, spouse.id, 800)] }] }));
    // A monthly restatement of a household total: an explicit nested record (never chained by the gate on its own).
    const s5 = "Your household pays S$2,000 a year in premiums, about S$166.67 a month.";
    const total = { sentence: "", result: { value: 2000, currency: "SGD" }, operation: "sum", period: "year", currency: "SGD", rounding: { mode: "half_up", precision: 2 }, scope: "household", operands: [premiumOp(P.TERM, me.id, 1200), premiumOp(P.SPOUSE, spouse.id, 800)] };
    await accepted("nested explicit", answer(s5, [], [cite(P.TERM, 2), cite(P.SPOUSE, 2)], { computations: [{ ...total, sentence: s5 }, { sentence: s5, result: { value: 166.67, currency: "SGD" }, operation: "per_period", fromPeriod: "year", toPeriod: "month", factor: 12, period: "year", currency: "SGD", rounding: { mode: "half_up", precision: 2 }, scope: "household", operands: [{ value: 2000, currency: "SGD", period: "year", role: "premium", computation: total }] }] }));
  });

  // ================================================================ L limit cards
  await check("L01 a policy-stated limit card stands only with its own binding", async () => {
    const card = (b?: Any) => ({ kind: "policy_stated_limit", label: "Policy-stated coverage limit", notice: "", benefitTitle: "Death benefit", ownerName: null, amount: 300000, currency: "SGD", amountText: "S$300,000", quote: "Death benefit S$300,000", citation: cite(P.TERM, 2), ...(b ? { binding: b } : {}) });
    const a = answer("Here is the limit.", [], [cite(P.TERM, 2)], { policyStatedLimits: [card(), card(bind(P.TERM, me.id, "Death benefit", 2, "Death benefit S$300,000")), card(bind(P.TERM, me.id, "Death benefit", 3, "Critical illness S$500,000"))] });
    await run(a);
    assert.equal((a.policyStatedLimits ?? []).length, 1, JSON.stringify(a.policyStatedLimits));
    assert.ok((a.policyStatedLimits ?? [])[0].binding, "the bound card is the one kept");
  });

  // ================================================================ D lifecycle
  await check("D01 a deleted (non-active) document grounds nothing, however well its binding matches", async () => {
    const s = "Deleted Life death benefit is S$900,000.";
    await rejected("soft-deleted", answer(s, [], [cite(P.GONE, 2)], { figureBindings: [fig(s, 900000, "SGD", bind(P.GONE, me.id, "Death benefit", 2, "Death benefit S$900,000"))] }), /900,000/);
  });

  // ================================================================ W wiring
  await check("W01 saveTurn attaches the turn's bindings and runs the gate before storing; every turn runs in a provenance scope", async () => {
    const src = await readFile(path.resolve("lib/chat/workflow.ts"), "utf8");
    const save = src.slice(src.indexOf("const saveTurn=async"), src.indexOf("return storeTurn(args);") + 30);
    assert.match(save, /attachProvenance\(args\.answer\b/, "saveTurn attaches the bindings");
    assert.ok(save.indexOf("attachProvenance(args.answer") >= 0 && save.indexOf("attachProvenance(args.answer") < save.indexOf("verifyAnswerFigures(args.answer"), "before the gate");
    assert.match(src, /withProvenanceScope\(/, "the workflow runs in a provenance scope");
    const gate = await readFile(path.resolve("lib/chat/answer-verification.ts"), "utf8");
    assert.ok(!/1 << n|mask & \(1 << i\)/.test(gate), "no subset-sum search");
    assert.ok(!/user\.has\(/.test(gate), "no user-number exemption");
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { for (const f of failed) console.log("FAILED: " + f.name); process.exit(1); }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
