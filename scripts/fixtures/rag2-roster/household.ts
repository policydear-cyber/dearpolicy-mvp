/**
 * Synthetic household for scripts/rag2-roster-regressions.ts (npm run rag2:roster-test). Every insurer, scheme,
 * person, ID and number is invented. A group certificate prints one insured person per ROW under each product's
 * heading ("Particulars of Insured Person(s) and Sum Assured" -- masked ID | name | amount | effective date), with the
 * first product heading directly under the column caption; the scheme's wording prints a schedule of compensation as
 * a percentage of the sum insured. A plain schedule (a "Life Assured" line, then benefit rows) is the control.
 */
export const ACCOUNT = "00000000-0000-0000-0000-00000000e901";
const id = (n: number) => "79000000-0000-4000-8000-" + String(n).padStart(12, "0");
export type Member = { id: string; name: string; pref: string | null; rel: string; dob: string | null };
export const M = {
  // The household records "Alex Goh"; the certificate prints "Goh Wei Ming, Alex".
  alex: { id: id(1), name: "Alex Goh", pref: "Alex", rel: "self", dob: "1984-02-11" },
  bea: { id: id(2), name: "Bea Tan Hui Min", pref: "Bea", rel: "spouse", dob: "1986-07-23" },
  // Linked to the scheme in the household's records, but not printed on the certificate.
  cai: { id: id(3), name: "Cai Goh Jun Le", pref: "Cai", rel: "child", dob: "2016-05-02" },
} satisfies Record<string, Member>;
export type Doc = { key: string; id: string; owner: string; members: string[]; product: string; insurer: string; policyNumber: string; role: "schedule" | "endorsement"; effectiveDate: string | null; hash: string; pages: Record<number, string> };
const pad = (cells: string[], w: number[]) => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(Math.max(w[i] ?? 0, c.length + 3)))).join("");
const W = [14, 26, 14, 8];
const person = (masked: string, name: string, amount: string) => pad([masked, name, amount, "As of", "01/04/2024"], W);
export const DOCS: Doc[] = [
  { key: "CERT", id: id(101), owner: M.alex.id, members: [M.alex.id, M.bea.id, M.cai.id], product: "Harbourline Civil Service Group Scheme - Certificate", insurer: "Harbourline Life", policyNumber: "HL7700123", role: "schedule", effectiveDate: "2024-04-01", hash: "sha256:roster-cert",
    pages: { 1: [
      "CERTIFICATE OF GROUP INSURANCE",
      "This is to certify that the person(s) named herein is/are insured with \"Harbourline Life\" for cover(s) as indicated:",
      "HARBOURLINE CIVIL SERVICE GROUP SCHEME (GROUP POLICY NO. GX55001)   Page 1 of 1",
      "Product, Policy Number, Particulars of Insured Person(s) and Sum Assured/Medical Plan   Effective Date",
      "GROUP TERM LIFE(POLICY NO.HL7700123)",
      person("T****771K", "Goh Wei Ming, Alex", "S$1,000,000"),
      person("T****302B", "Tan Hui Min Bea", "S$500,000"),
      "GROUP PERSONAL ACCIDENT(POLICY NO. HL7700123)",
      person("T****771K", "Goh Wei Ming, Alex", "S$600,000"),
      person("T****302B", "Tan Hui Min Bea", "S$400,000"),
      "GROUP LIVING CARE(POLICY NO. HL7700123)",
      person("T****771K", "Goh Wei Ming, Alex", "S$350,000"),
      person("T****302B", "Tan Hui Min Bea", "S$250,000"),
      "GROUP LIVING CARE PLUS(POLICY NO. HL7700123)",
      person("T****771K", "Goh Wei Ming, Alex", "S$300,000"),
      person("T****302B", "Tan Hui Min Bea", "S$200,000"),
    ].join("\n") } },
  { key: "WORDING", id: id(102), owner: M.alex.id, members: [M.alex.id, M.bea.id, M.cai.id], product: "Harbourline Civil Service Group Personal Accident - Policy Wording", insurer: "Harbourline Life", policyNumber: "HL7700123", role: "schedule", effectiveDate: "2024-04-01", hash: "sha256:roster-wording",
    pages: { 1: [
      "Harbourline Life - Group Personal Accident (Policy No. HL7700123)",
      "Schedule of Compensation",
      "",
      pad(["Injury", "% of Sum Insured"], [44]),
      pad(["Accidental death", "100%"], [44]),
      pad(["Fracture of arm", "20%"], [44]),
      pad(["Fracture of leg", "25%"], [44]),
    ].join("\n") } },
  { key: "PLAIN", id: id(103), owner: M.alex.id, members: [M.alex.id], product: "Harbourline Term Protect - Schedule", insurer: "Harbourline Life", policyNumber: "HL8800456", role: "schedule", effectiveDate: "2024-01-01", hash: "sha256:roster-plain",
    pages: { 1: [
      "Harbourline Term Protect - Policy Schedule",
      "",
      pad(["Life Assured", "Alex Goh"], [30]),
      pad(["Death benefit", "S$200,000"], [30]),
      pad(["Total and permanent disability", "S$200,000"], [30]),
    ].join("\n") } },
];
export const doc = (key: string) => DOCS.find((d) => d.key === key)!;
