/** A printed name DearPolicy matched to the wrong person can be corrected on the Documents page, and every page follows
 * the correction (audit 3 Nov: "Chen Wei Ming" was matched to the household's "Wei Ming" by part of the name, and
 * nothing could change it on a personal document). Through the real link-person route and the real Coverage route,
 * with readings stored by the real readDocument and linked by relink, against a real, disposable PostgreSQL.
 * Made-up household in euros and pounds; scripted model; no network.
 * Refuses to run unless DEARPOLICY_DISPOSABLE_DB=1 and DATABASE_URL points at localhost; deletes only what it creates.
 *   DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://... npm run policies:move-detected-name-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const url = process.env.DATABASE_URL ?? "";
if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
  console.log("move detected name: skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run)");
  process.exit(0);
}
const ACCOUNT = randomUUID(), USER = randomUUID();
Object.assign(process.env, { DEV_AUTH_ENABLED: "1", DEV_ACCOUNT_ID: USER, DEARPOLICY_BENEFIT_TABLE: "1", DEARPOLICY_ALPHA_ACCOUNTS: ACCOUNT });
for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC_KEY|OPENAI_KEY/i.test(k)) delete process.env[k];
const outbound: string[] = [];
const localFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) { outbound.push(u.replace(/[?#].*/, "")); throw new Error("outbound request refused"); }
  return localFetch(input, init);
}) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message.split("\n")[0] : String(e))); } }

async function main() {
  const { query } = await import("@/lib/db/client");
  const { readDocument, relink } = await import("@/lib/benefit-table/service");
  const { appDb } = await import("@/lib/benefit-table/app");
  const { coverKeyOf, sectionKeyOf } = await import("@/lib/benefit-table/assemble");
  const { GET } = await import("@/app/api/coverage/route");
  const { POST } = await import("@/app/api/policies/link-person/route");
  const { syncInsuredPersonToMember } = await import("@/lib/policies/linking");
  const { moveDetectedName } = await import("@/lib/policies/coverage-assignments");
  type TableModel = import("@/lib/benefit-table/model").TableModel;
  const links = new Map<string, { section: string; cover: string | null; why: string }>();
  const model = (answer: unknown): TableModel => ({ choice: { provider: "anthropic", model: "test-model" }, async call(c) {
    const json = c.schema && "links" in ((c.schema as { properties?: object }).properties ?? {}) ? { links: [...links.values()] } : answer;
    return { json, stopReason: "end_turn", model: "test-model", input: 1, output: 1, ms: 1 };
  } });
  await query("INSERT INTO accounts(id,name) VALUES($1,$2)", [ACCOUNT, "Test household EUR"]);
  await query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner')", [ACCOUNT, USER]);
  const P: Record<string, string> = {};
  // "Ana" is the account holder by her given name only; her daughter's record has her full name. A document printed
  // "Ana Ortega" fits "Ana" by part of the name (every word of "Ana" is in it) and not the daughter's (no "Lucia").
  for (const [name, rel] of [["Ana", "self"], ["Ana Lucia Ortega", "child"], ["Tomás", "spouse"]])
    P[name] = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,$3) RETURNING id", [ACCOUNT, name, rel])).rows[0].id;

  const readings = new Map<string, unknown>();
  /** A personal certificate naming `covers` (printed name, sum, matched member), stored as intake stores it. */
  async function doc(product: string, currency: string, covers: [string, number, string][]) {
    const id = randomUUID();
    const money = (s: number) => `${currency}${s.toLocaleString("en-US")}`;
    const text = `CERTIFICATE OF INSURANCE\n` + covers.map(([p, s]) => `Insured person\t${p}\n${product}\tSum insured ${money(s)}`).join("\n") + `\nDeath benefit\t${money(covers[0][1])}`;
    const extraction = { personalCoverageConfirmed: true, insurer: "Example Mutual", productName: product, policyNumber: null, paymentRecords: [],
      insuredPeople: covers.map(([p, s]) => ({ name: p, coverages: [{ category: "Death", productName: product, amount: s, currency: currency === "€" ? "EUR" : "GBP", sourcePage: 1,
        evidenceText: `${product}\tSum insured ${money(s)}`, evidenceVerified: true, notes: null }] })) };
    await query(`INSERT INTO policies(id,account_id,family_member_id,product_name,original_filename,storage_key,processing_status,processing_stage,quarantine_status,personal_coverage_confirmed,document_role,extracted_json)
      VALUES($1,$2,$3,$4,$5,$6,'ready','ready','scan_clean',true,'certificate',$7)`, [id, ACCOUNT, P[covers[0][2]], product, `${product}.pdf`, `test/${id}`, JSON.stringify(extraction)]);
    await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [ACCOUNT, id, text]);
    for (const [printed, , member] of covers) {
      await query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$3,'ai_name_match',0.95) ON CONFLICT DO NOTHING", [id, P[member], ACCOUNT]);
      await query("INSERT INTO policy_detected_people(account_id,policy_id,detected_name,matched_family_member_id,confidence) VALUES($1,$2,$3,$4,0.95)", [ACCOUNT, id, printed, P[member]]);
    }
    // The cover rows the dashboard, chat, Home and export read (policy_coverages), written from the stored reading.
    for (const member of new Set(covers.map(([, , m]) => m))) {
      const names = covers.filter(([, , m]) => m === member).map(([n]) => n);
      await syncInsuredPersonToMember({ accountId: ACCOUNT, sourcePolicyId: id, familyMemberId: P[member], detectedName: names[0], alsoNames: names.slice(1),
        extraction: extraction as never, link: { source: "ai_name_match", confidence: 0.95 } });
    }
    const reading = { document: { kind: "personal_proof", product, insurer: null, namedPeople: covers.map(([p]) => p), plan: null, periodFrom: null, periodTo: null },
      covers: covers.map(([p, s]) => ({ person: p, product, cover: product, plan: null, riderOf: null, policyNumber: null, sumInsured: s, premium: null, premiumFrequency: null, asOf: null,
        startDate: null, endDate: null, page: 1, quote: `${product}\tSum insured ${money(s)}` })),
      benefits: [{ section: null, column: null, benefit: "Death benefit", pays: "amount", value: covers[0][1], period: null, basis: null, asOf: null, percentOf: null, baseAmount: null,
        baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, quote: `Death benefit\t${money(covers[0][1])}` }] };
    readings.set(id, reading);
    assert.ok((await readDocument(appDb, model(reading), ACCOUNT, id)).read);
    const section = sectionKeyOf(id, { section: null, column: null });
    links.set(section, { section, cover: coverKeyOf({ product, cover: product, plan: null }), why: "the certificate" });
    await relink(appDb, model(null), ACCOUNT);
    return id;
  }
  const products = async (person: string) => {
    const r = await GET(new NextRequest(`http://localhost/api/coverage?familyMemberId=${P[person]}&category=Death`));
    assert.equal(r.status, 200);
    return ((await r.json()) as { table: { product: string; figure: string }[] }).table.map((row) => row.product).sort();
  };
  const link = async (body: object) => {
    const r = await POST(new NextRequest("http://localhost/api/policies/link-person", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    return { status: r.status, body: await r.json() as Record<string, unknown> };
  };
  const membersOf = async (policyId: string) => (await query<{ name: string; source: string }>(
    `SELECT fm.display_name AS name, pm.source FROM policy_members pm JOIN family_members fm ON fm.id=pm.family_member_id WHERE pm.policy_id=$1 ORDER BY 1`, [policyId])).rows.map((r) => `${r.name}:${r.source}`);
  const ownerOf = async (policyId: string) => (await query<{ name: string }>(`SELECT fm.display_name AS name FROM policies p JOIN family_members fm ON fm.id=p.family_member_id WHERE p.id=$1`, [policyId])).rows[0]?.name;

  try {
    const daughters = await doc("Vida Plena Life", "€", [["Ana Ortega", 200000, "Ana"]]);
    const shared = await doc("Hogar Family Cover", "£", [["Ana Ortega", 50000, "Ana"], ["Tomás Ortega", 80000, "Tomás"]]);
    const own = await doc("Ana Term Life", "€", [["Ana", 300000, "Ana"]]);

    await test("before any correction: the printed name 'Ana Ortega' is read as the account holder 'Ana' on every page", async () => {
      assert.deepEqual(await products("Ana"), ["Ana Term Life", "Hogar Family Cover", "Vida Plena Life"]);
      assert.deepEqual(await products("Ana Lucia Ortega"), []);
    });

    const moved = await link({ policyId: daughters, detectedName: "Ana Ortega", familyMemberId: P["Ana Lucia Ortega"] });
    await test("saying the matched name is someone else is accepted (it used to be refused for a matched name)", async () => {
      assert.equal(moved.status, 200, JSON.stringify(moved.body));
      assert.equal(moved.body.moved, true);
    });
    await test("the document moves: the daughter is linked by the household, the holder is taken off, and the upload profile follows", async () => {
      assert.deepEqual(await membersOf(daughters), ["Ana Lucia Ortega:user_declared"]);
      assert.equal(await ownerOf(daughters), "Ana Lucia Ortega");
      const excluded = (await query("SELECT 1 FROM policy_member_exclusions WHERE policy_id=$1 AND family_member_id=$2", [daughters, P.Ana]).catch(() => ({ rows: [1] }))).rows;
      assert.equal(excluded.length, 1, "the removal is remembered so a re-read does not put her back");
    });
    await test("Coverage follows the correction: the cover leaves the holder's page and is on the daughter's", async () => {
      assert.deepEqual(await products("Ana"), ["Ana Term Life", "Hogar Family Cover"]);
      assert.deepEqual(await products("Ana Lucia Ortega"), ["Vida Plena Life"]);
    });
    await test("one correction is one document: the same printed name on another document is still the holder's", async () => {
      assert.ok((await products("Ana")).includes("Hogar Family Cover"));
    });
    await test("a re-read and relink keep the household's correction", async () => {
      assert.ok((await readDocument(appDb, model(readings.get(daughters)), ACCOUNT, daughters)).read);
      await relink(appDb, model(null), ACCOUNT);
      assert.deepEqual(await products("Ana Lucia Ortega"), ["Vida Plena Life"]);
      assert.ok(!(await products("Ana")).some((r) => r === "Vida Plena Life"));
    });

    const cousin = await link({ policyId: shared, detectedName: "Tomás Ortega", notFamily: true });
    await test("a matched name can be 'Not in my family' when someone else is still on the document", async () => {
      assert.equal(cousin.status, 200, JSON.stringify(cousin.body));
      assert.equal(cousin.body.notFamily, true);
      assert.deepEqual(await membersOf(shared), ["Ana:ai_name_match"]);
      const remembered = (await query("SELECT 1 FROM policy_name_dismissals WHERE policy_id=$1", [shared]).catch(() => ({ rows: [1] }))).rows;
      assert.equal(remembered.length, 1);
    });
    await test("Coverage drops the cover for Tomás and keeps Ana's own line on that document", async () => {
      assert.deepEqual(await products("Tomás"), []);
      assert.ok((await products("Ana")).includes("Hogar Family Cover"));
    });

    const only = await link({ policyId: own, detectedName: "Ana", notFamily: true });
    await test("the only name on a document cannot be made 'nobody' (the document would cover no one): refused, nothing changed", async () => {
      assert.equal(only.status, 409);
      assert.match(String(only.body.error), /delete it/);
      assert.deepEqual(await membersOf(own), ["Ana:ai_name_match"]);
      assert.ok((await products("Ana")).includes("Ana Term Life"));
    });

    const same = await link({ policyId: own, detectedName: "Ana", familyMemberId: P.Ana });
    await test("choosing the person a name is already matched to changes nothing", async () => {
      assert.equal(same.status, 200, JSON.stringify(same.body));
      assert.ok((await products("Ana")).includes("Ana Term Life"));
    });

    // A "Not sure" upload is filed under the account holder although only someone else is named in it.
    const filed = await doc("Salud Viajero", "€", [["Ana Ortega", 40000, "Ana"]]);
    await query("UPDATE policies SET family_member_id=$2 WHERE id=$1", [filed, P["Tomás"]]);
    const refiled = await link({ policyId: filed, detectedName: "Ana Ortega", familyMemberId: P["Ana Lucia Ortega"] });
    await test("a document filed under someone it never covered is filed under the person chosen", async () => {
      assert.equal(refiled.status, 200, JSON.stringify(refiled.body));
      assert.equal(await ownerOf(filed), "Ana Lucia Ortega");
    });

    const otherHousehold = await query<{ id: string }>("INSERT INTO accounts(id,name) VALUES($1,'Other') RETURNING id", [randomUUID()]);
    const stranger = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,'Stranger','self') RETURNING id", [otherHousehold.rows[0].id])).rows[0].id;
    const across = await link({ policyId: shared, detectedName: "Ana Ortega", familyMemberId: stranger });
    await test("a name cannot be moved to someone in another household", async () => {
      assert.equal(across.status, 404);
      assert.deepEqual(await membersOf(shared), ["Ana:ai_name_match"]);
    });
    await query("DELETE FROM accounts WHERE id=$1", [otherHousehold.rows[0].id]);

    // One person printed twice on one document (a short and a full name), and one of the two is really the daughter.
    const twice = await doc("Doble Vida", "€", [["Ana", 100000, "Ana"], ["Ana Ortega", 200000, "Ana"]]);
    const rows = async (policyId: string) => (await query<{ r: string }>(
      `SELECT fm.display_name||':'||pc.amount::bigint AS r FROM policy_coverages pc JOIN family_members fm ON fm.id=pc.family_member_id WHERE pc.policy_id=$1 ORDER BY 1`, [policyId])).rows.map((x) => x.r);
    await test("setup: both printed names' cover rows are the holder's", async () => assert.deepEqual(await rows(twice), ["Ana:100000", "Ana:200000"]));
    const split = await link({ policyId: twice, detectedName: "Ana Ortega", familyMemberId: P["Ana Lucia Ortega"] });
    await test("moving one of a person's two names moves that name's cover rows too: the holder keeps only her own", async () => {
      assert.equal(split.status, 200, JSON.stringify(split.body));
      assert.deepEqual((await rows(twice)).sort(), ["Ana Lucia Ortega:200000", "Ana:100000"].sort());
      assert.deepEqual((await membersOf(twice)).sort(), ["Ana Lucia Ortega:user_declared", "Ana:ai_name_match"].sort());
      const excluded = (await query("SELECT 1 FROM policy_member_exclusions WHERE policy_id=$1", [twice]).catch(() => ({ rows: [] }))).rows;
      assert.equal(excluded.length, 0, "the holder is still on it, so she is not remembered as removed");
    });
    await test("moving a name to someone already named on the document keeps their other rows", async () => {
      const back = await link({ policyId: twice, detectedName: "Ana", familyMemberId: P["Ana Lucia Ortega"] });
      assert.equal(back.status, 200, JSON.stringify(back.body));
      assert.deepEqual(await rows(twice), ["Ana Lucia Ortega:100000", "Ana Lucia Ortega:200000"]);
      assert.deepEqual(await membersOf(twice), ["Ana Lucia Ortega:user_declared"]);
    });

    // A failure part-way leaves the document exactly as it was.
    const halfway = await doc("Seguro Uno", "£", [["Ana Ortega", 70000, "Ana"], ["Tomás Ortega", 90000, "Tomás"]]);
    const snapshot = async (policyId: string) => JSON.stringify([await membersOf(policyId), await rows(policyId), await ownerOf(policyId),
      (await query("SELECT detected_name, matched_family_member_id FROM policy_detected_people WHERE policy_id=$1 ORDER BY 1", [policyId])).rows,
      (await query("SELECT family_member_id FROM policy_member_exclusions WHERE policy_id=$1 ORDER BY 1", [policyId]).catch(() => ({ rows: [] }))).rows,
      (await query("SELECT name_key FROM policy_name_dismissals WHERE policy_id=$1 ORDER BY 1", [policyId]).catch(() => ({ rows: [] }))).rows]);
    const beforeFail = await snapshot(halfway);
    for (const to of [P["Ana Lucia Ortega"], null]) {
      await test(`a move that fails part-way (to ${to ? "someone" : "nobody"}) changes nothing`, async () => {
        await assert.rejects(moveDetectedName({ accountId: ACCOUNT, policyId: halfway, detectedName: "Ana Ortega", to, beforeLink: async () => { throw new Error("injected"); } }), /injected/);
        assert.equal(await snapshot(halfway), beforeFail);
      });
    }

    await test("no outbound request", async () => assert.deepEqual(outbound, []));
  } finally {
    await query("DELETE FROM accounts WHERE id=$1", [ACCOUNT]);
  }
  console.log(`\nmove detected name: ${passed} passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) console.error(" - " + f); process.exit(1); }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
