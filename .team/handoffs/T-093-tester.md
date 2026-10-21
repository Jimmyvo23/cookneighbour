# Handoff: T-093 + T-095 Invisible-only names and addresses, T-060 follow-ups

From: tester  To: reviewer

Result: PASS (no bugs found; two informational notes).

## What changed
- Branch: `feature/T-093-text-followups`
- Pull request: #192
- Files: added `src/lib/domain/text-visible-tester.test.ts` (34 tests). No app code touched.

## How to verify
- `npx vitest run` : 123 files, 2971 pass, 3 expected fail (existing). `npm run lint` clean. `npx prettier --check .` clean.
- `node --experimental-strip-types -e "import('./src/lib/domain/hash.ts')"` loads (seed-script import check OK).

Checked and passing:
- Joiner-only, ZWNJ-only, mixed invisible-only (ZWJ+ZWSP, ZWJ+word joiner, ZWNJ+BOM, bidi+ZWJ, spaces+ideographic space+joiners, lone combining marks) refused on display name, own address line/city, dish name, kitchen address; server (`Fields.visibleText`, parsers) and browser (`displayNameProblem`, `validateAddress`) both refuse. Booking address and admin reviewedAddress covered by the builder's tests.
- Accepted: Vietnamese, CJK, Hangul, Arabic, Persian with ZWNJ, Devanagari (with ZWJ), Thai, Hebrew, Greek, Cyrillic, joined emoji (family, skin-tone chef, rainbow flag).
- Scope: bio, chat message, review comment (server and browser form), report description (server and browser form) still accept joiner-only text.
- addressKey: "ℌigh", fullwidth "Ｈ", math bold "𝐇" and an embedded ZWJ equal "High Street 5"; ASCII keys unchanged ("123 main st unit 5|L5B1A1", "45 queen st w|L5B1A1"); non-Latin lines never give an empty key.
- Error texts: joiner-only gives "Enter at least one visible character."; spaces-only and over-long values keep "Enter 1 to N characters."
- Contract v1.21 (status line and section 1 paragraph) matches the code: fields, message, spaces-only behaviour, scope exclusions, addressKey, browser hasUnsafeText.

## Known gaps or risks
- Info 1: a value of only combining accents (for example U+0301) is refused as "no visible character", because the fold strips accents. Harmless and arguably correct; not in the contract wording ("other invisible characters").
- Info 2: the browser display-name unsafe message ("Use plain text. Control characters are not allowed.") differs from the server's "Remove control or invalid characters." This is older behaviour, not part of T-093; the address and booking browser messages do match the server. Refusal itself is the same.
- API and RLS route tests (sign-up, PATCH /api/me, PUT /api/me/address) run only in CI; the local checks cover the shared parsers and `Fields.visibleText` the routes call.

## What the next agent needs
Builder choices checked as behaving as described: rule on booking address, admin reviewedAddress and browser booking form; message text; `Fields.visibleText`; spaces-only keeps the length message. Not judged as product rules.
