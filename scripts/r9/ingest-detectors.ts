/**
 * Round 9 detectors: what document reading may have planted, as it shows up in
 * an answer. Run on every answer IN ADDITION to the Round 6/7/8 ones -- under
 * the normal stand-in (must never fire) and on a household whose documents were
 * read under the ingestion chaos stand-in (lib/ai/chaos-ingest.ts). Pure.
 */
import { readFileSync } from "node:fs";
import type { ChatAnswer } from "@/types";
import { visibleFields, type Hit } from "../r6/detectors";
import { INGEST_SENTINEL_PATTERN } from "@/lib/ai/chaos-ingest";
import { amountAppears } from "@/lib/documents/evidence";
import type { Snapshot } from "./audit";

/** Pages of the household's documents, per policy and page number (the text layer: no model wrote it). */
export type R9Truth = { pageText: Map<string, Map<number, string>> };

const MONEY = /(?:S\$|SGD\s?|US\$|RM\s?)\s?(\d[\d,]*(?:\.\d+)?)/g;
/** The figure as printed (commas aside), or the same amount in another printed form (S$1,000 / 1000.00). */
function figureOnPage(page: string, raw: string) {
  const digits = raw.replace(/,/g, "");
  const flat = page.replace(/(\d),(?=\d{3}\b)/g, "$1");
  if (new RegExp("(?<![\\d.])" + digits.replace(".", "\\.") + "(?![\\d])").test(flat)) return true;
  const value = Number(digits);
  return Number.isFinite(value) && amountAppears(page, value, "money");
}
export function detectR9(a: ChatAnswer, g: R9Truth): Hit[] {
  const hits: Hit[] = [];
  const hit = (rule: string, text: string) => hits.push({ rule, text: text.slice(0, 260) });
  const fields = visibleFields(a);
  for (const f of fields) { const m = f.text.match(INGEST_SENTINEL_PATTERN); if (m) hit("planted fact leaked from document reading", f.where + ": " + f.text); }
  // A figure shown with "(page N)" must be printed on page N of a document the answer cites (or of any household document when it cites none).
  const cited = (a.citations ?? []).map((c) => c.policyId).filter((id): id is string => !!id);
  const docs = cited.length ? cited : [...g.pageText.keys()];
  for (const f of fields) {
    const pages = [...f.text.matchAll(/\bpages?\s+(\d{1,3})\b/gi)].map((m) => Number(m[1]));
    if (pages.length !== 1) continue;
    for (const m of f.text.matchAll(MONEY)) {
      const value = Number(m[1].replace(/,/g, ""));
      if (!Number.isFinite(value) || value <= 0) continue;
      const onPage = docs.some((id) => figureOnPage(g.pageText.get(id)?.get(pages[0]) ?? "", m[1]));
      if (!onPage) hit("figure not on the page it cites", f.where + ": " + m[0] + " (page " + pages[0] + ") — " + f.text);
    }
  }
  return hits;
}

/** Page text per policy, from the database (the text layer is never written by a model in these fixtures). */
export async function pageTruth(db: { query: <T>(q: string, p?: unknown[]) => Promise<{ rows: T[] }> }, account: string): Promise<R9Truth> {
  const pageText = new Map<string, Map<number, string>>();
  for (const r of (await db.query<{ policy_id: string; page_number: number; text: string }>("SELECT policy_id::text AS policy_id,page_number,text FROM policy_pages WHERE account_id=$1", [account])).rows) {
    if (!pageText.has(r.policy_id)) pageText.set(r.policy_id, new Map());
    pageText.get(r.policy_id)!.set(Number(r.page_number), r.text);
  }
  return { pageText };
}

/** Under R9_INGEST_SEED the database holds what a broken reader stored; the detectors'
 * notion of who holds which document, and which premiums exist, comes from the same
 * household read by the well-behaved stand-in (R9_PRISTINE). Documents the pristine
 * read never saw (seeded by a suite afterwards) keep what the database says. */
export function pristineOverride<T extends { premiumFigures: number[]; personPolicies: Map<string, Set<string>> }>(g: T): T {
  const file = process.env.R9_INGEST_SEED ? process.env.R9_PRISTINE : undefined;
  if (!file) return g;
  const snap = JSON.parse(readFileSync(file, "utf8")) as Snapshot;
  const known = new Set(Object.keys(snap.files));
  const personPolicies = new Map<string, Set<string>>();
  for (const [member, set] of g.personPolicies) for (const id of set) if (!known.has(id)) (personPolicies.get(member) ?? personPolicies.set(member, new Set()).get(member)!).add(id);
  for (const l of snap.links) (personPolicies.get(String(l.member)) ?? personPolicies.set(String(l.member), new Set()).get(String(l.member))!).add(String(l.policy));
  const printed = (notes: unknown) => [...String(notes ?? "").matchAll(/(?:S\$|SGD\s?)\s?(\d[\d,]*(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
  const premiumFigures = [...new Set(snap.premiums.flatMap((p) => [Number(p.amount), ...printed(p.notes)]).filter(Number.isFinite))];
  return { ...g, premiumFigures, personPolicies };
}
