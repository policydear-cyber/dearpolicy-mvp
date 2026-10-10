/**
 * Whole-answer consistency (round 8), shared by the rag2-live and ingest-live checkers. EVERY sentence of what the
 * household sees -- the composed answer, its details and any fallback prose -- is checked against the expected facts,
 * so a correct amount in one sentence cannot hide a wrong one next to it:
 *   1. every money figure stated is one the expected facts (or the household's own messages) contain;
 *   2. every date stated is one the expected facts (or the household's own messages) contain;
 *   3. a placeholder where a figure belongs ("a set amount", "[amount]") fails when the facts DO give figures;
 *   4. an uncertainty statement about a date or an amount ("the effective date is not confirmed") fails when the facts
 *      DO give one -- the uncertainty is contradicted, not honest;
 *   5. a superseded figure (a schedule amount an amendment replaced) stated as current fails unless the sentence marks
 *      it as past / replaced; after the amendment document was REMOVED, the old figure passes only when the answer says
 *      an amendment was removed and the current amount may differ.
 * The patterns in 3-5 are flagged only when the expected facts contradict them. No AI judge.
 */
export type Superseded = { old: number; new: number; label?: string };
export type Facts = { figures: Set<number>; dates: Set<string>; dayMonths: Set<string>; superseded: Superseded[]; amendmentRemoved?: boolean };
export type SentenceCheck = { name: string; ok: boolean; detail: string };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
/** Money amounts written with a currency mark: S$1,500 / $150 / SGD 80 (not percentages, days or ages). */
export function moneyValues(text: string): number[] {
  return [...String(text ?? "").matchAll(/(?:S\$|SGD\s?|US\$|\$)\s?(\d[\d,]*(?:\.\d{1,2})?)(?![\d,]*\s?%)/gi)].map((m) => Number(m[1].replace(/,/g, ""))).filter((n) => Number.isFinite(n));
}
/** Calendar dates: "1 July 2026", "01 Jul 2026", "July 1, 2026", "31/01/2027", "2026-07-01"; a day and month with no year
 * ("14 March") is returned without iso. */
export function datesIn(text: string): { iso: string | null; dm: string }[] {
  const out: { iso: string | null; dm: string }[] = [];
  const t = String(text ?? "");
  const mon = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;
  for (const m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?(?:,?\s+(\d{4}))?\b/gi)) {
    const d = Number(m[1]), mo = mon(m[2]); if (!mo || d < 1 || d > 31) continue;
    out.push({ iso: m[3] ? `${m[3]}-${pad(mo)}-${pad(d)}` : null, dm: `${pad(mo)}-${pad(d)}` });
  }
  for (const m of t.matchAll(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi)) {
    const mo = mon(m[1]), d = Number(m[2]); if (mo && d >= 1 && d <= 31) out.push({ iso: `${m[3]}-${pad(mo)}-${pad(d)}`, dm: `${pad(mo)}-${pad(d)}` });
  }
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) out.push({ iso: `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`, dm: `${pad(Number(m[2]))}-${pad(Number(m[1]))}` });
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.push({ iso: `${m[1]}-${m[2]}-${m[3]}`, dm: `${m[2]}-${m[3]}` });
  return out;
}
export function factsFrom(texts: string[], superseded: Superseded[] = [], amendmentRemoved = false): Facts {
  const f: Facts = { figures: new Set(), dates: new Set(), dayMonths: new Set(), superseded, amendmentRemoved };
  for (const t of texts) { for (const v of moneyValues(t)) f.figures.add(v); for (const d of datesIn(t)) { if (d.iso) f.dates.add(d.iso); f.dayMonths.add(d.dm); } }
  for (const s of superseded) { f.figures.add(s.old); f.figures.add(s.new); }
  return f;
}
/** Sentences of the visible answer (UI chrome such as "SOURCES", "Answer", "Show full assessment" dropped). */
export function visibleSentences(text: string): string[] {
  return String(text ?? "").split(/\n+/).map((l) => l.trim()).filter((l) => l && !/^(?:DearPolicy|SOURCES|NEXT STEP|Answer|Show full assessment|A FACT THAT CHANGES THIS ASSESSMENT)$/i.test(l))
    .flatMap((l) => l.split(/(?<=[.!?])\s+(?=[A-Z“"(])/)).map((s) => s.trim()).filter(Boolean);
}

export const PLACEHOLDER = /\b(?:a|an|the)\s+(?:set|certain|specified|fixed|stated|particular|given)\s+(?:amount|figure|sum|rate|limit)\b|\[(?:amount|figure|date|x)\]|\bS?\$\s?X+\b|\bX per (?:day|night)\b/i;
export const UNCERTAIN_DATE = /\b(?:effective|commencement|start|expiry|end|renewal|issue)\s+date\b[^.]{0,60}?\b(?:is|was|are|were)?\s*(?:not|isn['’]t|wasn['’]t|un)[\s-]?(?:confirmed|known|stated|shown|recorded|available|clear|specified)\b|\bno\s+(?:effective|start|expiry)\s+date\b/i;
export const UNCERTAIN_AMOUNT = /\b(?:amount|figure|rate|limit|sum)s?\b[^.]{0,40}?\b(?:is|are|was|were)\s+(?:not|un)[\s-]?(?:confirmed|known|stated|shown|specified)\b|\bamount\s+(?:isn['’]t|wasn['’]t)\s+(?:confirmed|known|stated|shown)\b/i;
export const PAST_MARKER = /\b(?:was|were|before|previous(?:ly)?|original(?:ly)?|earlier|existing|old|former(?:ly)?|replac\w*|amend\w*|revis\w*|increas\w*|raised|changed|superseded|until|prior)\b/i;
/** The answer says an amendment document was removed / is no longer on file, AND that the amount may differ. */
export const AMENDMENT_REMOVED = /\b(?:amendment|endorsement)s?\b[^.]{0,80}\b(?:removed|deleted|no longer (?:on file|available|in your (?:documents|library))|(?:is|was)n['’]t (?:on file|available) any more)\b|\b(?:removed|deleted)\b[^.]{0,60}\b(?:amendment|endorsement)/i;
export const MAY_DIFFER = /\b(?:may|might|could)\s+(?:now\s+)?(?:differ|be different|have changed|not be (?:the )?current|no longer apply|be higher|be lower)\b|\bnot (?:necessarily )?(?:the )?current (?:amount|rate|figure)\b/i;

/** Every sentence of the visible answer against the facts; `context` = the household's own messages (their figures and
 * dates may be repeated). */
export function sentenceChecks(visible: string, facts: Facts, context = ""): SentenceCheck[] {
  const out: SentenceCheck[] = [];
  const sents = visibleSentences(visible);
  const ctxFig = new Set(moneyValues(context)), ctxDates = datesIn(context);
  const fmt = (n: number) => "S$" + n.toLocaleString("en-US");
  const unknownFig: string[] = [], unknownDate: string[] = [], placeholder: string[] = [], uncertain: string[] = [], staleCurrent: string[] = [];
  const limitationStated = AMENDMENT_REMOVED.test(visible) && MAY_DIFFER.test(visible);
  for (const s of sents) {
    for (const v of moneyValues(s)) if (!facts.figures.has(v) && !ctxFig.has(v)) unknownFig.push(`${fmt(v)} in "${s.slice(0, 140)}"`);
    for (const d of datesIn(s)) {
      const known = d.iso ? facts.dates.has(d.iso) || ctxDates.some((c) => c.iso === d.iso || (!c.iso && c.dm === d.dm)) : facts.dayMonths.has(d.dm) || ctxDates.some((c) => c.dm === d.dm);
      if (!known) unknownDate.push(`${d.iso ?? d.dm} in "${s.slice(0, 140)}"`);
    }
    if (facts.figures.size && PLACEHOLDER.test(s)) placeholder.push(s.slice(0, 160));
    if ((facts.dates.size && UNCERTAIN_DATE.test(s)) || (facts.figures.size && UNCERTAIN_AMOUNT.test(s))) uncertain.push(s.slice(0, 160));
    const figs = moneyValues(s);
    for (const sp of facts.superseded) {
      if (!figs.includes(sp.old) || figs.includes(sp.new)) continue;
      const ok = facts.amendmentRemoved ? limitationStated || PAST_MARKER.test(s) && /\b(?:before|until|prior)\b/i.test(s) : PAST_MARKER.test(s);
      if (!ok) staleCurrent.push(`${fmt(sp.old)}${sp.label ? ` (${sp.label})` : ""} as current in "${s.slice(0, 140)}"${facts.amendmentRemoved ? " -- the amendment was removed and the answer does not say the current amount may differ" : ` -- replaced by ${fmt(sp.new)}`}`);
    }
  }
  out.push({ name: "every figure stated is one the expected facts give", ok: !unknownFig.length, detail: unknownFig.join("; ") });
  out.push({ name: "every date stated is one the expected facts give", ok: !unknownDate.length, detail: unknownDate.join("; ") });
  out.push({ name: "no placeholder where the documents give a figure", ok: !placeholder.length, detail: placeholder.map((x) => `"${x}"`).join("; ") });
  out.push({ name: "no uncertainty the expected facts contradict", ok: !uncertain.length, detail: uncertain.map((x) => `"${x}"`).join("; ") });
  out.push({ name: "no superseded figure presented as current", ok: !staleCurrent.length, detail: staleCurrent.join("; ") });
  return out;
}
