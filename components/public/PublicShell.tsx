import Link from "next/link";
import "./public-site.css";

/** The one line every public page ends with (marketing plan, section 3): what DearPolicy is and is not. */
export const PUBLIC_FOOTER_LINE =
  "DearPolicy explains what your own documents say. It is not financial advice and does not decide claims. Your insurer decides what is paid.";

/**
 * The frame for a signed-out visitor on a public page (the landing page at "/" and the Learn library): the logo, a
 * link to Learn, and the way in (sign in, create an account). It never shows the household menu, a sign-out button,
 * or anything that needs a session, and it calls no service. components/AppShell.tsx picks it only when middleware.ts
 * says the request has no session and the page is one of its public pages.
 */
export default function PublicShell({ children, onLearn }: { children: React.ReactNode; onLearn: boolean }) {
  return (
    <div className="public-shell" data-testid="public-shell">
      <a className="public-skip" href="#public-main">Skip to content</a>
      <header className="public-header">
        <Link className="public-brand" href="/" aria-label="DearPolicy home">
          <img className="brand-logo" src="/dearpolicy-logo.png" alt="DearPolicy" width={827} height={161} />
        </Link>
        <nav className="public-nav" aria-label="Main">
          <Link className={`public-nav-link${onLearn ? " active" : ""}`} href="/learn" aria-current={onLearn ? "page" : undefined}>Learn</Link>
          <Link className="public-nav-link" href="/login" data-testid="public-sign-in">Sign in</Link>
          <Link className="button primary compact" href="/signup" data-testid="public-sign-up">Create account</Link>
        </nav>
      </header>
      <main id="public-main" className="public-main" tabIndex={-1}>{children}</main>
      <footer className="public-footer">
        <p>{PUBLIC_FOOTER_LINE}</p>
        <p className="public-footer-links">
          <Link className="text-link" href="/learn">Learn the basics</Link>
          <span aria-hidden="true"> · </span>
          <Link className="text-link" href="/login">Sign in</Link>
          <span aria-hidden="true"> · </span>
          <Link className="text-link" href="/signup">Create account</Link>
        </p>
      </footer>
    </div>
  );
}
