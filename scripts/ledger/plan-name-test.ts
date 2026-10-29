/**
 * Coverage rows seeded before documents were named readably carry their document's file name as their plan
 * ("Output 202609281146157", "817d6e8b 874f 4527 ...", "InformationBookletForTheNewlyInsured.pdf"). They are shown under
 * the name Documents gives that document; a printed plan name or a plan a person typed is kept. Made-up household in
 * PGlite, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { installDatabase } from "../r6/fixture";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const ACCOUNT = "00000000-0000-0000-0000-0000000f0101", ADA = "70000000-0000-4000-8000-000000000101";
let n = 0;
const id = () => "72000000-0000-4000-8000-" + String(++n).padStart(12, "0");

test("readablePlanName replaces only a plan taken from the file name", async () => {
  const { readablePlanName } = await import("@/lib/ledger/store");
  const doc = (original_filename: string, o: { product_name?: string | null; insurer?: string | null; document_role?: string | null } = {}) =>
    ({ product_name: o.product_name ?? null, original_filename, insurer: o.insurer ?? null, document_role: o.document_role ?? null, policy_number: null });
  const travel = doc("output_202609281146157.pdf", { insurer: "Example General Pte. Ltd.", document_role: "endorsement" });
  assert.equal(readablePlanName("Output 202609281146157", "wording", travel), "Example General endorsement");
  assert.equal(readablePlanName("Output 202609281146157 · Travel", "schedule", travel), "Example General endorsement · Travel");
  assert.equal(readablePlanName("817d6e8b 874f 4527 A45d 05e03adaf14c", "wording", doc("817d6e8b-874f-4527-a45d-05e03adaf14c.pdf", { insurer: "Example Life", document_role: "policy_wording" })), "Example Life policy wording");
  // A file name a person chose is made readable; with a product name, the product name is used.
  assert.equal(readablePlanName("InformationBookletForTheNewlyInsured.pdf", "wording", doc("InformationBookletForTheNewlyInsured.pdf")), "Information Booklet For The Newly Insured");
  assert.equal(readablePlanName("my_shield_plan", "wording", doc("my_shield_plan.pdf", { product_name: "Example Shield Plan" })), "Example Shield Plan");
  // Kept: a printed plan name, a plan a person typed, a row with no document.
  assert.equal(readablePlanName("GROUP TERM LIFE · Death", "schedule", travel), "GROUP TERM LIFE · Death");
  assert.equal(readablePlanName("Hospitalisation", "wording", travel), "Hospitalisation");
  assert.equal(readablePlanName("Output 202609281146157", "person", travel), "Output 202609281146157");
  assert.equal(readablePlanName("Output 202609281146157", "wording", null), "Output 202609281146157");
  // A printed code is never the file name; a short name a person gave the file is kept as typed.
  assert.equal(readablePlanName("XK4", "wording", doc("IMG_2041.jpg", { insurer: "Example Life" })), "XK4");
  assert.equal(readablePlanName("G007500 · Death", "schedule", doc("IMG_2041.jpg")), "G007500 · Death");
  assert.equal(readablePlanName("eShield", "wording", doc("eShield.pdf", { insurer: "Example Life" })), "eShield");
  assert.equal(readablePlanName("Travel_cover_2026", "wording", doc("Travel_cover_2026.pdf", { product_name: "Example Voyager Plus" })), "Example Voyager Plus");
});

test("the Coverage ledger loads stored rows with the readable plan", async () => {
  const db = await installDatabase();
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Made-up household')", [ACCOUNT]);
  await db.query("INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Ada Okafor','self')", [ADA, ACCOUNT]);
  const pid = id();
  await db.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,document_role,insurer,quarantine_status)
    VALUES($1,$2,$3,'output_202609281146157.pdf','k/1','h1','ready','endorsement','Example General Pte. Ltd.','scan_clean')`, [pid, ACCOUNT, ADA]);
  const { loadLedger } = await import("@/lib/ledger/store");
  await loadLedger(ACCOUNT, [ADA]);
  for (const [plan, origin] of [["Output 202609281146157", "wording"], ["Hospitalisation", "wording"], ["Output 202609281146157", "person"]])
    await db.query("INSERT INTO coverage_rules(account_id,family_member_id,policy_id,plan_name,event_type,origin,status) VALUES($1,$2,$3,$4,'other',$5,'confirmed')", [ACCOUNT, ADA, pid, plan, origin]);
  const rows = await loadLedger(ACCOUNT, [ADA]);
  assert.deepEqual(rows.map((r) => r.shownPlanName).sort(), ["Example General endorsement", "Hospitalisation", "Output 202609281146157"]);
  // Display only: answers, cover keys and the travel filter keep the stored plan, so two documents never merge by name.
  assert.deepEqual(rows.map((r) => r.planName).sort(), ["Hospitalisation", "Output 202609281146157", "Output 202609281146157"]);
  await db.close();
});
