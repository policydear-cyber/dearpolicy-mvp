import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { benefitRowsFromText } from "@/lib/documents/layout";
import { basisForRow,parseBenefitValue,percentageBases } from "@/lib/policies/benefit-rows";

/** Turns extraction accuracy into a number that can go up.
 *
 * Every fixture holds a document's page text exactly as DearPolicy stores it,
 * plus hand-written ground truth for the benefit rows a person reading that
 * document would expect. Nothing here uses a model or a database, so it runs in
 * seconds and the same input always scores the same.
 *
 * Add a document: store its page text and the rows you expect, then run this.
 * A drop in recall means a real regression in what DearPolicy can read. */
type Expected={page:number;label:string;value:string;kind?:string;amount?:number};
type Fixture={name:string;pages:{page:number;text:string}[];expected:Expected[];
  /** Rows this document must NEVER produce — a premium rate table read as
   * cover, say. A false benefit is worse than a missing one. */
  mustNotProduce?:{page:number;label:string}[]};
const MINIMUM_RECALL=Number(process.env.EXTRACTION_MIN_RECALL??"1");

function normalise(value:string){return value.toLowerCase().replace(/[^a-z0-9%$.]/g,"");}
async function main(){
  const directory=path.resolve("scripts/fixtures/extraction");
  const files=(await readdir(directory).catch(()=>[])).filter(name=>name.endsWith(".json"));
  if(!files.length){console.log("No extraction fixtures yet. Add one to "+directory+".");return;}
  let matchedTotal=0,expectedTotal=0,foundTotal=0,worst=1;
  for(const file of files){
    const fixture=JSON.parse(await readFile(path.join(directory,file),"utf8")) as Fixture;
    const found=fixture.pages.flatMap(page=>{
      const bases=percentageBases(page.text);
      return benefitRowsFromText(page.text).map(row=>({page:page.page,basis:basisForRow(bases,row.index),...row}));
    });
    const misses:string[]=[];
    let matched=0;
    for(const want of fixture.expected){
      const hit=found.find(row=>row.page===want.page&&
        normalise(row.label).includes(normalise(want.label))&&normalise(row.value)===normalise(want.value));
      if(!hit){misses.push("p"+want.page+" "+want.label+" -> "+want.value);continue;}
      matched++;
      if(want.kind){
        const parsed=parseBenefitValue(hit.value,{percentageBasis:hit.basis});
        if(!parsed||parsed.kind!==want.kind||(want.amount!=null&&parsed.value!==want.amount))
          misses.push("p"+want.page+" "+want.label+" parsed as "+(parsed?parsed.kind+" "+parsed.value:"nothing")+", expected "+want.kind+" "+want.amount);
      }
    }
    for(const forbidden of fixture.mustNotProduce??[]){
      const wrong=found.find(row=>row.page===forbidden.page&&normalise(row.label)===normalise(forbidden.label));
      if(wrong)misses.push("p"+forbidden.page+" produced a row that is not a benefit: "+wrong.label+" -> "+wrong.value);
    }
    const recall=fixture.expected.length?matched/fixture.expected.length:1;
    worst=Math.min(worst,recall);
    matchedTotal+=matched;expectedTotal+=fixture.expected.length;foundTotal+=found.length;
    const clean=!misses.length;
    console.log((recall===1&&clean?"PASS":"FAIL")+"  "+fixture.name);
    if(!clean&&recall===1)process.exitCode=1;
    console.log("      expected "+fixture.expected.length+", found "+matched+"  (rows detected on these pages: "+found.length+")");
    for(const miss of misses)console.log("      MISS  "+miss);
  }
  const recall=expectedTotal?matchedTotal/expectedTotal:1;
  console.log("\nRecall on known benefit rows: "+matchedTotal+"/"+expectedTotal+" = "+(recall*100).toFixed(1)+"%");
  console.log("Total rows detected across all fixtures: "+foundTotal);
  if(worst<MINIMUM_RECALL){
    console.log("\nA document DearPolicy could read before is no longer being read. Minimum recall is "+MINIMUM_RECALL+".");
    process.exitCode=1;
  }
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exit(1);});
