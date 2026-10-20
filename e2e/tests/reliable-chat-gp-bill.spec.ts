import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { uniqueSteps } from "../../components/next-steps";

/**
 * PR #64 (GP-bill answer) through the REAL chat page and /api/chat, over the anonymised fracture library plus two invented Product Summary
 * pages (scripts/fixtures/reliable-chat/gp-bill.ts: an overseas-only clause on page 20, a panel GP benefit on page 25). Scripted model
 * moves: plumbing evidence for the product code after the model, not a model result. Helpers are those of reliable-chat-fx-repairs.spec.ts:
 * every turn checks returned = saved = displayed, and reopened() checks the answer after a reload.
 * Critic (PR #64): the whose-cover note sits directly under the panel GP quote on the page.
 */
async function scenario(request: APIRequestContext, id: string): Promise<string[]> {
  const r = await request.post("/__rag2stress/scenario", { data: { id } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).messages as string[];
}
const norm = (t: string) => t.replace(/[\s ]+/g, " ").trim();
const savedLines = (a: any): string[] => [a.summary, ...(a.details ?? []), ...(a.questions ?? []).map((q: any) => q.text), ...uniqueSteps(a.nextSteps)].filter(Boolean).flatMap((t: string) => String(t).split("\n")).map(norm).filter(Boolean);
/** What an answer says, in a stable shape, for comparing the returned object with the saved one. */
const shape = (a: any) => JSON.stringify({ s: a.summary, d: a.details ?? [], q: (a.questions ?? []).map((x: any) => x.text), n: a.nextSteps ?? [], c: a.citations ?? [], k: (a.calculations ?? []).map((k: any) => k.result?.value) });
const answerObjects = (o: any, out: any[] = []): any[] => {
  if (!o || typeof o !== "object") return out;
  if (typeof o.summary === "string" && ("nextSteps" in o || "details" in o || "citations" in o)) out.push(o);
  for (const v of Object.values(o)) answerObjects(v, out);
  return out;
};

type Turn = { shown: string; saved: any; returned: any; state: any };
async function send(page: Page, request: APIRequestContext, text: string): Promise<Turn> {
  const received: any[] = [];
  const onResponse = async (res: any) => {
    const u = new URL(res.url());
    if (!/^\/api\/chat\/jobs\//.test(u.pathname)) return;
    try { received.push(await res.json()); } catch { /* a response without a body */ }
  };
  page.on("response", onResponse);
  const answers = page.locator(".message.assistant:not(:has(.thinking))");
  const before = await answers.count();
  await page.getByLabel("Message to DearPolicy").fill(text);
  await page.getByRole("button", { name: /send/i }).click();
  await expect(answers).toHaveCount(before + 1, { timeout: 180_000 });
  await expect(page.locator(".message-body.thinking")).toHaveCount(0, { timeout: 180_000 });
  page.off("response", onResponse);
  const shown = (await answers.last().innerText()).trim();
  const s = (await (await request.get("/__rag2stress/last")).json()) as { message: { answer_json: any } | null; state: any };
  const saved = s.message!.answer_json;
  const returned = received.flatMap((r) => answerObjects(r)).at(-1);
  console.log(`--- DISPLAYED (${text.slice(0, 60)}):\n${shown}`);
  // returned = saved
  expect(returned, "the browser received no answer object from the finished job").toBeTruthy();
  expect(shape(returned), "returned answer differs from the saved one").toBe(shape(saved));
  // saved = displayed
  const d = norm(shown);
  for (const l of savedLines(saved)) expect(d, `saved line not displayed: ${l}`).toContain(l);
  for (const amt of shown.match(/S\$[\d,]+/g) ?? []) expect(norm(JSON.stringify(saved).replace(/\\n/g, " ")), `displayed amount not saved: ${amt}`).toContain(amt);
  return { shown, saved, returned, state: s.state };
}
async function open(page: Page, request: APIRequestContext, id: string) {
  const messages = await scenario(request, id);
  await page.goto("/chat");
  await page.getByRole("button", { name: "New chat" }).click();
  return messages;
}
/** saved = reopened: after a reload the last answer reads exactly as it was displayed. */
async function reopened(page: Page, last: Turn) {
  await page.reload();
  const probe = norm(last.shown).split(" ").slice(2, 6).join(" ");
  const el = page.locator(".message.assistant").last();
  await expect(el).toContainText(probe, { timeout: 60_000 });
  expect(norm(await el.innerText())).toBe(norm(last.shown));
}
const noResidue = (shown: string) => expect(shown).not.toMatch(/benefit_id|result_id|evidence_id|\bb[0-9a-f]{10}\b|\bk[0-9a-f]{10}\b/);

const lines = (shown: string) => shown.split("\n").map(norm).filter(Boolean);
const PANEL = /prints[^“]*“[^”]*panel GP clinic in Singapore/;
const NOTE = /^Daniel[’']s certificate lists /;
const CONFIRM = /Only the insurer or the scheme administrator can confirm whether it applies to Daniel/;
const ABROAD = (l: string) => /outside Singapore/.test(l) && /Emergency Outpatient Treatment Overseas|emergency outpatient treatment received outside Singapore/.test(l);
const APART = /only for treatment outside Singapore, which applies only if the treatment was abroad|pays only for treatment outside Singapore/;

for (const [id, place] of [["GP-UNSAID", "unsaid"], ["GP-HOME", "home"], ["GP-ABROAD", "abroad"], ["GP-TAMPINES", "unsaid"], ["GP-EXTRA", "unsaid"]] as const) {
  test(`${id}: the panel GP quote with the whose-cover note directly under it; returned = saved = displayed = reopened`, async ({ page, request }) => {
    const [u] = await open(page, request, id);
    const t = await send(page, request, u);
    const ls = lines(t.shown);
    const qi = ls.findIndex((l) => PANEL.test(l));
    expect(qi, "the panel GP line is quoted on the page").toBeGreaterThanOrEqual(0);
    expect(ls[qi + 1] ?? "", "the line directly under the panel GP quote is the whose-cover note").toMatch(NOTE);
    expect(ls[qi + 1] ?? "").toMatch(CONFIRM);
    expect(t.shown).not.toMatch(/couldn.t confirm|could not confirm|returned an error/i);
    expect(t.shown).not.toMatch(/S\$\s?800|S\$\s?30\b|S\$\s?1,000\b/);
    const abroad = ls.filter(ABROAD);
    if (place === "home") expect(abroad, "a bill in Singapore: the overseas-only line is not shown").toHaveLength(0);
    if (place === "unsaid") for (const l of abroad) expect(l, "place not said: the overseas-only line is set apart").toMatch(APART);
    if (place === "abroad") expect(abroad.some((l) => !APART.test(l)), "a bill abroad: the overseas-only line is quoted as printed").toBe(true);
    noResidue(t.shown);
    await reopened(page, t);
  });
}
