/**
 * Round 9: questions households ask in their own words that are neither a
 * claim nor a lookup of one figure, answered in code from what the documents
 * print -- never from a model, never with a figure the documents do not show.
 *
 *   householdWords()   Malay, Tamil, Hokkien and Chinese words, numbers written
 *                      as words and spoken digits, put into the plain English
 *                      the rest of the chat reads ("kereta saya kena langgar,
 *                      excess berapa" -> "my car was hit, excess how much").
 *   explainedTerm()    "what does co-insurance mean", "pro-ration factor?",
 *                      "excess and deductible same thing is it": a plain
 *                      meaning, then the person's own figure from the documents.
 *   judgementAsked()   "is this a good policy", "is mine better than AIA's":
 *                      no verdict (that is advice), but what the plan pays.
 *   adminKind()        paying late, cancelling, the agent's number, leaving
 *                      the company: what the documents print, or plainly that
 *                      they do not say and who can.
 *   insurersNamed()    an insurer the household has no policy with.
 *   damageEvent()      damage to a car or a home (reported or "what if"),
 *                      answered from the car or home policy, not a hospital plan.
 *   hypotheticalFollowUp()  "what documents would I need if it happens?" after
 *                      a what-if or a planned operation: a direct answer.
 */
import { NON_COVER_ROLES } from "@/lib/documents/messy";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { query } from "@/lib/db/client";
import type { ChatCitation } from "@/types";
import { citeLine } from "./answer-verification";

// ------------------------------------------------------------------ household words
const UNITS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUMBER_WORD = "(?:" + [...Object.keys(UNITS), ...Object.keys(TENS), "hundred", "thousand", "and"].join("|") + ")";
/** "twelve thousand" -> 12000, "two thousand three hundred" -> 2300; null when it is not a number. */
function wordsToNumber(words: string[]): number | null {
  let total = 0, current = 0, seen = false;
  for (const w of words) {
    if (w === "and") continue;
    if (w in UNITS) { current += UNITS[w]; seen = true; }
    else if (w in TENS) { current += TENS[w]; seen = true; }
    else if (w === "hundred") { current = (current || 1) * 100; seen = true; }
    else if (w === "thousand") { total += (current || 1) * 1000; current = 0; seen = true; }
    else return null;
  }
  return seen ? total + current : null;
}
const REPLACEMENTS: [RegExp, string][] = [
  // Chinese
  [/我的/g, " my "], [/我/g, " I "], [/妈妈|媽媽/g, " mother "], [/爸爸/g, " father "], [/儿子|兒子/g, " son "], [/女儿|女兒/g, " daughter "], [/医院|醫院/g, " hospital "], [/多少/g, " how much "], [/保险|保險/g, " insurance "],
  // Tamil (romanised)
  [/\b(?:admit|admitted)\s+(?:aachu|aayiduchu|ayiduchu|panniyachu)\b/gi, "was admitted to hospital"], [/\bamma\b/gi, "mother"], [/\bappa\b/gi, "father"], [/\bpaati\b/gi, "grandmother"], [/\bthatha\b/gi, "grandfather"], [/\b(?:aachu|aayiduchu)\b/gi, ""],
  // Hokkien / Singlish kin words
  [/\bah\s?(?:ma|mah|mah mah)\b/gi, "grandma"], [/\bah\s?gong\b/gi, "grandpa"],
  // Malay
  [/\bmasuk hospital\b/gi, "was admitted to hospital"], [/\bkena langgar\b/gi, "was hit"], [/\blanggar\b/gi, "hit"], [/\bkemalangan\b/gi, "accident"],
  [/\bboleh claim (?:tak|ke|tidak)\b/gi, "can claim or not"], [/\bboleh\b/gi, "can"], [/\bberapa\b/gi, "how much"], [/\bsemalam\b/gi, "yesterday"], [/\bhari ini\b/gi, "today"],
  [/\b(kereta|rumah|anak|polisi|insurans)\s+saya\b/gi, "my $1"], [/\bsaya\b/gi, "I"], [/\bkereta\b/gi, "car"], [/\brumah\b/gi, "house"], [/\bpolisi\b/gi, "policy"], [/\binsurans\b/gi, "insurance"],
  [/\banak\b(?!\s+(?:lelaki|perempuan))/gi, "child"], [/\bjatuh\b/gi, "fell"], [/\bbasikal\b/gi, "bicycle"], [/\bpatah\b/gi, "broke"], [/\btangan\b/gi, "arm"], [/\bkaki\b/gi, "leg"],
  [/\bsakit\b/gi, "sick"], [/\bdemam\b/gi, "fever"], [/\bdoktor\b/gi, "doctor"], [/\bbayar\b/gi, "pay"], [/\bbanjir\b/gi, "flood"], [/\bbocor\b/gi, "leak"], [/\b(?:tak|tidak)\b/gi, "not"],
  // Terms written apart ("co insurance", "pre existing")
  [/\bco\s+(insurance|payments?|pay)\b/gi, "co-$1"], [/\bpre\s+(existing|authori[sz]ation)\b/gi, "pre-$1"], [/\bpro\s+ration\b/gi, "pro-ration"],
  // Shortened month names and ordinal days ("3rd sept")
  [/\b(\d{1,2})(?:st|nd|rd|th)\s+(?=(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/gi, "$1 "], [/\bsept\b\.?/gi, "September"],
];
/** The household's words in the plain English the chat reads. Unchanged text is returned as is. */
const MALAY_ONLY = /\b(?:apa|saya|anda|insurans|perlindungan|boleh(?:kah)?|tuntutan|berapa|polisi|bagaimana|adakah|untuk|dengan|tidak|mahu|ingin|kami|kita|emak)\b/gi;
const ENGLISH_CUE = /\b(?:what|is|are|my|the|claim|cover\w*|policy|insurance|hospital|premium|how|much|does|do|can|have|has|for|and|who|when|which|i|we|you|pay|plan|get|got|or|not|of|in|on|excess|deductible|car|accident)\b/g;
export function householdWords(text: string): string {
  // A message wholly in Malay is left as written, so the chat can say it answers in English.
  if ((text.match(MALAY_ONLY) ?? []).length >= 2 && !(text.match(ENGLISH_CUE) ?? []).length) return text;
  let t = text;
  for (const [re, to] of REPLACEMENTS) t = t.replace(re, to);
  // "twenty twenty seven" -> 2027
  t = t.replace(/\btwenty (twenty|thirty)[\s-]+(one|two|three|four|five|six|seven|eight|nine)\b/gi, (_m, d: string, u: string) => String(2000 + (d.toLowerCase() === "twenty" ? 20 : 30) + UNITS[u.toLowerCase()]));
  // Spoken digits: "ending four four seven one" -> "ending 4471"
  t = t.replace(/\b(?:(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)[\s-]+){2,}(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/gi, (m) => m.toLowerCase().split(/[\s-]+/).map((w) => w === "oh" ? "0" : String(UNITS[w])).join(""));
  // Numbers as words before a unit, or with "hundred"/"thousand" in them.
  t = t.replace(new RegExp("\\b(" + NUMBER_WORD + "(?:[\\s-]+" + NUMBER_WORD + ")*)\\b(?=\\s+(?:dollars?|bucks|nights?|days?|weeks?|months?|years?|times?|percent|%|k\\b)|)", "gi"), (m: string, _g: string, offset: number, all: string) => {
    const words = m.toLowerCase().split(/[\s-]+/).filter(Boolean);
    if (words[0] === "and" || words.at(-1) === "and") return m;
    const after = all.slice(offset + m.length);
    // Nights, days and weeks stay as written: the claim interview reads "twelve nights" itself.
    const unit = /^\s+(?:dollars?|bucks|percent|%|k\b)/i.test(after);
    const big = words.some((w) => w === "hundred" || w === "thousand");
    if (!unit && !big) return m;
    // "no one", "any one", "one of": not a count.
    if (words.length === 1 && /\b(?:no|any|some|every|which|this|that|the)\s*$/i.test(all.slice(0, offset))) return m;
    const n = wordsToNumber(words);
    return n === null ? m : String(n);
  });
  t = t.replace(/\b(\d+(?:\.\d+)?)\s*k\b(?!\s*m)/gi, (_m, n: string) => String(Math.round(Number(n) * 1000)));
  t = t.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.?!])/g, "$1").trim();
  return t === text.trim() ? text : t;
}

// ------------------------------------------------------------------ policy numbers
/** A policy number the message gives ("PAG-2026-4471", "pag 2026 4471", "ending 4471"). */
export function policyNumberAsked(text: string): { token: string; ending: boolean } | null {
  const ending = text.match(/\b(?:ending|ends? (?:with|in)|last (?:4|four) (?:digits?|numbers?)(?: (?:is|are))?)\s*(\d{3,6})\b/i);
  if (ending) return { token: ending[1], ending: true };
  if (/\bclaim\s*(?:no\.?|number|ref\w*)\b/i.test(text) && !/\bpolicy\s*(?:no\.?|number)\b/i.test(text)) return null;
  const digits = (x: string) => (x.match(/\d/g) ?? []).length;
  // "PAG-2026-4471", "AXA-99887766", "MMA-ISP-7730152"
  const hyphen = text.match(/\b[A-Za-z]{2,5}(?:-[A-Za-z0-9]{2,}){1,4}\b/g)?.find((x) => digits(x) >= 4 && /^[A-Za-z]{2,5}-/.test(x) && !/^(?:covid|co-)/i.test(x));
  if (hyphen) return { token: hyphen, ending: false };
  // "AXA 99887766", "PAG20264471" (capitals as printed)
  const capital = text.match(/\b[A-Z]{2,5} ?\d{5,}(?: \d{2,})*\b/)?.[0];
  if (capital) return { token: capital, ending: false };
  // "pag 2026 4471 still active?": a policy number typed as it is read out, at the start of the message.
  const spoken = text.match(/^\s*([a-z]{2,5}(?: \d{3,}){2,})\b/i)?.[1];
  if (spoken && !/^(?:is|my|the|was|bill|paid|got|have|has|and|on|in|at|for)\b/i.test(spoken)) return { token: spoken, ending: false };
  // "policy number 7730152"
  const after = text.match(/\bpolicy\s*(?:no\.?|number|#)\s*(?:is\s*)?:?\s*([A-Za-z0-9-]{4,20})\b/i)?.[1];
  if (after && digits(after) >= 4) return { token: after, ending: false };
  return null;
}
const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export function matchPolicyNumber<T extends { policy_number: string | null }>(asked: { token: string; ending: boolean }, policies: T[]): T[] {
  const want = alnum(asked.token);
  return policies.filter((p) => p.policy_number && (asked.ending ? alnum(p.policy_number).endsWith(want) : alnum(p.policy_number) === want));
}

// ------------------------------------------------------------------ terms
type Term = { key: string; re: RegExp; meaning: string; ask?: string };
const TERMS: Term[] = [
  { key: "excess-vs-deductible", re: /\b(?:excess and (?:the )?deductible|deductible and (?:the )?excess)\b/i, meaning: "They are close but not the same. A deductible is the amount you pay yourself first in a policy year before a hospital plan starts paying. An excess is the first part of each claim that you pay yourself, and is usual on car, home and travel policies.", ask: "what is the deductible and the excess?" },
  { key: "co-insurance", re: /\bco-?\s?insur[ae]nce\b|\bco-?ins\b/i, meaning: "Co-insurance is the share of the bill you still pay yourself after the deductible; the plan pays the rest.", ask: "what is the co-insurance?" },
  { key: "co-payment", re: /\bco-?pay(?:ment)?s?\b/i, meaning: "A co-payment is the part of the bill you pay yourself; some riders cap it or pay most of it for you.", ask: "what is the co-payment?" },
  { key: "deductible", re: /\bdeduct[ai]bles?\b/i, meaning: "A deductible is the amount you pay yourself first in each policy year before the plan starts paying for a hospital bill.", ask: "what is the deductible?" },
  { key: "excess", re: /\bexcess\b/i, meaning: "An excess is the first part of each claim that you pay yourself; the policy pays the rest of what it covers.", ask: "what is the excess?" },
  { key: "pro-ration", re: /\bpro-?\s?rat(?:ion|ed|a)\b/i, meaning: "Pro-ration means the plan pays only part of the bill when you stay in a higher ward or a more expensive hospital than the plan is for: the bill is scaled down by the pro-ration factor before the deductible and co-insurance apply.", ask: "what is the pro-ration?" },
  { key: "waiting period", re: /\bwaiting period\b/i, meaning: "A waiting period is the time after a policy starts during which some conditions cannot be claimed yet.", ask: "what is the waiting period?" },
  { key: "pre-existing", re: /\bpre-?\s?existing\b/i, meaning: "A pre-existing condition is an illness or injury you already had, or had signs of, before the policy started. Policies often leave it out or limit it — the policy wording decides." },
  { key: "grace period", re: /\bgrace period\b/i, meaning: "A grace period is the time after a premium is due during which the policy stays in force while you pay. If the premium is still unpaid when it ends, the policy can lapse.", ask: "what is the grace period?" },
  { key: "surrender value", re: /\bsurrender value\b|\bsurrender\b/i, meaning: "The surrender value is the money you get back if you end a savings, endowment or investment-linked policy before it matures. In the early years it is often less than the premiums paid.", ask: "what is the surrender value?" },
  { key: "annual limit", re: /\b(?:annual|policy[- ]year|yearly) limit\b/i, meaning: "The annual (policy-year) limit is the most the plan pays in total within one policy year.", ask: "what is the annual limit?" },
  { key: "rider", re: /\briders?\b/i, meaning: "A rider is an add-on to a main policy that gives extra cover for an extra premium — on a hospital plan, usually help with the deductible and co-insurance.", ask: "what does the rider cover?" },
  { key: "panel", re: /\bpanel\b/i, meaning: "A panel is the insurer's list of approved doctors, clinics or hospitals; using one can mean lower costs or the bill being settled directly." },
  { key: "pre-authorisation", re: /\bpre-?\s?auth\w*|\bletter of guarantee\b/i, meaning: "Pre-authorisation is when the hospital asks the insurer to approve a planned treatment before it happens; the insurer may then issue a Letter of Guarantee so the bill is settled directly." },
  { key: "sum assured", re: /\bsum (?:assured|insured)\b/i, meaning: "The sum assured (or sum insured) is the amount a policy pays as a lump sum for the event it covers, such as death or a critical illness.", ask: "what is the sum assured?" },
  { key: "deferment", re: /\bdeferment(?: period)?\b/i, meaning: "A deferment period is the time you must wait after becoming eligible — for example, after becoming severely disabled — before payouts begin.", ask: "what is the deferment period on the long-term care plan?" },
  { key: "no-claim discount", re: /\bno[- ]claims? discount\b|\bncd\b/i, meaning: "A no-claim discount (NCD) lowers your car premium for each year without a claim; making a claim can reduce it.", ask: "what is the no-claim discount on my car insurance?" },
  { key: "as charged", re: /\bas charged\b/i, meaning: "“As charged” means the plan pays the actual eligible bill, after the deductible and co-insurance, rather than a fixed amount." },
  { key: "eldershield", re: /\beldershield\b|\bcareshield\b/i, meaning: "ElderShield (and the newer CareShield Life) is long-term care insurance: it pays a monthly amount if you become severely disabled and cannot do some of the basic activities of daily living, such as washing, dressing or walking, on your own.", ask: "what does the eldershield pay?" },
  { key: "integrated shield", re: /\bintegrated shield\b|\bmedishield(?: life)?\b/i, meaning: "MediShield Life is the basic national hospital insurance. An Integrated Shield plan is a private plan on top of it that covers higher ward classes or private hospitals.", ask: "what does my hospital plan cover?" },
  { key: "lapse", re: /\blaps(?:e|ed|ing)\b/i, meaning: "A policy lapses when a premium stays unpaid after the grace period; from then on it no longer covers anything that happens." },
  { key: "free-look", re: /\bfree[- ]look\b|\bcooling[- ]off\b/i, meaning: "The free-look period is a short time after you buy a policy when you can cancel it and get the premium back, less some costs; the policy says how long it is." },
  { key: "exclusion", re: /\bexclusions?\b/i, meaning: "An exclusion is something the policy says it does not pay for." },
  { key: "premium", re: /\bpremiums?\b/i, meaning: "The premium is what you pay the insurer to keep the policy in force.", ask: "how much is the premium?" },
];
/** "What does X mean?": the term asked to be explained, or null when the message asks for a figure instead. */
export function explainedTerm(text: string): Term | null {
  const t = text.replace(/\s+/g, " ").trim();
  const explain = /\b(?:mean|means|meaning|explain|stand for|in simple (?:words|terms|english)|same thing|the same\b|difference between|what(?:['’]s| is) (?:a|an)\b|what(?:['’]s| is| are) (?:this|that|these)\b|dont understand|don['’]t understand|not sure what)\b/i.test(t);
  const term = TERMS.find((x) => x.re.test(t));
  if (!term) return null;
  if (explain) return term;
  // "what is co-insurance?", "pro-ration factor?": only the term, nobody's figure asked for.
  const bare = t.replace(/[?!.\s]+$/, "").replace(/^(?:ok(?:ay)?|so|and|hmm+|then)[,\s]+/i, "").replace(/^(?:what(?:['’]s| is| are)|whats)\s+/i, "");
  if (/^(?:a |an )?[\p{L}\- ]{2,30}$/u.test(bare) && term.re.test(bare) && !/\b(?:my|our|his|her|their|the|your|mine|how|much|when|which|who)\b/i.test(bare) && /^(?:what(?:['’]s| is| are)|whats)\b/i.test(t.replace(/^(?:ok(?:ay)?|so|and|then)[,\s]+/i, "")))
    return term;
  return null;
}

// ------------------------------------------------------------------ judgement and other insurers
export function judgementAsked(text: string): boolean {
  return /\bworth (?:to |it to )?(?:surrender|cancel|keep|buy|stop)\w*\b|\bgood enough\b|\b(?:is|are|am)\b[^?.]{0,50}\benough\b(?! to (?:claim|cover the))|\b(?:is|are|was) (?:this|that|it|my|our|the|mine|hers|his)\b[^?.]{0,50}\b(?:good|bad|worth it|enough|value for money|any good|reasonable|a good (?:deal|plan|policy|buy))\b|\bgood (?:deal|policy|plan|buy)\b(?! for (?:what|which))|\b(?:better|worse) than\b|\bis (?:hers|his|theirs|mine) better\b|\bwhich (?:one |plan |policy )?is (?:better|best)\b/i.test(text);
}
const INSURERS: [string, RegExp][] = [
  ["AIA", /\baia\b/i], ["Prudential", /\bprudential\b|\bpru\b/i], ["Great Eastern", /\bgreat eastern\b/i], ["Income Insurance", /\bntuc(?: income)?\b|\bincome insurance\b/i],
  ["AXA", /\baxa\b/i], ["HSBC Life", /\bhsbc\b/i], ["Manulife", /\bmanulife\b/i], ["Singlife", /\bsinglife\b|\baviva\b/i], ["FWD", /\bfwd\b/i], ["Tokio Marine", /\btokio marine\b/i],
  ["Raffles Health Insurance", /\braffles (?:health|shield)\b/i], ["Etiqa", /\betiqa\b/i], ["China Life", /\bchina life\b/i], ["MSIG", /\bmsig\b/i], ["Allianz", /\ballianz\b/i], ["Sompo", /\bsompo\b/i],
  ["Liberty", /\bliberty insurance\b/i], ["Chubb", /\bchubb\b/i], ["Zurich", /\bzurich\b/i], ["DirectAsia", /\bdirect ?asia\b/i], ["Allied World", /\ballied world\b/i],
];
/** Insurers the message names that none of the household's policies is with. */
export function insurersNotOnFile(text: string, onFile: string[]): string[] {
  const held = onFile.join(" | ");
  return INSURERS.filter(([name, re]) => re.test(text) && !re.test(held) && !held.toLowerCase().includes(name.toLowerCase())).map(([name]) => name);
}

/** Round 11: a product the question names by its brand-style name ("MediGuard", "ShieldCare Premier",
 * "TermSecure 20") that is on none of the household's documents. Scheme and app names are not products. */
const NOT_A_PRODUCT = /^(?:medisave|medishield|careshield|eldershield|dearpolicy|fidrec|giro|paynow|whatsapp|iphone|ipad|youtube|linkedin|singpass|mymoh|healthhub|grabpay|paylah)$/i;
export function productsNotOnFile(text: string, onFile: string[]): string[] {
  const held = onFile.join(" | ").toLowerCase();
  const out: string[] = [];
  for (const m of text.matchAll(/\b([A-Z][a-z]+[A-Z][A-Za-z]+)((?:\s+(?:\d{1,3}|[A-Z][a-z]+))*)/g)) {
    const brand = m[1];
    if (NOT_A_PRODUCT.test(brand) || held.includes(brand.toLowerCase())) continue;
    const tail = (m[2] ?? "").split(/\s+/).filter(Boolean).filter((w, i, all) => /^\d/.test(w) || all.slice(0, i + 1).every((x) => /^(?:\d+|[A-Z][a-z]+)$/.test(x) && !/^(?:Rider|Plan|Policy|Insurance|Shield)$/.test(x)));
    out.push([brand, ...tail].join(" "));
  }
  return [...new Set(out)];
}

// ------------------------------------------------------------------ admin questions
export type AdminKind = "late" | "cancel" | "contact" | "leave";
export function adminKind(text: string): AdminKind | null {
  const t = text.replace(/\s+/g, " ");
  if (/\bwhen (?:must|should|do|can) (?:i|we|she|he) pay(?: it)?(?: by)?\b|\bif (?:i|we|she|he) (?:only )?pay\b[^?]{0,40}\b(?:next|later|on \d+|by|after|late)\b|\bpay by when\b|\b(?:last day|deadline) to pay\b|\b(?:late (?:in )?paying|pay(?:ing)? (?:it )?late|paid late|miss(?:ed|ing)? (?:a |the |my )?(?:premium|payment)|forg[eo]t to pay|can['’]?t pay (?:the |my )?premium|don['’]?t pay (?:the |my )?premium|stop paying|overdue|what if i miss it|if i miss (?:it|the (?:payment|deadline))|not paid (?:the |my )?premium)\b/i.test(t)) return "late";
  if (/\b(?:cancel\w*|terminat\w*|stop (?:the|my) (?:policy|plan|insurance)|end (?:the|my) (?:policy|plan)|get (?:a |my )?refund|free[- ]look)\b/i.test(t) && !/\b(?:trip|flight|holiday|tour|booking)\b/i.test(t)) return "cancel";
  if (/\bwho(?:m)? (?:to|do i|should i) call\b|\b(?:my agent|the agent|agent['’]?s|adviser['’]?s|financial adviser|hotline|phone number|contact (?:number|details)|call (?:who|which number)|email address|whatsapp|customer service|who (?:do|should) i call|number to call)\b/i.test(t)) return "contact";
  if (/\b(?:leave|leaving|left|quit|resign\w*|change(?:d)? (?:my )?jobs?|retrench\w*|retire\w*)\b[^?]{0,30}\b(?:company|job|work|employer|firm)\b|\bwhen i (?:leave|resign|quit)\b|\b(?:leave|leaving|quit|resign\w*|retrench\w*)\b[^?]*\b(?:group|company|work|office) (?:insurance|cover|plan|benefits?)\b/i.test(t)) return "leave";
  return null;
}

// ------------------------------------------------------------------ damage to a car or a home
export function damageEvent(text: string): "motor" | "property" | null {
  const t = text.replace(/\s+/g, " ");
  // "Is a burst pipe covered?", "how much third-party damage does my car policy cover?": a question about cover, not damage.
  const reported = /\bmy (?:house|home|flat|kitchen|room|place)\b[^?]{0,20}\b(?:flood\w*|fire|leak\w*|burgl\w*|broken into)\b|\b(?:got|was|were|kena|been|is|has been)\s+(?:hit|damaged|scratched|dented|rear-?ended|knocked|bang\w*|stolen|flooded|burgled|broken into)\b|\b(?:someone|somebody|a (?:car|lorry|bus|taxi|van|motorcycle|truck))\s+(?:hit|knocked|banged|rear-?ended|crashed into|scratched)\b|\brear-?ended\b|\b(?:leaked|leaking|flooded|burst|caught fire|cracked)\b|\b(?:slow |small |water )?leaks?\b[^?]{0,40}\bdamaged\b|\bdamaged (?:the|my|our) (?:floor|ceiling|wall|kitchen|cabinet|furniture|parquet|tiles)\b|\baccident\b[^?]{0,30}\b(?:yesterday|today|this morning|last \w+|at the|on the)\b|^(?:and|what about|how about)\s+(?:the\s+)?(?:car|house|home)\s+damage\b/i.test(t);
  const claimIf = /\bclaim\b/i.test(t) && /\b(?:if|when|in case)\b/i.test(t);
  if (/^\s*(?:is|are|does|do|will|would|can|how much|what)\b[^?]*\bcover(?:ed|s)?\b/i.test(t) && !/\b(?:got|was|were|kena|been)\s+(?:hit|damaged|scratched|dented|flooded|burgled|broken into)\b/i.test(t)) return null;
  if (!reported && !claimIf) return null;
  if (/\bcover(?:ed|s)?\b/i.test(t) && !/\bclaim\b/i.test(t) && !reported) return null;
  if (/\b(?:hurt|injur\w*|hospital\w*|warded|broke (?:his|her|my) |fractur\w*|bruis\w*|died|passed away)\b/i.test(t)) return null;
  if (/\b(?:car|vehicle|motor|bumper|windscreen)\b/i.test(t) && /\b(?:damag\w*|hit|knock(?:ed)?|scratch\w*|dent\w*|rear-?ended|crash\w*|collid\w*|accident|langgar|bang\w*|stolen)\b/i.test(t)) return "motor";
  if (/\brear-?ended\b|\b(?:someone|a (?:car|lorry|bus|taxi)) (?:hit|knocked|banged into) (?:me|my)\b/i.test(t)) return "motor";
  if (/\b(?:house|home|flat|kitchen|cabinets?|ceiling|floor|furniture|contents|renovation|pipe|upstairs)\b/i.test(t) && /\b(?:damag\w*|leak\w*|flood\w*|burst|fire|burglar\w*|break-?in|broken into|stolen|water)\b/i.test(t)) return "property";
  return null;
}

// ------------------------------------------------------------------ the documents' own lines
export type DocLine = { line: string; citation: ChatCitation; product: string; insurer: string | null; policyType: string | null };
export type PersonPage = { policyId: string; product: string; insurer: string | null; policyType: string | null; page: number; text: string };
export async function pagesFor(accountId: string, personIds: string[]): Promise<PersonPage[]> {
  if (!personIds.length) return [];
  try {
    return (await query<{ policy_id: string; product_name: string | null; insurer: string | null; policy_type: string | null; page_number: number; text: string }>(
      `SELECT pp.policy_id::text,p.product_name,p.insurer,p.policy_type,pp.page_number,pp.text FROM policy_pages pp JOIN policies p ON p.id=pp.policy_id AND p.account_id=pp.account_id
        WHERE pp.account_id=$1 AND ${activePredicate("p")} AND p.processing_status='ready' AND p.superseded_at IS NULL AND NOT (coalesce(p.document_role,'')=ANY($3::text[]))
          AND (p.family_member_id::text=ANY($2::text[]) OR EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.family_member_id::text=ANY($2::text[])))
        ORDER BY p.product_name,pp.page_number`, [accountId, personIds, [...NON_COVER_ROLES]])).rows
      .map((r) => ({ policyId: r.policy_id, product: r.product_name ?? "Your policy", insurer: r.insurer, policyType: r.policy_type, page: r.page_number, text: r.text }));
  } catch { return []; }
}
/** Whole sentences or lines from the person's documents that match, quoted with their page. */
export function documentLines(pages: PersonPage[], re: RegExp, limit = 4): DocLine[] {
  const out: DocLine[] = [];
  for (const p of pages) {
    const pieces = p.text.split(/\n+/).flatMap((line) => line.split(/(?<=[.;])\s+(?=[A-Z])/)).map((x) => x.replace(/\s+/g, " ").trim())
      .filter((x) => x.length >= 12 && x.length <= 260 && !/fictitious|synthetic test document|DPTEST|^Page \d+/i.test(x));
    for (const piece of pieces) {
      if (!re.test(piece) || out.some((o) => o.line.includes(piece))) continue;
      out.push({ line: p.product + " — “" + piece.replace(/[.;\s]+$/, "") + "” (page " + p.page + ").", product: p.product, insurer: p.insurer, policyType: p.policyType,
        citation: { chunkId: "page:" + p.policyId + ":" + p.page, policyId: p.policyId, policyName: p.product, pageStart: p.page, pageEnd: p.page } });
      // Gate R17: the quoted line's figures are read from its own page (resolved on that page at save time).
      citeLine(null, out[out.length - 1].line, { policyId: p.policyId, pageStart: p.page });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
export function cleanInsurer(name: string | null) { return name ? name.replace(/\s*\((?:fictitious|synthetic)[^)]*\)\s*/gi, " ").trim() : null; }

/** What to keep if it happens, by kind of event (what the insurer's claim form asks for in general; never a figure). */
export function documentsIfItHappens(kind: string): string[] {
  if (/hospital|surgery|operation|procedure|dengue|admi/i.test(kind)) return ["the final hospital bill (itemised)", "the discharge summary", "the doctor's memo or report", "the insurer's claim form", "the Letter of Guarantee, if the hospital got one"];
  if (/accident|injur|fractur|broke|break/i.test(kind)) return ["the doctor's report or memo describing the injury", "X-ray or scan reports, if any", "the clinic or hospital bills and receipts", "a note of how and when it happened (and a police report, if one was made)", "the insurer's claim form"];
  if (/critical|cancer|diagnos|heart|stroke/i.test(kind)) return ["the specialist's report confirming the diagnosis", "test results such as a biopsy or scan report", "the insurer's claim form"];
  if (/travel|trip|flight|delay|baggage/i.test(kind)) return ["the airline's written confirmation of the delay or loss", "boarding passes and booking confirmation", "receipts for extra costs", "a police report for anything stolen", "the insurer's claim form"];
  if (/car|motor|vehicle/i.test(kind)) return ["photos of the damage and the scene", "the other driver's name, contact, vehicle number and insurer", "the accident report to your insurer", "a police report, if anyone was hurt or it was a hit-and-run", "the workshop's repair quote"];
  if (/home|house|property|water|leak|fire|burglar/i.test(kind)) return ["photos and videos of the damage before cleaning up", "the plumber's or contractor's report on the cause", "repair quotes and receipts", "a police report for a break-in", "the insurer's claim form"];
  if (/death|died/i.test(kind)) return ["the death certificate", "the policy documents", "the claimant's identity documents", "the insurer's claim form"];
  return ["the bills and receipts", "the doctor's or other report on what happened", "the insurer's claim form"];
}

/** Round 9: "the bill is S$12,000, how much do I pay?", a pasted hospital bill with "how much will my shield pay":
 * a question about what the person pays themselves, not a claim interview. */
export function billQuestion(text: string): boolean {
  const t = text.replace(/\s+/g, " ");
  return /\b(?:bill|invoice|charges?|total)\b|S\$\s?[\d,]+|\$\s?\d|\b\d{3,}(?:\.\d+)?\s*(?:dollars?|sgd)\b/i.test(t)
    && /\bhow much\b[^?]{0,40}\b(?:i|we|my \w+|it|they|the (?:plan|insurer|insurance)|insurance)\b[^?]{0,20}\b(?:pay|claim|cover)\b|\bpay (?:the [^?]{0,25})?first\b|\bwhat (?:do|would|will) (?:i|we) (?:have to )?pay\b/i.test(t)
    && !/\b(?:premium|excess)\b/i.test(t);
}

// ------------------------------------------------------------------ "it renews on 15/1/2027, right?"
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const monthIndex = (m: string) => MONTH_NAMES.findIndex((x) => x.startsWith(m.toLowerCase().slice(0, 3)));
const isoOf = (y: number, m: number, d: number) => y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** A date the household typed, in any common Singapore format; "end of March 2027" is its last day. Null when none. */
export function typedDate(text: string): { iso: string; monthOnly: boolean } | null {
  let m = text.match(/\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/);
  if (m) return { iso: isoOf(+m[1], +m[2], +m[3]), monthOnly: false };
  m = text.match(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d\d|\d\d)\b/);
  if (m) return { iso: isoOf(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]), monthOnly: false };
  m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)\s+(20\d\d)\b/i);
  if (m && monthIndex(m[2]) >= 0) return { iso: isoOf(+m[3], monthIndex(m[2]) + 1, +m[1]), monthOnly: false };
  m = text.match(/\b(jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d\d)\b/i);
  if (m && monthIndex(m[1]) >= 0) return { iso: isoOf(+m[3], monthIndex(m[1]) + 1, +m[2]), monthOnly: false };
  m = text.match(/\b(?:end of |until |till )?(jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)\s+(20\d\d)\b/i);
  if (m && monthIndex(m[1]) >= 0) { const mo = monthIndex(m[1]) + 1; return { iso: isoOf(+m[2], mo, lastDay(+m[2], mo)), monthOnly: true }; }
  return null;
}
/** Whether the message checks a date ("... right?", "correct?", "valid on ...", "renew on ...") rather than reporting one. */
export function checksADate(text: string): "renew" | "end" | "on" | null {
  if (!typedDate(text) || !/\?|\b(?:right|correct|is it|true|confirm|valid|still)\b/i.test(text)) return null;
  if (!/\b(?:renew\w*|valid|in force|active|expir\w*|till|until|end(?:s|ing)?|covered on|cover(?:ed)? (?:until|till))\b/i.test(text)) return null;
  if (/\b(?:what if|if (?:i|he|she|we)|happened|admitted|hospitali[sz]ed|died|passed away|accident|diagnosed|delayed|claim\w*|broke|fell|injur\w*|surgery|pay\w*)\b/i.test(text)) return null;
  if (/\brenew\w*\b/i.test(text)) return "renew";
  if (/\b(?:till|until|end\w*|expir\w*|up to)\b/i.test(text)) return "end";
  if (/\b(?:valid|covered|in force|active)\b[^?]{0,20}\bon\b|\bon \d|\b(?:valid|covered|in force|active)\b/i.test(text)) return "on";
  return null;
}
/** Period and renewal dates a document prints, from its page text. */
export function printedDates(text: string): { start?: string; end?: string; renew?: string } {
  const D = "(\\d{1,2})\\s+(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(20\\d\\d)";
  const iso = (d: string, mo: string, y: string) => isoOf(+y, monthIndex(mo) + 1, +d);
  const out: { start?: string; end?: string; renew?: string } = {};
  const period = text.match(new RegExp(D + "\\s+(?:to|-|–)\\s+" + D, "i"));
  if (period) { out.start = iso(period[1], period[2], period[3]); out.end = iso(period[4], period[5], period[6]); }
  const renew = text.match(new RegExp("\\b(?:renew\\w*(?: date)?|next renewal date)[^\\n\\d]{0,30}" + D, "i"));
  if (renew) out.renew = iso(renew[1], renew[2], renew[3]);
  return out;
}
export function longDateOf(iso: string) { const [y, m, d] = iso.split("-"); return Number(d) + " " + MONTH_NAMES[Number(m) - 1].replace(/^\w/, (c) => c.toUpperCase()) + " " + y; }
