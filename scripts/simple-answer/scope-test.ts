/**
 * The simple chat's cost per question (live 8 Nov: US$1.01 for one question about one person): a question that names
 * exactly one member, as a conversation's first question, is sent only that member's documents and every shared one in
 * full, uncached, when that is at most half the whole library (lib/simple-chat/scope.ts, hook.ts); every other question
 * is sent the whole library, cached.
 * Made-up household; no model is called. The token counts are estimates (characters / 4) of what each call sends.
 */
import assert from "node:assert/strict";
import { renderLibrary, type Household, type HouseholdDocument } from "../../lib/simple-chat/library";
import { onePersonNamed, scopeFor, SCOPED_OUT, SCOPED_SHARE_MAX } from "../../lib/simple-chat/scope";
import { runSimpleChat } from "../../lib/simple-chat/hook";
import { anthropicRequest, LIBRARY_CACHE_WRITE_RATE, uncachedIfAsked, type SimpleModel, type SimpleModelCall, type Turn } from "../../lib/simple-chat/model";
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
      ["Ken Lim broke an arm, how much?", "Lim Ah Kow (Ken Lim)"], ["Tan Mei Ling ambulance limit?", "Tan Mei Ling"], ["Actually it is for Tan Mei Ling.", "Tan Mei Ling"],
    ] as const) assert.equal(onePersonNamed(q, HOUSE), who, q);
    for (const q of [
      // One word of a name never scopes (Critic P393 B: name words are often ordinary words, or shared).
      "What does Wei get for an ambulance?", "Mei Ling's ambulance limit?", "How much hospital cash for Ah Kow?", "What does Lim get?", "Ken broke his arm",
      "Tan Mei Ling and Wei, ambulance?", "Lim Wei's ambulance, and Ah Kow's?",
      // A possessive or a joining word may bring in someone else (Critic P395 H); a whole name in lower case may be ordinary words (P395 J).
      "Ken Lim broke his arm, how much?", "Tan Mei Ling's ambulance limit?", "tan mei ling ambulance limit?",
      "What about Wei and Mei Ling?", "Ambulance cover for Wei and Ken", // two members
      "What does my wife get?", "My son Wei broke his arm", "Can I claim for Wei's ambulance?", "We were in an accident, what about Wei?",
      "Does Wei have the same cover?", "What about Mei Ling too?", "Compare Wei's cover with Ken's", "Is Wei covered as well?", "Anyone covered for ambulance?",
      "Who is covered for ambulance?", "What is the waiting period?", "Ambulance cover for the family?", "Both of them, Wei", "Wei and everyone else",
    ]) assert.equal(onePersonNamed(q, HOUSE), null, q);
  });

  await check("the documents kept for one person: their own, shared, unlinked, and any that hold a row of theirs", () => {
    const keep = (q: string, rows: Parameters<typeof scopeFor>[2] = null) => [...(scopeFor(q, HOUSE, rows)?.keep ?? ALL)].sort();
    // Uploaded for Mei Ling alone, but its name says it is a family rider: kept for Wei (Critic P395 F: a word for others
    // covered, in a document's name or pages, keeps it). It is kept, too, when the table prints a row of Wei's from it.
    assert.deepEqual(keep("What does Lim Wei get for an ambulance?"), [WEI, FAM, RCPT, MLW].sort());
    assert.deepEqual(keep("What does Lim Wei get for an ambulance?", [{ person: "Lim Wei", source: { documentId: MLW } }]), [WEI, FAM, RCPT, MLW].sort());
    // A row of another person's in a document for one member keeps it in too (it is not that member's alone).
    assert.deepEqual(keep("Hospital cash for Ken Lim?", [{ person: "Lim Wei", source: { documentId: ML } }]), [AK, ML, FAM, RCPT, MLW].sort());
    assert.deepEqual(keep("Tan Mei Ling ambulance limit?"), [ML, FAM, RCPT, MLW].sort());
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

  // Critic P395 (made-up households).
  const M: [string, string][] = [["Lim Ah Kow", "self"], ["Tan Mei Ling", "spouse"], ["Lim Wei", "child"]];
  const own = [doc("ml", "Mei Ling shield", ["Tan Mei Ling"], ["Ambulance up to S$300"]), doc("lw", "Lim Wei accident", ["Lim Wei"], ["Fracture S$1,000"])];
  await check("Critic P395 F: a plan linked to one member that covers another by given name, initials, a title or a tier is never left out", () => {
    for (const [tag, text] of [
      ["EE+1", "Plan: Employee + 1\nInsured: Lim Ah Kow; Tan M L\nWard cash S$100 per day"], ["initials", "Insured Person 1: Lim Ah Kow\nInsured Person 2: Tan M.L.\nHospital cash S$100 per day"],
      ["travel", "Travellers: Lim Ah Kow, Mei Ling\nOverseas medical S$200,000"], ["joint", "Second Life Assured: Mrs Tan\nDeath S$200,000"],
      ["co-ins", "Named insured: Lim Ah Kow. Co-insured: Mei Ling Tan (wife)\nWard cash S$90 per day"], ["persons", "Insured Person(s): Lim Ah Kow, Mei Ling\nWard cash S$80 per day"],
      ["payor", "Life insured: Lim Wei\nPayor: Mr Lim\nPayor benefit: premiums waived on payor's critical illness"], ["EE+SP", "Coverage tier: EE + SP\nWard cash S$70 per day"],
      ["firstname", "Insured: Lim Ah Kow and Mei Ling\nWard cash S$60 per day"], ["initials only", "Insured 1: Lim Ah Kow\nInsured 2: M.L.\nWard cash S$50 per day"],
    ]) {
      const h = mk(M, [doc("p", `Ah Kow ${tag} plan`, ["Lim Ah Kow"], [text]), ...own]);
      assert.equal(scopeFor("Is Tan Mei Ling covered for a hospital stay?", h)?.person, "Tan Mei Ling", tag);
      assert.deepEqual(leftOut(h, "Is Tan Mei Ling covered for a hospital stay?"), ["lw"], tag);
    }
    // A plain plan of another member's alone, that says nothing of anyone else, is still left out.
    assert.deepEqual(leftOut(mk(M, [doc("p", "Ah Kow plan", ["Lim Ah Kow"], ["Ward cash S$100 per day"]), ...own]), "Is Tan Mei Ling covered for a hospital stay?"), ["p", "lw"]);
  });
  await check("TE #395: a plan linked to the holder alone that may cover anyone else, in any wording, is kept; an unsure word keeps it", () => {
    for (const text of ["Cover under this certificate extends to the policyholder's kids.", "Your partner is covered for ward cash.", "Your parents are covered too.",
      "Immediate relatives of the insured are covered.", "Next of kin: covered for hospital cash.", "Co-insured: covered for ward cash.", "Joint life: second life covered.",
      "The insured and his issue are covered.", "Grandchildren are covered.", "A civil partner is covered.", "A de facto partner is covered.",
      "Household members living with the insured are covered.", "Infants are covered from 15 days old.", "Any insured member may claim.",
      "Cover extends to your little one.", "Cover extends to the insured's ward.", "Cover extends to your nephew.", "Ward cash for each insured.",
      "Plan type: individual + 2.", "Stepchildren are covered."]) {
      for (const q of ["Is Tan Mei Ling covered for a hospital stay?", "Does Lim Wei get ward cash?"]) {
        const h = mk(M, [doc("p", "Ah Kow hospital plan", ["Lim Ah Kow"], ["Ward cash S$100 per day", text]), ...own]);
        assert.ok(scopeFor(q, h), q);
        assert.ok(!leftOut(h, q).includes("p"), `${text} / ${q}`);
      }
    }
    // Wording only about "you", "your" plan, stay or bill, and nobody else: left out for another member.
    const plain = mk(M, [doc("p", "Ah Kow hospital plan", ["Lim Ah Kow"], ["You will be paid ward cash of S$100 per day for your hospital stay.", "We pay your bills after your claim is approved."]), ...own]);
    assert.deepEqual(leftOut(plain, "Is Tan Mei Ling covered for a hospital stay?"), ["p", "lw"]);
    // The question detector: a relative or partner by any word sends everything (TE #395 item 5).
    for (const q of ["Lim Ah Kow boy warded", "Lim Ah Kow girlfriend warded", "Lim Ah Kow missus warded", "Lim Ah Kow little one warded"]) assert.equal(scopeFor(q, mk(M, own)), null, q);
  });
  await check("Critic P395 G: a name said that is also part of another member's name, or split by a comma, never scopes", () => {
    const G = mk([["Lim Wei Jie (Wei Jie)", "self"], ["Tan Wei Jie", "brother"]], [doc("a", "Lim plan", ["Lim Wei Jie (Wei Jie)"], ["Ward cash S$100 per day"]),
      doc("b", "Tan plan", ["Tan Wei Jie"], ["Ward cash S$50 per day"]), doc("b2", "Tan plan no name", ["Tan Wei Jie"], ["Dental S$500"])]);
    for (const q of ["Wei Jie dental?", "Does Wei Jie Tan have dental?"]) assert.equal(scopeFor(q, G), null, q);
    assert.equal(scopeFor("Lim Wei Jie dental?", G)?.person, "Lim Wei Jie (Wei Jie)");
    const G5 = mk([["Lim Wei", "self"], ["Lim Wei Jie", "son"]], [doc("a", "Lim Wei plan", ["Lim Wei"], ["x"]), doc("b", "Wei Jie plan", ["Lim Wei Jie"], ["Dental S$500"])]);
    for (const q of ["Lim Wei dental?", "Lim Wei, Jie dental?"]) assert.equal(scopeFor(q, G5), null, q);
    assert.equal(scopeFor("Lim Wei Jie dental?", G5)?.person, "Lim Wei Jie");
  });
  await check("Critic P395 H, I: a possessive, a joining word or a relative's word sends everything", () => {
    const H = mk(M.concat([["Lim Boon Hock", "grandson"]]), [doc("ak", "Ah Kow hospital", ["Lim Ah Kow"], ["Ward cash S$100 per day"]), ...own,
      doc("bh", "Boon Hock child plan", ["Lim Boon Hock"], ["Hospital cash S$50 per day"])]);
    for (const q of ["Lim Ah Kow's grandson hospital, can claim?", "Tan Mei Ling's stepson broke his arm, covered?", "Lim Ah Kow's granddaughter dental?",
      "Lim Ah Kow's boy got admitted, how much?", "Lim Ah Kow's fiancée hospital cash?", "Lim Ah Kow's in-laws covered?", "Lim Ah Kow's toddler warded",
      "Lim Ah Kow's grandchild warded", "Lim Ah Kow and his missus, ward cash?", "Lim Ah Kow or Tan Mei Ling, who has ward cash?", "Lim Ah Kow's spouse ward cash?",
      "Is Lim Ah Kow the payor for Lim Wei?", "Lim Ah Kow paid for his wife's surgery, claim?", "Lim Ah Kow's lao po warded, can claim?", "Lim Ah Kow's ah ma warded",
      "Lim Ah Kow lao po warded", "Lim Ah Kow missus warded", "Lim Ah Kow grandson warded", "Lim Ah Kow with Lim Boon Hock, ward cash?",
      "tan mei ling's hospital cash leh", "Mei Ling Tan ward cash?", "Ah Kow can claim or not ah", "Lim Ah Kow’s ward cash?", "Lim Ah Kows' ward cash?"])
      assert.equal(scopeFor(q, H), null, q);
    for (const q of ["TAN MEI LING — ward cash?", "Tan-Mei-Ling ward cash?", "Lim Ah Kow lah, ward cash"]) assert.ok(scopeFor(q, H), q);
  });
  await check("Critic P395 J: a whole name made of ordinary words scopes only when written as a name", () => {
    const J = mk([["Bill May", "self"], ["Max Low", "spouse"]], [doc("bm", "Bill May plan", ["Bill May"], ["Ward cash S$100 per day"]), doc("ml", "Max Low plan", ["Max Low"], ["Ward cash S$80 per day"])]);
    for (const q of ["Will the hospital bill May be covered?", "What is the max low ward cash for Bill May?", "Is max low?", "The bill may be high, is Max Low covered?",
      "Will The Hospital Bill May Be Covered?"]) assert.equal(scopeFor(q, J), null, q);
    assert.equal(scopeFor("Is Max Low covered for ward cash?", J)?.person, "Max Low");
  });

  await check("a scoped library lists every document but sends only the kept ones' pages; an unscoped one is unchanged", () => {
    const scope = scopeFor("What does Lim Wei get for an ambulance?", HOUSE)!;
    const lib = renderLibrary(HOUSE, undefined, scope);
    for (const kept of ["WEIPAGE", "WEIRULE", "FAMPAGE", "RCPTPAGE", "MLWPAGE"]) assert.match(lib, new RegExp(kept));
    for (const out of ["AKPAGE", "MLPAGE"]) assert.doesNotMatch(lib, new RegExp(out));
    // Every document is still listed by name, with its pages counted as left out.
    for (const d of HOUSE.documents) assert.ok(lib.includes(`name="${d.name}"`), d.name);
    assert.equal(lib.split(SCOPED_OUT).length - 1, 2);
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
  await check("only a conversation's first question is scoped; every later one, a correction too, is sent the whole library", async () => {
    const full = await ask("What is the waiting period?", [], false);
    const t1 = await ask("What does Lim Wei get for an ambulance?", []);
    assert.match(t1.library, /WEIPAGE/);
    assert.doesNotMatch(t1.library, /AKPAGE|MLPAGE/);
    const h1: Turn[] = [{ role: "user", text: "What does Lim Wei get for an ambulance?" }, { role: "assistant", text: "Up to S$500 an incident." }];
    // A correction to another person, a follow-up naming nobody, two people, "my": the whole library, never the earlier scope.
    for (const m of ["Sorry, Tan Mei Ling's ambulance limit.", "And the waiting period?", "What about Wei and Mei Ling?", "What does my wife get?", "What does Lim Wei get for a fracture?"])
      assert.equal((await ask(m, h1)).library, full.library, m);
    sizes.push(`whole library ~${tokens(full.library)} tokens`, `scoped to Wei ~${tokens(t1.library)}`);
    assert.ok(tokens(t1.library) < tokens(full.library) / 5, sizes.join(", "));
  });
  await check("a scoped library more than half the whole one is not sent: the whole library goes, cached", async () => {
    // Mei Ling's own plan is most of this household's pages: scoped, it would be more than half.
    const scoped = renderLibrary(HOUSE, undefined, scopeFor("Tan Mei Ling ambulance limit?", HOUSE));
    assert.ok(scopeFor("Tan Mei Ling ambulance limit?", HOUSE));
    const full = await ask("What is the waiting period?", [], false);
    assert.ok(scoped.length > SCOPED_SHARE_MAX * full.library.length);
    const t = await ask("Tan Mei Ling ambulance limit?", []);
    assert.equal(t.library, full.library);
    assert.notEqual(t.cache, false);
  });
  await check("a scoped first question is sent uncached; the whole library is cached, on every question", async () => {
    assert.equal((await ask("What does Lim Wei get for an ambulance?", [])).cache, false);
    assert.notEqual((await ask("What is the waiting period?", [])).cache, false);
    assert.notEqual((await ask("And Lim Wei?", [{ role: "user", text: "What does Wei get?" }, { role: "assistant", text: "S$500." }])).cache, false);
    // The model call drops the cache mark only when asked.
    const req = anthropicRequest({ provider: "anthropic", model: "test" }, { library: "LIB", history: [], question: "q" });
    assert.ok("cache_control" in uncachedIfAsked(req, { library: "LIB", history: [], question: "q" }).system[1]);
    assert.ok(!uncachedIfAsked(req, { library: "LIB", history: [], question: "q", cache: false }).system.some((b) => "cache_control" in b));
  });
  // The TE's #393 flip case: scoped and whole turns in one conversation. A prompt cache is simulated over the calls the app
  // makes: a cached call whose library was written before is a read (0.1x); otherwise a cached call writes it
  // (LIBRARY_CACHE_WRITE_RATE) and an uncached one pays 1x.
  const cost = (sent: SimpleModelCall[]) => {
    const written = new Set<string>();
    let total = 0, writes = 0;
    for (const c of sent) {
      const n = tokens(c.library);
      if (c.cache === false) total += n;
      else if (written.has(c.library)) total += 0.1 * n;
      else { total += LIBRARY_CACHE_WRITE_RATE * n; written.add(c.library); writes++; }
    }
    return { total, writes };
  };
  await check("TE #393 flip case: a conversation writes the cache at most once, and a scoped first question costs less than a whole one", async () => {
    const conversation = async (messages: string[], scope = true) => {
      const sent: SimpleModelCall[] = [], history: Turn[] = [];
      for (const m of messages) { sent.push(await ask(m, [...history], scope)); history.push({ role: "user", text: m }, { role: "assistant", text: "Answer." }); }
      return cost(sent);
    };
    const flips = ["What does Lim Wei get for an ambulance?", "What is the waiting period?", "Lim Wei, fracture?", "And for the family trip?"];
    const ours = await conversation(flips), whole = await conversation(flips, false);
    assert.equal(ours.writes, 1);
    const L = tokens((await ask("What is the waiting period?", [], false)).library), S1 = tokens((await ask(flips[0], [])).library);
    // The most a scoped first question adds to a longer conversation: its own uncached call, less the read it replaces.
    assert.ok(ours.total - whole.total <= S1 - 0.1 * L + 1, `${ours.total} vs ${whole.total}`);
    assert.ok(S1 - 0.1 * L <= (SCOPED_SHARE_MAX - 0.1) * L);
    const single = await conversation(flips.slice(0, 1)), singleWhole = await conversation(flips.slice(0, 1), false);
    assert.ok(single.total < singleWhole.total / 3, `${single.total} vs ${singleWhole.total}`);
    sizes.push(`one question: ${Math.round(single.total)} vs ${Math.round(singleWhole.total)} whole`, `4 turns with flips: ${Math.round(ours.total)} vs ${Math.round(whole.total)} whole`);
  });

  console.log(`(estimated per call: ${sizes.join(", ")})`);
  console.log(`simple-chat scope: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  if (failures.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
