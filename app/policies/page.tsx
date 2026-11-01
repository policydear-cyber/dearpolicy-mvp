"use client";

import Link from "next/link";
import { lineFigure, linePeriodWords } from "@/lib/coverage/line-period";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isPolicyQuarantineHeld, isPolicyScanRejected, policyQuarantineLabel } from "@/lib/policies/quarantine/ui";
import { customerError } from "@/components/customer-text";
import { failedDocumentAdvice, readInPartAdvice } from "@/lib/documents/failure-advice";
import { MAX_UPLOAD_LABEL, uploadPolicyDocument } from "@/components/upload-document";
import type { ReadingDocument } from "@/components/reading-status";
import { documentFoundLabels, documentTableKinds, type KindRow } from "@/components/cover-kinds";
import { NOT_FAMILY_KEY } from "@/components/device-memory";
import { coversPlanPrompt } from "@/lib/policies/plan-choice";
import { documentCardTitle } from "@/lib/policies/document-name";
import { authorityLabel, isOwnDocument, readAsPolicyDocument } from "@/lib/policies/document-filter";

/* V1.1: the household library shows what each document is, whose it is and
 * whether it is ready -- never processing stages, page counts, search-index
 * state, raw processing errors or confidence scores. Those, with field
 * corrections, are in the operator area (/operator/documents). Processing
 * failures are retried automatically; a document that stays unreadable gets
 * one plain sentence about what is unavailable, a "Try reading it again"
 * button, and what to do if that fails. */

type Member = { id: string; display_name: string; relationship: string; policy_count: number };
type LinkedPerson = { id: string; name: string; relationship: string; source: string; planTier?: string | null };
type DetectedPerson = { name: string; matchedFamilyMemberId: string | null };
type Policy = {
  id: string;
  insurer: string | null;
  product_name: string | null;
  policy_number: string | null;
  group_policy_number: string | null;
  policy_type: string | null;
  document_role: string | null;
  personal_coverage_confirmed: boolean;
  document_authority: number;
  document_authority_label: string | null;
  reading_policy?: boolean;
  needs_review: boolean;
  review_reason: string | null;
  processing_status: string;
  processing_stage: string;
  processing_progress: number;
  processing_message: string | null;
  quarantine_status: string;
  scan_result_detail: string | null;
  original_filename: string;
  page_count: number | null;
  processing_error: string | null;
  processing_stalled?: boolean;
  linked_people: LinkedPerson[];
  detected_people: DetectedPerson[];
  /** Cover tiers the document describes (e.g. Employee / Spouse / Child). */
  tier_options?: string[];
  /** Who the document names, and as which tier. */
  named_tiers?: { name: string; tier: string | null }[];
};
type Filter = "all" | "personal" | "reference";

const ACTIVE_STATUSES = new Set(["queued", "uploaded", "extracting", "indexing"]);
function isProcessing(policy: Policy) { return ACTIVE_STATUSES.has(policy.processing_status); }
const isQuarantineHeld = isPolicyQuarantineHeld;
const isScanRejected = isPolicyScanRejected;
const quarantineLabel = policyQuarantineLabel;
const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);
const fileSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
type Named = Pick<Policy, "product_name" | "original_filename" | "insurer" | "document_role" | "policy_number">;
/** What a household calls a document: the same name sentences give it (lib/policies/document-name.ts) -- its product,
 * else a readable file name a person chose, else insurer and kind ("Singlife policy wording"), never a made-up file name. */
function documentName(policy: Named) {
  return documentCardTitle(policy);
}
/** A document's kind in a household's words; the stored role name is internal ("personal_schedule"). */
function roleLabel(role: string | null) {
  if (role === "personal_schedule" || role === "schedule") return "Policy schedule";
  if (!role || role === "unknown") return "Document";
  const t = role.replaceAll("_", " "); return t.charAt(0).toUpperCase() + t.slice(1);
}
/** How much a document says about the household's own cover, in their words: the stored labels are internal. */
/** "a, b and 2 more": what a document was found to pay for, in a line. */
function foundLine(labels: string[]) {
  const l = labels;
  return l.length <= 3 ? l.join(l.length === 2 ? " and " : ", ").replace(/, ([^,]*)$/, " and $1") : `${l.slice(0, 3).join(", ")} and ${l.length - 3} more`;
}
function stageLabel(_stage: string | null, status: string) {
  if (status === "failed") return "Could not be read";
  if (status === "ready") return "Ready";
  return "Reading";
}

export default function PoliciesPage() {
  const [family, setFamily] = useState<Member[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  // "malware_scan" (default) or "not_scanned_prototype" -- reported by the
  // policies API so held documents never show malware-scan language when
  // scanning is intentionally disabled in this prototype build.
  // Whether to ask which plan each covered person is on: decided by GET /api/policies (planChoice; lib/policies/plan-choice.ts).
  const [planChoice, setPlanChoice] = useState(true);
  const [documentSafetyMode, setDocumentSafetyMode] = useState<"malware_scan" | "not_scanned_prototype">("malware_scan");
  const [memberId, setMemberId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pdfPassword, setPdfPassword] = useState("");
  const [status, setStatus] = useState("");
  // An upload that failed or was refused is shown as an error, never in the
  // same box (and colour) as a successful one.
  const [statusIsError, setStatusIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  /** Family's "N documents linked" opens this page as /policies?person=<id>: only that person's documents. */
  const [personId, setPersonId] = useState<string | null>(null);
  useEffect(() => { setPersonId(new URLSearchParams(window.location.search).get("person")); }, []);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  // A ready document is read again only after a second click: it re-runs the reading on the PDF already kept.
  const [confirmRereadId, setConfirmRereadId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const previousActiveCount = useRef(0);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const statusBox = useRef<HTMLDivElement | null>(null);
  // A refused upload is said where the person can see it, not below the fold.
  useEffect(() => { if (statusIsError && status) statusBox.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [status, statusIsError]);
  // Confirmations of actions taken on the library itself (delete, who a
  // document covers, unlocking), shown where the person is looking.
  const [libraryNotice, setLibraryNotice] = useState("");
  /** Names the household said are not in the family. The server remembers this answer and leaves those names out of
   * detected_people; until its table is applied it answers remembered: false, and the answer is then kept on this
   * device only, and the page says so. */
  const [notFamily, setNotFamily] = useState<string[]>([]);
  useEffect(() => { try { setNotFamily(JSON.parse(localStorage.getItem(NOT_FAMILY_KEY) || "[]")); } catch { /* storage unavailable */ } }, []);
  /** The last "Not in my family" answer, so the notice can offer to undo it. */
  const [undoNotFamily, setUndoNotFamily] = useState<{ policyId: string; detectedName: string; notice: string } | null>(null);
  function saveNotFamily(next: string[]) {
    setNotFamily(next);
    try { localStorage.setItem(NOT_FAMILY_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  }
  async function postNotFamily(policyId: string, detectedName: string, notFamily: boolean) {
    const response = await fetch("/api/policies/link-person", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ policyId, detectedName, notFamily }),
    });
    const payload = await response.json().catch(() => ({}));
    return { status: response.status, ok: response.ok, remembered: payload.remembered === true, error: payload.error as string | undefined };
  }
  /** Returns false when the answer was not taken, so the question stays as it was. */
  async function markNotFamily(policyId: string, detectedName: string): Promise<boolean> {
    try {
      const result = await postNotFamily(policyId, detectedName, true);
      if (result.status === 409) {
        setLibraryNotice(`${detectedName} is already linked to someone in your family. To change who this document covers, use “Change” on the document.`);
        return false;
      }
      if (!result.ok) throw new Error(result.error || "Could not save that answer");
      let notice = `Noted: ${detectedName} is not in your family, so nothing in this document is used for them.`;
      if (!result.remembered) {
        saveNotFamily([...new Set([...notFamily, `${policyId}:${detectedName}`])]);
        notice += " This is remembered on this device only for now, so DearPolicy may ask again elsewhere.";
      }
      setUndoNotFamily({ policyId, detectedName, notice });
      setLibraryNotice(notice);
      if (result.remembered) await refresh();
      return true;
    } catch (error) {
      setLibraryNotice(customerError(error, "Could not save that answer. Please try again in a moment."));
      return false;
    }
  }
  async function undoMarkNotFamily() {
    if (!undoNotFamily) return;
    const { policyId, detectedName } = undoNotFamily;
    try {
      const result = await postNotFamily(policyId, detectedName, false);
      if (!result.ok) throw new Error(result.error || "Could not undo that answer");
      saveNotFamily(notFamily.filter((k) => k !== `${policyId}:${detectedName}`));
      setUndoNotFamily(null);
      setLibraryNotice("");
      await refresh();
    } catch (error) {
      setLibraryNotice(customerError(error, "Could not undo that. Please try again in a moment."));
    }
  }
  const [loaded, setLoaded] = useState(false);
  // Arriving from Family with ?person=, the filtered list is what they came for, so it is brought into view.
  useEffect(() => { if (loaded && personId) document.querySelector("[data-testid=person-filter]")?.scrollIntoView({ block: "start" }); }, [loaded, personId]);
  // "Open in Documents" from a chat source lands here with #doc-<id>: once the
  // library has loaded, bring that document into view and outline it.
  useEffect(() => {
    if (!loaded || typeof window === "undefined") return;
    const id = window.location.hash.slice(1);
    if (!id.startsWith("doc-")) return;
    const card = document.getElementById(id);
    if (!card) return;
    card.scrollIntoView({ block: "center" });
    card.classList.add("focused");
    const timer = setTimeout(() => card.classList.remove("focused"), 2400);
    return () => clearTimeout(timer);
  }, [loaded]);

  // What each document was found to pay for (benefit table or Coverage rows by document), and documents whose benefits are still
  // being read, or could not be read, for Coverage (reading.documents). Neither is needed for the page to work.
  const [found, setFound] = useState<Record<string, string[]>>({});
  const [benefitReading, setBenefitReading] = useState<Record<string, ReadingDocument>>({});
  async function refresh() {
    const [f, p] = await Promise.all([
      fetch("/api/family", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/policies", { cache: "no-store" }).then((r) => r.json()),
    ]);
    // What each document was found to pay for. A household on the benefit table: from its table rows (documentTableKinds),
    // never from its Coverage rows, which stopped updating; the table not loaded (an error, offline): no Found line.
    // Otherwise from the Coverage rows; what only a plan type suggests is never shown as cover.
    const table = fetch("/api/benefit-table", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).catch(() => null);
    const ledger = fetch("/api/ledger", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).catch(() => null);
    // Whether a document is still being read for Coverage comes from the reader that serves Coverage: the benefit table's
    // own state when it is on (a document its job is reading now), else the ledger's. The ledger never reads for a table
    // household, so its list would say "Reading…" forever there.
    void Promise.all([table, ledger]).then(([t, l]: [{ enabled?: boolean; people?: Parameters<typeof documentTableKinds>[0]; documents?: { id: string; name: string; state: string }[] } | null, { rows?: (KindRow & { policyId: string | null; eventLabel: string; status: string })[]; reading?: { documents?: ReadingDocument[] } } | null]) => {
      if (t?.enabled) {
        setBenefitReading(Object.fromEntries((t.documents ?? []).filter((d) => d.state === "waiting").map((d) => [d.id, { policyId: d.id, name: d.name, state: "waiting" } as ReadingDocument])));
        return setFound(documentTableKinds(t.people ?? []));
      }
      if (l) setBenefitReading(Object.fromEntries((l.reading?.documents ?? []).map((d) => [d.policyId, d])));
      if (t && l) setFound(documentFoundLabels(l.rows ?? []));
    }).catch(() => undefined);
    setFamily(f.family ?? []);
    setPolicies(p.policies ?? []);
    setPlanChoice(p.planChoice !== false);
    setLoaded(true);
    if (p.documentSafetyMode === "not_scanned_prototype" || p.documentSafetyMode === "malware_scan") setDocumentSafetyMode(p.documentSafetyMode);
  }

  useEffect(() => { void refresh(); }, []);

  const activeCount = policies.filter(isProcessing).length;
  // Bounded polling: fast for the first minute, then relaxed, and never
  // infinite -- after ten minutes of continuous activity it stops and asks
  // the person to refresh, instead of hammering the server forever.
  const pollingSince = useRef<number | null>(null);
  const [pollingPaused, setPollingPaused] = useState(false);
  useEffect(() => {
    if (!activeCount) { pollingSince.current = null; setPollingPaused(false); return; }
    pollingSince.current ??= Date.now();
    const elapsed = Date.now() - pollingSince.current;
    if (elapsed > 10 * 60_000) { setPollingPaused(true); return; }
    const timer = window.setInterval(() => { void refresh(); }, elapsed > 60_000 ? 5000 : 1400);
    return () => window.clearInterval(timer);
  }, [activeCount]);

  useEffect(() => {
    if (previousActiveCount.current > 0 && activeCount === 0) {
      const failed = policies.filter((p) => p.processing_status === "failed").length;
      setStatusIsError(!!failed);
      setStatus(failed ? `Finished. ${failed === 1 ? "One document" : `${failed} documents`} could not be read — see below.` : "Your documents are ready. Your portfolio has been updated.");
    }
    previousActiveCount.current = activeCount;
  }, [activeCount, policies]);

  /** From a card that couldn't be read: back to the upload box, with the file picker open. */
  function chooseAnother() {
    fileInput.current?.closest(".upload-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    fileInput.current?.click();
  }

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setStatusIsError(false);
    setStatus("Uploading document…");
    try {
      // Straight to secure storage (components/upload-document.ts): large
      // scanned booklets never pass through a size-limited server request.
      await uploadPolicyDocument(file, {
        familyMemberId: memberId || null,
        pdfPassword,
        onProgress: (fraction) => setStatus(`Uploading document… ${Math.round(fraction * 100)}%`),
      });
      setStatus("Upload received. DearPolicy is reading it now — you can keep using the app.");
      setFile(null);
      setPdfPassword("");
      if (fileInput.current) fileInput.current.value = "";
      await refresh();
    } catch (err) {
      setStatusIsError(true);
      setStatus(customerError(err, "The upload did not go through. Please try again.").replace(/\s--\s/g, " — "));
    } finally {
      setBusy(false);
    }
  }

  /** Reads an unreadable document again from the PDF DearPolicy already
   * kept: nothing is re-uploaded, and it is the same request the locked-PDF
   * form uses, without a password. Offered on an unreadable document, and
   * (after a confirming click) on a ready one whose type or people were read
   * wrongly: re-reading rewrites its pages in place, and answers saved from
   * them are not withdrawn (open item C1-3). */
  async function retryReading(policy: Policy) {
    const label = documentName(policy);
    setRetryingId(policy.id);
    try {
      const response = await fetch("/api/policies/reprocess", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ policyId: policy.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not start reading it again.");
      setLibraryNotice(`Reading ${label} again…`);
      await refresh();
    } catch (err) {
      setLibraryNotice(customerError(err, "Could not start reading it again. Please try later."));
    } finally {
      setRetryingId(null);
    }
  }

  /** Give the password for a locked PDF that is already in the library:
   * it is read again with that password; nothing is re-uploaded. */
  async function unlock(policy: Policy, password: string) {
    const label = documentName(policy);
    const response = await fetch("/api/policies/reprocess", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ policyId: policy.id, pdfPassword: password }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Could not read it with that password.");
    setLibraryNotice(`Reading ${label} with the password you entered…`);
    await refresh();
  }

  // Who a document covers: one or several people (a group booklet names
  // the employee, spouse and children), each with the cover tier they hold
  // when the booklet has tiers.
  async function saveCoverage(policy: Policy, assignments: { familyMemberId: string; planTier: string | null }[]) {
    const label = documentName(policy);
    const response = await fetch("/api/policies/link-person", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ policyId: policy.id, assignments }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Could not save that");
    const names = assignments.map((a) => {
      const m = family.find((f) => f.id === a.familyMemberId);
      return m ? `${m.display_name}${a.planTier ? ` (${a.planTier})` : ""}` : null;
    }).filter(Boolean);
    setLibraryNotice(names.length
      ? `Saved — ${label} covers ${names.join(", ")}. Its benefits will now be used in answers for ${names.length === 1 ? "that person" : "each of them"}.`
      : `Saved — ${label} is not linked to anyone.`);
    await refresh();
  }

  async function linkPerson(policyId: string, detectedName: string, familyMemberId: string) {
    try {
      const response = await fetch("/api/policies/link-person", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policyId, detectedName, familyMemberId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not link person");
      setLibraryNotice(`Linked ${detectedName} to the selected family profile.`);
      await refresh();
    } catch (error) {
      setLibraryNotice(customerError(error, "Could not link that person. Please try again in a moment."));
    }
  }

  async function deleteDocument(policy: Policy) {
    // A document held in quarantine (or rejected by scanning) must still be
    // deletable -- it will otherwise sit at processing_status='queued'
    // (isProcessing()'s raw check) indefinitely, with no other way for the
    // person to remove it. See isQuarantineHeld()/isScanRejected() above.
    if (isProcessing(policy) && !isQuarantineHeld(policy) && !isScanRejected(policy)) return;
    const label = documentName(policy);
    // A native confirm() blocks the tab's whole event loop until dismissed --
    // an inline arm-then-confirm click (see the Delete button below) avoids
    // that while still requiring a deliberate second click first.
    if (confirmDeleteId !== policy.id) { setConfirmDeleteId(policy.id); return; }
    setConfirmDeleteId(null);
    setDeletingId(policy.id);
    try {
      const response = await fetch(`/api/policies/${policy.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not delete document");
      setLibraryNotice(`Deleted ${label}. It is no longer used in answers, and your portfolio has been updated.`);
      await refresh();
    } catch (error) {
      setLibraryNotice(customerError(error, "Could not delete that document. Please try again in a moment."));
    } finally {
      setDeletingId(null);
    }
  }

  const forPerson = useMemo(() => policies.filter((p) => !personId || p.linked_people.some((l) => l.id === personId)), [policies, personId]);
  const shown = useMemo(
    () => forPerson.filter((p) => filter === "all" || filter === "personal" && isOwnDocument(p) || filter === "reference" && !isOwnDocument(p) || false),
    [forPerson, filter],
  );
  const counts = {
    personal: forPerson.filter(isOwnDocument).length,
    reference: forPerson.filter((p) => !isOwnDocument(p)).length,
  };


  return <div className="page">
    <header className="page-header compact"><div><div className="eyebrow">INSURANCE LIBRARY</div><h1>Upload whatever your insurer sent you.</h1><p className="lead">Upload any policy, certificate, schedule, summary, renewal notice or receipt. DearPolicy reads it, works out who it covers and finds any premium paid.</p></div></header>


    {pollingPaused && <div className="processing-banner"><div><strong>Still processing in the background.</strong><small> Automatic updates paused after ten minutes — <button className="mini-button" onClick={() => { pollingSince.current = Date.now(); setPollingPaused(false); void refresh(); }}>Check again</button></small></div></div>}
    {activeCount > 0 && !pollingPaused && <div className="processing-banner"><span className="processing-spinner"/><div><strong>DearPolicy is reading your {activeCount === 1 ? "document" : "documents"}</strong><small>This page updates on its own. You can keep using the app.</small></div></div>}


    <section className="upload-panel">
      {/* On a phone the file comes first, as one large target; who it is for is optional, and a password is asked
          only once a PDF is chosen. What happened shows right under the button, where the thumb just was. */}
      <form onSubmit={upload} className="upload-form">
        <div className="field upload-pick">
          <input id="up-file" ref={fileInput} type="file" className="upload-file-input" accept="application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png,image/webp,.webp,image/tiff,.tif,.tiff,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx" onChange={(e) => { const next = e.target.files?.[0] ?? null; setFile(next); if (!next || !isPdf(next)) setPdfPassword(""); }}/>
          <label htmlFor="up-file" className={`upload-drop${file ? " chosen" : ""}`} data-testid="upload-drop">
            <span className="upload-drop-title">Insurance document</span>
            {file
              ? <><span className="upload-drop-file">{file.name}</span><span className="upload-drop-hint">{fileSize(file.size)} · choose another</span></>
              : <><span className="upload-drop-cta">Choose a file or take a photo</span><span className="upload-drop-hint">A PDF, a scan or a photo, up to {MAX_UPLOAD_LABEL}</span></>}
          </label>
        </div>
        <div className="field"><label htmlFor="up-profile">Who is this for? <span>(optional)</span></label><select id="up-profile" value={memberId} onChange={(e) => setMemberId(e.target.value)}><option value="">Not sure: DearPolicy checks names</option>{family.map((m) => <option value={m.id} key={m.id}>{m.display_name} · {m.relationship}</option>)}</select></div>
        {file && isPdf(file) ? <div className="field"><label htmlFor="up-password">PDF password <span>(only if it asks for one)</span></label><input id="up-password" type="password" autoComplete="off" value={pdfPassword} onChange={(e) => setPdfPassword(e.target.value)} placeholder="Leave blank if not required" aria-describedby="up-password-note"/><small id="up-password-note" className="field-note">Used only to read this file, and not stored.</small></div> : null}
        <button disabled={busy || !file} className="button primary" type="submit">{busy ? "Uploading…" : "Upload & analyse"}</button>
        {status && <div ref={statusBox} className={`upload-status${statusIsError ? " error" : ""}`} role={statusIsError ? "alert" : "status"}>{statusIsError && !/^Finished/.test(status) && <strong>Not uploaded. </strong>}{status}{/^Your documents are ready/.test(status) && <> <Link className="text-link" href="/chat">Ask anything about them →</Link></>}</div>}
      </form>
    </section>

    <section className="trust-strip" aria-label="What DearPolicy does with an upload"><div><b>1</b><span><strong>Reads it</strong><small>Policy, schedule, wording, brochure or receipt</small></span></div><div><b>2</b><span><strong>Finds who it covers</strong><small>From the names printed in it</small></span></div><div><b>3</b><span><strong>Shows the page</strong><small>Every answer says where it comes from</small></span></div></section>

    <section className="section">
      <div className="section-heading"><div><div className="eyebrow">DOCUMENTS</div><h2>Your insurance library</h2></div></div>
      <div className="filter-pills"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All <b>{forPerson.length}</b></button><button className={filter === "personal" ? "active" : ""} onClick={() => setFilter("personal")}>Your policies <b>{counts.personal}</b></button><button className={filter === "reference" ? "active" : ""} onClick={() => setFilter("reference")}>General wording <b>{counts.reference}</b></button></div>
      {personId && <p className="document-person-filter" data-testid="person-filter">Showing documents linked to <b>{family.find((m) => m.id === personId)?.display_name ?? "one person"}</b>. <button type="button" className="text-link" onClick={() => { setPersonId(null); window.history.replaceState(null, "", "/policies"); }}>Show all documents</button></p>}

      {libraryNotice && <div className="upload-status library-notice" role="status" data-testid="library-notice">{libraryNotice}{undoNotFamily?.notice === libraryNotice && <button type="button" className="mini-button" onClick={undoMarkNotFamily}>Undo</button>}<button type="button" className="mini-button" onClick={() => { setLibraryNotice(""); setUndoNotFamily(null); }} aria-label="Dismiss">✕</button></div>}
      <div className="document-list">{shown.map((policy) => {
        const quarantineHeld = isQuarantineHeld(policy);
        const scanRejected = isScanRejected(policy);
        // A document held in quarantine (or rejected outright) still sits at
        // processing_status='queued' the entire time -- lib/rag/ingest.ts's
        // processPolicy() gate returns before ever touching that column --
        // so it is deliberately excluded from "processing" here. Otherwise
        // the existing "Analysis in progress" bar below and the new
        // quarantine banner would render at the same time and contradict
        // each other.
        const processing = isProcessing(policy) && !quarantineHeld && !scanRejected;
        const unmatched = policy.detected_people.filter((p) => !p.matchedFamilyMemberId && !notFamily.includes(`${policy.id}:${p.name}`));
        const referenceLinks = policy.linked_people.filter((p) => p.source === "scheme_reference_match");
        const personalLinks = policy.linked_people.filter((p) => p.source !== "scheme_reference_match");
        const pct = Math.max(0, Math.min(100, Number(policy.processing_progress ?? 0)));
        return <div className={`document-card ${policy.needs_review ? "needs-review" : ""} ${processing ? "processing" : ""}`} key={policy.id} id={`doc-${policy.id}`} data-policy-id={policy.id}>
          <div className="document-head">
            <div className="policy-logo">{(policy.insurer ?? policy.original_filename).slice(0, 2).toUpperCase()}</div>
            <div className="document-title"><strong>{documentName(policy)}</strong>{documentName(policy) !== policy.original_filename?.trim() && <small className="document-file">{policy.original_filename}</small>}{policy.processing_status === "failed" && !processing ? null : <span>{processing ? "Usually ready in under a minute" : [policy.insurer ?? "Insurer not known yet", (readAsPolicyDocument(policy) ? "Policy document" : roleLabel(policy.document_role)), authorityLabel(policy)].join(" · ")}</span>}
              {!processing && !quarantineHeld && !scanRejected && <em className={`status ${policy.processing_status}`}>{policy.processing_status === "ready" ? (/^Read in part\b/.test(policy.processing_message ?? "") ? "Read in part" : "Ready") : stageLabel(policy.processing_stage, policy.processing_status)}</em>}</div>
          </div>

          {/* Whose it is, then what was found in it: the two things a person checks first. */}
          {!processing && policy.personal_coverage_confirmed && !!personalLinks.length && <p className="document-for"><b>For</b> {personalLinks.map((p) => p.name).join(", ")}</p>}


          {(quarantineHeld || scanRejected) && <div className={`accuracy-warning ${scanRejected ? "danger" : ""}`}>
            <b>{scanRejected ? "Rejected" : documentSafetyMode === "not_scanned_prototype" ? "Received" : "Scanning"}</b>
            <span>{quarantineLabel(policy, documentSafetyMode)}{scanRejected ? " — this file will not be analysed or used to answer questions. Delete it and upload the document again." : ""}</span>
          </div>}

          {processing && <div className="document-progress" aria-live="polite">
            <div className="document-progress-copy"><strong>{policy.processing_stalled ? "Taking longer than usual" : "Reading this document…"}</strong></div>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.max(4, pct)}%` }}/></div>
            {/* Stalled means nothing is reading it now: say so and offer to start it, never "will keep trying" (25 Oct). */}
            {policy.processing_stalled
              ? <><small>Reading has not started. Nothing is lost, and you do not need to upload it again.</small><div className="row-error-actions"><button type="button" className="mini-button" disabled={busy || !!deletingId || retryingId === policy.id} onClick={() => void retryReading(policy)}>{retryingId === policy.id ? "Starting…" : "Try again"}</button></div></>
              : <small>You can keep using the app while this finishes.</small>}
          </div>}

          {/* Read in part: which pages, and the next step that can work (lib/documents/failure-advice.ts). It already says
              that those amounts are not used, so "Not fully confirmed" is not shown under it as well. */}
          {(() => {
            const part = !processing && policy.processing_status === "ready" ? readInPartAdvice(policy.processing_message) : null;
            return <>
              {part && <div className="accuracy-warning" data-testid="read-in-part"><b>Read in part</b><span>{part.what}</span><small>{part.next}</small></div>}
              {!part && !processing && policy.needs_review && !policy.processing_error && <div className="accuracy-warning"><b>Not fully confirmed</b><span>Some details in this document could not be matched to the page they came from, so DearPolicy does not use them in answers yet.</span></div>}
            </>;
          })()}

          {!processing && policy.personal_coverage_confirmed ? <>
            {/* Names printed in it: matched ones in one quiet line; each unmatched one asks who it is. */}
            {policy.detected_people.some((p) => p.matchedFamilyMemberId) && <p className="document-names">Named in it: {policy.detected_people.filter((p) => p.matchedFamilyMemberId).map((p) => `${p.name} (${family.find((m) => m.id === p.matchedFamilyMemberId)?.display_name ?? "matched"})`).join(", ")}</p>}
            {!!unmatched.length && <div className="detected-block">{unmatched.map((person) => <div className="detected-row" key={person.name}>
              <label htmlFor={`who-${policy.id}-${person.name}`}>&ldquo;{person.name}&rdquo; is named in it. Who is this?</label>
              <select id={`who-${policy.id}-${person.name}`} defaultValue="" onChange={(e) => { const select = e.target; if (select.value === "__not_family") void markNotFamily(policy.id, person.name).then((taken) => { if (!taken) select.value = ""; }); else if (select.value) void linkPerson(policy.id, person.name, select.value); }}><option value="">Choose a family member…</option>{family.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}<option value="__not_family">Not in my family</option></select>
            </div>)}<small className="muted">Until you choose, nothing in it is used for that person.</small></div>}
          </> : !processing && policy.processing_status === "ready" ? <CoversPicker policy={policy} family={family} planChoice={planChoice} onSave={(a) => saveCoverage(policy, a)} referenceLinks={referenceLinks.map((p) => p.name)} /> : null}

          {!processing && policy.processing_status === "ready" && (() => {
            const state = benefitReading[policy.id];
            const labels = found[policy.id] ?? [];
            if (state && (state.state === "failed" || state.state === "backed_off")) return <p className="document-found warn" data-testid="document-found">Its benefits couldn&rsquo;t be read for Coverage yet{state.reason ? `: ${state.reason.charAt(0).toLowerCase()}${state.reason.slice(1).replace(/\.?\s*$/, ".")}` : "."}{state.state === "backed_off" && state.retryAfter ? " DearPolicy tries again later on its own." : ""} You can still ask about it.</p>;
            if (state) return <p className="document-found" data-testid="document-found">Reading its benefits for Coverage…</p>;
            if (labels.length) return <p className="document-found" data-testid="document-found"><b>Found</b> {foundLine(labels)}. <Link className="text-link" href="/ledger">See in Coverage →</Link></p>;
            return null;
          })()}
          {/* Why, and the one next step that can work for this kind of failure (lib/documents/failure-advice.ts). */}
          {!processing && policy.processing_error && (() => {
            const advice = failedDocumentAdvice(policy.processing_error, { hasPages: !!policy.page_count });
            if (advice.nextStep === "unlock") return <LockedPdf policy={policy} wrong={advice.kind === "password_wrong"} onUnlock={(password) => unlock(policy, password)} />;
            return <div className="row-error processing-error" data-testid="document-unreadable" data-failure={advice.kind}><strong>This document could not be read</strong><span>{advice.reason}</span><small>{advice.hint}</small>
              <div className="row-error-actions">{advice.nextStep === "upload_another"
                ? <button type="button" className="mini-button" onClick={chooseAnother}>{advice.action}</button>
                : <button type="button" className="mini-button" disabled={busy || !!deletingId || retryingId === policy.id} onClick={() => void retryReading(policy)}>{retryingId === policy.id ? "Starting…" : advice.action}</button>}</div></div>;
          })()}

          {/* Its numbers and the actions on it come last. */}
          <div className="document-meta">{policy.policy_number && <span>Policy {policy.policy_number}</span>}{policy.group_policy_number && <span>Group {policy.group_policy_number}</span>}{(policy.quarantine_status === "scan_clean" || policy.quarantine_status === "not_scanned_prototype") && <PreviewLink policy={policy} />}{!processing && policy.processing_status === "ready" && <button className="mini-button" onClick={() => setDetailsId(detailsId === policy.id ? null : policy.id)}>{detailsId === policy.id ? "Hide details" : "Details"}</button>}{!processing && policy.processing_status === "ready" && <button type="button" className="mini-button" title="Read this document again from the file DearPolicy kept. People you chose for it stay chosen." disabled={busy || !!deletingId || retryingId === policy.id} onClick={() => { if (confirmRereadId === policy.id) { setConfirmRereadId(null); void retryReading(policy); } else setConfirmRereadId(policy.id); }}>{retryingId === policy.id ? "Starting…" : confirmRereadId === policy.id ? "Confirm read again" : "Read again"}</button>}{confirmRereadId === policy.id && <><button type="button" className="mini-button" onClick={() => setConfirmRereadId(null)}>Cancel</button><small className="reread-note" data-testid="reread-note">Coverage for this document is unavailable for a minute while it&rsquo;s read again.</small></>}<button className="mini-button danger" disabled={(processing && !policy.processing_stalled) || busy || !!deletingId} onClick={() => deleteDocument(policy)}>{deletingId === policy.id ? "Deleting…" : confirmDeleteId === policy.id ? "Confirm delete" : "Delete"}</button>{confirmDeleteId === policy.id && <button className="mini-button" onClick={() => setConfirmDeleteId(null)}>Cancel</button>}</div>

          {detailsId === policy.id && <PolicyDetailsPanel policyId={policy.id} />}
        </div>;
      })}{!shown.length && <div className="empty-card">{!loaded ? "Loading your documents…" : policies.length ? "No documents in this view." : "No documents yet. Upload a policy schedule, certificate, renewal notice or benefits booklet above."}</div>}</div>
    </section>
  </div>;
}

/** Opens the stored file itself, so a person can see which document this is when its file name says nothing. The
 * server checks the household and the security scan on every open (app/api/policies/[id]/file); it is offered only once
 * the scan has cleared the file, as the server requires. A Word file can't be shown in a browser, so it downloads. */
function PreviewLink({ policy }: { policy: Named & Pick<Policy, "id"> }) {
  const word = /\.docx$/i.test(policy.original_filename ?? "");
  return <a className="mini-button" href={`/api/policies/${policy.id}/file`} target="_blank" rel="noopener noreferrer"
    aria-label={`${word ? "Download" : "Preview"} ${documentName(policy)}`}>{word ? "Download" : "Preview"}</a>;
}

/** A locked PDF already in the library: enter its password here and it is
 * read again -- no delete, no re-upload. Says plainly whether a password
 * was missing or did not work. */
function LockedPdf({ policy, wrong, onUnlock }: { policy: Policy; wrong: boolean; onUnlock: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = `unlock-${policy.id}`;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password) { setError("Enter the PDF's password."); return; }
    setBusy(true); setError("");
    try { await onUnlock(password); setPassword(""); }
    catch (err) { setError(customerError(err, "Could not read it with that password. Please try again.")); }
    finally { setBusy(false); }
  }
  return <div className="row-error processing-error locked-pdf" data-testid="document-locked">
    <strong>{wrong ? "The password didn’t work" : "This PDF is password-protected"}</strong>
    <span>{wrong ? "DearPolicy tried the password you gave, but the PDF did not open. Check it (passwords are case-sensitive) and try again." : "Enter the password your insurer gave you for this PDF and DearPolicy will read it."}</span>
    <form onSubmit={submit} className="unlock-form">
      <label htmlFor={id}>PDF password</label>
      <input id={id} type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="submit" className="mini-button" disabled={busy}>{busy ? "Reading…" : wrong ? "Try again" : "Unlock and read"}</button>
    </form>
    {error && <small role="alert">{error}</small>}
    <small>The password is used only to read this document and is not stored.</small>
  </div>;
}

/** Who a document covers. A booklet can cover several people (employee,
 * spouse, children): each family member is a toggle -- press everyone it
 * covers -- and, when the booklet has cover tiers, each covered person gets
 * a tier (only where the household's answers read it: lib/policies/plan-choice.ts).
 * Every change is saved at once and confirmed. People the booklet
 * names are pointed out. */
function CoversPicker({ policy, family, planChoice, onSave, referenceLinks }: { policy: Policy; family: Member[]; planChoice: boolean; onSave: (assignments: { familyMemberId: string; planTier: string | null }[]) => Promise<void>; referenceLinks: string[] }) {
  const tiers = policy.tier_options ?? [];
  const named = policy.named_tiers ?? [];
  const namedFor = (m: Member) => named.find((n) => {
    const a = n.name.toLowerCase(), b = m.display_name.toLowerCase();
    return a === b || a.includes(b) || b.includes(a);
  });
  const covered = policy.linked_people.filter((p) => p.source !== "scheme_reference_match");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const current = () => covered.map((p) => ({ familyMemberId: p.id, planTier: p.planTier ?? null }));
  async function save(next: { familyMemberId: string; planTier: string | null }[]) {
    setBusy(true); setError("");
    try { await onSave(next); setSaved(true); }
    catch (err) { setError(customerError(err, "Could not save that. Please try again in a moment.")); }
    finally { setBusy(false); }
  }
  function toggle(m: Member) {
    const on = covered.some((p) => p.id === m.id);
    const next = on ? current().filter((a) => a.familyMemberId !== m.id)
      : [...current(), { familyMemberId: m.id, planTier: namedFor(m)?.tier ?? null }];
    void save(next);
  }
  function setTier(memberId: string, tier: string) {
    void save(current().map((a) => a.familyMemberId === memberId ? { ...a, planTier: tier || null } : a));
  }
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!saved) return; const t = setTimeout(() => setSaved(false), 2500); return () => clearTimeout(t); }, [saved]);
  const summary = covered.map((p) => p.planTier ? `${p.name} (${p.planTier})` : p.name).join(", ");
  // A household whose answers never read the plan is not asked for it (lib/policies/plan-choice.ts); stored plans stay.
  const { planMissing, tierSelect } = coversPlanPrompt({ tierOptions: tiers, covered, planChoice });
  // Always one line until "Change" opens it: a library of reference documents would otherwise be a wall of empty choices.
  // A reference document already used as matching wording for someone's plan says whose; only one linked to nobody at
  // all says "nobody yet" and what choosing does.
  const linked = covered.length > 0 || referenceLinks.length > 0;
  if (!open) return <div className={`covers-summary${linked ? "" : " empty"}`} data-testid="covers-picker">
    {covered.length
      ? <span><b>Applies to</b> {summary}{planMissing && <small className="covers-plan-missing"> · plan not chosen yet</small>}</span>
      : referenceLinks.length
        ? <span><b>Used for</b> {referenceLinks.join(", ")}<small className="covers-plan-missing"> · as the wording for their plan</small></span>
        : <span><b>Applies to</b> nobody yet<small className="covers-plan-missing"> · choose who it applies to so answers can use it</small></span>}
    {saved && <span className="covers-saved" role="status">Saved</span>}
    <button type="button" className="mini-button" onClick={() => setOpen(true)} aria-expanded={false}>{linked ? "Change" : "Choose"}</button>
  </div>;
  return <div className="reference-explainer covers-picker" data-testid="covers-picker"><span className="reference-icon">i</span><div>
    <strong>Who does this document cover?</strong>
    <p>Tap everyone it covers. DearPolicy then uses it when you ask about them.{named.length ? ` It names ${named.map((n) => n.name).join(", ")}.` : ""}</p>
    <div className="declare-owner covers-chips" role="group" aria-label="Family members this document covers">{family.map((m) => {
      const on = covered.some((p) => p.id === m.id);
      return <button key={m.id} type="button" className={`chip-toggle${on ? " on" : ""}`} aria-pressed={on} disabled={busy} onClick={() => { setSaved(false); toggle(m); }}>
        <span className="chip-check" aria-hidden="true">{on ? "\u2713" : ""}</span>{m.display_name}{!on && namedFor(m) ? <small> · named in it</small> : null}
      </button>;
    })}</div>
    {tierSelect && <div className="covers-list">{covered.map((p) => (
      <div className="covers-row" key={p.id}>
        <label htmlFor={`tier-${policy.id}-${p.id}`}>{p.name}&rsquo;s cover (which plan?)</label>
        <select id={`tier-${policy.id}-${p.id}`} value={p.planTier ?? ""} disabled={busy} onChange={(e) => { setSaved(false); setTier(p.id, e.target.value); }}>
          <option value="">Not sure</option>
          {tiers.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
    ))}</div>}
    <p className="covers-note">Amounts in it stay the document&rsquo;s own figures until a schedule or statement confirms yours.</p>
    {error && <small role="alert" className="row-error">{error}</small>}
    {referenceLinks.length > 0 && <small>Also available as matching wording for {referenceLinks.join(", ")}.</small>}
    <div className="covers-actions"><button type="button" className="mini-button" onClick={() => setOpen(false)} disabled={busy}>Done</button>{busy ? <span className="covers-saved" role="status">Saving…</span> : saved && !error ? <span className="covers-saved" role="status">Saved</span> : null}</div>
  </div></div>;
}

type PolicyDetailsPayload = {
  document: Record<string, unknown> & { needsReview?: boolean; reviewReason?: string | null };
  linkedMembers: { id: string; display_name: string; source: string; confidence: number | string | null }[];
  detectedPeople: { detected_name: string; matched_family_member_id: string | null; confidence: number | string | null }[];
  coverages: { category: string; amount: number | string | null; currency: string | null; product_name: string | null; source_page: number | null; evidence_text: string | null; evidence_verified: boolean; member_name: string }[];
  referenceCoverages: { category: string; product_name: string | null; source_page: number | null }[];
  premiums: { amount: number | string | null; currency: string | null; frequency: string | null; payment_date: string | null; source_page: number | null }[];
  extracted: { documentType: string | null; documentNotes: string[]; productsMentioned: string[]; keyExclusions: string[]; waitingPeriods: string[]; deductiblesAndCoinsurance: string[]; riders: string[]; premium: { amount: number | null; currency: string | null; frequency: string | null } | null };
  corrections: { field_name: string; corrected_value: unknown; created_at: string }[];
};

/** How an extracted amount is shown on the review screen: with its currency
 * when the document stated one, otherwise honestly without one -- a missing
 * currency is never rendered as SGD. */
function reviewAmount(amount: number | string | null, currency: string | null): string {
  if (amount == null) return "—";
  const numeric = Number(amount);
  return currency ? `${currency} ${numeric.toLocaleString()}` : `${numeric.toLocaleString()} (currency not stated)`;
}
/** A cover line's figure: a figure paid per period carries its printed period, and a periodic cover's figure with none
 * is not shown (lib/coverage/line-period.ts), as on Home and Coverage. */
function coverFigure(c: { category: string; amount: number | string | null; currency: string | null; evidence_text: string | null }): string {
  const f = lineFigure(c.category, c.amount == null ? null : Number(c.amount), c.evidence_text);
  if (c.amount != null && f.amount == null) return "see the document for how much it pays";
  return reviewAmount(f.amount, c.currency) + (f.period ? " " + linePeriodWords(f.period) : "");
}
const showValue = (value: unknown) => (value == null || value === "" ? "Not stated in this document" : String(value));

/** What one document establishes, for the household: its identity, whose it
 * is, the cover it confirms (with page and whether the amount was checked
 * against that page) and its conditions. Extraction internals -- confidence
 * scores, stored page counts, field corrections -- are operator-only
 * (/operator/documents). */
function PolicyDetailsPanel({ policyId }: { policyId: string; onCorrected?: () => void }) {
  const [data, setData] = useState<PolicyDetailsPayload | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/policies/${policyId}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error);
      setData(payload);
    } catch (err) { setError(customerError(err, "The details of this document could not be loaded. Please try again.")); }
  }, [policyId]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <div className="detail-panel"><span className="row-error">{error}</span></div>;
  if (!data) return <div className="detail-panel">Loading…</div>;
  const d = data.document as Record<string, string | number | boolean | null>;
  const conditions = [...data.extracted.waitingPeriods, ...data.extracted.keyExclusions, ...data.extracted.deductiblesAndCoinsurance];
  return (
    <div className="detail-panel" data-testid="policy-details">
      <div className="detail-grid">
        <div><label>Insurer</label><span data-testid="detail-insurer">{showValue(d.insurer)}</span></div>
        <div><label>Product</label><span data-testid="detail-product">{showValue(d.productName)}</span></div>
        <div><label>Policy number</label><span data-testid="detail-policy-number">{showValue(d.policyNumber)}</span></div>
        <div><label>Effective date</label><span>{showValue(d.effectiveDate)}</span></div>
        <div><label>Expiry / renewal</label><span data-testid="detail-expiry">{showValue(d.renewalOrExpiryDate)}</span></div>
        <div><label>What it is</label><span>{showValue(d.authorityLabel ?? d.documentRole)}</span></div>
      </div>
      {!!data.linkedMembers.length && <div className="detail-section"><b>Whose cover</b>{[...new Map(data.linkedMembers.map((m) => [m.id, m] as const)).values()].map((m) => <div key={m.id}>{m.display_name}</div>)}</div>}
      {!!data.coverages.length && <div className="detail-section"><b>Cover this document confirms</b>{data.coverages.map((c, i) => <div key={i} data-testid="detail-coverage">{c.member_name}: {c.category} · {coverFigure(c)}{c.source_page ? <small> · page {c.source_page}</small> : null}{c.evidence_verified ? <small className="matched"> · source-verified</small> : <small className="muted"> · amount not yet confirmed against the page</small>}</div>)}</div>}
      {!!data.referenceCoverages.length && <div className="detail-section"><b>Benefits it describes</b>{data.referenceCoverages.map((c, i) => <div key={i}>{c.category}{c.product_name ? ` · ${c.product_name}` : ""}{c.source_page ? <small> · page {c.source_page}</small> : null}</div>)}</div>}
      {!!data.premiums.length && <div className="detail-section"><b>Premiums</b>{data.premiums.map((p, i) => <div key={i}>{reviewAmount(p.amount, p.currency)}{p.frequency ? ` · ${p.frequency}` : ""}{p.payment_date ? ` · ${p.payment_date}` : ""}{p.source_page ? <small> · page {p.source_page}</small> : null}</div>)}</div>}
      {!!data.extracted.riders.length && <div className="detail-section"><b>Riders</b>{data.extracted.riders.map((w, i) => <div key={i}>{w}</div>)}</div>}
      {!!conditions.length && <details className="detail-section source-details"><summary>Waiting periods, exclusions and deductibles</summary>{conditions.map((w, i) => <div key={i}>{w}</div>)}</details>}
    </div>
  );
}
