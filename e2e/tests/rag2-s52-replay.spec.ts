import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

/**
 * V1.5 BROWSER REPLAY: the recorded model output of the pre-registered actual-model run s52-live-1 (scenarios R52A-R52D,
 * played back verbatim by e2e/support/rag2-loop-server.ts with E2E_RAG2_HOUSEHOLD=livelib; no model call) through the
 * ACTUAL chat page and /api/chat on the live-library household as the run had it (seeded by
 * `node --import tsx e2e/support/seed-rag2-stress-report.ts --household livelib`, the unreadable upload named
 * IMG_0042.jpg). For each of the six turns, what the page DISPLAYS is compared with the answer SAVED in chat_messages.
 * Replay evidence, not a new model result.
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
const norm = (t: string) => t.replace(/[\s ]+/g, " ").trim();
// The page shows summary, details, questions and -- when there is no question -- the FIRST next step (app/chat/page.tsx).
const savedLines = (a: any): string[] => [a.summary, ...(a.details ?? []), ...(a.questions ?? []).map((q: any) => q.text), ...((a.questions ?? []).length ? [] : (a.nextSteps ?? []).slice(0, 1))].filter(Boolean).flatMap((t: string) => String(t).split("\n")).map(norm).filter(Boolean);
test.describe.configure({ mode: "serial" });

const shownBy: Record<string, string[]> = {};
for (const id of ["R52A", "R52B", "R52C", "R52D"]) {
  test(`${id} replay of s52-live-1: every saved line is displayed, and nothing substantive is displayed that is not saved`, async ({ page, request }) => {
    const msgs = await scenario(request, id);
    await page.goto("/chat"); await page.getByRole("button", { name: "New chat" }).click().catch(() => undefined);
    const out: { shown: string; saved: any }[] = [];
    for (const m of msgs) { const shown = await send(page, m); const s = await last(request); out.push({ shown, saved: s.message!.answer_json }); }
    shownBy[id] = out.map((o) => o.shown);
    for (const [i, { shown, saved }] of out.entries()) {
      console.log(`\n--- ${id} turn ${i + 1} DISPLAYED:\n${shown}\n--- ${id} turn ${i + 1} SAVED:\n${savedLines(saved).join("\n")}`);
      const d = norm(shown);
      for (const l of savedLines(saved)) expect(d, `${id} turn ${i + 1}: saved line not displayed: ${l}`).toContain(l);
      const savedJson = norm(JSON.stringify(saved).replace(/\\n/g, " ").replace(/\\"/g, '"'));
      for (const amt of shown.match(/S\$[\d,]+/g) ?? []) expect(savedJson, `${id} turn ${i + 1}: displayed amount not saved: ${amt}`).toContain(amt);
      expect(shown).not.toMatch(/Living Care|S\$300,000/);
      expect(shown).not.toMatch(/policy wording says[^.\n]*S\$2,000/);
      expect(shown).not.toMatch(/couldn’t confirm an answer to that/);
      expect(shown).not.toMatch(/do not provide Adrian’s Group Personal Accident Sum Insured/);
      expect(shown).not.toMatch(/\b(?:does not|doesn['’]t) cover\b[^.\n]*\b(?:trip|Japan)\b/i);
    }
    if (id === "R52A") { expect(out[0].shown).toMatch(/notify Kestrel Life Ltd within 6 months/); expect(out[1].shown).toMatch(/notify Kestrel Life Ltd of a death within 6 months/); expect(out[1].shown).toMatch(/does not document travel cover for Japan/); }
    if (id === "R52C") expect(out[0].shown).toMatch(/IMG_0042\.jpg \(could not be read\)/);
  });
}
