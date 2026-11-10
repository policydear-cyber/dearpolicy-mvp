/** The Benefits page applies DC's joint-schedule rule (10 Nov) as the benefit table does: on a document two people hold as
 * their own, a row that prints its own figure is shown only for the life its column names, or whose own sum it is, and
 * otherwise for no one (TE #406: the Benefits page showed every joint and shared figure to both people). Runs the real
 * Benefits route on a disposable PostgreSQL with a made-up shared certificate in S$; no model, no network.
 *   DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://... npm run -s benefits:shared-row-owners-route-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const url = process.env.DATABASE_URL ?? "";
if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
  console.log("shared row owners route: skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run)"); process.exit(0);
}
const ACCOUNT = randomUUID(), USER = randomUUID();
Object.assign(process.env, { DEV_AUTH_ENABLED: "1", DEV_ACCOUNT_ID: USER });
for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC_KEY|OPENAI_KEY/i.test(k)) delete process.env[k];
let outbound = 0; const localFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) { outbound++; throw new Error("no network"); }
  return localFetch(input, init);
}) as typeof fetch;

async function main() {
  const { query } = await import("@/lib/db/client");
  const { GET } = await import("@/app/api/benefits/route");
  const { syncInsuredPersonToMember } = await import("@/lib/policies/linking");
  const { sharedRowOwners, printedAmounts, printedFigures, NOT_TOLD_NOTE } = await import("@/lib/policies/shared-row-owners");
  let passed = 0; const failures: string[] = [];
  const test = async (name: string, fn: () => Promise<void>) => { try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } };

  await test("U the rule itself: column naming the life, own sum, no one; one holder or a row on each person's own sum unchanged", async () => {
    const c = (ownerId: string, ownerName: string, amount: number) => ({ ownerId, ownerName, documents: [{ id: "d" }], coverages: [{ policyId: "d", amount, currency: "SGD" }] });
    const two = [c("j", "Jane Doe", 300000), c("k", "John Roe", 120000)];
    const row = (o: Partial<Parameters<typeof sharedRowOwners>[0]>) => ({ policyId: "d", tier: null, formulaKind: "fixed", formulaValue: 300000, currency: "SGD", ...o });
    assert.deepEqual([...sharedRowOwners(row({}), two)!], ["j"]);
    assert.deepEqual([...sharedRowOwners(row({ formulaValue: 5000 }), two)!], []);
    assert.deepEqual([...sharedRowOwners(row({ tier: "Life Assured: John Roe", formulaValue: 7500 }), two)!], ["k"]);
    assert.deepEqual([...sharedRowOwners(row({ tier: "Payable to John Roe", formulaValue: 7500 }), two)!], []);
    assert.equal(sharedRowOwners(row({ formulaKind: "sum_insured", formulaValue: 1 }), two), null);
    assert.equal(sharedRowOwners(row({}), [two[0]]), null);
    // A row stored with no formula still prints its amount in its quote: never everyone's by default (TE #406).
    assert.deepEqual([...sharedRowOwners(row({ formulaKind: "none", formulaValue: null, quote: "Egret Joint Shield S$120,000" }), two)!], ["k"]);
    assert.deepEqual([...sharedRowOwners(row({ formulaKind: "none", formulaValue: null, quote: "Medical Expenses S$2,000" }), two)!], []);
    assert.deepEqual([...sharedRowOwners(row({ formulaKind: "none", formulaValue: null, quote: "Death S$300,000 S$120,000" }), two)!], [], "a line printing both sums is no one's");
    assert.equal(sharedRowOwners(row({ formulaKind: "none", formulaValue: null, quote: "Pays on diagnosis of a covered condition" }), two), null);
    assert.deepEqual([...sharedRowOwners(row({ formulaKind: "sum_insured", formulaValue: 1, quote: "100% of Sum Insured (S$300,000)" }), two)!], ["j"]);
    // A wording both reference, held as no one's own document: unchanged.
    assert.equal(sharedRowOwners(row({}), two.map((x) => ({ ...x, documents: [{ id: "other" }] }))), null);
  });

  await test("G1 a row on each person's own sum stays everyone's; a cap or limit is never matched to anyone's sum", async () => {
    const c = (ownerId: string, ownerName: string, amount: number) => ({ ownerId, ownerName, documents: [{ id: "d" }], coverages: [{ policyId: "d", amount, currency: "SGD" }] });
    const two = [c("j", "Jane Doe", 50000), c("k", "John Roe", 30000)];
    const row = (formulaKind: string, formulaValue: number | null, quote: string) => ({ policyId: "d", tier: null, formulaKind, formulaValue, currency: "SGD", quote });
    assert.equal(sharedRowOwners(row("sum_insured", 0.25, "Early Critical Illness: 25% of Sum Assured, up to S$25,000"), two), null);
    assert.equal(sharedRowOwners(row("sum_insured", 1, "Death Benefit 100% of Sum Assured, maximum S$50,000 per life"), two), null);
    assert.equal(sharedRowOwners(row("limit_percentage", 0.1, "Simple Fracture 10% of Benefit Limit S$5,000"), two), null);
    assert.equal(sharedRowOwners(row("limit_percentage", 0.1, "Simple Fracture 10% of Benefit Limit S$50,000"), two), null, "a limit equal to a holder's sum is still a limit");
    assert.deepEqual([...sharedRowOwners(row("sum_insured", 1, "Death 100% of Sum Assured (S$30,000)"), two)!], ["k"]);
    // A row with no formula that prints only a cap: not everyone's, and not matched to the holder whose sum it equals.
    assert.deepEqual([...sharedRowOwners(row("none", null, "Accidental Death up to S$50,000"), two)!], []);
  });

  await test("G2 a printed amount matches a holder's sum only in the same currency", async () => {
    const c = (ownerId: string, ownerName: string, amount: number, currency = "SGD") => ({ ownerId, ownerName, documents: [{ id: "d" }], coverages: [{ policyId: "d", amount, currency }] });
    const two = [c("j", "Jane Doe", 50000), c("k", "John Roe", 30000)];
    const row = (o: Partial<Parameters<typeof sharedRowOwners>[0]>) => ({ policyId: "d", tier: null, formulaKind: "none", formulaValue: null, currency: null, ...o });
    assert.deepEqual([...sharedRowOwners(row({ quote: "Accidental Death US$50,000" }), two)!], []);
    assert.deepEqual([...sharedRowOwners(row({ quote: "Accidental Death USD 50,000" }), two)!], []);
    assert.deepEqual([...sharedRowOwners(row({ quote: "Accidental Death S$50,000" }), two)!], ["j"]);
    assert.deepEqual([...sharedRowOwners(row({ formulaKind: "fixed", formulaValue: 50000, quote: "Accidental Death US$50,000" }), two)!], [], "a fixed row with no stored currency takes its quote's");
    assert.deepEqual([...sharedRowOwners(row({ formulaKind: "fixed", formulaValue: 50000, currency: "USD", quote: "Accidental Death 50,000" }), two)!], []);
    // An unsigned figure matches only when the document's covers are all in one currency.
    assert.deepEqual([...sharedRowOwners(row({ quote: "Accidental Death 50,000" }), two)!], ["j"]);
    const mixed = [c("j", "Jane Doe", 50000), c("k", "John Roe", 30000, "USD")];
    assert.deepEqual([...sharedRowOwners(row({ quote: "Accidental Death 50,000" }), mixed)!], []);
    assert.deepEqual([...sharedRowOwners(row({ quote: "Policy No. 50,000-12 Accidental Death" }), mixed)!], []);
  });

  await test("U2 the amounts a quote prints: signed money, or figures grouped in thousands; never a percentage or a day count", async () => {
    assert.deepEqual(printedAmounts("Egret Joint Shield S$250,000"), [250000]);
    assert.deepEqual(printedAmounts("Funeral Expense RM5,000.00"), [5000]);
    assert.deepEqual(printedAmounts("Accidental Death 100,000"), [100000]);
    assert.deepEqual(printedAmounts("Hospital cash S$200 a day up to 30 days"), [200]);
    assert.deepEqual(printedAmounts("Pays 25% of the sum insured"), []);
    assert.deepEqual(printedAmounts(null), []);
    assert.deepEqual(printedFigures("Death US$50,000, maximum S$25,000"), [{ amount: 50000, currency: "USD", cap: false }, { amount: 25000, currency: "SGD", cap: true }]);
  });
  await query("INSERT INTO accounts(id,name) VALUES($1,'Shared row test household')", [ACCOUNT]);
  await query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner')", [ACCOUNT, USER]);
  const P: Record<string, string> = {};
  for (const [name, rel] of [["Siti Aminah", "self"], ["Faiz Rahman", "spouse"]])
    P[name] = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,$3) RETURNING id", [ACCOUNT, name, rel])).rows[0].id;
  const policy = randomUUID();
  const product = "Wawasan Group Life";
  const covers: [string, number][] = [["Siti Aminah", 300000], ["Faiz Rahman", 120000]];
  const extraction = { personalCoverageConfirmed: true, insurer: "Example Mutual", productName: product, policyNumber: null, paymentRecords: [],
    insuredPeople: covers.map(([p, s]) => ({ name: p, coverages: [{ category: "Death", productName: product, amount: s, currency: "SGD", sourcePage: 1,
      evidenceText: `${p}\t${product}\tSum insured S$${s.toLocaleString("en-US")}`, evidenceVerified: true, notes: null }] })) };
  const page = `GROUP CERTIFICATE\n${covers.map(([p, s]) => `${p}\t${product}\tSum insured S$${s.toLocaleString("en-US")}`).join("\n")}\nDeath benefit\tS$300,000\nFuneral benefit\tS$5,000\nBenefit\tLife Assured: Siti Aminah\tLife Assured: Faiz Rahman\nHospital cash\tS$200 a day\tS$100 a day`;
  try {
    await query(`INSERT INTO policies(id,account_id,family_member_id,product_name,original_filename,storage_key,processing_status,processing_stage,quarantine_status,personal_coverage_confirmed,document_role,insurer,extracted_json,document_authority)
      VALUES($1,$2,$3,$4,'wawasan.pdf',$5,'ready','ready','scan_clean',true,'certificate','Example Mutual',$6,90)`, [policy, ACCOUNT, P["Siti Aminah"], product, `test/${policy}`, JSON.stringify(extraction)]);
    await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [ACCOUNT, policy, page]);
    for (const [name] of covers) {
      await query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$3,'ai_name_match',0.95) ON CONFLICT DO NOTHING", [policy, P[name], ACCOUNT]);
      await syncInsuredPersonToMember({ accountId: ACCOUNT, sourcePolicyId: policy, familyMemberId: P[name], detectedName: name, extraction: extraction as never, link: { source: "ai_name_match", confidence: 0.95 } });
    }
    for (const [name, kind, value, tier, quote] of [["Death benefit", "fixed", 300000, null, "Death benefit\tS$300,000"], ["Funeral benefit", "fixed", 5000, null, "Funeral benefit\tS$5,000"],
      ["Hospital cash", "daily", 200, "Life Assured: Siti Aminah", "Hospital cash\tS$200 a day"], ["Hospital cash", "daily", 100, "Life Assured: Faiz Rahman", "Hospital cash\tS$100 a day"],
      // Stored with no formula (TE #406): each person's own line, and a row that is no one's sum.
      [product, "none", null, null, `Siti Aminah\t${product}\tSum insured S$300,000`], [product, "none", null, null, `Faiz Rahman\t${product}\tSum insured S$120,000`],
      ["Medical expenses", "none", null, null, "Medical expenses\tS$2,000"]] as const)
      await query(`INSERT INTO policy_benefits(id,account_id,policy_id,product_name,benefit_name,formula_kind,formula_value,currency,maximum_days,source_page,quote,conditions,requirements,needs_review,tier)
        VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,'SGD',$7,1,$8,'[]'::jsonb,'[]'::jsonb,false,$9)`, [ACCOUNT, policy, product, name, kind, value, kind === "daily" ? 30 : null, quote, tier]);
    type Body = { benefits: { benefitName: string; formulaValue: number | null; quote: string | null; owners: string[]; conditions: string[] }[] };
    const get = async (who?: string) => { const r = await GET(new NextRequest(`http://localhost/api/benefits${who ? `?familyMemberId=${P[who]}` : ""}`)); assert.equal(r.status, 200); return (await r.json()) as Body; };
    const shown = (b: Body) => b.benefits.map((x) => `${x.benefitName} ${x.formulaValue ?? (x.quote ?? "").match(/S\$[\d,]+/)?.[0]}`).sort();
    const siti = await get("Siti Aminah"), faiz = await get("Faiz Rahman"), all = await get();
    await test("S1 Siti sees the figure that is her own sum, and the hospital cash her column names", async () => {
      assert.deepEqual(shown(siti), ["Death benefit 300000", "Hospital cash 200", `${product} S$300,000`]);
    });
    await test("S2 Faiz never sees Siti's S$300,000, nor her column; he sees his own column", async () => {
      assert.deepEqual(shown(faiz), ["Hospital cash 100", `${product} S$120,000`]);
    });
    await test("S3 the household view names whose each row is, and says the row no one can be told for is no one's", async () => {
      const row = (n: string, v: number) => all.benefits.find((x) => x.benefitName === n && x.formulaValue === v)!;
      assert.deepEqual(row("Death benefit", 300000).owners, ["Siti Aminah"]);
      assert.deepEqual(row("Hospital cash", 100).owners, ["Faiz Rahman"]);
      assert.deepEqual(row("Funeral benefit", 5000).owners, []);
      assert.ok(row("Funeral benefit", 5000).conditions.includes(NOT_TOLD_NOTE));
      const medical = all.benefits.find((x) => x.benefitName === "Medical expenses")!;
      assert.deepEqual(medical.owners, []);
      assert.ok(medical.conditions.includes(NOT_TOLD_NOTE));
    });
  } finally {
    for (const t of ["policy_benefits", "policy_coverages", "policy_members", "policy_detected_people", "policy_pages", "policies", "family_members", "household_members"])
      await query(`DELETE FROM ${t} WHERE ${t === "household_members" ? "household_id" : "account_id"}=$1`, [ACCOUNT]).catch(() => undefined);
    await query("DELETE FROM accounts WHERE id=$1", [ACCOUNT]).catch(() => undefined);
  }
  await test("N no request left this machine", async () => assert.equal(outbound, 0));
  if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`shared row owners route: ${passed} passed, 0 failed`); process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
