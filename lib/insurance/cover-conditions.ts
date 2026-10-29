import { knownValue } from "@/lib/chat/facts";
import type { SubjectFacts } from "@/lib/chat/types";
import type { ClaimItem } from "@/types";
import type { ClaimEventType } from "./claim-events";

/** The reasons a policy does NOT pay, which is the half of a contract this
 * system could not see.
 *
 * Every benefit rule in the catalogue answers "how much". None of them answer
 * "unless". The unlesses live in prose -- exclusion lists, waiting periods,
 * survival periods, aggregate caps, the sentence that ends the cover once the
 * sum insured has been paid -- and the row parser walks straight past them,
 * because they are sentences and not table rows. A benefit summary of
 * seventeen pages yielded fifty-three rules and not one condition.
 *
 * That is the whole legal exposure of this product in one line: it can tell a
 * person their policy pays, on a death the policy explicitly excludes.
 *
 * These records are attached to a COVER, not to a benefit row, because that is
 * how the document writes them: one exclusion paragraph governs every benefit
 * under Group Term Life, and the Group Personal Accident paragraph next to it
 * says the opposite about pre-existing conditions. They are applied after the
 * amount has been calculated, never instead of calculating it. */
export type CoverConditionKind=
  |"exclusion"
  |"waiting_period"
  |"survival_period"
  |"time_bar_from_inception"
  |"aggregate_cap"
  |"sub_limit"
  |"terminates_on_full_payment"
  |"notice_period"
  |"age_limit"
  |"payment_precondition";

/** A closed list, for the same reason claim events are a closed list: an open
 * one becomes a synonym problem, and a synonym problem becomes a wrong answer.
 * Anything outside it is stored as "other" and shown as written. */
export type ExcludedCause=
  |"suicide"|"self_inflicted"|"pre_existing"|"war"|"terrorism"|"aviation"
  |"racing"|"hazardous_sport"|"hiv"|"pregnancy"|"alcohol_or_drugs"
  |"criminal_act"|"nuclear"|"mental_health"|"other";

export type CoverCondition={
  id?:string;
  policyId?:string;
  /** Which cover this governs. Null means the document states it once for
   * everything it covers. */
  productName:string|null;
  kind:CoverConditionKind;
  cause:ExcludedCause|null;
  /** The claim events this bears on. Empty means all of them: an aggregate cap
   * does not care what happened. */
  appliesToEvents:ClaimEventType[];
  /** The illnesses a waiting period names, where it names them. */
  conditionNames:string[];
  days:number|null;
  amount:number|null;
  amountBasis:"fixed"|"sum_insured_fraction"|null;
  scope:"per_claim"|"per_accident"|"per_policy_year"|"aggregate"|"lifetime"|null;
  /** The sentence that takes the condition back off again -- "unless caused
   * solely and directly by an Accident". Kept verbatim: paraphrasing a carve-out
   * is how a correct exclusion becomes a wrong refusal. */
  carveOut:string|null;
  sourcePage:number|null;
  quote:string;
  needsReview?:boolean;
};

/** Whether the facts a person has given can settle this, or whether it can only
 * ever be stated.
 *
 * This is the distinction the whole layer turns on. A waiting period is
 * arithmetic on two dates we hold, so it changes the number. An exclusion for
 * war is a question about the cause of a loss, which nothing in a claim
 * conversation establishes and which only the insurer decides -- so it is said
 * out loud next to the figure and never subtracted from it. Removing money on
 * a guess would be the same error as promising money on a guess, pointing the
 * other way. */
export function conditionIsDecidable(kind:CoverConditionKind){
  return kind!=="exclusion"&&kind!=="age_limit";
}

const CAUSE_WORDS:Record<ExcludedCause,string>={
  suicide:"suicide",
  self_inflicted:"a self-inflicted injury",
  pre_existing:"a condition that already existed before the cover started",
  war:"war",
  terrorism:"terrorism",
  aviation:"flying other than as a passenger on a licensed airline",
  racing:"racing on wheels",
  hazardous_sport:"a hazardous sport",
  hiv:"HIV or AIDS",
  pregnancy:"pregnancy or childbirth",
  alcohol_or_drugs:"alcohol or drug misuse",
  criminal_act:"taking part in a criminal act",
  nuclear:"nuclear or radioactive causes",
  mental_health:"a mental health condition",
  other:"a cause the policy names",
};

/** A number a policy could actually have printed, or nothing.
 *
 * Extraction is a model reading a page, and a model can return a period of
 * NaN days or a cap of minus five hundred dollars as easily as it can return
 * ninety. Neither is a condition; both would otherwise reach the arithmetic,
 * and a cap of NaN turns a million-dollar death benefit into "S$NaN" on the
 * card of someone who has just been bereaved. Anything that is not a finite,
 * non-negative number is treated as a condition with no figure attached --
 * which is stated, never applied. */
function usable(value:number|null|undefined){
  return typeof value==="number"&&Number.isFinite(value)&&value>=0?value:null;
}
/** A CEILING a policy could have printed. Zero is not one.
 *
 * A cap of nothing is not a cap, it is an extraction that went wrong, and
 * acting on it would silently reduce a real benefit to nothing. Withholding
 * money someone is owed is the worse of the two possible errors here, so a
 * ceiling has to be a positive figure before it is allowed to bite. */
function usableCeiling(value:number|null|undefined){
  const amount=usable(value);
  return amount!=null&&amount>0?amount:null;
}
/** What a stored cap's own sentence says about its figure. "cap": the sentence prints the stored figure right after a
 * phrase that caps it ("a maximum of S$5,000", "limited to RM10,000", "up to fifty percent of the Sum Assured",
 * "Benefit limit: 5,000", or the figure followed by "maximum" / "whichever is lower"), with no minimum, excess,
 * deductible, co-payment or premium word just before the figure. "not_cap": the sentence prints the figure as something
 * else: a minimum or threshold ("at least S$1,000", "bills exceeding S$2,000"), an excess, a premium, or a count ("a
 * maximum of 6 claims"). "unsure": anything else (no quote, a figure the sentence does not print, a cap phrase not
 * listed here). An unsure cap is never applied and never ignored: a figure above it is not shown (evaluateCondition),
 * because a wrong cap understates a claim and a missed one overstates it. Stored conditions showed why: "the amount
 * withdrawn is at least S$1,000" and "a maximum of 6 claims" were caps of S$1,000 and S$6 that cut a S$100,000 death
 * benefit and a Special Benefit; "Up to S$500 per incident" was stored as S$500,000. */
export type CapReading={kind:"cap";amount:number}|{kind:"not_cap"}|{kind:"unsure"};
const CAP_PHRASE=String.raw`(?:max(?:imum|\.)?|up\s+to|limit(?:ed)?(?:\s+to)?|capped\s+at|cap|ceiling|restricted\s+to|not\s+exceed|cannot\s+exceed|no\s+more\s+than|not\s+more\s+than|pay\s+more\s+than|the\s+lower\s+of|the\s+lesser\s+of|had(?:\s+maksimum)?|maksimum|tidak\s+melebihi|sehingga|最高(?:赔偿)?|上限)`;
/** A cap phrase, then up to a few plain words ("per policy year", "of the", "amount of"), then the figure. */
const CAP_BEFORE=new RegExp(CAP_PHRASE+String.raw`(?:\s+(?:of|is|an?|the|amount|benefit|sum|insured|assured|for|this|that|payable|cover|over|per|policy|year|any|one|each|disability|claim|lifetime|in|total|aggregate|keseluruhan|pelan|ini|ialah|adalah|daripada|bagi|setiap|tahun|polisi)){0,6}\s*[:\-–]?\s*$`,"iu");
/** "The most we will pay for TI claims on the same life is S$1.0 million." */
const MOST_WE_PAY=/\bmost\s+(?:we|the\s+company|the\s+insurer|the\s+plan)(?:['’]ll|\s+(?:will|shall|would|can))\s+pay\b[^.;\n]{0,60}\bis\s*$/iu;
const CAP_AFTER=/^\s*(?:\(?max(?:imum|\.)?\)?(?![^.;\n]{0,8}\d)|in\s+(?:total|aggregate)\b|,?\s*whichever\s+is\s+(?:the\s+)?(?:lower|less|lesser))/iu;
/** Words that make the figure next to them something other than a cap: a minimum, a threshold ("more than", "under"),
 * an excess, a premium, a sum insured, or an age ("up to age 65", "maximum entry age of 70", TE #188 H3). */
const NOT_CAP_WORD=String.raw`(?:\bmin(?:imum|\.)?|\bat\s+least|\bthreshold|(?<!(?:not|cannot|never|n['’]t)\s)\bexceed(?:s|ing)?|(?<!no\s)\babove|(?<!not\s)\bover|(?<!(?:no|not|never|n['’]t)\s)\bmore\s+than|\bless\s+than|\bunder|\bbelow|\bage[ds]?|\bexcess|\bdeductible|\bco-?(?:payment|pay|insurance)|\bpremiums?|(?<!max(?:imum|\.)?\s)\bsum\s+(?:insured|assured))\b`;
const NOT_CAP_BEFORE=new RegExp(NOT_CAP_WORD+String.raw`[^.;\n]{0,25}$`,"iu");
const NOT_CAP_ANY=new RegExp(NOT_CAP_WORD,"giu");
/** A label that is a cap, ending in a colon right before the figure ("Maximum Sum Assured for Accidental Death:",
 * "Sub-limit for outpatient cancer treatment:"), words only. */
const CAP_LABEL=new RegExp(CAP_PHRASE+String.raw`(?:\s+[\p{L}’'&/()-]+){0,7}\s*:\s*$`,"iu");
const COUNT_AFTER=/^\s*(?:claims?|visits?|times|sessions?|treatments?|consultations?|days?|nights?|weeks?|months?|years?|people|persons|children|trips?|occurrences?)\b/iu;
const CURRENCY=String.raw`(?:S\$|US\$|A\$|HK\$|NZ\$|£|€|¥|₹|\$|(?<![\p{L}])(?:SGD|USD|MYR|RM|GBP|EUR|AUD|HKD|NZD|JPY|CNY|RMB|INR|Rs\.?|PHP|IDR|Rp\.?|THB)\s?)`;
const FIGURE=new RegExp(String.raw`(${CURRENCY})?\s*(\d[\d,]*(?:\.\d+)?)\s*(million|mil|m|k|thousand)?(?![\d\p{L}])`,"giu");
const WORD_FRACTIONS:Record<string,number>={half:0.5,"one half":0.5,"a half":0.5,quarter:0.25,"one quarter":0.25,"a quarter":0.25,"one third":1/3,"a third":1/3,"two thirds":2/3,"three quarters":0.75};
const TENS:Record<string,number>={ten:10,twenty:20,"twenty-five":25,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,"seventy-five":75,eighty:80,ninety:90,"one hundred":100,hundred:100};
/** Each figure a sentence prints, with where it is. A share is a fraction (50% = 0.5). */
function figuresIn(sentence:string,share:boolean){
  const out:{value:number;start:number;end:number;money:boolean}[]=[];
  if(share){
    for(const m of sentence.matchAll(/(\d+(?:\.\d+)?)\s*(?:%|per\s?cent\b)/giu))out.push({value:Number(m[1])/100,start:m.index!,end:m.index!+m[0].length,money:false});
    for(const m of sentence.matchAll(/\b(ten|twenty(?:-five)?|thirty|forty|fifty|sixty|seventy(?:-five)?|eighty|ninety|one hundred|hundred)\s*(?:per\s?cent|%)/giu))
      out.push({value:TENS[m[1].toLowerCase()]/100,start:m.index!,end:m.index!+m[0].length,money:false});
    for(const m of sentence.matchAll(/\b(one half|a half|half|one quarter|a quarter|quarter|one third|a third|two thirds|three quarters)\b/giu))
      out.push({value:WORD_FRACTIONS[m[1].toLowerCase()],start:m.index!,end:m.index!+m[0].length,money:false});
    return out;
  }
  for(const m of sentence.matchAll(FIGURE)){
    const base=Number(m[2].replace(/,/g,""));if(!Number.isFinite(base))continue;
    const unit=(m[3]??"").toLowerCase();
    out.push({value:base*(unit==="million"||unit==="mil"||unit==="m"?1_000_000:unit==="k"||unit==="thousand"?1_000:1),start:m.index!,end:m.index!+m[0].length,money:!!m[1]});
  }
  return out;
}
export function capReading(condition:Pick<CoverCondition,"amount"|"amountBasis"|"quote">):CapReading{
  const amount=usableCeiling(condition.amount);
  const quote=(condition.quote??"").trim();
  if(amount==null||!quote)return {kind:"unsure"};
  const share=condition.amountBasis==="sum_insured_fraction";
  let notCap=false;
  for(const sentence of quote.split(/(?<!\d)[.;](?!\d)|\n/u)){
    for(const f of figuresIn(sentence,share)){
      if(Math.abs(f.value-amount)>(share?1e-6:0.005))continue;
      const before=sentence.slice(Math.max(0,f.start-80),f.start),after=sentence.slice(f.end);
      if(!share&&COUNT_AFTER.test(after)){notCap=true;continue;}
      // The phrase nearest the figure decides (Critic R353): "after the deductible and co-insurance, up to S$150,000" and
      // "S$5,000, whichever is lower" are caps; "maximum entry age of 70" is not. A bare figure (no currency) is a cap only
      // when a cap phrase names it right before it.
      if(CAP_BEFORE.test(before)||MOST_WE_PAY.test(before)||((f.money||share)&&CAP_AFTER.test(after)))return {kind:"cap",amount};
      const label=before.match(CAP_LABEL);
      if(label){
        const from=before.length-label[0].length;
        if(![...before.matchAll(NOT_CAP_ANY)].some(m=>m.index!>from))return {kind:"cap",amount};
      }
      if(NOT_CAP_BEFORE.test(before)){notCap=true;continue;}
    }
  }
  return notCap?{kind:"not_cap"}:{kind:"unsure"};
}
/** The cap's figure when its sentence prints it as a cap, otherwise null (see capReading). */
export function printedCap(condition:Pick<CoverCondition,"amount"|"amountBasis"|"quote">):number|null{
  const r=capReading(condition);
  return r.kind==="cap"?r.amount:null;
}
/** The benefit an answer's item is for: its title after the plan ("Ada · Example Protector — Death" is "death"). */
function benefitOf(item:ClaimItem){
  const title=(item.title??"").toLowerCase();
  const cut=Math.max(title.lastIndexOf(" — "),title.lastIndexOf(" · "));
  return cut<0?title:title.slice(cut+3);
}
const phrase=(text:string)=>" "+text.toLowerCase().replace(/\bbenefits?\b/g," ").replace(/[^\p{L}\p{N}]+/gu," ").trim()+" ";
/** Words that name no benefit of their own: how a limit is said ("is limited to", "subject to a maximum of"), and the
 * words every benefit shares. What is left in a limit's sentence before its figure names what the limit is for. */
const PLAIN_WORDS=new Set(("the a an this that these those its it is are be been will shall would can may must we you our your of to for in on at by "
  +"with from as and or any each one per all under subject limit limited limits sub max maximum up cap capped ceiling restricted not no more than "
  +"exceed cannot pay pays paid payable amount amounts total aggregate overall sum insured assured benefit benefits cover covers coverage plan plans "
  +"policy policies year years lifetime claim claims life insured person most which whichever lower lesser of has have shown schedule "
  +"stated set out had maksimum keseluruhan pelan ini ialah adalah bagi setiap tahun polisi sehingga tidak melebihi daripada manfaat").split(" "));
const contentWords=(text:string)=>text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>1&&!PLAIN_WORDS.has(w)&&!/^\d/.test(w));
/** What a limit's own sentence names before its figure ("Funeral expenses benefit is limited to S$5,000": funeral,
 * expenses), less the words of the cover it is stored under ("Double Critical Cover: subject to a limit": nothing). */
function limitSubject(condition:CoverCondition):string[]{
  const quote=condition.quote??"";
  const at=quote.search(/(?:S\$|US\$|RM|£|€|\$|\b(?:SGD|USD|MYR|GBP|EUR)\b)?\s*\d/u);
  const plan=new Set(contentWords(condition.productName??""));
  return contentWords(at<0?quote:quote.slice(0,at)).filter(w=>!plan.has(w));
}
/** Whom a sub-limit is for (TE #188 H1, M2). "this": its sentence names the benefit ("Hospital Cash is limited to
 * S$5,000", "ICU Benefit: up to S$25,000" for "Intensive Care Unit (ICU) Benefit"), or the cover it is stored under is the
 * benefit's own name. "other": its sentence names something else ("Funeral expenses benefit is limited to S$5,000" is no
 * limit on the death benefit). "unknown": it names nothing ("Double Critical Cover: subject to a limit of S$25,000"). */
function limitIsFor(condition:CoverCondition,item:ClaimItem):"this"|"other"|"unknown"{
  const benefit=phrase(benefitOf(item));
  if(benefit.trim().length>=3&&phrase(condition.quote??"").includes(benefit))return "this";
  if(condition.productName&&phrase(condition.productName)===benefit)return "this";
  const subject=limitSubject(condition);
  // A sentence that names a part of the plan ("Double Cover: subject to a limit") names a cover, whose benefits it does
  // not say: unknown, as with no name at all.
  const head=(condition.quote??"").split(/(?:S\$|US\$|RM|£|€|\$)?\s*\d/u)[0];
  if(!subject.length||/\p{L}+\s+(?:cover|plan|rider|policy)\b/iu.test(head))return "unknown";
  const own=new Set([...contentWords(benefitOf(item)),...[...benefitOf(item).matchAll(/\(([\p{L}]{2,6})\)/gu)].map(m=>m[1].toLowerCase())]);
  return subject.every(w=>own.has(w))?"this":"other";
}
/** The same, for a period: a policy states whole days. */
function usableDays(value:number|null|undefined){
  const days=usable(value);
  return days==null?null:Math.round(days);
}
function isoDate(value:unknown){
  return typeof value==="string"&&/^\d{4}-\d{2}-\d{2}/.test(value)?value.slice(0,10):null;
}
function daysBetween(from:string,to:string){
  const a=Date.parse(from+"T00:00:00Z"),b=Date.parse(to+"T00:00:00Z");
  if(!Number.isFinite(a)||!Number.isFinite(b))return null;
  return Math.round((b-a)/86_400_000);
}
function addDays(from:string,days:number){
  const a=Date.parse(from+"T00:00:00Z");
  if(!Number.isFinite(a))return null;
  return new Date(a+days*86_400_000).toISOString().slice(0,10);
}
/** The date the benefit responds to, in the order the contract would read them:
 * the diagnosis for a living benefit, the accident for an injury, the death
 * last. */
function claimDate(facts:SubjectFacts,prefer:"diagnosis"|"event"="event"){
  const diagnosis=isoDate(knownValue(facts,"diagnosisDate"));
  const accident=isoDate(knownValue(facts,"accidentDate"));
  const event=isoDate(knownValue(facts,"eventDate"));
  const death=isoDate(knownValue(facts,"deathDate"));
  if(prefer==="diagnosis"&&diagnosis)return diagnosis;
  return diagnosis??accident??event??death??null;
}

/** What one condition does to one figure.
 *
 * "clear" is the outcome that matters most and the one a caveat-generator
 * would never produce: the facts satisfy the condition, so it is deleted
 * rather than displayed. A policy carries dozens of conditions and almost all
 * of them are met. An answer that lists every one of them teaches the person
 * to stop reading the list, which leaves them worse informed than an answer
 * that listed none -- and it buries the one condition that actually bites. */
export type ConditionOutcome=
  |{kind:"clear"}
  |{kind:"caveat";text:string;weight:number}
  |{kind:"reduce";to:number;text:string}
  /** A figure that may be above a limit DearPolicy cannot place: it is not shown, so it can never overstate a claim. */
  |{kind:"withhold";text:string}
  |{kind:"blocked";text:string};

/** Does a reported fact name the excluded cause outright?
 *
 * Only a handful of causes can ever be read off a claim conversation, and this
 * reads only those. Everything it cannot see returns null, which keeps the
 * exclusion a caveat. */
function factNamesCause(cause:ExcludedCause|null,facts:SubjectFacts):boolean|null{
  if(!cause)return null;
  const cod=String(knownValue(facts,"causeOfDeath")??"").toLowerCase();
  const diagnosis=String(knownValue(facts,"diagnosis")??"").toLowerCase();
  const text=cod+" "+diagnosis;
  if(cause==="racing"){
    const racing=knownValue(facts,"competitiveRacing");
    if(racing===true)return knownValue(facts,"racingAuthoritySanctioned")===true?false:true;
    if(racing===false)return false;
    return null;
  }
  if(cause==="suicide"||cause==="self_inflicted")
    return /suicide|took (his|her|their) own life|self[- ]inflicted/.test(text)?true:null;
  if(cause==="pregnancy")return /pregnan|childbirth|miscarriage/.test(text)?true:null;
  if(cause==="hiv")return /\bhiv\b|aids/.test(text)?true:null;
  return null;
}

type ApplyArgs={
  items:ClaimItem[];
  conditions:CoverCondition[];
  facts:SubjectFacts;
  /** The date the cover on file starts, used for waiting periods and for the
   * time bars written as "within 12 months of the commencement date". */
  coverStart?:string|null;
  /** Today, injected so the tests are not a clock. */
  today?:string;
};

/** Which conditions bear on this figure at all.
 *
 * A cover condition governs a cover. It is matched on the cover's own name
 * where the document scoped it to one, and on the paying event where the
 * condition names events. A document-wide condition governs everything in that
 * document. */
function conditionsForItem(item:ClaimItem,conditions:CoverCondition[]){
  const cover=(item.coverLabel??"").toLowerCase();
  return conditions.filter(condition=>{
    if(condition.productName){
      const named=condition.productName.toLowerCase();
      if(cover&&!cover.includes(named)&&!named.includes(cover))return false;
    }
    if(condition.appliesToEvents.length&&item.payingEvent
      &&!condition.appliesToEvents.includes(item.payingEvent as ClaimEventType))return false;
    return true;
  });
}

function money(amount:number,currency?:string){
  return (currency??"SGD").replace("SGD","S$")+amount.toLocaleString("en-SG",{maximumFractionDigits:2});
}

/** Test one condition against the facts and one figure. */
export function evaluateCondition(raw:CoverCondition,args:{item:ClaimItem;facts:SubjectFacts;
  coverStart?:string|null;today:string}):ConditionOutcome{
  const {item,facts,coverStart,today}=args;
  // Nothing downstream sees a figure the policy could not have printed.
  const condition:CoverCondition={...raw,days:usableDays(raw.days),amount:usable(raw.amount)};
  const quoteTail=condition.quote?" The policy says: “"+condition.quote.trim().slice(0,160)+"”":"";
  switch(condition.kind){
    case "waiting_period":{
      // Named illnesses only, where the policy named them: a 90-day wait on
      // five cancers must not silence a fracture benefit.
      if(condition.conditionNames.length){
        const diagnosis=String(knownValue(facts,"diagnosis")??"").toLowerCase();
        if(diagnosis&&!condition.conditionNames.some(name=>diagnosis.includes(name.toLowerCase().slice(0,12))))return {kind:"clear"};
      }
      // The carve-out that gives the period back. An accident does not wait.
      if(condition.carveOut&&/accident/i.test(condition.carveOut)
        &&(knownValue(facts,"accidentalDeath")===true||isoDate(knownValue(facts,"accidentDate"))))return {kind:"clear"};
      const start=coverStart?isoDate(coverStart):null;
      const when=claimDate(facts,"diagnosis");
      if(!start||!when||condition.days==null)
        return {kind:"caveat",weight:3,text:condition.days==null
          ?"this cover has a waiting period after it starts, and the policy wording DearPolicy read does not state how long."+quoteTail
          :"this cover has a "+condition.days+"-day waiting period from the date it started, and DearPolicy does not hold both dates to check it."+quoteTail};
      const elapsed=daysBetween(start,when);
      if(elapsed==null)return {kind:"clear"};
      if(elapsed>=condition.days)return {kind:"clear"};
      const opens=addDays(start,condition.days);
      return {kind:"blocked",text:"this cover's "+condition.days+"-day waiting period had not finished. It started on "
        +start+" and ran to "+opens+"; what you described is dated "+when+"."+quoteTail};
    }
    case "survival_period":{
      const diagnosed=isoDate(knownValue(facts,"diagnosisDate"));
      const died=isoDate(knownValue(facts,"deathDate"));
      if(condition.days==null)return {kind:"clear"};
      if(diagnosed&&died){
        const survived=daysBetween(diagnosed,died);
        if(survived!=null&&survived<condition.days)
          return {kind:"blocked",text:"this benefit is paid to the person diagnosed and requires them to survive "
            +condition.days+" days from diagnosis. Diagnosis was "+diagnosed+" and the death "+died+"."+quoteTail};
        return {kind:"clear"};
      }
      if(diagnosed){
        const due=addDays(diagnosed,condition.days);
        if(due&&due>today)
          return {kind:"caveat",weight:4,text:"this benefit requires "+condition.days+" days' survival from the diagnosis on "
            +diagnosed+", so it becomes payable on "+due};
        return {kind:"clear"};
      }
      return {kind:"caveat",weight:2,text:"this benefit requires the person to survive "+condition.days+" days from diagnosis"};
    }
    case "time_bar_from_inception":{
      // A cause excluded only for a while. The cause is the insurer's to
      // determine; the window is arithmetic, and once it has closed the
      // condition is gone and should not be mentioned at all.
      const start=coverStart?isoDate(coverStart):null;
      const when=claimDate(facts);
      const named=factNamesCause(condition.cause,facts);
      if(start&&when&&condition.days!=null){
        const elapsed=daysBetween(start,when);
        if(elapsed!=null&&elapsed>=condition.days)return {kind:"clear"};
        if(named===true)
          return {kind:"blocked",text:"the policy does not cover "+CAUSE_WORDS[condition.cause??"other"]
            +" within "+condition.days+" days of the cover starting on "+start+", and what you described falls inside that."+quoteTail};
        if(named===false)return {kind:"clear"};
        return {kind:"caveat",weight:5,text:"the cover started on "+start+" and the policy does not pay for "
          +CAUSE_WORDS[condition.cause??"other"]+" in its first "+condition.days+" days"};
      }
      if(named===true)
        return {kind:"caveat",weight:5,text:"the policy does not pay for "+CAUSE_WORDS[condition.cause??"other"]
          +(condition.days==null?" for a period after the cover starts":" within "+condition.days+" days of the cover starting")
          +", and DearPolicy does not hold the date it started"};
      return {kind:"clear"};
    }
    case "exclusion":{
      const named=factNamesCause(condition.cause,facts);
      // Never subtracted. An exclusion is a statement about the cause of a
      // loss, and the cause of a loss is decided on evidence this system has
      // not seen. Even when a fact names it, the figure stays and the sentence
      // gets louder.
      if(named===false)return {kind:"clear"};
      if(named===true)
        return {kind:"caveat",weight:9,text:"you described "+CAUSE_WORDS[condition.cause??"other"]
          +", and this cover excludes it, so the insurer may decline this benefit entirely."+quoteTail};
      return {kind:"caveat",weight:1,text:"this cover does not pay when the cause is "+CAUSE_WORDS[condition.cause??"other"]};
    }
    case "sub_limit":{
      const current=item.calculatedAmount;
      const read=capReading(raw);
      const stated=usableCeiling(condition.amount);
      if(current==null||stated==null||read.kind==="not_cap")return {kind:"clear"};
      const ceiling=condition.amountBasis==="sum_insured_fraction"
        ?(item.coverAmount!=null?Math.min(stated*item.coverAmount,item.coverAmount):null):stated;
      if(ceiling!=null&&current<=ceiling)return {kind:"clear"};
      const limit=ceiling!=null?money(ceiling,item.currency):"a share of the sum insured";
      // A limit that may be this benefit's: the figure above it is not shown, and never shown uncapped.
      const whose=limitIsFor(raw,item);
      if(whose==="other")return {kind:"clear"};
      if(read.kind==="unsure"||ceiling==null||whose==="unknown")
        return {kind:"withhold",text:"the policy states a limit of "+limit+(raw.productName?" under "+raw.productName:"")
          +" that may apply to "+item.title+", so no amount is shown for it."+quoteTail};
      return {kind:"reduce",to:ceiling,text:item.title+" was reduced from "+money(current,item.currency)
        +" to "+money(ceiling,item.currency)+", which is the most this benefit pays"};
    }
    case "notice_period":{
      const when=claimDate(facts);
      if(!when||condition.days==null)return {kind:"clear"};
      const deadline=addDays(when,condition.days);
      if(!deadline)return {kind:"clear"};
      if(deadline<today)
        return {kind:"caveat",weight:8,text:"the policy asks to be told about a claim within "+condition.days
          +" days, and that ran out on "+deadline+" — tell the insurer now and say why it is late"};
      return {kind:"caveat",weight:6,text:"the insurer must be told by "+deadline+", which is "+condition.days
        +" days from "+when};
    }
    case "payment_precondition":
      return {kind:"caveat",weight:4,text:item.title+" is only paid if nothing else has been paid under this cover"+quoteTail};
    case "terminates_on_full_payment":
      if(item.calculationKind==="sum_insured"&&item.coverAmount!=null&&item.calculatedAmount===item.coverAmount)
        return {kind:"caveat",weight:5,text:"paying this in full ends the cover, so nothing further is payable under it afterwards"};
      return {kind:"clear"};
    case "age_limit":
      return {kind:"caveat",weight:2,text:"this cover ends at the age the policy states, so it only responds if the member was still within it"};
    case "aggregate_cap":
      return {kind:"clear"};// handled across items, below
    default:
      return {kind:"clear"};
  }
}

export type ConditionsResult={qualifiers:string[];blocked:{title:string;reason:string}[]};

/** Apply a document's conditions to an answer's figures.
 *
 * The items are changed in place, the way the overlap and aggregate-cap passes
 * already work, so a caller holding a reference to one of them sees the same
 * figure the answer will show.
 *
 * Order matters. Blocks first, so a benefit that cannot respond is not then
 * capped or summed; reductions next; the aggregate cap last, over what
 * survives. Caveats are collected throughout and ranked, because the answer
 * has room for a few and the ones that bite must be the ones shown. */
export function applyCoverConditions(args:ApplyArgs):ConditionsResult{
  const today=args.today??new Date().toISOString().slice(0,10);
  // Collected as a map rather than a list. Two of a household's benefits under
  // the same cover produce the same sentence, and a household with hundreds of
  // benefits produced hundreds of thousands of them -- which then had to be
  // de-duplicated against each other one by one. Seven seconds of a person's
  // turn went into composing a paragraph that four lines of it would survive.
  const caveats=new Map<string,number>();
  const say=(text:string,weight:number)=>{
    const line=text.replace(/\s+/g," ").trim();
    if(!line)return;
    caveats.set(line,Math.max(caveats.get(line)??0,weight));
  };
  const blocked:{title:string;reason:string}[]=[];
  const items=args.items;
  const withhold=(item:ClaimItem,text:string)=>{
    delete item.calculatedAmount;
    item.amountText=null;
    item.conditions=[...new Set([...(item.conditions??[]),text])];
    say(text,7);
  };
  for(const item of items){
    for(const condition of conditionsForItem(item,args.conditions)){
      const outcome=evaluateCondition(condition,{item,facts:args.facts,coverStart:args.coverStart,today});
      if(outcome.kind==="clear")continue;
      if(outcome.kind==="caveat"){say(outcome.text,outcome.weight);continue;}
      if(outcome.kind==="withhold"){withhold(item,outcome.text);continue;}
      if(outcome.kind==="reduce"){
        item.calculatedAmount=outcome.to;
        item.amountText=money(outcome.to,item.currency);
        item.conditions=[...new Set([...(item.conditions??[]),outcome.text])];
        say(outcome.text,7);
        continue;
      }
      // Blocked. The figure stays on the card, because a person is owed the
      // number their policy prints and the reason it is not being paid; what
      // it stops doing is counting towards a total they might rely on.
      blocked.push({title:item.title,reason:outcome.text});
      item.status="not_applicable";
      item.reason=outcome.text;
      item.conditions=[...new Set([...(item.conditions??[]),outcome.text])];
      delete item.calculatedAmount;
    }
  }
  // An aggregate cap governs a cover, not a row, so it is applied to the
  // survivors together.
  for(const condition of args.conditions){
    if(condition.kind!=="aggregate_cap")continue;
    const read=capReading(condition);
    const stated=usableCeiling(condition.amount);
    if(stated==null||read.kind==="not_cap")continue;
    const inCover=items.filter(item=>item.calculatedAmount!=null
      &&(!condition.productName||(item.coverLabel??"").toLowerCase().includes(condition.productName.toLowerCase())));
    // A share of the sum insured caps the cover at that share of its one sum insured; with no single sum it is unplaced.
    const sums=[...new Set(inCover.map(item=>item.coverAmount))];
    const ceiling=condition.amountBasis==="sum_insured_fraction"?(sums.length===1&&sums[0]!=null?stated*sums[0]:null):stated;
    const total=inCover.reduce((sum,item)=>sum+(item.calculatedAmount??0),0);
    if(ceiling!=null&&total<=ceiling)continue;
    if(read.kind==="unsure"||ceiling==null){
      // A limit not tied to a cover by name hides only the benefits its sentence names ("The annual limit for hospital
      // benefits is shown in the Schedule": hospital rows, never the death benefit, TE #188 H2).
      const subject=condition.productName?[]:limitSubject(condition);
      const named=subject.length?inCover.filter(item=>contentWords(benefitOf(item)).some(w=>subject.includes(w))):inCover;
      const text=(condition.productName??"this cover")+" states an overall limit"+(ceiling!=null?" of "+money(ceiling):"")
        +" that DearPolicy could not confirm against its page, so no amounts are shown for it.";
      for(const item of named)withhold(item,text);
      continue;
    }
    // Reduce from the largest figure down, and keep going until the total
    // fits. Reducing only the largest left the answer still over the cap
    // whenever one benefit could not absorb the whole excess -- and asking the
    // same question a second time then reduced the next one, so the same
    // policy and the same facts produced a smaller figure on the second ask.
    let excess=total-ceiling;
    for(const entry of inCover.slice().sort((a,b)=>(b.calculatedAmount??0)-(a.calculatedAmount??0))){
      if(excess<=0)break;
      const was=entry.calculatedAmount??0;
      const now=Math.max(0,was-excess);
      if(now===was)continue;
      excess-=was-now;
      entry.calculatedAmount=now;
      entry.amountText=money(now,entry.currency);
      say((condition.productName??"this cover")+" pays no more than "+money(ceiling)
        +" in total, so "+entry.title+" is shown at "+money(now)+" rather than "+money(was),8);
    }
  }
  // Heaviest first, and bounded: an answer has room for a handful, and a list
  // nobody reaches the end of is the same as no list at all.
  const qualifiers=[...caveats.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12).map(([text])=>text);
  return {qualifiers,blocked};
}

/** One stored condition, in the words a person would use.
 *
 * The Benefits page is what makes imperfect extraction acceptable: a rule read
 * wrongly is visible before a claim happens. That argument applies twice over
 * to a condition, because a wrong one takes money OFF an answer, so a person
 * has to be able to see every one of them and say which is wrong. */
export function describeCondition(condition:CoverCondition){
  const cover=condition.productName?condition.productName+": ":"";
  const carve=condition.carveOut?" \u2014 except: "+condition.carveOut.trim():"";
  switch(condition.kind){
    case "exclusion":
      return cover+"does not pay when the cause is "+CAUSE_WORDS[condition.cause??"other"]+carve;
    case "waiting_period":
      return cover+"pays nothing in the first "+(usableDays(condition.days)??"(unstated number of)")+" days of the cover"
        +(condition.conditionNames.length?", for "+condition.conditionNames.slice(0,4).join(", "):"")+carve;
    case "survival_period":
      return cover+"the insured must survive "+(usableDays(condition.days)??"(unstated number of)")+" days from diagnosis"+carve;
    case "time_bar_from_inception":
      return cover+"does not pay for "+CAUSE_WORDS[condition.cause??"other"]+" in the first "+(usableDays(condition.days)??"(unstated number of)")+" days of the cover"+carve;
    case "aggregate_cap":case "sub_limit":{
      const read=capReading(condition);
      // A sentence that caps nothing (a minimum, a count), or one DearPolicy cannot place, is shown as the policy words it.
      if(read.kind!=="cap")return (condition.quote??"").trim()?cover+(condition.quote??"").trim().slice(0,160):cover+"a stated maximum";
      const figure=condition.amountBasis==="sum_insured_fraction"?Math.round(read.amount*10000)/100+"% of the sum insured":money(read.amount);
      return condition.kind==="aggregate_cap"?cover+"pays no more than "+figure+" in total":cover+"this benefit is capped at "+figure;
    }
    case "terminates_on_full_payment":
      return cover+"paying the full sum insured ends the cover";
    case "notice_period":
      return cover+"the insurer must be told within "+(usableDays(condition.days)??"(unstated number of)")+" days";
    case "age_limit":
      return cover+"cover ends at the age the policy states";
    case "payment_precondition":
      return cover+"paid only if nothing else has been paid under this cover";
    default:
      return cover+condition.quote.slice(0,120);
  }
}
/** Whether this condition can change a figure, or only ever be stated beside
 * one. Shown on the screen so a person can see which is which. */
export function conditionEffect(condition:CoverCondition){
  // A minimum or a count stored as a cap is stated beside the amount, never applied to it.
  if((condition.kind==="sub_limit"||condition.kind==="aggregate_cap")&&capReading(condition).kind==="not_cap")return "stated beside the amount";
  return conditionIsDecidable(condition.kind)?"changes the amount":"stated beside the amount";
}
