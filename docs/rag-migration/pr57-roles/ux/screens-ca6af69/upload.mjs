import { chromium } from '/home/user/dearpolicy-mvp/node_modules/playwright/index.mjs';
const [,, file, tag, vw] = process.argv;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: vw==='m'?{ width: 390, height: 844 }:{ width: 1366, height: 900 } });
await p.goto('http://localhost:3300/policies',{waitUntil:'networkidle'});
await p.locator('input[type=file]').setInputFiles(file);
const up = p.getByRole('button',{name:/upload/i}).first();
console.log('upload enabled after choose:', await up.isEnabled());
const t0=Date.now(); await up.click();
for (const s of [0.5,2,5,15,40]) { await p.waitForTimeout(s*1000 - (Date.now()-t0) > 0 ? s*1000-(Date.now()-t0) : 0);
  await p.screenshot({path:`u-${tag}-${s}s.png`});
  const t = await p.innerText('main'); const i = t.indexOf('Upload & analyse'); console.log(`--- ${s}s\n`+t.slice(Math.max(0,i-100), i+900)); }
await b.close();
