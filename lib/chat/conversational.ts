/**
 * Round 6: messages that are not a question about the household's policies
 * or a claim -- greetings and thanks, text that cannot be read, another
 * language, requests for advice, off-topic questions, attempts to get at how
 * DearPolicy works inside, and requests for another household's data.
 *
 * These are recognised in code, before any model is asked to interpret the
 * message, so the reply is the same honest sentence every time: it never
 * searches the policies for "hello", never says "not found" about a poem,
 * never repeats an instruction it was given, and never names a system detail.
 * A message that could be a real policy or claim question is never caught
 * here (every pattern is anchored or needs an unmistakable cue).
 */
import type { ClaimPerson } from "@/lib/claims/person";

export type ConversationalKind = "greeting" | "thanks" | "frustration" | "unclear" | "language" | "advice" | "legal" | "off_topic" | "system" | "other_household" | "approval" | "document_action" | "follow_up_why" | "follow_up_change" | "claim_start" | "dishonest";
export type ConversationalReply = { kind: ConversationalKind; summary: string; details: string[] };

const INSURANCE_WORDS = /\b(?:tpd|ghs|gtl|gpa|ci|excess|windscreen|renovations?|contents|ilps?|funds?|eldershield|careshield|endowment|surrender\w*|maturity|matures?|lapsed?|grace|reinstat\w*|ncd|no-claim|named driver|helper|maid|polic(?:y|ies)|insur\w*|cover\w*|claim\w*|premium\w*|deductible\w*|co-?insurance|co-?pay\w*|rider\w*|plan\w*|benefit\w*|hospital\w*|warded|ward|surgery|operation|accident\w*|injur\w*|fractur\w*|broke\w*|break\w*|bone|legs?|arms?|wrists?|ankles?|knees?|sprain\w*|sick|ill\w*|diagnos\w*|cancer|stroke|heart|died|death|dead|pass(?:ed)? away|disab\w*|travel\w*|trip\w*|flight\w*|luggage|baggage|delay\w*|overseas|medisave|medishield|shield|renew\w*|expir\w*|sum (?:insured|assured)|payout|bill\w*|doctor|clinic|dental|maternity|pregnan\w*|outpatient|ambulance|icu|critical|life|term|endowment|matur\w*|surrender\w*|car|motor|home|exclu\w*|waiting period|grace period|excess|limit\w*|pro-?ration|pre-?existing|valid\w*|active|in force|bills?|free[- ]look|cooling[- ]off|no[- ]claims?|ncd|surrender value|sum assured|sum insured|pay\w*|cost\w*|price|money|document\w*|schedule|certificate|booklet|group|agent|insurer)\b/i;

/** Letters of scripts other than Latin: the message is not in English. */
const OTHER_SCRIPT = /[Ѐ-ӿ֐-׿؀-ۿऀ-ॿ஀-௿฀-๿぀-ヿ㐀-鿿가-힯]/g;
export const MALAY = /\b(?:apa|saya|anda|insurans|perlindungan|boleh(?:kah)?|tuntutan|berapa|polisi|bagaimana|adakah|untuk|dengan|tidak|mahu|ingin|kami|kita)\b/gi;
const SPANISH_ETC = /\b(?:qu[eé]|cubre|p[oó]liza|seguro|cu[aá]nto|c[oó]mo|puedo|tengo|mi|mis|el|los|las|una?|est[aá]|por|para|quel|quelle|assurance|couvre|mon|wie|meine|versicherung)\b/gi;
export const ENGLISH = /\b(?:what|is|are|my|the|claim|cover|covered|policy|insurance|hospital|premium|how|much|does|do|can|have|has|for|and|who|when|which|i|we|you|pay|plan|get|got|or|not|of|in|on)\b/gi;

/** Everyday English words a question is made of (closed allow-list; insurance words are INSURANCE_WORDS). */
const ENGLISH_WORDS = new Set(("a an the and or but if so than then not no yes ok okay please pls is are am was were be been being do does did doing done " +
  "have has had having can could will would should shall may might must need needs want wants know tell show check find give see look " +
  "what whats what's who whom whose when where which why how much many long often any all some each every both either more most less " +
  "i me my mine we us our ours you your yours he him his she her hers it its they them their this that these those there here " +
  "of in on at to for from with without by about after before during until since under over per into out up down off again also just only still even " +
  "get gets got getting go goes going went come came make made take took pay paid paying pays say said ask asked " +
  "year years month months day days night nights week weeks time today yesterday tomorrow now ago next last first new old total amount left used " +
  "mum mom mother dad father wife husband son daughter child children kid kids baby brother sister grandma grandpa family parents " +
  "lah leh lor ah meh sia hi hello thanks thank").split(" "));
/** Function words of other Latin-script languages (closed list): Tagalog, Italian, Portuguese, Spanish, Dutch, French,
 * German, Malay and Indonesian. Only a sign, never enough on its own: the message must also be mostly not English. */
const OTHER_FUNCTION_WORDS = new Set(("ako ay ba ng ito sa ang mga aking ko niya namin " +
  "il lo la gli mio mia miei è stato ieri della dello di che sono quanto " +
  "o meu minha foi não está pelo pela do da dos das em " +
  "mi mis el los las por para es está qué cuánto " +
  "mijn het een ik niet voor van de wat hoeveel " +
  "le les mon ma est pour du des je " +
  "das der die ist mein meine für ich nicht wie " +
  "apa saya anda yang untuk dengan tidak berapa bagaimana adakah ke tak nak").split(" "));
/** DearPolicy answers in English only (owner's rule, 4 Nov 2026). Closed allow-list (TE #343: per-language word lists
 * missed Tagalog, Vietnamese, Italian, Dutch and Portuguese): a message is English only when its own words are, in fair
 * share, English or insurance words. It is not English when another script dominates, when another language's words
 * outnumber its English words two to one, or when fewer than a fifth of its words (at least five counted) are English AND
 * it shows a positive sign of another language (two of OTHER_FUNCTION_WORDS, or letters English does not use).
 * Short notes of names and places ("Ang mo kio polyclinic") stay English, and a capitalised word after the first is taken as
 * a name ("physiotherapy at Raffles Medical Holland Village").
 * The household's own names and plan names are not counted either way, nor are strings that are no word at all
 * ("asdkjh", "zzz"), which the chat answers as unclear. Read on the message as typed, before any spelling fix
 * ("insurans" would become "insurance"). Unsure stays English, so an English question is never refused. */
export function notEnglish(message: string, known: string[] = []): boolean {
  const text = stripEmoji(message ?? "").replace(/\s+/g, " ").trim();
  const otherScript = (text.match(OTHER_SCRIPT) ?? []).length;
  const latinLetters = (text.match(/[A-Za-z]/g) ?? []).length;
  if (otherScript >= 2 && otherScript >= latinLetters / 3) return true;
  // The household's own names and plan names, and any capitalised word after the first (a name or a place: "Raffles
  // Medical", "Tan Tock Seng"), are taken out before anything is counted (Critic #343: "Mi Mi's assurance plan?").
  const names = new Set(known.flatMap((n) => (n ?? "").toLowerCase().split(/[^\p{L}]+/u)).filter(Boolean));
  const kept = (text.match(/\p{L}+(?:['’]\p{L}+)?/gu) ?? []).filter((typed, i) => {
    const bare = typed.toLowerCase().replace(/['’]s$/, "");
    if (names.has(bare)) return false;
    // An English or insurance word stays whatever its case ("TPD", "Hospital").
    if (englishWord(typed.toLowerCase())) return true;
    return !(i > 0 && /^\p{Lu}/u.test(typed));
  }).map((t) => t.toLowerCase());
  const rest = kept.join(" ");
  const english = (rest.match(ENGLISH) ?? []).length;
  const foreign = Math.max((rest.match(MALAY) ?? []).length, (rest.match(SPANISH_ETC) ?? []).length);
  if (foreign >= 2 && foreign > 2 * english) return true;
  // The share rule refuses only on a positive sign of another language (Critic #343: "laptop stolen overseas police
  // report filed" is terse English): two words from a closed list of other languages' function words, or written with
  // letters English does not use ("bệnh", "für", "hôpital").
  const signal = kept.filter((w) => OTHER_FUNCTION_WORDS.has(w) || /[^\x00-\x7f]/.test(w.replace(/['’]/g, ""))).length;
  if (signal < 2) return false;
  let words = 0, englishWords = 0;
  for (const w of kept) {
    if (englishWord(w)) { words++; englishWords++; continue; }
    // Not a word at all ("asdkjh", "zzz"): neither English nor another language.
    if (/^[a-z]+$/.test(w) && (!/[aeiouy]/.test(w) || /[bcdfghjklmnpqrstvwxz]{5,}/.test(w))) continue;
    words++;
  }
  return words >= 5 && englishWords * 5 < words;
}
function englishWord(w: string): boolean {
  const plain = w.replace(/['’]s$/, "").replace(/['’]/g, "");
  return ENGLISH_WORDS.has(w) || ENGLISH_WORDS.has(plain) || INSURANCE_WORDS.test(w);
}

const GREETING = /^(?:hi+|hello+|hey+|hiya|yo|good (?:morning|afternoon|evening|day)|morning|hola|greetings|salam|assalamualaikum|selamat (?:pagi|petang|malam|tengah hari)|ni hao|你好)(?:\s+(?:there|dearpolicy|all|lah|leh|ah))?(?:[\s,!.]+(?:(?:can|could) you help(?: me)?|help(?: me)?(?: pls| please)?|can help(?: me)?|how are you|are you there|what can you do|what do you do|how does (?:this|it) work))?[\s!.?]*$/i;
const HELP_ONLY = /^(?:help|help me|can help(?: me)?|can you help(?: me)?|what can you do|how does this work|what do you do)[\s!.?]*$/i;
const THANKS = /^(?:(?:ok(?:ay|ie)?|k|kk|alright|noted|got it|cool|great|nice|good|sure|fine|i see|oh|ah|ahh|lol|haha+|hehe+|wow|bye|goodbye|see you|cheers)[\s,!.]*)*(?:thanks?(?: you)?(?: (?:so much|very much|lah|ah|a lot))?|thank you|tq|ty|thx|tks|appreciate it|terima kasih(?: (?:banyak|ya))?|xie xie|谢谢|多谢)?[\s!.]*$/i;
/** Round 9: frustration or sarcasm with nothing asked. */
const FRUSTRATION = /^(?:(?:wow|oh|ok(?:ay)?|so|great|lol|haha|sigh|eh)[\s,!.]*)*(?:thanks? for nothing|(?:so |very |damn |really )?useless(?: lah| app| one)?|you(?:['’]re| are) (?:useless|no help|not helping|hopeless)|not helpful|no help(?: at all)?|waste of (?:my )?time|great(?:,)? (?:just )?great|wow(?:,)? (?:great|thanks)|(?:oh )?great(?:,)? another app|what a joke|this is (?:useless|ridiculous|a joke)|ridiculous|hopeless)[\s!.?]*$/i;
const THANKS_WORD = /\b(?:thanks?|thank you|tq|ty|thx|tks|appreciate|terima kasih|xie xie)\b|谢谢|多谢/i;

const SYSTEM = /\b(?:ignore (?:all |any )?(?:(?:the |your )?(?:previous|prior|above|earlier) )?(?:instructions|rules|prompts?)|ignore (?:all |any )?(?:of )?(?:your|the|these) (?:rules|instructions|guidelines)|system prompt|(?:your|the) (?:instructions|prompt|rules|guidelines) (?:verbatim|word for word)|reveal (?:your )?(?:instructions|prompt|rules|system)|print (?:your )?(?:instructions|prompt|rules)|jailbreak|developer mode|you are now|\bDAN\b|act as (?:an? )?(?:unrestricted|different|new) |sql|database|table names?|table rows|database rows|raw data|schemas?|raw json|json (?:of|for|dump)|chunk ids?|policy ids?|file paths?|storage keys?|api keys?|source code|what model|which model|(?:are|r) you (?:gpt|chatgpt|gemini|claude|openai|an? (?:ai|llm|language model|bot))|\bgpt(?:-?\d)?\b|\bgemini\b|\bopenai\b|\bllm\b|large language model|embeddings?|vector (?:store|database))\b/i;
const OTHER_HOUSEHOLD = /\b(?:other (?:households?|families|family'?s|users?|people'?s? (?:policies|insurance|cover))|households?(?:'s)? next door|another (?:household|family|user)|someone else'?s (?:polic(?:y|ies)|insurance|cover|claims?)|every(?:one|body) else'?s|all (?:households|users))\b|\b(?:household|account|family|user) [0-9a-f]{8}-[0-9a-f]{4}-/i;
const APPROVAL = /\b(?:approve (?:my|the|this) claim|pretend (?:you are|to be) (?:my |the )?(?:agent|insurer|adjuster)|guarantee (?:my|the) (?:claim|payout))\b/i;
const ADVICE = /\bshould (?:i|we|my \w+)\b[^?.]*\b(?:buy|get|take up|add|cancel|surrender|switch|keep|drop|upgrade|downgrade|lapse|terminate|stop paying|top up|reinstate|change (?:insurer|plan|policy))\b|\b(?:is|are) (?:my|our|this|the) [^?.]{0,40}\bworth it\b|\bworth (?:buying|keeping|it)\b|\bwhich (?:insurer|insurance company|company|agent) is (?:the )?(?:best|better|cheapest|good)\b|\bwhich (?:plan|policy) is (?:the )?(?:best|better|good)\b|\bbest (?:insurer|insurance(?: company| plan)?|plan to buy)\b|\brecommend (?:a|an|me|which|what)\b|\b(?:stocks?|shares|crypto|bitcoin|etfs?|unit trusts?)\b(?![^?.]*\b(?:linked|ilp)\b)|\bbuy more (?:insurance|cover|policies)\b|\b(?:am i|are we|is (?:she|he|my \w+)) (?:under|over)-?insured\b|\b(?:do i|do we|does (?:she|he)) (?:have|need) (?:enough|too much) (?:insurance|cover)\b|\btoo (?:much|many) (?:insurance|cover|polic(?:y|ies))\b|\bwhat (?:insurance|cover|policy|plan) should (?:i|we)\b|\bwhich (?:funds?|plans?|polic(?:y|ies)|insurers?)\b[^?.]{0,30}\b(?:should|to (?:switch|move|buy|choose))\b|\b(?:switch|move|invest)\b[^?.]{0,40}\b(?:better|higher|best|more) (?:returns?|performance|growth)\b/i;
/** Round 11: asking for help to misstate a claim or a record ("make the bill look bigger", "backdate the payment",
 * "write that he never had knee problems"): declined plainly, never answered with the policy's figures. */
const DISHONEST = /\b(?:fake|forge|falsif\w*|fabricat\w*|doctor(?:ed)?|back-?dat\w*|inflat\w*|pad|exaggerat\w*|alter|tamper\w*)\b[^?.]{0,60}\b(?:bills?|receipts?|invoices?|claims?|dates?|payments?|documents?|records?|letters?|reports?|forms?|mcs?|medical certificates?|premiums?)\b|\bmake (?:my |the |our |his |her )?(?:hospital |medical )?(?:bill|receipt|invoice|claim|amount)s? (?:look |seem )?(?:bigger|higher|larger|more)\b|\b(?:look|seem) (?:bigger|higher|larger)\b[^?.]{0,40}\b(?:claim|pay)|\b(?:saying|say|says|claim(?:ing)?|pretend(?:ing)?|tell(?:ing)? (?:them|the insurer))\b[^?.]{0,40}\b(?:never had|did not have|didn['’]t have)\b|\bhide (?:the|my|his|her|a|that) (?:condition|illness|pre-?existing|diagnosis|claim)|\b(?:not|don['’]t|do not|without) (?:declare|declaring|disclose|disclosing|mention|mentioning)\b[^?.]{0,40}\b(?:condition|illness|diagnos\w*|pre-?existing)|\blie (?:to|on|about)\b/i;
/** Round 15: a request for the chat to do something it cannot (send, book, remind, write, renew, pay). */
const ACTION = /^(?:(?:please|pls|can you|could you|would you|will you|help me(?: to)?|i want you to|i need you to|ok(?:ay)?|kindly)[,\s]+)*(?:write|draft|compose|book|make (?:an? )?(?:appointment|booking|reservation)|e-?mail|send|forward|fax|print|call|phone|whatsapp|text|remind (?:me|us) to|set (?:up )?(?:a |an )?(?:reminder|alarm|alert)|transfer|buy|purchase|order)\b(?![^?]{0,20}\b(?:is|are|does|do)\b[^?]*\?)|^(?:(?:please|pls|ok(?:ay)?)[,\s]+)*(?:can|could|would|will) you (?:please |pls )?(?:renew|pay|cancel|submit|file|lodge|update|change|extend|top up|reinstate|surrender)\b[^?]{0,40}\bfor (?:me|us)\b/i;
/** Round 15: plans or insurers on the market ("best CI plan in Singapore", "which travel insurance is cheapest"). */
const MARKET = /\b(?:best|cheapest|cheaper|top|most popular|good|recommended)\b[^?]{0,40}\b(?:plans?|insurance|insurers?|polic(?:y|ies)|companies|company)\b[^?]{0,30}\b(?:in (?:singapore|sg|the market|malaysia)|to buy|on the market|out there)\b|\bwhich (?:travel |health |life |car |motor |home |ci |critical illness )?(?:insurance|insurer|plan|policy) (?:is|has) (?:the )?(?:cheapest|best|most popular)\b[^?]{0,30}\b(?:in (?:singapore|sg|the market|malaysia)|to buy|on the market|out there)\b/i;
/** Round 15: "advice?", "was reducing my cover a mistake?", "should we appeal?", "should I complain to the airline?": a judgement asked for. */
const JUDGEMENT = /^\s*(?:any\s+)?(?:advice|advise me|your (?:advice|opinion|recommendation)|what (?:do|would) you (?:recommend|suggest|advise|do))\s*[?.!]*\s*$|\b(?:a mistake|a good idea|a bad idea|the right (?:choice|decision|move|thing)|a wise (?:choice|decision|move))\b|^\s*(?:so\s+|and\s+|then\s+)?should (?:i|we|he|she|they|my \w+)\s+(?:appeal|complain|increase|decrease|reduce|raise|lower|use (?:it|the money|the payout)|invest|put|pay off|switch|move|buy|get (?:a|an|another|more)\b|take (?:a|an|another|up))\b/i;
const LEGAL = /\b(?:sue|suing|lawsuit|lawyer|solicitor|legal action|take (?:them|the insurer) to court|small claims tribunal|is it (?:legal|lawful|allowed)|legally|against the law|my (?:legal )?rights)\b/i;
const OFF_TOPIC = /\b(?:restaurants?|cafes?|hawker|places? to eat|weather|forecast|poem|song|lyrics|joke|recipe|world cup|football|soccer|premier league|nba|movie|film|netflix|news|horoscope|lottery|4d|toto|translate|homework|essay|write (?:me )?(?:a|an) (?:poem|story|song|essay|email|letter)|code|python|javascript|capital of|president|prime minister|who (?:won|is the)|what(?:'s| is) the time|what day is)\b/i;

/** Round 11: a request to misstate a claim or record, recognised before any document is read for it. */
export function dishonestReply(message: string): ConversationalReply | null {
  const text = stripEmoji(message ?? "").replace(/\s+/g, " ").trim();
  if (!DISHONEST.test(text)) return null;
  return { kind: "dishonest", summary: "I can’t help with that — a claim, bill or record has to show what really happened, and changing or leaving things out can lead the insurer to reject the claim or cancel the policy.",
    details: ["What I can do is show exactly what your policies pay and what the insurer will ask for, so the claim you make is as strong as the facts allow."] };
}

function stripEmoji(text: string) { return text.replace(/[\p{Extended_Pictographic}‍️]/gu, " "); }

/** A reply for a message that is not a policy or claim question, or null. */
export function conversationalReply(args: { message: string; selected: ClaimPerson | null; family?: ClaimPerson[]; hasTopic: boolean; pending: boolean; products?: string[];
  /** The household's home country from its documents (lib/claims/home-country.ts): Singapore's disputes body is named only there, or when unknown. */
  home?: string | null }): ConversationalReply | null {
  const raw = args.message ?? "";
  const text = stripEmoji(raw).replace(/\s+/g, " ").trim();
  // A question naming one of the household's own plans ("what's the TPD on
  // EquaLife", "who is the nominee for EquaLife?") is about insurance.
  const lower = " " + text.toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
  const namesAPlan = (args.products ?? []).some((p) => { const words = p.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" "); return words.some((w) => w.length >= 5 && !/^(?:annual|family|group|plan|policy|cover|basic|plus|premier|benefits?)$/.test(w) && lower.includes(" " + w + " ")); });
  const example = (() => {
    const p = args.selected;
    if (!p) return "“What am I covered for?”";
    const who = /^self$/i.test(p.relationship ?? "") ? "my" : (p.preferred_name?.trim() || p.display_name) + "’s";
    return "“What does " + who + " hospital plan pay?”";
  })();
  const whatICanDo = "I can tell you what anyone in your household is covered for, their deductibles, premiums and renewal dates, straight from your uploaded documents — or help you work out a claim, one question at a time. For example: " + example;
  const reply = (kind: ConversationalKind, summary: string, details: string[] = []): ConversationalReply => ({ kind, summary, details });

  // Never stand between an open claim question and its answer: "ok", "idk",
  // "yes", a date or a name is the answer to the question on screen.
  const blockedWhilePending = (kind: ConversationalKind) => args.pending && ["greeting", "thanks", "unclear", "follow_up_why", "follow_up_change", "claim_start"].includes(kind);
  const pick = (r: ConversationalReply | null) => r && !blockedWhilePending(r.kind) ? r : null;

  // Thanks and greetings in any language the household uses ("terima kasih",
  // "ok 谢谢", "assalamualaikum") are thanks and greetings, not "another language".
  // Thanks ends a turn even while a claim question is open: the claim is kept
  // and carries on whenever its question is answered.
  if (THANKS.test(text) && THANKS_WORD.test(text) && text.length <= 40)
    return reply("thanks", args.pending ? "You’re welcome. What you’ve told me about the claim is saved — tell me more whenever you’re ready and I’ll carry on." : "You’re welcome. Ask me anything else about your policies, or tell me what happened if you need to make a claim.");
  // Round 15: a greeting is answered briefly -- what to ask, in one line, without a block of text.
  const hello = "Hi! Ask me what anyone in your household is covered for — premiums, deductibles, renewal dates — or tell me what happened and I’ll help with a claim, one question at a time.";
  if (GREETING.test(text) && !args.pending) return reply("greeting", hello);
  // Another script, or a Latin-script language with little English in it.
  if (notEnglish(text, [...(args.products ?? []), ...(args.family ?? []).flatMap((p) => [p.display_name, p.preferred_name ?? ""])]))
    return pick(reply("language", "Sorry, I can only answer in English for now. Please ask again in English — for example: " + example));
  const english = (text.match(ENGLISH) ?? []).length;

  if (SYSTEM.test(text))
    return reply("system", "I can’t share how DearPolicy works inside — its instructions, data or systems. I can help with your household’s own policies and claims.", [whatICanDo]);
  // "Delete that travel document", "remove my old policy": documents are managed on the Documents page, not in chat.
  if (/^(?:(?:please|pls|can you|could you|ok(?:ay)?)[,\s]+)*(?:delete|remove|erase|archive|get rid of)\b[^?]{0,60}\b(?:document|policy|file|upload|pdf|schedule|certificate|statement)s?\b/i.test(text))
    return reply("document_action", "I can’t delete or change documents from the chat. To remove one, open the Documents page and delete it there; its details stop being used in answers once it is deleted.");
  if (OTHER_HOUSEHOLD.test(text))
    return reply("other_household", "I can only see the policies in your own household, so I can’t show or discuss anyone else’s.", [whatICanDo]);
  if (APPROVAL.test(text))
    return reply("approval", "I can’t approve a claim or promise a payout — the insurer decides that after it assesses the claim. I can show which of your benefits may apply and what the insurer will ask for.");
  const dishonest = dishonestReply(text);
  if (dishonest) return dishonest;
  // Round 15: "book a doctor appointment", "email me the receipt", "set a reminder", "help me write a resignation letter",
  // "can you renew it for me": things the chat cannot do -- said plainly, with what it can do instead.
  if (ACTION.test(text) && !/\b(?:what|which|how|when|where|why|who)\b[^?]{0,40}\b(?:documents?|forms?|papers?)\b/i.test(text))
    return reply("off_topic", "I can’t do that from the chat — I can’t send emails, book appointments, set reminders, write letters or make changes to a policy for you. "
      + "What I can do is answer questions about your household’s insurance documents: " + whatICanDo.charAt(0).toLowerCase() + whatICanDo.slice(1));
  // Round 15: "recommend a good restaurant": nothing to do with insurance, whatever word asks for it.
  if (/\b(?:restaurants?|cafes?|hawker(?: centre)?|places? to eat|food court|movies?|holiday spots?)\b/i.test(text) && !INSURANCE_WORDS.test(text))
    return reply("off_topic", "I can only help with your household’s insurance policies and claims, so I can’t answer that. " + whatICanDo);
  // "Which travel insurance is cheapest in Singapore?", "best CI plan in Singapore?": the market, not the household's documents.
  if (MARKET.test(text))
    return reply("off_topic", "I can only see the policies your household has uploaded, so I can’t compare plans or insurers on the market, and I can’t recommend one — a licensed financial adviser can help with that. I can tell you exactly what your own policies cover and cost.");
  if (LEGAL.test(text) && !/\b(?:exclu\w*|waiting period|what does (?:my|the) policy say)\b/i.test(text))
    return reply("legal", "I can’t give legal advice. If an insurer turns down a claim, you can ask it to explain the decision in writing and to review it; if you still disagree, " + (args.home == null || args.home === "Singapore" ? "FIDReC (the Financial Industry Disputes Resolution Centre) handles disputes with insurers in Singapore" : "the independent insurance complaints or ombudsman service where you live handles disputes with insurers") + ", and a lawyer can advise you on your rights.",
      ["What I can do is show exactly what your policies say — for example their premiums, exclusions and conditions — so you have the facts in front of you."]);
  if (ADVICE.test(text) || JUDGEMENT.test(text))
    return reply("advice", "I can’t recommend whether to buy, keep, change or cancel a policy, or where to put your money — that is financial advice, and a licensed financial adviser can help with it.",
      ["What I can do is show exactly what your current policies cover and cost, so you can take that to the adviser. For example: “What am I covered for?” or “How much do we pay in premiums a year?”"]);

  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (!text || letters < 2)
    return pick(reply("unclear", "Sorry, I didn’t catch that. " + whatICanDo));
  // "hmm", "erm", "huh": nothing asked yet.
  if (/^(?:h+m+|erm+|um+|uh+|huh|eh+|meh)[\s?!.]*$/i.test(text))
    return pick(reply("unclear", "Sorry, I didn’t catch that. " + whatICanDo));
  if (GREETING.test(text) || HELP_ONLY.test(text))
    return pick(reply("greeting", /\bwhat can you do|how does (?:this|it) work|what do you do|\bhelp\b/i.test(text) ? "Hi! " + whatICanDo : hello));
  // Round 9: "thanks for nothing", "so useless", "wow great": frustration, said back plainly, never read as a claim.
  if (FRUSTRATION.test(text) && !INSURANCE_WORDS.test(text.replace(FRUSTRATION, "")) && text.length <= 80)
    return pick(reply("frustration", "I’m sorry this hasn’t helped yet. Tell me what you need — for example what a policy pays for something, or what happened — and I’ll answer it straight from your documents."));
  if (THANKS.test(text) && text.length <= 40)
    return pick(reply("thanks", THANKS_WORD.test(text) ? "You’re welcome. Ask me anything else about your policies, or tell me what happened if you need to make a claim."
      : /\b(?:bye|goodbye|see you|cya)\b/i.test(text) ? "Take care — I’m here whenever you need help with your policies or a claim."
      : "No problem — ask me anything else about your policies whenever you’re ready, or tell me what happened if you need to make a claim."));
  // Keyboard mashing: short, no word I know, and a run of consonants no word has.
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (words.length && words.length <= 5 && !INSURANCE_WORDS.test(text) && words.some((w) => /[bcdfghjklmnpqrstvwxz]{5,}/.test(w) || (w.length >= 4 && !/[aeiouy]/.test(w))) && english === 0)
    return pick(reply("unclear", "Sorry, I didn’t catch that. " + whatICanDo));

  // "Can claim anot?", "I want to make a claim": nothing has been said about
  // what happened yet, so that is the one question to ask.
  if (/^(?:(?:hi|hello|hey)[\s,!]+)?(?:(?:can|could|how (?:can|do|to)|how do (?:i|we)|i (?:want|would like|need) to|want to|help (?:me )?(?:to )?)\s+)?(?:i\s+|we\s+)?(?:make (?:a )?|file (?:a )?|submit (?:a )?|start (?:a )?)?claims?(?:\s+(?:anot|or not|can|ah|leh|lah|please|pls))*[\s?!.]*$/i.test(text))
    return pick(reply("claim_start", "I can help with that. What happened, and when? Tell me who it happened to and I’ll check which of your policies could help."));
  // A follow-up about a figure just given ("why so high?", "can reduce or not?").
  if (args.hasTopic && /^(?:but |so |and )?(?:why|how come)\b[^?]{0,40}\b(?:so )?(?:high|low|much|expensive|big|small|different|increase\w*|go(?:ne)? up)\b/i.test(text))
    return pick(reply("follow_up_why", "Your documents state the figures but not how the insurer arrived at them. The insurer (or your agent) can explain how it was set — for example your age, the plan or ward class you chose, and any rider."));
  if (args.hasTopic && /\b(?:can|could|how (?:can|do|to)|is there (?:a )?way to)\b[^?]{0,30}\b(?:reduce|lower|cut|decrease|remove|waive|avoid|change)\b/i.test(text) && !INSURANCE_WORDS.test(text.replace(/\b(?:can|reduce|lower|change)\b/gi, "")))
    return pick(reply("follow_up_change", "Your documents don’t say how to change it. Whether it can be lowered — for example by choosing a different plan, ward class or rider — is something the insurer or a licensed financial adviser can tell you, and I can’t recommend a change."));

  if (OFF_TOPIC.test(text) && !INSURANCE_WORDS.test(text) && !/\b(?:if|what if|fell|hurt|injur\w*|my|his|her|our)\b/i.test(text) && !namesAPlan)
    return reply("off_topic", "I can only help with your household’s insurance policies and claims, so I can’t answer that. " + whatICanDo);
  // A question with nothing about insurance, a person or an event in it, at
  // the start of a conversation: not something the documents can answer.
  const namesSomeone = (args.family ?? []).some((p) => [p.display_name, p.preferred_name ?? ""].join(" ").toLowerCase().split(/\s+/).filter((w) => w.length >= 2).some((w) => new RegExp("\\b" + w.replace(/[^a-z0-9]/g, "") + "\\b", "i").test(text)));
  if (!args.hasTopic && !namesSomeone && /\?\s*$|^(?:what|who|when|where|why|how|tell me|write|give me|show me)\b/i.test(text) && !/^(?:what|how) about\b|^and\b/i.test(text) && !INSURANCE_WORDS.test(text) && !namesAPlan && words.length >= 3
    && !/\b(?:i|me|my|mine|we|us|our|he|she|his|her|him|they|them|their|mum|mom|dad|mother|father|wife|husband|son|daughter|grandma|grandpa|ah ma|ah gong|brother|sister|neighbou?r|friend)\b/i.test(text))
    return reply("off_topic", "I can only help with your household’s insurance policies and claims, so I can’t answer that. " + whatICanDo);
  return null;
}
