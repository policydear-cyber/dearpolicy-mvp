/**
 * Live-model smoke: the six conversations and their SOURCE-GROUNDED expected behaviour. The user turns are what a
 * household member types; nothing here tells the model what to do -- the model chooses its own tools and words through
 * the real application path (scripts/rag2-live/run.ts). Data: the synthetic household Lim
 * (scripts/fixtures/rag2-live/household.ts). Every expected figure is printed in a stored page (the `passages` below,
 * verbatim) or is a deterministic calculation over printed figures and the household's own facts (`calculation`).
 * Graded by scripts/rag2-live/check.ts (deterministic; no AI judge).
 */
import type { DocKey, MemberKey } from "../fixtures/rag2-live/household";

/** A passage the answer must rest on: the document, the stored page and a verbatim substring of that page. */
export type Passage = { doc: DocKey; page: number; text: string };
/** A figure that must not be stated -- unless the sentence that states it also matches `unless` (e.g. "was"/"before"). */
export type Stage = "document extraction" | "retrieval" | "person-version resolution" | "model reasoning-tool selection" | "calculation" | "verification" | "presentation";
export const STAGES: Stage[] = ["document extraction", "retrieval", "person-version resolution", "model reasoning-tool selection", "calculation", "verification", "presentation"];
export type Forbidden = { figure: string; why: string; unless?: string; stage?: Stage };
export type ExpectedCalc = {
  calculator: "hospital_cash" | "bill_reimbursement" | "lump_sum";
  kind: "indicative_estimate" | "conditional_illustration";
  /** The deterministic calculation, written out with its operands. */
  formula: string;
  operands: { label: string; value: number | string; source: "document" | "household"; from: string }[];
  result: number;
};
export type TurnExpect = {
  /** Money figures that must be visible in the answer, e.g. "S$400". */
  figures?: string[];
  forbidden?: Forbidden[];
  /** No money figure at all may be visible in this turn. */
  noMoney?: boolean;
  /** No money figure in any sentence matching this (regex), e.g. an evacuation limit the documents never print. */
  noMoneyNear?: string;
  /** Every visible money figure must be printed somewhere in the household's stored pages (no invented figure). */
  onlyPrintedFigures?: boolean;
  /** The turn must ask this question (regex over the asked question text). */
  asks?: { pattern: string; about: string };
  /** The turn must NOT ask a question matching this (a re-ask of a fact the household already gave). */
  mustNotAsk?: { pattern: string; about: string };
  /** The turn must ask no question at all (it has every fact it needs). */
  noQuestion?: boolean;
  /** Visible text must match (regex), e.g. the plain "the documents do not say". */
  says?: { pattern: string; about: string }[];
  /** Who the conversation / claim is about after this turn (state.ragLoop.subjectId). */
  subject?: MemberKey;
  /** The saved figure binding(s) must be for this person, this document and this column. */
  binding?: { member: MemberKey; doc: DocKey; column?: string; value: number };
  /** Citations the answer must carry (policy + page; the cited excerpt or the evidence passage contains `text`). */
  passages?: Passage[];
  /** No citation may point at these documents (a wrong person's policy, a superseded figure's document). */
  notCiting?: DocKey[];
  /** A saved CalculationRecord with this calculator and result, which must recompute. */
  calculation?: ExpectedCalc;
  /** Facts that must NOT be recorded in the conversation state (a conclusion the household never stated). */
  factNotRecorded?: { key: string; value: string; why: string }[];
  /** A fact that must be recorded, in the household's own words. */
  factRecorded?: { keyPattern: string; wordsInclude: string };
  /** The pending claim question must be put back after a side question. */
  pendingReasked?: { pattern: string };
};
export type ScenarioTurn = { user: string; expect: TurnExpect };
export type Scenario = { id: string; title: string; why: string; turns: ScenarioTurn[] };

// Verbatim passages (check.ts verifies each is a substring of the stored page before grading).
const P = {
  icuRow: { doc: "CAREDAY", page: 1, text: "ICU cash (each complete 24 hours, max 30 per year)" },
  hcRow: { doc: "CAREDAY", page: 1, text: "Hospital cash (each complete 24 hours, max 90 per year)" },
  hc24h: { doc: "CAREDAY", page: 2, text: "Hospital cash is payable for each complete period of 24 hours that the Insured Person is confined in hospital as an inpatient, counted from the time of admission." },
  dentalRow: { doc: "SUNHAVEN", page: 1, text: "Accidental dental treatment (per accident)" },
  fractureRow: { doc: "SUNHAVEN", page: 1, text: "Fracture benefit (per fracture)" },
  accidentOnly: { doc: "SUNHAVEN", page: 2, text: "This policy covers Bodily Injury caused solely and directly by an Accident." },
  deductible: { doc: "KESTREL", page: 1, text: "Deductible (per policy year, private hospital)\tS$3,500" },
  endtLimit: { doc: "KESTREL_ENDT", page: 1, text: "Annual claim limit\tS$1,000,000\tS$1,500,000" },
} satisfies Record<string, Passage>;

const QUESTION_CAUSE = "how (did )?(it|this|the injury|kai|he) (happen|break|get)|how .*(happen|injur|broke)|accident|illness|fall|fell";

export const SCENARIOS: Scenario[] = [
  {
    id: "L1", title: "Direct factual question",
    why: "One printed figure in the right person's column, cited.",
    turns: [{
      user: "How much ICU cash does the CareDay plan pay for Grace?",
      expect: {
        figures: ["S$200"],
        forbidden: [{ figure: "S$120", why: "the Insured Child column, not Grace's", stage: "person-version resolution" }],
        subject: "grace", binding: { member: "grace", doc: "CAREDAY", column: "Insured Adult", value: 200 },
        passages: [P.icuRow], onlyPrintedFigures: true, noQuestion: true,
      },
    }],
  },
  {
    id: "L2", title: "Adult / Child table, then a person correction",
    why: "The Child column for Kai; after 'I meant Grace' the Adult column, and the subject moves to Grace.",
    turns: [
      {
        user: "What does our SunHaven plan pay for accidental dental treatment for Kai?",
        expect: {
          figures: ["S$400"], forbidden: [{ figure: "S$800", why: "the Adult column, not Kai's", stage: "person-version resolution" }],
          subject: "kai", binding: { member: "kai", doc: "SUNHAVEN", column: "Child", value: 400 }, passages: [P.dentalRow], onlyPrintedFigures: true,
        },
      },
      {
        user: "Sorry, I meant Grace, not Kai.",
        expect: {
          figures: ["S$800"], forbidden: [{ figure: "S$400", why: "Kai's (Child) figure given as Grace's", unless: "\\bKai\\b|\\bchild\\b", stage: "person-version resolution" }],
          subject: "grace", binding: { member: "grace", doc: "SUNHAVEN", column: "Adult", value: 800 }, passages: [P.dentalRow], onlyPrintedFigures: true,
        },
      },
    ],
  },
  {
    id: "L3", title: "Broken arm: cause decides cover; side question about the speaker; back to the pending question",
    why: "The plan covers injury caused by an Accident only, so how it happened must be asked before any figure; a side question about Daniel's own Shield deductible is answered without moving the claim off Kai, and the cause question is put back; the answer then gives the Child fracture figure.",
    turns: [
      {
        user: "Kai broke his arm yesterday. Can we claim for it?",
        expect: {
          noMoney: true, asks: { pattern: QUESTION_CAUSE, about: "how the arm was broken (accident or not)" }, passages: [P.accidentOnly],
          subject: "kai", factNotRecorded: [{ key: "cause", value: "accident", why: "the household has not said how it happened" }],
        },
      },
      {
        user: "Before that, quick question: what is my deductible on my KestrelShield plan?",
        expect: {
          figures: ["S$3,500"], passages: [P.deductible], onlyPrintedFigures: true,
          subject: "kai", pendingReasked: { pattern: QUESTION_CAUSE },
          forbidden: [{ figure: "S$750", why: "no fracture figure before the cause is known" }, { figure: "S$1,200", why: "not Kai's column; and the cause is not known yet" }],
        },
      },
      {
        user: "He fell off his bicycle at the park.",
        expect: {
          figures: ["S$750"], forbidden: [{ figure: "S$1,200", why: "the Adult column, not Kai's", stage: "person-version resolution" }],
          subject: "kai", binding: { member: "kai", doc: "SUNHAVEN", column: "Child", value: 750 }, passages: [P.fractureRow], onlyPrintedFigures: true,
          factRecorded: { keyPattern: "how|cause|happen", wordsInclude: "fell off his bicycle" },
          mustNotAsk: { pattern: "how (did|was|it)|what happened", about: "re-asking how it happened" },
        },
      },
    ],
  },
  {
    id: "L4", title: "Hospital cash: admission and discharge dates and times in one message",
    why: "Every input is in the message: 2 complete periods of 24 hours (3 Sep 22:15 to 6 Sep 09:30 = 59 h 15 min) x S$60 (Insured Child) = S$120. The dates and times must not be asked again.",
    turns: [{
      user: "Mei was admitted to hospital on 3 Sep 2026 at 10:15 pm and discharged on 6 Sep 2026 at 9:30 am. How much hospital cash can we claim from CareDay?",
      expect: {
        figures: ["S$120"],
        forbidden: [
          { figure: "S$180", why: "3 nights / 3 days x S$60: not complete 24-hour periods", stage: "calculation" },
          { figure: "S$240", why: "4 calendar days x S$60", stage: "calculation" },
          { figure: "S$200", why: "2 x the Insured Adult rate", stage: "person-version resolution" },
          { figure: "S$300", why: "3 x the Insured Adult rate", stage: "person-version resolution" },
        ],
        subject: "mei", passages: [P.hcRow, P.hc24h],
        mustNotAsk: { pattern: "admi|discharg|date|time|when", about: "the admission / discharge dates and times already given" },
        calculation: {
          calculator: "hospital_cash", kind: "indicative_estimate",
          formula: "floor((2026-09-06T09:30 - 2026-09-03T22:15) / 24 h) = floor(59.25 h / 24 h) = 2 complete periods; 2 x S$60 = S$120",
          operands: [
            { label: "Hospital cash, Insured Child", value: 60, source: "document", from: "CAREDAY p1, Hospital cash row, Insured Child column" },
            { label: "admission", value: "2026-09-03T22:15", source: "household", from: "3 Sep 2026 at 10:15 pm" },
            { label: "discharge", value: "2026-09-06T09:30", source: "household", from: "6 Sep 2026 at 9:30 am" },
          ],
          result: 120,
        },
      },
    }],
  },
  {
    id: "L5", title: "An endorsement changes a limit",
    why: "The schedule prints an annual claim limit of S$1,000,000; Endorsement No. 1 (effective 01 Jul 2026) amends it to S$1,500,000. The answer must give the endorsed figure and cite the endorsement.",
    turns: [{
      user: "What is the annual claim limit on my KestrelShield plan now?",
      expect: {
        figures: ["S$1,500,000"],
        forbidden: [{ figure: "S$1,000,000", why: "the superseded schedule figure given as the current limit", unless: "\\b(was|were|before|previous(ly)?|original(ly)?|earlier|replac|amend|increas|raised|from S\\$1,000,000)", stage: "person-version resolution" }],
        subject: "daniel", binding: { member: "daniel", doc: "KESTREL_ENDT", value: 1500000 }, passages: [P.endtLimit], onlyPrintedFigures: true, noQuestion: true,
      },
    }],
  },
  {
    id: "L6", title: "A question the documents do not answer",
    why: "SunHaven covers accidents anywhere in the world but prints no evacuation benefit and no evacuation limit: the answer must say the documents do not say, and give no evacuation figure.",
    turns: [{
      user: "If one of us is injured overseas, does SunHaven pay for emergency medical evacuation, and up to how much?",
      expect: {
        noMoneyNear: "evacuat", onlyPrintedFigures: true, noQuestion: true,
        says: [{ pattern: "(do(es)?n['’]?t|do(es)? not|no(t)?|couldn['’]?t|could not|cannot|can['’]?t)\\b[^.]{0,80}\\b(say|mention|state|show|list|include|find|cover|print|set out|specify)|not (stated|mentioned|listed|shown|included|specified)|no (evacuation|mention|benefit|limit)|nothing (about|on)", about: "the documents do not say" }],
      },
    }],
  },
];
