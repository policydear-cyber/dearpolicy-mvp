/**
 * Round 6 chat-quality regression suite (npm run r6:chat-quality-test).
 *
 * Builds a realistic synthetic household with the REAL ingestion pipeline on
 * PGlite (scripts/r6/fixture.ts), drives the REAL chat route with 250+
 * messages (scripts/r6/battery.ts) under the deterministic model stand-in,
 * and runs every rubbish detector (scripts/r6/detectors.ts) on every answer,
 * card and citation. Any detector hit fails the suite. Detector positive
 * controls run first so a detector can never silently stop detecting.
 *
 * R6_DUMP=<file> writes every turn (question, answer, hits) as JSON lines.
 * R6_ONLY=<substring> runs only matching conversations.
 */
import { writeFileSync, appendFileSync } from "node:fs";
import { NextRequest } from "next/server";
import type { ChatAnswer } from "@/types";

process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
process.env.E2E_RUN_ID = "r6chat";
process.env.DEV_AUTH_ENABLED = "1";
process.env.MODEL_PRESET = process.env.MODEL_PRESET || "openai";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-not-used";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "ci";
delete process.env.PINECONE_API_KEY; delete process.env.SUPABASE_URL;

type Record_ = { conv: string; turn: number; question: string; status: number; ms: number; summary: string; answer: ChatAnswer | null; error?: unknown; hits: { rule: string; text: string }[] };

async function main() {
  const started = Date.now();
  const watchdog = setTimeout(() => { console.error("WATCHDOG: no completion in 20 minutes"); process.exit(3); }, 20 * 60_000);
  globalThis.fetch = (async (input: RequestInfo | URL) => { throw new Error("network disabled: " + String(input)); }) as typeof fetch;
  const quietLog = console.log; const quietInfo = console.info;
  // Pipeline telemetry is JSON on stdout; keep the report readable.
  console.info = () => undefined; console.debug = () => undefined; console.warn = () => undefined;
  console.log = (...args: unknown[]) => { if (typeof args[0] === "string" && /^(?:\{"|\[telemetry\]|SQL note)/.test(args[0])) return; quietLog(...args); };

  const { detect, visibleFields, moneyIn } = await import("./r6/detectors");
  // ------------------------------------------------ detector positive controls
  const controls = selfTest(detect);
  if (controls.length) { quietLog("DETECTOR SELF-TEST FAILED:\n- " + controls.join("\n- ")); process.exit(1); }
  quietLog("detector self-test: ok");
  // ------------------------------------------------ output guard unit checks
  const guard = await import("@/lib/chat/output-guard");
  const guardFails = guardSelfTest(guard);
  if (guardFails.length) { quietLog("OUTPUT GUARD SELF-TEST FAILED:\n- " + guardFails.join("\n- ")); process.exit(1); }
  quietLog("output guard self-test: ok");
  guard.guardInterventions.length = 0;

  const F = await import("./r6/fixture");
  const h = await F.buildHousehold();
  quietLog(`household built in ${Date.now() - started} ms`);
  const { battery } = await import("./r6/battery");
  const { POST } = await import("@/app/api/chat/route");

  // ------------------------------------------------ ground truth for the detectors
  const truth = async () => {
    const pages = new Map<string, string>();
    for (const r of (await h.db.query<{ policy_id: string; text: string }>("SELECT pp.policy_id,string_agg(pp.text,E'\\n' ORDER BY pp.page_number) text FROM policy_pages pp JOIN policies p ON p.id=pp.policy_id WHERE p.account_id=$1 AND p.lifecycle_state='active' GROUP BY 1", [F.ACCOUNT])).rows) pages.set(r.policy_id, r.text);
    const premiumFigures: number[] = [];
    for (const r of (await h.db.query<{ amount: string; notes: string | null }>("SELECT amount::text,notes FROM premium_records WHERE account_id=$1", [F.ACCOUNT])).rows) {
      premiumFigures.push(Number(r.amount)); premiumFigures.push(...moneyIn(r.notes ?? ""));
    }
    const personPolicies = new Map<string, Set<string>>();
    for (const r of (await h.db.query<{ family_member_id: string; policy_id: string }>("SELECT family_member_id,policy_id FROM policy_members WHERE account_id=$1", [F.ACCOUNT])).rows) {
      if (!personPolicies.has(r.family_member_id)) personPolicies.set(r.family_member_id, new Set());
      personPolicies.get(r.family_member_id)!.add(r.policy_id);
    }
    return { pages, premiumFigures: [...new Set(premiumFigures)], householdNames: F.PEOPLE.map((p) => p.display_name), foreignNames: ["Goh Boon Kiat", "Boon Kiat"],
      selfNames: F.PEOPLE.filter((p) => p.relationship === "self").flatMap((p) => [p.display_name, p.preferred_name]),
      foreignPolicyIds: new Set([h.docs.other]), personPolicies };
  };
  let gMain = await truth();

  const only = process.env.R6_ONLY;
  const dump = process.env.R6_DUMP;
  if (dump) writeFileSync(dump, "");
  const records: Record_[] = [];
  let messages = 0;
  const accountOf = (c: { account?: string }) => c.account === "empty" ? F.EMPTY_ACCOUNT : c.account === "other" ? F.OTHER_ACCOUNT : F.ACCOUNT;
  const memberOf = (m: string | null) => m === "EMPTY" ? F.EMPTY_PERSON : m === "OTHER" ? F.OTHER_PERSON : m;
  const send = async (account: string, member: string | null, scope: string | undefined, question: string, conv: { id?: string; rev?: number; personContextMessage?: string; personContextRecordedAt?: string }, personChoiceId?: string) => {
    process.env.DEV_ACCOUNT_ID = account;
    const t0 = Date.now();
    const res = await POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ familyMemberId: member, scope: scope ?? (member ? "member" : "family"), question, conversationId: conv.id, conversationRevision: conv.rev, asynchronous: false, timeZone: "Asia/Singapore",
        ...(personChoiceId ? { personChoiceId, personContextMessage: conv.personContextMessage, personContextRecordedAt: conv.personContextRecordedAt } : {}) }) }));
    const ms = Date.now() - t0;
    const data = await res.json();
    messages++;
    if (res.status === 200) { const a = data.answer as ChatAnswer; conv.id = a.conversationId ?? conv.id; conv.rev = a.conversationRevision ?? conv.rev;
      conv.personContextMessage = a.personContextMessage; conv.personContextRecordedAt = a.personContextRecordedAt; }
    return { status: res.status, data, ms };
  };
  const judge = (name: string, turn: number, question: string, userText: string, claimTurn: boolean, r: { status: number; data: { answer?: ChatAnswer; error?: string }; ms: number }, expect?: { status?: number } & Record<string, unknown>, account = F.ACCOUNT) => {
    // Seen from another household, this household's people and documents are the foreign ones.
    const g = account === F.OTHER_ACCOUNT ? { ...gMain, pages: new Map<string, string>(), premiumFigures: [], foreignNames: F.PEOPLE.flatMap((p) => [p.display_name, p.preferred_name]),
      foreignPolicyIds: new Set(Object.entries(h.docs).filter(([k]) => k !== "other").map(([, v]) => v)), personPolicies: new Map<string, Set<string>>() }
      : account === F.EMPTY_ACCOUNT ? { ...gMain, pages: new Map<string, string>(), premiumFigures: [], foreignPolicyIds: new Set(Object.values(h.docs)), personPolicies: new Map<string, Set<string>>() } : gMain;
    const hits: { rule: string; text: string }[] = [];
    const wantStatus = expect?.status ?? 200;
    if (r.status !== wantStatus) hits.push({ rule: "unexpected HTTP status", text: r.status + " " + JSON.stringify(r.data).slice(0, 200) });
    if (r.status !== 200) {
      const msg = String(r.data?.error ?? "");
      if (!msg || /Invalid request|issues|zod|Chat failed/i.test(msg) && r.status !== 400) hits.push({ rule: "error message not plain", text: msg });
    }
    const a = r.status === 200 ? r.data.answer! : null;
    if (a) {
      const e = (expect ?? {}) as { mentions?: RegExp | RegExp[]; asksPerson?: boolean };
      const mentions = Array.isArray(e.mentions) ? e.mentions : e.mentions ? [e.mentions] : [];
      hits.push(...detect(a, { question, userText, claimTurn, ms: r.ms, expect: { ...(expect as object), mentions: undefined } as never }, g));
      const all = visibleFields(a).map((f) => f.text).join("\n");
      for (const m of mentions) if (!m.test(all)) hits.push({ rule: "answer ignores the question", text: "expected " + m + " in: " + a.summary.slice(0, 200) });
      if (e.asksPerson && a.questions[0]?.id !== "claim_person") hits.push({ rule: "ambiguous person not asked", text: a.summary.slice(0, 200) });
    }
    const rec: Record_ = { conv: name, turn, question, status: r.status, ms: r.ms, summary: a?.summary ?? String(r.data?.error ?? ""), answer: a, hits };
    records.push(rec);
    if (dump) appendFileSync(dump, JSON.stringify(rec) + "\n");
    return a;
  };

  for (const c of battery()) {
    if (only && !c.name.includes(only)) continue;
    if (c.before === "delete-travel") { await h.db.query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [h.docs.travel]); gMain = await truth(); }
    if (c.before === "restore-travel") { await h.db.query("UPDATE policies SET lifecycle_state='active' WHERE id=$1", [h.docs.travel]); gMain = await truth(); }
    const account = accountOf(c), member = memberOf(c.member);
    const conv: { id?: string; rev?: number } = {};
    let userText = "";
    let currentMember = member;
    try {
      if (c.turns) {
        for (const [i, t] of c.turns.entries()) {
          userText += "\n" + t.say;
          const r = await send(account, currentMember, c.scope, t.say, conv);
          // The chat page follows the person the answer was about (setMemberId).
          if (r.status === 200 && r.data.answer?.resolvedFamilyMemberId) currentMember = r.data.answer.resolvedFamilyMemberId;
          const a = judge(c.name, i, t.say, userText, false, r, t.expect as never, account);
          if (!a && r.status === 200) break;
        }
      } else if (c.claim) {
        let message = c.claim.opening; const used = new Set<number>(); const asked: string[] = []; let choice: string | undefined;
        for (let turn = 0; turn < (c.claim.maxTurns ?? 9); turn++) {
          userText += "\n" + message;
          const r = await send(account, currentMember, c.scope, message, conv, choice);
          if (r.status === 200 && r.data.answer?.resolvedFamilyMemberId) currentMember = r.data.answer.resolvedFamilyMemberId;
          choice = undefined;
          const a = judge(c.name, turn, message, userText, true, r, c.claim.expect as never, account);
          if (!a) break;
          const direct = a.questions[0];
          const q = direct ?? (a.factFinding ?? []).flatMap((p) => p.nextQuestions)[0];
          if (!q) {
            if (c.claim.finalMentions) { const all = visibleFields(a).map((f) => f.text).join("\n"); if (!c.claim.finalMentions.test(all)) records.at(-1)!.hits.push({ rule: "answer ignores the question", text: "claim ended without " + c.claim.finalMentions + ": " + a.summary.slice(0, 200) }); }
            break;
          }
          const again = asked.filter((x) => x === q.text).length;
          if (again >= 2) { records.at(-1)!.hits.push({ rule: "same claim question asked three times", text: q.text }); break; }
          asked.push(q.text);
          const index = c.claim.replies.findIndex(([re], i) => !used.has(i) && re.test(q.text));
          if (index >= 0) used.add(index);
          const reply = index >= 0 ? c.claim.replies[index][1] : "Not sure";
          // As app/chat/page.tsx sends it: a person card is a tap on a person;
          // a direct card's option is sent as tapped; anything typed into a
          // card, and every tap on the plan's own question, is "Question: answer".
          if (q.id === "claim_person") {
            const pick = (a.personCandidates ?? []).find((p) => new RegExp(reply, "i").test(p.label)) ?? (a.personCandidates ?? [])[0];
            if (!pick) break;
            message = pick.label; choice = pick.id;
          } else if (!direct) message = q.text.replace(/\?\s*$/, "") + ": " + reply;
          else message = q.options?.includes(reply) || /^(?:sorry|actually|i dont|idk|just|and|dunno|not sure|yes he)\b/i.test(reply) || reply.includes(",") ? reply : q.text.replace(/\?\s*$/, "") + ": " + reply;
        }
      }
    } catch (e) {
      const rec: Record_ = { conv: c.name, turn: -1, question: "", status: 0, ms: 0, summary: "", answer: null, hits: [{ rule: "threw", text: (e instanceof Error ? e.stack ?? e.message : String(e)).slice(0, 400) }] };
      records.push(rec); if (dump) appendFileSync(dump, JSON.stringify(rec) + "\n");
    }
  }
  // ------------------------------------------------ report
  const byRule = new Map<string, number>();
  for (const r of records) for (const x of r.hits) byRule.set(x.rule, (byRule.get(x.rule) ?? 0) + 1);
  const failing = records.filter((r) => r.hits.length);
  for (const r of failing.slice(0, Number(process.env.R6_SHOW ?? 40))) quietLog(`\n✗ ${r.conv} #${r.turn} > ${r.question.slice(0, 120)}\n  < ${r.summary.slice(0, 300)}\n  - ` + r.hits.map((x) => x.rule + ": " + x.text).join("\n  - "));
  quietLog("\n=== detector hits by rule ===");
  for (const [rule, n] of [...byRule].sort((a, b) => b[1] - a[1])) quietLog(String(n).padStart(4) + "  " + rule);
  const times = records.map((r) => r.ms).sort((a, b) => a - b);
  quietLog(`\n${messages} messages in ${records.length} judged turns; ${failing.length} turns with hits; median ${times[Math.floor(times.length / 2)]} ms, max ${times.at(-1)} ms; total ${Math.round((Date.now() - started) / 1000)} s`);
  if (!only && messages < 250) { quietLog("FAIL: the battery must send at least 250 messages (sent " + messages + ")"); process.exitCode = 1; }
  if (failing.length) process.exitCode = 1;
  // The guard is a safety net only: on this battery it must never have had to act.
  if (guard.guardInterventions.length) {
    quietLog("FAIL: the output guard changed " + guard.guardInterventions.length + " answer(s) — fix the root cause:\n" + guard.guardInterventions.slice(0, 5).map((g) => "  before: " + g.before.slice(0, 300) + "\n  after:  " + g.after.slice(0, 300)).join("\n"));
    process.exitCode = 1;
  } else quietLog("output guard interventions: 0");
  clearTimeout(watchdog);
  await h.db.close();
}

/** Positive and negative controls for every detector family. */
function selfTest(detect: typeof import("./r6/detectors").detect): string[] {
  const fails: string[] = [];
  const g = { pages: new Map([["p1", "Deductible per policy year S$3,500. Co-insurance 10%."]]), premiumFigures: [1284, 689], householdNames: ["Tan Mei Ling"], selfNames: ["Tan Mei Ling", "Mei Ling"], foreignNames: ["Goh Boon Kiat"], foreignPolicyIds: new Set(["p9"]), personPolicies: new Map([["m1", new Set(["p1"])]]) };
  const base = (over: Partial<ChatAnswer>): ChatAnswer => ({ mode: "answer", summary: "Mei Ling's deductible is S$3,500 per policy year.", details: [], claimItems: [], nextSteps: [], confidence: null,
    citations: [{ chunkId: "c", policyId: "p1", policyName: "ShieldCare Premier", pageStart: 2, pageEnd: 2 }], disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [], ...over });
  const t = { question: "q", userText: "", claimTurn: false, ms: 10 };
  const expectRule = (name: string, a: ChatAnswer, rule: RegExp, ctx: Partial<typeof t> & { expect?: never } = {}) => {
    const hits = detect(a, { ...t, ...ctx }, g as never);
    if (!hits.some((x) => rule.test(x.rule))) fails.push(name + " not detected (got " + hits.map((x) => x.rule).join(", ") + ")");
  };
  if (detect(base({}), t, g as never).length) fails.push("clean answer flagged: " + JSON.stringify(detect(base({}), t, g as never)));
  expectRule("doubled word", base({ summary: "The the deductible is S$3,500." }), /doubled/);
  expectRule("undefined", base({ summary: "Your deductible is undefined." }), /debug token/);
  expectRule("template", base({ summary: "Your deductible is {amount}." }), /template/);
  expectRule("uuid", base({ details: ["Policy 60000000-0000-4000-8000-000000000100 was read."] }), /uuid/);
  expectRule("table name", base({ details: ["Read from policy_benefits."] }), /snake_case|table/);
  expectRule("model name", base({ details: ["Answered by Gemini."] }), /model/);
  expectRule("zero", base({ summary: "You can claim S$0.00 for this." }), /zero amount/);
  expectRule("ungrounded", base({ summary: "Your deductible is S$4,321." }), /amount not in/);
  expectRule("year as amount", base({ summary: "Renewal premium S$2026 is due." }), /date shown/);
  expectRule("empty", base({ summary: "Ok." }), /empty/);
  expectRule("cut off", base({ details: ["Your deductible applies to every admission and the"] }), /cut off/);
  expectRule("repeated", base({ details: ["Active status not recently verified for this plan.", "Active status not recently verified for this plan."] }), /repeated/);
  expectRule("dangling", base({ details: ["See the table below for each benefit."] }), /dangling/);
  expectRule("plural", base({ summary: "I found 1 policies for Mei Ling on file." }), /count grammar/);
  expectRule("zero count", base({ summary: "I found 0 policies for Mei Ling on file." }), /count grammar/);
  expectRule("not covered", base({ summary: "Dental treatment is not covered for Mei Ling." }), /not covered/);
  expectRule("markdown", base({ summary: "Your **deductible is S$3,500." }), /markdown/);
  expectRule("lowercase", base({ details: ["deductible applies once a year."] }), /lowercase/);
  expectRule("foreign person", base({ details: ["Goh Boon Kiat has a term plan."] }), /another household/);
  expectRule("two questions", base({ mode: "fact_finding", questions: [{ id: "a", text: "Which hospital?", type: "text", why: "x" }, { id: "b", text: "When?", type: "date", why: "y" }] }), /more than one question/);
  expectRule("foreign citation", base({ citations: [{ chunkId: "c", policyId: "p9", policyName: "Other", pageStart: 1, pageEnd: 1 }] }), /another household/);
  expectRule("contradiction", base({ summary: "Here is what Wei Jie’s documents state. I could not find dental cover in the documents read for Wei Jie.", details: ["Group booklet — Dental: up to S$3,500 (page 5)."] }), /not found but lists/);
  expectRule("claim wording on a question", base({ summary: "I couldn’t find a benefit in your documents that matches what you described." }), /answered as a claim/, { question: "Compare Mei Ling and Wei Jie's hospital cover" });
  expectRule("what-if framing", base({ summary: "If an accident or injury happened, these benefits could be relevant." }), /what-if framing/, { question: "Xin Yi's accident plan pays what?" });
  expectRule("slow", base({}), /slow/, { ms: 9000 });
  return fails;
}

function guardSelfTest(g: typeof import("@/lib/chat/output-guard")): string[] {
  const fails: string[] = [];
  const eq = (name: string, got: unknown, want: unknown) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(name + ": got " + JSON.stringify(got) + ", want " + JSON.stringify(want)); };
  eq("doubled word", g.guardText("The the deductible is S$3,500 a policy year."), "The deductible is S$3,500 a policy year.");
  eq("uuid sentence dropped", g.guardText("Your deductible is S$3,500. Read from 60000000-0000-4000-8000-000000000100."), "Your deductible is S$3,500.");
  eq("table name dropped", g.guardText("Found in policy_benefits. Co-insurance is 10%."), "Co-insurance is 10%.");
  eq("model name dropped", g.guardText("Gemini read the page. It says 10%."), "It says 10%.");
  eq("template token dropped", g.guardText("You pay {amount}. The insurer decides."), "The insurer decides.");
  eq("quoted text untouched", g.guardText("The schedule prints “see clause policy_terms  ..” here."), "The schedule prints “see clause policy_terms  ..” here.");
  eq("spacing and punctuation", g.guardText("Co-insurance is 10% ,  and the deductible is S$3,500 .."), "Co-insurance is 10%, and the deductible is S$3,500.");
  eq("clean text unchanged", g.guardText("Here is what your documents state about the deductible. Each line shows the page it comes from."), "Here is what your documents state about the deductible. Each line shows the page it comes from.");
  const a = { mode: "answer", summary: "Read by gpt-4o from chunk_id 7.", details: ["Deductible: S$3,500 (page 3).", "Deductible: S$3,500 (page 3)."], claimItems: [], nextSteps: [], confidence: null, citations: [], disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [] } as unknown as ChatAnswer;
  g.guardChatAnswer(a);
  eq("fallback summary when nothing honest is left", a.summary, g.GUARD_FALLBACK_SUMMARY);
  eq("a line said twice is said once, figure kept", a.details, ["Deductible: S$3,500 (page 3)."]);
  g.guardInterventions.length = 0;
  return fails;
}

main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(2); });
