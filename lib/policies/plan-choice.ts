/**
 * Whether the Documents page asks which plan (cover tier) each covered person is on.
 *
 * The plan a person is on (policy_members.benefit_tier) narrows a multi-column table to that person's column in the
 * older answer paths: the contextual chat (lib/chat/workflow.ts, lib/chat/policy-answer.ts, lib/rag2) and the ledger
 * Coverage view (lib/ledger/store.ts seedLedger). A household whose Coverage, Home and chat all run on the benefit
 * table (lib/benefit-table with the simple chat, lib/simple-chat) never reads it: the table links each person to their
 * cover itself. Asking such a household to pick a plan is a manual step that changes nothing they see, and the only
 * manual step a household is asked for is which person(s) a document is for (owner rule, 22 Oct). Stored tiers are
 * kept as they are either way.
 *
 * Pure and import-free, so the client page can use it; the route decides the flags server-side.
 */

/** True unless the household's Coverage and chat both run on the benefit table: only then is the plan never read. */
export function planChoiceAsked(flags: { benefitTable: boolean; simpleChat: boolean }): boolean {
  return !(flags.benefitTable && flags.simpleChat);
}

/** What the "Covers" picker shows about plans: the "plan not chosen yet" note, and the per-person plan dropdown. */
export function coversPlanPrompt(args: { tierOptions: readonly string[]; covered: readonly { planTier?: string | null }[]; planChoice: boolean }): { planMissing: boolean; tierSelect: boolean } {
  const offered = args.planChoice && args.tierOptions.length > 0;
  return {
    planMissing: offered && args.covered.some((p) => !p.planTier),
    tierSelect: offered && args.covered.length > 0,
  };
}
