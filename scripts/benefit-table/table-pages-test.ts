/**
 * Only pages whose words are the page's own are read into the benefit table (lib/benefit-table/service.ts CHECKED_PAGE,
 * an allow-list of how a page was read). A page that could not be read at all ("unreadable") or whose table text could
 * not be checked ("unchecked") gives no row, whatever a reader made of it: a stored row quoting it is not found on any
 * page, so it reaches neither Coverage nor the chat table (Critic #327 L3). Pages read natively, by OCR, checked line by
 * line, or stored before methods were recorded are read as before. Made-up household, in-memory database, no network,
 * no model.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

test("rows quoting an unreadable or unchecked page are left out; every allowed method is read", async () => {
  const { installDatabase } = await import("../r6/fixture");
  const db = await installDatabase();
  await db.exec(readFileSync("sql/benefit-table.sql", "utf8"));
  await db.exec("ALTER TABLE policy_pages ADD COLUMN IF NOT EXISTS extraction_method text");
  const { tableFor, TABLE_PAGE_METHODS } = await import("@/lib/benefit-table/service");
  assert.deepEqual([...TABLE_PAGE_METHODS], ["", "native", "ocr", "part_checked"]);
  const A = "00000000-0000-4000-8000-0000000003a1", NIA = "00000000-0000-4000-8000-0000000003a2", D = "00000000-0000-4000-8000-0000000003a3";
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Made-up household')", [A]);
  await db.query("INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Nia Okafor','self')", [NIA, A]);
  await db.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,document_role,quarantine_status)
    VALUES($1,$2,$3,'schedule.pdf','k/1','ready','personal_schedule','scan_clean')`, [D, A, NIA]);
  // One page per method; each prints its own benefit, with a figure in another currency.
  const methods: (string | null)[] = ["native", "unreadable", "unchecked", "ocr", "part_checked", null, "some_future_method"];
  for (const [i, m] of methods.entries()) await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text,extraction_method) VALUES($1,$2,$3,$4,$5)",
    [A, D, i + 1, `${i === 0 ? "POLICY SCHEDULE\nInsured: Nia Okafor\nSum Insured\tNGN 5,000,000\n" : ""}Benefit ${i + 1}\tNGN ${(i + 1) * 1000} per day`, m]);
  const benefits = methods.map((_, i) => ({ section: null, column: null, benefit: `Benefit ${i + 1}`, pays: "words", value: null, percentOf: null, baseAmount: null, baseQuote: null,
    fromDay: null, maxDays: null, conditions: [], page: i + 1, quote: `Benefit ${i + 1}\tNGN ${(i + 1) * 1000} per day` }));
  const reading = { document: { document: { kind: "personal_schedule", product: "Made-up Health Plan", insurer: null, namedPeople: ["Nia Okafor"], plan: null, periodFrom: null, periodTo: null },
    covers: [{ person: "Nia Okafor", product: "Made-up Health Plan", cover: "Hospital", plan: null, sumInsured: 5000000, asOf: null, page: 1, quote: "Sum Insured\tNGN 5,000,000" }], benefits }, pages: [] };
  await db.query("INSERT INTO benefit_readings(policy_id,account_id,reading,model,prompt_version) VALUES($1,$2,$3,'test','test')", [D, A, JSON.stringify(reading)]);
  // The section is linked to the cover, so every row found is listed on the person's table.
  await db.query("INSERT INTO benefit_links(account_id,section_key,cover_key,why,chosen_by) VALUES($1,$2,'made up health plan|hospital|','test','household')", [A, `${D}||`]);
  const appDb = async (sql: string, params: unknown[]) => (await db.query<Record<string, unknown>>(sql, params)).rows;
  const { table, documents } = await tableFor(appDb, A);
  const shown = JSON.stringify(table.people.flatMap((p) => p.rows));
  for (const n of [1, 4, 5, 6]) assert.ok(shown.includes(`Benefit ${n}`), `page ${n} (${methods[n - 1] ?? "no method"}) is read`);
  for (const n of [2, 3, 7]) assert.ok(!shown.includes(`Benefit ${n}`), `page ${n} (${methods[n - 1]}) gives no row`);
  assert.equal(documents[0].state, "read");
});

test("a document whose every page is unreadable or unchecked is not readable, never read with nothing in it (TE #328)", async () => {
  const { installDatabase } = await import("../r6/fixture");
  const db = await installDatabase();
  await db.exec(readFileSync("sql/benefit-table.sql", "utf8"));
  await db.exec("ALTER TABLE policy_pages ADD COLUMN IF NOT EXISTS extraction_method text");
  const { tableFor } = await import("@/lib/benefit-table/service");
  const A = "00000000-0000-4000-8000-0000000004a1", LIM = "00000000-0000-4000-8000-0000000004a2";
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Made-up household')", [A]);
  await db.query("INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Teo Ramírez','self')", [LIM, A]);
  const docs: [string, string, (string | null)[]][] = [
    ["00000000-0000-4000-8000-0000000004b1", "personal_schedule", ["unreadable", "unreadable"]],
    ["00000000-0000-4000-8000-0000000004b2", "personal_schedule", ["unchecked", "unreadable"]],
    ["00000000-0000-4000-8000-0000000004b3", "personal_schedule", ["unreadable", "native"]],
  ];
  for (const [D, role, methods] of docs) {
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,document_role,quarantine_status)
      VALUES($1,$2,$3,$4,$5,'ready',$6,'scan_clean')`, [D, A, LIM, D.slice(-2) + ".pdf", "k/" + D, role]);
    for (const [i, m] of methods.entries()) await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text,extraction_method) VALUES($1,$2,$3,$4,$5)",
      [A, D, i + 1, `POLICY SCHEDULE\nInsured: Teo Ramírez\nSum Insured\tMXN 800,000\nTrip cancellation\tMXN 40,000`, m]);
    const reading = { document: { document: { kind: role, product: "Made-up Travel Cover", insurer: null, namedPeople: ["Teo Ramírez"], plan: null, periodFrom: null, periodTo: null },
      covers: [{ person: "Teo Ramírez", product: "Made-up Travel Cover", cover: "Travel", plan: null, sumInsured: 800000, asOf: null, page: 1, quote: "Sum Insured\tMXN 800,000" }], benefits: [] }, pages: [] };
    await db.query("INSERT INTO benefit_readings(policy_id,account_id,reading,model,prompt_version) VALUES($1,$2,$3,'test','test')", [D, A, JSON.stringify(reading)]);
  }
  const appDb = async (sql: string, params: unknown[]) => (await db.query<Record<string, unknown>>(sql, params)).rows;
  const { documents } = await tableFor(appDb, A);
  const state = (id: string) => documents.find((d) => d.id === id)?.state;
  assert.equal(state(docs[0][0]), "not_readable");
  assert.equal(state(docs[1][0]), "not_readable");
  // One page the table reads is enough: read, as before.
  assert.equal(state(docs[2][0]), "read");
});

test("the filter is the allow-list, in the page query and the fingerprint query alike", () => {
  const src = readFileSync("lib/benefit-table/service.ts", "utf8");
  assert.match(src, /const CHECKED_PAGE = `coalesce\(to_jsonb\(pp\)->>'extraction_method', ''\) IN \(\$\{TABLE_PAGE_METHODS/);
  assert.doesNotMatch(src, /<> 'unchecked'/);
  assert.equal(src.match(/AND \$\{CHECKED_PAGE\}/g)?.length, 2);
});
