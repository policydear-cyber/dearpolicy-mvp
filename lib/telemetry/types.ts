/**
 * Checkpoint 9 (claude/v1-launch-hardening): shared types for the central
 * telemetry boundary. Every field here is operational metadata -- never a
 * place to put policy wording, medical facts, chat text, document text, or
 * any other value redact.ts's DENIED_VALUE lists cover. See lib/telemetry/
 * index.ts's recordEvent() doc comment for the one entry point every
 * caller in this codebase is expected to use instead of talking to a
 * telemetry vendor directly.
 */

export type SafeErrorCategory =
  | "authentication"
  | "authorization"
  | "validation"
  | "rate_limit"
  | "storage"
  | "database"
  | "scanner"
  | "extraction"
  | "model_provider"
  | "calculation"
  | "lifecycle"
  | "job_retryable"
  | "job_permanent"
  | "internal_unknown";

export const SAFE_ERROR_CATEGORIES: readonly SafeErrorCategory[] = [
  "authentication",
  "authorization",
  "validation",
  "rate_limit",
  "storage",
  "database",
  "scanner",
  "extraction",
  "model_provider",
  "calculation",
  "lifecycle",
  "job_retryable",
  "job_permanent",
  "internal_unknown",
];

/** One structured operational record. Every field is either a structural
 * enum/number/duration, or a value that has already been through
 * pseudonymizeId() (household/resource identifiers) -- never a raw
 * database id, and never free text a person or a model wrote. */
export type TelemetryEvent = {
  name: string;
  correlationId: string;
  timestamp: string;
  route?: string | null;
  jobType?: string | null;
  status?: "success" | "failure" | "in_progress" | "cancelled" | null;
  durationMs?: number | null;
  attempt?: number | null;
  errorCategory?: SafeErrorCategory | null;
  httpStatus?: number | null;
  processingState?: string | null;
  engineVersion?: string | null;
  promptVersion?: string | null;
  schemaVersion?: string | null;
  requestedModel?: string | null;
  resolvedModel?: string | null;
  queueDelayMs?: number | null;
  executionMs?: number | null;
  monetaryGateReason?: string | null;
  evidenceReviewState?: string | null;
  // Pseudonymized (see lib/telemetry/pseudonymize.ts) -- never a raw
  // household_id/resource id/user id.
  householdRef?: string | null;
  resourceRef?: string | null;
  // Free-form, but ALWAYS passed through redactDeep() by recordEvent()
  // before it reaches any adapter -- never trust a caller not to have put
  // something sensitive in here.
  extra?: Record<string, unknown> | null;
};
