# Try DearPolicy yourself: a private trial in your browser

You get your own copy of DearPolicy running in a **GitHub Codespace**. That is a computer GitHub lends you, reachable
only from your GitHub account. You add a made-up family, upload sample insurance PDFs and ask questions. The answers
come from the real AI model.

## What is real and what is not

| Real | Not real / test only |
|---|---|
| The app: the same code, upload page, reading of PDFs (including scanned pages) and chat | The data: a made-up household and made-up policies. Never upload real documents here. |
| The AI model: OpenAI gpt-6-luna, the model production uses | Storage: a database and file folder inside the Codespace. Nothing goes to the production database or the live site. |
| The cost: every answer spends a little from a fixed **trial allowance of US$0.15** for **one Codespace** (see *Budget* below). The allowance is reserved in advance in the project's spend record, so the automated tests cannot use it. The app counts what this Codespace spends, keeps the count across restarts and refuses model calls past the allowance. This is the app's own counter, not a provider hard limit. | | Sign-in: you are automatically signed in as the test household. There is no sign-up page in the trial. |

When the trial budget is used up, the chat answers "the assistant model returned an error" instead of calling the
model. Uploads still work.

## One-time setup: add the test key (about 2 minutes)

1. On GitHub, click your **profile picture** (top right), then **Settings**.
2. In the left menu, under *Code, planning, and automation*, click **Codespaces**.
3. Next to **Codespaces secrets**, click **New secret**.
4. Fill in the form:
   - **Name:** `OPENAI_TEST_API_KEY`
   - **Value:** your **spend-limited OpenAI test key**. This is the same key as the repository's Actions secret. It must never be the production key.
   - **Repository access:** choose `policydear-cyber/dearpolicy-mvp`.
5. Click **Add secret**.

Without this secret the trial still starts, in **preflight**. Uploads and reading of text work, but every AI call is
refused and the chat says the model is unavailable.

## Start the trial

1. Open the repository on GitHub: `policydear-cyber/dearpolicy-mvp`.
2. Click the green **Code** button, then the **Codespaces** tab.
3. Click **…**, then **New with options…**. Choose these options:
   - **Branch:** `claude/conversational-rag-v1-1`
   - **Machine type:** **2-core** (8 GB)

   Then click **Create codespace**. Plain **Create codespace on claude/conversational-rag-v1-1** also works when that branch is selected.
4. **Wait.**
   - The first start takes about **10–15 minutes**: it installs the database and builds the app.
   - Later starts take about **1–2 minutes**.
   - You can follow progress in the **Terminal** panel at the bottom. The last lines say *DearPolicy trial is running* and show the remaining trial budget.
5. A browser tab opens on DearPolicy automatically.
   - If it does not, open the **Ports** tab at the bottom, find **DearPolicy trial (3000)** and click the 🌐 globe icon.
   - The address is private: only you, signed in to GitHub, can open it.

## Try it

1. **Family** page: add the household. Use the exact names and dates of birth below; the sample documents print them.

   | Full name | Relationship | Date of birth |
   |---|---|---|
   | Simon Alastair Hartwell | self | 17 Mar 1984 |
   | Leonie Brigitte Hartwell | spouse | 02 Nov 1986 |
   | Felix Oran Hartwell | child | 21 Jun 2017 |
   | Isla Maren Hartwell | child | 09 Jan 2020 |

2. Download the three sample PDFs. They are made-up documents.
   - [hx-text.pdf](https://github.com/policydear-cyber/dearpolicy-mvp/raw/claude/conversational-rag-v1-1/scripts/ingest-live/fixture/source/hx-text.pdf): the family accident plan.
   - [hx-endorsement.pdf](https://github.com/policydear-cyber/dearpolicy-mvp/raw/claude/conversational-rag-v1-1/scripts/ingest-live/fixture/source/hx-endorsement.pdf): a change to it.
   - [hx-scanned.pdf](https://github.com/policydear-cyber/dearpolicy-mvp/raw/claude/conversational-rag-v1-1/scripts/ingest-live/fixture/source/hx-scanned.pdf): a scanned certificate for Isla.
3. **Policies** page: upload each one.
   - Leave *Profile hint* on "Not sure".
   - Wait until each card says it is ready. That takes about a minute each; the scanned one is read by the AI.
4. **Chat** page: try these questions. Click **New chat** between topics.
   - "What's the policy number on our Meridian Harbour plan, and when does it run out?"
   - "If something happened to Isla in an accident, how much is the accidental death payout for her? Is it the same as mine?"
   - "Felix fell off the monkey bars at school yesterday and broke his wrist. How much can we claim from the Meridian policy?" It should ask whether the fracture was closed or open. Answer it.
   - "I was in hospital after that car accident in March. They admitted me at 9:40pm on 14 March and I was discharged at 8:20am on 18 March. How much hospital cash should Meridian pay me?"
   - "Did that endorsement letter change anything? How much is the daily hospital allowance for the kids now?"
   - "Isla might need to stay in hospital two nights next week. Will her JuniorShield plan pay the $150 a day?"
   - "Oh, by the way, if one of the kids gets dengue, which of our policies would actually pay anything?"
5. You can also delete a document on the Policies page and ask again, to see that its answers are no longer used.

## See the spend
- Open the trial address followed by `/__trial/usage`, for example `https://<your-codespace>-3000.app.github.dev/__trial/usage`.
- It shows the trial budget, the amount spent, what remains and the number of AI calls.
- The same numbers are printed in the Terminal at every start, and kept in the file `.trial/ledger.json`.

## Budget: one Codespace, one fixed allowance
- The trial has **US$0.15** reserved for it in `docs/rag-migration/live/LEDGER.json` (entry `trial-codespace-1`). The automated real-model tests treat that amount as already spent, so they cannot use it.
- The first codespace that starts records its own name in `.trial/ledger.json` and spends only from that allowance. Its spend survives **stop** and **restart**.
- The count lives **inside the codespace**. Deleting the codespace deletes the count, and a second codespace cannot see the first one's count. So:
  - **Use one codespace.** Two codespaces running at the same time would each believe they have the full US$0.15. Nothing outside the codespaces stops that; this is a known limitation of this small trial.
  - **Before deleting it or creating another**, open `/__trial/usage`, then ask Claude (or a developer) to record the *spentUsd* figure in the ledger entry and close it. A new codespace then needs a new allowance (`trial-codespace-2`).
- If `.trial/ledger.json` is damaged or belongs to another codespace or allowance, the trial **refuses to start** instead of resetting the spend to zero. The message says why.

## Stop, restart or delete
- **Stop** when you are done, so it does not use your free hours: GitHub, then **Code**, then **Codespaces**, then **…** next to your codespace, then **Stop codespace**. A stopped codespace keeps your household, uploads and spend.
- **Restart:** click the codespace's name to open it again. The app starts by itself.
- **Delete** only after the spend has been recorded (see *Budget*): **…**, then **Delete**. A new codespace does not start until a new allowance has been reserved.
- **Free quota:** GitHub gives personal accounts 120 core-hours of Codespaces a month. On the 2-core machine that is **60 hours of running time**. Stopped codespaces don't use hours but count toward 15 GB of free storage. GitHub also stops an idle codespace after 30 minutes by default.

## If something goes wrong
- The tab shows an error, or never opens: in the Terminal, run `bash scripts/trial/start.sh`. It restarts the app and prints what it is doing. The app's own log is in `.trial/server.log`.
- "The assistant model returned an error" on every question: open `/__trial/usage`. If the mode is *preflight*, the secret is missing: add it, then stop and start the codespace. If *remaining* is 0, the trial allowance is used up.
- The Terminal says **"[trial] refused: …"**: the start-up checks stopped the trial before it touched anything. The message names the reason (for example a database address that is not local, or a spend record that is damaged or belongs to another codespace). Nothing was set up or spent.
