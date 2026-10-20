/**
 * Answer shape (UX "shorter answers"): the loop's answer as fields -- one statement per shown paragraph, a structured one (short text,
 * amount, base, its own conditions, person, date printed, source) where the server rendered that paragraph and registered its fields
 * (statement-render.ts structure), plain text otherwise -- and a bottom line that carries its own qualifier. Built from the answer AFTER
 * the figure gate; lib/chat/monetary-boundary.ts reconcileStatements checks it again on return, save and reopen.
 */
import type { AnswerStatement, ChatAnswer } from "@/types";
import { tidyNames, type Composed, type NamedPerson } from "./compose";
import type { StructuredDraft } from "./statement-render";
import { reconcileStatements } from "@/lib/chat/monetary-boundary";
import { sentencesOf } from "@/lib/chat/answer-verification";

const squash = (t: string) => t.replace(/\s+/g, " ").trim();
/** A count said in words (a bottom line states no number that is not on an amount card). */
const COUNT = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n: number) => COUNT[n] ?? "several";
/** A money amount in a paragraph (a currency or a bare "$" before digits). */
const MONEY = /(?:\b[A-Z]{0,3}\$|\b(?:SGD|USD|MYR|EUR|GBP)\s?)\s?\d/;
/** A paragraph saying a printed benefit does not apply here: a condition not met, a trip or period that does not fit. */
const VERDICT = /\bnot met\b|\bnot an amount for\b|\bdoes(?:n['’]t| not) (?:fit|cover|apply)\b|\boutside (?:the|its) (?:period|trip|dates)\b|\bended\b/i;

/** The evidence of the composed sentences a paragraph shows (a paragraph is one sentence, or notes joined with it). */
function evidenceOf(paragraph: string, composed: Composed | null): string[] {
  const p = squash(paragraph);
  // (Critic R23-3: a paragraph the figure gate shortened -- a sentence of it left out -- still rests on its sentence's evidence)
  const parts = sentencesOf(paragraph).map(squash).filter((x) => x.length >= 40);
  return [...new Set((composed?.sentences ?? []).filter((s) => { const t = squash(s.text); return t && (p.includes(t) || parts.some((x) => t.includes(x))); }).flatMap((s) => s.evidenceIds))];
}

/** The answer's statements and bottom line, and its citations narrowed to what it shows: the evidence of the composed sentences still in
 * its paragraphs (or the narrower evidence a card names), and of the clause a question card turns on (`extra`). (UX tester: a fracture
 * answer cited an unrelated "disappearing at sea" passage.) */
export function buildStatements(answer: ChatAnswer, composed: Composed | null, registered: Map<string, StructuredDraft> | undefined, people: NamedPerson[] = [], extra: string[] = []): void {
  const paragraphs = [answer.summary, ...answer.details].filter((p) => p.trim());
  const cites = (p: string, d?: StructuredDraft) => d?.source?.citeIds ?? evidenceOf(p, composed);
  // (the composer says names as the household uses them -- "Grace", never "Tan Hui Min Grace (Grace)" -- so a draft is matched, and said,
  // with the same names: compose.ts tidyNames)
  const tidy = (t: string) => tidyNames(t, people);
  const drafts = new Map<string, StructuredDraft>();
  for (const [k, d] of registered ?? []) drafts.set(tidy(k), { ...d, short: tidy(d.short), personName: d.personName ? tidy(d.personName) : d.personName, basis: d.basis ? tidy(d.basis) : d.basis, conditions: d.conditions.map(tidy), source: d.source ? { ...d.source, note: d.source.note ? tidy(d.source.note) : d.source.note } : null });
  const shown = new Set([...paragraphs.flatMap((p) => cites(p, drafts.get(p))), ...extra].map((id) => "rag2:" + id));
  answer.citations = answer.citations.filter((c) => !c.chunkId.startsWith("rag2:") || shown.has(c.chunkId));
  if (!paragraphs.length) return;
  const statements: AnswerStatement[] = paragraphs.map((p, i) => {
    const d = drafts.get(p);
    const sentence = composed?.sentences.find((s) => s.text === p);
    if (!d) return { id: `s${i + 1}`, kind: sentence?.kind === "absence" ? "not_found" : "fact", text: p, fullText: p, conditions: [] };
    const { short, source, ...rest } = d;
    const { citeIds: _c, ...src } = source ?? { citeIds: undefined };
    return { id: `s${i + 1}`, ...rest, text: short, fullText: p, source: source ? { ...(src as Omit<NonNullable<StructuredDraft["source"]>, "citeIds">), citationIds: cites(p, d).map((id) => "rag2:" + id) } : null };
  });
  // (Evidence Reviewer 2/5: an amount another paragraph says does not apply here -- a condition not met, a trip that does not fit -- is
  // never a card: it goes as plain text, next to that verdict)
  // (... and an amount printed for a period that had ended before today -- a trip schedule's "10/03/2025 to 17/03/2025" -- is not a card)
  const ended = (c: string) => [...c.matchAll(/\b\d{1,2}\/\d{1,2}\/\d{4}\s+to\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)].some((m) => Date.UTC(+m[3], +m[2] - 1, +m[1]) < Date.now());
  for (const [i, st] of statements.entries()) {
    if (!st.amount) continue;
    if (st.conditions.some(ended)) { statements[i] = { id: st.id, kind: "fact", text: st.fullText, fullText: st.fullText, conditions: [] }; continue; }
    const name = st.text.split(/[:(]/)[0].replace(/^.*?\b(?:lists|prints)\s+/i, "").trim().toLowerCase();
    if (name.length >= 6 && statements.some((o, j) => j !== i && o.fullText.toLowerCase().includes(name) && VERDICT.test(o.fullText)))
      statements[i] = { id: st.id, kind: "fact", text: st.fullText, fullText: st.fullText, conditions: [] };
  }
  answer.statements = statements;
  answer.bottomLine = bottomLine(statements, answer.nextSteps);
  reconcileStatements(answer);
}

/** The outcome a family wants first, in ONE sentence with its qualifier, then the one next step: two documents' alternatives as "either A
 * or B" with who decides; one illustration with its "if" and who decides; several amounts pointing to their own cards; a "not found" as
 * found, with who confirms; otherwise the first next step. Never a figure that is not on an amount card (reconcileStatements). */
function bottomLine(statements: AnswerStatement[], nextSteps: string[]): string | null {
  const amounts = statements.filter((s) => s.amount);
  const step = nextSteps.find((x) => x.trim() && !/\d/.test(x));
  const then = (said: string) => step ? `${said}; the next step is to ${step.replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase()).replace(/[.\s]+$/, "")}.` : `${said}.`;
  const groups = [...new Set(amounts.map((a) => a.group?.id).filter((g): g is string => !!g))];
  const either = groups.length === 1 ? amounts.filter((s) => s.group?.id === groups[0]) : [];
  if (either.length >= 2 && either.length === amounts.length) {
    const list = either.map((a) => a.amount!.text);
    const who = either[0].personName;
    return then(`${who ? `${who}'s documents` : "The documents"} print either ${list.slice(0, -1).join(", ")} or ${list.at(-1)} for this (alternatives, not a total), and only the insurer decides which applies`);
  }
  // (one illustration is the outcome with its "if"; a printed amount alone never is -- its dates, trip and conditions are on its card,
  // Evidence Reviewer 1)
  if (amounts.length === 1 && amounts[0].kind === "calculation") return then(`If it applies, ${amounts[0].personName ? `${amounts[0].personName}'s documents give` : "the documents give"} an illustration of ${amounts[0].amount!.text}, and only the insurer decides whether it applies`);
  if (groups.length > 1 && amounts.every((a) => a.group)) return then(`${amounts[0].personName ? `${amounts[0].personName}'s documents` : "The documents"} print two alternative amounts for each injury below (alternatives, never a total), and only the insurer decides which applies`);
  // (Critic R24-1: an amount said in plain text -- a row the server did not render as a card -- is printed too, so the count is said only
  // when every amount the answer states is on a card)
  const plainMoney = statements.some((s) => !s.amount && MONEY.test(s.fullText));
  if (amounts.length >= 1 && plainMoney) return then("Your documents print amounts that may apply, each with its own conditions and dates below, and only the insurer decides whether any applies");
  if (amounts.length >= 1) return then(`Your documents print ${count(amounts.length)} ${amounts.length > 1 ? "amounts" : "amount"} that may apply, each with its own conditions and dates below, and only the insurer decides whether ${amounts.length > 1 ? "any applies" : "it applies"}`);
  // (Evidence Reviewer 5: a printed benefit whose condition the household's account does not meet is the outcome -- said as the answer
  // says it, with whose decision it is)
  const verdict = statements.flatMap((s) => sentencesOf(s.fullText)).find((x) => VERDICT.test(x) && /\binsurer/i.test(x));
  if (verdict) return then(verdict.trim().replace(/[.\s]+$/, ""));
  const missing = statements.find((s) => s.kind === "not_found");
  if (missing) return /\binsurer\b/i.test(missing.text) ? missing.text.trim() : `${missing.text.replace(/[.\s]+$/, "")}. Only the insurer can confirm whether anything else applies.`;
  if (step) return `If you go ahead, start here: ${step}`;
  return null;
}
