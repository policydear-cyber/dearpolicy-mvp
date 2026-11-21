/**
 * A household member's profile: what DearPolicy asks about each person, and why.
 *
 * Collected (each one changes an answer):
 * - full name as the documents print it (display_name): matching a printed name to a person (lib/policies/linking.ts);
 * - preferred name: what the household calls them in chat;
 * - relationship to the account holder: "my wife", "my son", who is the policyholder, adult or child when nothing
 *   printed says (lib/claims/person.ts personApplicability, lib/benefit-table/child-limit.ts);
 * - date of birth: adult or child, age groups and child limits when the document prints no age for them;
 * - sex: "my daughter" / "my son", "she" / "he" when the relationship word does not say (lib/claims/person.ts
 *   memberRelation).
 * Not collected, because nothing in the answer pipeline uses them: ID numbers (NRIC, passport), occupation class, smoker
 * status, address, contact details. A printed document always wins over the profile.
 */

export const SEX_VALUES = ["female", "male", "unspecified"] as const;
export type MemberSex = (typeof SEX_VALUES)[number];

/** The sex a request sent: a value, null (cleared), undefined (not sent: keep what is stored), or "invalid". */
export function parseSex(input: unknown): MemberSex | null | undefined | "invalid" {
  if (input === undefined) return undefined;
  if (input === null || input === "") return null;
  if (typeof input !== "string") return "invalid";
  const v = input.trim().toLowerCase();
  return (SEX_VALUES as readonly string[]).includes(v) ? (v as MemberSex) : "invalid";
}

/** The gender words read for a stored sex ("unspecified" and unanswered say nothing). */
export function genderOfSex(sex: string | null | undefined): "f" | "m" | null {
  const v = (sex ?? "").trim().toLowerCase();
  return v === "female" ? "f" : v === "male" ? "m" : null;
}

/** What a member's profile still lacks, in the words and order the Family page uses. All four are required when a person
 * is added or edited on the Family page (DC, 17 Nov 2026); a member saved before that keeps working everywhere and is
 * asked to complete them. `sexField`: whether the database can store a sex yet (sql/member-profile.sql applied); before
 * it is, sex is never asked for. "Prefer not to say" ("unspecified") is an answer, not a gap. */
export function profileGaps(m: { relationship?: string | null; date_of_birth?: string | null; sex?: string | null; preferred_name?: string | null }, sexField: boolean): string[] {
  const gaps: string[] = [];
  if (!m.relationship?.trim()) gaps.push("relationship");
  if (!m.date_of_birth) gaps.push("date of birth");
  if (sexField && !m.sex) gaps.push("sex");
  if (!m.preferred_name?.trim()) gaps.push("preferred name");
  return gaps;
}

/** The id suffix of the Family page field for a gap, so "Add now" can put the cursor in the first one missing. */
export const PROFILE_GAP_FIELD: Record<string, string> = { "relationship": "relationship", "date of birth": "dob", "sex": "sex", "preferred name": "preferred" };

/** Where the Family page starts a household (DC, 21 Nov 2026: a new user added her husband without adding herself).
 * - "owner": nobody is on file yet, so the person who signed up is asked about themselves first, as relationship "self",
 *   and the page does not offer anyone else until that is saved;
 * - "family": the owner is on file, so other people can be added;
 * - "family-without-owner": members exist but none is "self" (an account made before this step). Nothing is blocked:
 *   adding others still works and the owner is offered a way to add themselves. */
export type FamilyStart = "owner" | "family" | "family-without-owner";
export function familyStart(family: ReadonlyArray<{ relationship?: string | null }>): FamilyStart {
  if (!family.length) return "owner";
  return family.some((m) => (m.relationship ?? "").trim().toLowerCase() === "self") ? "family" : "family-without-owner";
}

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };
let sexColumnSeen = false;
let lastChecked = 0;
/** Whether family_members.sex exists (sql/member-profile.sql applied). Remembered once seen; while absent, checked again
 * at most once a minute, so applying the migration takes effect without a redeploy. */
export async function hasSexColumn(client: Queryable): Promise<boolean> {
  if (sexColumnSeen) return true;
  if (Date.now() - lastChecked < 60_000) return false;
  lastChecked = Date.now();
  try {
    const { rows } = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='family_members' AND column_name='sex'`);
    sexColumnSeen = rows.length > 0;
  } catch { sexColumnSeen = false; }
  return sexColumnSeen;
}
/** Test hook: forget what hasSexColumn saw. */
export function resetSexColumnCache() { sexColumnSeen = false; lastChecked = 0; }
