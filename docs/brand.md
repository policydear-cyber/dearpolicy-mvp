# DearPolicy brand

DearPolicy helps an ordinary household understand its insurance documents.
It should feel calm, clear, trustworthy and warm: a knowledgeable friend
sitting at the kitchen table, not a bank, not a salesperson.

The tokens live at the top of `app/globals.css`. `npm run brand:tokens-test`
(a CI step) fails if `app/globals.css` hard-codes a colour outside the
token blocks, if any other stylesheet under `app/` or `components/` or any
page or component style uses a colour literal, if any
`var(--token)` is undefined, if a role drops below WCAG AA in light or dark,
or if a key meaning (failed read, to confirm, still reading…) changes role.

## Colour carries meaning

Each colour has one meaning and is spent on nothing else. A status is never
told by colour alone: it always has words. Unresolved boxes, chips and the
to-confirm answer line also have a dashed edge; unresolved plain text
relies on its words.

| Role | Tokens | Means | Used for |
| --- | --- | --- | --- |
| Frame | `--brand`, `--brand-ink`, `--brand-tint` | DearPolicy itself | wordmark, nav, links, headings, the household's own chat bubble |
| Action | `--accent`, `--accent-ink` | something to press | the primary button on a screen (one per view) |
| Documented figure | `--money` | an amount printed in the household's documents | benefit and claim amounts, totals; always tabular figures |
| Confirmed | `--good-*` | read, matched, verified, saved | "Read", "Matched", "Saved", a covered benefit |
| Unresolved | `--unresolved-*` + dashed edge | not settled yet, and nothing for the household to fix | "Read in part", an amount whose wording isn't read yet, a benefit that depends on conditions, an indicative estimate, "could not check every part" |
| Warning | `--warn-*` | the household (or a reviewer) should look, decide or provide | a name to confirm, "confirm this" on a benefit, a benefit that needs a document, a claim waiting on their documents, benefits that failed to read, a usage limit near its end, a held file |
| Error | `--critical-*` | something failed or will be destroyed | upload failed, a document or page that couldn't be read (with Try again), form errors, a rejected file, delete buttons (a document card's Delete is muted at rest and turns `--critical` on hover, focus and its Confirm step) |
| Information | `--info-*` (warm neutrals) | neutral news | "still being read", "replaced", invite-only sign-up |

Rules of thumb:

- Unresolved is not a warning. "Read in part" or "this amount still needs
  its wording confirmed" is honest uncertainty, drawn in calm slate with a
  dashed edge, not in amber. Amber is kept for things someone can act on,
  and a read that failed with a reason and Try again stays an error.
- Missing information is never drawn as an error or an exclusion.
- A documented figure is drawn in `--money` only when the server resolved
  it from the document. A conditional illustration sits under an
  unresolved label, never in a confirmed green box.
- Red only for failure or a destructive action. Never for a policy limit,
  an exclusion or a refused claim.

### Palette

| Token | Light | Dark |
| --- | --- | --- |
| `--bg` page | `#f5f4f0` (stone, low chroma) | `#161513` |
| `--surface` card | `#ffffff` | `#201e1b` |
| `--ink` text | `#1c1a17` | `#f1efe9` |
| `--muted` | `#625e56` | `#a39e94` |
| `--brand` (fills: your chat bubble, active pill) | `#1c1a17` | `#f1efe9` |
| `--brand-ink` (links) | `#7a3f30` (the logo's brown) | `#e0a898` |
| `--accent` (the one primary button) | `#1c1a17` | `#f1efe9` |
| `--money` | `#1c1a17` (figures are told by weight and size, not hue) | `#f1efe9` |
| `--good-text` | `#276b44` | `#8fd0a8` |
| `--unresolved-text` | `#3f5165` | `#b7c7d7` |
| `--warn-text` | `#7a5600` | `#ecc46e` |
| `--critical` | `#a3342a` | `#f08b7d` |

### Look (15 Nov 2026, "paper and ink")

The cream ground with brown and orange fills was the most common look of
generated pages in 2025–26, so the chrome is now neutral: stone ground,
near-black ink and buttons, colour kept for meaning (status) and for the
logo. Surfaces are told apart by a tone step, not lines or shadows
(`--edge` is transparent); tables and inputs keep their lines. No icon
in a tinted square beside a heading, no small uppercase labels, small
radii (4–8px).

Contrast is checked by the test, not by eye: text 4.5:1; dots, the
unresolved dashed edge and input borders 3:1; in both themes. Decorative
card borders between siblings are not status cues and are not held to 3:1.

## Type

One family, Instrument Sans, served from the site by `next/font` and set
as `--font-face` on the page; the system UI stack in `--font` is the
fallback, including for CJK names on documents.

| Token | Size | Use |
| --- | --- | --- |
| `--fs-3xl` | 36px (fluid from 28px) | page title (h1) |
| `--fs-2xl` | 28px | a headline figure |
| `--fs-xl` | 22px | section title (h2) |
| `--fs-lg` | 17px | card title (h3), an answer's bottom line |
| `--fs-md` | 15px | body |
| `--fs-sm` | 13px | supporting text, buttons in rows |
| `--fs-xs` | 12px | chips, captions, footnotes |

Weights: 400 body, 600–650 emphasis and titles, 700 page titles only.
Figures are tabular wherever amounts line up.

## Logo

- The wordmark is `public/dearpolicy-logo.png`: "DEAR" in brand brown,
  "POLICY" in accent orange. Use it as supplied: never recolour, stretch,
  outline or set it on a photo.
- It sits on the light stone ground. In dark mode it keeps a cream
  plate (`--logo-plate`) rather than being inverted.
- Minimum height 24px on screen; keep clear space of at least the height
  of the "D" around it.
- Where the wordmark can't be read (favicon, home-screen icon), use the
  monogram: the wordmark's own "D" (brown) and "P" (orange) on the cream
  ground, `app/icon.png` (rounded) and `app/apple-icon.png` (square; the
  phone rounds it). Never set the full wordmark below 24px high.
- In running text the name is written **DearPolicy**: one word, capital D
  and P.

## Voice

- Plain English a household uses, in full sentences. Say what the document
  says, then what is still unknown, then one next step.
- Calm and direct. No hype, no fear, no exclamation marks, no
  "Congratulations".
- Honest about limits: "We couldn't read page 3" rather than "Error 422";
  "This depends on the hospital stay" rather than "Not covered".
- Never promise payment. The insurer decides; DearPolicy explains what the
  documents say.
- English only.
