/** A large made-up household (12 documents, 360 pages, about 1 million characters, 2,880 quotes to find) must be checked
 * in a few seconds: the Benefits page builds its table on every visit. Before page text was squashed once per page this
 * took about 21 s. Nothing is read from a database or a model. */
import assert from "node:assert/strict";
import { checkStored } from "../../lib/benefit-table/service";
import { assembleTable } from "../../lib/benefit-table/assemble";
const names=["Aisha Rahman","Ben Carter"];
const words="the insured person shall be entitled to benefits subject to the terms conditions and exclusions of this policy where applicable".split(" ");
let seed=7;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
function line(i:number){const n=8+Math.floor(rnd()*10);return Array.from({length:n},()=>words[Math.floor(rnd()*words.length)]).join(" ")+(rnd()<0.3?`\tS$${(1000+Math.floor(rnd()*90000)).toLocaleString("en")}`:"")+` ${i}`;}
const docs=[] as any[];const stored=[] as any[];
for(let d=0;d<12;d++){
  const pages=Array.from({length:30},(_,p)=>({page:p+1,text:Array.from({length:35},(_,l)=>line(d*10000+p*100+l)).join("\n")}));
  const benefits=[] as any[];
  for(let b=0;b<60;b++){const p=pages[Math.floor(rnd()*30)];const ls=p.text.split("\n");const q=b%5===0?"this quote is nowhere in the document at all "+b:ls[Math.floor(rnd()*ls.length)];
    benefits.push({section:null,column:null,benefit:"Benefit "+b,pays:"words",value:null,percentOf:null,baseAmount:null,baseQuote:null,fromDay:null,maxDays:null,conditions:[],page:p.page,quote:q});}
  const covers=[{person:names[d%2],product:"Plan "+d,cover:"Cover "+d,plan:null,sumInsured:100000,asOf:null,page:1,quote:`${names[d%2]} S$100,000`}];
  pages[0].text=`${names[d%2]}\tS$100,000\n`+pages[0].text;
  const reading={document:{kind:"policy_wording",product:"Plan "+d,insurer:null,namedPeople:[],plan:null,periodFrom:null,periodTo:null},covers,benefits};
  docs.push({id:"d"+d,name:"Doc "+d+".pdf",readable:true,pages,people:names});
  stored.push({document:reading,pages:[1,2,3].map(n=>({page:n,json:reading}))});
}
let t=performance.now();const readings=docs.map((d,i)=>checkStored(d,stored[i]));const t1=performance.now()-t;
t=performance.now();const fam=names.map((n,i)=>({id:"p"+i,display_name:n,preferred_name:null}));assembleTable(readings,fam,[]);const t2=performance.now()-t;
console.log("checkStored ms",t1.toFixed(0),"assemble ms",t2.toFixed(0));
assert.ok(t1<5000,`checking the stored readings took ${t1.toFixed(0)} ms`);
// The same checks give the same rows when run again (cached pages), and a page whose text changed is searched afresh.
const again=docs.map((d,i)=>checkStored(d,stored[i]));
assert.deepEqual(again,readings);
const kept=readings[0].benefits.length;
assert.ok(kept>0&&readings[0].dropped.length>0);
const q=stored[0].document.benefits.find((b:any)=>!b.quote.startsWith("this quote")).quote;
for(const p of docs[0].pages)p.text=p.text.replace(q,"");
const edited=checkStored(docs[0],stored[0]);
assert.ok(edited.benefits.length<kept,"a quote removed from its page is no longer found");
console.log("benefit-table speed: ok");
