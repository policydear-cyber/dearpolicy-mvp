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
  for (const q of ["The life insured will be covered for death and terminal illness.", "You may choose to either fully or partially cash-in the policy.",
    "Covers death or terminal illness occurring within the first month of the policy."])
    assert.equal(unreadAmountLine(49, q), "The passage on page 49 describes this in words, with no amount in it.", q);
  assert.equal(unreadAmountLine(null, "The life insured will be covered for death."), "The passage on the page describes this in words, with no amount in it.");
  for (const q of ["Example Fund 0.85% p.a.", "Benefit $100,000.00 21 Sep 2020", "covered for 10 early critical illnesses", "", "   ", null, undefined,
    // An amount stated without an ASCII digit (TE pr206).
    "ten thousand dollars", "One hundred percent of the sum assured", "fifty per cent", "twenty-five dollars", "five hundred pounds sterling",
    "S$ five hundred", "SGD five thousand", "RM lima ratus", "£ (amount shown in the schedule)", "一万元", "S$５００",
    "Double the sum assured", "Half of the sum insured", "Twice the daily benefit",
    // A fraction in words, an amount printed elsewhere, or a quote cut at its stored length (Critic R400).
    "a tenth of the benefit", "one twenty-fourth of the benefit", "satu perlima manfaat", "A sum equal to the Sum Assured as shown in the Policy Schedule",
    "The full Sum Insured is payable", "the benefit amount stated in the schedule", "an amount equal to the annual premium",
    "subject to the overall limit",
    // A reason below never hides a printed amount, a cut quote, or a sum that something changes.
    "We will waive premiums and pay S$5,000.", "We pay the Sum Assured less any outstanding loan.",
    "the policy value of RM10,000", "advance of the death benefit up to S$500,000", "We pay the sum insured. ".repeat(12), "x".repeat(255), "We pay this benefit ".repeat(13)])
    assert.equal(unreadAmountLine(13, q), "The amount on page 13 could not be read.", String(q));
});

test("the Benefits page uses it for every unreadable amount", () => {
  const page = readFileSync("app/schedule/page.tsx", "utf8");
  assert.match(page, /if\(b\.attention==="unreadable"\)return \{text:unreadAmountLine\(b\.sourcePage,b\.quote\),established:false\};/);
  assert.doesNotMatch(page, /could not be read\.`/);
});

test("a passage with no fixed amount says why, for any policy: a premium waiver, an advance of the death benefit, the whole sum in words, or the policy's value", async () => {
  const { unreadAmountLine } = await import("@/lib/policies/unread-amount-line");
  const why = (q: string) => unreadAmountLine(7, q);
  for (const q of ["We will not charge future premiums due under the basic benefit contract beginning from the date the life insured is diagnosed with total and permanent disability (TPD).",
    "Premiums will be waived for 12 months after the diagnosis.", "Kami akan mengecualikan premium; the waiver of premium applies from the 2nd year."])
    assert.equal(why(q), "The passage on page 7 waives future premiums. This benefit pays no amount itself.", q);
  for (const q of ["we will pay the TI benefit as an advancement of the death benefit. However, this will not be more than the TI/Critical Illness (CI) limit.",
    "This benefit is an acceleration of the death benefit and is paid within 30 days."])
    assert.equal(why(q), "The passage on page 7 pays this in advance from the death benefit, so its amount follows the death benefit, within any limit the policy sets.", q);
  for (const q of ["Get one lump sum payment of the coverage amount upon diagnosis of any of the critical illnesses",
    "Get one lump sum payment of the coverage amount upon diagnosis of any of the 10 early critical illnesses covered", "We pay the Sum Assured on the death of the life assured."])
    assert.equal(why(q), "The passage on page 7 pays the whole sum insured, which this document does not print for you. Your amount is on your own policy schedule or certificate.", q);
  for (const q of ["If the Insured is alive on the Maturity Date while your Basic Policy is in force, we will pay the Maturity Benefit being the Policy Value as at the relevant Valuation Day (less applicable fees and charges, if any).",
    "You may choose to either fully or partially withdraw the cash-in value of any accumulated reversionary bonus and cash-in bonus.",
    "If the life insured dies during the policy term, we will pay the higher of following in one lump sum. (a) 105% of (the total premiums paid on the basic plan, less any advance premiums); or (b) 101% of the cash-in value",
    "The Maturity Benefit shall be determined by reference to the Bid Price prevailing as at the Valuation Day immediately following the Maturity Date.",
    "the cash value of the policy", "We pay the Sum Insured or the policy value, whichever is higher.", "Nilai tunai: we pay the surrender value of the policy."])
    assert.equal(why(q), "The passage on page 7 works this out from the policy's value or the premiums paid at the time, so the document prints no fixed amount for it.", q);
});
