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
const NOT_CAP_WORD=String.raw`(?:\bmin(?:imum|\.)?|\bat\s+least|\bthreshold|(?<!(?:not|cannot|never|n['’]t)\s)\bexceed(?:s|ing)?|(?<!no\s)\babove|(?<!not\s)\bover|(?<!(?:no|not|never|n['’]t)\s)\bmore\s+than|\bless\s+than|\b(?:under|below)(?=\s+(?:the\s+)?(?:age\b|ages\b|\d|S\$|US\$|RM|\$|£|€|¥|₹|SGD|USD|MYR|GBP|EUR)|\s*$)|\bage[ds]?|\bexcess|\bdeductible|\bco-?(?:payment|pay|insurance)|\bpremiums?|(?<!max(?:imum|\.)?\s)\bsum\s+(?:insured|assured))\b`;
const NOT_CAP_BEFORE=new RegExp(NOT_CAP_WORD+String.raw`[^.;\n]{0,25}$`,"iu");
const NOT_CAP_ANY=new RegExp(NOT_CAP_WORD,"giu");
/** A label that is a cap, ending in a colon right before the figure ("Maximum Sum Assured for Accidental Death:",
 * "Sub-limit for outpatient cancer treatment:"), words only. */
const CAP_LABEL=new RegExp(CAP_PHRASE+String.raw`(?:\s+[\p{L}’'&/()-]+){0,7}\s*:\s*$`,"iu");
const AMOUNT_LABEL=/\b(?:amount|sum|benefit|payout|pay(?:able|ment)?|reimburse\w*|cost|fees?|expenses?|charges?|limit)\b/iu;
const COUNT_LABEL=/(?<!\bper\s+(?:policy\s+|calendar\s+)?)\b(?:number|no\.|period|days?|nights?|weeks?|months?|years?|visits?|times|stays?|age|sessions?|count)\b/iu;
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
const capReadings=new WeakMap<object,CapReading>();
export function capReading(condition:Pick<CoverCondition,"amount"|"amountBasis"|"quote">):CapReading{
  const known=capReadings.get(condition);
  if(known)return known;
  const read=readCap(condition);
  capReadings.set(condition,read);
  return read;
}
function readCap(condition:Pick<CoverCondition,"amount"|"amountBasis"|"quote">):CapReading{
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
      // A label caps money only when the figure prints its currency or the label names an amount; "Maximum number of
      // visits per year: 10" and "Maximum hospital stay: 30" are counts (TE #188 F3).
      if(label&&(f.money||share||(AMOUNT_LABEL.test(label[0])&&!COUNT_LABEL.test(label[0])))){
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
/** Benefit kinds a limit's sentence or a benefit's name can name, each in a family of kinds that share money (an ICU
 * limit may be part of a hospital stay's; a funeral benefit is never part of a death benefit). Earlier kinds are read
 * first and their words are then set aside ("daily hospital income" is hospital cash, not also a hospital stay). Hospital
 * cash is a daily income of its own, never part of a hospital bill's room-and-board or ICU limit (TE #188 U10, U19), but
 * a limit on hospital benefits as a whole may be on it too (U23). */
const KINDS:[string,string,RegExp][]=[
  ["funeral","funeral",/\b(?:funeral|burial|cremation|last\s+expenses?|pengebumian)\b/giu],
  ["ambulance","ambulance",/\bambulance\b/giu],
  ["dental","dental",/\bdental\b/giu],
  ["optical","optical",/\b(?:optical|spectacles|eyeglasses)\b/giu],
  ["maternity","maternity",/\b(?:maternity|pregnan\w*|childbirth)\b/giu],
  ["cancer treatment","medical",/\bcancer\s+(?:drug\s+)?(?:treatments?|drugs?)\b|\bchemo\w*|\bradiotherapy\b/giu],
  ["early ci","ci",/\b(?:early|intermediate)[\s-]+(?:stage\s+)?(?:critical\s+illness(?:es)?|ci)\b/giu],
  ["ci","ci",/\bcritical\s+illness(?:es)?\b|\bci\b|\bdread\s+diseases?\b/giu],
  ["tpd","tpd",/\btpd\b|\btotal\s+(?:(?:and|&)\s+)?permanent\s+disab\w*|\bpermanent\s+total\s+disab\w*/giu],
  ["accidental death","death",/\baccident\w*\s+death\b|\bdeath\s+(?:benefits?\s+)?(?:due\s+to|by|from|caused\s+by)\s+(?:an?\s+)?accident\w*/giu],
  ["death","death",/\bdeath\b|\bkematian\b/giu],
  // Any other disablement ("Accidental Death and Disablement", "permanent disability"): paid apart from death.
  ["disablement","tpd",/\bdisab(?:lement|ility|led)\b/giu],
  ["icu cash","cash hospital",/\b(?:icu|intensive\s+care(?:\s+unit)?)\s+(?:cash|income|allowance)\b/giu],
  ["hospital cash","cash",/\b(?:hospital(?:isation|ization)?|daily)\s+(?:cash|income|allowance)\b|\belaun(?:\s+tunai)?\s+hospital(?:\s+harian)?\b|\bhospital\s+income\b/giu],
  ["icu","hospital",/\b(?:hospital\s+)?(?:icu|intensive\s+care(?:\s+unit)?)\b/giu],
  ["room and board","hospital",/\b(?:hospital\s+)?(?:room\s+(?:and|&)\s+board|ward)\b/giu],
  ["surgery","hospital",/\bsurg\w*/giu],
  ["pre or post hospital","hospital",/\b(?:pre|post)[\s-]*hospital\w*/giu],
  ["hospital stay","hospital cash",/\bhospital(?:isation|ization|s)?\b|\bin-?\s?patients?\b/giu],
  ["outpatient therapy","outpatient",/\b(?:physio\w*|chiropract\w*|acupuncture|tcm|traditional\s+chinese\s+medicine|vaccinations?|immuni[sz]ations?)\b/giu],
  ["mental health","medical",/\b(?:psychiatr\w*|mental\s+health|psycholog\w*)\b/giu],
  ["outpatient","outpatient",/\bout-?\s?patients?\b|\bclinic\b/giu],
  ["medical expenses","medical",/\bmedical\s+(?:expenses?|reimbursements?|costs?|bills?)\b/giu],
];
const kindsMemo=new Map<string,Map<string,string[]>>();
function kindsIn(text:string){
  const known=kindsMemo.get(text);
  if(known)return known;
  if(kindsMemo.size>5000)kindsMemo.clear();
  const kinds=readKinds(text);
  kindsMemo.set(text,kinds);
  return kinds;
}
/** The kind a text names first; on a tie, the narrower (earlier listed) kind. */
function firstKind(text:string):string|null{
  const lower=" "+text.toLowerCase()+" ";
  let best:string|null=null,at=Infinity;
  for(const kind of kindsIn(text).keys()){
    const re=KINDS.find(([k])=>k===kind)![2];
    re.lastIndex=0;
    const m=re.exec(lower);
    re.lastIndex=0;
    if(m&&m.index<at){at=m.index;best=kind;}
  }
  return best;
}
function readKinds(text:string){
  let rest=" "+text.toLowerCase()+" ";
  const kinds=new Map<string,string[]>();
  for(const [kind,families,re] of KINDS){
    if(!rest.match(re))continue;
    kinds.set(kind,families.split(" "));
    rest=rest.replace(re," ");
  }
  return kinds;
}
/** Families whose money is paid separately, so a limit on one is never a limit on the other (Critic R362 H1): a life
 * benefit (death, TPD, CI, funeral) and any other life benefit or any medical one, and hospital cash beside a hospital
 * bill's parts. Every other pair may share money (a medical-expenses benefit holds its hospital, outpatient, surgery,
 * ambulance and dental parts; an outpatient limit holds dental and optical), so the figure is not shown. */
const LIFE_FAMILIES=new Set(["death","tpd","ci","funeral"]);
const separateFamilies=(a:string,b:string)=>a!==b&&(LIFE_FAMILIES.has(a)||LIFE_FAMILIES.has(b)||(a==="cash"&&b==="hospital")||(a==="hospital"&&b==="cash"));
const separateFrom=(mine:string[],said:string[])=>mine.length>0&&said.length>0&&mine.every(a=>said.every(b=>separateFamilies(a,b)));
/** Words that make a limit cover more than what its sentence names: "all benefits", "under this section", "except for". */
const LIMIT_SCOPE=/\b(?:all|every|section|part|except|other\s+than|excluding|overall|combined|together|aggregate|semua)\b/iu;
/** The same for a plan total, whose sentence says "overall" or "in total" anyway. */
const AGGREGATE_SCOPE=/\b(?:all|every|section|part|except|other\s+than|excluding|semua)\b/iu;
/** Words anywhere in a limit's sentence that narrow it to some insured people ("Death benefit for children under age 5 is
 * limited to S$20,000", "for insured persons aged 70 and above", "Death benefit is limited to S$50,000 for children under
 * 5"). Default-safe (TE #195 r3): any age wording or person-group word narrows, unless it sits in a frame known to apply
 * to everyone: the adult age the cover itself ends or runs to ("cover ends at age 85", "payable until the insured attains
 * age 85", "expires on the 85th birthday", "payable up to age 99"), the ages it may be joined at ("Entry age 18 to 65",
 * "aged 18 to 70"), or a plan's own name ("Senior Protect Plan"). A wording this does not know, or a child's age in any
 * frame, withholds the figure and never cuts it. A benefit whose own name narrows the same way may still be
 * cut (TE #195 F2, G1, G2; Critic R367 M1). */
const AGE_N=String.raw`(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen)`;
const UNIT_WORD=String.raw`(?:one|two|three|four|five|six|seven|eight|nine)`;
/** A number a person's age could be, 0 to 120, in digits or words ("seventy", "sixty-five", "one hundred and five"). */
const AGE_UPTO_120=String.raw`(?:1[01]\d|120|\d{1,2}(?!\d)|(?:one\s+)?hundred(?:\s+(?:and\s+)?(?:${UNIT_WORD}|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty))?|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s]${UNIT_WORD})?|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|${UNIT_WORD})`;
const PEOPLE=String.raw`(?:persons?|people|insureds?|lives?\s+(?:insured|assured)|members?|adults?|individuals?|those)`;
const AGE_SIGNAL=new RegExp([
  String.raw`\b(?:child(?:ren)?|juveniles?|minors?|infants?|bab(?:y|ies)|stillborn|new-?born|kids?|teen(?:ager)?s?|elderly|seniors?|students?|pensioners?)\b`,
  String.raw`\bage[sd]?\b`, String.raw`\bbirthdays?\b`, String.raw`\b(?:younger|older)\s+than\b`,
  String.raw`\b\d+\s*(?:years?|yrs?)[\s-]+(?:old|of\s+age)\b`,
  String.raw`\b${PEOPLE}\s+(?:who\s+are\s+)?(?:under|below|over|above)\s+${AGE_N}\b`, String.raw`\b${PEOPLE}\s+${AGE_N}\s+(?:and|or)\s+(?:above|over|older|below|under|younger)\b`,
  // Any noun ("lives over 70", "anyone over 70", "customers above seventy"): a comparator and a number a person could be
  // is an age (Critic R381 M1, R383 M1), unless a unit or a counted noun that is not a person's age follows ("over 30
  // days", "over 10 people", "above 3 operations"); a figure over 120 ("bills over 1000") is an amount (TE #195 r11).
  String.raw`\b(?:under|below|over|above)\s+${AGE_UPTO_120}\b(?!\s*(?:%|percent|per\s*cent|days?|weeks?|months?|hours?|nights?|km|kilometres?|kilometers?|miles?|times?|claims?|visits?|sessions?|treatments?|kg|people|persons|operations?|procedures?|surger(?:y|ies)|items?|members|dollars?|cents?)\b|\s*%)`,
  String.raw`\b(?:over|under)[-\s]?\d{1,3}s\b`,
  String.raw`\b(?:turns|reaches|attains)\s+(?:the\s+)?(?:age\s+(?:of\s+)?)?${AGE_N}\b`, String.raw`\b(?:berumur|umur)\b`,
].join("|"),"iu");
// An adult's age (18 or more): a child's age is always a group's, never the age a whole cover ends at (TE #195 J1).
const ADULT_AGE=String.raw`(?:1[89]|[2-9]\d|1\d\d)`;
const COVER_RUNS=String.raw`(?:ends?|ending|expires?|expiring|terminates?|ceases?|matures?|lapses?|(?:is\s+)?renewable|runs|continues|(?:is\s+)?payable)`;
// The cover itself as the subject: "this limit ends at age 18" or "the benefit is payable up to age 21" may be the limit's
// own span, so only the cover, policy, plan, contract or insurance ends a whole cover (TE #195 K1).
const COVER_ENDS=String.raw`\b(?:cover(?:age)?|polic(?:y|ies)|plan|contract|insurance)\s+(?:(?:is|will|shall)\s+(?:be\s+)?)?${COVER_RUNS}`;
const WHOLE_COVER_AGES=new RegExp([
  // The age the cover itself ends or runs to: the cover, a duration verb, then the adult age (Critic R373 M1). A bare
  // "until age 16", "up to age 5", "before age 65" or "starts from age 70" is not anchored to the cover and narrows.
  String.raw`${COVER_ENDS}\s+(?:(?:at|on|until|till|up\s+to|to)\s+)(?:the\s+)?(?:\p{L}+(?:'s|’s)\s+)?(?:age\s+(?:of\s+)?${ADULT_AGE}\b|${ADULT_AGE}(?:st|nd|rd|th)\s+birthday)`,
  String.raw`${COVER_ENDS}\s+(?:until|till|when|once)\s+(?:\p{L}+\s+){0,3}(?:reaches|attains|turns)\s+(?:the\s+)?(?:age\s+(?:of\s+)?)?${ADULT_AGE}\b`,
  // The ages it may be joined at, from a joining age to a usual entry age ("Entry age 18 to 65"). A bare "aged 65 to 99"
  // or "entry age 60 to 70" may be an elderly band and narrows (Critic R375 M1).
  String.raw`\b(?:entry|issue|joining)\s+ages?\s*(?:of|is|:|from)?\s*(?:\d|1\d|2[01])\s*(?:to|-|–|and)\s*(?:[6-9]\d|1\d\d)\b`,
].join("|"),"giu");
// A cover-end frame inside a sequence or a condition ("payable up to age 65 in full; thereafter ...", "if the policy
// continues until ...") may start the limit, so no frame is set aside (Critic R375 M2).
const SEQUENCE=/\b(?:thereafter|then|after\s+which|afterwards?|from\s+then\s+on|beyond|past|if|unless|provided|where|while|once)\b/iu;
/** A plan's own name ("Senior Protect Plan", "Child Shield") is set aside before the person words are read. */
const PLAN_NAMES=/\b[A-Z][\w-]*(?:\s+[A-Z][\w-]*)*\s+(?:Plan|Shield|Protect(?:or)?|Saver|Plus)\b|\b[A-Z][\w-]*\s+(?:Plan|Shield|Protect(?:or)?)\b/gu;
/** The words a limit's figure may be joined to a whole-cover frame by: a stop, a comma, "and", "the" or a bracket. */
const FRAME_JOIN=/^\s*(?:[,;.()]\s*)*(?:and\s+)?(?:\(\s*)?(?:the\s+|this\s+|its\s+)?$/iu;
/**
 * Whether a text names a narrower group by age. In a limit's quote a cover-end frame is set aside only when it follows
 * the limit's own printed amount, joined to it by a stop, a comma or "and" ("limited to S$500,000; cover ends at age 85").
 * A frame before that amount, or after other words, may set the span the limit applies in ("The sum assured is
 * S$900,000 and the policy continues to age 70. Subsequently ... limited to S$50,000"), so its age stays in (Critic
 * R378 M1, R380 M1/L1). An entry age range, and any frame in a benefit's own name, is set aside.
 */
/** How long a policy has been held ("in force under 2 years") or a sum is paid over ("paid over 10 years") is not an age. */
const HELD_FOR=/\b(?:(?:in\s+force|held|owned)\s+(?:for\s+)?(?:under|below|over|above|less\s+than|more\s+than)|(?:paid|payable|spread)\s+(?:out\s+)?over)\s+\d+\s+(?:years?|months?)\b/giu;
const narrows=(text:string,limit?:{amount:number|null})=>{
  const named=text.replace(PLAN_NAMES," ").replace(HELD_FOR," ");
  if(SEQUENCE.test(named))return AGE_SIGNAL.test(named);
  const own=limit?figuresIn(named,false).find(f=>limit.amount!=null&&Math.abs(f.value-limit.amount)<=0.005):undefined;
  return AGE_SIGNAL.test(named.replace(WHOLE_COVER_AGES,(frame:string,...rest:unknown[])=>{
    const at=rest.find(v=>typeof v==="number") as number;
    // An entry age range says who may join, never the span a limit runs in, so it is set aside wherever it stands.
    if(/^(?:entry|issue|joining)\b/iu.test(frame)||!limit)return " ";
    return own&&at>=own.end&&FRAME_JOIN.test(named.slice(own.end,at))?" ":frame;
  }));
};
const limitHead=(condition:CoverCondition)=>(condition.quote??"").split(/(?:S\$|US\$|RM|£|€|\$)?\s*\d/u)[0];
/** Whom a sub-limit is for (TE #188 H1, M2; Critic R358 H1). "this": its sentence names the benefit ("Hospital Cash is
 * limited to S$5,000", "ICU Benefit: up to S$25,000" for "Intensive Care Unit (ICU) Benefit", "TPD benefit" for "Total
 * and Permanent Disability"), or the cover it is stored under is the benefit's own name. "other" only on proof: the
 * sentence names benefit kinds whose money is paid apart from every kind the benefit's own name has ("Funeral expenses
 * benefit is limited to S$5,000" is no limit on the death benefit). Anything else is "unknown", and the figure above the
 * limit is not shown: a sentence that names nothing, a part of a plan ("Double Cover: subject to a limit"), a wider scope
 * ("all benefits", "this section"), a related kind ("Room and board" for "Hospitalisation"), or words no kind knows. */
const limitReads=new WeakMap<object,{head:string;scoped:boolean;narrow:boolean;quote:string;subject:string[];part:boolean}>();
function limitRead(condition:CoverCondition){
  const known=limitReads.get(condition);
  if(known)return known;
  const head=limitHead(condition);
  const read={head,scoped:LIMIT_SCOPE.test(head),narrow:narrows(condition.quote??"",condition),quote:phrase(condition.quote??""),subject:limitSubject(condition),
    part:/\p{L}+\s+(?:cover|plan|rider|policy)\b/iu.test(head)};
  limitReads.set(condition,read);
  return read;
}
function limitIsFor(condition:CoverCondition,item:ClaimItem):"this"|"other"|"unknown"{
  const whose=limitIsForKind(condition,item);
  // A limit for some people only (children) is never proof for a benefit not named for them, wherever it is stored.
  return whose==="this"&&limitRead(condition).narrow&&!narrows(benefitOf(item))?"unknown":whose;
}
function limitIsForKind(condition:CoverCondition,item:ClaimItem):"this"|"other"|"unknown"{
  const {head,scoped,quote,subject,part}=limitRead(condition);
  const benefit=phrase(benefitOf(item));
  const said=kindsIn(head),mine=kindsIn(benefitOf(item));
  // A sentence whose subject (its first kind) is a narrower kind than the benefit ("Early Critical Illness benefit is
  // limited to S$50,000" for "Critical Illness", "Accidental death benefit" for "Death benefit", "Surgery under the
  // Hospitalisation benefit" for "Hospitalisation") is that kind's limit, even inside the benefit's name or stored under
  // it. A kind named later is a cause or a part ("Death benefit, whether by illness or accidental death", "Hospitalisation
  // benefit including surgery", TE #195 F1).
  const first=firstKind(head);
  const otherKind=mine.size>0&&first!=null&&!mine.has(first);
  // A limit on one part of a benefit that pays for several ("TPD benefit is limited to S$50,000" for "Death or TPD",
  // Critic R367 M2) is no limit on the whole.
  if(said.size&&said.size<mine.size&&[...said.keys()].every(k=>mine.has(k)))return "unknown";
  if(condition.productName&&phrase(condition.productName)===benefit&&!otherKind)return "this";
  if(scoped)return "unknown";
  if(benefit.trim().length>=3&&quote.includes(benefit)&&!otherKind)return "this";
  // A sentence that names a part of the plan ("Double Cover: subject to a limit") names a cover, whose benefits it does
  // not say: unknown, as with no name at all.
  if(!subject.length||part)return "unknown";
  const own=new Set([...contentWords(benefitOf(item)),...[...benefitOf(item).matchAll(/\(([\p{L}]{2,6})\)/gu)].map(m=>m[1].toLowerCase())]);
  if(subject.every(w=>own.has(w)))return "this";
  if(!said.size||!mine.size)return "unknown";
  if(said.size===mine.size&&[...said.keys()].every(k=>mine.has(k)))return "this";
  return separateFrom([...mine.values()].flat(),[...said.values()].flat())?"other":"unknown";
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
/**
 * The first day a span of whole years or months after a start has surely passed ("2024-03-01" + 2 years = "2026-03-01").
 * A start on a day the end month lacks (29 Feb, 31 Jan) ends the day after the clamped date, so a span is never counted
 * as passed a day early (TE #199 T3).
 */
function addPeriod(from:string,n:number,unit:"year"|"month"){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  if(!m)return null;
  const months=Number(m[1])*12+Number(m[2])-1+(unit==="year"?n*12:n);
  const y=Math.floor(months/12),mo=months%12+1,last=new Date(Date.UTC(y,mo,0)).getUTCDate(),day=Number(m[3]);
  const end=`${String(y).padStart(4,"0")}-${String(mo).padStart(2,"0")}-${String(Math.min(day,last)).padStart(2,"0")}`;
  return day>last?addDays(end,1):end;
}
const COUNT_WORDS:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,
  fifteen:15,twenty:20,"twenty-four":24,thirty:30,thirty_six:36,first:1,second:2,third:3,fourth:4,fifth:5,sixth:6,seventh:7,eighth:8,
  ninth:9,tenth:10,fifteenth:15,twentieth:20};
const COUNT=String.raw`(?:\d{1,3}(?:st|nd|rd|th)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty(?:-four)?|thirty|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|fifteenth|twentieth)`;
const countOf=(word:string)=>/^\d/.test(word)?Number(word.replace(/\D+$/,"")):COUNT_WORDS[word.toLowerCase()]??null;
const SPAN_UNIT=String.raw`(?:(?:full|complete|consecutive)\s+)?(?:policy\s+|contract\s+|cover(?:age)?\s+)?(years?|months?)`;
const POLICY_START=String.raw`(?:the\s+)?(?:(?:policy|cover(?:age)?|risk)\s+)?(?:date\s+of\s+)?(?:(?:policy|risk)\s+)?(?:issue|issuance|commencement|inception|start|effective\s+date|cover\s+start)(?:\s+date)?(?:\s+of\s+(?:the\s+)?(?:policy|cover(?:age)?))?`;
// "the policy date", "the date of the policy": the date the policy started (TE #199 r3 note).
const START=String.raw`(?:${POLICY_START}|(?:the\s+)?(?:policy\s+date|date\s+of\s+(?:the\s+|this\s+|your\s+)?policy))`;
// What a "years old" span is counted on: the policy itself, never an item or a person ("if it is less than 2 years old").
const AGED=String.raw`\b(?:the\s+|this\s+|your\s+)?(?:policy|cover(?:age)?|plan|contract)\s+(?:is|has\s+been)\s+`;
/**
 * A limit that holds only for part of how long the policy has run (Critic R382 L1): "while" ("in force under 2 years",
 * "within 24 months from the date of issue", "during the first two policy years", "before the second policy
 * anniversary") or "after" ("in force for more than 10 years", "from the 10th policy anniversary").
 */
const TENURE_FORMS:{when:"while"|"after";re:RegExp}[]=[
  {when:"while",re:new RegExp(String.raw`\b(?:in\s+force|held|owned)\s+(?:for\s+)?(?:under|below|less\s+than|fewer\s+than|within|not\s+more\s+than|up\s+to)\s+(${COUNT})\s+${SPAN_UNIT}`,"iu")},
  {when:"while",re:new RegExp(String.raw`\b(?:within|during|in|for)\s+(?:the\s+)?first\s+(?:(${COUNT})\s+)?${SPAN_UNIT}`,"iu")},
  {when:"while",re:new RegExp(String.raw`\b(?:within|during|in)\s+(?:the\s+)?(${COUNT})\s+${SPAN_UNIT}\s+(?:of|from|after|following)\s+${START}\b`,"iu")},
  {when:"while",re:new RegExp(String.raw`${AGED}(?:under|below|less\s+than|fewer\s+than|younger\s+than|not\s+more\s+than)\s+(${COUNT})\s+${SPAN_UNIT}\s+old\b`,"iu")},
  {when:"while",re:new RegExp(String.raw`\b(?:before|prior\s+to|until)\s+(?:the\s+)?(${COUNT})\s+(?:policy\s+)?anniversary`,"iu")},
  {when:"after",re:new RegExp(String.raw`\b(?:in\s+force|held|owned)\s+(?:for\s+)?(?:over|above|more\s+than|at\s+least|longer\s+than)\s+(${COUNT})\s+${SPAN_UNIT}`,"iu")},
  {when:"after",re:new RegExp(String.raw`\b(?:after|from|on\s+or\s+after|following)\s+(?:the\s+)?(${COUNT})\s+(?:policy\s+)?anniversary`,"iu")},
  {when:"after",re:new RegExp(String.raw`\b(?:after|following|beyond)\s+(?:the\s+)?first\s+(${COUNT})\s+${SPAN_UNIT}`,"iu")},
  {when:"after",re:new RegExp(String.raw`\bafter\s+(?:the\s+)?(?:first\s+)?(${COUNT})\s+${SPAN_UNIT}\s+(?:of\s+cover|in\s+force|(?:from|of|after)\s+${START})`,"iu")},
  {when:"after",re:new RegExp(String.raw`${AGED}(?:over|above|more\s+than|at\s+least|older\s+than)\s+(${COUNT})\s+${SPAN_UNIT}\s+old\b`,"iu")},
];
/**
 * Any wording that may tie a limit to how long the policy has run. When it is there and no form above reads it exactly,
 * the limit cannot be placed in time and no figure is shown. Default-safe: a reinstated or revived policy restarts
 * the count, which DearPolicy cannot see, so that wording is never read (Critic R386 M1, TE #199 T1).
 */
const TENURE_SIGNAL=new RegExp([
  // "per policy year", "each policy anniversary" say how often, not since when.
  String.raw`(?<!\b(?:any|each|every|per)\s+)\b(?:${COUNT}|the\s+first)\s+(?:(?:full|complete|consecutive)\s+)?policy\s+years?\b`,
  String.raw`(?<!\b(?:each|every|any|per|on)\s+(?:policy\s+)?)\banniversar(?:y|ies)\b`,
  String.raw`\bin\s+force\s+(?:for|under|below|less|fewer|within|not|up|over|above|more|at|longer)\b`,
  String.raw`\b(?:within|during|in|for|before)\s+(?:the\s+)?first\s+(?:${COUNT}\s+)?(?:(?:full|complete|consecutive|policy|contract|cover(?:age)?)\s+)*(?:years?|months?)\b`,
  String.raw`\b(?:of|from|after|since|following)\s+${START}\b`,
  String.raw`\breinstat\w*|\breviv\w*`,
].join("|"),"iu");
/**
 * Any span of time in a limit's sentence may be how long the policy has run ("during the first 730 days", "within two
 * years of the policy date", "until the policy has run for two years", "the contestability period"), so each one ties
 * the limit to tenure unless its own words show it is something else (Critic R387 M1): a span counted from an event
 * ("within 90 days of the accident", "first 3 days of hospitalisation"), how often a limit resets ("per policy year",
 * "in any 12 months"), or a count of days paid ("up to 30 days", "30 days per policy year").
 */
const SPAN=new RegExp(String.raw`\b(?:\d{1,4}|${COUNT})\s+(?:(?:full|complete|consecutive|calendar|policy|contract)\s+)?(?:days?|weeks?|months?|years?)\b|\bfirst\s+(?:policy\s+)?year\b|\bcontestab|\bincontestab`,"giu");
const SPAN_EVENT=String.raw`(?:accidents?|injur(?:y|ies)|diagnosis|discharge|admission|hospitali[sz]ation|events?|treatments?|surgery|surgeries|operations?|loss|death|incidents?|illness|onset|trips?|departure|claims?|disability|confinement|stay|journey|return|sickness|occurrence)`;
const SPAN_FROM_EVENT=new RegExp(String.raw`^\s*(?:of|after|from|following|since|before|prior\s+to|in\s+respect\s+of)\s+(?:the\s+|a\s+|an\s+|any\s+|each\s+|such\s+)?(?:date\s+of\s+(?:the\s+)?)?(?:(?:insured|covered|hospital|first|initial|said)\s+)?${SPAN_EVENT}\b`,"iu");
const SPAN_RESETS_BEFORE=/(?:\bper|\beach|\bevery|\bany\s+one|\bin\s+any|\bup\s+to|\bmaximum(?:\s+of)?|\bmax\.?|\bnot\s+exceeding|\bno\s+more\s+than)\s+(?:a\s+(?:maximum\s+of\s+)?)?$/iu;
/** How long an event lasts ("stays over 3 days", "trips under 90 days") or how long premiums are paid ("paid over
 * 10 years"): neither says how long the policy has run. */
const SPAN_NOT_TENURE_BEFORE=/(?:\b(?:stays?|trips?|journeys?|confinements?|hospitali[sz]ations?|admissions?|disabilit(?:y|ies)|absences?|travels?)\s+(?:of\s+)?(?:over|under|above|below|exceeding|longer\s+than|shorter\s+than|less\s+than|more\s+than|lasting(?:\s+(?:over|under|more\s+than|less\s+than))?)|\b(?:premiums?\s+(?:are\s+|is\s+)?)?(?:paid|payable|spread(?:\s+out)?)\s+(?:over|for)(?:\s+a\s+(?:term|period)\s+of)?)\s+$/iu;
/** A span counted from the policy itself ("of cover", "after the cover starts") is tenure whatever comes before it. */
const SPAN_OF_POLICY=/^\s*(?:of\s+(?:cover(?:age)?|membership)|in\s+force|(?:of|from|after|since|following|before)\s+(?:the\s+|this\s+|your\s+)?(?:policy|cover(?:age)?|contract|plan|certificate|membership|commencement|inception|issue|start|effective|entry|enrol(?:l)?ment|date\s+of\s+(?:issue|commencement|entry)))/iu;
const SPAN_RESETS_AFTER=/^\s*(?:per|each|in\s+any|of\s+(?:hospital\s+)?(?:stay|confinement|disability|hospitali[sz]ation|the\s+(?:trip|journey|stay)))\b/iu;
function looseSpan(text:string){
  for(const m of text.matchAll(SPAN)){
    const before=text.slice(Math.max(0,m.index!-40),m.index),after=text.slice(m.index!+m[0].length,m.index!+m[0].length+80);
    if(/^contestab|^incontestab/i.test(m[0]))return true;
    if(SPAN_OF_POLICY.test(after))return true;
    if(SPAN_FROM_EVENT.test(after)||SPAN_RESETS_AFTER.test(after)||SPAN_RESETS_BEFORE.test(before)||SPAN_NOT_TENURE_BEFORE.test(before))continue;
    return true;
  }
  return false;
}
export type Tenure={when:"while"|"after";n:number;unit:"year"|"month"};
/** The span a limit is tied to: a Tenure when one form reads it exactly, "unread" when tenure wording is there but
 * cannot be read, or null when the limit says nothing about how long the policy has run. */
export function tenureOf(quote:string|null|undefined):Tenure|"unread"|null{
  const text=quote??"";
  if(!TENURE_SIGNAL.test(text)&&!looseSpan(text))return null;
  if(/\breinstat|\breviv/iu.test(text))return "unread";
  const found:Tenure[]=[];
  for(const form of TENURE_FORMS){
    const m=form.re.exec(text);
    if(!m)continue;
    const n=m[1]?countOf(m[1]):1;
    if(n==null||n<=0)return "unread";
    const unit=m[2]===undefined?"year":/^month/i.test(m[2])?"month":"year";
    found.push({when:form.when,n,unit});
  }
  // Two different spans in one sentence ("first 2 years ... after the 10th anniversary") are not read.
  const keys=new Set(found.map(t=>t.when+t.n+t.unit));
  return found.length&&keys.size===1?found[0]:"unread";
}
/**
 * Whether the policy has surely run the span by the claim date. The start DearPolicy holds may be the latest renewal's,
 * not the first, so it can only show a span HAS passed, never that it has not.
 */
function tenurePassed(tenure:Tenure,start:string|null|undefined,when:string){
  const from=start?isoDate(start):null;
  const ends=from?addPeriod(from,tenure.n,tenure.unit):null;
  return ends!=null&&ends<=when;
}
/** What a tenure-tied limit does: "apply" (read it as any limit), "clear" (not in force at the claim), or "withhold". */
function tenureEffect(quote:string|null|undefined,start:string|null|undefined,when:string):"apply"|"clear"|"withhold"{
  const tenure=tenureOf(quote);
  if(tenure==null)return "apply";
  if(tenure==="unread")return "withhold";
  const passed=tenurePassed(tenure,start,when);
  return !passed?"withhold":tenure.when==="while"?"clear":"apply";
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
  /** The start that counts how long the policy has run, when every document of it agrees; null when they differ (a
   * replaced or reinstated policy). Left out, the cover start is used. */
  tenureStart?:string|null;
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
  coverStart?:string|null;tenureStart?:string|null;today:string}):ConditionOutcome{
  const {item,facts,coverStart,tenureStart,today}=args;
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
      // A limit for part of the policy's life applies only once DearPolicy can show which part the claim falls in.
      const span=tenureEffect(raw.quote,tenureStart===undefined?coverStart:tenureStart,claimDate(facts)??today);
      if(span==="clear")return {kind:"clear"};
      if(span==="withhold")return {kind:"withhold",text:"the policy states a limit of "+limit+(raw.productName?" under "+raw.productName:"")
        +" that depends on how long the policy has been in force, and DearPolicy cannot confirm that, so no amount is shown for "
        +item.title+"."+quoteTail};
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
  // The figure each item printed before any condition: a benefit ruled out still shows it (below), even when a limit
  // first withheld it, since a ruled-out benefit counts towards nothing.
  const printed=new Map(args.items.map(item=>[item,item.amountText]));
  const withhold=(item:ClaimItem,text:string)=>{
    delete item.calculatedAmount;
    if(item.status!=="not_applicable")item.amountText=null;
    item.conditions=[...new Set([...(item.conditions??[]),text])];
    say(text,7);
  };
  for(const item of items){
    for(const condition of conditionsForItem(item,args.conditions)){
      const outcome=evaluateCondition(condition,{item,facts:args.facts,coverStart:args.coverStart,tenureStart:args.tenureStart,today});
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
      item.amountText??=printed.get(item)??null;
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
    // An overall limit for part of the policy's life, as for one benefit's (TE #199 T2).
    const span=tenureEffect(condition.quote,args.tenureStart===undefined?args.coverStart:args.tenureStart,claimDate(args.facts)??today);
    if(span==="clear")continue;
    if(span==="withhold"){
      const text=(condition.productName??"this cover")+" states an overall limit that depends on how long the policy has been in force,"
        +" and DearPolicy cannot confirm that, so no amounts are shown for it.";
      for(const item of inCover)if(item.calculatedAmount!=null)withhold(item,text);
      continue;
    }
    // A share of the sum insured caps the cover at that share of its one sum insured; with no single sum it is unplaced.
    const sums=[...new Set(inCover.map(item=>item.coverAmount))];
    const ceiling=condition.amountBasis==="sum_insured_fraction"?(sums.length===1&&sums[0]!=null?stated*sums[0]:null):stated;
    const total=inCover.reduce((sum,item)=>sum+(item.calculatedAmount??0),0);
    if(ceiling!=null&&total<=ceiling)continue;
    if(read.kind==="unsure"||ceiling==null){
      // Only a benefit whose money is paid apart from every kind the sentence names is left showing ("The annual limit for
      // hospital benefits is shown in the Schedule" leaves the death benefit, TE #188 H2); a limit for all benefits, or one
      // that names no kind, hides every figure in the cover (TE #188 F4).
      const head=condition.productName?"":limitHead(condition);
      const said=kindsIn(head);
      const named=condition.productName||!said.size||AGGREGATE_SCOPE.test(head)?inCover
        :inCover.filter(item=>{const mine=kindsIn(benefitOf(item));return !separateFrom([...mine.values()].flat(),[...said.values()].flat());});
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
