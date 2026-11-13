"use client";

import Link from "next/link";
import { useId, useState } from "react";
import type { LearnSearchEntry } from "@/lib/learn/content";

/**
 * Library search: filters the static index in the page, as you type. No network, nothing stored or sent.
 * A word matches when it appears in the entry, or is one typing slip away from one of its longer words
 * (so a misspelt scheme or term name still finds its article).
 */

function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** True when a and b differ by at most one inserted, deleted or changed letter. */
function oneSlip(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, slips = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++slips > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return slips + (a.length - i) + (b.length - j) <= 1;
}

/** Small everyday words a household types ("my dad died", "medisave for parents") that carry no topic. */
const STOPWORDS = new Set(["a", "an", "the", "my", "our", "his", "her", "their", "i", "me", "we", "is", "are", "was", "it", "of", "for", "to", "in", "on", "and", "or", "do", "does", "did", "how", "what", "can", "with", "at"]);

export function searchLearn(entries: LearnSearchEntry[], query: string, max = 8): LearnSearchEntry[] {
  const all = words(query);
  const content = all.filter((w) => !STOPWORDS.has(w));
  // A query made only of small words ("what is") still searches as typed.
  const wanted = content.length ? content : all;
  if (!wanted.length) return [];
  const scored = entries.map((entry) => {
    const hay = entry.text.toLowerCase();
    const titleHay = entry.title.toLowerCase();
    const tokens = words(entry.text);
    let score = 0;
    for (const w of wanted) {
      if (hay.includes(w)) score += titleHay.includes(w) ? 3 : 1;
      else if (w.length >= 5 && tokens.some((t) => t.length >= 5 && oneSlip(w, t))) score += 1;
      else return { entry, score: 0 };
    }
    return { entry, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, max).map((s) => s.entry);
}

export function LearnSearch({ entries }: { entries: LearnSearchEntry[] }) {
  const [query, setQuery] = useState("");
  const id = useId();
  const results = searchLearn(entries, query);
  const typed = query.trim().length > 0;
  return (
    <div className="learn-search" role="search">
      <label htmlFor={id}>Search the library</label>
      <input id={id} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. deductible, rider" autoComplete="off" data-testid="learn-search" />
      <div aria-live="polite">
        {typed ? (results.length ? (
          <ul className="learn-results" data-testid="learn-results">
            {results.map((r) => (
              <li key={r.href}><Link href={r.href}><strong>{r.title}</strong><span>{r.group}</span></Link></li>
            ))}
          </ul>
        ) : <p className="note" data-testid="learn-no-results">Nothing in the library matches that yet. Try another word, or <Link className="text-link" href="/chat">ask DearPolicy</Link> about your own documents.</p>) : null}
      </div>
    </div>
  );
}
