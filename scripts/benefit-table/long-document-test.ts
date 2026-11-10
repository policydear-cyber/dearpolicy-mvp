/** A long document is read into the benefit table in parts of consecutive pages, so no one call runs out of output and
 * the whole reading is lost (FWD re-read 5 Nov: 40,651 tokens in, the 24,000-token output cap reached, nothing stored,
 * the earlier reading silently kept). A part that still runs out is read again as two halves; a reading that cannot be
 * finished keeps the earlier one and says so on the document. Made-up English documents, a stand-in model that runs out
 * of output the way a real one does, an in-memory database; no network, nothing paid.
 *   npm run -s benefit-table:long-document-test */
import assert from "node:assert/strict";
import { NOT_READ_TABLE_NOTE, MIN_CALL_MS, PAGE_MAX_OUTPUT, PART_MAX_CHARS, PART_MAX_OUTPUT, READ_MAX_OUTPUT, SAVE_MARGIN_MS, TOKENS_PER_CHAR, TOKENS_PER_FIGURE, UNREAD_TABLE_NOTE, expectedOutput, pageParts, readDocument, type Db } from "@/lib/benefit-table/service";
import type { TableCall, TableModel, TableReply } from "@/lib/benefit-table/model";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const A = "acct-long";
/** A made-up travel booklet: a cover page naming the plan, then pages of a benefit table of `rows` rows each (40: about
 * 4,000 characters a page). */
function booklet(pages: number, rowsPerPage = 40): { page: number; text: string }[] {
  const out = [{ page: 1, text: "Harbourline Travel Protect\nPolicy booklet\nPlan: Voyager\nThis booklet sets out the benefits of your plan." }];
  for (let n = 2; n <= pages; n++) {
    const rows = Array.from({ length: rowsPerPage }, (_, i) => `Benefit ${n}.${i + 1} Trip item ${n}-${i + 1} lost or damaged while travelling\tup to S$${(n * 100 + i).toLocaleString("en-SG")}`);
    out.push({ page: n, text: `Table of benefits (continued, page ${n})\n` + rows.join("\n") });
  }
  return out;
}

/** A booklet whose plan table starts at the foot of page 10 (its header and first row) and runs on over page 11. */
function planBooklet(): { page: number; text: string }[] {
  const pages = booklet(20);
  // The table starts on the last page of the first part (pageParts) and runs on into the second.
  const b = pageParts(pages)[0].at(-1)!.page;
  const header = "\nBenefit\tClassic\tBusiness\tPremium\nMedical expenses\tS$100,000\tS$250,000\tS$500,000";
  const at = pages.findIndex((p) => p.page === b);
  pages[at] = { page: b, text: pages[at].text.slice(0, pages[at].text.length - header.length - 200) + header };
  pages[at + 1] = { page: b + 1, text: "Emergency evacuation\tS$50,000\tS$150,000\tS$300,000\nTrip postponement\tS$500\tS$1,000\tS$1,500\n" + pages[at + 1].text };
  assert.equal(pageParts(pages)[0].at(-1)!.page, b, "the table's header ends the first part");
  return pages;
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
    if (q.startsWith("SELECT 1 FROM benefit_readings")) return s.readings.has(p[0] as string) ? [{ "?column?": 1 }] : [];
    if (q.startsWith("SELECT read_at FROM benefit_readings")) return earlier && s.readings.has(p[0] as string) ? [{ read_at: earlier.read_at }] : [];
    if (q.startsWith("UPDATE policies SET processing_message=nullif(")) {
      const prefix = String(p[2]).replace(/%$/, "");
      s.notes = s.notes.filter((n) => !n.startsWith(prefix));
      s.message = s.message.replace(new RegExp("\\s*" + prefix + "[^.]*\\.", "g"), "");
      return [];
    }
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
function lister(o: { tokensPerRow?: number; failPage?: number; plans?: boolean; lateNames?: boolean; printedPlan?: boolean } = {}) {
  const calls: { pages: number[]; chars: number; maxTokens: number; user: string; context: number | null; output: number }[] = [];
  const model: TableModel = { choice: { provider: "anthropic", model: "stand-in" }, async call(c: TableCall): Promise<TableReply> {
    const context = Number(c.user.match(/do not list rows from page (\d+)/)?.[1] ?? NaN);
    const shown = [...c.user.matchAll(/<page n="(\d+)">\n([\s\S]*?)\n<\/page>/g)].map((m) => ({ page: Number(m[1]), text: m[2] }));
    // A reader does as the note says: the context page's rows are not listed.
    const pages = shown.filter((p) => p.page !== context);
    const rows = pages.flatMap((p) => p.text.split("\n").filter((l) => /S\$/.test(l)).map((line) => ({ page: p.page, line })));
    const output = rows.length * (o.tokensPerRow ?? 25);
    calls.push({ pages: pages.map((p) => p.page), chars: pages.reduce((n, p) => n + p.text.length, 0), maxTokens: c.maxTokens, user: c.user, context: Number.isNaN(context) ? null : context, output });
    if (output > c.maxTokens || (o.failPage && pages.some((p) => p.page === o.failPage)))
      return { json: null, stopReason: "max_tokens", model: "stand-in", input: 0, output: c.maxTokens, ms: 1 };
    const cover = pages.find((p) => /Plan: Voyager/.test(p.text));
    const last = pages.some((p) => /Insured person: Ruth Adeyemi/.test(p.text));
    // A naive reader: the first "Plan:" line it sees, a brochure's or a schedule's.
    const printedPlan = pages.map((p) => p.text.match(/^Plan: (\w+)/m)?.[1]).find(Boolean) ?? null;
    const person = pages.map((p) => p.text.match(/^Insured person: (.+)$/m)?.[1]).find(Boolean);
    // A plan table's columns, seen on a page shown (the context page too) or named in the note.
    const planColumns = shown.some((p) => /Classic\tBusiness\tPremium/.test(p.text));
    return { json: {
      document: { kind: "policy_wording", product: cover || (!o.lateNames && false) ? "Harbourline Travel Protect" : pages.some((p) => p.page === 1) ? "Harbourline Travel Protect" : null, insurer: null,
        namedPeople: o.printedPlan ? (person ? [person] : []) : last ? ["Ruth Adeyemi"] : [], plan: o.printedPlan ? printedPlan : o.lateNames ? (last ? "Voyager" : null) : cover ? "Voyager" : null, periodFrom: null, periodTo: null },
      covers: [],
      benefits: rows.map((r) => {
        const cells = r.line.split("\t");
        const several = cells.length > 2;
        if (o.plans && several && !planColumns) throw new Error("stand-in asked to read a plan row with no plan columns in sight");
        const figure = several ? cells[2] : cells[1];
        return { section: "Table of benefits", column: several ? "Business" : null, benefit: cells[0].replace(/^Benefit [\d.]+ /, ""), pays: "up_to", value: Number(figure.replace(/[^\d]/g, "")),
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
    assert.match(m.calls[1].user, /This document has 30 pages and is read in parts; this part is (?:pages \d+ to \d+|page \d+)\./);
    assert.deepEqual(f.s.notes, []);
  });
  await test("L3 a part that still runs out of output is read again as two halves, and nothing is lost", async () => {
    // Sparse pages are planned in parts of several pages; here each row needs far more output than planned, so the first part runs out.
    const sparse = booklet(30, 10), sparseRows = 29 * 10;
    const f = fakeDb(sparse), m = lister({ tokensPerRow: 400 });
    const r = await readDocument(f.db, m.model, A, "doc");
    assert.equal(r.read, true, r.why);
    assert.ok(m.calls[0].output > READ_MAX_OUTPUT, "the first part ran out");
    assert.ok(m.calls[1].pages.length < m.calls[0].pages.length, "halves were read");
    assert.equal(rowsStored(f.s).rows.length, sparseRows);
  });
  await test("L4 a reading that cannot be finished keeps the earlier reading and says so on the document", async () => {
    const earlier = { document: { kind: "policy_wording", product: "Harbourline Travel Protect", insurer: null, namedPeople: [], plan: "Voyager", periodFrom: null, periodTo: null }, covers: [], benefits: [] };
    const f = fakeDb(long, { reading: { document: earlier, pages: [] }, read_at: "2026-10-22T08:00:00Z" });
    const r = await readDocument(f.db, lister({ failPage: 17 }).model, A, "doc"); // any part holding page 17 runs out
    assert.equal(r.read, false);
    assert.match(r.why ?? "", /did not finish/);
    assert.equal(f.s.readings.get("doc")!.model, "earlier-model", "the earlier reading is kept");
    assert.deepEqual(f.s.notes, [UNREAD_TABLE_NOTE("22 October 2026")]);
    assert.match(f.s.message, /still shows the reading from 22 October 2026/);
    // Reading again and failing again does not repeat the note.
    await readDocument(f.db, lister({ failPage: 17 }).model, A, "doc");
    assert.equal(f.s.notes.length, 1);
    // A later reading that finishes takes the note away (TE pr364).
    const ok = await readDocument(f.db, lister().model, A, "doc");
    assert.equal(ok.read, true);
    assert.deepEqual(f.s.notes, []);
    assert.doesNotMatch(f.s.message, /could not be read/);
  });
  await test("L5 a document never read before that cannot be read says the table has no rows from it yet", async () => {
    const f = fakeDb(booklet(3));
    const r = await readDocument(f.db, lister({ tokensPerRow: 1_000 }).model, A, "doc");
    assert.equal(r.read, false);
    assert.deepEqual(f.s.notes, [UNREAD_TABLE_NOTE(null)]);
    assert.equal(f.s.readings.size, 0);
  });
  await test("L6 a short document is read in one call with the prompt as before, no part note", async () => {
    const short = booklet(4, 10), f = fakeDb(short), m = lister();
    const r = await readDocument(f.db, m.model, A, "doc");
    assert.deepEqual(r, { read: true, pagesReread: 0 });
    assert.equal(m.calls.length, 1);
    assert.doesNotMatch(m.calls[0].user, /read in parts/);
    assert.equal(rowsStored(f.s).rows.length, 3 * 10);
  });

  await test("L7 no document costs more than 2 x its parts + 4 calls, however often its parts run out (Critic R364 M2)", async () => {
    for (const n of [30, 60]) {
      const pages = booklet(n), m = lister({ tokensPerRow: 1_000 }); // every multi-page part runs out
      const r = await readDocument(fakeDb(pages).db, m.model, A, "doc");
      assert.equal(r.read, false);
      assert.ok(m.calls.length <= 2 * pageParts(pages).length + 4, `${n} pages: ${m.calls.length} calls`);
    }
    // A dense document: once a second part of full size runs out, the parts still to come are made smaller too, so each is
    // not paid for twice.
    const m = lister({ tokensPerRow: 400 });
    await readDocument(fakeDb(booklet(30, 10)).db, m.model, A, "doc");
    const ranOut = m.calls.filter((c) => c.output > READ_MAX_OUTPUT).length;
    assert.ok(ranOut <= 2, `${ranOut} calls ran out`);
    // One dense page in a long document: only its part is halved; every other part is read at its size (TE #404: 37 calls
    // for 50 pages instead of about 8).
    const pages = booklet(50, 10), plain = lister();
    const dense: TableModel = { choice: plain.model.choice, async call(c) {
      const context = Number(c.user.match(/do not list rows from page (\d+)/)?.[1] ?? NaN);
      const shown = [...c.user.matchAll(/<page n="(\d+)">/g)].map((x) => Number(x[1])).filter((n) => n !== context);
      if (shown.includes(20) && shown.length > 2) { plain.calls.push({ pages: shown, chars: 0, maxTokens: c.maxTokens, user: c.user, context: null, output: c.maxTokens + 1 }); return { json: null, stopReason: "max_tokens", model: "stand-in", input: 0, output: c.maxTokens, ms: 1 }; }
      return plain.model.call(c);
    } };
    const rd = await readDocument(fakeDb(pages).db, dense, A, "doc");
    assert.equal(rd.read, true, rd.why);
    const parts = pageParts(pages).length, readingCalls = plain.calls.filter((c) => c.maxTokens === READ_MAX_OUTPUT).length;
    assert.ok(readingCalls <= parts + 2 * Math.ceil(Math.log2(50)), `one dense page: ${readingCalls} reading calls for ${parts} parts`);
  });
  await test("L8 each part after the first is shown the page before for context only, with the plan columns found so far (Critic R364 H1)", async () => {
    const m = lister({ plans: true });
    const f = fakeDb(planBooklet());
    const r = await readDocument(f.db, m.model, A, "doc");
    assert.equal(r.read, true, r.why);
    const later = m.calls.slice(1);
    assert.ok(later.length && later.every((c) => c.context === c.pages[0] - 1), JSON.stringify(later.map((c) => [c.context, c.pages[0]])));
    // The page before shows the table's header; the columns rows were read under so far are named too.
    assert.match(later[0].user, /Classic\tBusiness\tPremium/);
    assert.match(later[0].user, /Plan or person columns found on earlier pages, for "column" when a table here runs on under them: "Business"\./);
    // The run-on rows are read under their plan column.
    const { rows } = rowsStored(f.s);
    const evacuation = rows.find((b) => (b as { quote?: string }).quote?.startsWith("Emergency evacuation")) as { column?: string; value?: number } | undefined;
    assert.deepEqual([evacuation?.column, evacuation?.value], ["Business", 150_000]);
    // No row is stored twice, and none from a part's context page.
    const keys = rows.map((b) => `${b.page}|${(b as { quote?: string }).quote}|${(b as { column?: string }).column}`);
    assert.equal(new Set(keys).size, keys.length);
  });
  await test("L9 the document's own facts are merged across parts: a plan and a person printed only on a later page are kept (TE pr364)", async () => {
    const late = booklet(30);
    late[0] = { page: 1, text: "Harbourline Travel Protect\nPolicy booklet\nThis booklet sets out the benefits of your plan." };
    late[29] = { page: 30, text: late[29].text + "\nInsured person: Ruth Adeyemi\nPlan: Voyager" };
    const f = fakeDb(late), m = lister({ lateNames: true });
    assert.equal((await readDocument(f.db, m.model, A, "doc")).read, true);
    const doc = rowsStored(f.s).stored.document.document as { plan: string | null; namedPeople?: string[]; product: string | null };
    assert.equal(doc.plan, "Voyager");
    assert.equal(doc.product, "Harbourline Travel Protect");
    assert.deepEqual(doc.namedPeople, ["Ruth Adeyemi"]);
  });
  await test("L11 a brochure line in one part never outranks the schedule that names the insured person; parts that name people and disagree store no plan (TE pr364 PLANPICK)", async () => {
    const pick = booklet(30);
    pick[0] = { page: 1, text: "Harbourline Travel Protect\nPolicy booklet\nThis booklet sets out the benefits of your plan." };
    pick[1] = { page: 2, text: pick[1].text + "\nPlan: Classic is our most popular choice." };
    pick[29] = { page: 30, text: pick[29].text + "\nPolicy schedule\nInsured person: Ruth Adeyemi\nPlan: Elite" };
    let f = fakeDb(pick), m = lister({ printedPlan: true });
    assert.equal((await readDocument(f.db, m.model, A, "doc")).read, true);
    assert.ok(m.calls.length > 1, "read in parts");
    let doc = rowsStored(f.s).stored.document.document as { plan: string | null; namedPeople?: string[] };
    assert.equal(doc.plan, "Elite");
    assert.deepEqual(doc.namedPeople, ["Ruth Adeyemi"]);
    // Two parts that each name a person and a different plan: no plan is stored, so plan columns stay held.
    const both = pick.map((p) => ({ ...p }));
    both[1] = { page: 2, text: both[1].text + "\nInsured person: Sam Okoro" };
    f = fakeDb(both); m = lister({ printedPlan: true });
    assert.equal((await readDocument(f.db, m.model, A, "doc")).read, true);
    doc = rowsStored(f.s).stored.document.document as { plan: string | null; namedPeople?: string[] };
    assert.equal(doc.plan, null);
    assert.deepEqual([...(doc.namedPeople ?? [])].sort(), ["Ruth Adeyemi", "Sam Okoro"]);
    // No part names a person and two parts print different plans: none is stored either.
    const none = pick.map((p) => ({ ...p }));
    none[29] = { page: 30, text: booklet(30)[29].text + "\nPlan: Elite" };
    f = fakeDb(none); m = lister({ printedPlan: true });
    assert.equal((await readDocument(f.db, m.model, A, "doc")).read, true);
    assert.equal((rowsStored(f.s).stored.document.document as { plan: string | null }).plan, null);
  });
  await test("L10 the check drops a row read with no plan column whose line prints a figure for each plan (Critic R364 H1)", async () => {
    const { checkReading } = await import("@/lib/benefit-table/check");
    const doc = { id: "doc", name: "harbourline-travel.pdf", readable: true, people: [], pages: [{ page: 11, text: "Emergency evacuation\tS$50,000\tS$150,000\tS$300,000\nBaggage delay\tS$100" }] };
    const row = (benefit: string, value: number, quote: string, column: string | null) => ({ section: null, column, benefit, pays: "up_to", value, period: null, basis: null, percentOf: null,
      baseAmount: null, baseQuote: null, cap: null, capQuote: null, conditions: [], page: 11, quote });
    const read = checkReading(doc as never, { document: { kind: "policy_wording", product: null, insurer: null, namedPeople: [], plan: null }, covers: [], benefits: [
      row("Emergency evacuation", 300_000, "Emergency evacuation\tS$50,000\tS$150,000\tS$300,000", null),
      row("Emergency evacuation", 150_000, "Emergency evacuation\tS$50,000\tS$150,000\tS$300,000", "Business"),
      row("Baggage delay", 100, "Baggage delay\tS$100", null),
    ] });
    assert.deepEqual(read.benefits.map((b) => [b.benefit, b.column, b.value]), [["Emergency evacuation", "Business", 150_000], ["Baggage delay", null, 100]]);
    assert.ok(read.dropped.some((d) => /several plans' figures/.test(d.why)));
  });

  await test("L12 two-plan rows and two-line quotes read with no plan column are dropped; a rate and its limit stay (Critic R364)", async () => {
    const { checkReading } = await import("@/lib/benefit-table/check");
    const text = ["Trip cancellation            S$5,000     S$10,000", "Baggage delay                S$200       S$500",
      "Emergency evacuation         S$50,000    S$150,000    S$300,000", "Hospital cash per day        S$50        S$100        S$200",
      "Hospital allowance           RM200 per day      RM8,000", "Lost passport                S$500"].join("\n");
    const doc = { id: "doc", name: "harbourline-travel.pdf", readable: true, people: [], pages: [{ page: 11, text }] };
    const row = (benefit: string, value: number, quote: string, column: string | null = null) => ({ section: null, column, benefit, pays: "up_to", value, period: null, basis: null, percentOf: null,
      baseAmount: null, baseQuote: null, cap: null, capQuote: null, conditions: [], page: 11, quote });
    const read = checkReading(doc as never, { document: { kind: "policy_wording", product: null, insurer: null, namedPeople: [], plan: null }, covers: [], benefits: [
      row("Trip cancellation", 10_000, "Trip cancellation            S$5,000     S$10,000"),
      row("Trip cancellation", 5_000, "Trip cancellation            S$5,000     S$10,000"),
      row("Baggage delay", 500, "Baggage delay                S$200       S$500"),
      row("Emergency evacuation", 300_000, "Emergency evacuation         S$50,000    S$150,000    S$300,000\nHospital cash per day        S$50        S$100        S$200"),
      row("Trip cancellation", 10_000, "Trip cancellation            S$5,000     S$10,000", "Superior"),
      row("Hospital allowance", 8_000, "Hospital allowance           RM200 per day      RM8,000"),
      row("Lost passport", 500, "Lost passport                S$500"),
    ] });
    assert.deepEqual(read.benefits.map((b) => [b.benefit, b.column, b.value]),
      [["Trip cancellation", "Superior", 10_000], ["Hospital allowance", null, 8_000], ["Lost passport", null, 500]]);
    assert.equal(read.dropped.filter((d) => /several plans' figures/.test(d.why)).length, 4);
  });

  await test("L13 slash plan figures and two plans' daily rates read with no plan column are dropped (Critic R364)", async () => {
    const { checkReading } = await import("@/lib/benefit-table/check");
    const lines = ["Medical expenses S$100,000 / S$250,000 / S$500,000", "Trip cancellation S$5,000 / S$10,000", "Curtailment S$5,000/S$10,000",
      "Hospital cash S$100 per day S$200 per day", "Hospital allowance S$200 per day up to S$8,000", "Accidental death S$100,000 S$1,234.56"];
    const doc = { id: "doc", name: "harbourline-travel.pdf", readable: true, people: [], pages: [{ page: 11, text: lines.join("\n") }] };
    const row = (benefit: string, value: number, quote: string) => ({ section: null, column: null, benefit, pays: "up_to", value, period: null, basis: null, percentOf: null,
      baseAmount: null, baseQuote: null, cap: null, capQuote: null, conditions: [], page: 11, quote });
    const read = checkReading(doc as never, { document: { kind: "policy_wording", product: null, insurer: null, namedPeople: [], plan: null }, covers: [], benefits: [
      row("Medical expenses", 250_000, lines[0]), row("Trip cancellation", 10_000, lines[1]), row("Curtailment", 5_000, lines[2]),
      row("Hospital cash", 200, lines[3]), row("Hospital allowance", 8_000, lines[4]), row("Hospital allowance", 200, lines[4]),
      row("Accidental death", 100_000, lines[5]),
    ] });
    assert.deepEqual(read.benefits.map((b) => [b.benefit, b.value]), [["Hospital allowance", 8_000], ["Hospital allowance", 200], ["Accidental death", 100_000]]);
  });

  await test("L14 two plans' rates in one unit are plans whatever separates them; a rate and its cap in another unit stay (TE pr364)", async () => {
    const { checkReading } = await import("@/lib/benefit-table/check");
    const lines = ["Hospital cash S$100 per day | S$200 per day", "Hotel stay S$50/night or S$80/night", "Hospital income S$200 per day S$20,000 per year",
      "Medical expenses S$100,000; S$250,000", "Travel delay S$100 every 6 hours up to S$1,000",
      "Trip cancellation S$5,000 and S$10,000", "Curtailment S$5,000 - S$10,000", "Baggage up to S$500 up to S$1,000",
      "Kennel fees S$40 each night | S$60 each night | S$90 each night", "Lost item S$200 each up to S$1,000", "Course fees S$2,000 per term or S$5,000",
      "Hospital cash S$100 per day and S$200 per day in ICU"];
    const doc = { id: "doc", name: "harbourline-travel.pdf", readable: true, people: [], pages: [{ page: 11, text: lines.join("\n") }] };
    const row = (benefit: string, value: number, quote: string) => ({ section: null, column: null, benefit, pays: "up_to", value, period: null, basis: null, percentOf: null,
      baseAmount: null, baseQuote: null, cap: null, capQuote: null, conditions: [], page: 11, quote });
    const read = checkReading(doc as never, { document: { kind: "policy_wording", product: null, insurer: null, namedPeople: [], plan: null }, covers: [], benefits: [
      row("Hospital cash", 100, lines[0]), row("Hotel stay", 50, lines[1]), row("Hospital income", 200, lines[2]), row("Hospital income", 20_000, lines[2]),
      row("Medical expenses", 100_000, lines[3]), row("Travel delay", 100, lines[4]), row("Travel delay", 1_000, lines[4]), row("Trip cancellation", 10_000, lines[5]), row("Curtailment", 5_000, lines[6]), row("Baggage", 1_000, lines[7]), row("Kennel fees", 40, lines[8]), row("Lost item", 200, lines[9]), row("Lost item", 1_000, lines[9]), row("Course fees", 2_000, lines[10]), row("Hospital cash", 100, lines[11]),
    ] });
    assert.deepEqual(read.benefits.map((b) => [b.benefit, b.value]), [["Hospital income", 200], ["Hospital income", 20_000], ["Travel delay", 100], ["Travel delay", 1_000],
      ["Lost item", 200], ["Lost item", 1_000], ["Course fees", 2_000], ["Hospital cash", 100]]);
  });

  await test("L15 parallel cells that each name their plan or person are plans; a row-wide qualifier keeps them plans; a lone condition is not (Critic R367, TE pr367)", async () => {
    const { checkReading } = await import("@/lib/benefit-table/check");
    const lines = ["Trip cancellation S$5,000 for Plan A | S$10,000 for Plan B", "Hospital cash S$100 per day for Classic / S$200 per day for Elite",
      "Baggage S$500 on Basic, S$1,000 on Premier", "Medical expenses S$50,000 in Plan 1 or S$100,000 in Plan 2",
      "Accidental death S$100,000 under Silver; S$250,000 under Gold", "Accidental death S$100,000 for adults / S$25,000 for children",
      "Personal accident S$100,000 for each adult, S$25,000 for each child", "Hospital income S$100 per day and S$200 per day in ICU",
      "Trip cancellation S$5,000 | S$10,000 for any one trip", "Medical expenses S$150,000 S$400,000 for each insured person",
      "Baggage S$1,000 / S$3,000 in total", "Travel delay S$100 / S$200 after every 6 hours of delay",
      "Medical expenses S$100,000 and S$200,000 for each insured person", "Overall limit S$200,000 or S$500,000 for any one trip",
      "Personal liability S$250,000 and S$500,000 if legally liable to pay", "Hospital cash S$100 a day, S$200 a day if in ICU",
      "Hospital cash S$100 per day | S$200 per day for each insured person", "Hospital cash S$100 per day S$200 per day during hospitalisation",
      "Hospital cash S$100 per day / S$200 per day while in hospital", "Hospital cash S$100 per day S$200 per day in ICU",
      "Hospital cash S$100 per day and S$200 per day for each insured person"];
    const doc = { id: "doc", name: "harbourline-travel.pdf", readable: true, people: [], pages: [{ page: 11, text: lines.join("\n") }] };
    const row = (benefit: string, value: number, quote: string) => ({ section: null, column: null, benefit, pays: "up_to", value, period: null, basis: null, percentOf: null,
      baseAmount: null, baseQuote: null, cap: null, capQuote: null, conditions: [], page: 11, quote });
    const read = checkReading(doc as never, { document: { kind: "policy_wording", product: null, insurer: null, namedPeople: [], plan: null }, covers: [], benefits: [
      row("Trip cancellation", 5_000, lines[0]), row("Hospital cash", 200, lines[1]), row("Baggage", 500, lines[2]), row("Medical expenses", 100_000, lines[3]),
      row("Accidental death", 100_000, lines[4]), row("Accidental death", 25_000, lines[5]), row("Personal accident", 100_000, lines[6]),
      row("Hospital income", 100, lines[7]),
      // A qualifier after the last cell applies to the whole row (TE pr367 r2).
      row("Trip cancellation", 5_000, lines[8]), row("Medical expenses", 150_000, lines[9]), row("Baggage", 1_000, lines[10]), row("Travel delay", 100, lines[11]),
      // Bare figures joined by "and"/"or" with a trailing qualifier stay held; a rate and a raised rate keep the first (TE pr367 r3).
      row("Medical expenses", 100_000, lines[12]), row("Overall limit", 200_000, lines[13]), row("Personal liability", 250_000, lines[14]),
      row("Hospital cash", 100, lines[15]),
      // Rate cells laid out as columns are plans, whatever follows; only "and"/"or"/a comma before a raised rate for a
      // setting (ICU, ward, hospital) keeps the first (TE and Critic, pr367 r4).
      row("Hospital cash", 100, lines[16]), row("Hospital cash", 100, lines[17]), row("Hospital cash", 100, lines[18]),
      row("Hospital cash", 100, lines[19]), row("Hospital cash", 100, lines[20]),
    ] });
    assert.deepEqual(read.benefits.map((b) => [b.benefit, b.value]), [["Hospital income", 100], ["Hospital cash", 100]]);
  });

  // ---- 5 Nov FWD re-read: a 47-page wording whose plan table ran parts out of output, two minutes a call, until the
  // serverless run was stopped at its time limit with nothing saved; each retry of the job paid for it again.
  /** A made-up 47-page wording: four pages of cover and contents, a plan table over pages 5-10 (four plan columns, ~38
   * figures a page), then 37 pages of wording with a figure now and then, each about 2,500 characters. */
  const wording = (): { page: number; text: string }[] => {
    const out: { page: number; text: string }[] = [];
    out.push({ page: 1, text: "Wayfarer Travel Shield\nPolicy wording\nPlans: Classic, Business, Premier, Elite" });
    for (let n = 2; n <= 4; n++) out.push({ page: n, text: `Contents and how to read this policy, page ${n}. ` + "Words in bold have the meaning given in the definitions. ".repeat(30) });
    for (let n = 5; n <= 10; n++) {
      const rows = Array.from({ length: n === 10 ? 2 : 9 }, (_, i) => `Benefit ${n}.${i + 1} Trip item ${n}-${i + 1}\tS$${(100 * (i + 1)).toLocaleString("en-SG")}\tS$${(200 * (i + 1)).toLocaleString("en-SG")}\tS$${(300 * (i + 1)).toLocaleString("en-SG")}\tS$${(400 * (i + 1)).toLocaleString("en-SG")}`);
      out.push({ page: n, text: (n === 5 ? "Table of benefits\nBenefit\tClassic\tBusiness\tPremier\tElite\n" : "") + rows.join("\n") });
    }
    for (let n = 11; n <= 47; n++) out.push({ page: n, text: `Section ${n}. What is covered. ` + "We will pay the reasonable costs you incur while on your trip, as set out in the table of benefits. ".repeat(24) + (n % 9 === 0 ? " The most we will pay is S$500." : "") });
    return out;
  };
  /** A stand-in model whose output follows what a page prints (as the 5 Nov run did), `worse` times the planned rate;
   * each call takes output / 200 seconds on the test's clock. Rows are listed one per line that prints a figure. */
  const priced = (o: { worse?: number; clock?: { t: number }; stopAt?: number } = {}) => {
    const calls: { pages: number[]; output: number; maxTokens: number; timeoutMs?: number; startedAt: number; input: number }[] = [];
    const model: TableModel = { choice: { provider: "anthropic", model: "stand-in" }, async call(c: TableCall): Promise<TableReply> {
      const context = Number(c.user.match(/do not list rows from page (\d+)/)?.[1] ?? NaN);
      const shown = [...c.user.matchAll(/<page n="(\d+)">\n([\s\S]*?)\n<\/page>/g)].map((m) => ({ page: Number(m[1]), text: m[2] })).filter((p) => p.page !== context);
      const output = Math.ceil(shown.reduce((n, p) => n + expectedOutput(p.text), 0) * (o.worse ?? 1));
      const input = Math.ceil((c.system.length + c.user.length) / 2.2);
      const startedAt = o.clock?.t ?? 0, ms = (Math.min(output, c.maxTokens) / 200) * 1000;
      calls.push({ pages: shown.map((p) => p.page), output, maxTokens: c.maxTokens, timeoutMs: c.timeoutMs, startedAt, input });
      if (c.timeoutMs != null && ms > c.timeoutMs) { if (o.clock) o.clock.t += c.timeoutMs; return { json: null, stopReason: "timeout", model: "stand-in", input, output: Math.floor(c.timeoutMs / 1000 * 200), ms: c.timeoutMs }; }
      if (o.clock) o.clock.t += ms;
      if (output > c.maxTokens) return { json: null, stopReason: "max_tokens", model: "stand-in", input, output: c.maxTokens, ms };
      const rows = shown.flatMap((p) => p.text.split("\n").filter((l) => /S\$/.test(l)).map((line) => ({ page: p.page, line })));
      return { json: { document: { kind: "policy_wording", product: "Wayfarer Travel Shield", insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null }, covers: [],
        benefits: rows.map((r) => ({ section: "Table of benefits", column: null, benefit: r.line.split("\t")[0], pays: "up_to", value: Number(r.line.split("\t")[1]?.replace(/[^\d]/g, "") || r.line.match(/S\$([\d,]+)/)![1].replace(/,/g, "")),
          period: null, basis: null, percentOf: null, baseAmount: null, baseQuote: null, cap: null, capQuote: null, conditions: [], page: r.page, quote: r.line })) },
        stopReason: "end_turn", model: "stand-in", input, output, ms };
    } };
    return { model, calls };
  };
  /** Sonnet list prices, US$ per million tokens: 3 in, 15 out. */
  const cost = (calls: { input: number; output: number; maxTokens: number }[]) => calls.reduce((n, c) => n + c.input * 3e-6 + Math.min(c.output, c.maxTokens) * 15e-6, 0);
  const earlierReading = { reading: { document: { document: { kind: "policy_wording", product: "Wayfarer Travel Shield", insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null }, covers: [], benefits: [] }, pages: [] }, read_at: "2026-10-22T05:45:00Z" };

  await test("L16 parts are planned from what each page prints, so no part of a plan-table wording reaches the output cap, even at 1.9 x the planned rate (FWD 5 Nov: two calls ran out, ~2 minutes and US$0.36 each)", async () => {
    const pages = wording();
    for (const part of pageParts(pages)) assert.ok(part.length === 1 || part.reduce((n, p) => n + expectedOutput(p.text), 0) <= PART_MAX_OUTPUT, JSON.stringify(part.map((p) => p.page)));
    // The plan table's pages are not read together: their figures need more than one call's output.
    const tablePages = pages.filter((p) => p.page >= 5 && p.page <= 10);
    assert.ok(tablePages.reduce((n, p) => n + expectedOutput(p.text), 0) > PART_MAX_OUTPUT, "the table needs several parts");
    const f = fakeDb(pages), m = priced({ worse: 1.9 });
    const r = await readDocument(f.db, m.model, A, "doc");
    assert.equal(r.read, true, r.why);
    // A page read again on its own (its figures mostly unread: this stand-in reads no plan column) has room for its rows too.
    assert.ok(m.calls.some((c) => c.maxTokens !== READ_MAX_OUTPUT), "pages were read again");
    for (const c of m.calls.filter((c) => c.maxTokens !== READ_MAX_OUTPUT)) assert.ok(c.maxTokens >= PAGE_MAX_OUTPUT && c.maxTokens <= READ_MAX_OUTPUT);
    assert.equal(m.calls.filter((c) => c.output > c.maxTokens).length, 0, "no call ran out: " + JSON.stringify(m.calls.map((c) => [c.pages[0], c.pages.at(-1), c.output])));
    const parts = m.calls.filter((c) => c.maxTokens === READ_MAX_OUTPUT);
    assert.equal(parts.length, pageParts(pages).length, `${parts.length} part calls: none read twice`);
    console.log(`  L16: ${parts.length} part calls and ${m.calls.length - parts.length} page re-reads, ${m.calls.reduce((n, c) => n + c.output, 0)} output tokens, about US$${cost(m.calls).toFixed(2)} at list price, none ran out`);
    // Planning figures, as documented: a figure ~130 tokens, other text ~0.3 a character.
    assert.equal(expectedOutput("S$100 S$200"), Math.ceil(2 * TOKENS_PER_FIGURE + 11 * TOKENS_PER_CHAR));
    const bare = "Benefit\t1,000,000\t250";
    assert.equal(expectedOutput(bare), Math.ceil(1 * TOKENS_PER_FIGURE + bare.length * TOKENS_PER_CHAR), "a bare figure with thousands separators counts; one without does not");
    // At the planned rate: what such a document costs to read.
    const planned = priced();
    assert.equal((await readDocument(fakeDb(pages).db, planned.model, A, "doc")).read, true);
    console.log(`  L16 at the planned rate: ${planned.calls.length} calls, ${planned.calls.reduce((n, c) => n + c.output, 0)} output tokens, about US$${cost(planned.calls).toFixed(2)}`);
  });
  await test("L17 a reading that cannot finish before its time limit stops before the limit and saves its note; no call is started that could not finish, and each call is stopped before the limit", async () => {
    const pages = wording(), clock = { t: 1_000_000 };
    const f = fakeDb(pages, earlierReading), m = priced({ worse: 1.9, clock });
    const deadline = clock.t + 150_000;
    const r = await readDocument(f.db, m.model, A, "doc", undefined, { deadline, now: () => clock.t });
    assert.equal(r.read, false);
    assert.match(r.why ?? "", /did not finish in time/);
    assert.equal(f.s.readings.get("doc")!.model, "earlier-model", "the earlier reading is kept");
    assert.deepEqual(f.s.notes, [UNREAD_TABLE_NOTE("22 October 2026")]);
    assert.ok(clock.t <= deadline - SAVE_MARGIN_MS, `stopped at ${clock.t - deadline} ms from the limit`);
    for (const c of m.calls) {
      assert.ok(deadline - SAVE_MARGIN_MS - c.startedAt >= MIN_CALL_MS, "a call started with too little time left");
      assert.ok(c.timeoutMs != null && c.startedAt + c.timeoutMs <= deadline - SAVE_MARGIN_MS, "a call could run past the limit");
    }
    console.log(`  L17: stopped after ${m.calls.length} calls, ${((clock.t - 1_000_000) / 1000).toFixed(0)} s, about US$${cost(m.calls).toFixed(2)}`);
    // With no time limit (a worker, a script), the same document is read in full.
    const g = fakeDb(pages, earlierReading);
    assert.equal((await readDocument(g.db, priced({ worse: 1.9 }).model, A, "doc")).read, true);
    assert.deepEqual(g.s.notes, []);
  });
  await test("L18 a call stopped at the time limit ends the reading with its note: it is not read again as halves", async () => {
    const clock = { t: 0 }, f = fakeDb(booklet(30, 10), earlierReading);
    const m = priced({ worse: 6, clock }); // each part takes ~4 minutes on this clock
    const r = await readDocument(f.db, m.model, A, "doc", undefined, { deadline: 100_000, now: () => clock.t });
    assert.equal(r.read, false);
    assert.equal(m.calls.length, 1, `${m.calls.length} calls`);
    assert.equal(m.calls[0].timeoutMs, 100_000 - SAVE_MARGIN_MS);
    assert.deepEqual(f.s.notes, [UNREAD_TABLE_NOTE("22 October 2026")]);
  });
  await test("L19 a retried job whose earlier attempt was cut off mid-reading never pays for the reading again; a first attempt marks and clears its start", async () => {
    const { readIntoTable, TABLE_READING_MARK } = await import("@/lib/benefit-table/app");
    const withMark = (pages: { page: number; text: string }[], marked: boolean) => {
      const f = fakeDb(pages, earlierReading), log: string[] = [];
      let mark = marked;
      const db: Db = async (sql, p) => {
        const q = sql.replace(/\s+/g, " ").trim();
        if (q.startsWith("SELECT (extracted_json ?")) return [{ cut: mark }];
        if (q.startsWith("UPDATE policies SET extracted_json=jsonb_set(") && q.includes(TABLE_READING_MARK)) { mark = true; log.push("mark"); return []; }
        if (q.startsWith("UPDATE policies SET extracted_json=extracted_json -")) { mark = false; log.push("clear"); return []; }
        // The re-link after a full reading: no household, so nothing to link (and no call).
        if (q.startsWith("DELETE FROM benefit_links") || q.startsWith("UPDATE benefit_links")) return [];
        try { return await f.db(sql, p); } catch (error) { if (q.startsWith("SELECT")) return []; throw error; }
      };
      return { db, s: f.s, log, marked: () => mark };
    };
    // The rule: a retry (attempt 2 or later) never calls the table model, whatever its earlier attempt did.
    // R1: attempt 1 cut off mid-reading (its mark stays): attempt 2 makes no call, saves the note, clears the mark...
    let w = withMark(wording(), true), m = priced();
    let r = await readIntoTable(w.db, m.model, A, "doc", { retry: true });
    assert.equal(r.read, false);
    assert.equal(m.calls.length, 0, "R1: no paid call");
    assert.deepEqual(w.s.notes, [NOT_READ_TABLE_NOTE("22 October 2026")]);
    assert.equal(w.marked(), false);
    // ...and (a) attempt 3 of the same job makes no call either, although attempt 2 cleared the mark.
    m = priced();
    r = await readIntoTable(w.db, m.model, A, "doc", { retry: true });
    assert.equal(m.calls.length, 0, "(a) attempt 3: no paid call");
    // (b) attempt 1's reading threw (a model-service error): its mark is kept, and attempt 2 makes no call.
    w = withMark(booklet(3, 10), false);
    const throwing: TableModel = { choice: { provider: "anthropic", model: "stand-in" }, async call() { throw new Error("overloaded"); } };
    await assert.rejects(readIntoTable(w.db, throwing, A, "doc"), /overloaded/);
    assert.equal(w.marked(), true, "(b) a reading that threw keeps its mark");
    m = priced();
    r = await readIntoTable(w.db, m.model, A, "doc", { retry: true });
    assert.equal(m.calls.length, 0, "(b) attempt 2: no paid call");
    assert.deepEqual(w.s.notes, [NOT_READ_TABLE_NOTE("22 October 2026")], "(b) the earlier reading is kept and the document says the new one was not read");
    // (c) attempt 1 finished the reading and the job failed later: attempt 2 makes no call and keeps the stored reading,
    // with no note.
    w = withMark(booklet(3, 10), false); m = priced();
    r = await readIntoTable(w.db, m.model, A, "doc");
    assert.equal(r.read, true);
    assert.deepEqual(w.log, ["mark", "clear"]);
    const kept = w.s.readings.get("doc")?.reading, n = m.calls.length;
    r = await readIntoTable(w.db, m.model, A, "doc", { retry: true });
    assert.equal(m.calls.length, n, "(c) attempt 2: no paid call");
    assert.equal(w.s.readings.get("doc")?.reading, kept);
    assert.deepEqual(w.s.notes, []);
    // (d) The deferred re-read a reading-service failure schedules (a fresh ":retry-read" job at attempt 1) is a retry too:
    // run through the same decision the document job uses, it makes no call and keeps the stored reading.
    const { tableReadingRetry } = await import("@/lib/benefit-table/app");
    assert.equal(tableReadingRetry({ attempt: { number: 1 }, deferredRetry: true }), true);
    assert.equal(tableReadingRetry({ attempt: { number: 2 } }), true);
    assert.equal(tableReadingRetry({ attempt: { number: 1 } }), false);
    assert.equal(tableReadingRetry({}), false);
    w = withMark(booklet(3, 10), false); m = priced();
    await readIntoTable(w.db, m.model, A, "doc");
    const before = m.calls.length, stored = w.s.readings.get("doc")?.reading;
    r = await readIntoTable(w.db, m.model, A, "doc", { retry: tableReadingRetry({ attempt: { number: 1 }, deferredRetry: true }) });
    assert.equal(m.calls.length, before, "(d) the deferred re-read: no paid call");
    assert.equal(w.s.readings.get("doc")?.reading, stored);
    const { readFileSync } = await import("node:fs");
    const ingest = readFileSync(new URL("../../lib/rag/ingest.ts", import.meta.url), "utf8");
    assert.match(ingest, /retry: benefitTable\.tableReadingRetry\(args\)/, "(d) the document job decides with tableReadingRetry");
    // (e) A bundle's parts run as their own documents with the bundle's attempt and deferredRetry, so a deferred re-read of a
    // bundle pays for no part's table reading: each part is decided like (d) and makes no call.
    const partCall = ingest.match(/await processPolicy\(\{[^}]*bundleOf: args\.policyId[^}]*\}\)/)?.[0] ?? "";
    assert.match(partCall, /attempt: args\.attempt/, "(e) a bundle part carries its job's attempt");
    assert.match(partCall, /deferredRetry: args\.deferredRetry/, "(e) a bundle part carries the deferred re-read");
    for (const part of ["part-1", "part-2", "part-3"]) {
      w = withMark(booklet(3, 10), false); m = priced();
      r = await readIntoTable(w.db, m.model, A, "doc", { retry: tableReadingRetry({ attempt: { number: 1 }, deferredRetry: true }) });
      assert.equal(m.calls.length, 0, `(e) ${part} of a deferred bundle re-read: no paid call`);
    }
    // A first attempt that ends normally out of time clears its mark (its note says the table was not read).
    const clock = { t: 0 };
    w = withMark(wording(), false); m = priced({ worse: 1.9, clock });
    r = await readIntoTable(w.db, m.model, A, "doc", { deadline: 150_000, now: () => clock.t });
    assert.equal(r.read, false);
    assert.deepEqual(w.log, ["mark", "clear"]);
  });
  await test("L22 a long document's reading is carried over runs: each run reads what is left, no part is paid twice, and the last run stores the whole reading (10 Nov: 58- and 47-page documents ran out of time and never had a table)", async () => {
    const { readIntoTable, TABLE_PROGRESS_KEY, TABLE_READING_MARK } = await import("@/lib/benefit-table/app");
    const { MAX_TABLE_READING_RUNS } = await import("@/lib/benefit-table/table-reading-job");
    /** fakeDb with the reading's mark and its carried progress kept in memory, and the re-link answered with nothing. */
    const carriedDb = (pages: { page: number; text: string }[]) => {
      const f = fakeDb(pages, earlierReading);
      const st = { pages, mark: false, progress: null as string | null, saves: 0 };
      const db: Db = async (sql, p) => {
        const q = sql.replace(/\s+/g, " ").trim();
        if (q.startsWith("SELECT policy_id, page_number, text FROM policy_pages")) return st.pages.map((x) => ({ policy_id: "doc", page_number: x.page, text: x.text }));
        if (q.startsWith(`SELECT extracted_json->'${TABLE_PROGRESS_KEY}'`)) return [{ progress: st.progress }];
        if (q.startsWith("SELECT (extracted_json ?")) return [{ cut: st.mark }];
        if (q.startsWith("UPDATE policies SET extracted_json=jsonb_set(") && q.includes(TABLE_READING_MARK)) { st.mark = true; return []; }
        if (q.startsWith("UPDATE policies SET extracted_json=extracted_json -") && q.includes(TABLE_READING_MARK)) { st.mark = false; return []; }
        if (q.startsWith("UPDATE policies SET extracted_json=jsonb_set(") && q.includes(TABLE_PROGRESS_KEY)) {
          if (p.length > 3 && (st.progress == null || JSON.parse(st.progress).id !== p[3])) return [];
          st.progress = p[2] as string; st.saves++; return [{ id: "doc" }];
        }
        if (q.startsWith("UPDATE policies SET extracted_json=extracted_json -") && q.includes(TABLE_PROGRESS_KEY)) {
          if (p.length > 2 && (st.progress == null || JSON.parse(st.progress).id !== p[2])) return [];
          st.progress = null; return [];
        }
        if (q.startsWith("DELETE FROM benefit_links") || q.startsWith("UPDATE benefit_links")) return [];
        try { return await f.db(sql, p); } catch (error) { if (q.startsWith("SELECT")) return []; throw error; }
      };
      return { db, s: f.s, st };
    };
    const pages = wording();
    // The same document read in one run with no time limit: what the carried reading must come to.
    const whole = carriedDb(pages), wm = priced({ worse: 1.9 });
    assert.equal((await readIntoTable(whole.db, wm.model, A, "doc")).read, true);
    const partsInOneRun = wm.calls.filter((c) => c.maxTokens === READ_MAX_OUTPUT).length;
    assert.ok(partsInOneRun >= 4, `${partsInOneRun} parts`);

    // K1: runs of 150 s (after the document's other reading) each read a part or two, then hand on to the next run.
    const clock = { t: 0 }, c = carriedDb(pages), m = priced({ worse: 1.9, clock });
    const queued: { id: string; run: number }[] = [];
    const continueLater = async (id: string, run: number) => { queued.push({ id, run }); };
    let r = await readIntoTable(c.db, m.model, A, "doc", { deadline: clock.t + 150_000, now: () => clock.t, continueLater });
    assert.equal(r.read, false);
    assert.equal(r.carried, true, r.why);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].run, 1);
    assert.deepEqual(c.s.notes, [], "K1: no 'could not be read' note while the reading goes on");
    assert.ok(c.st.progress, "K1: the reading so far is saved");
    let runs = 1;
    while (queued.length && runs <= MAX_TABLE_READING_RUNS) {
      const next = queued.shift()!;
      r = await readIntoTable(c.db, m.model, A, "doc", { deadline: clock.t + 150_000, now: () => clock.t, continuation: next, continueLater });
      runs++;
    }
    assert.equal(r.read, true, r.why);
    assert.ok(runs > 1, `${runs} runs`);
    const partCalls = m.calls.filter((x) => x.maxTokens === READ_MAX_OUTPUT);
    assert.equal(partCalls.length, partsInOneRun, `K1: each part paid once across ${runs} runs: ${JSON.stringify(partCalls.map((x) => x.pages))}`);
    assert.deepEqual(new Set(partCalls.flatMap((x) => x.pages)), new Set(pages.map((x) => x.page)), "K1: every page read");
    // The parts' readings are the one-run reading's; pages read again on their own come after, as time allows.
    const partsOf = (x: string | undefined) => { const j = JSON.parse(x!) as { document: unknown; pages: { page: number; json: unknown }[] }; return { document: j.document, pages: j.pages.slice(0, partsInOneRun - 1) }; };
    assert.deepEqual(partsOf(c.s.readings.get("doc")?.reading), partsOf(whole.s.readings.get("doc")?.reading), "K1: the stored reading is the one-run reading");
    assert.equal(c.st.progress, null, "K1: the carried reading is cleared once stored");
    assert.equal(c.st.mark, false);
    assert.deepEqual(c.s.notes, []);

    // K2: a continuation whose reading was replaced (Read again started a fresh one) or is gone makes no call.
    const k2 = carriedDb(pages), m2 = priced({ worse: 1.9, clock: { t: 0 } });
    r = await readIntoTable(k2.db, m2.model, A, "doc", { continuation: { id: "2026-01-01T00:00:00.000Z", run: 1 }, continueLater });
    assert.equal(m2.calls.length, 0, "K2: nothing to go on with: no call");
    k2.st.progress = JSON.stringify({ id: "other", fp: "x", queue: [[1]], done: [], headings: [], columns: [], calls: 0, limit: 1, outputLimit: 1 });
    r = await readIntoTable(k2.db, m2.model, A, "doc", { continuation: { id: "2026-01-01T00:00:00.000Z", run: 1 }, continueLater });
    assert.equal(m2.calls.length, 0, "K2: a replaced reading: no call");

    // K3: the pages changed between runs: the reading is not finished over them; the document says its table was not read.
    const k3clock = { t: 0 }, k3 = carriedDb(pages), m3 = priced({ worse: 1.9, clock: k3clock }), q3: { id: string; run: number }[] = [];
    await readIntoTable(k3.db, m3.model, A, "doc", { deadline: 150_000, now: () => k3clock.t, continueLater: async (id, run) => { q3.push({ id, run }); } });
    assert.equal(q3.length, 1);
    k3.st.pages = pages.map((x) => x.page === 2 ? { ...x, text: x.text + "\nEndorsement added" } : x);
    const before3 = m3.calls.length;
    r = await readIntoTable(k3.db, m3.model, A, "doc", { deadline: k3clock.t + 150_000, now: () => k3clock.t, continuation: q3[0], continueLater });
    assert.equal(r.read, false);
    assert.equal(m3.calls.length, before3, "K3: no call over changed pages");
    assert.deepEqual(k3.s.notes, [UNREAD_TABLE_NOTE("22 October 2026")]);

    // K4: a retried job goes on with a carried reading (only what is left); with none, it still makes no call.
    const k4clock = { t: 0 }, k4 = carriedDb(pages), m4 = priced({ worse: 1.9, clock: k4clock });
    await readIntoTable(k4.db, m4.model, A, "doc", { deadline: 150_000, now: () => k4clock.t, continueLater: async () => undefined });
    const readSoFar = m4.calls.filter((x) => x.maxTokens === READ_MAX_OUTPUT).flatMap((x) => x.pages);
    r = await readIntoTable(k4.db, m4.model, A, "doc", { retry: true, continueLater: async () => undefined });
    assert.equal(r.read, true, r.why);
    const parts4 = m4.calls.filter((x) => x.maxTokens === READ_MAX_OUTPUT);
    assert.equal(parts4.length, partsInOneRun, "K4: the retry read only the parts left");
    const firstRunParts = m4.calls.length && readSoFar.length ? parts4.findIndex((x) => x.pages.some((n) => !readSoFar.includes(n))) : -1;
    assert.ok(readSoFar.length > 0 && firstRunParts > 0, "K4: the first run read some parts");
    assert.ok(parts4.slice(firstRunParts).every((x) => x.pages.every((n) => !readSoFar.includes(n))), "K4: no page read in the first run is read again");
    const k4b = carriedDb(pages), m4b = priced();
    r = await readIntoTable(k4b.db, m4b.model, A, "doc", { retry: true, continueLater: async () => undefined });
    assert.equal(m4b.calls.length, 0, "K4: a retry with nothing carried: no call");

    // K5: a reading is never given up on (DC, 10 Nov): a run past MAX_TABLE_READING_RUNS still goes on with what is left and
    // queues the next one; no "could not be read" note.
    const k5clock = { t: 0 }, k5 = carriedDb(pages), m5 = priced({ worse: 1.9, clock: k5clock }), q5: { id: string; run: number }[] = [];
    await readIntoTable(k5.db, m5.model, A, "doc", { deadline: 150_000, now: () => k5clock.t, continueLater: async (id, run) => { q5.push({ id, run }); } });
    r = await readIntoTable(k5.db, m5.model, A, "doc", { deadline: k5clock.t + 150_000, now: () => k5clock.t, continuation: { id: q5[0].id, run: MAX_TABLE_READING_RUNS }, continueLater: async (id, run) => { q5.push({ id, run }); } });
    assert.equal(r.carried, true, "K5: goes on past the tenth run");
    assert.equal(q5.at(-1)!.run, MAX_TABLE_READING_RUNS + 1, "K5: the next run is queued");
    assert.deepEqual(k5.s.notes, [], "K5: never 'could not be read'");
    assert.ok(k5.st.progress, "K5: the reading so far is kept");

    // K6: a part cut off although its call had a whole run's time is read as two halves next run, not paid again whole.
    const k6clock = { t: 0 }, k6 = carriedDb(booklet(30, 10)), m6 = priced({ worse: 6, clock: k6clock }), q6: { id: string; run: number }[] = [];
    r = await readIntoTable(k6.db, m6.model, A, "doc", { deadline: 290_000, now: () => k6clock.t, continueLater: async (id, run) => { q6.push({ id, run }); } });
    assert.equal(r.carried, true, r.why);
    const first = m6.calls[0].pages;
    assert.ok(first.length > 1);
    r = await readIntoTable(k6.db, m6.model, A, "doc", { deadline: k6clock.t + 290_000, now: () => k6clock.t, continuation: q6[0], continueLater: async (id, run) => { q6.push({ id, run }); } });
    assert.deepEqual(m6.calls[1].pages, first.slice(0, Math.ceil(first.length / 2)), "K6: the first half next");

    // K7: a run going on with a reading that a fresh one replaced meanwhile stops at its next save, never overwriting it.
    const k7clock = { t: 0 }, k7 = carriedDb(pages), m7 = priced({ worse: 1.9, clock: k7clock }), q7: { id: string; run: number }[] = [];
    await readIntoTable(k7.db, m7.model, A, "doc", { deadline: 150_000, now: () => k7clock.t, continueLater: async (id, run) => { q7.push({ id, run }); } });
    const replacing: TableModel = { choice: m7.model.choice, async call(c) { k7.st.progress = JSON.stringify({ ...JSON.parse(k7.st.progress!), id: "fresh" }); return m7.model.call(c); } };
    await assert.rejects(readIntoTable(k7.db, replacing, A, "doc", { deadline: k7clock.t + 150_000, now: () => k7clock.t, continuation: q7[0], continueLater: async () => undefined }), /replaced/);
    assert.equal(JSON.parse(k7.st.progress!).id, "fresh", "K7: the fresh reading is kept");

    // K9: a reading finished by a run with too little time left to link its sections is never left unlinked: one more run
    // links them, pays for no reading, and clears what was carried (TE #404: 2 of 6 long readings showed "read" with 0 rows).
    let linkRuns = 0;
    for (let runMs = 100_000; runMs <= 290_000; runMs += 5_000) {
      const k9clock = { t: 0 }, k9 = carriedDb(pages), m9 = priced({ worse: 1.9, clock: k9clock }), q9: { id: string; run: number }[] = [];
      const later = async (id: string, run: number) => { q9.push({ id, run }); };
      let r9 = await readIntoTable(k9.db, m9.model, A, "doc", { deadline: runMs, now: () => k9clock.t, continueLater: later });
      let guard = 0;
      while (q9.length && guard++ < MAX_TABLE_READING_RUNS + 2) {
        const next = q9.shift()!, before9 = m9.calls.length, start = k9clock.t;
        const linkOnly = k9.st.progress != null && JSON.parse(k9.st.progress).linkOnly === true;
        r9 = await readIntoTable(k9.db, m9.model, A, "doc", { deadline: start + runMs, now: () => k9clock.t, continuation: next, continueLater: later });
        if (linkOnly) {
          linkRuns++;
          assert.equal(m9.calls.length, before9, `K9 (${runMs} ms runs): the link run pays for no reading`);
          assert.equal(r9.relinked, true, "K9: the link run links");
        }
      }
      if (!r9.read) continue; // too short a run to finish: K5 covers it
      assert.equal(r9.relinked, true, `K9 (${runMs} ms runs): the finished reading is linked`);
      assert.equal(k9.st.progress, null, `K9 (${runMs} ms runs): nothing left carried`);
      assert.equal(k9.st.mark, false);
      assert.ok(k9.s.readings.get("doc")?.reading, "K9: the reading is stored");
    }
    assert.ok(linkRuns > 0, "K9: some run length finishes a reading with too little time left to link");
    // A link run whose reading Read again replaced meanwhile does nothing; a fresh reading drops a pending link run.
    const k9b = carriedDb(pages), m9b = priced();
    k9b.st.progress = JSON.stringify({ id: "older", fp: "", queue: [], done: [], headings: [], columns: [], calls: 0, limit: 0, outputLimit: 0, linkOnly: true });
    r = await readIntoTable(k9b.db, m9b.model, A, "doc", { continuation: { id: "other", run: 3 }, continueLater });
    assert.equal(r.read, false, "K9: a link run for a replaced reading does nothing");
    assert.equal(m9b.calls.length, 0);
    const { enqueueTableReading } = await import("@/lib/benefit-table/table-reading-job");
    const enq: unknown[] = [];
    const fakeQueue = { query: (async (_sql: string, params: unknown[]) => { enq.push(params); return { rows: [{ id: "j", status: "queued" }], rowCount: 1 }; }) } as never;
    assert.ok(await enqueueTableReading(fakeQueue, A, "doc", "x", MAX_TABLE_READING_RUNS + 1), "K9: a run past the tenth is queued: never given up on");
    assert.equal(await enqueueTableReading(fakeQueue, A, "doc", "x", 0), null);
    // A run queued again after the one meant to go on died (requeueStuckTableWork) has a key of its own: a new job.
    await enqueueTableReading(fakeQueue, A, "doc", "x", 5, 0, 3);
    assert.ok(JSON.stringify(enq.at(-1)).includes("doc:table-reading:x:again-3"), "K9: queued again under its own key");
    // K10: a link run queued again after one died (requeueStuckLinks) links the stored reading and pays for no reading.
    const k10 = carriedDb(pages), m10 = priced();
    k10.st.progress = JSON.stringify({ id: "stored", fp: "", queue: [], done: [], headings: [], columns: [], calls: 0, limit: 0, outputLimit: 0, linkOnly: true, linkAttempts: 2 });
    r = await readIntoTable(k10.db, m10.model, A, "doc", { continuation: { id: "stored", run: MAX_TABLE_READING_RUNS + 1 }, continueLater });
    assert.equal(r.relinked, true, "K10: linked");
    assert.equal(m10.calls.filter((x) => x.maxTokens === READ_MAX_OUTPUT).length, 0, "K10: no reading paid");
    assert.equal(k10.st.progress, null, "K10: nothing left carried");
    // The first link run goes through linkLater (its own job key per attempt), never as a reading run.
    const k10b = carriedDb(pages), k10clock = { t: 0 }, m10b = priced({ worse: 1.9, clock: k10clock });
    const linkCalls: number[] = [];
    for (let runMs = 100_000; runMs <= 290_000 && !linkCalls.length; runMs += 5_000) {
      const kk = carriedDb(pages), clk = { t: 0 }, mm = priced({ worse: 1.9, clock: clk }), qq: { id: string; run: number }[] = [];
      await readIntoTable(kk.db, mm.model, A, "doc", { deadline: runMs, now: () => clk.t, continueLater: async (id, run) => { qq.push({ id, run }); }, linkLater: async (_id, attempt) => { linkCalls.push(attempt); } });
      for (let g = 0; qq.length && g < MAX_TABLE_READING_RUNS; g++) { const nx = qq.shift()!, st = clk.t; await readIntoTable(kk.db, mm.model, A, "doc", { deadline: st + runMs, now: () => clk.t, continuation: nx, continueLater: async (id, run) => { qq.push({ id, run }); }, linkLater: async (_id, attempt) => { linkCalls.push(attempt); } }); }
    }
    void k10b; void m10b; void k10clock;
    assert.deepEqual(linkCalls, [1], "K10: the first link run is attempt 1, queued through linkLater");


    // K11: a reading that needs more than MAX_TABLE_READING_RUNS runs (one part a run) finishes, and no part is paid twice.
    {
      const big = booklet(120, 40);
      const one = carriedDb(big), om = priced();
      assert.equal((await readIntoTable(one.db, om.model, A, "doc")).read, true);
      const partsWhole = om.calls.filter((x) => x.maxTokens === READ_MAX_OUTPUT).length;
      let best = 0;
      for (const runMs of [150_000, 200_000, 290_000]) {
        const k = carriedDb(big), clk = { t: 0 }, mm = priced({ clock: clk }), qq: { id: string; run: number; delayMs?: number }[] = [];
        const later = async (id: string, run: number, delayMs?: number) => { qq.push({ id, run, delayMs }); };
        let rr = await readIntoTable(k.db, mm.model, A, "doc", { deadline: runMs, now: () => clk.t, continueLater: later });
        let runs11 = 1;
        while (qq.length && runs11 < 200) { const nx = qq.shift()!, st = clk.t; rr = await readIntoTable(k.db, mm.model, A, "doc", { deadline: st + runMs, now: () => clk.t, continuation: nx, continueLater: later }); runs11++; }
        assert.equal(rr.read, true, `K11 (${runMs} ms runs): finished after ${runs11} runs: ${rr.why}`);
        const paid = mm.calls.filter((x) => x.maxTokens === READ_MAX_OUTPUT);
        assert.equal(paid.length, partsWhole, `K11 (${runMs} ms runs): each part paid once over ${runs11} runs`);
        assert.equal(new Set(paid.map((x) => x.pages.join(","))).size, paid.length, "K11: no part paid twice");
        assert.deepEqual(k.s.notes, [], "K11: never 'could not be read'");
        best = Math.max(best, runs11);
      }
      assert.ok(best > MAX_TABLE_READING_RUNS, `K11: some run length needs more than ${MAX_TABLE_READING_RUNS} runs (${best})`);
    }
    // K12: a reading call that fails (the service is down: no reply) is tried again next run, later each time, never given
    // up on; a part read before is never paid again.
    {
      const k = carriedDb(pages), clk = { t: 0 }, base = priced({ worse: 1.9, clock: clk }), qq: { id: string; run: number; delayMs?: number }[] = [];
      let down = 0;
      const flaky: TableModel = { choice: base.model.choice, async call(c) { if (down > 0) { down--; clk.t += 1_000; return { json: null, stopReason: "error", model: "stand-in", input: 0, output: 0, ms: 1_000 }; } return base.model.call(c); } };
      const later = async (id: string, run: number, delayMs?: number) => { qq.push({ id, run, delayMs }); };
      let rr = await readIntoTable(k.db, flaky, A, "doc", { deadline: 150_000, now: () => clk.t, continueLater: later });
      assert.equal(rr.carried, true);
      down = 3; // the next three runs each fail their first call
      const delays: number[] = [];
      let n12 = 0;
      while (qq.length && n12++ < 50) { const nx = qq.shift()!; delays.push(nx.delayMs ?? 0); const st = clk.t; rr = await readIntoTable(k.db, flaky, A, "doc", { deadline: st + 150_000, now: () => clk.t, continuation: nx, continueLater: later }); }
      assert.equal(rr.read, true, `K12: finished: ${rr.why}`);
      const stallDelays = delays.slice(1, 4);
      assert.ok(stallDelays.every((d, i) => d > 0 && (i === 0 || d > stallDelays[i - 1])), `K12: later each time it fails: ${delays}`);
      const paid = base.calls.filter((x) => x.maxTokens === READ_MAX_OUTPUT);
      assert.equal(new Set(paid.map((x) => x.pages.join(","))).size, paid.length, "K12: no part paid twice");
      assert.deepEqual(k.s.notes, []);
    }
    // K13: a single page that keeps running out of output is tried PAGE_MAX_TRIES times, then read past; the rest of the
    // document is read and stored, never "could not be read".
    {
      const { PAGE_MAX_TRIES } = await import("@/lib/benefit-table/service");
      const k = carriedDb(booklet(4, 10)), base = priced(), qq: { id: string; run: number }[] = [];
      let bad = 0, stubbornAlone = 0;
      const stubborn: TableModel = { choice: base.model.choice, async call(c) {
        const context = Number(c.user.match(/do not list rows from page (\d+)/)?.[1] ?? NaN);
        const shown = [...c.user.matchAll(/<page n="(\d+)">/g)].map((m) => Number(m[1])).filter((n) => n !== context);
        if (shown.includes(2)) { bad++; if (shown.length === 1) stubbornAlone++; return { json: null, stopReason: "max_tokens", model: "stand-in", input: 10, output: c.maxTokens, ms: 1 }; }
        return base.model.call(c);
      } };
      const later = async (id: string, run: number) => { qq.push({ id, run }); };
      // Parts of one page each, so page 2 is a part of its own.
      k.st.progress = null;
      let rr = await readIntoTable(k.db, stubborn, A, "doc", { deadline: 10_000_000, now: () => 0, continueLater: later });
      let n13 = 0;
      while (qq.length && n13++ < 20) rr = await readIntoTable(k.db, stubborn, A, "doc", { deadline: 10_000_000, now: () => 0, continuation: qq.shift()!, continueLater: later });
      assert.equal(rr.read, true, `K13: the rest is read and stored: ${rr.why}`);
      const alone = stubbornAlone;
      assert.equal(alone, PAGE_MAX_TRIES, `K13: the stubborn page on its own is paid ${PAGE_MAX_TRIES} times, then read past (${alone} alone, ${bad} calls read it)`);
      // Read past is never silent (Critic and TE #404): the stored reading names the page, and the document says so.
      const { READ_PAST_TABLE_NOTE } = await import("@/lib/benefit-table/service");
      assert.deepEqual(rr.skipped, [2]);
      assert.deepEqual(JSON.parse(k.s.readings.get("doc")!.reading).skippedPages, [2], "K13: the page read past is stored");
      assert.deepEqual(k.s.notes, [READ_PAST_TABLE_NOTE([2])], "K13: the document names the page it could not read, never 'could not be read' as a whole");
    }
    // K13b: any other call that gives no reading (a refusal, a reply that is not a valid reading) is bounded the same way: a
    // part of several pages is read as halves, and a single page is tried PAGE_MAX_TRIES times, then read past.
    for (const stop of ["refusal", "end_turn"]) {
      const { PAGE_MAX_TRIES } = await import("@/lib/benefit-table/service");
      const k = carriedDb(booklet(4, 10)), base = priced(), qq: { id: string; run: number }[] = [];
      let alone = 0, calls = 0;
      const refusing: TableModel = { choice: base.model.choice, async call(c) {
        const context = Number(c.user.match(/do not list rows from page (\d+)/)?.[1] ?? NaN);
        const shown = [...c.user.matchAll(/<page n="(\d+)">/g)].map((m) => Number(m[1])).filter((n) => n !== context);
        calls++;
        if (shown.includes(3)) { if (shown.length === 1) alone++; return { json: null, stopReason: stop, model: "stand-in", input: 10, output: 5, ms: 1 }; }
        return base.model.call(c);
      } };
      const later = async (id: string, run: number) => { qq.push({ id, run }); };
      let rr = await readIntoTable(k.db, refusing, A, "doc", { deadline: 10_000_000, now: () => 0, continueLater: later });
      let n = 0;
      while (qq.length && n++ < 30) rr = await readIntoTable(k.db, refusing, A, "doc", { deadline: 10_000_000, now: () => 0, continuation: qq.shift()!, continueLater: later });
      assert.equal(rr.read, true, `K13b (${stop}): the rest is read and stored: ${rr.why}`);
      assert.equal(alone, PAGE_MAX_TRIES, `K13b (${stop}): the page on its own is paid ${PAGE_MAX_TRIES} times (${alone})`);
      assert.ok(calls < 20, `K13b (${stop}): bounded (${calls} calls)`);
      assert.deepEqual(JSON.parse(k.s.readings.get("doc")!.reading).skippedPages, [3]);
    }
    // K14: before a page is read past it is tried with the stronger reader and more room (DC, 10 Nov: accuracy before cost).
    // Here the stronger reader reads it: nothing is read past, and the normal reader paid for the page alone once.
    {
      const { STRONG_MAX_OUTPUT } = await import("@/lib/benefit-table/service");
      const k = carriedDb(booklet(4, 10)), base = priced(), strongBase = priced(), qq: { id: string; run: number }[] = [];
      let alone = 0;
      const pageOf = (c: { user: string }) => { const context = Number(c.user.match(/do not list rows from page (\d+)/)?.[1] ?? NaN); return [...c.user.matchAll(/<page n="(\d+)">/g)].map((m) => Number(m[1])).filter((n) => n !== context); };
      const stubborn: TableModel = { choice: base.model.choice, async call(c) {
        const shown = pageOf(c);
        if (shown.includes(2)) { if (shown.length === 1) alone++; return { json: null, stopReason: "max_tokens", model: "stand-in", input: 10, output: c.maxTokens, ms: 1 }; }
        return base.model.call(c);
      } };
      const strongCalls: number[] = [];
      const strong: TableModel = { choice: { provider: "anthropic", model: "stand-in-strong" }, async call(c) { strongCalls.push(c.maxTokens); return strongBase.model.call(c); } };
      const strongUsage: string[] = [];
      const later = async (id: string, run: number) => { qq.push({ id, run }); };
      const opts = { deadline: 10_000_000, now: () => 0, continueLater: later, strong: { model: strong, onUsage: (what: string) => { strongUsage.push(what); } } };
      let rr = await readIntoTable(k.db, stubborn, A, "doc", opts);
      let n = 0;
      while (qq.length && n++ < 20) rr = await readIntoTable(k.db, stubborn, A, "doc", { ...opts, continuation: qq.shift()! });
      assert.equal(rr.read, true, `K14: read: ${rr.why}`);
      assert.equal(alone, 1, "K14: the normal reader paid for the page alone once");
      assert.deepEqual(strongCalls, [STRONG_MAX_OUTPUT], "K14: the stronger reader read it, once, with more room");
      assert.deepEqual(strongUsage, ["reading"], "K14: its call is booked at its own price");
      assert.equal(JSON.parse(k.s.readings.get("doc")!.reading).skippedPages, undefined, "K14: nothing read past");
      assert.deepEqual(k.s.notes, []);
    }

    // K8: wired: the document job passes continueLater; the job is registered; ingest keeps the carried reading.
    const { readFileSync } = await import("node:fs");
    const app = readFileSync(new URL("../../lib/benefit-table/app.ts", import.meta.url), "utf8");
    assert.match(app, /continueLater: \(id, run, delayMs\) => enqueueTableReading\(pool, accountId, policyId, id, run, delayMs\)/);
    assert.match(app, /linkLater: \(id, attempt, delayMs\) => enqueueTableLink\(pool, accountId, policyId, id, attempt, delayMs\)/);
    assert.match(app, /readIntoTable\(appDb, model, accountId, policyId, \{ \.\.\.opts, strong,/, "K8: the stronger reader is passed in");
    // Reading is never stopped by the spend limit; it only checks the usage ledger can be read (fails closed when it cannot,
    // Critic #405) and ignores whether the household is over its limit.
    assert.doesNotMatch(app, /assertUnderSpendCap|(?:if\s*\(|=|return|&&|\|\|)\s*!?\s*\(?\s*await overSpendCap/, "K8: reading is not limited by the spend limit (DC, 10 Nov)");
    assert.match(app, /\n\s*await overSpendCap\(accountId\);\n/, "K8: the reading checks only that the usage ledger can be read");
    const drain = readFileSync(new URL("../../lib/jobs/request-drain.ts", import.meta.url), "utf8");
    assert.match(drain, /requeueStuckTableWorkEverywhere\(\);\n\s*if \(!\(await hasClaimableWork\(\)\)\)/, "K8: the drain queues stuck table work again before it looks for work");
    const cron = readFileSync(new URL("../../app/api/internal/jobs/run/route.ts", import.meta.url), "utf8");
    assert.match(cron, /await requeueStuckTableWorkEverywhere\(\);/, "K8: so does the daily run");
    const route = readFileSync(new URL("../../app/api/benefit-table/route.ts", import.meta.url), "utf8");
    assert.match(route, /await requeueStuckTableReadings\(accountId\)/, "K8: opening Coverage queues a dead link run again");
    const processors = readFileSync(new URL("../../lib/jobs/processors.ts", import.meta.url), "utf8");
    assert.match(processors, /jobType: TABLE_READING_JOB_TYPE, process: .*processTableReadingJob\(job\)/);
    const ingest = readFileSync(new URL("../../lib/rag/ingest.ts", import.meta.url), "utf8");
    assert.match(ingest, /extracted_json \? 'benefitTableProgress' THEN jsonb_build_object\('benefitTableProgress'/);
    console.log(`  L22: ${runs} runs, ${partCalls.length} part calls (${partsInOneRun} in one run)`);
  });
  await test("L20 the Anthropic call is stopped at its time limit and books the tokens it used", async () => {
    const { anthropicTableModel } = await import("@/lib/benefit-table/model");
    let aborted = false;
    const client = { messages: { stream: () => {
      let reject: (e: Error) => void = () => undefined;
      const done = new Promise<never>((_, rj) => { reject = rj; });
      return { finalMessage: () => done, abort: () => { aborted = true; reject(new Error("aborted")); }, currentMessage: { model: "stand-in-sonnet", usage: { input_tokens: 9_000, output_tokens: 3_100 } } };
    } } };
    const model = anthropicTableModel({ provider: "anthropic", model: "stand-in" } as never, client as never);
    const reply = await model.call({ system: "s", user: "u", schema: {}, maxTokens: 24_000, timeoutMs: 30 });
    assert.equal(aborted, true);
    assert.equal(reply.stopReason, "timeout");
    assert.equal(reply.json, null);
    assert.deepEqual([reply.input, reply.output], [9_000, 3_100]);
    // The API reports output tokens only in its last event: a call stopped after streaming books its streamed text.
    const streaming = { messages: { stream: () => {
      let reject: (e: Error) => void = () => undefined, onText: (d: string) => void = () => undefined;
      const done = new Promise<never>((_, rj) => { reject = rj; });
      setTimeout(() => onText("x".repeat(30_000)), 1);
      return { finalMessage: () => done, abort: () => reject(new Error("aborted")), on: (_e: string, l: (d: string) => void) => { onText = l; },
        currentMessage: { model: "stand-in-sonnet", usage: { input_tokens: 9_000, output_tokens: 1 } } };
    } } };
    const streamed = await anthropicTableModel({ provider: "anthropic", model: "stand-in" } as never, streaming as never).call({ system: "s", user: "u", schema: {}, maxTokens: 24_000, timeoutMs: 30 });
    assert.equal(streamed.output, 10_000, "30,000 streamed characters are booked as about 10,000 output tokens");
    // A failure that is not the time limit is still thrown.
    const failing = anthropicTableModel({ provider: "anthropic", model: "stand-in" } as never, { messages: { stream: () => ({ finalMessage: () => Promise.reject(new Error("overloaded")) }) } } as never);
    await assert.rejects(failing.call({ system: "s", user: "u", schema: {}, maxTokens: 10, timeoutMs: 1000 }), /overloaded/);
  });
  await test("L21 the function's time limit: only on Vercel, from when the job runner started, the earlier of two", async () => {
    const { FUNCTION_LIMIT_MS, functionDeadline, withFunctionDeadline } = await import("@/lib/jobs/function-time");
    assert.equal(functionDeadline(1_000, {} as NodeJS.ProcessEnv), undefined, "no limit off Vercel");
    assert.equal(functionDeadline(1_000, { VERCEL: "1" } as never), 1_000 + FUNCTION_LIMIT_MS, "a run no job runner started counts from its own start");
    const inner = await withFunctionDeadline(5_000, () => withFunctionDeadline(90_000, async () => functionDeadline(200_000, { VERCEL: "1" } as never), { VERCEL: "1" } as never), { VERCEL: "1" } as never);
    assert.equal(inner, 5_000 + FUNCTION_LIMIT_MS, "a job batch inside an earlier function keeps that function's limit");
    assert.equal(await withFunctionDeadline(5_000, async () => functionDeadline(7_000, {} as never), {} as never), undefined);
  });

  console.log(`benefit-table long document: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  if (failures.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
