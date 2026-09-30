/**
 * Round 5 ingestion regressions, built on the documents of the post-launch
 * exploratory test (realistic Singapore documents; fixtures in
 * scripts/fixtures/r5/*.pdf.b64, generators make.py / make3.py beside them;
 * the `_x` variants carry a DPTEST-EXTRACTION control page FIRST, so their
 * document pages are shifted by one).
 *
 *   R1 Integrated Shield schedule: every row of the table of benefits is kept,
 *      read BY COLUMN (wrapped cells joined, never fragments), typed
 *      (as charged / deductible / co-insurance / pro-ration / policy-year
 *      limit / co-payment cap), cited, and never calculated from; the
 *      Portfolio shows Hospitalisation;
 *   R2 a personal "Certificate of Renewal" that quotes "LIA 2019 definitions"
 *      stays a certificate and is linked;
 *   R3 multi-column tier tables keep the column as the tier / person class,
 *      and each person gets theirs (a child gets the child column);
 *   R4 renewal notices store premium records (with the MediSave and cash
 *      portions), never benefits;
 *   R5 a reading-service failure is retried, then the readable text is kept
 *      (degraded) with an honest message and one deferred re-read -- never
 *      "could not be read";
 *   R6 the same policy uploaded as two files is one set of rows; table row
 *      numbers never leak into names; a zip named .pdf is "not a real PDF";
 *      a group booklet links the people it names as enrolled, with tiers.
 *
 * Part A is pure. Part B runs the REAL processPolicy() / job queue against the
 * LOCAL database with the deterministic model stand-in (skipped with a notice
 * otherwise), in households named with this run's SYNTHETIC-DPTEST prefix,
 * removed at the end.
 */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

process.env.E2E_RUN_ID ||= `r5i${Date.now().toString(36)}`;

let cases = 0;
async function t(name: string, fn: () => unknown | Promise<unknown>) {
  try { await fn(); cases++; console.log("  ok  " + name); }
  catch (error) { console.error("  FAIL " + name); throw error; }
}
const fixture = (name: string) => Buffer.from(readFileSync(path.join(__dirname, "fixtures", "r5", name + ".pdf.b64"), "utf8").replace(/\s+/g, ""), "base64");
const SHIELD = "ShieldCare_Premier_Schedule_2026_x", SHIELD_COPY = "ShieldCare_Premier_Schedule_2026_v2", SHIELD_PLAIN = "ShieldCare_Premier_Schedule_2026";
const TERM = "TermSecure20_Renewal_Certificate_2026_x", TRAVEL = "TravelSafe_Annual_Family_2026_x";
const BOOKLET = "Harbourfront_Employee_Benefits_2026_x", RENEWAL = "ShieldCare_Renewal_Notice_2027_x";

async function pagesOf(name: string) {
  const { extractPdfPages } = await import("@/lib/documents/pdf");
  return extractPdfPages(new Uint8Array(fixture(name)));
}

async function partA() {
  const { benefitRowsFromText } = await import("@/lib/documents/layout");
  const { rowKind, typedValue, cleanBenefitName } = await import("@/lib/policies/catalog-builder");
  const { selectTierRows, tierApplies, describeScheduleTerm, isScheduleTerm } = await import("@/lib/policies/benefit-catalog");
  const { pickMemberTier, personClause, particularsLines } = await import("@/lib/policies/member-tiers");
  const { deterministicDocumentRole, sanitizePolicyExtraction, enrolledNames } = await import("@/lib/documents/intelligence");
  const { detectHighConfidenceReferenceRole, buildCodeOnlyExtraction } = await import("@/lib/ai/extract-policy");
  const { validateDocumentUpload, NOT_A_REAL_PDF_MESSAGE } = await import("@/lib/documents/formats");
  const errors = await import("@/lib/documents/processing-errors");
  const { classifyPipelineError } = await import("@/lib/jobs/pipeline-worker");
  const { paymentSplitNote } = await import("@/lib/rag/ingest");
  console.log("A. pure");

  const shield = await pagesOf(SHIELD);
  const shieldRows = shield.flatMap((p) => benefitRowsFromText(p.text).map((r) => ({ ...r, page: p.pageNumber })));
  const cell = (label: string, tier: string) => shieldRows.filter((r) => r.label === label && r.tier === tier).map((r) => r.value);

  await t("R1: the ShieldCare table is read by column -- every tier's cell, wrapped cells joined, nothing fragmented", () => {
    assert.deepEqual(cell("Daily room, board and hospital services", "Private hospital"), ["As charged"]);
    assert.deepEqual(cell("Daily room, board and hospital services", "Restructured hospital (B1 ward)"), ["As charged"]);
    assert.deepEqual(cell("Surgical benefits (including day surgery)", "Private hospital"), ["As charged"], "a wrapped label is one label");
    assert.deepEqual(cell("Pre-hospitalisation treatment", "Private hospital"), ["As charged, within 180 days before admission"], "a wrapped cell is one cell");
    assert.deepEqual(cell("Policy year limit", "Private hospital"), ["S$2,000,000"]);
    assert.deepEqual(cell("Policy year limit", "Restructured hospital (A ward)"), ["S$1,000,000"]);
    assert.deepEqual(cell("Deductible per policy year (Class B1 / A / private)", "Private hospital"), ["S$3,500"]);
    assert.deepEqual(cell("Co-insurance", "Private hospital"), ["10%"]);
    assert.deepEqual(cell("Pro-ration factor (private hospital treatment on a restructured-hospital plan)", "Restructured hospital (A ward)"), ["65%"]);
    assert.deepEqual(cell("Co-payment cap per policy year", "Panel provider or pre-authorised"), ["S$3,000"]);
    assert.ok(!shieldRows.some((r) => /^(?:ward\)|surgery\)|days|before admission|stage\))$/i.test(r.label) || /^\d+(?:,\s*\d+)*$/.test(r.value)),
      "no fragment rows and no Notes-column values");
  });
  await t("R1: table rows are typed; typed values are fractions or money, never a formula", () => {
    const typed = (label: string, value: string, tier: string | null = null) => { const kind = rowKind(label, value, tier); return [kind, typedValue(kind, value)]; };
    assert.deepEqual(typed("Daily room, board and hospital services", "As charged"), ["as_charged", null]);
    assert.deepEqual(typed("Deductible per policy year (Class B1 / A / private)", "S$3,500"), ["deductible", 3500]);
    assert.deepEqual(typed("Co-insurance", "10%"), ["co_insurance", 0.1]);
    assert.deepEqual(typed("Pro-ration factor (private hospital treatment on a restructured-hospital plan)", "65%"), ["pro_ration", 0.65]);
    assert.deepEqual(typed("Policy year limit", "S$2,000,000"), ["policy_year_limit", 2000000]);
    assert.deepEqual(typed("Overall annual limit", "S$100,000"), ["policy_year_limit", 100000]);
    assert.deepEqual(typed("Co-payment cap per policy year", "S$3,000"), ["co_payment_cap", 3000]);
    assert.deepEqual(typed("Emergency overseas treatment", "Not covered"), ["not_covered", null]);
    assert.deepEqual(typed("Overseas medical expenses", "S$1,000,000", "Family maximum"), ["family_limit", 1000000]);
    assert.equal(rowKind("Overseas medical expenses", "S$250,000", "Child"), "benefit");
    assert.equal(isScheduleTerm("deductible"), true); assert.equal(isScheduleTerm("benefit"), false);
    assert.equal(describeScheduleTerm("deductible", 3500, "SGD"), "Deductible of SGD 3,500 (you pay this first)");
    assert.equal(describeScheduleTerm("co_insurance", 0.1, null), "Co-insurance of 10% of the bill after the deductible");
  });

  const travel = await pagesOf(TRAVEL);
  const travelRows = travel.flatMap((p) => benefitRowsFromText(p.text));
  await t("R3: the travel table keeps Adult / Child / Family maximum as tiers -- a child's overseas medical is S$250,000", () => {
    const medical = travelRows.filter((r) => r.label === "Overseas medical expenses");
    assert.deepEqual(medical.map((r) => [r.tier, r.value]), [["Adult", "S$500,000"], ["Child", "S$250,000"], ["Family maximum", "S$1,000,000"]]);
    const forChild = selectTierRows(medical.map((r) => ({ ...r, policyId: "p", benefitName: r.label, sourcePage: 2 })), () => "Child");
    assert.deepEqual(forChild.map((r) => r.value), ["S$250,000"]);
    const unknown = selectTierRows(medical.map((r) => ({ ...r, policyId: "p", benefitName: r.label, sourcePage: 2 })), () => null);
    assert.equal(unknown.length, 3, "an unknown tier narrows nothing");
  });
  await t("R6: table row numbers never leak into benefit names", () => {
    assert.ok(travelRows.every((r) => !/^\d/.test(cleanBenefitName(r.label))), travelRows.map((r) => r.label).join(" | "));
    assert.equal(cleanBenefitName("3 Travel delay (for every full 6 hours of delay)"), "Travel delay (for every full 6 hours of delay)");
    assert.equal(cleanBenefitName("3a Travel delay - maximum per person"), "Travel delay - maximum per person");
    assert.equal(cleanBenefitName("2. Loss of sight"), "Loss of sight");
    assert.equal(cleanBenefitName("COVID-19 overseas medical expenses"), "COVID-19 overseas medical expenses");
  });

  const booklet = await pagesOf(BOOKLET);
  const bookletText = booklet.map((p) => p.text).join("\n");
  const bookletTiers = [...new Set(booklet.flatMap((p) => benefitRowsFromText(p.text)).map((r) => r.tier).filter((x): x is string => !!x))];
  await t("R3: the group booklet's Plan A/B/C/Dependants columns are tiers; each named person gets theirs", () => {
    assert.ok(bookletTiers.includes("Plan A (Grade M2 and above)") && bookletTiers.includes("Plan B") && bookletTiers.includes("Dependants"), bookletTiers.join(" | "));
    const tierOf = (name: string, hint: string | null = null) => pickMemberTier({ tiers: bookletTiers, clause: personClause(bookletText, name), relationshipHint: hint, particulars: particularsLines(bookletText) });
    assert.equal(tierOf("Lim Wei Jie", "employee"), "Plan A");
    assert.equal(tierOf("Tan Mei Ling", "spouse"), "Dependants");
    assert.equal(tierOf("Lim Xin Yi", "child"), "Dependants");
    assert.equal(tierApplies("Dependants (Plan A only)", "Dependants"), true);
    assert.equal(tierApplies("Plan A (Grade M2 and above)", "Plan A"), true);
    assert.equal(tierApplies("Plan AB", "Plan A"), false);
    const travelText = travel.map((p) => p.text).join("\n");
    const travelTiers = ["Adult", "Child", "Family maximum"];
    assert.equal(pickMemberTier({ tiers: travelTiers, clause: personClause(travelText, "Lim Xin Yi") }), "Child");
    assert.equal(pickMemberTier({ tiers: travelTiers, clause: personClause(travelText, "Tan Mei Ling") }), "Adult");
    const shieldText = shield.map((p) => p.text).join("\n");
    const shieldTiers = [...new Set(shieldRows.map((r) => r.tier).filter((x): x is string => !!x))];
    assert.equal(pickMemberTier({ tiers: shieldTiers, clause: personClause(shieldText, "Tan Mei Ling"), particulars: particularsLines(shieldText) }), "Private hospital");
  });
  await t("R6: the booklet's enrolment statement names exactly the enrolled people", () => {
    const lines = enrolledNames(bookletText);
    for (const name of ["lim wei jie", "tan mei ling", "lim xin yi"]) assert.ok(lines.some((l) => l.includes(name)), name);
    assert.deepEqual(enrolledNames("Definitions. Insured means the person named in the schedule."), []);
  });

  const term = await pagesOf(TERM);
  await t("R2: a personal Certificate of Renewal quoting \"LIA 2019 definitions\" stays a certificate", () => {
    assert.equal(deterministicDocumentRole(term, "certificate"), "certificate");
    assert.equal(deterministicDocumentRole(term, null), "certificate", "recognised by its own title, whatever the model said");
    assert.equal(detectHighConfidenceReferenceRole(term), null);
    const doc = (text: string) => [{ pageNumber: 1, text }];
    for (const title of ["RENEWAL CERTIFICATE", "POLICY CONTRACT", "Policy Information Page"])
      assert.notEqual(deterministicDocumentRole(doc(title + "\nPolicy number ABC-12345\nLife assured Lim Wei Jie\nDefinitions follow."), null), "policy_wording", title);
    assert.equal(deterministicDocumentRole(doc("POLICY WORDING\nDefinitions. Policy number means the number on your schedule."), null), "policy_wording", "plain wording is still wording");
  });
  await t("R2: a keyword rule never downgrades a reading that confirmed cover and named people printed in the document", () => {
    const pages = [{ pageNumber: 1, text: "Straits Heritage Life\nLife assured Lim Wei Jie\nSum assured S$800,000\nThis policy wording applies. Definitions: see LIA 2019 definitions." }];
    const raw = { ...buildCodeOnlyExtraction(pages), documentRole: "certificate" as const, personalCoverageConfirmed: true,
      insuredPeople: [{ name: "Lim Wei Jie", relationshipHint: null, coverages: [{ category: "Death", productName: null, policyNumber: null, amount: 800000, currency: "SGD", notes: null, sourcePage: 1, evidenceText: "Sum assured S$800,000", evidenceVerified: false }] }] };
    const kept = sanitizePolicyExtraction(raw, pages);
    assert.equal(kept.documentRole, "certificate"); assert.equal(kept.insuredPeople.length, 1); assert.equal(kept.personalCoverageConfirmed, true);
    const invented = sanitizePolicyExtraction({ ...raw, insuredPeople: [{ ...raw.insuredPeople[0], name: "Somebody Else" }] }, pages);
    assert.equal(invented.documentRole, "policy_wording", "a name not printed in the document earns no exception");
  });

  const renewal = await pagesOf(RENEWAL);
  await t("R4: a renewal notice's premium lines are never benefit rows; its MediSave/cash split is read as printed", () => {
    for (const page of renewal) assert.deepEqual(benefitRowsFromText(page.text).filter((r) => /medisave|cash|payable|payment|premium/i.test(r.label)), []);
    assert.equal(paymentSplitNote(renewal.map((p) => p.text).join("\n")), "As printed: MediSave pays S$1,050.00; cash payable S$362.00; total cash payable S$1,120.00");
    assert.equal(paymentSplitNote("Nothing about payments here"), null);
  });

  await t("R5: a reading-service failure is retried (bounded); a quota stop never is", () => {
    assert.equal(classifyPipelineError(new errors.TemporaryProcessingError("Policy reading failed: DeterministicModelUnavailableError")), "transient");
    assert.equal(classifyPipelineError(new Error("deterministic stand-in does not implement policy_extraction")), "non_retryable", "raw errors are classified as before");
    assert.equal(errors.isQuotaOrSpendStop(new Error("Model provider quota exhausted (429)")), true);
    assert.equal(errors.isQuotaOrSpendStop(new Error("503 Service Unavailable")), false);
  });
  await t("R5: the service messages are honest -- never \"could not be read\", never a claim of attempts that did not happen", () => {
    for (const message of [errors.DOCUMENT_READING_SERVICE_MESSAGE, errors.DOCUMENT_READ_IN_PART_MESSAGE]) {
      assert.doesNotMatch(message, /could not be read|unreadable|clearer|upload/i);
      assert.match(message, /try again automatically/);
      assert.doesNotMatch(message, /model|provider|gemini|openai|quota|error|exception|job|queue|ocr/i);
    }
    assert.ok(errors.USER_ACTIONABLE_PROCESSING_ERRORS.has(errors.DOCUMENT_READING_SERVICE_MESSAGE));
    assert.doesNotMatch(errors.DOCUMENT_READING_FAILED_MESSAGE, /several automatic attempts/);
  });

  await t("R6: a zip named .pdf is \"not a real PDF\", not \"Archives are not accepted\"", () => {
    const zip = Buffer.concat([Buffer.from("PK\x03\x04", "latin1"), Buffer.alloc(64, 1)]);
    const named = validateDocumentUpload({ filename: "ShieldCare_Schedule.pdf", mimeType: "application/pdf", byteSize: zip.length, bytes: new Uint8Array(zip), maxBytes: 50 << 20 });
    assert.equal(named.valid, false); assert.equal(!named.valid && named.message, NOT_A_REAL_PDF_MESSAGE);
    const honest = validateDocumentUpload({ filename: "documents.zip", mimeType: "application/zip", byteSize: zip.length, bytes: new Uint8Array(zip), maxBytes: 50 << 20 });
    assert.match(!honest.valid ? honest.message : "", /Archives are not accepted/);
    const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64, 0)]);
    const exeNamed = validateDocumentUpload({ filename: "x.pdf", mimeType: "application/pdf", byteSize: exe.length, bytes: new Uint8Array(exe), maxBytes: 50 << 20 });
    assert.match(!exeNamed.valid ? exeNamed.message : "", /Executable/);
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
  const { enqueueJob } = await import("@/lib/jobs/queue");
  const { claimAndProcessOne } = await import("@/lib/jobs/worker-runtime");
  const { processPolicyProcessingJob } = await import("@/lib/jobs/processors");
  const { loadBenefitCatalog, selectTierRows } = await import("@/lib/policies/benefit-catalog");
  const errors = await import("@/lib/documents/processing-errors");
  const { PREFIX } = await import("../e2e/support/synthetic");
  const cleanup = (await import("../e2e/support/cleanup")).default;
  const userA = randomUUID(), userB = randomUUID();
  process.env.E2E_USER_A = userA; process.env.E2E_USER_B = userB;
  console.log("B. real processPolicy() on the local database, run " + PREFIX);
  const a = await ensureDefaultHousehold(userA, `${PREFIX}-Household-R5`);
  const member = async (name: string, relationship: string) => {
    const id = randomUUID();
    await pool.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,$3,$4)`, [id, a, name, relationship]);
    return id;
  };
  const meiLing = await member("Tan Mei Ling", "self"), weiJie = await member("Lim Wei Jie", "spouse"), xinYi = await member("Lim Xin Yi", "child");
  const rows = async (sql: string, params: unknown[]) => (await pool.query(sql, params)).rows;
  const insert = async (memberId: string, name: string, bytes: Buffer) => {
    const policyId = randomUUID();
    const storageKey = await savePolicyFile({ accountId: a, familyMemberId: memberId, policyId, filename: name, bytes: new Uint8Array(bytes) });
    await pool.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,processing_stage,processing_progress,processing_message,quarantine_status,scan_provider,scanned_at)
      VALUES($1,$2,$3,$4,$5,$6,'queued','queued',1,'Waiting','scan_clean','r5-regression',now())`,
      [policyId, a, memberId, name, storageKey, createHash("sha256").update(bytes).digest("hex")]);
    return { policyId, storageKey };
  };
  const ingest = async (memberId: string, fixtureName: string) => {
    const doc = await insert(memberId, fixtureName + ".pdf", fixture(fixtureName));
    await processPolicy({ accountId: a, familyMemberId: memberId, policyId: doc.policyId, storageKey: doc.storageKey, linkUploadMember: true });
    return doc.policyId;
  };
  const linked = async (policyId: string) => new Map((await rows(`SELECT family_member_id,benefit_tier FROM policy_members WHERE policy_id=$1`, [policyId])).map((r) => [r.family_member_id, r.benefit_tier]));

  try {
    const shield = await ingest(meiLing, SHIELD);
    await t("R1: the ShieldCare schedule stores its core cover as typed, cited rows -- none calculated", async () => {
      const typed = await rows(`SELECT benefit_name,tier,row_kind,formula_kind,formula_value::float8 v,currency,source_page,quote,passage_verified FROM policy_benefits WHERE policy_id=$1 AND row_kind IS DISTINCT FROM 'benefit' ORDER BY source_page,benefit_name,tier`, [shield]);
      const find = (kind: string, tier: string, name?: RegExp) => typed.find((r) => r.row_kind === kind && r.tier === tier && (!name || name.test(r.benefit_name)));
      for (const r of typed) { assert.equal(r.formula_kind, "none", r.benefit_name + " is never a payout formula"); assert.ok(r.source_page && r.quote, "cited"); }
      assert.ok(find("as_charged", "Private hospital", /^Daily room, board and hospital services$/));
      assert.ok(find("as_charged", "Private hospital", /^Surgical benefits \(including day surgery\)$/));
      assert.equal(find("deductible", "Private hospital")?.v, 3500);
      assert.equal(find("co_insurance", "Private hospital")?.v, 0.1);
      assert.equal(find("pro_ration", "Restructured hospital (A ward)")?.v, 0.65);
      const limit = find("policy_year_limit", "Private hospital");
      assert.equal(limit?.v, 2000000); assert.equal(limit?.currency, "SGD"); assert.equal(limit?.passage_verified, true);
      assert.equal(find("co_payment_cap", "Panel provider or pre-authorised")?.v, 3000);
      assert.equal((await rows(`SELECT count(*)::int n FROM policy_benefits WHERE policy_id=$1 AND conflict_note IS NOT NULL`, [shield]))[0].n, 0, "tier columns are not contradictions");
    });
    await t("R1: the Portfolio shows Hospitalisation for the insured person, from the policy-year limit of her tier", async () => {
      assert.equal((await linked(shield)).get(meiLing), "Private hospital");
      const shown = await rows(`SELECT category,amount::float8 amount,currency,evidence_text FROM policy_coverages WHERE policy_id=$1 AND family_member_id=$2 AND confirmed AND evidence_verified`, [shield, meiLing]);
      const hospital = shown.find((c) => c.category === "Hospitalisation");
      assert.ok(hospital, JSON.stringify(shown)); assert.equal(hospital.amount, 2000000); assert.equal(hospital.currency, "SGD");
      assert.match(hospital.evidence_text, /Policy year limit/);
    });

    const copy = await ingest(meiLing, SHIELD_COPY);
    await t("R6: the same policy uploaded as a second file is one set of rows", async () => {
      const dup = await rows(`SELECT count(*)::int n FROM policy_benefits WHERE policy_id=$1 AND duplicate_of_policy_id=$2`, [copy, shield]);
      const all = await rows(`SELECT count(*)::int n FROM policy_benefits WHERE policy_id=$1`, [copy]);
      assert.ok(all[0].n > 20); assert.equal(dup[0].n, all[0].n, "every identical row of the copy points at the kept document");
      const catalog = await loadBenefitCatalog(a, [shield, copy]);
      const keys = catalog.map((b) => [b.benefitName, b.tier, b.sourcePage, b.formulaValue].join("|"));
      assert.equal(new Set(keys).size, keys.length, "no row listed twice");
      assert.ok(catalog.every((b) => b.policyId === shield), "the kept set cites one document");
    });

    const termId = await ingest(weiJie, TERM);
    await t("R2: the TermSecure renewal certificate is a certificate and is linked to its life assured", async () => {
      const [p] = await rows(`SELECT document_role,personal_coverage_confirmed FROM policies WHERE id=$1`, [termId]);
      assert.equal(p.document_role, "certificate"); assert.equal(p.personal_coverage_confirmed, true);
      assert.ok((await linked(termId)).has(weiJie));
    });

    const travelId = await ingest(meiLing, TRAVEL);
    await t("R3: the travel certificate links all three insured; the child gets the Child column", async () => {
      const links = await linked(travelId);
      assert.equal(links.get(xinYi), "Child"); assert.equal(links.get(meiLing), "Adult"); assert.equal(links.get(weiJie), "Adult");
      const catalog = await loadBenefitCatalog(a, [travelId]);
      const forChild = selectTierRows(catalog, () => "Child").filter((b) => b.benefitName === "Overseas medical expenses");
      assert.deepEqual(forChild.map((b) => b.formulaValue), [250000]);
      const seeded = await rows(`SELECT amount::float8 amount FROM coverage_rules WHERE policy_id=$1 AND family_member_id=$2 AND quote ILIKE 'Overseas medical expenses%'`, [travelId, xinYi]);
      assert.ok(!seeded.some((r) => r.amount === 500000), "the child's ledger never carries the adult column: " + JSON.stringify(seeded));
    });

    const bookletId = await ingest(weiJie, BOOKLET);
    await t("R6: the group booklet links the employee, spouse and child it names as enrolled, with their plan tier", async () => {
      const links = await linked(bookletId);
      assert.equal(links.get(weiJie), "Plan A"); assert.equal(links.get(meiLing), "Dependants"); assert.equal(links.get(xinYi), "Dependants");
      const [p] = await rows(`SELECT document_role,personal_coverage_confirmed FROM policies WHERE id=$1`, [bookletId]);
      assert.equal(p.document_role, "benefit_guide"); assert.equal(p.personal_coverage_confirmed, false, "a booklet confirms no personal cover amount");
      assert.equal((await rows(`SELECT count(*)::int n FROM policy_coverages WHERE policy_id=$1`, [bookletId]))[0].n, 0);
    });

    const renewalId = await ingest(meiLing, RENEWAL);
    await t("R4: the renewal notice stores premium records with the MediSave/cash split, and no benefits", async () => {
      assert.equal((await rows(`SELECT count(*)::int n FROM policy_benefits WHERE policy_id=$1`, [renewalId]))[0].n, 0);
      const premiums = await rows(`SELECT amount::float8 amount,notes FROM premium_records WHERE source_document_id=$1 ORDER BY amount`, [renewalId]);
      assert.deepEqual(premiums.map((r) => r.amount), [362, 758]);
      for (const r of premiums) assert.match(r.notes, /MediSave pays S\$1,050\.00; cash payable S\$362\.00; total cash payable S\$1,120\.00/);
    });

    await t("R5: a reading-service failure is retried, then the readable text is kept with an honest message and one deferred re-read", async () => {
      const jobType = `r5_test_policy_processing_${randomUUID().slice(0, 8)}`;
      // The plain schedule has no stand-in reading: the reading service fails on every attempt.
      const doc = await insert(meiLing, "ShieldCare_Premier_Schedule_2026.pdf", fixture(SHIELD_PLAIN));
      await enqueueJob(pool, { jobType, idempotencyKey: doc.policyId, accountId: a, maxAttempts: 2,
        payload: { policyId: doc.policyId, familyMemberId: meiLing, storageKey: doc.storageKey, pdfPassword: null, linkUploadMember: true } });
      const run = () => claimAndProcessOne({ jobType, workerId: "r5-test-worker", process: processPolicyProcessingJob });
      await run();
      let [job] = await rows(`SELECT status,attempt_count,last_error_category FROM background_jobs WHERE job_type=$1 AND idempotency_key=$2`, [jobType, doc.policyId]);
      assert.deepEqual([job.status, job.attempt_count], ["failed_retryable", 1], "attempt 1 is retried, not dead-lettered");
      let [p] = await rows(`SELECT processing_status,processing_message,processing_error FROM policies WHERE id=$1`, [doc.policyId]);
      assert.equal(p.processing_status, "queued"); assert.equal(p.processing_error, null); assert.equal(p.processing_message, errors.DOCUMENT_READING_RETRY_MESSAGE);
      await pool.query(`UPDATE background_jobs SET available_at=now() WHERE job_type=$1 AND idempotency_key=$2`, [jobType, doc.policyId]);
      await run();
      [job] = await rows(`SELECT status FROM background_jobs WHERE job_type=$1 AND idempotency_key=$2`, [jobType, doc.policyId]);
      assert.equal(job.status, "succeeded");
      [p] = await rows(`SELECT processing_status,processing_message,processing_error,needs_review FROM policies WHERE id=$1`, [doc.policyId]);
      assert.equal(p.processing_status, "ready"); assert.equal(p.processing_error, null);
      assert.equal(p.processing_message, errors.DOCUMENT_READ_IN_PART_MESSAGE); assert.equal(p.needs_review, true);
      const kept = await rows(`SELECT count(*)::int n FROM policy_benefits WHERE policy_id=$1 AND row_kind='policy_year_limit'`, [doc.policyId]);
      assert.ok(kept[0].n >= 3, "the table rows code can read are kept");
      assert.ok((await linked(doc.policyId)).has(meiLing), "filed under the profile it was uploaded to");
      const deferred = await rows(`SELECT status,available_at > now() + interval '20 minutes' AS later,payload->>'deferredRetry' AS deferred FROM background_jobs WHERE job_type=$1 AND idempotency_key=$2`, [jobType, doc.policyId + ":retry-read"]);
      assert.deepEqual(deferred.map((r) => [r.status, r.later, r.deferred]), [["queued", true, "true"]], "exactly one later re-read");
      await pool.query(`DELETE FROM background_jobs WHERE job_type=$1`, [jobType]);
    });
  } finally {
    await cleanup();
    await pool.end();
  }
}

(async () => {
  await partA();
  await partB();
  console.log(`r5 ingestion regressions passed: ${cases} cases`);
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
