"use client";
/** Browser side of Turnstile (lib/security/turnstile.ts). Resolves a fresh single-use token, or null when the check is off
 * (no site key), so callers send the field only when there is one. The widget is invisible unless Cloudflare needs the
 * person to do something; then it shows at the bottom right of the page. Each call makes its own widget and removes it. */
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
type Api = { render(el: HTMLElement, o: Record<string, unknown>): string; remove(id: string): void };
let loading: Promise<Api> | null = null;

export const turnstileSiteKey = (): string => (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "").trim();

function load(): Promise<Api> {
  const ready = () => (window as unknown as { turnstile?: Api }).turnstile;
  if (ready()) return Promise.resolve(ready()!);
  loading ??= new Promise<Api>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT; s.async = true;
    s.onload = () => (ready() ? resolve(ready()!) : reject(new Error("turnstile missing")));
    s.onerror = () => { loading = null; console.warn("[turnstile] the Cloudflare script did not load (blocked by the browser, an extension or the network)"); reject(new Error("turnstile blocked")); };
    document.head.appendChild(s);
  });
  return loading;
}

export async function getTurnstileToken(timeoutMs = 60_000): Promise<string | null> {
  const siteKey = turnstileSiteKey();
  if (!siteKey) return null;
  const api = await load();
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483000";
  document.body.appendChild(box);
  let id: string | null = null;
  const done = () => { try { if (id) api.remove(id); } catch { /* gone */ } box.remove(); };
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { console.warn("[turnstile] no answer from Cloudflare after " + Math.round(timeoutMs / 1000) + " seconds"); done(); reject(new Error("turnstile timeout")); }, timeoutMs);
    id = api.render(box, {
      sitekey: siteKey, appearance: "interaction-only",
      callback: (t: string) => { clearTimeout(timer); done(); resolve(t); },
      // Cloudflare's own error code (for example 110200: this site's domain is not on the widget's list; 110100/110110: the
      // site key is wrong) goes to the console only, so whoever sets this up can see why without a code reaching a household.
      "error-callback": (code?: unknown) => { console.warn("[turnstile] the check failed with Cloudflare error " + String(code ?? "unknown")); clearTimeout(timer); done(); reject(new Error("turnstile error")); return true; },
      "timeout-callback": () => console.warn("[turnstile] the check took too long and Cloudflare asked to retry"),
    });
  });
}
