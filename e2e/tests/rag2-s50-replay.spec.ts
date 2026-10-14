import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

/**
 * V1.4 BROWSER REPLAY: the recorded model output of the actual-model run s50-live-2 (scenario R50, played back verbatim
 * by e2e/support/rag2-loop-server.ts with E2E_RAG2_HOUSEHOLD=binding-cells; no model call) through the ACTUAL chat page
 * and /api/chat on the binding household with its certificate one cell per line (seeded by
 * `node --import tsx e2e/support/seed-rag2-stress-report.ts --household binding-cells`). For each turn, what the page
 * DISPLAYS is compared with the answer SAVED in chat_messages. Replay evidence, not a new model result.
 */
async function scenario(request: APIRequestContext, id: string): Promise<string[]> {
  const r = await request.post("/__rag2stress/scenario", { data: { id } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).messages as string[];
}
async function last(request: APIRequestContext) { return (await (await request.get("/__rag2stress/last")).json()) as { message: { answer_json: any; content: string } | null; state: any }; }
async function send(page: Page, text: string) {
  const answers = page.locator(".message.assistant:not(:has(.thinking))");
  const before = await answers.count();
  await page.getByLabel("Message to DearPolicy").fill(text);
  await page.getByRole("button", { name: /send/i }).click();
  await expect(answers).toHaveCount(before + 1, { timeout: 180_000 });
  await expect(page.locator(".message-body.thinking")).toHaveCount(0, { timeout: 180_000 });
  return (await answers.last().innerText()).trim();
}
const norm = (t: string) => t.replace(/[\s ]+/g, " ").trim();
const savedLines = (a: any): string[] => [a.summary, ...(a.details ?? []), ...(a.questions ?? []).map((q: any) => q.text), ...(a.nextSteps ?? [])].filter(Boolean).flatMap((t: string) => String(t).split("\n")).map(norm).filter(Boolean);
test.describe.configure({ mode: "serial" });

test("R50 replay of s50-live-2: what the browser displays is the saved answer, turn by turn -- amounts, no injury note, no other person's endorsement, no assumed reader, no repeated date question", async ({ page, request }) => {
  const msgs = await scenario(request, "R50");
  await page.goto("/chat"); await page.getByRole("button", { name: "New chat" }).click().catch(() => undefined);
  const out: { shown: string; saved: any }[] = [];
  for (const m of msgs) { const shown = await send(page, m); const s = await last(request); out.push({ shown, saved: s.message!.answer_json }); }
  for (const [i, { shown, saved }] of out.entries()) {
    console.log(`\n--- turn ${i + 1} DISPLAYED:\n${shown}\n--- turn ${i + 1} SAVED:\n${savedLines(saved).join("\n")}`);
    const d = norm(shown);
    // every saved line is displayed
    for (const l of savedLines(saved)) expect(d, `turn ${i + 1}: saved line not displayed: ${l}`).toContain(l);
    // nothing substantive is displayed that is not saved: every amount and every sentence-like displayed line is in the saved answer
    const savedJson = norm(JSON.stringify(saved).replace(/\\n/g, " ").replace(/\\"/g, '"'));
    for (const amt of shown.match(/S\$[\d,]+/g) ?? []) expect(savedJson, `turn ${i + 1}: displayed amount not saved: ${amt}`).toContain(amt);
    for (const line of shown.split("\n").map(norm).filter((l) => l.length > 40)) expect(savedJson, `turn ${i + 1}: displayed line not in the saved answer: ${line}`).toContain(line.slice(0, 60));
    expect(shown).not.toMatch(/doctor|scan results|medical record|diagnos|specialist|medical assessment/i);
    // Michelle's endorsement supports no conclusion about Darren, and the reader is not addressed by name
    expect(shown).not.toMatch(/endorsement|amend|1 January 2024/i);
    expect(shown).not.toMatch(/\b(?:loss|sorry|hello|hi|thanks|thank you),?\s+Michelle\b/i);
  }
  expect(out[0].shown).toMatch(/Group Term Life of S\$1,000,000/); expect(out[0].shown).toMatch(/Group Personal Accident of S\$600,000/);
  expect(out[0].shown).toMatch(/On what date did the accident happen\?/);
  expect(out[1].shown).toMatch(/Group Personal Accident sum insured as S\$600,000/);
  expect(out[1].shown).not.toMatch(/\?/);
  expect((out[0].saved.figureBindings ?? []).map((b: any) => [b.value, b.benefit])).toEqual([[1000000, "Group Term Life"], [600000, "Group Personal Accident"]]);
  expect((out[1].saved.figureBindings ?? []).map((b: any) => [b.value, b.benefit])).toEqual([[600000, "Group Personal Accident"]]);
});
