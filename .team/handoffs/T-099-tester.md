# Handoff: T-099 Hosted seed demo passwords (Tester)

From: tester  To: reviewer

## Verdict
PASS. One LOW finding, no blockers.

## What I checked
- `--hosted` has no path to the constants: `resolveDemoPasswords` throws for missing, empty, short (<12) or repo-default values, for each variable separately (partial env tested at process level with a dead URL, exit 1 before any network call). Whitespace-only is the exception (see below).
- `--verify` returns before passwords are resolved and creates no users, so it uses no password.
- No target: usage printed, exit 0; both targets: exit 1. Unchanged.
- `--local` returns the constants and ignores the env variables (unit test). CI seeds with `--local`.
- Output: errors name the variable only; seed.ts `console`/`die` calls never interpolate a password; `main().catch` prints the message only (no stack).
- `.env.example` names both variables with empty values; README names both and is accurate.
- Nothing was run against hosted; `.env.local` not read.

## Findings
- LOW: a value of 12 or more spaces (or " " + the default, or "aaaaaaaaaaaa") passes validation, so a hosted account could get a trivially weak password. Confirmed: 12 spaces for both variables got past the check and reached the network step (dead URL). Not exploitable by the public defaults; suggest trimming/rejecting whitespace-only and chef == customer if Jimmy cares.
- INFO: the check runs after `createClient` and the HASH_PEPPER check but before any request; fine.

## Tests added
`src/lib/seed-hosted-passwords.test.ts` (12 tests): process-level --hosted refusals, no-target behaviour, source checks that no console/die output uses a password, --verify ordering, docs. Full suite 3022 passed, lint and prettier clean.
