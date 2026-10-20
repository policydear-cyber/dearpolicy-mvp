import { chromium } from '/home/user/dearpolicy-mvp/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
await p.goto('http://localhost:3300/schedule',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(70000);
const t=await p.innerText('main'); const i=t.indexOf('by person →'); console.log('70s:', t.slice(i, i+380).replace(/\n/g,' | '));
await p.screenshot({path:'schedule-70s.png'});
await b.close();
