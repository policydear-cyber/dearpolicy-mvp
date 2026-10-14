/**
 * Topic words shared between what the household asked and what a benefit is about (its label, product and printed
 * conditions). Used to choose the ONE question a condition needs (V1.4) and, from V1.5, which documented facts a
 * limit-stopped turn may still show and which printed wording person_benefits returns first. A synonym class maps the
 * household's words onto the documents' words ("passed away" / "died" -> death; "crash" -> accident; "broke" ->
 * fracture; "warded" -> hospital); "life" (Term Life) is a death benefit.
 */
export const STEM_SYN: [RegExp, string][] = [
  [/^(?:die|dies|died|dying|death|deaths|dead|deceased|killed|fatal|fatally|life)$/, "death"],
  [/^(?:accident|accidents|accidental|accidentally|crash|crashed|collision)$/, "accident"],
  [/^(?:injury|injuries|injured|injure)$/, "injury"],
  [/^(?:diagnosis|diagnosed)$/, "diagnosis"],
  [/^(?:fracture|fractures|fractured|broke|broken|break|bone|bones)$/, "fracture"],
  [/^(?:hospital|hospitalisation|hospitalization|hospitalised|hospitalized|warded|admitted|inpatient|confinement|confined)$/, "hospital"],
];
const GEN = new Set(["insured", "person", "result", "within", "days", "day", "benefit", "benefits", "payable", "sum", "that", "this", "with", "from", "will", "shall", "pay", "policy", "the", "and", "for", "group", "public", "service", "scheme", "plan", "cover", "what", "can", "how", "much", "does", "are", "his", "her", "him", "they", "our", "your", "you", "was", "were", "has", "have", "had", "after", "while", "into", "amount", "amounts", "certificate", "insurance", "claim", "claims", "explain", "next", "steps", "step", "also", "both", "date", "dates", "happened", "october", "january", "february", "march", "april", "june", "july", "august", "september", "november", "december"]);
export function topicStems(t: string): Set<string> {
  return new Set((t.toLowerCase().replace(/\bpass(?:ed|es)? away\b/g, "died").match(/[a-z]+/g) ?? []).filter((w) => w.length >= 3 && !GEN.has(w)).map((w) => STEM_SYN.find(([re]) => re.test(w))?.[1] ?? w.replace(/(?:ies|es|s|ed|ing|al|ly)$/, "").slice(0, 6)));
}
export const sharedTopic = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w));
