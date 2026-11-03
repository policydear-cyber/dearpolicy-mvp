/**
 * The rebuilt run record (scripts/rag2-live/reconstruct-run-record.ts) is written only when every figure reproduces the
 * ledger exactly, and always says it was rebuilt. Made-up responses plus the committed fx-live-2 record. No network.
 *   npm run -s rag2:live-reconstruct-test
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { reconstructRunRecord, type LedgerEntry } from "./reconstruct-run-record";
import { foundRuns, reconcileRuns, validateLedger } from "./ledger";

let passed = 0, failed = 0;
function t(name: string, fn: () => void) { try { fn(); passed++; console.log("PASS " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n     " + String((e as Error).message)); } }

const resp = (input: number, output: number, cached = 0, status = 200) => JSON.stringify({ key: "x", status, response: JSON.stringify({ model: "gpt-6-luna", usage: { prompt_tokens: input, completion_tokens: output, prompt_tokens_details: { cached_tokens: cached } } }) });
// gpt-6-luna: input 0.10, cached 0.01, output 0.50 per million tokens.
const jsonl = [resp(1_000_000, 0), resp(0, 1_000_000, 0), resp(1_000_000, 0, 1_000_000)].join("\n");
const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({ run_id: "made-up-1", tested_code_sha: "abc1234", preflight: false, spent_usd: 0.7, reserved_unsettled_usd: 0, calls: 3, refused: 0, failed: 0, ...over });
const opts = { model: "gpt-6-luna", folder: "docs/x/RUN-made-up-1", at: "2026-11-03" };

t("R1 figures reproduced from usage: upper bound without the cached discount, estimate with it", () => {
  const r = reconstructRunRecord(entry(), jsonl, opts);
  assert.equal(r.budgetUsed.spentUsd, 0.7); assert.equal(r.budgetUsed.calls, 3); assert.equal(r.estimatedCostUsd, 0.61);
});
t("R2 the record always says it was rebuilt, from what and when", () => {
  const r = reconstructRunRecord(entry(), jsonl, opts);
  assert.equal(r.reconstructed, true); assert.deepEqual(r.reconstructedFrom, ["docs/rag-migration/live/LEDGER.json", "docs/x/RUN-made-up-1/responses.jsonl"]);
  assert.equal(r.reconstructedAt, "2026-11-03"); assert.match(r.note, /REBUILT after the run/);
});
t("R3 refuses when the call count differs from the ledger", () => assert.throws(() => reconstructRunRecord(entry({ calls: 4 }), jsonl, opts), /3 answered calls; the ledger books 4/));
t("R4 refuses when the cost differs from the ledger by even a millionth", () => assert.throws(() => reconstructRunRecord(entry({ spent_usd: 0.700001 }), jsonl, opts), /refusing to write/));
t("R5 refuses a failed-call count that differs, a response without usage, another model, or an open reservation", () => {
  assert.throws(() => reconstructRunRecord(entry(), jsonl + "\n" + resp(1, 1, 0, 500), opts), /1 failed calls; the ledger books 0/);
  assert.throws(() => reconstructRunRecord(entry(), JSON.stringify({ status: 200, response: JSON.stringify({ model: "gpt-6-luna" }) }), opts), /no usage/);
  assert.throws(() => reconstructRunRecord(entry(), JSON.stringify({ status: 200, response: JSON.stringify({ model: "gpt-5-mini", usage: { prompt_tokens: 1, completion_tokens: 1 } }) }), opts), /not gpt-6-luna/);
  assert.throws(() => reconstructRunRecord(entry({ reserved_unsettled_usd: 0.01 }), jsonl, opts), /unsettled reservation/);
});
t("R6 the committed fx-live-2 record is the rebuild of its own responses, and matches the ledger", () => {
  const dir = "docs/rag-migration/live/RUN-fx-live-2-2026-10-20T02-39-03";
  const ledger = JSON.parse(fs.readFileSync("docs/rag-migration/live/LEDGER.json", "utf8")) as { runs: LedgerEntry[] };
  const committed = JSON.parse(fs.readFileSync(dir + "/run.json", "utf8"));
  const rebuilt = reconstructRunRecord(ledger.runs.find((r) => r.run_id === "fx-live-2")!, fs.readFileSync(dir + "/responses.jsonl", "utf8"), { model: "gpt-6-luna", folder: dir, at: committed.reconstructedAt });
  assert.deepEqual(committed, rebuilt);
});
t("R7 the reconciliation still reports a run folder with no run.json as unreadable (L10 keeps its purpose)", () => {
  const tmp = fs.mkdtempSync("/tmp/recon-");
  fs.mkdirSync(tmp + "/RUN-made-up-1-2026-11-03T00-00-00");
  const l = validateLedger(JSON.parse(fs.readFileSync("docs/rag-migration/live/LEDGER.json", "utf8")));
  assert.deepEqual(reconcileRuns(l, foundRuns([tmp])).unreadable, ["made-up-1"]);
  fs.rmSync(tmp, { recursive: true, force: true });
});
console.log(`\nreconstruct-run-record regressions ${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
