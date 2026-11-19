/**
 * Plans: Free, Plus and Family (lib/plans/catalogue.ts, household-plan.ts, stripe.ts; sql/household-plans.sql).
 *
 *   npm run -s billing:plans-test
 *
 * Offline: PGlite with the production schema, made-up households, and a fake Stripe (no network, no keys). Covers:
 * the approved numbers; the limit messages; counting (unreadable and replaced documents don't count, another
 * household's documents and questions never count); limits off by default; a household can't write its own plan;
 * the webhook's signature check, event order and complimentary plans; billing off until every setting is there;
 * the upload, chat and webhook routes; and the landing page's pricing section.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { PLANS, checkDocumentLimit, checkQuestionLimit, documentsLabel, formatSgd, questionsResetLabel } from "@/lib/plans/catalogue";

const A = "00000000-0000-0000-0000-0000000b1a00", B = "00000000-0000-0000-0000-0000000b1b00";
const PERSON_A = "61000000-0000-4000-8000-000000000001", PERSON_B = "61000000-0000-4000-8000-000000000002";
const pid = (n: number) => "62000000-0000-4000-8000-" + String(n).padStart(12, "0");

test("the approved plans (DC, 18 Nov 2026)", () => {
  assert.deepEqual([PLANS.free.documents, PLANS.free.questionsPerMonth, PLANS.free.priceMonthlySgd], [5, 10, 0]);
  assert.deepEqual([PLANS.plus.documents, PLANS.plus.questionsPerMonth, PLANS.plus.priceMonthlySgd, PLANS.plus.priceYearlySgd], [20, 60, 7.9, 79]);
  assert.deepEqual([PLANS.family.unlimitedDocuments, PLANS.family.documents, PLANS.family.questionsPerMonth, PLANS.family.priceMonthlySgd, PLANS.family.priceYearlySgd], [true, 100, 150, 14.9, 149]);
  assert.equal(formatSgd(7.9), "S$7.90");
  assert.equal(formatSgd(149), "S$149");
  assert.equal(documentsLabel(PLANS.family), "Unlimited documents");
  assert.equal(questionsResetLabel(new Date("2026-11-30T23:59:00Z")), "1 December");
  assert.equal(questionsResetLabel(new Date("2026-12-05T00:00:00Z")), "1 January");
});

test("limit checks: allowed below the limit, a plain message with the next plan at it", () => {
  assert.equal(checkDocumentLimit("free", 4).allowed, true);
  const doc = checkDocumentLimit("free", 5);
  assert.equal(doc.allowed, false);
  if (!doc.allowed) {
    assert.equal(doc.code, "document_limit");
    assert.match(doc.message, /Free plan keeps up to 5 documents, and your household has 5\. Upgrade to Plus for 20 documents, or delete/);
    assert.ok(doc.message.length <= 220, "fits the upload message box");
  }
  const family = checkDocumentLimit("family", 100);
  assert.ok(!family.allowed && /Delete a document/.test(family.message) && !/Upgrade/.test(family.message), "top plan: no upgrade offered");
  assert.equal(checkQuestionLimit("plus", 59).allowed, true);
  const q = checkQuestionLimit("free", 10, new Date("2026-11-18T05:00:00Z"));
  assert.ok(!q.allowed && q.code === "question_limit");
  if (!q.allowed) {
    assert.match(q.message, /this month’s 10 questions on the Free plan\. Questions start again on 1 December\. Upgrade to Plus for 60 questions a month\. Your documents and earlier answers are still here\./);
    assert.ok(!/\b(model|token|quota|billing|limit reached)\b/i.test(q.message), "household words only");
  }
  const top = checkQuestionLimit("family", 150);
  assert.ok(!top.allowed && !/Upgrade/.test(top.message));
});

const STRIPE_ENV = {
  DEARPOLICY_BILLING: "on", STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_WEBHOOK_SECRET: "whsec_fake",
  STRIPE_PRICE_PLUS_MONTHLY: "price_pm", STRIPE_PRICE_PLUS_YEARLY: "price_py", STRIPE_PRICE_FAMILY_MONTHLY: "price_fm", STRIPE_PRICE_FAMILY_YEARLY: "price_fy",
} as const;

test("billing is off unless every setting is there", async () => {
  const { billingConfig } = await import("@/lib/billing/stripe");
  assert.equal(billingConfig({} as NodeJS.ProcessEnv), null);
  assert.ok(billingConfig({ ...STRIPE_ENV } as unknown as NodeJS.ProcessEnv));
  for (const key of Object.keys(STRIPE_ENV)) {
    const env = { ...STRIPE_ENV, [key]: "" } as unknown as NodeJS.ProcessEnv;
    assert.equal(billingConfig(env), null, key + " missing keeps billing off");
  }
  assert.equal(billingConfig({ ...STRIPE_ENV, DEARPOLICY_BILLING: "off" } as unknown as NodeJS.ProcessEnv), null);
});

const sign = (body: string, secret: string, t: number) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

test("webhook signature: right secret within five minutes only", async () => {
  const { verifyStripeSignature } = await import("@/lib/billing/stripe");
  const body = '{"id":"evt_1"}', now = 1_800_000_000;
  assert.equal(verifyStripeSignature(body, sign(body, "whsec_fake", now), "whsec_fake", now), true);
  assert.equal(verifyStripeSignature(body, sign(body, "whsec_other", now), "whsec_fake", now), false, "wrong secret");
  assert.equal(verifyStripeSignature(body + " ", sign(body, "whsec_fake", now), "whsec_fake", now), false, "changed body");
  assert.equal(verifyStripeSignature(body, sign(body, "whsec_fake", now - 301), "whsec_fake", now), false, "too old");
  assert.equal(verifyStripeSignature(body, null, "whsec_fake", now), false, "no header");
  assert.equal(verifyStripeSignature(body, "t=1,v1=zz", "whsec_fake", now), false, "malformed");
});

test("events: a subscription becomes a plan; unknown prices and households are ignored", async () => {
  const { billingConfig, handleStripeEvent, planWriteFor } = await import("@/lib/billing/stripe");
  const config = billingConfig({ ...STRIPE_ENV } as unknown as NodeJS.ProcessEnv)!;
  const sub = (price: string, extra: Record<string, unknown> = {}) => ({ id: "sub_1", customer: "cus_1", status: "active", metadata: { household_id: A }, items: { data: [{ price: { id: price }, current_period_end: 1_900_000_000 }] }, ...extra });
  const w = planWriteFor(config, sub("price_fy"), 1_800_000_000, null)!;
  assert.deepEqual([w.householdId, w.plan, w.interval, w.status, w.customerId], [A, "family", "year", "active", "cus_1"]);
  assert.equal(w.currentPeriodEnd?.toISOString(), new Date(1_900_000_000_000).toISOString());
  assert.equal(planWriteFor(config, sub("price_someone_elses"), 1, null), null, "a price DearPolicy doesn't sell");
  assert.equal(planWriteFor(config, sub("price_pm", { metadata: {} }), 1, null), null, "no household");

  const saved: unknown[] = [];
  const save = async (x: unknown) => { saved.push(x); };
  // checkout.session.completed fetches the subscription from Stripe.
  const calls: string[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push(String(init.method) + " " + url);
    assert.equal((init.headers as Record<string, string>).authorization, "Bearer sk_test_fake");
    return new Response(JSON.stringify(sub("price_pm", { metadata: {} })), { status: 200 });
  }) as unknown as typeof fetch;
  assert.equal(await handleStripeEvent(config, { id: "e1", type: "checkout.session.completed", created: 10, data: { object: { subscription: "sub_1", client_reference_id: A } } }, { fetchImpl: fakeFetch, save }), "saved");
  assert.deepEqual(calls, ["GET https://api.stripe.com/v1/subscriptions/sub_1"]);
  assert.equal((saved[0] as { plan: string }).plan, "plus");
  // Subscription events use the subscription as Stripe has it now (two events in one second can arrive in either order).
  const now = (status: string) => (async (url: string) => { calls.push("GET " + url); return new Response(JSON.stringify(sub("price_fm", { status })), { status: 200 }); }) as unknown as typeof fetch;
  assert.equal(await handleStripeEvent(config, { id: "e2", type: "customer.subscription.updated", created: 11, data: { object: sub("price_pm", { status: "active" }) } }, { fetchImpl: now("canceled"), save }), "saved");
  assert.deepEqual([(saved[1] as { status: string }).status, (saved[1] as { plan: string }).plan], ["canceled", "family"], "Stripe's current state, not the event's copy");
  const gone = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
  assert.equal(await handleStripeEvent(config, { id: "e2b", type: "customer.subscription.deleted", created: 12, data: { object: sub("price_pm") } }, { fetchImpl: gone, save }), "saved");
  assert.equal((saved[2] as { status: string }).status, "canceled");
  const down = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(handleStripeEvent(config, { id: "e2c", type: "customer.subscription.updated", created: 13, data: { object: sub("price_pm") } }, { fetchImpl: down, save }), "Stripe down: the webhook fails so Stripe sends it again");
  assert.equal(await handleStripeEvent(config, { id: "e3", type: "invoice.paid", created: 12, data: { object: {} } }, { save }), "ignored");
});

test("checkout: the household id travels on the session and the subscription; Stripe's errors stay private", async () => {
  const { billingConfig, createCheckoutSession, StripeRequestFailed } = await import("@/lib/billing/stripe");
  const config = billingConfig({ ...STRIPE_ENV } as unknown as NodeJS.ProcessEnv)!;
  let sent = "";
  const ok = (async (_u: string, init: RequestInit) => { sent = String(init.body); return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/x" })); }) as unknown as typeof fetch;
  const url = await createCheckoutSession(config, { householdId: A, plan: "plus", interval: "year", customerId: "cus_a", origin: "https://app.example" }, ok);
  assert.equal(url, "https://checkout.stripe.com/c/x");
  const p = new URLSearchParams(sent);
  assert.equal(p.get("line_items[0][price]"), "price_py");
  assert.equal(p.get("client_reference_id"), A);
  assert.equal(p.get("subscription_data[metadata][household_id]"), A);
  assert.equal(p.get("mode"), "subscription");
  assert.equal(p.get("customer"), "cus_a", "always the household's one customer");
  assert.equal(p.get("customer_email"), null);
  assert.equal(p.get("success_url"), "https://app.example/usage?upgraded=1");
  const bad = (async () => new Response('{"error":{"message":"No such price: price_py; secret detail"}}', { status: 400 })) as unknown as typeof fetch;
  await assert.rejects(createCheckoutSession(config, { householdId: A, plan: "plus", interval: "year", customerId: "cus_a", origin: "https://x" }, bad), (e: unknown) => e instanceof StripeRequestFailed && !/secret detail/.test((e as Error).message));
});

// ---- Database: PGlite with the production schema --------------------------------------------------------------------

let dbReady: Promise<import("@electric-sql/pglite").PGlite> | null = null;
async function database() {
  dbReady ??= (async () => {
    const { installDatabase } = await import("../r6/fixture");
    const db = await installDatabase();
    for (const id of [A, B]) {
      await db.query("INSERT INTO accounts(id,name) VALUES($1,$2)", [id, id === A ? "Tan household" : "Lim household"]);
      await db.query("INSERT INTO household_members(household_id,user_id,role) VALUES($1,$1,'owner')", [id]);
    }
    await db.query("INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Tan Mei Ling','self'),($3,$4,'Lim Wei Jie','self')", [PERSON_A, A, PERSON_B, B]);
    return db;
  })();
  return dbReady;
}
async function addPolicy(db: import("@electric-sql/pglite").PGlite, n: number, account: string, status = "ready", superseded = false) {
  await db.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,quarantine_status,superseded_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,'scan_clean',$8)`, [pid(n), account, account === A ? PERSON_A : PERSON_B, `doc-${n}.pdf`, `k-${n}`, `h-${n}`, status, superseded ? new Date() : null]);
}

test("before sql/household-plans.sql: every household reads as Free, nothing is refused", async () => {
  await database();
  const { readHouseholdPlan, mayAddDocument, takeQuestion, PlanCheckUnavailable } = await import("@/lib/billing/household-plan");
  const plan = await readHouseholdPlan(A);
  assert.equal(plan.planId, "free");
  assert.equal(plan.stored, false);
  delete process.env.DEARPOLICY_PLAN_LIMITS;
  assert.equal((await mayAddDocument(A)).allowed, true);
  assert.equal((await takeQuestion(A)).allowed, true);
  // Limits switched on before the table exists: nothing is refused or allowed on a guess, and nobody drops to Free.
  process.env.DEARPOLICY_PLAN_LIMITS = "on";
  try {
    await assert.rejects(readHouseholdPlan(A), PlanCheckUnavailable);
    await assert.rejects(mayAddDocument(A), PlanCheckUnavailable);
    await assert.rejects(takeQuestion(A), PlanCheckUnavailable);
  } finally {
    delete process.env.DEARPOLICY_PLAN_LIMITS;
  }
});

test("counting and limits, per household", async () => {
  const db = await database();
  await db.exec(readFileSync("sql/household-plans.sql", "utf8"));
  const H = await import("@/lib/billing/household-plan");
  for (let n = 1; n <= 4; n++) await addPolicy(db, n, A);
  await addPolicy(db, 5, A, "failed"); // couldn't be read: doesn't count
  await addPolicy(db, 6, A, "ready", true); // replaced by a newer copy: doesn't count
  for (let n = 20; n <= 29; n++) await addPolicy(db, n, B); // another household's: never counts for A
  assert.equal(await H.keptDocumentCount(A), 4);
  assert.equal(await H.keptDocumentCount(B), 10);

  process.env.DEARPOLICY_PLAN_LIMITS = "on";
  try {
    assert.equal((await H.mayAddDocument(A)).allowed, true, "4 of 5");
    await addPolicy(db, 7, A, "queued");
    const full = await H.mayAddDocument(A);
    assert.equal(full.allowed, false, "5 of 5, a document still being read counts");
    assert.equal((await H.mayAddDocument(A, { replacingPolicyId: pid(1) })).allowed, true, "a newer copy of a counted document takes its place");
    assert.equal((await H.mayAddDocument(A, { replacingPolicyId: pid(5) })).allowed, false, "a newer copy of an unreadable one is one more (TE F4)");
    assert.equal((await H.mayAddDocument(A, { replacingPolicyId: pid(6) })).allowed, false, "an already-replaced document has no place to give");
    assert.equal((await H.mayAddDocument(A, { replacingPolicyId: pid(20) })).allowed, false, "another household's document is no replacement (TE F5)");
    assert.equal((await H.mayAddDocument(A, { replacingPolicyId: "not-a-real-id" })).allowed, false, "a made-up id is no replacement (TE F5)");
    assert.equal((await H.mayAddDocument(A, { rereadingPolicyId: pid(1) })).allowed, true, "reading a counted document again adds nothing");
    assert.equal((await H.mayAddDocument(A, { rereadingPolicyId: pid(5) })).allowed, false, "reading an unreadable one again would make 6 of 5 (TE F3)");
    // A newer copy already recorded, its original not yet marked replaced: a second newer copy has no place (TE F7).
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,quarantine_status,supersedes_id)
      VALUES($1,$2,$3,'copy.pdf','k-copy','h-copy','queued','scan_clean',$4)`, [pid(800), A, PERSON_A, pid(1)]);
    assert.equal((await H.mayAddDocument(A, { replacingPolicyId: pid(1) })).allowed, false, "a document already being replaced has no place to give (TE F7)");
    await db.query("DELETE FROM policies WHERE id=$1", [pid(800)]);
    assert.equal((await H.mayAddDocument(A, { replacingPolicyId: pid(1) })).allowed, true, "and has it again once that copy is gone");
    assert.equal((await H.mayAddDocument(B)).allowed, false, "B has 10 on Free");

    // A paid plan, written by the server.
    await db.query("INSERT INTO household_plans(account_id,plan,status,billing_interval,stripe_customer_id) VALUES($1,'plus','active','year','cus_b')", [B]);
    assert.equal((await H.readHouseholdPlan(B)).planId, "plus");
    assert.equal((await H.mayAddDocument(B)).allowed, true, "10 of 20 on Plus");
    assert.equal((await H.readHouseholdPlan(A)).planId, "free", "B's plan is not A's");
    await db.query("UPDATE household_plans SET status='canceled' WHERE account_id=$1", [B]);
    assert.equal((await H.readHouseholdPlan(B)).planId, "free", "a cancelled subscription is Free");
    await db.query("UPDATE household_plans SET status='past_due' WHERE account_id=$1", [B]);
    assert.equal((await H.readHouseholdPlan(B)).planId, "plus", "kept while Stripe retries a failed payment");

    // Questions: taken one by one as each is accepted, every member together, this household only.
    for (let i = 0; i < 10; i++) assert.equal((await H.takeQuestion(A)).allowed, true, "question " + (i + 1) + " of 10");
    assert.equal(await H.questionsThisMonth(A), 10);
    const q = await H.takeQuestion(A);
    assert.ok(!q.allowed && q.code === "question_limit", "the 11th question on Free");
    assert.equal(await H.questionsThisMonth(A), 10, "a refused question isn't counted");
    // Deleting every chat never gives the questions back (Critic HIGH1).
    await db.query("INSERT INTO chat_conversations(id,account_id,title) VALUES($1,$2,'a')", [pid(900), A]);
    await db.query("INSERT INTO chat_messages(conversation_id,account_id,role,content) VALUES($1,$2,'user','q')", [pid(900), A]);
    await db.query("DELETE FROM chat_messages WHERE account_id=$1", [A]);
    await db.query("DELETE FROM chat_conversations WHERE account_id=$1", [A]);
    assert.equal((await H.takeQuestion(A)).allowed, false, "still used up after deleting chats");
    // Last month's count is last month's.
    await db.query("UPDATE household_question_counts SET month=(date_trunc('month',now() AT TIME ZONE 'UTC')-interval '1 day')::date WHERE account_id=$1", [A]);
    assert.equal(await H.questionsThisMonth(A), 0);
    assert.equal((await H.takeQuestion(A)).allowed, true, "a new month starts again");
    // Ten at once, one left: only one gets through.
    await db.query("UPDATE household_question_counts SET questions=9 WHERE account_id=$1 AND month=date_trunc('month',now() AT TIME ZONE 'UTC')::date", [A]);
    const burst = await Promise.all(Array.from({ length: 10 }, () => H.takeQuestion(A)));
    assert.equal(burst.filter((r) => r.allowed).length, 1, "questions sent together can't all slip past the limit");
    for (let i = 0; i < 30; i++) await H.takeQuestion(B);
    assert.equal(await H.questionsThisMonth(B), 30, "B's questions are B's");
    assert.equal((await H.takeQuestion(B)).allowed, true, "31 of 60 on Plus");

    // Limits off again: nothing refused, whatever the counts.
    process.env.DEARPOLICY_PLAN_LIMITS = "off";
    assert.equal((await H.takeQuestion(A)).allowed, true);
    assert.equal((await H.mayAddDocument(A)).allowed, true);
  } finally {
    delete process.env.DEARPOLICY_PLAN_LIMITS;
  }
});

test("uploads sent at the same moment can't all pass the document limit (TE F6)", async () => {
  const db = await database();
  const H = await import("@/lib/billing/household-plan");
  const D = "00000000-0000-0000-0000-0000000b1e00", PERSON_D = "61000000-0000-4000-8000-000000000004";
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Koh household')", [D]);
  await db.query("INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Koh Li Hua','self')", [PERSON_D, D]);
  const add = (n: number) => (x: { query: (t: string, p?: unknown[]) => Promise<unknown> }) => x.query(
    `INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,quarantine_status) VALUES($1,$2,$3,$4,$5,$6,'queued','scan_clean')`,
    [pid(500 + n), D, PERSON_D, `d-${n}.pdf`, `kd-${n}`, `hd-${n}`]).then(() => undefined);
  for (let n = 0; n < 4; n++) await add(n)({ query: (t, p) => db.query(t, p as unknown[]) });
  process.env.DEARPOLICY_PLAN_LIMITS = "on";
  try {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => H.insertWithinDocumentLimit(D, {}, add(10 + i))));
    assert.equal(results.filter((r) => r.allowed).length, 1, "4 of 5: exactly one of eight gets the last place");
    assert.equal(await H.keptDocumentCount(D), 5);
    await assert.rejects(H.insertWithinDocumentLimit(D, { replacingPolicyId: pid(500) }, async () => { throw Object.assign(new Error("dup"), { code: "23505" }); }), /dup/, "an insert failure is passed on, and rolled back");
    assert.equal(await H.keptDocumentCount(D), 5);
  } finally {
    delete process.env.DEARPOLICY_PLAN_LIMITS;
  }
  assert.equal((await H.insertWithinDocumentLimit(D, {}, add(30))).allowed, true, "limits off: recorded as before");
});

test("a household can't give itself a plan: no browser privilege on household_plans", async () => {
  const db = await database();
  await db.exec("SET ROLE authenticated");
  try {
    await assert.rejects(db.query("INSERT INTO household_plans(account_id,plan,status) VALUES($1,'family','complimentary')", [A]), /permission denied/);
    await assert.rejects(db.query("SELECT * FROM household_plans"), /permission denied/);
    await assert.rejects(db.query("UPDATE household_question_counts SET questions=0"), /permission denied/, "nor reset its own question count");
  } finally {
    await db.exec("RESET ROLE");
  }
});

test("savePlan: newer events win, complimentary plans stay, unknown households are skipped", async () => {
  const db = await database();
  const { savePlan } = await import("@/lib/billing/stripe");
  const base = { householdId: A, plan: "plus" as const, status: "active", interval: "month" as const, customerId: "cus_a", subscriptionId: "sub_a", currentPeriodEnd: null };
  await savePlan({ ...base, eventCreated: new Date(2_000_000) });
  await savePlan({ ...base, plan: "family", eventCreated: new Date(1_000_000) }); // older, arrives late
  const row = (await db.query<{ plan: string }>("SELECT plan FROM household_plans WHERE account_id=$1", [A])).rows[0];
  assert.equal(row.plan, "plus", "the late, older event is ignored");
  await savePlan({ ...base, status: "canceled", eventCreated: new Date(3_000_000) });
  assert.equal((await db.query<{ status: string }>("SELECT status FROM household_plans WHERE account_id=$1", [A])).rows[0].status, "canceled");

  await db.query("UPDATE household_plans SET plan='family',status='complimentary' WHERE account_id=$1", [B]);
  await savePlan({ ...base, householdId: B, customerId: "cus_b", status: "canceled", eventCreated: new Date(9_000_000) });
  assert.equal((await db.query<{ status: string }>("SELECT status FROM household_plans WHERE account_id=$1", [B])).rows[0].status, "complimentary");

  await savePlan({ ...base, householdId: "00000000-0000-0000-0000-0000000b1c00", customerId: "cus_c", eventCreated: new Date(1) });
  assert.equal((await db.query("SELECT 1 FROM household_plans WHERE account_id='00000000-0000-0000-0000-0000000b1c00'")).rows.length, 0);
});

test("checkout: one Stripe customer per household, no second subscription, only the newest checkout page open", async () => {
  const db = await database();
  const { billingConfig, ensureStripeCustomer, hasLiveSubscription, expireOpenCheckouts } = await import("@/lib/billing/stripe");
  const config = billingConfig({ ...STRIPE_ENV } as unknown as NodeJS.ProcessEnv)!;
  const C = "00000000-0000-0000-0000-0000000b1d00";
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Ong household')", [C]);
  const calls: string[] = [];
  let made = 0;
  const fake = (async (url: string, init: RequestInit) => {
    calls.push(String(init.method) + " " + url + " " + ((init.headers as Record<string, string>)["idempotency-key"] ?? ""));
    if (url.endsWith("/customers")) return new Response(JSON.stringify({ id: "cus_new" + (++made) }));
    if (url.includes("/subscriptions?")) return new Response(JSON.stringify({ data: [{ status: "canceled" }, { status: url.includes("cus_live") ? "incomplete" : "canceled" }] }));
    if (url.includes("/checkout/sessions?")) return new Response(JSON.stringify({ data: [{ id: "cs_1" }, { id: "cs_2" }] }));
    if (url.endsWith("/expire")) return new Response("{}");
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  const first = await ensureStripeCustomer(config, C, "owner@example.com", fake);
  assert.equal(first, "cus_new1");
  assert.match(calls[0], new RegExp("POST https://api.stripe.com/v1/customers dearpolicy-customer-" + C));
  assert.equal(await ensureStripeCustomer(config, C, "owner@example.com", fake), "cus_new1", "stored first, reused after");
  assert.equal(made, 1);
  const row = (await db.query<{ plan: string; status: string }>("SELECT plan,status FROM household_plans WHERE account_id=$1", [C])).rows[0];
  assert.deepEqual([row.plan, row.status], ["free", "customer"], "a customer alone is still Free");
  const H = await import("@/lib/billing/household-plan");
  assert.equal((await H.readHouseholdPlan(C)).planId, "free");
  assert.equal(await hasLiveSubscription(config, "cus_new1", fake), false);
  assert.equal(await hasLiveSubscription(config, "cus_live", fake), true, "a payment being confirmed counts");
  assert.equal(await expireOpenCheckouts(config, "cus_new1", fake), 2);
  assert.ok(calls.some((c) => c.startsWith("POST https://api.stripe.com/v1/checkout/sessions/cs_2/expire")));
  const route = readFileSync("app/api/billing/checkout/route.ts", "utf8");
  const order = ["ensureStripeCustomer(", "hasLiveSubscription(", "expireOpenCheckouts(", "createCheckoutSession("].map((x) => route.indexOf(x));
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), "customer, then the live check, then close old pages, then the new page");
});

test("routes: the chat refuses the 11th Free question before anything is sent; the webhook is off without billing", async () => {
  const db = await database();
  await db.query("DELETE FROM household_plans WHERE account_id=$1", [A]);
  const source = readFileSync("app/api/chat/route.ts", "utf8");
  const limitAt = source.indexOf("takeQuestion(accountId)"), sendAt = source.indexOf("enqueueChat(args)");
  assert.ok(limitAt > 0 && limitAt < sendAt, "checked before the question is queued");
  assert.match(source, /code:plan\.code,upgradePath:"\/usage"\},\{status:429\}/);
  const accept = readFileSync("app/api/policies/upload/accept.ts", "utf8");
  assert.ok(accept.indexOf("mayAddDocument(") < accept.indexOf("INSERT INTO policies"), "checked before the document is recorded");
  assert.ok(accept.indexOf("insertWithinDocumentLimit(") > 0 && accept.indexOf("insertWithinDocumentLimit(") < accept.indexOf("INSERT INTO policies"), "and checked again with the insert, under the lock");
  assert.ok(accept.indexOf("mayAddDocument(") < accept.indexOf("savePolicyFile("), "and before it is stored");
  assert.match(readFileSync("app/api/policies/upload/start/route.ts", "utf8"), /mayAddDocument\(ctx\.householdId/);
  const reprocess = readFileSync("app/api/policies/reprocess/route.ts", "utf8");
  assert.ok(reprocess.indexOf("rereadingPolicyId: body.policyId") > 0 && reprocess.indexOf("rereadingPolicyId") < reprocess.indexOf("enqueuePolicyProcessing({"), "Read again checks the plan before queueing");

  for (const key of Object.keys(STRIPE_ENV)) delete process.env[key];
  const { POST } = await import("../../app/api/billing/webhook/route");
  const res = await POST(new NextRequest("http://localhost/api/billing/webhook", { method: "POST", body: "{}" }));
  assert.equal(res.status, 404, "billing off: the webhook isn't there");

  Object.assign(process.env, STRIPE_ENV);
  try {
    const body = JSON.stringify({ id: "evt", type: "invoice.paid", created: Math.floor(Date.now() / 1000), data: { object: {} } });
    const unsigned = await POST(new NextRequest("http://localhost/api/billing/webhook", { method: "POST", body }));
    assert.equal(unsigned.status, 400, "no signature, nothing recorded");
    const signed = await POST(new NextRequest("http://localhost/api/billing/webhook", { method: "POST", body, headers: { "stripe-signature": sign(body, "whsec_fake", Math.floor(Date.now() / 1000)) } }));
    assert.equal(signed.status, 200);
  } finally {
    for (const key of Object.keys(STRIPE_ENV)) delete process.env[key];
  }
});

test("middleware: only the webhook path skips the session and Origin checks", async () => {
  const { middleware } = await import("../../middleware");
  const at = (p: string) => new NextRequest("http://localhost" + p, { method: "POST", body: "{}" });
  const hook = await middleware(at("/api/billing/webhook"));
  assert.notEqual(hook.status, 401);
  assert.notEqual(hook.status, 403);
  for (const p of ["/api/billing/checkout", "/api/billing/portal", "/api/billing/webhook-evil"]) {
    const r = await middleware(at(p));
    assert.ok(r.status === 401 || r.status === 403, p + " needs a session and a same-site Origin");
  }
});

test("landing page: pricing before sign-up, every card starts free; Plan usage upgrades through the owner only", () => {
  const landing = readFileSync("app/welcome/page.tsx", "utf8");
  assert.match(landing, /<PricingSection \/>/);
  const pricing = readFileSync("components/public/pricing-section.tsx", "utf8");
  assert.match(pricing, /href="\/signup"/);
  assert.match(pricing, /Start free/);
  assert.ok(!/fetch\(|@\/lib\/db|@\/lib\/auth/.test(pricing + readFileSync("components/plan-cards.tsx", "utf8")), "static: no session, household or service");
  const usage = readFileSync("app/usage/page.tsx", "utf8");
  assert.match(usage, /!sub\.isOwner\)return <small>The household&rsquo;s owner can upgrade/);
  assert.match(usage, /!sub\.billingEnabled\)return <small>Upgrades open soon/);
  for (const r of ["checkout", "portal"]) assert.match(readFileSync(`app/api/billing/${r}/route.ts`, "utf8"), /requireHouseholdOwner\(ctx\.userId, ctx\.householdId\)/);
});

test("plan badge and upgrade prompts: owner on Free with payments on only; every number from the plans table (DC, 19 Nov)", async () => {
  const { planStatus, mayPromptUpgrade, upgradeLine, questionsNearLimit } = await import("@/lib/plans/prompt");
  // Who may be asked to upgrade.
  for (const [planId, isOwner, billingEnabled, want] of [
    ["free", true, true, true], ["free", false, true, false], ["free", true, false, false],
    ["plus", true, true, false], ["family", true, true, false], ["plus", false, false, false],
  ] as const) assert.equal(mayPromptUpgrade({ planId, isOwner, billingEnabled }), want, `${planId} owner=${isOwner} billing=${billingEnabled}`);
  // The badge names the plan for everyone; counts go out only when a prompt may show.
  assert.deepEqual(planStatus({ planId: "plus", isOwner: false, billingEnabled: true, documentsKept: 3, questionsThisMonth: 9 }), { plan: "plus", name: "Plus", upgrade: false, owner: false });
  assert.deepEqual(planStatus({ planId: "free", isOwner: false, billingEnabled: true, documentsKept: 3 }), { plan: "free", name: "Free", upgrade: false, owner: false });
  const owner = planStatus({ planId: "free", isOwner: true, billingEnabled: true, documentsKept: 3, questionsThisMonth: 7 });
  assert.deepEqual(owner, { plan: "free", name: "Free", upgrade: true, owner: true, documentsKept: 3, questionsThisMonth: 7 });
  // The words.
  assert.deepEqual(upgradeLine("home", owner), { lead: "Upgrade to Family.", detail: "Unlimited documents and 150 questions a month.", plan: "family" });
  assert.deepEqual(upgradeLine("documents", owner), { lead: "3 of 5 documents on Free.", detail: "Plus keeps 20.", plan: "plus" });
  assert.equal(upgradeLine("documents", { ...owner, documentsKept: 9 })?.lead, "5 of 5 documents on Free.", "never more than the plan holds");
  assert.equal(upgradeLine("documents", { ...owner, documentsKept: undefined }), null, "no count, no line");
  assert.equal(upgradeLine("documents", { ...owner, documentsKept: 0 }), null, "not on a new household's empty page (TE F2)");
  assert.equal(planStatus({ planId: "plus", isOwner: true, billingEnabled: true }).owner, true, "a paid owner keeps the refusal's link (TE F1)");
  // Ask: only from 8 of 10 questions.
  assert.equal(questionsNearLimit(owner), false);
  assert.equal(upgradeLine("ask", owner), null);
  assert.deepEqual(upgradeLine("ask", { ...owner, questionsThisMonth: 8 }), { lead: "8 of 10 questions used this month.", detail: "Plus gives 60.", plan: "plus" });
  // Nobody else sees any line.
  for (const status of [null, planStatus({ planId: "free", isOwner: false, billingEnabled: true }), planStatus({ planId: "family", isOwner: true, billingEnabled: true }), planStatus({ planId: "free", isOwner: true, billingEnabled: false, documentsKept: 5, questionsThisMonth: 10 })])
    for (const place of ["home", "documents", "ask"] as const) assert.equal(upgradeLine(place, status), null, `${place} ${JSON.stringify(status)}`);
});

test("limit refusals: the owner is told to upgrade, a member is told who can", async () => {
  const { limitForMember } = await import("@/lib/plans/catalogue");
  const { limitForCaller } = await import("@/lib/billing/limit-for-caller");
  const doc = checkDocumentLimit("free", 5), q = checkQuestionLimit("free", 10, new Date("2026-11-19T00:00:00Z"));
  for (const check of [doc, q]) {
    assert.equal(check.allowed, false);
    const member = limitForMember(check);
    if (member.allowed || check.allowed) throw new Error("expected a refusal");
    assert.doesNotMatch(member.message, /(^|\. )Upgrade to/);
    assert.match(member.message, /The household’s owner can upgrade to Plus for/);
    assert.equal(member.code, check.code);
  }
  assert.deepEqual(limitForMember({ allowed: true }), { allowed: true });
  const ctx = { userId: "u", householdId: "h" };
  const owner = async () => {}, notOwner = async () => { throw new Error("not owner"); };
  assert.deepEqual(await limitForCaller(doc, ctx, owner), doc);
  assert.deepEqual(await limitForCaller(doc, ctx, notOwner), limitForMember(doc));
  let asked = 0;
  assert.deepEqual(await limitForCaller({ allowed: true }, ctx, async () => { asked++; }), { allowed: true });
  assert.equal(asked, 0, "no owner check unless something was refused");
  for (const route of ["app/api/chat/route.ts", "app/api/policies/upload/start/route.ts", "app/api/policies/upload/accept.ts", "app/api/policies/reprocess/route.ts"])
    assert.match(readFileSync(route, "utf8"), /limitForCaller\(/, `${route} words the refusal for the caller`);
});

test("plan route and pages: the badge on household pages, prompts only through components/plan-status.tsx", () => {
  const route = readFileSync("app/api/plan/route.ts", "utf8");
  assert.match(route, /ROUTE_AUTH = "household-member"/);
  assert.match(route, /requireHouseholdContext\(request\)/);
  assert.match(route, /requireHouseholdOwner\(ctx\.userId, ctx\.householdId\)/);
  assert.ok(route.indexOf("mayPromptUpgrade(input)") < route.indexOf("keptDocumentCount("), "counts read only when a prompt may show");
  assert.match(route, /\.catch\(\(\) => null\)/, "a count that fails hides prompts, not the badge (TE F3)");
  assert.match(readFileSync("components/plan-status.tsx", "utf8"), /if \(status && !status\.owner\) return null;/, "refusal link for the owner on any plan");
  const shell = readFileSync("components/AppShell.tsx", "utf8");
  assert.equal((shell.match(/<PlanBadge \/>/g) ?? []).length, 2, "beside the switch on computers and phones");
  assert.match(shell, /<PlanProvider enabled=\{householdPage\}>/);
  assert.match(readFileSync("app/page.tsx", "utf8"), /<UpgradePrompt place="home"\/>/);
  assert.match(readFileSync("app/policies/page.tsx", "utf8"), /<UpgradePrompt place="documents"\/>/);
  assert.match(readFileSync("app/chat/page.tsx", "utf8"), /<UpgradePrompt place="ask"\/>/);
  assert.doesNotMatch(readFileSync("app/chat/page.tsx", "utf8"), /href="\/usage">See plans/, "the limit message's link shows to the owner only");
});
