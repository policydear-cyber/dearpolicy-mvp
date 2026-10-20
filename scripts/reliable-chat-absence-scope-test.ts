/**
 * fx-live-1 K6a / K6b: the decision behind a "not found in these documents" statement (lib/rag2/loop/absence-scope.ts), over small
 * synthetic documents. Pure: no database, no model. The end-to-end behaviour (the real route, saved = reopened) is in
 * scripts/reliable-chat-fx-repairs-test.ts.
 *   node --import tsx scripts/reliable-chat-absence-scope-test.ts
 */
import { cleanTopic, decideNotFound, documentLabels, scanScope, termPattern, type AbsenceSource } from "@/lib/rag2/loop/absence-scope";
import type { DocRow } from "@/lib/rag2/store";

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? "\n     " + detail.split("\n").slice(0, 12).join("\n     ") : ""}`); };

const doc = (id: string, productName: string, extra: Partial<DocRow> = {}): DocRow => ({ id, ownerId: "m-dan", insurer: "Aldermoor Life", productName, policyNumber: "P1", groupPolicyNumber: null, policyType: null, documentRole: "certificate", personalCoverageConfirmed: false, status: "ready", fileHash: "sha:" + id, effectiveDate: null, expiryDate: null, documentDate: null, createdAt: null, pageCount: 1, rev: "1@t", ...extra });
const CERT = doc("c1", "Scheme X Group Insurance Scheme", { personalCoverageConfirmed: true });
const SUM = doc("s1", "Scheme X Group Insurance", { documentRole: "product_summary" });
const BEN = doc("b1", "Scheme X Group Insurance", { documentRole: "certificate", pageCount: 2 });
// Every unit document here is synthetic and stored in full: its pageCount is the number of pages the test stores, numbered from 1
// (PR #57 follow-up C1.1: an absence is only said over a document read in full; partial documents are S12/S13).
const PAGES = [
  { policyId: "c1", page: 1, text: "Certificate of Insurance\nGroup Term Life S$1,000,000\nGroup Living Care S$350,000\nGroup Personal Accident S$600,000" },
  { policyId: "s1", page: 1, text: "Group Personal Accident\nCoverage for fracture due to accident.\nBenefits of a personal accident policy will only be payable upon an accident occurring." },
  { policyId: "b1", page: 1, text: "Group Term Life: death or Terminal Illness 100% of the sum insured" },
  { policyId: "b1", page: 2, text: "Accidental Hospital Recuperation Benefit\nwithin 30 days following bodily injury as a result of an Accident, confined as a resident patient" },
];
const LINKS_BOTH = [{ policyId: "c1", memberId: "m-gr" }, { policyId: "c1", memberId: "m-dan" }, { policyId: "s1", memberId: "m-gr" }, { policyId: "s1", memberId: "m-dan" }, { policyId: "b1", memberId: "m-gr" }, { policyId: "b1", memberId: "m-dan" }];
const src = (over: Partial<AbsenceSource> = {}): AbsenceSource => ({ docs: [CERT, SUM, BEN], links: LINKS_BOTH, pages: PAGES, ...over });
const ctx: { subjectId: string | null; who: string | null; names: string[] } = { subjectId: "m-gr", who: "Grace", names: ["Grace", "Daniel", "Lee Wei Ming"] };
const run = (s: Record<string, unknown>, a = src(), c = ctx) => decideNotFound({ kind: "not_found", text: "-", ...s }, a, c);

check("S12 (C1.1) a document with a page never stored (pageCount 3, two pages stored) is not read in full: no absence is said", !run({ claim: "benefit_not_found", topic: "dental treatment", terms: ["dental"] }, src({ docs: [CERT, SUM, { ...BEN, pageCount: 3 }] })).ok);
check("S13 (C1.1) a document with a stored page that has no text is not read in full: no absence is said", !run({ claim: "benefit_not_found", topic: "dental treatment", terms: ["dental"] }, src({ pages: PAGES.map((p) => (p.policyId === "b1" && p.page === 2 ? { ...p, text: "  " } : p)) })).ok);

// ------------------------------------------------------------------------------------------------ the word test
check("W1 'dental' is NOT found inside 'accidental' (whole words only)", !termPattern("dental").test("Accidental Death Benefit") && termPattern("dental").test("Dental treatment") && termPattern("dental").test("dentally"));
check("W2 inflections are found: 'fractures' finds 'fractured'; 'hospitalisation' finds 'hospital'", termPattern("fractures").test("a fractured leg") && termPattern("hospitalisation").test("Hospital Recuperation"));
check("W3 a phrase is found across a line break or hyphen: 'critical illness'", termPattern("critical illness").test("Critical-Illness benefit") && termPattern("critical illness").test("critical  illness"));
check("W4 scanScope reports the document, page and line of every hit", (() => { const h = scanScope([{ policyId: "x", name: "X", pages: [{ page: 4, text: "a\nDental treatment due to accident is limited to $500\nb" }] }], ["dental"]); return h.length === 1 && h[0].page === 4 && /Dental treatment/.test(h[0].line); })());

// ------------------------------------------------------------------------------------------------ K6b: the household's documents never print dental
const k6b = run({ claim: "benefit_not_found", topic: "dental treatment", terms: ["dental", "dentist", "tooth"] });
check("A1 (K6b) a benefit the scope never prints is kept: the scope is the person's three documents, 'accidental' is not 'dental'", k6b.ok && k6b.check.documents.length === 3 && k6b.check.scope === "subject", JSON.stringify(k6b));
check("A2 (K6b) the sentence says the DOCUMENTS do not describe it, and that this is not 'no cover'", k6b.ok && /^Grace’s documents \(.*\) do not describe a benefit for dental treatment\./.test(k6b.text) && /not the same as saying there is no such cover/.test(k6b.text) && !/\b(?:excluded|is not covered|no dental cover)\b/i.test(k6b.text.replace(/not the same as saying there is no such cover/, "")), k6b.ok ? k6b.text : "");
check("A3 the documents checked are named, told apart when they share a product name", k6b.ok && /Scheme X Group Insurance Scheme/.test(k6b.text) && /product summary/.test(k6b.text) && /certificate summary/.test(k6b.text), k6b.ok ? k6b.text : "");
check("A4 the check carries the scope: each document's id, name, file hash and version", k6b.ok && k6b.check.documents.every((d) => d.policyId && d.name && d.fileHash?.startsWith("sha:") && d.rev === "1@t") && k6b.check.terms.includes("dental"), k6b.ok ? JSON.stringify(k6b.check) : "");

// ------------------------------------------------------------------------------------------------ false absences are refused
const falseDental = run({ claim: "benefit_not_found", topic: "dental treatment", terms: ["dental"] }, src({ pages: [...PAGES, { policyId: "s1", page: 20, text: "Dental Treatment due to Accident\nWe will pay up to $500 for dental treatment" }] }));
check("F1 a false absence is refused when a scoped document prints the topic, naming the page and the line", !falseDental.ok && /Product Scheme|Scheme X Group Insurance \(product summary\) page 20 prints “Dental Treatment due to Accident”/.test(falseDental.problem) , !falseDental.ok ? falseDental.problem : "kept");
const illness = run({ claim: "benefit_not_found", topic: "illness hospital benefit", terms: ["illness", "sickness"] });
check("F2 'no illness benefit' is refused while Term Life prints 'Terminal Illness'", !illness.ok && /Terminal Illness/.test(illness.problem), !illness.ok ? illness.problem : "kept");
const fromTopic = run({ claim: "benefit_not_found", topic: "hospital recuperation", terms: ["inpatient"] });
check("F3 the topic's own distinctive words are searched even when the model's terms miss them", !fromTopic.ok && /Accidental Hospital Recuperation/.test(fromTopic.problem), !fromTopic.ok ? fromTopic.problem : "kept");
const verdict = run({ claim: "benefit_not_found", topic: "dental cover is excluded", terms: ["dental"] });
check("F4 a topic that carries a verdict ('is excluded') is refused: the statement says what documents print, not what cover exists", !verdict.ok && /never a verdict/.test(verdict.problem), !verdict.ok ? verdict.problem : "kept");
const noCover = run({ claim: "benefit_not_found", topic: "no dental cover", terms: ["dental"] });
check("F5 'no dental cover' as a topic is refused: it names the absence, not the thing looked for", !noCover.ok && /not its absence/.test(noCover.problem), !noCover.ok ? noCover.problem : "kept");
const figure = run({ claim: "benefit_not_found", topic: "dental up to $500", terms: ["dental"] });
check("F6 a figure in the topic is refused", !figure.ok && /amount or a number/.test(figure.problem), !figure.ok ? figure.problem : "kept");
const generic = run({ claim: "benefit_not_found", topic: "any benefit", terms: [] });
check("F7 no specific word to search for: refused with what to supply", !generic.ok && /terms is required/.test(generic.problem), !generic.ok ? generic.problem : "kept");
const unstored = run({ claim: "benefit_not_found", topic: "dental treatment", terms: ["dental"] }, src({ pages: PAGES.filter((p) => p.policyId !== "b1") }));
check("F8 a scoped document whose text is not stored: nothing can be said to be absent from it", !unstored.ok && /not stored/.test(unstored.problem), !unstored.ok ? unstored.problem : "kept");

// ------------------------------------------------------------------------------------------------ scope
const danOnly = src({ docs: [CERT, SUM, BEN, doc("d9", "Daniel Dental Plan")], links: [...LINKS_BOTH, { policyId: "d9", memberId: "m-dan" }], pages: [...PAGES, { policyId: "d9", page: 1, text: "Dental Plan: dental treatment up to $500" }] });
const forGrace = run({ claim: "benefit_not_found", topic: "dental treatment", terms: ["dental"] }, danOnly);
check("S1 a document linked only to another member is not in this person's scope: Daniel's dental plan does not make Grace's statement false", forGrace.ok && forGrace.check.documents.length === 3, !forGrace.ok ? forGrace.problem : "");
const forDan = run({ claim: "benefit_not_found", topic: "dental treatment", terms: ["dental"], subject_id: "m-dan" }, danOnly);
check("S2 ... and it does make Daniel's false", !forDan.ok && /Daniel Dental Plan/.test(forDan.problem), !forDan.ok ? forDan.problem : "kept");
const orphan = src({ docs: [CERT, SUM, BEN, doc("o9", "Unlinked Booklet")], pages: [...PAGES, { policyId: "o9", page: 1, text: "Dental benefit: up to $200" }] });
const withOrphan = run({ claim: "benefit_not_found", topic: "dental treatment", terms: ["dental"] }, orphan);
check("S3 a document linked to nobody could belong to anyone: it is in every person's scope", !withOrphan.ok && /Unlinked Booklet/.test(withOrphan.problem), !withOrphan.ok ? withOrphan.problem : "kept");
const nobody = run({ claim: "benefit_not_found", topic: "dental treatment", terms: ["dental"], subject_id: "" }, src(), { ...ctx, subjectId: null, who: null });
check("S4 no person: the whole library is the scope, said as 'Your uploaded documents'", nobody.ok && nobody.check.scope === "library" && /^Your uploaded documents \(/.test(nobody.text), nobody.ok ? nobody.text : nobody.problem);
const named = run({ claim: "document_silent", topic: "what Group Living Care pays for cancer", terms: ["cancer", "carcinoma", "tumour"], scope_policy_ids: ["c1"] });
check("S5 (K6a) a named document that does not state the topic: kept, said of that document alone, with 'not excluded / not covered' kept out", named.ok && named.check.scope === "named" && named.check.documents.length === 1 && /^The Scheme X Group Insurance Scheme does not state what Group Living Care pays for cancer\./.test(named.text) && /not the same as saying it is excluded or not covered/.test(named.text), named.ok ? named.text : named.problem);
check("S6 (K6a) the product's own words ('Group Living Care') are not searched for: only what it is asked to say about (cancer)", named.ok && !named.check.terms.some((t) => /living|care|group/.test(t)), named.ok ? JSON.stringify(named.check.terms) : "");
check("S6b (K6a) terms that do not include the topic's own word are refused: the word asked about is always searched", (() => { const r = run({ claim: "document_silent", topic: "what Group Living Care pays for cancer", terms: ["carcinoma", "tumour"], scope_policy_ids: ["c1"] }); return !r.ok && /must include a word of the topic itself/.test(r.problem); })());
const named2 = run({ claim: "document_silent", topic: "Group Personal Accident", terms: ["personal accident"], scope_policy_ids: ["c1"] });
check("S7 a named document that DOES print the topic: refused", !named2.ok && /Group Personal Accident/.test(named2.problem), !named2.ok ? named2.problem : "kept");
check("S8 document_silent without scope_policy_ids: refused", (() => { const r = run({ claim: "document_silent", topic: "cancer", terms: ["cancer"] }); return !r.ok && /needs scope_policy_ids/.test(r.problem); })());
check("S9 a scope id that is not one of the household's documents: refused", (() => { const r = run({ claim: "document_silent", topic: "cancer", terms: ["cancer"], scope_policy_ids: ["zzz"] }); return !r.ok && /not one of them/.test(r.problem); })());
check("S10 an unknown claim is refused", (() => { const r = run({ claim: "no_cover", topic: "dental", terms: ["dental"] }); return !r.ok && /claim must be/.test(r.problem); })());
check("S11 many documents are summarised in the sentence but all are recorded in the check", (() => { const many = Array.from({ length: 7 }, (_, i) => doc("m" + i, "Plan " + i)); const r = run({ claim: "benefit_not_found", topic: "dental treatment", terms: ["dental"] }, src({ docs: many, links: [], pages: many.map((d) => ({ policyId: d.id, page: 1, text: "Plan text" })) }), { ...ctx, subjectId: null, who: null }); return r.ok && r.check.documents.length === 7 && /and 4 other documents/.test(r.text); })());

check("T1 cleanTopic strips a leading article and refuses sentences", (() => { const a = cleanTopic("a dental treatment"), b = cleanTopic("The documents do not mention dental; it is excluded?"); return a.topic === "dental treatment" && b.topic === null; })());
check("T2 documentLabels: unique names stay as they are; shared names are told apart by role", (() => { const m = documentLabels([CERT, SUM, BEN, doc("x", "Other Plan")]); return m.get("x") === "Other Plan" && m.get("s1") === "Scheme X Group Insurance (product summary)" && m.get("b1") === "Scheme X Group Insurance (certificate summary)" && m.get("c1") === "Scheme X Group Insurance Scheme"; })());

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
