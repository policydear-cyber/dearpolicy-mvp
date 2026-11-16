/**
 * SYNTHETIC variant, for tests only (declutter, 16 Nov 2026). Since the declutter change, a percentage row whose label carries a case
 * in brackets -- "Arm, Elbow, Wrist or Ribs (Other Fracture)" -- is said WITHOUT its amount when no document of the person defines that
 * case (lib/rag2/loop/statement-render.ts undefinedCaseOf): the household is told to ask the insurer whether the row applies. The
 * anonymised libraries print no such definition, so their certificate amounts (S$120,000, S$300,000) are no longer shown.
 *
 * Tests written for OTHER mechanics that happen to use those amounts as their vehicle (corrections, withdrawals, reopening, wrong
 * person / version / base) run on this variant instead: the document that prints the "(Other Fracture)" table gains ONE extra page
 * that defines Other Fracture, so the amount is shown again and the test keeps testing what it was written for. Nothing else changes.
 * This page is not in any real document.
 */
// (PR #512, F4: the definition says nothing about open or closed, so a journey that reports a closed fracture still tests what it was
// written for; a definition that a report does not fit hides the amount, and has its own check, fracture replay B19)
export const OTHER_FRACTURE_DEFINITION = "DEFINITIONS\nOther Fracture means a fracture other than a Simple Fracture, confirmed by X-ray by a registered medical practitioner.";
export const OPEN_FRACTURE_DEFINITION = "DEFINITIONS\nOther Fracture means a fracture in which the broken bone pierces the skin.";

type Doc = { pages: Record<number, string>; superseded?: boolean };
export function withOtherFractureDefined<T extends { DOCS: Doc[] }>(fx: T, definition = OTHER_FRACTURE_DEFINITION): T {
  return {
    ...fx,
    DOCS: fx.DOCS.map((d) => {
      if (!Object.values(d.pages).some((t) => /\(Other Fracture\)/.test(t))) return d;
      const next = Math.max(0, ...Object.keys(d.pages).map(Number)) + 1;
      return { ...d, pages: { ...d.pages, [next]: definition } };
    }),
  } as T;
}
