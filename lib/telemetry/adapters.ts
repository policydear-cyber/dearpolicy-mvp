/**
 * Checkpoint 9 (claude/v1-launch-hardening): telemetry adapters.
 *
 * A TelemetryAdapter is the ONLY thing allowed to talk to an actual
 * telemetry vendor/destination -- production application code must never
 * call a vendor SDK directly (see lib/telemetry/index.ts's recordEvent(),
 * the one entry point everything else in this codebase is expected to
 * use). No real production adapter (e.g. one that posts to Datadog/
 * Sentry/an internal collector) is implemented in this codebase yet --
 * there is no live destination configured in this environment to build
 * and verify one against, and lib/launch/guards.ts's
 * checkTelemetryProductionAdapterConfigured() is what turns "still on
 * NoopTelemetryAdapter in production" into an explicit launch blocker
 * rather than a silent no-op, exactly like every other genuinely
 * external-configuration gap this launch-hardening effort has surfaced
 * (the malware scanner, the shared rate-limit store, ...).
 */
import type { TelemetryEvent } from "./types";

export interface TelemetryAdapter {
  readonly name: string;
  send(events: TelemetryEvent[]): Promise<void>;
}

/** Writes redacted events to console.log, one JSON line each -- useful in
 * local development so a person can actually see what would be emitted.
 * Never used in production (see defaultAdapterForEnv() in index.ts). */
export class LocalConsoleTelemetryAdapter implements TelemetryAdapter {
  readonly name = "local-console";
  async send(events: TelemetryEvent[]): Promise<void> {
    for (const event of events) {
      // eslint-disable-next-line no-console -- this adapter's whole job is to print
      console.log("[telemetry]", JSON.stringify(event));
    }
  }
}

/** Does nothing. The explicit choice for tests that don't care about
 * telemetry output, and the (intentionally alarming, see the launch
 * guard above) default for production until a real adapter is wired in. */
export class NoopTelemetryAdapter implements TelemetryAdapter {
  readonly name = "noop";
  async send(): Promise<void> {
    /* intentionally empty */
  }
}

/** Collects every event it receives in memory, for a regression suite to
 * assert against. Never used outside tests. */
export class CapturingTelemetryAdapter implements TelemetryAdapter {
  readonly name = "capturing";
  readonly events: TelemetryEvent[] = [];
  async send(events: TelemetryEvent[]): Promise<void> {
    this.events.push(...events);
  }
}

/** Always rejects -- used by regression tests to prove recordEvent()'s
 * failure isolation (lib/telemetry/index.ts) actually swallows an
 * adapter failure instead of propagating it to the caller. */
export class FailingTelemetryAdapter implements TelemetryAdapter {
  readonly name = "failing";
  constructor(private readonly reason = "simulated adapter failure") {}
  async send(): Promise<void> {
    throw new Error(this.reason);
  }
}

/** Never resolves -- used by regression tests to prove recordEvent()'s
 * bounded timeout actually bounds it, rather than hanging the caller. */
export class HangingTelemetryAdapter implements TelemetryAdapter {
  readonly name = "hanging";
  async send(): Promise<void> {
    await new Promise<void>(() => {
      /* deliberately never resolves */
    });
  }
}
