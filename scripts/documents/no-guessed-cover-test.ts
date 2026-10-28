/** Documents page: a document card lists only cover the household's documents establish. A Coverage row seeded only
 * from a plan type's usual benefits (a schedule line, still proposed) is never shown as cover, in any wording
 * ("Plans like this usually include ..."). A plan type or reference wording is not proof of cover.
 * Made-up rows; pure logic plus a source check of the page. No database, no network, no model.
 *   npm run -s documents:no-guessed-cover-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

const CERT = "00000000-0000-0000-0000-00000000c001", WORDING = "00000000-0000-0000-0000-00000000c002", MIXED = "00000000-0000-0000-0000-00000000c003";
type Row = { policyId: string | null; eventType: string; eventLabel: string; origin: string; status: string };
const r = (policyId: string | null, eventType: string, eventLabel: string, origin: string, status: string): Row => ({ policyId, eventType, eventLabel, origin, status });
const rows: Row[] = [
  // Lim Ah Kow's Example Insurance certificate: its schedule line only; the plan type's usual benefits, proposed.
  r(CERT, "accident_medical_expense", "Accident medical expenses", "schedule", "proposed"),
  r(CERT, "terminal_illness", "Terminal illness", "schedule", "proposed"),
  // Tan Mei Ling's policy wording: read from the document itself.
  r(WORDING, "death", "Death", "wording", "confirmed"),
  r(WORDING, "critical_illness", "Critical illness", "wording", "confirmed"),
  r(WORDING, "death", "Death", "wording", "confirmed"), // a second row of the same benefit is listed once
  // One document with both: a confirmed benefit and a guessed one beside it; a rejected row; a household's own entry.
  r(MIXED, "fracture", "Fracture", "schedule", "confirmed"),
  r(MIXED, "accident_medical_expense", "Accident medical expenses", "schedule", "proposed"),
  r(MIXED, "dismemberment", "Dismemberment", "wording", "rejected"),
  r(MIXED, "hospital_daily_cash", "Hospital daily cash", "person", "proposed"),
  r(null, "death", "Death", "wording", "confirmed"), // no document: listed under none
];

async function main() {
  const kinds = await import("@/components/cover-kinds") as Record<string, unknown>;
  const documentFoundLabels = kinds.documentFoundLabels as ((rows: Row[]) => Record<string, string[]>) | undefined;
  const found = () => { assert.equal(typeof documentFoundLabels, "function", "components/cover-kinds.ts exports documentFoundLabels"); return documentFoundLabels!(rows); };

  await test("G1 a document with only plan-type guesses lists nothing", () => {
    assert.deepEqual(found()[CERT] ?? [], []);
  });
  await test("G2 a guessed benefit beside a confirmed one is not listed", () => {
    assert.ok(!(found()[MIXED] ?? []).includes("Accident medical expenses"), JSON.stringify(found()[MIXED]));
  });
  await test("G3 a rejected row is not listed", () => {
    assert.ok(!(found()[MIXED] ?? []).includes("Dismemberment"));
  });
  // Negative controls: what the documents establish is still shown.
  await test("C1 confirmed wording benefits are listed, once each, in order", () => {
    assert.deepEqual(found()[WORDING], ["Death", "Critical illness"]);
  });
  await test("C2 a confirmed schedule row and the household's own entry are listed", () => {
    assert.deepEqual(found()[MIXED], ["Fracture", "Hospital daily cash"]);
  });
  await test("C3 a row with no document is listed under none", () => {
    assert.deepEqual(Object.keys(found()).sort(), [MIXED, WORDING].sort());
  });

  // The page draws its card line from that list alone, and never words a guess as cover.
  const page = readFileSync(path.resolve("app/policies/page.tsx"), "utf8");
  await test("P1 the Documents page has no 'usually include' guess line", () => {
    assert.doesNotMatch(page, /usually include/i, "the page words a plan-type guess as cover");
    assert.doesNotMatch(page, /document-to-confirm/, "the page still draws a to-confirm guess line");
    assert.doesNotMatch(page, /doesn&rsquo;t confirm/, "the page still names unconfirmed cover");
  });
  await test("P2 the Documents page fills its Found line from documentFoundLabels", () => {
    assert.match(page, /setFound\(documentFoundLabels\(/, "Found is not filled from documentFoundLabels");
    assert.match(page, /<b>Found<\/b> \{foundLine\(labels\)\}/, "the Found line is missing");
  });

  console.log(`documents no-guessed-cover: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  process.exit(failures.length ? 1 : 0);
}
void main();
