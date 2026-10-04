/** Round 10: builds the messy household and prints how each upload was read
 * (R10_OUT=<file> also writes it as JSON). For before/after comparisons. */
import { writeFileSync } from "node:fs";
Object.assign(process.env, { DEARPOLICY_DETERMINISTIC_MODEL: "synthetic-e2e", E2E_RUN_ID: "r10messy", DEV_AUTH_ENABLED: "1", MODEL_PRESET: "gemini", GEMINI_API_KEY: process.env.GEMINI_API_KEY || "ci" });
delete process.env.PINECONE_API_KEY; delete process.env.SUPABASE_URL;

export async function readReport(h: import("./fixture").Household, account: string) {
  const q = async <T>(sql: string, p: unknown[] = []) => (await h.db.query<T>(sql, p)).rows;
  const rows = await q<Record<string, unknown>>(`SELECT id::text,original_filename,processing_status,processing_message,processing_error,document_role,insurer,product_name,policy_number,policy_type,
      personal_coverage_confirmed,effective_date::text,renewal_or_expiry_date::text,superseded_at IS NOT NULL AS superseded,needs_review,review_reason,page_count,extracted_json->'documentNotes' AS notes FROM policies WHERE account_id=$1 ORDER BY created_at,id`, [account]);
  const out = [];
  for (const r of rows) {
    const id = r.id as string;
    const pages = await q<{ page_number: number; m: string | null; text: string }>("SELECT page_number,to_jsonb(pg)->>'extraction_method' m,text FROM policy_pages pg WHERE policy_id=$1 ORDER BY page_number", [id]);
    const people = await q<{ display_name: string; source: string }>("SELECT f.display_name,pm.source FROM policy_members pm JOIN family_members f ON f.id=pm.family_member_id WHERE pm.policy_id=$1", [id]);
    const covs = await q<{ category: string; amount: string | null; evidence_verified: boolean; confirmed: boolean; name: string }>("SELECT c.category,c.amount::text,c.evidence_verified,c.confirmed,f.display_name name FROM policy_coverages c LEFT JOIN family_members f ON f.id=c.family_member_id WHERE c.policy_id=$1", [id]);
    const prem = await q<{ amount: string; frequency: string | null; notes: string | null }>("SELECT amount::text,frequency,notes FROM premium_records WHERE source_document_id=$1", [id]);
    const ben = await q<{ benefit_name: string; formula_kind: string; formula_value: string | null; source_page: number | null }>("SELECT benefit_name,formula_kind,formula_value::text,source_page FROM policy_benefits WHERE policy_id=$1 ORDER BY source_page,benefit_name", [id]);
    const ledger = await q<{ n: number }>("SELECT count(*)::int n FROM coverage_rules WHERE policy_id=$1", [id]).catch(() => [{ n: -1 }]);
    out.push({ ...r, pages: pages.map((p) => ({ n: p.page_number, m: p.m, chars: p.text.length, head: p.text.replace(/DPTEST-EXTRACTION:[\s\S]*?:DPTEST-END/, "[marker]").replace(/\s+/g, " ").slice(0, 90) })),
      people: people.map((p) => p.display_name + "(" + p.source + ")"), coverages: covs.map((c) => `${c.name}:${c.category}:${c.amount}:${c.evidence_verified ? "verified" : "unverified"}`),
      premiums: prem.map((p) => p.amount + "/" + p.frequency), benefits: ben.map((b) => `${b.benefit_name}=${b.formula_kind}:${b.formula_value}@p${b.source_page}`), ledgerRows: ledger[0]?.n });
  }
  return out;
}

async function main() {
  const log = console.log; console.info = () => undefined; console.debug = () => undefined; console.warn = () => undefined;
  console.log = (...a: unknown[]) => { if (typeof a[0] === "string" && /^(?:\{"|\[telemetry\]|SQL note)/.test(a[0])) return; log(...a); };
  globalThis.fetch = (async (input: RequestInfo | URL) => { throw new Error("network disabled: " + String(input)); }) as typeof fetch;
  const F = await import("./fixture");
  const t0 = Date.now();
  const h = await F.buildHousehold();
  log("built in " + (Date.now() - t0) + " ms");
  for (const u of h.uploads) log(`${u.key.padEnd(11)} ${String(u.ms).padStart(6)} ms ${u.rejected ? "REJECTED: " + u.rejected : u.threw ? "THREW: " + u.threw : ""}`);
  const report = await readReport(h, F.ACCOUNT);
  for (const r of report) log("\n" + JSON.stringify(r, null, 0));
  if (process.env.R10_OUT) writeFileSync(process.env.R10_OUT, JSON.stringify({ uploads: h.uploads, report }, null, 1));
  await h.db.close();
}
if (process.argv[1]?.endsWith("read-report.ts")) main().then(() => process.exit(0), (e) => { console.error(e); process.exit(2); });
