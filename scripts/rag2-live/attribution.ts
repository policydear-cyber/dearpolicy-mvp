/**
 * Which app ledger rows (model_executions) belong to a harness turn, and how they reconcile with the guard's calls.
 *
 * Round 6 found the app's rows for a turn summing to MORE than the guard charged (RUN-r6-L3-L5-plus-paraphrases,
 * conv-L5: guard US$0.000754, rows US$0.000983). Cause: run.ts selected the household's rows from 1 s BEFORE the turn's
 * POST, so the previous turn's last loop call (written ~1 s earlier: conv-L4 turn 1, guard seq 19, 9 205 in / 8 426
 * cached / 134 out = US$0.000229) was counted again in the next turn. No price or cached-token error: every other row
 * equals its guard call to the token. The rows are now taken from the POST onwards and each row id at most once, and
 * each row is joined to its guard call by the provider request id where both have one.
 */
export type ExecRow = { id?: string; provider_request_id?: string | null; created_at: string | Date; cost_usd?: number | null; input_tokens?: number; output_tokens?: number; cached_tokens?: number; attempt_index?: number; operation?: string };
export type GuardCall = { seq: number; providerRequestId?: string | null; chargedUsd?: number; usage?: { input: number; output: number; cached: number } | null; refused?: string };

/** The rows of a turn: created at or after the turn's POST (never before it), each row once across the run. */
export function turnExecutions<T extends ExecRow>(rows: T[], sinceMs: number, seen: Set<string>): T[] {
  const out: T[] = [];
  for (const r of rows) {
    if (new Date(r.created_at).getTime() < sinceMs) continue;
    const key = r.id ?? `${new Date(r.created_at).toISOString()}|${r.attempt_index}|${r.input_tokens}|${r.output_tokens}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push(r);
  }
  return out;
}

/** Pairs rows with guard calls: by provider request id first, then (rows without one) by identical token counts. */
export function reconcile(calls: GuardCall[], rows: ExecRow[]) {
  const sent = calls.filter((c) => !c.refused);
  const free = new Set(sent.map((c) => c.seq));
  const pairs: { seq: number; row: ExecRow; by: "request_id" | "tokens" }[] = [];
  const left: ExecRow[] = [];
  for (const r of rows) {
    let c = r.provider_request_id ? sent.find((x) => free.has(x.seq) && x.providerRequestId === r.provider_request_id) : undefined;
    let by: "request_id" | "tokens" = "request_id";
    if (!c) { by = "tokens"; c = sent.find((x) => free.has(x.seq) && x.usage && x.usage.input === (r.input_tokens ?? -1) && x.usage.output === (r.output_tokens ?? -1) && x.usage.cached === (r.cached_tokens ?? 0)); }
    if (c) { free.delete(c.seq); pairs.push({ seq: c.seq, row: r, by }); } else left.push(r);
  }
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return {
    pairs: pairs.map((p) => ({ seq: p.seq, by: p.by, rowCostUsd: p.row.cost_usd ?? null, guardUsd: sent.find((c) => c.seq === p.seq)?.chargedUsd ?? null })),
    rowsWithoutCall: left, callsWithoutRow: sent.filter((c) => free.has(c.seq)).map((c) => c.seq),
    guardUsd: sum(sent.map((c) => c.chargedUsd ?? 0)), rowsUsd: sum(rows.map((r) => r.cost_usd ?? 0)),
  };
}
