/** A page that says its printed sum insured is not what is paid: "The sum insured reflected in this schedule is to
 * determine the bonus calculation (if any). The 'sum insured' does not represent the amount to be paid out for claims or
 * surrender." Participating and investment-linked plans in many markets print such a notional sum (a bonus base). A sum
 * insured printed on such a page is never a cover amount: no tile, total, share or answer uses it, and the cover is named
 * with no fixed sum. Closed phrasings in English, Malay and Chinese; a page that only limits or conditions its sum ("will
 * not be reduced by", "is not payable if") is not one of them. */
const SUBJECT = String.raw`(?:sum\s+(?:insured|assured)|face\s+amount|basic\s+sum|coverage\s+amount|amount\s+(?:insured|assured))`;
const NOT = String.raw`(?:does\s+not|doesn['’]t|do\s+not|don['’]t|shall\s+not|will\s+not|won['’]t|is\s+not|isn['’]t|are\s+not|aren['’]t|may\s+not)`;
const STANDS_FOR = String.raw`(?:(?:represent|reflect|indicate|constitute|mean|equal|denote)\w*|(?:be\s+)?(?:the|an?|any)\s+(?:actual\s+|real\s+)?(?:amount|sum|benefit))`;
const PAID = String.raw`(?:paid|payable|pay\s*out|payout|claims?|surrender\w*|death\s+benefit|benefits?\s+payable)`;
const BONUS_USE = String.raw`(?:is|are)\s+(?:used\s+|meant\s+|shown\s+|stated\s+|printed\s+)?(?:only\s+|solely\s+|purely\s+)?(?:to|for)\s+(?:determin\w*|calculat\w*|comput\w*|work\w*\s+out)\s+(?:of\s+)?(?:the\s+)?(?:[a-z]+\s+){0,2}bonus`;
const NOTIONAL = [
  new RegExp(String.raw`\b${SUBJECT}\b[^.;]{0,120}?\b${NOT}\s+${STANDS_FOR}\b[^.;]{0,100}?\b${PAID}`, "iu"),
  new RegExp(String.raw`\b${SUBJECT}\b[^.;]{0,80}?\b${BONUS_USE}`, "iu"),
  new RegExp(String.raw`\bfor\s+(?:the\s+)?(?:purposes?\s+of\s+)?bonus\s+calculations?(?:\s+purposes?)?\s+only\b`, "iu"),
  new RegExp(String.raw`\bnotional\s+${SUBJECT}\b`, "iu"),
  new RegExp(String.raw`\bjumlah\s+(?:yang\s+)?(?:diinsuranskan|dijamin|perlindungan)\b[^.;]{0,120}?\btidak\s+(?:mewakili|menggambarkan|bermaksud|sama\s+dengan)\b[^.;]{0,100}?\b(?:dibayar\w*|bayaran|tuntutan|penyerahan)`, "iu"),
  new RegExp(String.raw`\bjumlah\s+(?:diinsuranskan|dijamin)\s+nosional\b`, "iu"),
  /(?:保额|保額|保险金额|保險金額|投保金额|投保金額)[^。；]{0,40}?(?:不代表|并不代表|並不代表|不等于|不等於|并非|並非|不是)[^。；]{0,40}?(?:赔付|賠付|给付|給付|理赔|理賠|退保|身故|支付)/u,
  /(?:保额|保額|保险金额|保險金額)[^。；]{0,30}?(?:仅|僅|只)(?:用于|用於|供)(?:计算|計算)(?:红利|紅利|分红|分紅)/u,
];
export function printsNotionalSum(pageText: string | null | undefined): boolean {
  const text = String(pageText ?? "").normalize("NFKC").replace(/["“”'‘’]/g, (q) => (q === "'" || q === "’" ? q : " ")).replace(/\s+/g, " ");
  return NOTIONAL.some((re) => re.test(text));
}
export const NOTIONAL_SUM_NOTE = "The document says this sum insured is not the amount paid on a claim, so DearPolicy does not use it as a cover amount.";
