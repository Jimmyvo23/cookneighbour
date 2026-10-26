# T-055 live smoke (logged in), 2026-10-26

Run by the Planner in Jimmy's Chrome (Claude in Chrome) on https://cookneighbour.vercel.app at `main` = `b09359c` (T-126 v2). Jimmy typed every password himself; the Planner never read `.env.local` values.

| # | Check | Evidence | Result |
|---|---|---|---|
| 1 | Home page logged out: map pot to card to chef page | Mississauga pot showed "Pho bo", DEMO and "See Chef Lan". The link went to `/chefs/71fc64d8-6a86-4dd1-a79b-e66c38a96610` (live chef lookup works). | PASS |
| 2 | Estimate as customer1 (not sent) | Wed Oct 28, Ca kho to + Bun cha. Shown: 2 h 45 min; labour $60.50 (2.75 h × $22), then waived by the free first booking; ingredients $50.00; travel $0.00 (about 0 km); platform fee 10% of labour shown as MOCK and not in the total. Payment MOCK block. | PASS |
| 3 | Booking + chat as customer2 | Booking `7dafa77e-0fc5-4088-a2bb-fd957791bc72`, Fri Oct 30, at the customer's home, customer buys, no free trial. Estimate $60.50 + $50.00 + travel $6.30 (10.5 km × $0.60) = $116.80 CAD; platform fee $6.05 MOCK. "Your request was sent. Nothing was charged." Status "Waiting for the chef to answer". Phone shared only after accept. Chat "Smoke test hello" shown. | PASS |
| 4 | Chef side as chef.lan | `/chef/bookings` "Waiting for your answer (1)". Detail shows allergy/dietary answers ("None", "No dish matches the allergies"), address and phone hidden until accept, the customer's message; reply "Chef reply hello" shown. Not accepted or declined. | PASS |
| 5 | Admin | `/admin/chefs` lists 3 pending (Ana, Selam, Wei), each with MOCK ID, food handler, kitchen and police statuses. The Chef Wei review page opens (no uploaded files on seeds). `/admin/free-trial-blocks` opens, "No free-trial blocks yet". Nothing approved or rejected. | PASS |
| 6 | Pending chef hidden (logged out) | `/chefs/cd0dbf9e-52fe-4221-a319-04813e6885d0` (Chef Wei, pending) shows "Chef not found". `GET /api/chefs?city=` for Mississauga, Brampton, Toronto and Vaughan returns only approved "(demo)" chefs. | PASS |

Left on hosted: the customer2 request above (expires on its own Thu Oct 29, 3:30 p.m.) and two chat messages. customer1 has no booking, and their free trial is unused.

Findings (logged as tasks by Jimmy's choice):
- "Use my free first booking" is ticked by default -> T-131 (Jimmy: start unticked).
- After client navigation the page kept old `<main>` regions (3 seen in the accessibility tree; a text reader returned a stale page) -> T-132.
- Chef Lan shows "4.9 out of 5 (14 reviews)" next to "No reviews yet" (LOW-3) -> T-133.
- Seeded pending chefs have no uploaded documents to review -> T-134.
- First smoke findings still open: MED-1 guarded pages HTTP 200 + in-body redirect, LOW-1, LOW-2 (see the earlier T-055 handoffs).
