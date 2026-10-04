/**
 * Round 8 live render check (manual; not in CI): one fixture household is
 * built with the real ingestion pipeline (scripts/r6/fixture.ts or
 * scripts/r7/fixture.ts, PGlite, deterministic model stand-in), and the REAL
 * chat page -- served by a running `next dev` with DEV_AUTH_ENABLED -- is
 * driven in Chromium. Every /api/chat, /api/family and /api/chat/history call
 * the page makes is answered live by the app's own route handlers over that
 * household; the background-job hop is the only shortcut (the chat route is
 * called synchronously and the page's job poll gets that answer).
 *
 * Conversations are typed, and claim interviews are answered by tapping the
 * first choice chip or filling the inline date/text box, as a person would.
 * After every answer the page is checked at 375x812 and again at 1280x800
 * with e2e/support/r8-render-checks.ts, the newest answer must start on
 * screen, and console errors are collected.
 *
 *   E2E_CHROMIUM_PATH=/usr/bin/chromium E2E_R8_BASE_URL=http://localhost:3200 \
 *     node --import tsx scripts/r8/live-render.ts r6|r7 [report.jsonl] [shots-dir]
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { chromium, type Page } from "@playwright/test";
import type { ChatAnswer } from "@/types";
import { collectRenderIssues } from "../../e2e/support/r8-render-checks";

process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
process.env.E2E_RUN_ID = "r8live";
process.env.DEV_AUTH_ENABLED = "1";
process.env.MODEL_PRESET = process.env.MODEL_PRESET || "openai";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-not-used";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "ci";
delete process.env.PINECONE_API_KEY; delete process.env.SUPABASE_URL;

type Turn = string;
const CONVERSATIONS: Record<string, { name: string; turns: Turn[]; follow?: number }[]> = {
  r6: [
    { name: "portfolio", turns: ["What policies does my family have?", "Who in the family has hospital cover?", "Compare Mei Ling and Wei Jie's hospital cover"] },
    { name: "money", turns: ["Total premiums we pay a year?", "How much premium does Mei Ling pay every year?", "Which of our policies renew in the next 60 days?"] },
    { name: "travel-group", turns: ["What travel cover do we have?", "What does Mei Ling's company group insurance give?", "What is the total death benefit for the family?"] },
    { name: "small-talk", turns: ["hi", "thanks", "is there any government help?", "我的保险包括什么？", "Apa perlindungan insurans saya?"] },
    { name: "injury-claim", turns: ["Xin Yi broke her arm at school yesterday"], follow: 6 },
    { name: "death-claim", turns: ["wei jie died yesterday. car accident. what do i do"], follow: 6 },
    { name: "unknown-person", turns: ["my colleague Ravi died last week, can I claim his insurance?"], follow: 1 },
  ],
  r7: [
    { name: "portfolio", turns: ["Tell me everything I'm insured for", "Who in the family has no insurance at all?", "who has hospital cover?"] },
    { name: "status", turns: ["Is Aisyah's HerCare policy still in force?", "Am I still covered by AssureTerm 65?", "If we surrender Irfan's endowment now how much do we get?", "What's my excess for a car accident claim?"] },
    { name: "languages", turns: ["Apa perlindungan ElderShield emak saya?", "我儿子的储蓄计划到期多少钱？", "Should I surrender my policy to pay off my loan?"] },
    { name: "surgery-claim", turns: ["my knee surgery is next week at Raffles Hospital, can claim?"], follow: 6 },
    { name: "death-claim", turns: ["my mother Aminah passed away at home yesterday"], follow: 6 },
  ],
};

async function main() {
  const which = (process.argv[2] ?? "r7") as "r6" | "r7";
  const report = path.resolve(process.argv[3] ?? `r8-live-${which}.jsonl`);
  const shots = process.argv[4] ? path.resolve(process.argv[4]) : null;
  writeFileSync(report, "");
  const quiet = console.log; console.info = () => undefined; console.debug = () => undefined; console.warn = () => undefined;
  console.log = (...a: unknown[]) => { if (typeof a[0] === "string" && /^(?:\{"|\[telemetry\]|SQL note)/.test(a[0])) return; quiet(...a); };

  const F = which === "r6" ? await import("../r6/fixture") : await import("../r7/fixture");
  const started = Date.now();
  await F.buildHousehold();
  quiet(`${which} household built in ${Date.now() - started} ms`);
  process.env.DEV_ACCOUNT_ID = F.ACCOUNT;
  const chat = await import("@/app/api/chat/route");
  const family = await import("@/app/api/family/route");
  const history = await import("@/app/api/chat/history/route");
  const historyOne = await import("@/app/api/chat/history/[id]/route");

  const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM_PATH || undefined, args: ["--disable-dev-shm-usage"] });
  const context = await browser.newContext({ baseURL: process.env.E2E_R8_BASE_URL ?? "http://localhost:3200", viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  // tsx keeps function names with a __name() helper; the checks run in the page, so it needs one too.
  await page.addInitScript("globalThis.__name = globalThis.__name || ((f) => f);");
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 300)));
  let pending: ChatAnswer | null = null;
  const json = async (res: Response) => ({ status: res.status, contentType: "application/json", body: JSON.stringify(await res.json()) });
  await page.route("**/api/**", async (route) => {
    const req = route.request(); const url = new URL(req.url()); const p = url.pathname;
    const next = (init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest("http://localhost" + p + url.search, init);
    try {
      if (p === "/api/health") return route.fulfill({ json: { ok: true, hosted: true } });
      if (p === "/api/chat" && req.method() === "POST") {
        const body = JSON.parse(req.postData() ?? "{}"); body.asynchronous = false;
        const res = await chat.POST(next({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
        const data = await res.json();
        if (res.status !== 200) return route.fulfill({ status: res.status, json: data });
        pending = data.answer;
        return route.fulfill({ json: { conversationId: data.answer.conversationId, conversationRevision: data.answer.conversationRevision, jobId: "live", familyMemberId: data.answer.resolvedFamilyMemberId ?? null } });
      }
      if (p.startsWith("/api/chat/jobs/")) return route.fulfill({ json: req.method() === "DELETE" ? { ok: true } : { job: { status: "complete" }, result: { answer: pending } } });
      if (p === "/api/family") return route.fulfill(await json(await family.GET(next())));
      if (p === "/api/chat/history" && req.method() === "GET") return route.fulfill(await json(await history.GET(next())));
      if (p.startsWith("/api/chat/history/")) return route.fulfill(await json(await historyOne.GET(next(), { params: Promise.resolve({ id: p.split("/").pop()! }) } as never)));
      return route.fulfill({ json: {} });
    } catch (e) { return route.fulfill({ status: 500, json: { error: "bridge: " + (e instanceof Error ? e.message : String(e)) } }); }
  });

  let n = 0, bad = 0;
  const check = async (conv: string, said: string) => {
    n++;
    await page.waitForTimeout(700);
    const top = await page.locator(".message.assistant").last().evaluate((el) => el.getBoundingClientRect().top);
    const scroll = top >= -1 && top < 812 - 80 ? [] : [`scroll: newest answer starts at y=${Math.round(top)}`];
    await page.locator(".chat-window details:not([open]) > summary").evaluateAll((els) => els.forEach((el) => ((el.parentElement as HTMLDetailsElement).open = true)));
    const phone = (await page.evaluate(collectRenderIssues, { root: ".chat-page", minTarget: 44 })).map((i) => `${i.kind}: ${i.detail}`);
    if (shots) { mkdirSync(shots, { recursive: true }); await page.locator(".message.assistant").last().screenshot({ path: path.join(shots, `${which}-${String(n).padStart(2, "0")}-phone.png`) }); }
    await page.setViewportSize({ width: 1280, height: 800 });
    const desktop = (await page.evaluate(collectRenderIssues, { root: ".chat-page", minTarget: 24 })).map((i) => `${i.kind}: ${i.detail}`);
    await page.setViewportSize({ width: 375, height: 812 });
    const answer = await page.locator(".message.assistant .message-body").last().innerText();
    const rec = { household: which, conv, n, said, answer: answer.slice(0, 160), phone: [...scroll, ...phone], desktop, errors: errors.splice(0) };
    if (rec.phone.length || rec.desktop.length || rec.errors.length) bad++;
    appendFileSync(report, JSON.stringify(rec) + "\n");
    quiet(`${rec.phone.length || rec.desktop.length || rec.errors.length ? "ISSUES" : "ok    "} ${conv} #${n}: ${said.slice(0, 60)}${rec.phone.length + rec.desktop.length + rec.errors.length ? "\n   " + [...rec.phone, ...rec.desktop.map((d) => "desktop " + d), ...rec.errors].slice(0, 6).join("\n   ") : ""}`);
  };
  const waitAnswer = async (count: number) => { await page.locator(".message.assistant .message-body:not(.thinking)").nth(count - 1).waitFor({ timeout: 120_000 }); await page.locator(".message-body.thinking").waitFor({ state: "detached", timeout: 120_000 }).catch(() => undefined); };

  for (const c of CONVERSATIONS[which]) {
    await page.goto("/chat"); await page.getByRole("button", { name: "New chat" }).waitFor();
    let answers = 0;
    for (const t of c.turns) {
      await page.getByLabel("Message to DearPolicy").fill(t); await page.getByRole("button", { name: /^Send/ }).click();
      await waitAnswer(++answers); await check(c.name, t);
    }
    for (let i = 0; i < (c.follow ?? 0); i++) {
      const last = page.locator(".message.assistant").last();
      const chip = last.locator(".quick-replies button:not([disabled])").first();
      const box = last.locator(".inline-answer input").first();
      let said = "";
      if (await chip.count()) { said = "[tap] " + (await chip.innerText()); await chip.click(); }
      else if (await box.count()) { const date = (await box.getAttribute("type")) === "date"; said = "[type] " + (date ? "2026-09-28" : "Not sure"); await box.fill(date ? "2026-09-28" : "Not sure"); await last.locator(".inline-answer button").click(); }
      else break;
      await waitAnswer(++answers); await check(c.name, said);
    }
  }
  await browser.close();
  quiet(`\n${which}: ${n} answers checked at both sizes, ${bad} with issues. Report: ${report}`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
