/**
 * Conversational RAG: passage search and page reads over the household's stored page text (policy_pages).
 *
 * Household-scoped and lifecycle-filtered through ./store (active, released, current, read documents only). Ranking
 * is lexical BM25 over passages (a paragraph, or a window of at most six lines of one); when the existing Pinecone
 * index is configured (lib/rag/pinecone.ts) its hits boost the pages they come from -- a worse ranking without it,
 * never a failed search. Every hit carries an EvidenceRef whose passage is the page's verbatim slice.
 */
import { query } from "@/lib/db/client";
import { pineconeEnabled, searchPolicyPassages } from "@/lib/rag/pinecone";
import { evidenceAt, refineEvidence, type EvidenceRef } from "./evidence";
import { loadDocs, loadLinks, loadPages, type DocRow } from "./store";

export type PassageHit = {
  policyId: string; productName: string | null; insurer: string | null; page: number;
  text: string; score: number; matched: string[]; evidence: EvidenceRef;
};
export type SearchResult = { query: string; retrieval: "lexical" | "lexical+semantic"; hits: PassageHit[]; searchedPolicyIds: string[] };

const STOP = new Set("a an and are as at be by can do does for from has have how i if in is it its me my of on or our per the their this to was we what when where which who will with you your about any much many cover covered covering insurance policy".split(" "));
/** Lower-case word tokens with a light plural / -ing fold ("fractures" -> "fracture"). */
export function tokens(text: string): string[] {
  return (text.toLowerCase().normalize("NFKC").match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [])
    .map((w) => w.replace(/'s$/, ""))
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith("ies") ? w.slice(0, -3) + "y" : w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w));
}

type Unit = { policyId: string; page: number; start: number; end: number; text: string; toks: string[] };
/** A page split into passages: blank-line-separated paragraphs, long ones cut into windows of six lines. */
export function passagesOf(pageText: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const lines: { start: number; end: number; blank: boolean }[] = [];
  let at = 0;
  for (const raw of pageText.split("\n")) { lines.push({ start: at, end: at + raw.length, blank: !raw.trim() }); at += raw.length + 1; }
  let block: typeof lines = [];
  const flush = () => {
    for (let i = 0; i < block.length; i += 6) { const w = block.slice(i, i + 6); out.push({ start: w[0].start, end: w[w.length - 1].end }); }
    block = [];
  };
  for (const l of lines) { if (l.blank) flush(); else block.push(l); }
  flush();
  return out.filter((p) => p.end > p.start);
}

/** BM25 (k1 1.2, b 0.75) of each unit for the query tokens. */
function bm25(units: Unit[], q: string[]): number[] {
  const N = units.length || 1, avg = units.reduce((s, u) => s + u.toks.length, 0) / N || 1;
  const df = new Map<string, number>();
  for (const u of units) for (const t of new Set(u.toks)) df.set(t, (df.get(t) ?? 0) + 1);
  return units.map((u) => {
    const tf = new Map<string, number>();
    for (const t of u.toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0;
    for (const t of new Set(q)) {
      const f = tf.get(t) ?? 0; if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      s += idf * (f * 2.2) / (f + 1.2 * (1 - 0.75 + 0.75 * u.toks.length / avg));
    }
    return s;
  });
}

/** Pages Pinecone ranks for the query (only when it is configured); never throws. */
async function semanticPages(accountId: string, policyIds: string[], text: string): Promise<Map<string, number> | null> {
  if (!pineconeEnabled() || !policyIds.length) return null;
  try {
    const hits = await searchPolicyPassages({ accountId, policyIds, text, topK: 28 });
    if (!hits.length) return new Map();
    const rows = (await query<{ id: string; policy_id: string; page_start: number; page_end: number }>(
      `SELECT c.id::text AS id, c.policy_id::text AS policy_id, c.page_start, c.page_end FROM policy_chunks c WHERE c.account_id=$1 AND c.id::text = ANY($2::text[])`,
      [accountId, hits.map((h) => h.chunkId)])).rows;
    const dist = new Map(hits.map((h) => [h.chunkId, h.distance]));
    const out = new Map<string, number>();
    for (const r of rows) for (let p = r.page_start; p <= r.page_end; p++) {
      const k = r.policy_id + "#" + p, s = 1 - (dist.get(r.id) ?? 1);
      out.set(k, Math.max(out.get(k) ?? 0, s));
    }
    return out;
  } catch (error) {
    console.warn("rag2 semantic search unavailable:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** The documents a search may read: readable ones, narrowed to `policyIds`, and to those linked to `subjectId`. */
async function searchableDocs(accountId: string, subjectId?: string | null, policyIds?: string[] | null): Promise<DocRow[]> {
  const docs = await loadDocs(accountId, policyIds ?? null);
  if (!subjectId) return docs;
  const links = await loadLinks(accountId, docs.map((d) => d.id));
  const linked = new Set(links.filter((l) => l.memberId === subjectId).map((l) => l.policyId));
  return docs.filter((d) => linked.has(d.id) || d.ownerId === subjectId);
}

/** Ranked passages for `query` from the household's readable documents. */
export async function searchPassages(args: { accountId: string; query: string; subjectId?: string | null; policyIds?: string[] | null; k?: number }): Promise<SearchResult> {
  const k = Math.max(1, Math.min(Math.trunc(args.k ?? 8), 50));
  const docs = await searchableDocs(args.accountId, args.subjectId, args.policyIds);
  const q = tokens(args.query ?? "");
  if (!docs.length || !q.length) return { query: args.query, retrieval: "lexical", hits: [], searchedPolicyIds: docs.map((d) => d.id) };
  const pages = await loadPages(args.accountId, docs.map((d) => d.id));
  const units: Unit[] = [];
  for (const p of pages) for (const s of passagesOf(p.text)) { const text = p.text.slice(s.start, s.end); units.push({ policyId: p.policyId, page: p.page, start: s.start, end: s.end, text, toks: tokens(text) }); }
  const lexical = bm25(units, q);
  const semantic = await semanticPages(args.accountId, docs.map((d) => d.id), args.query);
  const max = Math.max(...lexical, 1e-9);
  const byId = new Map(docs.map((d) => [d.id, d]));
  const pageText = new Map(pages.map((p) => [p.policyId + "#" + p.page, p.text]));
  const qs = new Set(q);
  const ranked = units.map((u, i) => ({ u, lex: lexical[i], score: lexical[i] / max + (semantic?.get(u.policyId + "#" + u.page) ?? 0) * 0.5 }))
    .filter((x) => x.lex > 0)
    .sort((a, b) => b.score - a.score || a.u.policyId.localeCompare(b.u.policyId) || a.u.page - b.u.page || a.u.start - b.u.start)
    .slice(0, k);
  const byPolicy = new Map<string, Map<number, string>>();
  for (const p of pages) { if (!byPolicy.has(p.policyId)) byPolicy.set(p.policyId, new Map()); byPolicy.get(p.policyId)!.set(p.page, p.text); }
  const hits: PassageHit[] = ranked.map(({ u, score }) => {
    const d = byId.get(u.policyId)!;
    // The passage is the retrieval unit; `support` pins the sentence / row in it that matches the query, with the
    // table header, continued header or footnote it needs (lib/rag2/evidence.ts refineEvidence).
    const evidence = refineEvidence(evidenceAt({ policyId: u.policyId, documentHash: d.fileHash, page: u.page, pageText: pageText.get(u.policyId + "#" + u.page)!, start: u.start, end: u.end, subjectId: args.subjectId ?? null }), byPolicy.get(u.policyId)!, args.query);
    return {
      policyId: u.policyId, productName: d.productName, insurer: d.insurer, page: u.page, text: u.text, score: Math.round(score * 1e4) / 1e4,
      matched: [...new Set(u.toks.filter((t) => qs.has(t)))],
      evidence,
    };
  });
  return { query: args.query, retrieval: semantic ? "lexical+semantic" : "lexical", hits, searchedPolicyIds: docs.map((d) => d.id) };
}

export type PageRead = { status: "ok"; policyId: string; page: number; pageCount: number; text: string; productName: string | null; evidence: EvidenceRef } | { status: "missing"; reason: string };

/** One stored page of one readable household document, whole, with an EvidenceRef spanning it. */
export async function readPage(args: { accountId: string; policyId: string; page: number }): Promise<PageRead> {
  const [doc] = await loadDocs(args.accountId, [args.policyId]);
  if (!doc) return { status: "missing", reason: "that document is not one of this household's readable documents" };
  const all = await loadPages(args.accountId, [doc.id]);
  const p = all.find((x) => x.page === Math.trunc(args.page));
  if (!p) return { status: "missing", reason: `page ${args.page} of that document is not stored (it has ${all.length} stored page${all.length === 1 ? "" : "s"})` };
  return { status: "ok", policyId: doc.id, page: p.page, pageCount: all.length, text: p.text, productName: doc.productName, evidence: evidenceAt({ policyId: doc.id, documentHash: doc.fileHash, page: p.page, pageText: p.text, start: 0, end: p.text.length }) };
}
