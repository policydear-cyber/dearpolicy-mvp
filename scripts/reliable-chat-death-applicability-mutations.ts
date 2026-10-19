/**
 * Mutation proof for scripts/reliable-chat-death-applicability.ts (dj-live-2 repair): each repair is disabled in turn by a one-line source
 * edit applied to a DISPOSABLE COPY of the repository (never to the release tree), and the applicability suite must FAIL.
 * Outcomes: DETECTED (suite failed with at least one FAIL check and ran to its completion line), SURVIVED (suite green: the repair is not
 * proved by itself), CRASHED (edit text missing, spawn error, timeout, signal, or no completion line: never a pass).
 * Layered defences may survive alone; their pairs and ALL are run too. The temporary copy is removed in a finally block and on exit/signals.
 *   node --import tsx scripts/reliable-chat-death-applicability-mutations.ts            (about 25 seconds per mutation)
 *   MUT=M3,M5 node --import tsx scripts/reliable-chat-death-applicability-mutations.ts     (one mutation)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

type Edit = { file: string; from: string; to: string };
const R = "lib/rag2/";
export const MUTATIONS: { id: string; repair: string; edits: Edit[] }[] = [
  { id: "M1", repair: "server-written benefit_terms are bound only by their own record's ids (model value ids no longer merged away)", edits: [{ file: R + "loop/statement-render.ts", from: "s.evidence_ids = [...new Set(w.evidence_ids)]; s.value_ids = [...new Set(w.value_ids)];", to: "s.evidence_ids = [...new Set([...((s.evidence_ids as string[]) ?? []), ...w.evidence_ids])]; s.value_ids = [...new Set([...((s.value_ids as string[]) ?? []), ...w.value_ids])];" }] },
  { id: "M2", repair: "the composition lookup never deletes a value another statement holds (dedupe clobber)", edits: [{ file: R + "loop/loop.ts", from: "if (!heldBefore.has(d.valueId)) ctx.values.delete(d.valueId); }", to: "ctx.values.delete(d.valueId); }" }] },
  { id: "M3", repair: "a cached person-row value id is reissued when its value no longer exists", edits: [{ file: R + "evaluate.ts", from: "if (known && ctx.values.has(known)) return known;", to: "if (known) return known;" }] },
  { id: "M4", repair: "a citation of a never-issued value id is set aside when issued ones remain", edits: [{ file: R + "loop/compose.ts", from: "const valIds = issuedVals.length ? issuedVals : allValIds;", to: "const valIds = allValIds;" }] },
  { id: "M5", repair: "a death benefit named but whose amount is not shown is completed from its record", edits: [{ file: R + "loop/loop.ts", from: "!(namedIn(r.benefit, shown) && amountShownIn(r, shown))", to: "!namedIn(r.benefit, shown)" }] },
  { id: "M6", repair: "model statements presenting an excluded benefit's amount are left out", edits: [{ file: R + "loop/loop.ts", from: " || (x?.kind !== \"benefit_terms\" && inapplicableIn(String(x?.subject_id ?? sjA), x ?? {}))", to: "" }] },
  { id: "M7", repair: "the fallback completion and its established statements honour applicability", edits: [{ file: R + "loop/loop.ts", from: "&& !texts.includes(e.text) && !inapplicableIn(e.subjectId ?? subject, e))", to: "&& !texts.includes(e.text))" }, { file: R + "loop/loop.ts", from: " && !inapplicableIn(subject, { valueIds: [vid] }));", to: ");" }, { file: R + "loop/loop.ts", from: "if (look?.kind === \"one\" && inapplicableIn(subject, { valueIds: [look.valueId] })) { /* the sum insured of a benefit the report excludes is not shown */ }\n        else if (look?.kind === \"one\") {", to: "if (look?.kind === \"one\") {" }] },
  { id: "M8", repair: "the budget fallback (partial answer) honours applicability", edits: [{ file: R + "loop/loop.ts", from: " && !inapplicableIn(v.subjectId, { valueIds: [id] }))", to: ")" }, { file: R + "loop/loop.ts", from: "&& !inapplicableIn(x.subjectId ?? state.subjectId ?? \"\", x)).slice(-3)", to: ").slice(-3)" }] },
  { id: "M9", repair: "the death-stop fallback decides applicability first and names the excluded benefits", edits: [{ file: R + "loop/loop.ts", from: "    await causeGate(subject);\n    const recs = await recordsFor(ctx, subject)", to: "    const recs = await recordsFor(ctx, subject)" }, { file: R + "loop/loop.ts", from: "const cnStop = await causeNote(subject, dc.extra.map((x) => String(x.benefit ?? \"\"))).catch(() => null);", to: "const cnStop = null as Record<string, unknown>[] | null;" }] },
  { id: "M10", repair: "a certificate summary never lists a person under a withheld benefit", edits: [{ file: R + "loop/loop.ts", from: "withheldRows: (sj: string) => new Set(naRecordsFor(sj).filter((r) => !askedDirectly(r)).map((r) => `${r.policy.id}|${nmL(r.benefit)}`)), ", to: "" }] },
  { id: "M11", repair: "'no amount is given' is never left beside the amount it denies", edits: [{ file: R + "loop/loop.ts", from: "  const dropContradictions = (c: Composed | null | undefined) => {\n    if (!c) return;", to: "  const dropContradictions = (c: Composed | null | undefined) => {\n    if (!c || c) return;" }] },
  { id: "M12", repair: "a directly requested historical amount is separated from this event (no 'no amount is given' for it)", edits: [{ file: R + "loop/loop.ts", from: "const amountDisplayed = (r: BenefitRecord) => { const c", to: "const amountDisplayed = (r: BenefitRecord) => { if (r) return false; const c" }] },
  { id: "M13", repair: "applicability is decided from the benefit's own wording; a product heading alone does not decide", edits: [{ file: R + "benefit-applicability.ts", from: "if (r.applicability !== \"person_row\") return { wording: `${r.benefit} is an accident benefit`, kind: \"benefit_name\" };", to: "return { wording: `${r.benefit} is an accident benefit`, kind: \"benefit_name\" };" }] },
  { id: "M14", repair: "applicability reads the household's reported cause (illness / accident / unknown)", edits: [{ file: R + "benefit-applicability.ts", from: "  return { ...base, status: \"not_applicable\", withhold: true,", to: "  return { ...base, status: \"supported\", withhold: false," }] },
  { id: "M15", repair: "an excluded record's terms are not re-rendered by the retained-terms recovery", edits: [{ file: R + "loop/loop.ts", from: " || (notApplicable.has(`${who}|${c[0].id}`) && !askedDirectly(c[0]))) continue;", to: ") continue;" }] },
];
// layered defences: each of these two repairs masks the other for the replay, so the pair is disabled together as well
const pair = (a: string, b: string) => ({ id: `${a}+${b}`, repair: `${a} and ${b} together (layered defences)`, edits: [...MUTATIONS.find((m) => m.id === a)!.edits, ...MUTATIONS.find((m) => m.id === b)!.edits] });
MUTATIONS.push(pair("M1", "M4"), pair("M3", "M4"), pair("M6", "M15"));


import { mkdtempSync, rmSync, cpSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const only = process.env.MUT;
const TIMEOUT_MS = Number(process.env.MUT_TIMEOUT_MS ?? 240000);
const SRC = process.cwd();
const tmpDirs = new Set<string>();
const cleanup = () => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } tmpDirs.delete(d); } };
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => { cleanup(); process.exit(130); });

const copyRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), "mut-"));
  tmpDirs.add(dir);
  cpSync(SRC, dir, { recursive: true, filter: (f) => !/(^|\/)(node_modules|\.next|\.git|test-results|playwright-report)(\/|$)/.test(f.slice(SRC.length)) });
  symlinkSync(join(SRC, "node_modules"), join(dir, "node_modules"));
  return dir;
};
const applyIn = (dir: string, edits: Edit[]): string | null => {
  for (const e of edits) {
    const f = join(dir, e.file);
    const at = readFileSync(f, "utf8");
    if (at.split(e.from).length !== 2) return `mutation text must occur exactly once in ${e.file}: ${e.from.slice(0, 60)}`;
    writeFileSync(f, at.replace(e.from, () => e.to));
  }
  return null;
};
type Result = { id: string; repair: string; outcome: "DETECTED" | "SURVIVED" | "CRASHED"; note: string };
const runIn = (dir: string, edits: Edit[]): { outcome: Result["outcome"]; note: string } => {
  const bad = applyIn(dir, edits);
  if (bad) return { outcome: "CRASHED", note: bad };
  const r = spawnSync("node", ["--import", "tsx", "scripts/reliable-chat-death-applicability.ts"], { cwd: dir, encoding: "utf8", env: { ...process.env, SHOW: "" }, maxBuffer: 64 * 1024 * 1024, timeout: TIMEOUT_MS, killSignal: "SIGKILL" });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  if (r.error) return { outcome: "CRASHED", note: `spawn error: ${r.error.message}` };
  if (r.signal) return { outcome: "CRASHED", note: `killed by ${r.signal} (timeout ${TIMEOUT_MS}ms?)` };
  const done = /^all passed$/m.test(out) || /^\d+ FAILED$/m.test(out);
  if (!done) return { outcome: "CRASHED", note: `no completion line (exit ${r.status})` };
  const fails = out.split("\n").filter((l) => l.startsWith("FAIL ")).map((l) => l.slice(5, 90));
  if (r.status !== 0 && fails.length) return { outcome: "DETECTED", note: `${fails.length} failing check(s): ${fails.slice(0, 3).join(" | ")}` };
  if (r.status === 0 && !fails.length) return { outcome: "SURVIVED", note: "suite stayed green" };
  return { outcome: "CRASHED", note: `inconsistent result (exit ${r.status}, ${fails.length} FAIL lines)` };
};

const results: Result[] = [];
const base = MUTATIONS.filter((m) => !m.id.includes("+"));
const todo = [...MUTATIONS.filter((m) => !only || only.split(",").includes(m.id)), ...(only && !only.split(",").includes("ALL") ? [] : [{ id: "ALL", repair: "all of the above at once", edits: base.flatMap((m) => m.edits) }])];
const treeDigest = () => spawnSync("sh", ["-c", "find lib scripts -type f | sort | xargs git hash-object 2>/dev/null | sha1sum"], { cwd: SRC, encoding: "utf8" }).stdout.trim();
const before = treeDigest();
try {
  // control: the unmodified copy must pass to completion, otherwise nothing below means anything
  const ctl = copyRepo();
  try {
    const r = spawnSync("node", ["--import", "tsx", "scripts/reliable-chat-death-applicability.ts"], { cwd: ctl, encoding: "utf8", env: { ...process.env, SHOW: "" }, maxBuffer: 64 * 1024 * 1024, timeout: TIMEOUT_MS, killSignal: "SIGKILL" });
    if (r.status !== 0 || !/^all passed$/m.test(r.stdout ?? "")) { console.log("CONTROL FAILED: the unmodified copy does not pass; no mutation result is meaningful"); process.exitCode = 2; }
    else console.log("CONTROL ok: the unmodified copy passes");
  } finally { rmSync(ctl, { recursive: true, force: true }); tmpDirs.delete(ctl); }
  if (!process.exitCode) for (const m of todo) {
    const dir = copyRepo();
    let res: { outcome: Result["outcome"]; note: string };
    try { res = runIn(dir, m.edits); }
    catch (e) { res = { outcome: "CRASHED", note: `runner error: ${(e as Error).message}` }; }
    finally { rmSync(dir, { recursive: true, force: true }); tmpDirs.delete(dir); }
    results.push({ id: m.id, repair: m.repair, ...res });
    console.log(`${res.outcome.padEnd(8)} ${m.id} (${m.repair}) -> ${res.note}`);
  }
} finally { cleanup(); }
const after = treeDigest();
console.log(`\nrelease tree lib+scripts digest ${before === after ? "UNCHANGED" : "CHANGED (!)"}: ${before.slice(0, 12)} -> ${after.slice(0, 12)}`);
const n = (o: string) => results.filter((r) => r.outcome === o).length;
console.log(`detected ${n("DETECTED")}, survived ${n("SURVIVED")} (${results.filter((r) => r.outcome === "SURVIVED").map((r) => r.id).join(",") || "-"}), crashed ${n("CRASHED")} (${results.filter((r) => r.outcome === "CRASHED").map((r) => r.id).join(",") || "-"})`);
if (before !== after || n("CRASHED") || process.exitCode === 2) process.exitCode = process.exitCode || 1;
