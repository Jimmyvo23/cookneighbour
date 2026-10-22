# Domain rules (T-037)

Pure functions in `src/lib/domain/`, no I/O. Constants live in `config.ts`; every ASSUMPTION is marked there (A-6/Q-8 cancellation, A-8/Q-5 fees and radius, receipt tolerance, max quantity).

| File | Rule |
|---|---|
| `money.ts` | Integer cents; every division rounds half up with integer maths |
| `pricing.ts` | `estimateBooking`: per-day and total time, labour, ingredients, travel (customer's home only, per visit day), platform fee (shown, not collected, not added to the total), free trial waives labour only |
| `visitLimit.ts` | 6-hour soft limit warning per day |
| `bookingValidation.ts` | `validateBooking`: 1-3 days, dates, D-15 window, **day 1 is tomorrow at the earliest (D-27, `DATE_TOO_SOON`)**, availability, double booking (A-9), location rules, service area, dishes, soft limit, intake (blank refused, D-23) and allergy acknowledgement; returns every error code |
| `contactDetails.ts` | T-042 (D-34): best-effort filter for North American phone shapes (T-088: 10 digits, or 11 starting with 1, with spaces, dots, dashes or brackets; shorter runs, dates, prices and 12+ digits in a row pass), emails and URLs (T-060: the text is folded first, so full-width digits, zero-width characters and en-dash separators are caught) in text the other party reads before acceptance (decline reason); street addresses are not detected |
| `text-safety.ts`, `text-fold.ts` | T-060 (D-125): `hasUnsafeText` refuses control characters, lone surrogates, bidi controls, U+200B, U+2060 and U+FEFF (the joiners U+200C and U+200D are allowed; one check for browser and server). `foldText` (NFKC, accents and tones off, invisible characters off, đ to d, other scripts kept) runs before `addressKey` and `findContactDetails` |
| `bookingRequest.ts` | T-042: parses the booking request body (dotted field errors), builds the intake text from the allergen picker plus free text, `requestExpiry` (D-19: earlier of 72 hours and 00:00 Toronto on day 1), `classifyIssues` (hidden chef 404, double booking 409, validation 422) |
| `allergy.ts` | Intake allergies vs dish allergens (cautious match plus a fixed synonym and spelling map, D-24; D-32 adds the gluten grains, celiac/coeliac, bare macadamia, brazil, soybean). `dietary.ts` (search `avoidAllergens`) uses the same function, D-31 |
| `receipt.ts` | Flag when the receipt differs from the estimate by more than max(15%, $5), A-15 |
| `cancellation.ts` | 48 h free cancellation from 00:00 Toronto on day 1; `freeTrialEffect(status, ctx)` hold / consume / release |
| `freeTrial.ts` | `evaluateFreeTrial` (blocked by a held or consumed claim with the same customer, phone hash or address hash; released never blocks) and `transitionFreeTrial` (state machine; asks `freeTrialEffect` what an outcome means) |
| `eatBy.ts` | cook date + shelf-life days |
| `distance.ts` | Haversine between postal-prefix centres (A-1) |

## Free trial (T-038)

Pure rules: `src/lib/domain/freeTrial.ts`. Server functions: `src/lib/server/free-trial.ts` (`checkFreeTrialEligibility`, `holdFreeTrial`, `applyFreeTrialEvent`). Contract notes for T-042: `docs/api-contract.md` section 11A.

- **Eligible** when the customer has a MOCK-verified phone and a valid home address, and no `held` or `consumed` claim has the same customer, the same phone hash or the same address hash. A `released` claim blocks nothing. Hashes are made on the server from the stored phone and address (HMAC with `HASH_PEPPER`); a hash from a client is never used.
- **Hold is atomic.** One INSERT into `free_trial_claims`; the three partial unique indexes (`free_trial_one_per_customer`, `_phone`, `_address`, where `state <> 'released'`) decide the winner, so two parallel holds cannot both succeed. The loser gets 409 `FREE_TRIAL_USED`. No migration was needed.
- **Outcomes (A-16)** come from `freeTrialEffect` and nowhere else: declined and expired release the claim; cancelled and chef no-show release it unless a day was cooked (D-26, D-37); completed and customer no-show consume it; requested and accepted keep it held. Only a `held` claim changes, in one conditional UPDATE (`where booking_id = ? and state = 'held'`). Repeating an outcome is a no-op; the opposite outcome (for example cancelled after completed) is 409 `INVALID_STATE`.
- **Estimate logs the block too (T-103, D-153).** `POST /api/bookings/estimate` with `useFreeTrial: true` writes the same `free_trial_blocks` row when a phone or address match refuses the trial (D-154: the customer's own used or held trial is not logged from the estimate; `POST /api/bookings` still logs every rule), so the admin sees a same-address second account before it ever sends a booking. Dedupe is the existing SQL function `record_free_trial_block`: one row per customer and rule per 60-minute window, repeats counted in `attempts`, one per estimate refresh, and the admin list shows that stored counter summed per customer and rule (D-155; the hourly window is a builder choice, not a per-Toronto-day rule; no migration). A missing phone or address is not logged. The estimate response is unchanged.
- **Privacy.** The customer sees one generic message. The blocking rule (customer, phone, address) is written to `free_trial_blocks`, readable by admins only. Hashes, phones and addresses are never logged or returned.
- **Clean errors.** A stored phone the stricter rules refuse (for example an N11 area code), no verified phone, or a missing or invalid address is a 409 (`PHONE_NOT_SUBMITTED`, `PHONE_NOT_VERIFIED`, `ADDRESS_NOT_SET`), never a 500.
- **Cancellation after a day was cooked (D-26).** `cancelled` releases the claim (A-16), but a cancellation after at least one day was cooked consumes it. The per-day "cooked" marker (`booking_days.cooked_at`) is passed to `freeTrialEffect`. **D-37 (T-066):** a chef no-show works the same way: after at least one cooked day the trial is used up, otherwise it is released. **D-36 (T-066):** automatic completion needs a cooked day; otherwise the booking is flagged for the admin and the claim stays held.
- **Booking and claim are one transaction (T-042).** `POST /api/bookings` writes the claim inside `create_booking`, so a refused trial leaves no booking. Expiry (D-19) releases the claim through `applyFreeTrialEvent(id, "expired")` after the status is saved; the next expiry sweep repairs a release that crashed in between.
- **MOCK / Q-1.** The trial waives chef labour in the prototype; nobody pays the chef. Known limits (cheap SIMs, several addresses) are in the README.

## Contact privacy (T-065)

- **D-52 window.** Phone and address are visible from acceptance until 00:00 Toronto on (last visit day + 8), i.e. through the 7th day after the last visit day. Applies to `accepted`, `completed`, `no_show_customer`, `no_show_chef`. Chat is unaffected.
- **Kitchen photos (D-58, T-074).** They follow the same window: the customer of a chef's-home booking sees them from acceptance until the same cut-off; never for a cancelled booking.
- **No kitchen address, no accept (D-59, T-074).** A chef with chef's home enabled but no complete kitchen address saved cannot accept a chef's-home booking (409, `reason: kitchen_address_missing`); declining is still possible.
- **D-56.** A cancelled booking locks contact at once; the window does not apply to it (nor to `requested`, `declined`, `expired`).
- **Kitchen snapshot.** Accepting a chef's-home booking copies the chef's kitchen address onto the booking, in the same transaction and under the chef row lock. The customer is shown the copy; a later kitchen change never shows a new address to a past customer (review M4).
- **N3 as one function.** `set_chef_kitchen_address` checks "no accepted chef's-home booking" and writes under one lock (chef row, then `chef_private`), so a concurrent accept cannot slip between check and write (review L4). A change switches chef's home off; an admin enables it again (D-21).

## Self text and intake read window (T-101)

- **D-147 (Jimmy: "Filter all self text").** Display name, chef bio, dish name and dish description go through the same contact filter as chat and reviews (`findContactDetails`): a phone number (T-088 shape), email or link is refused with 422 `CONTACT_DETAILS_NOT_ALLOWED`, and nothing is saved. The shared parsers run in the browser, the MOCK adapter and the server.
- **D-148 (Jimmy: "Requested + contact window").** The chef reads the customer's allergy and dietary form while the booking is `requested`, and from acceptance until the D-52 window ends (00:00 Toronto on last visit day + 8, the window `get_booking_contact` uses). Not after decline, cancel or expiry, and not after the window. The customer always reads their own form; admin unchanged. The notes themselves are contact-filtered the same way.
- **Known limit.** Text saved before T-101 is not migrated or re-checked. Seed data was checked (a unit test keeps it passing).

## Flagged bookings (T-064)

- **D-53 freeze.** A booking with an open admin flag other than `no_day_cooked` (today `chef_rejected`, D-22) is frozen until an admin decides: no completion (manual or automatic), no chef action (cooked, no-show, pickup answers, receipts, cancel), and the neutral notice for the customer (`BookingDetail.frozen`). No refund or rebooking flow exists (payments are MOCK). D-65: the customer's cancel, no-show report and pickup proposal are refused too; D-66: the customer's receipt answers stay allowed; D-67: nothing unfreezes until T-048; D-68: rejecting the chef turns an open `no_day_cooked` flag into `chef_rejected`, so the booking freezes.
- **D-57.** A `no_day_cooked` flag (D-36) does not freeze. Completing the booking resolves it; if it stays open the admin picks the final status (T-048, D-54).
- **Order.** `booking_flags` rows are inserted in booking id order, in the sweep and in `admin_reject_chef`, so two of them cannot deadlock (T-066 review LOW-2).

## Phone rule in contact guard (T-088)
Jimmy's rule: refuse only North American shapes, 10 digits or 11 starting with 1, allowing spaces, dots, dashes, brackets and a leading +. Builder choices (not confirmed by Jimmy): 12 or more digits in a row pass, but a 3-3-4 phone shape that stands alone inside a longer spaced run (`ref 12345 416 555 0199`) is refused; two numbers split by text are judged separately (`416 555 or 0199` passes); an extension does not matter (`416 555 0199 ext 5` refused, `555-0199 ext 5` passes); non-North-American numbers (`+44 20 7946 0958`) pass.
