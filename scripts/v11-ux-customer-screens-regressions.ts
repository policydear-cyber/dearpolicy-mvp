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
import { isoDateWords } from "@/lib/format/detail-date";
import { waitingNote } from "@/lib/benefit-table/waiting-note";
import { printedDay } from "@/lib/simple-chat/verify";
import { shownInsurer } from "@/lib/policies/insurer-name";
import { documentName } from "@/lib/policies/document-name";
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
 * the operator, reviewer and admin (app/admin, allow-listed staff only; scripts/admin/console-test.ts) areas and API routes, plus the shell. The privacy
 * notice is left out on purpose: the law asks it to name the services that
 * receive a household's information (the model provider, the database), which
 * this test rightly keeps off every working screen. Its own test is
 * scripts/privacy/notice-test.ts. */
const CUSTOMER_FILES = [
  ...walk("app").filter((f) => f.endsWith(".tsx") && !/^app[\\/](operator|reviewer|admin|api)[\\/]/.test(f) && !/^app[\\/]privacy[\\/]page\.tsx$/.test(f)),
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
  // The household's own plan (Free, Plus or Family; lib/plans/catalogue.ts): its question allowance is shown.
  assert.match(usage, /questionsPerMonth/);
  // Plan usage is reached from the Account settings tabs (Household, People, Plan usage).
  assert.match(read("components/account-tabs.tsx"), /\bhref\s*:\s*(["'`])\/usage\1/);
  assert.match(read("app/household/page.tsx"), /<AccountTabs/);
});

test("Plan usage page: over the allowance is said in words, and the payment line only appears when payment is open", () => {
  const usage = read("app/usage/page.tsx");
  assert.match(usage, /const beyond=included!=null&&used>included;/);
  assert.match(usage, /beyond\?`\$\{used\} used, \$\{included\} included`:`\$\{used\} of \$\{included\}`/);
  assert.match(usage, /\{beyond&&over\?<small data-testid=\{testId\+"-over"\}>\{over\}<\/small>:null\}/);
  assert.equal((usage.match(/That is more than the \$\{plan\.name\} plan includes\. Your documents and earlier answers are still here\./g) ?? []).length, 1, "documents");
  assert.equal((usage.match(/That is more than the \$\{plan\.name\} plan includes\. Your earlier answers are still here\./g) ?? []).length, 1, "questions");
  assert.match(usage, /aria-valuetext=\{beyond\?`\$\{used\} used, \$\{included\} included`:undefined\}/);
  assert.match(usage, /\{sub\.billingEnabled\?<p>\{PLANS\.plus\.name\} and \{PLANS\.family\.name\} are paid through Stripe&rsquo;s secure page\./);
  assert.match(usage, /are not open for purchase yet\./);
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
  for (const plain of ["Incorrect email or password.", "Files must be 50 MB or smaller.", "This exact document is already in DearPolicy.", "Add the people your policies cover on the Family page first, then upload this document again."]) {
    assert.equal(customerMessage(plain, "fallback"), plain);
  }
  assert.equal(customerMessage(undefined, "fallback"), "fallback");
  assert.equal(customerMessage("x".repeat(400), "fallback"), "fallback");
});

test("a household with no people is asked to add them before choosing a file, never refused after the upload", () => {
  const page = read("app/policies/page.tsx");
  assert.match(page, /loaded && familyKnown && !family\.length \? <div className="upload-form" data-testid="upload-needs-family">/);
  // A failed family fetch is not an empty family: the prompt shows only when the list was read (TE #416).
  assert.match(page, /fetch\("\/api\/family", \{ cache: "no-store" \}\)\.then\(async \(r\) => r\.ok \? r\.json\(\) : null\)\.catch\(\(\) => null\)/);
  assert.match(page, /setFamilyKnown\(!!f && Array\.isArray\(f\.family\)\)/);
  // The empty Library under the prompt points to no upload "above" (TE #416).
  assert.match(page, /familyKnown && !family\.length \? "No documents yet\. First add the people your policies cover/);
  assert.match(page, /data-testid="upload-needs-family"[\s\S]{0,600}href="\/family"/);
  assert.match(read("app/api/policies/upload/accept.ts"), /Add the people your policies cover on the Family page first/);
});

test("'not found in the uploaded documents' never becomes 'not covered' on household screens", () => {
  for (const file of ["app/page.tsx", "app/coverage/page.tsx"]) {
    const text = visibleText(read(file));
    assert.ok(!/"Not covered"|>Not covered</.test(text), `${file} says "Not covered"`);
  }
  assert.ok(!/x\.currency\?\?"SGD"/.test(read("app/coverage/page.tsx")), "no assumed currency");
});

test("the empty Ask screen shows how to say what happened, and counts only documents already read", () => {
  const page = read("app/chat/page.tsx");
  assert.match(page, /If something happened, say who and what, for example &ldquo;my daughter was admitted to hospital last night&rdquo;\./);
  // Ready means finished reading AND a clean scan result, the same two statuses /api/policies uses for "clean".
  assert.match(page, /const READABLE_SCANS=new Set\(\["scan_clean","not_scanned_prototype"\]\)/);
  assert.match(page, /ready:policies\.filter\(p=>p\.processing_status==="ready"&&READABLE_SCANS\.has\(p\.quarantine_status\?\?""\)\)\.length/);
  assert.match(read("app/api/policies/route.ts"), /quarantine_status IN \('scan_clean','not_scanned_prototype'\)/);
  // The "still being read" count skips a rejected scan by its real name (it was "rejected", which no document ever has).
  assert.match(page, /\?\?"scan_clean"\)!=="scan_rejected"/);
  assert.ok(!/!=="rejected"/.test(page), "no comparison against a status no document has");
  assert.match(page, /ready>0\?<p className="chat-library-note" data-testid="chat-ready-note">Answers use the \{ready===1\?"one document":`\$\{ready\} documents`\} DearPolicy has read so far\./);
  assert.match(page, /import \{ documentReadLabel \} from "@\/lib\/documents\/upload-problems"/);
  assert.match(page, /partly:policies\.filter\(p=>p\.processing_status==="ready"&&READABLE_SCANS\.has\(p\.quarantine_status\?\?""\)&&!documentReadLabel\(/);
  assert.match(page, /only partly read\. <Link className="text-link" href="\/policies">See Documents<\/Link>/);
  const welcome = page.slice(page.indexOf("function ChatWelcome"), page.indexOf("function ChatContent"));
  assert.ok(!/S\$|\$\d|covered|not covered/i.test(welcome.replace(/Answers use|say who and what/g, "")), "the welcome promises no amount or verdict");
});

test("the appearance toggle keeps one name; its pressed state says which appearance is on", () => {
  const shell = read("components/AppShell.tsx");
  const button = shell.match(/<button[^>]*className="theme-toggle icon-only"[^>]*>/)?.[0] ?? "";
  assert.ok(button, "theme toggle button found");
  // A pressed toggle whose name flips ("Switch to light" while pressed) reads as a contradiction to a screen reader.
  assert.match(button, /aria-pressed=\{dark\}/);
  assert.match(button, /aria-label="Dark appearance"/);
  assert.ok(!/Switch to (light|dark) appearance/.test(shell), "the name does not flip with the state");
});

test("a folder's Remove button says it takes the document out of the policy, not off file", () => {
  const folders = read("components/policy-folders.tsx");
  // Beside a document's own Delete, a bare "Remove" reads as the same thing (Live tester pass 14): the idle button names what it does.
  // Each accessible name begins with its visible words (WCAG 2.5.3), the document after it.
  assert.match(folders, /aria-label=\{`Remove from policy: \$\{docName\(d\.policyId\)\}`\} onClick=\{\(\) => setArmed\(d\.policyId\)\}>Remove from policy<\/button>/);
  assert.match(folders, /aria-label=\{`Remove from this policy: \$\{docName\(d\.policyId\)\}`\} onClick=\{\(\) => void patch\(\{ remove: \[d\.policyId\] \}[^\n]*>Remove from this policy<\/button>/);
  assert.ok(!/>Remove<\/button>/.test(folders.slice(0, folders.indexOf("function useChoice"))), "no bare Remove button on a folder's documents");
  assert.match(folders, /Removed it from \$\{title\}\. It is still on file\./);
  // The longer label must not squeeze a long title on a narrow phone: below 400px the action sits under the title.
  assert.match(read("app/globals.css"), /@media \(max-width: 400px\) \{\s*\.folder-docs li \{ grid-template-columns: 1fr; \}/);
});

test("a document's Details panel writes dates and amounts as the rest of the site does, and never repeats a benefit's name (27 Nov live check)", () => {
  const page = read("app/policies/page.tsx");
  // Dates: "19 October 2026", never "2026-10-19"; anything that is not a date is shown as written.
  assert.match(page, /const detailDate = \(value: unknown\): string => isoDateWords\(value\) \?\? showValue\(value\);/);
  assert.match(page, /data-testid="detail-expiry">\{detailDate\(d\.renewalOrExpiryDate\)\}/);
  assert.match(page, /data-testid="detail-effective">\{detailDate\(d\.effectiveDate\)\}/);
  assert.doesNotMatch(page, /\{showValue\(d\.(?:effectiveDate|renewalOrExpiryDate)\)\}/);
  // Amounts: the one money format (S$300,000), which says so when no currency is stated.
  assert.match(page, /function reviewAmount\([^)]*\): string \{\s*if \(amount == null \|\| \(typeof amount === "string" && amount\.trim\(\) === ""\) \|\| !Number\.isFinite\(Number\(amount\)\)\) return "—";[\s\S]*?formatMoney\(numeric, currency\);/);
  assert.doesNotMatch(page, /\$\{currency\} \$\{numeric\.toLocaleString\(\)\}/);
  assert.match(page, /\(typeof amount === "string" && amount\.trim\(\) === ""\)/, "an empty amount is a dash too");
  assert.match(page, /numeric < 0 \? "-" \+ formatMoney\(-numeric, currency\)/, "a refund keeps its currency mark");
  assert.match(page, /\$\{detailDate\(p\.payment_date\)\}/, "the premium list's dates are written the same way");
  assert.match(read("e2e/ingestion-tests/document-ingestion.spec.ts"), /detail-expiry"\]'\)\)\.toContainText\("1 January 2027"\)/);
  // A benefit whose product name is its own category is named once.
  assert.match(page, /c\.product_name && c\.product_name\.trim\(\)\.toLowerCase\(\) !== c\.category\.trim\(\)\.toLowerCase\(\)/);
});

test("isoDateWords writes the document's own day, never through a Date, and leaves anything else to the caller (TE #630)", () => {
  assert.equal(isoDateWords("2026-10-19"), "19 October 2026");
  assert.equal(isoDateWords("2026-10-19T23:30:00-05:00"), "19 October 2026");
  assert.equal(isoDateWords("2028-02-29"), "29 February 2028");
  assert.equal(isoDateWords("2026-01-05"), "5 January 2026", "no leading zero");
  for (const v of ["19/10/2026", "10/19/2026", "2026-13-01", "2026-10", "garbage", "", null, undefined, 20261019]) assert.equal(isoDateWords(v), null, String(v));
});

test("the Policy currency text says a bare $ is read in the household's currency, as the sign-up line and docs/copy.md do (27 Nov live check)", () => {
  const page = read("app/household/page.tsx");
  assert.match(page, /When a document prints an amount without a currency, or with only a “\$”, DearPolicy reads it in the currency you choose here\. A currency written in the document, such as S\$ or US\$, always comes first\./);
  assert.doesNotMatch(page, /left as they are/, "a bare $ is never said to be left alone");
  assert.match(read("app/welcome/page.tsx"), /If it shows only \\u201c\$\\u201d, DearPolicy reads it in the currency you choose when you sign up/);
});

test("the pricing section does not promise an upgrade the app cannot sell yet (DC 27 Nov)", () => {
  const pricing = read("components/public/pricing-section.tsx");
  assert.match(pricing, /Every account starts on Free, with no card needed\. Plus and Family are coming soon\./);
  assert.doesNotMatch(pricing, /Upgrade any time/);
});

test("a recent cover whose benefit is 'subject to the waiting period' says so on Coverage, with no length, date or verdict (Live tester 27 Nov)", () => {
  const now = new Date("2026-11-27T04:00:00Z");
  const row = { benefit: "3.1 Critical Illness Benefit", conditions: ["This benefit is subject to the waiting period as stated in Clause 8."] };
  const note = waitingNote({ startDate: "19/10/2026" }, [row], now);
  assert.ok(note && /waiting period applies/i.test(note) && /may not be payable yet/i.test(note));
  assert.ok(!/\d|S\$/.test(note!), "no length, date or amount: the card cannot know them");
  assert.equal(waitingNote({ startDate: "19 October 2026" }, [row], now), note, "any printed date format");
  assert.equal(waitingNote({ startDate: "2026-10-19" }, [row], now), note);
  assert.equal(waitingNote({ startDate: "19/10/2024" }, [row], now), null, "a cover older than a year is past every waiting period");
  assert.equal(waitingNote({ startDate: "27/11/2025" }, [row], now), null, "exactly a year");
  assert.notEqual(waitingNote({ startDate: "28/11/2025" }, [row], now), null, "a day inside the year");
  assert.equal(waitingNote({ startDate: null }, [row], now), null, "no printed start: not judged new");
  assert.equal(waitingNote({ startDate: "garbage" }, [row], now), null);
  assert.equal(waitingNote({ startDate: "19/12/2026" }, [row], now), null, "a start date still ahead says nothing");
  assert.equal(waitingNote({ startDate: "19/10/2026" }, [{ benefit: "Death Benefit", conditions: ["Payable once"] }], now), null, "no waiting period named");
  assert.equal(waitingNote({ startDate: "19/10/2026" }, [{ benefit: "Waiting period benefit", conditions: [] }], now), null, "a title alone says nothing about this cover");
  for (const denied of ["No waiting period applies to accidental death.", "Waiting period: nil", "The waiting period is waived for accidents.", "Not subject to any waiting period", "Waiting period: none", "Without a waiting period.", "The waiting period does not apply to accidents.", "Waiting period: N/A"])
    assert.equal(waitingNote({ startDate: "19/10/2026" }, [{ benefit: "Death", conditions: [denied] }], now), null, denied);
  for (const applies of ["This benefit is subject to the waiting period as stated in Clause 8.", "A 90 day waiting period applies.", "Payable after the waiting period of 90 days."])
    assert.notEqual(waitingNote({ startDate: "19/10/2026" }, [{ benefit: "CI", conditions: [applies] }], now), null, applies);
  const at = (c: string) => waitingNote({ startDate: "19/10/2026" }, [{ benefit: "X", conditions: [c] }], now);
  for (const zero of ["A waiting period of 0 days applies.", "0-day waiting period applies.", "Zero waiting period applies.", "There is no 30 day waiting period.", "Not applicable: the waiting period applies."]) assert.equal(at(zero), null, zero);
  for (const w of ["nil", "none", "without", "waived", "waiver", "exempt", "n/a", "nor", "never", "does not", "doesn't", "not", "no"]) assert.equal(at(`The waiting period applies, ${w}.`), null, `negation word: ${w}`);
  for (const a of ["Waiting period will apply to illness.", "Excluded during the waiting period.", "Claims within the waiting period are excluded.", "Payable before the waiting period ends.", "The waiting period runs until January.", "The waiting period must be served.", "The waiting period has elapsed.", "On completion of the waiting period."]) assert.notEqual(at(a), null, a);
  assert.notEqual(at("30 days; subject to the waiting period."), null, "a figure beside an applying phrase");
  assert.notEqual(at("No waiting period applies to accidents. A waiting period applies to illness."), null, "each sentence judged alone");
  assert.notEqual(waitingNote({ startDate: "19/10/2026" }, [{ benefit: "A", conditions: ["No waiting period applies."] }, { benefit: "B", conditions: ["Subject to the waiting period."] }], now), null, "any row, not every row");
  assert.notEqual(waitingNote({ startDate: "27/11/2026" }, [row], now), null, "a cover that began today");
  assert.notEqual(waitingNote({ startDate: "27/11/2026" }, [row], new Date("2026-11-26T17:00:00Z")), null, "the Singapore day, not the UTC day, is today");
  assert.notEqual(waitingNote({ startDate: "19/10/2026" }, [{ benefit: "CI", conditions: ["Covers adults only.", "This benefit is subject to the waiting period as stated in Clause 8."] }], now), null, "one of several conditions");
  const card = read("components/benefit-table-coverage.tsx");
  assert.match(card, /waitingNote\(cover,rows\)\?<p className="muted cov-reading" data-testid="table-waiting">/);
  assert.match(card, /<Link className="text-link" href="\/chat">Ask a question<\/Link>/);
});

test("Documents: a slogan or sentence stored as the insurer is never shown as the insurer's name (Live tester 27 Nov)", () => {
  for (const name of ["Singlife", "AIA Singapore Private Limited", "Great Eastern Life Assurance Co. Ltd.", "Prudential Assurance Company Singapore (Pte) Limited", "  NTUC   Income  ", "Aviva Ltd (trading as Singlife with Aviva), Singapore Branch", "Income Insurance Limited (formerly NTUC Income Insurance Co-operative Limited)", "Prudential Assurance Company Singapore (Pte) Limited (Reg. No. 199902028N)", "Yahoo! Insurance", "Yahoo!", "Compañía Española de Seguros de Crédito a la Exportación", "The Hartford Steam Boiler Inspection and Insurance Company of Connecticut", "Mapfre Vida, S.A. de Seguros y Reaseguros sobre la Vida Humana", "Allianz Insurance Company of Singapore Pte. Ltd., Hong Kong Branch", "one two three four five six seven eight nine ten eleven twelve"]) assert.ok(shownInsurer(name), `${name} is a name`);
  assert.equal(shownInsurer("  NTUC   Income  "), "NTUC Income");
  for (const slogan of ["Protecting what matters most to you!", "Why wait? Get covered today", "Plans for life; peace of mind", "We help you and your family live well, plan ahead and stay protected every day", "", "   ", null, undefined, 7, "N/A", "Not applicable", "Unknown", "undefined", "null", "-", "one two three four five six seven eight nine ten eleven twelve thirteen"]) assert.equal(shownInsurer(slogan), null, `${String(slogan)} is not a name`);
  for (const [file, re] of [["app/page.tsx", /shownInsurer\(doc\.insurer\)/], ["app/ledger/page.tsx", /shownInsurer\(l\.insurer\)/], ["app/ledger/page.tsx", /shownInsurer\(row\.insurer\)/], ["app/life-stages/page.tsx", /shownInsurer\(p\.insurer\)/], ["components/source-list.tsx", /shownInsurer\(doc\.insurer\)/], ["app/coverage/page.tsx", /shownInsurer\(x\.insurer\)/], ["app/records/page.tsx", /shownInsurer\(r\.insurer\)/], ["app/records/page.tsx", /shownInsurer\(item\.insurer\)/], ["app/schedule/page.tsx", /shownInsurer\(rows\[0\]\.insurer\)/]] as const) assert.match(read(file), re, `${file} shows the insurer through shownInsurer`);
  const base = { product_name: null, original_filename: "", document_role: "policy_wording", policy_number: null };
  assert.ok(!/matters most/.test(documentName({ ...base, insurer: "Protecting what matters most to you!" })), "a slogan never names the document");
  assert.match(documentName({ ...base, insurer: "Singlife" }), /^Singlife /);
  const page = read("app/policies/page.tsx");
  assert.match(page, /\[shownInsurer\(policy\.insurer\) \?\? "Insurer not known yet",/);
  assert.match(page, /\(shownInsurer\(policy\.insurer\) \?\? documentName\(policy\)\)/);
  assert.match(page, /showValue\(shownInsurer\(d\.insurer\)\)/);
  assert.match(page, /cardKindLabel\(readAsPolicyDocument\(policy\) \? "Policy document" : roleLabel\(policy\.document_role\), authorityLabel\(policy\)\)[^\n]*\.filter\(Boolean\)\.join\(" · "\)/, "a card never says 'Policy wording · General wording'");
});

test("Coverage: a benefit's long clauses sit behind a control, never in the row's line (Live tester 27 Nov)", () => {
  const cov = read("components/benefit-table-coverage.tsx");
  assert.match(cov, /splitRowDetail\(row\)/);
  assert.match(cov, /<details className="cov-long" data-testid="table-long-conditions"><summary>\{plural\(split\.long\.length,"longer condition"\)\}<\/summary>\{split\.long\.map\(\(c,i\)=><p key=\{i\}>\{c\}<\/p>\)\}<\/details>/);
  assert.doesNotMatch(cov, /\browDetail\(/, "the page no longer joins every clause into the line");
});

test("Documents: a long reading never promises a minute, keeps checking for an hour, and says it is still working", () => {
  const page = read("app/policies/page.tsx");
  assert.doesNotMatch(page, /usually takes under a minute|after ten minutes/i);
  assert.match(page, /elapsed > POLL_LIMIT_MS\) \{ setPollingPaused\(true\)/);
  // A first-timer is told what types work, that it is one file at a time, and what happens after upload (no time promise).
  assert.match(page, /A PDF, Word \(\.docx\), scan or photo, up to \{MAX_UPLOAD_LABEL\}\. One file at a time\./);
  // The note shows only before a file is chosen, never while uploading or after a result (it would sit beside "Uploaded").
  assert.match(page, /\{!file && !busy && !status \? <small className="field-note" data-testid="upload-next-note">Then DearPolicy reads it\. A long document can take many minutes, and you can leave this page\./);
  // The Details panel uses plain words, not the internal ones (Live tester, 27 Nov).
  assert.match(page, /plainAuthority\(d\.authorityLabel\)/);
  assert.match(page, /<b>Cover this document shows<\/b>/);
  assert.match(page, / · confirmed against the page<\/small>/);
  assert.match(page, / · amount not yet confirmed against the page<\/small>/);
  assert.doesNotMatch(page, /source-verified|Cover this document confirms/);
  // A new household is told it can start with one person (Live tester, 27 Nov).
  // One date style in a chat answer: the base's printed date is written like the neighbouring "As printed 6 Oct 2022", never "06/10/2022" (Live tester, 27 Nov).
  const verify = read("lib/simple-chat/verify.ts");
  assert.match(verify, /, as of \$\{printedDay\(c\.base\.asOf\)\}/);
  assert.equal(printedDay("2022-10-06"), "6 Oct 2022");
  assert.equal(printedDay("2022-02-31"), "31/02/2022", "a day the calendar lacks keeps the document's digits, never rolls to another date");
  assert.equal(printedDay("2024-02-29"), "29 Feb 2024");
  assert.equal(printedDay("garbage"), "garbage");
  for (const [iso, digits] of [["2022-13-06", "06/13/2022"], ["2022-10-00", "00/10/2022"], ["2022-12-32", "32/12/2022"], ["2022-00-10", "10/00/2022"]]) assert.equal(printedDay(iso), digits, `${iso} never throws and keeps the digits`);
  assert.match(verify, /!Number\.isNaN\(t\.getTime\(\)\)/);
  assert.equal(printedDay("2022-09-06"), "6 Sep 2022", "September is Sep, as the answer card's chip writes it, on every Node/ICU");
  ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].forEach((m, i) => assert.equal(printedDay(`2022-${String(i + 1).padStart(2, "0")}-06`), `6 ${m} 2022`, `month ${i + 1} is ${m}`));
  assert.match(verify, /: iso\.split\("-"\)\.reverse\(\)\.join\("\/"\);/);
  const family = read("app/family/page.tsx");
  // Help on the two required fields, and the spouse option names partners; both stay required (DC 17 Nov rule).
  assert.match(family, /Used to work out which age limits apply\./);
  assert.doesNotMatch(family, /Used only for/); // the date also drives the card's age, life stages, chat sums and the export
  assert.equal((family.match(/If they have no other name, use their full name again\./g) ?? []).length, 2, "add and edit forms");
  assert.equal((family.match(/Used to work out which age limits apply\./g) ?? []).length, 2, "add and edit forms");
  assert.match(family, /newShows\("dob"\) \? "fm-new-dob-error fm-new-dob-note" : "fm-new-dob-note"/);
  assert.match(family, /newShows\("preferred"\) \? "fm-new-preferred-error fm-new-preferred-note" : "fm-new-preferred-note"/);
  assert.match(family, /id="fm-new-dob-note"/);
  assert.match(family, /id="fm-new-preferred-note"/);
  assert.match(family, /RELATIONSHIPS\.map\(\(r\) => <option key=\{r\} value=\{r\}>\{relationshipLabel\(r\)\}/);
  assert.match(family, /\["dob", !dob\], \["sex", sexField && !sex\], \["preferred", !preferred\.trim\(\)\]/);
  assert.match(family, /If they have no other name, use their full name again\./);
  assert.match(family, /r === "spouse" \? "Spouse or partner"/);
  assert.match(family, /id="fm-new-dob" type="date"[^\n]*? required /);
  assert.match(family, /id="fm-new-preferred"[^\n]*? required /);
  assert.match(family, /\{family\.length \? <h3>Add a family member<\/h3> : loaded && listKnown \? <p className="field-note" data-testid="family-start-note">Start with yourself\. One person is enough to upload your first document, and you can add the rest of your family any time\.<\/p> : null\}/);
  // The note needs a real list: set from Array.isArray, after the fetch, and never before it (TE, #640).
  assert.match(family, /setListKnown\(Array\.isArray\(data\.family\)\);\s*setLoaded\(true\);/);
  assert.equal((family.match(/setLoaded\(true\)/g) ?? []).length, 1);
  assert.equal((family.match(/setListKnown\(/g) ?? []).length, 1);
  assert.ok(family.indexOf("await fetch(\"/api/family\")") < family.indexOf("setListKnown("), "the list flag is set only after the fetch");
  assert.ok(family.indexOf('<section className="profile-add-panel"') > 0 && family.indexOf('<section className="profile-add-panel"') < family.indexOf("family-start-note"), "the note sits in the owner's add panel, not the owner-only branch");
  assert.match(page, /waitedMinutes >= LONG_WAIT_MINUTES \? "Still working\./);
  assert.match(page, /\}, \[activeCount, pollingPaused\]\);/);
  assert.match(page, /if \(polling && !Array\.isArray\(p\?\.policies\)\) return false;/);
  assert.match(page, /document\.hidden \? Promise\.resolve\(true\) : refresh\(true\)\.catch\(\(\) => false\)/);
  assert.match(page, /refresh\(true\)\.catch\(\(\) => false\); \}\}>Check again/);
  assert.match(page, /pollingPaused && \[\.\.\.now\]\.some\(\(id\) => !lastActive\.current\.has\(id\)\)\) \{ pollingSince\.current = Date\.now\(\); setPollingPaused\(false\)/);
  assert.match(page, /pollDelay\(elapsed, misses\)/);
  assert.equal((page.match(/readingWaitCopy\(policy\.processing_stage, waitedMinutes\)/g) ?? []).length, 3);
});

console.log(`V1.1 customer-screen regressions: ${passed} passed${process.exitCode ? ", some FAILED" : ""}.`);
