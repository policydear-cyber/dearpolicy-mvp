import { chromium } from '/home/user/dearpolicy-mvp/node_modules/playwright/index.mjs';
const [,,vw]=process.argv; const B='http://localhost:3300';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: vw==='m'?{width:390,height:844}:{ width: 1366, height: 900 }, hasTouch: vw==='m' });
const net=[]; p.on('response', r=>{ const m=r.request().method(); if(m!=='GET') net.push(m+' '+r.url().replace(B,'').replace(/[0-9a-f-]{36}/g,'<id>')+' '+r.status()); });
await p.goto(B+'/family',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(4000);
const cards = p.locator('.profile-card, [data-testid=profile-card], .family-card, .profile');
for (const t of await cards.allInnerTexts()) console.log('--- CARD:', t.replace(/\n+/g,' | ').slice(0,400));
const g = cards.filter({hasText:/Grace/}).first();
console.log('links in card:', await g.locator('a').evaluateAll(es=>es.map(e=>e.innerText.trim()+' -> '+e.getAttribute('href'))));
const del = g.getByRole('button',{name:/delete|remove/i}).first(); console.log('remove button:', await del.innerText()); await del.click(); await p.waitForTimeout(700);
console.log('AFTER REMOVE CLICK:', (await g.innerText()).replace(/\n+/g,' | ').slice(-400));
console.log('buttons now:', await g.locator('button,a').allInnerTexts());
await g.screenshot({path:`fam2-${vw}-remove.png`});
const edit = g.getByRole('button',{name:/edit/i}); if (await edit.count()) { await edit.first().click(); await p.waitForTimeout(500); const dob = g.locator('input[type=date], input[name*=birth], input[id*=birth]').first(); console.log('dob field:', await dob.getAttribute('type'), await dob.inputValue().catch(()=>''), '| visible text:', (await g.innerText()).replace(/\n+/g,' | ').slice(0,300)); await g.screenshot({path:`fam2-${vw}-edit.png`}); }
console.log('non-GET:', net.join(' ; '));
await b.close();
