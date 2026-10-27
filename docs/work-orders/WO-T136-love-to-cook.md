# Work Order WO-T136: "I love to cook" for logged-in users

Task: T-136 (frontend). Branch `feature/T-136-love-to-cook`, worktree `../CookNeighbour-wt-T136`.

Bug (Jimmy 2026-10-27, live site): logged in, he clicked "I love to cook" on the home page and landed back on the home page. Cause: the link goes to `/signup`, and `redirectFor` (`src/lib/auth/route-guard.ts`) sends any signed-in user on `/signup` home. The bounce rule is correct; the link is wrong for signed-in users.

D-209 (Jimmy 2026-10-27, asked "When someone is logged in, what should 'I love to cook' do?"): "Depends on role (Recommended)". Signed out: `/signup`. Chef: `/chef/apply` (there is no `/chef` page; `/chef/apply` is where `landingPath` sends a chef). Customer and admin: link hidden. WO approved: "Approve (Recommended)".

| Agent | Task | Plan (100 words or fewer) | Effort | Risk |
|---|---|---|---|---|
| frontend | T-136 | Test first. Small client component for the "I love to cook" link: signed out `/signup`, chef `/chef/apply`, customer and admin render nothing. Read the session the same way `AccountBar.tsx` does (`/api/me`); while loading or on error, show the signed-out link. Home page stays a Server Component. The `/signup` bounce rule stays. Keep the T-126 e2e-mock spec green. | S | Hydration flash; keyboard order |
| tester | T-136 checks | Unit tests for signed out, chef, customer, admin, loading and error. Bite test. e2e-mock home spec green. | S | Low |
| reviewer | T-136 review | Four cases correct, nothing private shown, Tab order kept, no new design. | S | Low |
