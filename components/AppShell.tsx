"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";


const icon = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  family: <><circle cx="9" cy="8" r="3.5" /><circle cx="17" cy="9.5" r="2.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M15.5 20a5 5 0 0 1 6 0" /></>,
  documents: <><path d="M6 3h8l5 5v13H6z" /><path d="M14 3v5h5" /><path d="M9 13h7M9 17h7" /></>,
  payments: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10.5h18" /><path d="M7 15h4" /></>,
  benefits: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16M4 15h16M10 4v16" /></>,
  ledger: <><path d="M5 4h14v16H5z" /><path d="M9 9l1.5 1.5L13 8" /><path d="M9 14.5l1.5 1.5L13 13.5" /><path d="M15 9.5h1.5M15 15h1.5" /></>,
  claims: <><path d="M12 3 4 6.5v5.5c0 4.5 3.4 7.8 8 9 4.6-1.2 8-4.5 8-9V6.5z" /><path d="M12 9v4" /><path d="M12 16.5h.01" /></>,
  ask: <><path d="M12 4c4.4 0 8 3 8 6.8s-3.6 6.8-8 6.8c-.9 0-1.8-.1-2.6-.4L5 19l.9-3.4C4.7 14.4 4 12.7 4 10.8 4 7 7.6 4 12 4z" /></>,
  usage: <><path d="M12 3a9 9 0 1 0 9 9h-9z" /><path d="M14 3.2A9 9 0 0 1 20.8 10H14z" /></>,
  household: <><path d="M4 11 12 4l8 7" /><path d="M6 10v9h12v-9" /><path d="M10 19v-5h4v5" /></>,
  more: <><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>,
};
type IconName = keyof typeof icon;
function NavIcon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {icon[name]}
    </svg>
  );
}

/** `tab` places an item in the phone's bottom bar (in that order, Ask in
 * the middle where the thumb rests); every other item sits under "More".
 * Eight tabs never fit a phone, and the ones that scrolled off the edge
 * included Ask DearPolicy itself. */
type NavItem = { href: string; label: string; icon: IconName; tab?: number; short?: string };
const nav: NavItem[] = [
  { href: "/", label: "Portfolio", icon: "home", tab: 1 },
  { href: "/family", label: "Family", icon: "family" },
  { href: "/policies", label: "Documents", icon: "documents", tab: 2 },
  { href: "/records", label: "Payments", icon: "payments" },
  { href: "/ledger", label: "Coverage", icon: "ledger", tab: 4 },
  { href: "/schedule", label: "Benefits", icon: "benefits" },
  { href: "/claims", label: "Claims", icon: "claims" },
  { href: "/chat", label: "Ask DearPolicy", icon: "ask", tab: 3, short: "Ask" },
  { href: "/household", label: "Household", icon: "household" },
];

/** DearPolicy's operator area (diagnostics, extraction review, model usage
 * and cost). Never part of household navigation; the area itself refuses
 * anyone who is not an active DearPolicy staff account (app/operator/layout.tsx). */
const operatorNav: NavItem[] = [
  { href: "/operator", label: "Overview", icon: "usage" },
  { href: "/operator/documents", label: "Document processing", icon: "documents" },
  { href: "/operator/benefits", label: "Benefit extraction", icon: "benefits" },
  { href: "/operator/coverage", label: "Coverage rows", icon: "ledger" },
  { href: "/", label: "Back to household", icon: "home" },
];

/** Pages a signed-out person uses; no sign-out control there. */
const SIGNED_OUT_PATHS = new Set(["/login", "/signup", "/reset-password"]);
/** Signed in, but with no household to navigate. */
const NO_NAV_PATHS = new Set(["/household/deleted"]);

/** Ends the Supabase session on the server (which clears the session
 * cookie), then leaves for the sign-in page. Navigates even if the request
 * fails, so the person is never left looking at a page they believe they
 * have left; the next request re-checks the session regardless. */
function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    try { await fetch("/api/auth/signout", { method: "POST" }); } catch { /* navigate anyway */ }
    router.push("/login");
    router.refresh();
  };
  return (
    <button type="button" className="theme-toggle sign-out" onClick={signOut} disabled={busy} aria-busy={busy}>
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}

type Theme = "light" | "dark";
function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const dark = theme === "dark";
  return (
    <button type="button" className="theme-toggle" onClick={onToggle} aria-pressed={dark} aria-label={dark ? "Switch to light appearance" : "Switch to dark appearance"}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {dark ? <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>}
      </svg>
      {dark ? "Dark" : "Light"}
    </button>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Light is the brand default. The person's choice is kept in this browser
  // and applied before first paint by the small script in layout.tsx.
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    try { const saved = localStorage.getItem("dearpolicy-theme"); if (saved === "dark" || saved === "light") setTheme(saved); } catch {}
  }, []);
  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("dearpolicy-theme", next); } catch {}
  };
  // Households are never shown database, search, model or queue status: that
  // is the operator's view (/operator). The only thing a household needs to
  // know is whether DearPolicy can be reached at all.
  const [unreachable, setUnreachable] = useState(false);
  const [hosted, setHosted] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!cancelled) { setUnreachable(false); if (typeof payload.hosted === "boolean") setHosted(payload.hosted); }
      } catch {
        if (!cancelled) setUnreachable(true);
      }
    };
    void check();
    const timer = setInterval(() => void check(), 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  // The internal reviewer area is a DearPolicy staff tool, not part of any
  // household: it gets its own single-item navigation, never the household's.
  const reviewerArea = pathname.startsWith("/reviewer");
  const signedOutPage = SIGNED_OUT_PATHS.has(pathname);
  const operatorArea = pathname === "/operator" || pathname.startsWith("/operator/");
  // Signed-out pages (sign-in, sign-up, password reset) and the page shown
  // after a household is deleted get no app navigation: every link would
  // only bounce to sign-in or fail for want of a household.
  const noNav = signedOutPage || NO_NAV_PATHS.has(pathname);
  const items: NavItem[] = noNav ? [] : reviewerArea ? [{ href: "/reviewer", label: "Assigned reviews", icon: "claims" }] : operatorArea ? operatorNav : nav;
  const isActive = (href: string) => href === "/" || href === "/operator" ? pathname === href : pathname.startsWith(href);
  // Only the household navigation is too long for a phone's bottom bar.
  const tabbed = items.some((item) => item.tab);
  const moreItems = tabbed ? items.filter((item) => !item.tab) : [];
  const moreActive = moreItems.some((item) => isActive(item.href));
  const [moreOpen, setMoreOpen] = useState(false);
  // Each tab names its page ("Documents · DearPolicy"), so several open tabs
  // and the browser history can be told apart. React places <title> in the head.
  const titled = [...items].sort((a, b) => b.href.length - a.href.length).find((item) => item.href !== "/" && isActive(item.href))
    ?? (pathname === "/" && items.length ? items[0] : null);
  const ownTitles: Record<string, string> = { "/login": "Sign in", "/signup": "Create your household", "/reset-password": "Reset password" };
  const pageName = ownTitles[pathname] ?? titled?.label;
  const pageTitle = pageName ? `${pageName} · DearPolicy` : "DearPolicy";
  useEffect(() => { setMoreOpen(false); }, [pathname]);
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMoreOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);
  return (
    <div className={`app-shell${noNav ? " no-nav" : ""}`}>
      <title>{pageTitle}</title>
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="DearPolicy home">
          <img className="brand-logo" src="/dearpolicy-logo.png" alt="DearPolicy" width={827} height={161} />
        </Link>
        <nav className={`nav${noNav ? " nav-empty" : ""}${tabbed ? " nav-tabbed" : ""}`} aria-hidden={noNav || undefined}>
          {reviewerArea && <div className="eyebrow">Reviewer area</div>}
          {operatorArea && <div className="eyebrow">Operator area</div>}
          {items.map((item) => {
            const active = isActive(item.href);
            return (
              <Link className={`nav-item${active ? " active" : ""}${item.tab ? " nav-tab" : " nav-more-item"}${item.href === "/chat" ? " nav-ask" : ""}`} style={item.tab ? { "--tab": item.tab } as React.CSSProperties : undefined} href={item.href} key={item.href} aria-current={active ? "page" : undefined}>
                <span className="nav-icon"><NavIcon name={item.icon} /></span>
                {item.short ? <><span className="nav-label-full">{item.label}</span><span className="nav-label-short" aria-hidden="true">{item.short}</span></> : item.label}
              </Link>
            );
          })}
          {tabbed && <button type="button" className={`nav-item nav-more-toggle${moreActive ? " active" : ""}`} aria-expanded={moreOpen} aria-controls="nav-more-sheet" onClick={() => setMoreOpen((open) => !open)}>
            <span className="nav-icon"><NavIcon name="more" /></span>More
          </button>}
        </nav>
        {tabbed && moreOpen && <>
          <div className="nav-more-backdrop" onClick={() => setMoreOpen(false)} aria-hidden="true" />
          <div className="nav-more-sheet" id="nav-more-sheet" role="menu" aria-label="More pages">
            {moreItems.map((item) => {
              const active = isActive(item.href);
              return (
                <Link role="menuitem" className={`nav-more-link${active ? " active" : ""}`} href={item.href} key={item.href} aria-current={active ? "page" : undefined} onClick={() => setMoreOpen(false)}>
                  <span className="nav-icon"><NavIcon name={item.icon} /></span>{item.label}
                </Link>
              );
            })}
          </div>
        </>}
        <div className="sidebar-footer">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          {!signedOutPage && <SignOutButton />}
          {unreachable && (
            <div className="service-fix" role="status">
              <p>DearPolicy can&rsquo;t be reached right now. Check your connection, then refresh the page.</p>
            </div>
          )}
          <div className="privacy-pill">{hosted ? "Hosted & encrypted" : "Local-first"}</div>
          <p>{hosted
            ? "Your documents and questions are kept private to your household."
            : "Your documents and questions stay on this computer."}</p>
        </div>
      </aside>
      <main className="main-content">
        <div className="mobile-bar">
          <Link href="/" aria-label="DearPolicy home"><img className="brand-logo" src="/dearpolicy-logo.png" alt="DearPolicy" width={827} height={161} /></Link>
          <div className="mobile-bar-actions">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            {!signedOutPage && <SignOutButton />}
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
