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

type Line = { item: PremiumItem; docId: string | null; docName: string | null; page: number | null; role: string | null; insurer?: string | null; policyType?: string | null };

/** What the document behind a premium says about the policy now (lapsed, ended, in force).
 * Round 10: one read of a document's pages and dates per answer -- a household
 * total used to re-read the same pages for every premium line of every person. */
type DocMemo = { pages: Map<string, Promise<{ page: number; text: string }[]>>; dates: Map<string, Promise<{ expiry: string | null; start: string | null }>> };
const newDocMemo = (): DocMemo => ({ pages: new Map(), dates: new Map() });
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
  const notCounted: string[] = [];
  const memo = newDocMemo();
  // The pages that say why a premium is not counted are cited like any other.
  const uncounted: { docId: string; page: number; name: string; insurer: string | null; id: string }[] = [];
  const perPerson: { person: ClaimPerson; lines: Line[]; missing: string[]; annual: number; cash: number | null; medisave: number | null; currency: string }[] = [];
  for (const person of args.people) {
    const summary = await summarisePremiums(args.accountId, person);
    const ids = summary.items.map((i) => i.id);
    const sources = ids.length ? (await query<{ id: string; doc_id: string | null; page: number | null; product_name: string | null; role: string | null; insurer: string | null; policy_type: string | null; active: boolean }>(
      `SELECT pr.id::text AS id,coalesce(pr.source_document_id,pr.policy_id)::text AS doc_id,pr.source_page AS page,p.product_name,p.document_role AS role,p.insurer,p.policy_type,
              (p.id IS NOT NULL) AS active
         FROM premium_records pr LEFT JOIN policies p ON p.id=coalesce(pr.source_document_id,pr.policy_id) AND p.account_id=pr.account_id AND ${activePredicate("p")} AND p.superseded_at IS NULL
        WHERE pr.account_id=$1 AND pr.id::text=ANY($2::text[])`, [args.accountId, ids])).rows : [];
    const byId = new Map(sources.map((s) => [s.id, s]));
    // A premium printed in a deleted document is not on file any more.
    const lines: Line[] = [];
    for (const item of summary.items.filter((i) => byId.get(i.id)?.active)) {
      // A policy that has lapsed or ended costs nothing now; a one-off premium for a cover period is not a yearly one.
      const docId = byId.get(item.id)?.doc_id ?? null;
      const status = docId ? await statusFor(args.accountId, docId, memo) : null;
      if (status && (status.state === "lapsed" || status.state === "ended")) { if (docId && status.page) uncounted.push({ docId, page: status.page, name: byId.get(item.id)?.product_name ?? item.product_name ?? "Policy document", insurer: byId.get(item.id)?.insurer ?? null, id: item.id }); notCounted.push((item.product_name ?? byId.get(item.id)?.product_name ?? "A policy") + " — it " + (status.state === "lapsed" ? "lapsed" : "ended") + " on " + status.printed); continue; }
      if (/single|one[- ]?off|for the period/i.test(item.frequency ?? "")) {
        const span = docId ? await periodFor(args.accountId, docId, memo) : null;
        const docPages = docId ? await pagesOf(args.accountId, docId, memo) : [];
        const amountPage = docPages.find((p) => p.text.replace(/(\d),(?=\d{3}\b)/g, "$1").includes(String(item.amount)))?.page ?? byId.get(item.id)?.page ?? null;
        for (const page of new Set([amountPage, printedPeriodEnd(docPages)?.page ?? null]))
          if (docId && page) uncounted.push({ docId, page, name: byId.get(item.id)?.product_name ?? item.product_name ?? "Policy document", insurer: byId.get(item.id)?.insurer ?? null, id: item.id });
        notCounted.push((item.product_name ?? "A policy") + " — a one-off premium of " + money(item.amount, item.currency) + (span ? " for " + span : "") + ", not a yearly one");
        continue;
      }
      const src = byId.get(item.id)!;
      let page = src.page;
      // A premium read from the schedule carries no page: it is the page that prints it.
      if (src.doc_id) {
        const pages = (await pagesOf(args.accountId, src.doc_id, memo)).map((x) => ({ page_number: x.page, text: x.text }));
        const printedOn = (p: { text: string }) => { const digits = p.text.replace(/(\d),(?=\d{3}\b)/g, "$1"); return new RegExp("(?:^|[^\\d.])" + String(item.amount).replace(".", "\\.") + "(?:\\.0+)?(?![\\d])").test(digits); };
        if (!page || !pages.some((p) => p.page_number === page && printedOn(p))) page = pages.find(printedOn)?.page_number ?? page;
      }
      lines.push({ item, docId: src.doc_id, docName: src.product_name, page, role: src.role, insurer: src.insurer, policyType: src.policy_type });
    }
    const currency = lines[0]?.item.currency ?? "SGD";
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
      lines.push((args.people.length > 1 ? personName(p.person) + "’s " : "") + name + " premium is " + money(i.annual, i.currency) + " a year" + split + (l.page ? " (page " + l.page + ")" : "") + ".");
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
    return name + ": " + monthly + split + from + where + ".";
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
      details.push(personName(p.person) + ": " + moneyList(p.lines.map((l) => ({ amount: l.item.annual, currency: l.item.currency }))) + " a year (" + p.lines.map((l) => (l.item.product_name ?? l.docName ?? "a policy") + " " + money(l.item.annual, l.item.currency) + ((holders.get(l.item.id) ?? 0) > 1 ? ", one joint premium" : "")).join(", ") + ").");
      for (const l of p.lines) cite(l);
    }
    if ([...holders.values()].some((n) => n > 1)) details.push("A joint policy’s premium is counted once in the household total.");
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
      const members = (await query<{ display_name: string; preferred_name: string | null; relationship: string | null }>(
        `SELECT f.display_name,f.preferred_name,f.relationship FROM policy_members pm JOIN family_members f ON f.id=pm.family_member_id AND ${activePredicate("f")} WHERE pm.account_id=$1 AND pm.policy_id::text=$2`,
        [args.accountId, doc.id])).rows;
      const kindOf = (r: string | null) => /^(?:spouse|wife|husband)$/i.test(r ?? "") ? "spouse" : /^(?:child|son|daughter)$/i.test(r ?? "") ? "child" : null;
      const onlySpouse = /\b(?:spouse|wife|husband)\b/i.test(args.question) && !/\b(?:kids?|children|child|dependants?|dependents?)\b/i.test(args.question);
      const onlyChildren = /\b(?:kids?|children|child)\b/i.test(args.question) && !/\b(?:spouse|wife|husband|dependants?|dependents?)\b/i.test(args.question);
      const parts: { label: string; count: number; amount: number; names: string[] }[] = [];
      for (const rate of rates) {
        if ((onlySpouse && rate.who !== "spouse") || (onlyChildren && rate.who !== "child")) continue;
        const names = members.filter((m) => kindOf(m.relationship) === rate.who).map((m) => m.preferred_name?.trim() || m.display_name);
        if (names.length) parts.push({ label: rate.who === "spouse" ? "spouse" : "child", count: rate.who === "spouse" ? Math.min(1, names.length) : names.length, amount: rate.amount, names });
      }
      const name = doc.product_name ?? "Group policy document";
      const shown = (v: number) => formatMoney(v, "SGD").replace(/\.00$/, "");
      const printed = rates.map((r) => "“" + r.text + "”").join(" and ");
      const citations: ChatCitation[] = [{ chunkId: "premium:dependants:" + doc.id + ":" + page.page, policyId: doc.id, policyName: name, insurer: doc.insurer ?? undefined, pageStart: page.page, pageEnd: page.page, evidenceLabel: "Your policy document" }];
      if (!parts.length) return { summary: name + " prints the yearly dependant premium as " + printed + " (page " + page.page + "), but no dependant of that kind is named in it, so DearPolicy can’t add it up.", details: [] as string[], citations };
      const total = parts.reduce((t, p) => t + p.count * p.amount, 0);
      const listNames = (n: string[]) => n.length <= 1 ? n.join("") : n.slice(0, -1).join(", ") + " and " + n.at(-1);
      const sum = parts.map((p) => (p.count > 1 ? p.count + " × " : "") + formatMoney(p.amount, "SGD")).join(" + ");
      const deducted = /deducted from salary/i.test(lines[at]) ? ", deducted from salary" : "";
      return {
        summary: "For the dependants on " + name + " you pay " + shown(total) + " a year" + deducted + ": " + sum + ", from the dependant premiums it prints for "
          + listNames(parts.flatMap((p) => p.names)) + ".",
        details: [name + " — " + printed + " (page " + page.page + ").",
          "That is the printed rate for each dependant named in the document, added up; the employer’s HR or the insurer can confirm what is actually deducted."],
        citations,
      };
    }
  }
  return null;
}
