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
import { amountAppears, normalPassage, rephrasingIsFaithful, verifyAssertions, type Assertion, type AssertionDocument, type Rejection } from "./assertions";
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
  { key: "hospital", label: "hospital cover", asks: /\b(?:hospital\w*|warded|ward|inpatient|surgery|surgical|intensive care|icu)\b|\bmedical (?:cover|coverage|plan|insurance)\b/i,
    fact: /hospital|\bward\b|inpatient|intensive care|\bicu\b|room and board/i, kind: /hospital|shield|\bmedishield\b|health plan/i },
  { key: "premium", label: "premium", asks: /\bpremiums?\b|how much do (?:i|we) pay for/i, fact: /premium/i },
  { key: "maturity", label: "maturity or surrender value", asks: /\b(?:matur\w*|endowment|surrender\w*|cash values?)\b/i, fact: /matur|surrender|cash value|endowment/i, kind: /endow|savings|matur/i, passage: /matur|surrender|cash value/i },
  { key: "travel", label: "travel cover", asks: /\b(?:travel\w*|trip|flight|baggage|luggage|overseas|abroad)\b/i, fact: /travel|trip|flight|baggage|luggage|overseas/i, kind: /travel|trip|voyage|wander/i },
];
const GENERAL = /\bwhat (?:does|do|is) (?:my|our|his|her|their|\w+'s) (?:polic(?:y|ies)|plans?|insurance|cover(?:age)?) (?:cover|include)|\bwhat am i covered for\b|\bwhat (?:cover|coverage|policies|insurance) do (?:i|we|they) have\b|\bsums? (?:insured|assured)\b|\bhow much (?:am i|are we|is \w+) (?:covered|insured) for\b/i;
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
  { asks: /\bpermanent (?:loss|disablement)|loss of (?:an? |one )?(?:arm|leg|hand|limb|sight)\b/i, fact: /loss of|disablement|dismember/i },
];
export function questionTopics(question: string) {
  const asked = TOPICS.filter((t) => t.asks.test(question));
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
type Candidate = Assertion & { id: string; source: "coverage" | "benefit" | "premium" | "row" | "condition" | "expiry"; topic: string; title: string; ownerName: string };
/** A stored fact before its passage is located on the page. */
type RawCandidate = Omit<Candidate, "passage"> & { quote: string | null; start: number | null; end: number | null; storedConditions?: string[] };

// ---------------------------------------------------------------------------
// Deterministic reading of stored page text: schedule rows and condition lines
// ---------------------------------------------------------------------------
type PageRow = { page: number; index: number; label: string; value: string; line: string };
type ConditionLine = { page: number; index: number; line: string };
const FURNITURE = /SYNTHETIC(?:-[A-Z0-9-]+)? TEST DOCUMENT|^Page \d+ of \d+$|DPTEST|^[A-Za-z0-9+/=]{40,}$/i;
const META_LABEL = /^(?:policy ?(?:number|no\.?|type)|insured(?: person)?|life assured|policyholder|group policyholder|issued by|effective date(?: of endorsement)?|expiry date|end date|start date|currency)$/i;
/** Rows ("Label<TAB>value") and, on a conditions page, its sentences, exactly
 * as stored. Nothing is inferred; a row is only what the page prints. */
export function readPage(page: number, text: string) {
  const rows: PageRow[] = [], conditions: ConditionLine[] = [], meta: PageRow[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const heading = lines.find((l) => l && !FURNITURE.test(l)) ?? "";
  const conditionsPage = /\b(?:conditions|exclusions|general provisions)\b/i.test(heading);
  lines.forEach((line, index) => {
    if (!line || FURNITURE.test(line) || line === heading) return;
    const row = line.match(/^([^\t]{2,80})\t([^\t]{1,200})$/);
    if (row) { const r = { page, index, label: row[1].trim(), value: row[2].trim(), line }; (META_LABEL.test(r.label) ? meta : rows).push(r); return; }
    if (conditionsPage || /^(?:waiting period|survival period|exclusions?|alternative benefits?)\s*:/i.test(line)) conditions.push({ page, index, line });
  });
  return { rows, conditions, meta };
}
const MONEY_IN_TEXT = /(S\$|SG\$|US\$|HK\$|A\$|SGD|USD|HKD|AUD|MYR|RM|EUR|GBP|JPY|€|£|¥)\s?(\d[\d,]*(?:\.\d+)?)/i;
/** The first amount a printed value states, with its printed currency; or
 * the bare number when the value prints no currency at all. */
function printedAmount(value: string): { amount: number | null; currency: string | null; bare: boolean } {
  const m = value.match(MONEY_IN_TEXT);
  if (m) { const currency = statedCurrencyCode(m[1]); return { amount: currency ? Number(m[2].replace(/,/g, "")) : null, currency, bare: !currency }; }
  const bare = value.match(/(?:^|[^\d%])(\d[\d,]*(?:\.\d+)?)(?!\s*%)(?!\s*(?:days?|months?|years?|hours?)\b)/);
  return { amount: null, currency: null, bare: !!bare };
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
const CONDITION_QUESTION = /\bwaiting period|\bsurvival period|\bexclu\w*|\bpre-existing|\bboth\b[^?]*\b(?:paid|payable|pay)\b|\balternative benefits?|\bonly the higher\b/i;
const SUBJECTS = /\b(dental|maternity|pregnan\w*|cosmetic|mental|psychiatric|hiv|war|terroris\w*|suicide|self-inflicted|professional sports?|pre-existing)\b/i;
const PLAN_KINDS: { re: RegExp; kind: string }[] = [
  { re: /\bhospital (?:plan|policy|insurance|cover)\b/i, kind: "hospital" },
  { re: /\btravel (?:plan|policy|insurance|cover)\b/i, kind: "travel" },
  { re: /\b(?:personal )?accident (?:plan|policy|insurance)\b/i, kind: "accident" },
  { re: /\b(?:group |term )?life (?:plan|policy|insurance|cover)\b|\bterm (?:plan|policy)\b/i, kind: "death" },
  { re: /\bendowment\b/i, kind: "maturity" },
  { re: /\bcritical illness (?:plan|policy|cover)\b/i, kind: "critical_illness" },
];
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
  if (!contracts.length) return result({ notFound: topics.map((t) => t.label) });
  const speaksFor = new Map<string, Set<string>>();
  for (const c of contracts) for (const d of [...c.documents, ...c.references]) (speaksFor.get(d.id) ?? speaksFor.set(d.id, new Set()).get(d.id)!).add(c.ownerId);
  const docIds = [...speaksFor.keys()];
  const cols = await evidenceColumns();
  const docRows = await query<DocRow>(
    `SELECT id::text AS id,account_id::text AS account_id,lifecycle_state,superseded_at::text,quarantine_status,file_hash,effective_date::text,renewal_or_expiry_date::text,
            ${cols.policies?.has("document_date") ? "document_date::text" : "NULL::text"} AS document_date,product_name,insurer,original_filename,updated_at::text,personal_coverage_confirmed,policy_type,policy_number,document_role
       FROM policies WHERE account_id=$1 AND id::text=ANY($2::text[]) AND ${activePredicate()}`, [args.accountId, docIds]);
  const docs = new Map(docRows.rows.map((d) => [d.id, d]));
  const docName = (id: string) => { const d = docs.get(id); return d?.product_name ?? (d ? prettifyFilename(d.original_filename) : "Policy document"); };
  // How the household refers to a person: the name they use, not the legal one.
  const personName = (id: string) => { const p = args.people.find((x) => x.id === id); return p ? (p.preferred_name?.trim() || p.display_name) : ""; };
  // What kind of policy each document is, from its type, product name and the
  // covers stored on it. A row on a hospital plan is hospital cover; a row on
  // an accident plan is accident cover, whatever medical words it uses.
  const docKindText = new Map<string, string>();
  for (const [docId, d] of docs) docKindText.set(docId, [d.policy_type, d.product_name, ...contracts.flatMap((c) => c.coverages.filter((v) => v.policyId === docId).map((v) => v.category))].filter(Boolean).join(" "));
  const kindsOf = (docId: string) => TOPICS.filter((t) => t.kind && t.kind.test(docKindText.get(docId) ?? "")).map((t) => t.key);
  const topicOf = (label: string, passage: string, docId: string) => {
    const kinds = kindsOf(docId);
    for (const t of topics) {
      if (t.passage && !t.passage.test(label + " " + passage)) continue;
      // Every row of a plan of this kind belongs to the topic.
      if (kinds.includes(t.key)) return t.key;
      // A row whose own name says so belongs, unless it sits on a plan of a
      // different specific kind (an accident or travel plan's "hospital" row
      // pays only for an accident or a trip).
      if (t.fact.test(label) && !kinds.some((k) => k !== t.key && (k === "accident" || k === "travel"))) return t.key;
    }
    return !topics.length && general ? "general" : null;
  };
  // Which documents the question is about: one it names ("her CritiCare
  // plan"), or plans of the kind it names ("her hospital plan").
  const namedDocs = [...docs.values()].filter((d) => (d.product_name ?? "").split(/[^A-Za-z0-9]+/)
    .some((token) => token.length >= 5 && !/^(?:synthetic|dptest|policy|insurance|plan)$/i.test(token) && !/\d/.test(token) && new RegExp("\\b" + token + "\\b", "i").test(args.question))).map((d) => d.id);
  const plannedKinds = PLAN_KINDS.filter((p) => p.re.test(args.question)).map((p) => p.kind);
  const kindDocs = plannedKinds.length ? [...docs.keys()].filter((id) => kindsOf(id).some((k) => plannedKinds.includes(k))) : [];
  const inScope = (docId: string) => namedDocs.length ? namedDocs.includes(docId) : kindDocs.length ? kindDocs.includes(docId) : true;

  // Stored facts and printed rows, as candidate assertions.
  const candidates: RawCandidate[] = [];
  const pagesByDoc = await documentPages(args.accountId, docs);
  const read = new Map([...pagesByDoc].map(([docId, pages]) => [docId, pages.map((p) => readPage(p.page, p.text))]));
  // Printed schedule rows: the row itself is the passage, so what is shown is
  // exactly what the page prints -- including a value printed with no currency.
  for (const [docId, pages] of read) for (const page of pages) for (const row of page.rows) {
    const topic = topicOf(row.label, row.line, docId);
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
    for (const b of catalog) {
      const topic = topicOf(b.benefitName, b.quote, b.policyId);
      if (!topic) continue;
      const e = benefitEvidence.get(b.id);
      // Printed on the page as a row: the row is shown; a conflict the
      // ingestion recorded for this benefit is carried onto it.
      if (printedTitle(b.policyId, b.benefitName)) {
        if (e?.conflict_note) for (const c of candidates) if (c.source === "row" && c.policyId === b.policyId && normalPassage(c.title) === normalPassage(b.benefitName)) c.conflictNote = e.conflict_note;
        continue;
      }
      for (const ownerId of speaksFor.get(b.policyId) ?? []) {
        const currency = statedCurrencyCode(b.currency);
        const value = b.formulaValue;
        let text = b.benefitName, amount: number | null = null;
        if (!b.needsConfirmation && value != null && value > 0) {
          if (b.formulaKind === "sum_insured") text += ": " + Math.round(value * 1000) / 10 + "% of the sum insured";
          else if (currency && (b.formulaKind === "fixed" || b.formulaKind === "expense_cap" || b.formulaKind === "daily")) {
            amount = value; text += ": " + (b.formulaKind === "expense_cap" ? "up to " : "") + money(value, currency) + (b.formulaKind === "daily" ? " per day" : "");
          }
        }
        candidates.push({ id: "benefit:" + b.id, source: "benefit", topic, title: b.benefitName, ownerName: personName(ownerId),
          kind: "policy_fact", subjectId: ownerId, policyId: b.policyId, documentHash: docs.get(b.policyId)?.file_hash ?? null, page: b.sourcePage,
          text, amount, currency: amount != null ? currency : null, conditions: [],
          conflictNote: e?.conflict_note ?? null, passageVerified: e?.passage_verified ?? null,
          quote: b.quote, start: e?.source_text_start ?? null, end: e?.source_text_end ?? null, storedConditions: b.conditions });
      }
    }
    if (topics.some((t) => t.key === "premium")) {
      const premiums = await query<{ id: string; policy_id: string | null; source_document_id: string | null; family_member_id: string | null; amount: string; currency: string | null; frequency: string | null; source_page: number | null }>(
        `SELECT id::text AS id,policy_id::text AS policy_id,source_document_id::text AS source_document_id,family_member_id::text AS family_member_id,amount::text,currency,frequency,source_page
           FROM premium_records WHERE account_id=$1 AND coalesce(source_document_id,policy_id)::text=ANY($2::text[])`, [args.accountId, docIds]);
      for (const p of premiums.rows) {
        const docId = p.source_document_id ?? p.policy_id!;
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
    const wants = (line: string) =>
      (/\bwaiting period/i.test(args.question) && /waiting period/i.test(line)) ||
      (/\bsurvival period/i.test(args.question) && /survival period/i.test(line)) ||
      (/\bboth\b[^?]*\b(?:paid|payable|pay)\b|alternative benefits?|only the higher/i.test(args.question) && /alternative|higher amount|only one|not both|either/i.test(line)) ||
      (!!subject && new RegExp("\\b" + subject.slice(0, 5), "i").test(line)) ||
      (/\bexclu\w*/i.test(args.question) && !subject && /exclu/i.test(line));
    const conditions: RawCandidate[] = [];
    for (const [docId, pages] of read) for (const page of pages) for (const line of page.conditions) {
      if (!wants(line.line)) continue;
      for (const ownerId of speaksFor.get(docId) ?? []) conditions.push({ id: "condition:" + docId + ":" + line.page + ":" + line.index, source: "condition", topic: "conditions", title: "Condition",
        ownerName: personName(ownerId), kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: line.page,
        text: line.line, amount: null, currency: null, quote: line.line, start: null, end: null });
    }
    if (conditions.filter((c) => inScope(c.policyId)).length) candidates.splice(0, candidates.length, ...conditions);
  }
  // Only the documents the question is about.
  const scoped = candidates.filter((c) => inScope(c.policyId));
  if (scoped.length || namedDocs.length || kindDocs.length) candidates.splice(0, candidates.length, ...scoped);
  const narrow = NARROW.filter((n) => n.asks.test(args.question));
  if (narrow.length && !candidates.some((c) => c.source === "condition")) {
    const named = candidates.filter((c) => narrow.some((n) => n.fact.test(c.title)));
    if (named.length) candidates.splice(0, candidates.length, ...named);
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
  let kept = (keptRaw as Candidate[]).filter((a) => { const k = a.subjectId + "|" + a.policyId + "|" + normalPassage(a.text); if (seen.has(k)) return false; seen.add(k); return true; });
  // Pages of one policy that state different figures for the same thing
  // ("Sum insured: S$300,000" on p1, "Death benefit US$350,000" on p2) are a
  // conflict too, whether or not ingestion flagged it.
  const policyKey = (policyId: string) => (docs.get(policyId)?.policy_number ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") || policyId;
  const groups = new Map<string, Candidate[]>();
  for (const a of [...kept, ...conflictSides]) if (a.amount != null && a.source !== "premium" && a.source !== "condition")
    (groups.get(a.subjectId + "|" + policyKey(a.policyId) + "|" + sameThingKey(a.title)) ?? groups.set(a.subjectId + "|" + policyKey(a.policyId) + "|" + sameThingKey(a.title), []).get(a.subjectId + "|" + policyKey(a.policyId) + "|" + sameThingKey(a.title))!).push(a);
  const conflicting: Candidate[][] = [...groups.values()].filter((g) => new Set(g.map((a) => a.amount + "|" + a.currency)).size > 1);
  const inConflict = new Set(conflicting.flat().map((a) => a.id + "|" + a.subjectId));
  kept = kept.filter((a) => !inConflict.has(a.id + "|" + a.subjectId));
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
      evidenceLabel: docs.get(a.policyId)?.personal_coverage_confirmed ? "Your policy document" : "Policy wording",
      excerpt: a.passage.slice(0, 280), documentDate: dateOf(a.policyId), notConfirmedCurrent: outdated(a.policyId) };
    if (!citations.some((c) => c.chunkId === citation.chunkId)) citations.push(citation);
    return citation;
  };
  const line = (a: Candidate) => {
    const dated = dateOf(a.policyId), who = args.people.length > 1 ? a.ownerName + " · " : "";
    const status = a.source === "expiry" ? "; this policy has expired" : expired(a.policyId) ? "; expired" : outdated(a.policyId) ? "; not confirmed current" : "";
    return who + docName(a.policyId) + " — " + a.text + " (page " + a.page + (dated && a.source !== "expiry" ? ", document dated " + dated : "") + status + ").";
  };
  for (const a of kept) {
    details.push(line(a));
    const citation = cite(a);
    if (a.source !== "premium" && a.source !== "expiry" && a.amount != null && a.currency)
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
  const topicLabels = topics.length ? topics.map((t) => t.label) : conditionAsked ? ["conditions"] : ["cover"];
  const shown = [...kept, ...conflicting.flat()];
  const answeredTopics = new Set(shown.map((a) => a.topic));
  const conditionsShown = shown.some((a) => a.source === "condition");
  const notFound = conditionsShown ? [] : topics.filter((t) => !answeredTopics.has(t.key) && !candidates.some((c) => c.topic === t.key)).map((t) => t.label);
  const whose = args.people.length === 1 ? personName(args.people[0].id) + "’s" : "your family’s";
  const lines: string[] = [];
  if (shown.length) lines.push("Here is what " + whose + " documents state" + (conditionsShown ? "" : " about " + topicLabels.join(" and ")) + ". Each line shows the page it comes from.");
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
