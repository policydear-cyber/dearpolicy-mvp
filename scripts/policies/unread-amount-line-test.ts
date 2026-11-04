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
    "We pay the Sum Insured or the policy value, whichever is higher.", "the policy value of RM10,000", "advance of the death benefit up to S$500,000", "We pay the sum insured. ".repeat(12), "x".repeat(255), "We pay this benefit ".repeat(13)])
    assert.equal(unreadAmountLine(13, q), "The amount on page 13 could not be read.", String(q));
});

test("the Benefits page uses it for every unreadable amount", () => {
  const page = readFileSync("app/schedule/page.tsx", "utf8");
  assert.match(page, /if\(b\.attention==="unreadable"\)return \{text:unreadAmountLine\(b\.sourcePage,b\.quote,b\.benefitName\),established:false\};/);
  assert.doesNotMatch(page, /could not be read\.`/);
});

test("a passage with no fixed amount says why, for any policy: a premium waiver, an advance of the death benefit, the whole sum in words, or the policy's value", async () => {
  const { unreadAmountLine } = await import("@/lib/policies/unread-amount-line");
  const why = (q: string) => unreadAmountLine(7, q);
  for (const q of ["We will not charge future premiums due under the basic benefit contract beginning from the date the life insured is diagnosed with total and permanent disability (TPD).",
    "Premiums will be waived from the date of diagnosis."])
    assert.equal(why(q), "The passage on page 7 waives future premiums. This benefit pays no amount itself.", q);
  // English only (DC 4 Nov): a passage that opens in another language is not read: it only says the amount was not read.
  assert.equal(why("Kami akan mengecualikan premium; the waiver of premium applies from the 2nd year."), "The amount on page 7 could not be read.");
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
    "the cash value of the policy", "Nilai tunai: we pay the surrender value of the policy."])
    assert.equal(why(q), "The passage on page 7 works this out from the policy's value or the premiums paid at the time, so the document prints no fixed amount for it.", q);
});

test("a reason is never given when it would mislead: a waiver not of premiums, a printed figure, a denied advance, premiums paid as a condition, a part of the sum (TE pr230)", async () => {
  const { unreadAmountLine } = await import("@/lib/policies/unread-amount-line");
  for (const [q, bad] of [
    ["We waive the excess for claims made at a panel hospital.", /waives future premiums/],
    ["The waiting period is waived for accidents and the benefit is payable from day one.", /waives future premiums/],
    ["Waiver of the survival period applies for this condition.", /waives future premiums/],
    ["We waive all future premiums and pay a lump sum of 5,000 SGD on diagnosis.", /waives future premiums/],
    ["Premi dibebaskan dan kami membayar Rp50.000.000 apabila didiagnosis.", /waives future premiums/],
    ["We waive future premiums and pay Rs 5,00,000 on the first claim.", /waives future premiums/],
    ["We waive future premiums and pay CHF 20,000 on diagnosis.", /waives future premiums/],
    ["This benefit is in addition to, and is not an advance of the death benefit.", /in advance from the death benefit/],
    ["An acceleration of the death benefit, up to fifty thousand dollars.", /in advance from the death benefit/],
    ["Accidental death benefit is payable provided all premiums paid are up to date.", /policy's value/],
    ["This claim does not reduce the policy value. We pay the sum assured on accidental death.", /policy's value/],
    ["We pay the sum insured for each child who is injured in the same accident.", /whole sum insured/],
    ["We pay the sum assured in ten yearly instalments.", /whole sum insured/],
    ["We pay the sum assured of the base plan only, if the rider sum is higher.", /whole sum insured/],
  ] as const) assert.doesNotMatch(unreadAmountLine(12, q), bad, q);
});

test("a second payment, an addition or a change next to a reason keeps 'could not be read' (Critic R466)", async () => {
  const { unreadAmountLine } = await import("@/lib/policies/unread-amount-line");
  for (const q of [
"We will waive all future premiums and pay the sum insured.",
"On diagnosis we pay the sum insured and waive future premiums.",
"Premiums are waived and we also pay the sum assured in one lump sum.",
"We waive future premiums and refund the premiums paid.",
"An advance of the death benefit is paid, and we also pay the sum insured on diagnosis.",
"An advance of the death benefit, together with a lump sum of the sum insured.",
"We pay the policy value or the sum insured, whichever is higher.",
"We pay the policy value and the sum insured.",
"We pay the higher of the policy value and the sum insured.",
"We return the premiums paid plus the sum insured.",
"We pay the sum insured and the policy value.",
"We pay the sum insured, whichever is higher, or the policy value.",
"We return the premiums paid, together with interest.",
"We return the premiums paid with compound interest.",
"We pay the sum insured, doubled for accidents.",
"We pay the sum insured for each insured child.",
"We pay the sum insured to each beneficiary.",
"We pay the sum insured, reduced by the advance already paid.",
"We pay the sum insured if death happens within 12 months; otherwise we refund the premiums paid.",
"We pay the sum insured, minus the cash value already withdrawn.",
"We pay the coverage amount upon diagnosis, payable over 5 years.",
"Get one lump sum payment of the coverage amount, then the policy ends.",
"We pay the sum insured, but nothing if within the waiting period.",
"We pay the sum insured, decreasing by 10% yearly.",
"We pay the sum insured, decreasing yearly.",
"We pay the sum insured, lowered after age 70.",
"We pay the sum insured, adjusted for inflation.",
"We pay the sum insured, adjusted by any indebtedness.",
"We pay the sum insured less any outstanding premium.",
"We pay the policy value, which is not the sum insured.",
"We pay the policy value, guaranteed at least the premiums paid.",
"We pay the surrender value, plus a bonus.",
"We pay the surrender value, plus a loyalty bonus of a fixed sum.",
"Kami akan mengecualikan premium masa depan dan membayar jumlah diinsuranskan.",
"Kami membayar jumlah diinsuranskan dan premium dibebaskan.",
"The death benefit is not accelerated; we pay the sum insured.",
"This benefit is an advance of the death benefit, increased by 25 per cent.",
"This benefit is an advance of the death benefit, increased by a quarter.",
"This benefit is an advance of the death benefit, together with an extra payment.",
"This benefit is an advance of the death benefit, plus the funeral grant.",
    // Critic R468: another named benefit paid, or an alternative payout after "or".
    "We waive future premiums. CI benefit is paid within 30 days.", "We pay the death benefit in advance, or the TPD Benefit.",
    "We waive future premiums or pay the CI benefit.", "Advance payment of the death benefit, or the ADB Benefit is paid.",
  ]) assert.match(unreadAmountLine(3, q), /could not be read|describes this in words/, q);
});

test("a table line cut off before its maximum keeps its printed share and says the maximum was not captured, in any wording", async () => {
  const { unreadAmountLine } = await import("@/lib/policies/unread-amount-line");
  const cut = (share: string) => `Pays ${share}, up to a maximum that was not captured from page 34, so no amount is worked out. The maximum is printed further down page 34.`;
  for (const [q, share, name] of [
    ["(a) Angioplasty and Other Invasive Treatment for : 10% of Prevailing Insured Amount, up to maximum", "10% of Prevailing Insured Amount", "Angioplasty and Other Invasive Treatment for Coronary Artery Disease"],
    ["Keyhole surgery: 20% of the Sum Assured, subject to a maximum of", "20% of the Sum Assured", "Keyhole surgery"],
    ["Minor surgery 15% of the sum insured, limited to", "15% of the sum insured", "Minor surgery"],
    ["Dental 25% of the benefit amount up to a limit of", "25% of the benefit amount", "Dental"],
    ["Carcinoma in situ 12.5 % of Basic Coverage Amount, capped at", "12.5% of Basic Coverage Amount", "Carcinoma in situ"],
    ["Prothèse: 30% of the Insured Sum (maximum", "30% of the Insured Sum", "Prothèse"],
    ["Pays 10% of the Sum Insured, up to maximum", "10% of the Sum Insured", null],
  ] as [string, string, string | null][]) assert.equal(unreadAmountLine(34, q, name), cut(share), q);
  // English only (DC 4 Nov): a share worded in another language keeps no share: the line only says the maximum is further down.
  assert.equal(unreadAmountLine(34, "Rawatan: 10% daripada Jumlah Diinsuranskan, sehingga maksimum", "Rawatan"),
    "The passage on page 34 stops before the maximum it pays up to, so no amount is used for it. The maximum is printed further down page 34.");
  // A condition printed before the share, a share whose name is not given, or a currency named as the base (the figure
  // wrapped onto the next line): no share is said, and the line stays as before (Critic M3, test engineer F1).
  for (const [q, name] of [["After 2 years, 10% of Prevailing Insured Amount, up to maximum", "Angioplasty"], ["If hospitalised overseas, 10% of Sum Insured, up to maximum", "Hospital cash"],
    ["Keyhole surgery: 20% of the Sum Assured, subject to a maximum of", null], ["Angioplasty : 10% of SGD, up to maximum", "Angioplasty"], ["Rawatan: 10% daripada RM, sehingga maksimum", "Rawatan"],
    ["After 2 years:\n10% of Prevailing Insured Amount, up to maximum", "Wrist"]] as const)
    assert.equal(unreadAmountLine(34, q, name), "The passage on page 34 stops before the maximum it pays up to, so no amount is used for it. The maximum is printed further down page 34.", q);
  // No share to keep: a money rate, two percentages (two rows run together), or "of" with no words after it.
  for (const q of ["Daily cash S$100 per day, up to maximum", "Hip 75% / Knee 50%, up to maximum", "Payout: 10% of the, up to maximum", "Up to 10% of, subject to a maximum of"])
    assert.equal(unreadAmountLine(34, q), "The passage on page 34 stops before the maximum it pays up to, so no amount is used for it. The maximum is printed further down page 34.", q);
  for (const q of ["10% of Prevailing Insured Amount, up to maximum of S$25,000", "Pays up to the maximum stated in the schedule.", "Covered up to age 65"])
    assert.doesNotMatch(unreadAmountLine(34, q), /stops before the maximum/, q);
});

test("a waiver never takes another payout as itself, and 'or (b)' lists another payout (Critic R469)", async () => {
  const { unreadAmountLine } = await import("@/lib/policies/unread-amount-line");
  for (const q of ["Premium waiver; it is paid as the TPD Benefit.", "We waive future premiums and this benefit is paid within 30 days."])
    assert.doesNotMatch(unreadAmountLine(7, q), /waives future premiums/, q);
  assert.doesNotMatch(unreadAmountLine(7, "We pay the death benefit in advance, or (b) the ADB Benefit."), /in advance from the death benefit/);
});
