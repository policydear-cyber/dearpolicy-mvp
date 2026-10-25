/**
 * V1 core-loop ingestion regressions: the defects found certifying
 * upload -> read -> extract -> cite -> link on synthetic documents
 * (e2e/support/v1-fixtures.ts).
 *
 *   D1 a document printing "Josephine Tan" never linked to the profile
 *      "Josephine", so chat (lib/rag/retrieve.ts joins policy_members) could
 *      not see it; the uploader's chosen profile was ignored for personal
 *      documents.
 *   D2 benefit rows printed "US$250,000" / "USD 500,000" / "RM 5,000" were
 *      dropped; a bare "$" must still never become SGD.
 *   D3 a .docx table was flattened (no rows parsed) and printed page breaks
 *      were ignored (citations on the wrong page).
 *   D4 ingestion model calls recorded no household/document provenance.
 *   D5 a finished document kept "Reading the document into your coverage
 *      ledger…" at stage 'finalising' for good.
 *   Ledger: superseded documents were still read into the ledger, and a row
 *      with no stated currency was written as SGD.
 *
 * Part A is pure (no database). Part B runs the REAL processPolicy() against
 * the LOCAL database with the deterministic model stand-in, and is skipped
 * (with a notice) when that environment is not configured. Part B creates two
 * households under this run's SYNTHETIC-DPTEST prefix and removes them.
 */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";

process.env.E2E_RUN_ID ||= `v1reg${Date.now().toString(36)}`;

let cases = 0;
async function t(name: string, fn: () => unknown | Promise<unknown>) {
  try { await fn(); cases++; console.log("  ok  " + name); }
  catch (error) { console.error("  FAIL " + name); throw error; }
}

async function partA() {
  const { benefitRowsFromText } = await import("@/lib/documents/layout");
  const { parseBenefitValue } = await import("@/lib/policies/benefit-rows");
  const { findFamilyMatchWithKind, findFamilyMatch, printedCurrencyCode } = await import("@/lib/policies/linking");
  const { docxXmlToPageLines, docxToPages } = await import("@/lib/documents/formats");
  const { ledgerRowCurrency } = await import("@/lib/ledger/extract");
  const { generateV1Fixtures } = await import("../e2e/support/v1-fixtures");

  console.log("A. pure");
  await t("D2: currency-coded value cells are schedule rows, with the printed currency", () => {
    const cases: [string, number, string | null][] = [
      ["US$250,000", 250000, "USD"], ["USD 500,000", 500000, "USD"], ["SGD 1,000", 1000, "SGD"], ["S$1,000", 1000, "SGD"],
      ["RM 5,000", 5000, "MYR"], ["EUR 1,000", 1000, "EUR"], ["€1,000", 1000, "EUR"], ["£750", 750, "GBP"],
      ["HK$8,000", 8000, "HKD"], ["AUD 2,500", 2500, "AUD"], ["$1,000", 1000, null],
    ];
    for (const [cell, value, currency] of cases) {
      const rows = benefitRowsFromText("Overseas medical expenses\t" + cell);
      assert.equal(rows.length, 1, `row with "${cell}" must be read`);
      const parsed = parseBenefitValue(rows[0].value);
      assert.ok(parsed, `"${cell}" must parse`);
      assert.equal(parsed!.value, value, cell);
      assert.equal(parsed!.currency, currency, `"${cell}" keeps its printed currency (bare $ stays null)`);
    }
    const cap = parseBenefitValue("Up to US$2,000 per accident");
    assert.equal(cap?.kind, "expense_cap"); assert.equal(cap?.currency, "USD"); assert.equal(cap?.value, 2000);
    const daily = parseBenefitValue("USD 300 per day");
    assert.equal(daily?.kind, "daily"); assert.equal(daily?.currency, "USD");
  });
  await t("D2: prose and labels are still not value cells", () => {
    assert.equal(benefitRowsFromText("RMS Titanic\tHistory").length, 0);
    assert.equal(benefitRowsFromText("Premium payable\tUSD 55").length, 0, "a premium is not a benefit");
    assert.equal(benefitRowsFromText("Deductible\tS$3,000").length, 0);
  });
  await t("currency: printedCurrencyCode never defaults", () => {
    assert.equal(printedCurrencyCode("US$"), "USD"); assert.equal(printedCurrencyCode("RM"), "MYR"); assert.equal(printedCurrencyCode("S$"), "SGD");
    assert.equal(printedCurrencyCode("$"), null); assert.equal(printedCurrencyCode(""), null); assert.equal(printedCurrencyCode(null), null);
    assert.equal(printedCurrencyCode("dollars"), null);
  });
  await t("D1: findFamilyMatch -- exact, unique partial, preferred name, never guesses", () => {
    const fam = [{ id: "c", display_name: "Josephine" }, { id: "m", display_name: "Marcus", preferred_name: "Marc Lim" }, { id: "b", display_name: "Bob Tan" }];
    assert.deepEqual(findFamilyMatchWithKind("Bob Tan", fam), { member: fam[2], kind: "exact" });
    assert.deepEqual(findFamilyMatchWithKind("TAN BOB", fam), { member: fam[2], kind: "exact" }, "order-insensitive");
    assert.deepEqual(findFamilyMatchWithKind("Josephine Tan", fam), { member: fam[0], kind: "partial" });
    assert.equal(findFamilyMatch("Marc Lim", fam)?.id, "m", "preferred name counts");
    assert.equal(findFamilyMatch("Alice Wong", fam), null);
    assert.equal(findFamilyMatch("Tan", fam), null, "a profile needs ALL its words printed");
    const twins = [{ id: "1", display_name: "Josephine" }, { id: "2", display_name: "Josephine Lee" }];
    assert.equal(findFamilyMatch("Josephine Lee", twins)?.id, "2", "an exact match beats a partial one");
    assert.equal(findFamilyMatch("Josephine Tan", [{ id: "1", display_name: "Josephine" }, { id: "2", display_name: "Tan" }]), null, "two profiles fit: no guess");
    assert.equal(findFamilyMatch("Josephine Tan", [{ id: "1", display_name: "Josephine" }, { id: "2", display_name: "Josephine" }]), null, "duplicate names: no guess");
  });
  await t("D3: docx XML -> table rows as tab cells, page breaks as pages, tab stops ignored", () => {
    const p = (x: string) => `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t xml:space="preserve">${x}</w:t></w:r></w:p>`;
    const row = (a: string, b: string) => `<w:tr><w:trPr/><w:tc><w:tcPr/>${p(a)}</w:tc><w:tc>${p(b)}</w:tc></w:tr>`;
    const xml = `<w:document><w:body>${p("Particulars &amp; cover")}<w:p><w:r><w:br w:type="page"/></w:r></w:p>${p("Schedule")}<w:tbl><w:tblPr/>${row("Fracture of arm", "S$1,000")}${row("Overseas medical", "US$250,000")}</w:tbl>`
      + `<w:p><w:r><w:lastRenderedPageBreak/><w:t>Third</w:t><w:tab/><w:t>page</w:t></w:r></w:p></w:body></w:document>`;
    const pages = docxXmlToPageLines(xml);
    assert.deepEqual(pages, [["Particulars & cover"], ["Schedule", "Fracture of arm\tS$1,000", "Overseas medical\tUS$250,000"], ["Third\tpage"]]);
  });
  await t("D3: the v1 .docx fixture reads as its printed pages with parseable schedule rows", async () => {
    const [docx] = await generateV1Fixtures({ include: "all", only: ["accident-docx"] });
    const pages = await docxToPages(new Uint8Array(docx.buffer));
    assert.equal(pages.length, 3, "particulars, schedule, control block");
    const rows = benefitRowsFromText(pages[1].text);
    assert.deepEqual(rows.map((r) => [r.label, r.value]), [["Fracture of arm", "S$1,000"], ["Fracture of leg", "S$1,500"], ["Accident medical reimbursement", "Up to S$2,000 per accident"], ["Accidental death", "100% of Sum Insured"]]);
  });
  await t("D3: a .docx without page breaks still splits on size (fallback)", () => {
    const long = Array.from({ length: 40 }, (_, i) => `<w:p><w:r><w:t>${"Paragraph " + i + " " + "x".repeat(150)}</w:t></w:r></w:p>`).join("");
    const pages = docxXmlToPageLines(`<w:body>${long}</w:body>`);
    assert.equal(pages.length, 1, "no breaks recorded -> one block for the size-based split");
  });
  await t("ledger: row currency is printed or the document's single currency, never a default", () => {
    assert.equal(ledgerRowCurrency({ currency: "US$", quote: "Overseas medical US$250,000", paysKind: "lump_sum", amount: 250000 }), "USD");
    assert.equal(ledgerRowCurrency({ currency: null, quote: "Fracture of arm S$1,000", paysKind: "lump_sum", amount: 1000 }), "SGD");
    assert.equal(ledgerRowCurrency({ currency: "$", quote: "Fracture of arm $1,000", paysKind: "lump_sum", amount: 1000 }, "SGD"), null, "a money row never borrows a currency");
    assert.equal(ledgerRowCurrency({ currency: null, quote: "Loss of arm 100% of Sum Insured", paysKind: "percent_of_sum", amount: 1 }, "SGD"), "SGD");
    assert.equal(ledgerRowCurrency({ currency: null, quote: "Loss of arm 100% of Sum Insured", paysKind: "percent_of_sum", amount: 1 }, null), null);
  });
}

async function partB() {
  const url = process.env.DATABASE_URL ?? "";
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  const { deterministicModelEnabled } = await import("@/lib/ai/deterministic-model");
  if (!["localhost", "127.0.0.1"].includes(host) || !deterministicModelEnabled() || (process.env.STORAGE_DRIVER ?? "") !== "local") {
    console.log("B. SKIPPED: needs a local DATABASE_URL, STORAGE_DRIVER=local and DEARPOLICY_DETERMINISTIC_MODEL=synthetic-e2e (see e2e/README.md)");
    return;
  }
  const { pool } = await import("@/lib/db/client");
  const { ensureDefaultHousehold } = await import("@/lib/household/repo");
  const { savePolicyFile } = await import("@/lib/storage");
  const { processPolicy } = await import("@/lib/rag/ingest");
  const { pendingDocumentCount } = await import("@/lib/ledger/extract");
  const { pseudonymizeId } = await import("@/lib/telemetry/pseudonymize");
  const { generateV1Fixtures } = await import("../e2e/support/v1-fixtures");
  const { PREFIX } = await import("../e2e/support/synthetic");
  const cleanup = (await import("../e2e/support/cleanup")).default;
  const userA = randomUUID(), userB = randomUUID();
  process.env.E2E_USER_A = userA; process.env.E2E_USER_B = userB;
  console.log("B. real processPolicy() on the local database, run " + PREFIX);
  const a = await ensureDefaultHousehold(userA, `${PREFIX}-Household-A`);
  const b = await ensureDefaultHousehold(userB, `${PREFIX}-Household-B`);
  const member = async (account: string, name: string) => {
    const id = randomUUID();
    await pool.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,$3,'other')`, [id, account, name]);
    return id;
  };
  const josephine = await member(a, "Josephine"), marcus = await member(a, "Marcus"), bob = await member(a, "Bob");
  const josephineB = await member(b, "Josephine");
  // Ledger rows are read with a model the stand-in does not implement; that
  // step fails softly and is not what these cases prove.
  const fixtures = await generateV1Fixtures({ include: "all" });
  const ingest = async (key: string, account: string, memberId: string, linkUploadMember: boolean, override?: { name: string; buffer: Buffer }) => {
    const f = override ?? fixtures.find((x) => x.key === key)!;
    const policyId = randomUUID();
    const bytes = new Uint8Array(f.buffer);
    const storageKey = await savePolicyFile({ accountId: account, familyMemberId: memberId, policyId, filename: f.name, bytes });
    // The malware-scan gate is covered by its own suites; these documents
    // start already cleared so this suite needs no scanner service.
    await pool.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,processing_stage,processing_progress,processing_message,quarantine_status,scan_provider,scanned_at)
      VALUES($1,$2,$3,$4,$5,$6,'queued','queued',1,'Waiting','scan_clean','v1-regression',now())`, [policyId, account, memberId, f.name, storageKey, createHash("sha256").update(bytes).update(policyId).digest("hex")]);
    await processPolicy({ accountId: account, familyMemberId: memberId, policyId, storageKey, linkUploadMember });
    return policyId;
  };
  const rows = async (sql: string, params: unknown[]) => (await pool.query(sql, params)).rows;
  try {
    const accident = await ingest("accident-pdf", a, josephine, true);
    await t("D1: 'Josephine Dptest…' links to profile 'Josephine' (unique partial match), coverage stored", async () => {
      const links = await rows(`SELECT family_member_id,source,confidence::float c FROM policy_members WHERE policy_id=$1`, [accident]);
      assert.deepEqual(links, [{ family_member_id: josephine, source: "ai_name_match", c: 0.85 }]);
      const cov = await rows(`SELECT family_member_id,amount::float amount,currency,source_page FROM policy_coverages WHERE policy_id=$1`, [accident]);
      assert.deepEqual(cov, [{ family_member_id: josephine, amount: 100000, currency: "SGD", source_page: 1 }]);
    });
    await t("fracture benefit stored with printed currency and page citation", async () => {
      const r = await rows(`SELECT formula_kind,formula_value::float v,currency,source_page FROM policy_benefits WHERE policy_id=$1 AND benefit_name='Fracture of arm'`, [accident]);
      assert.deepEqual(r, [{ formula_kind: "fixed", v: 1000, currency: "SGD", source_page: 2 }]);
    });
    await t("D5: a finished document ends at stage 'complete', 100%, with its benefit summary", async () => {
      const [p] = await rows(`SELECT processing_status,processing_stage,processing_progress,processing_message FROM policies WHERE id=$1`, [accident]);
      assert.equal(p.processing_status, "ready"); assert.equal(p.processing_stage, "complete"); assert.equal(p.processing_progress, 100);
      // V1.1 Task 4: the household no longer sees internal rule counts or
      // "to confirm" tasks; a fully readable document just says it is ready.
      assert.equal(p.processing_message, "Ready.");
    });
    await t("D4: ingestion model calls carry household and document provenance", async () => {
      const r = await rows(`SELECT operation,household_ref,resource_ref FROM model_executions WHERE resource_ref=$1`, [pseudonymizeId(accident)]);
      const ops = new Set(r.map((x) => x.operation));
      assert.ok(ops.has("policy_extraction"), "policy_extraction recorded against the document");
      // V1.1 Task 5: a fully tabular document makes no catalogue or condition calls at all; every call it does make is recorded against it.
      assert.ok(r.every((x) => x.household_ref === pseudonymizeId(a)));
    });
    const travel = await ingest("travel-pdf", a, marcus, true);
    await t("D2 end to end: US$ / USD rows are stored as USD, S$ as SGD, nothing added across currencies", async () => {
      const r = await rows(`SELECT benefit_name,formula_value::float v,currency FROM policy_benefits WHERE policy_id=$1 ORDER BY benefit_name`, [travel]);
      assert.deepEqual(r.filter((x) => x.benefit_name !== "Baggage delay"), [
        { benefit_name: "Emergency medical evacuation", v: 500000, currency: "USD" },
        { benefit_name: "Overseas medical expenses", v: 250000, currency: "USD" },
        { benefit_name: "Trip cancellation", v: 5000, currency: "SGD" },
      ]);
    });
    const docx = await ingest("travel-docx", a, marcus, true);
    await t("D3 end to end: .docx schedule rows stored and cited on printed page 2", async () => {
      const r = await rows(`SELECT benefit_name,currency,source_page FROM policy_benefits WHERE policy_id=$1 ORDER BY benefit_name`, [docx]);
      assert.ok(r.length >= 3, "docx table rows parsed without a model");
      assert.ok(r.every((x) => x.source_page === 2));
      assert.equal(r.find((x) => x.benefit_name === "Overseas medical expenses")?.currency, "USD");
      const [p] = await rows(`SELECT page_count FROM policies WHERE id=$1`, [docx]);
      assert.equal(p.page_count, 3);
    });
    await t("unsupported unit: 'Baggage delay S$200 for every 6 hours' is stored as printed, never calculated (PDF and DOCX)", async () => {
      const { loadBenefitCatalog } = await import("@/lib/policies/benefit-catalog");
      for (const policyId of [travel, docx]) {
        const r = await rows(`SELECT formula_kind,formula_value,currency,source_page,quote,needs_review,conditions FROM policy_benefits WHERE policy_id=$1 AND benefit_name='Baggage delay'`, [policyId]);
        assert.equal(r.length, 1, "the benefit is stored, so chat can see it");
        assert.equal(r[0].formula_kind, "none", "no formula: nothing is ever calculated from it");
        assert.equal(r[0].formula_value, null);
        assert.equal(r[0].currency, "SGD", "printed currency kept");
        assert.equal(r[0].source_page, 2, "cited on the printed page");
        assert.equal(r[0].quote, "Baggage delay S$200 for every 6 hours", "the exact printed row");
        assert.equal(r[0].needs_review, true);
        assert.match(JSON.stringify(r[0].conditions), /S\$200 for every 6 hours/);
        // The read path (repairStoredRules/ruleFromQuote) must not turn it into a rule either.
        const [loaded] = (await loadBenefitCatalog(a, [policyId])).filter((b) => b.benefitName === "Baggage delay");
        assert.equal(loaded.formulaKind, "none"); assert.equal(loaded.formulaValue, null);
      }
      const counts = await rows(`SELECT count(*)::int n FROM policy_benefits WHERE policy_id=$1`, [travel]);
      assert.equal(counts[0].n, 4, "all four printed travel benefits stored");
    });
    // Uploaded to "Bob", but the document names Josephine: the printed name
    // wins over the upload profile.
    const hinted = await ingest("hospital-pdf", a, bob, true);
    await t("D1: a name match wins over the upload profile", async () => {
      const links = await rows(`SELECT family_member_id,source,confidence::float c FROM policy_members WHERE policy_id=$1`, [hinted]);
      assert.deepEqual(links, [{ family_member_id: josephine, source: "ai_name_match", c: 0.85 }]);
    });
    const rename = (id: string, name: string) => pool.query(`UPDATE family_members SET display_name=$1 WHERE id=$2`, [name, id]);
    // From here "Josephine Dptest…" fits no profile.
    await rename(josephine, "Someone Else");
    const fallback = await ingest("accident-pdf", a, bob, true);
    await t("D1 fallback: unmatched single insured on a personal document + explicit upload profile -> upload_hint 0.70, flagged", async () => {
      const links = await rows(`SELECT family_member_id,source,confidence::float c FROM policy_members WHERE policy_id=$1`, [fallback]);
      assert.deepEqual(links, [{ family_member_id: bob, source: "upload_hint", c: 0.7 }]);
      const [p] = await rows(`SELECT needs_review,review_reason FROM policies WHERE id=$1`, [fallback]);
      assert.equal(p.needs_review, true);
      assert.match(p.review_reason, /linked to the profile it was uploaded to/);
      const cov = await rows(`SELECT family_member_id,currency FROM policy_coverages WHERE policy_id=$1`, [fallback]);
      assert.deepEqual(cov, [{ family_member_id: bob, currency: "SGD" }]);
    });
    const noHint = await ingest("accident-pdf", a, bob, false);
    await t("D1: no explicit upload profile and no name match -> not linked, flagged", async () => {
      assert.deepEqual(await rows(`SELECT source FROM policy_members WHERE policy_id=$1`, [noHint]), []);
      const [p] = await rows(`SELECT needs_review,review_reason FROM policies WHERE id=$1`, [noHint]);
      assert.equal(p.needs_review, true); assert.match(p.review_reason, /not linked to a family profile/);
    });
    const image = await ingest("accident-jpeg", a, bob, true);
    await t("D1: a non-personal (reference) document is never linked by upload profile", async () => {
      assert.deepEqual(await rows(`SELECT source FROM policy_members WHERE policy_id=$1`, [image]), []);
    });
    await t("D1: re-reading once the name matches replaces the upload_hint (no stale link)", async () => {
      await rename(josephine, "Josephine");
      const [p] = await rows(`SELECT storage_key FROM policies WHERE id=$1`, [fallback]);
      await processPolicy({ accountId: a, familyMemberId: bob, policyId: fallback, storageKey: p.storage_key, linkUploadMember: true });
      assert.deepEqual(await rows(`SELECT family_member_id,source FROM policy_members WHERE policy_id=$1`, [fallback]), [{ family_member_id: josephine, source: "ai_name_match" }]);
    });
    const twin = await member(a, "Josephine");
    const ambiguous = await ingest("disability-pdf", a, josephine, false);
    await t("D1: two profiles fit the printed name -> never guessed", async () => {
      assert.deepEqual(await rows(`SELECT family_member_id FROM policy_members WHERE policy_id=$1`, [ambiguous]), []);
    });
    await pool.query(`DELETE FROM family_members WHERE id=$1`, [twin]);
    const { certificatePdf } = await import("../e2e/support/ingestion-fixtures");
    const pair = await certificatePdf({ label: "TwoJosephines", policyNumber: `${PREFIX}-PAIR-1`, insuredNames: ["Josephine Alpha", "Josephine Beta"], amounts: [1000, 2000] });
    const twoOnOne = await ingest("pair", a, josephine, true, { name: `${PREFIX}-pair.pdf`, buffer: pair });
    await t("D1: two printed people partially matching the same profile -> neither is folded into it", async () => {
      assert.deepEqual(await rows(`SELECT family_member_id FROM policy_members WHERE policy_id=$1`, [twoOnOne]), []);
      assert.deepEqual(await rows(`SELECT family_member_id FROM policy_coverages WHERE policy_id=$1`, [twoOnOne]), []);
      const [p] = await rows(`SELECT needs_review,review_reason FROM policies WHERE id=$1`, [twoOnOne]);
      assert.equal(p.needs_review, true); assert.match(p.review_reason, /2 named insured people are not linked/);
    });
    const isolated = await ingest("isolation-b-pdf", b, josephineB, true);
    await t("isolation: household B's Josephine policy links only inside household B", async () => {
      const links = await rows(`SELECT family_member_id,account_id FROM policy_members WHERE policy_id=$1`, [isolated]);
      assert.deepEqual(links, [{ family_member_id: josephineB, account_id: b }]);
      const leaked = await rows(`SELECT count(*)::int n FROM policy_members WHERE account_id=$1 AND family_member_id=$2`, [a, josephineB]);
      assert.equal(leaked[0].n, 0);
    });
    await t("ledger: a superseded document is no longer pending for the ledger", async () => {
      await pool.query(`UPDATE policies SET ledger_read_at=NULL WHERE account_id=$1`, [a]);
      const before = await pendingDocumentCount(a);
      assert.ok(before >= 1);
      await pool.query(`UPDATE policies SET superseded_at=now() WHERE id=$1`, [accident]);
      assert.equal(await pendingDocumentCount(a), before - 1);
    });
  } finally {
    await cleanup();
    await pool.end();
  }
}

(async () => {
  await partA();
  await partB();
  console.log(`v1 ingestion regressions passed: ${cases} cases`);
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
