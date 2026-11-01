/**
 * Round 9: what document reading stored that the chat can state, and whether
 * each of those facts is traceable to the verbatim text of its page.
 *
 * snapshot() reads one household's stored facts; audit() compares a household
 * read under the ingestion chaos stand-in with the same household read by the
 * well-behaved stand-in (the "pristine" snapshot). A fact the chaos read
 * stored that the pristine read did not is a planted fact unless plain code
 * can re-find it on its own cited page: the name, the figure (with its unit)
 * and the person. Pure apart from snapshot()'s SQL.
 */
import type { PGlite } from "@electric-sql/pglite";
import { amountAppears, locatePassage, nameAppears, printedDates } from "@/lib/documents/evidence";
import { INGEST_SENTINEL_PATTERN } from "@/lib/ai/chaos-ingest";
import { PLAN_COLUMNS_NOTE } from "@/lib/insurance/scale-limit";
import { shareCapNote } from "@/lib/policies/benefit-catalog";
import { formatMoney } from "@/lib/format/currency";
import { FIGURE_END, PRINTED_FIGURE, groupsInLakhs, printedNumber } from "@/lib/format/printed-number";
import { benefitNamePrinted, looksLikeName, personPrinted } from "@/lib/documents/fact-check";

type Row = Record<string, unknown>;
export type Snapshot = {
  pages: Record<string, Record<string, string>>;
  files: Record<string, string>;
  members: Record<string, string[]>;
  policies: Row[]; links: Row[]; coverages: Row[]; benefits: Row[]; rules: Row[]; premiums: Row[]; conditions: Row[]; detected: Row[];
};
export type Violation = { kind: string; file: string; detail: string };

const q = async (db: PGlite, sql: string, params: unknown[] = []) => (await db.query<Row>(sql, params).catch(() => ({ rows: [] as Row[] }))).rows;

export async function snapshot(db: PGlite, account: string): Promise<Snapshot> {
  const pages: Snapshot["pages"] = {}, files: Snapshot["files"] = {}, members: Snapshot["members"] = {};
  for (const r of await q(db, "SELECT policy_id::text AS p,page_number AS n,text FROM policy_pages WHERE account_id=$1", [account])) (pages[String(r.p)] ??= {})[String(r.n)] = String(r.text);
  for (const r of await q(db, "SELECT id::text AS id,original_filename AS f FROM policies WHERE account_id=$1", [account])) files[String(r.id)] = String(r.f);
  for (const r of await q(db, "SELECT id::text AS id,display_name,preferred_name FROM family_members WHERE account_id=$1", [account])) members[String(r.id)] = [String(r.display_name), ...(r.preferred_name ? [String(r.preferred_name)] : [])];
  const active = "policy_id IN (SELECT id FROM policies WHERE account_id=$1 AND lifecycle_state='active')";
  return {
    pages, files, members,
    policies: await q(db, `SELECT id::text AS id,insurer,product_name,policy_number,group_policy_number,document_role,personal_coverage_confirmed AS personal,effective_date::text AS start,renewal_or_expiry_date::text AS expiry,processing_status AS status,
      extracted_json->'documentNotes' AS notes,extracted_json->'keyExclusions' AS exclusions,extracted_json->'waitingPeriods' AS waiting,extracted_json->'deductiblesAndCoinsurance' AS deductibles,extracted_json->'riders' AS riders,
      extracted_json->>'policyholder' AS policyholder,extracted_json->'productsMentioned' AS products FROM policies WHERE account_id=$1 AND lifecycle_state='active'`, [account]),
    links: await q(db, `SELECT policy_id::text AS policy,family_member_id::text AS member,source FROM policy_members WHERE account_id=$1 AND ${active}`, [account]),
    coverages: await q(db, `SELECT policy_id::text AS policy,family_member_id::text AS member,category,amount::float AS amount,currency,source_page AS page,evidence_text AS quote,confirmed,evidence_verified AS verified FROM policy_coverages WHERE account_id=$1 AND ${active}`, [account]),
    benefits: await q(db, `SELECT policy_id::text AS policy,benefit_name AS name,formula_kind AS kind,formula_value::float AS value,currency,source_page AS page,quote,conditions,tier,row_kind,needs_review,passage_verified AS verified,duplicate_of_policy_id IS NOT NULL AS dup FROM policy_benefits WHERE account_id=$1 AND ${active}`, [account]),
    rules: await q(db, `SELECT policy_id::text AS policy,family_member_id::text AS member,plan_name,note,event_type,pays_kind,amount::float AS amount,currency,source_page AS page,quote,conditions,status,seed_key,passage_verified AS verified FROM coverage_rules WHERE account_id=$1 AND ${active} AND status<>'rejected'`, [account]),
    premiums: await q(db, `SELECT coalesce(source_document_id,policy_id)::text AS policy,family_member_id::text AS member,insurer,product_name,policy_number,amount::float AS amount,currency,frequency,payment_date::text AS paid,period_start::text AS ps,period_end::text AS pe,source_page AS page,notes FROM premium_records WHERE account_id=$1 AND coalesce(source_document_id,policy_id) IN (SELECT id FROM policies WHERE account_id=$1 AND lifecycle_state='active')`, [account]),
    conditions: await q(db, `SELECT policy_id::text AS policy,product_name,condition_kind AS kind,days,amount::float AS amount,carve_out,source_page AS page,quote FROM policy_cover_conditions WHERE account_id=$1 AND ${active}`, [account]),
    detected: await q(db, `SELECT policy_id::text AS policy,detected_name AS name,matched_family_member_id::text AS member FROM policy_detected_people WHERE account_id=$1 AND ${active}`, [account]),
  };
}

const flat = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const key = (...parts: unknown[]) => parts.map((p) => (p == null ? "" : typeof p === "number" ? String(Math.round(p * 10000) / 10000) : flat(p))).join("|");
function multiset(rows: Row[], k: (r: Row) => string) { const m = new Map<string, number>(); for (const r of rows) m.set(k(r), (m.get(k(r)) ?? 0) + 1); return m; }
const quoteOnPage = (page: string, quote: unknown) => !!quote && !!locatePassage(page, String(quote));
const DAILY = /\bper\s+day\b|\bdaily\b|\ba\s+day\b|\beach\s+day\b|\bper\s+night\b/i;
/** A system-written note, not something read from the page. */
const SYSTEM_NOTE = /^(?:The policy states this benefit as|DearPolicy read this as)/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// The share-cap note, taken from the product's own wording so the two never drift: "Paid up to <figure>, the cap ...".
const SHARE_CAP_NOTE = (() => { const [pre, post] = shareCapNote(12345, "SGD").split(formatMoney(12345, "SGD")); return new RegExp("^" + escape(pre) + "(.+?)" + escape(post) + "$"); })();
/** A note DearPolicy writes itself rather than reads from the page. One that names a figure counts only when it names
 * exactly ONE figure and the document prints it: a note is never a way to plant an amount ("up to S$75,000 and
 * S$999,999" names two, so it is not DearPolicy's note). */
export function ownNote(note: string, text: string) {
  if (SYSTEM_NOTE.test(note) || note === PLAN_COLUMNS_NOTE) return true;
  if (!SHARE_CAP_NOTE.test(note)) return false;
  const figures = note.match(new RegExp(PRINTED_FIGURE, "g")) ?? [];
  if (figures.length !== 1) return false;
  const value = printedNumber(figures[0]);
  if (value === null) return false;
  // The page prints that figure WHOLE: "S$1,936" is not printed by "S$1,936.50", and "Rp4.250.000" prints 4,250,000.
  const lakh = groupsInLakhs(text);
  return (text.match(new RegExp(PRINTED_FIGURE + FIGURE_END, "g")) ?? []).some((f) => printedNumber(f, null, { lakh }) === value);
}

export function audit(chaos: Snapshot, pristine: Snapshot): Violation[] {
  const out: Violation[] = [];
  const v = (kind: string, policy: unknown, detail: string) => out.push({ kind, file: chaos.files[String(policy)] ?? String(policy), detail: detail.slice(0, 240) });
  const page = (policy: unknown, n: unknown) => chaos.pages[String(policy)]?.[String(n)] ?? "";
  const doc = (policy: unknown) => Object.values(chaos.pages[String(policy)] ?? {}).join("\n");
  const printedName = (policy: unknown, member: unknown) => (chaos.members[String(member)] ?? []).some((n) => flat(doc(policy)).includes(flat(n)));
  const sentinel = (kind: string, policy: unknown, ...texts: unknown[]) => { for (const t of texts) { const s = typeof t === "string" ? t : JSON.stringify(t ?? ""); if (INGEST_SENTINEL_PATTERN.test(s)) { v("sentinel stored: " + kind, policy, s); return true; } } return false; };
  const pristinePolicy = new Map(pristine.policies.map((p) => [String(p.id), p]));

  // --- policies: identity, role, dates, status, free text shown on the Policies page
  for (const p of chaos.policies) {
    const was = pristinePolicy.get(String(p.id)) ?? {};
    sentinel("policy", p.id, p.insurer, p.product_name, p.policy_number, p.group_policy_number, p.policyholder, p.notes, p.exclusions, p.waiting, p.deductibles, p.riders, p.products);
    for (const field of ["insurer", "product_name"] as const) if (p[field] && flat(p[field]) !== flat(was[field]) && !nameAppears(doc(p.id), String(p[field]))) v("unprinted " + field, p.id, String(p[field]));
    if (p.policy_number && flat(p.policy_number) !== flat(was.policy_number)) v("wrong policy number", p.id, String(p.policy_number) + " (pristine " + String(was.policy_number) + ")");
    for (const field of ["start", "expiry"] as const) if (p[field] && p[field] !== was[field]) v("wrong " + field + " date", p.id, String(p[field]) + " (pristine " + String(was[field]) + ")");
    if (p.start && p.expiry && String(p.start) > String(p.expiry)) v("start after expiry", p.id, String(p.start) + " > " + String(p.expiry));
    if (p.document_role && was.document_role && p.document_role !== was.document_role) v("wrong document role", p.id, String(p.document_role) + " (pristine " + String(was.document_role) + ")");
    if (p.personal && !was.personal) v("personal cover confirmed on a non-personal document", p.id, String(p.document_role));
  }
  // --- people
  const pristineLinks = new Set(pristine.links.map((l) => key(l.policy, l.member)));
  for (const l of chaos.links) if (!pristineLinks.has(key(l.policy, l.member))) v("document linked to the wrong person", l.policy, (chaos.members[String(l.member)]?.[0] ?? String(l.member)) + " via " + String(l.source));
  const pristineDetected = new Set(pristine.detected.map((d) => key(d.policy, d.name)));
  for (const d of chaos.detected) if (!pristineDetected.has(key(d.policy, d.name)) && !personPrinted(doc(d.policy), String(d.name))) v("detected person not printed", d.policy, String(d.name));
  // --- personal cover the chat states
  const covKey = (c: Row) => key(c.policy, c.member, c.category, c.amount, c.currency);
  const pristineCov = new Set(pristine.coverages.filter((c) => c.confirmed && c.verified).map(covKey));
  for (const c of chaos.coverages.filter((c) => c.confirmed && c.verified)) {
    if (pristineCov.has(covKey(c))) continue;
    const text = page(c.policy, c.page);
    const span = locatePassage(text, String(c.quote ?? ""));
    const passage = span ? text.slice(span.start, span.end) : "";
    if (!span || c.amount == null || !amountAppears(passage, Number(c.amount), "money") || !printedName(c.policy, c.member))
      v("unverifiable cover stated", c.policy, `${chaos.members[String(c.member)]?.[0]}: ${c.category} ${c.currency ?? ""} ${c.amount} (page ${c.page}: "${String(c.quote ?? "").slice(0, 80)}")`);
  }
  // --- benefit catalogue
  const benKey = (b: Row) => key(b.policy, b.name, b.kind, b.value, b.currency, b.page, b.tier);
  const pristineBen = new Set(pristine.benefits.map(benKey));
  for (const b of chaos.benefits.filter((b) => !b.dup)) {
    sentinel("benefit", b.policy, b.name, b.conditions);
    const text = page(b.policy, b.page);
    for (const c of (Array.isArray(b.conditions) ? b.conditions : []) as string[]) if (!ownNote(c, text) && !locatePassage(text, c)) v("invented benefit condition", b.policy, String(b.name) + ": " + c);
    if (pristineBen.has(benKey(b))) continue;
    if (!quoteOnPage(text, b.quote)) { v("benefit quote not on its page", b.policy, `${b.name} p${b.page}: "${String(b.quote).slice(0, 80)}"`); continue; }
    const span = locatePassage(text, String(b.quote))!; const passage = text.slice(span.start, span.end);
    if (!benefitNamePrinted(text, String(b.name))) v("benefit name not printed", b.policy, String(b.name));
    if (!looksLikeName(String(b.name))) v("a sentence stored as a benefit name", b.policy, String(b.name));
    if (b.value != null && b.kind !== "none") {
      const kind = b.kind === "sum_insured" ? "fraction" : "money";
      if (!amountAppears(passage, Number(b.value), kind)) v("benefit figure not in its quote", b.policy, `${b.name}: ${b.kind} ${b.value} — "${passage.slice(0, 80)}"`);
      if (b.kind === "daily" && !DAILY.test(passage)) v("benefit unit not printed (daily)", b.policy, `${b.name}: "${passage.slice(0, 80)}"`);
      if (b.kind === "fixed" && DAILY.test(passage)) v("benefit unit not printed (lump sum of a daily rate)", b.policy, `${b.name}: "${passage.slice(0, 80)}"`);
    }
  }
  // --- coverage ledger
  const ruleKey = (r: Row) => key(r.policy, r.member, r.event_type, r.pays_kind, r.amount, r.currency, r.page);
  const pristineRules = new Set(pristine.rules.map(ruleKey));
  for (const r of chaos.rules) {
    sentinel("ledger rule", r.policy, r.plan_name, r.note, r.conditions);
    const text = page(r.policy, r.page);
    for (const c of (Array.isArray(r.conditions) ? r.conditions : []) as string[]) if (!ownNote(c, text) && !ownNote(c, doc(r.policy)) && !locatePassage(text, c) && !locatePassage(doc(r.policy), c)) v("invented ledger condition", r.policy, c);
    if (pristineRules.has(ruleKey(r))) continue;
    if (String(r.seed_key ?? "").startsWith("ai:") && r.note && !looksLikeName(String(r.note))) v("a sentence stored as a benefit name", r.policy, String(r.note));
    if (!quoteOnPage(text, r.quote)) { v("ledger quote not on its page", r.policy, `${r.event_type} ${r.amount} p${r.page}: "${String(r.quote).slice(0, 80)}"`); continue; }
    const span = locatePassage(text, String(r.quote))!; const passage = text.slice(span.start, span.end);
    if (r.amount != null && r.pays_kind !== "stated" && !amountAppears(passage, Number(r.amount), r.pays_kind === "percent_of_sum" ? "fraction" : "money"))
      v("ledger figure not in its quote", r.policy, `${r.event_type} ${r.pays_kind} ${r.amount} — "${passage.slice(0, 80)}"`);
    if (r.pays_kind === "per_day" && !DAILY.test(passage)) v("ledger unit not printed (per day)", r.policy, `${r.event_type} ${r.amount}: "${passage.slice(0, 80)}"`);
    if (r.pays_kind === "lump_sum" && DAILY.test(passage)) v("ledger unit not printed (lump sum of a daily rate)", r.policy, `${r.event_type} ${r.amount}: "${passage.slice(0, 80)}"`);
    if (String(r.seed_key ?? "").startsWith("ai:") && !pristineLinks.has(key(r.policy, r.member))) v("ledger rule for a person the document does not cover", r.policy, chaos.members[String(r.member)]?.[0] ?? String(r.member));
  }
  // --- premiums
  const premKey = (p: Row) => key(p.policy, p.member, p.amount, p.currency, p.frequency, p.paid, p.ps, p.pe);
  const pristinePrem = new Set(pristine.premiums.map(premKey));
  for (const p of chaos.premiums) {
    sentinel("premium", p.policy, p.insurer, p.product_name, p.policy_number);
    if (pristinePrem.has(premKey(p))) continue;
    const where = p.page != null ? page(p.policy, p.page) : doc(p.policy);
    if (p.amount != null && !amountAppears(where, Number(p.amount), "money")) v("premium not printed", p.policy, `${p.currency ?? ""} ${p.amount} (page ${p.page ?? "?"})`);
    for (const d of [p.paid, p.ps, p.pe]) if (d && !printedDates(doc(p.policy)).includes(String(d))) v("premium date not printed", p.policy, String(d));
  }
  // --- conditions
  const condKey = (c: Row) => key(c.policy, c.product_name, c.kind, c.days, c.amount, c.page, c.quote);
  const pristineCond = new Set(pristine.conditions.map(condKey));
  for (const c of chaos.conditions) {
    sentinel("condition", c.policy, c.product_name, c.carve_out, c.quote);
    if (pristineCond.has(condKey(c))) continue;
    if (!quoteOnPage(page(c.policy, c.page), c.quote)) v("condition quote not on its page", c.policy, String(c.quote).slice(0, 100));
    if (c.product_name && !nameAppears(doc(c.policy), String(c.product_name))) v("condition for an unprinted product", c.policy, String(c.product_name));
  }
  // --- duplicates: more copies of one stated fact than the pristine read stored
  const dupes = (name: string, a: Row[], b: Row[], k: (r: Row) => string) => {
    const mc = multiset(a, k), mp = multiset(b, k);
    for (const [kk, n] of mc) if (n > 1 && n > (mp.get(kk) ?? 0)) v("duplicate " + name, kk.split("|")[0], kk + " x" + n);
  };
  dupes("cover rows", chaos.coverages.filter((c) => c.confirmed && c.verified), pristine.coverages.filter((c) => c.confirmed && c.verified), (c) => key(c.policy, c.member, c.category, c.amount));
  dupes("benefit rows", chaos.benefits.filter((b) => !b.dup), pristine.benefits.filter((b) => !b.dup), (b) => key(b.policy, String(b.name).replace(/[^a-z0-9]/gi, ""), b.tier, b.kind, b.value, b.page));
  dupes("ledger rows", chaos.rules, pristine.rules, (r) => key(r.policy, r.member, r.event_type, r.pays_kind, r.amount, r.page, r.note, r.quote));
  dupes("premium rows", chaos.premiums, pristine.premiums, (p) => key(p.policy, p.member, p.amount, p.paid, p.frequency));
  return out;
}
