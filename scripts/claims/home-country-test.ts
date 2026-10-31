/** "Overseas" is relative to where the household lives, never to Singapore (new-user walkthrough, 31 Oct: an Australian
 * family's "Daniel slipped at work in Sydney and broke his ankle" was recorded as Overseas, so travel insurance's overseas
 * medical cover was offered for an accident at home). Checks, for made-up households in Australia, Malaysia, the UK and
 * Singapore, and one whose home cannot be told:
 *   - home is read from the currencies the household's own documents state (one country's currency; US$ and € name none);
 *   - a place in the home country is at home, a place elsewhere is overseas, and with home unknown neither is assumed;
 *   - the chat's reading of the family's own words records the place that way;
 *   - travel (overseas-only) cover is not a possible benefit for an event at home, and is kept for an event overseas;
 *   - the where-did-it-happen question names the household's own country, or "where you live" when unknown;
 *   - with no home given, the older Singapore behaviour is unchanged.
 * Pure logic, plus the stored-currency read on a disposable database when one is set. No network, no model.
 *   npm run -s claims:home-country-test   (DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://... adds the database check) */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
const outbound: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => { outbound.push(String(input)); throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const { homeCountryFromCurrencies, awayFromHome } = await import("@/lib/claims/home-country");
  const { applyMessageFacts } = await import("@/lib/claims/message-facts");
  const { eventFitIssue } = await import("@/lib/claims/event-fit");
  const { planFactFinding } = await import("@/lib/claims/fact-finding");
  const now = new Date("2026-10-31T08:00:00Z");

  await test("home is the one country whose currency the documents state", () => {
    assert.equal(homeCountryFromCurrencies(["AUD", "AUD", null]), "Australia");
    assert.equal(homeCountryFromCurrencies(["MYR", "USD"]), "Malaysia");
    assert.equal(homeCountryFromCurrencies(["GBP", "EUR"]), "United Kingdom");
    assert.equal(homeCountryFromCurrencies(["SGD", "S$", "USD"]), "Singapore");
  });
  await test("home is unknown when no single country's currency is stated (none, US$ and € only, or two countries)", () => {
    assert.equal(homeCountryFromCurrencies([]), null);
    assert.equal(homeCountryFromCurrencies([null, "$"]), null);
    assert.equal(homeCountryFromCurrencies(["USD", "EUR"]), null);
    assert.equal(homeCountryFromCurrencies(["AUD", "SGD"]), null);
  });
  await test("a place is at home or overseas relative to the household", () => {
    assert.equal(awayFromHome("Sydney", "Australia"), false);
    assert.equal(awayFromHome("Sydney", "Singapore"), true);
    assert.equal(awayFromHome("Kuala Lumpur", "Malaysia"), false);
    assert.equal(awayFromHome("Kuala Lumpur", "Singapore"), true);
    assert.equal(awayFromHome("London", "United Kingdom"), false);
    assert.equal(awayFromHome("Bali", "Australia"), true);
    assert.equal(awayFromHome("Singapore", "Malaysia"), true);
  });
  await test("with home unknown, a named place is neither at home nor overseas; 'overseas' and 'at home' still are", () => {
    assert.equal(awayFromHome("Sydney", null), null);
    assert.equal(awayFromHome("Overseas", null), true);
    assert.equal(awayFromHome("Where we live", null), false);
    assert.equal(awayFromHome("the park near our flat", "Australia"), null);
  });

  const located = (message: string, home: string | null | undefined) => {
    const facts: Record<string, { value: unknown }> = {};
    applyMessageFacts({ message, facts: facts as never, now, ...(home === undefined ? {} : { home }) });
    return facts.eventLocation?.value ?? null;
  };
  await test("an Australian family's accident in Sydney is at home, never Overseas", () => {
    assert.equal(located("Daniel slipped at work in Sydney and broke his ankle last week", "Australia"), "Australia");
  });
  await test("a Malaysian family's fall in Kuala Lumpur is at home; the same fall for a Singapore family is overseas", () => {
    assert.equal(located("Nur fell in Kuala Lumpur and fractured her hip", "Malaysia"), "Malaysia");
    assert.equal(located("Nur fell in Kuala Lumpur and fractured her hip", "Singapore"), "Overseas");
  });
  await test("an Australian family's fall on holiday in Bali is overseas", () => {
    assert.equal(located("My son broke his arm on holiday in Bali", "Australia"), "Overseas");
  });
  await test("with home unknown, the named country is recorded as itself (neither home nor overseas)", () => {
    assert.equal(located("Mai broke her wrist at the park in Brisbane", null), "Australia");
  });
  await test("with no home given, the older Singapore reading is unchanged (KKH is home, Phuket is overseas)", () => {
    assert.equal(located("she was admitted overnight at KKH", undefined), "Singapore");
    assert.equal(located("he fell in Phuket", undefined), "Overseas");
  });

  const fit = (eventLocation: string, home: string | null | undefined) => eventFitIssue({ benefitTitle: "Overseas medical and hospital expenses", policyType: "Travel",
    expiryPassed: false, eventLocation, ...(home === undefined ? {} : { home }) });
  await test("travel cover is not a possible benefit for an accident at home in Australia, and says where", () => {
    const issue = fit("Australia", "Australia");
    assert.equal(issue?.kind, "location");
    assert.match(issue!.text, /happened in Australia\./);
    assert.doesNotMatch(issue!.text, /Singapore/);
  });
  await test("travel cover stays possible for an Australian family's event overseas", () => {
    assert.equal(fit("Overseas", "Australia"), null);
  });
  await test("with home unknown, a named country never makes travel cover possible: it needs an overseas trip", () => {
    assert.equal(fit("Australia", null)?.kind, "trip");
  });
  await test("with no home given, an event in Singapore still rules travel cover out (older cases unchanged)", () => {
    assert.equal(fit("Singapore", undefined)?.kind, "location");
  });

  const question = (category: "accidental_injury" | "accidental_death", home: string | null | undefined) => {
    const facts = category === "accidental_injury"
      ? { injuryKind: { value: "A broken bone", state: "known", quote: "", recordedAt: now.toISOString(), source: "user" }, eventType: { value: "accident", state: "known", quote: "", recordedAt: now.toISOString(), source: "user" } }
      : { deathDate: { value: "2026-10-20", state: "known", quote: "", recordedAt: now.toISOString(), source: "user" }, causeOfDeath: { value: "road accident", state: "known", quote: "", recordedAt: now.toISOString(), source: "user" },
          accidentCircumstances: { value: "hit by a car", state: "known", quote: "", recordedAt: now.toISOString(), source: "user" } };
    const plan = planFactFinding({ subjectId: "s1", category, facts: facts as never, ...(home === undefined ? {} : { home }) });
    return plan.nextQuestions.find((q) => q.factKey === "eventLocation") ?? null;
  };
  await test("the where-did-it-happen question offers the household's own country, never Singapore", () => {
    const q = question("accidental_injury", "Australia");
    assert.ok(q, "the question is asked");
    assert.deepEqual(q!.options, ["Australia", "Overseas", "Not sure"]);
    const d = question("accidental_death", "Malaysia");
    assert.ok(d, "the death question is asked");
    assert.match(d!.text, /in Malaysia or overseas/);
    assert.deepEqual(d!.options, ["Malaysia", "Overseas"]);
  });
  await test("with home unknown the question says where you live", () => {
    const d = question("accidental_death", null);
    assert.match(d!.text, /in the country where you live or overseas/);
    assert.deepEqual(d!.options, ["Where we live", "Overseas"]);
    assert.equal(awayFromHome("Where we live", null), false);
  });
  await test("a Singapore household, and no home given, keep the wording as it was", () => {
    assert.deepEqual(question("accidental_injury", "Singapore")!.options, ["Singapore", "Overseas", "Not sure"]);
    assert.deepEqual(question("accidental_injury", undefined)!.options, ["Singapore", "Overseas", "Not sure"]);
  });

  const url = process.env.DATABASE_URL ?? "";
  if (process.env.DEARPOLICY_DISPOSABLE_DB === "1" && /@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
    const { query } = await import("@/lib/db/client");
    const { householdHomeCountry } = await import("@/lib/claims/household-home");
    const account = randomUUID();
    try {
      await query("INSERT INTO accounts(id,name) VALUES($1,'Test household home country')", [account]);
      const member = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,'Linh Nguyen','self') RETURNING id", [account])).rows[0].id;
      const policy = async (currency: string | null, premium: string | null, deleted = false) => {
        const id = randomUUID();
        await query(`INSERT INTO policies(id,account_id,family_member_id,product_name,original_filename,storage_key,processing_status,quarantine_status,document_role,lifecycle_state)
          VALUES($1,$2,$3,'Example Life Plan',$4,$4,'ready','scan_clean','personal_schedule',${deleted ? "'soft_deleted'" : "'active'"})`, [id, account, member, `${id}.pdf`]);
        await query("INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,source_page,confirmed) VALUES($1,$2,$3,'Death',100000,$4,1,true)", [account, id, member, currency]);
        if (premium) await query("INSERT INTO premium_records(account_id,policy_id,family_member_id,amount,currency,frequency,source_document_id,source_page) VALUES($1,$2,$3,10,$4,'monthly',$2,1)", [account, id, member, premium]);
      };
      await test("database: a household with no stated currency has no home", async () => {
        await policy(null, null);
        assert.equal(await householdHomeCountry(account), null);
      });
      await test("database: A$ cover lines and premiums make the home Australia", async () => {
        await policy("AUD", "AUD");
        assert.equal(await householdHomeCountry(account), "Australia");
      });
      await test("database: a deleted document's currency does not count", async () => {
        await policy("SGD", "SGD", true);
        assert.equal(await householdHomeCountry(account), "Australia");
      });
    } finally {
      await query("DELETE FROM accounts WHERE id=$1", [account]).catch(() => undefined);
    }
  } else console.log("home country: database checks skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run them)");

  await test("no request tried to leave this machine (no model was asked)", () => assert.deepEqual(outbound, []));
  console.log(`home country: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  process.exit(failures.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
