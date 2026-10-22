# Handoff: T-108 Tester

From: tester  To: reviewer

## Result: PASS with one MEDIUM finding (e2e-mock 25 min headroom) and one LOW (silent empty version)

## Checked
- Diff is only `.github/workflows/ci.yml` plus the backend handoff. `ci` gate job unchanged (needs all three, `if: always()`, fails on any non-success incl. cancelled). Actions pinned to majors (`actions/cache@v4`). No secrets, no paid features.
- Cache key `playwright-${{ runner.os }}-<locked version>` from package-lock.json (1.63.0 locally). Run 39824714826 log: "Cache hit for: playwright-Linux-1.63.0"; hit path ran `install-deps` only (supabase 13s, e2e-mock 515s apt), Chromium launched, tests passed. Post step: "Cache hit ... not saving cache". A version bump changes the key, so a miss and full `install --with-deps` runs.
- Run 39817506333 attempt 1: miss path (full install, 1m18s) passed.

## Findings
1. MEDIUM - e2e-mock stays at 25 min but has little headroom. Today's e2e-mock durations (successful runs, ~35): typical 10-14 min; but 22m28s (39785235773), 22m25s (39823076748), 21m55s (39787845436), 19m57s (39824714826), 19m50s (39791680271). That is 3 runs within 3 min of the limit. Cause is the apt step: 651s (39823076748), 515s (39824714826). The cache does not help apt. A slow-apt run plus a 11-12 min test step (668s-745s) is about 22-23 min; 25 min would fail on a slightly worse mirror. Recommend raising e2e-mock to 35 as well (same reason as supabase). Not edited by me.
2. LOW - "Read Playwright version" uses `echo "version=$(node -p ...)"`. If the lockfile path is missing, node fails inside the substitution but echo still succeeds (reproduced locally: rc=0, `version=` empty). Key becomes `playwright-Linux-`; a stale cache could then hit with the wrong browser and install-deps only, so Chromium would be missing and the tests fail (loud, not silent, but confusing). Suggest capturing into a variable first (`v=$(node -p ...)` then `test -n "$v"`), or a fallback that always runs the full install. Fail-safe is not guaranteed today.
3. INFO - supabase also fine at 35: max today 25m18s cancelled at the old 25 limit; recent successful 14-25 min.

## Checks (gh pr checks 210 at e16d743)
checks pass 2m41s; ci pass 4s; e2e-mock pass 19m57s; supabase pass 14m31s.
