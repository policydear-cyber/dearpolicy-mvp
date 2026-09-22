import { z } from "zod";
import { structuredCompletion } from "@/lib/ai/llm";
import { dearPolicyCoreRules } from "@/lib/ai/core-rules";
import { EMPTY_CLAIM_FACTS, type ClaimFacts, type ClaimQuestion } from "./types";
import { claimDateInFuture, claimLocalToday, claimTimeZone, resolveClaimDate, type ClaimDateContext } from "./dates";

const ClaimFactsSchema = z.object({
  eventType: z.enum(["accident", "diagnosis", "hospitalisation", "death", "disability", "other"]).nullable(),
  eventDate: z.string().nullable(),
  death: z.boolean().nullable(),
  deathDate: z.string().nullable(),
  causeOfDeath: z.string().nullable(),
  accidentalDeath: z.boolean().nullable(),
  accidentType: z.string().nullable(),
  accidentDate: z.string().nullable(),
  injured: z.boolean().nullable(),
  injuries: z.array(z.string()),
  fractureBodyPart: z.string().nullable(),
  diagnosis: z.string().nullable(),
  diagnosisStage: z.string().nullable(),
  diagnosisSite: z.string().nullable(),
  diagnosisDate: z.string().nullable(),
  hospitalised: z.boolean().nullable(),
  hospitalNights: z.number().int().nonnegative().nullable(),
  ambulanceUsed: z.boolean().nullable(),
  ambulanceBill: z.number().nonnegative().nullable(),
  hospitalBill: z.number().nonnegative().nullable(),
  outOfPocket: z.number().nonnegative().nullable(),
  surgery: z.boolean().nullable(),
  permanentImpairment: z.boolean().nullable(),
  competitiveRacing: z.boolean().nullable(),
  racingAuthoritySanctioned: z.boolean().nullable(),
  medicalReportAvailable: z.boolean().nullable(),
  causeOfDeathDocumentAvailable: z.boolean().nullable(),
  uncertainFacts: z.array(z.string()),
});

function moneyNear(text: string, words: string[]) {
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  // Never treat an unrelated plain number (for example "2 nights") as a bill.
  // Outside a targeted money question, require either a currency marker or an
  // explicit bill/cost/charge phrase next to the amount.
  const patterns = [
    new RegExp(String.raw`(?:${escaped})[^\n]{0,35}?(?:S\$|SGD|\$)\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)`, "i"),
    new RegExp(String.raw`(?:S\$|SGD|\$)\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)[^\n]{0,25}?(?:${escaped})`, "i"),
    new RegExp(String.raw`(?:${escaped})[^\n]{0,20}?(?:bill|cost|charge|fee|paid)[^\n]{0,12}?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)`, "i"),
  ];
  for (const pattern of patterns) {
    const value = text.match(pattern)?.[1];
    if (value) return Number(value.replace(/,/g, ""));
  }
  return null;
}

function yesNoFromAnswer(text: string) {
  const t = text.trim().toLowerCase();
  if (/^(yes|y|yeah|yep|correct|i did|did|have|yes i did)\b/.test(t)) return true;
  if (/^(no|n|nope|didn'?t|do not|don'?t|none)\b/.test(t)) return false;
  return null;
}

function argsTextMeaningful(text:string){ return text.trim().length>1 && !/^(?:not sure|unsure|unknown|i don'?t know|do not know|don'?t know|can'?t remember|cannot remember)\b/i.test(text.trim()); }

function affirmedDeath(text: string) {
  for (const match of text.matchAll(/\b(?:passed away|died|death|deceased|killed|murdered|homicide)\b/gi)) {
    const before = text.slice(Math.max(0, match.index! - 55), match.index).split(/[.!?;,]/).at(-1) ?? "";
    if (!/\b(?:not|never|almost|nearly|if|whether|no one|didn'?t|hasn'?t|haven'?t|could have|would have)\b/i.test(before)) return true;
  }
  return false;
}

function targetedMoney(text: string) {
  const match = text.match(/(?:S\$|SGD|\$)\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)/i)
    ?? text.trim().match(/^(?:(?:yes|it was|the bill was|cost|around|about)\s*[, :]?\s*)?(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:dollars?|SGD)?[.!]?$/i);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

const QUESTION_FIELDS: Record<string, keyof ClaimFacts> = {
  event_type: "eventType", event_date: "eventDate", death_date: "deathDate", cause_of_death: "accidentalDeath",
  diagnosis_date: "diagnosisDate", diagnosis: "diagnosis", injured: "injured", fracture_body_part: "fractureBodyPart",
  ambulance_used: "ambulanceUsed", ambulance_bill: "ambulanceBill", hospitalised: "hospitalised", hospital_nights: "hospitalNights",
  hospital_bill: "hospitalBill", out_of_pocket: "outOfPocket", surgery: "surgery", permanent_impairment: "permanentImpairment",
  competitive_racing: "competitiveRacing", racing_authority_sanctioned: "racingAuthoritySanctioned", medical_report: "medicalReportAvailable",
  cause_of_death_document: "causeOfDeathDocumentAvailable",
};

function deterministicFacts(text: string, pendingQuestion?: ClaimQuestion | null, context: ClaimDateContext = {}): Partial<ClaimFacts> {
  const lower = text.toLowerCase();
  const out: Partial<ClaimFacts> = {};

  const death = affirmedDeath(text);
  const accident = /\b(?:accident|crash|collision|fell off|knocked down|motorbike|motorcycle|road traffic)\b/i.test(text);
  if (death) { out.death = true; out.eventType = "death"; }
  else if (/\b(?:not dead|did not die|didn't die|has not died|hasn't died|is alive|still alive)\b/i.test(text)) out.death = false;
  if (!death && /\b(?:permanent(?:ly)? (?:disab|impair)|amputat|loss of function|disabled|disability)\w*/i.test(text) && !/no permanent|not permanent|not disabled/i.test(text)) out.eventType = "disability";
  else if (!death && accident) out.eventType = "accident";
  else if (!death && /diagnos|cancer|tumou?r|stroke|heart attack|critical illness|disease/i.test(text)) out.eventType = "diagnosis";
  else if (!death && /hospital|admitted|inpatient/i.test(text)) out.eventType = "hospitalisation";
  else if (!death && /unable to work/i.test(text)) out.eventType = "disability";

  if (/motorbike|motorcycle/i.test(text)) out.accidentType = "motorcycle accident";
  else if (/car accident|car crash|motor vehicle/i.test(text)) out.accidentType = "motor vehicle accident";
  else if (/fall|fell/i.test(text) && out.eventType === "accident") out.accidentType = "fall";
  else if (accident) out.accidentType = "accident";

  const cause = text.match(/\b(?:died|passed away|death|killed)\s+(?:was\s+)?(?:of|from|due to|caused by|because of|as a result of)\s+(.+?)(?=[,.;?!]|\b(?:today|yesterday|on|last|this)\b|$)/i)?.[1]?.trim()
    ?? text.match(/\b(?:died|killed)\s+in\s+((?:an?\s+)?(?:motorcycle\s+|motorbike\s+|car\s+|road\s+)?(?:accident|crash|collision))\b/i)?.[1]?.trim();
  if (cause) {
    out.causeOfDeath = cause;
    // A reported cause consistent with an accident (a crash, a fall) is
    // recorded as accidentalDeath=true so DearPolicy does not re-ask a
    // question the family has already answered in their own words, and a
    // reported illness rules out an accident-only benefit the same way.
    // Neither direction is a decision about the policy's own definition of
    // an accidental death, and neither by itself authorises an amount --
    // that additionally requires the REVIEWED official cause-of-death
    // evidence to be matched, per policy, against that policy's own
    // accidental-death definition (`causeOfDeathEvidenceReviewed` and a
    // confirmed entry in `causeDefinitionMatches`, never set from chat
    // text), which the accidental-death calculator enforces separately
    // and explicitly.
    // Mentioning that a document exists only ever sets
    // `causeOfDeathDocumentAvailable`, an availability signal that can
    // prompt an upload request but never authorises an amount by itself.
    if (/accident|crash|collision|fall|fell|road traffic/i.test(cause)) out.accidentalDeath = true;
    else if (/illness|disease|cancer|natural cause|heart attack|stroke|infection/i.test(cause)) out.accidentalDeath = false;
  }
  if (/\baccidental death\b/i.test(text) && !/not (?:an? )?accidental death/i.test(text)) out.accidentalDeath = true;
  if (/\b(?:death|died)\b[^.!?]{0,45}\b(?:not|wasn'?t)\s+(?:directly\s+)?(?:caused by|due to|from)\s+(?:an?\s+)?accident/i.test(text) || /not (?:an? )?accidental death/i.test(text)) out.accidentalDeath = false;

  if (/fractur|broken\s+(?:bone|wrist|arm|leg|ankle|knee|hip|rib|ribs|shoulder|jaw|pelvis|skull|spine|elbow)/i.test(text)) {
    out.injured = true;
    out.injuries = ["fracture"];
    const body = lower.match(/\b(wrist|arm|leg|ankle|knee|hip|rib|ribs|shoulder|jaw|pelvis|skull|spine|neck|elbow|cheekbone)\b/)?.[1];
    if (body) out.fractureBodyPart = body === "ribs" ? "rib" : body;
  }
  if (/injur|hurt|wound|fractur|broken|sprain|burn/i.test(text)) out.injured = true;
  if (/no injur|not injured|unhurt/i.test(text)) out.injured = false;

  if (/ambulance/i.test(text)) {
    if (/no ambulance|didn'?t.*ambulance|without.*ambulance/i.test(text)) out.ambulanceUsed = false;
    else out.ambulanceUsed = true;
    const bill = moneyNear(text, ["ambulance"]); if (bill != null) out.ambulanceBill = bill;
  }

  if (/hospital|admitted|inpatient|warded/i.test(text)) {
    if (/not admitted|wasn'?t admitted|no hospital/i.test(text)) out.hospitalised = false;
    else if (/\b(?:admitted|inpatient|warded|hospitalised|hospitalized)\b|(?:stayed|spent)\b[^.!?]{0,30}\b(?:hospital|nights?)\b/i.test(text)) out.hospitalised = true;
    const nights = lower.match(/(\d+)\s*(?:night|nights|day|days)/)?.[1];
    if (nights) out.hospitalNights = Number(nights);
  }
  const hospitalBill = moneyNear(text, ["hospital bill", "medical bill", "bill was", "total bill"]); if (hospitalBill != null) out.hospitalBill = hospitalBill;
  const oop = moneyNear(text, ["out of pocket", "out-of-pocket", "i paid", "personally paid", "cash paid"]); if (oop != null) out.outOfPocket = oop;

  if (/surgery|operation|operated/i.test(text)) out.surgery = !/no surgery|no operation|didn'?t.*surgery/i.test(text);
  if (/permanent|loss of function|can'?t use|cannot use|amputat|disab/i.test(text)) out.permanentImpairment = !/no permanent|not permanent/i.test(text);
  const noRacing = /\b(?:not racing|no racing|wasn'?t racing|not competitive racing|ordinary road|normal road)\b/i.test(text);
  if (/\b(?:racing|race|competition)\b/i.test(text) && !/not sure|unsure|unknown|don'?t know|do not know/i.test(text)) out.competitiveRacing = !noRacing;
  if (noRacing) out.competitiveRacing = false;
  const sanctioned = text.match(/\b(?:sanctioned|approved|authori[sz]ed)\s+by\s+(?:the\s+)?(?:Authority|MINDEF|MHA|SAF)\b/i);
  if (sanctioned && !/not sure|unsure|unknown|don'?t know|do not know/i.test(text)) {
    out.racingAuthoritySanctioned = !/\b(?:not|never|wasn'?t|weren'?t)\s*$/i.test(text.slice(Math.max(0, sanctioned.index! - 25), sanctioned.index));
  }

  const cancer = text.match(/\bstage\s*[0-4ivx]+\s+(?:[a-z-]+\s+){0,3}cancer\b/i)?.[0]
    ?? text.match(/\b(?:colon|colorectal|breast|lung|prostate|liver|pancreatic|stomach|skin|ovarian|cervical|blood|brain|kidney|thyroid|bladder)\s+cancer\b/i)?.[0]
    ?? text.match(/\bcancer\b/i)?.[0];
  if (cancer) out.diagnosis = cancer.trim();
  const stage = text.match(/\bstage\s*([0-4ivx]+)\b/i)?.[1]; if (stage) out.diagnosisStage = stage;
  const site = cancer?.match(/\b(colon|colorectal|breast|lung|prostate|liver|pancreatic|stomach|skin|ovarian|cervical|blood|brain|kidney|thyroid|bladder)\b/i)?.[1];
  if (site) out.diagnosisSite = site;
  const otherDiagnosis = text.match(/\b(?:stroke|heart attack|kidney failure|carcinoma|malignant tumou?r)\b/i)?.[0];
  if (otherDiagnosis && !out.diagnosis) out.diagnosis = otherDiagnosis;
  if (/pathology|medical report|doctor'?s report|oncologist report/i.test(text)) out.medicalReportAvailable = !/don'?t have|do not have|no report/i.test(text);
  // Mentioning a document -- even in passing -- is only ever availability.
  // It can prompt DearPolicy to ask for the upload; it can never, on its
  // own or via any chat answer, set causeOfDeathEvidenceReviewed or add an
  // entry to causeDefinitionMatches, both of which require an actual
  // reviewed document and are never extracted from free text.
  if (/death certificate|coroner|coroner's report|police report|medical examiner/i.test(text)) out.causeOfDeathDocumentAvailable = !/don't have|do not have|no (?:death certificate|report|coroner)/i.test(text);

  // Separate the accident date from a later death date in the same message.
  const deathIndex = death ? text.search(/\b(?:died|passed away|death|deceased|killed)\b/i) : -1;
  let deathText = deathIndex >= 0 ? text.slice(deathIndex).split(/[!?;]|\.(?:\s|$)/)[0] : text;
  const earlierAccident = deathIndex > 0 && /accident|crash|collision/i.test(text.slice(0, deathIndex)) ? text.slice(0, deathIndex) : null;
  const laterAccident = death ? deathText.match(/\b(?:after|following|before|and)\s+(?:(?:an?|the|her|his|previous|earlier)\s+)*(?:(?:motorbike|motorcycle|car|road traffic)\s+)?(?:accident|crash|collision)\b[^.!?;]*/i) : null;
  if (laterAccident?.index != null) deathText = deathText.slice(0, laterAccident.index);
  const accidentText = earlierAccident ?? laterAccident?.[0] ?? (death ? null : text);
  const precedingClauses = deathIndex > 0 ? text.slice(0, deathIndex).split(/[!?;,]|\.(?:\s|$)|\band\b/i) : [];
  const precedingDeathClause = precedingClauses.at(-1) ?? "";
  let precedingDeathDate = death && !/accident|crash|collision|policy|certificate|effective|premium|renewal|diagnos|birth/i.test(precedingDeathClause) ? resolveClaimDate(precedingDeathClause, context) : null;
  if (death && !precedingDeathDate) {
    const clause = precedingClauses.at(-2) ?? "";
    const date = resolveClaimDate(clause, context);
    if (date && /^(?:on\s*)?(?:morning|afternoon|evening|night)?$/i.test(clause.replace(date.expression, "").trim())) precedingDeathDate = date;
  }
  const resolved = resolveClaimDate(death ? deathText : text.split(/[!?;]|\.(?:\s|$)/)[0], context) ?? precedingDeathDate;
  if (resolved && !claimDateInFuture(resolved.date, context)) {
    if (death) { out.deathDate = resolved.date; out.eventDate = resolved.date; }
    else if (out.eventType === "diagnosis" || pendingQuestion?.id === "diagnosis_date") out.diagnosisDate = resolved.date;
    else out.eventDate = resolved.date;
  }
  if (accident && accidentText) {
    const accidentDate = resolveClaimDate(accidentText, context);
    if (accidentDate && !claimDateInFuture(accidentDate.date, context)) out.accidentDate = accidentDate.date;
  }

  // A terminal-event update invalidates an old routine-injury question.
  const compatible = !death || ["event_date", "death_date", "cause_of_death", "cause_of_death_document", "cause_of_death_document_upload", "competitive_racing", "racing_authority_sanctioned"].includes(pendingQuestion?.id ?? "");
  if (pendingQuestion && compatible) {
    const yn = yesNoFromAnswer(text);
    if (pendingQuestion.id === "injured" && yn != null) out.injured = yn;
    if (pendingQuestion.id === "injured" && yn !== false && argsTextMeaningful(text) && !/^(yes|y|yeah|yep)$/i.test(text.trim())) { out.injured = true; if (!out.injuries?.length) out.injuries = [text.trim()]; }
    if (pendingQuestion.id === "ambulance_used" && yn != null) out.ambulanceUsed = yn;
    if (pendingQuestion.id === "ambulance_used" && yn === true && out.ambulanceBill == null) { const n=targetedMoney(text); if (n != null) out.ambulanceBill=n; }
    if (pendingQuestion.id === "hospitalised" && yn != null) out.hospitalised = yn;
    if (pendingQuestion.id === "hospitalised" && yn === true) { const n=Number(text.match(/\d+/)?.[0]); if (Number.isFinite(n)) out.hospitalNights=n; }
    if (pendingQuestion.id === "surgery" && yn != null) out.surgery = yn;
    if (pendingQuestion.id === "permanent_impairment" && yn != null) out.permanentImpairment = yn;
    if (pendingQuestion.id === "permanent_impairment" && /^permanent$/i.test(text.trim())) out.permanentImpairment = true;
    if (pendingQuestion.id === "permanent_impairment" && /^not permanent$/i.test(text.trim())) out.permanentImpairment = false;
    if (pendingQuestion.id === "permanent_impairment" && /not sure|unsure|unknown|don\'t know|do not know/i.test(text)) out.uncertainFacts = ["permanent_impairment"];
    if (pendingQuestion.id === "competitive_racing" && yn != null) out.competitiveRacing = yn;
    if (pendingQuestion.id === "racing_authority_sanctioned" && yn != null) out.racingAuthoritySanctioned = yn;
    if (pendingQuestion.id === "medical_report" && yn != null) out.medicalReportAvailable = yn;
    if (pendingQuestion.id === "cause_of_death_document" && yn != null) out.causeOfDeathDocumentAvailable = yn;
    if (pendingQuestion.id === "fracture_body_part" && argsTextMeaningful(text)) out.fractureBodyPart = lower.match(/\b(wrist|arm|leg|ankle|knee|hip|rib|ribs|shoulder|jaw|pelvis|skull|spine|neck|elbow|cheekbone)\b/)?.[1] ?? null;
    if (pendingQuestion.id === "ambulance_bill") { const n = targetedMoney(text); if (n != null) out.ambulanceBill = n; }
    if (pendingQuestion.id === "hospital_bill") { const n = targetedMoney(text); if (n != null) out.hospitalBill = n; }
    if (pendingQuestion.id === "out_of_pocket") { const n = targetedMoney(text); if (n != null) out.outOfPocket = n; }
    if (pendingQuestion.id === "hospital_nights") {
      const n = Number(text.match(/\d+/)?.[0]); if (Number.isFinite(n)) out.hospitalNights = n;
    }
    if (pendingQuestion.id === "diagnosis" && argsTextMeaningful(text)) out.diagnosis ??= text.trim();
    if (["event_date", "diagnosis_date", "death_date"].includes(pendingQuestion.id) && resolved && !claimDateInFuture(resolved.date, context)) {
      if (pendingQuestion.id === "diagnosis_date") out.diagnosisDate = resolved.date;
      else if (pendingQuestion.id === "death_date") out.deathDate = resolved.date;
      else out.eventDate = resolved.date;
    }
    if (pendingQuestion.id === "cause_of_death") {
      if (/accident|crash|collision|fall/i.test(text) && !/not.*accident|no accident/i.test(text)) { out.accidentalDeath = true; out.causeOfDeath = text.trim(); }
      else if (/illness|cancer|natural|heart attack|stroke|not.*accident/i.test(text)) { out.accidentalDeath = false; out.causeOfDeath = text.trim(); }
    }
    if (/^(?:not sure|unsure|unknown|i don'?t know|do not know|don'?t know|can'?t remember|cannot remember)\b/i.test(text.trim())) out.uncertainFacts = [...new Set([...(out.uncertainFacts ?? []), pendingQuestion.id])];
  }
  return out;
}

function mergeNonNull(base: ClaimFacts, updates: Partial<ClaimFacts>) {
  const next: ClaimFacts = { ...EMPTY_CLAIM_FACTS, ...base, injuries: [...(base.injuries ?? [])], uncertainFacts: [...(base.uncertainFacts ?? [])], factSources: { ...(base.factSources ?? {}) } };
  for (const [key, value] of Object.entries(updates) as [keyof ClaimFacts, ClaimFacts[keyof ClaimFacts]][]) {
    if (value == null) continue;
    // Object.entries(updates) collapses every field's value type into the
    // single union ClaimFacts[keyof ClaimFacts] -- now that ClaimFacts also
    // carries a CauseDefinitionMatch[] field, that union includes non-string
    // array members too, so Array.isArray(value) alone no longer narrows
    // value back to string[] here. The key === "injuries" /
    // key === "uncertainFacts" checks already prove at runtime which string[]
    // field this is; the cast makes that explicit for the type checker.
    if (key === "injuries" && Array.isArray(value)) next.injuries = [...new Set([...next.injuries, ...(value as string[])])];
    else if (key === "uncertainFacts" && Array.isArray(value)) next.uncertainFacts = [...new Set([...next.uncertainFacts, ...(value as string[])])];
    else (next as unknown as Record<string, unknown>)[key] = value;
  }
  return next;
}

export async function extractClaimFacts(args: { text: string; current?: ClaimFacts | null; pendingQuestion?: ClaimQuestion | null; now?: Date; timeZone?: string; allowAi?: boolean }) {
  const current = args.current ?? { ...EMPTY_CLAIM_FACTS, injuries: [] };
  const deterministic = deterministicFacts(args.text, args.pendingQuestion, args);
  let ai: Partial<ClaimFacts> = {};

  // Most guided-claim turns are deliberately parsed without an LLM. This keeps
  // the fact-finding flow fast, avoids unnecessary GPU work, and removes a major
  // hallucination surface. Qwen is only a fallback for genuinely free-form text
  // that the deterministic parser could not understand at all.
  const shouldUseAi = args.allowAi !== false && args.text.trim().length >= 20 &&
    (Object.keys(deterministic).length === 0 || (/\bdiagnosed with\b/i.test(args.text) && !deterministic.diagnosis && !deterministic.death));
  if (shouldUseAi) {
    try {
      // Provenance remains in the session; repeating every original message in
      // the prompt would defeat the small-context GPU stability protections.
      const factContext = Object.fromEntries(Object.entries(current).filter(([key,value]) => key !== "factSources" && value != null && (!Array.isArray(value) || value.length)));
      const extractionRules = dearPolicyCoreRules().split("\n").filter(line => /^(?:Use only facts supplied|Do not fill gaps|Never (?:invent|ask|use|turn|combine)|A reported death)/.test(line.trim())).join("\n");
      // ClaimFactsSchema deliberately omits causeOfDeathEvidenceReviewed
      // and causeDefinitionMatches: no model output, however phrased, may
      // ever set those -- only an actual, already-completed, policy-specific
      // document review can. Partial<ClaimFacts> (not ClaimFacts) reflects
      // that the AI-extracted shape is intentionally narrower than the
      // full fact set.
      const parsed = await structuredCompletion<Partial<ClaimFacts>>({
        system: `${extractionRules}\n\nCLAIM FACT EXTRACTION\nExtract all facts explicitly stated in this user's message. Do not infer medical severity, claim eligibility, policy ownership, dates or costs. A reported death overrides injuries. Keep cancer site and stage when stated. Unknown values must be null/[]. Relative dates are resolved by the application; leave date fields null unless an explicit ISO date is quoted.`,
        user: `Pending question: ${args.pendingQuestion?.text ?? "none"}\nExisting facts (context only; do not repeat unless user confirms): ${JSON.stringify(factContext)}\nUser message: ${args.text}`,
        schema: ClaimFactsSchema,
        temperature: 0,
        timeoutMs: 60_000,
        attempts: 1,
        });
      ai = parsed;
    } catch {
      ai = {};
    }
  }

  // Explicit deterministic facts always outrank fallback model output.
  // The model cannot resolve dates: relative dates need the user's local clock.
  for (const key of ["eventDate", "diagnosisDate", "deathDate", "accidentDate"] as const) {
    const value = ai[key];
    if (value && (!args.text.includes(value) || !resolveClaimDate(value, args) || claimDateInFuture(value, args))) delete ai[key];
  }
  const merged = mergeNonNull(mergeNonNull(current, ai), deterministic);
  if (current.eventType === "accident" && !merged.accidentDate && current.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(current.eventDate)) merged.accidentDate = current.eventDate;
  if (args.pendingQuestion?.id === "event_date" && current.eventType === "death" && deterministic.eventDate) merged.deathDate = deterministic.eventDate;
  if (merged.death === true || (current.eventType === "death" && merged.death !== false)) {
    merged.death = true; merged.eventType = "death";
    if (!merged.deathDate && merged.eventDate && current.eventType !== "accident") merged.deathDate = merged.eventDate;
  } else if (merged.permanentImpairment === true) merged.eventType = "disability";
  else if (current.eventType && deterministic.eventType === "hospitalisation" && ["accident", "diagnosis", "disability"].includes(current.eventType)) merged.eventType = current.eventType;
  if (current.eventType === "death" && merged.death === false && !deterministic.eventType) merged.eventType = "other";
  for (const [id, field] of Object.entries(QUESTION_FIELDS)) {
    if (merged[field] != null && merged[field] !== "") merged.uncertainFacts = merged.uncertainFacts.filter(value => value !== id);
  }
  const sourceUpdates = { ...ai, ...deterministic };
  const recordedAt = (args.now ?? new Date()).toISOString();
  for (const [field, value] of Object.entries(sourceUpdates)) {
    if (value == null || (Array.isArray(value) && !value.length)) continue;
    const date = ["eventDate", "diagnosisDate", "deathDate", "accidentDate"].includes(field) ? resolveClaimDate(args.text, args) : null;
    merged.factSources![field] = { source: date?.relative ? "system-derived" : "user", text: args.text, recordedAt,
      ...(date?.relative ? { timeZone: claimTimeZone(args.timeZone), anchorDate: claimLocalToday(args) } : {}) };
  }
  return merged;
}

export function factsToLabels(facts: ClaimFacts) {
  const labels: string[] = [];
  if (facts.eventType) labels.push(facts.eventType === "diagnosis" ? "Diagnosis" : facts.eventType[0].toUpperCase() + facts.eventType.slice(1));
  if (facts.death === true) labels.push(facts.accidentalDeath === true ? "Death caused by an accident (reported)" : "Death reported");
  if (facts.causeOfDeath) labels.push(`Reported cause: ${facts.causeOfDeath}`);
  if (facts.deathDate) labels.push(`Death date ${facts.deathDate}`);
  if (facts.accidentType) labels.push(facts.accidentType);
  if (facts.accidentDate && facts.accidentDate !== facts.eventDate) labels.push(`Accident date ${facts.accidentDate}`);
  if (facts.eventDate && facts.eventDate !== facts.deathDate) labels.push(`Event date ${facts.eventDate}`);
  if (facts.diagnosis) labels.push(facts.diagnosis);
  if (facts.diagnosisDate) labels.push(`Diagnosed ${facts.diagnosisDate}`);
  if (facts.fractureBodyPart) labels.push(`${facts.fractureBodyPart} fracture`);
  else if (facts.injuries.length) labels.push(...facts.injuries);
  if (facts.ambulanceUsed === true) labels.push(facts.ambulanceBill != null ? `Ambulance S$${facts.ambulanceBill.toFixed(2)}` : "Ambulance used");
  if (facts.hospitalised === true) labels.push(facts.hospitalNights != null ? `Hospital ${facts.hospitalNights} night${facts.hospitalNights === 1 ? "" : "s"}` : "Hospitalised");
  if (facts.hospitalBill != null) labels.push(`Hospital bill S$${facts.hospitalBill.toFixed(2)}`);
  if (facts.outOfPocket != null) labels.push(`Out-of-pocket S$${facts.outOfPocket.toFixed(2)}`);
  if (facts.surgery === true) labels.push("Surgery");
  if (facts.permanentImpairment === true) labels.push("Permanent impairment reported");
  if (facts.competitiveRacing === true) labels.push("Competitive racing involved");
  if (facts.competitiveRacing === false) labels.push("No competitive racing reported");
  if (facts.racingAuthoritySanctioned === true) labels.push("Racing sanctioned by MINDEF/MHA (reported)");
  if (facts.racingAuthoritySanctioned === false) labels.push("Racing not sanctioned by MINDEF/MHA (reported)");
  return [...new Set(labels)];
}
