/**
 * Completion of an unresolved clarification (PR #55 follow-up; sa-live-3 SBa).
 *
 * The server owns the requirements an evaluation creates (evaluate_benefit: "which listed case is it?"). The model is
 * supposed to turn the open one into the turn's single question, but a turn that identified the ambiguity can still end
 * with final_answer and no question (SBa: ask_user was refused for an unrelated guard, the model gave up and answered).
 * At finalisation the server therefore decides, from its own requirements and never from the model's memory, whether the
 * reply is missing the question. Pure: no I/O.
 *
 * A question is owed only when ALL of these hold; otherwise nothing is added:
 *  - the reply asks nothing already (no question pending);
 *  - the requirement is one the HOUSEHOLD can resolve (an insurer-only assessment is stated as a condition, never asked);
 *  - it is for the person the reply is about, and its fact is not already known (a settled question is not asked again);
 *  - the reply presents that requirement's benefit (a question about a benefit the reply does not mention is irrelevant);
 *  - the reply gives no amount for that benefit (an answered case needs no clarification);
 *  - the request is not an explicit comparison of hypothetical alternatives, which may be answered with clearly separated
 *    alternatives and no compulsory clarification.
 * Exactly one requirement is returned: the earliest open one (benefits that share a question share its wording).
 */
export type OpenRequirement = { id: string; subjectId: string; benefit: string; benefitId: string; factKey: string; resolvedBy: "household" | "insurer" };
export type FinalFacts = {
  /** The turn already ends with a question. */ alreadyPending: boolean;
  /** Who the reply is about. */ subjectId: string | null;
  /** The benefit labels the reply's statements present. */ presented: ReadonlySet<string>;
  /** The benefit labels the reply gives a calculated amount for. */ withAmount: ReadonlySet<string>;
  /** Whether a fact is already known for this person. */ known: (factKey: string) => boolean;
  /** The household's current message. */ message: string;
};
export const COMPARISON_REQUEST = /\b(?:compare|comparison|versus|vs\.?|side[- ]by[- ]side|difference between|differ(?:s|ence)?\b|which (?:one )?(?:pays|is) (?:more|higher|better)|(?:both|each) (?:of )?(?:the )?(?:two )?(?:benefits|options|tables|schedules))\b/i;
export function requirementToAsk<T extends OpenRequirement>(open: Iterable<T>, f: FinalFacts): T | null {
  if (f.alreadyPending || !f.subjectId || COMPARISON_REQUEST.test(f.message)) return null;
  for (const r of open) {
    if (r.resolvedBy !== "household" || r.subjectId !== f.subjectId) continue;
    if (f.known(r.factKey) || !f.presented.has(r.benefit) || f.withAmount.has(r.benefit)) continue;
    return r;
  }
  return null;
}
