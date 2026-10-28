/** Scripted tests for the benefit table's storage and API layer (lib/benefit-table/service.ts), with an in-memory database
 * and a scripted model. Synthetic pages only, no household data, no network.
 *   npm run benefit-table:service-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseAmount } from "@/lib/benefit-table/amount";
import { coverKeyOf, sectionKeyOf } from "@/lib/benefit-table/assemble";
import { anthropicTableModel, type TableCall, type TableModel, type TableReply } from "@/lib/benefit-table/model";
import { ledgerUsage } from "@/lib/simple-chat/model";
import { MAX_PAGE_REREADS, TableInputError, readDocument, relink, setConfirmation, setLink, tableFor, tableReady, type Db } from "@/lib/benefit-table/service";
import { benefitTableEnabled } from "@/lib/benefit-table/flag";

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

type Policy = { id: string; account_id: string; original_filename: string; processing_status: string; lifecycle_state: string; superseded_at: string | null };
/** Just the statements service.ts sends, against in-memory rows. An unknown statement fails the test. */
function fakeDb(opts: { tables?: boolean } = {}) {
  const s = {
    family: [] as { id: string; account_id: string; display_name: string; preferred_name: string | null; lifecycle_state: string }[],
    policies: [] as Policy[],
    pages: [] as { policy_id: string; account_id: string; page_number: number; text: string }[],
    readings: new Map<string, { account_id: string; reading: string; model: string; prompt_version: string }>(),
    links: new Map<string, { account_id: string; section_key: string; cover_key: string | null; why: string; chosen_by: string }>(),
    confirmations: new Map<string, { account_id: string; family_member_id: string; cover_key: string; status: string; sum_insured: number | null; updated_by: string | null; updated_at: string }>(),
  };
  const db: Db = async (sql, p) => {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT to_regclass")) return [{ ok: opts.tables !== false }];
    if (q.startsWith("SELECT id, display_name, preferred_name FROM family_members"))
      return s.family.filter((f) => f.account_id === p[0] && f.lifecycle_state === "active");
    if (q.startsWith("SELECT id, original_filename, processing_status"))
      return s.policies.filter((x) => x.account_id === p[0] && x.lifecycle_state === "active" && !x.superseded_at && (p.length < 2 || x.id === p[1]));
    if (q.startsWith("SELECT policy_id, page_number, text FROM policy_pages"))
      return s.pages.filter((x) => x.account_id === p[0] && (p[1] as string[]).includes(x.policy_id)).sort((a, b) => a.page_number - b.page_number);
    if (q.startsWith("INSERT INTO benefit_readings")) {
      const old = s.readings.get(p[0] as string);
      if (!old || old.account_id === p[1]) s.readings.set(p[0] as string, { account_id: p[1] as string, reading: p[2] as string, model: p[3] as string, prompt_version: p[4] as string });
      return [];
    }
    if (q.startsWith("SELECT policy_id, reading FROM benefit_readings"))
      return [...s.readings].filter(([, r]) => r.account_id === p[0]).map(([policy_id, r]) => ({ policy_id, reading: r.reading }));
    if (q.startsWith("SELECT section_key, cover_key, why, chosen_by FROM benefit_links")) return [...s.links.values()].filter((l) => l.account_id === p[0]);
    if (q.startsWith("DELETE FROM benefit_links")) { for (const [k, l] of s.links) if (l.account_id === p[0] && l.chosen_by === "model") s.links.delete(k); return []; }
    if (q.startsWith("INSERT INTO benefit_links")) {
      const k = `${p[0]}|${p[1]}`, household = q.includes("'household'");
      if (s.links.has(k) && !household) return [];
      s.links.set(k, { account_id: p[0] as string, section_key: p[1] as string, cover_key: p[2] as string | null, why: household ? "Set by you" : p[3] as string, chosen_by: household ? "household" : "model" });
      return [];
    }
    if (q.startsWith("SELECT family_member_id, cover_key, status, sum_insured, updated_at FROM benefit_confirmations"))
      return [...s.confirmations.values()].filter((c) => c.account_id === p[0]);
    if (q.startsWith("DELETE FROM benefit_confirmations")) { s.confirmations.delete(`${p[0]}|${p[1]}|${p[2]}`); return []; }
    if (q.startsWith("INSERT INTO benefit_confirmations")) {
      s.confirmations.set(`${p[0]}|${p[1]}|${p[2]}`, { account_id: p[0] as string, family_member_id: p[1] as string, cover_key: p[2] as string, status: p[3] as string,
        sum_insured: p[4] as number | null, updated_by: p[5] as string | null, updated_at: "2026-10-21" });
      return [];
    }
    throw new Error("fake db: unexpected statement " + q.slice(0, 80));
  };
  return { db, s };
}

/** A model that answers each call from a list, recording what it was asked. */
function scriptedModel(answers: ((c: TableCall) => unknown)[]) {
  const calls: TableCall[] = [];
  const model: TableModel = { choice: { provider: "anthropic", model: "test-model" }, async call(c) {
    calls.push(c);
    const next = answers.shift();
    if (!next) throw new Error("model called more often than scripted");
    const json = next(c);
    return { json, stopReason: json == null ? "max_tokens" : "end_turn", model: "test-model", input: 100, output: 50, ms: 1 } satisfies TableReply;
  } };
  return { model, calls };
}

const A = "acct-a", B = "acct-b";
const doc = (kind: string, covers: unknown[], benefits: unknown[]) => ({ document: { kind, product: "Group Scheme", insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null }, covers, benefits });
const cover = (person: string, sumInsured: number, quote: string) => ({ person, product: "Group Scheme", cover: "Group Personal Accident", plan: null, sumInsured, asOf: null, page: 1, quote });
const benefit = (o: Record<string, unknown>) => ({ section: "Accident", column: null, pays: "words", value: null, percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, ...o });
const gpa = coverKeyOf({ product: "Group Scheme", cover: "Group Personal Accident", plan: null });
const accident = sectionKeyOf("terms", { section: "Accident", column: null });
const SCALE = "Compensation Schedule (% of Sum Insured)\nDeath 100%\nArm 20%\nHip 75%\nKnee 50%\nAnkle 25%";

function household() {
  const f = fakeDb();
  f.s.family.push({ id: "p1", account_id: A, display_name: "Lim Wei Jie", preferred_name: null, lifecycle_state: "active" },
    { id: "p2", account_id: A, display_name: "Tan Mei Ling", preferred_name: null, lifecycle_state: "active" });
  const policy = (id: string, account: string, name: string, status = "ready") =>
    f.s.policies.push({ id, account_id: account, original_filename: name, processing_status: status, lifecycle_state: "active", superseded_at: null });
  policy("cert", A, "Certificate.pdf"); policy("terms", A, "Terms.pdf"); policy("scan", A, "Blurry.jpg", "failed"); policy("other", B, "Theirs.pdf");
  f.s.pages.push({ policy_id: "cert", account_id: A, page_number: 1, text: "CERTIFICATE\nLim Wei Jie\tS$200,000\nTan Mei Ling\tS$100,000" },
    { policy_id: "terms", account_id: A, page_number: 1, text: SCALE },
    { policy_id: "terms", account_id: A, page_number: 2, text: "Ambulance up to S$500 per incident" },
    { policy_id: "scan", account_id: A, page_number: 1, text: "Lim Wei Jie S$1,000" },
    { policy_id: "other", account_id: B, page_number: 1, text: "Someone else S$9,000,000" });
  return f;
}
const certAnswer = () => doc("personal_proof", [cover("Lim Wei Jie", 200000, "Lim Wei Jie S$200,000"), cover("Tan Mei Ling", 100000, "Tan Mei Ling S$100,000")], []);
const termsAnswer = () => doc("scheme_terms", [], [benefit({ benefit: "Arm", pays: "percent", value: 20, percentOf: "sum_insured", quote: "Arm 20%" })]);

async function readBoth(f: ReturnType<typeof household>) {
  await readDocument(f.db, scriptedModel([certAnswer]).model, A, "cert");
  await readDocument(f.db, scriptedModel([termsAnswer, () => doc("scheme_terms", [], [
    benefit({ benefit: "Hip", pays: "percent", value: 75, percentOf: "sum_insured", quote: "Hip 75%" }),
    benefit({ benefit: "Arm", pays: "percent", value: 20, percentOf: "sum_insured", quote: "Arm 20%" })])]).model, A, "terms");
}

async function main() {
  await test("the switch's tables are checked before anything is read or shown", async () => {
    assert.equal(await tableReady(fakeDb({ tables: false }).db), false);
    assert.equal(await tableReady(fakeDb().db), true);
    const later = fakeDb({ tables: false });
    assert.equal(await tableReady(later.db), false, "a no is not remembered");
    let asked = 0;
    const counted: Db = async (sql, p) => { asked++; return fakeDb().db(sql, p); };
    await tableReady(counted); await tableReady(counted);
    assert.equal(asked, 1, "a yes is remembered");
  });
  await test("a document the app could not read is not sent to the model", async () => {
    const f = household(), m = scriptedModel([]);
    const r = await readDocument(f.db, m.model, A, "scan");
    assert.equal(r.read, false);
    assert.equal(m.calls.length, 0);
  });
  await test("another household's document is not found, and nothing is sent or stored", async () => {
    const f = household(), m = scriptedModel([]);
    assert.equal((await readDocument(f.db, m.model, A, "other")).read, false);
    assert.equal(m.calls.length, 0);
    assert.equal(f.s.readings.size, 0);
  });
  await test("a whole-document read is stored with its model and prompt version, and its usage is reported", async () => {
    const f = household(), m = scriptedModel([certAnswer]), used: string[] = [];
    const r = await readDocument(f.db, m.model, A, "cert", (what) => { used.push(what); });
    assert.deepEqual(r, { read: true, pagesReread: 0 });
    assert.deepEqual(used, ["reading"]);
    const stored = f.s.readings.get("cert")!;
    assert.equal(stored.account_id, A);
    assert.equal(stored.model, "test-model");
    assert.ok(JSON.parse(stored.reading).document.covers.length === 2);
  });
  await test("a page with many figures but few rows read is read again on its own, and the new rows are kept", async () => {
    const f = household(), m = scriptedModel([termsAnswer, () => doc("scheme_terms", [], [benefit({ benefit: "Hip", pays: "percent", value: 75, percentOf: "sum_insured", quote: "Hip 75%" })])]);
    const used: string[] = [];
    const r = await readDocument(f.db, m.model, A, "terms", (what) => { used.push(what); });
    assert.equal(r.pagesReread, 1);
    assert.deepEqual(used, ["reading", "page reading"]);
    assert.match(m.calls[1].user, /Hip 75%/);
    assert.doesNotMatch(m.calls[1].user, /Ambulance/);
    const { table } = await tableFor(f.db, A);
    assert.ok(table.unlinkedSections.some((u) => u.section.key === accident));
  });
  await test("a read that does not finish stores nothing and keeps the earlier reading", async () => {
    const f = household();
    await readDocument(f.db, scriptedModel([certAnswer]).model, A, "cert");
    const before = f.s.readings.get("cert")!.reading;
    const r = await readDocument(f.db, scriptedModel([() => null]).model, A, "cert");
    assert.equal(r.read, false);
    assert.match(r.why!, /did not finish/);
    assert.equal(f.s.readings.get("cert")!.reading, before);
  });
  await test("page re-reads are capped", async () => {
    const f = household();
    f.s.pages.push(...Array.from({ length: MAX_PAGE_REREADS + 3 }, (_, i) => ({ policy_id: "terms", account_id: A, page_number: 10 + i, text: SCALE })));
    const m = scriptedModel([termsAnswer, ...Array.from({ length: MAX_PAGE_REREADS + 3 }, () => () => doc("scheme_terms", [], []))]);
    const r = await readDocument(f.db, m.model, A, "terms");
    assert.equal(r.pagesReread, MAX_PAGE_REREADS);
  });
  await test("the table lists each document as read, waiting or not readable, and nobody else's", async () => {
    const f = household();
    await readDocument(f.db, scriptedModel([certAnswer]).model, A, "cert");
    const { documents, table } = await tableFor(f.db, A);
    assert.deepEqual(documents.map((d) => [d.id, d.state]), [["cert", "read"], ["terms", "waiting"], ["scan", "not_readable"]]);
    assert.equal(table.people.find((p) => p.id === "p1")!.covers[0].sumInsured, 200000);
  });
  await test("re-linking asks the model about sections only, keeps the household's links, and drops links to unknown keys", async () => {
    const f = household();
    await readBoth(f);
    const m = scriptedModel([(c) => ({ links: [{ section: accident, cover: gpa, why: "the accident scale" }, { section: "made-up", cover: gpa, why: "x" }, { section: accident, cover: "no-such-cover", why: "y" }] })]);
    const used: string[] = [];
    assert.deepEqual(await relink(f.db, m.model, A, (w) => { used.push(w); }), { proposed: 1 });
    assert.deepEqual(used, ["linking"]);
    const { table } = await tableFor(f.db, A);
    const wei = table.people.find((p) => p.id === "p1")!;
    assert.deepEqual(wei.rows.map((r) => [r.benefit, r.figure.kind === "worked_out" ? r.figure.amount : null]).sort(), [["Arm", 40000], ["Hip", 150000]]);
    await setLink(f.db, A, accident, null);
    const again = scriptedModel([]);
    assert.deepEqual(await relink(f.db, again.model, A), { proposed: 0 });
    assert.equal(again.calls.length, 0, "a section the household placed is not sent again");
    assert.equal(f.s.links.get(`${A}|${accident}`)!.chosen_by, "household");
    assert.equal((await tableFor(f.db, A)).table.people.find((p) => p.id === "p1")!.rows.length, 0);
  });
  await test("the household can only link a section and a cover its own documents show", async () => {
    const f = household();
    await readBoth(f);
    await assert.rejects(setLink(f.db, A, "terms|nothing|", gpa), TableInputError);
    await assert.rejects(setLink(f.db, A, accident, "no|such|cover"), TableInputError);
    await assert.rejects(setLink(f.db, B, accident, gpa), TableInputError, "another household cannot link this household's section");
    await setLink(f.db, A, accident, gpa);
    assert.equal((await tableFor(f.db, A)).table.people.find((p) => p.id === "p2")!.rows.find((r) => r.benefit === "Arm")!.figure.kind, "worked_out");
  });
  // Corrections were removed with Confirm/Correct (DC, 22 Oct 2026): one an older build stored must change nothing (TE #99).
  await test("a stored correction changes no amount: the table uses the printed sum insured (TE #99)", async () => {
    const f = household();
    await readBoth(f);
    await setLink(f.db, A, accident, gpa);
    const before = (await tableFor(f.db, A)).table.people.find((p) => p.id === "p1")!;
    await setConfirmation(f.db, A, "user-1", "p1", gpa, "corrected", 300000);
    const wei = (await tableFor(f.db, A)).table.people.find((p) => p.id === "p1")!;
    assert.equal(wei.covers[0].sumInsured, 200000);
    assert.equal(wei.covers[0].confirmation, null);
    assert.ok(wei.rows.length > 0 && wei.rows.every((r) => !r.baseCorrected));
    assert.deepEqual(wei.rows.map((r) => r.figure), before.rows.map((r) => r.figure));
  });
  await test("confirmations are refused for someone outside the family, a cover they do not hold, or a correction without a number", async () => {
    const f = household();
    await readBoth(f);
    await assert.rejects(setConfirmation(f.db, A, null, "stranger", gpa, "confirmed", null), TableInputError);
    await assert.rejects(setConfirmation(f.db, B, null, "p1", gpa, "confirmed", null), TableInputError, "another household cannot confirm this family's cover");
    await assert.rejects(setConfirmation(f.db, A, null, "p1", "no|such|cover", "confirmed", null), TableInputError);
    await assert.rejects(setConfirmation(f.db, A, null, "p1", gpa, "corrected", null), TableInputError);
    await setConfirmation(f.db, A, "user-1", "p1", gpa, "confirmed", 999);
    assert.equal(f.s.confirmations.get(`${A}|p1|${gpa}`)!.sum_insured, null, "a confirmation stores no amount of its own");
  });
  await test("a stored confirmation is never listed to check again: there is nothing to confirm (TE #99)", async () => {
    const f = household();
    await readBoth(f);
    await setConfirmation(f.db, A, "user-1", "p2", gpa, "confirmed", null);
    await readDocument(f.db, scriptedModel([() => doc("personal_proof", [cover("Lim Wei Jie", 200000, "Lim Wei Jie S$200,000")], [])]).model, A, "cert");
    const { table } = await tableFor(f.db, A);
    assert.deepEqual(table.staleConfirmations, []);
  });
  await test("a removed document leaves the table at once", async () => {
    const f = household();
    await readBoth(f);
    f.s.policies.find((p) => p.id === "cert")!.lifecycle_state = "deleted";
    const { table, documents } = await tableFor(f.db, A);
    assert.equal(table.people.flatMap((p) => p.covers).length, 0);
    assert.ok(!documents.some((d) => d.id === "cert"));
  });

  await test("a document that later fails to process leaves the table, though its reading is kept", async () => {
    const f = household();
    await readBoth(f);
    f.s.policies.find((p) => p.id === "cert")!.processing_status = "failed";
    const { table, documents } = await tableFor(f.db, A);
    assert.equal(table.people.flatMap((p) => p.covers).length, 0);
    assert.equal(documents.find((d) => d.id === "cert")!.state, "not_readable");
    assert.ok(f.s.readings.has("cert"));
  });
  await test("a removed family member's confirmations are not listed to check again", async () => {
    const f = household();
    await readBoth(f);
    await setConfirmation(f.db, A, "user-1", "p2", gpa, "confirmed", null);
    f.s.family.find((p) => p.id === "p2")!.lifecycle_state = "deleted";
    assert.deepEqual((await tableFor(f.db, A)).table.staleConfirmations, []);
  });
  await test("Undo is refused for someone outside the family", async () => {
    const f = household();
    await readBoth(f);
    await assert.rejects(setConfirmation(f.db, A, null, "stranger", gpa, null, null), TableInputError);
  });

  await test("R85-3: with the table switched on, every old ledger read and seed stops at its first line", async () => {
    const body = (file: string, head: string) => { const src = readFileSync(file, "utf8"), i = src.indexOf(head); assert.ok(i >= 0, head); return src.slice(i, i + 600); };
    for (const head of ["export async function readDocumentIntoLedger(", "export async function readPendingDocuments(", "export async function pendingDocumentCount("])
      assert.match(body("lib/ledger/extract.ts", head), /\{\n  if\(await benefitTableOwnsReading\((?:args\.)?accountId\)\)return/, head);
    assert.match(body("lib/ledger/store.ts", "export async function seedLedger("), /if\(await benefitTableLive\(accountId\)\)return \{added:0\}/);
  });

  await test("alpha: in production the table is on only for an account in DEARPOLICY_ALPHA_ACCOUNTS; unset, empty or no account named, it is off", async () => {
    const prod = { DEARPOLICY_BENEFIT_TABLE: "1", DEARPOLICY_BENEFIT_TABLE_ALLOW_PRODUCTION: "1", VERCEL: "1" } as unknown as NodeJS.ProcessEnv;
    assert.equal(benefitTableEnabled(prod, A), false);
    assert.equal(benefitTableEnabled({ ...prod, DEARPOLICY_ALPHA_ACCOUNTS: " , " }, A), false);
    assert.equal(benefitTableEnabled({ ...prod, DEARPOLICY_ALPHA_ACCOUNTS: A }), false);
    assert.equal(benefitTableEnabled({ ...prod, DEARPOLICY_ALPHA_ACCOUNTS: `someone-else ${A.toUpperCase()}` }, A), true);
    assert.equal(benefitTableEnabled({ ...prod, DEARPOLICY_ALPHA_ACCOUNTS: "someone-else" }, A), false);
    assert.equal(benefitTableEnabled({ ...prod, DEARPOLICY_BENEFIT_TABLE: "", DEARPOLICY_ALPHA_ACCOUNTS: A }, A), false);
    assert.equal(benefitTableEnabled({ DEARPOLICY_BENEFIT_TABLE: "1" } as unknown as NodeJS.ProcessEnv, A), true);
    assert.equal(benefitTableEnabled({ DEARPOLICY_BENEFIT_TABLE: "1", DEARPOLICY_ALPHA_ACCOUNTS: "someone-else" } as unknown as NodeJS.ProcessEnv, A), false);
    // Every caller names the account: the switch is read per request, never once for everyone.
    for (const f of ["app/api/benefit-table/route.ts", "app/api/benefit-table/confirm/route.ts", "app/api/benefit-table/link/route.ts", "lib/rag/ingest.ts", "lib/ledger/store.ts", "lib/ledger/extract.ts", "lib/simple-chat/hook.ts"])
      assert.doesNotMatch(readFileSync(f, "utf8"), /benefitTableLive\(\)/, f);
  });

  await test("TE: a typed sum insured is read strictly; words, letters and zero are refused, never guessed", async () => {
    for (const [typed, amount] of [["250000", 250000], ["250,000", 250000], ["S$250,000", 250000], ["$ 1,500,000.00", 1500000], [" 300000.5 ", 300000.5]] as const)
      assert.deepEqual(parseAmount(typed), { ok: true, amount }, typed);
    for (const typed of ["1.5 million", "250k", "abc", "", "0", "0.00", "-5", "25,00", "1,2345", "250 000", "S$250,000 per year", "2.5e5"])
      assert.equal(parseAmount(typed).ok, false, typed);
    const f = household();
    await readBoth(f);
    await assert.rejects(setConfirmation(f.db, A, null, "p1", gpa, "corrected", 0), TableInputError, "the server refuses 0 too");
  });
  // The Correct field this test guarded (TE, 41ab81e) is gone: DC decided on 22 Oct 2026 that people never confirm or
  // correct amounts on Coverage. What is guarded now is that the page has no way to change an amount at all.
  await test("Coverage has nothing to confirm or correct, and posts nothing that changes an amount", async () => {
    const src = readFileSync("components/benefit-table-coverage.tsx", "utf8");
    assert.doesNotMatch(src, /\/api\/benefit-table\/(?:confirm|link)\b/);
    assert.doesNotMatch(src, />\s*(?:Confirm|Correct|Undo)\s*</);
    assert.doesNotMatch(src, /Belongs to/);
    assert.match(src, /\/api\/benefit-table\/report/);
  });

  // Prompt caching (25 Oct 2026): the reading prompt is a cached prefix, the document stays after it, and the reply carries
  // the cache tokens so the ledger can book every prompt token.
  await test("the reading prompt is sent as a cached prefix and cache tokens come back", async () => {
    let sent: { system?: { text: string; cache_control?: unknown }[]; messages?: { content: string }[] } = {};
    const client = { messages: { stream(p: unknown) {
      sent = p as typeof sent;
      return { finalMessage: async () => ({ content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", model: "m",
        usage: { input_tokens: 900, output_tokens: 10, cache_read_input_tokens: 1400, cache_creation_input_tokens: 0 } }) };
    } } };
    const model = anthropicTableModel({ provider: "anthropic", model: "claude-sonnet-5-5" }, client);
    const reply = await model.call({ system: "PROMPT", user: "DOCUMENT", schema: {}, maxTokens: 10 });
    assert.deepEqual(sent.system, [{ type: "text", text: "PROMPT", cache_control: { type: "ephemeral", ttl: "5m" } }]);
    assert.equal(sent.messages?.[0].content, "DOCUMENT", "the household's document is not in the cached prefix");
    assert.equal(reply.input, 900);
    assert.equal(reply.cacheRead, 1400);
    assert.equal(reply.cacheWrite, 0);
    assert.deepEqual(ledgerUsage({ input: 900, output: 10, cacheRead: 1400, cacheWrite: 200 }), { input: 2550, output: 10, cached: 1400 });
  });

  console.log(`benefit-table service: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  if (failures.length) process.exit(1);
}
void main();
