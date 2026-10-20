import { chromium } from '/home/user/dearpolicy-mvp/node_modules/playwright/index.mjs';
const [,,vw]=process.argv; const B='http://localhost:3300';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: vw==='m'?{width:390,height:844}:{ width: 1366, height: 900 }, hasTouch: vw==='m' });
const net=[]; p.on('response', async r=>{ const m=r.request().method(); if(m!=='GET'){ let body=''; try{body=(await r.text()).slice(0,160);}catch{} net.push(m+' '+r.url().replace(B,'').replace(/[0-9a-f-]{36}/g,'<id>')+' '+r.status()+' '+body);} });
await p.goto(B+'/family',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(4000);
const cardSel = '.profile-card, [data-testid=profile-card], .family-card, .profile';
const cards = p.locator(cardSel);
console.log('cards', await cards.count());
for (const t of await cards.allInnerTexts()) console.log('--- CARD:', t.replace(/\n+/g,' | ').slice(0,500));
await p.screenshot({path:`fam-${vw}-0.png`, fullPage:true});
// delete Grace (linked)
const grace = cards.filter({hasText:/Grace/}).first();
await grace.getByRole('button',{name:/^Delete/}).click(); await p.waitForTimeout(600);
console.log('GRACE WARNING:', (await grace.innerText()).replace(/\n+/g,' | ').slice(-450));
const confirmBtn = grace.getByRole('button',{name:/Confirm delete/}); console.log('confirm button offered for linked person:', await confirmBtn.count());
if (await confirmBtn.count()) { await confirmBtn.click(); await p.waitForTimeout(2500); console.log('GRACE AFTER CONFIRM:', (await grace.innerText()).replace(/\n+/g,' | ').slice(-350)); }
await grace.screenshot({path:`fam-${vw}-grace.png`});
// add an unlinked synthetic person, then delete
await p.getByLabel(/Full name/).first().fill('SYNTHETIC Test Child');
const rel = p.getByLabel(/Relationship/).first(); const opts = await rel.locator('option').allInnerTexts(); console.log('relationship options', opts);
await rel.selectOption({index: Math.min(3, opts.length-1)});
await p.getByRole('button',{name:/add person/i}).click(); await p.waitForTimeout(3000);
const kid = p.locator(cardSel).filter({hasText:/SYNTHETIC Test Child/}).first();
console.log('KID CARD:', (await kid.innerText()).replace(/\n+/g,' | ').slice(0,300));
await kid.getByRole('button',{name:/^Delete/}).click(); await p.waitForTimeout(600);
console.log('KID WARNING:', (await kid.innerText()).replace(/\n+/g,' | ').slice(-300));
await kid.screenshot({path:`fam-${vw}-kid-warn.png`});
await kid.getByRole('button',{name:/Confirm delete/}).click(); await p.waitForTimeout(3000);
console.log('kid still present:', await p.locator(cardSel).filter({hasText:/SYNTHETIC Test Child/}).count(), '| page notice:', (await p.innerText('main')).match(/[^\n]*(removed|deleted)[^\n]*/i)?.[0]);
console.log('net:', net.join('\n  '));
await b.close();
