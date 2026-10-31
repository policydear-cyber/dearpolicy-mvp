/**
 * A benefit's people are listed once each, however many of their documents link them to the booklet, and only the
 * person asked for. Made-up households; no database, no network, no model.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("no network in this test"); }) as typeof fetch;

test("each person once: the sum their covers give, and no empty entry beside it", async () => {
  const { oncePerPerson } = await import("@/lib/policies/benefit-people");
  const e = (ownerId: string, owner: string, plan: string | null, amount: string | null) => ({ ownerId, owner, plan, amount });
  // A certificate, a second copy of it, and a declared wording: one person, one line.
  assert.deepEqual(oncePerPerson([e("a", "Aiko", "Group Life Cover", "¥10,000,000"), e("a", "Aiko", "GROUP LIFE COVER", "¥10,000,000"), e("a", "Aiko", null, null),
    e("b", "Bram", "Group Life Cover", "€200.000")]),
    [{ owner: "Aiko", plan: "Group Life Cover", amount: "¥10,000,000" }, { owner: "Bram", plan: "Group Life Cover", amount: "€200.000" }]);
  // Two different sums for one person are both shown, never one picked.
  assert.equal(oncePerPerson([e("a", "Aiko", "Life Cover", "S$100,000"), e("a", "Aiko", "Life Cover", "S$50,000")]).length, 2);
  // A person none of whose contracts gives a sum: one entry with no sum.
  assert.deepEqual(oncePerPerson([e("c", "Chidi", null, null), e("c", "Chidi", null, null)]), [{ owner: "Chidi", plan: null, amount: null }]);
  // Two people who share a display name stay two people.
  assert.equal(oncePerPerson([e("d1", "Dana Lee", "Life Cover", "RM50,000"), e("d2", "Dana Lee", "Life Cover", "RM50,000")]).length, 2);
  assert.deepEqual(oncePerPerson([]), []);
  assert.equal(fetches, 0);
});

test("the Benefits route lists people through oncePerPerson and only the person asked for", () => {
  const route = readFileSync("app/api/benefits/route.ts", "utf8");
  assert.match(route, /calculatedAgainst=oncePerPerson\(\(contractsByDocument\.get\(row\.policy_id\)\?\?\[\]\)\.filter\(contract=>!member\|\|contract\.ownerId===member\)/);
});
