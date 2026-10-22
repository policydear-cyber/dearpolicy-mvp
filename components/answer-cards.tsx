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

/** The content words of a sentence (amounts kept), for telling when one sentence only says another again in other words. */
const STOP = new Set("a an and are as at be by for from her his if in is it its of on or so the their this to was were with your you".split(" "));
const words = (s: string) => norm(s).split(/[^a-z0-9$,.%]+/).map((w) => w.replace(/[.,]+$/, "")).filter((w) => w && !STOP.has(w));
const NEGATION = /\b(not|no|never|none|nobody|nothing|dont|doesnt|didnt|isnt|arent|wasnt|werent|cant|cannot|wont|wouldnt|hasnt|havent|couldnt|shouldnt|mustnt|neither|nor)\b/;
const LIMITS = new Set("only unless except excluded exclusion without until after before".split(" "));
/** Whether most of `part`'s words are already in `whole`: a restatement, not new information. A figure (any word with
 * a digit) that `whole` does not have always makes it new. */
const restates = (part: string, whole: string, share = 0.7) => {
  const p = words(part), w = new Set(words(whole));
  if (p.some((x) => /\d/.test(x) && !w.has(x))) return false;
  // Nor is it when one says no or not and the other doesn't, or one carries a limit (only, unless, until…) the other lacks.
  const all = words(whole);
  if (NEGATION.test(p.join(" ")) !== NEGATION.test(all.join(" "))) return false;
  if ([...p.filter((x) => LIMITS.has(x) && !w.has(x)), ...all.filter((x) => LIMITS.has(x) && !p.includes(x))].length) return false;
  return p.length > 0 && p.filter((x) => w.has(x)).length / p.length >= share;
};

/** Sentences of the prose, split only at a full stop, ! or ? followed by a capital or an opening quote. */
const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z“"(])/).map((s) => s.trim()).filter(Boolean);

/** What a card or point says, beyond its short text: its own basis, conditions and any limit the source notes. */
/** Each line is shown once: a basis the card's sentence already states, or a note that repeats one of its conditions,
 * is not drawn twice. A point's source note (background, not a limit on an amount) stays in "Where this comes from". */
/** A condition's closing clause that only repeats the footer under every amount ("…; an illustration from the
 * document's terms, not a payment or an insurer's decision") is not drawn on each card. */
const withoutFooterClause = (c: string) => c.replace(/;\s*[^;]*\bnot a payment or an insurer[’']s decision\.?\s*$/i, ".");

function Qualifiers({ s }: { s: AnswerStatement }) {
  const said = norm(s.text);
  const conditions = (s.conditions ?? []).map(norm);
  const basis = s.basis && !said.includes(norm(s.basis)) && !restates(s.basis, s.text, 0.75) ? s.basis : null;
  const note = s.amount && s.source?.note && !conditions.some((c) => c === norm(s.source!.note!) || c.includes(norm(s.source!.note!))) ? s.source.note : null;
  return <>
    {basis ? <p className="answer-card-basis">{basis}</p> : null}
    {s.conditions?.length ? <ul className="answer-card-conditions">{s.conditions.map((c, i) => <li key={i}>{s.amount ? withoutFooterClause(c) : c}</li>)}</ul> : null}
    {note ? <p className="answer-card-note" data-testid="answer-card-note">{note}</p> : null}
  </>;
}

/** An amount card: whose it is, the figure, the condition it depends on, its own basis and conditions, and where it
 * comes from as a chip. Nothing that limits the amount moves off its card. */
function AmountCard({ s, openSource }: { s: AnswerStatement; openSource: (id: string) => void }) {
  const a = s.amount!;
  // A benefit's printed terms are not worked out for this event: drawn quieter, never as a figure for the case.
  const printed = s.kind === "benefit_terms";
  return <div className={`answer-card${printed ? " printed" : ""}`} data-testid="answer-card">
    {s.personName ? <p className="answer-card-person" data-testid="answer-card-person">For {s.personName}</p> : null}
    <div className="answer-card-amount">
      <strong>{a.text}</strong>
      {/* No label under the figure ("illustration", "printed amount", "currency not stated"): the footer says what every
          amount is, and "Where this comes from" says when a document prints a bare "$". */}
    </div>
    {/* With no conditions[] from the server, the whole checked sentence stays on the card; it is never cut client-side. */}
    {!s.conditions?.length && s.fullText && norm(s.fullText) !== norm(s.text) ? <p className="answer-card-condition" data-testid="answer-card-condition">{s.fullText}</p> : null}
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
export function AnswerCards({ answer, render, sources, prose = [], after }: { answer: StructuredAnswer; render: (text: string) => string; sources?: React.ReactNode; prose?: string[]; after?: React.ReactNode }) {
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
  // A sentence that only says the bottom line again in other words, says that drawn either/or amounts are alternatives,
  // or is one of the next steps shown under the answer, is not repeated; the full answer still has every word.
  const eitherDrawn = statements.filter((s) => s.group?.kind === "either_or").length > 1;
  const steps = (answer.nextSteps ?? []).map((t) => norm(render(t)));
  // Against the bottom line a sentence is hidden only when it adds no word at all (Critic R48-1): "…if admitted",
  // "…subject to approval" or "…once discharged" all stay.
  const repeats = (s: string) => (!!bottomLine && restates(s, render(bottomLine), 1))
    || (eitherDrawn && /\b(alternatives?|never (added|both)|not a total)\b/i.test(s) && s.length < 90)
    // A sentence that adds anything to a step (a condition, a deadline, a warning) is kept.
    || steps.some((t) => t === norm(s) || restates(s, t, 0.8));
  const remaining = [...new Set(prose.map(render).flatMap(sentences).filter((s) => !isCovered(s) && !alreadyShown.has(norm(s)) && !repeats(s)))];
  // An answer with no amount whose points are still to confirm: the bottom line is marked so, not drawn like a finding.
  const illustrations = statements.some((s) => s.amount?.illustration);
  const amounts = statements.some((s) => s.amount);
  const fullProse = prose.map(render).filter((t) => t.trim());
  // A point's sentence that the bottom line already says in bold is not said again underneath it.
  const pointText = (s: AnswerStatement) => {
    const full = render(s.amount ? s.fullText ?? s.text : s.text);
    const kept = sentences(full).filter((x) => !alreadyShown.has(norm(x)));
    return kept.length === sentences(full).length ? full : kept.join(" ");
  };
  const one = (s: AnswerStatement) => {
    if (asCard(s)) return <AmountCard key={s.id} openSource={openSource} s={{ ...s, text: render(s.text), fullText: render(s.fullText ?? ""), basis: s.basis ? render(s.basis) : s.basis }} />;
    const text = pointText(s);
    if (!text && !s.basis && !s.conditions?.length) return null;
    return <div key={s.id} className={`answer-point${s.kind === "uncertainty" ? " caution" : ""}`}>
      {text ? <p>{text}</p> : null}
      <Qualifiers s={{ ...s, basis: s.basis ? render(s.basis) : s.basis }} />
    </div>;
  };
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
    // The answer's own statement that these are alternatives heads the block (and is not drawn again); without one, the group's note does.
    const head = statements.find((u) => u.kind === "uncertainty" && !members.includes(u) && !blocks.some((b) => (b as { key?: string } | null)?.key === "g-" + u.id) && /\balternatives?\b|\bnot a total\b|\beither\b/i.test(u.text));
    if (head) { drawn.add(head.id); const at = blocks.findIndex((b) => (b as { key?: string } | null)?.key === head.id); if (at >= 0) blocks.splice(at, 1); }
    // A condition every option carries is said once, above them, not repeated on each card.
    const shared = (members[0].conditions ?? []).filter((c) => members.every((m) => (m.conditions ?? []).some((d) => norm(d) === norm(c))));
    const own = (m: AnswerStatement) => shared.length ? { ...m, conditions: (m.conditions ?? []).filter((c) => !shared.some((x) => norm(x) === norm(c))) } : m;
    // When the bottom line already says these are alternatives, the block's label is enough.
    const noteText = render(head ? head.text : g.note);
    const saidAbove = !!bottomLine && /\balternatives?\b|\beither\b/i.test(bottomLine);
    blocks.push(<div key={"g-" + g.id} className="answer-either" data-testid="answer-either" role="group" aria-label="Alternative amounts, not a total">
      <p className="answer-either-note"><b>Either / or</b>{saidAbove ? null : <> {noteText}</>}</p>
      {shared.length ? <p className="answer-either-shared" data-testid="answer-either-shared"><b>Both options:</b> {shared.map((c) => render(withoutFooterClause(c))).join(" ")}</p> : null}
      {members.map((m, i) => <Fragment key={m.id}>{i ? <div className="answer-either-or" aria-hidden="true"><span>or</span></div> : null}{one(own(m))}</Fragment>)}
    </div>);
  }
  return <div className="answer-cards">
    {bottomLine ? <p className="answer-bottom-line" data-testid="answer-bottom-line">{render(bottomLine)}</p> : null}
    {showSummary ? <p className="answer-point">{summary}</p> : null}
    {blocks}
    {/* What the prose says that no statement covers stays in view, in its own words. */}
    {remaining.length ? <div className="answer-remaining" data-testid="answer-remaining"><b>Also in this answer</b>{remaining.map((s, i) => <p key={i}>{s}</p>)}</div> : null}
    {/* What to do next sits with the answer, above the collapsed detail. */}
    {after}
    <div className="answer-more">
      <WhereFrom statements={statements} citations={answer.citations} sources={sources} idFor={idFor} detailsRef={where} />
      {fullProse.length ? <details className="answer-full" data-testid="answer-full"><summary>Full answer</summary>{fullProse.map((t, i) => <p key={i}>{t}</p>)}</details> : null}
    </div>
    {amounts ? <p className="answer-cards-foot">{illustrations ? "Illustrations" : "Amounts"} from your documents, not a payment or an insurer&rsquo;s decision.</p> : null}
  </div>;
}
