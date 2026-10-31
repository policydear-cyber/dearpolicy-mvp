/** A benefit that pays the whole sum insured in words ("Get one lump sum payment of the coverage amount"), worked out for
 * each person from their own cover of the same name, with the document and page it comes from. For any household: the
 * cover is taken only when its name is the benefit's own name, each person has it, on one document or several that print the same sum, and its amount and
 * currency are written in that person's own evidence. Anything less gives nothing, and the page keeps saying the amount
 * is on the person's own schedule. Never a guess between two covers ("Living Care" and "Living Care Plus"). */
import { documentName,type PolicyContract } from "@/lib/policies/inventory";
import { formatMoney } from "@/lib/format/currency";
import { paysWholeSum } from "@/lib/policies/unread-amount-line";

export type WholeSumLine={owner:string;plan:string;amount:string;source:string};

export function wholeSumAgainst(contracts:PolicyContract[],benefit:{benefitName:string;quote:string|null}):WholeSumLine[]|null{
  if(!contracts.length||!paysWholeSum(benefit.quote))return null;
  // "Group Living Care" on a certificate is the scheme's "Living Care". Every letter and digit in any script counts, and
  // "+" is "plus": "Heart Cover" is never "Heart Cover+", "CI Cover 加强" or "Heart Cover Ⅱ" (TE pr233 D1).
  const identity=(name:string|null|undefined)=>(name??"").normalize("NFKC").toLowerCase().replace(/\+/gu," plus ")
    .replace(/[^\p{L}\p{N}]+/gu," ").trim().replace(/^group\s+/u,"");
  const wanted=identity(benefit.benefitName);
  if(!wanted)return null;
  const lines:WholeSumLine[]=[];
  for(const contract of contracts){
    const named=contract.coverages.filter(c=>identity(c.productName??c.policyName)===wanted);
    // The same cover on two of the person's documents is one cover when both print the same written amount.
    const usable=named.filter(c=>c.amount!=null&&c.amount>0&&!!c.currency&&c.currencyVerified===true);
    if(!named.length||usable.length!==named.length||new Set(usable.map(c=>c.currency+" "+c.amount)).size!==1)return null;
    const cover=usable[0];
    const doc=[...contract.documents,...contract.references].find(d=>d.id===cover.policyId);
    const source=(doc?documentName(doc):"your policy schedule")+(cover.sourcePage?`, page ${cover.sourcePage}`:"");
    lines.push({owner:contract.ownerName,plan:cover.productName??cover.policyName??contract.name,amount:formatMoney(cover.amount!,cover.currency!),source});
  }
  return lines;
}
