import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { uniqueSteps } from "../../components/next-steps";

/**
 * Usefulness on real uploaded policies: the production fracture conversation (19 Oct 2026) through the REAL chat page and /api/chat, over an
 * ANONYMISED copy of that library's stored pages (scripts/fixtures/reliable-chat/fracture-conversation.ts). Scripted model moves (the production
 * model's own recorded calls): plumbing evidence for the product code after the model, not a model result.
 * Displayed = saved = reloaded, including citations, questions and next steps.
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
const cited = (a: any) => JSON.stringify(a.citations ?? []);

test("FR1: Grace fell and broke her arm -- both documented alternatives with their bases first, no X-ray question, contact step on the reply, saved = displayed = reloaded", async ({ page, request }) => {
  const [u1, u2] = await scenario(request, "FR1");
  await page.goto("/chat");
  await page.getByRole("button", { name: "New chat" }).click();

  const a1 = await send(page, u1);
  const s1 = await sameAsSaved(request, a1.shown, "FR1 first", a1.visibleMs);
  const top = norm(a1.shown).slice(0, 1400);
  // what the household learns, in the first lines
  expect(top).toMatch(/S\$1,250/);
  expect(top).toMatch(/S\$120,000/);
  expect(top).toMatch(/never a total/);
  expect(top).toMatch(/25% of the Simple Fracture benefit limit of S\$5,000/);
  expect(top).toMatch(/20% of Grace's sum insured of S\$600,000/);
  expect(a1.shown).toMatch(/printed as of 6 October 2022, not confirmation of cover on a later date/);
  expect(a1.shown).toMatch(/Product Summary \(page 13\)/);
  expect(a1.shown).toMatch(/Certificate of Insurance Part 2 \(page 8\)/);
  expect(a1.shown).toMatch(/Neither document says whether one amends, replaces or adds to the other/);
  // no unsupported question, no withheld notice, no technical residue
  expect(s1.questions ?? []).toHaveLength(0);
  expect(a1.shown).not.toMatch(/X-ray|registered medical practitioner/i);
  expect(a1.shown).not.toMatch(/withh|until claim evidence|left out a sentence|insurer review/i);
  expect(a1.shown).not.toMatch(/benefit_id|result_id|evidence_id|\bb[0-9a-f]{10}\b|\bk[0-9a-f]{10}\b/);
  expect(a1.shown).not.toMatch(/prevail|overrid|supersed|takes precedence/i);
  // the saved citations carry both figures' pages and the certificate
  expect(cited(s1)).toMatch(/Simple Fracture Benefit Limit: S\$5,000/);
  expect(cited(s1)).toMatch(/Arm , Elbow, Wrist or Ribs/);
  expect(cited(s1)).toMatch(/600,000/);
  expect((s1.calculations ?? []).map((k: any) => k.result?.value).sort((x: number, y: number) => x - y)).toEqual([1250, 120000]);

  const a2 = await send(page, u2);
  const s2 = await sameAsSaved(request, a2.shown, "FR1 reply", a2.visibleMs);
  expect(norm(a2.shown).slice(0, 1400)).toMatch(/S\$1,250[\s\S]*S\$120,000|S\$120,000[\s\S]*S\$1,250/);
  expect(a2.shown).toMatch(/Aldermoor Life Ltd/);
  expect(s2.questions ?? []).toHaveLength(0);
  expect(a2.shown).not.toMatch(/302,500|121,250|withh|until claim evidence/i);
  expect(uniqueSteps(s2.nextSteps).length).toBeGreaterThan(0);

  await page.reload();
  const reopened = page.locator(".message.assistant").last();
  await expect(reopened).toContainText("S$120,000", { timeout: 60_000 });
  expect(norm(await reopened.innerText())).toBe(norm(a2.shown));
});
