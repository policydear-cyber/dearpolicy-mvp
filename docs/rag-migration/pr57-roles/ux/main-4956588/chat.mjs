// usage: node chat.mjs <name> <d|m> [scenario|-] msg1 msg2 ... ; '@reload' reloads the page; '@open' opens /chat fresh and clicks latest previous chat
import { chromium } from '/home/user/dearpolicy-mvp/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const [,, name, vw, scenario, ...msgs] = process.argv;
const B = 'http://localhost:3300';
if (scenario && scenario !== '-') {
  const r = await fetch(B + '/__rag2stress/scenario', { method: 'POST', body: JSON.stringify({ id: scenario }) });
  console.log('scenario', scenario, r.status, (await r.text()).slice(0, 600));
}
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: vw === 'm' ? { width: 390, height: 844 } : { width: 1366, height: 900 } });
await p.goto(B + '/chat', { waitUntil: 'networkidle' });
const log = [];
let i = 0;
const main = async () => (await p.innerText('main').catch(() => p.innerText('body')));
for (const m of msgs) {
  i++;
  if (m === '@sources') {
    const sums = p.locator('summary', { hasText: /sources/i });
    const n = await sums.count();
    if (n) { await sums.nth(n-1).click(); await p.waitForTimeout(800); }
    const det = p.locator('details', { has: p.locator('summary', { hasText: /sources/i }) }).last();
    log.push(`\n===== sources (${n}) =====\n` + (n ? await det.innerText() : 'none'));
    const links = n ? await det.locator('a,button').evaluateAll(es => es.map(e => (e.innerText||'').trim().slice(0,80) + ' -> ' + (e.getAttribute('href')||'(button)'))) : [];
    log.push('links: ' + links.join(' | '));
    await p.screenshot({ path: `${name}-sources.png`, fullPage: false });
    if (n) await det.scrollIntoViewIfNeeded().catch(()=>{});
    await p.screenshot({ path: `${name}-sources2.png`, fullPage: false });
    continue;
  }
  if (m.startsWith('@click:')) { const t0=Date.now(); const label=m.slice(7); const el=p.locator('details').last().locator('a,button', { hasText: label }).first(); const [np] = await Promise.all([p.context().waitForEvent('page',{timeout:5000}).catch(()=>null), el.click()]); await p.waitForTimeout(2500); const tgt = np || p; log.push(`\n===== clicked ${label} -> ${tgt.url()} (new tab: ${!!np}) =====\n` + (await tgt.innerText('body')).slice(0,3000)); await tgt.screenshot({ path: `${name}-cite.png` }); if (!np) { await p.goBack({waitUntil:'networkidle'}).catch(()=>{}); await p.waitForTimeout(1500); log.push('after back: ' + p.url() + '\n' + (await main()).slice(-600)); } continue; }
  if (m === '@reload') { await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1500); log.push(`\n===== after reload =====\n${await main()}`); await p.screenshot({ path: `${name}-reload.png`, fullPage: true }); continue; }
  const before = await main();
  const ta = p.locator('textarea').first();
  await ta.fill(m);
  const respP = p.waitForResponse(r => r.url().includes('/api/chat') && r.request().method() === 'POST', { timeout: 180000 }).catch(() => null);
  const t0 = Date.now();
  await p.getByRole('button', { name: /Send/ }).click();
  let first = null;
  for (let k = 0; k < 200; k++) { if ((await main()) !== before) { first = Date.now() - t0; break; } await p.waitForTimeout(50); }
  const resp = await respP;
  if (resp) { try { await resp.finished(); } catch {} }
  const status = resp ? resp.status() : 'none';
  // wait for UI to settle: text stable for 1.5s
  let last = await main(), stable = 0;
  for (let k = 0; k < 400 && stable < 1500; k++) { await p.waitForTimeout(250); const n = await main(); if (n === last) stable += 250; else { stable = 0; last = n; } }
  const done = Date.now() - t0 - 1500;
  await p.screenshot({ path: `${name}-t${i}.png`, fullPage: true });
  log.push(`\n===== USER (${i}): ${m}\n[status ${status}; first feedback ${first}ms; settled ~${done}ms]\n`);
  log.push(last);
}
fs.writeFileSync(`${name}.txt`, log.join('\n'));
console.log(log.join('\n').slice(-12000));
await b.close();
