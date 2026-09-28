/**
 * V1 core-loop DATABASE verifier (read-only).
 *
 * Proves, from the database itself and never from UI status, that each
 * uploaded document went upload -> job -> text -> structured facts with
 * citations -> linked to the right family member -> retrievable by the app's
 * own loaders, and that households are isolated, deleted documents are gone,
 * and synthetic e2e data was fully cleaned up.
 *
 * Every connection (this script's own AND the app pool the loaders use) runs
 * with default_transaction_read_only=on, and the loaders' lazy schema
 * migrations are pre-marked as done, so this script cannot write anything.
 *
 * Usage (serialize with the shared lock on the 1-CPU sandbox):
 *   flock /home/user/test.lock timeout 170 node --import tsx scripts/v1-db-verification.ts \
 *     --household <uuid> --expect <file.json|file.ts> [--json]
 *   ... --isolation [--household <A> --household <B>]      global + pairwise isolation
 *   ... --deleted-policy <policyId> --household <uuid>     post-deletion proof
 *   ... --cleanup-proof [--prefix SYNTHETIC-DPTEST] [--household <id> ...] [--storage-dir <dir>]   (files: synthetic owners FAIL, other owners INFO)
 *
 * --expect: JSON array (or {uploads:[...]}, or a .ts module exporting
 *   default / V1_EXPECTED_UPLOADS / expectedUploads) of
 *   { policyId?, originalFilename?, member|memberDisplayName,
 *     expected:{ insurer?, insured?, policyNumber?,
 *                benefits?:[{ name, amount?, currency?, page? }] } }
 *
 * Output: one line per check `PASS|WARN|FAIL|INFO <scope> <check> -- detail`,
 * then a summary line. --json prints the machine-readable report instead.
 * Exit code: 0 = no FAIL, 1 = at least one FAIL, 2 = usage/connection error.
 *
 * Env: DATABASE_URL (default local dearpolicy), LOCAL_STORAGE_DIR (default
 * ./data/storage), TELEMETRY_PSEUDONYM_SECRET (must match the app's, for the
 * model-provenance join), E2E_USER_A/E2E_USER_B (cleanup-proof).
 * Refuses a non-local DATABASE_URL unless V1_VERIFY_ALLOW_REMOTE=yes.
 */
import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

try { process.loadEnvFile(path.resolve(".env.local")); } catch { /* optional */ }
process.env.DATABASE_URL ??= "postgresql://dearpolicy:dearpolicy@localhost:5432/dearpolicy";
// Read-only for EVERY pg connection in this process, including lib/db/client's pool.
process.env.PGOPTIONS = [process.env.PGOPTIONS, "-c default_transaction_read_only=on -c statement_timeout=60000"].filter(Boolean).join(" ");
// The loaders run idempotent DDL on first use; the schema is already applied
// (e2e/support/apply-schema.ts), so mark it done instead of running DDL.
// Every lazy-migration memo in lib/ (grep "__dearpolicy.*Schema") is pre-marked
// done; main() first proves the tables those migrations create exist, and the
// read-only session guard still rejects any write that slips through.
const g = globalThis as Record<string, unknown>;
const LAZY_SCHEMA_GLOBALS = ["__dearpolicyBenefitSchema", "__dearpolicyLedgerSchema", "__dearpolicyChatSchema", "__dearpolicyConditionSchema",
  "__dearpolicyProvenanceSchema", "__dearpolicyClaimCompositionSchema", "__dearpolicyClaimEvidenceSchema", "__dearpolicyClaimReviewerSchema",
  "__dearpolicyCriticalIllnessSchema", "__dearpolicyDisabilitySchema"];
for (const key of LAZY_SCHEMA_GLOBALS) g[key] = Promise.resolve();
g.__dearpolicyLedgerSchemaReady = true;
/** Tables the pre-marked migrations would create; all must already exist. */
const REQUIRED_TABLES = ["policies", "policy_benefits", "coverage_rules", "chat_conversations", "chat_messages", "policy_cover_conditions",
  "model_executions", "claim_evidence_documents", "claim_composition_snapshots", "claim_reviewers", "claim_ci_definition_matches",
  "claim_disability_definition_matches", "policy_coverages", "family_members", "background_jobs"];
const isReadOnlyViolation = (err: unknown) => (err as { code?: string })?.code === "25006";

type Status = "PASS" | "WARN" | "FAIL" | "INFO";
type Result = { status: Status; scope: string; check: string; detail: string; data?: unknown };
const results: Result[] = [];
const JSON_OUT = process.argv.includes("--json");
function report(status: Status, scope: string, check: string, detail: string, data?: unknown) {
  results.push({ status, scope, check, detail, data });
  if (!JSON_OUT) console.log(`${status.padEnd(4)} ${scope} ${check} -- ${detail}`);
}

// ---------------------------------------------------------------- args
function argValues(flag: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => { if (a === flag && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) out.push(process.argv[i + 1]); });
  return out;
}
const has = (flag: string) => process.argv.includes(flag);

// ---------------------------------------------------------------- helpers
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const words = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const personKey = (s: string | null | undefined) => words(s).split(" ").filter(Boolean).sort().join(" ");
const ident = (s: string | null | undefined) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Expected amount vs stored: a %-of-sum-insured row (currency null) may be stored as a fraction (1) or a percent (100). */
let currentSumInsured: number | null = null; // expected.sumInsured.amount of the upload being verified
function amountEquals(b: { amount?: number | null; currency?: string | null; formulaKind?: string }, stored: number | null | undefined) {
  if (b.amount == null) return true;
  if (stored == null) return false;
  if (Math.abs(stored - b.amount) < 0.005) return true;
  const pct = b.currency == null || b.formulaKind === "sum_insured";
  // stored as a percent (100) or already resolved against the sum insured (ledger rows)
  return pct && (Math.abs(stored - b.amount * 100) < 0.005 || (currentSumInsured != null && Math.abs(stored - b.amount * currentSumInsured) < 0.005));
}
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
function nameMatches(expected: string, actual: string | null | undefined) {
  const e = words(expected), a = words(actual);
  if (!e || !a) return false;
  if (a.includes(e) || e.includes(a)) return true;
  const es = new Set(e.split(" ")), as = new Set(a.split(" "));
  const inter = [...es].filter((w) => as.has(w)).length;
  return inter / Math.max(es.size, 1) >= 0.75;
}
const CURRENCY_TOKENS: Record<string, RegExp> = {
  SGD: /\bSGD\b|S\$|SG\$|singapore dollars?/i, USD: /\bUSD\b|US\$|u\.s\. dollars?/i, MYR: /\bMYR\b|\bRM\s?\d/i,
  EUR: /\bEUR\b|€/i, GBP: /\bGBP\b|£/i, HKD: /\bHKD\b|HK\$/i, AUD: /\bAUD\b|A\$|AU\$/i, CAD: /\bCAD\b|C\$|CA\$/i,
  JPY: /\bJPY\b|¥|￥/i, CNY: /\bCNY\b|\bRMB\b|CN¥/i, INR: /\bINR\b|₹/i, IDR: /\bIDR\b|\bRp\b/i, THB: /\bTHB\b|฿/i,
  PHP: /\bPHP\b|₱/i, KRW: /\bKRW\b|₩/i,
};
function currencyPrinted(code: string, text: string) {
  const re = CURRENCY_TOKENS[code.toUpperCase()];
  return re ? re.test(text) : new RegExp(`\\b${code}\\b`, "i").test(text);
}
function amountPrinted(amount: number, text: string) {
  if (!Number.isFinite(amount)) return false;
  const digits = text.replace(/(\d)[,\s'](?=\d{3}\b)/g, "$1");
  const variants = new Set<string>([String(amount), amount.toFixed(2)]);
  if (Number.isInteger(amount)) variants.add(String(amount));
  for (const v of variants) if (new RegExp(`(^|[^\\d.])${v.replace(".", "\\.")}(?![\\d])`).test(digits)) return true;
  // "50k" / "1 million" styles
  if (amount >= 1000 && amount % 1000 === 0 && new RegExp(`\\b${amount / 1000}\\s?k\\b`, "i").test(text)) return true;
  if (amount >= 1e6 && amount % 1e5 === 0 && new RegExp(`\\b${amount / 1e6}\\s?(m|million)\\b`, "i").test(text)) return true;
  return false;
}
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true }).catch(() => [] as string[]);
  const files: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, String(e));
    if ((await stat(full).catch(() => null))?.isFile()) files.push(String(e));
  }
  return files;
}
const storageRoot = () => path.resolve(process.env.LOCAL_STORAGE_DIR ?? "./data/storage");
/** Every local storage root the app or the e2e stack may write to (the e2e
 * stack runs with LOCAL_STORAGE_DIR=./.e2e-storage), plus --storage-dir. */
function storageRoots() {
  return [...new Set([process.env.LOCAL_STORAGE_DIR, process.env.LOCAL_CLAIM_EVIDENCE_DIR, process.env.LOCAL_HOUSEHOLD_EXPORT_DIR,
    "./data/storage", "./data/claim-evidence", "./data/household-exports", "./.e2e-storage", ...argValues("--storage-dir")]
    .filter((d): d is string => !!d).map((d) => path.resolve(d)))];
}
async function filesUnderAll(): Promise<{ root: string; file: string }[]> {
  const out: { root: string; file: string }[] = [];
  for (const root of storageRoots()) for (const file of await filesUnder(root)) out.push({ root, file });
  return out;
}

// ---------------------------------------------------------------- db
type PoolT = import("pg").Pool;
let db: PoolT;
async function q<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query(sql, params)).rows as T[];
}
async function columnsByName(names: string[]) {
  return q<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT c.table_name, c.column_name, c.data_type FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
      WHERE c.table_schema='public' AND c.column_name = ANY($1) ORDER BY 1,2`, [names]);
}
async function scopedTables() {
  // Every base table carrying a household key, discovered, never hard-coded.
  const rows = await columnsByName(["account_id", "household_id"]);
  return rows.filter((r) => r.table_name !== "accounts");
}

// Reference columns -> the table whose account_id the referencing row must share.
const REFERENCE_TARGETS: Record<string, string> = {
  policy_id: "policies", source_document_id: "policies", contract_id: "policies",
  family_member_id: "family_members", matched_family_member_id: "family_members",
  conversation_id: "chat_conversations", claim_session_id: "claim_sessions",
  evidence_document_id: "claim_evidence_documents", export_id: "household_exports",
};

// ---------------------------------------------------------------- app loaders
type Loaders = {
  loadPolicyInventory: typeof import("../lib/policies/inventory").loadPolicyInventory;
  loadBenefitCatalog: typeof import("../lib/policies/benefit-catalog").loadBenefitCatalog;
  confirmedOwnedCoverages: typeof import("../lib/coverage/facts").confirmedOwnedCoverages;
  loadLedger: typeof import("../lib/ledger/store").loadLedger;
  getConversation: typeof import("../lib/chat/store").getConversation;
  pseudonymizeId: typeof import("../lib/telemetry/pseudonymize").pseudonymizeId;
  appPool: PoolT;
};
let loadersCache: Loaders | null = null;
async function loaders(): Promise<Loaders> {
  if (loadersCache) return loadersCache;
  const [inv, cat, facts, ledger, chat, pseudo, client] = await Promise.all([
    import("../lib/policies/inventory"), import("../lib/policies/benefit-catalog"), import("../lib/coverage/facts"),
    import("../lib/ledger/store"), import("../lib/chat/store"), import("../lib/telemetry/pseudonymize"), import("../lib/db/client"),
  ]);
  // lib/db/client's query() upserts the dev accounts row before its first
  // query (ensureDevAccountRow). That is a write, which the read-only
  // session rejects; answer that one statement without touching the database.
  const appPool = client.pool as unknown as { query: (...a: unknown[]) => unknown };
  const realQuery = appPool.query.bind(appPool);
  appPool.query = (...a: unknown[]) => typeof a[0] === "string" && /^\s*INSERT INTO accounts\(id, name\) VALUES \(\$1, 'Household'\) ON CONFLICT \(id\) DO NOTHING/.test(a[0])
    ? Promise.resolve({ rows: [], rowCount: 0 }) : realQuery(...a);
  loadersCache = { loadPolicyInventory: inv.loadPolicyInventory, loadBenefitCatalog: cat.loadBenefitCatalog,
    confirmedOwnedCoverages: facts.confirmedOwnedCoverages, loadLedger: ledger.loadLedger, getConversation: chat.getConversation,
    pseudonymizeId: pseudo.pseudonymizeId, appPool: client.pool as unknown as PoolT };
  return loadersCache;
}
type Person = { id: string; display_name: string; preferred_name: string | null; relationship: string };
async function activePeople(householdId: string) {
  return q<Person>(`SELECT id::text,display_name,preferred_name,relationship FROM family_members WHERE account_id=$1 AND lifecycle_state='active' ORDER BY created_at`, [householdId]);
}

// ---------------------------------------------------------------- expectations
type ExpectedBenefit = { name: string; amount?: number | null; currency?: string | null; page?: number | null; formulaKind?: string };
type ExpectedUpload = {
  policyId?: string; originalFilename?: string; filename?: string; name?: string; household?: string; role?: string;
  member?: string; memberDisplayName?: string; memberName?: string;
  expected: { insurer?: string | null; insured?: string | null; policyNumber?: string | null; sumInsured?: { amount: number; currency: string } | null; benefits?: ExpectedBenefit[] };
};
async function loadExpectations(file: string): Promise<ExpectedUpload[]> {
  const full = path.resolve(file);
  let raw: unknown;
  if (/\.(c|m)?[jt]s$/.test(full)) {
    const mod = await import(pathToFileURL(full).href) as Record<string, unknown>;
    raw = mod.V1_EXPECTED_UPLOADS ?? mod.expectedUploads ?? mod.generateV1Fixtures ?? mod.default;
    if (typeof raw === "function") raw = await (raw as (o: unknown) => unknown)({ include: "all" });
  } else raw = JSON.parse(await readFile(full, "utf8"));
  const list = Array.isArray(raw) ? raw : (raw as { uploads?: unknown })?.uploads;
  if (!Array.isArray(list)) throw new Error(`--expect ${file}: expected an array or {uploads:[...]}`);
  // e2e/support/v1-fixtures.ts manifests carry household "A"|"B": --fixture-household picks one.
  const only = argValues("--fixture-household")[0];
  return (list as ExpectedUpload[]).filter((u) => !only || !u.household || u.household === only);
}

// ---------------------------------------------------------------- per-upload verification
type PolicyRow = {
  id: string; account_id: string; family_member_id: string; insurer: string | null; product_name: string | null; policy_number: string | null;
  document_role: string | null; personal_coverage_confirmed: boolean; processing_status: string; processing_error: string | null;
  original_filename: string; storage_key: string; page_count: number | null; has_extraction: boolean; created_at: string;
  processing_started_at: string | null; processing_completed_at: string | null; quarantine_status: string | null;
  superseded_at: string | null; lifecycle_state: string; needs_review: boolean; review_reason: string | null;
  benefits_indexed_at: string | null; ledger_read_at: string | null;
};
const POLICY_COLS = `id::text,account_id::text,family_member_id::text,insurer,product_name,policy_number,document_role,personal_coverage_confirmed,
  processing_status,processing_error,original_filename,storage_key,page_count,(extracted_json IS NOT NULL) AS has_extraction,created_at::text,
  processing_started_at::text,processing_completed_at::text,quarantine_status,superseded_at::text,lifecycle_state,needs_review,review_reason,
  benefits_indexed_at::text,ledger_read_at::text`;
const TRUSTED_QUARANTINE = ["scan_clean", "not_scanned_prototype"];

type Candidate = { table: string; id: string; name: string; amount: number | null; currency: string | null; page: number | null; memberId?: string | null };

async function verifyUpload(householdId: string, up: ExpectedUpload, people: Person[]) {
  currentSumInsured = up.expected.sumInsured?.amount ?? null;
  const fileName = up.originalFilename ?? up.filename ?? up.name ?? "";
  const label = up.policyId ?? (fileName || up.expected.policyNumber) ?? "?";
  const scope = `[upload ${label}]`;
  const byId = up.policyId && UUID.test(up.policyId);
  const ORDER = `ORDER BY (lifecycle_state='active' AND superseded_at IS NULL) DESC, created_at DESC`;
  let rows = byId
    ? await q<PolicyRow>(`SELECT ${POLICY_COLS} FROM policies WHERE id=$1`, [up.policyId])
    : fileName ? await q<PolicyRow>(`SELECT ${POLICY_COLS} FROM policies WHERE account_id=$1 AND (original_filename=$2 OR original_filename LIKE '%'||$2) ${ORDER}`, [householdId, fileName]) : [];
  if (!rows.length && !byId && up.expected.policyNumber) {
    rows = await q<PolicyRow>(`SELECT ${POLICY_COLS} FROM policies WHERE account_id=$1 AND regexp_replace(upper(coalesce(policy_number,'')),'[^A-Z0-9]','','g')=$2 ${ORDER}`, [householdId, ident(up.expected.policyNumber)]);
    if (rows.length) report("WARN", scope, "upload_row", `no row named "${fileName}"; matched by policy number instead`);
  }
  // 1. upload row
  if (!rows.length) { report("FAIL", scope, "upload_row", "no policies row found"); return; }
  const p = rows[0];
  if (rows.length > 1) report("WARN", scope, "upload_row", `${rows.length} rows match; verifying newest active ${p.id}`);
  if (p.account_id !== householdId) { report("FAIL", scope, "upload_row", `policy ${p.id} belongs to household ${p.account_id}, not ${householdId}`); return; }
  report("PASS", scope, "upload_row", `policy ${p.id} file="${p.original_filename}" storage_key=${p.storage_key ? "set" : "MISSING"}`);
  if (p.storage_key) {
    let found: string | null = null; let size = 0;
    for (const root of storageRoots()) {
      const s = await stat(path.join(root, p.storage_key)).catch(() => null);
      if (s?.isFile()) { found = root; size = s.size; break; }
    }
    report(found ? "PASS" : "WARN", scope, "storage_object", found ? `${size} bytes at ${found}/${p.storage_key}` : `not found under ${storageRoots().join(", ")} (non-local driver or missing)`);
  }
  const trusted = p.lifecycle_state === "active" && !p.superseded_at && TRUSTED_QUARANTINE.includes(p.quarantine_status ?? "");
  report(trusted ? "PASS" : "FAIL", scope, "document_state", `lifecycle=${p.lifecycle_state} quarantine=${p.quarantine_status} superseded_at=${p.superseded_at ?? "null"}`);

  // 2. background job
  const jobs = await q<{ id: string; status: string; attempt_count: number; max_attempts: number; created_at: string; completed_at: string | null; secs: number | null; last_error_category: string | null; has_password: boolean; account_id: string }>(
    `SELECT id::text,status,attempt_count,max_attempts,created_at::text,completed_at::text,EXTRACT(EPOCH FROM completed_at-created_at)::float AS secs,
            last_error_category,(payload ? 'pdfPassword' AND payload->>'pdfPassword' IS NOT NULL) AS has_password,account_id::text
       FROM background_jobs WHERE job_type='policy_processing' AND idempotency_key=$1`, [p.id]);
  const job = jobs[0];
  if (!job) report("FAIL", scope, "processing_job", "no background_jobs row (job_type=policy_processing, idempotency_key=policy id)");
  else {
    const audit = await q<{ to_status: string; n: number }>(`SELECT to_status,count(*)::int AS n FROM background_job_audit_log WHERE job_id=$1 GROUP BY 1`, [job.id]);
    const retries = audit.find((a) => a.to_status === "failed_retryable")?.n ?? 0;
    const ok = job.status === "succeeded" && job.account_id === householdId;
    report(ok ? "PASS" : "FAIL", scope, "processing_job",
      `status=${job.status} attempts=${job.attempt_count}/${job.max_attempts} retries=${retries} job_created->completed=${job.secs == null ? "n/a" : job.secs.toFixed(1) + "s"}${job.last_error_category ? " last_error=" + job.last_error_category : ""}`,
      { attempts: job.attempt_count, retries, jobSeconds: job.secs });
    if (job.has_password) report("WARN", scope, "job_payload_secret", "background_jobs.payload still holds pdfPassword after the job finished");
  }
  const ready = await q<{ secs: number | null }>(`SELECT EXTRACT(EPOCH FROM processing_completed_at-created_at)::float AS secs FROM policies WHERE id=$1`, [p.id]);
  report(p.processing_status === "ready" && !p.processing_error ? "PASS" : "FAIL", scope, "processing_status",
    `processing_status=${p.processing_status} upload->ready=${ready[0]?.secs == null ? "n/a" : Number(ready[0].secs).toFixed(1) + "s"}${p.processing_error ? " error=" + p.processing_error : ""}${p.needs_review ? " needs_review: " + (p.review_reason ?? "") : ""}`,
    { uploadToReadySeconds: ready[0]?.secs ?? null });

  // 3. extracted text
  const pages = await q<{ page_number: number; text: string }>(`SELECT page_number,text FROM policy_pages WHERE policy_id=$1 AND account_id=$2 ORDER BY page_number`, [p.id, householdId]);
  const pageText = new Map(pages.map((r) => [r.page_number, r.text]));
  const allText = pages.map((r) => r.text).join("\n");
  const contiguous = pages.every((r, i) => r.page_number === i + 1);
  const chunkStats = (await q<{ n: number; maxp: number | null; minp: number | null; foreign: number }>(
    `SELECT count(*)::int AS n,max(page_end)::int AS maxp,min(page_start)::int AS minp,count(*) FILTER (WHERE account_id<>$2)::int AS foreign
       FROM policy_chunks WHERE policy_id=$1`, [p.id, householdId]))[0];
  const textOk = pages.length > 0 && allText.trim().length >= 100 && contiguous && (p.page_count == null || p.page_count === pages.length);
  report(textOk ? "PASS" : "FAIL", scope, "extracted_text", `policy_pages=${pages.length} (page_count=${p.page_count ?? "null"}, contiguous=${contiguous}) chars=${allText.length}`);
  const chunksOk = chunkStats.n > 0 && chunkStats.foreign === 0 && (chunkStats.minp ?? 1) >= 1 && (chunkStats.maxp ?? 0) <= pages.length;
  report(chunksOk ? "PASS" : "FAIL", scope, "chunks", `policy_chunks=${chunkStats.n} page range ${chunkStats.minp ?? "-"}..${chunkStats.maxp ?? "-"} foreign_account=${chunkStats.foreign}`);

  // 4. structured facts (every table that holds amounts for this document)
  const cands: Candidate[] = [
    ...(await q<{ id: string; name: string; amount: string | null; currency: string | null; page: number | null }>(
      `SELECT id::text,benefit_name AS name,formula_value::text AS amount,currency,source_page AS page FROM policy_benefits WHERE policy_id=$1 AND account_id=$2`, [p.id, householdId]))
      .map((r) => ({ table: "policy_benefits", id: r.id, name: r.name, amount: num(r.amount), currency: r.currency, page: r.page })),
    ...(await q<{ id: string; name: string; amount: string | null; currency: string | null; page: number | null; member: string }>(
      `SELECT id::text,concat_ws(' | ',product_name,category,notes) AS name,amount::text,currency,source_page AS page,family_member_id::text AS member FROM policy_coverages WHERE policy_id=$1 AND account_id=$2`, [p.id, householdId]))
      .map((r) => ({ table: "policy_coverages", id: r.id, name: r.name, amount: num(r.amount), currency: r.currency, page: r.page, memberId: r.member })),
    ...(await q<{ id: string; name: string; amount: string | null; currency: string | null; page: number | null; member: string }>(
      `SELECT id::text,concat_ws(' | ',plan_name,detail,event_type) AS name,amount::text,currency,source_page AS page,family_member_id::text AS member FROM coverage_rules WHERE policy_id=$1 AND account_id=$2 AND status<>'rejected'`, [p.id, householdId]))
      .map((r) => ({ table: "coverage_rules", id: r.id, name: r.name, amount: num(r.amount), currency: r.currency, page: r.page, memberId: r.member })),
  ];
  const byTable = (t: string) => cands.filter((c) => c.table === t).length;
  report(cands.length ? "PASS" : "FAIL", scope, "structured_facts", `policy_benefits=${byTable("policy_benefits")} policy_coverages=${byTable("policy_coverages")} coverage_rules=${byTable("coverage_rules")}`);

  // 5. citations on every stored fact
  const pc = p.page_count ?? pages.length;
  const noPage = cands.filter((c) => c.page == null);
  const badPage = cands.filter((c) => c.page != null && (c.page < 1 || c.page > pc || !pageText.has(c.page)));
  report(badPage.length ? "FAIL" : noPage.length ? "WARN" : "PASS", scope, "citations",
    `${cands.length - noPage.length}/${cands.length} facts carry source_page; out-of-range/unstored pages=${badPage.length}`,
    { missing: noPage.map((c) => `${c.table}:${c.name}`), outOfRange: badPage.map((c) => `${c.table}:${c.name}@${c.page}`) });

  // 6. printed currency / amount retained (no defaulted currency)
  for (const c of cands.filter((c) => c.currency)) {
    const cited = c.page != null ? pageText.get(c.page) ?? "" : "";
    if (currencyPrinted(c.currency!, cited)) continue;
    if (currencyPrinted(c.currency!, allText)) report("WARN", scope, "currency_printed", `${c.table} "${c.name}" ${c.currency}: not on cited page ${c.page ?? "-"}, printed elsewhere in the document`);
    else report("FAIL", scope, "currency_printed", `${c.table} "${c.name}" currency ${c.currency} is printed nowhere in the document text (defaulted?)`);
  }

  // 7. expected benefits
  for (const b of up.expected.benefits ?? []) {
    const named = cands.filter((c) => nameMatches(b.name, c.name));
    const exact = named.filter((c) =>
      amountEquals(b, c.amount) &&
      (b.currency == null || (c.currency ?? "").toUpperCase() === b.currency.toUpperCase()) &&
      (b.page == null || c.page === b.page));
    if (exact.length) {
      const c = exact[0];
      const cited = c.page != null ? pageText.get(c.page) ?? "" : "";
      const printedAmt = b.amount == null || b.currency == null || amountPrinted(b.amount, cited);
      report(printedAmt ? "PASS" : "WARN", scope, `benefit "${b.name}"`,
        `found in ${[...new Set(exact.map((e) => e.table))].join(",")}: ${c.amount ?? "-"} ${c.currency ?? "(no currency)"} p.${c.page ?? "-"}${printedAmt ? "" : " -- amount not found printed on the cited page"}`);
    } else if (named.length) {
      report("FAIL", scope, `benefit "${b.name}"`, `expected ${b.amount ?? "-"} ${b.currency ?? "-"} p.${b.page ?? "-"}; stored: ${named.map((c) => `${c.table}=${c.amount ?? "-"} ${c.currency ?? "null"} p.${c.page ?? "-"}`).join("; ")}`);
    } else {
      report("FAIL", scope, `benefit "${b.name}"`, `not stored (candidates: ${cands.map((c) => c.name).slice(0, 8).join(" / ") || "none"})`);
    }
  }

  // 8. identity
  const e = up.expected;
  if (e.insurer != null) report(nameMatches(e.insurer, p.insurer) ? "PASS" : "FAIL", scope, "insurer", `stored="${p.insurer ?? "null"}" expected="${e.insurer}"`);
  if (e.policyNumber != null) report(ident(e.policyNumber) === ident(p.policy_number) ? "PASS" : "FAIL", scope, "policy_number", `stored="${p.policy_number ?? "null"}" expected="${e.policyNumber}"`);
  const detected = await q<{ detected_name: string; matched: string | null }>(`SELECT detected_name,matched_family_member_id::text AS matched FROM policy_detected_people WHERE policy_id=$1 AND account_id=$2`, [p.id, householdId]);
  if (e.insured != null) {
    const hit = detected.find((d) => personKey(d.detected_name) === personKey(e.insured));
    report(hit ? "PASS" : "FAIL", scope, "insured_person", `detected=[${detected.map((d) => d.detected_name).join(", ")}] expected="${e.insured}"`);
  }
  report(p.has_extraction ? "PASS" : "FAIL", scope, "extraction_json", p.has_extraction ? "policies.extracted_json stored" : "policies.extracted_json is NULL");

  // 9. model provenance
  try {
    const L = await loaders();
    const ref = L.pseudonymizeId(p.id);
    const prov = await q<{ operation: string; requested_model: string; resolved_model: string | null; status: string; verified: boolean }>(
      `SELECT operation,requested_provider||':'||requested_model AS requested_model,resolved_model,status,verified FROM model_executions WHERE resource_ref=$1 ORDER BY created_at`, [ref]);
    const deterministicRef = /wording|summary|guide|brochure/.test(p.document_role ?? "") && !p.personal_coverage_confirmed;
    if (prov.length) report(prov.some((r) => r.verified) ? "PASS" : "WARN", scope, "model_provenance", prov.map((r) => `${r.operation}:${r.requested_model}->${r.resolved_model ?? "unresolved"}(${r.status}${r.verified ? ",verified" : ""})`).join("; "));
    else report(deterministicRef ? "WARN" : "FAIL", scope, "model_provenance", `no model_executions row with resource_ref=pseudonymizeId(policy) (${deterministicRef ? "reference doc may have been read deterministically" : "extraction provenance not linked to this document"})`);
  } catch (err) { report("WARN", scope, "model_provenance", `could not check: ${(err as Error).message}`); }

  // 10. family linkage
  const memberName = up.member ?? up.memberDisplayName ?? up.memberName;
  const member = memberName ? people.find((m) => m.display_name === memberName) ?? people.find((m) => personKey(m.display_name) === personKey(memberName)) : undefined;
  const links = await q<{ family_member_id: string; source: string; confidence: string; account_id: string; member_account: string | null; member_state: string | null }>(
    `SELECT pm.family_member_id::text,pm.source,pm.confidence::text,pm.account_id::text,f.account_id::text AS member_account,f.lifecycle_state AS member_state
       FROM policy_members pm LEFT JOIN family_members f ON f.id=pm.family_member_id WHERE pm.policy_id=$1`, [p.id]);
  const foreignLinks = links.filter((l) => l.account_id !== householdId || l.member_account !== householdId);
  if (foreignLinks.length) report("FAIL", scope, "member_link_isolation", `${foreignLinks.length} policy_members row(s) cross households`);
  if (!memberName) report("WARN", scope, "member_link", "no expected member given");
  else if (!member) report("FAIL", scope, "member_link", `no active family member named "${memberName}" in household`);
  else {
    const mine = links.find((l) => l.family_member_id === member.id);
    const others = links.filter((l) => l.family_member_id !== member.id).map((l) => `${people.find((x) => x.id === l.family_member_id)?.display_name ?? l.family_member_id}(${l.source})`);
    report(mine ? "PASS" : "FAIL", scope, "member_link", `${member.display_name}: ${mine ? `linked source=${mine.source} confidence=${mine.confidence}` : "NOT linked in policy_members"}${others.length ? `; also linked to ${others.join(", ")}` : ""} (upload family_member_id ${p.family_member_id === member.id ? "=" : "!="} member)`);
    if (others.length && p.personal_coverage_confirmed) report("WARN", scope, "member_link_extra", `personal document also linked to ${others.join(", ")}`);
    const detectedForMember = detected.filter((d) => d.matched === member.id);
    if (p.personal_coverage_confirmed) report(detectedForMember.length ? "PASS" : "FAIL", scope, "insured_matched", `policy_detected_people matched to ${member.display_name}: ${detectedForMember.map((d) => d.detected_name).join(", ") || "none"}; unmatched: ${detected.filter((d) => !d.matched).map((d) => d.detected_name).join(", ") || "none"}`);
    const wrongOwner = cands.filter((c) => c.table === "policy_coverages" && c.memberId && !links.some((l) => l.family_member_id === c.memberId));
    if (wrongOwner.length) report("FAIL", scope, "coverage_owner", `${wrongOwner.length} policy_coverages rows owned by a member not linked to the document`);

    // 11. "reopen the session": the app's own loaders return the same facts
    try {
      const L = await loaders();
      const inv = await L.loadPolicyInventory(householdId, people);
      const doc = inv.documents.find((d) => d.id === p.id);
      const contract = inv.contracts.find((c) => c.ownerId === member.id && [...c.documents, ...c.references].some((d) => d.id === p.id));
      report(doc ? "PASS" : "FAIL", scope, "reload_inventory", doc ? `loadPolicyInventory returns it (insurer=${doc.insurer ?? "null"}, policy_number=${doc.policy_number ?? "null"}, pages=${doc.page_total}, chunks=${doc.chunk_total})` : "loadPolicyInventory does NOT return the document");
      report(contract ? "PASS" : (p.personal_coverage_confirmed ? "FAIL" : "WARN"), scope, "reload_contract", contract ? `contract "${contract.name}" owner=${member.display_name} basis=${contract.ownershipBasis} coverages=${contract.coverages.length}` : `no contract for ${member.display_name} contains this document (chat will not use it for them)`);
      const catalog = await L.loadBenefitCatalog(householdId, [p.id]);
      const dbIds = new Set(cands.filter((c) => c.table === "policy_benefits").map((c) => c.id));
      const loadedIds = new Set(catalog.map((c) => c.id));
      const same = dbIds.size === loadedIds.size && [...dbIds].every((id) => loadedIds.has(id));
      report(same ? "PASS" : "FAIL", scope, "reload_benefit_catalog", `loadBenefitCatalog=${loadedIds.size} rows, policy_benefits=${dbIds.size}`);
      for (const b of up.expected.benefits ?? []) {
        const hit = catalog.find((c) => nameMatches(b.name, c.benefitName) && amountEquals(b, c.formulaValue) && (b.currency == null || (c.currency ?? "").toUpperCase() === b.currency.toUpperCase()));
        const cov = (await L.confirmedOwnedCoverages(householdId, member.id)).find((c) => c.policyId === p.id && nameMatches(b.name, [c.productName, c.category].filter(Boolean).join(" ")) && amountEquals(b, c.amount));
        const led = (await L.loadLedger(householdId, [member.id])).find((r) => r.policyId === p.id && nameMatches(b.name, [r.planName, r.detail].filter(Boolean).join(" ")) && amountEquals(b, r.amount));
        report(hit || cov || led ? "PASS" : "FAIL", scope, `reload "${b.name}"`, `catalog=${hit ? "yes" : "no"} ownedCoverage=${cov ? "yes" : "no"} ledger=${led ? "yes" : "no"}`);
      }
      const owned = (await L.confirmedOwnedCoverages(householdId, member.id)).filter((c) => c.policyId === p.id);
      const dbOwned = await q<{ n: number }>(`SELECT count(*)::int AS n FROM policy_coverages WHERE policy_id=$1 AND account_id=$2 AND family_member_id=$3 AND confirmed AND evidence_verified`, [p.id, householdId, member.id]);
      report(owned.length === dbOwned[0].n ? "PASS" : "FAIL", scope, "reload_owned_coverages", `confirmedOwnedCoverages=${owned.length} db=${dbOwned[0].n}; currencyVerified=${owned.filter((c) => (c as { currencyVerified?: boolean }).currencyVerified).length}/${owned.length}`);
    } catch (err) { report("FAIL", scope, "reload", `loader threw: ${(err as Error).message}`); }
  }
}

// ---------------------------------------------------------------- household-wide checks
async function verifyHouseholdWide(householdId: string, people: Person[]) {
  const scope = `[household ${householdId}]`;
  const acct = await q<{ name: string }>(`SELECT name FROM accounts WHERE id=$1`, [householdId]);
  if (!acct.length) { report("FAIL", scope, "household", "no accounts row"); return false; }
  report("INFO", scope, "household", `"${acct[0].name}" active members=${people.map((m) => m.display_name).join(", ") || "none"}`);
  // Defaulted currency anywhere in this household's stored facts.
  const defaulted = await q<{ t: string; id: string; name: string; currency: string; policy_id: string }>(
    `WITH facts AS (
       SELECT 'policy_benefits' AS t,b.id::text,b.benefit_name AS name,b.currency,b.policy_id FROM policy_benefits b WHERE b.account_id=$1 AND b.currency IS NOT NULL
       UNION ALL SELECT 'policy_coverages',c.id::text,coalesce(c.product_name,c.category),c.currency,c.policy_id FROM policy_coverages c WHERE c.account_id=$1 AND c.currency IS NOT NULL
       UNION ALL SELECT 'coverage_rules',r.id::text,coalesce(r.detail,r.plan_name),r.currency,r.policy_id FROM coverage_rules r WHERE r.account_id=$1 AND r.policy_id IS NOT NULL AND r.status<>'rejected')
     SELECT f.t,f.id,f.name,f.currency,f.policy_id::text,(SELECT string_agg(pp.text,' ') FROM policy_pages pp WHERE pp.policy_id=f.policy_id) AS doc
       FROM facts f`, [householdId]);
  const bad = defaulted.filter((r) => !currencyPrinted(r.currency, String((r as unknown as { doc: string | null }).doc ?? "")));
  report(bad.length ? "FAIL" : "PASS", scope, "no_defaulted_currency", `${defaulted.length - bad.length}/${defaulted.length} stored currencies are printed in their source document`, bad.slice(0, 20).map((r) => `${r.t}:${r.name}=${r.currency}`));
  if (bad.length) for (const r of bad.slice(0, 10)) report("FAIL", scope, "defaulted_currency", `${r.t} "${r.name}" ${r.currency} (policy ${r.policy_id})`);

  // Hidden documents must stay hidden from every loader.
  const hidden = await q<{ id: string; why: string }>(
    `SELECT id::text, concat_ws(',', CASE WHEN lifecycle_state<>'active' THEN 'lifecycle='||lifecycle_state END,
            CASE WHEN superseded_at IS NOT NULL THEN 'superseded' END,
            CASE WHEN coalesce(quarantine_status,'') NOT IN ('scan_clean','not_scanned_prototype') THEN 'quarantine='||coalesce(quarantine_status,'null') END) AS why
       FROM policies WHERE account_id=$1 AND (lifecycle_state<>'active' OR superseded_at IS NOT NULL OR coalesce(quarantine_status,'') NOT IN ('scan_clean','not_scanned_prototype'))`, [householdId]);
  if (hidden.length) await verifyHiddenFromLoaders(householdId, people, hidden);
  else report("INFO", scope, "hidden_documents", "no deleted/superseded/unreleased documents in this household");
  return true;
}

async function verifyHiddenFromLoaders(householdId: string, people: Person[], hidden: { id: string; why: string }[]) {
  const scope = `[household ${householdId}]`;
  const L = await loaders();
  const ids = new Set(hidden.map((h) => h.id));
  const inv = await L.loadPolicyInventory(householdId, people);
  const inDocs = inv.documents.filter((d) => ids.has(d.id));
  const inContracts = inv.contracts.filter((c) => [...c.documents, ...c.references].some((d) => ids.has(d.id)));
  const catalogIds = [...new Set(inv.contracts.flatMap((c) => [...c.documents, ...c.references].map((d) => d.id)))];
  const catalog = await L.loadBenefitCatalog(householdId, catalogIds);
  const ledger = await L.loadLedger(householdId);
  const owned = (await Promise.all(people.map((m) => L.confirmedOwnedCoverages(householdId, m.id)))).flat();
  const leaks = {
    inventoryDocuments: inDocs.map((d) => `${d.id}(${hidden.find((h) => h.id === d.id)?.why})`),
    contracts: inContracts.map((c) => c.name),
    benefitCatalog: catalog.filter((b) => ids.has(b.policyId)).length,
    ledger: ledger.filter((r) => r.policyId && ids.has(r.policyId)).length,
    ownedCoverages: owned.filter((c) => ids.has(c.policyId)).length,
  };
  const leaked = leaks.inventoryDocuments.length + leaks.contracts.length + leaks.benefitCatalog + leaks.ledger + leaks.ownedCoverages;
  report(leaked ? "FAIL" : "PASS", scope, "hidden_not_loaded",
    `${hidden.length} hidden doc(s); leaked via inventory=${leaks.inventoryDocuments.length} contracts=${leaks.contracts.length} catalog=${leaks.benefitCatalog} ledger=${leaks.ledger} ownedCoverages=${leaks.ownedCoverages}${leaks.inventoryDocuments.length ? " [" + leaks.inventoryDocuments.join(", ") + "]" : ""}`, leaks);
}

// ---------------------------------------------------------------- isolation
async function verifyIsolation(pair: string[]) {
  const scope = "[isolation]";
  const scoped = await scopedTables();
  const keyOf = new Map<string, string>(); // table -> household key column
  for (const r of scoped) if (!keyOf.has(r.table_name) || r.column_name === "account_id") keyOf.set(r.table_name, r.column_name);
  const refCols = await columnsByName(Object.keys(REFERENCE_TARGETS));
  let mismatches = 0;
  for (const rc of refCols) {
    const target = REFERENCE_TARGETS[rc.column_name];
    const key = keyOf.get(rc.table_name);
    const targetKey = keyOf.get(target) ?? "account_id";
    if (!key || rc.table_name === target && rc.column_name === "id") continue;
    if (!(await q(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [target])).length) continue;
    const r = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM "${rc.table_name}" s JOIN "${target}" t ON t.id::text = s."${rc.column_name}"::text
        WHERE s."${key}"::text IS DISTINCT FROM t."${targetKey}"::text`);
    if (r[0].n) { mismatches += r[0].n; report("FAIL", scope, "cross_household_reference", `${rc.table_name}.${rc.column_name} -> ${target}: ${r[0].n} row(s) reference another household's row`); }
  }
  // policy_members / policy_coverages / coverage_rules / chunks: both ends must share the household
  report(mismatches ? "FAIL" : "PASS", scope, "reference_consistency", `${refCols.length} reference columns across ${new Set(refCols.map((r) => r.table_name)).size} tables checked; ${mismatches} cross-household reference(s)`);

  if (pair.length < 2) return;
  const [A, B] = pair;
  for (const [x, y] of [[A, B], [B, A]]) {
    // Every id owned by household y (any table with an id column + household key).
    const idOwners = await q<{ table_name: string }>(
      `SELECT DISTINCT c.table_name FROM information_schema.columns c WHERE c.table_schema='public' AND c.column_name='id' AND c.table_name = ANY($1)`, [[...keyOf.keys()]]);
    const yIds: string[] = [];
    // Only globally-unique (uuid) ids: serial ids like policy_pages.id would match any digit.
    for (const t of idOwners) yIds.push(...(await q<{ id: string }>(`SELECT id::text FROM "${t.table_name}" WHERE "${keyOf.get(t.table_name)}"::text=$1`, [y])).map((r) => r.id).filter((id) => UUID.test(id)));
    yIds.push(y);
    let hits = 0;
    const where: string[] = [];
    if (yIds.length) for (const t of keyOf.keys()) {
      const r = await q<{ n: number }>(`SELECT count(*)::int AS n FROM "${t}" s WHERE s."${keyOf.get(t)}"::text=$1 AND EXISTS (SELECT 1 FROM unnest($2::text[]) i WHERE strpos(s::text, i) > 0)`, [x, yIds]);
      if (r[0].n) { hits += r[0].n; where.push(`${t}=${r[0].n}`); }
    }
    report(hits ? "FAIL" : "PASS", scope, `no_${x.slice(0, 8)}_rows_mention_${y.slice(0, 8)}_ids`, `${yIds.length} ids of ${y} searched in every column of ${x}'s rows${where.length ? ": " + where.join(", ") : ""}`);
    // App loaders asked for x with y's ids must return nothing.
    const L = await loaders();
    try {
    const yPeople = await activePeople(y);
    const yPolicies = (await q<{ id: string }>(`SELECT id::text FROM policies WHERE account_id=$1`, [y])).map((r) => r.id);
    const yConvs = (await q<{ id: string }>(`SELECT id::text FROM chat_conversations WHERE account_id=$1`, [y])).map((r) => r.id);
    const inv = await L.loadPolicyInventory(x, yPeople);
    const cat = await L.loadBenefitCatalog(x, yPolicies);
    const cov = (await Promise.all(yPeople.map((m) => L.confirmedOwnedCoverages(x, m.id)))).flat();
    const led = yPeople.length ? await L.loadLedger(x, yPeople.map((m) => m.id)) : [];
    const conv = (await Promise.all(yConvs.map((id) => L.getConversation(x, id)))).filter(Boolean);
    const leaks = inv.contracts.length + inv.documents.filter((d) => yPolicies.includes(d.id)).length + cat.length + cov.length + led.length + conv.length;
    report(leaks ? "FAIL" : "PASS", scope, `loaders_${x.slice(0, 8)}_with_${y.slice(0, 8)}_ids`,
      `contracts=${inv.contracts.length} catalog=${cat.length} ownedCoverages=${cov.length} ledger=${led.length} conversations=${conv.length} (${yPeople.length} members, ${yPolicies.length} policies, ${yConvs.length} conversations of ${y})`);
    } catch (err) {
      report("FAIL", scope, `loaders_${x.slice(0, 8)}_with_${y.slice(0, 8)}_ids`, isReadOnlyViolation(err)
        ? `a loader attempted a database write (blocked by the read-only session): ${(err as Error).message}` : `loader threw: ${(err as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------- deletion
async function verifyDeletedPolicy(householdId: string, policyId: string) {
  const scope = `[deleted ${policyId}]`;
  const row = (await q<{ lifecycle_state: string; quarantine_status: string | null; storage_key: string; account_id: string }>(
    `SELECT lifecycle_state,quarantine_status,storage_key,account_id::text FROM policies WHERE id=$1`, [policyId]))[0];
  report(!row || row.lifecycle_state !== "active" ? "PASS" : "FAIL", scope, "policy_row", row ? `row retained: lifecycle=${row.lifecycle_state} quarantine=${row.quarantine_status}` : "row hard-deleted");
  const req = await q<{ lifecycle_state: string; completed_at: string | null }>(`SELECT lifecycle_state,completed_at::text FROM deletion_requests WHERE resource_type='policy' AND resource_id::text=$1 ORDER BY created_at DESC LIMIT 1`, [policyId]);
  report(req.length ? "INFO" : "WARN", scope, "deletion_request", req.length ? `state=${req[0].lifecycle_state} completed_at=${req[0].completed_at ?? "null"}` : "no deletion_requests row");
  // Every policy-scoped table, discovered dynamically.
  const refCols = (await columnsByName(["policy_id", "source_document_id", "contract_id"])).filter((r) => r.table_name !== "policies");
  const remaining: string[] = [];
  for (const rc of refCols) {
    const n = (await q<{ n: number }>(`SELECT count(*)::int AS n FROM "${rc.table_name}" WHERE "${rc.column_name}"::text=$1`, [policyId]))[0].n;
    if (n) remaining.push(`${rc.table_name}.${rc.column_name}=${n}`);
  }
  report(remaining.length ? "FAIL" : "PASS", scope, "policy_scoped_rows", remaining.length ? `rows still present: ${remaining.join(", ")}` : `0 rows in ${refCols.length} policy-scoped columns`);
  const cache = (await q<{ n: number }>(`SELECT count(*)::int AS n FROM policy_analysis_cache WHERE cache_key LIKE '%'||$1||'%' OR analysis_json::text LIKE '%'||$1||'%'`, [policyId]))[0].n;
  report(cache ? "FAIL" : "PASS", scope, "policy_analysis_cache", `${cache} cache row(s) mention the policy`);
  const jobs = await q<{ job_type: string; status: string; secret: boolean; cancel_requested: boolean }>(
    `SELECT job_type,status,(payload ? 'pdfPassword' AND payload->>'pdfPassword' IS NOT NULL) AS secret,cancel_requested FROM background_jobs WHERE idempotency_key=$1 OR payload::text LIKE '%'||$1||'%'`, [policyId]);
  const secret = jobs.filter((j) => j.secret);
  report(secret.length ? "FAIL" : "PASS", scope, "job_payload_secrets", `${jobs.length} job(s) reference the policy (${jobs.map((j) => `${j.job_type}:${j.status}`).join(", ") || "none"}); pdfPassword retained in ${secret.length}`);
  const files = (await filesUnderAll()).filter(({ file }) => file.includes(policyId) || (row?.storage_key && file === row.storage_key));
  report(files.length ? "FAIL" : "PASS", scope, "storage_objects", `${files.length} file(s) for the policy under ${storageRoots().join(", ")}${files.length ? ": " + files.map((f) => f.root + "/" + f.file).join(", ") : ""}`);
  const chats = (await q<{ n: number }>(`SELECT count(*)::int AS n FROM chat_messages WHERE account_id=$1 AND (citations::text LIKE '%'||$2||'%' OR answer_json::text LIKE '%'||$2||'%')`, [householdId, policyId]))[0].n;
  report(chats ? "WARN" : "PASS", scope, "chat_history_citations", `${chats} stored chat message(s) still cite the deleted policy`);
  const people = await activePeople(householdId);
  await verifyHiddenFromLoaders(householdId, people, [{ id: policyId, why: "deleted" }]);
}

// ---------------------------------------------------------------- cleanup proof
async function cleanupProof(prefix: string, extraHouseholds: string[]) {
  const scope = "[cleanup]";
  const synthetic = await q<{ id: string; name: string }>(`SELECT id::text,name FROM accounts WHERE name LIKE $1`, [`${prefix}%`]);
  report(synthetic.length ? "FAIL" : "PASS", scope, "synthetic_accounts", `${synthetic.length} accounts named ${prefix}*${synthetic.length ? ": " + synthetic.map((s) => s.id).join(", ") : ""}`);
  const users = [process.env.E2E_USER_A, process.env.E2E_USER_B].filter((u): u is string => !!u);
  const ids = [...new Set([...synthetic.map((s) => s.id), ...extraHouseholds, ...users])];
  const scoped = await scopedTables();
  const counts: Record<string, number> = {};
  for (const t of scoped) {
    const n = (await q<{ n: number; orphan: number }>(
      `SELECT count(*) FILTER (WHERE "${t.column_name}"::text = ANY($1))::int AS n,
              count(*) FILTER (WHERE "${t.column_name}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id::text="${t.table_name}"."${t.column_name}"::text))::int AS orphan
         FROM "${t.table_name}"`, [ids]))[0];
    counts[`${t.table_name}.${t.column_name}`] = n.n;
    report(n.n ? "FAIL" : "PASS", scope, `${t.table_name}.${t.column_name}`, `${n.n} synthetic row(s)`);
    if (n.orphan) report("FAIL", scope, `${t.table_name}.${t.column_name}:orphans`, `${n.orphan} row(s) reference a household that no longer exists`);
  }
  // User-keyed tables (household_members.user_id etc.) for the synthetic users.
  if (users.length) for (const t of await columnsByName(["user_id", "reviewer_user_id", "requested_by", "invited_by"])) {
    const n = (await q<{ n: number }>(`SELECT count(*)::int AS n FROM "${t.table_name}" WHERE "${t.column_name}"::text = ANY($1)`, [users]))[0].n;
    if (n) report("WARN", scope, `${t.table_name}.${t.column_name}`, `${n} row(s) keyed by an E2E user id`);
  }
  // Content markers anywhere (tables without a household key included).
  const tables = await q<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1`);
  const markers = [prefix, "DPTEST-EXTRACTION", "SYNTHETIC-DPTEST"];
  let markerRows = 0;
  for (const t of tables) {
    const n = (await q<{ n: number }>(`SELECT count(*)::int AS n FROM "${t.table_name}" s WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) m WHERE strpos(s::text, m) > 0)`, [markers]))[0].n;
    if (n) { markerRows += n; report("FAIL", scope, `marker:${t.table_name}`, `${n} row(s) contain a synthetic marker`); }
  }
  report(markerRows ? "FAIL" : "PASS", scope, "synthetic_markers", `${tables.length} tables scanned for ${markers.join(" / ")}: ${markerRows} row(s)`);
  // Pseudonymized provenance/telemetry for the known ids.
  if (ids.length) {
    try {
      const L = await loaders();
      const refs = ids.map((id) => L.pseudonymizeId(id)).filter((r): r is string => !!r);
      const n = (await q<{ n: number }>(`SELECT count(*)::int AS n FROM model_executions WHERE household_ref = ANY($1)`, [refs]))[0].n;
      report(n ? "WARN" : "PASS", scope, "model_executions.household_ref", `${n} pseudonymized provenance row(s) for synthetic households (no account_id column; not removed by cleanup)`);
    } catch (err) { report("WARN", scope, "model_executions.household_ref", (err as Error).message); }
  }
  const orphanAudit = (await q<{ n: number }>(`SELECT count(*)::int AS n FROM background_job_audit_log l WHERE NOT EXISTS (SELECT 1 FROM background_jobs j WHERE j.id=l.job_id)`))[0].n;
  report(orphanAudit ? "INFO" : "PASS", scope, "background_job_audit_log", `${orphanAudit} audit row(s) whose job no longer exists (no household key; cannot be attributed)`);
  // Storage.
  // Every local storage layout keys files as <household id>/...; classify each
  // file by that owning household. Synthetic (prefix-named household, an E2E
  // user's household, a --household id, or a synthetic-marked file name) =>
  // FAIL. Anything else (the dev household, fixed-id regression fixtures such
  // as a9000000-...) => INFO, listed by owner, never counted as synthetic.
  const all = await filesUnderAll();
  const accountNames = new Map((await q<{ id: string; name: string }>(`SELECT id::text,name FROM accounts`)).map((r) => [r.id, r.name]));
  const synth = new Set(ids);
  const ownerOf = (file: string) => { const first = file.split(/[\\/]/)[0]; return UUID.test(first) ? first.toLowerCase() : null; };
  const syntheticFiles: typeof all = [];
  const e2eRoot = path.resolve("./.e2e-storage");
  const orphanE2E: typeof all = [];
  const otherByRoot = new Map<string, Map<string, number>>(); // root -> owner -> files
  for (const f of all) {
    const owner = ownerOf(f.file);
    if ((owner && synth.has(owner)) || /SYNTHETIC-DPTEST|DPTEST/i.test(f.file)) { syntheticFiles.push(f); continue; }
    // The e2e-only root holds nothing but e2e uploads: an owner with no accounts
    // row there is almost certainly an e2e leftover whose household is gone.
    if (f.root === e2eRoot && owner && !accountNames.has(owner)) { orphanE2E.push(f); continue; }
    const byOwner = otherByRoot.get(f.root) ?? new Map<string, number>();
    const key = owner ?? "(no household segment)";
    byOwner.set(key, (byOwner.get(key) ?? 0) + 1); otherByRoot.set(f.root, byOwner);
  }
  const rel = (r: string) => path.relative(process.cwd(), r) || r;
  const synthOwners = [...new Set(syntheticFiles.map((f) => ownerOf(f.file) ?? "?"))];
  report(syntheticFiles.length ? "FAIL" : "PASS", scope, "storage_synthetic_files",
    `${syntheticFiles.length} file(s) owned by synthetic/E2E households under ${storageRoots().map(rel).join(", ")}${syntheticFiles.length ? `; owners=${synthOwners.join(",")} e.g. ${syntheticFiles.slice(0, 3).map((f) => rel(f.root) + "/" + f.file).join(", ")}` : ""}`,
    syntheticFiles.map((f) => f.root + "/" + f.file));
  if (orphanE2E.length) report("WARN", scope, "storage_e2e_orphans",
    `${orphanE2E.length} file(s) in ${rel(e2eRoot)} owned by household(s) with no accounts row (likely e2e leftovers; pass --household <id> to classify as synthetic): ${[...new Set(orphanE2E.map((f) => ownerOf(f.file)))].join(", ")}`,
    orphanE2E.map((f) => f.root + "/" + f.file));
  for (const [root, byOwner] of otherByRoot) {
    const owners = [...byOwner.entries()].sort((a, b) => b[1] - a[1]);
    const files = owners.reduce((n, [, c]) => n + c, 0);
    const label = (o: string) => accountNames.has(o) ? `${o}="${accountNames.get(o)}"` : o;
    report("INFO", scope, "storage_nonsynthetic_files",
      `${rel(root)}: ${files} file(s) in ${owners.length} non-synthetic household(s) (fixed-id regression fixtures / existing accounts; not counted as synthetic): ${owners.slice(0, 12).map(([o, c]) => `${label(o)}(${c})`).join(", ")}${owners.length > 12 ? `, +${owners.length - 12} more (see --json)` : ""}`,
      Object.fromEntries(owners.map(([o, c]) => [o, { files: c, account: accountNames.get(o) ?? null }])));
  }
  if (!otherByRoot.size) report("PASS", scope, "storage_nonsynthetic_files", "no other files under the storage roots");
  return counts;
}

// ---------------------------------------------------------------- main
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname) && process.env.V1_VERIFY_ALLOW_REMOTE !== "yes") {
    console.error(`refusing non-local database host ${url.hostname} (set V1_VERIFY_ALLOW_REMOTE=yes to override)`); process.exit(2);
  }
  const { Pool } = await import("pg");
  db = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const ro = (await q<{ ro: string }>(`SELECT current_setting('default_transaction_read_only') AS ro`))[0].ro;
  if (ro !== "on") { console.error("read-only guard not active; refusing to run"); process.exit(2); }
  const present = new Set((await q<{ t: string }>(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`, [REQUIRED_TABLES])).map((r) => r.t));
  const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
  if (missing.length) { console.error(`schema not applied (missing ${missing.join(", ")}); run e2e/support/apply-schema.ts first -- this verifier never runs DDL`); process.exit(2); }

  const households = argValues("--household");
  const expectFile = argValues("--expect")[0];
  const deleted = argValues("--deleted-policy");
  let ran = false;
  if (has("--cleanup-proof")) { ran = true; await cleanupProof(argValues("--prefix")[0] ?? "SYNTHETIC-DPTEST", households); }
  if (has("--isolation")) { ran = true; await verifyIsolation(households); }
  if (deleted.length) {
    ran = true;
    if (!households[0]) throw new Error("--deleted-policy needs --household <id>");
    for (const id of deleted) await verifyDeletedPolicy(households[0], id);
  }
  if (expectFile || (households.length === 1 && !ran)) {
    ran = true;
    const hh = households[0];
    if (!hh) throw new Error("--expect needs --household <id>");
    const people = await activePeople(hh);
    if (await verifyHouseholdWide(hh, people) && expectFile) {
      const uploads = await loadExpectations(expectFile);
      for (const up of uploads) await verifyUpload(hh, up, people);
    }
  }
  if (!ran) {
    console.error("usage: node --import tsx scripts/v1-db-verification.ts --household <id> --expect <file> | --isolation [--household A --household B] | --deleted-policy <id> --household <id> | --cleanup-proof [--prefix P] [--household id...] [--json]");
    process.exit(2);
  }
  const tally = { PASS: 0, WARN: 0, FAIL: 0, INFO: 0 } as Record<Status, number>;
  for (const r of results) tally[r.status]++;
  if (JSON_OUT) console.log(JSON.stringify({ ok: tally.FAIL === 0, tally, results }, null, 2));
  else console.log(`SUMMARY ${tally.FAIL ? "FAIL" : "OK"} pass=${tally.PASS} warn=${tally.WARN} fail=${tally.FAIL} info=${tally.INFO}`);
  process.exitCode = tally.FAIL ? 1 : 0;
}

main().catch((err) => { console.error("v1-db-verification error:", err instanceof Error ? err.stack : err); process.exitCode = 2; })
  .finally(async () => {
    await db?.end().catch(() => undefined);
    await loadersCache?.appPool.end().catch(() => undefined);
  });
