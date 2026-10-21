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
