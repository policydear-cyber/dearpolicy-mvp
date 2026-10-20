import { chromium } from '/home/user/dearpolicy-mvp/node_modules/playwright/index.mjs';
const [,,vw]=process.argv;
const B='http://localhost:3300';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: vw==='m'?{width:390,height:844}:{ width: 1366, height: 900 }, hasTouch: vw==='m' });
const posts=[]; p.on('response', r=>{ const m=r.request().method(); if(m!=='GET') posts.push(m+' '+r.url().replace(B,'')+' '+r.status()); });
await p.route('**/api/ledger*', async r => { if (r.request().method()!=='GET') return r.continue();
  return r.fulfill({json:{rows:[
    {id:'x1',policyId:'7d000000-0000-4000-8000-000000000103',eventLabel:'Accidental death',status:'confirmed'},
    {id:'x2',policyId:'7d000000-0000-4000-8000-000000000103',eventLabel:'Other Fracture',status:'confirmed'},
    {id:'x3',policyId:'7d000000-0000-4000-8000-000000000103',eventLabel:'Hospital cash',status:'confirmed'},
    {id:'x4',policyId:'7d000000-0000-4000-8000-000000000103',eventLabel:'Dismemberment',status:'confirmed'}],
    family:[], reading:{pending:1,inProgress:false,documents:[{policyId:'7d000000-0000-4000-8000-000000000102',name:'Product Summary.pdf',state:'failed',reason:'A table could not be read.'}]}}}); });
await p.route('**/api/policies', async r => { if (r.request().method()!=='GET') return r.continue();
  const res = await r.fetch(); const j = await res.json();
  const pol = j.policies.find(x=>x.id.endsWith('101')); if (pol) pol.detected_people = [...(pol.detected_people??[]), {name:'SYNTHETIC Uncle Ah Kow', matchedFamilyMemberId:null}];
  return r.fulfill({response:res, json:j}); });
await p.goto(B+'/policies',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(4500);
const cards = p.locator('.document-card');
console.log('cards', await cards.count());
for (const t of await cards.allInnerTexts()) console.log('--- CARD:\n'+t.replace(/\n+/g,' | ').slice(0,700));
await p.locator('.document-card').first().scrollIntoViewIfNeeded(); await p.screenshot({path:`docs-${vw}.png`, fullPage:true});
await b.close();
console.log('non-GET:', posts.join(' ; '));
