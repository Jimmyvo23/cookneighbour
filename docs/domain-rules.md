# Domain rules (T-037)

Pure functions in `src/lib/domain/`, no I/O. Constants live in `config.ts`; every ASSUMPTION is marked there (A-6/Q-8 cancellation, A-8/Q-5 fees and radius, receipt tolerance, max quantity).

| File | Rule |
|---|---|
| `money.ts` | Integer cents; every division rounds half up with integer maths |
| `pricing.ts` | `estimateBooking`: per-day and total time, labour, ingredients, travel (customer's home only, per visit day), platform fee (shown, not collected, not added to the total), free trial waives labour only |
| `visitLimit.ts` | 6-hour soft limit warning per day |
| `bookingValidation.ts` | `validateBooking`: 1-3 days, dates, D-15 window, **day 1 is tomorrow at the earliest (D-27, `DATE_TOO_SOON`)**, availability, double booking (A-9), location rules, service area, dishes, soft limit, intake (blank refused, D-23) and allergy acknowledgement; returns every error code |
| `contactDetails.ts` | T-042 (D-34): best-effort filter for phone-like digit runs, emails and URLs in text the other party reads before acceptance (decline reason); street addresses are not detected |
| `bookingRequest.ts` | T-042: parses the booking request body (dotted field errors), builds the intake text from the allergen picker plus free text, `requestExpiry` (D-19: earlier of 72 hours and 00:00 Toronto on day 1), `classifyIssues` (hidden chef 404, double booking 409, validation 422) |
| `allergy.ts` | Intake allergies vs dish allergens (cautious match plus a fixed synonym and spelling map, D-24; D-32 adds the gluten grains, celiac/coeliac, bare macadamia, brazil, soybean). `dietary.ts` (search `avoidAllergens`) uses the same function, D-31 |
| `receipt.ts` | Flag when the receipt differs from the estimate by more than max(15%, $5), A-15 |
| `cancellation.ts` | 48 h free cancellation from 00:00 Toronto on day 1; `freeTrialEffect(status)` hold / consume / release |
| `freeTrial.ts` | `evaluateFreeTrial` (blocked by a held or consumed claim with the same customer, phone hash or address hash; released never blocks) and `transitionFreeTrial` (state machine; asks `freeTrialEffect` what an outcome means) |
| `eatBy.ts` | cook date + shelf-life days |
| `distance.ts` | Haversine between postal-prefix centres (A-1) |

## Free trial (T-038)

Pure rules: `src/lib/domain/freeTrial.ts`. Server functions: `src/lib/server/free-trial.ts` (`checkFreeTrialEligibility`, `holdFreeTrial`, `applyFreeTrialEvent`). Contract notes for T-042: `docs/api-contract.md` section 11A.

- **Eligible** when the customer has a MOCK-verified phone and a valid home address, and no `held` or `consumed` claim has the same customer, the same phone hash or the same address hash. A `released` claim blocks nothing. Hashes are made on the server from the stored phone and address (HMAC with `HASH_PEPPER`); a hash from a client is never used.
- **Hold is atomic.** One INSERT into `free_trial_claims`; the three partial unique indexes (`free_trial_one_per_customer`, `_phone`, `_address`, where `state <> 'released'`) decide the winner, so two parallel holds cannot both succeed. The loser gets 409 `FREE_TRIAL_USED`. No migration was needed.
- **Outcomes (A-16)** come from `freeTrialEffect` and nowhere else: declined, expired, chef no-show and cancelled release the claim; completed and customer no-show consume it; requested and accepted keep it held. Only a `held` claim changes, in one conditional UPDATE (`where booking_id = ? and state = 'held'`). Repeating an outcome is a no-op; the opposite outcome (for example cancelled after completed) is 409 `INVALID_STATE`.
- **Privacy.** The customer sees one generic message. The blocking rule (customer, phone, address) is written to `free_trial_blocks`, readable by admins only. Hashes, phones and addresses are never logged or returned.
- **Clean errors.** A stored phone the stricter rules refuse (for example an N11 area code), no verified phone, or a missing or invalid address is a 409 (`PHONE_NOT_SUBMITTED`, `PHONE_NOT_VERIFIED`, `ADDRESS_NOT_SET`), never a 500.
- **Cancellation after a day was cooked (D-26).** `cancelled` releases the claim (A-16), but a cancellation after at least one day was cooked consumes it. The per-day "cooked" marker and the call that passes it to `freeTrialEffect` come with T-063.
- **Booking and claim are one transaction (T-042).** `POST /api/bookings` writes the claim inside `create_booking`, so a refused trial leaves no booking. Expiry (D-19) releases the claim through `applyFreeTrialEvent(id, "expired")` after the status is saved; the next expiry sweep repairs a release that crashed in between.
- **MOCK / Q-1.** The trial waives chef labour in the prototype; nobody pays the chef. Known limits (cheap SIMs, several addresses) are in the README.
