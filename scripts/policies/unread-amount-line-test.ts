/**
 * The Benefits page says an amount "could not be read" only when the passage read for the benefit prints a figure; a
 * passage with no figure at all says the benefit in words, and the page says so. Made-up passages; no database, no
 * network, no model.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

test("a passage with no figure is described in words; one with a figure could not be read; no passage could not be read", async () => {
  const { unreadAmountLine } = await import("@/lib/policies/unread-amount-line");
  for (const q of ["The life insured will be covered for death and terminal illness.", "Get one lump sum payment of the coverage amount upon diagnosis of any of the critical illnesses",
    "You may choose to either fully or partially cash-in the policy."])
    assert.equal(unreadAmountLine(49, q), "The passage on page 49 describes this in words, with no amount in it.", q);
  assert.equal(unreadAmountLine(null, "The life insured will be covered for death."), "The passage on the page describes this in words, with no amount in it.");
  for (const q of ["Example Fund 0.85% p.a.", "Benefit $100,000.00 21 Sep 2020", "covered for 10 early critical illnesses", "", "   ", null, undefined,
    // An amount stated without an ASCII digit (TE pr206).
    "ten thousand dollars", "One hundred percent of the sum assured", "fifty per cent", "twenty-five dollars", "five hundred pounds sterling",
    "S$ five hundred", "SGD five thousand", "RM lima ratus", "£ (amount shown in the schedule)", "一万元", "S$５００",
    "Double the sum assured", "Half of the sum insured", "Twice the daily benefit"])
    assert.equal(unreadAmountLine(13, q), "The amount on page 13 could not be read.", String(q));
});

test("the Benefits page uses it for every unreadable amount", () => {
  const page = readFileSync("app/schedule/page.tsx", "utf8");
  assert.match(page, /if\(b\.attention==="unreadable"\)return \{text:unreadAmountLine\(b\.sourcePage,b\.quote\),established:false\};/);
  assert.doesNotMatch(page, /could not be read\.`/);
});
