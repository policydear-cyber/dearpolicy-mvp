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
  // Made-up English documents, as their pages print them.
  const P = (...t: string[]) => t.map((text, i) => ({ pageNumber: i + 1, text })) as never;
  const LAYOUTS = {
    // A wording whose glossary and conditions mention endorsements and the policy schedule (the real FWD layout).
    wording: P("Harbourline Travel insurance\nPolicy wording\nThis is your contract with us. Please read it with your policy schedule.",
      "Definitions\nEndorsement means a change to this policy that we have agreed in writing.\nInsured person means the person named in the policy schedule.\nPolicy number means the number shown on your policy schedule.",
      "General conditions\nAny endorsement we issue forms part of this policy."),
    endorsement: P("Harbourline Assurance\nPolicy Endorsement\nPolicy number: HL-200311\nEffective date: 1 March 2026\nYour plan is changed from Classic to Elite with effect from the date above."),
    changeNotice: P("Harbourline Assurance\nChange to your policy\nPolicy number: HL-200311\nEffective date: 1 March 2026\nFrom the date above your sum assured is reduced."),
    beforeAfter: P("Harbourline Assurance\nPolicy number: HL-200311\nEffective date: 1 March 2026\nBenefit\tBefore\tAfter\nDeath benefit\tS$300,000\tS$250,000\nThe policy is otherwise unchanged."),
    claimLetter: P("Harbourline Assurance\nDear Ms Okafor,\nClaim reference CL-88812\nWe have reviewed your claim and regret that we are unable to pay it under your policy number HL-200311.\nYours sincerely,\nClaims Department"),
    summary: P("Your travel insurance summary\nHarbourline Travel insurance\nThis summary is not your policy wording; please read the policy wording for the full terms.\nMedical expenses overseas up to S$150,000\nTrip cancellation up to S$10,000"),
  };
  await test("R7 what the pages print about themselves: titles and layouts only, never a glossary's keywords", async () => {
    const { printedDocumentRole } = await import("@/lib/documents/intelligence");
    assert.equal(printedDocumentRole(LAYOUTS.wording), "policy_wording");
    assert.equal(printedDocumentRole(LAYOUTS.endorsement), "endorsement");
    assert.equal(printedDocumentRole(LAYOUTS.claimLetter), "claim_decision");
    assert.equal(printedDocumentRole(LAYOUTS.summary), "product_summary");
    assert.equal(printedDocumentRole(LAYOUTS.changeNotice), null);
    assert.equal(printedDocumentRole(LAYOUTS.beforeAfter), null);
  });
  await test("R8 one order: the printed type, then a no-cover type, then personal proof, then the earlier type, then the reader's (TE pr362)", async () => {
    const { printedDocumentRole } = await import("@/lib/documents/intelligence");
    const reread = (earlier: string | null, next: string, confirmed: boolean, pages: never) => roleOnReread(earlier, next as never, confirmed, { codeRole: printedDocumentRole(pages) });
    // The real FWD case: a wording once stored as an endorsement is the wording again, whatever its glossary says.
    assert.equal(reread("endorsement", "policy_wording", false, LAYOUTS.wording), "policy_wording");
    assert.equal(reread("endorsement", "endorsement", false, LAYOUTS.wording), "policy_wording");
    // An endorsement that says so in its title stays one, whatever the reader says.
    assert.equal(reread("endorsement", "policy_wording", false, LAYOUTS.endorsement), "endorsement");
    // Pages that print no type of their own keep the earlier type over the reader's guess.
    assert.equal(reread("endorsement", "policy_wording", false, LAYOUTS.changeNotice), "endorsement");
    assert.equal(reread("endorsement", "policy_wording", false, LAYOUTS.beforeAfter), "endorsement");
    // A letter stays a letter; a stored letter re-read as an unconfirmed schedule stays a letter.
    assert.equal(reread("certificate", "certificate", true, LAYOUTS.claimLetter), "claim_decision");
    assert.equal(reread("claim_decision", "personal_schedule", false, LAYOUTS.beforeAfter), "claim_decision");
    // A summary is a summary, never the wording it cites (the one-page FWD travel summary on Home).
    assert.equal(reread(null, "policy_wording", false, LAYOUTS.summary), "product_summary");
    assert.equal(reread("policy_wording", "policy_wording", false, LAYOUTS.summary), "product_summary");
  });
  await test("R9 without a printed type: no-cover wins, proof wins, else the earlier type (Critic R362 M1)", () => {
    for (const next of ["insurer_letter", "personal_notes", "claim_decision", "medical_bill"])
      assert.equal(roleOnReread("certificate", next as never, false, { codeRole: null }), next);
    assert.equal(roleOnReread("policy_wording", "certificate", true, { codeRole: null }), "certificate");
    assert.equal(roleOnReread("certificate", "benefit_guide", false, { codeRole: null }), "certificate");
  });
  await test("R10 a first reading also takes the summary title over the keyword it cites", async () => {
    const { deterministicDocumentRole } = await import("@/lib/documents/intelligence");
    assert.equal(deterministicDocumentRole(LAYOUTS.summary, "policy_wording"), "product_summary");
    // A personal summary with the policy's own number and the person's name stays the person's schedule.
    assert.equal(deterministicDocumentRole(P("Your travel insurance summary\nPolicy number: HT-100245\nInsured person: Nadia Okafor\nTrip cancellation up to S$10,000"), null), "personal_schedule");
    // A schedule whose opening also says "summary of cover" is still a schedule.
    assert.notEqual(deterministicDocumentRole(P("Policy Schedule\nSummary of cover\nPolicy number: HL-200311\nInsured person: Nadia Okafor\nSum insured S$100,000"), null), "product_summary");
  });
  await test("R11 a summary that prints the policy's own number and a labelled person is that person's schedule (Critic R362 B2)", async () => {
    const { printedDocumentRole, deterministicDocumentRole } = await import("@/lib/documents/intelligence");
    const S1 = P("Summary of cover\nPolicy number: TJ-55120\nInsured person: Ana Rivera\nMedical expenses overseas up to S$150,000");
    const S2 = P("Your travel summary\nPolicy No. TJ-55120\nYour name: Ana Rivera\nTrip cancellation up to S$10,000");
    const S4 = P("Benefits at a glance\nPolicy number: TJ-55120\nInsured person: Ana Rivera\nBaggage delay S$100 for every six hours");
    for (const [name, pages] of [["S1", S1], ["S2", S2], ["S4", S4]] as const) {
      assert.notEqual(printedDocumentRole(pages), "product_summary", `${name} printed`);
      assert.notEqual(deterministicDocumentRole(pages, "product_summary"), "product_summary", `${name} first read`);
      assert.equal(roleOnReread("personal_schedule", "personal_schedule", true, { codeRole: printedDocumentRole(pages) }), "personal_schedule", `${name} re-read`);
    }
    // A group scheme's number with a definition of the insured person is not personal: a summary stays a summary.
    assert.equal(printedDocumentRole(P("Policy summary\nGroup policy number: GP-778812\nInsured person: any eligible employee")), "product_summary");
  });
  await test("R12 a printed type decides over the reader's confirmed flag; a personal summary is recognised on its page (R11)", () => {
    assert.equal(roleOnReread("endorsement", "policy_wording", true, { codeRole: "policy_wording" }), "policy_wording");
    assert.equal(roleOnReread("personal_schedule", "personal_schedule", true, { codeRole: "product_summary" }), "product_summary");
    assert.equal(roleOnReread("certificate", "certificate", true, { codeRole: "claim_decision" }), "claim_decision");
  });
  await test("R13 a glossary entry for a certificate is not a certificate title (Critic R362 M1)", async () => {
    const { printedDocumentRole } = await import("@/lib/documents/intelligence");
    const G1 = P("Harbourline Travel insurance\nPolicy wording\nDefinitions\n\"Certificate of insurance\" means the document we send you that names the insured person and the effective date.",
      "Certificate of insurance: the document that shows your sum assured.\nEffective date means the date cover starts.");
    assert.equal(printedDocumentRole(G1), "policy_wording");
    const G2 = P("Harbourline Travel insurance\nCertificate of insurance means the document that names the insured person and the effective date.");
    assert.notEqual(printedDocumentRole(G2), "certificate");
    // A wording that opens on its definitions prints no type of its own: no glossary line is a title (Critic R362 G1).
    const G3 = P("Kestrel Journey Terms\nSection 1 Definitions\nCertificate of insurance means the document that names the insured person.\nPolicy schedule means the schedule.\nEndorsement means a change to this policy.\nPolicy summary: the leaflet we give you before you buy.\nEffective date means the date cover starts.");
    assert.equal(printedDocumentRole(G3), null);
    assert.equal(roleOnReread("policy_wording", "endorsement", false, { codeRole: printedDocumentRole(G3) }), "policy_wording");
    assert.equal(roleOnReread("policy_wording", "certificate", false, { codeRole: printedDocumentRole(G3) }), "policy_wording");
    // A long sentence that only mentions an endorsement is not its title; a numbered endorsement title may run on.
    assert.equal(printedDocumentRole(P("Kestrel Journey Terms\nEndorsement of any change we agree will be sent to you in writing within 14 days.\nPolicy number: KJ-44120")), null);
    assert.equal(printedDocumentRole(P("Kestrel Assurance\nEndorsement No. 3 to policy KJ-44120 issued to the policyholder named below\nEffective date: 1 March 2026")), "endorsement");
    // A real certificate titles itself on page 1.
    assert.equal(printedDocumentRole(P("Harbourline Assurance\nCertificate of Insurance\nInsured person: Ana Rivera\nEffective date: 1 March 2026\nSum assured S$200,000")), "certificate");
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
      const bookletPages = [{ pageNumber: 1, text: "Harbour Travel Shield\nOverall limit per trip S$5,000\nBaggage delay S$100 for every six hours" }];
      const decide = (policyId: string, documentRole: string, personalCoverageConfirmed: boolean, accountId = ACCOUNT, pages: { pageNumber: number; text: string }[] = bookletPages) =>
        documentRoleOnReread({ accountId, policyId }, { documentRole: documentRole as never, personalCoverageConfirmed }, pages as never);
      await test("D1 a stored endorsement read again as policy wording stays an endorsement", async () => {
        assert.equal(await decide(ids.endorsement, "policy_wording", false), "endorsement");
        assert.equal(await decide(ids.endorsement, "policy_wording", false, ACCOUNT, endorsementPages), "endorsement");
      });
      await test("D2 a document never read before takes the reader's type", async () => {
        assert.equal(await decide(ids.fresh, "policy_wording", false), "policy_wording");
      });
      await test("D3 a stored wording read again as a personal schedule with confirmed cover becomes the schedule", async () => {
        assert.equal(await decide(ids.wording, "personal_schedule", true, ACCOUNT, bookletPages), "personal_schedule");
        assert.equal(await decide(ids.wording, "product_summary", false, ACCOUNT, bookletPages), "policy_wording");
      });
      await test("D5 a stored endorsement whose pages are titled \"Policy wording\" is the wording again (the real FWD layout)", async () => {
        assert.equal(await decide(ids.endorsement, "policy_wording", false, ACCOUNT, [{ pageNumber: 1, text: "Harbour Travel insurance\nPolicy wording\nThis is your contract with us.\nEndorsement means a change to this policy." }]), "policy_wording");
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
