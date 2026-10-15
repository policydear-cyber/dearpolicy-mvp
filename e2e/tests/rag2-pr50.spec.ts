import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { uniqueSteps } from "../../components/next-steps";
import * as P from "../../scripts/fixtures/rag2-pr50/household";

/**
 * V1.5 BROWSER REPLAY of the live failures after PR #50 (scenarios P50D fracture, P50C inventory, P50A death; the
 * report's recorded tool calls, scripted by e2e/support/rag2-loop-server.ts with E2E_RAG2_HOUSEHOLD=pr50; no model call)
 * through the ACTUAL chat page and /api/chat on the anonymised household seeded by
 * `node --import tsx e2e/support/seed-rag2-stress-report.ts --household pr50` (file names: PR50_NAMES, same for both).
 * What the page DISPLAYS is compared with the answer SAVED in chat_messages; time to the visible answer is recorded
 * beside the loop's own recorded time. Replay evidence, not a model result.
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
  const t0 = Date.now();
  await page.getByRole("button", { name: /send/i }).click();
  await expect(answers).toHaveCount(before + 1, { timeout: 180_000 });
  const answerAt = Date.now();
  // a completed answer must not sit beside a still-showing checking indicator
  await expect(page.locator(".message-body.thinking")).toHaveCount(0, { timeout: 180_000 });
  const settledAt = Date.now();
  return { shown: (await answers.last().innerText()).trim(), visibleMs: answerAt - t0, indicatorOverlapMs: settledAt - answerAt };
}
const norm = (t: string) => t.replace(/[\s ]+/g, " ").trim();
const savedLines = (a: any): string[] => [a.summary, ...(a.details ?? []), ...(a.questions ?? []).map((q: any) => q.text), ...uniqueSteps(a.nextSteps)].filter(Boolean).flatMap((t: string) => String(t).split("\n")).map(norm).filter(Boolean);
test.describe.configure({ mode: "serial" });

for (const id of ["P50D", "P50C", "P50A"]) {
  test(`${id}: every saved line is displayed, displayed amounts are saved, and the repaired behaviour reaches the page`, async ({ page, request }) => {
    const [msg] = await scenario(request, id);
    await page.goto("/chat"); await page.getByRole("button", { name: "New chat" }).click().catch(() => undefined);
    const { shown, visibleMs, indicatorOverlapMs } = await send(page, msg);
    const s = await last(request); const saved = s.message!.answer_json;
    const loopMs = s.state?.ragLoop?.turns?.at(-1)?.latencyMs ?? null;
    console.log(`\n--- ${id} TIMING: loop (recorded) ${loopMs} ms; click to visible answer ${visibleMs} ms; indicator still shown after the answer ${indicatorOverlapMs} ms`);
    console.log(`--- ${id} DISPLAYED:\n${shown}\n--- ${id} SAVED:\n${savedLines(saved).join("\n")}`);
    const d = norm(shown);
    for (const l of savedLines(saved)) expect(d, `saved line not displayed: ${l}`).toContain(l);
    const savedJson = norm(JSON.stringify(saved).replace(/\\n/g, " ").replace(/\\"/g, '"'));
    for (const amt of shown.match(/S\$[\d,]+/g) ?? []) expect(savedJson, `displayed amount not saved: ${amt}`).toContain(amt);
    expect(shown).not.toMatch(/Death due to|•/);
    if (id === "P50D") {
      expect(shown).toMatch(/conditional illustration is S\$2,500, which is 50% of the S\$5,000 Simple Fracture Benefit Limit/);
      expect(saved.calculations?.length).toBe(1);
      expect(JSON.stringify(saved.calculations)).not.toContain("1000000");
    }
    if (id === "P50C") {
      // by document identity: each eligible upload's record is in the saved answer (citation or library name) and named on the page
      const ids = new Set([...(saved.citations ?? []).map((c: any) => c.policyId)]);
      for (const k of P.ELIGIBLE) {
        const doc = P.doc(k); const names = [doc.product, doc.filename].filter((x): x is string => !!x && !!x.trim());
        expect(names.some((n) => shown.includes(n)), `${k} (${doc.id}) not displayed`).toBeTruthy();
        expect(names.some((n) => (saved.libraryNames ?? []).includes(n)) || ids.has(doc.id), `${k} (${doc.id}) not in the saved record`).toBeTruthy();
      }
      expect(shown).toMatch(/could not be read/);
      expect(shown).not.toMatch(/Old Benefit Summary|other household/);
      // the deleted and other-household uploads are absent by identity, not only by name
      for (const k of ["DELETED", "OTHER"]) { const doc = P.DOCS.find((x) => x.key === k)!; expect((saved.citations ?? []).some((c: any) => c.policyId === doc.id), `${k} cited`).toBeFalsy(); expect(shown).not.toContain(doc.filename ?? "synthetic-dptest-" + k.toLowerCase() + ".pdf"); }
    }
    if (id === "P50A") {
      expect(shown).toMatch(/Contact Kestrel Life Ltd through the scheme administrator to report the death/);
      expect(shown).not.toMatch(/Harbourline/);
      expect(shown).toMatch(/do not establish that Adrian is enrolled for the Compassionate Death Allowance/);
      expect(shown).toMatch(/S\$1,000,000 as of 6 October 2022/); expect(shown).toMatch(/S\$600,000 as of 6 October 2022/);
    }
  });
}
