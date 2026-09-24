#!/usr/bin/env node
/**
 * Checkpoint 14g (claude/v1-launch-hardening): the ONE orchestration
 * command for the full 9-stage, multi-process, authenticated household
 * E2E journey (auth/household setup -> policy upload/quarantine ->
 * chat/claim flow -> evidence/review/calculation -> export -> evidence
 * deletion+invalidation -> policy deletion+invalidation -> membership
 * removal -> household deletion+cleanup).
 *
 * Why a separate process per stage, against a SHARED persisted fixture:
 * scripts/full-household-e2e-regressions.ts's own header already
 * documents that this sandbox's ~985MiB ceiling cannot run this whole
 * journey -- including deletion steps -- in ONE process alongside
 * lib/lifecycle/coordinator.ts's memory-heavy module graph without
 * risking OOM; every stage script in scripts/e2e/stages/*.ts exits
 * (releasing the OS all of its memory) before the next one starts, and
 * all 9 share ONE on-disk PGlite data directory
 * (scripts/e2e/shared.ts's fixtureDir()/pgDataDir()) plus a small JSON
 * handoff file carrying only the specific row ids each next stage needs
 * to look up in that real, persisted database -- see scripts/e2e/
 * shared.ts's own header for the full design rationale.
 *
 * Deliberately PLAIN JavaScript (.mjs), not TypeScript-via-tsx, and
 * deliberately unusual for this repo's otherwise-uniform "node --import
 * tsx scripts/x.ts" script convention: a first version of this file WAS
 * a .ts file run the normal way, and its own tsx-loaded parent process
 * (kept alive the whole run, since spawnSync blocks synchronously) was
 * enough EXTRA co-resident memory, on top of whatever a child stage
 * process itself peaks at (~350-420MB RSS, observed across every stage),
 * to reliably OOM-kill stage 1 in this sandbox's tight ~400MB headroom --
 * confirmed by a real orchestrated run that failed at exactly that point
 * where every earlier STANDALONE run of the same stage script had always
 * passed. This file has zero repo-specific imports (only Node built-ins),
 * so it needs no path-alias resolution or transform -- running it as
 * plain ESM keeps the orchestrator's own resident footprint to bare
 * Node's baseline (tens of MB, not 70-110MB+) for the whole run.
 *
 * Each CHILD stage is spawned via the exact underlying command tsx's own
 * CLI wrapper uses (`node --require tsx/dist/preflight.cjs --import
 * tsx/dist/loader.mjs <script>`) rather than through node_modules/.bin/tsx
 * itself, which is a wrapper that spawns ITS OWN nested child process --
 * calling the underlying command directly removes that whole extra
 * process (and its RSS) from every one of the 9 stages.
 *
 * Runs scripts/e2e/stages/01..09-*.ts IN ORDER, each as its own child
 * process sharing E2E_FIXTURE_DIR, DEV_AUTH_ENABLED and a bounded
 * NODE_OPTIONS heap cap. Stops and reports FAILURE on the FIRST stage
 * that exits nonzero -- later stages never run against a fixture a prior
 * stage left in an unknown state. The fixture directory is always
 * removed at the end (success OR failure) EXCEPT that a failing stage's
 * full stdout/stderr is always printed in full BEFORE cleanup runs, so a
 * failure is never silently discarded.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const TSX_PREFLIGHT = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "preflight.cjs");
const TSX_LOADER = "file://" + path.join(REPO_ROOT, "node_modules", "tsx", "dist", "loader.mjs");

const STAGES = [
  "01-auth-household-setup",
  "02-policy-upload-quarantine",
  "03-chat-claim-flow",
  "04-evidence-review-calculation",
  "05-export",
  "06-evidence-deletion-invalidation",
  "07-policy-deletion-invalidation",
  "08-membership-removal",
  "09-household-deletion-cleanup",
];

function memorySnapshot() {
  const totalMB = (os.totalmem() / 1024 / 1024).toFixed(0);
  const freeMB = (os.freemem() / 1024 / 1024).toFixed(0);
  return `total=${totalMB}MB free=${freeMB}MB`;
}

function main() {
  // Real disk, not /tmp -- this sandbox's /tmp is tmpfs (RAM-backed), which
  // would defeat the entire point of testing that memory is released to
  // the OS across a real process boundary (see scripts/e2e/shared.ts's
  // header). REPO_ROOT's own filesystem (/home/user/... in this sandbox)
  // is backed by real disk.
  const fixtureParent = path.join(REPO_ROOT, ".e2e-fixtures");
  mkdirSync(fixtureParent, { recursive: true });
  const fixtureDir = mkdtempSync(path.join(fixtureParent, "run-"));

  console.log(`\n########################################################`);
  console.log(`# Checkpoint 14g: full 9-stage authenticated E2E journey`);
  console.log(`# fixture dir: ${fixtureDir}`);
  console.log(`# memory before stage 1: ${memorySnapshot()}`);
  console.log(`########################################################\n`);

  let failedStage = null;

  for (const stage of STAGES) {
    const before = memorySnapshot();
    const startedAt = Date.now();
    const result = spawnSync(
      process.execPath,
      ["--require", TSX_PREFLIGHT, "--import", TSX_LOADER, path.join(REPO_ROOT, "scripts", "e2e", "stages", `${stage}.ts`)],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          DEV_AUTH_ENABLED: "1",
          E2E_FIXTURE_DIR: fixtureDir,
          NODE_OPTIONS: "--max-old-space-size=700",
        },
        encoding: "utf8",
        // 90s per stage: generous relative to every stage's typical
        // few-second duration. An earlier version of this mock made
        // stage 3's real async chat-job dispatch trigger several full
        // 8-attempt exponential-backoff retry sequences (up to ~182s
        // EACH) against lib/ai/providers.ts's withRetries() -- see
        // scripts/e2e/stages/03-chat-claim-flow.ts's mockAnthropicFetch()
        // comment for the real fix (400, not 500/429, for the
        // deliberately-failing calls) -- so this no longer needs to be
        // minutes long.
        timeout: 90_000,
      },
    );
    const durationMs = Date.now() - startedAt;
    const after = memorySnapshot();
    const combinedOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    console.log(`\n--- stage ${stage} ---`);
    console.log(`  memory before: ${before}`);
    console.log(`  memory after:  ${after}`);
    console.log(`  duration: ${durationMs}ms, exit code: ${result.status}, signal: ${result.signal ?? "none"}`);
    console.log(combinedOutput.split("\n").map((l) => `  | ${l}`).join("\n"));

    if (result.status !== 0 || result.signal) {
      failedStage = stage;
      break;
    }
  }

  console.log(`\n########################################################`);
  if (failedStage) {
    console.log(`# FAILURE at stage ${failedStage}`);
    console.log(`# memory at failure: ${memorySnapshot()}`);
    console.log(`########################################################\n`);
  } else {
    console.log(`# SUCCESS: all ${STAGES.length} stages passed against the same persisted fixture`);
    console.log(`# memory after stage 9: ${memorySnapshot()}`);
    console.log(`########################################################\n`);
  }

  if (existsSync(fixtureDir)) {
    rmSync(fixtureDir, { recursive: true, force: true });
    console.log(`Cleaned up fixture dir: ${fixtureDir}`);
  }

  process.exitCode = failedStage ? 1 : 0;
}

main();
