/**
 * Round 6: "How much premium do I pay?", "What do we pay in premiums a year
 * altogether?", "What's our insurance cost per month?" -- answered from the
 * premium evidence on file (lib/policies/premium-summary.ts), one line per
 * premium component with the page it is printed on, a total that is plain
 * addition of those lines, and every policy with no premium on file named
 * rather than silently counted as zero. Only premiums printed in a current
 * (not deleted) document of this household are used.
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { formatMoney } from "@/lib/format/currency";
import { summarisePremiums, type PremiumItem } from "@/lib/policies/premium-summary";
import type { ClaimPerson } from "@/lib/claims/person";
import type { ChatCitation } from "@/types";
import { documentsByPerson, noPoliciesSentence, personName } from "./household-status";

export const PREMIUM_QUESTION = /\bpremiums?\b|\bhow much (?:do|does|am|are|will) (?:i|we|he|she|they|[a-z]+(?: [a-z]+)?) (?:pay|paying|spend|spending)\b|\b(?:insurance|policy|policies|premium|total|monthly|yearly|annual) (?:costs?|spend(?:ing)?|bills?|payments?)\b|\bcost (?:of|for) (?:my|our|the|his|her|their) (?:insurance|polic\w*|plans?)\b|\bhow much (?:is|are) (?:my|our|his|her|their) (?:insurance|polic\w*|plans?)\b/i;
export function isPremiumQuestion(question: string) {
  return PREMIUM_QUESTION.test(question) && !/\b(?:claim\w*|payouts?|reimburs\w*|grace period|waiver|refund\w*|legal|sue)\b/i.test(question);
}

function money(amount: number, currency: string) { const text = formatMoney(amount, currency); return Number.isInteger(Math.round(amount * 100) / 100) ? text.replace(/\.00$/, "") : text; }
const r2 = (v: number) => Math.round(v * 100) / 100;

type Line = { item: PremiumItem; docId: string | null; docName: string | null; page: number | null; role: string | null; insurer?: string | null };

export async function premiumAnswer(args: { accountId: string; people: ClaimPerson[]; question: string }) {
  const perPerson: { person: ClaimPerson; lines: Line[]; missing: string[]; annual: number; cash: number | null; medisave: number | null; currency: string }[] = [];
  for (const person of args.people) {
    const summary = await summarisePremiums(args.accountId, person);
    const ids = summary.items.map((i) => i.id);
    const sources = ids.length ? (await query<{ id: string; doc_id: string | null; page: number | null; product_name: string | null; role: string | null; insurer: string | null; active: boolean }>(
      `SELECT pr.id::text AS id,coalesce(pr.source_document_id,pr.policy_id)::text AS doc_id,pr.source_page AS page,p.product_name,p.document_role AS role,p.insurer,
              (p.id IS NOT NULL) AS active
         FROM premium_records pr LEFT JOIN policies p ON p.id=coalesce(pr.source_document_id,pr.policy_id) AND p.account_id=pr.account_id AND ${activePredicate("p")} AND p.superseded_at IS NULL
        WHERE pr.account_id=$1 AND pr.id::text=ANY($2::text[])`, [args.accountId, ids])).rows : [];
    const byId = new Map(sources.map((s) => [s.id, s]));
    // A premium printed in a deleted document is not on file any more.
    const lines: Line[] = [];
    for (const item of summary.items.filter((i) => byId.get(i.id)?.active)) {
      const src = byId.get(item.id)!;
      let page = src.page;
      // A premium read from the schedule carries no page: it is the page that prints it.
      if (src.doc_id) {
        const pages = (await query<{ page_number: number; text: string }>(`SELECT page_number,text FROM policy_pages WHERE account_id=$1 AND policy_id::text=$2 ORDER BY page_number`, [args.accountId, src.doc_id])).rows;
        const printedOn = (p: { text: string }) => { const digits = p.text.replace(/(\d),(?=\d{3}\b)/g, "$1"); return new RegExp("(?:^|[^\\d.])" + String(item.amount).replace(".", "\\.") + "(?:\\.0+)?(?![\\d])").test(digits); };
        if (!page || !pages.some((p) => p.page_number === page && printedOn(p))) page = pages.find(printedOn)?.page_number ?? page;
      }
      lines.push({ item, docId: src.doc_id, docName: src.product_name, page, role: src.role, insurer: src.insurer });
    }
    const currency = lines[0]?.item.currency ?? "SGD";
    const sameCurrency = lines.every((l) => l.item.currency === currency);
    const annual = sameCurrency ? r2(lines.reduce((n, l) => n + l.item.annual, 0)) : NaN;
    const cash = lines.some((l) => l.item.cashAnnual != null) ? r2(lines.reduce((n, l) => n + (l.item.cashAnnual ?? l.item.annual), 0)) : null;
    const medisave = lines.some((l) => l.item.medisaveAnnual != null) ? r2(lines.reduce((n, l) => n + (l.item.medisaveAnnual ?? 0), 0)) : null;
    perPerson.push({ person, lines, missing: summary.missing, annual, cash, medisave, currency });
  }
  const withPremiums = perPerson.filter((p) => p.lines.length);
  const citations: ChatCitation[] = [];
  const details: string[] = [];
  const cite = (l: Line) => {
    if (!l.docId || !l.page) return;
    if (!citations.some((c) => c.policyId === l.docId && c.pageStart === l.page))
      citations.push({ chunkId: "premium:" + l.item.id, policyId: l.docId, policyName: l.docName ?? l.item.product_name ?? "Policy document", insurer: l.insurer ?? undefined, pageStart: l.page, pageEnd: l.page,
        evidenceLabel: /renewal/.test(l.role ?? "") ? "Renewal notice" : "Your policy document" });
  };
  const itemText = (l: Line) => {
    const i = l.item, name = i.product_name ?? l.docName ?? "A policy";
    const split = i.medisaveAnnual != null && i.cashAnnual != null ? " — " + money(i.medisaveAnnual, i.currency) + " from MediSave and " + money(i.cashAnnual, i.currency) + " in cash"
      : i.cashAnnual != null ? " in cash" : "";
    const where = l.page ? " (" + (/renewal/.test(l.role ?? "") ? "renewal notice, " : "") + "page " + l.page + ")" : "";
    const from = i.period_start && i.period_start.slice(0, 10) > new Date().toISOString().slice(0, 10) ? ", from " + new Date(i.period_start.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
    return name + ": " + money(i.annual, i.currency) + " a year" + split + from + where + ".";
  };
  const isSelf = (p: ClaimPerson) => /^self$/i.test(p.relationship ?? "");
  const family = args.people.length > 1;
  let summary: string;
  if (!withPremiums.length && !family) {
    // Nobody can pay a premium on a document DearPolicy could not read: say that instead.
    const docs = (await documentsByPerson(args.accountId, args.people).catch(() => new Map())).get(args.people[0].id) ?? [];
    if (!docs.some((d: { status: string }) => d.status === "ready")) return { summary: noPoliciesSentence(args.people[0], docs), details, citations, handled: true };
  }
  if (!withPremiums.length) {
    summary = family ? "No premium amounts are printed in the documents on file for your household, so DearPolicy can’t total them. A renewal notice or premium receipt shows the premium; upload one and ask again."
      : "No premium amount is printed in the documents on file for " + (isSelf(args.people[0]) ? "you" : personName(args.people[0])) + ". A renewal notice or premium receipt shows it; upload one and ask again.";
  } else if (!family) {
    const p = withPremiums[0];
    for (const l of p.lines) { details.push(itemText(l)); cite(l); }
    const today = new Date().toISOString().slice(0, 10);
    const starts = [...new Set(p.lines.map((l) => l.item.period_start?.slice(0, 10) ?? ""))];
    const future = starts.length === 1 && starts[0] > today ? new Date(starts[0] + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null;
    summary = (future ? "From " + future + ", " : "") + (isSelf(p.person) ? (future ? "you pay" : "You pay") : personName(p.person) + " pays") + " " + money(p.annual, p.currency) + " a year in premiums" +
" — about " + money(r2(p.annual / 12), p.currency) + " a month." +
      (p.cash != null && p.medisave != null ? " Of that, " + money(p.cash, p.currency) + " is paid in cash and " + money(p.medisave, p.currency) + " from MediSave." : "");
  } else {
    const currency = withPremiums[0].currency;
    const total = r2(withPremiums.reduce((n, p) => n + p.annual, 0));
    for (const p of withPremiums) {
      details.push(personName(p.person) + ": " + money(p.annual, p.currency) + " a year (" + p.lines.map((l) => (l.item.product_name ?? l.docName ?? "a policy") + " " + money(l.item.annual, l.item.currency)).join(", ") + ").");
      for (const l of p.lines) cite(l);
    }
    summary = "Your household pays " + money(total, currency) + " a year in premiums — about " + money(r2(total / 12), currency) + " a month — from the premiums printed in the documents on file.";
  }
  const missing = [...new Set(perPerson.flatMap((p) => p.missing))];
  if (missing.length && withPremiums.length) details.push("Not included: " + missing.slice(0, 4).join(", ") + (missing.length > 4 ? " and " + (missing.length - 4) + " more" : "") + " — no premium is printed in the documents on file for " + (missing.length === 1 ? "it" : "them") + ".");
  return { summary, details, citations, handled: true };
}
