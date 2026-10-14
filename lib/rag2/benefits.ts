/**
 * V1.4: ONE shared, read-only view of each household member's DOCUMENTED benefits, with explicit identities -- the
 * person, the document (policy / product / version / date), the benefit (the product heading or benefit label the
 * document itself prints), the printed value (amount, currency, unit, percentage and what it is a percentage of), its
 * printed conditions and its exact source (page, passage, table row / column). Built from what the system already
 * stores and parses (policies + policy_members + policy_pages, lib/rag2/tables.ts parseTables / rosterOf); nothing is
 * written and no table is created per person.
 *
 * It records PRINTED facts only: never whether the person is eligible, never what a claim would pay. Two kinds of
 * entry are kept apart:
 *   applicability "person_row"      the document prints the value on this person's own row (a certificate roster
 *                                   under a product heading) -- the person's own documented amount;
 *   applicability "shared_wording"  a wording / summary linked to the person prints a benefit for every insured person
 *                                   (a rate, a limit, a percentage) -- not a figure about this person alone.
 * What cannot be bound to a benefit by the document's own structure is listed under `unresolved`, never guessed.
 *
 * A household member's name, an address, a date or a salutation is NEVER a benefit label: labels come only from the
 * document's product headings and its own benefit rows / "Label: value" lines.
 */
import { endorsementScope } from "./endorsement-scope";
import { evidenceAt, type EvidenceRef } from "./evidence";
import { loadDocs, loadLinks, loadMembers, loadPages, policyFamily, type DocRow, type MemberRow } from "./store";
import { cellDate, headingLabel, memberNamedIn, parseCell, parseTables, rosterOf, type SelectedValue } from "./tables";
import { reconstructCellRoster } from "@/lib/claims/roster-layout";

export type PrintedValue =
  | { kind: "money"; amount: number; cents: number; currency: string; unit: string | null; period: string | null }
  | { kind: "percent"; percent: number; ppm: number; of: string | null }
  /** A benefit the wording defines as another printed amount ("Death Benefit: the Sum Assured shown in the
   * Certificate"): no figure of its own. */
  | { kind: "reference"; of: string };
export type PersonBenefit = {
  /** Stable identity: document, page and the offsets of the printing line(s). */
  key: string;
  householdId: string;
  /** The member the value is printed for (person_row), or the member the shared wording is linked to. */
  memberId: string;
  applicability: "person_row" | "shared_wording" | "amendment";
  policy: { id: string; product: string | null; insurer: string | null; policyNumber: string | null; groupPolicyNumber: string | null; documentRole: string | null; personalProof: boolean;
    version: { documentHash: string | null; documentDate: string | null; effectiveDate: string | null } };
  benefit: { label: string; source: "product_heading" | "table_row" | "label_line" };
  printed: PrintedValue;
  asOf: string | null;
  conditions: string[];
  source: { page: number; passage: string; row: { label: string; column: string | null } | null; evidence: EvidenceRef };
  /** Other documented amounts for the same person and benefit in the same policy (a certificate row and an endorsement
   * amending it): which applies is NOT decided here (amendment precedence is never guessed). */
  conflicts?: { key: string; policyId: string; amount: number; currency: string; page: number; effective: string | null }[];
  /** V1.4: precedence established from the documents' own wording and dates -- this row is amended by an endorsement
   * from its effective date (amendedBy), or this endorsement amends that row (amends). */
  amendedBy?: { key: string; policyId: string; amount: number; currency: string; page: number; effective: string };
  amends?: { key: string; policyId: string; amount: number; currency: string; page: number; asOf: string | null };
};
export type PersonBenefitView = { householdId: string; member: { id: string; name: string }; benefits: PersonBenefit[]; unresolved: string[] };

const MONEY_ONLY = /^(?:S\$|SGD|US\$|USD|RM|MYR|HK\$|HKD)\s?\d[\d,]*(?:\.\d+)?$/i;
const HAS_MONEY = /(?:S\$|SGD|US\$|USD|RM|MYR|HK\$|HKD)\s?\d/i;
const CONDITION = /\b(?:if|unless|within|provided|subject to|from the \d+\w* day|payable (?:only|from|after|on)|after|up to|per (?:accident|policy year|day))\b/i;
const namesOf = (m: MemberRow) => [...new Set([m.displayName, m.preferredName ?? "", m.displayName.split(/\s+/)[0] ?? ""].map((x) => x.trim()).filter((x) => x.length >= 2))];
/** A printed product heading: one cell, no amount, no member's name, and either a "(POLICY NO." marker or upper case. */
function isProductHeading(line: string, household: { id: string; names: string[] }[]): boolean {
  const l = line.trim();
  if (!l || l.length > 90 || HAS_MONEY.test(l) || /\S(?:\t+| {3,})\S/.test(l) || /[.:,;]$/.test(l)) return false;
  if (memberNamedIn(l, household)) return false;
  if (/\(\s*(?:group\s+)?policy\s*no/i.test(l)) return !/\bpage\s+\d+\s+of\s+\d+/i.test(l);
  const bare = l.replace(/\([^)]*\)/g, " ");
  return bare === bare.toUpperCase() && /[A-Z]{3,}\s+[A-Z]{3,}/.test(bare) && !/\d/.test(bare) && !/^(?:CERTIFICATE|DEAR|SCHEDULE OF)\b/.test(bare);
}
/** A "Label: value" line's own label (commas allowed), when the label is not a person, a date or an address. */
function labelLine(line: string, household: { id: string; names: string[] }[]): { label: string; value: string } | null {
  const m = /^\s*([A-Za-z][A-Za-z ()'’/&,-]{2,80}?)\s*:\s*(.+)$/.exec(line);
  if (!m || memberNamedIn(m[1], household)) return null;
  return { label: m[1].trim(), value: m[2].trim() };
}

export async function personBenefits(accountId: string, memberId: string, preloaded?: { docs?: DocRow[]; members?: MemberRow[] }): Promise<PersonBenefitView> {
  const members = preloaded?.members ?? await loadMembers(accountId);
  const member = members.find((m) => m.id === memberId);
  if (!member) return { householdId: accountId, member: { id: memberId, name: "" }, benefits: [], unresolved: ["not an active member of this household"] };
  const household = members.map((m) => ({ id: m.id, names: namesOf(m) }));
  const docs = preloaded?.docs ?? await loadDocs(accountId);
  const links = await loadLinks(accountId, docs.map((d) => d.id));
  const mine = docs.filter((d) => d.ownerId === memberId || links.some((l) => l.policyId === d.id && l.memberId === memberId));
  const pages = mine.length ? await loadPages(accountId, mine.map((d) => d.id)) : [];
  const out: PersonBenefit[] = [], unresolved: string[] = [];
  for (const d of mine) {
    const policy: PersonBenefit["policy"] = { id: d.id, product: d.productName, insurer: d.insurer, policyNumber: d.policyNumber, groupPolicyNumber: d.groupPolicyNumber, documentRole: d.documentRole, personalProof: d.personalCoverageConfirmed,
      version: { documentHash: d.fileHash, documentDate: d.documentDate, effectiveDate: d.effectiveDate } };
    const dp = pages.filter((p) => p.policyId === d.id);
    const seen = new Set<string>();
    const push = (b: Omit<PersonBenefit, "householdId" | "memberId" | "policy">) => { if (seen.has(b.key)) return; seen.add(b.key); out.push({ householdId: accountId, memberId, policy, ...b }); };
    // 1. The person's own rows: a roster table (one insured person per row under product headings).
    const tables = parseTables(d.id, dp.map((p) => ({ page: p.page, text: p.text })));
    const rosterRows = new Set<unknown>();
    for (const t of tables) {
      const ro = rosterOf(t, memberId, household);
      if (!ro) continue;
      for (const r of ro.mine) {
        rosterRows.add(r);
        const cells = t.columns.map((c) => ({ c, x: r.cells[c.index] })).filter((y) => y.x && HAS_MONEY.test(y.x.text));
        const pageText = dp.find((p) => p.page === r.page)?.text ?? "";
        const name = ro.nameCell.get(r)!;
        if (!r.section || !isProductHeading(r.section, household)) { unresolved.push(`${d.productName ?? "a document"} page ${r.page}: ${member.displayName}'s row is not printed under a product heading, so which benefit it is cannot be told from the document`); continue; }
        if (cells.length !== 1) { unresolved.push(`${d.productName ?? "a document"} page ${r.page}: ${member.displayName}'s row under “${headingLabel(r.section)}” prints ${cells.length} amounts`); continue; }
        const v = parseCell(cells[0].x!.text, cells[0].c.currency, r.section);
        if (v.kind !== "money") continue;
        const asOf = t.columns.map((c) => r.cells[c.index]).map((x) => (x ? cellDate(x.text) : null)).find((x) => !!x) ?? null;
        const evidence = evidenceAt({ policyId: d.id, documentHash: d.fileHash, page: r.page, pageText, start: r.lineStart, end: r.lineEnd, subjectId: memberId,
          table: { tableId: t.tableId, rowLabel: headingLabel(r.section), columnHeader: cells[0].c.header, columnLeaf: cells[0].c.leaf, appliesTo: cells[0].c.appliesTo, cell: { text: cells[0].x!.text, start: cells[0].x!.start, end: cells[0].x!.end },
            row: { cells: t.columns.flatMap((c) => { const x = r.cells[c.index]; return x ? [{ header: c.header, text: x.text, start: x.start, end: x.end }] : []; }) },
            layout: "person_row", rowPerson: { memberId, text: name.text, start: name.start, end: name.end }, asOf } });
        push({ key: `${d.id}:${r.page}:${r.lineStart}`, applicability: "person_row", benefit: { label: headingLabel(r.section), source: "product_heading" },
          printed: { kind: "money", amount: v.amount, cents: v.cents, currency: v.currency, unit: v.unit, period: v.period }, asOf, conditions: asOf ? [`printed as of ${asOf}: the document's amount on that date, not confirmation of cover on a later date`] : [],
          source: { page: r.page, passage: evidence.passage.text, row: { label: name.text, column: cells[0].c.header || null }, evidence } });
      }
    }
    for (const p of dp) {
      const lines = p.text.split("\n");
      let at = 0, heading: string | null = null;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i], start = at; at += line.length + 1;
        if (isProductHeading(line, household)) { heading = line.trim(); continue; }
        if (heading && memberNamedIn(line, household) === memberId && !HAS_MONEY.test(line)) continue;
        // 3. Shared wording: "Label: S$150 per day ..." / "Label: 100% of the Sum Insured ...".
        const ll = labelLine(line, household);
        if (!ll) continue;
        const v = parseCell(ll.value, null, ll.label);
        const pct = /^(\d+(?:\.\d+)?)\s*%(?:\s+of\s+(?:the\s+)?([^.;,]{3,80}))?/i.exec(ll.value);
        const ref = /^the\s+(sum\s+(?:assured|insured))\b/i.exec(ll.value);
        const cut = (x: string) => x.split(/\s+(?:if|when|for|unless|within|provided|shown|payable|as)\b/i)[0].trim();
        const printed: PrintedValue | null = v.kind === "money" ? { kind: "money", amount: v.amount, cents: v.cents, currency: v.currency, unit: v.unit, period: v.period }
          : pct ? { kind: "percent", percent: Number(pct[1]), ppm: Math.round(Number(pct[1]) * 10000), of: pct[2] ? cut(pct[2]) : null }
          : ref ? { kind: "reference", of: ref[1].replace(/\s+/g, " ") } : null;
        if (!printed) continue;
        const evidence = evidenceAt({ policyId: d.id, documentHash: d.fileHash, page: p.page, pageText: p.text, start, end: start + line.length, subjectId: memberId });
        push({ key: `${d.id}:${p.page}:${start}`, applicability: "shared_wording", benefit: { label: ll.label, source: "label_line" }, printed, asOf: null,
          conditions: CONDITION.test(ll.value) ? [line.trim()] : [], source: { page: p.page, passage: evidence.passage.text, row: null, evidence } });
      }
    }
    // 2b. A roster stored ONE CELL PER LINE: reconstructed by its record structure (lib/claims/roster-layout.ts); what
    // cannot be read is a named gap, never a guess.
    const memberOf = (t: string) => memberNamedIn(t, household);
    const cellRoster = reconstructCellRoster(dp.map((p) => ({ page: p.page, text: p.text })), memberOf);
    for (const r of cellRoster.records.filter((x) => x.memberId === memberId)) {
      const label = headingLabel(r.heading);
      if (out.some((b) => b.policy.id === d.id && b.applicability === "person_row" && b.benefit.label === label && b.source.page === r.page)) continue;
      const v = parseCell(r.amount.text);
      if (v.kind !== "money") continue;
      const pageText = dp.find((p) => p.page === r.page)?.text ?? "";
      const first = r.cells[0], last = r.cells[r.cells.length - 1];
      const evidence = evidenceAt({ policyId: d.id, documentHash: d.fileHash, page: r.page, pageText, start: first.start, end: last.end, pageStart: r.headingPage, subjectId: memberId,
        table: { tableId: `${d.id}:p${r.page}:cells`, rowLabel: label, columnHeader: "Sum Assured", columnLeaf: null, appliesTo: null, cell: { text: r.amount.text, start: r.amount.start, end: r.amount.end },
          row: { cells: r.cells.map((c) => ({ header: c.kind, text: c.text, start: c.start, end: c.end })) }, layout: "person_row", rowPerson: { memberId, text: r.name.text, start: r.name.start, end: r.name.end }, asOf: r.asOf } });
      push({ key: `${d.id}:${r.page}:${first.start}`, applicability: "person_row", benefit: { label, source: "product_heading" },
        printed: { kind: "money", amount: v.amount, cents: v.cents, currency: v.currency, unit: v.unit, period: v.period }, asOf: r.asOf,
        conditions: r.asOf ? [`printed as of ${r.asOf}: the document's amount on that date, not confirmation of cover on a later date`] : [],
        source: { page: r.page, passage: evidence.passage.text, row: { label: r.name.text, column: "Sum Assured" }, evidence } });
    }
    for (const g of cellRoster.gaps) unresolved.push(`${d.productName ?? "a document"} page ${g.page}: ${g.reason}`);
    // 4. Shared wording tables: a benefit row printing one amount or percentage (not a person's row).
    for (const t of tables) for (const r of t.rows) {
      if (rosterRows.has(r) || !r.label || memberNamedIn(r.label, household) || /\d/.test(r.label.replace(/\([^)]*\)/g, ""))) continue;
      const vals = t.columns.map((c) => ({ c, x: r.cells[c.index] })).filter((y) => y.x && y.x !== r.labelCell && y.x.text !== r.label).map((y) => ({ ...y, v: parseCell(y.x!.text, y.c.currency, r.label) })).filter((y) => y.v.kind === "money" || y.v.kind === "percent");
      if (vals.length !== 1) continue;
      const pageText = dp.find((p) => p.page === r.page)?.text ?? "";
      const v = vals[0].v, of = /%\s+of\s+(?:the\s+)?([^)\n]{3,60})/i.exec(vals[0].c.header)?.[1]?.trim() ?? null;
      const printed: PrintedValue = v.kind === "money" ? { kind: "money", amount: v.amount, cents: v.cents, currency: v.currency, unit: v.unit, period: v.period } : { kind: "percent", percent: (v as { percent: number }).percent, ppm: (v as { ppm: number }).ppm, of };
      const evidence = evidenceAt({ policyId: d.id, documentHash: d.fileHash, page: r.page, pageText, start: r.lineStart, end: r.lineEnd, subjectId: memberId });
      push({ key: `${d.id}:${r.page}:${r.lineStart}`, applicability: "shared_wording", benefit: { label: r.label, source: "table_row" }, printed, asOf: null, conditions: [],
        source: { page: r.page, passage: evidence.passage.text, row: { label: r.label, column: vals[0].c.header || null }, evidence } });
    }
  }
  // 5. An amendment of this person's documented amount (an endorsement line naming the person, a product heading of
  // the same policy, and one amount), and the conflict it makes with the certificate row: both are kept, neither wins.
  const heads = (policyId: string) => { const d = docs.find((x) => x.id === policyId); const fam = d ? new Set(policyFamily(docs, d).map((x) => x.id)) : new Set([policyId]); return [...new Set(out.filter((b) => b.applicability === "person_row" && fam.has(b.policy.id)).map((b) => b.benefit.label))]; };
  for (const d of mine) {
    if (!/endorse|amend|alteration/i.test(`${d.documentRole ?? ""} ${d.productName ?? ""}`)) continue;
    const labels = heads(d.id);
    for (const p of pages.filter((x) => x.policyId === d.id)) {
      let at = 0;
      for (const line of p.text.split("\n")) {
        const start = at; at += line.length + 1;
        const money = line.match(/(?:S\$|SGD|US\$|USD|RM|MYR|HK\$|HKD)\s?\d[\d,]*(?:\.\d+)?/gi) ?? [];
        if (money.length !== 1 || memberNamedIn(line, household) !== memberId) continue;
        const named = labels.filter((l) => line.toLowerCase().includes(l.toLowerCase()));
        if (named.length !== 1) continue;
        const v = parseCell(money[0]);
        if (v.kind !== "money") continue;
        const eff = /\b(?:with effect from|w\.?e\.?f\.?|effective(?: from)?)\s+(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/i.exec(line);
        const evidence = evidenceAt({ policyId: d.id, documentHash: d.fileHash, page: p.page, pageText: p.text, start, end: start + line.length, subjectId: memberId });
        out.push({ key: `${d.id}:${p.page}:${start}`, householdId: accountId, memberId, applicability: "amendment",
          policy: { id: d.id, product: d.productName, insurer: d.insurer, policyNumber: d.policyNumber, groupPolicyNumber: d.groupPolicyNumber, documentRole: d.documentRole, personalProof: d.personalCoverageConfirmed, version: { documentHash: d.fileHash, documentDate: d.documentDate, effectiveDate: d.effectiveDate } },
          benefit: { label: named[0], source: "product_heading" }, printed: { kind: "money", amount: v.amount, cents: v.cents, currency: v.currency, unit: v.unit, period: v.period },
          asOf: eff ? cellDate(eff[1]) : d.effectiveDate, conditions: [line.trim()], source: { page: p.page, passage: evidence.passage.text, row: null, evidence } });
      }
    }
  }
  // Precedence: an endorsement linked to this person, of the same policy, whose own wording AMENDS the benefit ("is
  // amended to", "is revised to") with an effective date, amends a certificate row printed as of an EARLIER date --
  // from that effective date, as its wording says. Only when that cannot be established (no effective date, no
  // amending wording, the certificate dated after the endorsement, or two amendments disagreeing) is it a conflict.
  const AMENDING = /\b(?:is|are|was|were|shall be|will be)\s+(?:hereby\s+)?(?:amended|revised|changed|increased|decreased|reduced)\s+(?:to|from)\b/i;
  const amendments = out.filter((b) => b.applicability === "amendment");
  for (const a of amendments) {
    for (const b of out.filter((x) => x.applicability === "person_row" && x.benefit.label === a.benefit.label && x.printed.kind === "money" && a.printed.kind === "money" && (x.printed.amount !== a.printed.amount || x.printed.currency !== a.printed.currency))) {
      const ref = (x: PersonBenefit) => ({ key: x.key, policyId: x.policy.id, amount: (x.printed as { amount: number }).amount, currency: (x.printed as { currency: string }).currency, page: x.source.page, effective: x.asOf });
      const rival = amendments.some((o) => o !== a && o.benefit.label === a.benefit.label && o.asOf === a.asOf && (o.printed as { amount: number }).amount !== (a.printed as { amount: number }).amount);
      const datedInWording = /\b(?:with effect from|w\.?e\.?f\.?|effective(?: from)?)\s+\d/i.test(a.conditions[0] ?? "");
      if (a.asOf && datedInWording && AMENDING.test(a.conditions[0] ?? "") && (!b.asOf || b.asOf < a.asOf) && !rival) {
        b.amendedBy = { ...ref(a), effective: a.asOf };
        a.amends = { key: b.key, policyId: b.policy.id, amount: (b.printed as { amount: number }).amount, currency: (b.printed as { currency: string }).currency, page: b.source.page, asOf: b.asOf };
        continue;
      }
      (b.conflicts ??= []).push(ref(a)); (a.conflicts ??= []).push(ref(b));
      unresolved.push(`${a.benefit.label}: ${b.policy.product ?? "the certificate"} prints ${(b.printed as { currency: string }).currency} ${(b.printed as { amount: number }).amount.toLocaleString("en-SG")}${b.asOf ? ` as of ${b.asOf}` : ""}, and ${a.policy.product ?? "an endorsement"} prints ${(a.printed as { currency: string }).currency} ${(a.printed as { amount: number }).amount.toLocaleString("en-SG")}${a.asOf ? ` with effect from ${a.asOf}` : ""}; which applies now is not established from the documents`);
    }
  }
  return { householdId: accountId, member: { id: memberId, name: member.displayName }, benefits: out, unresolved };
}

/** Every member's view, and the benefit identities each document prints (its product headings and benefit labels --
 * never a member's name, an address or a date): what composition compares a figure's benefit against. */
export type HouseholdBenefits = {
  byMember: Map<string, PersonBenefitView>;
  labelsByPolicy: Map<string, string[]>;
  /** The readable documents each member is linked to (an insured link; or their own personal policy document with no
   * links), with their insurer -- never a document linked to nobody: which insurers a
   * statement about that member may name. */
  policiesByMember: Map<string, { policyId: string; insurer: string | null; product: string | null; personal: boolean }[]>;
  /** Every insurer named on the household's readable documents. */
  insurers: string[];
  /** V1.4: each member's view of each endorsement document (lib/rag2/endorsement-scope.ts): whether it applies to
   * them, belongs to another member, or does not state whom it applies to. */
  endorsementsByMember: Map<string, { policyId: string; product: string | null; scope: "applies" | "other" | "unresolved"; basis: string; namedIds: string[] }[]>;
  /** V1.5: other names the SAME insurer goes by for a document, from the documents themselves: the insurer recorded on
   * another document of the same policy (policy number), or an insurer name the document's own text prints (a
   * certificate stored under the insurer's registered name whose scheme summary is stored under its brand name). Never a name-similarity
   * guess. */
  insurerAliases: Map<string, string[]>;
};
export async function householdBenefits(accountId: string): Promise<HouseholdBenefits> {
  const [members, docs] = await Promise.all([loadMembers(accountId), loadDocs(accountId)]);
  const links = docs.length ? await loadLinks(accountId, docs.map((d) => d.id)) : [];
  const policiesByMember = new Map(members.map((m) => [m.id, docs.filter((d) => links.some((l) => l.policyId === d.id && l.memberId === m.id) || (d.ownerId === m.id && d.personalCoverageConfirmed && links.every((l) => l.policyId !== d.id))).map((d) => ({ policyId: d.id, insurer: d.insurer, product: d.productName, personal: d.personalCoverageConfirmed }))]));
  const insurers = [...new Set(docs.map((d) => (d.insurer ?? "").trim()).filter((x) => x.length >= 3))];
  const byMember = new Map<string, PersonBenefitView>();
  for (const m of members) byMember.set(m.id, await personBenefits(accountId, m.id, { docs, members }));
  const household = members.map((m) => ({ id: m.id, names: namesOf(m) }));
  const labelsByPolicy = new Map<string, string[]>();
  const pages = docs.length ? await loadPages(accountId, docs.map((d) => d.id)) : [];
  for (const d of docs) {
    const set = new Set<string>();
    for (const v of byMember.values()) for (const b of v.benefits) if (b.policy.id === d.id) set.add(b.benefit.label);
    for (const p of pages.filter((x) => x.policyId === d.id)) for (const line of p.text.split("\n")) if (isProductHeading(line, household)) set.add(headingLabel(line.trim()));
    labelsByPolicy.set(d.id, [...set]);
  }
  const endorsements = docs.filter((d) => d.documentRole === "endorsement" || /\bendorsement\b/i.test(d.productName ?? ""));
  // Only endorsements of a policy the member holds (same policy family as one of their linked documents) are theirs to
  // consider; an unrelated insurer's endorsement linked to nobody is not part of their cover either way.
  const endorsementsByMember = new Map(members.map((m) => [m.id, endorsements.filter((d) => policyFamily(docs, d).some((f) => f.id !== d.id && (policiesByMember.get(m.id) ?? []).some((p) => p.policyId === f.id))).map((d) => {
    const sc = endorsementScope({ text: pages.filter((x) => x.policyId === d.id).map((x) => x.text).join("\n"), subjectId: m.id, household });
    return { policyId: d.id, product: d.productName, ...sc };
  })]));
  const insurerAliases = new Map<string, string[]>();
  for (const d of docs) {
    const own = (d.insurer ?? "").trim();
    const text = pages.filter((x) => x.policyId === d.id).map((x) => x.text).join("\n").toLowerCase();
    const fam = policyFamily(docs, d).map((f) => (f.insurer ?? "").trim());
    const printed = insurers.filter((n) => n.length >= 4 && new RegExp(`(?<![a-z0-9])${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(text));
    insurerAliases.set(d.id, [...new Set([...fam, ...printed].filter((n) => n && n !== own))]);
  }
  return { byMember, labelsByPolicy, policiesByMember, insurers, endorsementsByMember, insurerAliases };
}

/** V1.4: a person's own documented row as a table value (for a roster the table parser does not read -- one cell per
 * line), with the same evidence contract select_table_value issues (person_row, the name cell, the as-of date). */
export function selectedFromBenefit(b: PersonBenefit, memberName: string): SelectedValue | null {
  if (b.applicability !== "person_row" || b.printed.kind !== "money" || b.conflicts?.length) return null;
  const ev = b.source.evidence;
  return { status: "ok", value: b.printed.amount, valueKind: "money", cents: b.printed.cents, ppm: null, currency: b.printed.currency, unit: b.printed.unit, period: (b.printed.period ?? null) as SelectedValue["period"],
    conditions: [`under “${b.benefit.label}”`, ...b.conditions], benefit: b.benefit.label, rowLabel: b.benefit.label, columnHeader: ev.table?.columnHeader ?? "",
    columnBasis: { basis: "document", detail: `the document prints ${memberName}'s own row (“${ev.table?.rowPerson?.text ?? ""}”) under “${b.benefit.label}”`, evidence: ev }, version: null, evidence: ev, notes: [] };
}
