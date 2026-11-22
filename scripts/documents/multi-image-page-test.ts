/** A scanned page that is several pictures (strips, tiles, a scan with a logo) or sits inside a form is put together on
 * one sheet, each picture where the page draws it, so it can be read; pages the rule cannot place (turned pictures,
 * masks) stay not read and say why. Made-up pages built here with pdf-lib. No database, no network, no model.
 *   node --import tsx scripts/documents/multi-image-page-test.ts */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;
import assert from "node:assert/strict";
import sharp from "sharp";
import { PDFDocument, degrees, rgb } from "pdf-lib";
import { paintedPictures, decodedPageImages } from "@/lib/documents/ocr-hosted";

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) { try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

const solid = async (w: number, h: number, rgb: [number, number, number]) =>
  new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).png().toBuffer());
const RED: [number, number, number] = [220, 20, 20], BLUE: [number, number, number] = [20, 20, 220], GREEN: [number, number, number] = [20, 200, 20];
async function pixel(png: Uint8Array, xFrac: number, yFrac: number) {
  const { data, info } = await sharp(Buffer.from(png)).raw().toBuffer({ resolveWithObject: true });
  const x = Math.floor(info.width * xFrac), y = Math.floor(info.height * yFrac);
  const i = (y * info.width + x) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}
const near = (got: number[], want: number[]) => got.every((v, i) => Math.abs(v - want[i]!) < 40);

async function main() {
await test("a page of two stacked strips is one sheet with each strip in place", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 300]);
  page.drawImage(await pdf.embedPng(await solid(200, 150, RED)), { x: 0, y: 150, width: 200, height: 150 });   // top half
  page.drawImage(await pdf.embedPng(await solid(200, 150, BLUE)), { x: 0, y: 0, width: 200, height: 150 });     // bottom half
  const why = new Map<number, string>();
  const got = await decodedPageImages(new Uint8Array(await pdf.save()), [1], undefined, why);
  const p = got.get(1); assert.ok(p, `no sheet: ${why.get(1)}`);
  assert.ok(near(await pixel(p.png, 0.5, 0.25), RED), "top strip should be red");
  assert.ok(near(await pixel(p.png, 0.5, 0.75), BLUE), "bottom strip should be blue");
  assert.deepEqual(p.box, [0, 0, 200, 300]);
});
await test("a picture inside an embedded page (a form) is placed too", async () => {
  const inner = await PDFDocument.create();
  inner.addPage([100, 100]).drawImage(await inner.embedPng(await solid(100, 100, GREEN)), { x: 0, y: 0, width: 100, height: 100 });
  const pdf = await PDFDocument.create();
  const [embedded] = await pdf.embedPdf(await inner.save(), [0]);
  const page = pdf.addPage([200, 200]);
  page.drawPage(embedded!, { x: 100, y: 100, width: 100, height: 100 });
  page.drawImage(await pdf.embedPng(await solid(60, 60, RED)), { x: 0, y: 0, width: 60, height: 60 });
  const why = new Map<number, string>();
  const got = await decodedPageImages(new Uint8Array(await pdf.save()), [1], undefined, why);
  const p = got.get(1); assert.ok(p, `no sheet: ${why.get(1)}`);
  assert.ok(near(await pixel(p.png, 0.75, 0.25), GREEN), "form picture top right should be green");
  assert.ok(near(await pixel(p.png, 0.1, 0.9), RED), "picture bottom left should be red");
  assert.ok(near(await pixel(p.png, 0.1, 0.1), [255, 255, 255]), "the rest of the sheet is white");
});
await test("control: a page that is exactly one picture still comes through as before", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([100, 100]).drawImage(await pdf.embedPng(await solid(100, 100, RED)), { x: 0, y: 0, width: 100, height: 100 });
  const got = await decodedPageImages(new Uint8Array(await pdf.save()), [1]);
  assert.ok(got.get(1) && near(await pixel(got.get(1)!.png, 0.5, 0.5), RED));
});
await test("control: a page with no picture is not made up, and says why", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([100, 100]);
  const why = new Map<number, string>();
  const got = await decodedPageImages(new Uint8Array(await pdf.save()), [1], undefined, why);
  assert.equal(got.has(1), false);
  assert.match(why.get(1) ?? "", /no picture/);
});
await test("control: a turned picture is not guessed at, and says why", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 200]);
  const img = await pdf.embedPng(await solid(100, 100, RED));
  page.drawImage(img, { x: 20, y: 20, width: 80, height: 80, rotate: degrees(30) });
  page.drawImage(await pdf.embedPng(await solid(50, 50, BLUE)), { x: 120, y: 120, width: 50, height: 50 });
  const why = new Map<number, string>();
  const got = await decodedPageImages(new Uint8Array(await pdf.save()), [1], undefined, why);
  assert.equal(got.has(1), false);
  assert.match(why.get(1) ?? "", /turned or sheared/);
});
await test("a small high-resolution logo does not set the size of the whole sheet", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 300]);
  page.drawImage(await pdf.embedPng(await solid(400, 300, RED)), { x: 0, y: 150, width: 200, height: 150 });   // 2 px per point
  page.drawImage(await pdf.embedPng(await solid(400, 300, BLUE)), { x: 0, y: 0, width: 200, height: 150 });
  page.drawImage(await pdf.embedPng(await solid(1000, 1000, GREEN)), { x: 5, y: 5, width: 10, height: 10 });   // 100 px per point
  const why = new Map<number, string>();
  const got = await decodedPageImages(new Uint8Array(await pdf.save()), [1], undefined, why);
  const p = got.get(1); assert.ok(p, `no sheet: ${why.get(1)}`);
  const info = await sharp(Buffer.from(p.png)).metadata();
  assert.ok((info.width ?? 0) <= 400 && (info.height ?? 0) <= 600, `sheet is ${info.width}x${info.height}, larger than the scan's own 400x600`);
});
await test("a page that draws the same picture twice in a row is placed, or refused with a reason, never half drawn", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 200]);
  const img = await pdf.embedPng(await solid(50, 50, RED));
  page.drawImage(img, { x: 0, y: 0, width: 50, height: 50 });
  page.drawImage(img, { x: 100, y: 100, width: 50, height: 50 });
  const why = new Map<number, string>();
  const got = await decodedPageImages(new Uint8Array(await pdf.save()), [1], undefined, why);
  const p = got.get(1);
  if (p) { assert.ok(near(await pixel(p.png, 0.15, 0.85), RED) && near(await pixel(p.png, 0.65, 0.35), RED), "both drawings must be on the sheet"); }
  else assert.match(why.get(1) ?? "", /repeated|picture/);
});
await test("control: printed text beside the pictures is not left off the sheet; the page says why it was not rebuilt", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 300]);
  page.drawImage(await pdf.embedPng(await solid(200, 150, RED)), { x: 0, y: 150, width: 200, height: 150 });
  page.drawImage(await pdf.embedPng(await solid(200, 150, BLUE)), { x: 0, y: 0, width: 200, height: 150 });
  page.drawText("Stamped total 1,234");
  const why = new Map<number, string>();
  const got = await decodedPageImages(new Uint8Array(await pdf.save()), [1], undefined, why);
  assert.equal(got.has(1), false);
  assert.match(why.get(1) ?? "", /text beside/);
});

await test("invisible text inside q/Q does not hide visible text drawn after Q", async () => {
  const OPS = { save: 1, restore: 2, transform: 3, setTextRenderingMode: 4, showText: 5, paintImageXObject: 6 } as Record<string, number>;
  const ops = (fns: number[]) => ({ fnArray: fns, argsArray: fns.map((f) => (f === 4 ? [3] : f === 6 ? ["img"] : [])) });
  const why: { reason?: string } = {};
  assert.equal(paintedPictures(ops([6, 1, 4, 5, 2, 5]), OPS, why), null);
  assert.match(why.reason ?? "", /text beside/);
  assert.ok(paintedPictures(ops([6, 1, 4, 5, 2]), OPS), "invisible text alone is fine");
});

await test("a shape drawn over a picture (a redaction), a clip, or transparency is refused with a reason, never shown uncovered", async () => {
  const build = async (extra: (page: ReturnType<PDFDocument["addPage"]>, img: Awaited<ReturnType<PDFDocument["embedPng"]>>) => void) => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([200, 300]);
    const img = await pdf.embedPng(await solid(200, 150, RED));
    page.drawImage(img, { x: 0, y: 150, width: 200, height: 150 });
    page.drawImage(await pdf.embedPng(await solid(200, 150, BLUE)), { x: 0, y: 0, width: 200, height: 150 });
    extra(page, img);
    const why = new Map<number, string>();
    const got = await decodedPageImages(new Uint8Array(await pdf.save()), [1], undefined, why);
    return { got, why };
  };
  const over = await build((page) => page.drawRectangle({ x: 0, y: 150, width: 200, height: 75, color: rgb(1, 1, 1) }));
  assert.equal(over.got.has(1), false); assert.match(over.why.get(1) ?? "", /shapes over/);
  const faded = await build((page, img) => page.drawImage(img, { x: 0, y: 0, width: 20, height: 20, opacity: 0.5 }));
  assert.equal(faded.got.has(1), false); assert.match(faded.why.get(1) ?? "", /transparency/);
});
await test("a clip or shading over the pictures is refused", async () => {
  const OPS = { save: 1, restore: 2, clip: 3, shadingFill: 4, paintImageXObject: 6 } as Record<string, number>;
  const ops = (fns: number[]) => ({ fnArray: fns, argsArray: fns.map((f) => (f === 6 ? ["img"] : [])) });
  for (const hide of [3, 4]) {
    const why: { reason?: string } = {};
    assert.equal(paintedPictures(ops([1, hide, 6, 2]), OPS, why), null);
    assert.match(why.reason ?? "", /clips or shades/);
  }
});
await test("a tall narrow tile keeps its vertical resolution", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 200]);
  page.drawImage(await pdf.embedPng(await solid(200, 4000, RED)), { x: 0, y: 0, width: 200, height: 200 });
  const got = await decodedPageImages(new Uint8Array(await pdf.save()), [1]);
  // a single picture takes the one-picture path; add a second so the sheet is composed
  const pdf2 = await PDFDocument.create();
  const p2 = pdf2.addPage([200, 200]);
  p2.drawImage(await pdf2.embedPng(await solid(200, 4000, RED)), { x: 0, y: 0, width: 200, height: 200 });
  p2.drawImage(await pdf2.embedPng(await solid(10, 10, BLUE)), { x: 0, y: 0, width: 5, height: 5 });
  const c = (await decodedPageImages(new Uint8Array(await pdf2.save()), [1])).get(1);
  assert.ok(c && got.get(1));
  assert.ok(((await sharp(Buffer.from(c.png)).metadata()).height ?? 0) >= 2000, "vertical resolution kept");
});

}
main().then(() => {
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`multi-image-page: ${passed} pass`);
}).catch((e) => { console.error(e); process.exit(1); });
