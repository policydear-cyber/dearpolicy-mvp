/** The free re-process step (lib/documents/recheck-stored-cover.ts): the plain-code fact check re-run on a document's
 * stored page text and stored reading. A schedule stored before the document-level currency rule, whose bare figures
 * were left "On file, please confirm", is confirmed; a schedule that states no currency is left exactly as it was.
 * Dry run writes nothing; amounts and currencies never change; a second run changes nothing; one household or one
 * document only; a proven line the stored pages no longer prove is reported and left proven unless asked. Every model
 * client and the network throw, and no request is made. Made-up households; disposable PostgreSQL.
 *   DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=<local> npm run -s documents:recheck-stored-cover-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC|OPENAI|_KEY$|BAIDU/i.test(k)) delete process.env[k];
let outbound = 0;
globalThis.fetch = (async () => { outbound++; throw new Error("no network or model call in this test"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
    console.log("recheck-stored-cover: skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL)");
    process.exit(0);
  }
  const { query, pool } = await import("@/lib/db/client");
  const { recheckStoredCover, recheckSummary } = await import("@/lib/documents/recheck-stored-cover");
  const { PolicyExtractionSchema } = await import("@/lib/ai/extract-policy");
  const { syncInsuredPersonToMember } = await import("@/lib/policies/linking");
  // Any model client the intake could reach throws, should anything call one.
  const anthropic = await import("@anthropic-ai/sdk").catch(() => null);
  const Messages = (anthropic as { default?: { Messages?: { prototype: { create: unknown } } } } | null)?.default?.Messages;
  if (Messages) Messages.prototype.create = () => { outbound++; throw new Error("no model call in this test"); };

  const account = randomUUID(), other = randomUUID(), third = randomUUID();
  await query("INSERT INTO accounts(id,name) VALUES($1,'Recheck test household'),($2,'Another recheck household'),($3,'Third recheck household')", [account, other, third]);
  const member = async (acct: string, name: string) => (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,'self') RETURNING id", [acct, name])).rows[0].id;
  const mei = await member(account, "Mei Tan"), ravi = await member(other, "Ravi Menon"), ana = await member(third, "Ana Lim");

  const SCHED = (name: string) => `Benefit Schedule\nLife Assured\t${name}\nCritical Illness\t150,000.00\nDeath\t200,000.00\nPersonal Accident\t100,000.00`;
  const LINES = [["Critical Illness", 150000, "Critical Illness\t150,000.00"], ["Death", 200000, "Death\t200,000.00"], ["Personal Accident", 100000, "Personal Accident\t100,000.00"]] as const;
  type Stored = { proven?: boolean; lines?: readonly (readonly [string, number, string])[];
    /** The intake's record of pages read against their image: {} (none), a map, or null for a reading stored before it. */
    record?: Record<string, string | null> | null; methods?: (string | null)[]; status?: string };
  /** A document as the intake stored it before this fix: its reading, its pages, the person's name and their lines. */
  const doc = async (acct: string, fm: string, name: string, pages: string[], s: Stored = {}) => {
    const id = randomUUID(), lines = s.lines ?? LINES, proven = s.proven ?? false;
    const extraction = PolicyExtractionSchema.parse({
      documentType: "Policy schedule", documentRole: "personal_schedule", documentNotes: [], insurer: "Lantern Mutual (fictitious)", productName: "Lantern Shield", productsMentioned: ["Lantern Shield"],
      policyNumber: null, groupPolicyNumber: null, policyType: "Whole Life", policyholder: null, personalCoverageConfirmed: true, startDate: null, renewalOrExpiryDate: null,
      insuredPeople: [{ name, relationshipHint: "self", coverages: lines.map(([category, amount, evidence]) => ({ category, productName: null, policyNumber: null, amount, currency: "SGD", notes: null, sourcePage: 2, evidenceText: evidence, evidenceVerified: proven })) }],
      referenceCoverages: [], premium: { amount: null, currency: null, frequency: null }, paymentRecords: [], keyExclusions: [], waitingPeriods: [], deductiblesAndCoinsurance: [], riders: [],
    });
    await query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,original_filename,storage_key,processing_status,processing_stage,quarantine_status,personal_coverage_confirmed,document_role,extracted_json)
      VALUES($1,$2,$3,'Lantern Mutual (fictitious)','Lantern Shield','schedule.pdf',$4,'ready','ready','scan_clean',true,'personal_schedule',$5::jsonb)`, [id, acct, fm, `test/${id}`, JSON.stringify({ ...extraction, benefitTableProgress: { keep: true }, ...(s.record === null ? {} : { pageImageCurrency: s.record ?? {} }) })]);
    if (s.status) await query("UPDATE policies SET processing_status=$2 WHERE id=$1", [id, s.status]);
    for (const [i, text] of pages.entries()) await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text,extraction_method) VALUES($1,$2,$3,$4,$5)", [acct, id, i + 1, text, s.methods?.[i] ?? "native"]);
    await query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$3,'ai_name_match',0.95)", [id, fm, acct]);
    await query("INSERT INTO policy_detected_people(account_id,policy_id,detected_name,matched_family_member_id,confidence) VALUES($1,$2,$3,$4,0.95)", [acct, id, name, fm]);
    for (const [category, amount, evidence] of lines) await query(`INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,source_page,authority,confirmed,evidence_text,evidence_verified)
      VALUES($1,$2,$3,$4,$5,'SGD',2,'personal_document',$6,$7,$6)`, [acct, id, fm, category, amount, proven, evidence]);
    return id;
  };
  const rows = async (policy: string) => (await query<{ category: string; amount: string; currency: string; confirmed: boolean; evidence_verified: boolean }>(
    "SELECT category, amount::text, currency, confirmed, evidence_verified FROM policy_coverages WHERE policy_id=$1 ORDER BY category", [policy])).rows;
  const json = async (policy: string) => (await query<{ j: { insuredPeople: { coverages: { evidenceVerified: boolean; amount: number; currency: string }[] }[]; benefitTableProgress?: unknown } }>("SELECT extracted_json AS j FROM policies WHERE id=$1", [policy])).rows[0].j;

  const stated = await doc(account, mei, "Mei Tan", ["Lantern Mutual (fictitious)\nPolicy Schedule\nCurrency : Singapore Dollar\nPolicyholder\tMei Tan", SCHED("Mei Tan")]);
  const silent = await doc(account, mei, "Mei Tan", ["Lantern Mutual (fictitious)\nPolicy Schedule\nPolicy No.\tLM-0101\nPolicyholder\tMei Tan", SCHED("Mei Tan")]);
  const exchange = await doc(account, mei, "Mei Tan", ["Lantern Mutual (fictitious)\nPolicy Schedule\nPolicyholder\tMei Tan", SCHED("Mei Tan") + "\nClaims will be converted to Singapore Dollars at the prevailing exchange rate."]);
  // Proven at intake by something the stored pages do not hold (a currency only the page image printed).
  const imageOnly = await doc(account, mei, "Mei Tan", ["Lantern Mutual (fictitious)\nPolicy Schedule\nPolicyholder\tMei Tan", SCHED("Mei Tan")], { proven: true });
  const otherHousehold = await doc(other, ravi, "Ravi Menon", ["Lantern Mutual (fictitious)\nCurrency: SGD\nPolicyholder\tRavi Menon", SCHED("Ravi Menon")]);
  const before = { stated: await rows(stated), other: await rows(otherHousehold) };

  try {
    await test("D dry run counts the lines that would change, by direction, and writes nothing", async () => {
      const r = await recheckStoredCover({ accountId: account });
      assert.equal(r.apply, false); assert.equal(r.documents, 4);
      assert.equal(r.upgrades, 3); assert.equal(r.downgrades, 3); assert.equal(r.downgradesApplied, 0);
      assert.ok(r.changes.every((c) => !c.applied));
      assert.deepEqual(await rows(stated), before.stated);
      assert.ok((await json(stated)).insuredPeople[0].coverages.every((c) => c.evidenceVerified === false));
      assert.match(recheckSummary(r), /Unconfirmed -> confirmed: 3;[\s\S]*Confirmed -> unconfirmed: 3 \(reported only/);
    });
    await test("A apply on one document: its bare lines are confirmed; amounts and currency unchanged; the stored reading agrees", async () => {
      const r = await recheckStoredCover({ accountId: account, policyId: stated }, { apply: true });
      assert.equal(r.documents, 1); assert.equal(r.upgrades, 3); assert.equal(r.downgrades, 0);
      const after = await rows(stated);
      assert.ok(after.every((x) => x.confirmed && x.evidence_verified));
      assert.deepEqual(after.map((x) => [x.category, x.amount, x.currency]), before.stated.map((x) => [x.category, x.amount, x.currency]));
      const j = await json(stated);
      assert.ok(j.insuredPeople[0].coverages.every((c) => c.evidenceVerified === true && c.currency === "SGD"));
      assert.deepEqual(j.insuredPeople[0].coverages.map((c) => c.amount), LINES.map((l) => l[1]));
      assert.deepEqual(j.benefitTableProgress, { keep: true }, "other keys of the stored reading are kept");
    });
    await test("N negative controls: no statement, or only an exchange clause: nothing changes", async () => {
      for (const id of [silent, exchange]) {
        const was = await rows(id);
        const r = await recheckStoredCover({ accountId: account, policyId: id }, { apply: true });
        assert.equal(r.upgrades + r.downgrades, 0); assert.equal(r.unchanged, 3);
        assert.deepEqual(await rows(id), was);
      }
    });
    await test("G a proven line the stored pages no longer prove is reported and left proven", async () => {
      const r = await recheckStoredCover({ accountId: account, policyId: imageOnly }, { apply: true });
      assert.equal(r.downgrades, 3); assert.equal(r.downgradesApplied, 0);
      assert.ok(r.changes.every((c) => c.from && !c.to && !c.applied));
      assert.ok((await rows(imageOnly)).every((x) => x.confirmed && x.evidence_verified));
    });
    await test("I idempotent: a second run over the household changes nothing new", async () => {
      const r = await recheckStoredCover({ accountId: account }, { apply: true });
      assert.equal(r.upgrades, 0); assert.equal(r.downgradesApplied, 0); assert.equal(r.downgrades, 3, "still reported");
      assert.ok((await rows(stated)).every((x) => x.confirmed));
    });
    await test("H another household is never touched", async () => assert.deepEqual(await rows(otherHousehold), before.other));
    await test("L a later re-link from the stored reading rebuilds the same confirmed lines", async () => {
      const j = PolicyExtractionSchema.parse(await json(stated));
      await syncInsuredPersonToMember({ accountId: account, sourcePolicyId: stated, familyMemberId: mei, detectedName: "Mei Tan", extraction: j });
      assert.ok((await rows(stated)).every((x) => x.confirmed && x.evidence_verified));
    });
    await test("G2 with allowDowngrade the reported downgrade is applied (and reported)", async () => {
      const r = await recheckStoredCover({ accountId: account, policyId: imageOnly }, { apply: true, allowDowngrade: true });
      assert.equal(r.downgradesApplied, 3); assert.ok(r.changes.every((c) => c.applied));
      assert.ok((await rows(imageOnly)).every((x) => !x.confirmed && !x.evidence_verified));
    });
    // ---- Page image currency (gate fix 2): what intake knew about each page's image
    const HEAD = "Lantern Mutual (fictitious)\nPolicy Schedule\nCurrency : Singapore Dollar\nPolicyholder\tAna Lim";
    await test("P1 a reading stored before the image record, on a text-layer PDF page: upgrades held (needs a re-read)", async () => {
      const id = await doc(third, ana, "Ana Lim", [HEAD, SCHED("Ana Lim")], { record: null });
      const r = await recheckStoredCover({ accountId: third, policyId: id }, { apply: true });
      assert.equal(r.upgrades, 3); assert.equal(r.heldImageUnknown, 3); assert.equal(r.upgradesApplied, 0);
      assert.ok(r.changes.every((c) => !c.applied && c.held === "image currency unknown"));
      assert.ok((await rows(id)).every((x) => !x.confirmed));
      assert.match(recheckSummary(r), /image currency unknown \(needs a re-read\): 3/);
    });
    await test("P2 an older reading of scanned pages (OCR, no separate image reading): applied", async () => {
      const id = await doc(third, ana, "Ana Lim", [HEAD, SCHED("Ana Lim")], { record: null, methods: ["ocr", "ocr"] });
      const r = await recheckStoredCover({ accountId: third, policyId: id }, { apply: true });
      assert.equal(r.upgradesApplied, 3); assert.ok((await rows(id)).every((x) => x.confirmed));
    });
    await test("P3 an older reading whose cover page prints a currency in its text (an image never gives one): applied", async () => {
      const id = await doc(third, ana, "Ana Lim", [HEAD, SCHED("Ana Lim") + "\nAnnual Premium\tS$2,400.00"], { record: null });
      const r = await recheckStoredCover({ accountId: third, policyId: id }, { apply: true });
      assert.equal(r.upgradesApplied, 3); assert.equal(r.heldImageUnknown, 0);
    });
    await test("P4 an older reading whose figure-free page was never image-checked does not hold it", async () => {
      const id = await doc(third, ana, "Ana Lim", [HEAD, SCHED("Ana Lim"), "Important notes\nPlease keep this schedule."], { record: null, methods: ["native", "ocr", "native"] });
      const r = await recheckStoredCover({ accountId: third, policyId: id }, { apply: true });
      assert.equal(r.upgradesApplied, 3);
    });
    await test("P5 gate repro: a recorded image currency (USD on page 3) blocks the document-level SGD fill", async () => {
      const id = await doc(third, ana, "Ana Lim", [HEAD, SCHED("Ana Lim"), "Rider schedule\nLife Assured\tAna Lim\nRider CI\t300,000.00"], { record: { "3": "USD" } });
      const r = await recheckStoredCover({ accountId: third, policyId: id }, { apply: true });
      assert.equal(r.upgrades, 0); assert.ok((await rows(id)).every((x) => !x.confirmed));
    });
    await test("P6 control: a recorded image check with no currency lets the rule apply", async () => {
      const id = await doc(third, ana, "Ana Lim", [HEAD, SCHED("Ana Lim")], { record: { "2": null } });
      const r = await recheckStoredCover({ accountId: third, policyId: id }, { apply: true });
      assert.equal(r.upgradesApplied, 3);
    });
    // ---- Only the document-currency rule's upgrades (gate fix 6)
    await test("R1 a line the check proves without the new rule is reported and not written", async () => {
      const lines = [["Death", 200000, "Death\tS$200,000.00"]] as const;
      const id = await doc(third, ana, "Ana Lim", [HEAD, "Benefit Schedule\nLife Assured\tAna Lim\nDeath\tS$200,000.00"], { lines });
      const r = await recheckStoredCover({ accountId: third, policyId: id }, { apply: true });
      assert.equal(r.upgrades, 1); assert.equal(r.heldOtherRule, 1); assert.equal(r.upgradesApplied, 0);
      assert.equal((await rows(id))[0].confirmed, false);
    });
    await test("R2 a document being read again (not ready) is left alone", async () => {
      const id = await doc(third, ana, "Ana Lim", [HEAD, SCHED("Ana Lim")], { status: "indexing" });
      const r = await recheckStoredCover({ accountId: third, policyId: id }, { apply: true });
      assert.equal(r.documents, 0); assert.ok((await rows(id)).every((x) => !x.confirmed));
    });
    await test("Z no request left this machine and no model was called", async () => assert.equal(outbound, 0));
  } finally {
    for (const acct of [account, other, third]) {
      for (const t of ["policy_coverages", "policy_pages", "policy_detected_people", "policy_members", "premium_records", "policies", "family_members"]) await query(`DELETE FROM ${t} WHERE account_id=$1`, [acct]).catch(() => {});
      await query("DELETE FROM accounts WHERE id=$1", [acct]).catch(() => {});
    }
  }
  await pool.end().catch(() => {});
  if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`recheck-stored-cover: ${passed} passed, 0 failed`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
