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
    const short = booklet(4), f = fakeDb(short), m = lister();
    const r = await readDocument(f.db, m.model, A, "doc");
    assert.deepEqual(r, { read: true, pagesReread: 0 });
    assert.equal(m.calls.length, 1);
    assert.doesNotMatch(m.calls[0].user, /read in parts/);
    assert.equal(rowsStored(f.s).rows.length, 3 * 40);
  });

  await test("L7 no document costs more than 2 x its parts + 4 calls, however often its parts run out (Critic R364 M2)", async () => {
    for (const n of [30, 60]) {
      const pages = booklet(n), m = lister({ tokensPerRow: 1_000 }); // every multi-page part runs out
      const r = await readDocument(fakeDb(pages).db, m.model, A, "doc");
      assert.equal(r.read, false);
      assert.ok(m.calls.length <= 2 * pageParts(pages).length + 4, `${n} pages: ${m.calls.length} calls`);
    }
    // After the first part runs out, the parts still to come are made smaller too, so each is not paid for twice.
    const m = lister({ tokensPerRow: 80 });
    await readDocument(fakeDb(long).db, m.model, A, "doc");
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

  console.log(`benefit-table long document: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  if (failures.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
