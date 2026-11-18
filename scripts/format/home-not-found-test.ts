/** Home's "Gaps to consider" (DC 17 Nov: "show the user what insurance gaps they do not have, so they can consider getting
 * them in the future for fuller protection"). Under the cards, the main kinds of cover with no card are listed as "No
 * cover of these kinds was found in <name>'s documents", never "not covered" (missing information is not an exclusion),
 * each linking to its own Coverage answer. No product or insurer is suggested. Renders the real component; no database,
 * no network.
 *   node --import tsx scripts/format/home-not-found-test.ts
 * History: until 17 Nov this test pinned DC's 16 Nov rule that Home shows no "Not found" line at all. DC asked for gaps on
 * 17 Nov, so that assertion was replaced; the rest of the 16 Nov rule (a card only for Covered, never "Not covered", no
 * "On file, please confirm") is still pinned below. */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$|PROXY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GAP_CATEGORIES, HomeNotFound, homeGaps } from "@/components/home-not-found";

let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }
const html = (missing: string[], note?: string | null, name: string | null = "Ama", onFile: string[] = []) => renderToStaticMarkup(createElement(HomeNotFound, { missing, onFile, memberId: "m 1", name, note }));
const text = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
const cov = (category: string, status: string) => ({ category, status });

test("gaps are the main kinds with no Covered card, in a fixed order", () => {
  const gaps = homeGaps([cov("Death", "covered"), cov("Hospital Cash", "covered"), cov("Critical Illness", "covered"), cov("Travel", "covered"),
    cov("Total Permanent Disability", "covered"), cov("Personal Accident", "covered"), cov("Hospitalisation", "on_file"), cov("Disability Income", "not_covered")]);
  assert.deepEqual(gaps, { missing: ["Disability Income"], onFile: ["Hospitalisation"] });
});
test("wording or a booklet alone (on file): listed apart, never said to be missing from the documents (Critic M1)", () => {
  const g = homeGaps([cov("Death", "covered"), cov("Hospitalisation", "on_file")]);
  assert.deepEqual(g.onFile, ["Hospitalisation"]); assert.ok(!g.missing.includes("Hospitalisation"));
  const t = text(html(g.missing, null, "Ama", g.onFile));
  assert.match(t, /Found only in a booklet or wording, not yet shown on Ama\u2019s own policy:Hospitalisation/);
  assert.doesNotMatch(t.split("Found only")[0], /Hospitalisation/, "the on-file kind is not under 'No cover ... was found'");
  assert.equal(text(html([], null, "Ama", ["Travel"])).includes("No cover of these kinds"), false, "no 'not found' line when nothing is missing");
});
test("a child or other dependant has no Disability Income gap; an adult does", () => {
  for (const r of ["Child", "Son", "daughter", "Dependent child", "Grandson", "Stepson", "step-daughter"]) assert.ok(!homeGaps([], r).missing.includes("Disability Income"), r);
  for (const r of ["Self", "Spouse", "Parent", "Son-in-law", "Daughter-in-law", "Mason", null]) assert.ok(homeGaps([], r).missing.includes("Disability Income"), String(r));
  assert.ok(homeGaps([], "Child").missing.includes("Hospitalisation"));
});
test("add-ons and covers only some households need are never gaps", () => {
  for (const c of ["Hospital Cash", "Early Critical Illness", "Home", "Motor", "Savings", "Investment", "Outpatient"]) assert.ok(!(GAP_CATEGORIES as readonly string[]).includes(c), c);
  assert.ok(!homeGaps([]).missing.includes("Hospital Cash"));
});
test("a Hospital Cash card does not hide a Hospitalisation gap (cash is not hospital-bill cover)", () => {
  assert.ok(homeGaps([cov("Hospital Cash", "covered")]).missing.includes("Hospitalisation"));
});
test("wording: 'no cover found in <name>'s documents', never 'not covered'; each gap links to its own Coverage answer", () => {
  const h = html(["Hospitalisation", "Disability Income"]); const t = text(h);
  assert.match(t, /^Gaps to considerNo cover of these kinds was found in Ama’s documents\.HospitalisationDisability Income/);
  assert.doesNotMatch(t, /not covered|uncovered|you need|buy|recommend/i);
  assert.match(h, /href="\/coverage\?member=m%201&amp;category=Disability%20Income"/);
  assert.match(h, /href="\/learn\/types-of-cover"/); assert.match(h, /href="\/policies"/);
});
test("with documents not fully read, it says so", () => {
  const t = text(html(["Travel"], "One of Ama's documents could not be read in full."));
  assert.match(t, /found in what DearPolicy could read of Ama’s documents\./); assert.match(t, /could not be read in full/);
});
test("a document whose kinds of cover are not known yet: no kind is named a gap, one line says when (design review 2)", () => {
  // Ama's travel schedule is on file but not read: "no Travel cover found" would be wrong.
  const page = renderToStaticMarkup(createElement(HomeNotFound, { missing: ["Travel", "Death"], onFile: ["Hospitalisation"], memberId: "m", name: "Ama",
    note: "4 of Ama’s documents were not fully read, so cover in them may be missing here. Documents shows which and what to do.", pending: true }));
  const t = text(page);
  assert.match(t, /Gaps show once DearPolicy has read all of Ama’s documents\./);
  assert.match(t, /4 of Ama’s documents were not fully read, so cover in them may be missing here/);
  assert.doesNotMatch(page, /category=Travel|category=Death|category=Hospitalisation/, "no gap chip while pending");
  assert.doesNotMatch(t, /No cover of these kinds|Upload it/);
  assert.match(page, /types-of-cover/);
});
test("gaps always say a policy not uploaded may still cover them", () => {
  assert.match(text(html(["Travel"])), /A policy that is not uploaded may still cover these\./);
});
test("the dashboard sends the whole not-fully-read note and whether gaps wait for unread documents", () => {
  const route = readFileSync("app/api/dashboard/route.ts", "utf8");
  assert.match(route, /const notReadNote=notFullyReadNote\(notRead,active\.display_name\);/);
  assert.match(route, /gapsPending:notRead\.coverUnknown>0/);
  assert.match(readFileSync("app/page.tsx", "utf8"), /pending=\{data\?\.gapsPending===true\}/);
});
test("nothing missing: nothing shown", () => { assert.equal(html([]), ""); });
test("Home: cards only for Covered; gaps only once the person has a card and nothing is still being read", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /const covered=\(data\?\.coverages\?\?\[\]\)\.filter\(c=>c\.status==="covered"\);/);
  assert.match(page, /covered\.map\(c=>/);
  assert.match(page, /\{!loading&&!personEmpty&&covered\.length>0&&!data\?\.reading&&<HomeNotFound \{\.\.\.homeGaps\(data\?\.coverages\?\?\[\],active\?\.relationship\)\}/);
  assert.doesNotMatch(page, /On file, please confirm|onFileNote/);
  assert.doesNotMatch(page, /"Not covered"|>Not covered</);
  // A person with documents on file but no card is never told to upload what they already uploaded, nor that they have no
  // cover (site review Critic, 16 Nov): the upload nudge is only for a person with no document linked.
  assert.match(page, /\(active\?\.policy_count\?\?0\)>0\?<>No cover card for/);
  assert.doesNotMatch(page, /No cover for \{name/);
});
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`home-not-found: ${passed} passed, fetches 0`);
