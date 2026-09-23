"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type ServiceState = { ok: boolean; label: string; detail: string; fix?: string };

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
};
type IconName = keyof typeof icon;
function NavIcon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {icon[name]}
    </svg>
  );
}

const nav: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Portfolio", icon: "home" },
  { href: "/family", label: "Family", icon: "family" },
  { href: "/policies", label: "Documents", icon: "documents" },
  { href: "/records", label: "Payments", icon: "payments" },
  { href: "/ledger", label: "Coverage", icon: "ledger" },
  { href: "/schedule", label: "Benefits", icon: "benefits" },
  { href: "/claims", label: "Claims", icon: "claims" },
  { href: "/chat", label: "Ask DearPolicy", icon: "ask" },
  { href: "/usage", label: "Usage", icon: "usage" },
  { href: "/household", label: "Household", icon: "household" },
];

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
  // DearPolicy runs either on this computer or on a server the person
  // controls. When something is down the person can fix it in a minute — if
  // they are told which thing and how, in words that match where it runs.
  const [services, setServices] = useState<ServiceState[]>([]);
  const [hosted, setHosted] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const payload = await (await fetch("/api/health")).json();
        if (!cancelled) { setServices(payload.services ?? []); setHosted(!!payload.hosted); }
      } catch {
        if (!cancelled) setServices([{ ok: false, label: "DearPolicy", detail: "The app server is not answering", fix: "Refresh the page, or try again in a minute." }]);
      }
    };
    void check();
    const timer = setInterval(() => void check(), 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  const down = services.filter((s) => !s.ok);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="DearPolicy home">
          <img className="brand-logo" src="/dearpolicy-logo.png" alt="DearPolicy" width={827} height={161} />
        </Link>
        <nav className="nav">
          {nav.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link className={`nav-item ${active ? "active" : ""}`} href={item.href} key={item.href} aria-current={active ? "page" : undefined}>
                <span className="nav-icon"><NavIcon name={item.icon} /></span>{item.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <div className="service-status" aria-live="polite">
            {services.map((s) => (
              <div className={`service-row ${s.ok ? "ok" : "down"}`} key={s.label} title={s.detail}>
                <i /><span>{s.label}</span><small>{s.detail}</small>
              </div>
            ))}
          </div>
          {down.length > 0 && (
            <div className="service-fix">
              {down.map((s) => <p key={s.label}><b>{s.label}:</b> {s.detail}{s.fix ? ` — ${s.fix}` : ""}</p>)}
            </div>
          )}
          <div className="privacy-pill">{hosted ? "Hosted & encrypted" : "Local-first"}</div>
          <p>{hosted
            ? "Your documents and questions are kept private to your account and processed on DearPolicy\u2019s hosted servers."
            : "Your documents and questions stay on this computer. Only the one-time reading of each document uses the reading model."}</p>
        </div>
      </aside>
      <main className="main-content">
        <div className="mobile-bar">
          <Link href="/" aria-label="DearPolicy home"><img className="brand-logo" src="/dearpolicy-logo.png" alt="DearPolicy" width={827} height={161} /></Link>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
        {children}
      </main>
    </div>
  );
}
