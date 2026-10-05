/**
 * Round 7: a question asked in Malay or Chinese ("polisi whole life saya masih
 * aktif ke?", "我太太的重病保险多少钱?") is not refused. DearPolicy answers in
 * English, says so, and shows the English it read the question as, so a
 * misreading is visible at once. The reading is a fixed glossary of the words
 * households use about their insurance plus a few sentence shapes -- never a
 * model's free translation -- and a message it cannot read with confidence
 * (too few words it knows) is left alone, to be answered as before.
 */

import { ENGLISH as ENGLISH_WORDS, MALAY as MALAY_WORDS } from "./conversational";

export type EnglishReading = { language: "Malay" | "Chinese"; english: string };

const CJK = /[一-鿿]/;
const CJK_ALL = /[一-鿿]/g;

// Longest first: "联合保单" before "保单", "多少钱" before "多少".
const CHINESE: [string, string][] = ([
  ["联合保单", "joint policy"], ["寿险保额", "life insurance sum assured"], ["重大疾病", "critical illness"], ["什么时候", "when"],
  ["有什么保险", "what insurance"], ["多少钱", "how much"], ["还有效", "still in force"],
  ["我们的", "our "], ["我的", "my "], ["她的", "her "], ["他的", "his "], ["你的", "your "],
  ["保单", "policy"], ["保险", "insurance"], ["寿险", "life insurance"], ["重病", "critical illness"], ["重疾", "critical illness"],
  ["保额", "sum assured"], ["保费", "premium"], ["多少", "how much"], ["太太", "wife"], ["老婆", "wife"], ["妻子", "wife"],
  ["老公", "husband"], ["先生", "husband"], ["丈夫", "husband"], ["爸爸", "dad"], ["父亲", "father"], ["妈妈", "mum"], ["母亲", "mother"],
  ["儿子", "son"], ["女儿", "daughter"], ["孩子", "children"], ["住院", "hospital stay"], ["医院", "hospital"], ["医疗", "medical"],
  ["意外", "accident"], ["旅游", "travel"], ["旅行", "travel"], ["牙科", "dental"], ["牙医", "dental"], ["癌症", "cancer"],
  ["到期", "expire"], ["有效", "in force"], ["理赔", "claim"], ["索赔", "claim"], ["可以", "can"], ["免赔额", "deductible"], ["自付额", "deductible"],
  ["身故", "death"], ["死亡", "death"], ["门诊", "outpatient"], ["谢谢", "thanks"], ["多谢", "thanks"], ["我们", "we"], ["我", "I"], ["她", "she"], ["他", "he"],
] as [string, string][]).sort((a, b) => b[0].length - a[0].length);

const MALAY: [RegExp, string][] = [
  [/\bmasih aktif\b/gi, "still in force"], [/\baktif\b/gi, "in force"], [/\bberapa kali\b/gi, "how many times"], [/\bberapa\b/gi, "how much"],
  [/\bpolisi\b/gi, "policy"], [/\binsurans\b/gi, "insurance"], [/\bperlindungan\b/gi, "cover"], [/\bperjalanan\b/gi, "travel"],
  [/\bpembatalan\b/gi, "cancellation"], [/\bkemalangan\b/gi, "accident"], [/\bbayaran\b/gi, "payout"], [/\bbayar\b/gi, "pay"],
  [/\bbapa\b|\bayah\b/gi, "dad"], [/\bemak\b|\bibu\b/gi, "mum"], [/\bisteri\b/gi, "wife"], [/\bsuami\b/gi, "husband"], [/\banak\b/gi, "child"],
  [/\bbila\b/gi, "when"], [/\btamat\b/gi, "end"], [/\bboleh\b/gi, "can"], [/\btuntut(?:an)?\b/gi, "claim"], [/\bgigi\b/gi, "dental"],
  [/\bsetahun\b/gi, "a year"], [/\bperlu\b/gi, "need"], [/\bhospital\b/gi, "hospital"], [/\bapa\b/gi, "what"],
];
const MALAY_WORD = /\b(?:saya|polisi|insurans|masih|aktif|berapa|bila|tamat|boleh|tak|ke|ada|apa|bapa|ayah|emak|ibu|isteri|suami|anak|gigi|perjalanan|pembatalan|kemalangan|perlindungan|bayar|tuntut\w*|setahun|perlu|punya|ini|ni)\b/gi;

function tidy(s: string) {
  return s.replace(/\s+/g, " ").replace(/\s+([?.!,'’])/g, "$1").replace(/^\s+|\s+$/g, "").replace(/^./, (c) => c.toUpperCase());
}
const possessive = (s: string) => s.replace(/\b(my|our|her|his|your) ([^?]+?) 's\b/gi, "$1 $2’s").replace(/\s+'s\b/g, "’s");

function chinese(text: string): string | null {
  // "In Mandarin please:" asks for a language; the question is what follows.
  let t = text.replace(/^\s*in (?:mandarin|chinese)(?: please)?\s*[:,-]?\s*/i, "").replace(/[？]/g, "?").replace(/[，、]/g, ", ").replace(/[。！]/g, ".");
  const known = CHINESE.filter(([zh]) => t.includes(zh)).reduce((n, [zh]) => n + zh.length, 0);
  const all = (t.match(CJK_ALL) ?? []).length;
  if (!all || known < Math.ceil(all * 0.6)) return null;
  // Sentence shapes first, on the Chinese.
  const shape = t.replace(/[?\s]+$/, "");
  let m: RegExpMatchArray | null;
  if ((m = shape.match(/^(.*?)有什么保险$/))) return tidy("What insurance does " + words(m[1]) + " have?");
  if ((m = shape.match(/^(.*?)的?赔多少$/))) return tidy("How much does the " + words(m[1]) + " cover pay?");
  if ((m = shape.match(/^(.*?)是?多少钱?$/))) return tidy("How much is " + possessive(words(m[1])) + "?");
  if ((m = shape.match(/^(.*?)(?:还)?有效吗$/))) return tidy("Is " + possessive(words(m[1])) + " still in force?");
  if ((m = shape.match(/^(.*?)什么时候到期$/))) return tidy("When does " + possessive(words(m[1])) + " expire?");
  if ((m = shape.match(/^(我|我的|她|她的|他|他的)呢$/))) return tidy("And " + ({ 我: "mine", 我的: "mine", 她: "hers", 她的: "hers", 他: "his", 他的: "his" } as Record<string, string>)[m[1]] + "?");
  if ((m = shape.match(/^(.*?)呢$/))) return tidy("And " + words(m[1]) + "?");
  return tidy(possessive(words(shape)) + (/\?\s*$/.test(t) ? "?" : ""));
}
function words(zh: string): string {
  // "我爸爸", "她老公": a person word right after 我/她/他 is theirs.
  let t = zh.replace(/(我们|我|她|他)(?=爸爸|妈妈|太太|老婆|老公|先生|儿子|女儿|孩子|父亲|母亲|妻子|丈夫)/g, (w) => ({ 我们: "our ", 我: "my ", 她: "her ", 他: "his " } as Record<string, string>)[w]);
  for (const [k, v] of CHINESE) t = t.split(k).join(" " + v + " ");
  return t.replace(/的/g, " 's ").replace(/[吗呢吧啊]/g, " ").replace(/\s+/g, " ").trim();
}

function malay(text: string): string | null {
  const malayWords = (text.match(MALAY_WORD) ?? []).length;
  if (malayWords < 2) return null;
  let t = text.trim().replace(/[?!.\s]+$/, "");
  const asks = /\b(?:ke|tak|kah)\s*$/i.test(t) || /\?\s*$/.test(text);
  t = t.replace(/\s+\b(?:ke|tak|kah|lah|pun)\b\s*$/i, "").replace(/\b(?:lah|pun)\b/gi, " ");
  // "X saya" is "my X"; "X saya punya Y" is "my X's Y".
  const mine = /\bsaya\b/i.test(t);
  t = t.replace(/\b(\w+) saya punya\b/gi, "$1’s").replace(/\bsaya punya\b/gi, "my").replace(/\bsaya\b/gi, " ");
  let m: RegExpMatchArray | null;
  // Malay puts the describing words after the noun ("polisi whole life", "insurans perjalanan"): English puts them first.
  const en = (s: string) => { let x = s; for (const [re, v] of MALAY) x = x.replace(re, v);
    x = x.replace(/\b(policy|insurance)\s+((?!cover\b|how\b|can\b|what\b|when\b)[a-z]+(?:\s+(?!cover\b|how\b|can\b)[a-z]+)?)\s*$/i, "$2 $1").replace(/\b(policy|insurance)\s+(travel|whole life|life|hospital|dental|accident)\b/i, "$2 $1");
    return x.replace(/\s+/g, " ").trim(); };
  const who = mine ? "my " : "";
  if ((m = t.match(/^(.*?)\s+masih aktif$/i))) return tidy("Is " + who + en(m[1]) + " still in force?");
  if ((m = t.match(/^berapa (?:kali )?(.*)$/i)) && !/\bkali\b/i.test(t)) return tidy("How much is " + who + en(m[1]) + "?");
  if ((m = t.match(/^berapa kali (.*)$/i))) return tidy("How many times " + en(m[1]) + "?");
  if ((m = t.match(/^bila tamat (.*)$/i))) return tidy("When does " + who + en(m[1]).replace(/^this /, "this ") + " end?");
  if ((m = t.match(/^(.*?)\s+ada\s+(.*)$/i)) && asks) return tidy("Does " + en(m[1]) + " have " + (mine ? "my " : "a ") + en(m[2]) + "?");
  if ((m = t.match(/^(.*?)\s+cover apa$/i))) return tidy("What does " + (mine && !/’s/.test(m[1]) ? "my " : "") + en(m[1]).replace(/’s$/, "’s") + " cover?");
  const out = en(t);
  return out.split(/\s+/).length >= 2 ? tidy((mine ? "my " : "") + out + (asks ? "?" : "")) : null;
}

/** The English a Malay or Chinese question is read as, or null (English already, or not readable with confidence). */
export function englishReading(text: string): EnglishReading | null {
  const message = String(text ?? "").trim();
  if (!message || message.length > 300) return null;
  if (CJK.test(message)) {
    // Thanks and greetings are handled as such ("ok 谢谢").
    if (/^(?:ok\s*)?(?:谢谢|多谢|你好)\s*[!！.。]?$/i.test(message)) return null;
    const english = chinese(message);
    return english && english.split(/\s+/).length >= 2 ? { language: "Chinese", english } : null;
  }
  // Only a message with no English in it at all (the one that used to be refused) is read from Malay.
  if ((message.match(MALAY_WORDS) ?? []).length < 2 || (message.match(ENGLISH_WORDS) ?? []).length > 0) return null;
  const english = malay(message);
  return english ? { language: "Malay", english } : null;
}

/** The sentence that says the question was read from another language, and as what. */
export function languageNote(r: EnglishReading): string {
  return "You asked in " + r.language + ", so this answer is in English. DearPolicy read your question as: “" + r.english.replace(/[?\s]+$/, "") + "”.";
}
