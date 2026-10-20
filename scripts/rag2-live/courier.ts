/**
 * Courier: carries recorded model requests from this sandbox (which cannot reach the model provider) to the Composio workbench
 * (which can, through the existing dedicated `openai` connection, scripts/rag2-live/relay.py's route) and carries the
 * responses back -- by hand, one round at a time -- WITHOUT any model call timing out and without the credential ever being
 * here. The run is made repeatable by RECORD / REPLAY:
 *
 *   - Every model request the application makes is keyed (conversation tag, ordinal) and fingerprinted (sha256 of the exact
 *     request body). If a response for that key has been applied, it is replayed; otherwise the request is written to
 *     requests.jsonl, the call fails at once (HTTP 401, not retried by the meter) and the run stops that conversation.
 *   - `prep` turns the pending requests into one compact payload (a line-level delta against a body the workbench already has);
 *     the workbench function (courier_workbench.py) rebuilds each body, checks its sha256, enforces the model / cap, calls the
 *     model and prints one response line each; `apply` verifies each line's sha256 and appends it to responses.jsonl.
 *   - The whole run is then repeated from the start (fresh database, same recorded responses) until nothing is pending. A request
 *     that differs from the one recorded for its key is a DIVERGENCE: the run is invalid and says so. No response is ever
 *     fetched twice for one key, so replaying costs nothing and re-samples nothing.
 *
 * Nothing here decides whether a result is good; it only moves bytes and keeps every request and response (requests.jsonl,
 * responses.jsonl, sent.jsonl are append-only).
 *   node --import tsx scripts/rag2-live/courier.ts prep  <dir> [--cap 0.25]   # prints the payload for the workbench
 *   node --import tsx scripts/rag2-live/courier.ts apply <dir> < lines.jsonl   # verifies and records the workbench's response lines
 *   node --import tsx scripts/rag2-live/courier.ts status <dir>
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
export const PRICE = { input: 0.10, output: 0.50 }; // US$ per million tokens, gpt-6-luna on file (lib/ai/providers.ts PRICES); cached input is NOT discounted here (conservative)

export type Req = { key: string; tag: string; ord: number; req_sha: string; request: string; reserve_usd: number; model: string; arm: string; at: string };
export type Resp = { key: string; req_sha: string; status: number; response: string; resp_sha: string; upstream_ms: number | null; at: string | null };

export function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
}
export function appendJsonl(file: string, obj: unknown) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, JSON.stringify(obj) + "\n"); }

/** The worst case one request can cost: every estimated input token (2.5 characters a token) and every allowed output token at full price. */
export function reserveUsd(body: string): number {
  let maxOut = 2000;
  try { const j = JSON.parse(body); maxOut = Number(j.max_completion_tokens ?? j.max_tokens ?? 2000); } catch { /* keep */ }
  return (Math.ceil(body.length / 2.5) * PRICE.input + maxOut * PRICE.output) / 1_000_000;
}
export function usageCostUsd(response: string): number {
  try { const u = JSON.parse(response)?.usage ?? {}; return ((Number(u.prompt_tokens) || 0) * PRICE.input + (Number(u.completion_tokens) || 0) * PRICE.output) / 1_000_000; } catch { return 0; }
}

// ------------------------------------------------------------------------------------------------ the store
export class CourierStore {
  readonly requestsFile: string; readonly responsesFile: string; readonly sentFile: string;
  requests = new Map<string, Req>(); responses = new Map<string, Resp>();
  constructor(readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.requestsFile = path.join(dir, "requests.jsonl"); this.responsesFile = path.join(dir, "responses.jsonl"); this.sentFile = path.join(dir, "sent.jsonl");
    this.reload();
  }
  reload() {
    this.requests = new Map(readJsonl<Req>(this.requestsFile).map((r) => [r.key, r]));
    this.responses = new Map(readJsonl<Resp>(this.responsesFile).map((r) => [r.key, r]));
  }
  pending(): Req[] { return [...this.requests.values()].filter((r) => !this.responses.has(r.key)); }
  /** US$ already spent (responses recorded, at the usage they report; an error response costs 0) and reserved by what is still pending. */
  spentUsd(): number { let s = 0; for (const r of this.responses.values()) if (r.status === 200) s += usageCostUsd(r.response); return s; }
  reservedUsd(): number { return this.pending().reduce((a, r) => a + r.reserve_usd, 0); }
}

/** The fetch the application's HostedLoopModel is given. `tag()` names the conversation the current call belongs to. */
export type ReplayStats = { replayed: number; recorded: number; pending: string[]; diverged: { key: string; recorded: string; now: string }[] };
export function replayFetch(store: CourierStore, tag: () => string, arm: () => string): { fetch: typeof fetch; stats: ReplayStats; ord: Map<string, number> } {
  const stats: ReplayStats = { replayed: 0, recorded: 0, pending: [], diverged: [] };
  const ord = new Map<string, number>();
  const f = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = String(init?.body ?? ""); const t = tag(); const n = ord.get(t) ?? 0; ord.set(t, n + 1);
    const key = `${t}#${n}`; const sha = sha256(body);
    const known = store.requests.get(key);
    if (known && known.req_sha !== sha) { stats.diverged.push({ key, recorded: known.req_sha, now: sha }); appendJsonl(path.join(store.dir, "diverged.jsonl"), { key, recorded: known.req_sha, now: sha, request: body, at: new Date().toISOString() }); return new Response(JSON.stringify({ error: { message: "courier: the request differs from the one recorded for this key" } }), { status: 409 }); }
    const got = store.responses.get(key);
    if (got) { stats.replayed++; return new Response(got.response, { status: got.status, headers: { "content-type": "application/json" } }); }
    if (!known) {
      let model = "";
      try { model = String(JSON.parse(body).model ?? ""); } catch { /* keep */ }
      const rec: Req = { key, tag: t, ord: n, req_sha: sha, request: body, reserve_usd: reserveUsd(body), model, arm: arm(), at: new Date().toISOString() };
      store.requests.set(key, rec); appendJsonl(store.requestsFile, rec); stats.recorded++;
    }
    if (!stats.pending.includes(key)) stats.pending.push(key);
    return new Response(JSON.stringify({ error: { message: "courier: the response for this request has not been recorded yet" } }), { status: 401 });
  }) as typeof fetch;
  return { fetch: f, stats, ord };
}

// ------------------------------------------------------------------------------------------------ the delta
/** Splits at every escaped newline (backslash, n) and at every "},{" -- a partition: tokens.join("") === s. */
export const tokenize = (s: string): string[] => s.split(/(?<=\\n)|(?<=\},\{)/).filter((x) => x !== "");
export type Hunk = [0, number, number] | [1, string];
/** Hunks that rebuild `next` from `base`: [0, start, end] copies base[start:end] (UTF-16 offsets), [1, text] inserts text. */
export function diffHunks(base: string, next: string): Hunk[] {
  const a = tokenize(base), b = tokenize(next);
  const ids = new Map<string, number>(); const id = (t: string) => { let v = ids.get(t); if (v == null) { v = ids.size; ids.set(t, v); } return v; };
  const A = a.map(id), B = b.map(id);
  let lo = 0; while (lo < A.length && lo < B.length && A[lo] === B[lo]) lo++;
  let hiA = A.length, hiB = B.length; while (hiA > lo && hiB > lo && A[hiA - 1] === B[hiB - 1]) { hiA--; hiB--; }
  const n = hiA - lo, m = hiB - lo;
  const dp = new Int32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[at(i, j)] = A[lo + i] === B[lo + j] ? dp[at(i + 1, j + 1)] + 1 : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)]);
  type Op = { copy: true; ai: number } | { copy: false; bj: number };
  const ops: Op[] = [];
  for (let i = 0; i < lo; i++) ops.push({ copy: true, ai: i });
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[lo + i] === B[lo + j]) { ops.push({ copy: true, ai: lo + i }); i++; j++; }
    else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) i++; else { ops.push({ copy: false, bj: lo + j }); j++; }
  }
  while (j < m) { ops.push({ copy: false, bj: lo + j }); j++; }
  for (let k = hiA; k < A.length; k++) ops.push({ copy: true, ai: k });
  const off: number[] = [0]; for (const t of a) off.push(off[off.length - 1] + t.length);
  const hunks: Hunk[] = [];
  for (const op of ops) {
    if (op.copy) { const s = off[op.ai], e = off[op.ai + 1]; const last = hunks[hunks.length - 1]; if (last && last[0] === 0 && last[2] === s) last[2] = e; else hunks.push([0, s, e]); }
    else { const last = hunks[hunks.length - 1]; if (last && last[0] === 1) last[1] += b[op.bj]; else hunks.push([1, b[op.bj]]); }
  }
  return hunks;
}
export function applyHunks(base: string, hunks: Hunk[]): string { return hunks.map((h) => (h[0] === 0 ? base.slice(h[1], h[2]) : h[1])).join(""); }
const payloadSize = (h: Hunk[]) => h.reduce((n, x) => n + (x[0] === 1 ? x[1].length : 12), 0);

export type Item = { key: string; sha: string; base?: string; hunks?: Hunk[]; full?: string };
/** The payload for the workbench: each pending request as a delta against the body most like it among those already sent. */
export function preparePayload(store: CourierStore, capUsd: number): { items: Item[]; cap: number; reserve: number; spent: number; sizeChars: number } {
  const bySha = new Map<string, Req>(); for (const r of store.requests.values()) bySha.set(r.req_sha, r);
  const sent: { sha: string; body: string; arm: string; key: string }[] = []; // bodies the workbench already holds (earlier rounds, then earlier items of this one)
  const have = (sha: string) => sent.some((x) => x.sha === sha);
  for (const x of readJsonl<{ sha: string }>(store.sentFile)) { const r = bySha.get(x.sha); if (r && !have(x.sha)) sent.push({ sha: x.sha, body: r.request, arm: r.arm, key: r.key }); }
  const items: Item[] = []; let reserve = 0;
  for (const r of store.pending().sort((x, y) => (x.ord - y.ord) || x.tag.localeCompare(y.tag))) {
    reserve += r.reserve_usd;
    if (have(r.req_sha)) { items.push({ key: r.key, sha: r.req_sha, base: r.req_sha, hunks: [[0, 0, r.request.length]] }); continue; }
    // candidates: the previous request of the same conversation, then the most recent bodies of the same arm
    const prev = store.requests.get(`${r.tag}#${r.ord - 1}`);
    const cands = new Map<string, string>();
    if (prev && have(prev.req_sha)) cands.set(prev.req_sha, prev.request);
    for (const x of [...sent].reverse().filter((x) => x.arm === r.arm).slice(0, 3)) cands.set(x.sha, x.body);
    let best: { sha: string; hunks: Hunk[] } | null = null;
    for (const [sha, body] of cands) { const h = diffHunks(body, r.request); if (!best || payloadSize(h) < payloadSize(best.hunks)) best = { sha, hunks: h }; }
    if (best && payloadSize(best.hunks) < r.request.length * 0.8) items.push({ key: r.key, sha: r.req_sha, base: best.sha, hunks: best.hunks });
    else items.push({ key: r.key, sha: r.req_sha, full: r.request });
    sent.push({ sha: r.req_sha, body: r.request, arm: r.arm, key: r.key });
  }
  const spent = store.spentUsd();
  return { items, cap: capUsd, reserve, spent, sizeChars: JSON.stringify(items).length };
}

// ------------------------------------------------------------------------------------------------ CLI
async function readStdin(): Promise<string> { const chunks: Buffer[] = []; for await (const c of process.stdin) chunks.push(c as Buffer); return Buffer.concat(chunks).toString("utf8"); }
async function main() {
  const [cmd, dir, ...rest] = process.argv.slice(2);
  if (!cmd || !dir) { console.error("usage: courier.ts prep|apply|status <dir> [--cap 0.25]"); process.exit(2); }
  const store = new CourierStore(dir);
  const capArg = rest.indexOf("--cap"); const cap = capArg >= 0 ? Number(rest[capArg + 1]) : 0.25;
  if (cmd === "status") {
    console.log(JSON.stringify({ requests: store.requests.size, responses: store.responses.size, pending: store.pending().map((r) => r.key), spent_usd: +store.spentUsd().toFixed(6), reserved_pending_usd: +store.reservedUsd().toFixed(6), cap_usd: cap }));
    return;
  }
  if (cmd === "prep") {
    const p = preparePayload(store, cap);
    if (!p.items.length) { console.log("NOTHING PENDING"); return; }
    if (p.spent + p.reserve > cap + 1e-12) { console.error(`REFUSED: spent US$${p.spent.toFixed(6)} + worst case of the pending requests US$${p.reserve.toFixed(6)} would pass the cap US$${cap}`); process.exit(3); }
    for (const it of p.items) appendJsonl(store.sentFile, { sha: it.sha, key: it.key, at: new Date().toISOString() });
    console.error(`pending ${p.items.length}; payload ${p.sizeChars} chars; worst case this round US$${p.reserve.toFixed(6)}; spent so far US$${p.spent.toFixed(6)}; cap US$${cap}`);
    console.log(JSON.stringify({ cap, spent: +p.spent.toFixed(6), items: p.items }));
    return;
  }
  if (cmd === "apply") {
    const text = await readStdin(); let n = 0, bad = 0;
    for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
      let r: any; try { r = JSON.parse(line); } catch { console.error("NOT JSON: " + line.slice(0, 120)); bad++; continue; }
      const req = store.requests.get(r.key);
      if (!req) { console.error(`UNKNOWN KEY ${r.key}`); bad++; continue; }
      if (store.responses.has(r.key)) { console.error(`ALREADY RECORDED ${r.key} (kept the first)`); continue; }
      if (r.req_sha !== req.req_sha) { console.error(`REQUEST MISMATCH ${r.key}`); bad++; continue; }
      if (sha256(String(r.response)) !== r.resp_sha) { console.error(`RESPONSE CHECKSUM MISMATCH ${r.key} (transcription error: ask for that line again)`); bad++; continue; }
      appendJsonl(store.responsesFile, { key: r.key, req_sha: r.req_sha, status: Number(r.status), response: String(r.response), resp_sha: r.resp_sha, upstream_ms: r.upstream_ms ?? null, at: r.at ?? null } satisfies Resp);
      n++;
    }
    store.reload();
    console.log(JSON.stringify({ applied: n, rejected: bad, pending: store.pending().map((r) => r.key), spent_usd: +store.spentUsd().toFixed(6) }));
    process.exit(bad ? 1 : 0);
  }
  console.error("unknown command"); process.exit(2);
}
if (process.argv[1] && /courier\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
