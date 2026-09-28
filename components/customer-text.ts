/**
 * Customer-facing wording guard (V1.1 Task 4 / defect register: the
 * endowment question showed a raw provider quota error with an organisation
 * identifier).
 *
 * Household screens show messages that come back from the server (an API's
 * `error`, a background job's failure, a progress stage). Most are written
 * for people, but a message that carries system internals -- a provider or
 * model name, a quota or billing notice, an organisation or request id, a
 * stack trace, a database or network error, an HTTP status -- must never be
 * shown as-is. customerMessage() keeps a plain, short message and replaces
 * anything else with the caller's own plain fallback. The internals stay in
 * server logs and in the operator area.
 */

/** Words and shapes that only ever belong to the system, never to a household. */
export const INTERNAL_DETAIL =
  /\b(openai|anthropic|gemini|claude|gpt-?\d|o\d-mini|llama|ollama|mistral|pinecone|supabase|postgres(?:ql)?|pgvector|virustotal|vercel|quota|rate[- ]?limit|billing|insufficient_quota|api[_ ]?key|org(?:anization|anisation)?[-_ ]?id|org-[a-z0-9]{6,}|req(?:uest)?[-_ ]?id|token(?:s)? (?:in|out|used)|model[_ ]?(?:call|name|error|execution)s?|tokens?|embedding|vector|chunk|queue|job id|worker|stack|trace|undefined|null|NaN|ECONN\w*|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|fetch failed|sql|relation "|syntax error|violates|constraint|timeout exceeded|internal server error|status code|http \d{3}|\b[45]\d\d\b|https?:\/\/|\{|\}|\[object)/i;

/** Longest message shown to a household; anything longer is not a message
 * a person wrote for another person. */
const MAX_LENGTH = 220;

/** A server-provided message, if it is fit for a household; otherwise the
 * caller's plain fallback. */
export function customerMessage(message: unknown, fallback: string): string {
  if (typeof message !== "string") return fallback;
  const text = message.trim();
  if (!text || text.length > MAX_LENGTH || INTERNAL_DETAIL.test(text)) return fallback;
  return text;
}

/** The message of a caught error, guarded the same way. */
export function customerError(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === "AbortError") return fallback;
  return customerMessage(error instanceof Error ? error.message : error, fallback);
}

/** A provider/billing error that leaked into answer text. Narrower than
 * INTERNAL_DETAIL, because answers legitimately contain amounts and policy
 * wording: only unmistakable provider-error shapes match. */
export const RAW_PROVIDER_ERROR =
  /(insufficient_quota|exceeded your current quota|quota exceeded|org-[A-Za-z0-9]{8,}|organi[sz]ation (?:id|org-)|api[_ -]?key|rate[- ]limit(?:ed)? (?:reached|exceeded)|status code [45]\d\d|platform\.openai\.com|console\.anthropic\.com|billing (?:details|hard limit)|RESOURCE_EXHAUSTED|\bat [A-Za-z0-9_.]+ \(\/)/i;

export const ANSWER_UNAVAILABLE = "DearPolicy could not answer this just now. Please try again in a few minutes.";

/** Answer text as shown to a household: unchanged unless it is a leaked
 * provider error, which becomes one plain sentence. */
export function customerAnswerText(text: string): string {
  return RAW_PROVIDER_ERROR.test(text) ? ANSWER_UNAVAILABLE : text;
}
