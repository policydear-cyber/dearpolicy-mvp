/**
 * Checkpoint 9 (claude/v1-launch-hardening): safe error taxonomy.
 *
 * classifyError() maps ANY error this codebase throws to one of
 * SafeErrorCategory's 14 values, a client-safe message (never the raw
 * `error.message` for an unrecognized error -- that's exactly the "raw
 * exceptions remain server-side" requirement), and an HTTP status where
 * one applies. It classifies by `error.constructor.name` (a string) rather
 * than `instanceof` against imported classes on purpose: importing every
 * domain error class here (lib/household/repo.ts, lib/lifecycle/*,
 * lib/jobs/queue.ts, lib/claims/evidence/*, ...) would make
 * lib/telemetry/errors.ts depend on nearly the whole codebase and risk a
 * circular import back into telemetry from any of them. `constructor.name`
 * is exactly the class's declared name (e.g. `class ForbiddenError extends
 * Error {}` -> `"ForbiddenError"`) regardless of whether that class's own
 * constructor bothered to set `this.name` -- most of this codebase's error
 * classes don't, so `error.name` itself is usually just `"Error"` and
 * would not work here.
 *
 * This module does NOT replace any route's existing routeErrorResponse()
 * switch (lib/auth/request-context.ts) or any other file's own
 * hand-written error-to-response mapping -- those keep their exact
 * existing response bodies unchanged. This is a second, additive
 * classification used only for what a telemetry event's errorCategory
 * field records, so adding it can never change any route's actual JSON
 * response.
 */
import type { SafeErrorCategory } from "./types";

export type ErrorClassification = {
  category: SafeErrorCategory;
  safeMessage: string;
  httpStatus: number | null;
};

const DEFAULT_UNKNOWN: ErrorClassification = {
  category: "internal_unknown",
  safeMessage: "Something went wrong. Please try again.",
  httpStatus: 500,
};

// error.constructor.name -> classification. Every domain error class this
// codebase currently defines (see `grep -rn "extends Error" lib/`) that
// maps cleanly onto one of the 14 taxonomy categories is listed here;
// anything unrecognized falls through to DEFAULT_UNKNOWN, never leaking
// its raw message.
const CLASSIFICATIONS: Record<string, ErrorClassification> = {
  UnauthenticatedError: { category: "authentication", safeMessage: "Not authenticated.", httpStatus: 401 },
  StaleAuthenticationError: {
    category: "authentication",
    safeMessage: "Please sign in again to confirm it's you before continuing.",
    httpStatus: 401,
  },
  ForbiddenError: { category: "authorization", safeMessage: "Not found.", httpStatus: 404 },
  NotHouseholdOwnerError: { category: "authorization", safeMessage: "Only the household owner can do this.", httpStatus: 403 },
  NoHouseholdError: { category: "authorization", safeMessage: "No household.", httpStatus: 404 },
  AuthorizationContextError: { category: "authorization", safeMessage: "Not authorized.", httpStatus: 403 },
  InternalReadAuthorizationError: { category: "authorization", safeMessage: "Not authorized.", httpStatus: 403 },

  NotFoundError: { category: "validation", safeMessage: "Not found.", httpStatus: 404 },
  ConflictError: { category: "validation", safeMessage: "This request conflicts with the current state.", httpStatus: 409 },
  DeletionValidationError: { category: "validation", safeMessage: "Not found.", httpStatus: 404 },
  HasLinkedActivityError: { category: "validation", safeMessage: "This has linked activity and cannot be deleted.", httpStatus: 409 },
  InvalidEvidenceTransitionError: { category: "validation", safeMessage: "Invalid state transition.", httpStatus: 409 },
  InvalidPolicyQuarantineTransitionError: { category: "validation", safeMessage: "Invalid state transition.", httpStatus: 409 },
  InvalidLifecycleTransitionError: { category: "validation", safeMessage: "Invalid state transition.", httpStatus: 409 },
  LifecycleVersionConflictError: { category: "validation", safeMessage: "This changed underneath the request -- please retry.", httpStatus: 409 },
  LifecycleResourceNotFoundError: { category: "validation", safeMessage: "Not found.", httpStatus: 404 },
  LifecycleResourceUntrackedError: { category: "internal_unknown", safeMessage: "Something went wrong. Please try again.", httpStatus: 500 },
  DeletionRequestVersionConflictError: { category: "validation", safeMessage: "This changed underneath the request -- please retry.", httpStatus: 409 },
  ChatConflict: { category: "validation", safeMessage: "This changed underneath the request -- please retry.", httpStatus: 409 },
  PolicyNotClearedForProcessingError: { category: "validation", safeMessage: "This document is still being checked.", httpStatus: 409 },

  SpendCapReached: { category: "model_provider", safeMessage: "This operation is temporarily unavailable.", httpStatus: 503 },
  TruncatedModelOutput: { category: "model_provider", safeMessage: "The response was incomplete. Please retry.", httpStatus: 502 },
  ClaimEvidenceMatchError: { category: "extraction", safeMessage: "This evidence could not be matched.", httpStatus: 422 },
  MedicalBillEvidenceError: { category: "extraction", safeMessage: "This evidence could not be processed.", httpStatus: 422 },

  CleanupLockHeldError: { category: "storage", safeMessage: "Cleanup is already in progress.", httpStatus: 409 },
  SupabaseConfigError: { category: "internal_unknown", safeMessage: "Something went wrong. Please try again.", httpStatus: 500 },

  LeaseLostError: { category: "job_permanent", safeMessage: "This job is no longer owned by this worker.", httpStatus: null },
  JobNotFoundError: { category: "validation", safeMessage: "Not found.", httpStatus: 404 },
};

/** For a call site that wants to explicitly tag a category this module
 * cannot infer from a constructor name (e.g. a rate-limiter or a raw
 * fetch/network failure talking to a model provider) without inventing a
 * new Error subclass just to get a classification. Checked explicitly by
 * classifyError() below (an instanceof check, not the constructor-name
 * table) since this class carries its own classification with it. */
export class CategorizedError extends Error {
  constructor(
    public readonly category: SafeErrorCategory,
    message: string,
    public readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "CategorizedError";
  }
}

export function classifyError(error: unknown): ErrorClassification {
  if (error instanceof CategorizedError) {
    return { category: error.category, safeMessage: error.message, httpStatus: error.httpStatus };
  }
  if (error && typeof error === "object" && "constructor" in error) {
    const name = (error as { constructor: { name?: string } }).constructor?.name;
    if (name && CLASSIFICATIONS[name]) return CLASSIFICATIONS[name];
  }
  return DEFAULT_UNKNOWN;
}
