import { chromium } from '/home/user/dearpolicy-mvp/node_modules/playwright/index.mjs';
import fs from 'fs';
const pages = process.argv.slice(3); const vw = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: vw==='m' ? { width: 390, height: 844 } : { width: 1366, height: 900 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const errs=[]; p.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,200)); });
for (const u of pages) {
  errs.length=0; const t0=Date.now();
  let st; try { const r = await p.goto('http://localhost:3300'+u, { waitUntil: 'networkidle', timeout: 60000 }); st=r?.status(); } catch(e){ st='ERR '+e.message.slice(0,80); }
  const n = vw+u.replace(/[\/?=&]/g,'_');
  await p.screenshot({ path: n+'.png', fullPage: true });
  const sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth, document.title]);
  const txt = await p.innerText('body').catch(()=> '');
  fs.writeFileSync(n+'.txt', `url ${p.url()} status ${st} ms ${Date.now()-t0} sw ${sw}\nconsole errors: ${errs.join(' | ')}\n\n${txt}`);
  console.log(u, '->', p.url().replace('http://localhost:3300',''), st, Date.now()-t0+'ms', 'sw', sw.join('/'), 'errs', errs.length);
}
await b.close();
