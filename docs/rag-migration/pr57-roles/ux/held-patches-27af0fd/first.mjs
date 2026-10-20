import { chromium } from '/home/user/dearpolicy-mvp/node_modules/playwright/index.mjs';
const B='http://localhost:3300';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const states = {
  none: [],
  reading: [{id:'p1',original_filename:'SYNTHETIC-schedule.pdf',product_name:null,processing_status:'extracting'}],
  mixed: [{id:'p1',original_filename:'SYNTHETIC-cert.pdf',product_name:'Synthetic Shield Plan',processing_status:'completed'},{id:'p2',original_filename:'SYNTHETIC-photo.jpg',product_name:null,processing_status:'failed'}],
};
for (const vw of ['d','m']) for (const [k,pol] of Object.entries(states)) {
  const p = await b.newPage({ viewport: vw==='m'?{width:390,height:844}:{ width: 1366, height: 900 }, hasTouch: vw==='m' });
  await p.route('**/api/policies', r => r.request().method()==='GET' ? r.fulfill({json:{policies:pol}}) : r.continue());
  await p.route('**/api/chat/history?scope=all', r => r.fulfill({json:{conversations:[],items:[],nextCursor:null}}));
  await p.goto(B+'/chat',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(3500);
  const w = p.locator('[data-testid=chat-welcome]');
  console.log(`== ${vw} ${k}: welcome?`, await w.count(), '|', (await w.innerText().catch(()=>'')).replace(/\n/g,' | '));
  const ta = p.locator('textarea'); console.log('  textarea enabled', await ta.isEnabled(), 'history panel', await p.locator('details.chat-history').count(), 'disclaimer:', await p.locator('.chat-disclaimer').innerText().catch(()=>''));
  await p.screenshot({path:`first-${k}-${vw}.png`});
  await p.close();
}
// documents page, empty, phone
const p = await b.newPage({ viewport: {width:390,height:844}, hasTouch:true });
await p.route('**/api/policies', r => r.request().method()==='GET' ? r.fulfill({json:{policies:[]}}) : r.continue());
await p.goto(B+'/policies',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(3000);
const f = await p.locator('input[type=file]').boundingBox(); console.log('phone docs: file input box', f, 'accept', await p.locator('input[type=file]').getAttribute('accept'));
console.log((await p.innerText('main')).slice(0,700).replace(/\n/g,' | '));
await p.screenshot({path:'first-docs-empty-m.png'});
await b.close();
