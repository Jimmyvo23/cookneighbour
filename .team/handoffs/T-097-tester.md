# Handoff: T-097 Exact invisible-text wording and one display-name message (Tester)

From: tester  To: reviewer

## Verdict
PASS. No bugs found.

## What I checked
- Contract v1.22 matches `src/lib/domain/text-fold.ts`: `hasNoVisibleText` is `foldText(text).trim() === ""`; the fold removes U+200C/U+200D, the T-060 refused characters (U+202A-202E, U+2066-2069, U+200B, U+2060, U+FEFF) and U+0300-036F. The file path in the contract is correct.
- The six listed limits (U+3164, U+00AD, U+200E, U+200F, U+2061, U+180E) are accepted on a display name (browser `displayNameProblem`, `validateSignUp`) and an address line (server `parseBookingBody`). Pinned now.
- Accent-only, joiner-only, ZWSP, BOM, word joiner and bidi-only values are refused with the standard message; accented letters and Vietnamese or Chinese names pass.
- Browser display-name message "Remove control or invalid characters." equals the server message (`validate.ts`, `form.ts`). Sign-up uses `validateSignUp` (AuthForms.tsx) and the chef page uses `displayNameProblem` (ChefApplicationView.tsx), so both show it. No component tests exist for these two screens; verified by code reading and the unit tests.
- grep: no UI text or test still expects the old browser text. The remaining "Use plain text. Control characters are not allowed." is the dish description (server, unchanged, pinned in text-fold-tester.test.ts).
- No refusal rule changed (diff touches only the message string).

## Tests added
`src/lib/domain/text-fold-t097.test.ts` (31 tests).

## Results
lint, prettier, typecheck clean. `npx vitest run`: 3009 passed, 3 expected fail, 125 files.

## Notes
The builder did not run the new test against old code; the exact-message assertions in `auth.test.ts` necessarily fail on the old string, so the change is covered.
