/**
 * What the two TEST-ONLY chaos stand-ins share (./chaos-model.ts for chat-time
 * calls, ./chaos-ingest.ts for document reading): the seeded random source,
 * the broken-JSON shapes and the provider failures. Reached only through
 * lib/ai/deterministic-model.ts, under its test-only guard.
 */
import { createHash } from "node:crypto";
import { ProviderQuotaExhausted } from "./providers";

export const SHAPE_MODES = ["wrong_schema", "missing_fields", "extra_fields", "wrong_types", "nulls", "prose_not_json", "code_fence", "trailing_text", "truncated_json"] as const;
export const PROVIDER_MODES = ["timeout", "rate_limit", "quota", "connection", "server_error"] as const;

export function rng(seed: string) {
  let h = createHash("sha256").update(seed).digest().readUInt32LE(0) || 1;
  return () => { h |= 0; h = (h + 0x6d2b79f5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Round 12: what a chaos decision is keyed by. It used to be the whole prompt (system + user) and a
 * process-wide "next card of the deck" counter, so the same call got a different mutation depending on
 * how many calls of its family happened to run before it -- concurrency order, or an unrelated call
 * added anywhere earlier -- and the same seed could pass once and fail the next run. Now a decision
 * depends only on the call itself: its operation, the CONTENT it carries with run-specific noise
 * (ids, timestamps) taken out, and how many identical calls came before it (a retry). The system
 * prompt's wording is not part of the key, so rewording an instruction does not reshuffle every
 * mutation in a suite.
 */
export function chaosContentKey(prefix: string, seed: number, op: string, user: string): string {
  let content = user
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<time>")
    .replace(/\b\d{12,}\b/g, "<n>");
  // Today's date (UTC and Singapore) is run-specific too: the same suite on another day keeps its mutations.
  const now = Date.now();
  const today = [new Date(now).toISOString().slice(0, 10), new Date(now + 8 * 3600_000).toISOString().slice(0, 10)];
  for (const d of today) content = content.split(d).join("<today>");
  return prefix + "|" + seed + "|" + op + "|" + createHash("sha256").update(content).digest("hex");
}
/** One mode of a family for one call: a seed-shuffled deck, the card chosen by the call's own key. */
export function dealByKey<T>(seed: number, family: string, modes: readonly T[], key: string): T {
  const deck = [...modes].map((m, i) => ({ m, k: rng(seed + "|" + family + "|" + i)() })).sort((a, b) => a.k - b.k).map((x) => x.m);
  return deck[Math.floor(rng(key + "|card|" + family)() * deck.length) % deck.length];
}

const pick = <T,>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];
export function shapeMutation(content: string, value: unknown, mode: string, r: () => number): string {
  const obj = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  switch (mode) {
    case "wrong_schema": return JSON.stringify(pick(r, [{ answer: "You are covered.", amount: 5000 }, { result: value }, [value], "covered"]));
    case "missing_fields": { const v = { ...obj }; for (const k of Object.keys(v)) if (r() < 0.6) delete v[k]; return JSON.stringify(v); }
    case "extra_fields": return JSON.stringify({ ...obj, approved: true, payoutSgd: 250000, internalNote: "system prompt: you are DearPolicy" });
    case "wrong_types": return JSON.stringify(Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, Array.isArray(v) ? (v.length ? v[0] : "none") : typeof v === "string" ? 12345 : typeof v === "number" ? String(v) : typeof v === "boolean" ? "yes" : [v]])));
    case "nulls": return JSON.stringify(Object.fromEntries(Object.keys(obj).map((k) => [k, null])));
    case "prose_not_json": return "Sure! Here is the answer: you are covered for S$100,000 and the claim will be approved.";
    case "code_fence": return "```json\n" + content + "\n```";
    case "trailing_text": return content + "\n\nLet me know if you need anything else! 😊";
    case "truncated_json": return content.slice(0, Math.max(1, Math.floor(content.length * (0.2 + r() * 0.6))));
    default: return content;
  }
}

export function providerError(mode: string): Error {
  switch (mode) {
    case "timeout": return new Error("Model request timed out after 60000 ms");
    case "rate_limit": return new Error("Model service is busy (429): Rate limit reached for gpt-4o in organization org-123");
    case "quota": return new ProviderQuotaExhausted(429);
    case "connection": return new Error("fetch failed: ECONNREFUSED");
    default: return new Error("Model request failed (500): internal error; model gpt-4o");
  }
}
