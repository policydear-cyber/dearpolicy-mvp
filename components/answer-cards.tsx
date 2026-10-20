import type { ChatAnswer, ChatCitation } from "@/types";

/** One checked statement of an answer, as the server sends it alongside the
 * prose (the Developer's answer-fields change). Only calculation and
 * benefit_terms statements carry amount, basis, conditions, asOf and source;
 * every other kind arrives as plain `text`. Declared here, not in types/,
 * until that change lands with its own type. */
export type AnswerStatement = {
  id: string;
  kind: "calculation" | "benefit_terms" | "fact" | "uncertainty" | "not_found" | "suggestion" | "library_status";
  /** Short plain sentence: no page references, no "not a payment" tail. */
  text: string;
  /** The checked sentence as the prose shows it today. */
  fullText?: string;
  personName?: string | null;
  amount?: { text: string; currencyResolved: boolean; illustration: boolean } | null;
  basis?: string | null;
  conditions?: string[];
  /** ISO date the amount was printed. */
  asOf?: string | null;
  source?: { policyName: string; page: number | null; rowLabel?: string | null; footnote?: { marker: string; text: string } | null; note?: string | null; citationIds?: string[] } | null;
};
export type StructuredAnswer = ChatAnswer & { bottomLine?: string | null; statements?: AnswerStatement[] };

export const hasStatements = (answer: ChatAnswer | undefined): answer is StructuredAnswer =>
  !!answer && Array.isArray((answer as StructuredAnswer).statements) && (answer as StructuredAnswer).statements!.length > 0;

/** Whether the chat shows this answer as cards. A claim assessment keeps its own layout. */
export const showsCards = (answer: ChatAnswer | undefined): answer is StructuredAnswer =>
  hasStatements(answer) && answer.mode !== "claim_assessment";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const isoDate = (iso: string, long = false) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[3])} ${(long ? LONG_MONTHS : MONTHS)[Number(m[2]) - 1]} ${m[1]}` : iso;
};
const pageRef = (page: number | null | undefined) => page == null ? "" : ` · p.${page}`;

/** For comparing two renderings of one sentence: markup, quotes, case, spacing and end punctuation do not count. */
const norm = (s: string) => s.replace(/[*_`#>]/g, "").replace(/[“”"‘’']/g, "").replace(/\s+/g, " ").trim().replace(/[.;:,!?]+$/, "").toLowerCase();

/** Sentences of the prose, split only at a full stop, ! or ? followed by a capital or an opening quote. */
const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z“"(])/).map((s) => s.trim()).filter(Boolean);

/** The condition an amount depends on, as the checked sentence words it: "If the Simple Fracture benefit applies to
 * Grace's case “…”". It is the clause before the first comma outside quotes; when there is no clean clause the whole
 * checked sentence is used, so the condition is never cut short. */
const CONDITION_START = /^(if|when|only if|provided|subject to|unless|as long as|where)\b/i;
function conditionOf(fullText: string | undefined): string | null {
  const t = fullText?.trim();
  if (!t || !CONDITION_START.test(t)) return null;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "“" || ch === "(") depth++;
    else if ((ch === "”" || ch === ")") && depth > 0) depth--;
    else if (ch === "," && depth === 0) return t.slice(0, i);
  }
  return t;
}

/** A bottom line naming an outcome must carry its own qualifier; one that states an outcome flatly is not shown. */
const OUTCOME = /\b(claim|covered|cover|pays?|payable|entitled|eligible|receive|get)\b/i;
const HEDGE = /\b(may|might|could|if|unless|depends?|subject to|likely|not|only|insurer decides|would)\b/i;
const safeBottomLine = (line: string | null | undefined) => !!line?.trim() && (!OUTCOME.test(line) || HEDGE.test(line));

/** What a card or point says, beyond its short text: its own basis, conditions and any limit the source notes. */
function Qualifiers({ s }: { s: AnswerStatement }) {
  return <>
    {s.basis ? <p className="answer-card-basis">{s.basis}</p> : null}
    {s.conditions?.length ? <ul className="answer-card-conditions">{s.conditions.map((c, i) => <li key={i}>{c}</li>)}</ul> : null}
    {s.source?.note ? <p className="answer-card-note" data-testid="answer-card-note">{s.source.note}</p> : null}
  </>;
}

/** An amount card: whose it is, the figure, the condition it depends on, its own basis and conditions, and where it
 * comes from as a chip. Nothing that limits the amount moves off its card. */
function AmountCard({ s, condition }: { s: AnswerStatement; condition: string | null }) {
  const a = s.amount!;
  return <div className="answer-card" data-testid="answer-card">
    {s.personName ? <p className="answer-card-person" data-testid="answer-card-person">For {s.personName}</p> : null}
    <div className="answer-card-amount">
      <strong>{a.text}</strong>
      <small>{a.illustration ? "illustration" : "printed amount"}{a.currencyResolved ? "" : " · currency not stated"}</small>
    </div>
    {condition ? <p className="answer-card-condition" data-testid="answer-card-condition">{condition}</p> : null}
    <p className="answer-card-text">{s.text}</p>
    <Qualifiers s={s} />
    <div className="answer-chips">
      {s.source ? <span className="answer-chip">{s.source.policyName}{pageRef(s.source.page)}</span> : null}
      {s.asOf ? <span className="answer-chip muted">As printed {isoDate(s.asOf)}</span> : null}
    </div>
  </div>;
}

/** Where each card's figure comes from, one tap away: document, page, row, footnote, date and the quoted words. Nothing
 * here is left out of the answer; it is only moved below it. */
function WhereFrom({ statements, citations, sources }: { statements: AnswerStatement[]; citations: ChatCitation[]; sources?: React.ReactNode }) {
  const sourced = statements.filter((s) => s.source);
  if (!sourced.length && !citations.length) return null;
  const byId = new Map(citations.map((c) => [c.chunkId, c]));
  return <details className="answer-where" data-testid="answer-where"><summary>Where this comes from</summary>
    {sourced.map((s) => {
      const src = s.source!;
      const quotes = [...new Set((src.citationIds ?? []).map((id) => byId.get(id)?.excerpt?.replace(/\s+/g, " ").trim()).filter((e): e is string => !!e))];
      return <div className="answer-where-item" key={s.id}>
        <p><b>{s.amount?.text ?? s.text}</b> · {src.policyName}{src.page != null ? `, page ${src.page}` : ""}{src.rowLabel ? `, row “${src.rowLabel}”` : ""}.</p>
        {src.footnote ? <p>Footnote {src.footnote.marker}: <q>{src.footnote.text}</q></p> : null}
        {src.note ? <p>{src.note}</p> : null}
        {s.asOf ? <p>Printed on {isoDate(s.asOf, true)}. That does not confirm cover on a later date.</p> : null}
        {s.amount && !s.amount.currencyResolved
          ? <p>{/^\$/.test(s.amount.text.trim()) ? "The document prints a bare “$” and does not say which currency." : "The document does not say which currency."}</p>
          : null}
        {quotes.map((q, i) => <blockquote key={i}>“{q}”</blockquote>)}
      </div>;
    })}
    {citations.length && sources ? <div className="answer-where-all"><b>All documents used</b>{sources}</div> : null}
  </details>;
}

/** The short answer: bottom line (only when the server marked a real outcome and it carries its qualifier), one card
 * per amount, other statements as short points, any sentence of the prose no statement covers, and the source detail
 * collapsed underneath. `prose` is the answer's own text (content, then details): the cards never drop any of it. */
export function AnswerCards({ answer, render, sources, prose = [] }: { answer: StructuredAnswer; render: (text: string) => string; sources?: React.ReactNode; prose?: string[] }) {
  const statements = answer.statements ?? [];
  const people = new Set(statements.map((s) => s.personName).filter(Boolean));
  // An amount whose person is missing in an answer about several people is shown as its checked sentence, never as a nameless card.
  const asCard = (s: AnswerStatement) => !!s.amount && (!!s.personName || people.size <= 1);
  const covered = statements.flatMap((s) => [s.fullText, s.text].filter((t): t is string => !!t).map((t) => norm(render(t))));
  const isCovered = (sentence: string) => { const n = norm(sentence); return !n || covered.some((c) => c === n || c.includes(n)); };
  const bottomLine = safeBottomLine(answer.bottomLine) ? answer.bottomLine! : null;
  const summary = answer.summary?.trim() ? render(answer.summary) : "";
  const showSummary = !bottomLine && summary && !isCovered(summary);
  const alreadyShown = new Set([...(showSummary ? sentences(summary) : []), ...(bottomLine ? sentences(render(bottomLine)) : [])].map(norm));
  const remaining = [...new Set(prose.map(render).flatMap(sentences).filter((s) => !isCovered(s) && !alreadyShown.has(norm(s))))];
  const illustrations = statements.some((s) => s.amount?.illustration);
  const amounts = statements.some((s) => s.amount);
  const fullProse = prose.map(render).filter((t) => t.trim());
  return <div className="answer-cards">
    {bottomLine ? <p className="answer-bottom-line" data-testid="answer-bottom-line">{render(bottomLine)}</p> : null}
    {showSummary ? <p className="answer-point">{summary}</p> : null}
    {statements.map((s) => asCard(s)
      ? <AmountCard key={s.id} s={{ ...s, text: render(s.text), basis: s.basis ? render(s.basis) : s.basis }} condition={(() => { const c = conditionOf(s.fullText); return c ? render(c) : null; })()} />
      : <div key={s.id} className={`answer-point${s.kind === "uncertainty" ? " caution" : ""}`}>
          <p>{render(s.amount ? s.fullText ?? s.text : s.text)}</p>
          <Qualifiers s={{ ...s, basis: s.basis ? render(s.basis) : s.basis }} />
        </div>)}
    {/* What the prose says that no statement covers stays in view, in its own words. */}
    {remaining.length ? <div className="answer-remaining" data-testid="answer-remaining"><b>Also in this answer</b>{remaining.map((s, i) => <p key={i}>{s}</p>)}</div> : null}
    <WhereFrom statements={statements} citations={answer.citations} sources={sources} />
    {fullProse.length ? <details className="answer-full" data-testid="answer-full"><summary>Full answer</summary>{fullProse.map((t, i) => <p key={i}>{t}</p>)}</details> : null}
    {amounts ? <p className="answer-cards-foot">{illustrations ? "Illustrations" : "Amounts"} from your documents, not a payment or an insurer&rsquo;s decision.</p> : null}
  </div>;
}
