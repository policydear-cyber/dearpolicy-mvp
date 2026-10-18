/**
 * PR #47 actual-model reproduction: the SAME synthetic household and documents the scenario-completion suite uses
 * (scripts/fixtures/rag2-scenario/household.ts), seeded into the LOCAL PostgreSQL for the live harness
 * (scripts/rag2-live/run.ts with RAG2_LIVE_HOUSEHOLD=scenario). The six user turns are fixed; nothing tells the model
 * which tools to call or what to say. Expectations are graded afterwards by scripts/rag2-live/scenario-check.ts,
 * which was written before the run.
 *
 * Dates: the reported stay (9pm 3 Oct 2026 -> 11am 5 Oct 2026, 38 hours) is after the certificate's printed "As of"
 * date (1 July 2025, effective 2025-07-01) and the wording prints no end date or expiry, so no documented period
 * excludes it; the dates are kept as given. (The certificate is still only the amount as of 1 July 2025, not proof
 * of cover in October 2026 -- the grader checks the answer says so.)
 */
import { pool } from "@/lib/db/client";
import { pseudonymizeId } from "@/lib/telemetry/pseudonymize";
import { assertLocalDatabase } from "../../e2e/support/seed-rag2-live";
import * as SCENARIO from "../fixtures/rag2-scenario/household";
import * as STRESS from "../fixtures/rag2-stress/household";
import * as BINDING from "../fixtures/rag2-binding/household";
import * as LIVELIB from "../fixtures/rag2-livelib/household";
import * as PR50 from "../fixtures/rag2-pr50/household";
import * as TAN from "../fixtures/reliable-chat/tan";
import * as BOOKLET from "../fixtures/reliable-chat/booklet";
import * as ACTUAL from "../fixtures/reliable-chat/actual-lib";
import * as DJR from "../fixtures/reliable-chat/death-journey-actual-values";
import type { Scenario } from "./scenarios";

export const SCENARIO_ACCOUNT = SCENARIO.ACCOUNT;
export const STRESS_ACCOUNT = STRESS.ACCOUNT;
export const BINDING_ACCOUNT = BINDING.ACCOUNT;
export const LIVELIB_ACCOUNT = LIVELIB.ACCOUNT;
export const PR50_ACCOUNT = PR50.ACCOUNT;
export const TAN_ACCOUNT = TAN.ACCOUNT;
export const BOOKLET_ACCOUNT = BOOKLET.ACCOUNT;
export const ACTUAL_ACCOUNT = ACTUAL.ACCOUNT;
export const DEATH_ACCOUNT = DJR.ACCOUNT;
export const S47: Scenario = { id: "S47", title: "PR #47 reported broken-leg conversation, extended to the bone, the fracture type and the stay times", why: "actual-model reproduction of the reported conversation", turns: [
  "Desmond broke his leg.",
  "He fell down the stairs.",
  "Yes, confirmed with an X-ray. He was also warded for two nights.",
  "Transverse fracture.",
  "The tibia. It was a closed fracture.",
  "Admitted at 9pm on 3 October 2026 and discharged at 11am on 5 October 2026.",
].map((user) => ({ user, expect: {} })) };

/** V1.3 actual-model sample on the stress-test structures (scripts/fixtures/rag2-stress/household.ts): inventory, the
 * Personal Accident amount, a wrong amount, a Simple Fracture on its fixed limit, a stay that does not reach the
 * waiting period, and an unknown member. Fixed turns; graded afterwards by scripts/rag2-live/stress-check.ts. */
export const S48: Scenario = { id: "S48", title: "V1.3 stress-test structures (anonymised): inventory, PA amount, wrong amount, Simple Fracture base, waiting period, unknown member", why: "actual-model sample of the 14 October stress-test structures", turns: [
  "What policies does my family have?",
  "How much is my personal accident cover?",
  "My personal accident cover is S$400,000, right?",
  "I fractured my leg, the tibia, when I fell down the stairs. It's a simple fracture and the X-ray confirmed it. How much can I claim?",
  "I was also in hospital for 48 hours: admitted 5 October 2026 at 10am, discharged 7 October 2026 at 10am. Does the Daily Hospital Income pay anything?",
  "What cover does Bob have?",
].map((user) => ({ user, expect: {} })) };

/** V1.4 actual-model sample on the person / product / benefit binding structures (scripts/fixtures/rag2-binding):
 * the reported death question (then the accident date), and a paraphrase in its own conversation. Fixed turns; graded
 * afterwards by scripts/rag2-live/binding-check.ts (written before the run). */
export const S49: Scenario = { id: "S49", title: "V1.4 reported scenario: a member's death after a car accident abroad, then the accident date", why: "actual-model sample of the post-PR #48 binding failure", turns: [
  "Darren died in a car accident in Japan, what can I do?",
  "The accident happened on 3 October 2026.",
].map((user) => ({ user, expect: {} })) };
export const S49B: Scenario = { id: "S49B", title: "V1.4 paraphrase: the same event in other words", why: "paraphrase of the reported scenario", turns: [
  "Darren passed away after a traffic accident while travelling in Japan. What insurance can we claim for him?",
].map((user) => ({ user, expect: {} })) };

/** V1.4 (cell-per-line layout): the reported question, then both dates, on the binding household whose certificate
 * text layer is one cell per line (RAG2_LIVE_HOUSEHOLD=binding-cells; scripts/fixtures/rag2-binding certLayout("cells")).
 * Graded by scripts/rag2-live/binding-check.ts version 3 (written before the run). */
export const S50: Scenario = { id: "S50", title: "V1.4 cell-per-line certificate: a member's death after a car accident abroad, then both dates", why: "actual-model sample of the one-cell-per-line roster reconstruction", turns: [
  "Darren died in a car accident in Japan, what can I do?",
  "The accident happened on 3 October 2026 and he died on 5 October 2026.",
].map((user) => ({ user, expect: {} })) };
/** The binding household with the certificate's text layer one cell per line (same people, products and amounts). */
export const BINDING_CELLS = { ...BINDING, DOCS: BINDING.DOCS.map((d) => (d.key === "CERT" ? { ...d, hash: "sha256:binding-cert-cells", pages: BINDING.certLayout("cells") } : d)) };

/** V1.5: the live verification report's six turns in its four conversations, on the live-library household
 * (scripts/fixtures/rag2-livelib; RAG2_LIVE_HOUSEHOLD=livelib). Pre-registered before s52-live-1; graded by
 * scripts/rag2-live/livelib-check.ts. The death conversation is explicitly hypothetical, as in the report. */
export const S52A: Scenario = { id: "S52A", title: "V1.5 report turns 1-2: hypothetical death in a car accident in Japan, then both dates", why: "live verification turns 1-2", turns: [
  "Hypothetically, Adrian died in a car accident in Japan. What can I do?",
  "Hypothetically, the accident happened on 3 October 2026 and Adrian died on 5 October 2026. Please explain the benefits and the next steps.",
].map((user) => ({ user, expect: {} })) };
export const S52B: Scenario = { id: "S52B", title: "V1.5 report turns 3-4: direct amounts and certificate date, then switch person and challenge a wrong PA amount", why: "live verification turns 3-4", turns: [
  "What are Adrian's Term Life and Personal Accident amounts, and what date is the certificate?",
  "And Cheryl? Her Personal Accident cover is S$1,000,000, right?",
].map((user) => ({ user, expect: {} })) };
export const S52C: Scenario = { id: "S52C", title: "V1.5 report turn 5: library inventory including unreadable files", why: "live verification turn 5", turns: [
  "List all our uploaded documents and their roles, including any files that could not be read.",
].map((user) => ({ user, expect: {} })) };
export const S52D: Scenario = { id: "S52D", title: "V1.5 report turn 6: conditional Simple Fracture arithmetic and Other Fracture", why: "live verification turn 6", turns: [
  "Hypothetically, if Adrian had a simple (closed) fracture of the leg, what would the Simple Fracture benefit be? How is that different from Other Fracture?",
].map((user) => ({ user, expect: {} })) };

/** V1.5 (PR #51): the three prompts of the live verification after PR #50 that failed, on the anonymised PR #50
 * household (scripts/fixtures/rag2-pr50; RAG2_LIVE_HOUSEHOLD=pr50, PR50_NAMES=snake, page 13 as stored with tabs).
 * Pre-registered in docs/rag-migration/v15/EXPECTED-pr50-live-1.md; graded by scripts/rag2-live/pr50-check.ts. */
export const P50C: Scenario = { id: "P50C", title: "PR #50 report C: full document inventory by person, insurer and product, including unreadable files", why: "live verification after PR #50, conversation C", turns: [
  "What policies does my family have? List my uploaded documents by person, insurer and product. Distinguish personal certificates from reference wording and unreadable files.",
].map((user) => ({ user, expect: {} })) };
export const P50D: Scenario = { id: "P50D", title: "PR #50 report D: fixed-limit Simple Fracture illustration (50% x S$5,000)", why: "live verification after PR #50, conversation D", turns: [
  "Hypothetical document-arithmetic test for Adrian: in the uploaded Summary of Benefits, Simple Fracture has a S$5,000 limit and a Leg row of 50%. If that provision applies, what is the illustration? Distinguish this from the separate Other Fracture provision and do not promise a payment.",
].map((user) => ({ user, expect: {} })) };
export const P50A: Scenario = { id: "P50A", title: "PR #50 report A: hypothetical death with both dates -- which death benefits may apply and the next steps", why: "live verification after PR #50, conversation A (both turns in one message, to stay within the cap)", turns: [
  "Hypothetical test: Adrian died in a car accident in Japan. The accident happened on 3 October 2026 and he died on 5 October 2026. Based on my uploaded documents, explain which death benefits may apply and what I should do next.",
].map((user) => ({ user, expect: {} })) };

/** Reliable chat: the pre-registered real-model batch rc-live-1 (docs/rag-migration/reliable-chat/EXPECTED-rc-live-1.md;
 * graded by scripts/rag2-live/reliable-chat-check.ts, written before the run). Fresh wording, not the scripted tests'.
 * Household Tan (RAG2_LIVE_HOUSEHOLD=tan): the complete conversation, twice (RCT1a / RCT1b, identical turns).
 * Household Wong (RAG2_LIVE_HOUSEHOLD=pr50): the fixed-limit fracture twice (RCW1a / RCW1b), death next steps (RCW2) and
 * the claim-selection question (RCW3). */
const RCT1_TURNS = [
  "My son Jun fractured his leg at football training. What could his personal accident policy pay?",
  "The doctor said it was the shin bone.",
  "Sorry, I got that wrong - the X-ray shows it was his thigh bone.",
];
export const RCT1a: Scenario = { id: "RCT1a", title: "reliable chat: benefit -> terms -> question -> server evaluation -> correction (Tan, attempt 1)", why: "rc-live-1 critical slice", turns: RCT1_TURNS.map((user) => ({ user, expect: {} })) };
export const RCT1b: Scenario = { ...RCT1a, id: "RCT1b", title: "reliable chat: the same conversation, attempt 2" };
const RCW1_TURN = "Adrian broke his leg in a fall - a closed fracture, no surgery. Under the Simple Fracture provision of his accident cover, what illustration do the documents give? Don't promise a payment.";
export const RCW1a: Scenario = { id: "RCW1a", title: "reliable chat: fixed-limit Simple Fracture, fresh wording (Wong, attempt 1)", why: "rc-live-1 recorded failure 1/2 regression", turns: [{ user: RCW1_TURN, expect: {} }] };
export const RCW1b: Scenario = { ...RCW1a, id: "RCW1b", title: "reliable chat: fixed-limit Simple Fracture, attempt 2" };
export const RCW2: Scenario = { id: "RCW2", title: "reliable chat: death after an accident overseas -- benefits that may apply and what to do first (Wong)", why: "rc-live-1 recorded failure 3 regression", turns: [{ user: "Hypothetically, Adrian was killed in a road accident in Malaysia on 3 October 2026. Which of his benefits may apply, and what should I do first?", expect: {} }] };
export const RCW3: Scenario = { id: "RCW3", title: "reliable chat: which uploaded policies to claim under (Wong)", why: "rc-live-1 recorded failure 4 regression", turns: [{ user: "Which of my uploaded policies should I claim under for Adrian's broken wrist from a cycling accident?", expect: {} }] };
/** rc-live-2 (docs/rag-migration/reliable-chat/EXPECTED-rc-live-2.md): the two critical fracture journeys, each twice,
 * in rc-live-1's exact wording (so the fixed failures are tested directly), and one control combining an unlisted case
 * (a wrist, which neither stored fracture table lists) with the reference-insurer question (the Simple Fracture terms are
 * in the KestrelOne-branded summary; the claim belongs to Kestrel Life Ltd's certificate). */
export const RCT2a: Scenario = { ...RCT1a, id: "RCT2a", title: "rc-live-2: the complete Tan conversation, attempt 1", why: "rc-live-2 critical slice" };
export const RCT2b: Scenario = { ...RCT1a, id: "RCT2b", title: "rc-live-2: the complete Tan conversation, attempt 2", why: "rc-live-2 critical slice" };
export const RCW4a: Scenario = { ...RCW1a, id: "RCW4a", title: "rc-live-2: fixed-limit Simple Fracture, attempt 1", why: "rc-live-2 critical slice" };
export const RCW4b: Scenario = { ...RCW1a, id: "RCW4b", title: "rc-live-2: fixed-limit Simple Fracture, attempt 2", why: "rc-live-2 critical slice" };
export const RCX: Scenario = { id: "RCX", title: "rc-live-2 control: an unlisted case (a wrist) and who to contact", why: "rc-live-2 unlisted-case + reference-insurer control", turns: [{ user: "Adrian fractured his wrist falling off his bicycle. What can we claim for it from his accident cover, and who should I contact?", expect: {} }] };
export const RC_TAN = [RCT1a, RCT1b, RCT2a, RCT2b];
export const RC_WONG = [RCW1a, RCW1b, RCW2, RCW3, RCW4a, RCW4b, RCX];
/** rc-live-5 (actual-library repairs; docs/rag-migration/reliable-chat/EXPECTED-rc-live-5.md): the anonymised booklet
 * household (RAG2_LIVE_HOUSEHOLD=booklet). Fresh wording, not the scripted tests'. BKL1 (twice): an uncertain hip / tibia
 * case -> one clarification -> the Simple Fracture illustration; BKL2: Other Fracture on the Personal Accident sum
 * insured printed in a generic booklet; BKL3: the Compassionate Death Allowance Benefit (heading + wrapped paragraph,
 * bare $). */
const BKL1_TURNS = [
  "Daniel slipped in the bathroom and broke a bone. The doctor thinks it is his hip but it could be his tibia; they are still checking. It is a closed fracture. What could his accident cover pay?",
  "Update: the X-ray confirms it is his hip.",
];
export const BKL1a: Scenario = { id: "BKL1a", title: "rc-live-5: uncertain hip / tibia -> one clarification -> illustration (attempt 1)", why: "actual-library finding 1", turns: BKL1_TURNS.map((user) => ({ user, expect: {} })) };
export const BKL1b: Scenario = { ...BKL1a, id: "BKL1b", title: "rc-live-5: uncertain hip / tibia (attempt 2)" };
export const BKL2: Scenario = { id: "BKL2", title: "rc-live-5: Other Fracture on the Personal Accident sum insured in a generic booklet", why: "actual-library finding 2", turns: [{ user: "Daniel's hip fracture was an open (compound) fracture. What does the Other Fracture benefit work out to for him?", expect: {} }] };
export const BKL3: Scenario = { id: "BKL3", title: "rc-live-5: the Compassionate Death Allowance Benefit", why: "actual-library findings 3 and 4", turns: [{ user: "If Daniel died in an accident, is there an allowance for funeral expenses in our booklet, and what does it need?", expect: {} }] };
/** rc-live-6 (applicability follow-up; docs/rag-migration/reliable-chat/EXPECTED-rc-live-6.md, written before the run):
 * FL1a the rc-live-5 hip / tibia wording; FL1b a fresh paraphrase of it; FL2 closed -> corrected to open; FL3 the death
 * allowance in fresh wording. */
export const FL1a: Scenario = { ...BKL1a, id: "FL1a", title: "rc-live-6: uncertain hip / tibia (rc-live-5 wording) -> hip -> S$3,750 only", why: "applicability follow-up 1 and 2" };
export const FL1b: Scenario = { id: "FL1b", title: "rc-live-6: uncertain hip / shin bone (fresh paraphrase) -> hip -> S$3,750 only", why: "applicability follow-up 1 and 2", turns: [
  { user: "My husband Daniel tripped on the stairs at our flat last night. The hospital says it is a closed break - either his hip or his shin bone, the tibia; the scans are not back yet. What would his personal accident cover give him?", expect: {} },
  { user: "The specialist has just told us it is definitely the hip.", expect: {} }] };
export const FL2: Scenario = { id: "FL2", title: "rc-live-6: closed hip -> corrected to open: Simple Fracture withdrawn, Other Fracture evaluated", why: "applicability follow-up 1 (correction)", turns: [
  { user: "Daniel came off his bicycle and broke his hip. It was a closed fracture. What could his accident cover pay?", expect: {} },
  { user: "Sorry, I got that wrong - it was an open fracture; the bone came through the skin.", expect: {} }] };
export const FL3: Scenario = { id: "FL3", title: "rc-live-6: the death allowance -- supported terms, honest currency, dated certificate evidence", why: "applicability follow-up 3", turns: [
  { user: "If Daniel were killed in a road accident, would our booklet help with his funeral costs, and what would we need to send in?", expect: {} }] };
/** rc-live-7 (pre-registered in EXPECTED-rc-live-7.md): the death question over the booklet page faithful to the
 * RECORDED actual-library passage. Only listed when BOOKLET_CDA=recorded (and then alone), so FL4 can never run on
 * the synthetic page and FL1-FL3 never run on the recorded one. */
export const FL4: Scenario = { id: "FL4", title: "rc-live-7: the death allowance over the recorded passage -- printed conditions only, honest currency, dated certificate evidence", why: "recorded-passage evidence gap", turns: [
  { user: "If Daniel died in an accident, what would our booklet pay towards his funeral, and what documents would the insurer want from us?", expect: {} }] };
/** rc-live-8 (EXPECTED-rc-live-8.md): the same question on the repaired code, graded with v6 (FL4's v5 grade kept). */
export const FL4b: Scenario = { ...FL4, id: "FL4b", title: "rc-live-8: FL4's question on the repaired code -- allowance present, honest currency, no invented condition, Core / Voluntary vs certificate listing distinguished", why: "rc-live-7 repair check" };
/** rc-live-9 (EXPECTED-rc-live-9.md, grader v7): after the benefit-record repair (bullet / tab rows; heading-and-paragraph
 * benefits with a bare "$"), rc-live-8's real wording once more, and one fresh paraphrase written for this run. */
export const FL5a: Scenario = { ...FL4, id: "FL5a", title: "rc-live-9: the real-wording death question after the benefit-record repair -- the booklet's allowance offered and stated, honest currency, next step", why: "rc-live-8 repair check" };
export const FL5b: Scenario = { id: "FL5b", title: "rc-live-9: a fresh paraphrase of the death question", why: "rc-live-8 repair check (paraphrase)", turns: [
  { user: "Say Daniel passed away after an accident. Would the booklet cover any of the funeral costs, and how much? What proof would the insurer ask us for?", expect: {} }] };
export const RC_BOOKLET = process.env.BOOKLET_CDA === "recorded" ? [FL4, FL4b, FL5a, FL5b] : [BKL1a, BKL1b, BKL2, BKL3, FL1a, FL1b, FL2, FL3];

/** Structured-answers release (EXPECTED-structured-answers.md, grader v8 in structured-check.ts, written before any run):
 * the faithful actual-library household (RAG2_LIVE_HOUSEHOLD=actuallib). Fresh wording; SAa/SAb are two independent
 * attempts of the correction journey, SBa/SBb of the ambiguity journey; SAp/SBp are fresh paraphrases of each. */
const SA_TURNS = [
  "Daniel fell off a ladder at home and fractured his tibia. It's a closed fracture. What would his accident cover pay?",
  "Correction: it was his hip, not his tibia. Keep this as a hypothetical closed fracture.",
];
export const SAa: Scenario = { id: "SAa", title: "structured: closed tibia -> corrected to hip (attempt 1)", why: "release journey 1 and 2", turns: SA_TURNS.map((user) => ({ user, expect: {} })) };
export const SAb: Scenario = { ...SAa, id: "SAb", title: "structured: closed tibia -> corrected to hip (attempt 2)" };
export const SAp: Scenario = { id: "SAp", title: "structured: closed tibia -> corrected to hip (fresh paraphrase)", why: "release journey 1 and 2 (paraphrase)", turns: [
  { user: "My husband Daniel slipped on wet stairs at home and the doctor says he has a closed break of the shin bone. What could his personal accident cover pay out for that?", expect: {} },
  { user: "Sorry, I had that wrong - the break is in his hip, not his shin. Same closed fracture, still just asking what it could be worth.", expect: {} }] };
const SB_TURNS = [
  "Daniel fell and the doctor says he fractured his hip, or possibly his tibia - they are not sure yet. It is a closed fracture from an accident at home. What would his accident cover pay?",
  "The scan shows it is the tibia.",
];
export const SBa: Scenario = { id: "SBa", title: "structured: uncertain hip / tibia -> one question -> tibia (attempt 1)", why: "release journey 3", turns: SB_TURNS.map((user) => ({ user, expect: {} })) };
export const SBb: Scenario = { ...SBa, id: "SBb", title: "structured: uncertain hip / tibia -> one question -> tibia (attempt 2)" };
export const SBp: Scenario = { id: "SBp", title: "structured: uncertain hip / tibia (fresh paraphrase)", why: "release journey 3 (paraphrase)", turns: [
  { user: "Daniel hurt himself in a fall at home last night. The hospital thinks he broke either his hip or the lower leg bone, they are still waiting on scans, and it looks like a closed fracture. What would his accident insurance give him?", expect: {} },
  { user: "Update: it is definitely the lower leg, the tibia.", expect: {} }] };
export const SC: Scenario = { id: "SC", title: "structured: Simple versus Other Fracture comparison", why: "release journey 4", turns: [{ user: "Can you compare what the Simple Fracture benefit and the Other Fracture benefit would pay if Daniel broke his leg?", expect: {} }] };
export const SD: Scenario = { id: "SD", title: "structured: the death allowance", why: "release journey 5", turns: [{ user: "If Daniel died in an accident, what would our booklet pay towards his funeral, and what documents would the insurer want from us?", expect: {} }] };
export const SE: Scenario = { id: "SE", title: "structured: person switch to Grace", why: "release journey 6", turns: [
  { user: "Daniel fractured his tibia in an accident, a closed fracture. What would his accident cover pay?", expect: {} },
  { user: "And if Grace fractured her hip, what would the Simple Fracture benefit pay for her?", expect: {} }] };
/** SAq (after sa-live-2): SAp's wording said "My husband Daniel" while the fixture lists Daniel as the account holder ("self"), so the
 * app rightly asked who was meant and the paraphrase never tested the correction. SAq is the same paraphrase without that contradiction;
 * SAp stays in the record as run. */
export const SAq: Scenario = { id: "SAq", title: "structured: closed tibia -> corrected to hip (fresh paraphrase, consistent with the fixture)", why: "release journey 1 and 2 (paraphrase)", turns: [
  { user: "Daniel slipped on wet stairs at home and the doctor says he has a closed break of the shin bone. What could his personal accident cover pay out for that?", expect: {} },
  { user: "Sorry, I had that wrong - the break is in his hip, not his shin. Same closed fracture, still just asking what it could be worth.", expect: {} }] };
/** SAr (round 3, written before its first run): a held-back correction paraphrase -- different cause, bone and wording from SAa/SAb/SAq. */
export const SAr: Scenario = { id: "SAr", title: "structured: closed lower-leg break -> corrected to hip (held-back paraphrase)", why: "release journey 1 and 2 (round-3 paraphrase)", turns: [
  { user: "Daniel came off his bicycle this morning and the doctor says he has a closed break in his lower leg, the tibia. If we claimed on his accident cover, what could that be worth?", expect: {} },
  { user: "The doctor has corrected it: the break is actually at the hip, not the lower leg. Same closed fracture. What does that change?", expect: {} }] };
/** SAs (round 3, written before sa-live-5): a second held-back correction paraphrase -- different cause, wording and trigger; same bones, so the original grader applies. */
export const SAs: Scenario = { id: "SAs", title: "structured: broken shin bone -> corrected to hip (second held-back paraphrase)", why: "release journey 1 and 2 (round-3 paraphrase 2)", turns: [
  { user: "Daniel slipped on a wet floor in the kitchen and the hospital says his shin bone, the tibia, is broken cleanly - a closed fracture. If we made a claim under his accident insurance, roughly what would it be worth?", expect: {} },
  { user: "Sorry, the hospital rang back: it is the hip that is broken, not the shin bone. Still a closed fracture. What would it be worth now?", expect: {} }] };
/** SBc / SBd (round 4, written before sa-live-6): two held-back ambiguity paraphrases -- different cause, wording and trigger; the same bones as SBa/SBb
 * (hip or tibia unknown, then the tibia confirmed), so the original ambiguity grader applies and the round-4 completeness assessment (v9.1 K1-K3) is added. */
export const SBc: Scenario = { id: "SBc", title: "structured: hip or shin unknown -> one question -> tibia (held-back paraphrase 1)", why: "release journey 3 (round-4 paraphrase 1)", turns: [
  { user: "Daniel tripped on the kerb outside the house and the hospital thinks it is either his hip or his tibia that has cracked - they will know more after the scan. It looks like a closed fracture from an accident. What could his accident cover give him?", expect: {} },
  { user: "The scan is back: it is the tibia.", expect: {} }] };
export const SBd: Scenario = { id: "SBd", title: "structured: hip or lower leg unknown -> one question -> tibia (held-back paraphrase 2)", why: "release journey 3 (round-4 paraphrase 2)", turns: [
  { user: "Daniel slipped in the bathroom at home. The doctor suspects a fracture of the hip or possibly the tibia but is waiting for imaging. No open wound, so a closed fracture. What would his accident insurance pay for that?", expect: {} },
  { user: "Imaging confirms the tibia, not the hip.", expect: {} }] };
export const RC_ACTUAL = [SAa, SAb, SBa, SBb, SAp, SAq, SAr, SAs, SBp, SBc, SBd, SC, SD, SE];

/** Death-journey live batch (pre-registered in EXPECTED-death-journey.md, "Live batch addendum"): the household with the actual-library
 * certificate values (DJR). D1 and D2 are the same broad death question (two independent attempts), D3 a fresh paraphrase, F1 a
 * fracture-condition + comparison control. Wording is fixed here before any paid call. */
export const DJ_Q = "What happens if Daniel dies? What would the family receive from his insurance, and what should we do?";
export const DJ1: Scenario = { id: "D1", title: "death journey: broad death question (attempt 1)", why: "death-journey live batch", turns: [{ user: DJ_Q, expect: {} }] };
export const DJ2: Scenario = { ...DJ1, id: "D2", title: "death journey: broad death question (attempt 2)" };
export const DJ3: Scenario = { id: "D3", title: "death journey: fresh paraphrase", why: "death-journey live batch (paraphrase)", turns: [{ user: "My husband Daniel passed away in an accident last week. Which of our insurance covers pay anything, how much, and what do I need to do first?", expect: {} }] };
export const DJF1: Scenario = { id: "F1", title: "death journey: fracture condition and comparison control", why: "death-journey live batch (fracture control)", turns: [{ user: "If Daniel breaks his hip in an accident, what does the Simple Fracture benefit pay, what condition applies to it, and is it separate from the death benefits?", expect: {} }] };
/** Live batch 2 (dj-live-2, pre-registered in EXPECTED-death-journey.md, "Live batch 2 addendum"): the illness-applicability control. The household reports
 * a death by illness (and says it was not an accident); the accident-only benefits (Group Personal Accident, Accidental Death, the booklet's
 * Compassionate Death Allowance) must not be presented as potentially payable, and Term Life must be. Wording fixed before any paid call. */
export const DJI: Scenario = { id: "DI", title: "death journey: death by illness (applicability control)", why: "death-journey live batch 2 (cause / applicability)", turns: [{ user: "Daniel passed away last week after a long illness - it was not an accident. What would the family receive from his insurance, and what should we do?", expect: {} }] };
export const RC_DEATH = [DJ1, DJ2, DJ3, DJF1, DJI];

export async function seedScenario(which: "scenario" | "stress" | "binding" | "binding-cells" | "livelib" | "pr50" | "tan" | "booklet" | "actuallib" | "deathjourney" = "scenario"): Promise<void> {
  const { ACCOUNT, OTHER_ACCOUNT, DOCS, M } = (which === "stress" ? STRESS : which === "binding" ? BINDING : which === "binding-cells" ? BINDING_CELLS : which === "livelib" ? LIVELIB : which === "pr50" ? PR50 : which === "tan" ? TAN : which === "booklet" ? BOOKLET : which === "actuallib" ? ACTUAL : which === "deathjourney" ? DJR : SCENARIO) as unknown as typeof SCENARIO;
  assertLocalDatabase();
  for (const acct of [ACCOUNT, OTHER_ACCOUNT]) {
    await pool.query("DELETE FROM model_executions WHERE household_ref = $1", [pseudonymizeId(acct)]).catch(() => undefined);
    for (const t of ["chat_analysis_jobs", "chat_messages", "chat_conversations", "claim_sessions", "policy_pages", "policy_members", "policies", "family_members", "model_usage", "household_members"]) {
      await pool.query(`DELETE FROM ${t} WHERE ${t === "household_members" ? "household_id" : "account_id"} = $1::uuid`, [acct]).catch(() => undefined);
    }
    await pool.query("DELETE FROM accounts WHERE id = $1::uuid AND name LIKE 'SYNTHETIC-DPTEST-%'", [acct]);
  }
  await pool.query("INSERT INTO accounts(id,name) VALUES($1,$3),($2,$4)", [ACCOUNT, OTHER_ACCOUNT, which === "stress" ? "SYNTHETIC-DPTEST-stress Household Tan (Ivan)" : which.startsWith("binding") ? `SYNTHETIC-DPTEST-${which} Household Tan (Darren)` : which === "livelib" ? "SYNTHETIC-DPTEST-livelib Household Wong (Adrian)" : which === "pr50" ? "SYNTHETIC-DPTEST-pr50 Household Wong (Adrian)" : which === "tan" ? "SYNTHETIC-DPTEST-rc Household Tan (Mei Ling)" : which === "booklet" ? "SYNTHETIC-DPTEST-booklet Household Lee (Daniel)" : which === "actuallib" ? "SYNTHETIC-DPTEST-actuallib Household Lee (Daniel)" : which === "deathjourney" ? "SYNTHETIC-DPTEST-deathjourney Household Lee (Daniel)" : "SYNTHETIC-DPTEST-scenario Household Lim (Desmond)", `SYNTHETIC-DPTEST-${which} other household`]);
  await pool.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [ACCOUNT]).catch(() => undefined);
  for (const p of Object.values(M)) await pool.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship,notes,date_of_birth) VALUES($1,$2,$3,$4,$5,$6,$7)", [p.id, (p as { account?: string }).account ?? ACCOUNT, p.name, p.pref, p.rel, p.notes, p.dob]);
  for (const d of DOCS) {
    const acct = d.account ?? ACCOUNT;
    await pool.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,group_policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,superseded_at,file_hash,effective_date,renewal_or_expiry_date,document_date)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$17,$11,$11,'scan_clean',$18,$12,$13,$14,$15,$16)`,
      [d.id, acct, d.owner, d.insurer, d.product, d.policyNumber, d.groupPolicyNumber ?? null, d.policyType, d.role, d.personal, (d as { filename?: string }).filename ?? `synthetic-dptest-${which}-` + d.key.toLowerCase() + ".pdf", d.superseded ? new Date().toISOString() : null, d.hash, d.effective ?? null, d.expiry ?? null, d.documentDate ?? null, (d as { processing?: string }).processing ?? "ready", (d as { lifecycle?: string }).lifecycle ?? "active"]);
    if ((d as { processingError?: string }).processingError) await pool.query("UPDATE policies SET processing_error=$2 WHERE id=$1", [d.id, (d as { processingError?: string }).processingError]);
    for (const m of d.members) await pool.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence,benefit_tier) VALUES($1,$2,$3,'test',1,$4)", [d.id, m.id, acct, m.tier ?? null]);
    for (const [page, text] of Object.entries(d.pages)) await pool.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [acct, d.id, Number(page), text]);
  }
}
