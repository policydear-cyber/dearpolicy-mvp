/**
 * Round 7 detectors, run on every answer IN ADDITION to the Round 6 ones
 * (scripts/r6/detectors.ts). Everything household-specific comes from the
 * ground truth the runner reads out of the fixture database, never from a
 * hard-coded household. Pure functions; no I/O.
 */
import type { ChatAnswer } from "@/types";
import { visibleFields, type Hit } from "../r6/detectors";

export type Status = { policyId: string; name: string; state: "lapsed" | "expired"; date: string };
export type R7Truth = {
  /** Page text of every active document, by policy id. */
  pages: Map<string, string>;
  /** Lapsed or ended documents of this household, with the date printed. */
  inactive: Status[];
  /** Every person: their full and preferred names. */
  people: { id: string; names: string[] }[];
  /** Today, YYYY-MM-DD, in Singapore. */
  today: string;
};
export type R7Turn = { question: string; userText: string; expectPerson?: string | null; short?: boolean };

const PROSE = /^(summary|details|nextSteps|question\[|question\.why|claim\[\d+\]\.reason|planQuestion)/;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DATE_RE = /\b(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})\b/g;
const iso = (d: string, m: string, y: string) => y + "-" + String(MONTHS.indexOf(m.toLowerCase()) + 1).padStart(2, "0") + "-" + d.padStart(2, "0");
const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z])/);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function detectR7(a: ChatAnswer, t: R7Turn, g: R7Truth): Hit[] {
  const hits: Hit[] = [];
  const hit = (rule: string, text: string) => hits.push({ rule, text: text.slice(0, 260) });
  const fields = visibleFields(a);
  const prose = fields.filter((f) => PROSE.test(f.where));
  const cited = new Set((a.citations ?? []).map((c) => c.policyId));
  const citedText = [...cited].map((id) => g.pages.get(id) ?? "").join("\n");
  const allPages = [...g.pages.values()].join("\n");

  for (const f of prose) {
    for (const s of sentencesOf(f.text)) {
      // ------------------------------------------------ a percentage with nothing it is a percentage of
      for (const m of s.matchAll(/(\d+(?:\.\d+)?)%/g)) {
        const around = s.slice(Math.max(0, (m.index ?? 0) - 80), (m.index ?? 0) + 90);
        const based = /%\s*(?:of|on)\b|co-?insurance|co-?pay|pro-?ration|discount|no-claim|interest|return|assumed|premiums? paid|rider pays|you pay|a year|per (?:year|annum)/i.test(around);
        if (!based) hit("percentage without its base", f.where + ": " + s);
        // ------------------------------------------------ a percentage no document prints
        if (!allPages.includes(m[1] + "%") && !t.userText.includes(m[1] + "%")) hit("percentage not in any document", f.where + ": " + s);
        else if (cited.size && !citedText.includes(m[1] + "%") && !t.userText.includes(m[1] + "%")) hit("percentage not in the cited source", f.where + ": " + s);
      }
      // ------------------------------------------------ a past date described as still to come
      for (const m of s.matchAll(DATE_RE)) {
        const when = iso(m[1], m[2], m[3]);
        if (when >= g.today) continue;
        const after = s.slice((m.index ?? 0) - 60 < 0 ? 0 : (m.index ?? 0) - 60, (m.index ?? 0));
        if (/\b(?:will (?:renew|end|expire|lapse)|renews on|is due on|falls due on|next (?:renewal|premium)|upcoming|expires on|ends on|runs (?:to|until))\s*$/i.test(after)
          && !/\b(?:expired|ended|lapsed|was|were|had|stopped|has ended)\b/i.test(s)) hit("past date described as upcoming", f.where + ": " + s);
      }
      // ------------------------------------------------ a lapsed or ended policy presented as current
      for (const p of g.inactive) {
        if (!new RegExp("\\b" + esc(p.name) + "\\b", "i").test(s)) continue;
        if (/\b(?:is (?:active|in force|valid|current)|still (?:covers|in force|active|valid)|covers you|currently covers)\b/i.test(s) && !/\b(?:lapsed|expired|ended|stopped|no longer|not (?:active|in force|valid|current))\b/i.test(s))
          hit("inactive policy presented as active", f.where + ": " + s);
        if (p.state === "lapsed" && /\b(?:has )?expired\b/i.test(s) && !/lapsed/i.test(s)) hit("lapsed policy described as expired", f.where + ": " + s);
      }
    }
  }
  // A portfolio row for an ended policy with nothing in the answer saying so.
  for (const item of a.portfolioItems ?? []) {
    const p = g.inactive.find((x) => x.name === item.policyName);
    if (p && !fields.some((f) => new RegExp(esc(p.name) + "[^.]*\\b(?:lapsed|expired|ended)\\b|\\b(?:lapsed|expired|ended)\\b[^.]*" + esc(p.name), "i").test(f.text)))
      hit("inactive policy presented as active", "portfolio lists " + p.name + " without saying it " + (p.state === "lapsed" ? "lapsed" : "ended"));
  }
  // ------------------------------------------------ the answer names the wrong person as its subject
  if (t.expectPerson) {
    const expected = g.people.find((p) => p.id === t.expectPerson);
    for (const other of g.people) {
      if (other.id === t.expectPerson) continue;
      for (const name of other.names) {
        if (t.userText.toLowerCase().includes(name.toLowerCase())) continue;
        if (new RegExp("^Here is what " + esc(name) + "[’']s documents|^" + esc(name) + "[’']s (?:documents|policies) ", "i").test(a.summary) && !(expected?.names ?? []).some((n) => n === name))
          hit("person-name mismatch", "expected " + (expected?.names[0] ?? t.expectPerson) + ": " + a.summary.slice(0, 160));
      }
    }
  }
  // ------------------------------------------------ names mangled (apostrophes, hyphens, bin/binte)
  for (const p of g.people) for (const name of p.names) {
    for (const token of name.split(/\s+/).filter((x) => /['’-]/.test(x))) {
      // "D'Souza-Reyes" must not become "DSouza-Reyes", "D Souza-Reyes" or "D'Souza Reyes".
      const variants = new Set([token.replace(/['’]/g, ""), token.replace(/['’]/g, " "), token.replace(/-/g, " "), token.replace(/['’-]/g, ""), token.replace(/['’-]/g, " ")]);
      variants.delete(token);
      const said = t.userText.toLowerCase();
      for (const v of variants) {
        if (said.includes(v.toLowerCase())) continue;
        const re = new RegExp("(?<![\\w'’-])" + esc(v) + "(?![\\w'’-])", "i");
        for (const f of fields) if (re.test(f.text)) hit("name mangled", f.where + ": " + f.text);
      }
    }
  }
  for (const f of prose) if (/\b(?:bin|binte|binti)\s*(?:[.,;:)]|$)/i.test(f.text)) hit("name mangled", f.where + ": " + f.text);
  // ------------------------------------------------ non-Latin text mangled or invented
  for (const f of fields) {
    if (/�|Ã[\x80-\xBF]|â€|Â[\xA0-\xBF]|[-]/.test(f.text)) hit("non-Latin text mangled", f.where + ": " + f.text);
    for (const m of f.text.matchAll(/[㐀-鿿]{2,}/g)) if (!allPages.includes(m[0]) && !t.userText.includes(m[0])) hit("non-Latin text not in any document", f.where + ": " + m[0]);
  }
  // ------------------------------------------------ document furniture and private details shown as cover
  for (const f of fields.filter((x) => /^(?:details|summary|limit)/.test(x.where))) {
    // A date line is the answer when a date was asked ("as of when?").
    const furniture = /\b(?:when|date|dated|as of)\b/i.test(t.question) ? /\b(?:Employer|Insured helper|Insured address|Payment method|Policyholder and life assured)\s*:/i : /\b(?:Employer|Insured helper|Insured address|Payment method|Policyholder and life assured|Statement date|Date of issue)\s*:/i;
    if (furniture.test(f.text)) hit("document furniture shown as an answer", f.where + ": " + f.text);
    if (/\baccount ending \d{3,4}\b|\bGIRO from your\b/i.test(f.text)) hit("payment account detail shown", f.where + ": " + f.text);
  }
  // ------------------------------------------------ longer than the question needs
  const summaryLen = (a.summary ?? "").length;
  const detailCount = (a.details ?? []).length;
  const broad = /\b(?:everything|every|all|overview|list|what (?:does|do) (?:everyone|my family|we)|family|everyone|compare|total|altogether|what (?:am i|is \w+) (?:insured|covered)|what (?:do|does) [^?]{1,40} (?:have|cover)|tell me about|what insurance|what policies)\b/i.test(t.question)
    // "and his accident plan?": a whole plan asked about.
    || /^(?:and |what about |how about |now )?(?:my|his|her|their|the|our)\s+[\w ]{0,25}\b(?:plan|policy|insurance)\s*\??$/i.test(t.question.trim());
  if (summaryLen > 520) hit("answer longer than needed", "summary " + summaryLen + " chars: " + a.summary.slice(0, 120));
  if (!broad && detailCount > 10) hit("answer longer than needed", detailCount + " detail lines for: " + t.question);
  return hits;
}

/** The same answer given to different questions in one conversation. */
export function repeatedAnswer(prev: { question: string; key: string } | null, question: string, a: ChatAnswer): Hit | null {
  if (!prev || !(a.citations ?? []).length) return null;
  const key = a.summary + "\n" + a.details.join("\n");
  const norm = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // The same "not in your documents" to two questions is honest; the same facts are fine when they answer
  // what the new question asks (every word it turns on is in the answer).
  if (/\bdidn[’']t find|\bcould not find|\bnot in (?:the|your) documents/i.test(a.summary) && !a.details.length) return null;
  const said = key.toLowerCase();
  const asked = (question.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !/^(?:what|which|when|does|have|that|this|with|much|about|there|their|they|them|will|would|could|should|from|your|mine|also|then|still|again|tell|show|give|know|okay|thanks|please|need|it's|whats|is|the)$/.test(w));
  if (asked.length && asked.every((w) => said.includes(w.slice(0, 5)))) return null;
  if (prev.key === key && norm(prev.question) !== norm(question)) return { rule: "same answer to a different question", text: "«" + prev.question + "» and «" + question + "»: " + a.summary.slice(0, 160) };
  return null;
}
