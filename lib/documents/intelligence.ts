import type { PdfPage } from "@/lib/documents/pdf";
import type { PolicyExtraction } from "@/lib/ai/extract-policy";
import { NON_COVER_ROLES, correspondenceRole, schedulePage, statusNotice, statusNoticeRole } from "@/lib/documents/messy";

export const PERSONAL_AUTHORITY_ROLES = new Set([
  "personal_schedule",
  "certificate",
  "endorsement",
  "renewal_statement",
  "premium_receipt",
  "annual_statement",
]);

export const REFERENCE_ROLES = new Set([
  "policy_wording",
  "product_summary",
  "benefit_guide",
  "brochure",
  "policy_illustration",
  "claim_form",
  "welcome_letter",
]);

const GENERIC_PERSON_TERMS = [
  /^insured\s+(member|person|spouse|child(?:ren)?|dependant)$/i,
  /^member$/i,
  /^affiliate member$/i,
  /^policy ?holder$/i,
  /^applicant$/i,
  /^spouse$/i,
  /^child(?:ren)?$/i,
  /^dependant$/i,
  /^life assured$/i,
  /^insured$/i,
  /^you$/i,
  /^your$/i,
];

export function looksLikeActualPersonName(value: string) {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length < 4 || name.length > 90) return false;
  if (GENERIC_PERSON_TERMS.some((pattern) => pattern.test(name))) return false;
  if (/\b(insured|member|spouse|child|children|dependant|policyholder|applicant|affiliate|coverage|benefit|scheme|policy)\b/i.test(name)) return false;
  if (/\d{3,}/.test(name)) return false;
  const words = name.split(/[ ,]+/).filter(Boolean);
  if (words.length < 2) return false;
  return words.some((w) => /^[A-Za-z][A-Za-z.'-]{1,}$/.test(w));
}

function fullText(pages: PdfPage[], maxPages = 8) {
  return pages.slice(0, maxPages).map((p) => p.text).join("\n");
}

/** A personal document by its own title: a renewal certificate or a policy
 * contract / information page that names a policy number and the person it
 * covers. Such a document is never reference material, whatever else it
 * quotes (an extract of the provisions, "LIA 2019 definitions"). Returns the
 * role, or null. */
export function personalDocumentTitle(text: string): "certificate" | "personal_schedule" | null {
  const t = text.toLowerCase();
  const personal = /\bpolicy\s+(?:number|no\.?)\b/.test(t)
    && /\b(?:life\s+assured|insured\s+person|name\s+of\s+(?:the\s+)?insured|policyholder|policy\s+owner|particulars\s+of\s+insured|sum\s+assured|sum\s+insured)\b/.test(t);
  if (!personal) return null;
  if (/\bcertificate\s+of\s+renewal\b|\brenewal\s+certificate\b/.test(t)) return "certificate";
  if (/\bpolicy\s+contract\b|\bpolicy\s+information\s+page\b/.test(t)) return "personal_schedule";
  // A personal summary ("Your travel insurance summary") prints the policy's own number (not a group scheme's) and the
  // person it is for ("Your name : Lim Wei Jie"), not just the words.
  if (/\b(?:insurance|policy)\s+summary\b/.test(t)
    && /(?<!(?:group|master)\s)\bpolicy\s+(?:number|no\.?)\s*[:#-]?\s*[a-z0-9-]*\d[a-z0-9-]{3,}/.test(t)
    && new RegExp(String.raw`\b(?:policy ?holder|policy owner|insured person|life assured|your name|name of (?:the )?insured)\b[^\n:]{0,20}:[ \t]*` + PERSON_VALUE).test(t)) return "personal_schedule";
  return null;
}

/** A printed person's name after a label ("Life Assured: Lim Wei Jie"), not a definition ("any eligible employee",
 * "the person named in Part 1"). Lower-case text. */
const PERSON_VALUE = String.raw`(?!(?:any|the|a|an|all|each|every|eligible|means|refers|see|as)\b)[a-z][a-z.'-]+[ \t,]+[a-z]`;
const NAMED_PERSON = new RegExp(String.raw`\b(?:life assured|insured member|insured person)\s*:[ \t]*` + PERSON_VALUE);

/** Part 1 of a certificate: who is insured and for how much, in any of the ways a certificate prints it. */
function partOneParticulars(text: string) {
  if (/particulars of insured|insured person'?s? name|name of (?:the )?insured/.test(text)) return true;
  // A sum assured counts only beside a named person: a plan table in Part 2 prints sums too.
  if (NAMED_PERSON.test(text)) return true;
  // A name line with an amount and the date it took effect ("Lim Wei Jie  S$500,000  As of 01/02/2023").
  return text.split("\n").some((line) => /(?:s\$|sgd)\s?\d[\d,]{3,}/.test(line) && /\bas of \d|effective date\s*:?\s*\d/.test(line));
}

export function deterministicDocumentRole(pages: PdfPage[], modelRole: PolicyExtraction["documentRole"]) {
  // Round 10: a letter, claim decision, bill, app screenshot or the family's own
  // notes, by what it prints -- before any keyword it quotes ("policy wording").
  const correspondence = correspondenceRole(pages);
  if (correspondence) return correspondence;
  const text = fullText(pages).toLowerCase();
  // A lapse notice, premium reminder, reinstatement, renewal notice or receipt that says "refer to your policy schedule"
  // or "keep with your certificate of insurance" is that notice, never the schedule or certificate it mentions.
  if (statusNotice(pages)) return statusNoticeRole(pages);
  if (/product summaries|product summary/.test(text) && /refer to your certificate of insurance/.test(text)) return "product_summary" as const;
  // Part 2 of a group certificate ("Highlights of Cover") is the scheme's generic terms for every member: without Part 1's
  // particulars of the insured it is a benefits guide, even though it says "certificate of insurance" and "insured person".
  const partTwoOnly = /certificate of insurance part 2|part 2:\s*highlights of cover/.test(text) && !partOneParticulars(text);
  if (partTwoOnly) return "benefit_guide" as const;
  if (/certificate of (group )?insurance/.test(text) && (/(sum assured|effective date|particulars of insured|insured person)/.test(text) || partOneParticulars(text))) return "certificate" as const;
  const titled = personalDocumentTitle(fullText(pages, 2));
  if (titled) return titled;
  if (/certificate of insurance part 2|part 2:\s*highlights of cover/.test(text)) return "benefit_guide" as const;
  // Round 7: an endorsement says it is one in its title ("ENDORSEMENT NO. 2",
  // "Policy alteration") and usually tells the reader to keep it "with the
  // policy schedule" -- which must not make it the schedule itself.
  const opening = fullText(pages, 1).toLowerCase().split(/\n/).slice(0, 8).join("\n");
  if (/\bendorsement\s+(?:no\.?|number)\s*\d|^\s*endorsement\b|\bpolicy alteration\b|\balteration (?:of|to) (?:the )?policy\b|\bpolicy amendment\b|\bamendment to (?:the )?policy\b/m.test(opening) && /(policy number|effective date|insured|life assured)/.test(text)) return "endorsement" as const;
  if (/policy schedule|schedule of insurance/.test(text) && /(policy number|sum assured|premium|insured)/.test(text)) return "personal_schedule" as const;
  // A policy pack (cover letter, then "SCHEDULE PAGE" with the policy number and the life insured, then the contract and
  // its endorsement clauses) is the policy: the word "endorsement" in its wording does not make it one.
  if (schedulePage(pages) != null) return "personal_schedule" as const;
  // A document whose own title line is "Policy wording" is the wording, whatever endorsements it describes; an
  // endorsement that only cites "the policy wording" is not.
  if (/^\s*policy wording\s*$/m.test(opening) && !/\bthis endorsement\b/.test(opening)) return "policy_wording" as const;
  if (/endorsement|policy amendment|amendment to policy/.test(text) && /(policy number|effective date|insured)/.test(text)) return "endorsement" as const;
  if (/renewal notice|renewal statement|renewal premium/.test(text)) return "renewal_statement" as const;
  if (/premium receipt|official receipt|payment receipt/.test(text) && /(premium|policy)/.test(text)) return "premium_receipt" as const;
  if (/annual statement/.test(text) && /(policy|premium|value)/.test(text)) return "annual_statement" as const;
  if (/benefit summary|highlights of cover/.test(text) && !/particulars of insured/.test(text)) return "benefit_guide" as const;
  if (/policy wording|terms and conditions|definitions/.test(text) && !/(certificate of insurance|policy schedule)/.test(text)) return "policy_wording" as const;
  return modelRole;
}


function deriveReferenceCoverages(pages: PdfPage[]) {
  const found: { category: string; productName: string | null; notes: string | null; sourcePage: number | null }[] = [];
  // Detect per page, not on the whole document joined into one string --
  // joining pages loses which page each product's own section is actually
  // on, which is exactly the page number the chat later needs to bind a
  // quoted clause to the right product in a multi-product document. The
  // first page a term appears on is the best available signal without a
  // second AI pass; it is a page number to try, not an assertion, so
  // nothing downstream trusts it without also matching that same page.
  const add = (category: string, productName: string, sourcePage: number) => { if (!found.some((x) => x.category === category && x.productName === productName)) found.push({ category, productName, notes: "Detected in reference document", sourcePage }); };
  for (const page of pages) {
    const text = page.text.toLowerCase();
    if (/group term life|term life/.test(text)) { add("Death", "Group Term Life", page.pageNumber); add("Total Permanent Disability", "Group Term Life", page.pageNumber); if (/daily hospital cash|hospital cash benefit/.test(text)) add("Hospital Cash", "Group Term Life", page.pageNumber); }
    if (/group personal accident|personal accident/.test(text)) add("Personal Accident", "Group Personal Accident", page.pageNumber);
    if (/living care plus/.test(text)) add("Early Critical Illness", "Living Care Plus", page.pageNumber);
    if (/living care(?! plus)/.test(text)) add("Critical Illness", "Living Care", page.pageNumber);
    if (/disability income/.test(text)) add("Disability Income", "Disability Income", page.pageNumber);
    if (/outpatient medicare|outpatient/.test(text)) add("Outpatient", "Outpatient Medicare", page.pageNumber);
    if (/hospitalisation|hospitalization|integrated shield|medishield/.test(text)) add("Hospitalisation", "Hospitalisation", page.pageNumber);
  }
  return found;
}

/** The enrolment statements of a group booklet or benefits guide: the
 * sentences that say who is enrolled, lower-cased with whitespace collapsed.
 * Empty for plain reference wording. */
export function enrolledNames(text: string): string[] {
  const flat = text.replace(/\s+/g, " ");
  const out: string[] = [];
  // Round 7: also "Employee: LIM KOK WEI" and an enrolment table under a
  // heading ("DEPENDANTS ENROLLED UNDER GROUP HOSPITAL & SURGICAL (GHS)").
  const pattern = /\b(?:eligible\s+employee|insured\s+employee|employee(?:\s+name)?|member\s+name|dependants?\s+enrolled|enrolled\s+dependants?|covered\s+(?:members?|dependants?)|insured\s+(?:members?|dependants?))\s*(?:[:\-]|\bunder\b)[^.]{3,400}/gi;
  for (const match of flat.matchAll(pattern)) out.push(match[0].toLowerCase());
  return out;
}

/** `rolePages`: every page of the document, when some of `pages` were left out because they could not be checked.
 * What kind of document it is follows from all of its pages (a schedule whose particulars page could not be checked is
 * still the schedule, never the wording its benefit tables and exclusions look like on their own); which facts are kept
 * follows only from the pages given. */
export function sanitizePolicyExtraction(raw: PolicyExtraction, pages: PdfPage[], rolePages: PdfPage[] = pages): PolicyExtraction {
  const notes = [...raw.documentNotes];
  const joined = pages.slice(0, 8).map((p) => p.text).join("\n");
  let role = deterministicDocumentRole(rolePages, raw.documentRole);
  // Round 10: letters, claim decisions, bills, app screenshots and the family's
  // own notes are never cover: the people they name are kept (so the paper is
  // filed with them), every amount, premium, payment and benefit is not.
  if (role && NON_COVER_ROLES.has(role)) return nonCoverExtraction(raw, role, pages);
  // Keyword rules never downgrade a reading that confirmed personal coverage
  // and named the insured people, when those names are printed in the
  // document itself: a renewal certificate that quotes "definitions" is still
  // the person's certificate.
  const flat = joined.replace(/\s+/g, " ").toLowerCase();
  const namedAndPrinted = raw.insuredPeople.filter((p) => looksLikeActualPersonName(p.name) && flat.includes(p.name.trim().replace(/\s+/g, " ").toLowerCase()));
  if (role && REFERENCE_ROLES.has(role) && raw.documentRole && PERSONAL_AUTHORITY_ROLES.has(raw.documentRole)
      && raw.personalCoverageConfirmed && namedAndPrinted.length > 0) {
    notes.push("Kept the reading of this document as a " + raw.documentRole.replace(/_/g, " ") + ": it names the insured people and confirms their cover, so a keyword match for " + role.replace(/_/g, " ") + " did not override it.");
    role = raw.documentRole;
  }
  const groupPolicyNumber = raw.groupPolicyNumber ?? joined.match(/group\s+policy\s+(?:no\.?|number)\s*[:#-]?\s*([A-Z0-9-]{4,})/i)?.[1] ?? null;
  let people = raw.insuredPeople
    .filter((p) => looksLikeActualPersonName(p.name))
    .map((p) => ({ ...p, name: p.name.trim().replace(/\s+/g, " ") }));

  if (people.length !== raw.insuredPeople.length) {
    notes.push("Generic insurance role labels were removed from detected people.");
  }
  // Round 10: someone printed only as a named driver, a nominee, a beneficiary or the agent is not who the
  // policy covers when the document prints its policyholder or insured person: a reading that says so is not kept.
  {
    const lines = joined.split("\n").map((l) => l.replace(/\s+/g, " ").trim().toLowerCase());
    const SECONDARY = /^(?:named drivers?|additional drivers?|authori[sz]ed drivers?|nominees?|nomination|beneficiar(?:y|ies)|trustees?|(?:servicing |your )?agent|(?:financial )?advis[eo]r|payee|witness)\b/;
    const PRIMARY = /^(?:policy ?holder|policy owner|proposer|(?:the )?insured(?: person| persons| name)?|life assured|name of (?:the )?insured)\b/;
    const onlySecondary = (name: string) => { const n = name.toLowerCase(); const naming = lines.filter((l) => l.includes(n)); return naming.length > 0 && naming.every((l) => SECONDARY.test(l)); };
    if (lines.some((l) => PRIMARY.test(l))) {
      const kept = people.filter((p) => !onlySecondary(p.name));
      if (kept.length !== people.length) {
        notes.push("Not kept as an insured person: " + people.filter((p) => onlySecondary(p.name)).map((p) => p.name).join(", ") + " (printed only as a named driver, nominee, beneficiary or agent, not as the policyholder or insured).");
        people = kept;
      }
    }
  }

  const roleIsReference = role ? REFERENCE_ROLES.has(role) : false;
  const explicitPersonalEvidence = people.length > 0 && PERSONAL_AUTHORITY_ROLES.has(role ?? "");
  const containsReferenceSections = /certificate of insurance\s*part\s*2|part\s*2\s*[:\-]?\s*(?:highlights|benefit)|highlights of cover|product summar(?:y|ies)/i.test(joined);

  // Reference documents explain products; they do not create family members or ownership links.
  // Round 5 exception: a group benefits booklet that prints who is ENROLLED
  // ("Eligible employee: Lim Wei Jie ... Dependants enrolled: spouse Tan Mei
  // Ling; child Lim Kai Ting") links those people by name matching, exactly as
  // a certificate does -- only names printed verbatim in such an enrolment
  // statement, and without confirming any personal cover amount.
  if (roleIsReference) {
    const enrolled = enrolledNames(joined);
    const kept = people.filter((p) => enrolled.some((line) => line.includes(p.name.toLowerCase())));
    if (kept.length) notes.push("Linked the people this booklet names as enrolled: " + kept.map((p) => p.name).join(", ") + ".");
    people = kept.map((p) => ({ ...p, coverages: [] }));
  }

  let personalCoverageConfirmed = Boolean(raw.personalCoverageConfirmed && explicitPersonalEvidence && !roleIsReference);
  if (raw.personalCoverageConfirmed && !personalCoverageConfirmed) {
    notes.push("Personal coverage was not accepted because the document does not provide sufficiently personalised ownership evidence.");
  }

  // A coverage without a source page is useful context but not strong enough for the confirmed dashboard.
  people = people.map((person) => ({
    ...person,
    coverages: person.coverages.map((coverage) => ({
      ...coverage,
      evidenceVerified: Boolean(coverage.sourcePage && coverage.evidenceText),
    })),
  }));

  // A combined certificate can prove ownership in Part 1 and contain generic
  // benefit wording in Part 2. Retain both evidence classes while keeping the
  // generic sections from creating any additional ownership.
  const hasReferenceMaterial = roleIsReference || containsReferenceSections;
  const deterministicRefs = hasReferenceMaterial ? deriveReferenceCoverages(pages) : [];
  const modelRefs = raw.referenceCoverages.length ? raw.referenceCoverages : (hasReferenceMaterial ? raw.productsMentioned.map((productName) => ({ category: productName, productName, notes: "Plan mentioned in reference document", sourcePage: null })) : []);
  const referenceCoverages = [...deterministicRefs];
  for (const item of modelRefs) if (!referenceCoverages.some((x) => x.category.toLowerCase() === item.category.toLowerCase() && (x.productName ?? "").toLowerCase() === (item.productName ?? "").toLowerCase())) referenceCoverages.push(item);

  return {
    ...raw,
    groupPolicyNumber,
    referenceCoverages,
    documentRole: role,
    documentNotes: [...new Set(notes)],
    personalCoverageConfirmed,
    insuredPeople: people,
  };
}

const NON_COVER_NOTES: Record<string, string> = {
  insurer_letter: "This is a letter from the insurer, not a policy: what it says is kept as the letter's own words, never as cover or as the premium being paid now.",
  claim_decision: "This is the insurer's decision on a claim, not a policy: the amounts in it are what was claimed and decided, never cover.",
  medical_bill: "This is a hospital or medical bill, not a policy: its amounts are charges, never cover.",
  app_screenshot: "This is a screenshot of the insurer's app, not a policy document: what it shows is a summary from the app, not confirmed by the policy schedule.",
  personal_notes: "These are the family's own notes, not a document from the insurer: nothing in them is used as a policy fact.",
};
function nonCoverExtraction(raw: PolicyExtraction, role: string, pages: PdfPage[]): PolicyExtraction {
  const text = pages.map((p) => p.text).join("\n").replace(/\s+/g, " ").toLowerCase();
  const people = raw.insuredPeople.filter((p) => looksLikeActualPersonName(p.name) && text.includes(p.name.trim().replace(/\s+/g, " ").toLowerCase()))
    .map((p) => ({ ...p, name: p.name.trim().replace(/\s+/g, " "), coverages: [] }));
  // A hospital is not an insurer; neither are the family's own notes.
  const insurer = role === "medical_bill" || role === "personal_notes" ? null : raw.insurer;
  return {
    ...raw,
    documentRole: role as PolicyExtraction["documentRole"],
    documentType: raw.documentType,
    documentNotes: [...new Set([...raw.documentNotes.filter((n) => !/^Read from a photo/i.test(n)), NON_COVER_NOTES[role]])],
    insurer,
    productName: role === "personal_notes" || role === "medical_bill" ? null : raw.productName,
    personalCoverageConfirmed: false,
    startDate: null,
    renewalOrExpiryDate: null,
    insuredPeople: people,
    referenceCoverages: [],
    premium: { amount: null, currency: null, frequency: null },
    paymentRecords: [],
    keyExclusions: [],
    waitingPeriods: [],
    deductiblesAndCoinsurance: [],
    riders: role === "insurer_letter" ? raw.riders : [],
  };
}
export { NON_COVER_ROLES };

/** The type a document keeps when it is read again (DC 5 Nov): the type its earlier reading gave it, unless the new
 * reading is personal proof of cover (a personal schedule, certificate or endorsement that confirms this household's
 * cover). A reader names the type afresh on every read and can name it differently for the same file (FWD re-read 5 Nov:
 * an endorsement re-typed as policy wording, so Home listed two policy wordings); a re-read changes the type only when
 * it now proves more. A first read (no earlier type) takes the reader's type; a re-read that names none keeps the earlier one. */
export function roleOnReread(earlier: PolicyExtraction["documentRole"] | string | null | undefined, next: PolicyExtraction["documentRole"], personalCoverageConfirmed: boolean): PolicyExtraction["documentRole"] {
  if (!earlier || earlier === next) return next;
  if (!next) return earlier as PolicyExtraction["documentRole"];
  if (documentAuthority(next, personalCoverageConfirmed).level >= 95) return next;
  return earlier as PolicyExtraction["documentRole"];
}

export function documentAuthority(role: PolicyExtraction["documentRole"], personalCoverageConfirmed: boolean) {
  if (role && NON_COVER_ROLES.has(role)) return { level: 20, label: role === "personal_notes" ? "Your own notes" : role === "app_screenshot" ? "App screenshot" : "Correspondence", kind: "correspondence" };
  if (personalCoverageConfirmed && role === "endorsement") return { level: 100, label: "Personal amendment", kind: "personal" };
  if (personalCoverageConfirmed && (role === "personal_schedule" || role === "certificate")) return { level: 95, label: "Personal proof", kind: "personal" };
  if (role === "renewal_statement" || role === "annual_statement" || role === "premium_receipt") return { level: 80, label: "Current account record", kind: "personal" };
  if (role === "policy_wording" || role === "rider") return { level: 60, label: "Contract wording", kind: "reference" };
  if (role === "product_summary" || role === "benefit_guide" || role === "policy_illustration") return { level: 40, label: "Reference information", kind: "reference" };
  return { level: 30, label: "Supporting document", kind: "reference" };
}
