/**
 * Routing regressions: a request for the catalogue (the documents on file, the policies held) is answered as one --
 * in a fresh chat and in the middle of a claim -- and a genuine claim statement or claim question is never read as
 * one (lib/chat/intent-catalogue.ts, routed in lib/chat/workflow.ts).
 *
 * Part 1 is the recognizer alone (no database). Part 2 sends each message through the real chat route
 * (app/api/chat/route.ts) for a household read through real ingestion (scripts/r7-robust/household.ts, PGlite,
 * deterministic model, no network): once as the first message of a chat, and once after a claim conversation
 * (a flood, an injury, a hospital stay) left the chat in a claim.
 *
 *   node --import tsx scripts/routing-regressions.ts
 */
process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
process.env.E2E_RUN_ID = "routing";
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.DEV_AUTH_ENABLED = "1";
process.env.MODEL_PRESET = process.env.MODEL_PRESET || "gemini";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-not-used";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "ci";
delete process.env.PINECONE_API_KEY; delete process.env.SUPABASE_URL;

/** Catalogue requests, in different words: none of these is in the r7 battery. */
const CATALOGUE_DOCUMENTS = [
  "what documents have I uploaded",
  "show me my files",
  "list my docs",
  "can you show me all our uploads",
  "which documents are on file",
  "pls list the docs you have",
  "how many files did we upload",
  "tell me about my documents",
];
const CATALOGUE_POLICIES = [
  "which policies do you have for us",
  "what plans do we have",
  "i want to see our policies",
];
/** Genuine claim statements and claim questions: never a catalogue request. */
const CLAIM_STATEMENTS = [
  "house flooded, I want to claim home insurance",
  "Rachel got hurt in the flood, hospital 2 days",
  "my documents got damaged in the flood",
  "I lost my files when my laptop was stolen",
  "what documents do I need for the claim",
  "show me the documents I need to claim",
  "which policies can I claim from",
  "which of my policies pays for a broken arm",
  "do my policies cover flood",
  "my wife was admitted to hospital yesterday, which plans should we use",
];
/** Not catalogue requests to the recognizer. (Through the chat these two are answered by the upload-question path in
 * lib/chat/document-questions.ts with the uploads on file -- that path, not this routing, decides them -- so they are
 * checked here only.) */
const RECOGNIZER_ONLY = ["list the documents the insurer needs", "I uploaded HomeGuard before"];
/** Questions about one document or one policy: not the catalogue either. */
const NOT_CATALOGUE = [...RECOGNIZER_ONLY, "what's my policy number", "which plan is for Rachel", "should I buy home insurance again", "ok", "which documents couldn't be read", "show me my EquaLife documents"];

const failures: string[] = [];
const fail = (s: string) => { failures.push(s); };

async function pure() {
  const { catalogueRequest } = await import("@/lib/chat/intent-catalogue");
  const names = ["Ong Kah Seng", "Rachel", "Chua Pei Shan"];
  for (const m of CATALOGUE_DOCUMENTS) { const r = catalogueRequest(m, names); if (r?.noun !== "documents") fail(`recognizer: «${m}» should be a request for the documents on file, got ${JSON.stringify(r)}`); }
  for (const m of CATALOGUE_POLICIES) { const r = catalogueRequest(m, names); if (r?.noun !== "policies") fail(`recognizer: «${m}» should be a request for the policies held, got ${JSON.stringify(r)}`); }
  for (const m of [...CLAIM_STATEMENTS, ...NOT_CATALOGUE]) { const r = catalogueRequest(m, names); if (r) fail(`recognizer: «${m}» is not a catalogue request, got ${JSON.stringify(r)}`); }
  // Whose: the possessive, "for us", a family member's name, or the asker.
  const scope = (m: string) => catalogueRequest(m, names)?.canonical;
  const want: [string, string][] = [["show me my files", "list my documents"], ["which policies do you have for us", "list our policies"], ["can you show me Rachel's documents", "list Rachel’s documents"],
    ["show documents for Rachel", "list Rachel’s documents"], ["what documents have I uploaded", "list my documents"], ["pls list all the docs", "list all the documents"]];
  for (const [m, c] of want) if (scope(m) !== c) fail(`recognizer: «${m}» should read as «${c}», got «${scope(m)}»`);
  console.log(`recognizer: ${CATALOGUE_DOCUMENTS.length + CATALOGUE_POLICIES.length} catalogue requests, ${CLAIM_STATEMENTS.length + NOT_CATALOGUE.length} others`);
}

/** A catalogue answer: the uploads listed, or the policies held per person. */
const LISTS_UPLOADS = /\buploads? (?:are|is) on file\b/;
const LISTS_POLICIES = /\b(?:has|have) \d+ polic(?:y|ies) on file\b|\bcovered by \d+ polic(?:y|ies) on file\b|\bpolicies on file\b/;

async function endToEnd() {
  const { buildHouseholds } = await import("./r7-robust/household");
  const B = await import("./r7-robust/battery");
  const { detect, visibleFields, moneyIn } = await import("./r7-robust/detect");
  const built = await buildHouseholds(["H3-ong"] as never);
  const hh = built.households[0];
  const base = { kind: "conversation", title: "routing", asker: hh.manifest.account_owner, scope: "household", tags: [] };
  const turn = (n: number, message: string) => ({ turn: n, message, expected_behaviour: "answer", must_include: [], forbidden: [] });
  // A chat left in a claim: the household reports a flood and an injury, then asks something else.
  const claimSoFar = ["house flooded, I want to claim home insurance", "Rachel got hurt in the flood, hospital 2 days"];
  const all = [...CATALOGUE_DOCUMENTS, ...CATALOGUE_POLICIES, ...CLAIM_STATEMENTS];
  const convs = all.flatMap((m, i) => [{ ...base, id: "FRESH-" + i, turns: [turn(1, m)] }, { ...base, id: "CLAIM-" + i, turns: [...claimSoFar.map((x, k) => turn(k + 1, x)), turn(claimSoFar.length + 1, m)] }]);
  const rows = await B.runBattery({ hh, others: built.households.filter((x) => x !== hh), db: built.db as never, detect, visibleFields, moneyIn, noSingles: true, conversationsOverride: convs as never });
  let checked = 0;
  for (const r of rows) {
    const mid = r.id.startsWith("CLAIM-");
    if (mid && r.turn !== claimSoFar.length + 1) continue;
    const m = r.message, where = (mid ? "mid-claim" : "fresh chat") + " «" + m + "»";
    checked++;
    if (r.status !== 200) { fail(`${where}: HTTP ${r.status}`); continue; }
    const listsUploads = LISTS_UPLOADS.test(r.text), listsPolicies = LISTS_POLICIES.test(r.text);
    if (CATALOGUE_DOCUMENTS.includes(m)) {
      if (!listsUploads) fail(`${where}: should list the uploads on file, got [${r.behaviour}] ${r.summary.slice(0, 160)}`);
      // Every policy document of the household is named (the endorsement and the deleted home policy are not cover).
      for (const product of ["EquaLife", "TwinCare", "SecureCare"]) if (listsUploads && !r.text.includes(product)) fail(`${where}: the list leaves out ${product}`);
      if (r.text.includes("HomeGuard")) fail(`${where}: names the deleted home policy`);
    } else if (CATALOGUE_POLICIES.includes(m)) {
      if (!listsUploads && !listsPolicies) fail(`${where}: should list the policies held, got [${r.behaviour}] ${r.summary.slice(0, 160)}`);
      if (!r.text.includes("TwinCare")) fail(`${where}: the list leaves out TwinCare`);
    } else {
      if (listsUploads) fail(`${where}: a claim statement was answered with the list of uploads: ${r.summary.slice(0, 160)}`);
      if (listsPolicies && !/\b(?:claim|cover|pay)/i.test(r.text)) fail(`${where}: a claim statement was answered with the list of policies only: ${r.summary.slice(0, 160)}`);
    }
    if (r.behaviour === "claim-question" && (CATALOGUE_DOCUMENTS.includes(m) || CATALOGUE_POLICIES.includes(m))) fail(`${where}: a catalogue request was answered as a claim`);
  }
  console.log(`chat route: ${checked} messages checked (${all.length} fresh, ${all.length} mid-claim)`);
}

async function main() {
  const out = console.log.bind(console);
  await pure();
  {
    globalThis.fetch = (async (input: RequestInfo | URL) => { throw new Error("network disabled: " + String(input)); }) as typeof fetch;
    console.info = () => undefined; console.debug = () => undefined; console.warn = () => undefined; console.error = () => undefined;
    console.log = (...args: unknown[]) => { if (typeof args[0] === "string" && /^(?:recognizer|chat route):/.test(args[0])) out(...args); };
    await endToEnd();
  }
  if (failures.length) { for (const f of failures) out("FAIL " + f); out(`\n${failures.length} routing failures`); process.exit(1); }
  out("routing regressions: ok");
  process.exit(0);
}
main().catch((e) => { process.stderr.write(String((e as Error)?.stack ?? e) + "\n"); process.exit(1); });
