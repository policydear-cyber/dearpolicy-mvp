"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearHouseholdDeviceMemory } from "@/components/device-memory";
import { Icon, type IconName } from "@/components/icons";


function NavIcon({ name }: { name: IconName }) {
  return <Icon name={name} />;
}

/** `tab` places an item in the phone's bottom bar (in that order, Ask in
 * the middle where the thumb rests); every other item sits under "More".
 * Eight tabs never fit a phone, and the ones that scrolled off the edge
 * included Ask DearPolicy itself. */
type NavItem = { href: string; label: string; icon: IconName; tab?: number; short?: string; also?: string[] };
/** Five places a household goes, plus Account settings. Coverage (/ledger) and Benefits (/schedule) are not in the
 * menu: Portfolio answers "what is each of us covered for" and links to both ("Coverage, by person", "Benefits, by
 * policy"), as do its cover pages, so they count as Portfolio. Account settings opens on People (the family and who
 * can sign in), which every member can use; Household and Plan usage are its other tabs. */
const nav: NavItem[] = [
  { href: "/", label: "Portfolio", icon: "home", tab: 1, also: ["/coverage", "/ledger", "/schedule"] },
  { href: "/policies", label: "Documents", icon: "documents", tab: 2 },
  { href: "/chat", label: "Ask DearPolicy", icon: "ask", tab: 3, short: "Ask" },
  { href: "/claims", label: "Claims", icon: "claims", tab: 4 },
  { href: "/records", label: "Payments", icon: "payments" },
  { href: "/learn", label: "Learn", icon: "book" },
  { href: "/family", label: "Account settings", icon: "household", also: ["/household", "/usage"] },
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
// /privacy is public and read before signing in, so it gets no app navigation and no Sign out button.
const SIGNED_OUT_PATHS = new Set(["/login", "/signup", "/reset-password", "/privacy"]);
/** Signed in, but with no household to navigate. */
const NO_NAV_PATHS = new Set(["/household/deleted", "/privacy"]);

/** Ends the Supabase session on the server (which clears the session
 * cookie), then leaves for the sign-in page. Navigates even if the request
 * fails, so the person is never left looking at a page they believe they
 * have left; the next request re-checks the session regardless. */
function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    clearHouseholdDeviceMemory();
    try { await fetch("/api/auth/signout", { method: "POST" }); } catch { /* navigate anyway */ }
    router.push("/login");
    router.refresh();
  };
  return (
    <button type="button" className="theme-toggle sign-out icon-only" onClick={signOut} disabled={busy} aria-busy={busy} aria-label={busy ? "Signing out" : "Sign out"} data-tip={busy ? "Signing out…" : "Sign out"}>
      <Icon name="signOut" />
    </button>
  );
}

type Theme = "light" | "dark";
function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const dark = theme === "dark";
  return (
    <button type="button" className="theme-toggle icon-only" onClick={onToggle} aria-pressed={dark} aria-label={dark ? "Switch to light appearance" : "Switch to dark appearance"} data-tip={dark ? "Dark" : "Light"}>
      <Icon name={dark ? "moon" : "sun"} />
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
  const under = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const isActive = (href: string) => {
    const item = items.find((i) => i.href === href);
    if (item?.also?.some(under)) return true;
    return href === "/" || href === "/operator" ? pathname === href : pathname.startsWith(href);
  };
  // Only the household navigation is too long for a phone's bottom bar.
  const tabbed = items.some((item) => item.tab);
  const moreItems = tabbed ? items.filter((item) => !item.tab) : [];
  const moreActive = moreItems.some((item) => isActive(item.href));
  const [moreOpen, setMoreOpen] = useState(false);
  // Each tab names its page ("Documents · DearPolicy"), so several open tabs
  // and the browser history can be told apart. React places <title> in the head.
  const titled = [...items].sort((a, b) => b.href.length - a.href.length).find((item) => item.href !== "/" && isActive(item.href))
    ?? (pathname === "/" && items.length ? items[0] : null);
  // Pages reached through another menu item still name themselves in the browser tab.
  const ownTitles: Record<string, string> = { "/login": "Sign in", "/signup": "Create your household", "/reset-password": "Reset password", "/privacy": "Privacy",
    "/ledger": "Coverage", "/schedule": "Benefits", "/coverage": "Coverage", "/family": "People", "/usage": "Plan usage" };
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
          <div className="sidebar-controls"><ThemeToggle theme={theme} onToggle={toggleTheme} />
          {!signedOutPage && <SignOutButton />}</div>
          {unreachable && (
            <div className="service-fix" role="status">
              <p>DearPolicy can&rsquo;t be reached right now. Check your connection, then refresh the page.</p>
            </div>
          )}
          <div className="privacy-pill" data-tip={hosted ? "Your documents and questions are kept private to your household." : "Your documents and questions stay on this computer."} tabIndex={0}
            aria-label={hosted ? "Hosted and encrypted. Your documents and questions are kept private to your household." : "Local-first. Your documents and questions stay on this computer."}>
            <Icon name="lock" />{hosted ? "Private & encrypted" : "Local-first"}</div>
          <p className="trust-line"><Icon name="lock" />{hosted ? "Private to your household." : "Stays on this computer."}</p>
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
        {!noNav && <p className="trust-line mobile-privacy" data-testid="mobile-privacy"><Icon name="lock" />{hosted ? "Private to your household." : "Stays on this computer."}</p>}
      </main>
    </div>
  );
}
