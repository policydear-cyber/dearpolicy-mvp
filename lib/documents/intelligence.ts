import type { PdfPage } from "@/lib/documents/pdf";
import type { PolicyExtraction } from "@/lib/ai/extract-policy";

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

export function deterministicDocumentRole(pages: PdfPage[], modelRole: PolicyExtraction["documentRole"]) {
  const text = fullText(pages).toLowerCase();
  if (/product summaries|product summary/.test(text) && /refer to your certificate of insurance/.test(text)) return "product_summary" as const;
  if (/certificate of (group )?insurance/.test(text) && /(sum assured|effective date|particulars of insured|insured person)/.test(text)) return "certificate" as const;
  if (/certificate of insurance part 2|part 2:\s*highlights of cover/.test(text)) return "benefit_guide" as const;
  if (/policy schedule|schedule of insurance/.test(text) && /(policy number|sum assured|premium|insured)/.test(text)) return "personal_schedule" as const;
  if (/endorsement|policy amendment|amendment to policy/.test(text) && /(policy number|effective date|insured)/.test(text)) return "endorsement" as const;
  if (/renewal notice|renewal statement|renewal premium/.test(text)) return "renewal_statement" as const;
  if (/premium receipt|official receipt|payment receipt/.test(text) && /(premium|policy)/.test(text)) return "premium_receipt" as const;
  if (/annual statement/.test(text) && /(policy|premium|value)/.test(text)) return "annual_statement" as const;
  if (/benefit summary|highlights of cover/.test(text) && !/particulars of insured/.test(text)) return "benefit_guide" as const;
  if (/policy wording|terms and conditions|definitions/.test(text) && !/(certificate of insurance|policy schedule)/.test(text)) return "policy_wording" as const;
  return modelRole;
}


function deriveReferenceCoverages(pages: PdfPage[]) {
  const text = pages.map((p) => p.text).join("\n").toLowerCase();
  const found: { category: string; productName: string | null; notes: string | null; sourcePage: number | null }[] = [];
  const add = (category: string, productName: string) => { if (!found.some((x) => x.category === category && x.productName === productName)) found.push({ category, productName, notes: "Detected in reference document", sourcePage: null }); };
  if (/group term life|term life/.test(text)) { add("Death", "Group Term Life"); add("Total Permanent Disability", "Group Term Life"); if (/daily hospital cash|hospital cash benefit/.test(text)) add("Hospital Cash", "Group Term Life"); }
  if (/group personal accident|personal accident/.test(text)) add("Personal Accident", "Group Personal Accident");
  if (/living care plus/.test(text)) add("Early Critical Illness", "Living Care Plus");
  if (/living care(?! plus)/.test(text)) add("Critical Illness", "Living Care");
  if (/disability income/.test(text)) add("Disability Income", "Disability Income");
  if (/outpatient medicare|outpatient/.test(text)) add("Outpatient", "Outpatient Medicare");
  if (/hospitalisation|hospitalization|integrated shield|medishield/.test(text)) add("Hospitalisation", "Hospitalisation");
  return found;
}

export function sanitizePolicyExtraction(raw: PolicyExtraction, pages: PdfPage[]): PolicyExtraction {
  const role = deterministicDocumentRole(pages, raw.documentRole);
  const notes = [...raw.documentNotes];
  const joined = pages.slice(0, 8).map((p) => p.text).join("\n");
  const groupPolicyNumber = raw.groupPolicyNumber ?? joined.match(/group\s+policy\s+(?:no\.?|number)\s*[:#-]?\s*([A-Z0-9-]{4,})/i)?.[1] ?? null;
  let people = raw.insuredPeople
    .filter((p) => looksLikeActualPersonName(p.name))
    .map((p) => ({ ...p, name: p.name.trim().replace(/\s+/g, " ") }));

  if (people.length !== raw.insuredPeople.length) {
    notes.push("Generic insurance role labels were removed from detected people.");
  }

  const roleIsReference = role ? REFERENCE_ROLES.has(role) : false;
  const explicitPersonalEvidence = people.length > 0 && PERSONAL_AUTHORITY_ROLES.has(role ?? "");
  const containsReferenceSections = /certificate of insurance\s*part\s*2|part\s*2\s*[:\-]?\s*(?:highlights|benefit)|highlights of cover|product summar(?:y|ies)/i.test(joined);

  // Reference documents explain products; they do not create family members or ownership links.
  if (roleIsReference) {
    people = [];
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

export function documentAuthority(role: PolicyExtraction["documentRole"], personalCoverageConfirmed: boolean) {
  if (personalCoverageConfirmed && role === "endorsement") return { level: 100, label: "Personal amendment", kind: "personal" };
  if (personalCoverageConfirmed && (role === "personal_schedule" || role === "certificate")) return { level: 95, label: "Personal proof", kind: "personal" };
  if (role === "renewal_statement" || role === "annual_statement" || role === "premium_receipt") return { level: 80, label: "Current account record", kind: "personal" };
  if (role === "policy_wording" || role === "rider") return { level: 60, label: "Contract wording", kind: "reference" };
  if (role === "product_summary" || role === "benefit_guide" || role === "policy_illustration") return { level: 40, label: "Reference information", kind: "reference" };
  return { level: 30, label: "Supporting document", kind: "reference" };
}
