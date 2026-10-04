/**
 * Round 7 claim conversations: 51 full claim interviews (10-25 turns each)
 * over the Round 6 household (scripts/r6/fixture.ts), with the answering
 * styles real families use -- one word, "idk", Singlish, corrections,
 * contradictions, two answers at once, everything up front, an unrelated
 * question mid-claim, restarting, switching person, people outside the
 * household, events before cover started or after it ended, and events that
 * have not happened yet.
 *
 * Each conversation states what a careful claims handler would expect:
 * which benefits may be named (and which never), whether employer group cover
 * from the Harbourfront booklet is shown, which questions must never be asked
 * (irrelevant, or already answered), and who the claim is about.
 */
import { MEILING, WEIJIE, XINYI, SIEWLAN, WEIMING } from "../r6/fixture";

export type ClaimConversation = {
  name: string;
  /** The profile the chat is opened from. */
  member: string;
  opening: string;
  /** Question card -> reply (first unused match); unmatched cards get "Not sure". */
  replies?: [RegExp, string][];
  /** Messages sent INSTEAD of answering the open card, by turn number (0 = opening). */
  interject?: Record<number, string>;
  /** Sent once the claim has concluded (follow-ups, thanks). */
  after?: string[];
  /** Who the claim ends up about (null: nobody in the household / not resolved). */
  person: string | null;
  /** Card titles that must appear in the final answer, and that must never appear on any turn. */
  want?: RegExp[];
  deny?: RegExp;
  /** true: a "Possible cover through ..." group card is expected; false: never. */
  group: boolean;
  /** Questions that must never be asked in this conversation (irrelevant, or already answered). */
  neverAsk?: RegExp;
  death?: boolean;
  serious?: boolean;
  /** false when the conversation is not expected to reach a final claim answer. */
  concludes?: boolean;
  /** Final answer must say this (any visible field). */
  finalMentions?: RegExp;
  /** Round 8: how "Not sure" is sent to a free-text question -- "restated" is
   * what the chat page's inline answer box sends ("Question: Not sure"),
   * "bare" is typing it into the message box. Default: bare. */
  unsureAs?: "restated" | "bare";
};

const TAIL = ["how much can claim?", "what documents do i need ah", "is it confirmed we will get paid?", "how long do i have to submit?", "can claim from more than one policy?", "who do i send the forms to?", "anything else i should do?", "sorry, which documents again?", "ok thanks"];
const T2 = ["how much can claim?", "what do i send the insurer?", "will they pay for sure?", "by when must i claim?", "anything else i should do?", "who do i send the forms to?", "noted, thanks"];
const ACC = /accident, or an illness/i, WHERE = /where did/i, WHEN = /when did it happen|on what date did it happen/i;
const TRAVEL_BENEFITS = /Travel delay|Baggage|Trip cancellation|Overseas medical|COVID|evacuation/i;
const HOSPITAL_ROWS = /room|Surgical|Intensive|hospital services|Pre-hospital|Post-hospital/i;

export function claimBattery(): ClaimConversation[] {
  const c: ClaimConversation[] = [];
  // ------------------------------------------------------------------ death
  c.push({ name: "death: illness, husband", member: MEILING, opening: "my husband wei jie passed away on 2026-09-28 from lung cancer at NCCS",
    replies: [[/cause of death/i, "lung cancer"], [/how did it happen/i, "illness, he was sick for a year"], [WHERE, "Singapore"]],
    after: TAIL, person: WEIJIE, want: [/Sum assured - death/], deny: /Fracture|Hospital cash|Baggage|Travel delay|Accidental death and permanent/i, group: true,
    neverAsk: /date of death|still alive/i, death: true });
  c.push({ name: "death: road accident, few words", member: WEIJIE, opening: "wei jie died yesterday. car accident. what do i do",
    replies: [[/date of death/i, "2026-10-03"], [/cause of death/i, "multiple injuries from road traffic accident"], [WHERE, "Singapore"]],
    after: TAIL, person: WEIJIE, want: [/Sum assured - death/], deny: /Fracture|Baggage|Travel delay|Hospital cash/i, group: true, neverAsk: /how did it happen|still alive/i, death: true });
  c.push({ name: "death: overseas accident", member: MEILING, opening: "Wei Jie died in a motorcycle accident in Phuket on 2026-08-20 while on holiday",
    replies: [[/cause of death/i, "head injury"], [/trip start/i, "2026-08-15"], [/trip end/i, "2026-08-25"], [/what happened on the trip/i, "Accident or death"]],
    after: TAIL, person: WEIJIE, want: [/Sum assured - death/, /TravelSafe.*Accidental death/], deny: /Fracture|Baggage|Travel delay|Trip cancellation/i, group: true, neverAsk: /date of death|in Singapore or overseas|how did it happen/i, death: true });
  // Round 7 integration: the travel policy's accidental death benefit, offered only when the death fell within the trip.
  c.push({ name: "death: overseas accident within the trip dates", member: MEILING, opening: "Wei Jie died in a motorcycle accident in Phuket on 2026-08-20, during our holiday from 2026-08-15 to 2026-08-25",
    replies: [[/cause of death/i, "head injury"]], after: TAIL, person: WEIJIE, want: [/Sum assured - death/, /TravelSafe.*Accidental death/], deny: /Fracture|Baggage|Travel delay|Trip cancellation/i, group: true,
    neverAsk: /date of death|in Singapore or overseas|how did it happen|trip start|trip end/i, death: true });
  c.push({ name: "death: overseas accident after the trip ended", member: MEILING, opening: "Wei Jie died in a motorcycle accident in Phuket on 2026-09-02. He stayed on for work after our holiday from 2026-08-15 to 2026-08-25",
    replies: [[/cause of death/i, "head injury"]], after: TAIL, person: WEIJIE, want: [/Sum assured - death/], deny: /Fracture|Baggage|Travel delay|Trip cancellation|TravelSafe/i, group: true,
    neverAsk: /date of death|in Singapore or overseas|how did it happen|trip start|trip end/i, death: true });
  c.push({ name: "death: before cover started", member: WEIJIE, opening: "Wei Jie passed away on 2026-03-02 after a heart attack",
    replies: [[/cause of death/i, "heart attack"], [/how did it happen/i, "collapsed at home"], [WHERE, "Singapore"]],
    after: T2.concat(["where do i find the older policy documents?"]), person: WEIJIE, deny: /Fracture|Baggage|Travel/i, group: true, neverAsk: /date of death|still alive|cause of death|how did it happen/i, death: true, finalMentions: /before|start|effective|began/i });
  c.push({ name: "death: grandmother locked doc", member: MEILING, opening: "ah ma Siew Lan passed away on 2026-09-12 at home",
    replies: [[/cause of death/i, "old age"], [WHERE, "Singapore"]], after: ["what should i do now", "i dont know the password", "can check her medishield?", "what documents will the insurer want for a death?", "who should i call first?", "do i need a lawyer?", "how long do we have to claim?", "ok", "thank you"], person: SIEWLAN, group: false, death: true,
    deny: /TermSecure|ShieldCare|PA Guardian|Harbourfront/i, concludes: false, finalMentions: /password|couldn[’']t be read|could not be read/i });
  c.push({ name: "death: person not in household", member: MEILING, opening: "my colleague Ravi died last week, can I claim his insurance?",
    after: ["he is not family", "his wife asked me to help, what should she do?", "where can she find his policies?", "does his company insurance pay?", "can i claim anything myself?", "what about bereavement leave pay?", "how do i check if he had cover?", "should i go to the wake first?", "ok thanks"], person: null, group: false, deny: /TermSecure|ShieldCare|PA Guardian/i, death: true, concludes: false });
  // ------------------------------------------------------------------ TPD
  c.push({ name: "tpd: fall at work", member: WEIJIE, opening: "Wei Jie fell from a ladder at work on 2026-07-03, now paralysed waist down, doctor says permanent, cannot work any more",
    replies: [[ACC, "An accident"], [/what illness or injury/i, "spinal cord injury from the fall"], [/unable to work/i, "2026-07-03"], [/which fits now/i, "Any work"], [/how many months/i, "3"], [/doctor|certif/i, "Yes"]],
    after: TAIL, person: WEIJIE, want: [/total and permanent disability/i], deny: /Baggage|Travel|Fracture|Sum assured - death|Hospital cash/i, group: true, neverAsk: /still alive/i, serious: true });
  c.push({ name: "tpd: stroke illness, idk answers", member: MEILING, opening: "my husband cannot work anymore after his stroke in May, is there any claim",
    replies: [[ACC, "illness"], [/what illness or injury/i, "stroke"], [/unable to work/i, "idk"], [/which fits now/i, "Any work"], [/how many months/i, "dunno, since may"]],
    after: TAIL, person: WEIJIE, deny: /Baggage|Travel|Fracture|accident/i, group: true, serious: true });
  // ------------------------------------------------------------------ critical illness
  c.push({ name: "ci: breast cancer Mei Ling", member: MEILING, opening: "I was diagnosed with breast cancer stage 2 on 2026-09-01 by my oncologist",
    replies: [[/specialist/i, "Yes"], [/alive/i, "Yes"], [/hospital/i, "No"]], after: TAIL, person: MEILING,
    deny: /Fracture|Baggage|Travel|TermSecure/i, group: false, neverAsk: /what exactly was diagnosed|on what date was it diagnosed|by a specialist/i, serious: true });
  c.push({ name: "ci: stroke Wei Jie", member: WEIJIE, opening: "wei jie had a stroke on 2026-09-14, now in TTSH",
    replies: [[/specialist/i, "yes neurologist"], [/alive/i, "Yes"], [/admission/i, "2026-09-14"], [/discharged/i, "still in hospital"]], after: TAIL, person: WEIJIE,
    want: [/Critical illness accelerator/], deny: /Fracture|Baggage|Travel|Sum assured - death/i, group: true, serious: true, neverAsk: /what exactly was diagnosed|on what date was it diagnosed/i });
  c.push({ name: "ci: heart attack singlish", member: WEIJIE, opening: "my husband got heart attack last month, the 20th, doctor say must do bypass. can claim CI or not?",
    replies: [[/what exactly was diagnosed/i, "heart attack, need bypass"], [/specialist/i, "ya cardiologist"], [/alive/i, "ya he ok now"], [/date/i, "2026-09-20"]], after: TAIL, person: WEIJIE,
    want: [/Critical illness accelerator/], deny: /Fracture|Baggage|Travel/i, group: false, serious: true });
  c.push({ name: "ci: early stage, correction", member: WEIJIE, opening: "Wei Jie diagnosed with prostate cancer on 2026-08-30",
    replies: [[/specialist/i, "Yes"], [/alive/i, "Yes"]], interject: { 2: "sorry correction, the doctor said it is early stage, not late stage" }, after: TAIL, person: WEIJIE,
    deny: /Fracture|Baggage|Travel/i, group: false, serious: true });
  c.push({ name: "ci: everything in first message", member: WEIJIE, opening: "Wei Jie was diagnosed with colorectal cancer stage 3 on 2026-08-15 by an oncologist at NCCS in Singapore, he is alive and having chemo, not hospitalised",
    after: TAIL, person: WEIJIE, want: [/Critical illness accelerator/], deny: /Fracture|Baggage|Travel/i, group: false, serious: true,
    neverAsk: /what exactly was diagnosed|on what date was it diagnosed|by a specialist|still alive|Singapore or overseas/i });
  // ------------------------------------------------------------------ hospitalisation
  c.push({ name: "hosp: private dengue", member: MEILING, opening: "Mei Ling admitted to Mount Elizabeth for dengue on 2026-09-20, discharged 2026-09-23. bill $8,400",
    replies: [[/other insur|employer already paid/i, "No"], [/surgery/i, "No"]], after: TAIL, person: MEILING, want: [/Daily room, board|Surgical/], deny: /Fracture|Baggage|Travel|TermSecure/i, group: true,
    neverAsk: /which hospital|date of admission|discharged/i });
  c.push({ name: "hosp: public, idk", member: MEILING, opening: "i was hospitalised at SGH last week",
    replies: [[/admission/i, "idk"], [/discharged/i, "dunno"], [/other insur|employer/i, "idk"], [/nights/i, "not sure"]], after: TAIL, person: MEILING, deny: /Fracture|Baggage|Travel|TermSecure/i, group: true,
    neverAsk: /which hospital/i });
  c.push({ name: "hosp: day surgery", member: MEILING, opening: "I had day surgery for a cataract at a private eye centre on 2026-09-18, went home same day",
    replies: [[/admission/i, "2026-09-18"], [/discharged/i, "2026-09-18"], [/which hospital/i, "Eye & Retina Surgeons"], [/other insur|employer/i, "No"]], after: TAIL, person: MEILING,
    want: [/Daily room, board|Surgical/], deny: /Fracture|Baggage|Travel|TermSecure|accident/i, group: true });
  c.push({ name: "hosp: A&E only", member: XINYI, opening: "xin yi high fever went A&E at KKH yesterday, not admitted, sent home",
    replies: [[ACC, "illness"], [WHERE, "Singapore"], [/what treatment/i, "Emergency department"]], after: T2.concat(["she still has fever today", "ok"]), person: XINYI,
    deny: /Fracture|Baggage|Travel|Accidental death|Hospital cash/i, group: false, neverAsk: /how many nights|date of admission|discharged/i });
  c.push({ name: "hosp: two answers at once", member: MEILING, opening: "Mei Ling was admitted to hospital on 2026-09-05",
    replies: [[/discharged/i, "2026-09-08, it was at Gleneagles"], [/other insur|employer/i, "no"]], after: TAIL, person: MEILING, want: [/Daily room, board|Surgical/], deny: /Fracture|Baggage|Travel/i, group: true,
    neverAsk: /which hospital/i });
  c.push({ name: "hosp: future surgery", member: MEILING, opening: "my knee surgery is next week at Raffles Hospital, can claim?",
    after: ["it is a planned operation", "what should i do before the surgery?", "which hospital is cheaper?", "do i need a letter of guarantee?", "what if there are complications?", "can i use medisave?", "how long is the recovery?", "will my rider help?", "ok thanks"], person: MEILING, deny: /Fracture|Baggage|Travel|accident/i, group: false, concludes: false,
    finalMentions: /hasn[’']t happened|has not happened|not happened yet|after the|once it|pre-authori|before the (?:surgery|operation)|planned/i });
  c.push({ name: "hosp: wei jie hospital group only", member: WEIJIE, opening: "Wei Jie was admitted to Changi General Hospital for pneumonia on 2026-09-10 and discharged on 2026-09-15",
    replies: [[/other insur|employer/i, "No"], [/which hospital/i, "CGH"]], after: TAIL, person: WEIJIE, deny: /Fracture|Baggage|Travel|Sum assured - death/i, group: true,
    neverAsk: /date of admission|discharged/i });
  // ------------------------------------------------------------------ accidents
  c.push({ name: "acc: child fracture with correction", member: XINYI, opening: "Xin Yi fell during PE at school on 2026-09-22 and broke her left arm",
    replies: [[ACC, "An accident"], [WHERE, "Singapore"], [/confirmed by a doctor/i, "Yes"], [/what treatment/i, "Emergency department"], [/other insur|employer/i, "no"], [/lasting impairment/i, "No"]],
    interject: { 3: "sorry, it was her right arm not left" }, after: TAIL, person: XINYI, want: [/Fracture/], deny: /Baggage|Travel|Critical|TermSecure|ShieldCare/i, group: true,
    neverAsk: /when did it happen|what kind of injury/i });
  c.push({ name: "acc: dental injury", member: XINYI, opening: "Xin Yi knocked out her front tooth falling off her scooter on 2026-09-27",
    replies: [[/what kind of injury/i, "Something else"], [ACC, "An accident"], [WHERE, "Singapore"], [/what treatment/i, "Outpatient or clinic"], [/other insur|employer/i, "No"], [/lasting impairment/i, "No"]],
    after: TAIL, person: XINYI, want: [/Accidental medical expenses/], deny: /Baggage|Travel|Critical|Fracture benefit|Accidental death/i, group: true, neverAsk: /when did it happen/i });
  c.push({ name: "acc: burns", member: XINYI, opening: "xin yi spilled hot soup on her leg on 2026-09-30, got burn, went polyclinic",
    replies: [[ACC, "An accident"], [WHERE, "Singapore"], [/what treatment/i, "Outpatient or clinic"], [/other insur|employer/i, "No"], [/lasting impairment/i, "no"]],
    after: TAIL, person: XINYI, want: [/Accidental medical expenses/], deny: /Baggage|Travel|Critical|Fracture benefit|Accidental death/i, group: true, neverAsk: /what kind of injury|when did it happen/i });
  c.push({ name: "acc: dog bite", member: XINYI, opening: "Xin Yi was bitten by a neighbour's dog yesterday, needed stitches at the clinic",
    replies: [[/what kind of injury/i, "A cut or wound"], [ACC, "An accident"], [WHERE, "Singapore"], [/what treatment/i, "Outpatient or clinic"], [/other insur|employer/i, "No"], [/lasting impairment/i, "No"]],
    after: TAIL, person: XINYI, want: [/Accidental medical expenses/], deny: /Baggage|Travel|Critical|Fracture benefit|Accidental death/i, group: true, neverAsk: /when did it happen/i });
  c.push({ name: "acc: fracture admitted overnight", member: XINYI, opening: "Xin Yi fell at the playground on 2026-09-26 and broke her right wrist, admitted overnight at KKH",
    replies: [[ACC, "An accident"], [WHERE, "Singapore"], [/confirmed by a doctor/i, "Yes"], [/what treatment/i, "Admitted to hospital"], [/how many nights/i, "1"], [/other insur|employer/i, "No"], [/lasting impairment/i, "No"]],
    after: TAIL, person: XINYI, want: [/Fracture/], deny: /Baggage|Travel|Critical|Accidental death/i, group: true, neverAsk: /when did it happen|what kind of injury/i });
  c.push({ name: "acc: after cover lapsed", member: WEIMING, opening: "Wei Ming fractured his wrist playing football on 2026-09-10",
    replies: [[ACC, "An accident"], [WHERE, "Singapore"], [/confirmed by a doctor/i, "Yes"], [/what treatment/i, "Outpatient or clinic"], [/other insur|employer/i, "No"], [/lasting impairment/i, "No"]],
    after: T2, person: WEIMING, deny: /Fracture benefit|Accidental medical|Baggage|Travel|Critical/i, group: false, finalMentions: /ended|30 June 2026|lapsed|no longer/i, concludes: false });
  c.push({ name: "acc: contradicts accident/illness", member: XINYI, opening: "Xin Yi hurt her arm on 2026-09-29",
    replies: [[/what kind of injury/i, "A broken bone"], [ACC, "An accident"], [WHERE, "Singapore"], [/confirmed by a doctor/i, "Yes"], [/what treatment/i, "Emergency department"], [/other insur|employer/i, "No"], [/lasting impairment/i, "No"]],
    interject: { 3: "actually it was not an accident, she has brittle bones, it just broke" }, after: T2, person: XINYI, deny: /Baggage|Travel|Critical/i, group: false });
  // ------------------------------------------------------------------ elderly fall
  c.push({ name: "elderly: grandma fall", member: MEILING, opening: "my mum Siew Lan slipped in the bathroom on 2026-09-25 and fractured her hip, now in hospital",
    replies: [[ACC, "An accident"], [WHERE, "Singapore"], [/confirmed by a doctor/i, "Yes"], [/what treatment/i, "Admitted to hospital"]], after: ["can claim anything?", "she is in SGH now", "what should we keep for the claim?", "the password is on the letter i think", "can medisave pay?", "will the hospital bill be big?", "what if she needs a nursing home after?", "ok", "thanks"], person: SIEWLAN,
    group: false, deny: /TermSecure|ShieldCare|PA Guardian|Harbourfront/i, concludes: false, finalMentions: /password|couldn[’']t be read|could not be read/i });
  c.push({ name: "elderly: uncle not in household", member: MEILING, opening: "my uncle Ah Huat fell down at the market and broke his leg, can claim from our policies?",
    after: ["he is my dad's brother", "he has no insurance i think", "can my shield plan cover him?", "what should he do?", "can his children claim for him?", "where can he get help with the bill?", "is there any government help?", "ok", "thanks"], person: null, group: false, deny: /PA Guardian|ShieldCare|TermSecure|Harbourfront/i, concludes: false });
  // ------------------------------------------------------------------ maternity, child illness
  c.push({ name: "maternity: delivery", member: MEILING, opening: "I gave birth at Thomson Medical on 2026-09-15, normal delivery, 2 nights",
    replies: [[/admission/i, "2026-09-15"], [/discharged/i, "2026-09-17"], [/which hospital/i, "Thomson Medical"], [/other insur|employer/i, "No"]],
    after: TAIL, person: MEILING, deny: /Fracture|Baggage|Travel|accident|Critical/i, group: false });
  c.push({ name: "child: HFMD", member: XINYI, opening: "xin yi got HFMD, saw the GP on 2026-09-21, need to stay home one week",
    replies: [[ACC, "illness"], [WHERE, "Singapore"], [/what treatment/i, "Outpatient or clinic"]], after: T2.concat(["can i claim the medicine too?", "ok"]), person: XINYI,
    deny: /Fracture|Baggage|Travel|Accidental death|Accidental medical/i, group: true });
  c.push({ name: "child: dengue admitted", member: XINYI, opening: "Xin Yi was admitted to KKH for dengue on 2026-09-12, discharged 2026-09-16",
    replies: [[/other insur|employer/i, "No"], [ACC, "illness"]], after: TAIL, person: XINYI, deny: /Fracture|Baggage|Travel|Accidental death|Accidental medical|Hospital cash for accidents/i, group: true,
    neverAsk: /which hospital|date of admission|discharged/i });
  // ------------------------------------------------------------------ travel
  c.push({ name: "travel: flight delay", member: WEIJIE, opening: "Wei Jie flight from Bangkok back to Singapore was delayed 13 hours on 2026-09-25 because of typhoon. Can claim travel insurance?",
    replies: [[/trip start/i, "2026-09-20"], [/trip end/i, "2026-09-25"]], after: TAIL, person: WEIJIE, want: [/Travel delay/], deny: /Baggage|Fracture|Critical|Sum assured|Overseas medical|Trip cancellation|Harbourfront|Possible cover through/i, group: false,
    neverAsk: /how many hours|what happened on the trip|on what date did it happen/i });
  c.push({ name: "travel: trip cancellation", member: MEILING, opening: "we had to cancel our Japan trip planned for 2026-12-10 because my mum was hospitalised, flights already paid $3,200",
    replies: [[/trip start/i, "2026-12-10"], [/trip end/i, "2026-12-20"], [/what happened on the trip/i, "Other"], [/on what date did it happen/i, "2026-10-01"]], after: TAIL, person: MEILING,
    want: [/Trip cancellation/i], deny: /Fracture|Critical|Sum assured|Travel delay|Baggage|Possible cover through/i, group: false });
  c.push({ name: "travel: baggage loss", member: MEILING, opening: "My luggage was lost on my trip to Tokyo on 2026-09-10",
    replies: [[/trip start/i, "2026-09-08"], [/trip end/i, "2026-09-15"], [/what happened on the trip/i, "Lost or damaged baggage"]], after: TAIL, person: MEILING,
    want: [/baggage/i], deny: /Fracture|Critical|Sum assured|Travel delay \(|Overseas medical|Possible cover through/i, group: false, neverAsk: /on what date did it happen/i });
  c.push({ name: "travel: baggage delay", member: MEILING, opening: "my bag arrived 9 hours late when I landed in Seoul on 2026-08-12, had to buy clothes",
    replies: [[/trip start/i, "2026-08-12"], [/trip end/i, "2026-08-19"], [/what happened on the trip/i, "Lost or damaged baggage"]], after: TAIL, person: MEILING,
    want: [/Baggage delay/i], deny: /Fracture|Critical|Sum assured|Overseas medical|Possible cover through/i, group: false, neverAsk: /flight delayed|what happened on the trip/i });
  c.push({ name: "travel: overseas medical", member: XINYI, opening: "Xin Yi got food poisoning on our trip in Bali and saw a doctor there on 2026-08-02",
    replies: [[/trip start/i, "2026-07-30"], [/trip end/i, "2026-08-05"]], after: TAIL, person: XINYI, want: [/Overseas medical/i], deny: /Fracture|Baggage|Travel delay|Accidental|Trip cancellation|Possible cover through/i, group: false });
  c.push({ name: "travel: curtailment", member: WEIJIE, opening: "we cut short our Europe trip on 2026-09-05 because Wei Jie's father passed away, flew home early",
    replies: [[/trip start/i, "2026-08-28"], [/trip end/i, "2026-09-12"], [/what happened on the trip/i, "Other"], [/on what date did it happen/i, "2026-09-05"]], after: TAIL, person: WEIJIE,
    deny: /Fracture|Critical|Sum assured|Baggage|Travel delay \(|Possible cover through/i, group: false });
  c.push({ name: "travel: passport loss", member: MEILING, opening: "I lost my passport in Paris on 2026-09-03, had to get emergency travel document",
    replies: [[/trip start/i, "2026-08-30"], [/trip end/i, "2026-09-08"], [/what happened on the trip/i, "Other"]], after: T2, person: MEILING,
    deny: /Fracture|Critical|Sum assured|Overseas medical|Travel delay \(|Possible cover through/i, group: false });
  c.push({ name: "travel: delay before travel cover", member: MEILING, opening: "my flight from Taipei was delayed 10 hours on 2026-05-20",
    replies: [[/trip start/i, "2026-05-15"], [/trip end/i, "2026-05-20"]], after: T2, person: MEILING, deny: /Fracture|Critical|Sum assured|Possible cover through/i, group: false,
    finalMentions: /before|start|effective|began|1 July 2026/i });
  // ------------------------------------------------------------------ home / car
  c.push({ name: "home: flood", member: MEILING, opening: "my kitchen flooded from a burst pipe on 2026-09-28, can claim home insurance?",
    after: ["what about my contents?", "my condo has insurance i think", "who pays for the neighbour's ceiling?", "what photos should i take?", "should i call the plumber first?", "can my shield plan pay?", "what if someone got hurt?", "is water damage usually claimable?", "ok thanks"], person: MEILING, group: false, deny: /ShieldCare|TermSecure|PA Guardian|TravelSafe|Possible cover through/i, concludes: false,
    finalMentions: /home|not (?:found|in)|couldn[’']t find|could not find|no .{0,30}on file/i });
  c.push({ name: "car: accident damage", member: WEIJIE, opening: "someone hit wei jie's car at a carpark on 2026-09-30, bumper damaged, nobody hurt",
    after: ["no one injured, just the car", "the other driver drove off", "should i make a police report?", "can his travel insurance pay?", "what about his company insurance?", "how long to report?", "what photos should i take?", "ok", "thanks"], person: WEIJIE, group: false, deny: /Fracture|Accidental medical|Sum assured|Possible cover through/i, concludes: false,
    finalMentions: /motor|car|not (?:found|in)|couldn[’']t find|could not find|no .{0,30}on file/i });
  // ------------------------------------------------------------------ messy conversations
  c.push({ name: "messy: unrelated question mid-claim", member: XINYI, opening: "Xin Yi broke her finger playing basketball on 2026-09-24",
    replies: [[ACC, "An accident"], [WHERE, "Singapore"], [/confirmed by a doctor/i, "Yes"], [/what treatment/i, "Outpatient or clinic"], [/other insur|employer/i, "No"], [/lasting impairment/i, "No"]],
    interject: { 2: "btw what is my shield plan deductible?" }, after: TAIL, person: XINYI, want: [/Fracture/], deny: /Baggage|Travel|Critical/i, group: true, neverAsk: /when did it happen|what kind of injury/i });
  c.push({ name: "messy: abandon and restart", member: MEILING, opening: "Mei Ling was hospitalised on 2026-09-02",
    replies: [[/which hospital/i, "Mount Alvernia"], [/discharged/i, "2026-09-04"], [/other insur|employer/i, "No"]],
    interject: { 1: "forget it, start over", 2: "Mei Ling was admitted to Mount Alvernia on 2026-09-02 for gastroenteritis" }, after: TAIL, person: MEILING,
    want: [/Daily room, board|Surgical/], deny: /Fracture|Baggage|Travel/i, group: true });
  c.push({ name: "messy: switch person", member: MEILING, opening: "Mei Ling was hospitalised on 2026-09-02",
    replies: [[/which hospital/i, "actually it was Xin Yi not Mei Ling"], [/admission|admitted/i, "2026-09-02"], [/discharged/i, "2026-09-04"], [ACC, "illness"], [/other insur|employer/i, "No"]],
    after: T2, person: XINYI, deny: /ShieldCare|Fracture|Baggage|Travel/i, group: true });
  c.push({ name: "messy: vague then event", member: MEILING, opening: "can claim anot",
    interject: { 1: "Wei Jie was admitted to NUH on 2026-09-17 for appendicitis and had surgery, discharged 2026-09-20" },
    replies: [[/other insur|employer/i, "No"]], after: TAIL, person: WEIJIE, deny: /Fracture|Baggage|Travel|Sum assured - death/i, group: true, neverAsk: /which hospital|date of admission|discharged/i });
  // ------------------------------------------------------------------ not sure, on every free-text question
  // Round 8: "Not sure" to a free-text or amount question is accepted,
  // recorded as unknown and the interview moves on; the question is never
  // put again (the runner checks every conversation for that). Typed the way
  // the chat page's answer box sends it. What-ifs are checked on their own in
  // scripts/r7-claims-regressions.ts (whatIfUnsureChecks).
  c.push({ name: "unsure: hospital stay, every typed answer not sure", member: MEILING, opening: "i was hospitalised at SGH last week",
    unsureAs: "restated", after: TAIL, person: MEILING, deny: /Fracture|Baggage|Travel|TermSecure/i, group: true, neverAsk: /which hospital/i });
  c.push({ name: "unsure: child injury, every typed answer not sure", member: XINYI, opening: "Xin Yi fell at the playground on 2026-09-26 and hurt her wrist",
    unsureAs: "restated", after: TAIL, person: XINYI, deny: /Baggage|Travel|Critical|Sum assured - death/i, group: true, neverAsk: /when did it happen/i });
  c.push({ name: "unsure: death, every typed answer not sure", member: WEIJIE, opening: "my husband wei jie passed away last week",
    unsureAs: "restated", after: TAIL, person: WEIJIE, deny: /Fracture|Baggage|Travel delay|Hospital cash/i, group: true, death: true });
  return c;
}
