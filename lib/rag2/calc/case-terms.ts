/**
 * Reliable chat: which listed case of a percentage schedule the household's own words name -- decided by the SERVER.
 *
 * Everyday names of body parts are related to the anatomical names schedules print ("shin" = the tibia, "thigh bone" =
 * the femur) and to the region they belong to (the shin is part of the leg). Nothing else is inferred: no diagnosis, no
 * fracture type, no policy definition. Three outcomes are kept apart:
 *   - missing:   the words name no body part at all ("an injury") -- the household has not said which case;
 *   - ambiguous: a part that more than one listed case covers ("his leg" when the thigh and below the knee are listed);
 *   - unlisted:  a specific part that no listed case covers ("wrist" when no row lists a wrist) -- an answer, not a question.
 * A row is matched by the parts its label prints; a region in a label ("Leg") covers the parts within it ("shin"), and a
 * part in a label ("below the knee (tibia or fibula)") answers a question about its region only as one of several cases.
 */

type Part = { id: string; words: RegExp; within?: string };
/** Body parts, each with the everyday and anatomical words for it, and the region it belongs to. */
const PARTS: Part[] = [
  { id: "skull", words: /\b(?:skull|cranium|cranial)\b/ },
  { id: "face", words: /\b(?:face|facial|cheek ?bones?|zygoma\w*|nose|nasal)\b/ },
  { id: "jaw", words: /\b(?:jaw|jaws|jaw ?bones?|mandible|mandibular|maxilla)\b/ },
  { id: "neck", words: /\bneck\b/ },
  { id: "spine", words: /\b(?:spine|spinal|vertebra[el]?|vertebrae|back ?bone|backbone)\b/ },
  { id: "collarbone", words: /\b(?:collar ?bones?|clavicles?)\b/ },
  { id: "shoulder", words: /\b(?:shoulders?|shoulder ?blades?|scapulae?)\b/ },
  { id: "rib", words: /\b(?:ribs?|rib ?cage)\b/ },
  { id: "sternum", words: /\b(?:breast ?bone|sternum)\b/ },
  { id: "pelvis", words: /\b(?:pelvis|pelvic)\b/ },
  { id: "hip", words: /\bhips?\b/ },
  { id: "arm", words: /\barms?\b/ },
  { id: "upper_arm", words: /\b(?:upper arm|humerus)\b/, within: "arm" },
  { id: "elbow", words: /\belbows?\b/, within: "arm" },
  { id: "forearm", words: /\b(?:forearm|radius|ulna)\b/, within: "arm" },
  { id: "wrist", words: /\b(?:wrists?|carpals?|scaphoid)\b/ },
  { id: "hand", words: /\b(?:hands?|metacarpals?)\b/ },
  { id: "finger", words: /\b(?:fingers?|thumbs?|phalang\w*)\b/ },
  { id: "leg", words: /\blegs?\b/ },
  { id: "thigh", words: /\b(?:thigh(?: ?bone)?s?|femur|femoral|above the knee)\b/, within: "leg" },
  { id: "knee", words: /\b(?:knee ?caps?|patella|knees?)\b/, within: "leg" },
  { id: "lower_leg", words: /\b(?:shin(?: ?bone)?s?|tibia[l]?|fibula|calf(?: ?bone)?|lower leg|below the knee)\b/, within: "leg" },
  { id: "ankle", words: /\bankles?\b/ },
  { id: "foot", words: /\b(?:feet|foot|heels?|calcaneus|metatarsals?)\b/ },
  { id: "toe", words: /\btoes?\b/ },
];
const byId = new Map(PARTS.map((p) => [p.id, p]));

/** The body parts the words name ("below the knee" is the lower leg, not the knee). */
export function partsIn(text: string): string[] {
  let t = ` ${text.toLowerCase().replace(/[’']/g, "'")} `;
  const found: string[] = [];
  // a phrase naming one part by another's position is read first, then removed
  for (const [re, id] of [[/\bbelow the knee\b/g, "lower_leg"], [/\babove the knee\b/g, "thigh"]] as [RegExp, string][]) if (re.test(t)) { found.push(id); t = t.replace(re, " "); }
  for (const p of PARTS) if (p.words.test(t)) found.push(p.id);
  return [...new Set(found)];
}
const regionOf = (id: string) => byId.get(id)?.within ?? null;

export type CaseRow = { id: string; label: string };
export type CaseChoice =
  | { kind: "row"; row: CaseRow; parts: string[] }
  | { kind: "ambiguous"; rows: CaseRow[]; parts: string[] }
  | { kind: "unlisted"; parts: string[] }
  | { kind: "missing" };

/** The items a label lists ("Jaw, Pelvis, Leg^, Ankle or Knee" -> five; "Leg - thigh bone (femur)" -> one). */
const itemsOf = (label: string) => label.split(/,|;|\/|\bor\b|\band\b/i).map((x) => x.trim()).filter(Boolean);

/** The listed cases the household's words name. */
export function caseFor(rows: CaseRow[], words: string): CaseChoice {
  const want = partsIn(words);
  if (!want.length) return { kind: "missing" };
  const rowInfo = rows.map((r) => ({ row: r, parts: partsIn(r.label), items: itemsOf(r.label).map(partsIn) }));
  let candidates: CaseRow[] | null = null;
  let choose = false;
  for (const p of want) {
    // 1. a row printing the part itself
    const exact = rowInfo.filter((x) => x.parts.includes(p)).map((x) => x.row);
    // 2. a row listing the region it belongs to as an item of its own (the shin under "Jaw, Pelvis, Leg, Ankle or Knee";
    //    not under "Leg - thigh bone (femur)", whose leg is the thigh)
    const region = regionOf(p);
    const general = region ? rowInfo.filter((x) => x.items.some((it) => it.includes(region) && !it.some((q) => regionOf(q) === region))).map((x) => x.row) : [];
    // 3. for a region, every row printing a part within it: the household chooses which
    const within = rowInfo.filter((x) => x.parts.some((q) => regionOf(q) === p)).map((x) => x.row);
    const these = exact.length ? exact : general.length ? general : within;
    if (!these.length) continue;
    if (!exact.length && !general.length) choose = true;
    const kept: CaseRow[] = candidates ? candidates.filter((r) => these.includes(r)) : these;
    candidates = kept.length ? kept : candidates;
  }
  if (!candidates || !candidates.length) return { kind: "unlisted", parts: want };
  const distinct = [...new Map(candidates.map((r) => [r.id, r])).values()];
  return distinct.length === 1 && !choose ? { kind: "row", row: distinct[0], parts: want } : { kind: "ambiguous", rows: distinct, parts: want };
}

/** Whether a chosen row is consistent with what the household reported (all of their recorded words together): the row
 * is the case those words name, or one of the cases they leave open. A part no row covers is not consistent with any row. */
export function rowConsistent(rows: CaseRow[], row: CaseRow, reportedWords: string[]): { ok: true } | { ok: false; parts: string[] } {
  const c = caseFor(rows, reportedWords.join(" ; "));
  if (c.kind === "missing") return { ok: true };
  if (c.kind === "row" && c.row.id === row.id) return { ok: true };
  if (c.kind === "ambiguous" && c.rows.some((r) => r.id === row.id)) return { ok: true };
  return { ok: false, parts: c.parts };
}
/** A plain name for a part (used in messages). */
export function partLabel(id: string): string {
  return ({ upper_arm: "upper arm", lower_leg: "lower leg (shin)" } as Record<string, string>)[id] ?? id;
}
