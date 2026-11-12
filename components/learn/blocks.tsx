import type { LearnBlock, LearnDiagram, LearnTile } from "@/lib/learn/content";
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

export function LearnBlockView({ block }: { block: LearnBlock }) {
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
    case "quiz": return <Quiz question={block.question} options={block.options} answer={block.answer} explain={block.explain} />;
    case "bill-split": return <BillSplitTry />;
    case "percent-of-sum": return <PercentOfSumTry />;
  }
}
