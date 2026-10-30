/** What the Benefits page says for a benefit stored with no amount it can use. "The amount on page 49 could not be read"
 * is only true when the passage read for it prints a figure DearPolicy could not use; a passage with no figure in it at
 * all ("The life insured will be covered for death and terminal illness", "Get one lump sum payment of the coverage
 * amount upon diagnosis") was read, and says the benefit in words. Runs in the browser: no database code here. */
/** Anything that may state an amount without an ASCII digit (TE pr206): a digit in any script ("５００"), a currency sign,
 * code or name ("S$ five hundred", "RM lima ratus"), a number word in English or Malay, a Chinese or Japanese numeral, or a
 * share or multiple ("fifty per cent", "Double the sum assured", "Half of the sum insured"). When any is there, the
 * passage is not called words-only. "One" alone ("one lump sum payment") is not counted: it names a count, not an amount. */
const MAY_STATE_AMOUNT = new RegExp([
  String.raw`\p{Nd}|\p{Sc}|[一二三四五六七八九十百千万萬亿億两兩零〇壹贰貳叁參肆伍陆陸柒捌玖拾佰仟]`,
  String.raw`\b(?:SGD|USD|MYR|RM|GBP|EUR|HKD|AUD|NZD|CAD|JPY|CNY|RMB|IDR|THB|INR|PHP|BND|TWD|NTD)\b`,
  String.raw`\b(?:dollars?|cents?|pounds?|sterling|ringgit|sen|euros?|yen|yuan|renminbi|rupees?|rupiah|baht|pesos?|francs?)\b`,
  String.raw`\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?|lakhs?|crores?|dozens?)\b`,
  String.raw`\b(?:dua|tiga|empat|lima|enam|tujuh|lapan|sembilan|sepuluh|sebelas|belas|puluh|seratus|ratus|seribu|ribu|sejuta|juta|separuh|setengah)\b`,
  String.raw`\b(?:half|halves|double[ds]?|twice|triple[ds]?|treble[ds]?|thrice|quarters?|thirds?|percent(?:age)?|per\s*cent(?:um)?|multiples?)\b|%`,
].join("|"), "iu");

export function unreadAmountLine(sourcePage: number | null, quote: string | null | undefined): string {
  const where = sourcePage ? `page ${sourcePage}` : "the page";
  const passage = (quote ?? "").normalize("NFKC").trim();
  if (passage && !MAY_STATE_AMOUNT.test(passage)) return `The passage on ${where} describes this in words, with no amount in it.`;
  return `The amount on ${where} could not be read.`;
}
