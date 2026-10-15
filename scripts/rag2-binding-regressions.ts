/**
 * V1.4 person / product / benefit binding (node --import tsx scripts/rag2-binding-regressions.ts; npm run rag2:binding-test).
 *
 * The household of scripts/fixtures/rag2-binding/household.ts reproduces the document STRUCTURE behind the reported
 * post-PR #48 answer ("The <scheme> lists separate Group Term Life and <member's name> amounts"): a certificate letter
 * printing the insured member's name on its own line above a roster of product headings. Scripted model moves through
 * the REAL chat route (PGlite); PLUMBING / CONTROL evidence, not model results. The live conversation was not
 * readable from this session, so this reproduces the structure, not the household's own internal trace.
 */
import "./fixtures/legacy-contract";
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
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: deathAnswer(v), next_steps: ["Keep a copy of the death certificate and the police report from Japan.", "You must submit the original death certificate within 30 days.", "Contact Meridian Life Ltd and ask which claim forms and supporting documents are required."] })],
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
    assert.match(P4.v, /\[next\] Suggestion, not stated in your documents \(confirm with the insurer\): Keep a copy of the death certificate and the police report from Japan\./, "the police report is not in the documents: the step is labelled as a suggestion"); assert.ok(!/must submit/i.test(P4.v + P2.v), P4.v);
    assert.match(P4.v, /\[next\] Contact Meridian Life Ltd and ask which claim forms and supporting documents are required/, "asking the insurer what is required is a suggestion");
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
        { text: "Endorsement No. 3 amends Michelle's Group Personal Accident Sum Insured to S$400,000 with effect from 1 January 2024; her certificate listed S$300,000 as of 6 October 2022, before that endorsement.", evidence_ids: evOf(v, MI, /^Group Personal Accident$/), subject_id: MI },
      ] })],
    ] },
    { user: "Sorry, I meant Darren", steps: [
      () => [call("resolve_person", { mention: "Darren" })],
      () => [call("person_benefits", { subject_id: D })],
      (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [{ text: "Darren's certificate lists his Group Personal Accident sum insured as S$600,000 as of 6 October 2022.", value_ids: [vidOf(v, D, /^Group Personal Accident$/)].filter(Boolean), subject_id: D }] })],
    ] },
  ]);
  await check("P5 Michelle: a validly linked endorsement effective from 1 January 2024 amends her certificate's PA amount as its wording says -- S$400,000 from that date, S$300,000 the earlier dated amount; no conflict invented", () => {
    assert.match(P5[0].v, /S\$400,000 with effect from 1 January 2024[^.]*S\$300,000 as of 6 October 2022/, JSON.stringify(P5[0].trace.dropped) + JSON.stringify(P5[0].trace.gate)); assert.ok(!/S\$600,000|S\$1,000,000|not established/.test(P5[0].v), P5[0].v);
  });
  await check("P5 correcting back to Darren: his own PA amount, never Michelle's", () => { assert.match(P5[1].v, /Darren[^.]*S\$600,000/); assert.ok(!/S\$300,000|S\$400,000/.test(P5[1].v), P5[1].v); });
  const fresh = await personBenefits(HH.ACCOUNT, MI);
  await check("VIEW precedence from the documents: the endorsement (linked to Michelle, same policy, 'is amended to', effective 2024-01-01) amends the certificate row printed as of 2022-10-06 -- recorded both ways, no conflict", () => {
    const cert = fresh.benefits.find((b) => b.applicability === "person_row" && b.benefit.label === "Group Personal Accident")!;
    const am = fresh.benefits.find((b) => b.applicability === "amendment")!;
    assert.equal((am.printed as any).amount, 400000); assert.equal(am.asOf, "2024-01-01");
    assert.deepEqual([cert.amendedBy?.amount, cert.amendedBy?.effective, am.amends?.amount, am.amends?.asOf], [400000, "2024-01-01", 300000, "2022-10-06"]);
    assert.ok(!cert.conflicts?.length && !am.conflicts?.length); assert.ok(!fresh.unresolved.some((u) => /not established/.test(u)), fresh.unresolved.join("\n"));
  });
  const endorse = HH.doc("ENDORSE"), certDoc = HH.doc("CERT");
  const withPage = async <T,>(policyId: string, text: string, fn: () => Promise<T>) => {
    const orig = (await h.db.query("SELECT text FROM policy_pages WHERE account_id=$1 AND policy_id=$2 AND page_number=1", [HH.ACCOUNT, policyId])).rows[0].text;
    await h.db.query("UPDATE policy_pages SET text=$3 WHERE account_id=$1 AND policy_id=$2 AND page_number=1", [HH.ACCOUNT, policyId, text]);
    try { return await fn(); } finally { await h.db.query("UPDATE policy_pages SET text=$3 WHERE account_id=$1 AND policy_id=$2 AND page_number=1", [HH.ACCOUNT, policyId, orig]); }
  };
  const noDate = await withPage(endorse.id, String(endorse.pages[1]).replace("With effect from 01/01/2024 the", "The"), () => personBenefits(HH.ACCOUNT, MI));
  const noVerb = await withPage(endorse.id, String(endorse.pages[1]).replace("is amended to S$400,000", "is noted as S$400,000"), () => personBenefits(HH.ACCOUNT, MI));
  const newerCert = await withPage(certDoc.id, String(certDoc.pages[1]).replace(/06\/10\/2022/g, "06/10/2025"), () => personBenefits(HH.ACCOUNT, MI));
  await check("N7 precedence NOT established is a named conflict, never resolved: an endorsement with no effective date, one whose wording does not amend, and a certificate dated after the endorsement", () => {
    for (const [what, v] of [["no effective date", noDate], ["no amending wording", noVerb], ["certificate newer than the endorsement", newerCert]] as const) {
      const cert = v.benefits.find((b) => b.applicability === "person_row" && b.benefit.label === "Group Personal Accident")!;
      assert.ok(cert.conflicts?.length && !cert.amendedBy, `${what}: ${JSON.stringify(v.benefits.filter((b) => b.applicability !== "shared_wording").map((b) => [b.applicability, b.benefit.label, (b.printed as any).amount, b.asOf, b.conditions[0], b.amendedBy, b.conflicts]))}`); assert.ok(v.unresolved.some((u) => /not established/.test(u)), `${what}: ${v.unresolved.join(" | ")}`);
    }
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

  // ---------------------------------------------------------------- V1.4 finish: uncertainty, malformed calls, reuse, insurers, layouts
  const { checkCitedStatement } = await import("@/lib/rag2/loop/statements");
  const sctx = { people: [{ id: D, names: ["Darren", "Tan Kai Ming"] }], policyNames: new Map([[certDoc.id, "PUBLIC SERVICE GROUP INSURANCE SCHEME"]]), subjectId: D };
  const certEv = [{ policyId: certDoc.id, subjectId: D, text: String(certDoc.pages[1]) }];
  await check("STATEMENT uncertainty is not a claim: \"do not establish whether Darren's cover was in force\" / \"it is unclear whether ...\" pass (they assert neither cover nor its absence)", () => {
    for (const t of ["The uploaded documents do not establish whether Darren's cover was in force on the accident date.", "It is unclear whether Darren's cover was still in force on that date.", "The certificate does not confirm if the cover continued after 6 October 2022."]) assert.equal(checkCitedStatement(t, certEv, sctx as any), null, t);
  });
  await check("STATEMENT negation and affirmation stay checked: \"Darren is not covered under this scheme\" (evidence says nothing of the kind) and \"Darren's cover was in force on the accident date\" (a dated roster is no proof of it) are refused; \"Darren is insured under Group Personal Accident\" passes", () => {
    assert.match(String(checkCitedStatement("Darren is not covered under this scheme.", certEv, sctx as any)), /not covered/);
    assert.match(String(checkCitedStatement("Darren's cover was in force on the accident date.", certEv, sctx as any)), /in force/);
    assert.match(String(checkCitedStatement("The documents do not establish whether the claim is valid, but Darren's cover was in force on that date.", certEv, sctx as any)), /in force/);
    assert.equal(checkCitedStatement("Darren is insured under Group Personal Accident.", certEv, sctx as any), null);
  });
  const MAL = await run([{ user: "malformed", steps: [
    () => [call("resolve_person", { mention: "Darren" })],
    () => [call("person_benefits", { subject_id: D })],
    (v: ScriptView) => [call("select_table_value", { policy_id: certDoc.id, benefit: "Group Term Life", subject_id: D, want: "amount" })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [{ text: "Darren's certificate lists his Group Term Life sum assured as S$1,000,000 as of 6 October 2022.", [String(vidOf(v, D, /Term Life/))]: [String(vidOf(v, D, /Term Life/))], subject_id: D }, { text: "The Group Personal Accident product summary pays Accidental Death at 100% of the Sum Insured if the Insured Person dies as a result of an Accident within 365 days of that Accident.", [evOf(v, D, /Accidental Death/).join(",")]: evOf(v, D, /Accidental Death/), subject_id: D }] })],
  ] }].map((t) => ({ ...t, user: "Darren died in a car accident in Japan on 3 October 2026, what can I do?" })));
  await check("CALLS ids written as object keys ({\"v1\": [\"v1\"]}, {\"e8\": [\"e8\"]}) are moved into their citation fields -- the answer is accepted on the first call; a select_table_value for a row person_benefits already read reuses its value id", () => {
    const tc = MAL[0].trace.toolCalls as any[];
    assert.ok(tc.filter((x) => x.name === "final_answer").every((x) => x.ok), JSON.stringify(tc.map((x) => [x.name, x.ok, x.error])));
    assert.match(MAL[0].v, /S\$1,000,000 as of 6 October 2022/); assert.match(MAL[0].v, /365 days/);
    assert.ok((MAL[0].trace.adjusted ?? []).some((a: string) => /citation fields/.test(a)), JSON.stringify(MAL[0].trace.adjusted));
    const sel = tc.find((x) => x.name === "select_table_value"); assert.match(String(sel?.summary ?? ""), /"status":"ok"/);
  });
  const { validateArgs } = await import("@/lib/rag2/tools");
  const { FINAL_ANSWER } = await import("@/lib/rag2/loop/actions");
  await check("CALLS any other unknown key is still refused, with the allowed fields named so the model can correct it", () => {
    assert.match(String(validateArgs(FINAL_ANSWER.parameters, { sentences: [{ text: "x", evidence: ["e1"] }] })), /sentences\[0\]\.evidence is not a parameter of this tool \(allowed here: text, evidence_ids, value_ids/);
  });
  const REF = await answer(h, D, (v) => [
    { text: "The Group Personal Accident product summary pays Accidental Death at 100% of the Sum Insured if the Insured Person dies as a result of an Accident within 365 days of that Accident.", evidence_ids: (() => { const o = v.find("policies_for", (o) => o.args.subject_id === D); const c = ((o?.result?.data?.covering ?? []) as any[]).find((x) => x.policyId === HH.doc("GPA_SUM").id); return ((c?.evidence ?? []) as any[]).map((e) => e.evidence_id as string); })(), subject_id: D },
    { text: "Contact Meridian Life Ltd to report the death.", evidence_ids: [], subject_id: D },
  ], ["Contact Meridian Life Ltd to start the claim."]);
  await check("INSURER a linked reference booklet is not a personal policy: with only the PA product summary cited, Meridian Life is not recommended (the certificate, a personal policy, is what establishes it -- see INSURER above)", () => {
    assert.ok(!/Contact Meridian Life/i.test(REF.v), REF.v);
  });
  await check("LAYOUT one row per line (the fixture's default): both amounts shown, each with its own product and date (P2)", () => { assert.match(P2.v, /Group Term Life sum assured as S\$1,000,000 as of 6 October 2022/); assert.match(P2.v, /Group Personal Accident sum insured as S\$600,000/); });

  // ---------------------------------------------------------------- V1.4 layouts: the same certificate stored differently
  const withCert = async <T,>(pages: Record<number, string>, fn: () => Promise<T>): Promise<T> => {
    const orig = (await h.db.query("SELECT page_number, text FROM policy_pages WHERE account_id=$1 AND policy_id=$2", [HH.ACCOUNT, certDoc.id])).rows as { page_number: number; text: string }[];
    await h.db.query("DELETE FROM policy_pages WHERE account_id=$1 AND policy_id=$2", [HH.ACCOUNT, certDoc.id]);
    for (const [n, t] of Object.entries(pages)) await h.db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [HH.ACCOUNT, certDoc.id, Number(n), t]);
    try { return await fn(); }
    finally {
      await h.db.query("DELETE FROM policy_pages WHERE account_id=$1 AND policy_id=$2", [HH.ACCOUNT, certDoc.id]);
      for (const o of orig) await h.db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [HH.ACCOUNT, certDoc.id, o.page_number, o.text]);
    }
  };
  const rowsOf = (v: Awaited<ReturnType<typeof personBenefits>>) => v.benefits.filter((b) => b.applicability === "person_row" && b.policy.id === certDoc.id).map((b) => [b.benefit.label, (b.printed as any).amount, (b.printed as any).currency, b.asOf, b.source.evidence.table?.rowPerson?.memberId, b.source.row?.label]).sort((x, y) => String(x[0]).localeCompare(String(y[0])));
  const L: Record<string, { d: Awaited<ReturnType<typeof personBenefits>>; m: Awaited<ReturnType<typeof personBenefits>> }> = {};
  for (const k of ["rows", "cells", "break", "same", "missing", "stray"] as const) L[k] = await withCert(HH.certLayout(k), async () => ({ d: await personBenefits(HH.ACCOUNT, D), m: await personBenefits(HH.ACCOUNT, MI) }));
  await check("LAYOUT complete rows, one cell per line, and one cell per line across a page break (heading repeated \"(continued)\", running header) give the SAME person-specific benefits for both people", () => {
    assert.equal(rowsOf(L.rows.d).length, 4); assert.equal(rowsOf(L.rows.m).length, 4);
    assert.deepEqual(rowsOf(L.cells.d), rowsOf(L.rows.d)); assert.deepEqual(rowsOf(L.cells.m), rowsOf(L.rows.m));
    assert.deepEqual(rowsOf(L.break.d), rowsOf(L.rows.d)); assert.deepEqual(rowsOf(L.break.m), rowsOf(L.rows.m));
    assert.ok(!L.cells.d.unresolved.length && !L.break.d.unresolved.some((u) => /row|cell/.test(u)), JSON.stringify([L.cells.d.unresolved, L.break.d.unresolved]));
  });
  await check("LAYOUT identical amounts for both people: each person's rows are their own -- bound by the record's name cell, not by the number", () => {
    for (const [v, who, name] of [[L.same.d, D, /Darren/], [L.same.m, MI, /Michelle/]] as const) {
      const r = rowsOf(v); assert.equal(r.length, 4); assert.ok(r.every((x) => x[1] === 500000 && x[4] === who && name.test(String(x[5]))), JSON.stringify(r));
    }
  });
  await check("LAYOUT missing cells are not guessed: Darren's Group Personal Accident row without an amount, and Michelle's Living Care row without its ID (two rows run together), are named gaps; every other row is read", () => {
    const d = rowsOf(L.missing.d).map((x) => x[0]), m = rowsOf(L.missing.m).map((x) => x[0]);
    assert.deepEqual(d, ["Group Living Care Plus", "Group Term Life"]); assert.deepEqual(m, ["Group Living Care Plus", "Group Personal Accident", "Group Term Life"]);
    assert.ok(L.missing.d.unresolved.some((u) => /row 1 under “GROUP PERSONAL ACCIDENT” \(Tan Kai Ming, Darren\) has no amount/.test(u)), L.missing.d.unresolved.join(" | "));
    assert.ok(L.missing.d.unresolved.some((u) => /under “GROUP LIVING CARE” .*more than one name -- a cell is missing between two rows/.test(u)), L.missing.d.unresolved.join(" | "));
  });
  await check("LAYOUT a line that is not a roster cell inside a block stops the reading there, with the line named: the rows after it are unresolved, never re-associated", () => {
    const m = rowsOf(L.stray.m).map((x) => x[0]); assert.ok(!m.includes("Group Living Care"), JSON.stringify(m)); assert.ok(m.includes("Group Living Care Plus"));
    assert.ok(L.stray.m.unresolved.some((u) => /not a roster cell \(“Refer to the Policy Wording/.test(u)), L.stray.m.unresolved.join(" | "));
  });
  const cellsDeath = await withCert(HH.certLayout("cells"), () => run([deathTurn(DEATH)]));
  const breakDeath = await withCert(HH.certLayout("break"), () => run([deathTurn(DEATH)]));
  await check("LAYOUT one cell per line (and across a page break): the death answer states Darren's Term Life S$1,000,000 and PA S$600,000, each with its product and date, verified by the save-time check; the one date question is asked", () => {
    for (const [what, x] of [["cells", cellsDeath[0]], ["break", breakDeath[0]]] as const) {
      assert.match(x.v, /Group Term Life sum assured as S\$1,000,000 as of 6 October 2022/, `${what}: ${x.v}`); assert.match(x.v, /Group Personal Accident sum insured as S\$600,000 as of 6 October 2022/, `${what}: ${x.v}`);
      assert.deepEqual(x.trace.gate ?? [], [], what); assert.deepEqual(x.q, ["On what date did the accident happen?"], what);
      const fb = (x.answer.figureBindings ?? []).map((b: any) => [b.value, b.benefit, b.subjectId, b.rowPerson]);
      assert.ok(fb.some((b: any) => b[0] === 1000000 && /Term Life/.test(b[1]) && b[2] === D && /Darren/.test(b[3])) && fb.some((b: any) => b[0] === 600000 && /Personal Accident/.test(b[1]) && b[2] === D), `${what}: ${JSON.stringify(fb)}`);
    }
  });
  const { verifyAnswerFigures } = await import("@/lib/chat/answer-verification");
  const swapped = await withCert(HH.certLayout("cells"), async () => {
    const out: string[][] = [];
    for (const [field, value] of [["subjectId", MI], ["rowPerson", "Ong Li Ting, Michelle"], ["benefit", "Group Personal Accident"]] as const) {
      const a = structuredClone(cellsDeath[0].answer); const b = a.figureBindings.find((x: any) => x.value === 1000000); b[field] = value;
      out.push((await verifyAnswerFigures(a, { accountId: HH.ACCOUNT, userText: DEATH, report: true })).map((p: any) => p.reason ?? String(p)));
    }
    return out;
  });
  await check("LAYOUT one cell per line: swapped bindings fail the save-time check -- Darren's S$1,000,000 Term Life row bound to Michelle, to Michelle's name cell, or to Personal Accident", () => {
    for (const r of swapped) assert.ok(r.length, JSON.stringify(swapped));
  });

  // s50-live-1 turn 1: the model looked the household's documents up (household_documents) while answering the death
  // question; the inventory rule then replaced the answer, silently removing the verified amounts and their bindings.
  const twoFigures = (v: ScriptView) => [
    { text: "Darren’s certificate lists Group Term Life sum assured of S$1,000,000 and Group Personal Accident sum assured of S$600,000, each as of 6 October 2022; these dated figures do not confirm cover on the date of death.", value_ids: [vidOf(v, D, /Term Life/), vidOf(v, D, /^Group Personal Accident$/)].filter(Boolean), subject_id: D },
    { text: "The Group Personal Accident product summary pays Accidental Death at 100% of the Sum Insured if the Insured Person dies as a result of an Accident within 365 days of that Accident.", evidence_ids: evOf(v, D, /Accidental Death/), subject_id: D },
  ];
  const lookedUp = { user: DEATH, steps: [() => [call("resolve_person", { mention: "Darren" })], () => [call("household_documents", {})], () => [call("person_benefits", { subject_id: D })], (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: twoFigures(v) })]] };
  const lookedRows = await run([lookedUp as any]);
  const lookedCells = await withCert(HH.certLayout("cells"), () => run([lookedUp as any]));
  const { INVENTORY_QUESTION } = await import("@/lib/rag2/loop/loop");
  const INV_Q = "What policies does my family have?";
  const inventoryTurn = { user: INV_Q, steps: [() => [call("household_documents", {})], () => [call("final_answer", { sentences: [{ text: "Here are the documents on file for your household." }] })]] };
  const MIXED = "Darren died in a car accident in Japan. What can I do, and which documents do we have for him?";
  const mixedTurn = { user: MIXED, steps: [() => [call("resolve_person", { mention: "Darren" })], () => [call("household_documents", {})], () => [call("person_benefits", { subject_id: D })], (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: twoFigures(v) })]] };
  const BACK = "The accident happened on 3 October 2026 and he died on 5 October 2026.";
  const nf2 = () => () => [call("note_facts", { subject_id: D, facts: [{ key: "accident_date", value: "2026-10-03", words: "The accident happened on 3 October 2026" }, { key: "death_date", value: "2026-10-05", words: "he died on 5 October 2026" }] })];
  const backTurn = { user: BACK, steps: [() => [call("note_facts", { subject_id: D, facts: [{ key: "accident_date", value: "2026-10-03", words: "The accident happened on 3 October 2026" }, { key: "death_date", value: "2026-10-05", words: "he died on 5 October 2026" }] })], () => [call("person_benefits", { subject_id: D })], (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: twoFigures(v) })]] };
  const invOnly = await run([inventoryTurn as any]);
  const invThenDeath = await withCert(HH.certLayout("cells"), () => run([inventoryTurn as any, lookedUp as any]));
  const mixedThenBack = await withCert(HH.certLayout("cells"), () => run([mixedTurn as any, backTurn as any]));
  const AMOUNTS = /Group Term Life sum assured of S\$1,000,000 and Group Personal Accident sum assured of S\$600,000/;
  const INVENTORY_LINES = /Not linked to anyone in the household/;
  const boundBoth = (x: any) => { const fb = (x.answer.figureBindings ?? []) as any[]; return fb.some((b) => b.value === 1000000 && /Term Life/.test(b.benefit) && b.subjectId === D) && fb.some((b) => b.value === 600000 && /Personal Accident/.test(b.benefit) && b.subjectId === D); };
  await check("INVENTORY (1) a death question that looks the documents up keeps its verified amounts, saved and bound (rows and one cell per line); no inventory, no unrelated insurer", () => {
    for (const [what, x] of [["rows", lookedRows[0]], ["cells", lookedCells[0]]] as const) {
      assert.match(x.v, AMOUNTS, `${what}: ${x.v}`); assert.ok(boundBoth(x), what); assert.ok(!INVENTORY_LINES.test(x.v) && !/Lumen General/.test(x.v), `${what}: ${x.v}`); assert.deepEqual(x.q, ["On what date did the accident happen?"], what);
    }
  });
  await check("INVENTORY (2) a genuine inventory request is answered as the inventory: every document by person, the unlinked pet documents as linked to nobody, no amounts", () => {
    const x = invOnly[0];
    assert.match(x.v, INVENTORY_LINES, x.v); assert.match(x.v, /PUBLIC SERVICE GROUP INSURANCE SCHEME/, x.v); assert.ok(!/S\$\d/.test(x.v), x.v); assert.ok(!/(?:contact|notify|claim with)[^.]*Lumen General/i.test(x.v), x.v);
  });
  await check("INVENTORY (3) an inventory question, then a death question: the second answer is the claim answer with its amounts, not an inventory", () => {
    assert.match(invThenDeath[0].v, INVENTORY_LINES, invThenDeath[0].v);
    const x = invThenDeath[1];
    assert.match(x.v, AMOUNTS, x.v); assert.ok(boundBoth(x)); assert.ok(!INVENTORY_LINES.test(x.v) && !/Lumen General/.test(x.v), x.v); assert.deepEqual(x.q, ["On what date did the accident happen?"]);
  });
  await check("INVENTORY (4) a death question with an inventory side question keeps the claim's verified amounts AND lists the documents; returning to the claim answers the claim, without the inventory or a date question", () => {
    const [m, b] = mixedThenBack;
    assert.match(m.v, AMOUNTS, m.v); assert.ok(boundBoth(m), JSON.stringify(m.answer.figureBindings)); assert.match(m.v, INVENTORY_LINES, m.v);
    assert.ok(!/(?:contact|notify|claim with|ask)[^.]*Lumen General/i.test(m.v), m.v);
    assert.match(b.v, AMOUNTS, b.v); assert.ok(boundBoth(b)); assert.ok(!INVENTORY_LINES.test(b.v) && !/Lumen General/.test(b.v), b.v); assert.deepEqual(b.q, []);
  });
  await check("INVENTORY only an inventory question is answered as an inventory (classification)", () => {
    for (const q of [INV_Q, MIXED, "Which documents do we have for Michelle?", "List the policies on file", "What plans does Darren have?"]) assert.ok(INVENTORY_QUESTION.test(q), q);
    for (const q of [DEATH, "Darren passed away after a traffic accident while travelling in Japan. What insurance can we claim for him?", "What documents do I need to submit for the claim?", BACK]) assert.ok(!INVENTORY_QUESTION.test(q), q);
  });

  // ---------------------------------------------------------------- V1.4: death wording and paperwork
  const gpaId = HH.doc("GPA_SUM").id;
  const calcTurn = { user: BACK, steps: [
    () => [call("note_facts", { subject_id: D, facts: [{ key: "accident_date", value: "2026-10-03", words: "The accident happened on 3 October 2026" }, { key: "death_date", value: "2026-10-05", words: "he died on 5 October 2026" }] })], 
    () => [call("person_benefits", { subject_id: D })],
    (v: ScriptView) => [call("calculate", { calculator: "lump_sum", benefit: "Accidental Death", purpose: "claim", condition: "death as a result of an Accident within 365 days of that Accident", policy_id: gpaId, subject_id: D, assumption_words: BACK, sum_insured_value_id: vidOf(v, D, /^Group Personal Accident$/) })],
    (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [
      ...twoFigures(v),
      { text: "The Group Personal Accident summary identifies a specialist’s diagnosis report and medical records as relevant evidence for this claim.", evidence_ids: evOf(v, D, /Accidental Death/), subject_id: D },
    ], next_steps: [
      "Notify Meridian Life Ltd about the death within 6 months, with the death certificate.",
      "Notify Meridian Life Ltd about the death and ask for the claim requirements; provide the death certificate and relevant medical records.",
      "Ask Meridian Life Ltd whether it needs a police report from Japan.",
    ] })],
  ] };
  const [, deathCalc] = await withCert(HH.certLayout("cells"), () => run([lookedUp as any, calcTurn as any]));
  const calcCall = (deathCalc.trace.toolCalls ?? []).find((x: any) => x.name === "calculate");
  await check("DEATH WORDING a death benefit's explanation comes from the benefit and its printed condition: no diagnosis, medical assessment or specialist report; no suggested evidence from the calculator", () => {
    assert.ok(calcCall?.ok, JSON.stringify(calcCall));
    assert.ok(!/diagnos|medical assessment|specialist/i.test(deathCalc.v), deathCalc.v);
    assert.match(deathCalc.v, AMOUNTS, deathCalc.v); assert.deepEqual(deathCalc.q, []);
  });
  await check("PAPERWORK a sentence presenting paperwork the documents do not print as needed is not stated; next steps naming it are labelled as suggestions to confirm with the insurer; documented paperwork and asking the insurer stay as they are", () => {
    assert.ok((deathCalc.trace.dropped ?? []).some((d: any) => /paperwork/.test(d.reason) && /medical records|diagnosis report/.test(d.sentence ?? d.text ?? "")), JSON.stringify(deathCalc.trace.dropped));
    assert.match(deathCalc.v, /\[next\] Notify Meridian Life Ltd about the death within 6 months, with the death certificate\./, deathCalc.v);
    assert.match(deathCalc.v, /\[next\] Suggestion, not stated in your documents \(confirm with the insurer\): Notify Meridian Life Ltd about the death and ask for the claim requirements; provide the death certificate and relevant medical records\./, deathCalc.v);
    assert.match(deathCalc.v, /\[next\] Ask Meridian Life Ltd whether it needs a police report from Japan\./, deathCalc.v);
  });
  // s50-live-2 turn 2: the answer also cited the Term Life summary (which mentions a Terminal Illness diagnosis and the
  // death certificate); the "your own account" note then asked for a doctor's report and scans for a death.
  const searchHit = (v: ScriptView, re: RegExp) => { for (const o of [...v.turn].reverse()) if (o.name === "search_passages" && o.ok) { const h = ((o.result?.data?.hits ?? []) as any[]).find((x) => re.test(x.evidence?.excerpt ?? "")); if (h) return [h.evidence.evidence_id as string]; } return [] as string[]; };
  const citesTermLife = { user: BACK, steps: [nf2(), () => [call("person_benefits", { subject_id: D })], () => [call("search_passages", { query: "Group Term Life death benefit notify death certificate", subject_id: D })], (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [
    ...twoFigures(v),
    { text: "The Group Term Life product summary says the Sum Assured is payable on the death of the Insured Person, and to notify Meridian Life Ltd of a death within 6 months, with the death certificate.", evidence_ids: searchHit(v, /Terminal Illness|death certificate/), subject_id: D },
  ] })]] };
  const [, termLifeCited] = await withCert(HH.certLayout("cells"), () => run([lookedUp as any, citesTermLife as any]));
  const { reportedFactFollowUp, REPORTED_NOTE, REPORTED_MEDICAL_NOTE } = await import("@/lib/rag2/loop/compose");
  await check("REPORTED NOTE the note after the household answers is chosen from the answered condition: a death answer citing the Term Life summary gets no doctor's report or scans; a medical condition keeps them", () => {
    assert.ok(!/doctor|scan|medical record/i.test(termLifeCited.v), termLifeCited.v);
    assert.match(termLifeCited.v, /death certificate/, "the Term Life passage (which also prints a Terminal Illness diagnosis) is cited: " + termLifeCited.v);
    assert.match(termLifeCited.v, /your own account/, termLifeCited.v);
    assert.equal(reportedFactFollowUp(["Accidental Death: 100% of the Sum Insured if the Insured Person dies as a result of an Accident within 365 days of that Accident.", "notify Meridian Life Ltd of a death within 6 months, with the death certificate", "the Sum Assured shown in the Certificate of Group Insurance"]).note, REPORTED_NOTE);
    assert.equal(reportedFactFollowUp(["a Simple Fracture confirmed by X-ray"]).note, REPORTED_MEDICAL_NOTE);
    assert.equal(reportedFactFollowUp(["diagnosed by a specialist"]).note, REPORTED_MEDICAL_NOTE);
  });
  const { benefitEvent } = await import("@/lib/rag2/calc/engine");
  const { labelUnsupportedPaperwork, unsupportedPaperworkClaim } = await import("@/lib/rag2/loop/compose");
  await check("EVENT KINDS a death benefit is a death; injury and illness benefits keep their medical wording", () => {
    assert.equal(benefitEvent("Accidental Death", "death as a result of an Accident within 365 days of that Accident"), "death");
    assert.equal(benefitEvent("Death Benefit", "the Sum Assured is payable on the death of the Insured Person"), "death");
    assert.equal(benefitEvent("Simple Fracture", "a closed fracture of the leg caused by an Accident"), "injury");
    assert.equal(benefitEvent("Accidental Death and Dismemberment", "loss of a limb within 365 days of the Accident"), "injury");
    assert.equal(benefitEvent("Critical Illness", "diagnosis of a covered critical illness"), "illness");
    const src = "notify meridian life ltd of a death within 6 months, with the death certificate.";
    assert.equal(labelUnsupportedPaperwork("Keep the death certificate.", src), "Keep the death certificate.");
    assert.match(labelUnsupportedPaperwork("Keep the police report and translations.", src), /^Suggestion, not stated in your documents/);
    assert.equal(unsupportedPaperworkClaim("You must provide the death certificate.", src), null);
    assert.ok(unsupportedPaperworkClaim("You must provide the medical records.", src));
    assert.equal(unsupportedPaperworkClaim("The documents do not state which medical records are needed.", src), null);
  });

  // ---------------------------------------------------------------- V1.4: endorsement scope and the speaker
  // s50-live-2: Michelle's endorsement (it names only her, and is linked only to her) was reported by policies_for as
  // amending Darren's certificate (shared policy number), and the model then cited it as making Darren's amount uncertain.
  const END = HH.doc("ENDORSE"), CERT_ID = HH.doc("CERT").id;
  const { policiesFor } = await import("@/lib/rag2/policies");
  const { endorsementScope } = await import("@/lib/rag2/endorsement-scope");
  const { otherPersonsEndorsement } = await import("@/lib/rag2/loop/compose");
  const certCov = async (who: string) => { const r = await policiesFor({ accountId: HH.ACCOUNT, subjectId: who, topic: "accident" }); return [...r.covering, ...r.notCovering].find((c) => c.policyId === CERT_ID)!; };
  const household = [{ id: D, names: [HH.M.darren.name, "Darren"] }, { id: MI, names: [HH.M.michelle.name, "Michelle"] }];
  const caveat = { user: DEATH, steps: [() => [call("person_benefits", { subject_id: D })], (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [
    twoFigures(v)[0],
    { text: "Darren’s Group Personal Accident amount may differ, because an endorsement effective 1 January 2024 amends the policy.", evidence_ids: evOf(v, D, /^Group Personal Accident$/), subject_id: D },
  ] })]] };
  const [otherCaveat] = await run([caveat as any]);
  await check("ENDORSEMENT another person's endorsement cannot qualify Darren's cover: not reported as amending his certificate, and a caveat relying on it is not shown (Michelle's own view keeps it)", async () => {
    assert.equal(endorsementScope({ text: String(END.pages[1]), subjectId: D, household }).scope, "other");
    assert.equal(endorsementScope({ text: String(END.pages[1]), subjectId: MI, household }).scope, "applies");
    assert.equal(endorsementScope({ text: "Policyholder: Ong Li Ting, Michelle\nWith effect from 1 July 2026 the Daily Hospital Allowance is amended to S$110.", subjectId: D, household }).scope, "applies", "naming the policyholder is not a person-specific scope");
    const d = await certCov(D), m = await certCov(MI);
    assert.deepEqual(d.version.amendments, []); assert.equal(d.version.current, "the schedule as issued");
    assert.deepEqual(m.version.amendments.map((a) => [a.policyId, a.scope]), [[END.id, "applies"]]);
    assert.ok(!/endorsement|amend/i.test(otherCaveat.v), otherCaveat.v); assert.match(otherCaveat.v, AMOUNTS);
    assert.ok((otherCaveat.trace.dropped ?? []).some((x: any) => /applies only to Michelle/.test(x.reason)), JSON.stringify(otherCaveat.trace.dropped));
  });
  const SHARED = ["Meridian Life Ltd - Public Service Group Insurance Scheme - Endorsement No. 3 (Policy No. PSG-880100)", "With effect from 01/01/2024 the territorial limits for all Insured Persons are amended to worldwide excluding sanctioned countries.", "All other terms and conditions remain unchanged."].join("\n");
  const NAMES_DARREN = ["Meridian Life Ltd - Public Service Group Insurance Scheme - Endorsement No. 3 (Policy No. PSG-880100)", "With effect from 01/01/2024 the Group Personal Accident Sum Insured for Tan Kai Ming, Darren is amended to S$700,000."].join("\n");
  const [sharedCov, sharedCaveat, namedCov] = await withPage(END.id, SHARED, async () => [await certCov(D), (await run([caveat as any]))[0], await withPage(END.id, NAMES_DARREN, () => certCov(D))] as const);
  await check("ENDORSEMENT a shared endorsement applies to Darren when its scope explicitly includes him (all Insured Persons, or naming him), though the document is linked to Michelle; a caveat relying on it stays", () => {
    assert.deepEqual(sharedCov.version.amendments.map((a) => [a.policyId, a.scope, a.scopeBasis]), [[END.id, "applies", "its wording applies to all insured persons"]]);
    assert.equal(sharedCov.version.current, "the schedule as amended by the endorsement effective 2024-01-01");
    assert.deepEqual(namedCov.version.amendments.map((a) => [a.scope, a.scopeBasis]), [["applies", "its amending clause names this person"]]);
    assert.match(sharedCaveat.v, /an endorsement effective 1 January 2024 amends the policy/, sharedCaveat.v);
  });
  const UNSTATED = ["Meridian Life Ltd - Public Service Group Insurance Scheme - Endorsement No. 3 (Policy No. PSG-880100)", "With effect from 01/01/2024 the Group Personal Accident Sum Insured for the Insured Person S****999Z is amended to S$400,000."].join("\n");
  const links = (await h.db.query("SELECT policy_id, family_member_id, account_id, source, confidence, benefit_tier FROM policy_members WHERE policy_id=$1", [END.id])).rows as any[];
  await h.db.query("DELETE FROM policy_members WHERE policy_id=$1", [END.id]);
  let unresolved: { d: any; m: any; ctxScope: any[] };
  try {
    unresolved = await withPage(END.id, UNSTATED, async () => {
      const { householdBenefits } = await import("@/lib/rag2/benefits");
      const hb = await householdBenefits(HH.ACCOUNT);
      return { d: await certCov(D), m: await certCov(MI), ctxScope: [hb.endorsementsByMember.get(D), hb.endorsementsByMember.get(MI)] };
    });
  } finally { for (const l of links) await h.db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence,benefit_tier) VALUES($1,$2,$3,$4,$5,$6)", [l.policy_id, l.family_member_id, l.account_id, l.source, l.confidence, l.benefit_tier]); }
  await check("ENDORSEMENT a person-specific endorsement whose person is not established (a masked ID matching no household member) is reported as exactly that, for each person, and attributed to nobody", () => {
    for (const c of [unresolved.d, unresolved.m]) {
      assert.deepEqual(c.version.amendments.map((a: any) => a.scope), ["unresolved"]);
      assert.match(c.version.current, /^not established: an endorsement of this policy number \(effective 2024-01-01\) does not establish whom it applies to$/);
      const note = c.undetermined.find((u: string) => /does not establish which household member/.test(u));
      assert.ok(note && !/Darren|Michelle|Tan Kai Ming|Ong Li Ting/.test(note), JSON.stringify(c.undetermined));
    }
    for (const list of unresolved.ctxScope) assert.deepEqual(list.map((e: any) => [e.scope, e.namedIds]), [["unresolved", []]]);
    assert.equal(otherPersonsEndorsement("An endorsement effective 1 January 2024 may change this amount.", D, { benefits: { endorsementsByMember: new Map([[D, unresolved.ctxScope[0]]]) } as any, people: household }), null, "an unresolved endorsement may be reported as uncertainty");
  });
  const { stateNote } = await import("@/lib/rag2/loop/prompt");
  const { withoutUnconfirmedAddress } = await import("@/lib/rag2/loop/compose");
  const { emptyLoopState } = await import("@/lib/rag2/loop/types");
  await check("SPEAKER the member recorded as self is not presented as the person typing unless the household said so; the reader is not addressed by name", () => {
    const people = [{ id: D, name: "Darren", relationship: "self" }, { id: MI, name: "Michelle", relationship: "spouse" }];
    const unconfirmed = stateNote({ ...emptyLoopState(), speakerId: D } as any, people, D);
    assert.ok(!/the person typing\)/.test(unconfirmed) && /Speaker[^\n]*not established \(the sign-in identifies the household, not the member\)[^\n]*never assume or say who is typing, and never address them by name/.test(unconfirmed), unconfirmed);
    const confirmed = stateNote({ ...emptyLoopState(), speakerId: MI, speakerConfirmed: true } as any, people, MI);
    assert.match(confirmed, /Michelle \(spouse, the person typing\)/); assert.match(confirmed, /Speaker \("I" \/ "me" \/ "my"\): Michelle id=/);
    assert.equal(withoutUnconfirmedAddress("I’m so sorry for your loss, Michelle; Darren’s certificate lists S$1.", household), "I’m so sorry for your loss; Darren’s certificate lists S$1.");
    assert.equal(withoutUnconfirmedAddress("Michelle’s certificate lists S$300,000.", household), "Michelle’s certificate lists S$300,000.");
  });

  if (process.env.BINDING_TRANSCRIPT_FILE) {
    const T = (title: string, user: string, x: { v: string; q?: string[] }) => `### ${title}\nUSER: ${user}\nAPP:  ${x.v.replace(/\n/g, "\n      ")}${x.q?.length ? "\n      [Q] " + x.q.join(" | ") : ""}`;
    (await import("node:fs")).writeFileSync(process.env.BINDING_TRANSCRIPT_FILE, [
      T("figure stated without its product (the reported structure)", DEATH, B), T("two products in one sentence", DEATH, Dd), T("Term Life stated as PA (negative)", DEATH, W1),
      T("unrelated insurer in the advice (negative)", DEATH, I1), T("death after an accident, the model asking nothing", DEATH, P2), T("accident date already given", "Darren died in a car accident in Japan on 3 October 2026, what can I do?", P4),
      T("Michelle: certificate vs endorsement", "What is Michelle's personal accident cover?", P5[0]), T("correction back to Darren", "Sorry, I meant Darren", P5[1]),
      T("inventory request", INV_Q, invOnly[0]), T("death question that looks the documents up (cells)", DEATH, lookedCells[0]),
      T("death question with an inventory side question (cells)", MIXED, mixedThenBack[0]), T("back to the claim, both dates", BACK, mixedThenBack[1]),
      T("both dates, Accidental Death calculation, paperwork in sentences and next steps (cells)", BACK, deathCalc),
      T("certificate one cell per line", DEATH, cellsDeath[0]), T("certificate one cell per line, page break and repeated heading", DEATH, breakDeath[0]),
    ].join("\n\n") + "\n");
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nbinding ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
