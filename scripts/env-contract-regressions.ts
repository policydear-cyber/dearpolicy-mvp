import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function findSourceFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findSourceFiles(full)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

// Matches both `process.env.NAME` and this codebase's common
// `env.NAME` alias (functions taking `env: NodeJS.ProcessEnv = process.env`
// as a parameter, for testability) -- a scan for only the former misses a
// real, launch-critical secret (TELEMETRY_PSEUDONYM_SECRET, read exclusively
// via the `env.` alias in lib/telemetry/pseudonymize.ts).
const DOT_ACCESS = /\b(?:process\.env|env)\.([A-Z_][A-Z0-9_]*)\b/g;
// Matches bracket access with a literal key: `process.env["NAME"]` /
// `env['NAME']` / `env[`NAME`]`.
const BRACKET_LITERAL_ACCESS = /\b(?:process\.env|env)\[['"`]([A-Z_][A-Z0-9_]*)['"`]\]/g;

function referencedEnvVars(text: string): Set<string> {
  const names = new Set<string>();
  for (const pattern of [DOT_ACCESS, BRACKET_LITERAL_ACCESS]) {
    for (const match of text.matchAll(pattern)) names.add(match[1]);
  }
  return names;
}

// Names the platform/runtime/CI provides on its own -- never application
// configuration, so they never belong in .env.example.
const STANDARD_ALLOWLIST = new Set(["NODE_ENV", "GITHUB_REPOSITORY", "GITHUB_SHA", "GITHUB_TOKEN", "USER"]);

// lib/ai/rollout.ts's canaryConfigFor() builds
// CANARY_<OPERATION>_{MODEL,PERCENTAGE,KILL_SWITCH} from a template literal,
// one triple per lib/ai/provenance.ts's KNOWN_OPERATIONS (14 operations, so
// ~42 concrete names plus CANARY_KILL_SWITCH_ALL) -- no literal name for
// most of these ever appears in source, so a text scan cannot enumerate
// them individually. .env.example documents the *pattern* instead of each
// concrete name; this scanner accepts anything matching the same pattern
// without requiring an exact .env.example line per operation.
//
// DISCLOSED LIMITATION (same class as scripts/lifecycle-query-guard-
// regressions.ts's helper-wrapper gap): any OTHER dynamically-built env-var
// name (a name assembled from a template literal or concatenation this
// scanner hasn't been told about) is equally invisible here. Extend the
// allowlist pattern below, and .env.example's own documentation, together
// whenever a new dynamic family is introduced.
const DYNAMIC_ALLOW_PATTERN = /^CANARY_[A-Z0-9_]+_(MODEL|PERCENTAGE|KILL_SWITCH)$/;

function parseDocumentedNames(envExampleText: string): Set<string> {
  const names = new Set<string>();
  const re = /^#?\s*([A-Z][A-Z0-9_]*)\s*=/gm;
  for (const match of envExampleText.matchAll(re)) names.add(match[1]);
  return names;
}

function isAllowlisted(name: string): boolean {
  return STANDARD_ALLOWLIST.has(name) || DYNAMIC_ALLOW_PATTERN.test(name);
}

// Root-level files outside app/, lib/ and scripts/ that still read
// process.env directly.
const ROOT_FILES = ["middleware.ts", "next.config.ts", "instrumentation.ts"];

async function main() {
  // Self-test: prove the scan+diff logic actually flags something, so this
  // regression cannot pass merely because it scanned nothing.
  {
    const fixtureUsed = referencedEnvVars(
      "const a = process.env.TOTALLY_MADE_UP_UNDOCUMENTED_VAR;\nconst b = env.ANOTHER_MADE_UP_VAR;",
    );
    const fixtureDocumented = parseDocumentedNames("OTHER_VAR=\n# ANOTHER_MADE_UP_VAR=default\n");
    const fixtureGap = [...fixtureUsed].filter((n) => !fixtureDocumented.has(n) && !isAllowlisted(n)).sort();
    assert.deepEqual(
      fixtureGap,
      ["TOTALLY_MADE_UP_UNDOCUMENTED_VAR"],
      "self-test: the scanner must flag an undocumented reference and respect both active and commented .env.example lines",
    );
    const fixtureCanary = referencedEnvVars("env.CANARY_HOSTED_OCR_PERCENTAGE");
    assert.ok(
      [...fixtureCanary].every(isAllowlisted),
      "self-test: the dynamic CANARY_<OPERATION>_* pattern must be accepted without a literal .env.example line",
    );
  }

  const roots = ["app", "lib", "scripts"].map((d) => path.resolve(d));
  const files = (await Promise.all(roots.map(findSourceFiles))).flat();
  for (const rootFile of ROOT_FILES) files.push(path.resolve(rootFile));
  assert.ok(files.length > 300, "sanity check: expected the whole app/+lib/+scripts/ tree plus root config files");

  const envExampleText = await readFile(path.resolve(".env.example"), "utf8");
  const documented = parseDocumentedNames(envExampleText);

  const usedBy: Record<string, string[]> = {};
  for (const file of files) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue; // a listed root file absent from this checkout is not this regression's concern
    }
    const relative = path.relative(path.resolve("."), file);
    for (const name of referencedEnvVars(text)) {
      (usedBy[name] ??= []).push(relative);
    }
  }

  const undocumented = Object.keys(usedBy)
    .filter((name) => !documented.has(name) && !isAllowlisted(name))
    .sort();

  if (undocumented.length > 0) {
    const detail = undocumented
      .map((name) => {
        const files = usedBy[name];
        const extra = files.length > 1 ? ` and ${files.length - 1} more` : "";
        return `  ${name} (referenced in ${files[0]}${extra})`;
      })
      .join("\n");
    assert.fail(
      `${undocumented.length} environment variable(s) are read by real source but not documented in .env.example:\n${detail}\n` +
        "Add each to .env.example (name, scope, default, secret-or-not) or, if it is a dynamically-built name " +
        "(like CANARY_<OPERATION>_*), extend DYNAMIC_ALLOW_PATTERN above and document the pattern instead of each name.",
    );
  }

  console.log(
    `environment-contract regression passed (${Object.keys(usedBy).length} distinct vars referenced across ` +
      `app/+lib/+scripts/+root, all documented in .env.example or explicitly allowlisted).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
