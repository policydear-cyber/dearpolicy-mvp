/**
 * Controls for the fx-live-2 decision criteria (fx-live-2-criteria.ts) and the two graders added for it (usefulness-check.ts: K3t1, K6c).
 * PASS controls are the recorded REPAIRED answers of PR #57 (scripted-model browser run on 51a355a; fx-live-2-controls.ts); FAIL controls are
 * minimal wrong texts, one per criterion, including the fx-live-1 defects themselves. No model, no database, no spend.
 *   node --import tsx scripts/rag2-live/fx-live-2-criteria-regressions.ts
 */
import { criteria, plumbing, type CTurn } from "./fx-live-2-criteria";
import { grade, type Transcript, type Turn } from "./usefulness-check";
import { GOOD_CANCER, GOOD_DANIEL, GOOD_DENTAL, GOOD_FR1, GOOD_SICK } from "./fx-live-2-controls";

let passed = 0, failed = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (cond) passed++; else failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? "\n     " + detail.split("\n").slice(0, 12).join("\n     ") : ""}`); };
const T = (text: string, questions: string[] = []): CTurn => ({ text, questions });
const failedOf = (id: string, ...texts: (string | [string, string[]])[]) => criteria(id, texts.map((t) => (typeof t === "string" ? T(t) : T(t[0], t[1])))).filter((c) => !c.ok).map((c) => c.id);
const allPass = (id: string, ...texts: string[]) => { const f = failedOf(id, ...texts); return { ok: f.length === 0, f }; };
const turn = (text: string, questions: string[] = []): Turn => ({ user: "u", text, questions, nextSteps: [] });
const B = (c: string, text: string): Transcript => ({ case: c, arm: "B", turns: [turn(text)] });
const gfail = (c: string, text: string) => grade(B(c, text)).checks.filter((k) => k.gate && !k.ok).map((k) => k.id);

// ---- PASS controls: the recorded repaired answers
for (const [id, text, label] of [["K6b", GOOD_DENTAL, "dental"], ["K6a", GOOD_CANCER, "cancer"], ["K6c", GOOD_CANCER, "cancer (as the fresh paraphrase)"], ["K2", GOOD_SICK, "sick stay"], ["K3t1", GOOD_FR1, "fracture turn 1"]] as const) {
  const r = allPass(id, text); ok(`${id}: the repaired ${label} answer passes every criterion`, r.ok, r.f.join());
}
{ const r = allPass("K4b", GOOD_DANIEL); ok("K4b: the repaired Daniel correction passes every criterion", r.ok, r.f.join()); }

// ---- D1 (absence)
ok("D1: 'You have no dental cover' fails D1.a and D1.c", ["D1.a", "D1.c"].every((i) => failedOf("K6b", "You have no dental cover.").includes(i)));
ok("D1: 'Dental treatment is excluded' fails D1.c", failedOf("K6b", GOOD_DENTAL + " Dental treatment is excluded from Grace's cover.").includes("D1.c"));
ok("D1: the generic 'could not confirm' answer fails D1.a and D1.d (the fx-live-1 defect)", ["D1.a", "D1.d"].every((i) => failedOf("K6b", "I couldn’t confirm an answer to that from your documents.").includes(i)));
ok("D1: an absence that names no document fails D1.b", failedOf("K6b", "The documents do not describe a benefit for dental treatment. That is not the same as saying there is no such cover; only the insurer can confirm it.").includes("D1.b"));
ok("D1: a jaw figure offered as dental cover fails D1.e", failedOf("K6b", GOOD_DENTAL + " A jaw fracture pays S$300,000 as dental cover.").includes("D1.e"));
ok("D1: 'not the same as saying there is no such cover' is allowed (does not trip D1.c)", !failedOf("K6b", GOOD_DENTAL).includes("D1.c"));

// ---- D2 (cancer amount keeps its limitation; no promise)
const LISTED = "Grace’s certificate lists Group Living Care of S$350,000 as of 6 October 2022; this is the amount shown on that date, not confirmation of cover now.";
ok("D2: the bare listed amount with the limitation dropped fails D2.b (the fx-live-1 K6a defect)", failedOf("K6a", LISTED).includes("D2.b"));
ok("D2: the limitation four sentences away does not count (D2.b)", failedOf("K6a", LISTED + " It is dated. It is a group scheme. Contact the administrator. The Scheme X Group Insurance Scheme does not state what Group Living Care pays for cancer.").includes("D2.b"));
ok("D2: 'cancer pays S$350,000' fails D2.c", failedOf("K6a", GOOD_CANCER + " A cancer diagnosis pays S$350,000.").includes("D2.c"));
ok("D2: 'will pay you S$350,000' fails D2.d (payment promise)", failedOf("K6c", GOOD_CANCER + " Her Group Living Care will pay you S$350,000 for the cancer.").includes("D2.d"));
ok("D2: an invented waiting period fails D2.e", failedOf("K6a", GOOD_CANCER + " There is a 90-day waiting period.").includes("D2.e"));
ok("D2: a summed S$650,000 for cancer fails D2.c", failedOf("K6a", GOOD_CANCER + " With Living Care Plus the cancer total is S$650,000.").includes("D2.c"));
ok("D2: 'cancer is covered' fails D2.f", failedOf("K6c", GOOD_CANCER + " Cancer is covered under Group Living Care.").includes("D2.f"));

// ---- D3 (sickness)
ok("D3: a repeated accident question fails D3.a (the fx-live-1 K2 defect)", failedOf("K2", [GOOD_SICK + " Was it caused by an accident?", ["Was it caused by an accident?"]]).includes("D3.a"));
ok("D3: a saved question alone fails D3.a", failedOf("K2", [GOOD_SICK, ["Was the hospital stay an accident?"]]).includes("D3.a"));
ok("D3: the accident benefit's 250 left standing as payable fails D3.d", failedOf("K2", GOOD_SICK + " The plan pays S$250 for each hospital stay.").includes("D3.d"));
ok("D3: 'not covered' without the accident requirement fails D3.b and D3.c", ["D3.b", "D3.c"].every((i) => failedOf("K2", "No, that is not covered.").includes(i)));
ok("D3: an invented sickness benefit fails D3.e", failedOf("K2", GOOD_SICK + " Sickness hospital cash pays S$100 per day.").includes("D3.e"));

// ---- D4 (person correction)
ok("D4: two contradictory notices fail D4.a and D4.b (the fx-live-1 K4b defect)", ["D4.a", "D4.b"].every((i) => failedOf("K4b", GOOD_DANIEL + "\n\nUpdated: this is about Grace, not Daniel.").includes(i)));
ok("D4: Grace's figures after the correction fail D4.a and D4.c", ["D4.a", "D4.c"].every((i) => failedOf("K4b", GOOD_DANIEL.replace(/Daniel/g, "Grace")).includes(i)));
ok("D4: Grace presented as the injured person fails D4.d", failedOf("K4b", GOOD_DANIEL + " Grace’s cover would pay it.").includes("D4.d"));
ok("D4: a total fails D4.e", failedOf("K4b", GOOD_DANIEL + " Together S$121,250.").includes("D4.e"));
ok("D4: no notice at all fails D4.a", failedOf("K4b", GOOD_DANIEL.replace(/Updated: this is about Daniel, not Grace\. /, "")).includes("D4.a"));

// ---- D5 (fracture figures, dates, row-specific footnotes)
const NOTE = /; the page prints a footnote for that row: “[^”]*” \(marked #\)/;
ok("D5: the answer with the footnote removed fails D5.d", failedOf("K3t1", GOOD_FR1.replace(NOTE, "")).includes("D5.d"));
ok("D5: the footnote attached to the certificate's S$120,000 row fails D5.e", failedOf("K3t1", GOOD_FR1.replace("not a payment or an insurer's decision.\n\nThe Product Summary", "not a payment or an insurer's decision; the page prints a footnote for that row: “For the avoidance of doubt, any fractures of thumb, finger and palm are not covered” (marked #).\n\nThe Product Summary")).includes("D5.e"));
ok("D5: a toe / foot footnote on an arm fracture fails D5.f", failedOf("K3t1", GOOD_FR1 + " Any fractures of toe and foot are not covered (marked ^).").includes("D5.f"));
ok("D5: a total fails D5.c", failedOf("K3t1", GOOD_FR1 + " Together that is S$121,250.").includes("D5.c"));
ok("D5: the undated base fails D5.b", failedOf("K3t1", GOOD_FR1.replace(", printed as of 6 October 2022, not confirmation of cover on a later date", "")).includes("D5.b"));
ok("D5: a document said to prevail fails D5.c", failedOf("K3t1", GOOD_FR1 + " The certificate prevails.").includes("D5.c"));
ok("D5: an X-ray question fails D5.h", failedOf("K3t1", [GOOD_FR1, ["Was the fracture confirmed by X-ray?"]]).includes("D5.h"));
ok("D5: a wrong base (the 25% on Grace's S$600,000) fails D5.a", failedOf("K3t1", GOOD_FR1.replace("25% of the Simple Fracture benefit limit of S$5,000", "25% of Grace's sum insured of S$600,000")).includes("D5.a"));

// ---- D6 (every conversation)
ok("D6: a payment promise fails D6.a", failedOf("K3t1", GOOD_FR1 + " You will be paid S$1,250.").includes("D6.a"));
ok("D6: Daniel in a Grace-only conversation fails D6.c (wrong person)", failedOf("K3t1", GOOD_FR1 + " Daniel’s cover is the same.").includes("D6.c"));
ok("D6: Daniel is expected in K4b (D6.c is not applied)", !failedOf("K4b", GOOD_DANIEL).includes("D6.c"));
ok("D6: a real insurer name fails D6.b", failedOf("K6b", GOOD_DENTAL + " Contact Singapore Life.").includes("D6.b"));
ok("D6: a leaked identifier fails D6.b", failedOf("K6b", GOOD_DENTAL + " (benefit_id b4)").includes("D6.b"));

// ---- D7 (plumbing is reported apart)
const P = (extra: Partial<CTurn>): CTurn => ({ text: "x", shown: "a", saved: "a", reopened: "a", trace: { dropped: [], gate: [], incomplete: [] }, error: null, ...extra });
ok("D7: a consistent, complete conversation passes", plumbing([P({})], true).every((c) => c.ok));
ok("D7: saved != reopened fails D7.b", plumbing([P({ reopened: "b" })], true).some((c) => c.id === "D7.b" && !c.ok));
ok("D7: a dropped statement fails D7.c", plumbing([P({ trace: { dropped: [{ sentence: "s", reason: "r" }], gate: [], incomplete: [] } })], true).some((c) => c.id === "D7.c" && !c.ok));
ok("D7: an incomplete conversation or an error fails D7.a", plumbing([P({ error: "waiting for the response" })], false).some((c) => c.id === "D7.a" && !c.ok));

// ---- the two graders added to usefulness-check.ts
ok("grader K3t1: the repaired fracture turn passes", grade(B("K3t1", GOOD_FR1)).verdict === "PASS", gfail("K3t1", GOOD_FR1).join());
ok("grader K3t1: no footnote fails K3t1.10", gfail("K3t1", GOOD_FR1.replace(NOTE, "")).includes("K3t1.10"));
ok("grader K3t1: a toe / foot mention fails K3t1.12", gfail("K3t1", GOOD_FR1 + " Toe and foot fractures are not covered.").includes("K3t1.12"));
ok("grader K3t1: an undated S$600,000 base fails K3t1.9", gfail("K3t1", GOOD_FR1.replace(", printed as of 6 October 2022, not confirmation of cover on a later date", "")).includes("K3t1.9"));
ok("grader K3t1: a total fails K3t1.3", gfail("K3t1", GOOD_FR1 + " Together S$121,250.").includes("K3t1.3"));
ok("grader K3t1: a footnote on the certificate row fails K3t1.11", gfail("K3t1", GOOD_FR1.replace("not a payment or an insurer's decision.\n\nThe Product Summary", "not a payment or an insurer's decision; thumb, finger and palm are not covered.\n\nThe Product Summary")).includes("K3t1.11"));
ok("grader K6c: the repaired cancer answer passes", grade(B("K6c", GOOD_CANCER)).verdict === "PASS", gfail("K6c", GOOD_CANCER).join());
ok("grader K6c: 'will pay S$350,000' fails K6c.7", gfail("K6c", GOOD_CANCER + " Her Group Living Care will pay S$350,000.").includes("K6c.7"));
// (the v1 check K6a.2 / K6c.2 is loose: a sentence that merely contains "not ... shown" satisfies it, so the bare listed amount passes it; the stricter, pre-registered D2.b above is the decision criterion)
ok("grader K3t1 and K6c expect one turn", grade({ case: "K6c", arm: "B", turns: [] }).verdict === "INCOMPLETE" && grade({ case: "K3t1", arm: "B", turns: [] }).verdict === "INCOMPLETE");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
