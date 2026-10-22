# Handoff: T-097 Exact invisible-text wording and one display-name message

From: backend  To: tester

## What changed
- Branch: `feature/T-097-text-wording`
- Pull request: see PR "T-097: Exact invisible-text wording and one display-name message"
- Files: `docs/api-contract.md` (v1.22: exact no-visible-character statement, known limits U+3164, U+00AD, U+200E/F, U+2061, U+180E per D-146, browser display-name message now standard), `src/lib/validation/auth.ts` (`displayNameProblem` unsafe message is "Remove control or invalid characters."), `src/lib/validation/auth.test.ts` (pins the new text exactly).
- No refusal rule changed. The dish `description` keeps "Use plain text. Control characters are not allowed." (server, unchanged).

## How to verify
`npm run lint`, `npm run typecheck`, `npx prettier --check .`, `npx vitest run` (2978 passed, 3 expected fail, as before).

## Known gaps or risks
None. Sign-up form and chef page use `displayNameProblem`, so both show the new text.

## What the next agent needs
Builder choices, unconfirmed by Jimmy: (1) contract wording for the exact rule and the limits list; (2) the browser display-name message is the server standard, not the dish-description one.

## Round 1 (Reviewer REQUEST CHANGES, comment 6325132116)
- Contract section 1: states the real check order (length, unsafe, no-visible) and the message per case (spaces-only or U+FEFF-only: length message; U+200B, U+2060, bidi-only: unsafe message; joiners, accents, spacing accents: no-visible message). Names the NFKC spacing accents (U+00B4 and the rest, 34 characters outside U+0300-036F) as refused.
- `hasNoVisibleText` JSDoc updated. No rule change.
- Pins added to `src/lib/domain/text-fold-t097.test.ts`: U+00B4 alone gives the no-visible message; U+200B alone gives the unsafe message.
- Builder choice unconfirmed: the contract describes the 34 characters by rule and examples, not a full list.

## Round 2 (Reviewer REQUEST CHANGES, comment 6325617740)
- Contract section 1: the first sentence of the no-visible-character paragraph is restored with its own ending and field list; the order and message per case is a separate sentence after it; the repeated "only spaces keeps the length message" sentence is removed. The spacing-accent count is corrected to 34 (here and in the contract). Docs only, no code or test change.
