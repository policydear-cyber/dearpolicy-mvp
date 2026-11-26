"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef } from "react";

/** A page that broke while it was showing, in DearPolicy's own words (not the browser's "Application error" page).
 * It says nothing was lost, offers one retry and a way back. The error itself is never shown to a household.
 * Try again refreshes from the server as well as the page, so a fault that was on the server and has since cleared recovers. */
export default function PageError({ reset }: { reset: () => void }) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <div className="page not-found" data-testid="page-error" role="alert">
    <h1 ref={heading} tabIndex={-1}>This page didn&rsquo;t load properly.</h1>
    <p className="lead">Your documents and answers are safe. Try again, and if it still doesn&rsquo;t work, go back to Home and open it from there.</p>
    <div className="not-found-actions">
      <button type="button" className="button primary" onClick={() => startTransition(() => { router.refresh(); reset(); })}>Try again</button>
      <Link className="button secondary" href="/">Back to Home</Link>
    </div>
  </div>;
}
