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

  const failed = results.filter((r) => !r.ok);
  console.log(`\nbinding ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
