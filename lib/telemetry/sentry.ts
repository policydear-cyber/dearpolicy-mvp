/** Sentry error monitoring, server side only (Node and Edge). Off unless SENTRY_DSN is set, so nothing is sent from a
 * preview, a test or a machine without it. No browser SDK: pages send nothing to Sentry, and the CSP is unchanged.
 * Every report passes scrubSentryEvent (sentry-scrub.ts) before it leaves, and the SDK is started with no default
 * integrations, no personal-data collection, no breadcrumbs, no tracing and no local variables. */
import { scrubSentryEvent } from "./sentry-scrub";

export function sentryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SENTRY_DSN?.trim()) && env.NODE_ENV === "production";
}

export async function initSentry(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!sentryEnabled(env)) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.VERCEL_ENV ?? "production",
    release: env.VERCEL_GIT_COMMIT_SHA,
    defaultIntegrations: false,
    integrations: [],
    includeLocalVariables: false,
    maxBreadcrumbs: 0,
    tracesSampleRate: 0,
    sendClientReports: false,
    beforeSend: (event) => scrubSentryEvent(event as never) as never,
    // Nothing but errors goes out: no transactions, logs or attachments.
    beforeSendTransaction: () => null,
  });
}
