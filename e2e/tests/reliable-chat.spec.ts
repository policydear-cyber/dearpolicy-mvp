import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { uniqueSteps } from "../../components/next-steps";

/**
 * Reliable chat BROWSER SLICE: the first complete conversation (scenario RC1, household Tan) through the ACTUAL chat
 * page and /api/chat -- the benefit found and its terms explained with one necessary question; the answer evaluated on
 * the server and shown as a verified conditional illustration with a contact step; a correction that withdraws it and
 * shows the re-evaluation; then the page reloaded and the conversation reopened from what was saved. Scripted model
 * moves (scripts/fixtures/reliable-chat/conversations.ts); plumbing evidence, not a model result.
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

test("RC1: benefit -> terms -> question -> server evaluation -> correction, then reopened", async ({ page, request }) => {
  const [u1, u2, u3] = await scenario(request, "RC1");
  await page.goto("/chat"); await page.getByRole("button", { name: "New chat" }).click().catch(() => undefined);

  const a1 = await send(page, u1);
  console.log(`--- V1 click to visible answer ${a1.visibleMs} ms`);
  await sameAsSaved(request, a1.shown, "V1");
  expect(a1.shown).toMatch(/Fracture Benefit/); expect(a1.shown).toMatch(/S\$100,000/); expect(a1.shown).toMatch(/20%/); expect(a1.shown).toMatch(/10%/);
  expect(a1.shown).toMatch(/thigh bone \(femur\), or below the knee/);
  expect(a1.shown).not.toMatch(/S\$10,000|S\$20,000/);

  const a2 = await send(page, u2);
  console.log(`--- V2 click to visible answer ${a2.visibleMs} ms`);
  const s2 = await sameAsSaved(request, a2.shown, "V2");
  expect(a2.shown).toMatch(/conditional illustration is S\$10,000: 10% of Jun's sum insured of S\$100,000/);
  expect(a2.shown).toMatch(/Contact Aurora Assurance/);
  expect(s2.saved.calculations?.length).toBe(1);

  const a3 = await send(page, u3);
  console.log(`--- V3 click to visible answer ${a3.visibleMs} ms`);
  await sameAsSaved(request, a3.shown, "V3");
  expect(a3.shown).toMatch(/no longer applies/);
  expect(a3.shown).toMatch(/conditional illustration is S\$20,000: 20% of Jun's sum insured of S\$100,000/);
  expect(a3.shown).not.toMatch(/illustration is S\$10,000/);

  // P1: reopen -- the saved conversation shows the same three answers, the latest being the corrected one
  await page.reload();
  await page.getByText(u1, { exact: false }).first().waitFor({ timeout: 60_000 }).catch(() => undefined);
  const reopened = norm(await page.locator("body").innerText());
  console.log(`--- P1 reopened page contains V3: ${reopened.includes("S$20,000")}`);
  expect(reopened).toContain("S$20,000");
  expect(reopened).toMatch(/no longer applies/);
});

test("RC2: a part no listed case covers is said with the listed cases and a contact step; no question reaches the page", async ({ page, request }) => {
  const [u] = await scenario(request, "RC2");
  await page.goto("/chat"); await page.getByRole("button", { name: "New chat" }).click().catch(() => undefined);
  const a = await send(page, u);
  console.log(`--- RC2 click to visible answer ${a.visibleMs} ms`);
  const s = await sameAsSaved(request, a.shown, "RC2");
  expect(a.shown).toMatch(/lists no case for a collarbone/);
  expect(a.shown).toMatch(/thigh bone \(femur\) 20%/);
  expect(a.shown).toMatch(/Contact Aurora Assurance/);
  expect(s.saved.questions ?? []).toHaveLength(0);
  expect(a.shown).not.toMatch(/Which listed fracture case/);
});
