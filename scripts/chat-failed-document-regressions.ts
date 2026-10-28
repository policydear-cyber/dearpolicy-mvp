/**
 * What chat tells a household about a document DearPolicy could not read (lib/chat/household-status.ts), and the
 * benefit-reading note for a document with no stored pages (lib/policies/read-failures.ts).
 *
 * The defect: chat chose its own reason and next step, apart from the Documents page's allow-list
 * (lib/documents/failure-advice.ts):
 *   - a locked PDF was told "Upload it again with its password", but uploading the same file again is refused as
 *     already in DearPolicy (the locked copy is still there); the Documents page takes the password in place;
 *   - a reading-service failure, or any reason it did not know, was told "DearPolicy couldn't find readable text in it"
 *     -- the wrong reason -- and to upload a clearer scan;
 *   - a document with no stored pages was told "Re-analyse it on the Documents page"; the household's button there is
 *     "Read again".
 *
 * Made-up households, people and files only. The database is a stub of pool.query; no model is called.
 */
import assert from "node:assert/strict";
import {
  DOCUMENT_READING_FAILED_MESSAGE, DOCUMENT_READING_SERVICE_MESSAGE, INCOMPLETE_PDF_MESSAGE, PDF_PASSWORD_INCORRECT_MESSAGE,
  PDF_PASSWORD_REQUIRED_MESSAGE, UNOPENABLE_DOCUMENT_MESSAGE, UNREADABLE_DOCUMENT_MESSAGE, UNREADABLE_PHOTO_MESSAGE,
} from "@/lib/documents/processing-errors";
import { POLICY_PROCESSING_STOPPED_MESSAGE } from "@/lib/policies/quarantine/ui";
import { pool } from "@/lib/db/client";
import type { ClaimPerson } from "@/lib/claims/person";

let cases = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); cases++; console.log("ok -", name); } catch (error) { console.error("FAIL -", name); throw error; }
}

const ACCOUNT = "00000000-0000-4000-8000-0000000000aa";
const self = { id: "00000000-0000-4000-8000-000000000001", display_name: "Lim Ah Kow", preferred_name: null, relationship: "self" } as unknown as ClaimPerson;
const spouse = { id: "00000000-0000-4000-8000-000000000002", display_name: "Tan Mei Ling", preferred_name: "Mei Ling", relationship: "spouse" } as unknown as ClaimPerson;

type Row = { status: string; error: string | null; pageCount?: number | null; member?: string };
let rows: Row[] = [];
// The stub answers documentsByPerson's one query with made-up rows.
(pool as unknown as { query: (text: string, params?: unknown[]) => Promise<unknown> }).query = async () => ({
  rows: rows.map((r, i) => ({
    id: "00000000-0000-4000-8000-0000000001" + String(i).padStart(2, "0"), product_name: null, insurer: "Example Insurance",
    original_filename: `example-${i + 1}.pdf`, policy_number: null, document_role: null, policy_type: null, personal_coverage_confirmed: false,
    processing_status: r.status, processing_error: r.error, page_count: r.pageCount ?? null, family_member_id: r.member ?? self.id, tier: null,
    effective_date: null, renewal_or_expiry_date: null,
  })),
});

async function main() {
  const hs = await import("@/lib/chat/household-status");
  const { READ_FAILURE_REASON } = await import("@/lib/policies/read-failures");
  async function said(list: Row[], person: ClaimPerson = self) {
    rows = list;
    const docs = (await hs.documentsByPerson(ACCOUNT, [self, spouse])).get(person.id) ?? [];
    return { lines: hs.unusableDocumentLines(person, docs).join(" "), none: hs.noPoliciesSentence(person, docs), docs };
  }

  await test("a locked PDF (no password, or a wrong one) is pointed to entering its password on the Documents page, never to uploading it again", async () => {
    for (const error of [PDF_PASSWORD_REQUIRED_MESSAGE, PDF_PASSWORD_INCORRECT_MESSAGE]) {
      const { lines, none } = await said([{ status: "failed", error }]);
      for (const text of [lines, none]) {
        assert.match(text, /password-protected/, text);
        assert.match(text, /Enter its password on the Documents page/, text);
        assert.doesNotMatch(text, /upload(?:ed)? it again|Upload it again|re-?upload/i, text);
      }
    }
    const wrong = await said([{ status: "failed", error: PDF_PASSWORD_INCORRECT_MESSAGE }]);
    assert.match(wrong.lines, /the password entered for it didn’t work/, "a wrong password is said as wrong");
    const missing = await said([{ status: "failed", error: PDF_PASSWORD_REQUIRED_MESSAGE }]);
    assert.doesNotMatch(missing.lines, /didn’t work/, "a missing password is not said to be wrong");
  });

  await test("a reading-service failure says the service was unavailable and nothing is wrong with the file, with the page's own button", async () => {
    for (const pageCount of [null, 4]) {
      const { lines, none } = await said([{ status: "failed", error: DOCUMENT_READING_SERVICE_MESSAGE, pageCount }]);
      for (const text of [lines, none]) {
        assert.match(text, /reading service wasn’t available — nothing is wrong with the file/, text);
        assert.match(text, /Press “Try reading it again” on the Documents page in a little while/, text);
        assert.doesNotMatch(text, /readable text|clearer scan|try again automatically/i, text);
      }
    }
  });

  await test("an unknown failure (the API's stand-in, a raw error, none) gets the plain generic wording, never its own text or a wrong reason", async () => {
    for (const error of [POLICY_PROCESSING_STOPPED_MESSAGE, "Error: connect ECONNREFUSED 10.0.0.1:5432 at /var/task/worker.js", "password service timeout", null, DOCUMENT_READING_FAILED_MESSAGE]) {
      for (const pageCount of [null, 3]) {
        const { lines, none, docs } = await said([{ status: "failed", error, pageCount }]);
        assert.equal(docs[0].status, "unreadable", `${error}: an unknown reason is not a locked PDF`);
        for (const text of [lines, none]) {
          assert.match(text, /DearPolicy couldn’t finish reading it/, text);
          assert.doesNotMatch(text, /readable text|password|ECONNREFUSED|worker\.js|Analysis stopped|timeout/i, text);
        }
        // The step the Documents page shows for it: its "Try reading it again" button, or (read before) another copy.
        if (error === DOCUMENT_READING_FAILED_MESSAGE || !pageCount) assert.match(lines, /Press “Try reading it again” on the Documents page/, lines);
        else assert.match(lines, /upload it on the Documents page/, lines);
      }
    }
  });

  await test("a document with no stored pages is pointed to the household's own 'Read again' button", () => {
    assert.match(READ_FAILURE_REASON.no_pages, /\bRead again\b/);
    assert.doesNotMatch(READ_FAILURE_REASON.no_pages, /Re-?analy/i);
  });

  await test("negative controls: the failures chat already explained right say exactly what they said before", async () => {
    const before: [string, string, string][] = [
      [UNREADABLE_DOCUMENT_MESSAGE, "“example-1.pdf” couldn’t be read. The original PDF or a clearer scan would let DearPolicy read it.",
        "The only document on file for you, “example-1.pdf”, couldn’t be read yet because DearPolicy couldn’t find readable text in it. Upload the original PDF or a clearer scan and ask again."],
      [UNREADABLE_PHOTO_MESSAGE, "“example-1.pdf” is a photo too blurred, dark or faint to read. Take it again — page flat, good light, no shadow, phone steady and straight above it, the whole page in the frame — or upload the insurer’s PDF.",
        "The only document on file for you, “example-1.pdf”, couldn’t be read yet because the photo is too blurred or dark to read. Take the photo again — flat, in good light, the whole page in the frame — or upload the insurer’s PDF."],
      [INCOMPLETE_PDF_MESSAGE, "“example-1.pdf” is incomplete — the file stops part-way, as when a download is cut off — so it couldn’t be opened. Download it again from the insurer’s email or website and upload the new copy.",
        "The only document on file for you, “example-1.pdf”, couldn’t be read yet because the file is incomplete (cut off part-way). Download it again from the insurer and upload the new copy."],
      [UNOPENABLE_DOCUMENT_MESSAGE, "“example-1.pdf” couldn’t be opened — the file may be damaged. Upload the original file again, or ask the insurer for a fresh copy.",
        "The only document on file for you, “example-1.pdf”, couldn’t be read yet because the file couldn’t be opened. Upload the original PDF or a clearer scan and ask again."],
    ];
    for (const [error, line, none] of before) {
      const got = await said([{ status: "failed", error }]);
      assert.equal(got.lines, line);
      assert.equal(got.none, none);
    }
    const reading = await said([{ status: "processing", error: null }]);
    assert.equal(reading.lines, "“example-1.pdf” is still being read. Ask again in a few minutes.");
    const ready = await said([{ status: "ready", error: null, pageCount: 2 }]);
    assert.equal(ready.lines, "", "a read document is not called unusable");
    assert.equal(ready.docs[0].status, "ready");
    for (const code of ["timeout", "reader_unavailable", "unreadable_reply", "unknown"] as const)
      assert.doesNotMatch(READ_FAILURE_REASON[code], /Documents page/, code);
  });

  await test("two people with locked PDFs: the instruction is said once", async () => {
    rows = [{ status: "failed", error: PDF_PASSWORD_REQUIRED_MESSAGE }, { status: "failed", error: PDF_PASSWORD_REQUIRED_MESSAGE, member: spouse.id }];
    const map = await hs.documentsByPerson(ACCOUNT, [self, spouse]);
    const seen = new Set<string>();
    const text = [self, spouse].flatMap((p) => hs.unusableDocumentLines(p, map.get(p.id) ?? [], seen)).join(" ");
    assert.equal(text.match(/Enter its password on the Documents page/g)?.length, 1, text);
  });

  console.log(`chat failed-document regressions: ${cases} passed`);
}

main().catch((error) => { console.error(error); process.exit(1); });
