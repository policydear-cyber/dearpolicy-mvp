import { chromium } from '/home/user/dearpolicy-mvp/node_modules/playwright/index.mjs';
const B='http://localhost:3300';
const fam=[{id:'f1',display_name:'SYN Daniel',relationship:'self'},{id:'f2',display_name:'SYN Grace',relationship:'spouse'},{id:'f3',display_name:'SYN Kid',relationship:'child'}];
const row=(o)=>({id:o.id,familyMemberId:o.fm,ownerName:o.owner,policyId:o.pol??'pA',planName:o.plan??'Synthetic Group PA',insurer:'Synthetic Life',eventType:o.ev,eventLabel:o.label,detail:o.detail??null,cause:o.cause??null,paysKind:'amount',amount:o.amount??null,currency:'SGD',conditions:o.cond??[],sourcePage:o.page??8,quote:o.quote??'SYNTHETIC quote',origin:'schedule',status:'confirmed',pays:o.pays,hasFigure:!!o.amount,alternatives:o.alt??null});
const alt={groupId:'g1',note:'There is more than one way your cover works this out. They are never added together; the insurer decides which applies.',options:[
 {rowId:'r2',amountText:'S$1,250',basis:'25% of the S$5,000 fracture limit',documentName:'Product Summary',policyId:'pB',page:13,conditions:['Thumb, finger and palm not covered']},
 {rowId:'r3',amountText:'S$120,000',basis:'20% of the S$600,000 accident cover',documentName:'Benefit Summary',policyId:'pA',page:8,asOf:'2022-10-06',conditions:['Core or Voluntary scheme, not both']}]};
const rows=[
 row({id:'r1',fm:'f1',owner:'SYN Daniel',ev:'death',label:'Death',amount:1000000,pays:'S$1,000,000',plan:'Synthetic Term Life'}),
 row({id:'r2',fm:'f2',owner:'SYN Grace',ev:'fracture',label:'Simple Fracture · wrist',cause:'accident',amount:1250,pays:'S$1,250',plan:'Synthetic Product Summary',pol:'pB',alt}),
 row({id:'r3',fm:'f2',owner:'SYN Grace',ev:'fracture',label:'Other Fracture · wrist',cause:'accident',amount:120000,pays:'S$120,000',alt}),
 row({id:'r4',fm:'f2',owner:'SYN Grace',ev:'accidental_death',label:'Accidental death',cause:'accident',amount:600000,pays:'S$600,000'}),
];
const states={
 done:{rows,family:fam,reading:{pending:0,inProgress:false}},
 reading:{rows,family:fam,reading:{pending:1,inProgress:true,documents:[{policyId:'pC',name:'SYNTHETIC-schedule.pdf',state:'reading'}]}},
 stuck:{rows,family:fam,reading:{pending:1,inProgress:false,documents:[{policyId:'pC',name:'SYNTHETIC-photo.jpg',state:'failed',reason:'The photo is too blurred to read.',attempts:3}]}},
};
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const vw of ['d','m']) for (const [k,payload] of Object.entries(states)) {
  const p = await b.newPage({ viewport: vw==='m'?{width:390,height:844}:{ width: 1366, height: 900 }, hasTouch: vw==='m' });
  await p.route('**/api/ledger*', r => r.request().method()==='GET' ? r.fulfill({json:payload}) : r.fulfill({json:{ok:true}}));
  await p.goto(B+'/ledger',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(4000);
  const t = await p.innerText('main'); const i = t.indexOf('Person');
  console.log(`== ${vw} ${k}:\n`+t.slice(t.indexOf('by policy')+12, t.length).slice(0,2200).replace(/\n+/g,' | '));
  console.log('  either/or blocks:', await p.locator('.alternative-amounts, [class*=either], [data-testid*=alternative]').count(), '| S$120,000 occurrences:', (t.match(/S\$120,000/g)||[]).length, '| S$1,250:', (t.match(/S\$1,250/g)||[]).length);
  await p.screenshot({path:`cov-${k}-${vw}.png`, fullPage:true});
  await p.close();
}
await b.close();
