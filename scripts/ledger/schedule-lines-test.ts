/** Family and Coverage agree with Home for a household on Coverage rows (the benefit table switched off). A schedule line
 * that prints no amount ("Hospitalisation"), or an amount with no stated currency ("Disability Income 7,500"), never
 * becomes a Coverage row, so the person Home listed as covered was "Nothing found" on Family and "No cover was found" on
 * Coverage (new-user walkthrough, 31 Oct). The rule now: a confirmed, checked schedule line is cover on every page.
 * Made-up households in AUD, GBP, MYR and SGD, invented insurers and plan names. No model, no database, no network.
 *   npm run ledger:schedule-lines-test */
import { coveragePersonKinds, kindOfCategory, ledgerKindsByPerson, scheduleOnlyLines, type KindRow, type ScheduleLine } from "@/components/cover-kinds";
import { COVERAGE_CATEGORIES } from "@/lib/insurance";

const realFetch = globalThis.fetch;
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("no network in this test"); }) as typeof fetch;

let pass = 0, fail = 0;
function t(id: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; return; }
  fail++; console.log(`FAIL ${id}: ${JSON.stringify(detail)}`);
}
type Row = KindRow & { id: string; familyMemberId: string; policyId: string | null; status: string; origin: string };
const row = (o: Partial<Row> & { familyMemberId: string; eventType: string }): Row =>
  ({ id: Math.random().toString(36).slice(2), policyId: null, status: "confirmed", origin: "schedule", ...o });
const line = (familyMemberId: string, policyId: string, category: string, extra: Partial<ScheduleLine> = {}): ScheduleLine =>
  ({ familyMemberId, policyId, category, planName: null, insurer: null, sourcePage: 1, ...extra });

// Every category a schedule line can carry has a kind of its own: none falls to "Other" by accident.
for (const c of COVERAGE_CATEGORIES) t(`category "${c}" has a kind`, kindOfCategory(c).id !== "other", kindOfCategory(c));
t("hospital cash is hospital", kindOfCategory("Hospital Cash").id === "hospital");
t("disability income is disability", kindOfCategory("Disability Income").id === "disability");
t("early CI is critical illness", kindOfCategory("Early Critical Illness").id === "ci");
t("investment is savings and investment", kindOfCategory("Investment").id === "savings");
t("case and spacing do not matter", kindOfCategory("  personal accident ").id === "accident");
t("a category outside the list is sorted by its words", kindOfCategory("Dental cover (medical)").id === "hospital");
t("an unknown category is Other, never a guess", kindOfCategory("Pet insurance").id === "other");

// AU household (the walkthrough's shape): Linh has Coverage rows; Daniel's three schedule lines carry no amount, an
// amount with no currency, or a currency with no amount, so none became a Coverage row.
{
  const linh = "m-linh", daniel = "m-daniel";
  const rows = [row({ familyMemberId: linh, policyId: "pol-life", eventType: "death" }), row({ familyMemberId: linh, policyId: "pol-life", eventType: "tpd" })];
  const raw = [
    line(daniel, "pol-health", "Hospitalisation", { planName: "Wattle Health Gold", insurer: "Wattle Mutual", sourcePage: 2 }),
    line(daniel, "pol-ip", "Disability Income", { planName: "Banksia Income Protect", sourcePage: 3 }),
    line(daniel, "pol-travel", "Travel", { planName: "Kookaburra Trip Cover" }),
    line(linh, "pol-life", "Death"),
  ];
  const lines = scheduleOnlyLines(raw, rows);
  t("AU: Linh's Death line is already a row, so it is not repeated", !lines.some((l) => l.familyMemberId === linh), lines);
  t("AU: Daniel's three lines are kept", lines.filter((l) => l.familyMemberId === daniel).length === 3, lines);
  const fam = ledgerKindsByPerson(rows, lines);
  t("AU Family: Daniel is covered for hospital, disability and travel", JSON.stringify(fam[daniel]) === JSON.stringify(["Disability", "Hospital and medical", "Travel"]), fam);
  t("AU Family: Linh unchanged", JSON.stringify(fam[linh]) === JSON.stringify(["Death", "Disability"]), fam);
  t("AU Family: without the lines Daniel is missing (the bug)", !ledgerKindsByPerson(rows, [])[daniel]);
  const cov = coveragePersonKinds([], [], lines.filter((l) => l.familyMemberId === daniel));
  t("AU Coverage: Daniel's kinds are listed", cov.kinds.map((k) => k.id).join() === "disability,hospital,travel", cov.kinds.map((k) => k.id));
  t("AU Coverage: none is 'to confirm'", cov.kinds.every((k) => !k.toConfirm));
  t("AU Coverage: hospital is not called missing", !cov.gaps.missing.includes("hospital or medical cover"), cov.gaps);
  t("AU Coverage: death, CI and accident are still called missing", ["death cover", "critical illness", "accident cover"].every((g) => cov.gaps.missing.includes(g)), cov.gaps);
  t("AU Coverage: Daniel counts as having cover (no 'No cover was found')", cov.count === 3);
  t("AU Coverage: the line keeps its plan and page", cov.kinds.find((k) => k.id === "hospital")!.lines[0].sourcePage === 2);
}

// UK household: a priced line already a row in GBP, and an unpriced CI line on the same policy, a different kind.
{
  const ann = "m-ann";
  const rows = [row({ familyMemberId: ann, policyId: "pol-uk", eventType: "death" })];
  const lines = scheduleOnlyLines([line(ann, "pol-uk", "Death"), line(ann, "pol-uk", "Critical Illness")], rows);
  t("UK: the death line is a row already; the CI line is kept", lines.length === 1 && lines[0].category === "Critical Illness", lines);
  t("UK Family: Death and Critical illness", JSON.stringify(ledgerKindsByPerson(rows, lines)[ann]) === JSON.stringify(["Death", "Critical illness"]));
}

// MY household: the same kind from two different policies. A row from one policy never hides a line from another.
{
  const aiman = "m-aiman";
  const rows = [row({ familyMemberId: aiman, policyId: "pol-takaful-a", eventType: "hospital_medical_expense" })];
  const lines = scheduleOnlyLines([line(aiman, "pol-takaful-a", "Hospitalisation"), line(aiman, "pol-takaful-b", "Hospital Cash")], rows);
  t("MY: only the other policy's line is kept", lines.length === 1 && lines[0].policyId === "pol-takaful-b", lines);
  const cov = coveragePersonKinds(rows, rows, lines);
  t("MY Coverage: one hospital kind holding the row and the line", cov.kinds.length === 1 && cov.kinds[0].rows.length === 1 && cov.kinds[0].lines.length === 1, cov.kinds);
}

// A row of the same kind for another person never hides this person's line (people are kept apart by record id).
{
  const rows = [row({ familyMemberId: "m-a", policyId: "pol-family", eventType: "hospital_medical_expense" })];
  const lines = scheduleOnlyLines([line("m-b", "pol-family", "Hospitalisation")], rows);
  t("shared policy: the spouse's line is kept", lines.length === 1, lines);
}

// A rejected row hides nothing; a row the household added (no policy) hides nothing; two lines of one kind from one policy are one.
{
  const p = "m-p";
  const rows = [row({ familyMemberId: p, policyId: "pol-1", eventType: "travel_medical", status: "rejected" }), row({ familyMemberId: p, policyId: null, eventType: "travel_medical", origin: "person" })];
  const lines = scheduleOnlyLines([line(p, "pol-1", "Travel"), line(p, "pol-1", "Travel", { sourcePage: 4 })], rows);
  t("rejected row and own entry hide nothing; duplicate lines are one", lines.length === 1 && lines[0].sourcePage === 1, lines);
}

// SG household: a line makes a kind confirmed on Family even when the only row of that kind is a plan type's guess.
{
  const s = "m-sg";
  const rows = [row({ familyMemberId: s, policyId: "pol-sg-a", eventType: "accidental_death", status: "proposed" })];
  t("SG: a plan-type guess alone stays 'to confirm'", JSON.stringify(ledgerKindsByPerson(rows, [])[s]) === JSON.stringify(["Accidents and injuries (to confirm)"]));
  const lines = scheduleOnlyLines([line(s, "pol-sg-b", "Personal Accident")], rows);
  t("SG: a schedule line from another policy confirms it", JSON.stringify(ledgerKindsByPerson(rows, lines)[s]) === JSON.stringify(["Accidents and injuries"]), ledgerKindsByPerson(rows, lines));
  const cov = coveragePersonKinds(rows, rows, lines);
  t("SG Coverage: the kind is not 'to confirm' once a line holds it", cov.kinds.length === 1 && !cov.kinds[0].toConfirm, cov.kinds);
  const guessOnly = coveragePersonKinds(rows, rows, []);
  t("SG Coverage: without the line it is 'to confirm' as before", guessOnly.kinds.length === 1 && guessOnly.kinds[0].toConfirm);
}

// A person with neither rows nor lines is still uncovered (no cover is invented).
{
  const none = coveragePersonKinds([], [], []);
  t("nobody's lines: no kinds, every main kind missing, count 0", none.kinds.length === 0 && none.count === 0 && none.gaps.missing.length === 4, none);
  t("Family: a person with nothing is not listed", Object.keys(ledgerKindsByPerson([], [])).length === 0);
}

globalThis.fetch = realFetch;
t("no outbound fetch", fetches === 0, fetches);
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
