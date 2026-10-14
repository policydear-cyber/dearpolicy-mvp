/**
 * Grader for the V1.4 actual-model sample on the person / product / benefit binding structures
 * (RAG2_LIVE_HOUSEHOLD=binding; scripts/rag2-live/scenario-household.ts S49 + S49B). WRITTEN BEFORE THE RUN from
 * docs/rag-migration/v14/EXPECTED.md; not to be changed after seeing its output. Deterministic, no AI judge. Reads the
 * run directory's run.json (visible answers, questions and saved state) and writes binding-grade.json + .md there.
 *   node --import tsx scripts/rag2-live/binding-check.ts <RUN directory>
 * "correctness" checks: nothing wrong is shown. "usefulness" checks: the documented answer is given. A safe answer that
 * leaves out the documented amounts or the one relevant question passes correctness and fails usefulness.
 *
 * Version 2 (14 Oct 2026, after s49-live-1): the "Term Life presented as Personal Accident" pattern of version 1 matched
 * a correct answer ("Group Term Life of S$1,000,000 and Group Personal Accident of S$600,000"). Version 2 only flags a
 * Personal Accident wording that ATTRIBUTES S$1,000,000 to itself; both patterns have independent positive and negative
 * controls in scripts/rag2-live/check-regressions.ts. s49-live-1's version-1 grade files are kept unchanged; version 2
 * writes binding-grade-v2.*. Version 2 also requires no turn ended by a limit or by refused answer calls, and each of
 * the two amounts bound (saved) to its own product and to Darren.
 *
 * Version 3 (14 Oct 2026, after s49-live-2; written before the cell-per-line run s50-live-1): three general corrections.
 *  - The first relevant question may ask for EITHER missing date (accident or death): the 365-day condition needs both.
 *  - A 365-day conclusion ("he died within 365 days", "the 365-day condition is met / not met") is wrong until BOTH
 *    dates are known from the conversation; once both are given, a conclusion must agree with them.
 *  - Amounts are judged by IDENTITY (person, product, source document), not by numerical equality: Darren's own Group
 *    Living Care Plus S$300,000 is correct even though Michelle's Group Personal Accident is also S$300,000. Every
 *    saved figure binding must be Darren's, from the current certificate, with the amount printed for that product in
 *    Darren's row; every amount shown must be bound, or stated next to the product whose amount in Darren's row it is.
 * Earlier grade files are kept unchanged; version 3 writes binding-grade-v3.*. Version 3 grades the binding
 * conversations present in the run (S49, S49B, S50); controls in scripts/rag2-live/check-regressions.ts.
 */
import fs from "node:fs";
import path from "node:path";

const DARREN = "7f000000-0000-4000-8000-000000000001";
const CURRENT_CERT = "7f000000-0000-4000-8000-000000000101";
/** Darren's row of the current certificate: product -> amount (the identity the amounts are judged against). */
export const DARREN_ROW: [RegExp, string, number][] = [
  [/group living care plus/i, "Group Living Care Plus", 300000],
  [/group living care(?! plus)/i, "Group Living Care", 350000],
  [/(?:group )?term life/i, "Group Term Life", 1000000],
  [/(?:group )?personal accident/i, "Group Personal Accident", 600000],
];
const productOf = (label: string) => DARREN_ROW.find(([re]) => re.test(label));
const money = (s: string) => Number(s.replace(/[^\d.]/g, ""));
/** Figure bindings that are not Darren's own row amount for their product, from the current certificate. */
export function wrongIdentity(fb: any[]): string[] {
  const out: string[] = [];
  for (const b of fb) {
    const p = productOf(String(b.benefit ?? ""));
    const why = [b.subjectId && b.subjectId !== DARREN ? "another person" : "", b.rowPerson && !/\bDarren\b/.test(String(b.rowPerson)) ? `row of ${b.rowPerson}` : "", b.policyId && b.policyId !== CURRENT_CERT ? "not the current certificate" : "", !p ? `unknown product ${b.benefit}` : p[2] !== b.value ? `${b.value} is not Darren's ${p[1]} amount` : ""].filter(Boolean);
    if (why.length) out.push(`${b.value} ${b.benefit}: ${why.join(", ")}`);
  }
  return out;
}
/** Amounts shown in the visible text that have no identity: neither bound (saved) as Darren's figure nor stated
 * after the product whose amount in Darren's row it is (nearest product name before it in the same clause, and the
 * clause naming no other household member). */
export function unidentifiedAmounts(visible: string, fb: any[]): string[] {
  const out: string[] = [];
  const okBound = new Set(fb.filter((b) => !wrongIdentity([b]).length).map((b) => b.value));
  for (const clause of visible.split(/(?<=[.;?!])\s+|\n/)) {
    for (const m of clause.matchAll(/S\$\s?([\d,]+(?:\.\d+)?)/g)) {
      const v = money(m[1]);
      const before = clause.slice(0, m.index);
      const names = [...before.matchAll(/group living care plus|group living care|(?:group )?term life|(?:group )?personal accident/gi)];
      const nearest = names.length ? productOf(names[names.length - 1][0]) : undefined;
      const stated = !!nearest && nearest[2] === v && !/\bMichelle\b/i.test(clause);
      if (!stated && !(okBound.has(v) && !/\bMichelle\b/i.test(clause))) out.push(`S$${m[1]} in "${clause.slice(0, 160)}"`);
    }
  }
  return out;
}
/** A conclusion about the 365-day condition (not the condition itself, an "if" / "whether" clause, or a question). */
export const DAYS_365_CONCLUSION = /(?:\b(?:died|dies|death (?:was|occurred|happened)|occurred|happened|falls?|fell|is|was)\s+(?:well\s+)?(?:within|inside|outside|after|beyond)\s+(?:the\s+)?365(?:-|\s)days?|\b(?:meets?|met|satisf(?:y|ies|ied)|(?:is|was)\s+(?:not\s+)?(?:met|satisfied))\b[^.;?]{0,40}365|365(?:-|\s)day[^.;?]{0,30}\b(?:is|was|has been|appears)\s+(?:not\s+)?(?:met|satisfied)\b)/i;
export function days365Conclusions(text: string): string[] {
  return text.split(/(?<=[.;?!])\s+|\n/).filter((c) => DAYS_365_CONCLUSION.test(c) && !/\b(?:if|only if|whether|provided|as long as|unless)\b[^.;?]*365/i.test(c) && !/\?\s*$/.test(c));
}
const DATE_Q = /\b(?:when|what date|which date|date)\b/i;
/** Which date a question asks for: "accident", "death" or null. */
export function dateAsked(q: string): "accident" | "death" | null {
  if (!DATE_Q.test(q)) return null;
  if (/\baccident\b/i.test(q) && !/\b(?:die|died|death|pass(?:ed)? away)\b/i.test(q)) return "accident";
  if (/\b(?:die|died|death|pass(?:ed)? away)\b/i.test(q) && !/\baccident\b/i.test(q)) return "death";
  return null;
}
type Check = { conv: string; turn: number | null; name: string; ok: boolean; kind: "correctness" | "usefulness"; detail?: string };
/** Version 1 (as pre-registered for s49-live-1; kept for the record). */
export const TERM_LIFE_AS_PA_V1 = /personal accident[^.;]{0,50}S\$1,000,000|S\$1,000,000[^.;]{0,30}personal accident/i;
/** Version 2: Personal Accident wording attributing S$1,000,000 to itself ("Personal Accident cover is S$1,000,000",
 * "Personal Accident: S$1,000,000", "S$1,000,000 under / for / as (the) Group Personal Accident"). */
export const TERM_LIFE_AS_PA_V2 = /personal accident(?:\s+(?:cover|sum (?:insured|assured)|benefit|amount))?\s*(?:is|was|of|at|:|=|amounts? to|totals?)\s*S\$1,000,000(?![\d,])|S\$1,000,000(?![\d,])\s+(?:(?:under|for|as|of)\s+(?:the\s+|his\s+|her\s+|your\s+)?|is\s+(?:his|her|the|your)\s+)(?:group\s+)?personal accident/i;
const NAME_AS_PRODUCT = /(?:separate|under|lists?)[^.]*\b(?:Tan Kai Ming|Ong Li Ting)\b[^.]*\bamounts?\b|\b(?:Tan Kai Ming, Darren|Ong Li Ting, Michelle)\b\s+(?:amount|benefit|cover)\b/i;

export function gradeBinding(convs: any[], version: 1 | 2 = 2): { verdict: "PASS" | "FAIL" | "INCOMPLETE"; checks: Check[]; incomplete: string | null } {
  const checks: Check[] = [];
  let incomplete: string | null = null;
  const add = (conv: string, turn: number | null, name: string, ok: boolean, kind: Check["kind"], detail?: string) => checks.push({ conv, turn, name, ok, kind, ...(detail && !ok ? { detail: detail.slice(0, 500) } : {}) });
  const byId = (id: string) => convs.find((c) => c.scenario === id);
  const death = (id: string, t: any, visible: string, questions: string[]) => {
    const v = [visible, ...questions].join("\n");
    add(id, 1, "no person's name used as a product or benefit", !NAME_AS_PRODUCT.test(v), "correctness", v);
    add(id, 1, "the unrelated insurer (Lumen General) is not suggested", !/Lumen General/i.test(v), "correctness", v);
    add(id, 1, "no other person's amounts as Darren's (S$500,000 / S$300,000 / S$400,000 / S$150,000 / S$100,000)", !/S\$(?:500,000|300,000|400,000|150,000|100,000)(?![\d,])/.test(v), "correctness", v);
    add(id, 1, "no superseded (S$800,000 / S$450,000) or other-household (S$2,000,000) amount", !/S\$(?:800,000|450,000|2,000,000)(?![\d,])/.test(v), "correctness", v);
    add(id, 1, "no total of different benefits (S$1,600,000 or similar) and no promised payment / current-cover claim", !/S\$1,600,000|S\$1,950,000|S\$2,250,000|\bwill (?:receive|be paid|get)\b|\bcurrently covered\b|\bapproved\b(?! payment)/i.test(v.replace(/not an approved payment/gi, "")), "correctness", v);
    add(id, 1, "Term Life is never presented as Personal Accident (S$1,000,000 is not called the PA amount)", !(version === 1 ? TERM_LIFE_AS_PA_V1 : TERM_LIFE_AS_PA_V2).test(v), "correctness", v);
    if (version === 2) {
      const fb = ((t?.answer?.figureBindings ?? []) as any[]);
      const bound = (value: number, re: RegExp) => fb.some((b) => b.value === value && re.test(String(b.benefit ?? "")) && (!b.subjectId || b.subjectId === DARREN));
      add(id, 1, "Term Life S$1,000,000 and PA S$600,000 are each bound (saved) to their own product and to Darren", bound(1000000, /term life/i) && bound(600000, /personal accident/i), "usefulness", JSON.stringify(fb.map((b) => [b.value, b.benefit, b.subjectId])));
    }
    add(id, 1, "Darren's Group Term Life S$1,000,000 is stated with its product", /S\$1,000,000(?![\d,])/.test(visible) && /term life/i.test(visible), "usefulness", visible);
    add(id, 1, "Darren's Group Personal Accident S$600,000 is stated with its product", /S\$600,000(?![\d,])/.test(visible) && /personal accident/i.test(visible), "usefulness", visible);
    add(id, 1, "the accidental-death condition (within 365 days of the accident) is given", /365 days/i.test(visible), "usefulness", visible);
    const qs = questions.length ? questions : (visible.match(/[^.?!\n]*\?/g) ?? []);
    add(id, 1, "exactly one question, about the accident date", qs.length === 1 && /accident/i.test(qs[0]) && /\b(?:when|what date|which date|date)\b/i.test(qs[0]), "usefulness", JSON.stringify(qs));
    void t;
  };
  for (const id of ["S49", "S49B"]) {
    const c = byId(id);
    const turns: any[] = c?.loaded?.turns ?? [];
    const want = id === "S49" ? 2 : 1;
    if (turns.length < want) { incomplete = incomplete ?? `${id}: only ${turns.length} of ${want} turns have a saved answer`; continue; }
    for (const [i, t] of turns.entries()) { const o = t.trace?.outcome; if (t.trace?.limit || (o && !["final_answer", "ask_user"].includes(o))) incomplete = incomplete ?? `${id} turn ${i + 1} stopped: ${t.trace?.limit?.kind ?? o}`; }
    if (version === 2) for (const [i, t] of turns.entries()) {
      const refused = ((t.trace?.toolCalls ?? []) as any[]).filter((x) => ["final_answer", "ask_user"].includes(x.name) && x.ok === false && /is not a parameter|must be|is required/.test(String(x.error ?? "")));
      add(id, i + 1, "the turn was not ended by a limit, and no answer call was refused as malformed", !t.trace?.limit && !refused.length, "usefulness", JSON.stringify({ limit: t.trace?.limit ?? null, refused: refused.map((x) => x.error) }));
    }
    death(id, turns[0], String(turns[0]?.visible ?? ""), (turns[0]?.questions ?? []) as string[]);
    if (id === "S49") {
      const v2 = [String(turns[1]?.visible ?? ""), ...((turns[1]?.questions ?? []) as string[])].join("\n");
      add(id, 2, "after the accident date is given, it is not asked for again", !/\b(?:when|what date)\b[^?]*accident[^?]*\?/i.test(v2), "usefulness", v2);
      add(id, 2, "no promised payment, no unrelated insurer, no person's name as a product", !/\bwill (?:receive|be paid|get)\b|Lumen General/i.test(v2) && !NAME_AS_PRODUCT.test(v2), "correctness", v2);
    }
  }
  const failed = checks.filter((x) => !x.ok);
  return { verdict: incomplete ? "INCOMPLETE" : failed.length ? "FAIL" : "PASS", checks, incomplete };
}

/** Version 3 (see the header). */
export function gradeBindingV3(convs: any[]): { verdict: "PASS" | "FAIL" | "INCOMPLETE"; checks: Check[]; incomplete: string | null } {
  const checks: Check[] = [];
  let incomplete: string | null = null;
  const add = (conv: string, turn: number | null, name: string, ok: boolean, kind: Check["kind"], detail?: string) => checks.push({ conv, turn, name, ok, kind, ...(detail && !ok ? { detail: detail.slice(0, 500) } : {}) });
  const WANT: Record<string, number> = { S49: 2, S49B: 1, S50: 2 };
  const present = convs.filter((c) => c.scenario in WANT);
  if (!present.length) return { verdict: "INCOMPLETE", checks, incomplete: "no binding conversation (S49, S49B, S50) in the run" };
  for (const c of present) {
    const id = c.scenario as string;
    const turns: any[] = c?.loaded?.turns ?? [];
    if (turns.length < WANT[id]) { incomplete = incomplete ?? `${id}: only ${turns.length} of ${WANT[id]} turns have a saved answer`; continue; }
    const known = { accident: false, death: false };
    for (const [i, t] of turns.entries()) {
      const n = i + 1;
      const user = String(c.turns?.[i]?.user ?? (id === "S49" && n === 2 ? "The accident happened on 3 October 2026." : id === "S50" && n === 2 ? "The accident happened on 3 October 2026 and he died on 5 October 2026." : ""));
      const o = t.trace?.outcome;
      if (t.trace?.limit || (o && !["final_answer", "ask_user"].includes(o))) incomplete = incomplete ?? `${id} turn ${n} stopped: ${t.trace?.limit?.kind ?? o}`;
      const refused = ((t.trace?.toolCalls ?? []) as any[]).filter((x) => ["final_answer", "ask_user"].includes(x.name) && x.ok === false && /is not a parameter|must be|is required/.test(String(x.error ?? "")));
      add(id, n, "the turn was not ended by a limit, and no answer call was refused as malformed", !t.trace?.limit && !refused.length, "usefulness", JSON.stringify({ limit: t.trace?.limit ?? null, refused: refused.map((x) => x.error) }));
      if (/accident (?:happened|was|occurred) on \d|\bon \d{1,2} \w+ \d{4}[^.]*accident/i.test(user)) known.accident = true;
      if (/\b(?:died|passed away|death)\b[^.]*\b(?:on )?\d{1,2} \w+ \d{4}/i.test(user)) known.death = true;
      const visible = String(t.visible ?? "");
      const questions = (t.questions ?? []) as string[];
      const v = [visible, ...questions].join("\n");
      const fb = (t?.answer?.figureBindings ?? []) as any[];
      add(id, n, "no person's name used as a product or benefit", !NAME_AS_PRODUCT.test(v), "correctness", v);
      add(id, n, "the unrelated insurer (Lumen General) is not suggested", !/Lumen General/i.test(v), "correctness", v);
      const wrong = wrongIdentity(fb);
      add(id, n, "every saved figure is Darren's own amount for its product, from the current certificate (identity, not number)", !wrong.length, "correctness", wrong.join("; "));
      const unknown = unidentifiedAmounts(visible, fb);
      add(id, n, "every amount shown is bound to Darren or stated with the product whose amount in Darren's row it is", !unknown.length, "correctness", unknown.join("; "));
      add(id, n, "no total of different benefits and no promised payment / current-cover claim", !/S\$1,600,000|S\$1,950,000|S\$2,250,000|\bwill (?:receive|be paid|get)\b|\bcurrently covered\b|\bapproved\b(?! payment)/i.test(v.replace(/not an approved payment/gi, "")), "correctness", v);
      add(id, n, "Term Life is never presented as Personal Accident", !TERM_LIFE_AS_PA_V2.test(v), "correctness", v);
      const concl = days365Conclusions(v);
      if (!(known.accident && known.death)) add(id, n, "no 365-day conclusion before both the accident and death dates are known", !concl.length, "correctness", concl.join(" | "));
      else add(id, n, "any 365-day conclusion agrees with the dates given (2 days apart: within)", concl.every((x) => !/outside|after|beyond|not (?:met|satisfied)|more than 365/i.test(x)), "correctness", concl.join(" | "));
      const qs = questions.length ? questions : (visible.match(/[^.?!\n]*\?/g) ?? []);
      if (n === 1) {
        add(id, n, "Darren's Group Term Life S$1,000,000 and Group Personal Accident S$600,000 are each bound (saved) to their own product and to Darren", [[1000000, /term life/i], [600000, /personal accident/i]].every(([val, re]) => fb.some((b) => b.value === val && (re as RegExp).test(String(b.benefit ?? "")) && !wrongIdentity([b]).length)), "usefulness", JSON.stringify(fb.map((b) => [b.value, b.benefit, b.subjectId, b.rowPerson])));
        add(id, n, "the accidental-death condition (within 365 days of the accident) is given", /365 days/i.test(visible), "usefulness", visible);
      }
      const missing = (["accident", "death"] as const).filter((k) => !known[k]);
      if (missing.length) {
        const asked = qs.map(dateAsked);
        add(id, n, `exactly one question, asking for a missing date (${missing.join(" or ")})`, qs.length === 1 && !!asked[0] && missing.includes(asked[0]), "usefulness", JSON.stringify(qs));
      } else {
        add(id, n, "both dates are known: neither is asked for again", !qs.some((q) => dateAsked(q)), "usefulness", JSON.stringify(qs));
      }
      const askedNow = qs.map(dateAsked);
      for (const k of ["accident", "death"] as const) if (known[k] && askedNow.includes(k)) add(id, n, `the ${k} date, already given, is not asked for again`, false, "usefulness", JSON.stringify(qs));
    }
  }
  const failed = checks.filter((x) => !x.ok);
  return { verdict: incomplete ? "INCOMPLETE" : failed.length ? "FAIL" : "PASS", checks, incomplete };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("binding-check.ts")) {
  const dir = process.argv[2];
  if (!dir) { console.error("usage: binding-check.ts <RUN directory>"); process.exit(2); }
  const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
  // Version 3 by default (writes binding-grade-v3.*); --v2 / --v1 reproduce the earlier grades.
  const version: 1 | 2 | 3 = process.argv.includes("--v1") ? 1 : process.argv.includes("--v2") ? 2 : 3;
  const suffix = version === 1 ? "" : `-v${version}`;
  const g = version === 3 ? gradeBindingV3(run.conversations ?? []) : gradeBinding(run.conversations ?? [], version);
  fs.writeFileSync(path.join(dir, `binding-grade${suffix}.json`), JSON.stringify(g, null, 2));
  const md = [`# Binding actual-model grade (grader version ${version}): ${g.verdict}`, g.incomplete ? `\nIncomplete: ${g.incomplete}` : "", "", "| conversation | turn | check | kind | result | detail |", "|---|---|---|---|---|---|",
    ...g.checks.map((c) => `| ${c.conv} | ${c.turn ?? "all"} | ${c.name} | ${c.kind} | ${c.ok ? "pass" : "**FAIL**"} | ${(c.detail ?? "").replace(/\|/g, "/").replace(/\n/g, " ")} |`)].join("\n");
  fs.writeFileSync(path.join(dir, `binding-grade${suffix}.md`), md + "\n");
  console.log(`binding (grader v${version}): ${g.verdict}; ${g.checks.filter((c) => !c.ok).length} of ${g.checks.length} checks failed`);
}
