import { canonicalProduct } from "@/lib/coverage/facts";
import { formatMoney } from "@/lib/format/currency";
import type { PolicyContract } from "@/lib/policies/inventory";

/** A cross-check on the numbers themselves, before anything is calculated from
 * them.
 *
 * A group certificate prints one row per person per plan, and a table whose
 * columns drift by a row gives every amount to the wrong plan. Nothing
 * downstream can catch that: each figure is a real figure from a real page, and
 * the arithmetic on it is correct. It is only wrong in the sense that matters,
 * which is that it belongs to a different plan.
 *
 * Two people on the same scheme make it visible. When a household's members
 * hold the SAME set of amounts under one policy number but those amounts are
 * attached to different plans for different people, one of the two readings is
 * wrong, and which one is a question only the certificate can answer. So
 * DearPolicy says so rather than quietly calculating from whichever it read.
 */
export type ScheduleInconsistency={policyNumber:string;detail:string};

export function transposedScheduleWarnings(contracts:PolicyContract[]):ScheduleInconsistency[]{
  type Row={person:string;product:string;amount:number;currency:string};
  const byScheme=new Map<string,Row[]>();
  for(const contract of contracts)
    for(const coverage of contract.coverages){
      if(coverage.amount==null||!(coverage.amount>0))continue;
      const scheme=(coverage.policyNumber??coverage.groupPolicyNumber??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
      if(scheme.length<4)continue;
      const product=canonicalProduct(coverage.productName??coverage.policyName??coverage.category);
      if(!product)continue;
      byScheme.set(scheme,[...(byScheme.get(scheme)??[]),
        {person:contract.ownerName,product,amount:coverage.amount,currency:coverage.currency||"SGD"}]);
    }
  const out:ScheduleInconsistency[]=[];
  for(const [scheme,rows] of byScheme){
    const people=[...new Set(rows.map(row=>row.person))];
    if(people.length<2)continue;
    const amountsFor=(person:string)=>rows.filter(row=>row.person===person).map(row=>row.amount).sort((a,b)=>a-b).join(",");
    const shape=amountsFor(people[0]);
    // The same amounts for everyone: one scheme, one set of sums, which is what
    // makes the comparison meaningful at all.
    if(!people.every(person=>amountsFor(person)===shape))continue;
    const disagreeing:string[]=[];
    for(const product of new Set(rows.map(row=>row.product))){
      const amounts=new Set(rows.filter(row=>row.product===product).map(row=>row.amount));
      if(amounts.size>1)disagreeing.push(product);
    }
    if(!disagreeing.length)continue;
    const currency=rows[0].currency;
    const listed=disagreeing.slice(0,3).map(product=>{
      const each=rows.filter(row=>row.product===product)
        .map(row=>row.person+" "+formatMoney(row.amount,currency)).join(" and ");
      return "“"+product+"” reads as "+each;
    }).join("; ");
    out.push({policyNumber:scheme,
      detail:"The certificate for policy "+scheme+" lists the same amounts for "+people.slice(0,3).join(" and ")
        +", but attaches them to different plans for each of them — "+listed
        +". One of those readings is wrong, and only the certificate can say which. "
        +"Open it and check which amount belongs to which plan before relying on a figure from this scheme."});
  }
  return out;
}
