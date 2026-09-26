/**
 * Deterministic model stand-in for synthetic browser/CI journeys ONLY.
 *
 * It replaces the hosted model at the provider boundary
 * (lib/ai/providers.ts hostedStructuredCompletion), so every production
 * check downstream -- schema validation, quote verification against the
 * source pages, provenance recording, monetary gates -- runs unchanged.
 * It answers from fixed rules:
 *   - interpretation: facts and event traits from the family member's words
 *     (never an amount);
 *   - narration: hands back the deterministic summary it was given;
 *   - reading policy passages: quotes, verbatim, the passage sentences that
 *     share words with the question (production code then verifies every
 *     quote against the stored page before citing it);
 *   - claim-evidence extraction: returns ONLY a synthetic extraction that the
 *     synthetic test document itself carries on its page as
 *     "DPTEST-EXTRACTION:<base64 JSON>" -- a real document yields nothing.
 * Every other operation fails like an unavailable model.
 *
 * Impossible to enable in production: it requires ALL of
 *   DEARPOLICY_DETERMINISTIC_MODEL=synthetic-e2e, an E2E_RUN_ID, and
 *   NODE_ENV other than "production" with no VERCEL / VERCEL_ENV;
 * and lib/launch/guards.ts refuses to start a production or Vercel server
 * where the flag is present at all.
 */
import type { HostedReply } from "./providers";

export const DETERMINISTIC_MODEL_FLAG = "DEARPOLICY_DETERMINISTIC_MODEL";
export const DETERMINISTIC_MODEL_VALUE = "synthetic-e2e";
/** The model identity recorded in provenance for stand-in replies. */
export const DETERMINISTIC_MODEL_ID = "dearpolicy-deterministic-e2e-v1";
export const SYNTHETIC_EXTRACTION_MARKER = "DPTEST-EXTRACTION:";

export function deterministicModelRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[DETERMINISTIC_MODEL_FLAG] ?? "").trim() !== "";
}

export function deterministicModelEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env[DETERMINISTIC_MODEL_FLAG] ?? "").trim() !== DETERMINISTIC_MODEL_VALUE) return false;
  if (env.NODE_ENV === "production") return false;
  if ((env.VERCEL ?? "").trim() || (env.VERCEL_ENV ?? "").trim()) return false;
  if (!(env.E2E_RUN_ID ?? "").trim()) return false;
  return true;
}

export class DeterministicModelUnavailableError extends Error {
  constructor(what: string) { super(`deterministic stand-in does not implement ${what}`); this.name = "DeterministicModelUnavailableError"; }
}

type Fact = { subjectId: string; key: string; value: string | number | boolean | null; state: "known" | "unknown" | "pending"; quote: string };
type Scenario = { subjectId: string; label: string; family: string; traits: string[]; quote: string };

/** Fixed-rule reading of a family member's message: facts and event traits
 * only, never an amount. Deterministic. */
export function deterministicInterpretation(user: { currentMessage?: string; subjects?: { id: string }[]; previousIntent?: string | null }) {
  const message = String(user.currentMessage ?? "");
  const subject = user.subjects?.[0]?.id ?? "s1";
  const facts: Fact[] = [];
  const scenarioCandidates: Scenario[] = [];
  const quote = message.slice(0, 480) || "message";
  const add = (key: string, value: Fact["value"]) => facts.push({ subjectId: subject, key, value, state: "known", quote });
  const scenario = (label: string, family: string, traits: string[]) => scenarioCandidates.push({ subjectId: subject, label, family, traits, quote });
  const date = message.match(/\b(20\d\d-\d\d-\d\d)\b/)?.[1] ?? null;
  let intent: "claim" | "portfolio" | "policy_question" | "follow_up" =
    /\b(?:what policies|portfolio|family have)\b/i.test(message) ? "portfolio"
    : /\b(?:what if|if i|if my|suppose)\b|matur|surrender|premium|guaranteed|endowment|what does my policy|does my policy|am i covered|covered for|waiting period|what is the/i.test(message) ? "policy_question"
    : user.previousIntent ? "follow_up" : "claim";
  const diagnosed = message.match(/diagnosed with ([^.?!,]{2,80}?)(?: on \d|[.?!,]|$)/i);
  if (diagnosed && !/\bif\b/i.test(message)) {
    intent = "claim"; add("eventType", "diagnosis"); add("diagnosis", diagnosed[1].trim());
    if (date) { add("diagnosisDate", date); add("eventDate", date); }
    scenario("Reported diagnosis", "illness", ["illness", "diagnosis"]);
  }
  if (/\b(?:died|passed away|was killed)\b/i.test(message) && !/\bif\b/i.test(message)) {
    intent = "claim"; add("eventType", "death"); add("death", true);
    if (date) { add("deathDate", date); add("eventDate", date); }
    const accident = /\baccident|collision|crash\b/i.test(message);
    if (accident) add("causeOfDeath", "road traffic accident");
    scenario(accident ? "Accidental death" : "Reported death", "death", accident ? ["death", "accident", "sudden", "external"] : ["death"]);
  }
  if (/\b(?:unable to work|cannot work|can't work|permanently disabled|disabled)\b/i.test(message) && !/\bif\b/i.test(message)) {
    intent = "claim"; add("eventType", "disability"); add("disabled", true);
    if (date) add("disabilityDate", date);
    scenario("Unable to work after an injury", "disability", ["disability", "bodily_injury"]);
  }
  if (/\b(?:admitted|hospitali[sz]ed|warded)\b/i.test(message) && !/\bif\b/i.test(message)) {
    intent = "claim"; add("hospitalised", true);
    if (date) add("admissionDate", date);
    scenario("Hospital stay", "hospitalisation", ["hospitalisation"]);
  }
  if (/\bflight\b.*\bdelayed\b|\btrip\b|\btravel/i.test(message) && !/\bif\b/i.test(message)) {
    intent = "claim"; add("eventType", "travel_disruption");
    const hours = message.match(/(\d{1,2})\s*hours?/i)?.[1];
    if (hours) add("flightDelayHours", Number(hours));
    scenario("Travel disruption", "travel", ["travel_disruption"]);
  }
  return { intent, newTopic: false, searchTerms: ["critical illness", "hospital", "sum insured", "waiting period"], facts, scenarioCandidates };
}

const STOP = new Set(["the", "a", "an", "of", "to", "in", "is", "for", "and", "or", "my", "what", "does", "do", "how", "on", "at", "this", "that", "with", "policy", "plan", "i", "me", "be", "are", "it", "any", "there"]);
function words(text: string) { return new Set(text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))); }

/** Verbatim sentences from the supplied passages that share at least two
 * content words with the question. Production code re-verifies each quote
 * against the stored page before it is cited. */
export function deterministicReading(user: { question?: string; sources?: { id: string; text: string }[] }) {
  const asked = words(String(user.question ?? ""));
  const observations: { text: string; evidence: { sourceId: string; quote: string }[] }[] = [];
  for (const source of user.sources ?? []) {
    for (const sentence of String(source.text).split(/(?<=[.!?])\s+/)) {
      const s = sentence.trim();
      if (s.length < 20 || s.length > 230 || s.includes(SYNTHETIC_EXTRACTION_MARKER)) continue;
      const shared = [...words(s)].filter((w) => asked.has(w)).length;
      if (shared >= 2 && observations.length < 3) observations.push({ text: s, evidence: [{ sourceId: source.id, quote: s }] });
    }
  }
  return { benefits: [], observations, nextSteps: [] };
}

/** The synthetic extraction the synthetic document carries on its own page;
 * null for anything else. */
export function syntheticExtractionFrom(text: string): unknown | null {
  const at = text.indexOf(SYNTHETIC_EXTRACTION_MARKER);
  if (at < 0) return null;
  const encoded = text.slice(at + SYNTHETIC_EXTRACTION_MARKER.length).match(/^\s*([A-Za-z0-9+/=]+)/)?.[1];
  if (!encoded) return null;
  try { return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")); } catch { return null; }
}

/** Provider-shaped reply for one structured completion. */
export function deterministicHostedReply(args: { system: string; user: string }): HostedReply {
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(args.user) as Record<string, unknown>; } catch { payload = {}; }
  let value: unknown;
  if (args.system.startsWith("Interpret this")) value = deterministicInterpretation(payload as Parameters<typeof deterministicInterpretation>[0]);
  else if (args.system.startsWith("Read insurance evidence")) value = deterministicReading(payload as Parameters<typeof deterministicReading>[0]);
  else if (/^You extract structured facts from/.test(args.system)) {
    value = syntheticExtractionFrom(args.user);
    if (value == null) throw new DeterministicModelUnavailableError("extraction of a document without a synthetic extraction");
  } else if (typeof payload.summary === "string" && "benefitCount" in payload || typeof payload.whatTheyTold === "string") {
    value = { summary: String(payload.summary ?? "").slice(0, 900), details: [] };
  } else throw new DeterministicModelUnavailableError("this prompt");
  const content = JSON.stringify(value);
  let hash = 0; for (const ch of content) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return {
    content, truncated: false, usage: { input: Math.ceil(args.user.length / 4), output: Math.ceil(content.length / 4) },
    resolved: { resolvedModel: DETERMINISTIC_MODEL_ID, providerRequestId: `det-${(hash >>> 0).toString(16)}`, finishReason: "stop", region: null },
  };
}
