/** Test engineer, PR #151: Home tiles follow uploads while a document is still being read (the `reading` count) and
 * after. Independent of the PR's own suite. Runs the real dashboard route against a DISPOSABLE local PostgreSQL with
 * the app's schema, for made-up SG / MY / UK households; readings come from a scripted model (no network, no paid call).
 *   DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://...@localhost/... node --import tsx scripts/coverage/te-pr151-test.ts
 * Journeys: upload while Home is open (pending -> read -> tile), add, remove, ended trip vs a yearly policy, an empty
 * person, a household with nobody, and isolation (another household's pending upload or cover never shows here).
 * Negative controls: failed, stale, superseded, removed and long-ready documents are not waited for. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const url = process.env.DATABASE_URL ?? "";
if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
  console.log("te-pr151: skipped (needs DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL)"); process.exit(0);
}
const SG = randomUUID(), MY = randomUUID(), UK = randomUUID(), OFF = randomUUID(), NOBODY = randomUUID();
const USERS: Record<string, string> = Object.fromEntries([SG, MY, UK, OFF, NOBODY].map((a) => [a, randomUUID()]));
Object.assign(process.env, { DEV_AUTH_ENABLED: "1", DEARPOLICY_BENEFIT_TABLE: "1", DEARPOLICY_ALPHA_ACCOUNTS: [SG, MY, UK, NOBODY].join(",") });

let passed = 0; const failures: string[] = []; const notes: string[] = []; const extra: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const { query } = await import("@/lib/db/client");
  const { readDocument, relink } = await import("@/lib/benefit-table/service");
  const { appDb } = await import("@/lib/benefit-table/app");
  const { coverKeyOf, sectionKeyOf } = await import("@/lib/benefit-table/assemble");
  const { GET } = await import("@/app/api/dashboard/route");
  type TableModel = import("@/lib/benefit-table/model").TableModel;
  const links = new Map<string, { section: string; cover: string | null; why: string }>();
  const model = (answer: unknown): TableModel => ({ choice: { provider: "anthropic", model: "te-model" }, async call(c) {
    const json = c.schema && "links" in ((c.schema as { properties?: object }).properties ?? {}) ? { links: [...links.values()] } : answer;
    return { json, stopReason: "end_turn", model: "te-model", input: 1, output: 1, ms: 1 };
  } });

  async function household(account: string, people: [string, string][]) {
    await query("INSERT INTO accounts(id,name) VALUES($1,$2)", [account, "TE151 household"]);
    await query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner')", [account, USERS[account]]);
    const ids: Record<string, string> = {};
    for (const [n, rel] of people) ids[n] = (await query<{ id: string }>("INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,$3) RETURNING id", [account, n, rel])).rows[0].id;
    return ids;
  }
  type Doc = { account: string; person: string; personId: string; product: string; cur: string; sym: string; sum: number; category?: string; benefit?: string;
    trip?: { from: string; to: string }; line?: boolean; status?: string };
  /** The document row as intake leaves it at `status` (default ready), with no reading yet. */
  async function add(d: Doc) {
    const id = randomUUID(), amount = `${d.sym}${d.sum.toLocaleString("en-US")}`;
    const text = `POLICY SCHEDULE\nLife Assured\t${d.person}\n${d.product}\tSum Assured ${amount}\n${d.benefit ?? "Death Benefit"}\t${amount}` + (d.trip ? `\nPeriod of Insurance\t${d.trip.from} to ${d.trip.to}` : "");
    const status = d.status ?? "ready";
    await query(`INSERT INTO policies(id,account_id,family_member_id,product_name,original_filename,storage_key,processing_status,processing_stage,quarantine_status,personal_coverage_confirmed,document_role,processing_completed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$7,'scan_clean',true,'schedule',CASE WHEN $7='ready' THEN now() END)`, [id, d.account, d.personId, d.product, `${d.product}.pdf`, `te151/${id}`, status]);
    await query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)", [d.account, id, text]);
    await query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES($1,$2,$3,'upload')", [id, d.personId, d.account]);
    if (d.line) await query(`INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,currency,product_name,confirmed,evidence_verified)
      VALUES($1,$2,$3,$4,$5,$6,$7,true,true)`, [d.account, id, d.personId, d.category ?? "Death", d.sum, d.cur, d.product]);
    return id;
  }
  /** The benefit-table reading arrives for `id` (what the worker does after the document is ready). */
  async function read(d: Doc, id: string, link = true) {
    const amount = `${d.sym}${d.sum.toLocaleString("en-US")}`;
    const cover = { person: d.person, product: d.product, cover: d.product, plan: null, sumInsured: d.sum, premium: null, premiumFrequency: null, asOf: null,
      startDate: d.trip?.from ?? null, endDate: d.trip?.to ?? null, page: 1, quote: `${d.product} Sum Assured ${amount}` };
    const reading = { document: { kind: "personal_proof", product: d.product, insurer: null, namedPeople: [d.person], plan: null, periodFrom: d.trip?.from ?? null, periodTo: d.trip?.to ?? null },
      covers: [cover], benefits: [{ section: null, column: null, benefit: d.benefit ?? "Death Benefit", pays: "amount", value: d.sum, percentOf: null, baseAmount: null, baseQuote: null,
        fromDay: null, maxDays: null, conditions: [], page: 1, quote: `${d.benefit ?? "Death Benefit"} ${amount}` }] };
    const r = await readDocument(appDb, model(reading), d.account, id);
    assert.ok(r.read, `reading not stored for ${d.product}`);
    const section = sectionKeyOf(id, { section: null, column: null });
    links.set(section, { section, cover: coverKeyOf({ product: d.product, cover: d.product, plan: null }), why: "schedule" });
    if (link) await relink(appDb, model(null), d.account);
  }
  type Tile = { category: string; status: string; amount: number | null; currency: string; parts: { name: string; amount: number | null; currency: string | null }[] | null };
  type Body = { coverages: Tile[]; activeMember: { id: string } | null; empty?: boolean; reading?: number; family: { id: string }[] };
  async function home(account: string, member?: string): Promise<Body> {
    process.env.DEV_ACCOUNT_ID = USERS[account];
    const res = await GET(new NextRequest(`http://localhost/api/dashboard${member ? `?familyMemberId=${member}` : ""}`));
    const body = await res.json() as Body; assert.equal(res.status, 200, JSON.stringify(body)); return body;
  }
  const tile = (b: Body, c: string) => b.coverages.find((t) => t.category === c)!;
  const parts = (t: Tile) => (t.parts ?? []).map((p) => `${p.name} ${p.amount} ${p.currency}`).sort();
  const day = (o: number) => { const d = new Date(Date.now() + o * 86400000); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`; };
  const age = (id: string, col: "updated_at" | "processing_completed_at", minutes: number) => query(`UPDATE policies SET ${col}=now()-($2||' minutes')::interval WHERE id=$1`, [id, String(minutes)]);

  try {
    const markets = [
      { account: SG, cur: "SGD", sym: "S$", sum: 420000, names: ["Wei Ling Tan", "Kumar Pillai", "Hui Min Tan"] },
      { account: MY, cur: "MYR", sym: "RM ", sum: 180000, names: ["Siti Mariam binti Osman", "Hafiz bin Zainal", "Danish bin Hafiz"] },
      { account: UK, cur: "GBP", sym: "£", sum: 95000, names: ["Eleanor Hughes", "Tom Hughes", "Maisie Hughes"] },
    ] as const;
    const people: Record<string, Record<string, string>> = {};
    for (const m of markets) people[m.account] = await household(m.account, [[m.names[0], "self"], [m.names[1], "spouse"], [m.names[2], "child"]]);

    for (const m of markets) {
      const ids = people[m.account], me = ids[m.names[0]], spouse = ids[m.names[1]], child = ids[m.names[2]];
      const doc = (product: string, o: Partial<Doc> = {}): Doc => ({ account: m.account, person: m.names[0], personId: me, product, cur: m.cur, sym: m.sym, sum: m.sum, ...o });

      // J: upload while Home is open. Each Home fetch is a poll; the tile must appear only once the reading is stored.
      const j = doc("Kestrel Whole Life");
      let jid = "";
      await test(`${m.cur} J1 nothing uploaded: reading 0, no covered tile`, async () => {
        const b = await home(m.account, me);
        assert.equal(b.reading, 0); assert.ok(b.coverages.every((c) => c.status === "not_covered"));
      });
      await test(`${m.cur} J2 upload still extracting: reading 1, Death tile not yet covered (no amount from page text)`, async () => {
        jid = await add({ ...j, status: "extracting" });
        await query("UPDATE policies SET updated_at=now() WHERE id=$1", [jid]);
        const b = await home(m.account, me);
        assert.equal(b.reading, 1); assert.equal(tile(b, "Death").status, "not_covered"); assert.equal(tile(b, "Death").amount ?? null, null);
      });
      await test(`${m.cur} J3 marked ready, reading not stored yet: still reading 1, tile not covered`, async () => {
        await query("UPDATE policies SET processing_status='ready',processing_completed_at=now() WHERE id=$1", [jid]);
        const b = await home(m.account, me);
        assert.equal(b.reading, 1); assert.equal(tile(b, "Death").status, "not_covered");
      });
      await test(`${m.cur} J4 reading stored: reading 0 (polling stops) and the tile shows the sum in ${m.cur}`, async () => {
        await read(j, jid);
        const b = await home(m.account, me), t = tile(b, "Death");
        assert.equal(b.reading, 0);
        assert.deepEqual([t.status, t.amount, t.currency], ["covered", m.sum, m.cur]);
        assert.deepEqual(parts(t), [`Kestrel Whole Life ${m.sum} ${m.cur}`]);
      });
      // A: add a policy; R: remove it.
      const a = doc("Osprey Term Cover", { sum: 60000 });
      let aid = "";
      await test(`${m.cur} A1 a second policy read: total ${m.sum + 60000}, two parts`, async () => {
        aid = await add(a); await read(a, aid);
        const t = tile(await home(m.account, me), "Death");
        assert.equal(t.amount, m.sum + 60000); assert.equal(t.currency, m.cur);
        assert.deepEqual(parts(t), [`Kestrel Whole Life ${m.sum} ${m.cur}`, `Osprey Term Cover 60000 ${m.cur}`].sort());
      });
      await test(`${m.cur} R1 that policy removed: back to one part`, async () => {
        await query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [aid]);
        const t = tile(await home(m.account, me), "Death");
        assert.equal(t.amount, m.sum); assert.deepEqual(parts(t), [`Kestrel Whole Life ${m.sum} ${m.cur}`]);
      });
      // E: an ended single trip leaves the tile; a trip in force and a yearly policy past its first end date stay.
      await test(`${m.cur} E1 trip in force counts; a trip that ended 20 days ago does not`, async () => {
        const trip = (p: string, f: number, t: number) => doc(p, { sum: 50000, category: "Personal Accident", benefit: "Accidental Death", trip: { from: day(f), to: day(t) } });
        const live = trip("Swift Single Trip Travel", -2, 5), old = trip("Plover Single Trip Travel", -30, -20);
        await read(live, await add(live)); await read(old, await add(old));
        const t = tile(await home(m.account, me), "Personal Accident");
        assert.equal(t.status, "covered"); assert.equal(t.amount, 50000);
        assert.deepEqual(parts(t), [`Swift Single Trip Travel 50000 ${m.cur}`]);
      });
      await test(`${m.cur} E2 negative control: a yearly personal accident policy whose first year ended stays (may be renewed)`, async () => {
        const yearly = doc("Heron Personal Accident Plan", { person: m.names[1], personId: spouse, sum: 70000, category: "Personal Accident", benefit: "Accidental Death",
          trip: { from: day(-400), to: day(-35) } });
        await read(yearly, await add(yearly));
        const t = tile(await home(m.account, spouse), "Personal Accident");
        assert.equal(t.status, "covered"); assert.equal(t.amount, 70000);
      });
      // P: an empty person, and pending work for another person.
      await test(`${m.cur} P1 the child, with no policies, has no covered tile and no amount`, async () => {
        const b = await home(m.account, child);
        assert.equal(b.activeMember?.id, child);
        assert.ok(b.coverages.every((c) => c.status === "not_covered" && c.amount == null), JSON.stringify(b.coverages.filter((c) => c.status !== "not_covered")));
      });
      await test(`${m.cur} P2 a pending upload for the spouse: reading counts on Home (household-wide), self's tiles unchanged`, async () => {
        const p = await add(doc("Gannet Life", { person: m.names[1], personId: spouse, status: "queued" }));
        const b = await home(m.account, me);
        assert.equal(b.reading, 1); assert.equal(tile(b, "Death").amount, m.sum);
        await query("UPDATE policies SET processing_status='failed' WHERE id=$1", [p]);
      });
    }

    // N: what is not waited for (SG), each with its positive twin so the window edges are real.
    const sgMe = people[SG][markets[0].names[0]];
    const sgDoc = (product: string, status: string): Doc => ({ account: SG, person: markets[0].names[0], personId: sgMe, product, cur: "SGD", sym: "S$", sum: 1000, status });
    await test("N1 failed is not waited for", async () => { await add(sgDoc("N1 Plan", "failed")); assert.equal((await home(SG, sgMe)).reading, 0); });
    await test("N2 queued 29 min ago counts; 31 min ago does not", async () => {
      const id = await add(sgDoc("N2 Plan", "queued")); await age(id, "updated_at", 29);
      assert.equal((await home(SG, sgMe)).reading, 1);
      await age(id, "updated_at", 31); assert.equal((await home(SG, sgMe)).reading, 0);
    });
    await test("N3 'uploaded' (awaiting the scan) counts while fresh", async () => {
      const id = await add(sgDoc("N3 Plan", "uploaded")); assert.equal((await home(SG, sgMe)).reading, 1);
      await age(id, "updated_at", 45); assert.equal((await home(SG, sgMe)).reading, 0);
    });
    await test("N4 ready 9 min ago without a reading counts; 11 min ago does not", async () => {
      const id = await add(sgDoc("N4 Plan", "ready")); await age(id, "processing_completed_at", 9);
      assert.equal((await home(SG, sgMe)).reading, 1);
      await age(id, "processing_completed_at", 11); assert.equal((await home(SG, sgMe)).reading, 0);
    });
    await test("N5 a superseded document being read is not waited for", async () => {
      const id = await add(sgDoc("N5 Plan", "extracting")); assert.equal((await home(SG, sgMe)).reading, 1);
      await query("UPDATE policies SET superseded_at=now() WHERE id=$1", [id]); assert.equal((await home(SG, sgMe)).reading, 0);
    });
    await test("N6 a removed document being read is not waited for", async () => {
      const id = await add(sgDoc("N6 Plan", "indexing")); assert.equal((await home(SG, sgMe)).reading, 1);
      await query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [id]); assert.equal((await home(SG, sgMe)).reading, 0);
    });
    await test("N7 a ready document with a NULL completion time is not waited for", async () => {
      const id = await add(sgDoc("N7 Plan", "ready")); await query("UPDATE policies SET processing_completed_at=NULL WHERE id=$1", [id]);
      assert.equal((await home(SG, sgMe)).reading, 0);
    });

    // G (01323b3, TE F1): the gap between the reading being stored and its sections being linked (a second model call).
    // First cut (6af3b7b) only recorded notes: reading=0 before relink while the tile lacked the new policy (F1).
    const gDoc = (product: string, sum: number): Doc => ({ account: SG, person: markets[0].names[0], personId: sgMe, product, cur: "SGD", sym: "S$", sum });
    await test("G1 reading stored, links not yet made: Home still waits; after relink it stops and the tile has both policies", async () => {
      const g = gDoc("Gull Life Plan", 77000), id = await add(g);
      await read(g, id, false);
      const b = await home(SG, sgMe);
      assert.equal(b.reading, 1, "must still wait: the new policy is not on the tile yet");
      assert.equal(tile(b, "Death").amount, 420000);
      await relink(appDb, model(null), SG);
      const c = await home(SG, sgMe);
      assert.equal(c.reading, 0);
      assert.equal(tile(c, "Death").amount, 497000);
      await query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [id]);
    });
    await test("G2 another household's relink never releases this household's wait", async () => {
      const g = gDoc("Tern Life Plan", 11000), id = await add(g);
      await read(g, id, false);
      await relink(appDb, model(null), MY); await relink(appDb, model(null), UK);
      assert.equal((await home(SG, sgMe)).reading, 1);
      await relink(appDb, model(null), SG);
      assert.equal((await home(SG, sgMe)).reading, 0);
      await query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [id]);
    });
    await test("G3 note: a relink that writes no link (model gives none): who waits, and the bound still ends it", async () => {
      const g = gDoc("Skua Life Plan", 12000), id = await add(g);
      await read(g, id, false);
      const saved = new Map(links); links.clear();
      try {
        await relink(appDb, model(null), SG);
        const r1 = (await home(SG, sgMe)).reading;
        await age(id, "processing_completed_at", 11);
        const r2 = (await home(SG, sgMe)).reading;
        // Grader correction (logged): first cut asserted r2 === 0. An empty relink deletes every model link, so EVERY
        // document of the household read in the last 10 minutes waits again (r1 = 5 here), not only this one; each is still
        // bounded by its own 10 minutes. Original grade (FAIL) kept in pr151-results.md.
        notes.push(`G3: relink wrote no link: reading=${r1} right after (every document read in the last 10 min), ${r2} once this one passes its bound`);
        assert.equal(r2, r1! - 1, "this document's bound ends its own wait");
      } finally {
        for (const [k, v] of saved) links.set(k, v);
        await relink(appDb, model(null), SG);
        await query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [id]);
      }
      assert.equal((await home(SG, sgMe)).reading, 0, "a later relink that writes links ends every wait");
    });
    await test("G4 the household's first document, read with no benefits at all: nothing to link, so Home does not wait", async () => {
      const acc = randomUUID(); USERS[acc] = randomUUID(); extra.push(acc);
      process.env.DEARPOLICY_ALPHA_ACCOUNTS += "," + acc;
      const me = (await household(acc, [["Ines Duarte", "self"]]))["Ines Duarte"];
      const id = await add({ account: acc, person: "Ines Duarte", personId: me, product: "Bare Plan", cur: "SGD", sym: "S$", sum: 1 });
      const r = await readDocument(appDb, model({ document: { kind: "personal_proof", product: "Bare Plan", insurer: null, namedPeople: ["Ines Duarte"], plan: null, periodFrom: null, periodTo: null }, covers: [], benefits: [] }), acc, id);
      notes.push(`G4: reading with no benefits stored=${r.read}`);
      assert.equal((await home(acc, me)).reading, r.read ? 0 : 1);
    });

    // N8-N9 (6af3b7b): payment papers and letters are never read into the benefit table, so Home does not wait for them;
    // a document whose role is not known yet is still waited for.
    for (const role of ["premium_receipt", "renewal_statement", "annual_statement", "insurer_letter", "claim_decision", "medical_bill", "app_screenshot", "personal_notes"])
      await test(`N8 a ready ${role} without a reading is not waited for`, async () => {
        const id = await add(sgDoc(`N8 ${role}`, "ready")); await query("UPDATE policies SET document_role=$2 WHERE id=$1", [id, role]);
        assert.equal((await home(SG, sgMe)).reading, 0);
        await query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [id]);
      });
    await test("N9 a ready document with no role yet, and a certificate, are still waited for", async () => {
      const a = await add(sgDoc("N9 none", "ready")); await query("UPDATE policies SET document_role=NULL WHERE id=$1", [a]);
      assert.equal((await home(SG, sgMe)).reading, 1);
      const b = await add(sgDoc("N9 cert", "ready")); await query("UPDATE policies SET document_role='certificate' WHERE id=$1", [b]);
      assert.equal((await home(SG, sgMe)).reading, 2);
      for (const id of [a, b]) await query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [id]);
    });
    await test("N10 a receipt still being extracted IS waited for (its role is not known until it is read)", async () => {
      const id = await add(sgDoc("N10 receipt", "extracting")); await query("UPDATE policies SET document_role='premium_receipt',updated_at=now() WHERE id=$1", [id]);
      assert.equal((await home(SG, sgMe)).reading, 1);
      await query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [id]);
    });

    // I: isolation. Another household's pending uploads and covers never reach this one.
    await test("I1 MY and UK pending uploads do not count on SG's Home, and SG's on neither", async () => {
      const my = people[MY][markets[1].names[0]], uk = people[UK][markets[2].names[0]];
      const pm = await add({ account: MY, person: markets[1].names[0], personId: my, product: "I1 MY", cur: "MYR", sym: "RM ", sum: 1, status: "extracting" });
      const pu = await add({ account: UK, person: markets[2].names[0], personId: uk, product: "I1 UK", cur: "GBP", sym: "£", sum: 1, status: "ready" });
      assert.equal((await home(SG, sgMe)).reading, 0);
      assert.equal((await home(MY, my)).reading, 1); assert.equal((await home(UK, uk)).reading, 1);
      const ps = await add(sgDoc("I1 SG", "queued"));
      assert.equal((await home(MY, my)).reading, 1); assert.equal((await home(UK, uk)).reading, 1); assert.equal((await home(SG, sgMe)).reading, 1);
      for (const id of [pm, pu, ps]) await query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [id]);
    });
    await test("I2 asking SG's Home for a MY person gives SG's own person and SG's own SGD tiles", async () => {
      const b = await home(SG, people[MY][markets[1].names[0]]);
      assert.ok(Object.values(people[SG]).includes(b.activeMember!.id));
      assert.ok(b.family.every((f) => Object.values(people[SG]).includes(f.id)));
      assert.ok(b.coverages.every((c) => (c.parts ?? []).every((p) => p.currency === "SGD")));
    });
    await test("I3 the same product name in two households: each total is its own", async () => {
      assert.equal(tile(await home(MY, people[MY][markets[1].names[0]]), "Death").amount, 180000);
      assert.equal(tile(await home(UK, people[UK][markets[2].names[0]]), "Death").amount, 95000);
    });

    // O: account without the benefit table: a ready document is not waited for, an extracting one is.
    await test("O1 benefit table off: ready without reading = 0, extracting = 1, tile from the confirmed line", async () => {
      const me = (await household(OFF, [["Rhys Morgan", "self"]]))["Rhys Morgan"];
      const d: Doc = { account: OFF, person: "Rhys Morgan", personId: me, product: "Plain Life", cur: "SGD", sym: "S$", sum: 210000, line: true };
      await add(d);
      let b = await home(OFF); assert.equal(b.reading, 0); assert.equal(tile(b, "Death").amount, 210000);
      await add({ ...d, product: "Plain Pending", status: "extracting", line: false });
      b = await home(OFF); assert.equal(b.reading, 1); assert.equal(tile(b, "Death").amount, 210000);
    });
    await test("O2 a household with nobody: empty portfolio, reading 0", async () => {
      await household(NOBODY, []);
      // Grader correction (logged): first cut expected reading === 0; the route's early return for a household with
      // nobody omits the field. Undefined is falsy, so Home does not poll either way; original grade (FAIL) kept in the log.
      const b = await home(NOBODY); assert.equal(b.empty, true); assert.equal(b.activeMember, null); assert.ok(!b.reading);
    });
    await test("O3 a household with nobody cannot hold a document being read (family_member_id is required)", async () => {
      await assert.rejects(query(`INSERT INTO policies(id,account_id,original_filename,storage_key,processing_status,processing_stage,quarantine_status) VALUES($1,$2,'o3.pdf','te151/o3','extracting','extracting','scan_clean')`, [randomUUID(), NOBODY]), /family_member_id/);
    });
  } finally {
    for (const acc of [SG, MY, UK, OFF, NOBODY, ...extra]) {
      await query("DELETE FROM household_members WHERE household_id=$1", [acc]).catch(() => undefined);
      await query("DELETE FROM accounts WHERE id=$1", [acc]).catch(() => undefined);
    }
  }
  console.log(`te-pr151: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  for (const n of notes) console.log("  NOTE " + n);
  process.exit(failures.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
