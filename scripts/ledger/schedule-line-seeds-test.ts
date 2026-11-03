/** Coverage (the ledger every account off the benefit table gets): a schedule line seeds only the benefit it names, with
 * its own printed amount (new-user walkthrough, 31 Oct: an Australian schedule printing "Life Cover $850,000" and "TPD
 * Cover $500,000" showed "Total and permanent disability A$850,000", plus a terminal illness row carrying the life sum
 * and an early-stage critical illness row "Plans like this usually include this"). Runs the real seedLedger
 * (lib/ledger/store.ts) against a real, disposable PostgreSQL for made-up households in A$, £, RM and S$:
 *   - each schedule line's own benefit is seeded with its own amount;
 *   - what a plan of that kind usually also pays is proposed with no figure, never with another line's sum, and never
 *     where a line already gives that benefit;
 *   - a personal accident schedule's death sum is accidental death, never death from any cause;
 *   - an untouched row an older rule seeded with another benefit's sum loses that sum; a row a person changed or rejected
 *     stays as it is;
 *   - a line whose currency is unstated still seeds nothing (never S$).
 * No real household, insurer or scheme; no model call; no paid call.
 *   DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://... npm run -s ledger:schedule-line-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL ?? "";
if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
  console.log("schedule line seeds: skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run)");
  process.exit(0);
}
// The ledger is what an account off the benefit table reads: keep this household off it.
delete process.env.DEARPOLICY_BENEFIT_TABLE;
for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC_KEY|OPENAI_KEY/i.test(k)) delete process.env[k];
const outbound: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  outbound.push(String(input instanceof URL ? input.href : typeof input === "string" ? input : input.url).replace(/[?#].*/, ""));
  throw new Error("schedule line test: outbound request refused");
}) as typeof fetch;

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const ACCOUNT = randomUUID();

async function main() {
  const { query } = await import("@/lib/db/client");
  const { seedLedger, ensureLedgerSchema } = await import("@/lib/ledger/store");
  await ensureLedgerSchema();

  await query("INSERT INTO accounts(id,name) VALUES($1,$2)", [ACCOUNT, "Test household schedule lines"]);
  const person = async (name: string, rel: string) =>
    (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,$3) RETURNING id", [ACCOUNT, name, rel])).rows[0].id;
  const [au, gb, my, sg] = [await person("Linh Nguyen", "self"), await person("Amara Okafor", "spouse"), await person("Nur Aisyah", "parent"), await person("Priya Nair", "sibling")];
  /** A personal schedule and its schedule lines; returns each line's id by category. */
  async function schedule(member: string, product: string, lines: { category: string; amount: number | null; currency: string | null; quote: string }[]) {
    const id = randomUUID();
    await query(`INSERT INTO policies(id,account_id,family_member_id,product_name,insurer,original_filename,storage_key,processing_status,quarantine_status,personal_coverage_confirmed,document_role,document_authority)
      VALUES($1,$2,$3,$4,'Example Insurance Ltd',$5,$5,'ready','scan_clean',true,'personal_schedule',95)`, [id, ACCOUNT, member, product, `${id}.pdf`]);
    await query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'upload')", [id, member, ACCOUNT]);
    await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [ACCOUNT, id, lines.map((l) => l.quote).join("\n")]);
    const ids: Record<string, string> = {};
    for (const l of lines) ids[l.category] = (await query<{ id: string }>(`INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,confirmed,evidence_verified,evidence_text)
      VALUES($1,$2,$3,$4,$5,$6,$7,1,true,true,$8) RETURNING id`, [ACCOUNT, id, member, l.category, l.amount, l.currency, product, l.quote])).rows[0].id;
    return { id, ids };
  }
  const life = await schedule(au, "Wattle Life Protection", [
    { category: "Death", amount: 850000, currency: "AUD", quote: "Life Cover\t$850,000" },
    { category: "Total Permanent Disability", amount: 500000, currency: "AUD", quote: "Total and Permanent Disability (TPD) Cover - linked to Life Cover\t$500,000" },
    { category: "Critical Illness", amount: 150000, currency: "AUD", quote: "Trauma Cover - stand-alone\t$150,000" },
  ]);
  const term = await schedule(gb, "Level Term Assurance", [{ category: "Death", amount: 250000, currency: "GBP", quote: "Sum assured\t250,000.00" }]);
  const pa = await schedule(my, "Group Personal Accident", [{ category: "Death", amount: 200000, currency: "MYR", quote: "Accidental death\tRM200,000" }]);
  const other = await person("Hamish Reid", "parent");
  // Line categories in other words than the usual list, as some intakes store them.
  await schedule(other, "Thistle Level Term", [
    { category: "Life Cover", amount: 300000, currency: "GBP", quote: "Life cover (level)\t£300,000.00" },
    { category: "TPD Cover", amount: 100000, currency: "GBP", quote: "Total permanent disability\t£100,000.00" },
  ]);
  // A kind of the same cover is still that cover: "Group Term Life", "Group Personal Accident" (S$).
  const grp = await person("Raymond Lim", "sibling");
  await schedule(grp, "Example Group Insurance", [
    { category: "Group Term Life", amount: 1000000, currency: "SGD", quote: "Group Term Life\tS$1,000,000" },
    { category: "Group Personal Accident", amount: 600000, currency: "SGD", quote: "Group Personal Accident\tS$600,000" },
  ]);
  // Lines whose category has a cover's name in it but is something else: a premium waiver, a premium, a fund value.
  const notSums = await person("Rohan Mehta", "sibling");
  await schedule(notSums, "Harbour Protector", [
    { category: "TPD Premium Waiver", amount: 3000, currency: "SGD", quote: "TPD premium waiver\tS$3,000" },
    { category: "Life Cover Premium", amount: 1200, currency: "AUD", quote: "Life cover premium\tA$1,200" },
    { category: "Life Insurance Fund Value", amount: 45000, currency: "MYR", quote: "Fund value\tRM45,000" },
  ]);
  // As intake stores them: the category is the cover the line names, only the printed label says what it is.
  const stored = await person("Grace Tan", "sibling");
  await schedule(stored, "Harbour Protector Plus", [
    { category: "Total Permanent Disability", amount: 3000, currency: "SGD", quote: "TPD Premium Waiver\tS$3,000" },
    { category: "Death", amount: 1200, currency: "AUD", quote: "Term Life Premium A$1,200" },
    { category: "Death", amount: 45000, currency: "MYR", quote: "Nilai tunai / Cash value\tRM45,000" },
  ]);
  // Lines that pay a rate or reimburse up to a limit, printed as such (£, RM, S$).
  const rates = await person("Femi Adeyemi", "sibling");
  await schedule(rates, "Kestrel Income Protection", [{ category: "Disability Income", amount: 2400, currency: "GBP", quote: "Monthly benefit\t£2,400" }]);
  await schedule(rates, "Puffin Annual Multi-Trip", [
    { category: "Travel", amount: 10000000, currency: "GBP", quote: "Emergency medical expenses\t£10,000,000" },
    { category: "Travel", amount: 1500, currency: "GBP", quote: "Baggage\t£1,500 per person" },
  ]);
  await schedule(rates, "Selasih Hospital Cash", [{ category: "Hospital Cash", amount: 200, currency: "MYR", quote: "Elaun hospital harian / Daily hospital allowance\tRM200" }]);
  const yearly = await person("Wei Ling Ong", "sibling");
  await schedule(yearly, "Merlion Disability Income", [{ category: "Disability Income", amount: 30000, currency: "SGD", quote: "Annual disability benefit\tS$30,000" }]);
  // Sub-limits, other benefits and totals printed beside the plan's own lines (Critic H1-M3 on #294, S$ and £).
  const subs = await person("Kofi Mensah", "sibling");
  await schedule(subs, "Harbour Travel Guard", [
    { category: "Travel", amount: 1000000, currency: "SGD", quote: "Medical evacuation and repatriation\tS$1,000,000" },
    { category: "Travel", amount: 20000, currency: "SGD", quote: "Post-trip medical expenses in Singapore\tS$20,000" },
    { category: "Travel", amount: 500, currency: "SGD", quote: "Baggage delay\tS$500" },
    { category: "Travel", amount: 2000, currency: "SGD", quote: "Cancellation due to terrorism (sub-limit)\tS$2,000" },
    { category: "Travel", amount: 200000, currency: "SGD", quote: "Overseas medical expenses\tS$200,000" },
    { category: "Travel", amount: 5000, currency: "SGD", quote: "Loss of baggage and personal belongings\tS$5,000" },
    { category: "Travel", amount: 15000, currency: "SGD", quote: "Trip cancellation\tS$15,000" },
  ]);
  await schedule(subs, "Harbour Prime Hospital", [{ category: "Hospitalisation", amount: 150000, currency: "SGD", quote: "Annual limit\tS$150,000" }]);
  await schedule(subs, "Harbour Shield Hospital", [
    { category: "Hospitalisation", amount: 500, currency: "SGD", quote: "Room & Board limit\tS$500" },
    { category: "Hospitalisation", amount: 10000, currency: "SGD", quote: "Surgical limit\tS$10,000" },
    { category: "Hospitalisation", amount: 150000, currency: "SGD", quote: "Annual limit\tS$150,000" },
  ]);
  const totals = await person("Hana Sato", "sibling");
  await schedule(totals, "Osprey Income Protection", [{ category: "Disability Income", amount: 57600, currency: "GBP", quote: "Monthly benefit payable for up to 24 months, total\t£57,600" }]);
  await schedule(totals, "Osprey Hospital Cash", [{ category: "Hospital Cash", amount: 36500, currency: "GBP", quote: "Daily hospital cash, overall maximum\t£36,500" }]);
  await schedule(totals, "Osprey Travel", [
    { category: "Travel", amount: 50000, currency: "GBP", quote: "Medical expenses\t£50,000" },
    { category: "Travel", amount: 25000, currency: "GBP", quote: "Overseas medical expenses\t£25,000" },
  ]);
  await schedule(totals, "Osprey Health", [{ category: "Hospitalisation", amount: 1200, currency: "GBP", quote: "Intensive care unit limit\t£1,200" }]);
  const unstated = await schedule(sg, "Lighthouse Term Plan", [{ category: "Death", amount: 150000, currency: null, quote: "Sum assured\t$150,000" }]);

  // Rows an older rule seeded beside the £ life line: one untouched, one a person changed, one a person rejected.
  const old = (event: string, amount: number | null) => query<{ id: string }>(`INSERT INTO coverage_rules(account_id,family_member_id,policy_id,plan_name,event_type,pays_kind,amount,currency,sum_basis,origin,status,seed_key)
    VALUES($1,$2,$3,'Level Term Assurance',$4,'lump_sum',$5,'GBP',250000,'schedule','proposed',$6) RETURNING id`,
    [ACCOUNT, gb, term.id, event, amount, `coverage:${term.ids.Death}:${event}|member:${gb}`]);
  const untouched = (await old("terminal_illness", 250000)).rows[0].id;
  const changed = (await old("tpd", 250000)).rows[0].id;
  await query("UPDATE coverage_rules SET amount=200000, updated_at=now()+interval '1 minute' WHERE id=$1", [changed]);
  const rejected = (await old("critical_illness", null)).rows[0].id;
  await query("UPDATE coverage_rules SET status='rejected' WHERE id=$1", [rejected]);

  const rows = async (member: string) => (await query<{ id: string; event_type: string; amount: string | null; currency: string; origin: string; status: string; pays_kind: string }>(
    "SELECT id,event_type,amount::text,currency,origin,status,pays_kind FROM coverage_rules WHERE account_id=$1 AND family_member_id=$2 ORDER BY event_type", [ACCOUNT, member])).rows;

  try {
    await seedLedger(ACCOUNT);

    const figures = (r: { event_type: string; amount: string | null; currency: string }[]) => r.map((x) => [x.event_type, x.amount == null ? null : Number(x.amount), x.currency]);
    await test("each A$ line seeds its own benefit with its own amount: TPD is A$500,000, never the life cover's A$850,000", async () => {
      const r = await rows(au);
      assert.deepEqual(figures(r).filter((x) => x[1] != null), [["critical_illness", 150000, "AUD"], ["death", 850000, "AUD"], ["tpd", 500000, "AUD"]]);
    });
    await test("what a plan type usually also pays carries no figure, and no benefit is seeded twice", async () => {
      const r = await rows(au);
      const extra = r.filter((x) => !["death", "tpd", "critical_illness"].includes(x.event_type));
      assert.ok(extra.every((x) => x.amount == null), JSON.stringify(figures(extra)));
      assert.equal(new Set(r.map((x) => x.event_type)).size, r.length, JSON.stringify(figures(r)));
    });
    await test("a £ life schedule printing one sum carries that sum on death only", async () => {
      const seeded = (await rows(gb)).filter((x) => x.id !== changed && x.id !== rejected);
      assert.deepEqual(figures(seeded).filter((x) => x[1] != null), [["death", 250000, "GBP"]]);
    });
    await test("a personal accident schedule's death sum is accidental death only (RM); nothing else carries it", async () => {
      const r = await rows(my);
      assert.deepEqual(figures(r).filter((x) => x[1] != null), [["accidental_death", 200000, "MYR"]]);
      assert.ok(!r.some((x) => x.event_type === "death"), "never death from any cause");
    });
    await test("an untouched older row that carried the life sum on another benefit no longer carries it", async () => {
      const r = (await rows(gb)).find((x) => x.id === untouched);
      assert.ok(!r || r.amount == null, JSON.stringify(r));
    });
    await test("a row a person changed keeps their figure, and a rejected row stays rejected", async () => {
      const r = await rows(gb);
      assert.equal(Number(r.find((x) => x.id === changed)?.amount), 200000);
      assert.equal(r.find((x) => x.id === rejected)?.status, "rejected");
    });
    await test("a line category in other words keeps its own amount: 'Life Cover' is death £300,000, 'TPD Cover' is TPD £100,000", async () => {
      assert.deepEqual(figures(await rows(other)).filter((x) => x[1] != null), [["death", 300000, "GBP"], ["tpd", 100000, "GBP"]]);
    });
    await test("a premium waiver, a premium or a fund value is never a TPD or death sum (S$, A$, RM)", async () => {
      assert.deepEqual(figures(await rows(notSums)).filter((x) => x[1] != null), []);
      assert.deepEqual(figures(await rows(stored)).filter((x) => x[1] != null), [], "stored under the cover it names");
    });
    await test("'Group Term Life' and 'Group Personal Accident' keep their own sums (S$)", async () => {
      const got = figures(await rows(grp)).filter((x) => x[1] != null);
      assert.deepEqual(got, [["accidental_death", 600000, "SGD"], ["death", 1000000, "SGD"]]);
    });
    await test("a printed monthly benefit, daily allowance or travel limit keeps its amount with how it pays (£, RM)", async () => {
      const got = (await rows(rates)).filter((x) => x.amount != null).map((x) => [x.event_type, x.pays_kind, Number(x.amount), x.currency]);
      assert.deepEqual(got, [["disability_income", "per_month", 2400, "GBP"], ["hospital_daily_cash", "per_day", 200, "MYR"], ["travel_medical", "reimbursement_cap", 10000000, "GBP"]]);
    });
    await test("a rate the line doesn't state as monthly, or a limit per person, keeps no figure, never a lump sum (S$, £)", async () => {
      assert.deepEqual((await rows(yearly)).filter((x) => x.amount != null), []);
      assert.ok(!(await rows(rates)).some((x) => x.event_type === "baggage" && x.amount != null));
    });
    await test("only a plan's own travel or hospital limit carries a figure; evacuation, post-trip, delay, sub-limits and room/surgical limits never do (S$)", async () => {
      const got = (await rows(subs)).filter((x) => x.amount != null).map((x) => [x.event_type, x.pays_kind, Number(x.amount), x.currency]);
      // The ledger keeps one line per plan and cover kind, whichever it reads first. Whichever it is, a figure is only ever
      // a whole-benefit line's own (medical S$200,000, cancellation S$15,000, baggage S$5,000, the plan's Annual limit),
      // never evacuation S$1,000,000, post-trip S$20,000, delay S$500, a terrorism sub-limit or a Room & Board/Surgical limit.
      const allowed = new Set(["travel_medical|200000", "trip_cancellation|15000", "baggage|5000", "hospital_medical_expense|150000"]);
      assert.ok(got.every((x) => x[1] === "reimbursement_cap" && x[3] === "SGD" && allowed.has(x[0] + "|" + x[2])), JSON.stringify(got));
      assert.ok(got.some((x) => x[0] === "hospital_medical_expense" && x[2] === 150000), JSON.stringify(got));
      assert.ok(got.filter((x) => x[0] === "hospital_medical_expense").length === 1, JSON.stringify(got));
    });
    await test("a total, an overall maximum, two lines for one benefit or an ICU sub-limit keep no figure (£)", async () => {
      assert.deepEqual((await rows(totals)).filter((x) => x.amount != null).map((x) => [x.event_type, x.pays_kind, Number(x.amount)]), []);
    });
    await test("line by line: only a whole-benefit label or the plan's own limit says how it pays (S$, £, €, RM, 中文)", async () => {
      const { scheduleLineEvent, scheduleLinePays } = await import("@/lib/ledger/events");
      const pays = (category: string, printed: string) => { const e = scheduleLineEvent(category, printed.split("\t")[0], printed); return e ? `${e.event}:${e.pays === "stated" ? scheduleLinePays(e.event, printed) ?? "stated" : e.pays}` : null; };
      for (const [c, t] of [["Travel", "Medical evacuation and repatriation\tS$1,000,000"], ["Travel", "Emergency medical evacuation\tUnlimited"], ["Travel", "Post-trip medical expenses in Singapore\tS$20,000"], ["Travel", "Overseas hospital cash allowance\tS$5,000"], ["Travel", "Hospital visit by a relative\tS$10,000"], ["Travel", "Medical expenses (insured aged 70 and above)\tS$50,000"], ["Travel", "Baggage delay\tS$500"], ["Travel", "Baggage - maximum per item\tS$500"], ["Travel", "Cancellation due to terrorism (sub-limit)\tS$2,000"], ["Travel", "Compassionate visit / child guard - hospital stay\tS$5,000"], ["Travel", "Overseas medical expenses / Medical evacuation\tS$1,000,000"]])
        assert.equal(pays(c, t), null, t);
      for (const [c, t] of [["Disability Income", "Monthly benefit payable for up to 24 months, total\t£57,600"], ["Disability Income", "Benefit (75% of monthly salary)\t£2,400"], ["Long Term Care", "Monthly benefit for 6 years; maximum total\tS$129,600"], ["Hospital Cash", "Daily hospital cash, overall maximum\tS$36,500"], ["Hospitalisation", "Room & Board limit\tS$500"], ["Hospitalisation", "Surgical limit\tS$10,000"], ["Hospitalisation", "Overall limit per policy year\tS$1,000,000"], ["Hospitalisation", "Pre-hospital treatment limit (90 days)\tS$5,000"], ["Hospitalisation", "Outpatient cancer treatment - up to\tS$60,000"], ["Hospitalisation", "Intensive care unit limit\tS$1,200"], ["Disability Income", "Monthly benefit £2,400 or annual £28,800\t£2,400"]])
        assert.ok(String(pays(c, t)).endsWith(":stated"), `${t} -> ${pays(c, t)}`);
      for (const [c, t, want] of [["Travel", "Overseas medical expenses\tS$200,000", "travel_medical:reimbursement_cap"], ["Travel", "Frais médicaux à l'étranger\t€150,000", "travel_medical:reimbursement_cap"], ["Travel", "Perbelanjaan perubatan luar negara / Overseas medical expenses\tRM200,000", "travel_medical:reimbursement_cap"], ["Travel", "海外医疗费用\tS$200,000", "travel_medical:reimbursement_cap"], ["Travel", "Trip cancellation\tS$15,000", "trip_cancellation:reimbursement_cap"], ["Travel", "Loss of baggage and personal belongings\tS$5,000", "baggage:reimbursement_cap"], ["Disability Income", "Faedah bulanan / Monthly benefit\tRM3,000", "disability_income:per_month"], ["Hospital Cash", "Daily hospital cash\tS$200", "hospital_daily_cash:per_day"], ["Hospitalisation", "Annual limit\tS$150,000", "hospital_medical_expense:reimbursement_cap"]])
        assert.equal(pays(c, t), want, t);
    });
    await test("a line whose currency is unstated seeds nothing, never S$", async () => {
      assert.deepEqual(await rows(sg), []);
      void unstated;
    });
    await test("seeding again changes nothing", async () => {
      const before = JSON.stringify([await rows(au), await rows(gb), await rows(my)]);
      await seedLedger(ACCOUNT);
      assert.equal(JSON.stringify([await rows(au), await rows(gb), await rows(my)]), before);
    });
    void life; void pa;
  } finally {
    await query("DELETE FROM coverage_rules WHERE account_id=$1", [ACCOUNT]).catch(() => undefined);
    await query("DELETE FROM accounts WHERE id=$1", [ACCOUNT]).catch(() => undefined);
  }

  await test("no request tried to leave this machine (no model was asked)", async () => {
    assert.deepEqual(outbound, []);
  });
  console.log(`schedule line seeds: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
