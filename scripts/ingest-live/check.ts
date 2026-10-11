/**
 * Deterministic grader of a live ingestion run (no AI judge). Reads the run folder -- transcript.json (what the browser
 * showed), uploads.json / linking.json / members.json / deleted.json, dump-processing/dump.json (stored after
 * processing), dump-final/dump.json (chat answers with citations and the person they resolved to) -- and EXPECTED.json,
 * which the harness copies in only after the conversations. Writes verdict.json; exit code 0 on PASS.
 *
 * EXPECTED.json (tolerant; snake or camel case):
 *   documents: [{ file, linked_people?: [full names], pages?: [{ page, must_contain: [..] }], scanned? }]
 *   turns: { <question id>: { must_include?: [..], must_include_any?: [[..]], must_not_include?: [..],
 *            person?: full name, version?: file (must be cited), citations?: [{ file, page? }], must_not_cite?: [file],
 *            ask_follow_up?: true|false, may_decline?: true } }
 * Checks: document text extracted (per page), automatic person links, figures/conditions present and forbidden ones
 * absent, the right person and version, citations to the expected document and page, a useful reply on every turn, a
 * follow-up asked where one is needed (and not where none is), and after the deletion no answer citing the deleted source.
 *   node --import tsx scripts/ingest-live/check.ts <run folder>
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FIGURE_LEFT_OUT_NOTE } from "@/lib/chat/answer-verification";
import { turnUsefulness, type LoadedTurn } from "../rag2-live/check";
import { factsFrom, moneyValues, sentenceChecks, visibleSentences, type Superseded } from "../rag2-live/check-sentences";

type Check = { scope: string; check: string; ok: boolean; detail: string };
const read = (dir: string, f: string) => { const p = path.join(dir, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null; };
const g = (o: any, ...keys: string[]) => { for (const k of keys) if (o && o[k] !== undefined) return o[k]; return undefined; };
/** Lower-case, unify dashes / currency spacing / thousands separators, so "S$ 1,100" matches "s$1100". */
export function norm(s: string) { return String(s ?? "").toLowerCase().replace(/[‐-―]/g, "-").replace(/(\d),(?=\d{3}\b)/g, "$1").replace(/s\$\s+/g, "s$").replace(/\s+/g, " ").trim(); }
const has = (text: string, needle: string) => norm(text).includes(norm(needle));
/** Sentences that tell the household nothing about their cover: the verification / limit / error notes. They are
 * removed before the rag2-live usefulness rule (scripts/rag2-live/check.ts turnUsefulness) is applied, so a reply made
 * only of them -- e.g. run ingest-live-1's Q2 "I couldn’t confirm one of the figures against the cited page of your
 * documents." with citations attached -- is not useful. */
export const GENERIC_SENTENCES: RegExp[] = [
  new RegExp("^" + FIGURE_LEFT_OUT_NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/’/g, "['’]") + "$", "i"),
  // (The same note as worded before round 9, as recorded runs printed it.)
  /^I couldn['’]t confirm one of the (?:figures|statements) against the cited page of your documents\.$/i,
  /^I couldn['’]t finish\b/i, /^Nothing was saved from this attempt\b/i, /^Please (?:try again|ask about one policy)/i,
  /something went wrong|try again (?:later|in a)|the assistant model returned an error/i,
];
const sentencesOf = (t: string) => String(t ?? "").split(/(?<=[.!?])\s+|\n+/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
const genericOnly = (t: string) => sentencesOf(t).filter((x) => !GENERIC_SENTENCES.some((re) => re.test(x))).join(" ");
/** Usefulness of one stored assistant message: a cited figure or condition, a single material question, or an honest
 * statement of what the documents do not say (the rag2-live rule), after removing generic notes. */
export function usefulReply(stored: { content?: string | null; answer_json?: any } | null, trace: any | null, user: string): { ok: boolean; detail: string } {
  if (!stored) return { ok: false, detail: "no stored answer" };
  const a = stored.answer_json ?? { summary: stored.content };
  if (trace?.limit) return { ok: false, detail: `stopped by a limit (${typeof trace.limit === "string" ? trace.limit : JSON.stringify(trace.limit)})` };
  const content = genericOnly(stored.content ?? a.summary ?? "");
  const details = ((a.details ?? []) as string[]).map(genericOnly).filter(Boolean);
  const turn: LoadedTurn = { index: 0, user, answer: { ...a, summary: content, details }, content, visible: content, questions: ((a.questions ?? []) as any[]).map((q) => String(q?.text ?? "")).filter(Boolean), userAt: null, assistantAt: null, trace };
  const u = turnUsefulness(turn);
  const removed = sentencesOf([stored.content ?? a.summary ?? "", ...((a.details ?? []) as string[])].join("\n")).filter((x) => GENERIC_SENTENCES.some((re) => re.test(x)));
  return { ok: u.ok, detail: u.detail + (removed.length ? ` (generic note set aside: "${removed[0]}")` : "") };
}

/** The loop's per-turn traces from the stored conversation state (chat_conversations.state.ragLoop.turns), each
 * taken once, matched by conversation and user message. */
/** The stored user message for a browser turn: the same text, or -- for an answer typed into the inline answer box --
 * "<the chat's question>: <the answer>". */
export const sameUserMessage = (stored: unknown, typed: unknown) => { const a = String(stored ?? "").trim(), b = String(typed ?? "").trim(); return !!b && (a === b || a.endsWith(": " + b)); };
export function conversationTraces(dump: any) {
  const byConv = new Map<string, any[]>(((dump?.tables?.chat_conversations ?? []) as any[]).map((c) => [String(c.id), [...(c.state?.ragLoop?.turns ?? [])]]));
  return { take(conversationId: string | undefined, user: string) {
    const list = conversationId ? byConv.get(String(conversationId)) ?? [] : [...byConv.values()].flat();
    const i = list.findIndex((x) => sameUserMessage(x?.userMessage, user));
    if (i < 0) return null;
    const [t] = list.splice(i, 1); return t;
  } };
}
/** One turn's loop diagnostics for transcript.json and the report: tool calls (ok / error), gate and composer drops,
 * the limit, steps, and token usage (per call where the trace has it). */
export function loopDiagnostics(trace: any | null) {
  if (!trace) return null;
  return {
    outcome: trace.outcome ?? null, steps: trace.steps ?? null, limit: trace.limit ?? null, latencyMs: trace.latencyMs ?? null, modelId: trace.modelId ?? null,
    usage: trace.usage ?? null, calls: trace.calls ?? null,
    toolCalls: ((trace.toolCalls ?? []) as any[]).map((c) => ({ name: c.name, ok: c.ok !== false, error: c.error ?? null, summary: c.summary ?? null, evidence: (c.evidenceIds ?? []).length, args: c.name === "final_answer" || c.name === "ask_user" ? undefined : c.args })),
    gate: trace.gate ?? [], dropped: trace.dropped ?? [], evidenceChosen: trace.evidenceChosen ?? [],
  };
}

/** Each browser turn with its stored assistant message (the next assistant message in the same conversation after
 * the same user message, by message_order) and the loop's trace for it. */
export function pairTurns(transcript: any[], dumpF: any) {
  // In the app's own order (message_order, as the chat history reads them): a user message and its answer are saved in
  // one transaction with the same created_at, so the dump's row order alone can put the answer first.
  const raw: any[] = dumpF?.tables?.chat_messages ?? [];
  const msgs: any[] = raw.every((m) => m.message_order != null) ? [...raw].sort((a, b) => Number(a.message_order) - Number(b.message_order)) : raw;
  const used = new Set<number>();
  const stored = (t: any) => {
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].role !== "user" || used.has(i) || !sameUserMessage(msgs[i].content, t.user)) continue;
      const a = msgs.slice(i + 1).find((m) => m.role === "assistant" && (m.conversation_id ?? null) === (msgs[i].conversation_id ?? null));
      used.add(i);
      return a ?? null;
    }
    return null;
  };
  const traces = conversationTraces(dumpF);
  return transcript.map((t) => { const st = stored(t); return { ...t, stored: st, trace: st ? traces.take(st.conversation_id, t.user) : null }; });
}
/** Writes each turn's loop diagnostics into transcript.json (field `loop`), from the final dump's conversation state. */
export function annotateTranscript(dir: string) {
  const transcript: any[] = read(dir, "transcript.json") ?? [];
  const dumpF = read(path.join(dir, "dump-final"), "dump.json");
  if (!transcript.length || !dumpF) return;
  const paired = pairTurns(transcript, dumpF);
  fs.writeFileSync(path.join(dir, "transcript.json"), JSON.stringify(paired.map(({ stored, trace, ...t }) => ({ ...t, loop: loopDiagnostics(trace), storedCitations: ((stored?.answer_json?.citations ?? []) as any[]).map((c) => ({ policyId: c.policyId, pageStart: c.pageStart ?? null, pageEnd: c.pageEnd ?? null })) })), null, 2));
}

/** The expected facts the whole-answer rules compare against: every figure and date in the author's verbatim facts and
 * expected answers (EXPECTED.source.json), the machine expectations' own figures, and the superseded pairs. */
export function expectedFacts(dir: string, expected: any, amendmentRemovedBy: string | null) {
  const source = read(dir, "EXPECTED.source.json");
  const texts: string[] = [];
  for (const f of (source?.facts ?? []) as any[]) texts.push(...((f.verbatim ?? []) as string[]));
  for (const a of (source?.answers ?? []) as any[]) texts.push(String(a.expected ?? ""), ...((a.arithmetic ?? []) as string[]));
  for (const e of Object.values((g(expected, "turns") ?? {}) as Record<string, any>)) texts.push(...((g(e, "must_include", "mustInclude") ?? []) as string[]), ...(((g(e, "accept_any", "acceptAny") ?? []) as any[]).flatMap((x) => x.must_include ?? [])), ...((g(e, "figures_also", "figuresAlso") ?? []) as string[]));
  const sup: (Superseded & { by?: string })[] = ((g(expected, "superseded") ?? []) as any[]).map((x) => ({ old: moneyValues(String(x.old))[0], new: moneyValues(String(x.new))[0], label: x.label, by: x.by })).filter((x) => Number.isFinite(x.old) && Number.isFinite(x.new));
  return factsFrom(texts, sup, !!amendmentRemovedBy && sup.some((x) => x.by === amendmentRemovedBy));
}
const norm1 = (q: string) => String(q ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
/** Whether two questions are the same question (identical, or 80% of the words shared). */
export function sameQuestion(a: string, b: string) {
  const x = norm1(a), y = norm1(b); if (!x || !y) return false; if (x === y) return true;
  const wa = new Set(x.split(" ")), wb = new Set(y.split(" ")); const common = [...wa].filter((w) => wb.has(w)).length;
  return common / Math.max(wa.size, wb.size) >= 0.8;
}

export function grade(dir: string) {
  const expected = read(dir, "EXPECTED.json");
  const transcript: any[] = read(dir, "transcript.json") ?? [];
  const uploads: any[] = read(dir, "uploads.json") ?? [];
  const linking: any[] = read(dir, "linking.json") ?? [];
  const deleted = read(dir, "deleted.json");
  const dumpP = read(path.join(dir, "dump-processing"), "dump.json");
  const dumpF = read(path.join(dir, "dump-final"), "dump.json");
  const run = read(dir, "run.json");
  const checks: Check[] = [];
  const add = (scope: string, check: string, ok: boolean, detail = "") => checks.push({ scope, check, ok, detail });
  if (!expected) return { verdict: "UNGRADED", reason: "no EXPECTED.json in the run folder", checks };
  const placeholder = !!expected.placeholder;
  const fileOf = new Map<string, string>(uploads.filter((u) => u.policyId).map((u) => [u.policyId, u.file]));
  for (const l of linking) if (l.policyId) fileOf.set(l.policyId, l.file);
  const members: Record<string, string> = read(dir, "members.json") ?? {};
  const nameOf = new Map(Object.entries(members).map(([n, id]) => [id, n]));

  // Documents: extracted text and automatic links.
  const pages: any[] = dumpP?.tables?.policy_pages ?? [];
  for (const d of (g(expected, "documents") ?? []) as any[]) {
    const up = uploads.find((u) => u.file === d.file);
    add(d.file, "uploaded and processed", !!up?.ready, up ? `${up.finalStatus}${up.error ? "; " + up.error : ""}` : "not uploaded");
    for (const p of (g(d, "pages") ?? []) as any[]) {
      const row = pages.find((r) => fileOf.get(r.policy_id) === d.file && r.page_number === p.page);
      add(d.file, `page ${p.page} text extracted`, !!row && (row.text ?? "").trim().length > 0 && row.extraction_method !== "unreadable", row ? `${row.extraction_method}, ${String(row.text ?? "").length} chars` : "no stored page");
      for (const m of (g(p, "must_contain", "mustContain") ?? []) as string[]) add(d.file, `page ${p.page} contains "${m}"`, !!row && has(row.text, m), row ? "" : "no stored page");
    }
    const want = (g(d, "linked_people", "linkedPeople") ?? null) as string[] | null;
    if (want) {
      const got: string[] = linking.find((l) => l.file === d.file)?.linked ?? [];
      add(d.file, "linked automatically to the right people", want.every((w) => got.some((x) => has(x, w) || has(w, x))) && got.every((x) => want.some((w) => has(x, w) || has(w, x))), `linked: ${got.join(", ") || "nobody"}; expected: ${want.join(", ")}`);
    }
  }

  // Turns: pair each browser turn with its stored answer (the assistant message after the same user message).
  const turns = pairTurns(transcript, dumpF);
  const deletedFile = deleted?.file ?? null;
  // The deletion must be CONFIRMED before any after-deletion question counts: the page's own confirmation, the
  // document gone from the library, its lifecycle no longer active in the final dump, no other document lost, and
  // all of it before the first after-deletion question was asked.
  const delRow = deleted ? ((dumpF?.tables?.policies ?? []) as any[]).find((p) => p.id === deleted.policyId) : null;
  const firstAfter = turns.find((t) => t.phase === "after_delete");
  const otherInactive = deleted ? ((dumpF?.tables?.policies ?? []) as any[]).filter((p) => p.id !== deleted.policyId && p.lifecycle_state && p.lifecycle_state !== "active").map((p) => p.original_filename) : [];
  const deletionConfirmed = !!deleted && deleted.confirmed === true && deleted.listedAfter === false && (!delRow || (delRow.lifecycle_state && delRow.lifecycle_state !== "active")) && !otherInactive.length && (!firstAfter || new Date(deleted.at) <= new Date(firstAfter.at));
  if (deleted || firstAfter) add(`delete ${deletedFile ?? "(nothing deleted)"}`, "deleted through the page and confirmed before the next question", deletionConfirmed,
    deleted ? `notice: "${deleted.notice ?? "-"}"; listed after: ${deleted.listedAfter ?? "unknown"}; lifecycle: ${delRow ? delRow.lifecycle_state : "row gone"}${otherInactive.length ? `; OTHER documents not active: ${otherInactive.join(", ")}` : ""}` : "no deletion recorded");
  for (const t of turns) {
    const scope = `${t.id} (${t.phase}) "${String(t.user).slice(0, 60)}"`;
    const u = t.error ? { ok: false, detail: `error: ${t.error}` } : t.stuck ? { ok: false, detail: "no reply in time" } : usefulReply(t.stored, t.trace, t.user);
    add(scope, "useful reply (a cited figure or condition, one material question, or what the documents do not say)", u.ok, u.detail);
    if (!t.error && !t.stuck && t.answer) {
      const context = turns.filter((x) => x.conversation === t.conversation && new Date(x.at ?? 0) <= new Date(t.at ?? 0)).map((x) => x.user).join("\n");
      for (const c of sentenceChecks(t.answer, expectedFacts(dir, expected, t.phase === "after_delete" ? deletedFile : null), context)) add(scope, c.name, c.ok, c.detail);
    }
    if (t.phase === "after_delete") add(scope, "asked after a confirmed deletion", deletionConfirmed, deletionConfirmed ? "" : "the deletion was not confirmed: this turn tests nothing");
    if (t.phase === "after_delete" && deletedFile) {
      const cites = ((t.stored?.answer_json?.citations ?? []) as any[]).map((c) => fileOf.get(c.policyId) ?? (c.policyId === deleted.policyId ? deletedFile : null));
      add(scope, `does not rely on the deleted ${deletedFile}`, !cites.includes(deletedFile), `cites: ${cites.filter(Boolean).join(", ") || "nothing"}`);
    }
  }
  // Per question id: the LAST answer to that question (after its follow-ups) carries the figures; the first answer
  // shows whether a follow-up was asked.
  const exp = (g(expected, "turns") ?? {}) as Record<string, any>;
  for (const [id, e] of Object.entries(exp)) {
    const mine = turns.filter((t) => t.id === id);
    if (!mine.length) { add(id, "asked", false, "this question was never asked (run stopped earlier?)"); continue; }
    const last = mine[mine.length - 1], first = mine[0];
    const text = mine.map((t) => t.answer).join("\n");
    const finalText = last.answer;
    for (const m of (g(e, "must_include", "mustInclude") ?? []) as string[]) add(id, `states "${m}"`, has(finalText, m), "");
    for (const grp of (g(e, "must_include_any", "mustIncludeAny") ?? []) as string[][]) add(id, `states one of ${JSON.stringify(grp)}`, grp.some((m) => has(finalText, m)), "");
    for (const m of (g(e, "must_not_include", "mustNotInclude") ?? []) as string[]) add(id, `never states "${m}"`, !has(text, m), "");
    const cites = ((last.stored?.answer_json?.citations ?? []) as any[]).map((c) => ({ file: fileOf.get(c.policyId) ?? null, from: c.pageStart ?? null, to: c.pageEnd ?? c.pageStart ?? null }));
    for (const c of (g(e, "citations") ?? []) as any[]) add(id, `cites ${c.file}${c.page ? " page " + c.page : ""}`, cites.some((x) => x.file === c.file && (c.page == null || (x.from != null && x.from <= c.page && c.page <= (x.to ?? x.from)))), `cited: ${cites.map((x) => `${x.file} p${x.from}${x.to !== x.from ? "-" + x.to : ""}`).join(", ") || "nothing"}`);
    for (const f of (g(e, "must_not_cite", "mustNotCite") ?? []) as string[]) add(id, `does not cite ${f}`, !cites.some((x) => x.file === f), "");
    const version = g(e, "version") as string | undefined;
    if (version) add(id, `uses the current version (${version})`, cites.some((x) => x.file === version), `cited: ${[...new Set(cites.map((x) => x.file))].join(", ") || "nothing"}`);
    const person = g(e, "person") as string | undefined;
    if (person) {
      const resolved = last.stored?.answer_json?.resolvedFamilyMemberId ? nameOf.get(last.stored.answer_json.resolvedFamilyMemberId) ?? "(unknown member)" : null;
      const first1 = person.split(/\s+/)[0];
      add(id, `about ${person}`, resolved ? has(resolved, person) || has(person, resolved) : has(finalText, first1), resolved ? `resolved to ${resolved}` : `no stored subject; answer ${has(finalText, first1) ? "names" : "does not name"} ${first1}`);
    }
    // Alternatives (round 8): at least one must hold -- e.g. R1: a justified question for the admission / discharge
    // times, OR the figure explicitly conditioned on exactly 72 hours.
    const alts = (g(e, "accept_any", "acceptAny") ?? []) as any[];
    if (alts.length) {
      const holds = alts.map((a) => (a.ask ? !!last.pendingQuestion && new RegExp(a.ask, "i").test(last.pendingQuestion) : true)
        && ((a.must_include ?? []) as string[]).every((m) => has(finalText, m)) && (!a.condition || new RegExp(a.condition, "i").test(finalText)));
      add(id, `one accepted answer: ${alts.map((a) => a.label ?? JSON.stringify(a)).join(" | ")}`, holds.some(Boolean), last.pendingQuestion ? `asks: "${last.pendingQuestion}"` : `answer: "${finalText.slice(0, 160)}"`);
    }
    // A figure that is right only under a condition must be stated with it, in the same or the previous sentence.
    for (const cf of (g(e, "conditioned_figures", "conditionedFigures") ?? []) as { figure: string; condition: string }[]) {
      const sents = visibleSentences(text);
      const bare = sents.filter((x, k) => has(x, cf.figure) && !new RegExp(cf.condition, "i").test(x) && !(k > 0 && new RegExp(cf.condition, "i").test(sents[k - 1])));
      add(id, `${cf.figure} only with its condition`, !bare.length, bare.map((x) => `"${x.slice(0, 140)}"`).join("; "));
    }
    for (const fs1 of (g(e, "forbidden_sentences", "forbiddenSentences") ?? []) as { pattern: string; unless?: string; why: string }[]) {
      const bad = visibleSentences(text).filter((x) => new RegExp(fs1.pattern, "i").test(x) && !(fs1.unless && new RegExp(fs1.unless, "i").test(x)));
      add(id, `never: ${fs1.why}`, !bad.length, bad.map((x) => `"${x.slice(0, 140)}"`).join("; "));
    }
    // The question the chat asked before this turn, once answered, must not be asked again (visible or stored).
    if (g(e, "not_reasked", "notReasked")) {
      const prev = turns.filter((x) => x.conversation === first.conversation && new Date(x.at ?? 0) < new Date(first.at ?? 0)).pop();
      const pending = prev?.pendingQuestion ?? null;
      const storedQs = ((last.stored?.answer_json?.questions ?? []) as any[]).map((q) => String(q?.text ?? q ?? ""));
      const again = pending ? [last.pendingQuestion ?? "", ...storedQs].filter((q) => q && sameQuestion(q, pending)) : [];
      add(id, "the answered question is not asked again", !!pending && !again.length, pending ? (again.length ? `asked again: "${again[0]}"` : `answered: "${pending}"`) : "no earlier pending question found");
    }
    const fu = g(e, "ask_follow_up", "askFollowUp");
    if (fu === true) add(id, "asks a follow-up before answering", !!first.pendingQuestion, first.pendingQuestion ?? "no question asked");
    if (fu === false) add(id, "answers without an unnecessary follow-up", !first.pendingQuestion, first.pendingQuestion ?? "");
    // A question the expectations accept as the answer (accept_any "ask") is the end of the turn, not a gap in the fixture.
    const acceptedAsk = (q: string | null) => !!q && alts.some((a) => a.ask && new RegExp(a.ask, "i").test(q));
    if (mine.some((t) => t.unansweredFollowUp && !acceptedAsk(t.pendingQuestion))) add(id, "follow-up answerable from the fixture", false, `unanswered: ${mine.find((t) => t.unansweredFollowUp)?.pendingQuestion}`);
  }
  const failed = checks.filter((c) => !c.ok);
  const preflight = !!run?.preflight || transcript.some((t) => /preflight/i.test(t.answer ?? ""));
  const verdict = preflight ? "PREFLIGHT (not graded)" : placeholder ? "UNGRADED (placeholder EXPECTED.json)" : failed.length ? "FAIL" : "PASS";
  return { verdict, placeholder, passed: checks.length - failed.length, failed: failed.length, checks };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dir = process.argv[2];
  if (!dir) { console.error("usage: check.ts <run folder>"); process.exit(2); }
  annotateTranscript(dir);
  const v = grade(dir);
  fs.writeFileSync(path.join(dir, "verdict.json"), JSON.stringify(v, null, 2));
  console.log(`${v.verdict}: ${"passed" in v ? `${v.passed} passed, ${v.failed} failed` : ""}`);
  process.exit(v.verdict === "PASS" ? 0 : 1);
}
