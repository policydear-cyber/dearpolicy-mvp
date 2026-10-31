"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Account settings is one place in the menu with three pages: the people in the household (the family
 * profiles DearPolicy matches to documents, and who can sign in), the household itself, and this month's plan usage. */
const TABS = [
  { href: "/family", label: "People" },
  { href: "/household", label: "Household" },
  { href: "/usage", label: "Plan usage" },
];

export function AccountTabs() {
  const pathname = usePathname();
  return (
    <nav className="account-tabs" aria-label="Account settings">
      {TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} className={pathname === tab.href ? "active" : undefined} aria-current={pathname === tab.href ? "page" : undefined}>{tab.label}</Link>
      ))}
    </nav>
  );
}
