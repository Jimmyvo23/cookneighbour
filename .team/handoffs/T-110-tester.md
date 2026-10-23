# T-110 handoff (tester)

Result: PASS (no HIGH). Not committed, per instructions.

Evidence
- Diff origin/main...HEAD: only .github/workflows/ci.yml and .team/handoffs/T-110-backend.md. (Plain `git diff origin/main` also shows PLAN.md only because the branch is behind main by 2 note commits.)
- Test commands unchanged: test:e2e, test:e2e:mock, RLS and API route steps untouched. HASH_PEPPER stays in playwright.config.ts (webServer.env), so it is not needed in docker env. Container env passes API_URL, ANON_KEY, SERVICE_ROLE_KEY, PUBLISHABLE_KEY, SECRET_KEY by name plus CI=true (html reporter and retries still active).
- Counts, runs a35615f (39882767635) and bdc8982 (39884526462) vs T-108 main run 39830636827: e2e-mock 376/376 both; supabase real e2e 47/47, RLS 467, API 876; checks 3189 (main 3177, +T-109 tests). No flaky, no skips, no 0 tests. The 24 "[WebServer] ... instant" log errors are identical in the T-108 run (pre-existing).
- PR #215 `gh pr checks`: checks, e2e-mock, supabase, ci all pass on head bdc8982 (ci gate itself pass, 2s).
- Version guard: package-lock @playwright/test = 1.63.0; both tag copies are v1.63.0-noble. Ran the case snippet locally: v1.62.0, v1.6.0, v11.63.0, and a tag with no -noble suffix all fail (exit 1); correct tag passes. Match line is logged in both jobs.
- Failure path (reasoned): step shell is bash -e; `docker run` returns the container exit code, so a failing Playwright test fails the step, the job, and the unchanged `ci` gate (needs results must all be success). Not run live (would need a pushed failing commit).
- Artifacts: upload steps unchanged (if: failure()). Container runs as the runner uid (-u id:gid in supabase, --user 1001 in e2e-mock) so playwright-report/ and test-results* are writable and uploadable. Only observed on green runs, so the upload itself was not exercised.
- Secrets: the docker step logs only variable names (-e API_URL ...). The sb_publishable/sb_secret values appear in the pre-existing `supabase start` output (local defaults, same as before).

Findings
- LOW ci.yml:144 vs :26: the guard compares only the env copy (PLAYWRIGHT_IMAGE) with package-lock. e2e-mock's actual container.image is never compared, so if someone edits only the env value the guard passes while e2e-mock still runs the old image. Playwright would likely fail loudly on a browser-version mismatch, so risk is small. Suggest a follow-up that also greps container.image, or accept as is (comment on lines 25 and 143 already says change both).
- NIT: guard step runs after npm ci / seeding, so a mismatch is reported late (supabase job: after ~15 min). Moving it earlier would fail faster.
- NIT: builder choices (noble pin, setup-node Node 24 inside container, non-root user) remain unconfirmed by Jimmy, as the backend handoff states.
