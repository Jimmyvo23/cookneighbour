---
target: T-126 v2 home hero + happy-pot logo
total_score: 22
max_score: 32
na_heuristics: 7,10
p0_count: 0
p1_count: 3
target_identity: "file:/Users/kienvo/Desktop/Claude projects/CookNeighbour-wt-T126v2/src/app/page.tsx"
target_fingerprint: "sha256:3996d59475427cd8606d029311f2e7eda975b326e8cccf3040aee854c0a31c0b"
target_path: /Users/kienvo/Desktop/Claude projects/CookNeighbour-wt-T126v2/src/app/page.tsx
timestamp: 2026-10-26T15-01-13Z
slug: src-app-page-tsx
---
Method: dual-agent (A: design review sub-agent · B: detector sub-agent)

## Design Health Score (Persuade; 7 and 10 n/a)
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of status | 3 | open pot = lid tilt only; chef lookup silent |
| 2 | Match real world | 3 | "Tap" on desktop; "about 1.5 h"; price line has no price |
| 3 | User control | 3 | hover switches the card on mouse pass |
| 4 | Consistency | 2 | brand twice (header + home-brand); MOCK API + PROTOTYPE + DEMO + "(demo)"; old ornate pot still on search/chef |
| 5 | Error prevention | 3 | fallback link drops city + cuisine (spec says keep them) |
| 6 | Recognition | 3 | pots don't look tappable before first touch |
| 7 | Flexibility | n/a | Persuade |
| 8 | Aesthetic/minimal | 2 | oversized headline, stacked labels, half-empty card, framed table reads as placeholder |
| 9 | Error recovery | 3 | quiet fallback, correct |
| 10 | Help | n/a | Persuade |
| Total | | 22/32 | Acceptable |

## Design specificity
Map + seeded pots + clay palette + wordless happy pot + headline are authored for CookNeighbour. The family table is generic (circles on a rounded rect) and holds the top-left spot on desktop. Build is louder than the approved demo (3-line ~76px serif vs one-line sans). Detector: markup 0 findings; globals.css 6 advisory bounce-easing (876, 953, 965, 1094, 1098, 1102), intentional lid-pop per spec; 1094 (.ft-centre, 0.9s) the one worth softening. Browser overlay failed: CSP script-src blocked detect.js from :8400 (fallback = CLI result).

## Priority issues
- [P1] Headline: `.hero h1` (globals.css:473-477, clamp to 4.75rem, lh 1.04) overrides `.home-title` (globals.css:1050); 3 lines at 1280, main button at bottom of screen, "y" of "your" collides with the apostrophe of "mom's". Fix: `.hero .home-title { font-size: clamp(2.25rem,5vw,3.25rem); line-height:1.12 }`. /impeccable typeset
- [P1] Dark mode pots vanish: bubble (--gold-wash #3a271c), Mississauga lid (--art-red-dark #4a1f12) and --map-shadow #1e1611 on land #2a1f18. Fix: pot tokens with >=3:1 vs land; dark map-shadow ~#3a2c22. /impeccable colorize
- [P1] Fallback link is bare /search (PotMap.tsx:109); spec section 5 says search for that city and cuisine; every MOCK demo viewer lands on an empty form. Fix: /search?city=&cuisine= + SearchView prefill + e2e. /impeccable harden
- [P2] Map reward too small: bubble ~40px at 1280, ~25px at 375; card min-height leaves half blank; no idle cue on pots. Fix: bigger pots/bubble or dish in card, remove empty height, quiet cue. /impeccable delight, layout
- [P2] Brand twice + 4 stacked labels: remove home-brand (page.tsx:18-22); card "Chef Lan" + DEMO badge (drop "(demo)"); PROTOTYPE inline after headline. /impeccable distill
- [P3] Table framed by --table-floor rect, top-left on desktop, hover-only motion invisible on touch. /impeccable layout

## Persona red flags
- Retired home cook: only a small "I love to cook" text link; table motion never plays on tablet; 24px logo smile ~1.2px stroke.
- English learner: apostrophe collision; dish names without gloss; "h" abbreviation; no number in the price line.
- Distracted mobile user: logged-out header wraps to ~150px; card below the fold at 375; bubble unreadable.

## Minor
"Tap" hint at 15px bold reads as small print; Brampton pot is cool steel (only cold colour), spoon/fork use --map-steel; dark button --glow is showy; search/chef pages still show the old ornate pot (out of scope, brand mismatch); "(MOCK)" vs "(demo)" naming differs between chef page and home card.

## Questions
Does the table earn its place? Would one honest MOCK price number persuade better? Should the hero speak to the retired cook more than one small link?
