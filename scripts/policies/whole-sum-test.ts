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
