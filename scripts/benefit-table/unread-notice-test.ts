/** Coverage's "not read yet" notice (lib/benefit-table/service.ts documentState, components/benefit-table-coverage.tsx):
 * a document is "waiting" only while DearPolicy is genuinely reading it. A receipt or letter (which intake never reads
 * into the table), or a document whose table reading was never stored, is never described as unread and never sent to
 * Read again (which re-reads and re-links every section, at a model cost); it is named plainly as having no benefits to
 * show. A document the app could not read keeps its "could not be read" notice. In-memory rows, made-up names, no model.
 *   npm run benefit-table:unread-notice-test */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as service from "@/lib/benefit-table/service";
import { documentName } from "@/lib/policies/inventory";
import { BenefitTableCoverage, type BenefitTableData } from "@/components/benefit-table-coverage";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve().then(fn).then(() => { passed++; }, (error) => { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); });
}

const A = "acct-lim";
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const DAY = 24 * 3600_000;
type Policy = { id: string; original_filename: string; processing_status: string; document_role: string | null; product_name: string | null;
  insurer: string | null; policy_number: string | null; processing_completed_at: string | null };
const policy = (id: string, o: Partial<Policy>): Policy => ({ id, original_filename: `${id}.pdf`, processing_status: "ready", document_role: "personal_schedule",
  product_name: null, insurer: "Example Insurance", policy_number: null, processing_completed_at: ago(3 * DAY), ...o });

const reading = (covers: unknown[]) => ({ document: { document: { kind: "personal_proof", product: "Example Shield", insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null },
  covers, benefits: [] }, pages: [] });

const policies: Policy[] = [
  policy("schedule", { product_name: "Example Shield" }),                                                    // read, with a cover
  policy("empty-read", { product_name: "Example Travel Guard", document_role: "product_summary" }),          // read, nothing to place
  policy("receipt", { document_role: "premium_receipt", product_name: "Example Shield receipt" }),            // never read into the table
  policy("letter", { document_role: "insurer_letter", product_name: null, original_filename: "Letter from Example Insurance.pdf" }),
  policy("summary", { original_filename: "0b6f3c1e-1a2b-4c3d-8e9f-0123456789ab.pdf", document_role: "product_summary", product_name: null, policy_number: "TRV-000-4821" }), // reading never stored
  policy("fresh", { product_name: "Example Critical Care", processing_completed_at: ago(60_000) }),         // ready a minute ago, being read now
  policy("intake", { product_name: "Example Hospital Plan", processing_status: "extracting", processing_completed_at: null }), // still in intake
  policy("legacy", { product_name: "Example Term Life", processing_completed_at: null }),                    // no completion time known
  policy("scan", { product_name: "Example Blurry Scan", processing_status: "failed" }),                      // could not be read
  policy("unchecked", { product_name: "Example Unchecked Pages" }),                                          // ready, but no page could be checked
];
const pages = [
  ...policies.filter((p) => p.id !== "unchecked").map((p) => ({ policy_id: p.id, page_number: 1, text: "SCHEDULE\nLim Ah Kow\tS$100,000", extraction_method: "native" })),
  { policy_id: "unchecked", page_number: 1, text: "garbled", extraction_method: "unchecked" },
];
const readings = new Map<string, unknown>([
  ["schedule", reading([{ person: "Lim Ah Kow", product: "Example Shield", cover: "Hospital", plan: null, sumInsured: 100000, asOf: null, page: 1, quote: "Lim Ah Kow\tS$100,000" }])],
  ["empty-read", reading([])],
  ["scan", reading([])], // a reading kept from before the document failed
]);

const db: service.Db = async (sql, p) => {
  const q = sql.replace(/\s+/g, " ").trim();
  if (q.startsWith("SELECT id, display_name, preferred_name FROM family_members")) return [{ id: "p1", display_name: "Lim Ah Kow", preferred_name: null }];
  if (q.startsWith("SELECT id, original_filename, processing_status")) return p[0] === A ? policies : [];
  if (q.startsWith("SELECT policy_id, page_number, text FROM policy_pages"))
    return pages.filter((x) => (p[1] as string[]).includes(x.policy_id) && x.extraction_method !== "unchecked");
  if (q.startsWith("SELECT policy_id, reading FROM benefit_readings")) return [...readings].map(([policy_id, r]) => ({ policy_id, reading: JSON.stringify(r) }));
  if (q.startsWith("SELECT section_key, cover_key, why, chosen_by FROM benefit_links")) return [];
  if (q.startsWith("SELECT family_member_id, cover_key, status, sum_insured, updated_at FROM benefit_confirmations")) return [];
  throw new Error("fake db: unexpected statement " + q.slice(0, 80));
};

async function main() {
  const { documents, table } = await service.tableFor(db, A);
  const state = Object.fromEntries(documents.map((d) => [d.id, d.state]));

  await test("a receipt or a letter, which intake never reads into the table, is not waiting", () => {
    assert.equal(state.receipt, "no_table");
    assert.equal(state.letter, "no_table");
  });
  await test("a document whose table reading was never stored, long after it was ready, is not waiting", () => {
    assert.equal(state.summary, "no_table");
  });
  await test("a document in intake is waiting (it is being read), not 'could not be read'", () => {
    assert.equal(state.intake, "waiting");
  });
  await test("controls: a document ready a minute ago is waiting; one with no known completion time stays waiting", () => {
    assert.equal(state.fresh, "waiting");
    assert.equal(state.legacy, "waiting");
  });
  await test("controls: a read document is read, also when its reading had nothing to place", () => {
    assert.equal(state.schedule, "read");
    assert.equal(state["empty-read"], "read");
    assert.equal(table.people.find((p) => p.id === "p1")!.covers.length, 1);
  });
  await test("controls: a document that failed, or has no page that could be checked, keeps 'not readable'", () => {
    assert.equal(state.scan, "not_readable");
    assert.equal(state.unchecked, "not_readable");
  });
  await test("the window: a reading not stored 11 minutes after ready is no longer waiting; at 9 minutes it is", () => {
    const ds = (service as Record<string, unknown>).documentState as ((d: unknown, r: boolean, now?: number) => string) | undefined;
    assert.ok(ds, "documentState is exported");
    const doc = (min: number) => ({ status: "ready", pages: 2, file: { document_role: "personal_schedule", completed_at: ago(min * 60_000) } });
    assert.equal(ds(doc(9), false, NOW), "waiting");
    assert.equal(ds(doc(11), false, NOW), "no_table");
    assert.equal(ds(doc(11), true, NOW), "read");
    assert.equal(ds({ status: "queued", pages: 0, file: { document_role: null, completed_at: null } }, false, NOW), "waiting", "Read again puts a document back in the queue");
  });

  // What the Coverage page says, with each document named the way the route names it.
  const named = documents.map((d) => ({ id: d.id, state: d.state as BenefitTableData["documents"][number]["state"],
    name: (d as { file?: Parameters<typeof documentName>[0] }).file ? documentName((d as unknown as { file: Parameters<typeof documentName>[0] }).file) : d.name }));
  const html = renderToStaticMarkup(createElement(BenefitTableCoverage, { data: { enabled: true, people: [], documents: named, unmatchedCovers: [], illustrationCovers: [], unlinkedSections: [] } }));
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;/g, "'").replace(/\s+/g, " ");

  await test("the page never tells the household to Read again a document that will never give rows", () => {
    assert.ok(!/Read again/i.test(text), text);
    assert.ok(!/not been read/i.test(text), text);
  });
  await test("a document with no table is named plainly as having no benefits to show, by its readable name", () => {
    assert.match(text, /Example Shield receipt, Letter from Example Insurance, Example Insurance product summary \(ending 4821\) have no benefits to show here\./);
    assert.ok(!/0b6f3c1e/.test(text), "never the made-up file name");
  });
  await test("controls: documents being read and documents that could not be read keep their notices", () => {
    assert.match(text, /3 documents are still being read\. Example Critical Care, Example Hospital Plan, Example Term Life\./);
    assert.match(text, /Some documents could not be read\. Example Blurry Scan, Example Unchecked Pages/);
  });

  console.log(`${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("FAIL " + f);
  if (failures.length) process.exit(1);
}
main().catch((error) => { console.error(error); process.exit(1); });
