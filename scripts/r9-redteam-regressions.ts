/**
 * Round 9 red-team suite (npm run r9:redteam-test).
 *
 * A fresh-eyes pass written to differ from the Round 6/7 batteries: voice
 * transcripts with no punctuation, one-word questions, angry, sarcastic and
 * confused customers, policy numbers, pasted bills and insurer letters,
 * plans not on file, "is this a good policy", term explanations, premiums and
 * cancelling, Malay/Chinese/Tamil words, numbers as words, many date formats,
 * several people in one claim, and claims interleaved with policy questions
 * (scripts/r9/battery.ts). It drives the REAL chat route over BOTH fixture
 * households (scripts/r6/fixture.ts and scripts/r7/fixture.ts, each built
 * with the real ingestion pipeline on PGlite) under the deterministic model
 * stand-in, and runs every Round 6/7/8 detector plus the Round 9 ones
 * (scripts/r9/detectors.ts, and the ingestion ones in
 * scripts/r9/ingest-detectors.ts: nothing planted at upload, every "(page N)"
 * figure printed on page N) on every answer. Any hit fails. Detector
 * positive controls run first.
 *
 * Each household runs in its own child process (R9_HOUSEHOLD=r6|r7).
 * R9_DUMP=<file> writes every turn as JSON lines; R9_ONLY=<substring> filters.
 * R8_CHAOS_SEED=<seed> runs the battery with the chaos model (degraded
 * usefulness is counted, never leaks). R9_INGEST_SEED=<seed> (with R9_PRISTINE)
 * reads the fixture documents under the ingestion chaos stand-in first, as the
 * Round 9 ingestion suite does for the Round 6/7 batteries.
 */
import { writeFileSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { NextRequest } from "next/server";
import type { ChatAnswer } from "@/types";

process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
process.env.E2E_RUN_ID = "r9redteam";
process.env.DEV_AUTH_ENABLED = "1";
process.env.MODEL_PRESET = process.env.MODEL_PRESET || "openai";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-not-used";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "ci";
delete process.env.PINECONE_API_KEY; delete process.env.SUPABASE_URL;

type Hit = { rule: string; text: string };
type Rec = { conv: string; chaos?: string[]; turn: number; question: string; status: number; ms: number; summary: string; answer: ChatAnswer | null; hits: Hit[] };
const chaosNote = (): string[] | undefined => (globalThis as { __dpChaosLog?: { op: string; mode: string }[] }).__dpChaosLog?.splice(0).map((x) => x.op + ":" + x.mode);

/** Both households under the stand-in, then (unless R9_NO_CHAOS) under the chaos model's fixed seeds
 * (R9_CHAOS_SEEDS, default 3): nothing invented, junk or leaked may reach the household, and an honest
 * fallback in place of an answer is counted and bounded, never failed one by one. */
function parent() {
  let failed = 0, messages = 0;
  const seeds = process.env.R8_CHAOS_SEED ? [process.env.R8_CHAOS_SEED] : process.env.R9_NO_CHAOS ? [""] : ["", ...(process.env.R9_CHAOS_SEEDS ?? "3").split(",").filter(Boolean)];
  for (const seed of seeds) for (const hh of ["r6", "r7"]) {
    const env = { ...process.env, R9_HOUSEHOLD: hh, ...(seed ? { R8_CHAOS_SEED: seed } : {}) };
    if (!seed) delete env.R8_CHAOS_SEED;
    const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { env, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", maxBuffer: 64 << 20 });
    process.stdout.write(r.stdout ?? "");
    if (!seed) messages += Number((r.stdout ?? "").match(/^(\d+) messages in/m)?.[1] ?? 0);
    if (r.status !== 0) { failed++; console.log(`household ${hh}${seed ? " (chaos seed " + seed + ")" : ""}: FAILED (exit ${r.status})`); }
  }
  console.log(`\nr9 red-team: ${messages} messages over both households under the stand-in${seeds.length > 1 ? ", and again under chaos seed(s) " + seeds.filter(Boolean).join(",") : ""}; ${failed ? "FAIL" : "ok"}`);
  if (!process.env.R9_ONLY && seeds.includes("") && messages < 200) { console.log("FAIL: the battery must send at least 200 messages"); failed++; }
  process.exit(failed ? 1 : 0);
}
/** Round 9 usefulness rules: under the chaos model an honest fallback may stand in for the answer. */
const R9_DEGRADED = /^(?:follow-up repeats the previous answer|asked who when it was clear|generic answer with nothing in it|car question answered with health cover|home question answered with health cover|person card missing)$/;

async function main() {
  const hh = process.env.R9_HOUSEHOLD as "r6" | "r7";
  const started = Date.now();
  const watchdog = setTimeout(() => { console.error("WATCHDOG: no completion in 20 minutes"); process.exit(3); }, 20 * 60_000);
  globalThis.fetch = (async (input: RequestInfo | URL) => { throw new Error("network disabled: " + String(input)); }) as typeof fetch;
  const out = console.log;
  console.info = () => undefined; console.debug = () => undefined; console.warn = () => undefined;
  console.log = (...args: unknown[]) => { if (typeof args[0] === "string" && /^(?:\{"|\[telemetry\]|SQL note)/.test(args[0])) return; out(...args); };

  const { detect, moneyIn, visibleFields } = await import("./r6/detectors");
  const { detectR7, repeatedAnswer } = await import("./r7/detectors");
  const { detectR8 } = await import("./r8/detectors");
  const R9 = await import("./r9/detectors");
  const R9I = await import("./r9/ingest-detectors");
  const R8 = await import("./r8/chaos-mode");
  const controls = R9.selfTest();
  if (controls.length) { out("DETECTOR SELF-TEST FAILED:\n- " + controls.join("\n- ")); process.exit(1); }
  out(`[${hh}] r9 detector self-test: ok`);
  const guard = await import("@/lib/chat/output-guard");
  guard.guardInterventions.length = 0;

  const F6 = await import("./r6/fixture"), F7 = await import("./r7/fixture");
  const F = hh === "r6" ? { ACCOUNT: F6.ACCOUNT, PEOPLE: F6.PEOPLE, SELF: F6.MEILING, foreign: ["Goh Boon Kiat", "Boon Kiat"], INACTIVE: [] as typeof F7.INACTIVE }
    : { ACCOUNT: F7.ACCOUNT, PEOPLE: F7.PEOPLE, SELF: F7.SELF, foreign: ["Ong Siew Hwa", "Siew Hwa"], INACTIVE: F7.INACTIVE };
  const h = hh === "r6" ? await F6.buildHousehold() : await F7.buildHousehold();
  out(`[${hh}] household built in ${Date.now() - started} ms`);
  if (process.env.R8_CHAOS_SEED) Object.assign(process.env, { NODE_ENV: "test", DEARPOLICY_DETERMINISTIC_MODEL: "chaos-" + process.env.R8_CHAOS_SEED });
  const { battery } = await import("./r9/battery");
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
    const policyNames = new Map<string, string>();
    for (const r of (await h.db.query<{ id: string; product_name: string | null; policy_type: string | null }>("SELECT id,product_name,policy_type FROM policies WHERE account_id=$1", [F.ACCOUNT])).rows) policyNames.set(r.id, (r.product_name ?? "") + " | " + (r.policy_type ?? ""));
    return R9I.pristineOverride({ pages, premiumFigures: [...new Set(premiumFigures)], householdNames: F.PEOPLE.map((p) => p.display_name), foreignNames: F.foreign,
      foreignPolicyIds: new Set([h.docs.other]), personPolicies, selfNames: F.PEOPLE.filter((p) => p.id === F.SELF).flatMap((p) => [p.display_name, p.preferred_name]),
      inactive: F.INACTIVE.filter((x) => pages.has(h.docs[x.key])).map((x) => ({ policyId: h.docs[x.key], name: x.name, state: x.state, date: x.date })),
      people: F.PEOPLE.map((p) => ({ id: p.id, names: [p.display_name, p.preferred_name] })), today, policyNames });
  };
  const g = await truth();
  const g9 = await R9I.pageTruth(h.db as never, F.ACCOUNT);
  const ids: Record<string, string> = Object.fromEntries(F.PEOPLE.map((p) => [p.preferred_name.toUpperCase().replace(/\W/g, ""), p.id]));

  const only = process.env.R9_ONLY, seed = process.env.R8_CHAOS_SEED;
  const dump = process.env.R9_DUMP && seed ? process.env.R9_DUMP.replace(/(\.jsonl)?$/, "-chaos" + seed + ".jsonl") : process.env.R9_DUMP;
  if (dump && hh === "r6") writeFileSync(dump, "");
  const records: Rec[] = [];
  let messages = 0;
  const convs = battery().filter((c) => c.household === hh);
  for (const c of convs) {
    if (only && !c.name.includes(only)) continue;
    const conv: { id?: string; rev?: number; pcm?: string; pcr?: string } = {};
    let member: string | null = c.member ? ids[c.member] ?? c.member : null, userText = "", prev: { question: string; key: string } | null = null;
    let last: ChatAnswer | null = null;
    for (const [i, t] of c.turns.entries()) {
      // A person card is answered by tapping a person, as the chat page does.
      let say = t.say, choice: string | undefined;
      if (t.pick) {
        const cand = (last?.personCandidates ?? []).find((p) => t.pick!.test(p.label));
        if (!cand) { records.push({ conv: c.name, turn: i, question: "(tap " + t.pick + ")", status: 0, ms: 0, summary: "", answer: last, hits: [{ rule: "person card missing", text: "no candidate " + t.pick + " in " + JSON.stringify(last?.personCandidates?.map((p) => p.label) ?? []) }] }); break; }
        say = cand.label; choice = cand.id;
      }
      userText += "\n" + say;
      process.env.DEV_ACCOUNT_ID = F.ACCOUNT;
      const t0 = Date.now();
      let status = 0, data: { answer?: ChatAnswer; error?: string } = {};
      const hits: Hit[] = [];
      try {
        const res = await (await import("./r10/meter")).meterTurn(say, () => POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ familyMemberId: member, scope: member ? "member" : "family", question: say, conversationId: conv.id, conversationRevision: conv.rev, asynchronous: false, timeZone: "Asia/Singapore",
            ...(choice ? { personChoiceId: choice, personContextMessage: conv.pcm, personContextRecordedAt: conv.pcr } : {}) }) })));
        status = res.status; data = await res.json();
      } catch (e) { hits.push({ rule: "threw", text: (e instanceof Error ? e.stack ?? e.message : String(e)).slice(0, 400) }); }
      const ms = Date.now() - t0;
      messages++;
      const e = t.expect ?? {};
      if (status !== 200 && !hits.length) hits.push({ rule: "unexpected HTTP status", text: status + " " + JSON.stringify(data).slice(0, 200) });
      const a = status === 200 ? data.answer ?? null : null;
      if (a) {
        conv.id = a.conversationId ?? conv.id; conv.rev = a.conversationRevision ?? conv.rev; conv.pcm = a.personContextMessage; conv.pcr = a.personContextRecordedAt;
        if (a.resolvedFamilyMemberId) member = a.resolvedFamilyMemberId;
        const person = e.person === undefined ? undefined : e.person === null ? null : ids[e.person] ?? e.person;
        hits.push(...detect(a, { question: say, userText, claimTurn: !!c.claim, ms, expect: { person, noCitations: e.noCitations, noAmounts: e.noAmounts } as never }, g));
        hits.push(...detectR7(a, { question: say, userText, expectPerson: person ?? null }, g));
        hits.push(...detectR8(a, { userText }, g));
        hits.push(...R9.detectR9(a, { question: say, userText, prevAnswer: last, expect: e }, g));
        hits.push(...R9I.detectR9(a, g9));
        const said = visibleFields(a).filter((f) => !/quote|citation/.test(f.where)).map((f) => f.text).join("\n");
        const all = visibleFields(a).map((f) => f.text).join("\n");
        for (const m of [e.mentions ?? []].flat()) if (!m.test(all)) hits.push({ rule: "answer ignores the question", text: "expected " + m + " in: " + a.summary.slice(0, 200) });
        for (const m of [e.not ?? []].flat()) { const x = said.match(m); if (x) hits.push({ rule: "answer says what it must not", text: x[0] + " in: " + a.summary.slice(0, 200) }); }
        if (e.asksPerson === true && a.questions[0]?.id !== "claim_person") hits.push({ rule: "ambiguous person not asked", text: a.summary.slice(0, 200) });
        if (e.asksPerson === false && a.questions[0]?.id === "claim_person") hits.push({ rule: "asked who when it was clear", text: a.questions[0].text });
        if (!t.repeatOk) { const same = repeatedAnswer(prev, say, a); if (same) hits.push(same); }
        prev = { question: say, key: a.summary + "\n" + a.details.join("\n") };
      }
      last = a;
      const rec: Rec = { chaos: chaosNote(), conv: c.name, turn: i, question: say, status, ms, summary: a?.summary ?? String(data?.error ?? ""), answer: a, hits };
      records.push(rec);
      if (dump) appendFileSync(dump, JSON.stringify(rec) + "\n");
      if (!a) break;
    }
  }
  const byRule = new Map<string, number>();
  for (const r of records) for (const x of r.hits) byRule.set(x.rule, (byRule.get(x.rule) ?? 0) + 1);
  const isFailure = (rule: string) => R8.isFailure(rule) && !(R8.chaosSeed() && R9_DEGRADED.test(rule));
  const failing = records.filter((r) => r.hits.some((x) => isFailure(x.rule)));
  for (const r of failing.slice(0, Number(process.env.R9_SHOW ?? 40))) out(`\n✗ [${hh}] ${r.conv} #${r.turn} > ${r.question.slice(0, 120)}\n  < ${r.summary.slice(0, 300)}\n  - ` + r.hits.map((x) => x.rule + ": " + x.text).join("\n  - "));
  out(`\n=== [${hh}] detector hits by rule ===`);
  for (const [rule, n] of [...byRule].sort((x, y) => y[1] - x[1])) out(String(n).padStart(4) + "  " + rule);
  const times = records.map((r) => r.ms).sort((x, y) => x - y);
  const names = new Set(records.map((r) => r.conv)), multi = [...names].filter((n) => records.filter((r) => r.conv === n).length >= 3).length;
  out(`\n${messages} messages in ${names.size} conversations (${multi} of 3+ turns) [${hh}]; ${failing.length} turns with hits; median ${times[Math.floor(times.length / 2)]} ms, max ${times.at(-1)} ms; total ${Math.round((Date.now() - started) / 1000)} s`);
  if (failing.length) process.exitCode = 1;
  // Under the chaos model, honest fallbacks are bounded: most turns must still be answered.
  const degraded = records.filter((r) => r.hits.length && !r.hits.some((x) => isFailure(x.rule))).length;
  if (R8.chaosSeed() && degraded > records.length * 0.25) { out(`FAIL: ${degraded} of ${records.length} turns degraded to a fallback under chaos seed ${R8.chaosSeed()} (bound 25%)`); process.exitCode = 1; }
  if (guard.guardInterventions.length) {
    out("FAIL: the output guard changed " + guard.guardInterventions.length + " answer(s) — fix the root cause:\n" + guard.guardInterventions.slice(0, 5).map((x) => "  before: " + x.before.slice(0, 300) + "\n  after:  " + x.after.slice(0, 300)).join("\n"));
    process.exitCode = 1;
  } else out("output guard interventions: 0");
  R8.reportChaos(out, "r9-" + hh, records, guard.guardInterventions.length, messages);
  clearTimeout(watchdog);
  await h.db.close();
}

if (!process.env.R9_HOUSEHOLD) parent();
else main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(2); });
