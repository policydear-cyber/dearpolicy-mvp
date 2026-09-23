/**
 * Checkpoint 9 (claude/v1-launch-hardening): machine-readable alert
 * conditions over the telemetry event stream produced by lib/telemetry.
 *
 * This module does NOT evaluate conditions against live data (there is
 * no metrics/alerting backend wired into this repository yet -- see
 * lib/launch/guards.ts's checkTelemetryProductionAdapterConfigured for
 * the launch-blocking guard on that gap). It defines, as plain data, the
 * condition every downstream alerting system (a log-based metric, a SQL
 * query over a telemetry sink, a vendor's alerting rule) needs to
 * implement, so that:
 *   1. every category the spec requires has an unambiguous, reviewable
 *      definition rather than being left to whoever wires up the first
 *      real alerting backend;
 *   2. the definition can be unit-tested against a batch of in-memory
 *      TelemetryEvent objects (see evaluateAlertCondition() below and
 *      scripts/telemetry-regressions.ts's alert-condition cases);
 *   3. severity and the expected operational response travel with the
 *      condition, not in a separate runbook that can drift out of sync.
 */
import type { TelemetryEvent } from "./types";

export type AlertSeverity = "critical" | "high" | "medium" | "low";

export type AlertCondition = {
  /** Stable machine-readable id, e.g. for a metric/alert-rule name. */
  id: string;
  title: string;
  severity: AlertSeverity;
  /** Which telemetry event name(s) this condition watches. */
  eventNames: string[];
  /** Plain-language definition of what should be true to fire. */
  description: string;
  /** What an on-call responder should do when this fires. */
  operationalResponse: string;
  /**
   * A pure predicate over a window of already-collected events, for unit
   * testing and for backends that can hand this function a batch. A real
   * alerting backend is free to reimplement the same logic as a native
   * query (e.g. a Prometheus rule or a SQL count) -- this function is the
   * source of truth for what that reimplementation must match.
   */
  evaluate: (events: TelemetryEvent[], context?: AlertEvaluationContext) => AlertEvaluationResult;
};

export type AlertEvaluationContext = {
  /** Wall-clock "now", for windowing. Defaults to Date.now(). */
  nowMs?: number;
  /** Overridable thresholds, keyed by AlertCondition.id, for tuning without code changes. */
  thresholds?: Partial<Record<string, number>>;
};

export type AlertEvaluationResult = {
  fired: boolean;
  /** Human-readable detail (counts, examples) for the alert payload. */
  detail: string;
  matchedCount: number;
};

function withinWindow(event: TelemetryEvent, nowMs: number, windowMsValue: number): boolean {
  const t = Date.parse(event.timestamp);
  if (Number.isNaN(t)) return false;
  return nowMs - t <= windowMsValue && nowMs - t >= 0;
}

function countMatching(
  events: TelemetryEvent[],
  nowMs: number,
  windowMsValue: number,
  predicate: (e: TelemetryEvent) => boolean,
): number {
  let count = 0;
  for (const event of events) {
    if (withinWindow(event, nowMs, windowMsValue) && predicate(event)) count++;
  }
  return count;
}

function thresholdFor(id: string, defaultValue: number, context?: AlertEvaluationContext): number {
  return context?.thresholds?.[id] ?? defaultValue;
}

export const ALERT_CONDITIONS: AlertCondition[] = [
  {
    id: "auth_attack_spike",
    title: "Authentication attack spike",
    severity: "high",
    eventNames: ["auth.login.failure", "route.error"],
    description:
      "More than the threshold count of authentication-category failures (errorCategory='authentication') within a 5-minute window, aggregated across all routes -- a signal of credential stuffing, brute force, or a broken client integration.",
    operationalResponse:
      "Check whether failures concentrate on one IP/account (rate-limit or block it), or are broad (possible credential-stuffing campaign -- consider tightening auth rate limits). Not itself a data breach signal unless paired with a subsequent authorization anomaly.",
    evaluate: (events, context) => {
      const nowMs = context?.nowMs ?? Date.now();
      const windowMsValue = 5 * 60 * 1000;
      const threshold = thresholdFor("auth_attack_spike", 20, context);
      const matched = countMatching(events, nowMs, windowMsValue, (e) => e.errorCategory === "authentication" && e.status === "failure");
      return { fired: matched >= threshold, detail: `${matched} authentication failures in the last 5 minutes (threshold ${threshold})`, matchedCount: matched };
    },
  },
  {
    id: "cross_household_access_attempt",
    title: "Cross-household access attempt",
    severity: "critical",
    eventNames: ["route.error"],
    description:
      "Any occurrence of errorCategory='authorization' where the event's extra.crossHousehold flag is set, or monetaryGateReason indicates a scope mismatch -- even a single occurrence is significant, since RLS and route-level scoping should make this structurally impossible.",
    operationalResponse:
      "Page immediately. Treat as a possible authorization-boundary defect, not routine noise: identify the route and correlation ID, reproduce with a scoped-client test, and do not resolve until the code path is confirmed to raise the same error under a passing test that specifically exercises cross-household access.",
    evaluate: (events, context) => {
      const nowMs = context?.nowMs ?? Date.now();
      const windowMsValue = 24 * 60 * 60 * 1000;
      const matched = countMatching(
        events,
        nowMs,
        windowMsValue,
        (e) => e.errorCategory === "authorization" && Boolean((e.extra as Record<string, unknown> | null | undefined)?.crossHousehold),
      );
      return { fired: matched >= 1, detail: `${matched} cross-household authorization failures in the last 24h (any nonzero count fires)`, matchedCount: matched };
    },
  },
  {
    id: "rate_limit_spike",
    title: "Rate-limit spike",
    severity: "medium",
    eventNames: ["route.error"],
    description: "A burst of errorCategory='rate_limit' events within a 5-minute window, well above ordinary traffic.",
    operationalResponse:
      "Check whether this is legitimate load (consider raising limits or scaling) or abuse from a small set of identities/IPs (consider blocking). Not urgent unless sustained.",
    evaluate: (events, context) => {
      const nowMs = context?.nowMs ?? Date.now();
      const windowMsValue = 5 * 60 * 1000;
      const threshold = thresholdFor("rate_limit_spike", 50, context);
      const matched = countMatching(events, nowMs, windowMsValue, (e) => e.errorCategory === "rate_limit");
      return { fired: matched >= threshold, detail: `${matched} rate-limit rejections in the last 5 minutes (threshold ${threshold})`, matchedCount: matched };
    },
  },
  {
    id: "upload_scan_failure_rate",
    title: "Upload / malware-scan failure rate",
    severity: "high",
    eventNames: ["upload.scan.failure", "route.error"],
    description: "More than the threshold proportion of scanner-category events failing within a 15-minute window -- signals the scanner provider is degraded or misconfigured.",
    operationalResponse:
      "Check the scanner provider's status page and recent credential/config changes. Uploads are held in quarantine while the scanner is down, so users see delayed processing rather than corrupted state -- this is degraded-but-safe, escalate on provider status, not data risk.",
    evaluate: (events, context) => {
      const nowMs = context?.nowMs ?? Date.now();
      const windowMsValue = 15 * 60 * 1000;
      const threshold = thresholdFor("upload_scan_failure_rate", 5, context);
      const matched = countMatching(events, nowMs, windowMsValue, (e) => e.errorCategory === "scanner" && e.status === "failure");
      return { fired: matched >= threshold, detail: `${matched} scanner failures in the last 15 minutes (threshold ${threshold})`, matchedCount: matched };
    },
  },
  {
    id: "processing_backlog",
    title: "Durable-job processing backlog",
    severity: "medium",
    eventNames: ["job.claimed", "job.completed"],
    description:
      "The count of job.claimed events without a matching job.completed/job.dead_letter/job.failed_retryable in a 30-minute window exceeds threshold -- jobs are being enqueued faster than they finish.",
    operationalResponse: "Check worker capacity/concurrency and whether a specific job_type is stuck (see per-jobType breakdown). Scale workers or investigate a slow downstream dependency (model provider, scanner).",
    evaluate: (events, context) => {
      const nowMs = context?.nowMs ?? Date.now();
      const windowMsValue = 30 * 60 * 1000;
      const threshold = thresholdFor("processing_backlog", 100, context);
      const claimed = countMatching(events, nowMs, windowMsValue, (e) => e.name === "job.claimed");
      const completed = countMatching(events, nowMs, windowMsValue, (e) => e.name === "job.completed");
      const backlog = Math.max(0, claimed - completed);
      return { fired: backlog >= threshold, detail: `${backlog} more jobs claimed than completed in the last 30 minutes (threshold ${threshold})`, matchedCount: backlog };
    },
  },
  {
    id: "dead_letter_growth",
    title: "Dead-letter growth",
    severity: "high",
    eventNames: ["job.dead_letter"],
    description: "More than threshold job.dead_letter events within a 1-hour window -- jobs are permanently failing after exhausting retries.",
    operationalResponse: "Inspect the dead-letter payloads for a common job_type/errorCategory. This usually indicates a code regression or a persistently unavailable downstream dependency, not transient load.",
    evaluate: (events, context) => {
      const nowMs = context?.nowMs ?? Date.now();
      const windowMsValue = 60 * 60 * 1000;
      const threshold = thresholdFor("dead_letter_growth", 10, context);
      const matched = countMatching(events, nowMs, windowMsValue, (e) => e.name === "job.dead_letter");
      return { fired: matched >= threshold, detail: `${matched} jobs moved to dead-letter in the last hour (threshold ${threshold})`, matchedCount: matched };
    },
  },
  {
    id: "extraction_failure_rate",
    title: "Extraction failure rate",
    severity: "high",
    eventNames: ["route.error", "job.dead_letter"],
    description: "More than threshold errorCategory='extraction' events within a 30-minute window -- policy/claim document extraction is failing at an elevated rate.",
    operationalResponse: "Check for a recent prompt/schema/model version change (see Checkpoint 10 provenance) correlated with the onset, or a shift in incoming document formats.",
    evaluate: (events, context) => {
      const nowMs = context?.nowMs ?? Date.now();
      const windowMsValue = 30 * 60 * 1000;
      const threshold = thresholdFor("extraction_failure_rate", 15, context);
      const matched = countMatching(events, nowMs, windowMsValue, (e) => e.errorCategory === "extraction");
      return { fired: matched >= threshold, detail: `${matched} extraction failures in the last 30 minutes (threshold ${threshold})`, matchedCount: matched };
    },
  },
  {
    id: "evidence_review_backlog",
    title: "Evidence-review backlog",
    severity: "medium",
    eventNames: ["claim.evidence.review"],
    description: "The count of events with evidenceReviewState='pending_review' exceeds threshold within a 24-hour rolling window without a corresponding transition to a resolved state.",
    operationalResponse: "Notify the evidence-review operations owner; a growing backlog delays claim estimate availability for households waiting on review.",
    evaluate: (events, context) => {
      const nowMs = context?.nowMs ?? Date.now();
      const windowMsValue = 24 * 60 * 60 * 1000;
      const threshold = thresholdFor("evidence_review_backlog", 50, context);
      const matched = countMatching(events, nowMs, windowMsValue, (e) => e.evidenceReviewState === "pending_review");
      return { fired: matched >= threshold, detail: `${matched} evidence items pending review in the last 24h (threshold ${threshold})`, matchedCount: matched };
    },
  },
  {
    id: "monetary_result_anomaly",
    title: "Monetary-result anomaly",
    severity: "critical",
    eventNames: ["calculation.completed", "calculation.gated"],
    description: "A calculation event whose monetaryGateReason indicates an unexpected unlock (e.g. an unverified-provenance or stale-evidence gate that should have blocked the result was bypassed) -- any nonzero count fires.",
    operationalResponse: "Page immediately. This is the class of bug the entire provenance/rollout system (Checkpoints 10-11) exists to prevent -- do not resolve without confirming, with a specific reproducing test, that no monetary amount was shown to a user off unverified or stale evidence.",
    evaluate: (events, context) => {
      const nowMs = context?.nowMs ?? Date.now();
      const windowMsValue = 24 * 60 * 60 * 1000;
      const matched = countMatching(
        events,
        nowMs,
        windowMsValue,
        (e) => e.monetaryGateReason === "unexpected_unlock" || e.monetaryGateReason === "gate_bypassed",
      );
      return { fired: matched >= 1, detail: `${matched} monetary-gate anomalies in the last 24h (any nonzero count fires)`, matchedCount: matched };
    },
  },
  {
    id: "model_fallback_rate",
    title: "Model / fallback change rate",
    severity: "medium",
    eventNames: ["model.call.completed"],
    description: "More than threshold proportion of model calls within a 1-hour window whose resolvedModel differs from requestedModel (i.e. a fallback chain was used) -- signals the primary provider/model is degraded.",
    operationalResponse: "Check the primary model provider's status. Confirm the fallback chain is producing outputs within the same quality/compatibility bounds (see Checkpoint 11's promotion-safety gates) before this becomes sustained.",
    evaluate: (events, context) => {
      const nowMs = context?.nowMs ?? Date.now();
      const windowMsValue = 60 * 60 * 1000;
      const threshold = thresholdFor("model_fallback_rate", 20, context);
      const matched = countMatching(
        events,
        nowMs,
        windowMsValue,
        (e) => Boolean(e.requestedModel) && Boolean(e.resolvedModel) && e.requestedModel !== e.resolvedModel,
      );
      return { fired: matched >= threshold, detail: `${matched} model calls fell back to a non-requested model in the last hour (threshold ${threshold})`, matchedCount: matched };
    },
  },
  {
    id: "db_storage_latency",
    title: "Database / storage latency",
    severity: "high",
    eventNames: ["route.error", "job.completed"],
    description: "The count of durationMs values exceeding threshold milliseconds for database- or storage-category operations within a 10-minute window exceeds threshold count.",
    operationalResponse: "Check the database/storage provider's status and connection-pool saturation. Sustained latency risks request timeouts and job-lease expiry cascades.",
    evaluate: (events, context) => {
      const nowMs = context?.nowMs ?? Date.now();
      const windowMsValue = 10 * 60 * 1000;
      const latencyThresholdMs = thresholdFor("db_storage_latency_ms", 2000, context);
      const countThreshold = thresholdFor("db_storage_latency_count", 10, context);
      const matched = countMatching(
        events,
        nowMs,
        windowMsValue,
        (e) => (e.errorCategory === "database" || e.errorCategory === "storage") && (e.durationMs ?? 0) > latencyThresholdMs,
      );
      return { fired: matched >= countThreshold, detail: `${matched} database/storage operations exceeded ${latencyThresholdMs}ms in the last 10 minutes (threshold ${countThreshold})`, matchedCount: matched };
    },
  },
  {
    id: "calculation_engine_version_mismatch",
    title: "Calculation-engine version mismatch",
    severity: "high",
    eventNames: ["calculation.completed"],
    description: "Any calculation.completed event whose engineVersion is absent, or does not match the currently-deployed engine's expected version recorded in extra.expectedEngineVersion -- any nonzero count fires.",
    operationalResponse: "Investigate immediately: a calculation running on an unexpected engine version can silently diverge from the reviewed/tested calculation logic. Confirm no monetary result was shown from a mismatched version before resolving.",
    evaluate: (events, context) => {
      const nowMs = context?.nowMs ?? Date.now();
      const windowMsValue = 24 * 60 * 60 * 1000;
      const matched = countMatching(
        events,
        nowMs,
        windowMsValue,
        (e) => e.name === "calculation.completed" && !e.engineVersion,
      );
      return { fired: matched >= 1, detail: `${matched} calculation.completed events missing engineVersion in the last 24h (any nonzero count fires)`, matchedCount: matched };
    },
  },
  {
    id: "deletion_cleanup_failure",
    title: "Deletion cleanup failure",
    severity: "high",
    eventNames: ["lifecycle.deletion.finished", "storage.cleanup.failure"],
    description: "More than threshold storage/lifecycle cleanup failures (errorCategory='lifecycle' or 'storage' on a cleanup-tagged event) within a 1-hour window -- soft-deleted resources are not having their physical storage reclaimed.",
    operationalResponse: "Check the storage-cleanup engine's own job queue for stuck/dead-lettered cleanup jobs. Not a data-exposure risk on its own (the resource is already lifecycle-revoked), but a cost and retention-policy compliance risk if sustained.",
    evaluate: (events, context) => {
      const nowMs = context?.nowMs ?? Date.now();
      const windowMsValue = 60 * 60 * 1000;
      const threshold = thresholdFor("deletion_cleanup_failure", 5, context);
      const matched = countMatching(
        events,
        nowMs,
        windowMsValue,
        (e) => e.name === "storage.cleanup.failure" || (e.errorCategory === "lifecycle" && e.status === "failure"),
      );
      return { fired: matched >= threshold, detail: `${matched} deletion/storage-cleanup failures in the last hour (threshold ${threshold})`, matchedCount: matched };
    },
  },
];

/** Look up a single condition by id (for targeted testing or a single alert-rule sync). */
export function getAlertCondition(id: string): AlertCondition | undefined {
  return ALERT_CONDITIONS.find((c) => c.id === id);
}

/** Evaluate every defined condition against a batch of events; returns only those that fired. */
export function evaluateAllAlertConditions(events: TelemetryEvent[], context?: AlertEvaluationContext): Array<{ condition: AlertCondition; result: AlertEvaluationResult }> {
  const fired: Array<{ condition: AlertCondition; result: AlertEvaluationResult }> = [];
  for (const condition of ALERT_CONDITIONS) {
    const result = condition.evaluate(events, context);
    if (result.fired) fired.push({ condition, result });
  }
  return fired;
}
