/**
 * Regression suite for the coverage property scripts/launch-check.ts's
 * checkGithubCiStatus() enforces: every suite named in REQUIRED_CI_SUITES
 * (scripts/ci-required-suites.ts) must have a corresponding
 * `npm run <script>` step somewhere in .github/workflows/ci.yml. This is a
 * coverage regression, not a re-implementation of checkGithubCiStatus()'s
 * own logic -- it imports the exact same required-suites list
 * checkGithubCiStatus() uses (rather than hand-duplicating it, which would
 * let the two silently drift apart the next time a suite is added to one
 * list and not the other) and asserts the same substring property against
 * the real workflow file on disk.
 *
 * Also proves, in-process and on every run, that this check can actually
 * fail: a mutated COPY of the real ci.yml text with one required step's
 * `npm run` line deleted must be rejected by the exact same assertion the
 * real file is checked with. The real file on disk is never touched by
 * this suite. This is the permanent, repeatable form of the sabotage-cycle
 * evidence for this regression -- proving it catches a real regression
 * every time it runs, not just once by hand.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REQUIRED_CI_SUITES } from "./ci-required-suites";

const CI_PATH = ".github/workflows/ci.yml";

function findMissingSuites(ciContents: string, requiredSuites: readonly string[] = REQUIRED_CI_SUITES): string[] {
  return requiredSuites.filter((suite) => !ciContents.includes(`npm run ${suite}`));
}

function testRealWorkflowHasFullCoverage() {
  const ci = readFileSync(CI_PATH, "utf8");
  const missing = findMissingSuites(ci);
  assert.deepEqual(
    missing,
    [],
    `${CI_PATH} is missing a CI step for: ${missing.join(", ")} -- every suite in REQUIRED_CI_SUITES must have a ` +
      "\`npm run <script>\` step somewhere in the workflow, or scripts/launch-check.ts's github_ci_status capability " +
      "will report blocked_by_code.",
  );
  console.log(
    `ci-workflow-coverage regressions passed (real file): all ${REQUIRED_CI_SUITES.length} required launch suites ` +
      `from REQUIRED_CI_SUITES have a corresponding \`npm run\` step in ${CI_PATH}.`,
  );
}

function testSabotagedCopyIsCaught() {
  const ci = readFileSync(CI_PATH, "utf8");

  // Pick a required suite that is genuinely present in the real file today
  // (the last entry, security:placeholder-content-test, has been wired
  // since before this regression existed) and delete only its `npm run`
  // line from an in-memory COPY -- the real file on disk is never written
  // to by this function.
  const targetSuite = REQUIRED_CI_SUITES[REQUIRED_CI_SUITES.length - 1];
  const targetLine = `npm run ${targetSuite}`;
  assert.ok(
    ci.includes(targetLine),
    `fixture assumption failed: \`${targetLine}\` was expected to already be present in ${CI_PATH} -- pick a ` +
      "different target suite for this sabotage fixture.",
  );

  const sabotaged = ci
    .split("\n")
    .filter((line) => !line.includes(targetLine))
    .join("\n");
  assert.ok(!sabotaged.includes(targetLine), "sabotage fixture did not actually remove the line -- fixture is broken");

  const missingBefore = findMissingSuites(ci);
  assert.ok(!missingBefore.includes(targetSuite), "the real, unmodified file must not be reported as missing this suite");

  const missingAfter = findMissingSuites(sabotaged);
  assert.ok(
    missingAfter.includes(targetSuite),
    `deleting the \`${targetLine}\` step from a copy of ${CI_PATH} must be caught as a missing required suite -- it ` +
      "was not, so this regression cannot actually detect a real CI-coverage regression.",
  );

  console.log(
    `ci-workflow-coverage sabotage cycle passed: deleting \`${targetLine}\` from an in-memory copy of ${CI_PATH} makes ` +
      "findMissingSuites() report it missing (caught); the real, unmodified file still reports zero missing suites " +
      "(no false positive).",
  );
}

function main() {
  testRealWorkflowHasFullCoverage();
  testSabotagedCopyIsCaught();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { findMissingSuites };
