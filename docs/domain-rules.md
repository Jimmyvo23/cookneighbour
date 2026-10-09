# Domain rules (T-037)

Pure functions in `src/lib/domain/`, no I/O. Constants live in `config.ts`; every ASSUMPTION is marked there (A-6/Q-8 cancellation, A-8/Q-5 fees and radius, receipt tolerance, max quantity).

| File | Rule |
|---|---|
| `money.ts` | Integer cents; every division rounds half up with integer maths |
| `pricing.ts` | `estimateBooking`: per-day and total time, labour, ingredients, travel (customer's home only, per visit day), platform fee (shown, not collected, not added to the total), free trial waives labour only |
| `visitLimit.ts` | 6-hour soft limit warning per day |
| `bookingValidation.ts` | `validateBooking`: 1-3 days, dates, D-15 window, availability, double booking (A-9), location rules, service area, dishes, soft limit, intake and allergy acknowledgement; returns every error code |
| `allergy.ts` | Intake allergies vs dish allergens (cautious match, no synonyms) |
| `receipt.ts` | Flag when the receipt differs from the estimate by more than max(10%, $5) |
| `cancellation.ts` | 48 h free cancellation from 00:00 Toronto on day 1; `freeTrialEffect(status)` hold / consume / release |
| `eatBy.ts` | cook date + shelf-life days |
| `distance.ts` | Haversine between postal-prefix centres (A-1) |
