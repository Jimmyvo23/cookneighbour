# Handoff: T-060 Refuse bidi/zero-width text and fold look-alikes

From: backend  To: tester

## What changed
- Branch: `feature/T-060-public-text-fold`. Pull request: see the PR for branch (title "T-060: Refuse bidi/zero-width text and fold look-alikes", Closes #73).
- New `src/lib/domain/text-fold.ts`: `hasInvisibleText`, `foldText`, `foldForContact`. One module for browser and server.
- `src/lib/domain/text-safety.ts`: `hasUnsafeText` now also refuses bidi controls (U+202A-202E, U+2066-2069) and zero-width characters (U+200B-200D, U+2060, U+FEFF). Every text field already goes through this one helper, so all of them are covered with the same 422 and message ("Remove control or invalid characters.") on the field's own key.
- `src/lib/domain/address.ts`: `normalizeAddressLine` folds first (NFKC, accents/tones off, invisible off, d-with-stroke to d) and keeps letters, marks and digits of any script (`\p{L}\p{M}\p{N}`).
- `src/lib/domain/contactDetails.ts`: `findContactDetails` folds first (also look-alike dashes to "-").
- Tests: new `src/lib/domain/text-fold.test.ts` (incl. client/server agreement over the same cases); `edge-cases-t051.test.ts` `it.fails` flipped to `it`; `tests/api/auth.test.ts` (new 422 test; the old emoji name with a joiner replaced); `src/lib/api/validate.test.ts` (joined emoji replaced by a single emoji).
- Docs: `docs/api-contract.md` (v1.19, section 1 bullet), `docs/domain-rules.md`, `docs/edge-case-matrix.md`, `PLAN.md` (A-2).

## How to verify
- `npm run lint && npm run typecheck && npm test && npx prettier --check .` all clean locally (2425 passed, 3 expected fail that existed before).
- API test `tests/api/auth.test.ts` runs in CI only.

## Known gaps or risks
- "Public" fields = everything going through `hasUnsafeText`: display name, address line/city, chef bio/cuisines/languages/kitchen address, dish text, intake notes, chat, review comments, report description, admin reasons/notes, decline/cancel/change reasons, shopping-list notes, search text filters.
- U+200D (joiner) is refused as Jimmy listed, which also refuses joined emoji (woman cook) and breaks Persian/Indic text that uses U+200C/U+200D. Question for Jimmy.
- A leading or trailing U+FEFF is removed by `.trim()` before the check (JS trim strips it), so it is stored trimmed, not refused. Other invisible characters at the edges are refused.
- Hash change: ASCII-only addresses keep the identical key (pinned test `100 fictional st unit 5|L5B1A1`). Stored addresses with accents, full-width or non-Latin characters would hash differently if saved again. No migration (the stored hash is not recomputed); an existing accented address could therefore get one extra free trial until it is re-saved. Seed addresses are ASCII (not verified for every seed row).
- đ/Đ is mapped to d/D (no NFD decomposition); Vietnamese tones and other accents are stripped, so "Đường" and "Duong" are the same key.
- Accents are stripped only for U+0300-036F; marks of other scripts (Hindi vowel signs, Arabic) are kept.
- En-dash (and U+2010-2015, U+2212) phone separators are now caught by the contact filter via the fold.
- Not folded: homoglyphs (Cyrillic a vs Latin a).

## What the next agent needs
Edge cases to try: each invisible character in each field through the real routes; full-width phone in chat while `requested`; two Chinese/Arabic/Vietnamese street lines give different keys; "Édouard" vs "Edouard" same free-trial address.
