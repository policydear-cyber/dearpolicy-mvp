/** The benefit table switched on for every household (DEARPOLICY_BENEFIT_TABLE_ALL_ACCOUNTS, lib/benefit-table/flag.ts).
 *
 * 1. The switch: it opens the table to any named account, and nothing else. DEARPOLICY_BENEFIT_TABLE (and, in production,
 *    DEARPOLICY_BENEFIT_TABLE_ALLOW_PRODUCTION) must still be set, a call that names no account is still off, and the simple
 *    chat stays limited to the alpha list.
 * 2. The gate DC asked for before opening it up: a made-up NEW household, never in any alpha list, sees a Coverage page that
 *    makes sense when its documents are (a) none at all, (b) partly read (one read, one still being read), (c) all
 *    unreadable. No made-up figure, no "ended/expired" from a date, no Read again offered where it would give nothing.
 *
 * In-memory database (the statements tableFor sends), made-up names and insurers in RM; no model, no network.
 *   npm run benefit-table:all-accounts-test */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (() => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (error) { failures.push(name); console.error("  FAIL " + name + ": " + (error instanceof Error ? error.message.split("\n")[0] : String(error))); }
}

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
const NEW = "8d1f0e4c-5b6a-4c3d-9e2f-112233445566"; // a household that signed up today: in no alpha list
const ALPHA = "alpha-account-1";

async function main() {
  const { benefitTableStatus } = await import("@/lib/benefit-table/flag");
  const { simpleChatStatus } = await import("@/lib/simple-chat/flag");
  const service = await import("@/lib/benefit-table/service");
  const { figureText } = await import("@/lib/benefit-table/assemble");
  const { documentName } = await import("@/lib/policies/inventory");
  const { BenefitTableCoverage } = await import("@/components/benefit-table-coverage");

  // ------------------------------------------------------------------ 1. the switch
  const prod = { VERCEL: "1", DEARPOLICY_BENEFIT_TABLE: "1", DEARPOLICY_BENEFIT_TABLE_ALLOW_PRODUCTION: "1", DEARPOLICY_ALPHA_ACCOUNTS: ALPHA };
  await test("before: in production a new household not in the alpha list does not get the table", () => {
    assert.equal(benefitTableStatus(env(prod), NEW).enabled, false);
    assert.equal(benefitTableStatus(env(prod), ALPHA).enabled, true);
  });
  await test("with ALL_ACCOUNTS: every named household gets the table, the alpha one too", () => {
    const all = env({ ...prod, DEARPOLICY_BENEFIT_TABLE_ALL_ACCOUNTS: "1" });
    assert.equal(benefitTableStatus(all, NEW).enabled, true);
    assert.equal(benefitTableStatus(all, ALPHA).enabled, true);
    assert.equal(benefitTableStatus(env({ VERCEL: "1", DEARPOLICY_BENEFIT_TABLE: "1", DEARPOLICY_BENEFIT_TABLE_ALLOW_PRODUCTION: "1", DEARPOLICY_BENEFIT_TABLE_ALL_ACCOUNTS: "1" }), NEW).enabled, true, "an empty alpha list does not matter");
  });
  await test("ALL_ACCOUNTS opens nothing else: the main switch, the production switch and a named account are still required", () => {
    assert.equal(benefitTableStatus(env({ VERCEL: "1", DEARPOLICY_BENEFIT_TABLE_ALL_ACCOUNTS: "1" }), NEW).enabled, false, "DEARPOLICY_BENEFIT_TABLE unset");
    assert.equal(benefitTableStatus(env({ VERCEL: "1", DEARPOLICY_BENEFIT_TABLE: "1", DEARPOLICY_BENEFIT_TABLE_ALL_ACCOUNTS: "1" }), NEW).enabled, false, "production switch unset");
    for (const none of [null, undefined, "", "  "]) assert.equal(benefitTableStatus(env({ ...prod, DEARPOLICY_BENEFIT_TABLE_ALL_ACCOUNTS: "1" }), none).enabled, false, "no account: " + JSON.stringify(none));
    assert.equal(benefitTableStatus(env({ ...prod, DEARPOLICY_BENEFIT_TABLE_ALL_ACCOUNTS: "0" }), NEW).enabled, false, "0 is off");
  });
  await test("the simple chat stays alpha-only when the table is opened to everyone", () => {
    const all = env({ ...prod, DEARPOLICY_BENEFIT_TABLE_ALL_ACCOUNTS: "1", DEARPOLICY_SIMPLE_CHAT: "1", DEARPOLICY_SIMPLE_CHAT_ALLOW_PRODUCTION: "1" });
    assert.equal(simpleChatStatus(all, NEW).enabled, false);
    assert.equal(simpleChatStatus(all, ALPHA).enabled, true);
  });

  // ------------------------------------------------------------------ 2. a new household's Coverage page
  type Policy = { id: string; original_filename: string; processing_status: string; document_role: string | null; product_name: string | null;
    insurer: string | null; policy_number: string | null; processing_completed_at: string | null; quarantine_status: string | null;
    created_at: string; updated_at: string; reading_live: boolean };
  const now = new Date().toISOString();
  const policy = (id: string, o: Partial<Policy>): Policy => ({ id, original_filename: id + ".pdf", processing_status: "ready", document_role: "personal_schedule",
    product_name: null, insurer: "Bukit Jalil Takaful (fictitious)", policy_number: null, processing_completed_at: now, quarantine_status: "scan_clean",
    created_at: now, updated_at: now, reading_live: false, ...o });
  const reading = (product: string, covers: unknown[]) => ({ document: { document: { kind: "personal_proof", product, insurer: "Bukit Jalil Takaful (fictitious)", namedPeople: [], plan: null, periodFrom: null, periodTo: null },
    covers, benefits: [] }, pages: [] });
  type House = { policies: Policy[]; pages: { policy_id: string; page_number: number; text: string; extraction_method: string }[]; readings: Map<string, unknown> };
  const fakeDb = (h: House) => (async (sql: string, p: unknown[]) => {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT id, display_name, preferred_name FROM family_members")) return [{ id: "m1", display_name: "Nur Iman binti Zakaria", preferred_name: "Iman" }];
    if (q.startsWith("SELECT id, original_filename, processing_status")) return p[0] === NEW ? h.policies : [];
    if (q.startsWith("SELECT policy_id, page_number, text FROM policy_pages"))
      return h.pages.filter((x) => (p[1] as string[]).includes(x.policy_id) && x.extraction_method !== "unchecked");
    if (q.startsWith("SELECT policy_id, reading FROM benefit_readings")) return [...h.readings].map(([policy_id, r]) => ({ policy_id, reading: JSON.stringify(r) }));
    if (q.startsWith("SELECT section_key, cover_key, why, chosen_by FROM benefit_links")) return [];
    if (q.startsWith("SELECT family_member_id, cover_key, status, sum_insured, updated_at FROM benefit_confirmations")) return [];
    throw new Error("fake db: unexpected statement " + q.slice(0, 80));
  }) as Parameters<typeof service.tableFor>[0];
  // What the route sends and the page shows (app/api/benefit-table/route.ts, components/benefit-table-coverage.tsx).
  const page = async (h: House) => {
    const { table, documents } = await service.tableFor(fakeDb(h), NEW);
    const data = { enabled: true as const, documents: documents.map((d) => ({ id: d.id, name: documentName(d.file), state: d.state, hold: null })),
      people: table.people.map((p) => ({ ...p, rows: p.rows.map((r) => ({ ...r, figureText: figureText(r.figure) })) })),
      unmatchedCovers: table.unmatchedCovers, illustrationCovers: table.illustrationCovers, unlinkedSections: table.unlinkedSections.map((u) => ({ ...u, chosenBy: null })) };
    const html = renderToStaticMarkup(createElement(BenefitTableCoverage, { data: data as never }));
    return { table, documents, text: html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;|’/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ") };
  };
  // Any money figure, by symbol or by ISO code ("RM150,000", "MYR 150,000", "S$1,000").
  const figures = (text: string) => text.match(/(?:RM|S\$|US\$|HK\$|£|€|\$|\b[A-Z]{3}\s)\s?\d[\d,.]*/g) ?? [];
  const amountOf = (f: string) => Number(f.replace(/^\D+/, "").replace(/,/g, ""));
  const NEVER = /\b(?:ended|expired|lapsed|not covered|no benefits)\b/i;

  // (a) signed up, nothing uploaded yet
  const empty = await page({ policies: [], pages: [], readings: new Map() });
  await test("(a) a household with no documents: the page renders, shows no figure, no Read again, nothing ended or 'no benefits'", () => {
    assert.ok(empty.text.length > 0, "renders");
    assert.deepEqual(figures(empty.text), [], empty.text);
    assert.ok(!/Read again/i.test(empty.text), empty.text);
    assert.ok(!NEVER.test(empty.text), empty.text);
    assert.equal(empty.documents.length, 0);
  });

  // (b) one schedule read, one document still being read
  const partial = await page({
    policies: [
      policy("medical", { product_name: "SihatCare Plus", policy_number: "BJT-MC-40211" }),
      policy("life", { product_name: "Amanah Term 25", processing_status: "extracting", processing_completed_at: null, reading_live: true }),
    ],
    pages: [{ policy_id: "medical", page_number: 1, text: "SIHATCARE PLUS - POLICY SCHEDULE\nPolicy number BJT-MC-40211\nInsured person: Nur Iman binti Zakaria\nOverall annual limit RM150,000", extraction_method: "native" }],
    readings: new Map([["medical", reading("SihatCare Plus", [{ person: "Nur Iman binti Zakaria", product: "SihatCare Plus", cover: "Medical", plan: null, sumInsured: 150000, currency: "MYR", asOf: null, page: 1, quote: "Overall annual limit RM150,000" }])]]),
  });
  await test("(b) partly read: the read document is read, the other is still being read (never 'could not be read')", () => {
    const state = Object.fromEntries(partial.documents.map((d) => [d.id, d.state]));
    assert.equal(state.medical, "read");
    assert.equal(state.life, "waiting");
    assert.match(partial.text, /still being read/i, partial.text);
    assert.ok(!/could not be read/i.test(partial.text), partial.text);
  });
  await test("(b) every figure the page shows is printed in the household's document", () => {
    if (process.env.SHOW) console.log("EMPTY:", empty.text, "\nPARTIAL:", partial.text);
    assert.ok(figures(partial.text).length >= 1, "the read cover shows its printed limit: " + partial.text);
    assert.deepEqual([...new Set(figures(partial.text).map(amountOf))], [150000], "only the printed limit: " + figures(partial.text).join(", "));
    assert.ok(!NEVER.test(partial.text), partial.text);
  });

  // (d) the commonest first upload: one schedule, read; nothing else uploaded and nothing being read
  const onlySchedule = await page({ policies: [policy("medical", { product_name: "SihatCare Plus", policy_number: "BJT-MC-40211" })],
    pages: [{ policy_id: "medical", page_number: 1, text: "SIHATCARE PLUS - POLICY SCHEDULE\nPolicy number BJT-MC-40211\nInsured person: Nur Iman binti Zakaria\nOverall annual limit RM150,000", extraction_method: "native" }],
    readings: new Map([["medical", reading("SihatCare Plus", [{ person: "Nur Iman binti Zakaria", product: "SihatCare Plus", cover: "Medical", plan: null, sumInsured: 150000, currency: "MYR", asOf: null, page: 1, quote: "Overall annual limit RM150,000" }])]]),
  });
  await test("(d) only a read schedule, nothing being read: the cover is never said to be 'still being read'; the page says how to add its benefits", () => {
    assert.ok(!/still being read/i.test(onlySchedule.text), onlySchedule.text);
    assert.match(onlySchedule.text, /No benefits are listed for it yet\. If you have its policy wording or benefit summary, upload it on the Documents page/, onlySchedule.text);
    assert.deepEqual([...new Set(figures(onlySchedule.text).map(amountOf))], [150000]);
  });
  await test("(b) control: while another document is being read, the cover's benefits are still said to be on their way", () => {
    assert.match(partial.text, /Its benefits are still being read\./, partial.text);
  });

  // (c) everything uploaded so far is unreadable
  const unreadable = await page({
    policies: [
      policy("blurry", { product_name: "Blurry phone photo", processing_status: "failed" }),
      policy("rejected", { product_name: "Rejected upload", processing_status: "queued", quarantine_status: "scan_rejected", processing_completed_at: null, reading_live: true }),
      policy("garbled", { product_name: "Garbled scan" }),
    ],
    pages: [{ policy_id: "garbled", page_number: 1, text: "#@! RM1S0,0O0 ~~", extraction_method: "unchecked" }],
    readings: new Map(),
  });
  await test("(c) all unreadable: each is 'could not be read', none is 'still being read', and no figure is shown", () => {
    const state = Object.fromEntries(unreadable.documents.map((d) => [d.id, d.state]));
    assert.deepEqual(state, { blurry: "not_readable", rejected: "not_readable", garbled: "not_readable" });
    assert.match(unreadable.text, /could not be read/i, unreadable.text);
    assert.ok(!/still being read/i.test(unreadable.text), unreadable.text);
    assert.deepEqual(figures(unreadable.text), [], unreadable.text);
    assert.ok(!NEVER.test(unreadable.text), unreadable.text);
  });
  await test("(b) the read cover is shown under this household's own member", () => {
    const person = partial.table.people.find((p) => p.id === "m1");
    assert.ok(person && person.covers.length === 1, JSON.stringify(partial.table.people.map((p) => [p.id, p.covers.length])));
    assert.match(partial.text, /Iman/, partial.text);
  });

  // ------------------------------------------------------------------ 3. an EXISTING household (test engineer F1)
  // Its documents were read before the table existed, so it has a Coverage page from the existing reading (coverage_rules)
  // and no table reading. Opening the table to everyone must not take that page away: it keeps it, and its documents keep
  // being read the existing way (every reader asks benefitTableLive). A new household, or one with nothing read yet, gets
  // the table. An alpha household keeps the table either way.
  const { benefitTableLiveFor } = await import("@/lib/benefit-table/app");
  const all = env({ ...prod, DEARPOLICY_BENEFIT_TABLE_ALL_ACCOUNTS: "1" });
  const OLD = "3a9c7d21-0b4e-4f6a-8c55-998877665544";
  type Doc = { role: string | null; live: boolean; tableRead: boolean };
  type Stored = { docs?: Doc[]; ledgerRows?: number; ledgerTable?: boolean; fail?: "readings" | "ledger" };
  // Answers the statements benefitTableLiveFor sends, from what is stored for OLD; every other household has nothing.
  const dbWith = (who: string, st: Stored) => (async (sql: string, p: unknown[]) => {
    const q = sql.replace(/\s+/g, " ").trim();
    const mine = p[0] === who;
    const docs = mine ? st.docs ?? [] : [];
    if (q.includes("to_regclass('public.benefit_readings')")) return [{ ok: true }];
    if (q.startsWith("SELECT 1 FROM benefit_readings")) { if (st.fail === "readings") throw new Error("connection reset"); return docs.filter((d) => d.tableRead).slice(0, 1).map(() => ({ x: 1 })); }
    if (q.startsWith("SELECT 1 FROM policies")) {
      assert.match(q, /processing_status='ready'/); assert.match(q, /background_jobs/, "a document being read now is not 'read before'");
      const noCover = p[1] as string[];
      return docs.filter((d) => !d.live && !noCover.includes(d.role ?? "")).slice(0, 1).map(() => ({ x: 1 }));
    }
    if (st.fail === "ledger") throw new Error("connection reset");
    if (q.includes("to_regclass('public.coverage_rules')")) return [{ ok: st.ledgerTable !== false }];
    if (q.startsWith("SELECT 1 FROM coverage_rules WHERE account_id=$1")) return mine && (st.ledgerRows ?? 0) > 0 ? [{ x: 1 }] : [];
    throw new Error("fake db: unexpected statement " + q.slice(0, 80));
  }) as Parameters<typeof benefitTableLiveFor>[0];
  const schedule = (o: Partial<Doc> = {}): Doc => ({ role: "personal_schedule", live: false, tableRead: false, ...o });
  await test("existing household, documents read the existing way: keeps its existing Coverage", async () => {
    assert.equal(await benefitTableLiveFor(dbWith(OLD, { docs: [schedule(), schedule({ role: "policy_wording" })], ledgerRows: 12 }), all, OLD), false);
  });
  await test("existing household with read documents but no coverage_rules rows (seeded lazily, or nothing seeded): keeps its existing Coverage (Critic M1)", async () => {
    assert.equal(await benefitTableLiveFor(dbWith(OLD, { docs: [schedule()], ledgerRows: 0 }), all, OLD), false);
  });
  await test("existing household with only coverage_rules rows left: keeps its existing Coverage", async () => {
    assert.equal(await benefitTableLiveFor(dbWith(OLD, { docs: [], ledgerRows: 3 }), all, OLD), false);
  });
  await test("new household: nothing on file gets the table; its first upload, being read right now, does too", async () => {
    assert.equal(await benefitTableLiveFor(dbWith(OLD, {}), all, NEW), true);
    assert.equal(await benefitTableLiveFor(dbWith(OLD, { docs: [schedule({ live: true })] }), all, OLD), true, "a ready document whose read job is live");
    assert.equal(await benefitTableLiveFor(dbWith(OLD, { docs: [schedule({ role: "premium_receipt" })], ledgerTable: false }), all, OLD), true, "only a receipt on file");
  });
  await test("a household on the table stays there, even with coverage_rules rows and old documents (Critic M2)", async () => {
    assert.equal(await benefitTableLiveFor(dbWith(OLD, { docs: [schedule({ tableRead: true }), schedule()], ledgerRows: 9 }), all, OLD), true);
    assert.equal(await benefitTableLiveFor(dbWith(OLD, { docs: [schedule({ tableRead: true })], fail: "ledger" }), all, OLD), true, "a later check failing never moves it");
  });
  await test("an alpha household keeps the table even with an existing Coverage", async () => {
    assert.equal(await benefitTableLiveFor(dbWith(ALPHA, { docs: [schedule()], ledgerRows: 40 }), all, ALPHA), true);
    assert.equal(await benefitTableLiveFor(dbWith(ALPHA, { docs: [schedule()], ledgerRows: 40 }), env(prod), ALPHA), true);
  });
  await test("the check failing keeps the household on the existing Coverage for that request, never an empty table", async () => {
    assert.equal(await benefitTableLiveFor(dbWith(OLD, { docs: [schedule()], fail: "readings" }), all, OLD), false);
  });
  await test("switch off: nobody gets the table, whatever is stored", async () => {
    assert.equal(await benefitTableLiveFor(dbWith(OLD, { docs: [schedule({ tableRead: true })] }), env(prod), NEW), false);
  });
  // A household on the table whose schedule is uploaded but not in the table yet is never told to upload a schedule.
  const unreadSchedule = await page({ policies: [policy("sched", { product_name: "SihatCare Plus", policy_number: "BJT-MC-40211" })],
    pages: [{ policy_id: "sched", page_number: 1, text: "SIHATCARE PLUS - POLICY SCHEDULE\nPolicy number BJT-MC-40211\nInsured person: Nur Iman binti Zakaria\nOverall annual limit RM150,000", extraction_method: "native" }],
    readings: new Map() });
  await test("a schedule on file but not in the table: never 'No covers yet. Upload a … schedule'", () => {
    assert.ok(unreadSchedule.documents.some((d) => d.state === "table_unread"), JSON.stringify(unreadSchedule.documents.map((d) => d.state)));
    assert.ok(!/Upload a certificate, schedule or policy wording/.test(unreadSchedule.text), unreadSchedule.text);
    assert.match(unreadSchedule.text, /No covers are shown from your documents yet\./, unreadSchedule.text);
    assert.deepEqual(figures(unreadSchedule.text), [], unreadSchedule.text);
  });
  await test("control: with nothing uploaded the page still says where to upload", () => {
    assert.match(empty.text, /Upload a certificate, schedule or policy wording/, empty.text);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}
main().catch((error) => { console.error(error); process.exit(1); });
