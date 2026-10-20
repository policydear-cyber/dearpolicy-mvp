/**
 * Controls for the REVIEWED fx-live-2 criteria (fx-live-2-criteria-v2.ts), and the proof that the registered criteria are untouched:
 *   1. the registered criteria and the v1 usefulness grader, run on the saved live answers, still return the original grades (4 failed checks,
 *      and v1's K2.3, K3t1.6 and V0). The original result is never turned into a pass.
 *   2. negation: "do not establish which document governs" is not a pick; "the certificate governs / prevails" still is.
 *   3. multi-sentence limitation: a limitation explained by a second sentence counts; a far, foreign or amount-separated one does not;
 *      "do not establish" is a limitation verb; a bare amount and a promise still fail.
 *   4. composer drops: one unsupported requirement removed and not shown is a SAFEGUARD (not a pass); anything else stays a FAIL.
 * No model, no database, no spend.
 *   node --import tsx scripts/rag2-live/fx-live-2-criteria-v2-regressions.ts
 */
import fs from "node:fs";
import path from "node:path";
import { criteria, plumbing, type CTurn } from "./fx-live-2-criteria";
import { d2bReviewed, d5cReviewed, d7cReviewed, loadAnswers, picksOneReviewed, reviewed, type SavedAnswers } from "./fx-live-2-criteria-v2";
import { grade } from "./usefulness-check";
import { GOOD_CANCER, GOOD_DANIEL, GOOD_FR1 } from "./fx-live-2-controls";

let passed = 0, failed = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (cond) passed++; else failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? "\n     " + detail.split("\n").slice(0, 12).join("\n     ") : ""}`); };

// ---- 1. the saved live answers, graded by the unchanged registered criteria
const live = path.resolve(__dirname, "../../docs/rag-migration/live");
const runDir = fs.readdirSync(live).find((d) => /^RUN-fx-live-2-/.test(d));
const saved: SavedAnswers = runDir ? loadAnswers(path.join(live, runDir, "answers.json")) : [];
ok("the fx-live-2 run record carries the saved answers (answers.json: six conversations, seven turns)", saved.length === 6 && saved.reduce((n, r) => n + r.turns.length, 0) === 7, String(runDir));
const original = saved.map((r) => ({ id: r.id, failed: [...(r.complete ? criteria(r.id, r.turns) : []), ...plumbing(r.turns, r.complete)].filter((c) => !c.ok).map((c) => c.id) }));
ok("the registered criteria, unchanged, return the original grades on the saved answers: exactly K3t1 D5.c, K4b D7.c, K6a D2.b and K6c D2.b fail (not a pass)", JSON.stringify(original.filter((o) => o.failed.length)) === JSON.stringify([{ id: "K3t1", failed: ["D5.c"] }, { id: "K4b", failed: ["D7.c"] }, { id: "K6a", failed: ["D2.b"] }, { id: "K6c", failed: ["D2.b"] }]), JSON.stringify(original));
const v1 = (id: string) => { const r = saved.find((x) => x.id === id)!; return grade({ case: id, arm: "A", turns: r.turns.map((t) => ({ user: t.user, text: t.text, questions: t.questions ?? [], nextSteps: [], trace: t.trace, shown: t.shown, saved: t.saved, reopened: t.reopened })) }).checks.filter((c) => !c.ok).map((c) => c.id); };
ok("the v1 usefulness grader, unchanged, still fails its three checks on the saved answers: K2.3, K3t1.6 and V0 (K4b)", v1("K2").includes("K2.3") && v1("K3t1").includes("K3t1.6") && v1("K4b").includes("V0"), JSON.stringify([v1("K2"), v1("K3t1"), v1("K4b")]));
ok("v1 K2.3 is not reviewed away: no reviewed rule touches it (it needs the answer to mention Living Care; the answer does not)", !/living care/i.test(saved.find((x) => x.id === "K2")!.turns[0].text));
const rev = saved.flatMap((r) => reviewed(r.id, r.turns, r.complete).map((c) => ({ conv: r.id, ...c })));
ok("the reviewed grading lists the original FAIL beside the reviewed grade for each: D5.c PASS, D2.b PASS (K6a, K6c), D7.c SAFEGUARD", rev.filter((c) => c.original === "FAIL").map((c) => `${c.conv} ${c.id} ${c.reviewed}`).join() === "K3t1 D5.c PASS,K4b D7.c SAFEGUARD,K6a D2.b PASS,K6c D2.b PASS", JSON.stringify(rev.filter((c) => c.changed)));
ok("every check that passed originally is unchanged by the review (nothing was loosened elsewhere)", rev.filter((c) => c.original === "PASS").every((c) => !c.changed && c.reviewed === "PASS"));

// ---- 2. negation
const TXT_FALSE_POSITIVE = "Neither document says which applies. The uploaded documents do not establish which document governs this event.";
ok("negation: 'do not establish which document governs' is not a pick (the live false positive)", picksOneReviewed(TXT_FALSE_POSITIVE).length === 0, picksOneReviewed(TXT_FALSE_POSITIVE).join("|"));
ok("negation: 'Neither document prevails.' is not a pick", picksOneReviewed("Neither document prevails.").length === 0);
ok("negation: 'it is unclear whether the summary overrides the certificate' is not a pick", picksOneReviewed("It is unclear whether the summary overrides the certificate.").length === 0);
ok("negation: 'if the certificate governs, the figure is S$120,000' is conditional, not a pick", picksOneReviewed("If the certificate governs, the figure is S$120,000.").length === 0);
ok("negation: 'The certificate governs this event.' is a pick", picksOneReviewed("The certificate governs this event.").length === 1);
ok("negation: 'The Product Summary prevails over the certificate.' is a pick", picksOneReviewed("The Product Summary prevails over the certificate.").length === 1);
ok("negation: 'The S$1,250 is the correct figure and should be used.' is a pick", picksOneReviewed("The S$1,250 is the correct figure and should be used.").length >= 1);
ok("negation: a negation in an EARLIER clause does not cancel a later pick ('The documents do not say which prevails, but the certificate governs.')", picksOneReviewed("The documents do not say which prevails, but the certificate governs.").length === 1);
ok("negation: the answer that really picks one still fails D5.c in the reviewed rule (GOOD_FR1 + 'The certificate prevails.')", !d5cReviewed(GOOD_FR1 + " The certificate prevails.") && d5cReviewed(GOOD_FR1));
ok("negation: a total still fails D5.c in the reviewed rule", !d5cReviewed(GOOD_FR1 + " Together that is S$121,250."));
ok("negation: v1 K3t1.6 is still the registered, negation-blind pattern (it fails the recorded answer; the review does not edit it)", /do not establish which document governs/.test(saved.find((x) => x.id === "K3t1")!.turns[0].text) && v1("K3t1").includes("K3t1.6"));

// ---- 3. multi-sentence limitation
const LISTED = "Grace’s certificate lists Group Living Care at S$350,000 as of 6 October 2022; this is the amount shown on that date, not confirmation of cover now.";
const LIM = "The Scheme X Group Insurance does not state what Group Living Care pays for cancer.";
const EXPLAIN = "That is not the same as saying it is excluded or not covered: it only means this document does not show it, and only the insurer can confirm it.";
ok("limitation: limitation + its explanation, then the amount (the live K6a answer shape) passes the reviewed D2.b", d2bReviewed(`${LIM} ${EXPLAIN}\n${LISTED}`));
ok("limitation: the amount then 'do not establish ... what amount would be payable' (the live K6c answer shape) passes", d2bReviewed(`${LISTED}\nThe uploaded documents do not establish whether Grace’s cancer meets the policy definition or what amount would be payable for it.`));
ok("limitation: the amount alone fails (the fx-live-1 K6a defect)", !d2bReviewed(LISTED));
ok("limitation: a limitation three sentences before the amount does not count", !d2bReviewed(`${LIM} It is dated. It is a group scheme.\n${LISTED}`));
ok("limitation: four sentences after the amount does not count", !d2bReviewed(`${LISTED} It is dated. It is a group scheme. Contact the administrator. ${LIM}`));
ok("limitation: a limitation about another topic ('do not establish when the certificate was issued') does not count", !d2bReviewed(`The documents do not establish when the certificate was issued.\n${LISTED}`));
ok("limitation: another benefit's amount between the limitation and this amount breaks the link", !d2bReviewed(`${LIM} Critical Illness is listed at S$100,000.\n${LISTED}`));
ok("limitation: every S$350,000 sentence needs its own limitation (a second, unlimited mention fails)", !d2bReviewed(`${LIM} ${EXPLAIN}\n${LISTED}\nContact Aldermoor Life Ltd. Later, Group Living Care of S$350,000 is mentioned again in a long unrelated paragraph. A. B. C. D.`));
ok("limitation: a payment promise is not rescued by a nearby limitation on the DIFFERENT d2 checks (D2.d still fails it in the registered criteria)", criteria("K6a", [{ text: GOOD_CANCER + " Her Group Living Care will pay you S$350,000 for the cancer." }]).some((c) => c.id === "D2.d" && !c.ok));
ok("limitation: the repaired cancer answer passes the reviewed rule", d2bReviewed(GOOD_CANCER));

// ---- 4. composer drops
const T = (text: string, dropped: { sentence: string; reason: string }[] = [], extra: Partial<CTurn["trace"]> = {}): CTurn => ({ text, trace: { dropped, gate: [], incomplete: null, ...extra } });
const DROP = { sentence: "That requires the insurer's medical assessment.", reason: "not supported by its evidence: “that requires the insurer's medical assessment.”: its evidence does not mention what it is about (requir, insurer, medical, assessment)" };
ok("drop: no drop is a PASS", d7cReviewed([T(GOOD_DANIEL)], true).grade === "PASS");
ok("drop: one unsupported requirement, not shown, with every correctness check passing, is a SAFEGUARD (not a PASS)", d7cReviewed([T(GOOD_DANIEL, [DROP])], true).grade === "SAFEGUARD");
ok("drop: the same drop with a failing correctness check stays a FAIL", d7cReviewed([T(GOOD_DANIEL, [DROP])], false).grade === "FAIL");
ok("drop: a dropped sentence that is not a requirement (a figure) stays a FAIL", d7cReviewed([T(GOOD_DANIEL, [{ sentence: "Daniel’s fracture is S$120,000.", reason: DROP.reason }])], true).grade === "FAIL");
ok("drop: a drop for another reason (not 'not supported by its evidence') stays a FAIL", d7cReviewed([T(GOOD_DANIEL, [{ ...DROP, reason: "names another person" }])], true).grade === "FAIL");
ok("drop: a dropped sentence that still appears in the answer stays a FAIL", d7cReviewed([T(GOOD_DANIEL + " That requires the insurer's medical assessment.", [DROP])], true).grade === "FAIL");
ok("drop: a save-time gate removal stays a FAIL", d7cReviewed([T(GOOD_DANIEL, [], { gate: [{ x: 1 }] })], true).grade === "FAIL");
ok("drop: an 'incomplete' notice stays a FAIL", d7cReviewed([T(GOOD_DANIEL, [], { incomplete: ["x"] })], true).grade === "FAIL");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
