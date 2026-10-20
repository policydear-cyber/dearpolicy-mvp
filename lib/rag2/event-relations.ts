/**
 * Death-journey release: the ESTABLISHED relationships between an event a household describes, the benefit a section or
 * schedule is about, and the product a record belongs to. A shared word such as "leg" or "permanent" is never relevance
 * on its own: a fracture schedule is about fractures, a dismemberment schedule about the loss of limbs or senses, a death
 * benefit about death -- whatever body part the household's words share with a row of any of them.
 *
 * Families are read from the words a benefit/section is NAMED by (its label, heading or product), never from the
 * conditions printed under it: those are exactly the sentences that look alike across adjacent benefits.
 */
export type Family = "death" | "fracture" | "dismemberment" | "hospital";

const RULES: [Family, RegExp][] = [
  // (dismemberment first: "total and permanent disablement" is not a fracture, and "loss of ... leg" is not a death)
  ["dismemberment", /\b(?:dismember\w*|disablement|disabilit\w*|amputat\w*|paralys\w*|loss of (?:one |two |a |an |the |his |her )?(?:limbs?|legs?|arms?|hands?|feet|foot|eyes?|sight|hearing|speech|use)|lost (?:his|her|a|an|the|my|one|both)\s+(?:limbs?|legs?|arms?|hands?|feet|foot|eyes?|sight|hearing))\b/i],
  ["fracture", /\b(?:fractur\w*|broke|broken|break|breaks|cracked)\b/i],
  // (PR #57 follow-up, UX L2: "Repatriation of Mortal Remains" pays on a death; a medical repatriation of a living person does not)
  ["death", /\b(?:death|deaths|dies|die|died|dying|dead|deceased|funeral|passed away|passes away|killed|fatal\w*|term life|life (?:insurance|cover|benefit|assured)|bereavement|terminal illness|mortal remains|repatriation of (?:the )?remains|return(?:ing)? (?:of )?the remains)\b/i],
  ["hospital", /\b(?:hospital\w*|warded|admitted|inpatient|confinement|confined)\b/i],
];

export function familiesOf(text: string): Set<Family> {
  const t = String(text ?? "").replace(/\s+/g, " ");
  // a label that names both ("Death or Dismemberment") belongs to both; the first-listed rule does not hide the others
  return new Set(RULES.filter(([, re]) => re.test(t)).map(([f]) => f));
}
export const familiesIntersect = (a: ReadonlySet<Family>, b: ReadonlySet<Family>): boolean => [...a].some((f) => b.has(f));

/** The events a PRODUCT's sum insured is the base of (a certificate row "Group Personal Accident S$600,000" is the base of
 * its accidental-death, dismemberment and fracture schedules; a Term Life row pays on death). A product that is not listed
 * relates to no event through its name alone. */
const PRODUCT_COVERS: [RegExp, Family[]][] = [
  [/\bpersonal accident\b/i, ["death", "dismemberment", "fracture"]],
  [/\bterm life\b|\blife (?:insurance|cover)\b/i, ["death"]],
  [/\bhospital\w*\b/i, ["hospital"]],
];
export function productFamilies(product: string): Set<Family> {
  return new Set(PRODUCT_COVERS.filter(([re]) => re.test(product ?? "")).flatMap(([, f]) => f));
}

/** Words naming a part of the body: shared by schedules of different benefits, so never relevance on their own. */
export const BODY_WORDS = new Set(["leg", "legs", "arm", "arms", "hand", "hands", "foot", "feet", "toe", "toes", "finger", "fingers", "thumb", "palm", "hip", "knee", "ankle", "wrist", "elbow", "shoulder", "rib", "ribs", "skull", "spine", "neck", "jaw", "pelvis", "cheekbone", "eye", "eyes", "tibia", "fibula", "femur", "limb", "limbs"]);

/** Why a benefit family is not the event's, for the reason line of a disposition. */
export function familyName(f: Set<Family>): string { return [...f].join(" / ") || "unclassified"; }
