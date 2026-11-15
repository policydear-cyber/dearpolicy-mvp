import { Icon, type IconName } from "@/components/icons";

/** A drawn cover card (Card wallet, docs/brand.md): chip, the kind's colour, a masked number. Decoration only. It never
 * shows a household's figure, so it is hidden from screen readers; the page says the same thing in words. */
export function WalletCard({ card, icon, title, line, mark }: { card: string; icon: IconName; title: string; line: string; mark: string }) {
  return <div className="wallet-card" data-card={card} aria-hidden="true">
    <div className="wallet-card-top"><span className="card-chip" /><span className="wallet-card-mark">{mark}</span></div>
    <strong><Icon name={icon} />{title}</strong>
    <span className="wallet-card-no">{line}</span>
  </div>;
}
