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
