import { chromium } from '/home/user/dearpolicy-mvp/node_modules/playwright/index.mjs';
const [,,vw,delay='75000']=process.argv;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: vw==='m'?{width:390,height:844}:{ width: 1366, height: 900 }, hasTouch: vw==='m' });
let posts=0; const t0={v:0};
await p.route('**/api/chat', r => { if (r.request().method()==='POST') posts++; return r.continue(); });
await p.route('**/api/chat/jobs/**', async r => { const left = Number(delay) - (Date.now()-t0.v); if (left>0) await new Promise(s=>setTimeout(s, left)); return r.continue().catch(()=>{}); });
await p.goto('http://localhost:3300/chat',{waitUntil:'networkidle'});
const nc = p.getByRole('button',{name:/new chat/i}); if (await nc.count()) { await nc.first().click(); await p.waitForTimeout(800); }
const ta = p.locator('textarea');
await ta.fill('does grace have dental cover?'); t0.v=Date.now();
await (vw==='m' ? p.getByRole('button',{name:/send/i}).click() : ta.press('Enter'));
await p.waitForTimeout(1500);
// double-send attempts
await ta.fill('does grace have dental cover?');
if (vw!=='m') await ta.press('Enter'); await p.getByRole('button',{name:/send/i}).click({force:true}).catch(e=>console.log('send click blocked:', e.message.slice(0,60)));
await p.waitForTimeout(500);
console.log('POST /api/chat count after double-send attempts:', posts, '| send disabled:', await p.getByRole('button',{name:/send/i}).isDisabled(), '| hint:', await p.locator('.chat-wait-hint').innerText().catch(()=>'none'));
for (const s of [3,15,30,65,90]) {
  const wait = s*1000 - (Date.now()-t0.v); if (wait>0) await p.waitForTimeout(wait);
  const w = p.locator('.answer-wait, .thinking, [class*=wait]').first();
  const txt = (await p.locator('.chat-thread, main').first().innerText()).split('\n').slice(-14).join(' | ');
  console.log(`--- ${s}s: ${txt.slice(-600)}`);
  await p.screenshot({path:`wait-${vw}-${s}s.png`});
}
console.log('final POST count', posts);
await b.close();
