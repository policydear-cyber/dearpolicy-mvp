"use client";
import { useEffect, useState } from "react";

/**
 * A household has exactly one owner, who alone changes documents, people and settings (DC, 18 Nov 2026). Members see
 * everything and use Ask DearPolicy. This tells a page which the signed-in person is, so it can leave out the controls a
 * member can't use and say why, instead of offering a button that would only come back refused. The server enforces the
 * rule either way (lib/auth/request-context.ts requireHouseholdOwnerContext).
 *
 * Only a role the server confirmed as "member" hides anything: while it loads, or if it can't be read, the page stays as
 * it was for an owner, and the server still refuses a member's change with "Only the household owner can do this."
 */
type HouseholdRoleState = { activeHouseholdId?: string | null; memberships?: Array<{ householdId: string; role: string }> };

let pending: Promise<"owner" | "member" | null> | null = null;
function loadRole(): Promise<"owner" | "member" | null> {
  pending ??= fetch("/api/household", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<HouseholdRoleState>) : null))
    .then((data) => {
      const role = data?.memberships?.find((m) => m.householdId === data.activeHouseholdId)?.role;
      return role === "owner" || role === "member" ? role : null;
    })
    .catch(() => null)
    .finally(() => { setTimeout(() => { pending = null; }, 0); });
  return pending;
}

/** false only when the signed-in person is a member (not the owner) of the active household. */
export function useCanManageHousehold(): boolean {
  const [role, setRole] = useState<"owner" | "member" | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadRole().then((r) => { if (!cancelled) setRole(r); });
    return () => { cancelled = true; };
  }, []);
  return role !== "member";
}

/** The short reason shown where a member would otherwise see a control they can't use. */
export function OwnerOnlyNote({ children }: { children: React.ReactNode }) {
  return <p className="muted owner-only-note" data-testid="owner-only-note">{children}</p>;
}
