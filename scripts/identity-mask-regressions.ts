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
