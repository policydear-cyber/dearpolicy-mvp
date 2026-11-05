/** Home's tile and the Coverage page give one answer for a person and a cover (lib/coverage/cover-verdict.ts; UI/UX 5 Nov:
 * Home said "Not found" for a critical illness plan the other pages showed). Runs the real dashboard and coverage routes on
 * a disposable PostgreSQL for made-up households:
 *   - a plan named with the abbreviation "CI" ("Lotus CI Care") whose rows name only illnesses: Covered, with its sum, on both;
 *   - a schedule line not yet matched to its page: "on file, please confirm" on both, never Covered, and no amount anywhere;
 *   - NEGATIVE CONTROL: wording about a product (a product summary, not the person's own) linked to the person, with no plan
 *     of theirs that it describes: "on file, please confirm", never Covered, never an amount;
 *   - that wording beside a plan of theirs it describes: Covered (the included benefit), as before;
 *   - a proven line on a superseded or unreleased document: Not found on both, and Coverage lists nothing from it;
 *   - nothing on file: Not found on both.
 * No real household, insurer or scheme; no model call; no paid call. Needs DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL.
 *   npm run -s coverage:home-coverage-verdict-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const url = process.env.DATABASE_URL ?? "";
if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
  console.log("home/coverage verdict: skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run)");
  process.exit(0);
}
const ACCOUNT = randomUUID(), USER = randomUUID();
Object.assign(process.env, { DEV_AUTH_ENABLED: "1", DEV_ACCOUNT_ID: USER, DEARPOLICY_BENEFIT_TABLE: "1", DEARPOLICY_ALPHA_ACCOUNTS: ACCOUNT });
for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC_KEY|OPENAI_KEY/i.test(k)) delete process.env[k];
let outbound = 0;
const localFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) { outbound++; throw new Error("no network"); }
  return localFetch(input, init);
}) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const { query } = await import("@/lib/db/client");
  const { readDocument, relink } = await import("@/lib/benefit-table/service");
  const { appDb } = await import("@/lib/benefit-table/app");
  const { coverKeyOf, sectionKeyOf } = await import("@/lib/benefit-table/assemble");
  const { GET: home } = await import("@/app/api/dashboard/route");
  const { GET: coverage } = await import("@/app/api/coverage/route");
  type TableModel = import("@/lib/benefit-table/model").TableModel;
  const links = new Map<string, { section: string; cover: string | null; why: string }>();
  const model = (answer: unknown): TableModel => ({ choice: { provider: "anthropic", model: "test-model" }, async call(c) {
    const json = c.schema && "links" in ((c.schema as { properties?: object }).properties ?? {}) ? { links: [...links.values()] } : answer;
    return { json, stopReason: "end_turn", model: "test-model", input: 1, output: 1, ms: 1 };
  } });

  await query("INSERT INTO accounts(id,name) VALUES($1,'Verdict test household')", [ACCOUNT]);
  await query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner')", [ACCOUNT, USER]);
  const person = async (name: string, rel: string) => (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,$3) RETURNING id", [ACCOUNT, name, rel])).rows[0].id;
  const doc = async (o: { member: string; product: string; role: string; own: boolean; quarantine?: string; superseded?: boolean; insurer?: string; text?: string }) => {
    const id = randomUUID();
    await query(`INSERT INTO policies(id,account_id,family_member_id,product_name,original_filename,storage_key,processing_status,processing_stage,quarantine_status,personal_coverage_confirmed,document_role,insurer,superseded_at)
      VALUES($1,$2,$3,$4,$5,$6,'ready','ready',$7,$8,$9,$10,$11)`, [id, ACCOUNT, o.member, o.product, `${o.product}.pdf`, `test/${id}`, o.quarantine ?? "scan_clean", o.own, o.role, o.insurer ?? "Harbourline Assurance", o.superseded ? new Date().toISOString() : null]);
    await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [ACCOUNT, id, o.text ?? `${o.product}\nPolicy schedule`]);
    await query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'upload')", [id, o.member, ACCOUNT]);
    return id;
  };
  const line = (policy: string, member: string, category: string, amount: number, product: string, proven: boolean) =>
    query(`INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,confirmed,evidence_verified)
      VALUES($1,$2,$3,$4,$5,'SGD',$6,1,$7,$8,$8)`, [ACCOUNT, policy, member, category, amount, product, `${product}\tSum Assured S$${amount.toLocaleString("en-US")}`, proven]);

  type Tile = { category: string; status: string; amount: number | null; displayAmount: string | null; parts: { amount: number | null }[] | null; known: unknown };
  const tile = async (member: string, category: string) => {
    const res = await home(new NextRequest(`http://localhost/api/dashboard?poll=1&familyMemberId=${member}`));
    const body = await res.json() as { coverages: Tile[] }; assert.equal(res.status, 200, JSON.stringify(body));
    return body.coverages.find((c) => c.category === category)!;
  };
  type Page = { verdict: string; confirmed: { amount: string | null; policy_id: string }[]; derived: { amount: string | null; display_amount: string | null }[]; table: { figure: string }[]; reference: unknown[] };
  const page = async (member: string, category: string) => {
    const res = await coverage(new NextRequest(`http://localhost/api/coverage?familyMemberId=${member}&category=${encodeURIComponent(category)}`));
    const body = await res.json() as Page; assert.equal(res.status, 200, JSON.stringify(body)); return body;
  };
  const noAmount = (t: Tile, p: Page) => {
    assert.equal(t.amount, null, "tile amount"); assert.equal(t.displayAmount, null, "tile display amount"); assert.ok(!(t.parts ?? []).some((x) => x.amount != null), "tile parts"); assert.equal(t.known, null, "tile known sum");
    assert.ok(p.confirmed.every((r) => r.amount == null), "coverage line amount"); assert.ok(p.derived.every((r) => r.amount == null && r.display_amount == null), "coverage derived amount");
    assert.equal(p.table.length, 0, "coverage table rows");
  };

  try {
    // 1. A plan named "… CI …" whose benefit rows name only illnesses, read into the benefit table.
    const mei = await person("Tan Mei Ling", "self");
    const lotus = await doc({ member: mei, product: "Lotus CI Care", role: "personal_schedule", own: true });
    const reading = { document: { kind: "personal_proof", product: "Lotus CI Care", insurer: "Harbourline Assurance", namedPeople: ["Tan Mei Ling"], plan: null, periodFrom: null, periodTo: null },
      covers: [{ person: "Tan Mei Ling", product: "Lotus CI Care", cover: "Lotus CI Care", plan: null, riderOf: null, policyNumber: "HL-7001", sumInsured: 120000, premium: null, premiumFrequency: null,
        asOf: null, startDate: null, endDate: null, page: 1, quote: "Lotus CI Care\tSum Assured S$120,000" }],
      benefits: ["Major cancer", "Heart attack"].map((b) => ({ section: null, column: null, benefit: b, pays: "amount", value: 120000, period: null, basis: null, asOf: null, percentOf: null,
        baseAmount: null, baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, quote: `${b}\tS$120,000` })) };
    await query("UPDATE policy_pages SET text=$2 WHERE policy_id=$1", [lotus, "POLICY SCHEDULE\nLife Assured\tTan Mei Ling\nPolicy number\tHL-7001\nLotus CI Care\tSum Assured S$120,000\nMajor cancer\tS$120,000\nHeart attack\tS$120,000"]);
    const read = await readDocument(appDb, model(reading), ACCOUNT, lotus); assert.ok(read.read, JSON.stringify(read));
    const section = sectionKeyOf(lotus, { section: null, column: null });
    links.set(section, { section, cover: coverKeyOf({ product: "Lotus CI Care", cover: "Lotus CI Care", plan: null }), why: "the plan's schedule" });
    await relink(appDb, model(null), ACCOUNT);
    await test("V1 a \"CI\" plan with illness-only rows: Home's Critical Illness tile is Covered with its sum", async () => {
      const t = await tile(mei, "Critical Illness"); assert.equal(t.status, "covered", JSON.stringify(t)); assert.equal(t.amount, 120000, JSON.stringify(t));
    });
    await test("V2 the same on Coverage: Covered, with its benefit-table rows", async () => {
      const p = await page(mei, "Critical Illness"); assert.equal(p.verdict, "covered", JSON.stringify(p)); assert.equal(p.table.length, 2, JSON.stringify(p.table));
    });

    // 2. A schedule line on the person's own document, not yet matched to its page.
    const raj = await person("Raj Kumar", "spouse");
    const term = await doc({ member: raj, product: "Pinnacle Term Guard", role: "personal_schedule", own: true });
    await line(term, raj, "Death", 400000, "Pinnacle Term Guard", false);
    await test("V3 an unmatched line: Home says on file, never Covered, with no amount", async () => {
      const t = await tile(raj, "Death"), p = await page(raj, "Death");
      assert.equal(t.status, "on_file", JSON.stringify(t)); assert.equal(p.verdict, "on_file", JSON.stringify(p)); noAmount(t, p);
      assert.equal(p.confirmed.length, 1, "the line is still listed for the person to check");
    });

    // 3. NEGATIVE CONTROL: a product summary linked to the person, describing no plan of theirs.
    const ana = await person("Ana Lim", "child");
    const summary = await doc({ member: ana, product: "Kestrel Shield Protector", role: "product_summary", own: false, insurer: "Kestrel Life",
      text: "PRODUCT SUMMARY\nKestrel Shield Protector\nCritical Illness Benefit: 100% of the Sum Assured, up to S$500,000" });
    await query("INSERT INTO policy_reference_coverages(account_id,policy_id,category,product_name,source_page) VALUES($1,$2,'Critical Illness','Kestrel Shield Protector',1)", [ACCOUNT, summary]);
    await test("V4 NEGATIVE CONTROL: wording only is on file on both pages, never Covered, never an amount", async () => {
      const t = await tile(ana, "Critical Illness"), p = await page(ana, "Critical Illness");
      assert.equal(t.status, "on_file", JSON.stringify(t)); assert.equal(p.verdict, "on_file", JSON.stringify(p)); noAmount(t, p);
      assert.equal(p.confirmed.length, 0); assert.equal(p.derived.length, 0);
      for (const c of ["Death", "Hospitalisation", "Total Permanent Disability"]) assert.equal((await tile(ana, c)).status, "not_covered", c);
    });

    // 4. That wording beside a plan of the person's it describes: the included benefit, as before.
    const own = await doc({ member: ana, product: "Kestrel Shield Protector", role: "personal_schedule", own: true, insurer: "Kestrel Life" });
    await line(own, ana, "Death", 200000, "Kestrel Shield Protector", true);
    await test("V5 wording with a plan of theirs it describes: Covered on both, the wording adds no amount", async () => {
      const t = await tile(ana, "Critical Illness"), p = await page(ana, "Critical Illness");
      assert.equal(t.status, "covered", JSON.stringify(t)); assert.equal(p.verdict, "covered", JSON.stringify(p)); assert.equal(t.amount, null); assert.equal(p.derived.length, 1);
      assert.ok(p.derived.every((r) => r.amount == null));
    });

    // 5. Proven lines on a superseded document and on one still waiting for its safety check.
    const wei = await person("Lee Wei", "parent");
    const old = await doc({ member: wei, product: "Bayfront Hospital Plan", role: "personal_schedule", own: true, superseded: true });
    await line(old, wei, "Hospitalisation", 300000, "Bayfront Hospital Plan", true);
    const pending = await doc({ member: wei, product: "Bayfront Accident Plan", role: "personal_schedule", own: true, quarantine: "scan_pending" });
    await line(pending, wei, "Personal Accident", 150000, "Bayfront Accident Plan", true);
    await test("V6 a superseded or unreleased document: Not found on both, and Coverage lists nothing from it", async () => {
      for (const c of ["Hospitalisation", "Personal Accident"]) {
        const t = await tile(wei, c), p = await page(wei, c);
        assert.equal(t.status, "not_covered", `${c} ${JSON.stringify(t)}`); assert.equal(p.verdict, "not_found", `${c} ${JSON.stringify(p)}`); assert.equal(p.confirmed.length, 0, c);
      }
    });
    await test("V7 nothing on file: Not found on both", async () => {
      const t = await tile(mei, "Travel"), p = await page(mei, "Travel"); assert.equal(t.status, "not_covered"); assert.equal(p.verdict, "not_found");
    });
    await test("V8 every tile's status is one of the three, and agrees with Coverage for every person and cover", async () => {
      for (const m of [mei, raj, ana, wei]) for (const c of ["Death", "Critical Illness", "Hospitalisation", "Personal Accident", "Travel"]) {
        const t = await tile(m, c), p = await page(m, c);
        assert.equal(({ covered: "covered", on_file: "on_file", not_covered: "not_found" } as Record<string, string>)[t.status], p.verdict, `${m} ${c}`);
      }
    });
  } finally {
    for (const t of ["benefit_links", "benefit_readings", "policy_reference_coverages", "policy_coverages", "policy_members", "policy_pages", "policies", "family_members", "household_members"])
      await query(`DELETE FROM ${t} WHERE ${t === "household_members" ? "household_id" : "account_id"}=$1`, [ACCOUNT]).catch(() => undefined);
    await query("DELETE FROM accounts WHERE id=$1", [ACCOUNT]).catch(() => undefined);
  }
  await test("N no request left this machine", async () => assert.equal(outbound, 0));
  if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`home/coverage verdict: ${passed} passed, 0 failed`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
