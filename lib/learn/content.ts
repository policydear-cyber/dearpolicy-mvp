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

export type LearnBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "example"; text: string };

export type LearnSection = { heading: string; blocks: LearnBlock[] };

export type LearnGuide = {
  slug: string;
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
    match: ["premium", "premiums"] },
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
    match: ["schedule", "policy schedule", "certificate of insurance"] },
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
    match: ["daily benefit", "per day", "daily cash", "hospital income"] },
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
];

export const GUIDES: LearnGuide[] = [
  {
    slug: "your-documents",
    title: "Your insurance documents",
    summary: "What a schedule, a policy wording, a certificate and a rider are, and which one tells you what.",
    sections: [
      { heading: "Why one policy comes as several documents", blocks: [
        { kind: "p", text: "Most policies come as a set. One part is personal to you; the rest explains the product. Knowing which is which helps you, and DearPolicy, read them correctly." },
      ] },
      { heading: "The common documents", blocks: [
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
          "A wording on its own does not prove you have that cover. A schedule or certificate with your name does.",
          "A document shows what was true on its date. A newer schedule or endorsement can replace it.",
          "Two policies with the same policy number can still cover different people or products. Check the names on each.",
        ] },
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
    title: "Types of cover",
    summary: "Life, critical illness, disability, hospital, accident, travel, home, motor and savings policies in plain words.",
    sections: [
      { heading: "Protecting people", blocks: [
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
      ] },
    ],
  },
  {
    slug: "how-amounts-work",
    title: "How amounts work",
    summary: "Percentages of a sum assured, limits, deductibles, and why a figure in a policy is not a promise of payment.",
    sections: [
      { heading: "Where an amount comes from", blocks: [
        { kind: "p", text: "A policy can state an amount directly, or as a share of something else. Read what the percentage is of, and which limit applies." },
        { kind: "list", items: [
          "A fixed amount: a set figure for a covered event.",
          "A percentage of the sum assured: for example, a stated share for losing the sight of one eye.",
          "A daily amount: a set figure per day, up to a maximum number of days.",
          "Reimbursement: what you actually spent, up to a limit, less any deductible and co-payment.",
        ] },
        { kind: "example", text: "Example only, not anyone's policy: if a cover pays 25% of a sum assured of 100,000, the illustrated amount is 25,000, in the policy's own currency." },
      ] },
      { heading: "What can reduce it", blocks: [
        { kind: "list", items: [
          "A deductible you pay first.",
          "A co-payment share you pay of each covered bill.",
          "Limits per event, per year or per lifetime, and sub-limits for certain items.",
          "Amounts already paid under the same cover. Some policies reduce the main amount after an earlier claim.",
          "Rules that pay only one of several benefits for the same event, often the highest.",
        ] },
        { kind: "example", text: "Example only: a covered hospital bill of 10,000, a deductible of 1,000 and a 10% co-payment. The policy would pay 9,000 less 900, so 8,100, if no lower limit applies." },
      ] },
      { heading: "A figure is not a promise", blocks: [
        { kind: "p", text: "There are three different things: the amount the document prints, an illustration of what it could mean in a scenario, and what the insurer actually pays after checking the claim. DearPolicy shows the first two and says which is which. Only the insurer decides the third." },
        { kind: "p", text: "Amounts are shown in the currency your document states. When a document shows only a symbol such as \"$\" without saying which currency, DearPolicy leaves the currency unconfirmed rather than guessing." },
      ] },
    ],
  },
  {
    slug: "making-a-claim",
    title: "Making a claim",
    summary: "General steps that apply to most claims, and where to find your own policy's rules.",
    sections: [
      { heading: "General steps", blocks: [
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
      ] },
      { heading: "How DearPolicy helps", blocks: [
        { kind: "p", text: "Ask DearPolicy about what happened. It finds the benefits your documents describe for that person, shows the amounts and conditions with the page they come from, asks only for facts that change the answer, and lists supported next steps. The insurer still decides the claim." },
      ] },
    ],
  },
  {
    slug: "reading-answers",
    title: "Reading DearPolicy's answers",
    summary: "What the labels mean, why some amounts are not shown, and what to do about unread pages.",
    sections: [
      { heading: "What an answer contains", blocks: [
        { kind: "list", items: [
          "The benefits your documents describe for that person, with the page they come from.",
          "The amount the document prints, in the currency it states.",
          "A worked illustration when you describe a scenario, with each step shown. It is an illustration, not a payment.",
          "Conditions that apply to that benefit, such as a waiting period or a limit.",
          "A question, only when the answer would change it.",
        ] },
      ] },
      { heading: "When something is missing", blocks: [
        { kind: "list", items: [
          "If DearPolicy cannot tie an amount to a page, it does not show one. It still tells you what the document says about the benefit.",
          "If your documents do not mention something, that does not mean you are not covered. A policy you have not uploaded may cover it.",
          "If a page could not be read, DearPolicy names the document and page. Upload a clearer copy to include it.",
          "If two documents disagree, DearPolicy shows both rather than choosing one.",
        ] },
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
];

/** The glossary is a library page too, listed with the guides. */
export const TERMS_PAGE = {
  slug: "terms",
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
