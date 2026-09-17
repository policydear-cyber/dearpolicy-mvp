const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type OllamaGlobal = typeof globalThis & { __dearpolicyOllamaTail?: Promise<void>; __dearpolicyResident?: number };

/** Keeping the chat model resident for one phase.
 *
 * Every model call unloads the model afterwards so an 8 GB card is never left
 * occupied. That is correct BETWEEN phases and ruinous WITHIN one: reading ten
 * evidence windows meant loading a 9 B model from disk ten times, which
 * dominated the wall clock. Inside a session the model stays resident with a
 * short TTL and is unloaded exactly once when the session ends. */
export function modelIsResident() { return ((globalThis as OllamaGlobal).__dearpolicyResident ?? 0) > 0; }
export function residentKeepAlive() { return modelIsResident() ? (process.env.LLM_KEEP_ALIVE ?? "5m") : 0; }
export async function withResidentModel<T>(base: string, model: string, task: () => Promise<T>): Promise<T> {
  const state = globalThis as OllamaGlobal;
  state.__dearpolicyResident = (state.__dearpolicyResident ?? 0) + 1;
  try { return await task(); }
  finally {
    state.__dearpolicyResident = (state.__dearpolicyResident ?? 1) - 1;
    if (!modelIsResident()) await unloadOllamaModelDirect(base, model);
  }
}

/** Serialises local model work so Qwen and BGE-M3 never compete for 8 GB VRAM. */
export async function withOllamaLock<T>(task: () => Promise<T>): Promise<T> {
  const globalState = globalThis as OllamaGlobal;
  const previous = globalState.__dearpolicyOllamaTail ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  globalState.__dearpolicyOllamaTail = previous.then(() => current, () => current);
  await previous.catch(() => undefined);
  try { return await task(); } finally { release(); }
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

async function waitForOllama(base: string, maxWaitMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    try {
      const response = await fetch(`${base.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch { /* model/server may be recovering */ }
    await sleep(1000);
  }
  return false;
}

export async function ollamaFetch(
  url: string,
  init: RequestInit,
  options?: { label?: string; timeoutMs?: number; attempts?: number },
): Promise<Response> {
  const attempts = Math.max(1, options?.attempts ?? 2);
  const timeoutMs = options?.timeoutMs ?? 300_000;
  const label = options?.label ?? "Ollama request";
  const base = new URL(url).origin;
  let lastError = "Unknown Ollama error";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if (response.ok || !isRetryableStatus(response.status) || attempt === attempts) return response;
      const body = await response.text().catch(() => "");
      lastError = `${label} returned HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`;
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof Error && error.name === "AbortError") lastError = `${label} timed out after ${Math.round(timeoutMs / 1000)} seconds`;
      else lastError = error instanceof Error ? `${label} connection error: ${error.message}` : `${label} connection error`;
      if (attempt === attempts) break;
    }

    await waitForOllama(base, 15_000);
    await sleep(800 * attempt);
  }

  throw new Error(`${lastError}. The local AI model stopped responding during this step.`);
}

/** Explicitly releases a model and gives Windows a moment to reclaim VRAM. */
export async function unloadOllamaModelDirect(base: string, model: string) {
  try {
    await fetch(`${base.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: "", stream: false, keep_alive: 0 }),
      signal: AbortSignal.timeout(30_000),
    });
    await sleep(700);
  } catch { /* cleanup must never turn success into failure */ }
}
