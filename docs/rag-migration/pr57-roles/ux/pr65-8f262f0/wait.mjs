import { chromium } from '/home/user/dearpolicy-mvp/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
for (const u of ['/schedule','/ledger']) {
  await p.goto('http://localhost:3300'+u,{waitUntil:'domcontentloaded'});
  for (const s of [5,30]) { await p.waitForTimeout(s===5?5000:25000); const t=await p.innerText('main'); const i=t.indexOf('Coverage, by person')>0?t.indexOf('by person →'):t.indexOf('by policy →'); console.log(u, s+'s:', t.slice(i, i+380).replace(/\n/g,' | ')); }
  await p.screenshot({path:'w'+u.replace('/','_')+'.png'});
  const tb = p.getByRole('button',{name:/try again/i}); if (await tb.count()) { await tb.first().click(); await p.waitForTimeout(6000); const t=await p.innerText('main'); console.log(u,'after Try again:', t.slice(t.indexOf('→'), t.indexOf('→')+300).replace(/\n/g,' | ')); await p.screenshot({path:'w'+u.replace('/','_')+'-retry.png'}); }
}
await b.close();
