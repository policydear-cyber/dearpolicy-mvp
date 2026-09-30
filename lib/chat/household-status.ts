/**
 * Round 6: what is on file for each person, in household words -- the
 * policies DearPolicy can answer from, the group booklets that name them,
 * and the documents it could not read (and why, in a sentence the person can
 * act on). Used wherever an answer would otherwise say something vague like
 * "no verified personalised policy evidence".
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { prettifyFilename, referenceRoles } from "@/lib/policies/inventory";
import { PDF_PASSWORD_INCORRECT_MESSAGE, PDF_PASSWORD_REQUIRED_MESSAGE } from "@/lib/documents/processing-errors";
import type { ClaimPerson } from "@/lib/claims/person";

export type PersonDocument = { id: string; name: string; filename: string; role: string | null; policyType: string | null; confirmed: boolean; tier: string | null;
  status: "ready" | "processing" | "password" | "unreadable"; effectiveDate: string | null; renewalOrExpiryDate: string | null };

export async function documentsByPerson(accountId: string, people: ClaimPerson[]): Promise<Map<string, PersonDocument[]>> {
  const out = new Map<string, PersonDocument[]>(people.map((p) => [p.id, []]));
  if (!people.length) return out;
  const r = await query<{ id: string; product_name: string | null; original_filename: string; document_role: string | null; policy_type: string | null; personal_coverage_confirmed: boolean;
    processing_status: string; processing_error: string | null; family_member_id: string; tier: string | null; effective_date: string | null; renewal_or_expiry_date: string | null }>(
    `SELECT p.id::text AS id,p.product_name,p.original_filename,p.document_role,p.policy_type,p.personal_coverage_confirmed,p.processing_status,p.processing_error,
            pm.family_member_id::text AS family_member_id,to_jsonb(pm)->>'benefit_tier' AS tier,p.effective_date::text,p.renewal_or_expiry_date::text
       FROM policies p JOIN policy_members pm ON pm.policy_id=p.id AND pm.account_id=p.account_id
      WHERE p.account_id=$1 AND pm.family_member_id::text=ANY($2::text[]) AND ${activePredicate("p")} AND p.superseded_at IS NULL
      ORDER BY p.created_at,p.id`, [accountId, people.map((p) => p.id)]);
  for (const row of r.rows) {
    const status: PersonDocument["status"] = row.processing_status === "ready" ? "ready"
      : row.processing_status === "failed" ? ([PDF_PASSWORD_REQUIRED_MESSAGE, PDF_PASSWORD_INCORRECT_MESSAGE].includes(row.processing_error ?? "") || /password/i.test(row.processing_error ?? "") ? "password" : "unreadable")
      : "processing";
    out.get(row.family_member_id)?.push({ id: row.id, name: row.product_name ?? prettifyFilename(row.original_filename), filename: row.original_filename, role: row.document_role,
      policyType: row.policy_type, confirmed: row.personal_coverage_confirmed, tier: row.tier, status, effectiveDate: row.effective_date, renewalOrExpiryDate: row.renewal_or_expiry_date });
  }
  return out;
}

export function personName(p: ClaimPerson) { return p.preferred_name?.trim() || p.display_name; }
const isSelf = (p: ClaimPerson) => /^self$/i.test(p.relationship ?? "");
/** "Mei Ling has" / "You have" */
export function hasPhrase(p: ClaimPerson) { return isSelf(p) ? "You have" : personName(p) + " has"; }
export function possessive(p: ClaimPerson) { return isSelf(p) ? "your" : personName(p) + "’s"; }

export function isGroupGuide(d: Pick<PersonDocument, "role" | "confirmed">) { return !d.confirmed && referenceRoles.has(d.role ?? ""); }

/** One sentence per document this person has that DearPolicy could not use. */
export function unusableDocumentLines(p: ClaimPerson, docs: PersonDocument[]): string[] {
  const lines: string[] = [];
  for (const d of docs) {
    if (d.status === "password") lines.push("“" + d.filename + "” couldn’t be read because it is password-protected. Upload it again with its password and DearPolicy will read it automatically.");
    else if (d.status === "unreadable") lines.push("“" + d.filename + "” couldn’t be read. The original PDF or a clearer scan would let DearPolicy read it.");
    else if (d.status === "processing") lines.push("“" + d.filename + "” is still being read. Ask again in a few minutes.");
  }
  return lines;
}

/** Said when a person has no policy DearPolicy can answer from. */
export function noPoliciesSentence(p: ClaimPerson, docs: PersonDocument[]): string {
  const unusable = docs.filter((d) => d.status !== "ready");
  const who = isSelf(p) ? "you" : personName(p);
  if (unusable.length) {
    const first = unusable[0];
    const why = first.status === "password" ? "it is password-protected" : first.status === "processing" ? "it is still being read" : "DearPolicy couldn’t find readable text in it";
    const fix = first.status === "password" ? " Upload it again with its password and ask again." : first.status === "processing" ? " Ask again in a few minutes." : " Upload the original PDF or a clearer scan and ask again.";
    const whose = isSelf(p) ? "you" : who;
    return (unusable.length === 1 ? "The only document on file for " + whose + ", “" + first.filename + "”, couldn’t be read yet because " + why + "."
      : "None of the " + unusable.length + " documents on file for " + whose + " could be read yet — for example “" + first.filename + "”, because " + why + ".") + fix;
  }
  return "There are no policies on file for " + who + " yet. Upload a policy schedule or certificate for " + (isSelf(p) ? "yourself" : who) + " on the Documents page and ask again.";
}

/** "Who is covered under the travel plan?": the people each matching policy
 * names, from the documents on file. Null when the question names no plan. */
const PLAN_WORDS: [RegExp, RegExp][] = [
  [/\btravel\b/i, /travel/i], [/\bhospital|\bshield\b|\bmedical\b/i, /hospital|shield|medical|health/i],
  [/\b(?:personal )?accident|\bpa\b/i, /accident|\bpa\b/i], [/\blife\b|\bterm\b|\bdeath\b/i, /life|term|death/i],
  [/\bcritical illness|\bci\b/i, /critical|\bci\b/i], [/\bgroup|\bcompany|\bemployer|\bwork\b/i, /group|employee/i],
];
export const WHO_IS_COVERED = /\bwho(?:['’]s| is| are| all)? (?:covered|insured|included|named|on)\b|\bwho does (?:the |our |my )?[\w\s]{0,30}(?:plan|policy|insurance) (?:cover|include|insure)\b/i;
export function whoIsCoveredAnswer(question: string, family: ClaimPerson[], docs: Map<string, PersonDocument[]>): string | null {
  if (!WHO_IS_COVERED.test(question)) return null;
  const all = family.flatMap((p) => (docs.get(p.id) ?? []).filter((d) => d.status === "ready").map((d) => ({ p, d })));
  const tokens = question.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 5);
  const byName = all.filter(({ d }) => d.name.toLowerCase().split(/[^a-z0-9]+/).some((t) => t.length >= 5 && tokens.includes(t) && !/^(?:insurance|policy|family|annual|group|plan)$/.test(t)));
  const kind = PLAN_WORDS.find(([asks]) => asks.test(question));
  const matched = byName.length ? byName : kind ? all.filter(({ d }) => kind[1].test((d.policyType ?? "") + " " + d.name)) : [];
  if (!matched.length) return kind || byName.length ? "I couldn’t find a policy like that in your household’s documents." : null;
  const plans = new Map<string, ClaimPerson[]>();
  for (const { p, d } of matched) { const list = plans.get(d.name) ?? []; if (!list.includes(p)) list.push(p); plans.set(d.name, list); }
  const names = (people: ClaimPerson[]) => { const n = people.map((p) => isSelf(p) ? "you" : personName(p)); return n.length <= 1 ? n.join("") : n.slice(0, -1).join(", ") + " and " + n.at(-1); };
  return [...plans].map(([plan, people]) => plan + " covers " + names(people) + ", going by the documents on file.").join(" ");
}
