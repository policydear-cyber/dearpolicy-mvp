/**
 * Round 15: questions about the household's documents and policies as a set --
 * answered from what was read at upload (insurer, product, policy number,
 * kind of cover, the people each policy covers, its dates, page count), not
 * from a search of the pages.
 *
 *   - "Which document is the newest?", "oldest policy", "latest policy change",
 *     "which EquaLife document is newest?": the documents in date order.
 *   - "How many policies do I have?", "how many documents for EquaLife?",
 *     "how many pages is my travel document?": counted.
 *   - "Which insurer is my dental rider with?", "are Plus and Pro with the same
 *     insurer?": the insurer each document names.
 *   - "Which policies cover me?", "which of my kids have insurance?", "what
 *     policies does Farah have?", "list all our policies", "does my group plan
 *     cover my dad?": who each policy covers, as the documents name them.
 *   - "Which policies end in the next 6 months?": the printed end dates.
 *   - "How old is my father?": from the date of birth on the household page.
 *
 * Plain code over stored rows: every policy named is cited at its first page.
 * Several documents about one policy (a schedule and its endorsement, a lapse
 * notice and a reinstatement letter, a premium receipt) count as one policy.
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import type { ClaimPerson } from "@/lib/claims/person";
import type { ChatCitation } from "@/types";
import { inactiveDocuments } from "./policy-status";
import { replacedFigures } from "@/lib/policies/amendments";

export type RegistryAnswer = { summary: string; details: string[]; citations: ChatCitation[]; personId: string | null; topic?: string; asked?: string;
  /** The chat's topic stays what it was (a date asked about the plan the chat is on). */
  keepTopic?: boolean };

type Doc = {
  id: string; file: string; role: string | null; product: string | null; insurer: string | null; number: string | null; groupNumber: string | null; kind: string | null;
  pages: number | null; start: string | null; end: string | null; dated: string | null; paid: string | null; owners: string[]; uploadedTo: string; created: string; superseded: boolean; currencies: string[];
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return d + " " + MONTHS[m - 1] + " " + y; };
const listOf = (xs: string[]) => xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs.at(-1);
const personName = (p: ClaimPerson) => p.preferred_name?.trim() || p.display_name;
const isSelf = (p: ClaimPerson) => /^self$/i.test(p.relationship ?? "");
const cleanInsurer = (name: string | null) => name ? name.replace(/\s*\((?:fictitious|synthetic)[^)]*\)\s*/gi, " ").trim() : null;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Roles of papers that are about a policy without being its cover (a receipt, a letter, a notice). */
const PAPER_ROLES = /^(?:premium_receipt|insurer_letter|other|claim_decision|medical_bill|app_screenshot|personal_notes|renewal_notice)$/;
const ROLE_NAME: Record<string, string> = {
  personal_schedule: "policy schedule", certificate: "certificate", endorsement: "endorsement", annual_statement: "annual statement", premium_receipt: "premium receipt",
  insurer_letter: "letter from the insurer", other: "notice", benefit_guide: "benefit guide", policy_wording: "policy wording", product_summary: "product summary", renewal_notice: "renewal notice",
};
/** What a kind of cover is called in a question, and the words a document's kind or product carries for it. */
const KINDS: { asked: RegExp; doc: RegExp; label: string }[] = [
  { asked: /\btravel\b|\btrip\b/i, doc: /travel|trip/i, label: "travel insurance" },
  { asked: /\bdental\b|\bdenta\b|\boutpatient\b|\brider\b/i, doc: /dental|outpatient|rider/i, label: "rider" },
  { asked: /\blong[- ]term care\b|\bcareshield\b|\beldershield\b/i, doc: /long-term care|careshield|eldershield/i, label: "long-term care scheme" },
  { asked: /\bhospital\b|\bhealth\b|\bshield\b|\bmedical\b|\bhosp\b/i, doc: /\bhealth\b|hospital|\bshield\b|integrated/i, label: "hospital plan" },
  { asked: /\bcritical illness\b|\bci\b/i, doc: /critical illness/i, label: "critical illness plan" },
  { asked: /\bpersonal accident\b|\bpa\b|\baccident\b/i, doc: /accident/i, label: "personal accident plan" },
  { asked: /\bendowment\b|\bsavings?\b/i, doc: /endowment/i, label: "endowment" },
  { asked: /\bilp\b|\binvestment\b/i, doc: /investment/i, label: "investment-linked policy" },
  { asked: /\bgroup\b|\bcompany\b|\bemployer\b|\bemployee\b|\bwork\b|\boffice\b/i, doc: /\bgroup\b|employee/i, label: "group plan" },
  { asked: /\bhome\b|\bhouse\b|\bcontents\b/i, doc: /\bhome\b|contents/i, label: "home insurance" },
  { asked: /\bmotor\b|\bcar\b|\bvehicle\b/i, doc: /motor|car\b|vehicle/i, label: "motor insurance" },
  { asked: /\blife\b|\bterm\b|\bwhole life\b/i, doc: /\blife\b|\bterm\b/i, label: "life policy" },
];
const COMMON = /^(?:plan|policy|policies|insurance|integrated|personal|annual|whole|life|shield|care|cover|term|the|and|plus|pro|group|employee|benefits?|single|trip|multi|worldwide|accident|critical|illness|early|rider|health|outpatient|dental|universal|joint|protect\w*|secure\w*|assurance|insurer|ltd|pte|berhad|branch|singapore|general|mutual|international)$/i;

async function loadDocs(accountId: string): Promise<Doc[]> {
  const rows = (await query<{ id: string; file: string | null; role: string | null; product: string | null; insurer: string | null; number: string | null; group_number: string | null; kind: string | null;
    pages: number | null; start: string | null; end_date: string | null; dated: string | null; paid: string | null; owners: string[] | null; uploaded_to: string; created: string; superseded: boolean; currencies: string[] | null }>(
    `SELECT p.id::text, p.original_filename AS file, p.document_role AS role, p.product_name AS product, p.insurer, p.policy_number AS number, p.group_policy_number AS group_number,
            p.policy_type AS kind, p.page_count AS pages, p.effective_date::text AS start, p.renewal_or_expiry_date::text AS end_date, p.document_date::text AS dated,
            (SELECT max(pr.payment_date)::text FROM premium_records pr WHERE pr.source_document_id=p.id AND pr.account_id=p.account_id) AS paid,
            ARRAY(SELECT pm.family_member_id::text FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id) AS owners,
            p.family_member_id::text AS uploaded_to, p.created_at::text AS created, p.superseded_at IS NOT NULL AS superseded,
            ARRAY(SELECT DISTINCT upper(c) FROM (SELECT pc.currency c FROM policy_coverages pc WHERE pc.policy_id=p.id UNION ALL SELECT pr.currency FROM premium_records pr WHERE pr.source_document_id=p.id OR pr.policy_id=p.id) x WHERE c IS NOT NULL) AS currencies
       FROM policies p WHERE p.account_id=$1 AND ${activePredicate("p")} AND p.processing_status='ready' ORDER BY p.created_at, p.id`, [accountId]).catch(() => ({ rows: [] }))).rows;
  return rows.map((r) => ({ id: r.id, file: r.file ?? "Document", role: r.role, product: r.product, insurer: cleanInsurer(r.insurer), number: r.number, groupNumber: r.group_number, kind: r.kind,
    pages: r.pages, start: r.start, end: r.end_date, dated: r.dated, paid: r.paid, owners: r.owners?.length ? r.owners : [r.uploaded_to], uploadedTo: r.uploaded_to, created: r.created, superseded: !!r.superseded, currencies: r.currencies ?? [] }));
}

const policyKey = (d: Doc) => (d.number ?? d.groupNumber ?? d.product ?? d.file).toLowerCase().replace(/[^a-z0-9]+/g, "");
const isPaper = (d: Doc) => PAPER_ROLES.test(d.role ?? "");
/** The date a document carries: its own printed date, the payment it records, or the date its cover starts. */
const dateOf = (d: Doc) => d.dated ?? d.paid ?? d.start;
const describe = (d: Doc) => (d.product ?? d.file) + (d.role && ROLE_NAME[d.role] ? " " + ROLE_NAME[d.role] : "");
const cite = (d: Doc): ChatCitation => ({ chunkId: "page:" + d.id + ":1", policyId: d.id, policyName: d.product ?? d.file, insurer: d.insurer ?? undefined, pageStart: 1, pageEnd: 1, documentRole: d.role });

/** Distinctive words of a product or insurer name ("EquaLife", "SecureCare", "WanderSafe", "Plus"). */
function nameTokens(d: Doc): string[] {
  // Only the words that name this product or insurer, not everyday words in its name ("TravelSafe Annual Family" is not
  // asked about by "my family"): a coined word ("EquaLife", "SecureCare"), a word with a figure, or a name's first word.
  const words = (n: string | null) => (n ?? "").split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 3 && !/^\d+$/.test(t));
  const product = words(d.product), insurer = words(d.insurer);
  const coined = (t: string) => /\p{Ll}\p{Lu}/u.test(t) || /\d/.test(t);
  return [...new Set([...product.filter(coined), ...insurer.filter(coined), ...[product[0], insurer[0]].filter((t): t is string => !!t && t.length >= 5 && /^\p{Lu}/u.test(t) && !COMMON.test(t))])];
}
/** The documents a question points at by name or by kind of cover; null when it names none. */
function pointedDocs(text: string, docs: Doc[]): Doc[] | null {
  const lower = text.toLowerCase();
  const byName = docs.filter((d) => nameTokens(d).some((t) => !COMMON.test(t) && new RegExp("\\b" + esc(t.toLowerCase()) + "\\b").test(lower)));
  // "Plus and Pro": the variant words of products that share their other words.
  const variants = docs.filter((d) => (d.product ?? "").split(/[^\p{L}\p{N}]+/u).some((t) => /^(?:plus|pro|lite|max|prime|gold|silver|basic|premier)$/i.test(t) && new RegExp("\\b" + t.toLowerCase() + "\\b").test(lower)));
  const named = [...new Set([...byName, ...variants])];
  if (named.length) return named;
  const kinds = KINDS.filter((k) => k.asked.test(text));
  if (!kinds.length) return null;
  const hit = docs.filter((d) => kinds.some((k) => k.doc.test((d.kind ?? "") + " " + (d.product ?? ""))));
  return hit.length ? hit : null;
}

/** The family members a question names outright (a name, or "my wife", "dad", "the kids"). */
function namedPeople(text: string, family: ClaimPerson[]): ClaimPerson[] {
  const lower = " " + text.toLowerCase().replace(/['’]s\b/g, " ").replace(/[^\p{L}\p{N}' ]+/gu, " ") + " ";
  const byName = family.filter((p) => [p.preferred_name ?? "", p.display_name].some((n) => n.trim().length >= 3 && lower.includes(" " + n.toLowerCase().trim() + " ")));
  if (byName.length) return byName;
  // One word of a full name that only one person in the household has (a given name or a family name).
  const token = (w: string) => w.length >= 4 && !/^(?:binte?|bin|binti|nur|siti|mohd|muhammad|abdul)$/.test(w.replace(/['’-]/g, ""));
  const byWord = family.filter((p) => p.display_name.toLowerCase().split(/\s+/).filter(token).some((w) => lower.includes(" " + w + " ")));
  if (byWord.length === 1 && !family.some((q) => q !== byWord[0] && q.display_name.toLowerCase().split(/\s+/).filter(token).some((w) => lower.includes(" " + w + " ")))) return byWord;
  const rel = (re: RegExp) => family.filter((p) => re.test(p.relationship ?? ""));
  if (/\b(?:kids?|children|child|sons?|daughters?)\b/i.test(text)) return rel(/^(?:child|son|daughter)$/i);
  if (/\b(?:wife|husband|spouse)\b/i.test(text)) return rel(/^(?:spouse|wife|husband)$/i);
  if (/\b(?:dad|father|papa|mum|mom|mother|mama|parents?|bapa|ibu)\b/i.test(text)) return rel(/^(?:parent|father|mother)$/i);
  // Any other relationship the household page records ("our helper", "my sister", "grandma").
  const byRelation = family.filter((p) => { const r = (p.relationship ?? "").toLowerCase().trim(); return r.length >= 3 && !/^(?:self|other)$/.test(r) && new RegExp("\\b" + r.replace(/[^a-z ]/g, "") + "s?\\b", "i").test(text); });
  return byRelation;
}

const RECENCY = /\b(?:newest|latest|most recent|recent|oldest|earliest|newer|older)\b/i;
const DOC_WORDS = /\b(?:documents?|docs?|papers?|letters?|uploads?|files?|polic(?:y|ies)|plans?|changes?|endorsements?|statements?|receipts?|one)\b/i;
const MONEY_WORDS = /\b(?:premium|pay|paid|cost|bonus|fund|value|claim\w*|cover(?:ed|age)?|benefit|sum|limit|how much)\b/i;
const COUNT = /\bhow many\s+(?:different\s+)?(polic(?:y|ies)|plans?|documents?|docs?|uploads?|files?|papers?|pages?)\b/i;
const INSURER_ASK = /\b(?:which|what|who(?:['’]s| is)?)\s+(?:is\s+)?(?:the\s+)?(?:insurer|insurance company|company|provider)\b|\binsurer is\b[^?]{0,40}\bwith\b|\bwhich insurer\b|\b(?:with|from) (?:which|what) (?:insurer|company)\b|\bsame insurer\b|\bsame (?:insurance )?company\b|\bwho (?:is it|are they) with\b/i;
const LIST_POLICIES = /^\s*(?:(?:ok(?:ay)?|so|and|pls|please)[,\s]+)*(?:(?:can you\s+)?(?:list|show)(?: me)?\s+(?:all\s+)?(?:of\s+)?(?:the\s+)?(?:our|my|the(?: family['’]s)?|family|all)?\s*(?:family\s+)?(?:policies|plans|insurance|documents|uploads|files)|what (?:policies|plans|insurance|documents|uploads|files) (?:do|does|have|has|are)\b|which (?:policies|plans|documents) (?:do|does|have|has|are|cover|is|on)\b)/i;
const WHICH_COVER = /\b(?:which|what) (?:of (?:my|our) )?(?:policies|plans|insurance|documents)\b[^?]{0,30}\b(?:cover|covers|insure|insures|protect)\b|\bwhich of (?:my|our|the) (?:kids|children|family|sons|daughters|family members)\b[^?]{0,20}\b(?:have|has|got|are)\b[^?]{0,20}\b(?:insurance|insured|cover(?:ed)?|polic(?:y|ies)|plans?)\b|\b(?:what|which) (?:policies|plans|insurance) (?:does|do|has|have|is)\b|\bdoes\s+\S+(?:\s+\S+)?\s+have (?:any )?(?:insurance|polic(?:y|ies)|plans?|cover)\b/i;
const ENDING_SOON = /\b(?:which|what|any|anything)\b[^?]{0,30}\b(?:end|ends|ending|expire|expires|expiring|due for renewal|lapse|renew\w*)\b[^?]{0,20}\b(?:next|within|in the next|coming|soon|this year)\b/i;
const HOW_OLD = /^\s*(?:so\s+|and\s+)?how old (?:is|will) ([\p{L} '’-]{2,40}?)(?: (?:be|now|this year|turning))?\s*\??\s*$/iu;

export async function registryAnswer(args: { accountId: string; question: string; family: ClaimPerson[]; people: ClaimPerson[]; today?: Date; previous?: string | null; ambiguous?: boolean }): Promise<RegistryAnswer | null> {
  if (args.ambiguous) return null;
  const asked = args.question.trim();
  // "and next year?", "and the oldest?" right after one of these questions: the same question, with what this message changes.
  const followUp = !!args.previous && asked.split(/\s+/).length <= 5 && /^\s*(?:(?:ok(?:ay)?|so)[,\s]+)?(?:and|what about|how about|then)\b/i.test(asked);
  const text = followUp ? args.previous!.replace(/\b(?:newest|latest|most recent|oldest|earliest)\b/gi, (w) => /\b(?:newest|latest|most recent|oldest|earliest)\b/i.test(asked) ? "" : w)
    .replace(/\b(?:this year|next year|(?:in )?the next \d{1,2}\s*months?|within \d{1,2}\s*months?)\b/gi, (w) => /\b(?:this year|next year|\d{1,2}\s*months?)\b/i.test(asked) ? "" : w) + " " + asked : asked;
  if (!text || text.split(/\s+/).length > 25) return null;
  const today = args.today ?? new Date();
  const todayIso = today.toISOString().slice(0, 10);
  // "Should I keep the oldest policy?" asks for advice; "what if" imagines something.
  if (/\b(?:should (?:i|we)|worth (?:it|keeping)|recommend|advi[cs]e|better|best|good|cheap\w*|what if|suppose)\b/i.test(text)) return null;
  // A request for the chat to do something ("can you email me the receipt", "renew it for me") is not a question about the documents.
  if (/^\s*(?:(?:please|pls|can you|could you|would you|will you|help me(?: to)?|kindly)[,\s]+)*(?:e-?mail|send|forward|print|fax|book|renew|cancel|pay|remind|set (?:up )?a|whatsapp|share)\b/i.test(text)) return null;
  // Someone outside the household ("the household next door", "my friend's policies") is not answered from this one's documents.
  if (/\b(?:next door|neighbou?rs?|other household|another (?:household|family)|someone else|friends?|colleagues?|boss|cousins?|uncles?|aunts?|in-laws?)\b/i.test(text)) return null;
  // A relation the household page doesn't record ("our helper" with no helper on file) is the person resolver's to say.
  const RELATION = /\b(?:helper|maid|brother|sister|grand(?:ma|pa|mother|father|son|daughter)|nephew|niece|son-in-law|daughter-in-law)\b/i;
  if (RELATION.test(text) && !namedPeople(text, args.family).length) return null;
  // "Which policies have ended?", "which are still active?": the status of each, answered from its printed dates and letters.
  if (/\b(?:ended|expired|lapsed|active|in force|cancel+ed|terminated|still valid|still running)\b/i.test(text) && !/\bnext\b|\bwithin\b|\bcoming\b|\bthis year\b|\bnext year\b/i.test(text)) return null;

  // How old someone is, from the household page.
  const old = text.match(HOW_OLD);
  if (old) {
    const who = namedPeople(old[1], args.family);
    const person = who.length === 1 ? who[0] : /^(?:i|me)$/i.test(old[1].trim()) ? args.family.find(isSelf) : null;
    if (person) {
      const dob = (await query<{ dob: string | null }>(`SELECT fm.date_of_birth::text AS dob FROM family_members fm WHERE fm.id=$1 AND fm.account_id=$2 AND ${activePredicate("fm")}`, [person.id, args.accountId]).catch(() => ({ rows: [] }))).rows[0]?.dob;
      if (dob) {
        const [y, m, d] = dob.split("-").map(Number);
        let age = today.getUTCFullYear() - y; if (today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d)) age--;
        // The document that prints this date of birth, cited, when one does.
        const [yy, mm, dd] = dob.split("-");
        const forms = [longDate(dob), String(Number(dd)).padStart(2, "0") + " " + MONTHS[Number(mm) - 1] + " " + yy, dd + "/" + mm + "/" + yy, String(Number(dd)) + "/" + String(Number(mm)) + "/" + yy, dob,
          String(Number(dd)) + " " + MONTHS[Number(mm) - 1].slice(0, 3) + " " + yy];
        const printed = (await query<{ id: string; product: string | null; insurer: string | null; role: string | null; page: number; text: string }>(
          `SELECT p.id::text, p.product_name AS product, p.insurer, p.document_role AS role, pp.page_number AS page, pp.text FROM policy_pages pp JOIN policies p ON p.id=pp.policy_id
            WHERE p.account_id=$1 AND ${activePredicate("p")} AND p.processing_status='ready' AND EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.family_member_id=$2) ORDER BY p.created_at, pp.page_number`,
          [args.accountId, person.id]).catch(() => ({ rows: [] }))).rows.find((r) => forms.some((f) => r.text.toLowerCase().includes(f.toLowerCase())));
        const citations: ChatCitation[] = printed ? [{ chunkId: "page:" + printed.id + ":" + printed.page, policyId: printed.id, policyName: printed.product ?? "Policy document", insurer: cleanInsurer(printed.insurer) ?? undefined, pageStart: printed.page, pageEnd: printed.page, documentRole: printed.role }] : [];
        return { summary: (isSelf(person) ? "You are " : personName(person) + " is ") + age + " (born " + longDate(dob) + (printed ? ", as " + (printed.product ?? "the policy document") + " prints it on page " + printed.page : ", as recorded on the Household page") + ").",
          details: [], citations, personId: person.id };
      }
    }
    return null;
  }

  const recency = RECENCY.test(text) && (DOC_WORDS.test(text) || text.split(/\s+/).length <= 3) && !MONEY_WORDS.test(text);
  const count = text.match(COUNT);
  const insurerAsked = INSURER_ASK.test(text);
  // "Grace's policies", "Grace Ong policies", "my dad's insurance?": only a person named, and their policies asked for.
  const onlyPerson = (() => {
    const m = /^\s*(?:and\s+|what about\s+|how about\s+)?([\p{L} '’.-]{2,40}?)\s+(?:policies|plans|insurances?)\s*\??\s*$/iu.exec(text);
    if (!m || !namedPeople(m[1], args.family).length) return false;
    const nameWords = new Set(args.family.flatMap((p) => (p.display_name + " " + (p.preferred_name ?? "")).toLowerCase().split(/[^\p{L}]+/u)).filter(Boolean));
    return m[1].toLowerCase().replace(/['’]s\b/g, "").split(/[^\p{L}]+/u).filter(Boolean)
      .every((w) => nameWords.has(w) || /^(?:my|our|his|her|the|dad|father|papa|mum|mom|mother|mama|wife|husband|spouse|son|daughter|kids?|children|bapa|ibu)$/.test(w) || w.length <= 2);
  })();
  const listAsked = LIST_POLICIES.test(text) || WHICH_COVER.test(text) || onlyPerson;
  const endingAsked = ENDING_SOON.test(text);
  // "receipt?", "who paid on 15 March 2026?", "paid by which bank", "when did I last pay her premium?", "is it paid up to date".
  const paymentAsked = /\breceipts?\b|\bwho paid\b|\b(?:last|latest|previous) (?:\S+ ){0,2}(?:paid|payment|pay)\b|\bproof of (?:\S+ ){0,3}payment\b|\bwhen did (?:i|we|he|she|they) (?:last )?pay\b|\bpaid (?:up|by|with|via|through|on|in|for)\b|\b(?:payment|pay) (?:method|mode)\b|\bhow (?:was|is|were) [^?]{0,30}\bpaid\b|\bup to date\b|\bwhich bank\b|\bgiro\b|\bdid (?:i|we|he|she|they) pay\b/i.test(text)
    && !/\bhow much\b|\bwhat (?:premium|amount)\b|\bwhat did (?:i|we|he|she|they) pay\b/i.test(text)
    // A payment still to come ("when will GIRO deduct the renewal premium?") is the renewal notice's, not a receipt's.
    && !/\b(?:will|next|upcoming|renew\w*)\b/i.test(text);
  // "When does Jun's endowment mature?", "when does my dental rider end?", "the company insurance until when?": one plan's printed date.
  const dateAsked = /\b(?:when|what date|until when|till when|by when|which date)\b/i.test(text) && /\b(?:matur\w*|expir\w*|end|ends|ending|renew\w*|start\w*|begin\w*|commenc\w*|until|till|valid)\b/i.test(text)
    // A renewal (its notice prints the renewal date and premium) and what a maturity pays are the policy answers' to give.
    && !/\b(?:premium|pay|pays|paying|paid|payout|due|claim\w*|lapse\w*|deadline|submit|grace|trip|travel(?:ling)?|admission|admitted|discharged?|hospital stay|renew\w*|giro|deduct\w*|how much|get|receive|amount|worth|value)\b/i.test(text) && !/:\s*\S/.test(text);
  // "Total death cover for me", "compare death coverage between us", "who has more CI cover", "compare my term life and whole life sum assured".
  const coverKind = /\b(?:ci|critical illness)\b/i.test(text) ? "ci" : /\b(?:life|death|dies?|died|sum assured)\b/i.test(text) ? "death" : null;
  const coverTotal = !!coverKind && /\b(?:total|totals|compare|comparison|vs\.?|versus|between us|who has more|more cover|both|altogether|combined|in total|how much (?:life|death|ci|critical illness) cover|if [\p{L} ]{2,30} dies?)\b/iu.test(text)
    && !/\b(?:premium|pay|paid|cost|claims?|how many)\b/i.test(text);
  const CURRENCY_WORD = /\b(?:usd|us\$|us dollars?|american dollars?|sgd|singapore dollars?|currenc(?:y|ies)|foreign currency)\b/i;
  const currencyAsked = CURRENCY_WORD.test(text) && (/^\s*(?:which|what|any)\b[^?]{0,40}\b(?:in|are|is)\b[^?]{0,20}(?:usd|us\$|us dollars?|american dollars?|sgd|singapore dollars?|foreign currency)\b|\bwhat currenc(?:y|ies)\b|\bwhich currenc(?:y|ies)\b/i.test(text) || text.split(/\s+/).length <= 3)
    && !/\b(?:how much|premium|pay|paid|sum|value|worth|convert|exchange|rate|surrender|penalty|charge|cover|claim)\b/i.test(text);
  const people0 = namedPeople(text, args.family);
  // "Grace's policies", "Grace Ong policies": a person named, and their policies asked for.
  const personList = people0.length > 0 && onlyPerson;
  // "Show me Hui Min's ILP": a kind of plan asked for by whose it is.
  const kindOf = /^\s*(?:can you\s+)?(?:show|tell)(?: me)?(?: about)?\s+([\p{L} '’.-]{2,40}?)['’]s\s+([\p{L} -]{2,30}?)\s*\??\s*$/iu.exec(text);
  const groupCoverAsked = /\b(?:does|do|is|are|will|can)\b[^?]{0,40}\b(?:group|company|employer|office|work)\b[^?]{0,30}\b(?:cover|covers|insure|include)\b/i.test(text);
  if (!recency && !count && !insurerAsked && !listAsked && !endingAsked && !groupCoverAsked && !currencyAsked && !personList && !kindOf && !paymentAsked && !dateAsked && !coverTotal) return null;
  const result = await answerFrom();
  return result ? { ...result, asked: text } : null;
  async function answerFrom(): Promise<RegistryAnswer | null> {

  const all = await loadDocs(args.accountId);
  // Copies and earlier schedules of one policy are explained by the uploads answer (lib/chat/document-questions.ts).
  if (all.some((d) => d.superseded) && (recency || count) || /\b(?:schedule|copy|copies|photo|pdf|current)\b/i.test(text) && (recency || count)) return null;
  const docs = all.filter((d) => !d.superseded);
  if (!docs.length) return null;
  // A word of a family member's name that names nobody outright ("Muhammad" when two people share it) is the person
  // resolver's to settle, not a question about the whole household.
  const lowerText = " " + text.toLowerCase().replace(/['’]s\b/g, " ").replace(/[^\p{L}\p{N}' ]+/gu, " ") + " ";
  const nameWord = args.family.some((p) => p.display_name.toLowerCase().split(/\s+/).some((w) => w.length >= 4 && !/^(?:binte?|bin|nur|siti|mohd)$/.test(w) && lowerText.includes(" " + w + " ")));
  if (nameWord && !namedPeople(text, args.family).length) return null;
  // Lapsed or ended policies are said to be, wherever they are listed.
  const inactive = new Map((await inactiveDocuments(args.accountId, args.family.map((p) => p.id)).catch(() => [])).map((x) => [x.docId, x.status]));
  const family = args.family;
  const nameOf = (id: string) => { const p = family.find((x) => x.id === id); return p ? (isSelf(p) ? "you" : personName(p)) : null; };
  const pointed = pointedDocs(text, docs);
  const people = namedPeople(text, family);
  // One record per policy: its cover documents first; a policy known only from papers (letters, a receipt) still counts.
  const policies = new Map<string, Doc[]>();
  for (const d of docs) (policies.get(policyKey(d)) ?? policies.set(policyKey(d), []).get(policyKey(d))!).push(d);
  const lead = (ds: Doc[]) => ds.find((d) => !isPaper(d)) ?? ds[0];
  const coveredBy = (ds: Doc[]) => { const cover = ds.filter((d) => !isPaper(d)); return [...new Set((cover.length ? cover : ds).flatMap((d) => cover.length ? d.owners : [d.owners[0]]))]; };
  const stateOf = (ds: Doc[]) => { const st = ds.map((x) => inactive.get(x.id)).find((x) => !!x); return st ? " — " + (st.state === "lapsed" ? "lapsed on " + st.printed + ", not in force" : "ended on " + st.printed + ", no longer in force") : ""; };
  const kindLabel = (d: Doc) => KINDS.find((k) => k.doc.test((d.kind ?? "") + " " + (d.product ?? "")))?.label ?? null;
  const policyLine = (ds: Doc[], withOwners = true) => {
    const d = lead(ds);
    const owners = coveredBy(ds).map(nameOf).filter((x): x is string => !!x);
    const papersOnly = ds.every(isPaper);
    return (d.product ?? d.file) + (kindLabel(d) ? " (" + kindLabel(d) + ")" : "") + (d.insurer ? ", " + d.insurer : "") + (d.number ? ", policy " + d.number : d.groupNumber ? ", group policy " + d.groupNumber : "")
      + (withOwners && owners.length ? " — " + (owners.length > 1 && ds.some((x) => /joint/i.test(x.product ?? "")) ? "joint, covering " : "covers ") + listOf(owners) : "")
      + (papersOnly ? " (known from " + listOf([...new Set(ds.map((x) => ROLE_NAME[x.role ?? ""] ?? "a document"))]) + " on file)" : "") + stateOf(ds) + ".";
  };

  // ---------------------------------------------------------------- cover added up, per person
  if (coverTotal && coverKind) {
    const rows = (await query<{ policy_id: string; member: string | null; category: string | null; amount: string; currency: string | null; notes: string | null }>(
      `SELECT pc.policy_id::text, pc.family_member_id::text AS member, pc.category, pc.amount::text, pc.currency, pc.notes FROM policy_coverages pc JOIN policies p ON p.id=pc.policy_id
        WHERE pc.account_id=$1 AND ${activePredicate("p")} AND p.processing_status='ready' AND p.superseded_at IS NULL AND pc.amount IS NOT NULL`, [args.accountId]).catch(() => ({ rows: [] }))).rows;
    const replaced = await replacedFigures(args.accountId).catch(() => new Map<string, { amounts: Set<number> }>());
    const kindOk = (cat: string | null) => coverKind === "ci" ? /critical/i.test(cat ?? "") : /^(?:life|death)/i.test(cat ?? "");
    const usable = rows.filter((r) => kindOk(r.category) && !(replaced.get(r.policy_id)?.amounts.has(Number(r.amount))) && !inactive.has(r.policy_id)
      // A figure read from a paper about a policy (an app screenshot, a receipt, notes) is not its stated cover.
      && !docs.some((d) => d.id === r.policy_id && isPaper(d)));
    if (!usable.length) return null;
    const self = family.find(isSelf);
    const us = /\b(?:us|both|our|we|each|between)\b/i.test(text) || /\bwho has more\b/i.test(text);
    const dies = /\bif ([\p{L} ]{2,30}?) dies?\b/iu.exec(text)?.[1];
    const whom = dies ? namedPeople(dies, family) : people.length ? people : us ? family.filter((p) => usable.some((r) => r.member === p.id)) : args.people.length === 1 ? args.people : self ? [self] : [];
    if (!whom.length) return null;
    const money = (n: number, cur: string) => (cur === "USD" ? "US$" : "S$") + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    const letters = docs.filter(isPaper);
    const letterText = new Map((await query<{ policy_id: string; text: string }>(`SELECT policy_id::text AS policy_id, string_agg(text, E'\\n' ORDER BY page_number) AS text FROM policy_pages WHERE account_id=$1 AND policy_id::text=ANY($2::text[]) GROUP BY 1`,
      [args.accountId, [...letters.map((d) => d.id), ...new Set(usable.map((r) => r.policy_id))]]).catch(() => ({ rows: [] }))).rows.map((r) => [r.policy_id, r.text] as const));
    // A figure is said only when its document prints it (a misread amount is never added up).
    const printedOn = (id: string, n: number) => {
      const t = letterText.get(id) ?? "";
      const forms = [n.toLocaleString("en-US", { maximumFractionDigits: 2 }), String(n)].map((f) => f.replace(/[.,]/g, (c) => "\\" + c));
      // (A table column headed "S$" prints its figures bare; a small number needs its currency beside it.)
      return new RegExp((n >= 1000 ? "(?<![\\d,.])" : "(?:S\\$|SGD|US\\$|USD)\\s?") + "(?:" + forms.join("|") + ")(?:\\.00)?(?![\\d]|[,.]\\d)", "i").test(t);
    };
    const byPerson = whom.map((p) => {
      const mine = new Map<string, { d: Doc; amount: number; cur: string; joint: boolean; note: string | null }>();
      for (const r of usable.filter((x) => x.member === p.id && printedOn(x.policy_id, Number(x.amount)))) {
        const d = docs.find((x) => x.id === r.policy_id); if (!d) continue;
        const k = policyKey(d), cur = (r.currency ?? "SGD").toUpperCase();
        const joint = coveredBy(policies.get(k) ?? [d]).length > 1;
        const prev = mine.get(k);
        // One figure per policy: the current document's (a later endorsement's) when there are two.
        if (!prev || (dateOf(d) ?? "") > (dateOf(prev.d) ?? "")) mine.set(k, { d, amount: Number(r.amount), cur, joint, note: r.notes });
      }
      // A policy known only from the insurer's letters (a lapse notice, a reinstatement letter): the sum assured the latest of them states.
      for (const [k, ds] of policies) {
        if (mine.has(k) || !ds.every(isPaper) || !coveredBy(ds).includes(p.id) || ds.some((x) => inactive.has(x.id))) continue;
        const kindRe = coverKind === "ci" ? /critical illness/i : /\blife\b|\bterm\b|whole life/i;
        if (!ds.some((x) => kindRe.test((x.kind ?? "") + " " + (x.product ?? "")))) continue;
        // The insurer's own letters only: an app screenshot, a receipt or the family's notes never state cover.
        for (const d of ds.filter((x) => /^(?:insurer_letter|other|renewal_notice)$/.test(x.role ?? "")).sort((a, b) => (dateOf(b) ?? "").localeCompare(dateOf(a) ?? ""))) {
          const text = letterText.get(d.id) ?? "";
          const m = /sum (?:assured|insured)[^\n$]{0,30}?(S\$|SGD\s?|US\$|USD\s?)\s?(\d[\d,]*(?:\.\d+)?)/i.exec(text);
          if (m) { mine.set(k, { d, amount: Number(m[2].replace(/,/g, "")), cur: /^US/i.test(m[1]) ? "USD" : "SGD", joint: false, note: "as the insurer’s letter dated " + (dateOf(d) ? longDate(dateOf(d)!) : "on file") + " states" }); break; }
        }
      }
      const items = [...mine.values()];
      const totals = new Map<string, number>(); for (const i of items) totals.set(i.cur, (totals.get(i.cur) ?? 0) + i.amount);
      return { p, items, totals };
    }).filter((x) => x.items.length);
    if (!byPerson.length) return null;
    const what = coverKind === "ci" ? "critical illness cover" : "death cover";
    // Someone asked about who has none of this cover is said to have none.
    const none = whom.filter((p) => !byPerson.some((x) => x.p.id === p.id));
    // ...unless a paper on file (an app screenshot, a letter that prints no figure) is about such a policy of theirs:
    // then what it shows is the document questions' to say, not "none".
    const kindDoc = coverKind === "ci" ? /critical illness/i : /\blife\b|\bterm\b|whole life/i;
    if (none.some((p) => docs.some((d) => d.owners.includes(p.id) && kindDoc.test((d.kind ?? "") + " " + (d.product ?? ""))))) return null;
    const totalText = (t: Map<string, number>) => [...t].map(([c, n]) => money(n, c)).join(" plus ") + (t.size > 1 ? " (each currency kept separate)" : "");
    const label = (note: string | null) => { const n = (note ?? "").split("·").at(-1)!.trim(); return n && !/^(?:death|life|ci amount|cover|death benefit)$/i.test(n) ? " (" + n.charAt(0).toLowerCase() + n.slice(1) + ")" : ""; };
    // Someone the question names by name is called by name ("compare Wei Jie and Mei Ling"), even the person asking.
    const byNameIds = new Set(family.filter((p) => [p.preferred_name ?? "", p.display_name].some((n) => n.trim().length >= 3 && (" " + text.toLowerCase().replace(/['’]s\b/g, " ") + " ").includes(" " + n.toLowerCase().trim() + " "))).map((p) => p.id));
    const you = (p: ClaimPerson) => isSelf(p) && !byNameIds.has(p.id);
    const lines = byPerson.flatMap((x) => x.items.map((i) => (you(x.p) ? "You" : personName(x.p)) + " — " + (i.d.product ?? i.d.file) + ": " + money(i.amount, i.cur) + label(i.note) + (i.joint ? " (joint policy: paid once, on the first death of the people it covers)" : "") + "."));
    const sentences = byPerson.map((x) => (you(x.p) ? "Your" : personName(x.p) + "’s") + " " + what + " on file " + (x.items.length > 1 ? "adds up to " + totalText(x.totals) + " across " + x.items.length + " policies" : "is " + totalText(x.totals) + " under " + (x.items[0].d.product ?? x.items[0].d.file)) + ".");
    let lead = sentences.join(" ") + (none.length ? " " + listOf(none.map((p) => you(p) ? "you" : personName(p))).replace(/^\w/, (c) => c.toUpperCase()) + (none.length === 1 && !you(none[0]) ? " has" : " have") + " no " + what + " on file." : "");
    if (byPerson.length === 2 && byPerson.every((x) => x.totals.size === 1 && x.totals.has("SGD"))) {
      const [a, b] = byPerson; const ta = a.totals.get("SGD")!, tb = b.totals.get("SGD")!;
      if (ta !== tb) { const more = ta > tb ? a : b; lead += " " + (you(more.p) ? "You have" : personName(more.p) + " has") + " more."; }
    }
    return { summary: lead + " These are the policy-stated amounts, not what a claim would pay.", details: lines, citations: [...new Set(byPerson.flatMap((x) => x.items.map((i) => i.d)))].map(cite), personId: byPerson.length === 1 ? byPerson[0].p.id : null };
  }

  // ---------------------------------------------------------------- one plan's start or end date
  if (dateAsked) {
    const starting = /\b(?:start\w*|begin\w*|commenc\w*)\b/i.test(text);
    let pool = (pointed ?? docs).filter((d) => !isPaper(d));
    if (people.length) pool = pool.filter((d) => d.owners.some((o) => people.some((p) => p.id === o)));
    else if (!pointed && args.people.length === 1) pool = pool.filter((d) => d.owners.includes(args.people[0].id));
    const ps = [...new Map(pool.map((d) => [policyKey(d), policies.get(policyKey(d)) ?? [d]])).values()];
    if (ps.length !== 1 || !pointed && !people.length) {
      if (ps.length !== 1) return null;
    }
    const ds = ps[0], d = lead(ds);
    const iso = starting ? d.start : ds.map((x) => x.end).filter((x): x is string => !!x).sort().at(-1) ?? null;
    if (!iso) return null;
    const printed = longDate(iso), short = String(Number(iso.slice(8, 10))).padStart(2, "0") + " " + MONTHS[Number(iso.slice(5, 7)) - 1].slice(0, 3) + " " + iso.slice(0, 4);
    const page = (await query<{ page_number: number; text: string }>("SELECT page_number, text FROM policy_pages WHERE account_id=$1 AND policy_id=$2 ORDER BY page_number", [args.accountId, d.id]).catch(() => ({ rows: [] }))).rows
      .map((r) => ({ page: r.page_number, line: r.text.split(/\n/).find((l) => l.toLowerCase().includes(printed.toLowerCase()) || l.toLowerCase().includes(short.toLowerCase())) }))
      .find((x) => !!x.line);
    const verb = starting ? "started on" : /endowment|saving/i.test((d.kind ?? "") + " " + (d.product ?? "")) || /\bmatur/i.test(text) ? "matures on" : /\brenew/i.test(text) ? "is due for renewal after" : "runs until";
    const st = ds.map((x) => inactive.get(x.id)).find((x) => !!x);
    // Whose plan it is, said: the person asked about, or the plan's one insured person.
    const ownerIds = coveredBy(ds);
    const owner = people.length === 1 ? people[0] : ownerIds.length === 1 ? family.find((p) => p.id === ownerIds[0]) : undefined;
    const whose = owner ? (isSelf(owner) ? "Your " : personName(owner) + "’s ") : "";
    return { summary: whose + (d.product ?? d.file) + " " + verb + " " + printed + (st ? " — it " + (st.state === "lapsed" ? "lapsed on " + st.printed : "ended on " + st.printed) + ", so it is not in force now" : "") + (page ? ", as page " + page.page + " prints it." : "."),
      details: page?.line ? ["“" + page.line.replace(/\t+/g, " · ").replace(/\s+/g, " ").trim() + "” (page " + page.page + ")."] : [],
      citations: [{ ...cite(d), chunkId: "page:" + d.id + ":" + (page?.page ?? 1), pageStart: page?.page ?? 1, pageEnd: page?.page ?? 1 }], personId: null, topic: d.product ?? undefined, keepTopic: true };
  }

  // ---------------------------------------------------------------- payments and receipts
  if (paymentAsked) {
    const receipts = docs.filter((d) => /receipt/.test(d.role ?? "") || d.paid);
    // The plans (or people) the question names; receipts for anything else are not the answer.
    const forThese = (d: Doc) => (!pointed || pointed.some((x) => policyKey(x) === policyKey(d))) && (!people.length || people.some((p) => coveredBy(policies.get(policyKey(d)) ?? [d]).includes(p.id) || d.owners.includes(p.id)));
    const shown = receipts.filter(forThese);
    if (!shown.length) {
      if (!receipts.length && !/\breceipt/i.test(text) && !pointed) return null;
      const what = pointed ? listOf([...new Set(pointed.map((d) => d.product ?? d.file))]) : people.length ? listOf(people.map((p) => isSelf(p) ? "you" : personName(p))) : "that";
      return { summary: "There’s no premium receipt or payment record on file for " + what + ", so your documents don’t show whether or when it was paid. The insurer’s statement or your bank records would show it." + (receipts.length ? " The receipt on file is for " + listOf([...new Set(receipts.map((d) => d.product ?? d.file))]) + "." : ""),
        details: [], citations: [], personId: null };
    }
    const pageRows = (await query<{ policy_id: string; page_number: number; text: string }>(`SELECT policy_id::text AS policy_id, page_number, text FROM policy_pages WHERE account_id=$1 AND policy_id::text=ANY($2::text[]) ORDER BY page_number`,
      [args.accountId, shown.map((d) => d.id)]).catch(() => ({ rows: [] }))).rows;
    const details: string[] = [];
    const citations: ChatCitation[] = [];
    for (const d of shown) {
      const rows = pageRows.filter((r) => r.policy_id === d.id);
      const lines = rows.flatMap((r) => r.text.split(/\n/).map((l) => ({ page: r.page_number, line: l.replace(/\t+/g, " · ").replace(/\s+/g, " ").trim() })))
        .filter((x) => x.line.length >= 6 && !/synthetic test document|^page \d+(?: of \d+)?$|\((?:fictitious|fictional|synthetic)\)\s*$/i.test(x.line) && !/^(?:official receipt|receipt)$/i.test(x.line)
          // Machine text a reader left in the page (a bare label, an encoded blob) is not something the receipt prints for people.
          && !/^[A-Z0-9_-]+:$/.test(x.line) && !/[A-Za-z0-9+/=]{40,}/.test(x.line));
      for (const x of lines.slice(0, 12)) details.push("“" + x.line + "” (" + (d.product ?? d.file) + ", page " + x.page + ").");
      citations.push({ chunkId: "page:" + d.id + ":" + (rows[0]?.page_number ?? 1), policyId: d.id, policyName: d.product ?? d.file, insurer: d.insurer ?? undefined, pageStart: rows[0]?.page_number ?? 1, pageEnd: rows[0]?.page_number ?? 1, documentRole: d.role });
    }
    // "Does the receipt amount match the schedule?": the receipt's figure beside the premium the policy's own schedule prints.
    let compare = "";
    if (/\b(?:match|same|equal|differ\w*|correct)\b/i.test(text)) {
      const cover = (pr: Doc) => (policies.get(policyKey(pr)) ?? []).filter((x) => !isPaper(x));
      const premiums = (await query<{ amount: string; source: string }>(`SELECT amount::text, source_document_id::text AS source FROM premium_records WHERE account_id=$1 AND source_document_id::text=ANY($2::text[])`,
        [args.accountId, [...shown.flatMap((d) => cover(d).map((x) => x.id)), ...shown.map((d) => d.id)]]).catch(() => ({ rows: [] }))).rows;
      for (const d of shown) {
        const paid = premiums.find((p) => p.source === d.id), scheduled = premiums.find((p) => cover(d).some((x) => x.id === p.source));
        if (paid && scheduled) compare += (Number(paid.amount) === Number(scheduled.amount) ? "Yes — the receipt’s amount is the same as the annual premium the " + (d.product ?? "policy") + " schedule prints. " : "No — the receipt’s amount differs from the annual premium the " + (d.product ?? "policy") + " schedule prints. ");
      }
    }
    return { summary: compare + (shown.length === 1 ? "Here is what the premium receipt on file (“" + shown[0].file + "”) prints:" : "Here is what the " + shown.length + " premium receipts on file print:"),
      details, citations, personId: null, topic: shown.length === 1 ? shown[0].product ?? undefined : undefined };
  }

  // ---------------------------------------------------------------- recency
  if (recency) {
    const oldest = /\b(?:oldest|earliest|older)\b/i.test(text);
    const policyAsked = /\bpolic(?:y|ies)|\bplans?\b/i.test(text) && !/\b(?:documents?|docs?|papers?|uploads?|files?|letters?|change)\b/i.test(text);
    const changeAsked = /\bchanges?\b|\bendorsements?\b|\bamend\w*/i.test(text);
    let pool = pointed ?? docs;
    if (people.length && !pointed) pool = pool.filter((d) => d.owners.some((o) => people.some((p) => p.id === o)));
    if (changeAsked) pool = pool.filter((d) => /endorsement|insurer_letter|other|renewal_notice/.test(d.role ?? ""));
    // "Which letter is newer?", "latest statement", "newest receipt": papers of that kind only.
    const paperKind = /\bletters?\b|\bnotices?\b/i.test(text) ? /insurer_letter|other|renewal_notice|claim_decision/ : /\bstatements?\b/i.test(text) ? /statement/ : /\breceipts?\b/i.test(text) ? /receipt/ : null;
    if (paperKind) { const papers = pool.filter((d) => paperKind.test(d.role ?? "")); if (papers.length) pool = papers; }
    if (policyAsked) {
      const ps = [...policies.values()].filter((ds) => ds.some((d) => pool.includes(d))).map((ds) => ({ ds, d: lead(ds), at: ds.map((x) => x.start).filter((x): x is string => !!x).sort()[0] ?? dateOf(lead(ds)) }))
        .filter((x) => !!x.at).sort((a, b) => a.at!.localeCompare(b.at!));
      if (!ps.length) return null;
      const pick = oldest ? ps[0] : ps[ps.length - 1];
      return { summary: "The " + (oldest ? "oldest" : "newest") + " policy on file is " + (pick.d.product ?? pick.d.file) + (pick.d.insurer ? " with " + pick.d.insurer : "") + ", which started on " + longDate(pick.at!) + ".",
        details: ps.map((x) => (x.d.product ?? x.d.file) + ": started " + longDate(x.at!) + "."), citations: [cite(pick.d)], personId: null, topic: pick.d.product ?? undefined };
    }
    const dated = pool.filter((d) => !!dateOf(d)).sort((a, b) => dateOf(a)!.localeCompare(dateOf(b)!) || a.created.localeCompare(b.created));
    if (!dated.length) return null;
    const pick = oldest ? dated[0] : dated[dated.length - 1];
    const what = changeAsked ? "change on file" : "document on file";
    return { summary: "The " + (oldest ? "oldest" : changeAsked ? "latest" : "newest") + " " + what + (pointed && pointed.length < docs.length && pick.product ? " for " + pick.product : "") + " is the " + describe(pick) + " (“" + pick.file + "”), dated " + longDate(dateOf(pick)!) + ".",
      details: dated.map((d) => longDate(dateOf(d)!) + " — " + describe(d) + " (“" + d.file + "”)."), citations: [cite(pick)], personId: null, topic: pick.product ?? undefined };
  }

  // ---------------------------------------------------------------- counting
  if (count) {
    const unit = count[1].toLowerCase();
    if (/^pages?$/.test(unit)) {
      const ds = (pointed ?? []).filter((d) => d.pages);
      if (!ds.length || ds.length > 3) return null;
      return { summary: ds.map((d) => "“" + d.file + "” (" + describe(d) + ") has " + d.pages + " page" + (d.pages === 1 ? "" : "s") + ".").join(" "), details: [], citations: ds.map(cite), personId: null };
    }
    if (/^polic|^plans?/.test(unit)) {
      let ps = [...policies.values()];
      if (pointed) ps = ps.filter((ds) => ds.some((d) => pointed.includes(d)));
      if (people.length) ps = ps.filter((ds) => coveredBy(ds).some((o) => people.some((p) => p.id === o)));
      if (!ps.length) return null;
      const who = people.length ? listOf(people.map((p) => isSelf(p) ? "you" : personName(p))) : null;
      return { summary: (who ? who.charAt(0).toUpperCase() + who.slice(1) + (people.length === 1 && !isSelf(people[0]) ? " has " : " have ") : "There are ") + ps.length + " " + (ps.length === 1 ? "policy" : "policies") + " on file" + (who ? "" : " for your household") + ":",
        details: ps.map((ds) => policyLine(ds, !who)), citations: ps.map((ds) => cite(lead(ds))), personId: people.length === 1 ? people[0].id : null };
    }
    const ds = pointed ?? docs;
    const scope = pointed ? [...new Set(pointed.map((d) => d.product ?? d.file))] : [];
    return { summary: ds.length + " " + (ds.length === 1 ? "document is" : "documents are") + " on file" + (scope.length ? " for " + listOf(scope) : "") + ":",
      details: ds.map((d) => "“" + d.file + "” — " + describe(d) + (dateOf(d) ? ", dated " + longDate(dateOf(d)!) : "") + "."), citations: ds.map(cite), personId: null };
  }

  // ---------------------------------------------------------------- insurer
  if (insurerAsked) {
    const ds = pointed ?? (people.length ? docs.filter((d) => d.owners.some((o) => people.some((p) => p.id === o))) : null);
    if (!ds?.length) return null;
    const byProduct = new Map<string, Doc>();
    for (const d of ds) if (!byProduct.has(d.product ?? d.file)) byProduct.set(d.product ?? d.file, d);
    const shown = [...byProduct.values()];
    const insurers = [...new Set(shown.map((d) => d.insurer).filter((x): x is string => !!x))];
    if (!insurers.length) return null;
    const same = /\bsame\b/i.test(text);
    const summary = same && shown.length >= 2
      ? (insurers.length === 1 ? "Yes — " + listOf(shown.map((d) => d.product ?? d.file)) + " are both with " + insurers[0] + "." : "No — " + shown.map((d) => (d.product ?? d.file) + " is with " + (d.insurer ?? "an insurer the document doesn’t name")).join(", and ") + ".")
      : shown.map((d) => (d.product ?? d.file) + " is with " + (d.insurer ?? "an insurer the document doesn’t name")).join("; ") + ".";
    return { summary, details: [], citations: shown.map(cite), personId: null, topic: shown.length === 1 ? shown[0].product ?? undefined : undefined };
  }

  // ---------------------------------------------------------------- ending soon
  if (endingAsked) {
    const nextYear = /\bnext year\b/i.test(text) && !/\b\d{1,2}\s*months?\b/i.test(text);
    const n = Number(text.match(/\b(\d{1,2})\s*months?\b/i)?.[1] ?? (/\b(?:this|next) year\b/i.test(text) ? NaN : 3));
    const from = nextYear ? (today.getUTCFullYear() + 1) + "-01-01" : todayIso;
    const until = Number.isFinite(n) ? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + n, today.getUTCDate())).toISOString().slice(0, 10) : (today.getUTCFullYear() + (nextYear ? 1 : 0)) + "-12-31";
    const ps = [...policies.values()].map((ds) => ({ ds, d: lead(ds), end: ds.map((x) => x.end).filter((x): x is string => !!x).sort().at(-1) ?? null })).filter((x) => x.end);
    const soon = ps.filter((x) => x.end! >= from && x.end! <= until).sort((a, b) => a.end!.localeCompare(b.end!));
    const span = Number.isFinite(n) ? "the next " + n + " month" + (n === 1 ? "" : "s") : nextYear ? "next year (" + (today.getUTCFullYear() + 1) + ")" : "the rest of this year";
    return { summary: soon.length ? listOf(soon.map((x) => x.d.product ?? x.d.file)) + (soon.length === 1 ? " ends" : " end") + " within " + span + ", as the documents print the dates:" : "None of the policies on file prints an end or renewal date within " + span + ".",
      details: (soon.length ? soon : ps.slice(0, 6)).map((x) => (x.d.product ?? x.d.file) + ": ends or renews on " + longDate(x.end!) + "."), citations: (soon.length ? soon : []).map((x) => cite(x.d)), personId: null };
  }

  // ---------------------------------------------------------------- does the group plan cover someone
  if (groupCoverAsked && !listAsked) {
    const groups = [...policies.values()].filter((ds) => ds.some((d) => /\bgroup\b|employee/i.test((d.kind ?? "") + " " + (d.product ?? ""))));
    if (groups.length !== 1 || people.length !== 1) return null;
    const ds = groups[0], d = lead(ds), who = people[0];
    const members = coveredBy(ds);
    // Only what the document settles: someone the group plan does not name at all. Which part of it covers a
    // member (and at what tier) is the booklet's own table, answered from its pages.
    if (members.includes(who.id)) return null;
    return { summary: "No — " + personName(who) + " isn’t among the people " + (d.product ?? "the group plan") + " covers. It names " + listOf(members.map(nameOf).filter((x): x is string => !!x)) + ".",
      details: [], citations: [cite(d)], personId: who.id, topic: d.product ?? undefined };
  }

  // ---------------------------------------------------------------- currency
  if (currencyAsked) {
    const ps = [...policies.values()].map((ds) => ({ ds, d: lead(ds), cur: [...new Set(ds.flatMap((x) => x.currencies))] })).filter((x) => x.cur.length);
    if (!ps.length) return null;
    const foreign = ps.filter((x) => x.cur.some((c) => c !== "SGD"));
    const named = /\b(?:usd|us\$|us dollars?|american)\b/i.test(text) ? ps.filter((x) => x.cur.includes("USD")) : foreign;
    const word = (c: string) => c === "USD" ? "US dollars (USD)" : c === "SGD" ? "Singapore dollars (SGD)" : c;
    return { summary: named.length ? listOf(named.map((x) => (x.d.product ?? x.d.file) + (x.d.insurer ? " (" + x.d.insurer + ")" : ""))) + (named.length === 1 ? " is" : " are") + " in " + listOf([...new Set(named.flatMap((x) => x.cur.filter((c) => c !== "SGD")))].map(word)) + "; " + (ps.length - named.length === 0 ? "there are no others." : "the other policies on file are in Singapore dollars.")
        : "All the policies on file are in Singapore dollars (SGD); none is in another currency.",
      details: ps.map((x) => (x.d.product ?? x.d.file) + ": " + listOf(x.cur.map(word)) + "."), citations: (named.length ? named : ps).map((x) => cite(x.d)), personId: null };
  }

  // ---------------------------------------------------------------- a kind of plan, by whose it is
  if (kindOf && !listAsked) {
    const who = namedPeople(kindOf[1], family);
    const kinds = KINDS.filter((k) => k.asked.test(kindOf[2]));
    if (who.length === 1 && kinds.length === 1) {
      const person = who[0], kind = kinds[0];
      const ofKind = [...policies.values()].filter((ds) => ds.some((d) => kind.doc.test((d.kind ?? "") + " " + (d.product ?? ""))));
      const theirs = ofKind.filter((ds) => coveredBy(ds).includes(person.id));
      // Only when the person holds none of that kind and someone else in the household does: whose it is, said.
      // (Not while one of their uploads couldn't be read: the plan may be in it.)
      const unreadable = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM policies p WHERE p.account_id=$1 AND ${activePredicate("p")} AND p.processing_status<>'ready' AND (p.family_member_id=$2 OR EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.family_member_id=$2))`, [args.accountId, person.id]).catch(() => ({ rows: [{ n: 1 }] }))).rows[0]?.n ?? 1;
      if (!theirs.length && ofKind.length && !unreadable) {
        const whose = (id: string) => { const p = family.find((x) => x.id === id); return p ? (isSelf(p) ? "yours" : personName(p) + "’s") : null; };
        const lines = ofKind.map((ds) => (lead(ds).product ?? lead(ds).file) + " — " + listOf(coveredBy(ds).map(whose).filter((x): x is string => !!x)));
        return { summary: personName(person) + " has no " + kind.label + " on file. The " + kind.label + (ofKind.length === 1 ? " on file is " : "s on file are ") + listOf(lines) + ".",
          details: ofKind.map((ds) => policyLine(ds)), citations: ofKind.map((ds) => cite(lead(ds))), personId: person.id };
      }
    }
    if (!recency && !count && !insurerAsked && !endingAsked && !groupCoverAsked && !currencyAsked && !personList) return null;
  }

  // ---------------------------------------------------------------- who has what
  if (listAsked) {
    const documentsAsked = /\b(?:documents|uploads|files)\b/i.test(text) && !/\bcover\b/i.test(text);
    if (documentsAsked) return null; // the uploads list (lib/chat/document-questions.ts)
    // The people asked about: those named, "me", or the person this chat is on; otherwise the whole household.
    const self = family.find(isSelf);
    const meAsked = /\b(?:me|i|my|mine|myself)\b/i.test(text) && !/\b(?:my|our) (?:family|household|kids?|children|wife|husband|dad|father|mum|mother|parents?)\b/i.test(text) && !/\ball\b/i.test(text);
    const me = args.people.length === 1 ? args.people[0] : self;
    const whoAsked = people.length ? people : meAsked && me ? [me] : args.people.length === 1 && !isSelf(args.people[0]) && !/\b(?:all|family|our|household)\b/i.test(text) ? args.people : [];
    let ps = [...policies.values()];
    if (pointed) ps = ps.filter((ds) => ds.some((d) => pointed.includes(d)));
    if (!ps.length) return null;
    if (whoAsked.length) {
      const lines = whoAsked.map((p) => {
        const mine = ps.filter((ds) => coveredBy(ds).includes(p.id));
        return { p, mine, line: (isSelf(p) ? "You" : personName(p)) + ": " + (mine.length ? listOf(mine.map((ds) => (lead(ds).product ?? lead(ds).file) + (kindLabel(lead(ds)) ? " (" + kindLabel(lead(ds)) + ")" : "") + (coveredBy(ds).length > 1 && ds.some((x) => /joint/i.test(x.product ?? "")) ? " — joint" : ""))) : "no policy on file") + "." };
      });
      const one = lines.length === 1 ? lines[0] : null;
      const summary = one ? (one.mine.length ? (isSelf(one.p) ? "You are" : personName(one.p) + " is") + " covered by " + one.mine.length + " " + (one.mine.length === 1 ? "policy" : "policies") + " on file:" : "There is no policy on file that covers " + (isSelf(one.p) ? "you" : personName(one.p)) + ".")
        : (() => { const have = lines.filter((l) => l.mine.length).map((l) => isSelf(l.p) ? "you" : personName(l.p)); const none = lines.filter((l) => !l.mine.length).map((l) => isSelf(l.p) ? "you" : personName(l.p));
          return (have.length ? listOf(have) + (have.length === 1 ? " has" : " have") + " cover on file" : "None of them has cover on file") + (none.length && have.length ? "; " + listOf(none) + (none.length === 1 ? " has" : " have") + " none" : "") + ":"; })();
      const cites = [...new Set(lines.flatMap((l) => l.mine.map((ds) => lead(ds))))].map(cite);
      return { summary, details: one ? one.mine.map((ds) => policyLine(ds, false)) : lines.map((l) => l.line), citations: cites, personId: whoAsked.length === 1 ? whoAsked[0].id : null };
    }
    // The household's whole list is the portfolio overview's (lib/chat/workflow.ts), which adds what otherPoliciesOnFile finds.
    return null;
  }
  return null;
}
}

/** Round 15: policies on file that a list of contracts leaves out -- one known only from the insurer's letters (a lapse
 * notice, a reinstatement letter), a national scheme's summary, a group booklet -- each said for what it is. */
export async function otherPoliciesOnFile(accountId: string, family: ClaimPerson[], shown: string[], people: ClaimPerson[] = family): Promise<string[]> {
  const docs = (await loadDocs(accountId)).filter((d) => !d.superseded);
  const key = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const seen = new Set(shown.map(key));
  const policies = new Map<string, Doc[]>();
  for (const d of docs) (policies.get(policyKey(d)) ?? policies.set(policyKey(d), []).get(policyKey(d))!).push(d);
  const inactive = new Map((await inactiveDocuments(accountId, family.map((p) => p.id)).catch(() => [])).map((x) => [x.docId, x.status]));
  const nameOf = (id: string) => { const p = family.find((x) => x.id === id); return p ? (isSelf(p) ? "you" : personName(p)) : null; };
  const out: string[] = [];
  for (const ds of policies.values()) {
    const d = ds.find((x) => !isPaper(x)) ?? ds[0];
    if (!d.product || seen.has(key(d.product)) || ds.some((x) => inactive.has(x.id))) continue;
    if (ds.every((x) => /receipt/.test(x.role ?? ""))) continue; // a premium receipt alone is said by the overview already
    const owners = [...new Set(ds.flatMap((x) => x.owners))].filter((id) => people.some((p) => p.id === id));
    if (!owners.length) continue;
    const kind = KINDS.find((k) => k.doc.test((d.kind ?? "") + " " + (d.product ?? "")))?.label;
    const papers = ds.every(isPaper);
    // A policy's own schedule or certificate the overview leaves out was not read as a contract (a part it couldn't
    // read): the overview says what it could not read; this line is for letters, schemes and booklets only.
    if (!papers && !/^(?:benefit_guide|product_summary|policy_wording)$/.test(d.role ?? "") && !/national scheme|\bgroup\b|employee benefits/i.test([d.insurer, d.kind, d.product, d.role].join(" "))) continue;
    out.push(d.product + (kind ? " (" + kind + ")" : "") + (d.insurer ? ", " + d.insurer : "") + " — " + listOf(owners.map(nameOf).filter((x): x is string => !!x))
      + (papers ? "; known from " + listOf([...new Set(ds.map((x) => ROLE_NAME[x.role ?? ""] ?? "a letter"))]) + " on file" : "") + ".");
  }
  return out;
}
