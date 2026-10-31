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
const WAIVES_PREMIUMS = /\bwaive[sd]?\s+(?:all\s+|any\s+)?(?:the\s+)?(?:future\s+|further\s+|subsequent\s+)?premiums?\b|\bwaiver\s+of\s+(?:future\s+)?premiums?\b|\bpremiums?\s+(?:will\s+be|shall\s+be|are|is)\s+waived\b|\b(?:not|no\s+longer)\s+(?:charge|collect)\s+(?:any\s+)?(?:further\s+|future\s+)?premiums?\b|\b(?:pengecualian|pembebasan|mengecualikan|membebaskan)\s+premi(?:um)?\b|\bpremi(?:um)?\s+(?:akan\s+)?dibebaskan\b/giu;
const ADVANCE_OF_DEATH_BENEFIT = /\b(?:an\s+)?(?:advance(?:ment)?|accelerat\w*)\s+(?:of|from|on)\s+(?:the\s+)?death\s+benefit\b/giu;
const WHOLE_SUM_IN_WORDS = /\b(?:(?:one\s+)?lump\s+sum\s+(?:payment\s+)?of|pays?|payable\s+is|the\s+full)\s+the\s+(?:coverage\s+amount|sum\s+(?:assured|insured)|insured\s+amount|amount\s+of\s+cover)\b/giu;
const FROM_POLICY_VALUE = /\b(?:\d{1,3}(?:\.\d+)?\s*%\s+of\s+\(?\s*(?:the\s+)?)?(?:(?:policy|cash[\s-]?in|cash|surrender|account|fund|unit|investment|maturity)\s+values?\b|bid\s+price\b|(?:reversionary|accumulated|cash[\s-]?in|terminal)\s+bonus(?:es)?\b)|\b(?:\d{1,3}(?:\.\d+)?\s*%\s+of|of|return\w*|refund\w*|and|or)\s+\(?\s*(?:the\s+|all\s+)?(?:total\s+)?premiums?\s+paid\b(?:\s+on\s+the\s+[\p{L}\s]{1,20}?\b(?:plan|policy|benefit)\b)?(?:,?\s*(?:less|minus|excluding)\s+any\s+(?:[\p{L}-]+\s+){0,2}premiums?\b)?/giu;
/** Counts and durations that state no amount: "37 critical illnesses", "12 months", "age 65", "the 2nd year". */
const HARMLESS_FIGURES = /\b\p{Nd}{1,3}\s+(?:early\s+|covered\s+|specified\s+|major\s+)?(?:critical\s+)?(?:illnesses|conditions|diseases)\b|\b\p{Nd}{1,4}\s+(?:consecutive\s+)?(?:hours?|days?|weeks?|months?|years?)\b|\b(?:age|aged)\s+\p{Nd}{1,3}\b|\b\p{Nd}{1,2}(?:st|nd|rd|th)\s+(?:policy\s+)?(?:year|month)\b/giu;
/** How it is paid, not how much: "in one lump sum". */
const IN_A_LUMP_SUM = /\b(?:in|as)\s+(?:a|one)\s+(?:single\s+)?lump[\s-]sum\b/giu;
/** Words that make the payout differ from the whole sum: "less any loan", "for each child", "in ten yearly instalments". */
const CHANGES_THE_SUM = /\b(?:less|minus|deduct\w*|net|reduc\w*|loans?|debts?|offset|except|or|but|times|instead|after|plus|subject|each|per|every|instal\w*|yearly|annual\w*|monthly|parts?|only|base)\b/iu;
const NAMED_LIMIT = /\b(?:(?:will\s+)?not\s+(?:be\s+)?more\s+than|no\s+more\s+than|within|up\s+to|subject\s+to)\s+the\s+[\p{L}/()\s-]{0,40}?\blimits?\b/giu;
const NEGATED = /\b(?:not|never|no)\s+(?:[\p{L}-]+\s+){0,2}$/iu;
/** The first match of a reason that is not denied just before it ("is not an advance of the death benefit"). */
function says(passage: string, reason: RegExp): boolean {
  for (const m of passage.matchAll(reason)) if (!NEGATED.test(passage.slice(0, m.index))) return true;
  return false;
}

export function unreadAmountLine(sourcePage: number | null, quote: string | null | undefined): string {
  const where = sourcePage ? `page ${sourcePage}` : "the page";
  const passage = (quote ?? "").normalize("NFKC").trim();
  // A stored quote is cut at 260 characters, so a long one may have lost its figure at the cut.
  const whole = passage.length > 0 && passage.length < 255;
  const rest = passage.replace(WAIVES_PREMIUMS, " ").replace(ADVANCE_OF_DEATH_BENEFIT, " ").replace(WHOLE_SUM_IN_WORDS, " ").replace(FROM_POLICY_VALUE, " ")
    .replace(HARMLESS_FIGURES, " ").replace(IN_A_LUMP_SUM, " ");
  // An advance may name, without a figure, the limit the policy sets for it ("not more than the TI/CI limit").
  if (whole && says(passage, ADVANCE_OF_DEATH_BENEFIT) && !MAY_STATE_AMOUNT.test(rest.replace(NAMED_LIMIT, " ")))
    return `The passage on ${where} pays this in advance from the death benefit, so its amount follows the death benefit, within any limit the policy sets.`;
  if (whole && !MAY_STATE_AMOUNT.test(rest)) {
    if (says(passage, WAIVES_PREMIUMS)) return `The passage on ${where} waives future premiums. This benefit pays no amount itself.`;
    if (says(passage, WHOLE_SUM_IN_WORDS) && !CHANGES_THE_SUM.test(rest))
      return `The passage on ${where} pays the whole sum insured, which this document does not print for you. Your amount is on your own policy schedule or certificate.`;
    if (says(passage, FROM_POLICY_VALUE)) return `The passage on ${where} works this out from the policy's value or the premiums paid at the time, so the document prints no fixed amount for it.`;
  }
  if (whole && !MAY_STATE_AMOUNT.test(passage)) return `The passage on ${where} describes this in words, with no amount in it.`;
  return `The amount on ${where} could not be read.`;
}
