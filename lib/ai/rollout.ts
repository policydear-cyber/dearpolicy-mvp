/**
 * Checkpoint 11 (claude/v1-launch-hardening): controlled rollout.
 *
 * A canary model for one governed operation (see lib/ai/provenance.ts's
 * KNOWN_OPERATIONS), turned on by CONFIGURATION alone -- an environment
 * variable, never a code change -- and rolled out to a deterministic,
 * non-gameable percentage of subjects (households, falling back to the
 * resource id when no household is in scope) rather than a random draw per
 * call. The SAME subject lands in the SAME cohort every time for a given
 * rollout, which is what makes a canary's provenance trail (Checkpoint 10's
 * model_executions rows, keyed by the same pseudonymized household/resource
 * refs) attributable to a stable comparison population instead of noise,
 * and what lets a person's experience stay consistent call to call instead
 * of flipping between two model behaviors mid-conversation.
 *
 * A kill switch (per-operation or global) forces everyone back to stable
 * immediately, without touching the percentage -- an operator can turn a
 * canary off in an incident without losing the rollout's configuration.
 *
 * This module is deliberately pure/side-effect-free (no DB, no telemetry):
 * lib/ai/llm.ts's structuredCompletion() is the one place a resolved
 * decision gets used to pick a real call target and gets persisted via
 * Checkpoint 10's recordModelExecution() (into the already-existing
 * requested_rollout column).
 */
import { createHash } from "node:crypto";
import { allowedByPreset, type ModelChoice } from "./providers";
import type { KnownOperation } from "./provenance";

export type RolloutCohort = "stable" | "canary";

export type RolloutConfig = {
  canary: ModelChoice;
  /** 0-100. Values outside this range are clamped, never trusted verbatim --
   * a misconfigured "1000" must not silently become "send everyone to an
   * unvetted canary." */
  percentage: number;
  killSwitch: boolean;
  rolloutId: string;
};

export type RolloutDecision = {
  cohort: RolloutCohort;
  rolloutId: string | null;
  /** The target to actually call, or null meaning "use the operation's
   * normal modelFor() choice" -- a decision object never has to be
   * unwrapped differently depending on which branch produced it. */
  target: ModelChoice | null;
  reason: string;
};

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Deterministic, non-gameable bucket in [0, 100) for a subject within one
 * rollout. Deliberately NOT reusing lib/telemetry/pseudonymize.ts's
 * TELEMETRY_PSEUDONYM_SECRET: a rollout bucket never leaves this process (it
 * is not an identifier disclosed anywhere), and mixing the two would make
 * rotating one secret silently reshuffle the other's cohorts. An unkeyed
 * hash is fine here for the same reason it would NOT be fine for
 * pseudonymization -- nobody is trying to keep a bucket assignment secret
 * from anyone, only stable and evenly distributed. */
function bucketOf(subjectId: string, rolloutId: string): number {
  const digest = createHash("sha256").update(`${rolloutId}:${subjectId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

/** The one place "which cohort, and what should this call actually target"
 * is decided. Every early-return is a fail-CLOSED path to stable -- no
 * config, a kill switch, a zero/invalid percentage, or no subject to bucket
 * on all resolve to stable, never to canary by omission. */
export function resolveRollout(config: RolloutConfig | null, subjectId: string | null): RolloutDecision {
  if (!config) {
    return { cohort: "stable", rolloutId: null, target: null, reason: "no rollout configured for this operation" };
  }
  if (config.killSwitch) {
    return { cohort: "stable", rolloutId: config.rolloutId, target: null, reason: "kill switch active" };
  }
  const percentage = clampPercentage(config.percentage);
  if (percentage <= 0) {
    return { cohort: "stable", rolloutId: config.rolloutId, target: null, reason: "rollout percentage is 0" };
  }
  if (!subjectId) {
    return { cohort: "stable", rolloutId: config.rolloutId, target: null, reason: "no subject id to bucket on" };
  }
  const bucket = bucketOf(subjectId, config.rolloutId);
  if (bucket < percentage) {
    return { cohort: "canary", rolloutId: config.rolloutId, target: config.canary, reason: `bucket ${bucket} < ${percentage}` };
  }
  return { cohort: "stable", rolloutId: config.rolloutId, target: null, reason: `bucket ${bucket} >= ${percentage}` };
}

/** Reads one operation's canary configuration from the environment, so
 * turning a canary on/off/up/down -- or hitting the kill switch -- is a
 * config change, never a code change:
 *   CANARY_<OPERATION>_MODEL       "provider:model" (e.g. "anthropic:claude-haiku-4-5").
 *                                  Absent/empty -- no canary configured for
 *                                  this operation at all (the common case;
 *                                  every existing call site behaves exactly
 *                                  as before Checkpoint 11 with nothing set).
 *   CANARY_<OPERATION>_PERCENTAGE  0-100, default "0" (configured but off).
 *   CANARY_<OPERATION>_KILL_SWITCH "true" forces this operation to stable.
 *   CANARY_KILL_SWITCH_ALL         "true" forces EVERY operation to stable
 *                                  at once, regardless of per-operation
 *                                  settings -- the incident-response override. */
export function canaryConfigFor(operation: KnownOperation, env: NodeJS.ProcessEnv = process.env): RolloutConfig | null {
  const upper = operation.toUpperCase();
  const modelSetting = (env[`CANARY_${upper}_MODEL`] ?? "").trim();
  if (!modelSetting) return null;
  const separator = modelSetting.indexOf(":");
  if (separator <= 0 || separator === modelSetting.length - 1) return null;
  const provider = modelSetting.slice(0, separator) as ModelChoice["provider"];
  const model = modelSetting.slice(separator + 1);
  // Under MODEL_PRESET=anthropic a canary naming another provider is no canary at all (lib/ai/providers.ts allowedByPreset).
  if (!allowedByPreset({ provider, model }, env)) return null;
  const percentage = Number(env[`CANARY_${upper}_PERCENTAGE`] ?? "0");
  const killSwitch = env.CANARY_KILL_SWITCH_ALL === "true" || env[`CANARY_${upper}_KILL_SWITCH`] === "true";
  return { canary: { provider, model }, percentage, killSwitch, rolloutId: `canary:${operation}:${modelSetting}` };
}
