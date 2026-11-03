/** Which of a person's benefit-table rows (lib/benefit-table) answer one Home tile or Coverage page category, and the
 * figure to show for it. Pure, and for any household: it reads only the benefit names and figures the person's own
 * documents print, never a scheme, product or insurer named in code. A category no row names stays as before. */
import { rowDetail, shortFigure, type SummaryRow } from "@/lib/benefit-table/headline";
import { MONEY_SIGN, normalizeCurrencyCode } from "@/lib/format/currency";
import { canonicalInsurer } from "@/lib/policies/insurer-name";
import type { PlanType } from "@/lib/coverage/plan-type";
import { printedDay } from "@/lib/benefit-table/dates";

/** Benefit names, as policies in any market print them, for each category. Early critical illness is tested before
 * critical illness. A death or disability benefit paid only on an accident ("Accidental Death", "Death due to
 * Accident", "TPD by accident") is personal accident cover, never the Death or TPD tile: a death from illness is not
 * paid by it (Critic R225, TE P142-1). */
const NAMES: [string, RegExp][] = [
  ["Early Critical Illness", /\b(?:early|intermediate)[\s-]+(?:stage\s+)?(?:critical\s+illness|ci|dread\s+disease)\b/i],
  ["Critical Illness", /\b(?:critical\s+illness|dread\s+disease)\b/i],
  ["Personal Accident", /\b(?:accident(?:al(?:ly)?|s)?|injur(?:y|ies|ed))\b[^\n]*\b(?:death|died|dies|disab\w*|tpd|dismember\w*)\b|\b(?:death|disab\w*|tpd|dismember\w*)\b[^\n]*\b(?:accident(?:al(?:ly)?|s)?|injur(?:y|ies|ed))\b|\bpersonal\s+accident\b|\bad\s?&\s?d\b/i],
  ["Total Permanent Disability", /\btpd\b|\btotal\s+(?:and|&)\s+permanent\s+disab|\bpermanent\s+total\s+disab/i],
  ["Death", /\bdeath\b/i],
  ["Hospital Cash", /\b(?:hospital(?:isation)?|daily)\s+(?:cash|income|allowance)\b/i],
  ["Disability Income", /\bdisability\s+income\b|\bincome\s+(?:protection|replacement)\b/i],
  ["Outpatient", /\bout-?\s?patient\b/i],
  ["Hospitalisation", /\bward\b|\broom\s+(?:and|&)\s+board\b|\bin-?\s?patient\b|\bhospital\s+(?:charges|expenses|stay)\b/i],
];

const ACC = String.raw`(?:accident\w*|injur(?:y|ies|ed))`;
/** Accident words the benefit names above do not know: "AD&D" or "ADD" (capitals, never "ADD-ON"), "misadventure", "unintentional", and
 * the Malay "kemalangan" (TE P152). A name with one pays on an accident, whatever else it says. */
const ACCIDENT_ONLY_NAME = (name: string) => /\bad\s?&\s?d\b|\bmisadventure\b|\bunintentional\w*|\bkemalangan\b/i.test(name) || /\bADD\b(?![\s-]*ONS?\b)/.test(name);
const ACCIDENT_WORD = new RegExp(String.raw`\b${ACC}`, "i");
const ILL = String.raw`(?:illness(?:es)?|sickness(?:es)?|diseases?|natural\s+causes?)`;
// "only" binds to the accident words beside it ("accidental death only", "only on accident"), never to the rest of the line
// ("Death due to illness or accident, payable only once"; Critic R232).
const ACCIDENT_ONLY = new RegExp(String.raw`\b(?:only|solely|exclusively)\s+(?:(?:by|from|due\s+to|for|on|if|in\s+case\s+of|caused\s+by)\s+)?(?:an?\s+)?${ACC}|\b${ACC}(?:\s+[a-z]+){0,2}\s+(?:only|solely|exclusively)\b|\bunless\s+(?:\w+\s+){0,3}(?:an?\s+)?${ACC}|\bnot\s+(?:\w+\s+){1,2}except\s+(?:for\s+|by\s+)?(?:an?\s+)?${ACC}`, "i");
const ILLNESS_ONLY = new RegExp(String.raw`\bnon-?\s?accident\w*|\b(?:other\s+than|except(?:\s+for)?|excluding)\s+(?:by\s+|for\s+|through\s+)?(?:an?\s+)?${ACC}`, "i");
const PAIR = String.raw`\s*(?:or|and|and\s*/\s*or|/|&)\s*(?:(?:by|from|due\s+to)\s+)?(?:an?\s+)?`;
const ANY_CAUSE = new RegExp(String.raw`\b(?:any|all)\s+causes?\b|\b${ILL}${PAIR}${ACC}|\b${ACC}${PAIR}${ILL}|\b${ACC}\s+or\s+otherwise\b|\bnatural${PAIR}accident\w*|\baccident\w*${PAIR}natural\b`, "i");
// A pair names the cause of the death itself only at the start of the name ("Accidental and Sickness Death Benefit") or
// straight after the death words ("Death due to illness or accident"); anywhere else it is an exclusion's wording
// ("Accidental Death not payable for illness or injury caused by war"; TE round 5).
const PAIRS = String.raw`(?:${ILL}${PAIR}${ACC}|${ACC}${PAIR}${ILL}|${ACC}\s+or\s+otherwise\b|natural${PAIR}accident\w*|accident\w*${PAIR}natural\b)`;
const PAIR_AT_START = new RegExp(String.raw`^\s*(?:the\s+)?${PAIRS}`, "i");
const PAIR_AFTER_DEATH = new RegExp(String.raw`^\s*(?:the\s+)?(?:death|tpd|total\s+(?:and|&)\s+permanent\s+disabilit\w*|permanent\s+total\s+disabilit\w*|disabilit\w*)(?:\s+benefit)?\s+(?:(?:due\s+to|from|by|caused\s+by|resulting\s+from|through)\s+)?(?:an?\s+)?${PAIRS}`, "i");
const STARTS_WITH_ACCIDENT = new RegExp(String.raw`^\s*(?:the\s+)?${ACC}`, "i");
const PLAIN_DEATH = /^\s*death(?:\s+benefit)?\b/i;
const UPLIFT_FOR_ACCIDENT = new RegExp(String.raw`(?:\b(?:doubl\w*|twice|uplift\w*)|\b\d+(?:\.\d+)?\s?(?:x|times)|\b\d{3}\s?%)\s+(?:for|on|if|upon|in\s+case\s+of)\s+(?:an?\s+)?accident\w*(?:\s+death)?\b`, "i");
const INCLUDING_ACCIDENT = new RegExp(String.raw`\bincluding\s+(?:death\s+)?(?:due\s+to\s+|from\s+|by\s+|caused\s+by\s+)?(?:an?\s+)?${ACC}`, "i");

/** What a death or disability name with an accident or injury word pays for. The default is accident only: any cause needs
 * a phrase that says so ("any cause", "illness or accident", a plain death benefit "doubled for accidental death" or
 * "including death due to injury"), and "other than accident" pays illness only. A name the rules cannot place stays
 * accident only, so it never pays a death from illness (TE P144-6, round 3: an allow-list, not a list of exclusions).
 * The head of the name (before the first bracket, dash, comma, semicolon or colon) decides first: "Accidental Death
 * (excluding injury from war)" is accident cover whatever its exclusions say (TE round 4). */
function causeOf(benefit: string): "accident" | "any" | "illness" {
  if (/\bpersonal\s+accident\b/i.test(benefit)) return "accident";
  const head = benefit.split(/\(|\s[-–—]\s|[,;:]/)[0];
  if (ACCIDENT_ONLY.test(head)) return "accident";
  // The words before an exclusion: "Accidental Death excluding injury from war" is accident cover (Critic R234).
  const lead = head.split(/\b(?:excluding|except|other\s+than|unless|but\s+not)\b/i)[0];
  if (/\bnon-?\s?accident/i.test(lead)) return "illness";
  if (PAIR_AT_START.test(lead)) return "any";
  if (STARTS_WITH_ACCIDENT.test(lead)) return "accident";
  if (new RegExp(String.raw`\b${ACC}`, "i").test(lead)) return PAIR_AFTER_DEATH.test(lead) || /\b(?:any|all)\s+causes?\b/i.test(lead) ? "any" : "accident";
  if (ILLNESS_ONLY.test(head)) return "illness";
  if (ANY_CAUSE.test(head)) return "any";
  if (new RegExp(String.raw`\b${ACC}`, "i").test(head)) return "accident";
  if (ACCIDENT_ONLY.test(benefit)) return "accident";
  if (ILLNESS_ONLY.test(benefit)) return "illness";
  if (ANY_CAUSE.test(benefit)) return "any";
  if (PLAIN_DEATH.test(benefit) && (UPLIFT_FOR_ACCIDENT.test(benefit) || INCLUDING_ACCIDENT.test(benefit))) return "any";
  return "accident";
}

// Cover for what the person owes other people, named only by words that say so (an allow-list, Critic R355, TE pr192 F1):
// a kind of liability cover ("Personal Liability", "public liability"), liability or harm TO others or third parties,
// harm OF a third party ("Death of a third party"), or a third party's own loss ("Third party property damage"). The
// insurer's own limits ("Limits of Liability", "maximum liability", "our liability is limited to", "we are not liable")
// name no one else and are never matched; nor is the person's own cover caused BY a third party ("assault by a third party").
const OTHERS = String.raw`(?:(?:any\s+)?other\s+(?:people|persons?)|another\s+person|others|(?:a|any|the)\s+third[\s-]part(?:y|ies)|third[\s-]part(?:y|ies)|members?\s+of\s+the\s+public|someone\s+else|anyone\s+else|`
  + String.raw`(?:a\s+)?visitors?\s+to\s+your\s+home|(?:a\s+)?passers?[\s-]by|pihak\s+ketiga|orang\s+lain)`;
/** "Any person" is someone else only in a liability frame: liability or compensation to them, or harm done TO them
 * ("injury to any person"). "Death of any person in your family" or "aged 18 to 65" is the insured's own cover (Critic
 * R360 M1). */
// Liability by default, unless a closed list of insured markers follows ("injury to any person covered under this policy",
// "any person in your family": Critic R363 M1, TE pr192 K40/K41).
const TO_ANYONE = String.raw`(?:` + OTHERS + String.raw`|any\s+persons?(?!\s+(?:insured|covered|named|listed|in\s+your\s+family|on\s+the\s+plan|under\s+this\s+(?:policy|plan|certificate)|who\s+(?:is|are)\s+(?:insured|covered))\b))`;
const LIABILITY = new RegExp([
  String.raw`\b(?:personal|public|legal|civil|third[\s-]party|family|individual|tenant['’]?s?|occupiers?['’]?|employers?['’]?|golfers?['’]?|pet\s+owners?['’]?)\s+liabilit(?:y|ies)\b`,
  String.raw`\bliabilit(?:y|ies|i)\s+(?:to|towards|terhadap)\s+` + TO_ANYONE + String.raw`\b`,
  String.raw`\bliable\b[^.;()]{0,100}?\b(?:to|towards|of),?\s+` + TO_ANYONE + String.raw`\b`,
  String.raw`\bcompensation\b[^.;()]{0,80}?\b(?:to|for|of)\s+` + TO_ANYONE + String.raw`\b`,
  String.raw`\b(?:damage|injury|injuries|death|disability|loss)\s+(?:(?:caused|you\s+cause)\s+)?to\s+` + TO_ANYONE + String.raw`\b`,
  String.raw`\b(?:damage|injury|injuries|death|disability|loss)\s+(?:(?:caused|you\s+cause)\s+)?of\s+` + OTHERS + String.raw`\b`,
  String.raw`\b(?:injured|deceased)\s+(?:third[\s-]part(?:y|ies)|other\s+(?:people|persons)|others)\b`,
  String.raw`\b(?:total\s+and\s+permanent\s+disability|tpd|bodily\s+injury|death|hospital\w*|medical\s+expenses?)\b[^.;()]{0,40}?\bof\s+` + OTHERS + String.raw`\b`,
  String.raw`\bthird[\s-]part(?:y|ies)['’]?\s+(?:(?!(?:or|and)\b)[a-z]+\s+){0,2}?(?:property|bodily|death|injury|injuries|hospital\w*|medical|cover|liabilit(?:y|ies)|damage)\b`,
  String.raw`\bclaims?\s+(?:made\s+)?against\s+(?:you|the\s+insured)\b`,
  String.raw`\bliabiliti\s+(?:peribadi|awam|diri|undang-undang|pihak\s+ketiga)\b|\btanggungan\s+pihak\s+ketiga\b`,
  String.raw`\btanggung\s+jawab\s+(?:hukum|pihak\s+ketiga)\b|trách\s+nhiệm\s+dân\s+sự|第三者|第三方责任|\bresponsabilit[ée]\s+civile\b|\bhaftpflicht\w*`,
].join("|"), "iu");
/** Bracketed wording that excludes something ("(excluding damage to third party property)") says what is NOT paid: it
 * never decides that a row is liability cover. */
const EXCLUDED_ASIDE = /[(\[]\s*(?:excluding|excludes|except|other\s+than|not\s+including|but\s+not|no)\b[^()\[\]]*[)\]]/giu;
/** Wording from which on a row says what is NOT paid ("Accidental death excluding injury to others", "- injury to others is
 * excluded", "not payable if you are liable to others", TE pr192 G1). */
const EXCLUDED_TAIL = /\b(?:excluding|except(?:\s+for)?|other\s+than|not\s+payable\s+(?:if|when|where)|not\s+covered\s+(?:if|when|where))\b.*$|\s[-–—]\s[^-–—]*\b(?:is|are)\s+(?:excluded|not\s+covered)\b.*$/isu;
/** A section headed only "Liability" ("Section 4: Liability", "Your liability", "Liabilities"), with no limit word. */
const LIABILITY_SECTION = /^\W*(?:(?:section|part|benefit)\s+\w+\W+)?(?:your\s+|personal\s+)?liabilit(?:y|ies)\W*$/iu;
/** "Death of a person other than the insured" names someone else; its "other than" is no exclusion (TE pr192 r3 note 2). */
const OTHER_THAN_INSURED = /\b(?:death|injury|injuries|disability|loss|damage)\s+(?:of|to)\s+(?:a|any)\s+persons?\s+other\s+than\s+(?:the\s+|you|yourself)(?:insured|life\s+assured|policy\s?holder|policy\s?owner|covered\s+person)?/iu;
const isLiability = (text: string) => OTHER_THAN_INSURED.test(text) || LIABILITY.test(text.replace(EXCLUDED_ASIDE, " ").replace(EXCLUDED_TAIL, " "));
/** A section that is accident cover as a whole: "Personal accident", or one that starts with accident words ("Accidental
 * Benefits"). A section that only mentions an accident ("Death and Accidental Death") is not. */
const ACCIDENT_SECTION = new RegExp(String.raw`\bpersonal\s+accident\b|^\W*(?:(?:benefit|section|part)\s+\w+\W+)?(?:the\s+)?${ACC}`, "i");

/** The one category a benefit name belongs to, or null. A name matching several takes the first in NAMES. A death or
 * disability row printed under an accident section ("Personal accident", "Group Personal Accident") is accident cover
 * whatever its own name says: a travel policy's "Total and permanent disability" under "Personal accident" pays only on an
 * accident (live 31357e4: it joined the TPD tile and cleared its figure). */
/** A death benefit named only in another language (TE R4-2 on #280): an allow-list of names that START with the death
 * words, so a sentence that only mentions a death ("Exonération des cotisations en cas de décès", "Waiver ... upon death")
 * is never taken for one. Malay, Indonesian, French, German, Chinese. German "Tod" only as the whole name or followed by a
 * German word, and with its capital ("TOD surcharge" is no death; Critic M2 on #283). */
const OTHER_LANGUAGE_DEATH = /^\W*(?:(?:manfaat|faedah|santunan|pampasan|uang(?:\s+duka)?)\s+)?(?:kematian|meninggal(?:\s+dunia)?)\b|^\W*(?:(?:capital|prestations?|garantie|indemnit[ée])\s+)?d[ée]c[èe]s\b|^\W*todesfall\w*|^\W*(?:非因?意外(?:的|导致的|導致的)?)?(?:身故|死亡)/iu;
const GERMAN_TOD = /^\W*Tod(?:\s*$|\s+(?:durch|bei|infolge|nach|aus|des|der|eines|einer|und|oder|ohne)\b)/u;
/** Any accident word anywhere in the name, as a substring (compounds such as "Verkehrsunfall" too): the name pays on an
 * accident, never a plain death benefit (Critic H1 on #283). A closed list; unsure is never Death. */
const OTHER_LANGUAGE_ACCIDENT = /accident|kemalangan|kecelakaan|unfall|意外|事故/iu;
/** A name that starts with the accident words and goes on to the death words: "Unfalltod", "Unfall-Todesfall", "意外伤害身故". */
const OTHER_LANGUAGE_ACCIDENT_DEATH = /^\W*(?:unfall\w*[\s-]*tod\w*|(?<!非|非因)意外\S{0,4}(?:身故|死亡))/iu;
/** A closed list of words saying the death benefit pays whatever the cause, accident included ("toutes causes y compris
 * accident", "termasuk kemalangan", "包括意外"), or a death NOT by accident ("bukan akibat kemalangan", "non accidentel",
 * "ohne Unfall", "非意外"): the accident word there does not make it accident only. They are taken out and the rest is
 * read again, so an accident word elsewhere still makes it accident cover ("Décès accidentel, y compris accident de la
 * route"; Critic H1 on #283). */
const OTHER_LANGUAGE_ANY_CAUSE = /\btoutes\s+causes\b|\by\s+compris\s+(?:en\s+cas\s+d['’]\s*|l['’]\s*|un\s+)?accident|\btermasuk\s+(?:akibat\s+)?(?:kemalangan|kecelakaan)\b|\bsemua\s+sebab\b|\bapa\s+jua\s+sebab\b|\beinschlie(?:ß|ss)lich\s+(?:durch\s+)?unfall|\bjede[rn]?\s+ursache\b|包括意外|(?:不包括|不含|除外)?(?:任何|一切)原因(?:除外)?|\bbukan\s+(?:akibat\s+|disebabkan\s+(?:oleh\s+)?|karena\s+)?(?:kemalangan|kecelakaan)\b|\bnon[\s-]+accident\p{L}*|\bohne\s+unfall\p{L}*|非因?意外/giu;
/** A death by accident OR by another cause, in those languages ("Décès par accident ou maladie", "Décès accidentel ou non",
 * "Kematian akibat kemalangan atau penyakit", "Tod durch Unfall oder Krankheit", "身故（意外或疾病）", "因疾病或意外身故"): any
 * cause, so Death, as the English "Death by accident or illness" is (Critic M1 on #283 9d942cd). Both sides from closed
 * lists, joined by "or"/"and" right beside each other. */
const ACC_WORD = String.raw`(?:accident\p{L}*|kemalangan|kecelakaan|\p{L}*unfall\p{L}*|意外|事故)`;
/** Words saying the death pays whatever the cause: beside an accident word ("Décès accidentel ou toutes causes", "Kematian
 * akibat kemalangan atau apa jua sebab") or right after the death words ("Décès toutes causes, doublé en cas d'accident")
 * the name is any-cause Death (TE K2 on #283). Elsewhere ("non cumulable avec décès toutes causes") it is only taken out. */
const TRUE_ANY_CAUSE = String.raw`(?:toutes\s+causes|tout\s+cause|semua\s+sebab|apa\s+jua\s+sebab|sebarang\s+sebab|jede[rnms]?\s+(?:art|ursache)|aus\s+jedem\s+grund|任何原因|一切原因)`;
const LEADING_ANY_CAUSE = new RegExp(String.raw`^\W*(?:(?:manfaat|faedah|santunan|capital|prestations?|garantie)\s+)?(?:kematian|meninggal(?:\s+dunia)?|d[ée]c[èe]s|todesfall\p{L}*|tod|身故|死亡)[\s()（）:：,，-]*(?:(?:de|à|akibat|karena|oleh|aus|durch|因)\s*)?${TRUE_ANY_CAUSE}(?!\s*(?:除外|exclu|excluded|ausgeschlossen|dikecualikan))`, "iu");
const OTHER_CAUSE = String.raw`(?:${TRUE_ANY_CAUSE}|maladies?|penyakit|sakit|krankheit(?:sfall)?|疾病|(?:non|bukan|nicht|tidak)(?:[\s-]+(?:akibat\s+|karena\s+)?${ACC_WORD})?|非(?:意外|事故)?)`;
const OR_AND = String.raw`[\s-]*(?:ou|et|atau|dan|oder|und|或|及|和|/)\s*(?:(?:par|d['’]|akibat|karena|durch|infolge|von|因)\s*)?`;
// Word edges for Latin script only: Chinese runs on with no spaces ("意外或疾病身故"). The pair must end the name, a bracket
// or a clause, or run into the death words: a cause word that goes on ("maladie tropicale", "maladie professionnelle
// exclue", "Krankheitskosten") is a narrowed cause or another benefit, never any cause (Critic L1-L3 on #283).
const CAUSE_END = String.raw`(?=\s*(?:$|[)）\]】,;，；、/(（:：]|\s-\s|身故|死亡))(?!\s*[(（]?\s*(?:exclu|excluded|except|ausgeschlossen|ausser|außer|dikecualikan|tidak\s+termasuk|除外|不包括))`;
const ACCIDENT_OR_OTHER = new RegExp(String.raw`(?<!\p{Script=Latin})(?:${ACC_WORD}${OR_AND}${OTHER_CAUSE}|${OTHER_CAUSE}${OR_AND}${ACC_WORD})(?!\p{Script=Latin})${CAUSE_END}`, "iu");
/** A waiver on death, in those languages: it waives what is paid in, it pays no death benefit (Critic M1 on #283). */
const OTHER_LANGUAGE_WAIVER = /exon[ée]ration|pengecualian\s+(?:sumbangan|caruman|premium|premi|bayaran)|pembebasan|penepian|befreiung|豁免|\bwaiver\b/iu;
/** Someone else's death or loss, in those languages: a liability frame, never the person's own cover. */
const OTHER_LANGUAGE_OTHERS = /\bd['’]un\s+tiers\b|\bdes\s+tiers\b|\bautrui\b|\bd['’]une\s+autre\s+personne\b|\bpihak\s+ketiga\b|\borang\s+lain\b|\bdritte\w*|第三|他人|别人/iu;

/** Another family member named as the one who dies or is disabled ("Spouse death benefit", "Kematian Pasangan", "Décès du
 * conjoint", "Tod des Ehepartners", "配偶身故保险金", "Death of child"): that pays on someone else's death, never the person's
 * own, so it is no Death, accident or disability cover of theirs (TE F2 on #283). A closed list; German "Kind" only with
 * its capital. */
const OTHER_FAMILY_MEMBER = /(?<!\p{L})(?:spouses?|spousal|husbands?|wi(?:fe|ves)|child(?:ren)?|sons?|daughters?|conjoints?|[ée]poux|[ée]pouses?|enfants?|pasangan|suami|isteri|istri|anak(?:-anak)?|ehepartner\p{L}*|ehegatt\p{L}*|ehefrau|ehemann)(?!\p{L})|配偶|子女|孩子|儿童|兒童/iu;
const GERMAN_KIND = /\bKind(?:es|er)?\b/u;
/** Who it is paid TO is the beneficiary, not who dies: "Death benefit paid to your spouse", "dibayar kepada isteri", "versé
 * à votre conjoint", "an Ihren Ehepartner", "给配偶", and a beneficiary label ("Beneficiary: spouse", "Penama: isteri",
 * "Bénéficiaire : conjoint", "Begünstigte: Ehepartner", "受益人：配偶"; Critic M1 on #283). That part never names the one
 * who dies. The strip stops at a death word, which names the one who dies again ("payable to the insured on death of a
 * child", "für den Tod eines Kindes"), so it and what follows are read (Critic L1, TE F3 on #283). */
const DEATH_WORD = String.raw`(?:(?:on|upon)\s+(?:the\s+)?)?death|kematian|meninggal|d[ée]c[èe]s|todesfall|\bTod\b|身故|死亡`;
const UNTIL_DEATH = String.raw`(?:(?!${DEATH_WORD}).)*`;
const PAID_TO = new RegExp(String.raw`(?:\b(?:(?:paid|payable|pays?|given|goes)\s+to|to\s+(?:your|the|his|her|their))\b`
  + String.raw`|\b(?:beneficiar(?:y|ies)|nominees?|payees?|for\s+the\s+benefit\s+of|penama|waris|penerima(?:\s+manfaat)?|zugunsten|beg[üu]nstigte\p{L}*)(?!\p{L})`
  + String.raw`|\bb[ée]n[ée]ficiaires?(?!\p{L})|\bau\s+profit\s+d(?:u|e|es|['’])|\b(?:dibayar(?:kan)?\s+)?kepada\b|\b(?:vers[ée]e?s?|pay[ée]e?s?)\s+(?:à|au|aux)(?=\s)`
  + String.raw`|(?:^|\s)(?:à|au|aux)\s+(?:votre|vos|son|sa|ses|l['’]\s*[ée]poux)\b|\b(?:an|f[üu]r)\s+(?:Ihre[nm]?|den|die|seine[nm]?)\b|受益人|指定)${UNTIL_DEATH}`
  // Chinese "支付给被保险人的配偶身故保险金": only up to "的", whose next words are the one who dies. "给付" is "payment", never
  // "paid to" (身故给付（配偶）).
  + String.raw`|(?:付给|支付给|给(?!付))(?:[^的身死]{0,12}的|${UNTIL_DEATH})`, "giu");

export function categoryOfBenefit(benefit: string, section?: string | null): string | null {
  // Cover for what the person owes others ("Personal Liability", "If you are liable for accidental death, injury or damage
  // to other people") pays a third party, never the person's own death, injury or hospital bill.
  if (isLiability(benefit) || (section && (isLiability(section) || LIABILITY_SECTION.test(section.trim())))) return null;
  const category = NAMES.find(([name, re]) => re.test(benefit) && !(name === "Personal Accident" && causeOf(benefit) !== "accident"))?.[0]
    ?? otherLanguageDeath(benefit);
  if ((category === "Death" || category === "Personal Accident" || category === "Total Permanent Disability")
    && (OTHER_FAMILY_MEMBER.test(benefit.replace(PAID_TO, "")) || GERMAN_KIND.test(benefit.replace(PAID_TO, "")))) return null;
  // A name that says it pays on any cause keeps its own category under any section (Critic R238).
  if ((category === "Death" || category === "Total Permanent Disability") && section && ACCIDENT_SECTION.test(section) && causeOf(benefit) !== "any"
    && causeOf(section) === "accident") return "Personal Accident";
  return category;
}

function otherLanguageDeath(benefit: string): string | null {
  if (OTHER_LANGUAGE_OTHERS.test(benefit) || OTHER_LANGUAGE_WAIVER.test(benefit)) return null;
  const anyCause = ACCIDENT_OR_OTHER.test(benefit) || LEADING_ANY_CAUSE.test(benefit);
  if (OTHER_LANGUAGE_ACCIDENT_DEATH.test(benefit) && !anyCause) return "Personal Accident";
  if (!OTHER_LANGUAGE_DEATH.test(benefit) && !GERMAN_TOD.test(benefit) && !OTHER_LANGUAGE_ACCIDENT_DEATH.test(benefit)
    && !(anyCause && /(?:身故|死亡)/u.test(benefit))) return null;
  if (anyCause) return "Death";
  return OTHER_LANGUAGE_ACCIDENT.test(benefit.replace(OTHER_LANGUAGE_ANY_CAUSE, " ")) ? "Personal Accident" : "Death";
}

/** A critical illness plan often names each benefit by its illness only ("Major Cancer", "Heart attack of specified
 * severity", "Kanser", "中风") with no "critical illness" word in the row: the section it is printed under or the cover it
 * belongs to says what it is ("Critical Illness Benefits", "Acme CritiCare Critical Illness Plan", "Dread Disease Takaful",
 * "Pelan Penyakit Kritikal", "危疾保障"). Such a row is critical illness cover, or early critical illness where the row
 * names an early or intermediate stage.
 *
 * An allow-list (TE pr252 F1): a row moves only when its own name is an illness, condition or procedure from the closed
 * list below, in English, Malay or Chinese. Every other row (a death, disability, waiver, surrender value, refund, cash,
 * or a period such as free-look, grace, waiting or survival, in any language) stays where its own name puts it, or
 * nowhere. Only these two categories are read from a section or cover name, the row's own name decides first, and a row
 * naming another kind of payment or cover for other people is never moved. The same for any insurer, market or currency. */
const CI_COVER = new RegExp(String.raw`\b(?:critical\s+illness(?:es)?|dread\s+diseases?|penyakit\s+(?:kritikal|kritis|berbahaya)|major\s+illness(?:es)?)\b|危疾|重大疾病|重疾`, "iu");
const EARLY_COVER = new RegExp(String.raw`\b(?:early|intermediate)[\s-]+(?:stage\s+)?(?:critical\s+illness|ci|dread\s+disease)\b|\bpenyakit\s+kritikal\s+(?:peringkat\s+)?awal\b|早期危疾|早期重大疾病`, "iu");
/** The words a covered illness is named with, and nothing else (Critic R on #252 H1a): every word of the row's name must be
 * one of them, so "Cancer Screening Benefit", "Child Cancer Benefit", "Kematian akibat Kanser", "癌症身故保险金" or "Liver
 * function test" (a word outside the list) never move. Illness, organ and procedure words, then severity and stage words,
 * then joining words, in English and Malay; Chinese names are read phrase by phrase. */
const CONDITION_WORDS = new Set((
  // English illnesses, organs and procedures
  "cancer cancers carcinoma malignant malignancy tumour tumor tumours tumors leukaemia leukemia lymphoma sarcoma melanoma heart attack myocardial "
  + "infarction coronary artery arteries bypass by-pass angioplasty valve valves cardiomyopathy aorta aortic pulmonary hypertension arterial stroke strokes "
  + "cerebrovascular kidney kidneys renal failure organ organs transplant transplantation bone marrow blindness loss sight hearing speech limb limbs "
  + "independent existence deafness dementia alzheimer alzheimer's alzheimers parkinson parkinson's parkinsons motor neurone neuron multiple sclerosis "
  + "muscular dystrophy paralysis coma encephalitis meningitis bacterial viral brain head trauma burns burn liver lung lungs respiratory hepatitis "
  + "fulminant aplastic anaemia anemia lupus systemic erythematosus hiv aids poliomyelitis apallic syndrome neurological deficit endocarditis infective "
  + "myasthenia gravis surgery disease diseases "
  // body sites a cancer or condition is named by (never enough alone)
  + "breast prostate cervix cervical ovary ovarian colon colorectal skin thyroid bladder stomach uterus uterine pancreas pancreatic blood nasopharyngeal "
  + "payudara prostat serviks kulit darah rahim pankreas usus "
  // severity and stage
  + "major severe severity specified end end-stage stage benign early intermediate advanced late minor mild moderate chronic acute irreversible total "
  + "permanent in situ excluding less cases "
  // joining words
  + "of with the to and or a an "
  // Malay
  + "kanser barah tumor serangan jantung koronari arteri pembedahan strok angin ahmar buah pinggang ginjal kegagalan pemindahan organ sumsum tulang "
  + "buta kebutaan pekak bisu kehilangan penglihatan pendengaran pertuturan lumpuh kelumpuhan koma otak hati paru paru-paru lecur demensia nyanyuk "
  + "penyakit tahap akhir peringkat awal teruk utama kritikal kritis yang dan atau"
).split(" "));
const CHINESE_CONDITION = /恶性肿瘤|肿瘤|癌症|癌|白血病|心脏病|心脏|心肌梗塞|心肌|冠状动脉|搭桥|手术|脑中风|中风|肾衰竭|肾|衰竭|器官移植|器官|移植|骨髓|失明|失聪|瘫痪|昏迷|肝|肺|烧伤|痴呆|帕金森|硬化|严重|末期|早期|重大|疾病|病|发作|症|的|性/gu;
/** Whether the row's whole name is an illness: at least one illness word, and no word from outside the list. */
function namesOnlyAnIllness(benefit: string): boolean {
  const cjk = /\p{Script=Han}/u.test(benefit);
  if (cjk && /\p{Script=Han}/u.test(benefit.replace(CHINESE_CONDITION, ""))) return false;
  const words = benefit.replace(/\p{Script=Han}+/gu, " ").toLowerCase().split(/[^\p{L}\p{N}'’-]+/u).map((w) => w.replace(/[’]/g, "'").replace(/^[-']+|[-']+$/g, "")).filter(Boolean)
    .filter((w) => !/^(?:\d+|[ivx]+|[a-z])$/.test(w));
  if (!words.every((w) => CONDITION_WORDS.has(w))) return false;
  const joining = new Set("of with the to and or a an yang dan atau in situ excluding less cases".split(" "));
  const generic = new Set(("loss failure attack disease diseases surgery syndrome deficit penyakit kegagalan serangan pembedahan kehilangan "
    + "breast prostate cervix cervical ovary ovarian colon colorectal skin thyroid bladder stomach uterus uterine pancreas pancreatic blood nasopharyngeal "
    + "payudara prostat serviks kulit darah rahim pankreas usus").split(" "));
  const stage = new Set("major severe severity specified end end-stage stage benign early intermediate advanced late minor mild moderate chronic acute irreversible total permanent tahap akhir peringkat awal teruk utama kritikal kritis".split(" "));
  return (cjk && /癌|肿瘤|白血病|心|冠状动脉|中风|肾|移植|骨髓|失明|失聪|瘫痪|昏迷|肝|肺|烧伤|痴呆|帕金森|硬化/u.test(benefit)) || words.some((w) => !joining.has(w) && !stage.has(w) && !generic.has(w));
}
const EARLY_STAGE = /\b(?:early|intermediate|minor|mild|moderate)[\s-]+(?:stage|severity)\b|\b(?:carcinoma\s+in\s+situ|in[\s-]situ)\b|\bperingkat\s+awal\b|早期/iu;
const OTHER_PAYMENT = /\b(?:waiv\w*|premiums?|refund\w*|return\s+of|surrender\w*|cash\s+values?|fund\s+values?|bonus\w*|dividends?|maturity|loyalty|no[\s-]claims?|terminal(?:ly)?\s+ill\w*|death|funeral|compassionate|disab\w*|tpd|accident\w*|injur\w*|fractur\w*|hospital\w*|ward|out-?\s?patient|in-?\s?patient|medical\s+expenses?|reimburse\w*|ambulance|income|allowance|daily|period)\b/i;
export function categoryOfRow(r: { benefit: string; section?: string | null } & CoverNames): string | null {
  const own = categoryOfBenefit(r.benefit, r.section);
  if (own || !namesOnlyAnIllness(r.benefit) || OTHER_PAYMENT.test(r.benefit) || isLiability(r.benefit)
    || (r.section && (isLiability(r.section) || LIABILITY_SECTION.test(r.section.trim())))) return own;
  // The row's own section and its own cover's name (Critic R on #252 H1a). The product names the whole policy, base plan and
  // riders together ("LifeGuard Saver with Critical Illness Rider"), so it is read only when it is that cover's own name
  // (a stand-alone plan) or the cover has none. A plan tier ("Plan B") is never read.
  const own_ = (x: string | null | undefined) => (x ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const names = [r.section, r.cover, !r.cover || own_(r.cover) === own_(r.product) ? r.product : null].filter((x): x is string => !!x);
  if (names.some((n) => EARLY_COVER.test(n))) return "Early Critical Illness";
  if (!names.some((n) => CI_COVER.test(n))) return null;
  return EARLY_STAGE.test(r.benefit) ? "Early Critical Illness" : "Critical Illness";
}

/** One person's cover by whole-policy kind (Travel, Savings, Investment), the one rule Home and the Coverage page use: the
 * kind belongs to the policy, never to one benefit's name. Travel by the cover's own name (travelName); savings and
 * investment by the plan type its name or its document's own words state (lib/coverage/plan-type.ts). `current` names
 * each policy once. Every policy on file is treated as in force: a printed end date, period or expiry never changes
 * whether it counts (DC, 31 Oct). A held cover counts even before any row is linked to it. */
export type KindEntry = { current: string[]; note: string | null };
type KindCover = CoverNames & { coverKey?: string; riderOf?: string | null; planType?: PlanType | null };
type KindRow = CoverNames & { coverKey?: string; pays: string };
export function personKinds(covers: KindCover[], rows: KindRow[]): Map<string, KindEntry> {
  const out = new Map<string, KindEntry>();
  const add = (category: string, name: string, note: string | null = null) => {
    const e = out.get(category) ?? out.set(category, { current: [], note: null }).get(category)!;
    if (!e.current.includes(name)) { e.current.push(name); e.note ??= note; }
  };
  const travelLabel = (c: CoverNames) => [c.cover || c.product, c.plan && c.plan !== c.cover ? `${c.plan} plan` : null].filter(Boolean).join(" · ") || "Travel policy";
  for (const c of covers) {
    if (!c.riderOf && travelName(c)) add("Travel", travelLabel(c));
    const kind = c.planType?.kind;
    if (kind) add(kind === "savings" ? "Savings" : "Investment", c.product || c.cover || "Policy",
      c.planType!.page != null ? `${kind === "savings" ? "A savings plan" : "An investment-linked plan"}: its document says "${c.planType!.quote.slice(0, 120)}" (page ${c.planType!.page}).`
        : `${kind === "savings" ? "A savings plan" : "An investment-linked plan"}, as its name says.`);
  }
  // A travel cover only rows name (its schedule line not matched to the person). A row of a held cover is counted above.
  const held = new Set(covers.map((c) => c.coverKey).filter(Boolean));
  for (const r of rows) {
    if (!travelName(r) || r.pays === "not_covered" || r.pays === "value" || (r.coverKey && held.has(r.coverKey))) continue;
    add("Travel", travelLabel(r));
  }
  return out;
}

/** What the rule above says about each document of the household's benefit table (Benefits lists by document): it is a
 * savings or investment plan. A document no rule says anything about is left out. */
export type DocumentKind = { plan: "Savings" | "Investment" | null; note: string | null };
type SourcedCover = KindCover & { source?: { documentId?: string | null } | null };
type SourcedRow = KindRow & { source?: { documentId?: string | null } | null };
export function documentKinds(people: { covers?: SourcedCover[]; rows?: SourcedRow[] }[]): Record<string, DocumentKind> {
  const per = new Map<string, { plan: Set<string>; note: string | null }>();
  for (const p of people) {
    const ids = new Set([...(p.covers ?? []), ...(p.rows ?? [])].map((x) => x.source?.documentId).filter((d): d is string => !!d));
    for (const id of ids) {
      const kinds = personKinds((p.covers ?? []).filter((c) => c.source?.documentId === id), (p.rows ?? []).filter((r) => r.source?.documentId === id));
      const e = per.get(id) ?? { plan: new Set<string>(), note: null };
      for (const k of ["Savings", "Investment"]) if (kinds.get(k)?.current.length) { e.plan.add(k); e.note ??= kinds.get(k)!.note; }
      per.set(id, e);
    }
  }
  const out: Record<string, DocumentKind> = {};
  for (const [id, e] of per) if (e.plan.size === 1) out[id] = { plan: [...e.plan][0] as "Savings" | "Investment", note: e.note };
  return out;
}

/** What the person pays in, by the names insurers use in any market (a closed list): a premium, Indonesian "premi",
 * Spanish "prima anual", Portuguese "prêmio", French "cotisation" or "prime annuelle", German "Prämie" or "Beitrag", a
 * Takaful "contribution" (Malay "sumbangan", "caruman", Indonesian "kontribusi", "iuran"), Vietnamese "phí bảo hiểm",
 * Chinese 保费/保費 and Japanese 保険料. A contribution TOWARDS something ("contribution towards funeral costs") and a
 * funeral, burial, bereavement or education contribution are benefits the policy pays, never what the person pays. */
const PAID_IN_WORD = String.raw`premiums?|premi|primas?(?=\s+(?:anual|mensual|trimestral|semestral|total|neta|única|unica|de\s+(?:seguro|riesgo)))|pr[êé]mios?`
  + String.raw`|(?<!\b(?:funeral|burial|bereavement|education|income|expenses?|employer)\s)contributions?(?!\s+(?:to|towards|benefits?)\b)|sumbangan|caruman|kontribusi|iuran|cotisations?`
  + String.raw`|primes?\s+(?:annuelle|mensuelle|trimestrielle|totale|d['’]assurance|nette|brute)|pr[äa]mien?|beitr[äa]ge?|phí\s+bảo\s+hiểm`;
const PAID_IN_CJK = "保险费|保險費|保费|保費|保険料";
const PAID_IN = String.raw`(?:\b(?:${PAID_IN_WORD})\b|${PAID_IN_CJK})`;
/** A benefit that pays back, waives or rebates what was paid in. Only these words RIGHT BESIDE the paid-in word count
 * ("return of contributions", "refund of premiums", "waiver of future premiums", "contributions waived", "premium
 * rebate", "Beitragsrückgewähr", "pengembalian kontribusi", "退还保费"), or a share of what was paid ("105% of total
 * contributions paid"). Anywhere else they say nothing: "Tabarru' contribution (non-refundable) RM30" is a contribution
 * (Critic R276 M1). What was paid in, paid back, is a benefit only when the row names what pays it BEFORE the total
 * ("Death benefit: total contributions paid plus profit", "higher of sum assured or premiums paid to date", TE R276 F2);
 * a row that just states it ("Total premiums paid", "Premiums paid to date") is a premium statement. A rebate
 * is money back, never a cover sum, so it stays withheld (Critic R276 H1). */
/** What was paid in, in total: "total premiums paid", "all contributions paid", "jumlah sumbangan dibayar", "premiums paid to
 * date". Inside a frame, nothing between the frame word and it may be a figure, ";", ":" or " - " (another label). */
const TOTAL_PAID = String.raw`(?:(?:(?:sum|total)\s+of(?:\s+all)?|total|all|jumlah)\s+(?:(?:the|your)\s+)?${PAID_IN}\s+(?:paid|dibayar)\b|${PAID_IN}\s+paid\s+to\s+date\b)`;
const FRAME_GAP = String.raw`(?:(?![\d;:]|\s[-–—]\s)[^\n])*?`;
const PAID_BACK_FRAMES = [
  // "higher of sum assured or total premiums paid"; "sum assured or premiums paid to date, whichever is higher".
  String.raw`\b(?:higher|greater)\s+of\b${FRAME_GAP}${TOTAL_PAID}`,
  String.raw`${TOTAL_PAID}${FRAME_GAP},?\s*whichever\s+is\s+(?:higher|greater)\b`,
  // A benefit name starts the clause, then ":" or "=": "Death benefit: total contributions paid", "Manfaat kematian: jumlah sumbangan dibayar".
  String.raw`(?:^|;)\W*(?:[\p{L}']+\s+){0,2}(?:benefits?|(?:manfaat|faedah)(?:\s+[\p{L}']+)?)\s*[:=]\s*${TOTAL_PAID}`,
  // "total contributions paid plus profit".
  String.raw`${TOTAL_PAID}\s+plus\s+(?:profits?|bonus(?:es)?|interest|dividends?|keuntungan|hibah)\b`,
];
const PAID_BACK = new RegExp([
  String.raw`\b(?:returns?|returned|refunds?|refunded|repaid|repayment|waiv\w*|pengembalian|pemulangan|pengecualian|pembebasan|remboursement|exon[ée]ration|devoluci[óo]n|devolu[çc][ãa]o)\s+(?:(?:of|des?|du|atas|del?|da|do)\s+)?(?:(?:the|all|future|total|your|outstanding|la|las|los|les)\s+)*${PAID_IN}`,
  String.raw`${PAID_IN}\s+(?:(?:is|are|will\s+be|to\s+be)\s+)?(?:waived|waiver|refunded|refunds?|returned|dikembalikan|dikecualikan)\b`,
  String.raw`(?:beitrags|prämien|praemien)(?:befreiung|r[uü]ckgew[aä]hr|r[uü]ckerstattung)|(?:退还|返还|豁免|退還|返還)(?:${PAID_IN_CJK})|(?:${PAID_IN_CJK})(?:豁免|退还|返还|退還|返還)`,
  String.raw`\b\d+(?:\.\d+)?\s?%\s+(?:of|des?|dari)\s+(?:(?:the|total|all|jumlah)\s+)*${PAID_IN}(?:\s+(?:paid|dibayar|payés?|pagad[oa]s?))?`,
  // The total paid, paid back: only inside a frame that names what pays it, anchored by position (Critic R276 H1 r2).
  ...PAID_BACK_FRAMES,
].join("|"), "iu");
/** A note in brackets after a figure ("Premium RM300 (refund of premium on cancellation)") says how the figure behaves; the
 * name before the figure says what it is (Critic R276 L). */
const NOTE_AFTER_FIGURE = /(\d)\s*\([^)]*\)/gu;
/** A premium the person pays, never a benefit (chat.ts uses the same). A benefit worked out from the premiums paid is a
 * benefit: "Waiver of Premium", "Return of Premium", and a share of them ("Death benefit: higher of 105% of total premiums
 * paid to date", "sum of all premiums paid"); left out, a Death tile added up the other policies as if they were all of it.
 * Only premiums PAID: a premium priced as a share of another ("rider premium: 12% of basic premium") is a premium (Critic R418 M1). */
export const PREMIUM: { test(text: string): boolean } = {
  test: (text: string) => {
    if (!new RegExp(PAID_IN, "iu").test(text)) return false;
    const head = text.replace(NOTE_AFTER_FIGURE, "$1");
    // Named before the figure: the name decides. Named only in the note: the note decides ("RM30 (monthly contribution)"
    // is a contribution, "RM100,000 (contributions waived on TPD)" a benefit).
    return new RegExp(PAID_IN, "iu").test(head) ? !PAID_BACK.test(head) : !PAID_BACK.test(text);
  },
};
/** A section that holds only what the person pays ("Contribution", "Sumbangan / Contribution", "Kontribusi", "Annual
 * premium", "Section 3: Premium details"): every row under it is a premium, whatever the row's own name says ("Death",
 * TE R276 F1). A section that also names benefits ("Benefits and premiums", "Benefit and Premium Schedule") is not one. */
const SECTION_FILLER = new RegExp(String.raw`\b(?:(?:section|part|bahagian|bagian)\s+[\w.]+|annual|yearly|monthly|quarterly|half[\s-]yearly|total|modal|tahunan|bulanan|annuelle|mensuelle|anual|mensal|mensual|jährlich|monatlich|schedule|details?|table|amount|payable|due|jadual|butiran|rincian|jumlah|the|your|of|and|dan|per|a|an|each|month|months|year|years|day|days|week|weeks|bulan|tahun|sebulan|setahun|tabarru)\b`, "giu");
/** A currency or unit printed in the heading ("Contribution (RM)", "Premium payable (SGD)", "Kontribusi (Rp)", TE R276
 * R2-F1): a closed list of currency codes and markers, never any three letters (that would also strip "TPD"). */
const SECTION_CURRENCY = new RegExp(String.raw`\b(?:S|US|HK|NT|NZ|A|C|R)\$|\b(?:RM|Rp|SGD|MYR|IDR|USD|EUR|GBP|CNY|RMB|HKD|JPY|AUD|NZD|THB|PHP|VND|INR|CHF|CAD|BRL|TWD|KRW|AED|BND)\b|[$€£¥₫₱฿₹円元]`, "giu");
export function isPremiumSection(section: string | null | undefined): boolean {
  if (!section || !PREMIUM.test(section)) return false;
  // Letters of any script are what is left; CJK and accented letters count (an ASCII \W would strip them all).
  const rest = section.replace(new RegExp(PAID_IN, "giu"), " ").replace(SECTION_CURRENCY, " ").replace(SECTION_FILLER, " ").replace(/[^\p{L}]+/gu, "");
  return rest.length === 0;
}

/** The person's rows for the category: rows that pay something the person holds, never a projection, a fund or
 * surrender value ("Death benefit fund value"), a premium, or a row the document marks not covered (Critic R225). Nor a
 * limit on what several benefits pay together, which is no cover of its own, or a row of a short-term cover whose term
 * has ended (a single trip that is over): both are marked when the table is put together (lib/benefit-table/assemble.ts). */
export function categoryRows<T extends SummaryRow & CoverNames>(category: string, rows: T[]): T[] {
  // A row under a heading that holds only what the person pays is a premium, whatever its own name says (TE R276 F1).
  rows = rows.filter((r) => !isPremiumSection(r.section));
  return rows.filter((r) => r.figure.kind !== "projected" && r.figure.kind !== "value" && r.pays !== "value" && r.pays !== "not_covered"
    && !r.combinedLimit && !r.coverEnded && !PREMIUM.test(r.benefit) && (category === "Travel" ? travelName(r) : categoryOfRow(r) === category));
}

/** The names a row carries of the cover it belongs to. Travel cover is a whole policy, not a benefit name: trip
 * cancellation, baggage and medical expenses abroad are all Travel rows when the cover's own name says it is travel
 * insurance (travelName below), whatever each benefit is called. A benefit name alone never makes a row travel ("Daily
 * hospital cash while overseas" in a hospital plan). Its rows still count for their own tiles too. */
type CoverNames = { cover?: string | null; plan?: string | null; product?: string | null };

/** Travel cover needs two signals together (TE P147-6): the cover's own product, cover or plan name says travel insurance
 * ("Travel insurance", "Single Trip", "Annual Multi-Trip"), and EVERY one of its rows here pays only abroad ("while overseas"):
 * a cover with any home row is standing cover (TE P147-6 round 2).
 * A product name with a travel-like word alone ("Life Journey Saver", "Sunny Holidays Group Insurance") is standing cover,
 * and one benefit's wording alone never makes a cover travel. When unsure the cover stays in, and the tile gives no figure. */
const TRAVEL_NAME = /\btravel\w*\s+(?:insurance|cover|protection|policy|assurance)\b|\b(?:holiday|journey|trip)\s+(?:insurance|cover|policy)\b|\b(?:single|annual|multi)[\s-]*trips?\b/i;
/** A group scheme's product name is often the employer's ("Holiday Inn Group Insurance", Critic R243): only the cover and
 * plan names are read for it, never the product name. */
export const SCHEME_NAME = /\b(?:group|scheme|staff|employees?|corporate|company|employer)\b/i;
export const travelName = (r: { cover?: string | null; plan?: string | null; product?: string | null }) => TRAVEL_NAME.test([r.cover, r.plan, r.product && !SCHEME_NAME.test(r.product) ? r.product : null].filter(Boolean).join(" · "));
const ABROAD_ROW = /\b(?:while|whilst|when)\s+(?:you\s+are\s+)?(?:overseas|abroad|travel\w*)\b|\bduring\s+(?:the|your|a)\s+(?:trip|journey)\b/i;
/** A row that also pays at home is not trip-only ("including while overseas", "or at home", "in Singapore and overseas"). */
const ALSO_HOME = /\b(?:including|incl\.?|also|as\s+well\s+as|even|at\s+home|locally|home\s+country)\b|\bin\s+[A-Z][\w-]*\s+(?:and|or|&)\b/;
const abroadOnly = (benefit: string) => ABROAD_ROW.test(benefit) && !ALSO_HOME.test(benefit.replace(/^\w/, (c) => c.toLowerCase()));
/** A part of a benefit's payment terms, not its amount: a name that states a threshold with its own money figure ("paid
 * in instalments where the sum payable is above 200,000 dollars", printed with its sign). A guaranteed minimum ("at least",
 * "not less than") is the benefit, not a clause (TE P147-2, round 5 C1-C4). */
const FIGURE = String.raw`(?:${MONEY_SIGN}\s?\d|\d[\d,]*\s?(?:${MONEY_SIGN}))`;
const THRESHOLD = String.raw`(?<!\b(?:not|no|at)\s+)\b(?:above|below|over|under|exceed\w*|more\s+than|less\s+than)`;
const CLAUSE = new RegExp(String.raw`${THRESHOLD}\s+(?:\w+\s+){0,2}?${FIGURE}|${FIGURE}[\d,.]*\s+(?:or\s+(?:less|more|above|below|under|over))\b`, "i");
/** A waiver of premium: the person stops paying on a disability or illness, but it pays nothing out ("Waiver of premium
 * on total and permanent disability benefit"). */
const WAIVER = /\bwaiv\w*\s+(?:of\s+)?(?:future\s+)?(?:premiums?|contributions?)\b|\b(?:premiums?|contributions?)\s+waiv|\b(?:pengecualian|pembebasan)\s+(?:sumbangan|caruman|premium|premi|kontribusi)\b|beitragsbefreiung|\bexon[ée]ration\s+des\s+(?:primes|cotisations)\b|豁免保费/i;

type CoverRow = SummaryRow & { coverKey?: string; holding?: string; product?: string; cover?: string; plan?: string | null };
/** The policy a row or held cover belongs to: its own holding when the person holds several policies of its cover type
 * (two policy numbers, lib/benefit-table/assemble.ts), else its cover type. */
const policyOf = (r: { coverKey?: string; holding?: string }) => r.holding ?? r.coverKey;
/** The rows a Home tile takes its figure from. A row is left out of the comparison only for a fact about its own cover:
 *  - a threshold clause or a waiver of premium, when another row of the SAME cover is left to give its figure;
 *  - a whole travel cover, or a cover whose rows here are all waivers, when another cover is left.
 * Another cover's row is never left out for its wording, so a phrasing no rule knows gives "Covered", never a wrong
 * figure (TE round 5). A person with travel cover only still sees its rows. The Coverage page keeps every row. */
export function tileRows<T extends CoverRow>(rows: T[]): T[] {
  const covers = new Map<string, T[]>();
  for (const r of rows) { const k = policyOf(r) ?? ""; covers.set(k, [...(covers.get(k) ?? []), r]); }
  const kept = [...covers.values()].map((list) => {
    const own = list.filter((r) => !CLAUSE.test(r.benefit) && !WAIVER.test(r.benefit));
    return { list: own.length ? own : list, travel: list.some(travelName) && list.every((r) => abroadOnly(r.benefit)),
      waiverOnly: list.every((r) => WAIVER.test(r.benefit)) };
  });
  const paying = kept.filter((c) => !c.waiverOnly);
  const standing = (paying.length ? paying : kept).filter((c) => !c.travel);
  return (standing.length ? standing : paying.length ? paying : kept).flatMap((c) => c.list);
}

/** Every condition is taken to change what is paid, and so must be the same on every row of a tile, unless it has one of
 * two plain eligibility shapes (Critic R241: an allow-list, never a list of amount words to refuse):
 *  - a cause it is not paid for: "No benefit is payable for / if / due to / arising from / caused by <cause>",
 *    "Excluding <cause>", where the cause names no amount, payment, charge, benefit, policy, insurer, number or period;
 *  - a stay or standing wording made only of plain words ("inpatient only", "continuous hospital stay", "admitted on the
 *    advice of a doctor", "while this policy is in force", "subject to the policy terms", "medically necessary").
 * Anything else ("Excluding amounts paid under ...", "Not payable in excess of the actual charges", "payable at the
 * ward-class rate", "reduced by half after age sixty-five") is a limit: the tile then gives no figure unless every row
 * prints it (Critic R238, TE P147-5). */
const CAUSE_HEAD = /^\s*(?:(?:no\s+benefits?|nothing|no\s+cover)(?:\s+(?:shall|will)\s+be|\s+is)?(?:\s+(?:payable|paid|covered))?|(?:the\s+benefit\s+is\s+)?not\s+(?:payable|paid|covered)|excluding|excludes?|except\s+for|exclusions?\s*:)\s+(?:(?:for|if|due\s+to|arising\s+(?:from|out\s+of)|caused\s+by|resulting\s+from|in\s+respect\s+of|on\s+account\s+of|from)\s+)?/i;
/** The only words a cause may use (Critic R242): plain linking words and the causes policies exclude. A cause with any
 * other word ("outstanding loans", "the shortfall", "subsequent claims", "the surrender value") is a limit. */
const CAUSE_WORDS = new Set(["the", "a", "an", "of", "or", "and", "and/or", "to", "by", "from", "due", "in", "on", "with", "such", "as", "including",
  "directly", "indirectly", "arising", "caused", "resulting", "related", "associated", "out", "whether",
  "self-inflicted", "self", "inflicted", "wilful", "willful", "intentional", "intentionally", "injury", "injuries", "suicide", "attempted",
  "pregnancy", "maternity", "childbirth", "miscarriage", "abortion", "reason", "reasons", "hospitalisation", "hospitalization",
  "war", "riot", "riots", "civil", "commotion", "terrorism", "invasion", "hostilities", "rebellion", "insurrection", "strike", "strikes",
  "nuclear", "radiation", "radioactive", "contamination", "alcohol", "drugs", "drug", "intoxication", "intoxicated", "influence",
  "hazardous", "extreme", "contact", "sports", "sport", "racing", "aviation", "military", "service", "criminal", "act", "acts",
  "pre-existing", "condition", "conditions", "illness", "illnesses", "disease", "diseases", "congenital", "birth", "defects",
  "cosmetic", "surgery", "dental", "treatment", "hiv", "aids", "mental", "disorder", "disorders", "insanity", "venereal",
  "experimental", "infertility", "sterilisation", "sterilization"]);
const allCauseWords = (cause: string) => cause.toLowerCase().split(/[\s/(),.]+/).filter(Boolean).every((w) => CAUSE_WORDS.has(w));
const STANDING_WORDS = new Set(["the", "a", "an", "as", "in", "on", "of", "to", "be", "is", "must", "while", "only", "insured", "person", "life", "assured",
  "hospital", "inpatient", "in-patient", "admitted", "admission", "confined", "hospitalised", "hospitalized", "continuous", "consecutive", "stay",
  "advice", "registered", "doctor", "medical", "practitioner", "medically", "necessary", "subject", "terms", "conditions", "provisions",
  "this", "policy", "cover", "plan", "force", "and", "confinement"]);
/** A cause is one plain phrase: no second clause after a colon, semicolon, dash or comma ("juveniles: fifty percent",
 * "juveniles, who get one-quarter") and no count, ordinal or fraction ("a second disability"), which are a closed class
 * of words, not a list to grow (TE round 6). The prod wording's "(including due to suicide/ attempted suicide)" and
 * "and/or" are one phrase. */
const NUMBER_WORD = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\w+teen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|first|second|third|fourth|fifth|\w+th|half|halves|quarters?|thirds?|double|single|twice|thrice|percent|per\s?cent)\b/i;
const onePlainCause = (cause: string) => !/[:;]|\s[-–—]\s|,\s*\w/.test(cause.replace(/\([^)]*\)/g, "")) && !NUMBER_WORD.test(cause);
function isEligibility(c: string): boolean {
  const head = c.match(CAUSE_HEAD);
  if (head) { const cause = c.slice(head[0].length).trim(); return cause.length > 0 && onePlainCause(cause) && allCauseWords(cause); }
  const words = c.toLowerCase().replace(/[.,;:()]/g, " ").split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => STANDING_WORDS.has(w));
}
const isLimit = (c: string) => !isEligibility(c);
/** Conditions compare without case, spacing or a closing full stop ("Max 6 claims per year" and "max 6 claims per year."). */
const plainCondition = (c: string) => c.toLowerCase().replace(/\s+/g, " ").replace(/[\s.;,]+$/, "").trim();
const limits = (r: SummaryRow) => r.conditions.filter(isLimit).map(plainCondition).sort().join(" · ");

type Money = { amount: number; currency: string | null; unit?: string; period?: unknown };
const moneyOf = (r: SummaryRow): Money | null => "amount" in r.figure ? r.figure as Money : null;
/** Another document of the same cover printing the same figure with its currency, where this row's page prints a bare
 * sign (a bare-sign figure beside the same figure with its currency, for one cover): the row says nothing the other does not. Only the
 * same cover, kind, amount, unit, days and qualifier count; a bare sign is never read as a currency, and it is never
 * matched to another cover's row (live 31357e4). */
function restatedWithCurrency(r: SummaryRow & { coverKey?: string }, rows: (SummaryRow & { coverKey?: string })[]): boolean {
  const a = moneyOf(r);
  if (!a || a.currency != null || !r.coverKey) return false;
  return rows.some((s) => {
    const b = moneyOf(s);
    return s !== r && !!b && b.currency != null && s.coverKey === r.coverKey && s.figure.kind === r.figure.kind && b.amount === a.amount
      && b.unit === a.unit && JSON.stringify(b.period ?? null) === JSON.stringify(a.period ?? null)
      && s.fromDay === r.fromDay && s.maxDays === r.maxDays && s.qualifier === r.qualifier && s.pays === r.pays && limits(s) === limits(r);
  });
}

/** The text for a tile: the row's short figure and its days ("MYR 80 a day · from day 4 · up to 60 days"), with its
 * conditions when every row prints the same ones. Rows agree on the figure, who it is for and its days; the conditions
 * are not compared, because two documents of one scheme word them differently (live 31357e4), except the ones that limit
 * what is paid, which must agree. A row that only restates
 * another document's figure for the same cover without its currency is left out (restatedWithCurrency). Null when the rows print
 * different figures (two plans, or a table by age), or a row gives no figure: the tile then says Covered, and the
 * Coverage page lists each row with its own figure. */
export function tableDisplay(all: (SummaryRow & { coverKey?: string })[]): string | null {
  const rows = all.filter((r) => !restatedWithCurrency(r, all));
  const figure = (r: SummaryRow) => r.figure.kind === "none" && r.pays !== "as_charged" ? null
    : [shortFigure(r).text, rowDetail({ ...r, conditions: [] })].filter(Boolean).join(" · ");
  const texts = new Set(rows.map(figure));
  if (texts.size !== 1 || [...texts][0] == null || new Set(rows.map(limits)).size > 1) return null;
  const conditions = new Set(rows.map((r) => r.conditions.join(" · ")));
  // Differing wording still shows the limits, which every row prints alike (Critic R239).
  return [[...texts][0], conditions.size === 1 ? [...conditions][0] : rows[0].conditions.filter(isLimit).join(" · ")].filter(Boolean).join(" · ");
}

/** One confirmed schedule line (a sum insured) of a tile's category: the documents of its policy, and its amount. */
export type ConfirmedLine = { documentIds: string[]; amount: number | null; currency: string | null };
type TileRow = CoverRow & { source?: { documentId: string } | null };
/** Whether the confirmed lines' total is the whole of a tile's cover, for a category whose figures are not added up: every
 * paying cover the person's benefit table gives for the category is one of them, joined through its own document (a
 * row's, or the held cover's: the page that names the person with it), one cover per line. An equal amount never joins
 * a cover to a line (Critic R246, TE P148-1). Any other cover, or a confirmed line with no amount, makes the total part
 * of the cover, and the tile then says Covered, never a part sum (live 27f35c1). */
export function confirmedTotalComplete(rows: TileRow[], lines: ConfirmedLine[], held: HeldCover[] = []): boolean {
  if (lines.some((l) => l.amount == null)) return false;
  const used = new Set<ConfirmedLine>();
  for (const [key, list] of coversOf(rows)) {
    if (list.every((r) => r.pays === "not_covered")) continue;
    const docs = coverDocs(key, list, held);
    const match = lines.find((l) => !used.has(l) && l.documentIds.some((d) => docs.has(d)));
    if (!match) return false;
    used.add(match);
  }
  return true;
}
const coversOf = (rows: TileRow[]) => {
  const covers = new Map<string, TileRow[]>();
  rows.forEach((r, i) => { const k = policyOf(r) ?? `#${i}`; covers.set(k, [...(covers.get(k) ?? []), r]); });
  return covers;
};
const coverDocs = (key: string, list: TileRow[], held: HeldCover[]) =>
  new Set([...list.map((r) => r.source?.documentId), ...held.filter((h) => policyOf(h) === key).map((h) => h.documentId)].filter(Boolean) as string[]);

/** Lump-sum categories, whose covers each pay their own sum: a tile adds them up. Hospital and indemnity figures are never
 * added (Critic R246). */
export const LUMP_SUM_CATEGORIES = new Set(["Death", "Total Permanent Disability", "Critical Illness", "Early Critical Illness", "Personal Accident"]);
/** A cover the person's benefit table holds: its own document (the page that names the person with it) and sum insured. */
export type HeldCover = { coverKey: string; holding?: string; name: string; documentId: string | null; sumInsured: number | null; currency?: string | null;
  /** The sum its page prints but says is not what is paid (lib/documents/notional-sum): a schedule line of that document
   * with this amount is the same notional figure, so it is named with no amount, never added up. */
  notionalSum?: number | null;
  /** The policy number its page prints, if any, and every number its other copies print (PersonCover.copyNumbers): two
   * covers printing different numbers are never one policy here. */
  policyNumber?: string | null; copyNumbers?: string[] };
/** One policy's part of a lump-sum tile. `accelerates`: the cover pays its sum early out of a death benefit (its own words
 * say it accelerates), so it is paid instead of that death benefit, never on top of it (Evidence Reviewer, 27 Oct). */
/** The fixed sums of a tile's policies added up, when another policy's amount is not a fixed sum (`without` names it). */
export type KnownSum = { amount: number; currency: string; without: string[]; otherTile: string[] };
/** `otherTile`: a printed sum that pays only on what another tile covers ("Accidental Death Benefit" on Death): no amount
 * here, and never said to have no fixed sum (TE #213 F4). */
/** period: a figure paid per day, week, month or year ("a month" is shown after it); such parts are never added up.
 * noFigure: a periodic cover whose line prints no period, so its figure is not shown anywhere. */
export type TilePart = { name: string; amount: number | null; currency: string | null; accelerates?: boolean; conditional?: boolean; otherTile?: boolean; period?: string | null; noFigure?: boolean };
/** A survival or waiting period only decides when a sum is paid, not how much: an allow-list of its words, every word known. */
const TIMING_WORDS = new Set(["the", "a", "an", "life", "assured", "insured", "person", "survives", "survive", "surviving", "survival", "at", "least",
  "day", "days", "after", "from", "date", "of", "diagnosis", "or", "and", "surgical", "procedure", "performed", "for", "critical", "illness", "covered",
  "under", "this", "benefit", "waiting", "period", "periods", "month", "months", "in", "section", "clause", "as", "stated", "is", "subject", "to", "policy"]);
// A number is timing only as a count of days or months ("7 days", "(90) days") or as a clause number ("Section 3.2");
// any other number ("0.5 of the benefit") may be an amount (TE P149b).
const timingOnly = (c: string) => {
  if (!/\bsurviv|\bwaiting\s+period/i.test(c)) return false;
  const w = c.toLowerCase().split(/[\s,;:()]+/).map((t) => t.replace(/\.$/, "")).filter(Boolean);
  return w.every((t, i) => TIMING_WORDS.has(t) || (/^\d+(?:\.\d+)*$/.test(t)
    && (/^(?:days?|months?)$/.test(w[i + 1] ?? "") || /^(?:section|clause)$/.test(w[i - 1] ?? ""))));
};
/** The event a benefit is paid on, and nothing more ("If the Life Assured dies while the Policy is in force and We receive
 * satisfactory proof of claim"): an allow-list of its words, every word known. Anything else ("before the maturity date",
 * "has not been converted") is a condition. */
const TRIGGER_WORDS = new Set(["if", "the", "a", "life", "assured", "insured", "person", "dies", "die", "death", "of", "sustains", "suffers", "tpd",
  "total", "and", "permanent", "disability", "while", "this", "your", "policy", "supplementary", "agreement", "rider", "benefit", "cover", "is", "in",
  "force", "we", "receive", "satisfactory", "proof", "claim"]);
const triggerOnly = (c: string) => /^\s*if\b/i.test(c) && c.toLowerCase().split(/[\s,.;:()]+/).filter(Boolean).every((w) => TRIGGER_WORDS.has(w));
/** Only an affirmative "accelerat-" marks a cover: none of its own words says "non-", "not", "no", "never", "without" or
 * "-n't" before it in the same phrase ("Non-accelerated Critical Illness", "does not accelerate the death benefit": no
 * mark). Any negated mention anywhere in the cover's wording leaves the cover unmarked (TE P149-1). */
const ACCEL = /\baccelerat\w*/gi;
const NEGATED = /(?:\b(?:non|not|no|never|without)\b|n['’]t\b|\bnon-?)[^.;:,()]*$/i;
function acceleratesText(texts: (string | null | undefined)[]): boolean {
  let affirmative = false;
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(ACCEL)) {
      if (NEGATED.test(t.slice(0, m.index))) return false;
      affirmative = true;
    }
  }
  return affirmative;
}
/** A cover's name as a tile shows it: without a policy number printed into it ("GROUP TERM LIFE(POLICY NO.123)"). */
const partName = (n: string) => n.replace(/\s*\((?:group\s+)?policy\s+no\.?[^)]*\)/gi, "").trim() || n;
const PLAIN_SUM = (r: SummaryRow) => (r.figure.kind === "worked_out" || (r.figure.kind === "printed" && r.figure.unit === "lump_sum")) && !limits(r);
/** What each of a person's covers gives in a lump-sum category, and their total (DC 27 Oct: show what each person is
 * covered for). Each confirmed schedule line is one part. A table cover is that line's when it shares the line's document
 * (a row's, or the held cover's own page) AND its sum is the line's amount; a document that holds several covers gives the
 * line to the one whose sum equals it, so the order covers come in never matters (Critic R247 Q2). Every other paying
 * cover is a part of its own: the one plain lump sum its rows print in a stated currency, which must also be its sum
 * insured where it has one, or, when its rows print no amount at all, its sum insured with its stated currency; else no
 * amount. The total is given only when every part has an amount in one currency and nothing may be one policy counted
 * twice; otherwise null, and the parts still say what each policy gives. Equal amounts never join two covers (R246). */
export function lumpSumParts(rows: TileRow[], lines: (ConfirmedLine & { name: string })[], held: HeldCover[] = [], category?: string): { parts: TilePart[]; total: number | null; known: KnownSum | null } {
  const allCovers = [...coversOf(rows)].filter(([, list]) => !list.every((r) => r.pays === "not_covered")).map(([key, list]) => {
    const own = held.filter((h) => policyOf(h) === key);
    const sums = new Map<string, { amount: number; currency: string }>();
    for (const r of list) {
      const m = moneyOf(r); const currency = m?.currency ? normalizeCurrencyCode(m.currency, "") : "";
      if (PLAIN_SUM(r) && m && currency) sums.set(`${currency} ${m.amount}`, { amount: m.amount, currency });
    }
    const insured = new Set(own.map((h) => h.sumInsured).filter((n): n is number => n != null));
    const heldCurrency = new Set(own.map((h) => h.currency ? normalizeCurrencyCode(h.currency, "") : ""));
    // A lump sum equal to the cover's own sum insured IS that sum insured, whatever conditions decide when it is paid
    // (a survival or waiting period): the tile shows sums insured (live b1fa3d1).
    const asInsured = insured.size === 1 ? list.map((r) => ({ r, m: moneyOf(r) })).find(({ r, m }) => m && m.amount === [...insured][0]
      && (r.figure.kind === "worked_out" || (r.figure.kind === "printed" && r.figure.unit === "lump_sum")) && !!m.currency && !!normalizeCurrencyCode(m.currency, "")
      // The same currency as the cover states, where it states one: the same number in another currency is not its sum (TE P149-2).
      && [...heldCurrency].every((c) => !c || c === normalizeCurrencyCode(m.currency!, ""))) : undefined;
    // No row prints any amount ("See the page"): the cover's own sum insured, only where a row pays a share of the sum
    // insured and its document states the currency. A sum insured the benefit is not worked out from (a plan whose
    // schedule says its sum insured is notional and the death benefit is the higher of premiums or cash value) gives none.
    const ofSumInsured = list.some((r) => (r as { percentOf?: string | null }).percentOf === "sum_insured");
    // A cover any of whose rows has wording that may change what is paid ("half after sixty-five", "less amounts already
    // paid", "a return of premiums before 65") is marked wherever its amount shows, through its own rows or through the
    // schedule line matched to it: the sum insured, with conditions. Survival and waiting periods are timing, and the event
    // the benefit is paid on is its trigger; neither marks it (R249, R250).
    const conditional = list.some((r) => r.conditions.some((c) => isLimit(c) && !timingOnly(c) && !triggerOnly(c)));
    const one = sums.size === 1 ? [...sums.values()][0]
      : asInsured ? { amount: asInsured.m!.amount, currency: normalizeCurrencyCode(asInsured.m!.currency!, "") }
      : list.every((r) => !moneyOf(r)) && ofSumInsured && insured.size === 1 && heldCurrency.size === 1 && [...heldCurrency][0] ? { amount: [...insured][0], currency: [...heldCurrency][0] } : null;
    const fits = !!one && insured.size <= 1 && (!insured.size || insured.has(one.amount));
    // The sum a schedule line is compared with: the cover's own sum insured (a personal accident cover prints several
    // sums, for death and for each injury), else its one printed sum. The line carries the currency.
    const sum = insured.size === 1 ? [...insured][0] : fits ? one!.amount : null;
    const accelerates = category !== "Death" && acceleratesText([...list.flatMap((r) => [r.benefit, r.section, r.cover, ...r.conditions]), ...own.map((h) => h.name)]);
    const names = { product: nameKey(list[0].product), plan: nameKey(list[0].plan), cover: nameKey(list[0].cover) };
    return { key, coverKey: list[0].coverKey, docs: coverDocs(key, list, held), holding: list[0].holding, sum, accelerates, conditional, names,
      rider: (list[0].coverKey ?? "").split("|").length > 3, plainSums: [...sums.values()], insured, heldCurrency, heldDocs: new Set(own.map((h) => h.documentId).filter((d): d is string => !!d)), part: { name: partName(own[0]?.name || list[0].cover || list[0].product || "Policy"),
      amount: fits ? one!.amount : null, currency: fits ? one!.currency : null, ...(accelerates ? { accelerates } : {}), ...(fits && conditional ? { conditional } : {}) } as TilePart };
  });
  // One policy read under two names on two of its documents: its wording names the person's cover after the plan itself
  // ("Kestrel CritiCare II", sum insured 300,000) while its schedule names the plan's covers by their benefits
  // ("Comprehensive Critical Illness Benefit" 300,000, "Death Benefit" 5,000), so the table holds the plan twice (3 Nov:
  // one CI sum counted twice, and the Death tile lost its total). The plan-named cover is that schedule's plan only when
  // this is positively shown (twinDocument): the same product and plan, neither a rider, on another document, no two
  // different printed policy numbers, and its sum insured, in the same stated currency, is that of exactly one named cover
  // of the plan there. On a tile it is then counted once, as the schedule's own named cover there whose sum is every plain
  // sum it prints here (else its sum insured). Where the plan's named covers sit on another document but this is not
  // shown (no cover, or several, agree), which policy it is cannot be told, so the tile gives no total. Two named covers
  // (a basic plan and its rider, two benefits) are never joined by this.
  const absorbed = new Set<(typeof allCovers)[number]>();
  let twoNames = false;
  for (const w of allCovers) {
    const twin = twinDocument(w.coverKey, held);
    if (twin === undefined) continue;
    if (twin === null) { twoNames = true; continue; }
    const given = w.plainSums.length ? w.plainSums
      : [...w.insured].flatMap((amount) => [...w.heldCurrency].map((currency) => ({ amount, currency })));
    const agrees = allCovers.filter((c) => c !== w && !absorbed.has(c) && !c.rider && c.heldDocs.has(twin) && c.names.product === w.names.product
      && c.names.plan === w.names.plan && !!c.names.cover && c.names.cover !== c.names.product && c.names.cover !== c.names.plan && c.sum != null
      && given.length > 0 && given.every((g) => g.amount === c.sum && !!g.currency && [...c.heldCurrency, c.part.currency ?? ""].filter(Boolean).every((x) => x === g.currency)));
    if (agrees.length !== 1) { twoNames = true; continue; }
    absorbed.add(w);
    for (const d of w.docs) agrees[0].docs.add(d);
  }
  const covers = allCovers.filter((c) => !absorbed.has(c));
  // Where the person holds several policies of a cover type here (printed policy numbers differ), through a row or a
  // confirmed line's document, the tile gives no total: a different number does not prove a second policy (a renewal, a
  // scheme's group number beside a certificate number), and a policy whose own document gives the tile no row may or may
  // not hold the benefit (Critic R258 H1, H2, R259 M1). Such a policy is not listed: nothing shows it holds the benefit
  // (TE P152 N1).
  const split = new Set([...covers.filter((c) => c.holding).map((c) => c.coverKey),
    ...held.filter((h) => h.holding && !!h.documentId && lines.some((l) => l.documentIds.includes(h.documentId!))).map((h) => h.coverKey)]);
  // A different printed number does not prove a second policy: a renewal, a scheme's group number beside a certificate
  // number, or an endorsement can re-number one policy (Critic R258 H1). Such parts are listed, never added up.
  let unsure = split.size > 0 || twoNames;
  const taken = new Set<(typeof covers)[number]>();
  const lineCover = new Map<ConfirmedLine, (typeof covers)[number]>();
  // A schedule line that prints a held cover's notional sum, from that cover's own document, is that notional figure: no
  // amount anywhere on the tile, and it is the cover's part (a cover of that document with no sum of its own is taken).
  const notional = new Set(lines.filter((l) => l.amount != null && held.some((h) => h.notionalSum != null && Math.abs(h.notionalSum - l.amount!) < 0.005
    && !!h.documentId && l.documentIds.includes(h.documentId))));
  for (const l of lines) {
    const same = covers.filter((c) => !taken.has(c) && l.documentIds.some((d) => c.docs.has(d)));
    if (notional.has(l)) {
      const own = same.filter((c) => c.sum == null);
      if (own.length === 1) taken.add(own[0]); else if (same.length) unsure = true;
      continue;
    }
    const match = same.filter((c) => c.sum != null && c.sum === l.amount);
    if (match.length === 1) { taken.add(match[0]); lineCover.set(l, match[0]); }
    // The line's document holds covers here but not exactly one with its sum: which is the line's cannot be told (R247 Q2).
    else if (same.length) unsure = true;
    // A line with no cover here beside a cover only the table knows with the same sum may be one policy read twice (a
    // scheme's certificate and its summary under another name) or two policies: nothing tells them apart (TE P148-2).
    else if (covers.some((c) => !taken.has(c) && c.part.amount === l.amount && c.part.currency === l.currency)) unsure = true;
  }
  // A schedule line is stored under a category, but its own name decides where it pays: a line whose name places it in
  // another category ("Accidental Death" stored as Death, "AD&D") is named with no amount here (Critic R247 Q1b). So is a
  // line outside the accident tile whose name has an accident or injury word but places it nowhere ("Accident Benefit"
  // stored as Death): it may pay on an accident only. A name with no such word ("Group Term Life") keeps its category.
  const elsewhere = (l: { name: string }) => {
    if (!category) return false;
    if (ACCIDENT_ONLY_NAME(l.name)) return category !== "Personal Accident";
    const c = categoryOfBenefit(l.name);
    return c ? c !== category : category !== "Personal Accident" && ACCIDENT_WORD.test(l.name);
  };
  const parts: TilePart[] = [...lines.map((l) => notional.has(l) ? { name: l.name, amount: null, currency: null } : ({ name: l.name, amount: elsewhere(l) ? null : l.amount, currency: elsewhere(l) ? null : l.currency,
    ...(elsewhere(l) && l.amount != null ? { otherTile: true } : {}),
    ...(lineCover.get(l)?.accelerates ? { accelerates: true } : {}),
    ...(!elsewhere(l) && l.amount != null && lineCover.get(l)?.conditional ? { conditional: true } : {}) })),
    ...covers.filter((c) => !taken.has(c)).map((c) => c.part)];
  // One cover read under two names ("Group Term Life" and "GTL") with the same sum is not added twice (R247 Q3).
  const words = (n: string) => productWords(n.replace(/\([^)]*\)/g, " ")).join(" ");
  if (parts.some((a, i) => parts.some((b, j) => j > i && a.amount != null && a.amount === b.amount && a.currency === b.currency
    && !!words(a.name) && words(a.name) === words(b.name)))) unsure = true;
  const currencies = new Set(parts.map((p) => p.currency));
  // Added up only within one currency that is stated: two sums whose documents do not say their currency may be in two.
  const total = !unsure && parts.length && parts.every((p) => p.amount != null) && currencies.size === 1 && (parts.length === 1 || !currencies.has(null))
    ? parts.reduce((t, p) => t + p.amount!, 0) : null;
  // The policies with a fixed sum, added up, where another policy's amount is not a fixed sum (a death benefit of "the
  // higher of 105% of premiums paid or the cash value"): shown as those policies' sum with the other policy named, never
  // as the whole. Only when nothing may be counted twice, the fixed sums share one currency, and no sum on the tile
  // leaves its currency unstated (it may be in another currency, so it is neither added nor left out unnamed).
  const fixed = parts.filter((p) => p.amount != null && p.currency);
  const known = total == null && !unsure && fixed.length && fixed.length < parts.length && new Set(fixed.map((p) => p.currency)).size === 1
    && parts.every((p) => p.amount == null || p.currency)
    ? { amount: fixed.reduce((t, p) => t + p.amount!, 0), currency: fixed[0].currency!, without: parts.filter((p) => p.amount == null && !p.otherTile).map((p) => p.name),
      otherTile: parts.filter((p) => p.otherTile).map((p) => p.name) } : null;
  return { parts, total, known };
}

const nameKey = (n: string | null | undefined) => (n ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const keyParts = (coverKey: string | undefined) => (coverKey ?? "").split("|");
/** Whether a cover is named after its own plan (its cover name is the product's or the plan's), and not a rider. */
const planNamed = (coverKey: string | undefined) => { const [product, cover, plan, rider] = keyParts(coverKey); return !!product && !rider && (cover === product || cover === plan); };
/** For a held cover named after its own plan: the other document whose one named cover of that plan has its sum insured,
 * in the same stated currency, with no different printed policy number (that document holds the same plan under its
 * benefits' names). null: the plan's named covers sit on another document, but none or several agree. undefined: not
 * such a cover, or no named cover of its plan on another document. */
function twinDocument(coverKey: string | undefined, held: HeldCover[]): string | null | undefined {
  if (!planNamed(coverKey)) return undefined;
  const own = held.filter((h) => h.coverKey === coverKey && !!h.documentId);
  if (!own.length) return undefined;
  const [product, , plan] = keyParts(coverKey), docs = new Set(own.map((h) => h.documentId!));
  const named = held.filter((h) => { const [p, c, pl, rider] = keyParts(h.coverKey); return !rider && p === product && pl === plan && c !== p && c !== pl && !!h.documentId && !docs.has(h.documentId); });
  if (!named.length) return undefined;
  const sums = new Set(own.map((h) => h.sumInsured)), currencies = new Set(own.map((h) => h.currency ? normalizeCurrencyCode(h.currency, "") : ""));
  const printed = (h: HeldCover) => [h.policyNumber, ...(h.copyNumbers ?? [])].map((n) => n ? numberKey(n) : "").filter(Boolean);
  const numbers = new Set(own.flatMap(printed));
  if (sums.size !== 1 || [...sums][0] == null || currencies.size !== 1 || ![...currencies][0]) return null;
  const agree = named.filter((h) => h.sumInsured === [...sums][0] && !!h.currency && normalizeCurrencyCode(h.currency, "") === [...currencies][0]
    && (!numbers.size || printed(h).every((n) => numbers.has(n))) && (!printed(h).length || [...numbers].every((n) => printed(h).includes(n))));
  const agreeDocs = new Set(agree.map((h) => h.documentId!));
  return agree.length === 1 && agreeDocs.size === 1 ? [...agreeDocs][0] : null;
}
/** A printed policy number by its letters and digits alone, without leading zeros. */
const numberKey = (n: string) => n.toUpperCase().replace(/[^A-Z0-9]+/g, "").replace(/^0+(?=.)/, "");

const GENERIC = new Set(["insurance", "plan", "policy", "cover", "coverage", "scheme", "benefit", "benefits", "the", "of", "and"]);
function productWords(name: string | null | undefined): string[] {
  const v = (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/\bgtl\b/g, "group term life").replace(/\bgpa\b/g, "group personal accident").replace(/\bghs\b/g, "group hospital surgical");
  return v.split(" ").filter((w) => w && !GENERIC.has(w));
}

/** Whether a reference wording (a scheme's policy wording, a product summary) describes a product the person owns. The
 * owner's own product name, group number and insurer must agree with the wording's, where both print them; with
 * neither a product name nor a group number on both sides, nothing matches, so a wording never adds cover on its own. */
export function wordingDescribes(owned: { productName: string | null; groupPolicyNumber: string | null; insurer: string | null },
  wording: { productName: string | null; groupPolicyNumber: string | null; insurer: string | null }): boolean {
  const norm = (s: string | null) => (s ?? "").replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
  const a1 = canonicalInsurer(owned.insurer), b1 = canonicalInsurer(wording.insurer);
  if (a1 && b1 && a1 !== b1) return false;
  const bothGroup = Boolean(norm(owned.groupPolicyNumber) && norm(wording.groupPolicyNumber));
  if (bothGroup && norm(owned.groupPolicyNumber) !== norm(wording.groupPolicyNumber)) return false;
  const a = productWords(owned.productName), b = productWords(wording.productName);
  // Word for word, apart from words like "plan" and "insurance": "Critical Care" and "Critical Care Plus" are two products.
  if (a.length && b.length) return a.join(" ") === b.join(" ");
  return bothGroup;
}
