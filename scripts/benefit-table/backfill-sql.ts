/** Free backfill for the alpha: the readings a paid test run already recorded for a household (raw-<policy>.json, its
 * page re-reads raw-<policy>-p<n>.json, and links.json), written as one SQL file the owner pastes into the database once,
 * so the household's benefit table fills without paying to read the documents again.
 *
 *   node --import tsx scripts/benefit-table/backfill-sql.ts --run-dir <run> --household-file snapshot.json --out <file.sql>
 *
 * Fail-safe: a reading is inserted only for a policy that is still that account's current document, never over a
 * reading already stored, and a link never over one already stored (the household's own links are kept). Every request
 * checks the stored readings against today's pages again (checkStored), so an imported row shows nothing the pages do
 * not print. The SQL holds household text, so --out must be outside the repository. No model is called. */
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { StoredReading } from "@/lib/benefit-table/service";

export const IMPORT_LABEL = "import of a recorded test reading";
type Backfill = { accountId: string; readings: { policyId: string; model: string; stored: StoredReading }[]; links: { section: string; cover: string | null; why: string }[]; label: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function backfillSql(b: Backfill): string {
  if (!UUID.test(b.accountId)) throw new Error("the account id is not a uuid");
  // Each JSON value is dollar-quoted with a tag its text does not contain, so no text in a reading can end the quote.
  const quoted = (text: string) => {
    let tag: string;
    do tag = `$bt${randomBytes(6).toString("hex")}$`; while (text.includes(tag));
    return `${tag}${text}${tag}`;
  };
  const acct = literal(b.accountId);
  const lines = [
    `-- Benefit table backfill (${b.label}): ${b.readings.length} readings and ${b.links.length} section links for one account.`,
    "-- Private: it holds household text. Paste it once into the SQL editor and run it. It changes nothing that is already stored.",
    "BEGIN;",
  ];
  for (const r of b.readings) {
    if (!UUID.test(r.policyId)) throw new Error(`policy id ${r.policyId} is not a uuid`);
    const id = literal(r.policyId);
    lines.push(`INSERT INTO benefit_readings(policy_id, account_id, reading, model, prompt_version, read_at)
SELECT ${id}::uuid, ${acct}::uuid, ${quoted(JSON.stringify(r.stored))}::jsonb, ${literal(r.model)}, ${literal(b.label)}, now()
WHERE EXISTS (SELECT 1 FROM policies WHERE id=${id}::uuid AND account_id=${acct}::uuid AND lifecycle_state='active' AND superseded_at IS NULL)
ON CONFLICT (policy_id) DO NOTHING;`);
  }
  for (const l of b.links)
    lines.push(`INSERT INTO benefit_links(account_id, section_key, cover_key, why, chosen_by, updated_at)
SELECT ${acct}::uuid, ${quoted(l.section)}, ${l.cover == null ? "NULL" : quoted(l.cover)}, ${quoted(l.why.slice(0, 300))}, 'model', now()
WHERE EXISTS (SELECT 1 FROM accounts WHERE id=${acct}::uuid)
ON CONFLICT (account_id, section_key) DO NOTHING;`);
  lines.push("COMMIT;",
    `SELECT (SELECT count(*) FROM benefit_readings WHERE account_id=${acct}::uuid AND prompt_version=${literal(b.label)}) AS readings_imported,`,
    `       (SELECT count(*) FROM benefit_links WHERE account_id=${acct}::uuid) AS links_stored;`,
    "-- To undo: DELETE FROM benefit_readings WHERE account_id=" + acct + "::uuid AND prompt_version=" + literal(b.label) + ";",
    "--          DELETE FROM benefit_links WHERE account_id=" + acct + "::uuid AND chosen_by='model';", "");
  return lines.join("\n");
}

/** The recorded run, as backfillSql takes it: each document's whole reading with its page re-reads in page order. */
export function backfillFromRun(dir: string, household: { accountId: string; documents: { policyId: string; pages: { page: number }[] }[] }, label: string): Backfill {
  const readings: Backfill["readings"] = [];
  for (const d of household.documents) {
    const raw = resolve(dir, `raw-${d.policyId}.json`);
    if (!existsSync(raw)) continue;
    const whole = JSON.parse(readFileSync(raw, "utf8")) as { json: unknown; model?: string };
    if (whole.json == null) continue;
    const pages = d.pages.flatMap((p) => {
      const f = resolve(dir, `raw-${d.policyId}-p${p.page}.json`);
      const j = existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as { json: unknown }).json : null;
      return j == null ? [] : [{ page: p.page, json: j }];
    });
    readings.push({ policyId: d.policyId, model: whole.model ?? "unknown", stored: { document: whole.json, pages } });
  }
  const linksPath = resolve(dir, "links.json");
  const links = existsSync(linksPath) ? ((JSON.parse(readFileSync(linksPath, "utf8")) as { json?: { links?: Backfill["links"] } }).json?.links ?? []) : [];
  return { accountId: household.accountId, readings, links, label };
}

function main() {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
  const dir = arg("--run-dir"), file = arg("--household-file"), out = arg("--out");
  if (!dir || !file || !out) throw new Error("--run-dir, --household-file and --out are required");
  const repo = realpathSync(resolve(__dirname, "../.."));
  if (realpathSync(dirname(resolve(out))).startsWith(repo)) throw new Error("--out must be outside the repository: the SQL holds household text");
  const household = JSON.parse(readFileSync(file, "utf8"));
  const b = backfillFromRun(dir, household, `${IMPORT_LABEL} (${arg("--label") ?? dir.split("/").filter(Boolean).pop()})`);
  writeFileSync(out, backfillSql(b));
  console.log(`wrote ${out}: ${b.readings.length} readings (${b.readings.reduce((n, r) => n + r.stored.pages.length, 0)} page re-reads), ${b.links.length} links`);
}
if (process.argv[1]?.endsWith("backfill-sql.ts")) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exit(1); }
}
