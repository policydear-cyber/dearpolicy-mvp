/**
 * V1.5: regressions for the live verification after PR #49 (14 Oct 2026, release 5be9ec3; report
 * DearPolicy-live-verification-PR49). The live traces were not readable from this session (production read access is
 * not authorised here), so each failure the report traces is reproduced on the synthetic households that mirror the
 * library's structure -- the report household (certificate rows, a Summary of Benefits with a S$5,000 Simple Fracture
 * limit and a "% of S$5,000" column, six uploads with one unreadable) and the binding household (Term Life, PA, Living
 * Care and Living Care Plus rows on one certificate). Scripted model moves through the REAL chat route (PGlite):
 * PLUMBING / CONTROL evidence, not model results. Visible usefulness is asserted, not only safe refusal.
 *   node --import tsx scripts/rag2-live-verify-regressions.ts   (npm run rag2:live-verify-test)
 *   PART=binding node --import tsx scripts/rag2-live-verify-regressions.ts
 */
import assert from "node:assert/strict";
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as RH from "./fixtures/rag2-stress/report-household";
import * as BH from "./fixtures/rag2-binding/household";
import type { ScriptView } from "@/lib/rag2/loop/scripted-model";

const PART = process.env.PART === "binding" || process.argv.includes("--binding") ? "binding" : "report";
const MK = RH.M.marcus.id, D = BH.M.darren.id;
// The report household as the live library holds it: five readable uploads linked to a person, the unreadable upload
// linked to nobody.
const REPORT = { ...RH, DOCS: RH.DOCS.map((d) => (d.key === "SCAN" ? { ...d, members: [] } : d.key.startsWith("PET") ? { ...d, members: [{ id: MK }] } : d)) } as any;
const BINDING = { ...BH, DOCS: BH.DOCS.map((d) => (d.key === "CERT" ? { ...d, hash: "sha256:binding-cert-cells", pages: BH.certLayout("cells") } : d)) } as any;
const HOUSEHOLD = PART === "report" ? REPORT : BINDING;
setEnv(HOUSEHOLD);
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
const results: { name: string; ok: boolean }[] = [];
async function check(name: string, fn: () => Promise<void> | void) { try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); } catch (e) { results.push({ name, ok: false }); console.log("FAIL " + name + "\n     " + (e instanceof Error ? e.message : String(e)).split("\n").slice(0, 14).join("\n     ")); } }

async function main() {
  const h = await startHarness(HOUSEHOLD);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const visible = (a: any) => [a.summary, ...a.details, ...(a.questions ?? []).map((q: any) => "[Q] " + q.text), ...(a.nextSteps ?? []).map((n: string) => "[next] " + n)].join("\n");
  const run = async (turns: { user: string; steps: ((v: ScriptView) => any[])[] }[], env: Record<string, string> = {}) => {
    const old = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    Object.assign(process.env, env);
    installLoopModel(new ScriptedLoopModel(turns as any));
    const out: { v: string; returned: string; answer: any; trace: any }[] = [];
    try {
      let c: { id?: string; rev?: number } = {};
      for (const t of turns) { const a = await h.send(t.user, c); c = { id: a.conversationId, rev: a.conversationRevision }; const s = await h.savedAnswer(c.id!); out.push({ v: visible(s.answer), returned: visible(a), answer: s.answer, trace: s.state.ragLoop.turns.at(-1) }); }
    } finally { installLoopModel(null); for (const [k, v] of Object.entries(old)) { if (v == null) delete process.env[k]; else process.env[k] = v; } }
    return out;
  };

  if (PART === "report") {
    // ------------------------------------------------------------ inventory: the unreadable upload
    const ASK = "List every document in our library, including any that could not be read.";
    const [plain] = await run([{ user: ASK, steps: [() => [call("household_documents", {})], () => [call("final_answer", { sentences: [{ text: "Here are the documents on file for your household." }] })]] }]);
    const evOf = (v: ScriptView) => { const o = [...v.turn].reverse().find((x) => x.name === "household_documents"); const docs = [...((o?.result?.data?.people ?? []) as any[]).flatMap((p) => p.documents), ...((o?.result?.data?.unlinked ?? []) as any[])]; return docs; };
    // the model names every READABLE document itself (cited) and leaves the unreadable one out -- the live case
    const peopleOf = (v: ScriptView) => { const o = [...v.turn].reverse().find((x) => x.name === "household_documents"); return (o?.result?.data?.people ?? []) as any[]; };
    const [named] = await run([{ user: ASK, steps: [() => [call("household_documents", {})], (v: ScriptView) => [call("final_answer", { sentences: peopleOf(v).map((p: any) => ({ text: `${p.short}: ${(p.documents as any[]).filter((d) => d.readable === "ready").map((d) => d.name).join("; ")}.`, evidence_ids: (p.documents as any[]).map((d) => d.evidence?.evidence_id).filter(Boolean) })) })]] }]);
    void evOf;
    await check("INVENTORY a request for every document, including unreadable ones, is answered as the inventory: the unreadable upload is listed with its reason, saved and displayed", () => {
      assert.match(plain.v, /scan-0042\.jpg \(could not be read\)/, plain.v); assert.equal(plain.v, plain.returned);
    });
    await check("INVENTORY a reply that names every readable document but omits the unreadable one keeps its sentences and gains that file's status line from the library record (saved = displayed)", () => {
      assert.match(named.v, /^Marcus: Public Officers Group Scheme - Certificate; /m, named.v);
      assert.match(named.v, /scan-0042\.jpg could not be read \([^)]+\); it is not linked to anyone in the household\./, named.v);
      assert.equal(named.v, named.returned);
    });
    const { INVENTORY_QUESTION } = await import("@/lib/rag2/loop/loop");
    await check("INVENTORY classification: library / every-document requests are inventory questions; benefit and paperwork questions are not", () => {
      for (const q of [ASK, "What policies does my family have?", "Show me what's in my library", "Which documents do we have for Serena?"]) assert.ok(INVENTORY_QUESTION.test(q), q);
      for (const q of ["What does my policy pay for a fracture?", "How much is my personal accident cover?", "What documents do I need to submit for the claim?", "Darren died in a car accident in Japan, what can I do?"]) assert.ok(!INVENTORY_QUESTION.test(q), q);
    });

    // ------------------------------------------------------------ fracture: wrong value type passed as the percentage
    const sel = (key: string, benefit: string, want = "amount") => call("select_table_value", { policy_id: RH.doc(key).id, benefit, subject_id: MK, want });
    const vid = (v: ScriptView, key: string, re: RegExp) => { const o = [...v.turn].reverse().find((x) => x.name === "select_table_value" && x.args.policy_id === RH.doc(key).id && re.test(String(x.args.benefit))); return o?.result?.data?.valueId as string | undefined; };
    const calcOf = (v: ScriptView) => [...v.turn].reverse().find((o) => o.name === "calculate");
    const FRACTURE = "Hypothetically, if I had a simple (closed) fracture of the leg, what would the Simple Fracture benefit be, and how is that different from Other Fracture?";
    const [frac] = await run([{ user: FRACTURE, steps: [
      () => [call("resolve_person", { mention: "I" })],
      () => [sel("SUMMARY", "Simple Fracture Benefit Limit"), sel("CERT", "Group Personal Accident")],
      // the live call: base and "percent" both pointing at printed AMOUNTS
      (v: ScriptView) => [call("calculate", { calculator: "lump_sum", purpose: "what_if", subject_id: MK, policy_id: RH.doc("SUMMARY").id, benefit: "Simple Fracture - Jaw, Pelvis, Leg, Ankle or Knee", condition: "a simple (closed) fracture of the leg", assumption_words: "if I had a simple (closed) fracture of the leg", base_value_id: vid(v, "SUMMARY", /Limit/), percent_value_id: vid(v, "CERT", /Personal Accident/) })],
      (v: ScriptView) => { const c = calcOf(v); return [call("final_answer", { subject_id: MK, sentences: c?.ok && c.result.data.amount != null ? [{ text: `If the Simple Fracture benefit applies to a simple leg fracture, the conditional illustration is S$${Number(c.result.data.amount).toLocaleString("en-SG")} (50% of the S$5,000 Simple Fracture Benefit Limit); it is not an approved payment.`, result_id: c.result.data.calc_id, subject_id: MK }] : [{ text: "I couldn't work out the Simple Fracture amount.", subject_id: MK }] })]; },
    ] }]);
    const calc = (frac.trace.toolCalls as any[]).find((x) => x.name === "calculate");
    await check("FRACTURE a printed amount passed as the percentage is never used as one; the server reads the row's printed 50% (of the S$5,000 limit) instead and the conditional S$2,500 is shown", () => {
      assert.ok(calc?.ok, JSON.stringify(calc)); assert.match(frac.v, /S\$2,500 \(50% of the S\$5,000 Simple Fracture Benefit Limit\)/, frac.v);
      assert.ok(!/S\$300,000|S\$225,000|Living Care/.test(frac.v), frac.v);
    });
    const [refused] = await run([{ user: FRACTURE, steps: [
      () => [sel("CERT", "Group Personal Accident")],
      (v: ScriptView) => [call("calculate", { calculator: "lump_sum", purpose: "what_if", subject_id: MK, policy_id: RH.doc("CERT").id, benefit: "Group Personal Accident", condition: "x", assumption_words: "if I had a fracture", percent_value_id: vid(v, "CERT", /Personal Accident/) })],
      () => [call("final_answer", { subject_id: MK, sentences: [{ text: "I couldn't work out the amount.", subject_id: MK }] })],
    ] }]);
    const rc = (refused.trace.toolCalls as any[]).find((x) => x.name === "calculate");
    await check("FRACTURE with no percentage printed for the row named, the wrong value type is still refused -- and the refusal says what to pass instead", () => {
      assert.equal(rc?.ok, false); assert.match(String(rc?.error), /is a printed money, not a percent\. No percentage has been read for this person on this policy yet\. Pass one of those as percent_value_id, or leave percent_value_id out and name the table row/);
    });
  } else {
    // ------------------------------------------------------------ binding household: limit fallback, aliases, budget
    const DEATH = "Hypothetically, Darren died in a car accident in Japan. What can I do?";
    const BOTH = "The accident happened on 3 October 2026 and he died on 5 October 2026. Explain the benefits and next steps.";
    const pbOf = (v: ScriptView) => { const o = [...v.turn].reverse().find((x) => x.name === "person_benefits"); return ((o?.result?.data?.documents ?? []) as any[]).flatMap((d) => (d.benefits as any[]).map((b) => ({ ...b, product: d.product }))); };
    const vidOf = (v: ScriptView, re: RegExp) => pbOf(v).find((b) => re.test(b.benefit) && b.value_id)?.value_id;
    // a turn that reads the person's rows and then never answers: the turn-call limit stops it
    const stuck = (user: string) => ({ user, steps: [() => [call("person_benefits", { subject_id: D })], () => [call("search_passages", { query: "death claim notification", subject_id: D })], () => [call("search_passages", { query: "accidental death", subject_id: D })], () => [call("search_passages", { query: "more", subject_id: D })]] });
    const [limited] = await run([stuck(DEATH)], { DEARPOLICY_RAG_LOOP_MAX_STEPS: "2" });
    await check("FALLBACK a death question stopped by its model-use limit shows only figures about the question (Term Life, PA) -- never Living Care / Living Care Plus", () => {
      assert.ok(["budget_exhausted", "limit_reached"].includes(limited.trace.outcome), limited.trace.outcome);
      assert.ok(!/Living Care|S\$300,000|S\$350,000/.test(limited.v), limited.v);
      assert.match(limited.v, /S\$1,000,000|S\$600,000/, limited.v);
    });
    const answered = { user: DEATH, steps: [() => [call("person_benefits", { subject_id: D })], (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [
      { text: "Darren’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022.", value_ids: [vidOf(v, /Term Life/)], subject_id: D },
      { text: "The same certificate lists Group Personal Accident of S$600,000 as of 6 October 2022.", value_ids: [vidOf(v, /^Group Personal Accident$/)], subject_id: D },
    ] })]] };
    const [, followLimited] = await run([answered, stuck(BOTH)], { DEARPOLICY_RAG_LOOP_MAX_STEPS: "2" });
    await check("FALLBACK the date follow-up stopped by its limit restates what the conversation established about the death (TL / PA), never an unrelated verified figure", () => {
      assert.ok(!/Living Care|S\$300,000|S\$350,000/.test(followLimited.v), followLimited.v);
      assert.match(followLimited.v, /Group Term Life[^\n]*S\$1,000,000/, followLimited.v); assert.match(followLimited.v, /Group Personal Accident[^\n]*S\$600,000/, followLimited.v);
    });
    // person_benefits: compact and ranked
    let pbData: any = null, pbRepeat: any = null;
    // a large summary (the live library's 36-page booklet): 40 more printed benefit lines on the PA summary
    const gpa = BH.doc("GPA_SUM").id;
    const orig = (await h.db.query("SELECT text FROM policy_pages WHERE policy_id=$1 AND page_number=1", [gpa])).rows[0].text as string;
    await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=1", [gpa, orig + "\n" + Array.from({ length: 40 }, (_, i) => `Optional Benefit ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? "x" : ""}: S$${(i + 1) * 100} per Policy Year.`).join("\n")]);
    await run([{ user: DEATH, steps: [() => [call("person_benefits", { subject_id: D })], (v: ScriptView) => { pbData = [...v.turn].reverse().find((x) => x.name === "person_benefits")?.result; return [call("person_benefits", { subject_id: D })]; }, (v: ScriptView) => { pbRepeat = [...v.turn].filter((x) => x.name === "person_benefits")[1]; return [call("final_answer", { subject_id: D, sentences: [{ text: "Darren’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022.", value_ids: [vidOf(v, /Term Life/)], subject_id: D }] })]; }] }]);
    await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=1", [gpa, orig]);
    await check("BUDGET person_benefits returns the person's own rows and at most 10 shared wording lines, those about the question first (Accidental Death, Death Benefit); an identical repeat in the same turn is not resent", () => {
      const docs = pbData.data.documents as any[];
      const shared = docs.flatMap((d) => d.benefits).filter((b: any) => /every insured person/.test(b.applies));
      assert.ok(shared.length <= 10, String(shared.length)); assert.match(String(pbData.data.omitted), /^\d+ other printed wording line\(s\)/, JSON.stringify(pbData.data.omitted));
      assert.ok(docs.flatMap((d) => d.benefits).some((b: any) => b.benefit === "Group Term Life" && b.value_id));
      assert.ok(shared.slice(0, 3).some((b: any) => /Accidental Death|Death Benefit/.test(b.benefit)), JSON.stringify(shared.map((b: any) => b.benefit)));
      // (an identical repeat is not run again at all -- the loop's own rule; a repeat with another topic is answered
      // by the tool by reference when it is the same call)
      assert.equal(pbRepeat?.ok, false); assert.match(JSON.stringify(pbRepeat?.result ?? pbRepeat?.error ?? ""), /not run again/);
    });
    // insurer alias, source-bound: the scheme summary of the same policy number is stored under a brand name
    await h.db.query("UPDATE policies SET insurer='MeriLife' WHERE id=$1", [BH.doc("GTL_SUM").id]);
    const DATED = "Hypothetically, Darren died in a car accident in Japan on 3 October 2026, the day of the accident. What can I do?";
    const [alias] = await run([{ user: DATED, steps: [() => [call("person_benefits", { subject_id: D })], (v: ScriptView) => [call("final_answer", { subject_id: D, sentences: [{ text: "Darren’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022.", value_ids: [vidOf(v, /Term Life/)], subject_id: D }], next_steps: ["Contact MeriLife and Lumen General to report the death."] })]] }]);
    await h.db.query("UPDATE policies SET insurer='Meridian Life Ltd' WHERE id=$1", [BH.doc("GTL_SUM").id]);
    await check("INSURER a name the same policy's own documents use for the certificate's insurer (MeriLife, same policy number) is that insurer; an unrelated insurer (Lumen General) is still taken out", () => {
      assert.match(alias.v, /\[next\] Contact MeriLife to report the death\./, alias.v); assert.ok(!/Lumen General/.test(alias.v), alias.v);
    });
    // the death question's ONE question, when the wording counts the window "from the date of the Accident"
    const gpaText = (await h.db.query("SELECT text FROM policy_pages WHERE policy_id=$1 AND page_number=1", [gpa])).rows[0].text as string;
    await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=1", [gpa, gpaText.replace("within 365 days of that Accident", "within 365 days from the date of the Accident")]);
    const [asked] = await run([answered]);
    await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=1", [gpa, gpaText]);
    await check("QUESTION a death answer that asks nothing gets the one question its condition needs, also when the wording counts the window from the date of the Accident", () => {
      assert.deepEqual((asked.answer.questions ?? []).map((q: any) => q.text), ["On what date did the accident happen?"], asked.v);
      assert.match(asked.v, /Group Term Life of S\$1,000,000/);
    });
    const { documentCurrency } = await import("@/lib/chat/answer-verification");
    await check("CURRENCY a bare $ amount takes a currency only from its own document's declaration (never another document's S$, never an assumption)", () => {
      assert.equal(documentCurrency("All amounts in this policy are shown in Singapore Dollars.\nRepatriation: $2,000"), "SGD");
      assert.equal(documentCurrency("Currency: SGD"), "SGD");
      assert.equal(documentCurrency("Repatriation: $2,000"), null);
      assert.equal(documentCurrency("All amounts are in Singapore Dollars. Overseas limit US$5,000."), null);
    });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nlive-verify ${PART} ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
