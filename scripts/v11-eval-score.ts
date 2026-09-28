/**
 * V1.1 evaluation scorer: applies the release gates of the V1.1 spec to one
 * answer set (from the in-process API run, scripts/v11-eval-run.ts --api, or
 * from the browser journey transcript, e2e/tests/v11-journey.spec.ts).
 *
 * Gates (each violation is listed with the question, the evidence and why):
 *   unsupported_amount      every monetary amount shown must be an amount the
 *                           question allows AND its source page must be cited
 *   unsupported_assertion   no forbidden assertion; every expected material
 *                           assertion that IS made must cite its passage page;
 *                           no choosing between contradictory values; no
 *                           amended term presented as current
 *   cross_scope             no other person's / household's policy or amount
 *   deleted_superseded      no deleted or superseded document or value
 *   blocked_gap             a blocked answer explains the specific gap and
 *                           never turns "not found" into "not covered"
 *   positive_control        positive controls answer correctly, with citations
 *   internal_text           no raw provider / internal diagnostic text
 *   fact_finding            the required next question is asked (Task 3)
 * Nothing here is relaxed to make a run green: the dataset file is the
 * contract (e2e/support/v11-dataset.ts).
 */
import { V11_QUESTIONS, datasetDocs, printedText, GAP_RE, NOT_COVERED_RE, type DocKey, type EvalQuestion, type Money } from "../e2e/support/v11-dataset";

export type AnswerCitation = { doc: DocKey | null; policyName: string; page: number | null; /** other documents sharing the printed product name (browser transcripts) */ alt?: DocKey[] };
export type AnswerRecord = {
  qid: string;
  visible: string;
  citations: AnswerCitation[];
  ms: number;
  error?: string | null;
  nextQuestion?: string | null;
  extra?: Record<string, unknown>;
};
export type Violation = { qid: string; gate: string; detail: string };
export type Score = {
  violations: Violation[];
  quality: Violation[];
  perQuestion: { qid: string; text: string; ok: boolean; gates: string[]; ms: number }[];
  gates: Record<string, { pass: boolean; count: number }>;
  timings: { factual: { n: number; p50: number; p95: number }; interview: { n: number; p50: number; p95: number }; all: { n: number; p50: number; p95: number } };
};

export const GATES = ["unsupported_amount", "unsupported_assertion", "cross_scope", "deleted_superseded", "blocked_gap", "positive_control", "internal_text", "fact_finding"] as const;

export const LEAKS: [string, RegExp][] = [
  ["uuid", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ["model id / provider", /\b(?:gpt-[\w.-]+|gemini[\w.-]*|claude-[\w.-]+|qwen[\w.-]*|ollama|openai|anthropic|dearpolicy-deterministic[\w.-]*|synthetic-e2e|flash-lite)\b/i],
  ["provider quota / org / billing", /insufficient_quota|exceeded your current quota|\borg-[A-Za-z0-9]{6,}|platform\.openai\.com|billing details|rate[_ ]limit/i],
  ["error text", /\b(?:Error:|TypeError|ReferenceError|ECONNREFUSED|ETIMEDOUT|\[object Object\]|DeterministicModelUnavailableError)\b/],
  ["stack frame", /\bat \S+ \(.*:\d+:\d+\)|\.tsx?:\d+/],
  ["storage key", /storage_key|storageKey|\.e2e-storage|households\/[0-9a-f-]{8}/i],
  ["rule/row/page counts", /\b\d+\s+(?:benefit\s+)?rules?\b|\b\d+ of \d+ (?:processed )?pages\b|benefit rules? read|\bcatalog(?:ue)? entr/i],
  ["raw fact key / field", /\b(?:fractureBodyPart|injuryKind|eventType|hospitalNights|treatmentType|fractureConfirmed|eventLocation|policy_benefits|policy_chunks|processing_status|formula_kind|fact_key)\b/],
  ["job / queue / scanner internals", /\bjob[_ -]?id\b|\bchat_analysis\b|dead[_ ]letter|\blease\b|VirusTotal|malicious=|quarantine_status/i],
  ["model / reader status", /reader could not be reached|by a second read|model (?:is )?(?:busy|unavailable)/i],
  ["routine repair task", /re-?analy[sz]e|re-read all|confirm (?:this|the) (?:table )?heading|fix (?:a|this|the) row/i],
];

const MONEY_RE = /(S\$|US\$|SGD|USD|EUR|€|£|\$)\s?(\d[\d,]*(?:\.\d+)?)(?!\s?%)|(\d[\d,]*(?:\.\d+)?)\s?(SGD|USD)\b/g;
function normCurrency(c: string) { return c === "S$" || c === "SGD" ? "SGD" : c === "US$" || c === "USD" ? "USD" : c === "$" ? "UNSTATED-$" : c; }
export function moneyIn(text: string): { amount: number; currency: string; raw: string }[] {
  const out: { amount: number; currency: string; raw: string }[] = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const cur = m[1] ?? m[4]; const n = (m[2] ?? m[3]).replace(/,/g, "");
    const amount = Number(n); if (!Number.isFinite(amount)) continue;
    out.push({ amount, currency: normCurrency(cur), raw: m[0] });
  }
  return out;
}
const pct = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const rx = (s: string) => new RegExp(s, "i");

/** Every amount PRINTED on a page of a document the question's person may rely on (current, not deleted
 * for post-deletion questions): stating it with that page cited is supported. Question-specific
 * allowedAmounts add to this; forbidden patterns still apply. */
export function printedAmounts(q: EvalQuestion, deleted: Set<DocKey>, superseded: Set<DocKey>): Money[] {
  const out: Money[] = [];
  for (const d of datasetDocs()) {
    if (d.household !== q.household || (d.person && d.person !== q.person) || superseded.has(d.key) || (q.phase === "post" && deleted.has(d.key))) continue;
    printedText(d).forEach((text, i) => { for (const m of moneyIn(text)) if (m.currency === "SGD" || m.currency === "USD") out.push({ amount: m.amount, currency: m.currency, doc: d.key, page: i + 1 }); });
  }
  return out;
}

export function scoreAnswers(answers: AnswerRecord[], opts: { deletedDocs?: DocKey[]; supersededDocs?: DocKey[]; questions?: EvalQuestion[]; extraViolations?: Violation[] } = {}): Score {
  const questions = opts.questions ?? V11_QUESTIONS;
  const docs = new Map(datasetDocs().map((d) => [d.key, d]));
  const deleted = new Set(opts.deletedDocs ?? ["accidentMarcus"]);
  const superseded = new Set(opts.supersededDocs ?? ["hosp2022"]);
  const violations: Violation[] = [], quality: Violation[] = [];
  const perQuestion: Score["perQuestion"] = [];
  const factualMs: number[] = [], interviewMs: number[] = [], allMs: number[] = [];

  for (const q of questions) {
    const a = answers.find((x) => x.qid === q.id);
    const v: Violation[] = [];
    const push = (gate: string, detail: string) => v.push({ qid: q.id, gate, detail });
    if (q.mode === "interview") {
      const steps = answers.filter((x) => x.qid.startsWith(q.id + "."));
      if (!steps.length) { v.push({ qid: q.id, gate: "fact_finding", detail: "interview not executed" }); violations.push(...v); continue; }
      const asked: string[] = [];
      for (const st of steps) {
        interviewMs.push(st.ms); allMs.push(st.ms);
        const text = st.visible ?? "";
        for (const [label, re] of LEAKS) { const m = text.match(re); if (m) push("internal_text", `${st.qid}: ${label}: "${m[0]}"`); }
        for (const f of q.forbidden) { const m = text.match(rx(f.re)); if (m) push(f.gate, `${st.qid}: ${f.desc}: "${m[0]}"`); }
        if (st.error) push("fact_finding", `${st.qid}: request failed: ${String(st.error).slice(0, 160)}`);
        const qc = Number((st.extra as any)?.questionCount ?? 0);
        if (qc > 1) push("fact_finding", `${st.qid}: asks ${qc} questions at once`);
        if (st.nextQuestion) asked.push(st.nextQuestion);
        for (const m of new Set(moneyIn(text).map((x) => x.raw))) push("unsupported_amount", `${st.qid}: "${m}" shown during the interview (before evidence)`);
      }
      // Earlier turns of the same conversation count toward the order.
      const before = answers.filter((x) => questions.find((y) => y.id === x.qid)?.conversation === q.conversation && !x.qid.includes(".") && x.nextQuestion && questions.findIndex((y) => y.id === x.qid) < questions.findIndex((y) => y.id === q.id)).map((x) => x.nextQuestion!);
      const seq = [...before, ...asked];
      const firstIndex = (re: string) => seq.findIndex((t) => rx(re).test(t));
      const order = q.interview!.order.map(firstIndex);
      order.forEach((ix, k) => { if (ix < 0) push("fact_finding", `never asked /${q.interview!.order[k]}/ (asked: ${seq.join(" | ")})`); });
      for (let k = 1; k < order.length; k++) if (order[k] >= 0 && order[k - 1] >= 0 && order[k] < order[k - 1]) push("fact_finding", `asked /${q.interview!.order[k]}/ before /${q.interview!.order[k - 1]}/`);
      for (let k = 1; k < asked.length; k++) if (asked[k] === asked[k - 1]) push("fact_finding", `asked "${asked[k]}" again right after it was answered`);
      if ((steps.at(-1)!.extra as any)?.finished === false) push("fact_finding", `the interview did not finish within ${q.interview!.maxSteps} answers`);
      violations.push(...v); perQuestion.push({ qid: q.id, text: `claim interview (${steps.length} answers): ${asked.join(" → ")}`, ok: !v.length, gates: [...new Set(v.map((x) => x.gate))], ms: steps.reduce((n, x) => n + x.ms, 0) });
      continue;
    }
    if (!a) { quality.push({ qid: q.id, gate: "not_run", detail: "no answer recorded for this question" }); continue; }
    if (q.mode === "reopen") {
      // Reopen checks are computed by the runner/journey and delivered as extra.
      const r = a.extra as { sameLastAnswer?: boolean; sameNextQuestion?: boolean; claimEvents?: number; eventNamedAnAccident?: boolean } | undefined;
      if (!r) push("fact_finding", "reopen not executed");
      else {
        if (r.sameLastAnswer === false) push("fact_finding", "reopened conversation shows a different last answer");
        if (r.sameNextQuestion === false) push("fact_finding", "reopened conversation asks a different next question");
        if (typeof r.claimEvents === "number" && r.claimEvents > 1) push("fact_finding", `one interview produced ${r.claimEvents} claim events (expected one event updated in place)`);
        for (const c of ((r as any).claimStatus ?? []) as { listLabel: string; hasEstimate: boolean | null; detailLabel?: string | null }[])
          if (/assessment ready/i.test(c.listLabel) && c.hasEstimate === false) push("fact_finding", `claims list says "${c.listLabel}" while the claim has no evidence-backed estimate`);
        if (r.eventNamedAnAccident) push("fact_finding", "a claim event is named after a reply (\"An accident.\")");
        for (const n of ((r as any).eventsNamedAfterReplies ?? []) as string[]) push("fact_finding", `a claim event is named after an interview reply: "${n}"`);
      }
      violations.push(...v); perQuestion.push({ qid: q.id, text: q.text, ok: !v.length, gates: [...new Set(v.map((x) => x.gate))], ms: a.ms });
      continue;
    }
    const text = a.visible ?? "";
    if (a.error) push(q.mode === "provider_quota_failure" ? "internal_text" : "positive_control", `request failed: ${String(a.error).slice(0, 200)}`);
    allMs.push(a.ms);
    if (q.tags.includes("factual")) factualMs.push(a.ms);
    if (q.tags.includes("claim_interview")) interviewMs.push(a.ms);
    const cited = (doc: DocKey, page: number) => a.citations.some((c) => (c.doc === doc || (c.alt ?? []).includes(doc)) && c.page === page);
    const citedDoc = (doc: DocKey) => a.citations.some((c) => c.doc === doc);

    // internal text
    for (const [label, re] of LEAKS) { const m = text.match(re); if (m) push("internal_text", `${label}: "${m[0]}"`); }
    // forbidden assertions
    for (const f of q.forbidden) { const m = text.match(rx(f.re)); if (m) push(f.gate, `${f.desc}: "${m[0]}"`); }
    // forbidden / wrong-scope citations
    for (const f of q.forbiddenCitations) if (citedDoc(f.doc)) push(f.gate, `cites ${f.doc} (${f.why})`);
    for (const c of a.citations) {
      if (!c.doc) { quality.push({ qid: q.id, gate: "citation_unmapped", detail: `citation "${c.policyName}" p${c.page} does not map to a dataset document` }); continue; }
      const d = docs.get(c.doc)!;
      if (d.household !== q.household) push("cross_scope", `cites ${c.doc} from household ${d.household}`);
      else if (d.person && d.person !== q.person && !q.forbiddenCitations.some((f) => f.doc === c.doc)) push("cross_scope", `cites ${c.doc}, which belongs to ${d.person}`);
      if (superseded.has(c.doc)) push("deleted_superseded", `cites superseded ${c.doc} p${c.page}`);
      if (q.phase === "post" && deleted.has(c.doc)) push("deleted_superseded", `cites deleted ${c.doc} p${c.page}`);
      if (c.page == null || !(c.page > 0)) push("unsupported_assertion", `citation to ${c.doc} without a page`);
    }
    // amounts
    const allowedPool = [...q.allowedAmounts, ...(q.amountAllowed ? printedAmounts(q, deleted as Set<DocKey>, superseded as Set<DocKey>) : [])];
    const seenMoney = new Set<string>();
    for (const m of moneyIn(text)) {
      if (seenMoney.has(m.currency + m.amount)) continue; seenMoney.add(m.currency + m.amount);
      const allowed = allowedPool.filter((x) => x.amount === m.amount && (x.currency === m.currency || (x.currency === "NONE" && m.currency === "UNSTATED-$")));
      if (!q.amountAllowed || !allowed.length) { push("unsupported_amount", `"${m.raw}" is not an amount this answer may state`); continue; }
      if (!allowed.some((x) => cited(x.doc, x.page))) push("unsupported_amount", `"${m.raw}" shown without citing its source (${allowed.map((x) => `${x.doc} p${x.page}`).join(" or ")})`);
    }
    // expected material assertions
    let answered = true;
    for (const e of q.answerable) {
      if (!rx(e.re).test(text)) { answered = false; (q.positiveControl ? v : quality).push({ qid: q.id, gate: q.positiveControl ? "positive_control" : "expected_assertion_missing", detail: `missing: ${e.desc}` }); continue; }
      if (e.cite.length && !e.cite.some((c) => cited(c.doc, c.page))) {
        push("unsupported_assertion", `"${e.desc}" stated without citing ${e.cite.map((c) => `${c.doc} p${c.page}`).join(" or ")}`);
        if (q.positiveControl) answered = false;
      }
    }
    if (q.positiveControl && !answered && !v.some((x) => x.gate === "positive_control")) push("positive_control", "positive control not answered with its supporting citation");
    // contradictory values / amendments
    if (q.mustNotChooseOneOf) {
      const present = q.mustNotChooseOneOf.filter((s) => text.includes(s));
      if (present.length && present.length < q.mustNotChooseOneOf.length) push("unsupported_assertion", `chose ${present.join(", ")} although the document also states ${q.mustNotChooseOneOf.filter((s) => !present.includes(s)).join(", ")}`);
    }
    for (const r of q.requiresIfMentioned ?? []) if (rx(r.mention).test(text) && !rx(r.require).test(text)) push("unsupported_assertion", r.desc);
    if (q.amended && rx(q.amended.replaced).test(text) && !rx(q.amended.current).test(text)) push("unsupported_assertion", q.amended.desc);
    // blocked answers
    if (q.gap) {
      if (!rx(q.gap).test(text)) push("blocked_gap", "the answer does not explain what could not be verified");
      if (rx(NOT_COVERED_RE).test(text) && !q.forbidden.some((f) => f.re === NOT_COVERED_RE)) push("blocked_gap", "'not found' turned into 'not covered': " + text.match(rx(NOT_COVERED_RE))?.[0]);
    }
    // fact finding
    if (q.requiredNextQuestion) {
      const asked = a.nextQuestion ?? "";
      if (!asked) push("fact_finding", `no next question asked (expected /${q.requiredNextQuestion}/)`);
      else if (!rx(q.requiredNextQuestion).test(asked)) push("fact_finding", `asked "${asked}" (expected /${q.requiredNextQuestion}/)`);
    }
    violations.push(...v);
    perQuestion.push({ qid: q.id, text: q.text, ok: !v.length, gates: [...new Set(v.map((x) => x.gate))], ms: a.ms });
  }
  violations.push(...(opts.extraViolations ?? []));
  const gates = Object.fromEntries(GATES.map((g) => { const n = violations.filter((x) => x.gate === g).length; return [g, { pass: n === 0, count: n }]; }));
  const t = (xs: number[]) => ({ n: xs.length, p50: pct(xs, 0.5), p95: pct(xs, 0.95) });
  return { violations, quality, perQuestion, gates, timings: { factual: t(factualMs), interview: t(interviewMs), all: t(allMs) } };
}
export { GAP_RE };

/** Map a visible citation (policy name + page) to a dataset document. Product
 * names are shared by the 2022/2025 HospitalShield editions and by the
 * AccidentGuard schedule/endorsement; the page decides where it can. */
export function docFromPolicyName(policyName: string, page: number | null, household: "A" | "B"): DocKey | null {
  const pool = datasetDocs().filter((d) => policyName.includes(d.productName)).sort((x, y) => Number(y.household === household) - Number(x.household === household))
    .sort((x, y) => y.productName.length - x.productName.length);
  if (!pool.length) return null;
  const best = pool.filter((d) => d.productName === pool[0].productName);
  if (best.length === 1) return best[0].key;
  // Same printed product name: the AccidentGuard endorsement (one page) vs the schedule, and the 2022 vs 2025 HospitalShield
  // editions. A visible citation cannot tell them apart; the current document is assumed (reported as a limitation).
  if (best.some((d) => d.key === "accident")) return "accident";
  if (best.some((d) => d.key === "hosp2025")) return "hosp2025";
  return best[0].key;
}

export function scoreMarkdown(title: string, s: Score, answers: AnswerRecord[]): string {
  const lines = [`# ${title}`, "", "## Release gates", "", "| Gate | Result | Violations |", "|---|---|---|",
    ...Object.entries(s.gates).map(([g, r]) => `| ${g} | ${r.pass ? "PASS" : "**FAIL**"} | ${r.count} |`), "",
    "## Timing (ms)", "", "| Group | n | p50 | p95 |", "|---|---|---|---|",
    ...Object.entries(s.timings).map(([k, t]) => `| ${k} | ${t.n} | ${t.p50} | ${t.p95} |`), "",
    "## Per question", "", "| Q | Question | Result | Gates failed | ms |", "|---|---|---|---|---|",
    ...s.perQuestion.map((p) => `| ${p.qid} | ${p.text.replace(/\|/g, "/")} | ${p.ok ? "pass" : "FAIL"} | ${p.gates.join(", ")} | ${p.ms} |`), "",
    "## Every gate violation", "", ...(s.violations.length ? s.violations.map((x) => `- **${x.qid}** [${x.gate}] ${x.detail}`) : ["(none)"]), "",
    "## Quality notes (not release gates)", "", ...(s.quality.length ? s.quality.map((x) => `- ${x.qid} [${x.gate}] ${x.detail}`) : ["(none)"]), "",
    "## Answers (visible text)", ""];
  for (const a of answers) {
    const q = V11_QUESTIONS.find((x) => x.id === a.qid);
    lines.push(`### ${a.qid} — ${q?.text ?? ""}`, "", "```", (a.visible || a.error || "").slice(0, 4000), "```",
      `Citations: ${a.citations.map((c) => `${c.doc ?? "?"} (${c.policyName}) p${c.page}`).join("; ") || "none"}  ·  next question: ${a.nextQuestion ?? "none"}  ·  ${a.ms} ms`, "");
  }
  return lines.join("\n");
}
