/**
 * Knowledge library (/learn): the content stays general education (insurer-neutral, no currency, labelled), the
 * "Learn the basics" links under an answer match only whole terms the answer uses and never change it, and the
 * library is static (no household data, no model, no service calls). Pure: reads source files and renders markup.
 *   npm run learn:content-test
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GUIDES, LEARN_NOTICE, TERMS, TERMS_PAGE, blockTexts, guideBySlug, termHref } from "@/lib/learn/content";
import { percentOf, plainNumber, splitBill } from "@/lib/learn/try-it";
import { PICTOGRAMS } from "@/components/learn/pictogram";
import { MAX_LEARN_LINKS, learnTermsIn } from "@/lib/learn/match";
import { LearnLinks } from "@/components/learn-links";
import LearnIndex from "@/app/learn/page";
import LearnGuidePage, { generateStaticParams } from "@/app/learn/[slug]/page";
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
let passed = 0;
const failed: string[] = [];
const t = async (name: string, fn: () => void | Promise<void>) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { failed.push(name); console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message.split("\n")[0] : String(e))); } };

const allText = [
  LEARN_NOTICE, TERMS_PAGE.title, TERMS_PAGE.summary,
  ...TERMS.flatMap((term) => [term.term, term.definition, ...(term.alsoCalled ?? [])]),
  ...GUIDES.flatMap((g) => [g.title, g.summary, ...g.sections.flatMap((s) => [s.heading, ...s.blocks.flatMap(blockTexts)])]),
];
const joined = allText.join("\n");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
/** Picture and try-it components carry a few words of their own (labels, notes); the same word rules apply to them. */
const componentSources = [...walk("components/learn"), "lib/learn/try-it.ts"].map((f) => readFileSync(f, "utf8")).join("\n");
const CURRENCY_NEXT_TO_FIGURE = /(?:[$€£¥₹₩₱฿]\s?\d|\b(?:USD|SGD|EUR|GBP|AUD|HKD|MYR|INR|CNY|JPY|NZD|CAD|RM|S\$|US\$)\s?\d|\d\s?(?:USD|SGD|EUR|GBP|AUD|HKD|MYR|INR|CNY|JPY|NZD|CAD)\b)/;

async function main() {
  console.log("Knowledge library");

  await t("content: no currency attached to any figure (examples are plain numbers)", () => {
    // Currency symbols or ISO-style codes next to a number would read as someone's cover in a given currency.
    const hit = joined.match(CURRENCY_NEXT_TO_FIGURE);
    assert.equal(hit, null, `currency next to a figure: ${hit?.[0]}`);
    const inComponents = componentSources.match(CURRENCY_NEXT_TO_FIGURE);
    assert.equal(inComponents, null, `currency next to a figure in a picture or try-it component: ${inComponents?.[0]}`);
    assert.doesNotMatch(componentSources, /currency:|style: "currency"/, "try-it numbers must be formatted without a currency");
  });

  await t("content: every figure-bearing passage is an example block that says it is an example", () => {
    for (const g of GUIDES) for (const s of g.sections) for (const b of s.blocks) {
      for (const text of blockTexts(b)) {
        if (!/\d{3}/.test(text)) continue;
        if (b.kind === "quiz") { assert.match(b.question, /^Example only/, `${g.slug}: a quiz with figures must say it is an example`); continue; }
        assert.equal(b.kind, "example", `${g.slug} / ${s.heading}: a figure outside an example block: "${text.slice(0, 60)}"`);
        assert.match(text, /^Example only/, `${g.slug}: example not labelled`);
      }
    }
  });

  await t("content: insurer-neutral and market-neutral (no insurer, scheme or regulator named)", () => {
    // A guard, not an allow-list of markets: well-known insurer and national-scheme names that must never appear.
    const names = /\b(AIA|AXA|Allianz|Prudential|Great Eastern|Income Insurance|NTUC|FWD|Manulife|Sun Life|HSBC Life|Singlife|Tokio Marine|Zurich|MetLife|Chubb|Aviva|Generali|Ping An|China Life|Etiqa|MediShield|MediSave|CareShield|Integrated Shield|CPF|Medicare|Medicaid|NHS|Obamacare|MAS|FCA)\b/;
    const hit = joined.match(names);
    assert.equal(hit, null, `named: ${hit?.[0]}`);
    const inComponents = componentSources.match(names);
    assert.equal(inComponents, null, `named in a component: ${inComponents?.[0]}`);
  });

  await t("content: never promises payment or states what a particular policy pays", () => {
    const promise = /\b(you will (?:be paid|receive|get)|is guaranteed to pay|will definitely|always pays|you are covered for|the policy pays \d|you get \d)\b/i;
    const hit = joined.match(promise) ?? componentSources.match(promise);
    assert.equal(hit, null, `promise wording: ${hit?.[0]}`);
    assert.match(LEARN_NOTICE, /General education only/);
    assert.match(LEARN_NOTICE, /not advice about your own cover/);
    assert.match(LEARN_NOTICE, /your own documents, and your insurer, decide/);
  });

  await t("content: the worked examples' arithmetic is right", () => {
    assert.match(joined, /25% of a sum assured of 100,000, the illustrated amount is 25,000/);
    // 10,000 bill, 1,000 deductible, 10% co-payment on the remaining 9,000 = 900, so 8,100.
    assert.equal((10000 - 1000) * 0.9, 8100);
    assert.match(joined, /10,000, a deductible of 1,000 and a 10% co-payment\. The policy would pay 9,000 less 900, so 8,100, if no lower limit applies\. Policies differ in the order these apply/);
  });

  await t("content: states the project's evidence rules a household needs (missing ≠ excluded, wording ≠ proof, date ≠ current, bare $ unresolved)", () => {
    assert.match(joined, /not mentioned in your documents, that alone does not mean it is excluded/);
    assert.match(joined, /does not on its own prove that you have it/);
    assert.match(joined, /shows what was true on its date/);
    assert.match(joined, /only a symbol such as "\$" without saying which currency, DearPolicy leaves the currency unconfirmed/);
    assert.match(joined, /same policy number can still cover different people or products/);
    // Critic #426: claims about the product must match what it does (no figure when unsure; illustration not always shown).
    assert.doesNotMatch(joined, /shows both rather than choosing/);
    assert.match(joined, /does not pick one: it says they differ, or shows no figure/);
    assert.doesNotMatch(joined, /often the highest/);
    assert.doesNotMatch(joined, /with your name does\./);
  });

  await t("content: unique slugs and term ids; every term has a definition; terms page reachable", () => {
    const slugs = [...GUIDES.map((g) => g.slug), TERMS_PAGE.slug];
    assert.equal(new Set(slugs).size, slugs.length);
    assert.equal(new Set(TERMS.map((x) => x.id)).size, TERMS.length);
    for (const term of TERMS) { assert.ok(term.definition.length > 40, term.id); assert.match(term.id, /^[a-z0-9-]+$/); }
    assert.deepEqual(generateStaticParams().map((p) => p.slug).sort(), [...slugs].sort());
    assert.equal(guideBySlug("terms"), undefined);
  });

  await t("content: no match phrase belongs to two terms", () => {
    const seen = new Map<string, string>();
    for (const term of TERMS) for (const m of term.match) {
      const key = m.toLowerCase();
      assert.ok(!seen.has(key), `"${m}" used by ${seen.get(key)} and ${term.id}`);
      seen.set(key, term.id);
    }
  });

  await t("match: finds terms an answer uses, in the order they appear, case-insensitive", () => {
    const ids = learnTermsIn(["The Waiting Period is 90 days. A deductible applies, then a 10% co-payment."]).map((x) => x.id);
    assert.deepEqual(ids, ["waiting-period", "deductible", "co-payment"]);
  });

  await t("match: whole words only (no match inside another word)", () => {
    assert.deepEqual(learnTermsIn(["The rideraction and premiumness and exclusionary text."]), []);
    assert.deepEqual(learnTermsIn(["TPDX and XTPD"]), []);
    assert.deepEqual(learnTermsIn(["TPD cover is shown on page 4."]).map((x) => x.id), ["total-permanent-disability"]);
  });

  await t("match: hyphen and space variants match the same term", () => {
    assert.deepEqual(learnTermsIn(["pre existing condition"]).map((x) => x.id), ["pre-existing-condition"]);
    assert.deepEqual(learnTermsIn(["co payment"]).map((x) => x.id), ["co-payment"]);
  });

  await t("match: at most MAX_LEARN_LINKS, each term once", () => {
    const many = learnTermsIn(["deductible deductible rider premium waiting period exclusion sum assured beneficiary"]);
    assert.equal(many.length, MAX_LEARN_LINKS);
    assert.equal(new Set(many.map((x) => x.id)).size, many.length);
  });

  await t("match: nothing for empty, missing or term-free answers (negative control)", () => {
    assert.deepEqual(learnTermsIn([]), []);
    assert.deepEqual(learnTermsIn([null, undefined, ""]), []);
    assert.deepEqual(learnTermsIn(["I could not find that document. Please upload it on the Documents page."]), []);
  });

  await t("match: ordinary words that are not policy terms do not trigger links (claim, limit, excess, excluded)", () => {
    assert.deepEqual(learnTermsIn(["You can claim this. There is no limit to questions, in excess of what you need; nothing is excluded here."]), []);
  });

  await t("match: words in nearly every answer (schedule, premium, per day) do not crowd out the useful terms", () => {
    const ids = learnTermsIn(["Your schedule shows a premium of 1,200 and 100 per day. A waiting period and a co-payment apply, and one exclusion."]).map((x) => x.id);
    assert.deepEqual(ids, ["waiting-period", "co-payment", "exclusion"]);
  });

  await t("wiring: an older saved claim item without conditions does not break the links row", () => {
    assert.match(readFileSync("app/chat/page.tsx", "utf8"), /\.\.\.\(item\.conditions\?\?\[\]\)/);
  });

  await t("links: render a link per matched term to its anchor on the terms page, and nothing when none match", () => {
    const html = renderToStaticMarkup(createElement(LearnLinks, { texts: ["A waiting period and a rider apply."] }));
    assert.match(html, /Learn the basics:/);
    assert.match(html, /href="\/learn\/terms#waiting-period"/);
    assert.match(html, /href="\/learn\/terms#rider"/);
    assert.equal(renderToStaticMarkup(createElement(LearnLinks, { texts: ["Nothing to explain."] })), "");
    for (const term of TERMS) assert.equal(termHref(term), `/learn/terms#${term.id}`);
  });

  await t("pages: index lists every guide and the terms page, with the notice", () => {
    const html = renderToStaticMarkup(LearnIndex());
    for (const g of GUIDES) assert.ok(html.includes(`href="/learn/${g.slug}"`), g.slug);
    assert.ok(html.includes(`href="/learn/terms"`));
    assert.ok(html.includes('data-testid="learn-notice"'));
  });

  await t("pages: every guide and the terms page render with the notice; terms page has an anchor per term", async () => {
    for (const { slug } of generateStaticParams()) {
      const html = renderToStaticMarkup(await LearnGuidePage({ params: Promise.resolve({ slug }) }));
      assert.ok(html.includes('data-testid="learn-notice"'), slug);
      if (slug === "terms") for (const term of TERMS) assert.ok(html.includes(`id="${term.id}"`), term.id);
    }
  });

  await t("pages: an unknown slug is not found", async () => {
    await assert.rejects(LearnGuidePage({ params: Promise.resolve({ slug: "no-such-guide" }) }));
  });

  await t("static: the library imports no database, model, network or household code", () => {
    const files = ["lib/learn/content.ts", "lib/learn/match.ts", "lib/learn/try-it.ts", "components/learn-links.tsx", "components/learn-notice.tsx", "app/learn/page.tsx", "app/learn/[slug]/page.tsx", ...walk("components/learn")];
    assert.deepEqual(walk("app/learn").sort(), files.filter((f) => f.startsWith("app/learn")).sort(), "unexpected file under app/learn");
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      for (const i of imports) assert.ok(/^(next\/link|next\/navigation|react|@\/lib\/learn\/(content|match|try-it)|@\/components\/learn-notice|@\/components\/learn\/(pictogram|blocks|try-it)|\.\/content)$/.test(i), `${f} imports ${i}`);
      assert.doesNotMatch(src, /\bfetch\(|supabase|anthropic|process\.env|localStorage|<img\b|https?:\/\//i, f);
    }
  });

  await t("wiring: chat shows the links under assistant answers only, without touching the answer text", () => {
    const chat = readFileSync("app/chat/page.tsx", "utf8");
    assert.match(chat, /import \{ LearnLinks \} from "@\/components\/learn-links";/);
    assert.match(chat, /message\.role==="assistant"&&message\.answer&&!isStopped\(message\.answer,message\.content\)\?<LearnLinks texts=\{/);
    assert.equal((chat.match(/<LearnLinks /g) ?? []).length, 1);
  });

  await t("wiring: one Learn nav item, not a phone tab (goes in More)", () => {
    const shell = readFileSync("components/AppShell.tsx", "utf8");
    assert.match(shell, /\{ href: "\/learn", label: "Learn", icon: "book" \},/);
    assert.equal((shell.match(/href: "\/learn"/g) ?? []).length, 1);
  });

  await t("wiring: /learn still needs a signed-in session (not added to the public paths)", () => {
    assert.doesNotMatch(readFileSync("middleware.ts", "utf8"), /"\/learn/);
  });

  await t("pictures: every guide has at least one picture and one thing to tap or try", () => {
    for (const g of GUIDES) {
      const kinds = g.sections.flatMap((s) => s.blocks.map((b) => b.kind));
      assert.ok(kinds.some((k) => k === "tiles" || k === "steps" || k === "flow" || k === "diagram"), `${g.slug}: no picture`);
      assert.ok(kinds.some((k) => k === "cards" || k === "quiz" || k === "bill-split" || k === "percent-of-sum"), `${g.slug}: nothing interactive`);
      assert.ok(PICTOGRAMS.includes(g.icon), `${g.slug}: index picture ${g.icon} not drawn`);
    }
  });

  await t("pictures: every picture a block names is drawn; quizzes have one valid answer", () => {
    for (const g of GUIDES) for (const s of g.sections) for (const b of s.blocks) {
      const tiles = b.kind === "tiles" ? b.tiles : b.kind === "steps" ? b.steps : b.kind === "flow" ? b.items : [];
      for (const tile of tiles) assert.ok(PICTOGRAMS.includes(tile.icon), `${g.slug}: ${tile.icon} not drawn`);
      if (b.kind === "quiz") {
        assert.ok(b.options.length >= 2 && b.options.length <= 4, `${g.slug}: quiz options`);
        assert.ok(Number.isInteger(b.answer) && b.answer >= 0 && b.answer < b.options.length, `${g.slug}: quiz answer out of range`);
        assert.equal(new Set(b.options).size, b.options.length, `${g.slug}: duplicate quiz option`);
        assert.ok(b.explain.length > 40, `${g.slug}: quiz explanation too thin`);
      }
      if (b.kind === "cards") for (const c of b.cards) assert.ok(c.back.length > 30, `${g.slug}: card "${c.front}" answer too thin`);
    }
  });

  await t("try-it: the bill split adds up, matches the guide's worked example, and caps at the limit", () => {
    const base = splitBill({ bill: 10000, deductible: 1000, coPaymentPercent: 10, limit: 20000 });
    assert.deepEqual(base, { deductible: 1000, coPayment: 900, overLimit: 0, policyShare: 8100, yourShare: 1900 });
    const capped = splitBill({ bill: 20000, deductible: 1000, coPaymentPercent: 10, limit: 5000 });
    assert.equal(capped.policyShare, 5000);
    assert.equal(capped.overLimit, 20000 - 1000 - 1900 - 5000);
    const small = splitBill({ bill: 500, deductible: 1000, coPaymentPercent: 10, limit: 5000 });
    assert.deepEqual(small, { deductible: 500, coPayment: 0, overLimit: 0, policyShare: 0, yourShare: 500 });
    for (const bill of [0, 1000, 7500, 30000]) for (const ded of [0, 300, 5000]) for (const pct of [0, 15, 50]) for (const limit of [1000, 30000]) {
      const r = splitBill({ bill, deductible: ded, coPaymentPercent: pct, limit });
      assert.equal(r.deductible + r.coPayment + r.overLimit + r.policyShare, bill, "parts must add up to the bill");
      assert.equal(r.yourShare + r.policyShare, bill);
      assert.ok(r.policyShare <= limit && Object.values(r).every((n) => n >= 0));
    }
    assert.equal(splitBill({ bill: NaN, deductible: -5, coPaymentPercent: 200, limit: Infinity }).policyShare, 0);
    assert.equal(percentOf(25, 100000), 25000);
    assert.equal(percentOf(150, 100000), 100000);
    assert.equal(plainNumber(8100), "8,100");
  });

  await t("try-it and quiz render labelled as made-up examples; quiz buttons are buttons", async () => {
    const html = renderToStaticMarkup(await LearnGuidePage({ params: Promise.resolve({ slug: "how-amounts-work" }) }));
    assert.ok(html.includes('data-testid="learn-bill-split"') && html.includes('data-testid="learn-percent-of-sum"'));
    assert.equal((html.match(/Example only: made-up numbers in no particular currency, not your policy\./g) ?? []).length, 2);
    assert.match(html, /Your insurer decides what it pays\./);
    assert.match(html, />8,100</, "the bill slider starts at the guide's worked example");
    assert.match(html, /data-testid="learn-quiz"/);
    for (const btn of html.match(/<button[^>]*>/g) ?? []) assert.match(btn, /type="button"/);
    const docs = renderToStaticMarkup(await LearnGuidePage({ params: Promise.resolve({ slug: "your-documents" }) }));
    assert.match(docs, /<details class="learn-flip"><summary>/, "tap cards work without JavaScript");
    assert.match(docs, /<svg class="lp"[^>]*aria-hidden="true"/, "pictures are decorative next to their words");
  });

  console.log(`\n${passed} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}
void main();
