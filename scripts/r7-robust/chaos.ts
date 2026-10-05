/**
 * Round 7 chaos phases, on the application's own chaos stand-ins (test-only:
 * lib/ai/chaos-model.ts, DEARPOLICY_DETERMINISTIC_MODEL=chaos-<seed>, for the
 * chat roles; lib/ai/chaos-ingest.ts, ingest-chaos-<seed>, for document reading).
 *
 *   ingestion  documents are READ under the fuzz (structured extraction and
 *              OCR of the scanned page): invented amounts, a US-dollar figure
 *              relabelled S$, strangers named as insured, instructions planted
 *              in notes and in the scanned page's text, broken JSON, refusals.
 *              Nothing unprinted, mis-currencied or foreign may be stored as
 *              verified, and the chat on that household must stay clean.
 *   chat       the battery is replayed with interpretation, passage reading,
 *              relevance, judgement and narration misbehaving. No injected
 *              text may reach a household and every rubbish detector stays 0.
 */
import type { ChatAnswer } from "@/types";
import type { Hit } from "../r6/detectors";
import type { LoadedHousehold } from "./household";

type VisibleFields = (a: ChatAnswer) => { where: string; text: string }[];

/** Text only the chaos model writes (scripts/r8/detectors.ts, lib/ai/chaos-ingest.ts): any of it on screen is a leak. */
export async function canaryDetector(visibleFields: VisibleFields) {
  const { CHAOS_SENTINELS } = await import("../r8/detectors");
  const { INGEST_SENTINEL_PATTERN } = await import("@/lib/ai/chaos-ingest");
  const all: [string, RegExp][] = [...CHAOS_SENTINELS, ["document-reading chaos", INGEST_SENTINEL_PATTERN]];
  return (a: ChatAnswer, userText: string): Hit[] => {
    const hits: Hit[] = [];
    for (const f of visibleFields(a)) for (const [name, re] of all) {
      const m = f.text.match(re);
      if (m && !userText.includes(m[0])) hits.push({ rule: "chaos model output reached the household: " + name, text: f.where + ": " + f.text.slice(0, 200) });
    }
    return hits;
  };
}

/** A premium figure printed in the document in this currency (OCR-lenient sign). */
export function premiumPrinted(amount: number | null, currency: string | null, text: string): boolean {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return false;
  const flat = text.replace(/\s+/g, " ");
  const whole = Math.trunc(amount), cents = Math.round((amount - whole) * 100);
  const digits = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, "[,.]?");
  const tail = cents ? "[.,]" + String(cents).padStart(2, "0") : "(?:[.,]00)?";
  const usd = /^(?:USD|US\$)$/i.test(currency ?? "");
  const marker = usd ? "(?:US\\$|USD|US \\$)" : "(?:(?<![A-Z])S\\$|\\$\\$|5\\$|SS|SGD|(?<![A-Z$])\\$)";
  if (new RegExp(marker + "\\s?" + digits + tail + "(?![\\d])", "i").test(flat)) return true;
  return !usd && !/\bUS\$|\bUSD\b/i.test(flat) && new RegExp("(?<![\\d.,])" + digits + tail + "(?![\\d])").test(flat);
}

const moneyText = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
/** Is this amount printed on these pages in this currency? */
export function printedWithCurrency(pages: string, amount: number, currency: string | null): boolean {
  const flat = pages.replace(/\s+/g, " ");
  const forms = [moneyText(amount), amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","), String(amount)];
  const usd = (currency ?? "").toUpperCase() === "USD";
  return forms.some((f) => {
    const esc = f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const us = new RegExp("(?:US\\$|USD)\\s?" + esc + "(?![\\d,])").test(flat);
    const sg = new RegExp("(?:(?<!U)S\\$|SGD|(?<![A-Z])\\$)\\s?" + esc + "(?![\\d,])").test(flat);
    return usd ? us : sg;
  });
}

/** What the household's database stores as verified, checked against what its pages print. */
export async function ingestionInvariants(db: { query: <T>(q: string, p?: unknown[]) => Promise<{ rows: T[] }> }, hh: LoadedHousehold): Promise<string[]> {
  const out: string[] = [];
  const pages = new Map<string, string>();
  for (const r of (await db.query<{ policy_id: string; text: string }>("SELECT policy_id::text AS policy_id,string_agg(text,E'\\n' ORDER BY page_number) AS text FROM policy_pages WHERE account_id=$1 GROUP BY 1", [hh.account])).rows) pages.set(r.policy_id, r.text);
  for (const c of (await db.query<{ policy_id: string; amount: string | null; currency: string | null; category: string }>(
    "SELECT policy_id::text AS policy_id,amount::text,currency,category FROM policy_coverages WHERE account_id=$1 AND (confirmed OR evidence_verified) AND amount IS NOT NULL", [hh.account])).rows) {
    if (!printedWithCurrency(pages.get(c.policy_id) ?? "", Number(c.amount), c.currency)) out.push(hh.id + ": verified cover " + c.category + " " + c.currency + " " + c.amount + " is not printed with that currency");
  }
  for (const p of (await db.query<{ doc: string; amount: string; currency: string | null }>(
    "SELECT coalesce(source_document_id,policy_id)::text AS doc,amount::text,currency FROM premium_records WHERE account_id=$1", [hh.account])).rows) {
    if (!premiumPrinted(Number(p.amount), p.currency, pages.get(p.doc) ?? "")) out.push(hh.id + ": premium " + p.currency + " " + p.amount + " is not printed with that currency");
  }
  for (const b of (await db.query<{ policy_id: string; benefit_name: string; formula_value: string | null; currency: string | null }>(
    "SELECT policy_id::text AS policy_id,benefit_name,formula_value::text,currency FROM policy_benefits WHERE account_id=$1 AND formula_kind IN ('fixed','expense_cap','daily') AND formula_value IS NOT NULL AND currency IS NOT NULL", [hh.account])).rows) {
    if (!printedWithCurrency(pages.get(b.policy_id) ?? "", Number(b.formula_value), b.currency)) out.push(hh.id + ": benefit " + b.benefit_name + " " + b.currency + " " + b.formula_value + " is not printed with that currency");
  }
  const members = (await db.query<{ n: string }>("SELECT count(*)::text AS n FROM family_members WHERE account_id=$1", [hh.account])).rows[0];
  if (Number(members?.n) !== hh.manifest.members.length) out.push(hh.id + ": reading created or removed household members (" + members?.n + ")");
  return out;
}
