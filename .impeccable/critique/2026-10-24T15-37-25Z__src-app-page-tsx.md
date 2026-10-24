---
target: logo mark + home hero banner
total_score: 18
max_score: 32
na_heuristics: 7,10
p0_count: 0
p1_count: 3
target_identity: "file:/Users/kienvo/Desktop/Claude projects/CookNeighbour/src/app/page.tsx"
target_fingerprint: "sha256:9f4c95daeff618721710e5540e460c43a6a25ce38040b916ee2b2e7271640adb"
target_path: /Users/kienvo/Desktop/Claude projects/CookNeighbour/src/app/page.tsx
timestamp: 2026-10-24T15-37-25Z
slug: src-app-page-tsx
---
Method: dual-agent (A: design-review sub-agent, B: detector sub-agent). Chrome extension not connected; screenshots + overlay via headless Playwright (overlay injected inline, CSP blocked the hosted script).

## Design health score
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | "Prototype" shouted in H1 instead of a badge |
| 2 | Match system / real world | 1 | Gingham, basil, Dutch oven = Italian trattoria, not home cooks from your culture |
| 3 | User control and freedom | 3 | Simple, one exit |
| 4 | Consistency and standards | 2 | Heritage serif + cartoon button + sticker art = three registers |
| 5 | Error prevention | 3 | Little to get wrong |
| 6 | Recognition rather than recall | 2 | No who/where/how long/how much |
| 7 | Flexibility and efficiency | n/a | Single-CTA landing |
| 8 | Aesthetic and minimalist design | 1 | ~10 ornaments, zero information |
| 9 | Error recovery | 3 | No error states |
| 10 | Help and documentation | n/a | Landing surface |
| Total | | 18/32 | Acceptable (56%) |

## Design specificity verdict
Category-interchangeable. Slop tells: four-point sparkles, heart on the pot, emblem-badge plate (centred object, circle, symmetric sprigs, drop shadow), gingham + basil (one Western cuisine for a many-cultures product). Authored: the tagline. Detector: CLI 0 findings on page.tsx/layout.tsx/Ornaments.tsx (markup only). Overlay: cream/beige page background rgb(251,246,236); repeating-gradient decorative stripes (gingham). Both agree with the LLM review; the look sits in the "cream ground + serif + red accent" AI cluster.

## Priority issues
- [P1] H1 is a placeholder "CookNeighbour — prototype" (orphaned "— prototype" line). Fix: promise as H1, prototype as a MOCK/PROTOTYPE badge (copy change needs Jimmy). /impeccable clarify. (Review said P0; downgraded, not blocking.)
- [P1] Imagery generic and culturally mis-coded. Fix: new direction. /impeccable shape
- [P1] Logo mark fails at 36px (steam hairlines vanish, reads as a bowl, no home/neighbour idea). Fix: redraw small-first, one colour, 16/24/36px.
- [P2] Hero explains nothing. Fix: "At your home or theirs · 1 to 3 days · See the price before you book". /impeccable clarify
- [P2] Phone: header wraps to 2 rows (~110px); art below fold. /impeccable adapt

## Persona red flags
- Jordan: restaurant? recipes? delivery? "prototype" suggests it may not work.
- Casey: two-row header + cropped mascot push content down.
- Retired Vietnamese grandma cook: nothing for cooks; italic serif tagline hard for ESL/older readers; gingham/basil not her kitchen.
- Busy immigrant parent (Mississauga): no local, price or safety cue; cute art reads fun, not trust.

## Minor observations
Sticker shadows on serif; gold double rule echoes header border; ~30% empty cloth on desktop; dark mode muddy; gingham cells shift behind the italic tagline.

## Questions to consider
- With the name covered, could anyone tell this is about immigrant home cooks?
- The brand is neighbour; why no home, door, street, or two people?
- Should the home page speak to cooks as well as customers?
