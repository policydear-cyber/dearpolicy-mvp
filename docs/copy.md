# DearPolicy copy guide

How every word on DearPolicy should read. Use it with `docs/brand.md` (colour, type and the voice summary).
This guide is the detail behind that voice: the words we use, the words we don't, and patterns for the
messages people see most.

## Who we are writing for

A household that is new to DearPolicy and probably new to insurance terms. They have a stack of documents
from one or more insurers, in any country and currency. They may be worried, because something has just
happened. They read on a phone, quickly. They have never seen our code, our database or our test reports.

Write so that person understands each line the first time, and knows what to do next.

## Six rules

1. **Say what it is, then what to do.** "This document couldn't be read. Upload a clearer copy, or try
   again." Not "Processing failed."
2. **Use the household's words, not ours.** "Read", not "analyse", "process", "extract" or "index".
   "Your documents", not "evidence", "artifacts" or "rows".
3. **Full sentences, short ones.** One idea per sentence. No arrow chains, no slashes between options, no
   "--" or em dash pile-ups.
4. **Be honest about limits in the same breath.** If something wasn't read, name it. Never let a label
   suggest more certainty than the product has.
5. **Never promise money.** DearPolicy explains what the documents say. The insurer decides what is paid.
   Use "the policy says up to", "you may be able to claim", "the insurer decides". Never "you will get",
   "guaranteed", "approved".
6. **Never call it advice.** DearPolicy is not a financial adviser and does not recommend buying, keeping,
   switching or cancelling a policy.

## Words we use

| Use | For | Not |
|---|---|---|
| **family member** (or a person's name) | someone the policies cover | profile, insured, member (for covered people), subject |
| **household** | the shared account a family signs in to | tenant, workspace, org |
| **account** | a person's own sign-in | user, login |
| **document** | anything uploaded | file (fine for the upload control itself), artifact, record, evidence |
| **policy** | the insurance contract | contract (in UI), product (except where the insurer's product name is meant) |
| **cover** | what a policy protects against | coverage item, row, tile |
| **benefit** | something a policy pays for, with its amount and conditions | line item, row |
| **amount** | money printed in a document | figure (except "check this figure"), operand, value |
| **read** / **reading** | what DearPolicy does to a document | analyse, process, extract, scan, ingest, index |
| **safety check** | the malware check on uploads | scan, VirusTotal (in UI) |
| **page** | where an answer comes from | source passage, chunk, citation (in UI) |
| **Home** | the signed-in overview | portfolio, dashboard |
| **Ask DearPolicy** | the chat | assistant, bot, AI, analysis |
| **estimate** | a worked-out amount for a claim | indicative, illustration (except the Learn calculators) |
| **the insurer decides** | who makes a claim decision | approve, settle, guarantee |
| **for example** | an example | e.g., eg |
| **couldn't** / **can't** | a plain, kind negative | unable to, failed to |

Insurance terms (deductible, co-insurance, rider, sum insured, waiting period, exclusion) are fine when the
document uses them. Link or explain them through the Learn library rather than replacing them, because the
household needs to recognise them in their own papers.

## Words we never use in the product

- Internal or engineering words: token, payload, endpoint, service, response, row, tile, chunk, pipeline,
  extraction, OCR, model, deterministic, ISO currency, verified (as a status), source-verified, composition,
  inventory, applicable, assessment (outside the reviewer area).
- Names of our suppliers, except on the privacy notice.
- Hype or fear: amazing, instantly, effortless, never miss a claim, underinsured, don't risk it.
- Accuracy claims: 99%, always right, never wrong, guaranteed.
- "Contact support" until a support contact exists. Say what the person can do instead.

## Patterns

### Errors

Say what didn't happen, that nothing is lost (when true), and the next step.

- Good: "Your question didn't send. It's still in the box below, so you can send it again."
- Good: "We couldn't load your documents. Your documents are safe. Refresh the page in a moment."
- Avoid: "Chat failed", "Database error", "Unknown error (500)".

Never show raw server messages, codes or field names (familyMemberId, claimSessionId) to a household.

### Empty states

Say why it's empty, then the one action that fills it.

- Good: "No documents yet. Upload a policy schedule, certificate or renewal notice, and DearPolicy reads it
  for you."

### Waiting and reading

Say what is happening, roughly how long it takes, and that the person can carry on.

- Good: "Reading your document. This usually takes under a minute. You can keep using DearPolicy."

### Unread or partly read documents

Name the document and the pages. Say what it means for answers. Offer Read again or a clearer copy. Never
imply that something not found means not covered.

- Good: "Page 3 of Travel Certificate couldn't be read, so cover printed on that page isn't shown here."
- Good: "Not found in the documents you uploaded. A policy you haven't uploaded may still cover this."

### Amounts

- Show the amount exactly as the document prints it, with its currency, and its conditions next to it.
- A bare "$" doesn't tell us the currency. Say "the document doesn't say which currency".
- Label worked-out amounts as estimates and say the insurer decides.
- Never drop a condition to make a sentence shorter.

### Buttons and links

Start with a verb and say what happens: "Upload a document", "Read again", "Add a family member". Avoid
"Submit", "OK", "Click here". Links that move pages end with " →" only when they leave the current task.

### Confirmations before deleting

Say exactly what goes and whether it can be undone: "Delete this document? Everything DearPolicy read from
it is removed too. This can't be undone."

## What this guide does not cover

Benefit statements, conditions and citations that the server builds from a household's documents carry
accuracy rules of their own (see `docs/verification-paths.md` and the reliability skill). Don't reword them
for style. If one reads unclearly, raise it as an issue with an example rather than editing it.

The privacy notice and terms are the owner's legal wording; suggest changes rather than editing them.

## Checklist for any new screen

- Would a household new to insurance understand every word?
- Does each message say what to do next?
- Are we honest about anything not read, not confirmed or not known?
- Does anything promise payment, imply advice, or claim accuracy?
- Is every amount shown with its currency and conditions?
- Are the words from the table above, and none from the never list?
