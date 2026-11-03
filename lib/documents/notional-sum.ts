/** A page that says its printed sum insured is not what is paid: "The sum insured reflected in this schedule is to
 * determine the bonus calculation (if any). The 'sum insured' does not represent the amount to be paid out for claims or
 * surrender." Participating and investment-linked plans in many markets print such a notional sum (a bonus base). A sum
 * insured printed on such a page is never a cover amount: no tile, total, share or answer uses it, and the cover is named
 * with no fixed sum.
 *
 * Positive and whole-clause, in closed phrasings (English, Malay, Indonesian, French, Chinese), judged one sentence at a
 * time. A sentence counts only when it (a) says the sum is for bonus purposes ONLY, or is for bonus purposes and is not
 * paid; or (b) denies that the sum is the amount paid on claims or death in general. A sentence that ties the denial to
 * one case, table, benefit, condition, premium, loan, bonus total or limit ("under Benefit 3", "where ...", "if you cancel",
 * "which is the Sum Assured plus bonuses", "the premiums paid", "any outstanding policy loan", "the maximum we pay for
 * hospital bills", "otherwise it is the death benefit") is not one: an ordinary policy keeps its sum (Critic H1 #291). */
const SUBJECT = String.raw`(?:(?:basic\s+|nominal\s+|notional\s+)?sum\s+(?:insured|assured)|face\s+amount|basic\s+sum|coverage\s+amount|amount\s+(?:insured|assured))`;
const NOT = String.raw`(?:does\s+not|doesn['’]t|do\s+not|don['’]t|shall\s+not|will\s+not|won['’]t|is\s+not|isn['’]t|are\s+not|aren['’]t|may\s+not)`;
const STANDS_FOR = String.raw`(?:(?:represent|reflect|indicate|constitute|mean|denote)s?\s+|be\s+)?`;
const PAID_OBJECT = String.raw`(?:the\s+|an?\s+|any\s+)?(?:actual\s+|real\s+)?(?:amount|sum|benefit)s?\s+(?:(?:that\s+)?(?:is\s+|will\s+be\s+)?to\s+be\s+|that\s+(?:is|will\s+be)\s+|we\s+(?:will\s+)?)?(?:paid|payable|pay)(?:\s+out)?`;
const GENERAL_CLAIM = String.raw`(?:on|for|upon|in\s+respect\s+of|at)\s+(?:a\s+|any\s+|the\s+)?(?:claims?|death)\b(?:\s+(?:or|and)\s+(?:on\s+)?(?:surrender|maturity|death|claims?))?`;
const BONUS = String.raw`(?:[a-z]+\s+){0,2}bonus(?:es)?`;
const ONLY_FOR_BONUS = String.raw`(?:is|are)\s+(?:used\s+|meant\s+|shown\s+|stated\s+|printed\s+)?(?:only|solely|purely)\s+(?:(?:to|for)\s+(?:the\s+)?(?:purposes?\s+of\s+)?(?:determin\w*|calculat\w*|comput\w*|work\w*\s+out|allocat\w*)|as\s+a\s+basis\s+for)\s+(?:of\s+)?(?:the\s+)?${BONUS}`;
const FOR_BONUS = String.raw`(?:is|are)\s+(?:used\s+|meant\s+)?(?:(?:to|for)\s+(?:the\s+)?(?:purposes?\s+of\s+)?(?:determin\w*|calculat\w*|comput\w*|allocat\w*)|as\s+a\s+basis\s+for)\s+(?:of\s+)?(?:the\s+)?${BONUS}`;
const NOT_PAID = String.raw`\b${NOT}\s+(?:${STANDS_FOR}${PAID_OBJECT}\s+${GENERAL_CLAIM}|payable\s+${GENERAL_CLAIM}|the\s+claims?\s+amount\b)`;
const NOTIONAL = [
  // (b) the sum is not what is paid on claims or death, in general
  new RegExp(String.raw`\b${SUBJECT}\b.{0,100}?${NOT_PAID}`, "iu"),
  // (a) for bonus purposes only, or for bonus purposes and not paid
  new RegExp(String.raw`\b${SUBJECT}\b.{0,80}?\b${ONLY_FOR_BONUS}`, "iu"),
  new RegExp(String.raw`\b${SUBJECT}\b.{0,80}?\b${FOR_BONUS}\b.{0,60}?\band\s+(?:is|are)\s+not\s+(?:the\s+claims?\s+amount|payable\b)`, "iu"),
  new RegExp(String.raw`\b${SUBJECT}\b[^a-z]{0,6}\(?\s*for\s+(?:the\s+)?(?:purposes?\s+of\s+)?bonus\s+(?:calculation|computation)s?(?:\s+purposes?)?\s+only\b`, "iu"),
  new RegExp(String.raw`\b${SUBJECT}\b(?:\s+\w+){0,3}\s+(?:is|are)\s+(?:a|the)\s+(?:notional\s+)?bonus\s+base\b`, "iu"),
  new RegExp(String.raw`\bnotional\s+${SUBJECT}\b|\b${SUBJECT}\b(?:\s+\w+){0,2}\s+(?:is|are)\s+notional\b`, "iu"),
  // Malay, Indonesian, French
  new RegExp(String.raw`\bjumlah\s+(?:yang\s+)?(?:diinsuranskan|dijamin|perlindungan)\b.{0,80}?\btidak\s+(?:mewakili|menggambarkan|mencerminkan)\s+(?:amaun|jumlah)\s+yang\s+(?:akan\s+)?dibayar\w*\s+(?:bagi|untuk|atas|semasa|apabila)\s+(?:sebarang\s+)?(?:tuntutan|kematian)\b`, "iu"),
  new RegExp(String.raw`\bjumlah\s+(?:diinsuranskan|dijamin)\s+nosional\b`, "iu"),
  new RegExp(String.raw`\buang\s+pertanggungan\b.{0,80}?\btidak\s+(?:mewakili|menggambarkan|mencerminkan)\s+(?:jumlah|nilai)\s+yang\s+(?:akan\s+)?dibayar\w*\s+(?:atas|untuk|bagi|saat)\s+(?:setiap\s+)?(?:klaim|kematian)\b`, "iu"),
  new RegExp(String.raw`\bcapital\s+assur[ée](?!\p{L}).{0,60}?\bne\s+repr[ée]sente\s+pas\s+le\s+montant\s+(?:vers[ée]|pay[ée]|r[ée]gl[ée])\s+en\s+cas\s+de\s+(?:sinistre|d[ée]c[èe]s)(?!\p{L})`, "iu"),
  // Chinese
  /(?:保额|保額|保险金额|保險金額|投保金额|投保金額)[^。；]{0,30}?(?:不代表|并不代表|並不代表|不等于|不等於|并非|並非)[^。；]{0,20}?(?:赔付|賠付|给付|給付|理赔|理賠)(?:金额|金額)?/u,
  /(?:保额|保額|保险金额|保險金額)[^。；]{0,30}?(?:仅|僅|只)(?:用于|用於|供)(?:计算|計算)(?:红利|紅利|分红|分紅)/u,
];
/** A sentence that ties its words to one case, condition, table, premium, loan, bonus total or limit is never a notional
 * note, whatever else it says. */
const TIED = /\b(?:where|wherever|if|when|whenever|unless|except|otherwise|which|whichever|plus|deduct\w*|premiums?|loans?|surrender\s+values?|cash\s+values?|hospital\w*|maximum|partial\w*|table|cancel\w*|benefit\s+\d+|apabila\s+premium|premi)\b/iu;
const TIED_CJK = /保费|保費|贷款|貸款|最高|如果|若|除外|加上/u;
const sentences = (text: string) => text.split(/(?<!\d)[.;](?!\d)|[。；]/u).map((s) => s.trim()).filter(Boolean);
export function printsNotionalSum(pageText: string | null | undefined): boolean {
  const text = String(pageText ?? "").normalize("NFKC").replace(/["“”'‘’]/g, (q) => (q === "'" || q === "’" ? q : " ")).replace(/\s+/g, " ")
    .replace(/\(\s*if\s+any\s*\)/gi, " ");
  return sentences(text).some((s) => !TIED.test(s) && !TIED_CJK.test(s) && NOTIONAL.some((re) => re.test(s)));
}
/** A cover a page's notional note does not govern: a rider or supplementary benefit listed on the same schedule prints a
 * fixed sum of its own (TE O1, Critic L4 on #291). The note governs the basic plan. */
export const RIDER_NAME = /\b(?:riders?|supplementary|supplement|add[- ]?on|additional\s+benefit|optional\s+benefit|tambahan|avenant|zusatz\w*)\b|附加|附約/iu;
export const NOTIONAL_SUM_NOTE = "The document says this sum insured is not the amount paid on a claim, so DearPolicy does not use it as a cover amount.";
