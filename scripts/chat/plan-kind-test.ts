/** New-user walkthrough, round 4 (3 Nov): a question that names a plan by its kind ("Hafiz's travel policy", "Siti's
 * life insurance") must be answered from that plan, for any household, whatever the plan is called.
 *   1. A plan's product name often doesn't say its kind ("Annual Multi-Trip Family", "Jelajah Tahunan", "Level Term"),
 *      so the printed-lines fallback searched every plan the person holds. "What is Amara's life insurance policy
 *      number?" quoted the travel policy's number, and "When does Tom's travel policy start?" quoted the health plan's
 *      "Cover start". A plan is now that kind when its name OR its stored type says so, and a line that only repeats
 *      the kind word ("Puffin Travel - …") answers nothing.
 *   2. "When does Amara's life policy end?" right after a question about the travel plan's baggage was glued onto
 *      the earlier question and answered with the baggage limit. A message that names its own kind of plan is its own
 *      question.
 * The pure checks always run. The real chat (the deterministic stand-in model, no network) also runs when a disposable
 * database is set. The household is made up and pays in RM, with plans named in Malay and English.
 *   npm run -s chat:plan-kind-test   (DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://... adds the database checks) */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|PINECONE/i.test(k)) delete process.env[k];
Object.assign(process.env, { DEARPOLICY_DETERMINISTIC_MODEL: "synthetic-e2e", E2E_RUN_ID: "plankind", MODEL_PRESET: "gemini", GEMINI_API_KEY: "ci" });
delete process.env.DEARPOLICY_BENEFIT_TABLE;
const outbound: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => { outbound.push(String(input)); throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const { planKindDocs, planKindWords } = await import("@/lib/chat/document-questions");
  const D = (product: string, type: string | null) => ({ product, type });
  const docs = [
    D("Annual Multi-Trip Family", "Travel"), D("Jelajah Tahunan", "Travel Insurance"), D("Voyager Gold", null), D("Single Trip Europe", null),
    D("Level Term", "Life"), D("Pelan Hayat Berkala", "Life Insurance"), D("Whole Life Plus", null), D("CareShield Life", "Long-term care"),
    D("Heron Family Health", "Health"), D("MediKad Keluarga", "Medical"), D("Hospital Cash Plan", "Hospital Cash"), D("Travel Medical Plus", "Travel"),
    D("Income Protection", "Disability"), D("Salary Shield", "Income Protection"), D("Accident Guard", "Personal Accident"),
  ];
  const kinds = (q: string) => planKindDocs(q, docs).map((d) => d.product);

  await test("a plan is the kind its stored type says, when its name doesn't say it", () => {
    assert.deepEqual(kinds("When does Tom's travel policy start?"), ["Annual Multi-Trip Family", "Jelajah Tahunan", "Single Trip Europe", "Travel Medical Plus"]);
    assert.deepEqual(kinds("What is Siti's life insurance policy number?"), ["Level Term", "Pelan Hayat Berkala", "Whole Life Plus"]);
    assert.deepEqual(kinds("What's the excess on our health insurance?"), ["Heron Family Health", "MediKad Keluarga"]);
    assert.deepEqual(kinds("what is the policy number of his income protection?"), ["Income Protection", "Salary Shield"]);
  });
  await test("a kind is never another kind that shares a word with it", () => {
    // Long-term care is not term life; a hospital cash plan and a travel medical plan are not health insurance.
    assert.ok(!kinds("her term life policy").includes("CareShield Life"));
    assert.ok(!kinds("our medical insurance").includes("Hospital Cash Plan"));
    assert.ok(!kinds("our medical insurance").includes("Travel Medical Plus"));
    // "Permanent health insurance" is income protection (UK), not a health plan.
    assert.deepEqual(kinds("what does his permanent health insurance pay?"), ["Income Protection", "Salary Shield"]);
  });
  await test("a question that names no kind names no plan", () => {
    for (const q of ["What is the policy number?", "When does it end?", "How much is the premium?", "Is Siti covered for dengue?"]) assert.deepEqual(kinds(q), [], q);
  });
  await test("the words that name the kind say which plan, never what on it", () => {
    assert.ok(planKindWords("When does Tom's travel policy start?", D("Annual Multi-Trip Family", "Travel")).includes("travel"));
    assert.deepEqual(planKindWords("When does Tom's travel policy start?", D("Level Term", "Life")), []);
  });

  const url = process.env.DATABASE_URL ?? "";
  if (process.env.DEARPOLICY_DISPOSABLE_DB === "1" && /@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
    const { query } = await import("@/lib/db/client");
    const { askContextualDearPolicy } = await import("@/lib/chat/workflow");
    const A = randomUUID();
    try {
      await query("INSERT INTO accounts(id,name) VALUES($1,'Test household plan kinds')", [A]);
      const ids: Record<string, string> = {};
      for (const [n, r] of [["Siti Rahman", "self"], ["Hafiz Ismail", "spouse"], ["Aina Ismail", "child"]])
        ids[n] = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,$3) RETURNING id", [A, n, r])).rows[0].id;
      const doc = async (owner: string, people: string[], insurer: string, product: string, number: string, type: string, page: string) => {
        const id = randomUUID();
        await query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,quarantine_status,file_hash,benefits_indexed_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,'personal_schedule',true,95,'ready',$8,$8,'scan_clean',$9,now())`, [id, A, ids[owner], insurer, product, number, type, `${id}.pdf`, "sha256:" + id]);
        for (const p of people) await query("INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)", [id, ids[p], A]);
        await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [A, id, page]);
        return id;
      };
      const all = ["Siti Rahman", "Hafiz Ismail", "Aina Ismail"];
      // Uploaded first, so it is first in the household's documents: on a tie it would win.
      const travel = await doc("Siti Rahman", all, "Contoh Takaful Berhad", "Jelajah Tahunan Keluarga", "JT-44120", "Travel",
        "Contoh Takaful - Jelajah Tahunan Keluarga (Asia)\nPolicy number: JT-44120\nPersons covered: Siti Rahman, Hafiz Ismail, Aina Ismail\nPeriod: 01/06/2026 to 31/05/2027\nOverseas medical expenses\tRM 500,000\nLoss of baggage and personal belongings\tRM 3,000 per person");
      await doc("Siti Rahman", all, "Contoh Health Berhad", "MediKad Keluarga", "MK-9013", "Medical",
        "MediKad Keluarga - Membership certificate\nMembership number: MK-9013\nMembers: Siti Rahman, Hafiz Ismail, Aina Ismail\nCover start: 01/01/2026\nRoom and board\tRM 250 per day");
      await doc("Siti Rahman", ["Siti Rahman"], "Contoh Life Berhad", "Pelan Hayat Berkala", "PH 7720 115", "Life",
        "Pelan Hayat Berkala - Policy schedule\nPolicy number: PH 7720 115\nLife assured: Siti Rahman\nStart date: 1 March 2024\nSum assured\tRM 400,000\nMonthly premium\tRM 96.40");
      const ask = (question: string, conversationId?: string) => askContextualDearPolicy({ accountId: A, familyMemberId: null, scope: "family", question, ...(conversationId ? { conversationId } : {}) });
      const said = (r: Awaited<ReturnType<typeof ask>>) => [r.answer.summary, ...(r.answer.details ?? []), ...(r.answer.policyStatedLimits ?? []).map((l) => l.benefitTitle + " " + l.amountText)].join("\n");

      await test("database: 'Siti's life insurance policy number' is the life plan's, not the travel plan's", async () => {
        const text = said(await ask("What is Siti's life insurance policy number?"));
        assert.match(text, /PH 7720 115/, text);
        assert.doesNotMatch(text, /JT-44120|MK-9013/, text);
      });
      await test("database: 'when does Hafiz's travel policy start' never quotes another plan's start date or the travel plan's title", async () => {
        const text = said(await ask("When does Hafiz's travel policy start?"));
        assert.doesNotMatch(text, /Cover start|01\/01\/2026|MediKad|Pelan Hayat|1 March 2024/, text);
        assert.doesNotMatch(text, /Contoh Takaful - Jelajah/, text);
      });
      await test("database: a question naming another kind of plan, after a travel question, is never answered with the travel plan's lines", async () => {
        const first = await ask("What does Hafiz's travel insurance cover for baggage?");
        assert.match(said(first), /RM ?3,000/, said(first));
        const conv = first.answer.conversationId;
        assert.ok(conv, "the question has a chat");
        const second = await ask("When does Siti's life policy end?", conv);
        const text = said(second);
        assert.doesNotMatch(text, /baggage|RM ?3,000|Jelajah/i, text);
        assert.deepEqual((second.answer.policyStatedLimits ?? []).map((l) => l.amountText), [], text);
      });
      await test("database: a short follow-up about the same plan still carries over ('when does it end?' after the travel question)", async () => {
        await query("UPDATE policies SET effective_date='2026-06-01',renewal_or_expiry_date='2027-05-31' WHERE id=$1", [travel]);
        const first = await ask("What does Hafiz's travel insurance cover for baggage?");
        const text = said(await ask("when does it end?", first.answer.conversationId));
        assert.match(text, /Period: 01\/06\/2026 to 31\/05\/2027/, text);
        assert.doesNotMatch(text, /Pelan Hayat|MediKad/, text);
      });
    } finally {
      await query("DELETE FROM accounts WHERE id=$1", [A]).catch(() => undefined);
    }
  } else console.log("plan kinds: database checks skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run them)");

  await test("no request tried to leave this machine", () => assert.deepEqual(outbound, []));
  console.log(`plan kinds: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  process.exit(failures.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
