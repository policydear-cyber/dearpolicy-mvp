/** Kinds of cover, in the order a person thinks about them; each Coverage event belongs to one. Used by Coverage (rows
 * grouped by kind, main kinds not found) and Family (what each person is covered for, at a glance). A kind's label names
 * only what its events are, so a single death benefit is "Death", never "Life and disability". */
export const COVER_KINDS: { id: string; label: string; gapLabel?: string; events: string[]; core?: boolean }[] = [
  { id: "death", label: "Death", gapLabel: "death cover", core: true, events: ["death", "terminal_illness"] },
  { id: "disability", label: "Disability", events: ["tpd", "long_term_care", "disability_income"] },
  { id: "ci", label: "Critical illness", gapLabel: "critical illness", core: true, events: ["critical_illness", "early_critical_illness"] },
  { id: "hospital", label: "Hospital and medical", gapLabel: "hospital or medical cover", core: true, events: ["hospital_daily_cash", "icu_daily_cash", "surgery", "hospital_medical_expense", "ambulance"] },
  { id: "accident", label: "Accidents and injuries", gapLabel: "accident cover", core: true, events: ["accidental_death", "fracture", "dismemberment", "accidental_disablement", "accident_medical_expense"] },
  { id: "travel", label: "Travel", events: ["travel_delay", "trip_cancellation", "baggage", "travel_medical"] },
  { id: "property", label: "Home and vehicle", events: ["motor_damage", "home_damage"] },
  { id: "other", label: "Other", events: [] },
];
export const coverKindOf = (eventType: string) => COVER_KINDS.find((k) => k.events.includes(eventType)) ?? COVER_KINDS[COVER_KINDS.length - 1];

/** A benefit's own name, sorted into a kind: for Coverage rows typed "other" and for benefits found only on Benefits.
 * Accident words come first, so "accident medical expenses" stays under Accidents and injuries. */
const NAME_KINDS: [RegExp, string][] = [
  [/accident|fractur|dismember|injur|burns?\b/i, "accident"],
  [/critical illness|cancer|dread disease|heart attack|stroke/i, "ci"],
  [/hospital|surg|\bward|\bicu\b|intensive care|in-?patient|out-?patient|medical|ambulance|clinic|daily cash/i, "hospital"],
  [/disab|\btpd\b|long[- ]term care|careshield|eldershield/i, "disability"],
  [/death|funeral|terminal|\blife\b/i, "death"],
  [/travel|trip|baggage|flight/i, "travel"],
  [/motor|vehicle|\bcar\b|home|contents/i, "property"],
];
export const kindOfName = (name: string) => {
  const id = NAME_KINDS.find(([re]) => re.test(name))?.[1];
  return COVER_KINDS.find((k) => k.id === id) ?? COVER_KINDS[COVER_KINDS.length - 1];
};

/** The parts of a Coverage row (GET /api/ledger) these helpers read. */
export type KindRow = { eventType: string; eventLabel?: string | null; detail?: string | null; origin?: string; status?: string };
export const kindOfRow = (row: KindRow) => row.eventType === "other" ? kindOfName(`${row.eventLabel ?? ""} ${row.detail ?? ""}`) : coverKindOf(row.eventType);
/** A row the household's documents have not confirmed: a schedule line's usual benefits for a plan of its kind, still
 * proposed. Only a confirmed row, the policy wording or the household's own entry says something is covered. */
export const isToConfirm = (row: KindRow) => !!row.status && row.status !== "confirmed" && row.origin !== "wording" && row.origin !== "person";

/** A main kind that is missing but has a narrower, related benefit under another kind: not listed as missing. */
const RELATED: { kind: string; event: string; note: string }[] = [
  { kind: "death", event: "accidental_death", note: "For death, only accidental death was found (under Accidents and injuries)." },
  { kind: "hospital", event: "accident_medical_expense", note: "For medical costs, only accident medical expenses were found (under Accidents and injuries)." },
];

/** The main kinds of cover not found for one person (in plain words), and a note for each that is only partly found.
 * `alsoFound` adds kinds found elsewhere, such as benefits listed only on Benefits. */
export function coverGaps(rows: KindRow[], alsoFound: string[] = []): { missing: string[]; notes: string[] } {
  const found = new Set([...rows.map((r) => kindOfRow(r).id), ...alsoFound]);
  const events = rows.map((r) => r.eventType);
  const missing: string[] = [], notes: string[] = [];
  for (const k of COVER_KINDS) {
    if (!k.core || found.has(k.id)) continue;
    const related = RELATED.find((r) => r.kind === k.id && events.includes(r.event));
    if (related) notes.push(related.note); else missing.push(k.gapLabel ?? k.label.toLowerCase());
  }
  return { missing, notes };
}

/** "a", "a and b", "a, b and c". */
export const listOf = (items: string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
