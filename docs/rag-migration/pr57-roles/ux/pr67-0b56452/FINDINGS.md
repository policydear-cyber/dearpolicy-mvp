# UX test of PR #67 (unticking a person from a document) at head 0b56452

Method: a real browser on the local app at `0b56452`, using the **synthetic** `fracture` household, on desktop (1366x900)
and phone (390x844, touch). The document was the reference certificate "Scheme X Group Insurance". No real model, no
production, no paid calls.

| Step | Desktop | Phone |
|---|---|---|
| Untick Grace | Pass. Grace unticked; "Saved — … covers Lee Wei Ming, Daniel" | Pass |
| Reload | Pass. Still only Daniel | Pass |
| Re-tick Grace | Pass. "Saved — … covers Lee Wei Ming, Daniel, Tan Hui Min Grace" | Pass |
| Reload | Pass. Both ticked | Not repeated |
| Untick the last person | Pass. Refused (409), with "A document has to cover at least one person. Choose who it covers, or delete it if it isn't your family's." shown in the panel; the person stays ticked | Pass |

**Verdict: the critical bug is fixed.** The screen, the confirmation and the saved state now agree.

Minor wording conflict: the upload form still says "Reference documents do not need to be assigned to a family member",
but a reference document can't be left with nobody. Smallest fix: drop that sentence, or say "You can leave who it
covers until later."

Not checked: whether chat answers stop using the document for Grace after she's unticked. That needs a scripted
scenario this harness doesn't have.
