/**
 * A per-IP brake for the endpoints anyone can call signed out (today /api/health; the Benefits keep-awake ping can use
 * the same one). Each call to them does real work (a database round trip, a search-service check), so one client
 * looping on them should not be able to make the app do that work without limit.
 *
 * In-memory and per instance (lib/http/rate-limit.ts): no database write per call, which would cost more than the
 * work it protects, and nothing that can fail. Generous on purpose: a 5-minute uptime or keep-awake ping, the sidebar's
 * once-a-minute check and the operator page's 30-second check from one office all stay far below it. Over the limit
 * the caller gets an empty 429 with Retry-After and nothing else. If counting ever throws, the call is let through:
 * these endpoints say whether the app is up, and must keep saying it.
 */
import { NextResponse } from "next/server";
import { clientKey, createRateLimiter } from "@/lib/http/rate-limit";

export const OPEN_ENDPOINT_WINDOW_MS = 60_000;
export const OPEN_ENDPOINT_MAX = 60;

const limiter = createRateLimiter({ windowMs: OPEN_ENDPOINT_WINDOW_MS, max: OPEN_ENDPOINT_MAX });

/** null when the call may go ahead; otherwise the 429 to return. `endpoint` keeps each endpoint's count separate. */
export function limitOpenEndpoint(request: Request, endpoint: string, now: number = Date.now()): NextResponse | null {
  try {
    const result = limiter.attempt(`${endpoint}|${clientKey(request)}`, now);
    if (result.allowed) return null;
    return new NextResponse(null, { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))), "Cache-Control": "private, no-store" } });
  } catch {
    return null;
  }
}
