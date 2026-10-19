/**
 * fx-live-1: does the current pipeline help or hurt on real uploaded policies?  A diagnostic comparison INSIDE the existing test
 * harness (scripts/fixtures/rag2-loop/harness.ts: the real chat route on PGlite); not a second chat engine.
 *
 *   Arm A  the current pipeline: the real route, the loop's own tools / verification / save, the hosted model choosing its tools.
 *   Arm B  a minimal baseline (a DIAGNOSTIC CONTROL, not a fair retrieval score): one chat-completions call per turn, no tools, handed
 *          the COMPLETE stored text of all three documents (every page the household's library stores, headings, tables, footnotes),
 *          the household's two names, same model, same settings, same questions. No verification, no saving.
 *
 * The model is reached only through the courier (scripts/rag2-live/courier.ts): every request is recorded, answered by the
 * workbench's dedicated connection, and replayed; so a run is a sequence of repeats of THIS script until nothing is pending.
 *   node --import tsx scripts/reliable-chat-usefulness-ab.ts run     --dir <D> [--sha <candidate>] [--jobs 2]   one pass: arm A children + arm B
 *   node --import tsx scripts/reliable-chat-usefulness-ab.ts report  --dir <D> [--sha <candidate>]             grade + write results.json / report.md
 *   node --import tsx scripts/reliable-chat-usefulness-ab.ts plumbing --dir <D>                                no model, no spend: record a scripted model, replay it, compare
 *   (internal) child --id <A/K1> --dir <D> [--scripted]
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as FX from "./fixtures/reliable-chat/fracture-conversation";
import { BS, CERT, G, MSG1, MSG2, PS, T1, T2, benefitIdOf, call } from "./fixtures/reliable-chat/fracture-script";
import { uniqueSteps } from "@/components/next-steps";
import { CourierStore, replayFetch, sha256, usageCostUsd, appendJsonl } from "./rag2-live/courier";
import { CASE_IDS, EXPECTED_TURNS, grade, type Graded, type Transcript, type Turn } from "./rag2-live/usefulness-check";
import type { ScriptTurn } from "@/lib/rag2/loop/scripted-model";

const MODEL = "gpt-6-luna";
const arg = (n: string, d?: string) => { const i = process.argv.indexOf("--" + n); return i >= 0 ? process.argv[i + 1] : d; };
const flag = (n: string) => process.argv.includes("--" + n);
const visible = (a: any) => [a?.summary, ...(a?.details ?? []), ...(a?.questions ?? []).map((q: any) => q.text ?? ""), ...uniqueSteps(a?.nextSteps)].filter(Boolean).join("\n");

// ------------------------------------------------------------------------------------------------ the conversations (pre-registered wording)
export type Spec = { id: string; turns: string[]; grade: { case: string; turns: number[] }[] };
const K3T2 = "It was confirmed by X-ray and a registered medical practitioner certified it: yes";
export const SPECS: Spec[] = [
  { id: "K1", turns: ["How much Personal Accident cover does Grace have?"], grade: [{ case: "K1", turns: [0] }] },
  { id: "K2", turns: ["Grace was hospitalised for three days last week because she was sick. Does her accident cover pay anything?"], grade: [{ case: "K2", turns: [0] }] },
  { id: "K3a", turns: [MSG1, K3T2, "Sorry, I meant her leg, not her arm."], grade: [{ case: "K3", turns: [0, 1] }, { case: "K4a", turns: [2] }] },
  { id: "K3b", turns: [MSG1, K3T2, "Sorry, I meant her leg, not her arm."], grade: [{ case: "K3", turns: [0, 1] }, { case: "K4a", turns: [2] }] },
  { id: "K4b", turns: [MSG1, "Actually it was Daniel who broke his arm, not Grace."], grade: [{ case: "K4b", turns: [1] }] },
  { id: "K6a", turns: ["What does Grace's Group Living Care pay if she is diagnosed with cancer?"], grade: [{ case: "K6a", turns: [0] }] },
  { id: "K6b", turns: ["Does Grace's cover pay for dental treatment?"], grade: [{ case: "K6b", turns: [0] }] },
];
/** Plumbing-only conversations (a scripted model plays the recorded production behaviour; they are never model results). */
const TK1: ScriptTurn = { user: /personal accident/i, steps: [
  () => [call("resolve_person", { mention: "grace" })],
  () => [call("person_benefits", { topic: "personal accident cover", subject_id: G })],
  (v) => [call("final_answer", { subject_id: G, sentences: [{ kind: "benefit_terms", benefit_id: benefitIdOf(v, /Personal Accident/i), subject_id: G }], next_steps: ["contact:" + CERT] })],
] };
const PLUMBING: { id: string; turns: string[]; script: ScriptTurn[] }[] = [
  { id: "P1", turns: [SPECS[0].turns[0]], script: [TK1] },
  { id: "P3", turns: [MSG1, K3T2], script: [T1, T2] },
];

const KEY_OF: Record<string, string> = { [CERT]: "CERT", [PS]: "PS", [BS]: "BS" };

// ------------------------------------------------------------------------------------------------ arm B
function documentsBlock(): string {
  return ["CERT", "PRODUCT_SUMMARY", "BENEFIT_SUMMARY"].map((k, i) => {
    const d = FX.doc(k);
    return `=== Document ${i + 1}: ${d.filename} ===\n` + Object.entries(d.pages).sort((a, b) => +a[0] - +b[0]).map(([p, t]) => `--- ${d.filename}, page ${p} ---\n${t}`).join("\n\n");
  }).join("\n\n");
}
export const B_SYSTEM = "You answer questions for a household about its insurance documents. Answer only from the documents provided below. Cite the document and page for each fact. Say plainly when the documents are silent. Be concise.\n\n"
  + "The household: Lee Wei Ming, Daniel (the account holder) and his wife Tan Hui Min Grace.\n\nDOCUMENTS\n" + documentsBlock();

// ------------------------------------------------------------------------------------------------ one conversation
type ConvOut = { id: string; arm: "A" | "B"; tag: string; complete: boolean; turns: (Turn & { keys: string[]; toolMs?: number; otherMs?: number; sandboxMs?: number })[]; stats: { replayed: number; pending: string[]; diverged: any[] }; networkCalls: string[]; scripted?: boolean };

async function runChild(id: string, dir: string, scripted: boolean): Promise<ConvOut> {
  const plumb = PLUMBING.find((p) => p.id === id);
  const spec = SPECS.find((s) => s.id === id) ?? (plumb ? { id, turns: plumb.turns, grade: [] } : null);
  if (!spec) throw new Error("unknown conversation " + id);
  setEnv(FX as any);
  delete process.env.DEARPOLICY_DETERMINISTIC_MODEL;
  process.env.DEARPOLICY_CHAT_CONTRACT = "benefits"; process.env.DEARPOLICY_RAG_LOOP = "1";
  process.env.CHAT_MODEL = `openai:${MODEL}`; process.env.DEARPOLICY_RAG_LOOP_REQUIRE_PRICE = "1";
  const h = await startHarness(FX as any);
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { HostedLoopModel, openAiRequest } = await import("@/lib/rag2/loop/hosted-model");
  const { modelFor } = await import("@/lib/ai/providers");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  const { GET: history } = await import("@/app/api/chat/history/[id]/route");
  const store = new CourierStore(dir);
  const tag = `A/${id}`;
  const rp = replayFetch(store, () => tag, () => "A");
  if (scripted) {
    // plumbing only: the scripted model plays the recorded behaviour; the request it WOULD have sent and a synthetic reply are written to the store
    const inner = new ScriptedLoopModel(plumb!.script); let n = 0;
    installLoopModel({ id: inner.id, kind: "scripted", async next(input) {
      const out = await inner.next(input);
      const body = JSON.stringify(openAiRequest(MODEL, input, "openai")); const key = `${tag}#${n++}`;
      const req = { key, tag, ord: n - 1, req_sha: sha256(body), request: body, reserve_usd: 0, model: MODEL, arm: "A", at: new Date().toISOString() };
      const resp = JSON.stringify({ id: "chatcmpl-plumbing-" + key, model: MODEL + "-PLUMBING", choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: out.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 60, completion_tokens: 20 } });
      if (!store.requests.has(key)) { appendJsonl(store.requestsFile, req); appendJsonl(store.responsesFile, { key, req_sha: req.req_sha, status: 200, response: resp, resp_sha: sha256(resp), upstream_ms: 1, at: req.at }); }
      return out;
    } });
  } else installLoopModel(new HostedLoopModel(modelFor("chat"), rp.fetch, 3_600_000));

  const reopen = async (conv: string) => { const r = await history(new NextRequest(`http://localhost/api/chat/history/${conv}`), { params: Promise.resolve({ id: conv }) }); const j = await r.json(); return (j.messages ?? []).filter((m: any) => m.role === "assistant").map((m: any) => m.answer_json); };
  const out: ConvOut = { id, arm: "A", tag, complete: false, turns: [], stats: rp.stats, networkCalls: h.networkCalls, scripted };
  let conv: { id?: string; rev?: number } = {};
  try {
    for (const [i, user] of spec.turns.entries()) {
      const before = rp.ord.get(tag) ?? 0; const t0 = Date.now();
      let a: any;
      try { a = await h.send(user, conv); } catch (e) { out.turns.push({ user, text: "", questions: [], nextSteps: [], keys: [], error: `send failed: ${(e as Error).message.slice(0, 300)}` }); break; }
      conv = { id: a.conversationId, rev: a.conversationRevision };
      const s = await h.savedAnswer(a.conversationId!);
      const re = (await reopen(a.conversationId!)).at(-1);
      const rl = s.state.ragLoop; const trace = rl.turns.at(-1);
      const keys = Array.from({ length: (rp.ord.get(tag) ?? 0) - before }, (_, k) => `${tag}#${before + k}`);
      const pages = [...new Set((rl.turns as any[]).flatMap((t) => (t.toolCalls ?? []) as any[]).flatMap((c) => c.evidenceIds ?? []).map((eid: string) => rl.evidence[eid]).filter(Boolean).map((e: any) => `${KEY_OF[e.policyId] ?? e.policyId}:${e.page?.start}`))].sort();
      const pending = keys.find((k) => rp.stats.pending.includes(k)), diverged = rp.stats.diverged.find((d) => keys.includes(d.key));
      out.turns.push({
        user, text: visible(s.answer), questions: (s.answer.questions ?? []).map((q: any) => q.text ?? ""), nextSteps: uniqueSteps(s.answer.nextSteps),
        answer: s.answer, trace, shown: visible(a), saved: visible(s.answer), reopened: visible(re), pages, keys,
        toolMs: Object.values((trace?.timings?.toolMs ?? {}) as Record<string, { ms: number }>).reduce((x, y) => x + y.ms, 0), otherMs: trace?.timings?.otherMs, sandboxMs: Date.now() - t0,
        error: pending ? `waiting for the response to ${pending}` : diverged ? `DIVERGED: ${diverged.key} differs from the recorded request` : null,
      });
      if (pending || diverged) break;
      void i;
    }
  } finally { installLoopModel(null); }
  out.complete = out.turns.length === spec.turns.length && out.turns.every((t) => !t.error);
  return out;
}

async function runB(spec: Spec, store: CourierStore, dir: string): Promise<ConvOut> {
  const { loopRequestSettings, openAiReply } = await import("@/lib/rag2/loop/hosted-model");
  const tag = `B/${spec.id}`;
  const rp = replayFetch(store, () => tag, () => "B");
  const messages: any[] = [{ role: "system", content: B_SYSTEM }];
  const out: ConvOut = { id: spec.id, arm: "B", tag, complete: false, turns: [], stats: rp.stats, networkCalls: [] };
  for (const user of spec.turns) {
    messages.push({ role: "user", content: user });
    const settings = loopRequestSettings("openai", MODEL, 1500); delete settings.tool_choice; delete settings.parallel_tool_calls;
    const body = JSON.stringify({ model: MODEL, ...settings, messages });
    const before = rp.ord.get(tag) ?? 0; const t0 = Date.now();
    const res = await rp.fetch("https://api.openai.com/v1/chat/completions", { method: "POST", body });
    const key = `${tag}#${before}`;
    if (res.status !== 200) { out.turns.push({ user, text: "", questions: [], nextSteps: [], keys: [key], error: rp.stats.pending.includes(key) ? `waiting for the response to ${key}` : rp.stats.diverged.length ? `DIVERGED: ${key}` : `model service returned ${res.status}` }); break; }
    const reply = openAiReply(await res.json());
    const text = (reply.text ?? "").trim();
    messages.push({ role: "assistant", content: text });
    out.turns.push({ user, text, questions: text.split(/(?<=[.!?])\s+|\n+/).filter((x) => /\?\s*$/.test(x)), nextSteps: [], keys: [key], sandboxMs: Date.now() - t0, error: text ? null : "empty reply" });
  }
  out.complete = out.turns.length === spec.turns.length && out.turns.every((t) => !t.error);
  void dir;
  return out;
}

// ------------------------------------------------------------------------------------------------ parent
const runChildProcess = (id: string, dir: string, scripted = false) => new Promise<number>((resolve) => {
  const p = spawn(process.execPath, ["--import", "tsx", process.argv[1], "child", "--id", id, "--dir", dir, ...(scripted ? ["--scripted"] : [])], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  let err = ""; p.stderr.on("data", (d) => { err += d; });
  p.on("close", (code) => { if (code) fs.writeFileSync(path.join(dir, "out", `child-${id}.err.txt`), err); resolve(code ?? 1); });
});
async function pool<T>(items: T[], jobs: number, f: (x: T) => Promise<unknown>) { const q = [...items]; await Promise.all(Array.from({ length: jobs }, async () => { for (let x = q.shift(); x !== undefined; x = q.shift()) await f(x); })); }

function summarise(dir: string) {
  const store = new CourierStore(dir);
  const outs = fs.readdirSync(path.join(dir, "out")).filter((f) => /^[AB]-.*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(dir, "out", f), "utf8")) as ConvOut);
  const pending = store.pending().map((r) => r.key), diverged = outs.flatMap((o) => o.stats.diverged ?? []);
  return { store, outs, pending, diverged, complete: outs.length > 0 && outs.every((o) => o.complete) && !pending.length && !diverged.length };
}

async function cmdRun(dir: string) {
  fs.mkdirSync(path.join(dir, "out"), { recursive: true });
  const ids = (arg("ids") ?? SPECS.map((s) => s.id).join(",")).split(",");
  const arms = (arg("arms") ?? "A,B").split(",");
  const store = new CourierStore(dir);
  if (arms.includes("B")) for (const id of ids) { const spec = SPECS.find((s) => s.id === id)!; const o = await runB(spec, store, dir); fs.writeFileSync(path.join(dir, "out", `B-${id}.json`), JSON.stringify(o)); }
  if (arms.includes("A")) await pool(ids, Number(arg("jobs", "2")), async (id) => { const code = await runChildProcess(id, dir); if (code) console.error(`child ${id} exited ${code} (see out/child-${id}.err.txt)`); });
  const s = summarise(dir);
  console.log(JSON.stringify({ conversations: s.outs.map((o) => `${o.arm}/${o.id}:${o.turns.length}${o.complete ? "✓" : "…"}`), pending: s.pending, diverged: s.diverged.length, complete: s.complete }));
}

function toTranscript(o: ConvOut, c: { case: string; turns: number[] }): Transcript {
  const idx = c.turns.map((i) => o.turns[i]).filter(Boolean);
  return { case: c.case, arm: o.arm, turns: idx };
}
const costOf = (response: string) => { try { const u = JSON.parse(response).usage ?? {}; const inT = Number(u.prompt_tokens) || 0, cached = Number(u.prompt_tokens_details?.cached_tokens) || 0, outT = Number(u.completion_tokens) || 0; return ((inT - cached) * 0.10 + cached * 0.01 + outT * 0.50) / 1e6; } catch { return 0; } };

function cmdReport(dir: string) {
  const s = summarise(dir);
  const sha = arg("sha") ?? "(not given)";
  const plumbingRun = /PLUMBING/.test(dir);
  const graded: { spec: string; c: string; arm: string; g: Graded; o: ConvOut }[] = [];
  for (const o of s.outs) {
    const spec = SPECS.find((x) => x.id === o.id); if (!spec) continue;
    for (const c of spec.grade) graded.push({ spec: o.id, c: c.case, arm: o.arm, g: grade(toTranscript(o, c)), o });
  }
  const stageAgg: Record<string, Record<string, { pass: number; fail: number }>> = { A: {}, B: {} };
  for (const x of graded) for (const [st, v] of Object.entries(x.g.stages)) { const t = (stageAgg[x.arm][st] ??= { pass: 0, fail: 0 }); t.pass += v.pass; t.fail += v.fail; }
  const calls = [...s.store.responses.values()].map((r) => ({ key: r.key, status: r.status, ms: r.upstream_ms, cost: r.status === 200 ? costOf(r.response) : 0, usage: (() => { try { return JSON.parse(r.response).usage; } catch { return null; } })() }));
  const cost = calls.reduce((a, c) => a + c.cost, 0), costUpper = [...s.store.responses.values()].reduce((a, r) => a + (r.status === 200 ? usageCostUsd(r.response) : 0), 0);
  const byArm = (arm: string) => calls.filter((c) => c.key.startsWith(arm + "/"));
  const results = { run: path.basename(dir), candidate_sha: sha, plumbing: plumbingRun, model: MODEL, complete: s.complete, pending: s.pending, diverged: s.diverged, graded: graded.map((x) => ({ conversation: x.spec, case: x.c, arm: x.arm, verdict: x.g.verdict, note: x.g.note, stages: x.g.stages, checks: x.g.checks })), stages: stageAgg,
    calls: { total: calls.length, errors: calls.filter((c) => c.status !== 200).length, A: byArm("A").length, B: byArm("B").length, upstream_ms_total: calls.reduce((a, c) => a + (c.ms ?? 0), 0), estimated_cost_usd: +cost.toFixed(6), upper_bound_cost_usd: +costUpper.toFixed(6) } };
  fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(results, null, 1));

  const L: string[] = [];
  L.push(`# ${plumbingRun ? "PLUMBING TEST (no model was called; scripted stand-in; NOT a model result)" : "fx-live-1"}: ${path.basename(dir)}`, "", `Candidate SHA: \`${sha}\` · model \`${MODEL}\` · complete: **${s.complete}**${s.pending.length ? ` · pending: ${s.pending.join(", ")}` : ""}${s.diverged.length ? ` · DIVERGED: ${s.diverged.length}` : ""}`, "");
  L.push("## Verdicts (graders v1; a PASS never excuses an unhelpful answer — the answers are below)", "", "| case | conversation | A: current pipeline | B: diagnostic baseline |", "|---|---|---|---|");
  const cases = [...new Set(graded.map((x) => x.c))];
  for (const c of cases) for (const sp of [...new Set(graded.filter((x) => x.c === c).map((x) => x.spec))]) {
    const a = graded.find((x) => x.c === c && x.spec === sp && x.arm === "A"), b = graded.find((x) => x.c === c && x.spec === sp && x.arm === "B");
    const f = (x?: typeof a) => !x ? "—" : x.g.verdict === "INCOMPLETE" ? `INCOMPLETE (${x.g.note})` : `${x.g.verdict}${x.g.checks.filter((k) => k.gate && !k.ok).length ? " — " + x.g.checks.filter((k) => k.gate && !k.ok).map((k) => k.id).join(", ") : ""}`;
    L.push(`| ${c}${["K3", "K4a"].includes(c) ? " (regression data)" : ""} | ${sp} | ${f(a)} | ${f(b)} |`);
  }
  L.push("", "## Stage by stage (gating checks passed / failed, summed over cases)", "", "| stage | A pass | A fail | B pass | B fail |", "|---|---|---|---|---|");
  for (const [k, name] of [["R", "retrieval (A only)"], ["E", "reasoning with the evidence"], ["C", "calculation"], ["V", "verification"], ["S", "saved / displayed (A only)"], ["U", "usefulness"]] as const) {
    const a = stageAgg.A[k] ?? { pass: 0, fail: 0 }, b = stageAgg.B[k] ?? { pass: 0, fail: 0 };
    L.push(`| ${k} ${name} | ${a.pass} | ${a.fail} | ${b.pass} | ${b.fail} |`);
  }
  L.push("", "## Cost and latency", "", `- model calls: ${calls.length} (A ${byArm("A").length}, B ${byArm("B").length}; errors ${calls.filter((c) => c.status !== 200).length}); estimated cost US$${cost.toFixed(6)} (application price on file, cached input at its rate; not provider-billed); upper bound without the cached discount US$${costUpper.toFixed(6)}`);
  L.push(`- model time as measured at the workbench (upstream): ${(calls.reduce((a, c) => a + (c.ms ?? 0), 0) / 1000).toFixed(1)} s over ${calls.length} calls`, "", "| conversation | arm | turn | model calls | in/out tokens | upstream s | tool s | cost US$ |", "|---|---|---|---|---|---|---|---|");
  for (const o of s.outs) for (const [i, t] of o.turns.entries()) {
    const cs = t.keys.map((k) => s.store.responses.get(k)).filter(Boolean) as { response: string; upstream_ms: number | null; status: number }[];
    const tk = cs.reduce((a, c) => { try { const u = JSON.parse(c.response).usage ?? {}; return [a[0] + (u.prompt_tokens ?? 0), a[1] + (u.completion_tokens ?? 0)]; } catch { return a; } }, [0, 0]);
    L.push(`| ${o.id} | ${o.arm} | ${i + 1} | ${t.keys.length} | ${tk[0]}/${tk[1]} | ${(cs.reduce((a, c) => a + (c.upstream_ms ?? 0), 0) / 1000).toFixed(1)} | ${t.toolMs != null ? (t.toolMs / 1000).toFixed(2) : "—"} | ${cs.reduce((a, c) => a + (c.status === 200 ? costOf(c.response) : 0), 0).toFixed(6)} |`);
  }
  L.push("", "## Failed gating checks", "");
  for (const x of graded) for (const k of x.g.checks.filter((k) => k.gate && !k.ok)) L.push(`- **${x.c} / ${x.spec} / arm ${x.arm} / ${k.id}** (${k.stage}): ${k.name}${k.detail ? `\n  \`\`\`\n  ${k.detail.replace(/\n/g, "\n  ")}\n  \`\`\`` : ""}`);
  L.push("", "## Full visible answers (read these, not the verdicts)", "");
  for (const o of s.outs) { L.push(`### ${o.arm} / ${o.id}`, ""); for (const [i, t] of o.turns.entries()) L.push(`**Turn ${i + 1} — household:** ${t.user}`, "", t.error ? `*(no answer: ${t.error})*` : "> " + t.text.replace(/\n/g, "\n> "), ""); }
  fs.writeFileSync(path.join(dir, "report.md"), L.join("\n"));
  console.log(JSON.stringify({ verdicts: graded.map((x) => `${x.arm}/${x.spec}/${x.c}:${x.g.verdict}`), cost: results.calls.estimated_cost_usd, complete: s.complete }));
}

// ------------------------------------------------------------------------------------------------ plumbing (no model, no spend)
async function cmdPlumbing(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, "out"), { recursive: true });
  let failed = 0, passed = 0;
  const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? "\n     " + detail.slice(0, 700) : ""}`); };
  const run = async (id: string, scripted: boolean) => { const code = await runChildProcess(id, dir, scripted); const f = path.join(dir, "out", `A-${id}.json`); return { code, out: fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) as ConvOut : null }; };
  // 1. record: the scripted model plays the recorded behaviour; the requests it would have sent and synthetic replies go to the store
  const rec: Record<string, ConvOut> = {};
  for (const p of PLUMBING) { const r = await run(p.id, true); check(`record ${p.id}: the scripted conversation completes`, r.code === 0 && !!r.out?.complete, String(r.code)); if (r.out) { rec[p.id] = r.out; fs.renameSync(path.join(dir, "out", `A-${p.id}.json`), path.join(dir, "out", `record-${p.id}.json`)); } }
  const store0 = new CourierStore(dir);
  check("record: requests and responses are stored for every model call", store0.requests.size > 5 && store0.responses.size === store0.requests.size, `${store0.requests.size}/${store0.responses.size}`);
  // 2. replay through the HOSTED model class and the replay fetch: the same answers, the same request fingerprints
  for (const p of PLUMBING) {
    const r = await run(p.id, false);
    check(`replay ${p.id}: completes with no pending request and no divergence`, r.code === 0 && !!r.out?.complete && !r.out.stats.pending.length && !r.out.stats.diverged.length, JSON.stringify(r.out?.stats) + (r.out?.turns.map((t) => t.error).join("|") ?? ""));
    check(`replay ${p.id}: the visible answers equal the recorded run's, turn by turn`, !!r.out && r.out.turns.length === rec[p.id].turns.length && r.out.turns.every((t, i) => t.text === rec[p.id].turns[i].text), r.out?.turns.map((t, i) => t.text === rec[p.id].turns[i].text ? "same" : "DIFFERENT\n" + t.text.slice(0, 300) + "\n--\n" + rec[p.id].turns[i].text.slice(0, 300)).join("\n"));
    check(`replay ${p.id}: returned = saved = reopened on every turn`, !!r.out && r.out.turns.every((t) => t.shown === t.saved && t.saved === t.reopened));
    check(`replay ${p.id}: no network call was attempted by the application (the model is reached only through the replay fetch)`, !!r.out && r.out.networkCalls.length === 0, JSON.stringify(r.out?.networkCalls));
  }
  // 3. a partly-answered store: the conversation stops at the first missing response, says so, and resumes when it arrives
  const respFile = path.join(dir, "responses.jsonl"); const all = fs.readFileSync(respFile, "utf8").split("\n").filter(Boolean);
  const drop = all.filter((l) => JSON.parse(l).key === "A/P3#3");
  fs.writeFileSync(respFile, all.filter((l) => !drop.includes(l)).join("\n") + "\n");
  const part = await run("P3", false);
  check("partial store: the conversation stops at the request whose response is missing and reports it", !!part.out && !part.out.complete && /waiting for the response to A\/P3#3/.test(part.out.turns.at(-1)?.error ?? ""), JSON.stringify(part.out?.turns.map((t) => t.error)));
  const sp = new CourierStore(dir).pending().map((r) => r.key);
  check("partial store: exactly that request is pending (nothing after it was invented)", sp.length === 1 && sp[0] === "A/P3#3", JSON.stringify(sp));
  fs.appendFileSync(respFile, drop.join("\n") + "\n");
  const resumed = await run("P3", false);
  check("partial store: with the response applied the conversation completes with the same answers as the record", !!resumed.out?.complete && resumed.out.turns.every((t, i) => t.text === rec.P3.turns[i].text));
  // 4. a request that changed is a divergence, not a silent re-ask
  const reqFile = path.join(dir, "requests.jsonl"); const lines = fs.readFileSync(reqFile, "utf8").split("\n").filter(Boolean);
  const altered = lines.map((l) => { const r = JSON.parse(l); if (r.key === "A/P3#1") r.req_sha = "0".repeat(64); return JSON.stringify(r); });
  fs.writeFileSync(reqFile, altered.join("\n") + "\n");
  const div = await run("P3", false);
  check("a recorded fingerprint that no longer matches is reported as a divergence and the run is not complete", !!div.out && !div.out.complete && div.out.stats.diverged.length >= 1 && /DIVERGED/.test(div.out.turns.at(-1)?.error ?? ""), JSON.stringify(div.out?.stats));
  fs.writeFileSync(reqFile, lines.join("\n") + "\n");
  // 5. arm B through the same store: complete once answered, pending before
  const storeB = new CourierStore(dir);
  const specB: Spec = { id: "PB", turns: ["How much Personal Accident cover does Grace have?"], grade: [] };
  const b0 = await runB(specB, storeB, dir);
  check("arm B: an unanswered request is recorded and the conversation reports it pending", !b0.complete && /waiting/.test(b0.turns[0].error ?? "") && storeB.pending().some((r) => r.key === "B/PB#0"));
  const rb = storeB.requests.get("B/PB#0")!; const body = JSON.parse(rb.request);
  check("arm B: the request has no tools, no tool_choice, the three documents' complete stored text in the system message, and the question", !("tools" in body) && !("tool_choice" in body) && body.messages.length === 2 && Object.values(FX.doc("PRODUCT_SUMMARY").pages).every((p) => body.messages[0].content.includes(p)) && Object.values(FX.doc("CERT").pages).every((p) => body.messages[0].content.includes(p)) && Object.values(FX.doc("BENEFIT_SUMMARY").pages).every((p) => body.messages[0].content.includes(p)) && body.messages[1].content === specB.turns[0], rb.request.slice(0, 300));
  const resp = JSON.stringify({ id: "chatcmpl-pb", model: MODEL + "-PLUMBING", choices: [{ index: 0, message: { role: "assistant", content: "Grace has S$600,000 of Group Personal Accident cover (Certificate of Insurance.pdf, page 1)." }, finish_reason: "stop" }], usage: { prompt_tokens: 9000, completion_tokens: 30 } });
  appendJsonl(path.join(dir, "responses.jsonl"), { key: "B/PB#0", req_sha: rb.req_sha, status: 200, response: resp, resp_sha: sha256(resp), upstream_ms: 1, at: null });
  const b1 = await runB(specB, new CourierStore(dir), dir);
  check("arm B: with the response applied the turn completes with the reply as its text", b1.complete && /S\$600,000/.test(b1.turns[0].text));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

// ------------------------------------------------------------------------------------------------ entry
(async () => {
  const cmd = process.argv[2]; const dir = path.resolve(arg("dir") ?? "");
  if (!cmd || !arg("dir")) { console.error("usage: usefulness-ab.ts run|report|plumbing --dir <D>"); process.exit(2); }
  if (cmd === "child") {
    const o = await runChild(arg("id")!, dir, flag("scripted"));
    fs.mkdirSync(path.join(dir, "out"), { recursive: true });
    fs.writeFileSync(path.join(dir, "out", `A-${o.id}.json`), JSON.stringify(o));
    process.exit(0);
  }
  if (cmd === "run") return cmdRun(dir);
  if (cmd === "report") return cmdReport(dir);
  if (cmd === "plumbing") return cmdPlumbing(dir);
  console.error("unknown command"); process.exit(2);
})().catch((e) => { console.error(e); process.exit(1); });
void CASE_IDS; void EXPECTED_TURNS; void MSG2;
