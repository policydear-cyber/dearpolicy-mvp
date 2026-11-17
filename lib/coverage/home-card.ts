/** Home's protection cards (DC 16-17 Nov): each card says Covered, with its amount only when the cover rests on ONE
 * confirmed figure. Where the dashboard adds several lines or policies into a total (app/api/dashboard/route.ts), Home
 * shows no total: different schedules are not added together without explicit support (project rule, 17 Nov); the card
 * names the covers instead and its Coverage page shows each amount. Every card names what pays (the policy, or how many),
 * so a card with no amount never reads as an empty box. This file never builds or shows a figure. The grid picks its column count so the last row is never one card alone
 * when another count avoids it. Pure; used by app/page.tsx. Works for any household and any insurer.
 *   Test: scripts/coverage/home-card-test.ts */

import { isMachineFilename } from "@/lib/policies/document-name";

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export type HomeCardInput = { policyNames?: string[] | null; parts?: { name?: string | null }[] | null; count?: number | null; sources?: string[] | null };

/** Words that name only a kind of cover, a benefit or a document, never which policy it is ("Business", "Death Benefit",
 * "Travel insurance"): a name made only of them says nothing on a card (coordinator 17 Nov). An allow-list; "Group",
 * "Term" and brand words are not on it, so "Group Term Life" stays a name. */
const GENERIC = new Set(["a", "an", "the", "and", "of", "for", "&", "death", "benefit", "benefits", "cover", "covers", "coverage", "insurance",
  "travel", "plan", "policy", "business", "basic", "rider", "critical", "illness", "accident", "accidental", "personal", "hospital", "hospitalisation",
  "hospitalization", "medical", "outpatient", "total", "permanent", "disability", "income", "cash", "early", "savings", "investment", "trip",
  "schedule", "certificate", "summary", "wording", "booklet", "document", "owned", "main", "supplementary", "protection"]);
/** A name a person can read as a policy's name: not a file or system code ("SGGRP_COI_APP", "1105 CD-594 COI_SAF"), and
 * not made only of generic words. The dashboard picks each source's first such name (app/api/dashboard/route.ts). */
export function readablePolicyName(name: string | null | undefined): boolean {
  const n = clean(name);
  // A file's name ("scan0012.pdf", "IMG 4471") or a system code ("SGGRP_COI_APP") is no policy's name (TE PR 525 F3).
  if (!n || /_/.test(n) || /\.(?:pdf|jpe?g|png|heic|gif|tiff?|docx?|xlsx?)$/i.test(n) || isMachineFilename(n)) return false;
  const words = n.toLowerCase().split(/[^\p{L}\p{N}&]+/u).filter(Boolean);
  // A word of 4 or more letters, or two of 3, is needed: "CD-594", "EJ7" or "COI-2026-0012" is a code.
  const lettered = words.filter((w) => /^\p{L}{3,}$/u.test(w));
  if (!lettered.some((w) => w.length >= 4) && lettered.length < 2) return false;
  return words.some((w) => !GENERIC.has(w));
}

/** Which of several covers a name means, for naming its document (app/api/dashboard/route.ts): the one cover whose own
 * name is exactly that name, else the one whose name is the longest start of it ("Travel Plus" for "Travel Plus Annual",
 * never "Travel"). When two covers fit equally, it names none (fails closed): a card never names a policy that may not be
 * behind it (Critic PR 525 M1). Returns the index, or -1. */
export function pickCoverByName(label: string, covers: (string | null | undefined)[][]): number {
  const k = clean(label).toLowerCase();
  if (!k) return -1;
  const names = covers.map((list) => list.map((n) => clean(n).toLowerCase()).filter(Boolean));
  const exact = names.flatMap((list, i) => (list.includes(k) ? [i] : []));
  if (exact.length) return exact.length === 1 ? exact[0] : -1;
  let best = -1, bestLen = 0, tie = false;
  names.forEach((list, i) => {
    const len = Math.max(0, ...list.filter((n) => k.startsWith(n + " ") || k.startsWith(n + "\u00a0") || k.startsWith(n + " \u00b7")).map((n) => n.length));
    if (!len) return;
    if (len > bestLen) { best = i; bestLen = len; tie = false; } else if (len === bestLen) tie = true;
  });
  return tie ? -1 : best;
}

/** An all-capitals name set in title case keeps every word of up to 4 letters as written, so initials are never
 * lowercased ("IRAS", "AMEX", "ACE", "US"); only the short words of insurance products and joining words below read as words
 * ("LONG TERM CARE PLAN" -> "Long Term Care Plan"). Words of 5 letters or more read as words (TE PR 525 R2). */
const SHORT_WORDS = new Set(["co", "st", "pro", "max", "new", "one", "two", "six", "ten", "all", "top", "my", "our", "your", "key", "own", "pay", "day",
  "car", "pet", "big", "fit", "kid", "kids", "eye", "leg", "plus", "care", "life", "term", "long", "gold", "home", "cash", "plan", "trip", "star", "safe",
  "wise", "link", "flex", "best", "rich", "pure", "year", "fund", "save", "good", "sure", "more", "only", "lady", "baby", "free", "full", "high", "mega",
  "easy", "ward", "bond", "bank", "shop", "help", "mind", "well", "back", "risk", "land", "fast", "step", "goal", "luke", "men", "work", "with", "card",
  "lite", "mini", "maxi", "gain", "grow", "keep", "self", "next", "duo", "solo", "true", "home", "fly", "go", "up", "fire", "auto", "bike", "boat",
  "maid", "dog", "cat", "body", "bone", "head", "hand", "foot", "baby", "teen", "silver", "basic", "whole", "cover"]);
const LOWER_WORDS = new Set(["and", "of", "the", "for", "to", "in", "on", "at", "by", "or"]);
const titleWord = (w: string, first: boolean): string => {
  const lower = w.toLowerCase();
  if (!first && LOWER_WORDS.has(lower)) return lower;
  if (w.length <= 4 && !SHORT_WORDS.has(lower) && !LOWER_WORDS.has(lower)) return w;
  return lower[0].toUpperCase() + lower.slice(1);
};
/** A policy's name as a card shows it: an all-capitals name in title case ("MINDEF & MHA GROUP INSURANCE SCHEME" ->
 * "Mindef & MHA Group Insurance Scheme"), and a long name without its trailing codes in brackets ("PruFlexiCash Protection
 * Plus (7th Series) (EJ7)" -> "PruFlexiCash Protection Plus"), so it fits two lines and is never cut mid-name. A name
 * in mixed case keeps the insurer's own capitals. */
export function homePolicyName(name: string): string {
  let n = clean(name);
  if (n.length > 26) { const bare = n.replace(/(?:\s*\([^()]*\))+\s*$/, "").trim(); if (bare.length >= 4) n = bare; }
  if (/\p{Lu}{2}/u.test(n) && !/\p{Ll}/u.test(n)) {
    // Each word on its own, and each part of a hyphenated word ("CO-OPERATIVE" -> "Co-Operative"). An apostrophe after
    // one letter starts a name ("O'BRIEN" -> "O'Brien"); after more it is a possessive ("ANDREW'S" -> "Andrew's").
    n = n.replace(/\p{L}+(?:['’]\p{L}+)?/gu, (w: string, i: number) => {
      const [head, tail] = w.split(/['’]/);
      const mark = w.slice(head.length, head.length + 1);
      if (tail === undefined) return titleWord(head, i === 0);
      if (head.length === 1) return head + mark + titleWord(tail, false);
      const h = titleWord(head, i === 0);
      // A possessive follows its word: "ANDREW'S" -> "Andrew's", but "MEN'S" stays as written when "MEN" does.
      return h + mark + (h === head ? tail : tail.toLowerCase());
    });
  }
  // A short code with a hyphen ("(H-2026)") never breaks at its hyphen (TE PR 525 F5).
  return n.replace(/(^|[\s(])([^\s()-]{1,6})-([^\s()-]{1,6})(?=$|[\s)])/g, "$1$2\u2011$3");
}

/** Whether Home may show the card's amount: only when the cover rests on one line, so the figure is never a sum of
 * several schedules, policies or benefits. */
export const homeCardShowsAmount = (c: { count?: number | null; parts?: unknown[] | null; policyNames?: string[] | null; reviewRequired?: boolean | null }) =>
  // reviewRequired: the dashboard kept one of a policy's several lines for this cover (TE PR 519 A7), so the figure is a part.
  c.reviewRequired !== true && Math.max(c.count ?? 0, c.parts?.length ?? 0, new Set((c.policyNames ?? []).map((n) => clean(n).toLowerCase()).filter(Boolean)).size) <= 1;

/** An amount as Home prints it: the period's short words stay with the word after them ("a\u00a0month"), so a period
 * wraps as a unit and never leaves "month" alone on a line (TE PR 519 A9). The figure itself has no space to break. */
export const homeAmountText = (amount: string) => amount.replace(/\b(a|an|per|each) (?=\S)/gi, "$1\u00a0");

/** What pays for this cover, in a few words: one policy's name, two names joined, or "N policies"; one policy with several
 * benefits for this cover says how many ("Group Term Life · 2 covers"). Null when nothing is named and there is one line. */
/** About what two lines of a card's source line hold on a narrow card: longer joined names are not joined. */
const HOME_SOURCE_CHARS = 38;
export function homeCardSource(c: HomeCardInput): string | null {
  const seen = new Map<string, string>();
  // The policies behind the cover, by their documents' names, where the dashboard gives them; else its cover names, less
  // any made only of generic words ("Death Benefit") while another names the policy.
  let pool = (c.sources?.length ? c.sources : [...(c.policyNames ?? []), ...(c.parts ?? []).map((p) => p?.name ?? "")]).map((n) => clean(n));
  // A cover name that names no policy ("Business", "Death Benefit", a file code) is never shown (TE PR 525 F3).
  if (!c.sources?.length) pool = pool.filter(readablePolicyName);
  for (const raw of pool) {
    const name = homePolicyName(raw);
    // "Policy" and "Owned policy" are the dashboard's stand-ins for a cover with no product name: they name nothing.
    if (!name || /^(?:owned\s+)?policy$/i.test(name)) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }
  const names = [...seen.values()];
  const lines = Math.max(c.count ?? 0, c.parts?.length ?? 0);
  if (names.length <= 1 && lines > 1) return names.length ? `${names[0]} \u00b7 ${lines} covers` : `${lines} covers`;
  if (!names.length) return null;
  if (names.length === 1) return names[0];
  // Two names fit a card's lines together only when short; else the first and how many more, so no name is cut.
  if (names.length === 2) return names[0].length + names[1].length <= HOME_SOURCE_CHARS ? `${names[0]} + ${names[1]}` : names[0].length <= HOME_SOURCE_CHARS ? `${names[0]} +\u00a01\u00a0more` : "2 policies";
  return `${names.length} policies`;
}

/** Columns for a wide Home grid of n cards: 3 or 4, whichever fills the last row best, 3 on a tie. 7 cards: 4 + 3, not
 * 3 + 3 + 1. Up to 3 cards keep 3 columns, so one card stays card-sized. A narrow screen uses 2 columns, where an odd
 * last card spans the row (app/globals.css). */
export function homeGridColumns(n: number): number {
  if (n <= 3) return 3;
  let best = 3, bestFill = -1;
  for (const cols of [3, 4]) {
    const last = n % cols || cols;
    const fill = last / cols;
    if (fill > bestFill + 1e-9) { best = cols; bestFill = fill; }
  }
  return best;
}
