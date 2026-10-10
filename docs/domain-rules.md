# Domain rules (T-037)

Pure functions in `src/lib/domain/`, no I/O. Constants live in `config.ts`; every ASSUMPTION is marked there (A-6/Q-8 cancellation, A-8/Q-5 fees and radius, receipt tolerance, max quantity).

| File | Rule |
|---|---|
| `money.ts` | Integer cents; every division rounds half up with integer maths |
| `pricing.ts` | `estimateBooking`: per-day and total time, labour, ingredients, travel (customer's home only, per visit day), platform fee (shown, not collected, not added to the total), free trial waives labour only |
| `visitLimit.ts` | 6-hour soft limit warning per day |
| `bookingValidation.ts` | `validateBooking`: 1-3 days, dates, D-15 window, availability, double booking (A-9), location rules, service area, dishes, soft limit, intake and allergy acknowledgement; returns every error code |
| `allergy.ts` | Intake allergies vs dish allergens (cautious match plus a fixed synonym and spelling map, D-24) |
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
- **Open point for T-042 / Jimmy.** `cancelled` releases the claim (A-16). If a 3-day booking is cancelled after day 1 was cooked, the booking status alone does not say a visit happened. The rule as written releases the trial; decide in WO-4b whether that case needs a different outcome.
- **MOCK / Q-1.** The trial waives chef labour in the prototype; nobody pays the chef. Known limits (cheap SIMs, several addresses) are in the README.
