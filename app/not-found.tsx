import Link from "next/link";

/** A missing page in DearPolicy's own words, with a way back. */
export default function NotFound() {
  return <div className="page not-found">
    <div className="eyebrow">PAGE NOT FOUND</div>
    <h1>We couldn&rsquo;t find that page.</h1>
    <p className="lead">The link may be old, or the page may have moved.</p>
    <div className="not-found-actions">
      <Link className="button primary" href="/">Back to your portfolio</Link>
      <Link className="button secondary" href="/chat">Ask DearPolicy</Link>
    </div>
  </div>;
}
