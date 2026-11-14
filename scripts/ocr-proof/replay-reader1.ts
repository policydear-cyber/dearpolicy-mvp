import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { checkStored, type StoredReading } from "@/lib/benefit-table/service";
const ROOT = "/mnt/project-files/ocr-proof";
const dir = process.argv[2];
const num = (x: string | null | undefined) => { if (!x) return null; const m = x.replace(/,/g, "").match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
const norm = (x: string | null | undefined) => (x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const per: string[] = [];
let right = 0, wrong = 0, none = 0, cells = 0; const why: Record<string, number> = {};
for (const f of readdirSync(dir).filter((f) => /-p\d+\.json$/.test(f))) {
  const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
  if (!r.reader1?.raw) continue;
  const ocr: string[] = JSON.parse(readFileSync(join(ROOT, "run-1", r.doc, "parsed-pages.json"), "utf8"));
  const pages = [{ page: r.page, text: ocr[r.page - 1] ?? "" }];
  const c = checkStored({ id: "d", name: `${r.doc}.pdf`, readable: true, pages }, r.reader1.raw as StoredReading);
  for (const d of c.dropped) { const k = d.why.replace(/[\d.,]+/g, "N"); why[k] = (why[k] ?? 0) + 1; }
  for (const row of r.rows) {
    cells++;
    const same = c.benefits.filter((b) => norm(b.benefit).includes(norm(row.label).slice(0, 14)) && (!b.column || !row.column || norm(b.column) === norm(row.column)));
    const v = same.map((b) => b.value).find((v) => v === row.value) ?? same.map((b) => b.value ?? b.cap).find((v) => v != null) ?? null;
    per.push(`${r.doc} p${r.page} ${row.label} | ${row.column} | truth ${row.value} | got ${v}`);
    if (v == null) none++; else if (v === row.value) right++; else wrong++;
  }
}
console.log(JSON.stringify({ cells, right, wrong, none, why, per }, null, 1));
