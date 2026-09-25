import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { verifyAndConsumeCallback } from "@/lib/scanning/callback-auth";
import { recordPolicyScanResult } from "@/lib/policies/quarantine/store";
import { recordEvent } from "@/lib/telemetry";
import { resolveCorrelationId } from "@/lib/telemetry/correlation";
import { pseudonymizeId } from "@/lib/telemetry/pseudonymize";

export const runtime = "nodejs";
// Never reachable from a browser session -- authenticated by an HMAC
// signature over the raw request body instead (see
// lib/scanning/callback-auth.ts). middleware.ts's INTERNAL_CALLBACK_PATHS
// exempts this exact path from both the CSRF Origin check and the
// Supabase-session requirement for exactly this reason.
export const ROUTE_AUTH = "internal" as const;

const PayloadSchema = z.object({
  // Deliberately NO accountId/householdId field: which household this
  // callback affects is resolved server-side from the policy row itself
  // (see below), never from anything the caller supplies -- "a callback
  // must not be able to choose or change the household association".
  policyId: z.string().uuid(),
  eventId: z.string().min(1).max(200),
  verdict: z.enum(["clean", "infected"]),
  detail: z.string().max(2000).optional(),
});

/** Sanitized, structured logging only -- never the raw body, never a
 * provider payload field beyond the couple of identifiers needed to
 * correlate an incident, matching lib/claims/evidence/pipeline.ts's own
 * "no document text in logs" convention. */
function logRejectedCallback(provider: string, code: string, detail: string) {
  console.warn(`Policy scan-callback rejected [${code}] from provider "${provider}": ${detail}`);
}

export async function POST(request: NextRequest) {
  const provider = request.nextUrl.searchParams.get("provider")?.trim() || "unknown";
  const rawBody = await request.text();

  // The event id needed for replay protection lives inside the body, so it
  // is extracted (never trusted) before running full verification -- the
  // signature check below still runs over these exact raw bytes either
  // way, so a malformed or tampered body is caught there regardless of
  // whether JSON.parse happened to succeed. Exactly one verification call
  // is made per request, so replay protection is consumed at most once.
  let eventId: string | null = null;
  let parsed: z.infer<typeof PayloadSchema> | null = null;
  try {
    const candidate = PayloadSchema.parse(JSON.parse(rawBody));
    parsed = candidate;
    eventId = candidate.eventId;
  } catch {
    // Left as null -- verifyAndConsumeCallback() will reject a bad
    // signature first if that's ALSO wrong, or MISSING_EVENT_ID otherwise;
    // either way this request never reaches the database.
  }

  const result = await verifyAndConsumeCallback({
    provider,
    eventId,
    timestampHeader: request.headers.get("x-scan-timestamp"),
    signatureHeader: request.headers.get("x-scan-signature"),
    rawBody,
  });
  if (!result.ok) {
    logRejectedCallback(provider, result.code, result.message);
    // Checkpoint 14b: "malware scanning" was named as a required
    // telemetry call site -- a rejected scan callback (bad signature,
    // replay, expired timestamp) is exactly the kind of security-relevant
    // event lib/telemetry/alerts.ts's alert conditions are meant to
    // watch for. Never includes the raw signature/body -- only the
    // structural failure code, already safe by design.
    void recordEvent({
      name: "scan_callback.rejected",
      correlationId: resolveCorrelationId(request.headers.get("x-correlation-id")),
      route: "/api/policies/scan-callback",
      status: "failure",
      errorCategory: "scanner",
      extra: { provider, code: result.code },
    });
    const status = result.code === "REPLAYED_EVENT" ? 409 : 401;
    return NextResponse.json({ error: result.message }, { status });
  }
  if (!parsed) {
    // Signature was valid but the body didn't match the expected shape --
    // unreachable in practice (a real provider signs a real payload), but
    // handled explicitly rather than asserted away.
    logRejectedCallback(provider, "MALFORMED_PAYLOAD", "Signature verified but body did not match the expected payload shape.");
    void recordEvent({
      name: "scan_callback.rejected",
      correlationId: resolveCorrelationId(request.headers.get("x-correlation-id")),
      route: "/api/policies/scan-callback",
      status: "failure",
      errorCategory: "scanner",
      extra: { provider, code: "MALFORMED_PAYLOAD" },
    });
    return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  }

  // Resolve the household association from the STORED row, by policyId
  // alone -- never from the payload. An unknown policyId (deleted,
  // superseded, wrong id, or a probe) gets the exact same response as a
  // real one below: no existence signal leaks through an authenticated
  // request's response shape or status code either.
  const owner = await query<{ account_id: string }>(`SELECT account_id::text FROM policies WHERE id=$1 AND ${activePredicate()}`, [parsed.policyId]);
  const accountId = owner.rows[0]?.account_id;
  const correlationId = resolveCorrelationId(request.headers.get("x-correlation-id"));
  if (accountId) {
    await recordPolicyScanResult({
      accountId,
      policyId: parsed.policyId,
      status: parsed.verdict === "clean" ? "scan_clean" : "scan_rejected",
      scanProvider: provider,
      scanResultDetail: parsed.detail ?? null,
      scanEventId: parsed.eventId,
    });
    void recordEvent({
      name: "scan_callback.result",
      correlationId,
      route: "/api/policies/scan-callback",
      status: parsed.verdict === "clean" ? "success" : "failure",
      errorCategory: parsed.verdict === "clean" ? null : "scanner",
      householdRef: pseudonymizeId(accountId),
      resourceRef: pseudonymizeId(parsed.policyId),
      extra: { provider, verdict: parsed.verdict },
    });
  } else {
    // An authenticated callback for a policyId this account can no longer
    // resolve (deleted/superseded/unknown) -- worth knowing about
    // operationally even though the HTTP response stays identical to the
    // success case (no existence signal leaks through the response).
    void recordEvent({
      name: "scan_callback.unresolved_policy",
      correlationId,
      route: "/api/policies/scan-callback",
      status: "failure",
      errorCategory: "scanner",
      resourceRef: pseudonymizeId(parsed.policyId),
      extra: { provider },
    });
  }

  return NextResponse.json({ ok: true });
}
