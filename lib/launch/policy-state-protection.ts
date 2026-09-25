/**
 * launch:check verifier for policy-processing and coverage-verification
 * state protection (policies / policy_coverages). Reads the real migration
 * source, column classification, workflow and required-suite inventory on
 * every run and reports every gap; `ready` only when there are none.
 * Exercised by scripts/launch-check-verifier-regressions.mjs's
 * sabotage-and-restore cycles (broad browser UPDATE restored, browser INSERT
 * granted, RLS removed, guard trigger removed, CI step removed, unclassified
 * trusted column added).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { BROWSER_WRITABLE_COLUMNS, COLUMN_CLASSES, POLICY_STATE_COLUMNS, TABLE_INVENTORY } from "@/lib/db/table-inventory";

export const POLICY_STATE_MIGRATION = "sql/household-rls.sql";
export const POLICY_STATE_SUITE_SCRIPT = "security:policy-state-test";
export const POLICY_STATE_TRIGGER = "guard_household_policy_update";
const TABLES = ["policies", "policy_coverages"] as const;
type PolicyStateTable = (typeof TABLES)[number];
const BROWSER_ROLE = /\b(anon|authenticated|public)\b/i;
// Classes a browser role may ever be granted to write directly.
const BROWSER_SAFE_CLASSES = new Set(["household_editable", "lifecycle_route_only"]);

const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, "");
const tableName = (raw: string) => raw.trim().replace(/"/g, "").replace(/^public\./i, "").toLowerCase();
const isStateTable = (t: string): t is PolicyStateTable => (TABLES as readonly string[]).includes(t);
const arrayLiteral = (sql: string, name: string): string[] | null => {
  const m = new RegExp(`${name}\\s+text\\[\\]\\s*:=\\s*ARRAY\\[([\\s\\S]*?)\\]`, "i").exec(sql);
  return m ? [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]) : null;
};

/** Every column any migration creates on policies / policy_coverages. */
export function discoverPolicyStateColumns(sqlDir = "sql"): Record<PolicyStateTable, string[]> {
  const found: Record<PolicyStateTable, Set<string>> = { policies: new Set(), policy_coverages: new Set() };
  for (const file of readdirSync(sqlDir).filter((f) => f.endsWith(".sql"))) {
    const sql = stripComments(readFileSync(path.join(sqlDir, file), "utf8"));
    for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:public\.)?"?[a-z_][a-z0-9_]*"?)\s*\(([\s\S]*?)\n\);/gi)) {
      const t = tableName(m[1]);
      if (!isStateTable(t)) continue;
      for (const line of m[2].split("\n")) {
        const col = /^\s*"?([a-z_][a-z0-9_]*)"?\s+[a-z]/i.exec(line)?.[1]?.toLowerCase();
        if (col && !["primary", "unique", "constraint", "check", "foreign", "exclude"].includes(col)) found[t].add(col);
      }
    }
    for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?((?:public\.)?"?[a-z_][a-z0-9_]*"?)\s+([^;]*);/gi)) {
      const t = tableName(m[1]);
      if (!isStateTable(t)) continue;
      for (const c of m[2].matchAll(/ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) {
        const col = c[1].toLowerCase();
        if (col !== "constraint") found[t].add(col);
      }
    }
  }
  return { policies: [...found.policies].sort(), policy_coverages: [...found.policy_coverages].sort() };
}

export function evaluatePolicyStateProtection(root = process.cwd()): { ok: boolean; problems: string[]; summary: string } {
  const problems: string[] = [];
  const sqlDir = path.join(root, "sql");

  // 1. Every column is classified, and the browser-writable set is safe.
  const discovered = discoverPolicyStateColumns(sqlDir);
  for (const t of TABLES) {
    const classes = POLICY_STATE_COLUMNS[t];
    for (const c of discovered[t]) if (!(c in classes)) problems.push(`${t}.${c} is created by a migration but not classified in POLICY_STATE_COLUMNS`);
    for (const c of Object.keys(classes)) if (!discovered[t].includes(c)) problems.push(`POLICY_STATE_COLUMNS classifies ${t}.${c}, which no migration creates`);
    for (const [c, k] of Object.entries(classes)) if (!(COLUMN_CLASSES as readonly string[]).includes(k)) problems.push(`${t}.${c} has unknown class ${k}`);
    const writable = BROWSER_WRITABLE_COLUMNS[t];
    for (const c of [...writable.insert, ...writable.update]) {
      if (!BROWSER_SAFE_CLASSES.has(classes[c] ?? "")) problems.push(`BROWSER_WRITABLE_COLUMNS lets a browser write ${t}.${c} (class ${classes[c] ?? "unclassified"})`);
    }
    if (writable.insert.length) problems.push(`BROWSER_WRITABLE_COLUMNS allows browser INSERT on ${t}; rows must be created by the server`);
    if (writable.delete) problems.push(`BROWSER_WRITABLE_COLUMNS allows browser DELETE on ${t}`);
    const inv = TABLE_INVENTORY[t];
    if (!inv) problems.push(`lib/db/table-inventory.ts does not inventory ${t}`);
    else {
      const ops = inv.authenticated ?? [];
      if (ops.includes("insert") || ops.includes("delete")) problems.push(`TABLE_INVENTORY lets authenticated ${ops.join("/")} ${t}`);
      if (ops.includes("update") && writable.update.length === 0) problems.push(`TABLE_INVENTORY lets authenticated update ${t} but no column is browser-writable`);
    }
  }

  // 2. The authoritative migration revokes, enables RLS and installs the guard.
  const migrationPath = path.join(root, POLICY_STATE_MIGRATION);
  if (!existsSync(migrationPath)) problems.push(`${POLICY_STATE_MIGRATION} is missing`);
  else {
    const sql = stripComments(readFileSync(migrationPath, "utf8"));
    for (const t of TABLES) {
      if (!new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`).test(sql)) problems.push(`${POLICY_STATE_MIGRATION} no longer enables RLS on ${t}`);
      if (!new RegExp(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\\.${t} FROM authenticated, anon`).test(sql)) problems.push(`${POLICY_STATE_MIGRATION} no longer revokes browser INSERT/UPDATE/DELETE on ${t}`);
    }
    const fn = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${POLICY_STATE_TRIGGER}\\(\\)[\\s\\S]*?\\$\\$;`).exec(sql)?.[0] ?? "";
    if (!fn) problems.push(`${POLICY_STATE_MIGRATION} no longer defines ${POLICY_STATE_TRIGGER}()`);
    else {
      for (const [re, what] of [
        [/current_user IN \('authenticated', 'anon'\) AND \(/, "scopes the guard to browser roles"],
        [/OLD\.lifecycle_state IS DISTINCT FROM 'active'/, "requires an active source row"],
        [/NEW\.lifecycle_state IS DISTINCT FROM 'pending_deletion'/, "allows only pending_deletion as the target"],
        [/NEW\.lifecycle_version IS DISTINCT FROM OLD\.lifecycle_version \+ 1/, "requires a version bump"],
        [/RAISE EXCEPTION/, "raises on any other change"],
      ] as [RegExp, string][]) if (!re.test(fn)) problems.push(`${POLICY_STATE_TRIGGER}() no longer ${what}`);
    }
    if (!new RegExp(`CREATE TRIGGER ${POLICY_STATE_TRIGGER} BEFORE UPDATE ON public\\.policies FOR EACH ROW`).test(sql)) problems.push(`${POLICY_STATE_MIGRATION} no longer installs trigger ${POLICY_STATE_TRIGGER} on policies`);
  }

  // 3. No migration re-opens these tables to a browser role.
  for (const file of readdirSync(sqlDir).filter((f) => f.endsWith(".sql"))) {
    const sql = stripComments(readFileSync(path.join(sqlDir, file), "utf8"));
    const members = arrayLiteral(sql, "member_tables");
    if (members) for (const t of TABLES) if (members.includes(t)) problems.push(`${file}: member_tables restores household INSERT/UPDATE/DELETE on ${t}`);
    for (const m of sql.matchAll(/GRANT\s+([^;']*?)\s+ON\s+(?:TABLE\s+)?([^;']*?)\s+TO\s+([^;']*)/gi)) {
      if (!BROWSER_ROLE.test(m[3])) continue;
      const targetText = m[2].trim();
      if (/ALL\s+TABLES\s+IN\s+SCHEMA/i.test(targetText) && /\b(ALL|INSERT|UPDATE)\b/i.test(m[1])) { problems.push(`${file}: grants write on ALL TABLES to a browser role (${m[0].slice(0, 100)})`); continue; }
      const targets = targetText.split(",").map(tableName).filter(isStateTable);
      if (!targets.length) continue;
      for (const priv of m[1].split(/,(?![^()]*\))/).map((p) => p.trim())) {
        const pm = /^(SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|ALL(?:\s+PRIVILEGES)?)\s*(?:\(([^)]*)\))?$/i.exec(priv);
        if (!pm) { problems.push(`${file}: unrecognised grant on ${targets.join(", ")} (${priv})`); continue; }
        const verb = pm[1].toUpperCase(); const cols = pm[2]?.split(",").map((c) => c.trim().replace(/"/g, "").toLowerCase());
        if (verb === "SELECT" || verb === "REFERENCES") continue;
        for (const t of targets) {
          const allowed = verb === "UPDATE" ? BROWSER_WRITABLE_COLUMNS[t].update : verb === "INSERT" ? BROWSER_WRITABLE_COLUMNS[t].insert : [];
          if (!cols) problems.push(`${file}: grants ${verb} on every column of ${t} to a browser role`);
          else for (const c of cols) if (!allowed.includes(c)) problems.push(`${file}: grants ${verb} (${c}) on ${t} to a browser role; ${t}.${c} is ${POLICY_STATE_COLUMNS[t][c] ?? "unclassified"}`);
        }
      }
    }
    for (const m of sql.matchAll(/CREATE\s+POLICY\s+("?[\w%]+"?)\s+ON\s+((?:public\.)?"?[a-z_][a-z0-9_]*"?)([^;']*)/gi)) {
      const t = tableName(m[2]);
      if (!isStateTable(t)) continue;
      const cmd = (/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i.exec(m[3])?.[1] ?? "ALL").toUpperCase();
      const permitted = t === "policies" ? ["SELECT", "UPDATE"] : ["SELECT"];
      if (!permitted.includes(cmd)) problems.push(`${file}: policy ${m[1]} opens ${cmd} on ${t}`);
    }
    for (const t of TABLES) {
      if (new RegExp(`ALTER TABLE (?:public\\.)?${t} DISABLE ROW LEVEL SECURITY`, "i").test(sql)) problems.push(`${file}: disables RLS on ${t}`);
    }
    if (new RegExp(`DROP TRIGGER (?:IF EXISTS )?${POLICY_STATE_TRIGGER}`, "i").test(sql) && !new RegExp(`CREATE TRIGGER ${POLICY_STATE_TRIGGER}`, "i").test(sql)) problems.push(`${file}: drops ${POLICY_STATE_TRIGGER} without recreating it`);
  }

  // 4. The executable proof is wired into CI and required.
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
  if (!pkg.scripts?.[POLICY_STATE_SUITE_SCRIPT]) problems.push(`package.json has no ${POLICY_STATE_SUITE_SCRIPT} script`);
  const ci = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  if (!new RegExp(`run:\\s*npm run ${POLICY_STATE_SUITE_SCRIPT}\\s*$`, "m").test(ci)) problems.push(`CI does not run npm run ${POLICY_STATE_SUITE_SCRIPT}`);
  const requiredSuites = readFileSync(path.join(root, "scripts/ci-required-suites.ts"), "utf8");
  if (!requiredSuites.includes(`"${POLICY_STATE_SUITE_SCRIPT}"`)) problems.push(`scripts/ci-required-suites.ts does not require ${POLICY_STATE_SUITE_SCRIPT}`);

  const classified = TABLES.map((t) => Object.keys(POLICY_STATE_COLUMNS[t]).length);
  return {
    ok: problems.length === 0,
    problems,
    summary: `${classified[0]} policies + ${classified[1]} policy_coverages columns classified; browser-writable: policies UPDATE(${BROWSER_WRITABLE_COLUMNS.policies.update.join(", ")}), policy_coverages none; ${problems.length} problem(s)`,
  };
}
