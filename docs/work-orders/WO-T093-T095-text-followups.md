# Work Order WO-T093-T095: Invisible-only text and T-060 follow-ups

Tasks: T-093 and T-095 (backend). Branch `feature/T-093-text-followups`, worktree `../CookNeighbour-wt-T093`, based on `main` at `c5d172d` (T-060 merged).

Runs beside WO-T094-T092 (frontend, separate files) during Jimmy's 1-hour parallel window (2026-10-21).

| Agent | Task | Plan (100 words or fewer) | Effort (S/M/L) | Risk |
|---|---|---|---|---|
| backend | T-093 + T-095 | Test first. T-093: refuse values with no visible character (after `foldText` and trim) on the fields Jimmy chooses, with a clear error text, server and browser checks, contract update. T-095: fold before lowercasing in `addressKey` (`address.ts:38`, "ℌigh Street 5" = "High Street 5"); run `hasUnsafeText` in the browser `validateAddress` (`validation/auth.ts:74`); write the invisible-character regex classes in `text-fold.ts` as `\u` escapes; tidy the empty branch in `admin-chefs.ts:305-307`. Keep `.ts` import extensions for files the seed script loads. No migration. | M | Refusing too much (joined emoji, Persian/Indic text must still pass, D-132) |
| tester | T-093 + T-095 checks | Joiner-only, space-only and invisible-only values refused on the chosen fields; joined emoji, ZWNJ Persian, Vietnamese, CJK still accepted; address key equal for look-alike letters; browser and server give the same answer. | M | Low |
| reviewer | T-093 + T-095 review | No non-Latin script refused, honest error texts, contract matches code, no hash change without a recorded decision. | S | Low |

## Rules it builds on
D-125, D-132 to D-136, T-060 Reviewer comment 6319588585.

## Known limit
`addressKey` changes for addresses with look-alike letters (for example "ℌ"); old stored keys stay as they are until re-saved (same as D-135).

## Decision
Decide ids `WO-T093-backend`, `WO-T093-tester`, `WO-T093-reviewer`.
