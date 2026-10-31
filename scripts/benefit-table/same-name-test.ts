/** Two people in one household with the same display name: a cover printed for that name goes to the one the document is
 * linked to by their own record (chosen at upload or in the "who does this cover" picker), or to the one the household
 * matched that printed name to on the document. When nothing on record tells them apart, the cover is shown as undecided
 * with both people, never dropped and never given to one by guess. Made-up households in several markets; no database,
 * no network, no model.
 *   npm run -s benefit-table:same-name-test */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("no network"); }) as typeof fetch;

import { checkReading } from "@/lib/benefit-table/check";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import type { SectionLink } from "@/lib/benefit-table/reading";

let pass = 0, fail = 0;
function t(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`ok ${name}`); } else { fail++; console.log(`FAIL ${name}${got === undefined ? "" : ` -> ${JSON.stringify(got)}`}`); }
}
const b = (o: Record<string, unknown>) => ({ section: null, column: null, pays: "words", value: null, percentOf: null, baseAmount: null, baseQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, ...o });

const markets = [
  { m: "MY", name: "Siti Aminah", sign: "RM", product: "Maju Health Takaful", cover: "Hospital & Surgical", sum: 120000, doc: "aaaaaaaa-0000-0000-0000-0000000a0001" },
  { m: "SG", name: "Tan Wei Ling", sign: "S$", product: "Kestrel Term Life", cover: "Term Life", sum: 400000, doc: "aaaaaaaa-0000-0000-0000-0000000a0002" },
  { m: "UK", name: "Mary Jones", sign: "£", product: "Harbour Life Cover", cover: "Level Term", sum: 250000, doc: "aaaaaaaa-0000-0000-0000-0000000a0003" },
];
for (const x of markets) {
  const amount = `${x.sign}${x.sum.toLocaleString("en-US")}`;
  const reading = checkReading({ id: x.doc, name: `${x.m} certificate.pdf`, readable: true, pages: [
    { page: 1, text: `CERTIFICATE\n${x.product}\nInsured person\t${x.name}\tSum insured ${amount}\nMain benefit\t${amount}` },
  ] }, { document: { kind: "personal_proof", product: x.product, insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null },
    covers: [{ person: x.name, product: x.product, cover: x.cover, plan: null, sumInsured: x.sum, asOf: null, page: 1, quote: `Insured person\t${x.name}\tSum insured ${amount}` }],
    benefits: [b({ section: "CERTIFICATE", benefit: "Main benefit", pays: "amount", value: x.sum, quote: `Main benefit\t${amount}` })] } as never);
  const links: SectionLink[] = [{ section: sectionKeyOf(x.doc, { section: "CERTIFICATE", column: null }), cover: coverKeyOf({ product: x.product, cover: x.cover, plan: null }), why: "the plan" }];
  const holder = (p: { covers: unknown[]; rows: unknown[] } | undefined) => !!p && p.covers.length === 1 && p.rows.length === 1;
  const other = { id: "other", display_name: "Lim Ah Kow" };

  // Linked by the holder's own record (policy_members).
  const byRecord: FamilyMember[] = [{ id: "a", display_name: x.name }, { id: "b", display_name: x.name, documents: [x.doc] }, other];
  let tb = assembleTable([reading], byRecord, links);
  t(`${x.m}: the cover goes to the namesake the document is linked to`, holder(tb.people.find((p) => p.id === "b")), tb.people.map((p) => [p.id, p.covers.length, p.rows.length]));
  t(`${x.m}: the other namesake gets nothing`, tb.people.find((p) => p.id === "a")!.covers.length === 0 && tb.people.find((p) => p.id === "a")!.rows.length === 0);
  t(`${x.m}: nothing is undecided or unmatched`, tb.ambiguousCovers.length === 0 && tb.unmatchedCovers.length === 0, { amb: tb.ambiguousCovers.length, un: tb.unmatchedCovers.length });

  // The household matched this printed name to one of them (policy_detected_people), even when both are linked.
  const byHand: FamilyMember[] = [{ id: "a", display_name: x.name, documents: [x.doc], printedAs: [{ documentId: x.doc, name: x.name.toUpperCase() }] },
    { id: "b", display_name: x.name, documents: [x.doc] }, other];
  tb = assembleTable([reading], byHand, links);
  t(`${x.m}: the household's own match of the printed name decides`, holder(tb.people.find((p) => p.id === "a")) && tb.people.find((p) => p.id === "b")!.covers.length === 0);
  // A match made on another document does not decide this one.
  const elsewhere: FamilyMember[] = [{ id: "a", display_name: x.name, printedAs: [{ documentId: "aaaaaaaa-0000-0000-0000-0000000fffff", name: x.name }] }, { id: "b", display_name: x.name }, other];
  tb = assembleTable([reading], elsewhere, links);
  t(`${x.m}: a match on another document never decides this one`, tb.ambiguousCovers.length === 1 && tb.people.every((p) => p.covers.length === 0));

  // Nothing on record, or both linked: shown as undecided with both people, never dropped, never given to either.
  for (const [what, fam] of [["nothing on record", [{ id: "a", display_name: x.name }, { id: "b", display_name: x.name }, other]],
    ["both linked", [{ id: "a", display_name: x.name, documents: [x.doc] }, { id: "b", display_name: x.name, documents: [x.doc] }, other]]] as [string, FamilyMember[]][]) {
    tb = assembleTable([reading], fam, links);
    const amb = tb.ambiguousCovers[0];
    t(`${x.m} (${what}): the cover is shown as undecided with both namesakes`, tb.ambiguousCovers.length === 1 && amb.documentId === x.doc
      && amb.candidates.map((c) => c.id).sort().join() === "a,b" && amb.cover.person === x.name && amb.sameName === true, tb.ambiguousCovers);
    t(`${x.m} (${what}): neither namesake is given it, and it is not called "not in your family"`, tb.people.every((p) => p.covers.length === 0 && p.rows.length === 0) && tb.unmatchedCovers.length === 0);
  }

  // A unique name is unchanged: matched by name, whatever the links say.
  tb = assembleTable([reading], [{ id: "a", display_name: x.name }, other], links);
  t(`${x.m}: a name only one person has still matches by name`, holder(tb.people.find((p) => p.id === "a")) && tb.ambiguousCovers.length === 0);
  // Someone not in the family is still "not in the family".
  tb = assembleTable([reading], [other, { id: "z", display_name: "Nur Aisyah" }], links);
  t(`${x.m}: a name nobody in the family has is still unmatched, not undecided`, tb.unmatchedCovers.length === 1 && tb.ambiguousCovers.length === 0);
}

// Two profiles that both partly fit the printed name ("Wei Ling" and "Tan Wei Ling" profiles for "TAN WEI LING") are
// exact for one: the exact one wins, as before.
{
  const doc = "aaaaaaaa-0000-0000-0000-0000000a0009";
  const reading = checkReading({ id: doc, name: "cert.pdf", readable: true, pages: [{ page: 1, text: "CERTIFICATE\nKestrel PA\nInsured person\tTAN WEI LING\tSum insured S$100,000\nMain benefit\tS$100,000" }] },
    { document: { kind: "personal_proof", product: "Kestrel PA", insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null },
      covers: [{ person: "TAN WEI LING", product: "Kestrel PA", cover: "PA", plan: null, sumInsured: 100000, asOf: null, page: 1, quote: "Insured person\tTAN WEI LING\tSum insured S$100,000" }],
      benefits: [b({ section: "CERTIFICATE", benefit: "Main benefit", pays: "amount", value: 100000, quote: "Main benefit\tS$100,000" })] } as never);
  const tb = assembleTable([reading], [{ id: "a", display_name: "Wei Ling" }, { id: "b", display_name: "Tan Wei Ling" }], []);
  t("an exact name match still wins over a partial one", tb.people.find((p) => p.id === "b")!.covers.length === 1 && tb.ambiguousCovers.length === 0);
  // Two partial fits and no exact one: a document link never decides (Critic H1 on #254); shown as undecided.
  const tb2 = assembleTable([reading], [{ id: "a", display_name: "Wei Ling" }, { id: "b", display_name: "Tan Ling", documents: [doc] }], []);
  t("two partial fits are never decided by a document link", tb2.people.every((p) => p.covers.length === 0) && tb2.ambiguousCovers.length === 1);
}

// Critic H1 on #254: people with DIFFERENT names that each fit part of the printed name (a father "Wei Jie" and his son
// "Wei" for "Tan Wei Jie"; a mother "Mei Ling" and her daughter "Ling" for "Lim Mei Ling") are never told apart by a
// document link: the document may be linked to the child for the child's own cover. Only the household's own match of this
// printed name decides; otherwise the cover is shown as undecided.
for (const [printedName, parent, child, ccy] of [["Tan Wei Jie", "Wei Jie", "Wei", "S$"], ["Lim Mei Ling", "Mei Ling", "Ling", "RM"]] as const) {
  const doc = "aaaaaaaa-0000-0000-0000-0000000a00" + (printedName.length % 90 + 10);
  const amount = `${ccy}200,000`;
  const reading = checkReading({ id: doc, name: "family plan.pdf", readable: true, pages: [{ page: 1, text: `CERTIFICATE\nKestrel Family Life\nLife assured\t${printedName}\tSum assured ${amount}\nDeath benefit\t${amount}` }] },
    { document: { kind: "personal_proof", product: "Kestrel Family Life", insurer: null, namedPeople: [], plan: null, periodFrom: null, periodTo: null },
      covers: [{ person: printedName, product: "Kestrel Family Life", cover: "Term Life", plan: null, sumInsured: 200000, asOf: null, page: 1, quote: `Life assured\t${printedName}\tSum assured ${amount}` }],
      benefits: [b({ section: "CERTIFICATE", benefit: "Death benefit", pays: "amount", value: 200000, quote: `Death benefit\t${amount}` })] } as never);
  const links: SectionLink[] = [{ section: sectionKeyOf(doc, { section: "CERTIFICATE", column: null }), cover: coverKeyOf({ product: "Kestrel Family Life", cover: "Term Life", plan: null }), why: "the plan" }];
  let tb = assembleTable([reading], [{ id: "p", display_name: parent }, { id: "c", display_name: child, documents: [doc] }], links);
  t(`"${printedName}" with the document linked only to the child "${child}": the child never gets the parent's cover`, tb.people.find((p) => p.id === "c")!.covers.length === 0, tb.people.map((p) => [p.id, p.covers.length]));
  t(`"${printedName}": shown as undecided between "${parent}" and "${child}"`, tb.ambiguousCovers.length === 1 && tb.ambiguousCovers[0].candidates.map((c) => c.id).sort().join() === "c,p"
    && tb.ambiguousCovers[0].sameName === false, tb.ambiguousCovers); // the card then says "could be any of", not "have this name" (Critic Low)
  tb = assembleTable([reading], [{ id: "p", display_name: parent, printedAs: [{ documentId: doc, name: printedName }] }, { id: "c", display_name: child, documents: [doc] }], links);
  t(`"${printedName}": the household's own match of the printed name decides`, tb.people.find((p) => p.id === "p")!.covers.length === 1 && tb.people.find((p) => p.id === "c")!.covers.length === 0 && tb.ambiguousCovers.length === 0);
}

t("no outbound fetch", fetches === 0, fetches);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
