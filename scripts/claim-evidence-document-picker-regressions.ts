/**
 * Claim-evidence document picker regressions: the client-safe catalogue
 * (lib/claims/evidence/document-catalogue.ts) that app/claims/[id]/page.tsx
 * builds its document-type picker, upload request and status text from.
 *
 * Exercises the production functions directly (no copy of their logic
 * here) plus a static check that the page really is wired to them rather
 * than to a private list. The database/route side of the same 22 types is
 * proven by scripts/claim-evidence-document-type-regressions.ts.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CAUSE_OF_DEATH_DOCUMENT_TYPES, CLAIM_EVIDENCE_DOCUMENT_TYPES, MEDICAL_CLAIM_DOCUMENT_TYPES, MEDICAL_EVIDENCE_DOCUMENT_TYPES,
} from "@/lib/claims/evidence/types";
import {
  DOCUMENT_TYPE_GROUPS, DOCUMENT_TYPE_OPTIONS, buildEvidenceUploadForm, defaultDocumentTypeFor, documentTypeGroup, documentTypeLabel,
  evidenceStatusDisplay, isUploadableDocumentType,
} from "@/lib/claims/evidence/document-catalogue";

let cases = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}

const PROMISE_LANGUAGE = /\b(approv\w*|guarantee\w*|will be paid|you will receive|payout|entitled to)\b/i;
const pdf = () => new Blob([new Uint8Array(Buffer.from("%PDF-1.4\n%%EOF\n", "latin1"))], { type: "application/pdf" });

async function main() {
  await test("every supported type appears in the picker exactly once", () => {
    const values = DOCUMENT_TYPE_OPTIONS.map((o) => o.value);
    assert.equal(values.length, 22);
    assert.equal(new Set(values).size, values.length);
    assert.deepEqual([...values].sort(), [...CLAIM_EVIDENCE_DOCUMENT_TYPES].sort());
  });

  await test("labels and descriptions are human-readable, never raw identifiers", () => {
    for (const option of DOCUMENT_TYPE_OPTIONS) {
      assert.ok(option.label.trim().length > 2, option.value);
      assert.notEqual(option.label, option.value);
      assert.ok(!option.label.includes("_"), `${option.value} label must not contain an identifier underscore`);
      assert.match(option.label, /^[A-Z]/, `${option.value} label must read as a title`);
      assert.ok(option.description.trim().length > 10, `${option.value} needs a short description`);
      assert.equal(documentTypeLabel(option.value), option.label);
    }
    assert.equal(documentTypeLabel("brochure"), "Unrecognised document type");
  });

  await test("options are grouped into the three documented groups, matching the canonical group constants", () => {
    assert.deepEqual(DOCUMENT_TYPE_GROUPS.map((g) => g.label), ["Cause-of-death documents", "Medical evidence", "Bills, receipts and settlement documents"]);
    for (const group of DOCUMENT_TYPE_GROUPS) assert.ok(group.guidance.trim().length > 10, `${group.id} needs guidance`);
    const byGroup = (id: string) => DOCUMENT_TYPE_GROUPS.find((g) => g.id === id)!.options.map((o) => o.value);
    assert.deepEqual(byGroup("cause_of_death"), [...CAUSE_OF_DEATH_DOCUMENT_TYPES]);
    assert.deepEqual(byGroup("medical_evidence"), [...MEDICAL_EVIDENCE_DOCUMENT_TYPES]);
    assert.deepEqual(byGroup("bills_and_settlements"), [...MEDICAL_CLAIM_DOCUMENT_TYPES]);
    for (const option of DOCUMENT_TYPE_OPTIONS) assert.equal(documentTypeGroup(option.value), option.group);
    assert.equal(documentTypeGroup("brochure"), null);
  });

  await test("the selected canonical identifier is exactly what the upload request carries, for every type", () => {
    for (const type of CLAIM_EVIDENCE_DOCUMENT_TYPES) {
      const built = buildEvidenceUploadForm({ file: pdf(), fileName: "doc.pdf", familyMemberId: "member-1", claimSessionId: "claim-1", documentType: type });
      assert.ok(built.ok, type);
      if (!built.ok) continue;
      assert.equal(built.form.get("documentType"), type);
      assert.equal(built.form.get("familyMemberId"), "member-1");
      assert.equal(built.form.get("claimSessionId"), "claim-1");
      const file = built.form.get("file");
      assert.ok(file instanceof Blob, "the PDF must be attached");
    }
  });

  await test("hospital bill, itemised bill, receipt, specialist memo and death certificate are all selectable", () => {
    for (const type of ["hospital_bill", "itemised_bill", "receipt_payment_proof", "specialist_memo", "death_certificate"]) {
      assert.ok(DOCUMENT_TYPE_OPTIONS.some((o) => o.value === type), type);
      assert.ok(isUploadableDocumentType(type));
    }
    assert.equal(documentTypeGroup("hospital_bill"), "bills_and_settlements");
    assert.equal(documentTypeGroup("receipt_payment_proof"), "bills_and_settlements");
    assert.equal(documentTypeGroup("specialist_memo"), "medical_evidence");
    assert.equal(documentTypeGroup("death_certificate"), "cause_of_death");
  });

  await test("unknown or empty selections can never be submitted", () => {
    for (const value of ["", "brochure", "HOSPITAL_BILL", "hospital-bill", " hospital_bill", "other"]) {
      const built = buildEvidenceUploadForm({ file: pdf(), familyMemberId: "m", claimSessionId: "c", documentType: value });
      assert.equal(built.ok, false, `"${value}" must be refused`);
      assert.equal(isUploadableDocumentType(value), false);
    }
    const noFile = buildEvidenceUploadForm({ file: null, familyMemberId: "m", claimSessionId: "c", documentType: "hospital_bill" });
    assert.equal(noFile.ok, false);
  });

  await test("no selection is never silently defaulted to a medical type", () => {
    assert.equal(defaultDocumentTypeFor("death"), "death_certificate", "a death claim keeps its existing starting point");
    for (const eventType of ["hospitalisation", "diagnosis", "accident", "disability", "other", null, undefined, "", 42]) {
      assert.equal(defaultDocumentTypeFor(eventType), "", `event type ${String(eventType)} must require an explicit choice`);
    }
  });

  await test("status stays fail-closed while scanning, processing or review is pending, and never leaks internal error text", () => {
    const pending = [
      { status: "uploaded", scan_status: "pending_scan" },
      { status: "quarantined", scan_status: "pending_scan" },
      { status: "quarantined", scan_status: "scan_unavailable" },
      { status: "processing", scan_status: "clean" },
      { status: "extracted", scan_status: "clean" },
    ];
    for (const doc of pending) {
      const display = evidenceStatusDisplay(doc);
      assert.equal(display.tone, "pending", JSON.stringify(doc));
      assert.notEqual(display.label, "Reviewed");
    }
    assert.equal(evidenceStatusDisplay({ status: "uploaded", scan_status: "pending_scan" }).label, "Waiting for security scan");
    assert.equal(evidenceStatusDisplay({ status: "needs_review", scan_status: "clean" }).label, "Needs review");
    assert.equal(evidenceStatusDisplay({ status: "matched", scan_status: "clean" }).label, "Reviewed");
    assert.equal(evidenceStatusDisplay({ status: "something_new", scan_status: "clean" }).tone, "stopped", "an unknown status is never shown as usable");
    const infected = evidenceStatusDisplay({ status: "rejected", scan_status: "infected", processing_error_code: "MALWARE_DETECTED" });
    assert.equal(infected.tone, "stopped");
    assert.match(infected.detail, /security scan/);
    const leaky = { status: "failed", scan_status: "clean", processing_error_code: "PROCESSING_ERROR", processing_error: "Error: connect ECONNREFUSED 10.0.0.5:5432 at pg/lib/client.js" };
    const failed = evidenceStatusDisplay(leaky);
    assert.equal(failed.label, "Could not process");
    assert.ok(!failed.detail.includes("ECONNREFUSED") && !failed.detail.includes("pg/lib"));
  });

  await test("the claim page is wired to the shared catalogue and builder, with no private type list or raw error text", async () => {
    const page = await readFile(path.resolve("app/claims/[id]/page.tsx"), "utf8");
    assert.match(page, /from "@\/lib\/claims\/evidence\/document-catalogue"/);
    assert.match(page, /DOCUMENT_TYPE_GROUPS\.map/);
    assert.match(page, /buildEvidenceUploadForm\(/);
    assert.match(page, /evidenceStatusDisplay\(/);
    assert.ok(!/const DOC_TYPES\s*=/.test(page), "no private document-type list in the page");
    assert.ok(!/set\("documentType"/.test(page), "the page must not build the upload payload by hand");
    assert.ok(!/doc\.processing_error\b(?!_code)/.test(page), "raw processing_error text must not be rendered");
    assert.ok(!/useState\("death_certificate"\)/.test(page), "the picker must not start pre-set to a type for every claim");
  });

  await test("no approval or guaranteed-payout language in the picker, statuses or claim page", async () => {
    const strings = [
      ...DOCUMENT_TYPE_GROUPS.flatMap((g) => [g.label, g.guidance]),
      ...DOCUMENT_TYPE_OPTIONS.flatMap((o) => [o.label, o.description]),
      ...["uploaded", "quarantined", "processing", "extracted", "needs_review", "matched", "rejected", "failed", "x"].flatMap((status) => {
        const d = evidenceStatusDisplay({ status, scan_status: "pending_scan" });
        return [d.label, d.detail];
      }),
    ];
    for (const text of strings) assert.ok(!PROMISE_LANGUAGE.test(text), `promise-like language in: ${text}`);
    for (const file of ["app/claims/[id]/page.tsx", "lib/claims/evidence/document-catalogue.ts"]) {
      const source = await readFile(path.resolve(file), "utf8");
      assert.ok(!PROMISE_LANGUAGE.test(source), `promise-like language in ${file}`);
    }
  });

  console.log(`DearPolicy claim-evidence document picker regressions passed (${cases} cases).`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
