import Link from "next/link";
import { headers } from "next/headers";

export const metadata = { title: "Page not found · DearPolicy" };

/** A missing page in DearPolicy's own words, with a way back: to the Portfolio when signed in, otherwise to the
 * landing page and the Learn library (middleware.ts's session hint; it only picks the links). */
export default async function NotFound() {
  if ((await headers()).get("x-dearpolicy-signed-in") === "0") return <div className="page not-found">
    <div className="eyebrow">PAGE NOT FOUND</div>
    <h1>We couldn&rsquo;t find that page.</h1>
    <p className="lead">The link may be old, or the page may have moved.</p>
    <div className="not-found-actions">
      <Link className="button primary" href="/">Go to the home page</Link>
      <Link className="button secondary" href="/learn">Browse the guides</Link>
    </div>
  </div>;
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
