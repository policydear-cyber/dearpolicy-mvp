/**
 * Round-6 accounting discrepancy (RUN-r6-L3-L5-plus-paraphrases-*, conv-L5): the guard charged US$0.000754 but the
 * app's model_executions rows summed to US$0.000983. Replays the recorded rows: the old 1 s look-back reproduces the
 * US$0.000983 exactly (the extra row is conv-L4's last call); turnExecutions() gives US$0.000754, and every remaining
 * row pairs with a guard call token for token, at the same price.
 *   node --import tsx scripts/rag2-live/attribution-regressions.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { costUsd } from "@/lib/ai/providers";
import { reconcile, turnExecutions } from "./attribution";

const base = "docs/rag-migration/live";
const dir = fs.readdirSync(base).find((d) => d.startsWith("RUN-r6-L3-L5-plus-paraphrases-"));
assert.ok(dir, "the round-6 run folder is in the repository");
const conv = (id: string) => JSON.parse(fs.readFileSync(path.join(base, dir!, `conv-${id}.json`), "utf8"));
const L4 = conv("L4").turns[0], L5 = conv("L5").turns[0];
const round = (x: number) => Math.round(x * 1e6) / 1e6;

assert.equal(round(L5.costUsd.charged), 0.000754);
assert.equal(round(L5.costUsd.ledger), 0.000983, "the recorded discrepancy");
// The extra row is conv-L4's last call: written before conv-L5's first request, inside the old 1 s look-back.
const extra = L5.modelExecutions[0];
const l4Last = L4.httpCalls[L4.httpCalls.length - 1];
assert.deepEqual([extra.input_tokens, extra.output_tokens, extra.cached_tokens], [l4Last.usage.input, l4Last.usage.output, l4Last.usage.cached]);
assert.ok(new Date(extra.created_at) < new Date(L5.httpCalls[0].at), "written before conv-L5's first call");
assert.equal(round(extra.cost_usd), round(l4Last.chargedUsd), "same call, same price: counted twice, not mispriced");
// Cached tokens are priced at the cached rate in both ledgers (no full-rate pricing anywhere).
for (const c of [...L4.httpCalls, ...L5.httpCalls]) assert.equal(round(costUsd({ provider: "openai", model: "gpt-6-luna" }, c.usage)!), round(c.chargedUsd));

// The turn's POST happened after conv-L4's last row and before conv-L5's first call; the old query reached 1 s back.
const t0 = new Date(L5.httpCalls[0].at).getTime() - 600;
const oldWindow = L5.modelExecutions.filter((r: any) => new Date(r.created_at).getTime() >= t0 - 1000);
assert.equal(round(oldWindow.reduce((n: number, r: any) => n + r.cost_usd, 0)), 0.000983, "old window reproduces it");
const rows = turnExecutions(L5.modelExecutions, t0, new Set());
assert.equal(rows.length, 4);
const rec = reconcile(L5.httpCalls, rows);
assert.equal(rec.rowsWithoutCall.length, 0);
assert.equal(rec.callsWithoutRow.length, 0);
assert.equal(round(rec.rowsUsd), round(rec.guardUsd));
assert.equal(round(rec.guardUsd), 0.000754);

// Even with an overlapping window, a row already attributed to the previous turn is never counted again.
const seen = new Set<string>();
turnExecutions(L4.modelExecutions.concat([extra]), 0, seen);
assert.equal(turnExecutions(L5.modelExecutions, 0, seen).length, 4);
// Joined by provider request id when both sides carry one.
const byId = reconcile([{ seq: 1, providerRequestId: "chatcmpl-a", chargedUsd: 0.001, usage: { input: 1, output: 1, cached: 0 } }], [{ provider_request_id: "chatcmpl-a", created_at: new Date().toISOString(), cost_usd: 0.001, input_tokens: 9, output_tokens: 9 }]);
assert.equal(byId.pairs[0].by, "request_id");
console.log("rag2-live accounting attribution regressions passed (conv-L5 US$0.000983 -> US$0.000754 = guard; cause: previous turn's last call inside the 1 s look-back).");
