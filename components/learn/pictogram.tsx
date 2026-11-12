import type { ReactNode } from "react";
import type { LearnIcon } from "@/lib/learn/content";

/**
 * The knowledge library's pictures: self-made line drawings on a 48px grid, two tones (ink line, a soft fill), so they
 * read in light and dark themes. No external images, no text inside, no insurer marks. Server-safe: no hooks.
 * Classes: lp-fill (soft brand tint), lp-accent (money/amount tint), lp-good (covered tint).
 */
const drawings: Record<LearnIcon, ReactNode> = {
  schedule: <><rect className="lp-fill" x="10" y="5" width="28" height="38" rx="3" /><circle cx="18" cy="15" r="3.5" /><path d="M12.5 24a5.5 5.5 0 0 1 11 0" /><path d="M27 13h6M27 18h6M15 30h18" /><rect className="lp-accent" x="15" y="34" width="12" height="4" rx="1" /></>,
  wording: <><path className="lp-fill" d="M10 5h20l8 8v30H10z" /><path d="M30 5v8h8" /><path d="M15 18h18M15 23h18M15 28h18M15 33h18M15 38h11" /></>,
  rider: <><rect className="lp-fill" x="6" y="8" width="24" height="32" rx="3" /><path d="M11 16h14M11 21h14M11 26h9" /><rect className="lp-good" x="24" y="22" width="18" height="20" rx="3" /><path d="M33 27v10M28 32h10" /></>,
  endorsement: <><rect className="lp-fill" x="8" y="5" width="26" height="38" rx="3" /><path d="M13 13h16M13 18h16M13 23h10" /><path d="M24 39l2-7 14-14 5 5-14 14z" /><path d="M36 22l5 5" /></>,
  illustration: <><path d="M7 6v35h35" /><path className="lp-fill" d="M12 36l8-9 7 4 12-15v20H12z" /><path d="M12 36l8-9 7 4 12-15" /><path d="M12 30l8-6 7 1 12-9" strokeDasharray="2 3" /></>,
  renewal: <><rect className="lp-fill" x="7" y="10" width="34" height="31" rx="3" /><path d="M7 18h34M15 6v8M33 6v8" /><path d="M30 27a6 6 0 1 1-2-4.5" /><path d="M29 20v3.5h-3.5" /></>,
  life: <><path className="lp-fill" d="M24 41S7 31 7 18.5A8.5 8.5 0 0 1 24 13a8.5 8.5 0 0 1 17 5.5C41 31 24 41 24 41z" /><path d="M12 24h7l3-5 4 9 3-4h7" /></>,
  illness: <><circle className="lp-fill" cx="24" cy="24" r="17" /><path d="M8 25h9l3-8 5 15 3-7h12" /></>,
  disability: <><path className="lp-fill" d="M24 5 9 11v10c0 9.5 6.4 16.5 15 20 8.6-3.5 15-10.5 15-20V11z" /><circle cx="24" cy="17" r="3.5" /><path d="M17 32a7 7 0 0 1 14 0" /></>,
  hospital: <><rect className="lp-fill" x="8" y="12" width="32" height="30" rx="2" /><path d="M8 42h32M18 42v-8h12v8" /><rect className="lp-good" x="19" y="16" width="10" height="12" rx="1" /><path d="M24 18v8M20 22h8" /></>,
  accident: <><rect className="lp-fill" x="5" y="17" width="38" height="14" rx="7" transform="rotate(-35 24 24)" /><rect className="lp-accent" x="17" y="17" width="14" height="14" rx="2" transform="rotate(-35 24 24)" /><path d="M22 23h.01M26 25h.01M23 27h.01M25 21h.01" strokeWidth="3" /></>,
  income: <><rect className="lp-fill" x="6" y="13" width="36" height="26" rx="4" /><path d="M6 20h30a4 4 0 0 1 4 4" /><rect className="lp-accent" x="30" y="24" width="12" height="8" rx="2" /><path d="M35 28h.01" strokeWidth="3" /><path d="M10 13l18-6 3 6" /></>,
  travel: <><rect className="lp-fill" x="8" y="15" width="32" height="25" rx="4" /><path d="M18 15v-5h12v5M17 15v25M31 15v25" /><path d="M14 43h4M30 43h4" /></>,
  home: <><path className="lp-fill" d="M9 22 24 9l15 13v19H9z" /><path d="M5 25 24 8l19 17" /><path d="M20 41V30h8v11" /></>,
  motor: <><path className="lp-fill" d="M6 31v-6l5-9h22l7 9h2v6z" /><path d="M13 18l-4 7h30" /><circle className="lp-accent" cx="14" cy="32" r="4.5" /><circle className="lp-accent" cx="34" cy="32" r="4.5" /></>,
  savings: <><ellipse className="lp-accent" cx="24" cy="36" rx="13" ry="5" /><path d="M11 36v-5c0 2.8 5.8 5 13 5s13-2.2 13-5v5" /><ellipse className="lp-accent" cx="24" cy="26" rx="13" ry="5" /><path d="M11 26v-5c0 2.8 5.8 5 13 5s13-2.2 13-5v5" /><ellipse className="lp-fill" cx="24" cy="16" rx="13" ry="5" /></>,
  investment: <><path d="M7 6v35h35" /><path className="lp-good" d="M12 34l6-8 6 4 6-11 8 5v17H12z" /><path d="M12 34l6-8 6 4 6-11 8 5" /></>,
  annuity: <><circle className="lp-fill" cx="24" cy="24" r="17" /><path d="M24 13v11l7 5" /><circle className="lp-accent" cx="24" cy="7" r="3" /><circle className="lp-accent" cx="41" cy="24" r="3" /><circle className="lp-accent" cx="24" cy="41" r="3" /><circle className="lp-accent" cx="7" cy="24" r="3" /></>,
  fixed: <><rect className="lp-fill" x="6" y="14" width="36" height="20" rx="3" /><rect className="lp-accent" x="10" y="19" width="28" height="10" rx="2" /></>,
  percent: <><circle className="lp-fill" cx="24" cy="24" r="17" /><path className="lp-accent" d="M24 24V7a17 17 0 0 1 17 17z" /><path d="M24 7v17h17" /></>,
  daily: <><rect className="lp-fill" x="7" y="10" width="34" height="31" rx="3" /><path d="M7 18h34M15 6v8M33 6v8" /><rect className="lp-accent" x="12" y="22" width="6" height="5" rx="1" /><rect className="lp-accent" x="21" y="22" width="6" height="5" rx="1" /><rect className="lp-accent" x="30" y="22" width="6" height="5" rx="1" /><rect x="12" y="31" width="6" height="5" rx="1" /></>,
  receipt: <><path className="lp-fill" d="M11 5h26v37l-4.3-3-4.4 3-4.3-3-4.3 3-4.4-3-4.3 3z" /><path d="M16 13h16M16 19h16M16 25h10" /><rect className="lp-accent" x="24" y="29" width="9" height="5" rx="1" /></>,
  search: <><circle className="lp-fill" cx="21" cy="21" r="12" /><path d="M30 30l11 11" strokeWidth="3.2" /><path d="M16 19h10M16 24h7" /></>,
  read: <><path className="lp-fill" d="M5 10c6-2 13-1 19 3v29c-6-4-13-5-19-3z" /><path className="lp-fill" d="M43 10c-6-2-13-1-19 3v29c6-4 13-5 19-3z" /><path d="M10 17c3-.5 6 0 9 1.5M10 23c3-.5 6 0 9 1.5M29 18.5c3-1.5 6-2 9-1.5M29 24.5c3-1.5 6-2 9-1.5" /></>,
  tell: <><path className="lp-fill" d="M24 7c9.4 0 17 6.3 17 14s-7.6 14-17 14c-1.9 0-3.7-.3-5.4-.7L9 39l2.1-7.2C8.5 29.3 7 26.3 7 21 7 13.3 14.6 7 24 7z" /><path d="M16 18h16M16 24h10" /></>,
  approve: <><rect className="lp-fill" x="9" y="6" width="30" height="36" rx="3" /><path d="M14 14h20M14 19h14" /><circle className="lp-good" cx="24" cy="31" r="7" /><path d="M20.5 31l2.5 2.5 4.5-5" /></>,
  keep: <><path className="lp-fill" d="M6 14h14l4 4h18v22H6z" /><path d="M6 14v-4h14l4 4" /><rect className="lp-accent" x="14" y="22" width="20" height="12" rx="1" /><path d="M18 26h12M18 30h8" /></>,
  decide: <><rect className="lp-fill" x="9" y="6" width="30" height="36" rx="3" /><path d="M14 14h20M14 19h20M14 24h12" /><rect className="lp-accent" x="22" y="28" width="16" height="10" rx="2" transform="rotate(-12 30 33)" /></>,
  printed: <><rect className="lp-fill" x="10" y="5" width="28" height="38" rx="3" /><path d="M15 13h18M15 18h18M15 23h12" /><rect className="lp-accent" x="15" y="29" width="18" height="7" rx="1.5" /></>,
  scenario: <><rect className="lp-fill" x="6" y="8" width="36" height="32" rx="4" /><path d="M11 33l7-9 6 5 7-11 6 7" strokeDasharray="3 2.5" /><circle className="lp-accent" cx="31" cy="18" r="3" /></>,
  insurer: <><path className="lp-fill" d="M6 18 24 7l18 11z" /><path d="M6 18h36M10 22v14M18 22v14M30 22v14M38 22v14M6 40h36" /></>,
  person: <><circle className="lp-fill" cx="24" cy="16" r="8" /><path className="lp-fill" d="M9 42a15 15 0 0 1 30 0z" /></>,
  source: <><rect className="lp-fill" x="7" y="5" width="26" height="34" rx="3" /><path d="M12 13h16M12 18h16M12 23h9" /><circle className="lp-accent" cx="31" cy="31" r="8" /><path d="M37 37l6 6" strokeWidth="3" /></>,
  conditions: <><rect className="lp-fill" x="8" y="6" width="32" height="36" rx="3" /><path d="M14 15l2 2 4-4M14 24l2 2 4-4M14 33l2 2 4-4" /><path d="M24 15h10M24 24h10M24 33h10" /></>,
  question: <><path className="lp-fill" d="M24 6c9.4 0 17 6.3 17 14s-7.6 14-17 14c-1.9 0-3.7-.3-5.4-.7L9 38l2.1-7.2C8.5 28.3 7 25.3 7 20 7 12.3 14.6 6 24 6z" /><path d="M20 16.5a4 4 0 1 1 5.5 3.7c-1 .4-1.5 1.3-1.5 2.3v1" /><path d="M24 28h.01" strokeWidth="3" /></>,
};

/** A decorative picture: the words beside it carry the meaning, so it is hidden from screen readers. */
export function Pictogram({ icon, size = 48 }: { icon: LearnIcon; size?: number }) {
  return (
    <svg className="lp" width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-icon={icon}>
      {drawings[icon]}
    </svg>
  );
}

export const PICTOGRAMS = Object.keys(drawings) as LearnIcon[];
