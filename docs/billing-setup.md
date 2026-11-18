# Plans and billing: owner setup

Free, Plus and Family (approved 18 Nov 2026; numbers in `lib/billing/plans.ts`). Every new household starts on Free.
Nothing below is needed for the landing page's prices or the Plan usage page to show. Each step is the owner's to do.

## 1. Create the plans table (needed before limits or payments)

Apply `sql/household-plans.sql` to the production database (Supabase SQL editor). It adds two tables (plans, and
each household's question count for the month) and changes nothing else. Until it is applied every household reads as Free and nothing is refused.

Rollback: `DROP TABLE IF EXISTS household_question_counts; DROP TABLE IF EXISTS household_plans;`

## 2. Keep your own household (and testers) on a full plan

Before switching limits on, give the owner's household a complimentary plan so it is never limited. In the Supabase
SQL editor, with the household's id (Supabase: `household_members` row for your sign-in):

```sql
INSERT INTO household_plans(account_id, plan, status) VALUES ('<household id>', 'family', 'complimentary')
ON CONFLICT (account_id) DO UPDATE SET plan = excluded.plan, status = excluded.status, updated_at = now();
```

A complimentary plan is never changed by a payment event.

## 3. Switch the limits on

Check first that step 1 is applied and step 2's row exists:
`SELECT plan, status FROM household_plans WHERE account_id = '<household id>';` must show `family | complimentary`.
If the table is missing while limits are on, uploads and questions are paused for every household with "couldn't check
your plan" (never silently dropped to Free), so do step 1 before this step.

In Vercel, Production environment variables: `DEARPOLICY_PLAN_LIMITS=on`, then redeploy.
From then on a household on Free keeps 5 documents and asks 10 questions a month; Plus 20 and 60; Family up to 100
(sold as unlimited, fair use) and 150. Questions start again on the 1st of each month (UTC).
Switch off: remove the variable (or set `off`) and redeploy.

## 4. Take payments (Stripe)

1. Create a Stripe account for the business (Singapore, SGD). Stripe asks for business and bank details.
2. In Stripe, create two products with two prices each, in SGD, recurring:
   - Plus: S$7.90 monthly, S$79 yearly.
   - Family: S$14.90 monthly, S$149 yearly.
3. Turn on the Customer portal (Stripe Settings, Billing, Customer portal): allow cancelling, updating the card, and
   switching between the four prices.
4. Add a webhook endpoint: `https://<your domain>/api/billing/webhook`, events `checkout.session.completed`,
   `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
5. In Vercel, Production environment variables (never paste them anywhere else):
   - `STRIPE_SECRET_KEY` (a restricted or secret key)
   - `STRIPE_WEBHOOK_SECRET` (the endpoint's signing secret, `whsec_...`)
   - `STRIPE_PRICE_PLUS_MONTHLY`, `STRIPE_PRICE_PLUS_YEARLY`, `STRIPE_PRICE_FAMILY_MONTHLY`, `STRIPE_PRICE_FAMILY_YEARLY` (the `price_...` ids)
   - `DEARPOLICY_BILLING=on`
   then redeploy. Billing stays off unless every one of these is set.
6. Test first with Stripe's test mode keys and test card, then swap to live keys.

Before taking real payments: publish the privacy notice and terms of use, and get a lawyer's view (marketing plan,
section 4).

## What households see

- Landing page: a Pricing section with the three plans and one "Start free" button each.
- Plan usage (Account settings): their plan, documents kept, questions this month, and the plans. The owner sees
  "Upgrade" (Stripe's checkout page) and, once paid, "Manage subscription" (Stripe's portal). Members see the plan
  but can't change it. While billing is off, the cards say "Upgrades open soon."
- At a limit: the upload or question is refused with a plain message, the date questions start again, and the next plan.
