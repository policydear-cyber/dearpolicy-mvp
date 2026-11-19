"use client";
/** The household's plan on every signed-in page, and the upgrade prompts (DC, 19 Nov 2026; rules in lib/plans/prompt.ts).
 *
 * AppShell asks /api/plan once and shares the answer. The badge sits beside the light/dark switch and opens Plan
 * usage. A prompt is one short line with one link to Plan usage, where the owner upgrades; it shows only to the
 * household's owner on Free, while payments are on, and never while the plan is unknown. Every number on it comes
 * from lib/plans/catalogue.ts or from the server's own counts. */
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { upgradeLine, type PlanStatus, type UpgradePlace } from "@/lib/plans/prompt";

type PlanContextValue = { status: PlanStatus | null; refresh: () => void };
const PlanContext = createContext<PlanContextValue>({ status: null, refresh: () => {} });

export function usePlanStatus(): PlanContextValue {
  return useContext(PlanContext);
}

function isPlanStatus(value: unknown): value is PlanStatus {
  const v = value as Partial<PlanStatus> | null;
  return !!v && (v.plan === "free" || v.plan === "plus" || v.plan === "family") && typeof v.name === "string" && typeof v.upgrade === "boolean";
}

/** `enabled` is false on pages with no household (signed out, operator, reviewer): nothing is asked or shown. */
export function PlanProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const refresh = useCallback(() => {
    if (!enabled) return;
    void fetch("/api/plan", { cache: "no-store" })
      .then(async (r) => { const p = await r.json().catch(() => null); setStatus(r.ok && isPlanStatus(p) ? p : null); })
      .catch(() => setStatus(null));
  }, [enabled]);
  useEffect(() => { if (enabled) refresh(); else setStatus(null); }, [enabled, refresh]);
  return <PlanContext.Provider value={{ status, refresh }}>{children}</PlanContext.Provider>;
}

/** "Free", "Plus" or "Family", beside the light/dark switch. Nothing until the plan is known. */
export function PlanBadge() {
  const { status } = usePlanStatus();
  if (!status) return null;
  return <Link href="/usage" className="plan-badge" data-plan={status.plan} data-testid="plan-badge" aria-label={`${status.name} plan. Open Plan usage`}>{status.name}</Link>;
}

/** One short upgrade line with one link, or nothing. */
export function UpgradePrompt({ place }: { place: UpgradePlace }) {
  const { status } = usePlanStatus();
  const line = upgradeLine(place, status);
  if (!line) return null;
  return <aside className="upgrade-prompt" data-testid={`upgrade-prompt-${place}`} aria-label="Upgrade your plan">
    <p><strong>{line.lead}</strong> <span>{line.detail}</span></p>
    <Link href="/usage" className="button secondary compact">See plans</Link>
  </aside>;
}

/** For a refusal at the limit (a document not kept, a question not sent): the owner gets the way to upgrade; anyone
 * else gets nothing extra. */
export function UpgradeLink({ className = "mini-button" }: { className?: string }) {
  const { status } = usePlanStatus();
  if (!status?.upgrade) return null;
  return <Link className={className} href="/usage" data-testid="upgrade-link">See plans</Link>;
}
