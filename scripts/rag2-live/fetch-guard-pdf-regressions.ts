/**
 * The live run's process-wide fetch guard on a scanned-page read (a Chat Completions PDF file part): the request is
 * reserved for its page images too (PDF_PAGE_IMAGE_TOKENS a page, counted with pdf-lib), records its kind and the
 * provider request id, and other billable hosts / unbounded requests are refused. No network, no key.
 *   node --import tsx scripts/rag2-live/fetch-guard-pdf-regressions.ts
 */
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { openAiDocumentRequest } from "@/lib/ai/providers";

async function main() {
  const doc = await PDFDocument.create(); doc.addPage([400, 400]);
  const b64 = Buffer.from(await doc.save()).toString("base64");
  const sent = openAiDocumentRequest({ provider: "openai", model: "gpt-6-luna" }, { system: "S", user: "U", pdfBase64: b64, maxOutputTokens: 2048 }) as any;
  // 9. The live run's fetch guard reserves a PDF request for its page images too, and refuses other billable hosts.
  const { installFetchGuard, pdfPartsOf, reservedInputTokens, PDF_PAGE_IMAGE_TOKENS } = await import("../../e2e/support/rag2-live-fetch-guard");
  const { RunCostLedger } = await import("@/lib/rag2/loop/usage-meter");
  const parts = await pdfPartsOf(sent);
  assert.deepEqual(parts.map((p) => p.pages), [1]);
  const raw = JSON.stringify(sent);
  assert.equal(reservedInputTokens(raw.length, parts), Math.ceil(raw.length / 2.5) + PDF_PAGE_IMAGE_TOKENS);
  const ledger = new RunCostLedger(0.05);
  const target = { fetch: (async () => new Response(JSON.stringify({ id: "chatcmpl-g", model: "gpt-6-luna", choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 1000, completion_tokens: 10 } }), { status: 200 })) as typeof fetch };
  const guard = installFetchGuard({ ledger, env: { OPENAI_BASE_URL: "http://fake-openai.test/v1" } as unknown as NodeJS.ProcessEnv, target });
  await target.fetch("http://fake-openai.test/v1/chat/completions", { method: "POST", body: raw });
  assert.equal(guard.calls[0].kind, "document");
  assert.equal(guard.calls[0].providerRequestId, "chatcmpl-g");
  assert.ok(guard.calls[0].reservedUsd >= (PDF_PAGE_IMAGE_TOKENS * 0.10 + sent.max_completion_tokens * 0.50) / 1e6, "page image reserved");
  await assert.rejects(() => target.fetch("https://dearpolicy-abc.svc.us-east-1.pinecone.io/records/namespaces/x/upsert", { method: "POST", body: "{}" }), /refused/);
  await assert.rejects(() => target.fetch("http://fake-openai.test/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "gpt-6-luna", messages: [] }) }), /no bounded max output/);
  guard.uninstall();

  console.log("rag2-live fetch guard: PDF request reserved for its page images, kind and provider request id recorded, Pinecone and unbounded requests refused -- passed.");
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
