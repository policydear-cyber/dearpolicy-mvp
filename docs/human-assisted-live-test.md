# Human-assisted live synthetic test (production prototype)

**Status:** not yet executed. The fully automated live test was paused because no
approved execution environment can use the Vercel-held `SUPABASE_SERVICE_ROLE_KEY`
without duplicating or exposing it. This procedure replaces it: **a person signs in
to every synthetic account themselves**, passwords never leave that person's
password manager, and the operator actions that need elevated access are done in
the Supabase dashboard by the project owner.

Nothing here is a production-readiness claim. It is one controlled check of the
deployed prototype with synthetic data. Operational telemetry remains intentionally
disabled, so this run relies on what can be observed in the browser, in HTTP
responses and in count-only database queries.

## Ground rules

- **Synthetic data only.** Every email, household, person and file carries the run
  identifier. Never upload a real document or type real personal details.
- **Passwords stay with the person signing in.** Generate each password in a password
  manager. Never paste one into chat, a ticket, a spreadsheet, a screenshot or the
  cleanup manifest. The assistant never asks for them and never needs them.
- **The six existing insurance-policy records are out of scope.** No step reads,
  opens, edits or deletes them. Every SQL query below is either count-only or scoped
  to this run's identifier.
- **No new migrations, no Auth configuration changes, no Vercel variable changes.**
- **Pause points** (marked ⏸) are where one role hands over to the next. Anyone may
  stop at any pause; the cleanup section can be run from any point.
- **Stop immediately** and go to cleanup if: an upload is processed before its
  malware scan is clean; a positive amount appears for anything not yet reviewed;
  amounts in different currencies are added together; a currency is shown that the
  certificate does not print; one household can see or change another's data; the
  reviewer can open anything not assigned to them; or any page shows raw errors,
  stack traces, provider responses, tokens or storage paths.

## Roles

| Role | Who | Needs |
|---|---|---|
| Operator | Project owner (DC) | Supabase dashboard access for the Dear Policy project |
| Owner A | Any tester (can be the operator in a separate private browser window) | A password manager; for the sign-up variant, an inbox they control |
| Owner B | Any tester, separate private window | A password manager |
| Reviewer | Any tester, separate private window | A password manager |
| Observer (optional) | The assistant, through the Supabase connector | Runs only the count-only / run-scoped SQL below, on request |

Use a **separate private/incognito window per role** so sessions never mix.

## 0. Before starting (operator)

1. Confirm the deployment you are testing is the current `main` and that it contains
   the reviewer sign-in change ("a reviewer-only account gets no household"). If it
   does not, the reviewer sign-in in step 4 would create a household for the
   reviewer; stop and deploy first.
2. Choose the run identifier: `dp-synthetic-YYYYMMDD-HHMM-<6 random hex>`, for
   example `dp-synthetic-20261001-0930-4f2a9c`. Write it at the top of the cleanup
   manifest (template below). Use lower case throughout.
3. In the Supabase SQL editor run `sql/live-assist/01-baseline.sql` (count-only).
   Save the single JSON row it returns in the manifest as the baseline. Check that
   `background_jobs_open` is 0; if not, wait until it is.

**Cleanup manifest template** (identifiers only - no passwords, cookies, tokens,
links or document contents):

```
run identifier:
started (UTC):
baseline JSON:
owner A user id:            owner A household id:
owner B user id:            owner B household id:
reviewer user id:
claim id:                   assignment id:
finished (UTC):             residue JSON:
```

## 1. Create the synthetic accounts (operator) ⏸

In the Supabase dashboard: **Authentication → Users → Add user → Create new user**.
Tick **Auto Confirm User**. Create:

- `<run id>-owner-b@example.com`
- `<run id>-reviewer@example.com`

and, unless you use the sign-up variant below, also `<run id>-owner-a@example.com`.

The person who will sign in to each account types its password in themselves (the
operator can create the user and then use "Send password recovery", or the tester can
sit at the dashboard for that one field). Copy each **user id** (not the password)
into the manifest, and check each email contains the run identifier exactly.

**Sign-up variant (tests real email confirmation):** instead of creating owner A in
the dashboard, owner A signs up on `/signup` with `yourname+<run id>@<your domain>`
(an inbox they control) and a household name of `<run id> Household A`, then clicks
the confirmation link in that inbox. Expected: "Check your email for a confirmation
link…", no sign-in possible before the link is clicked, and the link lands signed in.

## 2. Owner A: household, people and documents ⏸

In owner A's private window:

1. Sign in at `/login`. Expected: lands on the portfolio; **Household** shows one
   household (owner role) whose name contains the run identifier.
2. **Sign out** (sidebar or top bar), then open `/family`. Expected: sent to
   `/login?next=/family`. Sign in again; you return to Family.
3. **Family:** add `Synthetic Patient <last 6 of run id>` as *self* and
   `Synthetic Child <last 6>` as *child*. Edit the child's preferred name and Save;
   expect "Saved".
4. **Documents:** upload the synthetic pack from `scripts/live-assist/` (see
   "Synthetic document pack") - the three certificates and the wording for the
   patient. For each, note the time of upload and the time the card shows **Ready**.
   Expected on every card before Ready: *Waiting for malware scan* / *On hold* - never
   Ready first. If a card shows *Rejected by malware scan* for a synthetic file, stop.
5. Link the wording to the patient if DearPolicy did not.
6. Observer check (optional): `sql/live-assist/02-run-progress.sql` with the run
   identifier - counts only.

## 3. Owner A: questions and a claim ⏸

1. **Ask DearPolicy:** "Synthetic Patient <last 6>: what is the waiting period for
   critical illness on the Living Care plan?" Expected: *90 days*, a citation to the
   wording page, **no money amount**.
2. New chat: "Synthetic Patient <last 6> was diagnosed with Malignant neoplasm of the
   colon on 2026-06-01. How much can we claim?" Expected: fact-finding (information /
   evidence / reviewer assessment needed), **no amount, no total**.
3. Open **Claims**, open that claim. Expected: the estimate panel says there is no
   estimate yet. Upload the synthetic specialist memo as *Specialist memo*. Expected:
   it moves through scanning to *awaiting review*; still no estimate.
4. Copy the claim's URL into the manifest as the claim id.

## 4. Operator: provision and assign the reviewer ⏸

In the Supabase SQL editor, open `sql/live-assist/03-provision-and-assign-reviewer.sql`,
fill in the four values at the top (run id, reviewer user id, owner A household id,
claim id) and run it. It refuses unless every value belongs to this run, the reviewer
is not a member of owner A's household, and the claim belongs to owner A's household.
It writes the same rows and audit entries as the reviewer operator CLI
(`npm run reviewer:admin -- provision` / `assign`) and returns the assignment id and
its expiry (2 hours). Copy the assignment id into the manifest.

## 5. Reviewer: decisions ⏸

In the reviewer's private window:

1. Sign in at `/login`. Expected: lands on **Assigned reviews** (`/reviewer`), not a
   household. The reviewer never gets a household (operator can confirm with
   `02-run-progress.sql`: `reviewer_household_memberships` = 0).
2. Try `/policies`, `/family` and the claim URL from step 3. Expected: no household
   data is shown.
3. Open the assignment. For the memo, record in this order, each with a short reason,
   and after each one ask owner A to reload the claim:
   - Living Care **SGD** certificate → *Does not match* → owner A: **no estimate**.
   - Living Care **USD** certificate → *Needs further review or evidence* → owner A:
     **no estimate**.
   - SGD → *Matches*; USD → *Matches*; the certificate **without a currency** →
     *Matches*.
4. Owner A reloads. Expected: an indicative estimate with the notice text; the SGD
   and USD amounts shown **separately with separate totals**, each citing the wording
   page; the no-currency cover shown as **no amount** (never 0, never converted); no
   combined total.

## 6. Owner B: isolation ⏸

In owner B's private window, sign in. Owner B has their own empty household.
Paste into the address bar, one at a time, owner A's claim URL and `/reviewer`.
Expected: "not found" / "only for assigned reviewers"; nothing of owner A's appears
anywhere. Owner B signs out.

## 7. Owner A: export and deletions ⏸

1. Sign out and sign in again (export and household deletion require a recent
   sign-in). **Household → Prepare my download**; download it; confirm it contains
   owner A's synthetic people and nothing of owner B. Delete the downloaded file from
   the computer afterwards.
2. On the claim, **Delete document** → **Confirm delete** on the memo. Expected: "…was
   deleted", and the estimate returns to no estimate.
3. **Documents:** delete the SGD certificate (Delete → Confirm delete). Reopen the
   saved waiting-period answer in Ask DearPolicy: expected to say it is out of date,
   with no citation.
4. **Family:** delete the child (Delete → Confirm delete).
5. **Household:** type the household's exact name and **Permanently delete
   household**. Then sign out. Owner B does the same for their household.

## 8. Cleanup (operator) - always run, from any point

1. SQL editor: `sql/live-assist/04-remove-reviewer.sql` (fill in run id and reviewer
   user id). Removes the reviewer's assignments and provisioning; the reviewer audit
   log is append-only by design and keeps its identifier-only rows.
2. If a household was not deleted in step 7 (for example after a stop), sign in as
   that owner and delete it from the Household page. Do not delete households with
   SQL.
3. **Authentication → Users:** for each of the three users, check the email contains
   the exact run identifier, then **Delete user**. Refuse any user whose email does not.
   (Equivalent Admin API call from a trusted server holding the service key:
   `supabase.auth.admin.deleteUser(userId)`.) Deleting a user ends their sessions.
4. **Storage:** in `policy-files` and `claim-evidence-files`, look for folders named
   after owner A's or owner B's household id. **Expect to find them:** deleting a
   document or a household in the app removes its database rows at once but, by design,
   leaves the stored file for the storage-cleanup engine (`npm run storage:cleanup`,
   which needs the service key and a 6-hour grace period and is not scheduled). Delete
   those two household folders in the dashboard, then confirm they are gone.
5. SQL editor: `sql/live-assist/05-residue.sql` with the run identifier and the
   manifest ids. Every value must be 0. Save the JSON row in the manifest. If any is
   not 0, stop and report it; do not delete more by hand.

## What to report

Run identifier; the commit deployed; per step pass/fail with what was seen; upload →
Ready times; the malware-scan outcome shown to the person (clean / on hold / rejected,
no provider details); whether any page ever showed an amount before review, a zero
for a blocked benefit, a combined currency total or another household's data; the
baseline and residue JSON rows. Missing logs are never evidence of success.

## Synthetic document pack

`npm run live-assist:pack -- --patient "Synthetic Patient <last 6>" --out <folder>`
writes five synthetic PDFs (three Living Care certificates - SGD, USD and one that
prints no currency - the wording with the 90-day waiting period and the Major Cancer
definition, and a specialist memo). Every page says SYNTHETIC TEST DOCUMENT and uses
only invented names and numbers. Unlike the automated suite's files they carry no
machine-readable test payload: on the live prototype they are read by the real
reading model, so the extracted values must be checked by eye in steps 2-5.
