/**
 * Round 6: what is on file for each person, in household words -- the
 * policies DearPolicy can answer from, the group booklets that name them,
 * and the documents it could not read (and why, in a sentence the person can
 * act on). Used wherever an answer would otherwise say something vague like
 * "no verified personalised policy evidence".
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { documentName, referenceRoles } from "@/lib/policies/inventory";
import { INCOMPLETE_PDF_MESSAGE, PDF_PASSWORD_INCORRECT_MESSAGE, PDF_PASSWORD_REQUIRED_MESSAGE, UNOPENABLE_DOCUMENT_MESSAGE, UNREADABLE_PHOTO_MESSAGE } from "@/lib/documents/processing-errors";
import type { ClaimPerson } from "@/lib/claims/person";
import type { ChatCitation } from "@/types";

export type PersonDocument = { id: string; name: string; filename: string; role: string | null; policyType: string | null; confirmed: boolean; tier: string | null;
  /** V1.3: the insurer recorded for the document (null when none). */
  insurer?: string | null;
  status: "ready" | "processing" | "password" | "unreadable"; effectiveDate: string | null; renewalOrExpiryDate: string | null;
  /** Round 10: why an unreadable upload could not be read, for the advice that fits it. */
  reason?: "photo" | "incomplete" | "unopenable" | "scan" };

export async function documentsByPerson(accountId: string, people: ClaimPerson[]): Promise<Map<string, PersonDocument[]>> {
  const out = new Map<string, PersonDocument[]>(people.map((p) => [p.id, []]));
  if (!people.length) return out;
  const r = await query<{ id: string; product_name: string | null; insurer: string | null; original_filename: string; policy_number: string | null; document_role: string | null; policy_type: string | null; personal_coverage_confirmed: boolean;
    processing_status: string; processing_error: string | null; family_member_id: string; tier: string | null; effective_date: string | null; renewal_or_expiry_date: string | null }>(
    `SELECT p.id::text AS id,p.product_name,p.insurer,p.original_filename,p.policy_number,p.document_role,p.policy_type,p.personal_coverage_confirmed,p.processing_status,p.processing_error,
            pm.family_member_id::text AS family_member_id,to_jsonb(pm)->>'benefit_tier' AS tier,p.effective_date::text,p.renewal_or_expiry_date::text
       FROM policies p JOIN policy_members pm ON pm.policy_id=p.id AND pm.account_id=p.account_id
      WHERE p.account_id=$1 AND pm.family_member_id::text=ANY($2::text[]) AND ${activePredicate("p")} AND p.superseded_at IS NULL
      ORDER BY p.created_at,p.id`, [accountId, people.map((p) => p.id)]);
  for (const row of r.rows) {
    const status: PersonDocument["status"] = row.processing_status === "ready" ? "ready"
      : row.processing_status === "failed" ? ([PDF_PASSWORD_REQUIRED_MESSAGE, PDF_PASSWORD_INCORRECT_MESSAGE].includes(row.processing_error ?? "") || /password/i.test(row.processing_error ?? "") ? "password" : "unreadable")
      : "processing";
    const error = row.processing_error ?? "";
    const reason = status !== "unreadable" ? undefined : error === UNREADABLE_PHOTO_MESSAGE ? "photo" as const : error === INCOMPLETE_PDF_MESSAGE ? "incomplete" as const : error === UNOPENABLE_DOCUMENT_MESSAGE ? "unopenable" as const : "scan" as const;
    out.get(row.family_member_id)?.push({ id: row.id, name: documentName(row), filename: row.original_filename, role: row.document_role, insurer: row.insurer?.trim() || null,
      policyType: row.policy_type, confirmed: row.personal_coverage_confirmed, tier: row.tier, status, effectiveDate: row.effective_date, renewalOrExpiryDate: row.renewal_or_expiry_date, ...(reason ? { reason } : {}) });
  }
  return out;
}

export function personName(p: ClaimPerson) { return p.preferred_name?.trim() || p.display_name; }
const isSelf = (p: ClaimPerson) => /^self$/i.test(p.relationship ?? "");
/** "Mei Ling has" / "You have" */
export function hasPhrase(p: ClaimPerson) { return isSelf(p) ? "You have" : personName(p) + " has"; }
export function possessive(p: ClaimPerson) { return isSelf(p) ? "your" : personName(p) + "’s"; }

export function isGroupGuide(d: Pick<PersonDocument, "role" | "confirmed">) { return !d.confirmed && referenceRoles.has(d.role ?? ""); }

/** One sentence per document this person has that DearPolicy could not use.
 * Round 10: with `said` (shared across the people of one household answer),
 * what to do about it is said once, not once per person -- a household where
 * several people each have a locked document gets the instruction once. */
export function unusableDocumentLines(p: ClaimPerson, docs: PersonDocument[], said?: Set<string>): string[] {
  const lines: string[] = [];
  const once = (fix: string) => { if (said?.has(fix)) return ""; said?.add(fix); return " " + fix; };
  // Two people's documents can share a file name: the second is said as theirs.
  const whose = (sentence: string) => {
    if (!said) return sentence;
    const own = said.has(sentence) ? possessive(p).replace(/^./, (c) => c.toUpperCase()) + " " + sentence : sentence;
    said.add(sentence); return own;
  };
  for (const d of docs) {
    if (d.status === "password") lines.push(whose("“" + d.filename + "” couldn’t be read because it is password-protected.") + once("Upload it again with its password and DearPolicy will read it automatically."));
    // Round 10: the advice that fits why it could not be read.
    else if (d.status === "unreadable" && d.reason === "photo") lines.push(whose("“" + d.filename + "” is a photo too blurred, dark or faint to read.") + once("Take it again — page flat, good light, no shadow, phone steady and straight above it, the whole page in the frame — or upload the insurer’s PDF."));
    else if (d.status === "unreadable" && d.reason === "incomplete") lines.push(whose("“" + d.filename + "” is incomplete — the file stops part-way, as when a download is cut off — so it couldn’t be opened.") + once("Download it again from the insurer’s email or website and upload the new copy."));
    else if (d.status === "unreadable" && d.reason === "unopenable") lines.push(whose("“" + d.filename + "” couldn’t be opened — the file may be damaged.") + once("Upload the original file again, or ask the insurer for a fresh copy."));
    else if (d.status === "unreadable") lines.push(whose("“" + d.filename + "” couldn’t be read.") + once("The original PDF or a clearer scan would let DearPolicy read it."));
    else if (d.status === "ready" && d.role === "app_screenshot") lines.push(whose("“" + d.filename + "” is a screenshot of the insurer’s app" + (d.name && d.name !== d.filename && !/\bapp screenshot(?: \(ending \w+\))?$/.test(d.name) ? " showing " + d.name : "") + " — a summary from the app, not a policy document, so its figures are not treated as confirmed cover."));
    else if (d.status === "processing") lines.push(whose("“" + d.filename + "” is still being read.") + once("Ask again in a few minutes."));
  }
  return lines;
}

/** Said when a person has no policy DearPolicy can answer from. */
export function noPoliciesSentence(p: ClaimPerson, docs: PersonDocument[]): string {
  const unusable = docs.filter((d) => d.status !== "ready");
  const who = isSelf(p) ? "you" : personName(p);
  // Round 10: an app screenshot is on file, but it is not a policy document.
  const shots = docs.filter((d) => d.status === "ready" && d.role === "app_screenshot");
  if (shots.length && !unusable.length) return "No policy document is on file for " + who + " yet. " + unusableDocumentLines(p, shots).join(" ") + " Upload the policy schedule itself to confirm the cover.";
  if (unusable.length) {
    const first = unusable[0];
    const why = first.status === "password" ? "it is password-protected" : first.status === "processing" ? "it is still being read" : first.reason === "photo" ? "the photo is too blurred or dark to read"
      : first.reason === "incomplete" ? "the file is incomplete (cut off part-way)" : first.reason === "unopenable" ? "the file couldn’t be opened" : "DearPolicy couldn’t find readable text in it";
    const fix = first.status === "password" ? " Upload it again with its password and ask again." : first.status === "processing" ? " Ask again in a few minutes." : first.reason === "photo" ? " Take the photo again — flat, in good light, the whole page in the frame — or upload the insurer’s PDF."
      : first.reason === "incomplete" ? " Download it again from the insurer and upload the new copy." : " Upload the original PDF or a clearer scan and ask again.";
    const whose = isSelf(p) ? "you" : who;
    return (unusable.length === 1 ? "The only document on file for " + whose + ", “" + first.filename + "”, couldn’t be read yet because " + why + "."
      : "None of the " + unusable.length + " documents on file for " + whose + " could be read yet — for example “" + first.filename + "”, because " + why + ".") + fix
      + (shots.length ? " " + unusableDocumentLines(p, shots).join(" ") : "");
  }
  return "There are no policies on file for " + who + " yet. Upload a policy schedule or certificate for " + (isSelf(p) ? "yourself" : who) + " on the Documents page and ask again.";
}

/** "Who is covered under the travel plan?": the people each matching policy
 * names, from the documents on file. Null when the question names no plan. */
const PLAN_WORDS: [RegExp, RegExp][] = [
  [/\btravel\b/i, /travel/i], [/\bhospital|\bshield\b|\bmedical\b/i, /hospital|(?<!care)shield|medical|health/i],
  [/\b(?:personal )?accident|\bpa\b/i, /accident|\bpa\b/i], [/\blife\b|\bterm\b|\bdeath\b/i, /life|term|death/i],
  [/\bcritical illness|\bci\b/i, /critical|\bci\b/i], [/\bgroup|\bcompany|\bemployer|\bwork\b/i, /group|employee/i],
];
export const WHO_IS_COVERED = /\bwho(?:['’]s| is| are| all)? (?:covered|insured|included|named|on)\b|\bwho does (?:the |our |my )?[\w\s]{0,30}(?:plan|policy|insurance) (?:cover|include|insure)\b/i;
export function whoIsCoveredAnswer(question: string, family: ClaimPerson[], docs: Map<string, PersonDocument[]>): string | null {
  return whoIsCovered(question, family, docs)?.text ?? null;
}
/** Round 12: the same answer with the documents it names, so the page that lists the insured people is cited. */
export function whoIsCovered(question: string, family: ClaimPerson[], docs: Map<string, PersonDocument[]>): { text: string; matched: { person: ClaimPerson; document: PersonDocument }[] } | null {
  if (!WHO_IS_COVERED.test(question)) return null;
  const all = family.flatMap((p) => (docs.get(p.id) ?? []).filter((d) => d.status === "ready").map((d) => ({ p, d })));
  const tokens = question.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 5);
  const byName = all.filter(({ d }) => d.name.toLowerCase().split(/[^a-z0-9]+/).some((t) => t.length >= 5 && tokens.includes(t) && !/^(?:insurance|policy|family|annual|group|plan)$/.test(t)));
  const kind = PLAN_WORDS.find(([asks]) => asks.test(question));
  const matched = byName.length ? byName : kind ? all.filter(({ d }) => kind[1].test((d.policyType ?? "") + " " + d.name)) : [];
  if (!matched.length) return kind || byName.length ? { text: "I couldn’t find a policy like that in your household’s documents.", matched: [] } : null;
  const plans = new Map<string, ClaimPerson[]>();
  for (const { p, d } of matched) { const list = plans.get(d.name) ?? []; if (!list.includes(p)) list.push(p); plans.set(d.name, list); }
  const names = (people: ClaimPerson[]) => { const n = people.map((p) => isSelf(p) ? "you" : personName(p)); return n.length <= 1 ? n.join("") : n.slice(0, -1).join(", ") + " and " + n.at(-1); };
  return { text: [...plans].map(([plan, people]) => plan + " covers " + names(people) + ", going by the documents on file.").join(" "), matched: matched.map(({ p, d }) => ({ person: p, document: d })) };
}
/** Round 12: the page of each matched document that names the most of its insured people (the schedule's
 * "Insured persons" table), for the citation of a who-is-covered answer. */
export async function whoIsCoveredCitations(accountId: string, matched: { person: ClaimPerson; document: PersonDocument }[]): Promise<ChatCitation[]> {
  const ids = [...new Set(matched.map((m) => m.document.id))];
  if (!ids.length) return [];
  const r = await query<{ policy_id: string; page_number: number; text: string | null }>(
    "SELECT policy_id::text AS policy_id,page_number,text FROM policy_pages WHERE account_id=$1 AND policy_id::text=ANY($2::text[]) ORDER BY page_number", [accountId, ids]);
  const out: ChatCitation[] = [];
  for (const id of ids) {
    const people = matched.filter((m) => m.document.id === id).map((m) => m.person);
    const doc = matched.find((m) => m.document.id === id)!.document;
    let best: { page: number; hits: number } | null = null;
    for (const row of r.rows.filter((x) => x.policy_id === id)) {
      const text = (row.text ?? "").toLowerCase();
      const hits = people.filter((p) => [p.display_name, p.preferred_name ?? ""].some((n) => n.trim().length >= 3 && text.includes(n.toLowerCase()))).length
        + (/\binsured (?:persons?|members?)|\bpersons? (?:insured|covered)|\bcovered persons?/i.test(text) ? 0.5 : 0);
      if (hits > 0 && (!best || hits > best.hits)) best = { page: row.page_number, hits };
    }
    if (best) out.push({ chunkId: "page:" + id + ":" + best.page, policyId: id, policyName: doc.name, pageStart: best.page, pageEnd: best.page, personalEvidence: doc.confirmed, evidenceLabel: "Policy schedule" });
  }
  return out;
}
