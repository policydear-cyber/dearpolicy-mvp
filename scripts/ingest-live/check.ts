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

type Check = { scope: string; check: string; ok: boolean; detail: string };
const read = (dir: string, f: string) => { const p = path.join(dir, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null; };
const g = (o: any, ...keys: string[]) => { for (const k of keys) if (o && o[k] !== undefined) return o[k]; return undefined; };
/** Lower-case, unify dashes / currency spacing / thousands separators, so "S$ 1,100" matches "s$1100". */
export function norm(s: string) { return String(s ?? "").toLowerCase().replace(/[‐-―]/g, "-").replace(/(\d),(?=\d{3}\b)/g, "$1").replace(/s\$\s+/g, "s$").replace(/\s+/g, " ").trim(); }
const has = (text: string, needle: string) => norm(text).includes(norm(needle));
const NON_ANSWER = /something went wrong|try again (later|in a)|could not (answer|complete)|the assistant model returned an error|i (can't|cannot) help/i;

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
  const msgs: any[] = dumpF?.tables?.chat_messages ?? [];
  const used = new Set<number>();
  const stored = (t: any) => {
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].role !== "user" || used.has(i) || String(msgs[i].content ?? "").trim() !== String(t.user).trim()) continue;
      const a = msgs.slice(i + 1).find((m) => m.role === "assistant");
      used.add(i);
      return a ?? null;
    }
    return null;
  };
  const turns = transcript.map((t) => ({ ...t, stored: stored(t) }));
  const deletedFile = deleted?.file ?? null;
  for (const t of turns) {
    const scope = `${t.id} (${t.phase}) "${String(t.user).slice(0, 60)}"`;
    const useful = !t.error && !t.stuck && t.answer.length >= 40 && !NON_ANSWER.test(t.answer);
    add(scope, "useful reply", useful, t.error ? `error: ${t.error}` : t.stuck ? "no reply in time" : `${t.answer.length} chars`);
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
    const fu = g(e, "ask_follow_up", "askFollowUp");
    if (fu === true) add(id, "asks a follow-up before answering", !!first.pendingQuestion, first.pendingQuestion ?? "no question asked");
    if (fu === false) add(id, "answers without an unnecessary follow-up", !first.pendingQuestion, first.pendingQuestion ?? "");
    if (mine.some((t) => t.unansweredFollowUp)) add(id, "follow-up answerable from the fixture", false, `unanswered: ${mine.find((t) => t.unansweredFollowUp)?.pendingQuestion}`);
  }
  const failed = checks.filter((c) => !c.ok);
  const preflight = !!run?.preflight || transcript.some((t) => /preflight/i.test(t.answer ?? ""));
  const verdict = preflight ? "PREFLIGHT (not graded)" : placeholder ? "UNGRADED (placeholder EXPECTED.json)" : failed.length ? "FAIL" : "PASS";
  return { verdict, placeholder, passed: checks.length - failed.length, failed: failed.length, checks };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dir = process.argv[2];
  if (!dir) { console.error("usage: check.ts <run folder>"); process.exit(2); }
  const v = grade(dir);
  fs.writeFileSync(path.join(dir, "verdict.json"), JSON.stringify(v, null, 2));
  console.log(`${v.verdict}: ${"passed" in v ? `${v.passed} passed, ${v.failed} failed` : ""}`);
  process.exit(v.verdict === "PASS" ? 0 : 1);
}
