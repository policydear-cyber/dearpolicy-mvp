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
