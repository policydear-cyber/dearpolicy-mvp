import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { uniqueSteps } from "../../components/next-steps";

/**
 * Death-journey release: the broad death question and the adjacent-wording fracture journeys over the death-journey household (the faithful actual-library pages plus labelled adjacent dismemberment / death sections), through the REAL chat
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

test("DJ1: the broad death question completes inside the turn limit with every documented death benefit, the gap named and the next step; displayed = saved, survives a reload", async ({ page, request }) => {
  const [u1] = await scenario(request, "DJ1");
  await page.goto("/chat");
  await page.getByRole("button", { name: "New chat" }).click();
  const a = await send(page, u1);
  const s = await sameAsSaved(request, a.shown, "DJ1 death", a.visibleMs);
  expect(a.shown).toMatch(/Group Term Life of S\$500,000 as of 1 April 2024/);
  expect(a.shown).toMatch(/Group Personal Accident of S\$600,000 as of 1 April 2024/);
  expect(a.shown).toMatch(/Compassionate Death Allowance/);
  expect(a.shown).toMatch(/does not say which currency/);
  expect(a.shown).toMatch(/did not read a claims procedure/);
  expect(a.shown).toMatch(/Contact Aldermoor Life Ltd/);
  expect(a.shown).not.toMatch(/couldn.t finish|reached the limit set for model use/);
  expect(unfinished(a.shown)).toEqual([]);
  const tr = (await last(request)).state?.ragLoop?.turns?.at(-1);
  expect(tr.outcome).toBe("final_answer");
  void s;
  await page.reload();
  await expect(page.locator(".message.assistant").last()).toContainText("Group Term Life", { timeout: 60_000 });
});

test("DJ2: the comparison replay over adjacent dismemberment wording: both fracture schedules complete, no dismemberment evaluated or borrowed", async ({ page, request }) => {
  const [u1, u2] = await scenario(request, "DJ2");
  await page.goto("/chat");
  await page.getByRole("button", { name: "New chat" }).click();
  await send(page, u1);
  const a2 = await send(page, u2);
  await sameAsSaved(request, a2.shown, "DJ2 tibia", a2.visibleMs);
  expect(a2.shown).toMatch(/S\$2,500/);
  expect(a2.shown).toMatch(/S\$300,000/);
  expect(a2.shown).not.toMatch(/365 days|Loss of two limbs|Dismemberment/);
  const tr = (await last(request)).state?.ragLoop?.turns?.at(-1);
  const dis = (tr.schedules ?? []).find((r: any) => /Dismemberment/i.test(r.benefit));
  expect(dis?.disposition).toBe("excluded");
  expect((tr.toolCalls ?? []).filter((t: any) => t.name === "evaluate_benefit" && String(t.args?.benefit_id) === dis?.benefitId)).toHaveLength(0);
});

test("DJ3: tibia -> hip over adjacent wording still withdraws the earlier illustration and shows S$3,750", async ({ page, request }) => {
  const [u1, u2] = await scenario(request, "DJ3");
  await page.goto("/chat");
  await page.getByRole("button", { name: "New chat" }).click();
  const a1 = await send(page, u1);
  expect(a1.shown).toMatch(/S\$2,500/);
  const a2 = await send(page, u2);
  await sameAsSaved(request, a2.shown, "DJ3 hip", a2.visibleMs);
  expect(a2.shown).toMatch(/S\$3,750/);
  expect(a2.shown).not.toMatch(/S\$2,500|365 days/);
});
