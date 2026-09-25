/**
 * The actor recorded on a household member's review action. Always derived
 * from the authenticated request context -- never from a request body -- so
 * a client cannot write another person's (or an insurer's) name into the
 * review record or the append-only audit trail.
 */
export function householdReviewerIdentity(userId: string): string {
  return `household-user:${userId}`;
}
