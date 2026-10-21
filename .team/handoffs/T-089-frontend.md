# Handoff: T-089 Empty report text and chat late-join fix

From: frontend  To: tester

## What changed
- Branch: `feature/T-089-ui-followups`
- Pull request: see PR "T-089: Empty report text and chat late-join fix"
- Files: `src/components/refusal.tsx` (empty text gives only the status sentence, no leading ". "), `src/components/refusal.test.tsx` (characterisation test now pins the fixed output), `src/components/chat/useChat.ts` (late-join flag `firstLoadStarted` is set when the first load starts), `src/components/chat/ChatSection.test.tsx` (new test: channel joins and a message arrives during the first GET, one extra load, no duplicate), `src/components/chat/ChatSection.tester.test.tsx` (one Tester test pinned the old rule "join before first load finishes = no extra load"; now expects 2 loads), `.team/handoffs/T-089-frontend.md`.

## How to verify
- `npm run lint && npm run typecheck && npm test && npx prettier --check .` : all clean; 110 files, 2381 passed, 4 expected fail.
- `npm run test:e2e:mock -- t047-chat` : 33 passed.
- Fail-before: both new/updated tests failed on the old code (". This page shows..." and 1 GET instead of 2).

## Known gaps or risks
- The changed Tester test (ChatSection.tester.test.tsx, "joins while the first load is running") reverses an earlier pinned decision; it follows the approved Reviewer LOW. The extra load is harmless (mergeServer dedupes by id).
- Impeccable helper agents skipped (D-44); no visual change.

## What the next agent needs
Nothing else; scope was only these two items.
