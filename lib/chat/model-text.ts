/**
 * Round 8: the gate every piece of model-WRITTEN prose passes before a
 * household can read it (narration, and the observations, conditions, next
 * steps and interview questions a reading call writes about a policy).
 *
 * The model's words are only ever a rewording of facts the application has
 * already established, so anything the proof does not contain is refused
 * rather than repaired: a figure, date, percentage, page, person or benefit
 * name that is not in the proof; promise, "not covered" or advice language the
 * proof does not itself use; markup, code, emoji, other scripts or another
 * language; refusals, leaked instructions, model, provider or tool names, ids;
 * text copied from an injection attempt; a question where none may be asked;
 * a sentence cut off part-way or said twice. A refused text is never shown --
 * the caller falls back to the application's own words or the verbatim
 * document quote. Pure functions; no I/O.
 */
/** Every number in `text` is printed in `proof` (thousands separators ignored). */
function numbersGrounded(text: string, proof: string) {
  const tokens = (x: string) => (x.replace(/,/g, "").match(/\d+(?:\.\d+)?/g) ?? []).map((v) => String(Number(v)));
  const permitted = new Set(tokens(proof));
  return tokens(text).every((v) => permitted.has(v));
}
/** The words and figures of a structured packet, without its keys or JSON
 * punctuation: what a model may restate, never how the packet was built. */
export function proofText(value: unknown): string {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (v == null) return;
    if (typeof v === "string" || typeof v === "number") { out.push(String(v)); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === "object") Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(value);
  return out.join("\n");
}

export type ProseCheck = {
  /** Everything the text may draw on (packet, quotes). */
  proof: string;
  /** Narrower proof for figures, when only some of `proof` may be restated. */
  numberProof?: string;
  /** People's names in this household: one the proof does not name may not appear. */
  names?: string[];
  allowQuestion?: boolean;
  maxLength?: number;
  /** A short label or reason, not a sentence: no terminal punctuation needed. */
  fragment?: boolean;
  /** Text the model was given as instructions: echoing any of it is a leak. */
  echoOf?: string[];
};
const words = (s: string) => norm(s).match(/[\p{L}\p{N}'%$.]+/gu)?.map((w) => w.replace(/[.]+$/, "")) ?? [];
/** Shares a run of eight words with `source`. */
function echoes(text: string, source: string) {
  const w = words(text); if (w.length < 8) return false;
  const s = " " + words(source).join(" ") + " ";
  for (let i = 0; i + 8 <= w.length; i++) if (s.includes(" " + w.slice(i, i + 8).join(" ") + " ")) return true;
  return false;
}
/** Nearly every word of `sentence`, in any order, is in `proof`. */
function restates(sentence: string, proof: string) {
  const w = words(sentence); if (!w.length) return true;
  const have = new Set(words(proof));
  return w.filter((x) => have.has(x)).length / w.length >= 0.8;
}

const norm = (s: string) => s.normalize("NFKC").replace(/[‘’]/g, "'").replace(/[“”]/g, "\"").replace(/\s+/g, " ").trim().toLowerCase();
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const MONTH_LIST = MONTHS.toLowerCase().split("|");

/** Language a household must never read from the model, whatever the proof says. */
const NEVER: [string, RegExp][] = [
  ["markup", /```|<\/?[a-z][^>]*>|&lt;|&gt;|\*\*|__|^\s*#{1,6}\s|^\s*[-*•]\s|\|\s*-{3}|(?:^|\s)\|(?:\s|$)|\[[^\]]*\]\([^)]*\)/m],
  ["code or data", /[{}]|\b(?:json|schema|null|undefined|NaN|true|false)\b|\$\{|\b[a-z]+_[a-z0-9_]+\b|\b[a-z]+[A-Z][A-Za-z]+\b/],
  ["emoji", /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]/u],
  ["refusal", /\bas an (?:ai|a\.i\.|assistant|language model)\b|\b(?:i(?:'| a)m|i am) (?:just )?an? (?:ai|assistant|language model)\b|\bi(?:'m| am) sorry,? but i can(?:'|no)t\b|\bi can(?:'|no)t (?:help|assist|provide)\b|\bi don't have access\b/i],
  ["leak", /\b(?:system prompt|instructions?|prompt|language model|llm|gpt-?\d[\w.-]*|chatgpt|openai|gemini|anthropic|claude|model|provider|tool|api|token|packet|structuredcompletion|deterministic|synthetic|role (?:narration|reading|judgement))\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b(?:row|chunk|cache|database|table)\s*(?:#|id|\d)/i],
  ["injection", /\b(?:ignore|disregard|forget|override)\b[^.]{0,40}\b(?:instructions?|rules|above|previous|prior)\b|\breveal\b|\bpretend\b|\byou are now\b|\bact as\b/i],
  ["stalling", /\b(?:more time|bit more time|come back later|in due course|remaining portions|still reviewing|continue reviewing)\b/i],
];
/** Allowed only when the proof itself uses the same words. */
const UNLESS_PROVEN: [string, RegExp][] = [
  ["promise", /\b(?:definitely|certainly|surely|guarantee[ds]?|approved|entitled|will (?:be )?(?:pay|paid|receive|get)|you will (?:get|receive|be paid)|in full)\b/i],
  ["not covered", /\bnot (?:be )?(?:covered|insured|claimable|payable)\b|\bisn'?t covered\b|\baren'?t covered\b|\bno (?:cover(?:age)?|benefit) for\b|\bexcluded\b|\buninsured\b/i],
  ["advice", /\byou should\b|\bi (?:would )?(?:recommend|suggest|advise)\b|\bwe (?:recommend|suggest|advise)\b|\b(?:consult|see|call) (?:a|your) (?:lawyer|doctor|adviser|advisor)\b|\bsue\b|\bin court\b|\btake (?:paracetamol|medication|medicine|antibiotics)\b|\bswitch to\b|\bsurrender (?:it|the policy) now\b|\bbuy (?:more|another)\b|\bprobably nothing serious\b/i],
];
const FUNCTION_WORDS = /\b(?:the|a|an|is|are|was|were|be|your|you|to|of|and|or|for|on|in|it|this|that|with|has|have|will|can|may|not|if|as|by|at|from|per|up|any|each|no)\b/i;

/** Why `text` must not reach the household, or null when it may. */
export function modelProseProblem(text: unknown, check: ProseCheck): string | null {
  if (typeof text !== "string") return "not text";
  const t = text.trim();
  if (t.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length < (check.fragment ? 1 : 2)) return "empty";
  if (t.length > (check.maxLength ?? 900)) return "too long";
  const proof = check.proof, p = norm(proof);
  for (const [name, re] of NEVER) {
    const m = t.match(re);
    // A document's own words, quoted as proof, may carry what our prose may not.
    if (m && !p.includes(norm(m[0]))) return name;
  }
  for (const source of check.echoOf ?? []) if (echoes(t, source)) return "echoes its instructions";
  // A promise, a "not covered" or advice only as the proof itself words it:
  // the sentence carrying it must restate the proof, not add to it.
  for (const [name, re] of UNLESS_PROVEN) for (const s of t.split(/(?<=[.!?])\s+/)) if (re.test(s) && (!re.test(proof) || !restates(s, proof))) return name;
  if (!check.allowQuestion && /\?/.test(t)) return "asks a question";
  if ((t.match(/\?/g) ?? []).length > 1) return "asks more than one question";
  // Other scripts only as the proof prints them; a sentence of another language never.
  for (const m of t.matchAll(/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}\s]+/gu)) if (!proof.includes(m[0])) return "other script";
  const sentences = t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  for (const s of sentences) if (s.split(/\s+/).length >= 4 && /^[\p{Script=Latin}\p{Script=Common}\s]+$/u.test(s) && !FUNCTION_WORDS.test(s)) return "another language";
  const seen = new Set<string>();
  for (const s of sentences) { const k = norm(s); if (k.length >= 20 && seen.has(k)) return "repeated"; seen.add(k); }
  if ((!check.fragment && !/[.!)"”’]$/.test(t)) || /\b(?:and|or|the|of|to|a|an|with|than|by|for|but)\s*[.!?]?$/i.test(t)) return "cut off";
  if (!numbersGrounded(t, check.numberProof ?? proof)) return "figure not in the proof";
  for (const m of t.matchAll(new RegExp("\\b(\\d{1,2})\\s+(" + MONTHS + ")(?:\\s+(\\d{4}))?\\b", "gi"))) {
    const [all, d, month, y] = m;
    const iso = y ? y + "-" + String(MONTH_LIST.indexOf(month.toLowerCase()) + 1).padStart(2, "0") + "-" + d.padStart(2, "0") : null;
    if (!p.includes(norm(all)) && !(iso && proof.includes(iso))) return "date not in the proof";
  }
  for (const m of t.matchAll(/\bpages?\s+(\d+)/gi)) if (!p.includes(norm(m[0]))) return "page not in the proof";
  for (const name of check.names ?? []) for (const part of name.split(/\s+/).filter((x) => x.length >= 3 && /^\p{Lu}/u.test(x) && !/^(?:bin|binte|binti)$/i.test(x)))
    if (new RegExp("(?<![\\p{L}])" + part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\p{L}])", "u").test(t) && !p.includes(part.toLowerCase())) return "person not in the proof";
  for (const m of t.matchAll(/\b(?:[A-Z][\w'’-]*\s+){1,5}(?:Benefit|Rider|Bonus|Booster|Cover|Plan|Shield|Policy)\b/g))
    if (!p.includes(norm(m[0])) && !m[0].split(/\s+/).filter((w) => w.length > 2 && !/^(?:Your|The|This|That|His|Her|Their)$/.test(w)).every((w) => p.includes(norm(w)))) return "benefit name not in the proof";
  const kept = qualifierProblem(t, proof);
  if (kept) return kept;
  return null;
}

/** Round 9: a rewording that keeps every figure but changes what it means. Each figure in the text is
 * compared with the proof's own sentences that print it: a "not", "only" or "up to" the proof puts
 * beside the figure must still be there, a unit ("per day", "per accident") must not be dropped or
 * changed, and a kind of policy ("your travel policy") must be one the proof ties to that figure. */
const FIGURE = /(?:S\$|SGD\s?|US\$|\$)\s?\d[\d,]*(?:\.\d+)?|\b\d+(?:\.\d+)?\s?%/gi;
const UNIT = /\b(?:per|a|an|each|every|for each|for every)\s+(day|night|month|year|policy year|accident|visit|trip|claim|person|admission|week|6 hours)\b/i;
const CAP = /\b(?:up to|a maximum of|maximum of|maximum|max\.?|capped at|at most|limit of|limit)\b/i;
const NEGATION = /\b(?:not|no|never|none|except|excluding|excluded|without)\b|n't\b/i;
const ONLY = /\bonly\b/i;
const KIND_WORDS: Record<string, RegExp> = {
  travel: /travel|trip|overseas|wanderlust|flight|baggage/i, car: /motor|car\b|vehicle|drive|own damage|windscreen/i, motor: /motor|car\b|vehicle|drive|own damage|windscreen/i,
  home: /home|contents|house|household|renovation/i, life: /life|term|death|endow|whole life/i, term: /term|life|death/i,
  hospital: /hospital|shield|ward|inpatient|integrated|medishield|surgical|medi/i, accident: /accident|\bPA\b|guardian|safeguard|fracture|injur/i,
  "critical illness": /critical|\bCI\b|cancer|hercare|illness/i, helper: /helper|FDW|maid|domestic/i, endowment: /endow|lotus|maturity|savings/i, investment: /invest|ILP|fund|gateway|unit/i,
};
const figureKey = (f: string) => f.replace(/[\s,]|S\$|SGD|US\$|\$/gi, "").replace(/\.0+(?=%|$)/, "");
function qualifierProblem(text: string, proof: string): string | null {
  const proofSentences = proof.split(/\n+|(?<=[.!?;])\s+/).map((x) => x.trim()).filter(Boolean);
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    for (const m of sentence.matchAll(FIGURE)) {
      const key = figureKey(m[0]);
      if (!key || Number(key.replace(/%$/, "")) === 0) continue;
      const at = m.index ?? 0;
      // The proof's sentences that print this figure (with a neighbour line: a packet prints a name and its amount apart).
      const homes: string[] = [];
      proofSentences.forEach((p, i) => {
        if (![...p.matchAll(FIGURE)].some((f) => figureKey(f[0]) === key)) return;
        const bare = (p.replace(FIGURE, " ").match(/\p{L}{3,}/gu) ?? []).filter((w) => !/^(?:per|day|night|month|year|each|every|up|to|for|a|an|the|maximum|accident|visit|trip|claim|person|admission)$/i.test(w)).length < 2;
        homes.push(bare ? (proofSentences[i - 1] ?? "") + " " + p : p);
      });
      if (!homes.length) continue;
      const around = sentence.slice(Math.max(0, at - 40), at + m[0].length + 60);
      const lead = sentence.slice(Math.max(0, at - 25), at);
      const exact = proofSentences.filter((p) => [...p.matchAll(FIGURE)].some((f) => figureKey(f[0]) === key));
      const windowOf = (p: string) => { const i = [...p.matchAll(FIGURE)].find((f) => figureKey(f[0]) === key)?.index ?? 0; return p.slice(Math.max(0, i - 40), i + 60); };
      const proofUnits = exact.map((p) => windowOf(p).match(UNIT)?.[1]?.toLowerCase().replace("night", "day") ?? null);
      const textUnit = around.match(UNIT)?.[1]?.toLowerCase().replace("night", "day") ?? null;
      if (proofUnits.length && proofUnits.every((u) => u) && !textUnit) return "qualifier dropped";
      if (textUnit && proofUnits.length && !proofUnits.includes(textUnit) && proofUnits.every((u) => u)) return "qualifier changed";
      const leadOf = (p: string) => { const i = [...p.matchAll(FIGURE)].find((f) => figureKey(f[0]) === key)?.index ?? 0; return p.slice(Math.max(0, i - 25), i); };
      if (exact.length && exact.every((p) => CAP.test(leadOf(p))) && !CAP.test(lead) && /\b(?:pays?|gives?|get|receive|is paid|will be)\b/i.test(sentence)) return "qualifier dropped";
      if (exact.length && exact.every((p) => NEGATION.test(p)) && !NEGATION.test(sentence)) return "negation dropped";
      if (exact.length && !exact.some((p) => NEGATION.test(p)) && NEGATION.test(sentence.replace(/\bnot yet\b|\bno later than\b|\bno more than\b/gi, ""))) {
        // A "not" is added to a figure the proof states plainly.
        const clause = sentence.split(/[,;:—–-]\s+/).find((c) => c.includes(m[0])) ?? sentence;
        if (NEGATION.test(clause)) return "negation added";
      }
      if (exact.length && exact.every((p) => ONLY.test(p)) && !ONLY.test(sentence)) return "qualifier dropped";
      // "Your travel policy pays S$200,000": the kind named must be one the proof ties to this figure.
      const kind = sentence.match(/\b(?:your|the|her|his|their)\s+(travel|car|motor|home|life|term|hospital|accident|critical illness|helper|endowment|investment)\s+(?:policy|plan|insurance|cover)\b/i)?.[1]?.toLowerCase();
      if (kind && !homes.some((h) => KIND_WORDS[kind].test(h))) return "policy kind does not match the figure";
    }
  }
  return null;
}

/** A verbatim document passage that is fit to show as a line of its own. */
export function quoteFitToShow(quote: string): boolean {
  const q = quote.trim();
  if (q.length < 12 || q.length > 260) return false;
  // A whole statement, not a heading or a fragment cut from one.
  if (q.split(/\s+/).length < 4 || !/^[\p{Lu}\p{N}"“(]/u.test(q) || !/[.!?)"”]$/.test(q) || /\(\s*[^)]*$/.test(q)) return false;
  if (/```|<\/?[a-z][^>]*>|[{}]|\p{Extended_Pictographic}/u.test(q)) return false;
  return !/\b(?:ignore|disregard|forget|override)\b[^.]{0,40}\b(?:instructions?|rules|above|previous|prior)\b|\bsystem prompt\b|\byou are now\b/i.test(q);
}
