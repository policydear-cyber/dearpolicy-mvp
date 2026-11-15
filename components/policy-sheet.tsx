import { Icon, type IconName } from "@/components/icons";

/** A drawn policy sheet (wallet of cover, docs/brand.md): a kind's colour as the header, ruled lines for text, a folded
 * corner. Decoration only: it never shows a household's figure, so it is hidden from screen readers; the page says the
 * same thing in words. `children` sits on top of the sheet (the not-found stamp). */
export function PolicySheet({ card, icon, title, children }: { card: string; icon: IconName; title: string; children?: React.ReactNode }) {
  return <div className="policy-sheet" data-card={card} aria-hidden="true">
    <div className="policy-sheet-head"><Icon name={icon} />{title}</div>
    <div className="policy-sheet-body"><i /><i /><i /><i /><b /><i /><i /><i /></div>
    {children}
  </div>;
}
