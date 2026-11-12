/** Linking a household's sections to its covers is never cut silently (Live, 12 Nov: 150 sections in one call used all
 * 8,000 output tokens twice, the cut reply was dropped, and no section was linked, with nothing said). Sections are asked
 * in groups; a group whose reply runs out is asked again as two halves; a cut reply is never used in part; a call stopped
 * at the time limit stops the linking and keeps the links in place. Fake model, made-up sections: no database, network or
 * paid call.
 *   npm run -s benefit-table:link-cut-test */
import assert from "node:assert/strict";
import { askLinks, LINK_MAX_OUTPUT, LINK_SECTIONS_PER_CALL } from "@/lib/benefit-table/service";
import type { TableCall, TableModel, TableReply } from "@/lib/benefit-table/model";
import type { CoverType, SectionRef } from "@/lib/benefit-table/reading";

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
const sections = (n: number): SectionRef[] => Array.from({ length: n }, (_, i) => ({ key: `doc-${i % 7}|Section ${i}|`, document: `Made-up schedule ${i % 7}`, kind: "schedule", product: "Lotus Shield", section: `Section ${i}`, column: null, examples: ["Ward charges"] }));
const COVERS: CoverType[] = [{ key: "lotus-shield", product: "Lotus Shield", cover: "Hospital", plan: null, riderOf: null, holders: ["Alex Tan Wei"] }];
const keysIn = (c: TableCall) => [...c.user.matchAll(/"key":"(doc-[^"]+)"/g)].map((m) => m[1]);
/** A fake model: runs out of output when asked about more than `room` sections (giving a cut, partial reply). */
function fake(room: number, opts: { timeoutAt?: number } = {}) {
  const asked: number[] = [];
  const model: TableModel = { choice: { provider: "anthropic", model: "fake-model" } as TableModel["choice"], async call(c) {
    const keys = keysIn(c); asked.push(keys.length);
    const base = { model: "fake-model", input: 100, ms: 1 };
    if (opts.timeoutAt != null && asked.length >= opts.timeoutAt) return { ...base, json: null, stopReason: "timeout", output: 0 } as TableReply;
    if (keys.length > room) return { ...base, json: { links: keys.slice(0, 2).map((k) => ({ section: k, cover: null, why: "cut" })) }, stopReason: "max_tokens", output: c.maxTokens } as TableReply;
    return { ...base, json: { links: keys.map((k) => ({ section: k, cover: "lotus-shield", why: "Same product." })) }, stopReason: "end_turn", output: 50 * keys.length } as TableReply;
  } };
  return { model, asked };
}

async function main() {
  await test("L0 room: at most 40 sections a call, 16,000 output tokens", () => { assert.equal(LINK_SECTIONS_PER_CALL, 40); assert.ok(LINK_MAX_OUTPUT >= 16_000); });
  await test("L1 150 sections are asked in groups and every one is linked", async () => {
    const f = fake(1000); const r = await askLinks(f.model, sections(150), COVERS);
    assert.deepEqual(f.asked, [40, 40, 40, 30]); assert.equal(r.links.length, 150); assert.equal(r.unasked, 0); assert.equal(r.timedOut, false);
    assert.ok(r.links.every((l) => l.cover === "lotus-shield"));
  });
  await test("L2 a group that runs out is asked again as two halves; its cut reply is never used", async () => {
    const f = fake(25); const r = await askLinks(f.model, sections(50), COVERS);
    assert.deepEqual(f.asked, [40, 20, 20, 10]); assert.equal(r.links.length, 50);
    assert.ok(r.links.every((l) => l.why !== "cut"), "no link from a cut reply");
    assert.equal(new Set(r.links.map((l) => l.section)).size, 50);
  });
  await test("L3 a single section that still runs out keeps its link and is counted, never used in part", async () => {
    const f = fake(0); const warn = console.warn; const said: string[] = []; console.warn = (m: string) => { said.push(m); };
    try { const r = await askLinks(f.model, sections(2), COVERS); assert.equal(r.links.length, 0); assert.equal(r.unasked, 2); }
    finally { console.warn = warn; }
    assert.ok(said.some((m) => /ran out of output/.test(m)) && said.some((m) => /got no usable answer/.test(m)), said.join(" | "));
  });
  await test("L4 a call stopped at the time limit stops the linking (the caller keeps every link in place)", async () => {
    const f = fake(1000, { timeoutAt: 2 }); const r = await askLinks(f.model, sections(100), COVERS, undefined, 60_000);
    assert.equal(r.timedOut, true); assert.deepEqual(f.asked, [40, 40]);
  });
  await test("L5 with no time left nothing is asked", async () => {
    const f = fake(1000); const r = await askLinks(f.model, sections(10), COVERS, undefined, 0);
    assert.equal(r.timedOut, true); assert.equal(f.asked.length, 0);
  });
  await test("L6 every call is booked (onUsage) as linking", async () => {
    const f = fake(25); const booked: string[] = [];
    await askLinks(f.model, sections(50), COVERS, (what) => { booked.push(what); });
    assert.deepEqual(booked, ["linking", "linking", "linking", "linking"]);
  });
  if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
  console.log(`link-cut: ${passed} passed, 0 failed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
