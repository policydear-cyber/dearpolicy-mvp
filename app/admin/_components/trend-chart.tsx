/**
 * A 30-day bar chart for the admin console, drawn on the server as SVG (no chart library, no client code).
 * One series per chart, so no legend: the title names it. Bars are the brand ink; every bar has a hover title and the
 * same numbers are in a table under "Show the numbers", so nothing is told by the picture alone.
 */
import { day } from "@/lib/admin/format";

type Props = {
  title: string;
  /** The headline beside the title, e.g. "12 in 30 days". */
  summary: string;
  days: string[];
  values: number[] | null;
  format?: (v: number) => string;
  /** Shown instead of the chart when the series isn't available. */
  unavailable?: string;
  testId?: string;
};

// Bars only inside the SVG (it stretches to the panel's width); every word is HTML, so text never scales or squashes.
const W = 600, H = 140, PAD_L = 0, PAD_R = 0, PAD_T = 2, PAD_B = 0;

export function TrendChart({ title, summary, days, values, format = (v) => v.toLocaleString(), unavailable, testId }: Props) {
  if (!values) {
    return (
      <section className="admin-panel admin-chart" data-testid={testId}>
        <header className="admin-panel-head"><h3>{title}</h3></header>
        <p className="muted admin-chart-empty">{unavailable ?? "Not available yet."}</p>
      </section>
    );
  }
  const max = Math.max(...values, 0);
  const top = max > 0 ? max : 1;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const slot = plotW / values.length;
  const barW = Math.max(2, slot - 2); // 2px surface gap between bars
  const label = `${title}: ${summary}. Highest day ${format(max)}.`;
  return (
    <section className="admin-panel admin-chart" data-testid={testId}>
      <header className="admin-panel-head">
        <h3>{title}</h3>
        <strong className="admin-chart-summary">{summary}</strong>
      </header>
      <div className="admin-axis-top" aria-hidden="true">{format(max)}</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="admin-chart-svg" preserveAspectRatio="none">
        <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T} y2={PAD_T} className="admin-grid" vectorEffect="non-scaling-stroke" />
        <line x1={PAD_L} x2={W - PAD_R} y1={H - PAD_B} y2={H - PAD_B} className="admin-baseline" vectorEffect="non-scaling-stroke" />
        {values.map((v, i) => {
          const h = v > 0 ? Math.max(2, (v / top) * plotH) : 0;
          const x = PAD_L + i * slot + (slot - barW) / 2;
          return (
            <g key={days[i]} className="admin-bar-group">
              <title>{`${day(days[i])}: ${format(v)}`}</title>
              <rect x={PAD_L + i * slot} y={PAD_T} width={slot} height={plotH} className="admin-bar-hit" />
              {h > 0 && <rect x={x} y={H - PAD_B - h} width={barW} height={h} className="admin-bar" />}
            </g>
          );
        })}
      </svg>
      <div className="admin-axis-row" aria-hidden="true"><span>{day(days[0])}</span><span>{day(days[days.length - 1])}</span></div>
      <details className="admin-chart-table">
        <summary>Show the numbers</summary>
        <table className="admin-table">
          <thead><tr><th>Day</th><th>{title}</th></tr></thead>
          <tbody>{[...values].map((v, i) => ({ v, d: days[i] })).reverse().map(({ v, d }) => <tr key={d}><td>{day(d)}</td><td>{format(v)}</td></tr>)}</tbody>
        </table>
      </details>
    </section>
  );
}
