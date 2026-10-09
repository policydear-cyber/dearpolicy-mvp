/**
 * The live ingestion grader on a synthetic run folder (no app, no database, no model):
 * a correct run passes; each defect class fails on its own check.
 *   node --import tsx scripts/ingest-live/check-regressions.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { grade, norm, pairTurns, usefulReply } from "./check";
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
console.log(`ingest-live checker regressions ${n}/${n} passed`);
