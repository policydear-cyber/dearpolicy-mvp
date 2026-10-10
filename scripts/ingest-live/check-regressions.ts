/**
 * The live ingestion grader on a synthetic run folder (no app, no database, no model):
 * a correct run passes; each defect class fails on its own check.
 *   node --import tsx scripts/ingest-live/check-regressions.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { grade, norm, pairTurns, sameQuestion, usefulReply } from "./check";
import { factsFrom, sentenceChecks, datesIn, moneyValues } from "../rag2-live/check-sentences";
import { appRelationship, readQuestions } from "./fixture";

const P = { text: "11111111-1111-4111-8111-111111111111", end: "22222222-2222-4222-8222-222222222222" };
const ISLA = "33333333-3333-4333-8333-333333333333";
const expected = {
  documents: [{ file: "a.pdf", linked_people: ["Isla Maren Hartwell"], pages: [{ page: 1, must_contain: ["MHA-1"] }] }, { file: "b.pdf", pages: [{ page: 1, must_contain: ["S$110"] }] }],
  turns: {
    Q1: { person: "Isla Maren Hartwell", must_include: ["S$110"], must_not_include: ["S$80 per day"], citations: [{ file: "b.pdf", page: 1 }], version: "b.pdf", ask_follow_up: true },
    D1: { must_not_cite: ["b.pdf"] },
  },
};
function folder(mut: (f: Record<string, any>) => void = () => undefined) {
  const f: Record<string, any> = {
    "EXPECTED.json": expected,
    "EXPECTED.source.json": { facts: [{ id: "F1", verbatim: ["S$80 per day", "S$110 per day", "01 July 2026"] }], answers: [] },
    "members.json": { "Isla Maren Hartwell": ISLA },
    "uploads.json": [{ file: "a.pdf", policyId: P.text, ready: true, finalStatus: "clean/ready" }, { file: "b.pdf", policyId: P.end, ready: true, finalStatus: "clean/ready" }],
    "linking.json": [{ file: "a.pdf", policyId: P.text, linked: ["Isla Maren Hartwell"], detected: [] }, { file: "b.pdf", policyId: P.end, linked: [], detected: [] }],
    "deleted.json": { file: "b.pdf", policyId: P.end, at: "2026-10-09T10:00:00.000Z", confirmed: true, notice: "Deleted b. It is no longer used in answers, and your portfolio has been updated.", listedAfter: false, otherDocumentsLost: [] },
    "transcript.json": [
      { id: "Q1", phase: "conversation", user: "How much for Isla?", answer: "Which accident? Please tell me when it happened so I can check the right version.", pendingQuestion: "When did it happen?", error: null, stuck: false },
      { id: "Q1", phase: "conversation", user: "Last week", answer: "Isla's hospital daily allowance is S$ 110 per day from 1 July 2026 (endorsement), accident only.", pendingQuestion: null, error: null, stuck: false },
      { id: "D1", phase: "after_delete", user: "And now?", answer: "Without the endorsement on file the schedule shows S$80 per day for a child.", pendingQuestion: null, error: null, stuck: false, at: "2026-10-09T10:01:00.000Z" },
    ],
    "dump-processing/dump.json": { tables: { policy_pages: [{ policy_id: P.text, page_number: 1, text: "Policy MHA-1", extraction_method: "native" }, { policy_id: P.end, page_number: 1, text: "Revised S$110 per day", extraction_method: "ocr" }] } },
    "dump-final/dump.json": { tables: { policies: [{ id: P.text, original_filename: "a.pdf", lifecycle_state: "active" }, { id: P.end, original_filename: "b.pdf", lifecycle_state: "pending_deletion" }], chat_messages: [
      { role: "user", content: "How much for Isla?" }, { role: "assistant", content: "Which accident?", answer_json: { citations: [], questions: [{ text: "When did it happen?" }] } },
      { role: "user", content: "Last week" }, { role: "assistant", content: "Isla's hospital daily allowance is S$110 per day from 1 July 2026.", answer_json: { resolvedFamilyMemberId: ISLA, citations: [{ policyId: P.end, pageStart: 1, pageEnd: 1 }] } },
      { role: "user", content: "And now?" }, { role: "assistant", content: "The schedule shows S$80 per day for a child.", answer_json: { citations: [{ policyId: P.text, pageStart: 1 }] } },
    ] } },
  };
  mut(f);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-check-"));
  for (const [k, v] of Object.entries(f)) { fs.mkdirSync(path.dirname(path.join(dir, k)), { recursive: true }); fs.writeFileSync(path.join(dir, k), JSON.stringify(v)); }
  return dir;
}
const failedChecks = (dir: string) => grade(dir).checks.filter((c) => !c.ok).map((c) => `${c.scope}: ${c.check}`);

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log("PASS " + name); };
t("a correct run passes", () => { const v = grade(folder()); assert.equal(v.verdict, "PASS", JSON.stringify(v.checks.filter((c) => !c.ok))); });
t("figures normalise (S$ 1,100 = s$1100)", () => assert.equal(norm("S$ 1,100"), norm("s$1100")));
t("a forbidden figure fails", () => assert.ok(failedChecks(folder((f) => { f["transcript.json"][1].answer += " Before July it was S$80 per day."; })).some((c) => /never states "S\$80 per day"/.test(c))));
t("a missing figure fails", () => assert.ok(failedChecks(folder((f) => { f["transcript.json"][1].answer = "Isla is covered for hospital stays after an accident."; })).some((c) => /states "S\$110"/.test(c))));
t("the wrong person fails", () => assert.ok(failedChecks(folder((f) => { f["members.json"]["Felix Oran Hartwell"] = "44444444-4444-4444-8444-444444444444"; f["dump-final/dump.json"].tables.chat_messages[3].answer_json.resolvedFamilyMemberId = "44444444-4444-4444-8444-444444444444"; })).some((c) => /about Isla/.test(c))));
t("the old version (no citation of the endorsement) fails", () => assert.ok(failedChecks(folder((f) => { f["dump-final/dump.json"].tables.chat_messages[3].answer_json.citations = [{ policyId: P.text, pageStart: 1 }]; })).some((c) => /current version|cites b.pdf page 1/.test(c))));
t("a citation to the wrong page fails", () => assert.ok(failedChecks(folder((f) => { f["dump-final/dump.json"].tables.chat_messages[3].answer_json.citations = [{ policyId: P.end, pageStart: 2 }]; })).some((c) => /cites b.pdf page 1/.test(c))));
t("no follow-up where one is needed fails", () => assert.ok(failedChecks(folder((f) => { f["transcript.json"][0].pendingQuestion = null; })).some((c) => /asks a follow-up/.test(c))));
t("an error turn is not useful", () => assert.ok(failedChecks(folder((f) => { f["transcript.json"][2].error = "Something went wrong"; })).some((c) => /useful reply/.test(c))));
t("after deletion, citing the deleted source fails", () => assert.ok(failedChecks(folder((f) => { f["dump-final/dump.json"].tables.chat_messages[5].answer_json.citations = [{ policyId: P.end, pageStart: 1 }]; })).some((c) => /does not rely on the deleted b.pdf|does not cite b.pdf/.test(c))));
t("an answer saved in the same transaction as its question (same created_at, listed first in the dump) is paired by message_order", () => {
  const v = grade(folder((f) => { const m = f["dump-final/dump.json"].tables.chat_messages; m.forEach((x: any, i: number) => { x.message_order = i + 1; x.created_at = "2026-10-09T10:00:0" + Math.floor(i / 2) + ".000Z"; }); [m[2], m[3]] = [m[3], m[2]]; }));
  assert.equal(v.verdict, "PASS", JSON.stringify(v.checks.filter((c) => !c.ok)));
});
t("an unread scanned page fails extraction", () => assert.ok(failedChecks(folder((f) => { f["dump-processing/dump.json"].tables.policy_pages[1] = { policy_id: P.end, page_number: 1, text: "", extraction_method: "unreadable" }; })).some((c) => /page 1 text extracted/.test(c))));
t("a wrong automatic link fails", () => assert.ok(failedChecks(folder((f) => { f["linking.json"][0].linked = ["Simon Alastair Hartwell"]; })).some((c) => /linked automatically/.test(c))));
t("placeholder expectations are never a PASS", () => assert.equal(grade(folder((f) => { f["EXPECTED.json"] = { ...expected, placeholder: true }; })).verdict, "UNGRADED (placeholder EXPECTED.json)"));
t("no EXPECTED.json: ungraded", () => assert.equal(grade(folder((f) => { delete f["EXPECTED.json"]; })).verdict, "UNGRADED"));
t("relationships from free text", () => { assert.equal(appRelationship("Self (policy owner / speaker)"), "self"); assert.equal(appRelationship("Spouse of Simon"), "spouse"); assert.equal(appRelationship("Son"), "child"); assert.equal(appRelationship("Daughter"), "child"); });
t("the fixture questions load (agent T's conversations + reopen / delete)", () => {
  const q = readQuestions("scripts/ingest-live/fixture");
  assert.equal(q.conversations.length, 8);
  assert.deepEqual(q.conversations.find((c) => c.id === "C3")!.turns.map((x) => x.id), ["Q3", "Q4"]);
  assert.match(q.conversations[0].turns[0].text, /policy number/);
  assert.ok(q.deleteSource && q.afterDelete.length && q.reopen[0].conversation === "C5");
});
t("the sealed expectations cover every question asked", () => {
  const q = readQuestions("scripts/ingest-live/fixture");
  const e = JSON.parse(fs.readFileSync("scripts/ingest-live/sealed/EXPECTED.json", "utf8"));
  for (const id of [...q.conversation, ...q.reopen, ...q.afterDelete].map((x) => x.id)) assert.ok(e.turns[id], `no expectation for ${id}`);
  assert.ok(!e.placeholder);
});
// Deletion: D1 tests nothing unless the deletion was confirmed (page notice, gone from the library, lifecycle not
// active, nothing else lost) before it was asked. Run ingest-live-1 deleted the WRONG card (hx-text.pdf).
t("an unconfirmed deletion fails D1", () => assert.ok(failedChecks(folder((f) => { f["deleted.json"].confirmed = false; })).some((c) => /asked after a confirmed deletion/.test(c))));
t("a deleted document still listed fails", () => assert.ok(failedChecks(folder((f) => { f["deleted.json"].listedAfter = true; })).some((c) => /deleted through the page and confirmed/.test(c))));
t("the target still active in the DB fails", () => assert.ok(failedChecks(folder((f) => { f["dump-final/dump.json"].tables.policies[1].lifecycle_state = "active"; })).some((c) => /deleted through the page and confirmed/.test(c))));
t("another document deleted instead fails", () => assert.ok(failedChecks(folder((f) => { f["dump-final/dump.json"].tables.policies[0].lifecycle_state = "pending_deletion"; })).some((c) => /deleted through the page and confirmed/.test(c))));
t("a deletion after the question fails", () => assert.ok(failedChecks(folder((f) => { f["deleted.json"].at = "2026-10-09T11:00:00.000Z"; })).some((c) => /asked after a confirmed deletion/.test(c))));

// Usefulness on the REAL replies of run ingest-live-1 (stored answers and loop traces from its final dump).
const RUN1 = "docs/rag-migration/ingest-live/RUN-ingest-live-1-2026-10-09T13-04-18";
if (fs.existsSync(path.join(RUN1, "dump-final", "dump.json"))) {
  const run1 = pairTurns(JSON.parse(fs.readFileSync(path.join(RUN1, "transcript.json"), "utf8")), JSON.parse(fs.readFileSync(path.join(RUN1, "dump-final", "dump.json"), "utf8")));
  const reply = (id: string) => { const x = run1.find((t: any) => t.id === id)!; return usefulReply(x.stored, x.trace, x.user); };
  t("run 1 Q2 (only \"I couldn’t confirm one of the figures...\", citations attached) is NOT useful", () => assert.equal(reply("Q2").ok, false, reply("Q2").detail));
  t("run 1 Q8 (the same generic note) is NOT useful", () => assert.equal(reply("Q8").ok, false));
  t("run 1 D1 (the same generic note) is NOT useful", () => assert.equal(reply("D1").ok, false));
  t("run 1 Q5 (stopped by the per-question limit) is NOT useful", () => assert.equal(reply("Q5").ok, false));
  t("run 1 Q1 (a cited policy number and period) IS useful", () => assert.equal(reply("Q1").ok, true, reply("Q1").detail));
  t("run 1 Q6 (the endorsement's cited figure) IS useful", () => assert.equal(reply("Q6").ok, true, reply("Q6").detail));
  t("run 1 traces are paired to their turns (Q4 was typed into the inline answer box: stored as \"<question>: <answer>\")", () => { assert.equal(run1.filter((x: any) => x.stored).length, run1.length); assert.ok(run1.find((x: any) => x.id === "Q4")!.trace); });
  t("run 1 is graded: the wrong-card deletion fails D1", () => {
    const fails = failedChecks(RUN1);
    assert.ok(fails.some((c) => /asked after a confirmed deletion|deleted through the page and confirmed/.test(c)));
  });
}
// Round 8: the WHOLE visible answer, sentence by sentence, against the expected facts (run 2's real answers).
const RUN2 = "docs/rag-migration/ingest-live/RUN-ingest-live-2-2026-10-09T14-53-47";
const SEALED = "scripts/ingest-live/sealed";
const sealedFacts = (removed: boolean) => {
  const src = JSON.parse(fs.readFileSync(path.join(SEALED, "EXPECTED.source.json"), "utf8"));
  const exp = JSON.parse(fs.readFileSync(path.join(SEALED, "EXPECTED.json"), "utf8"));
  const texts = [...src.facts.flatMap((f: any) => f.verbatim), ...src.answers.flatMap((a: any) => [a.expected, ...(a.arithmetic ?? [])])];
  return factsFrom(texts, exp.superseded.map((x: any) => ({ old: moneyValues(x.old)[0], new: moneyValues(x.new)[0], label: x.label })), removed);
};
const failing = (answer: string, removed = false, ctx = "") => sentenceChecks(answer, sealedFacts(removed), ctx).filter((c) => !c.ok).map((c) => c.name);
t("dates and money are read in every common form", () => { assert.deepEqual(datesIn("from 1 July 2026, 01 Jul 2026, July 1, 2026, 2026-07-01").map((d) => d.iso), ["2026-07-01", "2026-07-01", "2026-07-01", "2026-07-01"]); assert.deepEqual(moneyValues("S$1,500 and $150 and 30%"), [1500, 150]); });
if (fs.existsSync(path.join(RUN2, "transcript.json"))) {
  const run2 = JSON.parse(fs.readFileSync(path.join(RUN2, "transcript.json"), "utf8"));
  const ans = (id: string) => run2.filter((x: any) => x.id === id).pop().answer as string;
  t("run 2 Q9: 'a set amount' fails although S$500 elsewhere is right", () => assert.ok(failing(ans("Q9")).includes("no placeholder where the documents give a figure")));
  t("run 2 Q9: 'the endorsement's effective date is not confirmed' fails (the facts give 01 July 2026)", () => assert.ok(failing(ans("Q9")).includes("no uncertainty the expected facts contradict")));
  t("run 2 D1: S$80 as current cover after the endorsement was deleted fails", () => assert.ok(failing(ans("D1"), true).includes("no superseded figure presented as current")));
  t("D1 with the limitation stated passes", () => assert.deepEqual(failing("The SafeStay schedule lists S$80 per day for each child. An endorsement you uploaded earlier was removed, so the current amount may differ from this.", true), []));
  t("D1: a vague 'no recorded amendments' is not the limitation", () => assert.ok(failing("The documents show no recorded amendments, and the schedule lists S$80 per day for each child.", true).includes("no superseded figure presented as current")));
  for (const id of ["Q1", "Q2", "Q3", "Q5", "Q6", "Q7", "Q8"]) t(`run 2 ${id}: every sentence consistent (no false alarm)`, () => assert.deepEqual(failing(ans(id), false, run2.filter((x: any) => x.conversation === run2.find((y: any) => y.id === id).conversation).map((x: any) => x.user).join("\n")), []));
  t("a wrong figure next to a right one fails", () => assert.ok(failing("The child allowance is S$110 per day from 01 July 2026. Adults get S$95 per day.").includes("every figure stated is one the expected facts give")));
  t("a wrong date next to a right figure fails", () => assert.ok(failing("The child allowance is S$110 per day from 1 August 2026.").includes("every date stated is one the expected facts give")));
  t("before the deletion, S$80 marked as the earlier rate passes; stated as current fails", () => { assert.deepEqual(failing("It was S$80 per day before 01 July 2026 and is S$110 per day now."), []); assert.ok(failing("Each child gets S$80 per day.").includes("no superseded figure presented as current")); });
  t("an honest uncertainty the facts do not contradict passes", () => assert.deepEqual(sentenceChecks("The effective date is not confirmed in your documents.", factsFrom(["S$80"]), "").filter((c) => !c.ok), []));
  // Graded run 2 with the corrected expectations.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-run2-"));
  fs.cpSync(RUN2, dir, { recursive: true });
  for (const f of ["EXPECTED.json", "EXPECTED.source.json"]) fs.copyFileSync(path.join(SEALED, f), path.join(dir, f));
  const v2 = grade(dir);
  const fail2 = v2.checks.filter((c) => !c.ok).map((c) => `${c.scope}: ${c.check}`);
  t("run 2 Q4: the answered fracture question asked again fails (stored questions checked)", () => assert.ok(fail2.some((c) => /^Q4: the answered question is not asked again/.test(c))));
  t("run 2 R1: asking for the admission / discharge times is an accepted answer", () => assert.ok(!fail2.some((c) => /^R1:/.test(c)), fail2.filter((c) => /^R1/.test(c)).join("; ")));
  t("run 2 is FAIL with exactly the expected defects", () => { assert.equal(v2.verdict, "FAIL"); assert.equal(fail2.length, 5, fail2.join("\n")); });
  t("sameQuestion: rephrasing with the same words is the same question", () => assert.ok(sameQuestion("Has a registered medical practitioner certified the fracture type in writing and confirmed it by X-ray?", "Has a registered medical practitioner certified the wrist fracture in writing and confirmed it by X-ray?")));
}
// R1 alternatives on a synthetic folder.
const r1 = (answer: string, pending: string | null) => grade(folder((f) => {
  f["EXPECTED.json"] = { ...expected, turns: { R1: { accept_any: [{ label: "asks for times", ask: "admi|discharg|times" }, { label: "conditioned", must_include: ["S$330"], condition: "72 hours|exactly 3" }], conditioned_figures: [{ figure: "S$330", condition: "72 hours|exactly" }], figures_also: ["S$330"] } } };
  f["transcript.json"].push({ id: "R1", phase: "reopen", user: "3 days in August?", answer, pendingQuestion: pending, error: null, stuck: false });
})).checks.filter((c) => !c.ok && c.scope === "R1").map((c) => c.check);
t("R1: an unconditioned S$330 fails", () => assert.ok(r1("Isla would get S$330 for 3 days.", null).length > 0));
t("R1: S$330 conditioned on exactly 72 hours passes", () => assert.deepEqual(r1("If Isla was confined for exactly 72 hours, that is 3 days at S$110 = S$330.", null), []));
t("R1: asking for the admission and discharge times passes", () => assert.deepEqual(r1("Isla's allowance is S$110 per day.", "What were the admission and discharge times?"), []));
console.log(`ingest-live checker regressions ${n}/${n} passed`);
