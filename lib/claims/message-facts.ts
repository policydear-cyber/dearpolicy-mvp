/**
 * Facts a household states in its own words, read deterministically so the
 * interview never asks for what it was already told, and corrections
 * ("sorry, it was her right arm not left") change the stored fact.
 *
 * Only unambiguous phrases are read, and a fact already known is never
 * overwritten except by an explicit correction. Pure: returns what changed.
 */
import type { SubjectFacts } from "@/lib/chat/types";

const known = (facts: SubjectFacts, key: string) => facts[key]?.state === "known" ? facts[key].value : null;
const WORD_NUMBERS: Record<string, number> = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const HOSPITALS: [RegExp, string][] = [
  [/\bmount elizabeth novena\b/i, "Mount Elizabeth Novena Hospital"], [/\bmount elizabeth\b|\bmeh\b/i, "Mount Elizabeth Hospital"],
  [/\bgleneagles\b/i, "Gleneagles Hospital"], [/\braffles hospital\b/i, "Raffles Hospital"], [/\bmount alvernia\b/i, "Mount Alvernia Hospital"],
  [/\bfarrer park\b/i, "Farrer Park Hospital"], [/\bparkway east\b/i, "Parkway East Hospital"], [/\bthomson medical\b/i, "Thomson Medical Centre"],
  [/\bkkh\b|\bkk (?:women['’]?s and children['’]?s )?hospital\b/i, "KK Women's and Children's Hospital"],
  [/\bsgh\b|\bsingapore general hospital\b/i, "Singapore General Hospital"], [/\bttsh\b|\btan tock seng\b/i, "Tan Tock Seng Hospital"],
  [/\bnuh\b|\bnational university hospital\b/i, "National University Hospital"], [/\bcgh\b|\bchangi general\b/i, "Changi General Hospital"],
  [/\bktph\b|\bkhoo teck puat\b/i, "Khoo Teck Puat Hospital"], [/\bng teng fong\b/i, "Ng Teng Fong General Hospital"], [/\bsengkang general\b|\bskh\b/i, "Sengkang General Hospital"],
];
const BODY = "arm|leg|wrist|hand|ankle|foot|knee|elbow|shoulder|hip|finger|thumb|toe|collarbone|rib|eye|ear";

function addDays(iso: string, days: number) {
  const t = Date.parse(iso + "T00:00:00Z");
  return Number.isFinite(t) ? new Date(t + days * 86_400_000).toISOString().slice(0, 10) : null;
}
function nightsIn(text: string): number | null {
  const m = text.match(/\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a)\s+nights?\b/i);
  if (m) return /^\d/.test(m[1]) ? Number(m[1]) : WORD_NUMBERS[m[1].toLowerCase()] ?? null;
  return /\bovernight\b/i.test(text) ? 1 : null;
}

export type MessageFactsResult = { changed: string[]; correction: string | null };
export function applyMessageFacts(args: { message: string; facts: SubjectFacts; now: Date }): MessageFactsResult {
  const { facts } = args;
  const text = args.message.replace(/\s+/g, " ").trim();
  const changed: string[] = [];
  let correction: string | null = null;
  const set = (key: string, value: string | number | boolean, derived = false) => {
    facts[key] = { value, state: "known", quote: args.message, recordedAt: args.now.toISOString(), source: derived ? "system-derived" : "user" };
    changed.push(key);
  };
  const unset = (key: string) => facts[key]?.state !== "known" || facts[key].value === "not sure";

  // Corrections: "sorry, it was her right arm not left", "actually the left wrist, not the right".
  const side = text.match(new RegExp(`\\b(right|left)\\s+(${BODY})s?\\b[^.?!]{0,20}?\\bnot\\s+(?:the\\s+|her\\s+|his\\s+|my\\s+)?(left|right)\\b`, "i"))
    ?? text.match(new RegExp(`\\bnot\\s+(?:the\\s+|her\\s+|his\\s+|my\\s+)?(left|right)(?:\\s+(?:${BODY}))?[^.?!]{0,12}?\\b(?:it was|it's|but|,)\\s+(?:the\\s+|her\\s+|his\\s+|my\\s+)?(right|left)\\s+(${BODY})\\b`, "i"));
  if (side) {
    const [to, part, from] = side[0].toLowerCase().startsWith("not") ? [side[2], side[3], side[1]] : [side[1], side[2], side[3]];
    for (const key of ["fractureBodyPart", "injuryBodyPart", "injuries"]) {
      const value = facts[key]?.value;
      const swap = (v: string) => v.replace(new RegExp(`\\b${from}\\b`, "gi"), to.toLowerCase());
      if (typeof value === "string" && new RegExp(`\\b${from}\\b`, "i").test(value)) { facts[key] = { ...facts[key], value: swap(value), quote: args.message, recordedAt: args.now.toISOString() }; changed.push(key); }
      else if (Array.isArray(value) && value.some((v) => new RegExp(`\\b${from}\\b`, "i").test(v))) { facts[key] = { ...facts[key], value: value.map(swap), quote: args.message, recordedAt: args.now.toISOString() }; changed.push(key); }
    }
    if (changed.length) correction = to.toLowerCase() + " " + part.toLowerCase();
  }

  // A hospital stay: "admitted overnight at KKH", "3 nights in a single room".
  const admitted = /\b(?:admitted|warded|hospitali[sz]ed|stayed in hospital|inpatient)\b/i.test(text);
  if (admitted && unset("hospitalised")) set("hospitalised", true);
  if (admitted && unset("treatmentType") && (facts.injured?.value === true || facts.fractureBodyPart || facts.injuryBodyPart)) set("treatmentType", "Admitted to hospital", true);
  const nights = admitted || known(facts, "hospitalised") === true ? nightsIn(text) : null;
  if (nights != null && unset("hospitalNights")) set("hospitalNights", nights);
  const hospital = HOSPITALS.find(([re]) => re.test(text));
  if (hospital && unset("hospitalName") && /\b(?:at|to|in|from)\s+/i.test(text)) set("hospitalName", hospital[1]);
  const admission = known(facts, "admissionDate"), stayed = known(facts, "hospitalNights");
  if (typeof admission === "string" && typeof stayed === "number" && stayed > 0 && unset("dischargeDate") && nights != null) {
    const discharge = addDays(admission, stayed);
    if (discharge && Date.parse(discharge) <= args.now.getTime()) set("dischargeDate", discharge, true);
  }

  // A trip problem: "delayed 13 hours", "flight cancelled", "lost my luggage".
  const delay = text.match(/\bdelay(?:ed)?\b[^.?!]{0,20}?\b(\d{1,3})\s*(?:hours?|hrs?|h)\b|\b(\d{1,3})\s*(?:hours?|hrs?|h)\b[^.?!]{0,12}?\bdelay/i);
  if (delay && known(facts, "flightDelayHours") == null && known(facts, "delayHours") == null) set("flightDelayHours", Number(delay[1] ?? delay[2]));
  if (unset("travelEventType")) {
    if (delay || (/\bdelay(?:ed)?\b/i.test(text) && /\bflight|plane|airline\b/i.test(text))) set("travelEventType", "Flight delay");
    else if (/\b(?:lost|damaged|missing)\b[^.?!]{0,20}\b(?:baggage|luggage|bag)\b|\b(?:baggage|luggage)\b[^.?!]{0,12}\b(?:lost|damaged|missing)\b/i.test(text)) set("travelEventType", "Lost or damaged baggage");
  }
  return { changed: [...new Set(changed)], correction };
}
