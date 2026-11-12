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
import { GUIDES, LEARN_NOTICE, TERMS, TERMS_PAGE, guideBySlug, termHref } from "@/lib/learn/content";
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
  ...GUIDES.flatMap((g) => [g.title, g.summary, ...g.sections.flatMap((s) => [s.heading, ...s.blocks.flatMap((b) => b.kind === "list" ? b.items : [b.text])])]),
];
const joined = allText.join("\n");

async function main() {
  console.log("Knowledge library");

  await t("content: no currency attached to any figure (examples are plain numbers)", () => {
    // Currency symbols or ISO-style codes next to a number would read as someone's cover in a given currency.
    const hit = joined.match(/(?:[$€£¥₹₩₱฿]\s?\d|\b(?:USD|SGD|EUR|GBP|AUD|HKD|MYR|INR|CNY|JPY|NZD|CAD|RM|S\$|US\$)\s?\d|\d\s?(?:USD|SGD|EUR|GBP|AUD|HKD|MYR|INR|CNY|JPY|NZD|CAD)\b)/);
    assert.equal(hit, null, `currency next to a figure: ${hit?.[0]}`);
  });

  await t("content: every figure-bearing passage is an example block that says it is an example", () => {
    for (const g of GUIDES) for (const s of g.sections) for (const b of s.blocks) {
      const texts = b.kind === "list" ? b.items : [b.text];
      for (const text of texts) {
        if (!/\d{3}/.test(text)) continue;
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
  });

  await t("content: never promises payment or states what a particular policy pays", () => {
    const hit = joined.match(/\b(you will (?:be paid|receive|get)|is guaranteed to pay|will definitely|always pays|you are covered for)\b/i);
    assert.equal(hit, null, `promise wording: ${hit?.[0]}`);
    assert.match(LEARN_NOTICE, /General education only/);
    assert.match(LEARN_NOTICE, /not advice about your own cover/);
    assert.match(LEARN_NOTICE, /your own documents, and your insurer, decide/);
  });

  await t("content: the worked examples' arithmetic is right", () => {
    assert.match(joined, /25% of a sum assured of 100,000, the illustrated amount is 25,000/);
    // 10,000 bill, 1,000 deductible, 10% co-payment on the remaining 9,000 = 900, so 8,100.
    assert.equal((10000 - 1000) * 0.9, 8100);
    assert.match(joined, /10,000, a deductible of 1,000 and a 10% co-payment\. The policy would pay 9,000 less 900, so 8,100/);
  });

  await t("content: states the project's evidence rules a household needs (missing ≠ excluded, wording ≠ proof, date ≠ current, bare $ unresolved)", () => {
    assert.match(joined, /not mentioned in your documents, that alone does not mean it is excluded/);
    assert.match(joined, /does not on its own prove that you have it/);
    assert.match(joined, /shows what was true on its date/);
    assert.match(joined, /only a symbol such as "\$" without saying which currency, DearPolicy leaves the currency unconfirmed/);
    assert.match(joined, /same policy number can still cover different people or products/);
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
    const files = ["lib/learn/content.ts", "lib/learn/match.ts", "components/learn-links.tsx", "components/learn-notice.tsx", "app/learn/page.tsx", "app/learn/[slug]/page.tsx"];
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
    assert.deepEqual(walk("app/learn").sort(), files.filter((f) => f.startsWith("app/learn")).sort(), "unexpected file under app/learn");
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      for (const i of imports) assert.ok(/^(next\/link|next\/navigation|react|@\/lib\/learn\/(content|match)|@\/components\/learn-notice|\.\/content)$/.test(i), `${f} imports ${i}`);
      assert.doesNotMatch(src, /\bfetch\(|supabase|anthropic|process\.env/i, f);
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

  console.log(`\n${passed} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}
void main();
