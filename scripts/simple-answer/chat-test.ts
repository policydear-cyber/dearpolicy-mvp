/** Offline checks for the in-app simple chat (lib/simple-chat). No model, no database, no network: the model is a stub
 * returning fixed JSON, and the household is a synthetic fixture or, when present, the real snapshot outside the repo.
 *   npm run simple:chat-test [-- <household.json>] */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { simpleChatEnabled, simpleChatModel } from "../../lib/simple-chat/flag";
import { readHousehold, renderLibrary, type Household } from "../../lib/simple-chat/library";
import { alternating, anthropicRequest, ledgerUsage, type SimpleModel } from "../../lib/simple-chat/model";
import { SIMPLE_ANSWER_SCHEMA } from "../../lib/simple-chat/prompt";
import type { ModelAnswer, ModelStatement } from "../../lib/simple-chat/prompt";
import { ALTERNATIVES_NOTE, LEFT_OUT_AMOUNT, LEFT_OUT_SENTENCE, locateQuote, matchMember, readModelAnswer, sentenceProblem, verifyAnswer } from "../../lib/simple-chat/verify";
import { runSimpleChat } from "../../lib/simple-chat/hook";
import type { ChatContext } from "../../lib/chat/workflow";
import { guardChatAnswer } from "../../lib/chat/output-guard";
import { enforceLiveChatMonetaryBoundary, sanitizeStoredAnswer } from "../../lib/chat/monetary-boundary";
import { AnswerCards, showsCards } from "../../components/answer-cards";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const SNAPSHOT = process.argv[2] ?? "/mnt/project-files/ux-live/release-set/snapshot/household.json";
let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) { await fn(); passed++; console.log("ok - " + name); }
const st = (s: Partial<ModelStatement> & Pick<ModelStatement, "kind" | "text">): ModelStatement =>
  ({ person: null, document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, ...s });

/** A made-up household: an accident plan whose fracture table is on page 13 while the page itself prints "Page 12",
 * a second document with ambulance and recuperation, and one-row alternatives. */
const HOUSE: Household = {
  accountId: "11111111-1111-1111-1111-111111111111",
  members: [{ name: "Lim Ah Kow (Ah Kow)", relationship: "self" }, { name: "Lim Mei Mei", relationship: "child" }],
  documents: [
    { policyId: "aaaaaaaa-0000-0000-0000-000000000001", name: "Accident Summary.pdf", insurer: "Testlife", productName: "Test Accident Plan", policyNumber: "T1", documentType: "personal_accident", documentRole: "product_summary", effectiveDate: "2026-01-01", expiryDate: null, uploadedAt: "2026-09-01", uploadedFor: "Lim Ah Kow", linkedPeople: ["Lim Ah Kow"], supersededAt: null, processingStatus: "ready",
      pages: [
        { page: 12, text: "Insurance Benefits\nDeath due to Accident\t100% of Sum Insured\nPage 11 of 20" },
        { page: 13, text: "Simple Fracture due to Accident\nSimple Fracture Benefit Limit: S$5,000\nSchedule\tCompensation\nHip\t75%\nArm , Elbow, Wrist or Ribs\t25%\nDental cover\tS$300 or S$800 for crowns\nPage 12 of 20" },
      ] },
    { policyId: "aaaaaaaa-0000-0000-0000-000000000002", name: "Extras.pdf", insurer: "Testlife", productName: "Test Extras", policyNumber: "T2", documentType: "personal_accident", documentRole: "certificate", effectiveDate: "2026-01-01", expiryDate: null, uploadedAt: "2026-09-01", uploadedFor: "Lim Ah Kow", linkedPeople: ["Lim Ah Kow"], supersededAt: null, processingStatus: "ready",
      pages: [{ page: 1, text: "Ambulance Cost\tUp to S$500 per incident\nAccidental Hospital Recuperation Benefit\tS$250\nOutpatient\tup to $90 per visit" }] },
  ],
};

async function main() {
  await check("switch is off by default, on only when set, and refused in production without its allowance", () => {
    assert.equal(simpleChatEnabled({} as unknown as NodeJS.ProcessEnv), false);
    assert.equal(simpleChatEnabled({ DEARPOLICY_SIMPLE_CHAT: "1" } as unknown as NodeJS.ProcessEnv), true);
    assert.equal(simpleChatEnabled({ DEARPOLICY_SIMPLE_CHAT: "1", VERCEL: "1" } as unknown as NodeJS.ProcessEnv), false);
    assert.equal(simpleChatEnabled({ DEARPOLICY_SIMPLE_CHAT: "1", VERCEL: "1", DEARPOLICY_SIMPLE_CHAT_ALLOW_PRODUCTION: "1" } as unknown as NodeJS.ProcessEnv), true);
  });

  await check("model is configurable: anthropic by default, openai:<model> accepted, anything else refused", () => {
    assert.deepEqual(simpleChatModel({} as unknown as NodeJS.ProcessEnv), { provider: "anthropic", model: "claude-opus-5-5" });
    assert.deepEqual(simpleChatModel({ DEARPOLICY_SIMPLE_CHAT_MODEL: "openai:gpt-6-luna" } as unknown as NodeJS.ProcessEnv), { provider: "openai", model: "gpt-6-luna" });
    assert.throws(() => simpleChatModel({ DEARPOLICY_SIMPLE_CHAT_MODEL: "gemini:flash" } as unknown as NodeJS.ProcessEnv));
  });

  await check("with the switch off the chat never loads the simple chat (workflow hooks are behind the switch)", () => {
    const src = readFileSync("lib/chat/workflow.ts", "utf8");
    const hooks = src.split("\n").filter((l) => l.includes("@/lib/simple-chat/hook"));
    assert.equal(hooks.length, 2);
    for (const l of hooks) assert.match(l, /^\s*if\(simpleChatEnabled\(\)\)return \(await import\("@\/lib\/simple-chat\/hook"\)\)/);
    assert.ok(!/^import .*simple-chat\/hook/m.test(src));
  });

  await check("library read is limited to its own household, and another household's row stops it", async () => {
    const seen: unknown[][] = [];
    const run = async (sql: string, params: unknown[]) => { seen.push(params); return []; };
    await readHousehold(HOUSE.accountId, run);
    assert.ok(seen.every((p) => p[0] === HOUSE.accountId));
    const leaky = async (sql: string) => (/FROM family_members/.test(sql) ? [{ account_id: "someone-else", display_name: "X", relationship: "self" }] : []);
    await assert.rejects(readHousehold(HOUSE.accountId, leaky), /another household/);
  });

  await check("request: prompt and library in a cached system block, structured JSON output, history alternates", () => {
    const r = anthropicRequest({ provider: "anthropic", model: "claude-opus-5-5" }, { library: renderLibrary(HOUSE), history: [{ role: "assistant", text: "stray" }, { role: "user", text: "a" }, { role: "user", text: "b" }, { role: "assistant", text: "c" }], question: "q" });
    assert.equal(r.system[1].cache_control?.ttl, "1h");
    assert.match(r.system[1].text, /<page n="13">/);
    assert.equal(r.output_config.format.schema, SIMPLE_ANSWER_SCHEMA);
    assert.deepEqual(r.messages.map((m) => [m.role, m.content]), [["user", "a\n\nb"], ["assistant", "c"], ["user", "q"]]);
    assert.ok(!("temperature" in r));
    assert.deepEqual(alternating([{ role: "user", text: "only" }]), []);
  });

  await check("page comes from the stored page the quote is on, not the page the document prints or the model says", () => {
    const f = locateQuote(HOUSE, "Arm, Elbow, Wrist or Ribs 25%", 1);
    assert.deepEqual([f?.docIndex, f?.page], [0, 13]);
    assert.equal(locateQuote(HOUSE, "Fracture of the little toe 90%", 0), null);
    const { answer } = verifyAnswer(HOUSE, { bottomLine: "", statements: [st({ kind: "fact", text: "The plan has a fracture table.", document: "D2", quote: "Simple Fracture due to Accident" })], nextSteps: [], question: null });
    assert.equal(answer.statements![0].source?.page, 13);
    assert.equal(answer.statements![0].source?.policyName, "Test Accident Plan");
    assert.equal(answer.citations[0].pageStart, 13);
    assert.equal(answer.citations[0].excerpt, "Simple Fracture due to Accident");
  });

  // Release-set C2: a wrist fracture, ambulance and recuperation were summed into a range.
  const c2: ModelAnswer = {
    bottomLine: "Ah Kow could get S$1,250 to S$2,000 in total. That is S$2,000 altogether.",
    statements: [
      st({ kind: "amount", text: "Simple fracture of the wrist pays 25% of the S$5,000 limit.", person: "Ah Kow", document: "D1", quote: "Arm , Elbow, Wrist or Ribs\t25%", percentOf: { percent: 25, baseAmount: "S$5,000" }, conditions: ["The fracture is from an accident."], alternativeGroup: "x" }),
      st({ kind: "amount", text: "Ambulance cost up to S$500 per incident.", person: "Ah Kow", document: "D2", quote: "Ambulance Cost Up to S$500 per incident", amount: "S$500", alternativeGroup: "x" }),
      st({ kind: "amount", text: "Recuperation benefit of S$250.", person: "Ah Kow", document: "D2", quote: "Accidental Hospital Recuperation Benefit S$250", amount: "S$250", alternativeGroup: "x" }),
    ],
    nextSteps: ["Claim S$2,000 from Testlife."], question: null,
  };
  await check("C2: separate benefits are never added or given as a range; each is its own card", () => {
    const { answer, report } = verifyAnswer(HOUSE, c2);
    const cards = answer.statements!.filter((s) => s.amount);
    assert.deepEqual(cards.map((s) => [s.amount!.text, s.source!.page, s.group]), [["S$1,250", 13, null], ["S$500", 1, null], ["S$250", 1, null]]);
    assert.equal(cards[0].amount!.illustration, true);
    assert.equal(cards[0].kind, "calculation");
    const prose = [answer.summary, answer.bottomLine, ...answer.nextSteps].join(" ");
    assert.doesNotMatch(prose, /2,000|to S\$/);
    assert.ok(report.sentencesLeftOut.includes("a range between amounts") && report.sentencesLeftOut.includes("a total of separate amounts"));
    assert.ok(answer.statements!.some((s) => s.text === LEFT_OUT_SENTENCE));
    assert.ok(answer.statements!.some((s) => /not a total/.test(s.text) && /S\$1,250, S\$500 and S\$250/.test(s.text)));
    assert.match(answer.bottomLine!, /separate; they are not added together/);
    assert.equal(answer.verifiedPolicyFactsOnly, true);
  });

  await check("sentence check: range, total and unprinted figures are left out; listed alternatives are kept", () => {
    assert.equal(sentenceProblem("You get S$1,250 to S$2,000.", [1250, 2000], [1250, 750]), "a range between amounts");
    assert.equal(sentenceProblem("In all S$1,750.", [1250, 500], [1250, 500]), "a total of separate amounts");
    assert.equal(sentenceProblem("It pays S$9,999.", [1250], [1250]), "an amount no checked statement gives");
    assert.equal(sentenceProblem("It pays S$1,250 or S$120,000, depending on the plan.", [1250, 120000], [1250, 120000]), null);
    assert.equal(sentenceProblem("No amount here.", [], []), null);
  });

  await check("either/or only for one person's amounts on one row of one page", () => {
    const { answer } = verifyAnswer(HOUSE, { bottomLine: "Dental pays S$300 or S$800.", nextSteps: [], question: null, statements: [
      st({ kind: "amount", text: "S$300 for dental.", person: "Lim Ah Kow", document: "D1", quote: "Dental cover\tS$300", amount: "S$300", alternativeGroup: "d" }),
      st({ kind: "amount", text: "S$800 for crowns.", person: "Lim Ah Kow", document: "D1", quote: "S$800 for crowns", amount: "S$800", alternativeGroup: "d" }),
    ] });
    const cards = answer.statements!.filter((s) => s.amount);
    assert.equal(cards.length, 2);
    assert.ok(cards.every((s) => s.group?.id === "g1" && s.group.note === ALTERNATIVES_NOTE));
    assert.match(answer.bottomLine!, /S\$300 or S\$800/);
  });

  await check("an amount not printed in its quote, a range as one amount, or an unfound quote is left out and said so", () => {
    const { answer, report } = verifyAnswer(HOUSE, { bottomLine: "Here is the cover.", nextSteps: [], question: null, statements: [
      st({ kind: "amount", text: "Hip pays S$4,000.", person: "Ah Kow", document: "D1", quote: "Hip\t75%", amount: "S$4,000" }),
      st({ kind: "amount", text: "Between S$250 and S$500.", person: "Ah Kow", document: "D2", quote: "S$250", amount: "S$250 to S$500" }),
      st({ kind: "amount", text: "Toe pays S$90.", person: "Ah Kow", document: "D1", quote: "Toe fracture S$90", amount: "S$90" }),
    ] });
    assert.equal(answer.statements!.filter((s) => s.amount).length, 0);
    assert.equal(report.dropped.length, 3);
    assert.ok(answer.statements!.some((s) => s.text === LEFT_OUT_AMOUNT));
  });

  await check("a bare $ stays currency-unresolved; S$ printed in the quote is resolved", () => {
    const { answer } = verifyAnswer(HOUSE, { bottomLine: "", nextSteps: [], question: null, statements: [
      st({ kind: "amount", text: "Outpatient up to $90 a visit.", person: "Ah Kow", document: "D2", quote: "Outpatient\tup to $90 per visit", amount: "$90" }),
      st({ kind: "amount", text: "Recuperation S$250.", person: "Ah Kow", document: "D2", quote: "Accidental Hospital Recuperation Benefit\tS$250", amount: "$250" }),
    ] });
    const [a, b] = answer.statements!.filter((s) => s.amount);
    assert.deepEqual([a.amount!.text, a.amount!.currencyResolved], ["$90", false]);
    assert.deepEqual([b.amount!.text, b.amount!.currencyResolved], ["S$250", true]);
  });

  await check("people: a name maps to one household member; an unknown or ambiguous name gets no card owner", () => {
    assert.equal(matchMember(HOUSE, "Ah Kow"), "Lim Ah Kow");
    assert.equal(matchMember(HOUSE, "Mei Mei"), "Lim Mei Mei");
    assert.equal(matchMember(HOUSE, "Lim"), null);
    assert.equal(matchMember(HOUSE, "Ravi"), null);
    const { answer } = verifyAnswer(HOUSE, { bottomLine: "", nextSteps: [], question: null, statements: [st({ kind: "amount", text: "Recuperation S$250.", person: "Mei Mei", document: "D2", quote: "Accidental Hospital Recuperation Benefit S$250", amount: "S$250" })] });
    assert.match(answer.statements![0].source!.note!, /not linked to Lim Mei Mei/);
  });

  await check("the model's JSON is read defensively: wrong shapes become no answer", () => {
    assert.equal(readModelAnswer(null), null);
    assert.equal(readModelAnswer({ statements: [] }), null);
    const a = readModelAnswer({ bottomLine: "x", statements: [{ kind: "made_up", text: "y" }, { kind: "fact", text: "z" }], nextSteps: ["a", 3, "b", "c", "d"], question: " " });
    assert.equal(a?.statements.length, 1);
    assert.deepEqual(a?.nextSteps, ["a", "b", "c"]);
    assert.equal(a?.question, null);
  });

  const stub = (json: unknown): SimpleModel & { calls: unknown[] } => {
    const calls: unknown[] = [];
    return { choice: { provider: "anthropic", model: "claude-opus-5-5" }, calls, async call(args) { calls.push(args); return { json, stopReason: "end_turn", model: "claude-opus-5-5", usage: { input: 100, cacheWrite: 50000, cacheRead: 0, output: 400 } }; } };
  };
  const context = (accountId = HOUSE.accountId) => ({
    request: { accountId, familyMemberId: null, question: "I broke my wrist, how much?", submittedQuestion: "I broke my wrist, how much?" },
    family: [{ id: "m1", display_name: "Lim Ah Kow", preferred_name: "Ah Kow", relationship: "self" }], people: [],
    conversation: { id: "c1", account_id: accountId, family_member_id: "m1", title: "t", revision: 3, state: { subjects: {} } },
    token: {}, holdings: [],
  }) as unknown as ChatContext;

  await check("chat turn: answer saved with cards, bottom line as summary, the household's pages only", async () => {
    const model = stub(c2);
    const saved: { message: string; answer: unknown; state: unknown }[] = [];
    const result = await runSimpleChat(context(), {}, {
      model, household: async () => HOUSE, history: async () => [{ role: "user", text: "hi" }, { role: "assistant", text: "Hello." }],
      save: (async (a: { message: string; answer: unknown; state: unknown }) => { saved.push(a); }) as never,
    });
    assert.equal(saved.length, 1);
    assert.equal(saved[0].message, "I broke my wrist, how much?");
    const a = result.answer as ReturnType<typeof verifyAnswer>["answer"];
    assert.equal(a.summary, a.bottomLine);
    assert.equal(a.conversationRevision, 4);
    assert.equal(a.statements!.filter((s) => s.amount && s.personName).length, 3);
    assert.doesNotMatch(a.summary, /2,000/);
    const call = model.calls[0] as { library: string; question: string; history: unknown[] };
    assert.match(call.question, /This chat is about Lim Ah Kow/);
    assert.equal(call.history.length, 2);
    assert.ok(!call.library.includes("someone-else"));
    const state = saved[0].state as { simpleChat: { turns: { usage: { input: number; cached: number } }[] } };
    assert.deepEqual(state.simpleChat.turns[0].usage, { input: 100100, output: 400, cached: 0 });
  });

  await check("chat turn refuses a library read for another household", async () => {
    await assert.rejects(runSimpleChat(context(), {}, { model: stub(c2), household: async () => ({ ...HOUSE, accountId: "22222222-2222-2222-2222-222222222222" }), history: async () => [], save: (async () => undefined) as never }), /another household/);
  });

  await check("a model reply that is not an answer is saved as a plain 'couldn't answer', never as made-up text", async () => {
    const result = await runSimpleChat(context(), {}, { model: stub("not json"), household: async () => HOUSE, history: async () => [], save: (async () => undefined) as never });
    assert.match(result.answer.summary, /couldn’t put together an answer/);
  });

  await check("the saved answer survives the output guard and reopening, and is drawn as cards", () => {
    const { answer } = verifyAnswer(HOUSE, c2);
    enforceLiveChatMonetaryBoundary(answer, { claimContext: false });
    guardChatAnswer(answer);
    const reopened = sanitizeStoredAnswer(JSON.parse(JSON.stringify(answer))) as typeof answer;
    assert.equal(reopened.summary, answer.summary);
    assert.equal(reopened.statements!.length, answer.statements!.length);
    assert.ok(showsCards(reopened));
    const html = renderToStaticMarkup(createElement(AnswerCards, { answer: reopened, render: (t: string) => t, prose: [reopened.summary] }));
    assert.equal((html.match(/data-testid="answer-card"/g) ?? []).length, 3);
    assert.match(html, /Test Accident Plan · p\.13/);
    assert.match(html, /25% of S\$5,000/);
    assert.doesNotMatch(html, /S\$2,000|S\$1,750/);
  });

  await check("ledger usage counts cache writes at twice the input price", () => {
    assert.deepEqual(ledgerUsage({ input: 10, cacheWrite: 100, cacheRead: 1000, output: 5 }), { input: 1210, output: 5, cached: 1000 });
  });

  // The real household, when its snapshot is here (it is real data and lives outside the repo).
  if (existsSync(SNAPSHOT)) {
    const real = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Household;
    const desmond = real.members.find((m) => /Desmond/.test(m.name))!.name.split(" (")[0];
    await check("snapshot: the wrist row is on stored page 13 of the Product Summary (the page prints 'Page 12 of 36')", () => {
      const f = locateQuote(real, "Arm, Elbow, Wrist or Ribs 25%", 1);
      assert.ok(f);
      assert.equal(real.documents[f!.docIndex].name, "Product Summary.pdf");
      assert.equal(f!.page, 13);
    });
    await check("snapshot C2: fracture, ambulance and recuperation stay three separate cards, never summed or a range", () => {
      const { answer } = verifyAnswer(real, {
        bottomLine: "Desmond could get S$1,250 to S$2,000. In total that is S$2,000.", nextSteps: [], question: null,
        statements: [
          st({ kind: "amount", text: "Wrist fracture pays 25% of S$5,000.", person: "Desmond", document: "D2", quote: "Arm , Elbow, Wrist or Ribs 25%", percentOf: { percent: 25, baseAmount: "S$5,000" }, alternativeGroup: "a" }),
          st({ kind: "amount", text: "Ambulance up to S$500.", person: "Desmond", document: "D1", quote: "Ambulance Cost* Up to S$500 per incident", amount: "S$500", alternativeGroup: "a" }),
          st({ kind: "amount", text: "Recuperation S$250.", person: "Desmond", document: "D1", quote: "Accidental Hospital Recuperation Benefit* S$250", amount: "S$250", alternativeGroup: "a" }),
        ],
      });
      const cards = answer.statements!.filter((s) => s.amount);
      const label = "MINDEF & MHA Group Insurance (Product Summary)";
      assert.deepEqual(cards.map((s) => [s.amount!.text, s.personName, s.source!.policyName, s.source!.page, s.group]),
        [["S$1,250", desmond, label, 13, null], ["S$500", desmond, label, 13, null], ["S$250", desmond, label, 13, null]]);
      assert.doesNotMatch([answer.summary, answer.bottomLine].join(" "), /2,000|to S\$/);
    });
  } else console.log(`(snapshot checks skipped: ${SNAPSHOT} is not here)`);

  console.log(`${passed} checks passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
