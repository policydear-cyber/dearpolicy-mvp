import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { uniqueSteps } from "../../components/next-steps";

/**
 * The fx-live-1 repairs (PR #57) through the REAL chat page and /api/chat, over the ANONYMISED fracture library
 * (scripts/fixtures/reliable-chat/fracture-conversation.ts). Scripted model moves = the production model's own recorded calls
 * (scripts/fixtures/reliable-chat/fx-repairs-scenarios.ts): plumbing evidence for the product code after the model, not a model result.
 *
 * Every turn checks returned = saved = displayed, and the last turn of each conversation is checked again after a reload (= reopened):
 *   returned   the answer object the browser received from the finished job (/api/chat/jobs/<id>)
 *   saved      the answer_json row the server stored (GET /__rag2stress/last)
 *   displayed  the text of the assistant message on the page
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

test("FX-K6B dental: 'the documents do not describe a dental benefit' (checked scope named), never 'no dental cover', not a generic 'could not confirm'", async ({ page, request }) => {
  const [u] = await open(page, request, "FX-K6B");
  const t = await send(page, request, u);
  expect(t.shown).toMatch(/do not describe a benefit for dental treatment/);
  expect(t.shown).toMatch(/not the same as saying there is no such cover/);
  expect(t.shown).toMatch(/Scheme X Group Insurance/);
  expect(t.shown).not.toMatch(/couldn.t confirm|can.t confirm/i);
  expect(t.shown).not.toMatch(/\b(?:you|she|Grace) (?:has|have|had) no dental (?:cover|coverage)/i);
  expect(t.shown).not.toMatch(/not covered|excluded/i);
  noResidue(t.shown);
  // the checked scope, with its source versions, is saved with the answer
  const docs = t.saved.absenceChecks?.[0]?.documents ?? [];
  expect(docs).toHaveLength(3);
  for (const d of docs) { expect(d.policyId).toBeTruthy(); expect(d.fileHash).toBeTruthy(); expect(d.rev).not.toBeUndefined(); }
  // fx-live-2 review: nothing unrelated is listed under Sources. The last page read of each checked document (an amount row, a footnote, a
  // claim condition) said nothing about dental; the scope evidence is the saved absenceChecks above, not a list of cited pages.
  expect(t.returned.citations ?? []).toHaveLength(0);
  expect(t.saved.citations ?? []).toHaveLength(0);
  await expect(page.locator(".message.assistant").last().locator("details.citations")).toHaveCount(0);
  await reopened(page, t);
  await expect(page.locator(".message.assistant").last().locator("details.citations")).toHaveCount(0);
});

test("FX-K6A cancer: the dated Living Care sum insured stays with 'the certificate does not state what it pays for cancer'", async ({ page, request }) => {
  const [u] = await open(page, request, "FX-K6A");
  const t = await send(page, request, u);
  expect(t.shown).toMatch(/S\$350,000/);
  expect(t.shown).toMatch(/does not state what Group Living Care pays for cancer/);
  // the amount is not left standing alone: the limitation is in the same short passage
  const around = norm(t.shown).match(/.{0,400}S\$350,000.{0,700}/)?.[0] ?? "";
  expect(around).toMatch(/does not state what Group Living Care pays for cancer/);
  expect(t.shown).not.toMatch(/couldn.t confirm|can.t confirm/i);
  noResidue(t.shown);
  await reopened(page, t);
});

test("FX-K2 sick hospital stay: the reported cause is used, the accident/injury requirement is explained, no repeated question, no bare 250", async ({ page, request }) => {
  const [u] = await open(page, request, "FX-K2");
  const t = await send(page, request, u);
  expect(t.saved.questions ?? []).toHaveLength(0);
  expect(t.shown).toMatch(/Accidental Hospital Recuperation Benefit \(page 9\)/);
  expect(t.shown).toMatch(/bodily injury as a result of an Accident/);
  expect(t.shown).toMatch(/“she was sick”\) is an illness, not an accident/);
  expect(t.shown).toMatch(/condition is not met/);
  expect(t.shown).not.toMatch(/was (?:it|this|the (?:hospital stay|hospitali[sz]ation)) (?:caused by )?an accident/i);
  expect(t.shown).not.toMatch(/\$\s?250|\b250\b/);
  expect(t.state?.ragLoop?.turns?.at(-1)?.pending ?? null).toBeFalsy();
  noResidue(t.shown);
  await reopened(page, t);
});

test("FX-K4B correction to Daniel: exactly one correction notice, Daniel's facts and documents, nothing contradictory", async ({ page, request }) => {
  const [u1, u2] = await open(page, request, "FX-K4B");
  await send(page, request, u1);
  const t = await send(page, request, u2);
  const notices = t.shown.match(/Updated: this is about [^.]*\./g) ?? [];
  expect(notices).toHaveLength(1);
  expect(t.shown).toMatch(/Updated: this is about Daniel, not Grace\./);
  expect(t.shown).not.toMatch(/this is about Grace, not Daniel/i);
  expect(t.shown).not.toMatch(/Updated: (?!this is about)/);
  expect(t.shown).toMatch(/Daniel/);
  // Daniel's own rows carry every calculation
  const subjects = [...(t.saved.calculations ?? []).map((c: any) => c.subjectId ?? c.subject_id), ...(t.saved.figureBindings ?? []).map((b: any) => b.subjectId)];
  expect(subjects.length).toBeGreaterThan(0);
  expect(new Set(subjects).size).toBe(1);
  expect(t.state?.ragLoop?.claim?.subjectId).toBe(subjects[0]);
  expect(JSON.stringify(t.state?.ragLoop?.claim?.facts ?? {})).toMatch(/broke his arm/);
  expect(JSON.stringify(t.state?.ragLoop?.claim?.facts ?? {})).not.toMatch(/broke her arm/);
  // fx-live-2 review (PERSON-CORRECTION.md): the event the household said was not Grace's is no longer on her claim, and her illustrations are withdrawn
  const aside = t.state?.ragLoop?.otherClaims ?? {};
  expect(JSON.stringify(Object.values(aside).map((c: any) => c.facts ?? {}))).not.toMatch(/broke her arm|fell down/);
  expect(Object.values(aside).flatMap((c: any) => Object.values(c.calcs ?? {})).every((r: any) => r.withdrawn?.cause === "person")).toBe(true);
  noResidue(t.shown);
  await reopened(page, t);
});

test("FR1 footnote: the '#' footnote is said with the Arm row of the Product Summary only, and the '^' footnote (toe, foot) is not attached to an arm fracture", async ({ page, request }) => {
  const [u] = await open(page, request, "FR1");
  const t = await send(page, request, u);
  const paragraphs = t.shown.split(/\n+/).map(norm).filter(Boolean);
  const summary = paragraphs.filter((p) => /S\$1,250/.test(p));
  const certificate = paragraphs.filter((p) => /S\$120,000/.test(p));
  expect(summary.length).toBeGreaterThan(0);
  expect(certificate.length).toBeGreaterThan(0);
  for (const p of summary) { expect(p).toMatch(/thumb, finger and palm are not covered/); expect(p).toMatch(/marked #/); }
  for (const p of certificate) expect(p).not.toMatch(/thumb|finger|palm|footnote/i);
  expect(t.shown).not.toMatch(/\btoes?\b|\bfoot\b|\bfeet\b/i);
  // control: an answer that states figures still lists the pages they come from (the Sources change is only for an answer that states no figure)
  await expect(page.locator(".message.assistant").last().locator("details.citations")).toHaveCount(1);
  await reopened(page, t);
});
