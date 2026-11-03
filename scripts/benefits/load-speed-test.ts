/**
 * Benefits load (3 Nov): the changes that made the page fast keep what it shows.
 *  1. A schema file that only creates things is skipped when all of it exists, read from the catalogue alone, and run
 *     as before when anything is missing or the file holds any other statement (lib/db/additive-schema.ts).
 *  2. Money figures read the same with reused formatters, whatever order currencies and amounts come in.
 *  3. Quote matching treats case, spacing, quote marks and dashes as before (ASCII fast path in squash).
 *  4. The Benefits rows query reads its optional columns once per row.
 * Made-up data; an in-memory database; no network, no model.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

test("a schema file is read as what it creates, and anything else makes it always run", async () => {
  const { schemaObjects } = await import("@/lib/db/additive-schema");
  assert.deepEqual(schemaObjects(readFileSync("sql/benefit-catalog.sql", "utf8")), {
    tables: ["policy_benefits"], indexes: ["idx_policy_benefits_policy", "idx_policy_benefits_traits"],
    columns: [{ table: "policy_benefits", column: "reviewed_at" }, { table: "policy_benefits", column: "basis_inferred" },
      { table: "policy_benefits", column: "requires" }, { table: "policies", column: "benefits_indexed_at" }] });
  assert.deepEqual(schemaObjects(readFileSync("sql/cover-conditions.sql", "utf8")), {
    tables: ["policy_cover_conditions"], indexes: ["idx_cover_conditions_policy", "idx_cover_conditions_kind"],
    columns: [{ table: "policies", column: "conditions_indexed_at" }] });
  // An apostrophe in a comment and a ";" inside a default are not statements.
  assert.deepEqual(schemaObjects("-- the document's rows\nALTER TABLE t ADD COLUMN IF NOT EXISTS note text DEFAULT 'a;b';"),
    { tables: [], indexes: [], columns: [{ table: "t", column: "note" }] });
  for (const other of [
    "UPDATE policies SET x=1;",
    "ALTER TABLE t ADD COLUMN IF NOT EXISTS a int, ADD COLUMN IF NOT EXISTS b int;",
    "ALTER TABLE t ADD COLUMN a int;",
    "ALTER TABLE t DROP COLUMN IF EXISTS a;",
    "CREATE TABLE t (a int);",
    "CREATE TABLE IF NOT EXISTS \"T\" (a int);",
    "DO $$ BEGIN END $$;",
    "CREATE INDEX IF NOT EXISTS i ON t(a); DELETE FROM t;",
    "ALTER TABLE t ADD COLUMN IF NOT EXISTS a text DEFAULT 'x;",
  ]) assert.equal(schemaObjects(other), null, other);
});

test("present only when every table, column and index exists; then running the file again is what fills a gap", async () => {
  const { schemaObjects, schemaPresent, additiveSchemaInPlace } = await import("@/lib/db/additive-schema");
  const db = new PGlite();
  const client = { query: (text: string, values?: unknown[]) => db.query<Record<string, unknown>>(text, values) };
  await db.exec("CREATE TABLE accounts(id uuid PRIMARY KEY); CREATE TABLE policies(id uuid PRIMARY KEY, account_id uuid);");
  const sql = readFileSync("sql/benefit-catalog.sql", "utf8");
  const objects = schemaObjects(sql)!;
  assert.equal(await schemaPresent(client, objects), false, "nothing created yet");
  await db.exec(sql);
  assert.equal(await schemaPresent(client, objects), true);
  assert.equal(await additiveSchemaInPlace(client, sql), true);
  await db.exec("ALTER TABLE policy_benefits DROP COLUMN requires");
  assert.equal(await additiveSchemaInPlace(client, sql), false, "a dropped column is missing");
  await db.exec(sql);
  assert.equal(await additiveSchemaInPlace(client, sql), true);
  await db.exec("DROP INDEX idx_policy_benefits_traits");
  assert.equal(await additiveSchemaInPlace(client, sql), false, "a missing index is missing");
  await db.exec(sql);
  await db.exec("ALTER TABLE policies DROP COLUMN benefits_indexed_at");
  assert.equal(await additiveSchemaInPlace(client, sql), false, "a column on another table is checked too");
  // A file with another statement always runs, and a check that cannot answer runs it too.
  assert.equal(await additiveSchemaInPlace(client, sql + "\nUPDATE policies SET account_id=account_id;"), false);
  assert.equal(await additiveSchemaInPlace({ query: async () => { throw new Error("no catalogue"); } }, sql), false);
  await db.close();
});

test("both schema helpers check before they lock", () => {
  for (const file of ["lib/policies/benefit-catalog.ts", "lib/policies/condition-catalog.ts"]) {
    const src = readFileSync(file, "utf8");
    assert.match(src, /if\(await additiveSchemaInPlace\(client,sql\)\)return;\n\s+await client\.query\("BEGIN"\);/, file);
  }
});

test("money reads the same with reused formatters, in any order", async () => {
  const { formatMoney } = await import("@/lib/format/currency");
  const want: [number | string | null, string | null, string][] = [
    [1000, "SGD", "S$1,000"], [1936.5, "SGD", "S$1,936.50"], [41.1, "SGD", "S$41.10"], [5, "SGD", "S$5.00"],
    [25000, "MYR", "MYR 25,000"], [1000.25, "GBP", "£1,000.25"], [300, "JPY", "¥300"], [1200, "USD", "US$1,200"],
    [1000, null, "1,000 (currency not stated)"], [41.1, "RM", "RM 41.10"], [12.5, "$", "12.50 (currency not stated)"],
  ];
  const once = want.map(([a, c]) => formatMoney(a, c));
  // Reversed and repeated: a formatter made for one call never changes another's figure.
  for (let i = 0; i < 3; i++) assert.deepEqual([...want].reverse().map(([a, c]) => formatMoney(a, c)).reverse(), once);
  for (let i = 0; i < want.length; i++) assert.equal(once[i].replace(/ /g, " "), once[i]);
  assert.equal(formatMoney(1000, "SGD"), "S$1,000");
  assert.equal(formatMoney(1000.5, "SGD"), "S$1,000.50");
  assert.equal(formatMoney(999.5, "SGD"), "S$999.50");
});

test("quotes are matched as before: case, spacing, quote marks and dashes do not count", async () => {
  const { locateQuote } = await import("@/lib/simple-chat/verify");
  const page = "Benefit\tLIMIT\nRoom & Board — up to S$1,000 per day\n“Accident” means `sudden` İnjury";
  const household = { documents: [{ id: "d1", name: "Made-up booklet.pdf", status: "ready", pages: [{ page: 3, text: page }] }] } as never;
  const at = (q: string) => locateQuote(household, q, 0);
  assert.equal(at("room & board - up to s$1,000 per day")?.page, 3);
  assert.equal(at("BENEFIT LIMIT")?.excerpt, "Benefit LIMIT");
  assert.equal(at("\"accident\" means 'sudden'")?.page, 3);
  assert.equal(at("İnjury")?.page, 3);
  assert.equal(at("room and board"), null);
});

test("the Benefits rows query reads its optional columns once per row", () => {
  const route = readFileSync("app/api/benefits/route.ts", "utf8");
  const rows = route.slice(route.indexOf("const rows=await query<Row>("), route.indexOf("rows.rows=inNumberedOrder"));
  assert.equal((rows.match(/to_jsonb\(b\)/g) ?? []).length, 1, "to_jsonb(b) once, in the lateral read");
  assert.match(rows, /k\.id=x\.duplicate_of::uuid/);
  assert.match(rows, /ORDER BY [^`]*,x\.tier`/);
});

test("a remembered check is found without the pages' text, and gives the same table and document states", async () => {
  const { installDatabase } = await import("../r6/fixture");
  const db = await installDatabase();
  await db.exec(readFileSync("sql/benefit-table.sql", "utf8"));
  const { pagesPrint, tableFor } = await import("@/lib/benefit-table/service");
  const A = "00000000-0000-4000-8000-0000000000b5", AISHA = "00000000-0000-4000-8000-0000000000b6", BEN = "00000000-0000-4000-8000-0000000000b7";
  const doc = (n: number) => "00000000-0000-4000-8000-0000000001" + String(n).padStart(2, "0");
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Made-up household')", [A]);
  await db.query("INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Aisha Rahman','self'),($3,$2,'Ben Carter','spouse')", [AISHA, A, BEN]);
  // A ringgit schedule, a pound booklet with mirrored columns and curly quotes, a letter enclosing a schedule (no reading),
  // and a schedule with no reading (its state comes from its page count alone).
  const pages: Record<number, string[]> = {
    1: ["POLICY SCHEDULE\nLife Assured: Aisha Rahman\nSum Assured\tRM250,000\nPolicy No. LX-77120934", "Hospital Income\tRM200 per day\nIntensive Care Unit — RM400 per day"],
    2: ["£1,000.00\tLoss of one limb\n“Accident” means a sudden event\nBen Carter", "£50,000\tAccidental death", "Exclusions: war; self‑inflicted injury"],
    3: ["Dear Aisha Rahman,\nThank you for your payment.", "POLICY SCHEDULE\nPolicy No. QB-55410021\nLife Assured: Aisha Rahman\nSum Assured\tS$100,000"],
    4: ["CERTIFICATE OF INSURANCE\nInsured: Ben Carter\nSum Insured\t€30.000"],
  };
  const roles: Record<number, string> = { 1: "personal_schedule", 2: "policy_wording", 3: "insurer_letter", 4: "certificate" };
  for (const n of [1, 2, 3, 4]) {
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,document_role,quarantine_status)
      VALUES($1,$2,$3,$4,$5,'ready',$6,'scan_clean')`, [doc(n), A, n % 2 ? AISHA : BEN, `doc-${n}.pdf`, `k/${n}`, roles[n]]);
    for (const [i, text] of pages[n].entries()) await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [A, doc(n), i + 1, text]);
  }
  const reading = (n: number, person: string, figure: number, quote: string, benefits: [string, string, number][]) => ({ document: {
    document: { kind: roles[n], product: "Plan " + n, insurer: null, namedPeople: [person], plan: null, periodFrom: null, periodTo: null },
    covers: [{ person, product: "Plan " + n, cover: n === 1 ? "Death" : "Accident", plan: null, sumInsured: figure, asOf: null, page: 1, quote }],
    benefits: benefits.map(([benefit, q, page]) => ({ section: null, column: null, benefit, pays: "words", value: null, percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], page, quote: q })) }, pages: [] });
  await db.query("INSERT INTO benefit_readings(policy_id,account_id,reading,model,prompt_version) VALUES($1,$2,$3,'test','test'),($4,$2,$5,'test','test')", [
    doc(1), A, JSON.stringify(reading(1, "Aisha Rahman", 250000, "Sum Assured\tRM250,000", [["Hospital Income", "Hospital Income\tRM200 per day", 2], ["ICU", "Intensive Care Unit - RM400 per day", 2]])),
    doc(2), JSON.stringify(reading(2, "Ben Carter", 50000, "£50,000\tAccidental death", [["Loss of one limb", "£1,000.00\tLoss of one limb", 1], ["Nowhere", "a quote printed nowhere", 3]]))]);
  let textRows = 0;
  const appDb = async (sql: string, params: unknown[]) => { const r = (await db.query<Record<string, unknown>>(sql, params)).rows; if (/page_number, text FROM/.test(sql)) textRows += r.length; return r; };
  textRows = 0; const first = await tableFor(appDb, A); const firstRows = textRows;
  textRows = 0; const second = await tableFor(appDb, A); const secondRows = textRows;
  assert.equal(firstRows, 7, "first load: the two read documents' pages and the letter's");
  assert.equal(secondRows, 2, "after that: only the letter's pages, which the misfiled rule reads every time");
  assert.deepEqual(second, first, "the same table, documents and states");
  assert.ok(first.table.people.length > 0);
  assert.deepEqual(first.documents.slice(0, 2).map((d) => d.state), ["read", "read"]);
  // The unread certificate's state comes from its page count (now read in the database), the same as from its pages.
  assert.equal(first.documents[3].state, "table_unread");
  // The database's fingerprint is the one the check is remembered under, for any text (not only ASCII).
  for (const n of [1, 2, 3, 4]) {
    const sqlPrint = (await db.query<{ p: string }>(`SELECT md5(string_agg(page_number::text || ':' || md5(coalesce(text, '')), ',' ORDER BY page_number)) AS p FROM policy_pages WHERE policy_id=$1`, [doc(n)])).rows[0].p;
    assert.equal(sqlPrint, pagesPrint(pages[n].map((text, i) => ({ page: i + 1, text }))), "document " + n);
  }
  // A database that cannot give the fingerprints is sent every document's pages, and gives the same table.
  textRows = 0;
  const noPrints = async (sql: string, params: unknown[]) => { if (/md5\(string_agg/.test(sql)) throw new Error("no md5 here"); return appDb(sql, params); };
  assert.deepEqual(await tableFor(noPrints, A), first);
  assert.equal(textRows, 8, "every document's pages (2 + 3 + 2 + 1), as before");
  // An edited page is fetched and checked again: the edited booklet no longer finds its limb row.
  await db.query("UPDATE policy_pages SET text=replace(text,'Loss of one limb','Loss of two limbs') WHERE policy_id=$1 AND page_number=1", [doc(2)]);
  textRows = 0; const edited = await tableFor(appDb, A);
  assert.equal(textRows, 5, "the edited booklet's pages and the letter's");
  assert.notDeepEqual(edited.table, first.table);
  // A new reading of a document is checked afresh too.
  await db.query("UPDATE benefit_readings SET reading=$2 WHERE policy_id=$1", [doc(1), JSON.stringify(reading(1, "Aisha Rahman", 250000, "Sum Assured\tRM250,000", [["Hospital Income", "Hospital Income\tRM200 per day", 2]]))]);
  textRows = 0; await tableFor(appDb, A);
  assert.equal(textRows, 4, "the re-read schedule's pages and the letter's");
  await db.close();
});
