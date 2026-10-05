/**
 * Round 7 chat robustness: the Round 6 rubbish detectors (scripts/r6/detectors.ts, unchanged), with four
 * readings this battery's documents need and the Round 6 households never printed. Each drops one kind of
 * hit only when the text shows it is not rubbish:
 *   - "cut off: dangling word" on "... 3.85% p.a." (an abbreviation, not a sentence cut short);
 *   - "count grammar" on a figure that is part of a reference ("G-KFL-2026-118 plan", "PMI-AH-60231 day");
 *   - "zero amount" for a nil the document itself prints ("Premium payable in cash S$0.00");
 *   - "amount not in any document / the cited source" for a total the same text shows as its sum
 *     ("S$1,506 a year: S$612.00 + 3 × S$298.00"), every term printed in the household's documents.
 */
import * as R6 from "../r6/detectors";
import type { ChatAnswer } from "@/types";

export const visibleFields = R6.visibleFields;
export const moneyIn = R6.moneyIn;
export type Hit = R6.Hit;
const round2 = (v: number) => Math.round(v * 100) / 100;

/** "S$612.00 + 3 × S$298.00": each explicit sum a text shows, with its terms' amounts and its total. */
export function shownSums(text: string): { total: number; terms: number[] }[] {
  const term = String.raw`(?:\d+\s?[×x]\s?)?(?:S\$|US\$)\s?\d[\d,]*(?:\.\d+)?`;
  const out: { total: number; terms: number[] }[] = [];
  for (const m of text.matchAll(new RegExp(term + String.raw`(?:\s?\+\s?` + term + ")+", "g"))) {
    const parts = [...m[0].matchAll(/(?:(\d+)\s?[×x]\s?)?(?:S\$|US\$)\s?(\d[\d,]*(?:\.\d+)?)/g)].map((t) => ({ n: Number(t[1] ?? 1), v: Number(t[2].replace(/,/g, "")) }));
    out.push({ total: round2(parts.reduce((s, p) => s + p.n * p.v, 0)), terms: parts.map((p) => round2(p.v)) });
  }
  return out;
}

export function detect(...args: Parameters<typeof R6.detect>): R6.Hit[] {
  const g = args[2];
  const pagesText = [...g.pages.values()].join("\n");
  const printed = new Set(R6.numbersIn(pagesText).map(round2));
  return R6.detect(...args).filter((h) => {
    if (h.rule === "cut off: dangling word" && /\b(?:p\.a|e\.g|i\.e|a\.m|p\.m)\.?\s*$/i.test(h.text)) return false;
    if (h.rule === "count grammar") {
      const m = h.text.match(/«([^»]+)»\s(.*)$/s);
      if (m) { const at = m[2].indexOf(m[1]); if (at > 0 && /[-\w]/.test(m[2].charAt(at - 1))) return false; }
    }
    if (h.rule === "zero amount" && /0\.00/.test(h.text) && /(?:S\$|US\$|\$)\s?0\.00\b/.test(pagesText) && !/a year|a month|in premiums/.test(h.text)) return false;
    if (/^amount not in (?:any document|the cited source)$/.test(h.rule)) {
      const v = Number(h.text.match(/: S\$([\d.]+) — /)?.[1] ?? NaN);
      const text = h.text.split(" — ").slice(1).join(" — ");
      if (Number.isFinite(v) && shownSums(text).some((x) => x.total === round2(v) && x.terms.every((t) => printed.has(t)))) return false;
    }
    return true;
  });
}
