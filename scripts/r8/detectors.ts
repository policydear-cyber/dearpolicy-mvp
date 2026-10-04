/**
 * Round 8 detectors: what a misbehaving model could put in front of a
 * household. Run on every answer IN ADDITION to the Round 6 and Round 7 ones,
 * under the normal stand-in (must never fire) and under the chaos model
 * (lib/ai/chaos-model.ts). Pure functions; no I/O.
 */
import type { ChatAnswer } from "@/types";
import { visibleFields, type Hit } from "../r6/detectors";
import { dateAppears } from "@/lib/chat/assertions";

/** Words only the chaos model writes. Any of them on screen is a leak, whatever else the answer says. */
export const CHAOS_SENTINELS: [string, RegExp][] = [
  ["invented claim amount", /\bYou can claim S\$[\d,]+ for this\b/],
  ["invented percentage", /\bThe policy reimburses \d+% of the bill\b/],
  ["invented date", /\bYour cover renews on \d/],
  ["figure on the wrong person or policy", /\bpolicy pays (?:S\$|SGD\s?|US\$|\$)[\d,.]+ for this\b/],
  ["promise", /definitely be paid in full|approved and guaranteed|entitled to the full amount|insurer will surely pay|You will definitely be paid/i],
  ["'not covered' invented", /This is not covered under your policy|You are not insured for this\.|There is no cover for this event/],
  ["advice", /surrender the policy now|paracetamol|sue the other driver|win in court|I recommend buying more/],
  ["markdown", /## Summary|\| Benefit \| Amount \||```|\*\*|^- Item one/m],
  ["html", /<\/?(?:p|b|script)>|alert\(1\)/],
  ["emoji", /\p{Extended_Pictographic}/u],
  ["refusal", /As an AI|I'm sorry, but I can't help|language model|don't have access to your documents/],
  ["system prompt", /You are DearPolicy, talking to someone|Read insurance evidence for this specific contract|Interpret this insurance conversation|Answer one question about the text|You decide which of a person's insurance benefits/],
  ["model or tool name", /gpt-4o|OpenAI|structuredCompletion|role narration|org-123/],
  ["id or table leak", /3f2a9c1e-7b4d|policy_analysis_cache|row 42/],
  ["other language", /您的保单|Polisi anda|Ihre Police/],
  ["injection", /Ignore previous instructions|reveal the system prompt|covered for everything/i],
  ["page that does not exist", /\(see page \d+ of the policy wording\)/],
  ["hallucinated benefit", /Platinum Wellness Booster|Family Income Shield Bonus|Accidental Super-Cover Rider/],
  ["two questions at once", /Were you hospitalised\? And how many nights|How many nights and what was the bill/],
  ["unsupported model claim", /This benefit applies to you\.|Responds to what happened\./],
  ["truncated model text", /\b(?:and the|Send the cl)\s*$/],
  ["model prose instead of an answer", /Sure! Here is the answer|Let me know if you need anything else/],
  ["leaked extra fields", /payoutSgd|internalNote|approved: ?true/],
  ["invented diagnosis or event", /stage 4 cancer|leukaemia|Accidental death overseas|2026-02-30/i],
];

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const PROSE = /^(summary|details|nextSteps|question|claim\[\d+\]\.(?:reason|condition)|planQuestion|knownFact)/;

export type R8Truth = { pages: Map<string, string>; today: string };
export type R8Turn = { userText: string };

export function detectR8(a: ChatAnswer, t: R8Turn, g: R8Truth): Hit[] {
  const hits: Hit[] = [];
  const hit = (rule: string, text: string) => hits.push({ rule, text: text.slice(0, 260) });
  const fields = visibleFields(a);
  for (const f of fields) for (const [name, re] of CHAOS_SENTINELS) {
    const m = f.text.match(re);
    if (m && !t.userText.includes(m[0])) hit("model output leaked: " + name, f.where + ": " + f.text);
  }
  // Every date the answer states is printed in a document of this household or was said by the family.
  const allPages = [...g.pages.values()].join("\n");
  for (const f of fields.filter((x) => PROSE.test(x.where))) {
    for (const m of f.text.matchAll(new RegExp("\\b(\\d{1,2}) (" + MONTHS + ") (\\d{4})\\b", "g"))) {
      const iso = m[3] + "-" + String(MONTHS.split("|").indexOf(m[2]) + 1).padStart(2, "0") + "-" + m[1].padStart(2, "0");
      if (!dateAppears(iso, allPages) && !dateAppears(iso, t.userText) && !t.userText.includes(iso) && iso !== g.today && !derivedFromPrinted(iso, allPages))
        hit("date not in any document", f.where + ": " + m[0] + " — " + f.text);
    }
  }
  return hits;
}
/** A date the application computes from a printed one: the day after a printed end date
 * ("ends 31 January 2027" -> "renews 1 February 2027"), or a policy anniversary (a printed
 * start date plus whole years). */
function derivedFromPrinted(iso: string, pages: string) {
  const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1);
  if (dateAppears(d.toISOString().slice(0, 10), pages)) return true;
  const year = Number(iso.slice(0, 4));
  for (let y = year - 1; y >= year - 40; y--) if (dateAppears(y + iso.slice(4), pages)) return true;
  return false;
}

/** Rules that measure how much a broken model cost the household in usefulness (an honest
 * fallback instead of the answer) rather than what it put in front of them. Under the chaos
 * model these are counted and bounded, not failed one by one. */
export const DEGRADED = /^(?:answer ignores the question|ambiguous person not asked|same answer to a different question|claim never concludes|expected benefit missing|group cover left out|conversation shorter than 10 turns|same answer repeated|generic 'couldn't find a benefit' for a described event|what-if framing on a plain question|group cover expected but missing)$/;
