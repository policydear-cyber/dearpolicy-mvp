/**
 * Synthetic household for scripts/rag2-calc-boundary-regressions.ts (npm run rag2:calc-boundary-test). Every insurer, product,
 * person and number is invented. Each document isolates one day-count wording: an inclusive "by 12 noon" exception,
 * "on or before", an exclusive "before", the same clause repeated, two different clauses, benefit-level wording over
 * plan-level wording, an endorsement that supersedes the clause from a stated effective date, one whose effective date
 * is not stated, a complete-24-hours rule, and Adult / Child columns for a person whose date of birth is wrong.
 */
function row(cells: string[], widths: number[]): string {
  return cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(Math.max(widths[i] ?? 0, c.length + 3)))).join("").replace(/\s+$/, "");
}
export const ACCOUNT = "00000000-0000-0000-0000-00000000e801";
const id = (n: number) => "78000000-0000-4000-8000-" + String(n).padStart(12, "0");
export type Member = { id: string; name: string; pref: string; rel: string; dob: string | null };
export const M = {
  dana: { id: id(1), name: "Dana Lim Wei Ting", pref: "Dana", rel: "self", dob: "1985-04-10" },
  eli: { id: id(2), name: "Eli Lim Jun Hao", pref: "Eli", rel: "child", dob: "2019-06-01" },
  // A date of birth after the stay asked about (bad data, e.g. a typo for 2017): it must not make her a child.
  fay: { id: id(3), name: "Fay Lim Xin Yi", pref: "Fay", rel: "child", dob: "2027-03-01" },
} satisfies Record<string, Member>;
export type Doc = { key: string; id: string; owner: string; members: string[]; product: string; insurer: string; policyNumber: string; role: "schedule" | "endorsement"; effectiveDate: string | null; hash: string; pages: Record<number, string> };
const W = [40, 14, 14];
const rate = (product: string, insurer: string, extra: string[] = []) => [insurer, `${product} - Schedule`, "Insured: Dana Lim Wei Ting", "", row(["Benefit", "Amount"], [40]), row(["Hospital cash per day", "S$100"], [40]), ...extra].join("\n");
const RULE = "Hospital cash is payable from the first full day of admission.";
const sched = (n: number, key: string, product: string, conditions: Record<number, string[]>, owner = M.dana.id, members = [M.dana.id]): Doc => ({
  key, id: id(100 + n), owner, members, product, insurer: "Brightwater Assurance", policyNumber: "BW-" + key, role: "schedule", effectiveDate: "2026-01-01", hash: "sha256:bound-" + key.toLowerCase(),
  pages: { 1: rate(product, "Brightwater Assurance"), ...Object.fromEntries(Object.entries(conditions).map(([p, lines]) => [Number(p), [`${product} - conditions`, ...lines].join("\n")])) },
});
export const DOCS: Doc[] = [
  sched(1, "BY", "Brightwater Noon Cash", { 2: [RULE, "The day of admission counts as a full day if the insured person is admitted by 12 noon."] }),
  sched(2, "ONB", "Brightwater Noon Cash Plus", { 2: [RULE, "The day of admission counts as a full day if the insured person is admitted on or before 12 noon."] }),
  sched(3, "BEFORE", "Brightwater Morning Cash", { 2: [RULE, "The day of admission counts as a full day if the insured person is admitted before 12 noon."] }),
  sched(4, "DUP", "Brightwater Repeat Cash", { 2: [RULE, "The day of admission counts as a full day if the insured person is admitted before 12 noon."], 3: ["Claims guide", "The day of admission counts as a full day if the insured person is admitted before 12 noon."] }),
  sched(5, "CON", "Brightwater Mixed Cash", { 2: [RULE, "The day of admission counts as a full day if the insured person is admitted before 12 noon."], 3: ["Claims guide", "The day of admission counts as a full day if the insured person is admitted before 3pm."] }),
  sched(6, "SCOPE", "Brightwater Scoped Cash", { 2: [RULE, "The day of admission counts as a full day if the insured person is admitted before 12 noon.", "For hospital cash, the day of admission counts as a full day if the insured person is admitted before 3pm."] }),
  sched(7, "AMD", "Brightwater Amended Cash", { 2: [RULE, "The day of admission counts as a full day if the insured person is admitted before 12 noon."] }),
  { key: "AMDE", id: id(108), owner: M.dana.id, members: [M.dana.id], product: "Brightwater Amended Cash", insurer: "Brightwater Assurance", policyNumber: "BW-AMD", role: "endorsement", effectiveDate: "2026-07-01", hash: "sha256:bound-amde",
    pages: { 1: ["Brightwater Assurance", "Endorsement BW-AMD-E1 to policy BW-AMD", "With effect from 1 July 2026 the day of admission counts as a full day if the insured person is admitted before 6pm."].join("\n") } },
  sched(9, "UND", "Brightwater Undated Cash", { 2: [RULE, "The day of admission counts as a full day if the insured person is admitted before 12 noon."] }),
  { key: "UNDE", id: id(110), owner: M.dana.id, members: [M.dana.id], product: "Brightwater Undated Cash", insurer: "Brightwater Assurance", policyNumber: "BW-UND", role: "endorsement", effectiveDate: null, hash: "sha256:bound-unde",
    pages: { 1: ["Brightwater Assurance", "Endorsement BW-UND-E1 to policy BW-UND", "The day of admission counts as a full day if the insured person is admitted before 6pm."].join("\n") } },
  sched(11, "R24", "Brightwater Day Income", { 2: ["Hospital cash is payable for each complete period of 24 hours in hospital."] }),
  { key: "AGE", id: id(112), owner: M.dana.id, members: [M.dana.id, M.eli.id, M.fay.id], product: "Brightwater Family Cash", insurer: "Brightwater Assurance", policyNumber: "BW-AGE", role: "schedule", effectiveDate: "2026-01-01", hash: "sha256:bound-age",
    pages: { 1: ["Brightwater Assurance", "Brightwater Family Cash - Schedule", "Insured: Dana Lim Wei Ting; Eli Lim Jun Hao; Fay Lim Xin Yi", "", row(["Benefit", "Adult", "Child"], W), row(["Hospital cash per day", "S$150", "S$80"], W)].join("\n"), 2: ["Brightwater Family Cash - conditions", RULE].join("\n") } },
];
