/**
 * Conversational RAG: which of the household's documents insure one person, and how sure that is.
 *
 * policiesFor() lists the readable documents (active, released, current, read -- ./store) that insure the subject as
 * an insured person / covered member -- not merely as the policy owner, a nominee, an assignee or a beneficiary, and
 * not a vehicle / home / pet cover that only names them -- with each one's in-force status on `asOf`, the current
 * version (an endorsement and its effective date; an enrolment confirmation under a group booklet), the reasons a
 * document does NOT cover them, and what the stored data cannot determine. Evidence for every role and date it
 * reads from a page is an EvidenceRef.
 */
import { evidenceAt, type EvidenceRef } from "./evidence";
import { tokens } from "./search";
import { amendmentRemovals, loadDocs, loadLinks, loadMembers, loadPages, type DocRow, type LinkRow } from "./store";
import type { AmendmentRemoval } from "@/lib/claims/person";
import { AMENDS, isoDate, printedEffectiveDate } from "./tables";
import { endorsementScope } from "./endorsement-scope";

export type CoverRole = "insured" | "recorded_insured" | "owner_only" | "nominee" | "assignee" | "beneficiary" | "not_named";
export type InsuredKind = "person" | "motor" | "home" | "pet" | "property";
export type InForce = { status: "in_force" | "not_started" | "lapsed" | "unknown"; from: string | null; to: string | null; basis: string; evidence: EvidenceRef | null };
export type Amendment = { policyId: string; productName: string | null; effectiveDate: string | null; inForce: boolean | null; evidence: EvidenceRef | null;
  /** V1.4: whom it applies to (lib/rag2/endorsement-scope.ts): "applies" to this person, or "unresolved" (it does not say). */
  scope?: "applies" | "unresolved"; scopeBasis?: string };
export type PolicyCoverage = {
  policyId: string; productName: string | null; insurer: string | null; policyNumber: string | null; documentRole: string | null;
  role: CoverRole; insures: InsuredKind; covered: boolean | null; tier: string | null; topicMatch: boolean | null;
  inForce: InForce;
  version: { documentHash: string | null; documentDate: string | null; amendments: Amendment[]; enrolment: { policyId: string; evidence: EvidenceRef | null } | null; current: string;
    /** Round 8: amendment documents of this policy that were deleted or superseded (metadata only, never their text). */
    removedAmendments?: AmendmentRemoval[] };
  reasons: string[]; undetermined: string[]; evidence: EvidenceRef[];
};
export type PoliciesForResult = { subjectId: string; subjectName: string | null; asOf: string; covering: PolicyCoverage[]; notCovering: PolicyCoverage[]; undetermined: string[] };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normNo = (s: string | null) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const INSURED = /\b(?:life assured|lives? insured|insured persons?|persons? insured|the insured\b|insured members?|insured:|insured\s{2,}|covered (?:persons?|members?)|members? covered|dependants? (?:enrolled|covered)|enrolled|enrolment|employee name|member name|insured adult|insured child|category)\b/i;
const NOMINEE = /\bnominees?\b/i, ASSIGNEE = /\bassignees?\b|\bassigned to\b|\babsolute assignment\b/i, BENEFICIARY = /\bbeneficiar(?:y|ies)\b/i;
const OWNER = /\bpolicy ?(?:owner|holder)\b|\bproposer\b|\bpayor\b|\bpayer\b|\bowner\b|\bemployer\b|\bplanholder\b/i;
const ENROLMENT = /\benrol(?:l)?ment confirmation\b|\bconfirmation of enrol(?:l)?ment\b|\benrol(?:l)?ment (?:summary|statement)\b/i;
const BOOKLET = /\bbenefits? booklet\b|\bemployee benefits? (?:guide|handbook|summary)\b|\bscheme booklet\b/i;
const PERIOD = /\b(?:period of (?:insurance|cover)|policy period|cover(?:age)? period|plan year|policy term|period)\b[^\n]*?(\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4}|\d{4}-\d{2}-\d{2})\s*(?:to|until|-|–)\s*(\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4}|\d{4}-\d{2}-\d{2})/i;

function insuredKind(d: DocRow, text: string): InsuredKind {
  const head = [d.policyType, d.productName].filter(Boolean).join(" ") + " " + text.slice(0, 600);
  if (/\b(?:motor|vehicle|car insurance|private car|registration no)\b/i.test(head)) return "motor";
  if (/\b(?:pet|dog|cat|canine|feline)\b/i.test(head) && /\b(?:pet|breed|microchip)\b/i.test(head)) return "pet";
  if (/\b(?:home ?(?:contents|insurance|shield)|householder|fire insurance|home contents|renovation)\b/i.test(head)) return "home";
  if (/\b(?:gadget|mobile phone|device protection)\b/i.test(head)) return "property";
  return "person";
}

type Named = { page: number; line: string; context: string; ref: EvidenceRef; heading?: EvidenceRef | null };
function namedLinesOf(d: DocRow, pages: Map<number, string>, names: string[], subjectId: string): Named[] {
  const out: Named[] = [];
  if (!names.length) return out;
  const re = new RegExp("(?<![\\p{L}])(?:" + names.map(esc).join("|") + ")(?![\\p{L}])", "iu");
  for (const [page, text] of pages) {
    const lines = text.split("\n");
    let at = 0;
    const starts: number[] = [];
    lines.forEach((line, i) => {
      starts.push(at);
      if (re.test(line)) {
        const prev = lines.slice(Math.max(0, i - 6), i).filter((x) => x.trim());
        // V1.1 (evidence contract): a roster row names the person; the heading above it that says the rows are the
        // insured persons is what makes the row a statement of cover -- it travels with the row as its own evidence.
        let heading: EvidenceRef | null = null;
        for (let j = i - 1; j >= Math.max(0, i - 6); j--) if (INSURED.test(lines[j]) && !re.test(lines[j])) { heading = evidenceAt({ policyId: d.id, documentHash: d.fileHash, page, pageText: text, start: starts[j], end: starts[j] + lines[j].length, subjectId }); break; }
        out.push({ page, line, context: [...prev.slice(-4), line].join("\n"), ref: evidenceAt({ policyId: d.id, documentHash: d.fileHash, page, pageText: text, start: at, end: at + line.length, subjectId }), heading });
      }
      at += line.length + 1;
    });
  }
  return out;
}

function roleFrom(named: Named[], names: string[]): { role: CoverRole; ev: EvidenceRef[] } {
  const strip = (l: string) => l.replace(new RegExp(names.map(esc).join("|") || "$^", "gi"), " ");
  // The line itself says so ("Life assured: X", "Insured persons: X (child)"), or it is a row of a table headed as a
  // list of insured persons ("Insured persons" / "Name  Category" above "X   Insured Child").
  const tableRow = (l: string) => /\t|\S {2,}\S/.test(l.trim());
  const other = (l: string) => OWNER.test(l) || NOMINEE.test(l) || ASSIGNEE.test(l) || BENEFICIARY.test(l);
  const ins = named.filter((n) => INSURED.test(strip(n.line)) || (tableRow(n.line) && INSURED.test(n.context.split("\n").slice(0, -1).join("\n")) && !other(strip(n.line))));
  if (ins.length) return { role: "insured", ev: ins.flatMap((n) => (n.heading && !INSURED.test(strip(n.line)) ? [n.heading, n.ref] : [n.ref])).filter((e, k, a) => a.findIndex((x) => x.passage.start === e.passage.start && x.passage.onPage === e.passage.onPage) === k) };
  const by = (re: RegExp) => named.filter((n) => re.test(strip(n.line)));
  if (by(NOMINEE).length) return { role: "nominee", ev: by(NOMINEE).map((n) => n.ref) };
  if (by(ASSIGNEE).length) return { role: "assignee", ev: by(ASSIGNEE).map((n) => n.ref) };
  if (by(BENEFICIARY).length) return { role: "beneficiary", ev: by(BENEFICIARY).map((n) => n.ref) };
  if (by(OWNER).length) return { role: "owner_only", ev: by(OWNER).map((n) => n.ref) };
  return { role: "not_named", ev: named.map((n) => n.ref) };
}

function periodOf(d: DocRow, pages: Map<number, string>, asOf: string): InForce {
  let from = d.effectiveDate, to = d.expiryDate, evidence: EvidenceRef | null = null, basis = from || to ? "the dates recorded for the document" : "";
  for (const [page, text] of pages) {
    const m = text.match(PERIOD);
    if (!m) continue;
    const a = isoDate(m[1]), b = isoDate(m[2]);
    if (!a || !b) continue;
    const lineStart = text.lastIndexOf("\n", m.index!) + 1, lineEnd = text.indexOf("\n", m.index!) < 0 ? text.length : text.indexOf("\n", m.index!);
    evidence = evidenceAt({ policyId: d.id, documentHash: d.fileHash, page, pageText: text, start: lineStart, end: Math.max(lineEnd, m.index! + m[0].length) });
    from = from ?? a; to = to ?? b; basis = "the period printed on page " + page;
    break;
  }
  if (/^(?:lapsed|terminated|cancelled|surrendered)$/i.test(d.status ?? "")) return { status: "lapsed", from, to, basis: `recorded as ${d.status}`, evidence };
  if (!from && !to) return { status: "unknown", from, to, basis: "the document prints no period of cover and none is recorded", evidence };
  // Every policy on file is treated as in force: a printed end never makes it "expired" (DC, 31 Oct). An event before the
  // cover starts is still "not started", as the claim calculators check.
  if (from && asOf < from) return { status: "not_started", from, to, basis, evidence };
  return { status: "in_force", from, to, basis, evidence };
}

const topicHit = (topic: string, hay: string) => {
  const want = tokens(topic).filter((w) => w.length >= 3);
  if (!want.length) return null;
  const have = new Set(tokens(hay));
  return want.some((w) => have.has(w) || [...have].some((h) => h.length >= 5 && w.length >= 5 && (h.startsWith(w) || w.startsWith(h))));
};

/** The household's documents that insure `subjectId`, with in-force status, current version and reasons for not covering. */
export async function policiesFor(args: { accountId: string; subjectId: string; topic?: string | null; asOf?: string | null }): Promise<PoliciesForResult> {
  const asOf = (args.asOf ?? new Date().toISOString()).slice(0, 10);
  const members = await loadMembers(args.accountId);
  const subject = members.find((m) => m.id === args.subjectId);
  if (!subject) return { subjectId: args.subjectId, subjectName: null, asOf, covering: [], notCovering: [], undetermined: ["that person is not an active member of this household"] };
  const names = [subject.displayName, subject.preferredName].filter((n): n is string => !!n && n.trim().length >= 3);
  const docs = await loadDocs(args.accountId);
  const links = await loadLinks(args.accountId, docs.map((d) => d.id));
  const pageRows = await loadPages(args.accountId, docs.map((d) => d.id));
  const pagesOf = (id: string) => new Map(pageRows.filter((p) => p.policyId === id).map((p) => [p.page, p.text]));
  const textOf = (id: string) => pageRows.filter((p) => p.policyId === id).map((p) => p.text).join("\n");
  const linkOf = (id: string): LinkRow | undefined => links.find((l) => l.policyId === id && l.memberId === subject.id);

  // Group documents of one policy / scheme: schedule or booklet first, then endorsements and enrolment confirmations.
  const keyOf = (d: DocRow) => normNo(d.groupPolicyNumber) || normNo(d.policyNumber) || d.id;
  const isEndorsement = (d: DocRow) => d.documentRole === "endorsement" || (AMENDS.test(textOf(d.id)) && /\bendorsement\b/i.test(textOf(d.id).slice(0, 400)));
  const isEnrolment = (d: DocRow) => /enrol/i.test(d.documentRole ?? "") || ENROLMENT.test(textOf(d.id).slice(0, 800)) || ENROLMENT.test(d.productName ?? "");
  const groups = new Map<string, DocRow[]>();
  for (const d of docs) { const k = keyOf(d); (groups.get(k) ?? groups.set(k, []).get(k)!).push(d); }
  // A doc whose policy number equals another group's group number joins that group.
  for (const d of docs) { const k2 = normNo(d.policyNumber); if (k2 && groups.has(k2) && keyOf(d) !== k2) { groups.get(keyOf(d))!.splice(groups.get(keyOf(d))!.indexOf(d), 1); groups.get(k2)!.push(d); } }

  const removals = await amendmentRemovals(args.accountId, docs);
  const covering: PolicyCoverage[] = [], notCovering: PolicyCoverage[] = [], undetermined: string[] = [];
  for (const group of groups.values()) {
    if (!group.length) continue;
    const bases = group.filter((d) => !isEndorsement(d) && !isEnrolment(d));
    const list = bases.length ? bases : group;
    for (const d of list) {
      const pages = pagesOf(d.id), text = textOf(d.id);
      const link = linkOf(d.id);
      const named = namedLinesOf(d, pages, names, subject.id);
      if (!link && d.ownerId !== subject.id && !named.length && !group.some((g) => g !== d && namedLinesOf(g, pagesOf(g.id), names, subject.id).length)) continue;
      const reasons: string[] = [], und: string[] = [], evidence: EvidenceRef[] = [];
      let { role, ev } = roleFrom(named, names);
      evidence.push(...ev);
      // An enrolment confirmation under a group booklet names who is enrolled.
      let enrolment: PolicyCoverage["version"]["enrolment"] = null;
      for (const e of group.filter((g) => g !== d && isEnrolment(g))) {
        const en = namedLinesOf(e, pagesOf(e.id), names, subject.id);
        if (en.length) { enrolment = { policyId: e.id, evidence: en[0].ref }; evidence.push(...en.map((n) => n.ref)); if (role !== "insured") role = "insured"; }
      }
      const kind = insuredKind(d, text);
      const booklet = BOOKLET.test(text.slice(0, 1200)) || BOOKLET.test(d.productName ?? "") || /booklet|reference/i.test(d.documentRole ?? "");
      let covered: boolean | null;
      if (kind !== "person") { covered = false; reasons.push(`it insures a ${kind === "property" ? "item of property" : kind}, not a person`); }
      else if (role === "insured") covered = true;
      else if (role === "nominee" || role === "assignee" || role === "beneficiary") { covered = false; reasons.push(`${subject.displayName} is named as the ${role}, not as an insured person`); }
      else if (role === "owner_only") { covered = false; reasons.push(`${subject.displayName} is named as the policy owner / holder only; the document names someone else as insured`); }
      else if (booklet && !enrolment) { covered = null; und.push(`${d.productName ?? "This booklet"} describes a group scheme; no enrolment confirmation on file names ${subject.displayName}`); }
      else if (link || d.ownerId === subject.id) { role = "recorded_insured"; covered = true; und.push(`the document does not print ${subject.displayName}'s name; they are recorded on file as covered by it`); }
      else { covered = false; reasons.push(`${subject.displayName} is not recorded as covered by it`); }
      if (role === "recorded_insured" && !d.personalCoverageConfirmed && !link) { covered = null; und.push("personal cover is not confirmed for this document"); }

      const inForce = periodOf(d, pages, asOf);
      if (inForce.status === "unknown") und.push(`${d.productName ?? "the document"}: ${inForce.basis}`);
      if (covered && (inForce.status === "lapsed" || inForce.status === "not_started")) reasons.push(inForce.status === "not_started" ? `cover starts on ${inForce.from}` : `the policy is ${d.status}`);

      // V1.4: an endorsement of the same policy number amends THIS person's cover only when its scope includes them
      // (its amending clause names them, it is scheme-wide, or it has no person-specific clause). One whose amending clause
      // names only another member is not theirs: it is left out entirely, so it supports no amendment, caveat or conflict for this person.
      const household = members.map((m) => ({ id: m.id, names: [m.displayName, m.preferredName].filter((n): n is string => !!n && n.trim().length >= 2) }));
      const scopeOf = (g: DocRow) => endorsementScope({ text: textOf(g.id), subjectId: subject.id, household });
      const amendments: Amendment[] = group.filter((g) => g !== d && isEndorsement(g) && scopeOf(g).scope !== "other").map((g) => {
        const sc = scopeOf(g);
        const gp = pagesOf(g.id);
        let eff = g.effectiveDate ?? g.documentDate ?? null, evx: EvidenceRef | null = null;
        for (const [page, t] of gp) { const pe = printedEffectiveDate(t); if (pe) { eff = eff ?? pe.date; evx = evidenceAt({ policyId: g.id, documentHash: g.fileHash, page, pageText: t, start: pe.start, end: pe.end }); break; } }
        return { policyId: g.id, productName: g.productName, effectiveDate: eff, inForce: eff ? eff <= asOf : null, evidence: evx, scope: sc.scope === "applies" ? "applies" as const : "unresolved" as const, scopeBasis: sc.basis };
      }).sort((a, b) => String(a.effectiveDate).localeCompare(String(b.effectiveDate)));
      for (const a of amendments) if (a.effectiveDate == null) und.push(`an endorsement of ${d.productName ?? "this policy"} prints no effective date`);
      // (A remaining letter that cancels an earlier amendment is not itself an amendment in force.)
      const reversers = new Set((removals.get(d.id) ?? []).flatMap((r) => (r.kind === "amendment_reversed" ? [r.reversedBy] : [])));
      for (const a of amendments) if (a.scope === "unresolved") und.push(`${a.productName ?? "an endorsement"}${a.effectiveDate ? ` (effective ${a.effectiveDate})` : ""} amends this policy number for one insured person but does not establish which household member`);
      const live = amendments.filter((a) => a.inForce && !reversers.has(a.policyId) && a.scope === "applies");
      const liveUnresolved = amendments.filter((a) => a.inForce && !reversers.has(a.policyId) && a.scope === "unresolved");
      const removed = (removals.get(d.id) ?? []).filter((r) => r.kind === "amendment_removed");
      const reversed = (removals.get(d.id) ?? []).filter((r) => r.kind === "amendment_reversed");
      const current = live.length ? `the schedule as amended by the endorsement effective ${live[live.length - 1].effectiveDate}`
        : liveUnresolved.length ? `not established: an endorsement of this policy number (effective ${liveUnresolved.map((a) => a.effectiveDate).join(", ")}) does not establish whom it applies to`
        : removed.length ? "not established: an amendment document for this policy was removed from the library, so the current terms may differ from the schedule as issued"
        : reversed.length ? "the schedule as issued (a remaining document says an earlier amendment was reversed)" : "the schedule as issued";
      for (const r of removed) und.push(r.note);
      const pending = amendments.filter((a) => a.inForce === false);
      if (pending.length) und.push(`an endorsement effective ${pending.map((a) => a.effectiveDate).join(", ")} is not yet in force on ${asOf}`);
      if (inForce.evidence) evidence.push(inForce.evidence);
      const topicMatch = args.topic ? topicHit(args.topic, [d.productName, d.policyType, text].join(" ")) : null;
      const row: PolicyCoverage = {
        policyId: d.id, productName: d.productName, insurer: d.insurer, policyNumber: d.policyNumber, documentRole: d.documentRole,
        role, insures: kind, covered, tier: link?.tier ?? null, topicMatch, inForce,
        version: { documentHash: d.fileHash, documentDate: d.documentDate, amendments, enrolment, current, ...(removals.get(d.id)?.length ? { removedAmendments: removals.get(d.id)! } : {}) },
        reasons, undetermined: und, evidence,
      };
      if (covered === false || (covered && reasons.length)) notCovering.push(row);
      else if (covered) covering.push(row);
      else { notCovering.push(row); undetermined.push(...und.map((u) => `${d.productName ?? d.id}: ${u}`)); }
    }
  }
  undetermined.push("Superseded or deleted versions are not read; a policy never uploaded cannot be listed.");
  const order = (a: PolicyCoverage, b: PolicyCoverage) => Number(b.topicMatch === true) - Number(a.topicMatch === true) || String(a.productName).localeCompare(String(b.productName));
  return { subjectId: subject.id, subjectName: subject.displayName, asOf, covering: covering.sort(order), notCovering: notCovering.sort(order), undetermined };
}
