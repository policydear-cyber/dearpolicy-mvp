/**
 * Round 11: what a question takes for granted, checked against the documents
 * before it is answered -- "my Shield pays 100% right?", "my plan is the
 * private one right?", "my life insurance is $800k right?", "the PA pays
 * $2,000 for any fracture, correct?". The answer leads with a plain "No --"
 * (or "Yes --") taken from the printed lines, never a guess.
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import type { ChatCitation } from "@/types";
import { piecesOf } from "./printed-lines";
import { citeLine } from "./answer-verification";

export type Premise = { kind: "full_pay" | "tier" | "private_full" | null; rewrite: string | null; figures: number[]; tier: string | null };
const CONFIRMING = /\b(?:right|correct|isn['’]?t it|is it|yes or no|true|am i right|ya|yah|hor|izzit)\s*\??\s*$|^\s*(?:so\s+)?(?:my|our|his|her|their|\w+['’]s)\b[^?]{0,80}\b(?:is|are|pays?|covers?)\b[^?]*\?\s*$/i;

export function premiseOf(question: string): Premise {
  const q = question.trim();
  const none: Premise = { kind: null, rewrite: null, figures: [], tier: null };
  if (!CONFIRMING.test(q)) return none;
  const figures = [...q.matchAll(/(?:S\$|SGD\s?|\$)\s?(\d[\d,]*(?:\.\d+)?)\s*(k|m|mil|million)?\b/gi)].map((m) => Number(m[1].replace(/,/g, "")) * (/^k$/i.test(m[2] ?? "") ? 1000 : /^m/i.test(m[2] ?? "") ? 1_000_000 : 1)).filter((n) => n > 0);
  // "Papa's Shield covers private hospital fully right?": what a private stay is cut to (pro-ration).
  if (/\bprivate\b/i.test(q) && /\b100\s?%|\b(?:fully|in full|everything|the whole (?:bill|amount)|all of (?:it|the bill))\b/i.test(q))
    return { kind: "private_full", rewrite: "what is the pro-ration if I stay in a private hospital?", figures: [], tier: "private" };
  if (/\b100\s?%|\b(?:fully|in full|everything|the whole (?:bill|amount)|all of (?:it|the bill)|every cent)\b/i.test(q) && /\b(?:shield|hospital|bill|medical|ward)\b/i.test(q) && !/\bprivate\b[^?]*\bfully\b/i.test(q))
    return { kind: "full_pay", rewrite: "what is the deductible and co-insurance on the hospital plan?", figures: [], tier: null };
  const tier = q.match(/\b(private(?: hospital)?|class a|a ward|b1|b2|c ward)\b/i)?.[1] ?? null;
  if (tier && /\bplan\b/i.test(q) && /\b(?:is|are)\b/i.test(q) && !/\bcovers?\b[^?]*\bfully\b/i.test(q))
    return { kind: "tier", rewrite: "which ward class is my plan?", figures, tier };
  return { ...none, figures };
}

/** The sentence that answers what was taken for granted, from the answer just built. */
export function premiseLead(p: Premise, details: string[]): string | null {
  if (p.kind === "full_pay") {
    if (!details.some((d) => /\bdeductible\b/i.test(d))) return null;
    return "No — the plan doesn’t pay the whole bill. You pay the deductible first, then a share of the rest (co-insurance), as your documents print below; a rider may pay part of that share.";
  }
  if (p.kind === "private_full") {
    const pct = details.map((d) => d.match(/pro-?ration[^:—]*private hospital[^:]*:\s*(?:pro-ration factor of )?(\d{1,3})\s?%/i)?.[1]).find(Boolean);
    if (!pct) return null;
    return "No — a stay in a private hospital is not paid in full on this plan: the bill is first cut to " + pct + "% (pro-ration), and the deductible and co-insurance still apply.";
  }
  if (p.kind === "tier" && p.tier) {
    const column = details.map((d) => d.match(/the “([^”]+)” column of the benefit table applies/)?.[1]).find(Boolean);
    const plan = details.map((d) => d.match(/Plan:\s*([^—(]+?)(?:\s*\(|\s*—|,|$)/)?.[1]?.trim()).find(Boolean);
    if (!column) return null;
    const asked = p.tier.toLowerCase().replace(/ hospital$/, "");
    const same = column.toLowerCase().includes(asked) || (plan ?? "").toLowerCase().includes(asked);
    return same ? "Yes — your plan’s “" + column + "” column is the one that applies." : "No — " + (plan ? "your plan is the " + plan + ", so " : "") + "the “" + column + "” column of the benefit table applies, not " + (/^private/i.test(asked) ? "a private hospital plan" : asked) + ".";
  }
  return null;
}

/** A figure the person stated that the answer does not show: where the documents print it, if anywhere. */
export async function figurePremise(args: { accountId: string; question: string; figures: number[]; answerText: string; peopleIds: string[]; selfIds: string[] }): Promise<{ lead: string; detail: string | null; citation: ChatCitation | null } | null> {
  const shown = args.answerText.replace(/,/g, "");
  const figure = args.figures.find((n) => !new RegExp("(?<![\\d.])" + String(n) + "(?:\\.00)?(?![\\d])").test(shown));
  if (figure == null) return null;
  const rows = (await query<{ id: string; name: string; page: number; text: string; owners: string[] | null; owner_ids: string[] | null }>(
    `SELECT p.id::text id, coalesce(p.product_name, p.original_filename) name, pp.page_number page, pp.text,
            array_agg(DISTINCT coalesce(nullif(fm.preferred_name,''), fm.display_name)) FILTER (WHERE fm.id IS NOT NULL) owners,
            array_agg(DISTINCT fm.id::text) FILTER (WHERE fm.id IS NOT NULL) owner_ids
       FROM policy_pages pp JOIN policies p ON p.id=pp.policy_id AND p.account_id=pp.account_id
       LEFT JOIN policy_members pm ON pm.policy_id=p.id AND pm.account_id=p.account_id LEFT JOIN family_members fm ON fm.id=pm.family_member_id
      WHERE pp.account_id=$1 AND ${activePredicate("p")} AND p.processing_status='ready' AND p.superseded_at IS NULL
      GROUP BY p.id, p.product_name, p.original_filename, pp.page_number, pp.text ORDER BY p.id, pp.page_number`, [args.accountId]).catch(() => ({ rows: [] as never[] }))).rows;
  const printed = new RegExp("(?:S\\$|SGD\\s?)\\s?" + figure.toLocaleString("en-US").replace(/[.,]/g, "\\$&") + "(?:\\.00)?(?![\\d,])");
  // The line about what was asked ("fracture"), not any line that happens to print the same figure.
  const asked = new Set(args.question.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4).map((w) => w.slice(0, 5)));
  const overlap = (line: string) => line.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4 && asked.has(w.slice(0, 5))).length;
  // A printed line on its own (a schedule row) before a joined-up sentence of several rows.
  const linesOf = (text: string) => { const raw = text.split(/\r?\n/).map((l) => l.replace(/\t+/g, " · ").replace(/\s+/g, " ").trim()).filter((l) => l.length >= 6 && l.length <= 240); return raw.some((l) => printed.test(l)) ? raw : piecesOf(text); };
  const hits = rows.flatMap((r) => linesOf(r.text).filter((l) => printed.test(l)).map((line) => ({ ...r, line, score: overlap(line) }))).sort((a, b) => b.score - a.score);
  const own = hits.find((h) => h.score > 0 && (h.owner_ids ?? []).some((o) => args.peopleIds.includes(o)));
  const other = own ? null : hits.find((h) => (h.owners ?? []).length);
  // The quoted line's figure is read from its own page (resolved on that page at save time).
  for (const h of [own, other]) if (h) citeLine(null, h.name + " — “" + h.line.replace(/[.;\s]+$/, "") + "” (page " + h.page + ").", { policyId: h.id, pageStart: h.page });
  // Gate R17: the household's own figure is never restated as what a policy pays or holds; the printed line below
  // (cited to its page) states it, and a lead that repeats it says it is theirs, exactly as they wrote it.
  if (own) return { lead: "Not quite — that figure is not what it pays for this in general; the line that prints it is first below.", detail: own.name + " — “" + own.line.replace(/[.;\s]+$/, "") + "” (page " + own.page + ").",
    citation: { chunkId: "page:" + own.id + ":" + own.page, policyId: own.id, policyName: own.name, pageStart: own.page, pageEnd: own.page } };
  const whose = args.peopleIds.length === 1 && args.selfIds.includes(args.peopleIds[0]) ? "your own" : "these";
  if (other) return { lead: "No — that figure is on " + (other.owners ?? []).join(" and ") + "’s " + other.name + ", not on " + whose + " policies.", detail: other.name + " — “" + other.line.replace(/[.;\s]+$/, "") + "” (page " + other.page + ").",
    citation: { chunkId: "page:" + other.id + ":" + other.page, policyId: other.id, policyName: other.name, pageStart: other.page, pageEnd: other.page } };
  const raw = [...args.question.matchAll(/(?:S\$|SGD\s?|\$)\s?(\d[\d,]*(?:\.\d+)?)\s*(k|m|mil|million)?\b/gi)].find((m) => Number(m[1].replace(/,/g, "")) * (/^k$/i.test(m[2] ?? "") ? 1000 : /^m/i.test(m[2] ?? "") ? 1_000_000 : 1) === figure)?.[0]?.trim();
  return { lead: "Your documents don’t show " + (raw ? "the " + raw + " you mentioned" : "that figure") + " for this. Here is what they do print:", detail: null, citation: null };
}
