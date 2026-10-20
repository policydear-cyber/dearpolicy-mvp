import { chromium } from '/home/user/dearpolicy-mvp/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
const B='http://localhost:3300';
async function shot(n){ await p.screenshot({path:n+'.png'}); }
// signup: empty submit, bad email, short pw
await p.goto(B+'/signup',{waitUntil:'networkidle'});
const btn = p.getByRole('button',{name:/create household/i});
console.log('signup button disabled when empty:', await btn.isDisabled());
await p.getByLabel('Email').fill('not-an-email'); await p.getByLabel('Password').fill('abc');
console.log('disabled bad input:', await btn.isDisabled());
await btn.click({force:true}).catch(e=>console.log('click err',e.message.slice(0,60))); await p.waitForTimeout(2500); await shot('f-signup-bad');
console.log('SIGNUP BAD:', (await p.innerText('main')).slice(0,600));
await p.getByLabel('Email').fill('synthetic-ux@example.test'); await p.getByLabel('Password').fill('abcdefgh1');
await btn.click(); await p.waitForTimeout(4000); await shot('f-signup-good');
console.log('SIGNUP GOOD url', p.url(), (await p.innerText('body')).slice(0,700));
// login wrong
await p.goto(B+'/login',{waitUntil:'networkidle'});
await p.getByLabel('Email').fill('synthetic-ux@example.test'); await p.getByLabel('Password').fill('wrongpass1');
await p.getByRole('button',{name:/sign in/i}).click(); await p.waitForTimeout(4000); await shot('f-login-wrong');
console.log('LOGIN WRONG url', p.url(), (await p.innerText('main').catch(()=>p.innerText('body'))).slice(0,600));
// reset
await p.goto(B+'/reset-password',{waitUntil:'networkidle'});
await p.getByLabel('Email').fill('synthetic-ux@example.test'); await p.getByRole('button',{name:/send reset/i}).click(); await p.waitForTimeout(3000); await shot('f-reset');
console.log('RESET', (await p.innerText('main').catch(()=>p.innerText('body'))).slice(0,500));
await b.close();
