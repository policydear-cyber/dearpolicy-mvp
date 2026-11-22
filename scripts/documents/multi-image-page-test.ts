/** A scanned page that is several pictures (strips, tiles, a scan with a logo) or sits inside a form is put together on
 * one sheet, each picture where the page draws it, so it can be read; pages the rule cannot place (turned pictures,
 * masks) stay not read and say why. Made-up pages built here with pdf-lib. No database, no network, no model.
 *   node --import tsx scripts/documents/multi-image-page-test.ts */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;
import assert from "node:assert/strict";
import sharp from "sharp";
import { PDFDocument, degrees } from "pdf-lib";
import { decodedPageImages } from "@/lib/documents/ocr-hosted";

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
  pdf.addPage([100, 100]).drawText("Text only");
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

}
main().then(() => {
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`multi-image-page: ${passed} pass`);
}).catch((e) => { console.error(e); process.exit(1); });
