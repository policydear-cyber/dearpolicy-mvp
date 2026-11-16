/**
 * More general guides for the "Start here" and "Amounts and claims" shelves.
 *
 * GENERAL EDUCATION ONLY. Same rules as lib/learn/content.ts (checked by scripts/learn/learn-content-test.ts):
 * insurer- and market-neutral, no currency, figures only in blocks labelled "Example only", and never what a
 * particular policy pays. Where policies differ, say so.
 */
import type { LearnGuide } from "./content";

export const BASIC_GUIDES: LearnGuide[] = [
  {
    slug: "who-is-who",
    group: "start",
    icon: "family",
    keywords: ["policyholder", "policy owner", "life insured", "insured person", "life assured", "beneficiary", "nominee", "payer", "who is covered", "whose policy", "child policy", "parent pays", "family member", "link document"],
    title: "Who's who on a policy",
    summary: "The policy owner, the person insured and the person paid can be three different people. Here is how to tell them apart.",
    sections: [
      { heading: "Three roles, sometimes three people", blocks: [
        { kind: "p", text: "Every policy names who owns it and whose life, health or property it covers. Life policies also name who receives the money if the insured person dies. In a family these are often different people." },
        { kind: "tiles", caption: "The roles a policy names. One person can hold more than one.", tiles: [
          { icon: "schedule", title: "Policy owner", text: "Owns the policy, usually pays for it, and can make changes." },
          { icon: "person", title: "Person insured", text: "Whose life, health or injury the policy covers." },
          { icon: "family", title: "Beneficiary", text: "Who receives the money if the insured person dies." },
        ] },
        { kind: "example", text: "Example only: a parent owns and pays for a policy that insures their child. The parent is the policy owner, the child is the person insured, and the cover is the child's." },
      ] },
      { heading: "Where to find each name", blocks: [
        { kind: "steps", caption: "Most schedules list these near the top. The words used differ between insurers.", steps: [
          { icon: "schedule", title: "Look for the owner", text: "Often called policyholder, policy owner or proposer." },
          { icon: "person", title: "Look for the insured", text: "Often called life insured, life assured, insured person or covered member." },
          { icon: "family", title: "Look for the beneficiary", text: "Often in a nomination or beneficiary section, or a separate form." },
          { icon: "conditions", title: "Check each benefit", text: "A family plan can cover several people, each with their own amounts." },
        ] },
      ] },
      { heading: "Why it matters", blocks: [
        { kind: "list", items: [
          "When you ask what a policy covers, the answer depends on who the person insured is. A policy in your name may insure someone else.",
          "The same policy number can still cover different people or products. Each person's cover has its own amounts and conditions.",
          "If the policy owner and the person insured are different, the policy owner is usually the one who can make changes or end the policy.",
          "Naming a beneficiary works differently between policies and places. Your policy, and the law where you live, set the rules.",
        ] },
        { kind: "cards", prompt: "Who is it? Tap each card.", cards: [
          { front: "The policy is in my name, so it covers me.", back: "Not always. The policy owner and the person insured can be different people. The schedule names the person insured." },
          { front: "My child's policy is paid from my account. Whose cover is it?", back: "The child's, if the child is the person insured. You may be the policy owner." },
          { front: "Two family members share one policy number. Is it one cover?", back: "Not necessarily. A family plan can cover several people, each with their own benefits and amounts." },
        ] },
        { kind: "quiz", question: "A grandparent owns a policy insuring their grandchild. Who is covered if the grandchild is hospitalised?",
          options: ["The grandparent", "The grandchild", "Both of them"],
          answer: 1, explain: "The person insured is the one whose health the policy covers. Here that is the grandchild; the grandparent owns the policy." },
      ] },
      { heading: "How DearPolicy uses this", blocks: [
        { kind: "p", text: "When you link a document to a family member, DearPolicy keeps that person's cover separate from everyone else's, even when policies share a number. Link each document to the person it insures, not the person who pays." },
      ] },
    ],
  },
  {
    slug: "life-policy-kinds",
    group: "start",
    icon: "life",
    keywords: ["term life", "term insurance", "whole life", "endowment", "savings plan", "cash value", "surrender value", "maturity", "life insurance types", "difference between term and whole life"],
    title: "Term, whole life and endowment",
    summary: "Three common kinds of life policy, what each is built to do, and the words in your documents that tell them apart.",
    sections: [
      { heading: "Three shapes of life cover", blocks: [
        { kind: "tiles", caption: "How the three kinds commonly differ. Your own policy says exactly what it does.", tiles: [
          { icon: "renewal", title: "Term", text: "Cover for a set period. Usually no money back if nothing happens." },
          { icon: "life", title: "Whole life", text: "Cover for life, or to a high age. Often builds a cash value." },
          { icon: "savings", title: "Endowment", text: "Saving for a set period, with life cover. Pays out at the end." },
        ] },
      ] },
      { heading: "What happens over time", blocks: [
        { kind: "flow", caption: "A term policy, in general: cover runs for the term, then stops unless renewed.", items: [
          { icon: "approve", title: "Cover starts", text: "On the date in the schedule." },
          { icon: "shield", title: "Covered for the term", text: "For the events the policy lists." },
          { icon: "renewal", title: "Term ends", text: "Cover stops, unless the policy lets you renew or convert." },
        ] },
        { kind: "flow", caption: "An endowment or whole-life policy, in general: part of what you pay builds value over time.", items: [
          { icon: "income", title: "Premiums paid", text: "Part pays for cover, part builds value." },
          { icon: "illustration", title: "Value builds", text: "Some is guaranteed; projected parts are not." },
          { icon: "savings", title: "Pay-out", text: "At maturity, on surrender, or on a claim." },
        ] },
      ] },
      { heading: "Words to look for in your documents", blocks: [
        { kind: "list", items: [
          "Policy term or cover period: how long the cover lasts.",
          "Maturity date: when an endowment ends and pays out.",
          "Guaranteed and non-guaranteed: projected values are not promised unless the document says they are guaranteed.",
          "Cash value or surrender value: what you may get back if you end the policy early. It is often less than the premiums paid, especially in early years.",
          "Riders: extra covers, such as critical illness, added to the main policy with their own amounts.",
        ] },
        { kind: "cards", prompt: "Myth or fact? Tap each card.", cards: [
          { front: "\"A term policy gives my money back at the end.\"", back: "Most term policies do not. Some products do, so check the wording for a maturity or return-of-premium benefit." },
          { front: "\"The projected value in my illustration is what I will get.\"", back: "Projected figures are not guaranteed unless the document says they are. They depend on assumed returns." },
          { front: "\"Ending a savings policy early returns what I paid.\"", back: "Often not. The surrender value can be less than the premiums paid, especially in early years." },
        ] },
        { kind: "quiz", question: "Which document line tells you a figure is not promised?",
          options: ["Sum assured", "Non-guaranteed", "Policy term"],
          answer: 1, explain: "Non-guaranteed values are projections. The insurer does not promise them; they depend on future returns." },
      ] },
    ],
  },
  {
    slug: "missed-premiums",
    group: "start",
    icon: "lapse",
    keywords: ["missed premium", "missed payment", "late payment", "grace period", "lapse", "lapsed", "lapsed policy", "reinstate", "reinstatement", "premium holiday", "automatic premium loan", "policy ended", "forgot to pay"],
    title: "Missed premiums and lapsed policies",
    summary: "What a grace period is, what lapsing means, and the questions to ask your insurer if a payment was missed.",
    sections: [
      { heading: "What usually happens", blocks: [
        { kind: "steps", caption: "The usual path after a missed premium. Your policy sets its own periods and options.", steps: [
          { icon: "daily", title: "Premium due", text: "The schedule says how often and when." },
          { icon: "clock", title: "Grace period", text: "Extra time to pay. Cover usually continues meanwhile." },
          { icon: "lapse", title: "Policy lapses", text: "If still unpaid, cover can end." },
          { icon: "renewal", title: "Reinstatement", text: "Some policies can be restarted, often with conditions." },
        ] },
        { kind: "p", text: "Some policies with a cash value can use it to keep the policy going for a while, for example by lending against it to pay the premium. Whether yours does, and what that costs, is in the policy wording." },
      ] },
      { heading: "If a payment was missed", blocks: [
        { kind: "list", items: [
          "Check the date the premium was due and the grace period in your policy wording.",
          "Ask the insurer whether the policy is still in force, and if not, whether it can be reinstated and on what terms.",
          "Ask whether anything changes on reinstatement, such as a new waiting period or a health declaration.",
          "If an event happened around the time of the missed payment, tell the insurer early and ask how they treat it.",
        ] },
        { kind: "tiles", caption: "Questions worth asking the insurer.", tiles: [
          { icon: "question", title: "Is my policy in force?", text: "And from what date, if not." },
          { icon: "renewal", title: "Can it be reinstated?", text: "And what conditions apply." },
          { icon: "clock", title: "Any new waiting period?", text: "Some illness covers restart one." },
        ] },
      ] },
      { heading: "Check yourself", blocks: [
        { kind: "cards", prompt: "Myth or fact? Tap each card.", cards: [
          { front: "\"One late payment ends my policy at once.\"", back: "Usually not. Many policies have a grace period during which cover continues while you pay." },
          { front: "\"A lapsed policy always restarts as it was.\"", back: "Not always. Reinstatement can come with conditions, such as a health declaration or a new waiting period." },
          { front: "\"If I stop paying a savings policy, I get all my money back.\"", back: "Often not. What you get back, if anything, depends on the policy's cash value and terms." },
        ] },
        { kind: "quiz", question: "A premium is a few days late and still within the grace period. What is usually true?",
          options: ["The cover usually continues while you pay", "The policy has ended", "The premium doubles"],
          answer: 0, explain: "During a grace period, many policies keep cover in force while the premium is paid. The length of the period is set by the policy." },
      ] },
    ],
  },
  {
    slug: "waiting-periods",
    group: "amounts",
    icon: "clock",
    keywords: ["waiting period", "waiting periods", "survival period", "pre-existing", "pre-existing condition", "preexisting", "declared condition", "new policy", "just bought", "when does cover start", "exclusion period", "moratorium"],
    title: "Waiting periods and pre-existing conditions",
    summary: "Why a new policy may not cover everything at once, what a survival period is, and how health you declared can matter.",
    sections: [
      { heading: "The timeline of a new policy", blocks: [
        { kind: "p", text: "Cover usually starts on the date in your schedule, but not every benefit starts at once. Illness covers often have a waiting period. Accidents often do not. Each policy sets its own." },
        { kind: "flow", caption: "How a waiting period commonly works for an illness benefit.", items: [
          { icon: "approve", title: "Cover starts", text: "On the start date in the schedule." },
          { icon: "clock", title: "Waiting period", text: "Some conditions are not covered, or only partly, during this time." },
          { icon: "shield", title: "Full benefit", text: "After the waiting period, on the policy's terms." },
        ] },
        { kind: "example", text: "Example only: a policy with a 90-day waiting period for illness starts on 1 March. An illness first diagnosed on 15 April falls inside the waiting period; one first diagnosed on 15 June falls after it. Your policy defines when the period starts and which conditions it applies to." },
      ] },
      { heading: "Survival periods", blocks: [
        { kind: "p", text: "Some illness covers pay only if the insured person lives for a stated number of days after diagnosis. This is different from a waiting period: it runs from the diagnosis, not from the start of the policy." },
        { kind: "tiles", caption: "Two different clocks. Many policies have one, both or neither.", tiles: [
          { icon: "clock", title: "Waiting period", text: "Runs from the start of cover, or from reinstatement." },
          { icon: "illness", title: "Survival period", text: "Runs from the date of diagnosis." },
        ] },
      ] },
      { heading: "Pre-existing conditions", blocks: [
        { kind: "list", items: [
          "A pre-existing condition is one that existed, or had symptoms, before cover started. Each policy defines it.",
          "Many policies exclude pre-existing conditions, cover them only after a time, or cover them only if they were declared and accepted.",
          "What you declared on the application matters. The insurer may have accepted a condition, excluded it, or charged more.",
          "A condition not mentioned in your documents is not, on that alone, excluded. Check the wording and any endorsement that names an exclusion.",
        ] },
        { kind: "cards", prompt: "Myth or fact? Tap each card.", cards: [
          { front: "\"My policy started, so everything is covered from day one.\"", back: "Not always. Many illness covers have a waiting period. The wording says which benefits it applies to and for how long." },
          { front: "\"A survival period is the same as a waiting period.\"", back: "No. A waiting period runs from the start of cover; a survival period runs from the diagnosis." },
          { front: "\"If I didn't mention a condition, it doesn't matter.\"", back: "It can matter. Insurers rely on what was declared. Ask your insurer if you are unsure what was declared." },
        ] },
        { kind: "quiz", question: "Example only: an illness cover with a 90-day waiting period starts on 1 January. A condition is first diagnosed on 20 January. What is most likely?",
          options: ["It falls inside the waiting period, so the benefit may not apply", "It is covered in full", "The policy is cancelled"],
          answer: 0, explain: "The diagnosis is inside the waiting period. Many policies do not cover, or only partly cover, conditions first diagnosed then. The insurer decides on the policy's terms." },
      ] },
    ],
  },
];
