/**
 * The keep-awake ping for the Benefits page's function. An outside pinger (no sign-in) calls exactly
 * `GET /api/benefits?warm=1` every few minutes, so the Node function that serves Benefits stays loaded with its
 * database pool open and a household's first load is not a cold start. A signed-out request to any other API path
 * is refused by middleware.ts before it reaches a function, so such a ping would wake nothing.
 *
 * The exemption is exact: this path, GET or HEAD, and the query string `warm=1` with nothing else. The route answers
 * it before reading any session or household (204, no body), and reads no household data. Edge-safe: no Node imports.
 */
export const WARM_PING_PATH = "/api/benefits";

export function isWarmPing(request: { method: string; nextUrl?: { pathname: string; search: string }; url: string }): boolean {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  let pathname: string, search: string;
  if (request.nextUrl) ({ pathname, search } = request.nextUrl);
  else { try { ({ pathname, search } = new URL(request.url)); } catch { return false; } }
  return pathname === WARM_PING_PATH && search === "?warm=1";
}
