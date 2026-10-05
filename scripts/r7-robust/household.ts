/**
 * Round 7 independent households (scripts/fixtures/r7-independent, written by an author
 * who never read the app code), loaded through the REAL ingestion path.
 *
 * PGlite with every production schema file; each household is its own
 * account; every document is stored and read by processPolicy() exactly as
 * an upload is. The deterministic model stand-in plays the reading model:
 * for these documents it returns what a competent reading model would
 * return -- the manifest's identity facts (insurer, product, policy number,
 * role, people, dates, premium) plus every printed amount as a coverage,
 * each with the printed line it was read from -- and, for the image-only
 * page, the battery's own OCR transcript (noise and all). Everything
 * downstream (verification against the page text, linking people, the
 * benefit catalog, the coverage ledger, the chat) is production code, so
 * reading defects show up as chat defects.
 *
 * Deleted documents are uploaded, read and then deleted through the user's
 * DELETE route (soft delete), so deletion is exercised.
 */
import { rmSync } from "node:fs";
import { readFile, mkdtemp, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { installDatabase } from "../r6/fixture";

export const ROOT = path.resolve("scripts/fixtures/r7-independent");
export const HOUSEHOLDS = ["H1-tan", "H2-aisyah", "H3-ong"] as const;
export type HouseholdId = (typeof HOUSEHOLDS)[number];

export type Member = { id: string; display_name: string; preferred_name: string; relationship: string; dob?: string };
export type Fact = { id: string; label: string; value: string; page: number; line_contains?: string; tier?: string; member?: string };
export type Doc = {
  id: string; filename: string; file_b64: string; insurer: string; product_name: string; policy_number: string; policy_type: string; document_role: string;
  covers: string[]; policyholder: string; effective_date?: string | null; renewal_or_expiry_date?: string | null; document_date?: string | null; currency: string;
  fixture_state: "active" | "deleted"; member_tiers?: Record<string, string>; cover_by_member?: Record<string, string[]>; facts: Fact[]; title?: string;
  pages: { page: number; text_layer: boolean }[];
};
export type Manifest = { household_id: string; account_owner: string; members: Member[]; documents: Doc[]; traps: string[] };

export type LoadedHousehold = {
  id: HouseholdId; account: string; manifest: Manifest;
  /** manifest member id -> family_members.id */
  memberIds: Record<string, string>;
  /** manifest document id -> policies.id */
  docIds: Record<string, string>;
  /** manifest document id -> why ingestion could not read it */
  readFailures: Record<string, string>;
};

const n2 = (i: number) => String(i).padStart(2, "0");
export const accountOf = (h: number) => "00000000-0000-0000-0000-00000000a7" + n2(h);
const memberUuid = (h: number, i: number) => "70000000-0000-4000-8000-0000000" + n2(h) + "0" + n2(i);
const policyUuid = (h: number, i: number) => "70000000-0000-4000-8000-0000001" + n2(h) + "0" + n2(i);

export async function readManifest(h: HouseholdId): Promise<Manifest> {
  return JSON.parse(await readFile(path.join(ROOT, h, "manifest.json"), "utf8")) as Manifest;
}

const ROLE: Record<string, string> = { certificate: "certificate", benefit_guide: "benefit_guide", statement: "annual_statement", endorsement: "endorsement",
  lapse_notice: "other", premium_receipt: "premium_receipt" };
const CATEGORY: Record<string, string> = { Health: "Hospitalisation", Life: "Life", "Critical illness": "Critical illness", "Personal accident": "Personal accident", Travel: "Travel",
  Endowment: "Endowment", "Investment-linked": "Investment-linked", "Long-term care": "Long-term care", "Universal life": "Life", "Health rider": "Outpatient", Home: "Home" };
const MONEY = /(US\$|USD|S\$|SGD)\s?([\d,]+(?:\.\d+)?)/;
const NOT_COVER = /premium|payable|cash|medisave|receipt|received|interest|fund value|account value|units|projected|payout|from medisave/i;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
/** The printed line (from the text the app read) that carries a value. */
function printedLine(text: string, value: string, near?: string): string | null {
  const v = squash(value).toLowerCase();
  const lines = text.split(/\n/).map(squash).filter(Boolean);
  const hit = lines.find((l) => l.toLowerCase().includes(v) && (!near || l.toLowerCase().includes(near.toLowerCase()))) ?? lines.find((l) => l.toLowerCase().includes(v));
  return hit ? hit.slice(0, 240) : null;
}
const iso = (d?: string | null) => (d && /^\d{4}-\d\d-\d\d$/.test(d) ? d : null);

/** What a competent reading model returns for one manifest document, its
 * evidence lines taken from the text the production code actually sent. */
export function oracleExtraction(doc: Doc, manifest: Manifest, text: string) {
  const person = (id: string) => manifest.members.find((m) => m.id === id);
  // A competent reader names the role the page's own title gives: a
  // "POLICY SCHEDULE" or "POLICY SUMMARY" for one person is their schedule;
  // only a page titled as a certificate is one.
  const opening = text.split(/\n/).slice(0, 12).join(" ");
  const role = doc.document_role === "certificate" && !/certificate/i.test(opening) ? "personal_schedule"
    : doc.document_role === "endorsement" && !/endorsement|amendment/i.test(opening) ? "insurer_letter" : ROLE[doc.document_role] ?? "other";
  const personal = ["certificate", "personal_schedule", "endorsement", "annual_statement"].includes(role) && doc.policy_type !== "Group";
  const coverage = (f: Fact) => {
    const m = f.value.match(MONEY);
    if (!m) return null;
    const usd = /^US|USD/.test(m[1]);
    const evidence = printedLine(text, f.value, f.line_contains) ?? printedLine(text, m[0]);
    return { category: CATEGORY[doc.policy_type] ?? doc.policy_type, productName: doc.product_name, policyNumber: doc.policy_number,
      amount: Number(m[2].replace(/,/g, "")), currency: usd ? "USD" : "SGD", notes: f.label.replace(/\s*\((?:applies|does NOT apply|superseded)\)/i, ""),
      sourcePage: f.page, evidenceText: evidence, evidenceVerified: false };
  };
  const covers = doc.covers.map(person).filter((m): m is Member => !!m);
  const groupTier = (id: string) => doc.member_tiers?.[id] ?? null;
  const insuredPeople = covers.map((m) => {
    let facts = doc.facts.filter((f) => !NOT_COVER.test(f.label) && !/does NOT apply/i.test(f.label));
    if (doc.member_tiers) {
      const tier = groupTier(m.id);
      const subs = doc.cover_by_member?.[m.id] ?? [];
      facts = facts.filter((f) => (f.tier ? f.tier === tier : subs.some((s) => f.label.toUpperCase().includes(s))));
    }
    return { name: m.display_name,
      relationshipHint: doc.member_tiers ? (groupTier(m.id) ?? "").toLowerCase() || null : m.relationship === "self" ? null : m.relationship,
      // A reader states one cover amount per kind of cover (the sum assured or the headline benefit); the
      // rest of a schedule's rows are its benefits, read from the pages. Every fact as a separate cover of
      // the same kind would read as a document contradicting itself.
      coverages: role === "premium_receipt" || role === "other" ? [] : primaryCover(facts.map((f) => ({ f, c: coverage(f) })).filter((x): x is { f: Fact; c: NonNullable<ReturnType<typeof coverage>> } => !!x.c)) };
  });
  const premiumFact = doc.facts.find((f) => /premium/i.test(f.label) && !/original|superseded|medisave|cash|msl|additional|dependant|rider|spouse|child/i.test(f.label) && MONEY.test(f.value))
    ?? doc.facts.find((f) => /premium/i.test(f.label) && MONEY.test(f.value) && !/original|superseded/i.test(f.label));
  const pm = premiumFact?.value.match(MONEY);
  const premiumLine = premiumFact ? printedLine(text, premiumFact.value, premiumFact.line_contains) ?? "" : "";
  const frequency = /month/i.test(premiumLine) ? "monthly" : pm ? "annual" : null;
  const receipt = role === "premium_receipt" ? doc.facts.find((f) => /receipt amount|amount/i.test(f.label) && MONEY.test(f.value)) : null;
  const rm = receipt?.value.match(MONEY);
  const payer = doc.policyholder.startsWith("joint") ? null : person(doc.policyholder)?.display_name ?? null;
  const employer = doc.policyholder.startsWith("employer:") ? doc.policyholder.slice(9).trim() : null;
  return {
    documentType: doc.title ?? null, documentRole: role, documentNotes: doc.document_role === "lapse_notice" ? ["Lapse notice"] : [],
    insurer: doc.insurer, productName: doc.product_name, productsMentioned: [], policyNumber: doc.policy_type === "Group" ? null : doc.policy_number,
    groupPolicyNumber: doc.policy_type === "Group" ? doc.policy_number : null, policyType: doc.policy_type,
    policyholder: employer ?? (doc.policyholder.startsWith("joint") ? covers.map((m) => m.display_name).join(" and ") : payer),
    personalCoverageConfirmed: personal, startDate: iso(doc.effective_date) ?? iso(doc.document_date), renewalOrExpiryDate: iso(doc.renewal_or_expiry_date),
    insuredPeople, referenceCoverages: [],
    premium: { amount: pm && role !== "premium_receipt" ? Number(pm[2].replace(/,/g, "")) : null, currency: pm ? (/^US|USD/.test(pm[1]) ? "USD" : "SGD") : null, frequency: role !== "premium_receipt" ? frequency : null },
    paymentRecords: rm ? [{ insuredPersonName: covers[0]?.display_name ?? null, insurer: doc.insurer, productName: doc.product_name, policyNumber: doc.policy_number,
      amount: Number(rm[2].replace(/,/g, "")), currency: "SGD", frequency: "annual", paymentDate: iso(doc.document_date), periodStart: null, periodEnd: null, sourcePage: receipt!.page,
      notes: "Paid by " + (payer ?? "the policyholder"), evidenceText: printedLine(text, receipt!.value) }] : [],
    keyExclusions: [], waitingPeriods: [], deductiblesAndCoinsurance: [], riders: [],
  };
}

/** The one cover amount a reader states for a document's kind of cover. */
function primaryCover<T>(rows: { f: Fact; c: T }[]): T[] {
  if (!rows.length) return [];
  const amount = (r: { f: Fact }) => Number((r.f.value.match(/\d[\d,]*(?:\.\d+)?/)?.[0] ?? "0").replace(/,/g, ""));
  const headline = rows.find((r) => /\bsum (?:assured|insured)\b|\bdeath benefit\b|\bfirst-death\b|\bcover amount\b|\bbasic\b/i.test(r.f.label))
    ?? [...rows].sort((a, b) => amount(b) - amount(a))[0];
  return [headline.c];
}

/** The battery's OCR transcript of an image-only page. */
async function ocrTranscript(h: HouseholdId, doc: Doc): Promise<{ pageNumber: number; text: string }[]> {
  const raw = await readFile(path.join(ROOT, h, "docs", doc.filename + ".extracted.txt"), "utf8");
  const parts = raw.split(/^===== page (\d+)[^\n]*=====\n/m).slice(1);
  const out: { pageNumber: number; text: string }[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) out.push({ pageNumber: Number(parts[i]), text: parts[i + 1].trim() });
  return out;
}

export async function buildHouseholds(only?: HouseholdId[]): Promise<{ db: Awaited<ReturnType<typeof installDatabase>>; households: LoadedHousehold[]; storageDir: string; ingestMs: number }> {
  const storageDir = await mkdtemp(path.join(os.tmpdir(), "r7-chat-"));
  // The uploaded copies are removed when the run ends (a temp directory per build otherwise fills /tmp).
  process.once("exit", () => { try { rmSync(storageDir, { recursive: true, force: true }); } catch { /* best effort */ } });
  for (const d of ["policy", "evidence", "exports"]) await mkdir(path.join(storageDir, d), { recursive: true });
  Object.assign(process.env, { STORAGE_DRIVER: "local", LOCAL_STORAGE_DIR: path.join(storageDir, "policy"), LOCAL_CLAIM_EVIDENCE_DIR: path.join(storageDir, "evidence"), LOCAL_HOUSEHOLD_EXPORT_DIR: path.join(storageDir, "exports") });
  const db = await installDatabase();
  const { setDeterministicReadingOracles } = await import("@/lib/ai/deterministic-model");
  const { savePolicyFile } = await import("@/lib/storage");
  const { processPolicy } = await import("@/lib/rag/ingest");
  const { DELETE } = await import("@/app/api/policies/[id]/route");
  let current: { h: HouseholdId; doc: Doc; manifest: Manifest } | null = null;
  setDeterministicReadingOracles({
    reading: (text) => current && (text.includes(current.doc.policy_number) || current.doc.pages.some((p) => !p.text_layer)) ? oracleExtraction(current.doc, current.manifest, text) : null,
  });
  const started = Date.now();
  const households: LoadedHousehold[] = [];
  for (const [hi, h] of HOUSEHOLDS.entries()) {
    if (only && !only.includes(h)) continue;
    const manifest = await readManifest(h);
    const account = accountOf(hi + 1);
    await db.query("INSERT INTO accounts(id,name) VALUES($1,$2)", [account, manifest.household_id]);
    await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [account]);
    const memberIds: Record<string, string> = {};
    for (const [i, m] of manifest.members.entries()) {
      memberIds[m.id] = memberUuid(hi + 1, i + 1);
      await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship,date_of_birth,created_at) VALUES($1,$2,$3,$4,$5,$6,now()+($7||' seconds')::interval)",
        [memberIds[m.id], account, m.display_name, m.preferred_name, m.relationship, m.dob ?? null, String(i)]);
    }
    // Upload order: the manifest's, except the README's H3 rule (the 2025
    // endorsement before the 2021 schedule it amends).
    const docs = [...manifest.documents];
    const endorsement = docs.findIndex((d) => d.document_role === "endorsement" && docs.some((o) => o !== d && o.policy_number === d.policy_number && o.facts.some((f) => /superseded/i.test(f.label))));
    if (endorsement > 0) docs.unshift(...docs.splice(endorsement, 1));
    const docIds: Record<string, string> = {};
    const readFailures: Record<string, string> = {};
    for (const [di, doc] of docs.entries()) {
      const bytes = Buffer.from((await readFile(path.join(ROOT, h, "docs", doc.filename + ".b64"), "utf8")).replace(/\s+/g, ""), "base64");
      const policyId = policyUuid(hi + 1, di + 1);
      // Uploaded from the page of the person it is about (the account owner
      // for a joint or group document).
      const uploader = memberIds[doc.covers.length === 1 ? doc.covers[0] : manifest.account_owner] ?? memberIds[manifest.account_owner];
      const storageKey = await savePolicyFile({ accountId: account, familyMemberId: uploader, policyId, filename: doc.filename, bytes: new Uint8Array(bytes) });
      await db.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,processing_stage,processing_progress,processing_message,quarantine_status,scan_provider,scanned_at,created_at)
        VALUES($1,$2,$3,$4,$5,$6,'queued','queued',1,'Waiting','scan_clean','r7-battery',now(),now()+($7||' seconds')::interval)`,
        [policyId, account, uploader, doc.filename, storageKey, createHash("sha256").update(bytes).digest("hex"), String(di)]);
      current = { h, doc, manifest };
      if (process.env.R7R_VERBOSE) process.stdout.write(`[ingest] ${h} ${doc.filename} ${new Date().toISOString()}\n`);
      const transcript = doc.pages.some((p) => !p.text_layer) ? await ocrTranscript(h, doc) : null;
      // The scanned page's transcript is what a hosted reading model returns
      // for that exact image (the stand-in's own SYNTHETIC_OCR_REGISTRY).
      if (transcript) {
        const { pageImageFingerprints, SYNTHETIC_OCR_REGISTRY } = await import("@/lib/ai/deterministic-model");
        const g = globalThis as Record<string, unknown>;
        const registry = (g[SYNTHETIC_OCR_REGISTRY] ??= new Map()) as Map<string, { text: string; rotation: number; quality: "good" | "poor" | "unreadable" }>;
        const prints = await pageImageFingerprints(bytes);
        prints.forEach((hashes, i) => { const t = transcript.find((p) => p.pageNumber === i + 1); if (t) for (const h of hashes) registry.set(h, { text: t.text, rotation: 0, quality: "good" }); });
      }
      setDeterministicReadingOracles({ catalog: transcript ? (page) => catalogFromFacts(doc, String(page.text ?? "")) : null });
      // A document the pipeline cannot read is marked failed by processPolicy
      // itself (as the job queue leaves it); the chat must then say so.
      try { await processPolicy({ accountId: account, familyMemberId: uploader, policyId, storageKey, linkUploadMember: true }); }
      catch (error) { readFailures[doc.id] = error instanceof Error ? error.message : String(error); }
      current = null;
      docIds[doc.id] = policyId;
      if (doc.fixture_state === "deleted") {
        process.env.DEV_ACCOUNT_ID = account;
        const res = await DELETE(new NextRequest("http://localhost/api/policies/" + policyId, { method: "DELETE", headers: { origin: "http://localhost" } }), { params: Promise.resolve({ id: policyId }) });
        if (res.status >= 300) throw new Error("delete of " + doc.filename + " failed: " + res.status + " " + (await res.text()).slice(0, 300));
      }
    }
    households.push({ id: h, account, manifest, memberIds, docIds, readFailures });
  }
  // The chat that follows reads passages as a competent model would.
  setDeterministicReadingOracles({ reading: null, catalog: null, capable: true });
  return { db, households, storageDir, ingestMs: Date.now() - started };
}

/** What a competent model lists from an OCR'd scan: each printed benefit
 * whose amount appears on a line of the page, named as the schedule names it,
 * quoted verbatim from the OCR text (noise and all), with no calculable rule
 * (the amount is shown as printed, never calculated from). */
function catalogFromFacts(doc: Doc, text: string) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const benefits: unknown[] = [];
  for (const f of doc.facts) {
    if (!/\d/.test(f.value) || /premium|insured child|policy|dob|period/i.test(f.label)) continue;
    const digits = f.value.match(/\d[\d,]*(?:\.\d+)?/)?.[0];
    if (!digits) continue;
    const words = f.label.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4);
    const line = lines.find((l) => l.includes(digits) && words.some((w) => l.toLowerCase().includes(w)));
    if (!line) continue;
    benefits.push({ name: f.label.replace(/\s*\(.*?\)\s*/g, " ").trim(), quote: line.slice(0, 250), formulaKind: "none", formulaValue: null, currency: null, factKey: null, offsetDays: null, maximumDays: null, conditions: [] });
  }
  return { benefits };
}
