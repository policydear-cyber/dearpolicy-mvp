# Person correction: whose event, whose question, whose calculation

Written 20 Oct 2026 for the PR #57 review of fx-live-2 K4b. It states the intended semantics, the verdict on the exact wording that was questioned, the two state defects the review found and fixed, and what is tested. The tests are group G (and D7, D8) of `scripts/reliable-chat-fx-repairs-test.ts` (scripted model, no spend).

## The question

In fx-live-2 K4b the household said "grace fell down and broke her arm", then "Actually it was Daniel who broke his arm, not Grace." The model noted for Daniel both `injury` ("broke his arm") and `how_it_happened` ("fell down"). The user's correction says nothing about how Daniel's arm broke. Was carrying "fell down" from Grace to Daniel valid?

## The verdict on that wording

**It was a valid event reassignment, not a defect.** "It was Daniel who broke his arm, not Grace" corrects *who experienced the same event* (the arm break the household had just described, after a fall). It does not describe a second, separate event. The household's description of the event (it followed a fall) belongs to the event, so it goes with the event to the person now meant. The same holds for "I meant Daniel, not Grace" said straight after "Grace fell down".

The answer to the opposite wording is the opposite: "Daniel broke his arm too." starts **a different person's scenario**. Nothing the household said about Grace's event is a report about Daniel, and nothing is carried.

## Intended semantics

| situation | what happens |
|---|---|
| The message **corrects who the event happened to** (the existing correction patterns: "actually it was X", "I meant X", "not Y" and so on) | The event is **reassigned**: what the household reported about it (their own reports, not what a document or a calculation produced) moves to the person now meant and is recorded as `carriedFrom` the first person. The person's own words about themselves win ("broke his arm"; Grace's "broke her arm" is not kept for him). It is **taken off** the person corrected away from, because the household said it did not happen to them. |
| Their calculations | Withdrawn for the reason "the claim is about X, not Y" (cause `person`) and **not** carried: the figures are recalculated from Daniel's own documents, with his own row and sum insured. Facts a document printed stay with their person. |
| An open question about the first person | Withdrawn. If the same requirement still matters for the new person, the model asks it again **for that person**; the saved question names him and not Grace. |
| The user's next "yes" | Answers the open question of whoever it is open for (Daniel), and only theirs. |
| Notice | Exactly one: "Updated: this is about Daniel, not Grace." |
| A later scenario of the first person (a different event) | Starts from nothing: only what the household says about it. The reassigned event is no longer on her claim, so it cannot mix with the new one. |
| A message that starts **another person's scenario** ("Daniel broke his arm too.", "Separately, ...") | Not a correction. Facts held for another person as *their* report are **not** accepted for this person unless this message says them, this person's claim already holds them, or an earlier message that says them also names this person (or is first person and this person is the speaker). The refusal reaches the model with the reason, so it can ask rather than guess. |
| Nothing is erased indiscriminately | A fact is moved only from the person corrected away from, only when it is the household's report, and only by a correction. Other people's claims are untouched. |

The patterns that detect a correction are the existing ones (`PERSON_CORRECTION` in `lib/rag2/loop/loop.ts`); they are not widened.

## The two state defects found, both fixed

1. **Stale event on the person corrected away from.** After the correction Grace's parked claim still held "broke her arm" and "fell down". A later Grace scenario then mixed with them (a stray `injury_detail`), and a model's note for Grace in the same turn (written before it noticed the correction) put the withdrawn event back. Fix: `moveClaimTo` moves the household's reports instead of copying them, and a note for the person just corrected away from is refused when the words are held by the person the event was reassigned to.
2. **Unsupported carry in a different person's scenario.** `note_facts` accepted a model's copy of Grace's "fell down" for Daniel in a message that was not a correction ("Daniel broke his arm too."). Fix: the guard in the table above.

## What changes for the model (disclosed)

This changes **tool behaviour**, not model inputs or prompts. In two narrow situations `note_facts` now refuses a fact and returns the reason to the model (the model sees a refusal where it used to see success): a household report held for another person is copied to this person in a non-correction message; or a note for the person just corrected away from repeats words that were reassigned. The other change in this area, the correction path in `claimFor`, only affects what the server stores. None of the three was exercised by a live model call, so **no live evidence covers them**: the live run (fx-live-2, `c4edd48`) used the earlier behaviour, and the recorded K4b model calls are replayed against the new code (D1 to D9). A real model's choices after seeing a new refusal are not shown. Verification here is scripted, deterministic and spend-free.

## Limits

* One active event per person: two events for the same person in one conversation still share a claim (this is the existing model, not changed here).
* Correction detection is pattern based, as before. A correction phrased in a way the patterns do not know is not treated as one, and then the different-person rules above apply (nothing is carried).
* "Not Grace" said about one fact of a longer message that also reports an event for Grace is not split into two events.
