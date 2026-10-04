/**
 * Round 10 battery: 150+ fresh questions and 10 multi-turn conversations about
 * the Chua household (scripts/r10/fixture.ts), whose documents arrived messy.
 * The truth is what the documents print (scripts/fixtures/r10/make.py); where
 * a scan prints a figure unclearly (S$12,5OO), the truth is that it is unclear.
 */
import { KOKLEONG as KL, BOONHUAT as BH, AHLIAN as AL } from "./fixture";

/** `unreadable`: the answer must say plainly that a named upload could not be read and what to do (r10 detector). */
export type Expect = { person?: string | null; mentions?: RegExp | RegExp[]; notMentions?: RegExp; unreadable?: "password" | "damaged" | "blurry" | "handwriting" | "heic"; status?: number };
export type Turn = { say: string; expect?: Expect };
export type Conversation = { name: string; member: string | null; scope?: "family"; account?: "other"; turns: Turn[] };

const NOT_FOUND = /(?:didn[’']t|did not|could not|couldn[’']t) find|not (?:found|stated|printed|shown) in|no .{0,40}(?:on file|in (?:your|the|her|his|\w+[’']s) documents)|isn[’']t (?:in|stated|printed|shown)|doesn[’']t (?:say|state|show|print)|don[’']t (?:say|state|show|print)|no (?:\w+ )?polic(?:y|ies)/i;
const Y = (person: string | null, mentions?: RegExp | RegExp[], notMentions?: RegExp): Expect => ({ person, mentions, notMentions });
/** A bill or claim figure presented as what a plan covers. */
const BILL_AS_COVER = /(?:cover(?:s|ed)?|limit|sum (?:insured|assured)|pays? up to)[^.]{0,40}S\$24,816\.40|S\$24,816\.40[^.]{0,30}(?:of cover|cover limit|sum insured|limit)/i;
/** The 2027 premium from the letter stated as what is paid now. */
const FUTURE_AS_NOW = /(?:currently|now|this year|current(?:ly)? (?:annual )?premium)[^.]{0,40}S\$2,736|S\$2,736[^.]{0,40}(?:this year|currently|for the current)/i;
const UNCLEAR = /unclear|not clear|can[’']t be read|couldn[’']t be read|could not be read|hard to read|check (?:it )?against|blurr|smudg|not (?:fully )?legible|illegible/i;

export function battery(): Conversation[] {
  const c: Conversation[] = [];
  const one = (name: string, member: string | null, say: string, expect?: Expect) => c.push({ name, member, turns: [{ say, expect }] });
  const qs = (group: string, member: string, list: [string, Expect][]) => { for (const [q, e] of list) one(group + ":" + q, member, q, e); };

  // ---- 1. SilverShield (Papa): the current 2026 schedule, read from the PDF, its photo a duplicate
  qs("shield", KL, [
    ["What is Papa's hospital plan deductible?", Y(BH, /S\$3,500/, /S\$3,000 (?:deductible|per policy year)|deductible[^.]{0,30}S\$3,000/)],
    ["How much co-insurance does my dad pay on SilverShield?", Y(BH, /10%/)],
    ["What ward is my father covered for?", Y(BH, /Class A|A ward/i)],
    ["What's the policy year limit on Papa's SilverShield?", Y(BH, /S\$1,000,000/, /S\$1,OOO/)],
    ["How many days before admission does Papa's plan cover?", Y(BH, /120 days/)],
    ["Post-hospitalisation days on dad's shield plan?", Y(BH, /365 days/)],
    ["What's the pro-ration if Papa goes to a private hospital?", Y(BH, /65%/)],
    ["How much is Papa's SilverShield premium now?", Y(BH, /S\$2,184/, FUTURE_AS_NOW)],
    ["How much of Papa's premium comes from MediSave?", Y(BH, /S\$1,800/)],
    ["What's the cash part of my father's SilverShield premium?", Y(BH, /S\$384/)],
    ["How much is the Assist Rider premium?", Y(BH, /S\$1,036/)],
    ["What's the maximum co-payment with Papa's rider?", Y(BH, /S\$3,000/)],
    ["What does the SilverShield Assist Rider pay?", Y(BH, /95%/)],
    ["When does Papa's SilverShield renew?", Y(BH, /1 April 2027|31 March 2027/, /31 March 2026|1 April 2026\b(?! to)/)],
    ["Is Papa's SilverShield still active?", Y(BH, /31 March 2027|1 April 2027|in force|active/i, /(?:expired|ended|lapsed) on 31 March 2026/i)],
    ["What's Papa's SilverShield policy number?", Y(BH, /MMA-SS-5520417/, /552O417/)],
    ["What is the deductible after Papa turns 81?", Y(BH, /S\$5,250/)],
    ["Does Papa's rider pay for pro-ration?", Y(BH, /not paid|pro-?ration/i)],
    ["Can Papa use MediSave for the rider premium?", Y(BH, /cash|cannot|can[’']t|not/i)],
    ["Which upload is Papa's current SilverShield schedule?", Y(BH, [/SilverShield_Schedule_2026\.pdf|2026/], /SilverShield_2025_photo\.png[^.]{0,40}(?:is|as) (?:the )?current/i)],
    ["I uploaded Papa's SilverShield schedule twice, a photo and the PDF. Which one do you use?", Y(BH, [/SilverShield_Schedule_2026\.pdf|PDF/i, /same|duplicate|copy/i])],
    ["Is the photo IMG_20260412_093015.jpg the same as the SilverShield PDF?", Y(BH, /same|duplicate|copy/i)],
    ["What was Papa's SilverShield premium last year?", Y(BH, [/2025/], /S\$1,962\.00(?! is unclear)/)],
    ["What period did the 2025 SilverShield photo cover?", Y(BH, /1 April 2025|31 March 2026/)],
  ]);
  // ---- 2. the insurer's letter: premium increase and rider withdrawn
  qs("letter", KL, [
    ["What did the insurer say in the letter about Papa's premium?", Y(BH, [/S\$2,736/, /1 April 2027/])],
    ["Is Papa's premium going up?", Y(BH, [/S\$2,736/, /S\$2,184/])],
    ["By how much will Papa's SilverShield premium increase?", Y(BH, /S\$552|S\$2,736/)],
    ["What happens to the SilverShield Assist Rider?", Y(BH, [/withdrawn|end|not be renewed/i, /31 March 2027|1 April 2027/])],
    ["Is Papa's rider being withdrawn?", Y(BH, /withdrawn|end|not be renewed/i)],
    ["When does the Assist Rider end?", Y(BH, /31 March 2027/)],
    ["What replacement rider did Merlion offer?", Y(BH, [/Care Rider/, /S\$1,412/])],
    ["By when must Papa apply for the Care Rider?", Y(BH, /28 February 2027/)],
    ["Does the letter change Papa's SilverShield cover?", Y(BH, /does not change|not change|unchanged|same/i)],
    ["What did Merlion's August letter say?", Y(BH, [/S\$2,736|premium/i, /rider/i])],
    ["Is the premium letter a policy?", Y(BH, /letter|not a policy|notice/i, /letter[^.]{0,30}covers/i)],
    ["Will Papa pay S$2,736 this year?", Y(BH, [/S\$2,184/, /1 April 2027/], FUTURE_AS_NOW)],
  ]);
  // ---- 3. the claim rejection letter
  qs("rejection", KL, [
    ["Why was Papa's knee operation claim rejected?", Y(BH, [/pre-?existing/i, /osteoarthritis|knee/i])],
    ["What did the insurer say in the rejection letter?", Y(BH, [/pre-?existing/i, /CLM-2026-118842|S\$0\.00|unable to admit|not admit|reject/i])],
    ["How much did Papa claim for the knee replacement?", Y(BH, /S\$24,816\.40/, BILL_AS_COVER)],
    ["How much will SilverShield pay for the knee claim?", Y(BH, /reject|declin|paying nothing|not admit|unable to admit|S\$0\.00|pre-?existing/i, BILL_AS_COVER)],
    ["When was Papa's osteoarthritis diagnosed according to the letter?", Y(BH, /18 November 2024/)],
    ["Can Papa appeal the claim decision?", Y(BH, /appeal|review|FIDReC/i)],
    ["What's the claim number on Papa's rejection?", Y(BH, /CLM-2026-118842/)],
    ["Is Papa's SilverShield cancelled because the claim was rejected?", Y(BH, /remains in force|still in force|not cancelled|in force/i)],
    ["What does pre-existing condition mean in Papa's policy wording?", Y(BH, /pre-?existing/i)],
    ["Does the rejection letter mean Papa has no hospital cover?", Y(BH, /remains in force|still|in force|SilverShield/i)],
    ["What is the deadline to appeal the knee claim?", Y(BH, /30 days|2 July 2026/)],
    ["Who can we go to if Merlion won't change its decision?", Y(BH, /FIDReC/)],
  ]);
  // ---- 4. the hospital bill
  qs("bill", KL, [
    ["How much was Papa's hospital bill?", Y(BH, /S\$24,816\.40/, BILL_AS_COVER)],
    ["What's the GST on Papa's Novena Heights bill?", Y(BH, /S\$2,049\.06/)],
    ["How much was the surgeon's fee on the bill?", Y(BH, /S\$9,200/)],
    ["How many days was Papa in hospital for the knee replacement?", Y(BH, /3 June|9 June|6 days/)],
    ["Papa's bill is S$24,816.40 - how much does his plan cover?", Y(BH, /reject|pre-?existing|S\$3,500|deductible/i, BILL_AS_COVER)],
    ["Is the hospital bill a policy?", Y(BH, /bill|not a policy|invoice/i, /Novena Heights Hospital (?:policy|plan) covers/i)],
    ["Does Novena Heights Hospital insure Papa?", Y(BH, /not an insurer|hospital|bill|no polic/i, /Novena Heights[^.]{0,30}(?:covers|insures) (?:him|Papa)/i)],
    ["How much do we still owe the hospital?", Y(BH, /S\$24,816\.40/)],
  ]);
  // ---- 5. Heritage Whole Life (in the bundle) and its e-statement with many small tables
  qs("wholelife", KL, [
    ["What's Papa's whole life sum assured?", Y(BH, /S\$80,000/)],
    ["How much is Papa's whole life policy worth if surrendered now?", Y(BH, /S\$92,580/)],
    ["What's the death benefit on Papa's Heritage Whole Life?", Y(BH, /S\$131,360|S\$80,000/)],
    ["What's the guaranteed cash value of Papa's whole life?", Y(BH, /S\$41,220/)],
    ["Does Papa still pay premiums for Heritage Whole Life?", Y(BH, /paid up|no further premium/i)],
    ["Is there a policy loan on Papa's whole life?", Y(BH, /S\$0\.00|no loan|none|nil\b/i)],
    ["How much can Papa borrow against his whole life plan?", Y(BH, /S\$37,098/)],
    ["What reversionary bonus was added in 2024?", Y(BH, /S\$1,115/)],
    ["Who is the nominee on Papa's whole life?", Y(BH, /Lee Ah Lian|Mama/)],
    ["Is the terminal bonus guaranteed?", Y(BH, /not guaranteed/i)],
    ["When did Papa's Heritage Whole Life start?", Y(BH, /12 March 1988|1988/)],
    ["How much premium has Papa paid in total for the whole life?", Y(BH, /S\$43,560/)],
  ]);
  // ---- 6. Golden Years CI (scanned PDF, no text layer, page 2 fed in sideways; OCR typos)
  qs("ci", KL, [
    ["What is Mama's critical illness sum assured?", Y(AL, /S\$50,000/, /S\$5O,000/)],
    ["How much does Mama's Golden Years pay for early stage cancer?", Y(AL, [/25%/], /S\$12,500(?! is unclear)|S\$12\b/)],
    ["What's the angioplasty benefit on Mama's CI policy?", Y(AL, /10%/, /S\$5,000(?! is unclear)|up to S\$5\b/)],
    ["What's the waiting period on Mama's CI plan?", Y(AL, /90 days/)],
    ["How much is Mama's CI premium?", Y(AL, /S\$1,248/)],
    ["When does Mama's Golden Years policy end?", Y(AL, /2035|age 85|unclear/i)],
    ["What's the policy number on Mama's critical illness plan?", Y(AL, /SSI-GY|unclear|couldn[’']t|could not|not (?:clear|printed)/i, /SSI-GY-7710293/)],
    ["When did Mama's CI cover start?", Y(AL, /2018|unclear|couldn[’']t|could not/i)],
    ["Is heart attack covered under Mama's Golden Years?", Y(AL, /heart attack|critical illness|37 conditions/i)],
    ["How many conditions does Mama's CI plan cover?", Y(AL, /37/)],
    ["Can you read Mama's scanned CI policy?", Y(AL, /Golden Years|scan/i)],
    ["When does Mama finish paying her CI premiums?", Y(AL, /1 July 2028|10 years/)],
  ]);
  // ---- 7. SeniorGuard PA (in the bundle)
  qs("pa", KL, [
    ["Does Mama have accident cover?", Y(AL, /SeniorGuard/)],
    ["What does SeniorGuard pay for accidental death?", Y(AL, /S\$50,000/)],
    ["How much for a fracture on Mama's accident plan?", Y(AL, /S\$1,500/)],
    ["If Mama falls at home, is it an accident?", Y(AL, /fall at home|accident/i)],
    ["Mama's accident hospital cash per day?", Y(AL, [/S\$80/, /60 days/])],
    ["Does Mama's PA cover TCM?", Y(AL, /S\$300/)],
    ["What's the accidental medical expenses limit for Mama?", Y(AL, /S\$3,000/)],
    ["How much is Mama's SeniorGuard premium?", Y(AL, /S\$312/)],
    ["When does Mama's SeniorGuard end?", Y(AL, /31 December 2026/)],
    ["Is Papa covered by SeniorGuard?", Y(BH, /SeniorGuard[^.]{0,80}(?:Mama|Lee Ah Lian|Ah Lian)|not find|didn[’']t find|no|isn[’']t/i, /SeniorGuard[^.]{0,40}covers (?:Papa|Chua Boon Huat|him)/i)],
  ]);
  // ---- 8. CareCash (pages out of order)
  qs("carecash", KL, [
    ["How much does Mama's CareCash pay per day in hospital?", Y(AL, /S\$200/)],
    ["What does CareCash pay per day in ICU?", Y(AL, /S\$400/)],
    ["How many ICU days does CareCash pay?", Y(AL, /30 days/)],
    ["What's the surgical cash on Mama's hospital income plan?", Y(AL, /S\$1,000/)],
    ["Does CareCash pay recuperation cash?", Y(AL, /S\$100/)],
    ["Is there a waiting period on CareCash?", Y(AL, /30 days/)],
    ["Are pre-existing conditions covered by Mama's CareCash?", Y(AL, /12 months|pre-?existing/i)],
    ["How much is the CareCash premium?", Y(AL, /S\$486/)],
    ["If Mama is in ICU, does CareCash pay both the daily and ICU rate?", Y(AL, /instead|not in addition/i)],
    ["Maximum days per admission for CareCash daily cash?", Y(AL, /365/)],
  ]);
  // ---- 9. Wanderer travel (in the bundle) and TermGuard (locked PDF + app screenshot) for Kok Leong
  qs("me", KL, [
    ["What's my travel insurance overseas medical limit?", Y(KL, /S\$500,000/)],
    ["How much trip cancellation cover do I have?", Y(KL, /S\$10,000/)],
    ["What's the baggage limit per item on my travel policy?", Y(KL, /S\$500/)],
    ["When does my Wanderer travel cover end?", Y(KL, /14 May 2027/)],
    ["How long can each trip be on my travel plan?", Y(KL, /90 days/)],
    ["Is Mama covered on my travel insurance?", Y(AL, /Wanderer[^.]{0,80}(?:you|Kok Leong)|not find|didn[’']t find|no|isn[’']t/i, /Wanderer[^.]{0,40}covers (?:Mama|Lee Ah Lian|her)/i)],
    ["What's my life insurance cover?", Y(KL, [/TermGuard/, /password|locked|screenshot|app/i])],
    ["How much is my TermGuard sum assured?", Y(KL, [/screenshot|app/i])],
    ["Why can't you read my TermGuard PDF?", { person: KL, unreadable: "password" }],
    ["When is my next TermGuard premium due?", Y(KL, /5 Nov(?:ember)? 2026|screenshot|app|password/i)],
    ["Is the app screenshot proof of my cover?", Y(KL, /screenshot|app/i)],
    ["What's the password for my TermGuard PDF?", Y(KL, /password/i, /S7712345J/)],
  ]);
  // ---- 10. the unreadable, the handwritten, the son's own notes
  qs("unreadable", KL, [
    ["Why couldn't you read Mama's CareCash renewal PDF?", { person: AL, unreadable: "damaged" }],
    ["What happened to the CareCash_Renewal_2026_damaged.pdf upload?", { unreadable: "damaged" }],
    ["Why is the blurry CareCash photo not read?", { person: AL, unreadable: "blurry" }],
    ["What do my handwritten notes say?", { unreadable: "handwriting" }],
    ["Can you read the handwritten notes I uploaded for Papa?", { person: BH, unreadable: "handwriting" }],
    ["I tried to upload a HEIC photo from my iPhone. Why didn't it work?", { unreadable: "heic" }],
    ["Which of our documents couldn't be read?", Y(null, [/TermGuard65_Schedule_locked\.pdf/, /CareCash_Renewal_2026_damaged\.pdf/, /CareCash_photo_blurry\.jpg/])],
    ["Are any of Mama's documents unreadable?", Y(AL, [/CareCash_Renewal_2026_damaged\.pdf|CareCash_photo_blurry\.jpg/])],
    ["What should I do about the documents you couldn't read?", Y(null, /password|original|retake|photo|re-?upload|upload/i)],
    ["Is anything still being read?", Y(null, /no|nothing|all|finished|done/i, /still being read/i)],
    ["What's in my insurance notes Word file?", Y(KL, /notes|your own|not from the insurer|typed/i)],
    ["My notes say Papa's deductible is S$3,000 - is that right?", Y(BH, /S\$3,500/)],
    ["Do my notes count as a policy?", Y(KL, /not|notes|own/i)],
    ["What does Papa's 120-page policy wording say about pre-existing conditions?", Y(BH, /pre-?existing/i)],
    ["Is the SilverShield policy wording personal to Papa?", Y(BH, /wording|general|everyone|all/i)],
  ]);
  // ---- 11. household-level and cross-document questions
  qs("family", KL, [
    ["What policies does Papa have?", Y(BH, [/SilverShield/, /Heritage Whole Life/], /SeniorGuard|Wanderer|Novena Heights Hospital (?:policy|plan)|my notes/i)],
    ["What policies does Mama have?", Y(AL, [/Golden Years/, /SeniorGuard/, /CareCash/], /SilverShield|Wanderer|Heritage/)],
    ["What insurance do I have?", Y(KL, [/Wanderer/], /SeniorGuard|Heritage|SilverShield|Golden Years/)],
    ["Who is covered under the travel plan?", Y(KL, /Wanderer[^.]*(?:you|Kok Leong)/i, /Wanderer[^.]*(?:Papa|Mama|Ah Lian|Boon Huat)/)],
    ["How many policies did the bundle PDF contain?", Y(null, /three|3/i)],
    ["Which policies were in the Chua_family_policies_bundle.pdf?", Y(null, [/SeniorGuard/, /Heritage Whole Life/, /Wanderer/])],
    ["What were the pages of the CareCash PDF like?", Y(AL, /order/i)],
    ["Which documents are letters rather than policies?", Y(null, [/Merlion_Premium_Revision_Aug2026\.pdf|premium/i, /Merlion_Claim_Decision_CLM-2026-118842\.pdf|claim/i])],
    ["List every document I uploaded for Papa.", Y(BH, [/SilverShield_Schedule_2026\.pdf/, /Merlion_Claim_Decision/])],
    ["Does anyone in the family have critical illness cover?", Y(null, /Golden Years/, /didn[’']t find anything about/)],
    ["Does Papa have critical illness cover?", Y(BH, NOT_FOUND, /Golden Years[^.]{0,40}(?:covers|for) (?:Papa|him|Boon Huat)/i)],
    ["Who has hospital cash cover?", Y(null, /CareCash|SeniorGuard/)],
    ["Total annual premiums for Mama?", Y(AL, /S\$1,248|S\$312|S\$486|S\$2,046/)],
    ["Which of Papa's documents are from Merlion?", Y(BH, /SilverShield/)],
  ]);
  // ---- 12. figures that only an OCR typo would give
  qs("ocr", KL, [
    ["Is Mama's early cancer payout S$12,500?", Y(AL, UNCLEAR)],
    ["Mama's angioplasty cap is S$5,000 right?", Y(AL, UNCLEAR)],
    ["What does the photo of Papa's schedule say the policy year limit is?", Y(BH, /S\$1,000,000|same|duplicate|PDF/i, /S\$1,OOO,OOO|S\$1\b(?![,.\d])/)],
    ["Was Papa's 2025 premium S$1,962?", Y(BH, /S\$1,962|unclear|2025/i)],
    ["What's printed on page 2 of Mama's scanned CI policy?", Y(AL, /benefit|critical illness|cancer/i)],
    // Round 10 (integration): rows whose amount the scan prints unclearly are read out too, said to be unclear.
    ["Read me the benefits table on Mama's CI scan", Y(AL, [/cancer|angioplasty|critical illness/i, /Early stage cancer[^\n]{0,80}unclear/i, /Angioplasty[^\n]{0,80}unclear/i])],
  ]);

  // ---- 13. Ten multi-turn conversations
  const conv = (name: string, member: string | null, turns: Turn[]) => c.push({ name: "conv:" + name, member, turns });
  conv("knee-claim", KL, [
    { say: "Papa was admitted to Novena Heights in June for a knee replacement", expect: Y(BH) },
    { say: "the insurer rejected the claim, why?", expect: Y(BH, /pre-?existing/i) },
    { say: "how much was the bill?", expect: Y(BH, /S\$24,816\.40/, BILL_AS_COVER) },
    { say: "and how much does his plan cover for that?", expect: Y(BH, /reject|pre-?existing|deductible/i, BILL_AS_COVER) },
    { say: "what does his policy wording say about pre-existing conditions?", expect: Y(BH, /pre-?existing/i) },
    { say: "can we appeal?", expect: Y(BH, /appeal|review|FIDReC/i) },
    { say: "is his SilverShield still valid after this?", expect: Y(BH, /in force|31 March 2027|active/i) },
    { say: "thanks", expect: { mentions: /welcome/i } },
  ]);
  conv("premium-letter", KL, [
    { say: "Merlion sent Papa a letter in August", expect: Y(BH) },
    { say: "what did the letter say?", expect: Y(BH, [/S\$2,736|premium/i, /rider/i]) },
    { say: "how much is he paying now?", expect: Y(BH, /S\$2,184/, FUTURE_AS_NOW) },
    { say: "and from next April?", expect: Y(BH, /S\$2,736/) },
    { say: "what about the rider?", expect: Y(BH, /withdrawn|end|not be renewed/i) },
    { say: "what's the replacement and how much?", expect: Y(BH, /S\$1,412/) },
    { say: "deadline?", expect: Y(BH, /28 February 2027/) },
    { say: "does his cover itself change?", expect: Y(BH, /does not change|not change|same|unchanged/i) },
  ]);
  conv("which-schedule", KL, [
    { say: "I uploaded a photo of Papa's SilverShield schedule and then the PDF", expect: Y(BH) },
    { say: "are they the same?", expect: Y(BH, /same|duplicate|copy/i) },
    { say: "which one is current?", expect: Y(BH, /2026|SilverShield_Schedule_2026\.pdf/) },
    { say: "and the 2025 photo?", expect: Y(BH, /2025|31 March 2026|earlier|older|previous/i) },
    { say: "what's his deductible?", expect: Y(BH, /S\$3,500/) },
    { say: "and his policy year limit?", expect: Y(BH, /S\$1,000,000/, /S\$1,OOO/) },
    // Round 10 (integration): where that figure came from -- the schedule and its page.
    { say: "is that from the policy?", expect: Y(BH, [/^Yes\b|Yes —/, /SilverShield_Schedule_2026\.pdf/, /page \d/], /policy year limit: S\$1,000,000/i) },
  ]);
  conv("mama-ci", KL, [
    { say: "What critical illness cover does Mama have?", expect: Y(AL, /Golden Years/) },
    { say: "how much?", expect: Y(AL, /S\$50,000/, /S\$5O,000/) },
    { say: "and for early cancer?", expect: Y(AL, /25%/, /S\$12,500(?! is unclear)|S\$12\b/) },
    { say: "is that S$12,500?", expect: Y(AL, UNCLEAR) },
    { say: "what's the waiting period?", expect: Y(AL, /90 days/) },
    { say: "policy number?", expect: Y(AL, /unclear|couldn[’']t|could not|SSI-GY/i, /SSI-GY-7710293/) },
  ]);
  conv("mama-hospital", KL, [
    { say: "If Mama is warded, what does CareCash pay?", expect: Y(AL, /S\$200/) },
    { say: "and in ICU?", expect: Y(AL, /S\$400/) },
    // Round 10 (integration): the summary names what the lines answer (the ICU days), not "renewal and expiry dates".
    { say: "for how many days?", expect: Y(AL, /30 days/, /renewal and expiry dates/i) },
    { say: "does her accident plan also pay hospital cash?", expect: Y(AL, /S\$80/) },
    { say: "what if she falls and breaks her wrist?", expect: Y(AL, /fracture|accident/i) },
    { say: "and any waiting period on CareCash?", expect: Y(AL, /30 days/) },
  ]);
  conv("unreadable", KL, [
    { say: "Which of Mama's documents couldn't you read?", expect: Y(AL, [/CareCash_Renewal_2026_damaged\.pdf|CareCash_photo_blurry\.jpg/]) },
    { say: "why not the renewal PDF?", expect: { person: AL, unreadable: "damaged" } },
    { say: "and the photo?", expect: { person: AL, unreadable: "blurry" } },
    { say: "how should I take the photo again?", expect: Y(AL, /light|flat|shadow|whole page|frame|focus/i) },
    { say: "what about my TermGuard PDF?", expect: { person: KL, unreadable: "password" } },
  ]);
  conv("bundle", KL, [
    { say: "I uploaded one PDF with three of our policies in it", expect: Y(null) },
    { say: "which policies were in it?", expect: Y(null, [/SeniorGuard/, /Heritage Whole Life/, /Wanderer/]) },
    { say: "who does SeniorGuard cover?", expect: Y(AL, /Mama|Lee Ah Lian|Ah Lian/, /SeniorGuard[^.]{0,40}(?:Papa|Boon Huat|you\b)/) },
    { say: "and the whole life?", expect: Y(BH, /Papa|Boon Huat/) },
    { say: "and the travel?", expect: Y(KL, /you|Kok Leong/) },
    { say: "what's the travel medical limit?", expect: Y(KL, /S\$500,000/) },
  ]);
  conv("termguard", KL, [
    { say: "how much life cover do I have?", expect: Y(KL, /TermGuard/) },
    // Round 10 (integration): answered directly -- which document and page -- not the last answer again.
    { say: "is that from the policy?", expect: Y(KL, [/screenshot|app|password|locked/i, /Screenshot_20260918_MerlionApp\.png/, /page 1\b/], /no life policy on file/i) },
    { say: "why can't you read the PDF?", expect: { person: KL, unreadable: "password" } },
    { say: "when is the next premium?", expect: Y(KL, /5 Nov(?:ember)? 2026|screenshot|app/i) },
    { say: "ok and my travel insurance?", expect: Y(KL, /Wanderer/) },
  ]);
  conv("wholelife", KL, [
    { say: "What's Papa's whole life worth now?", expect: Y(BH, /S\$92,580/) },
    { say: "and if he passes away?", expect: Y(BH, /S\$131,360|S\$80,000/) },
    { say: "is any of that not guaranteed?", expect: Y(BH, /terminal bonus|not guaranteed/i) },
    { say: "who gets it?", expect: Y(BH, /Lee Ah Lian|Mama/) },
    { say: "any loan on it?", expect: Y(BH, /S\$0\.00|no loan|none|nil\b/i) },
    { say: "does he still pay for it?", expect: Y(BH, /paid up|no further/i) },
  ]);
  conv("notes", KL, [
    { say: "I typed up some notes about our insurance in Word", expect: Y(KL) },
    { say: "what does it say Papa's deductible is?", expect: Y(BH, /S\$3,500/) },
    { say: "so my notes are wrong?", expect: Y(BH, /S\$3,500|schedule/i) },
    { say: "what about the handwritten notes?", expect: { unreadable: "handwriting" } },
    { say: "and what does Mama's CareCash really pay a day?", expect: Y(AL, /S\$200/) },
  ]);
  return c;
}
