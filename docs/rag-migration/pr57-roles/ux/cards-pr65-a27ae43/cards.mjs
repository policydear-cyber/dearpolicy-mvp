import { chromium } from '/home/user/dearpolicy-mvp/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,,vw]=process.argv;
const fx = JSON.parse(fs.readFileSync('/tmp/claude-0/c6/scripts/fixtures/ux/answer-cards-fr1.json','utf8'));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: vw==='m'?{width:390,height:844}:{ width: 1366, height: 900 }, hasTouch: vw==='m' });
await p.route('**/api/chat/history/*', async route => {
  const r = await route.fetch(); const j = await r.json();
  const msgs = j.messages ?? []; const a = [...msgs].reverse().find(m=>m.role==='assistant');
  if (a && a.answer_json) { const aj = typeof a.answer_json==='string'?JSON.parse(a.answer_json):a.answer_json; aj.bottomLine = fx.bottomLine; aj.statements = fx.statements; a.answer_json = typeof a.answer_json==='string'?JSON.stringify(aj):aj; a.answer=aj; console.log('injected; keys', Object.keys(j).join(','), 'mode', aj.mode); } else console.log('no assistant answer; keys', Object.keys(j));
  await route.fulfill({ response: r, json: j });
});
await p.goto('http://localhost:3300/chat',{waitUntil:'networkidle'});
const item = p.locator('text=grace fell down').first();
if (!(await item.isVisible())) await p.locator('summary,button',{hasText:/Previous chats/}).first().click();
await item.click(); await p.waitForTimeout(3000);
const msg = p.locator('.message.assistant').last();
await msg.scrollIntoViewIfNeeded(); await msg.evaluate(e=>e.scrollIntoView({block:'start'}));
await p.screenshot({path:`cards-${vw}-1.png`});
const box = await msg.boundingBox(); console.log('answer height px', Math.round(box.height), 'viewport', vw);
console.log('VISIBLE TEXT:\n'+await msg.innerText());
const sums = await msg.locator('summary').allInnerTexts(); console.log('summaries:', sums);
const w = msg.locator('summary',{hasText:/where this comes from/i});
console.log('where-from summary box', await w.boundingBox().catch(()=>null));
if (await w.count()) { await w.first().click(); await p.waitForTimeout(500); const b2=await msg.boundingBox(); console.log('expanded height', Math.round(b2.height));
  console.log('EXPANDED:\n'+(await w.first().locator('xpath=..').innerText()).slice(0,2500));
  await w.first().scrollIntoViewIfNeeded(); await p.screenshot({path:`cards-${vw}-where.png`}); }
await msg.screenshot({path:`cards-${vw}-full.png`});
await b.close();
