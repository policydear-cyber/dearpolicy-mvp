/**
 * Conversational RAG: the tool registry a future model loop calls. Each tool has a name, a JSON-schema for its
 * parameters and a handler; every handler runs inside a household-scoped ToolContext (the account id is the
 * context's, never a parameter) and every result carries the EvidenceRefs it rests on.
 *
 * Figures cannot be invented through the registry: `compute` accepts only value ids issued by select_table_value in
 * this context, result ids of earlier computations, or household figures with the household's own words attached.
 * Nothing here is wired into the existing chat; runTool() refuses unless ragToolsEnabled() (lib/rag2/flag.ts).
 */
import { sharedTopic, topicStems } from "./loop/topic";
import type { EvidenceRef } from "./evidence";
import { ragToolsEnabled } from "./flag";
import { resolvePerson, type ConversationContext } from "./people";
import { policiesFor } from "./policies";
import { personBenefits, selectedFromBenefit, type PersonBenefit } from "./benefits";
import { householdDocuments } from "./inventory";
import { readPage, searchPassages } from "./search";
import { selectTableValue, type SelectedValue, type Want } from "./tables";
// --- Agent K: calculation tool (separate block; coordinator merges) ---
import { CALC_TOOLS } from "./calc/tool";
import { rankRecords, recordForModel, resolveBenefitRecords, type BenefitRecord } from "./benefit-records";
import { evaluateBenefit } from "./evaluate";
// --- end Agent K ---
import { coInsurance, deductible, difference, householdFigure, minCap, perDay, percentage, product, sum, type ComputeOk, type Operand, type TableValueOperand } from "./compute";

export type JsonSchema = { type: string; description?: string; properties?: Record<string, JsonSchema>; required?: string[]; items?: JsonSchema; enum?: string[]; additionalProperties?: boolean; minimum?: number; maximum?: number; oneOf?: JsonSchema[] };
export type ToolContext = {
  readonly accountId: string; asOf: string; conversation: ConversationContext;
  /** Table values issued in this context (value id -> operand). */
  values: Map<string, { operand: TableValueOperand; selected: SelectedValue; subjectId: string }>;
  /** Computations made in this context (result id -> result). */
  results: Map<string, ComputeOk>;
  seq: number;
  /** V1.4: the person's own row values person_benefits already issued (policy|subject|benefit -> value id): a
   * select_table_value for the same row reuses it instead of reading the table again. */
  personRows?: Map<string, string>;
  /** Actual-library findings: sum-insured value ids the SERVER bound to a schedule by the product section the schedule is
   * printed in (value id -> the certificate product it is printed under). Set by evaluate_benefit only. */
  sectionBound?: Map<string, string>;
  /** V1.5: what the conversation is about (the household's messages), for ranking printed wording by relevance. */
  topicText?: string;
  /** V1.5: tool reads already returned this turn (person_benefits per person, read_page per page): repeats are answered
   * by reference instead of resending the same records. */
  returned?: Set<string>;
  /** Reliable chat: the benefit records shown to the model this turn (benefit id -> record), for server-rendered
   * statements. Evaluation never trusts this cache: evaluate_benefit re-resolves the records every time. */
  benefitRecords?: Map<string, BenefitRecord>;
  /** Actual-library findings (latency): one resolution of a person's benefit records per turn (person_benefits,
   * evaluate_benefit and its handler resolved them up to three times). The documents do not change within a turn. */
  recordCache?: Map<string, Promise<BenefitRecord[]>>;
  /** Reliable chat: the household's own recorded words per person (the loop's facts), so evaluate_benefit's case is
   * checked against what they reported -- never only against the model's case words or option id. */
  reported?: Map<string, string[]>;
  /** PR #54 follow-up: the household's reports per person (recorded facts, and their own messages), oldest first, with
   * whether each corrected an earlier one -- what a benefit's definition is checked against (lib/rag2/applicability.ts). */
  reportedFacts?: Map<string, import("./applicability").Reported[]>;
  /** Reliable chat: per `${memberId}|${benefitId}`, the reported parts an evaluation found none of the listed cases covers. */
  unlisted?: Map<string, string[]>;
};
export type ToolResult = { ok: true; data: unknown; evidence: EvidenceRef[] } | { ok: false; error: string; evidence: EvidenceRef[] };
export type ToolDef = { name: string; description: string; parameters: JsonSchema; handler: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult> };

/** A person's benefit records, resolved once per turn (re-resolved on every turn: lifecycle, links and versions). */
export function recordsFor(ctx: ToolContext, subjectId: string): Promise<BenefitRecord[]> {
  const c = (ctx.recordCache ??= new Map());
  let p = c.get(subjectId);
  if (!p) { p = resolveBenefitRecords(ctx.accountId, subjectId); c.set(subjectId, p); p.catch(() => c.delete(subjectId)); }
  return p;
}
export function createToolContext(args: { accountId: string; speakerId?: string | null; lastSubjectId?: string | null; asOf?: string | null }): ToolContext {
  if (!args.accountId) throw new Error("a tool context needs the household's account id");
  return { accountId: args.accountId, asOf: (args.asOf ?? new Date().toISOString()).slice(0, 10), conversation: { speakerId: args.speakerId ?? null, lastSubjectId: args.lastSubjectId ?? null, recentSubjectIds: [] }, values: new Map(), results: new Map(), seq: 0 };
}

const str = (d: string): JsonSchema => ({ type: "string", description: d });
const ids = (d: string): JsonSchema => ({ type: "array", items: { type: "string" }, description: d });
const ok = (data: unknown, evidence: EvidenceRef[]): ToolResult => ({ ok: true, data, evidence });
/** Agent F (D5): operand positions that are the policy's own terms, per compute operation. */
const POLICY_OPERANDS: Record<string, [number, string][]> = {
  per_day: [[0, "the daily rate"], [2, "the day cap"]],
  min_cap: [[1, "the cap"]],
  deductible: [[1, "the deductible"]],
  co_insurance: [[1, "the co-insurance rate"], [2, "the co-insurance cap"]],
};
const fail = (error: string, evidence: EvidenceRef[] = []): ToolResult => ({ ok: false, error, evidence });
const OPERAND: JsonSchema = { type: "object", description: "One input: a value_id from select_table_value, a result_id from compute, or a household figure with the household's own words.", properties: {
  value_id: str("A value id issued by select_table_value in this conversation."),
  result_id: str("A result id issued by compute in this conversation."),
  household: { type: "object", properties: { label: str("What the figure is (\"hospital bill\")."), attribution: str("The household's own words the figure comes from, quoted."), amount: { type: "number" }, currency: str("ISO code, e.g. SGD."), count: { type: "integer", minimum: 0 }, percent: { type: "number", minimum: 0, maximum: 100 } }, required: ["label", "attribution"], additionalProperties: false },
}, additionalProperties: false };

function operandOf(ctx: ToolContext, o: Record<string, unknown>): Operand | string {
  if (typeof o.value_id === "string") { const v = ctx.values.get(o.value_id); return v ? v.operand : `unknown value_id ${o.value_id}: values must come from select_table_value in this conversation`; }
  if (typeof o.result_id === "string") { const r = ctx.results.get(o.result_id); return r ?? `unknown result_id ${o.result_id}`; }
  if (o.household && typeof o.household === "object") {
    const h = o.household as Record<string, unknown>;
    if (typeof h.attribution !== "string" || !h.attribution.trim()) return "a household figure needs the household's own words (attribution)";
    return householdFigure(String(h.label ?? "figure"), h.attribution, { amount: typeof h.amount === "number" ? h.amount : undefined, currency: typeof h.currency === "string" ? h.currency.toUpperCase() : undefined, count: typeof h.count === "number" ? h.count : undefined, percent: typeof h.percent === "number" ? h.percent : undefined });
  }
  return "an operand must be a value_id, a result_id or a household figure";
}

export const RAG_TOOLS: ToolDef[] = [
  {
    name: "search_passages",
    description: "Search the household's readable policy documents for passages about a topic. Returns ranked verbatim passages with evidence (policy, version, page, offsets).",
    parameters: { type: "object", properties: { query: str("What to look for."), subject_id: str("Only documents covering this household member."), policy_ids: ids("Only these documents."), k: { type: "integer", minimum: 1, maximum: 20 } }, required: ["query"], additionalProperties: false },
    handler: async (ctx, a) => { const r = await searchPassages({ accountId: ctx.accountId, query: String(a.query), subjectId: (a.subject_id as string) ?? null, policyIds: (a.policy_ids as string[]) ?? null, k: (a.k as number) ?? 8 }); return ok(r, r.hits.map((h) => h.evidence)); },
  },
  {
    name: "read_page",
    description: "Read one whole stored page of one of the household's readable documents.",
    parameters: { type: "object", properties: { policy_id: str("The document."), page: { type: "integer", minimum: 1 } }, required: ["policy_id", "page"], additionalProperties: false },
    handler: async (ctx, a) => {
      const key = `read_page|${String(a.policy_id)}|${Number(a.page)}`;
      const r = await readPage({ accountId: ctx.accountId, policyId: String(a.policy_id), page: Number(a.page) });
      if (r.status !== "ok") return fail(r.reason);
      // V1.5: the same page twice in one turn is answered by reference (its evidence id), not resent.
      if ((ctx.returned ??= new Set()).has(key)) return ok({ status: "ok", reused: "this page was already read this turn -- use that result" }, [r.evidence]);
      ctx.returned.add(key);
      return ok(r, [r.evidence]);
    },
  },
  {
    name: "resolve_person",
    description: "Work out which household member a mention means (a name, a relation such as 'my daughter' or 'my wife's mother', a pronoun, or 'me'). Returns ok, ambiguous (options and one question to ask) or unknown. Never guesses.",
    parameters: { type: "object", properties: { mention: str("The words used for the person.") }, required: ["mention"], additionalProperties: false },
    handler: async (ctx, a) => {
      const r = await resolvePerson({ accountId: ctx.accountId, mention: String(a.mention), conversationContext: ctx.conversation });
      // "me" / "my" is the speaker, not who the conversation is about: a side question about the speaker never moves
      // what "he" / "she" refers to (the claim's subject).
      if (r.status === "ok" && r.via !== "self") { ctx.conversation.recentSubjectIds = [r.person.id, ...(ctx.conversation.recentSubjectIds ?? []).filter((x) => x !== r.person.id)].slice(0, 5); ctx.conversation.lastSubjectId = r.person.id; }
      return ok(r, []);
    },
  },
  {
    name: "household_documents",
    description: "List every document the household has uploaded, grouped by person: insurer, product and role (a personal policy document, reference wording such as a group policy wording, or linked but not confirmed), documents linked to nobody, and files that could not be read (and why). Use it for questions about what policies or documents the family has. It states no amounts.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: async (ctx) => { const r = await householdDocuments(ctx.accountId); return ok(r, [...r.people.flatMap((p) => p.documents), ...r.unlinked].map((d) => d.evidence).filter((e): e is EvidenceRef => !!e)); },
  },
  {
    name: "person_benefits",
    description: "One household member's DOCUMENTED benefits, read from their linked documents: each document (personal proof such as a certificate, reference wording such as a product summary, or an amendment) with each benefit it prints for them -- the product / benefit as the document names it, the printed amount or percentage (and what it is a percentage of), its date, its printed conditions, page, and a value_id for an amount printed on the person's own row. Lists conflicts (a certificate and an endorsement printing different amounts) and what is unresolved. Printed facts only: never confirmation of current cover or of a claim. Use it first for questions about what a person is covered for, or after an event (a death, an accident, an illness).",
    parameters: { type: "object", properties: { subject_id: str("The household member."), topic: str("Optional: what the question is about (e.g. 'death after an accident', 'fracture', 'hospital stay'): printed wording about it is returned first.") }, required: ["subject_id"], additionalProperties: false },
    handler: async (ctx, a) => {
      const view = await personBenefits(ctx.accountId, String(a.subject_id));
      if (!view.member.name) return fail("that person is not an active member of this household");
      // V1.5 (live verification: one call returned 95 evidence records and the turn ran out of model budget): the
      // person's own rows and amendments are always returned; shared reference wording ranked by how much it is about the
      // question (topic, else the conversation), at most SHARED_MAX lines, the rest counted. A second call for the same
      // person in the same turn is answered by reference.
      const key = `person_benefits|${String(a.subject_id)}|${String(a.topic ?? "")}`;
      if ((ctx.returned ??= new Set()).has(key)) return ok({ person: view.member.name, reused: "already returned earlier this turn -- use the value_ids and evidence ids from that result" }, []);
      ctx.returned.add(key);
      const SHARED_MAX = 10;
      const want = topicStems(String(a.topic ?? "") + " " + (ctx.topicText ?? ""));
      const score = (b: PersonBenefit) => sharedTopic(want, topicStems([b.benefit.label, b.policy.product ?? "", ...b.conditions].join(" "))).length;
      const shared = view.benefits.filter((b) => b.applicability === "shared_wording");
      const ranked = shared.map((b, i) => ({ b, i, s: score(b) })).sort((x, y) => y.s - x.s || x.i - y.i);
      // Exclusions and limitations printed for this person's products are never cut for relevance: a ranked-out
      // exclusion would make the answer look unconditional. (The person's own rows and amendments are kept above.)
      const EXCLUSION = /\b(?:exclusions?|excluded|not covered|does not cover|will not pay|we do not pay|no benefit|not payable|limitations?)\b/i;
      const keepShared = new Set([...ranked.slice(0, SHARED_MAX).map((x) => x.b), ...shared.filter((b) => EXCLUSION.test([b.benefit.label, ...b.conditions, b.source.passage].join(" "))).slice(0, SHARED_MAX)]);
      const omitted = shared.length - keepShared.size;
      view.benefits = view.benefits.filter((b) => b.applicability !== "shared_wording" || keepShared.has(b));
      // Reliable chat: every benefit carries its server-resolved benefit_id; percentage schedules (a table of cases each
      // paying a percentage of a base the header names) are listed with their cases and resolved base.
      const records = await recordsFor(ctx, String(a.subject_id));
      for (const r of records) (ctx.benefitRecords ??= new Map()).set(r.id, r);
      const idOf = new Map(records.filter((r) => r.personBenefit).map((r) => [r.personBenefit!.key, r.id]));
      const schedules = rankRecords(records.filter((r) => r.kind === "percentage_schedule"), String(a.topic ?? "") + " " + (ctx.topicText ?? "")).slice(0, 4).map(recordForModel);
      const fmt = (b: PersonBenefit) => b.printed.kind === "money" ? `${b.printed.currency === "SGD" ? "S$" : b.printed.currency + " "}${b.printed.amount.toLocaleString("en-SG")}${b.printed.unit ? " " + b.printed.unit : ""}` : b.printed.kind === "percent" ? `${b.printed.percent}%${b.printed.of ? " of the " + b.printed.of : ""}` : `the ${b.printed.of}`;
      const byDoc = new Map<string, PersonBenefit[]>();
      for (const b of view.benefits) byDoc.set(b.policy.id, [...(byDoc.get(b.policy.id) ?? []), b]);
      const documents = [];
      for (const [policyId, bs] of byDoc) {
        const p = bs[0].policy;
        const benefits = [];
        for (const b of bs) {
          let valueId: string | null = null;
          if (b.applicability === "person_row" && b.printed.kind === "money" && !b.conflicts?.length) {
            const r0 = await selectTableValue({ accountId: ctx.accountId, policyId, benefit: b.benefit.label, subject: { memberId: String(a.subject_id) }, want: "amount", asOf: ctx.asOf }).catch(() => null);
            // A roster the table parser does not read (one cell per line): the view's own reconstructed row.
            const r = r0?.status === "ok" ? r0 : selectedFromBenefit(b, view.member.name);
            if (r?.status === "ok" && r.valueKind === "money" && r.cents === b.printed.cents && r.currency === b.printed.currency) {
              valueId = "v" + ++ctx.seq;
              ctx.values.set(valueId, { selected: r, subjectId: String(a.subject_id), operand: { kind: "table_value", benefit: r.rowLabel || r.benefit, valueKind: r.valueKind, cents: r.cents, ppm: r.ppm, count: null, currency: r.currency, period: r.period, evidence: r.evidence } });
              (ctx.personRows ??= new Map()).set(`${policyId}|${String(a.subject_id)}|${b.benefit.label.toLowerCase()}`, valueId);
            }
          }
          benefits.push({ ...(idOf.get(b.key) ? { benefit_id: idOf.get(b.key) } : {}), benefit: b.benefit.label, printed: fmt(b), applies: b.applicability === "person_row" ? "printed on this person's own row" : b.applicability === "amendment" ? "an amendment naming this person" : "wording for every insured person (not a figure about this person alone)",
            as_of: b.asOf, conditions: b.conditions, page: b.source.page, ...(valueId ? { value_id: valueId } : {}), ...(b.amendedBy ? { amended: `amended to ${b.amendedBy.currency === "SGD" ? "S$" : b.amendedBy.currency + " "}${b.amendedBy.amount.toLocaleString("en-SG")} with effect from ${b.amendedBy.effective} by an endorsement of this policy (page ${b.amendedBy.page}); this row's amount is the amount before that date` } : {}),
            ...(b.amends ? { amends: `replaces ${b.amends.currency === "SGD" ? "S$" : b.amends.currency + " "}${b.amends.amount.toLocaleString("en-SG")}${b.amends.asOf ? ` (printed as of ${b.amends.asOf})` : ""} from ${b.asOf}, as this endorsement's wording says` } : {}),
            ...(b.conflicts?.length ? { conflicts: b.conflicts.map((c) => `${c.currency} ${c.amount.toLocaleString("en-SG")} on page ${c.page} of another document of this policy${c.effective ? ` (${c.effective})` : ""}`) } : {}), evidence: b.source.evidence });
        }
        documents.push({ policy_id: policyId, product: p.product, insurer: p.insurer, role: p.personalProof ? "personal proof (lists this person)" : bs.some((b) => b.applicability === "amendment") ? "amendment" : "reference wording", benefits });
      }
      return ok({ person: view.member.name, documents, ...(schedules.length ? { schedules } : {}), unresolved: view.unresolved, ...(omitted > 0 ? { omitted: `${omitted} other printed wording line(s) of these documents are not listed (not about this question); call again with a topic, or search_passages, if you need them` } : {}), note: "These are this person's printed benefit lines in their linked documents, each with a benefit_id: to work out what a benefit gives for a case or a stay, call evaluate_benefit with its benefit_id (the server reads the operands); to state a benefit's printed terms, use a statement of kind benefit_terms with its benefit_id. search_passages only for something not listed here. Printed facts only. A dated amount is the document's amount on that date, not confirmation of current cover; amounts of different benefits are never added into a total unless a document says they are paid together." }, view.benefits.map((b) => b.source.evidence));
    },
  },
  {
    name: "evaluate_benefit",
    description: "Work out what ONE benefit (a benefit_id from person_benefits) gives for this person, on the server: it reads the benefit's own operands from the documents (a schedule's row and the amount its header names as the base -- a fixed benefit limit or the person's own sum insured; a printed daily rate) and runs DearPolicy's calculators. Pass only what the household reported: the case in their own words (case) or the option_id of the listed case their words identify, the stay's admission / discharge for a daily rate, and their own words for the what-if or event. Never pass amounts, percentages, quotes or pages. Returns status documented_terms (the printed terms), needs_facts (what is still needed, with the listed options -- ask the household; never choose for them), conditional_illustration / indicative_estimate / not_payable / unresolved (with result_id: state it with a statement of kind calculation citing result_id), unresolved_evidence (what the documents do not establish) or unsupported_operation. Results: needs_facts (reason missing: they have not said which case; ambiguous: their words fit more than one listed case -- ask which of THOSE), unlisted_case (what they reported is not a listed case: say so, ask nothing about the cases), case_conflict (the option is not what they reported), not_applicable (its definition does not fit the report).",
    parameters: { type: "object", properties: {
      benefit_id: str("The benefit, as person_benefits identified it (b...)."),
      subject_id: str("The household member."),
      purpose: { type: "string", enum: ["what_if", "claim", "question"], description: "what_if: the household asked what would happen; claim: they reported an event and are pursuing a claim; question: they asked about the terms." },
      case: str("Optional: the case in the household's own words (\"the shin bone\", \"his thigh\"), when they gave it."),
      option_id: str("Optional: the option_id of a listed case that the household's words identify (from schedule.cases or a needs_facts result)."),
      assumption_words: str("Optional: the household's own words for the what-if or the event, quoted."),
      fact_keys: { type: "array", items: { type: "string" }, description: "The recorded facts (note_facts keys) the case or event rests on, e.g. [\"bone\"]: correcting one of them withdraws this result." },
      admission: { type: "object", description: "A daily-rate benefit: the admission the household gave.", properties: { at: str("ISO date-time with offset, or a date."), words: str("Their words, verbatim."), assumed: { type: "boolean" } }, required: ["at", "words"], additionalProperties: false },
      discharge: { type: "object", description: "A daily-rate benefit: the discharge the household gave.", properties: { at: str("ISO date-time with offset, or a date."), words: str("Their words, verbatim."), assumed: { type: "boolean" } }, required: ["at", "words"], additionalProperties: false },
      stay_ongoing: { type: "boolean" },
    }, required: ["benefit_id", "subject_id", "purpose"], additionalProperties: false },
    handler: async (ctx, a) => {
      const res = await evaluateBenefit(ctx, a);
      if (res.ok) { const recs = await recordsFor(ctx, String(a.subject_id)); for (const r of recs) (ctx.benefitRecords ??= new Map()).set(r.id, r); }
      return res;
    },
  },
  {
    name: "policies_for",
    description: "List the household's documents that insure one member (as an insured person, not merely owner / nominee / assignee), with in-force status, current version and reasons for not covering.",
    parameters: { type: "object", properties: { subject_id: str("The household member."), topic: str("Optional topic, e.g. 'hospital', 'accident', 'critical illness'."), as_of: str("Date, YYYY-MM-DD (default today).") }, required: ["subject_id"], additionalProperties: false },
    handler: async (ctx, a) => { const r = await policiesFor({ accountId: ctx.accountId, subjectId: String(a.subject_id), topic: (a.topic as string) ?? null, asOf: (a.as_of as string) ?? ctx.asOf }); return ok(r, [...r.covering, ...r.notCovering].flatMap((p) => p.evidence)); },
  },
  {
    name: "select_table_value",
    description: "Read the value a document's benefit table prints for one benefit in the member's own column (their person class / tier / plan). Returns ok with a value_id usable in compute, ambiguous (options and one question) or missing (why).",
    parameters: { type: "object", properties: { policy_id: str("The document."), benefit: str("The benefit row, as the document words it if known."), subject_id: str("The household member."), tier: str("The member's column if the household has told you (e.g. 'Plan B', 'Child')."), want: { type: "string", enum: ["amount", "percent", "count", "any"] }, as_of: str("The date the value is needed for, YYYY-MM-DD (the event's date when the household gave one; default today). Decides which version of an amended row applies.") }, required: ["policy_id", "benefit", "subject_id"], additionalProperties: false },
    handler: async (ctx, a) => {
      const asOf = typeof a.as_of === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.as_of) ? a.as_of : ctx.asOf;
      if (typeof a.as_of === "string" && asOf !== a.as_of) return fail("as_of must be a date written YYYY-MM-DD");
      // V1.4: the same row person_benefits already read this turn: its value, not a second read.
      const tidyB = String(a.benefit).replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
      const reused = ctx.personRows?.get(`${String(a.policy_id)}|${String(a.subject_id)}|${tidyB}`);
      if (reused && ctx.values.has(reused) && (a.want == null || a.want === "amount" || a.want === "any") && !a.as_of && !a.tier) {
        const v = ctx.values.get(reused)!;
        return ok({ status: "ok", valueId: reused, value: (v.operand.cents ?? 0) / 100, currency: v.operand.currency, row: v.operand.benefit, reused: "already read by person_benefits this turn -- the same value id" }, []);
      }
      const pick = (on: string) => selectTableValue({ accountId: ctx.accountId, policyId: String(a.policy_id), benefit: String(a.benefit), subject: { memberId: String(a.subject_id), tier: (a.tier as string) ?? null }, want: ((a.want as Want) ?? "any"), asOf: on });
      const r = await pick(asOf);
      if (r.status !== "ok") return ok(r, r.status === "ambiguous" ? r.options.flatMap((o) => (o.evidence ? [o.evidence] : [])) : r.evidence ? [r.evidence] : []);
      const issue = (s: SelectedValue) => { const id = "v" + ++ctx.seq; ctx.values.set(id, { selected: s, subjectId: String(a.subject_id), operand: { kind: "table_value", benefit: s.rowLabel || s.benefit, valueKind: s.valueKind, cents: s.cents, ppm: s.ppm, count: s.valueKind === "count" ? s.value : null, currency: s.currency, period: s.period, evidence: s.evidence } }); return id; };
      // An endorsement row read directly: the schedule row it amends travels with it (the amendment relationship).
      if (r.amends?.policyId && r.amends.policyId !== String(a.policy_id) && !r.related?.length) {
        const b = await selectTableValue({ accountId: ctx.accountId, policyId: r.amends.policyId, benefit: String(a.benefit), subject: { memberId: String(a.subject_id), tier: (a.tier as string) ?? null }, want: ((a.want as Want) ?? "any"), asOf }).catch(() => null);
        const baseEv = b?.status === "ok" ? (b.evidence.policyId === r.amends.policyId ? b.evidence : b.amendedFrom?.evidence.policyId === r.amends.policyId ? b.amendedFrom.evidence : null) : null;
        if (baseEv) r.related = [baseEv];
      }
      const valueId = issue(r);
      // V1.1 (evidence contract): a row printed in two versions (an endorsement's before / after) also returns the
      // other version, as its own value id with the date it applies from or until -- so "previously S$800" is cited.
      let otherVersion: Record<string, unknown> | null = null;
      const eff = r.amends?.effectiveDate ?? r.columnBasis.detail.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
      if ((r.version === "after" || r.version === "before") && eff) {
        const d = new Date(eff + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1);
        const o = await pick(r.version === "after" ? d.toISOString().slice(0, 10) : eff);
        if (o.status === "ok" && o.version && o.version !== r.version) otherVersion = { valueId: issue(o), version: o.version, value: o.value, currency: o.currency, columnHeader: o.columnHeader, applies: o.version === "before" ? `before ${eff}` : `from ${eff}` };
      }
      return ok({ ...r, valueId, asOf, ...(otherVersion ? { otherVersion } : {}) }, [r.evidence, ...(r.columnBasis.evidence ? [r.columnBasis.evidence] : []), ...(r.amendedFrom ? [r.amendedFrom.evidence] : []), ...(r.related ?? [])]);
    },
  },
  {
    name: "compute",
    description: "Deterministic integer-cent arithmetic over issued values and attributed household figures: sum, difference, product, min_cap, percentage, per_day (rate, days, optional day cap), deductible, co_insurance (amount, rate, optional cap). Results are labelled printed_limit or indicative_estimate (never a payout); estimates never enter totals; mixed currencies are refused.",
    parameters: { type: "object", properties: { operation: { type: "string", enum: ["sum", "difference", "product", "min_cap", "percentage", "per_day", "deductible", "co_insurance"] }, operands: { type: "array", items: OPERAND }, label: str("What the result is.") }, required: ["operation", "operands"], additionalProperties: false },
    handler: async (ctx, a) => {
      const raw = (a.operands as Record<string, unknown>[]) ?? [];
      const ops: Operand[] = [];
      for (const o of raw) { const x = operandOf(ctx, o ?? {}); if (typeof x === "string") return fail(x); ops.push(x); }
      // Agent F (D5): a household's own figure is never a POLICY operand -- a daily rate, a day cap, a cap or limit, a
      // deductible, a co-insurance rate or cap comes only from the document (select_table_value).
      for (const [i, what] of POLICY_OPERANDS[String(a.operation)] ?? []) {
        const o = ops[i] as (Operand & { kind?: string; householdFigures?: unknown[] }) | undefined;
        if (o && (o.kind === "household_figure" || ((o as ComputeOk).status === "ok" && ((o as ComputeOk).householdFigures?.length ?? 0) > 0))) return fail(`${what} must be the figure printed in the document (read it with select_table_value): a figure the household gives is never used as the policy's ${what.replace(/^the /, "")}`);
      }
      const label = (a.label as string) ?? String(a.operation);
      const need = (n: number, m = n) => (ops.length < n || ops.length > m ? `${a.operation} takes ${n === m ? n : `${n} to ${m}`} operands` : null);
      let r;
      switch (a.operation) {
        case "sum": r = sum(ops, label); break;
        case "difference": r = need(2) ?? difference(ops[0], ops[1], label); break;
        case "product": r = need(2) ?? product(ops[0], ops[1], label); break;
        case "min_cap": r = need(2) ?? minCap(ops[0], ops[1], label); break;
        case "percentage": r = need(2) ?? percentage(ops[0], ops[1], label); break;
        case "per_day": r = need(2, 3) ?? perDay(ops[0], ops[1], ops[2] ?? null, label); break;
        case "deductible": r = need(2) ?? deductible(ops[0], ops[1], label); break;
        case "co_insurance": r = need(2, 3) ?? coInsurance(ops[0], ops[1], ops[2] ?? null, label); break;
        default: return fail(`unknown operation ${String(a.operation)}`);
      }
      if (typeof r === "string") return fail(r);
      if (r.status !== "ok") return fail(r.reason);
      const resultId = "r" + ++ctx.seq;
      ctx.results.set(resultId, r);
      return ok({ ...r, resultId }, r.evidence);
    },
  },
  // --- Agent K: the `calculate` tool (lib/rag2/calc/tool.ts) ---
  ...CALC_TOOLS,
  // --- end Agent K ---
];

/** Minimal JSON-schema check of a tool call's arguments (required keys, types, no unknown keys, enums). */
export function validateArgs(schema: JsonSchema, value: unknown, path = "args"): string | null {
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return `${path} must be an object`;
    const v = value as Record<string, unknown>;
    for (const k of schema.required ?? []) if (v[k] == null) return `${path}.${k} is required`;
    for (const [k, x] of Object.entries(v)) {
      const s = schema.properties?.[k];
      if (!s) { if (schema.additionalProperties === false) return `${path}.${k} is not a parameter of this tool (allowed here: ${Object.keys(schema.properties ?? {}).join(", ")})`; continue; }
      if (x == null) continue;
      const e = validateArgs(s, x, `${path}.${k}`); if (e) return e;
    }
    return null;
  }
  if (schema.type === "array") { if (!Array.isArray(value)) return `${path} must be an array`; for (const [i, x] of value.entries()) { const e = schema.items ? validateArgs(schema.items, x, `${path}[${i}]`) : null; if (e) return e; } return null; }
  if (schema.type === "string") { if (typeof value !== "string") return `${path} must be a string`; if (schema.enum && !schema.enum.includes(value)) return `${path} must be one of ${schema.enum.join(", ")}`; return null; }
  if (schema.type === "integer" || schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value))) return `${path} must be ${schema.type === "integer" ? "a whole number" : "a number"}`;
    if (schema.minimum != null && value < schema.minimum) return `${path} must be at least ${schema.minimum}`;
    if (schema.maximum != null && value > schema.maximum) return `${path} must be at most ${schema.maximum}`;
    return null;
  }
  return null;
}

/** Runs one tool call in the household's context. Refused while the flag is off. */
export async function runTool(ctx: ToolContext, name: string, args: unknown, env: NodeJS.ProcessEnv = process.env): Promise<ToolResult> {
  if (!ragToolsEnabled(env)) return fail("the conversational retrieval tools are switched off (DEARPOLICY_RAG_TOOLS)");
  const tool = RAG_TOOLS.find((t) => t.name === name);
  if (!tool) return fail(`unknown tool ${name}`);
  const bad = validateArgs(tool.parameters, args);
  if (bad) return fail(bad);
  try { return await tool.handler(ctx, args as Record<string, unknown>); }
  catch (error) { return fail(`the tool failed: ${error instanceof Error ? error.message : String(error)}`); }
}

/** The tool list in the shape a model API takes (name, description, JSON-schema parameters). */
export function toolSpecs(): { name: string; description: string; input_schema: JsonSchema }[] {
  return RAG_TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
}
