/**
 * Conversational RAG: the tool registry a future model loop calls. Each tool has a name, a JSON-schema for its
 * parameters and a handler; every handler runs inside a household-scoped ToolContext (the account id is the
 * context's, never a parameter) and every result carries the EvidenceRefs it rests on.
 *
 * Figures cannot be invented through the registry: `compute` accepts only value ids issued by select_table_value in
 * this context, result ids of earlier computations, or household figures with the household's own words attached.
 * Nothing here is wired into the existing chat; runTool() refuses unless ragToolsEnabled() (lib/rag2/flag.ts).
 */
import type { EvidenceRef } from "./evidence";
import { ragToolsEnabled } from "./flag";
import { resolvePerson, type ConversationContext } from "./people";
import { policiesFor } from "./policies";
import { readPage, searchPassages } from "./search";
import { selectTableValue, type SelectedValue, type Want } from "./tables";
import { coInsurance, deductible, difference, householdFigure, minCap, perDay, percentage, product, sum, type ComputeOk, type Operand, type TableValueOperand } from "./compute";

export type JsonSchema = { type: string; description?: string; properties?: Record<string, JsonSchema>; required?: string[]; items?: JsonSchema; enum?: string[]; additionalProperties?: boolean; minimum?: number; maximum?: number; oneOf?: JsonSchema[] };
export type ToolContext = {
  readonly accountId: string; asOf: string; conversation: ConversationContext;
  /** Table values issued in this context (value id -> operand). */
  values: Map<string, { operand: TableValueOperand; selected: SelectedValue; subjectId: string }>;
  /** Computations made in this context (result id -> result). */
  results: Map<string, ComputeOk>;
  seq: number;
};
export type ToolResult = { ok: true; data: unknown; evidence: EvidenceRef[] } | { ok: false; error: string; evidence: EvidenceRef[] };
export type ToolDef = { name: string; description: string; parameters: JsonSchema; handler: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult> };

export function createToolContext(args: { accountId: string; speakerId?: string | null; lastSubjectId?: string | null; asOf?: string | null }): ToolContext {
  if (!args.accountId) throw new Error("a tool context needs the household's account id");
  return { accountId: args.accountId, asOf: (args.asOf ?? new Date().toISOString()).slice(0, 10), conversation: { speakerId: args.speakerId ?? null, lastSubjectId: args.lastSubjectId ?? null, recentSubjectIds: [] }, values: new Map(), results: new Map(), seq: 0 };
}

const str = (d: string): JsonSchema => ({ type: "string", description: d });
const ids = (d: string): JsonSchema => ({ type: "array", items: { type: "string" }, description: d });
const ok = (data: unknown, evidence: EvidenceRef[]): ToolResult => ({ ok: true, data, evidence });
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
    handler: async (ctx, a) => { const r = await readPage({ accountId: ctx.accountId, policyId: String(a.policy_id), page: Number(a.page) }); return r.status === "ok" ? ok(r, [r.evidence]) : fail(r.reason); },
  },
  {
    name: "resolve_person",
    description: "Work out which household member a mention means (a name, a relation such as 'my daughter' or 'my wife's mother', a pronoun, or 'me'). Returns ok, ambiguous (options and one question to ask) or unknown. Never guesses.",
    parameters: { type: "object", properties: { mention: str("The words used for the person.") }, required: ["mention"], additionalProperties: false },
    handler: async (ctx, a) => {
      const r = await resolvePerson({ accountId: ctx.accountId, mention: String(a.mention), conversationContext: ctx.conversation });
      if (r.status === "ok") { ctx.conversation.recentSubjectIds = [r.person.id, ...(ctx.conversation.recentSubjectIds ?? []).filter((x) => x !== r.person.id)].slice(0, 5); ctx.conversation.lastSubjectId = r.person.id; }
      return ok(r, []);
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
    parameters: { type: "object", properties: { policy_id: str("The document."), benefit: str("The benefit row, as the document words it if known."), subject_id: str("The household member."), tier: str("The member's column if the household has told you (e.g. 'Plan B', 'Child')."), want: { type: "string", enum: ["amount", "percent", "count", "any"] } }, required: ["policy_id", "benefit", "subject_id"], additionalProperties: false },
    handler: async (ctx, a) => {
      const r = await selectTableValue({ accountId: ctx.accountId, policyId: String(a.policy_id), benefit: String(a.benefit), subject: { memberId: String(a.subject_id), tier: (a.tier as string) ?? null }, want: ((a.want as Want) ?? "any"), asOf: ctx.asOf });
      if (r.status !== "ok") return ok(r, r.status === "ambiguous" ? r.options.flatMap((o) => (o.evidence ? [o.evidence] : [])) : r.evidence ? [r.evidence] : []);
      const valueId = "v" + ++ctx.seq;
      ctx.values.set(valueId, { selected: r, subjectId: String(a.subject_id), operand: { kind: "table_value", benefit: r.rowLabel || r.benefit, valueKind: r.valueKind, cents: r.cents, ppm: r.ppm, count: r.valueKind === "count" ? r.value : null, currency: r.currency, period: r.period, evidence: r.evidence } });
      return ok({ ...r, valueId }, [r.evidence, ...(r.columnBasis.evidence ? [r.columnBasis.evidence] : []), ...(r.amendedFrom ? [r.amendedFrom.evidence] : [])]);
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
];

/** Minimal JSON-schema check of a tool call's arguments (required keys, types, no unknown keys, enums). */
export function validateArgs(schema: JsonSchema, value: unknown, path = "args"): string | null {
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return `${path} must be an object`;
    const v = value as Record<string, unknown>;
    for (const k of schema.required ?? []) if (v[k] == null) return `${path}.${k} is required`;
    for (const [k, x] of Object.entries(v)) {
      const s = schema.properties?.[k];
      if (!s) { if (schema.additionalProperties === false) return `${path}.${k} is not a parameter of this tool`; continue; }
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
