# PR #54 follow-up: applicability, who resolves a requirement, enrolment caveats — result

- **Tested product code:** `b1db393e7a6819909cb7d548055b2d16e9320e45`.
  - The prior reviewed head was `2077c6e`, with product code `523efea`. Both are unchanged, and every earlier live
    result is untouched.
  - The tested working tree matches `b1db393` in `lib/`, `scripts/`, `e2e/`, `app/`, `components/`, `config/`,
    `types/`, `sql/`, `public/`, `eval/`, `package.json`, `package-lock.json`, `next.config.ts`, `middleware.ts`,
    `instrumentation.ts` and `tsconfig.json` (git tree hashes compared).
  - `.env.example`, `ci.yml` and the documentation are the only paths not compared.
- **Runtime:** Node `v22.22.2`, the repository's declared 22.x, with local PostgreSQL 16 and Chromium.
- **Expectations:** [EXPECTED-applicability.md](EXPECTED-applicability.md), written before the repair.
- **Unchanged:** main (`d549a27`) and production. No merge and no deploy.

## What changed

1. **Applicability from the document's own definition** (`lib/rag2/applicability.ts`, `lib/rag2/evaluate.ts`).
   - Each benefit record carries the definitions its own document prints, with that document's id and hash.
     A definition is a `<Term> means …` sentence, with its exact span as evidence.
   - `evaluate_benefit` compares the benefit's definition with what the household reported about an observable
     attribute. The only attribute so far is whether a fracture was closed or open. The attribute is vocabulary for
     the household's words; which value a benefit needs comes only from the definition.
   - A definition can point to another: "Other Fracture means a fracture that is **not a Simple Fracture** …" takes
     the opposite of Simple Fracture's own definition. Words after "including …" are examples, not requirements.
   - The four outcomes:
     - **consistent:** evaluated as before. The facts it rests on are added to the result's dependencies, so a
       correction withdraws the result.
     - **inconsistent:** `not_applicable`. No illustration and no requirement. The benefit's terms are left out of
       the answer, and an earlier illustration of it is withdrawn and the answer says so.
     - **unresolved:** one household requirement, "closed or open?", with readable options.
     - **no definition, or nothing constrained:** unchanged.
   - Every earlier illustration is checked again on each turn that records something, so a correction under any fact
     key withdraws one that no longer fits.
2. **Who resolves a requirement** (`lib/rag2/loop/loop.ts`, `lib/rag2/loop/questions.ts`).
   - Every server requirement records `resolvedBy: household`: which listed case, closed or open, a stay's dates.
   - `ask_user` never asks an insurer requirement.
   - When the model words a server requirement as an assessment, the server asks the requirement's own household
     question instead.
   - A free-form question asking for an assessment of the policy terms is refused at the boundary, and the supported
     answer is kept. Examples: "meets the definition", "accepted", "approved", "determined".
   - When a question names a requirement but nothing is open, the ask's own statements are composed and gated as the
     answer. This happens when the benefit it would concern was found not to fit.
   - Requirement options are shown as the cases' own words. Before, the choice buttons carried internal row ids.
3. **Enrolment statements** (`lib/rag2/loop/compose.ts`).
   - A negative or uncertain statement that a person's enrolment or listing is not confirmed is checked against that
     person's own certificate rows.
   - When a row lists them, the statement is replaced by the dated listing, "Daniel's certificate lists Daniel under
     Group Personal Accident as of 01/04/2024", plus a note: "A dated certificate shows who it listed on that date; it
     does not by itself establish cover on a later date."
   - The product comes from the cited wording's own section heading. For the page-9 allowance this is "PART B - GROUP
     PERSONAL ACCIDENT"; titles are never used.
   - These are kept as said:
     - a statement limited to a date;
     - enrolment for a particular benefit, or for the applicable, Core or Voluntary part of a scheme;
     - a person no certificate lists.
   - Another household's certificate, or another member's row, never counts.

## Applicability evidence (booklet household, page and wording as stored)

| benefit | its definition (cited) | closed report | open report | nothing said |
|---|---|---|---|---|
| Simple Fracture | p7: "Simple Fracture means a closed fracture where the skin is not broken." | consistent | inconsistent | unresolved |
| Other Fracture | p8: "Other Fracture means a fracture that is not a Simple Fracture, including a compound (open) fracture." (→ p7) | inconsistent | consistent | unresolved |
| Simple Fracture (`BOOKLET_DEFS=alt`) | "Simple Fracture means any fracture of a bone listed below, whether open or closed." | no constraint (evaluated) | no constraint (evaluated) | no constraint |
| Other Fracture (`BOOKLET_DEFS=alt`) | "Other Fracture means an open (compound) fracture." | inconsistent | consistent | unresolved |

## Results

| check | result |
|---|---|
| `reliable-chat:applicability-test`: booklet definitions, including the BKL1a, BKL1b and BKL3 replays and every control | 31 / 31 |
| `reliable-chat:applicability-test`: `BOOKLET_DEFS=alt`, a second policy's definitions | 2 / 2 |
| `reliable-chat:booklet-test`: four variants plus batched steps (now runs the applicability test too) | 26 / 24 / 26 / 21, 2 / 2 |
| `npx tsc --noEmit` | clean |
| `next build` | pass |
| The 58 affected route and verifier suites, run on the tested code | 57 pass, 1 fails |
| Browser `e2e:reliable-chat-booklet`: BK1–BK3, plus RL1a, RL1b and RL3 (the rc-live-5 recorded calls through the real chat page) | 6 / 6 |
| Browser `e2e:reliable-chat`: RC1 to RC3, including a correction withdrawing an illustration | 3 / 3 |
| Browser `e2e:rag2-pr50` | 3 / 3 |

The 58 suites cover every `reliable-chat:*` and `rag2:*` suite, the verifiers, chat-contract and answer suites,
monetary and currency boundaries, release, roster, binding and PR50 regressions, import boundary, CI workflow coverage
and model provenance.

The one failure is `security:env-contract-test`, which also fails on main. With this commit's `.env.example` it
reports main's 24 undocumented names; the new `BOOKLET_DEFS` and `TRANSCRIPTS` are documented.

**BKL1a and BKL1b replays (the saved live failures):**
- Turn 1 asks one case question, offered in the cases' own words. Other Fracture is `not_applicable`.
- After "hip", the answer gives the conditional S$3,750, which recomputes, with no question and nothing pending.
- The model steps match the recording: 3 and 2.
- The pre-registered grader v3, unchanged, passes both. The live run failed both.

**BKL3 replay:** the false caveat is replaced by the dated certificate listing. The allowance, its conditions and the
bare-$ amount are kept, and grader v3 passes.

**Latency:** `scripts/reliable-chat-latency.ts` measures application time with a scripted model that takes no time.

| turn | application time | model steps | tool calls | refused |
|---|---|---|---|---|
| BK1.1 | 109 ms | 4 | 5 | 0 |
| BK1.2 | 154 ms | 3 | 4 | 0 |
| BK2 | 104 ms | 3 | 4 | 0 |
| BK3 | 83 ms | 2 | 3 | 0 |

This is the same number of model steps as before. In the replayed BKL1 turn 2 the ask becomes the answer without
another model call.

## Real-model check: pending

The ledger (`docs/rag-migration/live/LEDGER.json`) was reconciled before any run:

- exercise cap US$0.50;
- unreserved balance **US$0.003738**;
- the `trial-codespace-1` allowance of US$0.15 still reserved, and not used.

The run-cap guard reserves each call's worst case before sending it: estimated input (request characters ÷ 2.5) × US$0.10
per million, plus 2,000 output tokens × US$0.50 per million.

- For the booklet household that is about US$0.0024–0.0029 per call.
- One two-turn BKL1 conversation needs 5 calls; the actual spend in rc-live-5 was US$0.0023–0.0029.
- After the first one or two calls, the next call's reservation would no longer fit the balance. The conversation would
  be BLOCKED partway through turn 1.

Cost admission was not weakened, so the live check is **pending authorised budget**. No model call was made in this
follow-up.

## Visible transcripts (offline replays through the real chat route, no model)

Each block is the household-visible answer: summary, details, question with its options, and next steps. Beneath it are
the model steps, the tool calls with each evaluation's status, and what the server changed.

### BKL1a (recorded calls)

> Daniel slipped in the bathroom and broke a bone. The doctor thinks it is his hip but it could be his tibia; they are still checking. It is a closed fracture. What could his accident cover pay?

```
The Group Insurance Benefits Booklet (page 7) pays the Simple Fracture as a percentage of the Simple Fracture Benefit Limit of S$5,000 for each listed case: Skull 100%; Hip 75%; Jaw, Pelvis, Leg, Ankle or Knee 50%; Arm, Wrist or Elbow 40%.
Which listed fracture case is Daniel’s: Hip or Jaw, Pelvis, Leg, Ankle or Knee?  [options: Hip | Jaw, Pelvis, Leg, Ankle or Knee]
```

model steps 3; calls ["resolve_person","note_facts","person_benefits","evaluate_benefit needs_facts","evaluate_benefit not_applicable","search_passages","ask_user"]; server: ["ask_user: left out the terms of 1 benefit(s) whose definition does not fit what the household reported"]

### BKL1a (recorded calls)

> Update: the X-ray confirms it is his hip.

```
If the Simple Fracture benefit applies to Daniel's case “Hip” (as you described: “the X-ray confirms it is his hip.”), the conditional illustration is S$3,750: 75% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Benefits Booklet; it is an illustration from the document's terms, not a payment or an insurer's decision, and only for an injury the insurer accepts as caused by an accident (the policy says “We will pay the percentage of the Simple Fracture Benefit Limit shown below for a Simple Fracture of a nature listed, caused by an Accident”).
Suggestion, not stated in your documents (confirm with the insurer): send the documents that show the policy’s condition is met with the insurer’s claim form.
```

model steps 2; calls ["note_facts","evaluate_benefit conditional_illustration","evaluate_benefit not_applicable","ask_user"]; server: ["the open case question was answered (b552ce93447)","ask_user: left out the terms of 1 benefit(s) whose definition does not fit what the household reported","ask_user (q2_1): no requirement is open (1 benefit(s) do not fit the report) -- answered with its statements instead of asking"]

### BKL1b (recorded calls)

> Daniel slipped in the bathroom and broke a bone. The doctor thinks it is his hip but it could be his tibia; they are still checking. It is a closed fracture. What could his accident cover pay?

```
The Group Insurance Benefits Booklet (page 7) pays the Simple Fracture as a percentage of the Simple Fracture Benefit Limit of S$5,000 for each listed case: Skull 100%; Hip 75%; Jaw, Pelvis, Leg, Ankle or Knee 50%; Arm, Wrist or Elbow 40%.
Which fracture site was confirmed: hip or leg (including the tibia)?  [options: Hip | Jaw, Pelvis, Leg, Ankle or Knee]
```

model steps 3; calls ["resolve_person","note_facts","person_benefits","evaluate_benefit needs_facts","evaluate_benefit not_applicable","search_passages","ask_user"]; server: ["ask_user: left out the terms of 1 benefit(s) whose definition does not fit what the household reported"]

### BKL1b (recorded calls)

> Update: the X-ray confirms it is his hip.

```
If the Simple Fracture benefit applies to Daniel's case “Hip” (as you described: “the X-ray confirms it is his hip”), the conditional illustration is S$3,750: 75% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Benefits Booklet; it is an illustration from the document's terms, not a payment or an insurer's decision, and only for an injury the insurer accepts as caused by an accident (the policy says “We will pay the percentage of the Simple Fracture Benefit Limit shown below for a Simple Fracture of a nature listed, caused by an Accident”).
Suggestion, not stated in your documents (confirm with the insurer): send the documents that show the policy’s condition is met with the insurer’s claim form.
```

model steps 2; calls ["note_facts","evaluate_benefit conditional_illustration","evaluate_benefit not_applicable","ask_user"]; server: ["the open case question was answered (b552ce93447)","ask_user: left out the terms of 1 benefit(s) whose definition does not fit what the household reported","ask_user (q2_1): no requirement is open (1 benefit(s) do not fit the report) -- answered with its statements instead of asking"]

### open hip

> Daniel broke his hip in a fall at home. It was an open fracture - the bone came through the skin. What can his accident cover pay?

```
If the Other Fracture benefit applies to Daniel's case “Hip (Other Fracture)”, the conditional illustration is S$225,000: 75% of Daniel's sum insured of S$300,000 (Group Personal Accident), under the Group Insurance Benefits Booklet; it is an illustration from the document's terms, not a payment or an insurer's decision.
Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Civil Service Group Insurance Scheme - Certificate to ask what it needs for a claim.
```

model steps 3; calls ["resolve_person","note_facts","person_benefits","evaluate_benefit not_applicable","evaluate_benefit conditional_illustration","final_answer"]

### unspecified then closed

> Daniel broke his hip in a fall at home. What can his accident cover pay?

```
The Group Insurance Benefits Booklet (page 7) pays the Simple Fracture as a percentage of the Simple Fracture Benefit Limit of S$5,000 for each listed case: Skull 100%; Hip 75%; Jaw, Pelvis, Leg, Ankle or Knee 50%; Arm, Wrist or Elbow 40%.
Was it a closed fracture or an open one?  [options: Closed (the skin was not broken) | Open (compound: the bone broke through the skin)]
```

model steps 3; calls ["resolve_person","note_facts","person_benefits","evaluate_benefit needs_facts","evaluate_benefit needs_facts","ask_user"]

### unspecified then closed

> It was closed - the skin wasn't broken.

```
If the Simple Fracture benefit applies to Daniel's case “Hip”, the conditional illustration is S$3,750: 75% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Benefits Booklet; it is an illustration from the document's terms, not a payment or an insurer's decision.
You told me it was closed - the skin wasn't broken.
Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Civil Service Group Insurance Scheme - Certificate to ask what it needs for a claim.
```

model steps 2; calls ["note_facts","evaluate_benefit conditional_illustration","evaluate_benefit not_applicable","final_answer"]

### corrected (fracture_type)

> Daniel broke his hip in a fall at home. It was a closed fracture. What can his accident cover pay?

```
If the Simple Fracture benefit applies to Daniel's case “Hip”, the conditional illustration is S$3,750: 75% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Benefits Booklet; it is an illustration from the document's terms, not a payment or an insurer's decision.
Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Civil Service Group Insurance Scheme - Certificate to ask what it needs for a claim.
```

model steps 3; calls ["resolve_person","note_facts","person_benefits","evaluate_benefit conditional_illustration","evaluate_benefit not_applicable","final_answer"]

### corrected (fracture_type)

> Sorry, I got that wrong - it was actually an open fracture, the bone came through the skin.

```
Updated: fracture type is now open fracture (you said closed fracture at first). The earlier estimate worked out from it no longer applies.
If the Other Fracture benefit applies to Daniel's case “Hip (Other Fracture)”, the conditional illustration is S$225,000: 75% of Daniel's sum insured of S$300,000 (Group Personal Accident), under the Group Insurance Benefits Booklet; it is an illustration from the document's terms, not a payment or an insurer's decision.
Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Civil Service Group Insurance Scheme - Certificate to ask what it needs for a claim.
```

model steps 2; calls ["note_facts","evaluate_benefit not_applicable","evaluate_benefit conditional_illustration","final_answer"]

### corrected (fracture_detail -- the correction recorded under another key)

> Daniel broke his hip in a fall at home. It was a closed fracture. What can his accident cover pay?

```
If the Simple Fracture benefit applies to Daniel's case “Hip”, the conditional illustration is S$3,750: 75% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Benefits Booklet; it is an illustration from the document's terms, not a payment or an insurer's decision.
Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Civil Service Group Insurance Scheme - Certificate to ask what it needs for a claim.
```

model steps 3; calls ["resolve_person","note_facts","person_benefits","evaluate_benefit conditional_illustration","evaluate_benefit not_applicable","final_answer"]

### corrected (fracture_detail)

> Sorry, I got that wrong - it was actually an open fracture, the bone came through the skin.

```
Updated: fracture type is now an open fracture (you said a closed fracture at first). The earlier estimate worked out from it no longer applies.
If the Other Fracture benefit applies to Daniel's case “Hip (Other Fracture)”, the conditional illustration is S$225,000: 75% of Daniel's sum insured of S$300,000 (Group Personal Accident), under the Group Insurance Benefits Booklet; it is an illustration from the document's terms, not a payment or an insurer's decision.
Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Civil Service Group Insurance Scheme - Certificate to ask what it needs for a claim.
```

model steps 2; calls ["note_facts","evaluate_benefit not_applicable","evaluate_benefit conditional_illustration","final_answer"]

### insurer question (free)

> Daniel broke his hip in a fall at home. It was a closed fracture. What can his accident cover pay?

```
If the Simple Fracture benefit applies to Daniel's case “Hip”, the conditional illustration is S$3,750: 75% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Benefits Booklet; it is an illustration from the document's terms, not a payment or an insurer's decision.
Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Civil Service Group Insurance Scheme - Certificate to ask what it needs for a claim.
```

model steps 4; calls ["resolve_person","note_facts","person_benefits","evaluate_benefit conditional_illustration","ask_user (refused)","final_answer"]

### insurer wording of a household requirement

> Daniel fell off a ladder and broke a bone - his hip or possibly his tibia, they are not sure yet. It was a closed fracture. What can his accident cover pay?

```
I'm asking because it changes which of the policy's benefits or amounts applies.
Which of these cases is it: Hip or Jaw, Pelvis, Leg, Ankle or Knee?  [options: Hip | Jaw, Pelvis, Leg, Ankle or Knee]
```

model steps 3; calls ["resolve_person","note_facts","person_benefits","evaluate_benefit needs_facts","ask_user"]; server: ["asked requirement q1_1's own question (\"Which of these cases is it: Hip or Jaw, Pelvis, Leg, Ankle or Knee?\") instead of \"Will the insurer's medical assessment determine that Daniel's injury meets the definition of Hip?\""]

### BKL3 (recorded calls)

> If Daniel died in an accident, is there an allowance for funeral expenses in our booklet, and what does it need?

```
The booklet’s Compassionate Death Allowance Benefit says funeral expenses incurred are payable up to 2,000 (printed with a “$” sign; the document does not say which currency) if bodily injury from an Accident independently results in death within 365 days of the Accident, on receipt of proof of death and the original receipts; it is not payable for death caused by illness.
The booklet is reference wording.
Daniel's certificate lists Daniel under Group Personal Accident as of 01/04/2024.
A dated certificate shows who it listed on that date; it does not by itself establish cover on a later date.
Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Civil Service Group Insurance Scheme - Certificate to ask what it needs for a claim.
```

model steps 3; calls ["resolve_person","note_facts","person_benefits","policies_for","search_passages","final_answer"]

### enrolment: Ethan (absent person -- no certificate lists him)

> Is there a funeral allowance for Ethan, and is Ethan listed?

```
The uploaded documents do not confirm Ethan’s enrolment in the group scheme.
```

### enrolment: Daniel (dated limitation)

> Is there a funeral allowance for Daniel, and is Daniel listed?

```
The documents do not establish that Daniel's cover was in force on the date of death.
```

### enrolment: Daniel (enrolment for a particular benefit)

> Is there a funeral allowance for Daniel, and is Daniel listed?

```
The documents do not establish that Daniel is enrolled for the Compassionate Death Allowance.
```

### enrolment: Grace (listed on her own row)

> Is there a funeral allowance for Grace, and is Grace listed?

```
Grace's certificate lists Grace under Group Personal Accident as of 01/04/2024.
A dated certificate shows who it listed on that date; it does not by itself establish cover on a later date.
```

### alt definitions: closed (`BOOKLET_DEFS=alt`)

> Daniel broke his hip in a fall at home. It was a closed fracture. What can his accident cover pay?

```
If the Simple Fracture benefit applies to Daniel's case “Hip”, the conditional illustration is S$3,750: 75% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Benefits Booklet; it is an illustration from the document's terms, not a payment or an insurer's decision.
Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Civil Service Group Insurance Scheme - Certificate to ask what it needs for a claim.
```

model steps 3; calls ["resolve_person","note_facts","person_benefits","evaluate_benefit conditional_illustration","evaluate_benefit not_applicable","final_answer"]

### alt definitions: open (`BOOKLET_DEFS=alt`)

> Daniel broke his hip in a fall at home. It was an open fracture - the bone came through the skin. What can his accident cover pay?

```
If the Simple Fracture benefit applies to Daniel's case “Hip”, the conditional illustration is S$3,750: 75% of the Simple Fracture benefit limit of S$5,000, under the Group Insurance Benefits Booklet; it is an illustration from the document's terms, not a payment or an insurer's decision.
If the Other Fracture benefit applies to Daniel's case “Hip (Other Fracture)”, the conditional illustration is S$225,000: 75% of Daniel's sum insured of S$300,000 (Group Personal Accident), under the Group Insurance Benefits Booklet; it is an illustration from the document's terms, not a payment or an insurer's decision.
Contact Aldermoor Life Ltd (through the employer or scheme administrator, for this group scheme) about the Civil Service Group Insurance Scheme - Certificate to ask what it needs for a claim.
```

model steps 3; calls ["resolve_person","note_facts","person_benefits","evaluate_benefit conditional_illustration","evaluate_benefit conditional_illustration","final_answer"]

## Remaining limitations

1. **Live check pending.** No real-model run was possible within the authorised balance, so the repair is proven only by
   replays of the recorded calls and scripted moves.
2. **One observable attribute.** Applicability covers only closed or open fracture, matched by vocabulary.
   - A definition turning on something else (surgery, hospital days, a waiting period) is "unconstrained" and is
     evaluated as before. It is not marked unresolved.
   - Definitions must be printed as "<Term> means …" sentences in the benefit's own document.
3. **Insurer-assessment detection** combines the structural boundary with a classifier of assessment wording near policy
   terms. A differently worded assessment question could still pass as a household question, though server requirements
   always keep their own wording.
4. **Turn 2 of the BKL1 replay** ends with the existing generic "Suggestion, not stated in your documents …" line and no
   contact step, because the ask's statements became the answer. **BKL3** still carries the model's "The booklet is
   reference wording." line.
5. **Enrolment rewrite scope.** Only enrolment and listing statements about a named household member are rewritten.
   Other negative cover claims keep their existing checks.
6. **Fixtures.** They are anonymised reconstructions of the reported library, and no production trace was read. The
   sample supports no reliability rate.
