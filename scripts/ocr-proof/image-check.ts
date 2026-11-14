/**
 * Step 2 prototype (test tooling, never run by the app): can a checker that looks at the PAGE IMAGE catch figures the OCR
 * text got wrong? For each table row of the chosen pages (from a made-up document's ground truth) each checker model is
 * told only the row's label and column, never a figure, and copies the cell exactly as printed on the image. Its answer is
 * scored against the ground truth and against what Baidu's text says on that row.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/ocr-proof/image-check.ts <doc.pdf> <truth.json> <pages.json> <out.json> <firstPage> <lastPage> [model,model]
 * Uses DEARPOLICY_ANTHROPIC_KEY; spend counted from the API's token counts at the listed prices.
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Anthropic from "@anthropic-ai/sdk";
import { priceFor } from "@/lib/ai/providers";

const [pdf, truthPath, pagesPath, outPath, a, b, modelsArg] = process.argv.slice(2);
const truth = JSON.parse(readFileSync(truthPath, "utf8"));
const ocr: string[] = JSON.parse(readFileSync(pagesPath, "utf8"));
const first = Number(a), last = Number(b);
const models = (modelsArg ?? "claude-sonnet-5-5,claude-haiku-4-5").split(",");
const api = new Anthropic({ apiKey: process.env.DEARPOLICY_ANTHROPIC_KEY });
const tight = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");

const SYSTEM = "You check figures on an insurance document page against its image. For each requested table cell, find the row by its label and the column by its heading, and copy the cell EXACTLY as printed on the image: every character, the currency letters and symbols included (e.g. S$, US$, HK$, RM, €, £, ¥, ₹, SGD), digits, commas, decimals, % and words. Never guess, never correct, never convert. If you cannot see the cell, answer null.";
const schema = { type: "object", additionalProperties: false, required: ["cells"], properties: { cells: { type: "array", items: { type: "object", additionalProperties: false,
  required: ["n", "printed"], properties: { n: { type: "integer" }, printed: { type: ["string", "null"] } } } } } };

(async () => {
  const dir = mkdtempSync(join(tmpdir(), "imgchk-"));
  const results: unknown[] = []; let usd = 0;
  const tally: Record<string, { cells: number; right: number; wrong: number; none: number; caughtOcrErrors: number; ocrErrors: number }> = {};
  for (let p = first; p <= last; p++) {
    const pg = truth.page_lines[p - 1];
    let header: string[] = [];
    const cells: { label: string; column: string; text: string }[] = [];
    for (const ln of pg.lines) {
      if (ln.kind === "table_header") header = ln.cells;
      if (ln.kind === "table_row") ln.cells.slice(1).forEach((c: string, i: number) => cells.push({ label: ln.cells[0], column: header[i + 1] ?? "", text: c }));
    }
    if (!cells.length) continue;
    execFileSync("pdftoppm", ["-f", String(p), "-l", String(p), "-r", "150", "-png", "-singlefile", pdf, join(dir, "p")]);
    const img = readFileSync(join(dir, "p.png")).toString("base64");
    const ocrT = tight(ocr[p - 1] ?? "");
    const questions = cells.map((c, i) => `${i + 1}. row "${c.label}", column "${c.column}"`).join("\n");
    for (const model of models) {
      const r = await api.messages.create({ model, max_tokens: 4000, system: SYSTEM,
        messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: img } },
          { type: "text", text: `Page ${p}. Copy these cells exactly as printed:\n${questions}` }] }],
        output_config: { format: { type: "json_schema", schema } } } as never) as unknown as { content: { type: string; text?: string }[]; usage: { input_tokens: number; output_tokens: number } };
      const pr = priceFor({ provider: "anthropic", model }) ?? { input: 5, output: 25 };
      usd += (r.usage.input_tokens * pr.input + r.usage.output_tokens * pr.output) / 1e6;
      const got = JSON.parse(r.content.find((c) => c.type === "text")?.text ?? "{}").cells ?? [];
      const t = (tally[model] ??= { cells: 0, right: 0, wrong: 0, none: 0, caughtOcrErrors: 0, ocrErrors: 0 });
      cells.forEach((c, i) => {
        const ans = got.find((g: { n: number }) => g.n === i + 1)?.printed ?? null;
        const ok = ans != null && tight(ans) === tight(c.text);
        const ocrHasIt = ocrT.includes(tight(c.text));
        t.cells++; if (ans == null) t.none++; else if (ok) t.right++; else t.wrong++;
        if (!ocrHasIt && /\d/.test(c.text)) { t.ocrErrors++; if (ok) t.caughtOcrErrors++; }
        results.push({ page: p, model, ...c, image: ans, ok, ocrHasExact: ocrHasIt });
      });
    }
  }
  writeFileSync(outPath, JSON.stringify({ pages: [first, last], models, usd: Math.round(usd * 10000) / 10000, tally, results }, null, 1));
  console.log(JSON.stringify({ usd: Math.round(usd * 10000) / 10000, tally }));
})();
