/** DearPolicy's one icon set: 24px grid, 1.75 stroke, round caps and joins, drawn in currentColor.
 * Every icon in the app comes from here so they read as one family. An icon beside its own words is
 * hidden from screen readers; an icon standing alone must be given a `label`, which becomes its
 * accessible name (and a tooltip where the caller adds `data-tip`). Server-safe: no hooks, no imports. */
import type { ReactNode } from "react";

const paths = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  family: <><circle cx="9" cy="8" r="3.5" /><circle cx="17" cy="9.5" r="2.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M15.5 20a5 5 0 0 1 6 0" /></>,
  person: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  documents: <><path d="M6 3h8l5 5v13H6z" /><path d="M14 3v5h5" /><path d="M9 13h7M9 17h7" /></>,
  payments: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10.5h18" /><path d="M7 15h4" /></>,
  benefits: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16M4 15h16M10 4v16" /></>,
  ledger: <><path d="M5 4h14v16H5z" /><path d="M9 9l1.5 1.5L13 8" /><path d="M9 14.5l1.5 1.5L13 13.5" /><path d="M15 9.5h1.5M15 15h1.5" /></>,
  claims: <><path d="M12 3 4 6.5v5.5c0 4.5 3.4 7.8 8 9 4.6-1.2 8-4.5 8-9V6.5z" /><path d="M12 9v4" /><path d="M12 16.5h.01" /></>,
  shield: <><path d="M12 3 4 6.5v5.5c0 4.5 3.4 7.8 8 9 4.6-1.2 8-4.5 8-9V6.5z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
  ask: <path d="M12 4c4.4 0 8 3 8 6.8s-3.6 6.8-8 6.8c-.9 0-1.8-.1-2.6-.4L5 19l.9-3.4C4.7 14.4 4 12.7 4 10.8 4 7 7.6 4 12 4z" />,
  usage: <><path d="M12 3a9 9 0 1 0 9 9h-9z" /><path d="M14 3.2A9 9 0 0 1 20.8 10H14z" /></>,
  household: <><path d="M4 11 12 4l8 7" /><path d="M6 10v9h12v-9" /><path d="M10 19v-5h4v5" /></>,
  more: <><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>,
  upload: <><path d="M12 15V4" /><path d="m7 9 5-5 5 5" /><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  download: <><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
  book: <><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" /></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" /><path d="M4 3v5h5" /><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" /><path d="M20 21v-5h-5" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /><path d="M10 11v6M14 11v6" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  checkCircle: <><circle cx="12" cy="12" r="9" /><path d="m8 12.5 3 3 5-6" /></>,
  alert: <><path d="M12 3.5 2.5 20h19z" /><path d="M12 10v4.5" /><path d="M12 17.5h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><path d="M12 7.5h.01" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  arrowRight: <path d="M5 12h14m-5-5 5 5-5 5" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  signOut: <><path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5" /><path d="M10 16l-4-4 4-4" /><path d="M6 12h10" /></>,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  sparkle: <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />,
  bolt: <path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12z" />,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  fileOff: <><path d="M6 3h8l5 5v13H6z" /><path d="M14 3v5h5" /><path d="m9.5 12.5 5 5M14.5 12.5l-5 5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  // Kinds of cover
  hospital: <><path d="M3 20V9l9-5 9 5v11" /><path d="M12 9v6M9 12h6" /><path d="M2 20h20" /></>,
  cash: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 9.5v.01M18 14.5v.01" /></>,
  heart: <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" />,
  pulse: <><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6c0 1-.2 1.9-.6 2.7" /><path d="M3 13h4l1.5-2.5 2.5 5 1.5-2.5H21" /></>,
  activity: <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />,
  wheelchair: <><circle cx="11" cy="4.5" r="1.8" /><path d="M11 7.5v6h5l2 5" /><path d="M11 10.5h4" /><path d="M8 11.5a5.5 5.5 0 1 0 7.5 6" /></>,
  bandage: <><rect x="2.8" y="8.2" width="18.4" height="7.6" rx="3.8" transform="rotate(-45 12 12)" /><path d="M10.5 10.5h.01M13.5 13.5h.01M13.5 10.5h.01M10.5 13.5h.01" /></>,
  wallet: <><path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1z" /><path d="M4 7V6a2 2 0 0 1 2-2h10v3" /><path d="M16 13.5h.01" /></>,
  stethoscope: <><path d="M6 3v6a4 4 0 0 0 8 0V3" /><path d="M10 13v2a5 5 0 0 0 10 0v-2" /><circle cx="20" cy="11" r="2" /></>,
  care: <><path d="M3 13h3l3 3h4a1.5 1.5 0 0 0 0-3h-2" /><path d="M6 19h9l6-4a1.5 1.5 0 0 0-2-2l-4 2" /><path d="M14.5 9.5S11 7.4 11 5.3A1.8 1.8 0 0 1 14.5 4.6 1.8 1.8 0 0 1 18 5.3c0 2.1-3.5 4.2-3.5 4.2z" /></>,
  plane: <path d="M10.5 13.5 3 11l1.5-1.5 7.5 1 4-4.5a2 2 0 0 1 3 3l-4.5 4 1 7.5L14 22l-2.5-7.5L8 18v2.5L6.5 22l-1-3.5L2 17.5 3.5 16H6l3.5-3.5" />,
  car: <><path d="M4 16v-4l2-5h12l2 5v4" /><path d="M3 16h18v3H3z" /><path d="M7 19v1.5M17 19v1.5" /><path d="M7 13h.01M17 13h.01" /></>,
  coins: <><ellipse cx="9" cy="7" rx="5.5" ry="2.5" /><path d="M3.5 7v4c0 1.4 2.5 2.5 5.5 2.5" /><path d="M3.5 11v4c0 1.4 2.5 2.5 5.5 2.5" /><ellipse cx="15" cy="13" rx="5.5" ry="2.5" /><path d="M9.5 13v4c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5v-4" /></>,
  trendUp: <><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;

export function Icon({ name, label, className }: { name: IconName; label?: string; className?: string }) {
  return (
    <svg className={className ? `icon ${className}` : "icon"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true, focusable: false })}>
      {label ? <title>{label}</title> : null}
      {paths[name]}
    </svg>
  );
}

/** The icon for a kind of cover, by the category names the coverage service uses. Unknown kinds get the plain shield. */
const coverIcons: Record<string, IconName> = {
  Hospitalisation: "hospital", "Hospital Cash": "cash", Death: "heart", "Critical Illness": "pulse", "Early Critical Illness": "activity",
  "Total Permanent Disability": "wheelchair", "Personal Accident": "bandage", "Disability Income": "wallet", Outpatient: "stethoscope",
  "Long-term Care": "care", Travel: "plane", Home: "home", Motor: "car", Savings: "coins", Investment: "trendUp",
};
export const coverIcon = (category: string): IconName => coverIcons[category] ?? "shield";
