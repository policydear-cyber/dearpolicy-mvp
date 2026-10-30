/**
 * A benefit name cut at its stored length (90 characters) is shown with ")" when its quote closes the bracket the cut
 * left open, nothing when the quote shows the name whole, and "…" otherwise; a shorter name gets nothing. Made-up rows;
 * no database, no network, no model.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const cap = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, 90);

test("a name cut at 90 characters gets ')' or '…' from its own quote; a whole or short name gets nothing", async () => {
  const { cutNameSuffix } = await import("@/lib/policies/cut-name");
  const liability = "If you are liable for accidental death, injury or damage to other people, items or property while on your trip";
  assert.equal(cap(liability).length, 90);
  assert.equal(cutNameSuffix(cap(liability), liability + " S$500,000 S$1,000,000"), "…");
  const arm = "Permanent loss of use of one hand or one arm, including total loss (between elbow and wris";
  assert.equal(arm.length, 90);
  assert.equal(cutNameSuffix(arm, arm + "t) 100%"), "…", "cut mid-word inside the bracket");
  const hand = "Permanent loss of use of one hand or one arm, including any loss, (between elbow and wrist";
  assert.equal(hand.length, 90);
  assert.equal(cutNameSuffix(hand, hand + ") 100%"), ")");
  // A row number taken off the name stays in the quote.
  assert.equal(cutNameSuffix(cap(liability), "3 " + liability), "…");
  // A whole 90-character name: the quote's end, a figure, a capital word or punctuation after it.
  const whole = "Emergency medical evacuation and repatriation of mortal remains to the country of domicile";
  assert.equal(whole.length, 90);
  for (const q of [whole, whole + " S$1,000,000", whole + " SGD 1,000", whole + " RM50", whole + ": as charged", whole + " 100%", whole + ".", whole + "; and"])
    assert.equal(cutNameSuffix(whole, q), "", q);
  // Anything else after it may be the rest of the name (Critic R404): a word in any case, a cut figure, a hyphen, an
  // apostrophe, an ampersand, a slash, a comma, or a bracket closed and then run on.
  for (const rest of [" Unlimited", " and shoulder", "0 years", "-related", "'s", " & elbow", "/wrist", ", hand", ".5%", " - see note"])
    assert.equal(cutNameSuffix(whole, whole + rest), "…", rest);
  const age = "Waiver of premium if a life assured becomes totally and permanently disabled before ages 7";
  assert.equal(age.length, 90);
  assert.equal(cutNameSuffix(age, age + "0 years"), "…");
  assert.equal(cutNameSuffix(hand, hand + ") and shoulder 100%"), "…");
  assert.equal(cutNameSuffix(hand, hand + ")"), ")");
  // A short name gets nothing; a 90-character name whose quote does not print it in one piece (its label wraps between
  // the row's figures) or that has no quote is taken as cut.
  assert.equal(cutNameSuffix("Personal liability", "Personal liability while on your trip"), "");
  assert.equal(cutNameSuffix("Personal liability while on your trip", null), "");
  assert.equal(cutNameSuffix(cap(liability), "If you are liable for accidental death, injury or damage to S$500,000 S$1,000,000"), "…");
  assert.equal(cutNameSuffix(cap(liability), null), "…");
  // A ")" after a name with no open bracket is never added; what follows is not known to be harmless, so "…".
  assert.equal(cutNameSuffix(whole, whole + ")"), "…");
});

test("the Benefits pages show the suffix after the stored name, and the stored name is what they send back", () => {
  const route = readFileSync("app/api/benefits/route.ts", "utf8");
  assert.match(route, /nameSuffix:cutNameSuffix\(row\.benefit_name,row\.quote\),/);
  assert.match(route, /benefitName:row\.benefit_name,/);
  for (const page of ["app/schedule/page.tsx", "app/operator/benefits/page.tsx"]) {
    const src = readFileSync(page, "utf8");
    assert.match(src, /<strong>\{benefit\.benefitName\}\{benefit\.nameSuffix\}<\/strong>/, page);
    assert.doesNotMatch(src, /benefitName:[^,}\n]*nameSuffix/, page);
  }
});
