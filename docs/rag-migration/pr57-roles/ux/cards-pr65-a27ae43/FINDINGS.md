# Short-answer cards on PR #65 at head a27ae43

Method: a real browser on the local app at `a27ae43` with the **synthetic** `fracture` household. I ran scenario FX-K4B
("grace fell down and broke her arm"), then used `cards.mjs` to add the hand-written fixture
`scripts/fixtures/ux/answer-cards-fr1.json` (bottomLine and statements) to that answer when it loads. The server doesn't
send these fields yet, so this is the designer's layout on fixture data, not a real answer. Checked on desktop
(1366x900) and phone (390x844, touch), with no paid calls. Screenshots are in `shots/`.

## Verdicts

| Question | Verdict | Why |
|---|---|---|
| Is the bottom line clear? | **Mostly.** | "Grace may be able to claim a fracture benefit for her arm. Her two documents print different amounts, and they are not added together." It's plain and honest, but it gives no amount range and no next step. |
| Are the cards scannable? | **Yes, with one risk.** | A big figure, the benefit, its basis and its conditions sit on one card, and that reads well on both sizes. Risk: the two cards, both headed "FOR GRACE", look like two things Grace gets. The "either/or" is only in the bottom line and in a line *after* both cards. |
| Is "Where this comes from" easy to find? | **No.** | It's a small text toggle at the very end, after "Also in this answer". On desktop it's below the first screen (y≈950), and on a phone it's about 1.8 screens down (y≈1530). The chips on each card ("Product Summary · p.13") look like buttons but can't be tapped (`<span>`, `components/answer-cards.tsx:70`). |
| Is the total length right? | **No: longer than before.** | The answer is 1,037 px tall on desktop with cards versus 619 px as prose only, and 1,626 px on a phone (about 2.3 screens). The growth comes from "Also in this answer", which repeats five paragraphs already covered by the bottom line and the cards, and from the yellow notes, which repeat what "Where this comes from" says. |

## Top issues (ranked)

1. **Longer, not shorter (major).** Drop "Also in this answer" items that the bottom line, cards or notes already say. In this
   fixture that's all five. Show any leftovers inside "Where this comes from".
2. **Sources look tappable but aren't, and the real link is buried (major).** Make each card's document chip open
   "Where this comes from" at that card's quote (or the document). Move "Where this comes from" directly under the cards.
3. **Alternatives can read as a total (major; the worst bug class is a wrong claimable amount).** Put "Either / or: the
   insurer decides which applies" *between* the two cards (an "or" divider), not after them.
4. **No figures or next step in the bottom line (minor).** For example: "Grace may get S$1,250 or up to S$120,000 for her arm,
   depending on which document applies. Ask the insurer which one." That depends on the server's `bottomLine`.
5. **Small wording and visual issues (minor).** "illustration" next to each figure is jargon ("example amount" or "estimate
   from your documents"). The "As printed 6 Oct 2022" chip doesn't say what it means. Three yellow boxes in one answer
   read as three warnings.

What works: the figure, basis and limits stay together on one card. The uncertainty is said in one plain line. The
footer says once that these are illustrations and not a payment.
