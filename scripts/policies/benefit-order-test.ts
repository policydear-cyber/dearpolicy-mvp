/**
 * A table's numbered benefit rows are listed in number order ("2." before "10."), only within the runs the query put
 * together (review state, then product); page and plan column break ties as before. Made-up rows; no database, no network.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const row = (benefit_name: string, o: Partial<{ needs_review: boolean; product_name: string | null; source_page: number; tier: string | null; original_filename: string }> = {}) =>
  ({ benefit_name, needs_review: o.needs_review ?? false, product_name: o.product_name === undefined ? "Example Group Plan" : o.product_name, source_page: o.source_page ?? 10,
    tier: o.tier ?? null, original_filename: o.original_filename ?? "example.pdf" });

test("numbered rows come in number order within a product; runs, pages and plan columns keep the query's order", async () => {
  const { inNumberedOrder } = await import("@/lib/policies/benefit-order");
  // As the database's text order gives them.
  const rows = [row("1. Loss of sight in both eyes"), row("10. Loss of four fingers"), row("11. Loss of (a) Right thumb"), row("11. Loss of (c) Left thumb"),
    row("2. Permanent loss of speech"), row("20. Loss of hearing"), row("3. Permanent insanity"), row("Hip", { source_page: 13 }), row("Hip", { source_page: 8 })];
  assert.deepEqual(inNumberedOrder(rows).map((r) => r.benefit_name + (r.benefit_name === "Hip" ? " p" + r.source_page : "")), [
    "1. Loss of sight in both eyes", "2. Permanent loss of speech", "3. Permanent insanity", "10. Loss of four fingers", "11. Loss of (a) Right thumb",
    "11. Loss of (c) Left thumb", "20. Loss of hearing", "Hip p8", "Hip p13"]);
  // A row needing review, and another product, stay in their own run where the query put them.
  const mixed = [row("10. Fracture", { needs_review: true }), row("2. Burns", { needs_review: true }), row("10. Ward", { product_name: "Example Shield" }),
    row("2. ICU", { product_name: "Example Shield" }), row("10. Death", { product_name: null, original_filename: "a.pdf" }), row("9. Disability", { product_name: null, original_filename: "a.pdf" })];
  assert.deepEqual(inNumberedOrder(mixed).map((r) => r.benefit_name), ["2. Burns", "10. Fracture", "2. ICU", "10. Ward", "9. Disability", "10. Death"]);
  // Same name and page: plan columns in order, then as given.
  const tiers = [row("Ward", { tier: "Plan B" }), row("Ward", { tier: "Plan A" }), row("Ward", { tier: "Plan A" })];
  assert.deepEqual(inNumberedOrder(tiers).map((r) => r.tier), ["Plan A", "Plan A", "Plan B"]);
  assert.equal(inNumberedOrder(tiers)[0], tiers[1]);
  assert.deepEqual(inNumberedOrder([]), []);
});

test("the Benefits route orders its rows this way right after reading them", () => {
  const route = readFileSync("app/api/benefits/route.ts", "utf8");
  assert.match(route, /\[accountId,member\|\|null\]\);\n {4}\/\/ [^\n]*\n {4}rows\.rows=inNumberedOrder\(rows\.rows\);/);
});
