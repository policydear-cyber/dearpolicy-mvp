/** What the Benefits page says for a benefit stored with no amount it can use. "The amount on page 49 could not be read"
 * is only true when the passage read for it prints a figure DearPolicy could not use; a passage with no figure in it at
 * all ("The life insured will be covered for death and terminal illness", "Get one lump sum payment of the coverage
 * amount upon diagnosis") was read, and says the benefit in words. Runs in the browser: no database code here. */
/** Anything that may state an amount without an ASCII digit (TE pr206): a digit in any script ("５００"), a currency sign,
 * code or name ("S$ five hundred", "RM lima ratus"), a number word in English or Malay, a Chinese or Japanese numeral, or a
 * share or multiple ("fifty per cent", "Double the sum assured", "Half of the sum insured"). When any is there, the
 * passage is not called words-only. "One" alone is not counted: it names a count, not an amount. A fraction in words ("a
 * tenth of"), or a word that points to an amount printed elsewhere ("the Sum Assured as shown in the Policy Schedule",
 * "an amount equal to the annual premium"), also keeps "could not be read": the amount exists, it is just not in this
 * passage (Critic R400). */
const MAY_STATE_AMOUNT = new RegExp([
  String.raw`\p{Nd}|\p{Sc}|[一二三四五六七八九十百千万萬亿億两兩零〇壹贰貳叁參肆伍陆陸柒捌玖拾佰仟]`,
  String.raw`\b(?:SGD|USD|MYR|RM|GBP|EUR|HKD|AUD|NZD|CAD|JPY|CNY|RMB|IDR|THB|INR|PHP|BND|TWD|NTD)\b`,
  String.raw`\b(?:dollars?|cents?|pounds?|sterling|ringgit|sen|euros?|yen|yuan|renminbi|rupees?|rupiah|baht|pesos?|francs?)\b`,
  String.raw`\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?|lakhs?|crores?|dozens?)\b`,
  String.raw`\b(?:dua|tiga|empat|lima|enam|tujuh|lapan|sembilan|sepuluh|sebelas|belas|puluh|seratus|ratus|seribu|ribu|sejuta|juta|separuh|setengah)\b`,
  String.raw`\b(?:\w+-)?(?:fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth|fortieth|fiftieth|sixtieth|seventieth|eightieth|ninetieth|hundredth|thousandth|millionth)s?\b`,
  String.raw`\bper(?:dua|tiga|empat|lima|enam|tujuh|lapan|sembilan|sepuluh|seratus)\b|\bsuku\b`,
  String.raw`\b(?:amounts?|sums?|premiums?|schedules?|values?|limit(?:s|ed)?|maximum|minimum|cap(?:s|ped)?)\b`,
  String.raw`\b(?:half|halves|double[ds]?|twice|triple[ds]?|treble[ds]?|thrice|quarters?|thirds?|percent(?:age)?|per\s*cent(?:um)?|multiples?)\b|%`,
].join("|"), "iu");

/** Why a passage that was read has no fixed amount, for any policy (could-not-read audit, 31 Oct). Each is a kind of
 * wording, never one insurer's: a benefit that waives premiums pays nothing; one paid in advance from the death benefit
 * follows it; one that pays the whole sum insured in words needs the person's own schedule; one worked out from the
 * policy's value or the premiums paid has no figure until the claim. A reason is given only when, with the reason's own
 * words and harmless counts and durations taken out, nothing else in the passage may state an amount (TE pr230). */
const WAIVES_PREMIUMS = /\bwaive[sd]?\s+(?:all\s+|any\s+)?(?:the\s+)?(?:future\s+|further\s+|subsequent\s+)?premiums?\b|\bwaiver\s+of\s+(?:future\s+)?premiums?\b|\bpremiums?\s+(?:will\s+be|shall\s+be|are|is)\s+waived\b|\b(?:not|no\s+longer)\s+(?:charge|collect)\s+(?:any\s+)?(?:further\s+|future\s+)?premiums?\b|\b(?:pengecualian|pembebasan|mengecualikan|membebaskan)\s+(?:semua\s+|sebarang\s+)?premi(?:um)?\b|\bpremi(?:um)?\s+(?:akan\s+)?dibebaskan\b/giu;
const ADVANCE_OF_DEATH_BENEFIT = /\b(?:an\s+)?(?:advance(?:ment)?|accelerat\w*)\s+(?:of|from|on)\s+(?:the\s+)?death\s+benefit\b/giu;
const WHOLE_SUM_IN_WORDS = /\b(?:(?:one\s+)?lump\s+sum\s+(?:payment\s+)?of|pays?|payable\s+is|(?:pay(?:s|able)?\s+)?the\s+full)\s+the\s+(?:coverage\s+amount|sum\s+(?:assured|insured)|insured\s+amount|amount\s+of\s+cover)\b/giu;
const FROM_POLICY_VALUE = /\b(?:\d{1,3}(?:\.\d+)?\s*%\s+of\s+\(?\s*(?:the\s+)?)?(?:(?:policy|cash[\s-]?in|cash|surrender|account|fund|unit|investment|maturity)\s+values?\b|bid\s+price\b|nilai\s+(?:tunai|penyerahan|polisi)\b|(?:reversionary|accumulated|cash[\s-]?in|terminal)\s+bonus(?:es)?\b)|\b(?:\d{1,3}(?:\.\d+)?\s*%\s+of|of|return\w*|refund\w*|and|or)\s+\(?\s*(?:the\s+|all\s+)?(?:total\s+)?premiums?\s+paid\b(?:\s+on\s+the\s+[\p{L}\s]{1,20}?\b(?:plan|policy|benefit)\b)?(?:,?\s*(?:less|minus|excluding)\s+any\s+(?:[\p{L}-]+\s+){0,2}premiums?\b)?/giu;
/** Counts and durations that state no amount: "37 critical illnesses", "12 months", "age 65", "the 2nd year". */
const HARMLESS_FIGURES = /\b\p{Nd}{1,3}\s+(?:early\s+|covered\s+|specified\s+|major\s+)?(?:critical\s+)?(?:illnesses|conditions|diseases)\b|(?<!\b(?:for|over|selama)\s+)\b\p{Nd}{1,4}\s+(?:consecutive\s+|policy\s+|calendar\s+)?(?:hours?|days?|weeks?|months?|years?)\b|\b(?:age|aged)\s+\p{Nd}{1,3}\b|\b\p{Nd}{1,2}(?:st|nd|rd|th)\s+(?:policy\s+)?(?:year|month)\b/giu;
/** How it is paid, not how much: "in one lump sum". */
const IN_A_LUMP_SUM = /\b(?:in|as)\s+(?:a|one)\s+(?:single\s+)?lump[\s-]sum\b/giu;
/** Words that make the payout differ from the whole sum: "less any loan", "for each child", "in ten yearly instalments". */
const CHANGES_THE_SUM = /\b(?:less|minus|deduct\w*|net|reduc\w*|loans?|debts?|offset|except|or|but|times|instead|after|plus|subject|each|per|every|instal\w*|yearly|annual\w*|monthly|parts?|only|base)\b/iu;
const NAMED_LIMIT = /\b(?:(?:will\s+)?not\s+(?:be\s+)?more\s+than|no\s+more\s+than|within|up\s+to|subject\s+to)\s+the\s+[\p{L}/()\s-]{0,40}?\blimits?\b/giu;
/** What else a waiver, an advance or a whole-sum passage may say (allow-list, Critic R466): who, what event, when, and
 * the plan's own words. A word of paying, adding, refunding or adjusting ("and pay the sum insured", "together with an
 * extra payment", "adjusted for inflation", "otherwise we refund") is not here, so the passage keeps "could not be read".
 * Short capitalised abbreviations ("TPD", "CI") count as the benefit's own name. */
const FILLER = new Set(("a an the this that these those it its we will shall would may be is are was were been being has have had "
  + "of in on at to by for from with as under within during upon if when where while before until any all one and however "
  + "you your our his her their life insured assured person policy policyholder policyowner owner plan basic main rider contract "
  + "benefit due date beginning starting diagnosis diagnosed death dies die dying terminal terminally illness illnesses critical "
  + "early major disease diseases condition conditions covered total totally permanent permanently disability disabled "
  + "accident accidental injury hospital get receive continues continue cover force future further remaining first stated shown specified set out applies apply "
  + "kami akan yang dan jika apabila semasa hayat diinsuranskan orang polisi pelan manfaat kematian penyakit kritikal hilang upaya kekal "
  + "masa hadapan depan peserta").split(" "));
/** A value passage may also say how the value is taken: "pay … being the Policy Value as at the relevant Valuation Day",
 * "the higher of (a) … or (b) …", "choose to fully or partially withdraw". Adding to it ("plus a bonus", "together with
 * interest", "otherwise we refund") is not here. */
const VALUE_FILLER = new Set(("pay pays paid payable return returns refund refunds being higher greater of or following alive maturity "
  + "relevant valuation day determined reference prevailing immediately choose either fully partially withdraw withdrawn surrender "
  + "surrendered term dies policy guaranteed declared accumulated").split(" "));
/** Fees and charges taken from a value leave it a value: "(less applicable fees and charges, if any)". */
const LESS_FEES = /\(?\s*less\s+(?:any\s+)?(?:applicable\s+)?(?:fees|charges)(?:\s+and\s+(?:fees|charges))?(?:,?\s*if\s+any)?\s*\)?/giu;
/** "we will pay the TI benefit as …", "is paid as …": the reason itself, said with a verb of paying. */
const PAID_AS = /\b(?:(?:we\s+(?:will\s+|shall\s+)?)?pay(?:s|able)?\s+(?:the\s+|this\s+)?(?:[\p{L}/]+\s+){0,3}?benefit\s+as|(?:is|are|will\s+be|shall\s+be)\s+paid\s+as|(?:is|are|will\s+be|shall\s+be)\s+paid(?=\s+(?:within|on|upon|to|when|if)\b))\b/giu;
function onlyFiller(rest: string, extra?: Set<string>): boolean {
  return rest.replace(PAID_AS, " ").split(/[^\p{L}\p{N}%]+/u).filter(Boolean)
    .every((w) => FILLER.has(w.toLowerCase()) || extra?.has(w.toLowerCase()) || /^\p{Lu}{2,4}$/u.test(w) || /^\p{Ll}$/u.test(w));
}
const NEGATED = /\b(?:not|never|no|bukan|tidak)\b/iu;
/** The first match of a reason that no earlier word of its own sentence denies ("is not an advance of the death benefit"). */
function says(passage: string, reason: RegExp): boolean {
  for (const m of passage.matchAll(reason)) if (!NEGATED.test(passage.slice(0, m.index).split(/[.;:!?]\s/u).at(-1) ?? "")) return true;
  return false;
}

export function unreadAmountLine(sourcePage: number | null, quote: string | null | undefined): string {
  const where = sourcePage ? `page ${sourcePage}` : "the page";
  const passage = (quote ?? "").normalize("NFKC").trim();
  // A stored quote is cut at 260 characters, so a long one may have lost its figure at the cut.
  const whole = passage.length > 0 && passage.length < 255;
  // Each reason takes out only its own words: "waive future premiums and pay the sum insured" keeps "pay the sum insured".
  const base = passage.replace(HARMLESS_FIGURES, " ").replace(IN_A_LUMP_SUM, " ");
  const without = (reason: RegExp) => base.replace(reason, " ");
  const fits = (reason: RegExp, rest: string, extra?: Set<string>) => whole && says(passage, reason) && !MAY_STATE_AMOUNT.test(rest) && onlyFiller(rest, extra);
  if (fits(WAIVES_PREMIUMS, without(WAIVES_PREMIUMS))) return `The passage on ${where} waives future premiums. This benefit pays no amount itself.`;
  // An advance may name, without a figure, the limit the policy sets for it ("not more than the TI/CI limit").
  if (fits(ADVANCE_OF_DEATH_BENEFIT, without(ADVANCE_OF_DEATH_BENEFIT).replace(NAMED_LIMIT, " ")))
    return `The passage on ${where} pays this in advance from the death benefit, so its amount follows the death benefit, within any limit the policy sets.`;
  if (fits(WHOLE_SUM_IN_WORDS, without(WHOLE_SUM_IN_WORDS)) && !CHANGES_THE_SUM.test(without(WHOLE_SUM_IN_WORDS)))
    return `The passage on ${where} pays the whole sum insured, which this document does not print for you. Your amount is on your own policy schedule or certificate.`;
  // One value with another ("the maturity value together with any reversionary bonus") is still a value.
  const valueRest = base.replace(FROM_POLICY_VALUE, " \u0000 ").replace(/\b(?:together\s+with|and)\s+(?:any\s+|all\s+)?(?=\u0000)/gu, " ").replace(LESS_FEES, " ");
  if (fits(FROM_POLICY_VALUE, valueRest, VALUE_FILLER))
    return `The passage on ${where} works this out from the policy's value or the premiums paid at the time, so the document prints no fixed amount for it.`;
  if (whole && !MAY_STATE_AMOUNT.test(passage)) return `The passage on ${where} describes this in words, with no amount in it.`;
  return `The amount on ${where} could not be read.`;
}
