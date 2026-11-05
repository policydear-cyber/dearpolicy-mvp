/** Shares of the sum insured that a policy prints in words ("One twelfth of Sum Insured"). A closed list: a fraction
 * not on it is not read, so it can never become a figure. Shared by the table reader (lib/documents/layout.ts,
 * lib/policies/benefit-rows.ts) and the quote checks (lib/policies/benefit-catalog.ts), so both read the same words. */
export const WORD_FRACTIONS:{words:string;value:number}[]=[
  {words:"one half",value:0.5},{words:"one third",value:1/3},{words:"two thirds",value:2/3},
  {words:"one quarter",value:0.25},{words:"three quarters",value:0.75},{words:"one fifth",value:0.2},
  {words:"one sixth",value:1/6},{words:"one eighth",value:0.125},{words:"one tenth",value:0.1},
  {words:"one twelfth",value:1/12},{words:"one twenty[- ]fourth",value:1/24},
];
/** A whole amount cell that is only a worded share of the sum insured: "One twelfth of Sum Insured", "One half of the
 * Sum Assured". Anything else in the cell (a cap, a choice, a period) and it is not this shape. */
export const WORDED_SHARE_CELL=new RegExp(String.raw`^(${WORD_FRACTIONS.map(entry=>entry.words).join("|")})\s+of\s+(?:the\s+)?(?:sum\s+(?:insured|assured)|coverage\s+amount|sum\s+covered|insured\s+amount)\.?$`,"i");
/** The share a worded cell states, or null when the cell is not exactly that shape. */
export function wordedShare(cell:string):{value:number;words:string}|null{
  const match=cell.replace(/\s+/g," ").trim().match(WORDED_SHARE_CELL);
  if(!match)return null;
  const entry=WORD_FRACTIONS.find(item=>new RegExp("^"+item.words+"$","i").test(match[1]));
  return entry?{value:entry.value,words:match[1]}:null;
}
