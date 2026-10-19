/**
 * Output-injection proof for scripts/reliable-chat-death-applicability.ts (dj-live-2 repair).
 * The mutation proofs (…-mutations.ts) show that each defence is exercised; defences overlap, so that alone does not prove that a
 * SAFETY PROPERTY is tested. Here the prohibited output itself is introduced at the final boundary of the real route
 * (lib/rag2/loop/hook.ts, after every gate and before the save / the return) -- no safeguard is removed -- and the end-to-end suite
 * must FAIL on the property that output violates. The source is restored byte for byte after each injection.
 *   node --import tsx scripts/reliable-chat-death-injection.ts          (about 25 seconds per injection)
 *   INJ=J1,J8 node --import tsx scripts/reliable-chat-death-injection.ts
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const FILE = "lib/chat/workflow.ts";
const HOOK = "lib/rag2/loop/hook.ts";
// (the LAST boundary the route owns: the saved-turn function runs the final figure / provenance gate and then stores; the answer it stores is
// the answer the route returns and the browser displays. Injecting earlier (hook.ts, before this gate) is rewritten by that gate -- observed:
// an injected S$600,000 became "I've left out an amount I couldn't match" -- which shows the gate works but cannot test the suite's assertion.)
const BEFORE_VISIBLE = "  return storeTurn(args);\n};\n";
const SAVE = "await opts.save({ conversation, token: context.token, state: next, message, answer, jobId: opts.jobId });";
const RETURN = "return { answer, retrieved: [] };";
type Inj = { id: string; property: string; at: "answer" | "save" | "return"; code: string; expect: RegExp };
const INJECTIONS: Inj[] = [
  { id: "J1", property: "no accident-only PA amount is presented as applicable to the reported illness", at: "answer", code: `answer.details.push("Daniel's certificate lists Group Personal Accident of S$600,000 as of 6 October 2022.");`, expect: /A1 no accident-only amount/ },
  { id: "J2", property: "no contradictory 'no amount' statement beside a shown amount", at: "answer", code: `answer.details.push("No amount is given for Group Term Life.");`, expect: /A1 never 'no amount is given'/ },
  { id: "J3", property: "the dated Term Life S$1,000,000 remains", at: "answer", code: `const sub = (re: RegExp, to: string) => { answer.summary = answer.summary.replace(re, to); answer.details = answer.details.map((d: string) => d.replace(re, to)); }; sub(/S\\$1,000,000/g, "the amount");`, expect: /A1 Term Life S\$1,000,000/ },
  { id: "J4", property: "the dated Term Life amount is not presented as confirmed cover / a payment", at: "answer", code: `answer.details.push("Daniel was covered on the date of death, so Aldermoor will pay S$1,000,000.");`, expect: /A1 the dated Term Life amount is not presented|A1 a visible next step and nothing promised/ },
  { id: "J5", property: "correct person", at: "answer", code: `const sub = (re: RegExp, to: string) => { answer.summary = answer.summary.replace(re, to); answer.details = answer.details.map((d: string) => d.replace(re, to)); }; sub(/Daniel/g, "Grace");`, expect: /A1 Term Life S\$1,000,000|A1 .*only Daniel/ },
  { id: "J6", property: "correct currency", at: "answer", code: `const sub = (re: RegExp, to: string) => { answer.summary = answer.summary.replace(re, to); answer.details = answer.details.map((d: string) => d.replace(re, to)); }; sub(/S\\$1,000,000/g, "US$1,000,000");`, expect: /A1 Term Life S\$1,000,000|A1 .*only S\$/ },
  { id: "J7", property: "correct product (the amount is Term Life's, not Personal Accident's)", at: "answer", code: `const sub = (re: RegExp, to: string) => { answer.summary = answer.summary.replace(re, to); answer.details = answer.details.map((d: string) => d.replace(re, to)); }; sub(/Group Term Life of S\\$1,000,000/g, "Group Personal Accident of S$1,000,000");`, expect: /A1 the S\$1,000,000 is bound to Term Life only/ },
  { id: "J8", property: "correct citations: no source shows the withheld PA amount row", at: "answer", code: `answer.citations = [...(answer.citations ?? []), { ...(answer.citations ?? [])[0], excerpt: "S****411A\\tLee Wei Ming, Daniel\\tS$600,000\\tAs of\\t06/10/2022" }];`, expect: /A1 no source shows the accident-only/ },
  { id: "J9", property: "correct citations: the Term Life amount keeps its source", at: "answer", code: `answer.citations = [];`, expect: /A1 the sources show Daniel/ },
  { id: "J10", property: "returned answer = saved answer", at: "return", code: `return { answer: { ...answer, summary: answer.summary + " (changed after the save)" }, retrieved: [] };`, expect: /returned = saved = reopened/ },
  { id: "J11", property: "saved answer = returned = browser-displayed (reopened)", at: "save", code: `await opts.save({ conversation, token: context.token, state: next, message, answer: { ...answer, summary: answer.summary + " (changed in the save)" }, jobId: opts.jobId });`, expect: /returned = saved = reopened/ },
  { id: "J12", property: "no generic refusal", at: "answer", code: `answer.summary = "I could not find that in your documents."; answer.details = [];`, expect: /A1 Term Life S\$1,000,000|A1 .*refusal/ },
  { id: "J13", property: "no unnecessary question", at: "answer", code: `answer.questions = [...answer.questions, { id: "x", text: "Was the death caused by an accident?", type: "text" }];`, expect: /A1 .*no unnecessary question|returned = saved/ },
];

const only = process.env.INJ;
// every injection runs in a DISPOSABLE COPY of the repository; the release tree is never written. The copy is removed in finally/exit/signals.
const SRC = process.cwd();
const W = mkdtempSync(join(tmpdir(), "inj-"));
const cleanup = () => { try { rmSync(W, { recursive: true, force: true }); } catch { /* best effort */ } };
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => { cleanup(); process.exit(130); });
cpSync(SRC, W, { recursive: true, filter: (f) => !/(^|\/)(node_modules|\.next|\.git|test-results|playwright-report)(\/|$)/.test(f.slice(SRC.length)) });
symlinkSync(join(SRC, "node_modules"), join(W, "node_modules"));
const TIMEOUT_MS = Number(process.env.INJ_TIMEOUT_MS ?? 240000);
const run = () => spawnSync("node", ["--import", "tsx", "scripts/reliable-chat-death-applicability.ts"], { cwd: W, encoding: "utf8", env: { ...process.env, SHOW: "" }, maxBuffer: 64 * 1024 * 1024, timeout: TIMEOUT_MS, killSignal: "SIGKILL" });
const completed = (r: ReturnType<typeof run>) => !r.error && !r.signal && (/^all passed$/m.test(r.stdout ?? "") || /^\d+ FAILED$/m.test(r.stdout ?? ""));
const treeBefore = () => spawnSync("sh", ["-c", "find lib scripts -type f | sort | xargs git hash-object 2>/dev/null | sha1sum"], { cwd: SRC, encoding: "utf8" }).stdout.trim();
const releaseBefore = treeBefore();
const failures = (out: string) => out.split("\n").filter((l) => l.startsWith("FAIL ")).map((l) => l.slice(5, 110));
const origs = new Map([FILE, HOOK].map((f) => [f, readFileSync(join(SRC, f), "utf8")] as const));
const must = (f: string, t: string) => { if (origs.get(f)!.split(t).length !== 2) throw new Error("injection point must occur exactly once in " + f + ": " + t.slice(0, 60)); };
must(FILE, BEFORE_VISIBLE); must(HOOK, SAVE); must(HOOK, RETURN);
let bad = 0;
// control: the unmodified route passes (an injection result means nothing if the suite is already red)
{ const r = run(); const f = failures(r.stdout + r.stderr); if (!completed(r) || r.status !== 0 || f.length) { console.log("CONTROL FAILED: the unmodified suite is not green", f.slice(0, 3)); process.exit(2); } console.log("CONTROL ok: the unmodified suite passes"); }
for (const j of INJECTIONS.filter((x) => !only || only.split(",").includes(x.id))) {
  const file = j.at === "answer" ? FILE : HOOK, orig = origs.get(file)!;
  const edited = j.at === "answer" ? orig.replace(BEFORE_VISIBLE, () => `  { const answer = args.answer; /* INJECTION ${j.id} */ ${j.code} }\n${BEFORE_VISIBLE}`) : j.at === "save" ? orig.replace(SAVE, () => j.code) : orig.replace(RETURN, () => j.code);
  writeFileSync(join(W, file), edited);
  let out = "", code = 0, done = false;
  try { const r = run(); out = r.stdout + r.stderr; code = r.status ?? 1; done = completed(r); } finally { writeFileSync(join(W, file), orig); }
  const f = failures(out);
  const hit = f.some((l) => j.expect.test(l));
  const proved = done && code !== 0 && hit;
  if (!proved) bad++;
  if (!done) { console.log(`CRASHED    ${j.id} [${j.property}] -> no completion (timeout or crash); not a pass`); continue; }
  console.log(`${proved ? "PROVED    " : "NOT PROVED"} ${j.id} [${j.property}] -> ${f.length} failing check(s)${f.length ? ": " + f.filter((l) => j.expect.test(l)).slice(0, 2).join(" | ") || f.slice(0, 2).join(" | ") : ""}`);
}
if (treeBefore() !== releaseBefore) { console.log("RELEASE TREE CHANGED"); process.exit(3); }
console.log("release tree lib+scripts digest UNCHANGED");
console.log(bad ? `\n${bad} injection(s) not proved` : "\nevery safety property is proved: injecting the prohibited output fails the end-to-end suite");
process.exitCode = bad ? 1 : 0;
