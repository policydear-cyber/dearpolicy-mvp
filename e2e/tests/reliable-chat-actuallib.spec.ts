import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { uniqueSteps } from "../../components/next-steps";

/**
 * Structured-answers release: the journeys over the faithful anonymised actual-library household, through the REAL chat
 * page and /api/chat: displayed = saved, and a reloaded chat (history route) shows the same answer. Scripted model moves
 * (scripts/fixtures/reliable-chat/actual-lib-conversations.ts): plumbing evidence, not a model result.
 */
async function scenario(request: APIRequestContext, id: string): Promise<string[]> {
  const r = await request.post("/__rag2stress/scenario", { data: { id } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).messages as string[];
}
async function last(request: APIRequestContext) { return (await (await request.get("/__rag2stress/last")).json()) as { message: { answer_json: any; conversation_id: string } | null; state: any }; }
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
async function sameAsSaved(request: APIRequestContext, shown: string, label: string, visibleMs: number) {
  const s = await last(request); const saved = s.message!.answer_json;
  const loopMs = s.state?.ragLoop?.turns?.at(-1)?.latencyMs ?? null;
  console.log(`--- ${label} DISPLAYED:\n${shown}\n--- ${label} server loop ${loopMs} ms; send-to-visible ${visibleMs} ms; timings ${JSON.stringify(s.state?.ragLoop?.turns?.at(-1)?.timings ?? null)}`);
  const d = norm(shown);
  for (const l of savedLines(saved)) expect(d, `saved line not displayed: ${l}`).toContain(l);
  for (const amt of shown.match(/S\$[\d,]+/g) ?? []) expect(norm(JSON.stringify(saved).replace(/\\n/g, " ")), `displayed amount not saved: ${amt}`).toContain(amt);
  return saved;
}
const unfinished = (v: string) => v.split("\n").filter((l) => /[“"][^”"]*$/.test(l) || /\b(?:if|and|or|of|the)\s*$/i.test(l));

test("SA2: a correction tibia -> hip: the S$3,750 conditional illustration is complete, saved and displayed, and survives a reload", async ({ page, request }) => {
  const [u1, u2] = await scenario(request, "SA2");
  await page.goto("/chat");
  await page.getByRole("button", { name: "New chat" }).click();
  const a1 = await send(page, u1);
  const s1 = await sameAsSaved(request, a1.shown, "SA2 tibia", a1.visibleMs);
  expect(a1.shown).toMatch(/S\$2,500/);
  expect(a1.shown).toMatch(/Neither document says whether one amends, replaces or adds to the other/);
  expect(a1.shown).not.toMatch(/“Schedule”|Schedule benefit/);
  const a2 = await send(page, u2);
  const s2 = await sameAsSaved(request, a2.shown, "SA2 hip", a2.visibleMs);
  expect(a2.shown).toMatch(/If the Simple Fracture benefit applies to Daniel's case “Hip”, the conditional illustration is S\$3,750/);
  expect(a2.shown).not.toMatch(/Correction:|couldn.t confirm|S\$2,500/);
  expect(unfinished(a2.shown)).toEqual([]);
  expect((s2.calculations ?? []).some((k: any) => k.result?.value === 3750)).toBeTruthy();
  void s1;
  await page.reload();
  await expect(page.locator(".message.assistant").last()).toContainText("conditional illustration is S$3,750", { timeout: 60_000 });
});

test("SA3: an uncertain hip / tibia asks one question, the clarification is calculated for the current case, nothing re-asked", async ({ page, request }) => {
  const [u1, u2] = await scenario(request, "SA3");
  await page.goto("/chat");
  await page.getByRole("button", { name: "New chat" }).click();
  const a1 = await send(page, u1);
  const s1 = await sameAsSaved(request, a1.shown, "SA3 question", a1.visibleMs);
  expect(s1.questions ?? []).toHaveLength(1);
  expect(a1.shown).toContain("Hip 75%");
  const a2 = await send(page, u2);
  const s2 = await sameAsSaved(request, a2.shown, "SA3 clarified", a2.visibleMs);
  expect(a2.shown).toMatch(/conditional illustration is S\$2,500/);
  expect(a2.shown).not.toMatch(/possibly|not sure/i);
  expect(s2.questions ?? []).toHaveLength(0);
});

test("SA4: Simple versus Other: separate bases, no total, relationship unestablished", async ({ page, request }) => {
  const [u1] = await scenario(request, "SA4");
  await page.goto("/chat");
  await page.getByRole("button", { name: "New chat" }).click();
  const a1 = await send(page, u1);
  await sameAsSaved(request, a1.shown, "SA4", a1.visibleMs);
  expect(a1.shown).toMatch(/S\$2,500/);
  expect(a1.shown).toMatch(/S\$300,000/);
  expect(a1.shown).toMatch(/never a total/);
  expect(a1.shown).not.toMatch(/“Schedule”|Schedule benefit|means a closed/);
});

test("SA5: the death allowance: kept, complete conditions, currency unstated, contact step", async ({ page, request }) => {
  const [u1] = await scenario(request, "SA5");
  await page.goto("/chat");
  await page.getByRole("button", { name: "New chat" }).click();
  const a1 = await send(page, u1);
  await sameAsSaved(request, a1.shown, "SA5", a1.visibleMs);
  expect(a1.shown).toMatch(/Compassionate Death Allowance Benefit/);
  expect(a1.shown).toMatch(/bare “\$” sign/);
  expect(a1.shown).toMatch(/Contact Aldermoor Life Ltd/);
});

test("SA6: a person switch uses Grace's own certificate row and date", async ({ page, request }) => {
  const [u1, u2] = await scenario(request, "SA6");
  await page.goto("/chat");
  await page.getByRole("button", { name: "New chat" }).click();
  await send(page, u1);
  const a2 = await send(page, u2);
  await sameAsSaved(request, a2.shown, "SA6", a2.visibleMs);
  expect(a2.shown).toMatch(/Grace/);
  expect(a2.shown).toMatch(/S\$100,000/);
  expect(a2.shown).toMatch(/1 July 2024/);
  expect(a2.shown).not.toMatch(/S\$600,000/);
});

test("SA7: the model identified the ambiguity but never asked -- the server asks the one question, and the clarification settles it (reload-safe)", async ({ page, request }) => {
  const [u1, u2] = await scenario(request, "SA7");
  await page.goto("/chat");
  await page.getByRole("button", { name: "New chat" }).click();
  const a1 = await send(page, u1);
  const s1 = await sameAsSaved(request, a1.shown, "SA7 question", a1.visibleMs);
  expect(s1.questions ?? []).toHaveLength(1);
  expect(a1.shown).toMatch(/Which of these cases is it: Hip or Jaw, Pelvis, Leg, Ankle or Knee(?: \(Other Fracture\))?\?/);
  expect(a1.shown).toContain("Hip 75%");
  expect(a1.shown).not.toMatch(/Cheekbone[^\n]*#/);
  expect(a1.shown).not.toMatch(/conditional illustration is S\$/);
  const a2 = await send(page, u2);
  const s2 = await sameAsSaved(request, a2.shown, "SA7 clarified", a2.visibleMs);
  expect(a2.shown).toMatch(/conditional illustration is S\$2,500/);
  expect(a2.shown).toMatch(/conditional illustration is S\$300,000/);
  expect(s2.questions ?? []).toHaveLength(0);
  await page.reload();
  await expect(page.locator(".message.assistant").last()).toContainText("conditional illustration is S$2,500", { timeout: 60_000 });
});

test("SA8: the first report sat under two keys; the correction still settles the case (no case_conflict, no question), reload-safe", async ({ page, request }) => {
  const [u1, u2] = await scenario(request, "SA8");
  await page.goto("/chat");
  await page.getByRole("button", { name: "New chat" }).click();
  const a1 = await send(page, u1);
  await sameAsSaved(request, a1.shown, "SA8 first", a1.visibleMs);
  expect(a1.shown).toMatch(/conditional illustration is S\$2,500/);
  const a2 = await send(page, u2);
  const s2 = await sameAsSaved(request, a2.shown, "SA8 corrected", a2.visibleMs);
  expect(a2.shown).toMatch(/conditional illustration is S\$3,750/);
  expect(a2.shown).not.toMatch(/conditional illustration is S\$(?:2,500|300,000)/);
  expect(s2.questions ?? []).toHaveLength(0);
  await page.reload();
  await expect(page.locator(".message.assistant").last()).toContainText("conditional illustration is S$3,750", { timeout: 60_000 });
});
