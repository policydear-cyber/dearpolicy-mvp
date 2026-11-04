/**
 * Round 7 chat robustness suite (npm run r7:chat-robustness-test).
 *
 * Three households written by an independent author who never read the app
 * code (scripts/fixtures/r7: manifests, generated PDFs, 379 single questions
 * and 45 conversations) are loaded through the REAL ingestion path
 * (processPolicy on the PDFs, OCR for the image-only page, deletion through
 * the user's DELETE route), then:
 *
 *   battery  every single and every conversation through the REAL chat
 *            route, scored by the battery's own expected / forbidden facts
 *            and behaviours, and by the Round 6 rubbish detectors.
 *   traps    the battery items that lock in each trap fixed in Round 7
 *            (USD stays USD, lapse vs reinstatement, endorsement overrides
 *            the old schedule, joint life covers both, a receipt is not a
 *            policy, SecureCare Plus vs Pro, the scanned page, deleted
 *            documents, the ILP with no premium, the group booklet).
 *   group    employer group cover in death / accident / disability claims
 *            is listed as possible -- "confirm with the employer's HR" --
 *            never left out and never confirmed (r7 H1 and r6 Wei Jie).
 *   chaos    the application's chaos stand-ins (chaos-<seed>, ingest-chaos-<seed>) in every role:
 *            document reading at upload, interpretation, passage reading,
 *            relevance, judgement and narration; and every narration
 *            failing, which must leave exactly the deterministic answer.
 *   long     the conversations chained into 30+ turn chats; context leaks,
 *            claims resuming wrongly and late-chat degradation are flagged,
 *            and every turn is timed.
 *
 * Deterministic (fixed seeds, PGlite, no network). R7R_PHASES=battery,traps,...
 * R7R_HOUSEHOLDS=H1-tan,... R7R_ONLY=<id regex> R7R_DUMP=<file> R7R_DUMP_LONG=<file> R7R_REPORT=1 (print
 * every failing item, no assertions) R7R_SEEDS=1,2,3 (chaos seeds).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ChatAnswer } from "@/types";

process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
process.env.E2E_RUN_ID = "r7robust";
// The chaos stand-ins run only in a test process.
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.DEV_AUTH_ENABLED = "1";
// The scanned page is read by the hosted-OCR path, which the Gemini preset has.
process.env.MODEL_PRESET = process.env.MODEL_PRESET || "gemini";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-not-used";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "ci";
delete process.env.PINECONE_API_KEY; delete process.env.SUPABASE_URL;

/** Floors from this round's final run on main (deterministic: fixed seeds, PGlite, no network), one below the
 * final strict scores (EXCLUDED items included): a change that answers fewer battery items correctly than this
 * fails CI. In brackets, main before this round with the same harness (facts / behaviour / full pass). */
const FLOORS: Record<string, { facts: number; behaviour: number; fullPass: number }> = {
  "H1-tan": { facts: 189, behaviour: 219, fullPass: 167 }, // final 190 / 220 / 168 (main before: 172 / 187 / 130)
  "H2-aisyah": { facts: 195, behaviour: 221, fullPass: 172 }, // final 196 / 222 / 173 (main before: 175 / 184 / 128)
  // English only (owner's decision, 4 Nov 2026): the Malay and Chinese battery messages (H3-S100, S106-S110, H3-C10
  // turns 1-6) are now answered as out of scope with no figure, so the H3 floors are one below that run (195 / 212 / 177).
  "H3-ong": { facts: 194, behaviour: 211, fullPass: 176 }, // final 197 / 217 / 180 before English only (main before: 149 / 163 / 113)
};
// Round 16: a full pass now also requires the citation check (scripts/r7-robust/battery.ts passed()). Floors unchanged.
// Main before Round 16, rescored that way: 167 / 172 / 179 full pass (3 items failed only the citation check);
// after Round 16: 168 / 173 / 179 (520/810); without the citation requirement 169 / 173 / 180 (522, was 521).
/** Battery items that must pass completely (facts, forbidden, behaviour, detectors). */
const TRAP_ITEMS: Record<string, string[]> = {
  // dad / papa resolve to Ah Kow (his ward, knee exclusion, MediSave/cash split); Jun Hao vs Jun Hui; Ah Kow's age
  // band; the employee's own group plan and a child's column; the dependants' premium added up; the ILP that prints
  // no premium and its value as at the statement date; the scanned PA (its premium read from the scan); the deleted
  // Bali policy; a death question about the speaker's own cover.
  "H1-tan": ["H1-S001", "H1-S081", "H1-S082", "H1-S006", "H1-C01#5", "H1-S047", "H1-S057", "H1-S058", "H1-S051", "H1-S056", "H1-S077", "H1-S076",
    "H1-S088", "H1-S089", "H1-C06#6", "H1-S009", "H1-S004", "H1-S011", "H1-S124"],
  // lapse then reinstatement (status, what was paid, "lapsed?"); a Malay question; USD stays USD; the dental rider
  // without its base plan; the travel limits, the documents to submit and an injury overseas; CareShield.
  "H2-aisyah": ["H2-S057", "H2-S058", "H2-S060", "H2-S068", "H2-S073", "H2-S075", "H2-S076", "H2-S040", "H2-S041", "H2-S021", "H2-S022",
    "H2-S033", "H2-S037", "H2-S002", "H2-S006"],
  // H2-S069 (a Malay question) left the list with English only (4 Nov 2026): it is answered as out of scope, with no figure.
  // the endorsement over the 2021 schedule (sum assured, premium now, the old figure never quoted as current);
  // SecureCare Plus vs Pro ("the Pro", "the Pro is mine"); the joint policy; the premium receipt paid for the wife's
  // plan; the deleted home policy; a Chinese question.
  "H3-ong": ["H3-S001", "H3-S002", "H3-S005", "H3-S093", "H3-S021", "H3-S022", "H3-S024", "H3-S025", "H3-S039", "H3-C02#2", "H3-C02#9", "H3-S048",
    "H3-S049", "H3-C06#6", "H3-S072", "H3-C14#1", "H3-S120"],
  // H3-S106 (a Chinese question) left the list with English only (4 Nov 2026): it is answered as out of scope, with no figure.
};

/** Battery items judged wrong for this application and not scored (listed with the reason in the round's report). */
const EXCLUDED: Record<string, string> = {
  // The battery has Rachel typing "my CI how much" on her own page. DearPolicy has one login per household:
  // "I" and "my" are always the account holder (Kah Seng), whose CI amount the battery forbids here.
  "H3-C15#2": "first person is the account holder, not the family member whose page is open",
};
/** Long chats: answers that differ late in a chat from a fresh chat because the chat's earlier topic carries into a
 * short follow-up (the application's deliberate follow-up rule) -- reported, not failed. Any other drift fails. */
const LONG_CHAT_KNOWN = new Set(["H2-C14#5", "H3-C02#2", "H3-C02#6", "H3-C14#1"]);

/** Detector rules about framing rather than rubbish: reported, not failed. */
const FRAMING_RULES = /^(?:question answered as a claim|what-if framing on a plain question|says not found but lists it|slow response)$/;
const LOG = console.log;
async function main() {
  const started = Date.now();
  const watchdog = setTimeout(() => { LOG("WATCHDOG: no completion in 40 minutes"); process.exit(3); }, 40 * 60_000);
  globalThis.fetch = (async (input: RequestInfo | URL) => { throw new Error("network disabled: " + String(input)); }) as typeof fetch;
  console.info = () => undefined; console.debug = () => undefined; console.warn = () => undefined; console.error = () => undefined;
  console.log = (...args: unknown[]) => { if (typeof args[0] === "string" && /^(?:\{"|\[telemetry\]|SQL note|DATABASE_URL)/.test(args[0])) return; LOG(...args); };
  const log = LOG;
  const phases = new Set((process.env.R7R_PHASES ?? "battery,traps,group,chaos,long").split(",").map((x) => x.trim()));
  if (phases.has("traps") || phases.has("long")) phases.add("battery");
  const only = process.env.R7R_HOUSEHOLDS ? process.env.R7R_HOUSEHOLDS.split(",") as never : undefined;
  const report = process.env.R7R_REPORT === "1";
  const dump = process.env.R7R_DUMP; if (dump) writeFileSync(dump, "");
  const onlyIds = process.env.R7R_ONLY ? new RegExp(process.env.R7R_ONLY) : null;
  const { buildHouseholds } = await import("./r7-robust/household");
  const B = await import("./r7-robust/battery");
  const C = await import("./r7-robust/chaos");
  const { chainConversations } = await import("./r7-robust/long");
  const { detect, visibleFields, moneyIn } = await import("./r7-robust/detect");
  const guard = await import("@/lib/chat/output-guard");
  const chaos = await import("@/lib/ai/chaos-model");
  const { DEGRADED: CHAOS_DEGRADED } = await import("./r8/detectors");
  const failures: string[] = [];
  const fail = (s: string) => { failures.push(s); };
  // Round 16: the battery's own definition, which requires the citation check (scripts/r7-robust/battery.ts).
  const passed = (r: import("./r7-robust/battery").Scored) => B.passed(r);
  const canary = await C.canaryDetector(visibleFields);
  const seeds = (process.env.R7R_SEEDS ?? "1,2,3,4,5,6").split(",").map(Number).filter((n) => Number.isInteger(n));

  // ------------------------------------------------------------------ fixture names in product code
  // Round 15: no rule may be written for these households -- their people, insurers, products, policy numbers and files
  // never appear in lib/ or app/ (scripts/r7-robust/leak-check.ts).
  {
    const { fixtureLeaks } = await import("./r7-robust/leak-check");
    const leaks = await fixtureLeaks();
    log(`fixture names in product code: ${leaks.length}`);
    for (const l of leaks) fail("fixture-specific string in product code: " + l);
  }
  // Round 15: items an independent review may judge mis-specified (R7R_DISPUTES=<jsonl of {household,id,turn,...}>): the
  // score is reported twice -- strict (every item) and excluding the disputed ones. Floors and failures use strict.
  const disputed = new Set<string>();
  const disputesFile = process.env.R7R_DISPUTES;
  if (disputesFile && existsSync(disputesFile)) for (const line of readFileSync(disputesFile, "utf8").split("\n").filter((x) => x.trim())) {
    const d = JSON.parse(line) as { household: string; id: string; turn?: number | null };
    disputed.add(d.household + "|" + d.id + "|" + (d.turn ?? ""));
  }
  const strictTotals = { items: 0, fullPass: 0 }, undisputedTotals = { items: 0, fullPass: 0 };

  const built = await buildHouseholds(only);
  log(`households loaded through ingestion in ${built.ingestMs} ms`);
  for (const hh of built.households) for (const [doc, why] of Object.entries(hh.readFailures)) log(`  ${hh.id}: ${doc} could not be read: ${why.slice(0, 160)}`);
  const runOn = (hh: (typeof built.households)[number], extra: Partial<Parameters<typeof B.runBattery>[0]> = {}) =>
    B.runBattery({ hh, others: built.households.filter((x) => x !== hh), db: built.db as never, detect, visibleFields, moneyIn, dump,
      exclude: (id, turn) => !!EXCLUDED[id + (turn != null ? "#" + turn : "")],
      ...(onlyIds ? { singles: (i) => onlyIds.test(i.id), conversations: (c) => onlyIds.test(c.id) } : {}), ...extra });

  // ------------------------------------------------------------------ battery
  const standalone = new Map<string, import("./r7-robust/battery").Scored>();
  const allRows: import("./r7-robust/battery").Scored[] = [];
  if (phases.has("battery")) {
    guard.guardInterventions.length = 0;
    for (const hh of built.households) {
      const t0 = Date.now();
      const every = await runOn(hh);
      // Items the suite does not score (EXCLUDED) count in the strict score only.
      const rows = every.filter((r) => !r.excluded);
      allRows.push(...rows);
      for (const r of rows) standalone.set(r.household + "|" + r.id + "|" + (r.turn ?? ""), r);
      const t = B.tally(every);
      const undisputed = B.tally(every.filter((r) => !disputed.has(r.household + "|" + r.id + "|" + (r.turn ?? ""))));
      strictTotals.items += t.items; strictTotals.fullPass += t.fullPass; undisputedTotals.items += undisputed.items; undisputedTotals.fullPass += undisputed.fullPass;
      log(`\n=== ${hh.id}: ${t.items} items in ${Date.now() - t0} ms`);
      log("strict: " + JSON.stringify(t));
      log(`excluding disputed (${t.items - undisputed.items}): ` + JSON.stringify(undisputed));
      const byRule = new Map<string, number>();
      for (const r of rows) for (const h of r.detectorHits) byRule.set(h.rule, (byRule.get(h.rule) ?? 0) + 1);
      for (const [k, v] of [...byRule].sort((a, b) => b[1] - a[1])) log(`  ${String(v).padStart(4)}  ${k}`);
      const floor = FLOORS[hh.id];
      if (!onlyIds) {
        // (Over the scored items: an EXCLUDED item counts in the strict score above, never as a failure here.)
        const scoredForbidden = B.tally(rows).forbiddenHits;
        if (scoredForbidden) fail(`${hh.id}: ${scoredForbidden} forbidden facts shown (wrong facts, deleted documents or other households)`);
        // Framing notes ("answered as a claim", "what-if framing") are reported;
        // rubbish (garbled text, leaks, invented or foreign figures, other
        // households, deleted documents, "not covered") fails.
        const severe = rows.flatMap((r) => r.detectorHits.filter((h) => !FRAMING_RULES.test(h.rule)).map((h) => r.id + (r.turn ? "#" + r.turn : "") + " " + h.rule + ": " + h.text.slice(0, 120)));
        for (const x of severe) fail(`${hh.id}: rubbish detector: ${x}`);
        if (floor && t.factsCorrect < floor.facts) fail(`${hh.id}: facts correct ${t.factsCorrect} < floor ${floor.facts}`);
        if (floor && t.behaviourCorrect < floor.behaviour) fail(`${hh.id}: behaviour correct ${t.behaviourCorrect} < floor ${floor.behaviour}`);
        if (floor && t.fullPass < floor.fullPass) fail(`${hh.id}: full pass ${t.fullPass} < floor ${floor.fullPass}`);
      }
      for (const r of rows) {
        const bad = !passed(r);
        if (bad && (report || r.forbiddenHits.length || r.detectorHits.length)) {
          log(`✗ ${r.id}${r.turn ? "#" + r.turn : ""} [${r.expected}→${r.behaviour}] ${r.message}`);
          log(`   < ${r.summary.slice(0, 300).replace(/\n/g, " ")}`);
          if (r.missing.length) log(`   missing: ${r.missing.join(" ; ")}`);
          if (r.forbiddenHits.length) log(`   FORBIDDEN: ${r.forbiddenHits.join(" ; ")}`);
          if (r.cite === "missing") log("   citation check: none of the pages the item names is cited");
          for (const h of r.detectorHits.slice(0, 4)) log(`   detector ${h.rule}: ${h.text.slice(0, 200)}`);
        }
      }
    }
    const pct = (x: { items: number; fullPass: number }) => x.items ? (100 * x.fullPass / x.items).toFixed(1) + "%" : "n/a";
    log(`\nfull pass, strict: ${strictTotals.fullPass}/${strictTotals.items} (${pct(strictTotals)}); excluding disputed: ${undisputedTotals.fullPass}/${undisputedTotals.items} (${pct(undisputedTotals)})`);
    const ms = allRows.map((r) => r.ms);
    log(`\nturn time: median ${B.percentile(ms, 0.5)} ms, p95 ${B.percentile(ms, 0.95)} ms, max ${Math.max(...ms)} ms`);
    if (guard.guardInterventions.length) fail(`the output guard had to act ${guard.guardInterventions.length} times on the deterministic model: ` + guard.guardInterventions.slice(0, 3).map((g) => "«" + g.before.slice(0, 160) + "» -> «" + g.after.slice(0, 160) + "»").join(" | "));
  }

  // ------------------------------------------------------------------ traps
  if (phases.has("traps") && !onlyIds) {
    const byId = (h: string, id: string) => allRows.filter((r) => r.household === h && r.id === id);
    let checked = 0;
    for (const [h, ids] of Object.entries(TRAP_ITEMS)) for (const id of ids) {
      const rows = byId(h, id.split("#")[0]).filter((r) => !id.includes("#") || String(r.turn) === id.split("#")[1]);
      if (!rows.length && built.households.some((x) => x.id === h)) fail(`trap item ${h} ${id} was not run`);
      for (const r of rows) { checked++; if (!passed(r)) fail(`trap item ${h} ${id}${r.turn ? "#" + r.turn : ""} no longer passes: ${[...r.missing.map((m) => "missing " + m), ...r.forbiddenHits.map((f) => "forbidden " + f), r.behaviourOk ? "" : "behaviour " + r.behaviour, ...r.detectorHits.map((d) => d.rule), r.cite === "missing" ? "citation check (none of the pages the item names is cited)" : ""].filter(Boolean).join("; ")}`); }
    }
    // Categorical checks over every answer.
    for (const r of allRows) {
      if (r.household === "H2-aisyah" && /\bS\$\s?(?:250,000|3,120)\b/.test(r.text)) fail(`USD amount shown as S$: ${r.id} ${r.text.slice(0, 160)}`);
      // Every line showing the old EquaLife S$300,000 says it is the old figure
      // (the endorsement's own printed Before/After row is the document speaking).
      if (r.household === "H3-ong") for (const line of r.text.split("\n")) {
        if (!/S\$300,000/.test(line) || /S\$300,000\s+S\$250,000/.test(line)) continue;
        if (!/\b(?:no longer|replaced|earlier|original|old|before|superseded|reduced from)\b/i.test(line)) { fail(`old EquaLife S$300,000 shown as current: ${r.id}${r.turn ? "#" + r.turn : ""} ${line.slice(0, 200)}`); break; }
      }
      if (/US\$0\.00|S\$0\.00 a year/.test(r.text)) fail(`zero premium total shown: ${r.id}`);
    }
    log(`\ntraps: ${checked} locked items checked`);
  }

  // ------------------------------------------------------------------ long
  if (phases.has("long") && !onlyIds) {
    const longRows: import("./r7-robust/battery").Scored[] = [];
    for (const hh of built.households) {
      const battery = await B.readBattery(hh.id);
      const chains = chainConversations(battery.conversations);
      for (const ch of chains) if (ch.turns.length < 30) fail(`long chat ${ch.id} has only ${ch.turns.length} turns`);
      // (EXCLUDED items are left out here, as the battery left them out before it began scoring them for the strict score.)
      const rows = (await runOn(hh, { dump: process.env.R7R_DUMP_LONG, noSingles: true, conversationsOverride: chains })).filter((r) => !r.excluded);
      longRows.push(...rows);
      for (const r of rows) {
        const alone = standalone.get(r.household + "|" + r.id + "|" + (r.turn ?? ""));
        const where = `${hh.id} ${(r as { longId?: string }).longId} (${r.id}#${r.turn}) «${r.message.slice(0, 80)}»`;
        if (r.forbiddenHits.length || r.detectorHits.some((h) => !FRAMING_RULES.test(h.rule))) fail(`long chat ${where}: ${[...r.forbiddenHits, ...r.detectorHits.filter((h) => !FRAMING_RULES.test(h.rule)).map((h) => h.rule + ": " + h.text.slice(0, 120))].join(" | ")}`);
        if (!alone) continue;
        const drift = LONG_CHAT_KNOWN.has(r.id + "#" + r.turn) ? (x: string) => log("  (known long-chat drift) " + x) : fail;
        if (alone.resolved && r.resolved && alone.resolved !== r.resolved && passed(alone)) drift(`long chat ${where}: answered about a different person than in a fresh chat`);
        if (passed(alone) && !passed(r)) drift(`long chat ${where}: passes in a fresh chat but not late in a long one (${[...r.missing.map((m) => "missing " + m), r.behaviourOk ? "" : "behaviour " + r.behaviour, r.cite === "missing" ? "citation check" : ""].filter(Boolean).join("; ")})`);
      }
      // A claim question from an earlier sub-conversation must not come back.
      const byChain = new Map<string, typeof rows>();
      for (const r of rows) { const k = (r as { longId?: string }).longId ?? ""; (byChain.get(k) ?? byChain.set(k, []).get(k)!).push(r); }
      for (const [chain, rs] of byChain) {
        const seen = new Map<string, string>();
        for (const r of rs) {
          const alone = standalone.get(r.household + "|" + r.id + "|" + (r.turn ?? ""));
          for (const q of (r.questions ?? []).filter((x) => !/^Who is this about\?$/.test(x))) {
            const from = seen.get(q);
            if (from && from !== r.id && !(alone?.questions ?? []).includes(q)) fail(`long chat ${hh.id} ${chain}: ${r.id}#${r.turn} resumed ${from}'s claim question «${q}»`);
          }
          for (const q of r.questions ?? []) if (!seen.has(q)) seen.set(q, r.id);
        }
      }
    }
    const ms = longRows.map((r) => r.ms), median = B.percentile(ms, 0.5);
    const outliers = longRows.filter((r) => r.ms > Math.max(1500, 5 * median));
    log(`\nlong chats: ${longRows.length} turns in ${new Set(longRows.map((r) => (r as { longId?: string }).longId)).size} chats; turn time median ${median} ms, p95 ${B.percentile(ms, 0.95)} ms, max ${Math.max(...ms)} ms; ${outliers.length} outliers`);
    for (const o of outliers.slice(0, 10)) log(`  slow: ${o.ms} ms ${o.household} ${o.id}#${o.turn} «${o.message.slice(0, 80)}»`);
    if (outliers.length > Math.max(3, longRows.length * 0.02)) fail(`long chats: ${outliers.length} slow turns (over 5x the median)`);
  }

  // ------------------------------------------------------------------ chaos
  // The application's own chaos stand-in (lib/ai/chaos-model.ts, chaos-<seed>,
  // NODE_ENV=test only) in every chat role: interpretation, passage reading,
  // relevance, judgement and narration, on the households read cleanly.
  if (phases.has("chaos") && !onlyIds && !process.env.R7R_SKIP_CHAT_CHAOS) {
    chaos.resetChaos();
    let turns = 0, honest = 0;
    for (const [n, seed] of seeds.entries()) {
      await built.db.query("DELETE FROM policy_analysis_cache").catch(() => undefined);
      process.env.DEARPOLICY_DETERMINISTIC_MODEL = "chaos-" + seed;
      guard.guardInterventions.length = 0;
      for (const hh of built.households) {
        const rows = await runOn(hh, { dump: undefined, singles: (i) => Number(i.id.replace(/\D/g, "")) % seeds.length === n, conversations: (c) => Number(c.id.replace(/\D/g, "")) % seeds.length === n,
          extra: (a, q) => canary(a, q) }).then((x) => x.filter((r) => !r.excluded));
        turns += rows.length;
        for (const r of rows) {
          if (/couldn[’']t read your message just now|ran out of room part-way|couldn[’']t (?:put|check)|try again/i.test(r.summary)) honest++;
          const hits = r.detectorHits.filter((h) => !FRAMING_RULES.test(h.rule) && !CHAOS_DEGRADED.test(h.rule));
          if (hits.length || r.forbiddenHits.length) fail(`chaos seed ${seed} ${hh.id} ${r.id}${r.turn ? "#" + r.turn : ""}: ${[...hits.map((h) => h.rule + ": " + h.text.slice(0, 140)), ...r.forbiddenHits.map((f) => "forbidden " + f)].join(" | ")}`);
        }
      }
    }
    const mutated = chaos.chaosLog.filter((x) => x.mode !== "none");
    const byOp = new Map<string, number>(); for (const x of mutated) byOp.set(x.op, (byOp.get(x.op) ?? 0) + 1);
    log(`\nchaos (chat roles): ${seeds.length} seeds, ${turns} turns, ${mutated.length}/${chaos.chaosLog.length} model calls misbehaved (${[...byOp].map(([k, v]) => k + " " + v).join(", ")}), ${honest} honest "couldn't do it just now" replies`);
    if (mutated.length < 100) fail(`the chat chaos model barely misbehaved (${mutated.length} calls)`);
    process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
  }

  // ------------------------------------------------------------------ group cover
  if (phases.has("group") && !onlyIds) {
    const { groupCoverChecks } = await import("./r7-robust/group");
    const out = await groupCoverChecks({ built, log, part: "r7" });
    for (const f of out) fail(f);
  }

  // ------------------------------------------------------------------ chaos: reading at upload (rebuilds the database)
  if (phases.has("chaos") && !onlyIds) {
    // Document reading misbehaves at upload (lib/ai/chaos-ingest.ts, ingest-chaos-<seed>).
    const ingest = await import("@/lib/ai/chaos-ingest");
    ingest.resetIngestChaos();
    const { ingestionChaos } = await import("./r7-robust/chaos-ingest");
    for (const f of await ingestionChaos({ seeds: seeds.slice(0, 3), only, log, canary })) fail(f);
    const modes = new Map<string, number>(); for (const x of ingest.ingestChaosLog) if (x.mode !== "none") modes.set(x.op + ":" + x.mode, (modes.get(x.op + ":" + x.mode) ?? 0) + 1);
    log("document-reading misbehaviour injected (top):");
    for (const [k, v] of [...modes].sort((a, b) => b[1] - a[1]).slice(0, 20)) log(`  ${String(v).padStart(4)}  ${k}`);
    const total = [...modes.values()].reduce((x, y) => x + y, 0);
    if (total < 30) fail(`the document-reading chaos model barely misbehaved (${total} calls)`);
  }

  // ------------------------------------------------------------------ group cover (r6 household; rebuilds the database)
  // The Round 6 household is read by the stand-in as main's own suites read it: the Round 7 reading aids are switched off.
  if ((phases.has("group") || phases.has("long")) && !onlyIds) (await import("@/lib/ai/deterministic-model")).setDeterministicReadingOracles({ reading: null, catalog: null, capable: false });
  if (phases.has("group") && !onlyIds) {
    const { groupCoverChecks } = await import("./r7-robust/group");
    const out = await groupCoverChecks({ built, log, part: "r6" });
    for (const f of out) fail(f);
  }

  // ------------------------------------------------------------------ long chats on the Round 6 household (rebuilds the database)
  if (phases.has("long") && !onlyIds) {
    const { longR6 } = await import("./r7-robust/long-r6");
    const r = await longR6({ seeds: seeds.slice(0, 2), log });
    for (const f of r.failures) fail(f);
    const median = B.percentile(r.ms, 0.5);
    log(`long r6: turn time median ${median} ms, p95 ${B.percentile(r.ms, 0.95)} ms, max ${Math.max(...r.ms)} ms`);
  }

  clearTimeout(watchdog);
  process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
  log(`\n${failures.length ? failures.length + " FAILURES" : "ok"} in ${Math.round((Date.now() - started) / 1000)} s`);
  for (const f of failures.slice(0, 400)) log("  ✗ " + f);
  process.exit(failures.length && !report ? 1 : 0);
}
main().catch((e) => { LOG(e instanceof Error ? e.stack : e); process.exit(2); });
