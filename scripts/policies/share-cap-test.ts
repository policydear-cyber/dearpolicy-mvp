/**
 * A share of the sum insured with one printed cap ("10% of Sum Insured, up to S$25,000") is paid up to that cap, for any
 * currency and cap wording, when the cap is in the cover's own currency and nothing else in the passage bounds the share.
 * Anything less sure gives no figure. Made-up policies from several markets; no database, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const base = { policyId: "policy-1", productName: "Made-up Cover", traits: [], formulaKind: "none", formulaValue: null, currency: null, factKey: null,
  offsetDays: null, maximumDays: null, conditions: [] as string[], requirements: [], needsReview: false, basisInferred: false, sourcePage: 3, tier: null, reviewedAt: null };
const coverage = (amount: number, currency: string) => ({ id: "cov-1", policyId: "policy-1", familyMemberId: "fam-1", category: "Critical Illness", amount, currency,
  productName: "Made-up Cover", sourcePage: 1, evidenceText: "Made-up Cover, sum insured", insurer: "Kestrel Assurance", policyName: "Made-up Cover",
  policyNumber: "C-001", groupPolicyNumber: null, documentRole: "certificate", effectiveDate: "2020-01-01", renewalOrExpiryDate: null, currencyVerified: true, policyDocumentVersion: "sha256:v1" });

test("one printed cap in the cover's currency: the lower of the share and the cap, on stored and freshly read rows", async () => {
  const { repairStoredRules, assessCatalogBenefit } = await import("@/lib/policies/benefit-catalog");
  const pay = (quote: string, sumInsured: number, currency: string, stored: boolean) => {
    const share = Number(quote.match(/(\d+)%/)![1]) / 100;
    const [b] = repairStoredRules([{ ...base, id: "x", benefitName: "Angioplasty", quote, ...(stored ? { formulaKind: "sum_insured", formulaValue: share } : {}) }] as never);
    const a = assessCatalogBenefit({ benefit: b as never, coverage: coverage(sumInsured, currency) as never, ownerName: "Ana", facts: {} as never, events: ["critical_illness"] as never }) as { item?: { calculatedAmount?: number | null } };
    return a.item?.calculatedAmount ?? null;
  };
  for (const [quote, sumInsured, currency, expected] of [
    ["Angioplasty: 10% of Sum Insured, up to S$25,000", 1_000_000, "SGD", 25_000],
    ["Angioplasty: 10% of Sum Insured, up to S$25,000", 100_000, "SGD", 10_000],
    ["10% of the sum assured, subject to a maximum of SGD 25,000 per life assured", 1_000_000, "SGD", 25_000],
    ["10% of the sum insured or RM5,000, whichever is lower", 1_000_000, "MYR", 5_000],
    ["10% of the sum insured, subject to a maximum of £10k per life", 500_000, "GBP", 10_000],
    ["Angioplasty: 10% of the Sum Insured, limited to US$20,000 per claim", 400_000, "USD", 20_000],
    ["10% of the coverage amount, capped at HK$50,000", 2_000_000, "HKD", 50_000],
    ["The benefit is 25% of the sum insured, but no more than A$15,000 per claim", 100_000, "AUD", 15_000],
    ["We will pay 10% of the sum insured under this policy, maximum S$25,000 per insured person", 1_000_000, "SGD", 25_000],
    ["An additional 20% of the Sum Assured will be payable, subject to a maximum amount of S$25,000 (or equivalent currency) per life per condition.", 1_000_000, "SGD", 25_000],
    ["we will, subject to the provisions of this Policy, pay 20% of the Insured Amount under this Supplementary Agreement, subject to a limit of S$25,000", 1_000_000, "SGD", 25_000],
    ["10% of the sum insured, no more than €8,000", 200_000, "EUR", 8_000],
    ["10% of Sum Insured, up to a maximum of S$25,000", 1_000_000, "SGD", 25_000],
    ["10% of Sum Insured, up to S$25,000, payable only once", 1_000_000, "SGD", 25_000],
    ["10% of the sum insured, but up to a maximum of RM20,000 per claim", 1_000_000, "MYR", 20_000],
  ] as const) {
    assert.equal(pay(quote, sumInsured, currency, true), expected, "stored: " + quote);
    assert.equal(pay(quote, sumInsured, currency, false), expected, "read: " + quote);
  }
  const [noted] = repairStoredRules([{ ...base, id: "x", benefitName: "Angioplasty", quote: "10% of Sum Insured, up to S$25,000", formulaKind: "sum_insured", formulaValue: 0.1 }] as never);
  assert.ok(noted.conditions.includes("Paid up to S$25,000, the cap this passage prints."), JSON.stringify(noted.conditions));
});

test("anything less sure than one cap in the cover's currency gives no figure, never the full share", async () => {
  const { repairStoredRules, assessCatalogBenefit } = await import("@/lib/policies/benefit-catalog");
  for (const [quote, currency] of [
    ["10% of the sum insured, up to US$25,000", "SGD"], // cap in another currency
    ["10% of the sum insured, up to 25,000", "SGD"], // no currency printed
    ["10% of the sum insured, up to $25,000", "SGD"], // a dollar of no stated country
    ["10% of the sum insured, up to S$25,000 per day", "SGD"], // a daily cap is not a lump-sum cap
    ["10% of the sum insured, up to S$25,000 or S$5,000 for children", "SGD"], // two figures
    ["10% of the sum insured, after an excess of S$500", "SGD"], // not a cap
    ["10% of the sum insured, up to S$25,000 less any amount paid before", "SGD"], // another bound
    ["10% of the sum insured, up to the limit in the Schedule", "SGD"], // a cap with no figure
    ["10% of Sum Insured, up to S$25,000 per additional claim", "SGD"], // a later claim may follow another rule
    ["10% of Sum Insured, up to S$25,000 for the first claim", "SGD"],
    ["10% of the sum insured, up to S$25,000 or the amount in the table, whichever is lower", "SGD"],
    // Critic R416 and TE pr211: a cap for some claims only, an aggregate, a second share, another sentence's cap, a change.
    ["10% of the sum insured, up to S$25,000 for adults; for children 50% of that", "SGD"],
    ["10% of the sum insured, up to S$25,000 in total for all early stage claims", "SGD"],
    ["10% of the sum insured, up to S$25,000 per lifetime across all policies with us", "SGD"],
    ["10% of the sum insured, maximum S$25,000 in total", "SGD"],
    ["10% of the sum insured, up to S$25,000; the benefit is 20% of Sum Insured if diagnosed before age 18", "SGD"],
    ["10% of Sum Insured. Ambulance fees up to S$500.", "SGD"],
    ["10% of the sum insured, up to S$25,000, plus 5% for each year in force", "SGD"],
    ["10% of the sum insured (maximum S$25,000), doubled if the event happens overseas", "SGD"],
    ["10% of the sum insured, up to S$25,000, increased by 10% each year", "SGD"],
    ["10% of the sum insured, up to S$5,000 for a child under 18", "SGD"],
    ["10% of the sum insured, up to S$5,000 if aged 70 or above", "SGD"],
    ["10% of the sum insured, up to S$25,000 if the accident happens overseas", "SGD"],
    ["10% of the sum insured, up to S$25,000 in the first policy year", "SGD"],
    ["10% of the sum insured, up to S$25,000 under Plan A", "SGD"],
    ["10% of the sum insured; dental treatment under this benefit is limited to S$500", "SGD"],
    ["10% of the sum insured, with cosmetic surgery up to S$2,000", "SGD"],
    ["10% of the sum insured, up to S$25,000; for each child the benefit is halved", "SGD"],
    ["Keyhole surgery: 10% of the Sum Insured, limited to S$20,000 per claim", "SGD"], // another benefit's label
  ] as const) {
    for (const stored of [true, false]) {
      const [b] = repairStoredRules([{ ...base, id: "x", benefitName: "Angioplasty", quote, ...(stored ? { formulaKind: "sum_insured", formulaValue: 0.1 } : {}) }] as never);
      const a = assessCatalogBenefit({ benefit: b as never, coverage: coverage(1_000_000, currency) as never, ownerName: "Ana", facts: {} as never, events: ["critical_illness"] as never }) as { item?: { calculatedAmount?: number | null } };
      assert.equal(a.item?.calculatedAmount ?? null, null, (stored ? "stored: " : "read: ") + quote);
    }
  }
});

test("a capped share says its cap in the line people read, not only in the details", async () => {
  const { repairStoredRules, describeBenefitFormula } = await import("@/lib/policies/benefit-catalog");
  for (const [quote, share, line] of [
    ["Angioplasty: 20% of Sum Insured, up to S$25,000", 0.2, "20% of the sum insured on your schedule, up to S$25,000"],
    ["10% of the sum assured, subject to a maximum of SGD 25,000 per life assured", 0.1, "10% of the sum insured on your schedule, up to S$25,000"],
    ["10% of the sum insured or RM5,000, whichever is lower", 0.1, "10% of the sum insured on your schedule, up to MYR 5,000"],
    ["25% of the sum insured, limited to £10,000", 0.25, "25% of the sum insured on your schedule, up to £10,000"],
    ["Angioplasty: 20% of the Sum Insured.", 0.2, "20% of the sum insured on your schedule"],
  ] as const) {
    const [b] = repairStoredRules([{ ...base, id: "x", benefitName: "Angioplasty", quote, formulaKind: "sum_insured", formulaValue: share }] as never);
    assert.equal(describeBenefitFormula(b as never), line, quote);
  }
  // A person-confirmed row says what was confirmed; a passage with any other bound gives no share to describe.
  assert.equal(describeBenefitFormula({ ...base, benefitName: "Angioplasty", quote: "20% of Sum Insured, up to S$25,000", formulaKind: "sum_insured", formulaValue: 0.2, reviewedAt: "2026-10-01" } as never),
    "20% of the sum insured on your schedule");
  const [held] = repairStoredRules([{ ...base, id: "x", benefitName: "Angioplasty", quote: "10% of the sum insured, up to S$25,000 in the first policy year", formulaKind: "sum_insured", formulaValue: 0.1 }] as never);
  assert.doesNotMatch(describeBenefitFormula(held as never), /% of the sum insured/);
});

test("a trigger that names every covered condition keeps the cap; one that names a single condition, a person or a total does not", async () => {
  const { shareBound } = await import("@/lib/policies/benefit-catalog");
  for (const [quote, amount, currency] of [
    ["Pays a Special Benefit of an additional 20% of the Sum Assured upon diagnosis of any one of the 27 conditions covered, up to S$25,000 (or equivalent currency) per life per condition.", 25_000, "SGD"],
    ["20% of the sum insured on the diagnosis of any of the covered illnesses, subject to a maximum of RM20,000", 20_000, "MYR"],
    ["25% of the Sum Assured upon diagnosis of any one of the 40 critical illnesses, limited to £30,000 per life", 30_000, "GBP"],
  ] as const) assert.deepEqual(shareBound(quote, "Special Benefit"), { kind: "cap", amount, currency }, quote);
  for (const quote of [
    "20% of the Sum Assured upon diagnosis of carcinoma in situ, up to S$25,000",
    "20% of the sum insured upon diagnosis of any one of the 27 conditions covered for a child, up to S$25,000",
    "20% of the sum insured upon diagnosis of any one of the conditions covered, up to S$25,000 in total",
    "20% of the sum insured upon diagnosis of any one of the conditions covered in the first policy year, up to S$25,000",
    "100% of the Sum Assured, up to a maximum of S$400,000 in the event that an Insured Person is diagnosed with any disease",
  ]) assert.equal(shareBound(quote, "Special Benefit").kind, "unsure", quote);
});

test("words after a share that change it, or a second share before it, give no figure; words before it that describe the event do not", async () => {
  const { shareBound } = await import("@/lib/policies/benefit-catalog");
  // The event, then the share (Critic R443 M1): paid as printed.
  for (const quote of [
    "Loss of hearing: hearing reduced by more than 80 decibels in one ear, 50% of Sum Insured",
    "Loss of speech: speech reduced to unintelligible sounds, 50% of Sum Insured",
    "Burns: 20% of body surface, 50% of Sum Insured",
    "Luka bakar lebih daripada 15% permukaan badan: 50% daripada Jumlah Diinsuranskan",
    "100% of the Sum Assured will be payable in one lump sum.",
    "100% of the Sum Assured upon diagnosis of a Critical Illness",
    "10% of the sum insured if diagnosed under age 65",
    "We pay 100% of Sum Insured for qualifying critical illness.",
    "100% of the Sum Assured is payable within 30 days of our approval of the claim.",
    "On the death of the Life Assured, we will pay 100% of the Sum Assured to the policy owner.",
    "100% of the Sum Insured shall be paid upon permanent paralysis of two limbs, subject to the terms and conditions of this policy.",
    "Kami akan membayar 100% daripada Jumlah Diinsuranskan apabila didiagnosis dengan mana-mana penyakit kritikal yang dilindungi.",
    "50% of the Sum Insured for each eye",
    "10% of the sum insured. We won't pay for a pre-existing condition.",
  ]) assert.equal(shareBound(quote, "Critical Illness Benefit").kind, "none", quote);
  // Anything after the share that may change it, in any language, and a second share before it (Critic R443 H1).
  for (const quote of [
    "50% of the Sum Insured minus any amount paid before",
    "50% of the Sum Insured after deducting any amount paid under Benefit 2",
    "50% of the Sum Insured net of any earlier payment",
    "50% of the Sum Insured, halved for children",
    "50% of the Sum Insured, doubled if the accident happens overseas",
    "50% of the Sum Insured, or half that for children",
    "50% of the Sum Insured, or a quarter for children",
    "Children 25%, adults 50% of the Sum Insured",
    "25% for a child, otherwise 50% of the Sum Insured",
    "50% daripada Jumlah Diinsuranskan, atau 25% bagi kanak-kanak",
    "50% daripada Jumlah Diinsuranskan, ditolak sebarang jumlah yang telah dibayar",
    "50% daripada Jumlah Diinsuranskan, separuh bagi kanak-kanak",
    "50% dari Uang Pertanggungan, dikurangi pembayaran sebelumnya",
    "50% of the Sum Insured. 25% for children.",
    "50% of the Sum Insured if the insured is a child",
    "50% of the Sum Insured for the first claim",
    "50% of the Sum Insured for each child",
    "50% of the Sum Insured if overseas, otherwise 25%",
    "50% of the Sum Insured, payable after deducting any earlier claim",
  ]) assert.equal(shareBound(quote, "Critical Illness Benefit").kind, "unsure", quote);
});

test("a condition that goes on to change the amount, a later sentence that does, and a change before the share give no figure", async () => {
  const { shareBound } = await import("@/lib/policies/benefit-catalog");
  const S = "50% of the Sum Insured";
  // Critic R450 H1a-c.
  for (const quote of [
    S + " on a pro-rata basis", S + " if a claim has been paid under Benefit 2 it will be offset", S + " where it is apportioned among all insured persons",
    S + " if other insurance applies, we pay only our rateable proportion", S + " when hospitalised overseas, multiplied by two",
    S + " if the accident happens overseas, three times the amount", S + " if diagnosed after age 70, payable proportionately",
    S + " when shared equally between the insured persons", S + " if two lives are covered, divided between them",
    S + ". Any amount paid under Benefit 2 will be deducted.", S + ". For children this amount is halved.", S + ". This is reduced by any earlier payment.",
    "After deducting any amount paid under Benefit 2, we pay 50% of the Sum Insured", "Less any amount paid under Benefit 2, 50% of the Sum Insured",
    "Twice the amount if overseas, else 50% of the Sum Insured", "For a child, half of the amount; for an adult 50% of the Sum Insured",
    "Reduced to 25% for children, otherwise 50% of the Sum Insured", "Equal to 25% for a child, and 50% of the Sum Insured",
  ]) assert.equal(shareBound(quote, "Loss").kind, "unsure", quote);
  for (const quote of [S + " due to an accident", S + " if the insured dies within 12 months of the accident", S + " per eye",
    "Head - Equals to or greater than 2% but less than 5% 50%"])
    assert.equal(shareBound(quote, "Loss").kind, "none", quote);
});

test("after 'when' or 'to whom', only words that say who, what, when or who certifies keep the share; any other wording gives no figure", async () => {
  const { shareBound } = await import("@/lib/policies/benefit-catalog");
  const S = "50% of the Sum Insured is payable";
  // Critic R454: wordings no change-word list names, in English and Malay; TE round 3 W7/W8.
  for (const quote of [
    "50% of the Sum Insured jika berlaku di luar negara, dibahagikan dua", "50% daripada Jumlah Diinsuranskan jika tuntutan dibayar, dipotong",
    S + " to the extent not paid by any other insurer.", S + " after any amount already paid has been taken off.",
    S + " for the remaining balance of the sum insured after earlier claims.", S + " on each policy anniversary in five equal instalments.",
    S + " upon diagnosis in place of the death benefit.", S + " upon diagnosis as a weekly sum.", S + " upon death, the balance after any debt owed to us.",
    "50% daripada Jumlah Diinsuranskan dibayar kepada pemilik polisi, dibahagi sama rata.",
    "50% daripada Jumlah Diinsuranskan dibayar apabila didiagnosis, setelah dipotong hutang.",
    S + " upon diagnosis of cancer in five equal instalments.", S + " upon diagnosis for a child under age 18.",
    // TE round 5: inside an illness name or a payee, any word about money or how it is paid still gives no figure.
    S + " to the policy owner in five equal instalments.", S + " to each child of the insured.", S + " upon diagnosis of cancer, together with any bonus.",
    S + " to the nominee in lieu of the death benefit.", S + " upon diagnosis of Stroke, limited to the remaining Sum Assured.",
    "100% of the Sum Assured is payable to the nominee, net of any policy loan.",
    "100% of the Sum Insured is payable on death, pro-rated by the number of days insured.",
    "100% of the Sum Insured is payable on disability, proportionate to the degree of the loss.",
  ]) assert.equal(shareBound(quote, "Critical Illness").kind, "unsure", quote);
  for (const quote of ["100% of the Sum Assured is payable within 30 days of diagnosis.",
    "100% of the Sum Insured if diagnosed under age 65.", "We will pay the benefit of 100% of the sum insured to your estate upon your death.",
    "100% of the Sum Assured will be paid in one lump sum to the beneficiary in the event of death.",
    "Sekiranya didiagnosis, 50% daripada Jumlah Diinsuranskan akan dibayar kepada Peserta.",
    "We pay 100% of the Sum Assured in one lump sum; payment is made by bank transfer.",
    "100% of the Sum Assured is payable to the policyowner upon death of the life assured, and we pay it within 14 days.",
    "100% of the Sum Insured is payable to the beneficiary upon the death of the Insured during the Benefit Term."])
    assert.equal(shareBound(quote, "Critical Illness").kind, "none", quote);
});

// Illness names, payees and bracketed words that are not in the condition word list ("upon diagnosis of carcinoma in
// situ", "to the assignee under a valid assignment") give no figure for now: an open-ended slot reopened leaks in review,
// so they are won back later with their own gate.
test("ordinary conditions, payees and periods from other insurers keep the share (Critic R460 keep corpus)", async () => {
  const { shareBound } = await import("@/lib/policies/benefit-catalog");
  for (const tail of [
    "upon diagnosis of any one of the 27 conditions covered", "upon diagnosis of any one of the covered conditions",     "payable to the beneficiary named in the policy", "if death occurs within 90 days of the accident",
    "if the Life Insured is diagnosed with cancer before age 65", "when the insured is hospitalised for at least 3 consecutive days", "as a lump sum",
    "upon confirmation by a registered medical practitioner", "in one lump sum to the policyholder",
    "provided the diagnosis is made after the waiting period of 90 days", "for Total and Permanent Loss of Sight of one eye", "subject to the terms and conditions of this policy",
    "if the insured person dies as a result of an accident", "upon diagnosis of Major Cancer", "upon diagnosis of a covered Critical Illness, subject to a survival period of 14 days",
    "apabila berlaku kematian akibat kemalangan", "kepada penama", "en cas de décès accidentel",
    "upon diagnosis of one of the 37 covered critical illnesses", "upon Total and Permanent Disability lasting at least 6 consecutive months",
  ]) assert.equal(shareBound("Benefit: 50% of the Sum Insured " + tail, "Benefit").kind, "none", tail);
});

test("payees and illnesses from closed word lists keep the share; a period the share is paid over gives no figure (Critic R465)", async () => {
  const { shareBound } = await import("@/lib/policies/benefit-catalog");
  // Made-up wordings from several markets: who is paid, and which illness, never how much.
  for (const quote of [
    "100% of the Sum Assured is payable to the nominee(s) named in the policy, or to the legal personal representative.",
    "100% of the Sum Assured is payable to the policyholder's estate or executors.",
    "100% of the Sum Assured will be paid to the assignee under a valid assignment.",
    "Upon the death of the Life Assured, 100% of the Sum Assured is paid to the trustees of the policy trust.",
    "100% of the Sum Insured is payable to the Policy Owner (or the beneficiary nominated by the Policy Owner).",
    "100% daripada Jumlah Diinsuranskan akan dibayar kepada penama atau waris apabila Orang Yang Diinsuranskan meninggal dunia.",
    "100% dari Uang Pertanggungan dibayarkan kepada Tertanggung apabila didiagnosis menderita Kanker Stadium Akhir.",
    "100% of the Sum Assured is payable upon diagnosis of end-stage kidney failure requiring dialysis.",
    "We pay 100% of the Sum Assured upon the diagnosis of Alzheimer's disease / severe dementia.",
    "25% of the Sum Assured is payable upon diagnosis of carcinoma-in-situ of the cervix uteri.",
    "100% of the Sum Assured is payable upon diagnosis of Type 1 Diabetes Mellitus in the Life Assured.",
    "100% of the Sum Assured is payable upon diagnosis of Stage 3 cancer or above.",
    "100% of the Sum Insured shall be paid upon permanent and total loss of use of both legs (paraplegia).",
    "100% of the Sum Assured is payable to the nominee or, failing that, to the legal heirs.",
    "100% of the Sum Insured is payable upon diagnosis of Systemic Lupus Erythematosus with lupus nephritis.",
    "100% of the Sum Insured is payable upon diagnosis of Primary Pulmonary Hypertension.",
    "100% of the Sum Insured is payable upon diagnosis of HIV due to blood transfusion.",
    "50% of the Sum Insured if hospitalised for 5 consecutive days",
    "50% of the Sum Insured after 2 years",
  ]) assert.equal(shareBound(quote, "Critical Illness Benefit").kind, "none", quote);
  const S = "50% of the Sum Insured ";
  for (const quote of [
    S + "for 12 months, payable monthly", S + "upon death before age 18, to the policy owner, for 5 years", S + "for 5 years after diagnosis",
    S + "upon diagnosis, for up to 5 years", S + "to the policy owner for 10 years", S + "upon diagnosis of a Critical Illness for life",
    S + "within 30 days, for 12 months", S + "upon diagnosis for 3 years only", "50% daripada Jumlah Diinsuranskan selama 5 tahun",
    "100% of the Sum Assured is payable upon diagnosis of cancer or above.", "100% of the Sum Assured is payable for type 2 claims.",
    "100% of the Sum Assured is payable to the Life Assured's spouse or children as nominees.",
    // "dependants" shares its stem with "depending on", a changer: held back, the safe side (TE pr232).
    "100% of the Sum Assured is payable to your dependants or your legal personal representative.",
  ]) assert.equal(shareBound(quote, "Critical Illness Benefit").kind, "unsure", quote);
});
