/** Home tiles follow each household's own documents, at request time (DC 27 Oct: "when a new policy is uploaded the
 * tiles change as well"). Runs the real dashboard route (app/api/dashboard/route.ts) against a real, disposable
 * PostgreSQL with the app's schema, for made-up households in two currencies:
 *   - a policy added (read into the benefit table the way an upload does, with a scripted model, no network) changes
 *     the tile's total and parts; a second one adds to them;
 *   - removing that policy, or a single trip whose dates have passed, takes it out again;
 *   - a person with no policies, and a household with nobody yet, get empty tiles, not an error or another person's;
 *   - one household never sees another's rows;
 *   - an account without the benefit table (the switch is per account) still follows its confirmed schedule lines.
 * No real household, insurer or scheme; no model call; no paid call.
 *
 * Needs a DISPOSABLE database with the app's schema (scripts/setup-db.ts's list plus sql/benefit-table.sql and the
 * other additive files). It refuses to run unless DEARPOLICY_DISPOSABLE_DB=1 and DATABASE_URL points at localhost or a
 * socket, and it deletes only the made-up accounts it creates.
 *   DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://... npm run coverage:dashboard-dynamic-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const url = process.env.DATABASE_URL ?? "";
if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
  console.log("dashboard dynamic: skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run)");
  process.exit(0);
}

const SG = randomUUID(), MY = randomUUID(), PLAIN = randomUUID(), EMPTY = randomUUID(), EMPTY2 = randomUUID();
const USERS: Record<string, string> = { [SG]: randomUUID(), [MY]: randomUUID(), [PLAIN]: randomUUID(), [EMPTY]: randomUUID(), [EMPTY2]: randomUUID() };
Object.assign(process.env, { DEV_AUTH_ENABLED: "1", DEARPOLICY_BENEFIT_TABLE: "1", DEARPOLICY_ALPHA_ACCOUNTS: [SG, MY, EMPTY, EMPTY2].join(",") });
// Never a paid call: no model key, and every request off this machine is refused and counted.
for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC_KEY|OPENAI_KEY/i.test(k)) delete process.env[k];
const outbound: string[] = [];
const localFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) { outbound.push(u.replace(/[?#].*/, "")); throw new Error("dashboard dynamic test: outbound request refused"); }
  return localFetch(input, init);
}) as typeof fetch;
const settle = () => new Promise((r) => setTimeout(r, 1500));

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

async function main() {
  const { query } = await import("@/lib/db/client");
  const { readDocument, relink } = await import("@/lib/benefit-table/service");
  const { appDb } = await import("@/lib/benefit-table/app");
  const { coverKeyOf, sectionKeyOf } = await import("@/lib/benefit-table/assemble");
  const { GET } = await import("@/app/api/dashboard/route");
  type TableModel = import("@/lib/benefit-table/model").TableModel;

  /** A model that gives the scripted reading, and links each section to the cover named for it. */
  const model = (answer: unknown): TableModel => ({ choice: { provider: "anthropic", model: "test-model" }, async call(c) {
    // Linking is asked for every section of the household each time, as the real model is: answer each from the map.
    const json = c.schema && "links" in ((c.schema as { properties?: object }).properties ?? {}) ? { links: [...links.values()] } : answer;
    return { json, stopReason: "end_turn", model: "test-model", input: 1, output: 1, ms: 1 };
  } });
  const links = new Map<string, { section: string; cover: string | null; why: string }>();

  async function household(account: string, name: string, people: [string, string][]) {
    await query("INSERT INTO accounts(id,name) VALUES($1,$2)", [account, name]);
    await query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner')", [account, USERS[account]]);
    const ids: Record<string, string> = {};
    for (const [n, rel] of people) ids[n] = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,$3) RETURNING id", [account, n, rel])).rows[0].id;
    return ids;
  }

  type Upload = { account: string; person: string; product: string; currency: string; symbol: string; sum: number; category: string;
    benefit: string; travel?: { from: string; to: string }; line?: boolean; read?: boolean; relink?: boolean; benefits?: boolean };
  /** An uploaded schedule, as intake leaves it: the document and its page, whose it is, its confirmed schedule line, and
   * (where the account has the benefit table) its reading and links. */
  async function upload(u: Upload, personId: string): Promise<string> {
    const id = randomUUID();
    const amount = `${u.symbol}${u.sum.toLocaleString("en-US")}`;
    const text = `POLICY SCHEDULE\nLife Assured\t${u.person}\n${u.product}\tSum Assured ${amount}\n${u.benefit}\t${amount}` + (u.travel ? `\nPeriod of Insurance\t${u.travel.from} to ${u.travel.to}` : "");
    await query(`INSERT INTO policies(id,account_id,family_member_id,product_name,original_filename,storage_key,processing_status,processing_stage,quarantine_status,personal_coverage_confirmed,document_role)
      VALUES($1,$2,$3,$4,$5,$6,'ready','ready','scan_clean',true,'schedule')`, [id, u.account, personId, u.product, `${u.product}.pdf`, `test/${id}`]);
    await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [u.account, id, text]);
    await query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'upload')", [id, personId, u.account]);
    if (u.line !== false) await query(`INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,product_name,confirmed,evidence_verified)
      VALUES($1,$2,$3,$4,$5,$6,$7,true,true)`, [u.account, id, personId, u.category, u.sum, u.currency, u.product]);
    if (u.read !== false) {
      const cover = { person: u.person, product: u.product, cover: u.product, plan: null, sumInsured: u.sum, premium: null, premiumFrequency: null, asOf: null,
        startDate: u.travel?.from ?? null, endDate: u.travel?.to ?? null, page: 1, quote: `${u.product} Sum Assured ${amount}` };
      const reading = { document: { kind: "personal_proof", product: u.product, insurer: null, namedPeople: [u.person], plan: null, periodFrom: u.travel?.from ?? null, periodTo: u.travel?.to ?? null },
        covers: [cover], benefits: u.benefits === false ? [] : [{ section: null, column: null, benefit: u.benefit, pays: "amount", value: u.sum, percentOf: null, baseAmount: null, baseQuote: null,
          fromDay: null, maxDays: null, conditions: [], page: 1, quote: `${u.benefit} ${amount}` }] };
      const read = await readDocument(appDb, model(reading), u.account, id);
      assert.ok(read.read, `the reading of ${u.product} was not stored: ${JSON.stringify(read)}`);
      const section = sectionKeyOf(id, { section: null, column: null });
      links.set(section, { section, cover: coverKeyOf({ product: u.product, cover: u.product, plan: null }), why: "the plan's schedule" });
      if (u.relink !== false) await relink(appDb, model(null), u.account);
    }
    return id;
  }

  type Tile = { category: string; status: string; amount: number | null; currency: string; parts: { name: string; amount: number | null; currency: string | null }[] | null };
  async function tiles(account: string, member?: string, poll = false) {
    process.env.DEV_ACCOUNT_ID = USERS[account];
    const q = new URLSearchParams(); if (member) q.set("familyMemberId", member); if (poll) q.set("poll", "1");
    const res = await GET(new NextRequest(`http://localhost/api/dashboard${q.toString() ? `?${q}` : ""}`));
    const body = await res.json() as { coverages: Tile[]; activeMember: { id: string } | null; empty?: boolean; reading?: number; error?: string };
    assert.equal(res.status, 200, JSON.stringify(body));
    return body;
  }
  const tile = (b: { coverages: Tile[] }, category: string) => b.coverages.find((c) => c.category === category)!;
  const summary = (t: Tile) => [t.status, t.amount, t.currency, (t.parts ?? []).map((p) => `${p.name} ${p.amount}`).join(" · ")];

  const day = (offset: number) => { const d = new Date(Date.now() + offset * 86400000); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`; };

  try {
    for (const m of [{ account: SG, cur: "SGD", sym: "S$", a: 300000, b: 150000, name: ["Priya Nair", "Arjun Nair", "Meera Nair"] },
      { account: MY, cur: "MYR", sym: "RM ", a: 250000, b: 100000, name: ["Nur Aina binti Hassan", "Faiz bin Rahman", "Aisyah binti Faiz"] }] as const) {
      const ids = await household(m.account, `Test household ${m.cur}`, [[m.name[0], "self"], [m.name[1], "spouse"], [m.name[2], "child"]]);
      const self = ids[m.name[0]], spouse = ids[m.name[1]], child = ids[m.name[2]];
      const plan = (product: string, sum: number, o: Partial<Upload> = {}): Upload => ({ account: m.account, person: m.name[0], product, currency: m.cur, symbol: m.sym, sum,
        category: "Death", benefit: "Death Benefit", ...o });

      await test(`${m.cur}: before any upload, every tile is not covered`, async () => {
        const b = await tiles(m.account, self);
        assert.equal(b.activeMember?.id, self);
        assert.ok(b.coverages.every((c) => c.status === "not_covered"), JSON.stringify(b.coverages.filter((c) => c.status !== "not_covered")));
      });
      const first = await upload(plan("Harbour Life Plan", m.a), self);
      await test(`${m.cur}: one policy uploaded: the Death tile shows its sum insured`, async () => {
        assert.deepEqual(summary(tile(await tiles(m.account, self), "Death")), ["covered", m.a, m.cur, `Harbour Life Plan ${m.a}`]);
      });
      const second = await upload(plan("Lighthouse Term Plan", m.b), self);
      await test(`${m.cur}: a second policy uploaded: the total and the parts change`, async () => {
        const t = tile(await tiles(m.account, self), "Death");
        assert.equal(t.amount, m.a + m.b);
        assert.deepEqual((t.parts ?? []).map((p) => [p.name, p.amount]).sort(), [["Harbour Life Plan", m.a], ["Lighthouse Term Plan", m.b]]);
      });
      await test(`${m.cur}: the second policy removed: the tile is back to the first`, async () => {
        await query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1 AND account_id=$2", [second, m.account]);
        assert.deepEqual(summary(tile(await tiles(m.account, self), "Death")), ["covered", m.a, m.cur, `Harbour Life Plan ${m.a}`]);
      });
      await test(`${m.cur}: a single trip in force shows; the same trip once its dates have passed does not`, async () => {
        const trip = (from: number, to: number, product: string) => plan(product, 100000, { category: "Personal Accident", benefit: "Accidental Death", line: false,
          travel: { from: day(from), to: day(to) } });
        await upload(trip(-3, 10, "Wanderer Single Trip Travel"), self);
        const now = tile(await tiles(m.account, self), "Personal Accident");
        assert.equal(now.status, "covered");
        assert.equal(now.amount, 100000);
        await upload(trip(-40, -30, "Voyager Single Trip Travel"), self);
        const later = tile(await tiles(m.account, self), "Personal Accident");
        assert.deepEqual((later.parts ?? []).map((p) => p.name), ["Wanderer Single Trip Travel"], "an ended trip is not cover");
        assert.equal(later.amount, 100000);
      });
      await test(`${m.cur}: a policy uploaded for another person changes that person's tile only`, async () => {
        await upload(plan("Harbour Life Plan", m.b, { person: m.name[1] }), spouse);
        assert.deepEqual(summary(tile(await tiles(m.account, spouse), "Death")), ["covered", m.b, m.cur, `Harbour Life Plan ${m.b}`]);
        assert.equal(tile(await tiles(m.account, self), "Death").amount, m.a);
      });
      await test(`${m.cur}: Home is told while a new document is still being read, and stops being told once it is`, async () => {
        assert.equal((await tiles(m.account, self)).reading, 0);
        const pending = await upload(plan("Beacon Life Plan", m.b, { read: false, line: false }), self);
        await query("UPDATE policies SET processing_completed_at=now() WHERE id=$1", [pending]);
        assert.equal((await tiles(m.account, self)).reading, 1, "ready, but its reading is not stored yet");
        await query("UPDATE policies SET processing_completed_at=now()-interval '20 minutes' WHERE id=$1", [pending]);
        assert.equal((await tiles(m.account, self)).reading, 0, "a document that never gets a reading stops counting");
        await query("UPDATE policies SET processing_status='extracting',updated_at=now() WHERE id=$1", [pending]);
        assert.equal((await tiles(m.account, self)).reading, 1, "still extracting");
        await query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [pending]);
        assert.equal((await tiles(m.account, self)).reading, 0, "a removed document is not waited for");
      });
      await test(`${m.cur}: Home keeps waiting until the new document is linked, not only read (TE F1)`, async () => {
        // No schedule line: the tile can only get it from the benefit table, once the document's section is linked.
        const doc = await upload(plan("Anchor Life Plan", 70000, { relink: false, line: false }), self);
        await query("UPDATE policies SET processing_completed_at=now() WHERE id=$1", [doc]);
        try {
        const read = await tiles(m.account, self);
        assert.equal(read.reading, 1, "read but not linked yet: still waited for");
        assert.equal(tile(read, "Death").amount, m.a, "not on the tile before it is linked");
        await relink(appDb, model(null), m.account);
        const linked = await tiles(m.account, self);
        assert.equal(linked.reading, 0, "linked: no longer waited for");
        assert.equal(tile(linked, "Death").amount, m.a + 70000, "on the tile once linked");
        } finally { await query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [doc]); }
      });
      await test(`${m.cur}: a person with no policies has no covered tile`, async () => {
        const b = await tiles(m.account, child);
        assert.equal(b.activeMember?.id, child);
        assert.ok(b.coverages.every((c) => c.status === "not_covered"));
      });
      void first;
    }

    await test("one household never sees another's documents", async () => {
      const sg = await tiles(SG);
      assert.ok(sg.coverages.every((c) => c.currency !== "MYR" && !(c.parts ?? []).some((p) => p.currency === "MYR")));
      // Asking for another household's person gives this household's own first person, never theirs.
      const theirs = (await query<{ id: string }>("SELECT id FROM family_members WHERE account_id=$1 LIMIT 1", [MY])).rows[0].id;
      const asked = await tiles(SG, theirs);
      assert.notEqual(asked.activeMember?.id, theirs);
    });

    await test("an account without the benefit table: its confirmed schedule lines decide the tile, and change with them", async () => {
      const ids = await household(PLAIN, "Test household plain", [["Oliver Bennett", "self"]]);
      const me = ids["Oliver Bennett"];
      const plan = (product: string, sum: number): Upload => ({ account: PLAIN, person: "Oliver Bennett", product, currency: "SGD", symbol: "S$", sum, category: "Death",
        benefit: "Death Benefit", read: false });
      await upload(plan("Harbour Life Plan", 200000), me);
      assert.equal(tile(await tiles(PLAIN), "Death").amount, 200000);
      const added = await upload(plan("Lighthouse Term Plan", 50000), me);
      assert.equal(tile(await tiles(PLAIN), "Death").amount, 250000);
      await query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [added]);
      assert.equal(tile(await tiles(PLAIN), "Death").amount, 200000);
      assert.equal((await tiles(PLAIN)).reading, 0, "without the benefit table, a ready document is not waited for");
    });

    await test("Home's quiet re-fetch never starts a document read; opening Home still does (Critic R255 L1)", async () => {
      // A read that an earlier opening of Home started finishes first, so it cannot pick up the document added here.
      await settle();
      const me = (await query<{ id: string }>("SELECT id FROM family_members WHERE account_id=$1", [PLAIN])).rows[0].id;
      const id = await upload({ account: PLAIN, person: "Oliver Bennett", product: "Beacon Life Plan", currency: "SGD", symbol: "S$", sum: 80000, category: "Death",
        benefit: "Death Benefit", read: false }, me);
      const touched = async () => (await query<{ n: number }>("SELECT count(*)::int AS n FROM policies WHERE id=$1 AND (ledger_read_at IS NOT NULL OR reading_cache IS NOT NULL)", [id])).rows[0].n;
      await query("UPDATE policies SET ledger_read_at=now() WHERE account_id=$1 AND id<>$2", [PLAIN, id]);
      const before = outbound.length;
      await tiles(PLAIN, undefined, true); await settle();
      assert.equal(outbound.length - before, 0, "a quiet re-fetch asked a model");
      assert.equal(await touched(), 0, "a quiet re-fetch started a read");
      await tiles(PLAIN); await settle();
      assert.ok(outbound.length > before || await touched() > 0, "opening Home should start the pending read (the probe is live)");
    });

    await test("a receipt or a letter is not waited for (Critic R255 M2)", async () => {
      const me = (await query<{ id: string }>("SELECT id FROM family_members WHERE account_id=$1 AND relationship='self'", [SG])).rows[0].id;
      const receipt = await upload({ account: SG, person: "Priya Nair", product: "Harbour Life Plan receipt", currency: "SGD", symbol: "S$", sum: 1200, category: "Death",
        benefit: "Premium", read: false, line: false }, me);
      await query("UPDATE policies SET document_role='premium_receipt',processing_completed_at=now() WHERE id=$1", [receipt]);
      assert.equal((await tiles(SG, me)).reading, 0);
      await query("UPDATE policies SET document_role='insurer_letter' WHERE id=$1", [receipt]);
      assert.equal((await tiles(SG, me)).reading, 0);
      await query("UPDATE policies SET document_role='schedule' WHERE id=$1", [receipt]);
      assert.equal((await tiles(SG, me)).reading, 1, "a schedule with no reading yet is still waited for");
      await query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [receipt]);
    });

    await test("a household with no benefit sections to link stops waiting once the reading is stored (TE F1)", async () => {
      const acct = EMPTY2;
      const ids = await household(acct, "Test household covers only", [["Lena Fischer", "self"]]);
      const doc = await upload({ account: acct, person: "Lena Fischer", product: "Harbour Life Plan", currency: "SGD", symbol: "S$", sum: 90000, category: "Death",
        benefit: "Death Benefit", benefits: false, relink: false }, ids["Lena Fischer"]);
      await query("UPDATE policies SET processing_completed_at=now() WHERE id=$1", [doc]);
      assert.equal((await tiles(acct)).reading, 0);
    });

    await test("a reading of any shape never fails Home; sections found only by a page read again still wait for linking (Critic R257)", async () => {
      const acct = EMPTY2;
      const me = (await query<{ id: string }>("SELECT id FROM family_members WHERE account_id=$1", [acct])).rows[0].id;
      const doc = await upload({ account: acct, person: "Lena Fischer", product: "Lighthouse Term Plan", currency: "SGD", symbol: "S$", sum: 40000, category: "Death",
        benefit: "Death Benefit", read: false, line: false }, me);
      // The household's earlier document is past its wait, so the count here is this document's alone.
      await query("UPDATE policies SET processing_completed_at=now()-interval '20 minutes' WHERE account_id=$1", [acct]);
      await query("UPDATE policies SET processing_completed_at=now() WHERE id=$1", [doc]);
      const store = (reading: unknown) => query(`INSERT INTO benefit_readings(policy_id,account_id,reading,model,prompt_version,read_at) VALUES($1,$2,$3::jsonb,'test','test',now())
        ON CONFLICT (policy_id) DO UPDATE SET reading=EXCLUDED.reading,read_at=now()`, [doc, acct, JSON.stringify(reading)]);
      try {
        for (const odd of [{ document: { benefits: "none" } }, { document: "unreadable" }, { document: { benefits: { a: 1 } }, pages: "x" }, [], "text", { document: null, pages: [{ json: null }] }]) {
          await store(odd);
          const b = await tiles(acct);
          assert.equal(b.reading, 0, `a household with no section to link stops waiting (${JSON.stringify(odd)})`);
        }
        await store({ document: { covers: [], benefits: [] }, pages: [{ page: 2, json: { benefits: [{ benefit: "Death Benefit" }] } }] });
        assert.equal((await tiles(acct)).reading, 1, "a section found only by a page read again is still waited for until it is linked");
      } finally { await query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [doc]); }
    });

    await test("a household with nobody yet gets the empty portfolio", async () => {
      await household(EMPTY, "Test household empty", []);
      const b = await tiles(EMPTY);
      assert.equal(b.empty, true);
      assert.equal(b.activeMember, null);
    });
  } finally {
    for (const a of [SG, MY, PLAIN, EMPTY, EMPTY2]) {
      await query("DELETE FROM household_members WHERE household_id=$1", [a]).catch(() => undefined);
      await query("DELETE FROM accounts WHERE id=$1", [a]).catch(() => undefined);
    }
  }

  await test("no request tried to leave this machine (no model was asked)", async () => {
    assert.deepEqual(outbound, []);
  });
  console.log(`dashboard dynamic: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
