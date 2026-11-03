/**
 * Writes the evidence columns (see ./evidence.ts) for a document's stored
 * rows, and marks contradictions between rows that should agree.
 *
 * Every function here is a pass over rows that were just written for ONE
 * document; each recomputes from scratch, so running it again (a retried or
 * resumed job) gives the same result and never duplicates anything.
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { normalizeCoverageCategory } from "@/lib/insurance";
import { benefitRowsFromText } from "@/lib/documents/layout";
import { ensureEvidenceSchema, evidenceFor, type ExtractionMethod, methodFor } from "@/lib/documents/evidence";

export type EvidencePage = { page_number: number; text: string; extraction_method?: string | null };

export function evidenceKey(benefitName: string, sourcePage: number | null | undefined, quote: string | null | undefined) {
  return [benefitName.toLowerCase().replace(/[^a-z0-9]/g, ""), sourcePage ?? "", String(quote ?? "").replace(/\s+/g, " ").trim().toLowerCase()].join("|");
}

/** Whether a quote is exactly one of the page's parsed table rows. */
function isTableRow(pageText: string, quote: string) {
  const wanted = quote.replace(/\s+/g, " ").trim().toLowerCase();
  return benefitRowsFromText(pageText).some((row) => row.line.replace(/\s+/g, " ").trim().toLowerCase() === wanted);
}

/** A percentage read from a heading ("Schedule of Indemnities (% of Sum
 * Insured)") is only as good as that heading: it must be printed on the page
 * above the row. */
function basisHeadingAbove(pageText: string, start: number) {
  const above = pageText.slice(0, start);
  return /%\s*of\s*(?:the\s+)?(?:sum\s+(?:insured|assured)|insured\s+amount|principal\s+sum|benefit\s+amount|[A-Z]{0,3}\$\s?[\d,]+|[A-Z]{3}\s?[\d,]+)/i.test(above);
}

type BenefitRow = { id: string; benefit_name: string; source_page: number | null; quote: string | null; formula_kind: string;
  formula_value: string | null; currency: string | null; basis_inferred: boolean | null; reviewed_at: string | null };

/** Span, method and code verification for every benefit row of a document. */
export async function annotateBenefitEvidence(accountId: string, policyId: string, pages: EvidencePage[], methods: Map<string, ExtractionMethod> = new Map()) {
  await ensureEvidenceSchema();
  const byPage = new Map(pages.map((p) => [p.page_number, p]));
  const rows = (await query<BenefitRow>(
    `SELECT id,benefit_name,source_page,quote,formula_kind,formula_value::text,currency,basis_inferred,reviewed_at::text FROM policy_benefits WHERE account_id=$1 AND policy_id=$2`,
    [accountId, policyId])).rows;
  for (const row of rows) {
    const page = row.source_page != null ? byPage.get(row.source_page) : undefined;
    const text = page?.text ?? "";
    const value = row.formula_value == null ? null : Number(row.formula_value);
    const money = ["fixed", "expense_cap", "daily"].includes(row.formula_kind);
    const evidence = evidenceFor({ pageText: text, quote: row.quote, name: row.benefit_name,
      amount: row.formula_kind === "none" ? null : value, amountKind: row.formula_kind === "sum_insured" ? "fraction" : money ? "money" : null,
      currency: row.currency });
    const verified = evidence.verified && (!row.basis_inferred || (evidence.start != null && basisHeadingAbove(text, evidence.start)));
    const method: ExtractionMethod = row.reviewed_at ? "manual"
      : methods.get(evidenceKey(row.benefit_name, row.source_page, row.quote))
        ?? methodFor(row.quote && text && isTableRow(text, row.quote) ? "table" : "model", page?.extraction_method);
    await query(
      `UPDATE policy_benefits SET source_text_start=$3,source_text_end=$4,extraction_method=$5,passage_verified=$6 WHERE account_id=$1 AND id=$2`,
      [accountId, row.id, evidence.start, evidence.end, method, verified]);
  }
  return rows.length;
}

/** Span, method and verification for a document's coverage rows. The name
 * checked is the insured person's name as printed. */
export async function annotateCoverageEvidence(accountId: string, policyId: string, pages: EvidencePage[], printedNames: Map<string, string>) {
  await ensureEvidenceSchema();
  const byPage = new Map(pages.map((p) => [p.page_number, p]));
  const rows = (await query<{ id: string; family_member_id: string; amount: string | null; currency: string | null; source_page: number | null; evidence_text: string | null }>(
    `SELECT id,family_member_id,amount::text,currency,source_page,evidence_text FROM policy_coverages WHERE account_id=$1 AND policy_id=$2`, [accountId, policyId])).rows;
  for (const row of rows) {
    const page = row.source_page != null ? byPage.get(row.source_page) : undefined;
    const evidence = evidenceFor({ pageText: page?.text, quote: row.evidence_text, name: printedNames.get(row.family_member_id) ?? null,
      amount: row.amount == null ? null : Number(row.amount), amountKind: "money", currency: row.currency });
    await query(`UPDATE policy_coverages SET source_text_start=$3,source_text_end=$4,extraction_method=$5,passage_verified=$6 WHERE account_id=$1 AND id=$2`,
      [accountId, row.id, evidence.start, evidence.end, methodFor("model", page?.extraction_method), evidence.verified]);
  }
  return rows.length;
}

/** Span, method and verification for a document's coverage-ledger rows. A
 * row seeded from a benefit row inherits that row's method and any conflict. */
export async function annotateLedgerEvidence(accountId: string, policyId: string) {
  await ensureEvidenceSchema();
  const exists = (await query<{ t: string | null }>("SELECT to_regclass('public.coverage_rules')::text AS t")).rows[0]?.t;
  if (!exists) return 0;
  const pages = (await query<EvidencePage>(
    `SELECT page_number,text,to_jsonb(pg)->>'extraction_method' AS extraction_method FROM policy_pages pg WHERE account_id=$1 AND policy_id=$2`, [accountId, policyId])).rows;
  const byPage = new Map(pages.map((p) => [p.page_number, p]));
  const benefits = (await query<{ source_page: number | null; quote: string | null; extraction_method: string | null; conflict_note: string | null }>(
    `SELECT source_page,quote,to_jsonb(b)->>'extraction_method' AS extraction_method,to_jsonb(b)->>'conflict_note' AS conflict_note FROM policy_benefits b WHERE account_id=$1 AND policy_id=$2`,
    [accountId, policyId]).catch(() => ({ rows: [] as { source_page: number | null; quote: string | null; extraction_method: string | null; conflict_note: string | null }[] }))).rows;
  const rows = (await query<{ id: string; note: string | null; pays_kind: string; amount: string | null; currency: string | null; source_page: number | null; quote: string | null; seed_key: string | null; origin: string }>(
    `SELECT id,note,pays_kind,amount::text,currency,source_page,quote,seed_key,origin FROM coverage_rules WHERE account_id=$1 AND policy_id=$2`, [accountId, policyId])).rows;
  for (const row of rows) {
    if (row.origin === "person") {
      await query(`UPDATE coverage_rules SET extraction_method='manual' WHERE account_id=$1 AND id=$2`, [accountId, row.id]);
      continue;
    }
    const page = row.source_page != null ? byPage.get(row.source_page) : undefined;
    const kind = row.pays_kind === "percent_of_sum" ? "fraction" : row.pays_kind === "stated" ? null : "money";
    const evidence = evidenceFor({ pageText: page?.text, quote: row.quote, name: row.note,
      amount: kind && row.amount != null ? Number(row.amount) : null, amountKind: kind, currency: kind === "fraction" ? null : row.currency });
    const source = benefits.find((b) => b.source_page === row.source_page && String(b.quote ?? "").replace(/\s+/g, " ").trim() === String(row.quote ?? "").replace(/\s+/g, " ").trim());
    const method = (source?.extraction_method as ExtractionMethod | null) ?? methodFor(String(row.seed_key ?? "").startsWith("ai:") ? "model" : "table", page?.extraction_method);
    await query(`UPDATE coverage_rules SET source_text_start=$3,source_text_end=$4,extraction_method=$5,passage_verified=$6,conflict_note=COALESCE($7,conflict_note) WHERE account_id=$1 AND id=$2`,
      [accountId, row.id, evidence.start, evidence.end, method, evidence.verified, source?.conflict_note ?? null]);
  }
  return rows.length;
}

type GroupPolicy = { id: string; original_filename: string | null; current: boolean; doc_date: string | null; amends: boolean; role: string | null;
  policy_number: string | null; authority: number | null; created: string | null };
/** The document plus every other document of the same plan in the household:
 * the same policy number, or the same insurer and product name. `amends` is
 * an endorsement, or a document whose own text says it amends or replaces
 * terms; `doc_date` its printed issue/effective date. */
async function planGroup(accountId: string, policyId: string): Promise<GroupPolicy[]> {
  return (await query<GroupPolicy>(
    `WITH me AS (SELECT id,policy_number,lower(insurer) AS ins,lower(product_name) AS prod FROM policies WHERE id=$2 AND account_id=$1 AND ${activePredicate()})
     SELECT p.id,p.original_filename,(p.lifecycle_state='active' AND p.superseded_at IS NULL) AS current,
            coalesce(to_jsonb(p)->>'document_date',p.effective_date::text) AS doc_date,p.document_role AS role,
            p.policy_number,(to_jsonb(p)->>'document_authority')::int AS authority,p.created_at::text AS created,
            (p.document_role='endorsement' OR EXISTS(SELECT 1 FROM policy_pages pg WHERE pg.account_id=p.account_id AND pg.policy_id=p.id
               AND pg.text ~* '(\\m(is|are|hereby|be)\\s+amended\\M|\\mamended\\s+(to|as\\s+follows)\\M|\\mreplaced\\s+(by|with)\\M|\\mendorsement\\s+no)')) AS amends
       FROM policies p,me
      WHERE p.account_id=$1 AND ${activePredicate("p")} AND (p.id=me.id
         OR (me.policy_number IS NOT NULL AND p.policy_number=me.policy_number)
         OR (me.ins IS NOT NULL AND me.prod IS NOT NULL AND lower(p.insurer)=me.ins AND lower(p.product_name)=me.prod))`,
    [accountId, policyId])).rows;
}

export type Statement = { id: string; policyId: string; signature: string; page: number | null; label: string };
export type StatementDoc = { date: string | null; amends: boolean; name: string | null };
export type Resolution = {
  /** Rows that contradict another row with no evidence of which is current. */
  conflicts: Map<string, Statement[]>;
  /** Older rows replaced by a later amendment: id -> the amending row. */
  amendedBy: Map<string, Statement>;
  /** Amending rows: id -> the older rows they replace. */
  replaces: Map<string, Statement[]>;
};
/** Decides, for statements of ONE benefit (or cover) across the pages and
 * current versions of one plan, which differences are genuine
 * contradictions and which are an amendment.
 *
 * A later endorsement or amendment of the same plan that states a different
 * value IS evidence of the current value: when every differing statement
 * comes from a document dated strictly before the latest amending document,
 * and that document states one value, the older statements are marked
 * replaced (both kept) and nothing is a conflict. Anything else -- no
 * amending document, an undated statement, two amendments of the same date,
 * an amendment that contradicts itself -- stays a conflict. Pure. */
export function resolveStatements(rows: Statement[], docs: Map<string, StatementDoc>): Resolution {
  const out: Resolution = { conflicts: new Map(), amendedBy: new Map(), replaces: new Map() };
  if (new Set(rows.map((r) => r.signature)).size < 2) return out;
  const amenders = [...new Set(rows.map((r) => r.policyId))]
    .filter((id) => docs.get(id)?.amends && docs.get(id)?.date)
    .sort((a, b) => String(docs.get(b)!.date).localeCompare(String(docs.get(a)!.date)));
  const latest = amenders[0];
  const tie = latest && amenders[1] && docs.get(amenders[1])!.date === docs.get(latest)!.date;
  if (latest && !tie) {
    const latestRows = rows.filter((r) => r.policyId === latest);
    const signatures = new Set(latestRows.map((r) => r.signature));
    const latestDate = String(docs.get(latest)!.date);
    const differing = rows.filter((r) => !signatures.has(r.signature));
    const resolvable = signatures.size === 1 && differing.every((r) => r.policyId !== latest && docs.get(r.policyId)?.date && String(docs.get(r.policyId)!.date) < latestDate);
    if (resolvable) {
      for (const r of differing) out.amendedBy.set(r.id, latestRows[0]);
      for (const r of latestRows) out.replaces.set(r.id, differing);
      return out;
    }
  }
  for (const row of rows) out.conflicts.set(row.id, rows.filter((o) => o.signature !== row.signature));
  return out;
}

function describe(kind: string, value: number | null, currency: string | null) {
  if (value == null) return "no amount";
  if (kind === "sum_insured") return Math.round(value * 10000) / 100 + "% of the sum insured";
  const amount = value.toLocaleString("en-SG", { maximumFractionDigits: 2 });
  return (currency ? currency + " " : "") + amount + (kind === "daily" ? " a day" : kind === "expense_cap" ? " (limit)" : "");
}
function where(policy: GroupPolicy | undefined, page: number | null, sameDocument: boolean) {
  const at = page != null ? "page " + page : "an unrecorded page";
  return sameDocument ? at + " of this document" : at + " of " + (policy?.original_filename ?? "another version of this plan");
}

/** The same policy uploaded as two different files (a re-download, a copy
 * sent by the agent) is one set of rows, not two. Among current documents of
 * one plan that carry the SAME policy number, the most authoritative document
 * (then the latest dated, then the first uploaded) keeps its rows; a row of
 * another of those documents that states exactly what a kept row states
 * (name, tier, kind, value, currency) is marked duplicate_of_policy_id and is
 * no longer listed or used. Nothing is deleted, and a row the other document
 * states differently stays (and is compared as usual). Documents of the same
 * product for different policy numbers -- two people's certificates -- are
 * never merged. Recomputed from scratch; returns the rows marked. */
async function markDuplicates(accountId: string, group: GroupPolicy[]) {
  const docs = group.filter((g) => g.current && g.policy_number);
  if (docs.length < 2) return 0;
  const rank = [...docs].sort((a, b) => (Number(b.authority ?? 0) - Number(a.authority ?? 0))
    || String(b.doc_date ?? "").localeCompare(String(a.doc_date ?? ""))
    || String(a.created ?? "").localeCompare(String(b.created ?? "")) || a.id.localeCompare(b.id));
  const rows = (await query<{ id: string; policy_id: string; benefit_name: string; tier: string | null; row_kind: string | null; formula_kind: string; formula_value: string | null; currency: string | null; reviewed: boolean }>(
    `SELECT id,policy_id,benefit_name,tier,row_kind,formula_kind,formula_value::text,currency,reviewed_at IS NOT NULL AS reviewed FROM policy_benefits WHERE account_id=$1 AND policy_id=ANY($2::uuid[])`,
    [accountId, docs.map((d) => d.id)])).rows;
  const sig = (r: (typeof rows)[number]) => [r.benefit_name.toLowerCase().replace(/[^a-z0-9]/g, ""), (r.tier ?? "").toLowerCase(), r.row_kind ?? "", r.formula_kind, r.formula_value == null ? "" : Number(r.formula_value), r.currency ?? ""].join("|");
  let marked = 0;
  const byNumber = new Map<string, GroupPolicy[]>();
  for (const d of rank) byNumber.set(d.policy_number!.toUpperCase(), [...(byNumber.get(d.policy_number!.toUpperCase()) ?? []), d]);
  for (const same of byNumber.values()) {
    if (same.length < 2) continue;
    const kept = new Map<string, string>();
    for (const doc of same) {
      for (const row of rows.filter((r) => r.policy_id === doc.id)) {
        const keeper = kept.get(sig(row));
        if (keeper && keeper !== doc.id && !row.reviewed) {
          await query(`UPDATE policy_benefits SET duplicate_of_policy_id=$3 WHERE account_id=$1 AND id=$2`, [accountId, row.id, keeper]);
          marked++;
        } else if (!keeper) kept.set(sig(row), doc.id);
      }
    }
  }
  return marked;
}

/** Whether two documents state a different amount (or a different printed currency) for the same benefit or cover: the
 * same name, tier, kind and person class, each with an amount. A row with no amount, or a currency only one of them
 * prints, is no difference: a photo of a schedule that reads fewer figures is still a copy. Names are compared whole,
 * in any script, ignoring case and spacing. */
export async function statesOtherAmounts(accountId: string, policyId: string, otherId: string): Promise<boolean> {
  const name = (c: string) => `regexp_replace(lower(trim(${c})),'\\s+',' ','g')`;
  const differ = (x: string, y: string, value: string) => `${x}.${value} IS NOT NULL AND ${y}.${value} IS NOT NULL
      AND (${x}.${value}<>${y}.${value} OR (${x}.currency IS NOT NULL AND ${y}.currency IS NOT NULL AND upper(${x}.currency)<>upper(${y}.currency)))`;
  const result = await query<{ differs: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM policy_benefits x JOIN policy_benefits y ON y.account_id=x.account_id AND y.policy_id=$3
        AND ${name("x.benefit_name")}=${name("y.benefit_name")} AND coalesce(lower(x.tier),'')=coalesce(lower(y.tier),'')
        AND coalesce(x.row_kind,'benefit')=coalesce(y.row_kind,'benefit') AND x.formula_kind=y.formula_kind
       WHERE x.account_id=$1 AND x.policy_id=$2 AND x.formula_kind<>'none' AND ${differ("x", "y", "formula_value")})
     OR EXISTS(SELECT 1 FROM policy_coverages x JOIN policy_coverages y ON y.account_id=x.account_id AND y.policy_id=$3
        AND ${name("x.category")}=${name("y.category")} AND coalesce(lower(x.tier),'')=coalesce(lower(y.tier),'')
       WHERE x.account_id=$1 AND x.policy_id=$2 AND ${differ("x", "y", "amount")}) AS differs`,
    [accountId, policyId, otherId]);
  return !!result.rows[0]?.differs;
}

/** Contradictory amounts or currencies for the same benefit -- two pages of
 * one document, or two current versions of the same plan -- are never
 * silently collapsed: every row involved is kept and carries a
 * conflict_note naming the other statement(s). An answer that would have to
 * choose between them has the evidence it needs to withhold.
 *
 * The exception is evidence of which one is current: a later endorsement or
 * amendment of the same plan (see resolveStatements). Then the older row is
 * marked amended_by_policy_id (not current, still kept) with an
 * amendment_note, the amending row notes what it replaced, and neither is a
 * conflict. Superseded or deleted versions are not in conflict with the
 * current one; their notes are cleared. Recomputed from scratch each time. */
export async function markConflicts(accountId: string, policyId: string) {
  await ensureEvidenceSchema();
  const group = await planGroup(accountId, policyId);
  if (!group.length) return 0;
  const ids = group.map((g) => g.id);
  const current = group.filter((g) => g.current).map((g) => g.id);
  const byId = new Map(group.map((g) => [g.id, g]));
  const docs = new Map<string, StatementDoc>(group.map((g) => [g.id, { date: g.doc_date, amends: !!g.amends, name: g.original_filename }]));
  let marked = 0;
  const dated = (id: string) => docs.get(id)?.date ? ", effective " + docs.get(id)!.date : "";

  async function resolve(table: "policy_benefits" | "policy_coverages" | "coverage_rules", groups: Iterable<Statement[]>, subject: string) {
    for (const rows of groups) {
      const result = resolveStatements(rows, docs);
      for (const row of rows) {
        const conflicting = result.conflicts.get(row.id);
        const amender = result.amendedBy.get(row.id);
        const replaced = result.replaces.get(row.id);
        let conflictNote: string | null = null, amendedBy: string | null = null, amendmentNote: string | null = null;
        if (conflicting?.length) {
          conflictNote = "Conflicting statements for this " + subject + ": this row says " + row.label + " ("
            + where(byId.get(row.policyId), row.page, true).replace(" of this document", "") + "), but "
            + conflicting.slice(0, 3).map((o) => where(byId.get(o.policyId), o.page, o.policyId === row.policyId) + " states " + o.label).join("; ") + ".";
        }
        if (amender) {
          amendedBy = amender.policyId;
          amendmentNote = "Amended: " + where(byId.get(amender.policyId), amender.page, false) + dated(amender.policyId)
            + " changes this " + subject + " to " + amender.label + ". This row (" + row.label + ") is no longer current.";
        }
        if (replaced?.length) {
          amendmentNote = "This amendment" + dated(row.policyId) + " replaces " + replaced.slice(0, 3)
            .map((o) => o.label + " (" + where(byId.get(o.policyId), o.page, o.policyId === row.policyId) + ")").join("; ") + ".";
        }
        if (conflictNote || amendedBy || amendmentNote) {
          await query(`UPDATE ${table} SET conflict_note=$3,amended_by_policy_id=$4,amendment_note=$5 WHERE account_id=$1 AND id=$2`,
            [accountId, row.id, conflictNote, amendedBy, amendmentNote]);
          marked++;
        }
      }
    }
  }
  const grouped = <T>(items: T[], key: (item: T) => string, statement: (item: T) => Statement) => {
    const map = new Map<string, Statement[]>();
    for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), statement(item)]);
    return map.values();
  };

  // Benefits. A multi-column table states one value per tier or person class
  // ("Plan A" / "Plan B", "Adult" / "Child"): those are different statements,
  // never a contradiction. Typed schedule terms (a deductible, a co-insurance
  // percentage, a policy-year limit) are compared like any other stated value.
  await query(`UPDATE policy_benefits SET conflict_note=NULL,amended_by_policy_id=NULL,amendment_note=NULL,duplicate_of_policy_id=NULL WHERE account_id=$1 AND policy_id=ANY($2::uuid[])`, [accountId, ids]);
  const benefits = (await query<{ id: string; policy_id: string; benefit_name: string; formula_kind: string; formula_value: string | null; currency: string | null; source_page: number | null; tier: string | null; row_kind: string | null }>(
    `SELECT id,policy_id,benefit_name,formula_kind,formula_value::text,currency,source_page,tier,row_kind FROM policy_benefits
      WHERE account_id=$1 AND policy_id=ANY($2::uuid[]) AND (formula_kind<>'none' OR (formula_value IS NOT NULL AND coalesce(row_kind,'benefit')<>'benefit'))`, [accountId, current])).rows;
  const benefitSignature = (b: (typeof benefits)[number]) => [b.row_kind && b.row_kind !== "benefit" ? b.row_kind : b.formula_kind, b.formula_value == null ? "" : Number(b.formula_value), b.currency ?? ""].join("|");
  const benefitKey = (b: { benefit_name: string; tier: string | null }) => b.benefit_name.toLowerCase().replace(/[^a-z0-9]/g, "") + "|" + (b.tier ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  await resolve("policy_benefits", grouped(benefits, benefitKey, (b) => {
    const value = b.formula_value == null ? null : Number(b.formula_value);
    const kind = b.row_kind === "co_insurance" || b.row_kind === "pro_ration" ? "sum_insured" : b.formula_kind === "none" ? "fixed" : b.formula_kind;
    const label = (b.row_kind === "co_insurance" || b.row_kind === "pro_ration") && value != null ? Math.round(value * 10000) / 100 + "%" : describe(kind, value, b.currency);
    return { id: b.id, policyId: b.policy_id, page: b.source_page, signature: benefitSignature(b), label: (b.tier ? b.tier + ": " : "") + label };
  }), "benefit");
  marked += await markDuplicates(accountId, group);

  // Coverages: the same person's cover in the same category.
  await query(`UPDATE policy_coverages SET conflict_note=NULL,amended_by_policy_id=NULL,amendment_note=NULL WHERE account_id=$1 AND policy_id=ANY($2::uuid[])`, [accountId, ids]);
  const coverages = (await query<{ id: string; policy_id: string; family_member_id: string; category: string; amount: string | null; currency: string | null; source_page: number | null }>(
    `SELECT id,policy_id,family_member_id,category,amount::text,currency,source_page FROM policy_coverages
      WHERE account_id=$1 AND policy_id=ANY($2::uuid[]) AND amount IS NOT NULL`, [accountId, current])).rows;
  await resolve("policy_coverages", grouped(coverages, (c) => c.family_member_id + "|" + c.category.toLowerCase(), (c) => ({
    id: c.id, policyId: c.policy_id, page: c.source_page, signature: Number(c.amount) + "|" + (c.currency ?? ""), label: describe("fixed", Number(c.amount), c.currency) })), "cover");

  // Within one document, a fixed benefit that names the cover itself (a
  // "Death benefit" row under a Death cover) must agree with the cover's
  // stated amount: "Sum insured S$300,000" on page 1 and "Death benefit
  // US$350,000" on page 2 are two answers to one question, and the answer
  // must not pick one. Different benefits of a cover (accidental death,
  // fractures) are not compared.
  const coverIndex = new Map(coverages.map((c) => [c.policy_id + "|" + c.category, c]));
  for (const b of benefits) {
    if (b.formula_kind !== "fixed" || b.formula_value == null) continue;
    // A tier's column is one person class's amount, not the cover itself.
    if (b.tier || (b.row_kind && b.row_kind !== "benefit")) continue;
    // Round 10: a part of the cover ("Accidental medical expenses (per accident)", "Fracture") has its own
    // smaller limit under an accident plan's S$50,000; only a row naming the cover itself is compared.
    if (/\b(?:medical|expenses?|fractures?|cash|hospital\w*|burns?|dental|physio\w*|chinese|tcm|per day|daily|reimburs\w*|transport|funeral|ambulance|per accident)\b/i.test(b.benefit_name)) continue;
    // Round 7 (port): a stage of a multi-stage critical illness plan ("Early stage ... S$50,000", "Severe stage ... S$200,000")
    // pays its own amount by design; it does not contradict the plan's cover amount.
    if (/\b(?:early|intermediate|severe|advanced|minor|major|partial)\b[^\n]{0,20}\bstage\b|\bstage\b|\bper claim\b/i.test(b.benefit_name)) continue;
    const cover = coverIndex.get(b.policy_id + "|" + normalizeCoverageCategory(b.benefit_name));
    if (!cover || cover.amount == null) continue;
    const same = Number(cover.amount) === Number(b.formula_value) && (cover.currency ?? "") === (b.currency ?? "");
    if (same) continue;
    const benefitLabel = describe("fixed", Number(b.formula_value), b.currency), coverLabel = describe("fixed", Number(cover.amount), cover.currency);
    await query(`UPDATE policy_benefits SET conflict_note=$3 WHERE account_id=$1 AND id=$2 AND conflict_note IS NULL AND amended_by_policy_id IS NULL`,
      [accountId, b.id, "Conflicting statements for this benefit: this row says " + benefitLabel + " (page " + (b.source_page ?? "?") + "), but page " + (cover.source_page ?? "?") + " of this document states the cover as " + coverLabel + "."]);
    await query(`UPDATE policy_coverages SET conflict_note=$3 WHERE account_id=$1 AND id=$2 AND conflict_note IS NULL AND amended_by_policy_id IS NULL`,
      [accountId, cover.id, "Conflicting statements for this cover: this row says " + coverLabel + ", but page " + (b.source_page ?? "?") + " of this document states " + b.benefit_name + " as " + benefitLabel + "."]);
    marked += 2;
  }

  const ledger = (await query<{ t: string | null }>("SELECT to_regclass('public.coverage_rules')::text AS t")).rows[0]?.t;
  if (ledger) {
    // Ledger rows read by the model are resolved like benefits.
    await query(`UPDATE coverage_rules SET conflict_note=NULL,amended_by_policy_id=NULL,amendment_note=NULL WHERE account_id=$1 AND policy_id=ANY($2::uuid[])`, [accountId, ids]);
    const rules = (await query<{ id: string; policy_id: string; family_member_id: string; event_type: string; detail: string | null; cause: string | null; pays_kind: string; amount: string | null; currency: string; source_page: number | null }>(
      `SELECT id,policy_id,family_member_id,event_type,detail,cause,pays_kind,amount::text,currency,source_page FROM coverage_rules
        WHERE account_id=$1 AND policy_id=ANY($2::uuid[]) AND seed_key LIKE 'ai:%' AND status<>'rejected' AND amount IS NOT NULL`, [accountId, current])).rows;
    await resolve("coverage_rules", grouped(rules, (r) => [r.family_member_id, r.event_type, (r.detail ?? "").toLowerCase(), r.cause ?? "", r.pays_kind].join("|"), (r) => ({
      id: r.id, policyId: r.policy_id, page: r.source_page, signature: Number(r.amount) + "|" + r.currency,
      label: describe(r.pays_kind === "percent_of_sum" ? "sum_insured" : "fixed", Number(r.amount), r.currency) })), "rule");
    // Rows seeded from a benefit carry that benefit's status.
    await query(
      `UPDATE coverage_rules c SET conflict_note=b.conflict_note,amended_by_policy_id=b.amended_by_policy_id,amendment_note=b.amendment_note
         FROM policy_benefits b
        WHERE c.account_id=$1 AND c.policy_id=ANY($2::uuid[]) AND (c.seed_key IS NULL OR c.seed_key NOT LIKE 'ai:%')
          AND b.account_id=c.account_id AND b.policy_id=c.policy_id AND b.source_page IS NOT DISTINCT FROM c.source_page
          AND regexp_replace(coalesce(b.quote,''),'\\s+',' ','g')=regexp_replace(coalesce(c.quote,''),'\\s+',' ','g')`,
      [accountId, ids]);
  }
  return marked;
}
