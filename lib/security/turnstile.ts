/** Cloudflare Turnstile: a bot check on sign-up and on starting an upload, so a script cannot create accounts or push
 * documents at the model budget. Off unless BOTH TURNSTILE_SECRET_KEY and NEXT_PUBLIC_TURNSTILE_SITE_KEY are set, so a
 * half-configured deployment never locks everyone out. When on, a missing, invalid, expired or reused token is refused,
 * and so is a check that cannot be reached (the visitor is asked to try again). The emailed confirmation and PKCE
 * sign-in links never pass through here: they are not forms a person fills in. */
export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_FAILED_MESSAGE = "We couldn't confirm you are a person. Wait a moment, then try again.";

export function turnstileOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.TURNSTILE_SECRET_KEY?.trim()) && Boolean(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim());
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** true when the check passes or is off. The token is single use and expires after 5 minutes (Cloudflare). */
export async function turnstilePasses(token: unknown, remoteIp: string | null, opts: { env?: NodeJS.ProcessEnv; fetchImpl?: Fetch; timeoutMs?: number } = {}): Promise<boolean> {
  const env = opts.env ?? process.env;
  if (!turnstileOn(env)) return true;
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY!.trim(), response: token });
  if (remoteIp) form.set("remoteip", remoteIp);
  try {
    const res = await (opts.fetchImpl ?? fetch)(TURNSTILE_VERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(opts.timeoutMs ?? 5000) });
    if (!res.ok) return false;
    const out = (await res.json().catch(() => null)) as { success?: unknown } | null;
    return out?.success === true;
  } catch { return false; }
}

/** The caller's address as the platform reports it (Vercel sets x-forwarded-for); only passed to Cloudflare as a hint. */
export function callerIp(request: Request): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || null;
}
