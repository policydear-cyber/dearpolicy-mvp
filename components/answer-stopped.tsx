import type { ChatAnswer } from "@/types";

/** The plain stops a turn ends with when it could not answer (lib/rag2/loop/loop.ts STOP texts): no statement, no
 * claim item, only the stop sentence. Matched on its opening words, since the answer carries no stop field. */
const STOPPED = /^(I couldn[’']t (finish|look that up)\b|I stopped before answering\b)/;
/** A stop a narrower question gets past: the per-question model-use or step limit. Anything else is asked again as is. */
const TOO_BIG = /limit set for (model use on )?a single question|more steps than the limit/;

export const isStopped = (answer: ChatAnswer | undefined, text: string | undefined) =>
  !!answer && !!text && STOPPED.test(text.trim()) && !answer.claimItems?.some((i) => i.status !== "not_applicable") && !answer.policyStatedLimits?.length;

/** The family members a question names, by full or first name. */
export const namedIn = (question: string, people: { id: string; name: string }[]) => {
  const has = (n: string) => !!n && new RegExp(`(^|[^\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "iu").test(question);
  return people.filter((p) => has(p.name) || has(p.name.split(/\s+/)[0]));
};

/** A stop drawn as a stop, never as an answer: what happened in a few words, the stop's own sentence underneath, and
 * one tap to put a narrower question (or the same one again) in the message box. Nothing is sent until the person
 * sends it. */
export function StoppedNotice({ text, question, people, onAsk }: { text: string; question?: string; people: { id: string; name: string }[]; onAsk: (text: string, memberId?: string) => void }) {
  const tooBig = TOO_BIG.test(text);
  const q = question?.trim() ?? "";
  // Like the stop's own hint (PR #79), splitting is offered only to a question about several people or nobody named; a
  // question already about one person gets the same question again.
  const split = tooBig && people.length > 1 && namedIn(q, people).length !== 1;
  return <div className="answer-stopped" data-testid="answer-stopped" role="status">
    <p className="answer-stopped-title">{tooBig ? "This question reached its limit" : "DearPolicy stopped before answering"}</p>
    <p className="answer-stopped-why">{text}</p>
    {q ? <div className="answer-stopped-actions">
      {split
        ? people.map((p) => <button key={p.id} type="button" className="mini-button" onClick={() => onAsk(`About ${p.name} only: ${q}`, p.id)}>Ask about {p.name}</button>)
        : <button type="button" className="mini-button" onClick={() => onAsk(q)}>Ask again</button>}
    </div> : null}
  </div>;
}
