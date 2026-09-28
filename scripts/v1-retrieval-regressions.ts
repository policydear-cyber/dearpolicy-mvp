/**
 * V1 core-loop certification: retrieval & citation.
 *
 * Owned by the retrieval/citation audit. Runs real PostgreSQL SQL (PGlite)
 * against every loader the chat uses, plus the chat route itself with a
 * simulated model, and checks five requirements:
 *   R1 a factual answer cites the document and page its fact came from;
 *   R2 deleted (pending_deletion/soft_deleted) and superseded documents never
 *      support an answer;
 *   R3 another household's data is never visible, even with the same member name;
 *   R4 different currencies are never added, and no currency is defaulted;
 *   R5 no amount appears from a household assertion alone.
 *
 * Every check runs; failures are collected and reported together, and the
 * process exits non-zero if any failed. Assertions state the requirement,
 * not the current behaviour.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";
import { loadPolicyInventory, retrieveContractSources, type PolicyContract } from "@/lib/policies/inventory";
import { loadBenefitCatalog, scenarioFromCatalog, scheduleFallbackItems, questionTraits } from "@/lib/policies/benefit-catalog";
import { loadCoverConditions } from "@/lib/policies/condition-catalog";
import { ledgerFor, addLedgerRow, seedLedger } from "@/lib/ledger/store";
import { answerFromLedger } from "@/lib/ledger/answer";
import { confirmedOwnedCoverages } from "@/lib/coverage/facts";
import { aggregatePotentialPayouts } from "@/lib/chat/policy-analysis";
import { describeCoverSplit, applyPolicyAggregateCaps } from "@/lib/insurance/cover-composition";
import { POST } from "@/app/api/chat/route";
import { NextRequest } from "next/server";
import type { ChatAnswer, ChatCitation, ClaimItem } from "@/types";

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 6).join("\n     "));
  }
}

async function main() {
  delete process.env.PINECONE_API_KEY;
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of ["schema.sql", "chat-upgrade.sql", "benefit-catalog.sql", "model-usage.sql", "coverage-ledger.sql", "cover-conditions.sql", "background-jobs.sql", "household-rls.sql", "lifecycle.sql"])
    await db.exec(await readFile(path.resolve("sql/" + file), "utf8"));
  await db.exec("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;");

  let tail = Promise.resolve();
  const acquire = async () => { const previous = tail; let release!: () => void; tail = new Promise<void>((r) => { release = r; }); await previous; return release; };
  const execute = async (text: string, params: unknown[] = []) => {
    if (!params.length && text.includes(";")) { const rs = await db.exec(text); const r = rs.at(-1); return { rows: r?.rows ?? [], rowCount: r?.affectedRows ?? 0 }; }
    const r = await db.query(text, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  const originalQuery = pool.query, originalConnect = pool.connect, originalFetch = globalThis.fetch;
  pool.query = (async (text: string, params: unknown[] = []) => { const release = await acquire(); try { return await execute(text, params); } finally { release(); } }) as typeof pool.query;
  pool.connect = (async () => { const release = await acquire(); return { query: execute, release }; }) as typeof pool.connect;

  // ---------------------------------------------------------------- fixture
  const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b", C = "00000000-0000-0000-0000-00000000000c";
  const id = (n: number) => "20000000-0000-4000-8000-" + String(n).padStart(12, "0");
  const NAME = "Tan Ah Kow";
  const pa = { id: id(1), display_name: NAME, preferred_name: "Ah Kow", relationship: "self" };
  const pb = { id: id(2), display_name: NAME, preferred_name: "Ah Kow", relationship: "self" };
  const pc = { id: id(3), display_name: "Lim Mei Ling", preferred_name: "Mei Ling", relationship: "self" };
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Household A'),($2,'Household B'),($3,'Household C')", [A, B, C]);
  for (const h of [A, B, C]) await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [h]);
  for (const [p, acct] of [[pa, A], [pb, B], [pc, C]] as const)
    await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,$3,$4,$5)", [p.id, acct, p.display_name, p.preferred_name, p.relationship]);

  const LIVE = id(101), DEL = id(102), SOFT = id(103), OLD = id(104), NEW = id(105), NULLP = id(106), USD = id(107), BDOC = id(201);
  type Doc = { id: string; acct: string; member: string; number: string; product: string; marker: string; lifecycle?: string; superseded?: boolean; supersedes?: string; currency?: string; benefitPage: number | null; coveragePage: number | null; chunkPage: number; ruleCurrency?: string | null };
  const docs: Doc[] = [
    { id: LIVE, acct: A, member: pa.id, number: "LIVE-1", product: "Shield Hospital Plan", marker: "LIVEMARKER", benefitPage: 4, coveragePage: 3, chunkPage: 4 },
    { id: DEL, acct: A, member: pa.id, number: "DEL-1", product: "Deleted Hospital Plan", marker: "DELMARKER", lifecycle: "pending_deletion", benefitPage: 6, coveragePage: 2, chunkPage: 6 },
    { id: SOFT, acct: A, member: pa.id, number: "SOFT-1", product: "Soft Hospital Plan", marker: "SOFTMARKER", lifecycle: "soft_deleted", benefitPage: 8, coveragePage: 2, chunkPage: 8 },
    { id: OLD, acct: A, member: pa.id, number: "SUP-1", product: "Versioned Hospital Plan", marker: "OLDMARKER", superseded: true, benefitPage: 9, coveragePage: 2, chunkPage: 9 },
    { id: NEW, acct: A, member: pa.id, number: "SUP-1", product: "Versioned Hospital Plan", marker: "NEWMARKER", supersedes: OLD, benefitPage: 5, coveragePage: 2, chunkPage: 5 },
    { id: NULLP, acct: A, member: pa.id, number: "NULL-1", product: "Unpaged Life Plan", marker: "NULLMARKER", benefitPage: null, coveragePage: null, chunkPage: 2, ruleCurrency: null },
    { id: USD, acct: A, member: pa.id, number: "USD-1", product: "Dollar Hospital Plan", marker: "USDMARKER", currency: "USD", benefitPage: 7, coveragePage: 3, chunkPage: 7 },
    { id: BDOC, acct: B, member: pb.id, number: "LIVE-1", product: "Shield Hospital Plan", marker: "BMARKER", benefitPage: 4, coveragePage: 3, chunkPage: 4 },
  ];
  for (const d of docs) {
    const currency = d.currency ?? "SGD", sym = currency === "USD" ? "US$" : "S$";
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,effective_date,quarantine_status,lifecycle_state,superseded_at,supersedes_id,benefits_indexed_at,conditions_indexed_at,ledger_read_at,updated_at)
      VALUES($1,$2,$3,'Example Insurer',$4,$5,'Hospitalisation','certificate',true,90,'ready',$6,$6,'2022-01-01','scan_clean',$7,$8,$9,now(),now(),now(),$10)`,
      [d.id, d.acct, d.member, d.product, d.number, d.marker.toLowerCase() + ".pdf", d.lifecycle ?? "active", d.superseded ? new Date().toISOString() : null, d.supersedes ?? null, d.superseded ? new Date().toISOString() : "2024-01-01T00:00:00Z"]);
    await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)", [d.id, d.member, d.acct]);
    const clause = `${d.marker} Hospital cash benefit: we pay ${sym}100 per day of hospital stay, up to 30 days.`;
    for (let page = 1; page <= 9; page++)
      await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [d.acct, d.id, page, page === d.chunkPage ? clause : `${d.marker} page ${page} of ${d.product}. Policy number ${d.number}. Currency of cover: ${currency}.`]);
    await db.query("INSERT INTO policy_chunks(account_id,family_member_id,policy_id,page_start,page_end,text) VALUES($1,$2,$3,$4,$4,$5)", [d.acct, d.member, d.id, d.chunkPage, clause]);
    await db.query(`INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,evidence_verified,confirmed)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,true)`,
      [d.acct, d.id, d.member, d.id === NULLP ? "Death" : "Hospitalisation", d.id === NULLP ? 200000 : 100000, currency, d.product, d.coveragePage, `${d.product} sum insured ${currency} ${d.id === NULLP ? "200,000" : "100,000"}`]);
    await db.query(`INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,fact_key,offset_days,maximum_days,source_page,quote,conditions,requirements,needs_review)
      VALUES($1,$2,$3,$4,ARRAY['hospitalisation']::text[],'daily',100,$5,'hospitalNights',0,30,$6,$7,'[]'::jsonb,'[]'::jsonb,false)`,
      [d.acct, d.id, d.product, d.marker + " Hospital Cash", d.ruleCurrency === null ? null : currency, d.benefitPage, clause]);
    await db.query(`INSERT INTO policy_cover_conditions(account_id,policy_id,product_name,condition_kind,cause,applies_to_events,source_page,quote)
      VALUES($1,$2,$3,'exclusion','war',ARRAY['hospitalisation']::text[],$4,$5)`, [d.acct, d.id, d.product, d.benefitPage, d.marker + " We do not pay for war."]);
    await db.query(`INSERT INTO coverage_rules(account_id,family_member_id,policy_id,plan_name,insurer,event_type,pays_kind,amount,currency,source_page,quote,origin,status)
      VALUES($1,$2,$3,$4,'Example Insurer','death','lump_sum',$5,$6,$7,$8,'wording','confirmed')`,
      [d.acct, d.member, d.id, d.product, d.id === USD ? 500 : 1000, currency, d.benefitPage, d.marker + " On death we pay a fixed amount."]);
  }
  // A figure the household typed on the Coverage page, with no document behind it.
  const PERSON_RULE = (await db.query<{ id: string }>(`INSERT INTO coverage_rules(account_id,family_member_id,policy_id,plan_name,event_type,pays_kind,amount,currency,origin,status)
    VALUES($1,$2,NULL,'Hospital bill I was told about','hospital_medical_expense','reimbursement_cap',5000,'SGD','person','confirmed') RETURNING id`, [A, pa.id])).rows[0].id;

  const markers = (text: string) => ["LIVEMARKER", "DELMARKER", "SOFTMARKER", "OLDMARKER", "NEWMARKER", "NULLMARKER", "USDMARKER", "BMARKER"].filter((m) => text.includes(m));
  const forbiddenForA = new Set([DEL, SOFT, OLD, BDOC]);
  const label: Record<string, string> = { [DEL]: "pending_deletion", [SOFT]: "soft_deleted", [OLD]: "superseded", [BDOC]: "household B" };
  const leaked = (ids: (string | null | undefined)[]) => [...new Set(ids.filter((x): x is string => !!x && forbiddenForA.has(x)).map((x) => label[x]))];

  /** Every citation must point at the stored document and page of the fact it cites. */
  async function verifyCitations(citations: ChatCitation[], where: string) {
    const problems: string[] = [];
    for (const c of citations) {
      const [kind, ref] = c.chunkId.includes(":") ? [c.chunkId.split(":")[0], c.chunkId.slice(c.chunkId.indexOf(":") + 1)] : ["chunk", c.chunkId];
      const table = kind === "benefit" ? "SELECT policy_id::text,source_page AS page FROM policy_benefits WHERE id::text=$1"
        : kind === "coverage" ? "SELECT policy_id::text,source_page AS page FROM policy_coverages WHERE id::text=$1"
        : kind === "ledger" ? "SELECT policy_id::text,source_page AS page FROM coverage_rules WHERE id::text=$1"
        : "SELECT policy_id::text,page_start AS page FROM policy_chunks WHERE id::text=$1";
      const row = (await db.query<{ policy_id: string | null; page: number | null }>(table, [ref])).rows[0];
      if (!row) { problems.push(`${c.chunkId}: cites a fact that is not stored`); continue; }
      if (!row.policy_id) problems.push(`${c.chunkId}: cites no document at all (policyId="${c.policyId}", page ${c.pageStart}) for a fact with no source document`);
      else if (c.policyId !== row.policy_id) problems.push(`${c.chunkId}: cites document ${c.policyId} but the fact is stored on ${row.policy_id}`);
      if (row.page == null) { if (c.pageStart != null || c.pageEnd != null) problems.push(`${c.chunkId}: claims page ${c.pageStart}-${c.pageEnd} but the stored page is unknown (null)`); }
      else if (c.pageStart !== row.page || c.pageEnd !== row.page) problems.push(`${c.chunkId}: claims page ${c.pageStart}-${c.pageEnd} but the fact is stored on page ${row.page}`);
      if (row.policy_id && forbiddenForA.has(row.policy_id)) problems.push(`${c.chunkId}: cites a ${label[row.policy_id]} document`);
    }
    assert.equal(problems.length, 0, where + ":\n" + problems.join("\n"));
  }

  try {
    const inventory = await loadPolicyInventory(A, [pa]);
    const contractDocIds = inventory.contracts.flatMap((c) => [...c.documents, ...c.references].map((d) => d.id));

    // ------------------------------------------------ R2/R3: every loader
    await check("R2/R3 loadPolicyInventory: no deleted, superseded or other-household document", () => {
      assert.ok(inventory.documents.some((d) => d.id === LIVE) && inventory.documents.some((d) => d.id === NEW), "live and current documents are present");
      assert.deepEqual(leaked(inventory.documents.map((d) => d.id)), [], "inventory.documents leaked");
      assert.deepEqual(leaked(contractDocIds), [], "contract documents/references leaked");
    });
    await check("R2 superseded version does not name or date the current contract", () => {
      const versioned = inventory.contracts.find((c) => c.documents.some((d) => d.id === NEW));
      assert.ok(versioned, "the current version forms a contract");
      assert.equal(versioned!.documents[0].id, NEW, `contract's primary document is ${versioned!.documents[0].id === OLD ? "the superseded OLD version" : versioned!.documents[0].id}`);
    });
    const sources = await retrieveContractSources({ accountId: A, contracts: inventory.contracts, question: "hospital cash benefit per day", searchTerms: ["hospital", "cash"] });
    const passages = [...sources.values()].flat();
    await check("R2/R3 retrieveContractSources: no passage from a deleted, superseded or other-household document", () => {
      assert.ok(passages.some((p) => p.text.includes("LIVEMARKER")) && passages.some((p) => p.text.includes("NEWMARKER")), "live passages retrieved");
      assert.deepEqual(leaked(passages.map((p) => p.policyId)), [], "retrieved passages leaked: " + markers(passages.map((p) => p.text).join(" ")).join(","));
    });
    await check("R1 retrieved passage citations equal the stored chunk document and page", async () => {
      assert.ok(passages.length > 0);
      await verifyCitations(passages.map((p) => p.citation), "passage citations");
    });
    await check("R3 a forged contract carrying household B's document id retrieves nothing for household A", async () => {
      const forged: PolicyContract = { ...inventory.contracts[0], id: "forged", documents: [{ ...inventory.contracts[0].documents[0], id: BDOC, processing_status: "ready", chunk_total: 1 }], references: [] };
      const got = [...(await retrieveContractSources({ accountId: A, contracts: [forged], question: "hospital", searchTerms: [] })).values()].flat();
      assert.equal(got.length, 0, "B passages returned: " + markers(got.map((p) => p.text).join(" ")).join(","));
    });
    const catalog = await loadBenefitCatalog(A, [...new Set(contractDocIds)]);
    await check("R2/R3 loadBenefitCatalog (chat path ids): no rule from a deleted, superseded or other-household document", () => {
      assert.ok(catalog.some((b) => b.policyId === LIVE));
      assert.deepEqual(leaked(catalog.map((b) => b.policyId)), [], "benefit rules leaked");
    });
    await check("R3 loadBenefitCatalog with household B's document id returns nothing for household A", async () => {
      assert.equal((await loadBenefitCatalog(A, [BDOC])).length, 0);
    });
    await check("R2/R3 loadCoverConditions (chat path ids): no condition from a deleted, superseded or other-household document", async () => {
      const conditions = await loadCoverConditions(A, [...new Set(contractDocIds)]);
      assert.ok(conditions.some((c) => c.policyId === LIVE));
      assert.deepEqual(leaked(conditions.map((c) => c.policyId)), [], "cover conditions leaked");
    });
    const ledger = await ledgerFor(A, [pa]);
    await check("R2/R3 ledgerFor: no coverage rule from a deleted, superseded or other-household document", () => {
      assert.ok(ledger.some((r) => r.policyId === LIVE));
      assert.deepEqual(leaked(ledger.map((r) => r.policyId)), [], "ledger rows leaked");
    });
    await check("R3 ledgerFor / confirmedOwnedCoverages / inventory with household B's same-named member return nothing for household A", async () => {
      assert.equal((await ledgerFor(A, [pb])).length, 0, "ledger rows for B's member");
      assert.equal((await confirmedOwnedCoverages(A, pb.id)).length, 0, "coverages for B's member");
      assert.equal((await loadPolicyInventory(A, [pb])).contracts.length, 0, "contracts for B's member");
    });
    await check("R2/R3 confirmedOwnedCoverages: no coverage from a deleted, superseded or other-household document", async () => {
      const cov = await confirmedOwnedCoverages(A, pa.id);
      assert.ok(cov.some((c) => c.policyId === LIVE));
      assert.deepEqual(leaked(cov.map((c) => c.policyId)), [], "coverages leaked");
    });

    // ------------------------------------------------ R1: catalogue / ledger citations
    const contractOf = (docId: string) => inventory.contracts.find((c) => c.documents.some((d) => d.id === docId))!;
    await check("R1 catalogue citation equals the stored benefit document and page (page 4, not a default)", async () => {
      const traits = questionTraits("What if I am hospitalised for 5 nights?");
      const out = scenarioFromCatalog({ contract: contractOf(LIVE), catalog, traits });
      assert.ok(out.citations.length > 0, "the scenario cites something (traits=" + traits.join(",") + ")");
      await verifyCitations(out.citations, "catalogue scenario citations");
    });
    await check("R1 a benefit whose page is unknown is never cited as page 1", async () => {
      const traits = questionTraits("What if I am hospitalised for 5 nights?");
      const out = scenarioFromCatalog({ contract: contractOf(NULLP), catalog, traits });
      assert.ok(out.citations.length > 0, "the unpaged benefit is cited");
      await verifyCitations(out.citations, "unpaged benefit citations");
    });
    await check("R1 a schedule line whose page is unknown is never cited as page 1", async () => {
      const contract = contractOf(NULLP);
      const out = scheduleFallbackItems({ contract, traits: ["death", "sudden", "external"] as never });
      assert.ok(out.citations.length > 0, "the unpaged schedule line is cited (coverages=" + JSON.stringify(contract.coverages.map((c) => [c.category, c.amount, c.sourcePage])) + ")");
      await verifyCitations(out.citations, "unpaged schedule citations");
    });
    const deathFacts = { [pa.id]: {} };
    const whatIf = answerFromLedger({ rows: ledger, people: [{ id: pa.id, name: pa.display_name }], facts: deathFacts, whatIfText: "What if I die?" });
    await check("R1 ledger citations equal the stored rule document and page", async () => {
      const documentBacked = whatIf.citations.filter((c) => c.chunkId !== "ledger:" + PERSON_RULE);
      assert.ok(documentBacked.length > 0, "ledger answer cites rules");
      await verifyCitations(documentBacked, "ledger citations");
    });
    await check("R1/R5 a household-entered ledger figure is never cited as a document page", async () => {
      const bill = answerFromLedger({ rows: ledger, people: [{ id: pa.id, name: pa.display_name }],
        facts: { [pa.id]: { hospitalised: { value: true, state: "known" }, eventType: { value: "diagnosis", state: "known" }, hospitalBill: { value: 5000, state: "known" } } } as never });
      const personCitations = bill.citations.filter((c) => c.chunkId === "ledger:" + PERSON_RULE);
      await verifyCitations(personCitations, "household-entered rule citation");
    });

    // ------------------------------------------------ R4: currencies
    await check("R4 aggregatePotentialPayouts never adds SGD to USD and never totals an item with no currency", () => {
      const item = (title: string, amount: number, currency?: string): ClaimItem => ({ title, status: "likely_applicable", amountText: null, reason: "", conditions: [], calculatedAmount: amount, aggregation: "additive", calculationId: title, ...(currency ? { currency } : {}) } as ClaimItem);
      const totals = aggregatePotentialPayouts([item("a", 1000, "SGD"), item("b", 500, "USD"), item("c", 200, "SGD"), item("d", 999)]);
      assert.deepEqual(totals.map((t) => [t.currency, t.amount]).sort(), [["SGD", 1200], ["USD", 500]]);
    });
    await check("R4 ledger lump sums in SGD and USD are totalled per currency", () => {
      const totals = aggregatePotentialPayouts(whatIf.items);
      const currencies = totals.map((t) => t.currency).sort();
      assert.ok(whatIf.items.some((i) => i.currency === "USD") && whatIf.items.some((i) => i.currency === "SGD"), "both currencies present among ledger items: " + JSON.stringify(whatIf.items.map((i) => [i.title, i.currency, i.calculatedAmount])));
      assert.deepEqual(currencies, ["SGD", "USD"]);
    });
    const mixed = (): ClaimItem[] => [
      { title: "Tan Ah Kow · Plan", coverKey: "policy:K", coverLabel: "Plan", status: "likely_applicable", amountText: null, reason: "", conditions: [], calculatedAmount: 60000, currency: "SGD", aggregation: "additive", coverAmount: 100000, scaleGroup: "g" } as ClaimItem,
      { title: "Tan Ah Kow · Plan rider", coverKey: "policy:K", coverLabel: "Plan", status: "likely_applicable", amountText: null, reason: "", conditions: [], calculatedAmount: 60000, currency: "USD", aggregation: "additive", coverAmount: 100000, scaleGroup: "g" } as ClaimItem,
      { title: "Tan Ah Kow · Other", coverKey: "policy:L", coverLabel: "Other", status: "likely_applicable", amountText: null, reason: "", conditions: [], calculatedAmount: 1, currency: "SGD", aggregation: "additive" } as ClaimItem,
    ];
    await check("R4 describeCoverSplit never adds SGD to USD under one cover", () => {
      const split = describeCoverSplit(mixed()) ?? "";
      assert.ok(!/120,000/.test(split), "split summed across currencies: " + split);
    });
    await check("R4 applyPolicyAggregateCaps never caps a USD row against an SGD running total", () => {
      // Coordinator decision: a cover whose rows state different currencies
      // is never capped (or added) across them, and is not capped per currency
      // either -- that could still pay past a single-currency sum insured. Every
      // figure under that cover is withheld (fail closed) with a stated reason.
      const items = mixed(); applyPolicyAggregateCaps(items);
      const detail = JSON.stringify(items.map((i) => [i.currency, i.calculatedAmount ?? null, i.supersededBy ?? null, i.conditions.slice(-1)[0] ?? ""]));
      assert.ok(items.slice(0, 2).every((i) => i.calculatedAmount === undefined && i.amountText === null), "a mixed-currency cover still shows figures: " + detail);
      assert.ok(items.slice(0, 2).every((i) => !i.conditions.some((c) => /^Reduced from/.test(c)) && !i.supersededBy), "reduced/superseded across currencies: " + detail);
      assert.ok(items.slice(0, 2).every((i) => i.conditions.some((c) => /do not all state the same currency/.test(c))), "withheld without saying why: " + detail);
    });
    await check("R4 addLedgerRow never defaults a missing currency to SGD", async () => {
      let stored: string | null | undefined;
      try { stored = (await addLedgerRow(A, { familyMemberId: pa.id, policyId: null, planName: "No currency given", eventType: "death", paysKind: "lump_sum", amount: 700 }))?.currency; }
      catch { stored = undefined; /* refusing is an acceptable outcome */ }
      assert.notEqual(stored, "SGD", "a figure entered with no currency was stored as SGD");
    });
    await check("R4 seedLedger never labels a rule SGD when neither the rule nor the cover states a currency", async () => {
      await db.query("UPDATE policy_coverages SET currency=NULL WHERE policy_id=$1", [NULLP]);
      await db.query("DELETE FROM coverage_rules WHERE policy_id=ANY($1::uuid[])", [[NULLP, USD]]);
      await seedLedger(A, [pa]);
      // Positive control: a rule whose currency IS stated (USD) is seeded with that currency.
      const usd = (await db.query<{ currency: string }>("SELECT currency FROM coverage_rules WHERE policy_id=$1 AND origin='wording'", [USD])).rows;
      assert.ok(usd.length > 0 && usd.every((r) => r.currency === "USD"), "stated-currency rule seeded as USD: " + JSON.stringify(usd));
      const rows = (await db.query<{ currency: string; amount: string | null }>("SELECT currency,amount::text FROM coverage_rules WHERE policy_id=$1", [NULLP])).rows;
      assert.deepEqual(rows.filter((r) => r.currency === "SGD"), [], "a rule with no stated currency labelled SGD: " + JSON.stringify(rows));
    });

    // ------------------------------------------------ R5 + R1/R2 end to end through the chat route
    let lastNarrationPacket = "";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (/googleapis\.com\/v1beta\/models\?/.test(url)) return Response.json({ models: [{ name: "models/gemini-3.6-flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-3.5-flash-lite", supportedGenerationMethods: ["generateContent"] }] });
      if (!/googleapis\.com/.test(url)) throw new Error("Unexpected request: " + url);
      const body = JSON.parse(String(init?.body));
      const system = String(body.systemInstruction.parts[0].text), user = JSON.parse(String(body.contents[0].parts[0].text));
      let result: unknown;
      if (system.startsWith("Interpret this")) {
        const message: string = user.currentMessage, subject = user.subjects[0]?.id;
        const fact = (key: string, value: unknown, quote: string) => ({ subjectId: subject, key, value, state: "known", quote });
        const hypothetical = /\bif\b/i.test(message);
        result = hypothetical
          ? { intent: "policy_question", newTopic: false, searchTerms: ["hospital", "bill"], facts: [], scenarioCandidates: [] }
          : { intent: "claim", newTopic: false, searchTerms: ["hospital", "bill"],
            facts: [fact("eventType", "diagnosis", "dengue"), fact("diagnosis", "dengue", "dengue"), fact("hospitalised", true, "hospitalised"), fact("hospitalNights", 3, "3 nights"), fact("hospitalBill", 5000, "S$5,000")],
            scenarioCandidates: [{ subjectId: subject, label: "Dengue hospital stay", family: "illness", traits: ["illness", "diagnosis", "hospitalisation", "medical_expense"], quote: "dengue" }] };
      } else if (system.startsWith("Read insurance")) result = { benefits: [], observations: [], nextSteps: [] };
      else if (system.startsWith("You decide which of a person")) result = { applies: (user.candidates as { name: string }[]).map((c) => ({ name: c.name, why: "responds" })), ruledOut: [] };
      else if (system.startsWith("Check coverage ledger rows")) result = { verdicts: (user.rows as { index: number }[]).map((r) => ({ index: r.index, supported: true })) };
      else if (system.startsWith("Build the coverage ledger")) result = { rows: [] };
      else if (system.startsWith("List the insurance benefits")) result = { benefits: [] };
      else if (system.startsWith("You are given rows recovered")) result = { rows: [] };
      else {
        // An adversarial narrator: repeats the household's own figure as if it were a payout.
        lastNarrationPacket = JSON.stringify(user);
        result = { summary: "Your hospital bill of S$5,000 is covered, so you can claim S$5,000 back from your policy.", details: ["The policy pays the S$5,000 bill in full."] };
      }
      return Response.json({ modelVersion: "gemini-3.6-flash", responseId: "r", candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 } });
    }) as typeof fetch;
    process.env.MODEL_PRESET = "gemini"; process.env.GEMINI_API_KEY = "AQ.test-key"; process.env.DEV_AUTH_ENABLED = "1";
    const send = async (account: string, member: string, question: string) => {
      process.env.DEV_ACCOUNT_ID = account;
      const response = await POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ familyMemberId: member, scope: "member", question, asynchronous: false, timeZone: "Asia/Singapore" }) }));
      const data = await response.json();
      assert.equal(response.status, 200, JSON.stringify(data).slice(0, 400));
      return data.answer as ChatAnswer;
    };
    const noAssertedAmount = (answer: ChatAnswer, where: string) => {
      const money = /(?:S\$|SGD|\$)\s?5,?000|5,?000(?:\.00)?\s?(?:SGD|dollars)/i;
      const shown = [answer.summary, ...answer.details, ...answer.nextSteps, ...answer.missingFacts,
        ...answer.claimItems.flatMap((i) => [i.amountText ?? "", i.reason, ...i.conditions])].join(" | ");
      assert.ok(!money.test(shown), where + ": the household's own S$5,000 appears as an answer figure: " + shown.slice(0, 600));
      assert.deepEqual(answer.potentialPayoutTotals ?? [], [], where + ": totals");
      assert.deepEqual(answer.claimItems.filter((i) => typeof i.calculatedAmount === "number").map((i) => i.title), [], where + ": calculated amounts");
      assert.deepEqual((answer.policyStatedLimits ?? []).filter((l) => JSON.stringify(l).includes("5,000") || JSON.stringify(l).includes("5000")), [], where + ": a 5,000 policy-stated limit");
    };
    const echoes: string[] = [];
    await check("R5 chat, household with no documents: \"the bill was S$5,000\" produces no amount", async () => {
      const answer = await send(C, pc.id, "I was hospitalised for dengue for 3 nights and the bill was S$5,000. How much can I claim?");
      noAssertedAmount(answer, "claim, no documents");
      assert.equal(answer.citations.length, 0, "no document, so nothing may be cited: " + JSON.stringify(answer.citations));
      if (answer.knownFacts.some((f) => /5,?000/.test(f))) echoes.push("knownFacts (no documents): " + answer.knownFacts.join("; "));
    });
    await check("R5 chat, household with no documents, what-if: \"if the bill was S$5,000\" produces no amount", async () => {
      const answer = await send(C, pc.id, "What if the hospital bill was S$5,000, how much would my policy pay?");
      noAssertedAmount(answer, "what-if, no documents");
      assert.equal(answer.citations.length, 0, "no document, so nothing may be cited");
    });
    let claimA: ChatAnswer | null = null;
    await check("R5 chat, household with policies and a household-entered ledger figure: the asserted S$5,000 produces no amount", async () => {
      claimA = await send(A, pa.id, "I was hospitalised for dengue for 3 nights and the bill was S$5,000. How much can I claim?");
      noAssertedAmount(claimA, "claim, household A");
      if (claimA.knownFacts.some((f) => /5,?000/.test(f))) echoes.push("knownFacts (household A): " + claimA.knownFacts.join("; "));
    });
    await check("R1/R2/R3 chat answer citations point at the stored page of a current, own-household document", async () => {
      assert.ok(claimA, "chat answer available");
      await verifyCitations(claimA!.citations, "chat citations (mode=" + claimA!.mode + ", " + claimA!.citations.length + " citations)");
    });
    await check("R2/R3 chat answer never shows a claim card from a deleted, superseded or other-household document", () => {
      assert.ok(claimA, "chat answer available");
      const text = JSON.stringify(claimA);
      assert.deepEqual(markers(text).filter((m) => ["DELMARKER", "SOFTMARKER", "OLDMARKER", "BMARKER"].includes(m)), [], "answer mentions a forbidden document: " + claimA!.claimItems.map((i) => i.title).join(" | "));
    });
    await check("R2/R3 the narration model is never shown a deleted, superseded or other-household document", () => {
      assert.deepEqual(markers(lastNarrationPacket).filter((m) => ["DELMARKER", "SOFTMARKER", "OLDMARKER", "BMARKER"].includes(m)), []);
    });
    if (echoes.length) console.log("NOTE (not a failure): household-reported figure echoed as a recorded fact label:\n  " + echoes.join("\n  "));
  } finally {
    pool.query = originalQuery; pool.connect = originalConnect; globalThis.fetch = originalFetch; await db.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nV1 retrieval & citation regressions: ${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) { console.log("FAILED:\n- " + failed.map((f) => f.name).join("\n- ")); process.exitCode = 1; }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
