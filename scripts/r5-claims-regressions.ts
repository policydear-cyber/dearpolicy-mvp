/**
 * Round 5 claim-side regressions, from the post-launch exploratory test with
 * realistic Singapore documents (/home/user/explore: ShieldCare Premier, PA
 * Guardian, TravelSafe Annual Family, TermSecure 20 with a critical-illness
 * accelerator; household Tan Mei Ling (self), Lim Wei Jie (spouse), Lim Xin
 * Yi (child), Wong Siew Lan (parent)). The benefit rows are the ones those
 * documents print. The real chat route runs on PGlite with the deterministic
 * model stand-in; every other network call throws.
 *
 * BLOCKER -- a claim offers only its own benefit families, and travel cover
 * only with trip context: colon cancer in Singapore never offers overseas
 * medical; a 13-hour flight delay offers travel delay only; a road-accident
 * death with an unknown place never marks travel accidental death likely; a
 * local fracture never cites the travel policy.
 * MAJOR -- mid-interview corrections and fillers, typed "i dont know" / "one
 * night", hospital names kept, "and his wife?", no-family households, and no
 * re-asking of facts given in the first message.
 * MINOR -- no mangled amount-hidden quotes, one active-status line, no
 * duplicate document requests, schedule sources labelled as schedules, no
 * hospital-cash documents under a Shield plan, condolence and first steps
 * after a death, and a child's own table column.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { NextRequest } from "next/server";
import type { ChatAnswer } from "@/types";

process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
process.env.E2E_RUN_ID = "r5claims";
process.env.DEV_AUTH_ENABLED = "1";
process.env.MODEL_PRESET = process.env.MODEL_PRESET || "openai";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-not-used";
delete process.env.PINECONE_API_KEY;
const ACCOUNT = "00000000-0000-0000-0000-00000000c005";
const EMPTY_ACCOUNT = "00000000-0000-0000-0000-00000000c006";
process.env.DEV_ACCOUNT_ID = ACCOUNT;
const uuid = (n: number) => "50000000-0000-4000-8000-" + String(n).padStart(12, "0");
const MEILING = uuid(1), WEIJIE = uuid(2), XINYI = uuid(3), SIEWLAN = uuid(4);
const vec = "[" + Array.from({ length: 1024 }, (_, j) => (j === 0 ? 1 : 0)).join(",") + "]";

type Row = { name: string; printed: string; kind: string; value: number | null; traits: string[]; requires?: string[]; factKey?: string | null; tier?: string | null };
type Plan = { key: string; members: { id: string; tier?: string | null }[]; insurer: string; product: string; type: string; role: string; category: string;
  sum: number | null; heading: string; rows: Row[]; start: string; end: string };
const r = (name: string, printed: string, kind: string, value: number | null, traits: string[], requires: string[] = [], factKey: string | null = null, tier: string | null = null): Row =>
  ({ name, printed, kind, value, traits, requires, factKey, tier });
const PLANS: Plan[] = [
  { key: "shield", members: [{ id: MEILING }], insurer: "Merlion Mutual Assurance (fictitious)", product: "ShieldCare Premier", type: "Integrated Shield Plan", role: "personal_schedule",
    category: "Hospitalisation", sum: 2000000, heading: "ShieldCare Plus Rider - Schedule of Benefits", start: "2026-04-01", end: "2027-03-31", rows: [
      r("Hospital room and board (private hospital)", "As charged", "none", null, ["hospitalisation"]),
      r("Surgical fees", "As charged", "none", null, ["hospitalisation", "medical_expense"]),
      r("Ambulance fees", "Up to S$500 per admission", "expense_cap", 500, ["hospitalisation", "medical_expense"], [], "ambulanceBill")] },
  { key: "pa", members: [{ id: XINYI }], insurer: "Orchid Assurance (fictitious)", product: "PA Guardian", type: "Personal Accident", role: "personal_schedule",
    category: "Personal Accident", sum: 100000, heading: "PA Guardian - Policy Schedule", start: "2026-01-01", end: "2026-12-31", rows: [
      r("Fracture benefit", "S$1,000 per accident (S$2,000 for skull or spine)", "fixed", 1000, ["accident", "bodily_injury"], ["accident"]),
      r("Accidental medical expenses", "Up to S$2,500 per accident, including traditional Chinese medicine", "expense_cap", 2500, ["accident", "medical_expense"], ["accident"]),
      r("Hospital cash for accidents", "S$100 per day, up to 30 days", "daily", 100, ["accident", "hospitalisation"], ["accident"], "hospitalNights")] },
  { key: "travel", members: [{ id: WEIJIE, tier: "Adult" }, { id: XINYI, tier: "Child" }, { id: MEILING, tier: "Adult" }], insurer: "Sentosa Shield Travel (fictitious)",
    product: "TravelSafe Annual Family", type: "Travel", role: "certificate", category: "Travel", sum: null, heading: "Schedule of Benefits - per insured person",
    start: "2026-07-01", end: "2027-06-30", rows: [
      r("1 Overseas medical expenses", "S$500,000", "expense_cap", 500000, ["medical_expense", "travel_disruption", "illness", "accident"], [], null, "Adult"),
      r("1 Overseas medical expenses", "S$250,000", "expense_cap", 250000, ["medical_expense", "travel_disruption", "illness", "accident"], [], null, "Child"),
      r("3 Travel delay (for every full 6 hours of delay)", "S$100", "fixed", 100, ["delay", "travel_disruption"], [], "flightDelayHours"),
      r("4 Baggage delay (after 6 hours on arrival overseas)", "S$200", "fixed", 200, ["delay", "travel_disruption"]),
      r("6 Trip cancellation", "S$10,000", "expense_cap", 10000, ["travel_disruption"]),
      r("7 Accidental death and permanent disablement", "S$200,000", "fixed", 200000, ["death", "accident", "disability"], ["accident"]),
      r("8 COVID-19 overseas medical expenses", "S$150,000", "expense_cap", 150000, ["medical_expense", "illness", "travel_disruption"])] },
  { key: "term", members: [{ id: WEIJIE }], insurer: "Straits Heritage Life (fictitious)", product: "TermSecure 20", type: "Term Life", role: "certificate",
    category: "Critical Illness", sum: 200000, heading: "Certificate of Renewal - TermSecure 20", start: "2026-06-12", end: "2027-06-11", rows: [
      r("Death benefit", "S$500,000", "fixed", 500000, ["death"], ["death"]),
      r("Critical illness accelerator rider (37 critical illnesses, late stage)", "S$200,000 (accelerates the death benefit)", "fixed", 200000, ["illness", "diagnosis"])] },
];

function visibleText(a: ChatAnswer): string {
  const parts: string[] = [a.summary, ...a.details, ...a.nextSteps];
  for (const q of a.questions ?? []) parts.push(q.text, q.why ?? "", ...(q.options ?? []));
  for (const i of a.claimItems ?? []) parts.push(i.title, i.reason, ...(i.conditions ?? []), i.amountText ?? "");
  for (const p of a.factFinding ?? []) parts.push(...p.missingDocuments);
  return parts.filter(Boolean).join("\n");
}
type Result = { name: string; ok: boolean; failures: string[]; transcript: string[] };
const results: Result[] = [];

async function main() {
  const keepAlive = setInterval(() => undefined, 1000);
  const watchdog = setTimeout(() => { console.error("WATCHDOG: no completion in 165 s"); process.exit(3); }, 165_000);
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of ["sql/schema.sql", "sql/benefit-catalog.sql", "sql/model-usage.sql", "sql/coverage-ledger.sql", "sql/background-jobs.sql",
    "sql/household-rls.sql", "sql/lifecycle.sql", "sql/cover-conditions.sql", "sql/model-provenance.sql", "sql/claim-evidence.sql", "sql/claim-composition.sql", "sql/chat-upgrade.sql"]) {
    try { await db.exec(await readFile(path.resolve(file), "utf8")); } catch (e) { console.log("SQL note: " + file + " not applied (" + (e as Error).message.slice(0, 90) + ")"); }
  }
  // The ingest owner's Round 5 columns (additive): a table column per row, a column per insured person.
  await db.exec("ALTER TABLE policy_benefits ADD COLUMN IF NOT EXISTS tier text; ALTER TABLE policy_members ADD COLUMN IF NOT EXISTS benefit_tier text;");
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

  for (const account of [ACCOUNT, EMPTY_ACCOUNT]) {
    await db.query("INSERT INTO accounts(id,name) VALUES($1,'Round 5 household')", [account]);
    await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [account]);
  }
  for (const [id, name, preferred, rel] of [[MEILING, "Tan Mei Ling", "Mei Ling", "self"], [WEIJIE, "Lim Wei Jie", "Wei Jie", "spouse"],
    [XINYI, "Lim Xin Yi", "Xin Yi", "child"], [SIEWLAN, "Wong Siew Lan", "Siew Lan", "parent"]] as const)
    await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,$3,$4,$5)", [id, ACCOUNT, name, preferred, rel]);
  const docOf: Record<string, string> = {};
  let n = 100;
  for (const plan of PLANS) {
    const id = uuid(n++); docOf[plan.key] = id;
    const names = plan.members.map((m) => ({ [MEILING]: "Tan Mei Ling", [WEIJIE]: "Lim Wei Jie", [XINYI]: "Lim Xin Yi (child)", [SIEWLAN]: "Wong Siew Lan" })[m.id]).join("; ");
    const pages = [
      plan.product + " Policy Schedule Insured: " + names + " Policy number " + plan.key.toUpperCase() + "-26 Period " + plan.start + " to " + plan.end + (plan.sum ? " Sum Insured S$" + plan.sum.toLocaleString("en-US") : ""),
      plan.heading + " " + plan.rows.map((x) => x.name + (x.tier ? " (" + x.tier + ")" : "") + " " + x.printed).join(" ") + " Page 2 of 2",
    ];
    await db.query("INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,effective_date,extracted_json,quarantine_status,renewal_or_expiry_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,95,'ready',$9,$9,$10,$11::jsonb,'scan_clean',$12)",
      [id, ACCOUNT, plan.members[0].id, plan.insurer, plan.product, plan.key.toUpperCase() + "-26", plan.type, plan.role, plan.key + ".pdf", plan.start, JSON.stringify({ productsMentioned: [plan.product] }), plan.end]);
    for (const m of plan.members) await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,benefit_tier) VALUES($1,$2,$3,$4)", [id, m.id, ACCOUNT, m.tier ?? null]);
    for (const [i, text] of pages.entries()) {
      await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [ACCOUNT, id, i + 1, text]);
      await db.query("INSERT INTO policy_chunks(id,account_id,family_member_id,policy_id,page_start,page_end,text,embedding) VALUES($1,$2,$3,$4,$5,$5,$6,$7::vector)", [uuid(n++), ACCOUNT, plan.members[0].id, id, i + 1, text, vec]);
    }
    for (const m of plan.members) await db.query("INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,evidence_verified,confirmed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,true,true)",
      [uuid(n++), ACCOUNT, id, m.id, plan.category, plan.sum, plan.sum ? "SGD" : null, plan.product, pages[0]]);
    for (const row of plan.rows)
      await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,requires,formula_kind,formula_value,currency,fact_key,source_page,quote,conditions,requirements,needs_review,tier) VALUES($1,$2,$3,$4,$5::text[],$6::text[],$7,$8,'SGD',$9,2,$10,'[]'::jsonb,'[]'::jsonb,false,$11)",
        [ACCOUNT, id, plan.product, row.name, row.traits, row.requires ?? [], row.kind, row.value, row.factKey ?? null, row.name + " " + row.printed, row.tier ?? null]);
  }
  await db.query("UPDATE policies SET benefits_indexed_at=now(), conditions_indexed_at=now(), ledger_read_at=now()");
  // No premium evidence at all: every contract's active status is unverified (said once per answer).

  const { POST } = await import("@/app/api/chat/route");
  const { GET: listClaims } = await import("@/app/api/claims/route");
  const send = async (question: string, member: string | null, conv: { id?: string; rev?: number }, account = ACCOUNT) => {
    process.env.DEV_ACCOUNT_ID = account;
    const response = await POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ familyMemberId: member, scope: member ? "member" : "family", question, conversationId: conv.id, conversationRevision: conv.rev, asynchronous: false, timeZone: "Asia/Singapore" }) }));
    const data = await response.json();
    process.env.DEV_ACCOUNT_ID = ACCOUNT;
    if (response.status !== 200) return { status: response.status, data, answer: null as unknown as ChatAnswer };
    const answer = data.answer as ChatAnswer;
    conv.id = answer.conversationId ?? conv.id; conv.rev = answer.conversationRevision ?? conv.rev;
    return { status: 200, data, answer };
  };
  const factsOf = async (conv: { id?: string }, member: string) => {
    const row = (await db.query<{ state: { subjects?: Record<string, Record<string, { value: unknown; state: string }>> } }>("SELECT state FROM chat_conversations WHERE id=$1", [conv.id])).rows[0];
    return row?.state?.subjects?.[member] ?? {};
  };

  /** Runs a conversation: the opening, then each question answered from `replies` (by fact key / question text), or "Not sure". */
  async function run(name: string, member: string, opening: string, replies: [RegExp, string][], check: (ctx: {
    turns: { message: string; answer: ChatAnswer }[]; final: ChatAnswer; asked: string[]; conv: { id?: string; rev?: number }; f: string[] }) => Promise<void> | void) {
    const f: string[] = [], transcript: string[] = [], turns: { message: string; answer: ChatAnswer }[] = [], asked: string[] = [];
    const conv: { id?: string; rev?: number } = {};
    const used = new Set<number>();
    try {
      let message = opening;
      for (let turn = 0; turn < 14; turn++) {
        const { answer, status, data } = await send(message, member, conv);
        if (status !== 200) { f.push("HTTP " + status + " " + JSON.stringify(data).slice(0, 200)); break; }
        turns.push({ message, answer });
        transcript.push("> " + message, "< [" + answer.mode + "] " + answer.summary.slice(0, 220) + (answer.questions[0] ? "  ? " + answer.questions[0].text : ""));
        const q = answer.questions[0];
        if (!q) break;
        // A correction or a remark is not an answer: the same question may come back once after it.
        const remark = /^(?:sorry|actually|oh)\b/i.test(message);
        if (asked.includes(q.text) && !remark) { f.push("asked again: " + q.text); break; }
        asked.push(q.text);
        // Each scripted reply is used once, in order ("sorry, it was her right
        // arm not left" first, then the answer to the question re-asked).
        const index = replies.findIndex(([re], i) => !used.has(i) && re.test(q.text));
        if (index >= 0) used.add(index);
        const reply = index >= 0 ? replies[index][1] : "Not sure";
        message = q.options?.includes(reply) || /^(?:sorry|actually|i dont|idk|just|and)\b/i.test(reply) || reply.includes(",") ? reply : q.text.replace(/\?\s*$/, "") + ": " + reply;
      }
      await check({ turns, final: turns.at(-1)!.answer, asked, conv, f });
    } catch (e) { f.push("threw: " + (e instanceof Error ? e.stack ?? e.message : String(e)).slice(0, 400)); }
    results.push({ name, ok: !f.length, failures: f, transcript });
    console.log(`\n=== ${f.length ? "FAIL" : "PASS"} ${name}\n  ` + transcript.join("\n  ") + (f.length ? "\n  ✗ " + f.join("\n  ✗ ") : ""));
  }
  const offered = (a: ChatAnswer) => [a.summary, ...a.claimItems.filter((i) => i.status !== "not_applicable").map((i) => i.title + " " + i.status)].join("\n");
  const likely = (a: ChatAnswer) => a.claimItems.filter((i) => i.status === "likely_applicable").map((i) => i.title);
  const common = (a: ChatAnswer, f: string[]) => {
    const t = visibleText(a);
    const statusLines = (t.match(/Active status not recently verified/g) ?? []).length;
    if (statusLines > 1) f.push("'Active status not recently verified' is said " + statusLines + " times");
    if (/an amount that is only shown after claim evidence has been reviewed per\b|\(an amount that is only shown/i.test(t)) f.push("a quote mangled by amount hiding is shown");
    const docs = (a.nextSteps.find((s) => /^Send these documents/.test(s)) ?? "").replace(/^Send these documents for the claim: /, "").replace(/\.$/, "").split("; ").filter(Boolean);
    const keys = docs.map((d) => /discharge summary/i.test(d) ? "discharge" : /itemi[sz]ed.*bill/i.test(d) ? "bill" : d.toLowerCase());
    if (new Set(keys).size !== keys.length) f.push("duplicate document requests: " + docs.join(" | "));
    const planDocs = (a.factFinding ?? []).flatMap((p) => p.missingDocuments).map((d) => /discharge summary/i.test(d) ? "discharge" : /itemi[sz]ed.*bill/i.test(d) ? "bill" : d.toLowerCase());
    if (new Set(planDocs).size !== planDocs.length) f.push("duplicate documents across 'What DearPolicy still needs': " + planDocs.join(" | "));
  };

  // ---------------- BLOCKER: each event maps only to its own benefit families ----------------
  await run("Colon cancer in Singapore: critical illness only, never the travel policy's overseas medical", WEIJIE, "Wei Jie was diagnosed with colon cancer on 2026-08-15. what can we claim?",
    [[/specialist/i, "Yes"], [/alive/i, "Yes"], [/where/i, "Singapore"]], ({ final, f }) => {
      if (/overseas medical|covid/i.test(offered(final))) f.push("offers travel medical cover for a diagnosis at home: " + offered(final).slice(0, 300));
      if (!/critical illness accelerator/i.test(offered(final))) f.push("does not offer the critical-illness accelerator");
      if (final.citations.some((c) => /TravelSafe/i.test(c.policyName))) f.push("cites TravelSafe for a diagnosis at home");
      common(final, f);
    });
  await run("13-hour flight delay: travel delay only", WEIJIE, "Wei Jie flight from Bangkok back to Singapore was delayed 13 hours on 2026-09-25 because of typhoon. Can claim travel insurance?",
    [[/trip start/i, "2026-09-20"], [/trip end/i, "2026-09-25"], [/where/i, "Overseas"]], ({ final, asked, f }) => {
      if (asked.some((q) => /what happened on the trip/i.test(q))) f.push("asks 'What happened on the trip?' after 'delayed 13 hours'");
      if (asked.some((q) => /how many hours/i.test(q))) f.push("asks for the delay hours already given");
      const bad = likely(final).concat(final.claimItems.filter((i) => i.status !== "not_applicable").map((i) => i.title)).filter((t) => /cancel|covid|overseas medical|baggage|accidental death/i.test(t));
      if (bad.length) f.push("offers non-delay travel benefits for a flight delay: " + [...new Set(bad)].join("; "));
      if (!/travel delay/i.test(offered(final))) f.push("does not offer travel delay");
      common(final, f);
    });
  await run("Road-accident death, place unknown: condolence, first steps, no travel accidental death", WEIJIE, "my husband wei jie passed away yesterday in a road accident. i dont know what to do",
    [[/date/i, "2026-09-29"]], ({ turns, final, f }) => {
      if (!/sorry for your loss/i.test(turns[0].answer.summary)) f.push("the first reply has no condolence: " + turns[0].answer.summary.slice(0, 160));
      if (!turns[0].answer.details.some((d) => /^What to do first/.test(d))) f.push("the first reply does not say what to do first");
      if (!/sorry for your loss/i.test(final.summary)) f.push("the final answer has no condolence");
      if (!final.details.some((d) => /^What to do first/.test(d))) f.push("the final answer does not say what to do first");
      if (likely(final).some((t) => /TravelSafe|accidental death and permanent disablement/i.test(t))) f.push("travel accidental death is LIKELY APPLICABLE with the place unknown");
      if (/7 Accidental death and permanent disablement/i.test(offered(final))) f.push("travel accidental death is offered with the place unknown");
      common(final, f);
    });
  await run("Local fracture (child): PA Guardian, corrections and fillers mid-interview, never TravelSafe", XINYI, "Xin Yi fell during PE at school last tuesday and broke her left arm",
    [[/accident, or an illness/i, "An accident"], [/where did/i, "sorry, it was her right arm not left"], [/where did/i, "Singapore"], [/confirmed by a doctor/i, "i dont know"], [/cost|pocket/i, "Not yet known"]],
    async ({ turns, final, asked, conv, f }) => {
      const corrected = turns.find((t) => /right arm not left/.test(t.message));
      if (!corrected) f.push("the correction was never sent");
      else {
        if (/which family member/i.test(corrected.answer.summary)) f.push("the correction was read as another person");
        if (!/corrected/i.test(corrected.answer.summary)) f.push("the correction reply does not say it was corrected: " + corrected.answer.summary);
      }
      const facts = await factsOf(conv, XINYI);
      if (!/right/i.test(String(facts.fractureBodyPart?.value ?? "")) || /left/i.test(String(facts.fractureBodyPart?.value ?? ""))) f.push("the stored fracture is still " + facts.fractureBodyPart?.value);
      const dunno = turns.find((t) => /^Was the fracture confirmed.*i dont know$|^i dont know$/i.test(t.message));
      if (asked.filter((q) => /confirmed by a doctor/i.test(q)).length > 1) f.push("'i dont know' did not move the interview on");
      void dunno;
      if (final.citations.some((c) => /TravelSafe/i.test(c.policyName))) f.push("a local fracture cites TravelSafe");
      if (/overseas|covid|trip|travel delay/i.test(offered(final))) f.push("a local fracture offers travel cover: " + offered(final).slice(0, 200));
      if (!/fracture benefit/i.test(offered(final))) f.push("does not offer the PA fracture benefit");
      if (final.citations.some((c) => /Policy wording, read when/.test(c.evidenceLabel ?? ""))) f.push("a personal schedule is labelled 'Policy wording'");
      common(final, f);
    });
  await run("'actually she was admitted overnight at KKH' mid-interview: same child, facts recorded, not asked again", XINYI, "Xin Yi fell at the playground and broke her right wrist",
    [[/accident, or an illness/i, "An accident"], [/where did/i, "actually she was admitted overnight at KKH"], [/where did/i, "Singapore"], [/when did/i, "2026-09-26"], [/confirmed by a doctor/i, "Yes"], [/cost|pocket/i, "Not yet known"]],
    async ({ turns, asked, conv, f }) => {
      const t = turns.find((x) => /admitted overnight/.test(x.message));
      if (t && /which family member/i.test(t.answer.summary)) f.push("'actually she ...' asked which family member");
      if (asked.some((q) => /what treatment/i.test(q))) f.push("asks what treatment after 'admitted overnight'");
      if (asked.some((q) => /how many nights/i.test(q))) f.push("asks how many nights after 'overnight'");
      const facts = await factsOf(conv, XINYI);
      if (facts.hospitalNights?.value !== 1) f.push("hospital nights recorded as " + facts.hospitalNights?.value);
      if (!/KK/i.test(String(facts.hospitalName?.value ?? ""))) f.push("hospital recorded as " + facts.hospitalName?.value);
    });
  await run("Hospital stay with the facts in the first message: no re-asking, no hospital-cash documents under a Shield plan", MEILING,
    "Mei Ling was admitted to Mount Elizabeth for dengue on 2026-09-20, 3 nights in a single room. Bill was $8,400. How much can claim from her shield plan?",
    [[/other insurance|another insurer/i, "No"]], ({ turns, asked, final, f }) => {
      if (asked.some((q) => /which hospital/i.test(q))) f.push("asks which hospital after 'Mount Elizabeth'");
      if (asked.some((q) => /discharged/i.test(q))) f.push("asks the discharge date after '2026-09-20, 3 nights'");
      const plans = turns.flatMap((t) => t.answer.factFinding ?? []);
      if (plans.some((p) => p.category === "hospital_cash")) f.push("asks for hospital-cash documents under a Shield plan with no hospital cash");
      common(final, f);
    });
  await run("Typed answers: 'Mount Elizabeth, not sure if panel' keeps the name; 'just one night lah' is one night", MEILING, "Mei Ling was admitted to hospital on 2026-09-21.",
    [[/which hospital/i, "Mount Elizabeth, not sure if panel"], [/discharged/i, "2026-09-22"], [/how many nights/i, "just one night lah"]],
    async ({ conv, asked, f }) => {
      const facts = await factsOf(conv, MEILING);
      if (!/Mount Elizabeth/i.test(String(facts.hospitalName?.value ?? ""))) f.push("hospital name recorded as " + JSON.stringify(facts.hospitalName));
      if (asked.filter((q) => /which hospital/i.test(q)).length > 1) f.push("asked for the hospital again");
    });

  // ---------------- MAJOR: people and households ----------------
  {
    const f: string[] = [], transcript: string[] = [];
    try {
      const conv: { id?: string; rev?: number } = {};
      const first = await send("wei jie got life insurance ah? how much", MEILING, conv);
      transcript.push("> wei jie got life insurance ah? how much", "< " + first.answer?.resolvedFamilyMemberId);
      if (first.answer?.resolvedFamilyMemberId !== WEIJIE) f.push("the first question did not resolve to Wei Jie");
      const second = await send("and his wife?", MEILING, conv);
      transcript.push("> and his wife?", "< " + second.answer?.resolvedFamilyMemberId + " " + second.answer?.summary.slice(0, 120));
      if (second.answer?.resolvedFamilyMemberId !== MEILING) f.push("'and his wife?' after Wei Jie resolved to " + second.answer?.resolvedFamilyMemberId);
      const { resolveRelativePerson, resolveClaimPerson } = await import("@/lib/claims/person");
      const family = [{ id: MEILING, display_name: "Tan Mei Ling", preferred_name: "Mei Ling", relationship: "self" }, { id: WEIJIE, display_name: "Lim Wei Jie", preferred_name: "Wei Jie", relationship: "spouse" },
        { id: XINYI, display_name: "Lim Xin Yi", preferred_name: "Xin Yi", relationship: "child" }, { id: SIEWLAN, display_name: "Wong Siew Lan", preferred_name: "Siew Lan", relationship: "parent" }];
      const who = (text: string, anchor: string) => { const r = resolveRelativePerson(text, family, anchor); return r?.status === "resolved" ? r.person.id : r?.status ?? null; };
      if (who("what about Mei Ling's husband", MEILING) !== WEIJIE) f.push("\"Mei Ling's husband\" is not Wei Jie");
      if (who("and her mother?", MEILING) !== SIEWLAN) f.push("'her mother' after Mei Ling is not Siew Lan");
      if (who("and his daughter", WEIJIE) !== XINYI) f.push("'his daughter' after Wei Jie is not Xin Yi");
      if (who("Xin Yi's mum", MEILING) !== "ambiguous") f.push("\"Xin Yi's mum\" (self or spouse) is not asked");
      const actually = resolveClaimPerson("actually she was admitted overnight at KKH", family, XINYI);
      if (actually.status !== "resolved" || actually.person.id !== XINYI) f.push("'actually she was admitted' does not stay with the selected person: " + actually.status);
    } catch (e) { f.push("threw: " + (e instanceof Error ? e.message : String(e)).slice(0, 300)); }
    results.push({ name: "Relative people: 'and his wife?', \"<Name>'s <relation>\"", ok: !f.length, failures: f, transcript });
    console.log(`\n=== ${f.length ? "FAIL" : "PASS"} Relative people\n  ` + transcript.join("\n  ") + (f.length ? "\n  ✗ " + f.join("\n  ✗ ") : ""));
  }
  {
    const f: string[] = [];
    const empty = await send("Can I claim for my hospital stay?", null, {}, EMPTY_ACCOUNT);
    if (empty.status === 500 || empty.status === 200) f.push("a household with no family members returns " + empty.status);
    if (!/add a family member first/i.test(String(empty.data?.error ?? ""))) f.push("no clear 'add a family member first' message: " + JSON.stringify(empty.data).slice(0, 200));
    results.push({ name: "A household with no family members gets a clear message, not a 500", ok: !f.length, failures: f, transcript: [] });
    console.log(`\n=== ${f.length ? "FAIL" : "PASS"} No family members` + (f.length ? "\n  ✗ " + f.join("\n  ✗ ") : ""));
  }

  // ---------------- Unit level: typed answers, corrections, event fit, tiers ----------------
  {
    const f: string[] = [];
    const { countFrom, recordDirectFactAnswer } = await import("@/lib/claims/fact-finding");
    const { applyMessageFacts } = await import("@/lib/claims/message-facts");
    const { eventFitIssue } = await import("@/lib/claims/event-fit");
    const { benefitFitsEvent } = await import("@/lib/chat/fact-finding-chat");
    const { rowsForMember, rowTierApplies } = await import("@/lib/claims/member-tier");
    for (const [t, want] of [["one night", 1], ["just one night lah", 1], ["overnight", 1], ["3 nights", 3], ["two nights", 2], ["a week", 7]] as const)
      if (countFrom(t) !== want) f.push(`countFrom('${t}') = ${countFrom(t)}`);
    const now = new Date("2026-09-30T04:00:00Z");
    for (const reply of ["i dont know", "idk", "dunno", "I don't know lah", "no idea", "not sure leh"]) {
      const subjects: Record<string, Record<string, never>> = { [XINYI]: {} };
      recordDirectFactAnswer({ message: reply, subjects: subjects as never, subjectIds: [XINYI], now, pending: { factKey: "fractureConfirmed", subjectId: XINYI, type: "yes_no", options: ["Yes", "No", "Not sure"] } });
      const v = (subjects[XINYI] as Record<string, { value: unknown; state: string }>).fractureConfirmed;
      if (!v || (v.value !== "not sure" && v.state !== "pending")) f.push(`'${reply}' is not recorded as not sure: ` + JSON.stringify(v));
    }
    const facts: Record<string, { value: unknown; state: "known"; quote: string; recordedAt: string; source: "user" }> = {
      fractureBodyPart: { value: "left arm", state: "known", quote: "", recordedAt: "", source: "user" }, injured: { value: true, state: "known", quote: "", recordedAt: "", source: "user" } };
    const res = applyMessageFacts({ message: "sorry, it was her right arm not left", facts: facts as never, now });
    if (facts.fractureBodyPart.value !== "right arm" || res.correction !== "right arm") f.push("side correction: " + JSON.stringify(facts.fractureBodyPart) + " " + res.correction);
    const res2 = applyMessageFacts({ message: "oh and she was admitted overnight at KKH", facts: facts as never, now });
    if ((facts as Record<string, { value: unknown }>).hospitalNights?.value !== 1 || !/KK/.test(String((facts as Record<string, { value: unknown }>).hospitalName?.value))) f.push("admitted overnight at KKH: " + JSON.stringify(res2));
    const trip: Record<string, never> = {};
    applyMessageFacts({ message: "flight delayed 13 hours on 2026-09-25", facts: trip as never, now });
    if ((trip as Record<string, { value: unknown }>).travelEventType?.value !== "Flight delay" || (trip as Record<string, { value: unknown }>).flightDelayHours?.value !== 13) f.push("delay prefill: " + JSON.stringify(trip));
    const fit = (x: Record<string, unknown>) => eventFitIssue({ benefitTitle: "7 Accidental death and permanent disablement", policyType: "Travel", expiryPassed: false, ...x });
    if (fit({ eventLocation: "Not sure" })?.kind !== "trip") f.push("travel AD&D is kept for an unknown place");
    if (fit({ eventLocation: "Singapore" }) === null) f.push("travel AD&D is kept for Singapore");
    if (fit({ eventLocation: "Bangkok", eventDate: "2026-09-25", tripStart: "2026-09-20", tripEnd: "2026-09-26" }) !== null) f.push("positive control: travel AD&D during the trip is ruled out");
    if (fit({ eventLocation: "Bangkok", travelEvent: true }) !== null) f.push("positive control: a travel claim's own cover is ruled out");
    const k = (key: string, value: unknown) => ({ [key]: { value, state: "known", quote: "", recordedAt: "", source: "user" } }) as never;
    for (const [title, want] of [["3 Travel delay (for every full 6 hours of delay)", true], ["3a Travel delay - maximum per person", true], ["4 Baggage delay (after 6 hours on arrival overseas)", false],
      ["6 Trip cancellation", false], ["8 COVID-19 overseas medical expenses", false], ["1 Overseas medical expenses", false]] as const)
      if (benefitFitsEvent("travel", k("flightDelayHours", 13), "Lim Wei Jie · " + title) !== want) f.push(`flight delay -> '${title}' fits = ${!want}`);
    if (!benefitFitsEvent("travel", k("travelEventType", "Lost or damaged baggage"), "4 Baggage delay (after 6 hours on arrival overseas)")) f.push("positive control: baggage claim rules out baggage delay");
    if (benefitFitsEvent("critical_illness", {} as never, "1 Overseas medical expenses")) f.push("critical illness fits overseas medical");
    if (!benefitFitsEvent("critical_illness", {} as never, "Critical illness accelerator rider (37 critical illnesses, late stage)")) f.push("positive control: critical illness rules out the CI accelerator");
    if (!rowTierApplies("Child", "child") || rowTierApplies("Adult", "Child") || !rowTierApplies("Plan A (Grade M2 and above)", "Plan A")) f.push("rowTierApplies");
    const rows = [{ policyId: "p", benefitName: "1 Overseas medical expenses", sourcePage: 2, tier: "Adult", v: 500000 }, { policyId: "p", benefitName: "1 Overseas medical expenses", sourcePage: 2, tier: "Child", v: 250000 },
      { policyId: "p", benefitName: "Trip cancellation", sourcePage: 2, tier: null, v: 1 }];
    const child = rowsForMember(rows, () => "Child"), unknown = rowsForMember(rows, () => null);
    if (child.map((x) => x.v).join(",") !== "250000,1") f.push("a child does not get the Child column: " + child.map((x) => x.v).join(","));
    if (unknown.length !== 3) f.push("positive control: an unknown tier drops columns");
    results.push({ name: "Unit: typed answers, corrections, trip context, benefit families, table columns", ok: !f.length, failures: f, transcript: [] });
    console.log(`\n=== ${f.length ? "FAIL" : "PASS"} Unit checks` + (f.length ? "\n  ✗ " + f.join("\n  ✗ ") : ""));
  }
  void listClaims;

  console.log("\n=== SUMMARY ===");
  for (const x of results) console.log(`${x.ok ? "PASS" : "FAIL"} ${x.name}` + (x.ok ? "" : "\n     - " + x.failures.join("\n     - ")));
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed}/${results.length} round-5 claim checks pass`);
  await db.close(); clearInterval(keepAlive); clearTimeout(watchdog);
  process.exitCode = failed ? 1 : 0;
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(2); });
