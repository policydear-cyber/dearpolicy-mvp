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
    s.onerror = () => { loading = null; reject(new Error("turnstile blocked")); };
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
    const timer = setTimeout(() => { done(); reject(new Error("turnstile timeout")); }, timeoutMs);
    id = api.render(box, {
      sitekey: siteKey, appearance: "interaction-only",
      callback: (t: string) => { clearTimeout(timer); done(); resolve(t); },
      "error-callback": () => { clearTimeout(timer); done(); reject(new Error("turnstile error")); },
    });
  });
}
