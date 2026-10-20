# Post-deploy live acceptance script (draft for 21 Oct 2026)

**Status: draft.** It's for DC or a tester to run on the live app after the deploy. Each chat turn is a paid production
model call, so the coordinator must authorise this run (with its run ID and cost) before anyone sends a turn. The account
is **read-only**: don't upload, delete, relink or edit documents or family members, change settings or submit claims.
Don't copy real names, policy numbers or document text into Git; record results as pass or fail plus a short note.
`[Person]` means a family member on the account, and `[Spouse]` and `[Child]` mean others if they exist.

## Before any chat turn (no cost)

1. Portfolio: does it show "Confirmed protection 0" and "Not found" in every category for anyone with a linked certificate? (critical if yes)
2. Coverage and Benefits: do rows appear? If a document can't be read, does the page name it and offer "Try again", with no "still being read" left over?
3. Documents: does each card show a name, a type and who it covers? Is "Who does this document cover?" one line?
4. Phone: are Portfolio, Documents, Ask, Coverage and More all visible in the bottom bar?

## Chat turns (10 at most, in this order, in one new chat unless noted)

| # | Type this | What a pass looks like |
|---|---|---|
| 1 | `does [Person] have dental cover?` | First line answers yes, no or "the documents don't say"; it names the pages checked; no made-up amount. |
| 2 | `[Person] saw the GP for a fever, the bill was $85. can we claim?` | The GP-bill case that failed live. No "I couldn't confirm" with nothing else: it says whether an outpatient or GP benefit is printed, with its amount or limit and page, or plainly that none is found. |
| 3 | `what do i do now?` | One to three concrete steps for *this* GP bill (whom to contact, what to send), not generic text or the same step twice. |
| 4 | `by the way, when does [Person]'s policy renew?` (side question) | It answers the side question from a document, or says it isn't printed, and doesn't lose the GP-bill topic. |
| 5 | `ok back to the GP bill, is there a limit per visit?` | It returns to the GP bill with the right person and no repeated preamble. |
| 6 | *(new chat)* `[Spouse] fell and broke her wrist` | An amount card per document; if documents differ, it says "either/or, the insurer decides" before or between the figures; no invented X-ray requirement. |
| 7 | `sorry, it was [Child], not [Spouse]` (remove a person) | The answer switches to [Child]; the earlier [Spouse] figures are marked as no longer applying. |
| 8 | `no wait, it was [Spouse] after all` (re-add the person) | It switches back to [Spouse] with the same figures as turn 6, and doesn't mix in [Child]. |
| 9 | `what if it happened overseas?` | Any travel cover is shown only if it fits the trip dates and place; otherwise it says it doesn't apply. |
| 10 | *(reload the page and reopen the chat)* `what was the larger amount again?` | The reopened chat is intact, with the right person and the figure from turn 8. |

For every turn, also record:

- the seconds until anything shows, and until the answer is complete (targets: 10 s for a direct question, 20 s for an event);
- whether "Still working…" appears after 12 s;
- whether the first line is the answer;
- whether each amount opens to its page or quote;
- the total length in phone screens.

## Removing and re-adding a person on a *document* (not on the live account)

Unticking and re-ticking someone in "Who does this document cover?" changes real data, so **don't do it on DC's account**.
It passed locally on PR #67 (`pr67-0b56452/FINDINGS.md`). Repeat it only on a separate synthetic test account in
production, if the coordinator sets one up.
