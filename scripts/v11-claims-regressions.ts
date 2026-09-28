/**
 * V1.1 claim conversations, end to end through the FINAL response (Task 3,
 * claim parts of Tasks 0 and 4).
 *
 * The real chat route (app/api/chat/route.ts -> lib/chat/workflow.ts) runs
 * against PGlite with the deterministic model stand-in the local browser
 * stack uses; every other network call throws. For each claim category --
 * injury (arm fracture), death, accidental death, critical illness,
 * disability, hospitalisation, medical reimbursement and travel -- the
 * household reports the event and then answers every question the chat asks,
 * the way the chat's own question card sends answers, until the chat asks
 * nothing more. Every turn and the final response are checked:
 *
 *  - at most ONE question per turn, never the same question twice;
 *  - no amount anywhere before evidence gates pass (policy-stated limits
 *    only), no payout totals, no promise of payment;
 *  - the final response names the possible benefits with their page, says
 *    what decides them (the applicable definition, for categories that have
 *    one) and what to send next -- and none of the old noise (scenario
 *    classifications, rule notes, "Coverage page" pointers, ruled-out rows,
 *    permanent-loss rows for a fracture);
 *  - ONE claim event per conversation, named after the event -- never after
 *    the last message ("An accident.") -- and its list status, detail status
 *    and requested documents come from claimDisplayStatus and agree;
 *  - no model call just to restate a deterministic question.
 *
 * Live-defect fixtures (Task 0) are reproduced first: the claims list said
 * "Assessment ready" while the detail said "No estimate yet"; a fracture
 * claim's list action described death documents.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { NextRequest } from "next/server";
import type { ChatAnswer } from "@/types";

process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
process.env.E2E_RUN_ID = "v11claims";
process.env.DEV_AUTH_ENABLED = "1";
process.env.MODEL_PRESET = process.env.MODEL_PRESET || "openai";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-not-used";
delete process.env.PINECONE_API_KEY;
const ACCOUNT = "00000000-0000-0000-0000-00000000c001";
process.env.DEV_ACCOUNT_ID = ACCOUNT;
const uuid = (n: number) => "30000000-0000-4000-8000-" + String(n).padStart(12, "0");
const CHARMAINE = uuid(1), MARCUS = uuid(2), DESMOND = uuid(3), IVY = uuid(4);
const vec = "[" + Array.from({ length: 1024 }, (_, j) => (j === 0 ? 1 : 0)).join(",") + "]";

type Row = { name: string; printed: string; kind: string; value: number | null; currency: string | null; traits: string[]; requires?: string[]; factKey?: string | null };
type Plan = { key: string; member: string; product: string; type: string; category: string; sum: { amount: number; currency: string } | null; heading: string; rows: Row[];
  /** The printed renewal/expiry date; with no premium evidence after it, the policy has expired. */
  expiry?: string };
const r = (name: string, printed: string, kind: string, value: number | null, currency: string | null, traits: string[], requires: string[] = [], factKey: string | null = null): Row =>
  ({ name, printed, kind, value, currency, traits, requires, factKey });
const PLANS: Plan[] = [
  { key: "hospital", member: CHARMAINE, product: "HospitalShield", type: "Hospitalisation", category: "Hospitalisation", sum: { amount: 1000000, currency: "SGD" },
    heading: "Schedule of Benefits - Hospital and Surgical", rows: [
      r("Daily room and board (1-bed private ward)", "S$800 per day, maximum 120 days", "daily", 800, "SGD", ["hospitalisation"], [], "hospitalNights"),
      r("Surgical fees", "Up to S$25,000 per surgery", "expense_cap", 25000, "SGD", ["hospitalisation", "medical_expense"]),
      r("Hospital cash", "S$100 per day of confinement", "daily", 100, "SGD", ["hospitalisation"], [], "hospitalNights")] },
  { key: "accident", member: CHARMAINE, product: "AccidentGuard", type: "Personal Accident", category: "Personal Accident", sum: { amount: 100000, currency: "SGD" },
    heading: "Schedule of Benefits - Accident", rows: [
      r("Fracture of arm", "S$1,000", "fixed", 1000, "SGD", ["accident", "bodily_injury"], ["accident"]),
      r("Fracture of leg", "S$1,500", "fixed", 1500, "SGD", ["accident", "bodily_injury"], ["accident"]),
      r("Accident medical reimbursement", "Up to S$2,000 per accident", "expense_cap", 2000, "SGD", ["accident", "medical_expense"], ["accident"])] },
  { key: "disability", member: CHARMAINE, product: "DisabilityCare", type: "Permanent Disability", category: "Total Permanent Disability", sum: { amount: 200000, currency: "SGD" },
    heading: "Schedule of Permanent Disablement (% of Sum Insured)", rows: [
      r("Total and permanent disability", "100% of Sum Insured", "sum_insured", 1, null, ["disability"]),
      r("Loss of arm at or above the elbow", "100% of Sum Insured", "sum_insured", 1, null, ["disability", "bodily_injury"])] },
  { key: "ci", member: CHARMAINE, product: "CareShield CI", type: "Critical Illness", category: "Critical Illness", sum: { amount: 200000, currency: "SGD" },
    heading: "Schedule of Benefits - Critical Illness", rows: [
      r("Major cancer", "100% of Sum Insured", "sum_insured", 1, null, ["illness", "diagnosis"])] },
  { key: "life", member: DESMOND, product: "LifeSecure Term", type: "Term Life", category: "Death", sum: { amount: 500000, currency: "SGD" },
    heading: "Schedule of Benefits - Life", rows: [r("Death benefit", "100% of Sum Insured", "sum_insured", 1, null, ["death"], ["death"])] },
  { key: "pa-desmond", member: DESMOND, product: "SafeRoad PA", type: "Personal Accident", category: "Personal Accident", sum: { amount: 300000, currency: "SGD" },
    heading: "Schedule of Benefits - Accident", rows: [r("Accidental death", "100% of Sum Insured", "sum_insured", 1, null, ["death", "accident"], ["accident", "death"])] },
  { key: "travel", member: MARCUS, product: "WanderSafe", type: "Travel", category: "Travel", sum: null,
    heading: "Schedule of Benefits - Travel", rows: [
      r("Overseas medical expenses", "US$250,000", "fixed", 250000, "USD", ["medical_expense", "travel_disruption"]),
      r("Flight delay", "S$100 for every 6 hours of delay", "fixed", 100, "SGD", ["delay", "travel_disruption"], [], "flightDelayHours")] },
  // V1.1 eval Q14: an EXPIRED travel policy (no renewal since 2024-12-31) and a
  // current one, both with overseas accident medical cover that the ledger
  // matches to any accident -- the event date and place must rule them out.
  { key: "travel-expired", member: CHARMAINE, product: "JetSure", type: "Travel", category: "Travel", sum: null, expiry: "2024-12-31",
    heading: "Schedule of Benefits - Travel", rows: [
      r("Overseas accident medical expenses", "S$100,000", "expense_cap", 100000, "SGD", ["accident", "medical_expense", "bodily_injury"], ["accident"])] },
  { key: "travel-current", member: CHARMAINE, product: "TripCare", type: "Travel", category: "Travel", sum: null,
    heading: "Schedule of Benefits - Travel", rows: [
      r("Overseas accident medical expenses", "S$150,000", "expense_cap", 150000, "SGD", ["accident", "medical_expense", "bodily_injury"], ["accident"]),
      r("Emergency medical evacuation", "S$500,000", "expense_cap", 500000, "SGD", ["accident", "bodily_injury", "medical_expense"])] },
];

function visibleText(a: ChatAnswer): string {
  const x = a as ChatAnswer & Record<string, any>;
  const parts: string[] = [a.summary, ...a.details, ...a.nextSteps];
  for (const q of a.questions ?? []) parts.push(q.text, q.why ?? "", ...(q.options ?? []));
  for (const i of a.claimItems ?? []) parts.push(i.title, i.reason, ...(i.conditions ?? []), i.amountText ?? "");
  for (const s of x.scenarioClassifications ?? []) parts.push(s.label);
  return parts.filter(Boolean).join("\n");
}
const MONEY = /(?:S\$|US\$|\bSGD\s?|\bUSD\s?|\$)\s?\d|\b\d[\d,]*(?:\.\d+)?\s?(?:SGD|USD|dollars?)\b/i;
const PROMISE = /\b(?:you will (?:get|receive)|will be paid|guaranteed|approved|entitled to|definitely)\b/i;
const NOISE = /Coverage page|Benefits page shows|ruled out|not applicable here|rests on an assumption|second read|what DearPolicy is checking against|table heading|re-?read|re-?index/i;
type Result = { name: string; ok: boolean; failures: string[]; transcript: string[] };
const results: Result[] = [];
/** Wall time of every fact-finding turn (a question asked), for the p95 report. */
const factFindingMs: number[] = [];

async function main() {
  const keepAlive = setInterval(() => undefined, 1000);
  const watchdog = setTimeout(() => { console.error("WATCHDOG: no completion in 165 s"); process.exit(3); }, 165_000);
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of ["sql/schema.sql", "sql/benefit-catalog.sql", "sql/model-usage.sql", "sql/coverage-ledger.sql", "sql/background-jobs.sql",
    "sql/household-rls.sql", "sql/lifecycle.sql", "sql/cover-conditions.sql", "sql/model-provenance.sql", "sql/claim-evidence.sql", "sql/claim-composition.sql", "sql/chat-upgrade.sql"]) {
    try { await db.exec(await readFile(path.resolve(file), "utf8")); } catch (e) { console.log("SQL note: " + file + " not applied (" + (e as Error).message.slice(0, 90) + ")"); }
  }
  await db.exec("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;");
  const { pool } = await import("@/lib/db/client");
  let tail = Promise.resolve();
  const acquire = async () => { const previous = tail; let release!: () => void; tail = new Promise<void>((res) => { release = res; }); await previous; return release; };
  const execute = async (text: string, params: unknown[] = []) => {
    if (!params.length && text.includes(";")) { const rs = await db.exec(text); const last = rs.at(-1); return { rows: last?.rows ?? [], rowCount: last?.affectedRows ?? 0 }; }
    const res = await db.query(text, params); return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
  };
  pool.query = (async (text: string, params: unknown[] = []) => { const release = await acquire(); try { return await execute(text, params); } finally { release(); } }) as typeof pool.query;
  pool.connect = (async () => { const release = await acquire(); return { query: execute, release }; }) as typeof pool.connect;
  globalThis.fetch = (async (input: RequestInfo | URL) => { throw new Error("network disabled: " + String(input)); }) as typeof fetch;

  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Claims household')", [ACCOUNT]);
  await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [ACCOUNT]);
  for (const [id, name, preferred, rel] of [[CHARMAINE, "Ong Pei Lin Charmaine", "Charmaine", "spouse"], [MARCUS, "Marcus Lim Wei Jie", "Marcus", "self"],
    [DESMOND, "Tan Yi Chuen Desmond", "Desmond", "parent"], [IVY, "Ivy Tan Mei Ling", "Ivy", "child"]] as const)
    await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,$3,$4,$5)", [id, ACCOUNT, name, preferred, rel]);
  const docOf: Record<string, string> = {};
  let n = 100;
  for (const plan of PLANS) {
    const id = uuid(n++); docOf[plan.key] = id;
    const person = plan.member === CHARMAINE ? "Ong Pei Lin Charmaine" : plan.member === DESMOND ? "Tan Yi Chuen Desmond" : "Marcus Lim Wei Jie";
    const pages = [
      plan.product + " Policy Schedule Insured: " + person + " Policy number " + plan.key.toUpperCase() + "-1 Effective date 2024-01-01" + (plan.sum ? " Sum Insured S$" + plan.sum.amount.toLocaleString("en-US") : ""),
      plan.heading + " " + plan.rows.map((x) => x.name + " " + x.printed).join(" ") + " Page 2 of 2",
    ];
    await db.query("INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,effective_date,extracted_json,quarantine_status,renewal_or_expiry_date) VALUES($1,$2,$3,'Example Insurer',$4,$5,$6,'personal_schedule',true,95,'ready',$7,$7,'2024-01-01',$8::jsonb,'scan_clean',$9)",
      [id, ACCOUNT, plan.member, plan.product, plan.key.toUpperCase() + "-1", plan.type, plan.key + ".pdf", JSON.stringify({ productsMentioned: [plan.product] }), plan.expiry ?? null]);
    await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)", [id, plan.member, ACCOUNT]);
    for (const [i, text] of pages.entries()) {
      await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [ACCOUNT, id, i + 1, text]);
      await db.query("INSERT INTO policy_chunks(id,account_id,family_member_id,policy_id,page_start,page_end,text,embedding) VALUES($1,$2,$3,$4,$5,$5,$6,$7::vector)", [uuid(n++), ACCOUNT, plan.member, id, i + 1, text, vec]);
    }
    if (plan.sum) await db.query("INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,evidence_verified,confirmed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,true,true)",
      [uuid(n++), ACCOUNT, id, plan.member, plan.category, plan.sum.amount, plan.sum.currency, plan.product, pages[0]]);
    else await db.query("INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,evidence_verified,confirmed) VALUES($1,$2,$3,$4,$5,NULL,NULL,$6,1,$7,true,true)",
      [uuid(n++), ACCOUNT, id, plan.member, plan.category, plan.product, pages[0]]);
    for (const row of plan.rows)
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,requires,formula_kind,formula_value,currency,fact_key,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,$4,$5::text[],$6::text[],$7,$8,$9,$10,2,$11,'[]'::jsonb,'[]'::jsonb,false)",
        [ACCOUNT, id, plan.product, row.name, row.traits, row.requires ?? [], row.kind, row.value, row.currency, row.factKey ?? null, row.name + " " + row.printed]);
  }
  await db.query("UPDATE policies SET benefits_indexed_at=now(), conditions_indexed_at=now(), ledger_read_at=now()");
  for (const plan of PLANS.filter((p) => !p.expiry)) await db.query("INSERT INTO premium_records(account_id,policy_id,family_member_id,insurer,policy_number,amount,currency,payment_date) VALUES($1,$2,$3,'Example Insurer',$4,100,'SGD',current_date - 20)",
    [ACCOUNT, docOf[plan.key], plan.member, plan.key.toUpperCase() + "-1"]).catch(() => undefined);

  const { POST } = await import("@/app/api/chat/route");
  const { GET: listClaims } = await import("@/app/api/claims/route");
  const { GET: getClaim } = await import("@/app/api/claims/[id]/route");
  const { claimDisplayStatus } = await import("@/lib/claims/status");
  // Model calls, by operation, as recorded by the real telemetry boundary.
  const { setTelemetryAdapter } = await import("@/lib/telemetry");
  const modelCalls: string[] = [];
  setTelemetryAdapter({ name: "v11-claims-capture", async send(events) { for (const e of events) if (e.name === "ai.structured_completion.completed") modelCalls.push(String((e.extra as any)?.operation ?? "?")); } });

  const send = async (question: string, member: string, conv: { id?: string; rev?: number }) => {
    const started = Date.now();
    const response = await POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ familyMemberId: member, scope: "member", question, conversationId: conv.id, conversationRevision: conv.rev, asynchronous: false, timeZone: "Asia/Singapore" }) }));
    const data = await response.json();
    if (response.status !== 200) throw new Error("chat " + response.status + " " + JSON.stringify(data).slice(0, 300));
    const answer = data.answer as ChatAnswer;
    conv.id = answer.conversationId ?? conv.id; conv.rev = answer.conversationRevision ?? conv.rev;
    return { answer, ms: Date.now() - started };
  };

  /** Reports the event, then answers each question as the chat's own
   * question card does, until nothing is asked. Returns the transcript. */
  async function conversation(name: string, member: string, opening: string, replies: Record<string, string>, expect: {
    benefits: RegExp[]; forbiddenBenefits?: RegExp[]; definition?: RegExp; documents: RegExp[]; forbiddenDocuments?: RegExp[]; eventName: RegExp; maxQuestions?: number;
    firstQuestion?: RegExp;
    /** Asked again after the final response: must update the SAME claim event. */
    repeat?: string;
    /** Asked after the final response, in order (eval Q15, Q16): a claim-money question stays in the claim flow. */
    followUps?: { ask: string; claimMoney?: boolean }[];
    /** Sent after the final response (a late reply to an interview question): the event keeps its name. */
    lateReplies?: string[];
    /** Cards that may stay but must be labelled and never offered as a possible benefit. */
    labelledNotOffered?: RegExp;
  }) {
    const f: string[] = [], transcript: string[] = [];
    const conv: { id?: string; rev?: number } = {};
    const asked: string[] = [];
    let last: ChatAnswer | undefined, message = opening, slow = 0;
    try {
      for (let turn = 0; turn < 14; turn++) {
        const before = modelCalls.length;
        const { answer, ms } = await send(message, member, conv);
        await new Promise((res) => setTimeout(res, 20));
        const called = modelCalls.slice(before);
        // A reply to the chat's own question is recorded by code; asking the
        // next deterministic question must not pay for a model call.
        // Never a paid narration of a deterministic question; and a bare reply
        // (a tapped option, a date, a number) needs no interpretation call.
        const bare = message.slice(message.lastIndexOf(":") + 1).trim();
        if (turn > 0 && answer.mode === "fact_finding" && called.includes("chat_reply")) f.push(`turn ${turn}: a narration call for a deterministic question`);
        if (turn > 0 && answer.mode === "fact_finding" && bare.length <= 40 && !/[,;?]|\band\b/i.test(bare) && called.length) f.push(`turn ${turn}: ${called.length} model call(s) (${called.join(", ")}) for the bare reply "${bare}"`);
        last = answer;
        if (ms > 12_000) slow++;
        if (answer.mode === "fact_finding") factFindingMs.push(ms);
        transcript.push("> " + message, "< [" + answer.mode + "] " + answer.summary.slice(0, 260) + (answer.questions[0] ? "  ? " + answer.questions[0].text : ""));
        const text = visibleText(answer);
        if (answer.questions.length > 1) f.push(`turn ${turn}: ${answer.questions.length} questions at once`);
        if (answer.claimItems.some((i) => i.amountText || typeof (i as any).calculatedAmount === "number")) f.push(`turn ${turn}: a card shows an amount before evidence review`);
        if ((answer.potentialPayoutTotals?.length ?? 0) > 0) f.push(`turn ${turn}: payout totals`);
        if (MONEY.test(text)) f.push(`turn ${turn}: money in text: ${text.match(MONEY)![0]}`);
        if (PROMISE.test(text)) f.push(`turn ${turn}: promise of payment: ${text.match(PROMISE)![0]}`);
        if (/[“"]not sure[”"]|\(not sure\)/i.test(answer.summary)) f.push(`turn ${turn}: an uncertain answer is quoted back as a fact`);
        if (turn === 0 && expect.firstQuestion && !(answer.questions[0] && expect.firstQuestion.test(answer.questions[0].text)))
          f.push("first question is not " + expect.firstQuestion + ": " + (answer.questions[0]?.text ?? "(none)"));
        const q = answer.questions[0];
        // While the chat is still asking, the claim event this conversation is
        // about says so on the Claims list (V1.1 UX run: it said "Documents
        // needed" while the chat asked "What treatment was given?").
        if (q) {
          const listed = await (await listClaims(new NextRequest("http://localhost/api/claims?familyMemberId=" + member))).json();
          const open = (listed.claims ?? []).filter((c: any) => c.conversation_id === conv.id);
          if (open.length !== 1) f.push(`turn ${turn}: claim events for this conversation while asking: ${open.length}`);
          else {
            if (open[0].display?.label !== "Questions to answer") f.push(`turn ${turn}: the claims list says '${open[0].display?.label}' while the chat asks '${q.text}'`);
            if ((open[0].pending_question as any)?.text !== q.text) f.push(`turn ${turn}: the stored pending question is '${(open[0].pending_question as any)?.text}', the chat asks '${q.text}'`);
            if (answer.claimSessionId !== open[0].id) f.push(`turn ${turn}: the answer does not carry the claim event's id`);
          }
        }
        if (!q) break;
        if (turn > 0 && (q.id === "claim_person" || /which family member/i.test(answer.summary))) { f.push(`turn ${turn}: the reply '${message}' was read as naming another person`); break; }
        if (asked.includes(q.text)) { f.push("asked again: " + q.text); break; }
        if (answer.claimItems.length && answer.mode === "fact_finding") f.push(`turn ${turn}: claim cards while still asking`);
        asked.push(q.text);
        const key = Object.keys(replies).find((k) => q.id.endsWith(k) || (q as any).factKey === k) ?? "";
        const value = replies[key] ?? (q.type === "yes_no" ? "Not sure" : q.options?.includes("Not sure") ? "Not sure" : q.type === "date" ? "2026-09-10" : "Not sure");
        message = q.options?.includes(value) ? value : q.text.replace(/\?\s*$/, "") + ": " + value;
      }
      if (!last) throw new Error("no answer");
      if (last.questions.length) f.push("still asking after the last turn: " + last.questions[0].text);
      if (asked.length > (expect.maxQuestions ?? 9)) f.push("too many questions: " + asked.length);
      if (slow) f.push(slow + " turn(s) took longer than 12 s");
      // The final response.
      const final = last, finalText = visibleText(final);
      for (const b of expect.benefits) if (!final.claimItems.some((i) => b.test(i.title)) && !b.test(final.summary)) f.push("final does not name the possible benefit " + b);
      // A card ruled out on these facts may stay (it says why); it must never be offered as a possible benefit.
      const offered = [final.summary, ...final.claimItems.filter((i) => i.status !== "not_applicable").map((i) => i.title)].join("\n");
      for (const b of expect.forbiddenBenefits ?? []) if (b.test(offered)) f.push("final offers a benefit that does not apply: " + b);
      if (expect.labelledNotOffered) for (const i of final.claimItems.filter((x) => expect.labelledNotOffered!.test(x.title)))
        if (i.status !== "not_applicable" || !/^Not a possible benefit: /.test(i.reason)) f.push("card '" + i.title + "' is not labelled as not a possible benefit: " + i.status + " / " + i.reason.slice(0, 120));
      if (!final.citations.some((c) => c.pageStart === 2)) f.push("final cites no schedule page");
      if (!/possible|may (?:apply|respond|be relevant)/i.test(final.summary)) f.push("final does not call them possible benefits");
      if (!/insurer decides|not a promise|isn['’]t a promise|no amount|estimate only once|after the claim documents/i.test(final.summary)) f.push("final does not withhold an estimate plainly");
      if (expect.definition && !expect.definition.test(finalText)) f.push("final does not identify the applicable definition " + expect.definition);
      if (NOISE.test(finalText)) f.push("final carries internal noise: " + finalText.match(NOISE)![0]);
      if (((final as any).scenarioClassifications ?? []).length) f.push("final shows scenario classifications");
      if (final.details.length > 3) f.push("final has " + final.details.length + " detail lines");
      const docsStep = final.nextSteps.join(" ");
      for (const d of expect.documents) if (!d.test(docsStep)) f.push("final next step does not ask for " + d);
      for (const d of expect.forbiddenDocuments ?? []) if (d.test(docsStep)) f.push("final asks for an unrelated document " + d);
      if (expect.repeat) {
        const again = await send(expect.repeat, member, conv);
        transcript.push("> " + expect.repeat, "< [" + again.answer.mode + "] " + again.answer.summary.slice(0, 200));
        if (again.answer.questions.length) f.push("asking again after the final response reopened the interview: " + again.answer.questions[0].text);
        if (MONEY.test(visibleText(again.answer))) f.push("repeat shows money");
        if (again.answer.claimSessionId && final.claimSessionId && again.answer.claimSessionId !== final.claimSessionId) f.push("repeat recorded a second claim event");
      }
      for (const follow of expect.followUps ?? []) {
        const next = await send(follow.ask, member, conv);
        const a = next.answer, t = visibleText(a);
        transcript.push("> " + follow.ask, "< [" + a.mode + "] " + a.summary.slice(0, 200));
        if (MONEY.test(t)) f.push("follow-up '" + follow.ask + "' shows money before evidence review");
        if (/\b\d+ of \d+ (?:processed )?pages?\b|second read/i.test(t)) f.push("follow-up '" + follow.ask + "' shows internal reading counts: " + t.match(/\b\d+ of \d+ (?:processed )?pages?\b|second read/i)![0]);
        if (follow.claimMoney) {
          // Eval Q16: "DearPolicy didn't find How much can she claim in the parts of ... read so far".
          if (/didn['’]t find|did not find|not stated/i.test(a.summary) || a.summary.toLowerCase().includes(follow.ask.toLowerCase().replace(/\?$/, "")))
            f.push("claim-money question '" + follow.ask + "' was treated as a policy topic: " + a.summary.slice(0, 160));
          if (a.mode === "answer") f.push("claim-money question '" + follow.ask + "' left the claim flow (mode answer)");
          if (!a.claimSessionId || (final.claimSessionId && a.claimSessionId !== final.claimSessionId)) f.push("claim-money question '" + follow.ask + "' is not tied to this conversation's claim event");
        }
      }
      if (expect.lateReplies?.length) {
        const named = async () => ((await (await listClaims(new NextRequest("http://localhost/api/claims?familyMemberId=" + member))).json()).claims ?? [])
          .find((c: any) => c.conversation_id === conv.id)?.event_summary as string | undefined;
        const before = await named();
        for (const reply of expect.lateReplies) {
          const late = await send(reply, member, conv);
          transcript.push("> " + reply, "< [" + late.answer.mode + "] " + late.answer.summary.slice(0, 160));
          const after = await named();
          if (after !== before) f.push("the late reply '" + reply + "' renamed the claim event from '" + before + "' to '" + after + "'");
        }
      }
      // One claim event per conversation, named after the event, statuses agreeing.
      const list = await (await listClaims(new NextRequest("http://localhost/api/claims?familyMemberId=" + member))).json();
      const mine = (list.claims ?? []).filter((c: any) => c.conversation_id === conv.id || c.id === final.claimSessionId);
      if (!final.claimSessionId) f.push("no claim event recorded for the final response");
      if (mine.length !== 1) f.push("claim events for this conversation: " + mine.length + " (" + mine.map((c: any) => c.event_summary).join(" | ") + ")");
      const event = mine[0];
      if (event) {
        if (!expect.eventName.test(event.event_summary ?? "")) f.push("claim event is named '" + event.event_summary + "'");
        if (/^(?:an accident\.?|not sure|yes|no|singapore|how much.*)$/i.test((event.event_summary ?? "").trim()) || /not sure/i.test(event.event_summary ?? "")) f.push("claim event named after a reply: " + event.event_summary);
        const detail = await (await getClaim(new NextRequest("http://localhost/api/claims/" + event.id), { params: Promise.resolve({ id: event.id }) })).json();
        const a = event.display, b = detail.claim?.display;
        if (!a || !b) f.push("list or detail has no display status");
        else {
          if (a.label !== b.label || a.hasEstimate !== b.hasEstimate || JSON.stringify(a.requestedDocuments) !== JSON.stringify(b.requestedDocuments)) f.push("list and detail status disagree: " + a.label + " / " + b.label);
          if (/assessment ready|ready/i.test(a.label) && !a.hasEstimate) f.push("list says '" + a.label + "' without an evidence-backed estimate");
          for (const d of expect.documents) if (!a.requestedDocuments.some((x: string) => d.test(x))) f.push("requested documents miss " + d + ": " + a.requestedDocuments.join("; "));
          for (const d of expect.forbiddenDocuments ?? []) if (a.requestedDocuments.some((x: string) => d.test(x))) f.push("requested documents include " + d);
          const again = claimDisplayStatus({ ...event, facts: event.facts, hasEvidenceBackedEstimate: a.hasEstimate });
          if (again.label !== a.label) f.push("claimDisplayStatus is not the source of the list label");
        }
      }
    } catch (e) { f.push("threw: " + (e instanceof Error ? e.message : String(e)).slice(0, 300)); }
    results.push({ name, ok: !f.length, failures: f, transcript });
    console.log(`\n=== ${f.length ? "FAIL" : "PASS"} ${name}\n  ` + transcript.join("\n  ") + (f.length ? "\n  ✗ " + f.join("\n  ✗ ") : ""));
  }

  // ---------------- Task 0 fixtures: the live defects, reproduced first ----------------
  {
    const f: string[] = [];
    const fracture = { id: uuid(9001), status: "complete", event_type: "accident", event_summary: "Broken arm", facts: { eventType: "accident", injured: true, fractureBodyPart: "arm", injuries: ["broken arm"] }, decision_packet: { ready: true } };
    const s = claimDisplayStatus({ ...fracture, hasEvidenceBackedEstimate: false });
    if (/assessment ready/i.test(s.label) || s.tone === "ready" || s.hasEstimate) f.push("a completed interview with no evidence-backed estimate reads '" + s.label + "'");
    if (s.requestedDocuments.some((d) => /death|coroner/i.test(d))) f.push("a fracture claim asks for death documents: " + s.requestedDocuments.join("; "));
    if (!s.requestedDocuments.some((d) => /doctor|x-ray|medical report/i.test(d))) f.push("a fracture claim does not ask for the doctor's or X-ray report");
    const withEstimate = claimDisplayStatus({ ...fracture, hasEvidenceBackedEstimate: true });
    if (!withEstimate.hasEstimate || withEstimate.tone !== "ready") f.push("an evidence-backed estimate is not shown as ready");
    const death = claimDisplayStatus({ id: uuid(9002), status: "fact_finding", event_type: "death", event_summary: "Death of Desmond", facts: { eventType: "death", death: true }, decision_packet: null, hasEvidenceBackedEstimate: false });
    if (!death.requestedDocuments.some((d) => /death certificate/i.test(d))) f.push("a death claim does not ask for the death certificate");
    if (death.tone !== "info" && death.tone !== "waiting") f.push("an open death claim has tone " + death.tone);
    // The claim pack prints the same documents the list and detail ask for.
    const { claimPackContent } = await import("@/lib/claims/claim-pack");
    const { EMPTY_CLAIM_FACTS } = await import("@/lib/claims/types");
    const pack = claimPackContent({ claimantName: "Charmaine", packet: { sessionId: fracture.id, eventSummary: "Charmaine: broken arm", knownFacts: [], missingFacts: [],
      facts: { ...EMPTY_CLAIM_FACTS, ...fracture.facts, injuries: ["broken arm"], uncertainFacts: [] } as any, relevantOwnedProducts: [], assessments: [], nextSteps: [], ready: true, claimCategory: "accidental_injury" } });
    const packDocs = (pack.sections.find((x) => /Documents to attach/.test(x.heading))?.lines ?? []).map((l) => l.replace(/^•\s*/, ""));
    for (const d of s.requestedDocuments) if (!packDocs.includes(d)) f.push("the claim pack does not list '" + d + "'");
    if (packDocs.some((d) => /death|coroner/i.test(d))) f.push("the fracture claim pack asks for death documents");
    results.push({ name: "Task 0 fixtures: list/detail status and requested documents", ok: !f.length, failures: f, transcript: [] });
    console.log(`\n=== ${f.length ? "FAIL" : "PASS"} Task 0 fixtures` + (f.length ? "\n  ✗ " + f.join("\n  ✗ ") : ""));
  }

  // ---------------- V1.1 eval: event names and event fit (unit level, with positive controls) ----------------
  {
    const f: string[] = [];
    const { claimEventName } = await import("@/lib/chat/fact-finding-chat");
    const { looksLikeInterviewReply } = await import("@/lib/claims/event-name");
    const { eventFitIssue } = await import("@/lib/claims/event-fit");
    const { recordClaim } = await import("@/lib/claims/record");
    const person = { id: CHARMAINE, display_name: "Ong Pei Lin Charmaine", preferred_name: "Charmaine", relationship: "spouse" };
    // Eval "before": an event named "Has a doctor said the injury will leave any lasting impairment: No".
    for (const reply of ["Has a doctor said the injury will leave any lasting impairment: No", "An accident", "Not sure", "Singapore", "What treatment was given?", "2026-09-18", "Yes"]) {
      if (!looksLikeInterviewReply(reply)) f.push("not recognised as a reply: " + reply);
      const name = claimEventName(person, {}, null, reply);
      if (name !== "Charmaine: claim check") f.push("claimEventName names an event after the reply '" + reply + "': " + name);
    }
    for (const good of ["Charmaine: broken arm", "Death of Desmond", "Charmaine broke her arm", "Marcus: flight delay"]) if (looksLikeInterviewReply(good)) f.push("a proper event name is treated as a reply: " + good);
    if (claimEventName(person, {}, null, "Charmaine broke her arm") !== "Charmaine broke her arm") f.push("the opening message no longer names an uncategorised event");
    // recordClaim (every path that renames an event) keeps a proper name.
    const base = { accountId: ACCOUNT, familyMemberId: IVY, facts: {}, items: [], citations: [], knownFacts: [], missingFacts: [], complete: true, nextSteps: [], conversationId: null, claimCategory: "accidental_injury" };
    const first = await recordClaim({ ...base, eventSummary: "Ivy: broken leg" });
    await recordClaim({ ...base, existingId: first.id, eventSummary: "Has a doctor said the injury will leave any lasting impairment: No" });
    const stored = (await db.query<{ event_summary: string }>("SELECT event_summary FROM claim_sessions WHERE id=$1", [first.id])).rows[0]?.event_summary;
    if (stored !== "Ivy: broken leg") f.push("recordClaim renamed the event after a reply: " + stored);
    await db.query("DELETE FROM claim_sessions WHERE id=$1", [first.id]);
    // Event fit (eval Q14): expired on the event date, and overseas-only cover for a Singapore event.
    const fit = (x: Partial<Parameters<typeof eventFitIssue>[0]>) => eventFitIssue({ benefitTitle: "Overseas medical expenses", expiryPassed: false, ...x });
    if (fit({ expiryDate: "2024-12-31", expiryPassed: true, eventDate: "2026-09-18" })?.kind !== "expired") f.push("an expired policy's benefit is offered for a later event");
    if (fit({ expiryDate: "2024-12-31", expiryPassed: true, eventDate: "Not sure" })?.kind !== "expired") f.push("an expired policy's benefit is offered when the event date is unknown");
    if (fit({ benefitTitle: "Accident medical reimbursement", expiryDate: "2024-12-31", expiryPassed: true, eventDate: "2024-11-02" }) !== null) f.push("positive control: cover current on the event date is ruled out");
    if (fit({ benefitTitle: "Accident medical reimbursement", expiryDate: "2024-12-31", expiryPassed: false, eventDate: "2026-09-18" }) !== null) f.push("positive control: a renewed policy (premium evidence after its printed date) is ruled out");
    if (fit({ eventLocation: "Singapore" })?.kind !== "location") f.push("overseas-only cover is offered for an event in Singapore");
    if (fit({ benefitTitle: "Accident medical reimbursement", policyType: "Travel", eventLocation: "Singapore" })?.kind !== "location") f.push("a travel policy's cover is offered for an event in Singapore");
    if (fit({ eventLocation: "Overseas" }) !== null) f.push("positive control: overseas cover is ruled out for an overseas event");
    if (fit({ eventLocation: "Not sure" }) !== null) f.push("positive control: an unknown location rules overseas cover out");
    if (fit({ eventLocation: "Singapore", travelEvent: true }) !== null) f.push("positive control: a travel claim's own cover is ruled out by location");
    if (fit({ benefitTitle: "Fracture of arm", eventLocation: "Singapore" }) !== null) f.push("positive control: local cover is ruled out in Singapore");
    results.push({ name: "V1.1 eval: event names and event fit", ok: !f.length, failures: f, transcript: [] });
    console.log(`\n=== ${f.length ? "FAIL" : "PASS"} V1.1 eval: event names and event fit` + (f.length ? "\n  ✗ " + f.join("\n  ✗ ") : ""));
  }

  // ---------------- The conversations ----------------
  await conversation("Injury: Charmaine broke her arm", CHARMAINE, "Charmaine broke her arm.",
    { eventType: "An accident", eventLocation: "Singapore", eventDate: "2026-09-18", fractureConfirmed: "Yes", treatmentType: "Outpatient or clinic", surgery: "No", outOfPocket: "Not sure" },
    { benefits: [/Fracture of arm/], forbiddenBenefits: [/Loss of arm|permanent disab|Total and permanent/i, /Overseas|evacuation|JetSure|TripCare/i], documents: [/doctor|x-ray/i], forbiddenDocuments: [/death|coroner/i],
      labelledNotOffered: /Overseas|evacuation/i,
      eventName: /broken arm|broke her arm|fracture/i, firstQuestion: /accident, or an illness/i, repeat: "How much can she claim?",
      followUps: [{ ask: "Which of her policies could pay for the broken arm?" }, { ask: "How much can she claim?", claimMoney: true }, { ask: "What can we get for it?", claimMoney: true }],
      lateReplies: ["Has a doctor said the injury will leave any lasting impairment: No", "Not sure"] });
  // Eval Q14: the injury final offered an EXPIRED travel policy's "Overseas
  // medical expenses" for an accident in Singapore. The ledger matches both
  // travel policies' overseas accident medical rows; neither may be offered
  // (expired / overseas-only), and each card that stays says why.
  await conversation("Injury in Singapore with a hospital stay: no expired or overseas-only cover", CHARMAINE, "Charmaine fell and broke her leg.",
    { eventType: "An accident", eventLocation: "Singapore", eventDate: "2026-09-18", fractureConfirmed: "Yes", treatmentType: "Admitted to hospital", hospitalNights: "3", surgery: "No", outOfPocket: "Not sure" },
    { benefits: [/Fracture of leg/], forbiddenBenefits: [/Overseas|evacuation|JetSure|TripCare/i], labelledNotOffered: /Overseas|evacuation/i, documents: [/doctor|x-ray/i],
      forbiddenDocuments: [/death|coroner/i], eventName: /broken leg|broke her leg|fracture/i, maxQuestions: 10 });
  // Positive control: overseas, the CURRENT travel policy's overseas medical
  // cover is a possible benefit; the expired one still is not.
  await conversation("Injury overseas with a hospital stay: current travel cover offered, expired not", CHARMAINE, "Charmaine fell and broke her leg on holiday.",
    { eventType: "An accident", eventLocation: "Overseas", eventDate: "2026-09-18", fractureConfirmed: "Yes", treatmentType: "Admitted to hospital", hospitalNights: "3", surgery: "No", outOfPocket: "Not sure" },
    { benefits: [/Fracture of leg/, /TripCare — Overseas accident medical/], forbiddenBenefits: [/JetSure/i], documents: [/doctor|x-ray/i],
      forbiddenDocuments: [/death|coroner/i], eventName: /broken leg|broke her leg|fracture/i, maxQuestions: 10 });
  await conversation("Death: Desmond died in a road accident", DESMOND, "Desmond died in a road accident on 2026-09-12.",
    { accidentCircumstances: "He was hit by a car while crossing the road", eventLocation: "Singapore" },
    { benefits: [/Death benefit/i, /Accidental death/i], definition: /accidental-death definition/i, documents: [/death certificate/i, /police or coroner/i], eventName: /death|died/i, repeat: "What can we claim?" });
  await conversation("Death (natural cause): Desmond passed away from a heart attack", DESMOND, "Desmond passed away from a heart attack on 2026-09-20.",
    { causeOfDeath: "Heart attack", accidentCircumstances: "He collapsed at home", eventLocation: "Singapore", accidentalDeath: "No" },
    { benefits: [/Death benefit/i], forbiddenBenefits: [/SafeRoad PA — Accidental death/i], documents: [/death certificate/i], eventName: /death/i });
  // No date in the opening: the first reply is "On what date was it diagnosed:
  // 2026-09-01" -- the chat's own question words must not be read as a
  // person's name (e2e stage 03: "Which family member does this concern?").
  await conversation("Critical illness: Charmaine diagnosed with breast cancer", CHARMAINE, "Charmaine was diagnosed with stage 2 breast cancer.",
    { diagnosisDate: "2026-09-01", diagnosedBySpecialist: "Yes", survivedSurvivalPeriod: "Yes" },
    { benefits: [/Major cancer/i], definition: /definition/i, documents: [/specialist/i], forbiddenDocuments: [/death certificate/i], eventName: /breast cancer|diagnos/i });
  await conversation("Disability: Charmaine unable to work", CHARMAINE, "Charmaine is unable to work since a stroke on 2026-03-01.",
    { disabilityCause: "A stroke", unableToWork: "Any work", disabilityContinuousMonths: "7" },
    { benefits: [/Total and permanent disability/i], forbiddenBenefits: [/Loss of arm/i], definition: /definition/i, documents: [/disability assessment|doctor/i], eventName: /disab|unable to work|stroke/i });
  await conversation("Hospitalisation and medical reimbursement: Charmaine admitted", CHARMAINE, "Charmaine was admitted to hospital on 2026-09-15 with pneumonia.",
    { admissionDate: "2026-09-15", dischargeDate: "2026-09-19", hospitalName: "Mount Elizabeth Hospital", otherInsurancePaid: "No", hospitalNights: "4", hospitalised: "Yes" },
    { benefits: [/room and board|Hospital cash/i], documents: [/discharge summary/i, /bill/i], forbiddenDocuments: [/death certificate/i], eventName: /hospital|admitted|pneumonia/i });
  await conversation("Travel: Marcus's flight delayed", MARCUS, "My flight to Tokyo was delayed 8 hours on 2026-09-05.",
    { tripStartDate: "2026-09-05", tripEndDate: "2026-09-12", travelEventType: "Flight delay", eventDate: "2026-09-05", delayHours: "8" },
    { benefits: [/Flight delay/i], definition: /definition|wording/i, documents: [/airline|delay letter|incident/i], eventName: /flight|delay|travel|trip/i });

  // Eval Q16 with no event in the conversation: a claim-money question asks
  // what happened (or gives an existing estimate) -- never a topic lookup.
  {
    const f: string[] = [], transcript: string[] = [];
    try {
      for (const [member, ask] of [[MARCUS, "How much can I claim?"], [CHARMAINE, "How much can Charmaine claim?"]] as const) {
        const { answer: a } = await send(ask, member, {});
        transcript.push("> " + ask, "< [" + a.mode + "] " + a.summary.slice(0, 200) + (a.questions[0] ? "  ? " + a.questions[0].text : ""));
        if (/didn['’]t find|did not find|not stated/i.test(a.summary)) f.push("'" + ask + "' was treated as a policy topic: " + a.summary.slice(0, 160));
        if (a.mode !== "fact_finding" || !/what happened/i.test(a.questions[0]?.text ?? "")) f.push("'" + ask + "' does not ask what happened: [" + a.mode + "] " + (a.questions[0]?.text ?? "(no question)"));
        if (MONEY.test(visibleText(a))) f.push("'" + ask + "' shows money");
      }
    } catch (e) { f.push("threw: " + (e instanceof Error ? e.message : String(e)).slice(0, 300)); }
    results.push({ name: "Claim-money question with no event described", ok: !f.length, failures: f, transcript });
    console.log(`\n=== ${f.length ? "FAIL" : "PASS"} Claim-money question with no event described\n  ` + transcript.join("\n  ") + (f.length ? "\n  ✗ " + f.join("\n  ✗ ") : ""));
  }

  console.log("\n=== SUMMARY ===");
  for (const x of results) console.log(`${x.ok ? "PASS" : "FAIL"} ${x.name}` + (x.ok ? "" : "\n     - " + x.failures.join("\n     - ")));
  const sorted = [...factFindingMs].sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : 0;
  console.log(`fact-finding turns: ${sorted.length}, p95 ${p95} ms, max ${sorted.at(-1) ?? 0} ms (target p95 <= 12000 ms, local synthetic stack)`);
  if (p95 > 12_000) results.push({ name: "fact-finding p95 <= 12 s", ok: false, failures: ["p95 " + p95 + " ms"], transcript: [] });
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed}/${results.length} claim conversations pass`);
  await db.close(); clearInterval(keepAlive); clearTimeout(watchdog);
  process.exitCode = failed ? 1 : 0;
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(2); });
