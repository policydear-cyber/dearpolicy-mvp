/**
 * Employer group cover in a benefit booklet (Round 7 product change).
 *
 * A group benefits booklet (group term life, group personal accident, group
 * hospital and surgical, outpatient) is a summary for every member of an
 * employer's scheme, not the person's own schedule. It used to be left out of
 * claims silently. It is now shown as a SEPARATE, clearly labelled possible
 * benefit -- "Possible cover through <employer>" -- for the people the booklet
 * plausibly covers (the employee it is linked to, or an enrolled dependant
 * when the booklet has a dependants column), with the page it is printed on,
 * never with the booklet's figures (they are for the whole scheme, not a
 * confirmed amount for this person), and with the employer/HR confirmation
 * added to the documents to send.
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { tierApplies } from "@/lib/policies/benefit-catalog";
import type { FactFindingCategory } from "@/lib/claims/fact-finding";
import type { SubjectFacts } from "@/lib/chat/types";
import type { ChatAnswer, ChatCitation, ClaimItem } from "@/types";

export type GroupBooklet = {
  policyId: string; productName: string; employer: string | null; employeeId: string | null; employeeName: string | null;
  memberTier: string | null; effectiveDate: string | null; expiryDate: string | null;
  /** The scheme year printed in the booklet's title or file name ("Employee Benefits 2026"), when no dates are printed. */
  documentYear?: number | null;
  rows: { benefitName: string; tier: string | null; page: number | null }[];
};

const DEPENDANT_TIER = /\b(?:dependants?|dependents?|spouse|child(?:ren)?|family)\b/i;
const known = (facts: SubjectFacts, key: string) => facts[key]?.state === "known" ? facts[key].value : null;
const day = (v: unknown) => { const t = typeof v === "string" || v instanceof Date ? Date.parse(String(v instanceof Date ? v.toISOString() : v)) : NaN; return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null; };

/** The group booklets this person is linked to, with the rows of their own column. */
export async function loadGroupBooklets(accountId: string, personId: string): Promise<GroupBooklet[]> {
  try {
    const docs = (await query<{ id: string; product_name: string | null; original_filename: string; employer: string | null; owner: string | null; owner_name: string | null;
      tier: string | null; effective_date: string | null; renewal_or_expiry_date: string | null }>(
      `SELECT p.id::text,p.product_name,p.original_filename,p.extracted_json->>'policyholder' AS employer,p.family_member_id::text AS owner,
              COALESCE(fm.preferred_name,fm.display_name) AS owner_name,to_jsonb(pm)->>'benefit_tier' AS tier,p.effective_date::text,p.renewal_or_expiry_date::text
         FROM policies p JOIN policy_members pm ON pm.policy_id=p.id AND pm.account_id=p.account_id AND pm.family_member_id=$2
         LEFT JOIN family_members fm ON fm.id=p.family_member_id AND fm.account_id=p.account_id
        WHERE p.account_id=$1 AND ${activePredicate("p")} AND p.processing_status='ready' AND p.personal_coverage_confirmed=false
          AND (p.policy_type ILIKE '%group%' OR p.group_policy_number IS NOT NULL OR p.product_name ILIKE '%group%' OR p.document_role IN ('benefit_guide','benefit_summary'))
          AND (p.policy_type ILIKE '%group%' OR p.product_name ILIKE '%group%' OR p.original_filename ILIKE '%employee%' OR p.original_filename ILIKE '%group%')`,
      [accountId, personId])).rows;
    if (!docs.length) return [];
    const rows = (await query<{ policy_id: string; benefit_name: string; tier: string | null; source_page: number | null }>(
      `SELECT policy_id::text,benefit_name,tier,source_page FROM policy_benefits
        WHERE account_id=$1 AND policy_id::text=ANY($2::text[]) AND COALESCE(to_jsonb(policy_benefits)->>'row_kind','benefit')='benefit'`,
      [accountId, docs.map((d) => d.id)])).rows;
    return docs.map((d) => ({
      policyId: d.id, productName: d.product_name || d.original_filename.replace(/\.pdf$/i, "").replace(/[_-]+/g, " "),
      employer: d.employer?.trim() || null, employeeId: d.owner, employeeName: d.owner_name, memberTier: d.tier,
      effectiveDate: day(d.effective_date), expiryDate: day(d.renewal_or_expiry_date),
      documentYear: printedYear((d.product_name ?? "") + " " + d.original_filename),
      rows: rows.filter((r) => r.policy_id === d.id).map((r) => ({ benefitName: r.benefit_name, tier: r.tier, page: r.source_page })),
    }));
  } catch { return []; }
}

/** "Harbourfront_Employee_Benefits_2026_x.pdf" -> 2026; null when no single year is printed. */
function printedYear(text: string): number | null {
  const years = [...new Set([...text.matchAll(/(?<!\d)(20\d\d)(?!\d)/g)].map((m) => Number(m[1])))];
  return years.length === 1 ? years[0] : null;
}
/** Whether the event can be placed in the booklet's period: "inside", "outside" (clearly not), or "unchecked" (no dates printed). */
export function bookletPeriodFit(booklet: GroupBooklet, eventDate: string | null): "inside" | "outside" | "unchecked" {
  const event = day(eventDate);
  if (booklet.effectiveDate || booklet.expiryDate) {
    if (!event) return "inside";
    return (booklet.effectiveDate && event < booklet.effectiveDate) || (booklet.expiryDate && event > booklet.expiryDate) ? "outside" : "inside";
  }
  // No printed dates: a scheme year in the title still rules out an event years away from it.
  // A scheme year can straddle two calendar years, so only an event more than a year from it is clearly outside.
  if (event && booklet.documentYear) {
    const year = Number(event.slice(0, 4));
    if (year < booklet.documentYear - 1 || year > booklet.documentYear + 1) return "outside";
  }
  return "unchecked";
}

/** Which booklet rows answer this event (names only; never their figures). */
export function groupRowsForEvent(booklet: GroupBooklet, personId: string, category: FactFindingCategory | null, facts: SubjectFacts) {
  const dependant = booklet.employeeId !== personId;
  // A person linked to someone else's booklet is covered only through a dependants column.
  if (dependant && !(booklet.memberTier && DEPENDANT_TIER.test(booklet.memberTier))) return [];
  if (!dependant && booklet.memberTier && DEPENDANT_TIER.test(booklet.memberTier)) return [];
  const mine = booklet.rows.filter((r) => {
    if (!r.tier) return true;
    if (dependant !== DEPENDANT_TIER.test(r.tier)) return false;
    return !booklet.memberTier || tierApplies(r.tier, booklet.memberTier);
  });
  const death = known(facts, "death") === true;
  const accidental = known(facts, "accidentalDeath") === true || known(facts, "eventType") === "accident" || known(facts, "injured") === true;
  const illness = known(facts, "eventType") === "illness" || known(facts, "accidentalDeath") === false;
  const admitted = known(facts, "hospitalised") === true || known(facts, "treatmentType") === "Admitted to hospital" || category === "medical_reimbursement" || category === "hospital_cash";
  const maternity = known(facts, "maternity") === true;
  const tests: RegExp[] = [];
  if (death) {
    tests.push(/\bterm life\b|\blife\b(?!.*accident)|^(?!.*accident).*\bdeath\b/i);
    if (accidental && !illness) tests.push(/accident\w*.*death|death.*accident/i);
  } else {
    if (category === "disability_tpd" || known(facts, "permanentImpairment") === true) {
      tests.push(/total and permanent|\btpd\b/i);
      if (accidental) tests.push(/permanent disablement/i);
    }
    if (category === "critical_illness") tests.push(/critical illness|\bcancer\b|dread disease/i);
    if (admitted && !maternity) tests.push(/room and board|hospital (?:misc\w*|services)|surgical|pre-hospital|post-hospital/i, ...(known(facts, "icuStay") === true ? [/intensive care|\bicu\b/i] : []));
    if (category === "accidental_injury" && accidental && !illness) tests.push(/(?:accident|\bgpa\b).*medical|medical.*accident/i);
    if (category === "accidental_injury" && /dental|tooth/i.test(String(known(facts, "injuryKind") ?? ""))) tests.push(/\bdental\b/i);
    // A clinic visit on a trip is the travel policy's overseas medical claim, not the employer's GP benefit.
    if (!admitted && illness && known(facts, "treatmentType") === "Outpatient or clinic" && category !== "travel") tests.push(/general practitioner|\bgp\b/i);
  }
  const fits = mine.filter((r) => tests.some((re) => re.test(r.benefitName)) && !/annual limit|overall/i.test(r.benefitName));
  const seen = new Set<string>();
  return fits.filter((r) => { const k = r.benefitName.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

const plainName = (name: string) => name.replace(/\s*\([^)]*\)/g, "").replace(/\s+-\s+/g, " – ").trim();
function list(items: string[]) { return items.length <= 1 ? items.join("") : items.slice(0, -1).join(", ") + " and " + items[items.length - 1]; }

export type GroupCoverResult = { cards: ClaimItem[]; citations: ChatCitation[]; documents: string[]; sentence: string | null };
/** The separate group-cover card(s) for this person and event. */
export function groupCoverFor(args: { booklets: GroupBooklet[]; person: { id: string; name: string }; category: FactFindingCategory | null; facts: SubjectFacts; eventDate: string | null }): GroupCoverResult {
  const out: GroupCoverResult = { cards: [], citations: [], documents: [], sentence: null };
  const employers: string[] = [];
  for (const booklet of args.booklets) {
    const period = bookletPeriodFit(booklet, args.eventDate);
    if (period === "outside") continue;
    const rows = groupRowsForEvent(booklet, args.person.id, args.category, args.facts);
    if (!rows.length) continue;
    const who = booklet.employer ?? booklet.productName;
    const byPage = new Map<number | null, string[]>();
    for (const r of rows) byPage.set(r.page, [...(byPage.get(r.page) ?? []), plainName(r.benefitName)]);
    const parts = [...byPage].map(([page, names]) => list([...new Set(names)]) + (page ? " (page " + page + ")" : ""));
    const dependant = booklet.employeeId !== args.person.id;
    const employee = booklet.employeeName ?? "the employee";
    const column = dependant ? " for enrolled dependants" : booklet.memberTier ? " for " + booklet.memberTier.replace(/\s*\(.*\)$/, "") + " staff" : "";
    const caveat = dependant
      ? "Group benefits depend on the employer’s plan, whether " + employee + " was still employed and " + args.person.name + " was still enrolled as a dependant; check with HR or the insurer."
      : "Group benefits depend on the employer’s plan and whether " + args.person.name + " was still employed on the date of the event; check with HR or the insurer.";
    out.cards.push({
      title: "Possible cover through " + who, status: "potentially_applicable", amountText: null,
      reason: "The " + booklet.productName + " booklet lists " + list(parts) + column + ". " + caveat,
      conditions: ["Booklet amounts are for the whole scheme, not confirmed figures for " + args.person.name + "; the employer’s records and the insurer’s master policy decide.",
        ...(period === "unchecked" ? ["The booklet prints no start or end date for the scheme, so DearPolicy couldn’t check that " + (day(args.eventDate) ? "the event date" : "the event") + " falls within it — HR can confirm the scheme’s dates."] : [])],
      coverLabel: booklet.productName, coverKey: "group:" + booklet.policyId,
    });
    for (const page of new Set(rows.map((r) => r.page).filter((p): p is number => p != null)))
      out.citations.push({ chunkId: "group:" + booklet.policyId + ":" + page, policyId: booklet.policyId, policyName: booklet.productName, pageStart: page, pageEnd: page,
        documentRole: "benefit_guide", personalEvidence: false, evidenceLabel: "Group benefits booklet" });
    out.documents.push("Confirmation from " + who + " HR of " + (dependant ? employee + "’s employment and " + args.person.name + "’s enrolment as a dependant" : args.person.name + "’s employment") + " on the date of the event");
    employers.push(who);
  }
  if (employers.length) out.sentence = "There may also be cover through " + list([...new Set(employers)]) + "’s group plan — it is on its own card below, and HR or the insurer can confirm it.";
  return out;
}

/** Adds the group cover to a concluded claim answer: its own card(s), the
 * booklet page(s) as sources, one sentence in the summary and the HR
 * confirmation in the documents to send. */
export function applyGroupCover(answer: ChatAnswer, cover: GroupCoverResult) {
  if (!cover.cards.length) return false;
  answer.claimItems = [...answer.claimItems.filter((i) => !/^Possible cover through\b/.test(i.title)), ...cover.cards];
  for (const c of cover.citations) if (!answer.citations.some((x) => x.chunkId === c.chunkId)) answer.citations.push(c);
  // Round 13: a summary that already names the booklet as the possible benefit (a booklet read as a personal plan)
  // is not told about it a second time; its card below says the rest.
  const namesBooklet = cover.cards.some((c) => !!c.coverLabel && answer.summary.includes(c.coverLabel));
  if (cover.sentence && !namesBooklet && !answer.summary.includes(cover.sentence)) {
    // Said before the closing caveat ("This is not a promise of payment ...").
    const at = answer.summary.search(/\s(?:This is not a promise of payment|That is based on the documents uploaded)/);
    answer.summary = at > 0 ? answer.summary.slice(0, at) + " " + cover.sentence + answer.summary.slice(at) : answer.summary + " " + cover.sentence;
  }
  const line = answer.nextSteps.findIndex((s) => /^Send these documents for the claim:/.test(s));
  const extra = cover.documents.filter((d) => !answer.nextSteps.some((s) => s.includes(d)));
  if (extra.length) {
    if (line >= 0) answer.nextSteps[line] = answer.nextSteps[line].replace(/\.$/, "") + "; " + extra.join("; ") + ".";
    else answer.nextSteps.unshift("Send these documents for the claim: " + extra.join("; ") + ".");
  }
  if (answer.mode !== "fact_finding") answer.mode = "claim_assessment";
  return true;
}
