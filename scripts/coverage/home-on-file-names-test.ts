/** Home's "On file, please confirm" tile names the documents that mention the cover, so "Open it to check" always says which
 * one; with none known it asks nothing (live check, 5 Nov: three tiles said "Open it to check" and named nothing). Runs the
 * real dashboard route on a disposable PostgreSQL for a made-up household, then the pure note for every count of names.
 * No real household, insurer or scheme; no model call; no paid call. Needs DEARPOLICY_DISPOSABLE_DB=1 and a local
 * DATABASE_URL for the route part (the pure part always runs).
 *   npm run -s coverage:home-on-file-names-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { documentKindNote, onFileDocumentName, onFileNote } from "@/lib/coverage/on-file-note";

for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC_KEY|OPENAI_KEY/i.test(k)) delete process.env[k];
let outbound = 0;
const localFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) { outbound++; throw new Error("no network"); }
  return localFetch(input, init);
}) as typeof fetch;
let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function pure() {
  await test("P1 one document: named, and the person is asked to open it", () => {
    assert.equal(onFileNote(["Pinnacle Term Guard"], "Raj"), "Pinnacle Term Guard mentions this cover, but does not show yet that it is Raj’s. Open it to check.");
  });
  await test("P2 two or more: both named, then how many more, each once", () => {
    assert.equal(onFileNote(["A Plan", "B Plan", "A Plan"], "Ana"), "A Plan and B Plan mention this cover, but none of them shows yet that it is Ana’s. Open them to check.");
    assert.equal(onFileNote(["A", "B", "C", "D"], "Ana"), "A, B and 2 more mention this cover, but none of them shows yet that it is Ana’s. Open them to check.");
  });
  await test("P3 none known (or only blanks): nothing to open is asked for", () => {
    for (const docs of [[], ["", "  "]]) {
      const note = onFileNote(docs, "Mei");
      assert.doesNotMatch(note, /\bOpen\b/, note); assert.match(note, /Mei’s\./);
    }
  });
  await test("P4 no figure in any note", () => {
    for (const docs of [[], ["Plan"], ["Plan", "Other"]]) assert.doesNotMatch(onFileNote(docs, "X"), /\d/);
  });
  await test("P6 a travel, home or motor policy is named with its kind on another cover's tile, never on its own", () => {
    const travel = { type: "travel", product: "Harbour Travel Guard", name: "Harbour Travel Guard" };
    assert.equal(onFileDocumentName(travel, "Hospitalisation"), "Harbour Travel Guard (travel cover, for trips)");
    assert.equal(onFileDocumentName(travel, "Travel"), "Harbour Travel Guard");
    assert.equal(documentKindNote({ type: null, product: "Kestrel Travel Insurance" }, "Outpatient"), "travel cover, for trips");
    assert.equal(documentKindNote({ type: "travel", product: "Harbour Journey Plan" }, "Outpatient"), "travel cover, for trips");
    assert.equal(documentKindNote({ type: "Home insurance", product: "Nest Shield" }, "Personal Accident"), "home cover");
    assert.equal(documentKindNote({ type: "Travel Medical", product: "Wayfarer Medical" }, "Hospitalisation"), "travel cover, for trips");
    assert.equal(documentKindNote({ type: "home", product: null }, "Personal Accident"), "home cover");
    assert.equal(documentKindNote({ type: "motor", product: null }, "Hospitalisation"), "motor cover");
    assert.equal(documentKindNote({ type: "Travel Insurance (Annual Multi-Trip)", product: "Wayfarer" }, "Hospitalisation"), "travel cover, for trips");
    assert.equal(documentKindNote({ type: null, product: "Roadwise Motor Insurance" }, "Hospitalisation"), "motor cover");
    // The stored type decides alone; the file name and document name are never read (Critic #368).
    for (const [doc, category] of [[{ type: "health", product: "Kestrel Shield with Overseas Travel Benefit" }, "Hospitalisation"],
      [{ type: "accident", product: "Personal Accident Plus (travel extension)" }, "Personal Accident"],
      [{ type: "life", product: null, name: "travel-docs-scan" }, "Death"], [{ type: "health", product: "Harbour Health trip claim form" }, "Hospitalisation"], [{ type: "health", product: "Kestrel Travel Shield" }, "Hospitalisation"], [{ type: null, product: "Wayfarer Travel and Home Insurance" }, "Hospitalisation"], [{ type: "Personal Accident (incl. travel)", product: "Ridesafe PA" }, "Personal Accident"], [{ type: "Fire Shield Life", product: null }, "Death"], [{ type: "Travel Guard Gold", product: null }, "Hospitalisation"],
      [{ type: null, product: "Keystone Home Protection Scheme (mortgage life cover)" }, "Death"], [{ type: null, product: "Steadfast Life Plan with Travel Cover" }, "Death"], [{ type: "Home Loan Protection", product: "Keystone Home Protect" }, "Death"],
      [{ type: "Mortgage Reducing Term Assurance (home loan)", product: "Keystone MRTA" }, "Death"], [{ type: "Group Hospital and Surgical (business travel included)", product: "Corvane GHS" }, "Hospitalisation"], [{ type: null, product: "Steadfast Life Travel Insurance" }, "Death"],
      [{ type: null, product: "Lotus Shield", name: "Lotus travel wording" }, "Hospitalisation"], [{ type: null, product: "Home Loan Protector" }, "Death"],
      [{ type: null, product: "Car Loan Shield" }, "Death"]] as const)
      { const name = "name" in doc ? doc.name : "Doc"; assert.equal(onFileDocumentName({ ...doc, name }, category), name, JSON.stringify(doc)); }
    // Health, life and anything else: no note. A document that reads as two kinds is left as named.
    for (const doc of [{ type: "health", product: "Pinnacle Shield" }, { type: null, product: "LifeTrip Saver" },
      { type: null, product: "Careplus Critical Illness" }, { type: null, product: "Travel Insurance and Home Insurance Bundle" }, { type: "travel and home", product: "Bundle" }])
      assert.equal(documentKindNote(doc, "Hospitalisation"), null, doc.product);
    assert.equal(onFileNote([onFileDocumentName(travel, "Hospitalisation")], "Raj"), "Harbour Travel Guard (travel cover, for trips) mentions this cover, but does not show yet that it is Raj’s. Open it to check.");
  });
  await test("P5 Home draws the note from the tile's own documents", () => {
    const page = readFileSync("app/page.tsx", "utf8");
    assert.match(page, /<small data-testid="on-file-note">\{onFileNote\(c\.onFileDocuments\?\?\[\],active\?\.display_name\?\?"this person"\)\}<\/small>/);
    assert.doesNotMatch(page, /none of them shows yet that it is \{active/);
  });
}

async function route() {
  const url = process.env.DATABASE_URL ?? "";
  if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) { console.log("home on-file names: route part skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL)"); return; }
  const ACCOUNT = randomUUID(), USER = randomUUID();
  Object.assign(process.env, { DEV_AUTH_ENABLED: "1", DEV_ACCOUNT_ID: USER, DEARPOLICY_BENEFIT_TABLE: "1", DEARPOLICY_ALPHA_ACCOUNTS: ACCOUNT });
  const { query } = await import("@/lib/db/client");
  const { GET: home } = await import("@/app/api/dashboard/route");
  await query("INSERT INTO accounts(id,name) VALUES($1,'On-file names test household')", [ACCOUNT]);
  await query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner')", [ACCOUNT, USER]);
  const person = async (name: string, rel: string) => (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,$3) RETURNING id", [ACCOUNT, name, rel])).rows[0].id;
  const doc = async (o: { member: string; product: string | null; file: string; role: string; own: boolean; insurer?: string; superseded?: boolean }) => {
    const id = randomUUID();
    await query(`INSERT INTO policies(id,account_id,family_member_id,product_name,original_filename,storage_key,processing_status,processing_stage,quarantine_status,personal_coverage_confirmed,document_role,insurer,superseded_at)
      VALUES($1,$2,$3,$4,$5,$6,'ready','ready','scan_clean',$7,$8,$9,$10)`, [id, ACCOUNT, o.member, o.product, o.file, `test/${id}`, o.own, o.role, o.insurer ?? "Harbourline Assurance", o.superseded ? new Date().toISOString() : null]);
    await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [ACCOUNT, id, `${o.product ?? o.file}\nPolicy schedule`]);
    await query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'upload')", [id, o.member, ACCOUNT]);
    return id;
  };
  const line = (policy: string, member: string, category: string, amount: number, product: string, proven: boolean) =>
    query(`INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,confirmed,evidence_verified)
      VALUES($1,$2,$3,$4,$5,'SGD',$6,1,$7,$8,$8)`, [ACCOUNT, policy, member, category, amount, product, `${product}\tSum Assured S$${amount.toLocaleString("en-US")}`, proven]);
  type Tile = { category: string; status: string; amount: number | null; onFileDocuments?: string[] };
  const tiles = async (member: string) => {
    const res = await home(new NextRequest(`http://localhost/api/dashboard?poll=1&familyMemberId=${member}`));
    const body = await res.json() as { coverages: Tile[] }; assert.equal(res.status, 200, JSON.stringify(body)); return body.coverages;
  };
  try {
    const raj = await person("Raj Kumar", "self");
    // An unmatched line on a named schedule, and a product summary about another cover: each tile names its own document.
    const term = await doc({ member: raj, product: "Pinnacle Term Guard", file: "pinnacle.pdf", role: "personal_schedule", own: true });
    await line(term, raj, "Death", 400000, "Pinnacle Term Guard", false);
    const summary = await doc({ member: raj, product: "Kestrel Shield Protector", file: "kestrel-summary.pdf", role: "product_summary", own: false, insurer: "Kestrel Life" });
    await query("INSERT INTO policy_reference_coverages(account_id,policy_id,category,product_name,source_page) VALUES($1,$2,'Critical Illness','Kestrel Shield Protector',1)", [ACCOUNT, summary]);
    // A second unmatched Death line on a document with no product name: named by its file, as everywhere else.
    const letter = await doc({ member: raj, product: null, file: "Term cover letter.pdf", role: "personal_schedule", own: true });
    await line(letter, raj, "Death", 100000, "Term cover", false);
    // A superseded document's line never names it.
    const old = await doc({ member: raj, product: "Old Hospital Plan", file: "old.pdf", role: "personal_schedule", own: true, superseded: true });
    await line(old, raj, "Hospitalisation", 500, "Old Hospital Plan", false);
    // A travel policy's wording that mentions hospital cover: named with its kind on the Hospitalisation tile.
    const trip = await doc({ member: raj, product: "Harbour Travel Guard", file: "harbour-travel.pdf", role: "policy_wording", own: false, insurer: "Harbour General" });
    await query("UPDATE policies SET policy_type='travel' WHERE id=$1", [trip]);
    await query("INSERT INTO policy_reference_coverages(account_id,policy_id,category,product_name,source_page) VALUES($1,$2,'Hospitalisation','Harbour Travel Guard',1)", [ACCOUNT, trip]);
    const t = await tiles(raj);
    const by = (c: string) => t.find((x) => x.category === c)!;
    await test("R1 an on-file tile lists the documents that put it on file, each once", () => {
      assert.equal(by("Death").status, "on_file", JSON.stringify(by("Death")));
      assert.deepEqual(by("Death").onFileDocuments, ["Pinnacle Term Guard", "Term cover letter"]);
      assert.equal(by("Critical Illness").status, "on_file");
      assert.deepEqual(by("Critical Illness").onFileDocuments, ["Kestrel Shield Protector"]);
    });
    await test("R1b a travel policy on another cover's tile is named with its kind", () => {
      assert.equal(by("Hospitalisation").status, "on_file", JSON.stringify(by("Hospitalisation")));
      assert.deepEqual(by("Hospitalisation").onFileDocuments, ["Harbour Travel Guard (travel cover, for trips)"]);
    });
    await test("R2 every other tile lists none, and a superseded document is never named", () => {
      for (const c of t.filter((x) => x.status !== "on_file")) assert.deepEqual(c.onFileDocuments, [], c.category);
      assert.ok(!JSON.stringify(t).includes("Old Hospital Plan"));
    });
    await test("R3 on-file tiles still carry no amount", () => {
      for (const c of t.filter((x) => x.status === "on_file")) assert.equal(c.amount, null, c.category);
    });
    await test("R4 a proven line makes the tile Covered, and it lists none", async () => {
      await line(term, raj, "Death", 400000, "Pinnacle Term Guard", true);
      const d = (await tiles(raj)).find((x) => x.category === "Death")!;
      assert.equal(d.status, "covered", JSON.stringify(d)); assert.deepEqual(d.onFileDocuments, []);
    });
  } finally {
    for (const t of ["policy_reference_coverages", "policy_coverages", "policy_members", "policy_pages", "policies", "family_members", "household_members"])
      await query(`DELETE FROM ${t} WHERE ${t === "household_members" ? "household_id" : "account_id"}=$1`, [ACCOUNT]).catch(() => undefined);
    await query("DELETE FROM accounts WHERE id=$1", [ACCOUNT]).catch(() => undefined);
  }
}

async function main() {
  await pure(); await route();
  await test("N no request left this machine", () => assert.equal(outbound, 0));
  if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`home on-file names: ${passed} passed, 0 failed`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
