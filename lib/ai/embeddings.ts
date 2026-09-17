import { fullyHosted } from "./providers";
import { ollamaFetch, unloadOllamaModelDirect, withOllamaLock } from "./ollama-runtime";

type EmbeddingOptions = {
  keepAlive?: string | number;
};

function baseUrl() {
  return (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
}

function embeddingModel() {
  return process.env.EMBED_MODEL ?? "bge-m3";
}

async function embedTextsDirect(input: string[], options?: EmbeddingOptions): Promise<number[][]> {
  if (!input.length) return [];
  const base = baseUrl();
  const model = embeddingModel();

  const response = await ollamaFetch(
    `${base}/api/embed`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input, keep_alive: options?.keepAlive ?? 0 }),
    },
    { label: `${model} embedding`, timeoutMs: 240_000, attempts: 3 },
  );

  if (!response.ok) {
    throw new Error(`Embedding service failed (${response.status}): ${await response.text()}`);
  }

  const payload = (await response.json()) as { embeddings?: number[][] };
  if (!payload.embeddings || payload.embeddings.length !== input.length) {
    throw new Error("Embedding service returned an unexpected response.");
  }
  return payload.embeddings;
}

/**
 * For one-off searches, BGE-M3 is unloaded immediately after the embedding so
 * Qwen can take the full GPU for the answer.
 */
/** Semantic search is the local fallback path's helper, not the product's
 * spine: answers come from stored rules, and retrieval already works on
 * full-text search alone. With every model job hosted there is no Ollama to
 * run BGE-M3, so embeddings are simply off — set EMBEDDINGS=on to keep them. */
export function embeddingsEnabled() {
  const setting = (process.env.EMBEDDINGS ?? "").trim().toLowerCase();
  if (setting === "off" || setting === "false" || setting === "0") return false;
  if (setting === "on" || setting === "true" || setting === "1") return true;
  return !fullyHosted();
}
export async function embedTexts(input: string[]): Promise<number[][]> {
  if (!embeddingsEnabled()) throw new Error("Embeddings are off");
  const base = baseUrl();
  const model = embeddingModel();
  return withOllamaLock(async () => {
    try {
      return await embedTextsDirect(input, { keepAlive: 0 });
    } finally {
      await unloadOllamaModelDirect(base, model);
    }
  });
}

/**
 * Keeps BGE-M3 resident across a whole document-indexing job, while holding the
 * Ollama lock so Qwen cannot be loaded midway through a batch. The embedding
 * model is explicitly unloaded when indexing finishes or errors.
 */
export async function withEmbeddingSession<T>(
  task: (embed: (input: string[]) => Promise<number[][]>) => Promise<T>,
): Promise<T> {
  const base = baseUrl();
  const model = embeddingModel();
  return withOllamaLock(async () => {
    try {
      const embed = (input: string[]) => embedTextsDirect(input, { keepAlive: "5m" });
      return await task(embed);
    } finally {
      await unloadOllamaModelDirect(base, model);
    }
  });
}

export function toPgVector(vector: number[]) {
  return `[${vector.map((n) => Number(n).toFixed(8)).join(",")}]`;
}
