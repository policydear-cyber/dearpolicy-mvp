/**
 * Singapore schemes: plain-English articles about national schemes for Singapore Citizens and Permanent Residents.
 *
 * GENERAL EDUCATION ONLY, like the rest of the library, but unlike the general guides these name schemes and state
 * official figures. Rules (checked by scripts/learn/learn-content-test.ts):
 * - Facts come only from official government pages (cpf.gov.sg, moh.gov.sg, mas.gov.sg, gov.sg) or the insurer that
 *   runs a scheme. No third-party sites. Each article lists its sources and the day they were checked.
 * - Every figure sits in a "fact" or "table" block that names its source. Money is written "S$", never a bare "$".
 * - No insurer or plan is recommended or ranked. Nothing says what a particular person will be paid.
 * Rules change: when a source changes, update the fact and the checkedOn date together.
 */
import type { LearnGuide, LearnSource } from "./content";

const SG = { code: "SG", name: "Singapore" } as const;
const CHECKED = "2026-11-12";

const SRC = {
  msl: { label: "CPF Board: MediShield Life", url: "https://www.cpf.gov.sg/member/healthcare-financing/medishield-life" },
  mslClaim: { label: "CPF Board: What can you claim under MediShield Life?", url: "https://www.cpf.gov.sg/member/infohub/educational-resources/what-can-you-claim-under-medishieldlife" },
  ip: { label: "CPF Board: Integrated Shield Plan", url: "https://www.cpf.gov.sg/member/healthcare-financing/getting-supplementary-coverage/integrated-shield-plan" },
  ipRiders: { label: "Ministry of Health: New requirements for Integrated Shield Plan riders", url: "https://www.moh.gov.sg/newsroom/new-requirements-for-integrated-shield-plan-riders-to-strengthen-sustainability-of-private-health-insurance-and-address-rising-healthcare-costs/", published: "Nov 2025" },
  csl: { label: "CPF Board: CareShield Life", url: "https://www.cpf.gov.sg/member/healthcare-financing/careshield-life" },
  dps: { label: "CPF Board: Insuring to protect your dependants", url: "https://www.cpf.gov.sg/member/account-services/providing-for-your-loved-ones/insuring-to-protect-your-dependants" },
  dpsPremiums: { label: "CPF Board: Great Eastern Life's contract as DPS administrator extended to 2028 (premium table)", url: "https://www.cpf.gov.sg/member/infohub/news/news-releases/cpf-board-extends-great-eastern-lifes-contract-dependants-protection-scheme-administrator-to-2028" },
} satisfies Record<string, LearnSource>;

export const SINGAPORE_GUIDES: LearnGuide[] = [
  {
    slug: "sg-medishield-life",
    group: "singapore",
    icon: "hospital",
    region: SG,
    checkedOn: CHECKED,
    sources: [SRC.msl, SRC.mslClaim, SRC.ip],
    keywords: ["medishield", "medisheld", "medishield life", "msl", "hospital insurance", "basic health insurance", "medisave", "deductible", "co-insurance", "B2", "C ward"],
    title: "What is MediShield Life?",
    summary: "Singapore's basic health insurance for every Citizen and PR: what it helps pay for, and how a hospital bill is shared.",
    sections: [
      { heading: "In one line", blocks: [
        { kind: "fact", source: 0, text: "MediShield Life is a national health insurance that helps pay large hospital bills and some costly outpatient treatments. All Singapore Citizens and Permanent Residents are automatically covered, for life, whatever their age or health." },
      ] },
      { heading: "What it helps pay for", blocks: [
        { kind: "tiles", caption: "The three kinds of cost CPF Board lists.", tiles: [
          { icon: "hospital", title: "Hospital stays and day surgery", text: "Helps with large hospital bills." },
          { icon: "illness", title: "Costly outpatient treatment", text: "Such as kidney dialysis, cancer drugs and radiotherapy." },
          { icon: "home", title: "Longer-term care", text: "Community hospitals and inpatient palliative care." },
        ] },
      ] },
      { heading: "How a hospital bill is shared", blocks: [
        { kind: "p", text: "MediShield Life pays part of a bill, not all of it. The rest can be paid from MediSave, up to limits, and in cash." },
        { kind: "steps", caption: "The order CPF Board describes. Figures below are from its page.", steps: [
          { icon: "receipt", title: "Claimable amount", text: "The bill is adjusted for ward and treatment type, then claim limits apply." },
          { icon: "fixed", title: "Deductible", text: "A fixed amount you pay first, once each policy year." },
          { icon: "percent", title: "Co-insurance", text: "A percentage of the claimable amount you pay after the deductible." },
          { icon: "shield", title: "MediShield Life pays the rest", text: "Of the claimable amount, up to the limits." },
        ] },
        { kind: "fact", source: 1, text: "The deductible ranges from S$500 to S$3,000, depending on age and ward class, and applies once per policy year however many claims you make." },
        { kind: "fact", source: 1, text: "The co-insurance rate falls from 10% to 5% and then 3% as the claim amount gets larger." },
        { kind: "fact", source: 1, text: "The maximum claim limit is S$200,000 per policy year, with no lifetime limit. You pay any part of a bill above the claim limits." },
        { kind: "fact", source: 1, text: "Cover is highest for subsidised treatment in Class B2 and C wards. In higher ward classes or for non-subsidised treatment, a smaller part of the bill is claimable." },
      ] },
      { heading: "Paying for it", blocks: [
        { kind: "fact", source: 0, text: "Premiums can be paid in full from your own MediSave or a family member's. The Government gives subsidies and support so that everyone can stay covered." },
      ] },
      { heading: "How it fits with other health cover", blocks: [
        { kind: "layers", caption: "MediShield Life is the base layer. Integrated Shield Plans and riders are optional layers from private insurers.", layers: [
          { icon: "rider", title: "Rider (optional)", text: "An add-on to an Integrated Shield Plan that helps reduce co-payment." },
          { icon: "insurer", title: "Integrated Shield Plan (optional)", text: "A private insurer's extra cover, for higher ward classes and private hospitals." },
          { icon: "shield", title: "MediShield Life (everyone)", text: "Basic cover for all Citizens and PRs, for life." },
        ] },
        { kind: "p", text: "Read more in \"Integrated Shield Plans and riders\" in this section." },
      ] },
      { heading: "Check yourself", blocks: [
        { kind: "cards", prompt: "Myth or fact? Tap each card.", cards: [
          { front: "\"MediShield Life pays my whole hospital bill.\"", back: "No. You pay the deductible and co-insurance, and anything above the claim limits. MediSave can help with your share, up to limits." },
          { front: "\"I need to sign up for MediShield Life.\"", back: "No. All Singapore Citizens and Permanent Residents are covered automatically." },
          { front: "\"A higher ward class means MediShield Life covers more.\"", back: "The reverse. Cover is highest for subsidised B2 and C wards; in higher classes a smaller part of the bill is claimable." },
        ] },
        { kind: "quiz", question: "Someone with only MediShield Life chooses a Class A ward. Compared with a subsidised B2 ward, how much of the bill can MediShield Life usually help with?",
          options: ["A larger part", "A smaller part", "The whole bill"],
          answer: 1, explain: "CPF Board says cover is highest for subsidised B2 and C wards. In higher ward classes the bill is first adjusted down, so a smaller part is claimable." },
      ] },
    ],
  },
  {
    slug: "sg-integrated-shield-plans",
    group: "singapore",
    icon: "rider",
    region: SG,
    checkedOn: CHECKED,
    sources: [SRC.ip, SRC.ipRiders],
    keywords: ["integrated shield", "integrated shield plan", "ip", "isp", "shield plan", "rider", "riders", "co-payment rider", "private hospital", "A ward", "B1", "additional withdrawal limit", "awl", "what can I add to medishield", "medisheld rider"],
    title: "Integrated Shield Plans and riders",
    summary: "What you can add on top of MediShield Life, how it is paid for, and the rider rules that changed in April 2026.",
    sections: [
      { heading: "In one line", blocks: [
        { kind: "fact", source: 0, text: "An Integrated Shield Plan combines MediShield Life with extra private insurance from a private insurer. A rider is an optional add-on to that plan that helps reduce your co-payment." },
        { kind: "layers", caption: "Each layer sits on the one below. You can only hold one Integrated Shield Plan at a time.", layers: [
          { icon: "rider", title: "Rider (optional)", text: "Helps reduce co-payment. Bought together with the plan." },
          { icon: "insurer", title: "Integrated Shield Plan (optional)", text: "Extra cover from a private insurer." },
          { icon: "shield", title: "MediShield Life (everyone)", text: "The base layer inside every plan." },
        ] },
      ] },
      { heading: "What the extra cover is for", blocks: [
        { kind: "tiles", caption: "What CPF Board says an Integrated Shield Plan adds.", tiles: [
          { icon: "hospital", title: "Higher wards and private hospitals", text: "Class A or B1 wards in public hospitals, and private hospitals." },
          { icon: "person", title: "Choice of doctor", text: "Choose your doctor and see specialists without a referral." },
        ] },
        { kind: "fact", source: 0, text: "You can only be covered by one Integrated Shield Plan at a time." },
      ] },
      { heading: "Paying for a plan", blocks: [
        { kind: "fact", source: 0, text: "The MediShield Life part of the premium can be paid in full from MediSave. The private part can be paid from MediSave only up to the Additional Withdrawal Limit for your age; the rest is paid in cash." },
        { kind: "table", source: 0, caption: "Additional Withdrawal Limits, per year, by age next birthday", head: ["Age next birthday", "Limit"], rows: [["40 and below", "S$300"], ["41 to 70", "S$600"], ["71 and above", "S$900"]] },
        { kind: "fact", source: 0, text: "Premiums rise with age and, CPF Board notes, could be up to five times MediShield Life premiums in your 70s or 80s. It suggests checking you can keep paying, especially after retirement." },
      ] },
      { heading: "Riders: the April 2026 rules", blocks: [
        { kind: "fact", source: 1, text: "From 1 April 2026, new riders may no longer cover the minimum Integrated Shield Plan deductible set by the Ministry of Health." },
        { kind: "fact", source: 1, text: "The minimum deductible ranges from S$1,500 to S$3,500 per policy year and varies by ward class (MOH's table, November 2025; it may be updated)." },
        { kind: "fact", source: 1, text: "A rider must still leave you a co-payment of at least 5%. The yearly cap on that co-payment is now at least S$6,000, not counting the deductible, and applies to eligible claims such as panel or pre-authorised claims." },
        { kind: "fact", source: 1, text: "Insurers decide their own approach for riders people already hold. Anyone who bought a rider that does not meet the new rules on or after 27 November 2025 must be told it will move to one that does, no later than their next renewal after 1 April 2028." },
        { kind: "flow", caption: "Who pays what on a bill under a plan with a new rider, in the order the Ministry of Health describes.", items: [
          { icon: "fixed", title: "You pay the deductible", text: "A new rider cannot cover the minimum deductible." },
          { icon: "percent", title: "You pay a co-payment", text: "A minimum share of the bill, capped each year for eligible claims." },
          { icon: "insurer", title: "Plan and rider pay the rest", text: "Of the claimable amount, up to the policy's limits." },
        ] },
        { kind: "p", text: "MediSave can be used for the deductible and co-payment, within the withdrawal limits. Your own plan and rider documents set the exact deductible, co-payment, limits and whether a claim counts as panel or pre-authorised." },
      ] },
      { heading: "Check yourself", blocks: [
        { kind: "cards", prompt: "Tap each card.", cards: [
          { front: "Can a new rider cover my deductible?", back: "Not the minimum deductible set by the Ministry of Health, for riders sold from 1 April 2026." },
          { front: "Can I hold two Integrated Shield Plans?", back: "No. CPF Board says you can only be covered by one Integrated Shield Plan at a time." },
          { front: "Can MediSave pay my whole plan premium?", back: "Only the MediShield Life part in full. The private part only up to the Additional Withdrawal Limit for your age; the rest is cash." },
          { front: "Which plan should I choose?", back: "DearPolicy does not recommend or rank insurers or plans. CPF Board suggests weighing the cover you want against premiums you can afford for life." },
        ] },
        { kind: "quiz", question: "Under the rider rules from 1 April 2026, what is the lowest co-payment a rider can leave you with on a claim?",
          options: ["Nothing at all", "At least 5%", "At least half the bill"],
          answer: 1, explain: "The Ministry of Health kept the minimum 5% co-payment. A yearly cap of at least S$6,000 then limits it for eligible claims, not counting the deductible." },
      ] },
    ],
  },
  {
    slug: "sg-careshield-life",
    group: "singapore",
    icon: "disability",
    region: SG,
    checkedOn: CHECKED,
    sources: [SRC.csl],
    keywords: ["careshield", "careshield life", "csl", "eldershield", "long-term care", "severe disability", "activities of daily living", "adl", "disability insurance"],
    title: "What is CareShield Life?",
    summary: "Long-term care insurance that pays monthly cash for life if you become severely disabled. Who is covered and how claims work.",
    sections: [
      { heading: "In one line", blocks: [
        { kind: "fact", source: 0, text: "CareShield Life is a long-term care insurance scheme. It pays monthly cash, for life, if you develop severe disability, wherever in the world you live." },
      ] },
      { heading: "Who is covered", blocks: [
        { kind: "tiles", caption: "When you join depends on the year you were born.", tiles: [
          { icon: "person", title: "Born 1980 or later", text: "Covered automatically from age 30, even with a pre-existing condition or disability." },
          { icon: "family", title: "Born 1979 or earlier", text: "Joining is optional. Some were enrolled automatically from ElderShield." },
        ] },
        { kind: "fact", source: 0, text: "Those born in 1980 or later are covered automatically once they turn 30, or from 1 October 2020, whichever is later. Those born between 1970 and 1979 who were insured under ElderShield 400 and had not developed severe disability were enrolled automatically from 1 December 2021. Others born in 1979 or earlier may apply, with a 60-day free-look period." },
      ] },
      { heading: "When it pays: 3 of 6 daily activities", blocks: [
        { kind: "fact", source: 0, text: "You can claim once a Ministry of Health-accredited assessor finds you cannot carry out at least 3 of these 6 activities of daily living. Payouts continue for as long as that remains the case." },
        { kind: "tiles", caption: "The six activities of daily living, as CPF Board lists them.", tiles: [
          { icon: "wash", title: "Washing", text: "In the bath or shower, including getting in and out." },
          { icon: "dress", title: "Dressing", text: "Putting on and taking off clothes and any aids." },
          { icon: "feed", title: "Feeding", text: "Feeding yourself once food is ready." },
          { icon: "toilet", title: "Toileting", text: "Using the toilet or managing bowel and bladder." },
          { icon: "walk", title: "Walking or moving around", text: "From room to room on a level floor." },
          { icon: "transfer", title: "Transferring", text: "From bed to chair or wheelchair, and back." },
        ] },
      ] },
      { heading: "How much it pays", blocks: [
        { kind: "fact", source: 0, text: "Monthly payouts are higher the older you are when you make a successful claim. They rise each year until you turn 67 or claim, whichever is earlier, and are paid in cash so you can use them for the care you choose." },
        { kind: "fact", source: 0, text: "CPF Board's example: for someone born in 1980, a successful claim in 2026, at age 46, pays S$689 a month for life." },
      ] },
      { heading: "Premiums and claims", blocks: [
        { kind: "fact", source: 0, text: "Premiums can be paid in full from MediSave, and family can help from their own MediSave. You pay until age 67, or for 10 years after joining if later, and stay covered for life. Subsidies are available, and no one loses cover because they cannot afford premiums." },
        { kind: "fact", source: 0, text: "Claims are made online through the Agency for Integrated Care's portal with Singpass. The disability assessment costs S$100 at a clinic or S$250 for a house call; the first assessment is free, and the fee is refunded with the first payout if you are assessed as severely disabled." },
        { kind: "fact", source: 0, text: "Optional supplements can add to CareShield Life cover, for example with higher monthly payouts." },
      ] },
      { heading: "Check yourself", blocks: [
        { kind: "cards", prompt: "Tap each card.", cards: [
          { front: "Does CareShield Life pay my hospital bills?", back: "That is not what it is for. It pays monthly cash while you are severely disabled. MediShield Life is the scheme that helps with large hospital bills." },
          { front: "Do payouts stop if I move overseas?", back: "No. CPF Board says you stay covered, can claim and receive payouts wherever you live." },
          { front: "Who decides whether I qualify?", back: "A Ministry of Health-accredited assessor checks which daily activities you cannot do." },
        ] },
        { kind: "quiz", question: "How many of the six activities of daily living must a person be unable to do for CareShield Life to pay?",
          options: ["Any 1", "At least 3", "All 6"],
          answer: 1, explain: "Payouts start once an accredited assessor finds you cannot do at least 3 of the 6, and continue while that stays true." },
      ] },
    ],
  },
  {
    slug: "sg-dependants-protection-scheme",
    group: "singapore",
    icon: "family",
    region: SG,
    checkedOn: CHECKED,
    sources: [SRC.dps, SRC.dpsPremiums],
    keywords: ["dps", "dependants protection scheme", "dependant protection scheme", "dependents protection scheme", "cpf life insurance", "term life", "death", "terminal illness", "total permanent disability", "tpd"],
    title: "What is the Dependants' Protection Scheme?",
    summary: "Basic term life cover linked to CPF: who is covered, the sum assured, yearly premiums, and how to stop or claim.",
    sections: [
      { heading: "In one line", blocks: [
        { kind: "fact", source: 0, text: "The Dependants' Protection Scheme (DPS) is a term life insurance scheme. It gives you and your family basic financial protection if you die, or have a terminal illness or total permanent disability. It is run solely by Great Eastern Life." },
        { kind: "tiles", caption: "The three events DPS covers.", tiles: [
          { icon: "life", title: "Death", text: "Next of kin make the claim." },
          { icon: "illness", title: "Terminal illness", text: "When certified." },
          { icon: "disability", title: "Total permanent disability", text: "When certified." },
        ] },
      ] },
      { heading: "Who is covered", blocks: [
        { kind: "fact", source: 0, text: "Singapore Citizens and PRs aged 21 to 65 are covered automatically when a valid CPF working contribution is made. Those aged 16 to 65 who were not covered automatically can apply to Great Eastern Life directly; eligibility then depends on good health." },
      ] },
      { heading: "How much cover, and what it costs", blocks: [
        { kind: "fact", source: 1, text: "Members up to age 60 are covered for a sum assured of up to S$70,000. Above 60 and up to 65, it is up to S$55,000." },
        { kind: "table", source: 1, caption: "Yearly DPS premium by age at last birthday", head: ["Age", "Yearly premium", "Sum assured"], rows: [
          ["34 and below", "S$18", "S$70,000"], ["35 to 39", "S$30", "S$70,000"], ["40 to 44", "S$50", "S$70,000"],
          ["45 to 49", "S$93", "S$70,000"], ["50 to 54", "S$188", "S$70,000"], ["55 to 59", "S$298", "S$70,000"], ["60 to 64", "S$298", "S$55,000"],
        ] },
        { kind: "fact", source: 1, text: "Cover lasts one year at a time and is renewed automatically each year before your 65th birthday." },
      ] },
      { heading: "Keeping it, or stopping it", blocks: [
        { kind: "fact", source: 0, text: "DPS is not compulsory. You can end it at any time by contacting Great Eastern Life. To rejoin later you must declare your health, and cover depends on good health." },
        { kind: "fact", source: 0, text: "Premiums rise with age. CPF Board's examples of people who may not need DPS: those whose dependants are grown up and independent, those with enough savings to leave their dependants, and those with enough private life or term insurance." },
        { kind: "fact", source: 0, text: "From early 2025, the CPF Special Account closes at age 55, which may affect how your DPS premium is paid. CPF Board suggests arranging another way to pay if you want to keep the cover." },
      ] },
      { heading: "Check yourself", blocks: [
        { kind: "cards", prompt: "Tap each card.", cards: [
          { front: "Do I have to sign up for DPS?", back: "If you are a Citizen or PR aged 21 to 65, cover starts automatically with a valid CPF working contribution." },
          { front: "Who makes a claim if the member dies?", back: "The member's next of kin. CPF Board points to Great Eastern Life's DPS pages for how to claim." },
          { front: "Is DPS my only life cover?", back: "Check your documents. Many people also hold private life or term policies; DearPolicy can list the ones you upload." },
        ] },
        { kind: "quiz", question: "A member is 62. What is the most DPS covers them for?",
          options: ["S$70,000", "S$55,000", "Nothing: cover ends at 60"],
          answer: 1, explain: "Members above 60 and up to 65 are covered for up to S$55,000; up to 60 it is S$70,000." },
      ] },
    ],
  },
];
