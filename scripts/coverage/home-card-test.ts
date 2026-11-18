/** Home's protection cards (DC 17 Nov "the ui looks weird and empty"): a card with no single confirmed amount names what
 * pays instead of standing empty, never with a summed or unconfirmed figure; the grid's column count keeps the last row
 * from being one card alone where 3 or 4 columns avoid it. Pure functions plus the page source; no database, no network.
 *   node --import tsx scripts/coverage/home-card-test.ts */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$|PROXY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homeAmountText, homeCardShowsAmount, homeCardSource, homeGridColumns, homePolicyName, pickCoverByName, readablePolicyName } from "@/lib/coverage/home-card";

let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

test("one policy: its name", () => {
  assert.equal(homeCardSource({ policyNames: ["Group Term Life"] }), "Group Term Life");
  assert.equal(homeCardSource({ policyNames: ["  Shield   Plan A "] }), "Shield Plan A");
});
test("two policies: both names; the same name twice (any case) counts once", () => {
  assert.equal(homeCardSource({ policyNames: ["Group Term Life"], parts: [{ name: "Group Term Life" }, { name: "Funeral Benefit" }] }), "Group Term Life + Funeral Benefit");
  assert.equal(homeCardSource({ policyNames: ["Term Life", "TERM LIFE"] }), "Term Life");
});
test("several lines or policies: no total on Home (different schedules are never added without support, 17 Nov)", () => {
  // Two confirmed Death policies S$200,000 + S$100,000: the dashboard's S$300,000 is not shown; the card names both.
  const two = { policyNames: ["Oakridge Term 80", "Oakridge Whole Life"], count: 2 };
  assert.equal(homeCardShowsAmount(two), false); assert.equal(homeCardSource(two), "Oakridge Term 80 + Oakridge Whole Life");
  // One plan paying two Death benefits (S$1,000,000 + S$5,000): no total either, and the card says how many.
  const onePlan = { policyNames: ["Group Term Life"], parts: [{ name: "Group Term Life" }, { name: "Group Term Life" }], count: 2 };
  assert.equal(homeCardShowsAmount(onePlan), false); assert.equal(homeCardSource(onePlan), "Group Term Life \u00b7 2 covers");
  assert.equal(homeCardSource({ policyNames: [], count: 3 }), "3 covers");
  // One line: its own confirmed amount is shown.
  assert.equal(homeCardShowsAmount({ count: 1 }), true);
  assert.equal(homeCardShowsAmount({ count: 1, policyNames: ["Term Life", "term  life"] }), true, "the same policy named twice is one");
  // Fails closed (Critic, e57bfdc): one line by count, but two policies named, never shows a figure that may be their sum.
  assert.equal(homeCardShowsAmount({ count: 1, policyNames: ["A Plan", "B Plan"] }), false);
  // One policy, two confirmed Death lines (S$300,000 + a S$50,000 rider): the dashboard keeps the top line and flags the
  // cover for review, so the card shows no amount (TE A7).
  assert.equal(homeCardShowsAmount({ count: 1, policyNames: ["Kite Term 60"], reviewRequired: true }), false);
  assert.equal(homeCardShowsAmount({ count: 0 }), true, "a derived cover with no line has no amount to sum");
});
test("three or more: a count, never a list that overflows the card", () => {
  assert.equal(homeCardSource({ policyNames: ["Alpha Plan", "Beta Plan", "Gamma Plan"] }), "3 policies");
});
test("nothing named, or only the dashboard's 'Policy' stand-in: no line, never an invented name", () => {
  assert.equal(homeCardSource({ policyNames: [] }), null);
  assert.equal(homeCardSource({ policyNames: null, parts: [{ name: "Policy" }] }), null);
  assert.equal(homeCardSource({ policyNames: null, parts: [{ name: "Policy" }, { name: null }] }), "2 covers", "unnamed, but how many is still said");
  assert.equal(homeCardSource({ policyNames: ["Owned policy"] }), null);
});
test("the source line never carries an amount: only names go in", () => {
  // A policy name that happens to hold a figure is shown as the name it is; no amount is ever built here.
  assert.equal(homeCardSource({ policyNames: ["Plan 500"] }), "Plan 500");
  const input = readFileSync("lib/coverage/home-card.ts", "utf8").match(/export type HomeCardInput = [^;]+;/)?.[0] ?? "";
  assert.ok(input, "the input type is declared"); assert.doesNotMatch(input, /amount|total|currency/);
});
test("a card names the policy, not a benefit or a file code (coordinator 17 Nov)", () => {
  // The dashboard's sources are the policies' own names: they win over benefit names.
  assert.equal(homeCardSource({ policyNames: ["GROUP PERSONAL ACCIDENT", "Business"], sources: ["MINDEF & MHA GROUP INSURANCE SCHEME", "Business Single Trip"], count: 2 }),
    "Mindef & MHA Group Insurance Scheme +\u00a01\u00a0more", "two long names: the first and how many more, never a cut name");
  assert.equal(homeCardSource({ sources: ["Kite Term 60", "Business Single Trip"] }), "Kite Term 60 + Business Single Trip");
  assert.equal(homeCardSource({ sources: ["Mindef & MHA Group Insurance Scheme Extended Plus", "Kite Term 60"] }), "2 policies");
  // With no sources, a name made only of generic words gives way to one that names the policy.
  assert.equal(homeCardSource({ policyNames: ["GROUP TERM LIFE", "Death Benefit"], count: 1 }), "Group Term Life");
  assert.equal(homeCardSource({ policyNames: ["Travel insurance"] }), null, "a name that names no policy is never shown (TE F3)");
  assert.equal(homeCardSource({ policyNames: ["Death Benefit", "Business"], count: 2 }), "2 covers");
  for (const n of ["Business", "Death Benefit", "Travel insurance", "SGGRP_COI_APP", "1105 CD-594 COI_SAF", "EJ7", "", "Owned policy", "scan0012.pdf", "IMG 4471", "COI-2026-0012", "AIA"]) assert.equal(readablePolicyName(n), false, n);
  for (const n of ["Group Term Life", "Business Single Trip", "READYBUILDER 10", "AIA PRO LIFETIME PROTECTOR - MAX", "PruLink Enhanced Protector (PW9)"]) assert.equal(readablePolicyName(n), true, n);
  // An unnamed held cover named by its document (Charmaine's Outpatient): a source alone is enough.
  assert.equal(homeCardSource({ policyNames: [], sources: ["PruFlexiCash Protection Plus (7th Series) (EJ7)"], count: 0 }), "PruFlexiCash Protection Plus");
});
test("which cover a name means: exact, else the longest start; two equal fits name none (Critic PR 525 M1)", () => {
  // "Travel" (doc A) listed before "Travel Plus" (doc B): B's label "Travel Plus Annual" is B's, never A's.
  assert.equal(pickCoverByName("Travel Plus Annual", [["Travel", "Travel"], ["Travel Plus", "Travel Plus"]]), 1);
  assert.equal(pickCoverByName("Travel Plus \u00b7 Gold plan", [["Travel"], ["Travel Plus"]]), 1);
  assert.equal(pickCoverByName("Travel", [["Travel Plus"], ["Travel"]]), 1, "exact wins over a longer name");
  assert.equal(pickCoverByName("Death", [["Death", "Kite Term"], ["Death", "Oak Life"]]), -1, "two covers called Death: name none");
  assert.equal(pickCoverByName("Business Single Trip", [["Business Single", null], ["Business Single", "Other"]]), -1, "equal prefixes: none");
  assert.equal(pickCoverByName("Travelling Plan", [["Travel"]]), -1, "a word is matched whole");
  assert.equal(pickCoverByName("", [["Travel"]]), -1);
});
test("readable names: all capitals in title case, initials kept; long names lose trailing codes; mixed case kept", () => {
  assert.equal(homePolicyName("MINDEF & MHA GROUP INSURANCE SCHEME"), "Mindef & MHA Group Insurance Scheme");
  assert.equal(homePolicyName("AIA PRO LIFETIME PROTECTOR - MAX"), "AIA Pro Lifetime Protector - Max");
  assert.equal(homePolicyName("GROUP LIVING CARE PLUS"), "Group Living Care Plus");
  assert.equal(homePolicyName("READYBUILDER 10"), "Readybuilder 10");
  assert.equal(homePolicyName("PruFlexiCash Protection Plus (7th Series) (EJ7)"), "PruFlexiCash Protection Plus");
  assert.equal(homePolicyName("PruLink Enhanced Protector (PW9)"), "PruLink Enhanced Protector");
  assert.equal(homePolicyName("Shield (Plan A)"), "Shield (Plan A)", "short enough to keep");
  assert.equal(homePolicyName("MINDEF & MHA GROUP INSURANCE SCHEME (GROUP TERM LIFE)"), "Mindef & MHA Group Insurance Scheme");
  assert.equal(homePolicyName("Shield Plan A"), "Shield Plan A");
  // TE PR 525 F2: initials up to 4 letters stay; hyphen and apostrophe parts each get their own capital.
  assert.equal(homePolicyName("NTUC INCOME"), "NTUC Income");
  assert.equal(homePolicyName("OCBC LIFE GOAL"), "OCBC Life Goal");
  assert.equal(homePolicyName("MSIG TRAVELEASY"), "MSIG Traveleasy");
  assert.equal(homePolicyName("HSBC HOME SHIELD (H-2026)"), "HSBC Home Shield (H\u20112026)", "and a short code never breaks at its hyphen");
  assert.equal(homePolicyName("NTUC INCOME CO-OPERATIVE"), "NTUC Income Co-Operative");
  assert.equal(homePolicyName("O'BRIEN FAMILY PLAN"), "O'Brien Family Plan");
  assert.equal(homePolicyName("ST. LUKE CARE"), "St. Luke Care");
  assert.equal(homePolicyName("AIA HEALTHSHIELD GOLD MAX B"), "AIA Healthshield Gold Max B");
  // TE PR 525 R2: real short words read as words; possessives keep a small s.
  assert.equal(homePolicyName("LONG TERM CARE PLAN"), "Long Term Care Plan");
  assert.equal(homePolicyName("PRIVATE WARD SHIELD"), "Private Ward Shield");
  assert.equal(homePolicyName("FWD CAR INSURANCE"), "FWD Car Insurance");
  assert.equal(homePolicyName("PET CARE PLAN"), "Pet Care Plan");
  assert.equal(homePolicyName("INCOME FAMILY BOND"), "Income Family Bond");
  assert.equal(homePolicyName("ST. ANDREW'S CARE"), "St. Andrew's Care");
  assert.equal(homePolicyName("UOB DBS AXA PRU"), "UOB DBS AXA PRU");
  // Initials of up to 4 letters are never lowercased (TE PR 525 7d26518).
  for (const n of ["IRAS", "CHAS", "IPPT", "ICBC", "ACRA", "AMEX", "MOM", "ACE", "US", "IT"]) assert.equal(homePolicyName(`${n} TRAVEL`), `${n} Travel`, n);
  assert.equal(homePolicyName("MEN'S HEALTH"), "Men's Health");
});
test("phone person switcher: keys wrap onto rows, names break between words, never scrolls sideways", () => {
  const css = readFileSync("app/globals.css", "utf8");
  assert.doesNotMatch(css, /\.member-pills \{ mask-image/, "no sideways-scroll fade");
  assert.match(css, /\.member-pills \{ display: flex; flex-wrap: wrap;/);
});
test("columns: the last row is never one card alone where 3 or 4 columns avoid it", () => {
  for (let n = 4; n <= 24; n++) {
    const cols = homeGridColumns(n); assert.ok(cols === 3 || cols === 4, `n=${n} cols=${cols}`);
    const last = n % cols || cols;
    const avoidable = [3, 4].some((c) => (n % c || c) > 1);
    if (avoidable) assert.ok(last > 1, `n=${n}: ${cols} columns leaves one card alone`);
  }
  assert.equal(homeGridColumns(7), 4); assert.equal(homeGridColumns(6), 3); assert.equal(homeGridColumns(8), 4); assert.equal(homeGridColumns(9), 3);
  for (const n of [0, 1, 2, 3]) assert.equal(homeGridColumns(n), 3, "a few cards keep card size");
});
test("Home cards never show a figure (DC 18 Nov), name the source, link to the detail page, and set the columns", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /const source=homeCardSource\(c\);/);
  assert.match(page, /\{source&&<span className="coverage-source" title=\{source\}>\{source\}<\/span>\}/);
  assert.doesNotMatch(page, /coverage-amount|formatMoney|c\.amount|c\.displayAmount/, "no figure on a Home card");
  assert.match(page, /href=\{`\/coverage\?member=\$\{encodeURIComponent\(active\?\.id\?\?""\)\}&category=\$\{encodeURIComponent\(c\.category\)\}`\}/);
  // A period wraps as a unit (TE A9): "S$3,000 a month" may break only before "a".
  assert.equal(homeAmountText("S$3,000 a month"), "S$3,000 a\u00a0month");
  assert.equal(homeAmountText("S$150.00 per day"), "S$150.00 per\u00a0day");
  assert.equal(homeAmountText("S$1,000,000"), "S$1,000,000");
  assert.match(page, /data-cols=\{homeGridColumns\(covered\.length\)\}/);
  const css = readFileSync("app/globals.css", "utf8");
  // Columns follow the width the cards get, not the screen (Test engineer #519 F2): 2 until 3 or 4 fit card-sized.
  assert.match(css, /\.home-cards \{ container-type: inline-size; \}/);
  // An amount with a period ("US$1,250,000 a year") wraps at its spaces, never spills out of the card (TE A6).
  assert.doesNotMatch(css.slice(css.indexOf("Home cards are compact sheets"), css.indexOf("Gaps to consider (DC 17 Nov)")), /coverage-amount[^}]*nowrap/);
  assert.match(css, /@container \(min-width: 820px\) \{\s*\.home-cards \.coverage-grid\[data-cols="4"\] \{ grid-template-columns: repeat\(4,/);
  assert.match(css, /@container \(min-width: 600px\) \{\s*\.home-cards \.coverage-grid\[data-cols="3"\] \{ grid-template-columns: repeat\(3,/);
  assert.doesNotMatch(css.slice(css.indexOf("Home cards are compact sheets"), css.indexOf("Gaps to consider (DC 17 Nov)")), /overflow-wrap: anywhere/, "a cover name never breaks mid-word");
  assert.match(css, /\.home-cards \.coverage-grid > :last-child:nth-child\(odd\) \{ grid-column: 1 \/ -1; \}/);
});
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`home-card: ${passed} passed, fetches 0`);
