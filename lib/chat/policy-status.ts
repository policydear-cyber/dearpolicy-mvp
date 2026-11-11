/**
 * Round 7: whether a document's policy still covers anyone, read from what
 * the document itself prints -- never inferred from silence.
 *
 *   lapsed    "Your policy lapsed on 17 March 2026"            (a lapse notice)
 *   grace     "Grace period ends 20 October 2026"               (a premium reminder)
 *   grace_passed  the same reminder after that date: it cannot say whether the premium was paid
 *   in_force  a period of insurance is printed: every policy on file is treated as in force, whatever its printed end
 *             date (DC, 31 Oct: "ignore all expiry dates"), so a date that has passed never makes it "ended".
 *   unknown   nothing printed says either way
 *
 * Every state carries the page and line that says it, so an answer can cite it.
 */
export type PrintedStatus = {
  state: "lapsed" | "grace" | "grace_passed" | "in_force" | "reinstated" | "unknown";
  /** ISO date the status turns on (lapse date, end of grace, end of period). */
  date: string | null;
  /** The date as the document prints it ("17 March 2026"); grace dates are said in this long form. */
  printed: string | null;
  /** grace, grace_passed: the end date exactly as the line prints it ("20/10/2026"). */
  datePrinted?: string | null;
  page: number | null;
  line: string | null;
  /** grace, grace_passed: the premium that is unpaid and when it fell due, as printed. */
  dueAmount?: string | null;
  duePrinted?: string | null;
  /** grace, grace_passed: ISO date the unpaid premium fell due. */
  dueDate?: string | null;
  /** reinstated: the lapse the reinstatement ended, as the earlier document printed it. */
  lapsedPrinted?: string | null;
  /** reinstated: the document that says so (another document of the same policy). */
  byDocId?: string | null;
  /** Round 16: for a reinstated policy, the lapse notice (document and page) that prints the lapse date the answer repeats. */
  lapsedDocId?: string | null; lapsedPage?: number | null;
};
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DATE = "(\\d{1,2})\\s+(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(\\d{4})";
export function isoOf(d: string, m: string, y: string) { return y + "-" + String(MONTHS.indexOf(m.toLowerCase()) + 1).padStart(2, "0") + "-" + d.padStart(2, "0"); }
/** "1 February 2026" from an ISO date. */
export function longDate(iso: string) { const [y, m, d] = iso.slice(0, 10).split("-"); return Number(d) + " " + MONTHS[Number(m) - 1].replace(/^\w/, (c) => c.toUpperCase()) + " " + y; }
/** Today's date where the household is (Singapore). */
export function todayIso(now = new Date()) { return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10); }
export function daysBetween(fromIso: string, toIso: string) { return Math.round((Date.parse(toIso + "T00:00:00Z") - Date.parse(fromIso + "T00:00:00Z")) / 86400_000); }

/** "How many days left?": the days from today to the date a document prints. A printed end date that has passed gives no
 *  countdown and no "ended": every policy on file is taken as in force (DC, 31 Oct), so the answer only says what the
 *  document prints. A grace period comes from an unpaid premium, not an end date, and is still counted. */
export function countdownLine(name: string, st: Pick<PrintedStatus, "state" | "date" | "printed">, today: string): string | null {
  if (!st.date || !st.printed) return null;
  const n = daysBetween(today, st.date), days = (k: number) => k + " day" + (k === 1 ? "" : "s");
  if (st.state === "in_force") return name + (n < 0 ? "’s printed period runs to " + st.printed + "." : n === 0 ? " ends today, " + st.printed + "." : " ends on " + st.printed + " — " + days(n) + " from today.");
  if (st.state === "grace") return name + "’s grace period ends on " + st.printed + " — " + days(n) + " from today.";
  if (st.state === "grace_passed") return name + "’s grace period ended on " + st.printed + ", " + days(-n) + " ago.";
  return null;
}

type Page = { page: number; text: string };
const lines = (pages: Page[]) => pages.flatMap((p) => p.text.split(/\r?\n/).map((l, i) => ({ page: p.page, i, l: l.replace(/\t+/g, " ").trim() })));
/** A sentence-sized window around a match, joined across wrapped lines. */
function sentenceAt(pages: Page[], page: number, re: RegExp) {
  const text = (pages.find((p) => p.page === page)?.text ?? "").replace(/\s*\n\s*/g, " ");
  const at = text.search(re);
  if (at < 0) return null;
  const start = Math.max(text.lastIndexOf(". ", at) + 2, 0), end = text.indexOf(".", at);
  return text.slice(start, end < 0 ? undefined : end + 1).trim();
}

/** The period start a document prints ("Period of insurance 1 June 2025 to 31 May 2027" gives 1 June 2025). */
export function printedPeriodStart(pages: Page[]): string | null {
  for (const x of lines(pages)) {
    if (!/\b(?:period of insurance|policy term|period of cover|cover period|insurance period)\b/i.test(x.l)) continue;
    const m = x.l.match(new RegExp(DATE + "\\s+(?:to|until|till|-|–)\\s+" + DATE, "i"));
    if (m) return isoOf(m[1], m[2], m[3]);
  }
  return null;
}

/** The period end a document prints ("Period of insurance 1 June 2025 to 31 May 2027", "Policy term …", "Maturity date …"). */
export function printedPeriodEnd(pages: Page[]): { iso: string; printed: string; page: number; line: string } | null {
  for (const x of lines(pages)) {
    if (!/\b(?:period of insurance|policy term|period of cover|cover period|insurance period|valid (?:until|till))\b/i.test(x.l)) continue;
    const m = x.l.match(new RegExp(DATE + "\\s+(?:to|until|till|-|–)\\s+" + DATE, "i"));
    if (m) return { iso: isoOf(m[4], m[5], m[6]), printed: m[4] + " " + m[5] + " " + m[6], page: x.page, line: x.l };
  }
  return null;
}

const MON = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
/** A date as notices print it: "20 October 2026", "20th Oct 2026", "20/10/2026" (day first, as in SG, MY and the UK). */
const ANY_DATE = "(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+(" + MON + ")\\.?,?\\s+(\\d{4})|(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4}))";
function isoOfAny(m: RegExpMatchArray, at: number): string | null {
  const iso = isoParts(m, at);
  // A day the month does not have ("31/02/2026") is no date.
  return iso && new Date(iso + "T00:00:00Z").toISOString().slice(0, 10) === iso ? iso : null;
}
function isoParts(m: RegExpMatchArray, at: number): string | null {
  if (m[at]) {
    const mon = MONTHS.findIndex((x) => x.startsWith(m[at + 1].toLowerCase().slice(0, 3)));
    const d = Number(m[at]);
    return mon >= 0 && d >= 1 && d <= 31 ? m[at + 2] + "-" + String(mon + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0") : null;
  }
  const d = Number(m[at + 3]), mo = Number(m[at + 4]);
  return d >= 1 && d <= 31 && mo >= 1 && mo <= 12 ? m[at + 5] + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0") : null;
}
/** Every date a text gives as the end of a grace period ("Grace period ends 20 October 2026", "Grace period end date:
 * 20/10/2026", "a grace period of 30 days, ending 20 Oct 2026", "the grace period, which expires on …"), in order,
 * with the date as printed. A worked example's sentence ("For example, if your premium is due on …") gives none. */
export function graceEndDates(text: string): { iso: string; printed: string; index: number }[] {
  const re = new RegExp("\\bgrace period\\b(?:[^.\\n]{0,60}?\\b(?:ends?|ending|end date|expires?|expiring|until|till)\\b(?:\\s+on)?)?[\\s:,]+" + ANY_DATE, "gi");
  const out: { iso: string; printed: string; index: number }[] = [];
  for (const m of text.matchAll(re)) {
    const sentence = text.slice(0, m.index! + m[0].length).split(/[.!?](?:\s|$)/).at(-1) ?? "";
    if (HYPOTHETICAL.test(sentence)) continue;
    // A printed range ("Grace period: 20/09/2026 - 20/10/2026") ends at its second date.
    const range = text.slice(m.index! + m[0].length).match(new RegExp("^\\s*(?:-|–|to|until|till)\\s*" + ANY_DATE, "i"));
    const iso = range ? isoOfAny(range, 1) : isoOfAny(m, 1);
    const printed = range ? range[0].slice(range[0].search(new RegExp(ANY_DATE, "i"))) : m[0].slice(m[0].search(new RegExp(ANY_DATE, "i")));
    if (iso) out.push({ iso, printed, index: m.index! });
  }
  return out;
}

/** Wording that describes a case rather than this policy's own premium. */
/** A line that is only a premium label and its amount: "Monthly premium S$212.40", "Amount due: S$86.40 (incl. GST)". */
const PREMIUM_LINE = /^(?:(?:monthly|annual|yearly|quarterly|half[- ]yearly|modal|outstanding|unpaid|total|overdue)\s+)?(?:premium(?:\s+(?:due|amount|payable|outstanding|unpaid))?|amount\s+(?:due|payable|outstanding))\s*:?\s*(?:S\$|SGD|RM|MYR|£|GBP|US\$|USD)\s?[\d,]+(?:\.\d{1,2})?\s*(?:\([^)]*\))?\s*$/i;
// "If your premium is not paid, your grace period ends on …" is a notice's own wording; "if your premium is due on 1 March" is a case.
export const HYPOTHETICAL = /\b(?:for example|for instance|e\.g\.|example|illustrat\w*|suppose|assum\w*|if (?:your|the|a) (?:premium|payment|instalment) (?:is|was|falls) due\b)/i;

export function printedStatus(pages: Page[], expiryIso: string | null, today: string): PrintedStatus {
  const all = lines(pages);
  // A lapse the document states.
  for (const x of all) {
    const m = x.l.match(new RegExp("\\b(?:policy|cover|plan)?\\s*(?:has\\s+)?lapsed\\s+on\\s+" + DATE, "i"));
    if (m) return { state: "lapsed", date: isoOf(m[1], m[2], m[3]), printed: m[1] + " " + m[2] + " " + m[3], page: x.page, line: sentenceAt(pages, x.page, /lapsed\s+on/i) ?? x.l };
  }
  // A grace period the document states, with the date it ends.
  for (const x of all) {
    if (!/\bgrace period\b/i.test(x.l)) continue;
    // The line itself, or wrapped onto the next line of the same page; the line it wraps from may not be a worked example.
    const next = all.find((y) => y.page === x.page && y.i === x.i + 1)?.l ?? "";
    const before = all.find((y) => y.page === x.page && y.i === x.i - 1)?.l ?? "";
    const g = graceEndDates(x.l)[0] ?? graceEndDates(x.l + " " + next)[0];
    if (!g || HYPOTHETICAL.test(before) && !/[.!?:]\s*$/.test(before)) continue;
    const iso = g.iso;
    const dueLine = all.find((y) => y.page === x.page && /\b(?:premium due date|due date|due on)\b/i.test(y.l) && new RegExp(ANY_DATE, "i").test(y.l) && !HYPOTHETICAL.test(y.l));
    const dueM = dueLine?.l.match(new RegExp(ANY_DATE, "i")), dueIso = dueM ? isoOfAny(dueM, 1) : null;
    // The amount said as unpaid is the figure on the premium line itself ("Monthly premium S$212.40", "Amount due: S$86.40"),
    // never another figure on a line that mentions a premium ("Premium waiver benefit S$50,000", "Annual limit S$150,000").
    const amount = all.find((y) => y.page === x.page && PREMIUM_LINE.test(y.l))?.l.match(/(?:S\$|(?:(?<![A-Za-z])|(?<=[a-z])(?=[A-Z]{2,3}\s?\d))(?:SGD|RM|MYR|GBP|USD)|£|US\$)\s?[\d,]+(?:\.\d+)?/)?.[0] ?? null;
    // A reminder prints what is due: a grace date with no due date and no amount due beside it is not one.
    if (!dueIso && !amount && !all.some((y) => y.page === x.page && /\b(?:amount due|premium (?:due|outstanding|unpaid)|outstanding premium|unpaid premium)\b/i.test(y.l) && /\d/.test(y.l) && !HYPOTHETICAL.test(y.l))) continue;
    // A grace period that has already run out says nothing about payment since: neither "in force" nor "lapsed".
    return { state: iso >= today ? "grace" : "grace_passed", date: iso, printed: longDate(iso), datePrinted: g.printed, page: x.page, line: x.l,
      dueAmount: amount, duePrinted: dueIso ? longDate(dueIso) : null, dueDate: dueIso };
  }
  const end = printedPeriodEnd(pages);
  const endIso = end?.iso ?? expiryIso?.slice(0, 10) ?? null;
  if (endIso) return { state: "in_force", date: endIso, printed: end?.printed ?? longDate(endIso), page: end?.page ?? null, line: end?.line ?? null };
  return { state: "unknown", date: null, printed: null, page: null, line: null };
}

/** Round 7 (port): "your policy has been REINSTATED with effect from 6 January 2026" -- the date a document
 * prints that a lapsed policy was put back in force, with its page and sentence. */
export function printedReinstatement(pages: Page[]): { iso: string; printed: string; page: number; line: string } | null {
  for (const p of pages) {
    const text = p.text.replace(/\s*\n\s*/g, " ");
    const m = text.match(new RegExp("\\breinstated\\b[^.]{0,40}?\\b(?:with effect from|effective(?: from)?|on|from)\\s+" + DATE, "i"));
    if (m) return { iso: isoOf(m[1], m[2], m[3]), printed: m[1] + " " + m[2] + " " + m[3], page: p.page, line: sentenceAt(pages, p.page, /reinstated/i) ?? m[0] };
  }
  return null;
}
/** Round 7 (port): a lapse that a later document of the same policy (same policy number) says was reinstated
 * is not the policy's status any more: both documents read as reinstated, citing the reinstatement. */
export function applyReinstatements(statusOf: Map<string, PrintedStatus>, docs: { id: string; policy_number: string | null }[], pagesOf: (id: string) => Page[]) {
  const num = (x: string | null) => (x ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  for (const d of docs) {
    const st = statusOf.get(d.id);
    if (st?.state !== "lapsed" || !num(d.policy_number)) continue;
    for (const o of docs) {
      if (o.id === d.id || num(o.policy_number) !== num(d.policy_number)) continue;
      const r = printedReinstatement(pagesOf(o.id));
      if (!r || (st.date && r.iso < st.date)) continue;
      const reinstated: PrintedStatus = { state: "reinstated", date: r.iso, printed: r.printed, page: r.page, line: r.line, lapsedPrinted: st.printed, byDocId: o.id, lapsedDocId: d.id, lapsedPage: st.page };
      statusOf.set(d.id, reinstated);
      if (["unknown", "in_force"].includes(statusOf.get(o.id)?.state ?? "unknown")) statusOf.set(o.id, reinstated);
      break;
    }
  }
  return statusOf;
}

const CURRENT_EVIDENCE = new Set(["personal_schedule", "certificate", "renewal_statement", "annual_statement", "premium_receipt"]);
/** A reminder whose grace date has passed says nothing once a later document of the same policy (same policy number,
 * or same product for the same people) or a payment after that date is on file: a renewal schedule or a receipt is
 * the later word, so the reminder reads as "unknown" again and never overrides it. */
export function supersedePassedGrace(statusOf: Map<string, PrintedStatus>,
  docs: { id: string; policy_number: string | null; product_name: string | null; owners: Set<string>; date: string | null; role?: string | null }[], latestPaid: Map<string, string | null>) {
  const num = (x: string | null) => (x ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const product = (x: string | null) => (x ?? "").trim().toLowerCase();
  for (const d of docs) {
    const st = statusOf.get(d.id);
    if (st?.state !== "grace_passed" || !st.date) continue;
    // Same printed number; or the same product for the same people when one of the two prints no number (two different
    // numbers are two policies).
    const same = docs.filter((o) => o.id !== d.id && (num(d.policy_number) && num(o.policy_number) === num(d.policy_number)
      || (!num(d.policy_number) || !num(o.policy_number)) && !!product(d.product_name) && product(o.product_name) === product(d.product_name) && [...o.owners].some((x) => d.owners.has(x))));
    // A later document: one that speaks for this person's cover being current (a schedule, certificate, renewal,
    // statement or receipt; never a wording or product summary), dated after the grace date. A payment recorded from another document of the policy (a receipt):
    // on or after the date the premium fell due, so one inside the grace period counts. The reminder's own premium rows
    // are the premium it asks for, never a payment.
    const later = (iso: string | null | undefined) => (iso ?? "").slice(0, 10) > st.date!;
    const paid = (iso: string | null | undefined) => !!iso && iso.slice(0, 10) >= (st.dueDate ?? st.date!);
    if (same.some((o) => CURRENT_EVIDENCE.has(o.role ?? "") && later(o.date) || paid(latestPaid.get(o.id))))
      statusOf.set(d.id, { state: "unknown", date: null, printed: null, page: null, line: null });
  }
  return statusOf;
}

/** One plain sentence about a policy whose document prints that it lapsed, or that it is in its grace period. */
export function statusSentence(name: string, s: PrintedStatus): string | null {
  const page = s.page != null ? " (page " + s.page + ")" : "";
  if (s.state === "lapsed") return name + " lapsed on " + s.printed + page + ", so it no longer pays for anything that happens from that date.";
  if (s.state === "reinstated") return name + (s.lapsedPrinted ? " lapsed on " + s.lapsedPrinted + " and" : "") + " was reinstated with effect from " + s.printed + page + ", so it is in force again; the reinstatement letter is the later document.";
  if (s.state === "grace") return name + " is in its grace period" + page + ": " + (s.dueAmount && s.duePrinted ? "the premium of " + s.dueAmount + " due on " + s.duePrinted + " has not been received. " : "a premium has not been received. ")
    + "It stays in force until " + s.printed + ", and lapses if the premium is not paid by then.";
  if (s.state === "grace_passed") return name + page + ": " + (s.dueAmount && s.duePrinted ? "the premium of " + s.dueAmount + " due on " + s.duePrinted : "an unpaid premium") + " had to be paid by " + s.printed
    + ". That date has passed and the reminder cannot show whether it was; if not, the policy can lapse, so the insurer can confirm whether it is still in force.";
  return null;
}

/** The household's documents (for these people) that print that their policy has lapsed, with what each prints. */
export async function inactiveDocuments(accountId: string, personIds: string[], now = new Date()) {
  const { query } = await import("@/lib/db/client");
  const { activePredicate } = await import("@/lib/lifecycle/scopes");
  if (!personIds.length) return [];
  const docs = (await query<{ id: string; product_name: string | null; policy_number: string | null; renewal_or_expiry_date: string | null; people: string[] }>(
    `SELECT p.id::text AS id,p.product_name,p.policy_number,p.renewal_or_expiry_date::text AS renewal_or_expiry_date,array_agg(DISTINCT pm.family_member_id::text) AS people
       FROM policies p JOIN policy_members pm ON pm.policy_id=p.id AND pm.account_id=p.account_id
      WHERE p.account_id=$1 AND pm.family_member_id::text=ANY($2::text[]) AND p.processing_status='ready' AND ${activePredicate("p")} AND p.superseded_at IS NULL
      GROUP BY p.id,p.product_name,p.policy_number,p.renewal_or_expiry_date`, [accountId, personIds]).catch(() => ({ rows: [] }))).rows;
  if (!docs.length) return [];
  const pages = (await query<{ policy_id: string; page_number: number; text: string }>(
    `SELECT policy_id::text AS policy_id,page_number,text FROM policy_pages WHERE account_id=$1 AND policy_id::text=ANY($2::text[]) ORDER BY page_number`, [accountId, docs.map((d) => d.id)])).rows;
  const today = todayIso(now);
  const pagesFor = (id: string) => pages.filter((p) => p.policy_id === id).map((p) => ({ page: p.page_number, text: p.text }));
  const statuses = applyReinstatements(new Map(docs.map((d) => [d.id, printedStatus(pagesFor(d.id), d.renewal_or_expiry_date, today)])), docs, pagesFor);
  return docs.flatMap((d) => {
    const status = statuses.get(d.id)!;
    return status.state === "lapsed" ? [{ docId: d.id, name: d.product_name ?? "A policy", people: d.people, status }] : [];
  });
}
/** "AssureTerm 65 (lapsed on 17 March 2026) and HomeGuard (lapsed on 2 May 2026)": only what a document prints as lapsed. */
export function inactiveList(items: { name: string; status: PrintedStatus }[]) {
  const parts = items.map((i) => i.name + " (lapsed on " + i.status.printed + ")");
  return parts.length <= 1 ? parts.join("") : parts.slice(0, -1).join(", ") + " and " + parts.at(-1);
}
