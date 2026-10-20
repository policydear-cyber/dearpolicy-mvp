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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const isoDate = (iso: string, long = false) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[3])} ${(long ? LONG_MONTHS : MONTHS)[Number(m[2]) - 1]} ${m[1]}` : iso;
};
const pageRef = (page: number | null | undefined) => page == null ? "" : ` · p.${page}`;

/** An amount card: the figure, whose and what it is, its own basis and
 * conditions, and where it comes from as a chip. Conditions never move off
 * the card their amount is on. */
function AmountCard({ s }: { s: AnswerStatement }) {
  const a = s.amount!;
  return <div className="answer-card" data-testid="answer-card">
    <div className="answer-card-amount">
      <strong>{a.text}</strong>
      <small>{a.illustration ? "illustration" : "printed amount"}{a.currencyResolved ? "" : " · currency not stated"}</small>
    </div>
    <p className="answer-card-text">{s.text}</p>
    {s.basis ? <p className="answer-card-basis">{s.basis}</p> : null}
    {s.conditions?.length ? <ul className="answer-card-conditions">{s.conditions.map((c, i) => <li key={i}>{c}</li>)}</ul> : null}
    <div className="answer-chips">
      {s.source ? <span className="answer-chip">{s.source.policyName}{pageRef(s.source.page)}</span> : null}
      {s.asOf ? <span className="answer-chip muted">As printed {isoDate(s.asOf)}</span> : null}
    </div>
  </div>;
}

/** Where each card's figure comes from, one tap away: document, page, row,
 * footnote, date and the quoted words. Nothing here is left out of the
 * answer; it is only moved below it. */
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
        {s.amount && !s.amount.currencyResolved ? <p>The document prints a bare “$” and does not say which currency.</p> : null}
        {quotes.map((q, i) => <blockquote key={i}>“{q}”</blockquote>)}
      </div>;
    })}
    {citations.length && sources ? <div className="answer-where-all"><b>All documents used</b>{sources}</div> : null}
  </details>;
}

/** The short answer: bottom line (only when the server marked a real
 * outcome), one card per amount, other statements as short points, and the
 * source detail collapsed underneath. */
export function AnswerCards({ answer, render, sources }: { answer: StructuredAnswer; render: (text: string) => string; sources?: React.ReactNode }) {
  const statements = answer.statements ?? [];
  const illustrations = statements.some((s) => s.amount?.illustration);
  return <div className="answer-cards">
    {answer.bottomLine ? <p className="answer-bottom-line" data-testid="answer-bottom-line">{render(answer.bottomLine)}</p> : null}
    {/* No bottom line: the answer's own first sentence stays, unbolded, unless a statement below already says it. */}
    {!answer.bottomLine && answer.summary?.trim() && !statements.some((s) => (s.fullText ?? s.text).trim() === answer.summary.trim()) ? <p className="answer-point">{render(answer.summary)}</p> : null}
    {statements.map((s) => s.amount
      ? <AmountCard key={s.id} s={{ ...s, text: render(s.text), basis: s.basis ? render(s.basis) : s.basis }} />
      : <p key={s.id} className={`answer-point${s.kind === "uncertainty" ? " caution" : ""}`}>{render(s.text)}</p>)}
    <WhereFrom statements={statements} citations={answer.citations} sources={sources} />
    {illustrations ? <p className="answer-cards-foot">Illustrations from your documents, not a payment or an insurer&rsquo;s decision.</p> : null}
  </div>;
}
