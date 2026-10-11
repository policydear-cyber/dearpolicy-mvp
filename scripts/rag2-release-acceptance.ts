/**
 * Release acceptance (node --import tsx scripts/rag2-release-acceptance.ts; npm run rag2:release-test).
 *
 * Complete visible conversations through the REAL chat route (app/api/chat/route.ts -> lib/chat/workflow.ts -> the
 * rag2 loop -> saveTurn's output guard and save-time gate), PGlite with the real schema, the hand-authored synthetic
 * household in scripts/fixtures/rag2-release, and the TEST-ONLY scripted model standing in for the hosted model. The
 * script plays a model's tool calls (ids come from the real tools); what is asserted is what the household SEES and
 * what the system did with the model's actions -- never the script's own text. Expected figures are read off the
 * fixture pages by hand.
 *
 * Every scenario's visible conversation is printed (RELEASE_TRANSCRIPT=1) so baseline and candidate can be compared.
 */
import assert from "node:assert/strict";
import type { ChatAnswer } from "@/types";
import { setEnv, startHarness, type Harness } from "./fixtures/rag2-loop/harness";
import * as HH from "./fixtures/rag2-release/household";
import type { ScriptCall, ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";

const { M, doc } = HH;
const HOUSEHOLD = HH as unknown as Parameters<typeof startHarness>[0];
setEnv(HOUSEHOLD);
type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 10).join("\n     ")); }
}
export const visible = (a: ChatAnswer) => [a.summary, ...a.details, ...(a.questions ?? []).map((q) => "[Q] " + q.text), ...(a.nextSteps ?? []).map((n) => "[next] " + n)].join("\n");
const call = (name: string, args: Record<string, unknown>): ScriptCall => ({ name, arguments: args });
const pick = (v: ScriptView, name: string, where?: (o: any) => boolean) => { const o = v.find(name, where); if (!o?.ok) throw new Error("script: " + name + " failed: " + JSON.stringify(o?.result).slice(0, 300)); return o.result.data; };
const hit = (v: ScriptView, text: RegExp) => { for (const o of [...v.turn].reverse()) if (o.name === "search_passages" && o.ok) { const h = (o.result.data.hits as any[]).find((x) => text.test(`${x.text ?? ""} ${x.evidence?.excerpt ?? ""}`)); if (h) return h.evidence.evidence_id as string; } throw new Error("script: no passage like " + text); };
/** Verifier wording and internal labels that must never reach the household. */
export const DIAGNOSTIC = /cited page|figure is not bound|one column per person|save-time|evidence id|\bvalue id\b|\b[evr]\d+\b|left out is for|POLICY NO\.|FIGURE|gate/;

async function main() {
  const h: Harness = await startHarness(HOUSEHOLD);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const transcripts: string[] = [];
  const run = async (label: string, script: ScriptTurn[], messages: string[]) => {
    const model = new ScriptedLoopModel(script); installLoopModel(model);
    let conv: { id?: string; rev?: number } = {};
    const turns: { user: string; answer: ChatAnswer; text: string; trace: any; loop: any }[] = [];
    try {
      for (const m of messages) {
        const answer = await h.send(m, conv);
        conv = { id: answer.conversationId, rev: answer.conversationRevision };
        const saved = await h.savedAnswer(conv.id!);
        turns.push({ user: m, answer: saved.answer, text: visible(saved.answer), loop: saved.state.ragLoop, trace: saved.state.ragLoop?.turns.at(-1) });
      }
    } finally { installLoopModel(null); }
    const t = [`### ${label}`, ...turns.flatMap((x) => [`USER: ${x.user}`, `APP:  ${x.text.replace(/\n/g, "\n      ")}`, `      (steps=${x.trace?.steps} loop_ms=${x.trace?.latencyMs} gate=${JSON.stringify(x.trace?.gate ?? [])} tools=${(x.trace?.toolCalls ?? []).map((c: any) => c.name + (c.ok ? "" : "!")).join(",")})`, ...(process.env.RELEASE_TRANSCRIPT === "2" ? (x.trace?.dropped ?? []).map((d: any) => `      - dropped: ${d.sentence} -- ${d.reason}`) : []), ...(process.env.RELEASE_TRANSCRIPT === "2" ? (x.trace?.toolCalls ?? []).filter((c: any) => !c.ok).map((c: any) => `      ! ${c.name}: ${String(c.error ?? c.summary ?? "").slice(0, 600)}`) : [])])].join("\n");
    transcripts.push(t);
    if (process.env.RELEASE_TRANSCRIPT) console.log(t);
    return turns;
  };

  // ------------------------------------------------------------------------- A: the reproduced live failure
  // A household reports a death in a road accident. The model does what the live model did: resolves the person,
  // reads the certificate's roster row and the wording's death clause, and answers -- saying a date matters without
  // asking for it.
  const deathStatements = (v: ScriptView) => {
    const val = pick(v, "select_table_value");
    return [
      { text: "Alex's Certificate of Group Insurance lists his Group Personal Accident sum assured as S$600,000, as of 1 April 2024.", value_ids: [val.valueId], subject_id: M.alex.id },
      { text: "The policy wording says Death due to Accident pays 100% of the Sum Insured if the insured person dies as a direct result of an accident within 365 days of it.", evidence_ids: [hit(v, /Death due to Accident: if/)], subject_id: M.alex.id },
      { text: "It does not pay for death caused by competitive racing on wheels, except racing sanctioned by the Authority.", evidence_ids: [hit(v, /competitive racing/)], subject_id: M.alex.id },
    ];
  };
  const deathLookup = [
    () => [call("resolve_person", { mention: "Alex" })],
    (v: ScriptView) => [call("policies_for", { subject_id: pick(v, "resolve_person").person.id, topic: "accident death" })],
    (v: ScriptView) => [
      call("select_table_value", { policy_id: doc("CERT").id, benefit: "Group Personal Accident sum insured", subject_id: M.alex.id, want: "amount" }),
      call("search_passages", { query: "death due to accident", subject_id: M.alex.id }),
      call("search_passages", { query: "exclusions racing", subject_id: M.alex.id }),
    ],
  ];
  const A1 = await run("A1 death in a road accident (model answers without asking)", [
    { steps: [...deathLookup,
      (v) => { if (process.env.RELEASE_TRANSCRIPT === "2") console.log("tool result sizes:", v.turn.map((o) => o.name + "=" + JSON.stringify(o.result).length).join(" ")); if (process.env.RELEASE_DUMP) for (const o of v.turn) console.log("DUMP " + o.name + " " + JSON.stringify(o.result).slice(0, 2500)); return [call("final_answer", { subject_id: M.alex.id, sentences: [...deathStatements(v), { text: "Whether this is payable depends on the dates of the accident and of death." }], next_steps: ["Contact Harbourline Life to confirm cover on the date of death and what they need for a claim."] })]; },
      // If the system sends the answer back (asking for the open fact), the model asks it, keeping what it said.
      (v) => [call("ask_user", { kind: "fact", subject_id: M.alex.id, fact_key: "accident_and_death_dates", question: "On what date did the accident happen?", because_evidence_ids: [hit(v, /Death due to Accident: if/)], statements: deathStatements(v) })],
    ] },
  ], ["alex died in a motorbike accident"]);
  await check("A1 the certificate's S$600,000 is shown as the certificate's dated amount, with the wording's condition, and nothing internal", () => {
    const t = A1[0];
    assert.match(t.text, /S\$600,000/, "the roster figure is kept");
    assert.match(t.text, /1 April 2024/, "dated as the certificate prints it");
    assert.match(t.text, /365 days/, "the wording's condition");
    assert.doesNotMatch(t.text, DIAGNOSTIC, "no verifier commentary");
    assert.deepEqual(t.trace.gate, [], "the gate accepts the person's own row");
  });
  await check("A2 the date that changes the answer is asked as a question (one), not left as a dead end", () => {
    const t = A1[0];
    assert.equal(t.answer.questions?.length, 1, "one question card: " + t.text);
    assert.match(t.answer.questions![0].text, /date/i);
  });



  // ------------------------------------------------------------------ B: complete visible conversations
  const { RESUME_NOTE } = await import("@/lib/rag2/loop/hook");
  const lookup = (who: () => string, benefit: string, key = "CERT") => (v: ScriptView) => [call("select_table_value", { policy_id: doc(key).id, benefit, subject_id: who(), want: "amount" })];
  const askDate = (v: ScriptView) => [call("ask_user", { kind: "fact", subject_id: M.alex.id, fact_key: "accident_date", question: "On what date did the accident happen?", because_evidence_ids: [hit(v, /Death due to Accident: if/)], statements: deathStatements(v) })];

  const B1 = await run("B1 dates given in the first message: nothing is asked again; what the household said is kept apart from the documents", [
    { steps: [
      () => [call("resolve_person", { mention: "Alex" })],
      () => [call("note_facts", { subject_id: M.alex.id, facts: [
        { key: "accident_date", value: "2026-03-01", words: "the accident was on 1 March 2026" },
        { key: "date_of_death", value: "2026-03-03", words: "alex died in a motorbike accident on 3 March 2026" },
      ] })],
      ...deathLookup.slice(2).map((f) => (v: ScriptView) => { if (process.env.RELEASE_TRANSCRIPT === "2" && v.last[0]?.name === "note_facts") console.log("B1 note_facts:", JSON.stringify(v.last[0].result).slice(0, 800)); return f(v); }),
      (v) => [call("final_answer", { subject_id: M.alex.id, sentences: [...deathStatements(v), { text: "You told me the accident was on 1 March 2026 and Alex died on 3 March 2026." }], next_steps: ["Contact Harbourline Life to start the death claim."] })],
    ] },
  ], ["alex died in a motorbike accident on 3 March 2026, the accident was on 1 March 2026"]);
  await check("B1 dates supplied immediately: no question; the household's report is said as theirs; the dated certificate figure and the 365-day condition stand", () => {
    const t = B1[0];
    assert.equal(t.answer.questions?.length ?? 0, 0, t.text);
    assert.match(t.text, /You told me the accident was on 1 March 2026/);
    assert.match(t.text, /S\$600,000, as of 1 April 2024/); assert.match(t.text, /365 days/);
    if (process.env.RELEASE_TRANSCRIPT === "2") console.log("B1 claim state:", JSON.stringify(t.loop.claim).slice(0, 600));
    assert.ok(Object.values(t.loop.claim?.facts ?? {}).some((f: any) => /1 March 2026/.test(f.words ?? "")), "the accident date is recorded as the household's words");
    assert.doesNotMatch(t.text, DIAGNOSTIC);
  });

  const B2 = await run("B2 the asked date answered next turn: recorded, not asked again, the benefit explained again", [
    { steps: [...deathLookup, askDate] },
    { steps: [
      () => [call("note_facts", { subject_id: M.alex.id, facts: [{ key: "accident_date", value: "2026-03-01", words: "it happened on 1 March 2026" }, { key: "date_of_death", value: "2026-03-03", words: "he died on 3 March 2026" }] })],
      () => [call("select_table_value", { policy_id: doc("CERT").id, benefit: "Group Personal Accident sum insured", subject_id: M.alex.id, want: "amount" }), call("search_passages", { query: "death due to accident", subject_id: M.alex.id })],
      (v) => [call("final_answer", { subject_id: M.alex.id, sentences: [
        { text: "You told me the accident happened on 1 March 2026 and Alex died on 3 March 2026." },
        { text: "Alex's certificate lists his Group Personal Accident sum assured as S$600,000, as of 1 April 2024.", value_ids: [pick(v, "select_table_value").valueId], subject_id: M.alex.id },
        { text: "The policy wording says Death due to Accident pays 100% of the Sum Insured if the insured person dies as a direct result of an accident within 365 days of it.", evidence_ids: [hit(v, /Death due to Accident: if/)], subject_id: M.alex.id },
      ], next_steps: ["Contact Harbourline Life to confirm Alex was a member of the scheme on 1 March 2026 and to start the claim."] })],
    ] },
  ], ["alex died in a motorbike accident", "it happened on 1 March 2026 and he died on 3 March 2026"]);
  await check("B2 one question, answered once: turn 1 asks the date; turn 2 records it, asks nothing, and still gives the cited figure and condition", () => {
    assert.equal(B2[0].answer.questions?.length, 1);
    const t = B2[1];
    assert.equal(t.answer.questions?.length ?? 0, 0, t.text);
    assert.equal(t.loop.pending, null);
    assert.match(t.text, /You told me the accident happened on 1 March 2026/); assert.match(t.text, /S\$600,000, as of 1 April 2024/);
    assert.doesNotMatch(t.text, DIAGNOSTIC);
  });

  const B3 = await run("B3 a side question while the date is pending: answered, then the pending question put back", [
    { steps: [...deathLookup, askDate] },
    { steps: [
      () => [call("resolve_person", { mention: "Bea" })],
      () => [call("select_table_value", { policy_id: doc("EMP").id, benefit: "GP visit", subject_id: M.bea.id, want: "amount" })],
      (v) => [call("final_answer", { subject_id: M.bea.id, sentences: [{ text: "Bea's GP visit benefit under the Employee Group Outpatient Plan is S$30 per visit.", value_ids: [pick(v, "select_table_value").valueId], subject_id: M.bea.id }] })],
    ] },
  ], ["alex died in a motorbike accident", "by the way, what's Bea's GP visit limit?"]);
  await check("B3 side question: Bea's own spouse-column S$30 (never the employee S$40), then the accident-date question again", () => {
    const t = B3[1];
    assert.match(t.text, /S\$30 per visit/); assert.doesNotMatch(t.text, /S\$40/);
    assert.ok(t.answer.details.includes(RESUME_NOTE), t.text);
    assert.match(t.answer.questions?.[0]?.text ?? "", /accident/);
  });

  const B4 = await run("B4 pronoun and a correction of who is meant", [
    { steps: [
      () => [call("resolve_person", { mention: "Bea" })],
      lookup(() => M.bea.id, "Group Personal Accident sum insured"),
      (v) => [call("final_answer", { subject_id: M.bea.id, sentences: [{ text: "Bea's certificate lists her Group Personal Accident sum assured as S$400,000, as of 1 April 2024.", value_ids: [pick(v, "select_table_value").valueId], subject_id: M.bea.id }] })],
    ] },
    { steps: [
      () => [call("resolve_person", { mention: "her" })],
      (v) => [call("select_table_value", { policy_id: doc("CERT").id, benefit: "Group Term Life sum assured", subject_id: pick(v, "resolve_person").person.id, want: "amount" })],
      (v) => [call("final_answer", { subject_id: M.bea.id, sentences: [{ text: "Bea's certificate lists her Group Term Life sum assured as S$500,000, as of 1 April 2024.", value_ids: [pick(v, "select_table_value").valueId], subject_id: M.bea.id }] })],
    ] },
    { steps: [
      () => [call("resolve_person", { mention: "Alex" })],
      lookup(() => M.alex.id, "Group Term Life sum assured"),
      (v) => [call("final_answer", { subject_id: M.alex.id, sentences: [{ text: "Alex's certificate lists his Group Term Life sum assured as S$1,000,000, as of 1 April 2024.", value_ids: [pick(v, "select_table_value").valueId], subject_id: M.alex.id }] })],
    ] },
  ], ["what is Bea's group personal accident sum assured?", "and her group term life?", "sorry, I meant Alex's"]);
  await check("B4 'her' is Bea (S$500,000); the correction moves to Alex's own row (S$1,000,000), never Bea's figure", () => {
    assert.match(B4[0].text, /S\$400,000/); assert.match(B4[1].text, /S\$500,000/);
    assert.match(B4[2].text, /S\$1,000,000/); assert.doesNotMatch(B4[2].text, /S\$500,000|S\$400,000/);
    for (const t of B4) assert.doesNotMatch(t.text, DIAGNOSTIC);
  });

  const B5 = await run("B5 a corrected injury withdraws nothing it did not support and is said back", [
    { steps: [
      () => [call("resolve_person", { mention: "Cai" })],
      () => [call("note_facts", { subject_id: M.cai.id, facts: [{ key: "injury", value: "fractured arm", words: "Cai fractured his arm" }] })],
      () => [call("select_table_value", { policy_id: doc("ENDT").id, benefit: "Fracture (per fracture)", subject_id: M.cai.id, want: "amount" }), call("search_passages", { query: "fracture", subject_id: M.cai.id })],
      (v) => [call("final_answer", { subject_id: M.cai.id, sentences: [{ text: "Cai's FamilyShield fracture benefit is S$500 per fracture in the Child column from 1 July 2026.", value_ids: [pick(v, "select_table_value").valueId], subject_id: M.cai.id }] })],
    ] },
    { steps: [
      () => [call("note_facts", { subject_id: M.cai.id, facts: [{ key: "injury", value: "fractured leg", words: "actually it was his leg" }] })],
      () => [call("select_table_value", { policy_id: doc("ENDT").id, benefit: "Fracture (per fracture)", subject_id: M.cai.id, want: "amount" })],
      (v) => [call("final_answer", { subject_id: M.cai.id, sentences: [{ text: "Cai's FamilyShield fracture benefit is S$500 per fracture in the Child column from 1 July 2026, whichever bone it is.", value_ids: [pick(v, "select_table_value").valueId], subject_id: M.cai.id }] })],
    ] },
  ], ["Cai fractured his arm, what does FamilyShield pay?", "actually it was his leg"]);
  await check("B5 the endorsement's child after-value (S$500) for Cai; the correction is said back ('Updated: ...')", () => {
    assert.match(B5[0].text, /S\$500 per fracture/); assert.doesNotMatch(B5[0].text, /S\$1,000|S\$800/);
    assert.match(B5[1].text, /^Updated: injury is now fractured leg/); assert.match(B5[1].text, /S\$500/);
  });

  const B6 = await run("B6 a death from illness: the explicit illness exclusion, and the life cover's dated figure -- never the accident sum as payable", [
    { steps: [
      () => [call("resolve_person", { mention: "Alex" })],
      () => [call("search_passages", { query: "illness disease exclusion death", subject_id: M.alex.id }), call("select_table_value", { policy_id: doc("CERT").id, benefit: "Group Term Life sum assured", subject_id: M.alex.id, want: "amount" })],
      (v) => [call("final_answer", { subject_id: M.alex.id, sentences: [
        { text: "The Group Personal Accident wording says it does not pay for death or disablement caused by illness or disease.", evidence_ids: [hit(v, /illness or disease/)], subject_id: M.alex.id },
        { text: "Alex's certificate lists his Group Term Life sum assured as S$1,000,000, as of 1 April 2024.", value_ids: [pick(v, "select_table_value").valueId], subject_id: M.alex.id },
      ] })],
    ] },
  ], ["alex passed away from cancer"]);
  await check("B6 non-accident: the exclusion is cited; the term life figure is the certificate's dated amount; no accident figure", () => {
    const t = B6[0];
    assert.match(t.text, /does not pay for death or disablement caused by illness or disease/);
    assert.match(t.text, /S\$1,000,000, as of 1 April 2024/); assert.doesNotMatch(t.text, /S\$600,000/);
    assert.ok(t.answer.citations.some((c) => c.policyId === doc("PA_WORD").id && c.pageStart === 2));
  });

  const B7 = await run("B7 not stated vs excluded", [
    { steps: [
      () => [call("resolve_person", { mention: "Alex" })],
      () => [call("search_passages", { query: "dental treatment", subject_id: M.alex.id })],
      () => [call("final_answer", { subject_id: M.alex.id, sentences: [{ text: "The uploaded documents don't say whether dental treatment is covered under Alex's Group Personal Accident policy." }], next_steps: ["Ask Harbourline Life whether dental treatment after an accident is covered."] })],
    ] },
    { steps: [
      () => [call("search_passages", { query: "racing exclusion", subject_id: M.alex.id })],
      (v) => [call("final_answer", { subject_id: M.alex.id, sentences: [{ text: "The Group Personal Accident wording excludes death or injury caused by competitive racing on wheels, except racing sanctioned by the Authority.", evidence_ids: [hit(v, /competitive racing/)], subject_id: M.alex.id }] })],
    ] },
  ], ["is dental treatment covered under alex's personal accident policy?", "and motorbike racing?"]);
  await check("B7 absent information is said as absent (kept, uncited); an exclusion is said only with its clause", () => {
    assert.match(B7[0].text, /The uploaded documents don't say whether dental treatment is covered/); assert.doesNotMatch(B7[0].text, /excluded|not covered/);
    assert.match(B7[1].text, /excludes death or injury caused by competitive racing/);
    assert.ok(B7[1].answer.citations.some((c) => c.policyId === doc("PA_WORD").id));
  });

  const B8 = await run("B8 several policies for one person, a scanned schedule among them; another household's and a superseded copy refused", [
    { steps: [
      () => [call("resolve_person", { mention: "Alex" })],
      () => [call("select_table_value", { policy_id: doc("OTHER").id, benefit: "Group Personal Accident", subject_id: M.alex.id, want: "amount" }), call("select_table_value", { policy_id: doc("OLD").id, benefit: "Group Personal Accident", subject_id: M.alex.id, want: "amount" })],
      () => [call("select_table_value", { policy_id: doc("CERT").id, benefit: "Group Personal Accident sum insured", subject_id: M.alex.id, want: "amount" }), call("select_table_value", { policy_id: doc("SCAN").id, benefit: "Death", subject_id: M.alex.id, want: "amount" })],
      (v) => { const gpa = pick(v, "select_table_value", (o) => o.args.policy_id === doc("CERT").id), tl = pick(v, "select_table_value", (o) => o.args.policy_id === doc("SCAN").id); return [call("final_answer", { subject_id: M.alex.id, sentences: [
        { text: "Alex's certificate lists his Group Personal Accident sum assured as S$600,000, as of 1 April 2024.", value_ids: [gpa.valueId], subject_id: M.alex.id },
        { text: "His Harbourline Term schedule lists a Death sum assured of S$250,000.", value_ids: [tl.valueId], subject_id: M.alex.id },
      ] })]; },
    ] },
  ], ["what cover does alex have if he dies?"]);
  await check("B8 both of Alex's own policies (S$600,000 dated; S$250,000 from the scanned schedule); never the other household's S$900,000 or the superseded S$450,000", () => {
    const t = B8[0];
    assert.match(t.text, /S\$600,000, as of 1 April 2024/); assert.match(t.text, /S\$250,000/);
    assert.doesNotMatch(t.text, /S\$900,000|S\$450,000|S\$2,000,000/);
    assert.deepEqual(t.trace.gate, []);
  });

  const B9 = await run("B9 recovery fails: the model insists on another person's figure; the rest stands and the gap is said plainly", [
    { steps: [
      () => [call("resolve_person", { mention: "Bea" })],
      () => [call("select_table_value", { policy_id: doc("CERT").id, benefit: "Group Personal Accident sum insured", subject_id: M.alex.id, want: "amount" }), call("search_passages", { query: "death due to accident", subject_id: M.bea.id })],
      (v) => [call("final_answer", { subject_id: M.bea.id, sentences: [
        { text: "Bea's certificate lists her Group Personal Accident sum assured as S$600,000, as of 1 April 2024.", value_ids: [pick(v, "select_table_value").valueId], subject_id: M.bea.id },
        { text: "The policy wording says Death due to Accident pays 100% of the Sum Insured if the insured person dies as a direct result of an accident within 365 days of it.", evidence_ids: [hit(v, /Death due to Accident: if/)], subject_id: M.bea.id },
      ] })],
      (v) => [call("final_answer", { subject_id: M.bea.id, sentences: [
        { text: "Bea's certificate lists her Group Personal Accident sum assured as S$600,000, as of 1 April 2024.", value_ids: [pick(v, "select_table_value").valueId], subject_id: M.bea.id },
        { text: "The policy wording says Death due to Accident pays 100% of the Sum Insured if the insured person dies as a direct result of an accident within 365 days of it.", evidence_ids: [hit(v, /Death due to Accident: if/)], subject_id: M.bea.id },
      ] })],
    ] },
  ], ["what is bea's personal accident sum assured?"]);
  await check("B9 Alex's S$600,000 is never shown as Bea's; the wording's condition stands; one plain, specific line -- no gate wording", () => {
    const t = B9[0];
    assert.doesNotMatch(t.text, /S\$600,000/);
    assert.match(t.text, /365 days/);
    assert.match(t.text, /I haven’t stated the amount for Group Personal Accident in [^,]+ \(page 1\), because I couldn’t match it to Bea’s own entry in that document\./);
    assert.doesNotMatch(t.text, DIAGNOSTIC);
  });

  process.env.DEARPOLICY_RAG_LOOP_MAX_STEPS = "4";
  const B10 = await run("B10 the repair has budget: a turn at its call limit still gets the one correction", [
    { steps: [
      () => [call("resolve_person", { mention: "Alex" })],
      () => [call("select_table_value", { policy_id: doc("CERT").id, benefit: "Group Personal Accident sum insured", subject_id: M.alex.id, want: "amount" }), call("search_passages", { query: "death due to accident", subject_id: M.alex.id })],
      (v) => [call("search_passages", { query: "exclusions racing", subject_id: M.alex.id })],
      (v) => [call("final_answer", { subject_id: M.alex.id, sentences: [{ text: "Alex is currently covered for S$600,000 under Group Personal Accident.", value_ids: [pick(v, "select_table_value").valueId], subject_id: M.alex.id }] })],
      (v) => [call("final_answer", { subject_id: M.alex.id, sentences: [{ text: "Alex's certificate lists his Group Personal Accident sum assured as S$600,000, as of 1 April 2024.", value_ids: [pick(v, "select_table_value").valueId], subject_id: M.alex.id }] })],
    ] },
  ], ["how much is alex's personal accident cover?"]);
  delete process.env.DEARPOLICY_RAG_LOOP_MAX_STEPS;
  await check("B10 at the call limit (4), the dated-amount defect is repaired in the reserved fifth call: shown as the certificate's amount as of its date", () => {
    const t = B10[0];
    assert.equal(t.trace.steps, 5, "the reserved repair call was made");
    assert.match(t.text, /certificate lists his Group Personal Accident sum assured as S\$600,000, as of 1 April 2024/);
    assert.doesNotMatch(t.text, /currently covered/); assert.doesNotMatch(t.text, DIAGNOSTIC);
  });

  // ------------------------------------------------------------------ C: the evidence contract (save-time gate)
  // Real evidence from retrieval; bindings as the composer makes them; then deliberately mismatched copies.
  const T = await import("@/lib/rag2/tables");
  const { toFigureBinding } = await import("@/lib/rag2/evidence");
  const { verifyAnswerFigures } = await import("@/lib/chat/answer-verification");
  type Bound = import("@/types").BoundFigure;
  const ASOF = "2026-10-11";
  const sel = async (key: string, who: string, benefit: string, want: "amount" | "any" | "percent" = "amount", asOf = ASOF) => T.selectTableValue({ accountId: HH.ACCOUNT, policyId: doc(key).id, benefit, subject: { memberId: who }, want, asOf });
  const okv = async (key: string, who: string, benefit: string, want: "amount" | "any" = "amount", asOf = ASOF) => { const r = await sel(key, who, benefit, want, asOf); assert.equal(r.status, "ok", `${key} ${benefit}: ${JSON.stringify(r).slice(0, 300)}`); return r as Extract<typeof r, { status: "ok" }>; };
  const answerOf = (sentence: string, bindings: Bound[]) => ({ mode: "answer", summary: sentence, details: [], claimItems: [], nextSteps: [], confidence: null, citations: bindings.map((b) => ({ chunkId: "c", policyId: b.policyId, policyName: "x", pageStart: b.pageStart, pageEnd: b.pageEnd })), disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [], figureBindings: bindings } as unknown as ChatAnswer);
  const gate = async (sentence: string, b: Partial<Bound> & Record<string, unknown>, value: number, currency = "SGD") => (await verifyAnswerFigures(answerOf(sentence, [{ ...(b as Bound), sentence, value, currency }]), { accountId: HH.ACCOUNT, userText: "", report: true })).map((p) => p.reason);
  const bind = (r: Awaited<ReturnType<typeof okv>>) => { const b = toFigureBinding(r.evidence, r.rowLabel, r.value, "SGD"); assert.ok(b, "a binding"); return b!; };

  const alexGpa = await okv("CERT", M.alex.id, "Group Personal Accident sum insured");
  const ok1 = "Alex's certificate lists his Group Personal Accident sum assured as S$600,000, as of 1 April 2024.";
  await check("C1 the person's own row passes, carrying its layout, name cell and date from retrieval", async () => {
    const b = bind(alexGpa);
    assert.equal(b.layout, "person_row"); assert.equal(b.rowPerson, "Goh Wei Ming, Alex"); assert.equal(b.asOf, "2024-04-01");
    assert.deepEqual(await gate(ok1, b, 600000), []);
  });
  await check("C2 another person's row fails: Alex's row stated for Bea, or a binding whose name cell is swapped", async () => {
    const b = bind(alexGpa);
    assert.ok((await gate("Bea's certificate lists her Group Personal Accident sum assured as S$600,000, as of 1 April 2024.", { ...b, subjectId: M.bea.id }, 600000)).length >= 1);
    assert.ok((await gate(ok1, { ...b, rowPerson: "Tan Hui Min Bea" }, 600000)).length >= 1, "a name cell that does not hold the figure");
    assert.ok((await gate(ok1, { ...b, rowPerson: null }, 600000)).length >= 1, "a person_row binding with no name cell");
  });
  await check("C3 a dated certificate amount is not current cover: 'currently covered' and unattributed present-tense statements fail", async () => {
    const b = bind(alexGpa);
    const now = await gate("Alex is currently covered for S$600,000 under Group Personal Accident.", b, 600000);
    assert.ok(now.some((r) => /as of 2024-04-01/.test(r)), now.join("; "));
    assert.ok((await gate("Alex's Group Personal Accident sum assured is S$600,000.", b, 600000)).length >= 1);
    assert.ok((await gate("Alex will receive S$600,000 from Group Personal Accident.", b, 600000)).length >= 1);
    assert.deepEqual(await gate("Alex's certificate lists his Group Personal Accident sum assured as S$600,000 as of 1 April 2024; the insurer can confirm whether it still applies.", b, 600000), [], "a hedge about whether it still applies is not a claim of current cover");
  });
  await check("C4 wrong currency, wrong benefit (another product's row), wrong document version, another household's document all fail", async () => {
    const b = bind(alexGpa);
    assert.ok((await gate("Alex's certificate lists his Group Personal Accident sum assured as US$600,000, as of 1 April 2024.", b, 600000, "USD")).length >= 1, "currency");
    const gtl = bind(await okv("CERT", M.alex.id, "Group Term Life sum assured"));
    assert.ok((await gate("Alex's certificate lists his Group Personal Accident sum assured as S$1,000,000, as of 1 April 2024.", { ...gtl, benefit: "Group Personal Accident" }, 1000000)).length >= 1, "benefit heading");
    assert.ok((await gate(ok1, { ...b, documentHash: "sha256:release-cert-v0" }, 600000)).length >= 1, "version");
    assert.ok((await gate(ok1, { ...b, policyId: doc("OTHER").id }, 600000)).length >= 1, "other household");
    assert.ok((await gate(ok1, { ...b, policyId: doc("OLD").id, documentHash: doc("OLD").hash }, 600000)).length >= 1, "superseded certificate");
  });
  await check("C5 adult / child columns: the child's column passes for Cai; the adult column stated for Cai fails", async () => {
    const cai = await okv("FAMILY", M.cai.id, "Accidental death");
    assert.equal(cai.value, 50000); assert.equal(cai.evidence.table?.layout, "person_column");
    const b = bind(cai);
    assert.deepEqual(await gate("Cai's FamilyShield accidental death benefit is S$50,000 in the Child column.", b, 50000), []);
    const bea = bind(await okv("FAMILY", M.bea.id, "Accidental death"));
    assert.ok((await gate("Cai's FamilyShield accidental death benefit is S$200,000.", { ...bea, subjectId: M.cai.id }, 200000)).length >= 1);
  });
  await check("C6 employee / spouse columns: Bea's spouse column passes; the employee column stated for Bea fails", async () => {
    const bea = await okv("EMP", M.bea.id, "GP visit");
    assert.equal(bea.value, 30);
    assert.deepEqual(await gate("Bea's GP visit benefit under the Employee Group Outpatient Plan is S$30 per visit.", bind(bea), 30), []);
    const alex = bind(await okv("EMP", M.alex.id, "GP visit"));
    assert.ok((await gate("Bea's GP visit benefit under the Employee Group Outpatient Plan is S$40 per visit.", { ...alex, subjectId: M.bea.id }, 40)).length >= 1);
  });
  await check("C7 before / after: the endorsement's after column from its effective date, the before column before it (version columns, never people)", async () => {
    const after = await okv("ENDT", M.cai.id, "Fracture (per fracture)", "amount", "2026-10-11");
    assert.equal(after.value, 500);
    const before = await sel("FAMILY", M.cai.id, "Fracture (per fracture)", "amount", "2026-03-01");
    assert.equal(before.status, "ok"); if (before.status === "ok") assert.equal(before.value, 400);
  });
  await check("C8 a masked ID and an 'as of' date are never values; two amounts on one person's row bind to the named column only", async () => {
    const lc = await okv("CERT", M.alex.id, "Group Living Care", "any");
    assert.equal(lc.valueKind, "money"); assert.equal(lc.value, 350000);
    const daily = await okv("HC", M.bea.id, "hospital cash daily benefit");
    assert.equal(daily.value, 100); assert.equal(daily.columnHeader, "Daily benefit"); assert.equal(daily.evidence.table?.layout, "person_row"); assert.equal(daily.evidence.table?.asOf, "2024-04-01");
    const annual = await okv("HC", M.bea.id, "hospital cash annual limit");
    assert.equal(annual.value, 10000);
    const bd = bind(daily);
    assert.deepEqual(await gate("Bea's Group Hospital Cash schedule lists a daily benefit of S$100, effective 1 April 2024.", bd, 100), []);
    assert.ok((await gate("Bea's Group Hospital Cash schedule lists a daily benefit of S$10,000, effective 1 April 2024.", { ...bd, passage: bd.passage }, 10000)).length >= 1, "the other amount on the row under the daily column");
  });
  await check("C9 unresolved stays unresolved: an ambiguous name is asked, and a binding whose layout is not established fails", async () => {
    const P = await import("@/lib/rag2/people");
    const goh = await P.resolvePerson({ accountId: HH.ACCOUNT, mention: "Goh" });
    assert.equal(goh.status, "ambiguous");
    assert.ok((await gate(ok1, { ...bind(alexGpa), layout: "unresolved" }, 600000)).length >= 1);
  });
  await check("C10 isolation and superseded sources at retrieval: another household's and a superseded certificate are not readable", async () => {
    assert.notEqual((await sel("OTHER", M.alex.id, "Group Personal Accident")).status, "ok");
    assert.notEqual((await sel("OLD", M.alex.id, "Group Personal Accident")).status, "ok");
  });
  await check("C11 a lump sum from the certificate's sum assured and the wording's percentage (same policy) passes the gate at save time; a percentage from another policy is refused", async () => {
    const R2 = await import("@/lib/rag2/tools");
    const CT = await import("@/lib/rag2/calc/tool");
    const ON = { DEARPOLICY_RAG_TOOLS: "1", NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv;
    const ctx = R2.createToolContext({ accountId: HH.ACCOUNT, asOf: ASOF });
    const sv = ((await R2.runTool(ctx, "select_table_value", { policy_id: doc("CERT").id, benefit: "Group Personal Accident sum insured", subject_id: M.alex.id, want: "amount" }, ON)) as any).data;
    const pv = ((await R2.runTool(ctx, "select_table_value", { policy_id: doc("PA_WORD").id, benefit: "Fracture of arm", subject_id: M.alex.id, want: "percent" }, ON)) as any).data;
    assert.equal(pv.value, 20);
    const r = await R2.runTool(ctx, "calculate", { calculator: "lump_sum", purpose: "what_if", subject_id: M.alex.id, policy_id: doc("CERT").id, benefit: "Fracture of arm", sum_insured_value_id: sv.valueId, percent_value_id: pv.valueId, condition: "fractured arm", assumption_words: "if he fractured his arm" }, ON);
    assert.ok(r.ok, JSON.stringify(r).slice(0, 300));
    const out = CT.calcOutcomes(ctx).get((r as any).data.calc_id)!;
    assert.equal(out.amount, 120000);
    const sentence = "If Alex fractured his arm in an accident, an indicative illustration is S$120,000.";
    const a = { ...answerOf(sentence, []), calculations: out.record ? [{ ...out.record, sentence }] : [] } as unknown as ChatAnswer;
    assert.deepEqual((await verifyAnswerFigures(a, { accountId: HH.ACCOUNT, userText: "what if alex fractured his arm", report: true })).map((p) => p.reason), []);
    const other = await R2.runTool(ctx, "calculate", { calculator: "lump_sum", purpose: "what_if", subject_id: M.alex.id, policy_id: doc("HC").id, benefit: "Fracture of arm", sum_insured_value_id: sv.valueId, percent_value_id: pv.valueId, condition: "fractured arm", assumption_words: "if he fractured his arm" }, ON);
    assert.ok(!other.ok, "values from another policy are refused by the calculator");
  });

  console.log("\n" + transcripts.join("\n\n"));
  const failed = results.filter((r) => !r.ok);
  console.log(`\nrelease acceptance ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
