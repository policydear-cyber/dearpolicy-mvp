/** Every policy on file is treated as in force (DC, 31 Oct: "ignore all expiry dates ... assume all policies are still in
 * force"). A printed end date, expiry date or period that has passed (or not started) never changes a policy's status,
 * in chat's status lines, the premium-evidence check, the claim "possible benefit" check, or the dates note the chat
 * model is given. Made-up documents in several markets and date layouts; no database, no network, no model.
 *   npm run -s coverage:in-force-test */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("no network"); }) as typeof fetch;

import { printedStatus, statusSentence } from "@/lib/chat/policy-status";
import { assessCurrentness } from "@/lib/policies/currentness";
import { eventFitIssue } from "@/lib/claims/event-fit";
import { periodsNote } from "@/lib/simple-chat/hook";

let pass = 0, fail = 0;
function t(name: string, ok: boolean, got?: unknown) {
  if (ok) { pass++; console.log(`ok ${name}`); } else { fail++; console.log(`FAIL ${name}${got === undefined ? "" : ` -> ${JSON.stringify(got)}`}`); }
}

const today = "2026-10-31";
// Periods printed long ago, in the long-date layout printedStatus reads, from several markets and insurers.
const pages = [
  { name: "SG single trip", text: "TRAVEL CERTIFICATE\nKestrel Travel Insurance\nPeriod of insurance 29 September 2026 to 4 October 2026\nInsured: Ana Reyes" },
  { name: "MY annual plan", text: "SIJIL INSURANS\nMaju Takaful Perjalanan\nPeriod of cover 1 January 2024 to 31 December 2024\nRM 50,000" },
  { name: "UK term life", text: "POLICY SCHEDULE\nHarbour Life Term Assurance\nPolicy term 1 March 2005 to 1 March 2025\n£250,000" },
];
for (const p of pages) {
  const st = printedStatus([{ page: 1, text: p.text }], null, today);
  t(`${p.name}: a printed period that has passed reads in force, never ended`, st.state === "in_force", st);
  t(`${p.name}: no status sentence says it expired`, statusSentence(p.name, st) === null, statusSentence(p.name, st));
}
t("a stored expiry date in the past (no printed period) reads in force", printedStatus([{ page: 1, text: "POLICY SCHEDULE\nAcme Health" }], "2020-06-30", today).state === "in_force");
// Content the document itself states still reads as printed (a lapse notice is the insurer's own words, not a date check).
t("a lapse notice still reads as printed", printedStatus([{ page: 1, text: "Your policy lapsed on 17 March 2026." }], null, today).state === "lapsed");

// Premium evidence: a passed expiry date with no receipt is never "expiry passed".
for (const expiry of ["2025-01-15", "2010-12-31", "2026-10-30"]) {
  const c = assessCurrentness({ now: new Date(`${today}T04:00:00Z`), lastEvidenceOn: null, renewalOrExpiryDate: expiry });
  t(`currentness with expiry ${expiry} passed is not expiry_date_passed`, c.state !== ("expiry_date_passed" as string) && !/has already passed|expiry date of/i.test(c.detail), c);
}

// Claims: a policy whose printed expiry passed, or which starts after the event, is never ruled out by the date.
for (const [what, args] of [
  ["expiry passed, event after it", { expiryDate: "2025-01-15", expiryPassed: true, eventDate: "2026-10-20" }],
  ["expiry passed, no event date", { expiryDate: "2025-01-15", expiryPassed: true }],
] as const) {
  const issue = eventFitIssue({ benefitTitle: "Accidental death benefit", policyName: "Harbour Accident Plan", ...args });
  t(`claims: ${what} gives no date issue`, issue === null, issue);
}
// An event before the cover's own start date is still not a possible benefit (a start date, not an expiry), as the death
// and critical illness calculators check.
t("claims: an event before the cover starts is still flagged (not_started)",
  eventFitIssue({ benefitTitle: "Accidental death benefit", policyName: "Harbour Accident Plan", effectiveDate: "2026-06-01", expiryPassed: false, eventDate: "2026-01-10" })?.kind === "not_started");
// Location still matters (not a date): overseas-only cover for an event in Singapore.
t("claims: overseas-only cover for an event in Singapore is still flagged (location, not date)",
  eventFitIssue({ benefitTitle: "Overseas medical expenses", policyType: "travel", expiryPassed: false, eventLocation: "Singapore" })?.kind === "location");

// The dates note the chat model is given never says ended, running or not started.
const household = { documents: [
  { productName: "Kestrel Travel Insurance", name: "trip.pdf", pages: [{ page: 1, text: "Period of insurance: 29/09/2026 to 04/10/2026" }] },
  { productName: "Maju Takaful", name: "maju.pdf", pages: [{ page: 1, text: "Tempoh: 01/01/2030 to 31/12/2030" }] },
] } as never;
const note = periodsNote(household, new Date(`${today}T04:00:00Z`));
t("chat dates note keeps the printed dates", note.includes("29/09/2026 to 04/10/2026") && note.includes("01/01/2030 to 31/12/2030"), note);
t("chat dates note never says ended, running or not started", !/ended|running|not started/i.test(note), note);

t("no outbound fetch", fetches === 0, fetches);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
