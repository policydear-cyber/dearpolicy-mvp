/**
 * Identity numbers in chat answers are masked for every chat path and every market: at save time (lib/chat/store.ts
 * saveTurn, through a fake database pool that records what would be written) and when an answer saved before the rule is
 * reopened (sanitizeStoredAnswer). Made-up numbers only. No database, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

type Sent = { sql: string; params: unknown[] };
const sent: Sent[] = [];
const fakeClient = {
  query: async (sql: string, params: unknown[] = []) => {
    sent.push({ sql, params });
    if (/FROM chat_history_epochs/.test(sql)) return { rows: [{ scope_key: "*", epoch: "0" }, { scope_key: "p", epoch: "0" }] };
    if (/^UPDATE chat_conversations/.test(sql)) return { rows: [{ id: "c1" }] };
    return { rows: [] };
  },
  release: () => {},
};
(globalThis as unknown as { dearPolicyPool: unknown }).dearPolicyPool = { connect: async () => fakeClient, query: fakeClient.query, on: () => {} };

// Loaded after the fake pool is in place, so the store never opens a real connection.
const load = async () => ({ ...(await import("@/lib/chat/identity-numbers")), ...(await import("@/lib/chat/store")), ...(await import("@/lib/chat/monetary-boundary")) });

const FULL_IDS = [/\b[STFGM]\d{7}[A-Z]\b/, /\b\d{6}-\d{2}-\d{4}\b/, /\b\d{3}-\d{2}-\d{4}\b/, /[A-Z]\d{6}\([0-9A]\)/, /AB123456C/, /E7654321K/, /1234 5678 9012/];
const noFullId = (text: string) => FULL_IDS.forEach((re) => assert.doesNotMatch(text, re, `full identity number left in: ${text.slice(0, 200)}`));

test("each market's identity number shape is masked, keeping what the certificate prints", async () => {
  const { maskIdentityText } = await load();
  assert.equal(maskIdentityText("NRIC S1234567D"), "NRIC S****567D");
  assert.equal(maskIdentityText("FIN G7654321X and T1234567J"), "FIN G****321X and T****567J");
  assert.equal(maskIdentityText("MyKad 850101-14-5678"), "MyKad ******-**-5678");
  assert.equal(maskIdentityText("HKID A123456(7)"), "HKID A***456(7)");
  assert.equal(maskIdentityText("SSN 123-45-6789"), "SSN ***-**-6789");
  assert.equal(maskIdentityText("National Insurance number: AB123456C."), "National Insurance number: *****456C.");
  assert.equal(maskIdentityText("NI No. AB123456C"), "NI No. *****456C");
  assert.equal(maskIdentityText("Passport No: E7654321K issued 2020"), "Passport No: *****321K issued 2020");
  assert.equal(maskIdentityText("his passport number is E7654321K"), "his passport number is *****321K");
  assert.equal(maskIdentityText("Aadhaar 1234 5678 9012"), "Aadhaar **** **** 9012");
  assert.equal(maskIdentityText("IC No. 850101145678"), "IC No. ********5678");
  assert.equal(maskIdentityText("ID No. S1234567D"), "ID No. S****567D");
  // Joined to a file name by "_" (TE pr153 F1).
  assert.equal(maskIdentityText("Certificate_S1234567D.pdf"), "Certificate_S****567D.pdf");
  assert.equal(maskIdentityText("scan_850101-14-5678_ic.jpg"), "scan_******-**-5678_ic.jpg");
  assert.equal(maskIdentityText("hkid_A123456(7).png"), "hkid_A***456(7).png");
  assert.equal(maskIdentityText("XS1234567DY"), "XS1234567DY");
  // Printed in groups, and Malaysian labels (Critic R262 L1).
  assert.equal(maskIdentityText("NI number QQ 12 34 56 C"), "NI number ** ** *4 56 C");
  assert.equal(maskIdentityText("No. K/P 850101145678"), "No. K/P ********5678");
  assert.equal(maskIdentityText("Kad Pengenalan: 850101145678"), "Kad Pengenalan: ********5678");
  assert.equal(maskIdentityText("Birth Certificate No. 150101145678"), "Birth Certificate No. ********5678");
});

test("policy, member and claim numbers, amounts, dates and ids are not identity numbers", async () => {
  const { maskIdentityText } = await load();
  for (const text of [
    "Policy 3037850, S$1,000,000, G007500, A12345678B.",
    "Policy No. 1234567890 and Policy ID No. 7654321",
    "Member ID: 12345678, card ID 99887766",
    "ID: 1234567 on the membership card",
    "Claim reference 2026-10-27, ICU 12345 days",
    "Certificate No. 850101145678",
    "id 8e5c6d59-9899-4d47-a16e-1ba7b3b8016b",
    "Admitted 01/10/2026, discharged 2026-10-05; call 6123 4567",
    "Japan trip PAN-asian 12345",
    "NRIC S****567D already masked",
    // A label word that starts a sentence about something else (Critic R262 H1).
    "Identity theft cover up to 50000 per trip",
    "Passport replacement costs 25000",
    "the NRIC holder may claim 10000 per year",
    "National Insurance at 12500 a year",
    // A dashed reference that is not a birth-dated MyKad, and an unlabelled SSN-shaped reference (Critic R262 M1).
    "Group policy 123456-78-0001",
    "Claim reference 123-45-6789",
  ]) assert.equal(maskIdentityText(text), text);
});

test("masking twice changes nothing more", async () => {
  const { maskIdentityText } = await load();
  const once = maskIdentityText("NRIC S1234567D, NI number AB123456C, SSN 123-45-6789");
  assert.equal(maskIdentityText(once), once);
});

test("saveTurn masks the answer, its citations and the turn state before anything is written or returned, for any chat path", async () => {
  const { saveTurn } = await load();
  sent.length = 0;
  const answer = {
    mode: "answer", summary: "The certificate lists S1234567D.", details: ["NI number AB123456C"], claimItems: [], nextSteps: ["Quote passport no. E7654321K"],
    confidence: "supported", missingFacts: [],
    citations: [{ policyId: "p1", page: 3, excerpt: "Name Lim Mei Ling NRIC S1234567D Plan A MyKad 850101-14-5678" }],
  };
  const state = { simpleChat: { turns: [{ report: { dropped: [{ text: "Identity Number : S1234567D" }] } }] } };
  await saveTurn({
    conversation: { id: "c1", account_id: "a1", family_member_id: null, revision: 1, state: {} } as never,
    token: { scopeKey: "p", global: 0, profile: 0 } as never,
    state: state as never, message: "what does my certificate say", answer: answer as never,
  });
  assert.ok(sent.some((s) => /^INSERT INTO chat_messages/.test(s.sql)), "the turn was written");
  for (const s of sent) noFullId(JSON.stringify(s.params));
  // The answer handed back to the household is the masked one.
  noFullId(JSON.stringify(answer));
  assert.match(answer.citations[0].excerpt, /NRIC S\*\*\*\*567D/);
  // The household's own question is kept as they wrote it.
  const insert = sent.find((s) => /^INSERT INTO chat_messages/.test(s.sql))!;
  assert.equal(insert.params[3], "what does my certificate say");
});

test("an answer saved before masking is masked when reopened, and the stored value is not changed", async () => {
  const { maskIdentityNumbers, sanitizeStoredAnswer } = await load();
  const stored = {
    mode: "answer", summary: "Cover is listed.", details: [], claimItems: [], nextSteps: [], missingFacts: [], confidence: "supported",
    citations: [{ policyId: "p1", page: 1, excerpt: "Insured S1234567D Group Term Life" }],
    statements: [{ text: "The schedule prints S1234567D" }],
  };
  const before = JSON.stringify(stored);
  const shown = sanitizeStoredAnswer(stored);
  noFullId(JSON.stringify(shown));
  assert.equal(JSON.stringify(stored), before);
  // A finished job's stored result ({answer}) and a shape that is not an answer are masked too.
  noFullId(JSON.stringify(sanitizeStoredAnswer({ answer: stored, retrieved: [] })));
  noFullId(JSON.stringify(sanitizeStoredAnswer({ note: "S1234567D" })));
  assert.deepEqual(maskIdentityNumbers({ n: 5, s: "S1234567D" }), { n: 5, s: "S****567D" });
});

// Summary screens (Coverage, the benefit table, the benefit schedule) send stored quotes to the browser: a travel summary's
// cover line prints each traveller's ID number beside their name (audit of 1912d73), so those routes mask as chat does.
test("a summary screen's quotes are masked in every market; ids and keys stay exactly as stored", async () => {
  const { maskShownText } = await load();
  const { assembleTable, coverKeyOf, sectionKeyOf } = await import("@/lib/benefit-table/assemble");
  const { checkReading } = await import("@/lib/benefit-table/check");
  for (const id of ["S1234567D", "850101-14-5678", "A123456(7)"]) {
    const DOC = "bbbbbbbb-0000-4000-8000-000000000002";
    const pages = [{ page: 1, text: `TRAVEL INSURANCE SUMMARY\nInsured persons\tID number\tPre-existing\nLim Ah Kow\t${id}\tNo\nPersonal accident\tS$300,000` }];
    const reading = { document: { kind: "personal_proof", product: "Travel insurance summary", insurer: "Example General", namedPeople: ["Lim Ah Kow"], plan: "Business", periodFrom: null, periodTo: null },
      covers: [{ person: "Lim Ah Kow", product: "Travel insurance summary", cover: "Single Trip", plan: "Business", sumInsured: null, asOf: null, page: 1, quote: `Lim Ah Kow\t${id}\tNo` }],
      benefits: [{ section: null, column: null, benefit: "Personal accident", pays: "amount", value: 300000, percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, quote: "Personal accident\tS$300,000" }] };
    const r = checkReading({ id: DOC, name: "Travel.pdf", readable: true, pages, people: ["Lim Ah Kow"] }, reading);
    const cover = coverKeyOf({ product: "Travel insurance summary", cover: "Single Trip", plan: "Business" });
    const table = assembleTable([r], [{ id: "p1", display_name: "Lim Ah Kow" }], [{ section: sectionKeyOf(DOC, { section: null, column: null }), cover, why: "x" }]);
    const before = JSON.stringify(table);
    assert.ok(before.includes(id), "the made-up ID number is in the assembled table, as a stored travel summary's is");
    const shown = maskShownText(table);
    noFullId(JSON.stringify(shown));
    assert.equal(JSON.stringify(table), before, "the value passed in is not changed");
    // Every id and key the browser sends back is exactly the stored one.
    const keys = (v: unknown, out: string[] = []): string[] => { if (Array.isArray(v)) v.forEach((x) => keys(x, out)); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (/^(?:id|key)s?$|_(?:id|key)s?$|(?:Id|Key)s?$/.test(k)) out.push(`${k}=${JSON.stringify(x)}`); keys(x, out); } return out; };
    assert.deepEqual(keys(shown), keys(table));
    assert.ok(keys(table).length > 3);
  }
  // A field that identifies a row is never rewritten, even when it holds an ID's shape; the words beside it are masked.
  assert.deepEqual(maskShownText({ id: "S1234567D", policy_id: "S1234567D", coverKey: "x S1234567D", documentIds: ["S1234567D"], quote: "S1234567D", rows: [{ excerpt: "NRIC S1234567D", n: 3, ok: true, none: null }] }),
    { id: "S1234567D", policy_id: "S1234567D", coverKey: "x S1234567D", documentIds: ["S1234567D"], quote: "S****567D", rows: [{ excerpt: "NRIC S****567D", n: 3, ok: true, none: null }] });
});

test("the Coverage, benefit table, benefit schedule, Home and document review routes send only masked text", async () => {
  const { readFileSync } = await import("node:fs");
  for (const file of ["app/api/coverage/route.ts", "app/api/benefit-table/route.ts", "app/api/benefits/route.ts", "app/api/dashboard/route.ts", "app/api/policies/[id]/route.ts"]) {
    const src = readFileSync(file, "utf8");
    const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function", src.indexOf("export async function GET") + 10) >>> 0 || undefined);
    // Each successful GET response is masked; only error bodies, which print no stored text, are not.
    const plain = [...get.matchAll(/NextResponse\.json\((?!maskShownText\()([^)]{0,80})/g)].map((m) => m[1]).filter((a) => !/^\{\s*(?:error|enabled:false|benefits:\[\],summary|family:\[\],activeMember:null)/.test(a));
    assert.deepEqual(plain, [], `${file} sends unmasked text`);
    assert.match(get, /NextResponse\.json\(maskShownText\(/, file);
  }
});

test("a masked name a screen sends back never replaces the stored name; a name the household typed does", async () => {
  const { maskShownText, sentName } = await load();
  const stored = "Personal accident - Lim Ah Kow S1234567D";
  const shown = maskShownText({ benefitName: stored }).benefitName;
  assert.notEqual(shown, stored);
  assert.equal(sentName(shown, stored), undefined, "the masked copy is not saved over the stored name");
  assert.equal(sentName(stored, stored), stored);
  assert.equal(sentName("Accident cover", stored), "Accident cover");
  assert.equal(sentName(undefined, stored), undefined);
  // A name with no ID number is the same masked or not: sent back unchanged, it is kept as sent.
  assert.equal(sentName("Hospital cash", "Hospital cash"), "Hospital cash");
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("app/api/benefits/route.ts", "utf8");
  const patch = src.slice(src.indexOf("export async function PATCH"));
  assert.match(patch, /body\.benefitName=sentName\(body\.benefitName,existing\.rows\[0\]\.benefit_name\)/);
  assert.ok(patch.indexOf("sentName(") < patch.indexOf("UPDATE policy_benefits"), "the name is decided before anything is written");
});
