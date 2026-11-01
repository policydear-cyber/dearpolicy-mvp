/** Family never says "Covered for Other". A person whose only cover is of a kind nothing names yet (a card or schedule
 * that names a plan but not what it covers) reads "Found cover for <name>, but not yet what kind of cover it is", the
 * same words Documents uses for a document; beside a named kind, "Other" is simply left out. Both Family data paths are
 * checked (benefit table: kindsOfTable; Coverage rows: ledgerKindsByPerson) with made-up households in S$, RM, £ and €.
 * Pure logic plus a source check of both pages. No database, no network, no model.
 *   npm run -s family:covered-for-other-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const ck = await import("@/components/cover-kinds");
  const { namedCoverKinds, OTHER_LABEL, kindsOfTable, ledgerKindsByPerson } = ck as typeof ck & { namedCoverKinds?: (l: readonly string[]) => { named: string[]; unknownOnly: boolean } };
  const nk = (l: string[]) => { assert.equal(typeof namedCoverKinds, "function", "components/cover-kinds.ts exports namedCoverKinds"); return namedCoverKinds!(l); };

  await test("H1 only an unknown kind: nothing named, said in words", () => {
    assert.deepEqual(nk([OTHER_LABEL]), { named: [], unknownOnly: true });
    assert.deepEqual(nk([`${OTHER_LABEL} (to confirm)`]), { named: [], unknownOnly: true });
  });
  await test("H2 a named kind beside Other lists only the named kind", () => {
    assert.deepEqual(nk(["Death", OTHER_LABEL]), { named: ["Death"], unknownOnly: false });
    assert.deepEqual(nk([OTHER_LABEL, "Hospital and medical", `${OTHER_LABEL} (to confirm)`]), { named: ["Hospital and medical"], unknownOnly: false });
  });
  await test("H3 nothing found stays nothing (no sentence)", () => assert.deepEqual(nk([]), { named: [], unknownOnly: false }));
  await test("H4 a named kind still to confirm is kept as it is", () => assert.deepEqual(nk(["Critical illness (to confirm)"]), { named: ["Critical illness (to confirm)"], unknownOnly: false }));

  // Benefit-table households: a card that names only its plan (no benefit, no kind) in several markets.
  const card = (product: string, cover: string) => ({ product, cover, source: { documentId: "d-" + product } });
  for (const [market, product, cover] of [
    ["S$", "Lion City Member Card", "Plan B"],
    ["RM", "Kenanga Kad Ahli", "Pelan 2"],
    ["£", "Thames Members Card", "Tier Gold"],
    ["€", "Rhein Mitgliedskarte", "Tarif Plus"],
  ] as const) await test(`T-${market} a plan-only card on the table never reads "Covered for Other"`, () => {
    const kinds = kindsOfTable([], [card(product, cover)], []);
    assert.deepEqual(kinds, [OTHER_LABEL], "fixture: the card's kind is unknown");
    assert.deepEqual(nk(kinds), { named: [], unknownOnly: true });
  });
  await test("T-mixed a named cover beside a plan-only card lists only the named kind", () => {
    const kinds = kindsOfTable([{ benefit: "Death", pays: "lump_sum", product: "Harbour Term Life", cover: "Basic", source: { documentId: "d1" } }], [card("Lion City Member Card", "Plan B")], []);
    assert.deepEqual(nk(kinds).named, ["Death"]);
  });

  // Coverage-row households: a person whose only row is of an unnamed kind, and one with a named row too.
  await test("L1 Coverage rows: only an unnamed row gives the unknown sentence", () => {
    const by = ledgerKindsByPerson([{ familyMemberId: "a", eventType: "other", eventLabel: "Member benefit", detail: null, origin: "wording", status: "confirmed" }]);
    assert.deepEqual(by.a, [OTHER_LABEL]);
    assert.deepEqual(nk(by.a), { named: [], unknownOnly: true });
  });
  await test("L2 Coverage rows: named + unnamed lists the named kind only", () => {
    const by = ledgerKindsByPerson([
      { familyMemberId: "b", eventType: "death", eventLabel: "Death", origin: "wording", status: "confirmed" },
      { familyMemberId: "b", eventType: "other", eventLabel: "Member benefit", detail: null, origin: "wording", status: "confirmed" },
    ]);
    assert.deepEqual(nk(by.b).named, ["Death"]);
  });

  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
  await test("S1 Family renders through namedCoverKinds, never joins the raw kinds", () => {
    const src = read("app/family/page.tsx");
    assert.match(src, /namedCoverKinds\(kinds\[member\.id\]/);
    assert.ok(!/kinds\[member\.id\]\.join/.test(src), "Family must not join the raw kinds (that showed \"Other\")");
    assert.match(src, /but not yet what kind of cover it is/);
  });
  await test("S2 Documents says the same words for a document (Family matches it)", () => {
    const src = read("app/policies/page.tsx");
    assert.match(src, /its cover, but not yet what kind of cover it is/);
  });
}

main().then(() => {
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) console.log("FAIL", f); process.exit(1); }
  process.exit(0);
}, (e) => { console.error(e); process.exit(1); });
