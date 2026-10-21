/** Pinecone as DearPolicy's vector database.
 *
 * Semantic search used to run on the machine that ran Ollama: BGE-M3 embedded
 * every passage at upload and the question at ask time. Hosted, there is no
 * such machine, so embeddings were simply off and retrieval fell back to
 * keyword matching alone — which finds "hospital" but not "admitted to Mount
 * Elizabeth for three nights".
 *
 * Pinecone closes that gap without bringing a model back. An index created
 * "for a model" embeds text on Pinecone's side, at upload and again at question
 * time, so nothing in this codebase ever handles a vector, and Vercel needs no
 * GPU. The index is created on first use, each household gets its own
 * namespace, and every record carries the chunk's Postgres id so retrieval can
 * join the two halves back together.
 *
 * Every call here is best-effort. A missing key, an index still initialising or
 * a Pinecone outage must never fail an upload or an answer: the stored benefit
 * rules and full-text search still work, they just work less well. */
import { recordErrorEvent, recordEvent } from "@/lib/telemetry";
import { resolveCorrelationId } from "@/lib/telemetry/correlation";
import { pseudonymizeId } from "@/lib/telemetry/pseudonymize";

const CONTROL_PLANE = "https://api.pinecone.io";
const API_VERSION = "2026-07";
/** The record field the index is configured to embed. */
const TEXT_FIELD = "chunk_text";
/** Pinecone embeds server-side on upsert and caps a request at 96 records. */
const UPSERT_BATCH = 96;
const DELETE_BATCH = 1000;

export type PineconePassage = {
  chunkId: string;
  policyId: string;
  pageStart: number;
  pageEnd: number;
  heading: string | null;
  text: string;
};
/** A hit, expressed as a cosine distance so it is interchangeable with what
 * pgvector used to return (0 = identical, 1 = unrelated). */
export type PineconeHit = { chunkId: string; policyId: string; distance: number };

export function pineconeEnabled() {
  return Boolean((process.env.PINECONE_API_KEY ?? "").trim());
}
function apiKey() {
  const key = (process.env.PINECONE_API_KEY ?? "").trim();
  if (!key) throw new Error("PINECONE_API_KEY is not set");
  return key;
}
export function pineconeIndexName() { return (process.env.PINECONE_INDEX ?? "dearpolicy").trim(); }
export function pineconeEmbeddingModel() { return (process.env.PINECONE_EMBED_MODEL ?? "llama-text-embed-v2").trim(); }
function pineconeCloud() { return (process.env.PINECONE_CLOUD ?? "aws").trim(); }
function pineconeRegion() { return (process.env.PINECONE_REGION ?? "us-east-1").trim(); }
/** One namespace per household: another family's passages are not reachable
 * from this household's query even if a filter were ever built wrongly. */
function namespaceFor(accountId: string) { return accountId; }
/** Record ids are prefixed with the document they came from so that re-reading
 * or deleting a document can find its records without a metadata filter, which
 * serverless indexes do not support for deletes. */
function recordId(policyId: string, chunkId: string) { return `${policyId}:${chunkId}`; }

async function controlPlane(path: string, init?: { method?: string; body?: string }) {
  return fetch(CONTROL_PLANE + path, {
    method: init?.method ?? "GET",
    body: init?.body,
    headers: { "Api-Key": apiKey(), "X-Pinecone-Api-Version": API_VERSION, "content-type": "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
}

type IndexDescription = { host?: string; status?: { ready?: boolean; state?: string } };

async function describeIndex(name: string): Promise<IndexDescription | null> {
  const response = await controlPlane(`/indexes/${encodeURIComponent(name)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Pinecone could not describe index "${name}" (${response.status}): ${await response.text()}`);
  return (await response.json()) as IndexDescription;
}

/** Creating the index is part of setting up, not a separate command the person
 * has to know about: the first document they upload makes it. */
async function createIndexForModel(name: string) {
  const response = await controlPlane("/indexes/create-for-model", {
    method: "POST",
    body: JSON.stringify({
      name,
      cloud: pineconeCloud(),
      region: pineconeRegion(),
      embed: { model: pineconeEmbeddingModel(), field_map: { text: TEXT_FIELD } },
    }),
  });
  // 409 means another upload created it a moment ago, which is the wanted state.
  if (response.ok || response.status === 409) return;
  throw new Error(`Pinecone could not create index "${name}" (${response.status}): ${await response.text()}`);
}

type HostCache = typeof globalThis & { __dearpolicyPineconeHost?: Promise<string> };

async function resolveHost(): Promise<string> {
  const name = pineconeIndexName();
  let description = await describeIndex(name);
  if (!description) {
    await createIndexForModel(name);
    description = await describeIndex(name);
  }
  // A brand new index takes a few seconds to come up. Wait, rather than
  // failing the very first upload a household ever makes.
  const deadline = Date.now() + 120_000;
  while (description && !description.status?.ready && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    description = await describeIndex(name);
  }
  const host = description?.host;
  if (!host) throw new Error(`Pinecone index "${name}" is not ready yet`);
  return host.startsWith("http") ? host : `https://${host}`;
}

function indexHost(): Promise<string> {
  const cache = globalThis as HostCache;
  // Resolved once per server instance; a failure is not cached, so the next
  // upload tries again rather than inheriting a bad result forever.
  if (!cache.__dearpolicyPineconeHost) {
    cache.__dearpolicyPineconeHost = resolveHost().catch((error) => {
      cache.__dearpolicyPineconeHost = undefined;
      throw error;
    });
  }
  return cache.__dearpolicyPineconeHost;
}

async function dataPlane(path: string, init: { method?: string; body?: string; contentType?: string; timeoutMs?: number }) {
  const host = await indexHost();
  const response = await fetch(host + path, {
    method: init.method ?? "POST",
    body: init.body,
    headers: { "Api-Key": apiKey(), "X-Pinecone-Api-Version": API_VERSION, "content-type": init.contentType ?? "application/json" },
    signal: AbortSignal.timeout(init.timeoutMs ?? 60_000),
  });
  if (!response.ok) throw new Error(`Pinecone request to ${path} failed (${response.status}): ${await response.text()}`);
  return response;
}

/** Indexes a document's passages. Pinecone generates the embeddings; this sends
 * text. Called once per document, during upload analysis. */
export async function indexPolicyPassages(args: {
  accountId: string;
  policyId: string;
  passages: PineconePassage[];
  report?: (indexed: number, total: number) => void | Promise<void>;
}) {
  if (!args.passages.length) return 0;
  const namespace = encodeURIComponent(namespaceFor(args.accountId));
  let indexed = 0;
  // Checkpoint 14i: "Embeddings" was named as a required telemetry call
  // site (scripts/launch-check.ts's privacy_safe_observability
  // capability) -- this is the real, one chokepoint every embedding
  // request goes through (Pinecone generates the embeddings server-side
  // on upsert; nothing in this codebase ever handles a vector directly --
  // see this file's own doc comment), so one event per document indexed
  // genuinely covers it, the same "one call = one event" convention every
  // other Checkpoint 14b/14i call site uses.
  const correlationId = resolveCorrelationId(undefined);
  const householdRef = pseudonymizeId(args.accountId);
  try {
    for (let i = 0; i < args.passages.length; i += UPSERT_BATCH) {
      const batch = args.passages.slice(i, i + UPSERT_BATCH);
      const ndjson = batch
        .map((passage) => JSON.stringify({
          _id: recordId(args.policyId, passage.chunkId),
          [TEXT_FIELD]: passage.text,
          chunk_id: passage.chunkId,
          policy_id: passage.policyId,
          page_start: passage.pageStart,
          page_end: passage.pageEnd,
          ...(passage.heading ? { heading: passage.heading } : {}),
        }))
        .join("\n");
      await dataPlane(`/records/namespaces/${namespace}/upsert`, { body: ndjson, contentType: "application/x-ndjson", timeoutMs: 120_000 });
      indexed += batch.length;
      await args.report?.(indexed, args.passages.length);
    }
    void recordEvent({
      name: "rag.embeddings.indexed",
      correlationId,
      status: "success",
      householdRef,
      resourceRef: pseudonymizeId(args.policyId),
      extra: { passages: indexed },
    });
    return indexed;
  } catch (error) {
    void recordErrorEvent({
      name: "rag.embeddings.index_failed",
      correlationId,
      householdRef,
      resourceRef: pseudonymizeId(args.policyId),
      error,
      extra: { passagesAttempted: args.passages.length, passagesIndexed: indexed },
    });
    throw error;
  }
}

/** The semantic half of retrieval: which stored passages read like an answer to
 * this question. Returns chunk ids and distances; the passages themselves are
 * still read from Postgres, which stays the one source of truth for text. */
export async function searchPolicyPassages(args: {
  accountId: string;
  policyIds: string[];
  text: string;
  topK: number;
}): Promise<PineconeHit[]> {
  const question = args.text.trim();
  if (!question || !args.policyIds.length) return [];
  const namespace = encodeURIComponent(namespaceFor(args.accountId));
  const response = await dataPlane(`/records/namespaces/${namespace}/search`, {
    body: JSON.stringify({
      query: {
        top_k: Math.min(Math.max(Math.round(args.topK), 1), 100),
        filter: { policy_id: { $in: args.policyIds } },
        inputs: { text: question.slice(0, 8_000) },
      },
      fields: ["chunk_id", "policy_id"],
    }),
    timeoutMs: 30_000,
  });
  const payload = (await response.json()) as { result?: { hits?: { _id: string; _score: number; fields?: Record<string, unknown> }[] } };
  return (payload.result?.hits ?? []).flatMap((hit) => {
    const fields = hit.fields ?? {};
    const chunkId = typeof fields.chunk_id === "string" ? fields.chunk_id : hit._id.split(":")[1];
    const policyId = typeof fields.policy_id === "string" ? fields.policy_id : hit._id.split(":")[0];
    if (!chunkId || !policyId) return [];
    const score = Number(hit._score);
    // Cosine similarity in, cosine distance out, so callers and thresholds that
    // were written against pgvector keep their meaning.
    const distance = Number.isFinite(score) ? Math.min(Math.max(1 - score, 0), 2) : 1;
    return [{ chunkId, policyId, distance }];
  });
}

async function listRecordIds(namespace: string, prefix: string) {
  const ids: string[] = [];
  let paginationToken: string | undefined;
  do {
    const search = new URLSearchParams({ prefix, namespace: decodeURIComponent(namespace), limit: "100" });
    if (paginationToken) search.set("paginationToken", paginationToken);
    const response = await dataPlane(`/vectors/list?${search.toString()}`, { method: "GET", timeoutMs: 30_000 });
    const payload = (await response.json()) as { vectors?: { id?: string }[]; pagination?: { next?: string } };
    for (const vector of payload.vectors ?? []) if (vector.id) ids.push(vector.id);
    paginationToken = payload.pagination?.next;
  } while (paginationToken);
  return ids;
}

/** Removes a document's passages. Re-reading a document and deleting one both
 * go through here, so the index never keeps sentences from a page that is no
 * longer in the household's documents. */
export async function deletePolicyPassages(args: { accountId: string; policyId: string }) {
  const namespace = encodeURIComponent(namespaceFor(args.accountId));
  const ids = await listRecordIds(namespace, `${args.policyId}:`);
  for (let i = 0; i < ids.length; i += DELETE_BATCH) {
    await dataPlane("/vectors/delete", {
      body: JSON.stringify({ ids: ids.slice(i, i + DELETE_BATCH), namespace: decodeURIComponent(namespace) }),
      timeoutMs: 30_000,
    });
  }
  return ids.length;
}

/** Removes every passage of a household: its whole namespace. Deleting a
 * household goes through here, so the passage text Pinecone stores does not
 * outlive the household it belonged to. A namespace that was never created
 * (a household that uploaded nothing) is already in the wanted state. */
export async function deleteHouseholdPassages(args: { accountId: string }) {
  const host = await indexHost();
  const response = await fetch(host + "/vectors/delete", {
    method: "POST",
    body: JSON.stringify({ deleteAll: true, namespace: namespaceFor(args.accountId) }),
    headers: { "Api-Key": apiKey(), "X-Pinecone-Api-Version": API_VERSION, "content-type": "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`Pinecone request to /vectors/delete failed (${response.status}): ${await response.text()}`);
}

/** How many passages of one document the index is holding. Used to decide
 * whether a document uploaded before Pinecone existed still needs indexing,
 * which is asked of Pinecone rather than tracked in a column so the answer
 * survives the index being rebuilt or swapped. */
export async function countPolicyPassages(args: { accountId: string; policyId: string }) {
  const namespace = encodeURIComponent(namespaceFor(args.accountId));
  const ids = await listRecordIds(namespace, `${args.policyId}:`);
  return ids.length;
}

/** For the health page: is semantic search actually working right now. */
export async function describePineconeState(): Promise<{ ok: boolean; detail: string; fix?: string }> {
  if (!pineconeEnabled()) {
    return { ok: true, detail: "Not configured — keyword search only", fix: "Set PINECONE_API_KEY to turn semantic search on." };
  }
  try {
    const description = await describeIndex(pineconeIndexName());
    if (!description) return { ok: true, detail: `Index "${pineconeIndexName()}" will be created on the next upload` };
    if (!description.status?.ready) return { ok: false, detail: `Index "${pineconeIndexName()}" is ${description.status?.state ?? "initialising"}`, fix: "Wait for the index to finish initialising in the Pinecone console." };
    return { ok: true, detail: `${pineconeIndexName()} · ${pineconeEmbeddingModel()}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "Cannot reach Pinecone", fix: "Check PINECONE_API_KEY in your hosting dashboard." };
  }
}
