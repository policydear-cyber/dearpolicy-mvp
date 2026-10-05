/**
 * Round 7: whether a document's policy still covers anyone, read from what
 * the document itself prints -- never inferred from silence.
 *
 *   lapsed    "Your policy lapsed on 17 March 2026"            (a lapse notice)
 *   grace     "Grace period ends 20 October 2026"               (a premium reminder)
 *   ended     the period of insurance printed has run out       (an old certificate)
 *   in_force  the period printed runs past today                (a current schedule)
 *   unknown   nothing printed says either way
 *
 * Every state carries the page and line that says it, so an answer can cite it.
 */
export type PrintedStatus = {
  state: "lapsed" | "grace" | "ended" | "in_force" | "reinstated" | "unknown";
  /** ISO date the status turns on (lapse date, end of grace, end of period). */
  date: string | null;
  /** The date as the document prints it ("17 March 2026"). */
  printed: string | null;
  page: number | null;
  line: string | null;
  /** grace: the premium that is unpaid and when it fell due, as printed. */
  dueAmount?: string | null;
  duePrinted?: string | null;
  /** reinstated: the lapse the reinstatement ended, as the earlier document printed it. */
  lapsedPrinted?: string | null;
  /** reinstated: the document that says so (another document of the same policy). */
  byDocId?: string | null;
};
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DATE = "(\\d{1,2})\\s+(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(\\d{4})";
export function isoOf(d: string, m: string, y: string) { return y + "-" + String(MONTHS.indexOf(m.toLowerCase()) + 1).padStart(2, "0") + "-" + d.padStart(2, "0"); }
/** "1 February 2026" from an ISO date. */
export function longDate(iso: string) { const [y, m, d] = iso.slice(0, 10).split("-"); return Number(d) + " " + MONTHS[Number(m) - 1].replace(/^\w/, (c) => c.toUpperCase()) + " " + y; }
/** Today's date where the household is (Singapore). */
export function todayIso(now = new Date()) { return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10); }
export function daysBetween(fromIso: string, toIso: string) { return Math.round((Date.parse(toIso + "T00:00:00Z") - Date.parse(fromIso + "T00:00:00Z")) / 86400_000); }

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

/** The period end a document prints ("Period of insurance 1 June 2025 to 31 May 2027", "Policy term …", "Maturity date …"). */
export function printedPeriodEnd(pages: Page[]): { iso: string; printed: string; page: number; line: string } | null {
  for (const x of lines(pages)) {
    if (!/\b(?:period of insurance|policy term|period of cover|cover period|insurance period|valid (?:until|till))\b/i.test(x.l)) continue;
    const m = x.l.match(new RegExp(DATE + "\\s+(?:to|until|till|-|–)\\s+" + DATE, "i"));
    if (m) return { iso: isoOf(m[4], m[5], m[6]), printed: m[4] + " " + m[5] + " " + m[6], page: x.page, line: x.l };
  }
  return null;
}

export function printedStatus(pages: Page[], expiryIso: string | null, today: string): PrintedStatus {
  const all = lines(pages);
  // A lapse the document states.
  for (const x of all) {
    const m = x.l.match(new RegExp("\\b(?:policy|cover|plan)?\\s*(?:has\\s+)?lapsed\\s+on\\s+" + DATE, "i"));
    if (m) return { state: "lapsed", date: isoOf(m[1], m[2], m[3]), printed: m[1] + " " + m[2] + " " + m[3], page: x.page, line: sentenceAt(pages, x.page, /lapsed\s+on/i) ?? x.l };
  }
  // A grace period the document states, with the date it ends.
  for (const x of all) {
    const m = x.l.match(new RegExp("\\bgrace period(?: ends?| ending)?(?:\\s+on)?[:\\s]+" + DATE, "i")) ?? x.l.match(new RegExp("\\bgrace period[^.]*\\bends? on\\s+" + DATE, "i"));
    if (!m) continue;
    const iso = isoOf(m[1], m[2], m[3]);
    const due = all.find((y) => y.page === x.page && /\b(?:premium due date|due date|due on)\b/i.test(y.l) && new RegExp(DATE).test(y.l));
    const dueM = due?.l.match(new RegExp(DATE));
    const amount = all.find((y) => y.page === x.page && /\b(?:monthly|annual|amount due|premium)\b/i.test(y.l) && /S\$\s?[\d,]+(?:\.\d+)?/.test(y.l))?.l.match(/S\$\s?[\d,]+(?:\.\d+)?/)?.[0] ?? null;
    // A grace period that has already run out says nothing about payment since: it is not "in force".
    return { state: iso >= today ? "grace" : "unknown", date: iso, printed: m[1] + " " + m[2] + " " + m[3], page: x.page, line: x.l,
      dueAmount: amount, duePrinted: dueM ? dueM[1] + " " + dueM[2] + " " + dueM[3] : null };
  }
  const end = printedPeriodEnd(pages);
  const endIso = end?.iso ?? expiryIso?.slice(0, 10) ?? null;
  if (endIso && endIso < today) return { state: "ended", date: endIso, printed: end?.printed ?? longDate(endIso), page: end?.page ?? null, line: end?.line ?? null };
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
      const reinstated: PrintedStatus = { state: "reinstated", date: r.iso, printed: r.printed, page: r.page, line: r.line, lapsedPrinted: st.printed, byDocId: o.id };
      statusOf.set(d.id, reinstated);
      if (["unknown", "in_force"].includes(statusOf.get(o.id)?.state ?? "unknown")) statusOf.set(o.id, reinstated);
      break;
    }
  }
  return statusOf;
}

/** One plain sentence about a policy that no longer covers anyone, or is in its grace period. */
export function statusSentence(name: string, s: PrintedStatus): string | null {
  const page = s.page != null ? " (page " + s.page + ")" : "";
  if (s.state === "lapsed") return name + " lapsed on " + s.printed + page + ", so it no longer pays for anything that happens from that date.";
  if (s.state === "reinstated") return name + (s.lapsedPrinted ? " lapsed on " + s.lapsedPrinted + " and" : "") + " was reinstated with effect from " + s.printed + page + ", so it is in force again; the reinstatement letter is the later document.";
  if (s.state === "ended") return name + " expired on " + s.printed + page + ", so it no longer covers anyone.";
  if (s.state === "grace") return name + " is in its grace period" + page + ": " + (s.dueAmount && s.duePrinted ? "the premium of " + s.dueAmount + " due on " + s.duePrinted + " has not been received. " : "a premium has not been received. ")
    + "It stays in force until " + s.printed + ", and lapses if the premium is not paid by then.";
  return null;
}

/** The household's documents (for these people) whose policy has lapsed or ended, with what each prints. */
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
    return status.state === "lapsed" || status.state === "ended" ? [{ docId: d.id, name: d.product_name ?? "A policy", people: d.people, status }] : [];
  });
}
/** "AssureTerm 65 (lapsed on 17 March 2026) and Wanderlust Single Trip (ended on 14 December 2025)". */
export function inactiveList(items: { name: string; status: PrintedStatus }[]) {
  const parts = items.map((i) => i.name + " (" + (i.status.state === "lapsed" ? "lapsed" : "ended") + " on " + i.status.printed + ")");
  return parts.length <= 1 ? parts.join("") : parts.slice(0, -1).join(", ") + " and " + parts.at(-1);
}
