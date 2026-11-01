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
import { amountAppears, amountPrintedWith } from "./assertions";
import { attachOperand, boundOperand, citeLine, differenceOperands, documentHashes, figuresIn, perPeriodOperand, printedRowFor, productOperand, rowBenefit, sumOperands } from "./answer-verification";
import { currenciesStatedIn } from "@/lib/claims/currency-evidence";
import { summarisePremiums, type PremiumItem } from "@/lib/policies/premium-summary";
import type { ClaimPerson } from "@/lib/claims/person";
import type { ChatCitation, ComputationOperand, FigureBinding, FigurePeriod } from "@/types";
import { documentsByPerson, noPoliciesSentence, personName } from "./household-status";
import { longDate, printedPeriodEnd, printedStatus, todayIso, type PrintedStatus } from "./policy-status";

export const PREMIUM_QUESTION = /\bpremiums?\b|\bhow much (?:do|does|did|will) (?:i|we|he|she|they|\w+) (?:need|have) to pay\b|\bhow much (?:do|does) (?:i|we|he|she|they|\w+) owe\b|\bhow much (?:do|does|am|are|will) (?:i|we|he|she|they|[a-z]+(?: [a-z]+)?) (?:pay|paying|spend|spending)\b|\b(?:insurance|policy|policies|premium|total|monthly|yearly|annual) (?:costs?|spend(?:ing)?|bills?|payments?)\b|\bcost (?:of|for) (?:my|our|the|his|her|their) (?:insurance|polic\w*|plans?)\b|\bhow much (?:is|are) (?:my|our|his|her|their) (?:insurance|polic\w*|plans?)\b/i;
export function isPremiumQuestion(question: string) {
  return (PREMIUM_QUESTION.test(question) || RANKED.test(question)) && !/\b(?:claim\w*|payouts?|reimburs\w*|grace period|waiver|refund\w*|legal|sue)\b/i.test(question)
    // "How much does SafeGuard pay if Irfan loses a thumb?" asks what a plan pays, not what is paid for it.
    // Round 9: "how much do we pay for all our insurance" is what the household pays.
    && !/(?<!\b(?:i|we) )\bpays?\s+(?:out\s+)?(?:if|for|when|on|per|towards?|each|a day|monthly)\b|\b(?:what|how much) (?:does|do|will|would) [^?]{1,40}\bpay(?: out)?\s*\??\s*$/i.test(question);
}
/** "Which policy is cheapest?", "the most expensive one": premiums compared, not advice. */
export const RANKED = /\b(?:cheapest|least expensive|most expensive|costliest|highest premium|lowest premium|costs? (?:the )?(?:most|least)|which (?:one )?costs more)\b/i;
/** A premium question about one plan or one date ("the Golden Lotus premium", "when is it due") is answered from that plan's own printed lines. */
export function premiumAboutOnePlan(question: string) {
  return /\b(?:due|owe|owing|outstanding|overdue|(?:still )?(?:need|have) to pay|still (?:pay|paying)|completed|stop paying|medisave|cash|rider|monthly premium for)\b/i.test(question)
    || /\b(?:car|motor|home|house|contents|shield|hospital|travel|accident|pa|ilp|investment|endowment|savings|critical illness|ci|life|term|helper|maid)\b[^?]{0,20}\b(?:premium|plan|policy|insurance)\b/i.test(question)
    || /\bpremium (?:for|of|on) (?:the|my|his|her|our)\b/i.test(question);
}

function money(amount: number, currency: string) { const text = formatMoney(amount, currency); return Number.isInteger(Math.round(amount * 100) / 100) ? text.replace(/\.00$/, "") : text; }
const r2 = (v: number) => Math.round(v * 100) / 100;

type Line = { item: PremiumItem; docId: string | null; docName: string | null; page: number | null; role: string | null; insurer?: string | null; policyType?: string | null;
  /** Round 16: the text of the cited page, so a line says "(page N)" only beside figures that page prints. */
  pageText?: string | null;
  /** Gate R17: the line's figures as operands bound to the rows that print them (or explicit records of how they were worked out). */
  ops?: LineOps };
type LineOps = { printed: ComputationOperand | null; total: ComputationOperand | null; annual: ComputationOperand | null; cashAnnual: ComputationOperand | null; medisaveAnnual: ComputationOperand | null };

/** Gate R17: the period a premium record's frequency states (the same reading as annualisePremium; none stated is yearly). */
function periodOf(frequency: string | null | undefined): FigurePeriod {
  const f = (frequency ?? "").toLowerCase();
  return /month/.test(f) ? "month" : /quarter/.test(f) ? "quarter" : /semi|half.?year|6 month/.test(f) ? "half_year" : /week/.test(f) ? "week" : "year";
}
/** Gate R17: a binding for `value` on the printed row of `pageText` that prints it beside `currency` -- the row `want`
 * names first, then a premium row. Null when the page prints no such row. */
function rowBinding(a: { policyId: string | null; subjectId: string; documentHash: string | null; page: number | null; pageText: string | null | undefined; value: number; currency: string; want?: RegExp; benefit?: string }): FigureBinding | null {
  if (!a.policyId || !a.page || !a.pageText || !(a.value > 0)) return null;
  const rows = a.pageText.split(/\n/).map((l) => l.trim()).filter((l) => l && amountAppears(a.value, l) && amountPrintedWith(a.value, a.currency, l) !== "other");
  const pick = (a.want ? rows.find((l) => a.want!.test(l)) : undefined) ?? rows.find((l) => /\bpremiums?\b/i.test(l)) ?? rows[0];
  if (!pick) return null;
  const r = printedRowFor(pick, a.value, a.pageText);
  if (!r) return null;
  let benefit = a.benefit ?? rowBenefit(r);
  // A part of a premium printed on its own row under the premium's heading ("Premium payable" / "Cash payable
  // S$362.00"): the row is named with the heading it is printed under.
  if (!a.benefit && !/\bpremiums?\b/i.test(r.line + " " + benefit)) {
    const all = a.pageText.split(/\n/).map((l) => l.trim());
    const at = all.indexOf(r.line);
    const heading = at > 0 ? all.slice(Math.max(0, at - 6), at).reverse().find((l) => /\bpremiums?\b/i.test(l)) : undefined;
    if (heading) benefit = heading.replace(/(?:S\$|SGD|US\$|USD)?\s?\d[\d,]*(?:\.\d+)?/g, " ").replace(/[\t|:]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) + " — " + benefit;
  }
  return { policyId: a.policyId, subjectId: a.subjectId, benefit, documentHash: a.documentHash, pageStart: a.page, pageEnd: a.page, passage: r.line, column: r.column };
}
/** Gate R17: the operands of one premium line -- the printed amount, the whole premium, its yearly figure and its
 * MediSave / cash split -- each bound to the row that prints it, or an explicit sum, difference or per-period record. */
function lineOps(l: Line, subjectId: string, documentHash: string | null): LineOps {
  const i = l.item, period = periodOf(i.frequency);
  const bound = (value: number | null, want?: RegExp) => { if (value == null) return null; const b = rowBinding({ policyId: l.docId, subjectId, documentHash, page: l.page, pageText: l.pageText, value, currency: i.currency, want }); return b ? boundOperand(value, i.currency, period, "premium", b) : null; };
  const printed = bound(i.amount);
  const medisave = i.medisave != null ? bound(i.medisave, /medisave/i) : null;
  const total = Math.abs(i.total - i.amount) < 0.005 ? printed : bound(i.total, /\btotal\b|\bpremium\b/i) ?? sumOperands([printed, medisave]);
  const cash = i.cash == null ? null : Math.abs(i.cash - i.amount) < 0.005 ? printed : bound(i.cash, /\bcash\b/i) ?? differenceOperands(total, medisave);
  return { printed, total, annual: perPeriodOperand(total, "year"), cashAnnual: perPeriodOperand(cash, "year"), medisaveAnnual: perPeriodOperand(medisave, "year") };
}
/** Every money figure of `text` is printed on `page` beside its currency (a yearly figure worked out from a monthly premium is not). */
function allPrintedOn(text: string, page: string | null | undefined) {
  if (!page) return false;
  return figuresIn(text).every((f) => { const how = amountPrintedWith(f.value, f.currency, page); return how === "match" || (how === "bare" && currenciesStatedIn(page).includes(f.currency)); });
}

/** What the document behind a premium says about the policy now (lapsed, ended, in force).
 * Round 10: one read of a document's pages and dates per answer -- a household
 * total used to re-read the same pages for every premium line of every person. */
type Sibling = { id: string; number: string; product_name: string | null; role: string | null; insurer: string | null; pages: { page: number; text: string }[] };
type DocMemo = { pages: Map<string, Promise<{ page: number; text: string }[]>>; dates: Map<string, Promise<{ expiry: string | null; start: string | null }>>; siblings?: Promise<Sibling[]> };
const newDocMemo = (): DocMemo => ({ pages: new Map(), dates: new Map() });
const normalNumber = (n: string | null | undefined) => (n ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Round 16: the documents of policies that have more than one document on file (a schedule and its renewal notice),
 * with their pages -- one read per answer. */
function siblingDocs(accountId: string, memo: DocMemo): Promise<Sibling[]> {
  memo.siblings ??= query<{ id: string; num: string; product_name: string | null; role: string | null; insurer: string | null; page_number: number | null; text: string | null }>(
    `WITH d AS (SELECT p.id, regexp_replace(upper(coalesce(p.policy_number,'')),'[^A-Z0-9]','','g') AS num, p.product_name, p.document_role AS role, p.insurer, p.created_at
                  FROM policies p WHERE p.account_id=$1 AND ${activePredicate("p")} AND p.superseded_at IS NULL AND p.processing_status='ready'),
          m AS (SELECT num FROM d WHERE num<>'' GROUP BY num HAVING count(*)>1)
     SELECT d.id::text AS id, d.num, d.product_name, d.role, d.insurer, pp.page_number, pp.text
       FROM d JOIN m ON m.num=d.num LEFT JOIN policy_pages pp ON pp.policy_id=d.id AND pp.account_id=$1 ORDER BY d.created_at, d.id, pp.page_number`, [accountId])
    .then((r) => { const out = new Map<string, Sibling>(); for (const x of r.rows) { const s = out.get(x.id) ?? out.set(x.id, { id: x.id, number: x.num, product_name: x.product_name, role: x.role, insurer: x.insurer, pages: [] }).get(x.id)!; if (x.page_number != null) s.pages.push({ page: x.page_number, text: x.text ?? "" }); } return [...out.values()]; })
    .catch(() => []);
  return memo.siblings;
}
function pagesOf(accountId: string, docId: string, memo: DocMemo) {
  let hit = memo.pages.get(docId);
  if (!hit) { hit = query<{ page_number: number; text: string }>(`SELECT page_number,text FROM policy_pages WHERE account_id=$1 AND policy_id::text=$2 ORDER BY page_number`, [accountId, docId]).then((r) => r.rows.map((x) => ({ page: x.page_number, text: x.text }))); memo.pages.set(docId, hit); }
  return hit;
}
function datesOf(accountId: string, docId: string, memo: DocMemo) {
  let hit = memo.dates.get(docId);
  if (!hit) { hit = query<{ e: string | null; s: string | null }>(`SELECT renewal_or_expiry_date::text AS e,effective_date::text AS s FROM policies WHERE account_id=$1 AND id::text=$2 AND ${activePredicate()}`, [accountId, docId]).then((r) => ({ expiry: r.rows[0]?.e ?? null, start: r.rows[0]?.s ?? null })); memo.dates.set(docId, hit); }
  return hit;
}
async function statusFor(accountId: string, docId: string, memo: DocMemo): Promise<PrintedStatus> {
  const expiry = (await datesOf(accountId, docId, memo)).expiry;
  return printedStatus(await pagesOf(accountId, docId, memo), expiry, todayIso());
}
/** The cover period the premium record itself prints, when its document prints none the reader recognises. */
function recordPeriod(item: PremiumItem) {
  return item.period_start && item.period_end ? longDate(item.period_start) + " to " + longDate(item.period_end) : null;
}
async function periodFor(accountId: string, docId: string, memo: DocMemo) {
  const end = printedPeriodEnd(await pagesOf(accountId, docId, memo));
  const start = (await datesOf(accountId, docId, memo)).start;
  return end && start ? longDate(start) + " to " + end.printed : null;
}
/** Round 7: an amount per currency, never added across currencies
 * ("S$4,250 and US$3,120"): a US-dollar premium is never shown as S$. */
function byCurrency(values: { amount: number; currency: string }[]): { currency: string; amount: number }[] {
  const out = new Map<string, number>();
  for (const v of values) out.set(v.currency, r2((out.get(v.currency) ?? 0) + v.amount));
  return [...out].map(([currency, amount]) => ({ currency, amount }));
}
function moneyList(values: { amount: number; currency: string }[], divide = 1) {
  const parts = byCurrency(values).map((v) => money(r2(v.amount / divide), v.currency));
  return parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts.at(-1) : parts[0] ?? "";
}
/** Words in a question that name one plan rather than premiums in general. */
const KIND_WORDS: [RegExp, RegExp][] = [
  [/\bilp\b|investment[- ]linked|wealth ?builder/i, /investment[- ]linked|\bilp\b/i],
  [/\bwhole[- ]life\b/i, /whole[- ]life/i],
  [/\bterm\b/i, /\bterm\b/i],
  [/\btravel\b|\btrip\b/i, /travel|trip/i],
  [/\bdental\b|\brider\b|\boutpatient\b/i, /dental|rider|outpatient/i],
  [/\b(?:shield|hospital|medical)\b/i, /(?<!care)shield|hospital|health/i],
  [/\bcritical illness\b|\bci\b/i, /critical/i],
  [/\bendowment\b|\bsaver\b/i, /endowment|saver/i],
  [/\bjoint\b/i, /joint/i],
  [/\bcareshield\b|long[- ]term care/i, /careshield|long[- ]term care/i],
  [/\buniversal life\b|\busd\b|\bus dollar/i, /universal life|usd/i],
  [/\b(?:car|motor|vehicle)\b/i, /motor|\bcar\b|drive/i],
  [/\b(?:home|house|contents)\b/i, /\bhome\b|contents|house/i],
];
const GENERIC_PRODUCT_WORD = /^(?:annual|family|group|plan|policy|cover|basic|plus|premier|benefits?|life|care|secure|protect(?:or|ion)?|insurance|premium|personal|accident|travel|health|hospital|term|whole|rider|multi|trip|worldwide|outpatient|dental|silver|gold|advantage)$/i;
const isSelfP = (p: ClaimPerson) => /^self$/i.test(p.relationship ?? "");
/** Does the question name this plan by its own distinctive name? */
function namesPlanByName(question: string, product: string) {
  const q = " " + question.toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
  return product.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w.length >= 5 && !GENERIC_PRODUCT_WORD.test(w)).some((w) => q.includes(" " + w + " "));
}
/** Does the question name this plan, by its own distinctive name or its kind? */
function namesPlan(question: string, product: string | null, type: string | null) {
  const q = " " + question.toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
  const words = (product ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w.length >= 4 && !GENERIC_PRODUCT_WORD.test(w));
  if (words.some((w) => q.includes(" " + w + " "))) return true;
  const label = (product ?? "") + " " + (type ?? "");
  return KIND_WORDS.some(([asks, is]) => asks.test(question) && is.test(label));
}

export async function premiumAnswer(args: { accountId: string; people: ClaimPerson[]; question: string }) {
  // Gate R17: every figure the answer states is attached to its sentences -- a printed row's binding, or the explicit
  // record of the sum, split or per-period restatement that produced it (lib/chat/answer-verification.ts).
  const ops: (ComputationOperand | null)[] = [];
  const res = await premiumAnswerInner(args, ops);
  for (const t of [res.summary, ...res.details]) for (const o of ops) attachOperand(null, t, o);
  return res;
}
async function premiumAnswerInner(args: { accountId: string; people: ClaimPerson[]; question: string }, ops: (ComputationOperand | null)[]) {
  const notCounted: string[] = [];
  const oneOffs: { docId: string; page: number; subjectId: string; amount: number; currency: string; pageText: string | null }[] = [];
  const memo = newDocMemo();
  // The pages that say why a premium is not counted are cited like any other.
  const uncounted: { docId: string; page: number; name: string; insurer: string | null; id: string }[] = [];
  const perPerson: { person: ClaimPerson; lines: Line[]; missing: string[]; annual: number; cash: number | null; medisave: number | null; currency: string }[] = [];
  for (const person of args.people) {
    const summary = await summarisePremiums(args.accountId, person);
    const listed = [...summary.items, ...summary.oneOff, ...summary.shortPeriod], ids = listed.map((i) => i.id);
    const sources = ids.length ? (await query<{ id: string; doc_id: string | null; page: number | null; product_name: string | null; role: string | null; insurer: string | null; policy_type: string | null; active: boolean }>(
      `SELECT pr.id::text AS id,coalesce(pr.source_document_id,pr.policy_id)::text AS doc_id,pr.source_page AS page,p.product_name,p.document_role AS role,p.insurer,p.policy_type,
              (p.id IS NOT NULL) AS active
         FROM premium_records pr LEFT JOIN policies p ON p.id=coalesce(pr.source_document_id,pr.policy_id) AND p.account_id=pr.account_id AND ${activePredicate("p")} AND p.superseded_at IS NULL
        WHERE pr.account_id=$1 AND pr.id::text=ANY($2::text[])`, [args.accountId, ids])).rows : [];
    const byId = new Map(sources.map((s) => [s.id, s]));
    // A premium printed in a deleted document is not on file any more.
    const lines: Line[] = [];
    for (const item of listed.filter((i) => byId.get(i.id)?.active)) {
      // A policy that has lapsed or ended costs nothing now; a one-off premium for a cover period is not a yearly one.
      const docId = byId.get(item.id)?.doc_id ?? null;
      const status = docId ? await statusFor(args.accountId, docId, memo) : null;
      if (status && status.state === "lapsed") { if (docId && status.page) uncounted.push({ docId, page: status.page, name: byId.get(item.id)?.product_name ?? item.product_name ?? "Policy document", insurer: byId.get(item.id)?.insurer ?? null, id: item.id }); notCounted.push((item.product_name ?? byId.get(item.id)?.product_name ?? "A policy") + " — it " + (status.state === "lapsed" ? "lapsed" : "ended") + " on " + status.printed); continue; }
      if (item.oneOff || item.shortPeriod) {
        const span = (docId ? await periodFor(args.accountId, docId, memo) : null) ?? recordPeriod(item);
        const docPages = docId ? await pagesOf(args.accountId, docId, memo) : [];
        const amountPage = docPages.find((p) => p.text.replace(/(\d),(?=\d{3}\b)/g, "$1").includes(String(item.amount)))?.page ?? byId.get(item.id)?.page ?? null;
        for (const page of new Set([amountPage, printedPeriodEnd(docPages)?.page ?? null]))
          if (docId && page) uncounted.push({ docId, page, name: byId.get(item.id)?.product_name ?? item.product_name ?? "Policy document", insurer: byId.get(item.id)?.insurer ?? null, id: item.id });
        const amount = item.currencyStated ? money(item.amount, item.currency) : formatMoney(item.amount, null);
        notCounted.push((item.product_name ?? "A policy") + (item.oneOff
          ? " — a one-off premium of " + amount + (span ? " for " + span : "") + ", not a yearly one"
          : " — a premium of " + amount + (span ? " for " + span : "") + "; no payment frequency is printed, so it is not counted as a yearly one"));
        if (docId && amountPage && item.currencyStated) oneOffs.push({ docId, page: amountPage, subjectId: person.id, amount: item.amount, currency: item.currency, pageText: docPages.find((p) => p.page === amountPage)?.text ?? null });
        continue;
      }
      const src = byId.get(item.id)!;
      let page = src.page;
      const planName = item.product_name ?? src.product_name ?? "A policy";
      // Round 16: a premium is counted only when it is a verified figure -- its record states a currency (never
      // assumed), and its document prints the amount beside that currency (or bare, under a heading that names
      // it). Anything else is listed as not included, with the reason.
      if (!item.currencyStated) {
        if (src.doc_id && page) uncounted.push({ docId: src.doc_id, page, name: src.product_name ?? planName, insurer: src.insurer, id: item.id });
        notCounted.push(planName + " — " + formatMoney(item.amount, null) + (item.frequency ? " (" + item.frequency + ")" : "") + ": the document prints no currency for it, and DearPolicy never assumes one");
        continue;
      }
      let printedHow: "match" | "other" | "bare" | "absent" = "absent";
      let pageText: string | null = null;
      // A premium read from the schedule carries no page: it is the page that prints it.
      if (src.doc_id) {
        const pages = (await pagesOf(args.accountId, src.doc_id, memo)).map((x) => ({ page_number: x.page, text: x.text }));
        // (Round 16: "86.40" prints the amount 86.4 -- a trailing zero is the same figure.)
        const printedOn = (p: { text: string }) => amountAppears(item.amount, p.text);
        const how = (p: { text: string }) => { const h = amountPrintedWith(item.amount, item.currency, p.text); return h === "bare" && currenciesStatedIn(p.text).includes(item.currency) ? "match" : h; };
        printedHow = pages.some((p) => how(p) === "match") ? "match" : pages.some((p) => how(p) === "other") ? "other" : pages.some((p) => how(p) === "bare") ? "bare" : "absent";
        if (!page || !pages.some((p) => p.page_number === page && printedOn(p))) page = pages.find(printedOn)?.page_number ?? page;
        pageText = pages.find((p) => p.page_number === page)?.text ?? null;
      }
      // The premium may be printed on another document of the same policy (a renewal notice prints the cash portion the
      // schedule does not): it is verified -- and cited -- there.
      let at = { docId: src.doc_id, name: src.product_name, role: src.role, insurer: src.insurer };
      if (printedHow !== "match" && item.policy_number) {
        const siblings = (await siblingDocs(args.accountId, memo)).filter((x) => x.id !== src.doc_id && x.number === normalNumber(item.policy_number));
        for (const sib of siblings) {
          const hit = sib.pages.find((p) => { const h = amountPrintedWith(item.amount, item.currency, p.text); return h === "match" || (h === "bare" && currenciesStatedIn(p.text).includes(item.currency)); });
          if (hit) { printedHow = "match"; at = { docId: sib.id, name: sib.product_name ?? src.product_name, role: sib.role, insurer: sib.insurer }; page = hit.page; pageText = hit.text; break; }
        }
      }
      if (printedHow !== "match") {
        if (src.doc_id && page) uncounted.push({ docId: src.doc_id, page, name: src.product_name ?? planName, insurer: src.insurer, id: item.id });
        notCounted.push(planName + " — " + money(item.amount, item.currency) + ": " + (printedHow === "other" ? "the document prints this amount in a different currency" : printedHow === "bare" ? "the document prints no currency beside this amount" : "the amount is missing from the document on file"));
        continue;
      }
      lines.push({ item, docId: at.docId, docName: at.name, page, role: at.role, insurer: at.insurer, policyType: src.policy_type, pageText });
    }
    // (Every counted line states its currency: see above.)
    const currency = lines[0]?.item.currency ?? "";
    const sameCurrency = lines.every((l) => l.item.currency === currency);
    const annual = sameCurrency ? r2(lines.reduce((n, l) => n + l.item.annual, 0)) : NaN;
    // MediSave pays Singapore-dollar premiums only; the split is of those.
    const sgd = lines.filter((l) => l.item.currency === "SGD");
    const cash = sgd.some((l) => l.item.cashAnnual != null) ? r2(sgd.reduce((n, l) => n + (l.item.cashAnnual ?? l.item.annual), 0)) : null;
    const medisave = sgd.some((l) => l.item.medisaveAnnual != null) ? r2(sgd.reduce((n, l) => n + (l.item.medisaveAnnual ?? 0), 0)) : null;
    perPerson.push({ person, lines, missing: summary.missing, annual, cash, medisave, currency });
  }
  // One policy covering two people is paid once: it is counted under the first of them.
  const seenItems = new Set<string>();
  for (const p of perPerson) { p.lines = p.lines.filter((l) => !seenItems.has(l.item.id) && !!seenItems.add(l.item.id)); p.annual = r2(p.lines.reduce((n, l) => n + l.item.annual, 0)); }
  // Gate R17: each counted line's figures, bound to the rows of the version on file that print them.
  const hashes = await documentHashes(args.accountId, [...perPerson.flatMap((p) => p.lines.map((l) => l.docId)), ...oneOffs.map((o) => o.docId)]);
  for (const p of perPerson) for (const l of p.lines) { l.ops = lineOps(l, p.person.id, l.docId ? hashes.get(l.docId) ?? null : null); ops.push(l.ops.printed, l.ops.total, l.ops.annual, l.ops.cashAnnual, l.ops.medisaveAnnual); }
  for (const o of oneOffs) { const b = rowBinding({ policyId: o.docId, subjectId: o.subjectId, documentHash: hashes.get(o.docId) ?? null, page: o.page, pageText: o.pageText, value: o.amount, currency: o.currency }); if (b) ops.push(boundOperand(o.amount, o.currency, null, "premium", b)); }
  /** The explicit sum of lines' yearly premiums (per currency), and its monthly restatement. */
  const sumLines = (lines: Line[], pick: (o: LineOps) => ComputationOperand | null = (o) => o.annual, scope: "person" | "household" = "person") => {
    for (const currency of new Set(lines.map((l) => l.item.currency))) {
      const sum = sumOperands(lines.filter((l) => l.item.currency === currency).map((l) => l.ops ? pick(l.ops) : null), scope);
      ops.push(sum, perPeriodOperand(sum, "month"));
    }
  };
  // Round 7: "What premium do we pay for Jia Hui's ILP?", "LifeShield premium
  // now", "careshield premium how much" ask about ONE plan. Answer that plan
  // -- or say plainly that no premium is printed for it -- instead of the
  // household's whole bill with other people's premiums in it.
  const missingTypes = new Map<string, string | null>();
  const allMissing = [...new Set(perPerson.flatMap((p) => p.missing))];
  if (allMissing.length) for (const r of (await query<{ product_name: string; policy_type: string | null }>(`SELECT DISTINCT product_name,policy_type FROM policies p WHERE account_id=$1 AND product_name=ANY($2::text[]) AND ${activePredicate("p")}`, [args.accountId, allMissing]).catch(() => ({ rows: [] as { product_name: string; policy_type: string | null }[] }))).rows) missingTypes.set(r.product_name, r.policy_type);
  const focusLines = perPerson.flatMap((p) => p.lines.filter((l) => namesPlan(args.question, l.item.product_name ?? l.docName, l.policyType ?? null)).map((l) => ({ p, l })));
  const focusMissing = perPerson.flatMap((p) => p.missing.filter((m) => namesPlan(args.question, m, missingTypes.get(m) ?? null)).map((m) => ({ p, m })));
  // ("Which one costs more, car or home?" compares plans: that is the ranked answer below, not one plan's premium.)
  if ((focusLines.length || focusMissing.length) && !RANKED.test(args.question)) {
    const citations: ChatCitation[] = [];
    const details: string[] = [];
    const lines: string[] = [];
    for (const { p, l } of focusLines) {
      const i = l.item, name = i.product_name ?? l.docName ?? "the policy";
      const split = i.medisaveAnnual != null && i.cashAnnual != null ? " (" + money(i.medisaveAnnual, i.currency) + " from MediSave and " + money(i.cashAnnual, i.currency) + " in cash)" : "";
      const said = (args.people.length > 1 ? personName(p.person) + "’s " : "") + name + " premium is " + money(i.annual, i.currency) + " a year" + split;
      lines.push(said + (l.page && allPrintedOn(said, l.pageText) ? " (page " + l.page + ")" : "") + ".");
      if (l.docId && l.page && !citations.some((c) => c.policyId === l.docId && c.pageStart === l.page))
        citations.push({ chunkId: "premium:" + i.id, policyId: l.docId, policyName: l.docName ?? name, insurer: l.insurer ?? undefined, pageStart: l.page, pageEnd: l.page, evidenceLabel: /renewal/.test(l.role ?? "") ? "Renewal notice" : "Your policy document" });
    }
    const missingText = focusMissing.map(({ p, m }) => (args.people.length > 1 ? personName(p.person) + "’s " : "") + m);
    if (missingText.length) lines.push("No premium is printed in the documents on file for " + (missingText.length > 1 ? missingText.slice(0, -1).join(", ") + " and " + missingText.at(-1) : missingText[0]) +
      ", so DearPolicy can’t say what it costs. The insurer’s premium notice or a statement that shows the premium would.");
    return { summary: lines.join(" "), details, citations, handled: true };
  }
  // A plan that was deleted from the household's documents has no premium on file.
  const deleted = (await query<{ product_name: string; policy_type: string | null }>(`SELECT DISTINCT product_name,policy_type FROM policies WHERE account_id=$1 AND lifecycle_state<>'active' AND product_name IS NOT NULL`, [args.accountId]).catch(() => ({ rows: [] as { product_name: string; policy_type: string | null }[] }))).rows
    .filter((d) => namesPlanByName(args.question, d.product_name));
  if (!RANKED.test(args.question) && deleted.length) return { summary: "There is no " + deleted[0].product_name + " policy on file — it was removed from your documents — so DearPolicy has no premium for it.", details: [] as string[], citations: [] as ChatCitation[], handled: true };
  // A document the question names that has no premium line (a group booklet,
  // a receipt): its own pages answer it, not the household's total.
  const named = (await query<{ product_name: string; policy_type: string | null; document_role: string | null }>(`SELECT DISTINCT product_name,policy_type,document_role FROM policies p WHERE account_id=$1 AND ${activePredicate("p")} AND product_name IS NOT NULL`, [args.accountId]).catch(() => ({ rows: [] as { product_name: string; policy_type: string | null; document_role: string | null }[] }))).rows
    .filter((d) => namesPlan(args.question, d.product_name, d.policy_type) || (/\breceipt\b/i.test(args.question) && d.document_role === "premium_receipt") || (/\b(?:ghs|gtl|gpa|group|company|employer|dependants?)\b/i.test(args.question) && /group/i.test(d.policy_type ?? "")));
  if (!RANKED.test(args.question) && named.length) return { summary: "", details: [] as string[], citations: [] as ChatCitation[], handled: false };
  // A kind of plan asked about that no document on file is ("Jia Hui's ILP"
  // when its statement could not be read): say so, not the household total.
  const askedKind = KIND_WORDS.find(([asks]) => asks.test(args.question));
  if (!RANKED.test(args.question) && askedKind) return { summary: "No premium for that plan is printed in the documents on file" + (args.people.length === 1 ? " for " + (isSelfP(args.people[0]) ? "you" : personName(args.people[0])) : "") + ", so DearPolicy can’t say what it costs.", details: [] as string[], citations: [] as ChatCitation[], handled: true };
  const withPremiums = perPerson.filter((p) => p.lines.length);
  const citations: ChatCitation[] = [];
  const details: string[] = [];
  for (const u of uncounted) if (!citations.some((c) => c.policyId === u.docId && c.pageStart === u.page))
    citations.push({ chunkId: "premium:" + u.id, policyId: u.docId, policyName: u.name, insurer: u.insurer ?? undefined, pageStart: u.page, pageEnd: u.page, evidenceLabel: "Your policy document" });
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
    const monthly = /month/i.test(i.frequency ?? "") ? money(i.total, i.currency) + " a month (" + money(i.annual, i.currency) + " a year)" : money(i.annual, i.currency) + " a year";
    // (The page is cited either way; "(page N)" is written only beside figures that page prints.)
    return name + (/\bpremium\b/i.test(name) ? "" : " premium") + ": " + monthly + split + from + (allPrintedOn(monthly + split, l.pageText) ? where : "") + ".";
  };
  const isSelf = (p: ClaimPerson) => /^self$/i.test(p.relationship ?? "");
  const family = args.people.length > 1;
  let summary: string;
  // "Which policy is cheapest / most expensive?": the printed yearly premiums, compared.
  if (RANKED.test(args.question) && withPremiums.length) {
    // "Which one costs more, car or home?": only the kinds of plan named.
    const KINDS: [RegExp, RegExp][] = [[/\b(?:car|motor|vehicle)\b/i, /motor|car\b|vehicle|drive/i], [/\b(?:home|house|contents)\b/i, /home|contents|household/i], [/\b(?:shield|hospital)\b/i, /shield|hospital/i],
      [/\btravel\b/i, /travel|trip|wanderlust/i], [/\b(?:accident|pa)\b/i, /accident|\bpa\b|safeguard/i], [/\b(?:ilp|investment)\b/i, /invest|ilp/i], [/\b(?:endowment|savings)\b/i, /endow|savings|lotus/i]];
    const named = KINDS.filter(([q]) => q.test(args.question)).map(([, doc]) => doc);
    const all = withPremiums.flatMap((p) => p.lines.map((l) => ({ p, l }))).filter((x) => !named.length || named.some((re) => re.test((x.l.item.product_name ?? "") + " " + (x.l.docName ?? "") + " " + (x.l.policyType ?? ""))));
    // The last ranking word said is the one asked ("…the most expensive? and the cheapest?").
    const lastOf = (re: RegExp) => Math.max(-1, ...[...args.question.matchAll(new RegExp(re.source, "gi"))].map((m) => m.index ?? 0));
    const most = lastOf(/\b(?:most expensive|costliest|highest|costs? (?:the )?most|costs more|more expensive)\b/) > lastOf(/\b(?:cheapest|least expensive|lowest|costs? (?:the )?least|cheaper)\b/);
    const sorted = [...all].sort((a, b) => most ? b.l.item.annual - a.l.item.annual : a.l.item.annual - b.l.item.annual);
    const top = sorted[0];
    const label = (x: { p: (typeof perPerson)[number]; l: Line }) => (x.l.item.product_name ?? x.l.docName ?? "A policy") + (family ? " (" + personName(x.p.person) + ")" : "");
    for (const x of sorted) { details.push((family ? personName(x.p.person) + " · " : "") + itemText(x.l)); cite(x.l); }
    // Round 10: none of the plans asked about prints a premium (or none is theirs): said, never a crash.
    summary = !top ? "None of the plans you asked about has a premium printed in " + (family ? "your household’s" : isSelf(args.people[0]) ? "your" : personName(args.people[0]) + "’s") + " documents, so they can’t be compared."
      : "Of the premiums printed in " + (family ? "your household’s" : isSelf(args.people[0]) ? "your" : personName(args.people[0]) + "’s") + " documents, the " + (most ? "highest" : "lowest") + " is " + label(top) + " at " + money(top.l.item.annual, top.l.item.currency) + " a year.";
    if (notCounted.length) details.push("Not compared: " + notCounted.join("; ") + ".");
    return { summary, details, citations, handled: true };
  }
  if (!withPremiums.length && !family) {
    // Nobody can pay a premium on a document DearPolicy could not read: say that instead.
    const docs = (await documentsByPerson(args.accountId, args.people).catch(() => new Map())).get(args.people[0].id) ?? [];
    if (!docs.some((d: { status: string }) => d.status === "ready")) return { summary: noPoliciesSentence(args.people[0], docs), details, citations, handled: true };
  }
  if (!withPremiums.length && notCounted.length) {
    // Only one-off or ended premiums on file: say exactly that, not "no premium".
    return { summary: (family ? "No yearly premium is printed in your household’s documents. " : "") + [...new Set(notCounted)].map((n) => n.replace(" — ", ": ")).join(". ") + ".", details, citations, handled: true };
  }
  if (!withPremiums.length) {
    summary = family ? "No premium amounts are printed in the documents on file for your household, so DearPolicy can’t total them. A renewal notice or premium receipt shows the premium; upload one and ask again."
      // Round 11: which policy has no premium printed is named ("Kai Ting's PA Guardian"), not only whose.
      : "No premium amount is printed in the documents on file for " + (isSelf(args.people[0]) ? "you" : personName(args.people[0])) + ((perPerson[0]?.missing ?? []).length ? (isSelf(args.people[0]) ? "r " : "’s ") + [...new Set(perPerson[0].missing)].join(" or ") : "") + ". A renewal notice or premium receipt shows it; upload one and ask again.";
  } else if (!family) {
    const p = withPremiums[0];
    for (const l of p.lines) { details.push(itemText(l)); cite(l); }
    const today = new Date().toISOString().slice(0, 10);
    const starts = [...new Set(p.lines.map((l) => l.item.period_start?.slice(0, 10) ?? ""))];
    const future = starts.length === 1 && starts[0] > today ? new Date(starts[0] + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null;
    const amounts = p.lines.map((l) => ({ amount: l.item.annual, currency: l.item.currency }));
    const mixed = byCurrency(amounts).length > 1;
    sumLines(p.lines);
    const sgdLines = p.lines.filter((l) => l.item.currency === "SGD");
    ops.push(sumOperands(sgdLines.map((l) => l.ops ? l.ops.cashAnnual ?? l.ops.annual : null)), sumOperands(sgdLines.filter((l) => l.item.medisaveAnnual != null).map((l) => l.ops?.medisaveAnnual ?? null)));
    summary = (future ? "From " + future + ", " : "") + (isSelf(p.person) ? (future ? "you pay" : "You pay") : personName(p.person) + " pays") + " " + moneyList(amounts) + " a year in premiums" +
" — about " + moneyList(amounts, 12) + " a month" + (mixed ? " (each currency as printed; they are not added together)" : "") + "." +
      (p.cash != null && p.medisave != null ? (mixed ? " Of the Singapore-dollar premiums, " : " Of that, ") + money(p.cash, "SGD") + " is paid in cash and " + money(p.medisave, "SGD") + " from MediSave." : "");
  } else {
    // Round 7: a joint policy's one premium is listed under each person it
    // covers but counted ONCE in the household's total.
    const counted = new Set<string>();
    const amounts = withPremiums.flatMap((p) => p.lines.filter((l) => { if (counted.has(l.item.id)) return false; counted.add(l.item.id); return true; }).map((l) => ({ amount: l.item.annual, currency: l.item.currency })));
    const holders = new Map<string, number>();
    for (const p of withPremiums) for (const l of p.lines) holders.set(l.item.id, (holders.get(l.item.id) ?? 0) + 1);
    for (const p of withPremiums) {
      sumLines(p.lines);
      details.push(personName(p.person) + ": " + moneyList(p.lines.map((l) => ({ amount: l.item.annual, currency: l.item.currency }))) + " a year in premiums (" + p.lines.map((l) => (l.item.product_name ?? l.docName ?? "a policy") + " " + money(l.item.annual, l.item.currency) + ((holders.get(l.item.id) ?? 0) > 1 ? ", one joint premium" : "")).join(", ") + ").");
      for (const l of p.lines) cite(l);
    }
    if ([...holders.values()].some((n) => n > 1)) details.push("A joint policy’s premium is counted once in the household total.");
    // The household total: the explicit sum of each person's lines (a joint premium once), per currency.
    { const once = new Set<string>(); const lines = withPremiums.flatMap((p) => p.lines).filter((l) => !once.has(l.item.id) && !!once.add(l.item.id)); sumLines(lines, (o) => o.annual, "household"); }
    summary = "Your household pays " + moneyList(amounts) + " a year in premiums — about " + moneyList(amounts, 12) + " a month — from the premiums printed in the documents on file" + (byCurrency(amounts).length > 1 ? " (each currency as printed; they are not added together)" : "") + ".";
  }
  const counted = new Set(withPremiums.flatMap((p) => p.lines.map((l) => l.item.product_name ?? l.docName ?? "")));
  const missing = [...new Set(perPerson.flatMap((p) => p.missing))].filter((m) => !counted.has(m) && !notCounted.some((n) => n.startsWith(m + " — ")));
  if (notCounted.length && withPremiums.length) details.push("Not included: " + [...new Set(notCounted)].join("; ") + ".");
  if (missing.length && withPremiums.length) details.push("Not included: " + missing.slice(0, 4).join(", ") + (missing.length > 4 ? " and " + (missing.length - 4) + " more" : "") + " — no premium is printed in the documents on file for " + (missing.length === 1 ? "it" : "them") + ".");
  return { summary, details, citations, handled: true };
}

/** Round 7 (port): "How much am I paying for the dependants' GHS?" A group plan's booklet prints a
 * yearly premium per dependant ("Spouse S$612.00 per year", "Each child S$298.00 per year"); the
 * dependants it names are on file with the document. The answer is those printed rates times the
 * dependants the document names -- shown as the sum it is, with the page -- never a figure of its own. */
export const DEPENDANT_PREMIUM_QUESTION = /\b(?:dependants?|dependents?)\b|\b(?:spouse|wife|husband|kids?|children|child)\b(?=[^?]*\b(?:ghs|group|company|employer|work|staff|salary)\b)|\b(?:ghs|group|company|employer|work|staff)\b(?=[^?]*\b(?:spouse|wife|husband|kids?|children|child)\b)/i;
export async function dependantPremiumAnswer(args: { accountId: string; question: string }) {
  if (!DEPENDANT_PREMIUM_QUESTION.test(args.question) || !/\b(?:premiums?|pay(?:ing)?|paid|costs?|deduct\w*)\b/i.test(args.question)) return null;
  const docs = (await query<{ id: string; product_name: string | null; insurer: string | null }>(
    `SELECT p.id::text AS id,p.product_name,p.insurer FROM policies p WHERE p.account_id=$1 AND ${activePredicate("p")} AND p.superseded_at IS NULL`, [args.accountId])).rows;
  const memo = newDocMemo();
  const RATE = /^\s*(spouse|each child|per child|child(?:ren)?)\b[\s:·\-–]*(?:S\$|SGD\s?)\s?(\d[\d,]*(?:\.\d{2})?)\s*(?:per (?:year|annum)|a year|yearly|annually)?\s*$/i;
  for (const doc of docs) {
    for (const page of await pagesOf(args.accountId, doc.id, memo)) {
      const lines = page.text.split(/\n/).map((l) => l.replace(/\t/g, " ").replace(/\s{2,}/g, " ").trim());
      const at = lines.findIndex((l) => /\bdependants?['’]?\s+premiums?\b|\bpremiums? (?:for|of) dependants?\b/i.test(l));
      if (at < 0) continue;
      const rates: { who: "spouse" | "child"; amount: number; text: string }[] = [];
      for (const l of lines.slice(at + 1, at + 8)) {
        const m = RATE.exec(l);
        if (m) rates.push({ who: /spouse/i.test(m[1]) ? "spouse" : "child", amount: Number(m[2].replace(/,/g, "")), text: l });
      }
      if (!rates.length) continue;
      const members = (await query<{ id: string; display_name: string; preferred_name: string | null; relationship: string | null }>(
        `SELECT f.id::text AS id,f.display_name,f.preferred_name,f.relationship FROM policy_members pm JOIN family_members f ON f.id=pm.family_member_id AND ${activePredicate("f")} WHERE pm.account_id=$1 AND pm.policy_id::text=$2`,
        [args.accountId, doc.id])).rows;
      const kindOf = (r: string | null) => /^(?:spouse|wife|husband)$/i.test(r ?? "") ? "spouse" : /^(?:child|son|daughter)$/i.test(r ?? "") ? "child" : null;
      const onlySpouse = /\b(?:spouse|wife|husband)\b/i.test(args.question) && !/\b(?:kids?|children|child|dependants?|dependents?)\b/i.test(args.question);
      const onlyChildren = /\b(?:kids?|children|child)\b/i.test(args.question) && !/\b(?:spouse|wife|husband|dependants?|dependents?)\b/i.test(args.question);
      const parts: { label: string; count: number; amount: number; names: string[]; ids: string[] }[] = [];
      for (const rate of rates) {
        if ((onlySpouse && rate.who !== "spouse") || (onlyChildren && rate.who !== "child")) continue;
        const names = members.filter((m) => kindOf(m.relationship) === rate.who).map((m) => m.preferred_name?.trim() || m.display_name);
        const ids = members.filter((m) => kindOf(m.relationship) === rate.who).map((m) => m.id);
        if (names.length) parts.push({ label: rate.who === "spouse" ? "spouse" : "child", count: rate.who === "spouse" ? Math.min(1, names.length) : names.length, amount: rate.amount, names, ids });
      }
      const name = doc.product_name ?? "Group policy document";
      const shown = (v: number) => formatMoney(v, "SGD").replace(/\.00$/, "");
      const printed = rates.map((r) => "“" + r.text + "”").join(" and ");
      const citations: ChatCitation[] = [{ chunkId: "premium:dependants:" + doc.id + ":" + page.page, policyId: doc.id, policyName: name, insurer: doc.insurer ?? undefined, pageStart: page.page, pageEnd: page.page, evidenceLabel: "Your policy document" }];
      if (!parts.length) {
        const summary = name + " prints the yearly dependant premium as " + printed + " (page " + page.page + "), but no dependant of that kind is named in it, so DearPolicy can’t add it up.";
        // Gate R17: the printed rates are read from their own rows of that page (resolved there at save time).
        citeLine(null, summary, { policyId: doc.id, pageStart: page.page, benefit: "Dependant premium" });
        return { summary, details: [] as string[], citations };
      }
      const total = parts.reduce((t, p) => t + p.count * p.amount, 0);
      const listNames = (n: string[]) => n.length <= 1 ? n.join("") : n.slice(0, -1).join(", ") + " and " + n.at(-1);
      const sum = parts.map((p) => (p.count > 1 ? p.count + " × " : "") + formatMoney(p.amount, "SGD")).join(" + ");
      const deducted = /deducted from salary/i.test(lines[at]) ? ", deducted from salary" : "";
      const out = {
        summary: "For the dependants on " + name + " your family pays " + shown(total) + " a year" + deducted + ": " + sum + ", from the dependant premiums it prints for "
          + listNames(parts.flatMap((p) => p.names)) + ".",
        details: [name + " — " + printed + " (page " + page.page + ").",
          "That is the printed rate for each dependant named in the document, added up; the employer’s HR or the insurer can confirm what is actually deducted."],
        citations,
      };
      // Gate R17: each printed rate is bound to its own row (for a person of that row's kind), and the total is the
      // explicit record of the sum of each rate times the number of dependants of that kind the document names.
      const hash = (await documentHashes(args.accountId, [doc.id])).get(doc.id) ?? null;
      const owner = (await query<{ owner: string }>(`SELECT p.family_member_id::text AS owner FROM policies p WHERE p.account_id=$1 AND p.id::text=$2 AND ${activePredicate("p")}`, [args.accountId, doc.id]).catch(() => ({ rows: [] }))).rows[0]?.owner ?? null;
      const rateOperand = (who: "spouse" | "child", amount: number, subjectId: string | null | undefined) => {
        const b = subjectId ? rowBinding({ policyId: doc.id, subjectId, documentHash: hash, page: page.page, pageText: page.text, value: amount, currency: "SGD", want: who === "spouse" ? /\bspouse\b/i : /\bchild/i, benefit: who === "spouse" ? "Spouse premium" : "Child premium" }) : null;
        return b ? boundOperand(amount, "SGD", "year", "premium", b) : null;
      };
      // Every printed rate the answer quotes, for a dependant of that kind the document names (or its owner).
      for (const rate of rates) {
        const o = rateOperand(rate.who, rate.amount, members.find((m) => kindOf(m.relationship) === rate.who)?.id ?? owner);
        for (const t of [out.summary, ...out.details]) attachOperand(null, t, o);
      }
      const operands = parts.map((p) => productOperand(rateOperand(p.label === "spouse" ? "spouse" : "child", p.amount, p.ids[0]), p.count));
      attachOperand(null, out.summary, sumOperands(operands, "household"));
      return out;
    }
  }
  return null;
}
