import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { unloadOllamaModelDirect, withOllamaLock } from "@/lib/ai/ollama-runtime";
import type { PdfPage } from "@/lib/documents/pdf";
import { modelFor, supportsHostedDocumentReading } from "@/lib/ai/providers";
import { completePdfPagesWithHostedOcr } from "@/lib/documents/ocr-hosted";

type BridgePage = { pageNumber: number; text: string };
type BridgeResult = { ok: boolean; pages?: BridgePage[]; error?: string };

function usableCharacters(text: string) {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

/** Select image-backed pages whose embedded text layer is missing or useless. */
export function pagesNeedingOcr(pages: PdfPage[]) {
  return pages
    .filter((page) => usableCharacters(page.text) < 24 && (page.imageCount ?? 0) > 0)
    .map((page) => page.pageNumber);
}

export function mergeOcrPages(pages: PdfPage[], ocrPages: BridgePage[]) {
  const replacements = new Map(
    ocrPages
      .filter((page) => Number.isInteger(page.pageNumber) && page.pageNumber > 0 && usableCharacters(page.text) >= 1)
      .map((page) => [page.pageNumber, page.text.trim()]),
  );
  return pages.map((page) => {
    const replacement = replacements.get(page.pageNumber);
    return replacement
      ? { ...page, text: replacement, extractionMethod: "ocr" as const }
      : page;
  });
}

async function exists(file: string) {
  try { await access(file); return true; } catch { return false; }
}

async function privatePython() {
  const configured = process.env.OCR_PYTHON_PATH?.trim();
  const candidates = [
    configured,
    process.platform === "win32"
      ? path.resolve("paddleocr-service", ".venv", "Scripts", "python.exe")
      : path.resolve("paddleocr-service", ".venv", "bin", "python"),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  throw new Error("OCR is needed for this scanned PDF. Double-click INSTALL-OCR.cmd once, then re-analyse the document.");
}

function configuredNumber(name: string, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

async function freeGpuForOcr() {
  const base = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  const models = [...new Set([
    process.env.LLM_MODEL ?? "qwen3.5:9b",
    process.env.EMBED_MODEL ?? "bge-m3",
  ])];
  for (const model of models) await unloadOllamaModelDirect(base, model);
}

async function runBridge(args: {
  python: string;
  bridge: string;
  request: Record<string, unknown>;
}) {
  const timeoutMs = configuredNumber("OCR_TIMEOUT_MS", 30 * 60_000, 60_000, 2 * 60 * 60_000);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(args.python, [args.bridge], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUTF8: "1" },
    });
    let output = "";
    const append = (chunk: Buffer) => { output = `${output}${chunk.toString("utf8")}`.slice(-12_000); };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", reject);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`PaddleOCR did not finish within ${Math.round(timeoutMs / 60_000)} minutes.`));
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`PaddleOCR stopped with code ${code}.${output ? ` ${output.trim().slice(-1200)}` : ""}`));
    });
    child.stdin.end(JSON.stringify(args.request));
  });
}

async function completePdfPagesWithLocalOcr(args: {
  bytes: Uint8Array;
  password?: string;
  pages: PdfPage[];
  pageNumbers?: number[];
}) {
  if (/^(0|false|off)$/i.test(process.env.OCR_ENABLED?.trim() ?? "")) return args.pages;
  const pageNumbers = args.pageNumbers ?? pagesNeedingOcr(args.pages);
  if (!pageNumbers.length) return args.pages;

  const python = await privatePython();
  const bridge = path.resolve("paddleocr-service", "ocr_bridge.py");
  if (!(await exists(bridge))) throw new Error("DearPolicy's PaddleOCR bridge is missing. Copy the complete update into the project again.");

  const temporary = await mkdtemp(path.join(os.tmpdir(), "dearpolicy-ocr-"));
  const pdfPath = path.join(temporary, "input.pdf");
  const resultPath = path.join(temporary, "result.json");
  try {
    await writeFile(pdfPath, args.bytes);
    await withOllamaLock(async () => {
      await freeGpuForOcr();
      await runBridge({
        python,
        bridge,
        request: {
          inputPath: pdfPath,
          resultPath,
          password: args.password ?? "",
          pageNumbers,
          dpi: configuredNumber("OCR_RENDER_DPI", 200, 120, 300),
          pipelineVersion: process.env.OCR_PIPELINE_VERSION ?? "v1.6",
          device: process.env.OCR_DEVICE ?? "auto",
        },
      });
    });

    const result = JSON.parse(await readFile(resultPath, "utf8")) as BridgeResult;
    if (!result.ok) throw new Error(result.error || "PaddleOCR could not read the selected pages.");
    const completed = result.pages ?? [];
    const missing = pageNumbers.filter((number) => !completed.some((page) => page.pageNumber === number && usableCharacters(page.text) > 0));
    if (missing.length) throw new Error(`PaddleOCR returned no usable text for page${missing.length === 1 ? "" : "s"} ${missing.join(", ")}.`);
    return mergeOcrPages(args.pages, completed);
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** True when a hosted, document-capable model is configured for the
 * "reading" job (MODEL_PRESET or READING_MODEL) — i.e. this deployment has
 * no local PaddleOCR install to fall back to, which is the normal case in
 * production (Vercel cannot run the local Python/GPU OCR bridge at all). */
function hostedOcrAvailable() {
  const choice = modelFor("reading");
  return choice.provider !== "ollama" && supportsHostedDocumentReading(choice.provider);
}

/** Fills in text for scanned (image-only) pages. Prefers a hosted,
 * document-capable model when one is configured — this is what production
 * uses, since Vercel cannot spawn the local PaddleOCR process. Falls back to
 * local PaddleOCR only when no hosted reading model is configured, which is
 * the normal local-development setup. */
export async function completePdfPagesWithOcr(args: {
  accountId: string;
  bytes: Uint8Array;
  password?: string;
  pages: PdfPage[];
  pageNumbers?: number[];
}) {
  if (/^(0|false|off)$/i.test(process.env.OCR_ENABLED?.trim() ?? "")) return args.pages;
  const pageNumbers = args.pageNumbers ?? pagesNeedingOcr(args.pages);
  if (!pageNumbers.length) return args.pages;

  if (hostedOcrAvailable()) {
    return completePdfPagesWithHostedOcr({ accountId: args.accountId, bytes: args.bytes, pages: args.pages, pageNumbers });
  }
  return completePdfPagesWithLocalOcr(args);
}
