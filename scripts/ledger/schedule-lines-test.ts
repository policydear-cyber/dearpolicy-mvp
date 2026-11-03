/** Family and Coverage agree with Home for a household on Coverage rows (the benefit table switched off). A schedule line
 * that prints no amount ("Hospitalisation"), or an amount with no stated currency ("Disability Income 7,500"), never
 * becomes a Coverage row, so the person Home listed as covered was "Nothing found" on Family and "No cover was found" on
 * Coverage (new-user walkthrough, 31 Oct). The rule now: a confirmed, checked schedule line is cover on every page.
 * Made-up households in AUD, GBP, MYR and SGD, invented insurers and plan names. No model, no database, no network.
 *   npm run ledger:schedule-lines-test */
import { coveragePersonKinds, kindOfCategory, kindsOfTable, ledgerKindsByPerson, scheduleOnlyLines, type KindRow, type ScheduleLine, type TableKindCover, type TableKindRow } from "@/components/cover-kinds";
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

// A row the household added (no policy) hides nothing; two lines of one kind from one policy are one.
{
  const p = "m-p";
  const rows = [row({ familyMemberId: p, policyId: null, eventType: "travel_medical", origin: "person" })];
  const lines = scheduleOnlyLines([line(p, "pol-1", "Travel"), line(p, "pol-1", "Travel", { sourcePage: 4 })], rows);
  t("own entry hides nothing; duplicate lines are one", lines.length === 1 && lines[0].sourcePage === 1, lines);
}
// A row the household rejected (they said this plan doesn't pay it) is never brought back by the schedule line (Critic M1).
{
  const p = "m-r";
  const rows = [row({ familyMemberId: p, policyId: "pol-ci", eventType: "critical_illness", status: "rejected" }), row({ familyMemberId: p, policyId: "pol-ci", eventType: "death" })];
  const lines = scheduleOnlyLines([line(p, "pol-ci", "Critical Illness"), line(p, "pol-ci", "Death")], rows);
  t("rejected CI row + CI line: no line comes back", lines.length === 0, lines);
  t("rejected CI row + CI line: Family shows no CI", JSON.stringify(ledgerKindsByPerson(rows, lines)[p]) === JSON.stringify(["Death"]), ledgerKindsByPerson(rows, lines));
  const other = scheduleOnlyLines([line(p, "pol-other", "Critical Illness")], rows);
  t("a rejection on one policy never hides another policy's line", other.length === 1, other);
}
// Only a rejection of the row the line itself is hides it: a misread narrower row of the same kind does not (TE F1).
{
  const k = "m-kofi";
  const rows = [row({ familyMemberId: k, policyId: "pol-h", eventType: "icu_daily_cash", status: "rejected" })];
  const lines = scheduleOnlyLines([line(k, "pol-h", "Hospitalisation")], rows);
  t("rejected ICU cash row + Hospitalisation line: the line is kept", lines.length === 1, lines);
  t("... and Family shows hospital cover", JSON.stringify(ledgerKindsByPerson(rows, lines)[k]) === JSON.stringify(["Hospital and medical"]), ledgerKindsByPerson(rows, lines));
  const hosp = scheduleOnlyLines([line(k, "pol-h", "Hospitalisation")], [row({ familyMemberId: k, policyId: "pol-h", eventType: "hospital_medical_expense", status: "rejected" })]);
  t("rejected hospital-bills row + Hospitalisation line: hidden", hosp.length === 0, hosp);
  const travelRows = (events: string[]) => events.map((e) => row({ familyMemberId: k, policyId: "pol-t", eventType: e, status: "rejected" }));
  t("one rejected travel row (baggage) keeps the Travel line", scheduleOnlyLines([line(k, "pol-t", "Travel")], travelRows(["baggage"])).length === 1);
  t("every travel row rejected hides the Travel line", scheduleOnlyLines([line(k, "pol-t", "Travel")], travelRows(["travel_delay", "trip_cancellation", "travel_medical", "baggage"])).length === 0);
  const di = scheduleOnlyLines([line(k, "pol-ip", "Disability Income")], [row({ familyMemberId: k, policyId: "pol-ip", eventType: "tpd", status: "rejected" })]);
  t("rejected TPD row keeps a Disability Income line", di.length === 1, di);
}
// A printed wording outside the category list ("Life Cover", "Lebensversicherung"): the events the server would seed from
// it decide (TE F2). Rejecting all of them keeps it out; rejecting some does not; a line with no seeds is never hidden.
{
  const w = "m-w";
  const life = (category: string) => line(w, "pol-l", category, { events: ["death", "tpd", "terminal_illness"] });
  const rej = (events: string[]) => events.map((e) => row({ familyMemberId: w, policyId: "pol-l", eventType: e, status: "rejected" }));
  t("'Life Cover' with all three seeds rejected: hidden", scheduleOnlyLines([life("Life Cover")], rej(["death", "tpd", "terminal_illness"])).length === 0);
  t("'Life Insurance' with all three seeds rejected: hidden", scheduleOnlyLines([life("Life Insurance")], rej(["death", "tpd", "terminal_illness"])).length === 0);
  t("'Life Cover' with only TPD rejected: kept", scheduleOnlyLines([life("Life Cover")], rej(["tpd"])).length === 1);
  t("'Life Cover' kind is Death", kindOfCategory("Life Cover").id === "death");
  t("a wording with no seeds is never hidden by a rejection", scheduleOnlyLines([line(w, "pol-l", "Cobertura dental")], rej(["death"])).length === 1);
  t("a listed category ignores the line's seed list (its own event decides)",
    scheduleOnlyLines([line(w, "pol-l", "Death", { events: ["death", "tpd", "terminal_illness"] })], rej(["death"])).length === 0);
}

// SG household: a line makes a kind confirmed on Family even when the only row of that kind is a plan type's guess.
{
  const s = "m-sg";
  const rows = [row({ familyMemberId: s, policyId: "pol-sg-a", eventType: "accidental_death", status: "proposed" })];
  // Changed 31 Oct (owner rule, 28 Oct: a plan type is not proof of cover; #273): Family no longer lists a kind only a plan
  // type suggests, as on Home and Documents. The original check expected "Accidents and injuries (to confirm)".
  t("SG: a plan-type guess alone is not listed on Family", ledgerKindsByPerson(rows, [])[s] === undefined, ledgerKindsByPerson(rows, []));
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

// A confirmed schedule line confirms its kind even when the policy's only row of that kind is a plan type's usual benefit
// (proposed, from the schedule): Home shows "Death RM200,000", so Family never says "Death (to confirm)" (cross-page check).
{
  const a = "m-aiman2";
  const rows = [row({ familyMemberId: a, policyId: "pol-tk", eventType: "death", status: "proposed", origin: "schedule" }),
    row({ familyMemberId: a, policyId: "pol-tk", eventType: "tpd", status: "proposed", origin: "schedule" })];
  const lines = scheduleOnlyLines([line(a, "pol-tk", "Death")], rows);
  t("proposed death row + Death line: the line is kept to confirm the kind", lines.length === 1 && lines[0].confirmsOnly === true, lines);
  // Changed 31 Oct (#273, same owner rule): the plan type's TPD guess is no longer listed as "Disability (to confirm)".
  t("... Family: Death confirmed, the TPD guess not listed", JSON.stringify(ledgerKindsByPerson(rows, lines)[a]) === JSON.stringify(["Death"]), ledgerKindsByPerson(rows, lines));
  const cov = coveragePersonKinds(rows, rows, lines);
  const death = cov.kinds.find((k) => k.id === "death")!;
  t("... Coverage: Death is not 'to confirm', and the line is not drawn again beside its row", !death.toConfirm && death.lines.length === 0 && death.rows.length === 1, death);
  t("... Coverage: Disability stays 'to confirm'", cov.kinds.find((k) => k.id === "disability")!.toConfirm === true);
  t("a confirmed row still hides the line", scheduleOnlyLines([line(a, "pol-tk", "Death")], [row({ familyMemberId: a, policyId: "pol-tk", eventType: "death" })]).length === 0);
}

// The table path: Family lists the kinds the person's schedule lines name, as Home does, whatever language the cover and
// its benefits are named in. A row or cover named in no known words is "Other" only when no line of its document says what it is.
{
  const doc = "doc-tk", other = "doc-x";
  const tr = (benefit: string, product: string, cover: string, documentId: string): TableKindRow => ({ benefit, pays: "amount", product, cover, source: { documentId } });
  const tc = (product: string, cover: string, documentId: string): TableKindCover => ({ product, cover, source: { documentId } });
  const rows = [tr("Kematian atau Hilang Upaya Menyeluruh dan Kekal", "Teratai Family Takaful", "Family Takaful", doc), tr("Serangan Jantung", "Teratai Family Takaful", "Rider Penyakit Kritikal", doc)];
  const covers = [tc("Teratai Family Takaful", "Family Takaful", doc), tc("Teratai Family Takaful", "Rider Penyakit Kritikal", doc)];
  // Without its lines the rider named only by its illness ("Serangan Jantung") is no kind: Critical illness is missing and
  // "Other" shows (the bug). The Malay death row itself is named Death since other-language death words are known (#282).
  const bare = kindsOfTable(rows, covers);
  t("table: without the lines, the takaful rider's Critical illness is missing and 'Other' shows (the bug)", !bare.includes("Critical illness") && bare.includes("Other"), bare);
  const lines = [{ policyId: doc, category: "Death" }, { policyId: doc, category: "Critical Illness" }];
  t("table: with its lines, Death and Critical illness, no 'Other'", JSON.stringify(kindsOfTable(rows, covers, lines)) === JSON.stringify(["Death", "Critical illness"]), kindsOfTable(rows, covers, lines));
  const stray = [...rows, tr("Santunan khusus", "Plan Lain", "Plan Lain", other)];
  t("table: an unnamed row of another document stays 'Other'", kindsOfTable(stray, covers, lines).includes("Other"), kindsOfTable(stray, covers, lines));
  const ip = [tr("Monthly benefit", "Larkfield Income Protection", "Income Protection", "doc-ip")];
  t("table: income protection with its Disability Income line is Disability", JSON.stringify(kindsOfTable(ip, [], [{ policyId: "doc-ip", category: "Disability Income" }])) === JSON.stringify(["Disability"]), kindsOfTable(ip, [], [{ policyId: "doc-ip", category: "Disability Income" }]));
  t("table: a line whose document has no table cover yet still counts", JSON.stringify(kindsOfTable([], [], [{ policyId: "doc-none", category: "Hospital Cash" }])) === JSON.stringify(["Hospital and medical"]));
  t("table: no lines, English names unchanged", JSON.stringify(kindsOfTable([tr("Death benefit", "Wattle Term Life", "Term Life", "d")], [])) === JSON.stringify(["Death"]));
}

globalThis.fetch = realFetch;
t("no outbound fetch", fetches === 0, fetches);
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
