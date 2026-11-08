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
    // After the first part runs out, the parts still to come are made smaller too, so each is not paid for twice.
    const m = lister({ tokensPerRow: 400 });
    await readDocument(fakeDb(booklet(30, 10)).db, m.model, A, "doc");
    const ranOut = m.calls.filter((c) => c.output > READ_MAX_OUTPUT).length;
    assert.equal(ranOut, 1, `${ranOut} calls ran out`);
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
