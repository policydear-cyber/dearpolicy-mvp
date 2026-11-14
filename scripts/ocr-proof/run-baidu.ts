/**
 * OCR proof harness (test tooling, never run by the app): sends made-up PDFs to Baidu PaddleOCR one at a time through
 * the app's own client (lib/documents/ocr-baidu.ts submitBaiduJob + awaitBaiduJob: same host, model, options and
 * 50-page jobs) and keeps Baidu's FULL raw reply for every job next to what our parser (baiduPagesFromJsonl) kept.
 *
 *   BAIDU_AISTUDIO_TOKEN=... NODE_USE_ENV_PROXY=1 npx tsx scripts/ocr-proof/run-baidu.ts <pdfDir> <outDir> [doc ...]
 *
 * The token is read from the environment by the app's client and only sent in its Authorization header. This script
 * never prints, saves or logs a request header, and saves the result link without its signed query string.
 * Differences from production, stated in the report: the file is uploaded in the request (production hands Baidu a
 * signed storage link), calls go through Node's fetch (production uses node:https; same requests), and each job may
 * wait up to OCR_PROOF_WAIT_MIN minutes (production waits 90 s, then keeps retrying in the background).
 * Raw replies hold only made-up text; they stay out of git (write them outside the repository).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { PDFDocument } from "pdf-lib";
import { submitBaiduJob, awaitBaiduJob, baiduOcrSettings, setBaiduTransportForTests } from "@/lib/documents/ocr-baidu";
import { subsetPdf } from "@/lib/documents/ocr-hosted";

const [pdfDir, outDir, ...only] = process.argv.slice(2);
if (!pdfDir || !outDir) throw new Error("usage: run-baidu.ts <pdfDir> <outDir> [doc ...]");
const waitMin = Number(process.env.OCR_PROOF_WAIT_MIN ?? 30);
const DOWNLOAD_TRIES = Number(process.env.OCR_PROOF_DOWNLOAD_TRIES ?? 8);
const env = { ...process.env, BAIDU_OCR_SUBMIT: "upload", BAIDU_OCR_MAX_WAIT_MS: "240000" };
const settings = baiduOcrSettings(env);

// Capture every Baidu reply body; never a request header. Production's node:https transport is swapped for fetch only
// so the replies can be kept (the requests are the same).
type CallLog = { stage: string; host: string; path: string; status: number; ms: number; bytes: number };
let calls: CallLog[] = [];
let lastJsonl: string | null = null;
let lastStatus: unknown = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const t0 = Date.now();
  const res = await realFetch(input, init);
  const body = await res.text();
  const stage = init?.method === "POST" ? "submit" : url.pathname.includes("/api/v2/ocr/jobs/") ? "poll" : "result";
  calls.push({ stage, host: url.hostname, path: url.pathname, status: res.status, ms: Date.now() - t0, bytes: body.length });
  if (stage === "result") lastJsonl = body;
  if (stage === "poll") { try { lastStatus = JSON.parse(body); } catch { lastStatus = body.slice(0, 2000); } }
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}) as typeof fetch;
setBaiduTransportForTests("fetch");

/** The poll reply with the signed result link's query string removed (it is a short-lived secret). */
function scrubStatus(s: unknown): unknown {
  return JSON.parse(JSON.stringify(s ?? null, (k, v) => (typeof v === "string" && /^https?:\/\//.test(v) ? v.split("?")[0] : v)));
}

async function readDoc(file: string) {
  const name = basename(file, ".pdf");
  const dir = join(outDir, name);
  if (existsSync(join(dir, "done.json"))) {
    const prev = JSON.parse(readFileSync(join(dir, "done.json"), "utf8")) as { jobs: { ok?: boolean; jobId?: string }[] };
    if (prev.jobs.every((j) => j.ok)) { console.log(name, "already done"); return; }
    if (prev.jobs.some((j) => !j.ok && !j.jobId)) { console.log(name, "has a job with no Baidu job id: re-read whole doc"); }
    else { await refetchDoc(name, dir, prev); return; }
  }
  mkdirSync(dir, { recursive: true });
  const bytes = new Uint8Array(readFileSync(file));
  const total = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
  const all = Array.from({ length: total }, (_, i) => i + 1);
  const jobs: unknown[] = [];
  const parsedPages: string[] = [];
  const t0 = Date.now();
  for (let i = 0, k = 0; i < all.length; i += settings.pagesPerJob, k++) {
    const chunk = all.slice(i, i + settings.pagesPerJob);
    const part = chunk.length === total ? bytes : await subsetPdf(bytes, chunk);
    calls = []; lastJsonl = null; lastStatus = null;
    const j0 = Date.now();
    const end = Date.now() + waitMin * 60_000;
    let job: Record<string, unknown> = { chunk: k, pages: [chunk[0], chunk[chunk.length - 1]], uploadBytes: part.byteLength };
    try {
      const { jobId, submitted } = await submitBaiduJob(part, env, end);
      job.jobId = jobId;
      job.submitReply = scrubStatus(submitted);
      // A dropped DOWNLOAD of a finished job is not a re-read: poll the same job again (fresh signed link) and fetch
      // again, up to DOWNLOAD_TRIES times. Every drop is kept in job.downloadDrops and reported on its own.
      const drops: unknown[] = [];
      let res: Awaited<ReturnType<typeof awaitBaiduJob>> | null = null;
      for (let t = 0; t < DOWNLOAD_TRIES && !res; t++) {
        try { res = await awaitBaiduJob(jobId, env, end); } catch (e) {
          const err = e as { kind?: string; stage?: string; code?: string };
          if (err.kind !== "network" || err.stage !== "result" || t === DOWNLOAD_TRIES - 1) { job.downloadDrops = drops; throw e; }
          drops.push({ try: t, code: err.code }); await new Promise((r) => setTimeout(r, 2000 * (t + 1)));
        }
      }
      job.downloadDrops = drops;
      job = { ...job, ok: true, parsedPages: res!.pages.length, reportedModel: res!.model };
      parsedPages.push(...res!.pages);
    } catch (e) {
      const err = e as { kind?: string; status?: number; stage?: string; code?: string; message?: string };
      job = { ...job, ok: false, error: { kind: err.kind, status: err.status, stage: err.stage, code: err.code, message: err.message } };
      // Our parser did not return pages for this job: keep the place of every page so later pages stay aligned.
      parsedPages.push(...chunk.map(() => ""));
    }
    job.seconds = Math.round((Date.now() - j0) / 100) / 10;
    job.calls = calls;
    job.lastStatus = scrubStatus(lastStatus);
    if (lastJsonl !== null) writeFileSync(join(dir, `raw-chunk${k}.jsonl`), lastJsonl);
    jobs.push(job);
    console.log(name, `chunk ${k}`, job.ok ? "ok" : "FAILED", `${job.seconds}s`, job.ok ? "" : JSON.stringify(job.error));
  }
  writeFileSync(join(dir, "parsed-pages.json"), JSON.stringify(parsedPages));
  writeFileSync(join(dir, "done.json"), JSON.stringify({ doc: name, pages: total, model: settings.model, via: settings.via ?? null,
    options: { useDocOrientationClassify: true, markdownIgnoreLabels: [] }, seconds: Math.round((Date.now() - t0) / 1000), jobs }, null, 1));
}

/** Downloads again the results of finished jobs whose download dropped in an earlier pass (no new Baidu read). */
async function refetchDoc(name: string, dir: string, prev: { jobs: Record<string, unknown>[] } & Record<string, unknown>) {
  const parsed = JSON.parse(readFileSync(join(dir, "parsed-pages.json"), "utf8")) as string[];
  for (const job of prev.jobs) {
    if (job.ok) continue;
    calls = []; lastJsonl = null; lastStatus = null;
    const k = job.chunk as number; const [p0] = job.pages as number[];
    const end = Date.now() + waitMin * 60_000;
    const earlier = job.error;
    if ((earlier as { kind?: string } | undefined)?.kind === "job_failed") {
      // Baidu itself failed the job. With OCR_PROOF_RESUBMIT=1 the same pages are submitted ONCE more as a new job
      // (a measured single retry; the first-try failure stays in job.firstTryFailure).
      if (process.env.OCR_PROOF_RESUBMIT !== "1" || job.resubmit) continue;
      const bytes = new Uint8Array(readFileSync(join(pdfDir, `${name}.pdf`)));
      const [a, b] = job.pages as number[];
      const part = await subsetPdf(bytes, Array.from({ length: b - a + 1 }, (_, i) => a + i));
      const r0 = Date.now();
      const retry: Record<string, unknown> = {};
      try {
        const { jobId } = await submitBaiduJob(part, env, end);
        retry.jobId = jobId;
        let res: Awaited<ReturnType<typeof awaitBaiduJob>> | null = null; const rd: unknown[] = [];
        for (let t = 0; t < DOWNLOAD_TRIES && !res; t++) {
          try { res = await awaitBaiduJob(jobId, env, end); } catch (e) {
            const err = e as { kind?: string; stage?: string; code?: string };
            if (err.kind !== "network" || err.stage !== "result" || t === DOWNLOAD_TRIES - 1) throw e;
            rd.push({ try: t, code: err.code }); await new Promise((r) => setTimeout(r, 2000 * (t + 1)));
          }
        }
        res!.pages.forEach((p, i) => { parsed[p0 - 1 + i] = p; });
        Object.assign(retry, { ok: true, parsedPages: res!.pages.length, downloadDrops: rd });
        Object.assign(job, { ok: true, parsedPages: res!.pages.length, reportedModel: res!.model, error: undefined, firstTryFailure: earlier });
      } catch (e) {
        const err = e as { kind?: string; stage?: string; code?: string; message?: string };
        Object.assign(retry, { ok: false, error: { kind: err.kind, stage: err.stage, code: err.code, message: err.message } });
      }
      retry.seconds = Math.round((Date.now() - r0) / 100) / 10; retry.calls = calls; retry.lastStatus = scrubStatus(lastStatus);
      job.resubmit = retry;
      if (lastJsonl !== null) writeFileSync(join(dir, `raw-chunk${k}.jsonl`), lastJsonl);
      console.log(name, `chunk ${k}`, retry.ok ? "resubmit ok" : "RESUBMIT FAILED", `${retry.seconds}s`, retry.ok ? "" : JSON.stringify(retry.error));
      continue;
    }
    const drops: unknown[] = [];
    for (let t = 0; t < DOWNLOAD_TRIES; t++) {
      try {
        const res = await awaitBaiduJob(job.jobId as string, env, end);
        res.pages.forEach((p, i) => { parsed[p0 - 1 + i] = p; });
        Object.assign(job, { ok: true, parsedPages: res.pages.length, reportedModel: res.model, refetched: true, error: undefined, firstPassError: earlier });
        break;
      } catch (e) {
        const err = e as { kind?: string; stage?: string; code?: string; message?: string };
        drops.push({ try: t, code: err.code, kind: err.kind, stage: err.stage });
        if (err.kind !== "network" || err.stage !== "result") { job.error = { kind: err.kind, stage: err.stage, code: err.code, message: err.message }; break; }
        await new Promise((r) => setTimeout(r, 2000 * (t + 1)));
      }
    }
    job.refetchDrops = drops; job.refetchCalls = calls; job.lastStatus = scrubStatus(lastStatus);
    if (lastJsonl !== null) writeFileSync(join(dir, `raw-chunk${k}.jsonl`), lastJsonl);
    console.log(name, `chunk ${k}`, job.ok ? "refetched ok" : "REFETCH FAILED", JSON.stringify(drops.length));
  }
  writeFileSync(join(dir, "parsed-pages.json"), JSON.stringify(parsed));
  writeFileSync(join(dir, "done.json"), JSON.stringify(prev, null, 1));
}

(async () => {
  const files = readdirSync(pdfDir).filter((f) => f.endsWith(".pdf")).sort()
    .filter((f) => !only.length || only.includes(basename(f, ".pdf")));
  for (const f of files) await readDoc(join(pdfDir, f)); // one at a time, as DC asked
})();
