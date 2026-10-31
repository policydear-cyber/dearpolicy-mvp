/**
 * A benefit that pays the whole sum insured in words is shown with each person's own sum of the cover of the same name,
 * and its source, only when that is certain. Made-up households from several markets; no database, no network, no model.
 */
import test from "node:test";
import assert from "node:assert/strict";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("no network in this test"); }) as typeof fetch;

type Cover = { productName: string; amount: number | null; currency: string | null; currencyVerified?: boolean; policyId?: string; sourcePage?: number | null };
const doc = (id: string, product: string) => ({ id, product_name: product, original_filename: "upload.pdf", insurer: "Example Insurer", document_role: "certificate", policy_number: null });
function contract(owner: string, covers: Cover[]) {
  return { id: "c-" + owner, ownerId: "m-" + owner, ownerName: owner, name: "Example Scheme", insurer: "Example Insurer",
    documents: [doc("d-" + owner, "Example Group Scheme certificate")], references: [], confirmed: true, effectiveDate: null, ownershipBasis: "evidence",
    coverages: covers.map((c, i) => ({ id: owner + i, policyId: c.policyId ?? "d-" + owner, familyMemberId: "m-" + owner, category: "Critical Illness",
      amount: c.amount, currency: c.currency, currencyVerified: c.currencyVerified ?? true, productName: c.productName, sourcePage: c.sourcePage ?? 1,
      evidenceText: null, insurer: null, policyName: null, policyNumber: null, groupPolicyNumber: null, documentRole: "certificate", effectiveDate: null, renewalOrExpiryDate: null })) } as never;
}
const WHOLE = "Get one lump sum payment of the coverage amount upon diagnosis of any of the critical illnesses";

test("each person's own sum of the cover named the same, with its document and page, in any currency", async () => {
  const { wholeSumAgainst } = await import("@/lib/policies/whole-sum");
  const lines = wholeSumAgainst([
    contract("Ana", [{ productName: "Group Serious Illness Cover", amount: 250000, currency: "MYR" }, { productName: "Group Serious Illness Cover Plus", amount: 90000, currency: "MYR" }]),
    contract("Ben", [{ productName: "GROUP SERIOUS ILLNESS COVER", amount: 120000, currency: "MYR", sourcePage: 2 }]),
  ], { benefitName: "Serious Illness Cover", quote: WHOLE });
  assert.equal(lines?.length, 2);
  assert.match(lines![0].amount, /250,000/); assert.match(lines![1].amount, /120,000/);
  assert.equal(lines![0].owner, "Ana"); assert.match(lines![1].source, /page 2/);
  // The same cover on two of one person's documents, printing the same sum, is one cover.
  const twice = wholeSumAgainst([contract("Cy", [{ productName: "Life Cover", amount: 500000, currency: "GBP" }, { productName: "Life Cover", amount: 500000, currency: "GBP", policyId: "other" }])],
    { benefitName: "Life Cover", quote: "We pay the sum assured on death." });
  assert.equal(twice?.length, 1); assert.match(twice![0].amount, /500,000/);
});

test("nothing is shown when it is not certain: another name, two sums, an unwritten currency, a passage that changes the sum, any person without it", async () => {
  const { wholeSumAgainst } = await import("@/lib/policies/whole-sum");
  const one = (covers: Cover[], benefitName = "Serious Illness Cover", quote = WHOLE) => wholeSumAgainst([contract("Ana", covers)], { benefitName, quote });
  // "Plus" is another cover, and a category alone is never a match.
  assert.equal(one([{ productName: "Serious Illness Cover Plus", amount: 90000, currency: "SGD" }]), null);
  assert.equal(one([{ productName: "Critical Illness", amount: 90000, currency: "SGD" }]), null);
  // Names that differ only outside a-z0-9 are other covers (TE pr233 D1).
  for (const other of ["Serious Illness Cover+", "Serious Illness Cover 加强", "Serious Illness Cover Ⅱ", "Serious Illness Cover II"])
    assert.equal(one([{ productName: other, amount: 90000, currency: "SGD" }]), null, other);
  assert.equal(wholeSumAgainst([contract("Ana", [{ productName: "Couverture Santé+", amount: 50000, currency: "EUR" }])], { benefitName: "Couverture Santé", quote: WHOLE }), null);
  assert.equal(wholeSumAgainst([contract("Ana", [{ productName: "Couverture Santé", amount: 50000, currency: "EUR" }])], { benefitName: "Couverture Santé", quote: WHOLE })?.length, 1);
  assert.equal(one([{ productName: "Serious Illness Cover", amount: 90000, currency: "SGD" }, { productName: "Serious Illness Cover", amount: 80000, currency: "SGD" }]), null);
  assert.equal(one([{ productName: "Serious Illness Cover", amount: 90000, currency: "SGD", currencyVerified: false }]), null);
  assert.equal(one([{ productName: "Serious Illness Cover", amount: null, currency: "SGD" }]), null);
  for (const quote of ["Get one lump sum payment of the coverage amount less any outstanding loan.", "We pay the sum insured or the policy value.",
    "We pay 50% of the sum insured.", "Covered for 10 early critical illnesses.", "", null])
    assert.equal(one([{ productName: "Serious Illness Cover", amount: 90000, currency: "SGD" }], "Serious Illness Cover", quote as string), null, String(quote));
  // One person of two without the cover: nothing, rather than a figure for some people only.
  assert.equal(wholeSumAgainst([contract("Ana", [{ productName: "Serious Illness Cover", amount: 90000, currency: "SGD" }]), contract("Ben", [])],
    { benefitName: "Serious Illness Cover", quote: WHOLE }), null);
  assert.equal(wholeSumAgainst([], { benefitName: "Serious Illness Cover", quote: WHOLE }), null);
  assert.equal(fetches, 0);
});

test("a person's second document that holds no cover (their own wording or letter) never hides the sum; anything else still does", async () => {
  const { wholeSumAgainst } = await import("@/lib/policies/whole-sum");
  const declared = (owner: string, covers: Cover[]) => {
    const c = contract(owner, covers) as unknown as Record<string, unknown>;
    return { ...c, id: "declared-" + owner, ownershipBasis: "declared", documents: [doc("w-" + owner, "Policy wording")] } as never;
  };
  const evidence = (owner: string, amount: number, currency = "SGD") => contract(owner, [{ productName: "Kritische Krankheit", amount, currency }]);
  const ask = (contracts: never[]) => wholeSumAgainst(contracts, { benefitName: "Kritische Krankheit", quote: WHOLE });
  // A wording or letter the person declared, read for no cover, linked to the same booklet: the certificate's sum stands.
  const lines = ask([evidence("Ana", 350000, "EUR"), declared("Ana", []), evidence("Ben", 300000, "EUR")]);
  assert.equal(lines?.length, 2);
  assert.match(lines![0].amount, /350,000/); assert.equal(lines![0].owner, "Ana"); assert.match(lines![1].amount, /300,000/);
  // The declared document has a cover of its own (another policy, read): it may pay this too, so nothing is shown.
  assert.equal(ask([evidence("Ana", 350000), declared("Ana", [{ productName: "Comprehensive CI II", amount: 100000, currency: "SGD" }])]), null);
  assert.equal(ask([evidence("Ana", 350000), declared("Ana", [{ productName: "Kritische Krankheit", amount: 100000, currency: "SGD" }])]), null);
  // A person with only a declared document, or an evidenced contract without the cover, still shows nothing.
  assert.equal(ask([declared("Ana", [])]), null);
  // Declared only, even with the cover read from it: no evidenced contract, no sum (TE pr237 P13).
  assert.equal(ask([declared("Ana", [{ productName: "Kritische Krankheit", amount: 350000, currency: "EUR" }])]), null);
  assert.equal(ask([evidence("Ana", 350000), contract("Ana", [])]), null);
  assert.equal(ask([evidence("Ana", 350000), declared("Ben", [])]), null);
  // Two evidenced documents of one person printing two sums: never one of them.
  assert.equal(ask([evidence("Ana", 350000), evidence("Ana", 200000)]), null);
  assert.equal(ask([evidence("Ana", 350000), evidence("Ana", 350000)])?.length, 1);
  // A variant's sum is never borrowed: "Plus", "II" and "+" are other covers even beside an empty declared document.
  for (const other of ["Kritische Krankheit Plus", "Kritische Krankheit II", "Kritische Krankheit+"])
    assert.equal(wholeSumAgainst([contract("Ana", [{ productName: other, amount: 90000, currency: "EUR" }]), declared("Ana", [])],
      { benefitName: "Kritische Krankheit", quote: WHOLE }), null, other);
  assert.equal(fetches, 0);
});
