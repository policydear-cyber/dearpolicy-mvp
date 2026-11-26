"use client";

import Link from "next/link";

/** A page that broke while it was showing, in DearPolicy's own words (not the browser's "Application error" page).
 * It says nothing was lost, offers one retry and a way back. The error itself is never shown to a household. */
export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="page not-found" data-testid="page-error" role="alert">
    <h1>This page didn&rsquo;t load properly.</h1>
    <p className="lead">Your documents and answers are safe. Try again, and if it still doesn&rsquo;t work, go back to Home and open it from there.</p>
    <div className="not-found-actions">
      <button type="button" className="button primary" onClick={() => reset()}>Try again</button>
      <Link className="button secondary" href="/">Back to Home</Link>
    </div>
  </div>;
}
