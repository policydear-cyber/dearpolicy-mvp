/** Structured-answers release: a quotation or parenthesis is never a sentence boundary (the S$3,750 / “Correction: …” failure). */
import { sentencesOf } from "@/lib/chat/answer-verification";
let failed = 0, passed = 0;
const check = (n: string, ok: boolean, d = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : "\n     " + d}`); };
const REPORTED = "If the Simple Fracture benefit applies to Daniel's case “Hip” (as you described: “Correction: it was his hip, not his tibia. Keep this as a hypothetical closed fracture.”), the conditional illustration is S$3,750: 75% of the limit of S$5,000; it is an illustration, not a payment.";
check("the reported failure: a multi-sentence quotation stays inside one statement", sentencesOf(REPORTED).length === 1, JSON.stringify(sentencesOf(REPORTED)));
check("two statements are still two", sentencesOf(`${REPORTED} Contact Aldermoor Life Ltd about the policy.`).length === 2);
check("a printed condition quoted whole stays whole", sentencesOf("The booklet prints “This Benefit can only be claimed under the Core Scheme. It is not payable twice.” as a condition. Contact the insurer.").length === 2);
check("a parenthesis with a full stop stays whole", sentencesOf("The limit (page 13. Table 2) is S$5,000. The hip row is 75%.").length === 2);
check("an unclosed quote does not swallow the rest", sentencesOf("He said “broken leg. It hurts. Then more.").length === 3, JSON.stringify(sentencesOf("He said “broken leg. It hurts. Then more.")));
check("an unclosed parenthesis does not swallow the rest", sentencesOf("See page 4 (the table. Next line. Last.").length === 3);
check("plain text is split as before", sentencesOf("One. Two! Three? four.").length === 3, JSON.stringify(sentencesOf("One. Two! Three? four.")));
check("empty text", sentencesOf("").length === 1 && sentencesOf("")[0] === "");
console.log(`\nsegmentation: ${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
