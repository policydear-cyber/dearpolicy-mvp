/** Where a chat answer's time goes, stage by stage, through the app's own code: the POST route's checks and enqueue, the
 * chat drain's claim, the job's preparation, the simple chat's reads (library, history, benefit table, spend check), the
 * model call, the server checks, and the save. Made-up household in a disposable local database.
 *
 *   Free (no model): DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgresql://root@/dp_suites?host=/var/run/postgresql DATABASE_SSL=off \
 *                    node --import tsx scripts/simple-answer/latency.ts [--reps 5] [--replay <recorded.json>]
 *   Paid (real model, synthetic household only): add --paid --max-usd <cap> --out <file.json>
 *   Options: --rtt <ms> added to every query (the hosted database's distance), --poll-ms <ms> the browser's check
 *   interval (default: app/chat/page.tsx CHAT_POLL_MS), --seed <n> another made-up library (a cold prompt cache),
 *   --only D1,S1,S1+ some turns, --effort <level> a what-if on the model's effort (the app's setting is unchanged).
 *
 * Columns: routeMs (POST: checks and enqueue), claimPrepareMs (drain claim and the job's preparation), loadMs (library,
 * history, table, spend check), modelMs, ledgerMs (usage row), checkMs (server checks), saveFinishMs, serverTotalMs,
 * shownMs (when the browser's next check shows it).
 *
 * The free run answers with a stand-in model that returns at once (or replays answers recorded by a paid run), so every
 * millisecond it reports is the application's own. A paid call is admitted only while the run's spend, priced at a
 * maximum-length answer with no cache hit, stays under --max-usd. Prints one JSON line per turn and a table. */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const PAID = argv.includes("--paid");
const REPS = Number(arg("--reps") ?? (PAID ? 1 : 5));
/** When the browser shows the answer (ms after send): app/chat/page.tsx waitForJob checks the job as soon as the POST
 * returns, then waits CHAT_POLL_MS after each check's reply. Each check is taken to cost --poll-rtt ms (default 60). */
const POLL_MS = Number(arg("--poll-ms") ?? (readFileSync("app/chat/page.tsx", "utf8").match(/const CHAT_POLL_MS=(\d+)/)?.[1] ?? 1000));
const POLL_RTT = Number(arg("--poll-rtt") ?? 60);
function shownAt(postReturned: number, done: number): number {
  let t = postReturned;
  for (;;) { if (t + POLL_RTT / 2 >= done) return Math.round(t + POLL_RTT); t += POLL_RTT + POLL_MS; }
}
/** A round trip added to every database query (ms), standing in for the hosted database's network distance. */
const RTT = Number(arg("--rtt") ?? 0);
const MAX_USD = Number(arg("--max-usd") ?? 0);
if (PAID && !(MAX_USD > 0)) throw new Error("--paid needs --max-usd");
// Free runs: no real key is ever in reach; the app's key check sees a placeholder that the stand-in never sends.
if (!PAID) { for (const k of Object.keys(process.env)) if (/ANTHROPIC/i.test(k)) delete process.env[k]; process.env.DEARPOLICY_ANTHROPIC_KEY = "stand-in"; }
const url = process.env.DATABASE_URL ?? "";
if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) throw new Error("needs DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL");

const A = randomUUID();
Object.assign(process.env, { DEARPOLICY_SIMPLE_CHAT: "1", DEARPOLICY_BENEFIT_TABLE: "1", DEARPOLICY_ALPHA_ACCOUNTS: A, JOB_DRAIN_ON_REQUEST: "1" });
for (const k of ["DEARPOLICY_SIMPLE_CHAT_ALL_ACCOUNTS", "DEARPOLICY_BENEFIT_TABLE_ALL_ACCOUNTS", "DEARPOLICY_SIMPLE_CHAT_MODEL", "VERCEL", "VERCEL_ENV"]) delete process.env[k];

type Q = { sql: string; t0: number; t1: number; stage: string };
const stageOf = new AsyncLocalStorage<string>();
const log: Q[] = [];
const now = () => performance.now();

// ---- made-up household: three people, four documents (about 150 pages), benefit-table readings quoting their pages ----
const WORDS = "the insured person shall be entitled to the benefits set out in the schedule subject to the terms and conditions of this policy where the company is satisfied that the claim is valid and all documents requested have been provided within the time allowed".split(" ");
let seed = Number(arg("--seed") ?? 11); const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const filler = (n: number) => Array.from({ length: n }, (_, i) => Array.from({ length: 10 + Math.floor(rnd() * 12) }, () => WORDS[Math.floor(rnd() * WORDS.length)]).join(" ") + ` (${i + 1}).`).join("\n");
type Ben = { benefit: string; pays: string; value: number | null; percentOf?: string | null; baseAmount?: number | null; baseQuote?: string | null; maxDays?: number | null; page: number; quote: string; conditions?: string[] };
type Doc = { id: string; name: string; product: string; insurer: string; type: string; role: string; kind: string; people: string[]; pages: string[]; covers: { person: string; cover: string; sumInsured: number | null; page: number; quote: string }[]; benefits: Ben[] };
const PEOPLE: [string, string][] = [["Daniel Tan", "self"], ["Mei Tan", "spouse"], ["Grace Tan", "child"]];
function household(): Doc[] {
  // About one wording page in five prints a rule that can stop a payment, so it is sent with the table (pagesToSend).
  let n = 0;
  const page = (head: string, lines = 32) => `${head}\n${++n % 5 === 0 ? "The exclusions below apply to every benefit.\n" : ""}${filler(lines)}`;
  const hosp: Doc = { id: randomUUID(), name: "HealthShield Gold schedule.pdf", product: "HealthShield Gold", insurer: "Example Assurance", type: "Health", role: "personal_schedule", kind: "personal_proof",
    people: PEOPLE.map((p) => p[0]), pages: [], covers: [], benefits: [] };
  hosp.pages.push("POLICY SCHEDULE - HealthShield Gold\nInsured persons\nDaniel Tan\tPlan A\tAnnual limit S$1,000,000\nMei Tan\tPlan A\tAnnual limit S$1,000,000\nGrace Tan\tPlan A\tAnnual limit S$1,000,000\nPeriod of insurance 01/03/2026 to 28/02/2027");
  hosp.pages.push("SCHEDULE OF BENEFITS (PLAN A)\nDaily ward and treatment charges\tAs charged\nIntensive care unit charges\tAs charged\nSurgical benefits\tAs charged\nPre-hospital treatment (up to 180 days before admission)\tAs charged\nPost-hospital treatment (up to 365 days after discharge)\tAs charged\nEmergency outpatient treatment for accidental injury\tUp to S$2,000 per accident\nDeductible (per policy year)\tS$3,500\nCo-insurance\t10%");
  for (let i = 3; i <= 40; i++) hosp.pages.push(page(i === 12 ? "GENERAL EXCLUSIONS\nWaiting period: no benefit is payable for any illness that first appears within 30 days of the cover start date." : `POLICY WORDING page ${i}`));
  for (const [p] of PEOPLE) hosp.covers.push({ person: p, cover: "Hospital", sumInsured: 1000000, page: 1, quote: `${p}\tPlan A\tAnnual limit S$1,000,000` });
  hosp.benefits.push({ benefit: "Daily ward and treatment charges", pays: "as_charged", value: null, page: 2, quote: "Daily ward and treatment charges\tAs charged" },
    { benefit: "Intensive care unit charges", pays: "as_charged", value: null, page: 2, quote: "Intensive care unit charges\tAs charged" },
    { benefit: "Surgical benefits", pays: "as_charged", value: null, page: 2, quote: "Surgical benefits\tAs charged" },
    { benefit: "Emergency outpatient treatment for accidental injury", pays: "up_to", value: 2000, page: 2, quote: "Emergency outpatient treatment for accidental injury\tUp to S$2,000 per accident" },
    { benefit: "Deductible (per policy year)", pays: "amount", value: 3500, page: 2, quote: "Deductible (per policy year)\tS$3,500" });
  const pa: Doc = { id: randomUUID(), name: "FamilyGuard PA certificate.pdf", product: "FamilyGuard Personal Accident", insurer: "Example General", type: "Personal Accident", role: "personal_schedule", kind: "personal_proof",
    people: PEOPLE.map((p) => p[0]), pages: [], covers: [], benefits: [] };
  pa.pages.push("CERTIFICATE OF INSURANCE - FamilyGuard Personal Accident\nDaniel Tan\tSum insured S$200,000\nMei Tan\tSum insured S$200,000\nGrace Tan\tSum insured S$50,000\nPeriod of insurance 15/01/2026 to 14/01/2027");
  pa.pages.push("TABLE OF BENEFITS\nAccidental death or permanent disablement\t100% of sum insured\nMedical expenses due to an accident\tUp to S$3,000 per accident\nHospital cash after an accident\tS$100 per day, up to 30 days\nFracture of arm or leg (closed)\tS$1,500\nFracture of arm or leg (open)\tS$3,000\nAmbulance fees\tUp to S$500 per accident");
  for (let i = 3; i <= 30; i++) pa.pages.push(page(i === 9 ? "CLAIMS\nWritten notice of a claim must be given within 30 days of the accident." : `POLICY WORDING page ${i}`));
  for (const [p, , s] of [["Daniel Tan", "", 200000], ["Mei Tan", "", 200000], ["Grace Tan", "", 50000]] as [string, string, number][])
    pa.covers.push({ person: p, cover: "Personal Accident", sumInsured: s, page: 1, quote: `${p}\tSum insured S$${s.toLocaleString("en-US")}` });
  pa.benefits.push({ benefit: "Accidental death or permanent disablement", pays: "percent", value: 100, percentOf: "sum_insured", page: 2, quote: "Accidental death or permanent disablement\t100% of sum insured" },
    { benefit: "Medical expenses due to an accident", pays: "up_to", value: 3000, page: 2, quote: "Medical expenses due to an accident\tUp to S$3,000 per accident" },
    { benefit: "Hospital cash after an accident", pays: "per_day", value: 100, maxDays: 30, page: 2, quote: "Hospital cash after an accident\tS$100 per day, up to 30 days" },
    { benefit: "Fracture of arm or leg (closed)", pays: "amount", value: 1500, page: 2, quote: "Fracture of arm or leg (closed)\tS$1,500" },
    { benefit: "Fracture of arm or leg (open)", pays: "amount", value: 3000, page: 2, quote: "Fracture of arm or leg (open)\tS$3,000" },
    { benefit: "Ambulance fees", pays: "up_to", value: 500, page: 2, quote: "Ambulance fees\tUp to S$500 per accident" });
  const life: Doc = { id: randomUUID(), name: "Term life policy.pdf", product: "SecureTerm 25", insurer: "Example Life", type: "Life", role: "personal_schedule", kind: "personal_proof",
    people: ["Daniel Tan"], pages: [], covers: [], benefits: [] };
  life.pages.push("POLICY SCHEDULE - SecureTerm 25\nLife assured: Daniel Tan\tSum assured S$500,000\nPolicy term 25 years from 01/06/2020");
  life.pages.push("BENEFITS\nDeath benefit\tS$500,000\nTotal and permanent disability benefit\tS$500,000");
  for (let i = 3; i <= 45; i++) life.pages.push(page(`POLICY CONDITIONS page ${i}`));
  life.covers.push({ person: "Daniel Tan", cover: "Term Life", sumInsured: 500000, page: 1, quote: "Life assured: Daniel Tan\tSum assured S$500,000" });
  life.benefits.push({ benefit: "Death benefit", pays: "amount", value: 500000, page: 2, quote: "Death benefit\tS$500,000" },
    { benefit: "Total and permanent disability benefit", pays: "amount", value: 500000, page: 2, quote: "Total and permanent disability benefit\tS$500,000" });
  const travel: Doc = { id: randomUUID(), name: "Travel insurance.pdf", product: "Voyager Annual", insurer: "Example General", type: "Travel", role: "personal_schedule", kind: "personal_proof",
    people: PEOPLE.map((p) => p[0]), pages: [], covers: [], benefits: [] };
  travel.pages.push("CERTIFICATE - Voyager Annual (Family)\nDaniel Tan, Mei Tan, Grace Tan\tFamily plan\tOverseas medical expenses up to S$500,000\nPeriod 01/02/2026 to 31/01/2027");
  travel.pages.push("SUMMARY OF COVER\nOverseas medical expenses\tUp to S$500,000\nTrip cancellation\tUp to S$10,000\nBaggage delay\tS$100 for every 6 hours, up to S$1,000");
  for (let i = 3; i <= 32; i++) travel.pages.push(page(`TRAVEL WORDING page ${i}`));
  for (const [p] of PEOPLE) travel.covers.push({ person: p, cover: "Travel", sumInsured: 500000, page: 1, quote: "Daniel Tan, Mei Tan, Grace Tan\tFamily plan\tOverseas medical expenses up to S$500,000" });
  travel.benefits.push({ benefit: "Overseas medical expenses", pays: "up_to", value: 500000, page: 2, quote: "Overseas medical expenses\tUp to S$500,000" },
    { benefit: "Trip cancellation", pays: "up_to", value: 10000, page: 2, quote: "Trip cancellation\tUp to S$10,000" });
  return [hosp, pa, life, travel];
}

async function seed_(docs: Doc[]) {
  const { query } = await import("@/lib/db/client");
  const { coverKeyOf, sectionKeyOf } = await import("@/lib/benefit-table/assemble");
  await query("INSERT INTO accounts(id,name) VALUES($1,'Made-up household (latency)')", [A]);
  const ids: Record<string, string> = {};
  for (const [n, r] of PEOPLE) ids[n] = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,$3) RETURNING id", [A, n, r])).rows[0].id;
  for (const d of docs) {
    await query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_type,document_role,processing_status,original_filename,storage_key,quarantine_status,file_hash,page_count)
      VALUES($1,$2,$3,$4,$5,$6,$7,'ready',$8,$9,'scan_clean',$10,$11)`, [d.id, A, ids[d.people[0]], d.insurer, d.product, d.type, d.role, d.name, "k/" + d.id, "sha256:" + d.id, d.pages.length]);
    for (const p of d.people) await query("INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)", [d.id, ids[p], A]);
    for (const [i, t] of d.pages.entries()) await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text,extraction_method) VALUES($1,$2,$3,$4,'native')", [A, d.id, i + 1, t]);
    const reading = { document: { document: { kind: d.kind, product: d.product, insurer: d.insurer, namedPeople: d.people, plan: null, periodFrom: null, periodTo: null },
      covers: d.covers.map((c) => ({ person: c.person, product: d.product, cover: c.cover, plan: null, riderOf: null, policyNumber: null, sumInsured: c.sumInsured, premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: c.page, quote: c.quote })),
      benefits: d.benefits.map((b) => ({ section: null, column: null, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], ...b })) }, pages: [] };
    await query("INSERT INTO benefit_readings(policy_id,account_id,reading,model,prompt_version) VALUES($1,$2,$3,'made-up','latency')", [d.id, A, JSON.stringify(reading)]);
    await query("INSERT INTO benefit_links(account_id,section_key,cover_key,why,chosen_by) VALUES($1,$2,$3,'made up','household')",
      [A, sectionKeyOf(d.id, { section: null, column: null }), coverKeyOf({ product: d.product, cover: d.covers[0].cover, plan: null })]);
  }
  return ids;
}

// ---- the questions: direct answers and scenarios, each a new chat, then one follow-up in the same chat ----
const QUESTIONS: { id: string; kind: "direct" | "scenario"; text: string; followUp?: string }[] = [
  { id: "D1", kind: "direct", text: "What's my hospital cover?", followUp: "And what is the deductible?" },
  { id: "D2", kind: "direct", text: "How much is Daniel's life cover?" },
  { id: "S1", kind: "scenario", text: "Grace broke her arm, what can we claim?", followUp: "It was a closed fracture and she spent 2 nights in hospital." },
  { id: "S2", kind: "scenario", text: "Mei was in a car accident yesterday and went to A&E by ambulance. What can we claim?" },
];

async function main() {
  const { pool, query } = await import("@/lib/db/client");
  // Every database round trip, with the stage it ran in.
  const wrap = <T extends { query: (...a: any[]) => any }>(target: T) => {
    const orig = target.query.bind(target);
    (target as any).query = (...a: any[]) => {
      const q: Q = { sql: String(typeof a[0] === "string" ? a[0] : a[0]?.text ?? "").replace(/\s+/g, " ").slice(0, 90), t0: now(), t1: 0, stage: stageOf.getStore() ?? "?" };
      const r = RTT > 0 ? new Promise((done) => setTimeout(done, RTT)).then(() => orig(...a)) : orig(...a);
      return r && typeof r.then === "function" ? r.then((x: unknown) => { q.t1 = now(); log.push(q); return x; }, (e: unknown) => { q.t1 = now(); log.push(q); throw e; }) : r;
    };
  };
  wrap(pool as any);
  const connect = pool.connect.bind(pool);
  (pool as any).connect = (...a: any[]) => {
    if (typeof a[0] === "function") return (connect as (...x: any[]) => unknown)(...a);
    return (connect() as Promise<any>).then((c) => { if (!c.__wrapped) { wrap(c); c.__wrapped = true; } return c; });
  };

  // The model: the app's own Anthropic request, timed. Free runs answer at once (or replay a paid run's answers).
  const recorded: Record<string, unknown> = arg("--replay") ? JSON.parse(readFileSync(arg("--replay")!, "utf8")).answers : {};
  const answers: Record<string, unknown> = {};
  const calls: { key: string; ms: number; ttftMs: number | null; usage: any; usd: number; stop: string | null }[] = [];
  let currentKey = "", spent = 0;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { priceFor } = await import("@/lib/ai/providers");
  const { callUsd, MAX_OUTPUT_TOKENS } = await import("@/lib/simple-chat/model");
  const price = priceFor({ provider: "anthropic", model: "claude-sonnet-5-5" })!;
  const proto = Object.getPrototypeOf(new Anthropic({ apiKey: "unused", baseURL: "https://api.anthropic.com" }).beta.messages);
  const origStream = proto.stream;
  let modelWindow: { t0: number; t1: number } | null = null;
  proto.stream = function (body: any, opts: any) {
    const key = currentKey, t0 = now();
    if (!PAID) {
      return { finalMessage: async () => { modelWindow = { t0, t1: now() }; const json = recorded[key] ?? { bottomLine: "Here is what your documents say.", statements: [], nextSteps: [], question: null };
        calls.push({ key, ms: 0, ttftMs: null, usage: { requestChars: JSON.stringify(body).length }, usd: 0, stop: "end_turn" });
        return { content: [{ type: "text", text: JSON.stringify(json) }], stop_reason: "end_turn", model: "stand-in", usage: { input_tokens: 0, output_tokens: 0 } }; } };
    }
    // Admitted only if a maximum-length answer with no cache hit still fits under the cap.
    const worst = callUsd(price, { input: Math.ceil(JSON.stringify(body).length / 2.5), cacheWrite: 0, cacheRead: 0, output: MAX_OUTPUT_TOKENS }, 1.25);
    if (spent + worst > MAX_USD) throw new Error(`spend cap: ${spent.toFixed(4)} spent, this call could cost ${worst.toFixed(4)}`);
    // --effort: what-if only (the app's own setting is unchanged); the answer is still checked and saved as usual.
    if (arg("--effort")) body = { ...body, output_config: { ...body.output_config, effort: arg("--effort") } };
    const s = origStream.call(this, body, opts);
    let ttft: number | null = null;
    s.on?.("text", () => { if (ttft == null) ttft = now() - t0; });
    const fm = s.finalMessage.bind(s);
    s.finalMessage = async () => {
      const m = await fm();
      const u = { input: m.usage.input_tokens ?? 0, output: m.usage.output_tokens ?? 0, cacheRead: m.usage.cache_read_input_tokens ?? 0, cacheWrite: m.usage.cache_creation_input_tokens ?? 0 };
      const usd = callUsd(price, u, 1.25); spent += usd;
      modelWindow = { t0, t1: now() };
      calls.push({ key, ms: Math.round(now() - t0), ttftMs: ttft == null ? null : Math.round(ttft), usage: u, usd, stop: m.stop_reason });
      const text = m.content.flatMap((b: any) => (b.type === "text" && b.text ? [b.text] : [])).join("");
      try { answers[key] = JSON.parse(text); } catch { /* recorded as not parsed */ }
      return m;
    };
    return s;
  };

  const docs = household();
  const ids = await seed_(docs);
  console.error(`household ${A}: ${docs.length} documents, ${docs.reduce((n, d) => n + d.pages.length, 0)} pages, ${docs.reduce((n, d) => n + d.pages.join("\n").length, 0)} characters`);
  const { overSpendCap } = await import("@/lib/ai/ledger");
  const { activePredicate } = await import("@/lib/lifecycle/scopes");
  const { enqueueChat } = await import("@/lib/chat/jobs");
  const { drainChatOnce, resetChatDrainStateForTests } = await import("@/lib/jobs/request-drain");

  const rows: any[] = [];
  /** One message as the browser sends it: the POST route's work, then the chat drain that its after() starts. */
  async function send(q: string, key: string, conversation?: { id: string; rev: number }) {
    log.length = 0; modelWindow = null; currentKey = key;
    const t0 = now();
    const posted = await stageOf.run("route", async () => {
      await query(`SELECT id FROM family_members WHERE account_id=$1 AND ${activePredicate()} LIMIT 1`, [A]);
      if (await overSpendCap(A)) throw new Error("over cap");
      return enqueueChat({ accountId: A, familyMemberId: null, scope: "family", question: q, conversationId: conversation?.id ?? null, conversationRevision: conversation?.rev } as never);
    });
    const tRoute = now();
    resetChatDrainStateForTests();
    const drained = await stageOf.run("job", () => drainChatOnce());
    const tDone = now();
    if (!drained.ran) throw new Error("the drain did not run the chat job: " + JSON.stringify(drained));
    const job = (await query<{ status: string; error: string | null }>("SELECT status,error FROM chat_analysis_jobs WHERE id=$1", [posted.jobId])).rows[0];
    if (job.status !== "complete") throw new Error(`job ${job.status}: ${job.error}`);
    const conv = (await query<{ state: any; revision: number }>("SELECT state,revision FROM chat_conversations WHERE id=$1", [posted.conversationId])).rows[0];
    const result = (await query<{ result_json: any }>("SELECT result_json FROM chat_analysis_jobs WHERE id=$1", [posted.jobId])).rows[0].result_json;
    const turn = conv.state.simpleChat.turns.at(-1);
    const mw = modelWindow as { t0: number; t1: number } | null;
    const loadStart = mw ? mw.t0 - turn.timing.loadMs : tRoute;
    const ledger = mw ? Math.max(0, turn.timing.modelMs - (mw.t1 - mw.t0)) : 0;
    const checksEnd = mw ? mw.t1 + ledger + turn.timing.checkMs : tDone;
    const inWin = (a: number, b: number) => log.filter((x) => x.t0 >= a && x.t0 < b);
    const r = {
      q: key, kind: key.startsWith("D") ? "direct" : "scenario",
      routeMs: Math.round(tRoute - t0), routeQueries: inWin(t0, tRoute).length,
      claimPrepareMs: Math.round(loadStart - tRoute), claimPrepareQueries: inWin(tRoute, loadStart).length,
      loadMs: turn.timing.loadMs, loadQueries: mw ? inWin(loadStart, mw.t0).length : null,
      modelMs: mw ? Math.round(mw.t1 - mw.t0) : null,
      ledgerMs: mw ? Math.round(ledger) : null,
      checkMs: turn.timing.checkMs,
      saveFinishMs: mw ? Math.round(tDone - checksEnd) : null,
      saveFinishQueries: mw ? inWin(checksEnd, tDone).length : null,
      ledgerQueries: mw ? inWin(mw.t1, mw.t1 + ledger).length : null,
      serverTotalMs: Math.round(tDone - t0), shownMs: shownAt(tRoute - t0, tDone - t0), queries: log.length,
      dbMs: Math.round(log.reduce((n, x) => n + (x.t1 - x.t0), 0)),
      slowest: [...log].sort((a, b) => (b.t1 - b.t0) - (a.t1 - a.t0)).slice(0, 3).map((x) => `${Math.round(x.t1 - x.t0)}ms ${x.sql.slice(0, 60)}`),
      left: turn.report?.sentencesLeftOut?.length ?? null,
    };
    rows.push(r); console.log(JSON.stringify(r));
    return { id: posted.conversationId as string, rev: result?.answer?.conversationRevision ?? conv.revision };
  }

  if (argv.includes("--debug")) { const { askContextualDearPolicy } = await import("@/lib/chat/workflow"); try { await askContextualDearPolicy({ accountId: A, familyMemberId: null, scope: "family", question: "What's my hospital cover?" } as never); } catch (e) { console.error("DEBUG", e); } }
  const only = arg("--only")?.split(",");
  try {
    for (let rep = 0; rep < REPS; rep++) for (const q of only ? only.filter((id) => !id.endsWith("+")).map((id) => QUESTIONS.find((x) => x.id === id)!) : QUESTIONS) {
      const c = await send(q.text, q.id);
      if (q.followUp && (!only || only.includes(q.id + "+"))) await send(q.followUp, q.id + "+", c);
    }
  } finally {
    if (PAID) console.log(`model calls: ${JSON.stringify(calls)}\nspent US$${spent.toFixed(4)}`);
    await cleanUp();
  }
  async function cleanUp() {
  // Remove the made-up household (cascade where the schema has it).
  for (const t of ["chat_analysis_jobs", "chat_messages", "chat_conversations", "benefit_links", "benefit_readings", "policy_pages", "policy_members", "model_usage"]) await query(`DELETE FROM ${t} WHERE account_id=$1`, [A]).catch(() => undefined);
  await query("DELETE FROM background_jobs WHERE account_id=$1", [A]).catch(() => undefined);
  await query("DELETE FROM policies WHERE account_id=$1", [A]).catch(() => undefined);
  await query("DELETE FROM family_members WHERE account_id=$1", [A]).catch(() => undefined);
  await query("DELETE FROM accounts WHERE id=$1", [A]).catch(() => undefined);
  void ids;
  }

  const med = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
  const keys = ["routeMs", "claimPrepareMs", "loadMs", "modelMs", "ledgerMs", "checkMs", "saveFinishMs", "serverTotalMs", "shownMs", "queries", "dbMs"];
  console.log(["turn", ...keys].join("\t"));
  for (const k of [...new Set(rows.map((r) => r.q))]) { const rs = rows.filter((r) => r.q === k); console.log([k + (rs.length > 1 ? ` (median of ${rs.length}, first ${rs[0].serverTotalMs}ms)` : ""), ...keys.map((x) => med(rs.map((r) => r[x])))].join("\t")); }
  if (!PAID) console.log("request sizes:", JSON.stringify(calls.slice(0, 6).map((c) => [c.key, c.usage.requestChars])));
  if (PAID) {
    console.log(`spent US$${spent.toFixed(4)} (list price, Sonnet 5.5: input $${price.input}/M, output $${price.output}/M, cache read $${price.cachedInput}/M, cache write 1.25x input)`);
    const out = arg("--out"); if (out) writeFileSync(out, JSON.stringify({ answers, calls, spent, rows }, null, 2));
  }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
