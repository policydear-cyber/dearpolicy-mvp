/** Which of a person's benefit-table rows (lib/benefit-table) answer one Home tile or Coverage page category, and the
 * figure to show for it. Pure, and for any household: it reads only the benefit names and figures the person's own
 * documents print, never a scheme, product or insurer named in code. A category no row names stays as before. */
import { rowDetail, shortFigure, type SummaryRow } from "@/lib/benefit-table/headline";
import { MONEY_SIGN, normalizeCurrencyCode } from "@/lib/format/currency";
import { canonicalInsurer } from "@/lib/policies/insurer-name";

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
/** An accident or injury word in a name, "AD&D" included. */
const ACCIDENT_WORD = new RegExp(String.raw`\b${ACC}|\bad\s?&\s?d\b`, "i");
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

/** A section that is accident cover as a whole: "Personal accident", or one that starts with accident words ("Accidental
 * Benefits"). A section that only mentions an accident ("Death and Accidental Death") is not. */
const ACCIDENT_SECTION = new RegExp(String.raw`\bpersonal\s+accident\b|^\W*(?:(?:benefit|section|part)\s+\w+\W+)?(?:the\s+)?${ACC}`, "i");

/** The one category a benefit name belongs to, or null. A name matching several takes the first in NAMES. A death or
 * disability row printed under an accident section ("Personal accident", "Group Personal Accident") is accident cover
 * whatever its own name says: a travel policy's "Total and permanent disability" under "Personal accident" pays only on an
 * accident (live 31357e4: it joined the TPD tile and cleared its figure). */
export function categoryOfBenefit(benefit: string, section?: string | null): string | null {
  const category = NAMES.find(([name, re]) => re.test(benefit) && !(name === "Personal Accident" && causeOf(benefit) !== "accident"))?.[0] ?? null;
  // A name that says it pays on any cause keeps its own category under any section (Critic R238).
  if ((category === "Death" || category === "Total Permanent Disability") && section && ACCIDENT_SECTION.test(section) && causeOf(benefit) !== "any"
    && causeOf(section) === "accident") return "Personal Accident";
  return category;
}

/** A premium the person pays, never a benefit (chat.ts's PREMIUM_ROW). */
const PREMIUM = /^(?!.*\b(?:waiv|return|refund)\w*).*\bpremiums?\b/i;
/** The person's rows for the category: rows that pay something the person holds, never a projection, a fund or
 * surrender value ("Death benefit fund value"), a premium, or a row the document marks not covered (Critic R225). Nor a
 * limit on what several benefits pay together, which is no cover of its own, or a row of a short-term cover whose term
 * has ended (a single trip that is over): both are marked when the table is put together (lib/benefit-table/assemble.ts). */
export function categoryRows<T extends SummaryRow>(category: string, rows: T[]): T[] {
  return rows.filter((r) => r.figure.kind !== "projected" && r.figure.kind !== "value" && r.pays !== "value" && r.pays !== "not_covered"
    && !r.combinedLimit && !r.coverEnded && !PREMIUM.test(r.benefit) && categoryOfBenefit(r.benefit, r.section) === category);
}

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
const WAIVER = /\bwaiv\w*\s+(?:of\s+)?(?:future\s+)?premiums?\b|\bpremiums?\s+waiv/i;

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
export type ConfirmedLine = { documentIds: string[]; amount: number | null; currency: string };
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
export type HeldCover = { coverKey: string; holding?: string; name: string; documentId: string | null; sumInsured: number | null; currency?: string | null };
/** One policy's part of a lump-sum tile. `accelerates`: the cover pays its sum early out of a death benefit (its own words
 * say it accelerates), so it is paid instead of that death benefit, never on top of it (Evidence Reviewer, 27 Oct). */
export type TilePart = { name: string; amount: number | null; currency: string | null; accelerates?: boolean; conditional?: boolean };
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
export function lumpSumParts(rows: TileRow[], lines: (ConfirmedLine & { name: string })[], held: HeldCover[] = [], category?: string): { parts: TilePart[]; total: number | null } {
  const covers = [...coversOf(rows)].filter(([, list]) => !list.every((r) => r.pays === "not_covered")).map(([key, list]) => {
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
    return { key, coverKey: list[0].coverKey, docs: coverDocs(key, list, held), holding: list[0].holding, sum, accelerates, conditional, part: { name: partName(own[0]?.name || list[0].cover || list[0].product || "Policy"),
      amount: fits ? one!.amount : null, currency: fits ? one!.currency : null, ...(accelerates ? { accelerates } : {}), ...(fits && conditional ? { conditional } : {}) } as TilePart };
  });
  // Where the person holds several policies of a cover type here (printed policy numbers differ), each held policy is a
  // part, even one whose own document gives this tile no row: it is named with no amount, never left out (Critic R258 H2).
  const split = new Set(covers.filter((c) => c.holding).map((c) => c.coverKey));
  for (const h of held) {
    const key = policyOf(h)!;
    if (!split.has(h.coverKey) || covers.some((c) => c.key === key)) continue;
    covers.push({ key, coverKey: h.coverKey, docs: new Set(h.documentId ? [h.documentId] : []), holding: h.holding, sum: h.sumInsured, accelerates: false,
      conditional: false, part: { name: partName(h.name), amount: null, currency: null } });
  }
  // A different printed number does not prove a second policy: a renewal, a scheme's group number beside a certificate
  // number, or an endorsement can re-number one policy (Critic R258 H1). Such parts are listed, never added up.
  let unsure = split.size > 0;
  const taken = new Set<(typeof covers)[number]>();
  const lineCover = new Map<ConfirmedLine, (typeof covers)[number]>();
  for (const l of lines) {
    const same = covers.filter((c) => !taken.has(c) && l.documentIds.some((d) => c.docs.has(d)));
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
    const c = categoryOfBenefit(l.name);
    return c ? c !== category : category !== "Personal Accident" && ACCIDENT_WORD.test(l.name);
  };
  const parts: TilePart[] = [...lines.map((l) => ({ name: l.name, amount: elsewhere(l) ? null : l.amount, currency: elsewhere(l) ? null : l.currency,
    ...(lineCover.get(l)?.accelerates ? { accelerates: true } : {}),
    ...(!elsewhere(l) && l.amount != null && lineCover.get(l)?.conditional ? { conditional: true } : {}) })),
    ...covers.filter((c) => !taken.has(c)).map((c) => c.part)];
  // One cover read under two names ("Group Term Life" and "GTL") with the same sum is not added twice (R247 Q3).
  const words = (n: string) => productWords(n.replace(/\([^)]*\)/g, " ")).join(" ");
  if (parts.some((a, i) => parts.some((b, j) => j > i && a.amount != null && a.amount === b.amount && a.currency === b.currency
    && !!words(a.name) && words(a.name) === words(b.name)))) unsure = true;
  const currencies = new Set(parts.map((p) => p.currency));
  const total = !unsure && parts.length && parts.every((p) => p.amount != null) && currencies.size === 1 ? parts.reduce((t, p) => t + p.amount!, 0) : null;
  return { parts, total };
}

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
