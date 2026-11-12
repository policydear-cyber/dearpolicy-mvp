import type { LearnBlock, LearnDiagram, LearnSource, LearnTile } from "@/lib/learn/content";
import { Pictogram } from "@/components/learn/pictogram";
import { BillSplitTry, PercentOfSumTry, Quiz } from "@/components/learn/try-it";

/** Renders one library block. Words come from lib/learn/content.ts; pictures are self-made SVG. Static, no data. */

function Tiles({ tiles, className }: { tiles: LearnTile[]; className: string }) {
  return (
    <ul className={className}>
      {tiles.map((tile) => (
        <li key={tile.title}>
          <Pictogram icon={tile.icon} />
          <div><strong>{tile.title}</strong><span>{tile.text}</span></div>
        </li>
      ))}
    </ul>
  );
}

function Diagram({ diagram }: { diagram: LearnDiagram }) {
  void diagram; // only "lowest-limit" so far
  // lowest-limit: three limits as bars; the shortest one is the one that counts.
  const rows = [
    { label: "Per-year limit", width: 100, counts: false },
    { label: "Per-event limit", width: 70, counts: false },
    { label: "Sub-limit for this item", width: 38, counts: true },
  ];
  return (
    <ul className="ld-limits">
      {rows.map((row) => (
        <li key={row.label} className={row.counts ? "is-counting" : ""}>
          <span>{row.label}{row.counts ? <b> · this one counts</b> : null}</span>
          <i style={{ width: `${row.width}%` }} />
        </li>
      ))}
    </ul>
  );
}

/** The small source tag after a fact: links to the article's numbered source list. */
function SourceTag({ index, sources }: { index: number; sources?: LearnSource[] }) {
  const source = sources?.[index];
  if (!source) return null;
  return <a className="lf-src" href={`#source-${index + 1}`} aria-label={`Source ${index + 1}: ${source.label}`}>[{index + 1}]</a>;
}

export function LearnBlockView({ block, sources }: { block: LearnBlock; sources?: LearnSource[] }) {
  switch (block.kind) {
    case "p": return <p>{block.text}</p>;
    case "example": return <p className="learn-example" data-testid="learn-example">{block.text}</p>;
    case "list": return <ul>{block.items.map((item, j) => <li key={j}>{item}</li>)}</ul>;
    case "tiles": return (
      <figure className="learn-figure" data-testid="learn-tiles">
        <Tiles tiles={block.tiles} className="learn-tiles" />
        <figcaption>{block.caption}</figcaption>
      </figure>
    );
    case "steps": return (
      <figure className="learn-figure" data-testid="learn-steps">
        <ol className="learn-steps">
          {block.steps.map((step, i) => (
            <li key={step.title}>
              <span className="ls-num" aria-hidden="true">{i + 1}</span>
              <Pictogram icon={step.icon} size={40} />
              <div><strong>{step.title}</strong><span>{step.text}</span></div>
            </li>
          ))}
        </ol>
        <figcaption>{block.caption}</figcaption>
      </figure>
    );
    case "flow": return (
      <figure className="learn-figure" data-testid="learn-flow">
        <Tiles tiles={block.items} className="learn-flow" />
        <figcaption>{block.caption}</figcaption>
      </figure>
    );
    case "diagram": return (
      <figure className="learn-figure" data-testid="learn-diagram">
        <Diagram diagram={block.diagram} />
        <figcaption>{block.caption}</figcaption>
      </figure>
    );
    case "cards": return (
      <div className="learn-cards-block" data-testid="learn-cards">
        <p className="lc-prompt">{block.prompt}</p>
        <div className="learn-cards">
          {block.cards.map((card) => (
            <details className="learn-flip" key={card.front}>
              <summary><span>{card.front}</span><em aria-hidden="true">Tap to see</em></summary>
              <p>{card.back}</p>
            </details>
          ))}
        </div>
      </div>
    );
    case "layers": return (
      <figure className="learn-figure" data-testid="learn-layers">
        <ol className="learn-layers">
          {block.layers.map((layer, i) => (
            <li key={layer.title} style={{ marginInline: `${(block.layers.length - 1 - i) * 4}%` }}>
              <Pictogram icon={layer.icon} size={40} />
              <div><strong>{layer.title}</strong><span>{layer.text}</span></div>
            </li>
          ))}
        </ol>
        <figcaption>{block.caption}</figcaption>
      </figure>
    );
    case "fact": return <p className="learn-fact" data-testid="learn-fact">{block.text} <SourceTag index={block.source} sources={sources} /></p>;
    case "table": return (
      <figure className="learn-figure" data-testid="learn-table">
        <table className="learn-table">
          <caption>{block.caption} <SourceTag index={block.source} sources={sources} /></caption>
          <thead><tr>{block.head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>{block.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>)}</tr>)}</tbody>
        </table>
      </figure>
    );
    case "quiz": return <Quiz question={block.question} options={block.options} answer={block.answer} explain={block.explain} />;
    case "bill-split": return <BillSplitTry />;
    case "percent-of-sum": return <PercentOfSumTry />;
    default: { const unknown: never = block; void unknown; return null; }
  }
}
