import { Fragment, useId, useRef } from "react";
import type { ChatAnswer, ChatCitation } from "@/types";

/** One checked statement of an answer, as the server sends it alongside the
 * prose (the Developer's answer-fields change). Only calculation and
 * benefit_terms statements carry amount, basis, conditions, asOf and source;
 * every other kind arrives as plain `text`. Mirrors AnswerStatement in the
 * Developer's PR #70 (types/index.ts); declared here until that lands. */
export type AnswerStatement = {
  id: string;
  kind: "calculation" | "benefit_terms" | "fact" | "uncertainty" | "not_found";
  /** Short plain sentence: no page references, no "not a payment" tail. */
  text: string;
  /** The checked sentence as the prose shows it today. */
  fullText: string;
  personName?: string | null;
  amount?: { text: string; currencyResolved: boolean; illustration: boolean } | null;
  basis?: string | null;
  conditions: string[];
  /** ISO date the amount was printed. */
  asOf?: string | null;
  source?: { policyName: string; page: number | null; rowLabel?: string | null; footnote?: { marker: string; text: string } | null; note?: string | null; citationIds: string[] } | null;
  /** Amounts that are alternatives, never a total: the same id on each, kind "either_or", and the plain note saying so. */
  group?: { id: string; kind: "either_or"; note: string } | null;
};
export type StructuredAnswer = ChatAnswer & { bottomLine?: string | null; statements?: AnswerStatement[] };

export const hasStatements = (answer: ChatAnswer | undefined): answer is StructuredAnswer =>
  !!answer && Array.isArray((answer as StructuredAnswer).statements) && (answer as StructuredAnswer).statements!.length > 0;

/** Whether the chat shows this answer as cards. A claim assessment keeps its own layout, and an answer that is out of
 * date (invalidated or withdrawn) never shows its statements or bottom line: only its prose under the out-of-date note. */
export const showsCards = (answer: ChatAnswer | undefined): answer is StructuredAnswer =>
  hasStatements(answer) && answer.mode !== "claim_assessment" && !answer.invalidated;

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
function AmountCard({ s, openSource }: { s: AnswerStatement; openSource: (id: string) => void }) {
  const a = s.amount!;
  return <div className="answer-card" data-testid="answer-card">
    {s.personName ? <p className="answer-card-person" data-testid="answer-card-person">For {s.personName}</p> : null}
    <div className="answer-card-amount">
      <strong>{a.text}</strong>
      <small>{a.illustration ? "illustration" : "printed amount"}{a.currencyResolved ? "" : " · currency not stated"}</small>
    </div>
    {/* With no conditions[] from the server, the whole checked sentence stays on the card; it is never cut client-side. */}
    {!s.conditions?.length && s.fullText ? <p className="answer-card-condition" data-testid="answer-card-condition">{s.fullText}</p> : null}
    <p className="answer-card-text">{s.text}</p>
    <Qualifiers s={s} />
    <div className="answer-chips">
      {s.source ? <button type="button" className="answer-chip-button" onClick={() => openSource(s.id)} aria-label={`Where this comes from: ${s.source.policyName}${s.source.page != null ? `, page ${s.source.page}` : ""}`}><span className="answer-chip">{s.source.policyName}{pageRef(s.source.page)}</span></button> : null}
      {s.asOf ? <span className="answer-chip muted">As printed {isoDate(s.asOf)}</span> : null}
    </div>
  </div>;
}

/** Where each card's figure comes from, one tap away: document, page, row, footnote, date and the quoted words. Nothing
 * here is left out of the answer; it is only moved below it. */
function WhereFrom({ statements, citations, sources, idFor, detailsRef }: { statements: AnswerStatement[]; citations: ChatCitation[]; sources?: React.ReactNode; idFor: (id: string) => string; detailsRef: React.RefObject<HTMLDetailsElement | null> }) {
  const sourced = statements.filter((s) => s.source);
  if (!sourced.length && !citations.length) return null;
  const byId = new Map(citations.map((c) => [c.chunkId, c]));
  return <details className="answer-where" data-testid="answer-where" ref={detailsRef}><summary>Where this comes from</summary>
    {sourced.map((s) => {
      const src = s.source!;
      const quotes = [...new Set((src.citationIds ?? []).map((id) => byId.get(id)?.excerpt?.replace(/\s+/g, " ").trim()).filter((e): e is string => !!e))];
      return <div className="answer-where-item" key={s.id} id={idFor(s.id)} tabIndex={-1}>
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
  const uid = useId();
  const where = useRef<HTMLDetailsElement>(null);
  const idFor = (id: string) => `where-${uid.replace(/[^a-zA-Z0-9_-]/g, "")}-${id}`;
  // A card's document chip opens its own source detail.
  const openSource = (id: string) => {
    if (where.current) where.current.open = true;
    const el = document.getElementById(idFor(id));
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    el?.focus({ preventScroll: true });
  };
  // An amount with no person is shown as its checked sentence, never as a nameless card.
  const asCard = (s: AnswerStatement) => !!s.amount && !!s.personName;
  const covered = statements.flatMap((s) => [s.fullText, s.text].filter((t): t is string => !!t).flatMap((t) => { const r = render(t); return [r, ...sentences(r)]; }).map(norm));
  const isCovered = (sentence: string) => { const n = norm(sentence); return !n || covered.includes(n); };
  // Only the server's bottomLine is shown; it carries its own qualifier. None is ever derived here.
  const bottomLine = answer.bottomLine?.trim() ? answer.bottomLine : null;
  const summary = answer.summary?.trim() ? render(answer.summary) : "";
  const showSummary = !bottomLine && summary && !isCovered(summary);
  const alreadyShown = new Set([...(showSummary ? sentences(summary) : []), ...(bottomLine ? sentences(render(bottomLine)) : [])].map(norm));
  const remaining = [...new Set(prose.map(render).flatMap(sentences).filter((s) => !isCovered(s) && !alreadyShown.has(norm(s))))];
  const illustrations = statements.some((s) => s.amount?.illustration);
  const amounts = statements.some((s) => s.amount);
  const fullProse = prose.map(render).filter((t) => t.trim());
  const one = (s: AnswerStatement) => asCard(s)
    ? <AmountCard key={s.id} openSource={openSource} s={{ ...s, text: render(s.text), fullText: render(s.fullText ?? ""), basis: s.basis ? render(s.basis) : s.basis }} />
    : <div key={s.id} className={`answer-point${s.kind === "uncertainty" ? " caution" : ""}`}>
        <p>{render(s.amount ? s.fullText ?? s.text : s.text)}</p>
        <Qualifiers s={{ ...s, basis: s.basis ? render(s.basis) : s.basis }} />
      </div>;
  // Either/or amounts are drawn as one block, joined by "or" and their note, at the place of the first of them: two
  // amounts for one person never sit side by side as if they added up.
  const blocks: React.ReactNode[] = [];
  const drawn = new Set<string>();
  for (const s of statements) {
    if (drawn.has(s.id)) continue;
    const g = s.group?.kind === "either_or" ? s.group : null;
    const members = g ? statements.filter((m) => m.group?.kind === "either_or" && m.group.id === g.id) : [];
    if (!g || members.length < 2) { blocks.push(one(s)); drawn.add(s.id); continue; }
    members.forEach((m) => drawn.add(m.id));
    blocks.push(<div key={"g-" + g.id} className="answer-either" data-testid="answer-either" role="group" aria-label="Alternative amounts, not a total">
      <p className="answer-either-note"><b>Either / or</b> {render(g.note)}</p>
      {members.map((m, i) => <Fragment key={m.id}>{i ? <div className="answer-either-or" aria-hidden="true"><span>or</span></div> : null}{one(m)}</Fragment>)}
    </div>);
  }
  return <div className="answer-cards">
    {bottomLine ? <p className="answer-bottom-line" data-testid="answer-bottom-line">{render(bottomLine)}</p> : null}
    {showSummary ? <p className="answer-point">{summary}</p> : null}
    {blocks}
    <WhereFrom statements={statements} citations={answer.citations} sources={sources} idFor={idFor} detailsRef={where} />
    {/* What the prose says that no statement covers stays in view, in its own words. */}
    {remaining.length ? <div className="answer-remaining" data-testid="answer-remaining"><b>Also in this answer</b>{remaining.map((s, i) => <p key={i}>{s}</p>)}</div> : null}
    {fullProse.length ? <details className="answer-full" data-testid="answer-full"><summary>Full answer</summary>{fullProse.map((t, i) => <p key={i}>{t}</p>)}</details> : null}
    {amounts ? <p className="answer-cards-foot">{illustrations ? "Illustrations" : "Amounts"} from your documents, not a payment or an insurer&rsquo;s decision.</p> : null}
  </div>;
}
