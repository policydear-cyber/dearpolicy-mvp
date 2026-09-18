import { knownValue,normalText } from "@/lib/chat/facts";
import { benefitTriggerEvents,coverKey,payingEvent,reportedClaimEvents,ruledOutByEvent,type ClaimEventType } from "@/lib/insurance/claim-events";
import { explicitCurrency,numericTokens } from "@/lib/chat/policy-analysis";
import { formatMoney,normalizeCurrencyCode } from "@/lib/format/currency";
import type { FactValue,ScenarioTrait,SubjectFacts } from "@/lib/chat/types";
import { canonicalProduct } from "@/lib/coverage/facts";
import { resolveStoredRules } from "@/lib/insurance/scale-limit";
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
};

/** Which reported events can turn a benefit on.
 *
 * Deterministic and inspectable: no model decides this, so a death benefit can
 * never be offered for a broken wrist, and the reasoning can be shown to the
 * user verbatim. */
const TRAIT_RULES:{trait:ScenarioTrait;pattern:RegExp}[]=[
  {trait:"death",pattern:/\b(?:death|dies|died|decease[d]?|loss of life|funeral)\b/},
  {trait:"accident",pattern:/\baccident(?:al|ally)?\b|\bsudden and unforeseen\b|\b(?:fell|falls?|falling|fall down|slipped?|slipping|tripped?|collision|knocked)\b/},
  {trait:"bodily_injury",pattern:/\b(?:injur\w+|fracture[sd]?|break(?:s|ing)?|broke(?:n)?|dislocation|sprain\w*|burns?|amputat\w+|laceration|wound\w*|cut myself)\b/},
  {trait:"disability",pattern:/\b(?:disablement|disabilit\w+|permanently disabled|loss of (?:use|sight|limb|hearing|speech)|impairment)\b/},
  {trait:"illness",pattern:/\b(?:illness|disease|sickness|critical illness|cancer|carcinoma|tumour|tumor|stroke|heart attack|myocardial)\b/},
  {trait:"diagnosis",pattern:/\b(?:diagnos\w+|biops\w+|histolog\w+)\b/},
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
  {trait:"care_need",pattern:/\b(?:nursing|care benefit|activities of daily living)\b/},
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
export function describesAScenario(text:string){
  const lower=(text??"").toLowerCase();
  if(!/\b(?:claim\w*|payout|pay out|pays?|cover\w*|entitled|get back|reimburse\w*|what if|what happens if|if i|if my|suppose)\b/.test(lower))return false;
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
export function matchBenefits(catalog:CatalogBenefit[],traits:ScenarioTrait[],events:ClaimEventType[]=[]):BenefitMatch[]{
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
const NAMED_INJURIES=["fracture","dislocation","burn","amputation","amputat","loss of sight","sight","eye","hearing","ear","speech",
  "limb","arm","leg","hand","foot","finger","thumb","toe","wrist","ankle","knee","hip","shoulder","elbow","spine","skull","jaw",
  "rib","pelvis","femur","tibia","clavicle","coma","paralysis","quadripleg","parapleg","dismember"];
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
/** Whether this row is one line of a schedule rather than a benefit in its own
 * right. */
export function namesASpecificInjury(benefitName:string){
  const name=(benefitName??"").toLowerCase();
  return NAMED_INJURIES.some(word=>name.includes(word))||isScaleBand(name);
}
export function injuryNotReported(benefit:CatalogBenefit,facts:SubjectFacts){
  const reported=reportedInjuryText(facts);
  if(!reported)return null;
  const name=benefit.benefitName.toLowerCase();
  // A burns band answers only to a burn or an assessed impairment.
  if(isScaleBand(name))
    return BURN_WORDS.some(word=>reported.includes(word))?null:benefit.benefitName;
  const named=NAMED_INJURIES.filter(word=>name.includes(word));
  if(!named.length)return null;
  if(named.some(word=>reported.includes(word)))return null;
  return benefit.benefitName;
}
export type CatalogAssessment={item:ClaimItem;missing:string[]};
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
  const currency=normalizeCurrencyCode(benefit.currency??coverage?.currency??null,coverage?.currency??"SGD");
  const missing:string[]=[];
  const conditions=[...benefit.conditions];
  let amount:number|null=null,basis="",aggregation:"additive"|"reimbursement"="additive";
  // A per-day figure worked out without knowing the policy's own day limit.
  let uncappedDaily=false;
  const wrongInjury=injuryNotReported(benefit,facts);
  if(wrongInjury)missing.push("confirmation that \u201c"+wrongInjury+"\u201d is what happened \u2014 this benefit pays for that specific injury, and it is not among the ones you described");
  else if(benefit.formulaKind==="sum_insured"&&benefit.formulaValue!=null&&coverage?.amount!=null&&currency===coverage.currency){
    amount=Math.round(coverage.amount*benefit.formulaValue*100)/100;
    basis=Math.round(benefit.formulaValue*1000)/10+"% of verified "+formatMoney(coverage.amount,currency);
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
      uncappedDaily=benefit.maximumDays==null;
      amount=payFor*benefit.formulaValue;
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
  const estimateBasis:"confirmed"|"estimated"|"indicative"=
    benefit.needsConfirmation||args.declaredOnly?"indicative"
    :benefit.formulaKind==="sum_insured"?(personalEvidence?"confirmed":"estimated")
    :uncappedDaily?"estimated"
    :"confirmed";
  if(benefit.needsConfirmation&&amount!=null)
    missing.push("your confirmation of what this benefit pays — DearPolicy read the rate from the heading above the row, not the row itself (Benefits page)");
  for(const requirement of benefit.requirements)
    if(knownValue(facts,requirement.factKey)==null)missing.push(requirement.why);
  for(const entry of missing)conditions.push("Still needed: "+entry);
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
    ...(coverLabel?{coverLabel}:{}),
    ...(namesASpecificInjury(benefit.benefitName)
      ?{scaleGroup:benefit.policyId+"#"+(benefit.sourcePage??0)}:{}),
    ...(paysOn?{payingEvent:paysOn}:{}),
    status:amount!=null?(missing.length?"potentially_applicable":"likely_applicable"):"needs_document",
    amountText:amount!=null?formatMoney(amount,currency):null,
    amountLabel:amount==null?undefined
      :args.declaredOnly?"Amount printed in the policy document — not yet confirmed against your own schedule"
      :aggregation==="reimbursement"?"Potential reimbursement":"Potential payout",
    ...(amount!=null?{estimateBasis}:{}),
    ...(amount!=null?{calculatedAmount:amount,currency,calculationKind:benefit.formulaKind as Exclude<CatalogFormulaKind,"none">,
      // A figure that has not been checked against the person's own schedule is
      // shown, but never summed into a headline household total.
      aggregation:args.declaredOnly?"reimbursement" as const:aggregation,calculationId:benefit.id}:{}),
    reason:amount!=null?basis+". "+(args.declaredOnly
        ?"This figure is the one printed on page "+(benefit.sourcePage??1)+" of the document you uploaded. Upload your schedule, certificate or statement to confirm it is the figure that applies to you."
        :estimateBasis==="indicative"
        ?"Estimated from the quoted clause on page "+(benefit.sourcePage??1)+". DearPolicy read the rate from the heading above this row rather than from the row itself, so confirm it on the Benefits page before relying on it."
        :estimateBasis==="estimated"
        ?(uncappedDaily
          ?"Estimated from the rate quoted on page "+(benefit.sourcePage??1)+" and the number of days you reported. The row does not state a day limit, so check the full wording for one."
          :"Estimated from the quoted clause on page "+(benefit.sourcePage??1)+" and a sum insured found in a document naming you, rather than in your own schedule or certificate.")
        :"Calculated from your policy schedule and the quoted clause on page "+(benefit.sourcePage??1)+".")+paidUnder
      :"This benefit can respond to what happened, but "+(missing[0]??"its payout rule")+" is still needed before an amount can be calculated.",
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
export function validateCatalogFormula(input:{
  kind:string;value:number|null;currency:string|null;quote:string;
  factKey:string|null;offsetDays:number|null;maximumDays:number|null;coverageCurrency?:string|null;
}):Pick<CatalogBenefit,"formulaKind"|"formulaValue"|"currency"|"factKey"|"offsetDays"|"maximumDays">{
  const none={formulaKind:"none" as const,formulaValue:null,currency:null,factKey:null,offsetDays:null,maximumDays:null};
  const quote=normalText(input.quote);
  const value=input.value;
  if(input.kind==="none"||value==null||!Number.isFinite(value)||value<0)return none;
  const quoted=explicitCurrency(input.quote);
  const currency=normalizeCurrencyCode(input.currency??quoted??input.coverageCurrency??null,quoted??input.coverageCurrency??"SGD");
  if(quoted&&quoted!==currency)return none;
  if(input.kind==="sum_insured"){
    if(/\b(?:less|minus|greater|lower|bonus|previous|deduct|reduced)\b/.test(quote))return none;
    const percentage=quote.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of\s*)?(?:the\s+)?(?:relevant\s+|applicable\s+)?sum (?:insured|assured)/)?.[1];
    const full=/\b(?:pay|pays|payable)\b[^.;]{0,100}\b(?:the |relevant |full |applicable )*sum (?:insured|assured)\b/.test(quote);
    if(percentage?Number(percentage)/100!==value:!full||value!==1)return none;
    return {formulaKind:"sum_insured",formulaValue:value,currency,factKey:null,offsetDays:null,maximumDays:null};
  }
  if(!numericTokens(quote).includes(String(value)))return none;
  const money=quote.match(/\b(?:sgd|usd|myr|php|eur|gbp)\s*([\d,]+(?:\.\d+)?)|(?:s\$|us\$|\$|€|£)\s*([\d,]+(?:\.\d+)?)/i);
  if(!money||Number((money[1]??money[2]).replace(/,/g,""))!==value)return none;
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
    const offset=after?Number(after):from?Number(from)-1:null;
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
export function describeBenefitFormula(benefit:Pick<CatalogBenefit,"formulaKind"|"formulaValue"|"currency"|"factKey"|"offsetDays"|"maximumDays">){
  const currency=normalizeCurrencyCode(benefit.currency,"SGD");
  const value=benefit.formulaValue;
  if(benefit.formulaKind==="sum_insured"&&value!=null)
    return (Math.round(value*1000)/10)+"% of the sum insured on your schedule";
  if(benefit.formulaKind==="fixed"&&value!=null)
    return formatMoney(value,currency);
  if(benefit.formulaKind==="expense_cap"&&value!=null)
    return "Reimburses the "+factKeyLabel(benefit.factKey)+", up to "+formatMoney(value,currency);
  if(benefit.formulaKind==="daily"&&value!=null){
    const after=benefit.offsetDays?" after the first "+benefit.offsetDays+" day"+(benefit.offsetDays===1?"":"s"):"";
    const cap=benefit.maximumDays!=null?", up to "+benefit.maximumDays+" days":"";
    return formatMoney(value,currency)+" per day"+after+cap;
  }
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
  const currency=normalizeCurrencyCode(input.currency,"SGD");
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
    needsReview:row.needs_review,basisInferred:row.basis_inferred===true,needsConfirmation:row.needs_confirmation===true,reviewedAt:row.reviewed_at??null};
}
/** A line from a certificate's cover table is not a benefit.
 *
 * A certificate prints one row per person per plan: an identity number, a name,
 * a plan, an amount. The table parser reads those rows like any other table, so
 * they were stored as benefits whose NAME is a masked NRIC and a person -- and
 * a row called "S****195A Ong Pei Lin Charmaine GROUP PERSONAL ACCIDENT (POLICY
 * NO. 3037850)" carrying S$1,000,000 was then matched to a claim by the word
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
  // A masked identity number ("S****048I") or a full one.
  if(/[A-Z]\s*\*{2,}\s*\d{2,}\s*[A-Z]/i.test(name))return true;
  if(/\b[STFGM]\d{7}[A-Z]\b/i.test(name))return true;
  return false;
}
export async function loadBenefitCatalog(accountId:string,policyIds:string[]){
  if(!policyIds.length)return [] as CatalogBenefit[];
  await ensureBenefitSchema();
  const r=await query<BenefitRow>(
    "SELECT id,policy_id,product_name,benefit_name,traits,requires,formula_kind,formula_value::text,currency,fact_key,offset_days,maximum_days,source_page,quote,conditions,requirements,needs_review,basis_inferred,reviewed_at::text,(basis_inferred AND reviewed_at IS NULL) AS needs_confirmation FROM policy_benefits WHERE account_id=$1 AND policy_id=ANY($2::uuid[]) ORDER BY benefit_name",
    [accountId,policyIds]);
  return resolveStoredRules(r.rows.map(toBenefit).filter(benefit=>!looksLikeCoverageLine(benefit.benefitName)));
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
    await query(
      "INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,fact_key,offset_days,maximum_days,source_page,quote,conditions,requirements,needs_review,basis_inferred,requires) VALUES($1,$2,$3,$4,$5::text[],$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18::text[])",
      [accountId,policyId,benefit.productName,benefit.benefitName,benefit.traits,benefit.formulaKind,
       benefit.formulaValue,benefit.currency,benefit.factKey,benefit.offsetDays,benefit.maximumDays,
       benefit.sourcePage,benefit.quote,JSON.stringify(benefit.conditions),JSON.stringify(benefit.requirements),benefit.needsReview,benefit.basisInferred===true,benefit.requires??[]]);
  }
  // Mark the document read even when it stated no rules at all. "Read and it
  // said nothing" and "never read" look identical in the benefit table, and
  // confusing them makes a document ask to be read again forever.
  await query("UPDATE policies SET benefits_indexed_at=now() WHERE id=$1 AND account_id=$2",[policyId,accountId]);
  return benefits.filter(benefit=>!kept.has(benefitKey(benefit.benefitName))).length;
}
/** Two spellings of the same benefit name are the same benefit. */
function benefitKey(name:string){return name.toLowerCase().replace(/[^a-z0-9]/g,"");}

// ---------------------------------------------------------------------------
// Answering from the catalogue: lookup plus arithmetic, no model involved.
// ---------------------------------------------------------------------------
import { productIdentity,type PolicyContract } from "@/lib/policies/inventory";
import type { ChatCitation } from "@/types";

/** Picks the insured amount this benefit is calculated from. A benefit is only
 * calculated against a coverage the person is actually proved to own. */
export function coverageForBenefit(contract:PolicyContract,benefit:CatalogBenefit){
  const wanted=productIdentity(benefit.productName);
  const identity=(coverage:OwnedCoverage)=>productIdentity(coverage.productName??coverage.policyName);
  const byProduct=contract.coverages.filter(coverage=>identity(coverage)===wanted);
  if(byProduct.length===1)return byProduct[0];
  if(!wanted&&contract.coverages.length===1)return contract.coverages[0];
  if(byProduct.length>1)return byProduct[0];
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
  const wantedCategory=accidentOnly?/accident/
    :triggers.includes("critical_illness")?/critical/
    :triggers.includes("total_permanent_disability")?/permanent|disab/
    :triggers.includes("death")?/death|life/
    :null;
  if(wantedCategory){
    const byEvent=contract.coverages.filter(coverage=>wantedCategory.test(category(coverage)));
    if(byEvent.length===1)return byEvent[0];
    // Several match: the one with a figure, if only one has one.
    const withAmount=byEvent.filter(coverage=>coverage.amount!=null);
    if(withAmount.length===1)return withAmount[0];
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
  return benefits.filter(benefit=>best.get(key(benefit.benefitName))===benefit);
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
  hospitalNights:"Were you admitted to hospital, and for how many nights?",
  hospitalBill:"How much was the hospital bill?",
  ambulanceBill:"How much was the ambulance charge?",
  vehicleRepairBill:"How much was the repair bill?",
  outOfPocket:"How much did you pay out of your own pocket?",
};
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
      const currency=normalizeCurrencyCode(coverage.currency)??"SGD";
      const label=coverage.productName&&normalText(coverage.productName)!==normalText(coverage.category)?coverage.productName+" ("+coverage.category+")":coverage.category;
      items.push({
        title:args.contract.ownerName+" · "+label+" — "+rule.pays,
        status:missing.length?"potentially_applicable":"likely_applicable",
        amountText:formatMoney(coverage.amount,currency),amountLabel:"Potential payout",
        estimateBasis:rule.basis,calculatedAmount:coverage.amount,currency,calculationKind:"sum_insured",aggregation:"additive",calculationId:"coverage:"+coverage.id,
        coverKey:coverKey({policyNumber:coverage.policyNumber,groupPolicyNumber:coverage.groupPolicyNumber,
          insurer:coverage.insurer??args.contract.insurer??null,
          productName:canonicalProduct(coverage.productName??coverage.policyName??coverage.category),
          contractId:args.contract.id,contractName:args.contract.name}),
        ...(payingEvent(benefitTriggerEvents(rule.pays,rule.rule),events)?{payingEvent:payingEvent(benefitTriggerEvents(rule.pays,rule.rule),events)!}:{}),
        reason:"Your "+(coverage.evidenceText?"document":"schedule")+" shows "+formatMoney(coverage.amount,currency)+" of "+label+" cover for "+args.contract.ownerName+(coverage.sourcePage?" (page "+coverage.sourcePage+")":"")+". "
          +"No benefit table for this plan has been read, so this assumes the standard rule: "+rule.rule+". "
          +(rule.basis==="indicative"?"Shown for reference and not added to the total until the plan's own wording is read.":"Upload the policy wording or benefit summary and DearPolicy will calculate from the actual clause instead."),
        conditions:[...missing.map(m=>"Still needed: "+m),"Subject to the insurer's assessment and the plan's own terms and exclusions."],
      });
      citations.push({chunkId:"coverage:"+coverage.id,policyId:coverage.policyId,policyName:coverage.productName??args.contract.name,insurer:coverage.insurer??args.contract.insurer??undefined,
        pageStart:coverage.sourcePage??1,pageEnd:coverage.sourcePage??1,personalEvidence:true,evidenceLabel:"Verified personal cover"});
      break;
    }
  }
  return {items,citations};
}
export function scenarioFromCatalog(args:{contract:PolicyContract;catalog:CatalogBenefit[];traits:ScenarioTrait[];events?:ClaimEventType[]}){
  const events=args.events??reportedClaimEvents({},args.traits);
  const documentIds=new Set([...args.contract.documents,...args.contract.references].map(d=>d.id));
  const mine=preferStatedRules(args.catalog.filter(benefit=>documentIds.has(benefit.policyId)));
  const items:ClaimItem[]=[];const citations:ChatCitation[]=[];const needs:ScenarioNeed[]=[];
  const seen=new Set<string>();
  const declaredOnly=args.contract.ownershipBasis==="declared";
  for(const {benefit} of matchBenefits(mine,args.traits,events)){
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
      pageStart:benefit.sourcePage??1,pageEnd:benefit.sourcePage??1,
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
  const mine=preferStatedRules(args.catalog.filter(benefit=>documentIds.has(benefit.policyId)));
  const items:ClaimItem[]=[];const citations:ChatCitation[]=[];
  const seen=new Set<string>();
  const declaredOnly=args.contract.ownershipBasis==="declared";
  const matches=matchBenefits(mine,args.traits,events);
  const excludedByFact=factExclusions(args.facts);
  const inPlay=matches.filter(match=>!excludedByFact(match.benefit));
  for(const {benefit} of inPlay){
    const coverage=coverageForBenefit(args.contract,benefit);
    // Without a schedule there is no coverage row, but the person has told us
    // they hold this policy, so its own stated figures still apply to them.
    if(!coverage&&!declaredOnly)continue;
    const key=benefit.benefitName.toLowerCase().replace(/[^a-z0-9]/g,"");
    if(seen.has(key))continue;seen.add(key);
    const {item}=assessCatalogBenefit({benefit,coverage,ownerName:args.contract.ownerName,facts:args.facts,declaredOnly,
      contractId:args.contract.id,contractName:args.contract.name,insurer:args.contract.insurer,events});
    if(predatesCover)item.conditions=[...new Set([...item.conditions,predatesCover])];
    items.push(item);
    citations.push({chunkId:"benefit:"+benefit.id,policyId:benefit.policyId,
      policyName:benefit.productName??args.contract.name,insurer:args.contract.insurer??undefined,
      pageStart:benefit.sourcePage??1,pageEnd:benefit.sourcePage??1,
      evidenceLabel:"Policy wording, read when the document was uploaded"});
    if(coverage)citations.push({chunkId:"coverage:"+coverage.id,policyId:coverage.policyId,
      policyName:coverage.productName??args.contract.name,insurer:coverage.insurer??undefined,
      pageStart:coverage.sourcePage??1,pageEnd:coverage.sourcePage??1,
      documentRole:coverage.documentRole,personalEvidence:true,evidenceLabel:"Verified personal cover"});
  }
  const excluded=ruledOutBenefits(mine,args.traits,events);
  const byFact=matches.filter(match=>!inPlay.includes(match)).map(match=>({benefit:match.benefit,because:excludedByFact(match.benefit)||"ruled out by what you told me"}));
  return {items,citations,considered:mine.length,matches:inPlay,ruledOut:[...excluded,...byFact]};
}
/** What the person has already said rules out, deterministically. "No
 * ambulance" ends every ambulance benefit and its question; "not admitted"
 * ends the hospital ones. Asking about a charge for a thing that did not
 * happen is the fastest way to lose someone's trust. */
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
