import { notFound } from "next/navigation";
import { requireActiveClaimReviewer } from "@/lib/claims/reviewers/boundary";

// Always evaluated per request: who may see this area is decided by the
// signed-in session, never by a cached render.
export const dynamic = "force-dynamic";

/**
 * DearPolicy's operator area: system status, document-processing
 * diagnostics, extraction review and model usage/cost. None of this is part
 * of a household's screens (V1.1 Task 4).
 *
 * Gate: the existing staff authorization boundary -- an active DearPolicy
 * staff account provisioned by the trusted operator procedure
 * (claim_reviewers, lib/claims/reviewers/boundary.ts
 * requireActiveClaimReviewer()). Identity comes from the verified session
 * only. Anyone else -- a household member, a signed-out visitor (the
 * middleware already sends them to sign-in), a revoked reviewer -- gets an
 * ordinary "page not found", so the area's existence is not advertised.
 *
 * The extraction-review pages act through the household APIs, which stay
 * scoped to the operator's own household session; the usage overview reads
 * account-wide aggregates only (no household names or document contents).
 */
export default async function OperatorLayout({ children }: { children: React.ReactNode }) {
  let allowed = false;
  try {
    await requireActiveClaimReviewer();
    allowed = true;
  } catch {
    allowed = false;
  }
  if (!allowed) notFound();
  return <>{children}</>;
}
