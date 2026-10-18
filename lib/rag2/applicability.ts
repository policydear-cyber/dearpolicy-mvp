/**
 * PR #54 follow-up (rc-live-5 BKL1): whether a benefit fits what the household reported, read from the uploaded
 * document's OWN definition of that benefit ("Simple Fracture means a closed fracture where the skin is not broken.";
 * "Other Fracture means a fracture that is not a Simple Fracture ..."), bound to the document and its version. This is
 * not an insurer decision: it only says whether the household's own report is consistent with the document's wording,
 * contradicts it, or leaves it open.
 *
 *   consistent    the definition's requirement on an observable attribute is met by what the household reported
 *   inconsistent  the report contradicts it -- the benefit is neither calculated nor clarified
 *   unresolved    the definition turns on an attribute the household has not reported (a question they can answer)
 *   unconstrained the definition constrains no attribute known here (evaluated as before)
 *
 * The ATTRIBUTES are vocabulary for what a household can observe and say ("closed", "open", "compound", "the skin was
 * broken") -- which value a benefit requires always comes from that document's definition, never from a rule that
 * every policy treats a closed fracture the same way.
 */
import { evidenceAt, type EvidenceRef } from "./evidence";

export type Definition = { term: string; text: string; evidence: EvidenceRef };
export type Attribute = { id: string; factKey: string; label: string; context: RegExp; values: { id: string; label: string; re: RegExp }[]; question: (who: string) => string; said: (value: string) => string };
/** One report of the household's (a recorded fact, or one sentence of their message), oldest first. */
export type Reported = { key: string | null; words: string; turn: number; cue: boolean };

export const ATTRIBUTES: Attribute[] = [
  {
    id: "fracture_skin", factKey: "fracture_type", label: "whether the fracture was closed (the skin not broken) or open (compound)",
    context: /fractur|\bbr(?:eak|oke|oken)\b|\bbones?\b|\bskin\b/i,
    values: [
      { id: "closed", label: "Closed (the skin was not broken)", re: /\bclosed\b|\bskin (?:is|was) (?:not|n['’]t) (?:broken|pierced)|\bskin (?:is |was )?(?:intact|unbroken)\b|\bunbroken skin\b/gi },
      { id: "open", label: "Open (compound: the bone broke through the skin)", re: /\b(?:open|compound)\b|\bskin (?:is |was )?(?:broken|pierced|punctured)\b|\b(?:through|pierc\w*|punctur\w*) the skin\b/gi },
    ],
    question: (who) => `Was ${who}'s fracture closed (the skin not broken) or open (compound, the bone through the skin)?`,
    said: (v) => `a${v === "open" ? "n" : ""} ${v} fracture`,
  },
];

/** Cause-of-death attribute (not one of the definition-driven ATTRIBUTES): how a reported death happened. Used only to read the
 * household's own words (latest correction wins) against a benefit's printed accident condition. */
export const CAUSE_ATTRIBUTE: Attribute = {
  id: "cause_of_death", factKey: "how_it_happened", label: "whether the death was caused by an accident or by an illness", context: /./,
  values: [
    { id: "accident", label: "An accident", re: /\baccident\w*|\bcrash(?:ed)?\b|\bcollision\b|\brun over\b|\bdrown\w*|\bfell (?:off|from|down)\b/gi },
    { id: "illness", label: "An illness", re: /\bill(?:ness)?\b|\bsick(?:ness)?\b|\bdisease\b|\bcancer\b|\bheart (?:attack|failure|disease)\b|\bstroke\b|\bnatural causes\b|\bpneumonia\b|\bdementia\b|\bcovid\b|\bdiabet\w*\b|\bterminal\b/gi },
  ],
  question: (who) => `Did ${who} die in an accident, or of an illness?`,
  said: (v) => (v === "accident" ? "an accident" : "an illness"),
};

const NEG_BEFORE = /(?:\bnot|n['’]t|\bnever|\bno)\s+(?:an?\s+|the\s+)?(?:\w+\s+)?$/i;
/** The attribute values a text states (a negated value counts as the other one; "open or closed" states both). */
export function valuesIn(text: string, attr: Attribute): Set<string> {
  const out = new Set<string>();
  for (const v of attr.values) {
    for (const m of text.matchAll(new RegExp(v.re.source, "gi"))) {
      const before = text.slice(Math.max(0, m.index! - 24), m.index!);
      if (NEG_BEFORE.test(before) && attr.values.length === 2) out.add(attr.values.find((x) => x.id !== v.id)!.id);
      else out.add(v.id);
    }
  }
  return out;
}

const STOP_TERMS = /^(?:this|it|we|you|that|which|the|there|he|she|they)$/i;
/** The definitions a document prints: "<Term> means / shall mean / is defined as / refers to ...", one sentence each,
 * with the exact span of the stored page as evidence. */
export function definitionsIn(pages: { page: number; text: string }[], doc: { id: string; hash: string | null }): Definition[] {
  const out: Definition[] = [];
  for (const p of pages) {
    const re = /(^|[.;:]\s+|\n)\s*(?:[“"])?((?:[A-Z][A-Za-z'’\-]*)(?:[ \t]+(?:[A-Z][A-Za-z'’\-]*|of|and|or|in|the))*?)(?:[”"])?[ \t]+(?:means|shall mean|is defined as|refers to)\b/g;
    for (const m of p.text.matchAll(re)) {
      const term = m[2].replace(/^the\s+/i, "").trim();
      if (!term || STOP_TERMS.test(term) || term.length > 60) continue;
      const local = m[0].slice(m[1].length);
      const start = m.index! + m[1].length + Math.max(0, local.search(/\S/));
      const rest = p.text.slice(start);
      const end = /[.](?=\s|$)/.exec(rest);
      const stop = start + (end ? end.index + 1 : Math.min(rest.length, 400));
      out.push({ term, text: p.text.slice(start, stop).replace(/\s*\n\s*/g, " ").trim(), evidence: evidenceAt({ policyId: doc.id, documentHash: doc.hash, page: p.page, pageText: p.text, start, end: stop, subjectId: null }) });
    }
  }
  return out;
}

const norm = (t: string) => t.toLowerCase().replace(/[“”"]/g, "").replace(/^the\s+/, "").replace(/\s+(?:benefit|benefits)$/, "").replace(/\s+/g, " ").trim();
export function definitionFor(benefit: string, defs: Definition[]): Definition | null {
  const want = norm(benefit);
  const hits = defs.filter((d) => norm(d.term) === want);
  return hits.length === 1 ? hits[0] : hits.length > 1 && hits.every((h) => h.text === hits[0].text) ? hits[0] : null;
}

/** The values of `attr` a definition allows (null: it does not constrain it). "X that is not a <Term>" allows what
 * that term's own definition does not; "... including / such as ..." lists examples, not the requirement. */
function allowed(def: Definition, defs: Definition[], attr: Attribute, depth = 0): { values: Set<string> | null; via: Definition | null } {
  const body = def.text.replace(/^[\s\S]*?\b(?:means|shall mean|is defined as|refers to)\b/i, "");
  const head = body.split(/,?\s*\b(?:including|includes|such as|for example|e\.g\.)\b/i)[0];
  const ref = /\bnot (?:an?|the)\s+((?:[A-Z][A-Za-z'’\-]*)(?:\s+[A-Z][A-Za-z'’\-]*)*)/.exec(head);
  if (ref && depth < 3) {
    const other = definitionFor(ref[1], defs.filter((d) => d !== def));
    if (other) {
      const o = allowed(other, defs, attr, depth + 1);
      if (!o.values) return { values: null, via: other };
      return { values: new Set(attr.values.map((v) => v.id).filter((v) => !o.values!.has(v))), via: other };
    }
  }
  const vals = valuesIn(head, attr);
  return { values: vals.size === 1 ? vals : null, via: null };
}

/** What the household reported for an attribute: the latest report wins over an earlier different one only when the
 * household corrected it ("actually", "sorry", "not ..."); otherwise two different reports conflict. */
export function reportedValue(attr: Attribute, reported: Reported[]): { value: string | null; conflict: boolean; words: string | null; keys: string[] } {
  const hits = reported.map((r) => ({ r, v: attr.context.test(r.words) ? valuesIn(r.words, attr) : new Set<string>() })).filter((x) => x.v.size);
  if (!hits.length) return { value: null, conflict: false, words: null, keys: [] };
  const turns = [...new Set(hits.map((h) => h.r.turn))].sort((a, b) => a - b);
  const last = hits.filter((h) => h.r.turn === turns.at(-1));
  const lastVals = new Set(last.flatMap((h) => [...h.v]));
  const earlier = new Set(hits.filter((h) => h.r.turn !== turns.at(-1)).flatMap((h) => [...h.v]));
  const differs = [...earlier].some((v) => !lastVals.has(v));
  if (lastVals.size !== 1 || (differs && !last.some((h) => h.r.cue))) return { value: null, conflict: true, words: hits.map((h) => h.r.words).join(" / "), keys: [...new Set(hits.map((h) => h.r.key).filter((k): k is string => !!k))] };
  const value = [...lastVals][0];
  const support = hits.filter((h) => h.v.size === 1 && h.v.has(value) && (h.r.turn === turns.at(-1) || !differs));
  return { value, conflict: false, words: support.at(-1)!.r.words, keys: [...new Set(support.map((h) => h.r.key).filter((k): k is string => !!k))] };
}

export type Applicability =
  | { status: "unconstrained"; definition: Definition | null }
  | { status: "consistent" | "inconsistent" | "unresolved"; definition: Definition; via: Definition | null; attribute: Attribute; allowed: string[]; reported: { value: string | null; conflict: boolean; words: string | null; keys: string[] }; why: string };

export function applicabilityOf(benefit: string, defs: Definition[], reported: Reported[]): Applicability {
  const def = definitionFor(benefit, defs);
  if (!def) return { status: "unconstrained", definition: null };
  for (const attr of ATTRIBUTES) {
    const a = allowed(def, defs, attr);
    if (!a.values) continue;
    const r = reportedValue(attr, reported);
    const want = [...a.values];
    const by = `the document defines it as “${def.text}”${a.via ? ` (and “${a.via.text}”)` : ""}`;
    if (!r.value) return { status: "unresolved", definition: def, via: a.via, attribute: attr, allowed: want, reported: r, why: r.conflict ? `the household's reports differ on ${attr.label} (${r.words}); ${by}` : `${by}, and the household has not said ${attr.label}` };
    const fits = a.values.has(r.value);
    return { status: fits ? "consistent" : "inconsistent", definition: def, via: a.via, attribute: attr, allowed: want, reported: r,
      why: `${by}; the household reported ${attr.said(r.value)} (“${r.words}”)${fits ? "" : `, which is not ${want.map((v) => attr.said(v)).join(" or ")}`}` };
  }
  return { status: "unconstrained", definition: def };
}
