/**
 * Round 6 rubbish detectors: every household-facing string of a chat answer
 * (summary, details, next steps, questions, claim cards, stated limits,
 * fact-finding plans, citations) is checked for garbled, leaky, wrong,
 * repetitive or fragmentary text. Pure functions; no I/O.
 */
import type { ChatAnswer } from "@/types";

export type Hit = { rule: string; text: string };
export type Field = { where: string; text: string };

/** Every string a household can see for one answer, labelled by where it shows. */
export function visibleFields(a: ChatAnswer): Field[] {
  // Exactly what app/chat/page.tsx renders for an answer.
  const f: Field[] = [];
  const add = (where: string, text: unknown) => { if (typeof text === "string" && text.trim()) f.push({ where, text }); };
  add("summary", a.summary);
  (a.questions ?? []).forEach((q, i) => { add("question[" + i + "]", q.text); add("question.why[" + i + "]", q.why); (q.options ?? []).forEach((o) => add("question.option", o)); });
  const plans = a.factFinding ?? [];
  const planQuestion = !(a.questions ?? []).length ? plans.find((p) => p.nextQuestions.length) : undefined;
  if (planQuestion) { add("planQuestion", planQuestion.nextQuestions[0].text); add("planQuestion.why", planQuestion.nextQuestions[0].why); add("plan.label", planQuestion.label); }
  plans.forEach((p, n) => { add("plan[" + n + "].label", p.label); p.missingDocuments.forEach((d) => add("plan[" + n + "].document", d)); });
  (a.knownFacts ?? []).forEach((k) => add("knownFact", k));
  (a.policyStatedLimits ?? []).forEach((l, n) => { add("limit[" + n + "].amount", l.amountText); add("limit[" + n + "].title", l.benefitTitle); add("limit[" + n + "].quote", l.quote); });
  (a.claimItems ?? []).filter((i) => i.status !== "not_applicable").forEach((i, n) => {
    add("claim[" + n + "].title", i.title); add("claim[" + n + "].reason", i.reason);
    (i.conditions ?? []).forEach((c) => add("claim[" + n + "].condition", c));
  });
  (a.portfolioItems ?? []).forEach((p) => { add("portfolio.owner", p.ownerName); add("portfolio.policy", p.policyName); });
  a.details.forEach((d, i) => add("details[" + i + "]", d));
  if (a.nextSteps.length && !(a.questions ?? []).length && !planQuestion) add("nextSteps[0]", a.nextSteps[0]);
  (a.citations ?? []).forEach((c, n) => { add("citation[" + n + "].name", c.policyName); add("citation[" + n + "].label", c.evidenceLabel ?? ""); });
  (a.personCandidates ?? []).forEach((p) => add("personCandidate", p.label));
  add("disclaimer", a.disclaimer);
  return f;
}

const PROSE = /^(summary|details|nextSteps|question\[|question\.why|claim\[\d+\]\.reason|claim\[\d+\]\.condition|planQuestion|disclaimer)/;
const moneyRe = /(?:S\$|SGD\s?|US\$|USD\s?|(?<![A-Za-z])\$)\s?(-?[\d][\d,]*(?:\.\d+)?)/g;
export function moneyIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(moneyRe)) { const v = Number(m[1].replace(/,/g, "")); if (Number.isFinite(v)) out.push(v); }
  return out;
}
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?<![\w.])-?\d[\d,]*(?:\.\d+)?/g)) { const v = Number(m[0].replace(/,/g, "")); if (Number.isFinite(v)) out.push(v); }
  return out;
}
const round2 = (v: number) => Math.round(v * 100) / 100;

export type GroundTruth = {
  /** Page text of every active document in the household, by policy id. */
  pages: Map<string, string>;
  /** Premium figures on file (amounts and their printed notes' figures). */
  premiumFigures: number[];
  /** Names of people in THIS household, and in other households (must never appear). */
  householdNames: string[];
  foreignNames: string[];
  /** Policy ids of other households (must never be cited). */
  foreignPolicyIds: Set<string>;
  /** Policy ids linked to each person (policy_members). */
  personPolicies: Map<string, Set<string>>;
  /** The names "you" stands for in this household's answers (the person whose
   * chat it is). Fixture-driven: each household says who its "you" is. */
  selfNames?: string[];
};

export type TurnContext = {
  question: string;
  userText: string; // every user message so far in this conversation
  claimTurn: boolean;
  ms: number;
  expect?: { person?: string | null; mentions?: RegExp; notMentions?: RegExp; citeOnly?: string[]; noCitations?: boolean; noAmounts?: boolean };
};

const INTERNAL: [string, RegExp][] = [
  ["uuid", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ["snake_case identifier", /\b[a-z]+_[a-z0-9]+(?:_[a-z0-9]+)*\b/],
  ["table/column name", /\b(?:policy_benefits|policy_coverages|premium_records|family_members|policy_members|policy_pages|policy_chunks|chat_conversations|claim_sessions|background_jobs|row_kind|formula_kind|fact_key|benefit_tier|account_id|policy_id)\b/i],
  ["row number", /\brow (?:number )?#?\d+\b|\bline \d+ of the table\b/i],
  ["job state", /\b(?:failed_retryable|dead[_ ]letter(?:ed)?|job (?:status|state|queued|failed)|processing_status|in the queue|queued for processing)\b/i],
  ["model/provider name", /\b(?:openai|gemini|gpt-?\d|claude|anthropic|llm|language model|deterministic(?:-e2e)?|dearpolicy-deterministic|model id|synthetic-e2e|pinecone|pgvector|postgres|supabase)\b/i],
  ["system jargon", /\b(?:system prompt|embedding|vector|chunk(?:s|Id)?|catalog(?:ue)? rows?|benefit catalog|ledger|ingest(?:ion|ed)?|extraction engine|tokens? used|json|sql|schema|database|stack trace|http \d{3}|status code)\b/i],
  ["debug token", /\b(?:undefined|null|NaN|Infinity)\b|\[object Object\]/],
  ["household-facing jargon", /\b(?:policy contracts?|contracts? (?:still|show)|family profiles?|personali[sz]ed policy evidence|resolve the person|retrieved sections?|uploaded passages|benefit rules?|evidence batch(?:es)?|reading budget|re-index|coverage ledger|policy review list|stored facts|panel\/network)\b/i],
  ["template token", /\{\{|\}\}|\$\{|\{[A-Za-z_][A-Za-z0-9_]*\}|%[sd]\b|<\w+>|__\w+__/],
];

/** Figures an answer may derive from the premiums on file: any sum of them
 * (a household total is plain addition of every printed premium -- a household
 * with more than four policies has more than four terms), each premium also
 * taken a year at a time (12 monthly premiums), and any of those per month.
 * Memoised per list of figures. */
const DERIVED = new WeakMap<number[], Set<number>>();
function premiumDerived(figures: number[]): Set<number> {
  const hit = DERIVED.get(figures);
  if (hit) return hit;
  const premium = figures.map(round2);
  let sums = new Set<number>([0]);
  if (premium.length <= 13) {
    for (const p of premium) { const next = new Set(sums); for (const v of sums) { next.add(round2(v + p)); next.add(round2(v + p * 12)); } sums = next; }
  } else {
    for (let i = 0; i < premium.length; i++) for (let j = i; j < premium.length; j++) for (let k = j; k < premium.length; k++) sums.add(round2(premium[i] + (j > i ? premium[j] : 0) + (k > j ? premium[k] : 0)));
  }
  sums.delete(0);
  const out = new Set<number>(sums);
  for (const v of sums) { out.add(round2(v / 12)); out.add(round2(v * 12)); }
  DERIVED.set(figures, out);
  return out;
}

export function detect(a: ChatAnswer, t: TurnContext, g: GroundTruth): Hit[] {
  const hits: Hit[] = [];
  const hit = (rule: string, text: string) => hits.push({ rule, text: text.slice(0, 240) });
  const fields = visibleFields(a);
  const prose = fields.filter((f) => PROSE.test(f.where));
  const all = fields.map((f) => f.text).join("\n");

  // ---------------------------------------------------------------- garbage
  for (const f of fields) {
    const text = f.text;
    const dbl = text.match(/\b([A-Za-z]{2,})\s+\1\b/i);
    if (dbl && !/^(?:that|had|is|very|bye|no|so|ha)$/i.test(dbl[1])) hit("doubled word", f.where + ": " + text);
    for (const [name, re] of INTERNAL) {
      const m = text.match(re);
      if (!m) continue;
      // Quoted policy wording may carry its own words; only our prose is judged for jargon.
      if (name === "snake_case identifier" && /quote|citation/.test(f.where)) continue;
      if (name === "system jargon" && /limit\[\d+\]\.quote/.test(f.where)) continue;
      hit("internal: " + name, f.where + ": «" + m[0] + "» " + text);
    }
    if (/(?:^|\s)[-*•](?:\s*$)|^\s*[-*•]\s*$/m.test(text)) hit("markdown: lone bullet", f.where + ": " + text);
    if (((text.match(/\*\*/g) ?? []).length % 2) === 1) hit("markdown: unbalanced **", f.where + ": " + text);
    if (/(?:^|\s)\|(?:\s|$)|#{2,}\s|```|`[^`]+`/.test(text)) hit("markdown: stray table/heading/code", f.where + ": " + text);
    if (/\(\s*\)|\[\s*\]|\s[,.;:](?:\s|$)|,\s*[.,]|\.\s*,|(?<!\.)\.\.(?!\.)|;\s*\.|:\s*\.|\?\s*\?|!\s*\./.test(text)) hit("stray punctuation", f.where + ": " + text);
    if (PROSE.test(f.where) && /^[a-z]/.test(text.trim()) && !/^(?:e\.g\.|i\.e\.)/.test(text.trim())) hit("leading lowercase", f.where + ": " + text);
    if (/^[,.;:)\]]/.test(text.trim())) hit("leading punctuation", f.where + ": " + text);
  }
  // ---------------------------------------------------------------- garbled echoes of the question
  for (const f of prose) {
    const echo = f.text.match(/\b(?:didn[’']t|did not|could not|couldn[’']t) find (?:(?:when|what|does|do|how|is|are|can|should|which|who|why|where)\b|[^.]*\b(?:covered for|give|or not|pls|lah|ah)\b[^.]*\bin the (?:parts|documents))/i);
    if (echo) hit("garbled echo of the question", f.where + ": " + f.text);
    for (const name of g.householdNames) for (const part of name.split(/\s+/)) {
      if (part.length < 2) continue;
      if (new RegExp("\\b" + part + " the (?!same|policy holder)", "").test(f.text) && !new RegExp("\\b" + part + " the\\b[^.]*\\b" + part + "\\b").test(f.text)) { hit("mangled name", f.where + ": " + f.text); break; }
    }
    if (/\[[^\]]{3,}\]/.test(f.text)) hit("bracketed internal label", f.where + ": " + f.text);
    if ((f.text.match(/\b(?:Insurer|Insured|Policy number|Period of insurance|Sum insured|Certificate number|Policyholder|Life assured)\b/g) ?? []).length >= 3) hit("raw document text dumped", f.where + ": " + f.text);
    if (/^(?:question\[|planQuestion$)/.test(f.where) && /\b(?:they|them|their)\b/i.test(f.text)) hit("vague 'they' in a question", f.where + ": " + f.text);
  }
  if (a.details.some((d) => /what-if/i.test(d)) && (a.questions ?? []).length && !/\bwould\b|\bif\b/i.test(a.questions[0].text)) hit("what-if asks about an event that did not happen", a.questions[0].text);
  // ---------------------------------------------------------------- fragments
  for (const f of prose) {
    const s = f.text.trim();
    if (s.length > 40 && !/[.!?:)"'”’…]$/.test(s) && !/^(?:Source|From|Page)\b/.test(s)) hit("cut off: no terminal punctuation", f.where + ": " + s);
    if (/\b(?:and|or|the|of|to|a|an|with|than|by)\s*[.!?]?$/i.test(s) && s.length > 12) hit("cut off: dangling word", f.where + ": " + s);
    if (/,\s*$/.test(s)) hit("cut off: trailing comma", f.where + ": " + s);
  }
  // ---------------------------------------------------------------- empties
  const summary = (a.summary ?? "").trim();
  const asking = (a.questions ?? []).length > 0 || (a.factFinding ?? []).some((p) => p.nextQuestions.length);
  if (summary.length < (asking ? 8 : 15)) hit("empty or near-empty answer", "summary=«" + summary + "»");
  // ---------------------------------------------------------------- repetition
  const sentences = new Map<string, number>();
  // Each claim card states how its own benefit pays; the same kind of rule on
  // two cards ("Reimburses the actual cost…") is one card each, not a repeat.
  const cardReasons = new Set<string>();
  for (const f of prose.filter((x) => x.where !== "disclaimer")) {
    for (const raw of f.text.split(/(?<=[.!?])\s+/)) {
      const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
      if (s.length < 25) continue;
      if (/^claim\[\d+\]\.(?:reason|condition)$/.test(f.where)) { const key = f.where.replace(/\[\d+\]/, "") + "|" + s; if (cardReasons.has(key)) continue; cardReasons.add(key); }
      sentences.set(s, (sentences.get(s) ?? 0) + 1);
    }
  }
  for (const [s, n] of sentences) if (n > 1) hit("repeated sentence", n + "x: " + s);
  const disc = (a.disclaimer ?? "").trim().toLowerCase();
  if (disc.length > 20 && prose.some((f) => f.where !== "disclaimer" && f.text.toLowerCase().includes(disc))) hit("disclaimer repeated in body", disc);
  const conds = (a.claimItems ?? []).flatMap((i) => i.conditions ?? []);
  const dupCond = conds.find((c, i) => conds.indexOf(c) !== i && conds.filter((x) => x === c).length > (a.claimItems ?? []).length / 2 && (a.claimItems ?? []).length < 2);
  if (dupCond) hit("repeated caveat", dupCond);
  // ---------------------------------------------------------------- dangling references
  if (/\b(?:the |this )?(?:table|list|chart) (?:below|above)\b|\bsee (?:below|above)\b|\bas shown (?:below|above)\b|\bthe following (?:table|list)\b/i.test(all)) {
    const hasTable = (a.portfolioItems?.length ?? 0) > 0 || (a.policyStatedLimits?.length ?? 0) > 0 || (a.claimItems?.length ?? 0) > 0;
    if (!hasTable) hit("dangling reference", all.match(/[^.]*\b(?:below|above|following)\b[^.]*/i)?.[0] ?? "");
  }
  // ---------------------------------------------------------------- counts and plurals
  for (const f of fields) {
    const m = f.text.match(/\b(?:0|zero) (?:policies|policy|documents?|benefits?|plans?|claims?|people|persons?|members?)\b/i)
      ?? f.text.match(/\b1 (?:policies|documents|benefits|plans|claims|people|members|nights|days|questions|conditions|hours|items)\b/i)
      ?? f.text.match(/\b(?:[2-9]|\d{2,}) (?:policy|document|benefit|plan|claim|person|member|night|day|question|condition|hour|item)\b(?![-\s](?:holder|number|year|limit|period|wording|schedule|type|document|name|owner|cover|premium|booklet|guide|card|pack|term|room|ward|delay|stay|cash|sum|of|contracts?))/i);
    if (m) hit("count grammar", f.where + ": «" + m[0] + "» " + f.text);
  }
  // ---------------------------------------------------------------- wording rules
  for (const f of prose) {
    const unquoted = f.text.replace(/“[^”]*”|"[^"]*"/g, "");
    const m = unquoted.match(/\b(?:(?:is|are|was|were|isn't|aren't|not be) not covered|not covered|isn't covered|aren't covered|no cover(?:age)? for|you are not insured|not insured for)\b/i);
    if (m) hit("'not covered' wording", f.where + ": " + f.text);
  }
  // ---------------------------------------------------------------- people
  for (const name of g.foreignNames) if (all.toLowerCase().includes(name.toLowerCase()) && !t.userText.toLowerCase().includes(name.toLowerCase())) hit("another household's person named", name);
  if (t.expect?.person !== undefined && t.expect.person !== null && a.resolvedFamilyMemberId && a.resolvedFamilyMemberId !== t.expect.person) hit("wrong person resolved", "resolved " + a.resolvedFamilyMemberId + " expected " + t.expect.person);
  // ---------------------------------------------------------------- claims: one question at a time
  if (t.claimTurn || a.mode === "fact_finding") {
    if ((a.questions ?? []).length > 1) hit("more than one question in a claims turn", a.questions.map((q) => q.text).join(" | "));
    for (const q of a.questions ?? []) if ((q.text.match(/\?/g) ?? []).length > 1) hit("question card asks two things", q.text);
    const asks = (summary.match(/\?/g) ?? []).length + (a.questions ?? []).length;
    if (asks > 1 && (a.questions ?? []).length >= 1 && /\?/.test(summary)) hit("summary and card both ask", summary + " | " + a.questions[0]?.text);
  }
  // ---------------------------------------------------------------- citations
  for (const c of a.citations ?? []) {
    if (g.foreignPolicyIds.has(c.policyId)) hit("citation to another household's document", c.policyName);
    if (c.excerpt) {
      const page = g.pages.get(c.policyId) ?? "";
      const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
      if (page && !norm(page).includes(norm(c.excerpt).slice(0, 60))) hit("citation excerpt not in the document", c.policyName + ": " + c.excerpt);
    }
  }
  if (t.expect?.person && a.citations?.length && !t.expect.citeOnly) {
    const mine = g.personPolicies.get(t.expect.person) ?? new Set<string>();
    const stray = a.citations.filter((c) => !mine.has(c.policyId));
    if (stray.length) hit("citation to a document that is not this person's", stray.map((c) => c.policyName).join("; "));
  }
  if (t.expect?.citeOnly && a.citations?.length) {
    const stray = a.citations.filter((c) => !t.expect!.citeOnly!.includes(c.policyId));
    if (stray.length) hit("citation to an unrelated document", stray.map((c) => c.policyName + " p" + c.pageStart).join("; "));
  }
  if (t.expect?.noCitations && a.citations?.length) hit("citations on a turn that should cite nothing", a.citations.map((c) => c.policyName).join("; "));
  // ---------------------------------------------------------------- amounts
  const cited = new Set((a.citations ?? []).map((c) => c.policyId));
  for (const l of a.policyStatedLimits ?? []) cited.add(l.citation.policyId);
  const pagesOf = (ids: Iterable<string>) => [...ids].map((id) => g.pages.get(id) ?? "").join("\n");
  const householdNumbers = new Set(numbersIn([...g.pages.values()].join("\n")).map(round2));
  const citedNumbers = new Set(numbersIn(pagesOf(cited)).map(round2));
  const userNumbers = new Set(numbersIn(t.userText).map(round2));
  const derived = premiumDerived(g.premiumFigures);
  const citedList = [...citedNumbers].filter((v) => v >= 10).slice(0, 200);
  const sumOfCited = (v: number) => { for (let i = 0; i < citedList.length; i++) for (let j = i; j < citedList.length; j++) if (round2(citedList[i] + citedList[j]) === v || round2(citedList[i] * citedList[j]) === v) return true; return false; };
  for (const f of fields) {
    for (const v of moneyIn(f.text)) {
      if (v <= 0) { hit(v === 0 ? "zero amount" : "negative amount", f.where + ": " + f.text); continue; }
      if (v >= 100_000_000) hit("absurd amount", f.where + ": " + f.text);
      if (Number.isInteger(v) && v >= 1990 && v <= 2040 && !/[\d,]{5,}/.test(String(v))) {
        const shown = f.text.match(new RegExp("(?:S\\$|SGD\\s?|\\$)\\s?" + v + "(?![\\d,])"));
        if (shown) hit("date shown as an amount", f.where + ": " + f.text);
      }
      const r = round2(v);
      if (userNumbers.has(r) || derived.has(r)) continue;
      if (/quote/.test(f.where)) continue;
      if (!householdNumbers.has(r) && !sumOfCited(r)) { hit("amount not in any document", f.where + ": S$" + v + " — " + f.text); continue; }
      if (cited.size && !citedNumbers.has(r) && !sumOfCited(r)) hit("amount not in the cited source", f.where + ": S$" + v + " — " + f.text);
      if (!cited.size && !/^(?:portfolio|citation)/.test(f.where)) hit("amount shown with no citation", f.where + ": S$" + v + " — " + f.text);
    }
  }
  if (t.expect?.noAmounts && fields.some((f) => PROSE.test(f.where) && moneyIn(f.text).length)) hit("amount on a turn that should show none", summary);
  // ---------------------------------------------------------------- relevance
  if (t.expect?.mentions && !t.expect.mentions.test(all)) hit("answer ignores the question", "expected " + t.expect.mentions + " in: " + summary);
  if (t.expect?.notMentions && t.expect.notMentions.test(all)) hit("answer says what it must not", String(all.match(t.expect.notMentions)?.[0]) + " in: " + summary);
  // A question answered as if something had happened.
  const asked = t.question ?? "";
  const reportsEvent = /\b(?:admitted|hospitali[sz]ed|warded|died|passed away|diagnosed|injured|broke|broken|fractured|delayed|lost|stolen|fell|sick|disabled|claim\w*|happened)\b/i.test(asked);
  if (!t.claimTurn && !reportsEvent && /\b(?:match(?:es)? what happened|what you described)\b/i.test(all)) hit("question answered as a claim", summary);
  if (!/\b(?:if|suppose|supposing|what if|in case|were to|would)\b/i.test(asked) && /^If (?:an?|the|someone|you|[A-Z][a-z]+) /.test(summary) && !t.claimTurn) hit("what-if framing on a plain question", summary);
  // Says it found nothing, then lists it: "I could not find dental cover" over "Dental: up to S$300".
  for (const m of summary.matchAll(/\b(?:could not|couldn[’']t|did not|didn[’']t) find ([a-z]+)(?: [a-z]+)? cover\b[^.]*?(?:read for ([^.]+))?\./gi)) {
    const word = m[1].toLowerCase();
    // "…in the documents read for Wei Jie or Xin Yi": only their lines contradict it.
    const who = (m[2] ?? "").split(/,\s*|\s+or\s+|\s+and\s+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const listed = a.details.find((d) => {
      if (!(new RegExp("— [^:]*\\b" + word + "\\w*[^:]*: (?!the schedule prints)", "i").test(d) && /S\$\d/.test(d))) return false;
      const owners = d.includes(" · ") ? d.split(" · ")[0].toLowerCase() : null;
      const self = (g.selfNames ?? []).map((n) => n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      return !who.length || !owners || who.some((w) => (w === "you" ? (self.length ? new RegExp("\\b(?:" + self.join("|") + ")\\b") : /(?!)/) : new RegExp("\\b" + w + "\\b")).test(owners));
    });
    if (listed) hit("says not found but lists it", summary + " | " + listed);
  }
  if (t.ms > 8000) hit("slow response", t.ms + " ms");
  return hits;
}
