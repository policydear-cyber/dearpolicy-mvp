# CLAUDE.md

Guidance for Claude Code sessions working in this repository.

## Design and UX work

Interface design skills live in `.claude/skills/` (see `.claude/skills/INTERFACES-README.md`).

- Review a screen, flow or the whole interface with `better-interface`. It routes to
  `better-accessibility`, `better-layout`, `better-writing`, `better-typography`, `better-colors`
  and `better-ui`.
- Review a branch or pull request that changes the interface with `interface-review`.
- `variant`, `break`, `state-machine` and `explain-interface` are run only when asked. Their
  throwaway pages never land in a pull request.

DearPolicy's own rules come first. Where a skill's advice differs, these win:

- **Brand:** `docs/brand.md` and the tokens at the top of `app/globals.css`. Never add a colour
  literal or recolour a role; `npm run brand:tokens-test` guards this.
- **Copy:** `docs/copy.md` is the voice, vocabulary and message patterns.
- **The user:** judge every screen as a household new to DearPolicy, with any insurer and any
  document, including empty, partial and unreadable states. Never design only for the owner's
  own documents.
- **Accuracy:** a design must never show an amount, a "covered" or "not covered" verdict, or a
  currency that the server has not resolved from the document.
- Cosmetic restyles wait for the owner's decision; findings are reported, not shipped unasked.
