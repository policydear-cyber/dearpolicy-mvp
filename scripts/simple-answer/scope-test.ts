/**
 * The simple chat's cost per question (live 8 Nov: US$1.01 for one question about one person): a question that names
 * exactly one member is sent only that member's documents and every shared one in full (lib/simple-chat/scope.ts), and
 * the library is written to the prompt cache only from a conversation's second question (lib/simple-chat/model.ts).
 * Made-up household; no model is called. The token counts are estimates (characters / 4) of what each call sends.
 */
import assert from "node:assert/strict";
import { renderLibrary, type Household, type HouseholdDocument } from "../../lib/simple-chat/library";
import { onePersonNamed, scopeFor, SCOPED_OUT } from "../../lib/simple-chat/scope";
import { runSimpleChat } from "../../lib/simple-chat/hook";
import type { SimpleModel, SimpleModelCall, Turn } from "../../lib/simple-chat/model";
import type { ChatContext } from "../../lib/chat/workflow";

let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log("ok - " + name); } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

const filler = (label: string, n: number) => Array.from({ length: n }, (_, i) => `${label} clause ${i + 1}: the insurer pays the reasonable and customary charges described in this section.`).join("\n");
const doc = (policyId: string, name: string, linkedPeople: string[], pages: string[], uploadedFor: string | null = null): HouseholdDocument => ({
  policyId, name, insurer: "Testlife", productName: name.replace(/\.pdf$/, ""), policyNumber: null, documentType: null, documentRole: null, effectiveDate: null,
  expiryDate: null, uploadedAt: "2026-09-01", uploadedFor, linkedPeople, supersededAt: null, processingStatus: "ready", pages: pages.map((text, i) => ({ page: i + 1, text })) });
const AK = "bbbbbbbb-0000-0000-0000-000000000001", ML = "bbbbbbbb-0000-0000-0000-000000000002", WEI = "bbbbbbbb-0000-0000-0000-000000000003",
  FAM = "bbbbbbbb-0000-0000-0000-000000000004", RCPT = "bbbbbbbb-0000-0000-0000-000000000005", MLW = "bbbbbbbb-0000-0000-0000-000000000006";
const HOUSE: Household = {
  accountId: "22222222-2222-2222-2222-222222222222",
  members: [{ name: "Lim Ah Kow (Ken Lim)", relationship: "self" }, { name: "Tan Mei Ling", relationship: "spouse" }, { name: "Lim Wei", relationship: "child" }],
  documents: [
    doc(AK, "Ah Kow hospital plan.pdf", ["Lim Ah Kow"], ["AKPAGE Ward cash S$100 per day", filler("AK", 400)]),
    doc(ML, "Mei Ling shield.pdf", ["Tan Mei Ling"], ["MLPAGE Ambulance up to S$300 per incident", filler("ML", 400)]),
    doc(WEI, "Wei accident plan.pdf", ["Lim Wei"], ["WEIPAGE Ambulance Cost Up to S$500 per incident", "WEIRULE Waiting period: 30 days."]),
    doc(FAM, "Family travel.pdf", ["Lim Ah Kow", "Tan Mei Ling", "Lim Wei"], ["FAMPAGE Trip cancellation S$5,000", filler("FAM", 100)]),
    doc(RCPT, "Receipt.pdf", [], ["RCPTPAGE Premium received S$120.00"]),
    // Mei Ling's own plan that also pays for her child: a row of the table names Wei, so it is sent for Wei.
    doc(MLW, "Mei Ling family rider.pdf", [], ["MLWPAGE Rider hospital cash S$50 per day"], "Tan Mei Ling"),
  ],
};
const ALL = new Set(HOUSE.documents.map((d) => d.policyId));
const tokens = (s: string) => Math.ceil(s.length / 4);

async function main() {
  await check("exactly one member named, by their whole name or whole preferred name: that member; anything else: nobody", () => {
    for (const [q, who] of [
      ["What does Lim Wei get for an ambulance?", "Lim Wei"], ["Is LIM WEI covered for ambulance?", "Lim Wei"], ["How much hospital cash for Lim Ah Kow?", "Lim Ah Kow (Ken Lim)"],
      ["Ken Lim broke his arm, how much?", "Lim Ah Kow (Ken Lim)"], ["Tan Mei Ling's ambulance limit?", "Tan Mei Ling"], ["Actually it is for Tan Mei Ling.", "Tan Mei Ling"],
    ] as const) assert.equal(onePersonNamed(q, HOUSE), who, q);
    for (const q of [
      // One word of a name never scopes (Critic P393 B: name words are often ordinary words, or shared).
      "What does Wei get for an ambulance?", "Mei Ling's ambulance limit?", "How much hospital cash for Ah Kow?", "What does Lim get?", "Ken broke his arm",
      "Tan Mei Ling and Wei, ambulance?", "Lim Wei's ambulance, and Ah Kow's?",
      "What about Wei and Mei Ling?", "Ambulance cover for Wei and Ken", // two members
      "What does my wife get?", "My son Wei broke his arm", "Can I claim for Wei's ambulance?", "We were in an accident, what about Wei?",
      "Does Wei have the same cover?", "What about Mei Ling too?", "Compare Wei's cover with Ken's", "Is Wei covered as well?", "Anyone covered for ambulance?",
      "Who is covered for ambulance?", "What is the waiting period?", "Ambulance cover for the family?", "Both of them, Wei", "Wei and everyone else",
    ]) assert.equal(onePersonNamed(q, HOUSE), null, q);
  });

  await check("the documents kept for one person: their own, shared, unlinked, and any that hold a row of theirs", () => {
    const keep = (q: string, rows: Parameters<typeof scopeFor>[2] = null) => [...(scopeFor(q, HOUSE, rows)?.keep ?? ALL)].sort();
    assert.deepEqual(keep("What does Lim Wei get for an ambulance?"), [WEI, FAM, RCPT].sort());
    // Uploaded for Mei Ling alone: left out for Wei, unless the table prints a row of Wei's from it.
    assert.deepEqual(keep("What does Lim Wei get for an ambulance?", [{ person: "Lim Wei", source: { documentId: MLW } }]), [WEI, FAM, RCPT, MLW].sort());
    // A row of another person's in a document for one member keeps it in too (it is not that member's alone).
    assert.deepEqual(keep("Hospital cash for Ken Lim?", [{ person: "Lim Wei", source: { documentId: ML } }]), [AK, ML, FAM, RCPT].sort());
    assert.deepEqual(keep("Tan Mei Ling's ambulance limit?"), [ML, FAM, RCPT, MLW].sort());
    for (const q of ["What does my wife get?", "What about Wei and Mei Ling?", "What is the waiting period?"]) assert.equal(scopeFor(q, HOUSE), null, q);
  });

  // Critic P393 A: a dependant named only in the text of a plan linked to the employee alone.
  const mk = (members: [string, string][], docs: HouseholdDocument[]): Household => ({ accountId: "acct", members: members.map(([name, relationship]) => ({ name, relationship })), documents: docs });
  const A = mk([["Lim Ah Kow", "self"], ["Tan Mei Ling", "spouse"], ["Lim Wei", "child"]], [
    doc("gh", "Company group hospital", ["Lim Ah Kow"], ["Employee: Lim Ah Kow\nCovered: Tan Mei Ling, Lim Wei\nWard cash S$100 per day"]),
    doc("gh2", "Company plan for dependants", ["Lim Ah Kow"], ["Employee: Lim Ah Kow\nYour dependants are covered too.\nWard cash S$100 per day"]),
    doc("ml", "Mei Ling shield", ["Tan Mei Ling"], ["Ambulance up to S$300"]),
  ]);
  const leftOut = (h: Household, q: string, rows: Parameters<typeof scopeFor>[2] = null) => { const sc = scopeFor(q, h, rows); return sc ? h.documents.filter((d) => !sc.keep.has(d.policyId)).map((d) => d.policyId) : []; };
  await check("Critic P393 A1-A4: a plan that names the person, or covers dependants, is never left out", () => {
    assert.deepEqual(leftOut(A, "Is Mei Ling covered for a hospital stay?"), [], "A1");
    assert.deepEqual(leftOut(A, "Does Wei get ward cash?"), [], "A2");
    assert.deepEqual(leftOut(A, "Does Wei get ward cash?", [{ person: "Lim Ah Kow", source: { documentId: "gh" } }]), [], "A3");
    assert.deepEqual(leftOut(A, "Tan Mei Ling dental cover?"), [], "A4");
    assert.deepEqual(leftOut(A, "Lim Wei ward cash?", [{ person: "Lim Ah Kow", source: { documentId: "gh" } }]), ["ml"], "A3 by whole name");
    // Named in another spelling and order ("WEI LIM"), or on a later page: still kept.
    const A5 = mk([["Lim Ah Kow", "self"], ["Lim Wei", "child"]], [doc("p", "Plan", ["Lim Ah Kow"], ["Employee: Lim Ah Kow", "Also insured: WEI LIM"])]);
    assert.deepEqual(leftOut(A5, "Lim Wei ward cash?"), [], "A5");
  });
  // Critic P393 B: name words that are ordinary words.
  const B = mk([["Max Lee", "self"], ["Low Siew Ling", "spouse"], ["Lim Ah Kow", "father"], ["Bill Ong", "child"], ["May Tan", "mother"]], [
    doc("max", "Max term life", ["Max Lee"], ["Death S$500,000"]), doc("low", "Siew Ling shield", ["Low Siew Ling"], ["Ward B1"]),
    doc("ak", "Ah Kow hospital", ["Lim Ah Kow"], ["Ward cash S$100 per day"]), doc("bill", "Bill accident", ["Bill Ong"], ["Fracture S$2,000"]),
    doc("may", "May Tan hospital", ["May Tan"], ["Ward cash S$80 per day"]),
  ]);
  await check("Critic P393 B1-B7: an ordinary word that is also a name word never scopes", () => {
    for (const [id, q] of [["B1", "What's the max ward cash for a hospital stay?"], ["B2", "Why is the payout so low?"], ["B3", "Can claim the hospital stay ah?"], ["B4", "Is this bill covered?"],
      ["B5", "Surgery in May, how much can claim?"], ["B6", "How long is the waiting period?"], ["B7", "Hospital bill S$3,000, how much back?"]]) {
      assert.equal(scopeFor(q, B), null, `${id}: ${q}`);
      assert.deepEqual(leftOut(B, q), [], id);
    }
    // A whole name said with another member's name word beside it is unsure too ("Max Lee's bill").
    assert.equal(scopeFor("Max Lee's hospital bill?", B), null);
    assert.equal(scopeFor("Max Lee ward cash?", B)?.person, "Max Lee");
  });

  await check("a scoped library lists every document but sends only the kept ones' pages; an unscoped one is unchanged", () => {
    const scope = scopeFor("What does Lim Wei get for an ambulance?", HOUSE)!;
    const lib = renderLibrary(HOUSE, undefined, scope);
    for (const kept of ["WEIPAGE", "WEIRULE", "FAMPAGE", "RCPTPAGE"]) assert.match(lib, new RegExp(kept));
    for (const out of ["AKPAGE", "MLPAGE", "MLWPAGE"]) assert.doesNotMatch(lib, new RegExp(out));
    // Every document is still listed by name, with its pages counted as left out.
    for (const d of HOUSE.documents) assert.ok(lib.includes(`name="${d.name}"`), d.name);
    assert.equal(lib.split(SCOPED_OUT).length - 1, 3);
    assert.match(lib, /<scope_note>This question names only Lim Wei\./);
    assert.equal(renderLibrary(HOUSE, undefined, null), renderLibrary(HOUSE));
    assert.doesNotMatch(renderLibrary(HOUSE), /scope_note|belongs to another household member/);
  });

  // Through the app's chat turn (table off), turn by turn, with a scripted model that records what each call is sent.
  const calls: SimpleModelCall[] = [];
  const model: SimpleModel = { choice: { provider: "anthropic", model: "test" }, async call(c) { calls.push(c);
    return { json: { bottomLine: "The pages say so.", nextSteps: [], question: null, statements: [] }, stopReason: "end_turn", model: "test", usage: { input: 1, cacheWrite: 0, cacheRead: 0, output: 1 } }; } };
  const ask = async (message: string, history: Turn[], scope = true) => {
    const context = { request: { accountId: HOUSE.accountId, familyMemberId: null, question: message, submittedQuestion: message },
      family: [{ id: "m1", display_name: "Lim Ah Kow", preferred_name: "Ken", relationship: "self" }], people: [],
      conversation: { id: "c1", account_id: HOUSE.accountId, family_member_id: null, title: "t", revision: 1, state: { subjects: {} } }, token: {}, holdings: [] } as unknown as ChatContext;
    await runSimpleChat(context, {}, { model, household: async () => HOUSE, history: async () => history, table: async () => null, save: (async () => {}) as never, ledger: false,
      today: () => new Date("2026-11-08T04:00:00Z"), scope });
    return calls.at(-1)!;
  };
  const sizes: string[] = [];
  await check("a conversation that moves from one person to another re-scopes each turn; a message naming nobody sends everything", async () => {
    const full = await ask("What is the waiting period?", [], false);
    const t1 = await ask("What does Lim Wei get for an ambulance?", []);
    assert.match(t1.library, /WEIPAGE/);
    assert.doesNotMatch(t1.library, /AKPAGE|MLPAGE/);
    const h1: Turn[] = [{ role: "user", text: "What does Lim Wei get for an ambulance?" }, { role: "assistant", text: "Up to S$500 an incident." }];
    // A correction to another person: scoped to that person, never to the earlier one.
    const t2 = await ask("Sorry, Tan Mei Ling's ambulance limit.", h1);
    assert.match(t2.library, /MLPAGE/);
    assert.doesNotMatch(t2.library, /WEIPAGE|AKPAGE/);
    const h2: Turn[] = [...h1, { role: "user", text: "Sorry, Tan Mei Ling's ambulance limit." }, { role: "assistant", text: "Up to S$300." }];
    // Nobody named (a follow-up), or two people, or "my": the whole library, whatever earlier messages named.
    for (const m of ["And the waiting period?", "What about Wei and Mei Ling?", "What does my wife get?"]) assert.equal((await ask(m, h2)).library, full.library, m);
    sizes.push(`whole library ~${tokens(full.library)} tokens`, `scoped to Wei ~${tokens(t1.library)}`, `scoped to Mei Ling ~${tokens(t2.library)}`);
    assert.ok(tokens(t1.library) < tokens(full.library) / 5, sizes.join(", "));
  });

  await check("the library is cached only from a conversation's second question", async () => {
    assert.equal((await ask("What does Lim Wei get for an ambulance?", [])).cache, false);
    // A stray assistant turn alone is no earlier question.
    assert.equal((await ask("What does Lim Wei get for an ambulance?", [{ role: "assistant", text: "Hello." }])).cache, false);
    assert.equal((await ask("And Tan Mei Ling?", [{ role: "user", text: "What does Wei get?" }, { role: "assistant", text: "S$500." }])).cache, true);
  });

  console.log(`(estimated per call: ${sizes.join(", ")})`);
  console.log(`simple-chat scope: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  if (failures.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
