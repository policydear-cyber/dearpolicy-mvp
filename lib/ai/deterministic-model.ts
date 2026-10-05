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
 *
 * DEARPOLICY_DETERMINISTIC_MODEL=chaos-<seed> wraps this stand-in in the chaos
 * model (lib/ai/chaos-model.ts), which mutates its output the way a misbehaving
 * real model would. It is stricter still: it also requires NODE_ENV=test.
 * DEARPOLICY_DETERMINISTIC_MODEL=ingest-chaos-<seed> does the same for the
 * calls made while a DOCUMENT is read (lib/ai/chaos-ingest.ts), under the same
 * test-only guard, and leaves chat-time calls to this stand-in.
 */
import { createHash } from "node:crypto";
import type { HostedReply } from "./providers";
import { chaosReply, chaosSeedOf } from "./chaos-model";
import { ingestChaosOcrMode, ingestChaosReply, ingestChaosRng, ingestChaosSeedOf, mutateOcrTranscript, recordIngestCall } from "./chaos-ingest";

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

/** The chaos seed, only for a test process (NODE_ENV=test, an E2E_RUN_ID, not
 * production, not Vercel); null everywhere else. */
export function chaosModelSeed(env: NodeJS.ProcessEnv = process.env): number | null {
  const seed = chaosSeedOf(env[DETERMINISTIC_MODEL_FLAG]);
  if (seed == null) return null;
  if (env.NODE_ENV !== "test") return null;
  if ((env.VERCEL ?? "").trim() || (env.VERCEL_ENV ?? "").trim()) return null;
  if (!(env.E2E_RUN_ID ?? "").trim()) return null;
  return seed;
}

/** The ingestion chaos seed, under exactly the chaos model's test-only guard; null everywhere else. */
export function ingestChaosModelSeed(env: NodeJS.ProcessEnv = process.env): number | null {
  const seed = ingestChaosSeedOf(env[DETERMINISTIC_MODEL_FLAG]);
  if (seed == null) return null;
  if (env.NODE_ENV !== "test") return null;
  if ((env.VERCEL ?? "").trim() || (env.VERCEL_ENV ?? "").trim()) return null;
  if (!(env.E2E_RUN_ID ?? "").trim()) return null;
  return seed;
}

export function deterministicModelEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (chaosModelSeed(env) != null) return true;
  if (ingestChaosModelSeed(env) != null) return true;
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
export async function deterministicHostedDocumentText(args: { system: string; user: string; pdfBase64: string }): Promise<{
  text: string; truncated: boolean; usage: { input: number; output: number }; resolved: { resolvedModel: string; providerRequestId: string | null; finishReason: string | null; region: string | null };
}> {
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
  const numbers = pageNumbers.length ? pageNumbers : [1];
  // Round 10: an image a test registered gets ITS transcript, read the way a
  // reader sees it -- only when the page is shown upright (see scriptedOcrPages).
  const scripted = await scriptedOcrPages(args.pdfBase64, numbers).catch(() => null);
  let content = JSON.stringify({ pages: numbers.map((n, i) => scripted?.[i] ?? { pageNumber: n, text: pageText(n) }) });
  const ingestSeed = ingestChaosModelSeed();
  if (ingestSeed != null) {
    const mode = ingestChaosOcrMode(ingestSeed, pageNumbers.join(","), createHash("sha256").update(args.pdfBase64).digest("hex").slice(0, 24));
    if (mode) content = mutateOcrTranscript(content, mode, ingestChaosRng("ocr|" + ingestSeed + "|" + pageNumbers.join(",")));
  }
  return {
    text: content, truncated: false,
    usage: { input: Math.ceil(args.pdfBase64.length / 2000), output: Math.ceil(content.length / 4) },
    resolved: { resolvedModel: DETERMINISTIC_MODEL_ID, providerRequestId: `det-ocr-${pageNumbers.join("-") || "1"}`, finishReason: "stop", region: null },
  };
}

/** Round 10 (synthetic tests only): what a hosted reading model would
 * transcribe from one exact scanned image -- registered by a test under the
 * sha256 of the image's encoded stream (pageImageFingerprints), with the
 * clockwise rotation of the content in that image and how legible it is.
 * The stand-in never reads pixels: it serves the registered transcript only
 * when the page, as sent, shows the content upright (the image's own
 * rotation plus the page's /Rotate). A sideways or upside-down page comes
 * back empty with the orientation the reader saw; an illegible page comes
 * back empty; handwriting comes back partly read and marked poor. */
export type SyntheticOcrScript = { text: string; rotation: number; quality: "good" | "poor" | "unreadable" };
export const SYNTHETIC_OCR_REGISTRY = "__dpOcrTranscripts";
function ocrRegistry(): Map<string, SyntheticOcrScript> | undefined {
  return (globalThis as Record<string, unknown>)[SYNTHETIC_OCR_REGISTRY] as Map<string, SyntheticOcrScript> | undefined;
}
/** sha256 of each image stream drawn on each page, in page order. */
export async function pageImageFingerprints(pdfBytes: Uint8Array): Promise<string[][]> {
  const { PDFDocument, PDFName, PDFDict, PDFRawStream } = await import("pdf-lib");
  const { createHash } = await import("node:crypto");
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
  return doc.getPages().map((page) => {
    const resources = page.node.Resources();
    const xobjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    const out: string[] = [];
    for (const [, ref] of xobjects?.entries() ?? []) {
      const stream = doc.context.lookup(ref);
      if (stream instanceof PDFRawStream && String(stream.dict.get(PDFName.of("Subtype"))) === "/Image") out.push(createHash("sha256").update(stream.contents).digest("hex"));
    }
    return out;
  });
}
async function scriptedOcrPages(pdfBase64: string, pageNumbers: number[]) {
  const registry = ocrRegistry();
  if (!registry?.size) return null;
  const { PDFDocument } = await import("pdf-lib");
  const bytes = Buffer.from(pdfBase64, "base64");
  const fingerprints = await pageImageFingerprints(bytes);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages();
  return fingerprints.map((hashes, i) => {
    const script = hashes.map((h) => registry.get(h)).find(Boolean);
    if (!script) return null;
    const pageNumber = pageNumbers[i] ?? i + 1;
    const turned = (((script.rotation + (pages[i]?.getRotation().angle ?? 0)) % 360) + 360) % 360;
    if (script.quality === "unreadable") return { pageNumber, text: "", legibility: "unreadable" };
    if (turned !== 0) return { pageNumber, text: "", orientation: turned === 180 ? "upside_down" : "sideways", rotation: turned };
    return { pageNumber, text: script.text, orientation: "upright", legibility: script.quality };
  });
}

/** Provider-shaped reply for one structured completion (through the chaos
 * model when a test process selected it). */
export function deterministicHostedReply(args: { system: string; user: string; jsonSchema?: unknown }): HostedReply {
  recordIngestCall(args);
  const ingestSeed = ingestChaosModelSeed();
  if (ingestSeed != null) return ingestChaosReply(ingestSeed, args, () => syntheticHostedReply(args));
  const seed = chaosModelSeed();
  return seed == null ? syntheticHostedReply(args) : chaosReply(seed, args, () => syntheticHostedReply(args));
}
function syntheticHostedReply(args: { system: string; user: string }): HostedReply {
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
