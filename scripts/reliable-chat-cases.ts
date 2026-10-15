/**
 * Reliable chat, active route (evaluate_benefit + server-written statements): case selection and contact eligibility,
 * enforced by the SERVER, through the real chat route with scripted model moves. Graded on the complete visible answer.
 *   - a specific part no listed case covers -> unlisted_case (said, never a question offering unrelated cases);
 *   - a valid option_id never overrides what the household reported (wrist + Leg option -> no leg illustration);
 *   - missing information, an ambiguous part and an unlisted part are three different results;
 *   - ordinary names of parts (shin, thigh bone, collarbone) without any diagnosis;
 *   - contact steps only for the person's personal policy, or wording that belongs to it.
 *   HH=tan (default) | wong       node --import tsx scripts/reliable-chat-cases.ts
 */
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as T from "./fixtures/reliable-chat/tan";
import * as W from "./fixtures/rag2-pr50/household";
import type { ScriptView } from "@/lib/rag2/loop/scripted-model";
import { uniqueSteps } from "@/components/next-steps";
import { caseFor } from "@/lib/rag2/calc/case-terms";
import { contactTarget } from "@/lib/rag2/loop/statement-render";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
const HH = process.env.HH === "wong" ? W : T;
setEnv(HH as any);
const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });
const visibleOf = (a: any) => [a.summary, ...(a.details ?? []), ...(a.questions ?? []).map((q: any) => q.text), ...uniqueSteps(a.nextSteps)].filter(Boolean).join("\n");
const evalOf = (v: ScriptView) => [...v.turn].reverse().find((o) => o.name === "evaluate_benefit")?.result?.data ?? {};
const pbOf = (v: ScriptView) => v.find("person_benefits")?.result?.data ?? {};
const schedOf = (v: ScriptView, re: RegExp) => ((pbOf(v).schedules ?? []) as any[]).find((s) => re.test(s.benefit));
let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "\n     " + detail.split("\n").slice(0, 24).join("\n     ")}`); };

async function main() {
  // ---- pure: the three case outcomes and ordinary names (no diagnosis inferred)
  const tanRows = [{ id: "r1", label: "Leg - thigh bone (femur)" }, { id: "r2", label: "Leg - below the knee (tibia or fibula)" }, { id: "r3", label: "Wrist" }, { id: "r4", label: "Finger or toe" }];
  const k = (w: string) => { const c: any = caseFor(tanRows, w); return c.kind + (c.row ? ":" + c.row.id : c.rows ? ":" + c.rows.map((r: any) => r.id).join("+") : ""); };
  check("CASE terms: missing (no part named) / ambiguous (a region two rows split) / unlisted (a part no row lists) / ordinary names", k("an injury at football") === "missing" && k("he broke his leg") === "ambiguous:r1+r2" && k("collarbone") === "unlisted" && k("kneecap") === "unlisted" && k("the shin bone") === "row:r2" && k("thigh bone") === "row:r1" && k("the femur") === "row:r1" && k("big toe") === "row:r4" && k("a fall") === "missing",
    ["an injury at football", "he broke his leg", "collarbone", "kneecap", "the shin bone", "thigh bone", "the femur", "big toe", "a fall"].map((w) => `${w} -> ${k(w)}`).join("\n"));

  const h = await startHarness(HH as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const { loadDocs, loadLinks } = await import("@/lib/rag2/store");
  const run = async (turns: any[]) => {
    installLoopModel(new ScriptedLoopModel(turns));
    const out: any[] = []; let c: { id?: string; rev?: number } = {};
    try { for (const t of turns) { const a = await h.send(t.user, c); c = { id: a.conversationId, rev: a.conversationRevision }; const s = await h.savedAnswer(c.id!); out.push({ v: visibleOf(s.answer), returned: visibleOf(a), answer: s.answer, state: s.state, trace: s.state.ragLoop.turns.at(-1) }); } } finally { installLoopModel(null); }
    return out;
  };
  const calls = (x: any, name: string) => (x.trace.toolCalls ?? []).filter((c: any) => c.name === name);

  if (HH === T) {
    const J = T.M.jun.id;
    // ---- unlisted: a collarbone is not one of the Fracture Benefit's cases -> said, with the listed cases; the scripted
    //      model's question offering the leg rows (the live RCW3 pattern) is refused; no question reaches the household
    let st: any = {};
    const [u] = await run([{ user: "Jun broke his collarbone falling off his bike. What does his accident policy pay?", steps: [
      () => [call("note_facts", { subject_id: J, facts: [{ key: "injury", value: "broke his collarbone", words: "Jun broke his collarbone" }, { key: "how_it_happened", value: "falling off his bike", words: "falling off his bike" }] }), call("person_benefits", { subject_id: J, topic: "fracture collarbone" })],
      (v: ScriptView) => [call("evaluate_benefit", { benefit_id: schedOf(v, /Fracture/)?.benefit_id, subject_id: J, purpose: "claim", case: "collarbone", fact_keys: ["injury"] })],
      (v: ScriptView) => { st = evalOf(v); return [call("ask_user", { kind: "fact", subject_id: J, fact_key: "fracture_case", question: "Which listed fracture case applies to Jun: the thigh bone (femur), below the knee (tibia or fibula), wrist, or finger or toe?", statements: [{ kind: "benefit_terms", benefit_id: st.benefit_id }], because_evidence_ids: [] })]; },
      () => [call("final_answer", { subject_id: J, sentences: [{ kind: "benefit_terms", benefit_id: st.benefit_id, text: "-" }, { kind: "uncertainty", text: "The FamilyGuard wording does not list a collarbone among the Fracture Benefit's cases.", evidence_ids: [] }], next_steps: [`contact:${T.doc("SCHEDULE").id}`] })],
    ] }]);
    const ask = calls(u, "ask_user")[0];
    check("UNLISTED: collarbone -> unlisted_case (not needs_facts with unrelated options); the question offering the leg / wrist rows is refused; no question shown; the listed cases and the contact step are",
      st.status === "unlisted_case" && !st.options && ask?.ok === false && /does not list/.test(ask?.error ?? "") && !(u.answer.questions ?? []).length && /thigh bone \(femur\) 20%/.test(u.v) && /Contact Aurora Assurance/.test(u.v) && !(u.v.match(/S\$[\d,]+/g) ?? []).some((x: string) => x !== "S$100,000"),
      u.v + "\n" + JSON.stringify(st).slice(0, 500) + "\n" + JSON.stringify(ask));
    check("UNLISTED: saved answer = returned answer", u.v === u.returned, u.v + "\n---\n" + u.returned); if (process.env.SHOW) console.log("=== COLLARBONE\n" + u.v);

    // ---- an option id never overrides the reported case: the household said thigh bone; the model passes the below-the-knee option
    let r2: any = {};
    const [o] = await run([{ user: "Jun broke his thigh bone at football. What could his policy pay?", steps: [
      () => [call("note_facts", { subject_id: J, facts: [{ key: "injury", value: "broke his thigh bone", words: "Jun broke his thigh bone" }] }), call("person_benefits", { subject_id: J, topic: "fracture" })],
      (v: ScriptView) => { const s = schedOf(v, /Fracture/); return [call("evaluate_benefit", { benefit_id: s?.benefit_id, subject_id: J, purpose: "claim", option_id: (s?.schedule?.cases ?? []).find((c: any) => /below the knee/.test(c.case))?.option_id, fact_keys: ["injury"] })]; },
      (v: ScriptView) => { r2 = evalOf(v); const s = schedOf(v, /Fracture/); return [call("evaluate_benefit", { benefit_id: s?.benefit_id, subject_id: J, purpose: "claim", option_id: (s?.schedule?.cases ?? []).find((c: any) => /thigh/.test(c.case))?.option_id, fact_keys: ["injury"] })]; },
      (v: ScriptView) => [call("final_answer", { subject_id: J, sentences: [{ kind: "calculation", result_id: evalOf(v).result_id, text: "-" }] })],
    ] }]);
    check("OPTION vs REPORTED: a valid below-the-knee option for a reported thigh bone -> case_conflict naming the thigh case, no S$10,000; the thigh option -> S$20,000",
      r2.status === "case_conflict" && /thigh/.test(JSON.stringify(r2.matching_cases)) && /S\$20,000/.test(o.v) && !/S\$10,000/.test(o.v), o.v + "\n" + JSON.stringify(r2).slice(0, 500));

    // ---- missing vs ambiguous: "hurt at football" names no part -> missing; "his leg" -> the two leg rows only
    let m: any = {}, amb: any = {};
    await run([{ user: "Jun got hurt at football. What could he claim?", steps: [
      () => [call("person_benefits", { subject_id: J, topic: "fracture" })],
      (v: ScriptView) => [call("evaluate_benefit", { benefit_id: schedOf(v, /Fracture/)?.benefit_id, subject_id: J, purpose: "claim", case: "got hurt at football" })],
      (v: ScriptView) => { m = evalOf(v); return [call("evaluate_benefit", { benefit_id: schedOf(v, /Fracture/)?.benefit_id, subject_id: J, purpose: "claim", case: "his leg" })]; },
      (v: ScriptView) => { amb = evalOf(v); return [call("final_answer", { subject_id: J, sentences: [{ kind: "benefit_terms", benefit_id: schedOf(v, /Fracture/)?.benefit_id, text: "-" }] })]; },
    ] }]);
    check("MISSING vs AMBIGUOUS: no part named -> needs_facts (missing, all cases); \"his leg\" -> needs_facts (ambiguous) offering only the two leg cases",
      m.status === "needs_facts" && m.reason === "missing" && amb.status === "needs_facts" && amb.reason === "ambiguous" && amb.options?.length === 2 && amb.options.every((x: any) => /^Leg/.test(x.case)), JSON.stringify({ m, amb }).slice(0, 800));

    // ---- contact eligibility
    const docs = await loadDocs(T.ACCOUNT); const links = await loadLinks(T.ACCOUNT, docs.map((d) => d.id));
    const ct = (who: string, key: string) => contactTarget(docs, links, who, T.doc(key).id) as any;
    check("CONTACT: Jun's personal schedule -> its insurer; the wording that belongs to it (same policy number) -> the schedule's insurer; Wei (not covered) -> refused; another household's schedule -> refused",
      ct(J, "SCHEDULE").via === "personal" && ct(J, "WORDING").via === "reference" && ct(J, "WORDING").doc.id === T.doc("SCHEDULE").id && "refused" in ct(T.M.wei.id, "SCHEDULE") && "refused" in contactTarget(docs, links, J, T.doc("OTHER").id),
      JSON.stringify({ s: ct(J, "SCHEDULE"), w: ct(J, "WORDING"), wei: ct(T.M.wei.id, "SCHEDULE") }).slice(0, 600));
  } else {
    const A = W.M.adrian.id, C = W.M.cheryl.id;
    // ---- the live RCW3 shape with a valid Leg option: wrist reported -> unlisted, never the S$2,500 leg illustration
    let e1: any = {}, e2: any = {};
    const [w] = await run([{ user: "Which of my uploaded policies should I claim under for Adrian's broken wrist from a cycling accident?", steps: [
      () => [call("resolve_person", { mention: "Adrian" })],
      () => [call("note_facts", { facts: [{ key: "injury", value: "broken wrist", words: "broken wrist" }, { key: "how_it_happened", value: "cycling accident", words: "cycling accident" }], subject_id: A })],
      () => [call("person_benefits", { topic: "broken wrist from cycling accident", subject_id: A })],
      (v: ScriptView) => { const s = schedOf(v, /Simple Fracture/); return [call("evaluate_benefit", { benefit_id: s?.benefit_id, subject_id: A, purpose: "claim", option_id: (s?.schedule?.cases ?? []).find((c: any) => /Leg/.test(c.case))?.option_id, fact_keys: ["injury"] })]; },
      (v: ScriptView) => { e1 = evalOf(v); return [call("evaluate_benefit", { benefit_id: schedOf(v, /Simple Fracture/)?.benefit_id, subject_id: A, purpose: "claim", case: "broken wrist", fact_keys: ["injury"] })]; },
      (v: ScriptView) => { e2 = evalOf(v); return [call("final_answer", { subject_id: A, sentences: [{ kind: "benefit_terms", benefit_id: schedOf(v, /Simple Fracture/)?.benefit_id, text: "-" }, { kind: "benefit_terms", benefit_id: schedOf(v, /Other Fracture/)?.benefit_id, text: "-" }], next_steps: [`contact:${W.DOCS.find((d) => d.key === "CERT")!.id}`] })]; },
    ] }]);
    check("OPTION vs REPORTED (wrist + a valid Leg option): unlisted_case, no leg illustration; case words \"broken wrist\" -> unlisted_case; the answer states both tables' cases and the Kestrel contact step, with no question",
      e1.status === "unlisted_case" && e2.status === "unlisted_case" && !e1.result_id && !/S\$2,500/.test(w.v) && /Simple Fracture/.test(w.v) && /Other Fracture/.test(w.v) && /lists no case for a wrist/.test(w.v) && /Contact Kestrel Life Ltd/.test(w.v) && !(w.answer.questions ?? []).length && !/inventory|Ethan|could not be read/i.test(w.v),
      w.v + "\n" + JSON.stringify({ e1, e2 }).slice(0, 600));
    check("WRIST: saved answer = returned answer", w.v === w.returned);
    const { gradeRCX } = await import("./rag2-live/reliable-chat-check");
    const gx = gradeRCX("RCX", { turns: [{}], loaded: { turns: [{ answer: w.answer }], state: w.state }, saved: { traces: [w.trace] } });
    check("GRADER v2 calibration: the pre-registered wrist control (RCX) passes this correct, useful answer", gx.verdict === "PASS", JSON.stringify(gx.checks.filter((c) => !c.ok))); if (process.env.SHOW) console.log("=== WRIST\n" + w.v);

    // ---- contact eligibility on the PR #50 household
    const docs = await loadDocs(W.ACCOUNT); let links = await loadLinks(W.ACCOUNT, docs.map((d) => d.id));
    const id = (key: string) => W.DOCS.find((d) => d.key === key)!.id;
    const sum = contactTarget(docs, links, A, id("SUMMARY")) as any, cert = contactTarget(docs, links, A, id("CERT")) as any, travel = contactTarget(docs, links, A, id("TRAVEL_WORDING")) as any;
    check("CONTACT: the certificate -> Kestrel Life Ltd; the scheme summary (KestrelOne brand, same policy) -> the certificate's insurer, never the brand alone; the travel wording linked to nobody -> refused",
      cert.via === "personal" && sum.via === "reference" && sum.doc.insurer === "Kestrel Life Ltd" && "refused" in travel, JSON.stringify({ cert: cert.doc?.insurer, sum, travel }).slice(0, 600));
    // linked but unconfirmed reference wording of an unrelated product: link the travel wording to Adrian
    await h.db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$3,'test',1)", [id("TRAVEL_WORDING"), A, W.ACCOUNT]);
    links = await loadLinks(W.ACCOUNT, docs.map((d) => d.id));
    const linkedTravel = contactTarget(docs, links, A, id("TRAVEL_WORDING")) as any;
    check("CONTACT: travel wording LINKED to Adrian but with no personal policy of his behind it (an unrelated product) -> refused", "refused" in linkedTravel && /no personal policy/.test(linkedTravel.refused), JSON.stringify(linkedTravel));
    // through the route: the model's steps for the certificate, the summary and the linked travel wording
    const [d] = await run([{ user: "Hypothetically, Adrian died in a road accident. Who should I contact?", steps: [
      () => [call("resolve_person", { mention: "Adrian" })],
      () => [call("person_benefits", { topic: "death", subject_id: A })],
      () => [call("final_answer", { subject_id: A, sentences: [{ kind: "uncertainty", text: "The uploaded documents do not establish whether Adrian's cover was in force on the date of the accident." }], next_steps: [`contact:${id("CERT")}`, `contact:${id("SUMMARY")}`, `contact:${id("TRAVEL_WORDING")}`] })],
      () => [call("final_answer", { subject_id: A, sentences: [{ kind: "uncertainty", text: "The uploaded documents do not establish whether Adrian's cover was in force on the date of the accident." }], next_steps: [`contact:${id("CERT")}`, `contact:${id("SUMMARY")}`] })],
    ] }]);
    const fa = calls(d, "final_answer");
    check("CONTACT through the route: the linked travel wording is refused; one Kestrel Life Ltd step; never KestrelOne or Harbourline",
      fa[0]?.ok === false && (d.v.match(/Contact Kestrel Life Ltd/g) ?? []).length === 1 && !/Harbourline|Contact KestrelOne/.test(d.v), d.v + "\n" + JSON.stringify(fa.map((c: any) => [c.ok, (c.error ?? "").slice(0, 200)])));
    await h.db.query("DELETE FROM policy_members WHERE policy_id=$1 AND family_member_id=$2", [id("TRAVEL_WORDING"), A]);
    // another person's policy: Ethan has no documents
    const eth = contactTarget(docs, links, W.M.ethan.id, id("CERT")) as any;
    check("CONTACT: Ethan (no policy of his own) -> refused for the parents' certificate", "refused" in eth, JSON.stringify(eth));
    void C;
  }
  console.log(`\nreliable-chat cases [${HH === T ? "tan" : "wong"}] ${passed}/${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
