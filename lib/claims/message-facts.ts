/**
 * Facts a household states in its own words, read deterministically so the
 * interview never asks for what it was already told, and corrections
 * ("sorry, it was her right arm not left") change the stored fact.
 *
 * Only unambiguous phrases are read, and a fact already known is never
 * overwritten except by an explicit correction. Pure: returns what changed.
 */
import type { SubjectFacts } from "@/lib/chat/types";
import { resolveClaimDate } from "@/lib/claims/dates";

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
const ON_A_TRIP = /\b(?:trip|holiday|vacation|overseas|abroad|travel(?:ling|ing)?)\b/i;
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

  // A broken bone in the household's own words: "broke her left arm", "xin yi break arm".
  const broke = text.match(new RegExp(`\\b(?:broke|break|broken|breaks|fractured?|cracked)\\s+(?:(?:her|his|my|their|a|the|one)\\s+)?(?:(left|right)\\s+)?(${BODY})\\b`, "i"));
  if (broke && unset("fractureBodyPart") && !facts.fractureBodyPart) {
    if (unset("injured")) set("injured", true);
    if (unset("injuryKind")) set("injuryKind", "fracture");
    set("fractureBodyPart", ((broke[1] ? broke[1] + " " : "") + broke[2]).toLowerCase());
  }
  // A hospital stay: "admitted overnight at KKH", "3 nights in a single room".
  // "Cancelled our trip because my mum was hospitalised": the stay was someone else's.
  const tripReason = /\bcancel(?:led|ed)?\s+(?:our|my|the|her|his)\s+(?:[A-Za-z]+\s+)?(?:trip|holiday|vacation|tour|flight)|\bcut (?:short|our trip short)\b|\bflew (?:back|home) early\b/i.test(text);
  const admitted = !tripReason && /\b(?<!not |never |wasn't |was not )(?:admitted|warded|hospitali[sz]ed|stayed in hospital|inpatient)\b/i.test(text)
    || !tripReason && /\b(?:now|still|currently)\s+(?:in|at)\s+(?:the\s+)?(?:hospital|icu|ttsh|sgh|nuh|cgh|kkh|ktph|skh|ng teng fong|tan tock seng|mount elizabeth|gleneagles|raffles hospital|mount alvernia)\b/i.test(text);
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

  // The trip's own dates: "our holiday from 2026-08-15 to 2026-08-25".
  const trip = text.match(/\b(?:trip|holiday|vacation|travel(?:led|ling|ing)?)\b[^.?!]{0,40}?\bfrom\s+(\d{4}-\d\d-\d\d)\s+(?:to|until|till|-)\s+(\d{4}-\d\d-\d\d)\b/i);
  if (trip && trip[1] <= trip[2]) {
    if (unset("tripStartDate")) set("tripStartDate", trip[1]);
    if (unset("tripEndDate")) set("tripEndDate", trip[2]);
  }
  // A trip problem: "delayed 13 hours", "flight cancelled", "lost my luggage".
  const delay = text.match(/\bdelay(?:ed)?\b[^.?!]{0,20}?\b(\d{1,3})\s*(?:hours?|hrs?|h)\b|\b(\d{1,3})\s*(?:hours?|hrs?|h)\b[^.?!]{0,12}?\bdelay/i);
  if (delay && known(facts, "flightDelayHours") == null && known(facts, "delayHours") == null) set("flightDelayHours", Number(delay[1] ?? delay[2]));
  if (unset("travelEventType")) {
    if (delay || (/\bdelay(?:ed)?\b/i.test(text) && /\bflight|plane|airline\b/i.test(text))) set("travelEventType", "Flight delay");
    // A bag reported lost (not one that arrived late) is the loss benefit's claim.
    else if (/\b(?:lost|missing|stolen)\b[^.?!]{0,20}\b(?:baggage|luggage|bag)\b|\b(?:baggage|luggage|bag)\b[^.?!]{0,12}\b(?:lost|missing|stolen)\b/i.test(text) && !/\b(?:arrived|came|delayed|late)\b/i.test(text)) set("travelEventType", "Lost baggage");
    else if (/\b(?:lost|damaged|missing)\b[^.?!]{0,20}\b(?:baggage|luggage|bag)\b|\b(?:baggage|luggage)\b[^.?!]{0,12}\b(?:lost|damaged|missing)\b/i.test(text)) set("travelEventType", "Lost or damaged baggage");
    else if (ON_A_TRIP.test(text) && /\b(?:sick|ill|fever|food poisoning|diarrh\w*|vomit\w*|saw a doctor|see a doctor|clinic|warded|admitted|hospital)\b/i.test(text)) set("travelEventType", "Medical treatment abroad");
  }
  // "Food poisoning", "fever", "dengue" with no accident in it: an illness.
  if (ON_A_TRIP.test(text) && unset("eventType") && /\b(?:food poisoning|fever|flu|dengue|covid|infection|gastro\w*|stomach bug|diarrh\w*|vomit\w*|fell sick|got sick|was sick|is sick|ill with)\b/i.test(text)
    && !/\b(?:accident\w*|fell|fall(?:en)?|slipped|crash\w*|collision|knocked|broke|broken|fractur\w*|injur\w*|hurt|cut|burn\w*|bitten)\b/i.test(text)) set("eventType", "illness");
  // An illness named with a hospital stay or a clinic visit ("admitted to KKH
  // for dengue") is not an accident: the accident question is never asked.
  if (unset("eventType") && /\b(?:dengue|pneumonia|fever|flu|influenza|infection|gastro\w*|appendicitis|hfmd|hand,? foot and mouth|covid|asthma|bronchitis|chickenpox|food poisoning|kidney stones?|gallstones?|cataract)\b/i.test(text)
    && !/\b(?:accident\w*|fell|fall(?:en)?|slipped|crash\w*|collision|knocked|broke|broken|fractur\w*|injur\w*|hurt|cut|burn\w*|bitten)\b/i.test(text)) set("eventType", "illness");
  // The one date a trip problem was reported with is the day it happened
  // ("lost on my trip to Tokyo on 2026-09-10").
  if (ON_A_TRIP.test(text) && unset("eventDate") && !/\b(?:from|until|till|to)\s+\d/i.test(text)) {
    const dates = [...text.matchAll(/\b(20\d\d)-(\d\d)-(\d\d)\b/g)].map((m) => m[0]);
    if (dates.length === 1 && Date.parse(dates[0] + "T00:00:00Z") <= args.now.getTime()) set("eventDate", dates[0]);
  }
  // ---------------------------------------------------------------- dates said in passing
  const dateAt = (re: RegExp) => {
    const m = text.match(re);
    if (!m) return null;
    const d = resolveClaimDate(m[1], { now: args.now });
    return d && Date.parse(d.date + "T00:00:00Z") <= args.now.getTime() ? d.date : null;
  };
  const DATE = String.raw`((?:20\d\d-\d\d?-\d\d?)|(?:\d{1,2}[/.]\d{1,2}[/.]\d{4})|(?:\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\s+\d{4})|yesterday|today|day before yesterday|last\s+[a-z]+day|this\s+[a-z]+day|(?:\d+|one|two|three|a)\s+(?:days?|weeks?)\s+ago)`;
  // "discharged 2026-09-23", "and discharged on 2026-09-15"
  const discharged = dateAt(new RegExp(String.raw`\bdischarged\s+(?:on\s+|home\s+on\s+)?` + DATE, "i"));
  if (discharged && unset("dischargeDate")) set("dischargeDate", discharged);
  const allDates = [...text.matchAll(new RegExp(DATE, "gi"))].map((m) => resolveClaimDate(m[1], { now: args.now })?.date).filter((d): d is string => !!d);
  const single = new Set(allDates).size === 1 ? allDates[0] : null;
  const past = single && Date.parse(single + "T00:00:00Z") <= args.now.getTime() ? single : null;
  // Day surgery or "went home same day": admitted and discharged that day.
  if (past && /\bday surgery\b|\bsame day\b|\bwent home (?:the )?same day\b/i.test(text) && /\b(?:surgery|operation|procedure|admitted)\b/i.test(text)) {
    if (unset("admissionDate")) set("admissionDate", past);
    if (unset("dischargeDate")) set("dischargeDate", past);
  }
  // An injury or an illness reported with one date: the day it happened.
  const injuredNow = known(facts, "injured") === true || known(facts, "fractureBodyPart") != null || known(facts, "eventType") === "illness" || known(facts, "eventType") === "accident";
  if (past && injuredNow && unset("eventDate") && !ON_A_TRIP.test(text) && !/\b(?:discharged|admitted)\s+(?:on\s+)?/i.test(text.replace(/\badmitted overnight\b/i, ""))) set("eventDate", past);
  if (past && injuredNow && unset("eventDate") && /\badmitted overnight\b/i.test(text)) set("eventDate", past);
  // A condition reported with one date ("had a stroke on 2026-09-14"): the diagnosis date.
  if (past && known(facts, "diagnosis") != null && known(facts, "death") !== true && unset("diagnosisDate")) set("diagnosisDate", past);
  // ---------------------------------------------------------------- where it happened
  const OVERSEAS_PLACE = /\b(?:overseas|abroad|phuket|bangkok|thailand|bali|indonesia|jakarta|malaysia|kuala lumpur|\bkl\b|johor|penang|tokyo|osaka|japan|seoul|korea|taipei|taiwan|hong kong|china|beijing|shanghai|paris|france|london|europe|australia|sydney|melbourne|vietnam|hanoi|ho chi minh|manila|philippines|india|usa|america|new york)\b/i;
  const LOCAL = /\b(?:in singapore|nccs|kkh|sgh|ttsh|nuh|cgh|ktph|polyclinic|mount elizabeth|gleneagles|raffles hospital|mount alvernia|thomson medical|changi general|tan tock seng|singapore general|national university hospital)\b/i;
  if (unset("eventLocation") && !facts.eventCountry) {
    if (OVERSEAS_PLACE.test(text)) set("eventLocation", "Overseas");
    else if (LOCAL.test(text) && !ON_A_TRIP.test(text)) set("eventLocation", "Singapore");
  }
  // ---------------------------------------------------------------- critical illness details said up front
  if (/\b(?:by|from|with|saw)\s+(?:(?:my|her|his|an?|the)\s+)?(?:oncologist|cardiologist|neurologist|specialist|surgeon|haematologist|nephrologist)\b/i.test(text) && unset("diagnosedBySpecialist")) set("diagnosedBySpecialist", true);
  if (/\b(?:he|she|i|they)\s+(?:is|am|are)\s+(?:still\s+)?(?:alive|ok(?:ay)?|recovering|stable|having (?:chemo|treatment|radiotherapy))\b|\b(?:having|on|started)\s+(?:chemo\w*|radiotherapy)\b/i.test(text) && unset("survivedSurvivalPeriod")) set("survivedSurvivalPeriod", true);
  if (/\b(?:not|never|wasn['’]?t|isn['’]?t)\s+(?:hospitali[sz]ed|admitted|warded)\b/i.test(text) && unset("hospitalised")) set("hospitalised", false);
  // "early stage, not late stage": the stage is part of what was diagnosed.
  const stage = text.match(/\b(early|late|advanced|intermediate)[- ]stage\b(?:[^.?!]{0,20}\bnot\s+(?:the\s+)?(?:early|late|advanced)[- ]stage\b)?/i);
  const diagnosis = known(facts, "diagnosis");
  if (stage && typeof diagnosis === "string" && !new RegExp("\\b" + stage[1] + "[- ]stage\\b", "i").test(diagnosis)) {
    // The stage adds to what was diagnosed; answers given about the diagnosis stay current.
    facts.diagnosis = { ...facts.diagnosis, value: diagnosis.replace(/\s*\((?:early|late|advanced|intermediate) stage\)$/i, "") + " (" + stage[1].toLowerCase() + " stage)", quote: args.message };
    changed.push("diagnosis");
    if (/\bnot\b|\bcorrect/i.test(text)) correction = stage[1].toLowerCase() + " stage";
  }
  // ---------------------------------------------------------------- cause of a death said up front
  if (known(facts, "death") === true) {
    const cause = text.match(/\b(?:from|of|after|due to|because of)\s+(?:a\s+|an\s+|his\s+|her\s+)?((?:long\s+|short\s+)?illness|(?:[a-z]+\s+){0,2}cancer|heart attack|stroke|cardiac arrest|pneumonia|covid(?:-19)?|kidney failure|old age|natural causes|(?:[a-z]+\s+){0,2}accident)\b/i)
      ?? text.match(/\b((?:road|traffic|car|motorcycle|motorbike|bike|work(?:place)?)\s+accident)\b/i);
    if (cause && (unset("causeOfDeath") || /^(?:accident|road accident|car accident)$/i.test(String(known(facts, "causeOfDeath"))))) {
      if (unset("causeOfDeath") || cause[1].length > String(known(facts, "causeOfDeath")).length) set("causeOfDeath", cause[1].toLowerCase());
    }
    const accidental = /\baccident\b|\bcrash\b|\bfell\b|\bdrown/i.test(text);
    const illness = /\billness\b|\bcancer\b|heart attack|\bstroke\b|cardiac|pneumonia|covid|kidney failure|old age|natural causes|\bsick\b|\bdisease\b/i.test(text);
    if (unset("accidentalDeath") && (accidental !== illness)) set("accidentalDeath", accidental);
    // How it happened, when the message already says (a motorcycle accident in Phuket).
    const how = text.match(/\b(?:in|from|after)\s+(?:a\s+|an\s+)?((?:road|traffic|car|motorcycle|motorbike|bike|work(?:place)?)\s+accident[^.?!,]{0,40})/i)
      ?? text.match(/\b((?:car|motorcycle|road|traffic)\s+accident)\b/i)
      ?? text.match(/\b(collapsed[^.?!,]{0,30}|fell (?:from|off|down)[^.?!,]{0,30})/i);
    if (how && unset("accidentCircumstances")) set("accidentCircumstances", how[1].trim());
  }
  // ---------------------------------------------------------------- corrections of the cause
  if (/\b(?:not|wasn['’]?t|isn['’]?t)\s+(?:an?\s+)?accident\b/i.test(text) && known(facts, "eventType") !== "illness") {
    facts.eventType = { value: "illness", state: "known", quote: args.message, recordedAt: args.now.toISOString(), source: "user" };
    changed.push("eventType"); correction = correction ?? "an illness rather than an accident";
  }
  // ---------------------------------------------------------------- treatment said in passing
  if (unset("treatmentType") && (known(facts, "injured") === true || known(facts, "eventType") === "illness")) {
    if (/\b(?:a\s*&\s*e|a and e|emergency department|emergency room)\b/i.test(text)) set("treatmentType", "Emergency department");
    else if (/\b(?:polyclinic|clinic|gp\b|family doctor)\b/i.test(text) && !/\badmitted|warded\b/i.test(text)) set("treatmentType", "Outpatient or clinic");
    // Seen and sent home: there was no admission to ask about.
    if (/^(?:Emergency department|Outpatient or clinic)$/.test(String(known(facts, "treatmentType"))) && unset("hospitalised") && !/\badmitted|warded|hospitali[sz]ed\b/i.test(text)) set("hospitalised", false, true);
  }
  return { changed: [...new Set(changed)], correction };
}
