/**
 * Round 8 -- chat answers DISPLAY cleanly: fast static and unit checks.
 *
 *   node --import tsx scripts/r8-render-regressions.ts      (npm run r8:render-test)
 *
 * The browser half is e2e/tests/r8-chat-render.spec.ts (phone 375x812 and
 * desktop 1280x800, real chat page in Chromium). This half needs no browser
 * and runs in CI:
 *
 * 1. Every text the chat page shows for the recorded answers
 *    (e2e/support/r8-answers.json -- real answers from both fixture
 *    households plus edge cases) is free of raw markdown, HTML entities,
 *    escaped "\n", ISO dates and internal codes once it has passed through
 *    the page's own display helpers; Chinese and Malay text is kept as is.
 * 2. readableDates()/codeWords() unit behaviour.
 * 3. The layout rules that fixed the phone defects are still in place: the
 *    chat column cannot be stretched by a wide table, touch targets are 44px
 *    on touch screens, CJK fonts are in the font stack, the inline answer box
 *    follows the theme, the keyboard resizes the page, a new answer scrolls
 *    to its first line, composition amounts and codes are shown as money and
 *    words.
 * 4. The browser spec exists and covers both sizes.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { readableDates, sgDate } from "../components/format-date";
import { answerText, codeWords } from "../components/answer-text";
import type { ChatAnswer } from "../types";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (error) { console.error(`  FAIL ${name}\n${error instanceof Error ? error.stack : error}`); process.exitCode = 1; }
}
const read = (f: string) => readFileSync(path.resolve(f), "utf8");

type Case = { id: string; question: string; answer: ChatAnswer };
const CASES: Case[] = JSON.parse(read("e2e/support/r8-answers.json"));

/** Every assistant string app/chat/page.tsx renders, as it renders it. */
function displayed(a: ChatAnswer): string[] {
  const out: string[] = [answerText(a.summary), ...a.details.map(answerText), ...a.knownFacts.map(answerText)];
  if (a.nextSteps[0]) out.push(answerText(a.nextSteps[0]));
  for (const q of a.questions) out.push(answerText(q.text), answerText(q.why), ...(q.options ?? []));
  for (const p of a.factFinding ?? []) { out.push(p.label, ...p.missingDocuments); for (const q of p.nextQuestions) out.push(answerText(q.text), answerText(q.why), ...(q.options ?? [])); }
  for (const c of a.claimItems) out.push(c.title, answerText(c.reason), ...c.conditions.map(answerText));
  for (const l of a.policyStatedLimits ?? []) out.push(l.amountText, l.benefitTitle, l.citation.policyName);
  for (const c of a.citations) out.push(c.policyName, c.insurer ?? "", c.evidenceLabel ?? "");
  for (const p of a.portfolioItems ?? []) out.push(p.ownerName, p.policyName, ...p.coverages.map((c) => c.productName ?? c.category));
  const comp = a.composition;
  if (comp) {
    out.push(...comp.totalsByCurrency.map((t) => t.amountText), comp.disclaimer, ...comp.outstandingQuestions.map(answerText));
    for (const p of comp.policies) for (const b of p.benefits) out.push(b.benefitCategory, answerText(b.blockedReasons.join(" ")), ...b.deductionReferences.map((d) => codeWords(d.reason)), ...b.capReferences.map((c) => `${c.label} (${codeWords(c.scope).toLowerCase()})`));
  }
  out.push(a.disclaimer);
  return out.filter(Boolean);
}
const RAW = /\*\*|__\w|`|(^|\n)\s*#{1,6}\s|\|\s*-{3,}|\s\|\s.+\s\|(\s|$)|\\n|\\u[0-9a-f]{4}|&(?:[a-z]{2,8}|#\d{2,5}|#x[0-9a-f]{2,4});|<\/?[a-z]+[^>]*>|\[object |\bundefined\b|\bNaN\b/i;

test(`1. ${CASES.length} recorded answers: no markdown, entities, escaped newlines, ISO dates or internal codes on screen`, () => {
  assert.ok(CASES.length >= 60, "at least 60 answer types are recorded");
  const bad: string[] = [];
  for (const c of CASES) for (const text of displayed(c.answer)) {
    const m = text.match(RAW) ?? text.match(/\b\d{4}-\d{2}-\d{2}\b/) ?? text.match(/\b[a-z]+_[a-z_]+\b/);
    if (m) bad.push(`${c.id}: "${m[0]}" in "${text.slice(0, 90)}"`);
  }
  assert.deepEqual(bad, []);
});

test("1b. the recording covers the answer kinds the browser spec checks", () => {
  const ids = CASES.map((c) => c.id).join(" ");
  for (const kind of ["short", "greeting", "refusal", "bilingual", "notfound", "renewal", "premium", "tier", "multi-person", "group", "portfolio", "citations", "limits", "person-choice", "fact-question-choice", "fact-question-date", "claim-conclusion", "death", "review-partial", "long-names", "chinese", "invalidated", "composition"])
    assert.ok(ids.includes(kind), `no recorded answer of kind ${kind}`);
  assert.ok(CASES.some((c) => /[一-鿿]/.test(c.question + c.answer.summary)), "Chinese text is covered");
  assert.ok(CASES.some((c) => (c.answer.portfolioItems?.length ?? 0) >= 5), "a wide family policy table is covered");
});

test("2. readableDates writes calendar dates like the rest of the app and leaves everything else alone", () => {
  assert.equal(readableDates("Death Date: 2026-09-28"), "Death Date: 28 Sep 2026");
  assert.equal(readableDates("cover ended on 2026-06-30, before the event on 2026-09-10."), "cover ended on 30 Jun 2026, before the event on 10 Sep 2026.");
  assert.equal(readableDates("Policy THIMG-2026-0001 pays S$1,000 (page 3)"), "Policy THIMG-2026-0001 pays S$1,000 (page 3)");
  assert.equal(readableDates("2026-13-01 is not a date"), "2026-13-01 is not a date");
  assert.equal(readableDates("陈美玲 · 2026-09-28"), "陈美玲 · 28 Sep 2026");
  assert.equal(sgDate("2026-09-28"), "28 Sep 2026");
  assert.equal(answerText("Event Date: 2026-08-20"), "Event Date: 20 Aug 2026");
  assert.equal(codeWords("per_policy_year"), "Per policy year");
  assert.equal(codeWords("co_insurance_10_percent"), "Co insurance 10 percent");
});

test("3. layout: phone-safe chat column, 44px touch targets, CJK fonts, themed inline answer, keyboard-safe composer", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.chat-window \{ grid-template-columns: minmax\(0, 1fr\); \}/, "a wide table cannot stretch the chat column past a phone screen");
  assert.match(css, /\.message, \.message-body \{ min-width: 0; \}/);
  const touch = css.slice(css.indexOf("@media (pointer: coarse), (max-width: 760px)"));
  assert.ok(touch.length > 50, "touch-screen target rules exist");
  const first = touch.slice(0, touch.indexOf("}"));
  for (const sel of [".quick-replies button", ".inline-answer input", ".inline-answer button", ".button.compact", ".mini-button", ".claim-pack-link", ".mobile-bar-actions button", ".bill-review input:not([type=checkbox])"]) assert.ok(first.includes(sel) && first.includes("min-height: 44px"), `${sel} is 44px on touch screens`);
  assert.match(css, /\.bill-review fieldset \{ min-width: 0; min-inline-size: 0;/, "the bill check cannot push a phone page sideways");
  assert.match(touch, /\.chat-page details > summary \{ min-height: 44px;/);
  assert.match(css, /--font:[^;]*"PingFang SC"[^;]*"Noto Sans CJK SC"[^;]*sans-serif;/, "Chinese has a real font on every platform");
  assert.ok(!/\.inline-answer input\{[^}]*background:#fff/.test(css), "the inline answer box follows the dark theme");
  assert.ok(!/--muted-ink/.test(css), "no colour from an undefined token");
  assert.ok(!/:has\([^)]*:focus\)/.test(css), "no layout that moves when the message box loses focus (a tap on Send would miss)");
  assert.match(read("app/layout.tsx"), /interactiveWidget: "resizes-content"/);
});

test("3b. chat page: a new answer scrolls to its first line; amounts are money and codes are words; dates readable", () => {
  const page = read("app/chat/page.tsx");
  assert.match(page, /latest\.current\.scrollIntoView\(\{behavior,block:"start"\}\)/);
  assert.match(page, /readableDates\(customerAnswerText\(message\.content\)\)/);
  assert.match(page, /knownFacts\.map\(\(f,i\)=><span key=\{i\}>\{shown\(f\)\}<\/span>\)/);
  assert.match(page, /<p>\{shown\(item\.reason\)\}<\/p>/);
  assert.ok(!/rawAmount\.toLocaleString\(\)/.test(page), "no bare number + currency code");
  assert.ok(!/\(\{c\.scope\}\)/.test(page), "no raw cap scope code");
  assert.match(page, /formatMoney\(b\.rawAmount,b\.currency\)/);
  for (const label of ["Family member", "Policy", "Confirmed cover", "Active status"]) assert.ok(page.includes(`data-label="${label}"`), `table cell labelled ${label} for the phone card layout`);
  assert.match(read("app/globals.css"), /\.chat-policy-table td::before \{ content: attr\(data-label\);/, "on a phone each policy is a card, not a sideways-scrolled table");
});

test("4. the browser spec covers phone and desktop with the agreed assertions", () => {
  const spec = "e2e/tests/r8-chat-render.spec.ts";
  assert.ok(existsSync(spec));
  const src = read(spec);
  assert.match(src, /width: 375, height: 812/); assert.match(src, /width: 1280, height: 800/);
  for (const k of ["consoleErrors", "minTarget: 44", "collectRenderIssues", "[\\u4e00-\\u9fff]", "newestAnswerInView", "chat-conflict"]) assert.ok(src.includes(k), `spec checks ${k}`);
  const checks = read("e2e/support/r8-render-checks.ts");
  for (const k of ["overflow", "raw-text", "tap-target", "empty", "duplicate", "label", "contrast", "tofu", "clipped", "format"]) assert.ok(checks.includes(`kind: "${k}"`), `render check ${k}`);
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
