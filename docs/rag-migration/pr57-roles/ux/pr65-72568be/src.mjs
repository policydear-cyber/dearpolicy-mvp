import { chromium } from '/home/user/dearpolicy-mvp/node_modules/playwright/index.mjs';
const [,, vw] = process.argv;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: vw==='m'?{ width: 390, height: 844 }:{ width: 1366, height: 900 }, hasTouch: vw==='m' });
await p.goto('http://localhost:3300/chat',{waitUntil:'networkidle'});
// open the previous chat
const prev = p.locator('summary,button',{hasText:/Previous chats/}).first(); await prev.click(); await p.waitForTimeout(800);
await p.locator('text=grace fell down').first().click(); await p.waitForTimeout(3000);
const lead = p.locator('.answer-lead').last(); console.log('lead weight', await lead.evaluate(e=>getComputedStyle(e).fontWeight), 'lead text:', (await lead.innerText()).slice(0,200));
await p.locator('summary',{hasText:/^Sources$/i}).last().click(); await p.waitForTimeout(500);
const rows = p.locator('details.source-doc > summary'); const n = await rows.count(); console.log('rows', n);
for (let i=0;i<n;i++){ await rows.nth(i).click(); await p.waitForTimeout(300); }
const list = p.locator('.source-list').last(); await list.scrollIntoViewIfNeeded();
await p.screenshot({path:`sources-${vw}.png`});
console.log((await list.innerText()).slice(0,2500));
// summary tap target height
console.log('row heights', await rows.evaluateAll(es=>es.map(e=>Math.round(e.getBoundingClientRect().height))));
await p.locator('a.source-open').nth(1).click(); await p.waitForTimeout(4000);
console.log('url', p.url());
const f = await p.locator('.document-card.focused').count(); console.log('focused cards', f);
await p.screenshot({path:`open-in-docs-${vw}.png`});
await b.close();
