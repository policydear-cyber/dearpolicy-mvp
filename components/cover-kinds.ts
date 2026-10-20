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

/** A main kind that is missing but has a narrower, related benefit under another kind: not listed as missing. */
const RELATED: { kind: string; event: string; note: string }[] = [
  { kind: "death", event: "accidental_death", note: "For death, only accidental death was found (under Accidents and injuries)." },
  { kind: "hospital", event: "accident_medical_expense", note: "For medical costs, only accident medical expenses were found (under Accidents and injuries)." },
];

/** The main kinds of cover not found for one person (in plain words), and a note for each that is only partly found. */
export function coverGaps(eventTypes: string[]): { missing: string[]; notes: string[] } {
  const found = new Set(eventTypes.map((e) => coverKindOf(e).id));
  const missing: string[] = [], notes: string[] = [];
  for (const k of COVER_KINDS) {
    if (!k.core || found.has(k.id)) continue;
    const related = RELATED.find((r) => r.kind === k.id && eventTypes.includes(r.event));
    if (related) notes.push(related.note); else missing.push(k.gapLabel ?? k.label.toLowerCase());
  }
  return { missing, notes };
}

/** "a", "a and b", "a, b and c". */
export const listOf = (items: string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
