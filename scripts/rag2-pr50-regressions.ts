/**
 * V1.5: regressions at the failure boundaries of the live verification after PR #50 (15 Oct 2026), WRITTEN BEFORE THE
 * FIXES. The live records were not read from this session; the household (scripts/fixtures/rag2-pr50) follows the
 * report's description of the stored evidence, and the model moves are the report's recorded tool calls (scripted).
 * Every check reads the SAVED answer and what the chat route returned -- the full path tool -> calculation ->
 * composition -> save-time verification -> output guard -> saved answer.
 *   PR50_NAMES=plain|snake|uuid|digits node --import tsx scripts/rag2-pr50-regressions.ts
 * (the file-name variants are a hypothesis: the report does not give the live file names). Plumbing evidence, not
 * model results.
 */
import "./fixtures/legacy-contract";
import assert from "node:assert/strict";
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as P from "./fixtures/rag2-pr50/household";
import type { ScriptView } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";

const HOUSEHOLD = P as unknown as Parameters<typeof startHarness>[0];
setEnv(HOUSEHOLD);
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
const results: { name: string; ok: boolean }[] = [];
async function check(name: string, fn: () => Promise<void> | void) { try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); } catch (e) { results.push({ name, ok: false }); console.log("FAIL " + name + "\n     " + (e instanceof Error ? e.message : String(e)).split("\n").slice(0, 14).join("\n     ")); } }
const visibleOf = (a: any) => [a.summary, ...(a.details ?? []), ...(a.questions ?? []).map((q: any) => q.text), ...uniqueSteps(a.nextSteps)].filter(Boolean).join("\n");
const NAMES = (process.env.PR50_NAMES as P.NameVariant) || "plain";
const controls: Record<string, any> = {};

async function main() {
  const h = await startHarness(HOUSEHOLD);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const run = async (turns: { user: string; steps: ((v: ScriptView) => any[])[] }[]) => {
    installLoopModel(new ScriptedLoopModel(turns as any));
    const out: { v: string; returned: string; answer: any; trace: any; state: any; ms: number }[] = [];
    try {
      let c: { id?: string; rev?: number } = {};
      for (const t of turns) { const t0 = Date.now(); const a = await h.send(t.user, c); const ms = Date.now() - t0; c = { id: a.conversationId, rev: a.conversationRevision }; const s = await h.savedAnswer(c.id!); out.push({ v: visibleOf(s.answer), returned: visibleOf(a), answer: s.answer, trace: s.state.ragLoop.turns.at(-1), state: s.state, ms }); if (process.env.PR50_SHOW) console.log(`\n=== VISIBLE [${t.user.slice(0, 60)}]\n${visibleOf(s.answer)}\n===${s.answer.calculations?.length ? "\nSAVED CALCULATION " + JSON.stringify(s.answer.calculations) : ""}`); }
    } finally { installLoopModel(null); }
    return out;
  };
  const A = P.M.adrian.id, C = P.M.cheryl.id;
  const pbOf = (v: ScriptView) => { const o = [...v.turn].reverse().find((x) => x.name === "person_benefits"); return ((o?.result?.data?.documents ?? []) as any[]).flatMap((d) => (d.benefits as any[]).map((b) => ({ ...b, product: d.product, policy_id: d.policy_id }))); };
  const vidOf = (v: ScriptView, re: RegExp) => pbOf(v).find((b) => re.test(b.benefit) && b.value_id)?.value_id as string | undefined;
  const hitOf = (v: ScriptView, re: RegExp) => { for (const o of [...v.turn].reverse()) if ((o.name === "search_passages" || o.name === "read_page") && o.ok) { const hits = ((o.result?.data?.hits ?? []) as any[]); const hit = hits.find((x) => re.test(JSON.stringify(x))); if (hit) return hit.evidence.evidence_id as string; if (o.name === "read_page" && re.test(JSON.stringify(o.result))) return (JSON.stringify(o.result).match(/"evidence_id":"(e\d+)"/) ?? [])[1] ?? "none"; } return "none"; };
  const calcs = (x: any) => (x.trace.toolCalls as any[]).filter((c) => c.name === "calculate");
  const docOps = (x: any) => ((x.answer.calculations ?? [])[0]?.operands ?? []).filter((o: any) => o.source === "document");

  if (NAMES === "plain" || process.env.PR50_CONTROL_OUT) {
    // ------------------------------------------------ D: the fixed-limit fracture illustration (report conversation D)
    const D = "Hypothetical document-arithmetic test for Adrian: in the uploaded Summary of Benefits, Simple Fracture has a S$5,000 limit and a Leg row of 50%. If that provision applies, what is the illustration? Distinguish this from the separate Other Fracture provision and do not promise a payment.";
    const SUM = P.doc("SUMMARY").id;
    let e15 = "none", v1: string | undefined;
    const fractureTurn = (secondBase: (v: ScriptView) => string | undefined) => ({ user: D, steps: [
      () => [call("person_benefits", { subject_id: A, topic: "simple fracture leg" })],
      (v: ScriptView) => { v1 = vidOf(v, /Term Life/); return [call("search_passages", { query: "Simple Fracture Benefit Limit leg percentage", policy_ids: [SUM], subject_id: A })]; },
      // the recorded first call: proportion e15, applies_when Leg, an empty base_value_id
      (v: ScriptView) => { e15 = hitOf(v, /\(% of S\$5,000\)/); return [call("calculate", { calculator: "lump_sum", purpose: "what_if", subject_id: A, policy_id: SUM, benefit: "Simple Fracture", condition: "Leg", proportion: { evidence_id: e15, applies_when: "Leg" }, base_value_id: "", assumption_words: "If that provision applies" })]; },
      // the recorded second call: the same, with base_value_id v1 (Adrian's Group Term Life S$1,000,000)
      (v: ScriptView) => [call("calculate", { calculator: "lump_sum", purpose: "what_if", subject_id: A, policy_id: SUM, benefit: "Simple Fracture", condition: "Leg", proportion: { evidence_id: e15, applies_when: "Leg" }, base_value_id: secondBase(v), assumption_words: "If that provision applies" })],
      (v: ScriptView) => { const ok = [...v.turn].reverse().find((o) => o.name === "calculate" && o.ok); return [call("final_answer", { subject_id: A, sentences: ok ? [
        { text: `If the Simple Fracture benefit applies, the conditional illustration is S$${Number(ok.result.data.amount).toLocaleString("en-SG")} (50% of the S$5,000 Simple Fracture Benefit Limit); it is not a promised payment.`, result_id: ok.result.data.calc_id, subject_id: A },
        { text: "Other Fracture is a separate benefit, a percentage of the Sum Insured rather than of the Simple Fracture Benefit Limit.", evidence_ids: [e15], subject_id: A },
      ] : [
        // what the live model wrote when no calculation succeeded
        { text: "If the Simple Fracture provision applies to a leg fracture due to an Accident, the illustration would be 50% of the S$5,000 limit, which is S$2,500.", evidence_ids: [e15], subject_id: A },
      ] })]; },
    ] });
    const [d1] = await run([fractureTurn(() => v1)]); controls.P50D = d1;
    const [first, second] = calcs(d1);
    await check(`D0 [${P.PAGE}] the retrieved passage e15 is the stored page's own span (page 13, exact offsets) and holds the limit, the "% of S$5,000" header and the leg row; its support excerpt is narrower`, () => {
      const ev = d1.state?.ragLoop?.evidence?.[e15];
      const hit = (d1.trace.toolCalls as any[]).find((c) => c.name === "search_passages");
      assert.ok(hit?.evidenceIds?.includes(e15), JSON.stringify(hit));
      const e = ev; assert.ok(e, "e15 is stored in the conversation state");
      {
        const page = (P.PAGE === "plain" ? P.SUM_P13_PLAIN : P.SUM_P13_TABS);
        assert.equal(page.slice(e.passage.start, e.passage.end), e.passage.text, "offsets are the page's own");
        if (P.PAGE === "tabs") {
          // the report's e15: limit, "(% of S$5,000)", Neck/Skull 100%, Hip 75%, Leg 50% -- and a support excerpt of the limit line only
          assert.ok(e.passage.text.startsWith("Simple Fracture Benefit Limit: S$5,000") && /\(% of S\$5,000\)/.test(e.passage.text) && /Hip\t75%/.test(e.passage.text) && e.passage.text.endsWith("Jaw, Pelvis, Leg^, Ankle or Knee\t50%"), e.passage.text);
          assert.equal(e.support?.text, "Simple Fracture Benefit Limit: S$5,000");
        }
        if (process.env.PR50_SHOW) console.log("E15", JSON.stringify({ page: e.passage.onPage, start: e.passage.start, end: e.passage.end, text: e.passage.text, support: e.support ?? null }));
      }
    });
    await check("D1 the recorded calls on the plain-text page 13 (proportion e15, applies_when \"Leg\"): the first call resolves the leg row (50%) and the S$5,000 limit within the Simple Fracture section", () => {
      assert.notEqual(e15, "none", "search_passages returned the page-13 passage");
      assert.ok(first?.ok, JSON.stringify(first));
    });
    await check("D2 the second call's base_value_id v1 (Adrian's Group Term Life S$1,000,000) is never used as the Simple Fracture base: the percentage is of the printed S$5,000 limit, and the result says v1 was not used", () => {
      assert.ok(second?.ok, JSON.stringify(second));
      assert.match(JSON.stringify(second.summary ?? second.result ?? ""), /2500/);
      assert.ok(!JSON.stringify(d1.answer.calculations ?? []).includes("1000000"), "Term Life is not an operand");
    });
    await check("D3 the conditional S$2,500 reaches the saved and returned answer, from a saved calculation whose operands are source-bound (leg row 50% and the S$5,000 limit line, Summary of Benefits page 13) and which re-verifies", async () => {
      assert.match(d1.v, /conditional illustration is S\$2,500/, d1.v + "\n" + JSON.stringify(d1.trace.gate));
      assert.equal(d1.v, d1.returned);
      const ops = docOps(d1);
      assert.ok(ops.some((o: any) => o.value === 50 && o.binding?.policyId === SUM && o.binding?.pageStart === 13 && /Jaw, Pelvis, Leg\^?, Ankle or Knee\s+50%/.test(o.row)), JSON.stringify(ops));
      assert.ok(ops.some((o: any) => o.value === 5000 && o.binding?.policyId === SUM && /Simple Fracture Benefit Limit: S\$5,000/.test(o.row)), JSON.stringify(ops));
      const { recomputeCalculation } = await import("@/lib/claims/calc-record");
      const re = recomputeCalculation(d1.answer.calculations[0]); assert.ok(re.ok && re.resultMinor === 250000, JSON.stringify(re));
      const { verifyAnswerFigures } = await import("@/lib/chat/answer-verification");
      assert.deepEqual(await verifyAnswerFigures(JSON.parse(JSON.stringify(d1.answer)), { accountId: P.ACCOUNT, userText: D }), []);
    });
    await check("D4 no unrelated benefit enters the fracture answer (no \"Death due to Accident\", no Compassionate Death Allowance, no Term Life)", () => {
      assert.ok(!/Death due to|Compassionate|Term Life|•/.test(d1.v), d1.v);
    });
    // The live failure state: the calculation does NOT succeed (an ambiguous condition); the fallback stays on topic.
    // As live: person_benefits first (its value ids are what the model cites with the limit), then the passage.
    let sfLimit: string | undefined;
    const amb = { user: D, steps: [
      () => [call("person_benefits", { subject_id: A, topic: "simple fracture leg" })],
      (v: ScriptView) => { sfLimit = vidOf(v, /Simple Fracture/); return [call("search_passages", { query: "Simple Fracture Benefit Limit leg percentage", policy_ids: [SUM], subject_id: A })]; },
      (v: ScriptView) => { e15 = hitOf(v, /\(% of S\$5,000\)/); return [call("calculate", { calculator: "lump_sum", purpose: "what_if", subject_id: A, policy_id: SUM, benefit: "Simple Fracture", condition: "leg or hip", proportion: { evidence_id: e15, applies_when: "leg or hip" }, assumption_words: "If that provision applies" })]; },
      (v: ScriptView) => [call("final_answer", { subject_id: A, sentences: [{ text: "If the Simple Fracture provision applies to a leg fracture due to an Accident, the illustration would be 50% of the S$5,000 limit, which is S$2,500.", evidence_ids: [e15], ...(sfLimit ? { value_ids: [sfLimit] } : {}), subject_id: A }] })],
    ] };
    const [d5] = await run([amb]);
    // Reliable chat (contract C): the model's own unverified-arithmetic sentence is omitted WHOLE (it is not trimmed into a
    // different claim); the verified terms of an unresolved benefit are the server's benefit_terms statement, exercised
    // on the migrated contract by scripts/reliable-chat-slice.ts (V5 / V6, this household) and stage 3.
    await check("D5 when the calculation is genuinely unresolved, the unverified arithmetic is omitted whole -- never another benefit's label (\"Death due to Accident\") and never unverified arithmetic -- and the refusal names the rows", () => {
      assert.ok(!/Death due to|Compassionate|•/.test(d5.v), d5.v + "\n(limit value id: " + String(sfLimit) + ")");
      assert.ok(!/S\$2,500/.test(d5.v), "no unverified S$2,500: " + d5.v);
      assert.ok((d5.trace.dropped ?? []).some((d: any) => /S\$2,500/.test(d.sentence)), JSON.stringify(d5.trace.dropped));
      const err = String(calcs(d5)[0]?.result?.error ?? calcs(d5)[0]?.error ?? "");
      assert.match(err, /v\d+ = “Jaw, Pelvis, Leg\^?, Ankle or Knee” 50%/, "the refusal offers the rows as value ids: " + err);
    });
    // Negative controls
    const neg = async (args: (v: ScriptView) => Record<string, unknown>, user = D, subject = A) => (await run([{ user, steps: [
      () => [call("person_benefits", { subject_id: A }), call("search_passages", { query: "Simple Fracture Benefit Limit leg percentage", policy_ids: [SUM], subject_id: A }), call("read_page", { policy_id: P.doc("WORDING").id, page: 1 })],
      (v: ScriptView) => { e15 = hitOf(v, /\(% of S\$5,000\)/); v1 = vidOf(v, /Term Life/); return [call("calculate", { calculator: "lump_sum", purpose: "what_if", subject_id: subject, policy_id: SUM, benefit: "Simple Fracture", condition: "Leg", assumption_words: "If that provision applies", ...args(v) })]; },
      () => [call("final_answer", { subject_id: subject, sentences: [{ text: "I could not work out the Simple Fracture amount.", subject_id: subject }] })],
    ] }]))[0];
    const n1 = await neg((v) => ({ percent_value_id: vidOf(v, /Term Life/), base_value_id: vidOf(v, /Term Life/) }));
    const n2 = await neg(() => ({ proportion: { evidence_id: e15, applies_when: "Leg" } }), D.replace(/Adrian/g, "Cheryl"), C);
    const n3 = await neg((v) => ({ proportion: { evidence_id: hitOf(v, /Other Fracture\) 50%/), applies_when: "Leg" } }));
    await check("D6 negative controls: Term Life v1 passed as the percentage is refused (a printed amount, not a percentage, and no single row is named); the passage retrieved for Adrian is refused for Cheryl; the adjacent Other Fracture table (another document) cannot supply Simple Fracture's row", () => {
      assert.equal(calcs(n1)[0].ok, false, JSON.stringify(calcs(n1)[0])); assert.deepEqual(n1.answer.calculations ?? [], []);
      assert.equal(calcs(n2)[0].ok, false, JSON.stringify(calcs(n2)[0])); assert.match(String(calcs(n2)[0].error ?? calcs(n2)[0].result?.error), /another person/);
      assert.equal(calcs(n3)[0].ok, false, JSON.stringify(calcs(n3)[0])); assert.match(String(calcs(n3)[0].error ?? calcs(n3)[0].result?.error), /another document/);
    });

    // ------------------------------------------------ A: death conversation -- contact advice and uncertainty
    const DEATH = "Hypothetical test: Adrian died in a car accident in Japan. Based on my uploaded documents, what can I do?";
    const amounts = (v: ScriptView) => [
      { text: "Adrian’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022.", value_ids: [vidOf(v, /Term Life/)], subject_id: A },
      { text: "The same certificate lists Group Personal Accident of S$600,000 as of 6 October 2022.", value_ids: [vidOf(v, /^Group Personal Accident$/)], subject_id: A },
    ];
    const [a1] = await run([{ user: DEATH, steps: [
      () => [call("person_benefits", { subject_id: A, topic: "death after an accident" }), call("read_page", { policy_id: P.doc("SUMMARY").id, page: 9 })],
      (v: ScriptView) => [call("final_answer", { subject_id: A, sentences: [
        ...amounts(v),
        { text: "The documents do not establish that Adrian is enrolled for the Compassionate Death Allowance.", evidence_ids: [hitOf(v, /Compassionate Death Allowance/)], subject_id: A },
      ], next_steps: [
        "Contact Kestrel Life Ltd through the scheme administrator to report the death, and ask Harbourline General whether a travel policy covered the trip.",
        "Contact Harbourline General to claim the travel benefit.",
      ] })],
    ] }]);
    controls.P50A = a1;
    // Grader control for pr50a-live-2 (the death next-steps prompt alone, both dates in one message): a compliant answer
    // produced by the full scripted pipeline -- dated amounts, an uncertainty about cover on the event date, a contact step.
    const DEATH_DATED = "Hypothetical test: Adrian died in a car accident in Japan. The accident happened on 3 October 2026 and he died on 5 October 2026. Based on my uploaded documents, explain which death benefits may apply and what I should do next.";
    const [a2] = await run([{ user: DEATH_DATED, steps: [
      () => [call("person_benefits", { subject_id: A, topic: "death after an accident" }), call("search_passages", { query: "certificate Group Personal Accident Group Term Life", policy_ids: [P.doc("CERT").id], subject_id: A })],
      (v: ScriptView) => [call("final_answer", { subject_id: A, sentences: [
        amounts(v)[0],
        { text: "The same certificate lists Group Personal Accident of S$600,000 as of 6 October 2022; the documents do not establish whether that cover was still in force on 5 October 2026.", value_ids: [vidOf(v, /^Group Personal Accident$/)], subject_id: A },
      ], next_steps: ["Contact Kestrel Life Ltd through the scheme administrator to report the death and ask what it needs for a claim."] })],
    ] }]);
    controls.P50A2 = a2;
    if (process.env.PR50_SHOW) console.log("A2CTL", a2.v, JSON.stringify(a2.trace.dropped));
    await check("A1 an uncertainty about enrolment (\"do not establish that Adrian is enrolled\") is kept -- not treated as an exclusion", () => {
      assert.match(a1.v, /do not establish that Adrian is enrolled for the Compassionate Death Allowance/, a1.v + JSON.stringify(a1.trace.dropped));
    });
    await check("A2 a supported contact step survives removal of the unrelated insurer's clause: \"Contact Kestrel Life Ltd through the scheme administrator to report the death\" is kept, the Harbourline clause and the Harbourline-only step are not", () => {
      assert.match(a1.v, /Contact Kestrel Life Ltd through the scheme administrator to report the death/, a1.v + JSON.stringify(a1.trace.dropped));
      assert.ok(!/Harbourline/.test(a1.v), a1.v);
    });
    await check("A3 the dated Term Life and PA amounts stay, each bound to Adrian's own certificate row", () => {
      assert.match(a1.v, /Group Term Life of S\$1,000,000 as of 6 October 2022/); assert.match(a1.v, /Group Personal Accident of S\$600,000 as of 6 October 2022/);
    });
    // A, turn 2 (dates given): the live model's rejected sentence, anonymised with its clause structure and sources --
    // a description of the wording's benefit, its proof requirement, the two schemes, and an uncertainty about this
    // person's Sum Insured and enrolment. Expectations written before any change.
    const DATES = "For this hypothetical, the accident happened on 3 October 2026 and he died on 5 October 2026. Explain which death benefits may apply and what I should do next.";
    const CDA = "The Public Officers wording also describes a Compassionate Death Allowance Benefit for accidental death, requiring proof of death and relevant documents in the insurer’s prescribed form, and says it can be claimed under either the Core Scheme or Voluntary Scheme; the uploaded documents do not establish Adrian’s applicable Sum Insured or scheme enrollment for this benefit.";
    // negative control: the same sentence with one clause the wording does not print
    const CDA_BAD = "The Public Officers wording also describes a Compassionate Death Allowance Benefit for accidental death, requiring proof of death and relevant documents in the insurer’s prescribed form, and says it is payable only to a surviving spouse; the uploaded documents do not establish Adrian’s applicable Sum Insured or scheme enrollment for this benefit.";
    const cdaTurn = (text: string) => ({ user: DATES, steps: [
      () => [call("search_passages", { query: "Compassionate Death Allowance Benefit proof of death prescribed form Core Scheme Voluntary Scheme", policy_ids: [P.doc("WORDING").id], subject_id: A })],
      (v: ScriptView) => [call("final_answer", { subject_id: A, sentences: [{ text, evidence_ids: [hitOf(v, /Compassionate Death Allowance Benefit/)], subject_id: A }] })],
    ] });
    const deathTurn1 = { user: DEATH, steps: [() => [call("person_benefits", { subject_id: A, topic: "death after an accident" })], (v: ScriptView) => [call("final_answer", { subject_id: A, sentences: amounts(v) })]] };
    const [, a4] = await run([deathTurn1, cdaTurn(CDA)]);
    const [, a5] = await run([deathTurn1, cdaTurn(CDA_BAD)]);
    if (process.env.PR50_SHOW) console.log("A4 dropped", JSON.stringify(a4.trace.dropped), "\nA5 dropped", JSON.stringify(a5.trace.dropped));
    await check("A4 the live uncertainty sentence: each clause is checked on its own -- the benefit, its proof requirement and the two schemes (printed in the wording) and the uncertainty about Adrian's Sum Insured and enrolment are all kept; nothing is called an exclusion", () => {
      const why = a4.v + "\n" + JSON.stringify(a4.trace.dropped);
      assert.match(a4.v, /Compassionate Death Allowance Benefit for accidental death/, why);
      assert.match(a4.v, /proof of death and relevant documents in the insurer’s prescribed form/, why);
      assert.match(a4.v, /either the Core Scheme or Voluntary Scheme/, why);
      assert.match(a4.v, /do not establish Adrian’s applicable Sum Insured or scheme enrollment for this benefit/, why);
      assert.ok(!JSON.stringify(a4.trace.dropped ?? []).match(/exclu/i), why);
    });
    // Reliable chat (contract C): a dependent clause the wording does not print (", and says it is payable only to a
    // surviving spouse") makes its statement unsupported, and the statement is omitted WHOLE -- the remaining clauses are
    // not re-stated as if the document said only them. The separate uncertainty statement stays.
    await check("A5 negative control: a clause the wording does not print (\"payable only to a surviving spouse\") makes its statement omitted whole; the separate uncertainty stays", () => {
      const why = a5.v + "\n" + JSON.stringify(a5.trace.dropped);
      assert.ok(!/surviving spouse/.test(a5.v), why);
      assert.ok(!/prescribed form/.test(a5.v), why);
      assert.ok((a5.trace.dropped ?? []).some((d: any) => /surviving spouse/.test(d.sentence)), why);
      assert.match(a5.v, /do not establish Adrian’s applicable Sum Insured or scheme enrollment for this benefit/, why);
    });
    // ------------------------------------------------ B: direct amounts and person switching
    const [b1, b2] = await run([
      { user: "What are Adrian's Group Term Life and Group Personal Accident sum assured amounts in his uploaded certificate? Keep the products separate and give the certificate date.", steps: [() => [call("person_benefits", { subject_id: A })], (v: ScriptView) => [call("final_answer", { subject_id: A, sentences: amounts(v) })]] },
      { user: "Now switch to Cheryl. Is her Personal Accident sum assured S$1,000,000? Correct me from her own certificate row, and distinguish it from her Term Life.", steps: [() => [call("person_benefits", { subject_id: C })], (v: ScriptView) => [call("final_answer", { subject_id: C, sentences: [
        { text: "No—Cheryl’s certificate lists Group Personal Accident of S$600,000 as of 6 October 2022, not S$1,000,000.", value_ids: [vidOf(v, /^Group Personal Accident$/)], subject_id: C },
        { text: "Separately, it lists her Group Term Life of S$1,000,000 as of 6 October 2022.", value_ids: [vidOf(v, /Term Life/)], subject_id: C },
      ] })]] },
    ]);
    await check("B1 direct amounts and person switching remain correct", () => {
      assert.match(b1.v, /Group Term Life of S\$1,000,000/); assert.match(b1.v, /Group Personal Accident of S\$600,000/);
      assert.match(b2.v, /Cheryl’s certificate lists Group Personal Accident of S\$600,000 as of 6 October 2022, not S\$1,000,000/, b2.v); assert.match(b2.v, /Group Term Life of S\$1,000,000/);
      assert.equal(b2.answer.resolvedFamilyMemberId, C);
    });
  }

  // ------------------------------------------------ C: the full inventory, by document identity (every name variant)
  const ASK = "What policies does my family have? List my uploaded documents by person, insurer and product. Distinguish personal certificates from reference wording and unreadable files.";
  const peopleOf = (v: ScriptView) => (([...v.turn].reverse().find((x) => x.name === "household_documents")?.result?.data ?? {}) as any);
  // the live model named every readable document itself (the travel insurer's two by their file names) and wrote its own
  // unreadable-file sentence citing a readable document's evidence
  const modelLines = (v: ScriptView) => { const d = peopleOf(v); const ppl = (d.people ?? []) as any[]; const unl = (d.unlinked ?? []) as any[];
    const ev = ppl.flatMap((p) => (p.documents as any[]).map((x) => x.evidence?.evidence_id)).filter(Boolean);
    return [
      ...ppl.filter((p) => p.documents.length).map((p: any) => ({ text: `${p.short}: ${(p.documents as any[]).map((x) => `${x.name} (${x.insurer}${x.kind === "personal" ? ", personal certificate" : ", reference wording"})`).join("; ")}.`, evidence_ids: (p.documents as any[]).map((x) => x.evidence?.evidence_id).filter(Boolean) })),
      ...ppl.filter((p) => !p.documents.length).map((p: any) => ({ text: `${p.short} has no documents on file.` })),
      { text: `Linked to nobody: ${unl.filter((x) => x.readable === "ready").map((x) => `${x.filename} (${x.insurer}, reference wording)`).join("; ")}.`, evidence_ids: unl.map((x) => x.evidence?.evidence_id).filter(Boolean) },
      { text: `${unl.find((x) => x.readable !== "ready")?.filename} could not be read.`, evidence_ids: ev.slice(0, 1) },
    ]; };
  const [c1] = await run([{ user: ASK, steps: [() => [call("household_documents", {})], (v: ScriptView) => [call("final_answer", { sentences: modelLines(v) })]] }]);
  const [c2] = await run([{ user: ASK, steps: [() => [call("household_documents", {})], () => [call("final_answer", { sentences: [{ text: "Here are the documents on file for your household." }] })]] }]);
  const shownFor = (d: (typeof P.DOCS)[number]) => [d.product, d.filename, d.filename?.replace(/\.[a-z0-9]+$/i, "")].filter((x): x is string => !!x && x.trim().length > 0);
  for (const [label, x] of [["model's own lines", c1], ["inventory lines", c2]] as const) await check(`C [${NAMES} file names, ${label}] every eligible upload survives to the saved and returned answer by document identity (five readable, the failed one with its status); deleted and other-household documents are absent; reference wording is not presented as personal cover`, () => {
    if (process.env.PR50_SHOW) console.log("C dropped", label, JSON.stringify(x.trace.dropped));
    const missing = P.ELIGIBLE.map((k) => P.doc(k)).filter((d) => !shownFor(d).some((n) => x.v.includes(n)));
    assert.deepEqual(missing.map((d) => d.key), [], `missing: ${missing.map((d) => d.key)}\nsaved:\n${x.v}\ncomposed:\n${(x.trace.composed ?? []).join("\n")}`);
    assert.equal(x.v, x.returned);
    assert.ok(!/Old Benefit Summary|other household/.test(x.v), x.v);
    assert.match(x.v, /could not be read/);
    for (const k of ["TRAVEL_WORDING", "TRAVEL_SUMMARY"]) { const d = P.doc(k); const line = x.v.split("\n").find((l) => shownFor(d).some((n) => l.includes(n))) ?? ""; assert.ok(!/personal (?:policy document|certificate)/.test(line.split(";").find((s) => shownFor(d).some((n) => s.includes(n))) ?? ""), line); }
    assert.ok((x.answer.citations ?? []).length > 0);
  });
  // Negative control for the output-guard repair: only the household's own library names are protected.
  await check(`G [${NAMES}] the output guard still drops an internal identifier or id that is not one of the answer's library names`, async () => {
    const { guardChatAnswer } = await import("@/lib/chat/output-guard");
    const names = P.ELIGIBLE.map((k) => P.doc(k)).flatMap((d) => [d.product, d.filename]).filter((x): x is string => !!x);
    const a: any = guardChatAnswer({ summary: "Here are your documents.", details: [`Linked to nobody: ${names.filter(Boolean).join("; ")}.`, "Stored in policy_benefits as row 7e800000-0000-4000-8000-000000000102.", "travel_secret_table holds it."], libraryNames: names } as any);
    assert.equal(a.details.length, 1, JSON.stringify(a.details));
    for (const n of names) assert.ok(a.details[0].includes(n), n);
  });
  // V1.5 (PR #51 review): the exemption is narrow. Only the server's own inventory names reach libraryNames, and even a
  // value there is protected only as a whole name and only when it is shaped like a document or file name.
  await check(`G2 [${NAMES}] a storage path, a key, a bare id, the answer's own record id, or a name that is only part of a longer identifier never gains the exemption`, async () => {
    const { guardChatAnswer } = await import("@/lib/chat/output-guard");
    const real = P.doc("TRAVEL_WORDING").filename!;
    const pid = P.doc("SCAN").id;
    const bad = [`accounts/${P.ACCOUNT}/policies/${pid}/scan_raw.pdf`, "sk_live_51Habcdefghijklmnopqrstu", pid, "7e800000-0000-4000-8000-000000000999", "summary"];
    const a: any = guardChatAnswer({ summary: "Here are your documents.", citations: [{ policyId: pid }], libraryNames: [real, ...bad], details: [
      `On file: ${real}.`,
      `Stored at ${bad[0]}.`, `Key ${bad[1]} was used.`, `Record ${bad[2]} is the scan.`, `Row ${bad[3]} exists.`, "The summary_internal_table holds it.",
    ] } as any);
    assert.deepEqual(a.details, [`On file: ${real}.`], JSON.stringify(a.details));
  });
  // end to end: names the model writes that are not the server's inventory names (another household's, a deleted upload's,
  // an invented one) gain nothing, and the household's own file names keep their exact case.
  const [c3] = await run([{ user: ASK, steps: [() => [call("household_documents", {})], (v: ScriptView) => [call("final_answer", { sentences: [
    ...modelLines(v),
    { text: `${P.DOCS.find((d) => d.key === "OTHER")!.filename} is also on file.` },
    { text: `${P.DOCS.find((d) => d.key === "DELETED")!.filename} is also on file.` },
    { text: "invented_policy_schedule.pdf is linked to Adrian." },
  ] })]] }]);
  await check(`G3 [${NAMES}] another household's file name, a deleted upload's file name and a model-invented file name never reach the saved answer or its libraryNames; real names keep their case`, () => {
    for (const n of ["other_household_certificate.pdf", "old_benefit_summary_deleted.pdf", "invented_policy_schedule.pdf"]) {
      assert.ok(!c3.v.includes(n), `${n} shown:\n${c3.v}`);
      assert.ok(!(c3.answer.libraryNames ?? []).includes(n), `${n} in libraryNames`);
    }
    for (const k of P.ELIGIBLE) { const d = P.doc(k); if (d.filename && d.key !== "CERT" && !d.product) assert.ok(c3.v.includes(d.filename), `${d.filename} not shown exactly:\n${c3.v}`); }
    assert.ok(c3.v.includes(P.doc("SCAN").filename!), c3.v);
  });
  // Grader controls for the pre-registered live run (scripts/rag2-live/pr50-check.ts): these scripted turns, saved in the
  // run-record shape, are graded by the same grader (PR50_CONTROL_OUT=<file>).
  if (process.env.PR50_CONTROL_OUT && controls.P50D && controls.P50A) {
    const conv = (id: string, x: any) => ({ scenario: id, costUsd: 0, loaded: { turns: [{ answer: x.answer }] }, saved: { traces: [x.trace] } });
    (await import("node:fs")).writeFileSync(process.env.PR50_CONTROL_OUT, JSON.stringify({ conversations: [conv("P50C", c1), conv("P50D", controls.P50D), conv("P50A", controls.P50A2 ?? controls.P50A)] }));
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\npr50 [${NAMES} names, ${P.PAGE} page 13] ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
