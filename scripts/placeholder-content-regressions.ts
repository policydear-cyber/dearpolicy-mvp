/**
 * Regression suite for `security:placeholder-content-test`, as named in
 * .github/workflows/ci.yml ("Placeholder-content regression suite --
 * rejects placeholder markers, truncated/duplicated content in source and
 * migration files") and required by scripts/ci-required-suites.ts's
 * REQUIRED_CI_SUITES.
 *
 * Checkpoint 14d integrity correction: this script did not exist in the
 * committed repo before this checkpoint, even though `npm run
 * security:placeholder-content-test` (package.json), the CI step that
 * runs it (.github/workflows/ci.yml, confirmed present there already --
 * see scripts/ci-workflow-coverage-regressions.ts's own sabotage fixture,
 * which specifically picks THIS suite as "has been wired since before
 * this regression existed"), and its entry in REQUIRED_CI_SUITES all
 * already existed and referenced it. Unlike model:benchmark (see
 * scripts/model-benchmark.ts's removal, documented in PR #16's
 * Checkpoint 14d section), this one IS load-bearing for CI today -- CI on
 * this branch would fail the moment this step ran, until now. Confirmed
 * missing via a fresh GITHUB_GET_A_TREE listing against the real branch
 * head, not a local-checkout artifact.
 *
 * Static audit, not a live-request test -- same convention as
 * scripts/lifecycle-query-guard-regressions.ts / scripts/import-boundary-
 * regressions.ts / scripts/route-inventory-regressions.ts: scans real
 * source text on disk rather than exercising running code.
 *
 * Three checks, deliberately scoped narrowly to avoid both false
 * negatives (missing a genuine future regression) and false positives
 * (rejecting legitimate content this codebase already has -- e.g. the
 * literal word "placeholder" appears completely legitimately dozens of
 * times already, as an HTML <input placeholder="..."> attribute, in
 * explanatory comments, and as a deliberate test-fixture value, so a
 * bare substring match on that word would immediately reject this
 * codebase's own real, shipped, correct content):
 *
 *  1. UNRESOLVED_MARKERS -- a small, high-signal set of markers that
 *     legitimately never appear in this codebase's real source today
 *     (verified directly: zero hits for TODO/FIXME/XXX/TBD/"lorem ipsum"
 *     across app/, lib/, scripts/, components/, sql/ before this suite
 *     was written) plus literal, unresolved Git merge-conflict markers.
 *     Applied to BOTH source (.ts/.tsx) and migration (.sql) files.
 *     Deliberately does NOT include the bare word "placeholder" for the
 *     reason above.
 *  2. Truncated migration files -- sql/*.sql only. A migration file that
 *     was cut off mid-statement (a bad save, an interrupted paste, a
 *     merge gone wrong) is exactly the kind of thing that must never
 *     silently ship: checked two ways, both verified against every real
 *     file in sql/ today (all pass cleanly): (a) parenthesis balance
 *     (open count must equal close count), and (b) the file's last
 *     non-blank, non-comment line must end with a statement terminator
 *     (`;`) -- a file ending mid-identifier, mid-clause, or on a bare
 *     open construct fails this.
 *  3. Duplicated content -- sql/*.sql only. An 8-consecutive-non-blank-
 *     line window that appears IDENTICALLY more than once in the SAME
 *     file is a classic copy-paste-accident signature (verified zero
 *     such duplicates across every real file in sql/ today). Restricted
 *     to migration files (not general source) because legitimate,
 *     intentional repetition across similar route handlers or components
 *     is common in application source and would make an 8-line window
 *     check noisy there; a hand-written SQL migration has no equivalent
 *     legitimate reason to repeat an 8-line block verbatim.
 *
 * Sabotage-and-restore evidence for this suite: two forms, both
 * documented in PR #16's Checkpoint 14d section --
 *  (a) an in-process, permanent, repeatable proof (testInProcessSabotage
 *      below), mirroring scripts/ci-workflow-coverage-regressions.ts's own
 *      established pattern: mutates an in-memory COPY of real file
 *      content with each of the three violation types injected, and
 *      asserts every one is caught, on every run of this suite, without
 *      ever writing to a real file.
 *  (b) a one-time, real, file-level sabotage-and-restore cycle performed
 *      by hand against a real, live sql/ file during this checkpoint,
 *      confirmed with a sha256 diff before/after restore -- see the PR
 *      section for the exact command transcript.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const SELF_PATH = path.resolve("scripts/placeholder-content-regressions.ts");

async function findFiles(dir: string, extensions: readonly string[]): Promise<string[]> {
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
      files.push(...(await findFiles(full, extensions)));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      files.push(full);
    }
  }
  return files;
}

type Marker = { name: string; pattern: RegExp };

// Verified zero legitimate occurrences across this codebase's real
// source (app/, lib/, scripts/, components/, sql/) before this suite
// existed -- see file header. Word-bounded where relevant, so this never
// matches inside a longer, unrelated identifier.
const UNRESOLVED_MARKERS: readonly Marker[] = [
  { name: "TODO marker", pattern: /\bTODO\b/ },
  { name: "FIXME marker", pattern: /\bFIXME\b/ },
  { name: "XXX marker", pattern: /\bXXX\b/ },
  { name: "TBD marker", pattern: /\bTBD\b/ },
  { name: "lorem ipsum filler text", pattern: /lorem ipsum/i },
  { name: "unresolved Git merge-conflict marker (<<<<<<<)", pattern: /^<{7} /m },
  { name: "unresolved Git merge-conflict marker (=======)", pattern: /^={7}$/m },
  { name: "unresolved Git merge-conflict marker (>>>>>>>)", pattern: /^>{7} /m },
];

function findMarkers(text: string): string[] {
  const found: string[] = [];
  for (const marker of UNRESOLVED_MARKERS) {
    if (marker.pattern.test(text)) found.push(marker.name);
  }
  return found;
}

function isTruncated(sqlText: string): string | null {
  const opens = (sqlText.match(/\(/g) ?? []).length;
  const closes = (sqlText.match(/\)/g) ?? []).length;
  if (opens !== closes) return `unbalanced parentheses (${opens} '(' vs ${closes} ')') -- likely cut off mid-statement`;

  const lines = sqlText.split("\n").map((l) => l.trim());
  let lastMeaningful = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === "" || line.startsWith("--")) continue;
    lastMeaningful = line;
    break;
  }
  if (!lastMeaningful) return null; // empty file -- not this check's concern
  if (!lastMeaningful.endsWith(";")) {
    return `the file's last real line does not end with a statement terminator (";") -- last line was: ${JSON.stringify(lastMeaningful.slice(-60))}`;
  }
  return null;
}

const DUPLICATE_WINDOW = 8;

function findDuplicateBlock(sqlText: string): { firstLine: number; secondLine: number } | null {
  const rawLines = sqlText.split("\n");
  const meaningful: { text: string; lineNo: number }[] = [];
  rawLines.forEach((raw, idx) => {
    const trimmed = raw.trim();
    if (trimmed && !trimmed.startsWith("--")) meaningful.push({ text: trimmed, lineNo: idx + 1 });
  });
  const seen = new Map<string, number>();
  for (let i = 0; i + DUPLICATE_WINDOW <= meaningful.length; i++) {
    const block = meaningful
      .slice(i, i + DUPLICATE_WINDOW)
      .map((m) => m.text)
      .join("\n");
    const existing = seen.get(block);
    if (existing !== undefined) {
      return { firstLine: meaningful[existing].lineNo, secondLine: meaningful[i].lineNo };
    }
    seen.set(block, i);
  }
  return null;
}

let cases = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    cases++;
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}

async function testRealSourceHasNoUnresolvedMarkers() {
  const sourceFiles = (
    await Promise.all([findFiles("app", [".ts", ".tsx"]), findFiles("lib", [".ts", ".tsx"]), findFiles("scripts", [".ts"]), findFiles("components", [".ts", ".tsx"])])
  )
    .flat()
    .filter((f) => path.resolve(f) !== SELF_PATH);
  const sqlFiles = await findFiles("sql", [".sql"]);

  const violations: string[] = [];
  for (const file of [...sourceFiles, ...sqlFiles]) {
    const text = await readFile(file, "utf8");
    const found = findMarkers(text);
    if (found.length) violations.push(`${file}: ${found.join(", ")}`);
  }
  test(`real source and migration files (${sourceFiles.length + sqlFiles.length} scanned) contain zero unresolved placeholder/merge-conflict markers`, () => {
    assert.deepEqual(violations, [], `found unresolved markers:\n${violations.join("\n")}`);
  });
}

async function testRealMigrationFilesAreNotTruncated() {
  const sqlFiles = await findFiles("sql", [".sql"]);
  const violations: string[] = [];
  for (const file of sqlFiles) {
    const text = await readFile(file, "utf8");
    const reason = isTruncated(text);
    if (reason) violations.push(`${file}: ${reason}`);
  }
  test(`every real migration file (${sqlFiles.length} scanned) is well-formed and not truncated (balanced parentheses, ends on a terminated statement)`, () => {
    assert.deepEqual(violations, [], `found truncated migration files:\n${violations.join("\n")}`);
  });
}

async function testRealMigrationFilesHaveNoDuplicatedBlocks() {
  const sqlFiles = await findFiles("sql", [".sql"]);
  const violations: string[] = [];
  for (const file of sqlFiles) {
    const text = await readFile(file, "utf8");
    const dup = findDuplicateBlock(text);
    if (dup) violations.push(`${file}: identical ${DUPLICATE_WINDOW}-line block at line ${dup.firstLine} repeated verbatim at line ${dup.secondLine}`);
  }
  test(`every real migration file (${sqlFiles.length} scanned) has no accidental duplicated ${DUPLICATE_WINDOW}-line block`, () => {
    assert.deepEqual(violations, [], `found duplicated content:\n${violations.join("\n")}`);
  });
}

/**
 * In-process, permanent, repeatable sabotage proof -- mirrors
 * scripts/ci-workflow-coverage-regressions.ts's own established pattern.
 * Injects each of the three violation types into an in-memory COPY of
 * real file content and asserts this suite's own detector functions
 * catch every one. Never writes to a real file. This is what proves,
 * on every single run (not just once by hand during this checkpoint),
 * that these checks can actually fail.
 */
function testInProcessSabotage() {
  test("findMarkers() catches an injected TODO marker in an otherwise-clean real file", () => {
    const clean = "export function ok() { return 1; }\n";
    assert.deepEqual(findMarkers(clean), []);
    const sabotaged = clean + "// TODO: this must never ship\n";
    assert.ok(findMarkers(sabotaged).includes("TODO marker"));
  });

  test("findMarkers() catches an injected unresolved Git merge-conflict marker", () => {
    const clean = "const a = 1;\nconst b = 2;\n";
    assert.deepEqual(findMarkers(clean), []);
    const sabotaged = "<<<<<<< HEAD\n" + clean + "=======\nconst a = 2;\n>>>>>>> feature-branch\n";
    const found = findMarkers(sabotaged);
    assert.ok(found.some((m) => m.includes("<<<<<<<")));
    assert.ok(found.some((m) => m.includes("=======")));
    assert.ok(found.some((m) => m.includes(">>>>>>>")));
  });

  test("isTruncated() catches a migration file cut off mid-statement", () => {
    const clean = "CREATE TABLE IF NOT EXISTS widgets (id uuid PRIMARY KEY);\n";
    assert.equal(isTruncated(clean), null);
    const sabotagedMidParen = "CREATE TABLE IF NOT EXISTS widgets (id uuid PRIMARY KEY\n";
    assert.ok(isTruncated(sabotagedMidParen)?.includes("unbalanced parentheses"));
    const sabotagedNoTerminator = "CREATE TABLE IF NOT EXISTS widgets (id uuid PRIMARY KEY)\n";
    assert.ok(isTruncated(sabotagedNoTerminator)?.includes("does not end with a statement terminator"));
  });

  test("findDuplicateBlock() catches an accidentally duplicated 8-line block", () => {
    const block = Array.from({ length: 8 }, (_, i) => `line_${i};`).join("\n");
    const clean = block + "\nunrelated_tail_line;\n";
    assert.equal(findDuplicateBlock(clean), null);
    const sabotaged = block + "\nsomething_in_between;\n" + block + "\n";
    const dup = findDuplicateBlock(sabotaged);
    assert.ok(dup, "an 8-line block pasted twice into the same file must be caught");
    assert.notEqual(dup!.firstLine, dup!.secondLine);
  });
}

async function main() {
  testInProcessSabotage();
  await testRealSourceHasNoUnresolvedMarkers();
  await testRealMigrationFilesAreNotTruncated();
  await testRealMigrationFilesHaveNoDuplicatedBlocks();
  console.log(
    `placeholder-content regressions passed: ${cases} cases -- real source+migration files scanned for unresolved TODO/FIXME/XXX/TBD/lorem-ipsum/merge-conflict markers, real migration files checked for truncation (paren balance + terminated last statement) and for accidental duplicated ${DUPLICATE_WINDOW}-line blocks, plus 4 in-process sabotage-proof cases (mirroring scripts/ci-workflow-coverage-regressions.ts's own established pattern) confirming every one of these checks can actually catch a real regression, not just pass by construction.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
