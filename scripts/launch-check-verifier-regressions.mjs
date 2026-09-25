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
  // Checkpoint 14i closed the last honest gap this capability had (lib/ai/
  // staleness-alert.ts is now a real caller of staleExecutionSummary()'s
  // worklist), so the healthy baseline is genuinely "ready" -- both
  // governed chokepoints call assertVerifiedForMonetaryUse() AND the
  // staleness worklist has a real caller. This is now an enum-level
  // ready<->blocked_by_code flip, the same shape as the two tests above:
  // sabotage one governed chokepoint's own call to
  // assertVerifiedForMonetaryUse() and the status must flip to
  // blocked_by_code, naming that specific chokepoint (not a stale/generic
  // reason); restoring the exact byte content must flip it back to ready.
  const beforeResults = runOnly("model_prompt_schema_governance");
  const beforeItem = beforeResults.find((r) => r.id === "model_prompt_schema_governance");
  assert.ok(beforeItem, "model_prompt_schema_governance must be present");
  assert.equal(beforeItem.status, "ready", `expected healthy baseline ready (both chokepoints wired AND staleExecutionSummary() has a real caller as of Checkpoint 14i), got ${beforeItem.status}`);

  sabotageRunRestore(
    "lib/ai/llm.ts",
    "        assertVerifiedForMonetaryUse(record);\n",
    "",
    () => {
      const duringResults = runOnly("model_prompt_schema_governance");
      const duringItem = duringResults.find((r) => r.id === "model_prompt_schema_governance");
      assert.ok(duringItem, "model_prompt_schema_governance must be present");
      assert.equal(duringItem.status, "blocked_by_code", `sabotaging structuredCompletion()'s own call to assertVerifiedForMonetaryUse() must flip the status to blocked_by_code, got ${duringItem.status}`);
      assert.match(
        duringItem.blockingReason,
        /structuredCompletion\(\) in lib\/ai\/llm\.ts does not call assertVerifiedForMonetaryUse/,
        `sabotaging structuredCompletion()'s own call to assertVerifiedForMonetaryUse() must change the blocking reason to name that specific chokepoint, got: ${duringItem.blockingReason}`,
      );
    },
  );

  const afterResults = runOnly("model_prompt_schema_governance");
  const afterItem = afterResults.find((r) => r.id === "model_prompt_schema_governance");
  assert.equal(afterItem.status, "ready", `status must flip back to ready after restore, got ${afterItem.status}`);

  cases++;
  console.log("  [model_prompt_schema_governance] sabotage (remove structuredCompletion()'s own assertVerifiedForMonetaryUse() call) flips ready -> blocked_by_code naming that specific chokepoint, restore flips it back to ready -- PROVEN sensitive to the real chokepoint wiring via region-scoped source inspection, not a whole-file guess or a stale hardcoded baseline.");
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

function testInfrastructureTableProtectionIsSensitiveToTheRealMigrations() {
  // Healthy baseline: every table classified, sql/infrastructure-rls.sql
  // enforces the inventory, nothing opens an infrastructure table to a
  // browser role, and the permissions suite is wired into CI.
  const before = statusOf(runOnly("infrastructure_table_protection"), "infrastructure_table_protection");
  assert.equal(before, "ready", `expected healthy baseline ready, got ${before}`);
  const sabotages = [
    ["a new, unclassified table", "sql/rate-limit.sql", "CREATE TABLE IF NOT EXISTS rate_limit_buckets (", "CREATE TABLE IF NOT EXISTS unclassified_probe (id int);\nCREATE TABLE IF NOT EXISTS rate_limit_buckets (", /unclassified table/],
    ["RLS no longer enabled", "sql/infrastructure-rls.sql", "    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);\n", "", /enable RLS/],
    ["the authenticated revoke removed", "sql/infrastructure-rls.sql", "      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);\n", "", /revoke table privileges from authenticated/],
    ["a permissive authenticated policy added", "sql/background-jobs.sql", "CREATE TABLE IF NOT EXISTS background_jobs (", "CREATE POLICY probe_open ON public.background_jobs FOR SELECT TO authenticated USING (true);\nCREATE TABLE IF NOT EXISTS background_jobs (", /permissive policy probe_open/],
    ["the CI step removed", ".github/workflows/ci.yml", "        run: npm run security:infrastructure-tables-test\n", "", /CI does not run npm run security:infrastructure-tables-test/],
  ];
  for (const [label, file, find, replaceWith, reason] of sabotages) {
    sabotageRunRestore(file, find, replaceWith, () => {
      const item = runOnly("infrastructure_table_protection").find((r) => r.id === "infrastructure_table_protection");
      assert.equal(item.status, "blocked_by_code", `${label} must flip infrastructure_table_protection to blocked_by_code, got ${item.status}`);
      assert.match(item.blockingReason, reason, `${label} must be named in the blocking reason, got: ${item.blockingReason}`);
    });
    console.log(`  [infrastructure_table_protection] sabotage (${label}) -> blocked_by_code naming it; restored.`);
  }
  const after = statusOf(runOnly("infrastructure_table_protection"), "infrastructure_table_protection");
  assert.equal(after, "ready", `status must flip back to ready after every restore, got ${after}`);
  cases++;
}

function main() {
  testMalwareScanningConfigurationIsSensitiveToTheRealRegistry();
  testRedactionVerificationIsSensitiveToTheRealRedactionEngine();
  testModelPromptSchemaGovernanceIsSensitiveToTheRealChokepointWiring();
  testInfrastructureTableProtectionIsSensitiveToTheRealMigrations();
  testHardcodedVerifiersCanNoLongerExistUndetected();

  console.log(
    `\nlaunch-check verifier regressions passed: ${cases} cases (real sabotage-and-restore cycles against the VERIFIER ITSELF -- infrastructure_table_protection (5 sabotages), ` +
      "malware_scanning_configuration, redaction_verification, and model_prompt_schema_governance each proven to flip STATUS under a real " +
      "production-file sabotage (the last also proven to name the specific sabotaged chokepoint in its blocking reason) and flip back after " +
      "an exact byte-restore -- plus a structural guard confirming none of the 6 previously-hardcoded verifiers has silently regressed back " +
      "to a static report() call).",
  );
}

main();
