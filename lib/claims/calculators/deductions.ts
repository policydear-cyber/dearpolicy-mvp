/**
 * The ONE deduction core for every reimbursement-style calculation in DearPolicy: the claims calculator
 * (lib/claims/calculators/medical-reimbursement.ts) and the conversational calculation tool (lib/rag2/calc) both call
 * these functions, so a deductible, a co-insurance share (with or without a cap) or a cap on a bill is worked out the
 * same way everywhere.
 *
 * Integer minor units (cents) only; percentages are parts-per-million (10% = 100_000 ppm) so no floating-point step
 * ever decides a cent. Co-insurance keeps the long-standing claims semantics exactly: the part the policy bears is the
 * amount x (100% - share), rounded half-up to the cent (Math.round of the same product in the previous float code);
 * the household's share is the rest. A printed cap on the household's share lowers the share, never raises it.
 */
export type DeductionCoreStep =
  | { kind: "deductible"; amountMinor: number }
  | { kind: "co_pay"; amountMinor: number }
  | { kind: "co_insurance"; ppm: number; capMinor?: number | null };

/** n / d rounded half-up (n, d >= 0 BigInt). */
export function divHalfUp(n: bigint, d: bigint): bigint {
  const q = n / d, r = n % d;
  return r * 2n >= d && r !== 0n ? q + 1n : q;
}
/** Percent (0..100, at most 4 decimals) to parts-per-million, exactly. */
export function percentToPpm(percent: number): number {
  return Math.round(percent * 10_000);
}

export type DeductionOutcome = { beforeMinor: number; afterMinor: number; householdShareMinor: number; capApplied: boolean };

/** Applies ONE deduction step to a running amount. Never below zero. */
export function applyDeductionCore(amountMinor: number, step: DeductionCoreStep): DeductionOutcome {
  const a = Math.max(0, Math.trunc(amountMinor));
  if (step.kind === "deductible" || step.kind === "co_pay") {
    const after = Math.max(0, a - Math.max(0, Math.trunc(step.amountMinor)));
    return { beforeMinor: a, afterMinor: after, householdShareMinor: a - after, capApplied: false };
  }
  const ppm = BigInt(Math.min(1_000_000, Math.max(0, Math.trunc(step.ppm))));
  let after = Number(divHalfUp(BigInt(a) * (1_000_000n - ppm), 1_000_000n));
  let share = a - after, capApplied = false;
  if (step.capMinor != null && share > step.capMinor) { share = Math.max(0, Math.trunc(step.capMinor)); after = a - share; capApplied = true; }
  return { beforeMinor: a, afterMinor: Math.max(0, after), householdShareMinor: share, capApplied };
}

/** The smallest of an amount and every cap ("pays up to the limit"); which cap bound it, or -1 when none did. */
export function capCore(amountMinor: number, capsMinor: number[]): { afterMinor: number; boundBy: number } {
  let v = Math.max(0, Math.trunc(amountMinor)), by = -1;
  capsMinor.forEach((c, i) => { if (c < v) { v = Math.max(0, Math.trunc(c)); by = i; } });
  return { afterMinor: v, boundBy: by };
}
