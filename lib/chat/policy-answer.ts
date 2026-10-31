/**
 * V1.1 Task 2 + Task 5: the single answer path for ordinary policy questions.
 *
 * "What is Mei Ling's death cover?", "Does my plan pay hospital cash?",
 * "What premium do I pay?" are answered from the facts stored when the
 * documents were read -- the right person's current documents only -- as
 * structured Assertions, each verified against its cited passage, page,
 * document version and ownership (lib/chat/assertions.ts) before anything is
 * rendered. No document-reading model call is made on this path; a model, if
 * the caller supplies one, may only rephrase the verified text, and its
 * output is rejected if it adds any number, currency, condition or negative.
 *
 * When the stored facts do not cover the topic, `handled` is false and the
 * caller may fall back to the reading path. What was not found is reported
 * as "not found in the documents read" -- never as "not covered".
 */
import { NON_COVER_ROLES, flagUnclearFigures, unclearFigures } from "@/lib/documents/messy";
import { bestLines, columnsFor, narrowToColumn, piecesOf, wordsOf } from "./printed-lines";
import { printedRuleLines } from "./printed-rules";
import { figurePremise, premiseLead, premiseOf } from "./premises";
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { documentName, loadPolicyInventory, type PolicyContract } from "@/lib/policies/inventory";
import { loadBenefitCatalog, type CatalogBenefit } from "@/lib/policies/benefit-catalog";
import { formatMoney, statedCurrencyCode } from "@/lib/format/currency";
import { MONEY_PATTERN, POLICY_STATED_LIMIT_LABEL, POLICY_STATED_LIMIT_NOTICE } from "@/lib/chat/monetary-boundary";
import { amountAppears, dateAppears, normalPassage, rephrasingIsFaithful, verifyAssertions, withPrintedQualifiers, type Assertion, type AssertionDocument, type Rejection } from "./assertions";
import type { ClaimPerson } from "@/lib/claims/person";
import { cleanScannedLine, looksScanned, ocrNoiseShare } from "./scanned-text";
import { replacedFigures } from "@/lib/policies/amendments";
import { bindPassageFact, citeLine, citePageLines } from "./answer-verification";
import type { ChatAnswer, ChatCitation, PolicyStatedLimit } from "@/types";
import { applyReinstatements, supersedePassedGrace, printedPeriodStart, printedReinstatement, countdownLine, daysBetween, longDate, printedPeriodEnd, printedStatus, statusSentence, todayIso, type PrintedStatus } from "./policy-status";

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------
type Topic = { key: string; label: string; asks: RegExp;
  /** A fact whose own name says it is this kind of cover. */
  fact: RegExp;
  /** A document that is this kind of policy: every row on it is this kind of cover. */
  kind?: RegExp;
  /** also require the passage to say it */ passage?: RegExp };
export const TOPICS: Topic[] = [
  { key: "death", label: "death cover", asks: /\b(?:death|die[sd]?|dying|life (?:cover|insurance|assured)|term life|term (?:plan|policy)|pass(?:es)? away)\b/i, fact: /\bdeath\b|\blife\b|(?<!long[- ])\bterm\b/i, kind: /(?<!long[- ])\bterm\b|\blife\b|\bdeath\b/i },
  { key: "critical_illness", label: "critical illness cover", asks: /\b(?:critical illness|early critical|\bci\b|cancer|heart attack|stroke|angioplasty|bypass)\b/i, fact: /critical|cancer|\bci\b|living care/i, kind: /critical|cancer|living care/i },
  { key: "disability", label: "disability cover", asks: /\b(?:disab\w*|tpd|total(?:ly)? (?:and )?permanent)\b/i, fact: /disab|tpd|permanent/i, kind: /disab|\btpd\b/i },
  { key: "infectious", label: "infectious disease cover", asks: /\b(?:dengue|hfmd|infectious|hand,? foot and mouth)\b/i, fact: /dengue|infectious|hfmd/i },
  { key: "accident", label: "accident cover", asks: /\b(?:pa|personal accident|accident\w*|fractur\w*|injur\w*|broken bones?|los(?:e|es|ing|t)\s+(?:a |an |one |two |both |his |her |my |the )?(?:thumb|finger|index finger|eyes?|sight|limbs?|arm|leg|hand|foot|hearing)|thumbs?|index finger|fingers?|loss of (?:hearing|sight|a limb|one limb))\b/i, fact: /accident|fractur|injur|dismember/i, kind: /accident/i },
  // "Hospital" is named by what a hospital plan pays, not by the word
  // "medical" -- an accident plan's "Accident medical reimbursement" and a
  // travel plan's "Overseas medical expenses" are not hospital cover.
  { key: "hospital", label: "hospital cover", asks: /\b(?:hospital\w*|warded|ward|inpatient|surgery|surgical|intensive care|icu)\b|\bmedical (?:cover|coverage|plan|insurance)\b|\b(?:integrated )?shield(?: plan| policy)?\b/i,
    fact: /hospital|\bward\b|inpatient|intensive care|\bicu\b|room and board/i, kind: /hospital|\bshield|\bmedishield\b|health plan/i },
  { key: "premium", label: "the premium", asks: /\bpremiums?\b|\bmedisave\b(?![^?]*\b(?:balance|account|savings)\b)|\bcosts? (?:more|less|the most|the least)\b|\bcheaper\b|\bmore expensive\b|how much do (?:i|we) pay for|\bhow much (?:does|do|is|are) [^?]{1,40}\bcosts?\b|\bcosts? (?:me|us|a year|per year|monthly|each month)\b|\bhow much (?:does|do|did) (?:i|we|she|he|they|[\p{L}]+) (?:need|have) to pay\b(?![^?]*\b(?:hospital|bill|claim|clinic|doctor)\b)|\bhow much (?:do|does) (?:i|we|she|he|they) owe\b|\bhow much cash\b|\bcash (?:payable|portion|part|to pay)\b/iu, fact: /premium/i },
  { key: "maturity", label: "maturity or surrender value", asks: /\b(?:matur\w*|endowment|surrender\w*|cash values?|paid (?:in|into|so far)|put in(?:to)?)\b/i, fact: /matur|surrender|cash value|endowment/i, kind: /endow|savings|matur/i, passage: /matur|surrender|cash value/i },
  { key: "cost_sharing", label: "deductible, co-insurance and co-payment", asks: /\bdeduct[ai]bles?\b|\b(?:a |the )?cap on what (?:i|you|we) pay\b|\bco-?payment cap\b|\bco-?insur[ae]nce\b|\bco-?ins\b|\b(?:how much )?(?:percent(?:age)?|%)\b[^?]{0,40}\bpay\b|^\s*(?:annual |yearly |overall )?limits?\s*\??\s*$|\bco-?pay(?:ment)?s?\b|\bpro-?ration\b|\b(?:policy[- ]year|annual) limit\b|\bas charged\b|\bhow much (?:do|would|will) (?:i|we|she|he|they) (?:have to )?pay\b|\b(?:yearly |annual |a )?cap\b[^?]{0,30}\b(?:pay|out of pocket)\b|\bout of pocket\b/i,
    fact: /deductible|co-?insurance|co-?pay|pro-?ration|policy[- ]year limit|annual limit/i },
  { key: "rider", label: "the rider", asks: /\briders?\b/i, fact: /\brider\b/i },
  { key: "group", label: "group insurance", asks: /\b(?:group|company|employer|employee|work|office|corporate|staff)\b[^?]{0,25}\b(?:insurance|plans?|polic(?:y|ies)|cover(?:age)?|benefits?|scheme)\b|\bgroup (?:insurance|plan|policy|cover|benefits?)\b/i, fact: /(?!)/, kind: /\bgroup\b|employee benefits/i },
  { key: "dental", label: "dental cover", asks: /\b(?:dental|dentist\w*|teeth|tooth)\b/i, fact: /\bdental\b/i },
  { key: "outpatient", label: "outpatient cover", asks: /\b(?:outpatient|gp|general practitioners?|clinics?|specialists?|tcm|chinese medicine)\b/i, fact: /outpatient|general practitioner|\bgp\b|specialist|clinic|chinese medicine/i },
  { key: "maternity", label: "maternity cover", asks: /\b(?:maternity|pregnan\w*|childbirth)\b/i, fact: /maternity|pregnan|childbirth/i },
  // Answered from the person's own column and the schedule line that names it, not from rows.
  { key: "ward", label: "ward class", asks: /\bward (?:class|type)\b|\bwhich ward\b|\bwhat ward\b|\b(?:plan|cover) tier\b|\bwhich (?:tier|plan (?:type|level))\b/i, fact: /(?!)/ },
  // Round 7: whether a policy still covers anyone, from what its own documents print.
  { key: "status", label: "whether it is still in force", asks: /\b(?:still (?:active|valid|in force|covered|current|ok|on|good)|in force|lapsed?|lapsing|active|valid|current|ended|expired|grace period|reinstat\w*|get (?:it|this|that) back|revive|restore|cancelled|deadline|(?:doesn['’]?t|don['’]?t|not) pay)\b/i, fact: /(?!)/ },
  // Answered from the period and renewal lines the documents print.
  { key: "renewal", label: "renewal and expiry dates", asks: /\brenew\w*|\bexpir\w*|\bends?\b|\bending\b|\bhow many days\b(?![^?]*\b(?:treatment|hospital\w*|deferment|waiting|payout|cover(?:ed)?|pay(?:s)?)\b)|\bdays (?:left|until|till|to go)\b|\bdue (?:date|for)\b|\bperiod of (?:insurance|cover)\b|\bvalid (?:until|till)\b|\bwhen does [^?]* (?:end|start)\b/i, fact: /(?!)/ },
  // Round 7: the other kinds of policy a household holds. A row on a car,
  // home, investment-linked or long-term care plan is that kind of cover.
  { key: "excess", label: "the excess", asks: /\bexcess\b/i, fact: /\bexcess\b/i },
  { key: "motor", label: "car insurance", asks: /\b(?:car|motor|vehicle|windscreen|driv(?:e|es|er|ers|ing)|no-?claims? discount|ncd|third[- ]party|own damage)\b/i, fact: /vehicle|windscreen|own damage|third-party|driver|no-claim|\bmotor\b/i, kind: /\bmotor\b|\bvehicle\b|\bcar insurance\b/i },
  { key: "home", label: "home insurance", asks: /\b(?:home|house|flat|hdb|contents|renovations?|jewell?ery|valuables|personal liability|alternative accommodation|hotel)\b/i, fact: /contents|renovation|valuables|liability|accommodation|household|pipe|termite/i, kind: /\bhome\b|\bcontents\b|household/i },
  { key: "investment", label: "the fund value", asks: /\b(?:ilps?|invest(?:ment)?[- ]?link\w*|investments?|funds?|units held|how many units|units? of|bid price|unit price|fund value|account value)\b/i, fact: /\bfunds?\b|\bunits\b|\bunits? (?:held|price)\b|bid price|invest|\baccount value\b/i, kind: /invest|\bilp\b|unit[- ]linked/i },
  { key: "long_term_care", label: "long-term care cover", asks: /\b(?:eldershield|careshield|long[- ]term care|severe(?:ly)? disab\w*|activities of daily living|adls?|deferment)\b/i, fact: /payout|deferment|daily living|long-term care/i, kind: /eldershield|careshield|long[- ]term care/i },
  { key: "travel", label: "travel cover", asks: /\b(?:travel\w*|trip|flight|baggage|luggage|overseas|abroad)\b/i, fact: /travel|trip|flight|baggage|luggage|overseas/i, kind: /travel|trip|voyage|wander/i },
];
const ABOUT_PLAN = /^\s*(?:(?:can you |pls |please )?(?:tell me (?:more )?about|show me|describe|explain|details? (?:of|on|about|for)|what about|summari[sz]e))\b/i;
export const GENERAL = /['’]s [\w -]{2,40} (?:amount|limit|sum insured|payout)\s*\??\s*$|\bhow much (?:was|is) (?:it|that|this) for\b|\bwhat(?:['’]s| is| does) (?:it|that|this) cover(?:ing)?\b|\b(?:assumes?|assumptions?|illustration|illustrated)\b|\bwhat (?:does|do|is) (?:my|our|his|her|their|(?:[\w-]+ ){0,2}[\w-]+(?:'s|’s)) (?:\w+ )?(?:polic(?:y|ies)|plans?|insurance|cover(?:age)?|pa|ci|ilp|shield|gtl|gpa|ghs|riders?|endowment) (?:cover|include)|\bwhat (?:does|do|will|would) [^?]{1,60}\b(?:pay(?: out)?|give|cover)\s*\??\s*$|\btell me about [^?]{0,40}\b(?:plan|policy|insurance|cover)\b|\b(?:plan|policy|insurance) covers? (?:what|wat)\b|\bwhat am i covered for\b|\bwhat (?:cover|coverage|policies|insurance) do (?:i|we|they) have\b|\bsums? (?:insured|assured)\b|\bhow much (?:am i|are we|is \w+) (?:covered|insured) for\b/i;
/** A question that names one particular benefit ("a fracture benefit",
 * "intensive care") is about that benefit, not every row of the plan: a
 * fracture question must not list the permanent-loss schedule. */
const NARROW: { asks: RegExp; fact: RegExp }[] = [
  { asks: /\b(?:skull|spine|spinal)\b/i, fact: /skull|spine/i },
  { asks: /\bfractur\w*|broken bones?\b/i, fact: /fractur/i },
  { asks: /\bintensive care|\bicu\b/i, fact: /intensive care|\bicu\b/i },
  { asks: /\broom and board\b/i, fact: /room and board/i },
  { asks: /\bsurg\w*/i, fact: /surg/i },
  { asks: /\bhospital cash|daily cash\b/i, fact: /cash/i },
  { asks: /\bevacuat\w*/i, fact: /evacuat/i },
  { asks: /\bbaggage|luggage\b/i, fact: /baggage|luggage/i },
  { asks: /\b(?:trip )?cancell?ation\b/i, fact: /cancell?ation/i },
  { asks: /\bambulance\b/i, fact: /ambulance/i },
  { asks: /\bcovid\b/i, fact: /covid/i },
  { asks: /\bdental\b|\bdentist\w*|\bteeth\b|\btooth\b/i, fact: /\bdental\b/i },
  { asks: /\btcm\b|\bchinese medicine\b/i, fact: /chinese medicine/i },
  { asks: /\bgp\b|\bgeneral practitioner/i, fact: /general practitioner/i },
  { asks: /\bspecialists?\b/i, fact: /specialist/i },
  { asks: /\bdialysis\b/i, fact: /dialysis/i },
  { asks: /\bcancer drugs?\b/i, fact: /cancer drug/i },
  { asks: /\bpro-?ration\b/i, fact: /pro-?ration/i },
  { asks: /\bdeduct[ai]bles?\b/i, fact: /deductible/i },
  { asks: /\bco-?insur[ae]nce\b|\bco-?ins\b|\b(?:percent(?:age)?|%)\b[^?]{0,40}\bpay\b/i, fact: /co-?insurance/i },
  { asks: /\bco-?pay(?:ment)?s?\b/i, fact: /co-?pay/i },
  // Round 11: "a yearly cap on what I pay out of pocket": the cap row, not every cost-sharing row.
  { asks: /\b(?:yearly |annual )?cap\b[^?]{0,30}\b(?:pay|pocket)\b|\bout of pocket\b/i, fact: /\bcap\b|maximum co-?pay/i },
  { asks: /\b(?:annual|policy[- ]year|overall|yearly) limit\b|^\s*limits?\s*\??\s*$/i, fact: /\blimit\b/i },
  { asks: /\bovers(?:eas)? medical\b/i, fact: /overseas medical/i },
  { asks: /\bpermanent (?:loss|disablement)|loss of (?:an? |one )?(?:arm|leg|hand|limb|sight)\b/i, fact: /loss of|disablement|dismember/i },
  { asks: /\blos(?:e|es|ing|t|s of)\b[^?]{0,25}\b(?:thumb|finger|index finger)|\b(?:thumb|index finger|fingers?)\b/i, fact: /thumb|finger/i },
  { asks: /\b(?:eye|sight)\b/i, fact: /sight|eye/i },
  { asks: /\bhearing\b|\bdeaf/i, fact: /hearing/i },
  { asks: /\brenovations?\b/i, fact: /renovation/i },
  { asks: /\bjewell?ery|valuables|watch(?:es)?\b/i, fact: /valuables|jewell?ery/i },
  { asks: /\bpersonal liability\b/i, fact: /liability/i },
  { asks: /\b(?:hotel|alternative accommodation|unliveable|unlivable)\b/i, fact: /accommodation/i },
  { asks: /\bcontents\b/i, fact: /contents/i },
  { asks: /\bwindscreen\b/i, fact: /windscreen/i },
  { asks: /\bthird[- ]party property\b/i, fact: /third-party property/i },
  { asks: /\byoung(?:er)? driver|inexperienced|under 26|extra excess|additional excess\b/i, fact: /additional excess|driver under/i },
  { asks: /\bsecurity bond\b/i, fact: /security bond/i },
  { asks: /\bsurrender charges?\b/i, fact: /surrender charge/i },
  { asks: /\bhow old\b|\bwhat age\b|\bage (?:will|would)\b/i, fact: /\bage\b|life assured is \d+/i },
  { asks: /\bnon-?guaranteed\b/i, fact: /not guaranteed|non-guaranteed/i },
  { asks: /\bmedical expenses?\b/i, fact: /medical expenses?/i },
  { asks: /(?<!non-)\bguaranteed\b/i, fact: /guaranteed/i },
  { asks: /\binsurance charges?|charges? (?:paid|deducted|taken)/i, fact: /charges/i },
  { asks: /\bsums? (?:insured|assured)\b|\bof what (?:amount|sum)\b|\bpercentage of what\b/i, fact: /^(?:basic )?sums? (?:insured|assured)\b/i },
  { asks: /\bpost-?hospital\w*|after (?:discharge|hospital)/i, fact: /post-hospital/i },
  { asks: /\bpre-?hospital\w*|before (?:admission|hospital)/i, fact: /pre-hospital/i },
  { asks: /\brestructured\b/i, fact: /restructured/i },
  { asks: /\b(?:stay|go|choose) (?:in )?(?:a )?private\b|\bprivate hospital\b|\bhigher ward\b/i, fact: /pro-?ration|private/i },
  { asks: /\bno[- ]?claims? discount|\bncd\b/i, fact: /no-claim/i },
  { asks: /\bnamed driver|who (?:can|may) drive|(?:son|daughter|someone else|another person|wife|husband) driv/i, fact: /named driver|authori[sz]ed driver/i },
  { asks: /\bfor how long|\bhow long\b(?!\s+(?:more|until|till|before|left|to go))(?![^?]*\b(?:expir\w*|renew\w*|ends?)\b)|maximum (?:payout )?period/i, fact: /period|months|years|days/i },
  { asks: /\bdeferment|starts? paying|before (?:it|eldershield|careshield|the (?:plan|payout|monthly payout)) (?:starts? )?pays?\b/i, fact: /deferment/i },
  { asks: /\bmonthly payout|pay(?:s)? (?:out )?(?:a|per|each) month|how much a month\b/i, fact: /monthly payout/i },
];
/** A question that asks about a premium in any words ("what do I pay a year for it"). */
function isPremiumAsked(question: string) { return /\bpremiums?\b|\bhow much (?:do|does) [^?]{0,30}\bpay (?:a|per|each) (?:year|month)\b|\bcost\w*\b|\bcheap|\bexpensive\b/i.test(question); }
export function questionTopics(question: string): Topic[] {
  // "is dental covered on the hospital plan?": a carried "on the <plan>" says which plan, not what is asked.
  const scoped = question.match(/^(.*\S)\s+on the ([^?]{3,80})\?\s*$/);
  if (scoped && PLAN_KINDS.some((p) => new RegExp("^(?:" + p.re.source + ")$", "i").test(scoped[2].trim()))) {
    const head = questionTopics(scoped[1] + "?");
    if (head.length) return head;
  }
  let asked = TOPICS.filter((t) => t.asks.test(question));
  // "Which ward class is she covered for?" is about her column, not every hospital row.
  if (asked.some((t) => t.key === "ward")) asked = asked.filter((t) => t.key !== "hospital");
  // Round 7 (port): "valid until?" asks the end date, not whether it is still in force.
  if (/\bvalid (?:until|till)\b|\buntil when\b/i.test(question) && asked.some((t) => t.key === "renewal")) asked = asked.filter((t) => t.key !== "status");
  // Round 10: "if Mama falls at home" is where a person was hurt, not a question about home insurance.
  if (/\b(?:falls?|fell|slip(?:s|ped)?|trip(?:s|ped)?|hurt|injur\w*)\b[^?]{0,30}\bat home\b/i.test(question) && !/\b(?:house|flat|hdb|contents|renovations?|jewell?ery|valuables|home insurance|home policy)\b/i.test(question)) asked = asked.filter((t) => t.key !== "home");
  // "When does her accident plan end?", "Does his group plan cover dental?":
  // the words that only name the plan are not a second topic.
  if (asked.length > 1) {
    // A topic word inside a plan-naming phrase ("my car insurance", "her shield plan") only says which plan.
    const attribute = asked.some((t) => ["premium", "renewal", "cost_sharing", "excess", "rider", "ward", "dental", "maternity", "outpatient", "status"].includes(t.key));
    const planSpans = attribute ? PLAN_KINDS.flatMap((p) => [...question.matchAll(new RegExp(p.re.source, "gi"))].filter((m) => /\b(?:plan|policy|insurance|claims?|excess|premium)$/i.test(m[0]) || /^(?:eldershield|careshield|ilps?|invest-link|endowment)$/i.test(m[0])).map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].replace(/\s+(?:excess|premium)$/i, "").length])) : [];
    // ("how much do we pay for insurance each month?": a phrase ending in "for" asks about what follows; it names no plan.)
    const namingOnly = (t: Topic) => { const m = question.match(t.asks); return !!m && (attribute && (t.key === "hospital" && /^(?:integrated )?shield$/i.test(m[0]) || t.key === "accident" && /^(?:pa|personal accident)$/i.test(m[0])) || !/\b(?:for|of|on|towards?)\s*$/i.test(m[0]) && /^\s*(?:plan|policy|insurance|cover(?:age)?)\b/i.test(question.slice((m.index ?? 0) + m[0].length)) || planSpans.some(([a, b]) => (m.index ?? 0) >= a && (m.index ?? 0) < b)); };
    const specific = asked.filter((t) => !namingOnly(t));
    if (specific.length) asked = specific;
  }
  // Round 11: "if I injure another driver, is third-party injury covered?" is about the car policy, not accident cover.
  if (asked.some((t) => t.key === "motor") && /\bthird[- ]party|\bdriver\b|\bcar\b|\bvehicle\b/i.test(question)) asked = asked.filter((t) => t.key !== "accident");
  // "Which policies have lapsed or expired?" is about status, not renewal dates.
  if (asked.some((t) => t.key === "status") && asked.some((t) => t.key === "renewal") && /\b(?:lapsed|expired|ended)\b/i.test(question) && !/\bwhen\b/i.test(question)) asked = asked.filter((t) => t.key !== "renewal");
  // "the sum assured on my lapsed term plan": "lapsed" says which plan.
  if (asked.some((t) => t.key === "status") && /\b(?:my|the|his|her|their|our)\s+(?:lapsed|expired|old|ended|cancelled)\s+(?:\w+\s+)?(?:plan|policy|insurance|cover)\b/i.test(question) && !/\b(?:still|in force|active|valid|when did|why|reinstat)/i.test(question))
    asked = asked.filter((t) => t.key !== "status");
  // "Does his group plan cover dental?": "group plan" says which plan
  // (PLAN_KINDS scopes to it); the question is about dental.
  if (asked.length > 1 && asked.some((t) => t.key === "group")) asked = asked.filter((t) => t.key !== "group");
  // "The co-insurance on her shield plan": "shield plan" says which plan.
  const hospitalTopic = TOPICS.find((t) => t.key === "hospital")!;
  if (asked.some((t) => t.key === "cost_sharing") && !hospitalTopic.asks.test(question.replace(/\b(?:integrated )?shield(?: plan| policy)?\b|\b(?:hospital|medical) (?:plan|policy|insurance|cover)\b/gi, "")))
    asked = asked.filter((t) => t.key !== "hospital");
  // "How much do we pay in premiums?" is a premium question, not a cost-sharing one.
  if (asked.some((t) => t.key === "premium") && !/\bdeduct[ai]ble|\bco-?insur|\bco-?pay|\bpro-?ration|\blimit\b|\bas charged\b/i.test(question)) asked = asked.filter((t) => t.key !== "cost_sharing");
  // "When is the grace period for his premium?" asks about the grace period, not the premium figure.
  if (/\bgrace period\b/i.test(question)) asked = asked.filter((t) => t.key !== "premium" && t.key !== "renewal");
  // "Overseas medical cover" is a travel question; it names hospital cover
  // only if it actually says hospital, ward, surgery or intensive care.
  if (asked.some((t) => t.key === "travel") && !/\b(?:hospital\w*|warded|ward|inpatient|surg\w*|intensive care|icu)\b/i.test(question))
    return asked.filter((t) => t.key !== "hospital");
  return asked;
}

// ---------------------------------------------------------------------------
// Loading the stored facts (cheap SQL; eligible pieces cached)
// ---------------------------------------------------------------------------
type Columns = Record<string, Set<string>>;
let columnCache: Promise<Columns> | null = null;
/** Which of the V1.1 evidence columns exist yet (written by ingestion). The
 * answer path works without them and uses them when they are there. */
async function evidenceColumns(): Promise<Columns> {
  columnCache ??= query<{ table_name: string; column_name: string }>(
    `SELECT table_name,column_name FROM information_schema.columns
      WHERE table_name IN ('policy_coverages','policy_benefits','policies')
        AND column_name IN ('source_text_start','source_text_end','passage_verified','conflict_note','extraction_method','document_date')`)
    .then((r) => { const out: Columns = {}; for (const row of r.rows) (out[row.table_name] ??= new Set()).add(row.column_name); return out; })
    .catch(() => { columnCache = null; return {}; });
  return columnCache;
}
type Evidence = { source_text_start: number | null; source_text_end: number | null; passage_verified: boolean | null; conflict_note: string | null };
async function evidenceFor(table: "policy_coverages" | "policy_benefits", accountId: string, ids: string[]): Promise<Map<string, Evidence>> {
  const cols = (await evidenceColumns())[table] ?? new Set();
  const wanted = ["source_text_start", "source_text_end", "passage_verified", "conflict_note"].filter((c) => cols.has(c));
  if (!ids.length || !wanted.length) return new Map();
  const r = await query<Evidence & { id: string }>(`SELECT id::text AS id,${wanted.join(",")} FROM ${table} WHERE account_id=$1 AND id::text=ANY($2::text[])`, [accountId, ids]);
  return new Map(r.rows.map((row) => [row.id, { source_text_start: row.source_text_start ?? null, source_text_end: row.source_text_end ?? null,
    passage_verified: row.passage_verified ?? null, conflict_note: row.conflict_note ?? null }]));
}
type DocRow = { id: string; account_id: string; policy_type: string | null; policy_number: string | null; document_role: string | null; lifecycle_state: string; superseded_at: string | null; quarantine_status: string | null; file_hash: string | null;
  effective_date: string | null; renewal_or_expiry_date: string | null; document_date: string | null; product_name: string | null; insurer: string | null;
  original_filename: string; updated_at: string; personal_coverage_confirmed: boolean };

/** Page text, cached per household + document checksum + version. A new
 * version (new checksum or updated_at) is a new key, so nothing stale is
 * served; the household is part of the key, so nothing crosses households. */
const PAGE_CACHE = new Map<string, { text: string | null; at: number }>();
const PAGE_CACHE_TTL_MS = 10 * 60_000, PAGE_CACHE_MAX = 2_000;
async function pageTexts(accountId: string, docs: Map<string, DocRow>, wanted: { policyId: string; page: number }[]) {
  const key = (w: { policyId: string; page: number }) => { const d = docs.get(w.policyId); return [accountId, w.policyId, d?.file_hash ?? "", d?.updated_at ?? "", w.page].join("|"); };
  const now = Date.now(), out = new Map<string, string | null>(), missing: { policyId: string; page: number }[] = [];
  for (const w of wanted) {
    const hit = PAGE_CACHE.get(key(w));
    if (hit && now - hit.at < PAGE_CACHE_TTL_MS) out.set(w.policyId + "#" + w.page, hit.text); else missing.push(w);
  }
  if (missing.length) {
    const r = await query<{ policy_id: string; page_number: number; text: string }>(
      `SELECT pp.policy_id::text AS policy_id,pp.page_number,pp.text FROM policy_pages pp
         JOIN unnest($2::text[],$3::int[]) AS w(policy_id,page) ON w.policy_id=pp.policy_id::text AND w.page=pp.page_number
        WHERE pp.account_id=$1`, [accountId, missing.map((m) => m.policyId), missing.map((m) => m.page)]);
    const found = new Map(r.rows.map((row) => [row.policy_id + "#" + row.page_number, row.text]));
    for (const m of missing) {
      const text = found.get(m.policyId + "#" + m.page) ?? null;
      out.set(m.policyId + "#" + m.page, text);
      if (PAGE_CACHE.size >= PAGE_CACHE_MAX) PAGE_CACHE.delete(PAGE_CACHE.keys().next().value as string);
      PAGE_CACHE.set(key(m), { text, at: now });
    }
  }
  return out;
}

/** The verbatim span of `page` that supports a stored fact: the recorded
 * offsets when ingestion stored them, else the stored quote as it appears on
 * the page, else the sentence on the page that contains the amount. Returns
 * the stored quote unchanged when none of those is on the page -- which the
 * verifier then rejects as a citation to the wrong place. */
export function locatePassage(page: string | null, opts: { start?: number | null; end?: number | null; quote?: string | null; amount?: number | null }): string {
  if (page && opts.start != null && opts.end != null && opts.start >= 0 && opts.end > opts.start && opts.end <= page.length) return page.slice(opts.start, opts.end).trim();
  const quote = (opts.quote ?? "").trim();
  if (page && quote) {
    if (normalPassage(page).includes(normalPassage(quote))) return quote;
  }
  if (page && opts.amount != null) {
    const sentence = page.split(/(?<=[.;\n])\s+/).find((s) => amountAppears(opts.amount!, s));
    if (sentence) return sentence.trim().slice(0, 400);
  }
  return quote;
}
function shortDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
/** A money figure the way a schedule prints it: "S$800", not "S$800.00". */
function money(amount: number, currency: string) { const text = formatMoney(amount, currency); return Number.isInteger(amount) ? text.replace(/\.00$/, "") : text; }

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------
export type PolicyAnswerArgs = {
  accountId: string; question: string;
  /** The insured people this question is about, already resolved by the caller (same household). */
  people: ClaimPerson[];
  /** Round 10: the message as sent, when the question answered is a carried-over one ("how much?" after a cover question). */
  message?: string;
  /** Round 12: the household asked for every line ("show me the full list" after a short answer). */
  fullList?: boolean;
  now?: Date;
  /** Optional rephrasing of the verified text. Its output is checked and discarded if it adds anything. */
  narrate?: (input: { question: string; text: string; assertions: Assertion[] }) => Promise<string | null>;
};
export type PolicyAnswer = Pick<ChatAnswer, "mode" | "summary" | "details" | "citations" | "confidence" | "nextSteps" | "questions" | "verifiedPolicyFactsOnly" | "verifiedPolicyFigures"> & { policyStatedLimits: PolicyStatedLimit[] };
export type PolicyAnswerResult = {
  /** false: the stored facts do not cover this topic; the caller may read the documents instead. */
  handled: boolean;
  answer: PolicyAnswer;
  kept: Assertion[]; rejected: Rejection[];
  topics: string[]; notFound: string[];
  modelCalls: number; narrated: boolean; elapsedMs: number;
};
type Candidate = Assertion & { id: string; source: "coverage" | "benefit" | "premium" | "row" | "condition" | "expiry"; topic: string; title: string; ownerName: string;
  /** The table column (plan tier / ward class / person class) a value was printed under. */
  tier?: string | null; rowKind?: string | null; tierLabel?: string | null };
/** A stored fact before its passage is located on the page. */
type RawCandidate = Omit<Candidate, "passage"> & { quote: string | null; start: number | null; end: number | null; storedConditions?: string[] };

// ---------------------------------------------------------------------------
// Deterministic reading of stored page text: schedule rows and condition lines
// ---------------------------------------------------------------------------
type PageRow = { page: number; index: number; label: string; value: string; line: string };
type ConditionLine = { page: number; index: number; line: string; heading?: string | null };
/** Text addressed to a reader or a model rather than stating a term. */
const INSTRUCTION = /\b(?:ignore (?:all |any )?(?:the )?(?:previous|prior|above|earlier) (?:instructions|rules)|note to (?:ai|assistants?|the model|models)|ai assistants?|system prompt|you are (?:an? )?(?:ai|assistant|language model))\b/i;
const FURNITURE = /SYNTHETIC(?:-[A-Z0-9-]+)? TEST DOCUMENT|^Page \d+ of \d+$|DPTEST|^[A-Za-z0-9+/=]{40,}$/i;
const META_LABEL = /^(?:policy ?(?:number|no\.?|type)|certificate (?:number|no\.?)|member(?:ship)? (?:number|no\.?)|insured(?: persons?)?|life assured|policyholder|group policyholder|issued by|effective date(?: of endorsement)?|expiry date|end date|start date|currency|plan(?: name)?|period of insurance|(?:policy |renewal |cover(?:age)? )?period|date of (?:issue|birth)|issue date|payment (?:due date|mode|date|method)|policy term|premium term|grace period|grace period ends|premium due date|next renewal date|renewal date|statement date|date|commencement date|maturity date|policy start date|cover start date|policy owner|policyholder and life assured|insured (?:person|persons|helper|address)|address|insured address|employer|vehicle|registration|destination|life assured|status)$/i;
const MONTH_DATE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/i;
/** Words product names share with ordinary questions ("the annual limit",
 * "my family", "group cover"): they never name one document. */
export const COMMON_PRODUCT_WORD = /^(?:annual|family|group|premier|premium|programme|program|plus|classic|basic|standard|personal|accident|travel|health|hospital|medical|life|term|secure|guardian|shield|care|protect|protection|saver|gold|silver|platinum|benefits?|employee|schedule|certificate|renewal|notice|integrated|critical|illness|cover|global|family|essential|elite|advantage)$/i;
/** A premium the household pays, printed in a schedule or notice. Never a
 * benefit, a limit or a conflicting figure for a benefit. */
export const PREMIUM_ROW = /\bpremium\b|\bmedisave\b|\bcash payable\b|\bpayable (?:in|by) cash\b|\bamount (?:due|payable)\b|^\s*less\s*:/i;
/** The English half of a bilingual cell ("Bayaran bulanan / Monthly payout",
 * "保证满期价值 Guaranteed maturity value", "S$2,460.00, payable for 18 years 缴费18年").
 * A cell with no second language is returned unchanged. */
export function englishPart(cell: string) {
  let text = cell.trim();
  // Chinese (or Japanese/Korean) words beside the English: keep the English.
  if (/[\u3400-\u9FFF]/.test(text) && /[A-Za-z]{3}/.test(text))
    text = text.replace(/^[\u3400-\u9FFF\u3000-\u303F\uFF00-\uFFEF\s]+(?=[A-Za-z(S$\d])/, "").replace(/\s+[\u3400-\u9FFF][\u3400-\u9FFF\d\u3000-\u303F]*$/, "").trim();
  // "(受保人25岁 when the life assured is 25)": the Chinese inside a bracket, before its English.
  text = text.replace(/\(\s*[\u3400-\u9FFF][\u3400-\u9FFF\d\u3000-\u303F]*\s+(?=[A-Za-z])/g, "(");
  // "Malay words / English words": one slash, outside brackets, two words or more on each side.
  const parts = text.split(" / ");
  if (parts.length === 2 && !/\([^)]*$/.test(parts[0]) && parts.every((x) => x.trim().split(/\s+/).length >= 2) && /[A-Za-z]/.test(parts[1])) text = parts[1].trim();
  return text;
}
/** A table's own header row ("Benefit<TAB>Limit", "Event caused by an accident<TAB>% of sum insured", "Manfaat / Benefit<TAB>Jumlah / Amount"). */
function isHeaderRow(label: string, value: string) {
  const both = (cell: string) => [cell, ...cell.split(" / ")].map((x) => x.trim());
  const valueHead = both(value).some((v) => /^(?:amount|value|benefit|limits?|sum (?:insured|assured)|premium|details?|limit or excess|%\s*of (?:the )?sum (?:insured|assured)|percentage(?: of (?:the )?sum (?:insured|assured))?)$/i.test(v));
  const labelHead = both(label).some((l) => /^(?:item|benefits?|description|particulars|section|details?|cover(?:age)?|other benefits|rider benefit|event(?: caused by an accident)?|injury|loss)$/i.test(l));
  return valueHead && (labelHead || /%\s*of (?:the )?sum/i.test(value));
}
/** Labelled prose a schedule prints as a sentence ("Death benefit: the higher of …"). */
const PROSE_FACT = /^(death benefit|maturity benefit|surrender value|monthly payout|fund value|surrender charge)\s*:\s*(.{5,})$/i;
/** Rows ("Label<TAB>value") and, on a conditions page, its sentences, exactly
 * as stored. Nothing is inferred; a row is only what the page prints. */
export function readPage(page: number, text: string) {
  const rows: PageRow[] = [], conditions: ConditionLine[] = [], meta: PageRow[] = [], premiums: PageRow[] = [], prose: ConditionLine[] = [];
  // Round 10: a two-cell row printed under a three-column layout keeps an
  // empty middle slot ("Premiums paid in total<TAB><TAB>S$43,560.00"); it is a
  // label and a value all the same.
  const lines = text.split(/\r?\n/).map((l) => l.trim()).map((l) => (l.split("\t").filter((c) => c.trim()).length === 2 ? l.replace(/\t{2,}/g, "\t") : l));
  const heading = lines.find((l) => l && !FURNITURE.test(l)) ?? "";
  // A multi-column table (a line of three or more cells) is read from the
  // typed rows ingestion stores per column. The two-cell lines right beside
  // its rows are the wrapped remainders of those cells ("ward)<TAB>(B1
  // ward)", "days<TAB>days"), never label-value rows. Round 10: only those --
  // an e-statement prints small two-column tables on the same page as a
  // three-column one, and those rows are rows.
  const wide = (l: string | undefined) => ((l ?? "").match(/\t/g) ?? []).length >= 2;
  // (Round 7 port: a table's own total -- "Total account value<TAB><TAB><TAB>S$21,385.40" -- is a row, not a wrapped cell.)
  const remainder = (index: number) => (wide(lines[index - 1]) || wide(lines[index + 1])) && !/^(?:total|grand total|overall)\b[^\t]*\t\s*(?:S\$|SGD|US\$|USD)\s?\d/i.test(lines[index] ?? "");
  // Prose (everything that is not a table cell) is re-joined across wrapped
  // lines and read as whole sentences, each under the numbered heading it
  // sits beneath ("5. Grace period"), so a condition is never cut mid-line.
  let chunk: { index: number; text: string; heading: string | null }[] = [];
  let section: string | null = /\b(?:exclusions?|conditions|general provisions)\b/i.test(heading) ? heading.replace(/\s+/g, " ") : null;
  const flush = () => {
    const joined = chunk.map((p) => p.text).join(" ").replace(/\s+/g, " ").trim();
    if (joined) for (const sentence of joined.split(/(?<=[.;。])\s+(?=[A-Z(“\"'\-\u3400-\u9FFF])/)) {
      const clean = sentence.replace(/^[-•*]\s*/, "").trim();
      if (clean.length < 12 || INSTRUCTION.test(clean)) continue;
      prose.push({ page, index: chunk[0].index * 100 + prose.length, line: clean, heading: chunk[0].heading });
      // Terms are read on a conditions page, under a section heading, or where
      // the line names the term; loose text elsewhere (and anything addressed
      // to a reader, "ignore previous instructions") is never a condition.
      const isTerm = !!chunk[0].heading || /^(?:waiting period|survival period|grace period|exclusions?|alternative benefits?)\s*:/i.test(clean) || /\b(?:waiting|survival|deferment) period of \d+/i.test(clean);
      if (isTerm) conditions.push({ page, index: chunk[0].index * 100 + conditions.length, line: clean, heading: chunk[0].heading });
      // "Death benefit: the higher of the basic sum assured or the total fund value."
      const english = /[\u3400-\u9FFF]/.test(clean) ? (clean.match(/\b([A-Z][A-Za-z -]{2,40}):/)?.[1] ?? "") + ": " + clean.split(/。\s*/).filter((x) => x && !/[\u3400-\u9FFF]/.test(x)).join(" ").trim() : clean;
      const fact = english.match(PROSE_FACT);
      if (fact) rows.push({ page, index: chunk[0].index, label: fact[1].replace(/^\w/, (c) => c.toUpperCase()), value: fact[2].trim(), line: clean });
    }
    chunk = [];
  };
  let last: PageRow | null = null, lastIndex = -2;
  // A table whose header says its rows are "% of sum insured": each bare percentage is of that sum.
  let scale: string | null = null;
  // Round 10: a small table whose value column is headed with its currency
  // ("Value<TAB>S$", "Amount (S$)") prints its amounts bare: each is in that
  // currency, and the row's passage runs from the heading down to the row, so
  // the currency is written in what is cited.
  let columnCurrency: { mark: string; at: number } | null = null;
  lines.forEach((line, index) => {
    if (!line || FURNITURE.test(line) || line === heading) { flush(); return; }
    const row = line.match(/^([^\t]{1,120})\t([^\t]{1,200})$/);
    if (row) {
      flush();
      const rawLabel = row[1].trim(), rawValue = row[2].trim();
      // A cell wrapped onto the next line: "Annual premium (MediGuard Class A Ward<TAB>S$742.00, … S$142.00 is" /
      // "Plan)<TAB>payable in cash" is one row.
      if (last && lastIndex === index - 1 && ((((last.label.match(/\(/g) ?? []).length > (last.label.match(/\)/g) ?? []).length) && /^[^\t(]{1,40}\)/.test(rawLabel)) || /^[a-z]/.test(rawLabel))) {
        last.label = last.label + " " + rawLabel; last.value = last.value + " " + rawValue; last.line = last.line + "\n" + line; lastIndex = index; return;
      }
      const r: PageRow = { page, index, label: englishPart(rawLabel), value: englishPart(rawValue), line };
      const currencyHead = rawValue.match(/^(?:(?:amount|value|total)\s*)?\(?\s*(S\$|SG\$|SGD)\s*\)?$/i);
      if (currencyHead) { columnCurrency = { mark: /SGD/i.test(currencyHead[1]) ? "SGD " : "S$", at: index }; last = null; return; }
      // A table's own header ("Item<TAB>Amount") is not a row.
      if (isHeaderRow(rawLabel, rawValue)) { scale = /%\s*of (?:the )?sum (insured|assured)/i.exec(rawValue)?.[1] ?? null; columnCurrency = null; last = null; return; }
      if (columnCurrency && /^\d[\d,]*(?:\.\d{1,2})?$/.test(r.value)) { r.value = columnCurrency.mark + r.value; r.line = lines.slice(columnCurrency.at, index + 1).filter(Boolean).join("\n"); }
      // A continuation of a wrapped cell starts mid-sentence.
      if (/^[a-z(]/.test(r.label) || !/[A-Za-z]{3}/.test(r.label)) return;
      if (scale && /^\d+(?:\.\d+)?%$/.test(r.value)) r.value += " of the sum " + scale;
      last = r; lastIndex = index;
      // (Round 7 port: "Insured: NAME<TAB>Policy number: X" is particulars, not a row -- unless its value is an amount,
      // as in "Additional excess: driver under 26 ...<TAB>S$2,500".)
      if (META_LABEL.test(r.label) || (/:\s*\S/.test(r.label) && !MONEY_IN_TEXT.test(r.value)) || (MONTH_DATE.test(r.value) && !MONEY_IN_TEXT.test(r.value))) { meta.push(r); return; }
      if (PREMIUM_ROW.test(r.label)) { premiums.push(r); return; }
      if (!remainder(index)) rows.push(r);
      return;
    }
    if ((line.match(/\t/g) ?? []).length || /^Dear\b[^.]{0,60},$/.test(line)) { flush(); last = null; columnCurrency = null; return; }
    // A wrapped continuation of a label ("stage)", "Rider)") belongs to the row above.
    if (last && lastIndex === index - 1 && /^[^\t]{1,40}\)$/.test(line) && (last.label.match(/\(/g) ?? []).length > (last.label.match(/\)/g) ?? []).length) { last.label += " " + line; last.line += "\n" + line; lastIndex = index; return; }
    if (/^[a-z][^\t]{0,40}\)$/.test(line) && /\t/.test(lines[index - 1] ?? "")) return;
    // A wrapped value ("… no further" / "premium is payable.") belongs to the row above.
    if (last && lastIndex === index - 1 && /^[a-z]/.test(line) && /(?:\b(?:no|further|of|and|the|is|to|a|an|for|with|or|in|on|at|from|by|are|be)|,)$/i.test(last.value)) { last.value += " " + line; last.line += "\n" + line; lastIndex = index; return; }
    last = null; columnCurrency = null;
    const numbered = line.match(/^(?:\d{1,2}[.)]|[A-Z][.)])\s+([A-Z][^.]{2,60})$/);
    if (numbered || /^[A-Z][A-Z &'-]{4,60}$/.test(line)) { flush(); section = numbered ? numbered[1].trim() : line; scale = null; return; }
    chunk.push({ index, text: line, heading: section });
  });
  flush();
  return { rows, conditions, meta, premiums, prose };
}
const MONEY_IN_TEXT = /(S\$|SG\$|US\$|HK\$|A\$|SGD|USD|HKD|AUD|MYR|RM|EUR|GBP|JPY|€|£|¥)\s?(\d[\d,]*(?:\.\d+)?)/i;
/** The first amount a printed value states, with its printed currency; or
 * the bare number when the value prints no currency at all. */
export function printedAmount(value: string): { amount: number | null; currency: string | null; bare: boolean } {
  const m = value.match(MONEY_IN_TEXT);
  if (m) { const currency = statedCurrencyCode(m[1]); return { amount: currency ? Number(m[2].replace(/,/g, "")) : null, currency, bare: !currency }; }
  // "150 per day" prints an amount without a currency; a date, a count of
  // days, a percentage or a multiple ("5 x MediShield Life limit") does not.
  if (MONTH_DATE.test(value)) return { amount: null, currency: null, bare: false };
  const bare = /^\s*(?:up to\s+)?\d[\d,]*(?:\.\d+)?(?!\s*(?:%|x\b|times\b|days?\b|months?\b|years?\b|hours?\b|nights?\b|weeks?\b))(?:\s|$)/i.test(value);
  return { amount: null, currency: null, bare };
}
/** Pages of the documents in play, cached per household + checksum + version. */
async function documentPages(accountId: string, docs: Map<string, DocRow>) {
  const ids = [...docs.keys()];
  if (!ids.length) return new Map<string, { page: number; text: string }[]>();
  const r = await query<{ policy_id: string; page_number: number; text: string }>(
    `SELECT policy_id::text AS policy_id,page_number,text FROM policy_pages WHERE account_id=$1 AND policy_id::text=ANY($2::text[]) ORDER BY policy_id,page_number`, [accountId, ids]);
  const out = new Map<string, { page: number; text: string }[]>();
  for (const row of r.rows) (out.get(row.policy_id) ?? out.set(row.policy_id, []).get(row.policy_id)!).push({ page: row.page_number, text: row.text });
  return out;
}
const CONDITION_QUESTION = /\bwaiting period|\bsurvival period|\bgrace period|\bexclu\w*|\bpre-existing|\bboth\b[^?]*\b(?:paid|payable|pay)\b|\balternative benefits?|\bonly the higher\b/i;
const SUBJECTS = /\b(dental|maternity|pregnan\w*|cosmetic|mental|psychiatric|hiv|war|terroris\w*|suicide|self-inflicted|professional sports?|pre-existing)\b/i;
export const PLAN_KINDS: { re: RegExp; kind: string }[] = [
  { re: /\bhospital (?:plan|policy|insurance|cover)\b|\b(?:integrated )?shield (?:plan|policy)\b/i, kind: "hospital" },
  { re: /\btravel (?:plan|policy|insurance|cover|premium)\b/i, kind: "travel" },
  { re: /\b(?:personal )?accident (?:plan|policy|insurance|premium)\b|\bpa (?:plan|policy|cover|premium)\b/i, kind: "accident" },
  { re: /\b(?:group |term )?life (?:plan|policy|insurance|cover)\b|\bterm (?:plan|policy)\b/i, kind: "death" },
  { re: /\bendowment\b|\bsavings (?:plan|policy)\b/i, kind: "maturity" },
  { re: /\bcritical illness (?:plan|policy|cover)\b|\bci (?:plan|policy|cover)\b/i, kind: "critical_illness" },
  { re: /\b(?:group|company|employer|work) (?:plan|policy|insurance|cover)\b/i, kind: "group" },
  { re: /\b(?:home|house|contents) (?:plan|policy|insurance|cover|claims?|excess|premium)\b/i, kind: "home" },
  { re: /\b(?:car|motor|vehicle) (?:plan|policy|insurance|cover|claims?|excess|premium)\b|\b(?:car|motor|vehicle|road) accident claims?\b|\b(?:scratched|dented|hit|crashed|damaged|bumped) (?:the|my|our) car\b/i, kind: "motor" },
  { re: /\bilps?\b|\binvestment[- ]linked (?:plan|policy)\b|\binvest-link\b/i, kind: "investment" },
  { re: /\b(?:eldershield|careshield|long[- ]term care (?:plan|policy|insurance|cover))\b/i, kind: "long_term_care" },
];
/** Schedule terms (round 5 typed rows): cost-sharing and limits printed in a
 * benefit table. Stated as the document prints them; never calculated. */
const COST_SHARING_KINDS = new Set(["deductible", "co_insurance", "co_payment", "co_payment_cap", "pro_ration", "policy_year_limit", "family_limit"]);
function scheduleTermText(kind: string, value: number | null, currency: string | null): { text: string; amount: number | null } | null {
  const amount = value != null && value > 0 && currency ? value : null;
  const percent = value != null && value > 0 && value <= 1 ? Math.round(value * 10000) / 100 + "%" : null;
  switch (kind) {
    case "as_charged": return { text: "as charged", amount: null };
    case "not_covered": return { text: "the schedule prints “Not covered” in this column", amount: null };
    case "unlimited": return { text: "no limit printed", amount: null };
    case "deductible": return amount != null ? { text: "deductible of " + money(amount, currency!) + " (paid by you first)", amount } : null;
    case "co_insurance": return percent ? { text: "you pay " + percent + " (co-insurance)", amount: null } : null;
    case "co_payment": return amount != null ? { text: "co-payment of " + money(amount, currency!), amount } : percent ? { text: "co-payment of " + percent, amount: null } : null;
    case "co_payment_cap": return amount != null ? { text: "your co-payment is capped at " + money(amount, currency!) + " a policy year", amount } : null;
    case "pro_ration": return percent ? { text: "pro-ration factor of " + percent + ", applied when you stay in a higher ward than your plan covers", amount: null } : { text: "the schedule prints “Not applicable” in this column", amount: null };
    case "policy_year_limit": case "family_limit": return amount != null ? { text: "limit of " + money(amount, currency!) + (kind === "family_limit" ? " for the family" : " a policy year"), amount } : null;
    default: return null;
  }
}
/** Same rule as ingestion's tierApplies: a column heading may carry more
 * words than the stored class ("Plan A (Grade M2 and above)"). */
export function tierApplies(rowTier: string | null | undefined, memberTier: string | null | undefined) {
  if (!rowTier || !memberTier) return true;
  const row = rowTier.toLowerCase().replace(/\s+/g, " ").trim(), member = memberTier.toLowerCase().replace(/\s+/g, " ").trim();
  return row === member || (row.startsWith(member) && !/[a-z0-9]/.test(row.charAt(member.length)));
}
async function tableTerms(accountId: string, ids: string[]) {
  const out = new Map<string, { tier: string | null; rowKind: string | null }>();
  if (!ids.length) return out;
  const r = await query<{ id: string; tier: string | null; row_kind: string | null }>(
    `SELECT id::text AS id,to_jsonb(b)->>'tier' AS tier,to_jsonb(b)->>'row_kind' AS row_kind FROM policy_benefits b WHERE account_id=$1 AND id::text=ANY($2::text[])`, [accountId, ids]).catch(() => ({ rows: [] as { id: string; tier: string | null; row_kind: string | null }[] }));
  for (const row of r.rows) out.set(row.id, { tier: row.tier || null, rowKind: row.row_kind || null });
  return out;
}
async function memberTiers(accountId: string, docIds: string[]) {
  const out = new Map<string, string>();
  if (!docIds.length) return out;
  const r = await query<{ policy_id: string; family_member_id: string; tier: string | null }>(
    `SELECT policy_id::text AS policy_id,family_member_id::text AS family_member_id,to_jsonb(pm)->>'benefit_tier' AS tier FROM policy_members pm WHERE account_id=$1 AND policy_id::text=ANY($2::text[])`, [accountId, docIds]).catch(() => ({ rows: [] as { policy_id: string; family_member_id: string; tier: string | null }[] }));
  for (const row of r.rows) if (row.tier) out.set(row.policy_id + "|" + row.family_member_id, row.tier);
  return out;
}
function ageOn(dob: string, now: Date) {
  const d = new Date(dob.slice(0, 10) + "T00:00:00Z");
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  if (now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}
/** "age 80 and below" / "age 81 and above" / "aged 81+" in a row's label. */
function ageBand(text: string): { kind: "max" | "min"; age: number; text: string } | null {
  const m = text.match(/\bage[ds]?\s*(\d{1,3})\s*(?:years?\s*)?(?:and|or|&)\s*(below|under|younger|less|above|over|older)\b/i);
  if (m) return { kind: /below|under|younger|less/i.test(m[2]) ? "max" : "min", age: Number(m[1]), text: m[0].toLowerCase() };
  const plus = text.match(/\bage[ds]?\s*(\d{1,3})\s*\+/i);
  if (plus) return { kind: "min", age: Number(plus[1]), text: plus[0].toLowerCase() };
  return null;
}
/** "Death" and "Death benefit" and "Death (any cause)" are the same thing. */
function sameThingKey(title: string) {
  // Round 10: an age band ("(age 80 and below)" / "(age 81 and above)") names a different row, not the same one.
  const key = title.toLowerCase().replace(/\btpd\b/g, "total and permanent disability").replace(/\btotal (?:&|and) permanent\b/g, "total and permanent").replace(/\((.*?)\)/g, (_m, inner: string) => /\bage[sd]?\b|\byears? old\b|\b(?:adult|child|senior)\b/.test(inner) ? " " + inner + " " : " ").replace(/\b(?:benefits?|sum (?:insured|assured)|cover(?:age)?)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  // Round 7 (port): a life policy's "Life", "Death" and "Sum assured" are one figure.
  return /^(?:life|death|life cover|death cover|sum|main|basic)$/.test(key) ? "death" : key;
}

/** The Latin-script tail of a bilingual table heading ("总退保价值 (4.25%) Total surrender value at 4.25%"). */
const latinTail = (cell: string) => (cell.match(/[A-Za-z][A-Za-z0-9 .,%()$'-]*$/)?.[0] ?? cell).trim();
export type ValueTable = { page: number; header: string[]; rows: { year: number; label: string; cells: string[]; line: string }[] };
/** A surrender or maturity value table ("Policy year<TAB>Total premiums paid<TAB>Guaranteed surrender value …"), as printed. */
export function valueTables(pages: { page: number; text: string }[]): ValueTable[] {
  const out: ValueTable[] = [];
  for (const p of pages) {
    const lines = p.text.split(/\r?\n/);
    const at = lines.findIndex((l) => (l.match(/\t/g) ?? []).length >= 2 && /\bpolicy year\b|\bend of year\b/i.test(l.split("\t")[0]) && /surrender|matur|cash value|premiums? paid/i.test(l));
    if (at < 0) continue;
    const header = lines[at].split("\t").map((c) => latinTail(c.trim()));
    const rows = lines.slice(at + 1).filter((l) => l.split("\t").length === header.length && /^\s*\d{1,2}\b/.test(l))
      .map((l) => { const cells = l.split("\t").map((c) => c.trim()); return { year: parseInt(cells[0], 10), label: cells[0], cells, line: l }; });
    if (rows.length >= 2) out.push({ page: p.page, header, rows });
  }
  return out;
}

/** Plans whose rows pay only for their own kind of event (an accident, a trip, a car, a home, a fund). */
const OTHER_KIND_PLANS = new Set(["accident", "travel", "motor", "home", "investment", "long_term_care"]);
/** Topics that are a term every kind of plan can carry (an excess, a premium): never another plan's rows. */
const ATTRIBUTE_TOPICS = new Set(["excess", "premium", "renewal", "status", "cost_sharing"]);
const OTHER_KIND = { has: (k: string) => OTHER_KIND_PLANS.has(k) };
/** A document that only bills: a premium notice or receipt states what is paid, never what the plan pays. */
const PAYMENT_ONLY = /^(?:premium_receipt)$/;
const STOP_WORDS = new Set(["what", "which", "does", "have", "with", "that", "this", "much", "when", "from", "about", "plan", "policy", "policies", "cover", "covered", "pays", "there", "their", "would", "should", "could", "also", "please", "insurance", "your", "mine", "they", "them", "will", "after", "before", "under", "into", "over", "many", "long", "need", "still", "being", "were", "been", "only", "here", "then", "than", "some", "more", "most"]);
const stem = (w: string) => w.toLowerCase().replace(/[^a-z]/g, "").slice(0, 6);

/** Round 11: the question's own assumption ("pays 100% right?", "the private plan right?", "$800k right?") is
 * answered first, from the documents, then the facts as usual (lib/chat/premises.ts). */
export async function answerPolicyQuestion(args: PolicyAnswerArgs): Promise<PolicyAnswerResult> {
  const premise = premiseOf(args.question);
  let r = await answerPolicyQuestionInner(premise.rewrite ? { ...args, question: premise.rewrite } : args);
  if (!r.handled && premise.rewrite) r = await answerPolicyQuestionInner(args);
  if (!r.handled) return r;
  let lead = premiseLead(premise, r.answer.details);
  if (!lead && premise.figures.length) {
    const selfIds = (await query<{ id: string }>("SELECT id::text id FROM family_members WHERE account_id=$1 AND lower(relationship)='self' AND " + activePredicate(), [args.accountId]).catch(() => ({ rows: [] as { id: string }[] }))).rows.map((x) => x.id);
    const f = await figurePremise({ accountId: args.accountId, question: args.question, figures: premise.figures, answerText: [r.answer.summary, ...r.answer.details].join("\n"), peopleIds: args.people.map((p) => p.id), selfIds });
    if (f) {
      lead = f.lead;
      if (f.detail) r.answer.details.unshift(f.detail);
      if (f.citation && !r.answer.citations.some((c) => c.policyId === f.citation!.policyId && c.pageStart === f.citation!.pageStart)) r.answer.citations.push(f.citation);
      for (const m of (f.detail ?? "").match(new RegExp(MONEY_PATTERN.source, "gi")) ?? []) if (!(r.answer.verifiedPolicyFigures ?? []).includes(m)) (r.answer.verifiedPolicyFigures ??= []).push(m);
    }
  }
  if (lead) r.answer.summary = lead + " " + r.answer.summary;
  return r;
}
async function answerPolicyQuestionInner(args: PolicyAnswerArgs): Promise<PolicyAnswerResult> {
  // A follow-up carried onto a plan by its product name ("excess on the HomeShield Contents Plus?") is scoped by
  // that name; the name's own words ("Contents") are not part of what is asked.
  const askedText = args.question.replace(/\s+on the ([A-Z][^?]*)\?\s*$/, "?").replace(/[\u{1F697}\u{1F699}\u{1F698}]\uFE0F?\s*/gu, "car ").replace(/[\u{1F3E0}\u{1F3E1}]\uFE0F?\s*/gu, "home ").trim();
  const started = Date.now(), now = args.now ?? new Date();
  const empty = (): PolicyAnswer => ({ mode: "answer", summary: "", details: [], citations: [], confidence: "insufficient_evidence", nextSteps: [], questions: [], policyStatedLimits: [] });
  const topics = questionTopics(askedText);
  // Round 7 (port): "tell me about CarePlan", "show me Hui Min's ILP" ask what a named plan states.
  const aboutPlan = !GENERAL.test(askedText) && ABOUT_PLAN.test(askedText);
  let general = GENERAL.test(askedText) || aboutPlan;
  // "what's the security bond?", "how long is the deferment?": one named term of the person's plans, asked plainly.
  if (!general && !topics.length && /^\s*(?:what(?:['’]s| is| are)|how (?:much|long)|is there|are there)\b/i.test(askedText) && NARROW.some((n) => n.asks.test(askedText))) general = true;
  // Round 11: "ambulance fee can claim or not?", "is ambulance claimable?": one named benefit, asked as a yes or no.
  if (!general && !topics.length && /\bcan claim\b|\bclaimable\b|\bcovered\b|\bcan (?:i|we) claim\b/i.test(askedText) && NARROW.some((n) => n.asks.test(askedText))) general = true;
  const conditionAsked = CONDITION_QUESTION.test(askedText) || SUBJECTS.test(askedText);
  const result = (partial: Partial<PolicyAnswerResult>): PolicyAnswerResult => ({ handled: false, answer: empty(), kept: [], rejected: [], topics: topics.map((t) => t.key),
    notFound: [], modelCalls: 0, narrated: false, elapsedMs: Date.now() - started, ...partial });
  // A question naming a policy by its product name ("…the AssureTerm…") is about that policy even with no topic word.
  const namesProduct = /\b[A-Z][a-z]+[A-Z][a-z]+\b/.test(args.question) || askedText !== args.question;
  // "only for panel doctors?": a short question with no topic is answered only from rows that name its own words.
  const wordOnly = !topics.length && !general && !conditionAsked && !namesProduct && askedText.trim().split(/\s+/).length <= 6 && /\?\s*$/.test(askedText);
  if (wordOnly) general = true;
  if (!args.people.length || (!topics.length && !general && !conditionAsked && !namesProduct)) return result({});

  const inventory = await loadPolicyInventory(args.accountId, args.people);
  const contracts: PolicyContract[] = inventory.contracts.filter((c) => args.people.some((p) => p.id === c.ownerId));
  const speaksFor = new Map<string, Set<string>>();
  for (const c of contracts) for (const d of [...c.documents, ...c.references]) (speaksFor.get(d.id) ?? speaksFor.set(d.id, new Set()).get(d.id)!).add(c.ownerId);
  // A ready document linked to the person that is not one of their contracts
  // (a renewal notice, an employer's group benefits booklet that names them
  // with their plan) speaks for them too, and every line from it says what it is.
  const linkedRows = await query<{ policy_id: string; family_member_id: string }>(
    `SELECT pm.policy_id::text AS policy_id,pm.family_member_id::text AS family_member_id FROM policy_members pm JOIN policies p ON p.id=pm.policy_id AND p.account_id=pm.account_id
      WHERE pm.account_id=$1 AND pm.family_member_id::text=ANY($2::text[]) AND p.processing_status='ready' AND ${activePredicate("p")} AND p.superseded_at IS NULL`,
    [args.accountId, args.people.map((p) => p.id)]).catch(() => ({ rows: [] as { policy_id: string; family_member_id: string }[] }));
  for (const r of linkedRows.rows) (speaksFor.get(r.policy_id) ?? speaksFor.set(r.policy_id, new Set()).get(r.policy_id)!).add(r.family_member_id);
  if (!speaksFor.size) return result({ notFound: topics.map((t) => t.label) });
  const docIds = [...speaksFor.keys()];
  const cols = await evidenceColumns();
  const docRows = await query<DocRow>(
    `SELECT id::text AS id,account_id::text AS account_id,lifecycle_state,superseded_at::text,quarantine_status,file_hash,effective_date::text,renewal_or_expiry_date::text,
            ${cols.policies?.has("document_date") ? "document_date::text" : "NULL::text"} AS document_date,product_name,insurer,original_filename,updated_at::text,personal_coverage_confirmed,policy_type,policy_number,document_role
       FROM policies WHERE account_id=$1 AND id::text=ANY($2::text[]) AND ${activePredicate()}`, [args.accountId, docIds]);
  // Round 10: letters, claim decisions, bills, screenshots and notes speak for nobody's cover.
  const docs = new Map(docRows.rows.filter((d) => !NON_COVER_ROLES.has(d.document_role ?? "")).map((d) => [d.id, d]));
  // Round 7 (port): the insurer's letter confirming a lapsed policy was reinstated is that policy's latest word
  // on its status, its conditions and its next premium: it is read with the policy (same policy number).
  {
    const num = (x: string | null | undefined) => (x ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const letters = docRows.rows.filter((d) => !docs.has(d.id) && d.document_role === "insurer_letter" && num(d.policy_number) && [...docs.values()].some((o) => num(o.policy_number) === num(d.policy_number)));
    if (letters.length) {
      const letterPages = await documentPages(args.accountId, new Map(letters.map((d) => [d.id, d])));
      for (const d of letters) if (printedReinstatement(letterPages.get(d.id) ?? [])) {
        docs.set(d.id, d);
        const owners = speaksFor.get(d.id) ?? speaksFor.set(d.id, new Set()).get(d.id)!;
        for (const o of docs.values()) if (o.id !== d.id && num(o.policy_number) === num(d.policy_number)) for (const x of speaksFor.get(o.id) ?? []) owners.add(x);
      }
    }
  }
  for (const id of [...speaksFor.keys()]) if (!docs.has(id)) speaksFor.delete(id);
  // Round 7 (port): a premium receipt or notice speaks for the people its policy insures, not for whoever paid it
  // ("Boon Hock CI premium" is not the receipt he paid for his wife's plan) -- when that policy is on file.
  {
    const payments = [...docs.values()].filter((d) => PAYMENT_ONLY.test(d.document_role ?? "") && (d.policy_number || d.product_name));
    if (payments.length) {
      // (By its policy number, or -- when the receipt prints none -- by its product.)
      const insured = await query<{ policy_number: string | null; product_name: string | null; family_member_id: string }>(
        `SELECT p.policy_number,p.product_name,pm.family_member_id::text AS family_member_id FROM policies p JOIN policy_members pm ON pm.policy_id=p.id AND pm.account_id=p.account_id
          WHERE p.account_id=$1 AND ${activePredicate("p")} AND (p.policy_number=ANY($2::text[]) OR lower(p.product_name)=ANY($3::text[])) AND coalesce(p.document_role,'') NOT IN ('premium_receipt','renewal_statement','annual_statement','insurer_letter')`,
        [args.accountId, payments.flatMap((d) => d.policy_number ? [d.policy_number] : []), payments.flatMap((d) => d.product_name ? [d.product_name.toLowerCase()] : [])]).catch(() => ({ rows: [] as { policy_number: string | null; product_name: string | null; family_member_id: string }[] }));
      for (const d of payments) {
        const covered = new Set(insured.rows.filter((r) => d.policy_number ? r.policy_number === d.policy_number : (r.product_name ?? "").toLowerCase() === (d.product_name ?? "").toLowerCase()).map((r) => r.family_member_id));
        const owners = speaksFor.get(d.id);
        if (!covered.size || !owners) continue;
        for (const o of [...owners]) if (!covered.has(o)) owners.delete(o);
        if (!owners.size) { speaksFor.delete(d.id); docs.delete(d.id); }
      }
    }
  }
  // Round 7 (port): the column of a group plan's table that is this person's -- only when the plan's member is the household's own "self".
  // (Only when a group plan with per-member columns could be among the documents: no query otherwise.)
  const groupish = [...docs.values()].some((d) => /group|employee|benefit_guide/i.test((d.policy_type ?? "") + " " + (d.document_role ?? "") + " " + (d.product_name ?? "")) || !d.document_role);
  const personColumns = args.people.length === 1 ? columnsFor(args.people[0].relationship) : [];
  // (One query: the plans the household's own "self" is a member of.)
  const selfPlans = new Set(args.people.length === 1 && groupish && personColumns.length ? (await query<{ policy_id: string }>(`SELECT pm.policy_id::text AS policy_id FROM policy_members pm JOIN family_members f ON f.id=pm.family_member_id AND f.account_id=pm.account_id AND ${activePredicate("f")} WHERE pm.account_id=$1 AND f.relationship='self'`, [args.accountId]).catch(() => ({ rows: [] as { policy_id: string }[] }))).rows.map((r) => r.policy_id) : []);
  const columnsOf = (ids: Iterable<string>) => [...ids].some((id) => selfPlans.has(id)) ? personColumns : [];
  const docName = (id: string) => { const d = docs.get(id); return d ? documentName(d) : "Policy document"; };
  const pagesByDocEarly = new Map<string, { page: number; text: string }[]>();
  /** What kind of document a line comes from, when it is not the person's own schedule. */
  // (Round 7 port: an employer's group booklet that names its employees is still a booklet -- the
  // same documents lib/claims/group-cover.ts treats as group cover.)
  const isGuide = (id: string) => { const d = docs.get(id); return !!d && !d.personal_coverage_confirmed && (/benefit_guide|benefit_summary|product_summary/.test(d.document_role ?? "") || (!d.document_role && (/\bgroup\b/i.test(d.policy_type ?? "") || /\bgroup\b|employee benefits/i.test(d.product_name ?? "")))); };
  const docKind = (id: string, page?: number | null) => { const d = docs.get(id); if (!d) return ""; if (isGuide(id)) { const section = page != null ? sectionOf(id, page) : null; return " (group benefits booklet" + (section ? ", " + section : "") + ")"; } if (/renewal/.test(d.document_role ?? "")) return " (renewal notice)"; return ""; };
  /** A booklet section's own title ("SECTION 2 - GROUP HOSPITAL AND SURGICAL (GHS)" -> "Group hospital and surgical (GHS)"). */
  const sectionOf = (docId: string, page: number) => {
    const lines = ((pagesByDocEarly.get(docId) ?? []).find((p) => p.page === page)?.text ?? "").split(/\r?\n/).map((l) => l.trim());
    const at = lines.findIndex((l) => /^section\s+\d+\s*[-–—:]/i.test(l));
    // A heading wrapped onto the next line ("... AND GROUP PERSONAL" /
    // "ACCIDENT (GPA)") is one heading.
    const next = at >= 0 ? lines[at + 1] ?? "" : "";
    const heading = at < 0 ? null : lines[at] + (next && next === next.toUpperCase() && /[A-Z]/.test(next) && next.length <= 60 && !/^section\b|\d{2,}|[:.]$/i.test(next) ? " " + next : "");
    const title = heading?.replace(/^section\s+\d+\s*[-–—:]\s*/i, "").trim();
    return title ? title.toLowerCase().replace(/^\w/, (c) => c.toUpperCase()).replace(/\(([a-z]{2,5})\)/g, (_m, a: string) => "(" + a.toUpperCase() + ")").replace(/\b(?:gp|tcm|ghs|gtl|gpa|gci|gsp|icu|hdb|cpf)\b/g, (a) => a.toUpperCase()) : null;
  };
  const evidenceLabel = (id: string) => { const d = docs.get(id); return isGuide(id) ? "Group benefits booklet" : /renewal/.test(d?.document_role ?? "") ? "Renewal notice" : d?.personal_coverage_confirmed ? "Your policy document" : "Policy wording"; };
  // How the household refers to a person: the name they use, not the legal one.
  const personName = (id: string) => { const p = args.people.find((x) => x.id === id); return p ? (p.preferred_name?.trim() || p.display_name) : ""; };
  const isSelf = (id: string) => /^self$/i.test(args.people.find((x) => x.id === id)?.relationship ?? "");
  // What kind of policy each document is, from its type, product name and the
  // covers stored on it. A row on a hospital plan is hospital cover; a row on
  // an accident plan is accident cover, whatever medical words it uses.
  const docKindText = new Map<string, string>();
  for (const [docId, d] of docs) docKindText.set(docId, [d.policy_type, d.product_name, ...contracts.flatMap((c) => c.coverages.filter((v) => v.policyId === docId).map((v) => v.category))].filter(Boolean).join(" "));
  const kindsOf = (docId: string) => TOPICS.filter((t) => t.kind && t.kind.test(docKindText.get(docId) ?? "")).map((t) => t.key);
  // A benefit the question names ("hospital cash", "ambulance") is that benefit on whatever plan prints it.
  const namedBenefit = NARROW.filter((n) => n.asks.test(askedText));
  const topicOf = (label: string, passage: string, docId: string, page?: number | null) => {
    const kinds = kindsOf(docId);
    // A row that names another kind of cover this plan also is (an ILP's fund
    // rows on a question about its death benefit) belongs to that kind.
    if (topics.length && namedBenefit.some((n) => n.fact.test(label) || n.fact.test(passage.replace(/^[^\t]*\t/, "")))) return topics[0].key;
    // (Round 7 port: not when the question asks what the plan covers at all -- "What does my SecureCare cover?" -- its own kind's rows are the answer.)
    if (!general && topics.length && TOPICS.some((o) => o.kind && kinds.includes(o.key) && !topics.some((t) => t.key === o.key) && o.fact.test(label) && !topics.some((t) => t.fact.test(label)))) return null;
    // A row whose own name says what it is ("Dental") belongs to that topic
    // before it belongs to the plan's kind ("group insurance").
    const byName = topics.find((t) => t.fact.test(label) && !(t.passage && !t.passage.test(label + " " + passage)) && (t.key === "infectious" || ATTRIBUTE_TOPICS.has(t.key) && t.key !== "cost_sharing" || !kinds.some((k) => k !== t.key && (OTHER_KIND.has(k) || (k === "hospital" && t.key !== "cost_sharing")))));
    if (byName && topics.length > 1) return byName.key;
    for (const t of topics) {
      if (t.passage && !t.passage.test(label + " " + passage)) continue;
      // Every row of a plan of this kind belongs to the topic.
      if (kinds.includes(t.key)) return t.key;
      // A row whose own name says so belongs, unless it sits on a plan of a
      // different specific kind (an accident or travel plan's "hospital" row
      // pays only for an accident or a trip).
      if (t.fact.test(label) && (t.key === "infectious" || (ATTRIBUTE_TOPICS.has(t.key) && t.key !== "cost_sharing") || !kinds.some((k) => k !== t.key && (OTHER_KIND.has(k) || (k === "hospital" && t.key !== "cost_sharing"))))) return t.key;
      // A rider's rows are named by the rider's page, not by the word "rider".
      if (t.key === "rider" && page != null && riderPages.has(docId + "#" + page)) return t.key;
    }
    return (!topics.length || topics.every((t) => ATTRIBUTE_TOPICS.has(t.key))) && general ? "general" : null;
  };
  // Which documents the question is about: one it names ("her CritiCare
  // plan"), or plans of the kind it names ("her hospital plan").
  const namedDocs = [...docs.values()].filter((d) => (d.product_name ?? "").split(/[^A-Za-z0-9]+/)
    .some((token) => token.length >= 5 && !/^(?:synthetic|dptest|policy|insurance|plan)$/i.test(token) && !COMMON_PRODUCT_WORD.test(token) && !/\d/.test(token) && new RegExp("\\b" + token + "\\b", "i").test(args.question))
      // Round 9: a product named in full ("the PA Guardian") even when each of its words is a common one.
      || (d.product_name ?? "").length >= 6 && /\s/.test(d.product_name ?? "") && args.question.toLowerCase().includes((d.product_name ?? "").toLowerCase())).map((d) => d.id);
  // Round 7 (port): "the Pro" when the household also holds "CarePlan Plus": the word that tells two alike products apart names one.
  if (!namedDocs.length && args.question.trim().split(/\s+/).length <= 6) {
    const allNames = (await query<{ product_name: string }>(`SELECT DISTINCT p.product_name FROM policies p WHERE p.account_id=$1 AND p.product_name IS NOT NULL AND ${activePredicate("p")}`, [args.accountId]).catch(() => ({ rows: [] as { product_name: string }[] }))).rows.map((r) => r.product_name);
    const words = (name: string) => name.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2 && !/\d/.test(t)).map((t) => t.toLowerCase());
    const says = (t: string) => new RegExp("(?<![\\p{L}\\p{N}])" + t + "(?![\\p{L}\\p{N}])", "iu").test(args.question);
    for (const d of docs.values()) {
      const mine = words(d.product_name ?? "");
      const alike = allNames.filter((n) => n !== d.product_name && words(n).some((t) => t.length >= 5 && mine.includes(t)));
      if (!alike.length) continue;
      const telling = mine.filter((t) => !alike.some((n) => words(n).includes(t)) && !/^(?:the|and|of|for|plan|policy|insurance)$/.test(t));
      if (telling.some(says) && !alike.some((n) => words(n).filter((t) => !mine.includes(t)).some(says))) namedDocs.push(d.id);
    }
  }
  // Round 9: "my shield", "the shield plan": the Integrated Shield plan itself, not every hospital line a group booklet prints.
  if (!namedDocs.length && /\bshield\b/i.test(args.question) && !/\b(?:home|house|contents)\s*shield\b/i.test(args.question))
    namedDocs.push(...[...docs.values()].filter((d) => /shield/i.test((d.product_name ?? "") + " " + (d.policy_type ?? "")) && !/home|contents|household|motor|travel/i.test((d.product_name ?? "") + " " + (d.policy_type ?? ""))).map((d) => d.id));
  const plannedKinds = PLAN_KINDS.filter((p) => p.re.test(askedText)).map((p) => p.kind);
  // Round 7 (port): "my USD policy", "the US dollar plan": the policy whose own currency is US dollars.
  const usdAsked = /\b(?:usd|us\$|us dollars?|american dollars?)\b/i.test(askedText);
  const usdPages = usdAsked ? await documentPages(args.accountId, docs) : null;
  const usdDocs = usdPages ? [...docs.keys()].filter((id) => /\bpolicy currency\b[^\n]{0,40}\b(?:USD|US dollars?|United States dollars?)\b|\bUS dollar denominated\b/i.test((usdPages.get(id) ?? []).map((p) => p.text).join("\n"))) : [];
  const kindDocs = usdDocs.length ? usdDocs : plannedKinds.length ? [...docs.keys()].filter((id) => kindsOf(id).some((k) => plannedKinds.includes(k))) : [];
  // A group booklet holds several plans; it is "a hospital plan" for the
  // pages that are one (its GHS section), so it stays in scope for them.
  const guideHasKind = (docId: string) => isGuide(docId) && plannedKinds.some((k) => { const kind = TOPICS.find((t) => t.key === k)?.kind; return !!kind && (pagesByDocEarly.get(docId) ?? []).some((p) => kind.test(p.text.split(/\r?\n/).slice(0, 4).join(" "))); });
  const inScope = (docId: string) => namedDocs.length ? namedDocs.includes(docId) : kindDocs.length ? kindDocs.includes(docId) || guideHasKind(docId) : true;
  if (!topics.length && !general && !conditionAsked && !namedDocs.length) return result({});
  // "…on the ElderShield 400?" with no topic word: everything that plan prints is in play.
  if (!topics.length && namedDocs.length) general = true;

  // Stored facts and printed rows, as candidate assertions.
  const candidates: RawCandidate[] = [];
  const pagesByDoc = await documentPages(args.accountId, docs);
  for (const [k, v] of pagesByDoc) pagesByDocEarly.set(k, v);
  const read = new Map([...pagesByDoc].map(([docId, pages]) => [docId, pages.map((p) => readPage(p.page, p.text))]));
  // Round 7: what each document itself says about whether it still covers anyone.
  const today = todayIso(now);
  const statusOf = new Map<string, PrintedStatus>([...docs.keys()].map((id) => [id, printedStatus(pagesByDoc.get(id) ?? [], docs.get(id)?.renewal_or_expiry_date ?? null, today)]));
  // Round 7 (port): a lapse a later document of the same policy says was reinstated is not its status now.
  applyReinstatements(statusOf, [...docs.values()].map((d) => ({ id: d.id, policy_number: d.policy_number ?? null })), (id) => pagesByDoc.get(id) ?? []);
  // A reminder whose grace date has passed says nothing once a later document or payment of the same policy is on file.
  if ([...statusOf.values()].some((st) => st.state === "grace_passed")) {
    const paid = await query<{ policy_id: string; latest: string | null }>(
      `SELECT coalesce(source_document_id,policy_id)::text AS policy_id,max(coalesce(payment_date,period_start))::text AS latest
         FROM premium_records WHERE account_id=$1 AND coalesce(source_document_id,policy_id)::text=ANY($2::text[]) GROUP BY 1`, [args.accountId, [...docs.keys()]])
      .catch(() => ({ rows: [] as { policy_id: string; latest: string | null }[] }));
    supersedePassedGrace(statusOf, [...docs.values()].map((d) => ({ id: d.id, policy_number: d.policy_number, product_name: d.product_name,
      owners: speaksFor.get(d.id) ?? new Set<string>(), date: d.document_date ?? d.effective_date ?? printedPeriodStart(pagesByDoc.get(d.id) ?? []), role: d.document_role })),
      new Map(paid.rows.map((r) => [r.policy_id, r.latest])));
  }

  // Only a document that prints the policy has lapsed: a printed end date that has passed never makes a policy inactive
  // (DC, 31 Oct: every policy on file is treated as in force).
  const inactive = (id: string) => statusOf.get(id)?.state === "lapsed";
  const paymentOnly = (id: string) => PAYMENT_ONLY.test(docs.get(id)?.document_role ?? "");
  const tables = new Map([...pagesByDoc].map(([docId, pages]) => [docId, valueTables(pages)]));
  const tablePageOf = (docId: string, page: number | null) => (tables.get(docId) ?? []).some((t) => t.page === page);
  /** The cell a multi-column table prints for one row in one column. */
  const printedCell = (docId: string, page: number | null, rowName: string, tier: string | null) => {
    if (!tier || page == null) return null;
    const lines = ((pagesByDoc.get(docId) ?? []).find((p) => p.page === page)?.text ?? "").split(/\r?\n/);
    const cells = (l: string) => l.split("\t").map((c) => c.trim());
    const header = lines.find((l) => (l.match(/\t/g) ?? []).length >= 1 && cells(l).some((c) => c.toLowerCase() === tier.toLowerCase()));
    const row = lines.find((l) => l.includes("\t") && cells(l).slice(0, 2).some((c) => normalPassage(c).startsWith(normalPassage(rowName).slice(0, 14))));
    if (!header || !row) return null;
    const index = cells(header).findIndex((c) => c.toLowerCase() === tier.toLowerCase());
    const cell = cells(row)[index];
    return cell && cell.length <= 120 ? cell : null;
  };
  /** A rider's name as the document writes it in running text ("ShieldCare Plus Rider"). */
  const riderName = (docId: string, page: number) => {
    const pages = pagesByDoc.get(docId) ?? [];
    // (Round 7 port: not a letterhead line such as "Rider schedule (fictional)".)
    const heading = (pages.find((p) => p.page === page)?.text.split(/\r?\n/).map((l) => l.trim()).find((l) => /\brider\b/i.test(l) && !/\((?:fictional|fictitious|synthetic)\)/i.test(l) && !/^rider schedule$/i.test(l) && !/[:\t]/.test(l)) ?? "").split(/\s+[-–—]\s+/)[0].trim();
    if (!heading) return docName(docId);
    const re = new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "gi");
    const mixed = pages.flatMap((p) => p.text.match(re) ?? []).find((m) => m !== m.toUpperCase());
    return mixed ?? heading.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  };
  // Pages whose own heading is a rider's ("SHIELDCARE PLUS RIDER - SCHEDULE OF BENEFITS").
  const riderPages = new Set([...pagesByDoc].flatMap(([docId, pages]) => pages.filter((p) => /\brider\b/i.test(p.text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !FURNITURE.test(l) && !/\(fictitious\)$|^[A-Z][a-z]+ [A-Z][a-z]+ (?:Assurance|Insurance|Life)/.test(l)) ?? "")).map((p) => docId + "#" + p.page)));
  // Printed schedule rows: the row itself is the passage, so what is shown is
  // exactly what the page prints -- including a value printed with no currency.
  for (const [docId, pages] of read) for (const page of pages) for (const row of page.rows) {
    // A premium notice prints who pays and how, never what the plan pays.
    if (paymentOnly(docId)) continue;
    const topic = topicOf(row.label, row.line, docId, row.page);
    if (!topic) continue;
    // Round 7: a table's own header ("Component | Amount") is not a fact, and
    // how a premium is paid ("Payable in cash: S$1,150.00") is not cover.
    if (/^(?:component|item|benefits?|description|details?|particulars)$/i.test(row.label.trim()) && /^(?:amount|value|limit|sum insured|details?|s\$|sgd)$/i.test(row.value.trim())) continue;
    // A premium receipt is evidence of a payment, not of cover.
    if (topic !== "premium" && /receipt/i.test(docs.get(docId)?.document_role ?? "")) continue;
    if (topic !== "premium" && /^(?:payable|paid)\s+(?:in|from|by|via)\b|\b(?:medisave|cash)\s+(?:portion|payable|deductible)\b/i.test(row.label.trim())) continue;
    const printed = printedAmount(row.value);
    // Round 7 (port): a row with a figure per column (Employee / Spouse / Child) is this person's column only, named;
    // when their column is not known the row is left to the stored facts, never quoted with other columns' figures.
    const figureCells = row.line.split(/\t| · |\s{3,}/).filter((cell) => /(?:S\$|SGD\s?|US\$|USD\s?)\s?\d/i.test(cell)).length;
    if (figureCells >= 2) {
      const column = columnsOf([docId]).map((c) => c.charAt(0).toUpperCase() + c.slice(1)).find((c) => printedCell(docId, row.page, row.label, c));
      const cell = column ? printedCell(docId, row.page, row.label, column) : null;
      if (!cell) continue;
      const one = printedAmount(cell);
      for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "row:" + docId + ":" + row.page + ":" + row.index, source: "row", topic, title: row.label, ownerName: personName(ownerId),
        kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: row.page,
        text: row.label + " (" + column + " column): " + cell, amount: one.amount, currency: one.amount != null ? one.currency : null, quote: row.line, start: null, end: null });
      continue;
    }
    for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "row:" + docId + ":" + row.page + ":" + row.index, source: "row", topic, title: row.label, ownerName: personName(ownerId),
      kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: row.page,
      text: row.label + ": " + row.value + (printed.bare ? " (no currency is printed for this amount)" : ""),
      amount: printed.amount, currency: printed.amount != null ? printed.currency : null, quote: row.line, start: null, end: null });
  }
  // Round 7: what the schedule prints about itself, when that is what is asked ("as of when?", "who else was on it?", "when did it start?").
  const META_ASKED: [RegExp, RegExp][] = [
    [/\b(?:start(?:ed|s)?|commence\w*|beg[ia]n)\b(?!\s+(?:to\s+)?pay)/i, /^(?:policy start date|cover start date|start date|commencement date|period of insurance|policy term)$/i],
    [/\bas (?:of|at) when\b|\bstatement date\b|\bwhat date\b|\bvaluation\b|\bhow (?:old|recent) is (?:this|that|the) (?:statement|document)\b/i, /^(?:statement date|date|date of issue)$/i],
    [/\bwho else\b|\bwho (?:is|was|are|were) (?:on|covered|insured|named)\b|\bwho(?:['’]s| is) insured\b/i, /^(?:insured persons?|insured|life assured|named drivers?|insured helper)$/i],
    [/\bdestination\b|\bwhere (?:was|is) (?:the|that|my) trip\b/i, /^destination$/i],
  ];
  const metaWanted = META_ASKED.filter(([q]) => q.test(askedText)).map(([, label]) => label);
  if (metaWanted.length) for (const [docId, pages] of read) for (const page of pages) for (const m of page.meta.filter((r) => metaWanted.some((l) => l.test(r.label))))
    for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "meta:" + docId + ":" + m.page + ":" + m.index, source: "row", topic: topics[0]?.key ?? "general", title: m.label, ownerName: personName(ownerId),
      kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: m.page, text: m.label + ": " + m.value, amount: null, currency: null, quote: m.line, start: null, end: null });
  const printedTitle = (docId: string, title: string) => candidates.some((c) => c.source === "row" && c.policyId === docId && normalPassage(c.title) === normalPassage(englishPart(title)));
  const coverages = contracts.flatMap((c) => c.coverages.map((v) => ({ c, v })));
  const coverageEvidence = await evidenceFor("policy_coverages", args.accountId, coverages.map(({ v }) => v.id));
  for (const { c, v } of coverages) {
    if (paymentOnly(v.policyId)) continue;
    const topic = topicOf(v.category, v.evidenceText ?? "", v.policyId);
    if (!topic) continue;
    const currency = statedCurrencyCode(v.currency);
    const e = coverageEvidence.get(v.id);
    const hasFigure = v.amount != null && v.amount > 0 && !!currency;
    if (!hasFigure) continue; // "cover is listed" is not an answer; the rows say what it pays
    // The stored passage_verified flag for coverage rows is not used as a
    // veto: verifyAssertions re-finds the amount and currency in the cited
    // passage itself, which is the check that flag stands for.
    candidates.push({ id: "coverage:" + v.id, source: "coverage", topic, title: v.category, ownerName: personName(c.ownerId) || c.ownerName,
      kind: "policy_fact", subjectId: c.ownerId, policyId: v.policyId, documentHash: docs.get(v.policyId)?.file_hash ?? null, page: v.sourcePage,
      text: v.category + " sum insured: " + money(v.amount!, currency!), amount: v.amount, currency,
      conflictNote: e?.conflict_note ?? null, quote: v.evidenceText, start: e?.source_text_start ?? null, end: e?.source_text_end ?? null });
  }
  if (topics.length || general) {
    let catalog: CatalogBenefit[] = [];
    try { catalog = await loadBenefitCatalog(args.accountId, docIds); } catch { catalog = []; }
    const benefitEvidence = await evidenceFor("policy_benefits", args.accountId, catalog.map((b) => b.id));
    // Round 5 (written by ingestion when present): the table column a value
    // was printed under and what kind of schedule term the row is.
    const typed = await tableTerms(args.accountId, catalog.map((b) => b.id));
    const memberTier = await memberTiers(args.accountId, docIds);
    // A multi-column table's columns are person classes / plan tiers only when
    // one of them is the person's own; then only that column is theirs.
    const tierOf = (b: CatalogBenefit) => typed.get(b.id)?.tier ?? null;
    const pageOf = (docId: string, page: number | null) => (pagesByDocEarly.get(docId) ?? []).find((p) => p.page === page)?.text ?? "";
    const employeeOnly = (docId: string, page: number | null) => /\bemployees?\s+only\b|\bcovers?\s+the\s+employee\s+only\b/i.test(pageOf(docId, page));
    const isEmployee = (docId: string, ownerId: string) => {
      const person = args.people.find((p) => p.id === ownerId); if (!person) return false;
      const all = (pagesByDocEarly.get(docId) ?? []).map((p) => p.text).join("\n").replace(/[ \t]+/g, " ");
      const name = person.display_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp("\\b(?:eligible |insured )?employee(?: name)?\\s*:\\s*" + name, "i").test(all);
    };
    const planPrintedFor = (docId: string, ownerId: string) => {
      // (Any document that prints the person's name beside a plan -- a
      // booklet read without its role still says which column is theirs.)
      const person = args.people.find((p) => p.id === ownerId); if (!person) return null;
      const name = person.display_name.toLowerCase().replace(/\s+/g, " ");
      for (const p of pagesByDocEarly.get(docId) ?? []) for (const line of p.text.split(/\n/)) {
        const flat = line.replace(/\s+/g, " ");
        if (flat.toLowerCase().includes(name)) { const m = flat.match(/\b(plan\s+[A-Z0-9]{1,3})\b/i); if (m) return m[1]; }
      }
      return null;
    };
    const tableHasTier = (docId: string, page: number | null, tier: string) => catalog.some((x) => x.policyId === docId && x.sourcePage === page && tierApplies(tierOf(x), tier) && !!tierOf(x));
    for (const b of catalog) {
      const rowKind = typed.get(b.id)?.rowKind ?? null, tier = tierOf(b);
      // A premium is never a benefit, a limit or a conflict.
      if (PREMIUM_ROW.test(b.benefitName)) continue;
      // A value table (surrender values by policy year) is read whole below, never one cell at a time.
      if (tablePageOf(b.policyId, b.sourcePage) || paymentOnly(b.policyId)) continue;
      const onRider = topics.some((t) => t.key === "rider") && b.sourcePage != null && riderPages.has(b.policyId + "#" + b.sourcePage);
      const topic = onRider ? "rider" : rowKind && COST_SHARING_KINDS.has(rowKind) && topics.some((t) => t.key === "cost_sharing") ? "cost_sharing" : topicOf(b.benefitName, b.quote, b.policyId, b.sourcePage);
      if (!topic) continue;
      const e = benefitEvidence.get(b.id);
      // Printed on the page as a row: the row is shown; a conflict the
      // ingestion recorded for this benefit is carried onto it.
      if (printedTitle(b.policyId, b.benefitName)) {
        if (e?.conflict_note) for (const c of candidates) if (c.source === "row" && c.policyId === b.policyId && normalPassage(c.title) === normalPassage(b.benefitName)) c.conflictNote = e.conflict_note;
        continue;
      }
      for (const ownerId of speaksFor.get(b.policyId) ?? []) {
        // Round 7: a booklet prints the employee's plan beside their name
        // ("LIM KOK WEI ... Benefit plan: Plan 2 (Managers)"): that is their
        // column in the GTL / GPA tables, as the stored class (Employee) is in
        // the hospital table.
        // A booklet section for the employee only (GTL / GPA "cover the
        // employee only") is never a dependant's cover.
        if (employeeOnly(b.policyId, b.sourcePage) && !isEmployee(b.policyId, ownerId)) continue;
        const stored = memberTier.get(b.policyId + "|" + ownerId) ?? null;
        const printedPlan = planPrintedFor(b.policyId, ownerId);
        // Round 7 (port): on the household's own group plan (its member is "self"), a spouse's or child's column by how they relate.
        const related = args.people.length === 1 && ownerId === args.people[0].id ? columnsOf([b.policyId]) : [];
        const own = [stored, printedPlan, ...related].find((t): t is string => !!t && tableHasTier(b.policyId, b.sourcePage, t)) ?? stored;
        // The person's own column only (Private hospital for a private-ward
        // plan, Child for a child); a person whose class is not known sees
        // every column, each labelled.
        if (tier && own && tableHasTier(b.policyId, b.sourcePage, own) && !tierApplies(tier, own)) continue;
        const currency = statedCurrencyCode(b.currency);
        const value = b.formulaValue;
        let text = englishPart(b.benefitName), amount: number | null = null;
        // The column heading is shown beside the line (not inside the
        // verified sentence: "B1 ward" is not printed in the row itself).
        const tierLabel = tier && !(own && tierApplies(tier, own)) ? tier : null;
        if (rowKind && rowKind !== "benefit") {
          const term = scheduleTermText(rowKind, value, currency);
          // A cell with no figure ("Covered in full (you pay nothing towards
          // the deductible)", "No cap") is shown as the schedule prints it.
          const cell = term ? null : printedCell(b.policyId, b.sourcePage, b.benefitName, tier);
          if (!term && !cell) continue;
          text += ": " + (term ? term.text : cell); amount = term ? term.amount : null;
        } else if (tier && (value == null || b.formulaKind === "none")) {
          const cell = printedCell(b.policyId, b.sourcePage, b.benefitName, tier);
          if (cell && !/^\d+(?:,\s*\d+)*$/.test(cell)) text += ": " + cell;
        } else if ((value == null || b.formulaKind === "none") && b.quote && !tier) {
          // Round 7: a benefit listed with no calculable rule shows the one
          // figure its quoted line prints, as printed. A line read by OCR from
          // a scanned page is shown with its misread dollar sign repaired and
          // says it came from a scan. A line with several figures shows none.
          const pageText = pageOf(b.policyId, b.sourcePage);
          const scanned = looksScanned(b.quote) || ocrNoiseShare(pageText) > 0.3;
          const figures = (scanned ? cleanScannedLine(b.quote) ?? "" : b.quote).match(/(?:S\$|US\$)\s?\d[\d,]*(?:\.\d+)?(?:\s+(?:per|a)\s+(?:day|visit|year|week|month))?/g) ?? [];
          if (figures.length === 1) text += ": " + figures[0] + (scanned ? " (read from a scanned page; check it against the original)" : "");
        } else if (!b.needsConfirmation && value != null && value > 0) {
          if (b.formulaKind === "sum_insured") text += ": " + Math.round(value * 1000) / 10 + "% of the sum insured";
          else if (currency && (b.formulaKind === "fixed" || b.formulaKind === "expense_cap" || b.formulaKind === "daily")) {
            amount = value; text += ": " + (b.formulaKind === "expense_cap" ? "up to " : "") + money(value, currency) + (b.formulaKind === "daily" ? " per day" : "");
          }
        }
        candidates.push({ id: "benefit:" + b.id, source: "benefit", topic, title: englishPart(b.benefitName), ownerName: personName(ownerId), tier, rowKind, tierLabel,
          kind: "policy_fact", subjectId: ownerId, policyId: b.policyId, documentHash: docs.get(b.policyId)?.file_hash ?? null, page: b.sourcePage,
          text, amount, currency: amount != null ? currency : null, conditions: [],
          conflictNote: e?.conflict_note ?? null, passageVerified: e?.passage_verified ?? null,
          quote: b.quote, start: e?.source_text_start ?? null, end: e?.source_text_end ?? null, storedConditions: b.conditions });
      }
    }
    if (topics.some((t) => t.key === "premium")) {
      // Premiums as printed: "Annual premium (ShieldCare Plus Rider): S$689.00
      // payable in cash" -- each line its own fact, never merged or compared.
      for (const [docId, pages] of read) for (const page of pages) for (const row of page.premiums) {
        const printed = printedAmount(row.value);
        for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "premiumrow:" + docId + ":" + row.page + ":" + row.index, source: "premium", topic: "premium", title: row.label, ownerName: personName(ownerId),
          kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: row.page,
          text: row.label + ": " + row.value, amount: printed.amount, currency: printed.amount != null ? printed.currency : null, quote: row.line, start: null, end: null });
      }
      // "When is it due?", "how much does she owe?": the due date and the end of any grace period, as printed.
      if (/\b(?:due|when|owe|owing|deadline|by when|overdue)\b/i.test(askedText))
        for (const [docId, pages] of read) for (const page of pages) for (const m of page.meta.filter((r) => /^(?:premium due date|due date|payment due date|grace period ends)$/i.test(r.label)))
          for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "premiumdue:" + docId + ":" + m.page + ":" + m.index, source: "premium", topic: "premium", title: m.label, ownerName: personName(ownerId),
            kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: m.page, text: m.label + ": " + m.value, amount: null, currency: null, quote: m.line, start: null, end: null });
      const premiums = await query<{ id: string; policy_id: string | null; source_document_id: string | null; family_member_id: string | null; amount: string; currency: string | null; frequency: string | null; source_page: number | null }>(
        `SELECT id::text AS id,policy_id::text AS policy_id,source_document_id::text AS source_document_id,family_member_id::text AS family_member_id,amount::text,currency,frequency,source_page
           FROM premium_records WHERE account_id=$1 AND coalesce(source_document_id,policy_id)::text=ANY($2::text[])`, [args.accountId, docIds]);
      const printedPremiumDocs = new Set(candidates.filter((c) => c.source === "premium").map((c) => c.policyId));
      for (const p of premiums.rows) {
        const docId = p.source_document_id ?? p.policy_id!;
        // The document's own printed premium lines already say it, verbatim.
        if (printedPremiumDocs.has(docId)) continue;
        const owners = [...(speaksFor.get(docId) ?? [])].filter((o) => !p.family_member_id || o === p.family_member_id);
        const currency = statedCurrencyCode(p.currency), amount = Number(p.amount);
        for (const ownerId of owners) candidates.push({ id: "premium:" + p.id, source: "premium", topic: "premium", title: "Premium", ownerName: personName(ownerId),
          kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: p.source_page,
          text: currency ? "Premium: " + money(amount, currency) + (p.frequency ? " (" + p.frequency + ")" : "") : "A premium is recorded, but the document does not state its currency",
          amount: currency ? amount : null, currency, quote: null, start: null, end: null });
      }
    }
  }
  // Conditions (waiting periods, exclusions, alternative benefits) are
  // answered from the conditions pages' own sentences, never from a benefit
  // table and never rerouted to another topic.
  if (conditionAsked) {
    const subject = askedText.match(SUBJECTS)?.[1];
    const SUBJECT_WORDS: Record<string, string> = { denta: "dental|teeth|tooth", mater: "maternity|pregnan|childbirth", pregn: "maternity|pregnan|childbirth", menta: "mental|psychiatr", psych: "mental|psychiatr" };
    const subjects = [...askedText.matchAll(new RegExp(SUBJECTS.source, "gi"))].map((m) => SUBJECT_WORDS[m[1].toLowerCase().slice(0, 5)] ?? m[1].toLowerCase().slice(0, 5));
    const wants = (line: string) =>
      (/\bwaiting period/i.test(askedText) && /waiting period/i.test(line)) ||
      (/\bsurvival period/i.test(askedText) && /survival period/i.test(line)) ||
      (/\bgrace period/i.test(askedText) && /grace period/i.test(line)) ||
      (/\bboth\b[^?]*\b(?:paid|payable|pay)\b|alternative benefits?|only the higher/i.test(askedText) && /alternative|higher amount|only one|not both|either/i.test(line)) ||
      subjects.some((sub) => new RegExp("\\b(?:" + sub + ")", "i").test(line)) ||
      (/\bexclu\w*/i.test(askedText) && !subject && /exclu/i.test(line));
    const conditions: RawCandidate[] = [];
    for (const [docId, pages] of read) for (const page of pages) for (const line of page.conditions) {
      if (!wants(line.line + " " + (line.heading ?? ""))) continue;
      const heading = line.heading ? line.heading.replace(/^[A-Z][A-Z &'-]+$/, (h) => h.charAt(0) + h.slice(1).toLowerCase()) + ": " : "";
      for (const ownerId of speaksFor.get(docId) ?? []) conditions.push({ id: "condition:" + docId + ":" + line.page + ":" + line.index, source: "condition", topic: "conditions", title: "Condition",
        ownerName: personName(ownerId), kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: line.page,
        text: heading + line.line, amount: null, currency: null, quote: line.line, start: null, end: null });
    }
    // A benefit topic that also appears in the conditions ("dental" in the
    // exclusions and in a benefit table) is answered with both.
    if (conditions.filter((c) => inScope(c.policyId)).length) {
      if (topics.some((t) => ["dental", "maternity", "outpatient"].includes(t.key))) candidates.push(...conditions);
      else candidates.splice(0, candidates.length, ...conditions);
    }
  }
  // Ward class / plan tier: the person's own column, from the line of the
  // document that names it ("Plan: ShieldCare Premier (Private hospital)").
  // Round 7 (port): "What's my dad's hospital plan?" asks which plan it is: the ward it entitles him to comes first, as printed.
  if (/\bwhat(?:['’]s| is| are)\b[^?]{0,40}\b(?:hospital|shield) (?:plan|insurance|policy|cover)\s*\??\s*$/i.test(askedText) || topics.some((t) => t.key === "ward"))
    for (const docId of docs.keys()) {
      if (!(kindsOf(docId).includes("hospital") || /\bshield\b|\bhospital\b|\bhealth\b/i.test((docs.get(docId)?.product_name ?? "") + " " + (docs.get(docId)?.policy_type ?? ""))) || isGuide(docId)) continue;
      for (const pg of pagesByDoc.get(docId) ?? []) for (const [i, raw] of pg.text.split(/\r?\n/).entries()) {
        const l = raw.trim();
        if (!(/^ward (?:entitlement|class|type)\s*[:\t]/i.test(l) || /^plan\s*[:\t].*\bward\b/i.test(l)) || l.length > 160) continue;
        for (const ownerId of speaksFor.get(docId) ?? []) if (!candidates.some((c) => c.id === "wardline:" + docId + ":" + ownerId))
          candidates.unshift({ id: "wardline:" + docId + ":" + ownerId, source: "row", topic: topics[0]?.key ?? "ward", title: "Ward entitlement", ownerName: personName(ownerId), kind: "policy_fact", subjectId: ownerId, policyId: docId,
            documentHash: docs.get(docId)?.file_hash ?? null, page: pg.page, text: l.replace(/\t+/g, ": ").replace(/\s{2,}/g, " "), amount: null, currency: null, quote: raw, start: null, end: null });
        void i;
      }
    }
  if (topics.some((t) => t.key === "ward")) {
    const tiers = await memberTiers(args.accountId, [...docs.keys()]);
    for (const docId of docs.keys()) {
      if (!kindsOf(docId).includes("hospital") && !isGuide(docId)) continue;
      for (const ownerId of speaksFor.get(docId) ?? []) {
        const tier = tiers.get(docId + "|" + ownerId);
        if (!tier) continue;
        const lines = (pagesByDoc.get(docId) ?? []).flatMap((pg) => pg.text.split(/\r?\n/).map((l, i) => ({ page: pg.page, i, l: l.trim() })))
          .filter((x) => x.l && (x.l.match(/\t/g) ?? []).length < 2 && !FURNITURE.test(x.l) && x.l.toLowerCase().includes(tier.toLowerCase()) && x.l.length <= 200);
        // Round 11: a group booklet's tier ("Dependants") is named on the line that enrols this person, not in its introduction.
        const owner = args.people.find((p) => p.id === ownerId);
        const hit = isGuide(docId) ? lines.find((x) => !!owner && new RegExp("\\b" + owner.display_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(x.l)) : lines[0];
        if (!hit) continue;
        candidates.push({ id: "ward:" + docId + ":" + ownerId, source: "row", topic: "ward", title: "Plan", ownerName: personName(ownerId), kind: "policy_fact", subjectId: ownerId, policyId: docId,
          documentHash: docs.get(docId)?.file_hash ?? null, page: hit.page, text: hit.l.replace(/\t+/g, ": ") + " — so the “" + tier + "” column of the benefit table applies",
          amount: null, currency: null, quote: hit.l, start: null, end: null });
      }
    }
  }
  // Renewal and expiry: the period, renewal and due-date lines each document prints.
  if (topics.some((t) => t.key === "renewal")) {
    const PERIOD = /^(?:period of insurance|renewal period|(?:policy |cover(?:age)? )?period|expiry date|end date|(?:next )?renewal date|payment due date|policy term|maturity date|grace period ends)$/i;
    for (const [docId, pages] of read) {
      let found = 0;
      for (const page of pages) {
        for (const m of page.meta.filter((r) => PERIOD.test(r.label))) {
          found++;
          for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "renewal:" + docId + ":" + m.page + ":" + m.index, source: "row", topic: "renewal", title: m.label, ownerName: personName(ownerId),
            kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: m.page, text: m.label + ": " + m.value, amount: null, currency: null, quote: m.line, start: null, end: null });
        }
        for (const c of page.conditions.filter((x) => /\b(?:will renew|renews on|expires? on|renewal date)\b/i.test(x.line))) {
          found++;
          for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "renewal:" + docId + ":" + c.page + ":s" + c.index, source: "row", topic: "renewal", title: "Renewal", ownerName: personName(ownerId),
            kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: c.page, text: c.line, amount: null, currency: null, quote: c.line, start: null, end: null });
        }
      }
      // A schedule that prints its period without a table ("Period of insurance 1 January 2026 to 31 December 2026").
      const end = docs.get(docId)?.renewal_or_expiry_date;
      if (!found && end && statusOf.get(docId)?.state !== "lapsed") {
        const hit = (pagesByDoc.get(docId) ?? []).flatMap((pg) => pg.text.split(/\r?\n/).map((l, i) => ({ page: pg.page, i, l: l.trim() }))).find((x) => x.l.length <= 160 && dateAppears(end.slice(0, 10), x.l));
        if (hit) for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "renewal:" + docId + ":" + hit.page + ":l" + hit.i, source: "row", topic: "renewal", title: "Period", ownerName: personName(ownerId),
          kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: hit.page, text: hit.l.replace(/\t+/g, ": "), amount: null, currency: null, quote: hit.l, start: null, end: null });
      }
    }
  }
  // Round 7: sentences the documents print that answer the question when no
  // row of a table does ("Water damage from a sudden burst pipe is covered.",
  // "You may apply to reinstate the policy until 16 March 2028."). Never an
  // address, a salutation or a date line.
  // Round 11: anyone in the household named in the question ("Farah scratched the car") is who, never what is asked.
  const householdNames = (await query<{ n: string }>("SELECT display_name || ' ' || coalesce(preferred_name,'') n FROM family_members WHERE account_id=$1 AND " + activePredicate(), [args.accountId]).catch(() => ({ rows: [] as { n: string }[] }))).rows.map((r) => r.n);
  const nameWords = new Set([...args.people.map((p) => p.display_name + " " + (p.preferred_name ?? "")), ...householdNames].flatMap((n) => n.toLowerCase().split(/\s+/)).filter(Boolean));
  const proseFor = (): RawCandidate[] => {
    const words = [...new Set((askedText.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).map((w) => w.replace(/['’]s$/, "")).filter((w) => !STOP_WORDS.has(w) && !nameWords.has(w) && w.length >= 4))];
    // A plan the question names that is not on file is not answered from another plan's sentences.
    const productWords = new Set([...docs.values()].flatMap((d) => (d.product_name ?? "").toLowerCase().split(/[^a-z]+/)));
    words.splice(0, words.length, ...words.filter((w) => !productWords.has(w)));
    if (!words.length || (plannedKinds.length && !kindDocs.length && !namedDocs.length)) return [];
    const hits: { docId: string; line: ConditionLine; score: number }[] = [];
    const telling = (w: string) => w.length >= 7 && !/^(?:medical|accident|accidents|hospital|insurance|insured|benefits?|premiums?|payment|payments|coverage|expenses|policies|amounts?|charges?|treatment|illness|certificate|schedule)$/.test(w);
    for (const [docId, pages] of read) {
      if (!inScope(docId) || paymentOnly(docId)) continue;
      for (const page of pages) for (const line of page.prose) {
        if (/^(?:to|dear|date|re|attn)\s*:|\b(?:street|avenue|road|blk|lane|drive)\b|#\d|\b(?:singapore|vic|nsw)\s+\d{4,6}\b/i.test(line.line)) continue;
        // A sentence, not a run of table text: ends like one and is not a paragraph.
        const bare = line.line.replace(/\s+\d{1,2}$/, "");
        if (bare.length > 260 || !/[.!?。]$/.test(bare) || bare.split(/\s+/).length < 5) continue;
        const said = new Set((line.line.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).map(stem));
        const shared = words.filter((w) => said.has(stem(w)));
        if (shared.length >= 2 || shared.some(telling)) hits.push({ docId, line, score: shared.length + (shared.some(telling) ? 0.5 : 0) });
      }
    }
    // "What counts as severe disability?": the sentence that defines it.
    if (/\bwhat (?:counts as|is meant by|does [^?]{1,30} mean)|\bdefin\w+|\bmeaning of\b/i.test(askedText)) {
      for (const [docId, pages] of read) if (inScope(docId) && !paymentOnly(docId)) for (const page of pages) for (const line of page.prose)
        if (/\b(?:means|is defined as|refers to)\b/i.test(line.line) && words.some((w) => line.line.toLowerCase().includes(w.slice(0, 5))) && !hits.some((h) => h.line === line)) hits.push({ docId, line, score: 10 });
    }
    hits.sort((a, b) => b.score - a.score);
    // Printed sentences are quoted as printed (English half of a bilingual one), without a trailing footnote number.
    const englishProse = (raw: string) => { const t = englishPart(raw); return "“" + (/[\u3400-\u9FFF]/.test(t) ? t.split(/。\s*/).filter((x) => x && !/[\u3400-\u9FFF]/.test(x)).join(" ").trim() || t : t).replace(/\s+\d{1,2}$/, "").replace(/[.;:\s]+$/, "") + "”"; };
    return hits.slice(0, 2).flatMap((h) => [...(speaksFor.get(h.docId) ?? [])].map((ownerId) => ({ id: "prose:" + h.docId + ":" + h.line.page + ":" + h.line.index, source: "row" as const,
      topic: topics[0]?.key ?? "general", title: "Printed", ownerName: personName(ownerId), kind: "policy_fact" as const, subjectId: ownerId, policyId: h.docId,
      documentHash: docs.get(h.docId)?.file_hash ?? null, page: h.line.page, text: englishProse(h.line.line), amount: null, currency: null, quote: h.line.line, start: null, end: null })));
  };
  // Round 7: "Is it still in force?", "Which have lapsed?": each document's own status line.
  if (topics.some((t) => t.key === "status")) {
    const onlyEnded = /\b(?:lapsed?|ended|expired?|no longer)\b/i.test(askedText) && /\b(?:which|list|any|every|all)\b/i.test(askedText);
    for (const docId of docs.keys()) {
      const st = statusOf.get(docId);
      if (paymentOnly(docId) || !st || st.state === "unknown" || st.page == null || !st.line) continue;
      if (onlyEnded && st.state !== "lapsed") continue;
      // Round 7 (port): reinstated -- said from the reinstatement letter, cited there (once for both documents).
      if (st.state === "reinstated" && st.byDocId && st.byDocId !== docId) continue;
      const text = st.state === "reinstated" ? "Reinstated with effect from " + st.printed + "; in force" : st.state === "lapsed" ? "Lapsed on " + st.printed : st.state === "grace" ? "Grace period ends: " + st.printed : st.state === "grace_passed" ? "Grace period ended: " + st.printed + "; payment since not shown" : st.line.replace(/\t+/g, ": ").replace(/^(period of insurance|policy term)\s+/i, (m, x: string) => x + ": ");
      for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "status:" + docId, source: "row", topic: "status", title: "Status", ownerName: personName(ownerId),
        kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: st.page, text, amount: null, currency: null, quote: st.line, start: null, end: null });
    }
    // "Can I get it back?", "why did it lapse?": the sentences the notice prints about it.
    if (/\b(?:reinstat\w*|why|get it back|revive|restore)\b/i.test(askedText)) candidates.push(...proseFor());
    // "Can I get it back?": what the notice says about reinstating it.
    if (/\b(?:reinstat\w*|get it back|revive|restore)\b/i.test(askedText)) for (const [docId, pages] of read) if (inScope(docId) && statusOf.get(docId)?.state === "lapsed") for (const page of pages) for (const line of page.prose)
      if (/\breinstat/i.test(line.line) && !candidates.some((c) => c.quote === line.line)) for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "reinstate:" + docId + ":" + line.index, source: "row", topic: "status", title: "Printed", ownerName: personName(ownerId),
        kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: line.page, text: "“" + line.line.replace(/[.;:\s]+$/, "") + "”", amount: null, currency: null, quote: line.line, start: null, end: null });
    // Round 7 (port): "How much did I pay to reinstate?", "the reinstatement interest": the reinstatement letter's own lines.
    if (/\breinstat\w*/i.test(askedText)) {
      const asks = new Set((askedText.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP_WORDS.has(w) && !/^reinstat/.test(w)));
      const paid = /\b(?:how much|pay|paid|cost|amount)\b/i.test(askedText);
      for (const [docId, pages] of pagesByDoc) {
        const st = statusOf.get(docId);
        if (st?.state !== "reinstated" || st.byDocId !== docId || !inScope(docId)) continue;
        for (const page of pages) for (const [i, raw] of page.text.split(/\r?\n/).entries()) {
          const l = raw.replace(/\t+/g, " ").replace(/\s{2,}/g, " ").trim();
          if (!/(?:S\$|SGD)\s?\d/.test(l) || candidates.some((c) => c.quote === raw)) continue;
          if (![...asks].some((w) => l.toLowerCase().includes(w)) && !(paid && /\b(?:total|received)\b/i.test(l))) continue;
          for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "reinstated:" + docId + ":" + page.page + ":" + i, source: "row", topic: "status", title: "Printed", ownerName: personName(ownerId),
            kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: page.page, text: "“" + l.replace(/[.;:\s]+$/, "") + "”", amount: null, currency: null, quote: raw, start: null, end: null });
        }
      }
    }
    // "Why did it lapse?": the sentence that says what was not paid.
    if (/\bwhy\b/i.test(askedText)) for (const [docId, pages] of read) if (inScope(docId) && statusOf.get(docId)?.state === "lapsed") for (const page of pages) for (const line of page.prose)
      if (/\b(?:not paid|unpaid|not received|because)\b/i.test(line.line)) for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "why:" + docId + ":" + line.index, source: "row", topic: "status", title: "Printed", ownerName: personName(ownerId),
        kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: line.page, text: "“" + line.line.replace(/[.;:\s]+$/, "") + "”", amount: null, currency: null, quote: line.line, start: null, end: null });
  }
  // Round 7: a surrender / maturity value table, read as the row the question
  // means -- maturity, now (the last policy year that has ended), a policy
  // year it names -- with every column of that row as printed.
  const valueTableNotes: string[] = [];
  if ((topics.some((t) => t.key === "maturity") || namedDocs.some((id) => kindsOf(id).includes("maturity"))) && /\b(?:surrender\w*|matur\w*|cash value|paid|put in|worth|values?|amounts?|get back|non-guaranteed|guaranteed|how much)\b/i.test(askedText)) {
    const asksPaid = /\b(?:paid|put in|contributed)\b/i.test(askedText);
    const yearAsked = Number(askedText.match(/\b(?:after|in|at|for)\s+(?:policy\s+)?(?:year\s+)?(\d{1,2})(?![\d.%])\s*(?:years?)?\b|\b(\d{1,2})(?:st|nd|rd|th)\s+(?:policy\s+)?year\b|\byear\s+(\d{1,2})(?![\d.%])/i)?.slice(1).find(Boolean) ?? NaN);
    const asksNow = /\b(?:now|today|currently|so far|at the moment|this year|right now)\b/i.test(askedText);
    const asksMaturity = /\bmatur/i.test(askedText) || (/\b(?:non-)?guaranteed\b/i.test(askedText) && !/\b(?:now|today|surrender\w*|year)\b/i.test(askedText));
    for (const [docId, list] of tables) for (const t of list) {
      if (!inScope(docId) || inactive(docId)) continue;
      const start = docs.get(docId)?.effective_date?.slice(0, 10) ?? null;
      const anniversary = (n: number) => start ? (Number(start.slice(0, 4)) + n) + start.slice(4) : null;
      const completed = start ? t.rows.map((r) => r.year).filter((y) => (anniversary(y) ?? "9999") <= today) : [];
      const pick = Number.isFinite(yearAsked) ? t.rows.filter((r) => r.year <= yearAsked).at(-1)
        : asksNow || (asksPaid && !asksMaturity) ? t.rows.filter((r) => completed.includes(r.year)).at(-1)
        : asksMaturity || !start ? t.rows.at(-1) : t.rows.filter((r) => completed.includes(r.year)).at(-1);
      if (!pick) continue;
      const notGuaranteed = (pagesByDoc.get(docId) ?? []).some((p) => /not guaranteed/i.test(p.text));
      const assumedReturn = (pagesByDoc.get(docId) ?? []).some((p) => /assumed (?:investment )?returns?/i.test(p.text));
      const columns = t.header.map((h, i) => ({ h, v: pick.cells[i] })).slice(1)
        .filter((c) => asksPaid ? /premiums? paid/i.test(c.h) : !/premiums? paid/i.test(c.h))
        .map((c) => c.h.replace(/\bat (\d+(?:\.\d+)?%)$/, (_m, rate: string) => assumedReturn ? "at an assumed " + rate + " return" : "at " + rate) + " " + englishPart(c.v) + (notGuaranteed && /\d%/.test(c.h) && !/guaranteed/i.test(c.h) ? " (not guaranteed)" : ""));
      if (!columns.length) continue;
      const when = anniversary(pick.year);
      const label = /matur/i.test(pick.label) ? "At maturity" : "End of policy year " + pick.year;
      // The verified passage is the table from its heading down to the row, as printed.
      const pageLines = ((pagesByDoc.get(docId) ?? []).find((p) => p.page === t.page)?.text ?? "").split(/\r?\n/);
      const from = pageLines.findIndex((l) => l.split("\t").map((c) => latinTail(c.trim())).join("|") === t.header.join("|")), to = pageLines.indexOf(pick.line);
      const block = from >= 0 && to > from ? pageLines.slice(from, to + 1).join("\n") : pick.line;
      for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "valuetable:" + docId + ":" + t.page + ":" + pick.year, source: "row", topic: "maturity", title: label, ownerName: personName(ownerId),
        kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: t.page,
        text: label + ": " + columns.join("; "), amount: null, currency: null, quote: block, start: null, end: null });
      if (when && !/matur/i.test(pick.label)) valueTableNotes.push("Policy year " + pick.year + " of " + docName(docId) + (when <= today ? " ended" : " ends") + " on " + longDate(when) + ", counted from its start date of " + longDate(start!) + ".");
      // When it matures, as the schedule prints it.
      const maturity = (read.get(docId) ?? []).flatMap((p) => p.meta).find((m) => /^maturity date$/i.test(m.label));
      if (asksMaturity && maturity) for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "maturitydate:" + docId, source: "row", topic: "maturity", title: maturity.label, ownerName: personName(ownerId),
        kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: maturity.page,
        text: "Maturity date: " + englishPart(maturity.value), amount: null, currency: null, quote: maturity.line, start: null, end: null });
    }
    // "How old will he be?": the age the schedule prints beside the maturity date.
    {
      const at = candidates.find((c) => c.id.startsWith("maturitydate:"));
      const age = at && /\bhow old\b|\bwhat age\b/i.test(askedText) ? at.text.match(/^Maturity date: (.+?) \((when [^)]*\b(?:is|aged?) \d{1,3}\b[^)]*)\)/) : null;
      if (at?.policyId && age) valueTableNotes.push(docName(at.policyId) + " matures on " + age[1] + ", " + age[2] + " (page " + at.page + ").");
    }
    // A table answers the value question; the schedule's other rows (sum assured, premium) are not the answer.
    // "When does it mature?": the date, not the values.
    if (/^\s*(?:and\s+)?(?:when|what date|which year)\b/i.test(askedText) && candidates.some((c) => c.id.startsWith("maturitydate:")))
      candidates.splice(0, candidates.length, ...candidates.filter((c) => c.topic !== "maturity" || c.id.startsWith("maturitydate:")));
    if (candidates.some((c) => c.id.startsWith("valuetable:")) && !asksMaturity) candidates.splice(0, candidates.length, ...candidates.filter((c) => c.topic !== "maturity" || c.id.startsWith("valuetable:")));
  }
  // Round 7: an investment-linked plan's statement answers "how much is it
  // worth" with its total fund value, "how many units" with the units held.
  if (topics.some((t) => t.key === "investment")) {
    const want = /\bunits?\b/i.test(askedText) ? /units/i : /\bbid|price\b/i.test(askedText) ? /price/i : /\bworth|fund value|value\b|how much\b/i.test(askedText) ? /value/i : null;
    const fund = askedText.match(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)*) (?:Fund|fund)\b/)?.[1];
    if (want) {
      const kept = candidates.filter((c) => c.topic === "investment" && (want.test(c.tier ?? "") || (want.source === "value" && /fund value|account value/i.test(c.title))) && (!fund || new RegExp(fund, "i").test(c.title)));
      const total = want.source === "value" && !fund ? kept.filter((c) => /total/i.test(c.title)) : kept;
      if (total.length) candidates.splice(0, candidates.length, ...candidates.filter((c) => c.topic !== "investment" || c.id.startsWith("meta:")), ...total);
      // Round 7 (port): a value is as at the statement's own date, said with it.
      for (const id of new Set(total.map((c) => c.policyId))) { const d = docs.get(id); if (d?.document_date && /statement/.test(d.document_role ?? "")) valueTableNotes.push(docName(id) + " values are as at " + longDate(d.document_date) + ", the date of the statement.") }
    }
  }
  // "Which policies renew in the next 60 days?": only the ones whose period ends inside that window.
  let windowDays = NaN;
  {
    windowDays = Number(askedText.match(/\b(?:in|within) the next (\d{1,3}) days\b|\bnext (\d{1,3}) days\b|\bwithin (\d{1,3}) days\b/i)?.slice(1).find(Boolean) ?? NaN);
    if (Number.isFinite(windowDays) && topics.some((t) => t.key === "renewal" || t.key === "status")) {
      const inWindow = (id: string | null) => { const st = id ? statusOf.get(id) : null; if (!st?.date || st.state !== "in_force") return false; const n = daysBetween(today, st.date); return n >= 0 && n <= windowDays; };
      const kept = candidates.filter((c) => inWindow(c.policyId));
      if (!kept.length) {
        const whoseDocs = args.people.length === 1 ? (isSelf(args.people[0].id) ? "your" : personName(args.people[0].id) + "’s") : "your family’s";
        return result({ handled: true, answer: { mode: "answer", summary: "None of the policies in " + whoseDocs + " documents ends or renews in the next " + windowDays + " days.", details: [], citations: [], confidence: "insufficient_evidence", nextSteps: [], questions: [], policyStatedLimits: [], verifiedPolicyFactsOnly: true, verifiedPolicyFigures: [] } });
      }
      candidates.splice(0, candidates.length, ...kept);
    }
  }
  // "Why did my term policy lapse?", "Has my term life ended?": the plan whose status is in question, not the others of its kind.
  if (topics.some((t) => t.key === "status") && !/\b(?:which|list|any|all|every)\b/i.test(askedText) && candidates.some((c) => c.policyId && ["lapsed", "grace", "grace_passed", "reinstated"].includes(statusOf.get(c.policyId)?.state ?? "")))
  {
    const kinds = topics.filter((t) => t.kind).map((t) => t.key);
    const ofKind = (id: string) => !kinds.length || kinds.some((k) => kindsOf(id).includes(k));
    const keep = candidates.filter((c) => !c.policyId || (["lapsed", "grace", "grace_passed", "reinstated"].includes(statusOf.get(c.policyId)?.state ?? "") && ofKind(c.policyId)));
    if (keep.some((c) => c.policyId)) candidates.splice(0, candidates.length, ...keep);
  }
  // "Max co-pay with the rider?": the rider's premium line is not its benefits.
  {
    const premiumLine = (c: RawCandidate) => /\bpremium\b/i.test(c.title + " " + c.text.split(":")[0]) && !NARROW.some((n) => n.asks.test(askedText) && n.fact.test(c.text.replace(/\([^)]*\)/g, "")));
    if (!topics.some((t) => t.key === "premium" || t.key === "status") && !isPremiumAsked(askedText) && candidates.some((c) => !premiumLine(c))) candidates.splice(0, candidates.length, ...candidates.filter((c) => !premiumLine(c)));
  }
  // "the sum assured on my lapsed term plan": the plan that lapsed, not the ones still in force.
  if (/\b(?:my|the|his|her|their|our)\s+(?:lapsed|expired|ended|old|cancelled)\b/i.test(askedText) && candidates.some((c) => c.policyId && inactive(c.policyId)))
    candidates.splice(0, candidates.length, ...candidates.filter((c) => !c.policyId || inactive(c.policyId)));
  // "the rider premium": the rider's premium, not the rider's benefits.
  if (topics.some((t) => t.key === "premium") && topics.every((t) => t.key === "premium" || t.key === "rider") && candidates.some((c) => c.topic === "premium"))
  {
    candidates.splice(0, candidates.length, ...candidates.filter((c) => c.topic === "premium" || /premium/i.test(c.title)));
    // "and the rider premium?": the rider's line; "can the rider be paid from MediSave?" keeps the plan's line beside it.
    const riderLines = candidates.filter((c) => /\brider\b/i.test(c.text + " " + (c.tier ?? "")));
    if (topics.some((t) => t.key === "rider") && riderLines.length && !/\b(?:medisave|cash|cpf)\b/i.test(askedText)) candidates.splice(0, candidates.length, ...riderLines);
  }
  // "who else was on it?", "as of when?": the schedule line that says so, not the benefits again.
  if (metaWanted.length && !/\b(?:how much|pays?|cover(?:ed|s)?|premium|value|excess)\b/i.test(askedText.replace(/,[^,?]*,\s*\?$/, "?")) && candidates.some((c) => c.id.startsWith("meta:")))
    candidates.splice(0, candidates.length, ...candidates.filter((c) => c.id.startsWith("meta:") || c.id.startsWith("status:")));
  // A cover amount stored from the schedule is the same fact as the printed row that states it: one line.
  for (let i = candidates.length - 1; i >= 0; i--) {
    const c = candidates[i];
    if (c.source === "coverage" && candidates.some((o) => o !== c && o.source !== "coverage" && o.policyId === c.policyId && o.amount != null && o.amount === c.amount)) candidates.splice(i, 1);
  }
  // Round 7: the particular thing asked ("a burst pipe", "termite damage", "what counts as severe disability")
  // is answered by the line or sentence that names it, not by every row of the plan.
  if (wordOnly && !candidates.length) return result({});
  if (candidates.length && !conditionAsked) {
    // Words inside a phrase that names a topic or a plan ("life cover", "annual limit", "car insurance") are not the particular thing.
    let rest = askedText.toLowerCase();
    for (const re of [...TOPICS.map((t) => t.asks), ...NARROW.map((n) => n.asks), ...PLAN_KINDS.map((p) => p.re), GENERAL]) rest = rest.replace(new RegExp(re.source, "gi"), " ");
    const topicWord = (_w: string) => false;
    const productWordSet = new Set([...docs.values()].flatMap((d) => (d.product_name ?? "").toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4)));
    const specific = [...new Set((rest.match(/[a-z][a-z'-]{2,}/g) ?? []).map((w) => w.replace(/['’]s$/, "")))].filter((w) => !productWordSet.has(w) && !/^polic(?:y|ies)$/.test(w))
      // Round 9: "will the life cover reduce after?", "is it enough?": a verb or a judgement is not a thing to look for.
      .filter((w) => !/^(?:reduc\w*|increas\w*|chang\w*|enough|after|before|still|better|worse|good|bad|cheap\w*|expensive|happen\w*|affect\w*|drop\w*|lower|higher|more|less|stop\w*|continu\w*|work\w*|exactly|really|actually)$/.test(w))
      .filter((w) => (w.length >= 4 || /^(?:ivf|hiv|tcm|lasik|mri|ncd)$/.test(w)) && !STOP_WORDS.has(w) && !nameWords.has(w) && !topicWord(w) && !/^(?:anyone|anybody|everyone|everybody|someone|somebody|family|household|members?|then|only|just|also|many|days?|each|year|month|amount|value|right|tell|give|show|know|what|cost|worth|happens?|counts?|mean|means|meant|claims?|money|anything|something|thing|things|okay|thanks|where|which|again|limit|limits|sum|insured|assured|benefits?|payout|pays?|paid|much|lah|leh|anot|other|another|more|else|extra|still|also|either|some|every)$/.test(w));
    const defining = /\bwhat (?:counts as|is meant by|does [^?]{1,30} mean)|\bdefin\w+|\bmeaning of\b/i.test(askedText);
    // A named benefit (NARROW) or a topic answered from its own lines (ward class, dates, status) is narrowed its own way.
    const ownWay = NARROW.some((n) => n.asks.test(askedText)) || topics.some((t) => ["ward", "renewal", "status", "maturity", "premium"].includes(t.key));
    if (wordOnly && (!specific.length || ownWay)) return result({});
    if ((specific.length && !ownWay) || defining) {
      const says = (c: RawCandidate) => specific.some((w) => (c.text + " " + (c.tier ?? "")).toLowerCase().includes(w.slice(0, 5)));
      const prose = proseFor().filter((p) => defining || says(p));
      const named = candidates.filter(says);
      if (wordOnly && (!named.length || named.length === candidates.length)) return result({});
      const coverQuestion = /^(?:does|do|is|are|will|would|can)\b[^?]*\b(?:cover(?:ed|s)?|pay(?:s)? for|include(?:s|d)?)\b/i.test(askedText);
      if ((coverQuestion || !topics.length) && specific.length && !named.length && !prose.length && !defining) {
        const words = askedText.match(new RegExp("\\b(?:" + specific.map((w) => w.replace(/[^a-z'-]/g, "")).join("|") + ")\\b[^?]*", "i"))?.[0] ?? specific.join(" ");
        const span = specific.length > 1 ? words.slice(0, words.toLowerCase().lastIndexOf(specific.at(-1)!) + specific.at(-1)!.length) : askedText.match(new RegExp("\\b" + specific[0] + "\\b", "i"))?.[0] ?? specific[0];
        const plans = [...new Set(candidates.map((c) => docName(c.policyId)))];
        const whoseDocs = args.people.length === 1 && !isSelf(args.people[0].id) ? personName(args.people[0].id) + "’s" : "your";
        // Round 11: "giving birth" is printed as "childbirth", "asthma" as a pre-existing condition: that printed line, when there is one.
        const ruleDocs = new Map([...pagesByDoc].filter(([id]) => candidates.some((c) => c.policyId === id) && inScope(id)));
        const rules = printedRuleLines(askedText, "", ruleDocs, docName, { ignore: [...nameWords], sameThingOnly: true, columns: columnsOf(ruleDocs.keys()) });
        if (rules.length) {
          const named = [...new Set(rules.map((r) => r.citation.policyName))];
          const lead = "Here is what " + (args.people.length === 1 && !isSelf(args.people[0].id) ? personName(args.people[0].id) + "’s " : "your ") + (named.length === 1 ? named[0] : "documents") + " " + (named.length === 1 ? "prints" : "print") + " about that:";
          citePageLines(null, rules.map((r) => r.text), rules.map((r) => r.citation));
          return result({ handled: true, answer: { mode: "answer", summary: lead, details: rules.map((r) => r.text), citations: rules.map((r) => r.citation), confidence: "partial_match", nextSteps: [], questions: [], policyStatedLimits: [], verifiedPolicyFactsOnly: true,
            verifiedPolicyFigures: [...new Set(rules.flatMap((r) => r.text.match(new RegExp(MONEY_PATTERN.source, "gi")) ?? []))] } });
        }
        const summary = "DearPolicy didn’t find anything about " + span.trim() + " in " + whoseDocs + " " + (plans.length === 1 ? plans[0] + " documents" : "documents") + ". That does not mean the policy leaves it out — the insurer can confirm.";
        return result({ handled: true, answer: { mode: "answer", summary, details: [], citations: [], confidence: "insufficient_evidence", nextSteps: [], questions: [], policyStatedLimits: [], verifiedPolicyFactsOnly: true, verifiedPolicyFigures: [] }, notFound: [span] });
      }
      if (defining && prose.length) candidates.splice(0, candidates.length, ...prose);
      else if (named.length) candidates.splice(0, candidates.length, ...named, ...prose.filter((p) => !named.some((n) => n.id === p.id)));
      else if (prose.length) candidates.splice(0, candidates.length, ...prose);
    }
  }
  // Only the documents the question is about.
  const scoped = candidates.filter((c) => inScope(c.policyId));
  if (scoped.length || namedDocs.length || kindDocs.length) candidates.splice(0, candidates.length, ...scoped);
  // "What is the deductible / co-insurance / rider co-payment cap?" is about
  // those rows, not every benefit of the plan.
  // Who has anything at all on the topics asked, before any narrowing.
  const withAnyLine = new Set(candidates.filter((c) => inScope(c.policyId)).map((c) => c.subjectId));
  const setAside = new Set<string>();
  if (topics.some((t) => t.key === "cost_sharing")) {
    const terms = candidates.filter((c) => c.topic !== "hospital" && c.topic !== "general");
    if (terms.some((c) => c.topic === "cost_sharing")) {
      // Found, but set aside for the terms asked: never reported as missing.
      for (const c of candidates) if (!terms.includes(c)) setAside.add(c.topic);
      candidates.splice(0, candidates.length, ...terms);
    }
  }
  const narrowQuoted = new Map<string, string>();
  const narrow = NARROW.filter((n) => n.asks.test(askedText));
  // A particular term that was asked and that no line names ("deductible"
  // on a term life plan) is said to be not found, not answered with neighbours.
  let narrowMissing: string[] = [];
  let narrowAnswered = false;
  if (narrow.length && !candidates.some((c) => c.source === "condition")) {
    for (const [docId, pages] of read) if (inScope(docId)) for (const page of pages) for (const row of page.premiums)
      if (narrow.some((n) => n.fact.test((row.label + " " + row.value).replace(/\([^)]*\)/g, ""))) && !candidates.some((c) => c.id === "premiumrow:" + docId + ":" + row.page + ":" + row.index))
        for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "premiumrow:" + docId + ":" + row.page + ":" + row.index, source: "premium", topic: topics[0]?.key ?? "premium", title: row.label, ownerName: personName(ownerId),
          kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: row.page, text: row.label + ": " + row.value, amount: null, currency: null, quote: row.line, start: null, end: null });
    const names = (c: RawCandidate, n: { fact: RegExp }) => n.fact.test(c.title) || (!n.fact.source.startsWith("^") && n.fact.test(c.text.slice(c.title.length)))
      // Round 9: "skull?" is named by the benefit's printed wording ("S$2,000 for skull or spine"), shown with the line.
      || (!n.fact.source.startsWith("^") && !!c.quote && n.fact.test(c.quote) && !!narrowQuoted.set(c.id, c.quote));
    const named = candidates.filter((c) => narrow.some((n) => names(c, n)));
    // Round 9: what is said to be missing is a thing ("a deductible"), never a scrap of the question ("before they pay").
    for (const n of narrow) if (!candidates.some((c) => names(c, n))) { const w = askedText.match(n.asks)?.[0]?.toLowerCase().replace(/^deductable/, "deductible") ?? ""; narrowMissing.push(/\b(?:they|it|i|we|you|he|she|how|what|when|pay|pays|for)\b/i.test(w) ? "" : w); }
    // The plan of the kind asked ("Irfan's accident sum insured") before any other plan's line of the same name.
    const kindAsked = topics.filter((t) => t.kind).map((t) => t.key);
    if (kindAsked.length && named.some((c) => kindsOf(c.policyId).some((k) => kindAsked.includes(k)))) named.splice(0, named.length, ...named.filter((c) => kindsOf(c.policyId).some((k) => kindAsked.includes(k))));
    const prose = !named.length && narrowMissing.length === narrow.length ? proseFor() : [];
    if (prose.length) { candidates.splice(0, candidates.length, ...prose); narrowMissing = []; narrowAnswered = true; }
    else if (named.length) { candidates.splice(0, candidates.length, ...named); narrowAnswered = true; }
    // Only cost-sharing terms were asked and none is printed: neighbours
    // (a GP co-payment, an overall limit) are not the answer.
    else if (topics.every((t) => t.key === "cost_sharing" || t.key === "hospital") && narrowMissing.length === narrow.length)
      return result({ notFound: narrowMissing.filter(Boolean).map((w) => /^(?:deductible|co-?payment|co-?pay|pro-?ration|annual limit|policy[- ]year limit|overall limit|yearly limit)$/.test(w) ? (/^[aeiou]/.test(w) ? "an " : "a ") + w : w) });
  }
  if (!candidates.length) candidates.push(...proseFor());
  if (!candidates.length || candidates.every((c) => c.id.startsWith("notice:"))) {
    // The only document for the plan asked about is a premium notice: say so, with its page.
    const billing = [...docs.keys()].filter((id) => paymentOnly(id) && (namedDocs.includes(id) || topics.some((t) => kindsOf(id).includes(t.key)) || (!topics.length && general && args.people.length === 1)));
    if (billing.length && /\bhow much\b|\bamount\b|\bwhen\b|\bdue\b/i.test(askedText) && !/\bpays?\b|\bbenefits?\b|\bcover/i.test(askedText)) {
      for (const id of billing) for (const page of read.get(id) ?? []) for (const row of [...page.premiums, ...page.meta.filter((m) => /due date/i.test(m.label))])
        for (const ownerId of speaksFor.get(id) ?? []) candidates.push({ id: "notice:" + id + ":" + row.page + ":" + row.index, source: "premium", topic: "premium", title: row.label, ownerName: personName(ownerId),
          kind: "policy_fact", subjectId: ownerId, policyId: id, documentHash: docs.get(id)?.file_hash ?? null, page: row.page, text: row.label + ": " + row.value, amount: null, currency: null, quote: row.line, start: null, end: null });
    }
    if (billing.length && !candidates.length) {
      const id = billing[0];
      const page = (read.get(id) ?? []).find((p) => p.premiums.length || p.meta.length);
      const at = page?.premiums[0] ?? page?.meta[0];
      const whose = args.people.length === 1 && !isSelf(args.people[0].id) ? personName(args.people[0].id) + "’s" : "your";
      const owner = whose === "your" ? "Your" : whose;
      // "how much does it pay a day?": the thing asked is not shown, said plainly.
      const summary = !GENERAL.test(askedText) && topics.length === 0 && /\b(?:pays?|cover\w*|how much|benefits?|limit)\b/i.test(askedText)
        ? owner + " documents don’t show what " + docName(id) + " pays: the only document on file for it is a premium notice" + (at ? " (page " + at.page + ")" : "") + ", which shows just the premium and when it is due. The policy schedule would show the benefits."
        : "There are no benefit details for " + docName(id) + " in " + (whose === "your" ? "your" : whose) + " documents: the only document on file for it is a premium notice" + (at ? " (page " + at.page + ")" : "") + ", which shows the premium and when it is due, not what the plan pays. The policy schedule would show that.";
      const citations: ChatCitation[] = at ? [{ chunkId: "notice:" + id, policyId: id, policyName: docName(id), insurer: docs.get(id)?.insurer ?? undefined, pageStart: at.page, pageEnd: at.page, personalEvidence: false, evidenceLabel: "Premium notice" }] : [];
      return result({ handled: true, answer: { mode: "answer", summary, details: [], citations, confidence: "insufficient_evidence", nextSteps: [], questions: [], policyStatedLimits: [], verifiedPolicyFactsOnly: true, verifiedPolicyFigures: [] }, notFound: topics.map((t) => t.label) });
    }
    return result({ notFound: topics.map((t) => t.label) });
  }
  // A lapsed or ended policy is still quoted, but always with the date the
  // document prints for it, cited to the page that prints it.
  const expired = (policyId: string) => inactive(policyId);
  for (const docId of new Set(candidates.map((c) => c.policyId))) {
    if (!expired(docId)) continue;
    const row = (read.get(docId) ?? []).flatMap((p) => p.meta).find((m) => /expiry|end date/i.test(m.label));
    if (!row) continue;
    const iso = row.value.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
    for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "expiry:" + docId, source: "expiry", topic: "expiry", title: row.label, ownerName: personName(ownerId),
      kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: row.page,
      text: row.label + ": " + row.value, amount: null, currency: null, date: iso, quote: row.line, start: null, end: null });
  }

  // "25% of the sum insured": the sum insured it is a percentage of is shown beside it.
  for (const docId of new Set(candidates.filter((c) => /% of the sum (?:insured|assured)/i.test(c.text)).map((c) => c.policyId))) {
    if (candidates.some((c) => c.policyId === docId && /^(?:basic )?sum (?:insured|assured)\b/i.test(c.title))) continue;
    const base = (read.get(docId) ?? []).flatMap((p) => p.rows).find((r) => /^(?:basic )?sum (?:insured|assured)$/i.test(r.label) && MONEY_IN_TEXT.test(r.value));
    if (!base) continue;
    const printed = printedAmount(base.value);
    for (const ownerId of speaksFor.get(docId) ?? []) candidates.push({ id: "row:" + docId + ":" + base.page + ":" + base.index, source: "row", topic: candidates.find((c) => c.policyId === docId)?.topic ?? "general", title: base.label, ownerName: personName(ownerId),
      kind: "policy_fact", subjectId: ownerId, policyId: docId, documentHash: docs.get(docId)?.file_hash ?? null, page: base.page, text: base.label + ": " + base.value, amount: printed.amount, currency: printed.amount != null ? printed.currency : null, quote: base.line, start: null, end: null });
  }
  // "When is it due?" is the due date; "how much?" is the amount.
  if (topics.some((t) => t.key === "premium") && /\b(?:when|due|deadline|by when)\b/i.test(askedText) && candidates.some((c) => c.id.startsWith("premiumdue:")) && !/\bhow much|amount\b/i.test(askedText))
    candidates.splice(0, candidates.length, ...candidates.filter((c) => c.id.startsWith("premiumdue:") || c.topic !== "premium"));
  // A policy that has lapsed or ended is not the answer when one in force answers it,
  // unless the question is about the old policy itself.
  if (!/\b(?:was|were|did|had|before|lapsed?|expired?|ended|old|previous|last|reinstat\w*)\b/i.test(askedText) && candidates.some((c) => c.source !== "expiry" && !expired(c.policyId)) && candidates.some((c) => expired(c.policyId)))
    candidates.splice(0, candidates.length, ...candidates.filter((c) => !expired(c.policyId)));
  // Passages, from the stored page text.
  const pages = await pageTexts(args.accountId, docs, candidates.filter((c) => c.page != null && c.page > 0).map((c) => ({ policyId: c.policyId, page: c.page! })));
  const pageText = (policyId: string, page: number) => pages.get(policyId + "#" + page) ?? null;
  const assertions: Candidate[] = candidates.map((raw) => {
    const { quote, start, end, storedConditions, ...c } = raw;
    const page = c.page ? pageText(c.policyId, c.page) : null;
    const passage = locatePassage(page, { start, end, quote, amount: c.amount });
    // Only conditions the passage itself states are carried; anything else
    // would be a condition the answer introduced.
    const conditions = (storedConditions ?? []).filter((x) => normalPassage(passage).includes(normalPassage(x).replace(/[.;]+$/, "")));
    // Round 16: a short line built from a stored benefit says the period and conditions its passage prints with it.
    return { ...c, text: withPrintedQualifiers({ text: c.text, passage, amount: c.amount, conditions }), passage, conditions };
  });
  const documents: Record<string, AssertionDocument> = {};
  for (const [id, d] of docs) documents[id] = { id, accountId: d.account_id, lifecycleState: d.lifecycle_state, supersededAt: d.superseded_at,
    quarantineStatus: d.quarantine_status, fileHash: d.file_hash, subjectIds: [...(speaksFor.get(id) ?? [])] };
  const verifyCtx = { accountId: args.accountId, people: args.people, documents, pageText };
  const { kept: keptRaw, rejected } = verifyAssertions(assertions, verifyCtx);
  // A recorded conflict is shown, not resolved: each side that is otherwise
  // fully verified is listed with its own page.
  const conflictSides = verifyAssertions(rejected.filter((r) => r.reason.startsWith("conflict: ")).map((r) => ({ ...r.assertion, conflictNote: null })), verifyCtx).kept as Candidate[];
  // One line per fact per person (a coverage row and its benefit row can say the same).
  const seen = new Set<string>();
  // The same value in two columns of one table is one line, without a column name.
  const firstOf = new Map<string, Candidate>();
  const replacedNotes: { old: Candidate; byDocId: string; byDate: string; now?: { after: number; label: string; page: number; line: string } }[] = [];
  let kept = (keptRaw as Candidate[]).filter((a) => { const k = a.subjectId + "|" + a.policyId + "|" + normalPassage(a.text); const prev = firstOf.get(k);
    if (prev) { if (prev.tierLabel !== a.tierLabel) prev.tierLabel = null; return false; } if (seen.has(k)) return false; seen.add(k); firstOf.set(k, a); return true; });
  // Round 7: a figure a later endorsement of the same policy replaced is not
  // shown as current; the answer says which document replaced it.
  {
    const replaced = await replacedFigures(args.accountId, [...docs.keys()]).catch(() => new Map());
    const gone = kept.filter((a) => a.amount != null && replaced.get(a.policyId)?.amounts.has(a.amount));
    for (const a of gone) {
      const rep = replaced.get(a.policyId)!;
      // (With the figure the amendment prints in its place, when its Before / After row says so.)
      const row = (rep.rows ?? []).find((r: { before: number }) => r.before === a.amount);
      if (!replacedNotes.some((n) => n.old.policyId === a.policyId && n.old.amount === a.amount)) replacedNotes.push({ old: a, byDocId: rep.byDocId, byDate: rep.byDate, ...(row ? { now: row } : {}) });
    }
    kept = kept.filter((a) => !gone.includes(a));
  }
  // Round 7: rows a schedule prints per age band ("Deductible (A ward, age 80
  // and below)" / "(age 81 and above)") apply to the person by their age on
  // the day asked: from their date of birth on People (Account settings), else the
  // date of birth the document prints for them. The other band is left out.
  const ages = new Map<string, number>();
  {
    const dobs = await query<{ id: string; dob: string | null }>(`SELECT id::text AS id,date_of_birth::text AS dob FROM family_members WHERE account_id=$1 AND id::text=ANY($2::text[]) AND ${activePredicate()}`, [args.accountId, args.people.map((p) => p.id)]).catch(() => ({ rows: [] as { id: string; dob: string | null }[] }));
    for (const r of dobs.rows) if (r.dob) ages.set(r.id, ageOn(r.dob, now));
  }
  const printedAge = (a: Candidate) => {
    const text = (pagesByDocEarly.get(a.policyId) ?? []).map((p) => p.text).join("\n");
    const m = text.match(/date of birth\s*[:\t]?\s*(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|\d{4}-\d{2}-\d{2})/i);
    if (!m || (speaksFor.get(a.policyId)?.size ?? 0) !== 1) return null;
    const d = new Date(m[1] + (/^\d{4}-/.test(m[1]) ? "T00:00:00Z" : " UTC"));
    return Number.isNaN(d.getTime()) ? null : ageOn(d.toISOString().slice(0, 10), now);
  };
  const ageNotes = new Set<string>();
  // "after Papa turns 81", "when I'm 70", "at age 66": the age asked about, not today's.
  const askedAge = Number(askedText.match(/\b(?:turns?|turning|reach(?:es)?|when (?:\w+ (?:is|are)|i['’]?m|i am|he['’]?s|she['’]?s)|at(?: age)?|aged?|above|over|past)\s+(\d{2,3})\b/i)?.[1] ?? NaN);
  kept = kept.filter((a) => {
    const band = ageBand(a.title + " " + a.text);
    if (!band) return true;
    const age = Number.isFinite(askedAge) && askedAge >= 18 && askedAge <= 110 ? askedAge : ages.get(a.subjectId) ?? printedAge(a);
    if (age == null) return true;
    const fits = band.kind === "max" ? age <= band.age : age >= band.age;
    if (fits) ageNotes.add(Number.isFinite(askedAge) && askedAge === age ? "At " + age + ", the row for " + band.text + " applies." : a.ownerName + " is " + age + ", so the row for " + band.text + " applies.");
    return fits;
  });
  // Pages of one policy that state different figures for the same thing
  // ("Sum insured: S$300,000" on p1, "Death benefit US$350,000" on p2) are a
  // conflict too, whether or not ingestion flagged it.
  const policyKey = (policyId: string) => (docs.get(policyId)?.policy_number ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") || policyId;
  const groups = new Map<string, Candidate[]>();
  // Only benefits and covers are compared: never premiums, conditions, dates
  // or schedule terms, and never two columns (tiers) of one table.
  for (const a of [...kept, ...conflictSides]) {
    if (a.amount == null || a.source === "premium" || a.source === "condition" || a.source === "expiry" || PREMIUM_ROW.test(a.title) || (a.rowKind && a.rowKind !== "benefit")) continue;
    const key = a.subjectId + "|" + policyKey(a.policyId) + "|" + sameThingKey(a.title) + "|" + (a.tier ?? "").toLowerCase();
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(a);
  }
  let conflicting: Candidate[][] = [...groups.values()].filter((g) => new Set(g.map((a) => a.amount + "|" + a.currency)).size > 1);
  // Round 7: two documents of the SAME policy that differ because the later
  // one amends the earlier (an endorsement reducing the sum assured) are not
  // a conflict: the amendment states the current figure, and the answer
  // says which document replaced which. Anything less certain -- undated
  // documents, two of the same date, an amendment that disagrees with
  // itself -- stays a conflict and is shown as one.
  const amendments: { current: Candidate[]; replaced: Candidate[] }[] = [];
  {
    const dateOfDoc = (id: string) => { const d = docs.get(id); return (d?.document_date ?? d?.effective_date ?? "").slice(0, 10) || null; };
    const amends = (id: string) => docs.get(id)?.document_role === "endorsement" ||
      /\bendorsement\s+no\b|\b(?:is|are|hereby|has been|have been)\s+(?:amended|altered|reduced|increased|replaced)\b|\bpolicy is altered\b|\b(?:reduction|increase) of sum (?:assured|insured)\b/i.test((pagesByDocEarly.get(id) ?? []).map((p) => p.text).join("\n"));
    conflicting = conflicting.filter((group) => {
      const ids = [...new Set(group.map((a) => a.policyId))];
      if (ids.length < 2 || ids.some((id) => !dateOfDoc(id))) return true;
      const ordered = [...ids].sort((a, b) => String(dateOfDoc(b)).localeCompare(String(dateOfDoc(a))));
      const newest = ordered[0];
      if (dateOfDoc(ordered[1])! >= dateOfDoc(newest)! || !amends(newest)) return true;
      const current = group.filter((a) => a.policyId === newest);
      if (new Set(current.map((a) => a.amount + "|" + a.currency)).size !== 1) return true;
      amendments.push({ current, replaced: group.filter((a) => a.policyId !== newest && a.amount !== current[0].amount) });
      return false;
    });
  }
  const amendedIds = new Set(amendments.flatMap((m) => [...m.current, ...m.replaced]).map((a) => a.id + "|" + a.subjectId));
  const replacedIds = new Set(amendments.flatMap((m) => m.replaced).map((a) => a.id + "|" + a.subjectId));
  const inConflict = new Set(conflicting.flat().map((a) => a.id + "|" + a.subjectId));
  kept = kept.filter((a) => !inConflict.has(a.id + "|" + a.subjectId) && !replacedIds.has(a.id + "|" + a.subjectId));
  for (const m of amendments) for (const a of m.current) if (!kept.some((k) => k.id === a.id && k.subjectId === a.subjectId)) kept.push(a);
  void amendedIds;
  // The rows that name what was asked come first ("deductible" before the co-insurance printed beside it).
  const askedWords = (askedText.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !/^(?:what|which|does|have|with|that|this|much|when|from|about|plan|policy|policies|cover|covered|shield|pays?|there|their|would|should|could|also|please|insurance)$/.test(w));
  const relevance = (a: Candidate) => askedWords.filter((w) => a.title.toLowerCase().includes(w.replace(/s$/, ""))).length + (a.tierLabel ? -0.5 : 0) + (a.id.startsWith("wardline:") ? 5 : 0);
  kept = kept.map((a, i) => ({ a, i })).sort((x, y) => relevance(y.a) - relevance(x.a) || x.i - y.i).map((x) => x.a);
  // A conflict flag whose other side is not in this answer still withholds.
  const unresolved = rejected.filter((r) => r.reason.startsWith("conflict: ") && !inConflict.has((r.assertion as Candidate).id + "|" + r.assertion.subjectId));
  // The expiry line belongs only beside facts from that document.
  kept = kept.filter((a) => a.source !== "expiry" || kept.some((b) => b.source !== "expiry" && b.policyId === a.policyId) || conflicting.flat().some((b) => b.policyId === a.policyId));

  // Currentness: an outdated document is still quoted, with its date, and
  // never presented as the current terms.
  const latestPremium = await query<{ policy_id: string; latest: string | null }>(
    `SELECT coalesce(source_document_id,policy_id)::text AS policy_id,max(coalesce(payment_date,period_end,period_start))::text AS latest
       FROM premium_records WHERE account_id=$1 AND coalesce(source_document_id,policy_id)::text=ANY($2::text[]) GROUP BY 1`, [args.accountId, docIds]).catch(() => ({ rows: [] as { policy_id: string; latest: string | null }[] }));
  const premiumBy = new Map(latestPremium.rows.map((r) => [r.policy_id, r.latest]));
  const monthsAgo = (iso: string | null) => iso ? (now.getTime() - new Date(iso.slice(0, 10) + "T00:00:00Z").getTime()) / (30.44 * 86400_000) : null;
  /** Round 12: the other documents of the same policy (same policy number, or same product for the same people). */
  const sameContract = (policyId: string) => {
    const d = docs.get(policyId); if (!d) return [];
    const num = (x: DocRow) => (x.policy_number ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const owners = speaksFor.get(policyId) ?? new Set<string>();
    return [...docs.values()].filter((o) => o.id !== policyId && !inactive(o.id) && (num(d) && num(o) === num(d)
      || !!d.product_name && (o.product_name ?? "").toLowerCase() === d.product_name.toLowerCase() && [...(speaksFor.get(o.id) ?? [])].some((x) => owners.has(x))));
  };
  const outdated = (policyId: string) => {
    const d = docs.get(policyId); if (!d) return false;
    if (expired(policyId)) return true;
    // A grace-period reminder is itself the latest word on the policy; a
    // policy whose printed period (two years or less) runs past today is the current one.
    const st = statusOf.get(policyId);
    if (st?.state === "grace") return false;
    const period = printedPeriodEnd(pagesByDoc.get(policyId) ?? []);
    const begins = d.effective_date?.slice(0, 10) ?? null;
    if (st?.state === "in_force" && period && begins && begins <= today && daysBetween(begins, period.iso) <= 800) return false;
    const age = monthsAgo(d.document_date ?? d.effective_date), paid = monthsAgo(premiumBy.get(policyId) ?? null);
    // Round 12: currentness is the policy's, not one document's -- a 2026 statement or renewal notice on file
    // for the same policy makes its 1988 contract current too.
    if (age != null && age > 15 && sameContract(policyId).some((o) => { const a2 = monthsAgo(o.document_date ?? o.effective_date), p2 = monthsAgo(premiumBy.get(o.id) ?? null); return (a2 != null && a2 <= 15) || (p2 != null && p2 <= 13); })) return false;
    return age != null && age > 15 && !(paid != null && paid <= 13);
  };
  const dateOf = (policyId: string) => { const d = docs.get(policyId); return d ? shortDate(d.document_date ?? d.effective_date) : null; };

  const citations: ChatCitation[] = [], details: string[] = [], limits: PolicyStatedLimit[] = [];
  const cite = (a: Candidate) => {
    const citation: ChatCitation = { chunkId: a.id, policyId: a.policyId, policyName: docName(a.policyId), insurer: docs.get(a.policyId)?.insurer ?? undefined,
      pageStart: a.page, pageEnd: a.page, personalEvidence: docs.get(a.policyId)?.personal_coverage_confirmed ?? false,
      evidenceLabel: evidenceLabel(a.policyId),
      excerpt: a.passage.slice(0, 280), documentDate: dateOf(a.policyId), notConfirmedCurrent: outdated(a.policyId) };
    if (!citations.some((c) => c.chunkId === citation.chunkId)) citations.push(citation);
    return citation;
  };
  const line = (a: Candidate) => {
    const dated = dateOf(a.policyId), who = args.people.length > 1 ? a.ownerName + " · " : "";
    const st = statusOf.get(a.policyId);
    const status = a.source === "expiry" ? "" : st?.state === "lapsed" ? "; lapsed on " + st.printed : "";
    // A value printed in one column of a table names its column after the benefit ("Deductible (Non-panel provider): ...").
    // A column called just "Value" or "Amount" names nothing the household needs told.
    const labelled = a.tierLabel && !/^(?:values?|amounts?|limits?|benefits?|details?|description|sum insured|s\$)$/i.test(a.tierLabel.trim()) ? (a.text.startsWith(a.title) ? a.title + " (" + a.tierLabel + ")" + a.text.slice(a.title.length) : a.text + " (" + a.tierLabel + ")") : a.text;
    const q = narrowQuoted.get(a.id);
    // Round 11: a trailing footnote number ("... within 180 days 3") is a pointer to small print, not part of the value.
    const quoted = q && q.length <= 200 && !labelled.includes(q) ? " — the schedule prints “" + q.replace(/\s+/g, " ").trim().replace(/[.;:\s]+$/, "").replace(/(?<=[a-z)])\s+\d{1,2}(?:,\s*\d{1,2})*$/i, "") + "”" : "";
    let text = (labelled.replace(/[.;:\s]+$/, "") + quoted).replace(/[.;:\s]+$/, "");
    // Round 10: what a policy excludes is said in its own words, quoted ("Pre-existing conditions are not covered ...").
    if (/\b(?:not covered|isn['’]t covered|aren['’]t covered|no cover(?:age)? for|not insured)\b/i.test(text) && !text.includes("“")) {
      const at = text.indexOf(": ");
      text = at > 0 && at < 60 ? text.slice(0, at) + ": “" + text.slice(at + 2) + "”" : "“" + text + "”";
    }
    // Round 7 (port): a line read by OCR from a scanned page is shown cleaned of
    // the scanner's noise, and says it came from a scan.
    if (looksScanned(text)) text = (cleanScannedLine(text) ?? a.title) + " (read from a scanned page; check it against the original)";
    return who + (a.page != null && riderPages.has(a.policyId + "#" + a.page) ? riderName(a.policyId, a.page) : docName(a.policyId)) + docKind(a.policyId, a.page) + " — " + text + " (page " + a.page + (dated && a.source !== "expiry" && outdated(a.policyId) ? ", document dated " + dated : "") + status + ").";
  };
  // One row of a table read once per column (an employee plan, a ward class) for a person whose own column is not
  // known: one line naming each column's figure, and saying which is theirs is not shown -- never one line per column,
  // each reading like that person's own figure.
  const columnRows = new Map<string, Candidate[]>();
  for (const a of kept) if (a.tierLabel && a.source === "benefit" && a.page != null) {
    const k = a.subjectId + "|" + a.policyId + "|" + a.page + "|" + a.title.toLowerCase();
    (columnRows.get(k) ?? columnRows.set(k, []).get(k)!).push(a);
  }
  const inColumns = new Map<Candidate, Candidate | null>();
  for (const group of columnRows.values()) {
    const labels = [...new Set(group.map((g) => g.tierLabel!.trim().toLowerCase()))];
    if (group.length < 2 || labels.length !== group.length) continue;
    // "the schedule prints “Not covered” in this column" is, beside its column's name, just the printed words.
    const valueOf = (g: Candidate) => (g.text.startsWith(g.title) ? g.text.slice(g.title.length).replace(/^[:\s]+/, "") : g.text).replace(/[.;:\s]+$/, "")
      .replace(/^the schedule prints (“[^”]*”) in this column$/, "$1");
    // In the order the page prints its columns.
    const printed = ((pagesByDocEarly.get(group[0].policyId) ?? []).find((p) => p.page === group[0].page)?.text ?? "").toLowerCase();
    const at = (g: Candidate) => { const i = printed.indexOf(g.tierLabel!.trim().toLowerCase()); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
    const parts = [...group].sort((x, y) => at(x) - at(y)).map((g) => g.tierLabel!.trim() + (valueOf(g) ? ": " + valueOf(g) : ""));
    // One sentence: the same caveat on two lines must not read as a repeated sentence.
    const whom = group[0].ownerName || "you";
    const merged: Candidate = { ...group[0], tierLabel: null, amount: null, currency: null,
      text: group[0].title + " (which applies to " + whom + " isn’t shown): " + parts.join("; ") };
    inColumns.set(group[0], merged);
    for (const g of group.slice(1)) inColumns.set(g, null);
  }
  // One line for a fact several people share (a family travel plan), naming them all.
  const shared = new Map<string, Candidate[]>();
  for (const raw of kept) {
    const a = inColumns.has(raw) ? inColumns.get(raw) : raw;
    if (!a) continue;
    const k = a.policyId + "|" + a.page + "|" + normalPassage(a.text) + "|" + (a.tierLabel ?? ""); (shared.get(k) ?? shared.set(k, []).get(k)!).push(a);
  }
  const listNames = (names: string[]) => names.length <= 1 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names.at(-1);
  // Round 11: the same printed line reached twice (a family plan's row for adults and for children) is one line naming everyone once.
  const sameLine = new Map<string, { at: number; names: string[] }>();
  const order = args.people.map((p) => personName(p.id));
  for (const group of shared.values()) {
    const first = group[0];
    const names = [...new Set(group.map((g) => g.ownerName))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
    const body = args.people.length > 1 ? line(first).replace(/^[^·]*· /, "") : line(first);
    const seen = sameLine.get(body);
    if (seen) {
      for (const n of names) if (!seen.names.includes(n)) seen.names.push(n);
      seen.names.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
      details[seen.at] = args.people.length > 1 && seen.names.length > 1 ? listNames(seen.names) + " · " + body : details[seen.at];
      continue;
    }
    sameLine.set(body, { at: details.length, names });
    details.push(args.people.length > 1 && names.length > 1 ? listNames(names) + " · " + body : line(first));
  }
  for (const a of kept) {
    const citation = cite(a);
    // A row printed once per column for someone whose column is not known is one line with no amount (above): none of its
    // columns' figures is a card of the person's own limit, in any currency (TE #259 F1).
    if (inColumns.has(a)) continue;
    // (Round 7 port: a row of a table with a column per employee plan is not quoted
    // whole as a limit card -- the quote would show another plan's figure.)
    // Round 11: one card for a figure several people share on the same plan (a family travel plan's row), naming them all.
    const same = limits.find((l) => l.benefitTitle === a.title && l.amount === a.amount && l.currency === a.currency && l.citation.policyId === a.policyId && l.citation.pageStart === a.page);
    if (same && a.ownerName && same.ownerName && !same.ownerName.split(/, | and /).includes(a.ownerName)) {
      const names = [...same.ownerName.split(/, | and /), a.ownerName].sort((x, y) => (order.indexOf(x) + 1 || 99) - (order.indexOf(y) + 1 || 99));
      same.ownerName = listNames(names);
      continue;
    }
    if (same) continue;
    if (a.source !== "premium" && a.source !== "expiry" && a.amount != null && a.currency && !isGuide(a.policyId) && !inactive(a.policyId) && !((a.tier && /^plan\b/i.test(a.tier)) || ((a.tier || a.tierLabel) && (a.passage ?? "").split(/\t| · |\s{3,}|\s\|\s/).filter((cell) => MONEY_CELL.test(cell)).length > 1)))
      limits.push({ kind: "policy_stated_limit", label: POLICY_STATED_LIMIT_LABEL, notice: POLICY_STATED_LIMIT_NOTICE, benefitTitle: a.title,
        ownerName: a.ownerName || null, amount: a.amount, currency: a.currency, amountText: money(a.amount, a.currency), quote: a.passage, citation });
  }
  const conflictText: string[] = [];
  for (const group of conflicting) {
    const sides = [...new Map(group.map((a) => [a.amount + "|" + a.currency + "|" + a.policyId + "|" + a.page, a])).values()];
    for (const a of sides) { details.push(line(a)); cite(a); }
    const names = [...new Set(sides.map((a) => docName(a.policyId)))];
    conflictText.push((names.length === 1 ? names[0] + " states" : "Your documents state") + " different figures for " + group[0].title.toLowerCase() + ": "
      + sides.map((a) => money(a.amount!, a.currency!) + (names.length > 1 ? " in " + docName(a.policyId) : "") + " on page " + a.page).join(" and ")
      + ". DearPolicy can’t tell which one applies, so it has not picked one; the insurer can confirm"
      + (sides.some((a) => docs.get(a.policyId)?.document_role === "endorsement") ? ". One of them comes from an endorsement to the policy." : "."));
  }
  // "the annual limit", "the deductible and co-insurance": the words asked, not the whole family of terms.
  const narrowWords = narrow.map((n) => askedText.match(n.asks)?.[0]?.toLowerCase().replace(/^deductable$/, "deductible").replace(/^co-?insurence$/, "co-insurance").replace(/^.*\b(?:cap|out of pocket)\b.*$/, "yearly cap on what you pay")).filter((w): w is string => !!w && /deduct|co-?insur|co-?pay|pro-?ration|limit|\bcap\b/.test(w));
  const topicLabels = topics.length ? topics.map((t) => t.key === "cost_sharing" && narrowWords.length ? "the " + [...new Set(narrowWords)].join(" and the ") : t.label) : conditionAsked ? ["conditions"] : ["cover"];
  const shown = [...kept, ...conflicting.flat()];
  const answeredTopics = new Set(shown.map((a) => a.topic));
  const conditionsShown = shown.some((a) => a.source === "condition");
  const notFound = conditionsShown ? [] : [...topics.filter((t) => !narrowAnswered && !answeredTopics.has(t.key) && !setAside.has(t.key) && !candidates.some((c) => c.topic === t.key) && !(t.key === "rider" && topics.some((x) => x.key === "premium") && shown.some((a) => a.topic === "premium")) && !shown.some((a) => a.policyId && kindsOf(a.policyId).includes(t.key))
    // Round 7 (port): injured or ill overseas -- the travel plan's overseas medical cover shown answers it; "accident cover" is not "not found".
    && !(/\b(?:overseas|abroad|on (?:a|the|my) trip|while travell?ing)\b/i.test(askedText) && ["accident", "hospital"].includes(t.key) && shown.some((a) => a.policyId && kindsOf(a.policyId).includes("travel") && /medical|hospital|evacuation/i.test(a.title)))
    // Round 10: "Accidental death: S$50,000" is shown -- death cover is not "not found".
    && !shown.some((a) => { const w = t.label.replace(/^(?:an?|the|any) /, "").split(/\s+/)[0]; return w === "death" && new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(a.title); })).map((t) => t.label),
    ...narrowMissing.filter(Boolean).map((w) => /^(?:deductible|co-?payment|co-?pay|pro-?ration|annual limit|policy[- ]year limit|overall limit|yearly limit)$/.test(w) ? (/^[aeiou]/.test(w) ? "an " : "a ") + w : w)];
  const whose = args.people.length === 1 ? (isSelf(args.people[0].id) ? "your" : personName(args.people[0].id) + "’s") : "your family’s";
  const lines: string[] = [];
  const windowAsked = Number.isFinite(windowDays);
  const aboutLabels = shown.length && shown.every((a) => a.id.startsWith("meta:")) ? [] : conditionsShown ? topics.filter((t) => ["dental", "maternity", "outpatient"].includes(t.key)).map((t) => t.label) : topicLabels;
  // "How much?" after a question about cover: the amounts, said as amounts.
  const amountsAsked = /^\s*(?:and\s+|so\s+)?how much\b[^?]{0,20}\??\s*$/i.test(args.message ?? askedText) && shown.some((a) => a.amount != null);
  if (shown.length) lines.push(amountsAsked ? "These are the amounts " + (whose === "your" ? "your" : whose) + " documents state" + (aboutLabels.length ? " for " + aboutLabels.join(" and ") : "") + ", each with the page it comes from."
    : (whose === "your" ? "Here is what your" : "Here is what " + whose) + " documents state" + (aboutLabels.length ? " about " + aboutLabels.join(" and ") : "") + ".");
  // Several people asked about: who has nothing on it is said, not left out.
  // A household's car or home policy, or a window of dates, is not something each person is missing.
  if (args.people.length > 1 && shown.length && !conditionsShown && topics.length && !topics.some((t) => t.key === "status") && !windowAsked && !topics.some((t) => ["motor", "home"].includes(t.key)) && !namedDocs.length
    // (Round 7 port: "ILP death benefit" is about the plan that is an ILP, not something everyone else lacks.)
    && !(kindDocs.length && topics.some((t) => ["investment", "maturity"].includes(t.key)))) {
    // Round 11: someone with no readable document at all is not "missing" this cover -- saying so on every family answer is noise.
    const readable = new Set([...speaksFor.values()].flatMap((owners) => [...owners]));
    const missing = args.people.filter((p) => !withAnyLine.has(p.id) && readable.has(p.id)).map((p) => isSelf(p.id) ? "you" : personName(p.id));
    if (missing.length && missing.length < args.people.length)
      lines.push("DearPolicy didn’t find " + topicLabels.join(" or ") + " in the documents read for " + (missing.length === 1 ? missing[0] : missing.slice(0, -1).join(", ") + " or " + missing.at(-1)) + ".");
  }
  lines.push(...conflictText);
  // What each document says about whether it still covers anyone: lapsed, ended, or in its grace period.
  // (A reinstatement is said when the question is about whether the policy is in force, not under every answer from it.)
  const statusAsked = topics.some((t) => t.key === "status") || /\b(?:reinstat\w*|laps\w*|in force|active|valid)\b/i.test(askedText);
  const statusDocs = [...new Set(shown.map((a) => a.policyId))].filter((id) => ["lapsed", "grace", "grace_passed"].includes(statusOf.get(id)?.state ?? "") || (statusAsked && statusOf.get(id)?.state === "reinstated"));
  for (const docId of statusDocs) {
    const st = statusOf.get(docId)!, sentence = statusSentence(docName(docId), st);
    if (sentence && !lines.includes(sentence)) lines.push(sentence);
    // Gate R17: the unpaid premium the sentence repeats is read from the status line's own page.
    if (sentence && st.page) citeLine(null, sentence, { policyId: docId, pageStart: st.page });
    // Round 16: the lapse date a reinstatement sentence repeats is cited where it is printed (the lapse notice).
    if (sentence && st.state === "reinstated" && st.lapsedPrinted && st.lapsedDocId && st.lapsedPage && docs.has(st.lapsedDocId) && !citations.some((c) => c.policyId === st.lapsedDocId && c.pageStart === st.lapsedPage))
      citations.push({ chunkId: "lapsed:" + st.lapsedDocId + ":" + st.lapsedPage, policyId: st.lapsedDocId, policyName: docs.get(st.lapsedDocId)?.product_name ?? docName(st.lapsedDocId), insurer: docs.get(st.lapsedDocId)?.insurer ?? undefined,
        pageStart: st.lapsedPage, pageEnd: st.lapsedPage, documentRole: docs.get(st.lapsedDocId)?.document_role ?? undefined });
  }
  // "Is that per year?" about a premium printed for a whole period of cover.
  if (/\b(?:per|a|each|every) year\b|\byearly\b|\bannual(?:ly)?\b/i.test(askedText))
    for (const a of shown.filter((x) => x.source === "premium" && /for the period|single premium|one-off/i.test(x.title))) {
      const end = printedPeriodEnd(pagesByDoc.get(a.policyId) ?? []), begins = docs.get(a.policyId)?.effective_date?.slice(0, 10);
      if (end && begins) lines.push("That premium is for the whole period of insurance, " + longDate(begins) + " to " + end.printed + ", not a yearly amount.");
    }
  // "How many days left?": the days from today to the date each document prints.
  if (/\bnext \d{1,3} days\b|\bwithin \d{1,3} days\b|\bhow many days (?:left|until|till|to go|more|before|from|is that|are there)|\bdays? (?:left|until|till|to go|remaining|from (?:now|today))|\bhow long (?:more|until|till|before|left)\b/i.test(askedText)
    // Round 11: "how many days before admission are bills covered?" asks about the benefit's window, not the days left on the plan.
    && !/\b(?:admission|admitted|discharge\w*|hospitali[sz]ation|treatment|surgery|diagnos\w*|deferment|waiting|trip|travel(?:ling)?|abroad|overseas)\b/i.test(askedText)) {
    const counts: string[] = [];
    for (const docId of [...new Set(shown.map((a) => a.policyId))]) {
      const st = statusOf.get(docId);
      if (!st?.date || !st.printed) continue;
      const said = countdownLine(docName(docId), st, today);
      if (said) counts.push(said);
    }
    if (counts.length) lines.splice(lines.length ? 1 : 0, 0, ...counts);
  }
  lines.push(...ageNotes);
  // Round 7 product decision: death, accident and disability cover read from
  // an employer's group benefits booklet is POSSIBLE cover -- the booklet is
  // a summary, not the person's certificate -- so it is said to be confirmed
  // with the employer's HR, every time it is shown.
  {
    const groupLines = shown.filter((a) => isGuide(a.policyId) && (/\b(?:death|accident\w*|disab\w*|tpd|life|dismember\w*)\b/i.test(a.title) || topics.some((t) => ["death", "accident", "disability"].includes(t.key))));
    for (const docId of new Set(groupLines.map((a) => a.policyId))) {
      const employer = (docs.get(docId) as (DocRow & { employer?: string | null }) | undefined)?.employer ?? null;
      const owners = [...new Set(groupLines.filter((a) => a.policyId === docId).map((a) => a.subjectId))].map((id) => isSelf(id) ? "you are" : personName(id) + " is");
      lines.push("The " + docName(docId) + " lines are possible cover — confirm with " + (employer ? employer + "’s HR" : "HR") + ".");
      void owners;
    }
  }
  // Figures replaced by a later endorsement, said once, never shown as current.
  for (const n of replacedNotes) {
    if (amendments.some((m) => m.replaced.some((x) => x.amount === n.old.amount))) continue;
    const by = docs.get(n.byDocId);
    // The old figure is quoted from its own page, so that page is cited.
    cite(n.old);
    lines.push(docName(n.old.policyId) + ": the " + money(n.old.amount!, n.old.currency!) + " for " + n.old.title.replace(/[.:;\s]+$/, "").toLowerCase() + " printed in the document dated " + (dateOf(n.old.policyId) ?? "earlier") +
      " was replaced by the " + (by?.document_role === "endorsement" ? "endorsement" : "later document") + " dated " + (dateOf(n.byDocId) ?? n.byDate) + ", so it no longer applies."
      + (n.now && n.old.currency ? " The " + (by?.document_role === "endorsement" ? "endorsement" : "later document") + " prints " + money(n.now.after, n.old.currency) + " for “" + n.now.label + "” from then (page " + n.now.page + ")." : ""));
    if (n.now && !citations.some((c) => c.chunkId === "amended:" + n.byDocId + ":" + n.now!.page))
      citations.push({ chunkId: "amended:" + n.byDocId + ":" + n.now.page, policyId: n.byDocId, policyName: by?.product_name ?? docName(n.old.policyId), insurer: by?.insurer ?? docs.get(n.old.policyId)?.insurer ?? undefined,
        pageStart: n.now.page, pageEnd: n.now.page, personalEvidence: false, evidenceLabel: "Endorsement", excerpt: n.now.line.slice(0, 280), documentDate: dateOf(n.byDocId) ?? n.byDate, notConfirmedCurrent: false });
  }
  // Everything found comes from plans that no longer cover anyone: that comes first.
  if (shown.length && shown.every((a) => expired(a.policyId)) && !topics.some((t) => t.key === "status") && !namedDocs.length && !/\b(?:was|were|did|had|before|lapsed?|expired?|ended|old|previous|last|reinstat\w*)\b/i.test(askedText))
    lines.unshift("None of the " + topicLabels.join(" or ").replace(/^the /, "") + " in " + (whose === "your" ? "your" : whose) + " documents is still in force.");
  lines.splice(lines.length ? 1 : 0, 0, ...valueTableNotes);
  // Every policy on file is taken as in force (DC, 31 Oct): an older document's date is shown beside its figure, but the
  // answer never doubts the policy because of its age ("may not reflect the current terms", "upload the latest renewal").
  if (unresolved.length) lines.push([...new Set(unresolved.map((r) => (r.assertion as Candidate).title))].join(" and ") + ": your documents state different figures, so DearPolicy has not picked one. Upload the latest schedule to settle it.");
  const otherGaps = rejected.filter((r) => !r.reason.startsWith("conflict: ") && !shown.some((k) => k.topic === (r.assertion as Candidate).topic));
  if (otherGaps.length) lines.push("Some details were left out because they could not be matched to the exact passage in the document: " + [...new Set(otherGaps.map((r) => r.reason))].slice(0, 2).join("; ") + ".");
  if (notFound.length) lines.push("I could not find " + notFound.join(" or ") + " in the documents read" + (args.people.length === 1 ? " for " + personName(args.people[0].id) : "") + ".");
  // "Who has hospital cover?": who, and on which plan -- not every row of every plan.
  if (args.people.length > 1 && /^\s*(?:who(?: in (?:the|our|my) (?:family|household))?(?:['’]s| is| are)? (?:has|have|covered|insured|got)\b|(?:does|do|is|are|has) (?:anyone|anybody|any of us|someone|everyone)\b|which of us\b)/i.test(askedText) && shown.length && topics.length) {
    const byOwner = new Map<string, Set<string>>();
    for (const a of shown) (byOwner.get(a.ownerName) ?? byOwner.set(a.ownerName, new Set()).get(a.ownerName)!).add(docName(a.policyId) + (expired(a.policyId) ? " (lapsed)" : ""));
    const listing = [...byOwner].map(([owner, plans]) => owner + " (" + [...plans].join(", ") + ")");
    const join = (xs: string[]) => xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs.at(-1);
    details.splice(0, details.length, ...[...byOwner].map(([owner, plans]) => owner + ": " + [...plans].join(", ") + "."));
    lines.length = 0;
    lines.push((topicLabels.join(" and ").replace(/^the /, "").replace(/^./, (c) => c.toUpperCase())) + " is on file for " + join(listing) + ".");
  }
  // Facts that exist but could not be verified are not an answer; the caller
  // may still read the documents. A conflict is an answer: shown, explained,
  // never resolved by reading again and picking one.
  const handled = kept.some((a) => a.source !== "expiry") || conflicting.length > 0 || unresolved.length > 0 || replacedNotes.length > 0;
  if (!handled) return result({ notFound: topics.map((t) => t.label), rejected });
  let summary = lines.join(" ");
  let narrated = false, modelCalls = 0;
  if (args.narrate && kept.length && !conflicting.length) {
    try {
      modelCalls++;
      const text = await args.narrate({ question: askedText, text: summary + " " + details.join(" "), assertions: kept });
      if (text && !/\?/.test(text) && rephrasingIsFaithful(text, kept)) { summary = text.trim(); narrated = true; }
    } catch { /* The deterministic text stands. */ }
  }
  // Every money figure in this answer's text comes from a verified assertion's
  // own wording, which verifyAssertions found in its cited passage. The live
  // monetary boundary shows exactly these figures for a policy-fact answer and
  // withholds any other (lib/chat/monetary-boundary.ts).
  const figures = [...new Set([...replacedNotes.filter((n) => n.old.amount != null && n.old.currency).map((n) => money(n.old.amount!, n.old.currency!)),
    ...replacedNotes.filter((n) => n.now && n.old.currency).map((n) => money(n.now!.after, n.old.currency!)),
    ...shown.flatMap((a) => a.text.match(new RegExp(MONEY_PATTERN.source, "gi")) ?? []),
    ...shown.flatMap((a) => (narrowQuoted.get(a.id) ?? "").match(new RegExp(MONEY_PATTERN.source, "gi")) ?? []),
    ...statusDocs.map((id) => statusOf.get(id)?.dueAmount).filter((x): x is string => !!x),
    ...shown.filter((a) => a.amount != null && a.currency).map((a) => money(a.amount!, a.currency!))])];
  // Round 9: a short question gets a short answer; the rest is a question away, never a wall of lines.
  const broad = /\b(?:everything|every|all|overview|list|family|everyone|compare|total|altogether|what (?:am i|is \w+) (?:insured|covered)|what (?:do|does) [^?]{1,40} (?:have|cover)|tell me about|what insurance|what policies)\b/i.test(askedText);
  // Round 10: the answer misses what was asked ("recuperation", "nominee", "ICU days") while a line
  // the person's own documents print says it: that line, quoted verbatim with its page, comes first.
  // Only from the plans this answer is about: another plan's line never "repairs" it.
  const answeredDocs = new Set(shown.map((a) => a.policyId));
  // A person's name is who is asked about, never what ("Maria's helper insurance" is not the line naming Maria).
  const withoutNames = args.people.flatMap((p) => [p.display_name, p.preferred_name ?? "", ...p.display_name.split(/\s+/).filter((w) => w.length >= 3)]).filter((n) => n.trim().length >= 2)
    .reduce((t, n) => t.replace(new RegExp("\\b" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:['’]s)?\\b", "gi"), " "), askedText);
  // Round 12: a deadline to submit or notify ("submit the final bill ... within 90 days after discharge") answers a question
  // about submitting or claiming, not one about which bills before or after a stay are covered.
  const asksSubmitting = /\b(?:submit\w*|claim\w*|lodg\w*|notif\w*|deadline|time limit|file (?:a|the|my))\b/i.test(askedText);
  const notADeadline = (r: { text: string }) => asksSubmitting || !SUBMIT_DEADLINE.test(r.text);
  const repairColumns = columnsOf(answeredDocs);
  const repaired = relevanceRepair(withoutNames, [summary, ...details].join("\n"), new Map([...pagesByDoc].filter(([id]) => answeredDocs.has(id))), docName, repairColumns).filter(notADeadline);
  // Round 11: the printed sentence about the particular thing asked ("MediSave cannot be used", "Each trip may last up to 90 days",
  // "Plan: Annual multi-trip, Asia") when no line shown says it -- from the same documents.
  const personWords = args.people.flatMap((p) => (p.display_name + " " + (p.preferred_name ?? "")).split(/\s+/));
  const rules = printedRuleLines(askedText, [summary, ...details, ...repaired.map((r) => r.text)].join("\n"), new Map([...pagesByDoc].filter(([id]) => answeredDocs.has(id))), docName, { ignore: personWords, columns: repairColumns })
    .filter((r) => !repaired.some((x) => x.text === r.text)).filter(notADeadline);
  // Round 7 (port): "what documents for a trip cancellation claim?": the sentence that lists what to submit, from the plans answered.
  if (/\b(?:documents?|papers?|paperwork|what (?:do i|to) (?:need|submit|send|attach))\b/i.test(askedText) && /\bclaim\w*|\bsubmit\w*/i.test(askedText)) {
    const LISTS = /\b(?:submit\w*|attach\w*|provide|send|enclose)\b[^.]{0,200}\b(?:invoices?|receipts?|certificates?|reports?|proof|bills?|claim forms?)\b/i;
    const askedWords = [...wordsOf(withoutNames)].filter((w) => w.length >= 5 && !/^(?:documents?|claims?|submit|papers?|which|their)$/.test(w));
    const found: { text: string; citation: ChatCitation; score: number }[] = [];
    for (const [docId, pages] of pagesByDoc) if (answeredDocs.has(docId)) for (const p of pages) for (const piece of piecesOf(p.text)) {
      if (!LISTS.test(piece) || found.some((f) => f.text.includes(piece))) continue;
      const score = askedWords.filter((w) => wordsOf(piece).has(w)).length;
      found.push({ text: docName(docId) + " — “" + piece.replace(/[.;\s]+$/, "") + "” (page " + p.page + ").", score, citation: { chunkId: "page:" + docId + ":" + p.page, policyId: docId, policyName: docName(docId), pageStart: p.page, pageEnd: p.page } });
    }
    const best = Math.max(0, ...found.map((f) => f.score));
    for (const f of found.filter((x) => x.score === best).slice(0, 2).reverse()) if (!repaired.some((r) => r.text === f.text)) repaired.push(f);
  }
  for (const r of repaired) {
    details.unshift(r.text);
    if (!citations.some((c) => c.policyId === r.citation.policyId && c.pageStart === r.citation.pageStart)) citations.push(r.citation);
    for (const m of r.text.match(new RegExp(MONEY_PATTERN.source, "gi")) ?? []) if (!figures.includes(m)) figures.push(m);
  }
  // Round 10: the lines that answer what was asked came from the repair ("for how many days?" after an
  // ICU question is the ICU days, not the period of insurance): the summary names what those lines are
  // about, from the lines themselves, not the topic the question's words first matched.
  let labelsNow = aboutLabels;
  if (repaired.length && !narrated && aboutLabels.length) {
    const quotedOf = (t: string) => t.replace(/^[^“]*“/, "").replace(/”[^”]*$/, "");
    const answeredLabels = [...new Set(repaired.map((r) => TOPICS.find((t) => t.fact.source !== "(?!)" && t.fact.test(quotedOf(r.text)))?.label).filter((l): l is string => !!l))];
    const was = aboutLabels.join(" and ");
    if (!answeredLabels.some((l) => aboutLabels.includes(l))) {
      const now = answeredLabels.join(" and ");
      summary = summary.replace(" about " + was + ".", now ? " about " + now + "." : ".").replace(" for " + was + ",", now ? " for " + now + "," : ",");
      labelsNow = answeredLabels;
    }
  }
  // Round 11: "how do I make a claim?": the document's own claim steps, not every benefit row of the plan.
  if (HOW_TO_CLAIM.test(askedText) && rules.length) {
    details.splice(0, details.length); citations.splice(0, citations.length); limits.splice(0, limits.length);
    summary = "Here is how to claim, as " + (args.people.length === 1 && !isSelf(args.people[0].id) ? personName(args.people[0].id) + "’s" : "your") + " documents print it:";
  }
  for (const r of [...rules].reverse()) {
    details.unshift(r.text);
    if (!citations.some((c) => c.policyId === r.citation.policyId && c.pageStart === r.citation.pageStart)) citations.push(r.citation);
    for (const m of r.text.match(new RegExp(MONEY_PATTERN.source, "gi")) ?? []) if (!figures.includes(m)) figures.push(m);
  }
  // Round 10: "read me the benefits table": a row whose amount the scan prints unclearly is still a row of
  // the table -- shown with the amount said to be unclear on the scan, never silently dropped.
  if (/\b(?:benefits? (?:table|schedule|list)|schedule of benefits|table of benefits|(?:all|every) (?:of )?(?:the |her |his |my |their )?benefits?|list (?:all |the |every )?benefits)\b/i.test(askedText)) {
    const text = () => [summary, ...details].join("\n").toLowerCase();
    for (const docId of answeredDocs) for (const p of pagesByDoc.get(docId) ?? []) for (const piece of piecesOf(p.text)) {
      if (!unclearFigures(piece).length || !/%|\bsum (?:assured|insured)\b|\bup to\b|\bper (?:day|year|admission)\b|\bpayable\b/i.test(piece)) continue;
      const row = piece.split(/:|\s{2,}|\t/)[0].replace(/\s*\([^)]*\)\s*$/, "").trim();
      if (row.length < 3 || text().includes(row.toLowerCase())) continue;
      details.push(docName(docId) + " — “" + flagUnclearFigures(piece).replace(/[.;\s]+$/, "") + "” (page " + p.page + ").");
      if (!citations.some((c) => c.policyId === docId && c.pageStart === p.page)) citations.push({ chunkId: "page:" + docId + ":" + p.page, policyId: docId, policyName: docName(docId), pageStart: p.page, pageEnd: p.page });
    }
  }
  // Round 12: the label says what the lines shown are about ("about maturity or surrender value" for a surrender
  // table, never "about the premium" because a premium was mentioned in passing).
  if (labelsNow.length && details.length) {
    const linesShown = details.map((d) => d.replace(/\s*\(page \d+[^)]*\)\.?$/, ""));
    const count = (re: RegExp) => linesShown.filter((l) => re.test(l)).length;
    const topicOf = (label: string) => TOPICS.find((t) => t.label === label && t.fact.source !== "(?!)");
    const current = labelsNow.map((label) => ({ label, n: topicOf(label) ? count(topicOf(label)!.fact) : Infinity }));
    const best = TOPICS.filter((t) => t.fact.source !== "(?!)" && t.asks.test(askedText)).map((t) => ({ label: t.label, n: count(t.fact) })).sort((a, b) => b.n - a.n)[0];
    const top = Math.max(...current.map((c) => c.n));
    const now = best && best.n > 0 && best.n > top ? [best.label] : current.filter((c) => c.n > 0).map((c) => c.label);
    const was = labelsNow.join(" and ");
    if (now.join(" and ") !== was) summary = summary.replace(" about " + was + ".", now.length ? " about " + now.join(" and ") + "." : ".").replace(" for " + was + ",", now.length ? " for " + now.join(" and ") + "," : ",");
  }
  // Round 12: never say a thing could not be found when this same answer shows it.
  if (notFound.length) {
    const shownText = details.join("\n");
    const stillMissing = notFound.filter((label) => { const t = TOPICS.find((x) => x.label === label.replace(/^an? /, "")); const re = t && t.fact.source !== "(?!)" ? t.fact : new RegExp("\\b" + label.replace(/^(?:an?|the) /, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i"); return !re.test(shownText); });
    if (stillMissing.length < notFound.length) {
      const tail = " in the documents read" + (args.people.length === 1 ? " for " + personName(args.people[0].id) : "") + ".";
      summary = summary.replace("I could not find " + notFound.join(" or ") + tail, stillMissing.length ? "I could not find " + stillMissing.join(" or ") + tail : "").replace(/\s{2,}/g, " ").trim();
      notFound.splice(0, notFound.length, ...stillMissing);
    }
  }
  // Round 12: concise answers. The lines that answer what was asked come first; a single-topic question shows
  // at most five of them, a broad one (an overview, a comparison) eight, and the rest is one question away --
  // "ask for the full list" -- unless the full list is what was asked for. The cards of the amounts follow the lines shown.
  const fullList = !!args.fullList || FULL_LIST.test(askedText);
  // Every part of a several-part question keeps at least one line ("life cover and when does it expire and the premium").
  const severalParts = /\?.+\?|\band (?:how|what|when|which|is|are|does|do|can|will|who)\b/i.test(askedText);
  const keep = !severalParts ? [] : topics.map((t) => t.fact.source !== "(?!)" ? t.fact : t.key === "renewal" || t.key === "status" ? /\bexpir|\brenew|\bperiod of (?:insurance|cover)|\bend date|\bends\b|\bin force\b|\blapse|\bgrace\b/i : null).filter((re): re is RegExp => !!re);
  // Round 7 (port): "cash portion", "the dependants' premium": a line naming the word asked comes before one that doesn't.
  const distinctAsked = [...new Set((askedText.match(/\b(?:cash|medisave|rider|dependants?|spouse|child(?:ren)?|employee|panel|private|overseas)\b/gi) ?? []).map((w) => w.toLowerCase().replace(/s$|ren$/, "")))];
  if (distinctAsked.length && !fullList) {
    const names = (d: string) => distinctAsked.some((w) => new RegExp("\\b" + w, "i").test(d.replace(/^[^·—]*·\s/, "")));
    const ranked = [...details.filter(names), ...details.filter((d) => !names(d))];
    details.splice(0, details.length, ...ranked);
  }
  conciseDetails(details, limits, { cap: fullList ? Infinity : broad || severalParts ? 8 : 5, keep });
  // One card per amount a person has, whichever of the policy's documents printed it (a contract and its statement).
  { const seenCard = new Set<string>(); limits.splice(0, limits.length, ...limits.filter((l) => { const k = (l.ownerName ?? "") + "|" + l.benefitTitle.toLowerCase() + "|" + l.amount + "|" + l.currency; if (seenCard.has(k)) return false; seenCard.add(k); return true; })); }
  // A card is for an amount on a line shown; a "who has it" listing shows no rows, so no cards.
  if (details.length) { const visible = [summary, ...details].join("\n"); limits.splice(0, limits.length, ...limits.filter((l) => visible.includes(l.benefitTitle))); }
  if (fullList) withoutListedLimitCards(details, limits);
  // A quoted line giving the end of a grace period that has already run out says so where it is quoted.
  for (const [docId, st] of statusOf) if (st.state === "grace_passed" && st.printed)
    for (let i = 0; i < details.length; i++) if (details[i].startsWith(docName(docId) + " — “") && (details[i].includes(st.printed) || !!st.datePrinted && details[i].includes(st.datePrinted)) && /\bgrace period\b/i.test(details[i]))
      details[i] = details[i].replace(/\(page (\d+)\)\.$/, "(page $1; that grace period has ended).");
  // Gate R17: every line's figures are bound to the passage each fact was verified in (its own page, version, person
  // and row), and the lines that quote a page are cited to that page (resolved on it at save time).
  for (const t of [summary, ...details]) {
    if (!/\d/.test(t)) continue;
    for (const a of shown) bindPassageFact(null, t, a);
    for (const n of replacedNotes) { bindPassageFact(null, t, n.old); if (n.now) citeLine(null, t, { policyId: n.byDocId, pageStart: n.now.page, benefit: n.now.label }); }
    citePageLines(null, [t], citations);
  }
  const answer: PolicyAnswer = { mode: "answer", summary, details, citations, policyStatedLimits: limits,
    verifiedPolicyFactsOnly: true, verifiedPolicyFigures: figures,
    confidence: kept.length && !conflicting.length ? (rejected.length || notFound.length ? "partial_match" : "strong_match") : "partial_match",
    nextSteps: [], questions: [] };
  return { handled, answer, kept: shown, rejected, topics: topics.map((t) => t.key), notFound, modelCalls, narrated, elapsedMs: Date.now() - started };
}

/** A question asking what the documents state, as opposed to a what-if or a
 * claim ("if I die…", "how much can I claim…"). Only these take the stored-
 * fact path; hypotheticals and claims keep their own workflow. A question
 * about what a policy says it pays, or about its conditions, is factual even
 * when it contains an "if". */
/** A question about what a policy prints, even phrased with "if" ("What's the pro-ration if I go private?",
 * "If my flat is unliveable, how much for a hotel?", "How much does it pay if he loses a thumb?"). */
/** Round 11: "how do I make a claim if I'm admitted?", "what's the claim process?": the printed steps. */
/**
 * Round 12: the concise-answer rule. The lines that answer what was asked come first; a question about one
 * thing shows at most five of them, an overview, a comparison or a several-part question eight, and the rest
 * is one question away -- "ask for the full list". Every part of a several-part question keeps a line (`keep`).
 * The cards of amounts follow the lines shown.
 */
/** A table cell that prints an amount in any market's money: a sign or code before the figure ("RM100", "HK$ 1,500",
 * "Rp100.000", "£50", "CHF 1'250") or after it ("100 €", "150,00 EUR"). A row with two or more such cells prints one figure
 * per column, so no one of them is a person's own limit card. */
export const MONEY_CELL = /(?:[A-Z]{1,3}\$|R\$|Rp\.?|RM|€|£|¥|₹|₩|₱|฿|₫|Fr\.|kr\.?|\b[A-Z]{3})\s?\d|\d[\d.,'’ ]*\s?(?:€|£|\b(?:EUR|GBP|USD|SGD|MYR|IDR|HKD|CHF|AUD|INR)\b)/u;
export function conciseDetails(details: string[], limits: { benefitTitle: string; ownerName?: string | null; amountText?: string }[], opts: { cap: number; keep?: RegExp[] }) {
  if (opts.cap === Infinity) return;
  // Round 16: lines now carry the period and conditions their passage prints ("per year", "up to 30 days"), so the
  // short answer is also held to a word budget: the last lines move to "more lines" rather than over-run it. The budget
  // counts what the household reads: the lines and the limit cards shown beside them (one per amount a line shows).
  const cardWords = (xs: string[]) => { const visible = xs.join("\n"); const seen = new Set<string>(); let n = 0;
    for (const l of limits) { const k = (l.ownerName ?? "") + "|" + l.benefitTitle.toLowerCase() + "|" + (l.amountText ?? "");
      if (seen.has(k) || !visible.includes(l.benefitTitle)) continue; seen.add(k);
      n += [l.ownerName ?? "", l.benefitTitle, l.amountText ?? ""].join(" ").split(/\s+/).filter(Boolean).length; }
    return n; };
  const words = (xs: string[]) => xs.join(" ").split(/\s+/).length + cardWords(xs);
  // The whole answer is read in at most 180 words for a question about one thing and 250 for an overview or several
  // parts; the summary and the "more lines" note take part of that, so the lines and cards get the rest.
  const budget = opts.cap <= 5 ? 155 : 220, MORE_NOTE = 22;
  if (details.length <= opts.cap + 1 && words(details) <= budget) return;
  const chosen = details.slice(0, opts.cap);
  for (const re of opts.keep ?? []) if (!chosen.some((d) => re.test(d))) { const extra = details.slice(opts.cap).find((d) => re.test(d) && !chosen.includes(d)); if (extra) chosen.push(extra); }
  while (chosen.length > 3 && words(chosen) + MORE_NOTE > budget) {
    // A line is held only while it is the last one left for a part of the question: a second death-cover line can move
    // to "more lines", the only premium line cannot.
    const fromEnd = [...chosen].reverse().findIndex((d) => (opts.keep ?? []).every((re) => !re.test(d) || chosen.some((o) => o !== d && re.test(o))));
    if (fromEnd < 0) break;
    chosen.splice(chosen.length - 1 - fromEnd, 1);
  }
  const more = details.length - chosen.length;
  if (more <= 0) return;
  details.splice(0, details.length, ...chosen, "There " + (more === 1 ? "is 1 more line" : "are " + more + " more lines") + " on this in the documents — ask for the full list to see " + (more === 1 ? "it" : "them") + ".");
  const visible = details.join("\n");
  limits.splice(0, limits.length, ...limits.filter((l) => visible.includes(l.benefitTitle)));
}
/** Round 13: in a full list every line is already printed with its amount, so a policy-stated-limit card that
 * says only what a listed line says (same person, benefit and amount) is the list again and is left out. */
export function withoutListedLimitCards(details: string[], limits: { ownerName?: string | null; benefitTitle: string; amountText: string }[]) {
  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const listed = (l: (typeof limits)[number]) => details.some((d) => d.includes(l.benefitTitle) && (!l.ownerName || d.startsWith(l.ownerName + " · ")) &&
    !!l.amountText && new RegExp(escape(l.amountText) + "(?![\\d,.]\\d)").test(d));
  limits.splice(0, limits.length, ...limits.filter((l) => !listed(l)));
}
/** Round 12: a printed deadline to submit or notify. */
const SUBMIT_DEADLINE = /\b(?:submit\w*|notif\w*|lodg\w*|send|written notice|claims? must be)\b[^.]{0,160}\bwithin \d+ (?:days?|months?|weeks?)\b|\bwithin \d+ (?:days?|months?|weeks?)\b[^.]{0,80}\b(?:submit\w*|notif\w*|lodg\w*)\b/i;
/** Round 12: the household asked for every line, not the short answer. */
export const FULL_LIST = /\b(?:full list|full details|(?:all|every one) of (?:it|them|the lines)|all (?:the )?(?:lines|benefits|details|rows)|every (?:benefit|line|row)|everything|whole (?:list|table|schedule)|benefits? (?:table|schedule|list)|schedule of benefits|table of benefits|list (?:all|every|the benefits))\b/i;
export const HOW_TO_CLAIM = /\bhow (?:do|can|should|to|would) (?:i |we |you )?(?:go about )?(?:make|file|submit|start|do|lodge) (?:a |the |my )?claim\b|\bhow (?:do|can|should|to) (?:i |we )?claim\b|\bclaims? (?:process|procedure|steps)\b|\bhow (?:long|many days) (?:do|does|have) (?:i|we) (?:have )?to (?:claim|submit)\b|\bhow (?:long|many (?:days|weeks|months))\b[^?]{0,12}\bto (?:submit|claim|file|lodge|notify)\b|\bclaims? (?:deadline|time limit|period|window)\b|\bdeadline (?:for|to) (?:submit|claim|file)\w*|\b(?:what|which) (?:documents?|papers?|supporting documents?)\b[^?]{0,30}\bclaims?\b|\bdocuments? (?:needed|required|to submit) (?:for|to)\b[^?]{0,30}\bclaims?\b/i;
export function factualEvenAsWhatIf(question: string) {
  if (HOW_TO_CLAIM.test(question)) return true;
  // Round 9: "how much life insurance does he have if anything happens to him", "how much a month if she cannot walk",
  // "if she fractures her skull how much": what the policy prints, asked with an "if".
  if (/\bhow much\b/i.test(question) && (/\b(?:life (?:insurance|cover)|sum (?:assured|insured)|death benefit)\b/i.test(question) || /\b(?:every|a|per|each) month\b/i.test(question) || /\b(?:skull|spine)\b/i.test(question))) return true;
  return /\b(?:surrender\w*|matur\w*|reinstat\w*|lapsed?)\b/i.test(question)
    || /\blos(?:e|es|ing|t)\b[^?]{0,30}\b(?:thumb|finger|eye|sight|limb|arm|leg|hand|foot|hearing)\b/i.test(question)
    || /^\s*(?:what(?:['’]s| is| are)|how much is|is there)\s+(?:the\s+|my\s+|a\s+|an\s+)?[\w -]{0,30}\b(?:pro-?ration|deductible|excess|co-?insurance|co-?pay\w*|limit|premium|waiting period|sum insured|payout)\b/i.test(question)
    || /\bwhat(?:['’]s| is) the (?:extra |additional )?(?:excess|deductible|limit)\b/i.test(question)
    || /\bhow much for (?:a |the )?(?:hotel|accommodation)\b/i.test(question)
    || /\b(?:what )?if (?:i|he|she|we|they) (?:stay|go|choose|pick|use)\b[^?]*\b(?:private|ward|panel)\b/i.test(question)
    // Round 11: "if I pass away what does Lion Gateway pay?", "how much would my family get from AssureTerm 65?": what a named plan prints on death.
    || /\b(?:die|dies|pass(?:es)? away|death)\b/i.test(question) && /\bwhat (?:does|would|will) [^?]{0,40}\bpay\b|\bhow much (?:would|will|does|do) [^?]{0,40}\b(?:get|receive)\b[^?]{0,20}\bfrom\b/i.test(question)
    // "If I injure another driver, is third-party injury covered?": what the car policy prints.
    || /\bthird[- ]party\b/i.test(question) && !/\bhow much (?:can|could|will|would) (?:i|we) claim\b/i.test(question)
    || /,\s*(?:is|are|does|do|will)\b[^?]*\bcover(?:ed|s)?\b[^?]*\?\s*$/i.test(question)
    || /\bif\b[^?]*\b(?:doesn['’]?t|don['’]?t|not) pay\b/i.test(question)
    // "Is my car covered if I drive into Malaysia?": what the policy says, asked as a yes or no.
    || /^\s*(?:is|are|am|will)\b[^?]{0,40}\bcovered\b[^?]*\bif\b/i.test(question);
}
export function isFactualPolicyQuestion(question: string) {
  if (factualEvenAsWhatIf(question)) return true;
  if (/\bhow much (?:can|could|would|will|do|does|should) (?:i|we|he|she|they|\w+) (?:claim|get|receive|be paid)\b/i.test(question)) return false;
  if (CONDITION_QUESTION.test(question)) return true;
  if (/^\s*what (?:does|do|would|will) [^?]*\b(?:policy|plan|insurance|cover)\b[^?]*\b(?:pay|provide)\b/i.test(question)) return true;
  return !/\b(?:what if|if (?:i|he|she|we|they|my|our|his|her|their|\w+ (?:is|was|were|gets?|dies?|died))|suppose|supposing|assuming|in case|were to)\b/i.test(question);
}

/** Round 10: what a question asks that its answer does not say, when a line of
 * the person's own documents does: at most two such lines, quoted verbatim. */
const REPAIR_GENERIC = new Set("bill bills cover covered policy policies plan plans pay pays paid much insurance benefit benefits amount whole life many does still have has get what which mama papa your their his her hospital medical schedule document part kind type thing really also now one left".split(" ").map((w) => w.replace(/(?:ing|ed|es|s)$/, "")));
export function relevanceRepair(question: string, answerText: string, pagesByDoc: Map<string, { page: number; text: string }[]>, docName: (id: string) => string, columns: string[] = []) {
  const said = wordsOf(answerText);
  const productWords = new Set([...pagesByDoc.keys()].flatMap((id) => [...wordsOf(docName(id))]));
  // "a day", "ICU", "GST": short words that still say what is asked.
  // Round 11: a word that only says which plan or topic is meant ("shield" in "my shield plan") is not a thing the answer missed.
  const topicWord = (w: string) => TOPICS.some((t) => new RegExp("^(?:" + t.asks.source + ")$", "i").test(w)) || PLAN_KINDS.some((k) => k.re.test(w + " plan"));
  const missing = [...wordsOf(question)].filter((w) => (w.length >= 4 || /^(?:day|icu|gst|tcm|age)$/.test(w)) && !REPAIR_GENERIC.has(w) && !productWords.has(w) && !said.has(w) && !topicWord(w));
  if (!missing.length) return [];
  const found: { text: string; citation: ChatCitation; score: number }[] = [];
  for (const [docId, pages] of pagesByDoc) {
    for (const best of bestLines(pages, question, { limit: 2, min: 1.5 })) {
      // Round 7 (port): a per-column table row says only the column asked, or is not quoted.
      const narrowed = narrowToColumn(best.line, question, columns);
      if (!narrowed) continue;
      const l = { ...best, line: narrowed };
      const missed = l.hits.filter((h) => missing.includes(h));
      if (!missed.length || l.hits.length < 2) continue;
      // A heading in capitals ("SHIELDCARE PREMIER - INTEGRATED SHIELD PLAN") names a section; it answers nothing.
      if (l.line === l.line.toUpperCase() && !/\d/.test(l.line)) continue;
      found.push({ text: docName(docId) + " — “" + l.line.replace(/[.;\s]+$/, "") + "” (page " + l.page + ").", score: l.score,
        citation: { chunkId: "page:" + docId + ":" + l.page, policyId: docId, policyName: docName(docId), pageStart: l.page, pageEnd: l.page } });
    }
  }
  const picked = found.sort((a, b) => b.score - a.score).slice(0, 2).reverse();
  // Gate R17: a quoted line's figures are read from its own page (resolved on that page at save time).
  for (const r of picked) citeLine(null, r.text, { policyId: r.citation.policyId, pageStart: r.citation.pageStart! });
  return picked;
}
