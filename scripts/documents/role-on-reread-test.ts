/** A document read again keeps the type its earlier reading gave it, unless the new reading is personal proof of cover
 * (DC 5 Nov; FWD re-read: an endorsement re-typed as policy wording, so Home listed two policy wordings). Made-up
 * documents on a disposable PostgreSQL; no model, no network.
 *   npm run -s documents:role-on-reread-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC|OPENAI_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

async function main() {
  let passed = 0; const failures: string[] = [];
  const test = async (name: string, fn: () => Promise<void> | void) => { try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } };
  const { roleOnReread } = await import("@/lib/documents/intelligence");

  await test("R1 a first read takes the reader's type", () => {
    assert.equal(roleOnReread(null, "policy_wording", false), "policy_wording");
    assert.equal(roleOnReread(undefined, "endorsement", true), "endorsement");
  });
  await test("R2 a re-read that names another type keeps the earlier one", () => {
    assert.equal(roleOnReread("endorsement", "policy_wording", false), "endorsement");
    assert.equal(roleOnReread("policy_wording", "product_summary", false), "policy_wording");
    assert.equal(roleOnReread("personal_schedule", "benefit_guide", false), "personal_schedule");
    assert.equal(roleOnReread("premium_receipt", "renewal_statement", false), "premium_receipt");
    assert.equal(roleOnReread("personal_notes", "policy_wording", false), "personal_notes");
    // Confirmed cover with a type that is not proof of it (a wording, a receipt) does not change the type either.
    assert.equal(roleOnReread("endorsement", "policy_wording", true), "endorsement");
    assert.equal(roleOnReread("certificate", "renewal_statement", true), "certificate");
  });
  await test("R3 a re-read that is personal proof of cover takes its own type", () => {
    assert.equal(roleOnReread("policy_wording", "personal_schedule", true), "personal_schedule");
    assert.equal(roleOnReread("product_summary", "certificate", true), "certificate");
    assert.equal(roleOnReread("policy_wording", "endorsement", true), "endorsement");
  });
  await test("R4 the same type stays; a re-read that names no type keeps the earlier one", () => {
    assert.equal(roleOnReread("endorsement", "endorsement", false), "endorsement");
    assert.equal(roleOnReread("endorsement", null as never, false), "endorsement");
    assert.equal(roleOnReread(null, null as never, false), null);
  });
  await test("R5 a schedule, certificate or endorsement read without confirmed cover is not proof", () => {
    assert.equal(roleOnReread("policy_wording", "personal_schedule", false), "policy_wording");
    assert.equal(roleOnReread("product_summary", "endorsement", false), "product_summary");
  });
  await test("R7 a type the pages' own wording decides wins over the earlier one; the same one keeps it (Critic R362 M1)", () => {
    assert.equal(roleOnReread("certificate", "benefit_guide", false, { codeRole: "benefit_guide" }), "benefit_guide");
    assert.equal(roleOnReread("endorsement", "policy_wording", false, { codeRole: "policy_wording", printsAmendment: true }), "policy_wording");
    // The FWD case: the reader said wording, the pages' title says endorsement, as the earlier reading did.
    assert.equal(roleOnReread("endorsement", "policy_wording", false, { codeRole: "endorsement", printsAmendment: true }), "endorsement");
    assert.equal(roleOnReread("endorsement", "policy_wording", false, { codeRole: null, printsAmendment: true }), "endorsement");
  });
  await test("R8 a type that holds no cover always wins: a letter, notes, a claim decision or a bill read before as a certificate (Critic R362 M1)", () => {
    for (const next of ["insurer_letter", "personal_notes", "claim_decision", "medical_bill"]) {
      assert.equal(roleOnReread("certificate", next as never, false, { codeRole: null }), next);
      assert.equal(roleOnReread("personal_schedule", next as never, true, { codeRole: next }), next);
    }
  });
  await test("R9 an earlier endorsement is kept only while the pages print an amendment (Critic R362 M1)", () => {
    assert.equal(roleOnReread("endorsement", "policy_wording", false, { codeRole: null, printsAmendment: false }), "policy_wording");
    assert.equal(roleOnReread("endorsement", "product_summary", false, { printsAmendment: false }), "product_summary");
  });
  await test("R10 what an amendment prints", async () => {
    const { printsAmendment } = await import("@/lib/documents/intelligence");
    const page = (text: string) => [{ pageNumber: 1, text }] as never;
    assert.equal(printsAmendment(page("ENDORSEMENT\nPolicy number: HT-100245")), true);
    assert.equal(printsAmendment(page("Harbour Life\nEndorsement No. 2\nPolicy number: HL-1")), true);
    assert.equal(printsAmendment(page("Policy alteration\nThe sum assured is amended to S$200,000.")), true);
    assert.equal(printsAmendment(page("Policy wording\nGeneral exclusions\nWe will not pay for claims arising from war.")), false);
    assert.equal(printsAmendment(page("Harbour Travel Shield\nBenefits at a glance\nKeep this with your policy schedule.")), false);
  });
  await test("R6 the reading pipeline decides the stored type with this rule, before anything reads the type", async () => {
    const src = await readFile("lib/rag/ingest.ts", "utf8");
    const at = src.indexOf("extraction.documentRole = await documentRoleOnReread(args, extraction, pages);");
    assert.ok(at > 0, "processPolicy sets the type from documentRoleOnReread");
    assert.ok(at < src.indexOf("const noCover = NON_COVER_ROLES.has(extraction.documentRole"), "before the cover decision");
    assert.ok(at < src.indexOf("UPDATE policies SET insurer=$1,product_name=$2"), "before the type is stored");
  });

  const url = process.env.DATABASE_URL ?? "";
  if (process.env.DEARPOLICY_DISPOSABLE_DB === "1" && /@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
    const { query } = await import("@/lib/db/client");
    const { documentRoleOnReread } = await import("@/lib/rag/ingest");
    const ACCOUNT = randomUUID(), OTHER = randomUUID();
    const ids = { fresh: randomUUID(), endorsement: randomUUID(), wording: randomUUID(), other: randomUUID() };
    try {
      const people = new Map<string, string>();
      for (const a of [ACCOUNT, OTHER]) {
        await query("INSERT INTO accounts(id,name) VALUES($1,'Role on re-read test household')", [a]);
        people.set(a, (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,'Priya Raman','self') RETURNING id", [a])).rows[0].id);
      }
      const add = (id: string, account: string, role: string | null) => query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,processing_stage,quarantine_status,document_role)
        VALUES($1,$2,$3,'harbour-travel.pdf',$4,'ready','ready','scan_clean',$5)`, [id, account, people.get(account), `test/${id}`, role]);
      await add(ids.fresh, ACCOUNT, null);
      await add(ids.endorsement, ACCOUNT, "endorsement");
      await add(ids.wording, ACCOUNT, "policy_wording");
      await add(ids.other, OTHER, "endorsement");
      // A made-up endorsement that says it is one in its title, and a made-up schedule-free travel booklet.
      const endorsementPages = [{ pageNumber: 1, text: "ENDORSEMENT\nHarbour Travel Shield\nPolicy number: HT-100245\nEffective date: 1 March 2026\nThis endorsement forms part of your policy. The benefits below replace those in the policy wording." }];
      const bookletPages = [{ pageNumber: 1, text: "Harbour Travel Shield\nBenefits at a glance\nOverall limit per trip S$5,000\nBaggage delay S$100 for every six hours" }];
      const decide = (policyId: string, documentRole: string, personalCoverageConfirmed: boolean, accountId = ACCOUNT, pages: { pageNumber: number; text: string }[] = endorsementPages) =>
        documentRoleOnReread({ accountId, policyId }, { documentRole: documentRole as never, personalCoverageConfirmed }, pages as never);
      await test("D1 a stored endorsement read again as policy wording stays an endorsement", async () => {
        assert.equal(await decide(ids.endorsement, "policy_wording", false), "endorsement");
      });
      await test("D2 a document never read before takes the reader's type", async () => {
        assert.equal(await decide(ids.fresh, "policy_wording", false), "policy_wording");
      });
      await test("D3 a stored wording read again as a personal schedule with confirmed cover becomes the schedule", async () => {
        assert.equal(await decide(ids.wording, "personal_schedule", true, ACCOUNT, bookletPages), "personal_schedule");
        assert.equal(await decide(ids.wording, "product_summary", false, ACCOUNT, bookletPages), "policy_wording");
      });
      await test("D5 a stored endorsement whose pages print no amendment takes the new type (Critic R362 M1)", async () => {
        assert.equal(await decide(ids.endorsement, "policy_wording", false, ACCOUNT, bookletPages), "policy_wording");
      });
      await test("D4 another household's document never lends its type", async () => {
        assert.equal(await decide(ids.other, "policy_wording", false), "policy_wording");
      });
    } finally {
      for (const a of [ACCOUNT, OTHER]) {
        await query("DELETE FROM policies WHERE account_id=$1", [a]).catch(() => undefined);
        await query("DELETE FROM family_members WHERE account_id=$1", [a]).catch(() => undefined);
        await query("DELETE FROM accounts WHERE id=$1", [a]).catch(() => undefined);
      }
    }
  } else console.log("role on re-read: database part skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run it)");

  console.log(`role on re-read: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("FAIL " + f);
  process.exit(failures.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
