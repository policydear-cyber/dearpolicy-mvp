/** A document's letterhead insurer (lib/documents/fact-check.ts letterheadInsurer), used when the reader gave no insurer
 * or one the document does not print, and when reading fell back to plain code. A line carrying a money figure, a
 * thousands figure or a percentage is a row of the document, never its insurer (new-user walkthrough, 31 Oct: an
 * Australian health fund's membership certificate was filed under the insurer "General dental $900"). Made-up insurers
 * and figures in several markets; pure logic, no database, no network, no model.
 *   npm run -s documents:letterhead-insurer-test */
import assert from "node:assert/strict";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const { letterheadInsurer } = await import("@/lib/documents/fact-check");
  const page = (text: string) => [{ pageNumber: 1, text }];
  const cases: [string, string, string | null][] = [
    ["a health fund's name is its letterhead", "Coral Bay Health Fund\nMembership certificate\nGeneral dental\t$900", "Coral Bay Health Fund"],
    ["a table row with a sign and figure is never the insurer (A$)", "Membership certificate\nGeneral dental\t$900\nOptical\t$300", null],
    ["a row with a code and a thousands figure is skipped for the company line below it", "Trauma Cover\tAUD 150,000\nWattle Life Insurance Limited", "Wattle Life Insurance Limited"],
    ["a row in pounds is never the insurer", "Life cover\t£250,000\nNorthwind Mutual", "Northwind Mutual"],
    ["a row in ringgit is never the insurer", "Hospital and surgical\tRM 1,500,000\nTakaful Harmoni Berhad", "Takaful Harmoni Berhad"],
    ["a percentage row is never the insurer", "Life cover 100%\nKoru Life NZ Limited", "Koru Life NZ Limited"],
    ["a figure with no sign but thousands grouping is never the insurer", "General cover 25.000\nSeguros Atlántico General", "Seguros Atlántico General"],
    ["a letterhead with its registration number is still the insurer", "Example Life Assurance Company Limited (Reg. No. 1908 00002M)\nPolicy Schedule", "Example Life Assurance Company Limited (Reg. No. 1908 00002M)"],
    ["a friendly society is an insurer", "Harbourside Friendly Society\nCertificate", "Harbourside Friendly Society"],
  ];
  for (const [name, text, want] of cases) test(name, () => assert.equal(letterheadInsurer(page(text)), want));
  console.log(`letterhead insurer: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  process.exit(failures.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
