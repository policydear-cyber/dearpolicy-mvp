# Michelle's endorsement in Darren's answer, and the assumed speaker (s50-live-2): trace and fix

**Release code:** `7ae2b538a7880ce0e0b4d25673f8065807f3ed7b`.
- The replay below ran on this tree, checked against the commit's tree manifest (870 source files).
- Earlier results are kept: `REPLAY-8d5a838.json` is the replay on `8d5a838`, and the live run's files are unchanged. The new replay is `REPLAY-7ae2b53.json`.

## 1. The endorsement belongs only to Michelle

**The document.** `ENDORSE` reads "With effect from 01/01/2024 the Group Personal Accident Sum Insured for Ong Li Ting, Michelle is amended to S$400,000." It is linked only to Michelle. Its only amending clause names her and no one else; nothing in it states a scheme-wide scope. It does not apply to Darren.

**How it reached Darren's answer** (traced by replaying the saved tool calls and reading the tool results):
- `person_benefits` for Darren was correct: no amendment and no conflict.
- `policies_for` for Darren (turn 1, the model's 4th call) was wrong. It returned the certificate with `version.amendments: [Endorsement No. 3, effective 2024-01-01]` and `current: "the schedule as amended by the endorsement effective 2024-01-01"`.
  - `lib/rag2/policies.ts` grouped endorsements with the certificate by **policy number** (PSG-880100 is printed on every product of the scheme) and never checked whose cover the endorsement amends.
- The model then wrote, about Darren: "The uploaded documents do not establish the amount applicable on the date of death: an endorsement effective 1 January 2024 is linked to the policy …" (turn 1, and again in turn 2).
- The composer accepted it. It was an uncertainty statement citing Darren's own certificate rows, and the person / product / version binding was applied only to figures.

## 2. Fix (one rule, used at both points)

**The rule.** `lib/rag2/endorsement-scope.ts` decides an endorsement's scope from its **amending clauses**, not from headers, addresses, the policyholder line or links:

| what the amending clause shows | scope for this person |
|---|---|
| it names this person | applies |
| it states a scheme-wide scope ("all Insured Persons") | applies |
| it names only other household members | **other** |
| it is person-specific but establishes no household member (a masked ID, "the Insured Person …") | **unresolved**, attributed to nobody |
| it has no person-specific clause | applies to the policy as a whole |

**Where it is enforced:**
- **`policies_for`** (`lib/rag2/policies.ts`):
  - "other" endorsements are left out of that person's coverage entirely.
  - "unresolved" ones are listed with `scope: "unresolved"`, `current: "not established: an endorsement of this policy number (effective …) does not establish whom it applies to"`, and a note that names no one.
- **Composer** (`otherPersonsEndorsement`):
  - A statement about a person that relies on an endorsement is checked against that person's endorsement scopes (`householdBenefits().endorsementsByMember`). This covers amendments, caveats, uncertainty and conflicts, not only figures.
  - When every endorsement of the person's policies belongs to someone else, the endorsement clause is taken out; if the sentence is nothing but that clause, it is not shown.
  - An "applies" or "unresolved" endorsement may still be reported.
- **Unchanged:** `person_benefits` already required the endorsement line to name the member before treating it as amending them.

## 3. The assumed speaker

**Where the assumption came from.**
- `lib/rag2/loop/hook.ts` set the speaker to the only member whose relationship is "self" (Darren).
- The model's state note then said "Darren (self, the person typing)" and "Speaker: Darren".
- The user wrote that Darren had died, so the model guessed the typist was the spouse, and wrote "I'm so sorry for your loss, Michelle".

**What the sign-in actually establishes.** The household (`household_members`: household, user), never a member: no column links a signed-in user to a `family_members` row, and "self" is a household-editable label. So the sign-in does not establish who is typing.

**Fix:**
- **State note:** a speaker counts as established only when the household itself says who is typing, by answering the existing "Who is asking?" question (`state.speakerConfirmed`). Otherwise the state note says the speaker is "not established (the sign-in identifies the household, not the member)". "I / me / my" still default to the member recorded as self for lookups, unchanged. The model is told never to assume or say who is typing and never to address them by name.
- **Composer** (`withoutUnconfirmedAddress`): whatever the model writes, a member's name used to address the reader ("…for your loss, Michelle;", "Michelle, I'm…", "Hello Michelle,") is taken out unless the speaker is confirmed. A name that is the subject of the sentence stays.

**Model input.** The state note's wording is a change to what the model sees, though the system prompt and tool schema are byte-identical. Its effect on the model is **not verified with the real model**. The visible outcome does not depend on it: the composer rule removes an assumed address whatever the model writes, and the replay shows this.

## 4. Controls (`npm run rag2:binding-test`, 47/47)

- **ENDORSEMENT: another person's endorsement.** It cannot qualify Darren's cover.
  - Its scope for Darren is "other" and for Michelle "applies". Naming the policyholder alone is not a person-specific scope.
  - `policies_for` reports no amendment for Darren and the endorsement for Michelle.
  - A Darren caveat relying on it ("may differ, because an endorsement … amends the policy") is not shown; his amounts are.
- **ENDORSEMENT: a shared endorsement.** It applies when its scope explicitly includes Darren:
  - "for all Insured Persons", even though the document is linked only to Michelle;
  - or naming him.
  - It is then reported as amending his schedule, and a caveat relying on it stays.
- **ENDORSEMENT: unresolved.** A person-specific endorsement whose person is a masked ID matching no member is reported for both people as "does not establish whom it applies to", in notes that name no one. It may be reported as uncertainty.
- **SPEAKER.** The state note does not call the self member "the person typing" unless confirmed, and does once the household says who is typing. Vocative names are removed; subject names stay.

## 5. Replay of s50-live-2 on `7ae2b53` (`REPLAY=s50 node --import tsx scripts/rag2-s50-replay.ts`, 12/12; no model call)

**USER:** Darren died in a car accident in Japan, what can I do?

**APP:** I'm so sorry for your loss; Darren's uploaded certificate lists Group Term Life of S$1,000,000 as of 6 October 2022, and the linked wording says the Death Benefit is the Sum Assured shown in the Certificate of Group Insurance. The same certificate lists Group Personal Accident of S$600,000 as of 6 October 2022, while the linked summary says Accidental Death is 100% of the Sum Insured if death results from an Accident within 365 days; it also says territorial limits are worldwide, 24 hours a day. The uploaded documents do not establish the amount applicable on the date of death, and the certificate figures above are dated 6 October 2022. The Term Life summary says to notify Meridian Life Ltd of a death within 6 months, with the death certificate. The uploaded documents do not state the Personal Accident claim-notification process or the documents required for that claim.
On what date did the accident happen?

**USER:** The accident happened on 3 October 2026 and he died on 5 October 2026.

**APP:** You told me the accident happened on 3 October 2026 and Darren died on 5 October 2026.
The linked Personal Accident summary says Accidental Death is 100% of the Sum Insured if death results from an Accident within 365 days, and that territorial limits are worldwide, 24 hours a day; the dates you gave fall within that stated period, but the documents do not confirm whether the event meets the policy definition of Accident.
The Term Life summary says the Death Benefit is the Sum Assured shown in the Certificate of Group Insurance and says to notify Meridian Life Ltd of a death within 6 months, with the death certificate.
The certificate lists Darren's Group Personal Accident sum insured as S$600,000 as of 6 October 2022, but the uploaded documents do not establish the amount applicable on the accident date.
What you've told me is your own account: the insurer will check it against the documents it asks for and decides the claim after reviewing them.
Next step: Notify Meridian Life Ltd about the Term Life death claim and provide the death certificate; ask the insurer what additional documents it needs for both claims.

**Checks passed:**
- Prompt and tool schema are identical to what the model saw.
- Same tool outcomes as live.
- Saved answer equals the route's answer.
- TL and PA are bound to Darren's row and cited in turn 1; PA in turn 2. The only removal is the endorsement clause.
- No endorsement, amendment or its date in either answer. `policies_for` reports no amendment for Darren; Michelle's view keeps hers.
- No assumed reader.
- No injury note and no unsupported paperwork.
- No repeated date question.
- Grader v4: PASS.
- **The differences from the live answer are exactly three:** the reader's name, the two clauses about Michelle's endorsement, and the application's note.

**Browser:**
- `rag2-s50-replay.spec.ts`, 1/1: displayed equals saved; no endorsement or assumed reader is displayed.
- `rag2-binding.spec.ts`, 2/2: Michelle's endorsement still amends her own amount.
- **Injury control:** 1/1.
- **Suites:** tsc and all 45 suites pass.
