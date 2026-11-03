/** One policy whose two documents name the person's cover differently is counted once on Home tiles (3 Nov). Its policy
 * wording names the cover after the plan itself ("Kestrel CritiCare II", sum insured 300,000) and its schedule names it
 * by the benefit ("Comprehensive Critical Illness Benefit", 300,000): the table then holds two covers of one policy, and
 * the Critical Illness tile added the one sum twice; the Death tile lost its total. On the route's path: assembleTable
 * over checked readings, then lumpSumParts(tileRows(categoryRows(category, rows)), lines, held, category).
 * The negative cases keep apart what is not positively one policy: a basic plan and its rider, two named benefits,
 * different printed numbers, another product, another person, another sum or currency, one document.
 * Made-up SG, MY and UK households. Synthetic only; no model, no database, no network.
 *   npm run -s coverage:plan-two-names-test */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("no network"); }) as typeof fetch;

import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import type { CheckedBenefit, CheckedCover, CheckedReading } from "@/lib/benefit-table/check";
import { categoryRows, lumpSumParts, referenceCover, tileRows, type ConfirmedLine, type HeldCover } from "@/lib/coverage/table-figures";

let pass = 0, fail = 0;
function t(id: string, ok: boolean, detail: unknown) {
  if (ok) { pass++; console.log("ok " + id); return; }
  fail++; console.log(`FAIL ${id}: ${JSON.stringify(detail)}`);
}

const family: FamilyMember[] = [{ id: "p-ana", display_name: "Ana Reyes" }, { id: "p-ben", display_name: "Ben Okafor" }];
const MARKETS = [
  { m: "SG", cur: "SGD", plan: "Kestrel CritiCare II", benefit: "Comprehensive Critical Illness Benefit", other: "Harbour Group Living Care" },
  { m: "MY", cur: "MYR", plan: "Maju Penyakit Kritikal Plus", benefit: "Critical Illness Benefit", other: "Lotus Takaful Group Care" },
  { m: "UK", cur: "GBP", plan: "Alder Serious Illness Cover", benefit: "Serious Critical Illness Benefit", other: "Thames Workplace Critical Illness" },
] as const;

for (const { m, cur, plan: PLAN, benefit: BEN, other: OTHER } of MARKETS) {
  const src = (doc: string, page = 1) => ({ documentId: doc, document: `${doc}.pdf`, page, excerpt: "" });
  const cover = (doc: string, o: Partial<CheckedCover>): CheckedCover => ({ person: "Ana Reyes", product: PLAN, cover: PLAN, plan: PLAN, riderOf: null,
    policyNumber: null, sumInsured: 300000, premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, quote: "",
    source: src(doc), currency: cur, ...o });
  const row = (doc: string, section: string, name: string, value: number | null, o: Partial<CheckedBenefit> = {}): CheckedBenefit => ({ section, column: null, benefit: name,
    pays: value == null ? "percent" : "amount", value: value ?? 100, period: null, basis: null, asOf: null, percentOf: value == null ? "sum_insured" : null, baseAmount: null,
    baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, quote: "", source: src(doc), currency: cur, baseSource: null,
    capSource: null, capUnread: false, droppedConditions: [], ...o });
  const reading = (doc: string, covers: CheckedCover[], benefits: CheckedBenefit[], kind: CheckedReading["kind"], product: string = PLAN): CheckedReading =>
    ({ documentId: doc, document: `${doc}.pdf`, kind, product, plan: product, namedPeople: covers.map((c) => c.person), covers, benefits, dropped: [] });
  const key = (c: Partial<CheckedCover>) => coverKeyOf({ product: c.product ?? PLAN, cover: c.cover ?? PLAN, plan: c.plan === undefined ? PLAN : c.plan, riderOf: c.riderOf ?? null });
  const WHOLE = key({}), NAMED = key({ cover: BEN }), DEATH = key({ cover: "Death Benefit" });
  const OTHER_KEY = key({ product: OTHER, cover: OTHER, plan: null });

  // The schedule (personal): the benefit-named cover, its death benefit, and their lines; a section of provisions.
  const schedule = (o: Partial<CheckedCover> = {}, extra: CheckedCover[] = [], doc = "sched") => reading(doc, [cover(doc, { cover: BEN, policyNumber: "84001234", ...o }),
    cover(doc, { cover: "Death Benefit", sumInsured: 5000, policyNumber: "84001234" }), ...extra],
    [row(doc, "Policy Schedule", BEN, o.sumInsured ?? 300000), row(doc, "Policy Schedule", "Death Benefit", 5000), row(doc, "Benefit Provisions", "Critical Illness Benefit", null, { percentOf: null }),
      row(doc, "Benefit Provisions", "Intensive Care Benefit", null, { value: 20, cap: 25000 })], "personal_proof");
  // The policy wording: names the person with the plan's own name and sum insured on one page.
  const wording = (o: Partial<CheckedCover> = {}) => reading("wording", [cover("wording", o)],
    [row("wording", "2.1 Death Benefit", "Death Benefit", 5000), row("wording", "2.2 Critical Illness Benefit", "Critical Illness Benefit", null)], "policy_wording");
  // Another policy, of another insurer.
  const otherPolicy = reading("other", [cover("other", { product: OTHER, cover: OTHER, plan: null, sumInsured: 350000 }),
    cover("other", { product: OTHER, cover: "Group Term Life", plan: null, sumInsured: 1000000 })],
    [row("other", "Benefits", "Critical Illness", 350000), row("other", "Life Benefits", "Death", 1000000)], "personal_proof", OTHER);
  const OTHER_LIFE = key({ product: OTHER, cover: "Group Term Life", plan: null });
  const linksFor = (rs: CheckedReading[], extra: Record<string, string> = {}) => rs.flatMap((r) => r.benefits.map((b) => {
    const section = sectionKeyOf(r.documentId, b);
    const cover = extra[`${r.documentId}|${b.section}`] ?? (r.documentId === "other" ? (b.section === "Life Benefits" ? OTHER_LIFE : OTHER_KEY) : b.section === "Policy Schedule" ? WHOLE
      : /death/i.test(b.section ?? "") ? DEATH : NAMED);
    return { section, cover, why: "test" };
  }));
  // referenceDocs: documents whose stored role is a policy wording (the route's REFERENCE_DOCUMENT_ROLES), whatever kind
  // the reading gave them.
  const tile = (rs: CheckedReading[], category: string, lines: (ConfirmedLine & { name: string })[] = [], person = "p-ana", extra: Record<string, string> = {}, referenceDocs: string[] = []) => {
    const p = assembleTable(rs, family, linksFor(rs, extra)).people.find((x) => x.id === person)!;
    const held: HeldCover[] = p.covers.map((c) => ({ coverKey: c.coverKey, ...(c.holding ? { holding: c.holding } : {}), name: c.cover, documentId: c.source.documentId,
      sumInsured: c.sumInsured, currency: c.currency, policyNumber: c.policyNumber, ...(c.copyNumbers ? { copyNumbers: c.copyNumbers } : {}),
      ...(c.copyDocuments ? { copyDocumentIds: c.copyDocuments.map((x) => x.documentId) } : {}),
      ...(referenceCover(c, new Set(referenceDocs)) ? { reference: true } : {}) }));
    return lumpSumParts(tileRows(categoryRows(category, p.rows)), lines, held, category);
  };
  const show = (r: ReturnType<typeof tile>) => ({ total: r.total, known: r.known, parts: r.parts.map((x) => `${x.name}=${x.amount ?? "?"} ${x.currency ?? ""}`) });
  const line = (name: string, docs: string[], amount: number): ConfirmedLine & { name: string } => ({ name, documentIds: docs, amount, currency: cur });

  // A: the 3 Nov shape. One policy (300,000 CI, 5,000 death) beside another policy (350,000 CI, 1,000,000 death).
  for (const [withLines, lines] of [["no confirmed lines", { ci: [], death: [] }], ["its schedule's confirmed lines", { ci: [line(PLAN, ["sched"], 300000)], death: [line(PLAN, ["sched"], 5000)] }]] as const) {
    const rs = [schedule(), wording(), otherPolicy];
    const ci = tile(rs, "Critical Illness", [...lines.ci]);
    t(`${m} A1 (${withLines}) CI: the policy is counted once, ${cur} 650,000 (never 950,000)`, ci.total === 650000 && ci.parts.length === 2, show(ci));
    const death = tile(rs, "Death", [...lines.death]);
    t(`${m} A2 (${withLines}) Death: one total, ${cur} 1,005,000, the plan never listed as a part with no amount`, death.total === 1005000 && death.parts.every((x) => x.amount != null), show(death));
  }
  // A3: the wording's page prints no policy number, the schedule does; and both print the same one written two ways.
  {
    const ci = tile([schedule({ policyNumber: "84-001234" }), wording({ policyNumber: "84001234" }), otherPolicy], "Critical Illness");
    t(`${m} A3 one number written two ways: counted once, 650,000`, ci.total === 650000, show(ci));
  }

  // A5: the schedule's own provisions share is read too ("one hundred percent (100%) of the Sum Assured"): still once.
  {
    const sch = schedule(); sch.benefits = sch.benefits.map((b) => b.benefit === "Critical Illness Benefit" ? { ...b, percentOf: "sum_insured" } : b);
    const ci = tile([sch, wording(), otherPolicy], "Critical Illness");
    t(`${m} A5 the provisions' share read as 100% of the sum: counted once, 650,000`, ci.total === 650000, show(ci));
  }
  // A4: the wording names the person, so its reading calls it personal proof, but it is stored as a policy wording.
  {
    const w = wording(); w.kind = "personal_proof";
    const ci = tile([schedule(), w, otherPolicy], "Critical Illness", [], "p-ana", {}, ["wording"]);
    t(`${m} A4 a wording stored as a wording, read as personal proof: counted once, 650,000`, ci.total === 650000, show(ci));
  }
  // T1 (TE pr303): two contracts of one plan and sum, one naming the benefit, the other the plan (a second policy bought):
  // never joined unless both print the same number; one number missing gives no total, never 300,000.
  for (const [label, a, b, want] of [["neither prints a number", null, null, null], ["only the schedule prints one", "84001234", null, null],
    ["only the certificate prints one", null, "84001234", null], ["both print the same number", "84001234", "84-001234", 650000],
    ["they print different numbers", "84001234", "55000111", null]] as const) {
    const cert = reading("cert", [cover("cert", { policyNumber: b })], [row("cert", "2.2 Critical Illness Benefit", "Critical Illness Benefit", null)], "personal_proof");
    const ci = tile([schedule({ policyNumber: a }), cert, otherPolicy], "Critical Illness");
    t(`${m} T1 two contracts of the plan, ${label}: ${want ?? "no total"}`, ci.total === want, show(ci));
  }
  // N9 (TE pr303): a life plan named after itself on its schedule, and an accelerated CI benefit of the same sum on its own
  // endorsement: the Death tile keeps its total (the CI benefit is not on Death), and CI is the benefit's own sum.
  {
    const life = reading("lifesched", [cover("lifesched", { policyNumber: "84001234" })], [row("lifesched", "Schedule", "Death Benefit", 300000)], "personal_proof");
    const endorsement = reading("endorse", [cover("endorse", { cover: BEN, policyNumber: "84001234" })], [row("endorse", "Endorsement", BEN, 300000)], "personal_proof");
    const links = { "lifesched|Schedule": WHOLE, "endorse|Endorsement": NAMED };
    const death = tile([life, endorsement], "Death", [], "p-ana", links);
    t(`${m} N9 life plan + accelerated CI endorsement: Death keeps 300,000`, death.total === 300000, show(death));
  }
  // T5 (TE pr303): policy B's personal benefit summary or certificate part (stored as a benefit guide) names the plan and
  // its sum with no number: a second policy may be held, so it is never joined (no total, never 300,000).
  {
    const summary = reading("bsum", [cover("bsum", {})], [row("bsum", "2.2 Critical Illness Benefit", "Critical Illness Benefit", null)], "personal_proof");
    const ci = tile([schedule(), summary, otherPolicy], "Critical Illness");
    t(`${m} T5 a personal benefit summary of a second policy: not joined, no total`, ci.total === null, show(ci));
  }
  // P2 (Critic R303 H2): the wording and a separate plan-named contract with no number, of one sum, are one cover in the
  // table whichever is read first: never joined, in either order.
  {
    const contract = reading("contract", [cover("contract", {})], [row("contract", "2.2 Critical Illness Benefit", "Critical Illness Benefit", null)], "personal_proof");
    for (const [order, rs] of [["schedule, wording, contract", [schedule(), wording(), contract]], ["schedule, contract, wording", [schedule(), contract, wording()]],
      ["wording, contract, schedule", [wording(), contract, schedule()]], ["contract, wording, schedule", [contract, wording(), schedule()]]] as const) {
      const ci = tile([...rs], "Critical Illness");
      t(`${m} P2 wording + a plan-named contract with no number (${order}): not joined, no total`, ci.total === null, show(ci));
    }
  }
  // N1: a basic plan and its rider, each 300,000 on the schedule: both count, and the wording joins the basic plan only.
  {
    const rider = cover("sched", { cover: "Critical Illness Plus Rider", riderOf: BEN, policyNumber: "84001234" });
    const s = schedule({}, [rider]);
    s.benefits.push(row("sched", "Rider Schedule", "Critical Illness Plus Rider", 300000));
    const ci = tile([s, wording()], "Critical Illness", [], "p-ana", { "sched|Rider Schedule": key({ cover: "Critical Illness Plus Rider", riderOf: BEN }) });
    t(`${m} N1 basic plan and rider of 300,000 each: both count, 600,000 (the wording is not a third)`, ci.total === 600000 && ci.parts.length === 2, show(ci));
  }
  // N2: two named benefits of the plan with the same sum, and the wording's plan-named cover: which one it is cannot be told.
  {
    const second = cover("sched", { cover: "Major Cancer Critical Illness Benefit", policyNumber: "84001234" });
    const s = schedule({}, [second]);
    s.benefits.push(row("sched", "Cancer Schedule", "Major Cancer Critical Illness Benefit", 300000));
    const ci = tile([s, wording()], "Critical Illness", [], "p-ana", { "sched|Cancer Schedule": key({ cover: "Major Cancer Critical Illness Benefit" }) });
    t(`${m} N2 two named benefits agree with the wording's cover: no total (never 900,000 or a guess)`, ci.total === null && ci.known === null, show(ci));
  }
  // N3: the wording's page prints another policy number: two policies may be held, so no total.
  {
    const ci = tile([schedule(), wording({ policyNumber: "99007777" }), otherPolicy], "Critical Illness");
    t(`${m} N3 different printed numbers: not joined, no total`, ci.total === null, show(ci));
  }
  // N3b (Critic R303 H1): a contract of the plan printing another number, beside a wording page with none, in either read
  // order: the number is never lost by which copy is kept, so the two are never joined.
  {
    const contract = reading("contract", [cover("contract", { policyNumber: "99007777" })], [row("contract", "2.2 Critical Illness Benefit", "Critical Illness Benefit", null)], "personal_proof");
    for (const [order, rs] of [["schedule, wording, contract", [schedule(), wording(), contract]], ["schedule, contract, wording", [schedule(), contract, wording()]],
      ["wording, contract, schedule", [wording(), contract, schedule()]], ["contract, wording, schedule", [contract, wording(), schedule()]]] as const) {
      const ci = tile([...rs], "Critical Illness");
      t(`${m} N3b another number on a contract of the plan (${order}): not joined, no total`, ci.total === null, show(ci));
    }
  }
  // N4: another product's plan-named cover with the same sum is another policy: both count.
  {
    const rs = [schedule(), reading("wording", [cover("wording", { product: OTHER, cover: OTHER, plan: OTHER })], [row("wording", "2.2 Critical Illness Benefit", "Critical Illness Benefit", 300000)], "personal_proof", OTHER)];
    const ci = tile(rs, "Critical Illness", [], "p-ana", { "wording|2.2 Critical Illness Benefit": key({ product: OTHER, cover: OTHER, plan: OTHER }), "sched|Policy Schedule": NAMED });
    t(`${m} N4 another product with the same sum: two policies, 600,000`, ci.total === 600000 && ci.parts.length === 2, show(ci));
  }
  // N5: the wording names another person: each person's tile has only their own cover.
  {
    const rs = [schedule(), wording({ person: "Ben Okafor" })];
    const ana = tile(rs, "Critical Illness"), ben = tile(rs, "Critical Illness", [], "p-ben");
    t(`${m} N5 another person: Ana keeps her own 300,000`, ana.total === 300000 && ana.parts.length === 1, show(ana));
    t(`${m} N5b another person: Ben's tile never takes Ana's cover`, ben.parts.every((x) => x.amount !== 600000) && ben.total !== 600000, show(ben));
  }
  // N6: the wording's sum differs from the schedule's: not shown to be one policy, so no total.
  {
    const ci = tile([schedule(), wording({ sumInsured: 200000 })], "Critical Illness");
    t(`${m} N6 different sums: not joined, no total (never 500,000)`, ci.total === null, show(ci));
  }
  // N7: the wording states another currency: not joined, no total.
  {
    const other = cur === "SGD" ? "MYR" : "SGD";
    const ci = tile([schedule(), wording({ currency: other })], "Critical Illness");
    t(`${m} N7 another currency on the wording: not joined, no total`, ci.total === null, show(ci));
  }
  // N8: the plan-named cover on the SAME document as the named one is not joined by this rule (no change).
  {
    const s = schedule({}, [cover("sched", { policyNumber: "84001234" })]);
    const ci = tile([s], "Critical Illness");
    t(`${m} N8 both names on one document: this rule does not join them (two parts, no total)`, ci.total === null && ci.parts.length === 2, show(ci));
  }
}

t("no network calls", fetches === 0, fetches);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
