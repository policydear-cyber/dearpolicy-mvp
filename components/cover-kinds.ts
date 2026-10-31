import { personKinds } from "@/lib/coverage/table-figures";
import type { PlanType } from "@/lib/coverage/plan-type";
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
  // A plan whose own name or document says it is a savings or investment-linked plan (lib/coverage/plan-type.ts), as Home's tiles.
  { id: "savings", label: "Savings and investment", events: [] },
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

/** The parts of a benefit-table row and cover (GET /api/benefit-table) kindsOfTable reads. */
export type TableKindRow = { benefit: string; pays: string; product: string; cover: string; plan?: string | null; coverEnded?: string | null };
export type TableKindCover = { product: string; cover: string; plan?: string | null; riderOf?: string | null; ended?: string | null; planType?: PlanType | null;
  endDate?: string | null; documentPeriodTo?: string | null };
/** A cover's own name, sorted into a kind when it names one. Travel first: every row of a travel policy is travel cover
 * ("Rental Vehicle Excess" is not motor insurance); "Home and vehicle" only for a cover that is itself motor or home
 * insurance. A life plan is death cover only when it says so, or is a mortgage plan: "CPF LIFE" is an annuity (Critic R199). */
const COVER_NAME_KINDS: [RegExp, string][] = [
  [/\b(?:travel\w*|trip|holiday|journey)\b/i, "travel"],
  // A mortgage plan ("HomeProtect", "Mortgage Reducing Term") is death cover on the borrower, not home insurance (Critic R201-1).
  [/\bmortgage\b|\breducing\s+term\b|\bhome\s?protect\b|\bhome\s+protection\s+scheme\b|\bHPS\b/i, "death"],
  // Before motor and home: a "Public Vehicle Accident Plan" is accident cover (TE F12).
  [/accident|\bpa\b/i, "accident"],
  [/\bmotor\b|\bcar\b|\bvehicle\b|\bhome(?:shield|guard)?\b(?!\s*(?:care|nursing|health))|\bhousehold\b|\bfire\b/i, "property"],
  [/critical illness|\bci\b|cancer|dread disease|early crisis/i, "ci"],
  [/careshield|eldershield|disab|\btpd\b|long[- ]term care/i, "disability"],
  [/shield|hospital|medical|health|surg/i, "hospital"],
  [/\b(?:term|whole)\s+life\b|\blife\s+(?:insurance|assurance|cover|protection)\b|\bgroup\s+term\b/i, "death"],
];
const coverKindOfName = (name: string) => COVER_NAME_KINDS.find(([re]) => re.test(name))?.[1] ?? null;
/** A row that is only the premium ("Annual premium", "Premium payable"), never a premium waiver, which is cover (Critic R199-1). */
const PREMIUM_ONLY = /^(?:(?:annual|monthly|quarterly|half[- ]yearly|yearly|single|modal|total|basic|regular|instalment)\s+)?premiums?(?:\s+(?:payable|amount|paid|due|term))?$/i;
/** The kinds of cover a person's benefit table shows, for a household whose documents are read into the benefit table
 * (its Coverage rows are no longer read or refreshed, so they can be stale: 24 Oct, Family showed "Home and vehicle" for
 * a travel policy). The cover's own name decides first; a row's benefit name adds its kind (a term life's TPD row is
 * disability cover too), never "Home and vehicle" ("Home Nursing", "Home Modification" are not home insurance). A row
 * printed as not covered, a value and a premium are no cover. A cover with no row counted (its pages not linked yet) is
 * still cover: never "Nothing found" for a person who has one (Critic R199-2). Every policy on file is treated as in force:
 * a printed end date never takes a kind away (DC, 31 Oct). */
export function kindsOfTable(rows: TableKindRow[], covers: TableKindCover[] = []): string[] {
  const found = new Set<string>(), counted = new Set<string>();
  const ofCover = (product: string, cover: string) => coverKindOfName(`${product} ${cover}`);
  for (const r of rows) {
    // A value or the premium says nothing about the cover: its pages may not be linked yet (Critic R204-1). A cover whose
    // rows are all printed as not covered is no cover (TE P124-2).
    if (r.pays === "value" || PREMIUM_ONLY.test(r.benefit.trim())) continue;
    counted.add(`${r.product}\u0000${r.cover}`);
    if (r.pays === "not_covered") continue;
    const cover = ofCover(r.product, r.cover), benefit = kindOfName(r.benefit).id;
    if (cover) found.add(cover);
    if (cover === "travel") continue;
    if (benefit !== "other" && benefit !== "property") found.add(benefit);
    else if (!cover) found.add("other");
  }
  for (const c of covers) if (!counted.has(`${c.product}\u0000${c.cover}`)) found.add(ofCover(c.product, c.cover) ?? "other");
  // Whole-policy kinds by the rule Home's tiles use (personKinds): savings or investment from the plan type, travel from a
  // travel cover.
  const whole = personKinds(covers, rows);
  if (whole.get("Savings")?.current.length || whole.get("Investment")?.current.length) found.add("savings");
  if (whole.get("Travel")?.current.length) found.add("travel");
  return COVER_KINDS.filter((k) => found.has(k.id)).map((k) => k.label);
}


/** What each document was found to pay for (Documents page), for a household on the benefit table: the kinds of cover
 * (kindsOfTable, the rules Family uses) of the table rows read from that document, and of the covers printed in it. A
 * cover printed in a document also takes the person's rows of that same cover read from another document (a schedule
 * whose benefits were read from the separate wording: TE W1), matched by cover key, else product and cover name. Its
 * Coverage rows are no longer read or refreshed, so they are never used for it. A document with no table row or cover is
 * not listed: nothing is shown for it. */
type DocRow = TableKindRow & { coverKey?: string | null; source?: { documentId?: string | null } | null };
type DocCover = TableKindCover & { coverKey?: string | null; source?: { documentId?: string | null } | null };
export function documentTableKinds(people: { rows?: DocRow[]; covers?: DocCover[] }[]): Record<string, string[]> {
  const rows = new Map<string, Set<DocRow>>(), covers = new Map<string, TableKindCover[]>();
  const keyOf = (x: { coverKey?: string | null; product: string; cover: string }) => x.coverKey || `${x.product}\u0000${x.cover}`;
  for (const p of people) {
    for (const r of p.rows ?? []) { const id = r.source?.documentId; if (id) (rows.get(id) ?? rows.set(id, new Set()).get(id)!).add(r); }
    for (const c of p.covers ?? []) {
      const id = c.source?.documentId;
      if (!id) continue;
      (covers.get(id) ?? covers.set(id, []).get(id)!).push(c);
      const own = rows.get(id) ?? rows.set(id, new Set()).get(id)!;
      for (const r of p.rows ?? []) if (keyOf(r) === keyOf(c)) own.add(r);
    }
  }
  const out: Record<string, string[]> = {};
  for (const id of new Set([...rows.keys(), ...covers.keys()])) {
    const kinds = [...kindsOfTable([...(rows.get(id) ?? [])], covers.get(id) ?? [])];
    if (kinds.length) out[id] = kinds;
  }
  return out;
}

/** The parts of a Coverage row (GET /api/ledger) these helpers read. */
export type KindRow = { eventType: string; eventLabel?: string | null; detail?: string | null; origin?: string; status?: string };
export const kindOfRow = (row: KindRow) => row.eventType === "other" ? kindOfName(`${row.eventLabel ?? ""} ${row.detail ?? ""}`) : coverKindOf(row.eventType);
/** A row the household's documents have not confirmed: a schedule line's usual benefits for a plan of its kind, still
 * proposed. Only a confirmed row, the policy wording or the household's own entry says something is covered. */
export const isToConfirm = (row: KindRow) => !!row.status && row.status !== "confirmed" && row.origin !== "wording" && row.origin !== "person";

/** What each document was found to pay for (Documents page): Coverage row labels by document. Only what the documents
 * establish is listed: a row only a plan type suggests (isToConfirm) and a rejected row are never listed, because a
 * plan type or reference wording is not proof of cover. */
export function documentFoundLabels(rows: (KindRow & { policyId: string | null; eventLabel: string })[]): Record<string, string[]> {
  const byDoc: Record<string, string[]> = {};
  for (const r of rows) {
    if (!r.policyId || r.status === "rejected" || isToConfirm(r)) continue;
    if (!(byDoc[r.policyId] ??= []).includes(r.eventLabel)) byDoc[r.policyId].push(r.eventLabel);
  }
  return byDoc;
}

/** A main kind that is missing but has a narrower, related benefit under another kind: not listed as missing. */
const RELATED: { kind: string; event: string; note: string; guessNote: string }[] = [
  { kind: "death", event: "accidental_death", note: "For death, only accidental death was found (under Accidents and injuries).",
    guessNote: "For death, plans like this may include accidental death, but your documents don’t confirm it yet (under Accidents and injuries)." },
  { kind: "hospital", event: "accident_medical_expense", note: "For medical costs, only accident medical expenses were found (under Accidents and injuries).",
    guessNote: "For medical costs, plans like this may include accident medical expenses, but your documents don’t confirm it yet (under Accidents and injuries)." },
];

/** The main kinds of cover not found for one person (in plain words), and a note for each that is only partly found.
 * `alsoFound` adds kinds found elsewhere, such as benefits listed only on Benefits. */
export function coverGaps(rows: KindRow[], alsoFound: string[] = []): { missing: string[]; notes: string[] } {
  const found = new Set([...rows.map((r) => kindOfRow(r).id), ...alsoFound]);
  const missing: string[] = [], notes: string[] = [];
  for (const k of COVER_KINDS) {
    if (!k.core || found.has(k.id)) continue;
    const related = RELATED.find((r) => r.kind === k.id && rows.some((row) => row.eventType === r.event));
    // A related benefit seeded only from the plan type is not "found": say it may be there.
    if (!related) missing.push(k.gapLabel ?? k.label.toLowerCase());
    else notes.push(rows.some((row) => row.eventType === related.event && !isToConfirm(row)) ? related.note : related.guessNote);
  }
  return { missing, notes };
}

/** "a", "a and b", "a, b and c". */
export const listOf = (items: string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** A schedule's category of cover (policy_coverages.category, lib/insurance.ts COVERAGE_CATEGORIES), sorted into a kind.
 * Home's tiles read these lines; Family and Coverage use this so all three agree. A category not listed is sorted by its
 * own words (kindOfName), else "Other". */
const CATEGORY_KINDS: Record<string, string> = {
  hospitalisation: "hospital", "hospital cash": "hospital", outpatient: "hospital",
  death: "death",
  "critical illness": "ci", "early critical illness": "ci",
  "total permanent disability": "disability", "disability income": "disability", "long-term care": "disability",
  "personal accident": "accident",
  travel: "travel",
  home: "property", motor: "property",
  savings: "savings", investment: "savings",
};
export const kindOfCategory = (category: string) => {
  const id = CATEGORY_KINDS[category.trim().toLowerCase()];
  return COVER_KINDS.find((k) => k.id === id) ?? kindOfName(category);
};

/** A line of cover a schedule or certificate lists for a person (GET /api/ledger scheduleLines): confirmed and checked
 * against its page, the same lines Home's tiles count. */
/** `events`: the Coverage events the server would seed from this line (lib/ledger/events.ts PRODUCT_DEFAULTS), for a
 * category CATEGORY_EVENTS does not list ("Life Cover", any other printed wording). */
export type ScheduleLine = { familyMemberId: string; policyId: string; category: string; planName: string | null; insurer: string | null; sourcePage: number | null; events?: string[] | null };
/** The Coverage event(s) a schedule category itself is: the row the line would have become. A rejection of every one of
 * them is the household's word that this plan doesn't pay it (Critic M1 on #256); a rejection of a narrower row of the
 * same kind (a misread ICU cash row on a hospital plan) is not (TE F1 on #256). */
const CATEGORY_EVENTS: Record<string, string[]> = {
  hospitalisation: ["hospital_medical_expense"], "hospital cash": ["hospital_daily_cash"], outpatient: ["hospital_medical_expense"],
  death: ["death"], "critical illness": ["critical_illness"], "early critical illness": ["early_critical_illness"],
  "total permanent disability": ["tpd"], "disability income": ["disability_income"], "long-term care": ["long_term_care"],
  "personal accident": ["accidental_death"], travel: ["travel_delay", "trip_cancellation", "travel_medical", "baggage"],
  home: ["home_damage"], motor: ["motor_damage"], savings: ["maturity"], investment: ["maturity"],
};
/** The schedule lines Coverage rows don't already show. A line is left out when the same person has a Coverage row (not
 * rejected) of the same kind from the same policy, or has rejected, on that policy, every event the line's category
 * itself is (CATEGORY_EVENTS; for a category not listed there, the events the line would seed: TE F2 on #256). A line with no amount, or an amount with no stated currency, never becomes a Coverage
 * row (lib/ledger/store.ts scheduleSeeds), so without this a person Home lists as covered was called uncovered on Family
 * and Coverage (new-user walkthrough, 31 Oct). One line per person, policy and kind. */
export function scheduleOnlyLines<L extends ScheduleLine>(lines: L[], rows: (KindRow & { familyMemberId: string; policyId: string | null })[]): L[] {
  const at = (r: { familyMemberId: string; policyId: string | null }) => `${r.familyMemberId}\u0000${r.policyId}`;
  const shown = new Set(rows.filter((r) => r.status !== "rejected" && r.policyId).map((r) => `${at(r)}\u0000${kindOfRow(r).id}`));
  const rejected = new Set(rows.filter((r) => r.status === "rejected" && r.policyId).map((r) => `${at(r)}\u0000${r.eventType}`));
  const out: L[] = [];
  for (const l of lines) {
    const key = `${at(l)}\u0000${kindOfCategory(l.category).id}`;
    const own = CATEGORY_EVENTS[l.category.trim().toLowerCase()] ?? (l.events?.length ? l.events : undefined);
    if (shown.has(key) || (own && own.every((e) => rejected.has(`${at(l)}\u0000${e}`)))) continue;
    shown.add(key);
    out.push(l);
  }
  return out;
}

/** What Family lists for each person of a household on Coverage rows (GET /api/ledger): each kind found, "(to confirm)"
 * when only a plan type's usual benefit suggests it. A schedule line (scheduleLines), confirmed and checked against its
 * page, is cover as on Home, even when it prints no amount and so has no Coverage row. */
export function ledgerKindsByPerson(rows: (KindRow & { familyMemberId: string })[], lines: ScheduleLine[] = []): Record<string, string[]> {
  const by: Record<string, Map<string, boolean>> = {};
  for (const r of rows) if (r.status !== "rejected") {
    const kinds = by[r.familyMemberId] ??= new Map(), id = kindOfRow(r).id;
    kinds.set(id, kinds.get(id) === true || !isToConfirm(r));
  }
  for (const line of lines) (by[line.familyMemberId] ??= new Map()).set(kindOfCategory(line.category).id, true);
  return Object.fromEntries(Object.entries(by).map(([id, found]) => [id, COVER_KINDS.filter((k) => found.has(k.id)).map((k) => found.get(k.id) ? k.label : `${k.label} (to confirm)`)]));
}

/** One person on Coverage (a household on Coverage rows): the kinds of cover found, each with its rows and the schedule
 * lines no row shows, and the main kinds not found. A schedule line is cover (never "to confirm", never a gap), as on
 * Home and Family. `shown` are the rows drawn (an either/or pair once), `all` every row of the person. */
export function coveragePersonKinds<R extends KindRow, L extends ScheduleLine>(shown: R[], all: R[], lines: L[], alsoFound: string[] = []) {
  const kinds = COVER_KINDS.map((k) => ({ ...k, rows: shown.filter((r) => kindOfRow(r).id === k.id), lines: lines.filter((l) => kindOfCategory(l.category).id === k.id) }))
    .filter((k) => k.rows.length || k.lines.length).map((k) => ({ ...k, toConfirm: !k.lines.length && k.rows.every(isToConfirm) }));
  return { kinds, gaps: coverGaps(all, [...alsoFound, ...lines.map((l) => kindOfCategory(l.category).id)]), count: all.length + lines.length };
}
