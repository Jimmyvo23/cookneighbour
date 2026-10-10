# T-061 Reviewer handoff (PR #93, head 6b52233)

Written by the Planner from the Reviewer's report.

Verdict: APPROVE. CI passed (run 38092627514). Lint, typecheck and unit tests pass locally (1264 passed, 3 expected fail).

Checked and holding:
- Grants are service_role only, functions are SECURITY INVOKER, and search_path is empty.
- The migration is create-or-replace only. The T-035 migration is untouched, and the drift guard is meaningful.
- The kitchen-review 409 reads the locked row with no race and writes nothing on refusal.
- Reject turns chef's home off in the same update.
- The admin list has no private data.
- The D-25 404 matches an unknown id.
- The contract v1.3.1 matches the code.
- The allergy map has no under-warning regression.
- Scope stays within D-21, D-24, D-25 and D-30.

Findings (none block the merge):
1. LOW: the gluten group has only gluten and wheat (`src/lib/domain/allergy.ts:57`). Missing: barley, rye, oat, triticale, spelt, kamut, celiac, coeliac. This goes to Jimmy.
2. INFO: bare "macadamia", "brazil" and "soybean" are missing (`allergy.ts:62-72`). "Macadamia nuts" already matches through "nut".
3. INFO: mock-admin parity (409 and reject side effect) belongs to T-062.
4. INFO: the drift guard strips `--` even inside quoted text. Harmless today.

Coconut and buckwheat not matching fit Health Canada's lists. No question for Jimmy.
