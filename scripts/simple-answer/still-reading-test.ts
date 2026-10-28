/** A document the app is still reading is described as still being read, never as "could not be read"; a document the
 * app failed to read, or one in a status the app does not know, keeps "could not be read". Neither kind's text is sent
 * or quoted. Covers the chat library (renderLibrary), the server's own points about files (verifyAnswer: libraryFact,
 * libraryCount, libraryGroups) and the household read (readHousehold). Made-up household; no model, no database.
 *   npm run simple:still-reading-test */
import assert from "node:assert/strict";
import { readHousehold, renderLibrary, type Household, type HouseholdDocument } from "../../lib/simple-chat/library";
import { libraryFact, libraryGroups, verifyAnswer } from "../../lib/simple-chat/verify";
import { SIMPLE_SYSTEM_PROMPT, type ModelStatement } from "../../lib/simple-chat/prompt";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) { await fn(); passed++; console.log("ok - " + name); }

const SECRET = "Hospital cash S$123 per day";
const base: HouseholdDocument = {
  policyId: "cccccccc-0000-4000-8000-000000000001", name: "Lim plan.pdf", insurer: "Example Insurance", productName: "Example Shield",
  policyNumber: null, documentType: null, documentRole: null, effectiveDate: null, expiryDate: null, uploadedAt: "2026-10-28",
  uploadedFor: "Lim Ah Kow", linkedPeople: ["Lim Ah Kow"], supersededAt: null, processingStatus: "ready",
  pages: [{ page: 1, text: `Example Shield schedule\n${SECRET}` }],
};
const doc = (n: number, name: string, extra: Partial<HouseholdDocument>): HouseholdDocument =>
  ({ ...base, policyId: `cccccccc-0000-4000-8000-00000000000${n}`, name, productName: null, ...extra });
const HOUSE: Household = {
  accountId: "22222222-2222-4222-8222-222222222222",
  members: [{ name: "Lim Ah Kow", relationship: "self" }, { name: "Tan Mei Ling", relationship: "spouse" }],
  documents: [
    doc(1, "read.pdf", { productName: "Example Shield", processingStatus: "ready" }),
    doc(2, "queued.pdf", { processingStatus: "queued" }),
    doc(3, "extracting.pdf", { processingStatus: "extracting" }),
    doc(4, "indexing.pdf", { processingStatus: "indexing" }),
    doc(5, "uploaded.pdf", { processingStatus: "uploaded", quarantineStatus: "scan_pending" }),
    doc(6, "failed.pdf", { processingStatus: "failed" }),
    doc(7, "odd.pdf", { processingStatus: "paused_by_operator" }),
    doc(8, "rejected.pdf", { processingStatus: "queued", quarantineStatus: "scan_rejected" }),
    doc(9, "gone.pdf", { processingStatus: "queued", quarantineStatus: null }),
  ],
};
const IN_PROGRESS = ["queued.pdf", "extracting.pdf", "indexing.pdf", "uploaded.pdf"];
const NOT_READ = ["failed.pdf", "odd.pdf", "rejected.pdf", "gone.pdf"];
const tagOf = (lib: string, name: string) => lib.match(new RegExp(`<document [^>]*name="${name.replace(/\./g, "\\.")}"[^>]*>\\n[\\s\\S]*?</document>`))?.[0] ?? "";

async function main() {
  await check("library: a document still being read says so, with no text sent; never 'could not be read'", () => {
    const lib = renderLibrary(HOUSE);
    for (const name of IN_PROGRESS) {
      const tag = tagOf(lib, name);
      assert.ok(tag, name);
      assert.match(tag, /reading_status="still being read/, name);
      assert.doesNotMatch(tag, /could not be read/, name);
      assert.match(tag, /<no_readable_text\/>/, name);
      assert.ok(!tag.includes(SECRET), name);
    }
  });

  await check("library: failed, unknown-status, scan-rejected and unknown-scan documents keep 'could not be read' (negative controls)", () => {
    const lib = renderLibrary(HOUSE);
    for (const name of NOT_READ) {
      const tag = tagOf(lib, name);
      assert.match(tag, /reading_status="could not be read \(/, name);
      assert.doesNotMatch(tag, /still being read/, name);
      assert.match(tag, /<no_readable_text\/>/, name);
      assert.ok(!tag.includes(SECRET), name);
    }
    assert.match(tagOf(lib, "failed.pdf"), /reading_status="could not be read \(failed\)"/);
    const read = tagOf(lib, "read.pdf");
    assert.doesNotMatch(read, /reading_status=/);
    assert.ok(read.includes(SECRET));
  });

  await check("server's point about one file: still being read vs could not be read", () => {
    const fact = (name: string) => libraryFact(HOUSE, HOUSE.documents.find((d) => d.name === name)!);
    for (const name of IN_PROGRESS) {
      assert.match(fact(name), new RegExp(`^${name.replace(/\./g, "\\.")} is still being read, so nothing in it is used yet; ask again in a minute\\.`), name);
      assert.doesNotMatch(fact(name), /could not be read/, name);
    }
    for (const name of NOT_READ) {
      assert.match(fact(name), /could not be read \(status: [^)]+\), so nothing in it was used\./, name);
      assert.doesNotMatch(fact(name), /still being read/, name);
    }
    assert.match(fact("read.pdf"), /was read\./);
  });

  await check("server's answer about the files (verifyAnswer): the count and per-file points tell reading from failed", () => {
    const st = (text: string, document: string | null): ModelStatement => ({ kind: "fact", text, person: null, document, quote: null, amount: null,
      alternativeGroup: null, percentOf: null, conditions: [] });
    const { answer } = verifyAnswer(HOUSE, { bottomLine: "", nextSteps: [], question: null, statements: [
      st("D2 could not be read.", "D2"),
      st("D6 could not be read.", "D6"),
      st("The other files (D1, D3) were read.", null),
    ] });
    const texts = answer.statements!.filter((x) => x.kind === "fact").map((x) => x.text);
    assert.ok(texts.some((t) => t.startsWith("queued.pdf is still being read, so nothing in it is used yet; ask again in a minute.")), texts.join("\n"));
    assert.ok(texts.some((t) => t.startsWith("failed.pdf could not be read (status: failed), so nothing in it was used.")), texts.join("\n"));
    assert.ok(texts.includes("Of your 9 uploaded files, 1 was read, 4 are still being read (queued.pdf, extracting.pdf, indexing.pdf, uploaded.pdf) and 4 could not be read (failed.pdf, odd.pdf, rejected.pdf, gone.pdf)."), texts.join("\n"));
    assert.ok(!texts.join("\n").includes(SECRET));
  });

  await check("server's count with nothing still being read is unchanged (negative control)", () => {
    const st = (text: string): ModelStatement => ({ kind: "fact", text, person: null, document: null, quote: null, amount: null, alternativeGroup: null, percentOf: null, conditions: [] });
    const two: Household = { ...HOUSE, documents: [HOUSE.documents[0], HOUSE.documents[5]] };
    const { answer } = verifyAnswer(two, { bottomLine: "", nextSteps: [], question: null, statements: [st("The files (D1, D2) were read.")] });
    assert.deepEqual(answer.statements!.filter((x) => x.kind === "fact").map((x) => x.text), ["Of your 2 uploaded files, 1 was read and 1 could not be read (failed.pdf)."]);
  });

  await check("benefit-table library groups use the same words", () => {
    const lines = libraryGroups(HOUSE, HOUSE.documents);
    assert.ok(lines.some((l) => l.startsWith("queued.pdf is still being read")), lines.join("\n"));
    assert.ok(lines.some((l) => l.startsWith("failed.pdf could not be read")), lines.join("\n"));
  });

  await check("household read carries the scan status, so a scan-rejected upload is never called 'still being read'", async () => {
    const acct = HOUSE.accountId;
    const run = async (sql: string) => {
      if (/FROM family_members WHERE/.test(sql)) return [{ account_id: acct, display_name: "Lim Ah Kow", preferred_name: null, relationship: "self" }];
      if (/FROM policies p/.test(sql)) return [
        { account_id: acct, id: "cccccccc-0000-4000-8000-00000000000a", original_filename: "new.pdf", processing_status: "queued", quarantine_status: "scan_clean", created_at: "2026-10-28" },
        { account_id: acct, id: "cccccccc-0000-4000-8000-00000000000b", original_filename: "bad.pdf", processing_status: "queued", quarantine_status: "scan_rejected", created_at: "2026-10-28" },
      ];
      return [];
    };
    const h = await readHousehold(acct, run);
    const lib = renderLibrary(h);
    assert.match(tagOf(lib, "new.pdf"), /reading_status="still being read/);
    assert.match(tagOf(lib, "bad.pdf"), /reading_status="could not be read \(queued\)"/);
  });

  await check("prompt: a document still being read is said to be still being read", () => {
    assert.match(SIMPLE_SYSTEM_PROMPT, /still being read/);
  });

  console.log(`\n${passed} still-reading checks passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
