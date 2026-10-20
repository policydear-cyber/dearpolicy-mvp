/** What the chat shows while an answer is being worked out (usually 20 seconds to a minute).
 *
 * Honest by construction: a step is named only when the server reported it. Today the answer path reports no stages, so
 * the person sees one steady line, a calm moving bar and the elapsed time, and after a minute a plain note that it is
 * taking longer and the answer is saved to this chat either way. When the server sends `stageId`
 * (/mnt/project-files/ux-design/answer-progress-shape.md), the four steps are listed with the current one marked. */
export const ANSWER_STAGES = [
  { id: "finding", label: "Finding the policies that apply" },
  { id: "reading", label: "Reading the pages that matter" },
  { id: "checking", label: "Checking the amounts and conditions" },
  { id: "writing", label: "Writing your answer" },
] as const;
export type AnswerStageId = (typeof ANSWER_STAGES)[number]["id"];
export const isAnswerStage = (id: unknown): id is AnswerStageId => ANSWER_STAGES.some((s) => s.id === id);

const clock = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);

export function AnswerWait({ label, stageId, detail, elapsed, queued }: {
  /** A stage line the server reported (older answer path), or "" when it reported none. */
  label: string;
  stageId: AnswerStageId | null;
  detail: { completed: number; total: number } | null;
  elapsed: number;
  /** The server has the question but has not started on it yet. */
  queued: boolean;
}) {
  const current = stageId ? ANSWER_STAGES.findIndex((s) => s.id === stageId) : -1;
  // With steps listed, the current one is marked in the list, so the heading stays general rather than saying it twice.
  const head = current >= 0 ? "Working on your answer" : label || (queued && elapsed >= 3 ? "Starting on your question" : "Working on your answer");
  return <div className="message-body thinking" role="status" aria-live="polite" data-testid="answer-wait">
    <div className="thinking-head"><span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span><strong>{head}</strong></div>
    {current >= 0 ? <ol className="answer-steps" aria-label="Progress">{ANSWER_STAGES.map((s, i) =>
      <li key={s.id} className={i < current ? "done" : i === current ? "current" : ""} aria-current={i === current ? "step" : undefined}>{s.label}</li>)}</ol>
      : <div className={"thinking-bar " + (detail ? "determinate" : "indeterminate")}>
        <span style={detail ? { width: Math.max(4, Math.round((detail.completed / Math.max(1, detail.total)) * 100)) + "%" } : undefined} />
      </div>}
    {/* The clock is announced only in text that is read on demand, not every second. */}
    <small aria-live="off"><span className="answer-wait-clock">{clock(elapsed)}</span>{elapsed < 60 ? " · usually under a minute" : ""}</small>
    {elapsed >= 60 ? <p className="thinking-note">Taking longer than usual. You can leave this page: the answer is saved to this chat when it is ready.</p> : null}
  </div>;
}
