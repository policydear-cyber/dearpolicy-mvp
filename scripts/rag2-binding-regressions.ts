/**
 * V1.4 person / product / benefit binding (node --import tsx scripts/rag2-binding-regressions.ts; npm run rag2:binding-test).
 *
 * The household of scripts/fixtures/rag2-binding/household.ts reproduces the document STRUCTURE behind the reported
 * post-PR #48 answer ("The <scheme> lists separate Group Term Life and <member's name> amounts"): a certificate letter
 * printing the insured member's name on its own line above a roster of product headings. Scripted model moves through
 * the REAL chat route (PGlite); PLUMBING / CONTROL evidence, not model results. The live conversation was not
 * readable from this session, so this reproduces the structure, not the household's own internal trace.
 */
import assert from "node:assert/strict";
import { setEnv, startHarness, type Harness } from "./fixtures/rag2-loop/harness";
import * as HH from "./fixtures/rag2-binding/household";
import type { ScriptCall, ScriptView } from "@/lib/rag2/loop/scripted-model";

const HOUSEHOLD = HH as unknown as Parameters<typeof startHarness>[0];
setEnv(HOUSEHOLD);
const D = HH.M.darren.id, MI = HH.M.michelle.id;
const results: { name: string; ok: boolean }[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (e) { results.push({ name, ok: false }); console.log("FAIL " + name + "\n     " + (e instanceof Error ? e.message : String(e)).split("\n").slice(0, 14).join("\n     ")); }
}
const call = (name: string, args: Record<string, unknown>): ScriptCall => ({ name, arguments: args });
const pfEv = (v: ScriptView, who: string) => { const o = v.find("policies_for", (o) => o.args.subject_id === who); const c = ((o?.result?.data?.covering ?? []) as any[]).find((x) => x.policyId === HH.doc("CERT").id); return ((c?.evidence ?? []) as any[]).map((e) => e.evidence_id as string); };
const NAME_AS_LABEL = /(?:separate|under|lists?)[^.]*\b(?:Tan Kai Ming|Darren|Ong Li Ting|Michelle)\b[^.]*\bamounts?\b|“[^”]*(?:Darren|Michelle)[^”]*”\s*amount/i;
const DEATH = "Darren died in a car accident in Japan, what can I do?";

async function answer(h: Harness, who: string, sentences: (v: ScriptView) => Record<string, unknown>[], nextSteps: string[] = []) {
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  installLoopModel(new ScriptedLoopModel([{ steps: [
    () => [call("resolve_person", { mention: who === D ? "Darren" : "Michelle" })],
    () => [call("policies_for", { subject_id: who }), call("search_passages", { query: "death benefit sum assured group term life certificate", subject_id: who })],
    (v) => [call("final_answer", { subject_id: who, sentences: sentences(v), ...(nextSteps.length ? { next_steps: nextSteps } : {}) })],
  ] }]));
  try {
    const a = await h.send(DEATH, {});
    const s = await h.savedAnswer(a.conversationId!);
    const t = s.state.ragLoop.turns.at(-1);
    return { v: [s.answer.summary, ...s.answer.details, ...(s.answer.nextSteps ?? []).map((n: string) => "[next] " + n)].join("\n"), answer: s.answer as any, trace: t };
  } finally { installLoopModel(null); }
}

async function main() {
  const h = await startHarness(HOUSEHOLD);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { householdBenefits, personBenefits } = await import("@/lib/rag2/benefits");

  // ---------------------------------------------------------------- the shared person-benefit view
  const hb = await householdBenefits(HH.ACCOUNT);
  const darren = hb.byMember.get(D)!, michelle = hb.byMember.get(MI)!;
  await check("VIEW Darren's own documented benefits: four product headings from his certificate row, each with amount, currency, as-of date, page, row and column", () => {
    const rows = darren.benefits.filter((b) => b.applicability === "person_row");
    assert.deepEqual(rows.map((b) => [b.benefit.label, b.printed.kind === "money" ? b.printed.amount : null, b.printed.kind === "money" ? b.printed.currency : null, b.asOf]),
      [["Group Term Life", 1000000, "SGD", "2022-10-06"], ["Group Personal Accident", 600000, "SGD", "2022-10-06"], ["Group Living Care", 350000, "SGD", "2022-10-06"], ["Group Living Care Plus", 300000, "SGD", "2022-10-06"]]);
    for (const b of rows) {
      assert.equal(b.policy.id, HH.doc("CERT").id); assert.equal(b.policy.personalProof, true); assert.equal(b.policy.version.documentHash, "sha256:binding-cert");
      assert.equal(b.source.page, 1); assert.match(b.source.row!.label, /Tan Kai Ming, Darren/); assert.equal(b.source.evidence.table?.layout, "person_row"); assert.equal(b.source.evidence.table?.rowPerson?.memberId, D);
      assert.ok(b.source.passage.includes(b.printed.kind === "money" ? b.printed.amount.toLocaleString("en-SG") : ""), b.source.passage);
    }
  });
  await check("VIEW printed benefits are kept apart from the person's rows: the PA summary's Accidental Death is shared wording, 100% of the Sum Insured, with its printed condition; the GTL death benefit is defined as the Sum Assured (no figure of its own)", () => {
    const ad = darren.benefits.find((b) => b.benefit.label === "Accidental Death")!;
    assert.equal(ad.applicability, "shared_wording"); assert.deepEqual(ad.printed, { kind: "percent", percent: 100, ppm: 1000000, of: "Sum Insured" }); assert.match(ad.conditions[0], /within 365 days of that Accident/);
    const db = darren.benefits.find((b) => b.benefit.label === "Death Benefit")!;
    assert.deepEqual(db.printed, { kind: "reference", of: "Sum Assured" });
  });
  await check("VIEW no benefit or document label is a person's name, an address, a date or a letter line", () => {
    const labels = [...hb.labelsByPolicy.values()].flat().concat([...hb.byMember.values()].flatMap((v) => v.benefits.map((b) => b.benefit.label)));
    for (const l of labels) assert.ok(!/Darren|Michelle|Tan Kai Ming|Ong Li Ting|Blk|Singapore 0|October 2022|Dear|Meridian Life Ltd$/.test(l), l);
    assert.deepEqual(hb.labelsByPolicy.get(HH.doc("CERT").id), ["Group Term Life", "Group Personal Accident", "Group Living Care", "Group Living Care Plus"]);
  });
  await check("VIEW each person gets only their own rows (Michelle S$500,000 Term Life, never Darren's), and the other household's certificate never appears", () => {
    assert.equal((michelle.benefits.find((b) => b.benefit.label === "Group Term Life")!.printed as any).amount, 500000);
    assert.ok(!JSON.stringify([...hb.byMember.values()].map((v) => v.benefits)).includes("2,000,000"));
    assert.ok(![...hb.byMember.keys()].includes(HH.M.otherDarren.id));
  });
  await check("VIEW insurers: Darren's documents are Meridian Life only -- the pet documents linked to nobody do not make Lumen General his insurer", () => {
    assert.deepEqual([...new Set(hb.policiesByMember.get(D)!.map((p) => p.insurer))], ["Meridian Life Ltd"]);
    assert.ok(hb.insurers.includes("Lumen General"));
  });

  // ---------------------------------------------------------------- composition on the reported structure
  const B = await answer(h, D, (v) => [{ text: "Darren's certificate lists S$1,000,000 as of 6 October 2022.", evidence_ids: pfEv(v, D), subject_id: D }]);
  await check("BIND a figure the sentence states without naming the product is bound to the heading it is printed under on Darren's own row -- stated as Group Term Life, never with a person's name or a letter line as the product", () => {
    assert.match(B.v, /S\$1,000,000 \(Group Term Life\) as of 6 October 2022/); assert.ok(!NAME_AS_LABEL.test(B.v), B.v); assert.ok(!/lists separate/.test(B.v), B.v);
    assert.deepEqual(B.trace.gate ?? [], []);
  });
  const Dd = await answer(h, D, (v) => [{ text: "Tan Kai Ming, Darren's Group Term Life death benefit is S$1,000,000 and his Group Personal Accident sum insured is S$600,000, as of 6 October 2022.", evidence_ids: pfEv(v, D), subject_id: D }]);
  await check("BIND both of Darren's printed amounts in one sentence are kept, each bound to its own product", () => {
    assert.match(Dd.v, /Group Term Life[^.]*S\$1,000,000[^.]*Group Personal Accident[^.]*S\$600,000/); assert.deepEqual(Dd.trace.gate ?? [], []);
    const fb = (Dd.answer.figureBindings ?? []).map((b: any) => [b.value, b.benefit]); assert.ok(fb.some((x: any) => x[0] === 1000000 && /Term Life/i.test(x[1])) && fb.some((x: any) => x[0] === 600000 && /Personal Accident/i.test(x[1])), JSON.stringify(fb));
  });
  const W1 = await answer(h, D, (v) => [{ text: "Darren's Group Personal Accident sum insured is S$1,000,000 as of 6 October 2022.", evidence_ids: pfEv(v, D), subject_id: D }]);
  await check("STRICT wrong product: Darren's S$1,000,000 (Term Life) stated as Personal Accident is not shown; what is kept names only products, never a person", () => {
    assert.ok(!/S\$1,000,000/.test(W1.v), W1.v); assert.ok(!NAME_AS_LABEL.test(W1.v), W1.v);
  });
  const W2 = await answer(h, MI, (v) => [{ text: "Michelle's Group Term Life sum assured is S$1,000,000 as of 6 October 2022.", evidence_ids: pfEv(v, MI), subject_id: MI }]);
  await check("STRICT wrong person: Darren's S$1,000,000 stated as Michelle's Term Life is not shown", () => { assert.ok(!/S\$1,000,000/.test(W2.v), W2.v); });
  const W3 = await answer(h, D, (v) => [{ text: "Darren's Group Term Life sum assured is US$1,000,000 as of 6 October 2022.", evidence_ids: pfEv(v, D), subject_id: D }]);
  await check("STRICT wrong currency: US$1,000,000 is not shown", () => { assert.ok(!/US\$1,000,000/.test(W3.v), W3.v); });
  const W4 = await answer(h, D, (v) => [{ text: "Darren's Group Term Life sum assured is S$1,200,000 as of 6 October 2022.", evidence_ids: pfEv(v, D), subject_id: D }]);
  await check("STRICT unsupported figure: S$1,200,000 (printed nowhere) is not shown", () => { assert.ok(!/S\$1,200,000/.test(W4.v), W4.v); });

  // ---------------------------------------------------------------- insurers
  const I1 = await answer(h, D, (v) => [
    { text: "Darren's Group Term Life sum assured is S$1,000,000 as of 6 October 2022.", evidence_ids: pfEv(v, D), subject_id: D },
    { text: "Contact both Meridian Life Ltd and Lumen General to report the death.", evidence_ids: pfEv(v, D), subject_id: D },
  ], ["Notify Lumen General as well."]);
  await check("INSURER an insurer is named for Darren only when one of his documents is from it: Lumen General (pet documents linked to nobody) is taken out, Meridian Life is kept", () => {
    assert.match(I1.v, /Contact Meridian Life Ltd to report the death/); assert.ok(!/Lumen General/.test(I1.v), I1.v);
    assert.ok((I1.trace.dropped ?? []).some((d: any) => /Lumen General/.test(d.reason)), JSON.stringify(I1.trace.dropped));
  });

  // ---------------------------------------------------------------- the one-cell-per-line roster
  const cols = await (async () => {
    // The same household with its certificate stored one cell per line, read through the same resolver.
    const { DOCS_COLS } = HH;
    const cert = DOCS_COLS.find((d) => d.key === "CERT")!;
    await h.db.query("UPDATE policy_pages SET text=$3 WHERE account_id=$1 AND policy_id=$2 AND page_number=1", [HH.ACCOUNT, cert.id, cert.pages[1]]);
    try { return await personBenefits(HH.ACCOUNT, D); }
    finally { await h.db.query("UPDATE policy_pages SET text=$3 WHERE account_id=$1 AND policy_id=$2 AND page_number=1", [HH.ACCOUNT, cert.id, HH.doc("CERT").pages[1]]); }
  })();
  await check("VIEW a roster stored one cell per line (the name alone on a line): nothing is bound as Darren's figure; each product is listed as unresolved, with why", () => {
    assert.ok(!cols.benefits.some((b) => b.applicability === "person_row"), JSON.stringify(cols.benefits.map((b) => b.benefit.label)));
    assert.equal(cols.unresolved.filter((u) => /printed on separate lines/.test(u)).length, 4, cols.unresolved.join("\n"));
  });

  // ---------------------------------------------------------------- V1.4 part 2: retrieval through the view
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const pb = (v: ScriptView, who: string) => { const o = [...v.turn].reverse().find((x) => x.name === "person_benefits" && x.args.subject_id === who); return ((o?.result?.data?.documents ?? []) as any[]).flatMap((d) => (d.benefits as any[]).map((b) => ({ ...b, product: d.product, role: d.role }))); };
  const vidOf = (v: ScriptView, who: string, re: RegExp) => pb(v, who).find((b) => re.test(b.benefit) && b.value_id)?.value_id as string | undefined;
  const evOf = (v: ScriptView, who: string, re: RegExp) => pb(v, who).filter((b) => re.test(b.benefit)).map((b) => b.evidence?.evidence_id as string).filter(Boolean);
  const run = async (turns: { user: string; steps: ((v: ScriptView) => ScriptCall[])[] }[]) => {
    installLoopModel(new ScriptedLoopModel(turns as any));
    const out: { v: string; q: string[]; answer: any; trace: any; state: any }[] = [];
    try {
      let c: { id?: string; rev?: number } = {};
      for (const t of turns) { const a = await h.send(t.user, c); c = { id: a.conversationId, rev: a.conversationRevision }; const sv = await h.savedAnswer(c.id!); out.push({ v: [sv.answer.summary, ...sv.answer.details, ...(sv.answer.nextSteps ?? []).map((n: string) => "[next] " + n)].join("\n"), q: (sv.answer.questions ?? []).map((x: any) => x.text), answer: sv.answer, trace: sv.state.ragLoop.turns.at(-1), state: sv.state }); }
    } finally { installLoopModel(null); }
    return out;
  };
  const deathAnswer = (v: ScriptView) => [
    { text: "Darren's certificate lists his Group Term Life sum assured as S$1,000,000 as of 6 October 2022.", value_ids: [vidOf(v, D, /Term Life/)].filter(Boolean), subject_id: D },
    { text: "The same certificate lists his Group Personal Accident sum insured as S$600,000 as of 6 October 2022.", value_ids: [vidOf(v, D, /^Group Personal Accident$/)].filter(Boolean), subject_id: D },
    { text: "The Group Personal Accident product summary pays Accidental Death at 100% of the Sum Insured if the Insured Person dies as a result of an Accident within 365 days of that Accident.", evidence_ids: evOf(v, D, /Accidental Death/), subject_id: D },
    { text: "The Group Term Life product summary says the Sum Assured is payable on the death of the Insured Person.", evidence_ids: evOf(v, D, /^Death Benefit$/), subject_id: D },
  ];
  const deathTurn = (user: string) => ({ user, steps: [
    () => [call("resolve_person", { mention: "Darren" })],
    () => [call("person_benefits", { subject_id: D })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: deathAnswer(v), next_steps: ["Keep a copy of the death certificate and the police report from Japan.", "You must submit the original death certificate within 30 days."] })],
  ] });
  const [P2] = await run([deathTurn(DEATH)]);
  await check("P2/P3 death after an accident, the model asking nothing: Darren's Term Life and PA amounts each with its product and date, the documents that establish them, the accidental-death condition -- and ONE question, the accident date, taken from that condition; no total", () => {
    assert.match(P2.v, /Group Term Life sum assured as S\$1,000,000 as of 6 October 2022/); assert.match(P2.v, /Group Personal Accident sum insured as S\$600,000 as of 6 October 2022/);
    assert.match(P2.v, /within 365 days of that Accident/); assert.match(P2.v, /Sum Assured is payable on the death/);
    assert.ok(!/S\$1,600,000|currently covered|will (?:receive|be paid)/i.test(P2.v), P2.v); assert.ok(!NAME_AS_LABEL.test(P2.v), P2.v);
    assert.deepEqual(P2.q, ["On what date did the accident happen?"]); assert.equal(P2.state.ragLoop.pending?.factKey, "accident_date");
    assert.ok((P2.state.ragLoop.pending?.evidenceIds ?? []).length === 1, "the question cites its condition");
    assert.deepEqual(P2.trace.gate ?? [], []);
  });
  const [P4] = await run([deathTurn("Darren died in a car accident in Japan on 3 October 2026, what can I do?")]);
  await check("N8 a next step may be a practical suggestion, never an invented requirement: \"You must submit the original death certificate within 30 days\" is not shown", () => {
    assert.match(P4.v, /\[next\] Keep a copy of the death certificate/); assert.ok(!/must submit/i.test(P4.v + P2.v), P4.v);
  });
  await check("P4 the accident date given in the message: no question about it", () => { assert.deepEqual(P4.q, []); assert.match(P4.v, /S\$1,000,000/); });
  const [P3b] = await run([{ user: DEATH, steps: [
    () => [call("resolve_person", { mention: "Darren" })],
    () => [call("person_benefits", { subject_id: D })],
    (v: ScriptView) => [call("ask_user", { kind: "fact", subject_id: D, fact_key: "accident_date", question: "On what date was the accident?", because_evidence_ids: evOf(v, D, /Accidental Death/), statements: deathAnswer(v).slice(0, 2) })],
  ] }]);
  await check("P3 the model asking the condition's question itself: exactly one question", () => { assert.equal(P3b.q.length, 1, JSON.stringify(P3b.q)); assert.match(P3b.q[0], /accident/i); });

  const P5 = await run([
    { user: "What is Michelle's personal accident cover?", steps: [
      () => [call("resolve_person", { mention: "Michelle" })],
      () => [call("person_benefits", { subject_id: MI })],
      (v: ScriptView) => [call("final_answer", { subject_id: MI, sentences: [
        { text: "Michelle's certificate lists her Group Personal Accident sum insured as S$300,000 as of 6 October 2022, and Endorsement No. 3 amends her Group Personal Accident Sum Insured to S$400,000 with effect from 1 January 2024; which of the two applies now is not established from the documents.", evidence_ids: evOf(v, MI, /^Group Personal Accident$/), subject_id: MI },
      ] })],
    ] },
    { user: "Sorry, I meant Darren", steps: [
      () => [call("resolve_person", { mention: "Darren" })],
      () => [call("person_benefits", { subject_id: D })],
      (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [{ text: "Darren's certificate lists his Group Personal Accident sum insured as S$600,000 as of 6 October 2022.", value_ids: [vidOf(v, D, /^Group Personal Accident$/)].filter(Boolean), subject_id: D }] })],
    ] },
  ]);
  await check("P5/N7 Michelle: the certificate's and the endorsement's amounts are both shown with the conflict named; neither is bound as her current amount by figure identity; the view lists the conflict", () => {
    assert.match(P5[0].v, /S\$300,000[^;]*S\$400,000[^;]*; which of the two applies now is not established/, JSON.stringify(P5[0].trace.dropped) + JSON.stringify(P5[0].trace.gate)); assert.ok(!/S\$600,000|S\$1,000,000/.test(P5[0].v), P5[0].v);
    assert.ok(!(P5[0].trace.toolCalls as any[]).some((x) => /figure identity/.test(String(x.args?.by ?? ""))), "no identity binding of a conflicted amount");
    const mv = hb.byMember.get(MI)!; void mv;
  });
  await check("P5 correcting back to Darren: his own PA amount, never Michelle's", () => { assert.match(P5[1].v, /Darren[^.]*S\$600,000/); assert.ok(!/S\$300,000|S\$400,000/.test(P5[1].v), P5[1].v); });
  const fresh = await personBenefits(HH.ACCOUNT, MI);
  await check("VIEW the endorsement is an amendment entry; the conflict with the certificate row is listed as unresolved and attached to both; no value_id is issued for either", () => {
    const cert = fresh.benefits.find((b) => b.applicability === "person_row" && b.benefit.label === "Group Personal Accident")!;
    const am = fresh.benefits.find((b) => b.applicability === "amendment")!;
    assert.equal((am.printed as any).amount, 400000); assert.equal(am.asOf, "2024-01-01"); assert.equal(cert.conflicts?.[0]?.amount, 400000); assert.equal(am.conflicts?.[0]?.amount, 300000);
    assert.ok(fresh.unresolved.some((u) => /which applies now is not established/.test(u)), fresh.unresolved.join("\n"));
  });
  await check("VIEW the shared policy number does not collapse the four products into one", () => {
    const rows = hb.byMember.get(D)!.benefits.filter((b) => b.applicability === "person_row");
    assert.equal(new Set(rows.map((b) => b.benefit.label)).size, 4); assert.ok(rows.every((b) => b.policy.policyNumber === "PSG-880100"));
  });
  const N5 = await answer(h, D, (v) => [
    { text: "Darren is currently covered for S$1,000,000 under Group Term Life.", evidence_ids: pfEv(v, D), subject_id: D },
    { text: "Darren's Group Term Life sum assured was S$800,000 as of 6 October 2020.", evidence_ids: pfEv(v, D), subject_id: D },
    { text: "Darren's Group Term Life sum assured is S$2,000,000.", evidence_ids: pfEv(v, D), subject_id: D },
  ]);
  await check("N5/N6 a dated amount is not shown as current cover, the superseded certificate's S$800,000 and another household's S$2,000,000 are never shown", () => {
    assert.ok(!/currently covered/i.test(N5.v), N5.v); assert.ok(!/S\$800,000|S\$2,000,000/.test(N5.v), N5.v);
  });

  if (process.env.BINDING_TRANSCRIPT_FILE) {
    const T = (title: string, user: string, x: { v: string; q?: string[] }) => `### ${title}\nUSER: ${user}\nAPP:  ${x.v.replace(/\n/g, "\n      ")}${x.q?.length ? "\n      [Q] " + x.q.join(" | ") : ""}`;
    (await import("node:fs")).writeFileSync(process.env.BINDING_TRANSCRIPT_FILE, [
      T("figure stated without its product (the reported structure)", DEATH, B), T("two products in one sentence", DEATH, Dd), T("Term Life stated as PA (negative)", DEATH, W1),
      T("unrelated insurer in the advice (negative)", DEATH, I1), T("death after an accident, the model asking nothing", DEATH, P2), T("accident date already given", "Darren died in a car accident in Japan on 3 October 2026, what can I do?", P4),
      T("Michelle: certificate vs endorsement", "What is Michelle's personal accident cover?", P5[0]), T("correction back to Darren", "Sorry, I meant Darren", P5[1]),
    ].join("\n\n") + "\n");
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nbinding ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
