import { FIGURE_END, NO_SCALE_AFTER, PRINTED_FIGURE, groupsInLakhs, printedNumber } from "@/lib/format/printed-number";
import { WORD_FRACTIONS } from "./word-fractions";
import { replacedFigures } from "./amendments";
import { pointsElsewhere, printsAmount } from "./model-row-shape";
import { paidMonthly } from "./paid-monthly";
import { BENEFIT_READ_FAILURE_KEY,clearReadFailure } from "@/lib/policies/read-failures";
import { knownValue,normalText } from "@/lib/chat/facts";
import { benefitTriggerEvents,coverKey,payingEvent,reportedClaimEvents,ruledOutByEvent,type ClaimEventType } from "@/lib/insurance/claim-events";
import { explicitCurrency,numericTokens } from "@/lib/chat/policy-analysis";
import { formatMoney,normalizeCurrencyCode } from "@/lib/format/currency";
import type { FactValue,ScenarioTrait,SubjectFacts } from "@/lib/chat/types";
import { canonicalProduct } from "@/lib/coverage/facts";
import { PLAN_COLUMNS_NOTE,figuresDifferByPlan,namesOnlyAPlanCell,resolveStoredRules } from "@/lib/insurance/scale-limit";
import { shareCapInPassage } from "@/lib/insurance/cover-conditions";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import type { ClaimItem } from "@/types";

/** A policy is a contract with fixed rules, so reading it is a one-time job.
 *
 * The original design re-read raw policy text with the local model on EVERY
 * question. That made each answer slow, non-repeatable and dependent on which
 * passages retrieval happened to return. A benefit is a stable fact about a
 * document: "Simple Fracture pays 25% of the S$5,000 limit, page 14, this
 * quote". Extract it once when the document is uploaded, store it, and every
 * later question is a table lookup and arithmetic — instant, identical every
 * time, and inspectable and correctable by the user. */
export type CatalogFormulaKind="none"|"sum_insured"|"fixed"|"expense_cap"|"daily";
export type CatalogBenefit={
  id:string;policyId:string;productName:string|null;benefitName:string;
  traits:ScenarioTrait[];
  /** Traits the event MUST have. "Accidental Hospital Recuperation" responds to
   * hospitalisation, but only when an accident caused it; without this, an
   * illness would be offered every accident-only benefit in the plan. */
  requires?:ScenarioTrait[];
  formulaKind:CatalogFormulaKind;formulaValue:number|null;currency:string|null;
  factKey:string|null;offsetDays:number|null;maximumDays:number|null;
  sourcePage:number|null;quote:string;
  conditions:string[];requirements:{factKey:string;question:string;why:string}[];
  needsReview:boolean;
  /** The rule was read from a heading above the row ("Compensation (% of Sum
   * Insured)") rather than stated in the row. This household holds two
   * documents that give the same fracture scale different bases, so such a rule
   * is shown for confirmation and never calculated from until a person says it
   * is right. */
  basisInferred?:boolean;
  /** Inferred, and nobody has confirmed it yet. Derived, never stored. */
  needsConfirmation?:boolean;
  /** When a person confirmed or corrected this row. */
  reviewedAt?:string|null;
  /** The column of a multi-column table this row was read from: the tier
   * ("Plan B", "Private hospital") or person class ("Child",
   * "Dependants") it applies to. Null for a single-value table. */
  tier?:string|null;
  /** What the table row is: "benefit", or a typed schedule term that is never
   * calculated into a claim amount ("as_charged", "deductible",
   * "co_insurance", "pro_ration", "policy_year_limit", "co_payment_cap"...). */
  rowKind?:string|null;
  /** The title another document of the same plan gives this same benefit,
   * carried only when it states the kind of injury this row's own title lost
   * (set by preferStatedRules). Classification evidence only; never shown. */
  kindEvidence?:string;
};

/** Which reported events can turn a benefit on.
 *
 * Deterministic and inspectable: no model decides this, so a death benefit can
 * never be offered for a broken wrist, and the reasoning can be shown to the
 * user verbatim. */
const TRAIT_RULES:{trait:ScenarioTrait;pattern:RegExp}[]=[
  {trait:"death",pattern:/\b(?:death|dies|died|decease[d]?|loss of life|funeral)\b|\bif anything (?:happens?|happened) to (?:him|her|me|them|you)\b/},
  {trait:"accident",pattern:/\baccident(?:al|ally)?\b|\bsudden and unforeseen\b|\b(?:fell|falls?|falling|fall down|slipped?|slipping|tripped?|collision|knocked)\b/},
  {trait:"bodily_injury",pattern:/\b(?:injur\w+|fracture[sd]?|break(?:s|ing)?|broke(?:n)?|dislocation|sprain\w*|burns?|amputat\w+|laceration|wound\w*|cut myself|gets? hurt|got hurt|stitch(?:es|ed))\b|\bloss of (?:an? |one |two |both |the )?(?:thumbs?|(?:index |other |any other )?fingers?|toes?|eyes?|arms?|legs?|hands?|feet|foot|limbs?)\b/},
  {trait:"disability",pattern:/\b(?:disablement|disabilit\w+|permanently disabled|loss of (?:use|sight|limb|hearing|speech)|impairment)\b|\bloss of (?:an? |one |two |both |the )?(?:thumbs?|(?:index |other |any other )?fingers?|toes?|eyes?|arms?|legs?|hands?|feet|foot|limbs?)\b|\b(?:cannot|can[’']?t|unable to) (?:walk|bathe|wash|dress|feed)\b|\bbedridden\b|\bseverely disabled\b/},
  {trait:"illness",pattern:/\b(?:illness|disease|sickness|critical illness|cancer|carcinoma|tumour|tumor|stroke|heart attack|myocardial)\b/},
  {trait:"diagnosis",pattern:/\b(?:diagnos\w+|biops\w+|histolog\w+)\b|\b(?:gets?|got|has|have|had|having|getting)\s+(?:a\s+)?(?:cancer|stroke|heart attack|tumou?r|leuka?emia)\b/},
  {trait:"hospitalisation",pattern:/\b(?:hospital\w*|inpatient|in-patient|confine\w+|ward|admission|admitted|daily cash|surger\w+|operation)\b/},
  {trait:"medical_expense",pattern:/\b(?:medical expense\w*|treatment cost\w*|ambulance|outpatient|out-patient|consultation|reimburs\w+|bill|invoice|receipt)\b/},
  {trait:"vehicle_collision",pattern:/\b(?:motor|vehicle|car|collision|windscreen)\b/},
  {trait:"property_damage",pattern:/\b(?:property|contents|damage to|repair cost)\b/},
  {trait:"theft",pattern:/\b(?:theft|stolen|burglar\w+|robber\w+)\b/},
  {trait:"loss",pattern:/\b(?:lost|loss of baggage|misplaced)\b/},
  {trait:"liability",pattern:/\b(?:liabilit\w+|third[- ]party|legal cost)\b/},
  {trait:"delay",pattern:/\b(?:delay\w*|late departure)\b/},
  {trait:"trip_cancellation",pattern:/\b(?:cancellation|curtailment|trip cancel\w*)\b/},
  {trait:"travel_disruption",pattern:/\b(?:travel|trip|journey|overseas)\b/},
  {trait:"maturity",pattern:/\b(?:maturit\w+|endowment)\b/},
  {trait:"surrender",pattern:/\b(?:surrender\w*|cash value)\b/},
  {trait:"income_loss",pattern:/\b(?:income|salary|earnings|loss of earning)\b/},
  {trait:"care_need",pattern:/\b(?:nursing|care benefit|activities of daily living)\b|\b(?:cannot|can[’']?t|unable to) (?:walk|bathe|wash|dress|feed|move about|get out of bed)\b|\bbedridden\b|\bseverely disabled\b/},
];
/** What a question describes, read from the question itself.
 *
 * "How much can I claim if I fell down and have a bill of $500" is the question
 * this product exists to answer, and it reports no event, so nothing in the
 * claim machinery used to touch it. The same keyword rules that decide what a
 * benefit responds to work just as well on the sentence a person typed, with no
 * model involved, so a hypothetical reaches the same stored benefits an actual
 * accident would. */
export function questionTraits(text:string):ScenarioTrait[]{
  const lower=(text??"").toLowerCase();
  const traits=TRAIT_RULES.filter(rule=>rule.pattern.test(lower)).map(rule=>rule.trait);
  return [...new Set(traits)];
}
/** A question that describes a situation and asks what it pays. */
/** "What is her hospital coverage?" and "What does Marcus's travel policy
 * cover overseas?" ask what a policy says, not what an event would pay: the
 * word cover alone names a kind of policy. It describes a situation only with
 * something that happens -- a conditional, or an event word ("Could this
 * cover a broken arm?"). */
const COVERAGE_ONLY_CUE=/\b(?:claim\w*|payout|pay out|pays?|entitled|get back|reimburse\w*|what if|what happens if|if i|if my|suppose)\b/;
const SCENARIO_CONDITION=/\b(?:if|when|after|suppose|supposing|in case|were to|should (?:she|he|i|they|we))\b/;
const EVENT_WORD=/\b(?:broke|broken|breaks?|fractur\w*|injur\w*|hurt|dies?|died|death|dead|passed away|hospitali[sz]\w*|admitted|warded|diagnos\w*|crash\w*|collision|stolen|theft|delayed|cancell?ed|sick|falls?|fell)\b|\bin an accident\b|\baccidentally\b/;
export function describesAScenario(text:string){
  const lower=(text??"").toLowerCase();
  // Round 9: "if she fracture her skull how much the PA give": a condition and a question about what it pays.
  // ("check if he got critical illness cover" uses "if" for "whether": it imagines nothing.)
  const whether=/\b(?:check|see|know|wondering|ask(?:ing|ed)?|confirm|find out|tell me) (?:if|whether)\b/.test(lower);
  const cue=COVERAGE_ONLY_CUE.test(lower)&&!(whether&&!/\b(?:what if|claim\w*|payout|pay out|pays?)\b/.test(lower))||!whether&&/\b(?:if|in case|suppose)\b[^?]{0,80}\b(?:how much|give|gives|get|gets|pays?|claim)\b|\b(?:how much|give|gives|get|gets|pays?)\b[^?]{0,80}\b(?:if|in case)\b/.test(lower);
  const conditional=SCENARIO_CONDITION.test(lower.replace(/\b(?:check|see|know|wondering|ask(?:ing|ed)?|confirm|find out|tell me) (?:if|whether)\b/g,""));
  if(!cue&&!(/\bcover\w*\b/.test(lower)&&(conditional||EVENT_WORD.test(lower)&&!whether)))return false;
  return questionTraits(lower).length>0;
}
/** What a benefit's own name says it is conditional on. Deterministic and
 * narrow: only wording that plainly restricts the cause. */
export function requiredTraits(benefitName:string,quote:string):ScenarioTrait[]{
  const text=(benefitName+" "+quote).toLowerCase();
  const requires:ScenarioTrait[]=[];
  if(/\baccidental\b|\bdue to (?:an )?accident\b|\baccident(?:al)? (?:death|injury|dismemberment|disablement|hospital)/.test(text)
     &&!/\b(?:illness|sickness|disease)\b/.test(text))requires.push("accident");
  if(/\bdeath\b/.test(benefitName.toLowerCase())&&!/\b(?:non-death|other than death)\b/.test(text))requires.push("death");
  return requires;
}
export function benefitTraits(benefitName:string,quote:string):ScenarioTrait[]{
  const text=(benefitName+" "+quote).toLowerCase();
  const traits=TRAIT_RULES.filter(rule=>rule.pattern.test(text)).map(rule=>rule.trait);
  return traits.length?[...new Set(traits)]:["other"];
}
/** Traits reported for this event, from stored facts plus model scenario
 * candidates. Facts alone are enough: the catalog works without any model. */
export function eventTraits(facts:SubjectFacts,scenarioTraits:ScenarioTrait[]=[]):ScenarioTrait[]{
  const traits=new Set<ScenarioTrait>(scenarioTraits);
  const known=(key:string)=>knownValue(facts,key);
  if(known("death")===true)traits.add("death");
  if(known("eventType")==="accident")traits.add("accident");
  if(known("eventType")==="diagnosis"||known("eventType")==="illness")traits.add("illness");
  if(known("accidentalDeath")===true||known("accidentType")!=null)traits.add("accident");
  if(known("injured")===true||known("injuries")!=null||known("fractureBodyPart")!=null)traits.add("bodily_injury");
  if(known("hospitalised")===true||known("hospitalNights")!=null||known("hospitalNightsSoFar")!=null||known("surgery")===true)traits.add("hospitalisation");
  if(known("diagnosis")!=null)  {traits.add("illness");traits.add("diagnosis");}
  if(known("permanentImpairment")!=null)traits.add("disability");
  if(known("ambulanceUsed")===true||known("ambulanceBill")!=null||known("hospitalBill")!=null||known("outOfPocket")!=null)traits.add("medical_expense");
  if(known("flightDelayHours")!=null)traits.add("delay");
  if(known("vehicleDamaged")===true||known("vehicleRepairBill")!=null)traits.add("vehicle_collision");
  if(known("stolenItem")!=null)traits.add("theft");
  // What happened on a trip, as the household chose it on the question card.
  const tripEvent=String(known("travelEventType")??"").toLowerCase();
  if(tripEvent){
    traits.add("travel_disruption");
    if(/baggage|luggage|belonging/.test(tripEvent)){traits.add("loss");traits.add("property_damage");}
    if(/delay/.test(tripEvent))traits.add("delay");
    if(/cancel/.test(tripEvent))traits.add("trip_cancellation");
    if(/medical/.test(tripEvent))traits.add("medical_expense");
    if(/accident|death/.test(tripEvent))traits.add("accident");
  }
  return [...traits];
}
/** A benefit responds when the event shares at least one of its traits. Ranking
 * by overlap puts the most specific benefit first. */
/** Traits that contradict each other as a cause. An event known to be an
 * illness is not an accident; a benefit requiring one is ruled out, not asked
 * about. */
const CONTRADICTS:Partial<Record<ScenarioTrait,ScenarioTrait[]>>={accident:["illness","diagnosis"],death:[]};
export type BenefitMatch={benefit:CatalogBenefit;overlap:number;
  /** Required traits the event neither has nor contradicts — the questions to
   * ask before this benefit can be offered or ruled out. */
  unknown:ScenarioTrait[];
  /** Matched only because a hospital stay or a bill is involved, not because
   * of what actually happened. */
  weak:boolean};
/** Hospitalisation and medical expense are consequences, not causes. Someone
 * with dengue may or may not be admitted; the hospital benefits are candidates
 * the moment there is a cause, and the admission is a question, not a filter.
 * Without this the question could never be asked, because the benefit never
 * became a candidate. */
const CAUSES:ScenarioTrait[]=["illness","diagnosis","accident","bodily_injury","death","disability","vehicle_collision","theft","loss","travel_disruption","delay","trip_cancellation","property_damage","care_need"];
const CONSEQUENCES:ScenarioTrait[]=["hospitalisation","medical_expense"];
export type RuledOut={benefit:CatalogBenefit;because:string};
const TRAIT_WORDS:Partial<Record<ScenarioTrait,string>>={accident:"an accident",death:"a death",illness:"an illness"};
/** Why a candidate benefit was ruled out — said out loud, because silence about
 * a benefit the person can see in their policy reads as a miss. */
export function ruledOutBenefits(catalog:CatalogBenefit[],traits:ScenarioTrait[],events:ClaimEventType[]=[]):RuledOut[]{
  const reported=new Set(traits);
  const out:RuledOut[]=[];
  for(const benefit of catalog){
    const overlap=benefit.traits.some(trait=>reported.has(trait))||benefit.traits.some(trait=>CONSEQUENCES.includes(trait));
    if(!overlap)continue;
    const wrongEvent=ruledOutByEvent(benefitTriggerEvents(benefit.benefitName,benefit.quote),events);
    if(wrongEvent){out.push({benefit,because:wrongEvent});continue;}
    for(const required of benefit.requires??[]){
      if(reported.has(required))continue;
      const conflict=(CONTRADICTS[required]??[]).find(trait=>reported.has(trait));
      if(conflict){out.push({benefit,because:"only for "+(TRAIT_WORDS[required]??required)+", and this was "+(TRAIT_WORDS[conflict]??conflict)});break;}
    }
  }
  return out;
}
/** `facts`, when given, are the contract owner's facts: a row that cannot
 * answer the injury they reported (a loss-of-arm line for a broken arm) never
 * becomes a candidate. Omitted, matching is unchanged. */
export function matchBenefits(catalog:CatalogBenefit[],traits:ScenarioTrait[],events:ClaimEventType[]=[],facts?:SubjectFacts):BenefitMatch[]{
  if(facts)catalog=screenInjuryCompatibility(catalog,facts).compatible;
  const reported=new Set(traits);
  const hasCause=CAUSES.some(trait=>reported.has(trait));
  const matches:BenefitMatch[]=[];
  for(const benefit of catalog){
    // Before anything else: is this benefit even written for the kind of event
    // that happened? A critical-illness benefit and a death are different
    // triggers, and no overlap of words between them makes one the other.
    if(ruledOutByEvent(benefitTriggerEvents(benefit.benefitName,benefit.quote),events))continue;
    let overlap=benefit.traits.filter(trait=>reported.has(trait)).length;
    const unknown:ScenarioTrait[]=[];
    if(overlap===0){
      const consequence=benefit.traits.filter(trait=>CONSEQUENCES.includes(trait));
      // A death is answered with the death benefits. Asking whether someone
      // who has died was admitted to hospital, so that a recuperation benefit
      // can be offered, is the wrong first question; those can be asked
      // about separately.
      if(!hasCause||!consequence.length||reported.has("death"))continue;
      // A candidate on the strength of the cause alone; admission is asked.
      if(consequence.includes("hospitalisation")&&!reported.has("hospitalisation"))unknown.push("hospitalisation");
      overlap=0.5;
    }
    let ruledOut=false;
    for(const required of benefit.requires??[]){
      if(reported.has(required))continue;
      if((CONTRADICTS[required]??[]).some(trait=>reported.has(trait))){ruledOut=true;break;}
      unknown.push(required);
    }
    if(ruledOut)continue;
    const direct=benefit.traits.some(trait=>reported.has(trait)&&!CONSEQUENCES.includes(trait));
    matches.push({benefit,overlap,unknown,weak:!direct});
  }
  return matches.sort((a,b)=>b.overlap-a.overlap||a.benefit.benefitName.localeCompare(b.benefit.benefitName));
}
/** An injury scale pays for the injury it names, not for any injury.
 *
 * A personal accident plan lists dozens of fixed amounts -- simple fracture of
 * the wrist, loss of sight in one eye, loss of a thumb. They all respond to
 * "an accident", so a single accident used to compute every one of them and add
 * them up. The scale is not a menu: the benefit that pays is the one whose
 * injury actually happened.
 *
 * So when a benefit names a specific injury and the person has described their
 * injuries, the two have to agree. When nothing has been described yet -- a
 * hypothetical, or a claim that has only just started -- the figure is still
 * shown, because the person is entitled to see what their policy pays. */
/** The words that name a PART OF THE BODY. Kept separate from the words that
 * name a kind of injury, because mixing them is how "Jaw, Pelvis, Leg, Ankle
 * or Knee (Other Fracture)" came to be paid for a broken wrist: both the row
 * and the report contained the word "fracture", and that was treated as the
 * two describing the same injury. A schedule pays for the part that was hurt,
 * so the part has to agree. */
const BODY_PARTS=["sight","eye","hearing","ear","speech","limb","arm","leg","hand","foot","finger","thumb","toe","wrist",
  "ankle","knee","hip","shoulder","elbow","spine","skull","jaw","rib","pelvis","femur","tibia","clavicle","patella",
  "phalan","neck","cheekbone","insanity"];
const INJURY_KINDS=["fracture","dislocation","burn","amputation","amputat","coma","paralysis","quadripleg","parapleg","dismember"];
const NAMED_INJURIES=[...INJURY_KINDS,...BODY_PARTS];
export function reportedInjuryText(facts:SubjectFacts){
  const parts:string[]=[];
  const push=(value:FactValue|undefined)=>{
    if(typeof value==="string")parts.push(value);
    else if(Array.isArray(value))parts.push(value.join(" "));
  };
  push(knownValue(facts,"injuries"));
  push(knownValue(facts,"permanentImpairment"));
  const fracture=knownValue(facts,"fractureBodyPart");
  if(typeof fracture==="string"&&fracture.trim())parts.push("fracture "+fracture);
  return parts.join(" ").toLowerCase();
}
/** A band in a burns or impairment table: "Body -- equals to or greater than
 * 10% but less than 15%". These rows name no injury at all, so nothing above
 * recognises them -- and they carry the largest percentages in the plan. Left
 * alone, any reported injury matched every band at once, and one accident
 * could produce several separate payouts of 50%, 75% and 100% of a S$600,000
 * cover. The percentage in the row's name is a percentage of the BODY, not of
 * the sum insured, which is why the row reads as nonsense without its table. */
function isScaleBand(name:string){
  return /\bequals? to or greater than\b|\bbut less than\b/i.test(name)||/^\s*(?:body|head)\s*[-–]/i.test(name);
}
const BURN_WORDS=["burn","scald","impair","disfigur","scar"];
/** What KIND of injury a schedule line is written for, and what kind was
 * reported.
 *
 * Matching on the body part alone is how a fractured wrist came to be offered
 * S$600,000: the row "Loss of arm (at shoulder, between shoulder and elbow, at
 * elbow, between elbow and wrist)" contains the word "wrist", and the reported
 * injury contained the word "wrist", so they agreed. They are not the same
 * injury. One is an amputation of the whole arm at 100% of the sum insured;
 * the other is a broken bone worth about a thousand dollars.
 *
 * A schedule pays for the injury that happened, so the kind has to agree
 * before the body part is even looked at. */
type InjuryKind="permanent_loss"|"fracture"|"burn";
function scheduleLineKind(name:string):InjuryKind|null{
  const text=(name??"").toLowerCase();
  if(/\bburn\b|\bburns\b|\bscald/.test(text))return "burn";
  if(/\bfractur|\bfull break\b|non-union|\bdislocat/.test(text))return "fracture";
  if(/\bloss of\b|\bpermanent total loss\b|\bamputat|\bdismember|\bshortening of\b|paralys|parapleg|quadripleg/.test(text))
    return "permanent_loss";
  if(isScaleBand(text))return "burn";
  return null;
}
function reportedInjuryKinds(facts:SubjectFacts):Set<InjuryKind>{
  const kinds=new Set<InjuryKind>();
  const reported=reportedInjuryText(facts);
  if(!reported)return kinds;
  if(/\bburn|\bscald|disfigur|\bscar\b/.test(reported))kinds.add("burn");
  if(/\bfractur|\bbroke|\bbroken\b|\bfull break\b|non-union|\bdislocat|\bcrack/.test(reported))kinds.add("fracture");
  if(/\blost\b|\bloss of\b|\bamputat|\bsevered\b|\bpermanent|paralys|parapleg|quadripleg|\bblind|\bdeaf/.test(reported))
    kinds.add("permanent_loss");
  return kinds;
}
/** Whether this row is one line of a schedule rather than a benefit in its own
 * right. */
export function namesASpecificInjury(benefitName:string){
  const name=(benefitName??"").toLowerCase();
  return NAMED_INJURIES.some(word=>name.includes(word))||isScaleBand(name);
}
/** One deterministic decision: can this row answer the injury that THIS
 * person reported?
 *
 * "Mei Ling broke her arm" used to surface "Loss of arm (at shoulder ...)":
 * both responded to an accident, both named an arm, and the kind of injury was
 * only compared after the row was already a candidate -- and not at all when
 * the facts said only "injured arm". A schedule pays for the injury that
 * happened, so the row's KIND is read from all its evidence (name, quoted
 * wording, conditions) and must agree with a reported kind before a body part
 * is even looked at. Body-part overlap alone never makes a row visible.
 *
 * Reads only the facts passed in -- the facts of the contract owner. */
export type InjuryLineKind="fracture"|"permanent_loss"|"burn"|"ambiguous_injury";
export type InjuryCompatibility={visible:boolean;lineKind:InjuryLineKind|null;reason:string|null};
/** Internal audit record for a row screened out by injury compatibility. Never
 * user-visible and never merged into ruledOut. */
export type IncompatibleBenefit={benefit:CatalogBenefit;reason:string};
const PART_PATTERNS:{part:string;pattern:RegExp}[]=[
  {part:"upper limb",pattern:/\bupper\s+(?:limbs?|extremit)/},{part:"lower limb",pattern:/\blower\s+(?:limbs?|extremit)/},
  {part:"limb",pattern:/\blimbs?\b/},{part:"forearm",pattern:/\bforearms?\b/},{part:"humerus",pattern:/\bhumer|\bupper\s+arm/},
  {part:"arm",pattern:/\barms?\b/},{part:"radius",pattern:/\bradius\b/},{part:"ulna",pattern:/\bulnae?\b/},
  {part:"elbow",pattern:/\belbows?\b/},{part:"wrist",pattern:/\bwrists?\b/},{part:"hand",pattern:/\bhands?\b/},
  {part:"finger",pattern:/\bfingers?\b/},{part:"thumb",pattern:/\bthumbs?\b/},{part:"phalanx",pattern:/\bphalan/},
  {part:"shoulder",pattern:/\bshoulders?\b/},{part:"clavicle",pattern:/\bclavic|\bcollar\s?bone/},
  {part:"leg",pattern:/\blegs?\b/},{part:"thigh",pattern:/\bthighs?\b/},{part:"femur",pattern:/\bfemur|\bfemoral/},
  {part:"tibia",pattern:/\btibia/},{part:"fibula",pattern:/\bfibula/},{part:"knee",pattern:/\bknees?\b/},
  {part:"patella",pattern:/\bpatell|\bknee\s?cap/},{part:"ankle",pattern:/\bankles?\b/},{part:"foot",pattern:/\bfoot\b|\bfeet\b/},
  {part:"toe",pattern:/\btoes?\b/},{part:"hip",pattern:/\bhips?\b/},{part:"pelvis",pattern:/\bpelvi/},
  {part:"spine",pattern:/\bspin(?:e|al)\b|\bvertebra/},{part:"skull",pattern:/\bskull/},{part:"jaw",pattern:/\bjaws?\b|\bmandibl/},
  {part:"rib",pattern:/\bribs?\b/},{part:"neck",pattern:/\bneck\b/},{part:"cheekbone",pattern:/\bcheek\s?bone/},
  {part:"eye",pattern:/\beyes?\b/},{part:"sight",pattern:/\bsight\b|\beyesight\b|\bblind/},{part:"hearing",pattern:/\bhearing\b|\bdeaf/},
  {part:"ear",pattern:/\bears?\b/},{part:"speech",pattern:/\bspeech\b/},{part:"insanity",pattern:/\binsanity\b/},
];
/** What a row's body-part word covers. A generic row ("Fracture of arm",
 * "Simple fracture of upper limb") answers a more specific report inside it
 * (an elbow, a humerus). The reverse is not true: a report of an "arm" does not
 * establish the wrist, so a wrist-only row stays hidden until it does. */
const ARM_PARTS=["arm","forearm","humerus","radius","ulna","elbow"];
const UPPER_LIMB=[...ARM_PARTS,"upper limb","wrist","hand","finger","thumb","phalanx","shoulder"];
const LEG_PARTS=["leg","thigh","femur","tibia","fibula","knee","patella"];
const LOWER_LIMB=[...LEG_PARTS,"lower limb","ankle","foot","toe","hip"];
const PART_COVERS:Record<string,string[]>={arm:ARM_PARTS,forearm:["forearm","radius","ulna"],"upper limb":UPPER_LIMB,
  leg:LEG_PARTS,"lower limb":LOWER_LIMB,limb:[...UPPER_LIMB,...LOWER_LIMB,"limb"],eye:["eye","sight"],sight:["sight","eye"],
  ear:["ear","hearing"],hearing:["hearing","ear"]};
/** The digits: answered by their own rows of a scale, not by a limb's (Round 12). */
const DIGITS=["finger","thumb","phalanx","toe"];
function bodyPartsIn(text:string){
  return PART_PATTERNS.filter(entry=>entry.pattern.test(text)).map(entry=>entry.part);
}
const FRACTURE_WORDS=/\bfractur|\bfull break\b|non-union|\bdislocat|\bbroken bones?\b/;
const BURN_LINE_WORDS=/\bburns?\b|\bscald|\bdisfigur/;
const PERMANENT_LOSS_WORDS=/\bloss of use\b|\bpermanent(?:ly)?\s+(?:and\s+)?(?:total\s+|partial\s+)?(?:loss|disab|impair)|\btotal and permanent\b|\bamputat|\bdismember|\bsevered?\b|paralys|parapleg|quadripleg|hemipleg|\bshortening of\b/;
const LOSS_OF_PART=/\b(?:loss|lost)\s+of\s+(?:or\s+)?(?:the\s+|one\s+|both\s+|a\s+|an\s+|all\s+|any\s+|two\s+)?(?:[a-z-]+\s+){0,3}?(?:arms?|legs?|hands?|feet|foot|limbs?|eyes?|sight|hearing|speech|thumbs?|fingers?|toes?|phalan\w*|ears?|lens|joints?)\b/;
function kindsInText(text:string):Exclude<InjuryLineKind,"ambiguous_injury">[]{
  const kinds:Exclude<InjuryLineKind,"ambiguous_injury">[]=[];
  if(BURN_LINE_WORDS.test(text))kinds.push("burn");
  if(FRACTURE_WORDS.test(text))kinds.push("fracture");
  if(PERMANENT_LOSS_WORDS.test(text)||LOSS_OF_PART.test(text))kinds.push("permanent_loss");
  return kinds;
}
/** A benefit in its own right, not a line of an injury schedule: it pays for
 * treatment, a stay, a bill, a death -- whatever the injury was. */
const OWN_RIGHT_BENEFIT=/\bmedical\b|reimburs|\bexpenses?\b|\bhospital|\bcash\b|ambulance|\bdeath\b|\bdies\b|funeral|allowance|\bincome\b|\bbills?\b|outpatient|out-patient|physiother|\btreatment|\bsurg(?:ery|ical)|dental|transport|evacuat|repatriat|recuperat|\bdaily\b|per day|compassionate|education|\btemporary\b|\bweekly\b|rehabilit|\bnursing\b|home care|modification|\bwheelchair|\bcrutch|\bprosthe|\bmobility aid/;
/** What kind of injury a catalog row pays for, read from every piece of
 * evidence on the row. null = not an injury-schedule line. */
export function classifyInjuryLine(benefit:Pick<CatalogBenefit,"benefitName"|"quote"|"conditions"|"kindEvidence">):{kind:InjuryLineKind|null;
  /** The text the row's body part and side are read from. */
  scopeText:string}{
  const name=(benefit.benefitName??"").toLowerCase();
  if(isScaleBand(name))return {kind:"burn",scopeText:name};
  // A death benefit is a death benefit, whatever else its title lists.
  if(/\bdeath\b/.test(name))return {kind:null,scopeText:name};
  const fromName=kindsInText(name);
  if(fromName.length===1)return {kind:fromName[0],scopeText:name};
  if(fromName.length>1)return {kind:"ambiguous_injury",scopeText:name};
  if(OWN_RIGHT_BENEFIT.test(name))return {kind:null,scopeText:name};
  const wording=[benefit.quote??"",...(benefit.conditions??[])].join(" ").toLowerCase();
  // The same benefit as another document of the plan titles it, when that
  // title states the kind this one lost (see preferStatedRules).
  if(benefit.kindEvidence){
    const inherited=kindsInText(benefit.kindEvidence.toLowerCase());
    if(inherited.length===1)return {kind:inherited[0],scopeText:name};
  }
  const fromWording=kindsInText(wording);
  const namesPart=bodyPartsIn(name).length>0;
  if(fromWording.length===1)return {kind:fromWording[0],scopeText:namesPart?name:wording};
  // A row whose wording spans several kinds and whose title names no body
  // part is a summary of a whole cover, not one line of its schedule.
  if(namesPart||/\b(?:fractur|dislocat|amputat|dismember|paralys)/.test(name))return {kind:"ambiguous_injury",scopeText:name};
  return {kind:null,scopeText:name};
}
function factText(value:FactValue|undefined){
  if(typeof value==="string")return value.toLowerCase();
  if(Array.isArray(value))return value.join(" ").toLowerCase();
  return "";
}
function statedImpairment(facts:SubjectFacts){
  const value=knownValue(facts,"permanentImpairment");
  if(value===true)return "permanent impairment";
  const text=factText(value).trim();
  if(!text||/^(?:no|none|nil|not|n\/a|unknown)\b/.test(text))return "";
  return text;
}
/** Whether this person has reported an injury at all. With none, the schedule
 * keeps its old behaviour: a hypothetical question is entitled to see what
 * the policy pays. */
export function hasInjuryFacts(facts:SubjectFacts){
  if(knownValue(facts,"injured")===true)return true;
  return ["injuries","permanentImpairment","fractureBodyPart","injuryKind","injuryBodyPart"]
    .some(key=>{const value=knownValue(facts,key);return value!=null&&value!==false&&!(typeof value==="string"&&!value.trim());});
}
/** The kinds of injury established by the facts. `injuryKind` is
 * authoritative; without it the person's own words are read. */
export function reportedInjuryKindsFromFacts(facts:SubjectFacts):Set<InjuryKind>{
  const kinds=new Set<InjuryKind>();
  const stated=knownValue(facts,"injuryKind");
  if(typeof stated==="string"&&stated.trim()){
    const kind=stated.toLowerCase();
    if(/fractur|broke|break|dislocat|crack/.test(kind))kinds.add("fracture");
    else if(/burn|scald/.test(kind))kinds.add("burn");
    else if(/permanent|loss|lost|amputat|dismember|paralys|parapleg|quadripleg|sever|blind|deaf/.test(kind))kinds.add("permanent_loss");
  } else for(const kind of reportedInjuryKinds(facts))kinds.add(kind);
  const fracture=knownValue(facts,"fractureBodyPart");
  if(typeof fracture==="string"&&fracture.trim())kinds.add("fracture");
  if(statedImpairment(facts))kinds.add("permanent_loss");
  return kinds;
}
const KIND_WORDS:Record<InjuryLineKind,string>={fracture:"a fracture",permanent_loss:"a permanent loss or loss of use",
  burn:"a burn or assessed impairment",ambiguous_injury:"a specific injury"};
export function injuryCompatibility(benefit:CatalogBenefit,facts:SubjectFacts):InjuryCompatibility{
  const row=classifyInjuryLine(benefit);
  if(!row.kind)return {visible:true,lineKind:null,reason:null};
  if(!hasInjuryFacts(facts))return {visible:true,lineKind:row.kind,reason:null};
  const hide=(reason:string):InjuryCompatibility=>({visible:false,lineKind:row.kind,reason});
  const label="“"+benefit.benefitName+"”";
  if(row.kind==="ambiguous_injury")
    return hide(label+" is a line of an injury schedule whose wording does not establish which kind of injury it pays for");
  const kinds=reportedInjuryKindsFromFacts(facts);
  const impairment=statedImpairment(facts);
  const text=[reportedInjuryText(facts),factText(knownValue(facts,"injuryBodyPart"))].join(" ");
  if(row.kind==="burn"){
    // A burns or impairment band answers only a burn or an assessed
    // impairment. It names no body part, so the kind is all there is.
    const band=isScaleBand(benefit.benefitName);
    if(kinds.has("burn")||(band&&(impairment||/impair|disfigur|\bscar\b/.test(text))))return {visible:true,lineKind:row.kind,reason:null};
    return hide(label+" pays for "+KIND_WORDS.burn+(kinds.size?", and the reported injury is "+[...kinds].map(k=>KIND_WORDS[k]).join(" and "):", and no burn has been reported"));
  }
  if(!kinds.size)return hide(label+" pays for "+KIND_WORDS[row.kind]+", and the kind of injury reported is not known yet");
  if(!kinds.has(row.kind))return hide(label+" pays for "+KIND_WORDS[row.kind]+", and the reported injury is "
    +[...kinds].map(k=>KIND_WORDS[k]).join(" and ")+" -- the same body part does not make them the same injury");
  // The kind agrees. Now the scope: a row for both hands or all the fingers is
  // not answered by one thumb.
  const scope=row.scopeText;
  const bothSided=/\bboth\b|\ball (?:fingers|toes)\b|\bfour fingers\b/.test(scope);
  const singleDigit=/\b(?:a|one|left|right|my|her|his)\b[^.]{0,20}\b(?:thumb|finger|toe|phalanx)\b/.test(text)&&!/\bboth\b|\ball\b/.test(text);
  if(bothSided&&singleDigit)return hide(label+" is written for both sides or all digits, and one was reported");
  // Which side.
  const side=(value:string)=>({left:/\bleft\b/.test(value),right:/\bright\b/.test(value)});
  const statedSide=factText(knownValue(facts,"injurySide"));
  const rowSide=side(scope),hurtSide=side(statedSide||text);
  if(rowSide.left!==rowSide.right&&hurtSide.left!==hurtSide.right&&rowSide.left!==hurtSide.left)
    return hide(label+" is for the "+(rowSide.left?"left":"right")+" side, and the "+(hurtSide.left?"left":"right")+" was reported");
  // Then the part of the body. A row that names none ("Fractures (simple)",
  // "Third degree burns") is answered by its kind alone.
  const rowParts=bodyPartsIn(scope);
  if(!rowParts.length)return {visible:true,lineKind:row.kind,reason:null};
  const hurtParts=bodyPartsIn(text);
  if(!hurtParts.length)return hide(label+" is for the "+rowParts.join("/")+", and which part of the body was hurt is not known yet");
  // Round 12: a thumb or a finger is not a limb, a hand or a foot. A lost thumb is answered by the thumb and
  // finger rows of the scale, never by "Loss of one limb" -- unless the document itself defines the limb (or
  // hand) to include the digits.
  const wording=[benefit.quote??"",...(benefit.conditions??[])].join(" ").toLowerCase();
  const digitsOnly=hurtParts.length>0&&hurtParts.every(part=>DIGITS.includes(part));
  const definesDigits=(part:string)=>new RegExp("\\b"+part+"s?\\b[^.]{0,60}\\b(?:means?|includes?|including|defined as|refers? to)\\b[^.]{0,160}\\b(?:fingers?|thumbs?|toes?|digits?)\\b").test(wording);
  const coversPart=(part:string,inner:string)=>!(digitsOnly&&DIGITS.includes(inner)&&!DIGITS.includes(part)&&!definesDigits(part));
  const covered=rowParts.some(part=>(PART_COVERS[part]??[part]).some(inner=>hurtParts.includes(inner)&&coversPart(part,inner)));
  if(!covered)return hide(label+" is for the "+rowParts.join("/")+", and the reported injury is to the "+hurtParts.join("/"));
  return {visible:true,lineKind:row.kind,reason:null};
}
/** Split a catalog into the rows that can answer this person's injury and the
 * rows that cannot, with the reason kept for audit. */
export function screenInjuryCompatibility(catalog:CatalogBenefit[],facts:SubjectFacts){
  const compatible:CatalogBenefit[]=[];const incompatible:IncompatibleBenefit[]=[];
  for(const benefit of catalog){
    const verdict=injuryCompatibility(benefit,facts);
    if(verdict.visible)compatible.push(benefit);
    else incompatible.push({benefit,reason:verdict.reason??"not compatible with the reported injury"});
  }
  return {compatible,incompatible};
}
/** The second guard inside assessCatalogBenefit: the same decision. */
export function injuryNotReported(benefit:CatalogBenefit,facts:SubjectFacts){
  return injuryCompatibility(benefit,facts).visible?null:benefit.benefitName;
}
export type CatalogAssessment={item:ClaimItem;missing:string[]};
export const CATALOG_CURRENCY_MISSING="the policy page that states the currency of this benefit (DearPolicy never assumes one)";
/** Arithmetic in application code, from a stored rule and a verified insured
 * amount. No model is involved and the result is identical every time. */
export function assessCatalogBenefit(args:{benefit:CatalogBenefit;coverage:OwnedCoverage|null;ownerName:string;facts:SubjectFacts;
  /** The contract this benefit sits in, and what happened -- so the figure can
   * be tied to one cover and one triggering event, which is what stops the same
   * sum being counted twice. */
  contractId?:string;contractName?:string|null;insurer?:string|null;events?:ClaimEventType[];
  /** Set when the person told us the policy is theirs but no schedule has been
   * uploaded. A figure the document itself prints still applies; a percentage
   * of "the sum insured" cannot be computed without their schedule. */
  declaredOnly?:boolean}):CatalogAssessment{
  const {benefit,coverage,facts}=args;
  // Currency comes from the quoted clause, or -- for a share of the sum
  // insured -- from the cover's own currency when its policy evidence states
  // it. Never defaulted to SGD; without one there is no figure.
  const statedCurrencyCode=benefit.currency?normalizeCurrencyCode(benefit.currency)||null
    :benefit.formulaKind==="sum_insured"&&coverage?.currencyVerified===true?normalizeCurrencyCode(coverage.currency)||null:null;
  const currency=statedCurrencyCode??"";
  const missing:string[]=[];
  const conditions=[...benefit.conditions];
  let amount:number|null=null,basis="",aggregation:"additive"|"reimbursement"="additive";
  // A per-day figure worked out without knowing the policy's own day limit.
  let uncappedDaily=false;
  const wrongInjury=injuryNotReported(benefit,facts);
  if(!statedCurrencyCode&&benefit.formulaKind!=="none")missing.push(CATALOG_CURRENCY_MISSING);
  else if(wrongInjury)missing.push("confirmation that \u201c"+wrongInjury+"\u201d is what happened \u2014 this benefit pays for that specific injury, and it is not among the ones you described");
  else if(benefit.formulaKind==="sum_insured"&&benefit.formulaValue!=null&&coverage?.amount!=null&&coverage.currencyVerified===true&&currency===normalizeCurrencyCode(coverage.currency)){
    amount=Math.round(coverage.amount*benefit.formulaValue*100)/100;
    basis=Math.round(benefit.formulaValue*1000)/10+"% of verified "+formatMoney(coverage.amount,currency);
    // A share the passage caps ("10% of Sum Insured, up to S$25,000") is paid up to the cap, and only when the cap is in
    // the cover's own currency; a passage with any other bound gives no figure (see shareBound).
    const bound=benefit.reviewedAt?{kind:"none" as const}:shareBound(benefit.quote,benefit.benefitName);
    if(bound.kind==="cap"&&bound.currency===currency&&amount>bound.amount){
      basis="Lower of "+basis+" and the printed cap of "+formatMoney(bound.amount,currency);amount=bound.amount;
    } else if(bound.kind==="cap"&&bound.currency===currency){
      basis+=", within the printed cap of "+formatMoney(bound.amount,currency);
    } else if(bound.kind!=="none"){amount=null;basis="";missing.push("a cap this passage prints in the cover's own currency");}
  } else if(benefit.formulaKind==="fixed"&&benefit.formulaValue!=null){
    amount=benefit.formulaValue;basis="Fixed benefit in the quoted clause";
  } else if(benefit.formulaKind==="expense_cap"&&benefit.formulaValue!=null&&benefit.factKey){
    const spent=knownValue(facts,benefit.factKey);
    aggregation="reimbursement";
    if(typeof spent==="number"&&spent>=0){amount=Math.min(spent,benefit.formulaValue);basis="Lower of the reported eligible expense and the quoted cap of "+formatMoney(benefit.formulaValue,currency);}
    else missing.push("the actual eligible amount for "+benefit.benefitName);
  } else if(benefit.formulaKind==="daily"&&benefit.formulaValue!=null&&benefit.factKey&&benefit.offsetDays!=null){
    const days=knownValue(facts,benefit.factKey);
    if(knownValue(facts,"hospitalStayOngoing")===true)missing.push("the completed length of the hospital stay");
    else if(typeof days==="number"&&Number.isInteger(days)&&days>=0){
      const payableDays=Math.max(0,days-benefit.offsetDays);
      // A row that does not state its own maximum used to withhold the figure
      // entirely. But the person has told us how many days they were in, the
      // rate is quoted, and the arithmetic is theirs to check: a cap they
      // cannot see cannot be the reason they are shown nothing. The unknown
      // cap becomes what it is -- a condition on the figure.
      const payFor=benefit.maximumDays!=null?Math.min(benefit.maximumDays,payableDays):payableDays;
      // Nobody is helped by a card reading S$0.00. A stay shorter than the
      // days this benefit waits out is the rule saying it does not respond,
      // and that is what the card should say.
      if(payFor<=0)missing.push("a hospital stay longer than the "+benefit.offsetDays
        +" day"+(benefit.offsetDays===1?"":"s")+" this benefit waits out — the stay you described is shorter than that");
      uncappedDaily=benefit.maximumDays==null;
      amount=payFor>0?payFor*benefit.formulaValue:null;
      basis=formatMoney(benefit.formulaValue,currency)+" per day after the first "+benefit.offsetDays
        +(benefit.maximumDays!=null?", up to "+benefit.maximumDays+" days"
          :", for the "+payableDays+" day"+(payableDays===1?"":"s")+" you reported");
      if(uncappedDaily)conditions.push("The row this came from does not state a maximum number of payable days, so a limit elsewhere in the wording could reduce this figure.");
    } else missing.push("the number of nights in hospital");
  }
  if(benefit.formulaKind==="sum_insured"&&amount==null&&!coverage?.amount)
    missing.push("your own sum insured for "+(benefit.productName?"“"+benefit.productName+"”":"this plan")+" — no certificate or schedule on file names that plan with an amount"+(benefit.productName?"; if it is the same plan under another name, open the row on the Benefits page and set the product name":""));
  // How far this figure can be trusted. It is always shown next to the amount,
  // never used to hide it: a person who cannot see a number cannot check it
  // against their own policy, and DearPolicy exists to give them the number.
  const personalEvidence=coverage?.documentRole==="personal_schedule"||coverage?.documentRole==="certificate";
  // A multiple of the sum insured that no policy pays.
  //
  // The clause has to state the percentage before it is accepted at all, so
  // this is not a guess -- but "1000% of the Sum Insured" reads as a valid
  // clause and turns a S$1,000,000 cover into S$10,000,000. One stray digit in
  // a scanned table does it. Accidental death riders reach two or three times
  // the sum insured; nothing reaches ten. Above that the figure is still shown,
  // because a number nobody can see is a number nobody can correct, but it is
  // labelled as unverified and kept out of the household total until a person
  // says it is right.
  const IMPLAUSIBLE_SHARE=3;
  const implausibleShare=benefit.formulaKind==="sum_insured"&&benefit.formulaValue!=null
    &&benefit.formulaValue>IMPLAUSIBLE_SHARE&&!benefit.reviewedAt;
  if(implausibleShare&&amount!=null)conditions.push("DearPolicy read this as "
    +Math.round((benefit.formulaValue??0)*100)+"% of the sum insured, which is far more than any policy pays for one benefit. "
    +"The figure is shown but not counted until you confirm it on the Benefits page.");
  const estimateBasis:"confirmed"|"estimated"|"indicative"=
    implausibleShare?"indicative"
    :benefit.needsConfirmation||args.declaredOnly?"indicative"
    :benefit.formulaKind==="sum_insured"?(personalEvidence?"confirmed":"estimated")
    :uncappedDaily?"estimated"
    :"confirmed";
  if(benefit.needsConfirmation&&amount!=null)
    missing.push("your confirmation of what this benefit pays — DearPolicy read the rate from the heading above the row, not the row itself (Benefits page)");
  for(const requirement of benefit.requirements)
    if(knownValue(facts,requirement.factKey)==null)missing.push(requirement.why);
  for(const entry of missing)conditions.push("Still needed: "+entry.replace(/[.\s]+$/,"")+".");
  const triggers=benefitTriggerEvents(benefit.benefitName,benefit.quote);
  const paysOn=payingEvent(triggers,args.events??[]);
  // A figure a person cannot trace back to one of their own covers is a figure
  // they cannot check. Every card says which cover it is paid under, and the
  // policy number the insurer settles against.
  const coverLabel=coverage?.productName??coverage?.policyName??benefit.productName??args.contractName??null;
  const coverNumber=coverage?.policyNumber??coverage?.groupPolicyNumber??null;
  const paidUnder=coverLabel?" Paid under your "+coverLabel+" cover"+(coverNumber?" (policy "+coverNumber+")":"")+".":"";
  // The standard Singapore list is a floor, not the contract. Saying so on the
  // card is the difference between an estimate a person can rely on and one
  // they can be surprised by.
  if(paysOn==="critical_illness")conditions.push(
    "Payable only if the diagnosis meets the definition in your policy's own schedule of critical illnesses. "
    +"DearPolicy checks against the standard Singapore list, and a policy may define fewer conditions than that list contains.");
  const cover=coverKey({policyNumber:coverage?.policyNumber,groupPolicyNumber:coverage?.groupPolicyNumber,
    insurer:args.insurer??coverage?.insurer??null,
    // The cover identifies itself, not the document the rule was read from. A
    // booklet's product heading is not a cover: two rules read from two
    // different booklets that both pay from the same certificate line are one
    // cover, and keying on the heading would have let them be added together.
    productName:canonicalProduct(coverage?.productName??coverage?.policyName??benefit.productName??null),
    contractId:args.contractId??benefit.policyId,contractName:args.contractName??null});
  const item:ClaimItem={
    title:args.ownerName+" · "+benefit.benefitName,
    coverKey:cover,
    ...(args.contractId?{contractId:args.contractId}:{}),
    ...(coverLabel?{coverLabel}:{}),
    ...(namesASpecificInjury(benefit.benefitName)
      ?{scaleGroup:benefit.policyId+"#"+(benefit.sourcePage??0)}:{}),
    ...(coverage?.amount!=null&&coverage.amount>0&&coverage.currencyVerified===true&&normalizeCurrencyCode(coverage.currency)===currency
      ?{coverAmount:coverage.amount}:{}),
    ...(paysOn?{payingEvent:paysOn}:{}),
    status:amount!=null?(missing.length?"potentially_applicable":"likely_applicable"):"needs_document",
    amountText:amount!=null?formatMoney(amount,currency):null,
    amountLabel:amount==null?undefined
      :args.declaredOnly?"Amount printed in the policy document — not yet confirmed against your own schedule"
      :aggregation==="reimbursement"?"Calculated reimbursement (internal)":"Calculated benefit (internal)",
    ...(amount!=null?{estimateBasis}:{}),
    ...(amount!=null?{calculatedAmount:amount,currency,calculationKind:benefit.formulaKind as Exclude<CatalogFormulaKind,"none">,
      // A figure that has not been checked against the person's own schedule is
      // shown, but never summed into a headline household total.
      aggregation:args.declaredOnly?"reimbursement" as const:aggregation,calculationId:benefit.id}:{}),
    reason:amount!=null?basis+". "+(args.declaredOnly
        ?"This figure is the one printed"+onPage(benefit.sourcePage)+" of the document you uploaded. Upload your schedule, certificate or statement to confirm it is the figure that applies to you."
        :estimateBasis==="indicative"
        ?"Estimated from the quoted clause"+onPage(benefit.sourcePage)+". DearPolicy read the rate from the heading above this row rather than from the row itself, so confirm it on the Benefits page before relying on it."
        :estimateBasis==="estimated"
        ?(uncappedDaily
          ?"Estimated from the rate quoted"+onPage(benefit.sourcePage)+" and the number of days you reported. The row does not state a day limit, so check the full wording for one."
          :"Estimated from the quoted clause"+onPage(benefit.sourcePage)+" and a sum insured found in a document naming you, rather than in your own schedule or certificate.")
        :"Calculated from your policy schedule and the quoted clause"+onPage(benefit.sourcePage)+".")+paidUnder
      :missing[0]?"It may apply; "+missing[0].replace(/[.\s]+$/,"")+" is still needed to work out an amount"+(benefit.sourcePage?" (page "+benefit.sourcePage+")":"")+"."
      :whatItPays(benefit)+(benefit.sourcePage?" (page "+benefit.sourcePage+")":"")+".",
    conditions:[...new Set(conditions)],
  };
  // No figure yet, but the rule is known. Showing the rule is the answer: a
  // person who is told nothing cannot check anything, and "DearPolicy exists to
  // give them the number" applies just as much to the number their policy
  // prints as to the one it settles. It is labelled as the rule, not as a
  // payout, and it is never added to a total.
  if(item.amountText==null&&benefit.formulaKind!=="none"){
    item.amountText=describeBenefitFormula(benefit);
    item.amountLabel="What this benefit pays";
    item.status="potentially_applicable";
  }
  return {item,missing};
}

/** Accepts a payout rule only when the quoted clause itself proves it.
 *
 * This runs once, when the document is catalogued, and is the only place a
 * formula can enter the system. It is plain code with no model involved, so the
 * same clause always yields the same rule, and a clause that does not clearly
 * state a supported rule yields none rather than a guess. */
/** What a policy calls the figure its percentages are percentages of. One
 * document says "Sum Insured", another "your coverage amount", and a rule
 * stated in the second wording was being refused for saying the same thing in
 * different words. */
const INSURED_AMOUNT="(?:sum\\s+(?:insured|assured)|coverage\\s+amount|sum\\s+covered|insured\\s+amount)";
/** "Prevailing Insured Amount", "current sum assured": the insured amount as it stands when the claim is made, which an
 * earlier claim on the policy may have reduced (a critical illness plan pays 10% for angioplasty, then the rest). Read as
 * a share of the sum insured only when the quote says nothing else: a benefit label (no figure in it) and a colon or dash,
 * then exactly "N% of [the] prevailing insured amount", then at most a full stop. Any
 * other word may bound the share (a cap, "once only", "for each child", "of the rider", a second share), and cap wording
 * has too many forms to list, so anything else gives no rule (TE #209: each listed cap word leaked the next one). */
const PREVAILING="(?:prevailing|current)\\s+";
const PREVAILING_AMOUNT=new RegExp("\\b"+PREVAILING+INSURED_AMOUNT);
// The label: one list marker at most ("(a)", "(ii)", "a."), then only letters, spaces, quotes, & / and hyphens -- no
// comma, bracket or figure, which could carry a bound ("Angioplasty (subject to a maximum of ...)", "Angioplasty, payable
// once only"). Nothing may follow the insured amount but a full stop or semicolon: a "(see ...)" reference can point to a
// clause that caps the share (Critic R408).
const PREVAILING_SHARE_ONLY=new RegExp("^(?:(?<label>(?:\\((?:[a-z]|[ivx]+|\\d{1,2})\\)|[a-z]\\.)?\\s*[\\p{L}\\s'\"“”‘’&/-]*?)\\s*[:–—-]\\s*)?"
  +"\\d+(?:\\.\\d+)?\\s*%\\s*of\\s+(?:the\\s+)?"+PREVAILING+INSURED_AMOUNT+"\\s*[.;]?$","u");
// The label must be the row's own benefit name (case, spacing, quotes and one list marker aside): a label is free text,
// and words in it can still bound the share ("Angioplasty payable once only", "Angioplasty rider"; TE pr209). Without a
// name to compare, only a quote with no label stands.
const labelWords=(t:string)=>normalText(t).replace(/^(?:\((?:[a-z]|[ivx]+|\d{1,2})\)|[a-z]\.)\s*/u,"").replace(/[^\p{L}]+/gu," ").trim();
function prevailingNotProved(text:string,benefitName?:string|null):boolean{
  if(!PREVAILING_AMOUNT.test(text))return false;
  const shape=text.match(PREVAILING_SHARE_ONLY);
  if(!shape)return true;
  const label=labelWords(shape.groups?.label??"");
  return label!==""&&label!==labelWords(benefitName??"");
}
export const PREVAILING_NOTE="It is a share of the insured amount when the claim is made, which an earlier claim on this policy may have reduced.";

/** A share of the sum insured whose passage also prints an amount or a bound ("10% of Sum Insured, up to S$25,000",
 * "subject to a maximum of RM25,000", "not exceeding 25 000", "up to the limit in the Benefit Table", "capped at 1/40 of the
 * Sum Insured"): it may cap the share, and paying the full share overstated the benefit (S$100,000 on a S$1,000,000 cover
 * where the cap is S$25,000; Critic R407, TE pr210). Such a share is not used. Counted: a figure with a currency sign,
 * code or word; a grouped, four-digit or "k" figure; a number word for hundreds or more; a figure per day or week; a
 * fraction; any cap word; a choice of the lower ("whichever is lower", "if lower", "not greater than"); and a pointer to a
 * table or schedule, which may hold the cap. A figure the share does not need ("within 30 days", "under age 65") is left
 * alone, and so is a threshold of the event itself (EVENT_THRESHOLD: "burns equal to or greater than 15% but less than
 * 25% of the body: 30%"). Stored rows: scripts/policies/stored-share-shapes-test.ts. */
const PRINTS_AN_AMOUNT=new RegExp([
  String.raw`(?:s\$|us\$|hk\$|a\$|nz\$|\$|€|£|¥|₹|\b(?:sgd|usd|myr|rm|hkd|aud|nzd|cad|eur|gbp|chf|jpy|inr|idr|thb|php|cny|rmb|twd|krw|vnd|bnd))\s*\d`,
  String.raw`\b(?:dollars?|ringgit|euros?|pounds?|francs?|yen|yuan|rupees?|rupiah|baht|pesos?|won(?!['’]t))\b`,
  // A share's own figure ("1000% of the Sum Insured", "1,000 per cent") is the share, never a printed amount.
  String.raw`(?:\d{1,3}(?:[ ,.'’]\d{3})+|\d{4,})(?![\d.,]*\s?(?:%|per\s?cent\b))|\b\d+(?:\.\d+)?\s*k\b|\b(?:hundreds?|thousands?|millions?|billions?|lakhs?|crores?|ratus|ribu|juta)\b`,
  String.raw`\d\s*(?:per|a|each|every)\s+(?:day|night|week|month|visit|claim)\b|\b\d+\s*/\s*\d+\b`,
  String.raw`\bup\s+to\b|\bmax(?:imum|\.)?\b|\blimit(?:s|ed)?\b|\bcap(?:s|ped)?\b|\bexceed\w*|(?:\b(?:no|not|never|cannot|nor)|n['’]t)(?:\s+\p{L}+){0,3}?\s+(?:more|longer)\s+than\b|\bsubject\s+to\b|\bceiling\b|\bwhichever\b|\bat\s+most\b|\b(?:lesser|smaller|lower|higher|greater|larger)\b|\b(?:table|schedule)\b`,
  // The same in Malay: exceeding, maximum, limit, schedule, subject to, up to, limited, not more than. Words that change
  // the share ("reduced to 25%", "less any amount paid", "dikurangkan") are read only after it (shareStandsAlone).
  String.raw`\b(?:melebihi|maksimum|had|jadual|tertakluk|sehingga|terhad)\b|\btidak\s+(?:lebih|melebihi)\b`,
].join("|"),"iu");
/** A comparative that measures the event, not the payout: "than" followed by a number with a unit of the event
 * (a percentage that is not a share of an amount, years, decibels, a length, a weight, a time), or an age compared with a
 * plain number. Allow-list: any other comparative ("never greater than the amount in force", "if smaller than that",
 * "cannot be higher than 20% of the Sum Insured") stays a possible cap (Critic R421, TE pr215). */
const SHARE_OF_AN_AMOUNT=String.raw`\s*(?:of)\s+(?:the\s+|your\s+|this\s+|that\s+|any\s+|all\s+)?(?:\p{L}+\s+){0,2}?(?:sum|insured|assured|benefits?|premiums?|amounts?|bills?|claims?|limits?|basic|base|death|totals?|polic(?:y|ies)|charges?|loans?|expenses?|costs?|cover(?:age)?|jumlah|faedah)\b`;
const EVENT_UNIT=String.raw`(?:\s?(?:%|per\s?cent)(?!${SHARE_OF_AN_AMOUNT})|\s?(?:years?|yrs?|months?|weeks?|days?|hours?|hrs?|minutes?|mins?|db|decibels?|cm|mm|centimet(?:re|er)s?|millimet(?:re|er)s?|met(?:re|er)s?|m|feet|ft|inch(?:es)?|kg|kilograms?|lbs?|pounds?\s+in\s+weight)\b)`;
/** A negation up to three words before the comparative ("not more than 60 days", "never higher than 25%", "which shall
 * not be greater than", "isn't more than") makes it a cap on what is paid, never a threshold of the event (TE pr215 C11,
 * C18, C19; Critic R425). */
const NEGATED=String.raw`(?<!(?:\b(?:no|not|never|cannot|nor|neither|tidak|bukan)|n['’]t)(?:\s+\p{L}+){0,3}\s+)`;
const EVENT_THRESHOLD=new RegExp(String.raw`${NEGATED}\b(?:greater|higher|larger|more|lower|less|smaller|fewer|older|younger)\s+than\s+(?:or\s+equal\s+to\s+)?(?:\d+(?:\.\d+)?(?:\s+(?:consecutive|continuous|full|calendar|straight|complete))?${EVENT_UNIT})`
  +String.raw`|\bage[ds]?\s+(?:is\s+|of\s+)?(?:greater|higher|more|lower|less|older|younger)\s+than\s+\d{1,3}\b(?![\d,.])`,"giu");
/** PRINTS_AN_AMOUNT, with event thresholds taken out first. Only a threshold that comes before any share is taken out:
 * an event band names the event, then the share ("Burns - greater than 15% but less than 25% 30%"). A comparative after
 * a share qualifies that share ("50% of Sum Insured, but the amount we pay will not under any circumstances be higher
 * than 25%", "reduced to 25% if the burn is smaller than 10%"), so it stays a possible cap (Critic R430). */
// A share in any form: a percentage, a fraction in words ("one half") or the insured amount itself (Critic R434).
const SHARE_FIGURE=new RegExp(String.raw`\d\s?%|\bper\s?cent\b|\b(?:${WORD_FRACTIONS.map(entry=>entry.words).join("|")})\b|`+INSURED_AMOUNT,"iu");
const SHARE_COUNT_SOURCE=String.raw`\d+(?:\.\d+)?\s?%|\b\d+(?:\.\d+)?\s?per\s?cent\b|\b(?:${WORD_FRACTIONS.map(entry=>entry.words).join("|")})\b|\b(?:half|a\s+quarter|a\s+third)\b`;
/** The insured amount in the languages read (English, Malay, Indonesian), after "of": "of the Sum Insured", "daripada
 * Jumlah Diinsuranskan", "dari Uang Pertanggungan". */
const OF_INSURED=String.raw`\s*(?:(?:of)\s+)?(?:the\s+|your\s+)?(?:prevailing\s+|current\s+)?(?:${INSURED_AMOUNT})`;
const SHARE_OF_INSURED=new RegExp(String.raw`(?:${SHARE_COUNT_SOURCE})`+OF_INSURED,"iu");
function printsAnAmount(text:string){
  let out="",at=0;
  for(const match of text.matchAll(EVENT_THRESHOLD)){
    const before=text.slice(at,match.index);
    // A comparative after the share, "less than" and "more than" included, may bound it.
    if(SHARE_FIGURE.test(before))return true;
    out+=before+" ";at=match.index+match[0].length;
  }
  return PRINTS_AN_AMOUNT.test(out+text.slice(at));
}
/** Event thresholds taken out, as printsAnAmount takes them out: only those before any share. */
function withoutEventBands(text:string){
  let out="",at=0;
  for(const match of text.matchAll(EVENT_THRESHOLD)){
    const before=text.slice(at,match.index);
    if(SHARE_FIGURE.test(before))break;
    out+=before+" ";at=match.index+match[0].length;
  }
  return out+text.slice(at);
}
/** A percentage that measures the event, not a share: one compared ("greater than 15%", "at least 10%", "lebih dari 15%", "supérieures
 * à 15%", "大于15%") or one of the body ("15% of the body surface", "15% permukaan badan", "15% de la surface"). */
const EVENT_PERCENT_BEFORE=/(?:\b(?:than|or\s+equal\s+to|least|dari|daripada)|\bà|于|过)\s*$/u;
const EVENT_PERCENT_AFTER=/^\s*(?:(?:of|de|daripada|dari)\s+)?(?:the\s+|la\s+|du\s+|total\s+)?(?:body|surface|skin|tbsa|permukaan|badan|tubuh|kulit|corps|corporelle)\b/u;
/** What a share passage may say after its share when it prints no amount (allow-list, Critic R443 H1): the insured amount,
 * the benefit's own name words, and words that neither change nor narrow the share (CAP_PASSAGE_WORDS and phrases). Any
 * other word, figure or second share ("minus any amount paid before", "halved for children", "or half that", "atau 25%
 * bagi kanak-kanak", "ditolak sebarang jumlah") may change what is paid. Before the share, a second share ("Children 25%,
 * adults 50% of the Sum Insured") does too; a figure that measures the event does not. Words before the share describe
 * the event ("hearing reduced by more than 80 decibels in one ear, 50%", Critic R443 M1) and are not read. */
/** A condition on when or to whom the share is paid, after it: "for qualifying critical illness", "to the policy owner", "if Total and Permanent Disability is due to an accident", "payable
 * within 30 days of diagnosis", "if diagnosed under age 65", "upon diagnosis of a Critical Illness". It says when, not how
 * much, unless it holds a word that changes, splits or orders the amount (SHARE_CHANGER: "for children", "for the first
 * claim"). */
const SHARE_CONDITION=/(?:^|[\s,])(?:if|when|where|for|once|provided|within|upon|on|following|to|after|before|during|until|as\s+certified|due\s+to|caused\s+by|resulting\s+from|as\s+a\s+result\s+of|en\s+cas\s+d[e'’]?|lors\s+d[eu'’]?|apabila|jika|bila|semasa|sekiranya|kepada)\b/u;
/** Words that change, split or scope the amount, in English and Malay: a deduction, a multiple or part, another class of
 * person, or an alternative. */
const SHARE_CHANGER=/\b(?:minus|less|net|deduct\w*|reduc\w*|half|halved|halves|double[sd]?|twice|triple[sd]?|quarters?|thirds?|otherwise|instead|children|child|juvenile|minor|adults?|ditolak|dikurang\w*|kurang|separuh|dibahagi\w*|dipotong|potong|baki|ansuran|pro[\s-]?rat\w*|scaled?|according\s+to|depend\w*|degree|extent|instal+ments?|remain\w*|balance|outstanding|kanak|dewasa|tetapi|but|except|excluding|plus|increase\w*|decrease\w*|lower|higher|shared?|proportion\w*|pro[\s-]?rata|rateabl\w*|apportion\w*|divid\w*|split|equally|times|multipl\w*|offset|basis|first|second|subsequent|additional|further|later|next|each\s+(?:child|adult|person|insured))\b/u;
/** Words before the share that change it rather than describe the event: a deduction, a multiple, an alternative (Critic
 * R450 H1c). "reduced" is left out: "hearing reduced by more than 80 decibels" is the event (R443 M1). */
const CHANGER_BEFORE_SHARE=/\b(?:deduct\w*|minus|net\s+of|offset|less\s+(?:any|the|all|amounts?)|twice|double[sd]?|triple[sd]?|otherwise|else|instead|ditolak|separuh)\b/u;
/** In a condition clause, a word of paying or of the amount: the clause goes on to say what is paid, not only when (Critic
 * R450 H1a: "if other insurance applies, we pay only our rateable proportion"). */
const PAY_WORD=/\b(?:pay|pays|paid|payable|paying|amount|amounts|benefit|benefits|sum)\b/u;
const PER_BODY_PART=/\b(?:per|for\s+each|for\s+one)\s+(?:eye|ear|limb|arm|leg|hand|foot|finger|toe|thumb|tooth)\b/gu;
/** What a condition on when or to whom a share is paid may say (allow-list, Critic R454): who is paid, what happens, when,
 * and who certifies it, in English. Any other word ("in five equal instalments", "to the extent not paid by any
 * other insurer", "dibahagi sama rata") may change what is paid, so the share is not used. */
const CONDITION_WORDS=new Set(("if when where for once provided that within upon on following to after before during until as "
  +"due caused by resulting from result results resulted arise arises arising arose of the a an any one this that his her their your you our its it we us he she they "
  +"is are was were be been being has have had becomes become becoming occurs occur occurred happens happen happened "
  +"and in at least more than or equal with from date event direct directly expected use anniversary legs arms hands feet "
  +"lasting lasts lasted continuous continuously "
  +"hospitalised hospitalized confined warded confirmation confirmed made waiting named subject heart attack stroke cancer "
  +"diagnosis diagnosed diagnose death dies die died dying accident accidental accidents injury injuries illness illnesses "
  +"disease diseases condition conditions disability disabled disablement permanent permanently total totally "
  +"hospital hospitalisation hospitalization admission admitted intensive care coma surgery operation qualifying critical covered "
  +"terminal terminally major paralysis loss lost sight hearing speech limb limbs eye eyes both "
  +"policy owner owners policyowner policyholder holder estate beneficiary beneficiaries nominee nominees trustee trustees "
  +"insured life assured person persons member participant "
  +"age aged under over survival period term cover approval approve approved claim claims receipt proof notification notice "
  +"certified certification confirmed registered medical practitioner doctor specialist physician singapore overseas abroad "
  // Who is paid, as a closed list of payee nouns: never an open slot for any words (Critic R461).
  +"executor executors administrator administrators assignee assignees assignment valid legal personal representative "
  +"representatives trust nominated appointed designated heirs heir failing "
  // What happens, as a closed list of medical words: an illness's name says when the share is paid, never how much.
  +"cancer cancers carcinoma situ tumour tumor benign malignant specified severity neurological deficit end stage kidney renal "
  +"liver lung failure requiring dialysis alzheimer dementia severe motor neurone neuron als parkinson multiple sclerosis "
  +"muscular dystrophy diabetes mellitus heart valve open coronary artery bypass graft angioplasty organ transplant "
  +"paraplegia quadriplegia tetraplegia hemiplegia systemic lupus erythematosus nephritis pulmonary hypertension primary hiv transfusion blood blindness deafness burns encephalitis meningitis aplastic anaemia anemia "
  +"cervix uteri breast prostate brain early intermediate advanced stage type").split(" "));
/** A period the share is paid over, not a time it is paid in ("payable for 5 years", "for 12 months", "for life", Critic
 * R465): each payment may be the share, so the amount is not one share. A period that measures the event is the condition
 * ("if hospitalised for 5 consecutive days", "disabled for 6 months"), and "within", "before", "after" or "until" say when. */
const PAYMENT_PERIOD=/(?<!\b(?:hospitali[sz]ed|confined|warded|admitted|disabled|incapacitated|bedridden|unconscious|coma|lasting|lasts|lasted|continu\w*|persist\w*|surviv\w*|hospital|intensive\s+care|dimasukkan\s+ke\s+hospital|dirawat)\s+)\b(?:for|over|selama)\s+(?:a\s+(?:period|total)\s+of\s+)?(?:up\s+to\s+)?\d{1,4}\s+(?:consecutive\s+|calendar\s+|berturut[\s-]turut\s+)?(?:hours?|days?|weeks?|months?|years?|jam|hari|minggu|bulan|tahun)\b|\bfor\s+(?:the\s+rest\s+of\s+)?(?:his\s+|her\s+|their\s+|your\s+)?life(?:time)?\b(?!\s+(?:assured|insured))|\bseumur\s+hidup\b/u;
/** A cancer stage or diabetes type: "Stage 3 cancer or above", "Type 1 Diabetes". A count that names the illness; "or
 * above" after a stage is the stage again (STAGE_OR_ABOVE). The words between are still read. */
const STAGE_OR_ABOVE=/\bor\s+(?:above|higher|worse)\b/gu;
const ILLNESS_NUMBER=/\b(stage|stadium|peringkat)\s+(?:[0-4]|i{1,3}|iv)\b|\b(type)\s+(?:[12]|i{1,2})(?=\s+diabetes\b)/gu;
/** Durations and ages are allowed as figures: "within 30 days", "for 5 consecutive days", "under age 65", "96 hours". */
const CONDITION_FIGURES=/\b\d{1,3}\s+(?:covered\s+|specified\s+|listed\s+)?(?:critical\s+|major\s+)?(?:conditions|illnesses|diseases|penyakit)\b|\b\d{1,4}\s+(?:consecutive\s+|calendar\s+|berturut[\s-]turut\s+)?(?:hours?|days?|weeks?|months?|years?|jam|hari|minggu|bulan|tahun)\b|\b(?:age|aged|umur|berumur)\s+\d{1,3}\b|\b(?:two|both|one)\s+(?:limbs?|eyes?|ears?|hands?|feet|foot|arms?|legs?)\b/gu;
/** The share itself paid again, said in other words: "and we pay it within 14 days". */
const PAID_AS_SAID=/\b(?:we\s+(?:will\s+|shall\s+)?pay\s+it|it\s+(?:is|will\s+be|shall\s+be)\s+paid)\b/gu;
/** "as a lump sum", "in one lump sum": how, not how much. */
const LUMP_SUM=/\b(?:as|in)\s+(?:a|one)\s+(?:single\s+)?lump[\s-]sum\b/gu;
/** A period of cover named as such: "during the Benefit Term", "within the policy year". */
const COVER_PERIOD=/\b(?:benefit|policy|cover(?:age)?|insurance)\s+(?:term|period|year|anniversary)\b/gu;
function conditionHarmless(condition:string,benefitName:string|null|undefined){
  const own=new Set(normalText(benefitName??"").split(/[^\p{L}]+/u).filter(w=>w&&!CAP_SCOPE_WORD.test(w)));
  if(PAYMENT_PERIOD.test(normalText(condition)))return false;
  const text=normalText(condition).replace(/\(s\)|['’]s\b/gu," ")
    .replace(/\b(?:stage|stadium|peringkat)\s/u.test(normalText(condition))?STAGE_OR_ABOVE:/$^/gu," ").replace(ILLNESS_NUMBER,"$1$2").replace(PAID_AS_SAID," ").replace(LUMP_SUM," ").replace(COVER_PERIOD," ").replace(CONDITION_FIGURES," ").replace(ANY_COVERED_CONDITION," ");
  const words=text.replace(/[,.;:()\-–—'’"“”/]/g," ").split(/\s+/).filter(Boolean);
  return words.every(w=>CONDITION_WORDS.has(w)||own.has(w));
}
function shareStandsAlone(text:string,benefitName:string|null|undefined){
  const rest=withoutEventBands(text);
  const main=SHARE_OF_INSURED.exec(rest)??[...rest.matchAll(new RegExp(SHARE_COUNT_SOURCE,"giu"))].at(-1)??null;
  if(!main||main.index==null)return true;
  const before=rest.slice(0,main.index);
  if(CHANGER_BEFORE_SHARE.test(before))return false;
  for(const m of before.matchAll(new RegExp(SHARE_COUNT_SOURCE,"giu")))
    if(!EVENT_PERCENT_BEFORE.test(before.slice(0,m.index))&&!EVENT_PERCENT_AFTER.test(before.slice(m.index!+m[0].length)))return false;
  // "per eye", "for each hand": the share is for each such part, which changes nothing (Critic R450 low).
  // "of the Sum Assured of this Basic Benefit": whose sum it is, the row's own kind (ownSumPhrase). "of the Basic Benefit"
  // from another row may be another cover's sum, so only "this" is read.
  const after=rest.slice(main.index+main[0].length).replace(new RegExp(OF_INSURED,"giu")," ").replace(PER_BODY_PART," ")
    .replace(new RegExp("^\\s*"+ownSumPhrase(benefitName).source,"u")," ");
  // A second share anywhere after it ("50% of the Sum Insured. 25% for children.") is another rule for some claims.
  if(new RegExp(SHARE_COUNT_SOURCE,"iu").test(after))return false;
  // The rest of the share's own sentence: harmless words, or a condition on when it is paid that does not touch the amount.
  const sentence=after.split(/[.;](?:\s|$)/u)[0];
  // The words before the first condition or payee ("is payable", "will be paid in one lump sum") must be harmless; the
  // condition itself ("within 30 days of approval", "to your estate upon your death") may say anything but change the amount.
  // Every later sentence may still change it ("For children this amount is halved.", Critic R450 H1b).
  if(SHARE_CHANGER.test(after.slice(sentence.length)))return false;
  const at=SHARE_CONDITION.exec(sentence);
  if(!at)return capPassageHarmless(sentence,benefitName);
  const condition=sentence.slice(at.index+at[0].length);
  return capPassageHarmless(sentence.slice(0,at.index),benefitName)&&!SHARE_CHANGER.test(condition)&&conditionHarmless(sentence.slice(at.index),benefitName);
}
export const CAPPED_SHARE_NOTE="DearPolicy did not use this share of the sum insured: the passage also prints an amount or other words, which may cap or change what is paid.";
/** What bounds a share of the sum insured. "none": the passage prints no amount or bound. "cap": it prints exactly one
 * cap with its currency ("up to S$25,000", "RM5,000, whichever is lower") and nothing else that may bound the share once
 * that cap is taken out, so the share is paid up to the cap. "unsure": anything else, and the share is not used. */
export type ShareBound={kind:"none"}|{kind:"cap";amount:number;currency:string}|{kind:"unsure"};
/** Allow-list for what a capped share's passage may say besides the share and its cap (Critic R416, TE pr211): words that
 * neither change the amount nor narrow who or what the cap is for. Anything else ("for children 50% of that", "in total",
 * "doubled if overseas", "for a child under 18", a figure) leaves the share unsure. The benefit's own name words count too. */
const CAP_PASSAGE_WORDS=new Set(("a an the this that it its we will shall be is are was pay pays paid payable paying receive "
  +"benefit benefits amount sum insured assured person life policy cover per claim condition event of additional additionally only akan dibayar dibayarkan").split(" "));
const CAP_PASSAGE_PHRASES=/\bin\s+advance\b|\(?\s*or\s+(?:its\s+)?equivalent\s+(?:in\s+any\s+other\s+)?currency\s*\)?|\bsubject\s+to\s+the\s+(?:terms\s+and\s+)?(?:provisions|conditions|terms)\s+of\s+this\s+(?:policy|rider|supplementary\s+agreement|contract)\b|\b(?:as|in)\s+(?:a|one)\s+(?:single\s+)?lump[\s-]sum\b|\b(?:payable\s+|paid\s+)?only\s+once\b|\bunder\s+this\s+(?:policy|rider|supplementary\s+agreement|contract|benefit)\b|\bor\b(?=[\s,]*whichever\s+is\s+(?:the\s+)?(?:lower|lesser|smaller|less)\b)|(?:,\s*)?\bwhichever\s+is\s+(?:the\s+)?(?:lower|lesser|smaller|less)\b/giu;
/** The share's own trigger when it names every covered condition, never one of them: "upon diagnosis of any one of the 27
 * conditions covered", "on the diagnosis of any of the covered illnesses". It narrows nothing, so it does not unsettle the
 * cap. A named condition, a person, a place or a time ("upon diagnosis of carcinoma in situ", "in the first year") is not
 * this phrase and still leaves the share unsure. */
const ANY_COVERED_CONDITION=/\b(?:up)?on\s+(?:the\s+)?diagnosis\s+of\s+any\s+(?:one\s+)?of\s+the\s+(?:\d{1,3}\s+)?(?:covered\s+)?(?:conditions|illnesses|diseases|critical\s+illnesses)(?:\s+covered)?\b/giu;
/** A pointer to where the covered illnesses are listed, or a survival or waiting period: neither bounds the amount
 * ("a Specified Illness listed in Schedule A", "subject to a survival period of 14 days", Critic R460). */
const HARMLESS_REFERENCE=/\b(?:as\s+)?(?:listed|set\s+out|described|defined|shown|named)\s+in\s+(?:the\s+)?(?:schedule|appendix|annex(?:ure)?|lampiran|jadual)(?:\s+[a-z0-9]{1,3})?\b|,?\s*\bsubject\s+to\s+(?:a|the)\s+(?:survival|waiting)\s+period\s+of\s+\d{1,4}\s+(?:days?|months?|hari|bulan)\b/giu;
const SUBJECT_TO_THE_POLICY=/\bsubject\s+to\s+the\s+(?:terms\s+and\s+)?(?:provisions|conditions|terms)(?:\s+and\s+conditions)?\s+of\s+this\s+(?:policy|rider|supplementary\s+agreement|contract)\b/giu;
const CAP_SCOPE_WORD=/^(?:total|aggregate|all|across|lifetime|combined|overall|child|children|adult|adults|juvenile|minor|plus|double|doubled|triple|half|halved|increase\w*|decrease\w*|reduc\w*|less|more|maximum|minimum|limit\w*|any|other|each)$/u;
/** "of the Sum Assured of this Basic Benefit": whose sum the share is of, said as the row's own kind. On a rider or
 * supplementary row only "this rider" or "this supplementary benefit" is its own: "this Plan" or "this Policy" there may be
 * the basic plan, whose sum is another (TE pr300 P1). On any other row, "this basic benefit", "this rider" or "this
 * supplementary benefit": a rider's row is often named for its benefit, so "this plan" may still be the basic plan (TE pr300
 * P1b) and stays in the passage, read as before. */
const RIDER_ROW=/\b(?:riders?|supplementary|add[- ]?on|tambahan)\b/iu;
function ownSumPhrase(benefitName:string|null|undefined){
  return RIDER_ROW.test(normalText(benefitName??""))
    ?/\bof\s+this\s+(?:rider|supplementary\s+benefit)\b/gu
    :/\bof\s+this\s+(?:basic\s+benefit|rider|supplementary\s+benefit)\b/gu;
}
function capPassageHarmless(rest:string,benefitName:string|null|undefined){
  // The name's words, but never one that scopes or changes a cap, whatever the name ("Total and Permanent Disability").
  const own=new Set(normalText(benefitName??"").split(/[^\p{L}]+/u).filter(w=>w&&!CAP_SCOPE_WORD.test(w)));
  const plain=normalText(rest).replace(CAP_PASSAGE_PHRASES," ");
  // On a rider, "of this Policy" or "this Plan" may be the basic plan's sum (TE pr300 P1).
  if(RIDER_ROW.test(normalText(benefitName??""))&&/\bthis\s+(?:basic\s+)?(?:policy|plan|benefit)\b/u.test(plain))return false;
  const words=plain.replace(ownSumPhrase(benefitName)," ").replace(ANY_COVERED_CONDITION," ").replace(/[,.;:()\-–—'’"“”]/g," ").split(/\s+/).filter(Boolean);
  return words.every(w=>CAP_PASSAGE_WORDS.has(w)||own.has(w));
}
const ORDINAL_CLAIM=/\b(?:additional|subsequent|further|first|second|later|next)\s+(?:claims?|events?|conditions?|diagnos[ie]s)\b/iu;
/** The row's own name printed at the start of its quote ("(a) Angioplasty and Other Invasive Treatment for Coronary Artery
 * 10% of …"): the label of the row, not words of its rule. Taken off only when the share follows it straight away, and
 * only a name with no figure and no word that changes an amount. */
const NAME_NAMES_A_LIMIT=/\b(?:limit(?:s|ed)?|max(?:imum|ima)?|maksimum|aggregate\w*|combined|shared?|within|caps?|capped|ceiling|up\s+to|lifetime|per|each|total|overall|annual\w*|yearly|year|sublimit\w*|across|all|min(?:imum)?|had|terhad|sehingga)\b/u;
/** "Minor" naming how severe a condition or procedure is ("Minor stroke", "Minor surgery"), never a child: a closed list of
 * what may follow it (TE pr353 gap 1). Anywhere else "minor" may be a person and still changes the share. */
const MINOR_CONDITION=/\bminor\s+(?=(?:stroke|surgery|surgeries|surgical|burns?|fractures?|injur(?:y|ies)|procedures?|operations?)\b)/giu;
/** Whether a name holds a word that changes the share once a "minor <condition>" is set aside. Any other person word left in
 * it ("for Minors", "child") keeps it (Critic M2 on #360). */
const minorChanges=(name:string)=>SHARE_CHANGER.test(name)&&(SHARE_CHANGER.test(name.replace(MINOR_CONDITION," "))||/\bminors?\b/u.test(name.replace(MINOR_CONDITION," ")));
function withoutLeadingName(quote:string,benefitName:string|null|undefined){
  const name=(benefitName??"").normalize("NFKC");
  // A name that itself changes an amount ("halved for children", "less any loan") stays in the passage and is read.
  if(!name||/[\p{Nd}\p{Sc}]/u.test(name)||minorChanges(normalText(name))||CHANGER_BEFORE_SHARE.test(normalText(name))
    // A name that names a limit or a scope ("Combined Limit with Surgery", "Lifetime Limit", "Benefit within Plan Limit")
    // may be what bounds the share, so it is read with the passage (TE pr234 D2).
    ||NAME_NAMES_A_LIMIT.test(normalText(name)))return quote;
  const words=name.match(/[\p{L}]+/gu);
  if(!words||words.length<2)return quote;
  const lead=new RegExp("^[^\\p{L}]*"+words.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("[^\\p{L}\\p{Nd}]+")+"[\\s:：\\-–—]*(?=\\p{Nd})","iu");
  const m=lead.exec(quote.normalize("NFKC"));
  return m?quote.normalize("NFKC").slice(m[0].length):quote;
}
/** A figure written twice, in words and then in brackets, as contracts in many markets print it: "one hundred percent
 * (100%)", "one (1) lump sum", "Twenty-Five Thousand Singapore Dollars (SGD 25,000)". Read once: the bracketed figure for a
 * share or an amount, the words for a count. Positive and whole-match: the words must spell exactly the bracketed number,
 * a share must be a share on both sides, and a named currency must be the bracket's own (a closed list); anything else is
 * left as printed, so it still counts as two figures and the share stays unsure. */
const NUMBER_WORDS:Record<string,number>={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,
  twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,
  fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
const SCALE_WORDS:Record<string,number>={hundred:100,thousand:1_000,million:1_000_000};
function spelledNumber(words:string):number|null{
  let total=0,part=0,any=false;
  for(const w of words.toLowerCase().split(/[\s-]+/u).filter(x=>x&&x!=="and")){
    if(w in NUMBER_WORDS){part+=NUMBER_WORDS[w];any=true;}
    else if(w==="hundred"){part=(part||1)*100;any=true;}
    else if(w in SCALE_WORDS){total+=(part||1)*SCALE_WORDS[w];part=0;any=true;}
    else return null;
  }
  return any?total+part:null;
}
const CURRENCY_NAMES:[RegExp,RegExp][]=[
  [/^singapore\s+dollars?$/u,/^(?:sgd|s\$)$/u],[/^(?:malaysian\s+)?ringgit(?:\s+malaysia)?$/u,/^(?:myr|rm)$/u],
  [/^(?:us|united\s+states)\s+dollars?$/u,/^(?:usd|us\$)$/u],[/^hong\s+kong\s+dollars?$/u,/^(?:hkd|hk\$)$/u],
  [/^(?:pounds?(?:\s+sterling)?|british\s+pounds?)$/u,/^(?:gbp|£)$/u],[/^euros?$/u,/^(?:eur|€)$/u],
];
const NUMBER_WORD_SOURCE="(?:"+[...Object.keys(NUMBER_WORDS),...Object.keys(SCALE_WORDS),"and"].join("|")+")";
const WORDS_THEN_FIGURE=new RegExp(String.raw`\b((?!and\b)${NUMBER_WORD_SOURCE}(?:[\s-]+${NUMBER_WORD_SOURCE})*)(\s+(?:per\s?cent|percent))?((?:\s+\p{L}+){0,3}?)\s*\(\s*((?:sgd|myr|usd|hkd|gbp|eur|rm|s\$|us\$|hk\$|£|€)\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?\s*(%)?\s*\)`,"giu");
export function figureOnce(text:string):string{
  return text.normalize("NFKC").replace(WORDS_THEN_FIGURE,(whole,words:string,percent:string|undefined,named:string,sign:string|undefined,figure:string,cents:string|undefined,mark:string|undefined)=>{
    const spelled=spelledNumber(words.trim());
    if(spelled==null||spelled!==Number(figure.replace(/,/g,""))||(cents&&cents!=="00")||!!percent!==!!mark)return whole;
    const name=named.trim().toLowerCase();
    if(name){
      if(!sign||!CURRENCY_NAMES.some(([n,c])=>n.test(name)&&c.test(sign.trim().toLowerCase())))return whole;
      return sign.trim()+" "+figure+(cents?"."+cents:"");
    }
    if(sign)return whole;
    return mark?figure+"%":words;
  });
}
/** A share spelled in words whose bracketed figure is another ("fifty percent (100%)"): which one is meant is not known. */
function spelledShareDisagrees(text:string){
  for(const m of text.normalize("NFKC").matchAll(WORDS_THEN_FIGURE)){
    if(!m[2]&&!m[7])continue;
    const spelled=spelledNumber(m[1].trim());
    if(spelled!=null&&spelled!==Number(m[5].replace(/,/g,"")))return true;
  }
  return false;
}
export function shareBound(quote:string|null|undefined,benefitName?:string|null):ShareBound{
  if(spelledShareDisagrees(quote??""))return {kind:"unsure"};
  const text=withoutLeadingName(figureOnce(quote??""),benefitName);
  // "subject to the terms and conditions of this policy" refers to the whole policy, not to a cap (TE pr222 S15).
  const plain=normalText(text).replace(SUBJECT_TO_THE_POLICY," ").replace(HARMLESS_REFERENCE," ").replace(ILLNESS_NUMBER,"$1$2");
  if(!printsAnAmount(plain))return shareStandsAlone(plain,benefitName)?{kind:"none"}:{kind:"unsure"};
  const cap=shareCapInPassage(text);
  if(!cap||!cap.currency||cap.shares!==1)return {kind:"unsure"};
  // The cap is in the share's own sentence: "Ambulance fees up to S$500." after it is another benefit's (R416 M1).
  const [from,to]=cap.shareAt<cap.capAt?[cap.shareAt,cap.capAt]:[cap.capAt,cap.shareAt];
  // A line wrapped inside the sentence is no break (TE pr353 gap 2): "Sum" wrapped before "Assured" or "Insured", or a new
  // line that goes on with "or", "up to" or "whichever". Any other line break between them may start another row.
  if(/[.;!?](?:\s|$)|\n/.test(softWraps(text.normalize("NFKC")).slice(from,to)))return {kind:"unsure"};
  // "per additional claim", "for the first claim": another claim may be paid by a different rule (Critic R428).
  if(!capPassageHarmless(cap.rest,benefitName)||ORDINAL_CLAIM.test(cap.rest))return {kind:"unsure"};
  return {kind:"cap",amount:cap.amount,currency:cap.currency};
}
/** Line breaks that only wrap one sentence, each turned into a space so positions hold: a closed list of continuations,
 * never a break before another row's label. */
// The continuation must start in lower case, or follow a comma: a capitalised "Up to S$500" line may be the next row's value
// under this row's share, where labels and values were read column by column (Critic M1 on #360).
const softWraps=(s:string)=>s.replace(/(?<=\bsum[ \t]*)\n(?=[ \t]*(?:assured|insured)\b)/giu," ").replace(/\n(?=[ \t]*(?:or|up[ \t]+to|whichever)\b)/gu," ")
  .replace(/(?<=,[ \t]*)\n(?=[ \t]*(?:or|up[ \t]+to|whichever)\b)/giu," ");
export const shareCapNote=(amount:number,currency:string)=>"Paid up to "+formatMoney(amount,currency)+", the cap this passage prints.";
/** A rule the document states in a sentence rather than in a table cell.
 *
 * "Receive 150% of your coverage amount if Total and Permanent Disability is
 * due to an accident." "S$30 per day Hospital Cash Benefit is payable from the
 * 11th to the 40th day." Both state a complete rule, and both were stored with
 * no rule at all, because the reader looks for a figure in a column and these
 * are prose. So the quote is read for a rule directly -- and the proposal is
 * then put through exactly the same validator as the model's own, which is
 * what keeps this from becoming a second, looser way in.
 */
export function ruleFromQuote(benefit:CatalogBenefit):ReviewedFormula|null{
  if(benefit.formulaKind!=="none")return null;
  // A schedule term is never turned into a payout rule.
  if(isScheduleTerm(benefit.rowKind))return null;
  const quote=figureOnce(benefit.quote??"");
  const text=normalText(quote);
  const propose=(input:Parameters<typeof validateCatalogFormula>[0])=>{
    const read=validateCatalogFormula({...input,benefitName:benefit.benefitName});
    return read.formulaKind==="none"?null:read;
  };
  if(prevailingNotProved(text,benefit.benefitName))return null;
  const percentage=text.match(new RegExp("(\\d+(?:\\.\\d+)?)\\s*%\\s*(?:of\\s*)?(?:the\\s+|your\\s+)?(?:"+PREVAILING+")?"+INSURED_AMOUNT))?.[1];
  if(percentage)return propose({kind:"sum_insured",value:Number(percentage)/100,currency:benefit.currency,
    quote,factKey:null,offsetDays:null,maximumDays:null});
  const worded=WORD_FRACTIONS.find(entry=>
    new RegExp("\\b"+entry.words+"\\b\\s*(?:of\\s*)?(?:the\\s+|your\\s+)?"+INSURED_AMOUNT).test(text));
  if(worded)return propose({kind:"sum_insured",value:worded.value,currency:benefit.currency,
    quote,factKey:null,offsetDays:null,maximumDays:null});
  const perDay=quote.match(/(?:s\$|sgd|usd|us\$|\$)\s*([\d,]+(?:\.\d+)?)\s*(?:per day|daily|a day)/i)?.[1];
  if(perDay&&/hospital|confine|ward|inpatient|in-patient|stay/i.test(quote))
    return propose({kind:"daily",value:Number(perDay.replace(/,/g,"")),currency:benefit.currency,
      quote,factKey:"hospitalNights",offsetDays:null,maximumDays:null});
  return null;
}
/** Everything the stored rules can settle about themselves, without reading a
 * document again: a certificate's cover line is not a benefit, a percentage
 * scale is resolved against the limit the documents imply, a rule two
 * documents state identically needs no confirming, a scale that runs the wrong
 * way is held back, and a rule stated in a sentence is read from that
 * sentence. */
export function repairStoredRules(benefits:CatalogBenefit[]):CatalogBenefit[]{
  // A row named only by a plan's empty cell is dropped here too; the not-a-benefit shapes (readsAsNoBenefit) are hidden
  // only on the Benefits page.
  return resolveStoredRules(benefits.filter(benefit=>!looksLikeCoverageLine(benefit.benefitName)&&!namesNoBenefit(benefit.benefitName)&&!namesOnlyAPlanCell(benefit.benefitName,benefit.quote)))
    .map(benefit=>{
      // A stored share whose passage also prints an amount is withheld when read, unless a person confirmed it.
      const bound=benefit.formulaKind==="sum_insured"&&!benefit.reviewedAt?shareBound(benefit.quote,benefit.benefitName):{kind:"none" as const};
      if(bound.kind==="unsure")
        return {...benefit,formulaKind:"none" as const,formulaValue:null,conditions:[...new Set([...benefit.conditions,CAPPED_SHARE_NOTE])]};
      if(bound.kind==="cap")return {...benefit,conditions:[...new Set([...benefit.conditions,shareCapNote(bound.amount,bound.currency)])]};
      // A row held for its plan columns, or one stored with no figure whose quote prints one per plan, is never read
      // again from that quote: the sentence names a figure for every plan, and which is the household's is not known
      // (Critic R351 H1).
      if(benefit.conditions.includes(PLAN_COLUMNS_NOTE)||(!benefit.tier&&!benefit.reviewedAt&&figuresDifferByPlan(benefit.quote)))return benefit;
      const read=ruleFromQuote(benefit);
      const out=read?{...benefit,...read,conditions:[...new Set([...benefit.conditions,
        "DearPolicy read this rule from the sentence quoted"+onPage(benefit.sourcePage)
        +" rather than from a table, and checked it against that sentence before using it."])]}:benefit;
      return out.formulaKind==="sum_insured"&&PREVAILING_AMOUNT.test(normalText(out.quote??""))
        ?{...out,conditions:[...new Set([...out.conditions,PREVAILING_NOTE])]}:out;
    });
}
export function validateCatalogFormula(input:{
  kind:string;value:number|null;currency:string|null;quote:string;
  factKey:string|null;offsetDays:number|null;maximumDays:number|null;coverageCurrency?:string|null;benefitName?:string|null;
}):Pick<CatalogBenefit,"formulaKind"|"formulaValue"|"currency"|"factKey"|"offsetDays"|"maximumDays">{
  const none={formulaKind:"none" as const,formulaValue:null,currency:null,factKey:null,offsetDays:null,maximumDays:null};
  // A figure printed in words and again in brackets is read once (figureOnce).
  input={...input,quote:figureOnce(input.quote)};
  const quote=normalText(input.quote);
  const value=input.value;
  if(input.kind==="none"||value==null||!Number.isFinite(value)||value<0)return none;
  if(input.kind==="sum_insured"&&shareBound(input.quote,input.benefitName).kind==="unsure")return none;
  // The currency is what the quoted clause writes. A sum-insured percentage
  // quotes none -- it is paid in the cover's own currency, which is verified
  // against the personal schedule when used. Nothing is defaulted to SGD, and
  // a currency supplied by the reader but absent from the quote is not proof.
  const quoted=explicitCurrency(input.quote);
  const declared=input.currency?normalizeCurrencyCode(input.currency)||null:null;
  if(quoted&&declared&&quoted!==declared)return none;
  const currency:string|null=quoted??(input.kind==="sum_insured"&&input.coverageCurrency?normalizeCurrencyCode(input.coverageCurrency)||null:null);
  if(input.kind==="sum_insured"){
    // A choice of the lower that belongs to a printed cap ("or RM5,000, whichever is lower") is read by shareBound.
    const bound=shareBound(input.quote,input.benefitName);
    // The cap's own choice of the lower ("or up to S$30,000, whichever is lower", "whichever is less") is that cap, never a
    // word that changes the share: only the words left once it is taken out are read (FWD pre-check, 5 Nov).
    if(/\b(?:less|minus|greater|lower|bonus|previous|deduct|reduced)\b/.test(bound.kind==="cap"?normalText(shareCapInPassage(input.quote)?.rest??"").replace(CAP_PASSAGE_PHRASES," "):quote))return none;
    if(prevailingNotProved(quote,input.benefitName))return none;
    const percentage=quote.match(new RegExp("(\\d+(?:\\.\\d+)?)\\s*%\\s*(?:of\\s*)?(?:the\\s+|your\\s+)?(?:relevant\\s+|applicable\\s+)?(?:"+PREVAILING+")?"+INSURED_AMOUNT))?.[1];
    const full=new RegExp("\\b(?:pay|pays|payable)\\b[^.;]{0,100}\\b(?:the |relevant |full |applicable |your )*"+INSURED_AMOUNT).test(quote);
    // "One twelfth of Sum Insured" is a rule stated in words. It is as provable
    // from the quote as "8.33%" would be, and refusing it left a disability
    // benefit with no amount at all.
    const worded=WORD_FRACTIONS.find(entry=>
      new RegExp("\\b"+entry.words+"\\b\\s*(?:of\\s*)?(?:the\\s+|your\\s+)?"+INSURED_AMOUNT).test(quote));
    if(worded)return Math.abs(worded.value-value)<0.0005
      ?{formulaKind:"sum_insured",formulaValue:worded.value,currency,factKey:null,offsetDays:null,maximumDays:null}:none;
    if(percentage?Number(percentage)/100!==value:!full||value!==1)return none;
    return {formulaKind:"sum_insured",formulaValue:value,currency,factKey:null,offsetDays:null,maximumDays:null};
  }
  if(!numericTokens(quote).includes(String(value)))return none;
  // The printed figure is read whole and in its own grouping, so "€50.000" proves fifty thousand and never fifty.
  const money=quote.match(new RegExp(String.raw`\b(?:sgd|usd|myr|php|eur|gbp)\s*(${PRINTED_FIGURE})${FIGURE_END}${NO_SCALE_AFTER}|(?:s\$|us\$|\$|€|£)\s*(${PRINTED_FIGURE})${FIGURE_END}${NO_SCALE_AFTER}`,"iu"));
  if(!money||printedNumber(money[1]??money[2],null,{lakh:groupsInLakhs(quote)})!==value)return none;
  if(input.kind==="fixed"){
    if(/\bup to\b|maximum|limit|cap|per day|daily|reimburs|expense|actual cost/.test(quote))return none;
    if(!/\b(?:pay|pays|payable|benefit)\b/.test(quote))return none;
    return {formulaKind:"fixed",formulaValue:value,currency,factKey:null,offsetDays:null,maximumDays:null};
  }
  if(input.kind==="expense_cap"){
    if(!/reimburs|expense|actual cost|cost incurred/.test(quote))return none;
    if(!/\bup to\b|maximum|limit/.test(quote)||!input.factKey)return none;
    const nouns=input.factKey.replace(/([a-z])([A-Z])/g,"$1 $2").toLowerCase().split(/[^a-z0-9]+/)
      .filter(word=>word.length>=3&&!/^(?:bill|expense|cost|amount|total)$/.test(word));
    if(!nouns.length||!nouns.some(noun=>quote.includes(noun)))return none;
    return {formulaKind:"expense_cap",formulaValue:value,currency,factKey:input.factKey,offsetDays:null,maximumDays:null};
  }
  if(input.kind==="daily"){
    if(!/\bper day\b|\bdaily\b/.test(quote)||!input.factKey)return none;
    const after=quote.match(/after (?:the )?(\d+)(?:th|st|nd|rd)? (?:day|days)/)?.[1];
    const from=quote.match(/(?:from|starting (?:on )?) (?:the )?(?:day )?(\d+)(?:th|st|nd|rd)?/)?.[1];
    const cap=quote.match(/(?:max(?:imum)?(?: of)?|up to|not exceed)\s*(\d+)\s*(?:continuous |consecutive |payable )?days/)?.[1];
    // "payable from the 11th to the 40th day" states both ends of the scale at
    // once: it starts after ten days and runs for thirty. Read as an open
    // "from the 11th day", it had no limit and no figure could be given.
    const range=quote.match(/\bfrom (?:the )?(\d+)(?:st|nd|rd|th)?(?: day)? (?:to|until|through|up to) (?:the )?(\d+)(?:st|nd|rd|th)?(?: day)?/);
    const offset=after?Number(after):from?Number(from)-1:null;
    if(range){
      const first=Number(range[1]),last=Number(range[2]);
      if(last>=first&&first>=1)
        return {formulaKind:"daily",formulaValue:value,currency,factKey:input.factKey,offsetDays:first-1,maximumDays:last-first+1};
    }
    if(offset==null||cap==null)return none;
    return {formulaKind:"daily",formulaValue:value,currency,factKey:input.factKey,offsetDays:offset,maximumDays:Number(cap)};
  }
  return none;
}

// ---------------------------------------------------------------------------
// Showing a rule back to the person, and letting them correct it.
//
// Extraction will never be perfect. What makes that acceptable is that every
// stored rule is visible in plain English and a person can fix it once, for
// good. A human-corrected row is authoritative: it is checked for internal
// coherence only, never against the quoted wording, because the person reading
// their own policy outranks the parser.
// ---------------------------------------------------------------------------

/** What a reported fact is called in a sentence a non-specialist reads. */
const FACT_LABELS:Record<string,string>={
  hospitalNights:"nights in hospital",hospitalBill:"hospital bill",ambulanceBill:"ambulance bill",
  vehicleRepairBill:"vehicle repair bill",outOfPocket:"out-of-pocket medical costs",
};
export function factKeyLabel(key:string|null|undefined){
  if(!key)return "the reported amount";
  return FACT_LABELS[key]??key.replace(/([a-z])([A-Z])/g,"$1 $2").toLowerCase();
}
/** Which reported facts each rule can be measured against. The schedule screen
 * offers exactly these, so a person can never bind a rule to a fact the claim
 * engine does not collect. */
export const EXPENSE_FACT_KEYS=["hospitalBill","ambulanceBill","vehicleRepairBill","outOfPocket"] as const;
export const DAILY_FACT_KEYS=["hospitalNights"] as const;

/** One sentence saying what this benefit pays. Used on the schedule screen and
 * anywhere a rule is shown without a claim in progress. */
/** Whether a row read from one column of a multi-column table applies to a
 * person whose plan tier / person class is `memberTier`
 * (policy_members.benefit_tier: "Plan A", "Child", "Dependants", "Adult").
 * A row with no tier applies to everyone; a person whose tier is unknown is
 * not narrowed (every column stays a candidate). The column heading may carry
 * more words than the stored class ("Plan A (Grade M2 and above)",
 * "Dependants (Plan A only)"). */
export function tierApplies(rowTier:string|null|undefined,memberTier:string|null|undefined){
  if(!rowTier||!memberTier)return true;
  const row=rowTier.toLowerCase().replace(/\s+/g," ").trim(),member=memberTier.toLowerCase().replace(/\s+/g," ").trim();
  return row===member||(row.startsWith(member)&&!/[a-z0-9]/.test(row.charAt(member.length)));
}
/** The rows of a document that apply to one person, given their tier.
 * Tiers are per table: the columns of one row (same document, benefit name
 * and page) are alternatives, and when one of them is the person's column the
 * others are dropped. A row whose columns are a different dimension (a
 * rider's "Panel" / "Non-panel" for a "Private hospital" member) is kept
 * whole, and so is everything when the person's tier is unknown. */
export function selectTierRows<T extends {policyId:string;benefitName:string;sourcePage:number|null;tier?:string|null}>(rows:T[],memberTier:(policyId:string)=>string|null|undefined):T[]{
  const groups=new Map<string,T[]>();
  for(const row of rows){const key=row.policyId+"|"+row.benefitName.toLowerCase()+"|"+(row.sourcePage??"");groups.set(key,[...(groups.get(key)??[]),row]);}
  const keep=new Set<T>();
  for(const group of groups.values()){
    const tier=memberTier(group[0].policyId);
    const mine=tier?group.filter(row=>row.tier&&tierApplies(row.tier,tier)):[];
    for(const row of group)if(!mine.length||!row.tier||mine.includes(row))keep.add(row);
  }
  return rows.filter(row=>keep.has(row));
}
/** Kinds of table row that are schedule terms, not payout rules. */
export const SCHEDULE_TERM_KINDS=["as_charged","not_covered","unlimited","deductible","co_insurance","co_payment","co_payment_cap","pro_ration","policy_year_limit","family_limit"] as const;
export function isScheduleTerm(rowKind:string|null|undefined){return !!rowKind&&(SCHEDULE_TERM_KINDS as readonly string[]).includes(rowKind);}
/** A schedule term as a sentence. The stored value is shown, never used to
 * calculate a claim amount here. */
/** The period a limit's own printed words give it: "a policy year" only where they say so (FWD re-read 5 Nov: an "Overall
 * limit" printed "per insured person per trip" was shown as a limit a policy year). */
function limitPeriod(words:string|null|undefined):string|null{
  const w=(words??"").toLowerCase();
  const trip=/\bper\s+(?:insured\s+person\s+per\s+)?(?:trip|journey)\b|\b(?:each|every)\s+(?:trip|journey)\b/.test(w);
  const year=/\bpolicy[-\s]year\b|\bper\s+(?:annum|year)\b|\bannual\b|\byearly\b|\b(?:each|every)\s+year\b/.test(w);
  if(trip&&year)return null;
  if(trip)return " a trip";
  return year?" a policy year":null;
}
export function describeScheduleTerm(rowKind:string,value:number|null,currency:string|null,words?:string|null){
  const money=value==null?null:(currency?currency+" ":"")+value.toLocaleString("en-SG",{maximumFractionDigits:2});
  const percent=value==null?null:Math.round(value*10000)/100+"%";
  switch(rowKind){
    case "as_charged":return "As charged: the actual bill, within the plan's limits";
    case "not_covered":return "Not covered";
    case "unlimited":return "No limit stated";
    case "deductible":return money?"Deductible of "+money+" (you pay this first)":"Deductible (see the schedule)";
    case "co_insurance":return percent?"Co-insurance of "+percent+" of the bill after the deductible":"Co-insurance (see the schedule)";
    case "co_payment":return money?"Co-payment of "+money:percent&&value!=null&&value<=1?"Co-payment of "+percent:"Co-payment (see the schedule)";
    case "co_payment_cap":return money?"Your co-payment is capped at "+money+" a policy year":"Co-payment cap (see the schedule)";
    case "pro_ration":return percent?"Pro-ration: pays "+percent+" of the bill in a higher ward than covered":"Pro-ration (see the schedule)";
    case "policy_year_limit":{
      // Without the printed words (an older caller), the row kind's own name stands.
      const period=words==null?" a policy year":limitPeriod(words);
      return money?"Limit of "+money+(period??""):period===" a policy year"?"Policy-year limit (see the schedule)":"Limit (see the schedule)";
    }
    case "family_limit":return money?"Family maximum of "+money:"Family maximum (see the schedule)";
    default:return "As printed in the schedule";
  }
}
/** What a benefit pays, in words and without any figure (a claim card never
 * shows an amount before the claim evidence is reviewed). */
export function whatItPays(benefit:Pick<CatalogBenefit,"formulaKind"|"quote">){
  if(/\bas charged\b/i.test(benefit.quote))return "Pays as charged";
  switch(benefit.formulaKind){
    case "daily":return "Pays a set amount for each day in hospital";
    case "expense_cap":return "Reimburses the actual cost, up to the limit in the policy";
    case "fixed":return "Pays a set amount";
    case "sum_insured":return "Pays a share of the sum insured";
    default:return "Listed in the policy";
  }
}
/** A benefit written for one particular kind of treatment or place (kidney
 * dialysis, cancer drugs, maternity, dental, treatment overseas) does not
 * respond to an event that names none of them: a broken arm in Singapore is
 * never a dialysis or an overseas-treatment claim. */
const SPECIFIC_BENEFITS:[RegExp,RegExp][]=[
  [/dialysis|\bkidney\b|\brenal\b/i,/dialysis|kidney|renal/i],
  [/cancer|chemo|radiother|oncolog/i,/cancer|tumou?r|chemo|radiother|oncolog|carcinoma|leuk(?:a|ae)mia|lymphoma|malignan/i],
  [/transplant/i,/transplant/i],
  [/\bcovid/i,/\bcovid|coronavirus/i],
  [/psychiatr|mental/i,/psychiatr|mental|depress|anxiety/i],
  [/maternity|pregnan|childbirth|newborn/i,/pregnan|maternity|birth|baby|deliver/i],
  [/\bdental\b|\bteeth\b/i,/dental|tooth|teeth/i],
  [/\bhiv\b/i,/\bhiv\b|\baids\b/i],
  [/overseas|abroad|evacuat|repatriat/i,/overseas|abroad|trip|travel|holiday|evacuat|repatriat/i],
];
export function benefitIsForAnotherKindOfEvent(benefitName:string,eventText:string){
  return SPECIFIC_BENEFITS.some(([row,event])=>row.test(benefitName)&&!event.test(eventText));
}
export function describeBenefitFormula(benefit:Pick<CatalogBenefit,"formulaKind"|"formulaValue"|"currency"|"factKey"|"offsetDays"|"maximumDays">
  &Partial<Pick<CatalogBenefit,"quote"|"benefitName"|"reviewedAt">>){
  const currency=benefit.currency?normalizeCurrencyCode(benefit.currency)||null:null;
  const value=benefit.formulaValue;
  const money=(amount:number,code:string|null)=>code?formatMoney(amount,code):amount.toLocaleString("en-US")+" (currency not stated in the policy wording)";
  if(benefit.formulaKind==="sum_insured"&&value!=null){
    // A share its passage caps is said with the cap in the same line: "20% of the sum insured" alone reads as 20% of a
    // large plan, when the passage pays at most its printed cap (the same cap assessCatalogBenefit pays up to).
    const bound=benefit.reviewedAt||benefit.quote==null?{kind:"none" as const}:shareBound(benefit.quote,benefit.benefitName);
    // A share paid every month says so ("One twelfth of Sum Insured" under "Monthly Disability Income"): read as one
    // payment it understated a monthly income. Only when the row's own words say monthly (paidMonthly fails closed).
    const monthly=paidMonthly(benefit.benefitName,benefit.quote);
    return (Math.round(value*1000)/10)+"% of the sum insured on your schedule"+(monthly?", paid each month":"")+(bound.kind==="cap"?", up to "+formatMoney(bound.amount,bound.currency):"")+(bound.kind==="cap"&&monthly?" a month":"");
  }
  if(benefit.formulaKind==="fixed"&&value!=null)
    return money(value,currency)+(paidMonthly(benefit.benefitName,benefit.quote)?" a month":"");
  if(benefit.formulaKind==="expense_cap"&&value!=null)
    return "Reimburses "+(benefit.factKey?"the ":"")+factKeyLabel(benefit.factKey)+", up to "+money(value,currency);
  if(benefit.formulaKind==="daily"&&value!=null){
    const after=benefit.offsetDays?" after the first "+benefit.offsetDays+" day"+(benefit.offsetDays===1?"":"s"):"";
    const cap=benefit.maximumDays!=null?", up to "+benefit.maximumDays+" days":"";
    return money(value,currency)+" per day"+after+cap;
  }
  // A benefit whose passage prints no amount at all is named, not unreadable: there is nothing for the person to tell.
  // Its amount may be printed elsewhere (a schedule on another page), so the line says only what this passage shows.
  if(benefit.formulaKind==="none"&&benefit.quote!=null&&!printsAmount(benefit.quote))
    return pointsElsewhere(benefit.quote)?"No amount printed beside it here; check the schedule":"Named in the policy; no amount is printed beside it here";
  return "Not yet readable — tell DearPolicy what this pays";
}
export type ReviewedFormula=Pick<CatalogBenefit,"formulaKind"|"formulaValue"|"currency"|"factKey"|"offsetDays"|"maximumDays">;
/** Accepts a rule a person typed after reading their own policy.
 *
 * It rejects only rules the claim engine could not compute — a daily benefit
 * with no day cap would silently pay forever, a reimbursement bound to no
 * reported cost can never be measured. It deliberately does NOT check the
 * quote: the person is the authority here, not the parser. */
export function reviewedBenefitFormula(input:{kind:string;value:number|null;currency:string|null;factKey:string|null;offsetDays:number|null;maximumDays:number|null}):
  {ok:true;formula:ReviewedFormula}|{ok:false;error:string}{
  const kind=input.kind as CatalogFormulaKind;
  if(kind==="none")return {ok:true,formula:{formulaKind:"none",formulaValue:null,currency:null,factKey:null,offsetDays:null,maximumDays:null}};
  const value=input.value;
  if(value==null||!Number.isFinite(value)||value<=0)return {ok:false,error:"Enter an amount greater than zero."};
  const currency=input.currency?normalizeCurrencyCode(input.currency)||null:null;
  if(kind!=="sum_insured"&&!currency)return {ok:false,error:"Choose the currency your policy states for this amount."};
  if(kind==="sum_insured"){
    if(value>2)return {ok:false,error:"A percentage of the sum insured cannot be more than 200%."};
    return {ok:true,formula:{formulaKind:"sum_insured",formulaValue:value,currency,factKey:null,offsetDays:null,maximumDays:null}};
  }
  if(kind==="fixed")
    return {ok:true,formula:{formulaKind:"fixed",formulaValue:value,currency,factKey:null,offsetDays:null,maximumDays:null}};
  if(kind==="expense_cap"){
    if(!input.factKey||!(EXPENSE_FACT_KEYS as readonly string[]).includes(input.factKey))
      return {ok:false,error:"Choose which cost this limit applies to."};
    return {ok:true,formula:{formulaKind:"expense_cap",formulaValue:value,currency,factKey:input.factKey,offsetDays:null,maximumDays:null}};
  }
  if(kind==="daily"){
    const offset=input.offsetDays??0;
    if(!Number.isInteger(offset)||offset<0)return {ok:false,error:"The waiting period must be a whole number of days, or zero."};
    if(input.maximumDays==null||!Number.isInteger(input.maximumDays)||input.maximumDays<1)
      return {ok:false,error:"A daily benefit needs a maximum number of days, otherwise it would pay without end."};
    const factKey=input.factKey&&(DAILY_FACT_KEYS as readonly string[]).includes(input.factKey)?input.factKey:"hospitalNights";
    return {ok:true,formula:{formulaKind:"daily",formulaValue:value,currency,factKey,offsetDays:offset,maximumDays:input.maximumDays}};
  }
  return {ok:false,error:"That is not a payout rule DearPolicy can calculate."};
}

// ---------------------------------------------------------------------------
// Storage. The catalogue is derived data: rebuilding it never touches uploaded
// documents, confirmed coverage or anything the user typed.
// ---------------------------------------------------------------------------
import { query } from "@/lib/db/client";
import { pool } from "@/lib/db/client";
import { readFile } from "node:fs/promises";
import { additiveSchemaInPlace } from "@/lib/db/additive-schema";
import path from "node:path";

type CatalogGlobals={__dearpolicyBenefitSchema?:Promise<void>};
/** Applies the catalogue's own schema before it is used.
 *
 * Without this, upgrading the app would break indexing until the person
 * happened to run a setup script — the failure would land on their next upload,
 * which is exactly the moment it must not. Every statement is idempotent. */
export async function ensureBenefitSchema(){
  const state=globalThis as CatalogGlobals;
  state.__dearpolicyBenefitSchema??=(async()=>{
    const sql=await readFile(path.join(process.cwd(),"sql/benefit-catalog.sql"),"utf8");
    const client=await pool.connect();
    try{
      // Already in place: nothing is run, so no table lock is taken (lib/db/additive-schema.ts).
      if(await additiveSchemaInPlace(client,sql))return;
      await client.query("BEGIN");
      // Serialise the migration across requests without holding a lasting lock.
      await client.query("SELECT pg_advisory_xact_lock(73499202)");
      await client.query(sql);
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}
    finally{client.release();}
  })().catch(error=>{delete state.__dearpolicyBenefitSchema;throw error;});
  await state.__dearpolicyBenefitSchema;
}

type BenefitRow={
  id:string;policy_id:string;product_name:string|null;benefit_name:string;traits:string[];requires?:string[];
  formula_kind:string;formula_value:string|number|null;currency:string|null;fact_key:string|null;
  offset_days:number|null;maximum_days:number|null;source_page:number|null;quote:string;
  conditions:unknown;requirements:unknown;needs_review:boolean;
  basis_inferred?:boolean;needs_confirmation?:boolean;reviewed_at?:string|null;
  tier?:string|null;row_kind?:string|null;
};
function toBenefit(row:BenefitRow):CatalogBenefit{
  const value=row.formula_value==null?null:Number(row.formula_value);
  return {id:row.id,policyId:row.policy_id,productName:row.product_name,benefitName:row.benefit_name,
    traits:(Array.isArray(row.traits)?row.traits:[]) as ScenarioTrait[],
    requires:(Array.isArray(row.requires)?row.requires:[]) as ScenarioTrait[],
    formulaKind:(["none","sum_insured","fixed","expense_cap","daily"].includes(row.formula_kind)?row.formula_kind:"none") as CatalogFormulaKind,
    formulaValue:value!=null&&Number.isFinite(value)?value:null,
    currency:row.currency,factKey:row.fact_key,offsetDays:row.offset_days,maximumDays:row.maximum_days,
    sourcePage:row.source_page,quote:row.quote,
    conditions:Array.isArray(row.conditions)?row.conditions.map(String):[],
    requirements:Array.isArray(row.requirements)?row.requirements as CatalogBenefit["requirements"]:[],
    needsReview:row.needs_review,basisInferred:row.basis_inferred===true,needsConfirmation:row.needs_confirmation===true,reviewedAt:row.reviewed_at??null,
    tier:row.tier??null,rowKind:row.row_kind??null};
}
/** A line from a certificate's cover table is not a benefit.
 *
 * A certificate prints one row per person per plan: an identity number, a name,
 * a plan, an amount. The table parser reads those rows like any other table, so
 * they were stored as benefits whose NAME is a masked NRIC and a person -- and
 * a row called "S****123A Lim Mei Ling GROUP PERSONAL ACCIDENT (POLICY
 * NO. 1234567)" carrying S$1,000,000 was then matched to a claim by the word
 * "accident" in it, and paid.
 *
 * Those amounts belong in the coverage ledger, where they already are. A rule
 * about what a plan PAYS never names a person and never carries an identity
 * number, so this is deterministic and safe to apply to rows already stored:
 * they stop being used without anything needing to be read again.
 */
export function looksLikeCoverageLine(benefitName:string){
  const name=(benefitName??"").trim();
  if(!name)return true;
  if(/\bpolic(?:y|ies)\s*(?:no|number)\b/i.test(name))return true;
  // A masked identity number ("S****567D") or a full one.
  if(/[A-Z]\s*\*{2,}\s*\d{2,}\s*[A-Z]/i.test(name))return true;
  if(/\b[STFGM]\d{7}[A-Z]\b/i.test(name))return true;
  return false;
}
/** A stored benefit "name" that names nothing: a cell of a table read as a row of its own. Seen in read documents: an
 * illustration's projected values ("273,411"), a header's ordinal suffixes ("nd", "3rd"), a list marker ("(a)"), a
 * year from a payout-by-year table ("2027" paying "S$717"), "N/A", and the tail of a wrapped line ("only" up to S$100,
 * "and Merdeka" S$448.23, "percent (20%) of the surface of the Life"). Shown, they are headings on the Benefits page and
 * amounts chat can cite for a benefit nobody can identify. Used when rows are read back, never at intake: a row this
 * hides is still stored, so a name it wrongly hides comes back when the rule is corrected.
 * When unsure, the name is kept. It is kept when it carries a letter run of three or more ("Décès"), two in a script other than Latin ("身故",
 * "입원"), or a capitalised short form of two or more letters ("CI", "A&E", "TI/CI"), once list markers, figures,
 * ordinals, money and empty-cell words are taken out. A name is a piece of a sentence only when a lower-case joining
 * word is followed (or preceded) by a space, so "in-patient treatment" and "up-front cash" are kept. */
const JOINING_START=/^(?:and|or|but|only|of|the|to|for|with|by|in|on|at|percent|plus|less|including|which|that|if|as|from|up|dan|atau|untuk|termasuk|sahaja|nd|rd|st|th)(?:\s|$)/u;
const JOINING_END=/(?:^|\s)(?:and|or|of|the|to|for|with|by|a|an|dan|atau|untuk)\s*$/u;
const EMPTY_CELL=/^(?:n\/a|nil|not applicable|tba|tbc|as charged|-+|—)$/i;
const MONEY_OR_FIGURE=/\((?:[a-z]|[ivx]{1,4})\)|\bN\/A\b|(?:\b(?:SGD|USD|MYR|GBP|RM)\s*|S\$|US\$|£|\$)?\s*\d[\d,.]*(?:%|st|nd|rd|th)?/giu;
/** A stored row whose own words show it is not a benefit at all, read from a page of an investment-linked plan or a
 * page's footer. Each is an allow-list of the whole row's shape, name and quote together, so a benefit that mentions a
 * fund's value, a share or a page count is kept (Critic R393 H1, TE pr201 round 2):
 * - a fund's charge: the name is a fund ("AIA Regional Fixed Income Fund") and the quote is that name, then only its
 *   charge "0.85% (max 2.50%) p.a. of its Net Asset Value";
 * - an asset-class row of a fund's mix: the name is an asset class other than cash or property (both are also benefits),
 *   then only three or more percentages ("Fixed Income 65.0% 58.0% 72.0% 70.3%");
 * - an illustration's footer: a known footer sentence with no figure, then only its page count and reference.
 * Shown rows only: the Benefits route hides them, and claim answers and the ledger read the stored rows as before. */
const FUND_NAME=/^(?!.*\b(?:bonus|benefit|payout|reward|pays?|payable|income\s+benefit)\b)[A-Za-z][\w&'().,\- ]{2,80}\bfund$/i;
const FUND_CHARGE_TAIL=/^\d{1,2}(?:\.\d{1,2})?\s?%(?:\s*\((?:max(?:imum)?\.?\s*)?\d{1,2}(?:\.\d{1,2})?\s?%\))?\s+(?:p\.\s?a\.|per\s+annum|a\s+year)\s+of\s+(?:its|the)\s+(?:fund'?s?\s+)?(?:net\s+asset\s+value|NAV)\.?$/i;
const ASSET_CLASS=/^(?:fixed\s+income|equit(?:y|ies)|bonds?|money\s+market|alternatives?)$/i;
const FOOTER_NAME=/^(?:this\s+(?:policy\s+)?illustra\S{0,3}on\s+is\s+only\s+valid\s+when\s+all\s+(?:the\s+)?pages\s+are\s+included|(?:this\s+(?:illustration|document|summary)\s+is\s+)?for\s+illustration\s+(?:purposes\s+)?only)\.?$/i;
const FOOTER_TAIL=/^page\s+\d{1,3}\s+of\s+\d{1,3}(?:\s+reference\s+(?:number|no\.?)\s*:?\s*[A-Za-z0-9_\-/]+)?$/i;
function readsAsNoBenefit(name:string,quote:string){
  const n=name.replace(/\s+/g," ").trim(),q=quote.replace(/\s+/g," ").trim();
  if(!q.startsWith(n))return false;
  const rest=q.slice(n.length).trim();
  if(FUND_NAME.test(n)&&FUND_CHARGE_TAIL.test(rest))return true;
  if(ASSET_CLASS.test(n)&&/^(?:\d{1,3}(?:\.\d+)?\s?%\s*){3,}$/.test(rest))return true;
  return FOOTER_NAME.test(n)&&FOOTER_TAIL.test(rest);
}
/** A schedule's cover line, its sum assured with the dates it runs between ("DOUBLE CRITICAL COVER 2217S $100,000.00
 * 21 Sep 2020 21 Sep 2092", optionally its premium and term after), stored with no rule of what a claim pays: the sum is
 * the cover itself, already on the Coverage page. A row stored with a formula is what a claim pays and is kept (Critic
 * R395 H2). Benefits route display only. */
const COVER_DATE=String.raw`(?:\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4})`;
const COVER_MONEY=String.raw`(?:S\$|SGD\s?|US\$|RM\s?|£|\$)\s?\d[\d,]*(?:\.\d{2})?`;
const COVER_LINE_TAIL=new RegExp(String.raw`^\s*${COVER_MONEY}\s+${COVER_DATE}\s+${COVER_DATE}(?:\s+${COVER_MONEY}(?:\s+\d{1,3})?)?\s*$`,"i");
export function isRulelessCoverLine(row:{benefitName:string;quote:string|null;formulaKind:string|null;formulaValue:unknown}):boolean{
  if(row.formulaKind&&row.formulaKind!=="none")return false;
  if(row.formulaValue!=null&&row.formulaValue!=="")return false;
  const n=row.benefitName.replace(/\s+/g," ").trim(),q=String(row.quote??"").replace(/\s+/g," ").trim();
  return !!n&&q.startsWith(n)&&COVER_LINE_TAIL.test(q.slice(n.length));
}
/** namesNoBenefit, plus (with the quote) a row named only by a plan's empty cell or one whose shape reads as no
 * benefit (readsAsNoBenefit). The Benefits route's display filter. */
export function namesNoBenefit(benefitName:string,quote?:string|null){
  const name=(benefitName??"").trim();
  if(quote!=null&&(namesOnlyAPlanCell(name,quote)||readsAsNoBenefit(name,quote)))return true;
  if(EMPTY_CELL.test(name.replace(/[.:]+$/,"").trim()))return true;
  const words=name.replace(MONEY_OR_FIGURE," ").replace(/\b(?:nd|rd|st|th)\b/giu," ");
  const hasWord=/\p{L}{3}/u.test(words)||/\p{Script=Han}/u.test(words)||/(?:(?!\p{Script=Latin})\p{L}){2}/u.test(words)||/(?:^|[^\p{L}])\p{Lu}{2,}(?:[&/]\p{Lu}+)*(?![\p{Ll}])/u.test(words)||/\p{Lu}&\p{Lu}/u.test(words);
  if(!hasWord)return true;
  return JOINING_START.test(name)||JOINING_END.test(name);
}
/** Every rule read from these documents. The order is total (benefit name, then page, then id): rows that share a
 * benefit name are otherwise returned in whatever order the database scans them, and the first of them wins
 * wherever a later step keeps one row per benefit (tier selection, stated-rule preference, ledger seeding) --
 * the Round 9 flake, where a re-read could change which of two equal-named rows a household saw. */
export async function loadBenefitCatalog(accountId:string,policyIds:string[]){
  if(!policyIds.length)return [] as CatalogBenefit[];
  await ensureBenefitSchema();
  const r=await query<BenefitRow>(
    "SELECT id,policy_id,product_name,benefit_name,traits,requires,formula_kind,formula_value::text,currency,fact_key,offset_days,maximum_days,source_page,quote,conditions,requirements,needs_review,basis_inferred,reviewed_at::text,(basis_inferred AND reviewed_at IS NULL) AS needs_confirmation,to_jsonb(b)->>'tier' AS tier,to_jsonb(b)->>'row_kind' AS row_kind FROM policy_benefits b WHERE account_id=$1 AND policy_id=ANY($2::uuid[]) AND coalesce((to_jsonb(b)->>'duplicate_of_policy_id')::uuid<>ALL($2::uuid[]),true) ORDER BY benefit_name,source_page NULLS LAST,id",
    [accountId,policyIds]);
  // Round 7: a figure a later endorsement of the same policy replaced is not
  // current cover (lib/policies/amendments.ts).
  const replaced=await replacedFigures(accountId,policyIds).catch(()=>new Map());
  const rows=r.rows.filter(row=>{const rep=replaced.get(row.policy_id);return !rep||row.formula_value==null||!rep.amounts.has(Number(row.formula_value));});
  return repairStoredRules(rows.map(toBenefit));
}
/** Rebuilds a document's rules, keeping every rule a person corrected.
 *
 * Re-reading a document must never quietly undo a correction: the person read
 * their own policy and DearPolicy did not. Reviewed rows are kept as they are,
 * and a freshly extracted rule for the same benefit is dropped rather than
 * shown twice. */
export async function replaceBenefitCatalog(accountId:string,policyId:string,benefits:Omit<CatalogBenefit,"id"|"policyId">[]){
  await ensureBenefitSchema();
  const reviewed=await query<{benefit_name:string}>(
    "SELECT benefit_name FROM policy_benefits WHERE account_id=$1 AND policy_id=$2 AND reviewed_at IS NOT NULL",[accountId,policyId]);
  const kept=new Set(reviewed.rows.map(row=>benefitKey(row.benefit_name)));
  await query("DELETE FROM policy_benefits WHERE account_id=$1 AND policy_id=$2 AND reviewed_at IS NULL",[accountId,policyId]);
  for(const benefit of benefits){
    if(kept.has(benefitKey(benefit.benefitName)))continue;
    if(looksLikeCoverageLine(benefit.benefitName))continue;
    const inserted=await query<{id:string}>(
      "INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,fact_key,offset_days,maximum_days,source_page,quote,conditions,requirements,needs_review,basis_inferred,requires) VALUES($1,$2,$3,$4,$5::text[],$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18::text[]) RETURNING id",
      [accountId,policyId,benefit.productName,benefit.benefitName,benefit.traits,benefit.formulaKind,
       benefit.formulaValue,benefit.currency,benefit.factKey,benefit.offsetDays,benefit.maximumDays,
       benefit.sourcePage,benefit.quote,JSON.stringify(benefit.conditions),JSON.stringify(benefit.requirements),benefit.needsReview,benefit.basisInferred===true,benefit.requires??[]]);
    // Tier and row kind (evidence columns, see ensureEvidenceSchema) are only
    // set by the table reader, which ensures those columns first.
    if(benefit.tier||benefit.rowKind)
      await query("UPDATE policy_benefits SET tier=$3,row_kind=$4 WHERE account_id=$1 AND id=$2",[accountId,inserted.rows[0].id,benefit.tier??null,benefit.rowKind??null]);
  }
  // Mark the document read even when it stated no rules at all. "Read and it
  // said nothing" and "never read" look identical in the benefit table, and
  // confusing them makes a document ask to be read again forever.
  await query("UPDATE policies SET benefits_indexed_at=now() WHERE id=$1 AND account_id=$2",[policyId,accountId]);
  await clearReadFailure(accountId,policyId,BENEFIT_READ_FAILURE_KEY);
  return benefits.filter(benefit=>!kept.has(benefitKey(benefit.benefitName))).length;
}
/** Two spellings of the same benefit name are the same benefit. */
function benefitKey(name:string){return name.toLowerCase().replace(/[^a-z0-9]/g,"");}

// ---------------------------------------------------------------------------
// Answering from the catalogue: lookup plus arithmetic, no model involved.
// ---------------------------------------------------------------------------
import { productIdentity,type PolicyContract } from "@/lib/policies/inventory";
import type { ChatCitation } from "@/types";
/** Where a quoted clause sits, without inventing a page nobody recorded. */
function onPage(page:number|null|undefined){return page!=null?" on page "+page:" on an unrecorded page";}

/** Picks the insured amount this benefit is calculated from. A benefit is only
 * calculated against a coverage the person is actually proved to own. */
export function coverageForBenefit(contract:PolicyContract,benefit:CatalogBenefit){
  const wanted=productIdentity(benefit.productName);
  const identity=(coverage:OwnedCoverage)=>productIdentity(coverage.productName??coverage.policyName);
  const byProduct=contract.coverages.filter(coverage=>identity(coverage)===wanted);
  if(byProduct.length===1)return byProduct[0];
  if(!wanted&&contract.coverages.length===1)return contract.coverages[0];
  // A group scheme names every cover (life, accident, critical illness) after the scheme: the first of them is not the
  // cover a row pays under. Narrow by what the row pays on, and leave it unresolved when that cannot tell them apart.
  if(byProduct.length>1)return coverForEvent({...contract,coverages:byProduct},benefit);
  // A section heading is rarely the product's exact name: "Total and Permanent
  // Dismemberment due to Accident" belongs to the personal accident plan.
  // One name containing the other, or the plan's own category in the heading,
  // is enough to join them — and the join is shown, so a wrong one is visible.
  if(wanted){
    const contains=contract.coverages.filter(coverage=>{const id=identity(coverage);return !!id&&(wanted.includes(id)||id.includes(wanted));});
    if(contains.length===1)return contains[0];
    const byCategory=contract.coverages.filter(coverage=>{
      const category=(coverage.category??"").toLowerCase();
      return category&&(wanted.includes(category)||(/accident|dismember|fracture|injur/.test(wanted)&&/accident/.test(category))||(/death|life/.test(wanted)&&/death|life/.test(category))||(/critical|illness|cancer/.test(wanted)&&/critical/.test(category)));
    });
    if(byCategory.length===1)return byCategory[0];
  }
  return coverForEvent(contract,benefit);
}
/** A benefit named as total and permanent disability, not one whose name merely mentions it. */
const NAMED_TPD=/^\s*(?:total(?:ly)? and permanent(?:ly)? disab|permanent total disab|tpd\b)/i;
function coverForEvent(contract:PolicyContract,benefit:CatalogBenefit):OwnedCoverage|null{
  // Last resort: join by what the benefit is written to pay ON.
  //
  // A group booklet covers several plans under one product name, so its "Death"
  // and "Total and Permanent Disability Benefit" rows resolve to no cover at
  // all, and the person is told to "set the product name to match the
  // certificate" -- admin, for a question their own documents already answer.
  // A benefit that pays on a death belongs to the death cover; one that is
  // conditional on an accident belongs to the accident plan, which is what
  // keeps "Total and Permanent Disablement due to Accident" off the life sum.
  const triggers=benefitTriggerEvents(benefit.benefitName,benefit.quote);
  const accidentOnly=(benefit.requires??[]).includes("accident")
    ||/\baccidental\b|\bdue to (?:an )?accident\b/i.test(benefit.benefitName);
  const category=(coverage:OwnedCoverage)=>(coverage.category??"").toLowerCase();
  // A schedule of injuries IS the personal accident plan's schedule. Sixty of
  // this household's rules -- every dismemberment row, every burns band, every
  // fracture -- name an injury and nothing else, so none of the triggers above
  // fitted them and every one of them resolved to no cover at all and was
  // dropped without a word. A row that names a specific injury belongs to the
  // accident cover for the same reason "due to an accident" does.
  const namesAnInjury=namesASpecificInjury(benefit.benefitName)||triggers.includes("accidental_injury");
  const wantedCategory=accidentOnly?/accident/
    :triggers.includes("critical_illness")?/critical|living care|dread disease/
    :triggers.includes("total_permanent_disability")?/permanent|disab/
    :triggers.includes("death")?/death|life/
    :namesAnInjury?/accident|injur|dismember/
    :null;
  if(wantedCategory){
    const byEvent=contract.coverages.filter(coverage=>wantedCategory.test(category(coverage)));
    if(byEvent.length===1)return byEvent[0];
    // Several match: the one with a figure, if only one has one.
    const withAmount=byEvent.filter(coverage=>coverage.amount!=null);
    if(withAmount.length===1)return withAmount[0];
    // Total and permanent disability not caused by an accident is paid under the life cover when the contract has no
    // disability cover of its own (the household's group scheme: TPD at 100% of the Group Term Life sum insured, the
    // certificate's life line). A disablement written about an accident or an injury never comes here: it is the
    // accident plan's ("TPD due to Accident", 150% of the personal accident sum), and the two are never added.
    // The benefit's own name must begin as TPD: a row that only mentions it ("Natural Catastrophe: 15% of the Sum Insured
    // on death or Total and Permanent Disability caused by one") is not the life cover's TPD (Critic R81-1). A ledger
    // row's name begins with its own note, so a note naming another benefit keeps that row off the life cover too.
    if(!byEvent.length&&!accidentOnly&&!namesAnInjury&&NAMED_TPD.test(benefit.benefitName)
      &&!/\baccident|\binjur/i.test(benefit.benefitName+" "+benefit.quote)){
      const life=contract.coverages.filter(coverage=>/death|life/.test(category(coverage))&&coverage.amount!=null);
      if(life.length===1)return life[0];
    }
  }
  return contract.coverages.length===1?contract.coverages[0]:null;
}
/** Two documents of the same plan often state the same benefit two ways. A
 * rule with a printed figure outranks one inferred from a heading: the
 * household's own benefit summary heads its fracture table "% of Sum Insured"
 * (S$120,000 for a forearm) while the product summary heads the same table
 * "% of S$5,000" (S$1,250). Only one of those is a fracture benefit. */
export function preferStatedRules(benefits:CatalogBenefit[]){
  const key=(name:string)=>name.toLowerCase().replace(/\(.*?\)/g,"").replace(/[^a-z]/g,"");
  const rank=(b:CatalogBenefit)=>(b.reviewedAt?4:0)+(b.formulaKind!=="none"?2:0)+(b.basisInferred?0:1)+(b.formulaKind==="fixed"||b.formulaKind==="expense_cap"?0.5:0);
  const best=new Map<string,CatalogBenefit>();
  for(const benefit of benefits){
    const k=key(benefit.benefitName);
    const existing=best.get(k);
    if(!existing||rank(benefit)>rank(existing))best.set(k,benefit);
  }
  // The two statements of one benefit are one benefit: when the survivor's
  // own title lost the table heading that says what kind of injury it pays
  // for ("Arm , Elbow, Wrist or Ribs" beside "Arm, Elbow, Wrist or Ribs
  // (Other Fracture)"), the kind its sibling states is carried over as
  // evidence, so the injury-compatibility screen can still classify it. Only
  // an unambiguous kind is carried; figures and wording are never merged.
  const kindsByKey=new Map<string,Set<InjuryLineKind>>();
  for(const benefit of benefits){
    const kind=classifyInjuryLine(benefit).kind;
    if(kind&&kind!=="ambiguous_injury")kindsByKey.set(key(benefit.benefitName),(kindsByKey.get(key(benefit.benefitName))??new Set()).add(kind));
  }
  return benefits.filter(benefit=>best.get(key(benefit.benefitName))===benefit).map(benefit=>{
    const siblings=[...(kindsByKey.get(key(benefit.benefitName))??[])];
    const own=classifyInjuryLine(benefit).kind;
    if(siblings.length!==1||(own&&own!=="ambiguous_injury"))return benefit;
    const evidence=benefits.find(other=>other!==benefit&&key(other.benefitName)===key(benefit.benefitName)&&classifyInjuryLine(other).kind===siblings[0]);
    return evidence?{...benefit,kindEvidence:evidence.benefitName}:benefit;
  });
}
/** Answering "how much can I claim if…" — a situation, not an event.
 *
 * The same stored benefits, matched the same way. The difference is that
 * nothing has happened, so facts like the number of nights in hospital cannot
 * exist yet: where a rule needs one, the rule itself is shown ("S$30 per day
 * after the first 10 days, up to 30 days") and the missing fact becomes a
 * question. A person asking this deserves the figures their policies would pay,
 * not a refusal because they have not had the accident yet. */
export type ScenarioNeed={factKey:string;question:string};
const SCENARIO_QUESTIONS:Record<string,string>={
  // A what-if has not happened: its question is asked in the conditional.
  hospitalNights:"Roughly how many nights in hospital would it be?",
  hospitalBill:"Roughly how much would the hospital bill be?",
  ambulanceBill:"Roughly how much would the ambulance charge be?",
  vehicleRepairBill:"Roughly how much would the repair bill be?",
  outOfPocket:"Roughly how much would you pay out of your own pocket?",
};
/** The conditional question for a what-if (it has not happened), or null. */
export function whatIfQuestion(factKey:string){return SCENARIO_QUESTIONS[factKey]??null;}
/** What a schedule line says on its own.
 *
 * "GROUP TERM LIFE · S$1,000,000" on a certificate states what the plan pays
 * on death without any benefit table: the sum assured. A household's cover
 * often sits in lines like this, and a death answered with "no rule on file"
 * while the certificate says a million dollars is the wrong answer. Used only
 * for a contract whose stored rules do not already respond, so nothing is
 * counted twice. Each figure is marked estimated and says which standard rule
 * it assumes; the policy wording, once read, replaces it. */
const SCHEDULE_RESPONDS:{pattern:RegExp;exclude?:RegExp;traits:ScenarioTrait[];requires?:ScenarioTrait[];pays:string;rule:string;basis:"estimated"|"indicative"}[]=[
  {pattern:/\b(?:term life|whole life|group life|life (?:cover|insurance|assurance|plan)|death|dependants?'? protection|dps)\b/i,exclude:/\bliving\b/i,
   traits:["death"],pays:"death benefit",rule:"a life plan pays its sum assured on the death of the life assured",basis:"estimated"},
  {pattern:/\b(?:personal accident|group accident|accident(?:al)? (?:cover|plan|insurance|death)|pa)\b/i,
   traits:["death"],requires:["accident"],pays:"accidental death benefit",rule:"a personal accident plan pays 100% of its sum insured on accidental death",basis:"estimated"},
  {pattern:/\b(?:critical illness|living care|dread disease|major illness|ci)\b/i,
   traits:["illness","diagnosis"],pays:"critical illness benefit",rule:"a critical illness plan pays its sum assured on a qualifying diagnosis, or a percentage of it for an early-stage condition",basis:"indicative"},
  {pattern:/\b(?:total permanent disability|total and permanent disab\w*|permanent disablement|tpd)\b/i,
   traits:["disability"],pays:"total and permanent disability benefit",rule:"a life or accident plan pays its sum assured on total and permanent disability",basis:"estimated"},
];
const TRAIT_ASK:Partial<Record<ScenarioTrait,string>>={accident:"confirmation that this was caused by an accident"};
export function scheduleFallbackItems(args:{contract:PolicyContract;traits:ScenarioTrait[];events?:ClaimEventType[]}):{items:ClaimItem[];citations:ChatCitation[]}{
  const reported=new Set(args.traits);
  const events=args.events??reportedClaimEvents({},args.traits);
  const items:ClaimItem[]=[];const citations:ChatCitation[]=[];
  for(const coverage of args.contract.coverages){
    if(coverage.amount==null||!(coverage.amount>0))continue;
    // Match on the CATEGORY, not on the category plus the product name.
    //
    // A "Total Permanent Disability" row under a plan called "Group Term Life"
    // used to be read as a death benefit, because the combined string contains
    // "term life". On a death that produced a second S$1,000,000 beside the
    // real death benefit, from the same plan, for an event it does not pay on.
    // The category is the structured field and the precise one; the product
    // name is only consulted when there is no category to go on.
    const category=(coverage.category??"").trim();
    const name=(category+" "+(coverage.productName??"")).trim();
    const target=category&&category.toLowerCase()!=="other"?category:name;
    for(const rule of SCHEDULE_RESPONDS){
      if(!rule.pattern.test(target)||(rule.exclude&&rule.exclude.test(target)))continue;
      if(!rule.traits.some(trait=>reported.has(trait)))continue;
      // The same gate the stored rules get. A schedule line saying the
      // household holds critical-illness cover is not a reason to pay it on a
      // death, and an assumed standard rule is the last place to be generous.
      if(ruledOutByEvent(benefitTriggerEvents(rule.pays,rule.rule),events))continue;
      const missing:string[]=[];let contradicted=false;
      for(const required of rule.requires??[]){
        if(reported.has(required))continue;
        if((CONTRADICTS[required]??[]).some(trait=>reported.has(trait))){contradicted=true;break;}
        missing.push(TRAIT_ASK[required]??required);
      }
      if(contradicted)continue;
      // A schedule line is a figure only when its currency is written in the
      // cover's own policy evidence; otherwise the benefit is listed without one.
      const verifiedCurrency=coverage.currencyVerified===true?normalizeCurrencyCode(coverage.currency)||null:null;
      const currency=verifiedCurrency??"";
      const label=coverage.productName&&normalText(coverage.productName)!==normalText(coverage.category)?coverage.productName+" ("+coverage.category+")":coverage.category;
      items.push({
        title:args.contract.ownerName+" · "+label+" — "+rule.pays,
        contractId:args.contract.id,
        status:verifiedCurrency?(missing.length?"potentially_applicable":"likely_applicable"):"needs_document",
        ...(verifiedCurrency?{amountText:formatMoney(coverage.amount,currency),amountLabel:"Calculated benefit (internal)" as const,
          estimateBasis:rule.basis,calculatedAmount:coverage.amount,currency,calculationKind:"sum_insured" as const,aggregation:"additive" as const,calculationId:"coverage:"+coverage.id}
          :{amountText:null}),
        coverKey:coverKey({policyNumber:coverage.policyNumber,groupPolicyNumber:coverage.groupPolicyNumber,
          insurer:coverage.insurer??args.contract.insurer??null,
          productName:canonicalProduct(coverage.productName??coverage.policyName??coverage.category),
          contractId:args.contract.id,contractName:args.contract.name}),
        ...(payingEvent(benefitTriggerEvents(rule.pays,rule.rule),events)?{payingEvent:payingEvent(benefitTriggerEvents(rule.pays,rule.rule),events)!}:{}),
        reason:"Your "+(coverage.evidenceText?"document":"schedule")+" shows "+(verifiedCurrency?formatMoney(coverage.amount,currency):Number(coverage.amount).toLocaleString("en-US")+" (currency not stated in the evidence read)")+" of "+label+" cover for "+args.contract.ownerName+(coverage.sourcePage?" (page "+coverage.sourcePage+")":"")+". "
          +"No benefit table for this plan has been read, so this assumes the standard rule: "+rule.rule+". "
          +(rule.basis==="indicative"?"Shown for reference and not added to the total until the plan's own wording is read.":"Upload the policy wording or benefit summary and DearPolicy will calculate from the actual clause instead."),
        conditions:[...missing.map(m=>"Still needed: "+m),...(verifiedCurrency?[]:["Still needed: "+CATALOG_CURRENCY_MISSING]),"Subject to the insurer's assessment and the plan's own terms and exclusions."],
      });
      citations.push({chunkId:"coverage:"+coverage.id,policyId:coverage.policyId,policyName:coverage.productName??args.contract.name,insurer:coverage.insurer??args.contract.insurer??undefined,
        pageStart:coverage.sourcePage??null,pageEnd:coverage.sourcePage??null,personalEvidence:true,evidenceLabel:"Verified personal cover"});
      break;
    }
  }
  return {items,citations};
}
/** A personal accident plan pays for accidents.
 *
 * That is the plan's whole name, and in the wording it is stated once, in a
 * section heading the row parser never kept: "D. Injury due to Accident". So a
 * row reading "4. Loss of arm -- 100% of the Sum Insured" carried no such
 * condition, and an amputation caused by illness rather than by an accident
 * was answered with the full accident sum insured. The cover a row is paid out
 * of says what the row's own line does not. */
export function conditionsFromTheCover(contract:PolicyContract,benefits:CatalogBenefit[]):CatalogBenefit[]{
  return benefits.map(benefit=>{
    if((benefit.requires??[]).includes("accident"))return benefit;
    const coverage=coverageForBenefit(contract,benefit);
    const paysOnAccidentsOnly=/accident/i.test(coverage?.category??"")
      ||/accident/i.test(canonicalProduct(coverage?.productName??coverage?.policyName??""));
    return paysOnAccidentsOnly?{...benefit,requires:[...(benefit.requires??[]),"accident" as ScenarioTrait]}:benefit;
  });
}
export function scenarioFromCatalog(args:{contract:PolicyContract;catalog:CatalogBenefit[];traits:ScenarioTrait[];events?:ClaimEventType[];
  /** The what-if as asked: benefits for another kind of treatment or place are left out. */
  question?:string;
  /** The owner's facts, when the question is about something that happened.
   * Omitted for a hypothetical, which keeps showing what the policy pays. */
  facts?:SubjectFacts}){
  const events=args.events??reportedClaimEvents({},args.traits);
  const documentIds=new Set([...args.contract.documents,...args.contract.references].map(d=>d.id));
  const mine=conditionsFromTheCover(args.contract,preferStatedRules(args.catalog.filter(benefit=>documentIds.has(benefit.policyId))));
  const items:ClaimItem[]=[];const citations:ChatCitation[]=[];const needs:ScenarioNeed[]=[];
  const seen=new Set<string>();
  const declaredOnly=args.contract.ownershipBasis==="declared";
  for(const {benefit} of matchBenefits(mine,args.traits,events,args.facts)){
    if(args.question!=null&&benefitIsForAnotherKindOfEvent(benefit.benefitName,args.question))continue;
    const coverage=coverageForBenefit(args.contract,benefit);
    if(!coverage&&!declaredOnly)continue;
    const key=benefit.benefitName.toLowerCase().replace(/[^a-z0-9]/g,"");
    if(seen.has(key))continue;seen.add(key);
    const {item}=assessCatalogBenefit({benefit,coverage,ownerName:args.contract.ownerName,facts:{},declaredOnly,
      contractId:args.contract.id,contractName:args.contract.name,insurer:args.contract.insurer,events});
    if(item.amountText==null&&benefit.formulaKind!=="none"){
      // No figure yet, but the rule is known. Showing the rule is the answer.
      item.amountText=describeBenefitFormula(benefit);
      item.amountLabel="What this benefit pays";
      item.status="potentially_applicable";
    }
    if(benefit.factKey&&SCENARIO_QUESTIONS[benefit.factKey])
      needs.push({factKey:benefit.factKey,question:SCENARIO_QUESTIONS[benefit.factKey]});
    items.push(item);
    citations.push({chunkId:"benefit:"+benefit.id,policyId:benefit.policyId,
      policyName:benefit.productName??args.contract.name,insurer:args.contract.insurer??undefined,
      pageStart:benefit.sourcePage??null,pageEnd:benefit.sourcePage??null,
      evidenceLabel:"Policy wording, read when the document was uploaded"});
  }
  return {items,citations,needs,considered:mine.length};
}
/** The facts a claim still needs, in the order they should be asked.
 *
 * Gates first — the answers that rule benefits in or out ("was this an
 * accident or an illness?", "was she admitted?") — then the quantities that
 * set amounts. One at a time: it is a conversation, not a form. A fact the
 * person has already said they do not know is not asked again. */
export type ClaimQuestionPlan={factKey:string;text:string;type:"yes_no"|"text"|"choice";options?:string[];why:string};
const GATE_QUESTIONS:Record<string,ClaimQuestionPlan>={
  hospitalisation:{factKey:"hospitalised",type:"yes_no",text:"Was there a hospital admission?",
    why:"Hospital benefits only respond to an admission, and the daily ones depend on how long it lasted."},
  accident:{factKey:"eventType",type:"choice",options:["An accident","An illness"],text:"Was this caused by an accident, or an illness?",
    why:"Some of these benefits only pay for accidents, so this decides which ones apply."},
  hospitalised:{factKey:"hospitalised",type:"yes_no",text:"Was there a hospital admission?",
    why:"Hospital benefits only respond to an admission, and the daily ones depend on how long it lasted."},
};
const QUANTITY_QUESTIONS:Record<string,ClaimQuestionPlan>={
  hospitalNights:{factKey:"hospitalNights",type:"text",text:"How many nights in hospital?",why:"Daily hospital cash is paid per night, after any waiting period."},
  hospitalBill:{factKey:"hospitalBill",type:"text",text:"How much was the hospital bill?",why:"Reimbursement benefits pay what was actually spent, up to their limit."},
  ambulanceBill:{factKey:"ambulanceBill",type:"text",text:"How much was the ambulance charge?",why:"It is reimbursed up to the policy's limit."},
  vehicleRepairBill:{factKey:"vehicleRepairBill",type:"text",text:"How much was the repair bill?",why:"It is reimbursed up to the policy's limit."},
  outOfPocket:{factKey:"outOfPocket",type:"text",text:"How much did you pay out of your own pocket?",why:"It is reimbursed up to the policy's limit."},
};
function alreadyAsked(facts:SubjectFacts,factKey:string){
  const fact=facts[factKey];
  return !!fact&&fact.state!=="known"; // pending or unknown: asked, and the person could not say
}
export function planClaimQuestions(args:{matches:BenefitMatch[];facts:SubjectFacts;traits:ScenarioTrait[]}):ClaimQuestionPlan[]{
  const plan:ClaimQuestionPlan[]=[];const seen=new Set<string>();
  const add=(question:ClaimQuestionPlan)=>{
    if(seen.has(question.factKey)||knownValue(args.facts,question.factKey)!=null||alreadyAsked(args.facts,question.factKey))return;
    seen.add(question.factKey);plan.push(question);
  };
  // Gates: an unknown required cause on any candidate benefit.
  for(const match of args.matches)for(const trait of match.unknown)if(GATE_QUESTIONS[trait])add(GATE_QUESTIONS[trait]);
  const reported=new Set(args.traits);
  const needsHospital=args.matches.some(match=>match.benefit.factKey==="hospitalNights"||match.benefit.traits.includes("hospitalisation"));
  if(needsHospital&&!reported.has("hospitalisation"))add(GATE_QUESTIONS.hospitalised);
  // Quantities, only for benefits still in play.
  for(const match of args.matches){
    const key=match.benefit.factKey;
    if(!key||!QUANTITY_QUESTIONS[key])continue;
    if(key==="hospitalNights"&&knownValue(args.facts,"hospitalised")===false)continue;
    if(key==="ambulanceBill"&&knownValue(args.facts,"ambulanceUsed")===false)continue;
    // Whether there was an ambulance at all comes before what it cost.
    if(key==="ambulanceBill"&&knownValue(args.facts,"ambulanceUsed")==null){
      add({factKey:"ambulanceUsed",type:"yes_no",text:"Was an ambulance used?",why:"The ambulance benefit only pays when an ambulance was used."});continue;}
    add(QUANTITY_QUESTIONS[key]);
  }
  return plan;
}
/** The event happened before the cover on file started.
 *
 * Said as a condition, never as a refusal. A group certificate usually prints
 * the CURRENT period's effective date, not the date the member first joined the
 * scheme, so treating it as the start of cover would deny claims that are
 * perfectly good. The person is told what the document says and asked for the
 * original commencement date, which is the fact that actually settles it. */
export function eventPredatesCover(contract:PolicyContract,facts:SubjectFacts){
  if(!contract.effectiveDate)return null;
  const dates=["deathDate","accidentDate","diagnosisDate","eventDate"]
    .map(key=>knownValue(facts,key)).filter((value):value is string=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}/.test(value));
  if(!dates.length)return null;
  const earliest=dates.sort()[0];
  if(earliest>=contract.effectiveDate.slice(0,10))return null;
  return "The cover on file starts on "+contract.effectiveDate.slice(0,10)+" and what you described is dated "+earliest.slice(0,10)
    +". If this scheme has been renewed continuously from an earlier date, it still responds \u2014 tell DearPolicy when the cover first started.";
}
export function assessContractFromCatalog(args:{contract:PolicyContract;catalog:CatalogBenefit[];facts:SubjectFacts;traits:ScenarioTrait[];
  /** Supplied by the caller when a diagnosis was reported, so the critical
   * illness door can be closed on a condition the schedules do not name. */
  events?:ClaimEventType[]}){
  const events=args.events??reportedClaimEvents(args.facts,args.traits);
  const predatesCover=eventPredatesCover(args.contract,args.facts);
  const documentIds=new Set([...args.contract.documents,...args.contract.references].map(d=>d.id));
  const mine=conditionsFromTheCover(args.contract,preferStatedRules(args.catalog.filter(benefit=>documentIds.has(benefit.policyId))));
  const items:ClaimItem[]=[];const citations:ChatCitation[]=[];
  const seen=new Set<string>();
  const declaredOnly=args.contract.ownershipBasis==="declared";
  // Injury compatibility BEFORE a row can become a candidate: judging,
  // question planning and the answer only ever see rows that can answer the
  // injury this owner reported. The rest are kept as internal audit data.
  const screened=screenInjuryCompatibility(mine,args.facts);
  const matches=matchBenefits(screened.compatible,args.traits,events);
  const matchedIds=new Set(matchBenefits(mine,args.traits,events).map(match=>match.benefit.id));
  const incompatible=screened.incompatible.filter(entry=>matchedIds.has(entry.benefit.id));
  const excludedByFact=factExclusions(args.facts);
  const inPlay=matches.filter(match=>!excludedByFact(match.benefit));
  for(const {benefit} of inPlay){
    const coverage=coverageForBenefit(args.contract,benefit);
    // Without a schedule there is no coverage row, but the person has told us
    // they hold this policy, so its own stated figures still apply to them.
    //
    // And a benefit that needs no sum insured never needed a coverage row in
    // the first place: a S$1,000 fracture, a S$30-a-day hospital cash, a
    // reimbursement capped at S$500 are all computed from the rule and the
    // facts alone. Requiring the join anyway silently threw away every one of
    // them whenever the rule carried the booklet's title instead of the
    // cover's -- which, for a group scheme, is every rule.
    const needsASumInsured=benefit.formulaKind==="sum_insured";
    if(!coverage&&!declaredOnly&&needsASumInsured)continue;
    const key=benefit.benefitName.toLowerCase().replace(/[^a-z0-9]/g,"");
    if(seen.has(key))continue;seen.add(key);
    const {item}=assessCatalogBenefit({benefit,coverage,ownerName:args.contract.ownerName,facts:args.facts,declaredOnly,
      contractId:args.contract.id,contractName:args.contract.name,insurer:args.contract.insurer,events});
    if(predatesCover)item.conditions=[...new Set([...item.conditions,predatesCover])];
    items.push(item);
    citations.push({chunkId:"benefit:"+benefit.id,policyId:benefit.policyId,
      policyName:benefit.productName??args.contract.name,insurer:args.contract.insurer??undefined,
      pageStart:benefit.sourcePage??null,pageEnd:benefit.sourcePage??null,
      evidenceLabel:"Policy wording, read when the document was uploaded"});
    if(coverage)citations.push({chunkId:"coverage:"+coverage.id,policyId:coverage.policyId,
      policyName:coverage.productName??args.contract.name,insurer:coverage.insurer??undefined,
      pageStart:coverage.sourcePage??null,pageEnd:coverage.sourcePage??null,
      documentRole:coverage.documentRole,personalEvidence:true,evidenceLabel:"Verified personal cover"});
  }
  const excluded=ruledOutBenefits(screened.compatible,args.traits,events);
  const byFact=matches.filter(match=>!inPlay.includes(match)).map(match=>({benefit:match.benefit,because:excludedByFact(match.benefit)||"ruled out by what you told me"}));
  return {items,citations,considered:mine.length,matches:inPlay,ruledOut:[...excluded,...byFact],
    /** Rows screened out because they cannot answer the reported injury.
     * Internal audit data only: never shown and never part of ruledOut. */
    incompatible};
}
/** What the person has already said rules out, deterministically. "No
 * ambulance" ends every ambulance benefit and its question; "not admitted"
 * ends the hospital ones. Asking about a charge for a thing that did not
 * happen is the fastest way to lose someone's trust. */
/** A cause of death or injury the person has stated that is plainly not an
 * accident. Their words only: nothing here is inferred from a diagnosis or
 * guessed from a silence, because "we do not know" must never become "not an
 * accident". */
export function causeIsNotAnAccident(facts:SubjectFacts){
  if(knownValue(facts,"accidentalDeath")===true)return false;
  if(knownValue(facts,"accidentalDeath")===false)return true;
  const cause=String(knownValue(facts,"causeOfDeath")??"").toLowerCase();
  if(!cause.trim())return false;
  return /suicide|took (?:his|her|their) own life|self[- ]inflicted|natural causes|old age|illness|disease|cancer|stroke|heart attack|cardiac|organ failure|infection|sepsis|pneumonia|covid/.test(cause);
}
export function factExclusions(facts:SubjectFacts){
  const rules:{when:boolean;matches:(benefit:CatalogBenefit)=>boolean;because:string}[]=[
    {when:knownValue(facts,"hospitalised")===false,because:"needs a hospital admission, and there was none",
     matches:benefit=>benefit.traits.includes("hospitalisation")||benefit.factKey==="hospitalNights"||/\b(?:ward|hospital|inpatient|admission|surg)/i.test(benefit.benefitName)},
    {when:knownValue(facts,"ambulanceUsed")===false,because:"no ambulance was used",
     matches:benefit=>benefit.factKey==="ambulanceBill"||/\bambulance\b/i.test(benefit.benefitName)},
    {when:knownValue(facts,"surgery")===false,because:"there was no surgery",
     matches:benefit=>/\b(?:surg\w+|operation|implant)\b/i.test(benefit.benefitName)},
    {when:knownValue(facts,"death")!==true,because:"nobody has died",
     matches:benefit=>(benefit.requires??[]).includes("death")},
    // A personal accident cover pays for an accident. When the person has told
    // us in their own words what the cause was, and that cause is not one,
    // the accident cover is out -- and so is the injury schedule under it.
    // Without this a death by suicide was being offered S$600,000 of accident
    // cover, on nothing more than the words "death" and "accident" both being
    // present.
    {when:causeIsNotAnAccident(facts),because:"pays where an accident caused the loss, and you have said what the cause was",
     matches:benefit=>(benefit.requires??[]).includes("accident")||benefit.traits.includes("accident")},
  ];
  return (benefit:CatalogBenefit)=>rules.find(rule=>rule.when&&rule.matches(benefit))?.because??null;
}
/** One card per benefit per person. The same benefit stated in two of the
 * household's documents is one benefit; the card keeps the stronger figure and
 * cites both pages. */
export function dedupeClaimItems(items:ClaimItem[]){
  const rank=(item:ClaimItem)=>(item.amountText?4:0)+(item.estimateBasis==="confirmed"?3:item.estimateBasis==="estimated"?2:item.estimateBasis==="indicative"?1:0);
  const byKey=new Map<string,ClaimItem>();
  for(const item of items){
    const key=item.title.toLowerCase().replace(/[^a-z0-9·]/g,"");
    const existing=byKey.get(key);
    if(!existing||rank(item)>rank(existing))byKey.set(key,{...item,conditions:[...new Set([...(existing?.conditions??[]),...item.conditions])]});
    else existing.conditions=[...new Set([...existing.conditions,...item.conditions])];
  }
  return [...byKey.values()];
}
