/**
 * Round 15: a word typed a letter or two wrong ("endownment premuim",
 * "carshield premum", "equlife endorsment", "denta limit") is read as the
 * insurance word or the household's own plan name it was meant to be, so the
 * question is answered rather than "not found". Only words of the insurance
 * vocabulary and the names on the household's own documents are corrected --
 * never an everyday English word -- and only within a small edit distance,
 * with the same first letter. The message is still shown as typed.
 */

/** Insurance words households ask about, as they are spelt in documents. */
const TERMS = [
  "premium", "premiums", "endowment", "endorsement", "insurance", "insurer", "hospital", "hospitalisation", "hospitalised", "dental", "coverage", "covered",
  "deductible", "coinsurance", "co-insurance", "outpatient", "inpatient", "accident", "accidental", "critical", "illness", "maturity", "matures", "surrender",
  "nominee", "nomination", "beneficiary", "reinstatement", "reinstated", "lapsed", "renewal", "renews", "expiry", "expires", "schedule", "certificate",
  "statement", "receipt", "rider", "waiting", "survival", "disability", "disablement", "permanent", "permanently", "benefit", "benefits", "limit", "limits",
  "assured", "travel", "baggage", "luggage", "curtailment", "cancellation", "policy", "policies", "claim", "claimable", "careshield", "medishield", "eldershield",
  "medisave", "integrated", "personal", "investment", "payout", "dependant", "dependants", "employee", "spouse", "children", "consultation", "specialist",
  "physiotherapy", "chiropractic", "maternity", "emergency", "evacuation", "repatriation", "terminal", "guaranteed", "bonus", "bonuses", "annual", "monthly",
  "quarterly", "exclusion", "exclusions", "pre-existing", "ward", "intensive", "surgery", "surgical", "diagnosed", "diagnosis", "cancer", "stroke", "dengue",
];

function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  const prev2 = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v; if (v < best) best = v;
    }
    if (best > max) return max + 1;
    for (let j = 0; j <= b.length; j++) { prev2[j] = prev[j]; prev[j] = cur[j]; }
  }
  return prev[b.length];
}

/** Everyday words a typo rule must never touch (they are near insurance words but mean something else). */
const KEEP = new Set(["insured", "insure", "insures", "insuring", "ensure", "ensured", "assure", "injured", "injure", "injury", "injuries", "inured", "policyholder", "planned", "dentist", "dentists", "renew", "renewed", "expired", "expire", "expiring", "lapse", "lapses", "limiting", "covering", "claiming", "benefited", "traveling", "travelling", "hospitalized", "schedules", "survive", "survived", "waited", "premiere", "permanence", "personnel", "personally", "annually", "spousal", "terminally", "terminate", "terminated", "statement", "certified", "reinstate", "bones", "bonuses", "exclude", "excluded", "excludes", "inpatients", "evacuate", "repatriate", "surgeon", "surgeons", "diagnose", "stroked", "claimant", "claimants", "claimer", "policy", "police", "polish", "polishing", "premise", "premises", "primary", "private", "benefit", "limited", "travels", "travelled", "hospitality",
  "claims", "claimed", "covers", "cover", "coverd", "rider", "riders", "ride", "wider", "older", "under", "order", "spouses", "children", "child", "child's", "dental", "mental",
  "rental", "termed", "terms", "assure", "assured", "annually", "annual", "months", "monthly", "waiting", "writing", "wanting", "bonus", "bones", "boons", "surgery", "sugary",
  "stroke", "strike", "strokes", "cancer", "cancel", "canceled", "cancelled", "ward", "word", "work", "warded", "worded", "limit", "limits", "limb", "limbs", "travel",
  "personal", "personnel", "dengue", "tongue", "accident", "accidents", "incident", "incidents", "integrated", "intended", "statement", "statements", "settlement",
  "receipt", "recipe", "receive", "renewal", "removal", "renews", "reviews", "review", "expires", "express", "lapsed", "lapses", "passed", "relapsed", "matures", "natures"]);

/** Short forms households type ("hosp?", "prem", "endow"): the word they stand for. */
const SHORT: [RegExp, string][] = [[/\bhosp\b\.?/gi, "hospital"], [/\bprem\b\.?/gi, "premium"], [/\bendow\b\.?/gi, "endowment"], [/\breimb\b\.?/gi, "reimbursement"], [/\bpol\b\.?(?=\s*(?:no|number|#))/gi, "policy"]];
export function correctTypos(text: string, names: string[] = []): string {
  for (const [re, word] of SHORT) text = text.replace(re, word);
  // Plan and insurer names on the household's own documents, word by word ("EquaLife", "SecureCare", "WanderSafe").
  const own = [...new Set(names.flatMap((n) => n.split(/[^\p{L}\p{N}-]+/u)).filter((w) => w.length >= 5 && !/\d/.test(w)).map((w) => w.toLowerCase()))];
  const vocabulary = [...new Set([...TERMS, ...own])];
  const ownSet = new Set(own.filter((w) => !TERMS.includes(w)));
  const known = new Set(vocabulary);
  return text.replace(/[\p{L}][\p{L}'’-]{3,}/gu, (word) => {
    const w = word.toLowerCase();
    if (known.has(w) || KEEP.has(w) || /['’]/.test(w)) return word;
    // An inflection of a known word ("hospitals", "claimed", "covering") is that word, spelt right.
    if (vocabulary.some((v) => w.startsWith(v) && /^(?:s|es|d|ed|ing|ly|al)$/.test(w.slice(v.length)))) return word;
    const max = w.length >= 8 ? 2 : 1;
    let best: string | null = null, bestD = max + 1, tie = false;
    for (const v of vocabulary) {
      if (v[0] !== w[0] || Math.abs(v.length - w.length) > max) continue;
      // A short word only fixes to a word of about its own length ("denta" -> "dental", never "dent" -> "dental").
      if (w.length <= 5 && v.length < w.length) continue;
      // A plan's own name is only a fix for a misspelling of it, never for an everyday word it extends ("year" is not "Years").
      if (ownSet.has(v) && (w.length < 5 || v.startsWith(w) || w.startsWith(v))) continue;
      // A word that is the start of an insurance word and long enough to be a word of its own ("guarantee", "cover") is left alone.
      if (v.startsWith(w) && w.length >= 6) continue;
      const d = distance(w, v, max);
      if (d < bestD) { best = v; bestD = d; tie = false; } else if (d === bestD && best !== v) tie = true;
    }
    if (!best || bestD > max || tie) return word;
    // A plan name keeps the household's own capitals as typed elsewhere ("equlife" -> "equalife").
    return word[0] === word[0].toUpperCase() ? best.charAt(0).toUpperCase() + best.slice(1) : best;
  });
}
