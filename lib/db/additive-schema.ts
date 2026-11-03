/**
 * Applies an additive schema file (CREATE TABLE / ADD COLUMN / CREATE INDEX, all IF NOT EXISTS) only when something it
 * creates is missing.
 *
 * Running the file is not free even when everything exists: `ALTER TABLE … ADD COLUMN IF NOT EXISTS` takes the table's
 * exclusive lock before it finds the column there, so it waits for every open transaction on that table (a document
 * being read, another page loading) and then holds up every query behind it. A page's first load on a new server
 * instance ran two such files over `policies` (Benefits load, 3 Nov: one open reader of `policies` held a cold Benefits
 * load for its whole length). The check below reads only the catalogue, which takes no table lock.
 *
 * Fails safe: a file with any statement this does not recognise, or a check that cannot answer, runs the file exactly
 * as before.
 */
export type SchemaObjects = { tables: string[]; columns: { table: string; column: string }[]; indexes: string[] };

const IDENT = "([a-z_][a-z0-9_]*)";
const TABLE = new RegExp(`^create table if not exists ${IDENT} \\(`);
const COLUMN = new RegExp(`^alter table ${IDENT} add column if not exists ${IDENT} [^,]*$`);
const INDEX = new RegExp(`^create (?:unique )?index if not exists ${IDENT} on `);

/** What the file creates, or null when any statement is something else (then the file must always run). */
export function schemaObjects(sql: string): SchemaObjects | null {
  // One pass, character by character: a "--" comment is dropped only outside a string literal, and every literal (a
  // default such as '{}', a doubled '' inside it) is blanked to '', so neither a ";" nor a "--" inside one is ever read
  // as SQL (Critic #306 M1). A literal left open, a backslash (E'' escapes), a quoted identifier or a dollar-quoted body
  // (functions, DO blocks) outside a comment is not parsed: the file then always runs.
  let body = "";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") { while (i < sql.length && sql[i] !== "\n") i++; body += "\n"; continue; }
    // A block comment could hide a quote that pairs with another statement's: not parsed.
    if (c === "/" && sql[i + 1] === "*") return null;
    if (c !== "'") { body += c; continue; }
    let closed = false;
    for (i++; i < sql.length; i++) {
      if (sql[i] === "\\") return null;
      if (sql[i] !== "'") continue;
      if (sql[i + 1] === "'") { i++; continue; }
      closed = true; break;
    }
    if (!closed) return null;
    body += "''";
  }
  if (/["$\\]/.test(body)) return null;
  const found: SchemaObjects = { tables: [], columns: [], indexes: [] };
  for (const raw of body.split(";")) {
    const statement = raw.replace(/\s+/g, " ").trim();
    if (!statement) continue;
    // Matched in lower case: unquoted identifiers are folded to lower case by Postgres too.
    const s = statement.toLowerCase();
    let m: RegExpExecArray | null;
    if ((m = TABLE.exec(s))) found.tables.push(m[1]);
    else if ((m = COLUMN.exec(s))) found.columns.push({ table: m[1], column: m[2] });
    else if ((m = INDEX.exec(s))) found.indexes.push(m[1]);
    else return null;
  }
  return found;
}

type Client = { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/** Whether every object is already there, read from the catalogue only. */
export async function schemaPresent(client: Client, objects: SchemaObjects): Promise<boolean> {
  const relations = [...objects.tables, ...objects.indexes];
  const { rows } = await client.query(
    `SELECT coalesce((SELECT bool_and(to_regclass(r) IS NOT NULL) FROM unnest($1::text[]) AS u(r)), true)
        AND coalesce((SELECT bool_and(EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass(t) AND a.attname = c
              AND a.attnum > 0 AND NOT a.attisdropped)) FROM unnest($2::text[], $3::text[]) AS u(t, c)), true) AS present`,
    [relations, objects.columns.map((c) => c.table), objects.columns.map((c) => c.column)]);
  return rows[0]?.present === true;
}

/** True when the file can be skipped: it only creates things, and all of them exist. Any failure answers false. */
export async function additiveSchemaInPlace(client: Client, sql: string): Promise<boolean> {
  const objects = schemaObjects(sql);
  if (!objects) return false;
  try { return await schemaPresent(client, objects); } catch { return false; }
}
