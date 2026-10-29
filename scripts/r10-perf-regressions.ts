/**
 * Round 10 chat performance and scale regression suite (npm run r10:perf-test).
 *
 * Deterministic and CI-fast: it asserts COSTS -- database queries, model calls
 * by role, prompt size, job-queue behaviour -- never wall time, on the REAL
 * chat route handlers, store, job queue and drain over PGlite, with the
 * deterministic model stand-in (scripts/r6/fixture.ts household).
 *
 *   A. Base household: every answer type within its query and model-call
 *      budget; a repeated turn costs at most 2 model calls (cached readings,
 *      no ledger re-read of a document whose read failed).
 *   B. The same household grown to 10 people and 40 documents
 *      (scripts/r10/scale.ts): queries per turn do not grow with the number
 *      of documents, model calls stay within budget, detectors report 0.
 *   C. A 110-turn conversation: prompt size and queries per turn stay flat,
 *      the same question gets the same answer at turn 100 as at turn 1,
 *      detectors report 0; the chat history pages in fixed-size pages.
 *   D. 200 conversations: the conversation list pages in fixed-size pages at
 *      a constant query cost, every conversation exactly once.
 *   E. 15 concurrent asynchronous chats across 3 households with a document
 *      being read at the same time, run by several concurrent workers: every
 *      chat answered exactly once, none stuck; a chat answer is never queued
 *      behind a long document job (the chat drain lane).
 *   F. A slow and hanging provider (the real HTTP provider path with a
 *      stubbed network) under concurrency: every turn ends inside the turn's
 *      model time budget with an honest answer, never a dead spinner.
 *
 * R10_REPORT=<file> writes every metered turn as JSON lines.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { NextRequest } from "next/server";
import type { ChatAnswer } from "@/types";
import type { TurnMeter } from "./r10/meter";

process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
process.env.E2E_RUN_ID = "r10perf";
process.env.DEV_AUTH_ENABLED = "1";
process.env.MODEL_PRESET = process.env.MODEL_PRESET || "openai";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-not-used";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "ci";
delete process.env.PINECONE_API_KEY; delete process.env.SUPABASE_URL;
delete process.env.R10_METER;

// ----------------------------------------------------------------- budgets
// Queries per turn, measured on the base household and held with headroom.
// A budget is a ceiling on a deterministic count, not a timing.
const BUDGET = {
  direct: 25,          // greetings, thanks: answered in code
  policy: 60,          // a policy question for one person
  policyFirst: 62,     // the same question the first time: + the cited pages' text (cached 10 min) + one per-process column probe
  family: 125,         // a whole-household question (scales with people, not documents)
  claim: 80,           // a claim interview or what-if turn
  modelCallsSteady: 2, // a repeated (steady-state) turn
  modelCallsFirst: 11, // first time a question needs the wording read: 1 interpretation + 8 windows + 1 narration + 1 relevance
  promptChars: 16_000, // the largest single prompt
  scaleGrowth: 12,     // extra queries a 10-person, 40-document household may cost per turn
  listPage: 10,        // queries for one page of the conversation list / chat history
};

type Probe = { kind: keyof typeof BUDGET; member: "MEILING" | null; scope?: "family"; say: string };
const PROBES: Probe[] = [
  { kind: "direct", member: "MEILING", say: "hi" },
  { kind: "direct", member: "MEILING", say: "hello" },
  { kind: "policy", member: "MEILING", say: "What is Mei Ling covered for?" },
  { kind: "policy", member: "MEILING", say: "What is Mei Ling's deductible?" },
  { kind: "policy", member: "MEILING", say: "Does Mei Ling have dental cover?" },
  { kind: "policy", member: "MEILING", say: "When is Mei Ling's policy due for renewal?" },
  { kind: "policy", member: "MEILING", say: "How much premium does Mei Ling pay every year?" },
  { kind: "policy", member: "MEILING", say: "Is Mei Ling covered for critical illness?" },
  { kind: "family", member: null, scope: "family", say: "How much do we pay in premiums a year altogether?" },
  { kind: "family", member: null, scope: "family", say: "Who in the family has hospital cover?" },
  { kind: "family", member: null, scope: "family", say: "What policies do we have?" },
  { kind: "claim", member: "MEILING", say: "If Mei Ling breaks a bone, how much can claim?" },
];
const CLAIM_OPENING = "Mei Ling was admitted to hospital yesterday after she fell and broke her wrist";
const CLAIM_REPLIES: [RegExp, string][] = [[/night/i, "3 nights"], [/bill|cost|how much/i, "Not yet known"], [/ambulance/i, "No"], [/accident|illness/i, "accident"], [/when/i, "yesterday"]];

async function main() {
  const started = Date.now();
  const watchdog = setTimeout(() => { console.error("WATCHDOG: no completion in 15 minutes"); process.exit(3); }, 15 * 60_000);
  globalThis.fetch = (async (input: RequestInfo | URL) => { throw new Error("network disabled: " + String(input)); }) as typeof fetch;
  const out = console.log;
  console.info = () => undefined; console.debug = () => undefined; console.warn = () => undefined;
  console.log = (...args: unknown[]) => { if (typeof args[0] === "string" && /^(?:\{"|\[telemetry\]|SQL note)/.test(args[0])) return; out(...args); };
  const report = process.env.R10_REPORT; if (report) writeFileSync(report, "");

  const M = await import("./r10/meter");
  const { detect, moneyIn } = await import("./r6/detectors");
  const { detectR8 } = await import("./r8/detectors");
  const R9 = await import("./r9/ingest-detectors");
  const F = await import("./r6/fixture");
  const S = await import("./r10/scale");
  const h = await F.buildHousehold();
  out(`household built in ${Date.now() - started} ms`);
  const { POST } = await import("@/app/api/chat/route");
  const HistoryList = await import("@/app/api/chat/history/route");
  const HistoryOne = await import("@/app/api/chat/history/[id]/route");
  const JobRoute = await import("@/app/api/chat/jobs/[id]/route");
  await M.installMeter();
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

  const failures: string[] = [];
  const check = (ok: boolean, message: string) => { if (!ok) failures.push(message); return ok; };
  const memberId = (m: Probe["member"]) => (m === "MEILING" ? F.MEILING : null);

  // ------------------------------------------------ ground truth (as scripts/r6-chat-quality-regressions.ts)
  const truth = async () => {
    const pages = new Map<string, string>();
    for (const r of (await h.db.query<{ policy_id: string; text: string }>("SELECT pp.policy_id,string_agg(pp.text,E'\\n' ORDER BY pp.page_number) text FROM policy_pages pp JOIN policies p ON p.id=pp.policy_id WHERE p.account_id=$1 AND p.lifecycle_state='active' GROUP BY 1", [F.ACCOUNT])).rows) pages.set(r.policy_id, r.text);
    const premiumFigures: number[] = [];
    for (const r of (await h.db.query<{ amount: string; notes: string | null }>("SELECT amount::text,notes FROM premium_records WHERE account_id=$1", [F.ACCOUNT])).rows) { premiumFigures.push(Number(r.amount)); premiumFigures.push(...moneyIn(r.notes ?? "")); }
    const personPolicies = new Map<string, Set<string>>();
    for (const r of (await h.db.query<{ family_member_id: string; policy_id: string }>("SELECT family_member_id,policy_id FROM policy_members WHERE account_id=$1", [F.ACCOUNT])).rows) {
      if (!personPolicies.has(r.family_member_id)) personPolicies.set(r.family_member_id, new Set());
      personPolicies.get(r.family_member_id)!.add(r.policy_id);
    }
    return { pages, premiumFigures: [...new Set(premiumFigures)], householdNames: F.PEOPLE.map((p) => p.display_name), foreignNames: ["Goh Boon Kiat", "Boon Kiat"],
      selfNames: F.PEOPLE.filter((p) => p.relationship === "self").flatMap((p) => [p.display_name, p.preferred_name]),
      foreignPolicyIds: new Set([h.docs.other]), personPolicies };
  };
  let g = await truth();
  let g9 = await R9.pageTruth(h.db as never, F.ACCOUNT);
  let detectorHits = 0;
  const judge = (label: string, question: string, userText: string, claimTurn: boolean, a: ChatAnswer | null, status: number) => {
    const hits: { rule: string; text: string }[] = [];
    if (status !== 200 || !a) hits.push({ rule: "unexpected HTTP status", text: String(status) });
    else {
      hits.push(...detect(a, { question, userText, claimTurn, ms: 0, expect: {} as never }, g as never));
      hits.push(...detectR8(a, { userText }, { pages: g.pages, today }));
      hits.push(...R9.detectR9(a, g9));
    }
    if (hits.length) { detectorHits += hits.length; failures.push(`detector hits on "${label}" > ${question.slice(0, 80)}: ` + hits.map((x) => x.rule + ": " + x.text.slice(0, 160)).join(" | ")); }
  };

  // ------------------------------------------------ one metered chat turn through the real route
  const all: (TurnMeter & { phase: string; kind: string })[] = [];
  type Conv = { id?: string; rev?: number };
  const ask = async (phase: string, kind: string, account: string, member: string | null, scope: string | undefined, question: string, conv: Conv) => {
    process.env.DEV_ACCOUNT_ID = account;
    let meter!: TurnMeter;
    const res = await M.meterTurn(question, () => POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ familyMemberId: member, scope: scope ?? (member ? "member" : "family"), question, conversationId: conv.id, conversationRevision: conv.rev, asynchronous: false, timeZone: "Asia/Singapore" }) })), (m) => { meter = m; });
    const data = await res.json() as { answer?: ChatAnswer; error?: string };
    const a = res.status === 200 ? data.answer ?? null : null;
    if (a) { conv.id = a.conversationId ?? conv.id; conv.rev = a.conversationRevision ?? conv.rev; }
    const row = { ...meter, phase, kind };
    all.push(row);
    if (report) { const { queryKinds: _q, ...line } = row; void _q; appendFileSync(report, JSON.stringify(line) + "\n"); }
    return { status: res.status, answer: a, meter };
  };
  const claimRun = async (phase: string, account: string) => {
    const conv: Conv = {}; let message = CLAIM_OPENING; let userText = ""; const used = new Set<number>(); const metas: TurnMeter[] = [];
    for (let turn = 0; turn < 9; turn++) {
      userText += "\n" + message;
      const r = await ask(phase, "claim", account, F.MEILING, undefined, message, conv);
      metas.push(r.meter);
      judge(phase + ":claim", message, userText, true, r.answer, r.status);
      if (!r.answer) break;
      const direct = r.answer.questions[0];
      const q = direct ?? (r.answer.factFinding ?? []).flatMap((p) => p.nextQuestions)[0];
      if (!q || q.id === "claim_person") break;
      const index = CLAIM_REPLIES.findIndex(([re], i) => !used.has(i) && re.test(q.text));
      if (index >= 0) used.add(index);
      const reply = index >= 0 ? CLAIM_REPLIES[index][1] : "Not sure";
      message = direct && q.options?.includes(reply) ? reply : q.text.replace(/\?\s*$/, "") + ": " + reply;
    }
    return metas;
  };
  const probeRun = async (phase: string) => {
    const rows = new Map<string, TurnMeter>();
    for (const p of PROBES) {
      const r = await ask(phase, p.kind, F.ACCOUNT, memberId(p.member), p.scope, p.say, {});
      judge(phase, p.say, p.say, false, r.answer, r.status);
      rows.set(p.say, r.meter);
    }
    const claim = await claimRun(phase, F.ACCOUNT);
    claim.forEach((m, i) => rows.set("claim#" + i, m));
    return rows;
  };
  const kindOf = (key: string) => (key.startsWith("claim#") ? "claim" : PROBES.find((p) => p.say === key)!.kind);
  const assertBudgets = (phase: string, rows: Map<string, TurnMeter>, steady: boolean) => {
    for (const [key, m] of rows) {
      const kind = kindOf(key) as keyof typeof BUDGET;
      const limit = kind === "policy" && !steady ? BUDGET.policyFirst : BUDGET[kind];
      check(m.queries <= limit, `${phase}: "${key}" ran ${m.queries} queries (budget ${limit})`);
      check(m.modelCalls <= (steady ? BUDGET.modelCallsSteady : BUDGET.modelCallsFirst), `${phase}: "${key}" made ${m.modelCalls} model calls ${JSON.stringify(m.byOperation)} (budget ${steady ? BUDGET.modelCallsSteady : BUDGET.modelCallsFirst})`);
      check(m.maxPromptChars <= BUDGET.promptChars, `${phase}: "${key}" sent a ${m.maxPromptChars}-character prompt (budget ${BUDGET.promptChars})`);
      check(!steady || (m.byOperation["benefit_extraction"] ?? 0) === 0, `${phase}: "${key}" re-read documents into the ledger on a repeated turn (${m.byOperation["benefit_extraction"]} calls)`);
      if (kind === "direct") check(m.modelCalls === 0, `${phase}: "${key}" (answered in code) made ${m.modelCalls} model calls`);
      check(m.historyReads <= 1, `${phase}: "${key}" read the history ${m.historyReads} times`);
    }
  };

  // ================================================= A0. ledger seeding: batched, idempotent, never failing
  // (a seeding that throws is swallowed by every caller, so it is checked here directly)
  const { seedLedger } = await import("@/lib/ledger/store");
  const seededKeys = async () => (await h.db.query<{ k: string }>("SELECT seed_key k FROM coverage_rules WHERE account_id=$1 AND seed_key IS NOT NULL AND seed_key NOT LIKE 'ai:%' ORDER BY 1", [F.ACCOUNT])).rows.map((r) => r.k).join("\n");
  const seedOnce = async (label: string) => {
    let meter!: TurnMeter; let added = -1;
    try { await M.meterTurn("seed", async () => { added = (await seedLedger(F.ACCOUNT)).added; }, (m) => { meter = m; }); }
    catch (error) { check(false, `ledger: ${label} seeding failed: ` + (error instanceof Error ? error.message : String(error))); }
    return { added, queries: meter?.queries ?? 0 };
  };
  const wipe = () => h.db.query("DELETE FROM coverage_rules WHERE account_id=$1 AND seed_key IS NOT NULL AND seed_key NOT LIKE 'ai:%'", [F.ACCOUNT]);
  await wipe();
  const first = await seedOnce("from scratch");
  const keys1 = await seededKeys();
  await wipe();
  const rebuilt = await seedOnce("from scratch again");
  check(keys1.length > 0 && (await seededKeys()) === keys1, "ledger: seeding from scratch twice did not build the same rows");
  check(first.added === rebuilt.added && rebuilt.added === keys1.split("\n").length, `ledger: seeding from scratch added ${first.added} then ${rebuilt.added} rows for ${keys1.split("\n").length} keys`);
  const again = await seedOnce("repeat");
  check(again.added === 0, `ledger: seeding again added ${again.added} rows`);
  check(rebuilt.queries <= 30 && again.queries <= 30, `ledger: seeding ran ${rebuilt.queries}/${again.queries} queries (budget 30, not one per row)`);
  out(`A0. ledger seeding: ${rebuilt.added} rows in ${rebuilt.queries} queries; a repeat adds 0 in ${again.queries}`);

  // ================================================= A. base household
  const baseFirst = await probeRun("base-first");
  assertBudgets("base-first", baseFirst, false);
  const baseSteady = await probeRun("base-steady");
  assertBudgets("base-steady", baseSteady, true);
  out(`A. base household: ${baseSteady.size} turn types within budget`);

  // ================================================= B. 10 people, 40 documents
  const basePeople = F.PEOPLE.length;
  const scaled = await S.scaleHousehold(h.db as never, F.ACCOUNT, F.PEOPLE);
  check(scaled.people >= 10 && scaled.documents >= 40, "scale: household has " + JSON.stringify(scaled));
  g = await truth(); g9 = await R9.pageTruth(h.db as never, F.ACCOUNT);
  const scaleFirst = await probeRun("scale-first");
  assertBudgets("scale-first", scaleFirst, false);
  const scaleSteady = await probeRun("scale-steady");
  assertBudgets("scale-steady", scaleSteady, true);
  for (const [key, m] of scaleSteady) {
    const base = baseSteady.get(key); if (!base) continue;
    // Per-person work grows with people (a household total reads each person's premiums); nothing grows with documents.
    const allowance = BUDGET.scaleGrowth + (kindOf(key) === "family" ? 6 * (scaled.people - basePeople) : 0);
    check(m.queries <= base.queries + allowance, `scale: "${key}" ran ${m.queries} queries at ${scaled.documents} documents vs ${base.queries} at 8 (allowance ${allowance})`);
    check(m.modelCalls <= Math.max(base.modelCalls, BUDGET.modelCallsSteady), `scale: "${key}" made ${m.modelCalls} model calls vs ${base.modelCalls} at base`);
  }
  out(`B. scaled household (${scaled.people} people, ${scaled.documents} documents): budgets hold`);

  // ================================================= C. a 110-turn conversation
  const LONG = ["What is Mei Ling covered for?", "What is Mei Ling's deductible?", "Does Mei Ling have dental cover?", "When is Mei Ling's policy due for renewal?",
    "What travel cover does Mei Ling have?", "What is the annual limit on Mei Ling's hospital plan?", "Which ward class is Mei Ling covered for?", "What's the co-insurance on Mei Ling's shield plan?",
    "How much premium does Mei Ling pay every year?", "Is Mei Ling covered for critical illness?", "thanks"];
  const longConv: Conv = {};
  const longRows: TurnMeter[] = []; const firstAnswer = new Map<string, string>();
  let changed = 0;
  for (let turn = 0; turn < 110; turn++) {
    const q = LONG[turn % LONG.length];
    const r = await ask("long", "long", F.ACCOUNT, F.MEILING, undefined, q, longConv);
    judge("long#" + turn, q, q, false, r.answer, r.status);
    longRows.push(r.meter);
    const key = r.answer ? r.answer.summary + "\n" + r.answer.details.join("\n") : "";
    if (!firstAnswer.has(q)) firstAnswer.set(q, key);
    else if (firstAnswer.get(q) !== key) { changed++; if (changed <= 3) failures.push(`long: turn ${turn} answered "${q}" differently from its first time:\n  first: ${firstAnswer.get(q)!.slice(0, 200)}\n  now:   ${key.slice(0, 200)}`); }
  }
  const early = longRows.slice(0, LONG.length), late = longRows.slice(-LONG.length);
  const avg = (rs: TurnMeter[], f: (m: TurnMeter) => number) => rs.reduce((n, m) => n + f(m), 0) / rs.length;
  const maxOf = (rs: TurnMeter[], f: (m: TurnMeter) => number) => Math.max(...rs.map(f));
  check(maxOf(late, (m) => m.maxPromptChars) <= maxOf(early, (m) => m.maxPromptChars) * 1.05 + 200, `long: prompts grew with history: ${maxOf(early, (m) => m.maxPromptChars)} chars early, ${maxOf(late, (m) => m.maxPromptChars)} at turn 100+`);
  check(avg(late, (m) => m.queries) <= avg(early, (m) => m.queries) + 2, `long: queries per turn grew with history: ${avg(early, (m) => m.queries).toFixed(1)} early, ${avg(late, (m) => m.queries).toFixed(1)} at turn 100+`);
  check(avg(late, (m) => m.modelCalls) <= avg(early, (m) => m.modelCalls) + 0.01, "long: model calls per turn grew with history");
  // The chat history of that conversation: fixed-size pages, every message once.
  process.env.DEV_ACCOUNT_ID = F.ACCOUNT;
  const seenMessages = new Set<string>(); let cursor: string | null = null; let pages = 0;
  do {
    let meter!: TurnMeter;
    const at: string | null = cursor;
    const res = await M.meterTurn("history", () => HistoryOne.GET(new NextRequest("http://localhost/api/chat/history/" + longConv.id + (at ? "?cursor=" + at : "")), { params: Promise.resolve({ id: longConv.id! }) }), (m) => { meter = m; });
    const body = await res.json() as { messages: { id: string }[]; nextCursor: string | null };
    check(res.status === 200 && body.messages.length <= 50, `long: history page ${pages} returned ${body.messages?.length} messages (status ${res.status})`);
    check(meter.queries <= BUDGET.listPage, `long: history page ${pages} ran ${meter.queries} queries (budget ${BUDGET.listPage})`);
    for (const m of body.messages ?? []) { check(!seenMessages.has(m.id), "long: history repeated message " + m.id); seenMessages.add(m.id); }
    cursor = body.nextCursor; pages++;
  } while (cursor && pages < 20);
  check(seenMessages.size === 220, `long: history paged ${seenMessages.size} messages of 220`);
  out(`C. 110-turn conversation: prompt ${maxOf(early, (m) => m.maxPromptChars)}→${maxOf(late, (m) => m.maxPromptChars)} chars, queries ${avg(early, (m) => m.queries).toFixed(1)}→${avg(late, (m) => m.queries).toFixed(1)}, ${changed} changed answers, history in ${pages} pages`);

  // ================================================= D. 200 conversations
  for (let i = 0; i < 200; i++) await ask("list-fill", "direct", F.ACCOUNT, F.MEILING, undefined, i % 2 ? "hi" : "hello", {});
  const total = Number((await h.db.query<{ n: number }>("SELECT count(*)::int n FROM chat_conversations WHERE account_id=$1", [F.ACCOUNT])).rows[0].n);
  const listed = new Set<string>(); cursor = null; let listPages = 0; let lastUpdated = "9999";
  do {
    let meter!: TurnMeter;
    const at: string | null = cursor;
    const res = await M.meterTurn("list", () => HistoryList.GET(new NextRequest("http://localhost/api/chat/history?scope=all" + (at ? "&cursor=" + at : ""))), (m) => { meter = m; });
    const body = await res.json() as { conversations: { id: string; updated_at: string }[]; nextCursor: string | null };
    check(res.status === 200 && body.conversations.length <= 50, `list: page ${listPages} returned ${body.conversations?.length} (status ${res.status})`);
    check(meter.queries <= BUDGET.listPage, `list: page ${listPages} ran ${meter.queries} queries (budget ${BUDGET.listPage})`);
    for (const c of body.conversations ?? []) { check(!listed.has(c.id), "list: conversation listed twice " + c.id); listed.add(c.id); check(c.updated_at <= lastUpdated, "list: out of order"); lastUpdated = c.updated_at; }
    cursor = body.nextCursor; listPages++;
  } while (cursor && listPages < 50);
  check(listed.size === total && total >= 200, `list: listed ${listed.size} of ${total} conversations`);
  out(`D. ${total} conversations listed in ${listPages} pages`);

  // ================================================= E. concurrent asynchronous chats, a document being read, several workers
  const Drain = await import("@/lib/jobs/request-drain");
  const Proc = await import("@/lib/jobs/processors");
  const { runJobBatch } = await import("@/lib/jobs/cron-runner");
  const { enqueuePolicyProcessing } = await import("@/lib/rag/processing-queue");
  const { savePolicyFile } = await import("@/lib/storage");
  const { readFile } = await import("node:fs/promises");
  const { createHash, randomUUID } = await import("node:crypto");
  const pdf = Buffer.from((await readFile("scripts/fixtures/r5/TermSecure20_Renewal_Certificate_2026_x.pdf.b64", "utf8")).replace(/\s+/g, ""), "base64");
  const uploadFor = async (account: string, member: string) => {
    const policyId = randomUUID();
    const filename = "upload-" + policyId.slice(0, 6) + ".pdf";
    const storageKey = await savePolicyFile({ accountId: account, familyMemberId: member, policyId, filename, bytes: new Uint8Array(pdf) });
    await h.db.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,processing_stage,processing_progress,processing_message,quarantine_status,scan_provider,scanned_at)
      VALUES($1,$2,$3,$4,$5,$6,'queued','queued',1,'Waiting','scan_clean','r10',now())`, [policyId, account, member, filename, storageKey, createHash("sha256").update(policyId).digest("hex")]);
    await enqueuePolicyProcessing({ accountId: account, familyMemberId: member, policyId, storageKey, linkUploadMember: true });
    return policyId;
  };
  // Concurrent requests for different households: one signed-in person who
  // belongs to all three, each request choosing its household by the
  // active-household cookie, as the app does (lib/auth/request-context.ts).
  for (const account of [F.OTHER_ACCOUNT, F.EMPTY_ACCOUNT]) await h.db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING", [account, F.ACCOUNT]);
  process.env.DEV_ACCOUNT_ID = F.ACCOUNT;
  const as = (account: string) => ({ "content-type": "application/json", cookie: "dp_household=" + account });
  const chatStatus = async (id: string) => (await h.db.query<{ status: string }>("SELECT status FROM chat_analysis_jobs WHERE id=$1", [id])).rows[0]?.status;
  const asyncAsk = async (account: string, member: string, question: string) => {
    const res = await POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: as(account), body: JSON.stringify({ familyMemberId: member, scope: "member", question, asynchronous: true }) }));
    const body = await res.json() as { jobId?: string; conversationId?: string };
    return { status: res.status, jobId: body.jobId ?? "", conversationId: body.conversationId ?? "" };
  };
  // E0. Both chat routes schedule the chat lane, after authentication.
  for (const route of ["app/api/chat/route.ts", "app/api/chat/jobs/[id]/route.ts"]) {
    const src = await readFile(route, "utf8");
    const auth = src.search(/await requireHouseholdContext\(request\)/), lane = src.search(/\n\s*scheduleChatDrain\(\);/);
    check(auth >= 0 && lane > auth, `${route} must schedule the chat lane (scheduleChatDrain) after requireHouseholdContext()`);
  }
  check(/export const maxDuration=300;/.test(await readFile("app/api/chat/jobs/[id]/route.ts", "utf8")), "the chat poll route must give the drain it schedules the chat function's time limit");
  // E1. The chat lane: a long document job in flight never holds a chat answer back.
  Drain.resetRequestDrainStateForTests(); Drain.resetChatDrainStateForTests();
  let releaseDocument!: () => void; const documentHeld = new Promise<void>((resolve) => { releaseDocument = resolve; });
  await uploadFor(F.ACCOUNT, F.WEIJIE);
  const general = Drain.drainOnce({ jobTypes: [{ jobType: "policy_processing", process: async () => { await documentHeld; } }] as never });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const queued = await asyncAsk(F.ACCOUNT, F.MEILING, "What is Mei Ling covered for?");
  check(queued.status === 202 && !!queued.jobId, "lane: asynchronous chat was not accepted (" + queued.status + ")");
  const second = await Drain.drainOnce();
  check(second.ran === false, "lane: a second general drain started while one was in flight");
  const lane = await Drain.drainChatOnce();
  const laneJob = await chatStatus(queued.jobId);
  check(lane.ran === true && laneJob === "complete", `lane: with a document job in flight the chat lane ran ${JSON.stringify(lane)} and left the chat ${laneJob}`);
  releaseDocument(); await general;
  // E2. A general drain claims a waiting chat before documents.
  Drain.resetRequestDrainStateForTests(); Drain.resetChatDrainStateForTests();
  await h.db.query("UPDATE background_jobs SET status='cancelled' WHERE job_type='policy_processing' AND status IN ('queued','failed_retryable','processing')");
  for (let i = 0; i < 3; i++) await uploadFor(F.ACCOUNT, F.WEIJIE);
  const behind = await asyncAsk(F.ACCOUNT, F.MEILING, "Does Mei Ling have dental cover?");
  const order: string[] = [];
  const recording = Proc.PRODUCTION_JOB_TYPES.map((t) => ({ jobType: t.jobType, process: async (job: Parameters<typeof t.process>[0]) => { order.push(t.jobType); if (t.jobType === "chat_analysis") await t.process(job); } }));
  await Drain.drainOnce({ jobTypes: Drain.interactiveFirst(recording) as never });
  check(order[0] === "chat_analysis", "drain order: a general drain claimed " + order.join(",") + " before the waiting chat");
  check(await chatStatus(behind.jobId) === "complete", "drain order: the chat waiting behind 3 uploads was not answered by the first drain");
  await h.db.query("UPDATE background_jobs SET status='cancelled' WHERE job_type='policy_processing' AND status IN ('queued','failed_retryable')");
  // E3. 15 concurrent chats across 3 households, a real document being read, 3 workers.
  const households = [
    { account: F.ACCOUNT, member: F.MEILING, questions: ["What is Mei Ling covered for?", "What is Mei Ling's deductible?", "How much premium does Mei Ling pay every year?", "When is Mei Ling's policy due for renewal?", "Does Mei Ling have dental cover?"] },
    { account: F.OTHER_ACCOUNT, member: F.OTHER_PERSON, questions: ["What am I covered for?", "When is my policy due for renewal?", "How much is my life cover?", "hi", "Do I have critical illness cover?"] },
    { account: F.EMPTY_ACCOUNT, member: F.EMPTY_PERSON, questions: ["What am I covered for?", "hello", "Do I have hospital cover?", "What should I do first?", "thanks"] },
  ];
  const documentId = await uploadFor(F.OTHER_ACCOUNT, F.OTHER_PERSON);
  const accepted: { account: string; question: string; status: number; jobId: string; conversationId: string }[] = [];
  await Promise.all(households.flatMap((hh) => hh.questions.map(async (question) => { accepted.push({ account: hh.account, question, ...(await asyncAsk(hh.account, hh.member, question)) }); })));
  for (const a of accepted) check(a.status === 202 && !!a.jobId, `concurrent: "${a.question}" not accepted (${a.status})`);
  const open = async () => Number((await h.db.query<{ n: number }>("SELECT count(*)::int n FROM chat_analysis_jobs WHERE id=ANY($1::uuid[]) AND status IN ('queued','running')", [accepted.map((a) => a.jobId)])).rows[0].n)
    + Number((await h.db.query<{ n: number }>("SELECT count(*)::int n FROM background_jobs WHERE job_type='policy_processing' AND idempotency_key=$1 AND status IN ('queued','processing','failed_retryable')", [documentId])).rows[0].n);
  const worker = async (n: number) => {
    for (let round = 0; round < 60; round++) {
      const summary = await runJobBatch({ jobTypes: n === 0 ? Proc.PRODUCTION_JOB_TYPES : Proc.PRODUCTION_JOB_TYPES.filter((t) => t.jobType === "chat_analysis"), maxJobs: 2, claimBudgetMs: 20_000, workerId: "r10-worker-" + n + "-" + round });
      if (!summary.claimed) { if (!(await open())) return; await new Promise((resolve) => setTimeout(resolve, 20)); }
    }
  };
  const polled = new Map<string, string>();
  const poller = async () => {
    for (let round = 0; round < 400 && polled.size < accepted.length; round++) {
      for (const a of accepted) {
        if (polled.has(a.jobId)) continue;
        const res = await JobRoute.GET(new NextRequest("http://localhost/api/chat/jobs/" + a.jobId, { headers: as(a.account) }), { params: Promise.resolve({ id: a.jobId }) });
        const body = await res.json() as { job?: { status: string }; result?: { answer?: ChatAnswer } };
        if (body.job && !["queued", "running"].includes(body.job.status)) {
          polled.set(a.jobId, body.job.status);
          if (a.account === F.ACCOUNT) judge("concurrent", a.question, a.question, false, body.result?.answer ?? null, body.job.status === "complete" ? 200 : 500);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  await Promise.all([worker(0), worker(1), worker(2), poller()]);
  for (const a of accepted) check(polled.get(a.jobId) === "complete", `concurrent: "${a.question}" ended ${polled.get(a.jobId) ?? "still waiting"}`);
  const runs = (await h.db.query<{ attempt_count: number; status: string }>("SELECT attempt_count,status FROM background_jobs WHERE job_type='chat_analysis' AND idempotency_key=ANY($1::text[])", [accepted.map((a) => a.jobId)])).rows;
  check(runs.length === accepted.length && runs.every((r) => r.attempt_count === 1 && r.status === "succeeded"), "concurrent: chat jobs were not each run exactly once: " + JSON.stringify(runs.filter((r) => r.attempt_count !== 1 || r.status !== "succeeded")));
  const pairs = (await h.db.query<{ n: number }>("SELECT count(*)::int n FROM chat_messages WHERE conversation_id=ANY($1::uuid[]) GROUP BY conversation_id", [accepted.map((a) => a.conversationId)])).rows;
  check(pairs.length === accepted.length && pairs.every((p) => p.n === 2), "concurrent: messages per chat " + JSON.stringify(pairs.map((p) => p.n)));
  const docStatus = (await h.db.query<{ status: string }>("SELECT status FROM background_jobs WHERE job_type='policy_processing' AND idempotency_key=$1", [documentId])).rows[0]?.status;
  check(docStatus === "succeeded", "concurrent: the document read alongside the chats ended " + docStatus);
  out(`E. ${accepted.length} concurrent asynchronous chats across 3 households with a document being read: ${[...polled.values()].filter((s) => s === "complete").length} answered, each exactly once; chat lane and drain order hold`);

  // ================================================= F. a slow and hanging provider, under concurrency
  const budgetMs = 6_000;
  Object.assign(process.env, { CHAT_TURN_MODEL_BUDGET_MS: String(budgetMs), MODEL_PRESET: "openai", OPENAI_API_KEY: "sk-test-not-used" });
  delete process.env.DEARPOLICY_DETERMINISTIC_MODEL;
  const { deterministicHostedReply } = await import("@/lib/ai/deterministic-model");
  let calls = 0, hung = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!/\/chat\/completions$/.test(url)) throw new Error("network disabled: " + url);
    const n = calls++;
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages: { content: string }[] };
    const signal = init?.signal;
    const wait = (ms: number) => new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => { clearTimeout(t); reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })); }, { once: true });
    });
    if (n % 3 === 0) { hung++; await wait(10 * 60_000); } else await wait(n % 3 === 1 ? 600 : 50);
    try {
      const reply = deterministicHostedReply({ system: body.messages[0].content, user: body.messages[1].content });
      return new Response(JSON.stringify({ id: "r10-" + n, model: "gpt-test", choices: [{ message: { content: reply.content }, finish_reason: "stop" }], usage: { prompt_tokens: reply.usage.input, completion_tokens: reply.usage.output } }), { status: 200, headers: { "content-type": "application/json" } });
    } catch (error) {
      return new Response(JSON.stringify({ error: { message: "unsupported prompt: " + (error instanceof Error ? error.message : "") } }), { status: 400 });
    }
  }) as typeof fetch;
  const slow = [
    { account: F.ACCOUNT, member: F.MEILING, q: "What is Mei Ling's deductible?" }, { account: F.ACCOUNT, member: F.MEILING, q: "Is Mei Ling covered for critical illness?" },
    { account: F.ACCOUNT, member: F.WEIJIE, q: "What does Wei Jie's plan pay for hospital stays?" }, { account: F.ACCOUNT, member: F.MEILING, q: "If Mei Ling breaks a bone, how much can claim?" },
    { account: F.ACCOUNT, member: F.MEILING, q: CLAIM_OPENING }, { account: F.OTHER_ACCOUNT, member: F.OTHER_PERSON, q: "What am I covered for?" },
    { account: F.OTHER_ACCOUNT, member: F.OTHER_PERSON, q: "How much is my life cover?" }, { account: F.EMPTY_ACCOUNT, member: F.EMPTY_PERSON, q: "Do I have hospital cover?" },
    { account: F.ACCOUNT, member: F.XINYI, q: "What does Xin Yi's accident plan pay for a fracture?" }, { account: F.ACCOUNT, member: F.WEIJIE, q: "Does Wei Jie have life insurance? How much?" },
  ];
  const slowStarted = Date.now();
  const slowResults = await Promise.all(slow.map(async (s) => {
    const t0 = Date.now();
    const res = await POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: as(s.account),
      body: JSON.stringify({ familyMemberId: s.member, scope: "member", question: s.q, asynchronous: false, timeZone: "Asia/Singapore" }) }));
    const data = await res.json() as { answer?: ChatAnswer };
    return { ...s, status: res.status, ms: Date.now() - t0, answer: data.answer ?? null };
  }));
  const slowWall = Date.now() - slowStarted;
  for (const r of slowResults) {
    check(r.status === 200 && !!r.answer?.summary, `slow provider: "${r.q}" ended ${r.status}`);
    // The turn's model budget, plus the one retry window a call may still use and the database: never the 150 s timeouts stacked.
    check(r.ms <= budgetMs + 25_000, `slow provider: "${r.q}" took ${r.ms} ms with a ${budgetMs} ms model budget`);
    if (r.answer && r.account === F.ACCOUNT) { const hits = detectR8(r.answer, { userText: r.q }, { pages: g.pages, today }); if (hits.length) failures.push(`slow provider: "${r.q}": ` + hits.map((x) => x.rule + ": " + x.text.slice(0, 120)).join(" | ")); }
  }
  check(hung > 0, "slow provider: no call hung, so the budget was never exercised");
  out(`F. slow/hanging provider: ${slowResults.length} concurrent turns, ${calls} provider calls (${hung} hung), all answered in ${slowWall} ms (max ${Math.max(...slowResults.map((r) => r.ms))} ms)`);

  // ------------------------------------------------ report
  const table = (phase: string) => {
    const rows = all.filter((r) => r.phase === phase);
    for (const k of [...new Set(rows.map((r) => r.kind))]) {
      const rs = rows.filter((r) => r.kind === k);
      const p = (f: (m: TurnMeter) => number, q: number) => M.percentile(rs.map(f), q);
      out(`  ${phase.padEnd(13)} ${k.padEnd(7)} n=${String(rs.length).padStart(3)}  queries p50/p95/max ${p((m) => m.queries, 50)}/${p((m) => m.queries, 95)}/${Math.max(...rs.map((m) => m.queries))}  model calls avg ${(rs.reduce((n, m) => n + m.modelCalls, 0) / rs.length).toFixed(2)} max ${Math.max(...rs.map((m) => m.modelCalls))}  tokens avg ${Math.round(rs.reduce((n, m) => n + m.promptTokens + m.completionTokens, 0) / rs.length)}  prompt max ${Math.max(...rs.map((m) => m.maxPromptChars))}  wall p50/p95 ${p((m) => m.wallMs, 50)}/${p((m) => m.wallMs, 95)} ms`);
    }
  };
  out("\n=== cost per turn ===");
  for (const phase of ["base-first", "base-steady", "scale-first", "scale-steady", "long"]) table(phase);
  out(`\n${all.length} metered turns; ${detectorHits} detector hits; ${failures.length} failure(s); total ${Math.round((Date.now() - started) / 1000)} s`);
  if (failures.length) { out("\nFAIL:\n- " + failures.slice(0, 40).join("\n- ")); process.exitCode = 1; }
  else out("r10 perf: all budgets hold");
  clearTimeout(watchdog);
  await h.db.close();
  process.exit(process.exitCode ?? 0);
}
main().catch((error) => { console.error(error); process.exit(1); });
