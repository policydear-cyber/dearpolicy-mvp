/**
 * Claims by type: one short guide for each common kind of claim a household makes.
 *
 * GENERAL EDUCATION ONLY, under the same rules as the other general guides (checked by
 * scripts/learn/learn-content-test.ts): insurer-neutral and market-neutral, no currency, every figure in a labelled
 * example, never says what a particular policy pays, and never invents what an insurer will ask for. Where policies
 * differ it says "many policies" or "check your policy". The household's own wording and the insurer decide.
 */
import type { LearnGuide } from "./content";

export const CLAIM_GUIDES: LearnGuide[] = [
  {
    slug: "claims-hospital-stay",
    group: "claims",
    icon: "hospital",
    keywords: ["hospital", "hospitalisation", "hospitalization", "admitted", "admission", "surgery", "operation", "inpatient", "ward", "room", "pre-authorisation", "letter of guarantee", "panel hospital", "discharge"],
    title: "Hospital stays and surgery",
    summary: "What to check before a hospital stay, what a hospital plan usually counts, and what can make it pay less.",
    sections: [
      { heading: "Before you go in", blocks: [
        { kind: "p", text: "For planned treatment there is usually time to check a few things first. In an emergency, get treatment first and tell the insurer as soon as you reasonably can." },
        { kind: "steps", caption: "Worth checking before a planned stay. Your policy wording has the details.", steps: [
          { icon: "search", title: "Which policies may help", text: "A hospital plan, an accident policy, hospital cash, an employer's plan." },
          { icon: "approve", title: "Approval first?", text: "Some plans need pre-authorisation for planned treatment." },
          { icon: "hospital", title: "Room or ward", text: "The room type your plan covers, and what happens above it." },
          { icon: "person", title: "Panel or network", text: "Some plans pay more, or pay the hospital directly, for listed hospitals and doctors." },
          { icon: "receipt", title: "Estimated bill", text: "Many hospitals can give an estimate to compare with your plan's limits." },
        ] },
      ] },
      { heading: "What a hospital plan usually counts", blocks: [
        { kind: "tiles", caption: "Common parts of a hospital bill. Each plan has its own list and limits.", tiles: [
          { icon: "hospital", title: "Room and board", text: "Often with a daily limit or a set room type." },
          { icon: "conditions", title: "Surgery and doctors", text: "Surgeon, anaesthetist and doctors' fees." },
          { icon: "search", title: "Tests and medicines", text: "Scans, lab tests and medicines while admitted." },
          { icon: "daily", title: "Before and after", text: "Related visits within a set time before admission and after discharge." },
          { icon: "approve", title: "Day surgery", text: "Treatment without an overnight stay. Many plans count it." },
        ] },
      ] },
      { heading: "What can make it pay less", blocks: [
        { kind: "list", items: [
          "A deductible you pay first, and a co-payment share of the rest.",
          "Limits: per stay, per year, per lifetime, and smaller sub-limits for items such as the room.",
          "A room or ward above what the plan covers. Some policies then pay a reduced share of the whole bill, not only of the room charge.",
          "Charges the insurer considers above what is reasonable and customary for that treatment.",
          "Waiting periods, pre-existing conditions and exclusions in the wording.",
        ] },
        { kind: "example", text: "Example only, not anyone's policy: a covered bill of 20,000 with a deductible of 2,000 and a 10% co-payment. The policy would pay 18,000 less 1,800, so 16,200, if no lower limit or reduction applies." },
        { kind: "bill-split" },
      ] },
      { heading: "After you leave", blocks: [
        { kind: "list", items: [
          "Keep the itemised bill and the papers the hospital gives you at discharge.",
          "If the hospital did not claim directly, send the claim within the time your policy sets. Its claims section says how.",
          "Follow-up visits for the same condition may count under the plan's after-discharge benefit, within the time it states.",
          "A hospital cash or accident policy is claimed separately, under its own terms.",
        ] },
        { kind: "cards", prompt: "Myth or fact? Tap each card.", cards: [
          { front: "\"My hospital plan pays the whole bill.\"", back: "Usually not all of it. A deductible, a co-payment and limits often apply. Your schedule and wording set them." },
          { front: "\"A bigger room only costs me the difference in room price.\"", back: "Not always. Some policies pay a reduced share of the whole bill when the room is above the plan's level. Check your wording." },
          { front: "\"Visits after I go home are never covered.\"", back: "Many hospital plans cover related visits for a set time after discharge. The wording states how long." },
        ] },
        { kind: "quiz", question: "Surgery is planned for next month. What is most worth checking first?",
          options: ["Whether the plan needs approval before treatment, and which room it covers", "Nothing until after the surgery", "Only the hospital's parking"],
          answer: 0, explain: "Some plans need pre-authorisation and pay less without it, and a room above the plan's level can reduce what is paid. Your policy wording says what yours needs." },
      ] },
    ],
  },
  {
    slug: "claims-clinic-visits",
    group: "claims",
    icon: "receipt",
    keywords: ["clinic", "outpatient", "out-patient", "doctor", "gp", "general practitioner", "specialist", "consultation", "physiotherapy", "dental", "dentist", "scan", "panel clinic"],
    title: "Clinic and outpatient visits",
    summary: "Why a hospital plan may not pay for clinic visits, where outpatient cover usually comes from, and what limits it.",
    sections: [
      { heading: "In one line", blocks: [
        { kind: "p", text: "Many hospital plans pay only when you are admitted, or for a short list of costly outpatient treatments. Everyday clinic visits are often covered, if at all, by a separate outpatient benefit." },
      ] },
      { heading: "Where outpatient cover comes from", blocks: [
        { kind: "tiles", caption: "Places outpatient cover is often found. Check each policy you hold.", tiles: [
          { icon: "rider", title: "A rider", text: "An outpatient add-on to a hospital plan." },
          { icon: "family", title: "An employer's plan", text: "Group cover through work, sometimes for family too." },
          { icon: "accident", title: "An accident policy", text: "Medical costs after an accident, up to a limit." },
          { icon: "hospital", title: "After a hospital stay", text: "Related visits for a set time after discharge." },
          { icon: "illness", title: "Listed costly treatments", text: "Some hospital plans list treatments such as dialysis or cancer therapy." },
        ] },
      ] },
      { heading: "What usually limits it", blocks: [
        { kind: "list", items: [
          "A limit per visit and a limit per year.",
          "A list of what counts: for example a general doctor, a specialist, tests, medicines, physiotherapy or dental care. Each may have its own limit.",
          "Panel clinics: some plans pay the clinic directly, or pay more, when you use listed clinics.",
          "A referral: some plans pay for a specialist only after a referral from a general doctor.",
          "A co-payment or a fixed amount you pay per visit.",
        ] },
        { kind: "cards", prompt: "Tap each card.", cards: [
          { front: "My hospital plan says nothing about clinic visits. Am I covered?", back: "Not by that plan, most likely, but missing information is not an exclusion. Check any rider, employer plan or accident policy." },
          { front: "Does seeing a specialist need a referral?", back: "Some plans require one before they pay. The plan's wording or benefit table says so if it does." },
          { front: "Can a follow-up after a hospital stay be claimed?", back: "Often, under the hospital plan's after-discharge benefit, for the time it states and for the same condition." },
        ] },
        { kind: "quiz", question: "A child sees a doctor at a clinic for a fever and goes home the same day. Which cover most often handles this?",
          options: ["A hospital plan's inpatient benefit", "An outpatient benefit, if the household has one", "A critical illness policy"],
          answer: 1, explain: "Hospital plans mostly pay when you are admitted. A visit like this falls under an outpatient benefit, such as a rider or an employer's plan, if one is held." },
      ] },
    ],
  },
  {
    slug: "claims-accident",
    group: "claims",
    icon: "accident",
    keywords: ["accident", "injury", "injured", "broken arm", "broken leg", "fracture", "fell", "fall", "burns", "dislocation", "personal accident", "pa", "accidental death", "sprain"],
    title: "Accidents and injuries",
    summary: "What an accident policy usually pays for, how a table of injuries works, and claiming from more than one policy.",
    sections: [
      { heading: "What counts as an accident", blocks: [
        { kind: "p", text: "Accident policies usually mean an injury caused suddenly by something external, unexpected and not intended, as the policy defines it. An illness is not an accident, and some policies exclude injuries from certain activities. The definition in your wording is what counts." },
      ] },
      { heading: "What accident policies usually pay", blocks: [
        { kind: "tiles", caption: "Common parts of an accident policy. Not every policy has all of them.", tiles: [
          { icon: "receipt", title: "Medical costs", text: "Treatment after the accident, paid back up to a limit." },
          { icon: "percent", title: "Listed injuries", text: "A set amount or a percentage for injuries in a table, such as some fractures or burns." },
          { icon: "disability", title: "Permanent disability", text: "A percentage of the sum assured for a listed permanent loss." },
          { icon: "daily", title: "Hospital cash", text: "A set amount per day in hospital after an accident." },
          { icon: "life", title: "Accidental death", text: "A sum paid if the accident causes death, often within a set time." },
        ] },
        { kind: "example", text: "Example only, not anyone's policy: if a table lists 10% of the sum assured for an injury and the sum assured is 100,000, the illustrated amount is 10,000, in the policy's own currency." },
        { kind: "percent-of-sum" },
      ] },
      { heading: "More than one policy", blocks: [
        { kind: "list", items: [
          "One accident can fall under an accident policy, a hospital plan and an employer's plan at once.",
          "Fixed amounts, such as for a listed injury or for each day in hospital, are usually paid by each policy on its own terms.",
          "The same medical bill is usually not paid back twice. Policies set rules on sharing it, and may ask what another policy paid.",
          "Tell each insurer early: many accident policies set a time limit for telling them.",
        ] },
        { kind: "cards", prompt: "Tap each card.", cards: [
          { front: "Is a slipped disc from lifting a box an accident?", back: "It depends on the wording. Many policies need an external, sudden cause; some exclude conditions that develop gradually. The insurer decides." },
          { front: "Does the injury table pay whatever my bills were?", back: "No. A table pays its stated amount or percentage for that injury. Medical costs are a separate benefit, paid back up to its limit." },
          { front: "Can my hospital plan and accident policy both respond?", back: "Often, yes, each under its own terms. The same bill is usually not paid back twice." },
        ] },
        { kind: "quiz", question: "Someone breaks an arm in a fall and has both an accident policy and a hospital plan. What is true?",
          options: ["Only one policy can ever respond", "Both may respond, each on its own terms", "The bigger policy pays everything"],
          answer: 1, explain: "Each policy is read on its own: the accident policy may pay a listed amount and medical costs, the hospital plan may pay a covered stay. The same bill is usually not repaid twice." },
      ] },
    ],
  },
  {
    slug: "claims-critical-illness",
    group: "claims",
    icon: "illness",
    keywords: ["critical illness", "ci", "cancer", "heart attack", "stroke", "diagnosis", "diagnosed", "early stage", "early critical illness", "dread disease", "major illness", "multipay"],
    title: "Critical illness diagnosis",
    summary: "How a critical illness claim works: the policy's definition, stages, waiting and survival periods, and the effect on other cover.",
    sections: [
      { heading: "How it usually pays", blocks: [
        { kind: "p", text: "Critical illness cover usually pays a lump sum when a diagnosis meets the policy's own definition of a listed illness. It does not depend on the treatment bills. The definition matters: it can set a severity, a test result or a specialist's confirmation." },
        { kind: "flow", caption: "The usual checks, in order. The insurer decides each one.", items: [
          { icon: "illness", title: "Diagnosis", text: "A listed illness, confirmed as the policy requires." },
          { icon: "conditions", title: "Meets the definition", text: "Severity or stage as the wording sets out." },
          { icon: "daily", title: "Periods met", text: "Outside any waiting period, and any survival period passed." },
          { icon: "insurer", title: "Insurer decides", text: "Checks the claim against the terms." },
        ] },
      ] },
      { heading: "Stages and other cover", blocks: [
        { kind: "list", items: [
          "Some policies pay at early or intermediate stages, often a smaller share of the sum assured. A later claim for a severe stage may then be reduced by what was paid.",
          "If critical illness is part of a life policy, a claim often brings forward, and so reduces, the death cover. A separate critical illness policy usually does not.",
          "Some policies pay more than once, for different illnesses or a recurrence, under their own rules.",
          "Some policies or riders stop collecting premiums after a covered diagnosis. Check for a waiver of premium.",
        ] },
        { kind: "example", text: "Example only, not anyone's policy: a life policy with a sum assured of 200,000 includes critical illness cover of 100,000 that brings the death cover forward. After a claim of 100,000, the death cover left would be 100,000." },
        { kind: "cards", prompt: "Tap each card.", cards: [
          { front: "My diagnosis is on the list. Does that settle it?", back: "Not on its own. The diagnosis must meet the policy's definition, and any waiting or survival period applies. The insurer decides." },
          { front: "Does it pay back my treatment costs?", back: "Usually not. It pays a set lump sum. Treatment bills are for a hospital or medical plan." },
          { front: "Will a claim affect my life cover?", back: "It can, if the critical illness benefit brings the death cover forward. The schedule and wording say which kind you hold." },
        ] },
        { kind: "quiz", question: "A policy has a waiting period for critical illness. A diagnosis happens during it. What usually follows?",
          options: ["The full amount is paid", "That diagnosis is often not covered, or only partly", "The waiting period is ignored"],
          answer: 1, explain: "A waiting period means some illnesses diagnosed soon after cover starts are not covered, or only partly. The length and effect are set by the policy." },
      ] },
    ],
  },
  {
    slug: "claims-death",
    group: "claims",
    icon: "life",
    keywords: ["death", "died", "passed away", "deceased", "funeral", "life claim", "death claim", "beneficiary", "nominee", "nomination", "estate", "terminal illness", "bereavement"],
    title: "When a family member dies",
    summary: "Finding every policy that may pay, who receives the money, and what usually happens next.",
    sections: [
      { heading: "Finding every policy", blocks: [
        { kind: "p", text: "After a death, families are often unsure which policies exist. It is worth looking widely, without rushing: many policies give a reasonable time to claim." },
        { kind: "tiles", caption: "Places death cover is often found. Some are easy to miss.", tiles: [
          { icon: "life", title: "Life policies", text: "Term or whole-life cover, and any riders." },
          { icon: "accident", title: "Accident policies", text: "Pay more if the death was caused by an accident." },
          { icon: "family", title: "Work", text: "Group cover through an employer." },
          { icon: "home", title: "Loans and mortgages", text: "Cover linked to a home loan or other borrowing." },
          { icon: "shield", title: "National schemes", text: "Some countries run schemes that pay on death." },
          { icon: "savings", title: "Savings policies", text: "Endowment and investment-linked policies often pay on death too." },
        ] },
      ] },
      { heading: "Who receives the money", blocks: [
        { kind: "list", items: [
          "If a beneficiary or nominee was named, the insurer usually pays them, under the policy's terms and local law.",
          "If no one was named, the money usually goes to the person's estate and is handled under local inheritance rules.",
          "The insurer tells the claimant what it needs. Its claim form and claims section are the guide.",
          "Policies the person owned on someone else's life, such as a child's policy, do not end with the owner's death. Ownership usually needs to pass to someone; ask the insurer how.",
        ] },
      ] },
      { heading: "Good to know", blocks: [
        { kind: "list", items: [
          "Some life policies pay part of the sum assured early on diagnosis of a terminal illness. If that was paid, the death payment is usually reduced by it.",
          "A dated certificate shows the cover on its date. The insurer confirms whether the policy was still in force at the time of death.",
          "Tell each insurer once you are ready. Until they know, premiums may keep being collected; they explain how that is handled.",
        ] },
        { kind: "cards", prompt: "Tap each card.", cards: [
          { front: "\"There was only one policy.\"", back: "Check widely: riders, accident policies, cover through work, loan-linked cover and savings policies often pay on death too." },
          { front: "\"The money goes to the spouse automatically.\"", back: "It depends on who was named and on local law. With no named beneficiary, it usually goes to the estate." },
          { front: "\"The claim must be made within days.\"", back: "Policies set their own time limits, usually giving a reasonable time. The claims section states yours." },
        ] },
        { kind: "quiz", question: "A parent owned a policy insuring their child, and the parent has died. What usually happens to the child's policy?",
          options: ["It ends automatically", "It continues, and ownership needs to pass to someone", "It pays out the death benefit"],
          answer: 1, explain: "The child is the life insured and is alive, so the policy usually continues. Ask the insurer how ownership passes; the policy and local law decide." },
      ] },
    ],
  },
  {
    slug: "claims-disability",
    group: "claims",
    icon: "disability",
    keywords: ["disability", "disabled", "tpd", "total and permanent disability", "cannot work", "unable to work", "income protection", "activities of daily living", "adl", "waiver of premium", "long-term care"],
    title: "Disability and being unable to work",
    summary: "Lump-sum disability cover, income protection and premium waivers, and how policies define being disabled.",
    sections: [
      { heading: "Three kinds of help", blocks: [
        { kind: "tiles", caption: "Different covers respond to disability in different ways.", tiles: [
          { icon: "fixed", title: "Lump sum", text: "Total and permanent disability cover pays a set amount once." },
          { icon: "income", title: "Income", text: "Income protection pays part of your income each month." },
          { icon: "shield", title: "Premium waiver", text: "Future premiums of a policy stop being collected." },
        ] },
      ] },
      { heading: "How policies define disabled", blocks: [
        { kind: "p", text: "Each policy sets its own test, and it decides the claim. Common ones are being unable to do your own job, being unable to do any job you are suited for, or being unable to do a number of everyday activities." },
        { kind: "tiles", caption: "Everyday activities many policies list. The policy says how many must be affected, and for how long.", tiles: [
          { icon: "wash", title: "Washing", text: "Bathing or showering." },
          { icon: "dress", title: "Dressing", text: "Putting on and taking off clothes." },
          { icon: "feed", title: "Feeding", text: "Eating once food is prepared." },
          { icon: "toilet", title: "Toileting", text: "Using the toilet." },
          { icon: "walk", title: "Walking or moving around", text: "Getting from room to room." },
          { icon: "transfer", title: "Transferring", text: "Moving from a bed to a chair." },
        ] },
      ] },
      { heading: "Timing", blocks: [
        { kind: "list", items: [
          "Many disability covers pay only after the disability has lasted a set time, so that it can be seen to be permanent.",
          "Income protection usually starts paying after a deferred period, and then pays for a set time or up to an age.",
          "Some covers end, or change their test, from a stated age.",
          "Tell the insurer early. Waiting for the period to pass before telling them can cause problems with time limits.",
        ] },
        { kind: "cards", prompt: "Tap each card.", cards: [
          { front: "My doctor says I cannot work. Is that enough?", back: "The policy's own test decides. A doctor's view is part of the evidence; the insurer decides whether the definition is met." },
          { front: "Does a waiver of premium pay me money?", back: "Not directly. It stops future premiums of a policy being collected while the condition applies, so the cover continues." },
          { front: "Can I claim straight away?", back: "You can tell the insurer straight away. Many covers pay only after the disability has lasted the period the policy sets." },
        ] },
        { kind: "quiz", question: "Which cover usually replaces part of a monthly income while someone cannot work?",
          options: ["Total and permanent disability cover", "Income protection", "Critical illness cover"],
          answer: 1, explain: "Income protection pays a monthly amount after a deferred period. Total and permanent disability cover usually pays one lump sum." },
      ] },
    ],
  },
  {
    slug: "claims-travel",
    group: "claims",
    icon: "travel",
    keywords: ["travel", "trip", "holiday", "vacation", "overseas", "abroad", "flight delay", "cancelled flight", "cancellation", "lost luggage", "baggage", "passport", "emergency assistance"],
    title: "Travel claims",
    summary: "Medical problems abroad, cancelled or delayed trips, and lost belongings: what to do at the time and afterwards.",
    sections: [
      { heading: "What travel cover usually includes", blocks: [
        { kind: "tiles", caption: "Common sections of a travel policy. Each has its own limit.", tiles: [
          { icon: "hospital", title: "Medical abroad", text: "Treatment and, sometimes, bringing you home." },
          { icon: "renewal", title: "Cancellation", text: "Costs lost if the trip is called off for a listed reason." },
          { icon: "daily", title: "Delay", text: "A set amount after a delay of a stated length." },
          { icon: "keep", title: "Belongings", text: "Lost, stolen or damaged luggage and items." },
          { icon: "person", title: "Liability", text: "If you are held responsible for harm to others." },
        ] },
      ] },
      { heading: "At the time", blocks: [
        { kind: "steps", caption: "What helps most while still travelling. Your policy has the details.", steps: [
          { icon: "tell", title: "Medical emergency", text: "Call the emergency assistance number on the policy, if it has one." },
          { icon: "read", title: "Theft or loss", text: "Many policies ask for a report made at the time, such as to the police, the airline or the hotel." },
          { icon: "keep", title: "Keep records", text: "Receipts, the carrier's notice of a delay or cancellation, and booking details." },
          { icon: "decide", title: "Claim after", text: "Within the time the policy sets, once you are back." },
        ] },
      ] },
      { heading: "Good to know", blocks: [
        { kind: "list", items: [
          "Cancellation cover usually starts when the policy is bought, so buying it early matters.",
          "Pre-existing conditions are often excluded or limited unless declared and accepted.",
          "Some activities, such as certain sports, may need extra cover or be excluded.",
          "Valuables often have a lower limit per item, and may not be covered if left unattended.",
        ] },
        { kind: "cards", prompt: "Tap each card.", cards: [
          { front: "Is any cancellation reason covered?", back: "Usually only the reasons the policy lists, such as serious illness. Changing your mind is usually not one." },
          { front: "My bag was stolen. Do I need to do anything at the time?", back: "Many policies ask for a report made at the time to the police or carrier. Your policy says what it needs." },
          { front: "Does travel cover replace my hospital plan?", back: "They are separate. Some hospital plans cover treatment abroad too; check both, and what each says about the other." },
        ] },
        { kind: "quiz", question: "A flight is delayed. What is most useful to keep for a delay claim?",
          options: ["The carrier's written notice of the delay and its length", "A photo of the departure board only", "Nothing: delays are always paid automatically"],
          answer: 0, explain: "Delay benefits usually depend on the length of the delay and its cause. A written notice from the carrier shows both. Your policy says what it needs." },
      ] },
    ],
  },
  {
    slug: "claims-home-motor",
    group: "claims",
    icon: "home",
    keywords: ["home", "house", "contents", "building", "fire", "flood", "water damage", "burglary", "theft", "car", "motor", "vehicle", "accident", "collision", "no claim discount", "ncd", "excess", "under-insurance"],
    title: "Home and motor claims",
    summary: "What to do after damage, a break-in or a road accident, and how under-insurance and no-claim discounts work.",
    sections: [
      { heading: "Straight after", blocks: [
        { kind: "steps", caption: "What usually helps. Your policy and local rules set the details.", steps: [
          { icon: "shield", title: "Make safe", text: "Stop further damage where you safely can, such as turning off water." },
          { icon: "keep", title: "Record it", text: "Photos of the damage, and details of anyone else involved." },
          { icon: "tell", title: "Tell the insurer early", text: "Many policies set a time limit, and some need a report to the police." },
          { icon: "approve", title: "Before repairs", text: "Ask whether the insurer wants to inspect, and keep damaged items until it says." },
        ] },
        { kind: "list", items: [
          "After a road accident, many motor policies ask you not to admit fault or offer payment at the scene. The insurer handles the other side's claim.",
          "Emergency repairs to stop more damage are usually expected. Larger repairs are often agreed with the insurer first.",
        ] },
      ] },
      { heading: "What can reduce the payment", blocks: [
        { kind: "list", items: [
          "An excess, or deductible, you pay on each claim.",
          "Under-insurance: if the amount insured is less than the real value, some policies pay only a share of each claim.",
          "Limits for single valuable items, and items not listed when the policy needs them listed.",
          "Wear and tear, and gradual damage, which many policies exclude.",
        ] },
        { kind: "example", text: "Example only, not anyone's policy: a home is insured for 50,000 but would cost 100,000 to rebuild. Under a policy with an under-insurance rule, a covered claim of 10,000 might be reduced to half, 5,000, before any excess." },
        { kind: "p", text: "A motor claim can also reduce a no-claim discount at renewal, depending on the policy and who was at fault." },
        { kind: "cards", prompt: "Tap each card.", cards: [
          { front: "\"Insuring for less saves money and changes nothing.\"", back: "It can reduce every claim, not only large ones, if the policy has an under-insurance rule." },
          { front: "\"I should repair everything first, then claim.\"", back: "Stop further damage, but many insurers want to see the damage or agree larger repairs first. Ask before you start." },
          { front: "\"A small claim never affects my discount.\"", back: "It can. Some motor policies reduce a no-claim discount after any claim; the policy says how." },
        ] },
        { kind: "quiz", question: "Example only: a home is insured for half of what it would cost to rebuild, and the policy has an under-insurance rule. A covered claim of 10,000 is made. What might be paid, before any excess?",
          options: ["10,000", "5,000", "Nothing"],
          answer: 1, explain: "With an under-insurance rule, a policy insured for half the real value may pay half of each claim. Policies differ, and the insurer decides." },
      ] },
    ],
  },
];
