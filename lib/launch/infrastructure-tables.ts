/**
 * launch:check verifier for infrastructure-table protection. Reads the real
 * migration source, workflow and required-suite inventory on every run and
 * reports every gap; `ready` only when there are none. Exercised by
 * scripts/launch-check-verifier-regressions.mjs's sabotage-and-restore
 * cycles (unclassified table, removed RLS, removed revoke, permissive
 * browser policy, removed CI step).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { discoverMigrationTables, inventoryDrift, INFRASTRUCTURE_TABLES } from "@/lib/db/table-inventory";

export const INFRASTRUCTURE_MIGRATION = "sql/infrastructure-rls.sql";
export const INFRASTRUCTURE_SUITE_SCRIPT = "security:infrastructure-tables-test";

const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, "");
const arrayLiteral = (sql: string, name: string): string[] | null => {
  const m = new RegExp(`${name}\\s+text\\[\\]\\s*:=\\s*ARRAY\\[([\\s\\S]*?)\\]`, "i").exec(sql);
  return m ? [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]) : null;
};

export function evaluateInfrastructureTableProtection(root = process.cwd()): { ok: boolean; problems: string[]; summary: string } {
  const problems: string[] = [];
  const sqlDir = path.join(root, "sql");
  const discovered = discoverMigrationTables(sqlDir);
  const drift = inventoryDrift(discovered);
  if (drift.unclassified.length) problems.push(`unclassified table(s) not in lib/db/table-inventory.ts: ${drift.unclassified.join(", ")}`);
  if (drift.stale.length) problems.push(`inventory lists table(s) no migration creates: ${drift.stale.join(", ")}`);

  const migrationPath = path.join(root, INFRASTRUCTURE_MIGRATION);
  if (!existsSync(migrationPath)) {
    problems.push(`${INFRASTRUCTURE_MIGRATION} is missing`);
  } else {
    const sql = stripComments(readFileSync(migrationPath, "utf8"));
    const listed = arrayLiteral(sql, "infra");
    if (!listed) problems.push(`${INFRASTRUCTURE_MIGRATION} has no infra table list`);
    else {
      const missing = INFRASTRUCTURE_TABLES.filter((t) => !listed.includes(t));
      const extra = listed.filter((t) => !INFRASTRUCTURE_TABLES.includes(t));
      if (missing.length) problems.push(`infrastructure table(s) not protected by ${INFRASTRUCTURE_MIGRATION}: ${missing.join(", ")}`);
      if (extra.length) problems.push(`${INFRASTRUCTURE_MIGRATION} protects table(s) the inventory does not classify as infrastructure: ${extra.join(", ")}`);
    }
    const required: [RegExp, string][] = [
      [/ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY/, "enable RLS"],
      [/REVOKE ALL ON public\.%I FROM PUBLIC/, "revoke table privileges from PUBLIC"],
      [/REVOKE ALL ON public\.%I FROM anon/, "revoke table privileges from anon"],
      [/REVOKE ALL ON public\.%I FROM authenticated/, "revoke table privileges from authenticated"],
      [/REVOKE ALL ON SEQUENCE %s FROM authenticated/, "revoke sequence privileges from authenticated"],
      [/REVOKE ALL ON SEQUENCE %s FROM anon/, "revoke sequence privileges from anon"],
      [/FOR p IN SELECT policyname FROM pg_policies[\s\S]*?DROP POLICY %I ON public\.%I/, "drop every other policy on the table"],
      [/CREATE POLICY %I ON public\.%I FOR ALL TO PUBLIC USING \(false\) WITH CHECK \(false\)/, "single always-false policy"],
    ];
    for (const [re, what] of required) if (!re.test(sql)) problems.push(`${INFRASTRUCTURE_MIGRATION} no longer does: ${what}`);
  }

  // No other migration may open an infrastructure table to a browser role.
  const infra = new Set(INFRASTRUCTURE_TABLES);
  for (const file of readdirSync(sqlDir).filter((f) => f.endsWith(".sql"))) {
    const sql = stripComments(readFileSync(path.join(sqlDir, file), "utf8"));
    for (const m of sql.matchAll(/CREATE\s+POLICY\s+("?[\w%]+"?)\s+ON\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?([\s\S]*?);/gi)) {
      const table = m[2].toLowerCase();
      if (!infra.has(table)) continue;
      const body = m[3];
      const alwaysFalse = /USING\s*\(\s*false\s*\)/i.test(body) && (!/WITH\s+CHECK/i.test(body) || /WITH\s+CHECK\s*\(\s*false\s*\)/i.test(body));
      if (!alwaysFalse) problems.push(`${file}: permissive policy ${m[1]} on infrastructure table ${table}`);
    }
    for (const m of sql.matchAll(/GRANT\s+[^;]*?\s+ON\s+(?:TABLE\s+)?([^;]*?)\s+TO\s+([^;]*);/gi)) {
      const targets = m[1].split(",").map((s) => s.trim().replace(/^public\./, "").toLowerCase());
      if (/\b(anon|authenticated|public)\b/i.test(m[2]) && targets.some((t) => infra.has(t))) problems.push(`${file}: grants an infrastructure table to a browser role (${m[0].slice(0, 120)})`);
    }
    const members = arrayLiteral(sql, "member_tables");
    if (members) {
      const leaked = members.filter((t) => infra.has(t));
      if (leaked.length) problems.push(`${file}: member_tables grants household CRUD on infrastructure table(s): ${leaked.join(", ")}`);
    }
  }

  // The executable proof must be wired into CI and required.
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
  if (!pkg.scripts?.[INFRASTRUCTURE_SUITE_SCRIPT]) problems.push(`package.json has no ${INFRASTRUCTURE_SUITE_SCRIPT} script`);
  const ci = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  if (!new RegExp(`run:\\s*npm run ${INFRASTRUCTURE_SUITE_SCRIPT}\\s*$`, "m").test(ci)) problems.push(`CI does not run npm run ${INFRASTRUCTURE_SUITE_SCRIPT}`);
  const requiredSuites = readFileSync(path.join(root, "scripts/ci-required-suites.ts"), "utf8");
  if (!requiredSuites.includes(`"${INFRASTRUCTURE_SUITE_SCRIPT}"`)) problems.push(`scripts/ci-required-suites.ts does not require ${INFRASTRUCTURE_SUITE_SCRIPT}`);

  return {
    ok: problems.length === 0,
    problems,
    summary: `${discovered.length} migrated tables classified; ${INFRASTRUCTURE_TABLES.length} service/operator-only tables; ${problems.length} problem(s)`,
  };
}
