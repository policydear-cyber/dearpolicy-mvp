/** The people a benefit is worked out for, each listed once. One person can be linked to the same scheme booklet through
 * several of their documents (two copies of a certificate, a wording or letter they declared as theirs), and each link
 * is a contract of its own. Listed contract by contract, the same person appeared two or three times, some with the
 * sum and some without. For any household: one entry per sum each person's covers give (the same sum on two documents
 * is one entry; two different sums are both shown, never one picked), and an entry with no sum only for a person none
 * of whose contracts gives one. People are kept apart by who they are, never by display name. */
export type PersonAmount={owner:string;plan:string|null;amount:string|null};

export function oncePerPerson(entries:(PersonAmount&{ownerId:string})[]):PersonAmount[]{
  const out:PersonAmount[]=[];
  for(const ownerId of [...new Set(entries.map(e=>e.ownerId))]){
    const own=entries.filter(e=>e.ownerId===ownerId);
    const withSum=own.filter(e=>e.amount!=null);
    if(!withSum.length){out.push({owner:own[0].owner,plan:null,amount:null});continue;}
    const seen=new Set<string>();
    for(const e of withSum){
      const key=e.amount+"\u0000"+(e.plan??"").normalize("NFKC").toLowerCase().replace(/\s+/g," ").trim();
      if(seen.has(key))continue;
      seen.add(key);
      out.push({owner:e.owner,plan:e.plan,amount:e.amount});
    }
  }
  return out;
}
