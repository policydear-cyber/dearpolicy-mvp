/** The Home and Coverage "not fully read" line says "cover may be missing" only for a document whose cover may really be
 * missing; one read in part (only some amounts not checked) says so instead. No database.
 *   node --import tsx scripts/policies/not-fully-read-note-test.ts */
import assert from "node:assert/strict";
import { notFullyReadNote } from "@/lib/policies/not-fully-read";

assert.equal(notFullyReadNote({ count: 0, coverUnknown: 0 }, "Ada"), null);
// Left out, a counted document is one whose cover may be missing (as before).
assert.equal(notFullyReadNote({ count: 2 }, "Ada", true), "2 of Ada’s documents were not fully read.");
// Only amounts not checked: the cover is shown, so nothing says it may be missing.
const amounts = notFullyReadNote({ count: 2, coverUnknown: 0 }, "Ada") ?? "";
assert.match(amounts, /^Some amounts in 2 of Ada’s documents could not be checked, so they show as not checked\./);
assert.doesNotMatch(amounts, /missing/);
assert.equal(notFullyReadNote({ count: 1, coverUnknown: 0 }, "Ben", true), "Some amounts in one of Ben’s documents could not be checked.");
// Mixed: only the documents whose cover may be missing are counted in that sentence.
assert.match(notFullyReadNote({ count: 3, coverUnknown: 1 }, "Ada") ?? "", /^One of Ada’s documents was not fully read, so cover in it may be missing here\./);
assert.equal(notFullyReadNote({ count: 3, coverUnknown: 2 }, "Ada", true), "2 of Ada’s documents were not fully read.");
console.log("not-fully-read-note: pass");
process.exit(0);
