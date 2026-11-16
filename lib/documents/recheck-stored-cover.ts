/** Re-runs the plain-code fact check (lib/rag/ingest verifiedExtraction, which runs lib/documents/fact-check
 * checkCoverage) on a document's STORED page text and STORED reading, so the document-level currency rule
 * (lib/documents/document-currency) reaches documents already read, with no model call and no re-read.
 *
 * What it may change, and nothing else:
 * - policy_coverages.confirmed and evidence_verified, which the intake always writes together as one "proven line" flag
 *   (lib/policies/linking.ts syncInsuredPersonToMember), and
 * - the same line's evidenceVerified in policies.extracted_json, which a later re-link rebuilds those rows from.
 * Never an amount, a currency, a category, a person or a page. A stored line is matched to the re-checked one by its
 * person, category, page, evidence text and amount; a line with no single match, or whose two flags disagree (set by
 * hand), is left as it is and counted.
 *
 * Only what the document-level currency rule proves is applied: a line unproven today that the check proves WITH the rule
 * and does not prove WITHOUT it. Anything else the current check would change (a later rule) is counted, never written.
 *
 * The page image (fail closed). The intake reads a page's image (lib/documents/layout-check crossCheckPages) for a PDF's
 * text-layer page whose table text looks scrambled, or whose cover lines the first check could not confirm; when the
 * text layer prints no currency, the image's one currency is the page's (lib/documents/image-currency), and it blocks the
 * document-level currency when it differs. Readings stored since this change record that (PAGE_IMAGE_CURRENCY_KEY). For
 * an older reading, a page the intake may have read from its image (a text-layer page that prints no currency and holds
 * figures, and is a cover line's page or looks scrambled) has an unknown image currency: no line of that document is
 * upgraded, and the lines are counted as held (a re-read decides them). A scanned page (read by OCR) has no separate image
 * reading, and a page that prints a currency in its text never takes one from its image.
 *
 * A line that would go from proven to unproven is reported and, unless `allowDowngrade`, left proven. Dry run (the
 * default) writes nothing and reports the same counts. Idempotent. Scoped to one household, and optionally one document. */
import { PolicyExtractionSchema, type PolicyExtraction } from "@/lib/ai/extract-policy";
import { withServiceTransaction } from "@/lib/db/authz-client";
import { PAGE_IMAGE_CURRENCY_KEY } from "@/lib/documents/document-currency";
import { textPrintsCurrency } from "@/lib/documents/image-currency";
import { suspectPages } from "@/lib/documents/layout-check";
import { normalizeCoverageCategory } from "@/lib/insurance";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { trustedPolicyStatePredicate } from "@/lib/policies/trusted";
import { verifiedExtraction } from "@/lib/rag/ingest";

export type RecheckChange = { policyId: string; coverageId: string; category: string; sourcePage: number | null; from: boolean; to: boolean; applied: boolean;
  /** Why an upgrade was not written: the page image currency is unknown, or the document-level rule is not what proves it. */
  held?: "image currency unknown" | "not the document-currency rule" | "changed meanwhile" };
export type RecheckReport = {
  apply: boolean; documents: number; documentsSkipped: number; lines: number; unchanged: number;
  upgrades: number; upgradesApplied: number; heldImageUnknown: number; heldOtherRule: number; changedMeanwhile: number;
  downgrades: number; downgradesApplied: number; unmatched: number; changes: RecheckChange[];
};

const nameKey = (v: string) => String(v ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const amountKey = (v: unknown) => v == null || v === "" ? "" : String(Number(v));
const lineKey = (person: string, category: string, page: number | null | undefined, evidence: string | null | undefined, amount: unknown) =>
  JSON.stringify([nameKey(person), normalizeCoverageCategory(category), page ?? null, String(evidence ?? "").trim(), amountKey(amount)]);
const proven = (c: { sourcePage?: number | null; evidenceText?: string | null; evidenceVerified?: boolean | null }) => Boolean(c.sourcePage && c.evidenceText && c.evidenceVerified);

type Coverage = PolicyExtraction["insuredPeople"][number]["coverages"][number];
const coverageCategory = (c: Coverage) => c.category || c.productName || "Other";
type StoredPage = { pageNumber: number; text: string; method: string | null };

/** The re-checked verdict for each line key; a key two lines share with different verdicts gives null. */
function verdicts(e: PolicyExtraction) {
  const out = new Map<string, boolean | null>();
  for (const person of e.insuredPeople) for (const c of person.coverages) {
    const k = lineKey(person.name, coverageCategory(c), c.sourcePage, c.evidenceText, c.amount), v = proven(c);
    out.set(k, out.has(k) && out.get(k) !== v ? null : v);
  }
  return out;
}

/** The pages whose image currency the intake may have used and nothing recorded (see the module note). */
export function imageUnknownPages(pages: StoredPage[], record: unknown, coverPages: Set<number>): number[] {
  if (record && typeof record === "object" && !Array.isArray(record)) return [];
  const textLayer = pages.filter((p) => !["ocr", "unreadable", "unchecked"].includes(p.method ?? "native") && /\d/.test(p.text) && !textPrintsCurrency(p.text));
  const scrambled = new Set(suspectPages(textLayer.map((p) => ({ pageNumber: p.pageNumber, text: p.text, extractionMethod: p.method === "part_checked" ? "native" : p.method ?? "native" }))));
  return textLayer.filter((p) => p.method === "part_checked" || coverPages.has(p.pageNumber) || scrambled.has(p.pageNumber)).map((p) => p.pageNumber);
}

export async function recheckStoredCover(scope: { accountId: string; policyId?: string | null }, opts: { apply?: boolean; allowDowngrade?: boolean } = {}): Promise<RecheckReport> {
  const apply = opts.apply === true;
  const report: RecheckReport = { apply, documents: 0, documentsSkipped: 0, lines: 0, unchanged: 0, upgrades: 0, upgradesApplied: 0, heldImageUnknown: 0, heldOtherRule: 0,
    changedMeanwhile: 0, downgrades: 0, downgradesApplied: 0, unmatched: 0, changes: [] };
  const ids = await withServiceTransaction(async (db) => (await db.query<{ id: string }>(
    `SELECT p.id::text FROM policies p WHERE p.account_id=$1 AND ($2::uuid IS NULL OR p.id=$2::uuid) AND ${activePredicate("p")} AND ${trustedPolicyStatePredicate("p")}
       AND p.processing_status='ready' AND p.personal_coverage_confirmed=true AND p.extracted_json IS NOT NULL ORDER BY p.created_at, p.id`,
    [scope.accountId, scope.policyId ?? null])).rows.map((r) => r.id));
  for (const policyId of ids) {
    // One transaction per document, holding its row: a reading or re-link running at the same time is never mixed in.
    await withServiceTransaction(async (db) => {
      const row = (await db.query<{ extracted_json: Record<string, unknown> | null; processing_status: string }>(
        `SELECT p.extracted_json, p.processing_status FROM policies p WHERE p.id=$1 AND p.account_id=$2 AND ${activePredicate("p")} AND ${trustedPolicyStatePredicate("p")} FOR UPDATE`,
        [policyId, scope.accountId])).rows[0];
      const parsed = PolicyExtractionSchema.safeParse(row?.extracted_json);
      // Re-checked under the lock: a document being read again now is left to that reading.
      if (!row?.extracted_json || row.processing_status !== "ready" || !parsed.success || !parsed.data.personalCoverageConfirmed) { report.documentsSkipped++; return; }
      const pages = (await db.query<{ page_number: number; text: string; method: string | null }>(
        `SELECT page_number, text, to_jsonb(pp)->>'extraction_method' AS method FROM policy_pages pp WHERE pp.policy_id=$1 AND pp.account_id=$2 ORDER BY page_number`,
        [policyId, scope.accountId])).rows.map((p): StoredPage => ({ pageNumber: p.page_number, text: p.text, method: p.method }));
      if (!pages.length) { report.documentsSkipped++; return; }
      report.documents++;
      const record = row.extracted_json[PAGE_IMAGE_CURRENCY_KEY];
      const imageOf = (n: number) => record && typeof record === "object" ? ((record as Record<string, unknown>)[String(n)] as string | null | undefined) ?? undefined : undefined;
      const coverPages = new Set(parsed.data.insuredPeople.flatMap((p) => p.coverages.map((c) => Number(c.sourcePage))).filter(Number.isFinite));
      const unknownImage = imageUnknownPages(pages, record, coverPages).length > 0;
      const all = pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text }));
      // A page the intake could not check confirms nothing, as at intake; a recorded image currency goes with its page.
      const checkedPages = pages.filter((p) => p.method !== "unchecked").map((p) => ({ pageNumber: p.pageNumber, text: p.text, ...(imageOf(p.pageNumber) ? { imageCurrency: imageOf(p.pageNumber)! } : {}) }));
      const withRule = verdicts(verifiedExtraction(parsed.data, checkedPages, { allPages: all }));
      const withoutRule = verdicts(verifiedExtraction(parsed.data, checkedPages, { allPages: all, documentCurrency: false }));

      const rows = (await db.query<{ id: string; category: string; source_page: number | null; evidence_text: string | null; amount: string | null; confirmed: boolean; evidence_verified: boolean | null; names: string[] }>(
        `SELECT pc.id::text, pc.category, pc.source_page, pc.evidence_text, pc.amount::text, pc.confirmed, pc.evidence_verified,
                ARRAY(SELECT d.detected_name FROM policy_detected_people d WHERE d.policy_id=pc.policy_id AND d.account_id=pc.account_id AND d.matched_family_member_id=pc.family_member_id) AS names
           FROM policy_coverages pc WHERE pc.policy_id=$1 AND pc.account_id=$2 AND pc.authority='personal_document' ORDER BY pc.created_at, pc.id`, [policyId, scope.accountId])).rows;
      const flips = new Map<string, boolean>();
      for (const r of rows) {
        report.lines++;
        if (r.confirmed !== (r.evidence_verified === true)) { report.unmatched++; continue; }
        const keys = r.names.map((n) => lineKey(n, r.category, r.source_page, r.evidence_text, r.amount));
        const one = (m: Map<string, boolean | null>) => { const f = [...new Set(keys.map((k) => m.get(k)).filter((v) => v !== undefined))]; return f.length === 1 ? f[0] : null; };
        const to = one(withRule), before = one(withoutRule);
        if (to == null) { report.unmatched++; continue; }
        const from = r.confirmed;
        if (from === to) { report.unchanged++; continue; }
        let held: RecheckChange["held"];
        if (to) {
          report.upgrades++;
          held = before !== false ? "not the document-currency rule" : unknownImage ? "image currency unknown" : undefined;
          if (held === "not the document-currency rule") report.heldOtherRule++;
          if (held === "image currency unknown") report.heldImageUnknown++;
        } else report.downgrades++;
        let applied = apply && !held && (to || opts.allowDowngrade === true);
        if (applied) {
          const n = (await db.query(`UPDATE policy_coverages SET confirmed=$3, evidence_verified=$3 WHERE id=$1 AND account_id=$2 AND confirmed=$4 AND evidence_verified=$4`, [r.id, scope.accountId, to, from])).rowCount ?? 0;
          if (n !== 1) { applied = false; held = "changed meanwhile"; report.changedMeanwhile++; }
          else { for (const k of keys) flips.set(k, to); if (to) report.upgradesApplied++; else report.downgradesApplied++; }
        }
        report.changes.push({ policyId, coverageId: r.id, category: r.category, sourcePage: r.source_page, from, to, applied, ...(held ? { held } : {}) });
      }
      if (!flips.size) return;
      // The stored reading says the same, so a re-link rebuilds the same rows. Only evidenceVerified is touched.
      const json = structuredClone(row.extracted_json) as { insuredPeople?: { name: string; coverages?: (Coverage & Record<string, unknown>)[] }[] };
      let touched = false;
      for (const person of json.insuredPeople ?? []) for (const c of person.coverages ?? []) {
        const to = flips.get(lineKey(person.name, coverageCategory(c), c.sourcePage, c.evidenceText, c.amount));
        if (to === undefined || (c.evidenceVerified === true) === to) continue;
        c.evidenceVerified = to; touched = true;
      }
      if (touched) await db.query(`UPDATE policies SET extracted_json=$3::jsonb, updated_at=now() WHERE id=$1 AND account_id=$2 AND ${activePredicate()} AND processing_status='ready'`, [policyId, scope.accountId, JSON.stringify(json)]);
    });
  }
  return report;
}

/** The counts a dry run or a run prints: lines that change, and in which direction. */
export function recheckSummary(r: RecheckReport): string {
  return [`${r.apply ? "Applied" : "Dry run (nothing written)"}: ${r.documents} document(s) re-checked, ${r.documentsSkipped} skipped; ${r.lines} line(s).`,
    `Unconfirmed -> confirmed: ${r.upgrades}${r.apply ? ` (${r.upgradesApplied} applied)` : ""}; held, page image currency unknown (needs a re-read): ${r.heldImageUnknown}; held, not from the document-currency rule: ${r.heldOtherRule}.`,
    `Confirmed -> unconfirmed: ${r.downgrades}${r.downgrades ? r.apply ? ` (${r.downgradesApplied} applied, ${r.downgrades - r.downgradesApplied} left confirmed; pass --allow-downgrade to apply)` : " (reported only; a run leaves them confirmed unless --allow-downgrade)" : ""}.`,
    `Unchanged: ${r.unchanged}. Not matched or set by hand (left as they are): ${r.unmatched}. Changed meanwhile (not written): ${r.changedMeanwhile}.`].join("\n");
}
