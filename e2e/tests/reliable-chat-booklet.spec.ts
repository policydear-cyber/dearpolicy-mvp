import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { uniqueSteps } from "../../components/next-steps";

/**
 * Reliable chat, actual-library repairs (anonymised booklet household): the reported conversations through the ACTUAL
 * chat page and /api/chat, displayed = saved. BK1: an uncertain hip / tibia case whose recorded ask_user had no fact_key
 * and no subject_id -> one useful question with the printed terms, no amount -> the clarified case's illustration, the
 * question cleared. BK2: Other Fracture on the Personal Accident sum insured printed in a generic booklet. BK3: the
 * Compassionate Death Allowance Benefit kept, its bare-$ amount said with its currency unknown, no cut clause. Scripted
 * model moves (scripts/fixtures/reliable-chat/booklet-conversations.ts); plumbing evidence, not a model result.
 */
async function scenario(request: APIRequestContext, id: string): Promise<string[]> {
  const r = await request.post("/__rag2stress/scenario", { data: { id } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).messages as string[];
}
async function last(request: APIRequestContext) { return (await (await request.get("/__rag2stress/last")).json()) as { message: { answer_json: any; content: string; conversation_id: string } | null; state: any }; }
async function send(page: Page, text: string) {
  const answers = page.locator(".message.assistant:not(:has(.thinking))");
  const before = await answers.count();
  await page.getByLabel("Message to DearPolicy").fill(text);
  const t0 = Date.now();
  await page.getByRole("button", { name: /send/i }).click();
  await expect(answers).toHaveCount(before + 1, { timeout: 180_000 });
  const visibleMs = Date.now() - t0;
  await expect(page.locator(".message-body.thinking")).toHaveCount(0, { timeout: 180_000 });
  return { shown: (await answers.last().innerText()).trim(), visibleMs };
}
const norm = (t: string) => t.replace(/[\s ]+/g, " ").trim();
const savedLines = (a: any): string[] => [a.summary, ...(a.details ?? []), ...(a.questions ?? []).map((q: any) => q.text), ...uniqueSteps(a.nextSteps)].filter(Boolean).flatMap((t: string) => String(t).split("\n")).map(norm).filter(Boolean);
async function sameAsSaved(request: APIRequestContext, shown: string, label: string) {
  const s = await last(request); const saved = s.message!.answer_json;
  const loopMs = s.state?.ragLoop?.turns?.at(-1)?.latencyMs ?? null;
  console.log(`--- ${label} DISPLAYED:\n${shown}\n--- ${label} loop (recorded) ${loopMs} ms`);
  const d = norm(shown);
  for (const l of savedLines(saved)) expect(d, `saved line not displayed: ${l}`).toContain(l);
  const savedJson = norm(JSON.stringify(saved).replace(/\\n/g, " ").replace(/\\"/g, '"'));
  for (const amt of shown.match(/S\$[\d,]+/g) ?? []) expect(savedJson, `displayed amount not saved: ${amt}`).toContain(amt);
  return { saved, conversationId: s.message!.conversation_id };
}

const unfinished = (v: string) => v.split("\n").filter((l) => /[“"][^”"]*\b(?:which|and|or|of|the|to|that)\s*[”"]/i.test(l));

test("BK1: an uncertain case asks one useful question (no amount), then the clarified case is calculated and the question cleared", async ({ page, request }) => {
  const [u1, u2] = await scenario(request, "BK1");
  await page.goto("/chat");
  await page.getByRole("button", { name: "New chat" }).click();
  const a1 = await send(page, u1);
  const s1 = await sameAsSaved(request, a1.shown, "BK1 question");
  expect(s1.saved.questions ?? []).toHaveLength(1);
  expect(a1.shown).toMatch(/hip|tibia/i);
  expect(a1.shown).toContain("Hip 75%");
  expect(a1.shown).not.toMatch(/illustration is S\$/);
  expect(a1.shown).not.toMatch(/model-use limit/);
  expect(s1.saved.calculations ?? []).toHaveLength(0);
  const a2 = await send(page, u2);
  const s2 = await sameAsSaved(request, a2.shown, "BK1 clarified");
  expect(a2.shown).toMatch(/conditional illustration is S\$3,750/);
  expect(s2.saved.calculations ?? []).toHaveLength(1);
  expect(s2.saved.questions ?? []).toHaveLength(0);
  expect(a2.shown).not.toMatch(/^You told me/m);
});

test("BK2: Other Fracture uses the Personal Accident sum insured the booklet's section names (S$225,000), never Term Life", async ({ page, request }) => {
  const [u] = await scenario(request, "BK2");
  await page.goto("/chat");
  await page.getByRole("button", { name: "New chat" }).click();
  const a = await send(page, u);
  const s = await sameAsSaved(request, a.shown, "BK2");
  expect(a.shown).toMatch(/conditional illustration is S\$225,000: 75% of Daniel's sum insured of S\$300,000/);
  expect(a.shown).not.toMatch(/S\$375,000|not established/);
  expect(s.saved.calculations ?? []).toHaveLength(1);
});

test("BK3: the Compassionate Death Allowance Benefit is kept; its bare-$ amount is never S$; no cut clause", async ({ page, request }) => {
  const [u] = await scenario(request, "BK3");
  await page.goto("/chat");
  await page.getByRole("button", { name: "New chat" }).click();
  const a = await send(page, u);
  await sameAsSaved(request, a.shown, "BK3");
  expect(a.shown).toMatch(/Compassionate Death Allowance Benefit pays the funeral expenses/);
  expect(a.shown).toMatch(/does not say which currency/);
  expect(a.shown).not.toMatch(/S\$2,000/);
  expect(unfinished(a.shown)).toHaveLength(0);
});

// PR #54 follow-up: the rc-live-5 failures replayed with the model's recorded calls.
for (const id of ["RL1a", "RL1b"]) test(`${id}: after "hip", the conditional S$3,750 and no Other Fracture question (recorded calls)`, async ({ page, request }) => {
  const [u1, u2] = await scenario(request, id);
  await page.goto("/chat");
  await page.getByRole("button", { name: "New chat" }).click();
  const a1 = await send(page, u1);
  const s1 = await sameAsSaved(request, a1.shown, `${id} question`);
  expect(s1.saved.questions ?? []).toHaveLength(1);
  expect(a1.shown).toMatch(/Hip/);
  expect(a1.shown).not.toMatch(/\bb[0-9a-f]{10}(?:r\d+)?\b/);
  expect(a1.shown).not.toMatch(/S\$3,750|S\$225,000/);
  const a2 = await send(page, u2);
  const s2 = await sameAsSaved(request, a2.shown, `${id} hip`);
  expect(a2.shown).toMatch(/conditional illustration is S\$3,750/);
  expect(a2.shown).not.toMatch(/Other Fracture|225,000/);
  expect(s2.saved.questions ?? []).toHaveLength(0);
});
test("RL3: no false enrolment caveat -- the certificate's dated listing, the allowance kept (recorded calls)", async ({ page, request }) => {
  const [u] = await scenario(request, "RL3");
  await page.goto("/chat");
  await page.getByRole("button", { name: "New chat" }).click();
  const a = await send(page, u);
  await sameAsSaved(request, a.shown, "RL3");
  expect(a.shown).not.toMatch(/do not confirm/i);
  expect(a.shown).toMatch(/Daniel's certificate lists Daniel under Group Personal Accident as of 01\/04\/2024/);
  expect(a.shown).toMatch(/does not by itself establish cover on a later date/);
  expect(a.shown).toMatch(/Compassionate Death Allowance Benefit/);
  expect(a.shown).not.toMatch(/S\$2,000/);
});
