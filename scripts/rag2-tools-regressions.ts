/**
 * Conversational RAG, Prompt 1: the common retrieval tools in lib/rag2 (npm run rag2:tools-test).
 *
 * PGlite with the real schema and this suite's own synthetic household (scripts/fixtures/rag2/household.ts). Final
 * values AND their evidence (page, row, column header, passage offsets) are asserted, with positive controls and
 * negatives:
 *  F  flag: default off, refused in a production build unless explicitly allowed; runTool refuses while off; nothing
 *     outside lib/rag2 imports it (the existing chat path is unchanged with the flag off).
 *  E  evidence: exact-span locate, whitespace-tolerant locate returns the page's own slice, toFigureBinding.
 *  S  search / readPage: household-scoped, active + released + current only, offsets verbatim.
 *  P  resolvePerson: names, relations incl. step / in-law / helper, pronouns from context, ambiguity, never a silent pick.
 *  C  policiesFor: insured vs owner-only / nominee / non-person cover, in-force, endorsement version, enrolment.
 *  T  tables: subject's column before the value (PA Insured Adult / Insured Child + physio sub-limit), CI Amount column
 *     (never the % or condition column), group booklet Employee / Spouse / Child + enrolment confirmation, endorsement
 *     changing a sum assured, reordered columns, repeated identical values, merged headings, missing headers,
 *     multi-page tables.
 *  K  compute: integer cents, ppm percentages, rounding stated, mixed currencies refused, estimates never in totals,
 *     printed_limit vs indicative_estimate, ComputationRecord accepted by the existing save-time gate.
 *  G  gate: bindings from these tools pass lib/chat/answer-verification.ts verifyAnswerFigures; wrong ones do not.
 *  R  registry: schemas, household scoping, value ids only from this context.
 * Every check runs; exit 1 if any failed.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ACCOUNT, DOCS, M, OTHER_ACCOUNT, type FxDoc } from "./fixtures/rag2/household";

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 8).join("\n     ")); }
}
const doc = (key: string): FxDoc => DOCS.find((d) => d.key === key)!;

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && !e.name.startsWith(".")) out.push(...(await walk(full))); }
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) out.push(full);
  }
  return out;
}

async function main() {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite/vector");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { pool } = await import("@/lib/db/client");
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of ["schema.sql", "chat-upgrade.sql", "benefit-catalog.sql", "model-usage.sql", "model-provenance.sql", "coverage-ledger.sql", "cover-conditions.sql", "background-jobs.sql", "household-rls.sql", "lifecycle.sql", "v11-ingestion-evidence.sql"])
    await db.exec(await readFile(path.resolve("sql/" + file), "utf8"));
  const execute = async (text: string, params: unknown[] = []) => { const r = await db.query(text, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; };
  pool.query = (async (text: string, params: unknown[] = []) => execute(text, params)) as typeof pool.query;
  pool.connect = (async () => ({ query: execute, release() {} })) as unknown as typeof pool.connect;

  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Household R2'),($2,'Other household')", [ACCOUNT, OTHER_ACCOUNT]);
  for (const p of Object.values(M)) await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship,notes,date_of_birth) VALUES($1,$2,$3,$4,$5,$6,$7)", [p.id, (p as { account?: string }).account ?? ACCOUNT, p.name, p.pref, p.rel, p.notes, p.dob]);
  for (const d of DOCS) {
    const acct = d.account ?? ACCOUNT;
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,group_policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,superseded_at,file_hash,effective_date,renewal_or_expiry_date,document_date)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ready',$11,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [d.id, acct, d.owner, d.insurer, d.product, d.policyNumber, d.groupPolicyNumber ?? null, d.policyType, d.role, d.personal, d.key.toLowerCase() + ".pdf", d.quarantine ?? "scan_clean", d.lifecycle ?? "active", d.superseded ? new Date().toISOString() : null, d.hash, d.effective ?? null, d.expiry ?? null, d.documentDate ?? null]);
    for (const m of d.members) await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence,benefit_tier) VALUES($1,$2,$3,'test',1,$4)", [d.id, m.id, acct, m.tier ?? null]);
    for (const [page, text] of Object.entries(d.pages)) await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [acct, d.id, Number(page), text]);
  }

  const flag = await import("@/lib/rag2/flag");
  const E = await import("@/lib/rag2/evidence");
  const S = await import("@/lib/rag2/search");
  const P = await import("@/lib/rag2/people");
  const C = await import("@/lib/rag2/policies");
  const T = await import("@/lib/rag2/tables");
  const K = await import("@/lib/rag2/compute");
  const R = await import("@/lib/rag2/tools");
  const { verifyAnswerFigures } = await import("@/lib/chat/answer-verification");
  const ASOF = "2026-10-08";
  const page = (key: string, n: number) => doc(key).pages[n];
  /** The evidence's passage is exactly the stored page's slice, on the page and doc stated. */
  const exact = (ev: import("@/lib/rag2/evidence").EvidenceRef, key: string) => {
    assert.equal(ev.policyId, doc(key).id, "evidence names another document");
    assert.equal(ev.documentHash, doc(key).hash, "evidence names another version");
    const text = page(key, ev.passage.onPage);
    assert.ok(text != null, "evidence names a page that is not stored");
    assert.equal(text.slice(ev.passage.start, ev.passage.end), ev.passage.text, "passage offsets are not the stored text");
    if (ev.table?.cell) assert.equal(text.slice(ev.table.cell.start, ev.table.cell.end), ev.table.cell.text, "cell offsets are not the stored text");
    assert.ok(ev.page.start <= ev.passage.onPage && ev.passage.onPage <= ev.page.end, "the passage page is outside the page range");
  };
  const value = async (key: string, benefit: string, member: string, want: import("@/lib/rag2/tables").Want = "any", extra: Record<string, unknown> = {}) =>
    T.selectTableValue({ accountId: ACCOUNT, policyId: doc(key).id, benefit, subject: { memberId: member, ...(extra as object) }, want, asOf: (extra.asOf as string) ?? ASOF });
  const okv = (r: import("@/lib/rag2/tables").TableSelection) => { assert.equal(r.status, "ok", "expected ok, got " + JSON.stringify(r).slice(0, 400)); return r as import("@/lib/rag2/tables").SelectedValue; };
  /** The row line the value cell is on, and the cell's offset within the page (independently computed). */
  const cellAt = (key: string, pageNo: number, rowStartsWith: string, cellText: string, nth = 0) => {
    const text = page(key, pageNo);
    const lines = text.split("\n");
    let at = 0;
    for (const l of lines) { if (l.trimStart().startsWith(rowStartsWith)) { let k = -1; for (let i = 0; i <= nth; i++) k = l.indexOf(cellText, k + 1); assert.ok(k >= 0, "fixture row lacks the cell"); return { lineStart: at, line: l, cellStart: at + k }; } at += l.length + 1; }
    throw new Error("fixture row not found: " + rowStartsWith);
  };

  // ---------------------------------------------------------------- F: flag
  await check("F1 flag is off by default, on with DEARPOLICY_RAG_TOOLS=1 outside production", () => {
    assert.equal(flag.ragToolsEnabled({} as NodeJS.ProcessEnv), false);
    assert.equal(flag.ragToolsEnabled({ DEARPOLICY_RAG_TOOLS: "0" } as unknown as NodeJS.ProcessEnv), false);
    assert.equal(flag.ragToolsEnabled({ DEARPOLICY_RAG_TOOLS: "1", NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv), true);
  });
  await check("F2 flag is refused in a production build unless explicitly allowed", () => {
    assert.equal(flag.ragToolsEnabled({ DEARPOLICY_RAG_TOOLS: "1", NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv), false);
    assert.equal(flag.ragToolsEnabled({ DEARPOLICY_RAG_TOOLS: "1", VERCEL_ENV: "preview", NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv), false);
    assert.equal(flag.ragToolsEnabled({ DEARPOLICY_RAG_TOOLS: "1", NODE_ENV: "production", DEARPOLICY_RAG_TOOLS_ALLOW_PRODUCTION: "1" } as unknown as NodeJS.ProcessEnv), true);
    assert.equal(flag.ragToolsEnabled({ DEARPOLICY_RAG_TOOLS_ALLOW_PRODUCTION: "1", NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv), false);
  });
  await check("F3 runTool refuses every tool while the flag is off", async () => {
    const ctx = R.createToolContext({ accountId: ACCOUNT });
    const r = await R.runTool(ctx, "search_passages", { query: "physiotherapy" }, {} as NodeJS.ProcessEnv);
    assert.equal(r.ok, false); assert.match((r as { error: string }).error, /switched off/);
  });
  await check("F4 nothing outside lib/rag2 and its own suite imports lib/rag2 (flag off = existing chat path untouched)", async () => {
    const files = [...(await walk(path.resolve("app"))), ...(await walk(path.resolve("lib"))), ...(await walk(path.resolve("scripts"))), ...["middleware.ts", "instrumentation.ts"].map((f) => path.resolve(f))];
    const offenders: string[] = [];
    for (const f of files) {
      const rel = path.relative(path.resolve("."), f);
      if (rel.startsWith("lib/rag2/") || /^scripts\/rag2-/.test(rel) || rel.startsWith("scripts/fixtures/rag2/")) continue;
      const text = await readFile(f, "utf8").catch(() => "");
      if (/lib\/rag2\b|["']\.\.?\/rag2\//.test(text)) offenders.push(rel);
    }
    assert.deepEqual(offenders, []);
    const env = await readFile(path.resolve(".env.example"), "utf8");
    assert.match(env, /^# DEARPOLICY_RAG_TOOLS=/m); assert.match(env, /^# DEARPOLICY_RAG_TOOLS_ALLOW_PRODUCTION=/m);
  });

  // ---------------------------------------------------------------- E: evidence
  await check("E1 locate finds the exact span, the nearest repeat, and re-flowed whitespace as the page's own slice", () => {
    const text = page("PA", 1);
    const s = E.locate("Mobility aids", text)!;
    assert.equal(text.slice(s.start, s.end), "Mobility aids");
    const all = E.locateAll("S$500", text);
    assert.ok(all.length >= 3, "S$500 is printed three times");
    const near = E.locate("S$500", text, all[2].start - 1)!;
    assert.equal(near.start, all[2].start);
    const reflow = E.locate("Accidental medical expenses is an aggregate\n limit per insured person", text)!;
    assert.equal(reflow.text, text.slice(reflow.start, reflow.end));
    assert.match(reflow.text, /aggregate limit per insured person/);
    assert.equal(E.locate("S$9,999", text), null, "a passage that is not printed is not located");
  });
  await check("E2 toFigureBinding needs a person and a passage that prints the value", () => {
    const ev = E.evidenceFor({ policyId: doc("CI").id, documentHash: doc("CI").hash, page: 1, pageText: page("CI", 1), passage: "Severe\tMajor cancer, heart attack, stroke (severe stage)\t100%\tS$150,000", subjectId: M.melissa.id, table: { tableId: "x", rowLabel: "Severe", columnHeader: "Amount payable", columnLeaf: "Amount payable", appliesTo: null } })!;
    assert.ok(ev);
    const b = E.toFigureBinding(ev, "Severe", 150000, "SGD")!;
    assert.deepEqual([b.policyId, b.subjectId, b.pageStart, b.pageEnd, b.column, b.documentHash], [doc("CI").id, M.melissa.id, 1, 1, "Amount payable", doc("CI").hash]);
    assert.equal(E.toFigureBinding(ev, "Severe", 75000, "SGD"), null, "a value the passage does not print gets no binding");
    assert.equal(E.toFigureBinding({ ...ev, subjectId: null }, "Severe", 150000, "SGD"), null, "no person, no binding");
    assert.ok(E.verifyEvidence(ev, page("CI", 1)));
    assert.equal(E.verifyEvidence({ ...ev, passage: { ...ev.passage, start: ev.passage.start + 1 } }, page("CI", 1)), false);
  });

  // ---------------------------------------------------------------- S: search / readPage
  await check("S1 searchPassages ranks the physiotherapy passages, with verbatim offsets", async () => {
    const r = await S.searchPassages({ accountId: ACCOUNT, query: "physiotherapy TCM", k: 5 });
    assert.ok(r.hits.length >= 2);
    assert.equal(r.hits[0].policyId, doc("PA").id);
    for (const h of r.hits) { exact(h.evidence, DOCS.find((d) => d.id === h.policyId)!.key); assert.ok(h.text.toLowerCase().includes("physiotherapy")); }
  });
  await check("S2 deleted, pending, superseded and other households' documents are never searched or read", async () => {
    const r = await S.searchPassages({ accountId: ACCOUNT, query: "Zephyr Zephyrine physiotherapy session", k: 20 });
    for (const bad of ["DELETED", "PENDING", "OLD", "FOREIGN"]) assert.ok(!r.hits.some((h) => h.policyId === doc(bad).id), bad + " was searched");
    assert.ok(!r.searchedPolicyIds.some((x) => ["DELETED", "PENDING", "OLD", "FOREIGN"].map((k) => doc(k).id).includes(x)));
    for (const bad of ["DELETED", "PENDING", "OLD", "FOREIGN"]) assert.equal((await S.readPage({ accountId: ACCOUNT, policyId: doc(bad).id, page: 1 })).status, "missing", bad + " was read");
    const other = await S.searchPassages({ accountId: OTHER_ACCOUNT, query: "physiotherapy", k: 20 });
    assert.ok(other.hits.every((h) => h.policyId === doc("FOREIGN").id), "the other household sees only its own document");
  });
  await check("S3 subject filter: Jun Hao's documents only; readPage returns the whole stored page", async () => {
    const r = await S.searchPassages({ accountId: ACCOUNT, query: "cancer stage", subjectId: M.junhao.id, k: 10 });
    assert.ok(!r.hits.some((h) => h.policyId === doc("CI").id), "Melissa's CI policy searched for Jun Hao");
    const p = await S.readPage({ accountId: ACCOUNT, policyId: doc("PA").id, page: 2 });
    assert.equal(p.status, "ok");
    if (p.status === "ok") { assert.equal(p.text, page("PA", 2)); assert.equal(p.pageCount, 2); exact(p.evidence, "PA"); }
    assert.equal((await S.readPage({ accountId: ACCOUNT, policyId: doc("PA").id, page: 9 })).status, "missing");
  });

  // ---------------------------------------------------------------- P: people
  const person = (mention: string, ctx: import("@/lib/rag2/people").ConversationContext | null = null) => P.resolvePerson({ accountId: ACCOUNT, mention, conversationContext: ctx });
  const okp = async (mention: string, want: string, ctx: import("@/lib/rag2/people").ConversationContext | null = null) => { const r = await person(mention, ctx); assert.equal(r.status, "ok", mention + " -> " + JSON.stringify(r).slice(0, 300)); assert.equal((r as { person: { id: string } }).person.id, want, mention); };
  await check("P1 names, preferred names, self words and relations resolve to one member", async () => {
    await okp("Yi Xuan", M.yixuan.id); await okp("Koh Jun Hao", M.junhao.id); await okp("me", M.darren.id); await okp("my wife", M.melissa.id);
    await okp("my daughter", M.yixuan.id); await okp("my son", M.junhao.id); await okp("my stepson", M.ryan.id); await okp("my mother-in-law", M.ahmui.id);
    await okp("my wife's mother", M.ahmui.id); await okp("our helper", M.rosalind.id); await okp("my daughter Yi Xuan", M.yixuan.id);
  });
  await check("P2 never a silent pick: ambiguous names, step/in-law near-misses and missing relations ask", async () => {
    const hao = await person("Hao");
    assert.equal(hao.status, "ambiguous"); assert.deepEqual((hao as { options: { id: string }[] }).options.map((o) => o.id).sort(), [M.junhao.id, M.ryan.id].sort());
    const kids = await person("my child");
    assert.equal(kids.status, "ambiguous"); assert.ok((kids as { question: string }).question.length > 10);
    const mum = await person("my mother");
    assert.equal(mum.status, "ambiguous", "a mother-in-law is not silently 'my mother'"); assert.deepEqual((mum as { options: { id: string }[] }).options.map((o) => o.id), [M.ahmui.id]);
    const husband = await person("my husband");
    assert.notEqual(husband.status, "ok");
    const ryanAsSon = await person("my son Ryan");
    assert.equal(ryanAsSon.status, "ambiguous", "a stepson named as 'my son' is asked about, not picked");
    const nobody = await person("Uncle Bernard");
    assert.equal(nobody.status, "unknown");
    const foreign = await person("Okafor Bright Chidi");
    assert.equal(foreign.status, "unknown", "another household's member is never resolved");
  });
  await check("P3 pronouns come from the conversation; a mismatch or no context asks", async () => {
    await okp("she", M.yixuan.id, { lastSubjectId: M.yixuan.id });
    await okp("him", M.junhao.id, { lastSubjectId: M.junhao.id });
    assert.equal((await person("she")).status, "ambiguous", "no context: ask");
    assert.equal((await person("he", { lastSubjectId: M.yixuan.id })).status, "ambiguous", "he for a daughter: ask");
    await okp("my", M.darren.id, { speakerId: M.darren.id });
  });

  // ---------------------------------------------------------------- C: policiesFor
  await check("C1 Darren: insured documents listed; the motor certificate is not person cover", async () => {
    const r = await C.policiesFor({ accountId: ACCOUNT, subjectId: M.darren.id, asOf: ASOF });
    const covering = r.covering.map((p) => p.policyId);
    for (const k of ["PA", "TERM", "CASH", "DENTAL", "GHS"]) assert.ok(covering.includes(doc(k).id), k + " missing from Darren's cover: " + JSON.stringify(r.covering.map((p) => p.productName)));
    for (const k of ["ENDT", "ENROL"]) assert.ok(!covering.includes(doc(k).id), k + " listed as its own policy");
    const motor = r.notCovering.find((p) => p.policyId === doc("MOTOR").id)!;
    assert.ok(motor && motor.insures === "motor" && motor.reasons.some((x) => /motor/.test(x)));
    const helper = r.notCovering.find((p) => p.policyId === doc("HELPER").id)!;
    assert.ok(helper && helper.role === "owner_only", "the employer of an insured helper is not insured: " + JSON.stringify(helper && [helper.role, helper.reasons]));
    assert.ok(!r.covering.some((p) => p.policyId === doc("HELPER").id));
    const pa = r.covering.find((p) => p.policyId === doc("PA").id)!;
    assert.equal(pa.inForce.status, "in_force"); assert.equal(pa.inForce.from, "2026-03-01"); assert.equal(pa.inForce.to, "2027-02-28");
    for (const ev of pa.evidence) exact(ev, "PA");
  });
  await check("C2 endorsement version: TermSecure is current as amended on 01 Jul 2026 (pending before that date)", async () => {
    const r = await C.policiesFor({ accountId: ACCOUNT, subjectId: M.darren.id, asOf: ASOF });
    const term = r.covering.find((p) => p.policyId === doc("TERM").id)!;
    assert.equal(term.version.amendments.length, 1); assert.equal(term.version.amendments[0].effectiveDate, "2026-07-01"); assert.equal(term.version.amendments[0].inForce, true);
    assert.match(term.version.current, /2026-07-01/);
    exact(term.version.amendments[0].evidence!, "ENDT");
    const before = await C.policiesFor({ accountId: ACCOUNT, subjectId: M.darren.id, asOf: "2026-06-01" });
    const t2 = before.covering.find((p) => p.policyId === doc("TERM").id)!;
    assert.equal(t2.version.amendments[0].inForce, false); assert.match(t2.version.current, /as issued/);
  });
  await check("C3 group booklet: Melissa enrolled (enrolment confirmation evidence); Jun Hao not listed under it", async () => {
    const mel = await C.policiesFor({ accountId: ACCOUNT, subjectId: M.melissa.id, asOf: ASOF });
    const ghs = mel.covering.find((p) => p.policyId === doc("GHS").id)!;
    assert.ok(ghs, "booklet missing for Melissa"); assert.equal(ghs.version.enrolment?.policyId, doc("ENROL").id);
    exact(ghs.version.enrolment!.evidence!, "ENROL"); assert.match(ghs.version.enrolment!.evidence!.passage.text, /Melissa Teo Shu Hui\s+Spouse/);
    const jun = await C.policiesFor({ accountId: ACCOUNT, subjectId: M.junhao.id, asOf: ASOF });
    assert.ok(!jun.covering.some((p) => p.policyId === doc("GHS").id));
    assert.ok(jun.covering.some((p) => p.policyId === doc("CASH").id) && jun.covering.some((p) => p.policyId === doc("PA").id));
  });
  await check("C4 nominee is not insured; expired helper cover says when it ended; topic ordering", async () => {
    const mel = await C.policiesFor({ accountId: ACCOUNT, subjectId: M.melissa.id, asOf: ASOF, topic: "critical illness cancer" });
    const legacy = mel.notCovering.find((p) => p.policyId === doc("LEGACY").id)!;
    assert.ok(legacy, "the nominee's policy is reported, as not covering"); assert.equal(legacy.role, "nominee"); assert.equal(legacy.covered, false);
    assert.ok(!mel.covering.some((p) => p.policyId === doc("LEGACY").id));
    assert.equal(mel.covering[0].policyId, doc("CI").id, "the topic's policy comes first");
    const rosa = await C.policiesFor({ accountId: ACCOUNT, subjectId: M.rosalind.id, asOf: ASOF });
    const helper = rosa.notCovering.find((p) => p.policyId === doc("HELPER").id)!;
    assert.equal(helper.inForce.status, "expired"); assert.ok(helper.reasons.some((x) => /ended on 2024-12-31/.test(x)));
    const ahmui = await C.policiesFor({ accountId: ACCOUNT, subjectId: M.ahmui.id, asOf: ASOF });
    assert.ok(ahmui.covering.some((p) => p.policyId === doc("LEGACY").id), "the life assured is covered");
    assert.ok(ahmui.undetermined.length >= 1, "what cannot be determined is reported");
  });

  // ---------------------------------------------------------------- T: tables
  await check("T1 PA: a child resolves to the Insured Child column (physio S$300, AME S$1,500), adult to Insured Adult", async () => {
    const yx = okv(await value("PA", "physiotherapy", M.yixuan.id));
    assert.deepEqual([yx.value, yx.currency, yx.columnHeader, yx.rowLabel], [300, "SGD", "Insured Child", "of which physiotherapy / TCM"]);
    assert.equal(yx.columnBasis.basis, "document"); exact(yx.columnBasis.evidence!, "PA"); assert.match(yx.columnBasis.evidence!.passage.text, /Koh Yi Xuan\s+Insured Child/);
    assert.ok(yx.conditions.some((c) => /sub-limit within “Accidental medical expenses/.test(c)));
    exact(yx.evidence, "PA");
    const at = cellAt("PA", 1, "of which physiotherapy", "S$300");
    assert.equal(yx.evidence.passage.start, at.lineStart); assert.equal(yx.evidence.table!.cell!.start, at.cellStart);
    assert.equal(yx.evidence.passage.onPage, 1); assert.equal(yx.evidence.table!.rowLabel, "of which physiotherapy / TCM");
    const ame = okv(await value("PA", "accidental medical expenses", M.yixuan.id, "amount"));
    assert.deepEqual([ame.value, ame.columnHeader, ame.period], [1500, "Insured Child", "policy_year"]);
    const mel = okv(await value("PA", "physiotherapy", M.melissa.id));
    assert.deepEqual([mel.value, mel.columnHeader], [500, "Insured Adult"]);
    const ryan = okv(await value("PA", "accidental death", M.ryan.id));
    assert.deepEqual([ryan.value, ryan.columnHeader], [50000, "Insured Child"], "the stepson is listed as Insured Child by the document itself");
  });
  await check("T2 repeated identical values: offsets point at the asked row and column, never the first S$300 / S$500 on the page", async () => {
    const amb = okv(await value("PA", "ambulance fees", M.yixuan.id));
    const at = cellAt("PA", 1, "Ambulance fees", "S$300", 1);
    assert.equal(amb.evidence.table!.cell!.start, at.cellStart, "the child column's S$300, not the adult's");
    const physio = okv(await value("PA", "physiotherapy", M.yixuan.id));
    assert.notEqual(physio.evidence.table!.cell!.start, amb.evidence.table!.cell!.start);
    const mob = okv(await value("PA", "mobility aids", M.melissa.id));
    assert.equal(mob.evidence.table!.cell!.start, cellAt("PA", 1, "Mobility aids", "S$500").cellStart);
    assert.notEqual(mob.evidence.table!.cell!.start, page("PA", 1).indexOf("S$500"));
    const cash = okv(await value("PA", "hospital cash", M.junhao.id));
    assert.deepEqual([cash.value, cash.period, cash.columnHeader], [100, "day", "Insured Child"]);
    assert.ok(cash.conditions.includes("max 30 days"));
  });
  await check("T3 never a number elsewhere on the page: a benefit printed only in prose is missing", async () => {
    const r = await value("PA", "fracture", M.yixuan.id);
    assert.equal(r.status, "missing", JSON.stringify(r).slice(0, 300));
    const none = await value("PA", "dental implants", M.yixuan.id);
    assert.equal(none.status, "missing");
  });
  await check("T4 CI: amounts come from the Amount payable column; % from the % column; the condition column is never a value", async () => {
    const sev = okv(await value("CI", "severe stage", M.melissa.id, "amount"));
    assert.deepEqual([sev.value, sev.currency, sev.columnHeader, sev.rowLabel], [150000, "SGD", "Amount payable", "Severe"]);
    const at = cellAt("CI", 1, "Severe", "S$150,000");
    assert.equal(sev.evidence.table!.cell!.start, at.cellStart); assert.notEqual(at.cellStart, page("CI", 1).indexOf("S$150,000"), "the Sum assured line prints the same figure first");
    exact(sev.evidence, "CI");
    assert.ok(sev.conditions.some((c) => /^Condition group: Major cancer/.test(c)) && sev.conditions.some((c) => /^%: 100%/.test(c)));
    const early = okv(await value("CI", "early stage cancer", M.melissa.id));
    assert.deepEqual([early.value, early.columnHeader], [37500, "Amount payable"]);
    const pct = okv(await value("CI", "intermediate", M.melissa.id, "percent"));
    assert.deepEqual([pct.value, pct.ppm, pct.columnHeader], [50, 500000, "%"]);
    const angio = okv(await value("CI", "angioplasty", M.melissa.id, "amount"));
    assert.equal(angio.value, 15000);
    const cnt = await value("CI", "severe stage", M.melissa.id, "count");
    assert.notEqual(cnt.status, "ok", "no count column: the condition column is not read as one");
    const notHers = await value("CI", "severe stage", M.yixuan.id);
    assert.equal(notHers.status, "missing", "a document that does not insure the person gives no value for them");
  });
  await check("T5 group booklet: Employee / Spouse / Child by enrolment; multi-page table under a repeated header", async () => {
    const mel = okv(await value("GHS", "daily room & board", M.melissa.id));
    assert.deepEqual([mel.value, mel.columnHeader, mel.columnBasis.basis], [400, "Spouse", "document"]);
    exact(mel.columnBasis.evidence!, "ENROL");
    const me = okv(await value("GHS", "room and board", M.darren.id));
    assert.deepEqual([me.value, me.columnHeader], [600, "Employee"]);
    const yx = okv(await value("GHS", "outpatient cancer treatment", M.yixuan.id));
    assert.deepEqual([yx.value, yx.columnHeader], [10000, "Child"]);
    assert.deepEqual([yx.evidence.page.start, yx.evidence.page.end, yx.evidence.passage.onPage], [1, 2, 2], "header on page 1, row on page 2");
    exact(yx.evidence, "GHS");
    const tables = T.parseTables(doc("GHS").id, [{ page: 1, text: page("GHS", 1) }, { page: 2, text: page("GHS", 2) }]);
    const t = tables.find((x) => x.rows.some((r) => r.label === "Outpatient cancer treatment"))!;
    assert.ok(t.continued && t.pageStart === 1 && t.pageEnd === 2 && t.rows.length === 5, JSON.stringify({ c: t.continued, s: t.pageStart, e: t.pageEnd, n: t.rows.length }));
    assert.equal((await value("GHS", "surgical fees", M.junhao.id)).status, "missing", "Jun Hao is not enrolled");
  });
  await check("T6 endorsement: the death sum assured is S$350,000 from 01 Jul 2026 (was S$500,000), evidence on the endorsement", async () => {
    const now = okv(await value("TERM", "death", M.darren.id));
    assert.deepEqual([now.value, now.columnHeader], [350000, "After"]);
    exact(now.evidence, "ENDT");
    assert.equal(now.amendedFrom!.value, 500000); exact(now.amendedFrom!.evidence, "TERM");
    const before = okv(await value("TERM", "death", M.darren.id, "any", { asOf: "2026-06-01" }));
    assert.equal(before.value, 500000); exact(before.evidence, "TERM"); assert.ok(before.notes.some((n) => /2026-07-01/.test(n)));
    const tpd = okv(await value("TERM", "total and permanent disability", M.darren.id));
    assert.equal(tpd.value, 350000);
    const prem = okv(await value("TERM", "annual premium", M.darren.id));
    assert.deepEqual([prem.value, prem.cents], [1380, 138000]);
  });
  await check("T7 reordered columns (Child before Adult) are read by header, not position", async () => {
    const jun = okv(await value("CASH", "hospital cash", M.junhao.id));
    assert.deepEqual([jun.value, jun.columnHeader, jun.period], [80, "Child", "day"]);
    assert.equal(jun.columnBasis.basis, "document", "the clause naming Jun Hao says (child)"); assert.match(jun.columnBasis.detail, /Koh Jun Hao \(child\)/);
    const dar = okv(await value("CASH", "hospital cash", M.darren.id));
    assert.deepEqual([dar.value, dar.columnHeader], [150, "Adult"]);
    const days = okv(await value("CASH", "maximum days per admission", M.junhao.id, "count"));
    assert.deepEqual([days.value, days.valueKind, days.unit], [30, "count", "day"]);
  });
  await check("T7b a table continued on the next page without a repeated header keeps its columns (Child S$50, page range 1-2)", async () => {
    const rec = okv(await value("CASH", "recuperation benefit", M.junhao.id));
    assert.deepEqual([rec.value, rec.columnHeader, rec.period], [50, "Child", "day"]);
    assert.deepEqual([rec.evidence.page.start, rec.evidence.page.end, rec.evidence.passage.onPage], [1, 2, 2]);
    exact(rec.evidence, "CASH");
    assert.ok(rec.conditions.some((c) => /^Maximum recuperation days: 10 day/.test(c)), "the tied day-count row is kept as a condition: " + JSON.stringify(rec.conditions));
    assert.equal(rec.evidence.table!.cell!.start, cellAt("CASH", 2, "Recuperation benefit", "S$50").cellStart);
    const adultDays = okv(await value("CASH", "maximum recuperation days", M.darren.id, "count"));
    assert.deepEqual([adultDays.value, adultDays.columnHeader], [14, "Adult"]);
  });
  await check("T8 merged headings: 'Insured Child' spanning 'Limit | Co-pay' -> child limit S$1,200, co-pay 10%; adult co-pay 20%", async () => {
    const lim = okv(await value("OUTPT", "outpatient fracture treatment", M.yixuan.id, "amount"));
    assert.deepEqual([lim.value, lim.columnHeader, lim.evidence.table!.columnLeaf], [1200, "Insured Child / Limit", "Limit"]);
    assert.equal(lim.evidence.table!.cell!.start, cellAt("OUTPT", 1, "Outpatient fracture", "S$1,200").cellStart);
    const cp = okv(await value("OUTPT", "outpatient fracture treatment", M.yixuan.id, "percent"));
    assert.deepEqual([cp.value, cp.columnHeader], [10, "Insured Child / Co-pay"]);
    const melcp = okv(await value("OUTPT", "fracture", M.melissa.id, "percent"));
    assert.deepEqual([melcp.value, melcp.columnHeader], [20, "Insured Adult / Co-pay"]);
  });
  await check("T9 missing headers: two unheaded value columns -> ambiguous with a question; a one-value list row -> ok", async () => {
    const r = await value("DENTAL", "fillings", M.darren.id);
    assert.equal(r.status, "ambiguous", JSON.stringify(r).slice(0, 300));
    if (r.status === "ambiguous") { assert.equal(r.options.length, 2); assert.match(r.question, /without column headings/); for (const o of r.options) exact(o.evidence!, "DENTAL"); }
    const lim = okv(await value("DENTAL", "annual dental limit", M.darren.id));
    assert.deepEqual([lim.value, lim.columnBasis.basis], [500, "only_column"]);
  });
  await check("T10 a person with no class on file and two candidate columns -> ambiguous, never a guess", async () => {
    // Ah Mui is not insured by the PA plan at all; a tier given explicitly is honoured; an unknown tier is not guessed.
    assert.equal((await value("PA", "physiotherapy", M.ahmui.id)).status, "missing");
    const t = okv(await value("OUTPT", "specialist consultation", M.yixuan.id, "amount", { tier: "Insured Adult" }));
    assert.equal(t.columnHeader, "Insured Adult / Limit", "an explicit tier wins");
    const hints = { memberId: "x", name: "X", names: ["X"], relation: "other", tier: null, recordedTier: null, isDocOwner: false, ownerIsSelf: false, age: null, namedLines: [] };
    const cols = T.parseTables("x", [{ page: 1, text: page("PA", 1) }]).find((tb) => tb.rows.some((r) => r.label === "Mobility aids"))!.columns.filter((c) => c.kind === "amount");
    const ch = T.chooseColumn(cols, hints);
    assert.ok("ambiguous" in ch, JSON.stringify(ch));
  });

  // ---------------------------------------------------------------- K: compute
  const operand = (v: import("@/lib/rag2/tables").SelectedValue): import("@/lib/rag2/compute").TableValueOperand => ({ kind: "table_value", benefit: v.rowLabel, valueKind: v.valueKind, cents: v.cents, ppm: v.ppm, count: v.valueKind === "count" ? v.value : null, currency: v.currency, period: v.period, evidence: v.evidence });
  await check("K1 printed limits: sum (CI early + special = S$52,500) and per-day x printed day cap (S$80 x 30 = S$2,400)", async () => {
    const early = okv(await value("CI", "early", M.melissa.id, "amount")), special = okv(await value("CI", "special", M.melissa.id, "amount"));
    const s = K.sum([operand(early), operand(special)], "CI early + special");
    assert.equal(s.status, "ok"); if (s.status !== "ok") return;
    assert.deepEqual([s.kind, s.cents, s.currency, s.rounding.source], ["printed_limit", 5250000, "SGD", "default"]);
    assert.ok(s.record && s.record.operation === "sum" && s.record.operands.length === 2 && s.record.result.value === 52500);
    assert.ok(s.steps.some((x) => /S\$37,500 .*\+ .*S\$15,000/.test(x)) && s.steps.some((x) => /half-up/.test(x)));
    const rate = okv(await value("CASH", "hospital cash", M.junhao.id)), days = okv(await value("CASH", "maximum days per admission", M.junhao.id, "count"));
    const p = K.perDay(operand(rate), operand(days), null, "Hospital cash for the longest stay");
    assert.equal(p.status, "ok"); if (p.status !== "ok") return;
    assert.deepEqual([p.kind, p.cents], ["printed_limit", 240000]); assert.ok(p.record && p.record.operation === "product" && p.record.factor === 30);
  });
  await check("K2 indicative estimates: household days with a day cap, deductible, co-insurance with cap; never called a payout", async () => {
    const rate = okv(await value("CASH", "hospital cash", M.junhao.id)), cap = okv(await value("CASH", "maximum days per admission", M.junhao.id, "count"));
    const stay = K.householdFigure("days in hospital", "he was in hospital for 45 days", { count: 45 });
    const e = K.perDay(operand(rate), stay, operand(cap));
    assert.equal(e.status, "ok"); if (e.status !== "ok") return;
    assert.deepEqual([e.kind, e.cents, e.record], ["indicative_estimate", 240000, null]); assert.ok(e.steps[0].includes("30"));
    const bill = K.householdFigure("specialist bill", "the bill was S$900", { amount: 900, currency: "SGD" });
    const pct = okv(await value("OUTPT", "outpatient fracture treatment", M.yixuan.id, "percent"));
    const co = K.coInsurance(bill, operand(pct), K.householdFigure("co-insurance cap", "my plan caps co-pay at S$50", { amount: 50, currency: "SGD" }));
    assert.equal(co.status, "ok"); if (co.status !== "ok") return;
    assert.deepEqual([co.kind, co.cents], ["indicative_estimate", 85000]);
    const ded = K.deductible(bill, K.householdFigure("deductible", "my deductible is S$1,000", { amount: 1000, currency: "SGD" }));
    assert.equal(ded.status, "ok"); if (ded.status === "ok") assert.equal(ded.cents, 0);
    for (const r of [e, co]) assert.ok(!JSON.stringify(r).toLowerCase().includes("payout"));
  });
  await check("K3 refusals: estimates never enter totals, mixed currencies, unattributed household figures, non-amount values", async () => {
    const rate = okv(await value("CASH", "hospital cash", M.junhao.id));
    const est = K.perDay(operand(rate), K.householdFigure("days", "four days", { count: 4 }));
    assert.equal(est.status, "ok");
    const t = K.sum([est as import("@/lib/rag2/compute").ComputeOk, operand(rate)]);
    assert.equal(t.status, "refused"); assert.match((t as { reason: string }).reason, /estimate never enters a total/);
    const usd = K.householdFigure("bill", "the bill was US$200", { amount: 200, currency: "USD" });
    assert.equal(K.sum([operand(rate), usd]).status, "refused");
    assert.equal(K.sum([operand(rate), K.householdFigure("bill", "  ", { amount: 10, currency: "SGD" })]).status, "refused");
    const pct = okv(await value("CI", "severe", M.melissa.id, "percent"));
    assert.equal(K.sum([operand(rate), operand(pct)]).status, "refused", "a percentage is not an amount");
    assert.equal(K.perDay(operand(okv(await value("CI", "severe", M.melissa.id, "amount"))), K.householdFigure("days", "3 days", { count: 3 })).status, "ok", "an unperiod amount may be multiplied");
  });
  await check("K4 integer-cent arithmetic and rounding: 0.1 + 0.2, half-up, policy rounding stated", () => {
    const a = K.householdFigure("a", "you said 0.10", { amount: 0.1, currency: "SGD" }), b = K.householdFigure("b", "you said 0.20", { amount: 0.2, currency: "SGD" });
    const s = K.sum([a, b]); assert.equal(s.status, "ok"); if (s.status === "ok") { assert.equal(s.cents, 30); assert.equal(s.kind, "indicative_estimate"); }
    const base = K.householdFigure("bill", "the bill was S$333.33", { amount: 333.33, currency: "SGD" });
    const p = K.percentage(base, K.householdFigure("rate", "15%", { percent: 15 }));
    assert.equal(p.status, "ok"); if (p.status === "ok") assert.equal(p.cents, 5000, "4999.95 cents rounds half-up to 5000");
    const pol = K.percentage(base, K.householdFigure("rate", "15%", { percent: 15 }), "share", { mode: "down", precision: 0, source: "policy", statement: "Rounded down to the dollar, as the policy prints." });
    assert.equal(pol.status, "ok"); if (pol.status === "ok") { assert.equal(pol.cents, 4900); assert.ok(pol.steps.includes("Rounded down to the dollar, as the policy prints.")); }
    const big = K.product(K.householdFigure("x", "you said S$90,000,000,000", { amount: 90_000_000_000, currency: "SGD" }), K.householdFigure("n", "3", { count: 3 }));
    assert.equal(big.status, "ok"); if (big.status === "ok") assert.equal(big.cents, 27_000_000_000_000);
    const mc = K.minCap(K.householdFigure("bill", "S$2,000", { amount: 2000, currency: "SGD" }), K.householdFigure("cap", "S$1,500", { amount: 1500, currency: "SGD" }));
    assert.equal(mc.status, "ok"); if (mc.status === "ok") assert.equal(mc.cents, 150000);
  });

  // ---------------------------------------------------------------- G: the existing save-time gate
  const answer = (summary: string, extra: Record<string, unknown> = {}) => ({ mode: "answer", summary, details: [], claimItems: [], nextSteps: [], confidence: null, citations: [], disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [], ...extra }) as unknown as import("@/types").ChatAnswer;
  const bound = (sentence: string, v: import("@/lib/rag2/tables").SelectedValue, benefit?: string) => { const b = E.toFigureBinding(v.evidence, benefit ?? v.rowLabel, v.value, v.currency!); assert.ok(b, "no binding"); return { ...b!, sentence, value: v.value, currency: v.currency! }; };
  await check("G1 table-value bindings pass the existing gate: PA child physio, CI severe amount, booklet spouse room, endorsed death benefit", async () => {
    const cases: [string, import("@/lib/rag2/tables").SelectedValue, string?][] = [
      ["Yi Xuan's physiotherapy / TCM limit is S$300 per policy year.", okv(await value("PA", "physiotherapy", M.yixuan.id))],
      ["Melissa's severe stage critical illness benefit is S$150,000.", okv(await value("CI", "severe stage", M.melissa.id, "amount"))],
      ["Melissa's daily room & board limit is S$400.", okv(await value("GHS", "daily room & board", M.melissa.id)), "Daily room & board"],
      ["Darren's death benefit is now S$350,000.", okv(await value("TERM", "death", M.darren.id))],
      ["Jun Hao's hospital cash is S$80 per day.", okv(await value("CASH", "hospital cash", M.junhao.id)), "Hospital cash"],
    ];
    for (const [s, v, benefit] of cases) {
      const a = answer(s, { figureBindings: [bound(s, v, benefit)] });
      const problems = await verifyAnswerFigures(a, { accountId: ACCOUNT, report: true });
      assert.deepEqual(problems, [], s + " -> " + JSON.stringify(problems));
    }
  });
  await check("G2 negative controls: the gate rejects the adult column for a child, a deleted document, and an unbound figure", async () => {
    const yx = okv(await value("PA", "physiotherapy", M.yixuan.id));
    const s = "Yi Xuan's physiotherapy / TCM limit is S$500 per policy year.";
    // The adult column's S$500 bound as if it were the child column's (what "a number elsewhere in the row" would give).
    const wrong = { ...E.toFigureBinding(yx.evidence, yx.rowLabel, 500, "SGD")!, sentence: s, value: 500, currency: "SGD" };
    assert.equal(wrong.column, "Insured Child");
    assert.ok((await verifyAnswerFigures(answer(s, { figureBindings: [wrong] }), { accountId: ACCOUNT, report: true })).length >= 1, "another column's figure accepted for the child");
    const del = { ...E.toFigureBinding(yx.evidence, yx.rowLabel, 300, "SGD")!, policyId: doc("DELETED").id, documentHash: doc("DELETED").hash, sentence: s.replace("500", "300"), value: 300, currency: "SGD" };
    assert.ok((await verifyAnswerFigures(answer(s.replace("500", "300"), { figureBindings: [del] }), { accountId: ACCOUNT, report: true })).length >= 1, "a deleted document grounded a figure");
    assert.ok((await verifyAnswerFigures(answer("Yi Xuan's physiotherapy / TCM limit is S$300."), { accountId: ACCOUNT, report: true })).length >= 1);
  });
  await check("G3 ComputationRecords from compute pass the gate (sum and per-day multiple of printed figures)", async () => {
    const early = okv(await value("CI", "early", M.melissa.id, "amount")), special = okv(await value("CI", "special", M.melissa.id, "amount"));
    const s = K.sum([operand(early), operand(special)]);
    assert.ok(s.status === "ok" && s.record);
    if (s.status !== "ok" || !s.record) return;
    const sent = "Melissa's early and special critical illness benefits come to S$52,500 together.";
    const p1 = await verifyAnswerFigures(answer(sent, { computations: [{ ...s.record, sentence: sent }] }), { accountId: ACCOUNT, report: true });
    assert.deepEqual(p1, [], JSON.stringify(p1));
    const bad = { ...s.record, sentence: sent.replace("52,500", "52,000"), result: { value: 52000, currency: "SGD" } };
    assert.ok((await verifyAnswerFigures(answer(bad.sentence, { computations: [bad] }), { accountId: ACCOUNT, report: true })).length >= 1, "a wrong total passed");
    const rate = okv(await value("CASH", "hospital cash", M.junhao.id)), days = okv(await value("CASH", "maximum days per admission", M.junhao.id, "count"));
    const p = K.perDay(operand(rate), operand(days));
    assert.ok(p.status === "ok" && p.record);
    if (p.status !== "ok" || !p.record) return;
    const sent2 = "Jun Hao's hospital cash comes to at most S$2,400 for one admission of 30 days.";
    const p2 = await verifyAnswerFigures(answer(sent2, { computations: [{ ...p.record, sentence: sent2 }] }), { accountId: ACCOUNT, report: true });
    assert.deepEqual(p2, [], JSON.stringify(p2));
  });

  // ---------------------------------------------------------------- R: registry
  const ON = { DEARPOLICY_RAG_TOOLS: "1", NODE_ENV: "test" } as unknown as NodeJS.ProcessEnv;
  await check("R1 registry: every tool has a name, description and object schema; no tool takes an account id", () => {
    const names = R.RAG_TOOLS.map((t) => t.name);
    assert.deepEqual(names, ["search_passages", "read_page", "resolve_person", "policies_for", "select_table_value", "compute"]);
    for (const t of R.RAG_TOOLS) { assert.equal(t.parameters.type, "object"); assert.ok(t.description.length > 20); assert.ok(!JSON.stringify(t.parameters).includes("account")); }
    assert.equal(R.toolSpecs().length, 6);
  });
  await check("R2 a conversation through the registry: person -> value -> compute, all with evidence", async () => {
    const ctx = R.createToolContext({ accountId: ACCOUNT, speakerId: M.darren.id, asOf: ASOF });
    const who = await R.runTool(ctx, "resolve_person", { mention: "my son" }, ON);
    assert.ok(who.ok); assert.equal(ctx.conversation.lastSubjectId, M.junhao.id);
    const v = await R.runTool(ctx, "select_table_value", { policy_id: doc("CASH").id, benefit: "hospital cash", subject_id: M.junhao.id }, ON);
    assert.ok(v.ok && v.evidence.length >= 1); const vid = ((v as { data: { valueId: string } }).data).valueId;
    for (const ev of v.evidence) exact(ev, "CASH");
    const c = await R.runTool(ctx, "compute", { operation: "per_day", operands: [{ value_id: vid }, { household: { label: "days", attribution: "he stayed 3 days", count: 3 } }] }, ON);
    assert.ok(c.ok, JSON.stringify(c)); assert.equal((c as { data: { cents: number; kind: string } }).data.cents, 24000); assert.equal((c as { data: { kind: string } }).data.kind, "indicative_estimate");
    const pr = await R.runTool(ctx, "policies_for", { subject_id: M.junhao.id }, ON);
    assert.ok(pr.ok && pr.evidence.length >= 1);
    const sr = await R.runTool(ctx, "search_passages", { query: "hospital cash", k: 3 }, ON);
    assert.ok(sr.ok && sr.evidence.length >= 1);
  });
  await check("R3 the registry refuses invented values, unknown parameters, unattributed figures and other households", async () => {
    const ctx = R.createToolContext({ accountId: ACCOUNT, asOf: ASOF });
    const fake = await R.runTool(ctx, "compute", { operation: "sum", operands: [{ value_id: "v99" }, { value_id: "v98" }] }, ON);
    assert.equal(fake.ok, false); assert.match((fake as { error: string }).error, /unknown value_id/);
    const acct = await R.runTool(ctx, "search_passages", { query: "x", account_id: OTHER_ACCOUNT }, ON);
    assert.equal(acct.ok, false); assert.match((acct as { error: string }).error, /not a parameter/);
    const unattributed = await R.runTool(ctx, "compute", { operation: "sum", operands: [{ household: { label: "bill", amount: 10, currency: "SGD" } }, { household: { label: "bill", amount: 10, currency: "SGD", attribution: "S$10" } }] }, ON);
    assert.equal(unattributed.ok, false);
    const foreign = await R.runTool(ctx, "select_table_value", { policy_id: doc("FOREIGN").id, benefit: "accidental medical expenses", subject_id: M.darren.id }, ON);
    assert.ok(foreign.ok && (foreign as { data: { status: string } }).data.status === "missing");
    const badArg = await R.runTool(ctx, "read_page", { policy_id: doc("PA").id, page: "1" }, ON);
    assert.equal(badArg.ok, false);
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nrag2:tools-test ${results.length - failed.length}/${results.length} passed`);
  await db.close();
  if (failed.length) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(1); });
