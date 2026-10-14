# Product

<!-- impeccable:product-schema 1 -->

<!-- Positioning, voice, product principles and accessibility: drafted by the Planner, approved by Jimmy 2026-10-14 (D-45). Everything else: source CLAUDE.md sections 2 to 4 only. Nothing here is invented. Where the format asks for something those sections do not answer, it says "Not decided yet (open question for Jimmy)". Platform comes from the stack in CLAUDE.md section 5 (Next.js web app, mobile-first). -->

## Platform

web

## Users

Three kinds of user:

- **Customer.** Books a chef to cook at their home. Immigrants and busy families who miss home-cooked food from their culture but cannot afford restaurant meals three times a day (after tax and tips).
- **Chef.** A home cook (retired grandma, stay-at-home parent, or any verified home cook) offering dishes and an hourly rate. Whether chefs are limited to grandmas and stay-at-home parents or open to any verified home cook: Not decided yet (open question for Jimmy).
- **Admin.** Approves or rejects chef applications; views reports.

## Product Purpose

CookNeighbour is a prototype marketplace where people hire a home cook for 1 to 3 days. The cook works at the customer's home or at the chef's home, and the customer chooses. A customer can find a home cook who makes their cuisine (for example a Vietnamese chef in Mississauga), pick dishes, see an estimated price and time, book the chef, message them, and leave a review.

Retired grandmas, stay-at-home parents and other excellent home cooks can earn income at a price far below a private chef (about $1,000+).

Success for the prototype: a working, demo-ready end-to-end flow. It is also a practice project for Jimmy to build multi-agent Claude Code skills and to demo to his mentor. It is a prototype, not a production launch.

## Positioning

Home-cooked food from your own culture, made by a neighbour, for far less than a private chef and less than eating out every day. It is warm and personal, not a restaurant-delivery app and not a luxury chef service.

## Operating Context

- Launch region for demo data: Mississauga / Greater Toronto Area (GTA), Ontario, Canada.
- Long-term vision: Canada first, then global. Country, currency and language are stored on relevant records from day one. The UI is English only for now.
- Budget: free tiers only, no paid services.
- Payments, identity checks, police checks and SMS are all mocked or in test mode. Nothing real is charged or verified, and every mock is labelled clearly in code and UI.
- Cooking location: the customer chooses at booking, at the customer's home or at the chef's home (only if the chef offers it). Each chef declares which options they offer.
- Booking length: 1 to 3 days, one visit per day. Meals should be eaten within about 2 days of cooking, so each meal carries an "eat by" date. Ontario public-health guidance must confirm the real window before any actual launch.

## Capabilities and Constraints

- Prototype only; Canada only; English only.
- Terminology: use "Cuisine" and "Languages spoken", not "Nationality".
- Real food-safety, licensing and insurance compliance is not claimed; these are open legal risks.
- Visual identity, tone of voice and design direction: Not decided yet (open question for Jimmy).

## Brand Commitments

Name: CookNeighbour (default; alternatives such as GrandmaPlate, TableMates, Nana's Table are an open question for Jimmy). Voice: warm, plain and respectful, like a helpful neighbour; no hype, no slang, no guilt. Logo and visual identity: Not decided yet (open question for Jimmy).

## Evidence on Hand

As of 2026-10-14: only seed and demo data (GTA chefs across several cuisines). No real customers, chefs, testimonials, reviews or press exist. Future work must not fabricate any.

## Product Principles

1. Trust first: show what is checked, what is a MOCK, and what is still unknown, honestly.
2. Plain words: short sentences that someone reading English as a second language can follow.
3. Prices are never a surprise: show the estimate and how it is built before anyone commits.
4. Safety is visible: allergies and "eat by" dates are easy to find, not hidden.
5. Privacy by default: show the other person only what they need, when they need it.

Established constraints from the spec that design must respect: mocks are always labelled "MOCK"; no nationality filtering; collect the minimum personal data.

## Accessibility & Inclusion

Target WCAG 2.2 level AA (checked with axe in T-052). Mobile-first, large tap targets, readable text sizes, never colour alone to carry meaning. Older users (retired chefs) and English learners are core users, so favour clarity over density.
