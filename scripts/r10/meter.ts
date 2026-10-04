/**
 * Round 10: test-only per-turn meter for the chat (wall ms, CPU ms, database
 * queries and their time, model calls by role, estimated tokens, the largest
 * prompt, job-queue hops). Installed over lib/db/client's pool (after a
 * fixture has put PGlite behind it) and over lib/ai/llm.ts's __dpModelMeter
 * hook. Turns are scoped with AsyncLocalStorage so concurrent chats are
 * metered separately.
 *
 * R10_METER=<file.jsonl> makes the r6/r7/r9 batteries write one line per turn.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync } from "node:fs";
import type { ModelMeterEvent } from "@/lib/ai/llm";

export type TurnMeter = {
  label: string; wallMs: number; cpuMs: number; queries: number; dbMs: number; slowestQueryMs: number; slowestQuery: string;
  modelCalls: number; byRole: Record<string, number>; byOperation: Record<string, number>; promptTokens: number; completionTokens: number;
  maxPromptChars: number; jobHops: number; historyReads: number; status?: number; mode?: string; type?: string; queryKinds: Record<string, number>;
};
const scope = new AsyncLocalStorage<TurnMeter>();
let installed = false;
const shape = (sql: string) => sql.replace(/\s+/g, " ").trim().slice(0, 90);

export async function installMeter() {
  if (installed) return;
  installed = true;
  const { pool } = await import("@/lib/db/client");
  const track = (m: TurnMeter | undefined, sql: string, ms: number) => {
    if (!m) return;
    m.queries++; m.dbMs += ms;
    if (ms > m.slowestQueryMs) { m.slowestQueryMs = ms; m.slowestQuery = shape(sql); }
    if (/background_jobs|chat_analysis_jobs/i.test(sql) && /^\s*(?:INSERT|UPDATE|WITH)/i.test(sql)) m.jobHops++;
    if (/FROM chat_messages/i.test(sql) && /LIMIT/i.test(sql)) m.historyReads++;
    const k = shape(sql).slice(0, 60); m.queryKinds[k] = (m.queryKinds[k] ?? 0) + 1;
  };
  const rawQuery = pool.query.bind(pool) as (text: string, params?: unknown[]) => Promise<unknown>;
  pool.query = (async (text: string, params?: unknown[]) => {
    const t0 = performance.now();
    try { return await rawQuery(text, params); } finally { track(scope.getStore(), typeof text === "string" ? text : String((text as { text?: string }).text), performance.now() - t0); }
  }) as typeof pool.query;
  const rawConnect = pool.connect.bind(pool) as () => Promise<{ query: (t: string, p?: unknown[]) => Promise<unknown>; release: () => void }>;
  pool.connect = (async () => {
    const client = await rawConnect();
    const q = client.query.bind(client);
    return { ...client, release: client.release.bind(client), query: async (text: string, params?: unknown[]) => {
      const t0 = performance.now();
      try { return await q(text, params); } finally { track(scope.getStore(), text, performance.now() - t0); }
    } };
  }) as unknown as typeof pool.connect;
  (globalThis as { __dpModelMeter?: (e: ModelMeterEvent) => void }).__dpModelMeter = (e) => {
    const m = scope.getStore(); if (!m) return;
    m.modelCalls++; m.byRole[e.role] = (m.byRole[e.role] ?? 0) + 1; m.byOperation[e.operation] = (m.byOperation[e.operation] ?? 0) + 1;
    m.promptTokens += Math.ceil(e.promptChars / 4); m.completionTokens += e.output; m.maxPromptChars = Math.max(m.maxPromptChars, e.promptChars);
  };
}

export function blankMeter(label: string): TurnMeter {
  return { label, wallMs: 0, cpuMs: 0, queries: 0, dbMs: 0, slowestQueryMs: 0, slowestQuery: "", modelCalls: 0, byRole: {}, byOperation: {}, promptTokens: 0,
    completionTokens: 0, maxPromptChars: 0, jobHops: 0, historyReads: 0, queryKinds: {} };
}

/** A coarse answer type for the report: which path answered the turn. */
export function answerType(m: TurnMeter, answer: { mode?: string; citations?: unknown[]; questions?: { id?: string }[] } | null | undefined): string {
  if (!answer) return "error/" + (m.status ?? "?");
  const interpreted = (m.byOperation["chat_fact_finding"] ?? 0) > 0 || m.historyReads > 0;
  if (answer.questions?.[0]?.id === "claim_person") return "ask-person";
  if (answer.mode === "claim_assessment") return "claim-assessment";
  if (answer.mode === "fact_finding") return interpreted ? "claim-interview" : "pending-reminder";
  if (!interpreted) return answer.citations?.length ? "direct-cited" : "direct";
  return answer.citations?.length ? "policy-answer" : "policy-answer-uncited";
}

/** Runs one turn under the meter. With R10_METER unset and no sink, a plain passthrough. */
export async function meterTurn<T>(label: string, fn: () => Promise<T>, sink?: (m: TurnMeter) => void): Promise<T> {
  const file = process.env.R10_METER;
  if (!file && !sink) return fn();
  await installMeter();
  const m = blankMeter(label);
  const t0 = performance.now(), c0 = process.cpuUsage();
  const result = await scope.run(m, fn);
  m.wallMs = Math.round(performance.now() - t0); const c = process.cpuUsage(c0); m.cpuMs = Math.round((c.user + c.system) / 1000);
  m.dbMs = Math.round(m.dbMs); m.slowestQueryMs = Math.round(m.slowestQueryMs);
  const res = result as unknown as { status?: number; clone?: () => { json: () => Promise<unknown> } };
  if (res && typeof res.clone === "function") {
    m.status = res.status;
    const body = await res.clone().json().catch(() => null) as { answer?: { mode?: string; citations?: unknown[] } } | null;
    m.mode = body?.answer?.mode; m.type = answerType(m, body?.answer);
  }
  if (sink) sink(m);
  if (file) { const { queryKinds: _k, ...line } = m; void _k; if (process.env.R10_METER_KINDS) (line as Record<string, unknown>).queryKinds = _k; appendFileSync(file, JSON.stringify({ suite: process.env.R10_SUITE ?? "", ...line }) + "\n"); }
  return result;
}

export function percentile(xs: number[], p: number) { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)]; }
