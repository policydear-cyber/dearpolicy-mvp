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
import * as LH from "./fixtures/rag2-livelib/household";
import * as LHM from "./fixtures/rag2-livelib/multiline";
import type { ScriptView } from "@/lib/rag2/loop/scripted-model";

const PART = process.env.PART === "binding" || process.argv.includes("--binding") ? "binding" : process.env.PART === "livelib" || process.argv.includes("--livelib") ? "livelib" : process.env.PART === "multiline" || process.argv.includes("--multiline") ? "multiline" : "report";
const MK = RH.M.marcus.id, D = BH.M.darren.id;
// The report household as the live library holds it: five readable uploads linked to a person, the unreadable upload
// linked to nobody.
const REPORT = { ...RH, DOCS: RH.DOCS.map((d) => (d.key === "SCAN" ? { ...d, members: [] } : d.key.startsWith("PET") ? { ...d, members: [{ id: MK }] } : d)) } as any;
const BINDING = { ...BH, DOCS: BH.DOCS.map((d) => (d.key === "CERT" ? { ...d, hash: "sha256:binding-cert-cells", pages: BH.certLayout("cells") } : d)) } as any;
const HOUSEHOLD = PART === "report" ? REPORT : PART === "livelib" ? (LH as any) : PART === "multiline" ? (LHM as any) : BINDING;
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
  } else if (PART === "binding") {
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
    let mpb: any = null;
    await run([{ user: "What is Michelle's fracture cover?", steps: [() => [call("person_benefits", { subject_id: BH.M.michelle.id, topic: "fracture" })], (v: ScriptView) => { mpb = [...v.turn].reverse().find((x) => x.name === "person_benefits")?.result?.data; return [call("final_answer", { subject_id: BH.M.michelle.id, sentences: [{ text: "I need to check.", subject_id: BH.M.michelle.id }] })]; }] }]);
    await check("BUDGET an amendment for the person is kept whatever the topic (Michelle's endorsement, topic 'fracture')", () => {
      const all = (mpb.documents as any[]).flatMap((d) => d.benefits);
      assert.ok(all.some((b: any) => /amendment naming this person/.test(b.applies) || b.amended), JSON.stringify(all.map((b: any) => [b.benefit, b.applies, b.amended])));
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
  if (PART === "livelib") {
    const A = LH.M.adrian.id, C = LH.M.cheryl.id;
    const DEATH = "Hypothetically, Adrian died in a car accident in Japan. What can I do?";
    const pbOf = (v: ScriptView) => { const o = [...v.turn].reverse().find((x) => x.name === "person_benefits"); return ((o?.result?.data?.documents ?? []) as any[]).flatMap((d) => (d.benefits as any[]).map((b) => ({ ...b, product: d.product, policy_id: d.policy_id }))); };
    const vidOf = (v: ScriptView, re: RegExp) => pbOf(v).find((b) => re.test(b.benefit) && b.value_id)?.value_id;
    const evOf = (v: ScriptView, re: RegExp) => pbOf(v).filter((b) => re.test(b.benefit)).map((b) => b.evidence?.evidence_id).filter(Boolean);
    const amounts = (v: ScriptView) => [
      { text: "Adrian’s certificate lists Group Term Life of S$1,000,000 as of 6 October 2022.", value_ids: [vidOf(v, /Term Life/)], subject_id: A },
      { text: "The same certificate lists Group Personal Accident of S$600,000 as of 6 October 2022.", value_ids: [vidOf(v, /^Group Personal Accident$/)], subject_id: A },
    ];
    // ------------------------------------------------ 1. inventory: the exact request; the status line through the save
    const ASK = "List all our uploaded documents and their roles, including any files that could not be read.";
    const inv = (sentences: (v: ScriptView) => any[]) => ({ user: ASK, steps: [() => [call("household_documents", {})], (v: ScriptView) => [call("final_answer", { sentences: sentences(v) })]] });
    const peopleOf = (v: ScriptView) => (([...v.turn].reverse().find((x) => x.name === "household_documents")?.result?.data?.people ?? []) as any[]);
    const listed = (v: ScriptView) => peopleOf(v).map((p: any) => ({ text: `${p.short}: ${(p.documents as any[]).filter((d) => d.readable === "ready").map((d) => d.name).join("; ")}.`, evidence_ids: (p.documents as any[]).map((d) => d.evidence?.evidence_id).filter(Boolean) }));
    const exact = (x: any, file: string) => {
      const line = (x.trace.composed as string[]).find((c) => c.includes(file));
      assert.ok(line, "the composed answer has the unreadable file: " + JSON.stringify(x.trace.composed));
      assert.ok([x.answer.summary, ...x.answer.details].includes(line), `the saved answer keeps the composed status line verbatim: ${line}\n${x.v}`);
      assert.equal(x.v, x.returned, "saved = returned (what the browser renders)");
      assert.deepEqual(x.trace.gate, [], JSON.stringify(x.trace.gate));
    };
    const [i1] = await run([inv(() => [{ text: "Here are the documents on file for your household." }])]);
    const [i2] = await run([inv(listed)]);
    await h.db.query("UPDATE policies SET original_filename=$2 WHERE id=$1", [LH.doc("SCAN").id, "Claim S$5,000 receipt 05-03-2024.pdf"]);
    const [i3] = await run([inv(listed)]);
    const [i4] = await run([inv((v) => [...listed(v), { text: "Your Group Personal Accident sum insured is S$5,000.", subject_id: A }])]);
    await h.db.query("UPDATE policies SET original_filename=$2 WHERE id=$1", [LH.doc("SCAN").id, "IMG_0042.jpg"]);
    await check("INVENTORY the exact live request: the unreadable upload's status line is composed AND saved verbatim and returned to the browser, also when the reply names every readable document itself", () => { exact(i1, "IMG_0042.jpg"); exact(i2, "IMG_0042.jpg"); });
    await check("INVENTORY a file name that looks like an amount (\"Claim S$5,000 receipt …\") is a name, not a figure: the save-time gate no longer drops the status line -- the composed-then-omitted failure -- and a REAL uncited figure elsewhere is still refused without taking the status line with it", () => {
      exact(i3, "Claim S$5,000 receipt 05-03-2024.pdf");
      assert.ok(i4.v.includes("Claim S$5,000 receipt 05-03-2024.pdf"), i4.v);
      assert.ok(!/sum insured is S\$5,000/.test(i4.v), "the uncited figure is still refused: " + i4.v);
    });
    // ------------------------------------------------ 2. the 365-day condition belongs to Permanent Dismemberment
    // the model cites the summary page's passage as search_passages returns it (both lines in one passage)
    const p9 = (v: ScriptView) => { for (const o of [...v.turn].reverse()) if (o.name === "search_passages" && o.ok) { const hit = ((o.result?.data?.hits ?? []) as any[]).find((x) => /Permanent Dismemberment/.test(JSON.stringify(x)) && /Accidental Death/.test(JSON.stringify(x))); if (hit) return [hit.evidence.evidence_id as string]; } return [] as string[]; };
    const [death] = await run([{ user: DEATH, steps: [() => [call("person_benefits", { subject_id: A, topic: "death after an accident" })], () => [call("search_passages", { query: "Accidental Death Permanent Dismemberment Section A Death and Disablement", subject_id: A })], (v: ScriptView) => [call("final_answer", { subject_id: A, sentences: [
      ...amounts(v),
      { text: "The Personal Accident summary pays Accidental Death at 100% of the Sum Insured if death occurs within 365 days of the Accident.", evidence_ids: p9(v), subject_id: A },
      { text: "Permanent Dismemberment is payable according to the Scale of Compensation if the loss occurs within 365 days of the Accident.", evidence_ids: p9(v), subject_id: A },
    ] })]] }]);
    const { personBenefits } = await import("@/lib/rag2/benefits");
    const view = await personBenefits(LH.ACCOUNT, A);
    await check("CONDITION death and dismemberment are adjacent and only dismemberment prints the 365-day window: the death sentence does not borrow it, the dismemberment sentence keeps it, and no accident-date question is attached to death", () => {
      assert.deepEqual(view.benefits.find((b) => b.benefit.label === "Accidental Death")?.conditions, []);
      assert.match(death.v, /pays Accidental Death at 100% of the Sum Insured\./, death.v);
      assert.ok(!/Accidental Death[^.\n]*365/.test(death.v), death.v);
      assert.match(death.v, /Permanent Dismemberment[^.\n]*within 365 days of the Accident/, death.v);
      assert.ok(!(death.answer.questions ?? []).some((q: any) => /accident/i.test(q.text) && /date/i.test(q.text) && /365/.test(q.why ?? "")), JSON.stringify(death.answer.questions));
      assert.ok((death.trace.dropped ?? []).some((d: any) => /only under Permanent Dismemberment/.test(d.reason)), JSON.stringify(death.trace.dropped));
      void evOf;
    });
    // ------------------------------------------------ 3. insurer aliases need corroboration and a product relationship
    const DATED = "Hypothetically, Adrian died in a car accident in Japan on 3 October 2026, the day of the accident. What can I do?";
    const stepTurn = (steps: string[]) => ({ user: DATED, steps: [() => [call("person_benefits", { subject_id: A })], (v: ScriptView) => [call("final_answer", { subject_id: A, sentences: amounts(v), next_steps: steps })]] });
    const [al1] = await run([stepTurn(["Contact KestrelOne and Falcon General to report the death."])]);
    const sumId = LH.doc("SUMMARY").id;
    const sumP5 = (await h.db.query("SELECT text FROM policy_pages WHERE policy_id=$1 AND page_number=5", [sumId])).rows[0].text as string;
    await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=5", [sumId, sumP5.replace("Underwritten by Kestrel Life Ltd.\n", "")]);
    const [al2] = await run([stepTurn(["Contact KestrelOne to report the death."])]);
    await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=5", [sumId, sumP5]);
    await check("INSURER the scheme summary's brand name is the certificate's insurer only with corroboration (the summary prints the registered name, same policy number, a product the certificate prints); the travel insurer is removed; without the corroborating text the brand name is not accepted", () => {
      assert.match(al1.v, /\[next\] Contact KestrelOne to report the death\./, al1.v); assert.ok(!/Falcon General/.test(al1.v), al1.v);
      assert.ok(!/KestrelOne/.test(al2.v), al2.v);
    });
    // ------------------------------------------------ 4. bounded retrieval and recovery
    let pb: any = null;
    const gpa = LH.doc("SUMMARY").id;
    const p9t = (await h.db.query("SELECT text FROM policy_pages WHERE policy_id=$1 AND page_number=9", [gpa])).rows[0].text as string;
    await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=9", [gpa, p9t + "\n" + Array.from({ length: 40 }, (_, i) => `Optional Benefit ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? "x" : ""}: S$${(i + 1) * 100} per Policy Year.`).join("\n")]);
    let ex: any = null;
    await run([{ user: "Hypothetically, if Adrian had a simple fracture of the leg, what would the Simple Fracture benefit be?", steps: [() => [call("person_benefits", { subject_id: A, topic: "fracture" })], (v: ScriptView) => { pb = [...v.turn].reverse().find((x) => x.name === "person_benefits")?.result?.data; return [call("search_passages", { query: "exclusions war self-injury", subject_id: A })]; }, (v: ScriptView) => { ex = [...v.turn].reverse().find((x) => x.name === "search_passages")?.result?.data; return [call("final_answer", { subject_id: A, sentences: [{ text: "I need to check the fracture table.", subject_id: A }] })]; }] }]);
    await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=9", [gpa, p9t]);
    await check("BUDGET topic ranking discards no exclusion: with 40 more printed lines and the topic 'fracture', person_benefits keeps own rows and caps shared wording, and the exclusions are still found by search_passages (ranking never filters the search)", () => {
      const all = (pb.documents as any[]).flatMap((d) => d.benefits);
      assert.ok(((ex?.hits ?? []) as any[]).some((x) => /deliberate self-injury/.test(JSON.stringify(x))), JSON.stringify(ex).slice(0, 400));
      assert.ok(all.some((b: any) => b.benefit === "Group Term Life" && b.value_id));
      assert.ok(all.filter((b: any) => /every insured person/.test(b.applies) && b.benefit !== "Exclusions").length <= 10);
      assert.match(String(pb.omitted), /other printed wording line/);
    });
    const [invAll] = await run([inv(() => [{ text: "Here are the documents on file for your household." }])]);
    await check("INVENTORY a broad request still enumerates EVERY document (all five readable uploads and the unreadable one), unaffected by the ranked person_benefits", () => {
      for (const d of LH.DOCS.filter((x) => !x.account && x.key !== "SCAN")) assert.ok(invAll.v.includes(d.product), d.product + "\n" + invAll.v);
      assert.ok(invAll.v.includes("IMG_0042.jpg"));
    });
    const sel = (key: string, benefit: string, want = "amount") => call("select_table_value", { policy_id: LH.doc(key).id, benefit, subject_id: A, want });
    const vid = (v: ScriptView, key: string, re: RegExp) => { const o = [...v.turn].reverse().find((x) => x.name === "select_table_value" && x.args.policy_id === LH.doc(key).id && re.test(String(x.args.benefit))); return o?.result?.data?.valueId as string | undefined; };
    const FR = "Hypothetically, if Adrian had a simple (closed) fracture of the leg, what would the Simple Fracture benefit be?";
    const calcTurn = (benefit: string) => ({ user: FR, steps: [
      () => [sel("SUMMARY", "Simple Fracture Benefit Limit"), sel("CERT", "Group Personal Accident")],
      (v: ScriptView) => [call("calculate", { calculator: "lump_sum", purpose: "what_if", subject_id: A, policy_id: LH.doc("SUMMARY").id, benefit, condition: "a simple (closed) fracture of the leg", assumption_words: "if Adrian had a simple (closed) fracture of the leg", base_value_id: vid(v, "SUMMARY", /Limit/), percent_value_id: vid(v, "CERT", /Personal Accident/) })],
      (v: ScriptView) => { const c = [...v.turn].reverse().find((o) => o.name === "calculate"); return [call("final_answer", { subject_id: A, sentences: c?.ok && c.result.data.amount != null ? [{ text: `If the Simple Fracture benefit applies, the conditional illustration is S$${Number(c.result.data.amount).toLocaleString("en-SG")}; it is not an approved payment.`, result_id: c.result.data.calc_id, subject_id: A }] : [{ text: "I couldn't work out the Simple Fracture amount.", subject_id: A }] })]; },
    ] });
    const [okCalc] = await run([calcTurn("Simple Fracture - Jaw, Pelvis, Leg, Ankle or Knee")]);
    const [ambCalc] = await run([calcTurn("Simple Fracture")]);
    const c1 = (okCalc.trace.toolCalls as any[]).find((x) => x.name === "calculate"), c2 = (ambCalc.trace.toolCalls as any[]).find((x) => x.name === "calculate");
    await check("RECOVERY the wrong-type percent is replaced by the SELECTED row's own 50% and its own base (the S$5,000 limit, not the S$600,000 sum insured): conditional S$2,500", () => {
      assert.ok(c1?.ok, JSON.stringify(c1)); assert.match(okCalc.v, /conditional illustration is S\$2,500;/, okCalc.v);
      const rec = (okCalc.answer.calculations ?? [])[0]; assert.ok(rec, "no saved calculation");
      assert.deepEqual(rec.operands.filter((o: any) => o.source === "document").map((o: any) => o.value).sort((a: number, b: number) => a - b), [50, 5000]);
    });
    await check("RECOVERY a benefit that names no single row (\"Simple Fracture\": six rows) is refused, never the first row", () => {
      assert.equal(c2?.ok, false, JSON.stringify(c2)); assert.ok(!/S\$2,500|S\$5,000 \(/.test(ambCalc.v), ambCalc.v);
    });
    // ------------------------------------------------ 5. s52-live-1's exact calculate call on the live layout
    // (the search passage stops at the table's first row; the leg row is the next line of the same page)
    const S52D = "Hypothetically, if Adrian had a simple (closed) fracture of the leg, what would the Simple Fracture benefit be? How is that different from Other Fracture?";
    const cutOff = (v: ScriptView) => { for (const o of [...v.turn].reverse()) if (o.name === "search_passages" && o.ok) { const hit = ((o.result?.data?.hits ?? []) as any[]).find((x) => /Section D - Simple Fracture/.test(JSON.stringify(x)) && /Skull/.test(JSON.stringify(x)) && !/Jaw, Pelvis, Leg/.test(JSON.stringify(x))); if (hit) return hit.evidence.evidence_id as string; } return "none"; };
    let cutId = "none";
    const [live52] = await run([{ user: S52D, steps: [
      () => [call("person_benefits", { subject_id: A, topic: "simple closed fracture of leg; Simple Fracture and Other Fracture benefits" })],
      () => [call("search_passages", { k: 10, query: "Simple Fracture benefit leg simple closed fracture percentage of benefit limit conditions definition Other Fracture", policy_ids: [LH.doc("SUMMARY").id, LH.doc("WORDING").id], subject_id: A })],
      (v: ScriptView) => { cutId = cutOff(v); return [call("calculate", { benefit: "Simple Fracture", purpose: "what_if", condition: "simple (closed) fracture of the leg", policy_id: LH.doc("SUMMARY").id, calculator: "lump_sum", proportion: { evidence_id: cutId, applies_when: "simple (closed) fracture" }, subject_id: A, base_value_id: "v?", assumption_words: "Hypothetically, if Adrian had a simple (closed) fracture of the leg" })]; },
      (v: ScriptView) => { const c = [...v.turn].reverse().find((o) => o.name === "calculate"); return [call("final_answer", { subject_id: A, sentences: c?.ok && c.result.data.amount != null ? [{ text: `If the Simple Fracture benefit applies, the conditional illustration is S$${Number(c.result.data.amount).toLocaleString("en-SG")}; it is not an approved payment.`, result_id: c.result.data.calc_id, subject_id: A }] : [{ text: "I couldn't work out the Simple Fracture amount.", subject_id: A }] })]; },
    ] }]);
    const lc = (live52.trace.toolCalls as any[]).find((x) => x.name === "calculate");
    await check("MULTILINE s52-live-1's exact calculate call (proportion on the search passage that stops above the leg row): the leg row is read from the same page -- 50% x S$5,000 = S$2,500 conditional, saved, and the saved record re-verifies", async () => {
      assert.notEqual(cutId, "none", "the cut-off passage is returned by the live query");
      assert.ok(lc?.ok, JSON.stringify(lc));
      assert.match(live52.v, /conditional illustration is S\$2,500;/, live52.v);
      const rec = (live52.answer.calculations ?? [])[0]; assert.ok(rec, "no saved calculation");
      assert.deepEqual(rec.operands.filter((o: any) => o.source === "document").map((o: any) => o.value).sort((a: number, b: number) => a - b), [50, 5000]);
      const { recomputeCalculation } = await import("@/lib/claims/calc-record");
      const re = recomputeCalculation(rec); assert.ok(re.ok && re.resultMinor === 250000, JSON.stringify(re));
      const { verifyAnswerFigures } = await import("@/lib/chat/answer-verification");
      assert.deepEqual(await verifyAnswerFigures(JSON.parse(JSON.stringify(live52.answer)), { accountId: LH.ACCOUNT, userText: S52D }), []);
      assert.equal(live52.v, live52.returned);
    });
    // ------------------------------------------------ 6. the four s52 defects: controls beside the saved-output replay
    const hitOf = (v: ScriptView, re: RegExp) => { for (const o of [...v.turn].reverse()) if ((o.name === "search_passages" || o.name === "read_page") && o.ok) { const ids = (JSON.stringify(o.result).match(/"evidence_id":"e\d+"/g) ?? []).map((x) => x.slice(15, -1)); const hits = ((o.result?.data?.hits ?? []) as any[]); const hit = hits.find((x) => re.test(JSON.stringify(x))); if (hit) return [hit.evidence.evidence_id as string]; if (o.name === "read_page" && re.test(JSON.stringify(o.result))) return ids.slice(0, 1); } return [] as string[]; };
    const wordId = LH.doc("WORDING").id;
    const wp3 = (await h.db.query("SELECT text FROM policy_pages WHERE policy_id=$1 AND page_number=3", [wordId])).rows[0].text as string;
    const REPAT = "the policy wording says reasonable costs of returning the remains to Singapore are reimbursed up to S$2,000";
    const repatTurn = { user: DEATH, steps: [() => [call("read_page", { policy_id: wordId, page: 3 }), call("read_page", { policy_id: LH.doc("SUMMARY").id, page: 9 })], (v: ScriptView) => [call("final_answer", { subject_id: A, sentences: [{ text: `The summary lists Repatriation of Mortal Remains of S$2,000 if death occurs outside Singapore as a result of an Accident, and ${REPAT}.`, evidence_ids: [...hitOf(v, /up to \$2,000/), ...hitOf(v, /Repatriation of Mortal Remains: S\$2,000/)], subject_id: A }] })]] };
    const [bare1] = await run([repatTurn]);
    await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=3", [wordId, wp3 + "\nSection 9 - Currency\nAll amounts in this Policy are in Singapore Dollars."]);
    const [bare2] = await run([repatTurn]);
    await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=3", [wordId, wp3]);
    await check("CURRENCY a bare $2,000 restated as S$2,000 from the policy wording: without the wording's own currency statement that clause is taken out (the summary's S$2,000 is kept); with the statement on file, the clause is kept and the statement is quoted and cited with the amount", () => {
      assert.ok(!bare1.v.includes("reimbursed up to S$2,000"), bare1.v); assert.match(bare1.v, /lists Repatriation of Mortal Remains of S\$2,000/, bare1.v);
      assert.ok((bare1.trace.dropped ?? []).some((d: any) => /bare \$ and does not state its currency/.test(d.reason)), JSON.stringify(bare1.trace.dropped));
      assert.match(bare2.v, /reimbursed up to S\$2,000 \(Public Officers Group Personal Accident - Policy Wording prints this amount without a currency sign and states: “All amounts in this Policy are in Singapore Dollars”\)\./, bare2.v);
      assert.ok((bare2.answer.citations ?? []).some((c: any) => c.policyId === wordId && /All amounts in this Policy are in Singapore Dollars/.test(c.excerpt ?? "")), JSON.stringify(bare2.answer.citations));
    });
    const gtl = LH.doc("GTL_SUM").id;
    const sixTurn = (text: string) => ({ user: DEATH, steps: [() => [call("person_benefits", { subject_id: A }), call("read_page", { policy_id: gtl, page: 1 }), call("read_page", { policy_id: LH.doc("SUMMARY").id, page: 9 })], (v: ScriptView) => [call("final_answer", { subject_id: A, sentences: [...amounts(v), { text, evidence_ids: [...hitOf(v, /within 6 months/), ...hitOf(v, /Accidental Death: 100%/)], subject_id: A }] })]] });
    const [six1] = await run([sixTurn("The Group Term Life product summary says its Death Benefit is the Sum Assured and says to notify Kestrel Life Ltd of a death within 6 months, with the death certificate.")]);
    const [six2] = await run([sixTurn("The Personal Accident summary pays Accidental Death at 100% of the Sum Insured if the claim is notified within 6 months.")]);
    await check("NOTICE the six-month notification printed under the Group Term Life summary's Claims heading is kept for that policy's Death Benefit, and taken out when attached to the Personal Accident policy's Accidental Death", () => {
      assert.match(six1.v, /notify Kestrel Life Ltd of a death within 6 months/, six1.v + JSON.stringify(six1.trace.dropped) + JSON.stringify(six1.trace.toolCalls.map((x: any) => [x.name, x.ok, x.error])));
      assert.ok(!/within 6 months/.test(six2.v), six2.v);
      assert.ok((six2.trace.dropped ?? []).some((d: any) => /only under Claims of Public Officers Group Term Life/.test(d.reason)), JSON.stringify(six2.trace.dropped));
    });
    const tr = LH.doc("TRAVEL").id;
    const travelTurn = (text: string) => ({ user: DEATH, steps: [() => [call("read_page", { policy_id: tr, page: 1 })], (v: ScriptView) => [call("final_answer", { subject_id: A, sentences: [{ text, evidence_ids: hitOf(v, /Destination: Indonesia/), subject_id: A }] })]] });
    const [tv1] = await run([travelTurn("The travel policy schedule is for a trip to Indonesia, so it does not cover a trip to Japan.")]);
    const [tv2] = await run([travelTurn("The travel policy schedule is for a trip to Indonesia, so it does not show cover for a trip to Japan.")]);
    const tp1 = (await h.db.query("SELECT text FROM policy_pages WHERE policy_id=$1 AND page_number=1", [tr])).rows[0].text as string;
    await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=1", [tr, tp1 + "\nExclusions: travel to Japan is excluded."]);
    const [tv3] = await run([travelTurn("The travel policy schedule excludes travel to Japan, so it does not cover a trip to Japan.")]);
    await h.db.query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1 AND page_number=1", [tr, tp1]);
    await check("TRAVEL \"does not cover this trip\" is an exclusion: on a schedule for another trip it is reworded to \"does not show cover for\" (not proven); \"does not show cover\" is kept; with a printed exclusion naming Japan the exclusion stands", () => {
      assert.match(tv1.v, /does not show cover for a trip to Japan\./, tv1.v); assert.ok(!/does not cover a trip/.test(tv1.v), tv1.v);
      assert.match(tv2.v, /does not show cover for a trip to Japan\./, tv2.v);
      assert.match(tv3.v, /does not cover a trip to Japan\./, tv3.v);
    });
    const stuck = (user: string) => ({ user, steps: [() => [call("person_benefits", { subject_id: A })], () => [call("search_passages", { query: "x", subject_id: A })], () => [call("search_passages", { query: "y", subject_id: A })]] });
    const [l1] = await run([stuck(DEATH)], { DEARPOLICY_RAG_LOOP_MAX_STEPS: "2" });
    const [l2] = await run([stuck(FR)], { DEARPOLICY_RAG_LOOP_MAX_STEPS: "2" });
    await check("FALLBACK limit-stopped death and fracture turns never show Living Care Plus (S$300,000); the death turn shows Term Life / PA, the fracture turn no unrelated figure", () => {
      for (const x of [l1, l2]) assert.ok(!/Living Care|S\$300,000/.test(x.v), x.v);
      assert.match(l1.v, /S\$1,000,000|S\$600,000/, l1.v);
    });
    void C;
  }
  if (PART === "multiline") {
    const A = LHM.M.adrian.id;
    const { percentTables, choosePercentRow } = await import("@/lib/rag2/calc/pct-rows");
    await check("ROWS the page's percentage tables are reconstructed with their own heading, base and continuation lines: the leg row wrapped over two lines and the arm row's percentage on its own line are ONE row each; the Other Fracture table below is a separate table of the Sum Insured", () => {
      const t = percentTables(LHM.SUM_P13_MULTILINE);
      assert.deepEqual(t.map((x) => [x.name, x.base, x.rows.map((r) => [r.label, r.percents, r.lines])]), [
        ["Simple Fracture", "S$5,000", [["Skull", [100], 1], ["Jaw, Pelvis, Leg, Ankle or Knee", [50], 2], ["Arm, Wrist or Elbow", [40], 2], ["Collarbone or Rib", [20], 1]]],
        ["Other Fracture", "Sum Insured", [["Skull (Other Fracture)", [100], 1], ["Jaw, Pelvis, Leg, Ankle or Knee (Other Fracture)", [60], 1], ["Arm, Wrist or Elbow (Other Fracture)", [25], 1]]],
      ]);
      const leg = choosePercentRow(t, "Simple Fracture", "simple (closed) fracture of the leg") as any;
      assert.equal(leg.row.label, "Jaw, Pelvis, Leg, Ankle or Knee"); assert.equal(leg.table.base, "S$5,000");
      assert.ok(LHM.SUM_P13_MULTILINE.slice(leg.row.start, leg.row.end) === leg.row.text && /Jaw, Pelvis, Leg,\nAnkle or Knee\s+50%$/.test(leg.row.text), JSON.stringify(leg.row));
      const other = choosePercentRow(t, "Other Fracture", "compound (open) fracture of the leg") as any;
      assert.equal(other.row.label, "Jaw, Pelvis, Leg, Ankle or Knee (Other Fracture)"); assert.equal(other.table.base, "Sum Insured");
      assert.ok("ambiguous" in (choosePercentRow(t, "Simple Fracture", "a fracture of the leg or the arm") as any));
      assert.ok("none" in (choosePercentRow(t, "Simple Fracture", "a simple fracture") as any));
      const d = percentTables(LHM.SUM_P14_DISLOCATION);
      assert.match((choosePercentRow(d, "Dislocation", "dislocated shoulder") as any).unresolved, /printed more than once with different percentages \(20%, 30%\)/);
      assert.match((choosePercentRow(d, "Dislocation", "dislocated hip") as any).unresolved, /prints no percentage/);
    });
    const FRM = "Hypothetically, if Adrian had a simple (closed) fracture of the leg, what would the Simple Fracture benefit be? How is that different from Other Fracture?";
    const SUM = LHM.doc("SUMMARY").id;
    const pageEv = (v: ScriptView, page: number) => { const o = [...v.turn].reverse().find((x) => x.name === "read_page" && x.args.page === page && x.ok); return (JSON.stringify(o?.result ?? {}).match(/"evidence_id":"(e\d+)"/) ?? [])[1] ?? "none"; };
    const calcArgs = (v: ScriptView, page: number, benefit: string, condition: string, extra: Record<string, unknown> = {}) => ({ benefit, purpose: "what_if", condition, policy_id: SUM, calculator: "lump_sum", proportion: { evidence_id: pageEv(v, page), applies_when: condition }, subject_id: A, base_value_id: "v?", assumption_words: "Hypothetically, if Adrian had a simple (closed) fracture of the leg", ...extra });
    const answerWith = (v: ScriptView) => { const c = [...v.turn].reverse().find((o) => o.name === "calculate"); return [call("final_answer", { subject_id: A, sentences: c?.ok && c.result.data.amount != null ? [{ text: `If the ${String(c.args.benefit)} benefit applies, the conditional illustration is S$${Number(c.result.data.amount).toLocaleString("en-SG")}; it is not an approved payment.`, result_id: c.result.data.calc_id, subject_id: A }] : [{ text: "I couldn't work out that amount from the table.", subject_id: A }] })]; };
    const calcs = (x: any) => (x.trace.toolCalls as any[]).filter((c) => c.name === "calculate");
    const docOps = (x: any) => ((x.answer.calculations ?? [])[0]?.operands ?? []).filter((o: any) => o.source === "document").map((o: any) => o.value).sort((a: number, b: number) => a - b);
    const [m1] = await run([{ user: FRM, steps: [() => [call("read_page", { policy_id: SUM, page: 13 })], (v: ScriptView) => [call("calculate", calcArgs(v, 13, "Simple Fracture", "simple (closed) fracture of the leg"))], answerWith] }]);
    await check("MULTILINE the wrapped leg row, cited as the whole page (both tables on it): 50% x S$5,000 = S$2,500, saved with its own row and base, and the saved record re-verifies -- the adjacent Other Fracture row (60%) and the Sum Insured are not used", async () => {
      assert.ok(calcs(m1)[0]?.ok, JSON.stringify(calcs(m1)));
      assert.match(m1.v, /conditional illustration is S\$2,500;/, m1.v + "\n" + JSON.stringify({ composed: m1.trace.composed, gate: m1.trace.gate }));
      assert.deepEqual(docOps(m1), [50, 5000]);
      const rec = m1.answer.calculations[0];
      assert.ok(rec.operands.some((o: any) => o.source === "document" && o.value === 50 && /^Jaw, Pelvis, Leg,\nAnkle or Knee\s+50%$/.test(o.row) && o.binding.pageStart === 13 && o.binding.documentHash === "sha256:livelib-summary-multiline"), JSON.stringify(rec.operands));
      assert.ok(rec.operands.some((o: any) => o.source === "document" && o.value === 5000 && o.role === "limit" && /Simple Fracture Benefit Limit: S\$5,000/.test(o.row)), "the base is the table's own heading limit");
      const { verifyAnswerFigures } = await import("@/lib/chat/answer-verification");
      const { recomputeCalculation } = await import("@/lib/claims/calc-record");
      const re = recomputeCalculation(rec); assert.ok(re.ok && re.resultMinor === 250000, JSON.stringify(re));
      assert.deepEqual(await verifyAnswerFigures(JSON.parse(JSON.stringify(m1.answer)), { accountId: LHM.ACCOUNT, userText: FRM }), []);
      assert.equal(m1.v, m1.returned);
    });
    const CERTV = (v: ScriptView) => { const o = [...v.turn].reverse().find((x) => x.name === "select_table_value"); return o?.result?.data?.valueId as string | undefined; };
    const [m2] = await run([{ user: "Hypothetically, if Adrian had a compound (open) fracture of the leg, what would the Other Fracture benefit be?", steps: [() => [call("read_page", { policy_id: SUM, page: 13 }), call("select_table_value", { policy_id: LHM.doc("CERT").id, benefit: "Group Personal Accident", subject_id: A, want: "amount" })], (v: ScriptView) => [call("calculate", calcArgs(v, 13, "Other Fracture", "compound (open) fracture of the leg", { base_value_id: undefined, sum_insured_value_id: CERTV(v) }))], answerWith] }]);
    await check("ADJACENT the Other Fracture table on the same page supplies only its OWN row and base: its leg row (60%) of the Sum Insured (S$600,000) = S$360,000 -- the Simple Fracture row and its S$5,000 limit are not used for it, and vice versa", () => {
      assert.ok(calcs(m2)[0]?.ok, JSON.stringify(calcs(m2)));
      assert.deepEqual(docOps(m2), [60, 600000]);
      assert.match(m2.v, /S\$360,000/, m2.v);
    });
    let ambErr = "";
    const [m3] = await run([{ user: FRM, steps: [() => [call("read_page", { policy_id: SUM, page: 13 })], (v: ScriptView) => [call("calculate", calcArgs(v, 13, "Simple Fracture", "a fracture of the leg or the arm"))],
      (v: ScriptView) => { const c = [...v.turn].reverse().find((o) => o.name === "calculate"); ambErr = String(c?.result?.error ?? ""); const id = (/(v\d+) = “Jaw, Pelvis, Leg, Ankle or Knee” 50%/.exec(ambErr) ?? [])[1]; return [call("calculate", { benefit: "Simple Fracture", purpose: "what_if", condition: "simple (closed) fracture of the leg", policy_id: SUM, calculator: "lump_sum", subject_id: A, percent_value_id: id ?? "none", assumption_words: "Hypothetically, if Adrian had a simple (closed) fracture of the leg" })]; }, answerWith] }]);
    await check("AMBIGUOUS a condition naming two rows (leg or arm) is refused -- never the first or the larger -- with an actionable error listing each row of the selected table with a valid value id; the next call naming the leg row's id gives S$2,500 on the same base", () => {
      const [first, second] = calcs(m3);
      assert.equal(first.ok, false); assert.match(ambErr, /names more than one row/); assert.match(ambErr, /v\d+ = “Arm, Wrist or Elbow” 40%/); assert.match(ambErr, /percent_value_id and without proportion/);
      assert.ok(!/Other Fracture/.test(ambErr), "the other table's rows are not offered: " + ambErr);
      assert.ok(second?.ok, JSON.stringify(second)); assert.deepEqual(docOps(m3), [50, 5000]); assert.match(m3.v, /S\$2,500/);
    });
    const dis = async (cond: string) => (await run([{ user: `Hypothetically, if Adrian had a ${cond}, what would the Dislocation benefit be?`, steps: [() => [call("read_page", { policy_id: SUM, page: 14 })], (v: ScriptView) => [call("calculate", calcArgs(v, 14, "Dislocation", cond))], answerWith] }]))[0];
    const [m4, m5] = [await dis("dislocated shoulder"), await dis("dislocated hip")];
    await check("CONFLICT / INCOMPLETE a row printed twice with different percentages (Shoulder 20% and 30%) and a row printing no percentage (Hip: see Note 2) stay unresolved: refused, no value id offered for them, no figure and no saved calculation", () => {
      const e4 = String(calcs(m4)[0]?.result?.error ?? calcs(m4)[0]?.error ?? ""), e5 = String(calcs(m5)[0]?.result?.error ?? calcs(m5)[0]?.error ?? "");
      assert.equal(calcs(m4)[0].ok, false); assert.match(e4, /printed more than once with different percentages \(20%, 30%\)/); assert.ok(!/v\d+ =/.test(e4), e4);
      assert.equal(calcs(m5)[0].ok, false); assert.match(e5, /prints no percentage/); assert.ok(!/v\d+ =/.test(e5), e5);
      for (const x of [m4, m5]) { assert.ok(!/S\$\d/.test(x.v), x.v); assert.deepEqual(x.answer.calculations ?? [], []); }
    });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nlive-verify ${PART} ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
