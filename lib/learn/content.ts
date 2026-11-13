/**
 * DearPolicy's knowledge library: short, plain-English guides to how insurance works.
 *
 * GENERAL EDUCATION ONLY. Static text: nothing here reads a household's records, calls a model or costs anything.
 * Rules for every word in this file (checked by scripts/learn/learn-content-test.ts):
 * - Insurer-neutral and market-neutral: no insurer, product, scheme or country-specific programme is named.
 * - No currency: example figures are plain numbers and are labelled as examples, never as anyone's cover.
 * - Never says what a particular policy pays. A policy's own wording and the insurer decide; this text says so.
 * - Never contradicts a document: where policies differ, it says "many policies" or "check your policy", not "always".
 */

import { SINGAPORE_GUIDES } from "./singapore";
import { CLAIM_GUIDES } from "./claims";

/** Pictograms drawn in components/learn/pictogram.tsx (self-made SVG, no external images). */
export type LearnIcon =
  | "schedule" | "wording" | "rider" | "endorsement" | "illustration" | "renewal"
  | "life" | "illness" | "disability" | "hospital" | "accident" | "income" | "travel" | "home" | "motor" | "savings" | "investment" | "annuity"
  | "fixed" | "percent" | "daily" | "receipt"
  | "search" | "read" | "tell" | "approve" | "keep" | "decide"
  | "printed" | "scenario" | "insurer" | "person" | "source" | "conditions" | "question"
  | "shield" | "wash" | "dress" | "feed" | "toilet" | "walk" | "transfer" | "family";

/** A picture with a short label, used by tiles, steps and flows. All words live here so the content tests read them. */
export type LearnTile = { icon: LearnIcon; title: string; text: string };

/** Diagrams drawn in components/learn/blocks.tsx. */
export type LearnDiagram = "lowest-limit";

export type LearnBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "example"; text: string }
  /** A grid of pictures, each with a title and one line. */
  | { kind: "tiles"; caption: string; tiles: LearnTile[] }
  /** Numbered steps down a path. */
  | { kind: "steps"; caption: string; steps: LearnTile[] }
  /** A left-to-right (top-to-bottom on phones) chain, e.g. printed amount → illustration → decision. */
  | { kind: "flow"; caption: string; items: LearnTile[] }
  | { kind: "diagram"; diagram: LearnDiagram; caption: string }
  /** Stacked layers of cover, top layer first (e.g. a rider on a private plan on a basic national scheme). */
  | { kind: "layers"; caption: string; layers: LearnTile[] }
  /** A sourced fact in a country article: `source` indexes the guide's `sources`. Figures in country articles live only here or in a table. */
  | { kind: "fact"; text: string; source: number }
  /** A small sourced table in a country article. */
  | { kind: "table"; caption: string; head: string[]; rows: string[][]; source: number }
  /** Tap-to-reveal cards: a question or myth on the front, the answer behind it. */
  | { kind: "cards"; prompt: string; cards: Array<{ front: string; back: string }> }
  /** One multiple-choice question with an explanation. */
  | { kind: "quiz"; question: string; options: string[]; answer: number; explain: string }
  /** Try-it sliders with made-up numbers: how a deductible, a co-payment and a limit split a bill. */
  | { kind: "bill-split" }
  /** Try-it slider with made-up numbers: a percentage of a sum assured. */
  | { kind: "percent-of-sum" };

/** Every word a block shows, for the content checks. */
export function blockTexts(block: LearnBlock): string[] {
  switch (block.kind) {
    case "p": case "example": return [block.text];
    case "list": return block.items;
    case "tiles": return [block.caption, ...block.tiles.flatMap((t) => [t.title, t.text])];
    case "steps": return [block.caption, ...block.steps.flatMap((t) => [t.title, t.text])];
    case "flow": return [block.caption, ...block.items.flatMap((t) => [t.title, t.text])];
    case "diagram": return [block.caption];
    case "layers": return [block.caption, ...block.layers.flatMap((t) => [t.title, t.text])];
    case "fact": return [block.text];
    case "table": return [block.caption, ...block.head, ...block.rows.flat()];
    case "cards": return [block.prompt, ...block.cards.flatMap((c) => [c.front, c.back])];
    case "quiz": return [block.question, ...block.options, block.explain];
    case "bill-split": case "percent-of-sum": return [];
    default: { const unknown: never = block; throw new Error(`blockTexts: unknown block kind ${JSON.stringify(unknown)}`); }
  }
}

export type LearnSection = { heading: string; blocks: LearnBlock[] };

/** Library shelves, in the order the index shows them. */
export const LEARN_GROUPS = [
  { id: "start", title: "Start here", blurb: "What your documents are and the kinds of cover people hold." },
  { id: "singapore", title: "Singapore schemes", blurb: "National schemes for Singapore Citizens and Permanent Residents, from official sources." },
  { id: "amounts", title: "Amounts and claims", blurb: "How figures in a policy work, and the usual steps of a claim." },
  { id: "claims", title: "Claims by type", blurb: "What to check and do for hospital, clinic, accident, illness, death, disability, travel, home and motor claims." },
  { id: "dearpolicy", title: "Using DearPolicy", blurb: "How to read DearPolicy's answers, and the words policies use." },
] as const;
export type LearnGroupId = (typeof LEARN_GROUPS)[number]["id"];

/** An official page a country article relies on. Only government sites, or the insurer that runs a scheme. */
export type LearnSource = { label: string; url: string; published?: string };

export type LearnGuide = {
  slug: string;
  group: LearnGroupId;
  /** Extra words people may search for, including common misspellings and short names. */
  keywords?: string[];
  /** Country articles only: the country, the official pages, and the day the facts were last checked against them (YYYY-MM-DD). */
  region?: { code: "SG"; name: "Singapore" };
  sources?: LearnSource[];
  checkedOn?: string;
  /** The picture on the guide's card in the library index. */
  icon: LearnIcon;
  title: string;
  summary: string;
  sections: LearnSection[];
};

export type LearnTerm = {
  /** Anchor on /learn/terms (#id). */
  id: string;
  term: string;
  /** Other names the same idea goes by in different policies and markets. */
  alsoCalled?: string[];
  definition: string;
  /** Whole words or phrases that, found in an answer, link to this term. Matched case-insensitively. */
  match: string[];
};

/** Shown on every library page. */
export const LEARN_NOTICE =
  "General education only. This explains how insurance commonly works; it is not advice about your own cover. Policies differ: your own documents, and your insurer, decide what is covered and what is paid.";

export const TERMS: LearnTerm[] = [
  { id: "policyholder", term: "Policyholder", alsoCalled: ["policy owner"],
    definition: "The person or organisation that owns the policy and pays for it. They can make changes, such as naming a beneficiary. They are not always the person who is insured.",
    match: ["policyholder", "policy holder", "policy owner", "policyowner"] },
  { id: "life-insured", term: "Life insured", alsoCalled: ["insured person", "life assured", "covered person"],
    definition: "The person whose life, health or injury the policy covers. A parent can own a policy that insures a child, for example. When asking what a policy covers, it matters who the life insured is.",
    match: ["life insured", "insured person", "life assured", "covered person"] },
  { id: "beneficiary", term: "Beneficiary", alsoCalled: ["nominee"],
    definition: "The person named to receive the money if the life insured dies. How a beneficiary is named, and whether that can be changed, depends on the policy and local law.",
    match: ["beneficiary", "beneficiaries", "nominee", "nomination"] },
  { id: "premium", term: "Premium",
    definition: "What you pay to keep the policy in force, for example monthly or yearly. Missing premiums can end the cover, usually after a grace period.",
    match: [] },
  { id: "grace-period", term: "Grace period",
    definition: "Extra time after a premium is due during which the cover usually continues while you pay. The length is set by the policy.",
    match: ["grace period"] },
  { id: "sum-assured", term: "Sum assured", alsoCalled: ["sum insured", "face amount", "cover amount", "benefit amount"],
    definition: "The main amount a policy names for a covered event, such as death or a covered illness. Some benefits are worked out as a percentage of it. It is the amount the policy states, not a promise that a claim will be paid.",
    match: ["sum assured", "sum insured", "face amount", "cover amount"] },
  { id: "rider", term: "Rider", alsoCalled: ["supplementary benefit", "add-on"],
    definition: "Extra cover attached to a main policy, such as critical illness or accident cover added to a life policy. A rider usually has its own amount and conditions, and usually ends if the main policy ends.",
    match: ["rider", "riders", "supplementary benefit", "add-on cover"] },
  { id: "deductible", term: "Deductible", alsoCalled: ["excess"],
    definition: "The part of a claim you pay yourself before the policy starts paying. It may apply per claim, per event or per year, depending on the policy.",
    match: ["deductible", "deductibles"] },
  { id: "co-payment", term: "Co-payment", alsoCalled: ["co-insurance", "co-pay"],
    definition: "A share of the bill you pay even after any deductible, often written as a percentage. For example, a 10% co-payment means the policy pays the rest of a covered bill, up to its limits.",
    match: ["co-payment", "copayment", "co-insurance", "coinsurance", "co-pay", "copay"] },
  { id: "limit", term: "Limit", alsoCalled: ["cap", "maximum", "sub-limit"],
    definition: "The most a policy pays. A policy can have several: per event or claim, per year, per lifetime, and smaller sub-limits for particular items. The lowest one that applies is the one that counts.",
    match: ["sub-limit", "sub-limits", "annual limit", "lifetime limit", "overall limit", "per-event limit"] },
  { id: "waiting-period", term: "Waiting period",
    definition: "Time after cover starts during which some conditions are not covered, or are covered only partly. Many illness covers have one; accidents often do not. Each policy sets its own.",
    match: ["waiting period", "waiting periods"] },
  { id: "survival-period", term: "Survival period",
    definition: "Some illness covers pay only if the insured person lives for a stated number of days after diagnosis. The period, if any, is in the policy wording.",
    match: ["survival period"] },
  { id: "pre-existing-condition", term: "Pre-existing condition",
    definition: "A health condition that existed, or had symptoms, before the cover started. Many policies exclude or limit these, and the definition varies, so check your wording and what was declared on the application.",
    match: ["pre-existing condition", "pre-existing conditions", "preexisting condition"] },
  { id: "exclusion", term: "Exclusion",
    definition: "Something a policy says it does not cover. Exclusions are listed in the policy wording. If something is not mentioned in your documents, that alone does not mean it is excluded.",
    match: ["exclusion", "exclusions"] },
  { id: "policy-wording", term: "Policy wording", alsoCalled: ["policy contract", "terms and conditions", "policy document"],
    definition: "The full contract: definitions, what is covered, conditions, exclusions and how to claim. It is often the same for everyone with that product, so it explains cover but does not on its own prove that you have it.",
    match: ["policy wording", "policy wordings", "policy contract", "terms and conditions"] },
  { id: "schedule", term: "Schedule", alsoCalled: ["policy schedule", "certificate of insurance", "policy data page"],
    definition: "The page or pages personal to your policy: who is covered, the plan, amounts, premium and dates. It shows what you bought; the wording explains what those covers mean.",
    match: ["policy schedule", "certificate of insurance"] },
  { id: "endorsement", term: "Endorsement",
    definition: "A formal change to a policy after it was issued, such as a new address, a different amount or an added exclusion. A later endorsement can change what an earlier schedule says.",
    match: ["endorsement", "endorsements"] },
  { id: "benefit-illustration", term: "Benefit illustration",
    definition: "A projection, usually given before you buy, showing what a policy might pay or be worth under assumed returns. Projected figures are not guaranteed unless the document says they are.",
    match: ["benefit illustration", "policy illustration", "projected value", "non-guaranteed"] },
  { id: "claim", term: "Claim",
    definition: "A request to the insurer to pay under the policy. The insurer checks it against the policy terms and decides what it pays.",
    match: [] },
  { id: "pre-authorisation", term: "Pre-authorisation", alsoCalled: ["pre-approval", "letter of guarantee"],
    definition: "Approval from the insurer before planned treatment, under some health policies. Some policies pay less, or not at all, without it when it is required.",
    match: ["pre-authorisation", "pre-authorization", "pre-approval", "preapproval", "letter of guarantee"] },
  { id: "reimbursement", term: "Reimbursement",
    definition: "Paying you back for costs you actually incurred, up to the policy's limits, usually against bills or receipts. Compare with a lump sum, which pays a set amount when an event happens.",
    match: ["reimbursement", "reimburse", "reimbursed", "as charged"] },
  { id: "lump-sum", term: "Lump sum",
    definition: "A set amount paid once when a covered event happens, such as a diagnosis or death, whatever the actual costs were.",
    match: ["lump sum", "lump-sum"] },
  { id: "daily-benefit", term: "Daily benefit", alsoCalled: ["daily cash", "hospital income"],
    definition: "A set amount for each day of something, such as each day in hospital, usually up to a maximum number of days.",
    match: ["daily benefit", "daily cash", "hospital income"] },
  { id: "total-permanent-disability", term: "Total and permanent disability", alsoCalled: ["TPD"],
    definition: "Being unable, permanently, to work or to do set everyday activities, as the policy defines it. The definition varies a lot between policies, so check yours.",
    match: ["total and permanent disability", "total permanent disability", "tpd"] },
  { id: "critical-illness", term: "Critical illness", alsoCalled: ["dread disease", "major illness"],
    definition: "Cover that pays when you are diagnosed with an illness on the policy's list, as the policy defines it. Some pay at early stages too, often a smaller share.",
    match: ["critical illness", "critical illnesses", "dread disease", "major illness"] },
  { id: "cash-value", term: "Cash value", alsoCalled: ["surrender value"],
    definition: "Money some savings or whole-life policies build up, which you may receive if you end the policy early. It is often less than the premiums paid, especially in early years.",
    match: ["cash value", "surrender value"] },
  { id: "free-look-period", term: "Free-look period", alsoCalled: ["cooling-off period"],
    definition: "A short time after you receive a new policy when you can cancel it, usually for a refund of most or all premiums.",
    match: ["free-look period", "free look period", "cooling-off period", "cooling off period"] },
  { id: "in-force", term: "In force",
    definition: "A policy that is active: premiums are paid and it has not ended. A document dated in the past shows what was true then, not that the policy is still in force today.",
    match: ["in force", "lapsed", "lapse"] },
  { id: "waiver-of-premium", term: "Waiver of premium", alsoCalled: ["premium waiver", "payer benefit"],
    definition: "A benefit, often a rider, under which future premiums of a policy stop being collected after a covered event, such as disability or a covered illness, so the cover carries on. It does not usually pay money to you directly.",
    match: ["waiver of premium", "premium waiver", "payer benefit", "payor benefit"] },
  { id: "inpatient", term: "Inpatient", alsoCalled: ["hospitalisation"],
    definition: "Treatment while admitted to hospital, usually including an overnight stay. Many hospital plans pay mainly for inpatient treatment, and some count day surgery too.",
    match: [] },
  { id: "outpatient", term: "Outpatient",
    definition: "Treatment without being admitted to hospital, such as a clinic visit, a scan or physiotherapy. It is often covered by a separate benefit with its own limits, if at all.",
    match: [] },
  { id: "day-surgery", term: "Day surgery", alsoCalled: ["day case"],
    definition: "A procedure where you are admitted and go home the same day. Many hospital plans treat it like a hospital stay; check how yours does.",
    match: ["day surgery", "day case", "day-case"] },
  { id: "pre-post-hospital", term: "Pre- and post-hospital treatment", alsoCalled: ["before and after admission"],
    definition: "Related visits, tests and medicines for a set time before an admission and after discharge, which some hospital plans count as part of the stay. The time allowed and the limits are in the policy.",
    match: ["pre-hospitalisation", "post-hospitalisation", "pre-hospitalization", "post-hospitalization", "pre-hospital", "post-hospital"] },
  { id: "panel-provider", term: "Panel provider", alsoCalled: ["network provider", "preferred provider", "panel doctor"],
    definition: "A hospital, clinic or doctor on the insurer's list. Some plans pay more, or pay the provider directly, when you use one, and less when you do not.",
    match: ["panel hospital", "panel clinic", "panel doctor", "panel provider", "panel providers", "network hospital", "network provider", "preferred provider"] },
  { id: "reasonable-and-customary", term: "Reasonable and customary charges",
    definition: "The usual cost of a treatment in that place, as the insurer assesses it. Some health policies pay only up to this level, so a charge well above it may be paid only in part.",
    match: ["reasonable and customary", "usual and customary", "usual, reasonable and customary"] },
  { id: "pro-ration", term: "Pro-ration", alsoCalled: ["pro-rata"],
    definition: "Paying a proportion instead of the full amount. Some hospital plans pay a reduced share of the whole bill when you stay in a higher room or ward than the plan covers. The policy wording sets the share.",
    match: ["pro-ration", "proration", "pro-rated", "prorated", "pro-rata", "pro rata"] },
  { id: "no-claim-discount", term: "No-claim discount", alsoCalled: ["no-claim bonus"],
    definition: "A lower premium at renewal for years without a claim, common in motor and some other policies. A claim can reduce it; the policy says how.",
    match: ["no-claim discount", "no-claims discount", "no-claim bonus", "no-claims bonus"] },
  { id: "duty-of-disclosure", term: "Duty of disclosure", alsoCalled: ["non-disclosure", "material fact"],
    definition: "The duty to answer an insurer's questions fully and truthfully when applying, and sometimes when renewing. Facts not disclosed that would have changed the insurer's decision can affect claims, under the policy and local law.",
    match: ["duty of disclosure", "non-disclosure", "material fact", "material facts", "misrepresentation"] },
  { id: "guaranteed-renewable", term: "Guaranteed renewable",
    definition: "Cover the insurer must renew while premiums are paid, usually up to a stated age, even if your health changes. The premium can still change unless the policy says it cannot.",
    match: ["guaranteed renewable", "guaranteed renewal"] },
  { id: "terminal-illness", term: "Terminal illness",
    definition: "An illness expected to lead to death within a period the policy sets. Some life policies pay part or all of the death benefit early on a terminal illness diagnosis, which then reduces what is paid on death.",
    match: ["terminal illness", "terminally ill"] },
  { id: "early-stage", term: "Early-stage critical illness", alsoCalled: ["intermediate stage"],
    definition: "A less severe stage of a listed illness that some critical illness policies pay for, usually a smaller share of the sum assured. A later claim for a severe stage may be reduced by what was paid.",
    match: ["early-stage critical illness", "early stage critical illness", "early critical illness", "intermediate stage", "intermediate-stage"] },
  { id: "accelerated-benefit", term: "Accelerated benefit",
    definition: "A benefit that pays part of a policy's death cover early, for example on a critical illness. What is paid usually reduces the death cover that is left. A standalone benefit pays without reducing it.",
    match: ["accelerated benefit", "accelerated benefits", "accelerated critical illness"] },
  { id: "accidental-death", term: "Accidental death",
    definition: "Death caused by an accident, as the policy defines it, often within a set time after the accident. Accident policies and some life riders pay a stated amount for it.",
    match: ["accidental death"] },
  { id: "activities-of-daily-living", term: "Activities of daily living", alsoCalled: ["ADLs"],
    definition: "Everyday tasks, such as washing, dressing, feeding, toileting, moving around and transferring from a bed to a chair. Some disability and long-term care covers pay when a set number cannot be done, as the policy defines.",
    match: ["activities of daily living", "activity of daily living", "adl", "adls"] },
  { id: "deferred-period", term: "Deferred period", alsoCalled: ["elimination period"],
    definition: "The time you must be unable to work, or disabled, before some covers start paying, such as income protection. It is different from a waiting period after cover starts.",
    match: ["deferred period", "deferment period", "elimination period"] },
  { id: "under-insurance", term: "Under-insurance", alsoCalled: ["average"],
    definition: "Insuring property for less than its real value. Under some home and business policies, each claim, small or large, may then be paid only in the proportion that the amount insured bears to the real value. Some policies allow a margin before this applies.",
    match: ["underinsurance", "underinsured", "average clause", "condition of average"] },
  { id: "third-party", term: "Third-party cover",
    definition: "Cover for harm you cause to other people or their property, common in motor insurance. Damage to your own vehicle is covered only at higher levels of cover.",
    match: ["third-party liability", "third party liability", "third-party cover", "third party cover", "third party only"] },
  { id: "term-life", term: "Term life cover", alsoCalled: ["term insurance"],
    definition: "Life cover for a set period. It pays if the life insured dies within that period, and usually has no cash value.",
    match: ["term life", "term life insurance", "term assurance"] },
  { id: "whole-life", term: "Whole-life cover",
    definition: "Life cover that lasts for life while premiums are paid as required. Many such policies build a cash value over time.",
    match: ["whole life policy", "whole life plan", "whole life cover", "whole life insurance", "whole life assurance"] },
];

/** The general, insurer-neutral guides. Country articles live in their own files and are added below. */
export const GENERAL_GUIDES: LearnGuide[] = [
  {
    slug: "your-documents",
    group: "start",
    icon: "schedule",
    title: "Your insurance documents",
    summary: "What a schedule, a policy wording, a certificate and a rider are, and which one tells you what.",
    sections: [
      { heading: "Why one policy comes as several documents", blocks: [
        { kind: "p", text: "Most policies come as a set. One part is personal to you; the rest explains the product. Knowing which is which helps you, and DearPolicy, read them correctly." },
      ] },
      { heading: "The common documents", blocks: [
        { kind: "tiles", caption: "The documents most policies come with, and what each one is for.", tiles: [
          { icon: "schedule", title: "Schedule", text: "Personal to you: who, which plan, amounts, dates." },
          { icon: "wording", title: "Policy wording", text: "What each cover means, its conditions and exclusions." },
          { icon: "rider", title: "Rider", text: "Extra cover added to the main policy." },
          { icon: "endorsement", title: "Endorsement", text: "A later change that can update the schedule." },
          { icon: "illustration", title: "Benefit illustration", text: "What it might be worth. Projections are not promises." },
          { icon: "renewal", title: "Renewal notice", text: "What is due to keep the policy going." },
        ] },
        { kind: "list", items: [
          "Schedule (or certificate, or policy data page): who is covered, which plan, the amounts, the premium and the dates. This is the proof of what you hold.",
          "Policy wording (or contract, or terms and conditions): what each cover means, its conditions and exclusions, and how to claim. Often the same for everyone with that product.",
          "Rider or supplementary benefit: extra cover added to the main policy, usually with its own amount and conditions.",
          "Endorsement: a later change to the policy. It can change what the schedule said.",
          "Benefit illustration or product summary: what the policy might do, usually before you bought it. Projected figures are not guaranteed unless it says so.",
          "Renewal notice or premium notice: what is due to keep the policy going.",
        ] },
      ] },
      { heading: "Reading them together", blocks: [
        { kind: "list", items: [
          "Read the schedule for what you have, and the wording for what it means.",
          "A wording on its own does not prove you have that cover. A schedule or certificate with your name is the usual proof, as of its date.",
          "A document shows what was true on its date. A newer schedule or endorsement can replace it.",
          "Two policies with the same policy number can still cover different people or products. Check the names on each.",
        ] },
        { kind: "cards", prompt: "Which document tells you…? Tap a card to check.", cards: [
          { front: "Who is covered, and for how much?", back: "The schedule, or certificate. It is the page personal to your policy, as of its date." },
          { front: "What a cover means, and what it excludes?", back: "The policy wording. It explains the cover, but on its own does not prove you have it." },
          { front: "That something changed after you bought it?", back: "An endorsement. A later one can replace what an earlier schedule said." },
          { front: "What the policy might be worth in future?", back: "A benefit illustration. Projected figures are not guaranteed unless it says so." },
        ] },
        { kind: "quiz", question: "You have the policy wording for a hospital plan, but no schedule or certificate with your name. Does the wording show that you have this cover?",
          options: ["Yes, it describes the cover in full", "Not on its own: a schedule or certificate with your name is the usual proof", "Yes, if the wording is recent"],
          answer: 1, explain: "A wording is often the same for everyone with that product. It explains the cover; the schedule or certificate shows who holds it, as of its date." },
      ] },
      { heading: "Getting the most from DearPolicy", blocks: [
        { kind: "list", items: [
          "Upload the schedule and the policy wording for each policy if you have both.",
          "Link each document to the person it covers.",
          "If a page could not be read, DearPolicy names it. A clearer scan or the insurer's digital copy usually fixes it.",
        ] },
      ] },
    ],
  },
  {
    slug: "types-of-cover",
    group: "start",
    icon: "life",
    title: "Types of cover",
    summary: "Life, critical illness, disability, hospital, accident, travel, home, motor and savings policies in plain words.",
    sections: [
      { heading: "Protecting people", blocks: [
        { kind: "tiles", caption: "Common kinds of cover for people. Names differ between insurers and countries.", tiles: [
          { icon: "life", title: "Life", text: "Pays when the life insured dies." },
          { icon: "illness", title: "Critical illness", text: "A lump sum on diagnosis of a listed illness." },
          { icon: "disability", title: "Disability", text: "A lump sum or income if disabled as defined." },
          { icon: "hospital", title: "Hospital and medical", text: "Towards treatment bills, up to limits." },
          { icon: "accident", title: "Personal accident", text: "For injury or death caused by an accident." },
          { icon: "income", title: "Income protection", text: "Part of your income if you cannot work." },
        ] },
        { kind: "list", items: [
          "Life cover: pays when the life insured dies, and sometimes on terminal illness. Term cover lasts a set time; whole-life cover lasts for life and may build a cash value.",
          "Critical illness: pays a lump sum on diagnosis of a listed illness, as the policy defines it. Some pay at early stages too.",
          "Disability: pays if you become disabled as the policy defines it. Some pay a lump sum, some a monthly income.",
          "Hospital and medical: pays towards treatment costs, usually as reimbursement up to limits, often with a deductible or co-payment.",
          "Personal accident: pays for injury or death caused by an accident. Often a set amount or a percentage of the sum assured for a listed injury, plus medical costs up to a limit.",
          "Income protection: replaces part of your income if illness or injury stops you working, usually after a waiting period.",
        ] },
      ] },
      { heading: "Protecting things and trips", blocks: [
        { kind: "tiles", caption: "Cover for trips and belongings.", tiles: [
          { icon: "travel", title: "Travel", text: "Medical costs abroad, cancellation, luggage." },
          { icon: "home", title: "Home", text: "The building, its contents, or both." },
          { icon: "motor", title: "Motor", text: "Damage to others, and maybe your own vehicle." },
        ] },
        { kind: "list", items: [
          "Travel: medical costs abroad, cancelled trips, lost luggage and similar, each with its own limit.",
          "Home: damage to the building, its contents, or both, and sometimes your liability to others.",
          "Motor: damage to others and, depending on the level of cover, your own vehicle.",
        ] },
      ] },
      { heading: "Saving and investing", blocks: [
        { kind: "list", items: [
          "Endowment or savings plans: pay out at a set date, with some life cover along the way.",
          "Investment-linked policies: premiums buy units in funds, so the value goes up and down.",
          "Annuities: turn a sum of money into a regular income, often for retirement.",
          "For these, separate guaranteed amounts from projected ones. Only the guaranteed part is promised.",
        ] },
        { kind: "cards", prompt: "Lump sum or pay-back? Tap each kind of cover to see how it usually pays.", cards: [
          { front: "Critical illness", back: "Usually a lump sum on diagnosis, whatever the treatment costs. Check how your policy defines each illness." },
          { front: "Hospital and medical", back: "Usually reimbursement: it pays back covered bills, up to its limits, after any deductible and co-payment." },
          { front: "Personal accident", back: "Often both: a set amount or percentage for listed injuries, plus medical costs up to a limit." },
          { front: "Daily hospital cash", back: "A set amount for each day in hospital, up to a maximum number of days. Some plans pay only after a minimum stay." },
        ] },
        { kind: "quiz", question: "A savings plan shows a guaranteed amount and a projected amount. Which one is promised?",
          options: ["The projected amount", "The guaranteed amount", "Both"],
          answer: 1, explain: "Projected figures depend on assumed returns and can be lower. Only the guaranteed part is promised, and only as the document states it." },
      ] },
    ],
  },
  {
    slug: "how-amounts-work",
    group: "amounts",
    icon: "percent",
    title: "How amounts work",
    summary: "Percentages of a sum assured, limits, deductibles, and why a figure in a policy is not a promise of payment.",
    sections: [
      { heading: "Where an amount comes from", blocks: [
        { kind: "p", text: "A policy can state an amount directly, or as a share of something else. Read what the percentage is of, and which limit applies." },
        { kind: "tiles", caption: "Four common ways a policy states an amount.", tiles: [
          { icon: "fixed", title: "Fixed amount", text: "A set figure for a covered event." },
          { icon: "percent", title: "Percentage", text: "A share of the sum assured, or of another base." },
          { icon: "daily", title: "Per day", text: "A set figure per day, up to a number of days." },
          { icon: "receipt", title: "Reimbursement", text: "What you spent, up to a limit." },
        ] },
        { kind: "list", items: [
          "A fixed amount: a set figure for a covered event.",
          "A percentage of the sum assured: for example, a stated share for losing the sight of one eye.",
          "A daily amount: a set figure per day, up to a maximum number of days.",
          "Reimbursement: what you actually spent, up to a limit, less any deductible and co-payment.",
        ] },
        { kind: "example", text: "Example only, not anyone's policy: if a cover pays 25% of a sum assured of 100,000, the illustrated amount is 25,000, in the policy's own currency." },
        { kind: "percent-of-sum" },
      ] },
      { heading: "What can reduce it", blocks: [
        { kind: "list", items: [
          "A deductible you pay first.",
          "A co-payment share you pay of each covered bill.",
          "Limits per event, per year or per lifetime, and sub-limits for certain items.",
          "Amounts already paid under the same cover. Some policies reduce the main amount after an earlier claim.",
          "Rules that pay only one of several benefits for the same event.",
        ] },
        { kind: "example", text: "Example only: a covered hospital bill of 10,000, a deductible of 1,000 and a 10% co-payment. The policy would pay 9,000 less 900, so 8,100, if no lower limit applies. Policies differ in the order these apply." },
        { kind: "bill-split" },
        { kind: "diagram", diagram: "lowest-limit", caption: "A policy can have several limits at once. The lowest one that applies is the one that counts." },
      ] },
      { heading: "A figure is not a promise", blocks: [
        { kind: "p", text: "There are three different things: the amount the document prints, an illustration of what it could mean in a scenario, and what the insurer actually pays after checking the claim. DearPolicy shows the first two and says which is which. Only the insurer decides the third." },
        { kind: "flow", caption: "Three different things, often confused.", items: [
          { icon: "printed", title: "Printed amount", text: "What the document states. DearPolicy shows it with its page." },
          { icon: "scenario", title: "Illustration", text: "What that could mean in your scenario. Labelled as an illustration." },
          { icon: "insurer", title: "Insurer's decision", text: "What is actually paid, after the insurer checks the claim." },
        ] },
        { kind: "p", text: "Amounts are shown in the currency your document states. When a document shows only a symbol such as \"$\" without saying which currency, DearPolicy leaves the currency unconfirmed rather than guessing." },
        { kind: "quiz", question: "Example only: a cover pays 50% of a sum assured of 200,000. What is the illustrated amount?",
          options: ["50,000", "100,000", "200,000"],
          answer: 1, explain: "Half of 200,000 is 100,000, in the policy's own currency. It is an illustration; the insurer decides what is paid." },
      ] },
    ],
  },
  {
    slug: "making-a-claim",
    group: "amounts",
    keywords: ["claim form", "how to claim", "file a claim", "submit a claim", "appeal", "rejected claim", "dispute"],
    icon: "tell",
    title: "Making a claim",
    summary: "General steps that apply to most claims, and where to find your own policy's rules.",
    sections: [
      { heading: "General steps", blocks: [
        { kind: "steps", caption: "The usual path of a claim. Your policy's claims section has its own details.", steps: [
          { icon: "search", title: "Find the policy", text: "Which policy may cover this, and whom it covers." },
          { icon: "read", title: "Read the claims section", text: "What to send, how, and by when." },
          { icon: "tell", title: "Tell the insurer early", text: "Many policies set time limits." },
          { icon: "approve", title: "Check approval first", text: "For planned treatment, some policies need it." },
          { icon: "keep", title: "Keep copies", text: "Bills, receipts and reports you already have." },
          { icon: "decide", title: "The insurer decides", text: "They may ask for more information." },
        ] },
        { kind: "list", items: [
          "Find the policy that may cover the event, and the person it covers.",
          "Read the claims section of the policy wording. It says what to send, how, and by when.",
          "Tell the insurer, or your adviser, as soon as you can. Many policies set a time limit for telling them and for sending documents.",
          "For planned treatment, check whether the policy needs approval first.",
          "Keep the bills, receipts and reports you already have, and copies of what you send.",
          "Wait for the insurer's decision. They may ask for more information.",
        ] },
      ] },
      { heading: "Good to know", blocks: [
        { kind: "list", items: [
          "What the insurer asks for depends on the policy and the event. Your policy wording and the insurer's claim form are the best guide.",
          "One event can be claimable under more than one policy, for example an accident policy and a hospital policy. Policies set their own rules on claiming from more than one.",
          "If you disagree with a decision, ask the insurer for the reason in writing and how to appeal. Many places also have an independent complaints or dispute service.",
        ] },
        { kind: "cards", prompt: "Myth or fact? Tap each card.", cards: [
          { front: "\"If my documents don't mention it, I'm not covered.\"", back: "Not necessarily. Missing information is not an exclusion. A policy you have not uploaded, or a page not yet read, may cover it." },
          { front: "\"The amount in my policy is what I will receive.\"", back: "It is the amount the policy states. The insurer checks the claim against the terms and decides what it pays." },
          { front: "\"I can only claim from one policy.\"", back: "Sometimes more than one policy can respond to the same event. Each policy sets its own rules on this." },
          { front: "\"There's no rush to tell the insurer.\"", back: "Many policies set a time limit for telling them and for sending documents. The claims section says what yours needs." },
        ] },
        { kind: "quiz", question: "Planned surgery is booked for next month under a hospital policy. What is worth checking first?",
          options: ["Whether the policy needs approval before treatment", "Nothing: claim after the surgery", "Whether the hospital is near your home"],
          answer: 0, explain: "Some health policies need pre-authorisation for planned treatment and pay less, or not at all, without it. The policy wording says whether yours does." },
      ] },
      { heading: "How DearPolicy helps", blocks: [
        { kind: "p", text: "Ask DearPolicy about what happened. It finds the benefits your documents describe for that person, shows the amounts and conditions with the page they come from, asks only for facts that change the answer, and lists supported next steps. The insurer still decides the claim." },
      ] },
    ],
  },
  {
    slug: "reading-answers",
    group: "dearpolicy",
    icon: "source",
    title: "Reading DearPolicy's answers",
    summary: "What the labels mean, why some amounts are not shown, and what to do about unread pages.",
    sections: [
      { heading: "What an answer contains", blocks: [
        { kind: "tiles", caption: "The parts of a DearPolicy answer.", tiles: [
          { icon: "person", title: "Whose cover", text: "The person and the policy it comes from." },
          { icon: "printed", title: "Printed amount", text: "As the document states it, in its own currency." },
          { icon: "source", title: "Source", text: "The document and page it comes from, so you can check it yourself." },
          { icon: "conditions", title: "Conditions", text: "Waiting periods, limits and other terms for that benefit." },
          { icon: "question", title: "A question", text: "Usually one at a time, only when your answer would change the result." },
        ] },
        { kind: "list", items: [
          "The benefits your documents describe for that person, with the page they come from.",
          "The amount the document prints, in the currency it states.",
          "When you describe a scenario, it may show a worked illustration. That is an illustration, not a payment.",
          "Conditions that apply to that benefit, such as a waiting period or a limit.",
          "A question, only when the answer would change it.",
        ] },
      ] },
      { heading: "When something is missing", blocks: [
        { kind: "list", items: [
          "If DearPolicy cannot tie an amount to a page, it does not show one. It still tells you what the document says about the benefit.",
          "If your documents do not mention something, that does not mean you are not covered. A policy you have not uploaded may cover it.",
          "If a page could not be read, DearPolicy names the document and page. Upload a clearer copy to include it.",
          "If two documents disagree, DearPolicy does not pick one: it says they differ, or shows no figure.",
        ] },
        { kind: "cards", prompt: "What does it mean when…? Tap a card.", cards: [
          { front: "No amount is shown", back: "DearPolicy could not tie a figure to a page, so it shows none. It still tells you what the document says about the benefit." },
          { front: "A page is named as unread", back: "That page could not be read. Upload a clearer scan or the insurer's digital copy to include it." },
          { front: "The currency is unconfirmed", back: "The document shows only a symbol, such as \"$\", without saying which currency. DearPolicy does not guess." },
          { front: "It asks you a question", back: "Your answer would change which benefit applies or how an illustration works. It usually asks one question at a time." },
        ] },
        { kind: "quiz", question: "Your documents do not mention dental treatment at all. What does that tell you?",
          options: ["You are not covered for dental treatment", "Dental treatment is excluded", "Nothing on its own: a policy or page not uploaded may cover it"],
          answer: 2, explain: "Missing information is not an exclusion. Exclusions are things a policy says it does not cover. Check any other policies, and ask your insurer if it matters." },
      ] },
      { heading: "Before you rely on an answer", blocks: [
        { kind: "list", items: [
          "Open the source and read the page yourself.",
          "Check the document's date. A newer document may have changed the cover.",
          "For a decision that matters, confirm with your insurer or adviser.",
        ] },
      ] },
    ],
  },
  ...CLAIM_GUIDES,
];

export const GUIDES: LearnGuide[] = [...GENERAL_GUIDES, ...SINGAPORE_GUIDES];

/** The glossary is a library page too, listed with the guides. */
export const TERMS_PAGE = {
  slug: "terms",
  group: "dearpolicy",
  title: "Key terms A to Z",
  summary: "Sum assured, deductible, co-payment, waiting period, exclusion and other words you will meet in a policy.",
} as const;

export function guideBySlug(slug: string): LearnGuide | undefined {
  return GUIDES.find((guide) => guide.slug === slug);
}

export function termsSorted(): LearnTerm[] {
  return [...TERMS].sort((a, b) => a.term.localeCompare(b.term));
}

export function termHref(term: LearnTerm): string {
  return `/learn/terms#${term.id}`;
}

/** Format a YYYY-MM-DD date as "12 Nov 2026", the same on server and phone. */
export function learnDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}

/** What the library search looks through: titles, summaries, keywords, headings and the A to Z. Static. */
export type LearnSearchEntry = { href: string; title: string; summary: string; group: string; text: string };
export function learnSearchIndex(): LearnSearchEntry[] {
  const groupTitle = (id: string) => LEARN_GROUPS.find((g) => g.id === id)?.title ?? "";
  return [
    ...GUIDES.map((g) => ({
      href: `/learn/${g.slug}`, title: g.title, summary: g.summary, group: groupTitle(g.group),
      text: [g.title, g.summary, ...(g.keywords ?? []), ...g.sections.map((s) => s.heading)].join(" "),
    })),
    ...TERMS.map((t) => ({
      href: termHref(t), title: t.term, summary: t.definition, group: TERMS_PAGE.title,
      text: [t.term, ...(t.alsoCalled ?? []), t.definition].join(" "),
    })),
  ];
}
