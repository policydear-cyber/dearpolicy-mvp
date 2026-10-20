# UX acceptance of designer PR #65 at head 72568be

Method: a real browser (Playwright, Chromium) on the local app at `72568be`, with the **synthetic** households `fracture`
(chat, scenario FX-K4B, fresh seed and server) and `livelib` (unreadable document). Phone sizes were 390x844, 360 and 320
wide, with touch; desktop was 1366x900. The model was scripted (category 1), with no real model, no production and no
paid calls. Scripts are in this folder; screenshots are in `shots/`.

## Verdict per change

| Change | Verdict | Evidence and issues |
|---|---|---|
| Phone bottom bar: Portfolio, Documents, **Ask** (middle), Coverage, More | **Pass** | All five tabs fit at 390, 360 and 320 px with no horizontal scroll. More opens a sheet (Family, Payments, Benefits, Claims, Household); Escape and tapping outside close it; More is highlighted on a page it holds. Minor: opening More leaves keyboard focus on the button, and `role=menu` has no arrow-key support. `shots/phone-more-menu.jpg`, `phone-nav-320.jpg` |
| Bold first line as the bottom line | **Fail (as a bottom line)** | The first paragraph is bold (weight 600), but in the fracture answer it is "Grace's documents give two different answers for this event… never a total." That's a framing sentence, not the bottom line: no amount and no next step. A whole bold paragraph also reads as heavy. Smallest fix: a short lead naming the outcome, e.g. "Up to S$1,250 or S$120,000, depending on which document applies. Ask the insurer which one." |
| Sources: one row per document, tap to see the quote, link to the document | **Pass with issues** | 10 rows became 3, pages are merged ("pages 13, 37"), and the quotes show what was cited. That's a big improvement. Issues: (1) two rows still read identically, "Aldermoor Life Ltd · Scheme X Group Insurance / Your uploaded document", while the answer calls them "Product Summary" and "Certificate of Insurance Part 2", so the user can't match them; show the document type. (2) An unrelated quote ("disappears as a result of the sinking or wrecking of the ship…") appears under a fracture answer. (3) One quote is cut mid-sentence ("…thumb, finger and palm are not"). (4) "Open in Documents" scrolls to the library card, not to the page or quote. `shots/sources-desktop.jpg`, `sources-phone.jpg`, `open-in-documents.jpg` |
| Smaller message box on phones; Enter sends on desktop | **Pass** | Desktop: Enter sends and clears the box, and Shift+Enter adds a line. Phone: Enter adds a line (by design), the box starts at about 65 px, grows to 240 px, and doesn't cover the tab bar. Minor: nothing tells desktop users that Shift+Enter adds a line, and on a phone answer text shows through the gap between the box and the tab bar. `shots/desktop-enter-sent.jpg`, `phone-composer-long.jpg` |
| "Still working" note after 12 s | **Not observed** | Scripted answers finish in under 6 s, so the note can't appear locally. I checked the code only (`elapsed>=12`); it needs a live check. |
| "Try reading it again" on an unreadable file | **Pass with issues** | The button sends `POST /api/policies/reprocess` and the card switches to "Reading this document…" with a progress bar. Issues: the card still has no name (title "·"), "Reading" appears three times on one card (subtitle, badge and status chip), and the notice reads "Reading again…" with the document name missing, in the same green as a success. `shots/unreadable-before.jpg`, `unreadable-retrying.jpg` |

Desktop sidebar and other pages: no regressions seen.

## Top three issues on PR #65

1. **The bold first line isn't the bottom line.** For conflicting documents it's a framing sentence with no amount or action.
2. **Two sources still look identical.** Show the document type (Product Summary, Certificate) that the answer uses.
3. **The unreadable card has no name, says "Reading" three times, and the notice's name is blank.**

Not fixed by this PR (from `../screens-ca6af69/FINDINGS.md`): removing a person from a document doesn't stick, the
always-open "Who does this document cover?" panel, Coverage stuck on "still being read", and errors shown in green.
