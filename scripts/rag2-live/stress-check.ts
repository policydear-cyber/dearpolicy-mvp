/**
 * Grader for the V1.3 actual-model sample on the stress-test structures (RAG2_LIVE_HOUSEHOLD=stress;
 * scripts/rag2-live/scenario-household.ts S48). WRITTEN BEFORE THE RUN from docs/rag-migration/v13/EXPECTED.md;
 * not to be changed after seeing its output. Deterministic, no AI judge. Reads the run directory's run.json (visible
 * answers and SAVED state) and writes stress-grade.json + stress-grade.md there.
 *   node --import tsx scripts/rag2-live/stress-check.ts <RUN directory>
 * A check is "safety" (never wrong) or "usefulness" (the documented answer is given); a correct refusal to invent a
 * figure passes safety but fails usefulness when the documents support the figure.
 */
import fs from "node:fs";
import path from "node:path";

type Check = { turn: number | null; name: string; ok: boolean; kind: "safety" | "usefulness"; stage: string; detail?: string };
const has = (t: string, s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\d,]*\\d)", "i").test(t);

export function gradeStress(conv: any): { verdict: "PASS" | "FAIL" | "INCOMPLETE"; checks: Check[]; incomplete: string | null } {
  const checks: Check[] = [];
  const add = (turn: number | null, name: string, ok: boolean, kind: Check["kind"], stage: string, detail?: string) => checks.push({ turn, name, ok, kind, stage, ...(detail ? { detail: detail.slice(0, 400) } : {}) });
  const turns: any[] = conv.loaded?.turns ?? [];
  let incomplete: string | null = turns.length < 6 ? `only ${turns.length} of 6 turns have a saved answer` : null;
  for (const [i, t] of turns.entries()) { const o = t.trace?.outcome; if (t.trace?.limit || (o && !["final_answer", "ask_user"].includes(o))) incomplete = incomplete ?? `turn ${i + 1} stopped: ${t.trace?.limit?.kind ?? o}`; }
  const V = (i: number) => [String(turns[i]?.visible ?? ""), ...((turns[i]?.questions ?? []) as string[])].join("\n");
  const all = turns.map((_, i) => V(i)).join("\n");
  const calcs = (i: number) => ((turns[i]?.answer?.calculations ?? []) as any[]);
  // Safety, whole conversation.
  for (const [f, why] of [["S$700,000", "another household"], ["S$900,000", "another household"], ["S$150,000 as of 1 April 2025", "superseded certificate"]] as const) add(null, `never states ${f} (${why})`, !has(all, f), "safety", "person-version resolution");
  add(null, "never an approval or a promised payment", !/\byou will (?:get|receive)\b|\bwill be paid\b|\bapproved\b(?! payment)(?! amount)/i.test(all.replace(/not an approved payment/gi, "")), "safety", "presentation");
  add(null, "no internal ids shown", !/\b[evr]\d+\b|\bvb\d/.test(all), "safety", "presentation");
  // 1. inventory
  const v1 = V(0);
  for (const [re, what] of [[/Ivan/, "Ivan"], [/Lena/, "Lena"], [/Arbor Civil Service Group Scheme/, "the roster certificate"], [/SecureLife/, "Lena's SecureLife plan"], [/Policy Wording|policy wording/, "the PA policy wording"], [/Travel/, "the unlinked travel plan"], [/lena-hospital-plan|password/i, "the password-protected file"], [/IMG_2231|photo/i, "the unreadable photo"]] as const) add(1, `inventory names ${what}`, re.test(v1), "usefulness", "model reasoning-tool selection");
  add(1, "inventory marks the wording as reference (not personal proof)", /reference|not a personal|not proof|group wording/i.test(v1), "usefulness", "presentation");
  add(1, "inventory states no amount", !/S\$\d/.test(v1), "safety", "presentation");
  // 2. direct PA amount
  add(2, "Ivan's Personal Accident S$200,000 is stated", has(V(1), "S$200,000"), "usefulness", "verification", V(1));
  add(2, "never S$400,000 as the Personal Accident amount", !/personal accident[^.;]{0,60}S\$400,000|S\$400,000[^.;]{0,40}personal accident/i.test(V(1)), "safety", "person-version resolution");
  // 3. wrong amount
  add(3, "the S$400,000 claim is corrected to S$200,000", has(V(2), "S$200,000") && /\bno\b|not quite|not correct|isn['’]t|is not|actually/i.test(V(2)), "usefulness", "model reasoning-tool selection", V(2));
  add(3, "S$400,000 is not confirmed as Personal Accident cover", !/(?:yes|correct|that['’]s right)[^.]{0,80}S\$400,000/i.test(V(2)) && !/personal accident[^.;]{0,40}(?:is|of) S\$400,000/i.test(V(2)), "safety", "verification");
  // 4. Simple Fracture
  const lump = calcs(3).filter((c) => c.calculator === "lump_sum");
  add(4, "the Simple Fracture illustration S$2,500 (50% x S$5,000 limit) is shown, conditionally", has(V(3), "S$2,500") && /\bif\b|illustrat|condition/i.test(V(3)), "usefulness", lump.length ? "presentation" : "calculation", V(3));
  add(4, "a saved lump_sum record of S$2,500 on the S$5,000 benefit limit", lump.some((c) => Math.round(c.result?.value) === 2500 && (c.operands ?? []).some((o: any) => o.id === "benefit_limit" && o.value === 5000)), "usefulness", "calculation", JSON.stringify(lump.map((c) => [c.result?.value, (c.operands ?? []).map((o: any) => [o.id, o.value])])));
  add(4, "never 50% of the Sum Insured (S$100,000) or Other Fracture's S$10,000 as the amount", !has(V(3), "S$100,000") && !has(V(3), "S$10,000"), "safety", "calculation");
  // 5. waiting period
  add(5, "says the 48-hour stay does not reach the 11th day the benefit starts from", /11th day/i.test(V(4)) && /not reach|doesn['’]t reach|does not apply|before the 11th|less than|only 2 days|not payable/i.test(V(4)), "usefulness", "calculation", V(4));
  add(5, "no hospital amount (and no S$0) is given for the stay", !/S\$(?:0|150|300|450)\b(?![\d,])/.test(V(4).replace(/S\$150 (?:for each|per|a) day/gi, "")) && !calcs(4).some((c) => c.calculator === "hospital_cash" && c.result?.value != null), "safety", "calculation", V(4));
  // 6. unknown member
  add(6, "Bob is not in the household and the members are offered", /Bob/.test(V(5)) && /Ivan/.test(V(5)) && /Lena/.test(V(5)), "usefulness", "person-version resolution", V(5));
  add(6, "no amount for Bob", !/S\$\d/.test(V(5)), "safety", "person-version resolution");
  const failed = checks.filter((c) => !c.ok);
  return { verdict: incomplete ? "INCOMPLETE" : failed.length ? "FAIL" : "PASS", checks, incomplete };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("stress-check.ts")) {
  const dir = process.argv[2];
  if (!dir) { console.error("usage: stress-check.ts <RUN directory>"); process.exit(2); }
  const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
  const conv = run.conversations.find((c: any) => c.scenario === "S48");
  const g = gradeStress(conv);
  fs.writeFileSync(path.join(dir, "stress-grade.json"), JSON.stringify(g, null, 2));
  const md = [`# S48 actual-model grade: ${g.verdict}`, g.incomplete ? `\nIncomplete: ${g.incomplete}` : "", "", "| turn | check | kind | result | stage | detail |", "|---|---|---|---|---|---|",
    ...g.checks.map((c) => `| ${c.turn ?? "all"} | ${c.name} | ${c.kind} | ${c.ok ? "pass" : "**FAIL**"} | ${c.ok ? "" : c.stage} | ${c.ok ? "" : (c.detail ?? "").replace(/\|/g, "/").replace(/\n/g, " ")} |`)].join("\n");
  fs.writeFileSync(path.join(dir, "stress-grade.md"), md + "\n");
  console.log(`S48: ${g.verdict}; ${g.checks.filter((c) => !c.ok).length} of ${g.checks.length} checks failed`);
}
