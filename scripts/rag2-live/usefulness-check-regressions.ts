/**
 * Tests of the fx-live-1 graders (scripts/rag2-live/usefulness-check.ts) on hand-written texts: each case has a text that should PASS
 * and, for every gating idea, a minimal wrong text that should FAIL on that check. No model, no database, no spend.
 *   node --import tsx scripts/rag2-live/usefulness-check-regressions.ts
 */
import { grade, money, type Transcript, type Turn } from "./usefulness-check";

let passed = 0, failed = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (cond) passed++; else failed++; console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? "\n     " + detail.split("\n").slice(0, 12).join("\n     ") : ""}`); };
const turn = (text: string, questions: string[] = []): Turn => ({ user: "u", text, questions, nextSteps: [] });
const B = (c: string, ...texts: (string | [string, string[]])[]): Transcript => ({ case: c, arm: "B", turns: texts.map((t) => (typeof t === "string" ? turn(t) : turn(t[0], t[1]))) });
const failedIds = (tr: Transcript) => grade(tr).checks.filter((c) => c.gate && !c.ok).map((c) => c.id);

ok("money: S$1,250 is matched, S$121,250 is not", money(1250).test("S$1,250") && !money(1250).test("S$121,250") && money(120000).test("S$120,000.") && money(600000).test("$600,000, and"));

// ---- K1
const K1good = "Grace's Group Personal Accident cover is S$600,000, as printed on her certificate of group insurance as of 06/10/2022. That is the date on the document, not a confirmation of cover on a later date.";
ok("K1 good passes", grade(B("K1", K1good)).verdict === "PASS", failedIds(B("K1", K1good)).join());
ok("K1 wrong policy amount fails K1.2", failedIds(B("K1", "Grace's Personal Accident cover is S$1,000,000 as of 6 October 2022.")).includes("K1.2"));
ok("K1 missing date fails K1.3", failedIds(B("K1", "Grace has Group Personal Accident cover of S$600,000 according to her certificate on file.")).includes("K1.3"));
ok("K1 'currently covered' fails K1.4", failedIds(B("K1", K1good + " She is currently covered.")).includes("K1.4"));
ok("K1 empty-safe answer fails", grade(B("K1", "I cannot help with that.")).verdict === "FAIL");

// ---- K2
const K2good = "No. The personal accident cover pays for an accidental injury; a stay caused by sickness is not an accident, so the S$250 hospital recuperation benefit and the other accident benefits do not apply to what you describe. Her certificate also lists Group Living Care and Group Living Care Plus, but the pages available do not describe what those pay. You could ask the insurer about them.";
ok("K2 good passes", grade(B("K2", K2good)).verdict === "PASS", failedIds(B("K2", K2good)).join());
ok("K2 S$250 as payable fails K2.2", failedIds(B("K2", "She was in hospital for three days so the plan pays S$250 per hospitalisation, S$750 in total.")).includes("K2.2"));
ok("K2 no 'not shown' statement fails K2.3", failedIds(B("K2", "No, sickness is not an accident so accident cover does not apply.")).includes("K2.3"));
ok("K2 question fails K2.5", failedIds(B("K2", [K2good, ["What was the diagnosis?"]])).includes("K2.5"));

// ---- K3
const alt3 = "Her documents give two different answers, and they do not settle which applies: these are alternatives from separate documents, never a total. If the fall caused a covered fracture, the Product Summary (page 13) takes 25% of a fixed S$5,000 limit, a conditional illustration of S$1,250. The Certificate of Insurance Part 2 (page 8) takes 20% of Grace's own sum insured of S$600,000, a conditional illustration of S$120,000. The Product Summary describes itself as a summary and says the precise terms are in the certificate; the certificate says it is not a contract of insurance; neither document says whether one replaces the other. These are illustrations, not a payment. Fractures of the thumb, finger or palm are not covered by the summary's table.";
ok("K3 good passes", grade(B("K3", alt3, alt3 + " You said it was confirmed by X-ray and certified by a registered medical practitioner; that is your report and changes no amount. Contact the insurer to ask which applies.")).verdict === "PASS", failedIds(B("K3", alt3, alt3 + " You said it was confirmed by X-ray; that is your report and changes no amount. Contact the insurer.")).join());
ok("K3 total fails K3a.3", failedIds(B("K3", alt3 + " Together S$121,250.", alt3)).includes("K3a.3"));
ok("K3 one figure only fails K3a.2", failedIds(B("K3", alt3.replace(/S\$120,000/g, "a figure"), alt3)).includes("K3a.2"));
ok("K3 'certificate prevails' fails K3a.6", failedIds(B("K3", alt3 + " The certificate prevails.", alt3)).includes("K3a.6"));
ok("K3 X-ray question fails X.1", failedIds(B("K3", [alt3, ["Was the fracture confirmed by X-ray?"]], alt3)).includes("X.1"));
ok("K3 X-ray required fails X.1", failedIds(B("K3", alt3 + " The insurer requires an X-ray before it pays.", alt3)).includes("X.1"));
ok("K3 'withheld' notice fails V0", failedIds(B("K3", alt3 + " I have withheld an amount until claim evidence is reviewed.", alt3)).includes("V0"));
ok("K3 no bases fails K3a.4", failedIds(B("K3", alt3.replace(/fixed S\$5,000 limit/, "S$5,000").replace(/sum insured/g, "cover"), alt3)).includes("K3a.4"));

// ---- K4a
const leg = "I've noted the correction to her leg. The two documents give two alternatives for a leg fracture, and they do not say which applies; they are never added. If the break is covered, the Product Summary takes 50% of the fixed S$5,000 limit, S$2,500; the certificate highlights take 50% of her sum insured of S$600,000, S$300,000. The separate benefit for a fractured leg with established non-union is a different benefit. These are illustrations, not a payment.";
ok("K4a good passes", grade(B("K4a", leg)).verdict === "PASS", failedIds(B("K4a", leg)).join());
ok("K4a S$120,000 as the leg amount fails K4a.4", failedIds(B("K4a", leg + " A leg fracture is S$120,000.")).includes("K4a.4"));
ok("K4a arm figure still current fails K4a.3", failedIds(B("K4a", leg + " That gives S$1,250 for her.")).includes("K4a.3"));
ok("K4a arm figure named as the earlier arm figure passes K4a.3", !failedIds(B("K4a", leg + " The earlier arm figure of S$1,250 no longer applies.")).includes("K4a.3"));
ok("K4a total fails K4a.5", failedIds(B("K4a", leg + " Together S$302,500.")).includes("K4a.5"));

// ---- K4b
const dan = "Understood, this is about Daniel, not Grace. His documents give two alternatives and do not say which applies; they are never added. If the fall caused a covered fracture, the Product Summary takes 25% of the fixed S$5,000 limit, S$1,250; the certificate highlights take 20% of Daniel's own sum insured of S$600,000, S$120,000. The summary says the precise terms are in the certificate; the certificate says it is not a contract of insurance; neither says which applies. These are illustrations, not a payment.";
ok("K4b good passes", grade(B("K4b", dan)).verdict === "PASS", failedIds(B("K4b", dan)).join());
ok("K4b Grace as the injured person fails K4b.9", failedIds(B("K4b", dan + " Grace's cover would pay it.")).includes("K4b.9"));

// ---- K6a
const lc = "Grace is insured under Group Living Care with a sum of S$350,000 as of 06/10/2022. The pages available do not describe what that cover pays or on what conditions, so whether a cancer diagnosis qualifies is not established. You could ask the insurer for the Group Living Care terms.";
ok("K6a good passes", grade(B("K6a", lc)).verdict === "PASS", failedIds(B("K6a", lc)).join());
ok("K6a 'cancer pays S$350,000' fails K6a.3", failedIds(B("K6a", lc + " A cancer diagnosis pays S$350,000.")).includes("K6a.3"));
ok("K6a sum S$650,000 fails K6a.4", failedIds(B("K6a", lc + " Combined with Living Care Plus that is S$650,000.")).includes("K6a.4"));
ok("K6a invented waiting period fails K6a.5", failedIds(B("K6a", lc + " There is a 90-day waiting period.")).includes("K6a.5"));

// ---- K6b
const dent = "The documents available show no dental benefit under Grace's Group Personal Accident cover. The pages are selected, so I can't tell whether an accident-related tooth injury is covered; you could ask the insurer.";
ok("K6b good passes", grade(B("K6b", dent)).verdict === "PASS", failedIds(B("K6b", dent)).join());
ok("K6b 'dental is excluded' fails K6b.2", failedIds(B("K6b", "Dental treatment is excluded from Grace's cover.")).includes("K6b.2"));
ok("K6b jaw fracture as dental fails K6b.3", failedIds(B("K6b", dent + " A jaw fracture pays S$300,000 as dental cover.")).includes("K6b.3"));
ok("K6b nothing said about the documents fails K6b.1", failedIds(B("K6b", "Yes, dental is covered up to S$500.")).includes("K6b.1"));

// ---- incomplete
ok("a missing turn is INCOMPLETE, never PASS", grade(B("K3", alt3)).verdict === "INCOMPLETE");
ok("a transport error is INCOMPLETE", grade({ case: "K1", arm: "B", turns: [{ ...turn(K1good), error: "model service returned an error (401)" }] }).verdict === "INCOMPLETE");

// ---- arm A: structure checks
const aTurn = (text: string, extra: Partial<Turn> = {}): Turn => ({ ...turn(text), answer: { calculations: [], citations: [] }, trace: { dropped: [], gate: [], incomplete: [] }, shown: text, saved: text, reopened: text, pages: ["CERT:1"], ...extra });
const A1 = grade({ case: "K1", arm: "A", turns: [aTurn(K1good, { answer: { calculations: [], citations: [{ pageStart: 1, policyName: "Certificate", excerpt: "S$600,000 As of 06/10/2022" }] } })] });
ok("arm A K1 with the certificate cited passes", A1.verdict === "PASS", A1.checks.filter((c) => !c.ok).map((c) => c.id + " " + c.detail).join("\n"));
ok("arm A: returned != saved fails S0", grade({ case: "K1", arm: "A", turns: [aTurn(K1good, { reopened: "different" })] }).checks.some((c) => c.id === "S0" && !c.ok));
ok("arm A: a dropped statement fails V0", grade({ case: "K1", arm: "A", turns: [aTurn(K1good, { trace: { dropped: [{ sentence: "x", reason: "y" }], gate: [], incomplete: [] } })] }).checks.some((c) => c.id === "V0" && !c.ok));
ok("arm A: retrieval of the certificate is required", grade({ case: "K1", arm: "A", turns: [aTurn(K1good, { pages: ["PS:13"] })] }).checks.some((c) => c.id === "K1.R" && !c.ok));
ok("arm B has no S / R checks", grade(B("K1", K1good)).checks.every((c) => c.stage !== "S" && c.stage !== "R"));
ok("a leaked identifier fails G4", failedIds(B("K1", K1good + " (benefit_id b4)")).includes("G4"));
ok("a real insurer name fails G2", failedIds(B("K1", K1good + " Contact Singapore Life.")).includes("G2"));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
