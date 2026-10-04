/**
 * Round 9 red-team battery. Written AFTER reading the Round 6/7 batteries and
 * deliberately in styles they do not use (see scripts/r9-redteam-regressions.ts).
 * Members are preferred names in capitals (MEILING, RAHMAN, ...); null is the
 * family view. `pick` taps a person on the "Who is this about?" card.
 */
export type Expect = { person?: string | null; mentions?: RegExp | RegExp[]; not?: RegExp | RegExp[]; asksPerson?: boolean; noCitations?: boolean; noAmounts?: boolean;
  /** Round 9: the answer must be short and direct (a follow-up), not a re-run of the previous answer. */
  direct?: boolean; };
export type Turn = { say: string; pick?: RegExp; expect?: Expect; repeatOk?: boolean };
export type Conversation = { name: string; household: "r6" | "r7"; member: string | null; claim?: boolean; turns: Turn[] };

const NF = /not (?:found|stated|in your documents)|couldn[’']t find|could not find|didn[’']t find|no .{0,40}(?:on file|in (?:your|the) documents)|don[’']t (?:mention|show|state)|doesn[’']t (?:mention|show|state)|isn[’']t (?:in|stated|shown)/i;
const PROMISE = /(?<!\b(?:what|whether|how much|if)(?: the insurer| they| it)? )\b(?:(?:they|the insurer|it|your (?:plan|policy)) will (?:definitely |surely )?(?:pay|be paid)(?! only| up to)|guaranteed? (?:to )?pay|confirmed (?:to|that they will) pay)\b/i;

export function battery(): Conversation[] {
  const c: Conversation[] = [];
  const one = (household: "r6" | "r7", member: string | null, name: string, say: string, expect?: Expect) => c.push({ name: "1:" + name, household, member, turns: [{ say, expect }] });
  const conv = (household: "r6" | "r7", member: string | null, name: string, turns: (Turn | string)[], claim = false) =>
    c.push({ name: "M:" + name, household, member, claim, turns: turns.map((t) => typeof t === "string" ? { say: t } : t) });

  // =============================================================== known open issues
  conv("r6", null, "family knee surgery what-if", [
    { say: "my knee surgery is next week how much will my insurance pay", expect: { asksPerson: false, person: "MEILING", mentions: /ShieldCare|deductible|S\$3,500|hospital/i, not: PROMISE } },
    { say: "what documents would I need if it happens?", expect: { direct: true, mentions: /bill|receipt|discharge|claim form|memo|report|document/i } },
    { say: "is it confirmed they will pay?", expect: { direct: true, not: PROMISE, mentions: /insurer|decide|not (?:a )?(?:promise|guarantee)|can(?:not|['’]t) (?:promise|confirm)/i } },
  ]);
  conv("r6", null, "family knee surgery picked person", [
    { say: "knee surgery next week how much can claim", expect: {} },
    { say: "Mei Ling", pick: /Mei Ling/, expect: { person: "MEILING", mentions: /ShieldCare|S\$3,500|deductible|co-insurance/i, not: /^Here is what your documents state about hospital cover\.?$/ } },
  ]);
  conv("r7", null, "family my op next month", [
    { say: "i'm having an operation on my shoulder next month, what will my plan cover", expect: { asksPerson: false, person: "RAHMAN", mentions: /MediGuard/i } },
    { say: "what papers do i need to keep", expect: { direct: true, mentions: /bill|receipt|discharge|memo|report|claim form/i } },
    { say: "so they will pay for sure right", expect: { direct: true, not: PROMISE } },
  ]);
  one("r7", "RAHMAN", "car damage amount", "How much can I claim if my car is damaged", { mentions: /DriveSafe|excess|S\$800|own damage/i, not: /MediGuard|\bward\b/i });
  one("r7", null, "car damage family", "how much can claim if my car kena damaged in an accident", { mentions: /DriveSafe|excess|own damage/i, not: /MediGuard|\bward\b/i });
  conv("r7", "RAHMAN", "panel follow-up keeps plan", [
    { say: "Tell me about my MediGuard plan", expect: { mentions: /MediGuard/ } },
    { say: "only for panel doctors?", expect: { mentions: /MediGuard|panel|not found|couldn/i, not: /DriveSafe|HomeShield|ElderShield/ } },
    { say: "and the rider?", expect: { mentions: /rider|co-pay/i } },
  ]);
  conv("r6", "MEILING", "panel follow-up shield", [
    { say: "what's my shield plan like", expect: { mentions: /ShieldCare/ } },
    { say: "only for panel doctors?", expect: { not: /TravelSafe|TermSecure|PA Guardian/ } },
    { say: "pre-authorisation needed?", expect: { not: /TravelSafe|TermSecure|PA Guardian/ }, repeatOk: true },
  ]);

  // =============================================================== voice-to-text, no punctuation
  one("r6", "MEILING", "voice deductible", "hey so um what is the deductible on my shield thing like how much do i pay first before they pay", { mentions: /S\$3,500/ });
  one("r6", "MEILING", "voice coinsurance", "ok so after the deductible right how much percent i still need to pay myself", { mentions: /10%/ });
  one("r6", "MEILING", "voice ward", "which ward can i stay in can i go private hospital or not", { mentions: /private/i });
  one("r6", null, "voice xin yi fracture", "xin yi fell down at school and the doctor say maybe fracture how much the accident plan give", { person: "XINYI", mentions: /S\$1,000|fracture/i });
  one("r6", "WEIJIE", "voice life cover", "how much life insurance wei jie got ah if anything happen to him", { mentions: /S\$800,000/ });
  one("r7", "RAHMAN", "voice excess", "what's the excess on my car if i knock someone", { mentions: /excess|DriveSafe/i, not: /MediGuard/ });
  one("r7", null, "voice mak eldershield", "my mother eldershield how much she get every month if she cannot walk already", { person: "AMINAH", mentions: /ElderShield/i });
  one("r7", "RAHMAN", "voice ilp", "my investment plan how much is it worth now ah", { mentions: /Lion Gateway|ILP|fund|value/i });
  one("r7", null, "voice irfan maturity", "irfan endowment when it mature and how much we get back", { person: "IRFAN", mentions: /Golden Lotus|matur/i });
  one("r7", "RAHMAN", "voice home", "if my house kena flood from the pipe will home insurance pay", { mentions: /HomeShield/i, not: /MediGuard/ });

  // =============================================================== terse
  one("r7", "RAHMAN", "terse excess", "excess?", { not: /^$/ });
  one("r6", "MEILING", "terse deductible", "deductible", { mentions: /S\$3,500/ });
  one("r6", "MEILING", "terse coins", "co-ins?", { mentions: /10%/ });
  one("r6", "MEILING", "terse renewal", "renewal date", { mentions: /2027/ });
  one("r6", "WEIJIE", "terse premium", "premium?", { mentions: /S\$1,936\.50/ });
  one("r7", "RAHMAN", "terse ward", "ward?", { mentions: /ward|MediGuard/i });
  one("r7", "AISYAH", "terse grace", "grace period?", { mentions: /grace|HerCare/i });
  one("r6", null, "terse ci", "CI cover?", {});
  one("r7", "RAHMAN", "terse ncd", "NCD", { mentions: /no claim|NCD|DriveSafe|not found|couldn/i });
  one("r6", "MEILING", "terse question mark", "?", {});

  // =============================================================== emotional, angry, sarcastic
  one("r6", "MEILING", "angry deductible", "WHY IS MY DEDUCTIBLE SO HIGH THIS IS DAYLIGHT ROBBERY", { mentions: /S\$3,500/, not: /robbery/i });
  one("r6", "MEILING", "angry claim rejected", "the insurer rejected my claim AGAIN, useless company, what does my policy actually say about hospital bills", { mentions: /ShieldCare/, not: PROMISE });
  one("r7", "RAHMAN", "sarcastic", "oh great, another app. so what exactly am i paying all these premiums for", { mentions: /MediGuard|DriveSafe|HomeShield/ });
  one("r6", null, "crying", "my dad just passed away this morning i dont know what to do about his insurance", {});
  one("r7", null, "panic", "my son just got knocked down by a car he is in KK hospital now what do we do", {});
  one("r6", "MEILING", "sarcastic thanks", "thanks for nothing", {});
  one("r7", "RAHMAN", "you are useless", "you're useless, just tell me yes or no am i covered for knee surgery", { mentions: /MediGuard/, not: /not covered/ });

  // =============================================================== elderly, confused about terms
  one("r6", "SIEWLAN", "elderly what is eldershield", "hello girl, i am old already, can explain what is this eldershield my daughter bought for me", {});
  one("r6", "MEILING", "explain deductible", "what does deductible mean ah, i dont understand", { mentions: /S\$3,500|before|first|pay/i });
  one("r6", "MEILING", "explain coinsurance", "can explain what is co-insurance in simple words", { mentions: /10%|share|portion|percent/i });
  one("r7", "AISYAH", "explain waiting period", "what's a waiting period", { mentions: /wait/i });
  one("r7", "RAHMAN", "explain pro-ration", "what is pro-ration factor", {});
  one("r7", "RAHMAN", "explain pre-existing", "what does pre-existing condition mean for me", {});
  one("r6", "MEILING", "explain rider", "what's a rider, do i need one", { not: /you (?:should|need to) buy|I recommend/i });
  one("r7", "RAHMAN", "explain excess vs deductible", "excess and deductible same thing is it", {});
  one("r7", "RAHMAN", "explain surrender", "what does surrender value mean", {});
  one("r6", "MEILING", "explain annual limit", "annual limit means what", { mentions: /S\$2,000,000|year/i });

  // =============================================================== policy numbers
  one("r6", null, "policy number PA", "what does policy PAG-2026-4471 cover", { person: "XINYI", mentions: /PA Guardian/ });
  one("r6", null, "policy number unknown", "what is policy number AXA-99887766", {});
  one("r6", null, "policy number lowercase", "pag 2026 4471 still active?", {});
  one("r7", null, "policy number spoken", "my policy number is ending four four seven one what is it", {});

  // =============================================================== pasted bill / letter / email
  one("r6", "MEILING", "pasted bill", "Mount Elizabeth Hospital Tax Invoice  Patient: TAN MEI LING  Ward 1 bed  Admission 03/09/2026 Discharge 06/09/2026  Total charges S$18,432.10  GST incl.  how much will my shield pay for this", { mentions: /ShieldCare|S\$3,500|deductible|10%/i, not: PROMISE });
  one("r7", "RAHMAN", "pasted insurer letter", "Dear Policyholder, we regret to inform you that your claim no. CL-778812 has been declined as the condition is pre-existing under Clause 7.2. -- what does this mean, can i appeal", { not: PROMISE });
  one("r7", "AISYAH", "insurer email", "got an email from HerCare saying 'your policy will lapse if premium is not received by 30/10' is that real", { mentions: /HerCare|grace|premium/i });
  one("r6", "WEIJIE", "pasted renewal", "RENEWAL NOTICE  Premium payable: SGD 1,936.50  Due date: 12 Jun 2027  - is this the same as what you have", { mentions: /S\$1,936\.50/ });
  one("r6", "MEILING", "pasted bill wrong amount", "bill says S$9,999 for my day surgery. do i pay the S$3,500 first?", { mentions: /S\$3,500/, not: PROMISE });

  // =============================================================== plans not on file / is this good / compare
  one("r6", "MEILING", "compare plan not on file", "is my shield better than AIA HealthShield Gold Max A", { not: /AIA HealthShield Gold Max A (?:is|has|pays|covers)/, mentions: /not on file|don[’']t have|only|documents/i });
  one("r6", "MEILING", "is this a good policy", "is this a good policy?", { not: /\b(?:it|this|that)(?:['’]s| is) (?:a )?(?:good|great|excellent|bad|poor) (?:policy|plan|deal)\b/i });
  one("r7", "RAHMAN", "should i buy more", "should i buy more life insurance", { not: /\byou should buy\b|I recommend/i });
  one("r7", "RAHMAN", "great eastern", "do i have any great eastern policy", { mentions: NF });
  one("r6", null, "prudential compare", "compare our prudential plan to the shieldcare", {});
  one("r7", "RAHMAN", "worth keeping ilp", "should i surrender my ILP, is it worth it", { not: /\byou should (?:surrender|keep)\b|I recommend/i });

  // =============================================================== premium, late paying, cancel, agent
  one("r6", "MEILING", "late premium", "what if I'm late paying the premium", {});
  one("r7", "AISYAH", "late premium grace", "what happens if i pay late for HerCare", { mentions: /HerCare|grace/i });
  one("r6", "MEILING", "can i cancel", "can i cancel my shield plan", { not: /\byou should\b/i });
  one("r7", "RAHMAN", "cancel car", "how to cancel my car insurance and get refund", {});
  one("r6", "MEILING", "agent contact", "who is my agent and what is the number", {});
  one("r7", "RAHMAN", "insurer hotline", "what's the hotline for my car insurer", {});
  one("r7", "RAHMAN", "lapsed revive", "can i revive my lapsed AssureTerm", { mentions: /AssureTerm|lapse/i });
  one("r6", null, "total premiums", "how much are we paying in total for all our insurance every year", {});

  // =============================================================== Malay / Chinese / Tamil mix
  one("r7", null, "malay mak hospital", "mak masuk hospital semalam, ElderShield boleh claim tak", { person: "AMINAH" });
  one("r7", "RAHMAN", "malay kereta", "kereta saya kena langgar, excess berapa", { mentions: /DriveSafe|excess/i, not: /MediGuard/ });
  one("r6", null, "chinese mix", "我的 deductible how much ah", { person: "MEILING", mentions: /S\$3,500/ });
  one("r6", null, "hokkien ah ma", "ah ma fall down at home, got insurance or not", {});
  one("r7", null, "tamil amma", "amma hospital admit aachu, what cover she got", {});
  one("r6", "MEILING", "singlish can or not", "hospital bill can claim from shield or not one", { mentions: /ShieldCare/ });
  one("r7", null, "malay anak", "anak saya Irfan jatuh basikal patah tangan", { person: "IRFAN" });

  // =============================================================== numbers as words, dates in formats
  one("r6", "MEILING", "words amount", "if the bill is twelve thousand dollars how much i pay", { mentions: /S\$3,500|10%/ });
  one("r6", "MEILING", "words nights", "stayed in hospital for three nights, what can claim", { mentions: /ShieldCare|admi|date|hospital/i });
  one("r7", "RAHMAN", "dates iso", "my policy renew on 2027-01-15 right?", {});
  one("r6", "MEILING", "dates slash", "is my shieldcare valid on 15/3/2027", {});
  one("r6", "MEILING", "dates words", "valid until when, end of march twenty twenty seven?", {});
  one("r7", "RAHMAN", "last tuesday", "my car got hit last tuesday at the carpark", { not: /MediGuard/ });
  one("r6", "XINYI", "yesterday words", "xin yi sprained ankle the day before yesterday at netball", { person: "XINYI" });

  // =============================================================== multi-turn: claim then policy then back
  conv("r6", "MEILING", "claim-policy-claim", [
    { say: "i want to claim for my hospital stay last week" },
    { say: "3 nights at Gleneagles" },
    { say: "wait what's my deductible again", expect: { mentions: /S\$3,500/ } },
    { say: "ok back to the claim, the bill was about 15k" },
    { say: "what else do you need" },
  ], true);
  conv("r7", null, "car accident two family injured", [
    { say: "car accident yesterday on PIE, my son Irfan and my mum were both in the car and got injured" },
    { say: "Irfan broke his arm, mak only bruises" },
    { say: "what can we claim for each of them" },
    { say: "and the car damage?" , expect: { mentions: /DriveSafe|excess|car/i, not: /ElderShield (?:pays|covers) .*car/i } },
  ], true);
  conv("r7", "RAHMAN", "angry multi", [
    { say: "your app told me i'm covered and now the insurer says no" },
    { say: "what does my mediguard actually say about pre-existing", expect: { mentions: /MediGuard/ } },
    { say: "so useless", expect: {} },
    { say: "ok fine what do i do next" },
  ]);
  conv("r6", "MEILING", "terse chain", [
    { say: "shield", expect: { mentions: /ShieldCare/ } },
    { say: "deductible", expect: { mentions: /S\$3,500/ } },
    { say: "co-ins", expect: { mentions: /10%/ } },
    { say: "limit", expect: { mentions: /S\$2,000,000|limit/i } },
    { say: "premium", expect: { mentions: /S\$/ } },
    { say: "renewal", expect: { mentions: /2027/ } },
  ]);
  conv("r6", "MEILING", "what-if follow-ups direct", [
    { say: "what if i get dengue and stay in hospital 4 days", expect: { mentions: /ShieldCare|hospital/i, not: PROMISE } },
    { say: "what documents would I need if it happens?", expect: { direct: true } },
    { say: "is it confirmed they will pay?", expect: { direct: true, not: PROMISE } },
    { say: "how long do i have to submit", expect: { direct: true } },
    { say: "ok thanks" },
  ]);
  conv("r7", "IRFAN", "what-if accident follow-ups", [
    { say: "what if irfan breaks his leg playing football", expect: { mentions: /SafeGuard/i } },
    { say: "what documents would we need if it happens?", expect: { direct: true } },
    { say: "is it guaranteed?", expect: { direct: true, not: PROMISE } },
    { say: "and if he needs physio after?", repeatOk: true },
  ]);
  conv("r6", "WEIJIE", "group booklet follow-ups", [
    { say: "what does my company insurance cover", expect: { mentions: /Harbourfront|group/i } },
    { say: "outpatient?" },
    { say: "dental?" },
    { say: "only for panel doctors?", expect: { not: /TermSecure|TravelSafe/ } },
    { say: "what if i leave the company" },
  ]);
  conv("r6", null, "elderly confused multi", [
    { say: "hello" },
    { say: "my daughter say i got insurance, what i got", expect: { person: "MEILING", mentions: /ShieldCare/ } },
    { say: "and Siew Lan?" },
    { say: "the paper cannot open is it", expect: { mentions: /password|could(?:n[’']t| not) (?:be )?read|locked/i } },
    { say: "then how" },
  ]);
  conv("r7", "AISYAH", "grace period chain", [
    { say: "is my HerCare still ok", expect: { mentions: /HerCare/ } },
    { say: "when must i pay by" },
    { say: "what if i miss it" },
    { say: "if i get cancer during the grace period can claim?", expect: { not: PROMISE } },
  ]);
  conv("r6", "MEILING", "compare not on file multi", [
    { say: "my colleague has AIA HealthShield, is hers better" },
    { say: "what about mine then" },
    { say: "is that a good deal", expect: { not: /\b(?:it|this|that)(?:['’]s| is) (?:a )?(?:good|great|bad) (?:deal|policy|plan)\b/i } },
  ]);
  conv("r7", "RAHMAN", "car claim then excess then back", [
    { say: "someone rear-ended me at the traffic light this morning" },
    { say: "how much is my excess", expect: { mentions: /excess|S\$/i } },
    { say: "ok continue the claim" },
    { say: "the other driver's insurance is NTUC" },
  ], true);
  conv("r6", "MEILING", "travel then term then travel", [
    { say: "going to japan next month, what travel cover i got", expect: { mentions: /TravelSafe/ } },
    { say: "if i break leg skiing?" },
    { say: "wait does my husband have life insurance", expect: { mentions: /S\$800,000|TermSecure/ } },
    { say: "ok back to japan, flight delay?" , expect: { mentions: /TravelSafe|delay/i } },
  ]);
  conv("r7", "MARIA", "helper multi", [
    { say: "my helper fell sick, need to see doctor", expect: {} },
    { say: "outpatient got cover?" },
    { say: "how much for hospital" , expect: { mentions: /HelperCare/ } },
    { say: "what if she need operation" },
  ]);
  conv("r6", "XINYI", "child accident chain numbers words", [
    { say: "xin yi fell off the monkey bars two days ago and fractured her wrist" },
    { say: "she stayed in hospital one night" },
    { say: "bill was around two thousand three hundred" },
    { say: "what can claim" },
  ], true);
  conv("r7", null, "relative dates claim", [
    { say: "aisyah was admitted on 3rd sept and discharged 7 sept" },
    { say: "it was for dengue" },
    { say: "she paid 4.2k" },
  ], true);
  conv("r6", "MEILING", "sarcastic chain", [
    { say: "so what's the point of insurance if i pay 3.5k first anyway", expect: { mentions: /S\$3,500|deductible/i } },
    { say: "wow great", expect: {} },
    { say: "can lower the deductible or not", expect: {} },
  ]);
  conv("r7", "RAHMAN", "terms chain", [
    { say: "what is co-insurance" },
    { say: "and deductible" },
    { say: "and what's mine", expect: { mentions: /MediGuard|S\$/i }, repeatOk: true },
    { say: "pro-ration?" },
  ]);
  conv("r6", null, "policy number chain", [
    { say: "PAG-2026-4471", expect: { mentions: /PA Guardian/ } },
    { say: "who is it for", expect: { mentions: /Xin Yi/ } },
    { say: "how much for broken bone", expect: { mentions: /S\$1,000/ } },
    { say: "skull?", expect: { mentions: /S\$2,000/ } },
  ]);
  conv("r7", "AMINAH", "mak eldershield chain", [
    { say: "how much eldershield pay my mum" },
    { say: "how long she must be disabled first" },
    { say: "what counts as disabled" },
    { say: "still need pay premium?" },
  ]);
  conv("r6", "MEILING", "voice multi no punctuation", [
    { say: "ok so my doctor say i need to do colonoscopy" },
    { say: "will my shield cover or not" },
    { say: "how much i pay myself roughly" },
    { say: "what if they find something" },
  ]);
  conv("r7", "RAHMAN", "home claim then car", [
    { say: "water leaked from upstairs and damaged my kitchen cabinets" },
    { say: "about 3k damage" },
    { say: "btw my car also got scratched in the carpark same day" },
  ], true);
  conv("r6", null, "multiple people what-if", [
    { say: "if both my husband and daughter are hospitalised after a car accident what can we claim" },
    { say: "for Xin Yi only", repeatOk: true },
    { say: "and Wei Jie" },
  ]);
  conv("r7", null, "irfan endowment chain", [
    { say: "irfan's golden lotus" , expect: { mentions: /Golden Lotus/ } },
    { say: "surrender now get how much" },
    { say: "is it worth to surrender", expect: { not: /\byou should (?:surrender|keep)\b|I recommend/i } },
    { say: "ok what about at maturity" },
  ]);
  conv("r6", "WEIJIE", "term ci chain", [
    { say: "wei jie diagnosed with early stage cancer, can claim?" },
    { say: "how much" },
    { say: "will the life cover reduce after", expect: {} },
  ]);

  // =============================================================== round 9 second wave: more styles, more conversations
  // numbers as words and dates in many formats
  one("r6", "MEILING", "words percent", "ten percent co insurance is it", { mentions: /10%/ });
  one("r6", "MEILING", "date dotted", "my shield valid till 31.03.2027 correct?", { mentions: /31 March 2027|1 April 2027/ });
  one("r7", "RAHMAN", "date month first", "car insurance until Aug 7 2027 is it", { mentions: /7 August 2027|DriveSafe/ });
  one("r7", "AISYAH", "relative next week", "if i pay the hercare premium next week still ok?", { mentions: /HerCare|grace|20 October 2026/i, not: PROMISE });
  one("r6", "XINYI", "words fracture skull", "if she fracture her skull how much the PA give", { mentions: /S\$2,000/ });
  one("r7", "IRFAN", "words thumb", "lose one thumb how much", { mentions: /thumb|SafeGuard/i });
  // policy numbers, insurer emails and letters
  one("r6", null, "policy number only", "MMA-ISP-7730152", { mentions: /ShieldCare/ });
  one("r6", null, "policy number renewal notice", "when does policy MMA-ISP-7730152 renew", { mentions: /1 April 2027|ShieldCare/ });
  one("r7", "RAHMAN", "insurer sms", "got sms from insurer say my car policy renewal premium is $1,486.20 is that right", { mentions: /S\$1,486\.20/ });
  one("r7", "AMINAH", "eldershield letter", "letter from CPF says mak eldershield premium already stop, true?", { mentions: /ElderShield|premium/i });
  // terse and emotional extras
  one("r7", "RAHMAN", "terse windscreen", "windscreen", { mentions: /S\$100|windscreen/i });
  one("r7", "AISYAH", "terse lapse", "lapse?", { mentions: /HerCare|grace|lapse/i });
  one("r6", "WEIJIE", "terse tpd", "tpd", { mentions: /S\$800,000|disab/i });
  one("r7", "RAHMAN", "angry caps premium", "WHY MY PREMIUM SO EXPENSIVE", { mentions: /S\$/ });
  one("r6", "MEILING", "frustrated short", "useless", {});
  one("r7", "RAHMAN", "sarcastic wow", "wow great, thanks a lot", {});
  // elderly / confused
  one("r6", "MEILING", "confused medisave", "can use medisave for this shield or not, i not sure how it works", { mentions: /MediSave|S\$1,050|ShieldCare/i });
  one("r7", "AMINAH", "confused careshield", "what is careshield, mak got or not", { mentions: /ElderShield|CareShield|long-term care/i });
  one("r7", "RAHMAN", "explain ncd", "what does no claim discount mean", { mentions: /no-claim|NCD|30%/i });
  one("r7", "AISYAH", "explain free look", "what is free look period", {});
  one("r6", "MEILING", "explain as charged", "as charged means what", { mentions: /actual|bill/i });
  // compare / judgement / advice
  one("r7", "RAHMAN", "great eastern better", "great eastern hospital plan better than mine?", { mentions: /Great Eastern|not|no/i });
  one("r6", "WEIJIE", "is term enough", "is 800k life cover enough for my family", { not: /\b(?:is|it's) (?:enough|sufficient|not enough)\b/i });
  one("r7", "RAHMAN", "cancel ilp", "thinking of cancelling my ILP, what happens", { not: /\byou should\b/i });
  // agent / contact / leave company
  one("r6", "WEIJIE", "leave company", "if i resign from harbourfront what happens to my group insurance", { mentions: /HR|leav|group|employ/i });
  one("r7", "MARIA", "helper agent", "who to call for helper insurance claim", {});
  // Malay / Tamil / Chinese mix
  one("r7", null, "malay rumah", "rumah saya banjir, insurans boleh claim tak", { person: "RAHMAN", mentions: /HomeShield/i });
  one("r7", null, "tamil appa", "appa hospital admit aachu yesterday", {});
  one("r6", null, "chinese mother", "我 mother got insurance or not", {});
  // multi-turn conversations
  conv("r6", "MEILING", "bill paste then follow ups", [
    { say: "Gleneagles invoice total S$22,180.40 ward A 4 days. how much i pay", expect: { mentions: /S\$3,500|deductible/i, not: PROMISE } },
    { say: "and the rider?", expect: { mentions: /rider/i } },
    { say: "ok i want to claim this, admitted 2 Sept discharged 6 Sept" },
    { say: "it was for a slipped disc" },
  ]);
  conv("r7", "RAHMAN", "car accident numbers as words", [
    { say: "accident at the junction yesterday, other car hit my rear" , expect: { mentions: /DriveSafe|question|hospital|car/i } },
    { say: "repair quote is about two thousand five hundred" },
    { say: "the other driver's insurance is NTUC", expect: { not: /can[’']t find anyone|not sure which family member/i } },
    { say: "will my ncd drop?" },
  ]);
  conv("r6", null, "family premium then claim", [
    { say: "how much do we pay for all insurance a year", expect: { mentions: /S\$4,106\.50/ } },
    { say: "and xin yi?", },
    { say: "she fell at school today and cut her chin, needed stitches" },
  ]);
  conv("r7", "AISYAH", "insurer email grace then claim", [
    { say: "Insurer emailed: 'Your HerCare policy is in grace period until 20/10/2026.' what does it mean", expect: { mentions: /grace/i } },
    { say: "if i pay on 15 oct ok?", expect: { not: PROMISE } },
    { say: "what if i only pay on 25 oct" },
  ]);
  conv("r6", "WEIJIE", "voice to text long", [
    { say: "hi um so my wife ask me to check if wei jie got critical illness cover because his colleague just got cancer and he got scared" , expect: { person: "WEIJIE", mentions: /S\$200,000|critical illness/i } },
    { say: "how much exactly", repeatOk: true },
    { say: "early stage also can or only late stage", expect: { mentions: /late stage|early/i }, repeatOk: true },
  ]);
  conv("r7", "RAHMAN", "compare then explain then own", [
    { say: "is prudential pruShield better than my mediguard" },
    { say: "ok then what's my co-insurance", expect: { mentions: /10%/ } },
    { say: "and pro-ration means what", expect: { mentions: /70%|pro-ration/i } },
  ]);
  conv("r6", "MEILING", "planned scope then claim later", [
    { say: "doctor say i need to do endoscopy next week", expect: { mentions: /hasn[’']t happened|pre-authorisation/i } },
    { say: "how much will i pay myself", expect: { mentions: /S\$3,500|deductible/i } },
    { say: "what if they find something", expect: { direct: true } },
    { say: "ok thanks" },
  ]);
  conv("r7", null, "who then what then compare", [
    { say: "who in the family has hospital cover" },
    { say: "what about mak" },
    { say: "is her ElderShield good enough", expect: { not: /\b(?:it|this|that|her \w+)(?:['’]s| is) (?:good|enough|not enough)\b/i } },
  ]);
  conv("r6", "MEILING", "relative dates travel claim", [
    { say: "my flight to Tokyo was delayed 13 hours last friday" },
    { say: "how much can claim", expect: { mentions: /TravelSafe|delay/i } },
    { say: "what documents need" },
  ], true);
  conv("r7", "RAHMAN", "policy question back to claim", [
    { say: "my car windscreen cracked from a stone on the expressway" , expect: { mentions: /DriveSafe|windscreen/i } },
    { say: "wait does home insurance cover my laptop at home", expect: { mentions: /HomeShield/i } },
    { say: "ok back to the windscreen, how much excess", expect: { mentions: /S\$100|windscreen/i } },
  ]);
  conv("r6", "XINYI", "child what-if then documents", [
    { say: "what if xin yi gets hurt at school and needs stitches", expect: { mentions: /PA Guardian/i } },
    { say: "what would we need to claim", expect: { direct: true } },
    { say: "is that guaranteed", expect: { direct: true, not: PROMISE } },
  ]);
  conv("r7", "IRFAN", "teen sports multi", [
    { say: "irfan sprained his ankle at football practice on saturday" },
    { say: "went to the polyclinic only, no hospital" },
    { say: "paid about eighty dollars" },
  ], true);
  one("r6", "WEIJIE", "whatif death term", "what if wei jie dies, how much will the family get", { mentions: /S\$800,000|TermSecure/ });
  one("r6", "WEIJIE", "whatif cancer term", "if wei jie gets cancer how much can claim", { mentions: /TermSecure|critical illness/i });

  // =============================================================== Round 9 integration: open items closed
  // (a) "my dad" when the only parent on file is not known to be a father: asked who, never her.
  one("r6", null, "2a dad passed away asks who", "my dad passed away last night, what do i do about his insurance",
    { asksPerson: true, mentions: /your father/i, not: /reported death of Siew Lan|Siew Lan’s (?:death|policies)/i });
  one("r6", "MEILING", "2a my father hospitalised asks who", "my father was admitted to SGH yesterday", { asksPerson: true, not: /Siew Lan(?:’s)? (?:policies|hospital stay)/i });
  conv("r6", null, "2a dad then tap the parent", [
    { say: "my dad passed away on 2026-09-20", expect: { asksPerson: true } },
    { say: "Wong Siew Lan", pick: /Siew Lan/, expect: { person: "SIEWLAN" } },
  ]);
  one("r7", null, "2a mum by patronymic still resolves", "my mum was admitted to hospital yesterday", { person: "AMINAH", asksPerson: false });
  // (b) A discharge date given in the same message is not asked for again.
  conv("r7", null, "2b discharge date same message", [
    { say: "aisyah was admitted on 3rd sept and discharged 7 sept", expect: { person: "AISYAH", not: /discharged \(or is the stay still going on\)/i } },
    { say: "it was for dengue", expect: { not: /discharged \(or is the stay still going on\)|date of admission/i } },
  ], true);
  conv("r6", "MEILING", "2b admitted and discharged words", [
    { say: "i want to claim, admitted 2 Sept discharged 6 Sept at Gleneagles", expect: { not: /discharged \(or is the stay still going on\)|date of admission/i } },
  ], true);
  // (c) Sick with no hospital stay: not asked about an operation.
  conv("r7", "MARIA", "2c helper sick no surgery question", [
    { say: "my helper fell sick, need to see doctor", expect: { person: "MARIA", not: /Was surgery performed/i } },
    { say: "outpatient got cover?", expect: { asksPerson: false, not: /Was surgery performed|can[’']t find anyone called/i } },
  ]);
  conv("r7", "MARIA", "2c helper sick then admitted", [
    { say: "maria is sick with fever", expect: { not: /Was surgery performed/i } },
  ]);
  // (d) Hurt on a trip the household is talking about: the travel plan in force then answers too.
  conv("r6", "MEILING", "2d ski trip uses travel cover", [
    { say: "going to japan next month, what travel cover i got", expect: { mentions: /TravelSafe/ } },
    { say: "if i break leg skiing?", expect: { mentions: /Overseas medical expenses/, not: /Baggage delay|Travel delay|COVID-19/ } },
  ]);
  one("r6", "MEILING", "2d break leg at home no travel", "if i break my leg playing football at the void deck how much can claim", { not: /Overseas medical expenses|TravelSafe/ });
  // (e) Several people hurt in one event: everyone named is acknowledged and the claim goes one person at a time.
  conv("r7", null, "2e two hurt one event", [
    { say: "car accident yesterday on PIE, my son Irfan and my mum were both in the car and got injured", expect: { person: "IRFAN", mentions: [/Aminah/, /one person at a time/i] } },
    { say: "Irfan broke his arm, mak only bruises", expect: { person: "IRFAN" } },
    { say: "yes", expect: { not: /This sounds like an accident/ } }, "Singapore", "yesterday", "not sure", "not sure",
    { say: "not sure", expect: { mentions: /start Aminah’s claim/ } },
    { say: "ok start Aminah's claim", expect: { person: "AMINAH" } },
  ], true);
  // (f) A cause the household plainly stated is confirmed, not asked open-ended; nothing is recorded until they answer.
  conv("r6", "XINYI", "2f monkey bars confirms accident", [
    { say: "xin yi fell off the monkey bars two days ago and fractured her wrist", expect: { mentions: /This sounds like an accident — is that right\?/, not: /Was this caused by an accident, or an illness\?/ } },
    { say: "yes", expect: { not: /This sounds like an accident|Was this caused by an accident, or an illness/ } },
  ], true);
  conv("r6", "XINYI", "2f broken wrist alone still asks", [
    { say: "xin yi fractured her wrist", expect: { not: /This sounds like an accident/ } },
  ], true);
  return c;
}
