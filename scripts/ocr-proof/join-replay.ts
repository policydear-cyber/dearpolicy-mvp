/**
 * OCR proof (test tooling): replays sameRowPairsJoined over every saved Baidu reply (made-up documents, outside the
 * repository) and lists each join, so wrong joins can be counted against the truth. No network, no model.
 *   npx tsx scripts/ocr-proof/join-replay.ts <runDir> <truthDir> [--all]   (--all lists every join, not only the doubtful ones)
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sameRowPairsJoined, baiduMarkdownToText, blocksMissingFromText } from "@/lib/documents/ocr-baidu";

const [runDir, truthDir, flag] = process.argv.slice(2);
const listAll = flag === "--all";
const tight = (s: string) => s.toLowerCase().replace(/[^a-z0-9%$.,]/g, "");
let pages = 0, joins = 0, right = 0; const wrong: string[] = [];
for (const doc of readdirSync(runDir).sort()) {
  const truthPath = join(truthDir, `${doc}.json`);
  if (!existsSync(truthPath)) continue;
  const truth = JSON.parse(readFileSync(truthPath, "utf8"));
  const chunks = readdirSync(join(runDir, doc)).filter((f) => /^raw-chunk\d+\.jsonl$/.test(f)).sort((a, b) => parseInt(a.slice(9)) - parseInt(b.slice(9)));
  for (const f of chunks) {
    const k = parseInt(f.slice(9));
    let i = 0;
    for (const line of readFileSync(join(runDir, doc, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      for (const item of JSON.parse(line).result?.layoutParsingResults ?? []) {
        const page = k * 50 + ++i; pages++;
        const text = blocksMissingFromText(item?.prunedResult?.parsing_res_list, baiduMarkdownToText(item?.markdown?.text ?? "")).text;
        const before = new Set(text.split(/\n{2,}/));
        const r = sameRowPairsJoined(item?.prunedResult?.parsing_res_list, text);
        const truthLines = (truth.page_lines[page - 1]?.lines ?? []).map((l: { text: string }) => tight(l.text));
        for (const p of r.text.split(/\n{2,}/).filter((p) => p.includes("\t") && !before.has(p))) {
          joins++;
          if (listAll) wrong.push(`${doc} p${page}: ${JSON.stringify(p)}`); if (truthLines.some((t: string) => t === tight(p))) right++; else wrong.push(`${doc} p${page}: ${JSON.stringify(p)}`);
        }
      }
    }
  }
}
console.log(JSON.stringify({ pages, joins, right, notExactlyATruthLine: wrong.length, wrong: wrong.slice(0, 100) }, null, 1));
