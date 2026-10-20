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

const squash = (t: string) => t.replace(/\s+/g, " ").trim();
/** A count said in words (a bottom line states no number that is not on an amount card). */
const COUNT = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n: number) => COUNT[n] ?? "several";

/** The evidence of the composed sentences a paragraph shows (a paragraph is one sentence, or notes joined with it). */
function evidenceOf(paragraph: string, composed: Composed | null): string[] {
  const p = squash(paragraph);
  return [...new Set((composed?.sentences ?? []).filter((s) => s.text.trim() && p.includes(squash(s.text))).flatMap((s) => s.evidenceIds))];
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
  // (two documents' amounts for the same event are alternatives: marked as one either-or group, so they are never read as a total)
  const conflict = statements.find((s) => s.kind === "uncertainty" && s.source?.policyName.includes(" and "));
  const alternatives = statements.filter((s) => s.amount && s.kind === "calculation");
  if (conflict && alternatives.length >= 2) for (const s of alternatives) s.group = { id: "g1", kind: "either_or", note: "These are alternatives from different documents, never a total. The documents don't say which one applies; the insurer decides." };
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
  const either = amounts.filter((s) => s.group?.kind === "either_or");
  if (either.length >= 2) {
    const list = either.map((a) => a.amount!.text);
    const who = either[0].personName;
    return then(`${who ? `${who}'s documents` : "The documents"} print either ${list.slice(0, -1).join(", ")} or ${list.at(-1)} for this (alternatives, not a total), and only the insurer decides which applies`);
  }
  // (one printed amount is the outcome only when nothing else in the answer qualifies it -- "its accident condition is not met")
  if (amounts.length === 1 && (amounts[0].kind === "calculation" || statements.length === 1)) {
    const a = amounts[0];
    const said = a.text.replace(/[.\s]+$/, "");
    return then(a.kind === "calculation" ? `${said}, and only the insurer decides whether it applies` : `${a.personName ? `For ${a.personName}, ` : ""}${said.replace(/^./, (c) => c.toLowerCase())}, if its conditions are met, and only the insurer can confirm it applies to this event`);
  }
  if (amounts.length > 1 && amounts.every((x) => x.kind === "calculation")) return then(`The documents print ${count(amounts.length)} amounts that may apply, each with its own conditions below, and only the insurer decides which applies`);
  const missing = statements.find((s) => s.kind === "not_found");
  if (missing && missing === statements[0]) return `${missing.text.replace(/[.\s]+$/, "")}. Only the insurer can confirm whether anything else applies.`;
  if (step) return `If you go ahead, start here: ${step}`;
  return null;
}
