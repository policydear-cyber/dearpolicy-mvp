/** A plan refusal worded for whoever is asking: the owner reads "Upgrade to Plus…", a member reads who can upgrade
 * (lib/plans/catalogue.ts limitForMember). The owner check runs only when something was refused. */
import type { HouseholdContext } from "@/lib/auth/request-context";
import { requireHouseholdOwner } from "@/lib/household/repo";
import { limitForMember, type LimitCheck } from "@/lib/plans/catalogue";

export async function limitForCaller(check: LimitCheck, ctx: Pick<HouseholdContext, "userId" | "householdId">, isOwner: (userId: string, householdId: string) => Promise<void> = requireHouseholdOwner): Promise<LimitCheck> {
  if (check.allowed) return check;
  const owner = await isOwner(ctx.userId, ctx.householdId).then(() => true, () => false);
  return owner ? check : limitForMember(check);
}
