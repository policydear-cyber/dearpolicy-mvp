/**
 * Synthetic households for scripts/rag2-dimensions-regressions.ts: table columns with more than one dimension -- the
 * person / category, the plan / tier, the schedule version (before / after an endorsement) and the benefit stage.
 * Two unrelated families insured by two invented insurers, with different table layouts (tab-separated and
 * space-aligned; flat "Adult – Old" headers and two-level "Adult" over "Before | After" headers) and different version
 * words (Before/After, Previous/Revised, Old/New, Existing/Amended, From/To). All data is invented.
 */
export const ACCOUNT_P = "7d000000-0000-4000-8000-000000000001";
export const ACCOUNT_N = "7d000000-0000-4000-8000-000000000002";
const id = (n: number) => `7e000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const did = (n: number) => `7f000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export type DMember = { id: string; account: string; name: string; pref: string | null; rel: string; notes: string | null; dob: string | null };
export const M = {
  aaron: { id: id(1), account: ACCOUNT_P, name: "Aaron Teo Kah Seng", pref: "Aaron", rel: "self", notes: null, dob: "1979-05-14" },
  bella: { id: id(2), account: ACCOUNT_P, name: "Bella Chua Li Ting", pref: "Bella", rel: "spouse", notes: "wife", dob: "1981-09-03" },
  caleb: { id: id(3), account: ACCOUNT_P, name: "Caleb Teo Yi Xuan", pref: "Caleb", rel: "child", notes: "son", dob: "2015-02-21" },
  devi: { id: id(11), account: ACCOUNT_N, name: "Devi Raman", pref: "Devi", rel: "self", notes: null, dob: "1985-12-01" },
  gopal: { id: id(12), account: ACCOUNT_N, name: "Gopal Krishnan", pref: "Gopal", rel: "spouse", notes: "husband", dob: "1983-07-19" },
  ethan: { id: id(13), account: ACCOUNT_N, name: "Ethan Gopal", pref: "Ethan", rel: "child", notes: "son", dob: "2017-10-30" },
} satisfies Record<string, DMember>;

const sp = (cells: string[], w: number[]) => cells.map((c, i) => (i < cells.length - 1 ? c.padEnd(Math.max(w[i] ?? 18, c.length + 3)) : c)).join("");
const tab = (cells: string[]) => cells.join("\t");

export type DDoc = {
  key: string; id: string; account: string; owner: string; insurer: string; product: string; policyNumber: string; type: string; role: string;
  hash: string; effective: string | null; expiry: string | null; members: { id: string; tier?: string | null }[]; pages: Record<number, string>;
};
const P = M.aaron.id, N = M.devi.id;
export const DOCS: DDoc[] = [
  // ---- Pelican Mutual (tab-separated tables) --------------------------------------------------------------------
  { key: "P_BASE", id: did(1), account: ACCOUNT_P, owner: P, insurer: "Pelican Mutual", product: "Pelican HealthFirst", policyNumber: "PM-HF-40021", type: "hospital", role: "schedule",
    hash: "h-p-base", effective: "2026-01-01", expiry: "2026-12-31", members: [{ id: P }],
    pages: { 1: ["Pelican Mutual", "Pelican HealthFirst - Schedule", "Policy number: PM-HF-40021", "Insured: Aaron Teo Kah Seng", "", tab(["Benefit", "Limit"]), tab(["Yearly claim limit", "S$800,000"]), tab(["Room and board (per day)", "S$400"])].join("\n") } },
  // Previous / Revised (space-aligned), effective 01 Jun 2026.
  { key: "P_ENDT", id: did(2), account: ACCOUNT_P, owner: P, insurer: "Pelican Mutual", product: "Pelican HealthFirst - Endorsement A", policyNumber: "PM-HF-40021", type: "hospital", role: "endorsement",
    hash: "h-p-endt", effective: "2026-06-01", expiry: "2026-12-31", members: [{ id: P }],
    pages: { 1: ["Pelican Mutual", "Endorsement A to policy PM-HF-40021", "This endorsement takes effect on 1 June 2026.", "The schedule of benefits is amended as shown.", "",
      sp(["Benefit", "Previous", "Revised"], [34, 16]), sp(["Yearly claim limit", "S$800,000", "S$1,200,000"], [34, 16]), sp(["Room and board (per day)", "S$400", "S$550"], [34, 16]), "", "Other terms are unchanged."].join("\n") } },
  // Adult / Child schedule, then a two-level Before / After endorsement under Adult and Child.
  { key: "P_FC", id: did(3), account: ACCOUNT_P, owner: P, insurer: "Pelican Mutual", product: "Pelican FamilyCare", policyNumber: "PM-FC-55310", type: "personal_accident", role: "schedule",
    hash: "h-p-fc", effective: "2026-02-01", expiry: "2027-01-31", members: [{ id: P }, { id: M.bella.id }, { id: M.caleb.id }],
    pages: { 1: ["Pelican FamilyCare - Schedule", "Policy number: PM-FC-55310", "", tab(["Benefit", "Adult", "Child"]), tab(["Outpatient fracture benefit", "S$1,000", "S$600"]), tab(["Physiotherapy (per visit)", "S$80", "S$60"])].join("\n") } },
  { key: "P_FC_ENDT", id: did(4), account: ACCOUNT_P, owner: P, insurer: "Pelican Mutual", product: "Pelican FamilyCare - Endorsement 1", policyNumber: "PM-FC-55310", type: "personal_accident", role: "endorsement",
    hash: "h-p-fc-endt", effective: "2026-03-15", expiry: "2027-01-31", members: [{ id: P }, { id: M.bella.id }, { id: M.caleb.id }],
    pages: { 1: ["Endorsement 1 to policy PM-FC-55310", "Effective date: 15 Mar 2026", "", tab(["", "Adult", "", "Child"]), tab(["Benefit", "Before", "After", "Before", "After"]), tab(["Outpatient fracture benefit", "S$1,000", "S$1,400", "S$600", "S$900"])].join("\n") } },
  // Plan tiers.
  { key: "P_TIER", id: did(5), account: ACCOUNT_P, owner: P, insurer: "Pelican Mutual", product: "Pelican WardSelect", policyNumber: "PM-WS-61000", type: "hospital", role: "schedule",
    hash: "h-p-tier", effective: "2026-01-01", expiry: "2026-12-31", members: [{ id: P, tier: "Plan B" }, { id: M.bella.id }],
    pages: { 1: ["Pelican WardSelect - Benefit Table", "", tab(["Benefit", "Plan A", "Plan B"]), tab(["Daily ward benefit", "S$200", "S$350"])].join("\n") } },

  // ---- Northwind General (space-aligned tables) ------------------------------------------------------------------
  { key: "N_BASE", id: did(11), account: ACCOUNT_N, owner: N, insurer: "Northwind General", product: "Northwind MediGuard", policyNumber: "NW-MG-7781", type: "hospital", role: "schedule",
    hash: "h-n-base", effective: "2026-03-01", expiry: "2027-02-28", members: [{ id: N }, { id: M.gopal.id }, { id: M.ethan.id }],
    pages: { 1: ["Northwind General", "Northwind MediGuard - Policy Schedule", "Policy No. NW-MG-7781", "",
      sp(["Benefit", "Adult", "Child"], [32, 14]), sp(["Annual limit", "S$500,000", "S$250,000"], [32, 14]), sp(["Surgical benefit", "S$20,000", "S$10,000"], [32, 14]), sp(["Daily ward allowance", "S$150", "S$100"], [32, 14])].join("\n") } },
  // Old / New with the person in the same header ("Adult – Old").
  { key: "N_ENDT", id: did(12), account: ACCOUNT_N, owner: N, insurer: "Northwind General", product: "Northwind MediGuard - Endorsement 2", policyNumber: "NW-MG-7781", type: "hospital", role: "endorsement",
    hash: "h-n-endt", effective: "2026-08-01", expiry: "2027-02-28", members: [{ id: N }, { id: M.gopal.id }, { id: M.ethan.id }],
    pages: { 1: ["Northwind General", "Endorsement 2 to Policy No. NW-MG-7781", "With effect from 1 August 2026 the policy is amended as follows:", "",
      sp(["Benefit", "Adult – Old", "Adult – New", "Child – Old", "Child – New"], [22, 14, 14, 14]), sp(["Annual limit", "S$500,000", "S$650,000", "S$250,000", "S$300,000"], [22, 14, 14, 14])].join("\n") } },
  // Existing / Amended, effective in the future (01 Dec 2026).
  { key: "N_ENDT_FUT", id: did(13), account: ACCOUNT_N, owner: N, insurer: "Northwind General", product: "Northwind MediGuard - Endorsement 3", policyNumber: "NW-MG-7781", type: "hospital", role: "endorsement",
    hash: "h-n-endt-fut", effective: "2026-12-01", expiry: "2027-02-28", members: [{ id: N }, { id: M.gopal.id }, { id: M.ethan.id }],
    pages: { 1: ["Endorsement 3 to Policy No. NW-MG-7781", "Effective date: 01 Dec 2026", "", sp(["Benefit", "Existing", "Amended"], [32, 14]), sp(["Surgical benefit", "S$20,000", "S$26,000"], [32, 14])].join("\n") } },
  // From / To, effective 01 Apr 2026 and ended 30 Jun 2026.
  { key: "N_ENDT_EXP", id: did(14), account: ACCOUNT_N, owner: N, insurer: "Northwind General", product: "Northwind MediGuard - Temporary Endorsement", policyNumber: "NW-MG-7781", type: "hospital", role: "endorsement",
    hash: "h-n-endt-exp", effective: "2026-04-01", expiry: "2026-06-30", members: [{ id: N }, { id: M.gopal.id }, { id: M.ethan.id }],
    pages: { 1: ["Temporary endorsement to Policy No. NW-MG-7781", "Effective date: 01 Apr 2026 (this endorsement ends on 30 Jun 2026)", "", sp(["Benefit", "From", "To"], [32, 14]), sp(["Daily ward allowance", "S$150", "S$200"], [32, 14])].join("\n") } },
  // Filed under this policy's number, but its own text amends another policy.
  { key: "N_MISFILED", id: did(15), account: ACCOUNT_N, owner: N, insurer: "Northwind General", product: "Northwind - Endorsement 9", policyNumber: "NW-MG-7781", type: "hospital", role: "endorsement",
    hash: "h-n-misfiled", effective: "2026-04-01", expiry: "2027-02-28", members: [{ id: N }],
    pages: { 1: ["Endorsement 9 to Policy No. NW-TR-1200", "Effective date: 01 Apr 2026", "", sp(["Benefit", "Before", "After"], [32, 14]), sp(["Surgical benefit", "S$20,000", "S$99,000"], [32, 14])].join("\n") } },
  // An endorsement of a policy this household does not hold.
  { key: "N_UNREL", id: did(16), account: ACCOUNT_N, owner: N, insurer: "Northwind General", product: "Northwind - Endorsement 4", policyNumber: "NW-ZZ-0404", type: "hospital", role: "endorsement",
    hash: "h-n-unrel", effective: "2026-04-01", expiry: "2027-02-28", members: [{ id: N }],
    pages: { 1: ["Endorsement 4 to Policy No. NW-ZZ-0404", "Effective date: 01 Apr 2026", "", sp(["Benefit", "Before", "After"], [32, 14]), sp(["Annual limit", "S$500,000", "S$777,000"], [32, 14])].join("\n") } },
  // Another policy of the household (a different product).
  { key: "N_TRAVEL", id: did(17), account: ACCOUNT_N, owner: N, insurer: "Northwind General", product: "Northwind Voyager", policyNumber: "NW-TR-1200", type: "travel", role: "schedule",
    hash: "h-n-travel", effective: "2026-01-01", expiry: "2026-12-31", members: [{ id: N }],
    pages: { 1: ["Northwind Voyager - Travel Schedule", "", sp(["Benefit", "Limit"], [32]), sp(["Overseas medical expenses", "S$300,000"], [32])].join("\n") } },
  // Benefit stages.
  { key: "N_CI", id: did(18), account: ACCOUNT_N, owner: N, insurer: "Northwind General", product: "Northwind CriticalCare", policyNumber: "NW-CC-3030", type: "critical_illness", role: "schedule",
    hash: "h-n-ci", effective: "2026-01-01", expiry: "2026-12-31", members: [{ id: N }],
    pages: { 1: ["Northwind CriticalCare - Benefit Schedule", "", sp(["Benefit", "Early stage", "Intermediate stage", "Advanced stage"], [22, 16, 20]), sp(["Cancer benefit", "S$25,000", "S$50,000", "S$100,000"], [22, 16, 20])].join("\n") } },
];
export const doc = (key: string) => DOCS.find((d) => d.key === key)!;
