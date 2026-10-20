/** Two or more amounts the household's cover gives for the same row (often two bases inside one policy, sometimes two documents): alternatives, never a total, and the insurer decides
 * which applies. The same object arrives on every member row (Coverage rows from GET /api/ledger, Benefits rows from
 * GET /api/benefits/index), so each page draws the joined row wherever the person or plan appears. Shape:
 * /mnt/project-files/ux-design/coverage-alternatives-shape.md. */
export type AlternativeAmounts = {
  groupId: string;
  note: string;
  options: {
    rowId: string;
    amountText: string;
    basis: string;
    documentName: string;
    policyId: string | null;
    page: number | null;
    asOf?: string | null;
    conditions: string[];
  }[];
};

/** Only a complete group is drawn: one option alone would read as the answer. */
export const hasAlternatives = (a: AlternativeAmounts | null | undefined): a is AlternativeAmounts =>
  !!a && Array.isArray(a.options) && a.options.length >= 2;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const asOfText = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `as of ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : `as of ${iso}`; };

export function AlternativeAmountsBlock({ alternatives, rowId }: { alternatives: AlternativeAmounts; rowId: string }) {
  return <div className="answer-either alt-amounts" data-testid="alternative-amounts" role="group" aria-label="Alternative amounts, not a total">
    <p className="answer-either-note alt-label"><b>Either / or</b></p>
    {alternatives.options.map((o, i) => {
      const own = o.rowId === rowId;
      return <div key={o.rowId} className="alt-option-wrap">
        {i ? <div className="answer-either-or" aria-hidden="true"><span>or</span></div> : null}
        <div className={`alt-option${own ? " own" : ""}`} aria-current={own ? "true" : undefined}>
          <div className="alt-figure"><strong>{o.amountText}</strong><span>{o.basis}</span></div>
          <div className="alt-source">
            {o.policyId ? <a href={`/policies#doc-${o.policyId}`}>{o.documentName}{o.page != null ? ` · p.${o.page}` : ""}</a> : <span>{o.documentName}{o.page != null ? ` · p.${o.page}` : ""}</span>}
            {o.asOf ? <span>{asOfText(o.asOf)}</span> : null}
            {own ? <span className="alt-own">this plan</span> : null}
          </div>
          {o.conditions.length ? <p className="alt-conditions">{o.conditions.join(" · ")}</p> : null}
        </div>
      </div>;
    })}
    <p className="alt-note">{alternatives.note}</p>
  </div>;
}
