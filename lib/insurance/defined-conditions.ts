/** What a critical-illness benefit is actually defined to pay for.
 *
 * This is a contract dictionary, not a medical one, and the distinction is the
 * whole point. Dengue is a serious illness -- a medical reference would say so,
 * and saying so is exactly what led DearPolicy to offer S$650,000 of critical
 * illness cover for it. A critical-illness benefit does not pay for severity.
 * It pays for a condition named in the policy's own schedule of definitions,
 * meeting that schedule's wording. Dengue is absent from those schedules, and
 * that absence, not its severity, is the answer.
 *
 * The baseline below is the Life Insurance Association Singapore's Critical
 * Illness Framework 2019, whose 37 standard definitions almost every Singapore
 * critical-illness policy adopts verbatim. It is a floor, not the truth: a
 * policy's own schedule always overrides it, and a policy may cover fewer of
 * these than the list contains. So a diagnosis matching a name here means "this
 * benefit may respond, read the wording" -- never "this pays". A diagnosis
 * matching nothing here is the useful direction: a condition that is not in the
 * standard list and not in the policy's own schedule is not a critical illness
 * under that contract, whatever it is medically.
 *
 * @see https://www.lia.org.sg/media/2160/mu5819-part-2-of-4-_lia-ci-framework-2019_lia-definitions-for-37-cis.pdf
 */

export type DefinedCondition = { name: string; matches: RegExp };

/** The LIA 2019 standard list, with the words a person actually uses for each.
 * The patterns are deliberately generous: the cost of matching a name here is
 * that the wording gets read, which is the correct next step anyway. */
export const LIA_2019_CRITICAL_ILLNESSES: DefinedCondition[] = [
  { name: "Major Cancer", matches: /\b(cancer|carcinoma|malignan\w*|sarcoma|lymphoma|leukaemia|leukemia|myeloma|melanoma|tumou?r)\b/i },
  { name: "Heart Attack of Specified Severity", matches: /\b(heart attack|myocardial infarction|\bMI\b)\b/i },
  { name: "Stroke with Permanent Neurological Deficit", matches: /\b(stroke|cerebrovascular accident|\bCVA\b|brain h?aemorrhage)\b/i },
  { name: "Coronary Artery By-pass Surgery", matches: /\b(bypass|by-pass|CABG)\b/i },
  { name: "End Stage Kidney Failure", matches: /\b(kidney failure|renal failure|end stage renal|dialysis)\b/i },
  { name: "Irreversible Aplastic Anaemia", matches: /\baplastic an(ae)?mia\b/i },
  { name: "End Stage Lung Disease", matches: /\b(end stage lung|respiratory failure|COPD)\b/i },
  { name: "End Stage Liver Failure", matches: /\b(liver failure|end stage liver|cirrhosis)\b/i },
  { name: "Coma", matches: /\bcoma(tose)?\b/i },
  { name: "Deafness (Irreversible Loss of Hearing)", matches: /\b(deaf(ness)?|loss of hearing|hearing loss)\b/i },
  { name: "Open Chest Heart Valve Surgery", matches: /\b(heart valve|valve (replacement|repair|surgery))\b/i },
  { name: "Irreversible Loss of Speech", matches: /\b(loss of speech|mute|aphasia)\b/i },
  { name: "Major Burns", matches: /\b(burns?|scald(ed|ing)?)\b/i },
  { name: "Major Organ / Bone Marrow Transplantation", matches: /\b(transplant\w*|bone marrow)\b/i },
  { name: "Multiple Sclerosis", matches: /\bmultiple sclerosis\b|\bMS\b/i },
  { name: "Muscular Dystrophy", matches: /\bmuscular dystrophy\b/i },
  { name: "Idiopathic Parkinson's Disease", matches: /\bparkinson'?s?\b/i },
  { name: "Open Chest Surgery to Aorta", matches: /\b(aorta|aortic (aneurysm|surgery|dissection))\b/i },
  { name: "Alzheimer's Disease / Severe Dementia", matches: /\b(alzheimer'?s?|dementia)\b/i },
  { name: "Fulminant Hepatitis", matches: /\bfulminant hepatitis\b/i },
  { name: "Motor Neurone Disease", matches: /\b(motor neuron[e]? disease|\bALS\b|lou gehrig)\b/i },
  { name: "Primary Pulmonary Hypertension", matches: /\bpulmonary hypertension\b/i },
  { name: "HIV Due to Blood Transfusion and Occupationally Acquired HIV", matches: /\bHIV\b|\bAIDS\b/i },
  { name: "Benign Brain Tumour", matches: /\b(benign brain tumou?r|meningioma)\b/i },
  { name: "Severe Encephalitis", matches: /\bencephalitis\b/i },
  { name: "Severe Bacterial Meningitis", matches: /\bmeningitis\b/i },
  { name: "Angioplasty & Other Invasive Treatment for Coronary Artery", matches: /\b(angioplasty|stent(ing)?)\b/i },
  { name: "Blindness (Irreversible Loss of Sight)", matches: /\b(blind(ness)?|loss of sight)\b/i },
  { name: "Major Head Trauma", matches: /\b(head (trauma|injury)|traumatic brain injury|\bTBI\b)\b/i },
  { name: "Paralysis (Irreversible Loss of Use of Limbs)", matches: /\b(paraly(sis|sed|zed)|paraplegi\w*|quadriplegi\w*|tetraplegi\w*)\b/i },
  { name: "Terminal Illness", matches: /\bterminal(ly)? ill\w*\b/i },
  { name: "Progressive Scleroderma", matches: /\bscleroderma\b/i },
  { name: "Persistent Vegetative State (Apallic Syndrome)", matches: /\b(vegetative state|apallic)\b/i },
  { name: "Systemic Lupus Erythematosus with Lupus Nephritis", matches: /\b(lupus|\bSLE\b)\b/i },
  { name: "Other Serious Coronary Artery Disease", matches: /\bcoronary artery disease\b/i },
  { name: "Poliomyelitis", matches: /\b(polio(myelitis)?)\b/i },
  { name: "Loss of Independent Existence", matches: /\bloss of independent existence\b/i },
];

/** Which defined conditions a reported diagnosis could be. Empty means the
 * diagnosis is not, on the standard list, a critical illness at all. */
export function definedConditionsFor(diagnosis: string): string[] {
  const text = (diagnosis ?? "").trim();
  if (!text) return [];
  return LIA_2019_CRITICAL_ILLNESSES.filter((condition) => condition.matches.test(text)).map((c) => c.name);
}

/** Whether a benefit pays on a named, defined condition rather than on an
 * event anyone can describe. A hospital cash benefit responds to an admission;
 * a critical-illness benefit responds only to a condition in its schedule, so
 * only this kind of benefit is subject to the check above. Detected from the
 * benefit's own name and quoted clause, so a plan that calls it "Living Care"
 * or "Crisis Cover" is caught by the clause even when the name gives nothing
 * away. */
export function paysOnDefinedCondition(text: string) {
  const value = (text ?? "").toLowerCase();
  if (/\b(critical illness|crisis cover|dread disease|defined condition)\b/.test(value)) return true;
  return LIA_2019_CRITICAL_ILLNESSES.some((condition) => condition.matches.test(value));
}

/** The policy's OWN schedule, when DearPolicy already holds it.
 *
 * The LIA list is a floor, and a floor has a cost: a plan that defines more
 * conditions than the standard 37 -- severe rheumatoid arthritis, diabetic
 * complications, an early-stage plan's own list -- would have its own named
 * condition refused because a national baseline does not mention it.
 *
 * Nothing new has to be read to fix most of that. When a critical-illness
 * plan's benefit table was catalogued at upload, its rows ARE its schedule of
 * defined conditions, stored already. So the diagnosis is checked against the
 * policy's own row names as well as against the standard list, and the policy
 * always wins: it is the contract.
 *
 * Matching is by containment of significant words in either direction, so
 * "Severe Rheumatoid Arthritis" answers "rheumatoid arthritis" and "Major
 * Cancer" answers "cancer", while nothing in the table answers "dengue". */
const SCHEDULE_STOPWORDS = new Set(["the","a","an","of","and","or","for","to","in","on","with","due","benefit","benefits",
  "cover","coverage","plan","policy","insured","sum","payment","payout","stage","stages","level","severity","specified",
  "group","critical","illness","illnesses","condition","conditions","early","advanced","intermediate","severe","major"]);
function significantWords(value: string) {
  return (value ?? "").toLowerCase().match(/[a-z][a-z-]{2,}/g)?.filter((word) => !SCHEDULE_STOPWORDS.has(word)) ?? [];
}
export function matchesPolicySchedule(diagnosis: string, conditionNames: string[]): string[] {
  const reported = significantWords(diagnosis);
  if (!reported.length) return [];
  const reportedSet = new Set(reported);
  return conditionNames.filter((name) => {
    const words = significantWords(name);
    if (!words.length) return false;
    const wordSet = new Set(words);
    return words.every((word) => reportedSet.has(word)) || reported.every((word) => wordSet.has(word));
  });
}
