/** A personal document whose one printed name matches nobody in the family is linked to the profile the household
 * uploaded it to (lib/rag/ingest.ts, source upload_hint, flagged "Named in it: … Change"). Home and Family count that
 * link; Coverage must too (TE real-model run, 4 Nov: Home said covered for Hospitalisation, Coverage said "No covers yet"
 * and "Not in your family", and relink never asked the model to link a section because no cover belonged to anyone).
 * Real readDocument, relink and Coverage route against a real, disposable PostgreSQL. Made-up household; scripted model;
 * no network. Refuses to run unless DEARPOLICY_DISPOSABLE_DB=1 and DATABASE_URL points at localhost.
 *   DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://... npm run benefit-table:upload-profile-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const url = process.env.DATABASE_URL ?? "";
if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
  console.log("upload profile: skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run)");
  process.exit(0);
}
const ACCOUNT = randomUUID(), USER = randomUUID();
Object.assign(process.env, { DEV_AUTH_ENABLED: "1", DEV_ACCOUNT_ID: USER, DEARPOLICY_BENEFIT_TABLE: "1", DEARPOLICY_ALPHA_ACCOUNTS: ACCOUNT });
for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC_KEY|OPENAI_KEY/i.test(k)) delete process.env[k];
const localFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) throw new Error("outbound request refused");
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
  type TableModel = import("@/lib/benefit-table/model").TableModel;
  const links = new Map<string, { section: string; cover: string | null; why: string }>();
  let linkingCalls = 0;
  const model = (answer: unknown): TableModel => ({ choice: { provider: "anthropic", model: "test-model" }, async call(c) {
    const linking = !!c.schema && "links" in ((c.schema as { properties?: object }).properties ?? {});
    if (linking) linkingCalls++;
    return { json: linking ? { links: [...links.values()] } : answer, stopReason: "end_turn", model: "test-model", input: 1, output: 1, ms: 1 };
  } });
  await query("INSERT INTO accounts(id,name) VALUES($1,$2)", [ACCOUNT, "Test household upload profile"]);
  await query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner')", [ACCOUNT, USER]);
  const P: Record<string, string> = {};
  for (const [name, rel] of [["Sam Rivera", "self"], ["Noor Haddad", "spouse"]])
    P[name] = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,$3) RETURNING id", [ACCOUNT, name, rel])).rows[0].id;

  /** A hospital plan schedule printing `printed`, uploaded to `uploadedTo`, stored as intake stores it: the person link
   * (`source`), the printed name and who it matched, and the reading. */
  async function doc(product: string, printed: string[], uploadedTo: string, source: "upload_hint" | "ai_name_match" | null) {
    const id = randomUUID();
    const text = `POLICY SCHEDULE\n` + printed.map((p) => `Insured\t${p}`).join("\n") + `\n${product}\nRoom and board\tMYR 250 per day`;
    await query(`INSERT INTO policies(id,account_id,family_member_id,product_name,original_filename,storage_key,processing_status,processing_stage,quarantine_status,personal_coverage_confirmed,document_role)
      VALUES($1,$2,$3,$4,$5,$6,'ready','ready','scan_clean',true,'schedule')`, [id, ACCOUNT, P[uploadedTo], product, `${product}.pdf`, `test/${id}`]);
    await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [ACCOUNT, id, text]);
    if (source) await query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$3,$4,0.70)", [id, P[uploadedTo], ACCOUNT, source]);
    for (const p of printed) await query("INSERT INTO policy_detected_people(account_id,policy_id,detected_name,matched_family_member_id,confidence) VALUES($1,$2,$3,$4,$5)",
      [ACCOUNT, id, p, source ? P[uploadedTo] : null, source ? 0.7 : 0.6]);
    const reading = { document: { kind: "personal_proof", product, insurer: null, namedPeople: printed, plan: null, periodFrom: null, periodTo: null },
      covers: printed.map((p) => ({ person: p, product, cover: product, plan: null, riderOf: null, policyNumber: null, sumInsured: null, premium: null, premiumFrequency: null, asOf: null,
        startDate: null, endDate: null, page: 1, quote: `Insured\t${p}` })),
      benefits: [{ section: null, column: null, benefit: "Room and board", pays: "amount", value: 250, period: "day", basis: null, asOf: null, percentOf: null, baseAmount: null,
        baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, quote: "Room and board\tMYR 250 per day" }] };
    assert.ok((await readDocument(appDb, model(reading), ACCOUNT, id)).read);
    const section = sectionKeyOf(id, { section: null, column: null });
    links.set(section, { section, cover: coverKeyOf({ product, cover: product, plan: null }), why: "the schedule" });
    return id;
  }
  const coverage = async (person: string) => {
    const r = await GET(new NextRequest(`http://localhost/api/coverage?familyMemberId=${P[person]}&category=Hospitalisation`));
    assert.equal(r.status, 200);
    return (await r.json()) as { table: { product: string; figure: string }[] };
  };
  const products = async (person: string) => (await coverage(person)).table.map((row) => row.product).sort();

  try {
    const hinted = await doc("Kestrel Hospital Plan", ["Rowan Ellery Hart"], "Sam Rivera", "upload_hint");
    linkingCalls = 0;
    await relink(appDb, model(null), ACCOUNT);
    await test("relink asks the model to link the section, now that its cover belongs to someone", async () => {
      assert.equal(linkingCalls, 1);
      assert.equal((await query("SELECT 1 FROM benefit_links WHERE account_id=$1", [ACCOUNT])).rows.length, 1);
    });
    await test("Coverage shows the cover for the person it was uploaded to, as Home does", async () => {
      assert.deepEqual(await products("Sam Rivera"), ["Kestrel Hospital Plan"]);
      assert.deepEqual(await products("Noor Haddad"), []);
    });

    // Not linked to anyone (two printed names, so intake guesses nothing): nobody's cover.
    await doc("Osprey Hospital Plan", ["Rowan Ellery Hart", "Jude Hart"], "Sam Rivera", null);
    await relink(appDb, model(null), ACCOUNT);
    await test("a document intake did not link to anyone stays off every page", async () => {
      assert.deepEqual(await products("Sam Rivera"), ["Kestrel Hospital Plan"]);
      assert.deepEqual(await products("Noor Haddad"), []);
    });

    // The household said the printed name is not in its family: the upload profile never takes it.
    await query("INSERT INTO policy_name_dismissals(account_id,policy_id,name_key,detected_name) VALUES($1,$2,$3,$4)", [ACCOUNT, hinted, "rowan ellery hart", "Rowan Ellery Hart"]);
    const dismissalsExist = (await query("SELECT to_regclass('public.policy_name_dismissals') IS NOT NULL AS ok")).rows[0]?.ok === true;
    if (dismissalsExist) await test("a name the household said is not its family's is never shown for the upload profile", async () => {
      assert.deepEqual(await products("Sam Rivera"), []);
    });
    await query("DELETE FROM policy_name_dismissals WHERE account_id=$1", [ACCOUNT]).catch(() => undefined);

    // An automatic name match to someone else is never overridden by an upload hint; only the household's own word is.
    await query("UPDATE policy_members SET source='ai_name_match' WHERE policy_id=$1", [hinted]);
    await test("only the upload-profile link and a match by hand count as the household's word; an automatic link does not", async () => {
      assert.deepEqual(await products("Sam Rivera"), []);
    });

    // The upload choice counts only while the printed name matches nobody by name: a person added or renamed later so the
    // name is theirs must never have their cover shown for the upload profile (Critic H1 on #341).
    await query("UPDATE policy_members SET source='upload_hint' WHERE policy_id=$1", [hinted]);
    await test("back as an upload-profile link, the cover is the upload profile's again", async () => {
      assert.deepEqual(await products("Sam Rivera"), ["Kestrel Hospital Plan"]);
    });
    await query("UPDATE family_members SET display_name='Rowan Ellery Hart' WHERE id=$1", [P["Noor Haddad"]]);
    await test("a person renamed later to the printed name: the upload profile no longer takes the cover", async () => {
      assert.deepEqual(await products("Sam Rivera"), []);
    });
    await query("UPDATE family_members SET display_name='Noor Haddad' WHERE id=$1", [P["Noor Haddad"]]);
    const added = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,'Rowan Hart','child') RETURNING id", [ACCOUNT])).rows[0].id;
    await test("a person added later whose name the printed name holds: the upload profile no longer takes the cover", async () => {
      assert.deepEqual(await products("Sam Rivera"), []);
    });
    await query("DELETE FROM family_members WHERE id=$1", [added]);
    await test("once that person is gone, the upload choice counts again", async () => {
      assert.deepEqual(await products("Sam Rivera"), ["Kestrel Hospital Plan"]);
    });
  } finally {
    for (const t of ["benefit_links", "benefit_readings", "policy_detected_people", "policy_members", "policy_pages", "policy_name_dismissals"])
      await query(`DELETE FROM ${t} WHERE account_id=$1`, [ACCOUNT]).catch(() => undefined);
    await query("DELETE FROM policies WHERE account_id=$1", [ACCOUNT]).catch(() => undefined);
    await query("DELETE FROM family_members WHERE account_id=$1", [ACCOUNT]).catch(() => undefined);
    await query("DELETE FROM household_members WHERE household_id=$1", [ACCOUNT]).catch(() => undefined);
    await query("DELETE FROM accounts WHERE id=$1", [ACCOUNT]).catch(() => undefined);
  }
  console.log(`upload profile: ${passed} passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) console.error("  FAIL " + f); process.exit(1); }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
