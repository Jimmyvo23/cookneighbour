APPROVE (Reviewer re-review, T-071 frontend part, head 9443a74)

Scope: frontend files only, compared with my earlier APPROVE on e9880ef. Changes since then: d1cb6e9 (round 2), the 2069322 Backend merge plus the mock's `picked_up`, 8b1c476 (Tester), and 9443a74 (round 4).

Checks I ran on 9443a74: lint, typecheck and prettier are clean. `npm test` gives 88 files, 2088 passed + 3 expected fail. `npm run test:e2e:mock -- e2e-mock/t071` gives 11 passed. GitHub `ci` is SUCCESS on 9443a74.

Earlier findings
- LOW-1 (record disappears after completion): fixed. Both sections now also render when any day has `pickedUpAt` (src/components/booking/PickupSections.tsx:113-115, :434-435). New tests cover the completed + confirmed + no proposals case, plus a control (no section when nothing is confirmed), for customer and chef.
- LOW-2 (no reload after a stale 409): moved to a follow-up task by the Planner. Not a blocker.
- NIT intros: fixed (:133, :453). The wording is honest: "press the button for that day to tell the chef you picked them up" and "after that you cannot mark that pickup as missed".
- NIT `void` comment: fixed (src/lib/api/types.ts:656).
- NIT mock respondedAt: fixed (`p.respondedAt ?? now`, src/lib/mocks/mock-booking-changes.ts:819), now matching the server's `coalesce`.
- NIT unused seed option: removed. `pickedUpAt: null` is set in seedRow, and the `pickedUpSeeded` hook still marks cooked days.
- INFO (Backend propose on a confirmed day): Backend added 409 `picked_up` (migration :250-254, contract v1.12 propose row, `CHANGE_REFUSALS.picked_up`).

New changes
- The mock propose check order now matches the server SQL: day_not_cooked, picked_up, deadline_passed, proposal_open / pickup_agreed, then the 422 time checks (mock-booking-changes.ts:718-726). Moving deadline_passed ahead of proposal_open is correct: the server checks it first. Mock tests cover 409 `picked_up` with no write, and a confirmed day past its deadline answering `picked_up`.
- Tests compare the error text to `CHANGE_REFUSALS.pickup_confirmed` instead of copying the words (src/lib/booking/changes.test.ts:182-184), so Backend's rewording in #145 (4de0ac0) won't break them.
- The `picked_up` text ("You already confirmed that you picked up these meals.") is honest. The UI can't normally reach it because the form is hidden on a confirmed day. It only shows on a stale page.

New findings: none.

Verdict: APPROVE. Merge order stays as agreed: #145 first, then bring #146 up to date from main and wait for ci to be green.

