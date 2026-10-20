import { chromium } from '/home/user/dearpolicy-mvp/node_modules/playwright/index.mjs';
const [,, vw] = process.argv;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: vw==='m'?{ width: 390, height: 844 }:{ width: 1366, height: 900 } });
const net=[]; p.on('response', r=>{ if(r.request().method()==='POST') net.push(r.url().replace('http://localhost:3300','')+' '+r.status()); });
await p.goto('http://localhost:3300/policies',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(4000);
const card = p.locator('[data-testid=document-unreadable]').first();
console.log('unreadable cards', await p.locator('[data-testid=document-unreadable]').count());
const doc = p.locator('.document-card',{has: card}).first(); await doc.scrollIntoViewIfNeeded();
console.log('CARD BEFORE:\n'+await doc.innerText());
await doc.screenshot({path:`retry-before-${vw}.png`});
await card.getByRole('button',{name:/try reading it again/i}).click();
for (const s of [1,5,20]) { await p.waitForTimeout(s===1?1000:(s===5?4000:15000));
  const notice = await p.locator('main').innerText(); const i = notice.indexOf('Your insurance library');
  console.log(`--- ${s}s notice area:\n`+notice.slice(i, i+400));
  await p.screenshot({path:`retry-${s}s-${vw}.png`}); }
console.log('POSTs', net.join(' | '));
const cards = await p.locator('.document-card').allInnerTexts(); console.log('CARDS AFTER:\n'+cards.map(c=>c.slice(0,300)).join('\n----\n'));
await b.close();
