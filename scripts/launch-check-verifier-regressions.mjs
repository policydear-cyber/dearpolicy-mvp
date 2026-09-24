#!/usr/bin/env node
/**
 * Checkpoint 14h (claude/v1-launch-hardening): proves scripts/launch-check.ts's
 * rewritten verifiers are actually sensitive to the real underlying state --
 * not a superficial/static source-text check that always reports the same
 * thing regardless of what the code actually does. This is the exact
 * requirement the launch-hardening spec names: "Add a test ensuring it
 * cannot become a superficial source-text check."
 *
 * Method: for each targeted capability, sabotage the REAL production file
 * the verifier is supposed to be checking (a single, surgical, byte-precise
 * edit -- never scripts/launch-check.ts itself, which would only prove the
 * verifier's OWN logic runs, not that it is checking something real),
 * spawn `node --import tsx scripts/launch-check.ts --only=<id> --json` as a
 * real child process, parse the real JSON result, and assert the reported
 * status actually changed to reflect the sabotage. Then restore the file to
 * its EXACT original byte content (verified, not assumed) and re-run,
 * asserting the status flips back. If a verifier's status did NOT change
 * under sabotage, this test fails -- which is exactly what would have
 * caught every one of this checkpoint's 6 previously-hardcoded verifiers
 * (their status literally could not have changed, because they never
 * inspected anything).
 *
 * Deliberately PLAIN JavaScript (.mjs), not TypeScript-via-tsx -- the same
 * choice scripts/full-household-e2e-orchestrator.mjs's own header already
 * documents and for the identical reason: this harness spawns
 * scripts/launch-check.ts (itself tsx-loaded), which in turn spawns each
 * targeted regression suite (also tsx-loaded) via --only=<id> --json. Real,
 * repeatable measurement in this sandbox: with this harness ALSO tsx-loaded
 * (three nested tsx-transform process layers alive, if only one truly
 * "active" at a time -- spawnSync blocks synchronously, but a blocked
 * parent's resident memory is NOT released to the OS while it waits), the
 * innermost regression-suite child was reliably killed by this sandbox's
 * memcg OOM killer (confirmed via dmesg: "Memory cgroup out of memory:
 * Killed process ... (node)", signal=SIGKILL, status=null) on 3/3 runs --
 * while the exact same nesting with a plain (non-tsx) outer harness never
 * did. Running this harness itself as plain .mjs removes one whole
 * tsx-transform-loaded process layer's resident memory from the chain,
 * which was the difference between a reliable OOM and a reliable pass.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

let cases = 0;

function runOnly(id, timeoutMs = 90_000) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/launch-check.ts", `--only=${id}`, "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: timeoutMs,
    env: process.env,
  });
  assert.equal(result.status, 0, `scripts/launch-check.ts --only=${id} --json must exit 0; stderr:\n${result.stderr}`);
  const lastLine = (result.stdout ?? "").trim().split("\n").pop() ?? "";
  const parsed = JSON.parse(lastLine);
  return parsed;
}

function statusOf(results, id) {
  const item = results.find((r) => r.id === id);
  assert.ok(item, `--only=${id} must include a result for ${id}`);
  return item.status;
}

/** Checkpoint 14h: this sandbox's total memory is shared with fixed
 * infrastructure processes outside this task's control (confirmed
 * directly via `ps aux --sort=-rss`: a resident Jupyter kernel, server,
 * uvicorn, s3fs mount, etc. together account for several hundred MB of
 * this container's ~985MiB before this task's own work even starts),
 * leaving real runtime-probe headroom genuinely marginal -- the SAME
 * nested launch-check.ts -> regression-suite process pair was observed
 * completing in well under 10s in most attempts and being killed by the
 * memcg OOM killer in others, with no change to this repo's code between
 * attempts. A capability whose probe was resource_blocked was NEVER
 * actually completed (see capability-manifest.ts's own definition), so
 * retrying it -- rather than either failing this test on a resource
 * fluke or silently accepting resource_blocked as if it proved
 * anything -- is the honest response: this loop keeps re-running the
 * SAME real probe until it either actually completes (ready/blocked_by_*)
 * or genuinely exhausts its attempts, at which point resource_blocked
 * really is this environment's honest answer and the test fails loudly
 * rather than masking it. */
function statusOfWithRetry(id, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    last = statusOf(runOnly(id), id);
    if (last !== "resource_blocked") return last;
    console.log(`  (attempt ${i + 1}/${attempts} for ${id} was resource_blocked -- a real environment memory limit, not a code result; retrying)`);
  }
  return last;
}

/** Sabotages `path` by replacing `find` with `replaceWith` (must match
 * EXACTLY once -- the same discipline a real Edit tool enforces, so this
 * test cannot silently no-op against a file that has since changed shape),
 * runs `during`, then restores `path` to its exact original bytes and
 * verifies the restore is byte-identical before returning. */
function sabotageRunRestore(path, find, replaceWith, during) {
  const original = readFileSync(path, "utf8");
  const occurrences = original.split(find).length - 1;
  assert.equal(occurrences, 1, `${path} must contain the sabotage target exactly once (found ${occurrences}) -- the file has drifted from what this test expects`);
  const sabotaged = original.replace(find, replaceWith);
  assert.notEqual(sabotaged, original);
  writeFileSync(path, sabotaged);
  try {
    during();
  } finally {
    writeFileSync(path, original);
    const restored = readFileSync(path, "utf8");
    assert.equal(restored, original, `${path} was not restored byte-identical after sabotage`);
  }
}

function testMalwareScanningConfigurationIsSensitiveToTheRealRegistry() {
  // Healthy baseline: a real (virustotal) adapter IS registered in
  // lib/scanning/adapter.ts's SCAN_ADAPTERS, just not selected in this
  // environment (no MALWARE_SCANNER_PROVIDER/VIRUSTOTAL_API_KEY) --
  // blocked_by_external_configuration, per this checkpoint's own
  // corrected classification.
  const before = statusOfWithRetry("malware_scanning_configuration");
  assert.equal(before, "blocked_by_external_configuration", `expected healthy baseline blocked_by_external_configuration, got ${before}`);

  sabotageRunRestore(
    "lib/scanning/adapter.ts",
    "  virustotal: virusTotalFileScanAdapter,\n",
    "",
    () => {
      // With NO real (non-null) adapter registered at all, no amount of
      // MALWARE_SCANNER_PROVIDER configuration could ever select a real
      // scanner -- this is a genuine code gap now, not a missing secret.
      const during = statusOfWithRetry("malware_scanning_configuration");
      assert.equal(during, "blocked_by_code", `sabotaging the registry to have zero real adapters must flip the status to blocked_by_code, got ${during}`);
    },
  );

  const after = statusOfWithRetry("malware_scanning_configuration");
  assert.equal(after, "blocked_by_external_configuration", `status must flip back to blocked_by_external_configuration after restore, got ${after}`);

  cases++;
  console.log("  [malware_scanning_configuration] sabotage (remove the real virustotal registry entry) flips blocked_by_external_configuration -> blocked_by_code, restore flips it back -- PROVEN sensitive to the real SCAN_ADAPTERS registry, not a static check.");
}

function testRedactionVerificationIsSensitiveToTheRealRedactionEngine() {
  // Healthy baseline: telemetry-regressions.ts (35 cases, including the
  // exact authorization-header sabotage case below) really passes live.
  const before = statusOfWithRetry("redaction_verification");
  assert.equal(before, "ready", `expected healthy baseline ready, got ${before}`);

  sabotageRunRestore(
    "lib/telemetry/redact.ts",
    '  "authorization",\n',
    "",
    () => {
      // telemetry-regressions.ts's own suite includes a dedicated
      // authorization-header-leakage case (Checkpoint 14a's own named
      // sabotage cycle) -- removing this key from the denylist must make
      // that suite fail for real, which must flip this verifier's status.
      const during = statusOfWithRetry("redaction_verification");
      assert.equal(during, "blocked_by_code", `sabotaging redact.ts's authorization-header denylist entry must flip the status to blocked_by_code, got ${during}`);
    },
  );

  const after = statusOfWithRetry("redaction_verification");
  assert.equal(after, "ready", `status must flip back to ready after restore, got ${after}`);

  cases++;
  console.log('  [redaction_verification] sabotage (remove "authorization" from redact.ts\'s key denylist) flips ready -> blocked_by_code via a REAL live spawn of telemetry-regressions.ts, restore flips it back -- PROVEN sensitive to the real redaction engine, not a citation of a past run.');
}

function testModelPromptSchemaGovernanceIsSensitiveToTheRealChokepointWiring() {
  // Checkpoint 14h: model_prompt_schema_governance is honestly
  // blocked_by_code both before and after this sabotage (a separate, real,
  // still-open gap -- staleExecutionSummary()'s worklist has no real
  // caller -- keeps it there regardless), so this is NOT an enum-level
  // ready<->blocked_by_code flip like the two tests above. What it DOES
  // prove: the check's own evidence genuinely changes to name the
  // sabotaged chokepoint specifically, rather than silently continuing to
  // report the SAME reason for a completely different underlying cause --
  // exactly the "not a superficial source-text check" property this test
  // suite exists to prove, demonstrated a different way here since this
  // capability has two independent real blockers rather than one.
  const beforeResults = runOnly("model_prompt_schema_governance");
  const beforeItem = beforeResults.find((r) => r.id === "model_prompt_schema_governance");
  assert.ok(beforeItem, "model_prompt_schema_governance must be present");
  assert.equal(beforeItem.status, "blocked_by_code", `expected healthy baseline blocked_by_code (the honest, still-open staleExecutionSummary gap), got ${beforeItem.status}`);
  assert.match(beforeItem.blockingReason, /staleExecutionSummary/, "the healthy baseline's blocking reason must name the real remaining gap (staleExecutionSummary), not the chokepoint");
  assert.doesNotMatch(beforeItem.blockingReason, /does not call assertVerifiedForMonetaryUse/, "the healthy baseline must not claim the chokepoint is unwired -- it IS wired");

  sabotageRunRestore(
    "lib/ai/llm.ts",
    "        assertVerifiedForMonetaryUse(record);\n",
    "",
    () => {
      const duringResults = runOnly("model_prompt_schema_governance");
      const duringItem = duringResults.find((r) => r.id === "model_prompt_schema_governance");
      assert.ok(duringItem, "model_prompt_schema_governance must be present");
      assert.equal(duringItem.status, "blocked_by_code", "must remain blocked_by_code (now for the more severe reason)");
      assert.match(
        duringItem.blockingReason,
        /structuredCompletion\(\) in lib\/ai\/llm\.ts does not call assertVerifiedForMonetaryUse/,
        `sabotaging structuredCompletion()'s own call to assertVerifiedForMonetaryUse() must change the blocking reason to name that specific chokepoint, got: ${duringItem.blockingReason}`,
      );
    },
  );

  const afterResults = runOnly("model_prompt_schema_governance");
  const afterItem = afterResults.find((r) => r.id === "model_prompt_schema_governance");
  assert.equal(afterItem.status, "blocked_by_code");
  assert.match(afterItem.blockingReason, /staleExecutionSummary/, "after restore, the blocking reason must revert to naming the real remaining gap, not the chokepoint");
  assert.doesNotMatch(afterItem.blockingReason, /does not call assertVerifiedForMonetaryUse/, "after restore, the chokepoint-specific reason must be gone");

  cases++;
  console.log("  [model_prompt_schema_governance] sabotage (remove structuredCompletion()'s own assertVerifiedForMonetaryUse() call) changes the REPORTED BLOCKING REASON from the real remaining staleness-worklist gap to the specific unwired chokepoint, and restore reverts it -- PROVEN sensitive to the real chokepoint wiring via region-scoped source inspection, not a whole-file guess (status stays honestly blocked_by_code throughout, since a second, independent, real gap keeps it there either way).");
}

function testHardcodedVerifiersCanNoLongerExistUndetected() {
  // A structural guard against regression: every one of this checkpoint's
  // 6 previously-hardcoded functions must, at minimum, reference
  // existsSync/readFileSync/runRegressionSuite/spawnSync/extractFunctionRegion
  // somewhere in their own source -- a purely static `report(id, status,
  // "fixed string")` function body (no real fs/child_process call at all)
  // is exactly the shape this checkpoint eliminated and must not silently
  // reappear.
  const src = readFileSync("scripts/launch-check.ts", "utf8");
  const targets = [
    "checkBackgroundJobReliability",
    "checkDeadLetterRetrySupport",
    "checkPrivacySafeObservability",
    "checkRedactionVerification",
    "checkModelPromptSchemaGovernance",
    "checkFullHouseholdE2eJourney",
  ];
  for (const name of targets) {
    const re = new RegExp(`function ${name}\\(\\) \\{`);
    const m = re.exec(src);
    assert.ok(m, `${name} must still exist in scripts/launch-check.ts`);
    // Grab a generous window after the declaration (every one of these
    // functions is well under 6000 chars) rather than doing full brace
    // matching again here -- this is a cheap regression guard, not the
    // check itself.
    const window = src.slice(m.index, m.index + 6000);
    const hasRealInspection = /existsSync\(|readFileSync\(|runRegressionSuite\(|spawnSync\(|extractFunctionRegion\(/.test(window);
    assert.ok(hasRealInspection, `${name} no longer contains any real fs/child_process/region-inspection call -- it may have regressed back to a static report()`);
  }
  cases++;
  console.log("  [structural guard] all 6 previously-hardcoded verifiers still contain a real dynamic-inspection call in their own source -- none has silently regressed back to a static report().");
}

function main() {
  testMalwareScanningConfigurationIsSensitiveToTheRealRegistry();
  testRedactionVerificationIsSensitiveToTheRealRedactionEngine();
  testModelPromptSchemaGovernanceIsSensitiveToTheRealChokepointWiring();
  testHardcodedVerifiersCanNoLongerExistUndetected();

  console.log(
    `\nlaunch-check verifier regressions passed: ${cases} cases (3 real sabotage-and-restore cycles against the VERIFIER ITSELF -- ` +
      "malware_scanning_configuration and redaction_verification each proven to flip STATUS under a real production-file sabotage and flip " +
      "back after an exact byte-restore, model_prompt_schema_governance proven to change its reported BLOCKING REASON to name the specific " +
      "sabotaged chokepoint and revert after restore -- plus a structural guard confirming none of the 6 previously-hardcoded verifiers has " +
      "silently regressed back to a static report() call).",
  );
}

main();
