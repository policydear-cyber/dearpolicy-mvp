/**
 * scripts/trial/start.sh refuses an unsafe environment BEFORE anything else runs (npm run trial:start-isolation-test).
 * The real start.sh runs in a copy of its directory layout with every external command it uses next (psql,
 * pg_isready, pg_ctlcluster, sudo, service, npm, npx, curl, git) replaced by a stub that only records that it ran.
 * No database, network or build is involved.
 *   S1  a remote TRIAL_DATABASE_URL is refused, and NOT ONE of those commands ran (nothing could connect).
 *   S2  the same for a pre-set remote DATABASE_URL, a remote PGHOST, a host override in the query string, Supabase
 *       storage, a production Supabase key, and outside a Codespace.
 *   S3  budget: no open trial allocation, a damaged .trial/ledger.json, another Codespace's record, a used-up allowance:
 *       refused before setup; the damaged record is left untouched.
 *   S4  control: with a local database, an open allocation and no record, the checks pass and setup starts
 *       (the first database command runs) -- so the refusals above are the checks, not a broken script.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const STUBS = ["psql", "pg_isready", "pg_ctlcluster", "sudo", "service", "npm", "npx", "curl", "git", "createdb"];
const OPEN = { run_id: "trial-codespace-1", kind: "trial_allocation", status: "open", tested_code_sha: "", request_sha: "", at: "x", preflight: false, run_cap_usd: 0.15, spent_usd: 0, reserved_unsettled_usd: 0.15, calls: 0, refused: 0, failed: 0 };
const EARLIER = { run_id: "ingest-live-5b", tested_code_sha: "a", request_sha: "b", at: "x", preflight: false, run_cap_usd: 0.08, spent_usd: 0.161222, reserved_unsettled_usd: 0, calls: 1, refused: 0, failed: 0 };

function sandbox(opts: { runs?: object[]; local?: string | null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trial-start-"));
  fs.mkdirSync(path.join(root, "scripts/trial"), { recursive: true });
  for (const f of ["start.sh", "isolation.mjs"]) fs.copyFileSync(path.join(REPO, "scripts/trial", f), path.join(root, "scripts/trial", f));
  fs.mkdirSync(path.join(root, "docs/rag-migration/live"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/rag-migration/live/LEDGER.json"), JSON.stringify({ exercise_cap_usd: 0.5, runs: opts.runs ?? [EARLIER, OPEN] }));
  if (opts.local != null) { fs.mkdirSync(path.join(root, ".trial"), { recursive: true }); fs.writeFileSync(path.join(root, ".trial/ledger.json"), opts.local); }
  const bin = path.join(root, "stub-bin"), marks = path.join(root, "ran");
  fs.mkdirSync(bin); fs.mkdirSync(marks);
  for (const c of STUBS) fs.writeFileSync(path.join(bin, c), `#!/bin/sh\necho "$0 $*" >> "${marks}/${c}"\nexit 1\n`, { mode: 0o755 });
  return { root, marks };
}
function run(box: { root: string; marks: string }, env: Record<string, string>) {
  const r = spawnSync("bash", [path.join(box.root, "scripts/trial/start.sh")], {
    encoding: "utf8", timeout: 30000,
    env: { PATH: `${path.join(box.root, "stub-bin")}:${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: box.root, CODESPACES: "true", CODESPACE_NAME: "silver-train-x7", ...env } as unknown as NodeJS.ProcessEnv,
  });
  return { code: r.status, err: r.stderr, out: r.stdout, ran: fs.readdirSync(box.marks) };
}
const refusedBeforeSetup = (env: Record<string, string>, why: RegExp, box = sandbox()) => {
  const r = run(box, env);
  assert.notEqual(r.code, 0, "refused"); assert.match(r.err, /\[trial\] refused/); assert.match(r.err, why);
  assert.deepEqual(r.ran, [], `no setup command may run before the checks (ran: ${r.ran.join(", ")})`);
  return box;
};

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log("PASS " + name); };
t("S1 a remote TRIAL_DATABASE_URL is refused before any database command, db:setup, build or server", () => {
  refusedBeforeSetup({ TRIAL_DATABASE_URL: "postgres://postgres:secret@db.abcdefghij.supabase.co:5432/postgres" }, /TRIAL_DATABASE_URL points at "db\.abcdefghij\.supabase\.co"/);
  refusedBeforeSetup({ TRIAL_DATABASE_URL: "postgresql://u:p@10.0.0.5/dearpolicy_trial" }, /must be local/);
});
t("S2 other ways out are refused at the same boundary: DATABASE_URL, PGHOST, a host override, storage, Supabase, not a Codespace", () => {
  refusedBeforeSetup({ DATABASE_URL: "postgres://u:p@prod.example.com:5432/app" }, /DATABASE_URL points at/);
  refusedBeforeSetup({ PGHOST: "prod.example.com" }, /PGHOST/);
  refusedBeforeSetup({ TRIAL_DATABASE_URL: "postgres://postgres:postgres@localhost:5432/dearpolicy_trial?host=prod.example.com" }, /overrides the host/);
  refusedBeforeSetup({ TRIAL_DATABASE_URL: "postgres://postgres:postgres@localhost:5432/x;drop" }, /plain database/);
  refusedBeforeSetup({ STORAGE_DRIVER: "supabase" }, /STORAGE_DRIVER/);
  refusedBeforeSetup({ SUPABASE_SERVICE_ROLE_KEY: "not-a-real-key" }, /SUPABASE_SERVICE_ROLE_KEY/);
  refusedBeforeSetup({ CODESPACES: "" }, /GitHub Codespace/);
  refusedBeforeSetup({ CODESPACE_NAME: "" }, /CODESPACE_NAME/);
});
t("S3 budget: no open allocation, a damaged or foreign local record, a used-up allowance -- refused before setup", () => {
  refusedBeforeSetup({}, /no open trial allocation/, sandbox({ runs: [EARLIER, { ...OPEN, status: "closed", spent_usd: 0.03, reserved_unsettled_usd: 0 }] }));
  refusedBeforeSetup({}, /more than one open/, sandbox({ runs: [EARLIER, OPEN, { ...OPEN, run_id: "trial-codespace-2" }] }));
  const damaged = "{\"capUsd\": 0.15, \"spentUsd\": 0.0";
  const box = refusedBeforeSetup({}, /not valid JSON/, sandbox({ local: damaged }));
  assert.equal(fs.readFileSync(path.join(box.root, ".trial/ledger.json"), "utf8"), damaged, "the damaged record is not reset");
  const rec = { capUsd: 0.15, spentUsd: 0.02, inflightUsd: 0, startedAt: "x", allocationId: "trial-codespace-1", codespace: "silver-train-x7" };
  refusedBeforeSetup({}, /incomplete or damaged/, sandbox({ local: JSON.stringify({ ...rec, spentUsd: undefined }) }));
  refusedBeforeSetup({}, /belongs to Codespace "another-one"/, sandbox({ local: JSON.stringify({ ...rec, codespace: "another-one" }) }));
  refusedBeforeSetup({}, /belongs to allocation/, sandbox({ local: JSON.stringify({ ...rec, allocationId: "trial-codespace-0" }) }));
  refusedBeforeSetup({}, /used up/, sandbox({ local: JSON.stringify({ ...rec, spentUsd: 0.149, inflightUsd: 0.002 }) }));
});
t("S4 control: a local database, the open allocation and this Codespace's own record pass the checks, and setup starts", () => {
  for (const local of [null, JSON.stringify({ capUsd: 0.15, spentUsd: 0.02, inflightUsd: 0, startedAt: "x", allocationId: "trial-codespace-1", codespace: "silver-train-x7" })]) {
    const r = run(sandbox({ local }), { TRIAL_DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/dearpolicy_trial" });
    assert.doesNotMatch(r.err, /refused/, r.err);
    assert.ok(r.ran.includes("pg_isready"), `the first database command runs after the checks (ran: ${r.ran.join(", ")}; ${r.err.slice(0, 300)})`);
  }
});
console.log(`trial start isolation regressions ${n}/${n} passed`);
