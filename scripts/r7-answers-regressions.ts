/**
 * Round 7 answers suite (npm run r7:answers-test).
 *
 * Proves the chat's non-claim answers generalise beyond the Round 6
 * household: a second, deliberately different household (scripts/r7/fixture.ts,
 * built from realistic PDFs through the REAL ingestion pipeline on PGlite)
 * is asked 300+ fresh messages, including long multi-turn conversations with
 * pronouns, corrections, repeats and a document deleted mid-conversation
 * (scripts/r7/battery.ts), under the deterministic model stand-in. Every
 * answer runs through the Round 6 detectors (with this household's ground
 * truth) and the Round 7 ones (scripts/r7/detectors.ts). Any hit fails.
 * Detector positive controls run first.
 *
 * R7_DUMP=<file> writes every turn as JSON lines; R7_ONLY=<substring> filters.
 */
import { writeFileSync, appendFileSync } from "node:fs";
import { NextRequest } from "next/server";
import type { ChatAnswer } from "@/types";

process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
process.env.E2E_RUN_ID = "r7answers";
process.env.DEV_AUTH_ENABLED = "1";
process.env.MODEL_PRESET = process.env.MODEL_PRESET || "openai";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-not-used";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "ci";
delete process.env.PINECONE_API_KEY; delete process.env.SUPABASE_URL;

type Hit = { rule: string; text: string };
type Rec = { conv: string; chaos?: string[]; turn: number; question: string; status: number; ms: number; summary: string; answer: ChatAnswer | null; hits: Hit[] };
/** Round 8: the chaos model's mutations during this turn (only under R8_CHAOS_SEED). */
const chaosNote = (): string[] | undefined => (globalThis as { __dpChaosLog?: { op: string; mode: string }[] }).__dpChaosLog?.splice(0).map((x) => x.op + ":" + x.mode);

async function main() {
  const started = Date.now();
  const watchdog = setTimeout(() => { console.error("WATCHDOG: no completion in 20 minutes"); process.exit(3); }, 20 * 60_000);
  globalThis.fetch = (async (input: RequestInfo | URL) => { throw new Error("network disabled: " + String(input)); }) as typeof fetch;
  const out = console.log;
  console.info = () => undefined; console.debug = () => undefined; console.warn = () => undefined;
  console.log = (...args: unknown[]) => { if (typeof args[0] === "string" && /^(?:\{"|\[telemetry\]|SQL note)/.test(args[0])) return; out(...args); };

  const { detect, moneyIn, visibleFields } = await import("./r6/detectors");
  const { detectR7, repeatedAnswer } = await import("./r7/detectors");
  const { detectR8 } = await import("./r8/detectors");
  const R8 = await import("./r8/chaos-mode");
  const controls = selfTest(detect, detectR7, repeatedAnswer);
  if (controls.length) { out("DETECTOR SELF-TEST FAILED:\n- " + controls.join("\n- ")); process.exit(1); }
  out("detector self-test: ok");
  const guard = await import("@/lib/chat/output-guard");
  guard.guardInterventions.length = 0;

  const F = await import("./r7/fixture");
  const h = await F.buildHousehold();
  out(`household built in ${Date.now() - started} ms`);
  // Round 8: the same battery with the chaos model in place of the stand-in (scripts/r8-chaos-regressions.ts).
  if (process.env.R8_CHAOS_SEED) Object.assign(process.env, { NODE_ENV: "test", DEARPOLICY_DETERMINISTIC_MODEL: "chaos-" + process.env.R8_CHAOS_SEED });
  // Every document was read, and a bilingual page kept its text (CJK fonts with predefined CMaps).
  const setup: string[] = [];
  for (const r of (await h.db.query<{ original_filename: string; processing_status: string }>("SELECT original_filename,processing_status FROM policies WHERE account_id=$1", [F.ACCOUNT])).rows)
    if (r.processing_status !== "ready") setup.push(r.original_filename + " is " + r.processing_status);
  const bilingual = (await h.db.query<{ text: string }>("SELECT string_agg(text,E'\\n') text FROM policy_pages WHERE policy_id=$1", [h.docs.endowment])).rows[0]?.text ?? "";
  if (!/保证满期价值 Guaranteed maturity value/.test(bilingual) || !/S\$17,220/.test(bilingual)) setup.push("the Chinese/English endowment page lost its text: " + bilingual.slice(0, 120));
  if (setup.length) { out("FIXTURE FAILED:\n- " + setup.join("\n- ")); process.exit(1); }

  const { battery } = await import("./r7/battery");
  const { POST } = await import("@/app/api/chat/route");
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const truth = async () => {
    const pages = new Map<string, string>();
    for (const r of (await h.db.query<{ policy_id: string; text: string }>("SELECT pp.policy_id,string_agg(pp.text,E'\\n' ORDER BY pp.page_number) text FROM policy_pages pp JOIN policies p ON p.id=pp.policy_id WHERE p.account_id=$1 AND p.lifecycle_state='active' GROUP BY 1", [F.ACCOUNT])).rows) pages.set(r.policy_id, r.text);
    const premiumFigures: number[] = [];
    for (const r of (await h.db.query<{ amount: string; notes: string | null }>("SELECT amount::text,notes FROM premium_records WHERE account_id=$1", [F.ACCOUNT])).rows) { premiumFigures.push(Number(r.amount)); premiumFigures.push(...moneyIn(r.notes ?? "")); }
    const personPolicies = new Map<string, Set<string>>();
    for (const r of (await h.db.query<{ family_member_id: string; policy_id: string }>("SELECT family_member_id,policy_id FROM policy_members WHERE account_id=$1", [F.ACCOUNT])).rows)
      (personPolicies.get(r.family_member_id) ?? personPolicies.set(r.family_member_id, new Set()).get(r.family_member_id)!).add(r.policy_id);
    return { pages, premiumFigures: [...new Set(premiumFigures)], householdNames: F.PEOPLE.map((p) => p.display_name), foreignNames: ["Ong Siew Hwa", "Siew Hwa"],
      foreignPolicyIds: new Set([h.docs.other]), personPolicies, selfNames: F.PEOPLE.filter((p) => p.id === F.SELF).flatMap((p) => [p.display_name, p.preferred_name]),
      inactive: F.INACTIVE.filter((x) => pages.has(h.docs[x.key])).map((x) => ({ policyId: h.docs[x.key], name: x.name, state: x.state, date: x.date })),
      people: F.PEOPLE.map((p) => ({ id: p.id, names: [p.display_name, p.preferred_name] })), today };
  };
  let g = await truth();

  const only = process.env.R7_ONLY, dump = process.env.R7_DUMP;
  if (dump) writeFileSync(dump, "");
  const records: Rec[] = [];
  let messages = 0;
  for (const c of battery()) {
    if (only && !c.name.includes(only)) continue;
    const account = c.account === "other" ? F.OTHER_ACCOUNT : F.ACCOUNT;
    const conv: { id?: string; rev?: number } = {};
    let member = c.member, userText = "", prev: { question: string; key: string } | null = null;
    for (const [i, t] of c.turns.entries()) {
      if (t.action) {
        const [verb, key] = t.action.split(":");
        await h.db.query("UPDATE policies SET lifecycle_state=$2 WHERE id=$1", [h.docs[key], verb === "delete" ? "soft_deleted" : "active"]);
        g = await truth();
      }
      userText += "\n" + t.say;
      process.env.DEV_ACCOUNT_ID = account;
      const t0 = Date.now();
      let status = 0, data: { answer?: ChatAnswer; error?: string } = {};
      const hits: Hit[] = [];
      try {
        const res = await POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ familyMemberId: member, scope: c.scope ?? (member ? "member" : "family"), question: t.say, conversationId: conv.id, conversationRevision: conv.rev, asynchronous: false, timeZone: "Asia/Singapore" }) }));
        status = res.status; data = await res.json();
      } catch (e) { hits.push({ rule: "threw", text: (e instanceof Error ? e.stack ?? e.message : String(e)).slice(0, 400) }); }
      const ms = Date.now() - t0;
      messages++;
      const e = t.expect ?? {};
      if (status !== (e.status ?? 200) && !hits.length) hits.push({ rule: "unexpected HTTP status", text: status + " " + JSON.stringify(data).slice(0, 200) });
      const a = status === 200 ? data.answer ?? null : null;
      if (a) {
        conv.id = a.conversationId ?? conv.id; conv.rev = a.conversationRevision ?? conv.rev;
        if (a.resolvedFamilyMemberId) member = a.resolvedFamilyMemberId;
        const mentions = Array.isArray(e.mentions) ? e.mentions : e.mentions ? [e.mentions] : [];
        hits.push(...detect(a, { question: t.say, userText, claimTurn: false, ms, expect: { person: e.person, noCitations: e.noCitations, noAmounts: e.noAmounts, citeOnly: e.citeOnly } as never }, g));
        // "Must not say": judged on what the answer itself says, not on a verbatim policy quote shown beside it.
        if (e.notMentions) { const said = visibleFields(a).filter((f) => !/quote|citation/.test(f.where)).map((f) => f.text).join("\n"); const m = said.match(e.notMentions); if (m) hits.push({ rule: "answer says what it must not", text: m[0] + " in: " + a.summary.slice(0, 200) }); }
        hits.push(...detectR7(a, { question: t.say, userText, expectPerson: e.person ?? null }, g));
        hits.push(...detectR8(a, { userText }, g));
        const all = visibleFields(a).map((f) => f.text).join("\n");
        for (const m of mentions) if (!m.test(all)) hits.push({ rule: "answer ignores the question", text: "expected " + m + " in: " + a.summary.slice(0, 200) });
        if (e.asksPerson && a.questions[0]?.id !== "claim_person") hits.push({ rule: "ambiguous person not asked", text: a.summary.slice(0, 200) });
        const same = repeatedAnswer(prev, t.say, a); if (same) hits.push(same);
        prev = { question: t.say, key: a.summary + "\n" + a.details.join("\n") };
        // A person card is answered by tapping a person, as the chat page does.
      }
      const rec: Rec = { chaos: chaosNote(), conv: c.name, turn: i, question: t.say, status, ms, summary: a?.summary ?? String(data?.error ?? ""), answer: a, hits };
      records.push(rec);
      if (dump) appendFileSync(dump, JSON.stringify(rec) + "\n");
    }
  }
  const byRule = new Map<string, number>();
  for (const r of records) for (const x of r.hits) byRule.set(x.rule, (byRule.get(x.rule) ?? 0) + 1);
  const failing = records.filter((r) => r.hits.some((x) => R8.isFailure(x.rule)));
  for (const r of failing.slice(0, Number(process.env.R7_SHOW ?? 40))) out(`\n✗ ${r.conv} #${r.turn} > ${r.question.slice(0, 120)}\n  < ${r.summary.slice(0, 300)}\n  - ` + r.hits.map((x) => x.rule + ": " + x.text).join("\n  - "));
  out("\n=== detector hits by rule ===");
  for (const [rule, n] of [...byRule].sort((x, y) => y[1] - x[1])) out(String(n).padStart(4) + "  " + rule);
  const times = records.map((r) => r.ms).sort((x, y) => x - y);
  const convs = new Set(records.map((r) => r.conv)), long = [...convs].filter((n) => records.filter((r) => r.conv === n).length >= 15).length;
  out(`\n${messages} messages in ${convs.size} conversations (${long} of 15+ turns); ${failing.length} turns with hits; median ${times[Math.floor(times.length / 2)]} ms, max ${times.at(-1)} ms; total ${Math.round((Date.now() - started) / 1000)} s`);
  if (!only && !R8.chaosSeed() && messages < 300) { out("FAIL: the battery must send at least 300 messages (sent " + messages + ")"); process.exitCode = 1; }
  if (!only && !R8.chaosSeed() && long < 10) { out("FAIL: the battery must hold at least 10 conversations of 15+ turns (has " + long + ")"); process.exitCode = 1; }
  if (failing.length) process.exitCode = 1;
  if (guard.guardInterventions.length) {
    out("FAIL: the output guard changed " + guard.guardInterventions.length + " answer(s) — fix the root cause:\n" + guard.guardInterventions.slice(0, 5).map((x) => "  before: " + x.before.slice(0, 300) + "\n  after:  " + x.after.slice(0, 300)).join("\n"));
    process.exitCode = 1;
  } else out("output guard interventions: 0");
  R8.reportChaos(out, "r7-answers", records, guard.guardInterventions.length, messages);
  clearTimeout(watchdog);
  await h.db.close();
}

/** Positive and negative controls for the Round 7 detectors (and the fixture-driven "you"). */
function selfTest(detect: typeof import("./r6/detectors").detect, detectR7: typeof import("./r7/detectors").detectR7, repeatedAnswer: typeof import("./r7/detectors").repeatedAnswer): string[] {
  const fails: string[] = [];
  const pages = new Map([["p1", "Loss of a thumb\t25%\nSum insured\tS$150,000\nOwn damage excess\tS$800"], ["p2", "Your policy lapsed on 17 March 2026. 保证满期价值 Guaranteed maturity value S$36,000"]]);
  const g = { pages, inactive: [{ policyId: "p2", name: "AssureTerm 65", state: "lapsed" as const, date: "2026-03-17" }],
    people: [{ id: "m1", names: ["Rahman bin Yusof", "Rahman"] }, { id: "m2", names: ["Maria Luz D'Souza-Reyes", "Maria"] }], today: "2026-10-04" };
  const base = (over: Partial<ChatAnswer>): ChatAnswer => ({ mode: "answer", summary: "Your own damage excess is S$800 (page 1).", details: [], claimItems: [], nextSteps: [], confidence: null,
    citations: [{ chunkId: "c", policyId: "p1", policyName: "DriveSafe", pageStart: 1, pageEnd: 1 }], disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [], ...over });
  const t = { question: "q", userText: "q", expectPerson: null as string | null };
  const expectRule = (name: string, a: ChatAnswer, rule: RegExp, ctx: Partial<typeof t> & { expectPerson?: string | null } = {}) => {
    const hits = detectR7(a, { ...t, ...ctx }, g);
    if (!hits.some((x) => rule.test(x.rule))) fails.push(name + " not detected (got " + hits.map((x) => x.rule).join(", ") + ")");
  };
  if (detectR7(base({}), t, g).length) fails.push("clean answer flagged: " + JSON.stringify(detectR7(base({}), t, g)));
  if (detectR7(base({ summary: "Loss of a thumb: 25% of the sum insured of S$150,000 (page 1)." }), t, g).length) fails.push("percentage with its base flagged");
  expectRule("bare percentage", base({ summary: "Loss of a thumb: 25% (page 1)." }), /without its base/);
  expectRule("invented percentage", base({ summary: "Loss of a thumb: 30% of the sum insured (page 1)." }), /percentage not in any/);
  expectRule("past date as upcoming", base({ summary: "Your policy renews on 1 March 2026." }), /past date/);
  expectRule("lapsed as active", base({ summary: "AssureTerm 65 is in force and pays S$300,000." }), /inactive policy/);
  expectRule("lapsed called expired", base({ summary: "AssureTerm 65 has expired, so its terms may no longer apply." }), /described as expired/);
  expectRule("portfolio lists lapsed", base({ portfolioItems: [{ id: "x", ownerName: "Rahman", policyName: "AssureTerm 65", confirmed: true, coverages: [] }] as never }), /inactive policy/);
  expectRule("wrong person", base({ summary: "Here is what Maria’s documents state about cover." }), /person-name mismatch/, { expectPerson: "m1" });
  expectRule("apostrophe dropped", base({ details: ["HelperCare covers Maria Luz DSouza-Reyes (page 1)."] }), /name mangled/);
  expectRule("cut at bin", base({ summary: "This is Rahman bin." }), /name mangled/);
  expectRule("mojibake", base({ summary: "ä¿è¯ Guaranteed maturity value â€” S$36,000." }), /non-Latin text mangled/);
  expectRule("invented Chinese", base({ summary: "满期价值是 S$36,000." }), /non-Latin text not in/);
  expectRule("furniture", base({ details: ["HelperCare — Employer: Rahman bin Yusof (page 2)."] }), /furniture/);
  expectRule("bank detail", base({ details: ["Silver Years — Payment method: GIRO from your DBS account ending 4471 (page 2)."] }), /payment account/);
  expectRule("too long", base({ details: Array.from({ length: 14 }, (_, i) => "Line " + i + " states S$800 (page 1).") }), /longer than needed/, { question: "What is my car excess?" });
  const a1 = base({}), same = repeatedAnswer({ question: "What is my car excess?", key: a1.summary + "\n" }, "What is my home excess?", a1);
  if (!same) fails.push("same answer to a different question not detected");
  if (repeatedAnswer({ question: "What is my car excess?", key: a1.summary + "\n" }, "what is my car excess", a1)) fails.push("a repeated question flagged as a different one");
  // Round 6's "says not found but lists it" reads "you" from the fixture, not from one household.
  const r6g = { pages: new Map([["p1", "Dental: up to S$300"]]), premiumFigures: [], householdNames: ["Rahman bin Yusof"], foreignNames: [], foreignPolicyIds: new Set<string>(), personPolicies: new Map(), selfNames: ["Rahman bin Yusof", "Rahman"] };
  const contra = base({ summary: "I could not find dental cover in the documents read for you.", details: ["Rahman · Booklet — Dental: up to S$300 (page 1)."], citations: [{ chunkId: "c", policyId: "p1", policyName: "Booklet", pageStart: 1, pageEnd: 1 }] });
  if (!detect(contra, { question: "q", userText: "", claimTurn: false, ms: 1 }, r6g as never).some((x) => /not found but lists/.test(x.rule))) fails.push("Round 6 'you' is still hard-coded: contradiction for this household's self not detected");
  return fails;
}

main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(2); });
