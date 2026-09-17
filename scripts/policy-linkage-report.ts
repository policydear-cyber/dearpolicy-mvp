import path from "node:path";

try { process.loadEnvFile(path.resolve(".env.local")); } catch { /* .env.local is optional outside local dev */ }

/** Prints, for every family member, which uploaded documents DearPolicy treats
 * as their personal evidence and which wording documents it bound to them —
 * and, for every wording document it did NOT bind, the exact reason.
 *
 * Read-only. It changes nothing and does not use the GPU. */
async function main(){
  const { pool,devAccountId }=await import("../lib/db/client");
  const { loadPolicyInventory,referenceMatchReason,referenceRoles,passageBudget }=await import("../lib/policies/inventory");
  const { contractCurrentness,loadPremiumEvidence }=await import("../lib/policies/currentness");
  const accountId=devAccountId();
  const family=(await pool.query<{id:string;display_name:string;preferred_name:string|null;relationship:string}>(
    "SELECT id,display_name,preferred_name,relationship FROM family_members WHERE account_id=$1 ORDER BY created_at",[accountId])).rows;
  if(!family.length){console.log("No family profiles exist for this account yet.");await pool.end();return;}
  const inventory=await loadPolicyInventory(accountId,family);
  const premium=await loadPremiumEvidence(accountId,family.map(p=>p.id));
  const now=new Date();
  const label=(d:{original_filename:string;product_name:string|null})=>d.product_name?d.product_name+" ("+d.original_filename+")":d.original_filename;

  console.log("DearPolicy document linkage report");
  console.log("Account "+accountId+" · "+family.length+" family profile(s) · "+inventory.documents.length+" uploaded document(s)\n");

  console.log("UPLOADED DOCUMENTS");
  for(const d of inventory.documents){
    console.log("  "+label(d));
    console.log("    role="+(d.document_role??"none")+"  personalEvidence="+d.personal_coverage_confirmed+"  authority="+d.document_authority+"  processing="+d.processing_status);
    console.log("    insurer="+(d.insurer??"none")+"  policyNo="+(d.policy_number??"none")+"  groupNo="+(d.group_policy_number??"none"));
    console.log("    storedPages="+d.page_total+"  storedPassages="+d.chunk_total+"  passagesReadPerQuestion<="+passageBudget(d.chunk_total)+"  combinedReferenceSections="+(d.has_reference_sections===true));
    const names=d.member_ids.map(id=>family.find(p=>p.id===id)?.display_name??id);
    console.log("    linkedTo="+(names.length?names.join(", "):"NOBODY — this document is linked to no family profile"));
  }

  for(const person of family){
    const contracts=inventory.contracts.filter(c=>c.ownerId===person.id);
    console.log("\n"+"=".repeat(72));
    console.log(person.display_name+" ("+person.relationship+") — "+contracts.length+" contract(s)");
    if(!contracts.length){
      console.log("  No confirmed personal evidence is linked to this person.");
      console.log("  A document only becomes their contract when it is personalised evidence, has authority >= 70, and is linked to them on the Policies page.");
      continue;
    }
    for(const contract of contracts){
      const status=contractCurrentness(contract,premium,now);
      console.log("\n  CONTRACT "+contract.name+"  insurer="+(contract.insurer??"none")+"  ownershipConfirmed="+contract.confirmed);
      console.log("    activeStatus="+status.state+" — "+status.label);
      console.log("    Personal documents:");
      for(const d of contract.documents)console.log("      - "+label(d)+"  [role="+(d.document_role??"none")+", pages="+d.page_total+", passages="+d.chunk_total+"]");
      console.log("    Confirmed cover:");
      if(!contract.coverages.length)console.log("      (none extracted — ownership is not confirmed for this contract)");
      for(const c of contract.coverages)console.log("      - "+(c.productName??c.category)+": "+(c.amount!=null?c.currency+" "+c.amount:"no amount extracted"));
      console.log("    Wording bound to this contract:");
      if(!contract.references.length&&!contract.documents.some(d=>d.has_reference_sections))console.log("      (none — payouts cannot be calculated for this contract)");
      for(const d of contract.documents.filter(d=>d.has_reference_sections))console.log("      - "+label(d)+"  [same PDF: its own reference sections]");
      for(const d of contract.references)console.log("      - "+label(d)+"  [why: "+referenceMatchReason(contract.documents[0],d).reason+"]");
      const rejected=inventory.documents.filter(d=>
        !contract.documents.some(o=>o.id===d.id)&&!contract.references.some(r=>r.id===d.id)&&
        (referenceRoles.has(d.document_role??"")||!d.personal_coverage_confirmed));
      if(rejected.length){
        console.log("    Wording NOT bound to this contract:");
        for(const d of rejected)console.log("      - "+label(d)+"  [why not: "+referenceMatchReason(contract.documents[0],d).reason+"]");
      }
    }
  }
  console.log("\nNothing was changed. Share this output if a document is attached to the wrong person or is missing its wording.");
  await pool.end();
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exit(1);});
