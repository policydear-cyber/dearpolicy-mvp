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
/** Ends a synthetic extraction that a PDF wraps over several text lines. */
export const SYNTHETIC_EXTRACTION_END = ":DPTEST-END";

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
  const add = (key: string, value: Fact["value"], q: string = quote) => facts.push({ subjectId: subject, key, value, state: "known", quote: q });
  const scenario = (label: string, family: string, traits: string[], q: string = quote) => scenarioCandidates.push({ subjectId: subject, label, family, traits, quote: q });
  // Like the production prompt asks ("the shortest span that proves the
  // fact"): the one sentence that reports the event, not the whole message.
  const sentenceWith = (re: RegExp) => message.split(/(?<=[.!?])\s+/).find((x) => re.test(x))?.trim() || quote;
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
    const said = sentenceWith(/\b(?:died|passed away|was killed)\b/i);
    intent = "claim"; add("eventType", "death", said); add("death", true, said);
    if (date) { add("deathDate", date, said); add("eventDate", date, said); }
    const cause = said.match(/\b((?:road |traffic |car )?accident|collision|crash)\b/i)?.[1];
    if (cause) add("causeOfDeath", cause, said);
    scenario(cause ? "Accidental death" : "Reported death", "death", cause ? ["death", "accident", "sudden", "external"] : ["death"], said);
  }
  if (/\b(?:unable to work|cannot work|can't work|permanently disabled|disabled)\b/i.test(message) && !/\bif\b/i.test(message)) {
    intent = "claim"; add("eventType", "disability"); add("disabled", true);
    if (date) add("disabilityDate", date);
    scenario("Unable to work after an injury", "disability", ["disability", "bodily_injury"]);
  }
  if (/\b(?<!not |never |wasn't |was not )(?:admitted|hospitali[sz]ed|warded)\b/i.test(message) && !/\bif\b/i.test(message)) {
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
  const candidates: { score: number; order: number; text: string; sourceId: string }[] = [];
  for (const source of user.sources ?? []) {
    for (const sentence of String(source.text).split(/(?<=[.!?])\s+/)) {
      const s = sentence.trim();
      if (s.length < 20 || s.length > 230 || s.includes(SYNTHETIC_EXTRACTION_MARKER)) continue;
      const shared = [...words(s)].filter((w) => asked.has(w)).length;
      if (shared >= 2) candidates.push({ score: shared, order: candidates.length, text: s, sourceId: source.id });
    }
  }
  // The most relevant sentences first (ties keep document order), at most 3.
  const observations = candidates.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 3)
    .map((c) => ({ text: c.text, evidence: [{ sourceId: c.sourceId, quote: c.text }] }));
  return { benefits: [], observations, nextSteps: [] };
}

/** The synthetic extraction the synthetic document carries on its own page;
 * null for anything else. */
export function syntheticExtractionFrom(text: string): unknown | null {
  const at = text.indexOf(SYNTHETIC_EXTRACTION_MARKER);
  if (at < 0) return null;
  const rest = text.slice(at + SYNTHETIC_EXTRACTION_MARKER.length);
  const end = rest.indexOf(SYNTHETIC_EXTRACTION_END);
  // A real PDF wraps a long line, so the payload may span several text lines
  // up to the end marker; whitespace between chunks is dropped. Anything that
  // is not base64 inside the block makes it invalid (never partially parsed).
  const block = end >= 0 ? rest.slice(0, end).replace(/\s+/g, "") : rest.match(/^\s*([A-Za-z0-9+/=]+)/)?.[1] ?? "";
  if (!block || !/^[A-Za-z0-9+/=]+$/.test(block)) return null;
  const encoded = block;
  try { return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")); } catch { return null; }
}

/** Deterministic transcript for the hosted document-reading (OCR) path, so
 * synthetic browser journeys can upload IMAGES (which always need OCR) and
 * exercise the full normalize -> OCR -> store -> extract -> cite pipeline
 * without a real provider. Returns a fixed synthetic policy-wording
 * transcript parameterized by the run id -- it deliberately does NOT read
 * the page pixels (no model does here); what it proves in CI is the
 * plumbing, with the real transcription quality owned by the production
 * reading model. Enabled under exactly the same triple guard as everything
 * else in this file. */
export function deterministicHostedDocumentText(args: { system: string; user: string; pdfBase64: string }): {
  text: string; truncated: boolean; usage: { input: number; output: number }; resolved: { resolvedModel: string; providerRequestId: string | null; finishReason: string | null; region: string | null };
} {
  const runId = (process.env.E2E_RUN_ID ?? "").replace(/[^A-Za-z0-9]/g, "").slice(-12);
  const pageNumbers = (args.user.match(/in this order: ([0-9, ]+)/)?.[1] ?? "1")
    .split(",").map((n) => parseInt(n.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0);
  const product = `SYNTHETIC-DPTEST-${runId} Scanned Care`;
  const pageText = (pageNumber: number) => [
    `${product} Policy Wording`,
    "Terms and Conditions",
    "SYNTHETIC TEST DOCUMENT - NOT A REAL INSURANCE POLICY",
    `Deterministic OCR transcript of scanned page ${pageNumber}.`,
    "Section 1 - Critical Illness Benefit: We will pay 100% of the Sum Insured upon diagnosis of a covered critical illness.",
    "Section 2 - Waiting period: A waiting period of 90 days applies to the Critical Illness Benefit from the cover start date.",
  ].join("\n");
  const content = JSON.stringify({ pages: (pageNumbers.length ? pageNumbers : [1]).map((n) => ({ pageNumber: n, text: pageText(n) })) });
  return {
    text: content, truncated: false,
    usage: { input: Math.ceil(args.pdfBase64.length / 2000), output: Math.ceil(content.length / 4) },
    resolved: { resolvedModel: DETERMINISTIC_MODEL_ID, providerRequestId: `det-ocr-${pageNumbers.join("-") || "1"}`, finishReason: "stop", region: null },
  };
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
  } else if (args.system.startsWith("You are DearPolicy's conservative insurance-document extraction engine")) {
    // Policy-document structured extraction: the synthetic test document
    // carries its own extraction on its first page (the same
    // DPTEST-EXTRACTION marker mechanism claim evidence uses), so the
    // browser journey can upload a personalised certificate and exercise
    // classification, verification and family linking through the REAL
    // pipeline. A document without the marker yields nothing.
    value = syntheticExtractionFrom(args.user);
    if (value == null) throw new DeterministicModelUnavailableError("policy extraction of a document without a synthetic extraction");
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
