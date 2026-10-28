/** Documents page, for a household on the benefit table: a document card's "Found ..." line comes from the table rows
 * read from that document (and the covers printed in it), by the kinds Family uses (kindsOfTable). Its Coverage rows are
 * no longer read or refreshed (seedLedger and readDocumentIntoLedger return early), so a kind they hold that the table
 * does not is never shown, and a kind only the table has is. A household not on the table is unchanged.
 * Made-up rows; pure logic plus a source check of the page. No database, no network, no model.
 *   npm run -s documents:found-line-table-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

const LIFE = "00000000-0000-0000-0000-00000000f001", BOOKLET = "00000000-0000-0000-0000-00000000f002",
  TRIP = "00000000-0000-0000-0000-00000000f003", EMPTY = "00000000-0000-0000-0000-00000000f004",
  SCHEDULE = "00000000-0000-0000-0000-00000000f005";
const src = (documentId: string) => ({ documentId, document: "Example Insurance document", page: 1, excerpt: "" });
type Row = { benefit: string; pays: string; product: string; cover: string; source: ReturnType<typeof src>; coverEnded?: string | null };
type Cover = { product: string; cover: string; source: ReturnType<typeof src>; ended?: string | null };
const row = (doc: string, product: string, cover: string, benefit: string, pays = "lump_sum"): Row => ({ benefit, pays, product, cover, source: src(doc) });

// Lim Ah Kow and Tan Mei Ling, on the benefit table.
const people: { id: string; rows: Row[]; covers: Cover[] }[] = [
  { id: "p1", rows: [
    // A term life plan read from its own document: death and TPD.
    row(LIFE, "Example Term Life", "Basic Plan", "Death"),
    row(LIFE, "Example Term Life", "Basic Plan", "Total and permanent disability"),
    row(LIFE, "Example Term Life", "Basic Plan", "Annual premium", "value"),
    // A hospital plan whose benefits are printed in a booklet, and whose cover line is on its schedule.
    row(BOOKLET, "Example Shield", "Hospital Plan", "Daily ward and treatment charges", "reimbursement"),
    row(BOOKLET, "Example Shield", "Hospital Plan", "Surgical benefits", "reimbursement"),
  ], covers: [
    { product: "Example Term Life", cover: "Basic Plan", source: src(LIFE) },
    { product: "Example Shield", cover: "Hospital Plan", source: src(SCHEDULE) },
  ] },
  { id: "p2", rows: [
    // A single-trip travel policy: every row is travel cover ("Rental Vehicle Excess" is not motor insurance).
    row(TRIP, "Example Travel Single Trip", "Classic", "Trip cancellation"),
    row(TRIP, "Example Travel Single Trip", "Classic", "Rental Vehicle Excess"),
  ], covers: [{ product: "Example Travel Single Trip", cover: "Classic", source: src(TRIP) }] },
];
// The household's old Coverage rows, frozen since the switch: they disagree with the table.
const ledgerRows = [
  { policyId: LIFE, eventType: "critical_illness", eventLabel: "Critical illness", origin: "wording", status: "confirmed" },
  { policyId: TRIP, eventType: "motor_damage", eventLabel: "Motor damage", origin: "wording", status: "confirmed" },
  { policyId: EMPTY, eventType: "death", eventLabel: "Death", origin: "wording", status: "confirmed" },
];

async function main() {
  const kinds = await import("@/components/cover-kinds") as Record<string, unknown>;
  const documentTableKinds = kinds.documentTableKinds as ((p: typeof people) => Record<string, string[]>) | undefined;
  const documentFoundLabels = kinds.documentFoundLabels as (rows: typeof ledgerRows) => Record<string, string[]>;
  const found = () => { assert.equal(typeof documentTableKinds, "function", "components/cover-kinds.ts exports documentTableKinds"); return documentTableKinds!(people); };

  await test("T1 the table's kinds for a document, never its stale Coverage rows' (ledger: critical illness)", () => {
    assert.deepEqual(found()[LIFE], ["Death", "Disability"]);
    assert.ok(!found()[LIFE].includes("Critical illness"));
  });
  await test("T2 a travel policy shows Travel only, not the frozen rows' motor cover", () => {
    assert.deepEqual(found()[TRIP], ["Travel"]);
  });
  await test("T3 rows read from a booklet are found for the booklet; the schedule printing the cover shows its cover", () => {
    assert.deepEqual(found()[BOOKLET], ["Hospital and medical"]);
    assert.deepEqual(found()[SCHEDULE], ["Hospital and medical"]);
  });
  await test("T4 a document with no table row or cover has no Found line (even though its Coverage rows list one)", () => {
    assert.equal(found()[EMPTY], undefined);
    assert.ok(!Object.keys(found()).includes(EMPTY));
  });
  await test("T5 a document whose only row is a value or a premium lists nothing", () => {
    const only = documentTableKinds?.([{ id: "p", rows: [row(EMPTY, "Example Endowment", "Basic", "Annual premium", "value")], covers: [] }]) ?? null;
    assert.deepEqual(only, {});
  });
  await test("T6 every kind a document lists is one the table has for that document (same rules as Family)", () => {
    const kindsOfTable = kinds.kindsOfTable as (r: Row[], c: Cover[]) => string[];
    for (const [doc, labels] of Object.entries(found())) {
      const rows = people.flatMap((p) => p.rows.filter((r) => r.source.documentId === doc));
      const covers = people.flatMap((p) => p.covers.filter((c) => c.source.documentId === doc));
      assert.deepEqual(labels, kindsOfTable(rows, covers), doc);
    }
  });
  // TE W1: a schedule prints a cover whose name names no kind; its benefits were read from the separate wording.
  const WORDING = "00000000-0000-0000-0000-00000000f006", SCHED2 = "00000000-0000-0000-0000-00000000f007", OTHER = "00000000-0000-0000-0000-00000000f008";
  const w1 = [
    { id: "p1", rows: [row(WORDING, "Example Life 88", "Basic Plan", "Death"), row(OTHER, "Example Saver", "Basic", "Total and permanent disability")],
      covers: [{ product: "Example Life 88", cover: "Basic Plan", source: src(SCHED2) }, { product: "Example Saver", cover: "Basic", source: src(OTHER) }] },
    // Another person holds the same plan with a critical illness row: never added to Lim Ah Kow's schedule.
    { id: "p2", rows: [row(WORDING, "Example Life 88", "Basic Plan", "Critical illness")], covers: [] },
  ];
  await test("W1 a schedule printing a cover whose rows were read from its wording shows that cover's kinds, not Other", () => {
    const out = documentTableKinds!(w1 as typeof people);
    assert.deepEqual(out[SCHED2], ["Death"]);
    assert.deepEqual(out[WORDING], ["Death", "Critical illness"]);
  });
  await test("W2 a cover takes only its own rows: the schedule's other cover and another person's rows don't spill", () => {
    const out = documentTableKinds!(w1 as typeof people);
    assert.ok(!out[SCHED2].includes("Disability") && !out[SCHED2].includes("Critical illness"));
    assert.deepEqual(out[OTHER], ["Disability"]);
  });
  // Negative control: a household not on the table keeps its Coverage-row labels.
  await test("C1 a household not on the table: Found from its Coverage rows, unchanged", () => {
    assert.deepEqual(documentFoundLabels(ledgerRows), { [LIFE]: ["Critical illness"], [TRIP]: ["Motor damage"], [EMPTY]: ["Death"] });
  });

  const page = readFileSync(path.resolve("app/policies/page.tsx"), "utf8");
  await test("P1 the Documents page reads the benefit table and fills Found from it for a household on it", () => {
    assert.match(page, /fetch\("\/api\/benefit-table"/, "the page never reads the benefit table");
    assert.match(page, /if \(t\?\.enabled\) return setFound\(documentTableKinds\(/, "Found is not filled from the table");
  });
  await test("P2 Coverage rows fill Found only when the table answered that the household is not on it", () => {
    assert.match(page, /if \(t && l\) setFound\(documentFoundLabels\(l\.rows \?\? \[\]\)\)/, "Coverage rows fill Found without the table's answer");
    assert.equal((page.match(/setFound\(/g) ?? []).length, 2, "Found is filled elsewhere too");
  });

  console.log(`documents found-line-table: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  process.exit(failures.length ? 1 : 0);
}
void main();
