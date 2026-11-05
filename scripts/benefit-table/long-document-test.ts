/** A long document is read into the benefit table in parts of consecutive pages, so no one call runs out of output and
 * the whole reading is lost (FWD re-read 5 Nov: 40,651 tokens in, the 24,000-token output cap reached, nothing stored,
 * the earlier reading silently kept). A part that still runs out is read again as two halves; a reading that cannot be
 * finished keeps the earlier one and says so on the document. Made-up English documents, a stand-in model that runs out
 * of output the way a real one does, an in-memory database; no network, nothing paid.
 *   npm run -s benefit-table:long-document-test */
import assert from "node:assert/strict";
import { PART_MAX_CHARS, READ_MAX_OUTPUT, UNREAD_TABLE_NOTE, pageParts, readDocument, type Db } from "@/lib/benefit-table/service";
import type { TableCall, TableModel, TableReply } from "@/lib/benefit-table/model";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const A = "acct-long";
/** A made-up travel booklet: a cover page naming the plan, then pages of a benefit table, each about 4,000 characters. */
function booklet(pages: number): { page: number; text: string }[] {
  const out = [{ page: 1, text: "Harbourline Travel Protect\nPolicy booklet\nPlan: Voyager\nThis booklet sets out the benefits of your plan." }];
  for (let n = 2; n <= pages; n++) {
    const rows = Array.from({ length: 40 }, (_, i) => `Benefit ${n}.${i + 1} Trip item ${n}-${i + 1} lost or damaged while travelling\tup to S$${(n * 100 + i).toLocaleString("en-SG")}`);
    out.push({ page: n, text: `Table of benefits (continued, page ${n})\n` + rows.join("\n") });
  }
  return out;
}

/** Just the statements readDocument sends, against in-memory rows. */
function fakeDb(pages: { page: number; text: string }[], earlier?: { reading: unknown; read_at: string }) {
  const s = {
    readings: new Map<string, { reading: string; model: string }>(earlier ? [["doc", { reading: JSON.stringify(earlier.reading), model: "earlier-model" }]] : []),
    notes: [] as string[], message: "Ready.",
  };
  const db: Db = async (sql, p) => {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT id, display_name, preferred_name FROM family_members")) return [{ id: "p1", display_name: "Nadia Okafor", preferred_name: null }];
    if (q.startsWith("SELECT id, original_filename, processing_status"))
      return [{ id: "doc", account_id: A, original_filename: "harbourline-travel.pdf", processing_status: "ready", product_name: null, insurer: null, document_role: "policy_wording",
        policy_number: null, quarantine_status: "scan_clean", scan_result_detail: null, reading_live: true, scan_live: false }];
    if (q.startsWith("SELECT policy_id, page_number, text FROM policy_pages")) return pages.map((x) => ({ policy_id: "doc", page_number: x.page, text: x.text }));
    if (q.startsWith("INSERT INTO benefit_readings")) { s.readings.set(p[0] as string, { reading: p[2] as string, model: p[3] as string }); return []; }
    if (q.startsWith("SELECT read_at FROM benefit_readings")) return earlier && s.readings.has(p[0] as string) ? [{ read_at: earlier.read_at }] : [];
    if (q.startsWith("UPDATE policies SET processing_message")) {
      if (!s.notes.includes(p[2] as string)) { s.notes.push(p[2] as string); s.message += " " + p[2]; }
      return [];
    }
    throw new Error("fake db: unexpected statement " + q.slice(0, 80));
  };
  return { db, s };
}

/** A stand-in model that lists one row per table line it is shown and runs out of output, as a real one does, when
 * those rows need more than the call's output allowance (about 25 output tokens a row here). */
function lister(o: { tokensPerRow?: number; failPage?: number } = {}) {
  const calls: { pages: number[]; chars: number; maxTokens: number; user: string }[] = [];
  const model: TableModel = { choice: { provider: "anthropic", model: "stand-in" }, async call(c: TableCall): Promise<TableReply> {
    const pages = [...c.user.matchAll(/<page n="(\d+)">\n([\s\S]*?)\n<\/page>/g)].map((m) => ({ page: Number(m[1]), text: m[2] }));
    calls.push({ pages: pages.map((p) => p.page), chars: pages.reduce((n, p) => n + p.text.length, 0), maxTokens: c.maxTokens, user: c.user });
    const rows = pages.flatMap((p) => p.text.split("\n").filter((l) => /S\$/.test(l)).map((line) => ({ page: p.page, line })));
    const output = rows.length * (o.tokensPerRow ?? 25);
    if (output > c.maxTokens || (o.failPage && pages.length === 1 && pages[0].page === o.failPage))
      return { json: null, stopReason: "max_tokens", model: "stand-in", input: 0, output: c.maxTokens, ms: 1 };
    const cover = pages.find((p) => /Plan: Voyager/.test(p.text));
    return { json: {
      document: { kind: "policy_wording", product: cover ? "Harbourline Travel Protect" : null, insurer: null, namedPeople: [], plan: cover ? "Voyager" : null, periodFrom: null, periodTo: null },
      covers: [],
      benefits: rows.map((r) => {
        const [label, figure] = r.line.split("\t");
        return { section: "Table of benefits", column: null, benefit: label.replace(/^Benefit [\d.]+ /, ""), pays: "up_to", value: Number(figure.replace(/[^\d]/g, "")),
          period: null, basis: null, percentOf: null, baseAmount: null, baseQuote: null, cap: null, capQuote: null, conditions: [], page: r.page, quote: r.line };
      }),
    }, stopReason: "end_turn", model: "stand-in", input: 0, output, ms: 1 };
  } };
  return { model, calls };
}

const rowsStored = (s: ReturnType<typeof fakeDb>["s"]) => {
  const stored = JSON.parse(s.readings.get("doc")!.reading) as { document: { benefits: { page: number }[]; document: { plan: string | null } }; pages: { json: { benefits: { page: number }[] } }[] };
  return { stored, rows: [stored.document, ...stored.pages.map((p) => p.json)].flatMap((r) => r.benefits) };
};

async function main() {
  const long = booklet(30); // 29 table pages of 40 rows: 1,160 rows, about 29,000 output tokens in one call
  const totalRows = long.reduce((n, p) => n + p.text.split("\n").filter((l) => /S\$/.test(l)).length, 0);

  await test("L0 in one call, this booklet runs out of output: the failure the parts avoid", async () => {
    assert.ok(totalRows * 25 > READ_MAX_OUTPUT, `${totalRows} rows`);
  });
  await test("L1 pages are split into consecutive parts, none over the part size, every page once and in order", () => {
    const parts = pageParts(long);
    assert.ok(parts.length > 1);
    assert.deepEqual(parts.flat().map((p) => p.page), long.map((p) => p.page));
    for (const part of parts) assert.ok(part.length === 1 || part.reduce((n, p) => n + p.text.length, 0) <= PART_MAX_CHARS, JSON.stringify(part.map((p) => p.page)));
    assert.equal(pageParts([{ page: 1, text: "x".repeat(PART_MAX_CHARS * 2) }, { page: 2, text: "y" }]).length, 2, "a page longer than a part is a part on its own");
  });
  await test("L2 a long booklet is read in parts: no call runs out, every row of every page is stored, the cover page's plan is kept", async () => {
    const f = fakeDb(long), m = lister();
    const r = await readDocument(f.db, m.model, A, "doc");
    assert.equal(r.read, true, r.why);
    assert.ok(m.calls.length > 1 && m.calls.length <= pageParts(long).length, `${m.calls.length} calls`);
    for (const c of m.calls) assert.ok(c.chars <= PART_MAX_CHARS, `call over ${PART_MAX_CHARS}: ${c.chars}`);
    const { stored, rows } = rowsStored(f.s);
    assert.equal(rows.length, totalRows);
    assert.deepEqual([...new Set(rows.map((b) => b.page))].sort((a, b) => a - b), long.slice(1).map((p) => p.page));
    assert.equal(stored.document.document.plan, "Voyager");
    // Each part says which pages it holds, so the reader lists those pages only.
    assert.match(m.calls[1].user, /This document has 30 pages and is read in parts; this part is pages \d+ to \d+\./);
    assert.deepEqual(f.s.notes, []);
  });
  await test("L3 a part that still runs out of output is read again as two halves, and nothing is lost", async () => {
    const f = fakeDb(long), m = lister({ tokensPerRow: 80 }); // a part of ~10 pages now needs ~32,000 tokens
    const r = await readDocument(f.db, m.model, A, "doc");
    assert.equal(r.read, true, r.why);
    assert.ok(m.calls.some((c) => c.pages.length < 10), "halves were read");
    assert.equal(rowsStored(f.s).rows.length, totalRows);
  });
  await test("L4 a reading that cannot be finished keeps the earlier reading and says so on the document", async () => {
    const earlier = { document: { kind: "policy_wording", product: "Harbourline Travel Protect", insurer: null, namedPeople: [], plan: "Voyager", periodFrom: null, periodTo: null }, covers: [], benefits: [] };
    const f = fakeDb(long, { reading: { document: earlier, pages: [] }, read_at: "2026-10-22T08:00:00Z" });
    const m = lister({ failPage: 17, tokensPerRow: 400 }); // page 17 alone still runs out
    const r = await readDocument(f.db, m.model, A, "doc");
    assert.equal(r.read, false);
    assert.match(r.why ?? "", /did not finish \(max_tokens, pages? 17/);
    assert.equal(f.s.readings.get("doc")!.model, "earlier-model", "the earlier reading is kept");
    assert.deepEqual(f.s.notes, [UNREAD_TABLE_NOTE("22 October 2026")]);
    assert.match(f.s.message, /still shows the reading from 22 October 2026/);
    // Reading again and failing again does not repeat the note.
    await readDocument(f.db, lister({ failPage: 17, tokensPerRow: 400 }).model, A, "doc");
    assert.equal(f.s.notes.length, 1);
  });
  await test("L5 a document never read before that cannot be read says the table has no rows from it yet", async () => {
    const f = fakeDb(booklet(3));
    const r = await readDocument(f.db, lister({ tokensPerRow: 1_000 }).model, A, "doc");
    assert.equal(r.read, false);
    assert.deepEqual(f.s.notes, [UNREAD_TABLE_NOTE(null)]);
    assert.equal(f.s.readings.size, 0);
  });
  await test("L6 a short document is read in one call with the prompt as before, no part note", async () => {
    const short = booklet(4), f = fakeDb(short), m = lister();
    const r = await readDocument(f.db, m.model, A, "doc");
    assert.deepEqual(r, { read: true, pagesReread: 0 });
    assert.equal(m.calls.length, 1);
    assert.doesNotMatch(m.calls[0].user, /read in parts/);
    assert.equal(rowsStored(f.s).rows.length, 3 * 40);
  });

  console.log(`benefit-table long document: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  if (failures.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
