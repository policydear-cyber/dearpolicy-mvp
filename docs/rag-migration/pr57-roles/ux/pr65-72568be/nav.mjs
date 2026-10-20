import { chromium } from '/home/user/dearpolicy-mvp/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
for (const w of [390, 360, 320]) {
  await p.setViewportSize({ width: w, height: 800 });
  await p.goto('http://localhost:3300/',{waitUntil:'networkidle'});
  const tabs = await p.locator('nav .nav-item:visible').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return `${e.innerText.trim()}[${Math.round(r.x)},${Math.round(r.width)}x${Math.round(r.height)}]`;}));
  console.log(w, 'tabs:', tabs.join(' '), 'sw', await p.evaluate(()=>document.documentElement.scrollWidth));
  await p.screenshot({path:`nav-${w}.png`});
}
await p.setViewportSize({ width: 390, height: 844 });
await p.locator('button.nav-more-toggle').click(); await p.waitForTimeout(400);
await p.screenshot({path:'more-open.png'});
console.log('more sheet:', (await p.locator('#nav-more-sheet').innerText()).replace(/\n/g,' | '));
await p.keyboard.press('Escape'); await p.waitForTimeout(300); console.log('after Esc open?', await p.locator('#nav-more-sheet').count());
await p.locator('button.nav-more-toggle').click(); await p.locator('#nav-more-sheet a',{hasText:'Family'}).click(); await p.waitForURL('**/family'); await p.waitForTimeout(800);
console.log('on family; More active?', await p.locator('button.nav-more-toggle').getAttribute('class'));
await p.screenshot({path:'more-active-family.png'});
// focus check: is first menu item focused when opened?
await p.locator('button.nav-more-toggle').click(); await p.waitForTimeout(300);
console.log('focus after open:', await p.evaluate(()=>document.activeElement?.className+' '+document.activeElement?.innerText));
await p.mouse.click(200,200); await p.waitForTimeout(300); console.log('after backdrop tap open?', await p.locator('#nav-more-sheet').count());
// chat on mobile
await p.goto('http://localhost:3300/chat',{waitUntil:'networkidle'});
const ta = p.locator('textarea'); const bx = await ta.boundingBox(); console.log('mobile textarea box', bx);
await p.screenshot({path:'chat-mobile.png'});
await ta.fill('line one'); await ta.press('Enter'); await p.waitForTimeout(800);
console.log('mobile Enter -> value', JSON.stringify(await ta.inputValue()));
const comp = await p.locator('form.chat-composer').boundingBox(); const nav = await p.locator('nav.nav').boundingBox(); console.log('composer', comp, 'nav', nav);
await ta.fill('a much longer message '.repeat(20)); await p.waitForTimeout(300); console.log('grown textarea h', (await ta.boundingBox()).height);
await p.screenshot({path:'chat-mobile-long.png'});
await b.close();
