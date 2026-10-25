/**
 * Replay of the three actual-model runs (docs/rag-migration/live/RUN-s47-live-{1,2,3}-*) WITHOUT any model call: every
 * model step is played back verbatim -- the same tool calls with the same arguments, grouped into the same model calls
 * as the relay log recorded them -- through the REAL chat route on the same synthetic household. Tool results (and so
 * the evidence / value ids the recorded arguments refer to) are deterministic, so the replay reaches the state the live
 * run did; what the product does with those model outputs is then graded. Then negative controls for calculation inputs
 * selected by evidence id, quote tolerance, counting-rule conflicts and facts arriving while another question is open.
 *   node --import tsx scripts/rag2-scenario-replay.ts            (npm run rag2:scenario-replay-test)
 * Evidence class: REPLAY of recorded model output (not a new model result) + scripted CONTROLS.
 */
import "./fixtures/legacy-contract";
import assert from "node:assert/strict";
import type { ChatAnswer } from "@/types";
import { setEnv, startHarness, type Harness } from "./fixtures/rag2-loop/harness";
import * as HH from "./fixtures/rag2-scenario/household";
import type { ScriptCall, ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";
import { recordedTurns, replayScript, runDir } from "./fixtures/rag2-live-replay";

const HOUSEHOLD = HH as unknown as Parameters<typeof startHarness>[0];
setEnv(HOUSEHOLD);
const RUNS = process.env.SKIP_REPLAY ? [] : process.env.REPLAY_RUN ? [process.env.REPLAY_RUN] : ["RUN-s47-live-1-", "RUN-s47-live-2-", "RUN-s47-live-3-"].map(runDir);

const visible = (a: ChatAnswer) => [a.summary, ...a.details, ...(a.questions ?? []).map((q) => "[Q] " + q.text), ...(a.nextSteps ?? []).map((n) => "[next] " + n)].join("\n");
const results: { name: string; ok: boolean }[] = [];
async function check(name: string, fn: () => Promise<void> | void) { try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); } catch (e) { results.push({ name, ok: false }); console.log("FAIL " + name + "\n     " + (e instanceof Error ? e.message : String(e)).split("\n").slice(0, 10).join("\n     ")); } }
const docKey = (id: string) => HH.DOCS.find((d) => d.id === id)?.key;
const D = HH.M.raymond.id, G = HH.M.grace.id;
type Saved = { answer: ChatAnswer; state: any; trace: any };

async function installScript(script: ScriptTurn[]) {
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  installLoopModel(new ScriptedLoopModel(script));
}
async function converse(h: Harness, script: ScriptTurn[], users: string[], log = true): Promise<Saved[]> {
  await installScript(script);
  let c: { id?: string; rev?: number } = {};
  const saved: Saved[] = [];
  for (const u of users) {
    const a = await h.send(u, c);
    c = { id: a.conversationId, rev: a.conversationRevision };
    const s = await h.savedAnswer(c.id!);
    saved.push({ answer: s.answer, state: s.state, trace: s.state.ragLoop?.turns.at(-1) });
    if (/couldn.t finish/i.test(visible(s.answer))) console.log("      refused calls: " + JSON.stringify((saved.at(-1)!.trace?.toolCalls ?? []).filter((x: any) => !x.ok).map((x: any) => [x.name, String(x.error).slice(0, 160)])));
    if (log) console.log(`\nUSER: ${u}\nAPP:  ${visible(s.answer).replace(/\n/g, "\n      ")}\n      adjusted=${JSON.stringify(saved.at(-1)!.trace?.adjusted ?? [])} incomplete=${JSON.stringify(saved.at(-1)!.trace?.incomplete ?? [])} gate=${JSON.stringify(saved.at(-1)!.trace?.gate ?? [])} calcs=${JSON.stringify(((s.answer as any).calculations ?? []).map((r: any) => [r.benefit, r.result?.value]))}`);
  }
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  installLoopModel(null);
  return saved;
}
const calcOf = (s: Saved, calculator: string) => ((s.answer as any).calculations ?? []).find((x: any) => x.calculator === calculator);
const cites = (s: Saved) => (s.answer.citations ?? []).map((x) => `${docKey(x.policyId)}:${x.pageStart}`);

async function main() {
  const h = await startHarness(HOUSEHOLD);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { recomputeCalculation } = await import("@/lib/claims/calc-record");
  const { verifyAnswerFigures } = await import("@/lib/chat/answer-verification");
  const replays: { name: string; turns: ReturnType<typeof recordedTurns>; saved: Saved[] }[] = [];

  // ---------------------------------------------------------------- the three recorded runs, replayed
  for (const dir of RUNS) {
    const name = /RUN-(s47-live-\d)/.exec(dir)?.[1] ?? dir;
    const turns = recordedTurns(dir);
    console.log(`\n==== replay of ${name}`);
    const saved = await converse(h, replayScript(turns), turns.map((t) => t.user));
    replays.push({ name, turns, saved });
    if (process.env.REPLAY_ONLY) continue;
    await check(`${name}: every turn is answered (no model error, no save-time gate rejection)`, () => {
      for (const [i, s] of saved.entries()) { assert.ok(!/couldn.t finish/i.test(visible(s.answer)), `turn ${i + 1}: ${visible(s.answer).slice(0, 120)}`); assert.deepEqual(s.trace?.gate ?? [], [], `turn ${i + 1} gate`); }
    });
    const t5 = saved[4], v5 = visible(t5.answer);
    await check(`${name} turn 5: the closed-tibia illustration S$9,000 is shown conditionally, from a saved lump_sum record (6% x S$300,000 x 50%) that re-runs, cited to the certificate and the wording`, () => {
      assert.match(v5, /\bIf\b[^.]*S\$9,000(?![\d,]*\d)/, v5);
      assert.ok(!/you will receive|approved payment(?! )/i.test(v5.replace(/not an approved payment/gi, "")), "presented as a payment");
      const r = calcOf(t5, "lump_sum"); assert.ok(r, "no saved lump_sum record"); assert.equal(r.result.value, 9000);
      assert.deepEqual(r.operands.filter((o: any) => o.source === "document").map((o: any) => o.value).sort((a: number, b: number) => a - b), [6, 50, 300000]);
      assert.ok(recomputeCalculation(r).ok, "the record does not re-run");
      assert.equal(r.subjectId, D); assert.equal(docKey(r.policyId), "PA_WORD");
      const c = cites(t5); assert.ok(c.includes("CERT:1") && c.includes("PA_WORD:1"), c.join(","));
    });
    const t6 = saved[5], v6 = visible(t6.answer);
    await check(`${name} turn 6: the S$100 hospital estimate is shown from a saved hospital_cash record (1 complete 24-hour period) cited to the wording's page 2, and is not a payment`, () => {
      assert.match(v6, /S\$100(?![\d,]*\d)[^.]*(?:indicative|estimate)|(?:indicative|estimate)[^.]*S\$100(?![\d,]*\d)/i, v6);
      const r = calcOf(t6, "hospital_cash"); assert.ok(r, "no saved hospital_cash record"); assert.equal(r.result.value, 100);
      assert.ok(recomputeCalculation(r).ok, "the record does not re-run"); assert.equal(r.subjectId, D);
      assert.ok(cites(t6).includes("PA_WORD:2"), cites(t6).join(","));
      assert.ok(!/you will receive|will be paid/i.test(v6));
    });
  }
  if (process.env.REPLAY_ONLY) process.exit(0);
  const [r1, r2, r3] = replays;
  if (r1) {
  const t5 = r1.saved[4];
  const gate = (a: any) => verifyAnswerFigures(a, { accountId: HH.ACCOUNT, userText: r1.turns[4].user, report: true, priorUserTexts: r1.turns.slice(0, 4).map((t) => t.user) });
  await check("s47-live-1 controls: a tampered record, an unrelated record and a wrong-product / wrong-person / wrong-currency binding are rejected", async () => {
    const t1 = structuredClone(t5.answer) as any; t1.calculations.find((x: any) => x.calculator === "lump_sum").operands.find((o: any) => o.value === 50).value = 100;
    assert.ok((await gate(t1)).length, "a tampered share passed");
    const t2 = structuredClone(t5.answer) as any; t2.calculations.find((x: any) => x.calculator === "lump_sum").subjectId = G;
    assert.ok((await gate(t2)).length, "a record for another person passed");
    for (const [field, value, what] of [["benefit", "Group Term Life", "Group Term Life"], ["subjectId", G, "Grace"], ["currency", "USD", "another currency"]] as const) {
      const t = structuredClone(t5.answer) as any; t.figureBindings.find((x: any) => x.value === 300000)[field] = value;
      assert.ok((await gate(t)).length, `the certificate figure bound to ${what} passed`);
    }
  });
  await check("s47-live-1 controls: the fallback shows only the calculation the reply attempted -- no femur/kneecap or earlier-turn record", () => {
    assert.ok(((t5.answer as any).calculations ?? []).every((r: any) => /tibia|lower leg/i.test(r.benefit)));
    for (const [i, s] of r1.saved.entries()) if (i !== 4) assert.ok(!((s.answer as any).calculations ?? []).some((r: any) => r.calculator === "lump_sum"), `turn ${i + 1} shows a lump sum`);
  });
  }
  if (r2) await check("s47-live-2 turn 1: the omitted certificate lookup is completed by the one bounded lookup (dated amount, own product and person)", () => {
    const v1 = visible(r2.saved[0].answer);
    assert.match(v1, /S\$300,000(?![\d,]*\d)[^.]*1 July 2025/, v1); assert.ok(!/haven['’]t yet read/i.test(v1), v1);
    // V1.4: the figure is completed either by the one bounded lookup or -- when the model's sentence already states it
    // -- bound directly to Raymond's own certificate row through the shared benefit view (no lookup needed).
    const look = (r2.saved[0].trace.toolCalls as any[]).filter((x) => /grounded fallback/.test(String(x.args?.by ?? "")));
    const direct = ((r2.saved[0].answer as any).figureBindings ?? []).some((b: any) => b.value === 300000 && /personal accident/i.test(b.benefit) && b.subjectId === D);
    assert.ok((look.length >= 2 && look.length <= 4) || direct, JSON.stringify({ look: look.map((x) => x.name), bindings: ((r2.saved[0].answer as any).figureBindings ?? []).map((b: any) => [b.value, b.benefit, b.subjectId]) }));
  });
  if (r3) {
    await check("s47-live-3 turn 5: the model's proportion quote ending \".\" where the page prints \";\" is accepted (trailing punctuation only); the percentage is read from the schedule row", () => {
      const calc = (r3.saved[4].trace.toolCalls as any[]).filter((x) => x.name === "calculate" && x.args?.calculator === "lump_sum");
      assert.ok(calc.some((x) => x.ok), JSON.stringify(calc.map((x) => x.error ?? "ok")));
    });
    await check("s47-live-3 turn 6: the hospital calculation left open in turn 3 is completed from the recorded admission / discharge (the model's paraphrased rate is still refused); the duration, the amount and the prior-use assumption are kept apart; prior use is asked on its own", () => {
      const tc = r3.saved[5].trace.toolCalls as any[];
      assert.ok(tc.some((x) => x.name === "calculate" && !x.ok && /quote is not on that page/.test(String(x.error))), "the paraphrase was not refused");
      assert.ok(tc.some((x) => x.name === "calculate" && x.ok && /open calculation/.test(String(x.args?.by ?? ""))), "no completion of the open calculation");
      const v = visible(r3.saved[5].answer);
      assert.match(v, /counts as 1 payable period at S\$100/); assert.match(v, /assuming at least 1 of the 90 days is still available/);
      assert.ok(!/what you told me[^.]*assuming/i.test(v), "the assumption is presented as the household's words");
      const q = r3.saved[5].answer.questions?.[0]?.text ?? ""; assert.match(q, /already been paid/i); assert.ok(!/admission|discharge/i.test(q), q);
    });
    await check("s47-live-3 turns 2-4: questions name Raymond (never \"your\"), ask one thing at a time, and \"Transverse fracture\" is explained and leads to the still-unanswered bone question", () => {
      for (const i of [1, 2, 3]) { const q = r3.saved[i].answer.questions?.[0]?.text ?? ""; assert.match(q, /Raymond/, `turn ${i + 1}: ${q}`); assert.ok(!/\byour\b/i.test(q), `turn ${i + 1}: ${q}`); }
      const q3 = r3.saved[2].answer.questions?.[0]?.text ?? ""; assert.ok(!/already been paid|and had/i.test(q3), q3); assert.match(q3, /admission and discharge/);
      const v4 = visible(r3.saved[3].answer); assert.match(v4, /transverse/i); assert.match(r3.saved[3].answer.questions?.[0]?.text ?? "", /Which bone/);
      assert.ok(r3.saved[3].state.ragLoop.claim.facts.fracture_pattern, "the detail was not recorded");
    });
  }

  // ---------------------------------------------------------------- controls: calculation inputs by evidence id
  const { figureFromEvidence, locateQuote } = await import("@/lib/rag2/calc/tool");
  const ref = (text: string, page = 2) => ({ policyId: "p", documentHash: "h", page: { start: page, end: page }, passage: { text, start: 0, end: text.length, onPage: page }, subjectId: D }) as any;
  await check("CONTROL identical figures in different benefits: the line naming the benefit is read; a benefit two lines match equally, or none names, is refused", () => {
    const e = ref("Accident Hospital Income: S$100 for each complete period of 24 hours of confinement.\nRecuperation Benefit: S$100 for each day of recuperation at home.\nHospital Recuperation Allowance: S$100 per day.");
    const a = figureFromEvidence(e, { kind: "amount", words: "Accident Hospital Income" }); assert.ok(typeof a !== "string" && /^Accident Hospital Income/.test(a.quote) && a.amount === 100 && a.currency === "SGD", JSON.stringify(a));
    const b = figureFromEvidence(e, { kind: "amount", words: "Recuperation" }); assert.ok(typeof b === "string" && /ambiguous/.test(b), String(b));
    const c = figureFromEvidence(e, { kind: "amount", words: "Dental Treatment" }); assert.ok(typeof c === "string", String(c));
    const d = figureFromEvidence(e, { kind: "amount", words: "Accident Hospital Income", amount: 150 }); assert.ok(typeof d === "string", "a different amount was accepted");
    const p = ref("For a simple (closed) fracture 50% of the percentage shown is payable; the full percentage shown is payable for a compound (open) fracture.", 1);
    const s1 = figureFromEvidence(p, { kind: "percent", words: "a simple (closed) fracture" }); assert.ok(typeof s1 !== "string" && s1.percent === 50 && s1.quote.endsWith("is payable;"), JSON.stringify(s1));
    const s2 = figureFromEvidence(p, { kind: "percent", words: "a compound (open) fracture" }); assert.ok(typeof s2 === "string", `the 50% share was given for the compound case: ${JSON.stringify(s2)}`);
  });
  await check("CONTROL quotes: only whitespace and trailing sentence punctuation are tolerated -- a changed figure, an added negation or a changed qualifier is not located", () => {
    const page = HH.DOCS.find((d) => d.key === "PA_WORD")!.pages[1] as string;
    const at = (q: string) => locateQuote({ policyId: "p", documentHash: "h", page: 1, pageText: page, passage: q, subjectId: D });
    assert.ok(at("For a simple (closed) fracture 50% of the percentage shown is payable."), "trailing '.' was not tolerated");
    assert.ok(at("For a  simple (closed)\nfracture 50% of the percentage shown is payable"), "whitespace was not tolerated");
    for (const q of ["For a simple (closed) fracture 60% of the percentage shown is payable.", "For a simple (closed) fracture 50% of the percentage shown is not payable.", "For a compound (open) fracture 50% of the percentage shown is payable.", "For a simple fracture 50% of the percentage shown is payable.", "50% of the percentage shown is payable for any fracture."])
      assert.equal(at(q), null, `located: ${q}`);
  });

  // Loop-level: a probe conversation selecting evidence by id for Raymond's calculation.
  const PA = HH.doc("PA_WORD").id;
  const call = (name: string, args: Record<string, unknown>): ScriptCall => ({ name, arguments: args });
  const hitIn = (v: ScriptView, re: RegExp, who = D) => { for (const o of [...v.turn].reverse()) if (o.name === "search_passages" && o.ok && (o.args.subject_id ?? null) === who) { const hs = (o.result.data.hits as any[]).filter((y) => y.evidence); const x = hs.find((y) => re.test(y.evidence?.excerpt ?? "")) ?? hs.find((y) => re.test(`${y.text ?? ""} ${y.evidence?.excerpt ?? ""}`)); if (x) return x.evidence.evidence_id as string; } return null; };
  const anyHit = (v: ScriptView, re: RegExp) => { for (const o of [...v.turn].reverse()) if (o.name === "search_passages" && o.ok) { const hs = (o.result.data.hits as any[]).filter((y) => y.evidence); const x = hs.find((y) => re.test(y.evidence?.excerpt ?? "")) ?? hs.find((y) => re.test(`${y.text ?? ""} ${y.evidence?.excerpt ?? ""}`)); if (x) return x.evidence.evidence_id as string; } return null; };
  const hc = (extra: Record<string, unknown>) => call("calculate", { calculator: "hospital_cash", purpose: "claim", subject_id: D, policy_id: PA, benefit: "Accident Hospital Income", admission: { at: "2026-10-03T21:00+08:00", words: "admitted at 9pm on 3 October 2026" }, discharge: { at: "2026-10-05T11:00+08:00", words: "discharged at 11am on 5 October 2026" }, ...extra });
  const lookups = () => [
    call("search_passages", { query: "Accident Hospital Income complete period of 24 hours confinement", subject_id: D }),
    call("search_passages", { query: "fracture confirmed by X-ray simple closed compound open percentage", subject_id: D }),
    call("search_passages", { query: "Accident means sudden unforeseen external violent", subject_id: D }),
    call("search_passages", { query: "Group Personal Accident sum insured certificate", subject_id: D }),
    call("search_passages", { query: "Accident Hospital Income fracture benefit", subject_id: G }),
    call("select_table_value", { policy_id: HH.doc("CERT").id, benefit: "Group Personal Accident", subject_id: D, want: "amount" }),
  ];
  const howQ = (v: ScriptView) => call("ask_user", { kind: "fact", subject_id: D, fact_key: "how_it_happened", question: "How did Raymond hurt himself?", because_evidence_ids: [hitIn(v, /Accident means/)].filter(Boolean) });
  let probeIds: Record<string, string | null> = {};
  const sumId = (v: ScriptView) => v.find("select_table_value")?.result?.data?.valueId;
  const PROBE: ScriptTurn[] = [
    { user: "Raymond", steps: [
      () => [call("resolve_person", { mention: "Raymond" })],
      () => lookups(),
      (v) => {
        // Another person's retrieval: a passage the search for Grace returned that no search for Raymond did.
        const mine = new Set(v.turn.filter((o) => o.name === "search_passages" && o.ok && o.args.subject_id === D).flatMap((o) => (o.result.data.hits as any[]).map((x) => x.evidence?.evidence_id)));
        const g = v.turn.find((o) => o.name === "search_passages" && o.ok && o.args.subject_id === G);
        probeIds = { rate: hitIn(v, /Accident Hospital Income/), note: hitIn(v, /simple \(closed\)/), cert: anyHit(v, /CERTIFICATE OF GROUP INSURANCE/), grace: ((g?.result.data.hits as any[]) ?? []).map((x) => x.evidence?.evidence_id).find((id) => id && !mine.has(id)) ?? null };
        const lump = (proportion: Record<string, unknown>) => call("calculate", { calculator: "lump_sum", purpose: "claim", subject_id: D, policy_id: PA, benefit: "Fracture of lower leg (tibia or fibula)", condition: "closed tibia fracture", assumption_words: "Raymond", sum_insured_value_id: sumId(v), proportion });
        return [
          hc({ rate_evidence_id: probeIds.rate }),                                           // the right record
          hc({ rate_evidence_id: probeIds.cert }),                                           // another document
          hc({ rate_evidence_id: probeIds.grace }),                                          // retrieved for another person
          hc({ rate_evidence_id: "e999" }),                                                  // never returned
          hc({ rate_passage: { page: 1, quote: "Accident Hospital Income: S$100 for each complete period of 24 hours of continuous confinement in a hospital as an in-patient as a direct result of an Accident, up to 90 days per Accident.", amount: 100, currency: "SGD" } }), // wrong page
          lump({ evidence_id: probeIds.note, applies_when: "a compound (open) fracture" }),   // the share printed for the other case
          lump({ evidence_id: probeIds.note, applies_when: "a simple (closed) fracture", percent: 60 }), // a changed share
        ];
      },
      (v) => [howQ(v)],
    ] },
    { user: "stale", steps: [
      () => [hc({ rate_evidence_id: probeIds.rate })],                                       // the document has changed since it was read
      () => [call("ask_user", { kind: "fact", subject_id: D, fact_key: "how_it_happened", question: "How did Raymond hurt himself?", because_evidence_ids: [probeIds.rate].filter(Boolean) as string[] })],
    ] },
  ];
  await installScript(PROBE);
  const p1 = await h.send("Raymond had an accident.", {});
  const s1 = await h.savedAnswer(p1.conversationId!);
  const calcs1 = (s1.state.ragLoop.turns.at(-1).toolCalls as any[]).filter((x) => x.name === "calculate");
  await check("CONTROL evidence ids: the right record gives the S$100 rate from the stored line on page 2; another document, another person's retrieval, an unknown id, a wrong page, a share for another case and a changed share are each refused", () => {
    const [ok, otherDoc, otherPerson, unknown, wrongPage, otherCase, changed] = calcs1;
    if (!ok?.ok) console.log("      probe: " + JSON.stringify({ probeIds, calcs: calcs1.map((x) => [x.ok, x.args?.rate_evidence_id ?? x.args?.rate_passage?.page, String(x.error ?? "").slice(0, 80)]) }));
    assert.ok(ok?.ok && ok.args.rate_passage?.page === 2 && /^Accident Hospital Income: S\$100/.test(ok.args.rate_passage.quote) && !("rate_evidence_id" in ok.args), JSON.stringify(ok));
    assert.ok(!otherDoc.ok && /another document/.test(otherDoc.error), String(otherDoc.error));
    assert.ok(!otherPerson.ok && /another (?:person|document)/.test(otherPerson.error), String(otherPerson.error));
    assert.ok(!unknown.ok && /unknown evidence id/.test(unknown.error), String(unknown.error));
    assert.ok(!wrongPage.ok && /not on that page/.test(wrongPage.error), String(wrongPage.error));
    assert.ok(!otherCase.ok && /no single line|ambiguous/.test(otherCase.error), String(otherCase.error));
    assert.ok(!changed.ok && /prints 50%, not 60%/.test(changed.error), String(changed.error));
    console.log("      refusals: " + calcs1.slice(1).map((x) => String(x.error).slice(0, 90)).join(" | "));
  });
  await h.db.query("UPDATE policies SET file_hash = file_hash || '-v2' WHERE id = $1", [PA]);
  try {
    await h.send("stale check", { id: p1.conversationId, rev: p1.conversationRevision });
    const s2 = await h.savedAnswer(p1.conversationId!);
    const c2 = (s2.state.ragLoop.turns.at(-1).toolCalls as any[]).find((x) => x.name === "calculate");
    await check("CONTROL evidence ids: a record read from an earlier version of the document is refused", () => { assert.ok(c2 && !c2.ok && /cannot be used|changed since/.test(String(c2.error)), JSON.stringify(c2)); });
  } finally { await h.db.query("UPDATE policies SET file_hash = replace(file_hash, '-v2', '') WHERE id = $1", [PA]); }

  // Conflicting counting rules in the wording: never an indicative estimate.
  await h.db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,9,$3)", [HH.ACCOUNT, PA, "Accident Hospital Income is payable for each night spent in hospital."]);
  try {
    const CONFLICT: ScriptTurn[] = [{ user: "conflict", steps: [() => [call("resolve_person", { mention: "Raymond" })], () => lookups(), (v) => [hc({ rate_evidence_id: hitIn(v, /Accident Hospital Income:/) })], (v) => [howQ(v)]] }];
    const [s] = await converse(h, CONFLICT, ["conflict: Raymond was admitted at 9pm on 3 October 2026 and discharged at 11am on 5 October 2026."], false);
    const c = (s.trace.toolCalls as any[]).find((x) => x.name === "calculate");
    await check("CONTROL conflicting counting rules: a second Accident Hospital Income sentence counting each night (beside complete periods of 24 hours) gives no indicative estimate", () => {
      assert.ok(c, "no calculation"); assert.notEqual(JSON.parse(c.summary ?? "{}").kind, "indicative_estimate", c.summary);
      assert.ok(!((s.answer as any).calculations ?? []).some((r: any) => r.calculator === "hospital_cash"), "a hospital estimate was saved");
    });
  } finally { await h.db.query("DELETE FROM policy_pages WHERE policy_id=$1 AND page_number=9", [PA]); }

  // New facts while another question is pending (each calculation completes when ITS facts arrive).
  const boneAsk = (v: ScriptView) => call("ask_user", { kind: "fact", subject_id: D, fact_key: "bone_fractured", question: "Which bone in Raymond's leg was broken: the thigh bone (femur), a lower-leg bone (tibia or fibula), or the kneecap (patella)?", because_evidence_ids: [hitIn(v, /Fracture of thigh bone|% of Sum Insured/), hitIn(v, /simple \(closed\)/)].filter(Boolean) });
  const timesAsk = (v: ScriptView) => call("ask_user", { kind: "fact", subject_id: D, fact_key: "admission_datetime", question: "What were Raymond's admission and discharge dates and times?", because_evidence_ids: [hitIn(v, /Accident Hospital Income/)].filter(Boolean) });
  const t1Steps = (ask: (v: ScriptView) => ScriptCall) => [
    () => [call("resolve_person", { mention: "Raymond" })],
    () => [call("note_facts", { subject_id: D, facts: [{ key: "how_it_happened", value: "fell down the stairs", words: "fell down the stairs" }, { key: "injury", value: "broke his leg", words: "broke his leg" }] }), ...lookups(), call("search_passages", { query: "Schedule of Compensation fracture of thigh bone lower leg kneecap % of Sum Insured", subject_id: D })],
    (v: ScriptView) => [call("calculate", { calculator: "hospital_cash", purpose: "claim", subject_id: D, policy_id: PA, benefit: "Accident Hospital Income", rate_evidence_id: hitIn(v, /Accident Hospital Income/) })],
    (v: ScriptView) => [ask(v)],
  ];
  const T1 = "Raymond fell down the stairs and broke his leg, and was warded in hospital.";
  {
    const conv: ScriptTurn[] = [
      { user: "warded", steps: t1Steps(boneAsk) },
      { user: "Admitted", steps: [() => [call("note_facts", { subject_id: D, facts: [{ key: "admission_datetime", value: "2026-10-03T21:00+08:00", words: "Admitted at 9pm on 3 October 2026" }, { key: "discharge_datetime", value: "2026-10-05T11:00+08:00", words: "discharged at 11am on 5 October 2026" }] }), ...lookups(), call("search_passages", { query: "Schedule of Compensation fracture of thigh bone lower leg kneecap % of Sum Insured", subject_id: D })], (v) => [boneAsk(v)], (v) => [boneAsk(v)]] },
    ];
    const s = await converse(h, conv, [T1, "Admitted at 9pm on 3 October 2026 and discharged at 11am on 5 October 2026."]);
    await check("CONTROL new facts while the bone question is pending: the admission / discharge are recorded, the hospital calculation completes (S$100, saved record), and the bone question is still asked", () => {
      const v = visible(s[1].answer); assert.match(v, /S\$100(?![\d,]*\d)/, v); assert.equal(calcOf(s[1], "hospital_cash")?.result?.value, 100);
      assert.match(s[1].answer.questions?.[0]?.text ?? "", /Which bone/); assert.ok(s[1].state.ragLoop.claim.facts.admission_datetime && s[1].state.ragLoop.claim.facts.discharge_datetime);
      assert.ok(!calcOf(s[1], "lump_sum"), "an illustration was resurrected");
    });
  }
  {
    const conv: ScriptTurn[] = [
      { user: "warded", steps: t1Steps(timesAsk) },
      { user: "tibia", steps: [
        () => [call("note_facts", { subject_id: D, facts: [{ key: "bone_fractured", value: "tibia", words: "The tibia." }, { key: "fracture_type", value: "closed", words: "It was a closed fracture." }] }), ...lookups()],
        (v) => [call("calculate", { calculator: "lump_sum", purpose: "claim", subject_id: D, policy_id: PA, benefit: "Fracture of lower leg (tibia or fibula)", condition: "closed tibia fracture", assumption_words: "The tibia. It was a closed fracture.", sum_insured_value_id: sumId(v), proportion: { evidence_id: hitIn(v, /simple \(closed\)/), applies_when: "a simple (closed) fracture" } })],
        (v) => [timesAsk(v)],
      ] },
    ];
    const s = await converse(h, conv, [T1, "The tibia. It was a closed fracture."]);
    await check("CONTROL new facts while the hospital question is pending: the bone and closed fracture are recorded, the S$9,000 illustration (share read from the record by evidence id) is shown and saved, and the hospital question is still asked", () => {
      const v = visible(s[1].answer); assert.match(v, /\bIf\b[^.]*S\$9,000(?![\d,]*\d)/, v); assert.equal(calcOf(s[1], "lump_sum")?.result?.value, 9000);
      assert.match(s[1].answer.questions?.[0]?.text ?? "", /admission and discharge/); assert.ok(s[1].state.ragLoop.claim.facts.bone_fractured);
      assert.ok(!calcOf(s[1], "hospital_cash"), "a hospital amount was shown without times");
    });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nreplay of the three actual-model runs + controls: ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
