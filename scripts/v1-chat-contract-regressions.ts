/**
 * V1 core-loop chat contract (certification script, turns 1-10).
 *
 * Runs the REAL chat API route (app/api/chat/route.ts -> lib/chat/workflow.ts)
 * against PGlite with the same deterministic model stand-in the local browser
 * stack uses (DEARPOLICY_DETERMINISTIC_MODEL=synthetic-e2e, see
 * lib/ai/deterministic-model.ts). Every other network call throws. Data is
 * synthetic: household A (Charmaine: hospital plan, personal-accident plan
 * with a fracture benefit and a permanent-disablement schedule; Marcus: a
 * travel plan with SGD and USD limits and an endowment with no medical
 * benefit) and household B (isolation: a travel plan that must never appear).
 *
 * Each turn asserts the V1 acceptance rules on what the household SEES:
 * summary, details, questions, claim cards, citations, next steps, fact
 * lists, review tables and the disclaimer. Failures are collected per turn
 * (the chat continues so later turns are still exercised) and the script
 * exits non-zero if any assertion failed. Assertions are the contract; they
 * are not relaxed to make a run green.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { NextRequest } from "next/server";
import type { ChatAnswer } from "@/types";

process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
process.env.E2E_RUN_ID = "v1chatcontract";
process.env.DEV_AUTH_ENABLED = "1";
process.env.MODEL_PRESET = process.env.MODEL_PRESET || "openai";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-not-used";
delete process.env.PINECONE_API_KEY;
const ACCOUNT = "00000000-0000-0000-0000-00000000a001", FOREIGN = "00000000-0000-0000-0000-00000000b002";
process.env.DEV_ACCOUNT_ID = ACCOUNT;

const uuid = (n: number) => "20000000-0000-4000-8000-" + String(n).padStart(12, "0");
const CHARMAINE = uuid(1), MARCUS = uuid(2), FOREIGN_PERSON = uuid(3), IVY = uuid(4), KEN = uuid(5);
const vec = "[" + Array.from({ length: 1024 }, (_, j) => (j === 0 ? 1 : 0)).join(",") + "]";

type Page = { page: number; text: string };
type Benefit = { name: string; traits: string[]; requires?: string[]; kind: string; value: number | null; currency: string | null; factKey?: string | null; maximumDays?: number | null; page: number; quote: string };
type Plan = { key: string; account: string; member: string; product: string; number: string; type: string; schedule: string; wording: Page[];
  coverages: { category: string; amount: number; currency: string }[]; benefits: Benefit[];
  /** Browser-shaped: ONE personalised schedule whose page 2 is the benefit
   * table (OCR text, no sentence breaks), with the benefits stored from it. */
  scheduleOnly?: Page[] };
/** The benefit rows of a browser-shaped schedule: stored with page 2 and a quote of the printed row. */
const rowBenefit = (name: string, printed: string, kind: string, value: number | null, currency: string | null, traits: string[], requires: string[] = []): Benefit =>
  ({ name, traits, requires, kind, value, currency, page: 2, quote: name + " " + printed });
const schedulePages = (label: string, insured: string, heading: string, rows: [string, string][], prose = "") => [
  { page: 1, text: label + " Policy Schedule Insured: " + insured + " Policy number " + label.toUpperCase().slice(0, 3) + "-9 Effective date 2024-01-01" },
  { page: 2, text: heading + " " + rows.map(([a, b]) => a + " " + b).join(" ") + (prose ? " " + prose : "") + " SYNTHETIC TEST DOCUMENT - NOT A REAL INSURANCE POLICY Page 2 of 3" },
  { page: 3, text: label + " General conditions apply as set out in the policy contract. Page 3 of 3" },
];

const PLANS: Plan[] = [
  // Household A, second pair of members: the browser fixture's shape
  // (e2e/support/v1-fixtures.ts), stored benefits on schedule page 2.
  { key: "ivy-hospital", account: ACCOUNT, member: IVY, product: "HospitalShield", number: "HOS-9", type: "Hospitalisation", schedule: "", wording: [],
    coverages: [{ category: "Hospitalisation", amount: 1000000, currency: "SGD" }],
    scheduleOnly: schedulePages("HospitalShield", "Ivy Tan", "Schedule of Benefits - Hospital and Surgical", [
      ["Daily room and board (1-bed private ward)", "S$800 per day, maximum 120 days"], ["Intensive care unit", "S$1,500 per day, maximum 30 days"],
      ["Surgical fees", "Up to S$25,000 per surgery"], ["Pre-hospitalisation treatment", "Up to S$3,000 per admission"]]),
    benefits: [
      rowBenefit("Daily room and board (1-bed private ward)", "S$800 per day, maximum 120 days", "daily", 800, "SGD", ["hospitalisation"]),
      rowBenefit("Intensive care unit", "S$1,500 per day, maximum 30 days", "daily", 1500, "SGD", ["hospitalisation"]),
      rowBenefit("Surgical fees", "Up to S$25,000 per surgery", "expense_cap", 25000, "SGD", ["hospitalisation", "medical_expense"]),
      rowBenefit("Pre-hospitalisation treatment", "Up to S$3,000 per admission", "expense_cap", 3000, "SGD", ["hospitalisation", "medical_expense"])] },
  { key: "ivy-accident", account: ACCOUNT, member: IVY, product: "AccidentGuard", number: "ACC-9", type: "Personal Accident", schedule: "", wording: [],
    coverages: [{ category: "Personal Accident", amount: 100000, currency: "SGD" }],
    scheduleOnly: schedulePages("AccidentGuard", "Ivy Tan", "Schedule of Benefits - Accident", [
      ["Fracture of arm", "S$1,000"], ["Fracture of leg", "S$1,500"], ["Accident medical reimbursement", "Up to S$2,000 per accident"], ["Accidental death", "100% of Sum Insured"]]),
    benefits: [
      rowBenefit("Fracture of arm", "S$1,000", "fixed", 1000, "SGD", ["accident", "bodily_injury"], ["accident"]),
      rowBenefit("Fracture of leg", "S$1,500", "fixed", 1500, "SGD", ["accident", "bodily_injury"], ["accident"]),
      rowBenefit("Accident medical reimbursement", "Up to S$2,000 per accident", "expense_cap", 2000, "SGD", ["accident", "medical_expense"], ["accident"]),
      rowBenefit("Accidental death", "100% of Sum Insured", "sum_insured", 1, null, ["death", "accident"], ["accident", "death"])] },
  { key: "ivy-disability", account: ACCOUNT, member: IVY, product: "DisabilityCare", number: "DIS-9", type: "Permanent Disability", schedule: "", wording: [],
    coverages: [{ category: "Total Permanent Disability", amount: 200000, currency: "SGD" }],
    scheduleOnly: schedulePages("DisabilityCare", "Ivy Tan", "Schedule of Permanent Disablement (% of Sum Insured)", [
      ["Loss of arm at or above the elbow", "100% of Sum Insured"], ["Loss of hand at or above the wrist", "75% of Sum Insured"]]),
    benefits: [
      rowBenefit("Loss of arm at or above the elbow", "100% of Sum Insured", "sum_insured", 1, null, ["disability", "bodily_injury"]),
      rowBenefit("Loss of hand at or above the wrist", "75% of Sum Insured", "sum_insured", 0.75, null, ["disability", "bodily_injury"])] },
  { key: "ken-travel", account: ACCOUNT, member: KEN, product: "WanderSafe", number: "WAN-9", type: "Travel", schedule: "", wording: [],
    coverages: [{ category: "Travel", amount: 250000, currency: "USD" }],
    scheduleOnly: schedulePages("WanderSafe", "Ken Ho", "Schedule of Benefits - Travel", [
      ["Overseas medical expenses", "US$250,000"], ["Emergency medical evacuation", "USD 500,000"], ["Trip cancellation", "S$5,000"], ["Baggage delay", "S$200 for every 6 hours"]]),
    benefits: [
      rowBenefit("Overseas medical expenses", "US$250,000", "fixed", 250000, "USD", ["medical_expense", "travel_disruption"]),
      rowBenefit("Emergency medical evacuation", "USD 500,000", "fixed", 500000, "USD", ["medical_expense", "travel_disruption"]),
      rowBenefit("Trip cancellation", "S$5,000", "fixed", 5000, "SGD", ["trip_cancellation", "travel_disruption"]),
      rowBenefit("Baggage delay", "S$200 for every 6 hours", "fixed", 200, "SGD", ["delay", "travel_disruption"])] },
  { key: "hospital", account: ACCOUNT, member: CHARMAINE, product: "SafeCare Hospital Plan", number: "HSP-100", type: "Hospital Cash",
    schedule: "Ong Pei Lin Charmaine is the life assured under SafeCare Hospital Plan, policy HSP-100. Daily hospital cash S$150 per day.",
    wording: [
      { page: 1, text: "SafeCare Hospital Plan policy wording. Definitions of hospital, confinement and physician apply to this plan." },
      { page: 3, text: "SafeCare Hospital Plan hospital coverage: we pay a daily hospital cash benefit of S$150 for each day of hospital confinement, up to 90 days per admission." },
    ],
    coverages: [{ category: "Hospital Cash", amount: 150, currency: "SGD" }],
    benefits: [{ name: "Daily hospital cash", traits: ["hospitalisation"], kind: "daily", value: 150, currency: "SGD", factKey: "hospitalNights", maximumDays: 90, page: 3,
      quote: "we pay a daily hospital cash benefit of S$150 for each day of hospital confinement, up to 90 days per admission." }] },
  { key: "accident", account: ACCOUNT, member: CHARMAINE, product: "Guardian Personal Accident", number: "GPA-200", type: "Personal Accident",
    schedule: "Ong Pei Lin Charmaine is the insured person under Guardian Personal Accident, policy GPA-200. Sum Insured S$200,000.",
    wording: [
      { page: 2, text: "Guardian Personal Accident fracture benefit: we pay S$2,000 for a fracture of the arm, leg or hip caused by an Accident. Accidental medical expenses: we reimburse medical expenses due to an Accident up to S$3,000. Surgical benefit: we pay S$500 if surgery is performed for an Accident." },
      { page: 5, text: "Permanent disablement schedule. Loss of one arm at or above the elbow: 100% of Sum Insured. Loss of one hand at the wrist: 75% of Sum Insured." },
    ],
    coverages: [{ category: "Personal Accident", amount: 200000, currency: "SGD" }],
    benefits: [
      { name: "Fracture benefit", traits: ["accident", "bodily_injury"], requires: ["accident"], kind: "fixed", value: 2000, currency: "SGD", page: 2,
        quote: "we pay S$2,000 for a fracture of the arm, leg or hip caused by an Accident." },
      { name: "Accidental medical expenses", traits: ["accident", "bodily_injury", "medical_expense"], requires: ["accident"], kind: "expense_cap", value: 3000, currency: "SGD", factKey: "medicalBill", page: 2,
        quote: "we reimburse medical expenses due to an Accident up to S$3,000." },
      // A surgery row makes the ledger ask the yes/no "Was surgery performed?"
      // gate, which used to repeat forever after a Yes or a No.
      { name: "Surgical benefit", traits: ["accident", "bodily_injury"], requires: ["accident"], kind: "fixed", value: 500, currency: "SGD", page: 2,
        quote: "we pay S$500 if surgery is performed for an Accident." },
      { name: "Loss of one arm at or above the elbow", traits: ["accident", "bodily_injury", "disability"], requires: ["accident"], kind: "sum_insured", value: 1, currency: "SGD", page: 5,
        quote: "Loss of one arm at or above the elbow: 100% of Sum Insured." },
      { name: "Loss of one hand at the wrist", traits: ["accident", "bodily_injury", "disability"], requires: ["accident"], kind: "sum_insured", value: 0.75, currency: "SGD", page: 5,
        quote: "Loss of one hand at the wrist: 75% of Sum Insured." },
    ] },
  { key: "travel", account: ACCOUNT, member: MARCUS, product: "Voyager Travel Plan", number: "VTP-300", type: "Travel",
    schedule: "Marcus Lim Wei Jie is the insured person under Voyager Travel Plan, policy VTP-300.",
    wording: [
      { page: 1, text: "Voyager Travel Plan overseas cover: we reimburse overseas medical expenses incurred while travelling overseas up to US$200,000." },
      { page: 2, text: "Voyager Travel Plan trip cancellation: we reimburse non-refundable travel costs up to S$5,000 if the trip is cancelled." },
    ],
    coverages: [{ category: "Travel Medical", amount: 200000, currency: "USD" }, { category: "Trip Cancellation", amount: 5000, currency: "SGD" }],
    benefits: [
      { name: "Overseas medical expenses", traits: ["medical_expense", "travel_disruption"], kind: "expense_cap", value: 200000, currency: "USD", page: 1,
        quote: "we reimburse overseas medical expenses incurred while travelling overseas up to US$200,000." },
      { name: "Trip cancellation", traits: ["trip_cancellation", "travel_disruption"], kind: "expense_cap", value: 5000, currency: "SGD", page: 2,
        quote: "we reimburse non-refundable travel costs up to S$5,000 if the trip is cancelled." },
    ] },
  { key: "endowment", account: ACCOUNT, member: MARCUS, product: "SteadySave Endowment 20", number: "SSE-400", type: "Savings",
    schedule: "Marcus Lim Wei Jie is the life assured under SteadySave Endowment 20, policy SSE-400.",
    wording: [{ page: 1, text: "SteadySave Endowment 20. The guaranteed maturity value is S$50,000 payable at the end of the policy term." }],
    coverages: [{ category: "Savings", amount: 50000, currency: "SGD" }], benefits: [] },
  { key: "foreign", account: FOREIGN, member: FOREIGN_PERSON, product: "ForeignShield Travel", number: "FST-999", type: "Travel",
    schedule: "Other Household Person is the insured person under ForeignShield Travel, policy FST-999.",
    wording: [{ page: 1, text: "ForeignShield Travel overseas cover: we reimburse overseas medical expenses incurred while travelling overseas up to EUR 999,999." }],
    coverages: [{ category: "Travel Medical", amount: 999999, currency: "EUR" }],
    benefits: [{ name: "ForeignShield overseas medical", traits: ["medical_expense", "travel_disruption"], kind: "expense_cap", value: 999999, currency: "EUR", page: 1,
      quote: "we reimburse overseas medical expenses incurred while travelling overseas up to EUR 999,999." }] },
];

/* ---------------- visible text and leak scan ---------------- */
function visibleText(a: ChatAnswer): string {
  const x = a as ChatAnswer & Record<string, any>;
  const parts: string[] = [a.summary, ...a.details, ...a.nextSteps, a.disclaimer ?? ""];
  for (const q of a.questions ?? []) parts.push(q.text, q.why ?? "", ...(q.options ?? []));
  for (const i of a.claimItems ?? []) parts.push(i.title, i.reason, ...(i.conditions ?? []), i.amountText ?? "");
  for (const c of a.citations ?? []) parts.push(`${c.policyName} ${c.evidenceLabel ?? ""} Page ${c.pageStart}`);
  parts.push(...(a.knownFacts ?? []));
  for (const p of x.factFinding ?? []) parts.push(p.label ?? "", p.subjectName ?? "", ...(p.missingDocuments ?? []), ...(p.reviewerRequirements ?? []),
    ...(p.nextQuestions ?? []).map((q: any) => q.text + " " + (q.why ?? "")));
  for (const s of x.scenarioClassifications ?? []) parts.push(s.label, ...(s.traits ?? []).map((t: string) => t.replaceAll("_", " ")));
  for (const r of x.policyReview ?? []) parts.push(r.ownerName, r.policyName);
  if (x.reviewCoverage?.statement) parts.push(x.reviewCoverage.statement);
  for (const p of x.portfolioItems ?? []) parts.push(p.ownerName, p.policyName, ...(p.coverages ?? []).map((c: any) => `${c.productName ?? c.category} ${c.amount ?? ""} ${c.currency ?? ""}`));
  for (const l of x.policyStatedLimits ?? []) parts.push(l.amountText, l.benefitTitle, l.quote);
  for (const c of x.personCandidates ?? []) parts.push(c.label);
  return parts.filter(Boolean).join("\n");
}
const LEAKS: [string, RegExp][] = [
  ["uuid", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ["model id / provider", /\b(?:gpt-[\w.-]+|gemini[\w.-]*|claude-[\w.-]+|qwen[\w.-]*|ollama|openai|anthropic|dearpolicy-deterministic[\w.-]*|synthetic-e2e)\b/i],
  ["error text", /\b(?:Error:|TypeError|ReferenceError|stack|ECONNREFUSED|undefined|NaN|\[object Object\]|null\b)/],
  ["stack frame", /\bat \S+ \(.*:\d+:\d+\)|\.tsx?:\d+/],
  ["storage key / file", /\b[\w-]+\.pdf\b|storage_key|storageKey|bucket/i],
  ["rule/row count", /\b\d+\s+(?:benefit\s+)?(?:rules?|rows?|catalog(?:ue)?\s+entries)\b|\bcatalog(?:ue)?\b/i],
  ["raw fact key", /\b(?:fractureBodyPart|injuryKind|injuryBodyPart|eventType|hospitalNights|treatmentType|fractureConfirmed|eventLocation|accidentType|system-derived)\b/],
  ["env var", /\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\b/],
  ["job id", /\bjob[_ -]?id\b|\bchat_analysis\b|\bdead[_ ]letter\b|\blease\b/i],
  ["test marker", /DPTEST|SYNTHETIC-/],
];
const NO_POLICY = /no (?:active |current )?(?:travel |overseas )?(?:policy|policies|cover)\b[^.]*(?:on file|for|uploaded)|(?:don['’]t|do not|doesn['’]t|does not) (?:have|hold|own)[^.]*(?:travel|overseas|polic)|no longer (?:has|have|on file)/i;
const MONEY = /(?:S\$|US\$|\bSGD\s?|\bUSD\s?|\bEUR\s?|€|\$)\s?\d|\b\d[\d,]*(?:\.\d+)?\s?(?:SGD|USD|EUR|dollars?)\b/i;

/* ---------------- harness ---------------- */
type TurnResult = { turn: string; message: string; branch: string; ok: boolean; failures: string[]; visible: string; answer?: ChatAnswer };
const results: TurnResult[] = [];

async function main() {
  // A harness deadlock must fail loudly, never exit 0 on an empty event loop.
  const keepAlive = setInterval(() => undefined, 1000);
  const watchdog = setTimeout(() => { console.error("WATCHDOG: no completion in 160 s (harness or workflow hang)"); process.exit(3); }, 160_000);
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of ["sql/schema.sql", "sql/benefit-catalog.sql", "sql/model-usage.sql", "sql/coverage-ledger.sql", "sql/background-jobs.sql",
    "sql/household-rls.sql", "sql/lifecycle.sql", "sql/cover-conditions.sql", "sql/model-provenance.sql", "sql/chat-upgrade.sql"]) {
    try { await db.exec(await readFile(path.resolve(file), "utf8")); } catch (e) { console.log("SQL note: " + file + " not applied (" + (e as Error).message.slice(0, 100) + ")"); }
  }
  await db.exec("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;");
  // The pool must be patched before any lib module that captures it runs a query.
  const { pool } = await import("@/lib/db/client");
  let tail = Promise.resolve();
  const acquire = async () => { const previous = tail; let release!: () => void; tail = new Promise<void>((r) => { release = r; }); await previous; return release; };
  const execute = async (text: string, params: unknown[] = []) => {
    if (!params.length && text.includes(";")) { const rs = await db.exec(text); const r = rs.at(-1); return { rows: r?.rows ?? [], rowCount: r?.affectedRows ?? 0 }; }
    const r = await db.query(text, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  pool.query = (async (text: string, params: unknown[] = []) => { const release = await acquire(); try { return await execute(text, params); } finally { release(); } }) as typeof pool.query;
  pool.connect = (async () => { const release = await acquire(); return { query: execute, release }; }) as typeof pool.connect;
  const networkCalls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => { networkCalls.push(String(input)); throw new Error("network disabled in v1 chat contract"); }) as typeof fetch;

  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Household A'),($2,'Household B')", [ACCOUNT, FOREIGN]);
  await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [ACCOUNT]);
  await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [FOREIGN]);
  for (const [id, account, name, preferred, rel] of [[CHARMAINE, ACCOUNT, "Ong Pei Lin Charmaine", "Charmaine", "spouse"], [MARCUS, ACCOUNT, "Marcus Lim Wei Jie", "Marcus", "self"],
    [FOREIGN_PERSON, FOREIGN, "Other Household Person", "Charmaine", "self"], [IVY, ACCOUNT, "Ivy Tan Mei Ling", "Ivy", "spouse"], [KEN, ACCOUNT, "Ken Ho Wei", "Ken", "child"]] as const)
    await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,$3,$4,$5)", [id, account, name, preferred, rel]);

  const docIds: Record<string, { schedule: string; wording: string }> = {};
  let n = 100;
  for (const plan of PLANS) {
    const schedule = uuid(n++), wording = plan.scheduleOnly ? schedule : uuid(n++);
    docIds[plan.key] = { schedule, wording };
    const docs = plan.scheduleOnly ? [{ id: schedule, personal: true, pages: plan.scheduleOnly }]
      : [{ id: schedule, personal: true, pages: [{ page: 1, text: plan.schedule }] }, { id: wording, personal: false, pages: plan.wording }];
    for (const doc of docs) {
      await db.query("INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,effective_date,extracted_json,quarantine_status,file_hash) VALUES($1,$2,$3,'Example Insurer',$4,$5,$6,$7,$8,$9,'ready',$10,$11,'2024-01-01',$12::jsonb,'scan_clean','sha256:'||md5(random()::text||clock_timestamp()::text))",
        [doc.id, plan.account, plan.member, plan.product, plan.number, plan.type, doc.personal ? "personal_schedule" : "policy_wording", doc.personal, doc.personal ? 95 : 60,
          plan.key + (doc.personal ? "-schedule.pdf" : "-wording.pdf"), "households/" + plan.account + "/" + doc.id + ".pdf", JSON.stringify({ productsMentioned: [plan.product] })]);
      await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)", [doc.id, plan.member, plan.account]);
      for (const p of doc.pages) {
        await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [plan.account, doc.id, p.page, p.text]);
        await db.query("INSERT INTO policy_chunks(id,account_id,family_member_id,policy_id,page_start,page_end,text,embedding) VALUES($1,$2,$3,$4,$5,$5,$6,$7::vector)",
          [uuid(n++), plan.account, plan.member, doc.id, p.page, p.text, vec]);
      }
    }
    for (const c of plan.coverages)
      await db.query("INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,evidence_verified,confirmed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,true,true)",
        [uuid(n++), plan.account, schedule, plan.member, c.category, c.amount, c.currency, plan.product, plan.scheduleOnly ? plan.scheduleOnly[0].text : plan.schedule]);
    for (const b of plan.benefits)
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,requires,formula_kind,formula_value,currency,fact_key,maximum_days,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,$4,$5::text[],$6::text[],$7,$8,$9,$10,$11,$12,$13,'[]'::jsonb,'[]'::jsonb,false)",
        [plan.account, wording, plan.product, b.name, b.traits, b.requires ?? [], b.kind, b.value, b.currency, b.factKey ?? null, b.maximumDays ?? null, b.page, b.quote]);
  }
  // Every seeded document has been READ (rules, conditions, ledger): the
  // household state the certified journey starts from.
  await db.query("UPDATE policies SET benefits_indexed_at=now(), conditions_indexed_at=now(), ledger_read_at=now()");
  // Premium evidence so the active-status caveat is not the whole answer.
  for (const plan of PLANS.filter((p) => p.account === ACCOUNT))
    await db.query("INSERT INTO premium_records(account_id,policy_id,family_member_id,insurer,policy_number,amount,currency,payment_date) VALUES($1,$2,$3,'Example Insurer',$4,100,'SGD',current_date - 20)",
      [ACCOUNT, docIds[plan.key].schedule, plan.member, plan.number]).catch(() => undefined);

  const { POST } = await import("@/app/api/chat/route");
  const { GET: getJob } = await import("@/app/api/chat/jobs/[id]/route");
  const { GET: getSavedChat } = await import("@/app/api/chat/history/[id]/route");
  const { claimAndProcessOne } = await import("@/lib/jobs/worker-runtime");
  const { PRODUCTION_JOB_TYPES } = await import("@/lib/jobs/processors");
  const { getChatJob } = await import("@/lib/chat/jobs");

  const send = async (question: string, member: string, conv?: { id?: string; rev?: number }, asynchronous = false) => {
    const response = await POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ familyMemberId: member, scope: "member", question, conversationId: conv?.id, conversationRevision: conv?.rev, asynchronous, timeZone: "Asia/Singapore" }) }));
    const data = await response.json();
    if (asynchronous) {
      if (response.status !== 202) throw new Error("async chat returned " + response.status + " " + JSON.stringify(data).slice(0, 300));
      const config = PRODUCTION_JOB_TYPES.find((c) => c.jobType === "chat_analysis")!;
      const outcome = await claimAndProcessOne({ jobType: "chat_analysis", workerId: "v1-contract", process: config.process });
      const polled = await (await getJob(new NextRequest("http://localhost/api/chat/jobs/" + data.jobId), { params: Promise.resolve({ id: data.jobId }) })).json();
      if (polled.job?.status !== "complete") throw new Error("job did not complete (" + outcome + "): " + JSON.stringify(polled.job));
      return polled.result.answer as ChatAnswer;
    }
    if (response.status !== 200) throw new Error("chat returned " + response.status + " " + JSON.stringify(data).slice(0, 400));
    return data.answer as ChatAnswer;
  };

  const FOREIGN_TEXT = /ForeignShield|999,999|999999|EUR|Other Household Person|FST-999/;
  const checkCommon = (a: ChatAnswer, f: string[], opts: { claimContext?: boolean } = {}) => {
    const text = visibleText(a);
    for (const [label, re] of LEAKS) { const m = text.match(re); if (m) f.push(`internal leak (${label}): "${m[0]}"`); }
    if (FOREIGN_TEXT.test(text)) f.push("other-household data visible: " + text.match(FOREIGN_TEXT)![0]);
    if ((a.questions?.length ?? 0) > 1) f.push("asks " + a.questions.length + " questions at once");
    if ((a.potentialPayoutTotals?.length ?? 0) > 0) f.push("payout totals shown pre-review");
    if (a.claimItems?.some((i) => i.amountText || typeof (i as any).calculatedAmount === "number")) f.push("claim card carries an amount pre-review");
    if (opts.claimContext && MONEY.test([a.summary, ...a.details, ...a.nextSteps, ...a.claimItems.flatMap((i) => [i.title, i.reason, ...i.conditions])].join(" ")))
      f.push("money figure in claim-context prose: " + [a.summary, ...a.details].join(" ").match(MONEY)?.[0]);
    for (const c of a.citations ?? []) if (!(typeof c.pageStart === "number" && c.pageStart > 0) || !c.policyName) f.push("citation without page/document: " + JSON.stringify(c).slice(0, 120));
    const sources = (a.citations ?? []).map((c) => c.policyId + "|" + c.pageStart + "|" + c.pageEnd + "|" + (c.evidenceLabel ?? ""));
    if (new Set(sources).size !== sources.length) f.push("duplicate citations: " + (a.citations ?? []).map((c) => c.policyName + " p" + c.pageStart).join(", "));
    for (const d of a.details) if (d.length > 320 || /\bPage \d+ of \d+\b|SYNTHETIC TEST DOCUMENT/i.test(d)) f.push("raw page text in a detail: " + d.slice(0, 120));
    return text;
  };
  const docOf = (key: string) => [docIds[key].schedule, docIds[key].wording];
  const cites = (a: ChatAnswer, key: string, page?: number) => (a.citations ?? []).some((c) => docOf(key).includes(c.policyId) && (page == null || c.pageStart === page));
  const record = (turn: string, message: string, branch: string, a: ChatAnswer | undefined, f: string[], error?: unknown) => {
    if (error) f.push("turn threw: " + (error instanceof Error ? error.message : String(error)).slice(0, 300));
    results.push({ turn, message, branch, ok: !f.length, failures: f, visible: a ? visibleText(a) : "", answer: a });
    console.log(`\n=== ${turn} ${f.length ? "FAIL" : "PASS"} — ${message}  [${a?.mode ?? "-"}]`);
    if (a) console.log("  summary: " + a.summary.slice(0, 600) + "\n  details: " + JSON.stringify(a.details).slice(0, 700) +
      "\n  questions: " + JSON.stringify(a.questions.map((q) => [q.text, q.options])) + "\n  claimItems: " + JSON.stringify(a.claimItems.map((i) => [i.title, i.status, i.amountText ?? null])) +
      "\n  citations: " + JSON.stringify((a.citations ?? []).map((c) => c.policyName + " p" + c.pageStart)) + "\n  nextSteps: " + JSON.stringify(a.nextSteps).slice(0, 400) +
      ((a as any).portfolioItems ? "\n  portfolio: " + JSON.stringify((a as any).portfolioItems.map((p: any) => [p.ownerName, p.policyName, p.coverages.map((c: any) => c.amount + " " + c.currency)])) : "") +
      ((a as any).policyStatedLimits?.length ? "\n  limits: " + JSON.stringify((a as any).policyStatedLimits.map((l: any) => l.amountText + " p" + l.citation.pageStart)) : "") +
      "\n  knownFacts: " + JSON.stringify(a.knownFacts));
    for (const x of f) console.log("  ✗ " + x);
  };
  const turn = async (label: string, message: string, member: string, conv: { id?: string; rev?: number }, branch: string,
    check: (a: ChatAnswer, f: string[]) => void, asynchronous = false) => {
    const f: string[] = []; let a: ChatAnswer | undefined;
    try { a = await send(message, member, conv, asynchronous); check(a, f); conv.id = a.conversationId ?? conv.id; conv.rev = a.conversationRevision ?? conv.rev; }
    catch (e) { record(label, message, branch, a, f, e); return a; }
    record(label, message, branch, a, f); return a;
  };

  const c: { id?: string; rev?: number } = {};
  // 1 portfolio (through the async job path: enqueue -> worker -> poll)
  await turn("T1", "What policies does Charmaine have?", CHARMAINE, c, "portfolio", (a, f) => {
    checkCommon(a, f);
    const names = ((a as any).portfolioItems ?? []).map((p: any) => p.policyName).join(" | ");
    if (!/SafeCare Hospital Plan/.test(names) || !/Guardian Personal Accident/.test(names)) f.push("portfolio misses Charmaine's plans: " + names);
    if (/Voyager|SteadySave/.test(names)) f.push("portfolio for Charmaine lists Marcus's plans: " + names);
    if (!cites(a, "hospital") || !cites(a, "accident")) f.push("portfolio does not cite both of Charmaine's schedules");
  }, true);
  // 2 policy question: hospital coverage
  await turn("T2", "What is her hospital coverage?", CHARMAINE, c, "policy_question (reading path)", (a, f) => {
    checkCommon(a, f);
    if ((a as any).portfolioItems?.length) f.push("answered the previous portfolio question again instead of the hospital-coverage question");
    if (!cites(a, "hospital", 3)) f.push("does not cite SafeCare Hospital Plan wording page 3");
    if (!/hospital/i.test(a.summary + a.details.join(" "))) f.push("answer does not describe hospital cover");
    if (/Guardian|fracture/i.test(a.details.join(" "))) f.push("hospital answer quotes the accident policy");
  });
  // 3 policy question: fracture benefit exists?
  await turn("T3", "Does she have a fracture benefit?", CHARMAINE, c, "policy_question / what-if", (a, f) => {
    // V1.1 Task 2: a verified policy-fact answer states the printed figure (as S3,
    // the same question, already allows); a claim/fact-finding answer stays scrubbed.
    checkCommon(a, f, { claimContext: a.mode !== "answer" || a.claimItems.length > 0 || !a.verifiedPolicyFactsOnly });
    if ((a as any).portfolioItems?.length) f.push("answered the portfolio question again");
    if (!cites(a, "accident", 2)) f.push("does not cite Guardian Personal Accident wording page 2 (fracture benefit)");
    const text = visibleText(a);
    if (/loss of one (?:arm|hand)|permanent disablement/i.test(text)) f.push("fracture question surfaced the permanent-loss schedule");
    if (!/fractur/i.test(text)) f.push("answer does not mention the fracture benefit");
  });
  // 4 injury report
  let a4 = await turn("T4", "Charmaine broke her arm.", CHARMAINE, c, "claim -> injury fact-finding", (a, f) => {
    checkCommon(a, f, { claimContext: true });
    if (a.mode !== "fact_finding") f.push("mode " + a.mode + ", expected fact_finding");
    if (a.questions.length !== 1) f.push("expected exactly one question, got " + a.questions.length);
    else if (!/accident|illness/i.test(a.questions[0].text)) f.push("first question should ask accident vs illness: " + a.questions[0].text);
    if (a.claimItems.length) f.push("claim cards before facts: " + a.claimItems.map((i) => i.title).join(", "));
    if (/loss of (?:one )?arm|permanent/i.test(a.summary + a.details.join(" ")) && !/not the same as permanent loss/i.test(a.summary)) f.push("permanent-loss wording before cause is known");
  });
  // 5 cause
  let last = await turn("T5", "An accident.", CHARMAINE, c, "claim -> injury fact-finding (pending eventType)", (a, f) => {
    checkCommon(a, f, { claimContext: true });
    if (a.mode !== "fact_finding" || a.questions.length !== 1) f.push("expected one fact-finding question, got mode " + a.mode + " / " + a.questions.length);
    else if (!/where/i.test(a.questions[0].text)) f.push("expected the location question next: " + a.questions[0].text);
    if (!/not the same as permanent loss/i.test(a.summary)) f.push("does not separate fracture from permanent loss of a limb");
    if (/loss of one arm|loss of one hand/i.test(visibleText(a))) f.push("permanent-loss schedule row visible");
  });
  // 6 location, date, confirmation and treatment -- answered the way the UI sends them
  // A claim question is still open here (where did it happen?). An unrelated
  // question is answered in its own right, and the open question is offered
  // again rather than swallowed or dropped.
  last = (await turn("T5b", "What is her dental coverage?", CHARMAINE, c, "aside while a claim question is pending", (a, f) => {
    checkCommon(a, f, { claimContext: true });
    if (!/dental/i.test(a.summary)) f.push("the dental question was not answered: " + a.summary.slice(0, 160));
    // Missing from a complete read: "isn't stated"; from a partial read: "didn't find … read so far".
    if (!/(?:don['’]t|do not|doesn['’]t) mention|isn['’]t stated|not in your documents|didn['’]t find[^.]*read so far/i.test(a.summary)) f.push("does not say dental cover was not found in the documents");
    if (a.questions.length !== 1 || !/where/i.test(a.questions[0].text)) f.push("the open claim question was not offered again: " + JSON.stringify(a.questions.map((q) => q.text)));
    if (a.claimItems.length) f.push("claim cards on an aside");
  })) ?? last;
  const replies: Record<string, string> = { eventLocation: "Singapore", eventDate: "2026-09-18", fractureConfirmed: "Yes", treatmentType: "Admitted to hospital", hospitalNights: "2", injuryKind: "A broken bone", surgery: "No", outOfPocket: "Not sure" };
  const asked: string[] = []; let steps = 0;
  while (last && last.questions.length === 1 && steps < 8) {
    const q = last.questions[0]; const key = Object.keys(replies).find((k) => q.id.endsWith(k)) ?? "";
    const value = replies[key] ?? "Not sure";
    const message = q.options?.includes(value) ? value : q.text.replace(/\?\s*$/, "") + ": " + value;
    if (asked.filter((t) => t === q.text).length >= 2) break; // already proven stuck; stop the loop
    asked.push(q.text); steps++;
    last = await turn("T6." + steps, message, CHARMAINE, c, "claim -> injury fact-finding (" + (key || q.id) + ")", (a, f) => {
      checkCommon(a, f, { claimContext: true });
      if (a.questions.length === 1 && asked.includes(a.questions[0].text)) f.push("re-asked: " + a.questions[0].text);
      if (a.mode === "fact_finding" && a.claimItems.length) f.push("claim cards while still fact-finding");
    });
  }
  if (last?.questions.length) results.push({ turn: "T6.end", message: "(interview did not finish)", branch: "fact-finding", ok: false, failures: ["still asking after " + steps + " answers: " + last.questions[0].text], visible: "" });
  // 7 how much
  await turn("T7", "How much can she claim?", CHARMAINE, c, "claim -> catalogue assessment (preliminary)", (a, f) => {
    checkCommon(a, f, { claimContext: true });
    const titles = a.claimItems.map((i) => i.title).join(" | ");
    if (!/Fracture benefit/i.test(titles)) f.push("fracture benefit missing from assessment: " + titles);
    if (/Loss of one (?:arm|hand)/i.test(titles)) f.push("permanent-loss row offered for a broken arm: " + titles);
    if (/Surgical benefit/i.test(titles)) f.push("surgical benefit offered after 'No' to 'Was surgery performed?'");
    if (/Voyager|SteadySave/i.test(titles)) f.push("Marcus's plans in Charmaine's claim");
    if (!cites(a, "accident", 2)) f.push("does not cite the fracture wording page 2");
    if (a.questions.length > 1) f.push("more than one question");
    if (a.claimItems.length && a.assessmentKind !== "preliminary") f.push("assessmentKind " + a.assessmentKind + ", expected preliminary");
    if (a.nextSteps.some((x) => /:\s*\.?$/.test(x.trim()))) f.push("empty next step: " + a.nextSteps.find((x) => /:\s*\.?$/.test(x.trim())));
  });
  // 8 information absent from the documents
  const absent = (label: string, message: string, subject: RegExp) => turn(label, message, CHARMAINE, c, "policy_question (reading path, absent info)", (a, f) => {
    checkCommon(a, f);
    const text = [a.summary, ...a.details].join(" ");
    if (!/(?:not|n['’]t)\s+(?:find|found|stated|state|shown|printed|say|include|verify|mention)|no (?:\w+ )?(?:mention|information|clause|wording)|isn['’]t in|not in (?:the|your)/i.test(text))
      f.push("does not say the information is missing from the documents");
    if (!subject.test(text)) f.push("does not name what was asked (" + subject + ")");
    if (/\b\d+\s*(?:days?|months?)\b/i.test(text.replace(/up to 90 days per admission/gi, ""))) f.push("states a period that is not printed");
    if (/Voyager|SteadySave/i.test(text)) f.push("answers from Marcus's plans");
  });
  await absent("T8a", "What is the waiting period for her hospital plan?", /waiting period/i);
  await absent("T8b", "What is her dental coverage?", /dental/i);
  // 9 another family member
  const m: { id?: string; rev?: number } = {};
  await turn("T9", "What does Marcus's travel policy cover overseas?", MARCUS, m, "policy_question (reading path) for Marcus", (a, f) => {
    checkCommon(a, f);
    const text = visibleText(a);
    if (!cites(a, "travel", 1)) f.push("does not cite Voyager Travel Plan wording page 1");
    if (/SafeCare|Guardian|Charmaine/i.test(text)) f.push("Charmaine's data in Marcus's answer");
    if (a.mode !== "answer") f.push("a coverage question was handled as a claim (mode " + a.mode + ")");
    if (a.nextSteps.some((x) => /:\s*\.?$/.test(x.trim()))) f.push("empty next step");
    const sums = text.match(/(?:S\$|US\$)\s?[\d,]+/g) ?? [];
    if (/total|combined|altogether/i.test(text) && sums.length) f.push("currencies combined: " + sums.join(", "));
  });
  // Browser-shaped schedules: coverage questions answered from the stored
  // benefit rows first (one line and one citation per row, page 2), never
  // "not stated" while rows exist, and never a raw page dump.
  const iv: { id?: string; rev?: number } = {};
  await turn("S1", "What policies does Ivy have?", IVY, iv, "portfolio (browser-shaped)", (a, f) => {
    checkCommon(a, f);
    const names = ((a as any).portfolioItems ?? []).map((p: any) => p.policyName).join(" | ");
    if (!/HospitalShield/.test(names) || !/AccidentGuard/.test(names)) f.push("portfolio misses Ivy's plans: " + names);
  });
  await turn("S2", "What is her hospital coverage?", IVY, iv, "policy_question -> stored benefits", (a, f) => {
    checkCommon(a, f);
    const text = [a.summary, ...a.details].join(" ");
    if (/don['’]t mention|doesn['’]t mention|isn['’]t stated|didn['’]t find/i.test(text)) f.push("said hospital cover is missing although HospitalShield page 2 lists it");
    for (const row of ["Daily room and board", "Intensive care unit", "Surgical fees", "Pre-hospitalisation treatment"])
      if (!a.details.some((d) => d.includes(row) && /HospitalShield/.test(d) && /page 2/.test(d))) f.push("missing line: " + row);
    if (!cites(a, "ivy-hospital", 2)) f.push("no HospitalShield page 2 citation");
    if (/Fracture|AccidentGuard|Loss of/i.test(text)) f.push("hospital answer lists other policies' rows");
    const limits = (a as any).policyStatedLimits ?? [];
    if (!limits.some((l: any) => l.benefitTitle === "Surgical fees" && l.currency === "SGD" && l.amount === 25000)) f.push("no policy-stated limit for Surgical fees: " + JSON.stringify(limits.map((l: any) => l.amountText)));
  });
  await turn("S3", "Does she have a fracture benefit?", IVY, iv, "policy_question -> stored benefits", (a, f) => {
    checkCommon(a, f);
    if (!a.details.some((d) => /Fracture of arm/.test(d) && /AccidentGuard/.test(d) && /page 2/.test(d))) f.push("no 'Fracture of arm' line from AccidentGuard page 2: " + JSON.stringify(a.details));
    if (!cites(a, "ivy-accident", 2)) f.push("no AccidentGuard page 2 citation");
    if (/Loss of (?:arm|hand)|HospitalShield/i.test(a.details.join(" "))) f.push("fracture answer lists permanent-loss or hospital rows");
    if (/isn['’]t stated|don['’]t mention/i.test(a.summary)) f.push("said fracture cover is missing");
  });
  await turn("S4", "What is her dental coverage?", IVY, iv, "policy_question -> nothing stored -> reading path", (a, f) => {
    checkCommon(a, f);
    const complete = !!(a as any).reviewCoverage?.complete;
    if (!/dental cover/i.test(a.summary)) f.push("does not name dental cover: " + a.summary.slice(0, 160));
    if (/her dental/i.test(a.summary)) f.push("quotes the user's pronoun back");
    if (complete && !/isn['’]t stated in your documents/i.test(a.summary)) f.push("complete review but does not say it isn't stated");
    if (!complete && (/isn['’]t stated|not stated/i.test(a.summary) || !/read so far/i.test(a.summary))) f.push("partial review asserted absence or did not say 'read so far': " + a.summary.slice(0, 200));
  });
  const kn: { id?: string; rev?: number } = {};
  await turn("S5", "What does Ken's travel policy cover overseas?", KEN, kn, "policy_question -> stored benefits (currencies)", (a, f) => {
    checkCommon(a, f);
    for (const row of ["Overseas medical expenses", "Emergency medical evacuation"])
      if (!a.details.some((d) => d.includes(row) && /WanderSafe/.test(d) && /page 2/.test(d))) f.push("missing line: " + row);
    const limits = (a as any).policyStatedLimits ?? [];
    const med = limits.find((l: any) => l.benefitTitle === "Overseas medical expenses"), evac = limits.find((l: any) => l.benefitTitle === "Emergency medical evacuation");
    if (!med || med.currency !== "USD" || med.amount !== 250000) f.push("overseas medical limit not US$250,000: " + JSON.stringify(med));
    if (!evac || evac.currency !== "USD" || evac.amount !== 500000) f.push("evacuation limit not USD 500,000: " + JSON.stringify(evac));
    for (const l of limits) if (l.currency === "SGD" && /US\$|USD/.test(l.quote)) f.push("USD row relabelled SGD: " + l.benefitTitle);
    if ((a.potentialPayoutTotals?.length ?? 0) > 0 || /total|combined|altogether/i.test([a.summary, ...a.details].join(" "))) f.push("amounts summed");
    if (/SYNTHETIC|Schedule of Benefits - Travel Overseas/i.test(visibleText(a))) f.push("raw page dump visible");
  });
  // Phrasing controls: the synthetic-e2e interpreter labels a question
  // "policy_question" only for fixed phrases ("what is the ..."), labels
  // anything with "travel" a travel claim, and turns every unmatched message
  // into a follow-up. These variants reach the policy-question path directly,
  // separating what the ANSWER path does from what the stand-in classifier did.
  const v: { id?: string; rev?: number } = {};
  await turn("T2b", "What is the hospital coverage in her SafeCare plan?", CHARMAINE, v, "policy_question (reading path, control phrasing)", (a, f) => {
    checkCommon(a, f);
    if (!cites(a, "hospital", 3)) f.push("does not cite SafeCare Hospital Plan wording page 3");
    if (/If that happened|This is a what-if/i.test(a.summary + a.details.join(" "))) f.push("coverage question answered as a hypothetical event (what-if framing)");
    if (a.questions.some((q) => /admitted|nights|you /i.test(q.text))) f.push("asks a claim fact for a coverage question: " + a.questions.map((q) => q.text).join(" / "));
    if (/Guardian|fracture/i.test(a.details.join(" "))) f.push("hospital answer quotes the accident policy");
  });
  const v3: { id?: string; rev?: number } = {};
  await turn("T3b", "What is the fracture benefit in her Guardian accident policy?", CHARMAINE, v3, "policy_question (reading path, control phrasing)", (a, f) => {
    checkCommon(a, f);
    if (!cites(a, "accident", 2)) f.push("does not cite Guardian Personal Accident wording page 2");
    if (/loss of one (?:arm|hand)/i.test(visibleText(a))) f.push("fracture question surfaced the permanent-loss schedule");
    if (!/fractur/i.test(a.details.join(" "))) f.push("answer does not quote the fracture benefit");
  });
  const v9: { id?: string; rev?: number } = {};
  await turn("T9b", "What is the overseas medical cover in Marcus's Voyager plan?", MARCUS, v9, "policy_question (reading path, control phrasing)", (a, f) => {
    checkCommon(a, f);
    if (!cites(a, "travel", 1)) f.push("does not cite Voyager Travel Plan wording page 1");
    if (/If that happened|This is a what-if/i.test(a.summary + a.details.join(" "))) f.push("coverage question answered as a hypothetical event (what-if framing)");
    if (/SafeCare|Guardian|Charmaine/i.test(visibleText(a))) f.push("Charmaine's data in Marcus's answer");
  });
  // 10 delete the travel policy (both documents, the real deletion route) and ask again
  // The deletion coordinator (lib/lifecycle/coordinator.ts) mixes a held
  // transaction client with pool queries, which deadlocks this harness's
  // single-connection mutex (the process then exits silently). Its own suites
  // (policy-deletion-regressions.ts) prove it; here the END STATE it produces
  // -- lifecycle_state 'soft_deleted' on both documents -- is applied directly.
  await db.query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=ANY($1::uuid[])", [docOf("travel")]);
  console.log("\nT10 deletion: both Voyager documents set to lifecycle_state='soft_deleted' (coordinator end state)");
  const afterDeletion = (a: ChatAnswer, f: string[]) => {
    checkCommon(a, f);
    const text = visibleText(a);
    if (cites(a, "travel")) f.push("deleted travel policy still cited");
    if (/Voyager|200,000|5,000/i.test(text)) f.push("deleted travel policy still supports the answer: " + text.match(/Voyager|200,000|5,000/i)![0]);
  };
  await turn("T10c", "What is the overseas medical cover in Marcus's Voyager plan?", MARCUS, v9, "policy_question after deletion (control phrasing)", (a, f) => {
    afterDeletion(a, f);
    if (!NO_POLICY.test(a.summary)) f.push("does not say there is no such policy on file");
  });
  await turn("T10", "What does Marcus's travel policy cover overseas?", MARCUS, m, "policy_question after deletion", (a, f) => {
    checkCommon(a, f);
    const text = visibleText(a);
    if (cites(a, "travel")) f.push("deleted travel policy still cited");
    if (/Voyager|200,000|5,000/i.test(text)) f.push("deleted travel policy still supports the answer: " + text.match(/Voyager|200,000|5,000/i)![0]);
    if (!NO_POLICY.test(a.summary)) f.push("does not say there is no travel policy on file");
  });
  // Saved turn-9 answer, reopened: must be marked out of date, never re-served as cover.
  {
    const f: string[] = [];
    const saved = await (await getSavedChat(new NextRequest("http://localhost/api/chat/history/" + m.id), { params: Promise.resolve({ id: m.id! }) })).json();
    const answers = (saved.messages ?? []).filter((x: any) => x.answer_json).map((x: any) => x.answer_json as ChatAnswer);
    const t9 = answers[0];
    if (!t9) f.push("no saved answers returned");
    else if (!(t9 as any).invalidated && cites(t9, "travel")) f.push("reopened turn-9 answer still cites the deleted policy as current");
    results.push({ turn: "T10b", message: "(reopen Marcus chat after deletion)", branch: "history + stale-answers", ok: !f.length, failures: f, visible: t9 ? t9.summary : "" });
    console.log("\n=== T10b " + (f.length ? "FAIL" : "PASS") + " reopened turn-9 summary: " + (t9?.summary ?? "").slice(0, 200)); for (const x of f) console.log("  ✗ " + x);
  }
  // Stuck-job healing: a chat job whose background job was dead-lettered reads back as a normal failure.
  {
    const f: string[] = [];
    const jobId = uuid(990001);
    await db.query("INSERT INTO chat_analysis_jobs(id,account_id,family_member_id,conversation_id,request_json,status) VALUES($1,$2,$3,$4,'{}'::jsonb,'running')", [jobId, ACCOUNT, CHARMAINE, c.id]);
    await db.query("INSERT INTO background_jobs(job_type,idempotency_key,account_id,payload,status,attempt_count,max_attempts) VALUES('chat_analysis',$1,$2,'{}'::jsonb,'dead_letter',3,3)", [jobId, ACCOUNT]).catch((e) => f.push("seed bg job: " + e.message));
    const healed = await getChatJob(ACCOUNT, jobId);
    if (healed?.status !== "failed") f.push("dead-lettered chat job still reads as " + healed?.status);
    for (const [label, re] of LEAKS) if (re.test(healed?.error ?? "")) f.push("heal message leaks " + label);
    // Orphan: the chat row exists but no background job was ever enqueued.
    const orphan = uuid(990002);
    await db.query("INSERT INTO chat_analysis_jobs(id,account_id,family_member_id,conversation_id,request_json,status,updated_at) VALUES($1,$2,$3,$4,'{}'::jsonb,'queued',now()-interval '2 hours')", [orphan, ACCOUNT, CHARMAINE, c.id]);
    const o = await getChatJob(ACCOUNT, orphan);
    if (o?.status === "queued" || o?.status === "running") f.push("orphan chat job with no background job and 2h old still reads '" + o.status + "' (client spinner never ends)");
    // A slow turn whose background job is still processing is never cut off.
    const live = uuid(990003);
    await db.query("INSERT INTO chat_analysis_jobs(id,account_id,family_member_id,conversation_id,request_json,status,updated_at) VALUES($1,$2,$3,$4,'{}'::jsonb,'running',now()-interval '20 minutes')", [live, ACCOUNT, CHARMAINE, c.id]);
    await db.query("INSERT INTO background_jobs(job_type,idempotency_key,account_id,payload,status,attempt_count,max_attempts) VALUES('chat_analysis',$1,$2,'{}'::jsonb,'processing',1,3)", [live, ACCOUNT]).catch((e) => f.push("seed live bg job: " + e.message));
    const l = await getChatJob(ACCOUNT, live);
    if (l?.status !== "running") f.push("a chat job whose background job is still processing was healed to " + l?.status);
    // A fresh queued row (just enqueued) is never healed either.
    const fresh = uuid(990004);
    await db.query("INSERT INTO chat_analysis_jobs(id,account_id,family_member_id,conversation_id,request_json,status) VALUES($1,$2,$3,$4,'{}'::jsonb,'queued')", [fresh, ACCOUNT, CHARMAINE, c.id]);
    if ((await getChatJob(ACCOUNT, fresh))?.status !== "queued") f.push("a just-enqueued chat job was healed");
    results.push({ turn: "JOBS", message: "(dead-letter + orphan heal)", branch: "lib/chat/jobs.ts getChatJob", ok: !f.length, failures: f, visible: healed?.error ?? "" });
    console.log("\n=== JOBS " + (f.length ? "FAIL" : "PASS") + " heal: " + healed?.status + " / " + (healed?.error ?? "")); for (const x of f) console.log("  ✗ " + x);
  }
  if (networkCalls.length) console.log("\nNetwork attempts (all refused): " + [...new Set(networkCalls)].slice(0, 5).join(", "));

  console.log("\n=== SUMMARY ===");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.turn.padEnd(6)} ${r.branch} :: ${r.message}${r.ok ? "" : "\n        - " + r.failures.join("\n        - ")}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} turns pass`);
  await db.close();
  clearInterval(keepAlive); clearTimeout(watchdog);
  process.exitCode = failed ? 1 : 0;
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(2); });
