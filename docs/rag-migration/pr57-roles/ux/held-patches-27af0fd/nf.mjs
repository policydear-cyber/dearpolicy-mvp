import { chromium } from '/home/user/dearpolicy-mvp/node_modules/playwright/index.mjs';
const [,,vw]=process.argv; const B='http://localhost:3300';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: vw==='m'?{width:390,height:844}:{ width: 1366, height: 900 }, hasTouch: vw==='m' });
const p = await ctx.newPage();
const net=[]; p.on('response', r=>{ const m=r.request().method(); if(m!=='GET') net.push(m+' '+r.url().replace(B,'')+' '+r.status()); });
await p.route('**/api/ledger*', r => r.request().method()!=='GET' ? r.continue() : r.fulfill({json:{rows:[
  {id:'x1',policyId:'7d000000-0000-4000-8000-000000000103',eventLabel:'Accidental death',status:'confirmed'},
  {id:'x2',policyId:'7d000000-0000-4000-8000-000000000103',eventLabel:'Other Fracture',status:'confirmed'},
  {id:'x3',policyId:'7d000000-0000-4000-8000-000000000103',eventLabel:'Hospital cash',status:'confirmed'}],family:[],reading:{pending:0,inProgress:false}}}));
await p.route('**/api/policies', async r => { if (r.request().method()!=='GET') return r.continue();
  const res = await r.fetch(); const j = await res.json(); const pol = j.policies.find(x=>x.id.endsWith('101'));
  if (pol) pol.detected_people = [...(pol.detected_people??[]), {name:'SYNTHETIC Uncle Ah Kow', matchedFamilyMemberId:null}];
  return r.fulfill({response:res, json:j}); });
const go = async()=>{ await p.goto(B+'/policies',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(4500); };
await go();
const card = p.locator('.document-card').first();
const sel = card.locator('select').first();
console.log('options:', await sel.locator('option').allInnerTexts());
console.log('found line:', await p.locator('[data-testid=document-found]').first().innerText().catch(()=>'none'));
console.log('status badges:', (await p.locator('.document-title .status').allInnerTexts()).join(', '));
const nf = (await sel.locator('option').allInnerTexts()).find(o=>/not in my family|someone else/i.test(o));
await sel.selectOption({label: nf}); await p.waitForTimeout(1500);
console.log('after choose:', (await card.innerText()).replace(/\n+/g,' | ').slice(0,600));
await card.screenshot({path:`nf-${vw}.png`});
await go(); console.log('after reload, question shown?', await p.locator('.document-card').first().locator('select').count(), '|', (await p.locator('.document-card').first().innerText()).replace(/\n+/g,' | ').slice(0,400));
console.log('non-GET:', net.join(' ; '));
await b.close();
