/**
 * V1.1 Task 2 + Task 5: the single answer path for ordinary policy questions.
 *
 * "What is Charmaine's death cover?", "Does my plan pay hospital cash?",
 * "What premium do I pay?" are answered from the facts stored when the
 * documents were read -- the right person's current documents only -- as
 * structured Assertions, each verified against its cited passage, page,
 * document version and ownership (lib/chat/assertions.ts) before anything is
 * rendered. No document-reading model call is made on this path; a model, if
 * the caller supplies one, may only rephrase the verified text, and its
 * output is rejected if it adds any number, currency, condition or negative.
 *
 * When the stored facts do not cover the topic, `handled` is false and the
 * caller may fall back to the reading path. What was not found is reported
 * as "not found in the documents read" -- never as "not covered".
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { loadPolicyInventory, prettifyFilename, type PolicyContract } from "@/lib/policies/inventory";
import { loadBenefitCatalog, type CatalogBenefit } from "@/lib/policies/benefit-catalog";
import { formatMoney, statedCurrencyCode } from "@/lib/format/currency";
import { MONEY_PATTERN, POLICY_STATED_LIMIT_LABEL, POLICY_STATED_LIMIT_NOTICE } from "@/lib/chat/monetary-boundary";
import { amountAppears, dateAppears, normalPassage, rephrasingIsFaithful, verifyAssertions, type Assertion, type AssertionDocument, type Rejection } from "./assertions";
import type { ClaimPerson } from "@/lib/claims/person";
import type { ChatAnswer, ChatCitation, PolicyStatedLimit } from "@/types";

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------
type Topic = { key: string; label: string; asks: RegExp;
  /** A fact whose own name says it is this kind of cover. */
  fact: RegExp;
  /** A document that is this kind of policy: every row on it is this kind of cover. */
  kind?: RegExp;
  /** also require the passage to say it */ passage?: RegExp };
export const TOPICS: Topic[] = [
  { key: "death", label: "death cover", asks: /\b(?:death|die[sd]?|dying|life (?:cover|insurance|assured)|term life|pass(?:es)? away)\b/i, fact: /\bdeath\b|\blife\b|term/i, kind: /\bterm\b|\blife\b|\bdeath\b/i },
  { key: "critical_illness", label: "critical illness cover", asks: /\b(?:critical illness|early critical|\bci\b|cancer|heart attack|stroke)\b/i, fact: /critical|cancer|\bci\b|living care/i, kind: /critical|cancer|living care/i },
  { key: "disability", label: "disability cover", asks: /\b(?:disab\w*|tpd|total(?:ly)? (?:and )?permanent)\b/i, fact: /disab|tpd|permanent/i, kind: /disab|\btpd\b/i },
  { key: "accident", label: "accident cover", asks: /\b(?:accident\w*|fractur\w*|injur\w*|broken bones?)\b/i, fact: /accident|fractur|injur|dismember/i, kind: /accident/i },
  // "Hospital" is named by what a hospital plan pays, not by the word
  // "medical" -- an accident plan's "Accident medical reimbursement" and a
  // travel plan's "Overseas medical expenses" are not hospital cover.
  { key: "hospital", label: "hospital cover", asks: /\b(?:hospital\w*|warded|ward|inpatient|surgery|surgical|intensive care|icu)\b|\bmedical (?:cover|coverage|plan|insurance)\b|\b(?:integrated )?shield(?: plan| policy)?\b/i,
    fact: /hospital|\bward\b|inpatient|intensive care|\bicu\b|room and board/i, kind: /hospital|shield|\bmedishield\b|health plan/i },
  { key: "premium", label: "the premium", asks: /\bpremiums?\b|how much do (?:i|we) pay for/i, fact: /premium/i },
  { key: "maturity", label: "maturity or surrender value", asks: /\b(?:matur\w*|endowment|surrender\w*|cash values?)\b/i, fact: /matur|surrender|cash value|endowment/i, kind: /endow|savings|matur/i, passage: /matur|surrender|cash value/i },
  { key: "cost_sharing", label: "deductible, co-insurance and co-payment", asks: /\bdeduct[ai]bles?\b|\bco-?insur[ae]nce\b|\bco-?pay(?:ment)?s?\b|\bpro-?ration\b|\b(?:policy[- ]year|annual) limit\b|\bas charged\b|\bhow much (?:do|would|will) (?:i|we|she|he|they) (?:have to )?pay\b/i,
    fact: /deductible|co-?insurance|co-?pay|pro-?ration|policy[- ]year limit|annual limit/i },
  { key: "rider", label: "the rider", asks: /\briders?\b/i, fact: /\brider\b/i },
  { key: "group", label: "group insurance", asks: /\b(?:group|company|employer|employee|work|office|corporate|staff)\b[^?]{0,25}\b(?:insurance|plans?|polic(?:y|ies)|cover(?:age)?|benefits?|scheme)\b|\bgroup (?:insurance|plan|policy|cover|benefits?)\b/i, fact: /(?!)/, kind: /\bgroup\b|employee benefits/i },
  { key: "dental", label: "dental cover", asks: /\b(?:dental|dentist\w*|teeth|tooth)\b/i, fact: /\bdental\b/i },
  { key: "outpatient", label: "outpatient cover", asks: /\b(?:outpatient|gp|general practitioners?|clinics?|specialists?|tcm|chinese medicine)\b/i, fact: /outpatient|general practitioner|specialist|clinic|chinese medicine/i },
  { key: "maternity", label: "maternity cover", asks: /\b(?:maternity|pregnan\w*|childbirth)\b/i, fact: /maternity|pregnan|childbirth/i },
  // Answered from the person's own column and the schedule line that names it, not from rows.
  { key: "ward", label: "ward class", asks: /\bward (?:class|type)\b|\bwhich ward\b|\bwhat ward\b|\b(?:plan|cover) tier\b|\bwhich (?:tier|plan (?:type|level))\b/i, fact: /(?!)/ },
  // Answered from the period and renewal lines the documents print.
  { key: "renewal", label: "renewal and expiry dates", asks: /\brenew\w*|\bexpir\w*|\bdue (?:date|for)\b|\bperiod of (?:insurance|cover)\b|\bvalid (?:until|till)\b|\bwhen does [^?]* (?:end|start)\b/i, fact: /(?!)/ },
  { key: "travel", label: "travel cover", asks: /\b(?:travel\w*|trip|flight|baggage|luggage|overseas|abroad)\b/i, fact: /travel|trip|flight|baggage|luggage|overseas/i, kind: /travel|trip|voyage|wander/i },
];
const GENERAL = /\bwhat (?:does|do|is) (?:my|our|his|her|their|\w+'s) (?:polic(?:y|ies)|plans?|insurance|cover(?:age)?) (?:cover|include)|\b(?:plan|policy|insurance) covers? (?:what|wat)\b|\bwhat am i covered for\b|\bwhat (?:cover|coverage|policies|insurance) do (?:i|we|they) have\b|\bsums? (?:insured|assured)\b|\bhow much (?:am i|are we|is \w+) (?:covered|insured) for\b/i;
/** A question that names one particular benefit ("a fracture benefit",
 * "intensive care") is about that benefit, not every row of the plan: a
 * fracture question must not list the permanent-loss schedule. */
const NARROW: { asks: RegExp; fact: RegExp }[] = [
  { asks: /\bfractur\w*|broken bones?\b/i, fact: /fractur/i },
  { asks: /\bintensive care|\bicu\b/i, fact: /intensive care|\bicu\b/i },
  { asks: /\broom and board\b/i, fact: /room and board/i },
  { asks: /\bsurg\w*/i, fact: /surg/i },
  { asks: /\bhospital cash|daily cash\b/i, fact: /cash/i },
  { asks: /\bevacuat\w*/i, fact: /evacuat/i },
  { asks: /\bbaggage|luggage\b/i, fact: /baggage|luggage/i },
  { asks: /\b(?:trip )?cancell?ation\b/i, fact: /cancell?ation/i },
  { asks: /\bambulance\b/i, fact: /ambulance/i },
  { asks: /\bcovid\b/i, fact: /covid/i },
  { asks: /\bdental\b|\bdentist\w*|\bteeth\b|\btooth\b/i, fact: /\bdental\b/i },
  { asks: /\btcm\b|\bchinese medicine\b/i, fact: /chinese medicine/i },
  { asks: /\bgp\b|\bgeneral practitioner/i, fact: /general practitioner/i },
  { asks: /\bspecialists?\b/i, fact: /specialist/i },
  { asks: /\bdialysis\b/i, fact: /dialysis/i },
  { asks: /\bcancer drugs?\b/i, fact: /cancer drug/i },
  { asks: /\bpro-?ration\b/i, fact: /pro-?ration/i },
  { asks: /\bdeduct[ai]bles?\b/i, fact: /deductible/i },
  { asks: /\bco-?insur[ae]nce\b/i, fact: /co-?insurance/i },
  { asks: /\bco-?pay(?:ment)?s?\b/i, fact: /co-?pay/i },
  { asks: /\b(?:annual|policy[- ]year|overall|yearly) limit\b/i, fact: /\blimit\b/i },
  { asks: /\bovers(?:eas)? medical\b/i, fact: /overseas medical/i },
  { asks: /\bpermanent (?:loss|disablement)|loss of (?:an? |one )?(?:arm|leg|hand|limb|sight)\b/i, fact: /loss of|disablement|dismember/i },
];
export function questionTopics(question: string) {
  let asked = TOPICS.filter((t) => t.asks.test(question));
  // "Which ward class is she covered for?" is about her column, not every hospital row.
  if (asked.some((t) => t.key === "ward")) asked = asked.filter((t) => t.key !== "hospital");
  // "When does her accident plan end?", "Does his group plan cover dental?":
  // the words that only name the plan are not a second topic.
  if (asked.length > 1) {
    const namingOnly = (t: Topic) => { const m = question.match(t.asks); return !!m && /^\s*(?:plan|policy|insurance|cover(?:age)?)\b/i.test(question.slice((m.index ?? 0) + m[0].length)); };
    const specific = asked.filter((t) => !namingOnly(t));
    if (specific.length) asked = specific;
  }
  // "Does his group plan cover dental?": "group plan" says which plan
  // (PLAN_KINDS scopes to it); the question is about dental.
  if (asked.length > 1 && asked.some((t) => t.key === "group")) asked = asked.filter((t) => t.key !== "group");
  // "The co-insurance on her shield plan": "shield plan" says which plan.
  const hospitalTopic = TOPICS.find((t) => t.key === "hospital")!;
  if (asked.some((t) => t.key === "cost_sharing") && !hospitalTopic.asks.test(question.replace(/\b(?:integrated )?shield(?: plan| policy)?\b|\b(?:hospital|medical) (?:plan|policy|insurance|cover)\b/gi, "")))
    asked = asked.filter((t) => t.key !== "hospital");
  // "How much do we pay in premiums?" is a premium question, not a cost-sharing one.
  if (asked.some((t) => t.key === "premium") && !/\bdeduct[ai]ble|\bco-?insur|\bco-?pay|\bpro-?ration|\blimit\b|\bas charged\b/i.test(question)) asked = asked.filter((t) => t.key !== "cost_sharing");
  // "When is the grace period for his premium?" asks about the grace period, not the premium figure.
  if (/\bgrace period\b/i.test(question)) asked = asked.filter((t) => t.key !== "premium" && t.key !== "renewal");
  // "Overseas medical cover" is a travel question; it names hospital cover
  // only if it actually says hospital, ward, surgery or intensive care.
  if (asked.some((t) => t.key === "travel") && !/\b(?:hospital\w*|warded|ward|inpatient|surg\w*|intensive care|icu)\b/i.test(question))
    return asked.filter((t) => t.key !== "hospital");
  return asked;
}

// ---------------------------------------------------------------------------
// Loading the stored facts (cheap SQL; eligible pieces cached)
// ---------------------------------------------------------------------------
type Columns = Record<string, Set<string>>;
let columnCache: Promise<Columns> | null = null;
/** Which of the V1.1 evidence columns exist yet (written by ingestion). The
 * answer path works without them and uses them when they are there. */
async function evidenceColumns(): Promise<Columns> {
  columnCache ??= query<{ table_name: string; column_name: string }>(
    `SELECT table_name,column_name FROM information_schema.columns
      WHERE table_name IN ('policy_coverages','policy_benefits','policies')
        AND column_name IN ('source_text_start','source_text_end','passage_verified','conflict_note','extraction_method','document_date')`)
    .then((r) => { const out: Columns = {}; for (const row of r.rows) (out[row.table_name] ??= new Set()).add(row.column_name); return out; })
    .catch(() => { columnCache = null; return {}; });
  return columnCache;
}
type Evidence = { source_text_start: number | null; source_text_end: number | null; passage_verified: boolean | null; conflict_note: string | null };
async function evidenceFor(table: "policy_coverages" | "policy_benefits", accountId: string, ids: string[]): Promise<Map<string, Evidence>> {
  const cols = (await evidenceColumns())[table] ?? new Set();
  const wanted = ["source_text_start", "source_text_end", "passage_verified", "conflict_note"].filter((c) => cols.has(c));
  if (!ids.length || !wanted.length) return new Map();
  const r = await query<Evidence & { id: string }>(`SELECT id::text AS id,${wanted.join(",")} FROM ${table} WHERE account_id=$1 AND id::text=ANY($2::text[])`, [accountId, ids]);
  return new Map(r.rows.map((row) => [row.id, { source_text_start: row.source_text_start ?? null, source_text_end: row.source_text_end ?? null,
    passage_verified: row.passage_verified ?? null, conflict_note: row.conflict_note ?? null }]));
}
type DocRow = { id: string; account_id: string; policy_type: string | null; policy_number: string | null; document_role: string | null; lifecycle_state: string; superseded_at: string | null; quarantine_status: string | null; file_hash: string | null;
  effective_date: string | null; renewal_or_expiry_date: string | null; document_date: string | null; product_name: string | null; insurer: string | null;
  original_filename: string; updated_at: string; personal_coverage_confirmed: boolean };

/** Page text, cached per household + document checksum + version. A new
 * version (new checksum or updated_at) is a new key, so nothing stale is
 * served; the household is part of the key, so nothing crosses households. */
const PAGE_CACHE = new Map<string, { text: string | null; at: number }>();
const PAGE_CACHE_TTL_MS = 10 * 60_000, PAGE_CACHE_MAX = 2_000;
async function pageTexts(accountId: string, docs: Map<string, DocRow>, wanted: { policyId: string; page: number }[]) {
  const key = (w: { policyId: string; page: number }) => { const d = docs.get(w.policyId); return [accountId, w.policyId, d?.file_hash ?? "", d?.updated_at ?? "", w.page].join("|"); };
  const now = Date.now(), out = new Map<string, string | null>(), missing: { policyId: string; page: number }[] = [];
  for (const w of wanted) {
    const hit = PAGE_CACHE.get(key(w));
    if (hit && now - hit.at < PAGE_CACHE_TTL_MS) out.set(w.policyId + "#" + w.page, hit.text); else missing.push(w);
  }
  if (missing.length) {
    const r = await query<{ policy_id: string; page_number: number; text: string }>(
      `SELECT pp.policy_id::text AS policy_id,pp.page_number,pp.text FROM policy_pages pp
         JOIN unnest($2::text[],$3::int[]) AS w(policy_id,page) ON w.policy_id=pp.policy_id::text AND w.page=pp.page_number
        WHERE pp.account_id=$1`, [accountId, missing.map((m) => m.policyId), missing.map((m) => m.page)]);
    const found = new Map(r.rows.map((row) => [row.policy_id + "#" + row.page_number, row.text]));
    for (const m of missing) {
      const text = found.get(m.policyId + "#" + m.page) ?? null;
      out.set(m.policyId + "#" + m.page, text);
      if (PAGE_CACHE.size >= PAGE_CACHE_MAX) PAGE_CACHE.delete(PAGE_CACHE.keys().next().value as string);
      PAGE_CACHE.set(key(m), { text, at: now });
    }
  }
  return out;
}

/** The verbatim span of `page` that supports a stored fact: the recorded
 * offsets when ingestion stored them, else the stored quote as it appears on
 * the page, else the sentence on the page that contains the amount. Returns
 * the stored quote unchanged when none of those is on the page -- which the
 * verifier then rejects as a citation to the wrong place. */
export function locatePassage(page: string | null, opts: { start?: number | null; end?: number | null; quote?: string | null; amount?: number | null }): string {
  if (page && opts.start != null && opts.end != null && opts.start >= 0 && opts.end > opts.start && opts.end <= page.length) return page.slice(opts.start, opts.end).trim();
  const quote = (opts.quote ?? "").trim();
  if (page && quote) {
    if (normalPassage(page).includes(normalPassage(quote))) return quote;
  }
  if (page && opts.amount != null) {
    const sentence = page.split(/(?<=[.;\n])\s+/).find((s) => amountAppears(opts.amount!, s));
    if (sentence) return sentence.trim().slice(0, 400);
  }
  return quote;
}
function shortDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
/** A money figure the way a schedule prints it: "S$800", not "S$800.00". */
function money(amount: number, currency: string) { const text = formatMoney(amount, currency); return Number.isInteger(amount) ? text.replace(/\.00$/, "") : text; }

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------
export type PolicyAnswerArgs = {
  accountId: string; question: string;
  /** The insured people this question is about, already resolved by the caller (same household). */
  people: ClaimPerson[];
  now?: Date;
  /** Optional rephrasing of the verified text. Its output is checked and discarded if it adds anything. */
  narrate?: (input: { question: string; text: string; assertions: Assertion[] }) => Promise<string | null>;
};
export type PolicyAnswer = Pick<ChatAnswer, "mode" | "summary" | "details" | "citations" | "confidence" | "nextSteps" | "questions" | "verifiedPolicyFactsOnly" | "verifiedPolicyFigures"> & { policyStatedLimits: PolicyStatedLimit[] };
export type PolicyAnswerResult = {
  /** false: the stored facts do not cover this topic; the caller may read the documents instead. */
  handled: boolean;
  answer: PolicyAnswer;
  kept: Assertion[]; rejected: Rejection[];
  topics: string[]; notFound: string[];
  modelCalls: number; narrated: boolean; elapsedMs: number;
};
type Candidate = Assertion & { id: string; source: "coverage" | "benefit" | "premium" | "row" | "condition" | "expiry"; topic: string; title: string; ownerName: string;
  /** The table column (plan tier / ward class / person class) a value was printed under. */
  tier?: string | null; rowKind?: string | null; tierLabel?: string | null };
/** A stored fact before its passage is located on the page. */
type RawCandidate = Omit<Candidate, "passage"> & { quote: string | null; start: number | null; end: number | null; storedConditions?: string[] };

// ---------------------------------------------------------------------------
// Deterministic reading of stored page text: schedule rows and condition lines
// ---------------------------------------------------------------------------
type PageRow = { page: number; index: number; label: string; value: string; line: string };
type ConditionLine = { page: number; index: number; line: string; heading?: string | null };
/** Text addressed to a reader or a model rather than stating a term. */
const INSTRUCTION = /\b(?:ignore (?:all |any )?(?:the )?(?:previous|prior|above|earlier) (?:instructions|rules)|note to (?:ai|assistants?|the model|models)|ai assistants?|system prompt|you are (?:an? )?(?:ai|assistant|language model))\b/i;
const FURNITURE = /SYNTHETIC(?:-[A-Z0-9-]+)? TEST DOCUMENT|^Page \d+ of \d+$|DPTEST|^[A-Za-z0-9+/=]{40,}$/i;
const META_LABEL = /^(?:policy ?(?:number|no\.?|type)|certificate (?:number|no\.?)|member(?:ship)? (?:number|no\.?)|insured(?: persons?)?|life assured|policyholder|group policyholder|issued by|effective date(?: of endorsement)?|expiry date|end date|start date|currency|plan(?: name)?|period of insurance|(?:policy |renewal |cover(?:age)? )?period|date of (?:issue|birth)|issue date|payment (?:due date|mode|date)|policy term|premium term|grace period)$/i;
const MONTH_DATE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/i;
/** Words product names share with ordinary questions ("the annual limit",
 * "my family", "group cover"): they never name one document. */
const COMMON_PRODUCT_WORD = /^(?:annual|family|group|premier|premium|programme|program|plus|classic|basic|standard|personal|accident|travel|health|hospital|medical|life|term|secure|guardian|shield|care|protect|protection|saver|gold|silver|platinum|benefits?|employee|schedule|certificate|renewal|notice|integrated|critical|illness|cover|global|family|essential|elite|advantage)$/i;
/** A premium the household pays, printed in a schedule or notice. Never a
 * benefit, a limit or a conflicting figure for a benefit. */
export const PREMIUM_ROW = /\bpremium\b|\bmedisave\b|\bcash payable\b|\bamount (?:due|payable)\b|^\s*less\s*:/i;
/** Rows ("Label<TAB>value") and, on a conditions page, its sentences, exactly
 * as stored. Nothing is inferred; a row is only what the page prints. */
export function readPage(page: number, text: string) {
  const rows: PageRow[] = [], conditions: ConditionLine[] = [], meta: PageRow[] = [], premiums: PageRow[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const heading = lines.find((l) => l && !FURNITURE.test(l)) ?? "";
  // A page with a multi-column table (a line of three or more cells) is read
  // from the typed rows ingestion stores per column. Its two-cell lines are
  // the wrapped remainders of those cells ("ward)<TAB>(B1 ward)",
  // "days<TAB>days"), never label-value rows.
  const tablePage = lines.some((l) => (l.match(/\t/g) ?? []).length >= 2);
  // Prose (everything that is not a table cell) is re-joined across wrapped
  // lines and read as whole sentences, each under the numbered heading it
  // sits beneath ("5. Grace period"), so a condition is never cut mid-line.
  let prose: { index: number; text: string; heading: string | null }[] = [];
  let section: string | null = /\b(?:exclusions?|conditions|general provisions)\b/i.test(heading) ? heading.replace(/\s+/g, " ") : null;
  const flush = () => {
    const joined = prose.map((p) => p.text).join(" ").replace(/\s+/g, " ").trim();
    if (joined) for (const sentence of joined.split(/(?<=[.;])\s+(?=[A-Z(“"'-])/)) {
      const clean = sentence.replace(/^[-•*]\s*/, "").trim();
      // Terms are read on a conditions page, under a section heading, or where
      // the line names the term; loose text elsewhere (and anything addressed
      // to a reader, "ignore previous instructions") is never a condition.
      const isTerm = !!prose[0].heading || /^(?:waiting period|survival period|grace period|exclusions?|alternative benefits?)\s*:/i.test(clean);
      if (clean.length >= 12 && isTerm && !INSTRUCTION.test(clean)) conditions.push({ page, index: prose[0].index * 100 + conditions.length, line: clean, heading: prose[0].heading });
    }
    prose = [];
  };
  lines.forEach((line, index) => {
    if (!line || FURNITURE.test(line) || line === heading) { flush(); return; }
    const row = line.match(/^([^\t]{2,80})\t([^\t]{1,200})$/);
    if (row) {
      flush();
      let label = row[1].trim();
      // A label wrapped onto the next line ("... late" / "stage)") is one label.
      const next = lines[index + 1] ?? "";
      if ((label.match(/\(/g) ?? []).length > (label.match(/\)/g) ?? []).length && /^[a-z][^\t]{0,40}\)$/.test(next)) label += " " + next;
      const r = { page, index, label, value: row[2].trim(), line };
      // A table's own header ("Item<TAB>Amount") is not a row.
      if (/^(?:item|benefit|description|particulars|section|details?|cover(?:age)?)$/i.test(r.label) && /^(?:amount|value|benefit|limit|sum (?:insured|assured)|premium|details?)$/i.test(r.value)) return;
      // A continuation of a wrapped cell starts mid-sentence.
      if (/^[a-z(]/.test(r.label) || !/[A-Za-z]{3}/.test(r.label)) return;
      if (META_LABEL.test(r.label) || (MONTH_DATE.test(r.value) && !MONEY_IN_TEXT.test(r.value))) { meta.push(r); return; }
      if (PREMIUM_ROW.test(r.label)) { premiums.push(r); return; }
      if (!tablePage) rows.push(r);
      return;
    }
    if ((line.match(/\t/g) ?? []).length || /^Dear\b[^.]{0,60},$/.test(line)) { flush(); return; }
    // A wrapped continuation of a label ("stage)") belongs to the row above.
    if (/^[a-z][^\t]{0,40}\)$/.test(line) && /\t/.test(lines[index - 1] ?? "")) return;
    const numbered = line.match(/^(?:\d{1,2}[.)]|[A-Z][.)])\s+([A-Z][^.]{2,60})$/);
    if (numbered || /^[A-Z][A-Z &'-]{4,60}$/.test(line)) { flush(); section = numbered ? numbered[1].trim() : line; return; }
    prose.push({ index, text: line, heading: section });
  });
  flush();
  return { rows, conditions, meta, premiums };
}
const MONEY_IN_TEXT = /(S\$|SG\$|US\$|HK\$|A\$|SGD|USD|HKD|AUD|MYR|RM|EUR|GBP|JPY|€|£|¥)\s?(\d[\d,]*(?:\.\d+)?)/i;
/** The first amount a printed value states, with its printed currency; or
 * the bare number when the value prints no currency at all. */
export function printedAmount(value: string): { amount: number | null; currency: string | null; bare: boolean } {
  const m = value.match(MONEY_IN_TEXT);
  if (m) { const currency = statedCurrencyCode(m[1]); return { amount: currency ? Number(m[2].replace(/,/g, "")) : null, currency, bare: !currency }; }
  // "150 per day" prints an amount without a currency; a date, a count of
  // days, a percentage or a multiple ("5 x MediShield Life limit") does not.
  if (MONTH_DATE.test(value)) return { amount: null, currency: null, bare: false };
  const bare = /^\s*(?:up to\s+)?\d[\d,]*(?:\.\d+)?(?!\s*(?:%|x\b|times\b|days?\b|months?\b|years?\b|hours?\b|nights?\b|weeks?\b))(?:\s|$)/i.test(value);
  return { amount: null, currency: null, bare };
}
/** Pages of the documents in play, cached per household + checksum + version. */
async function documentPages(accountId: string, docs: Map<string, DocRow>) {
  const ids = [...docs.keys()];
  if (!ids.length) return new Map<string, { page: number; text: string }[]>();
  const r = await query<{ policy_id: string; page_number: number; text: string }>(
    `SELECT policy_id::text AS policy_id,page_number,text FROM policy_pages WHERE account_id=$1 AND policy_id::text=ANY($2::text[]) ORDER BY policy_id,page_number`, [accountId, ids]);
  const out = new Map<string, { page: number; text: string }[]>();
  for (const row of r.rows) (out.get(row.policy_id) ?? out.set(row.policy_id, []).get(row.policy_id)!).push({ page: row.page_number, text: row.text });
  return out;
}
const CONDITION_QUESTION = /\bwaiting period|\bsurvival period|\bgrace period|\bexclu\w*|\bpre-existing|\bboth\b[^?]*\b(?:paid|payable|pay)\b|\balternative benefits?|\bonly the higher\b/i;
const SUBJECTS = /\b(dental|maternity|pregnan\w*|cosmetic|mental|psychiatric|hiv|war|terroris\w*|suicide|self-inflicted|professional sports?|pre-existing)\b/i;
const PLAN_KINDS: { re: RegExp; kind: string }[] = [
  { re: /\bhospital (?:plan|policy|insurance|cover)\b|\b(?:integrated )?shield (?:plan|policy)\b/i, kind: "hospital" },
  { re: /\btravel (?:plan|policy|insurance|cover)\b/i, kind: "travel" },
  { re: /\b(?:personal )?accident (?:plan|policy|insurance)\b|\bpa (?:plan|policy|cover)\b/i, kind: "accident" },
  { re: /\b(?:group |term )?life (?:plan|policy|insurance|cover)\b|\bterm (?:plan|policy)\b/i, kind: "death" },
  { re: /\bendowment\b/i, kind: "maturity" },
  { re: /\bcritical illness (?:plan|policy|cover)\b/i, kind: "critical_illness" },
  { re: /\b(?:group|company|employer|work) (?:plan|policy|insurance|cover)\b/i, kind: "group" },
];
/** Schedule terms (round 5 typed rows): cost-sharing and limits printed in a
 * benefit table. Stated as the document prints them; never calculated. */
const COST_SHARING_KINDS = new Set(["deductible", "co_insurance", "co_payment", "co_payment_cap", "pro_ration", "policy_year_limit", "family_limit"]);
function scheduleTermText(kind: string, value: number | null, currency: string | null): { text: string; amount: number | null } | null {
  const amount = value != null && value > 0 && currency ? value : null;
  const percent = value != null && value > 0 && value <= 1 ? Math.round(value * 10000) / 100 + "%" : null;
  switch (kind) {
    case "as_charged": return { text: "as charged", amount: null };
    case "not_covered": return { text: "the schedule prints “Not covered” in this column", amount: null };
    case "unlimited": return { text: "no limit printed", amount: null };
    case "deductible": return amount != null ? { text: "deductible of " + money(amount, currency!) + " (paid by you first)", amount } : null;
    case "co_insurance": return percent ? { text: "you pay " + percent + " (co-insurance)", amount: null } : null;
    case "co_payment": return amount != null ? { text: "co-payment of " + money(amount, currency!), amount } : percent ? { text: "co-payment of " + percent, amount: null } : null;
    case "co_payment_cap": return amount != null ? { text: "your co-payment is capped at " + money(amount, currency!) + " a policy year", amount } : null;
    case "pro_ration": return percent ? { text: "pro-ration factor of " + percent + ", applied when you stay in a higher ward than your plan covers", amount: null } : { text: "the schedule prints “Not applicable” in this column", amount: null };
    case "policy_year_limit": case "family_limit": return amount != null ? { text: "limit of " + money(amount, currency!) + (kind === "family_limit" ? " for the family" : " a policy year"), amount } : null;
    default: return null;
  }
}
/** Same rule as ingestion's tierApplies: a column heading may carry more
 * words than the stored class ("Plan A (Grade M2 and above)"). */
export function tierApplies(rowTier: string | null | undefined, memberTier: string | null | undefined) {
  if (!rowTier || !memberTier) return true;
  const row = rowTier.toLowerCase().replace(/\s+/g, " ").trim(), member = memberTier.toLowerCase().replace(/\s+/g, " ").trim();
  return row === member || (row.startsWith(member) && !/[a-z0-9]/.test(row.charAt(member.length)));
}
async function tableTerms(accountId: string, ids: string[]) {
  const out = new Map<string, { tier: string | null; rowKind: string | null }>();
  if (!ids.length) return out;
  const r = await query<{ id: string; tier: string | null; row_kind: string | null }>(
    `SELECT id::text AS id,to_jsonb(b)->>'tier' AS tier,to_jsonb(b)->>'row_kind' AS row_kind FROM policy_benefits b WHERE account_id=$1 AND id::text=ANY($2::text[])`, [accountId, ids]).catch(() => ({ rows: [] as { id: string; tier: string | null; row_kind: string | null }[] }));
  for (const row of r.rows) out.set(row.id, { tier: row.tier || null, rowKind: row.row_kind || null });
  return out;
}
async function memberTiers(accountId: string, docIds: string[]) {
  const out = new Map<string, string>();
  if (!docIds.length) return out;
  const r = await query<{ policy_id: string; family_member_id: string; tier: string | null }>(
    `SELECT policy_id::text AS policy_id,family_member_id::text AS family_member_id,to_jsonb(pm)->>'benefit_tier' AS tier FROM policy_members pm WHERE account_id=$1 AND policy_id::text=ANY($2::text[])`, [accountId, docIds]).catch(() => ({ rows: [] as { policy_id: string; family_member_id: string; tier: string | null }[] }));
  for (const row of r.rows) if (row.tier) out.set(row.policy_id + "|" + row.family_member_id, row.tier);
  return out;
}
/** "Death" and "Death benefit" and "Death (any cause)" are the same thing. */
function sameThingKey(title: string) {
  return title.toLowerCase().replace(/\(.*?\)/g, " ").replace(/\b(?:benefits?|sum (?:insured|assured)|cover(?:age)?)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

export async function answerPolicyQuestion(args: PolicyAnswerArgs): Promise<PolicyAnswerResult> {
  const started = Date.now(), now = args.now ?? new Date();
  const empty = (): PolicyAnswer => ({ mode: "answer", summary: "", details: [], citations: [], confidence: "insufficient_evidence", nextSteps: [], questions: [], policyStatedLimits: [] });
  const topics = questionTopics(args.question), general = GENERAL.test(args.question);
  const conditionAsked = CONDITION_QUESTION.test(args.question) || SUBJECTS.test(args.question);
  const result = (partial: Partial<PolicyAnswerResult>): PolicyAnswerResult => ({ handled: false, answer: empty(), kept: [], rejected: [], topics: topics.map((t) => t.key),
    notFound: [], modelCalls: 0, narrated: false, elapsedMs: Date.now() - started, ...partial });
  if (!args.people.length || (!topics.length && !general && !conditionAsked)) return result({});

  const inventory = await loadPolicyInventory(args.accountId, args.people);
  const contracts: PolicyContract[] = inventory.contracts.filter((c) => args.people.some((p) => p.id === c.ownerId));
  const speaksFor = new Map<string, Set<string>>();
  for (const c of contracts) for (const d of [...c.documents, ...c.references]) (speaksFor.get(d.id) ?? speaksFor.set(d.id, new Set()).get(d.id)!).add(c.ownerId);
  // A ready document linked to the person that is not one of their contracts
  // (a renewal notice, an employer's group benefits booklet that names them
  // with their plan) speaks for them too, and every line from it says what it is.
  const linkedRows = await query<{ policy_id: string; family_member_id: string }>(
    `SELECT pm.policy_id::text AS policy_id,pm.family_member_id::text AS family_member_id FROM policy_members pm JOIN policies p ON p.id=pm.policy_id AND p.account_id=pm.account_id
      WHERE pm.account_id=$1 AND pm.family_member_id::text=ANY($2::text[]) AND p.processing_status='ready' AND ${activePredicate("p")} AND p.superseded_at IS NULL`,
    [args.accountId, args.people.map((p) => p.id)]).catch(() => ({ rows: [] as { policy_id: string; family_member_id: string }[] }));
  for (const r of linkedRows.rows) (speaksFor.get(r.policy_id) ?? speaksFor.set(r.policy_id, new Set()).get(r.policy_id)!).add(r.family_member_id);
  if (!speaksFor.size) return result({ notFound: topics.map((t) => t.label) });
  const docIds = [...speaksFor.keys()];
  const cols = await evidenceColumns();
  const docRows = await query<DocRow>(
    `SELECT id::text AS id,account_id::text AS account_id,lifecycle_state,superseded_at::text,quarantine_status,file_hash,effective_date::text,renewal_or_expiry_date::text,
            ${cols.policies?.has("document_date") ? "document_date::text" : "NULL::text"} AS document_date,product_name,insurer,original_filename,updated_at::text,personal_coverage_confirmed,policy_type,policy_number,document_role
       FROM policies WHERE account_id=$1 AND id::text=ANY($2::text[]) AND ${activePredicate()}`, [args.accountId, docIds]);
  const docs = new Map(docRows.rows.map((d) => [d.id, d]));
  const docName = (id: string) => { const d = docs.get(id); return d?.product_name ?? (d ? prettifyFilename(d.original_filename) : "Policy document"); };
  const pagesByDocEarly = new Map<string, { page: number; text: string }[]>();
  /** What kind of document a line comes from, when it is not the person's own schedule. */
  const isGuide = (id: string) => { const d = docs.get(id); return !!d && !d.personal_coverage_confirmed && /benefit_guide|benefit_summary|product_summary/.test(d.document_role ?? ""); };
  const docKind = (id: string, page?: number | null) => { const d = docs.get(id); if (!d) return ""; if (isGuide(id)) { const section = page != null ? sectionOf(id, page) : null; return " (group benefits booklet" + (section ? ", " + section : "") + ")"; } if (/renewal/.test(d.document_role ?? "")) return " (renewal notice)"; return ""; };
  /** A booklet section's own title ("SECTION 2 - GROUP HOSPITAL AND SURGICAL (GHS)" -> "Group hospital and surgical (GHS)"). */
  const sectionOf = (docId: string, page: number) => {
    const lines = ((pagesByDocEarly.get(docId) ?? []).find((p) => p.page === page)?.text ?? "").split(/\r?\n/).map((l) => l.trim());
    const at = lines.findIndex((l) => /^section\s+\d+\s*[-–—:]/i.test(l));
    // A heading wrapped onto the next line ("... AND GROUP PERSONAL" /
    // "ACCIDENT (GPA)") is one heading.
    const next = at >= 0 ? lines[at + 1] ?? "" : "";
    const heading = at < 0 ? null : lines[at] + (next && next === next.toUpperCase() && /[A-Z]/.test(next) && next.length <= 60 && !/^section\b|\d{2,}|[:.]$/i.test(next) ? " " + next : "");
    const title = heading?.replace(/^section\s+\d+\s*[-–—:]\s*/i, "").trim();
    return title ? title.toLowerCase().replace(/^\w/, (c) => c.toUpperCase()).replace(/\(([a-z]{2,5})\)/g, (_m, a: string) => "(" + a.toUpperCase() + ")").replace(/\b(?:gp|tcm|ghs|gtl|gpa|gci|gsp|icu|hdb|cpf)\b/g, (a) => a.toUpperCase()) : null;
  };
  const evidenceLabel = (id: string) => { const d = docs.get(id); return isGuide(id) ? "Group benefits booklet" : /renewal/.test(d?.document_role ?? "") ? "Renewal notice" : d?.personal_coverage_confirmed ? "Your policy document" : "Policy wording"; };
  // How the household refers to a person: the name they use, not the legal one.
  const personName = (id: string) => { const p = args.people.find((x) => x.id === id); return p ? (p.preferred_name?.trim() || p.display_name) : ""; };
  const isSelf = (id: string) => /^self$/i.test(args.people.find((x) => x.id === id)?.relationship ?? "");
  // What kind of policy each document is, from its type, product name and the
  // covers stored on it. A row on a hospital plan is hospital cover; a row on
  // an accident plan is accident cover, whatever medical words it uses.
  const docKindText = new Map<string, string>();
  for (const [docId, d] of docs) docKindText.set(docId, [d.policy_type, d.product_name, ...contracts.flatMap((c) => c.coverages.filter((v) => v.policyId === docId).map((v) => v.category))].filter(Boolean).join(" "));
  const kindsOf = (docId: string) => TOPICS.filter((t) => t.kind && t.kind.test(docKindText.get(docId) ?? "")).map((t) => t.key);
  // A benefit the question names ("hospital cash", "ambulance") is that benefit on whatever plan prints it.
  const namedBenefit = NARROW.filter((n) => n.asks.test(args.question));
  const topicOf = (label: string, passage: string, docId: string, page?: number | null) => {
    const kinds = kindsOf(docId);
    if (topics.length && namedBenefit.some((n) => n.fact.test(label))) return topics[0].key;
    // A row whose own name says what it is ("Dental") belongs to that topic
    // before it belongs to the plan's kind ("group insurance").
    const byName = topics.find((t) => t.fact.test(label) && !(t.passage && !t.passage.test(label + " " + passage)) && !kinds.some((k) => k !== t.key && (k === "accident" || k === "travel" || (k === "hospital" && t.key !== "cost_sharing"))));
    if (byName && topics.length > 1) return byName.key;
    for (const t of topics) {
      if (t.passage && !t.passage.test(label + " " + passage)) continue;
      // Every row of a plan of this kind belongs to the topic.
      if (kinds.includes(t.key)) return t.key;
      // A row whose own name says so belongs, unless it sits on a plan of a
      // different specific kind (an accident or travel plan's "hospital" row
      // pays only for an accident or a trip).
      if (t.fact.test(label) && !kinds.some((k) => k !== t.key && (k === "accident" || k === "travel" || (k === "hospital" && t.key !== "cost_sharing")))) return t.key;
      // A rider's rows are named by the rider's page, not by the word "rider".
      if (t.key === "rider" && page != null && riderPages.has(docId + "#" + page)) return t.key;
    }
    return !topics.length && general ? "general" : null;
  };
  // Which documents the question is about: one it names ("her CritiCare
  // plan"), or plans of the kind it names ("her hospital plan").
  const namedDocs = [...docs.values()].filter((d) => (d.product_name ?? "").split(/[^A-Za-z0-9]+/)
    .some((token) => token.length >= 5 && !/^(?:synthetic|dptest|policy|insurance|plan)$/i.test(token) && !COMMON_PRODUCT_WORD.test(token) && !/\d/.test(token) && new RegExp("\\b" + token + "\\b", "i").test(args.question))).map((d) => d.id);
  const plannedKinds = PLAN_KINDS.filter((p) => p.re.test(args.question)).map((p) => p.kind);
  const kindDocs = plannedKinds.length ? [...docs.keys()].filter((id) => kindsOf(id).some((k) => plannedKinds.includes(k))) : [];
  // A group booklet holds several plans; it is "a hospital plan" for the
  // pages that are one (its GHS section), so it stays in scope for them.
  const guideHasKind = (docId: string) => isGuide(docId) && plannedKinds.some((k) => { const kind = TOPICS.find((t) => t.key === k)?.kind; return !!kind && (pagesByDocEarly.get(docId) ?? []).some((p) => kind.test(p.text.split(/\r?\n/).slice(0, 4).join(" "))); });
  const inScope = (docId: string) => namedDocs.length ? namedDocs.includes(docId) : kindDocs.length ? kindDocs.includes(docId) || guideHasKind(docId) : true;

  // Stored facts and printed rows, as candidate assertions.
  const candidates: RawCandidate[] = [];
  const pagesByDoc = await documentPages(args.accountId, docs);
  for (const [k, v] of pagesByDoc) pagesByDocEarly.set(k, v);
  const read = new Map([...pagesByDoc].map(([docId, pages]) => [docId, pages.map((p) => readPage(p.page, p.text))]));
  /** The cell a multi-column table prints for one row in one column. */
  const printedCell = (docId: string, page: number | null, rowName: string, tier: string | null) => {
    if (!tier || page == null) return null;
    const lines = ((pagesByDoc.get(docId) ?? []).find((p) => p.page === page)?.text ?? "").split(/\r?\n/);
    const cells = (l: string) => l.split("\t").map((c) => c.trim());
    const header = lines.find((l) => (l.match(/\t/g) ?? []).length >= 1 && cells(l).some((c) => c.toLowerCase() === tier.toLowerCase()));
    const row = lines.find((l) => l.includes("\t") && cells(l).slice(0, 2).some((c) => normalPassage(c).startsWith(normalPassage(rowName).slice(0, 14))));
    if (!header || !row) return null;
    const index = cells(header).findIndex((c) => c.toLowerCase() === tier.toLowerCase());
    const cell = cells(row)[index];
    return cell && cell.length <= 120 ? cell : null;
  };
  /** A rider's name as the document writes it in running text ("ShieldCare Plus Rider"). */
  const riderName = (docId: string, page: number) => {
    const pages = pagesByDoc.get(docId) ?? [];
    const heading = (pages.find((p) => p.page === page)?.text.split(/\r?\n/).map((l) => l.trim()).find((l) => /\brider\b/i.test(l)) ?? "").split(/\s+[-–—]\s+/)[0].trim();
    if (!heading) return docName(docId);
    const re = new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "gi");
    const mixed = pages.flatMap((p) => p.text.match(re) ?? []).find((m) => m !== m.toUpperCase());
    return mixed ?? heading.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  };
  // Pages whose own heading is a rider's ("SHIELDCARE PLUS RIDER - SCHEDULE OF BENEFITS").
  const riderPages = new Set([...pagesByDoc].flatMap(([docId, pages]) => pages.filter((p) => /\brider\b/i.test(p.text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !FURNITURE.test(l) && !/\(fictitious\)$|^[A-Z][a-z]+ [A-Z][a-z]+ (?:Assurance|Insurance|Life)/.test(l)) ?? "")).map((p) => docId + "#" + p.page)));
  // Printed schedule rows: the row itself is the passage, so what is shown is
  // exactly what the page prints -- including a value printed with no currency.
  for (const [docId, pages] of read) for (const page of pages) for (const row of page.rows) {
    const topic = topicOf(row.label, row.line, docId, row.page);
    if (!topic) continue;
    const printed = printedAmount(row.value);
    for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "row:" + docId + ":" + row.page + ":" + row.index, source: "row", topic, title: row.label, ownerName: personName(ownerId),
      kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: row.page,
      text: row.label + ": " + row.value + (printed.bare ? " (no currency is printed for this amount)" : ""),
      amount: printed.amount, currency: printed.amount != null ? printed.currency : null, quote: row.line, start: null, end: null });
  }
  const printedTitle = (docId: string, title: string) => candidates.some((c) => c.source === "row" && c.policyId === docId && normalPassage(c.title) === normalPassage(title));
  const coverages = contracts.flatMap((c) => c.coverages.map((v) => ({ c, v })));
  const coverageEvidence = await evidenceFor("policy_coverages", args.accountId, coverages.map(({ v }) => v.id));
  for (const { c, v } of coverages) {
    const topic = topicOf(v.category, v.evidenceText ?? "", v.policyId);
    if (!topic) continue;
    const currency = statedCurrencyCode(v.currency);
    const e = coverageEvidence.get(v.id);
    const hasFigure = v.amount != null && v.amount > 0 && !!currency;
    if (!hasFigure) continue; // "cover is listed" is not an answer; the rows say what it pays
    // The stored passage_verified flag for coverage rows is not used as a
    // veto: verifyAssertions re-finds the amount and currency in the cited
    // passage itself, which is the check that flag stands for.
    candidates.push({ id: "coverage:" + v.id, source: "coverage", topic, title: v.category, ownerName: personName(c.ownerId) || c.ownerName,
      kind: "policy_fact", subjectId: c.ownerId, policyId: v.policyId, documentHash: docs.get(v.policyId)?.file_hash ?? null, page: v.sourcePage,
      text: v.category + " sum insured: " + money(v.amount!, currency!), amount: v.amount, currency,
      conflictNote: e?.conflict_note ?? null, quote: v.evidenceText, start: e?.source_text_start ?? null, end: e?.source_text_end ?? null });
  }
  if (topics.length) {
    let catalog: CatalogBenefit[] = [];
    try { catalog = await loadBenefitCatalog(args.accountId, docIds); } catch { catalog = []; }
    const benefitEvidence = await evidenceFor("policy_benefits", args.accountId, catalog.map((b) => b.id));
    // Round 5 (written by ingestion when present): the table column a value
    // was printed under and what kind of schedule term the row is.
    const typed = await tableTerms(args.accountId, catalog.map((b) => b.id));
    const memberTier = await memberTiers(args.accountId, docIds);
    // A multi-column table's columns are person classes / plan tiers only when
    // one of them is the person's own; then only that column is theirs.
    const tierOf = (b: CatalogBenefit) => typed.get(b.id)?.tier ?? null;
    const tableHasTier = (docId: string, page: number | null, tier: string) => catalog.some((x) => x.policyId === docId && x.sourcePage === page && tierApplies(tierOf(x), tier) && !!tierOf(x));
    for (const b of catalog) {
      const rowKind = typed.get(b.id)?.rowKind ?? null, tier = tierOf(b);
      // A premium is never a benefit, a limit or a conflict.
      if (PREMIUM_ROW.test(b.benefitName)) continue;
      const onRider = topics.some((t) => t.key === "rider") && b.sourcePage != null && riderPages.has(b.policyId + "#" + b.sourcePage);
      const topic = onRider ? "rider" : rowKind && COST_SHARING_KINDS.has(rowKind) && topics.some((t) => t.key === "cost_sharing") ? "cost_sharing" : topicOf(b.benefitName, b.quote, b.policyId, b.sourcePage);
      if (!topic) continue;
      const e = benefitEvidence.get(b.id);
      // Printed on the page as a row: the row is shown; a conflict the
      // ingestion recorded for this benefit is carried onto it.
      if (printedTitle(b.policyId, b.benefitName)) {
        if (e?.conflict_note) for (const c of candidates) if (c.source === "row" && c.policyId === b.policyId && normalPassage(c.title) === normalPassage(b.benefitName)) c.conflictNote = e.conflict_note;
        continue;
      }
      for (const ownerId of speaksFor.get(b.policyId) ?? []) {
        const own = memberTier.get(b.policyId + "|" + ownerId) ?? null;
        // The person's own column only (Private hospital for a private-ward
        // plan, Child for a child); a person whose class is not known sees
        // every column, each labelled.
        if (tier && own && tableHasTier(b.policyId, b.sourcePage, own) && !tierApplies(tier, own)) continue;
        const currency = statedCurrencyCode(b.currency);
        const value = b.formulaValue;
        let text = b.benefitName, amount: number | null = null;
        // The column heading is shown beside the line (not inside the
        // verified sentence: "B1 ward" is not printed in the row itself).
        const tierLabel = tier && !(own && tierApplies(tier, own)) ? tier : null;
        if (rowKind && rowKind !== "benefit") {
          const term = scheduleTermText(rowKind, value, currency);
          // A cell with no figure ("Covered in full (you pay nothing towards
          // the deductible)", "No cap") is shown as the schedule prints it.
          const cell = term ? null : printedCell(b.policyId, b.sourcePage, b.benefitName, tier);
          if (!term && !cell) continue;
          text += ": " + (term ? term.text : cell); amount = term ? term.amount : null;
        } else if (tier && (value == null || b.formulaKind === "none")) {
          const cell = printedCell(b.policyId, b.sourcePage, b.benefitName, tier);
          if (cell && !/^\d+(?:,\s*\d+)*$/.test(cell)) text += ": " + cell;
        } else if (!b.needsConfirmation && value != null && value > 0) {
          if (b.formulaKind === "sum_insured") text += ": " + Math.round(value * 1000) / 10 + "% of the sum insured";
          else if (currency && (b.formulaKind === "fixed" || b.formulaKind === "expense_cap" || b.formulaKind === "daily")) {
            amount = value; text += ": " + (b.formulaKind === "expense_cap" ? "up to " : "") + money(value, currency) + (b.formulaKind === "daily" ? " per day" : "");
          }
        }
        candidates.push({ id: "benefit:" + b.id, source: "benefit", topic, title: b.benefitName, ownerName: personName(ownerId), tier, rowKind, tierLabel,
          kind: "policy_fact", subjectId: ownerId, policyId: b.policyId, documentHash: docs.get(b.policyId)?.file_hash ?? null, page: b.sourcePage,
          text, amount, currency: amount != null ? currency : null, conditions: [],
          conflictNote: e?.conflict_note ?? null, passageVerified: e?.passage_verified ?? null,
          quote: b.quote, start: e?.source_text_start ?? null, end: e?.source_text_end ?? null, storedConditions: b.conditions });
      }
    }
    if (topics.some((t) => t.key === "premium")) {
      // Premiums as printed: "Annual premium (ShieldCare Plus Rider): S$689.00
      // payable in cash" -- each line its own fact, never merged or compared.
      for (const [docId, pages] of read) for (const page of pages) for (const row of page.premiums) {
        const printed = printedAmount(row.value);
        for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "premiumrow:" + docId + ":" + row.page + ":" + row.index, source: "premium", topic: "premium", title: row.label, ownerName: personName(ownerId),
          kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: row.page,
          text: row.label + ": " + row.value, amount: printed.amount, currency: printed.amount != null ? printed.currency : null, quote: row.line, start: null, end: null });
      }
      const premiums = await query<{ id: string; policy_id: string | null; source_document_id: string | null; family_member_id: string | null; amount: string; currency: string | null; frequency: string | null; source_page: number | null }>(
        `SELECT id::text AS id,policy_id::text AS policy_id,source_document_id::text AS source_document_id,family_member_id::text AS family_member_id,amount::text,currency,frequency,source_page
           FROM premium_records WHERE account_id=$1 AND coalesce(source_document_id,policy_id)::text=ANY($2::text[])`, [args.accountId, docIds]);
      const printedPremiumDocs = new Set(candidates.filter((c) => c.source === "premium").map((c) => c.policyId));
      for (const p of premiums.rows) {
        const docId = p.source_document_id ?? p.policy_id!;
        // The document's own printed premium lines already say it, verbatim.
        if (printedPremiumDocs.has(docId)) continue;
        const owners = [...(speaksFor.get(docId) ?? [])].filter((o) => !p.family_member_id || o === p.family_member_id);
        const currency = statedCurrencyCode(p.currency), amount = Number(p.amount);
        for (const ownerId of owners) candidates.push({ id: "premium:" + p.id, source: "premium", topic: "premium", title: "Premium", ownerName: personName(ownerId),
          kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: p.source_page,
          text: currency ? "Premium: " + money(amount, currency) + (p.frequency ? " (" + p.frequency + ")" : "") : "A premium is recorded, but the document does not state its currency",
          amount: currency ? amount : null, currency, quote: null, start: null, end: null });
      }
    }
  }
  // Conditions (waiting periods, exclusions, alternative benefits) are
  // answered from the conditions pages' own sentences, never from a benefit
  // table and never rerouted to another topic.
  if (conditionAsked) {
    const subject = args.question.match(SUBJECTS)?.[1];
    const SUBJECT_WORDS: Record<string, string> = { denta: "dental|teeth|tooth", mater: "maternity|pregnan|childbirth", pregn: "maternity|pregnan|childbirth", menta: "mental|psychiatr", psych: "mental|psychiatr" };
    const subjects = [...args.question.matchAll(new RegExp(SUBJECTS.source, "gi"))].map((m) => SUBJECT_WORDS[m[1].toLowerCase().slice(0, 5)] ?? m[1].toLowerCase().slice(0, 5));
    const wants = (line: string) =>
      (/\bwaiting period/i.test(args.question) && /waiting period/i.test(line)) ||
      (/\bsurvival period/i.test(args.question) && /survival period/i.test(line)) ||
      (/\bgrace period/i.test(args.question) && /grace period/i.test(line)) ||
      (/\bboth\b[^?]*\b(?:paid|payable|pay)\b|alternative benefits?|only the higher/i.test(args.question) && /alternative|higher amount|only one|not both|either/i.test(line)) ||
      subjects.some((sub) => new RegExp("\\b(?:" + sub + ")", "i").test(line)) ||
      (/\bexclu\w*/i.test(args.question) && !subject && /exclu/i.test(line));
    const conditions: RawCandidate[] = [];
    for (const [docId, pages] of read) for (const page of pages) for (const line of page.conditions) {
      if (!wants(line.line + " " + (line.heading ?? ""))) continue;
      const heading = line.heading ? line.heading.replace(/^[A-Z][A-Z &'-]+$/, (h) => h.charAt(0) + h.slice(1).toLowerCase()) + ": " : "";
      for (const ownerId of speaksFor.get(docId) ?? []) conditions.push({ id: "condition:" + docId + ":" + line.page + ":" + line.index, source: "condition", topic: "conditions", title: "Condition",
        ownerName: personName(ownerId), kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: line.page,
        text: heading + line.line, amount: null, currency: null, quote: line.line, start: null, end: null });
    }
    // A benefit topic that also appears in the conditions ("dental" in the
    // exclusions and in a benefit table) is answered with both.
    if (conditions.filter((c) => inScope(c.policyId)).length) {
      if (topics.some((t) => ["dental", "maternity", "outpatient"].includes(t.key))) candidates.push(...conditions);
      else candidates.splice(0, candidates.length, ...conditions);
    }
  }
  // Ward class / plan tier: the person's own column, from the line of the
  // document that names it ("Plan: ShieldCare Premier (Private hospital)").
  if (topics.some((t) => t.key === "ward")) {
    const tiers = await memberTiers(args.accountId, [...docs.keys()]);
    for (const docId of docs.keys()) {
      if (!kindsOf(docId).includes("hospital") && !isGuide(docId)) continue;
      for (const ownerId of speaksFor.get(docId) ?? []) {
        const tier = tiers.get(docId + "|" + ownerId);
        if (!tier) continue;
        const hit = (pagesByDoc.get(docId) ?? []).flatMap((pg) => pg.text.split(/\r?\n/).map((l, i) => ({ page: pg.page, i, l: l.trim() })))
          .find((x) => x.l && (x.l.match(/\t/g) ?? []).length < 2 && !FURNITURE.test(x.l) && x.l.toLowerCase().includes(tier.toLowerCase()));
        if (!hit) continue;
        candidates.push({ id: "ward:" + docId + ":" + ownerId, source: "row", topic: "ward", title: "Plan", ownerName: personName(ownerId), kind: "policy_fact", subjectId: ownerId, policyId: docId,
          documentHash: docs.get(docId)?.file_hash ?? null, page: hit.page, text: hit.l.replace(/\t+/g, ": ") + " — so the “" + tier + "” column of the benefit table applies",
          amount: null, currency: null, quote: hit.l, start: null, end: null });
      }
    }
  }
  // Renewal and expiry: the period, renewal and due-date lines each document prints.
  if (topics.some((t) => t.key === "renewal")) {
    const PERIOD = /^(?:period of insurance|renewal period|(?:policy |cover(?:age)? )?period|expiry date|end date|renewal date|payment due date)$/i;
    for (const [docId, pages] of read) {
      let found = 0;
      for (const page of pages) {
        for (const m of page.meta.filter((r) => PERIOD.test(r.label))) {
          found++;
          for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "renewal:" + docId + ":" + m.page + ":" + m.index, source: "row", topic: "renewal", title: m.label, ownerName: personName(ownerId),
            kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: m.page, text: m.label + ": " + m.value, amount: null, currency: null, quote: m.line, start: null, end: null });
        }
        for (const c of page.conditions.filter((x) => /\b(?:will renew|renews on|expires? on|renewal date)\b/i.test(x.line))) {
          found++;
          for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "renewal:" + docId + ":" + c.page + ":s" + c.index, source: "row", topic: "renewal", title: "Renewal", ownerName: personName(ownerId),
            kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: c.page, text: c.line, amount: null, currency: null, quote: c.line, start: null, end: null });
        }
      }
      // A schedule that prints its period without a table ("Period of insurance 1 January 2026 to 31 December 2026").
      const end = docs.get(docId)?.renewal_or_expiry_date;
      if (!found && end) {
        const hit = (pagesByDoc.get(docId) ?? []).flatMap((pg) => pg.text.split(/\r?\n/).map((l, i) => ({ page: pg.page, i, l: l.trim() }))).find((x) => x.l.length <= 160 && dateAppears(end.slice(0, 10), x.l));
        if (hit) for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "renewal:" + docId + ":" + hit.page + ":l" + hit.i, source: "row", topic: "renewal", title: "Period", ownerName: personName(ownerId),
          kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: hit.page, text: hit.l.replace(/\t+/g, ": "), amount: null, currency: null, quote: hit.l, start: null, end: null });
      }
    }
  }
  // Only the documents the question is about.
  const scoped = candidates.filter((c) => inScope(c.policyId));
  if (scoped.length || namedDocs.length || kindDocs.length) candidates.splice(0, candidates.length, ...scoped);
  // "What is the deductible / co-insurance / rider co-payment cap?" is about
  // those rows, not every benefit of the plan.
  // Who has anything at all on the topics asked, before any narrowing.
  const withAnyLine = new Set(candidates.filter((c) => inScope(c.policyId)).map((c) => c.subjectId));
  const setAside = new Set<string>();
  if (topics.some((t) => t.key === "cost_sharing")) {
    const terms = candidates.filter((c) => c.topic !== "hospital" && c.topic !== "general");
    if (terms.some((c) => c.topic === "cost_sharing")) {
      // Found, but set aside for the terms asked: never reported as missing.
      for (const c of candidates) if (!terms.includes(c)) setAside.add(c.topic);
      candidates.splice(0, candidates.length, ...terms);
    }
  }
  const narrow = NARROW.filter((n) => n.asks.test(args.question));
  // A particular term that was asked and that no line names ("deductible"
  // on a term life plan) is said to be not found, not answered with neighbours.
  const narrowMissing: string[] = [];
  if (narrow.length && !candidates.some((c) => c.source === "condition")) {
    const named = candidates.filter((c) => narrow.some((n) => n.fact.test(c.title)));
    for (const n of narrow) if (!candidates.some((c) => n.fact.test(c.title))) narrowMissing.push(args.question.match(n.asks)?.[0]?.toLowerCase().replace(/^deductable/, "deductible") ?? "");
    if (named.length) candidates.splice(0, candidates.length, ...named);
    // Only cost-sharing terms were asked and none is printed: neighbours
    // (a GP co-payment, an overall limit) are not the answer.
    else if (topics.every((t) => t.key === "cost_sharing" || t.key === "hospital") && narrowMissing.length === narrow.length)
      return result({ notFound: narrowMissing.filter(Boolean).map((w) => /^(?:deductible|co-?payment|co-?pay|pro-?ration|annual limit|policy[- ]year limit|overall limit|yearly limit)$/.test(w) ? (/^[aeiou]/.test(w) ? "an " : "a ") + w : w) });
  }
  if (!candidates.length) return result({ notFound: topics.map((t) => t.label) });
  // An expired document is still quoted, but always with the expiry date it
  // prints, cited to the page that prints it.
  const expired = (policyId: string) => { const d = docs.get(policyId); return !!d?.renewal_or_expiry_date && new Date(d.renewal_or_expiry_date.slice(0, 10) + "T23:59:59Z") < now; };
  for (const docId of new Set(candidates.map((c) => c.policyId))) {
    if (!expired(docId)) continue;
    const row = (read.get(docId) ?? []).flatMap((p) => p.meta).find((m) => /expiry|end date/i.test(m.label));
    if (!row) continue;
    const iso = row.value.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
    for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "expiry:" + docId, source: "expiry", topic: "expiry", title: row.label, ownerName: personName(ownerId),
      kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: row.page,
      text: row.label + ": " + row.value, amount: null, currency: null, date: iso, quote: row.line, start: null, end: null });
  }

  // Passages, from the stored page text.
  const pages = await pageTexts(args.accountId, docs, candidates.filter((c) => c.page != null && c.page > 0).map((c) => ({ policyId: c.policyId, page: c.page! })));
  const pageText = (policyId: string, page: number) => pages.get(policyId + "#" + page) ?? null;
  const assertions: Candidate[] = candidates.map((raw) => {
    const { quote, start, end, storedConditions, ...c } = raw;
    const page = c.page ? pageText(c.policyId, c.page) : null;
    const passage = locatePassage(page, { start, end, quote, amount: c.amount });
    // Only conditions the passage itself states are carried; anything else
    // would be a condition the answer introduced.
    const conditions = (storedConditions ?? []).filter((x) => normalPassage(passage).includes(normalPassage(x).replace(/[.;]+$/, "")));
    return { ...c, passage, conditions };
  });
  const documents: Record<string, AssertionDocument> = {};
  for (const [id, d] of docs) documents[id] = { id, accountId: d.account_id, lifecycleState: d.lifecycle_state, supersededAt: d.superseded_at,
    quarantineStatus: d.quarantine_status, fileHash: d.file_hash, subjectIds: [...(speaksFor.get(id) ?? [])] };
  const verifyCtx = { accountId: args.accountId, people: args.people, documents, pageText };
  const { kept: keptRaw, rejected } = verifyAssertions(assertions, verifyCtx);
  // A recorded conflict is shown, not resolved: each side that is otherwise
  // fully verified is listed with its own page.
  const conflictSides = verifyAssertions(rejected.filter((r) => r.reason.startsWith("conflict: ")).map((r) => ({ ...r.assertion, conflictNote: null })), verifyCtx).kept as Candidate[];
  // One line per fact per person (a coverage row and its benefit row can say the same).
  const seen = new Set<string>();
  // The same value in two columns of one table is one line, without a column name.
  const firstOf = new Map<string, Candidate>();
  let kept = (keptRaw as Candidate[]).filter((a) => { const k = a.subjectId + "|" + a.policyId + "|" + normalPassage(a.text); const prev = firstOf.get(k);
    if (prev) { if (prev.tierLabel !== a.tierLabel) prev.tierLabel = null; return false; } if (seen.has(k)) return false; seen.add(k); firstOf.set(k, a); return true; });
  // Pages of one policy that state different figures for the same thing
  // ("Sum insured: S$300,000" on p1, "Death benefit US$350,000" on p2) are a
  // conflict too, whether or not ingestion flagged it.
  const policyKey = (policyId: string) => (docs.get(policyId)?.policy_number ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") || policyId;
  const groups = new Map<string, Candidate[]>();
  // Only benefits and covers are compared: never premiums, conditions, dates
  // or schedule terms, and never two columns (tiers) of one table.
  for (const a of [...kept, ...conflictSides]) {
    if (a.amount == null || a.source === "premium" || a.source === "condition" || a.source === "expiry" || PREMIUM_ROW.test(a.title) || (a.rowKind && a.rowKind !== "benefit")) continue;
    const key = a.subjectId + "|" + policyKey(a.policyId) + "|" + sameThingKey(a.title) + "|" + (a.tier ?? "").toLowerCase();
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(a);
  }
  const conflicting: Candidate[][] = [...groups.values()].filter((g) => new Set(g.map((a) => a.amount + "|" + a.currency)).size > 1);
  const inConflict = new Set(conflicting.flat().map((a) => a.id + "|" + a.subjectId));
  kept = kept.filter((a) => !inConflict.has(a.id + "|" + a.subjectId));
  // The rows that name what was asked come first ("deductible" before the co-insurance printed beside it).
  const askedWords = (args.question.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !/^(?:what|which|does|have|with|that|this|much|when|from|about|plan|policy|policies|cover|covered|shield|pays?|there|their|would|should|could|also|please|insurance)$/.test(w));
  const relevance = (a: Candidate) => askedWords.filter((w) => a.title.toLowerCase().includes(w.replace(/s$/, ""))).length + (a.tierLabel ? -0.5 : 0);
  kept = kept.map((a, i) => ({ a, i })).sort((x, y) => relevance(y.a) - relevance(x.a) || x.i - y.i).map((x) => x.a);
  // A conflict flag whose other side is not in this answer still withholds.
  const unresolved = rejected.filter((r) => r.reason.startsWith("conflict: ") && !inConflict.has((r.assertion as Candidate).id + "|" + r.assertion.subjectId));
  // The expiry line belongs only beside facts from that document.
  kept = kept.filter((a) => a.source !== "expiry" || kept.some((b) => b.source !== "expiry" && b.policyId === a.policyId) || conflicting.flat().some((b) => b.policyId === a.policyId));

  // Currentness: an outdated document is still quoted, with its date, and
  // never presented as the current terms.
  const latestPremium = await query<{ policy_id: string; latest: string | null }>(
    `SELECT coalesce(source_document_id,policy_id)::text AS policy_id,max(coalesce(payment_date,period_end,period_start))::text AS latest
       FROM premium_records WHERE account_id=$1 AND coalesce(source_document_id,policy_id)::text=ANY($2::text[]) GROUP BY 1`, [args.accountId, docIds]).catch(() => ({ rows: [] as { policy_id: string; latest: string | null }[] }));
  const premiumBy = new Map(latestPremium.rows.map((r) => [r.policy_id, r.latest]));
  const monthsAgo = (iso: string | null) => iso ? (now.getTime() - new Date(iso.slice(0, 10) + "T00:00:00Z").getTime()) / (30.44 * 86400_000) : null;
  const outdated = (policyId: string) => {
    const d = docs.get(policyId); if (!d) return false;
    if (expired(policyId)) return true;
    const age = monthsAgo(d.document_date ?? d.effective_date), paid = monthsAgo(premiumBy.get(policyId) ?? null);
    return age != null && age > 15 && !(paid != null && paid <= 13);
  };
  const dateOf = (policyId: string) => { const d = docs.get(policyId); return d ? shortDate(d.document_date ?? d.effective_date) : null; };

  const citations: ChatCitation[] = [], details: string[] = [], limits: PolicyStatedLimit[] = [];
  const cite = (a: Candidate) => {
    const citation: ChatCitation = { chunkId: a.id, policyId: a.policyId, policyName: docName(a.policyId), insurer: docs.get(a.policyId)?.insurer ?? undefined,
      pageStart: a.page, pageEnd: a.page, personalEvidence: docs.get(a.policyId)?.personal_coverage_confirmed ?? false,
      evidenceLabel: evidenceLabel(a.policyId),
      excerpt: a.passage.slice(0, 280), documentDate: dateOf(a.policyId), notConfirmedCurrent: outdated(a.policyId) };
    if (!citations.some((c) => c.chunkId === citation.chunkId)) citations.push(citation);
    return citation;
  };
  const line = (a: Candidate) => {
    const dated = dateOf(a.policyId), who = args.people.length > 1 ? a.ownerName + " · " : "";
    const status = a.source === "expiry" ? "; this policy has expired" : expired(a.policyId) ? "; expired" : outdated(a.policyId) ? "; not confirmed current" : "";
    // A value printed in one column of a table names its column after the benefit ("Deductible (Non-panel provider): ...").
    const labelled = a.tierLabel ? (a.text.startsWith(a.title) ? a.title + " (" + a.tierLabel + ")" + a.text.slice(a.title.length) : a.text + " (" + a.tierLabel + ")") : a.text;
    const text = labelled.replace(/[.;:\s]+$/, "");
    return who + (a.page != null && riderPages.has(a.policyId + "#" + a.page) ? riderName(a.policyId, a.page) : docName(a.policyId)) + docKind(a.policyId, a.page) + " — " + text + " (page " + a.page + (dated && a.source !== "expiry" ? ", document dated " + dated : "") + status + ").";
  };
  // One line for a fact several people share (a family travel plan), naming them all.
  const shared = new Map<string, Candidate[]>();
  for (const a of kept) { const k = a.policyId + "|" + a.page + "|" + normalPassage(a.text) + "|" + (a.tierLabel ?? ""); (shared.get(k) ?? shared.set(k, []).get(k)!).push(a); }
  const listNames = (names: string[]) => names.length <= 1 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names.at(-1);
  for (const group of shared.values()) {
    const first = group[0];
    const names = [...new Set(group.map((g) => g.ownerName))];
    details.push(args.people.length > 1 && names.length > 1 ? listNames(names) + " · " + line(first).replace(/^[^·]*· /, "") : line(first));
  }
  for (const a of kept) {
    const citation = cite(a);
    if (a.source !== "premium" && a.source !== "expiry" && a.amount != null && a.currency && !isGuide(a.policyId))
      limits.push({ kind: "policy_stated_limit", label: POLICY_STATED_LIMIT_LABEL, notice: POLICY_STATED_LIMIT_NOTICE, benefitTitle: a.title,
        ownerName: a.ownerName || null, amount: a.amount, currency: a.currency, amountText: money(a.amount, a.currency), quote: a.passage, citation });
  }
  const conflictText: string[] = [];
  for (const group of conflicting) {
    const sides = [...new Map(group.map((a) => [a.amount + "|" + a.currency + "|" + a.policyId + "|" + a.page, a])).values()];
    for (const a of sides) { details.push(line(a)); cite(a); }
    const names = [...new Set(sides.map((a) => docName(a.policyId)))];
    conflictText.push((names.length === 1 ? names[0] + " states" : "Your documents state") + " different figures for " + group[0].title.toLowerCase() + ": "
      + sides.map((a) => money(a.amount!, a.currency!) + (names.length > 1 ? " in " + docName(a.policyId) : "") + " on page " + a.page).join(" and ")
      + ". DearPolicy can’t tell which one applies, so it has not picked one; the insurer can confirm"
      + (sides.some((a) => docs.get(a.policyId)?.document_role === "endorsement") ? ". One of them comes from an endorsement to the policy." : "."));
  }
  // "the annual limit", "the deductible and co-insurance": the words asked, not the whole family of terms.
  const narrowWords = narrow.map((n) => args.question.match(n.asks)?.[0]?.toLowerCase().replace(/^deductable$/, "deductible").replace(/^co-?insurence$/, "co-insurance")).filter((w): w is string => !!w);
  const topicLabels = topics.length ? topics.map((t) => t.key === "cost_sharing" && narrowWords.length ? "the " + [...new Set(narrowWords)].join(" and the ") : t.label) : conditionAsked ? ["conditions"] : ["cover"];
  const shown = [...kept, ...conflicting.flat()];
  const answeredTopics = new Set(shown.map((a) => a.topic));
  const conditionsShown = shown.some((a) => a.source === "condition");
  const notFound = conditionsShown ? [] : [...topics.filter((t) => !answeredTopics.has(t.key) && !setAside.has(t.key) && !candidates.some((c) => c.topic === t.key)).map((t) => t.label),
    ...narrowMissing.filter(Boolean).map((w) => /^(?:deductible|co-?payment|co-?pay|pro-?ration|annual limit|policy[- ]year limit|overall limit|yearly limit)$/.test(w) ? (/^[aeiou]/.test(w) ? "an " : "a ") + w : w)];
  const whose = args.people.length === 1 ? (isSelf(args.people[0].id) ? "your" : personName(args.people[0].id) + "’s") : "your family’s";
  const lines: string[] = [];
  const aboutLabels = conditionsShown ? topics.filter((t) => ["dental", "maternity", "outpatient"].includes(t.key)).map((t) => t.label) : topicLabels;
  if (shown.length) lines.push((whose === "your" ? "Here is what your" : "Here is what " + whose) + " documents state" + (aboutLabels.length ? " about " + aboutLabels.join(" and ") : "") + ". Each line shows the page it comes from.");
  // Several people asked about: who has nothing on it is said, not left out.
  if (args.people.length > 1 && shown.length && !conditionsShown && topics.length) {
    const missing = args.people.filter((p) => !withAnyLine.has(p.id)).map((p) => isSelf(p.id) ? "you" : personName(p.id));
    if (missing.length && missing.length < args.people.length)
      lines.push("DearPolicy didn’t find " + topicLabels.join(" or ") + " in the documents read for " + (missing.length === 1 ? missing[0] : missing.slice(0, -1).join(", ") + " or " + missing.at(-1)) + ".");
  }
  lines.push(...conflictText);
  const expiredDocs = [...new Set(shown.filter((a) => expired(a.policyId)).map((a) => a.policyId))];
  for (const docId of expiredDocs) {
    const printed = shown.find((a) => a.source === "expiry" && a.policyId === docId);
    lines.push(docName(docId) + (printed ? " expired on " + (printed.date ?? printed.text.replace(/^[^:]*:\s*/, "")) + " (page " + printed.page + ")" : " has expired") + ", so its terms may no longer apply.");
  }
  const staleDates = [...new Set(shown.filter((a) => outdated(a.policyId) && !expired(a.policyId)).map((a) => dateOf(a.policyId) ?? "an earlier date"))];
  if (staleDates.length) lines.push("Some of this comes from a document dated " + staleDates.join(" and ") + ", so it may not reflect the current terms.");
  if (unresolved.length) lines.push([...new Set(unresolved.map((r) => (r.assertion as Candidate).title))].join(" and ") + ": your documents state different figures, so DearPolicy has not picked one. Upload the latest schedule to settle it.");
  const otherGaps = rejected.filter((r) => !r.reason.startsWith("conflict: ") && !shown.some((k) => k.topic === (r.assertion as Candidate).topic));
  if (otherGaps.length) lines.push("Some details were left out because they could not be matched to the exact passage in the document: " + [...new Set(otherGaps.map((r) => r.reason))].slice(0, 2).join("; ") + ".");
  if (notFound.length) lines.push("I could not find " + notFound.join(" or ") + " in the documents read" + (args.people.length === 1 ? " for " + personName(args.people[0].id) : "") + ".");
  // Facts that exist but could not be verified are not an answer; the caller
  // may still read the documents. A conflict is an answer: shown, explained,
  // never resolved by reading again and picking one.
  const handled = kept.some((a) => a.source !== "expiry") || conflicting.length > 0 || unresolved.length > 0;
  if (!handled) return result({ notFound: topics.map((t) => t.label), rejected });
  let summary = lines.join(" ");
  let narrated = false, modelCalls = 0;
  if (args.narrate && kept.length && !conflicting.length) {
    try {
      modelCalls++;
      const text = await args.narrate({ question: args.question, text: summary + " " + details.join(" "), assertions: kept });
      if (text && !/\?/.test(text) && rephrasingIsFaithful(text, kept)) { summary = text.trim(); narrated = true; }
    } catch { /* The deterministic text stands. */ }
  }
  // Every money figure in this answer's text comes from a verified assertion's
  // own wording, which verifyAssertions found in its cited passage. The live
  // monetary boundary shows exactly these figures for a policy-fact answer and
  // withholds any other (lib/chat/monetary-boundary.ts).
  const figures = [...new Set([...shown.flatMap((a) => a.text.match(new RegExp(MONEY_PATTERN.source, "gi")) ?? []),
    ...shown.filter((a) => a.amount != null && a.currency).map((a) => money(a.amount!, a.currency!))])];
  const answer: PolicyAnswer = { mode: "answer", summary, details, citations, policyStatedLimits: limits,
    verifiedPolicyFactsOnly: true, verifiedPolicyFigures: figures,
    confidence: kept.length && !conflicting.length ? (rejected.length || notFound.length ? "partial_match" : "strong_match") : "partial_match",
    nextSteps: staleDates.length ? ["Upload the latest renewal notice or premium receipt to confirm the policy is current."] : [], questions: [] };
  return { handled, answer, kept: shown, rejected, topics: topics.map((t) => t.key), notFound, modelCalls, narrated, elapsedMs: Date.now() - started };
}

/** A question asking what the documents state, as opposed to a what-if or a
 * claim ("if I die…", "how much can I claim…"). Only these take the stored-
 * fact path; hypotheticals and claims keep their own workflow. A question
 * about what a policy says it pays, or about its conditions, is factual even
 * when it contains an "if". */
export function isFactualPolicyQuestion(question: string) {
  if (/\bhow much (?:can|could|would|will|do|does|should) (?:i|we|he|she|they|\w+) (?:claim|get|receive|be paid)\b/i.test(question)) return false;
  if (CONDITION_QUESTION.test(question)) return true;
  if (/^\s*what (?:does|do|would|will) [^?]*\b(?:policy|plan|insurance|cover)\b[^?]*\b(?:pay|provide)\b/i.test(question)) return true;
  return !/\b(?:what if|if (?:i|he|she|we|they|my|our|his|her|their|\w+ (?:is|was|were|gets?|dies?|died))|suppose|supposing|assuming|in case|were to)\b/i.test(question);
}
