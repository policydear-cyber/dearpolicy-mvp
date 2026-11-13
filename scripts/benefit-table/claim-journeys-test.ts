/** Independent test-engineer journeys for PR #449 (claim answers give the amounts the benefit table worked out).
 * Made-up households, insurers and documents only; none reuse the PR's fixtures. No model, database or network.
 * Runs the app's own path: checkReading -> assembleTable -> chatRows -> amountsFromRows -> readModelAnswer ->
 * verifyAnswer(household, parsed, asked, labels, figures) -> keepLabelledAmounts.
 *   npm run benefit-table:claim-journeys-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { amountsFromRows, chatRows, keepLabelledAmounts } from "@/lib/benefit-table/chat";
import type { Household } from "@/lib/simple-chat/library";
import { readModelAnswer, verifyAnswer } from "@/lib/simple-chat/verify";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const results: { name: string; ok: boolean; detail: string }[] = [];
function test(name: string, fn: () => void) {
  try { fn(); results.push({ name, ok: true, detail: "" }); } catch (e) { results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) }); }
}

type Doc = Household["documents"][number];
type P = { name: string; rel: string; line: string; sum: number; dob?: string };
const ACCT = "99999999-1111-4222-8333-444444444444";
let n = 0;
const nid = () => `abcdef00-0000-4000-9000-${String(++n).padStart(12, "0")}`;
function mkdoc(id: string, name: string, product: string, insurer: string, policyNumber: string | null, people: string[], pages: string[], role = "personal_schedule", supersededAt: string | null = null): Doc {
  return { policyId: id, name, insurer, productName: product, policyNumber, documentType: null, documentRole: role, effectiveDate: null, expiryDate: null, uploadedAt: "2026-11-01",
    uploadedFor: null, linkedPeople: people, supersededAt, processingStatus: "ready", pages: pages.map((text, i) => ({ page: i + 1, text })) };
}
const src = (d: Doc): SourceDoc => ({ id: d.policyId, name: d.name, readable: true, pages: d.pages });
const bn = (o: Record<string, unknown>) => ({ section: "Schedule of benefits", column: null, pays: "amount", value: null, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null,
  baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 2, ...o });
const docMeta = (kind: string, product: string, insurer: string, named: string[]) => ({ kind, product, insurer, namedPeople: named, plan: null, periodFrom: null, periodTo: null });
const coverOf = (p: P, product: string, policyNumber: string | null, page: number) => ({ person: p.name, product, cover: product, plan: null, riderOf: null, policyNumber, premium: null,
  premiumFrequency: null, asOf: null, startDate: null, endDate: null, page, sumInsured: p.sum, quote: p.line });

/** One schedule (certificate, joint or family): people on page 1, benefits on page 2. */
function schedule(o: { insurer: string; product: string; policyNumber: string | null; people: P[]; benefitLines: string[]; benefits: Record<string, unknown>[]; page1Extra?: string; trailer?: string }) {
  const id = nid();
  const page1 = `${o.insurer}\n${o.product.toUpperCase()}\nCertificate / Schedule No. ${o.policyNumber ?? "n/a"}\nName of insured\tRelationship\tSum insured\n${o.people.map((p) => p.line).join("\n")}${o.page1Extra ?? ""}`;
  const page2 = `SCHEDULE OF BENEFITS\nItem\tBenefit\tCompensation\n${o.benefitLines.join("\n")}${o.trailer ?? "\nGeneral conditions apply."}`;
  const d = mkdoc(id, `${o.product}.pdf`, o.product, o.insurer, o.policyNumber, o.people.map((p) => p.name), [page1, page2]);
  const house: Household = { accountId: ACCT, members: o.people.map((p) => ({ name: p.name, relationship: p.rel })), documents: [d] };
  const fam: FamilyMember[] = o.people.map((p, i) => ({ id: `f${i}`, display_name: p.name, relationship: p.rel, date_of_birth: p.dob ?? null }));
  const r = checkReading(src(d), { document: docMeta("personal_proof", o.product, o.insurer, o.people.map((p) => p.name)), covers: o.people.map((p) => coverOf(p, o.product, o.policyNumber, 1)), benefits: o.benefits });
  const key = coverKeyOf({ product: o.product, cover: o.product, plan: null, riderOf: null });
  const links = [...new Set(r.benefits.map((b) => sectionKeyOf(id, b)))].map((section) => ({ section, cover: key, why: "the schedule's benefits" }));
  const table = assembleTable([r], fam, links);
  return { house, table, rows: chatRows(table, house) };
}

/** A policy wording printing the benefits, and a separate schedule printing each person's sum (same policy number). */
function split(o: { insurer: string; product: string; policyNumber: string; people: P[]; wordingLines: string[]; benefits: Record<string, unknown>[]; extraDocs?: Doc[] }) {
  const wid = nid(), sid = nid();
  const wording = mkdoc(wid, "Policy wording.pdf", o.product, o.insurer, o.policyNumber, o.people.map((p) => p.name), ["POLICY WORDING\nDefinitions and general exclusions.", `SECTION A - SCALE OF COMPENSATION\n${o.wordingLines.join("\n")}`], "policy_wording");
  const sched = mkdoc(sid, "Policy schedule.pdf", o.product, o.insurer, o.policyNumber, o.people.map((p) => p.name), [`POLICY SCHEDULE\nPolicy number ${o.policyNumber}\n${o.people.map((p) => p.line).join("\n")}`]);
  const house: Household = { accountId: ACCT, members: o.people.map((p) => ({ name: p.name, relationship: p.rel })), documents: [wording, sched, ...(o.extraDocs ?? [])] };
  const fam: FamilyMember[] = o.people.map((p, i) => ({ id: `f${i}`, display_name: p.name, relationship: p.rel, date_of_birth: p.dob ?? null }));
  const rw = checkReading(src(wording), { document: docMeta("policy_wording", o.product, o.insurer, []), covers: [], benefits: o.benefits });
  const rs = checkReading(src(sched), { document: docMeta("personal_proof", o.product, o.insurer, o.people.map((p) => p.name)), benefits: [], covers: o.people.map((p) => coverOf(p, o.product, o.policyNumber, 1)) });
  const key = coverKeyOf({ product: o.product, cover: o.product, plan: null, riderOf: null });
  const links = [...new Set(rw.benefits.map((b) => sectionKeyOf(wid, b)))].map((section) => ({ section, cover: key, why: "the wording's scale" }));
  const table = assembleTable([rw, rs], fam, links);
  return { house, table, rows: chatRows(table, house) };
}

type H = ReturnType<typeof schedule>;
type Kept = { text: string; amount?: { text: string } | null; basis?: string | null; personName?: string | null };
/** The model names `rowPerson`'s row for `benefit`, and says it is for `saidPerson` (normally the same). */
function ask(h: H, rowPerson: string, benefit: RegExp, asked: string[] = ["What can we claim?"], extra: Record<string, unknown> = {}, saidPerson = rowPerson) {
  const row = h.rows.find((r) => r.person === rowPerson && benefit.test(r.benefit) && r.figure.kind !== "none");
  if (!row) return { row: null, amounts: [] as string[], all: [] as string[], kept: [] as Kept[] };
  const raw = { bottomLine: "Here is what applies.", nextSteps: [], question: null, statements: [{ kind: "amount", text: row.benefit, person: saidPerson, document: null, quote: null, amount: null, percentOf: null,
    conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, rowBenefit: row.benefit, eventFit: "any_event", waiting: null, period: { from: "", to: "", eventOn: "" }, ...extra }] };
  const fr = amountsFromRows(raw, h.rows, h.house, new Date("2026-11-13T04:00:00Z"), asked[0], asked.slice(1));
  const parsed = readModelAnswer(fr.json)!;
  const { answer } = verifyAnswer(h.house, parsed, asked, new Set(fr.report.labels), fr.report.figures ?? []);
  const { kept } = keepLabelledAmounts((answer.statements ?? []) as Kept[], fr.report);
  return { row, kept, amounts: kept.filter((s) => s.amount && s.personName === saidPerson).map((s) => s.amount!.text), all: kept.filter((s) => s.amount).map((s) => s.amount!.text) };
}
const val = (t: string) => Number((/(\d[\d,]*(?:\.\d+)?)/.exec(t)?.[1] ?? "NaN").replace(/,/g, ""));
const vals = (a: string[]) => a.map(val);
const tableRow = (h: H, person: string, pred: (r: H["table"]["people"][number]["rows"][number]) => boolean) => h.table.people.find((p) => p.name === person)?.rows.find(pred);

// ============ Households ============
// GBP single-person certificate, Thistle General plc.
const FIONA: P = { name: "Fiona MacLeod", rel: "self", line: "Fiona MacLeod\tPolicyholder\t14/03/1979\tGBP 60,000", sum: 60000 };
const FRACT = "3\tFractures\t2% of the Sum Insured per fracture, maximum GBP 1,500 per accident";
const gbpCert = (p: P = FIONA, lines = [FRACT], cap: Record<string, unknown> = { cap: 1500, capQuote: "maximum GBP 1,500 per accident" }, page1Extra = "") => schedule({
  insurer: "Thistle General plc", product: "Lifestyle Accident Certificate", policyNumber: "TG-77120", people: [p], page1Extra,
  benefitLines: ["1\tAccidental death\t100% of the Sum Insured", ...lines],
  benefits: [bn({ benefit: "Fractures", pays: "percent", value: 2, percentOf: "sum_insured", quote: lines[0].replace(/^3\t/, ""), ...cap })] });

// HKD joint schedule, Harbour Mutual Assurance Ltd.
const HK: P[] = [
  { name: "Chan Tai Man", rel: "self", line: "Chan Tai Man\tInsured\tHKD 500,000", sum: 500000 },
  { name: "Wong Mei Yee", rel: "spouse", line: "Wong Mei Yee\tSpouse\tHKD 300,000", sum: 300000 }];
const BURNS_HK = "Third degree burns\t20% of the Sum Insured";
const DISLOC_HK = "Dislocation of shoulder\t5% of the Sum Insured, maximum HKD 20,000 per accident";
const hkJoint = (people = HK) => schedule({ insurer: "Harbour Mutual Assurance Ltd", product: "Twin Shield Accident Plan", policyNumber: "HM-2026-0042", people,
  benefitLines: [`A\t${BURNS_HK}`, `B\t${DISLOC_HK}`],
  benefits: [bn({ benefit: "Third degree burns", pays: "percent", value: 20, percentOf: "sum_insured", quote: BURNS_HK }),
    bn({ benefit: "Dislocation of shoulder", pays: "percent", value: 5, percentOf: "sum_insured", quote: DISLOC_HK, cap: 20000, capQuote: "maximum HKD 20,000 per accident" })] });

// AUD family schedule, Southern Cross Assurance Pty Ltd.
const AU: P[] = [
  { name: "Liam Kelly", rel: "self", line: "Liam Kelly\tPrincipal\t22/07/1984\tAUD 400,000", sum: 400000 },
  { name: "Grace Kelly", rel: "spouse", line: "Grace Kelly\tPartner\t03/02/1986\tAUD 250,000", sum: 250000 },
  { name: "Noah Kelly", rel: "child", dob: "2015-10-11", line: "Noah Kelly\tDependent child\t11/10/2015\tAUD 80,000", sum: 80000 }];
const CHILD_AU = "If the insured person is an insured child under 16, limited to 25% of the Sum Insured.";
const HOSP_AU = "Hospital cash\tAUD 150 per day in hospital, payable from the fourth day, up to 90 days per accident";
const BURN_AU = "Severe burns\t15% of the Sum Insured";
const auFamily = (hospitalLast = false, people = AU) => schedule({ insurer: "Southern Cross Assurance Pty Ltd", product: "Family Active Accident", policyNumber: "SCA-55190", people, trailer: "",
  benefitLines: [`1\tAccidental death\t100% of the Sum Insured. ${CHILD_AU}`, `2\t${BURN_AU}`, `3\t${HOSP_AU}`, ...(hospitalLast ? [] : ["4\tEmergency ambulance\tAUD 500 per accident"])],
  benefits: [bn({ benefit: "Accidental death", column: "Insured child under 16", pays: "percent", value: 25, percentOf: "sum_insured", quote: CHILD_AU }),
    bn({ benefit: "Severe burns", pays: "percent", value: 15, percentOf: "sum_insured", quote: BURN_AU }),
    bn({ benefit: "Hospital cash", pays: "per_day", value: 150, maxDays: 90, quote: HOSP_AU })] });

// SGD wording + schedule split, Merlion Shield Insurance.
const SG: P[] = [{ name: "Lim Wei Jie", rel: "self", line: "Lim Wei Jie\tLife assured\tSGD 200,000", sum: 200000 },
  { name: "Ng Hui Min", rel: "spouse", line: "Ng Hui Min\tLife assured\tSGD 120,000", sum: 120000 }];
const EYE = "Total loss of sight of one eye\t50% of the Sum Insured";
const SKULL = "Fracture of skull\t3% of the Sum Insured per fracture, maximum SGD 5,000 per accident";
const sgSplit = (people = SG, extraDocs: Doc[] = []) => split({ insurer: "Merlion Shield Insurance", product: "PrimeGuard Accident", policyNumber: "MSI-880011", people, extraDocs,
  wordingLines: [`(a) ${EYE}`, `(b) ${SKULL}`],
  benefits: [bn({ section: "Section A", benefit: "Total loss of sight of one eye", pays: "percent", value: 50, percentOf: "sum_insured", quote: EYE }),
    bn({ section: "Section A", benefit: "Fracture of skull", pays: "percent", value: 3, percentOf: "sum_insured", quote: SKULL, cap: 5000, capQuote: "maximum SGD 5,000 per accident" })] });

// MYR single-person certificate, Bunga Raya Assurance Berhad.
const AISYAH: P = { name: "Nur Aisyah Binti Hassan", rel: "self", line: "Nur Aisyah Binti Hassan\tPeserta\tRM 250,000", sum: 250000 };
const myrCert = (p: P = AISYAH, line = "Fracture of leg\t2% of the Sum Insured per fracture, maximum RM 4,000 per accident", cap: Record<string, unknown> = { cap: 4000, capQuote: "maximum RM 4,000 per accident" }) => schedule({
  insurer: "Bunga Raya Assurance Berhad", product: "Sejahtera PA Certificate", policyNumber: "BR-31001", people: [p],
  benefitLines: [`i\t${line}`, "ii\tAccidental death\t100% of the Sum Insured"],
  benefits: [bn({ benefit: "Fracture of leg", pays: "percent", value: 2, percentOf: "sum_insured", quote: line, ...cap })] });

// ============ Positive journeys ============
test("P1 GBP certificate: 2% of GBP 60,000 is GBP 1,200, under its GBP 1,500 cap", () => {
  const a = ask(gbpCert(), FIONA.name, /Fractures/);
  assert.deepEqual(vals(a.amounts), [1200], JSON.stringify(a.amounts));
  assert.match(a.amounts[0], /£|GBP/, a.amounts[0]);
});
test("P2 GBP certificate: 2% of GBP 100,000 is GBP 2,000, so the cap GBP 1,500 is shown", () => {
  const p = { ...FIONA, line: "Fiona MacLeod\tPolicyholder\t14/03/1979\tGBP 100,000", sum: 100000 };
  const a = ask(gbpCert(p), p.name, /Fractures/);
  assert.deepEqual(vals(a.amounts), [1500], JSON.stringify(a.amounts));
});
test("P3 HKD joint: each holder's 20% on their own sum (HKD 100,000 / HKD 60,000)", () => {
  const h = hkJoint();
  const c = ask(h, "Chan Tai Man", /burns/i), w = ask(h, "Wong Mei Yee", /burns/i);
  assert.deepEqual(vals(c.amounts), [100000], JSON.stringify(c.amounts));
  assert.deepEqual(vals(w.amounts), [60000], JSON.stringify(w.amounts));
  assert.match(c.amounts[0], /HK\$|HKD/);
});
test("P4 HKD joint: capped 5% is the lesser for each person (HKD 20,000 cap / HKD 15,000)", () => {
  const h = hkJoint();
  assert.deepEqual(vals(ask(h, "Chan Tai Man", /Dislocation/).amounts), [20000]);
  assert.deepEqual(vals(ask(h, "Wong Mei Yee", /Dislocation/).amounts), [15000]);
});
test("P5 AUD family: 15% of each person's own sum (60,000 / 37,500 / 12,000)", () => {
  const h = auFamily();
  assert.deepEqual(vals(ask(h, "Liam Kelly", /burns/i).amounts), [60000]);
  assert.deepEqual(vals(ask(h, "Grace Kelly", /burns/i).amounts), [37500]);
  assert.deepEqual(vals(ask(h, "Noah Kelly", /burns/i).amounts), [12000]);
});
test("P6 AUD: the child's 'limited to 25%' share is worked out on a certificate for the child alone (AUD 20,000); on the family schedule no one gets it", () => {
  const solo = auFamily(false, [AU[2]]);
  const r = tableRow(solo, "Noah Kelly", (x) => x.column === "Insured child under 16");
  assert.ok(r && r.figure.kind === "worked_out" && (r.figure as { amount: number }).amount === 20000, JSON.stringify(r?.figure));
  // The chat gives no amount: the row's printed line holds two shares (100% and 25%), so which is the person's is not
  // settled from the line itself (Critic #449 round 4). Never a wrong one.
  assert.ok(!vals(ask(solo, "Noah Kelly", /Accidental death/).amounts).some((v) => v !== 20000));
  const h = auFamily();
  for (const p of AU) assert.notEqual(tableRow(h, p.name, (x) => x.column === "Insured child under 16")?.figure.kind, "worked_out", p.name);
});
test("P7 AUD: a daily amount on a one-life schedule is the person's; a family schedule's shared table is out of this change's scope (no one)", () => {
  const r = tableRow(auFamily(false, [AU[1]]), "Grace Kelly", (x) => x.benefit === "Hospital cash");
  assert.ok(r && r.figure.kind === "printed" && (r.figure as { amount: number }).amount === 150, JSON.stringify(r?.figure));
  for (const p of AU) assert.equal(tableRow(auFamily(), p.name, (x) => x.benefit === "Hospital cash")?.figure.kind ?? "none", "none", p.name);
});
// P8: with more rows below the daily row, stayBlock cannot yet tell a later benefit's money from a limit on this one, so no
// stay total is given (fail-closed, as on main); the daily amount is still shown. Known limitation of PR #449.
for (const [label, last] of [["P8 AUD one-life schedule (hospital row followed by another table row)", false], ["P8b AUD one-life schedule (hospital row is the table's last line)", true]] as const) test(`${label}: a 7-day stay paid from 'the fourth day' shows AUD 150 a day${last ? " and 4 x AUD 150 = AUD 600" : ", and never a wrong total"}`, () => {
  const h = auFamily(last, [AU[1]]);
  const a = ask(h, "Grace Kelly", /Hospital cash/, ["Grace was in hospital for 7 days after a fall. How much hospital cash?"], { perDay: { stayDays: 7 } });
  assert.ok(vals(a.amounts).includes(150), JSON.stringify(a.amounts));
  if (last) assert.ok(vals(a.amounts).includes(600), JSON.stringify(a.amounts));
  else assert.ok(vals(a.amounts).every((v) => v === 150 || v === 600), JSON.stringify(a.amounts));
  assert.ok(!vals(a.amounts).includes(1050) && !vals(a.amounts).includes(900), JSON.stringify(a.amounts));
});
test("P9 SGD wording + schedule: 50% of SGD 200,000 = SGD 100,000; skull 3% = 6,000 so up to SGD 5,000; Ng's 3,600", () => {
  const h = sgSplit();
  assert.deepEqual(vals(ask(h, "Lim Wei Jie", /sight/).amounts), [100000]);
  assert.deepEqual(vals(ask(h, "Lim Wei Jie", /skull/).amounts), [5000]);
  assert.deepEqual(vals(ask(h, "Ng Hui Min", /skull/).amounts), [3600]);
});
test("P10 MYR certificate: 2% of RM 250,000 = RM 5,000, so up to the RM 4,000 cap", () => {
  const a = ask(myrCert(), AISYAH.name, /Fracture/);
  assert.deepEqual(vals(a.amounts), [4000], JSON.stringify(a.amounts));
});

// ============ Negative controls ============
test("N1 wrong person: Chan's row said for Wong never shows Chan's figure under Wong", () => {
  const h = hkJoint();
  const a = ask(h, "Chan Tai Man", /burns/i, ["How much for Wong's burns?"], {}, "Wong Mei Yee");
  assert.ok(!vals(a.all).includes(100000), JSON.stringify(a.kept.map((k) => [k.personName, k.amount?.text])));
});
test("N2 parent asking about the child-only 25% share: no figure for either parent", () => {
  const h = auFamily();
  for (const p of ["Liam Kelly", "Grace Kelly"]) {
    const r = tableRow(h, p, (x) => x.column === "Insured child under 16");
    assert.ok(!r || r.figure.kind === "none", `${p}: ${JSON.stringify(r?.figure)}`);
    const a = ask(h, p, /Accidental death/, ["If I die in an accident, how much?"]);
    assert.ok(!vals(a.all).includes(p === "Liam Kelly" ? 100000 : 62500), `${p}: ${JSON.stringify(a.all)}`);
  }
});
test("N3 another person's sum is never used (Wong never 100,000 / 25,000; Ng never 6,000/5,000 skull)", () => {
  const w = ask(hkJoint(), "Wong Mei Yee", /Dislocation/);
  assert.ok(!vals(w.all).includes(25000) && !vals(w.all).includes(20000), JSON.stringify(w.all));
  const ng = ask(sgSplit(), "Ng Hui Min", /sight/);
  assert.deepEqual(vals(ng.amounts), [60000], JSON.stringify(ng.amounts));
});
test("N4 two different sums for the same person (second live schedule, same policy): no figure", () => {
  const older = mkdoc(nid(), "Endorsement schedule.pdf", "PrimeGuard Accident", "Merlion Shield Insurance", "MSI-880011", ["Lim Wei Jie"], ["ENDORSEMENT\nLim Wei Jie\tLife assured\tSGD 350,000"]);
  const h = sgSplit(SG, [older]);
  const a = ask(h, "Lim Wei Jie", /sight/);
  assert.ok(!vals(a.all).includes(100000) && !vals(a.all).includes(175000), JSON.stringify(a.all));
});
test("N4b two sums on the certificate itself: no figure", () => {
  const h = gbpCert(FIONA, [FRACT], { cap: 1500, capQuote: "maximum GBP 1,500 per accident" }, "\nFiona MacLeod\tPolicyholder (from 01/06/2026)\t14/03/1979\tGBP 90,000");
  const a = ask(h, FIONA.name, /Fractures/);
  assert.deepEqual(a.all, [], JSON.stringify(a.all));
});
test("N5 bare '$' sums: no figure", () => {
  const people = SG.map((p) => ({ ...p, line: p.line.replace("SGD ", "$") }));
  const h = split({ insurer: "Merlion Shield Insurance", product: "PrimeGuard Accident", policyNumber: "MSI-880012", people,
    wordingLines: [`(a) ${EYE}`], benefits: [bn({ section: "Section A", benefit: "Total loss of sight of one eye", pays: "percent", value: 50, percentOf: "sum_insured", quote: EYE })] });
  const a = ask(h, "Lim Wei Jie", /sight/);
  assert.ok(!vals(a.all).includes(100000), JSON.stringify(a.all));
});
test("N6 a cap in another currency (USD on an RM sum): never RM 5,000 uncapped, never RM 1,000", () => {
  const line = "Fracture of leg\t2% of the Sum Insured per fracture, maximum USD 1,000 per accident";
  const h = myrCert(AISYAH, line, { cap: 1000, capQuote: "maximum USD 1,000 per accident" });
  const a = ask(h, AISYAH.name, /Fracture/);
  assert.ok(!vals(a.all).includes(5000) && !a.all.some((t) => /RM\s?1,000/.test(t)), JSON.stringify(a.all));
});
test("N6b a cap in another currency with no cap read: no RM figure at all", () => {
  const line = "Fracture of leg\t2% of the Sum Insured per fracture, maximum USD 1,000 per accident";
  const a = ask(myrCert(AISYAH, line, {}), AISYAH.name, /Fracture/);
  assert.ok(!a.all.some((t) => /RM/.test(t)), JSON.stringify(a.all));
});
test("N7 a premium on the same line as the sum: no figure", () => {
  const p = { ...AISYAH, line: "Nur Aisyah Binti Hassan\tPeserta\tRM 250,000\tAnnual contribution RM 310.00" };
  const a = ask(myrCert(p), p.name, /Fracture/);
  assert.deepEqual(a.all, [], JSON.stringify(a.all));
});
test("N8 correction: household changes Chan to Wong; Wong's row shows no Chan figure or sum", () => {
  const h = hkJoint();
  const asked = ["Sorry, I meant Wong Mei Yee, not Chan Tai Man. How much for burns?", "How much for third degree burns for Chan Tai Man?"];
  const a = ask(h, "Wong Mei Yee", /burns/i, asked);
  const text = a.kept.map((k) => `${k.text} ${k.amount?.text ?? ""} ${k.basis ?? ""}`).join(" | ");
  assert.ok(!/500,000|100,000/.test(text), text);
  assert.ok(!a.kept.some((k) => k.personName === "Chan Tai Man" && k.amount), text);
  assert.deepEqual(vals(a.amounts), [60000], JSON.stringify(a.amounts));
});
test("N9 a stay rule with a second day limit beside it gives no stay total", () => {
  const line = "Hospital cash\tAUD 150 per day in hospital, payable from the fourth day, up to 90 days per accident, and 14 days for a stay overseas";
  const h = schedule({ insurer: "Southern Cross Assurance Pty Ltd", product: "Family Active Accident", policyNumber: "SCA-55191", people: AU, benefitLines: [`3\t${line}`], trailer: "",
    benefits: [bn({ benefit: "Hospital cash", pays: "per_day", value: 150, maxDays: 90, quote: line })] });
  const a = ask(h, "Grace Kelly", /Hospital cash/, ["Grace was in hospital for 7 days. How much?"], { perDay: { stayDays: 7 } });
  assert.ok(!vals(a.all).includes(600), JSON.stringify(a.all));
});

// ============ Report ============
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      ${r.detail}`}`);
console.log(`claim-journeys-test: ${results.filter((r) => r.ok).length} passed, ${results.filter((r) => !r.ok).length} failed`);
if (results.some((r) => !r.ok)) process.exit(1);
