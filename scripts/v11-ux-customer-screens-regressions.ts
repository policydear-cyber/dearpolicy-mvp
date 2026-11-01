/**
 * V1.1 Task 4 (customer experience) -- static and unit regressions.
 *
 *   node --import tsx scripts/v11-ux-customer-screens-regressions.ts
 *
 * 1. Every household screen (app/**\/page.tsx outside app/operator and
 *    app/reviewer, plus the app shell) is scanned for system work shown to
 *    customers: database/search/queue/scanner/model status, model or
 *    provider names, quotas, billing, token counts, internal rule/contract/
 *    page counts, ruled-out lists, and the routine repair tasks ("re-read all
 *    documents", "re-analyse", "confirm this heading", "fix a row").
 * 2. The operator area exists, is gated by the staff authorization boundary
 *    and holds the diagnostics and extraction review that left household
 *    screens.
 * 3. Claims list and claim detail render status and requested documents only
 *    from claimDisplayStatus() (the API's `display`), never from raw status.
 * 4. Usage & Cost is out of household navigation; the plan page has no
 *    infrastructure detail; the operator page states the owner's provider
 *    budget honestly.
 * 5. Sign-in reads the form at submit, is never disabled by empty state, and
 *    navigates once.
 * 6. customerMessage()/customerAnswerText() hide raw provider errors (the
 *    endowment defect fixture: a raw OpenAI quota error with an organisation
 *    identifier) and keep plain messages.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { customerAnswerText, customerError, customerMessage, ANSWER_UNAVAILABLE } from "../components/customer-text";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (error) { console.error(`  FAIL ${name}\n${error instanceof Error ? error.stack : error}`); process.exitCode = 1; }
}
const read = (f: string) => readFileSync(path.resolve(f), "utf8");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
/** Household-facing UI source: every page and component under app/ except
 * the operator and reviewer areas and API routes, plus the shell. The privacy
 * notice is left out on purpose: the law asks it to name the services that
 * receive a household's information (the model provider, the database), which
 * this test rightly keeps off every working screen. Its own test is
 * scripts/privacy/notice-test.ts. */
const CUSTOMER_FILES = [
  ...walk("app").filter((f) => f.endsWith(".tsx") && !/^app[\\/](operator|reviewer|api)[\\/]/.test(f) && !/^app[\\/]privacy[\\/]page\.tsx$/.test(f)),
  "components/AppShell.tsx",
];
/** The text a person can read: string literals, template literals and JSX
 * text. Comments and identifiers are not shown to anyone. */
function visibleText(source: string): string {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1 ");
  const literals = noComments.match(/"[^"\n]*"|`[^`]*`|'[^'\n]*'/g) ?? [];
  const jsxText = noComments.match(/>[^<>{}\n]*[A-Za-z][^<>{}\n]*</g) ?? [];
  return [...literals, ...jsxText].join("\n");
}

const FORBIDDEN_ON_CUSTOMER_SCREENS: [RegExp, string][] = [
  [/re-?read all|re-?read (?:the|your|every) documents?|re-?reading the document/i, "re-read documents as a customer task"],
  [/re-?analy[sz]/i, "re-analyse as a customer task"],
  [/confirm this\b|table heading|confirm (?:a|the) heading/i, "confirm a table heading"],
  [/fix a row|>\s*Fix\s*<|"Fix"|add a row|save row|save my correction|re-check documents/i, "fix/add rows"],
  [/semantic search|pinecone|search index|embedding/i, "search status"],
  [/\bdatabase\b|\bqueue\b|job worker|\bscanner\b/i, "database/queue/scanner status"],
  [/reading model|answering model|local model|model calls?|which model|\bgpt-?\d|openai|gemini|anthropic|ollama/i, "model names or status"],
  [/\btokens\b|tokens? (?:in|out|used)|list price|per 1M|hard stop|quota|billing|provider/i, "provider cost, quota or billing detail"],
  [/\borg(?:anization|anisation)?[-_ ]id\b|org-[a-z0-9]{6,}/i, "organisation identifiers"],
  [/benefit rules? (?:read|on file)|conditions? read from|\bcontracts?\b.*\bread\b|pages? read|passages|pages stored|evidence batch|rows in the ledger|documents? read this month/i, "counts of internal rules, contracts, pages or batches"],
  [/ruled out|excluded or pending benefits|not applicable here/i, "long ruled-out lists"],
  [/confidence \$\{|confidence [0-9]/i, "extraction confidence scores"],
  [/Assessment ready|coroner's report\)/i, "claim status not from claimDisplayStatus"],
];

test("household screens carry no system work (grep of every page)", () => {
  const hits: string[] = [];
  for (const file of CUSTOMER_FILES) {
    const text = visibleText(read(file));
    for (const [pattern, what] of FORBIDDEN_ON_CUSTOMER_SCREENS) {
      const m = text.match(pattern);
      if (m) hits.push(`${file}: ${what} -- "${m[0]}"`);
    }
  }
  assert.deepEqual(hits, [], "customer screens must not show system work");
});

test("household screens never render a raw server error or a raw processing error", () => {
  const hits: string[] = [];
  for (const file of CUSTOMER_FILES) {
    const src = read(file);
    if (/\{\s*policy\.processing_error\s*\}|\{\s*doc\.processing_error\s*\}|review_reason\s*\?\?/.test(src)) hits.push(`${file}: raw processing error or review reason`);
    if (/e instanceof Error\s*\?\s*e\.message|error instanceof Error\s*\?\s*error\.message|err instanceof Error\s*\?\s*err\.message/.test(src)) hits.push(`${file}: raw caught error message`);
    // `throw new Error(payload.error || "...")` is fine: the throw is caught
    // and shown through customerError(). Anything else passing it on is not.
    if (/(?<!throw new Error\()(?:payload|data|json|res)\.error\s*(?:\|\||\?\?)\s*"/.test(src)) hits.push(`${file}: raw API error passed through`);
    if (/setError\(\s*(?:claimRes|res|data|payload)\.error\s*\)/.test(src)) hits.push(`${file}: raw API error set`);
  }
  // The reviewer area is staff-only, but its pages are not in CUSTOMER_FILES.
  assert.deepEqual(hits, []);
});

test("household navigation: no Usage & Cost, no operator or reviewer links; no service status panel", () => {
  const shell = read("components/AppShell.tsx");
  const nav = shell.slice(shell.indexOf("const nav"), shell.indexOf("];", shell.indexOf("const nav")));
  // Links only: an item's `also` list names pages that keep it highlighted (Account settings for /usage), not menu entries.
  // Any quote style ("/usage", '/usage', `/usage`), so a re-quoted link is still read.
  const links = [...nav.matchAll(/\bhref\s*:\s*(["'`])([^"'`]+)\1/g)].map((m) => m[2]);
  assert.ok(links.length >= 4, "the household menu was read");
  assert.ok(!links.includes("/usage"), "Usage is not in household navigation");
  assert.ok(!links.some((h) => h.startsWith("/operator") || h.startsWith("/reviewer")));
  assert.ok(!/services\.map|service-row|payload\.services/.test(shell), "no per-service status in the household shell");
  assert.match(shell, /const operatorNav/);
  assert.match(shell, /operatorArea \? operatorNav : nav/);
});

test("operator area exists and is gated by the staff authorization boundary", () => {
  const layout = read("app/operator/layout.tsx");
  assert.match(layout, /import \{ requireActiveClaimReviewer \} from "@\/lib\/claims\/reviewers\/boundary"/);
  assert.match(layout, /await requireActiveClaimReviewer\(\)/);
  assert.match(layout, /notFound\(\)/);
  assert.match(layout, /dynamic = "force-dynamic"/);
  for (const page of ["app/operator/page.tsx", "app/operator/documents/page.tsx", "app/operator/benefits/page.tsx", "app/operator/coverage/page.tsx"]) assert.ok(existsSync(page), page);
  // The diagnostics that left household screens are here.
  assert.match(read("app/operator/documents/page.tsx"), /Re-analyse/);
  assert.match(read("app/operator/documents/page.tsx"), /Add to semantic search/);
  assert.match(read("app/operator/benefits/page.tsx"), /Re-read all documents/);
  assert.match(read("app/operator/benefits/page.tsx"), /confirm this/);
  assert.match(read("app/operator/coverage/page.tsx"), />Fix</);
  const overview = read("app/operator/page.tsx");
  assert.match(overview, /usageByOperationAndModel\(null, since\)/);
  assert.match(overview, /budgetConfig\(\)/);
  assert.match(overview, /The provider enforces it; DearPolicy does not and cannot/);
  assert.match(overview, /Subscription price/);
});

test("claims list and claim detail render status and requested documents only from claimDisplayStatus()", () => {
  const list = read("app/claims/page.tsx");
  const detail = read("app/claims/[id]/page.tsx");
  for (const [name, src] of [["list", list], ["detail", detail]] as const) {
    assert.ok(!/\.status\s*===\s*"complete"/.test(src), `${name}: no status from raw claim status`);
    assert.match(src, /requestedDocuments/, `${name}: requested documents from display`);
    assert.match(src, /tone:"info"\|"waiting"\|"ready"|tone: "info" \| "waiting" \| "ready"/, `${name}: typed against the shared interface`);
  }
  assert.match(list, /const d=c\.display\?\?UNKNOWN/);
  assert.match(detail, /claim\.display\?\.label/);
  assert.ok(!/death certificate, police report, coroner/.test(list), "list action never names fixed death documents");
  assert.ok(!/fact\{factCount/.test(list) && !/factCount/.test(list), "no internal fact counts");
});

test("Benefits and Coverage pages: what documents establish, source collapsed, no repair tasks", () => {
  const benefits = read("app/schedule/page.tsx");
  const coverage = read("app/ledger/page.tsx");
  for (const src of [benefits, coverage]) {
    assert.match(src, /<details className="source-details">/);
    assert.ok(!/method:"PATCH"[\s\S]*needsReview:false|markCorrect|rereadAll|readAll\(|action:"read"\}\)\}\)\.then\(\(\)=>load/.test(src) || src === coverage, "no confirm/re-read flows");
    assert.ok(!/method:"DELETE"/.test(src), "no row deletion");
  }
  assert.ok(!/schedule-summary/.test(benefits) && !/schedule-summary/.test(coverage), "no internal counts summary");
  // The one clarification: an unreadable amount, only for simple amounts.
  assert.match(benefits, /attention==="unreadable"&&CLARIFIABLE\.has/);
  assert.ok(!/attention==="confirm"&&<button/.test(benefits));
  assert.ok(!/method:"POST"[^\n]*action:"add"|setAdding/.test(coverage), "no manual rows");
});

test("chat: one direct answer, collapsed sources, plain uncertainty, one next step, no internals", () => {
  const chat = read("app/chat/page.tsx");
  assert.match(chat, /<details className="citations"><summary>Sources<\/summary>/);
  assert.ok(!/citations\.length\} sources/.test(chat));
  assert.ok(!/scenarioClassifications/.test(chat), "no classification internals");
  assert.ok(!/policyReview/.test(chat), "no per-contract page/passage table");
  assert.ok(!/excludedBenefits/.test(chat), "no ruled-out list");
  assert.ok(!/reviewerRequirements/.test(chat), "no reviewer routing");
  assert.match(chat, /uniqueSteps\(answer\?\.nextSteps\)/);
  assert.match(chat, /shown\(steps\[0\]\)/);
  assert.match(chat, /customerAnswerText\(message\.content\)/);
  assert.match(chat, /customerMessage\(p\?\.stage,/);
});

test("Plan usage page: allowance only, no infrastructure", () => {
  const usage = read("app/usage/page.tsx");
  const text = visibleText(usage);
  assert.ok(!/model|token|routing|hard stop|cost|\$/i.test(text.replace(/\$\{/g, "")), "no model, token, routing or cost text");
  assert.match(usage, /includedChatTurns/);
  // Plan usage is reached from the Account settings tabs (Household, People, Plan usage).
  assert.match(read("components/account-tabs.tsx"), /\bhref\s*:\s*(["'`])\/usage\1/);
  assert.match(read("app/household/page.tsx"), /<AccountTabs/);
});

test("sign-in: form values read at submit, button disabled only while busy, one navigation", () => {
  const login = read("app/login/page.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(login, /new FormData\(e\.currentTarget\)/);
  assert.match(login, /disabled=\{busy\}/);
  assert.ok(!/disabled=\{busy \|\| !email/.test(login));
  assert.ok(!/router\.refresh\(\)/.test(login) && !/router\.push\(/.test(login), "no push+refresh double navigation");
  assert.match(login, /window\.location\.assign\(/);
  assert.match(login, /method="post"/);
  assert.match(login, /name="email"/);
  assert.match(login, /name="password"/);
});

test("customerMessage/customerAnswerText: the endowment defect fixture never reaches a household", () => {
  const raw = "429 You exceeded your current quota, please check your plan and billing details. For more information on this error, read the docs: https://platform.openai.com/docs/guides/error-codes/api-errors. (org-AbCdEf1234567890 insufficient_quota)";
  assert.equal(customerMessage(raw, "fallback"), "fallback");
  assert.equal(customerAnswerText(raw), ANSWER_UNAVAILABLE);
  assert.equal(customerAnswerText("Your endowment plan matures on 1 March 2031 (page 2)."), "Your endowment plan matures on 1 March 2031 (page 2).");
  assert.equal(customerAnswerText("The fracture benefit is S$400 per fracture (page 4)."), "The fracture benefit is S$400 per fracture (page 4).");
  for (const leak of ["connect ECONNREFUSED 127.0.0.1:5432", "relation \"policy_benefits\" does not exist", "Gemini API error: RESOURCE_EXHAUSTED", "Request failed with status code 500", "TypeError: Cannot read properties of undefined (reading 'id')"]) {
    assert.equal(customerMessage(leak, "fallback"), "fallback", leak);
    assert.equal(customerError(new Error(leak), "fallback"), "fallback", leak);
  }
  for (const plain of ["Incorrect email or password.", "Files must be 50 MB or smaller.", "This exact document is already in DearPolicy.", "Create at least one family profile before uploading documents."]) {
    assert.equal(customerMessage(plain, "fallback"), plain);
  }
  assert.equal(customerMessage(undefined, "fallback"), "fallback");
  assert.equal(customerMessage("x".repeat(400), "fallback"), "fallback");
});

test("'not found in the uploaded documents' never becomes 'not covered' on household screens", () => {
  for (const file of ["app/page.tsx", "app/coverage/page.tsx"]) {
    const text = visibleText(read(file));
    assert.ok(!/"Not covered"|>Not covered</.test(text), `${file} says "Not covered"`);
  }
  assert.ok(!/x\.currency\?\?"SGD"/.test(read("app/coverage/page.tsx")), "no assumed currency");
});

console.log(`V1.1 customer-screen regressions: ${passed} passed${process.exitCode ? ", some FAILED" : ""}.`);
