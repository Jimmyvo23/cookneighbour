# Handoff: T-060 Refuse bidi/zero-width text and fold look-alikes (Tester)

From: tester  To: reviewer

## What changed
- Branch: `feature/T-060-public-text-fold`. Pull request: #189.
- Added `src/lib/domain/text-fold-tester.test.ts` (314 tests; test file only, no app code touched).

## Verdict: PASS with findings (no blocker)

## How to verify
- `npm run lint`, `npm run typecheck`, `npx prettier --check .` clean. `npm test`: 2739 passed, 3 expected fail (same 3 as before; the T51 `it.fails` for B1/Q-T51-1/Q-T51-2 are flipped to `it` and pass).
- Seed under plain Node: `node --input-type=module -e "await import('./scripts/seed-lib.ts')"` and `addressKey` import work (the `.ts` import extensions fix holds).
- API test `tests/api/auth.test.ts` runs in CI only (no Docker locally).

## Checked and OK
- 14 characters (U+202A-202E, U+2066-2069, U+200B-200D, U+2060, U+FEFF) refused mid-text in 16 field families through the real parsers: dish name/cuisine/description/allergens, chef bio/cuisines/languages, intake notes, cancel reason, receipt dispute note, report description, admin decision note, admin reason, kitchen review note, search cuisine, decline reason, booking address line/city. Each names its field (clean-text control cases pass, so the harness is not vacuous). Client and server agree (builder's test plus mine).
- ASCII address keys identical to main's normalizer for 15 ASCII inputs (copy of main's function used as reference). Accent, full-width, BOM and combining-mark variants give the same key as the plain form.
- Non-Latin keys (Chinese, Arabic, Hindi, Thai, Korean, Japanese, Cyrillic) are non-empty and distinct. Hindi/Thai/Arabic marks, Japanese dakuten and Hangul survive the fold. Vietnamese tones stripped, d with stroke mapped.
- Contact filter catches full-width digits, en/em-dash and minus separators, zero-width inside digits, full-width `@`, and a phone beside non-Latin text. T-088 rule intact: "order 20261031", "order １２３４５", dates (also with en-dash or zero-width), 12 digits, 7-digit numbers, prices all pass.
- Contract v1.19 text matches the code, except finding F2.

## Findings
- F1 (low, characterisation, pending Jimmy): U+200D/U+200C refuse joined emoji (woman cook), Persian text with ZWNJ (می‌خواهم) and Hindi conjuncts with ZWJ. Same text without the joiner passes. Single and skin-tone emoji and U+FE0F pass.
- F2 (low, doc/code mismatch): the contract says the same 422 message everywhere. Actual wording differs: bio "Use plain text. Control characters are not allowed."; chef kitchen address line/city "Enter 1 to 120 characters." (older wording; still 422 on the field). Fix the contract wording or unify messages.
- F3 (low): edge U+FEFF is trimmed away in most fields, but the chef bio checks before trimming, so a leading/trailing BOM is refused there. Inconsistent, harmless.
- F4 (low): admin `reviewedAddress.line/city` (kitchen review) are not checked for invisible text. Admin-only input, compared against the chef's address, so little risk.
- F5 (info, known limit): invisible characters not in Jimmy's list pass: U+200E/200F (LRM/RLM), U+00AD, U+180E, U+2061, U+3164. Cyrillic look-alikes not folded. Vietnamese tone-only differences ("Mã"/"Ma") collide in the address key (by design of D-125).
- F6 (medium-low, builder-noted): existing stored accented/full-width/non-Latin addresses keep their old hash until re-saved, so a customer could get one more free trial at such an address. Seed addresses are ASCII per the builder (not verified for every row). Planner decision whether to recompute hashes.

## What the next agent needs
- The tests I added include characterisation tests of F1, F3, F4, F5, F2 so a deliberate change shows up as a failing test to update.

## Round 1 re-check (head 9dd1ffb plus my added tests)
Verdict: PASS with one low finding.
- Backend's edits to my tests are honest: joiners removed from the refused CHARS list (and a new test proves every family accepts U+200C/U+200D), F1 expectations flipped as Jimmy decided, F3 bio test now checks trim behaviour, F4 and F2 characterisations replaced by real assertions (every refused char on `reviewedAddress.line`/`.city`; standard message for bio and kitchen address, length errors keep theirs). Nothing else weakened: the refused set, 16-family refusal loop, ASCII-key reference, non-Latin and T-088 tests are unchanged.
- Code verified: refused set = U+202A-202E, U+2066-2069, U+200B, U+2060, U+FEFF (mid-text); joiners allowed in public text and still stripped by `foldText`, `addressKey`, `normalizeAddressLine` and `findContactDetails` (new tests, including non-Latin lines). Edge/mid U+FEFF: bio now trims first (edge BOM trimmed, mid-text refused with the standard message).
- Contract v1.20 matches the code: standard message everywhere except dish `description` and the browser display-name check (both verified by grep and tests); kitchen-address length errors keep their own wording; `reviewedAddress.line/city` keys exist.
- F7 (low, new, characterisation): a name made only of a joiner (e.g. dish name "‍") is accepted and looks blank. Consequence of allowing joiners; could be refused as "no visible character" if Jimmy wants.
- F5 and F6 unchanged (known limits, no migration per Jimmy).
- Added 16 tests in `src/lib/domain/text-fold-tester.test.ts` (wording by family, joiner stripping everywhere, FEFF edge/mid, F7).
