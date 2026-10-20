/**
 * fx-live-2 REVIEWED criteria (v2). A second reading of the three registered checks that failed in the live run, written AFTER the run and
 * kept apart from it. Nothing here replaces or edits the registered criteria (fx-live-2-criteria.ts) or the v1 usefulness grader
 * (usefulness-check.ts): those stay exactly as registered and still return the original grades on the saved answers
 * (fx-live-2-criteria-v2-regressions.ts proves it). This module returns BOTH grades side by side for every check, so the original result is
 * never shown as a pass.
 *
 * What the review found, one reading per failed check (the complete answers are quoted in
 * DISPOSITION.md in the fx-live-2 run folder under docs/rag-migration/live):
 *   D5.c  (and v1 K3t1.6)  negation: "do not establish which document governs" was matched by the "a document governs" pattern. Reviewed: a
 *                          prevail / govern phrase counts only when its own clause does not negate it, ask about it ("which", "whether"),
 *                          or make it conditional.
 *   D2.b                   multi-sentence limitation: the limitation may be one sentence further away when it is explained by a second sentence
 *                          (K6a: limitation, its explanation, then the amount), and the verb list lacked "establish" (K6c). Reviewed: two
 *                          sentences either side, no other amount in between, and the verbs establish / determine / confirm / tell.
 *   D7.c  (and v1 V0)      a composer drop is reported, not graded as a defect, when it removed ONE unsupported requirement and nothing that a
 *                          criterion needs. Reviewed grade: SAFEGUARD (not PASS): the drop is named with its reason.
 *
 *   node --import tsx scripts/rag2-live/fx-live-2-criteria-v2.ts <run dir>   # reads <dir>/answers.json, writes <dir>/criteria-reviewed.json and .md
 */
import fs from "node:fs";
import path from "node:path";
import { criteria, plumbing, type Crit, type CTurn } from "./fx-live-2-criteria";
import { money, sentences } from "./usefulness-check";

export type Grade = "PASS" | "FAIL" | "SAFEGUARD";
export type Reviewed = { id: string; name: string; original: "PASS" | "FAIL"; reviewed: Grade; changed: boolean; basis?: string };

const has = (t: string, n: number) => money(n).test(t);
const NEG = /\b(?:not|no|never|cannot|can[’']t|doesn[’']t|does not|don[’']t|do not|isn[’']t|is not|neither|nor|unless|without)\b/i;
const NOT_A_CLAIM = /\b(?:unclear|unknown|unsettled|whether|which|if|whichever|establish|determine|decide|settle)\b/i;
const PICKS_ONE = /\b(?:prevails?|overrides?|supersedes?|takes precedence|governs|is the (?:correct|right|applicable) (?:one|figure|amount)|should be (?:used|relied)|the (?:more )?reliable)\b/i;
const ALTERNATIVES = /alternative|never a total|not (?:be )?(?:added|combined|summed)|do(?:es)? not (?:say|settle)|which (?:one )?applies|can[’']t tell which|don[’']t say which/i;
const CLAUSE = /[;:,]|\b(?:but|however|although|though|while|whereas|yet)\b/i;

/** The clauses in which one document is SAID to prevail (a pick), as opposed to denied, asked about or made conditional. */
export function picksOneReviewed(x: string): string[] {
  const out: string[] = [];
  for (const s of sentences(x)) {
    for (const clause of s.split(CLAUSE)) {
      const m = PICKS_ONE.exec(clause);
      if (!m) continue;
      const before = clause.slice(0, m.index);
      if (NEG.test(before) || NOT_A_CLAIM.test(before)) continue;
      out.push(clause.trim());
    }
  }
  return out;
}

/** D5.c as registered, with the pick test made negation-aware (everything else in it is unchanged). */
export function d5cReviewed(x: string): boolean {
  return [121250, 150000, 1000].every((n) => !has(x, n)) && ALTERNATIVES.test(x) && picksOneReviewed(x).length === 0 && /\b(?:fixed|limit)\b/i.test(x) && /sum insured/i.test(x);
}

const LIMIT_VERB = /(?:does|do) not (?:state|describe|say|specify|set out|show|give|establish|determine|confirm|tell)|not (?:stated|described|specified|established|determined|printed|shown)|(?:no|nothing in) (?:page|document|these documents)|cannot (?:tell|say|determine|confirm)|can[’']t (?:tell|say|determine|confirm)|doesn[’']t (?:say|state|describe|establish)|silent|unclear|not clear/i;
const LIMIT_TOPIC = /cancer|diagnos|what (?:it|that|Group Living Care) pays|what amount|conditions|event/i;
const isLimitation = (s: string) => LIMIT_VERB.test(s) && LIMIT_TOPIC.test(s);
const AMOUNT = /(?:S\$|SGD\s?|\$)\s?\d/;
/** D2.b reviewed: every S$350,000 sentence has the limitation (what Group Living Care pays for cancer is not stated / not established) within
 * two sentences before or two after, with no other amount in between (the limitation must belong to this amount, not to another benefit). */
export function d2bReviewed(x: string): boolean {
  const ss = sentences(x);
  const idx = ss.map((s, i) => (has(s, 350000) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return false;
  return idx.every((i) => {
    for (let j = Math.max(0, i - 2); j <= Math.min(ss.length - 1, i + 2); j++) {
      if (j === i || !isLimitation(ss[j])) continue;
      const between = ss.slice(Math.min(i, j) + 1, Math.max(i, j));
      if (between.every((b) => !AMOUNT.test(b))) return true;
    }
    return false;
  });
}

const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const REQUIREMENT = /\b(?:requires?|required|must|needs?|has to|have to)\b/i;
/** D7.c reviewed: SAFEGUARD when the only thing the composer removed is ONE OR MORE sentences that asserted a requirement none of their cited
 * pages prints, none of that text reached the visible answer, and every correctness check of the conversation passes. Gate removals, "left
 * out" notices and any other drop stay a FAIL. */
export function d7cReviewed(turns: CTurn[], correctnessOk: boolean): { grade: Grade; basis: string } {
  const dropped = turns.flatMap((t) => (t.trace?.dropped ?? []) as { reason: string; sentence: string }[]);
  const other = turns.some((t) => (t.trace?.gate ?? []).length || (t.trace?.incomplete ?? []).length);
  if (!dropped.length && !other) return { grade: "PASS", basis: "" };
  if (other) return { grade: "FAIL", basis: "a gate removal or an incomplete notice is recorded" };
  const shown = squash(turns.map((t) => t.text).join("\n"));
  const unsupportedRequirement = dropped.every((d) => /^not supported by its evidence/.test(d.reason) && REQUIREMENT.test(d.sentence) && !shown.includes(squash(d.sentence).slice(0, 60)));
  if (unsupportedRequirement && correctnessOk) return { grade: "SAFEGUARD", basis: dropped.map((d) => `dropped: “${d.sentence}” — ${d.reason}`).join(" | ") };
  return { grade: "FAIL", basis: "a removed sentence is not an unsupported requirement, or it reached the answer, or a correctness check fails" };
}

/** Both grades of every check of one conversation: the registered (original) one and the reviewed one. */
export function reviewed(id: string, turns: CTurn[], complete: boolean): Reviewed[] {
  const correct = complete ? criteria(id, turns) : [];
  const plumb = plumbing(turns, complete);
  const last = turns.at(-1)!;
  const x = id === "K3t1" ? turns[0].text : last.text;
  const correctnessOk = correct.length > 0 && correct.every((c) => c.ok);
  return [...correct, ...plumb].map((c: Crit): Reviewed => {
    const original = c.ok ? "PASS" : "FAIL";
    let grade: Grade = original, basis: string | undefined;
    if (c.id === "D5.c" && !c.ok) { grade = d5cReviewed(x) ? "PASS" : "FAIL"; basis = grade === "PASS" ? "the only match was a negated clause (“do not establish which document governs”); no clause says a document prevails" : undefined; }
    if (c.id === "D2.b" && !c.ok) { grade = d2bReviewed(x) ? "PASS" : "FAIL"; basis = grade === "PASS" ? "the limitation is within two sentences of the amount (explained by the next sentence, or phrased “do not establish”), with no other amount between" : undefined; }
    if (c.id === "D7.c" && !c.ok) { const r = d7cReviewed(turns, correctnessOk); grade = r.grade; basis = r.basis || undefined; }
    return { id: c.id, name: c.name, original, reviewed: grade, changed: grade !== original, ...(basis ? { basis } : {}) };
  });
}

/** The saved answers of a run (answers.json). A turn with `same: true` was returned = saved = reopened on the live run (D7.b passed), so the
 * text is stored once and expanded here into the three fields the registered plumbing check compares. */
export type SavedAnswers = { id: string; complete: boolean; turns: (CTurn & { user: string; same?: boolean })[] }[];
export function loadAnswers(file: string): SavedAnswers {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as SavedAnswers;
  return raw.map((r) => ({ ...r, turns: r.turns.map((t) => (t.same ? { ...t, shown: t.text, saved: t.text, reopened: t.text, error: t.error ?? null } : t)) }));
}

// ------------------------------------------------------------------------------------------------ CLI
if (process.argv[1] && /fx-live-2-criteria-v2\.ts$/.test(process.argv[1]) && process.argv[2]) {
  const dir = path.resolve(process.argv[2]);
  const answers = loadAnswers(path.join(dir, "answers.json"));
  const rows = answers.map((a) => ({ id: a.id, checks: reviewed(a.id, a.turns, a.complete) }));
  const md: string[] = ["# fx-live-2: registered grades and reviewed grades, side by side", "", "Generated by `scripts/rag2-live/fx-live-2-criteria-v2.ts` from `answers.json`. The **original** column is the registered result and is not changed. **SAFEGUARD** is not PASS: a composer drop that is reported, with its reason.", ""];
  const failedOriginal = rows.flatMap((r) => r.checks.filter((c) => c.original === "FAIL").map((c) => `${r.id} ${c.id}`));
  md.push(`Original: ${rows.reduce((n, r) => n + r.checks.length, 0)} checks, ${failedOriginal.length} FAIL (${failedOriginal.join(", ")}). Reviewed: ${rows.flatMap((r) => r.checks).filter((c) => c.reviewed === "FAIL").length} FAIL, ${rows.flatMap((r) => r.checks).filter((c) => c.reviewed === "SAFEGUARD").length} SAFEGUARD.`, "", "| conversation | check | original | reviewed | basis |", "|---|---|---|---|---|");
  for (const r of rows) for (const c of r.checks.filter((k) => k.original === "FAIL")) md.push(`| ${r.id} | ${c.id} | **FAIL** | ${c.reviewed === "FAIL" ? "**FAIL**" : c.reviewed} | ${(c.basis ?? "").replace(/\|/g, "\\|")} |`);
  fs.writeFileSync(path.join(dir, "criteria-reviewed.json"), JSON.stringify(rows, null, 1));
  fs.writeFileSync(path.join(dir, "criteria-reviewed.md"), md.join("\n") + "\n");
  console.log(md.slice(4, 6).join("\n"));
}
