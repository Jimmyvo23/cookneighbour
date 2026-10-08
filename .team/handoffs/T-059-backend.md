# Handoff: T-059 Reject unsafe text in the display name

From: backend  To: tester

## What changed
- Branch: `feature/T-059-display-name-validation`
- Pull request: #72 (Closes #71)
- Files: `src/lib/domain/text-safety.ts` (new; `hasUnsafeText` moved here, re-exported from `chef-application.ts`, callers unchanged), `src/lib/api/validate.ts` (new `Fields.text`), `src/app/api/me/route.ts` and `src/app/api/auth/signup/route.ts` (use `f.text` for displayName), `docs/api-contract.md` (sign-up and PATCH /api/me 422 wording), tests: `src/lib/api/validate.test.ts` (new), `tests/api/auth.test.ts`.
- Error: 422 VALIDATION_FAILED, `fields.displayName = "Remove control or invalid characters."`. Rule: control chars (incl. tab, newline, NUL, DEL) and lone surrogates. Nothing is written on failure.

## How to verify
- `npm test` (unit, 174 pass), lint, `prettier --check .`, `npm run build` all clean.
- API tests (`npm run test:api`, needs Supabase/Docker; CI only): new cases in `tests/api/auth.test.ts` for signup and PATCH /api/me; "Nguyễn Thị Mai" accepted.

## Known gaps or risks
Other free text not covered (listed, not fixed):
- `PUT /api/me/address`: `line` and `city` use `Fields.string` with no unsafe-text rule (stored raw in `profile_private`). Fix is a one-word change to `f.text`.
- `POST /api/auth/signup` `email`: `isEmail` allows NUL/control characters (Supabase Auth likely rejects; not verified).
- `POST /api/auth/login` `email`: not stored, low risk.
- `tsc --noEmit` shows `LayoutProps` not found in `src/app/layout.tsx` until `next build` generates types; pre-existing.

## What the next agent needs
`Fields.string` is unchanged on purpose; use `Fields.text` for any stored free text.
