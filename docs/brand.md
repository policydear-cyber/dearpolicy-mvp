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
| `--bg` page | `#eef0f3` (cool grey, the wallet) | `#0f1216` |
| `--surface` card | `#ffffff` | `#191d23` |
| `--surface-2` block inside a card | `#f3f4f6` | `#20252c` |
| `--ink` text | `#0d1117` | `#eef0f3` |
| `--muted` | `#5b6472` | `#99a1ad` |
| `--brand` (fills: your chat bubble, active filter) | `#0d1117` | `#eef0f3` |
| `--brand-ink` (links) | `#0d1117` (same ink as the buttons; the logo is the only warm colour) | `#eef0f3` |
| `--accent` (the one primary button) | `#0d1117` | `#eef0f3` |
| `--money` | `#0d1117` (figures are told by weight and size) | `#eef0f3` |
| `--good-text` | `#276b44` | `#8fd0a8` |
| `--unresolved-text` | `#3f5165` | `#b7c7d7` |
| `--warn-text` | `#7a5600` | `#ecc46e` |
| `--critical` | `#a3342a` | `#f08b7d` |
| `--person-1..4` + `-tint` | blue, plum, teal, indigo | lighter inks, deep tints |
| `--card-*` cover cards | hospital `#14213d`, hospital cash `#7b2d26`, death `#1f5135`, critical illness `#2f4b7c`, disability `#0f5560`, accident `#3a3f47`, travel `#6b4f1d`, home and motor `#4a3b6b`, savings `#4d3f2a`, other `#374151` | same (cards are objects) |

### Look (15 Nov 2026, "Card wallet", DC's choice)

The household's cover is a wallet of cards. Mockups of every page:
`/mnt/project-files/ux-design/wallet-pages/` (gallery shared with DC).

- Each kind of cover found for a person is a card on Home: the kind's
  fixed colour (`--card-*`, the same on every page, so navy always means
  hospital), a gold chip, the kind's icon in a ring, the amount large,
  and where it comes from in a monospaced line like a card number.
- Cover on file but not confirmed is an empty dashed slot, never a
  coloured card. Kinds not found sit in one dashed line under the cards.
- The page is cool grey; panels are white with an 18px radius. Buttons
  are near-black squared keys (12px); the menu and the people switch are
  segmented bars where the chosen item is the white key.
- Drawn cards elsewhere: the sign-in form is a member card (navy face,
  chip, magnetic stripe), the landing page holds a fanned hand of cards,
  a missing page is a grey card stamped DECLINED, an answer's figure is
  printed on a dark card face. Drawn cards never show a household's
  figure unless it is the household's own card on Home or in an answer.
- A member's colour (`data-person` 0–3) is identity only: their initial
  and the band across the top of their card on Account settings.

### Earlier look (15 Nov 2026, "family colours")

The old cream ground with brown and orange fills was the most common look
of generated pages in 2025–26. Now: a white page, soft grey cards with
large radii (10/14/20px), pill buttons, a top menu bar on computers (the
bottom bar stays on phones), and **one colour per family member**.

- A member's colour comes from their place in the household
  (`data-person` 0–3, repeating) and is used only for identity: their
  avatar, their pill on Home, their card on Account settings.
- Person colours are never green, red, amber or slate, so status colours
  keep their meaning. A status is never shown in a person's colour.
- Surfaces are told apart by tone, not lines or shadows (`--edge` is
  transparent); tables and inputs keep their lines. No icon in a tinted
  square beside a heading, no small uppercase labels.

Contrast is checked by the test, not by eye: text 4.5:1; dots, the
unresolved dashed edge and input borders 3:1; in both themes. Decorative
card borders between siblings are not status cues and are not held to 3:1.

## Type

One family, Sora, served from the site by `next/font` and set as
`--font-face` on the page; JetBrains Mono (`--font-mono`) only for the
number line on a card; the system UI stack in `--font` is the
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
- It sits on the white page. In dark mode it keeps a cream
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
