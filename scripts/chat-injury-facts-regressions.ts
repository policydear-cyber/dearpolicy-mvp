/**
 * Deterministic fracture / injury facts in the live-chat parser (lib/chat/facts.ts).
 * "Josephine broke her arm." must keep the fracture kind even when the model
 * reduces it to a generic injury, and hypotheticals/negations must add nothing.
 */
import assert from "node:assert/strict";
import { factLabels, mergeInterpretation, reportedFractureStatement, type Interpretation } from "@/lib/chat/facts";
import type { ConversationState, SubjectFacts } from "@/lib/chat/types";

let cases = 0;
function test(name: string, fn: () => void) { try { for (let i = 0; i < 2; i++) fn(); cases++; } catch (e) { throw new Error(name, { cause: e }); } }
const now = new Date(Date.UTC(2026, 8, 1, 9, 0));
type ModelFact = Interpretation["facts"][number];
const mf = (key: string, value: ModelFact["value"], quote: string, subjectId = "p1"): ModelFact => ({ subjectId, key, value, state: "known", quote });
const empty = (ids = ["p1"]): ConversationState => ({ subjects: Object.fromEntries(ids.map((id) => [id, {}])), scenarios: {} });
function turn(message: string, opts: { state?: ConversationState; facts?: ModelFact[]; intent?: Interpretation["intent"]; newTopic?: boolean; subjectIds?: string[] } = {}) {
  const subjectIds = opts.subjectIds ?? ["p1"];
  const interpretation: Interpretation = { intent: opts.intent ?? "claim", newTopic: opts.newTopic ?? true, searchTerms: [], facts: opts.facts ?? [], scenarioCandidates: [] };
  return mergeInterpretation({ state: opts.state ?? empty(subjectIds), interpretation, message, subjectIds, now });
}
const v = (s: ConversationState, key: string, id = "p1") => s.subjects[id]?.[key]?.state === "known" ? s.subjects[id][key].value : undefined;
const strip = (facts: SubjectFacts) => Object.fromEntries(Object.entries(facts).map(([k, f]) => [k, { ...f, recordedAt: "" }]));

const positives: [string, string, "left" | "right" | null, string][] = [
  ["Josephine broke her arm.", "arm", null, "broke her arm"],
  ["She has a broken arm.", "arm", null, "broken arm"],
  ["Josephine fractured her wrist yesterday.", "wrist", null, "fractured her wrist"],
  ["The X-ray showed a fracture of the left elbow.", "elbow", "left", "fracture of the left elbow"],
  ["He cracked a rib playing football.", "rib", null, "cracked a rib"],
  ["He cracked two ribs? No - he cracked ribs.", "rib", null, "cracked ribs"],
  ["She has a broken left wrist.", "wrist", "left", "broken left wrist"],
  ["Her right ankle was fractured.", "ankle", "right", "Her right ankle was fractured"],
  ["He broke his forearm.", "forearm", null, "broke his forearm"],
];
for (const [message, bodyPart, side, quote] of positives) test("positive: " + message, () => {
  const s = turn(message, { intent: "policy_question" });
  const site = (side ? side + " " : "") + bodyPart;
  assert.deepEqual(reportedFractureStatement(message), { bodyPart, side, quote });
  assert.equal(s.intent, "claim");
  assert.equal(v(s, "injured"), true);
  assert.equal(v(s, "injuryKind"), "fracture");
  assert.equal(v(s, "fractureBodyPart"), site);
  assert.equal(v(s, "injuryBodyPart"), bodyPart);
  assert.equal(v(s, "injurySide"), side ?? undefined);
  assert.equal(v(s, "injuries"), quote);
  assert.equal(s.subjects.p1.injuryKind.source, "system-derived");
  assert.equal(s.subjects.p1.injuryKind.quote, quote);
  for (const key of ["accident", "accidentalCause", "eventType", "permanentImpairment", "hospitalised", "diagnosis"]) assert.equal(s.subjects.p1[key], undefined, key);
  assert.deepEqual(s.scenarios!.p1.map((x) => [x.label, x.family, x.traits, x.source]), [["Reported fracture: " + site, "injury", ["bodily_injury"], "system-derived"]]);
  assert.ok(factLabels(s.subjects.p1).includes("Fracture: " + site));
  assert.ok(!factLabels(s.subjects.p1).some((l) => /^Injury type|^Injured body part|^Side/.test(l)));
});

const negatives = [
  "She did not break her arm.", "She didn't fracture her wrist.", "Could this cover a broken arm?",
  "What if someone fractures a wrist?", "if she broke her arm would the policy pay", "does the policy pay for a broken arm",
  "Is a fractured wrist covered", "What happens in case of a broken leg", "She never broke her arm.",
];
for (const message of negatives) test("negative: " + message, () => {
  assert.equal(reportedFractureStatement(message), null);
  const s = turn(message, { intent: "policy_question", newTopic: false });
  assert.equal(v(s, "injuryKind"), undefined);
  assert.equal(v(s, "fractureBodyPart"), undefined);
  assert.equal(v(s, "injured"), undefined);
  assert.deepEqual(s.scenarios!.p1 ?? [], []);
  assert.notEqual(s.intent, "claim");
});

test("model 'arm' injury in the same turn does not erase the fracture", () => {
  const s = turn("Josephine broke her arm.", { facts: [mf("injuries", "arm", "broke her arm"), mf("injuryKind", "broke", "broke her arm"), mf("fractureBodyPart", null, "broke her arm")] });
  assert.equal(v(s, "injuryKind"), "fracture");
  assert.equal(v(s, "fractureBodyPart"), "arm");
  assert.equal(v(s, "injuries"), "broke her arm");
});
test("a more specific model injuries value is kept", () => {
  const s = turn("Josephine broke her arm - a fractured left radius.", { facts: [mf("injuries", "fractured left radius", "a fractured left radius")] });
  assert.equal(v(s, "injuries"), "fractured left radius");
  assert.equal(v(s, "injuryKind"), "fracture");
});
test("'An accident.' follow-up keeps the fracture facts; vaguer model values are ignored", () => {
  const first = turn("Josephine broke her arm.");
  const s = turn("An accident.", { state: first, intent: "follow_up", newTopic: false,
    facts: [mf("injuries", "accident", "An accident."), mf("injuryKind", "accident", "An accident."), mf("injured", false, "An accident."), mf("eventType", "accident", "An accident.")] });
  assert.equal(s.intent, "claim");
  assert.equal(v(s, "injuryKind"), "fracture");
  assert.equal(v(s, "fractureBodyPart"), "arm");
  assert.equal(v(s, "injuries"), "broke her arm");
  assert.equal(v(s, "injured"), true);
  assert.equal(v(s, "eventType"), "accident", "the user's own answer is still recorded");
  assert.equal(s.scenarios!.p1.length, 1);
});
test("later model refinement of the site is accepted", () => {
  const first = turn("Josephine broke her arm.");
  const s = turn("It was her left arm.", { state: first, intent: "follow_up", newTopic: false, facts: [mf("fractureBodyPart", "left arm", "left arm"), mf("fractureBodyPart", "leg", "It was her left arm.")] });
  assert.equal(v(s, "fractureBodyPart"), "left arm");
});
test("an explicit correction clears the fracture", () => {
  const first = turn("Josephine broke her arm.");
  const s = turn("Sorry, it wasn't broken, just bruised.", { state: first, intent: "follow_up", newTopic: false, facts: [mf("injuries", "bruised", "just bruised")] });
  assert.equal(v(s, "injuryKind"), undefined);
  assert.equal(v(s, "fractureBodyPart"), undefined);
  assert.equal(v(s, "injuries"), "bruised");
  assert.equal(v(s, "injured"), true);
  assert.deepEqual(s.scenarios!.p1, []);
});
test("'hurt her arm' is an injury, not a fracture", () => {
  for (const message of ["Josephine hurt her arm.", "She injured her right arm."]) {
    const s = turn(message, { intent: "policy_question" });
    assert.equal(v(s, "injured"), true);
    assert.equal(v(s, "injuryBodyPart"), "arm");
    assert.equal(v(s, "injuryKind"), undefined);
    assert.equal(v(s, "fractureBodyPart"), undefined);
    assert.deepEqual(s.scenarios!.p1 ?? [], []);
  }
  assert.equal(v(turn("She injured her right arm."), "injurySide"), "right");
});
test("two subjects: no deterministic fact is attributed", () => {
  const s = turn("Josephine broke her arm.", { subjectIds: ["p1", "p2"] });
  for (const id of ["p1", "p2"]) { assert.equal(v(s, "injuryKind", id), undefined); assert.equal(v(s, "fractureBodyPart", id), undefined); assert.deepEqual(s.scenarios![id] ?? [], []); }
});
test("a deceased subject gets no fracture facts", () => {
  const dead = empty(); dead.subjects.p1.death = { value: true, state: "known", quote: "died", source: "user", recordedAt: now.toISOString() };
  const s = turn("She broke her arm.", { state: dead, newTopic: false });
  assert.equal(v(s, "injuryKind"), undefined);
});
test("determinism: same input twice gives identical facts", () => {
  const a = turn("Josephine broke her left wrist.", { facts: [mf("injuries", "wrist", "left wrist")] });
  const b = turn("Josephine broke her left wrist.", { facts: [mf("injuries", "wrist", "left wrist")] });
  assert.deepEqual(strip(a.subjects.p1), strip(b.subjects.p1));
  assert.deepEqual(a.scenarios, b.scenarios);
});

test("X1: an elliptical self-retraction cancels the fracture report in the same message", () => {
  for (const message of ["Josephine broke her arm last year. No wait, she didn't.", "Josephine broke her arm. Actually she didn't.",
    "Josephine broke her arm. Sorry, she didn't.", "Josephine broke her arm. Scratch that.", "Josephine broke her arm last year? no wait, she didn't"]) {
    const s = turn(message, { facts: [mf("injured", true, "broke her arm"), mf("injuries", "broke her arm", "broke her arm")] });
    assert.equal(v(s, "injuryKind"), undefined, message);
    assert.equal(v(s, "fractureBodyPart"), undefined, message);
    assert.equal(v(s, "injuries"), undefined, message);
    assert.equal(v(s, "injured"), undefined, message);
    assert.deepEqual(s.scenarios!.p1 ?? [], [], message);
  }
});
test("X1: a later-turn retraction clears an existing fracture", () => {
  const s = turn("No wait, she didn't.", { state: turn("Josephine broke her arm."), intent: "follow_up", newTopic: false });
  assert.equal(v(s, "injuryKind"), undefined);
  assert.equal(v(s, "fractureBodyPart"), undefined);
  assert.equal(v(s, "injured"), undefined);
  assert.deepEqual(s.scenarios!.p1, []);
});
test("X1: 'actually' without a retraction does not cancel", () => {
  const s = turn("Josephine broke her arm. Actually she didn't go to hospital.");
  assert.equal(v(s, "injuryKind"), "fracture");
});
test("X5: model injury facts on hypotheticals, questions and negations are screened", () => {
  const sloppy = (quote: string) => ["injured", "injuryKind", "fractureBodyPart", "injuryBodyPart", "injurySide", "injuries", "permanentImpairment"].map((key) =>
    mf(key, key === "injured" || key === "permanentImpairment" ? true : key === "injurySide" ? "left" : key === "injuryKind" ? "fracture" : "arm", quote));
  for (const [message, quote] of [["Could this cover a broken arm?", "a broken arm"], ["does the policy pay for a broken left arm", "a broken left arm"],
    ["She did not break her left arm.", "She did not break her left arm"], ["What if she broke her left arm?", "she broke her left arm"],
    ["If she broke her left arm would we be covered", "she broke her left arm"], ["Is a broken left arm covered", "Is a broken left arm covered"]] as const) {
    const s = turn(message, { intent: "claim", newTopic: false, facts: sloppy(quote) });
    for (const key of ["injured", "injuryKind", "fractureBodyPart", "injuryBodyPart", "injurySide", "injuries", "permanentImpairment"]) assert.equal(v(s, key), undefined, message + " " + key);
  }
});
test("X5: legitimate model injury facts from a direct statement are kept", () => {
  const s = turn("She fell and has a swollen left knee that is badly injured.", { facts: [mf("injured", true, "badly injured"), mf("injuryBodyPart", "knee", "swollen left knee"),
    mf("injurySide", "left", "swollen left knee"), mf("injuries", "swollen left knee", "swollen left knee")] });
  assert.equal(v(s, "injured"), true);
  assert.equal(v(s, "injuryBodyPart"), "knee");
  assert.equal(v(s, "injurySide"), "left");
  assert.equal(v(s, "injuries"), "swollen left knee");
  const t = turn("She was not injured.", { facts: [mf("injured", false, "She was not injured")] });
  assert.equal(v(t, "injured"), false);
});

Promise.resolve().then(() => console.log(`chat injury facts regressions passed (${cases} cases)`)).catch((e) => { console.error(e); process.exit(1); });
