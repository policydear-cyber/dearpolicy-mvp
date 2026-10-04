/**
 * Round 10 detectors: what goes wrong when the documents behind an answer
 * arrived messy. Run on every answer IN ADDITION to the Round 6-9 ones. Pure
 * functions; each rule has a positive and a negative control in selfTest().
 */
import type { ChatAnswer } from "@/types";
import { visibleFields, type Hit } from "../r6/detectors";
import type { Expect } from "./battery";

/** A figure a scan printed unclearly (S$12,5OO): the value it would be if read
 * "clean", the value a parser that stops at the first letter would take
 * (S$12), the context an answer about it would carry, and whether the same
 * document (or a copy of it) prints the clean value somewhere. */
export type OcrTypo = { file: string; token: string; value: number; prefix: number | null; context: RegExp; agreed: boolean };
export type R10Truth = {
  typos: OcrTypo[];
  /** Policy ids of uploads that are not policies (letters, bills, notes, screenshots): never cover. */
  notCover: Map<string, string>;
  /** The photo and the PDF of the same schedule. */
  duplicatePair: [string, string] | null;
};

const CONFUSABLE = /[OoIl|]/;
/** Money tokens in OCR'd text that carry a letter where a digit belongs. */
export function ocrTypoTokens(text: string): { token: string; value: number; prefix: number | null }[] {
  const out: { token: string; value: number; prefix: number | null }[] = [];
  for (const m of text.matchAll(/(?:S\$|\$)\s?([0-9OoIl|][0-9OoIl|,]*(?:\.[0-9OoIl|]{1,2})?)(?![A-Za-z0-9])/g)) {
    const body = m[1];
    if (!CONFUSABLE.test(body) || !/\d/.test(body)) continue;
    const intPart = body.split(".")[0];
    if (!CONFUSABLE.test(intPart)) continue; // only the cents unclear: the amount itself is printed clearly
    const value = Number(body.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/,/g, ""));
    const lead = intPart.match(/^[\d,]+/)?.[0]?.replace(/,/g, "");
    out.push({ token: m[0], value, prefix: lead && lead.length < intPart.replace(/,/g, "").length ? Number(lead) : null });
  }
  return out;
}

const said = (a: ChatAnswer) => visibleFields(a).filter((f) => !/quote|citation/.test(f.where) && f.where !== "disclaimer");
const sentences = (text: string) => text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const money = (s: string) => [...s.matchAll(/S\$\s?(\d[\d,]*(?:\.\d+)?)(?![\d,.]*[\dOoIl|])/g)].map((m) => Number(m[1].replace(/,/g, "")));
export const UNCLEAR_WORDS = /unclear|not clear|can[’']t be read|couldn[’']t be read|could not be read|hard to read|check (?:it |this )?against|blurr|smudg|not (?:fully )?legible|illegible|as printed on the scan|the scan shows/i;

export function detectR10(a: ChatAnswer, t: { question: string; expect?: Expect }, g: R10Truth): Hit[] {
  const hits: Hit[] = [];
  const hit = (rule: string, text: string) => hits.push({ rule, text: text.slice(0, 260) });
  const fields = said(a);
  const text = fields.map((f) => f.text).join("\n");
  const sents = sentences(text);
  // 1. A figure a scan printed unclearly, stated as a clean figure (or cut short at the first letter).
  for (const s of sents) {
    if (UNCLEAR_WORDS.test(s)) continue;
    for (const typo of g.typos) if (s.includes(typo.token)) hit("unclear scanned figure shown without saying so", typo.token + " → " + s);
    for (const v of money(s)) for (const typo of g.typos) {
      if (!typo.context.test(s) && !typo.context.test(a.summary)) continue;
      if (v === typo.value && !typo.agreed) hit("unclear scanned figure stated as clean", typo.token + " → " + s);
      else if (typo.prefix != null && v === typo.prefix && v !== typo.value) hit("figure cut short from an unclear scan", typo.token + " → " + s);
    }
  }
  // 1b. What the question asks about ("heart attack", "pre-existing conditions") taken for a person's name.
  const called = a.summary.match(/\banyone called “([^”]+)”/);
  if (called && !/^[A-Z]/.test(called[1]) && called[1].split(/\s+/).every((w) => /^[a-z-]+$/.test(w))) hit("question words read as a person's name", a.summary);
  // 2. Letters, bills, claim decisions, notes and screenshots are never cover.
  for (const item of a.portfolioItems ?? []) {
    const blob = JSON.stringify(item);
    for (const [id, kind] of g.notCover) if (blob.includes(id)) hit("non-policy document listed as a policy", kind + ": " + item.policyName);
    if (/Novena Heights|my notes|Premium Revision|Claim Decision|Final Bill/i.test(item.policyName)) hit("non-policy document listed as a policy", item.policyName);
  }
  for (const l of a.policyStatedLimits ?? []) if (g.notCover.has(l.citation?.policyId ?? "")) hit("non-policy document used as a cover limit", g.notCover.get(l.citation!.policyId)! + ": " + l.benefitTitle + " " + l.amountText);
  for (const i of (a.claimItems ?? []).filter((x) => x.status !== "not_applicable")) {
    const bad = i.policyStatedLimit?.citation?.policyId;
    if (bad && g.notCover.has(bad) && g.notCover.get(bad) !== "screenshot") hit("non-policy document used as cover in a claim", g.notCover.get(bad)! + ": " + i.title);
  }
  for (const s of sents) {
    if (/(?:cover(?:s|ed)?|limit|sum (?:insured|assured)|pays? up to)[^.]{0,40}S\$(?:24,816\.40|22,767\.34)|S\$(?:24,816\.40|22,767\.34)[^.]{0,30}(?:of cover|cover limit|sum insured|limit)/i.test(s)) hit("bill or claim figure presented as cover", s);
    if (/(?:currently|now|this year|current(?:ly)? (?:annual )?premium)[^.]{0,40}S\$2,736|S\$2,736[^.]{0,40}(?:this year|currently|for the current)/i.test(s) && !/from 1 April 2027|next (?:renewal|year)|will (?:be|increase|go up|rise)/i.test(s)) hit("future premium from a letter stated as current", s);
    if (/deductible[^.]{0,40}S\$3,000\b|S\$3,000\b[^.]{0,25}deductible/i.test(s) && /SilverShield|Papa|Boon Huat|hospital plan|shield/i.test(s + " " + a.summary) && !/notes?|you wrote|I wrote|typed|not S\$3,000|isn[’']t S\$3,000|rather than|instead of|co-?pay/i.test(s) && !/\bown notes\b|notes, not/i.test(a.summary)) hit("figure from family notes stated as policy fact", s);
    // (an answer that says, anywhere, that the figure comes from the app screenshot is fine)
    if (/S\$500,000/.test(s) && /TermGuard|life (?:cover|insurance)|sum assured/i.test(s) && !/Wanderer|travel|overseas medical/i.test(s) && !/screenshot|\bapp\b|insurer['’]s app|unconfirmed|not (?:the|a) policy/i.test(s + "\n" + a.summary)) hit("app screenshot figure stated as policy fact", s);
    if (/SeniorGuard[^.]{0,60}\b(?:covers?|insures?|for)\b[^.]{0,20}\b(?:Papa|Chua Boon Huat|Boon Huat|you|Kok Leong)\b/.test(s) || /Wanderer[^.]{0,60}\b(?:covers?|insures?)\b[^.]{0,20}\b(?:Papa|Mama|Lee Ah Lian|Chua Boon Huat)\b/.test(s)
      || /Heritage Whole Life[^.]{0,60}\b(?:covers?|insures?)\b[^.]{0,20}\b(?:Mama|Lee Ah Lian|you|Kok Leong)\b/.test(s)) hit("policies from one bundle mixed together", s);
    if (/SilverShield(?! Assist| Care)[^.]{0,60}\b(?:expired|has ended|ended on|lapsed|no longer (?:active|in force))\b/i.test(s) && !/2025|previous|earlier|older|last year|Assist Rider/i.test(s)) hit("older schedule makes the current policy look ended", s);
    if (/\bstill being read\b|\bask again in a few minutes\b/i.test(s)) hit("document shown as still reading", s);
    const listed: string[] = s.match(/\b(SilverShield Integrated Plan|Golden Years Critical Illness|CareCash Hospital Income|SeniorGuard Personal Accident|Heritage Whole Life|Wanderer Annual Travel|TermGuard 65)\b/g) ?? [];
    const twice = listed.find((n, i) => listed.indexOf(n) !== i);
    if (twice && /,| and /.test(s) && !/same|duplicate|copy|letter|renewal|statement|wording|bill|claim/i.test(s)) hit("same policy listed twice", s);
  }
  // 3. The photo and the PDF of one schedule are one document.
  if (g.duplicatePair) {
    const ids = new Set((a.citations ?? []).map((c) => c.policyId));
    if (ids.has(g.duplicatePair[0]) && ids.has(g.duplicatePair[1]) && !/same|duplicate|copy/i.test(text)) hit("duplicate upload treated as a second document", [...ids].join(","));
  }
  // 4. An upload that could not be read is explained plainly, with what to do.
  const kind = t.expect?.unreadable;
  if (kind) {
    const need: Record<string, [RegExp, RegExp]> = {
      password: [/password|locked/i, /upload (?:it |the file )?again|re-?upload|unlocked copy|with (?:its|the) password/i],
      damaged: [/damaged|corrupt|incomplete|cut off|could not be opened|couldn[’']t be opened|can[’']t be opened|not a complete/i, /original|download|re-?export|again|insurer/i],
      blurry: [/blurr|too dark|dark|faint|out of focus|couldn[’']t (?:read|make out)|could not (?:read|make out)/i, /retake|take (?:it|the photo|another)|photo again|light|flat|shadow|whole page|scan/i],
      handwriting: [/handwrit/i, /partly|parts? of|couldn[’']t|could not|not reliabl|illegible|some words/i],
      heic: [/HEIC/i, /JPE?G|PDF|export|Most Compatible/i],
    };
    const [what, todo] = need[kind];
    if (!what.test(text) || !todo.test(text)) hit("unreadable upload not explained plainly", kind + ": " + a.summary);
    if (kind !== "blurry" && /clearer scan/i.test(text) && kind !== "handwriting") hit("wrong advice for an unreadable upload", kind + ": " + a.summary);
  }
  return hits;
}

export function selfTest(): string[] {
  const fails: string[] = [];
  const g: R10Truth = {
    typos: [{ file: "ci.pdf", token: "S$12,5OO", value: 12500, prefix: 12, context: /Golden Years|cancer|critical illness/i, agreed: false },
      { file: "ci.pdf", token: "S$5O,000", value: 50000, prefix: 5, context: /Golden Years|critical illness/i, agreed: true }],
    notCover: new Map([["bill-id", "bill"], ["shot-id", "screenshot"]]), duplicatePair: ["photo", "pdf"],
  };
  const base = (over: Partial<ChatAnswer>): ChatAnswer => ({ mode: "answer", summary: "ok", details: [], claimItems: [], nextSteps: [], confidence: null, citations: [], disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [], ...over });
  const t = { question: "q" };
  const expectRule = (name: string, a: ChatAnswer, rule: RegExp, tt: { question: string; expect?: Expect } = t) => { const h = detectR10(a, tt, g); if (!h.some((x) => rule.test(x.rule))) fails.push(name + " not detected (got " + h.map((x) => x.rule).join(", ") + ")"); };
  const clean = (name: string, a: ChatAnswer, tt: { question: string; expect?: Expect } = t) => { const h = detectR10(a, tt, g); if (h.length) fails.push(name + " flagged: " + h.map((x) => x.rule + ": " + x.text).join(" | ")); };
  if (JSON.stringify(ocrTypoTokens("Sum S$5O,000 and S$1,962.0O and S$1,OOO,OOO and S$2,l84.00 and S$300")) !== JSON.stringify([{ token: "S$5O,000", value: 50000, prefix: 5 }, { token: "S$1,OOO,OOO", value: 1000000, prefix: 1 }, { token: "S$2,l84.00", value: 2184, prefix: 2 }]))
    fails.push("ocrTypoTokens: " + JSON.stringify(ocrTypoTokens("Sum S$5O,000 and S$1,962.0O and S$1,OOO,OOO and S$2,l84.00 and S$300")));
  expectRule("unclear figure as clean", base({ summary: "Golden Years pays 25% of the sum assured for early stage cancer, up to S$12,500." }), /stated as clean/);
  clean("unclear figure flagged", base({ summary: "Golden Years pays 25% for early stage cancer; the cap on the scan is unclear (it reads S$12,5OO), so check it against the paper copy." }));
  clean("agreed figure", base({ summary: "Golden Years Critical Illness has a sum assured of S$50,000." }));
  expectRule("raw typo", base({ summary: "Golden Years Critical Illness — Sum assured: S$5O,000 (page 1)." }), /without saying so/);
  if (detectR10(base({ summary: "Golden Years Critical Illness — Sum assured: S$5O,000 (page 1)." }), t, g).some((x) => /cut short/.test(x.rule))) fails.push("raw typo read as a cut-short figure");
  expectRule("words as a name", base({ summary: "I can’t find anyone called “heart attack” in your household, so I’m not sure which family member you mean." }), /read as a person/);
  clean("a real unknown name", base({ summary: "I can’t find anyone called “Ravi” in your household, so I’m not sure which family member you mean." }));
  expectRule("prefix figure", base({ summary: "Golden Years pays S$12 for early stage cancer." }), /cut short/);
  expectRule("bill as cover", base({ summary: "SilverShield covers up to S$24,816.40 for the knee replacement." }), /bill or claim figure/);
  clean("bill as bill", base({ summary: "The Novena Heights bill came to S$24,816.40, and the claim for it was rejected." }));
  expectRule("future premium", base({ summary: "Papa currently pays S$2,736 a year for SilverShield." }), /future premium/);
  clean("future premium dated", base({ summary: "Papa pays S$2,184 now; from 1 April 2027 the premium will be S$2,736." }));
  expectRule("notes figure", base({ summary: "Papa's SilverShield deductible is S$3,000." }), /family notes/);
  clean("notes corrected", base({ summary: "Papa's SilverShield deductible is S$3,500, not S$3,000 as your notes say." }));
  expectRule("screenshot figure", base({ summary: "Your TermGuard 65 sum assured is S$500,000." }), /screenshot/);
  clean("screenshot labelled", base({ summary: "The screenshot from Merlion's app shows a TermGuard 65 sum assured of S$500,000." }));
  expectRule("bundle mixed", base({ summary: "SeniorGuard Personal Accident covers Papa for accidental death." }), /bundle/);
  expectRule("ended", base({ summary: "SilverShield Integrated Plan ended on 31 March 2026." }), /looks? ended/);
  clean("previous ended", base({ summary: "The 2025 SilverShield schedule ended on 31 March 2026; the current one runs to 31 March 2027." }));
  expectRule("still reading", base({ summary: "“x.pdf” is still being read. Ask again in a few minutes." }), /still reading/);
  expectRule("listed twice", base({ summary: "Papa has SilverShield Integrated Plan, SilverShield Integrated Plan and Heritage Whole Life." }), /listed twice/);
  expectRule("duplicate cited", base({ summary: "Here it is.", citations: [{ chunkId: "1", policyId: "photo", policyName: "x", pageStart: 1, pageEnd: 1 }, { chunkId: "2", policyId: "pdf", policyName: "x", pageStart: 1, pageEnd: 1 }] }), /duplicate upload/);
  expectRule("password unexplained", base({ summary: "I couldn’t read it." }), /not explained/, { question: "q", expect: { unreadable: "password" } });
  clean("password explained", base({ summary: "“TermGuard65_Schedule_locked.pdf” is locked with a password. Upload it again with its password." }), { question: "q", expect: { unreadable: "password" } });
  expectRule("damaged wrong advice", base({ summary: "“x.pdf” couldn’t be opened — it may be damaged. The original PDF or a clearer scan would let DearPolicy read it." }), /wrong advice/, { question: "q", expect: { unreadable: "damaged" } });
  expectRule("bill listed", base({ portfolioItems: [{ id: "x", ownerName: "Papa", policyName: "Novena Heights Hospital", confirmed: true, coverages: [] }] as never }), /non-policy document listed/);
  return fails;
}
