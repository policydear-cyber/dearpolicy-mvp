import path from "node:path";
import { readFile } from "node:fs/promises";

try { process.loadEnvFile(path.resolve(".env.local")); } catch { /* optional outside local dev */ }

/** Reads every uploaded policy once and stores its benefits.
 *
 * This is the slow, thorough pass. Run it after uploading documents; afterwards
 * questions are answered from the stored table in milliseconds, with no model
 * involved and the same answer every time. Re-running is safe: it replaces only
 * the derived benefit rows and never touches documents, pages or coverage. */
async function main(){
  const { pool,devAccountId }=await import("../lib/db/client");
  const { catalogueDocument,documentPages }=await import("../lib/policies/catalog-builder");
  const accountId=devAccountId();
  await pool.query(await readFile(path.resolve("sql/benefit-catalog.sql"),"utf8"));
  const only=process.argv.slice(2).filter(argument=>!argument.startsWith("-"));
  const documents=(await pool.query<{id:string;product_name:string|null;original_filename:string;page_count:number}>(
    "SELECT p.id,p.product_name,p.original_filename,(SELECT count(*)::int FROM policy_pages pg WHERE pg.account_id=p.account_id AND pg.policy_id=p.id) AS page_count FROM policies p WHERE p.account_id=$1 AND p.processing_status='ready' ORDER BY p.created_at",
    [accountId])).rows.filter(document=>!only.length||only.some(term=>
      document.original_filename.toLowerCase().includes(term.toLowerCase())||(document.product_name??"").toLowerCase().includes(term.toLowerCase())));
  if(!documents.length){console.log("No processed documents to index.");await pool.end();return;}
  console.log("Indexing "+documents.length+" document(s). This reads each page once and is meant to be slow.\n");
  const started=Date.now();
  let total=0;let totalConditions=0;
  for(const [index,document] of documents.entries()){
    const label=(document.product_name??document.original_filename)+" ("+document.page_count+" pages)";
    process.stdout.write("["+(index+1)+"/"+documents.length+"] "+label+" ");
    const pages=await documentPages(accountId,document.id);
    const found=await catalogueDocument({accountId,policyId:document.id,productName:document.product_name,pages,
      report:(page,pageTotal)=>process.stdout.write("\r["+(index+1)+"/"+documents.length+"] "+label+" — page "+page+" of "+pageTotal+"      ")});
    total+=found;
    // The conditions pass reads the same pages for the other half of the
    // contract: what the cover does NOT pay, and when.
    let conditions=0;
    try{
      const { catalogueConditions }=await import("../lib/policies/condition-catalog");
      conditions=await catalogueConditions({accountId,policyId:document.id,productName:document.product_name,pages,
        report:(page,pageTotal)=>process.stdout.write("\r["+(index+1)+"/"+documents.length+"] "+label+" — conditions, page "+page+" of "+pageTotal+"      ")});
    }catch{/* conditions are additive */}
    totalConditions+=conditions;
    console.log("\r["+(index+1)+"/"+documents.length+"] "+label+" — "+found+" benefit(s), "+conditions+" condition(s) stored.          ");
  }
  console.log("\nStored "+total+" benefit rule(s) and "+totalConditions+" policy condition(s) in "+Math.round((Date.now()-started)/1000)+"s.");
  console.log("Questions are now answered from this table without reading the documents again.");
  console.log("Run 'npm run policies:report' to see what was captured, and re-run this after uploading new documents.");
  await pool.end();
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exit(1);});
