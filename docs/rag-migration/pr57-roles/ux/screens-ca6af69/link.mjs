import { chromium } from '/home/user/dearpolicy-mvp/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
await p.goto('http://localhost:3300/policies',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(4000);
const sel = p.locator('select').filter({hasText:'Employee'}).first();
await sel.scrollIntoViewIfNeeded(); await p.screenshot({path:'link-0.png'});
await sel.selectOption({label:'Employee'}); await p.waitForTimeout(3000); await p.screenshot({path:'link-1.png'});
const t=await p.innerText('main'); const i=t.indexOf('Scheme X Group Insurance\nAldermoor Life Ltd · Certificate'); console.log('AFTER SELECT:\n'+t.slice(i,i+900));
// toggle person off
const tog = p.getByRole('button',{name:/Tan Hui Min Grace ✓/}).first();
console.log('toggle aria-pressed:', await tog.getAttribute('aria-pressed'));
await tog.click(); await p.waitForTimeout(3000); await p.screenshot({path:'link-2.png'});
const t2=await p.innerText('main'); const j=t2.indexOf('Scheme X Group Insurance\nAldermoor Life Ltd · Certificate'); console.log('AFTER TOGGLE:\n'+t2.slice(j,j+900));
// details
await p.getByRole('button',{name:'Details'}).first().click().catch(async()=>{await p.getByRole('link',{name:'Details'}).first().click();});
await p.waitForTimeout(3000); await p.screenshot({path:'details.png', fullPage:true}); console.log('DETAILS url', p.url(), '\n', (await p.innerText('main')).slice(0,1500));
await b.close();
