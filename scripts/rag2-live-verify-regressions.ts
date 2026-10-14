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
import type { ScriptView } from "@/lib/rag2/loop/scripted-model";

const PART = process.env.PART === "binding" || process.argv.includes("--binding") ? "binding" : process.env.PART === "livelib" || process.argv.includes("--livelib") ? "livelib" : "report";
const MK = RH.M.marcus.id, D = BH.M.darren.id;
// The report household as the live library holds it: five readable uploads linked to a person, the unreadable upload
// linked to nobody.
const REPORT = { ...RH, DOCS: RH.DOCS.map((d) => (d.key === "SCAN" ? { ...d, members: [] } : d.key.startsWith("PET") ? { ...d, members: [{ id: MK }] } : d)) } as any;
const BINDING = { ...BH, DOCS: BH.DOCS.map((d) => (d.key === "CERT" ? { ...d, hash: "sha256:binding-cert-cells", pages: BH.certLayout("cells") } : d)) } as any;
const HOUSEHOLD = PART === "report" ? REPORT : PART === "livelib" ? (LH as any) : BINDING;
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
    const stuck = (user: string) => ({ user, steps: [() => [call("person_benefits", { subject_id: A })], () => [call("search_passages", { query: "x", subject_id: A })], () => [call("search_passages", { query: "y", subject_id: A })]] });
    const [l1] = await run([stuck(DEATH)], { DEARPOLICY_RAG_LOOP_MAX_STEPS: "2" });
    const [l2] = await run([stuck(FR)], { DEARPOLICY_RAG_LOOP_MAX_STEPS: "2" });
    await check("FALLBACK limit-stopped death and fracture turns never show Living Care Plus (S$300,000); the death turn shows Term Life / PA, the fracture turn no unrelated figure", () => {
      for (const x of [l1, l2]) assert.ok(!/Living Care|S\$300,000/.test(x.v), x.v);
      assert.match(l1.v, /S\$1,000,000|S\$600,000/, l1.v);
    });
    void C;
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nlive-verify ${PART} ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
