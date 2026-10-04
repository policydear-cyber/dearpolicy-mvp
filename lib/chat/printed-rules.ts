/**
 * Round 11: the sentence a person's own document prints about the particular
 * thing asked ("giving birth", "MediSave", "a 4-month trip", "asthma", "a slow
 * leak", "get it back"), when an answer would otherwise miss it.
 *
 * Plain code over the document's own pieces (lib/chat/printed-lines.ts): a
 * question's specific words -- and the words documents use for the same thing
 * ("giving birth" -> childbirth, "asthma" -> pre-existing conditions) -- are
 * matched against each printed line by word stem. Only lines the answer does
 * not already say are returned, quoted verbatim with their page.
 */
import type { ChatCitation } from "@/types";
import { piecesOf } from "./printed-lines";

/** The words documents print for what people say. */
/** [what people say, what documents print, whether it is the same thing (true) or only related (false)] */
const DOMAIN_SYNONYMS: [RegExp, string[], boolean?][] = [
  [/\bgiv(?:e|ing) birth|\bdeliver(?:y|ing)? (?:a |the |my |her )?baby|\bmaternity|\bpregnan\w*|\bchildbirth/i, ["pregnancy", "childbirth", "maternity"], true],
  [/\bdental|\bteeth|\btooth|\bdentist/i, ["dental"], true],
  [/\bmedisave|\bcpf\b/i, ["medisave"], true],
  [/\bsurrender\w*|\bcash (?:it )?out|\bwithout (?:any )?charges?|\bpenalt\w*/i, ["surrender", "charge"], true],
  [/\b\d+[- ]?months?\b[^?]{0,30}\btrip|\btrip\b[^?]{0,30}\b\d+[- ]?months?\b|\blong trip|\bhow long\b[^?]{0,30}\btrip|\bbackpack\w*|\bsabbatical/i, ["trip", "last", "duration", "days"]],
  [/\basthma|\bdiabet\w*|\bhigh blood|\bexisting (?:condition|illness)|\bflares? up|\bchronic\b/i, ["pre-existing", "conditions"], true],
  [/\b(?:a |the )?fall\b|\bfell\b|\bslipp?(?:ed)?\b/i, ["fall", "accident"]],
  [/\bpipe|\bleak\w*|\bburst/i, ["pipe", "burst", "leaking"]],
  [/\bstolen|\btheft|\bbangle|\bjewel\w*|\bnecklace|\bvaluables?/i, ["valuables", "jewellery", "item"]],
  [/\bncd\b|\bno[- ]claims? discount/i, ["no-claim", "discount"], true],
  [/\bdoctor\b|\bclinic|\bgp\b|\bfever|\bflu\b|\boutpatient|\bcough/i, ["outpatient", "clinic", "practitioner"], true],
  [/\bget\b[^?]{0,25}\bback\b|\breinstat\w*|\brevive|\brestore/i, ["reinstate", "reinstatement"], true],
  [/\beurope\w*|\blondon|\bjapan\w*|\bamerica\w*|\bus trip|\busa\b|\bworldwide|\bwhich countries|\bdestination|\bwhere (?:can|are) (?:we|i)\b|\bbangkok|\bbali\b|\bkorea|\baustralia/i, ["asia", "worldwide", "destination"]],
  [/\bdrive\b|\bdriv(?:er|ing)\b/i, ["driver", "drive", "named", "policyholder"]],
  [/\b(?:don['’]?t|do not|not|never) pay|\bmiss\w* (?:the |a |my )?(?:premium|payment)|\bpay(?:ing)? late\b/i, ["grace", "lapse", "period"]],
  [/\bcan['’]?t (?:walk|bathe|wash|dress|feed|eat|move)|\bcannot (?:walk|bathe|wash|dress|feed|eat|move)|\bdaily living|\badls?\b/i, ["activities", "daily", "living", "severe"]],
  [/\b(?:make|file|submit) (?:a )?claim|\bhow (?:do|to|can) (?:i |we )?(?:make a )?claim/i, ["claim", "submit", "within", "discharge"]],
  [/\bco-?pay\w*/i, ["co-payment", "minimum"]],
];
const STOP = new Set("what which does have with that this much when from about plan policy policies cover covered pays there their would should could also please insurance your mine they them will after before under into over many long need still being were been only here then than some more most right correct true isn't really anything something thing things claim claims paid pay can't cannot does doesn't don't whats what's ends end soonest first next last earliest latest expire expires".split(" "));
const MODAL = /\b(?:not|cannot|can['’]?t|must|only|excluded|exclusion|except|unless|may not|no longer|lapse|will lapse)\b/i;

const stem = (w: string) => {
  let x = w.toLowerCase().replace(/[’']s$/, "").replace(/[^a-z-]/g, "").replace(/^-+|-+$/g, "");
  if (x.length > 4) x = x.replace(/s$/, "");
  if (x.length > 5) x = x.replace(/e$/, "");
  return x.slice(0, 6);
};
function stems(text: string, ignore: Set<string>) {
  return new Set(text.toLowerCase().split(/[^a-z'’-]+/).filter((w) => w.length >= 4 && !STOP.has(w)).map(stem).filter((s) => s.length >= 4 && !ignore.has(s)));
}

export type RuleLine = { text: string; citation: ChatCitation; score: number };
/**
 * Lines that say what the question turns on and the answer does not.
 * `ignore` holds words that only name a plan, a topic or a person.
 */
export function printedRuleLines(question: string, answerText: string, pagesByDoc: Map<string, { page: number; text: string }[]>, docName: (id: string) => string,
  opts: { ignore?: Iterable<string>; limit?: number; sameThingOnly?: boolean } = {}): RuleLine[] {
  // Words that only say which kind of plan is meant ("his term policy", "our travel insurance") are not what is asked.
  const ignore = new Set([...(opts.ignore ?? []), "term", "life", "shield", "hospital", "travel", "accident", "group", "company", "employer", "home", "house", "motor", "integrated", "personal", "annual", "family", "bill"].map(stem));
  for (const id of pagesByDoc.keys()) for (const w of docName(id).split(/[^A-Za-z]+/)) if (w.length >= 4) ignore.add(stem(w));
  let asked = stems(question, ignore);
  const synonyms = new Set<string>();
  for (const [re, extra, same] of DOMAIN_SYNONYMS) if (re.test(question) && (same || !opts.sameThingOnly)) for (const w of extra) synonyms.add(stem(w));
  // Where nothing printed was found for the thing asked, only a line about that same thing will do: the documents' own word
  // for it, or else every word the question turns on ("drive into Malaysia" is not answered by who may drive).
  const needAll = !!opts.sameThingOnly && !synonyms.size;
  if (opts.sameThingOnly && synonyms.size) asked = synonyms; else for (const w of synonyms) asked.add(w);
  if (!asked.size) return [];
  // What the answer already says, without its own label sentence ("Here is what ... documents state about dental cover.").
  const saidText = answerText.replace(/(?:^|\n)(?:Here is what|These are the amounts)[^.\n]*\.(?: Each line shows the page it comes from\.)?/g, "\n");
  const said = stems(saidText, new Set());
  const saidNorm = saidText.toLowerCase().replace(/\s+/g, " ");
  const yesNo = /^\s*(?:so\s+|and\s+|but\s+)?(?:can|could|does|do|is|are|will|would|am|may|must|should)\b|\b(?:right|correct|isn['’]?t it|is it|yes or no|true)\s*\??\s*$/i.test(question);
  const pieces: { docId: string; page: number; line: string; st: Set<string>; section: string | null }[] = [];
  // The heading a line sits under ("GENERAL EXCLUSIONS"): a bullet under it is an exclusion even when it does not say so.
  const sectionOf = (text: string, line: string) => {
    const rows = text.split(/\r?\n/).map((l) => l.trim());
    const at = rows.findIndex((r) => r.length >= 8 && line.startsWith(r.replace(/^[-•*]\s*/, "").slice(0, 24)));
    for (let i = at - 1; i >= 0 && at > 0; i--) if (/[A-Z]{4,}/.test(rows[i]) && rows[i] === rows[i].toUpperCase() && !/\d{3,}/.test(rows[i])) return rows[i];
    return null;
  };
  for (const [docId, pages] of pagesByDoc) for (const p of pages) for (const line of piecesOf(p.text)) {
    if (line.length > 320 || line === line.toUpperCase() || /\((?:fictitious|synthetic)[^)]*\)\s*(?:Page \d+.*)?$/i.test(line) || /DPTEST|^[A-Za-z0-9+/=]{40,}$/.test(line)) continue;
    if (/subject to the general terms of the policy/i.test(line)) continue;
    // An address, a salutation or a table's heading row says nothing about cover.
    if (/^(?:to|from|attn)\s*:|^dear\b|\b(?:street|road|avenue|blk|block)\b.*\d|#\d{2}-\d|\bsingapore \d{6}\b|\b[A-Z]{2,3} \d{4}, [A-Z][a-z]+$/i.test(line)) continue;
    if (/ · /.test(line) && !/(?:S\$|SGD)\s?\d|\b\d+ (?:days?|months?|years?)\b/i.test(line)) continue;
    pieces.push({ docId, page: p.page, line, st: stems(line, ignore), section: sectionOf(p.text, line.replace(/^[-•*]\s*/, "")) });
  }
  const spread = (s: string) => pieces.filter((p) => p.st.has(s)).length || 1;
  const out: RuleLine[] = [];
  for (const p of pieces) {
    const hits = [...asked].filter((s) => p.st.has(s));
    if (!hits.length || needAll && hits.length < asked.size) continue;
    const missed = hits.filter((s) => !said.has(s));
    const rare = hits.filter((s) => spread(s) <= 2 && s.length >= 4);
    const ok = (hits.length >= 2 && (missed.length >= 1 || yesNo && MODAL.test(p.line))) || (hits.length === 1 && missed.length === 1 && rare.length === 1);
    if (!ok) continue;
    if (saidNorm.includes(p.line.toLowerCase().replace(/\s+/g, " ").replace(/[.;\s]+$/, ""))) continue;
    const score = hits.length + rare.length * 0.5 + (MODAL.test(p.line) ? 0.5 : 0) + missed.length * 0.25;
    const listedUnder = p.section && /\bexclu/i.test(p.section) && !/\bexclu/i.test(p.line) ? " — listed under “" + p.section.charAt(0) + p.section.slice(1).toLowerCase() + "”" : "";
    out.push({ text: docName(p.docId) + " — “" + p.line.replace(/^[-•*]\s*/, "").replace(/[.;\s]+$/, "") + "”" + listedUnder + " (page " + p.page + ").", score,
      citation: { chunkId: "page:" + p.docId + ":" + p.page, policyId: p.docId, policyName: docName(p.docId), pageStart: p.page, pageEnd: p.page } });
  }
  const best = out.sort((a, b) => b.score - a.score);
  const top = best.length ? best[0].score : 0;
  return best.filter((x) => x.score >= Math.max(1.75, top - 1)).slice(0, opts.limit ?? 2);
}
