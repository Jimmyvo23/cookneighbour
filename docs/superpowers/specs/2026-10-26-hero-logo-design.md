# T-126 Version 2: hero, happy-pot logo and clay-pot colours

Status: Look approved by Jimmy from the demo ("like it", 2026-10-26); open questions 1 to 4 answered
Owner: Frontend (build), Tester, Reviewer. Planner runs the Impeccable critique.
Replaces: the 3D pot hero direction. PR #238 is closed without merging and the branch `feature/T-126-3d-hero` is kept for reference (Jimmy: "Close, keep branch").

## 1. Goal

Make the home page feel like a neighbour's kitchen, not a template, so that in a few seconds a visitor gets:
"a grandma or mom near me cooks the food I grew up with, for less than eating out."
It should be our own look (not Airbnb, not "AI slop"), calm, and easy to use on a phone.

## 2. What Jimmy decided (brainstorm 2026-10-24 to 2026-10-26)

These are **requirements** for this task. The decision rows go into the next notes PR.

| Topic | Jimmy's choice |
|---|---|
| Hero layout | Option C: soft drawn map of the GTA with pots at the demo chefs' cities. A pot's lid pops when you hover, click or Tab to it, and a DEMO card shows the dish. |
| Left-side art | Option 5, "one table, many cultures": a family table seen from above with shared dishes. Hover adds gentle motion (steam rises, bowls bob, chopsticks lift). |
| Words | Headline "Miss your mom's cooking?", a price line, main button "Find a home cook", small link "I love to cook". |
| Style | Soft, rounded, drawn (Airbnb-like softness, but not Airbnb's look). No photos, no faces, no hands. |
| Logo | 1. Happy pot: a round pot with a small smile, no letters. Lid pops on hover. |
| Colours | 4. Clay pot (kho tộ): terracotta and caramel, with herb green. |
| Calm rule | No pattern strips, no ornament, one main colour, lots of space (Jimmy: patterns felt "too busy"). |
| Demo | Jimmy saw the clay-pot demo of this hero (map, table, happy pot) and said "like it". |
| Gingham | "Remove everywhere": the gingham pattern from T-069 goes on every page. |
| Phone order | "Words, map, then table". |
| Card link | "Yes, link to chef". |

## 3. Colours (design tokens)

The colours replace today's red-and-gold "Grandma's table" values in `src/app/globals.css`. Token **names stay the same**, so pages change colour without code edits.

### Light (Jimmy saw these on the comparison page)

| Role | Token | Value | Contrast |
|---|---|---|---|
| Page background | `--paper` | `#faf3ea` | |
| Cards, header | `--surface` | `#fffaf3` | |
| Main text | `--ink` | `#2a1d15` | 14.8:1 on paper |
| Secondary text | `--muted` | `#5d4a3d` | 7.6:1 |
| Borders | `--line` | `#e6d6c4` | decoration |
| Buttons, logo | `--primary` | `#a5482a` (terracotta) | white text 5.9:1 |
| Button hover | `--primary-hover` | `#8f3d22` | white text 7.4:1 |
| Links | `--link` | `#8f3d22` | 6.7:1 |
| Steam, highlights | caramel | `#c98a3a` | **decoration only, never text** (2.7:1) |
| Herb green | `--herb` | `#3d6b5c` | 5.5:1 |
| Chips | `--chip` / text | `#f5e1cf` / `#7a3418` | 7.1:1 |

### Dark mode (a proposal; Jimmy has not seen it yet)

Warm "clay at night", never pure black: paper `#1e1611`, surface `#2a1f18`, ink `#f5e9dc` (14.9:1), muted `#cdb8a6` (9.3:1), button `#e3825c` with dark text (6.5:1), link `#f0a07c` (8.5:1), focus `#8fb8f0` (8.7:1). Frontend shows a dark screenshot for Jimmy's OK.

### Kept as-is

- MOCK badge colours, so MOCK labels look the same everywhere.
- Status colours (success, warning, danger). Danger red stays clearly different from terracotta. The Reviewer checks that an error never looks like a normal button.
- Focus ring `#1f4e8c` (7.6:1 on the new paper).

## 4. Logo: the happy pot

- A round pot with two handles, a lid with a knob, and a small smile. No letters, so it works in any language.
- Drawn small first: it must read at 24 px (header) and 16 px (favicon). The big version is the same drawing.
- Colour: terracotta on light; the light terracotta on dark. Steam is caramel.
- Hover or focus on the brand link: the lid tips up (about 0.45 s, a little bounce) and two short steam lines appear. Reduced motion: no movement.
- It replaces `PotMark` in `src/components/Ornaments.tsx`, plus the favicon and app icon.

## 5. Hero

### Layout

- **Desktop (1024 px and up):** two columns. Left: the table art on top, then the logo name, headline, price line, button and link. Right: the map panel with a hint line on top and the dish card under the map.
- **Phone (375 px):** one column in this order: logo name, headline, price line, button, link, then the map and its card, then the table art (smaller) at the bottom.
- Lots of space. No gingham, stripes or pattern bands, in the hero or on any other page.

### Words (Jimmy approved the headline, button and link)

- Headline: **Miss your mom's cooking?**
- Price line (from the sketch): "A grandma or mom near you cooks the food you grew up with, in your kitchen or hers. For less than eating out every day."
- Button: **Find a home cook** (goes to search, same as today's main button).
- Link: **I love to cook** (goes to chef sign-up).
- Map hint: "Tap a pot on the map: who is cooking near you?"
- Card before any tap: "Neighbours are cooking. Pick a pot to see the dish, the cook and how long it takes."
- The PROTOTYPE badge stays near the headline (the CLAUDE.md rule that mocks are labelled).

### The map

- A simple drawn map of Brampton, Mississauga, Toronto and Lake Ontario. Not a real map: no Leaflet, no tiles, no street detail. It is marked as an illustration, and positions are roughly right.
- **Three pots**, one per city, each tied to a real **seeded demo dish** (from `scripts/seed-data.ts`):

| City | Pot shows | Card text |
|---|---|---|
| Mississauga | Pho bo | Pho bo **DEMO** · Chef Lan (demo) · Mississauga · about 4 h |
| Brampton | Chole and roti | Chole and roti **DEMO** · Chef Harpreet (demo) · Brampton · about 1.5 h |
| Toronto | Brown stew fish | Brown stew fish **DEMO** · Chef Devon (demo) · Toronto · about 1 h 10 min |

  The card data is a small constant file. A unit test checks that each name, city and cook time still matches `seed-data.ts`, so the card can never show a dish that does not exist.
- **Interaction:** hover, click, tap, or Tab + Enter/Space on a pot. Its lid pops, steam shows, the dish appears above the pot, and the card below updates. Only one pot is open at a time.
- **Card link:** an open card shows a link "See Chef Lan" (with that chef's name) to `/chefs/[id]`. Seed IDs are not fixed, so the home page looks the chef up on the server by display name, **approved chefs only**. If a chef is missing (for example a fresh database), the link goes to search for that city and cuisine instead, never to a broken page. Tested both ways.
- **Accessibility:** each pot is a real `<button>` with a name like "Pho bo by Chef Lan (demo)". The card is an `aria-live="polite"` region. Targets are 44 px or larger. The visible focus ring meets 3:1.

### The table art (left)

- A family table from above: a big shared bowl in the middle, small bowls, chopsticks, a spoon and a fork (many cultures at one table).
- Hover: steam rises, bowls bob a little, the chopsticks lift. It stops when the pointer leaves. Nothing moves on its own forever.
- Decorative: `aria-hidden` or a short alt text, never a button.

### Motion rules (all hero and logo motion)

- Motion starts only on hover, focus or tap, except an optional one-time gentle hint on load (at most one cycle).
- `prefers-reduced-motion: reduce` turns all movement off; the states still change instantly.
- CSS and inline SVG only. No WebGL, no `three`, and no new npm packages.

### Gingham removal (site-wide)

- Remove the gingham band and gingham backgrounds everywhere (`--gingham` and every place that uses it), leaving plain surfaces.
- Tests that look for gingham are updated, not deleted, so they now check that the pattern is gone.

## 6. Out of scope

- Real map data or live chef locations on the home page.
- Changes to search, booking, chat or admin pages beyond the colour token swap and the gingham removal.
- New illustrations for other pages.
- Photos of any kind.

## 7. How we check it (definition of done)

1. **Impeccable, really invoked** (rule from 2026-10-24): Frontend runs `impeccable` context and detect and pastes the output in its handoff. After the build, the Planner runs the Impeccable `critique` on the logo and hero. P1 issues get fixed before the Tester starts.
2. Screenshots for Jimmy at 375 and 1280, light and dark, before the PR is final. Jimmy OKs the look.
3. Tests:
   - Unit: the map card data matches the seed.
   - E2E: hover, click and keyboard open each pot and update the card; one pot open at a time.
   - Reduced motion: no animation.
   - axe: no violations on the home page in light and dark.
   - Contrast: a check of the new token pairs.
   - Existing tests keep passing; colour-dependent snapshots are updated, not deleted.
4. Tester PASS, then Reviewer APPROVE, a green `ci` check, and merge (standing merge rule D-42).

## 8. Answered and still open

Answered by Jimmy on 2026-10-26:
1. Old 3D PR #238: **close it and keep the branch**.
2. Gingham: **remove it everywhere**.
3. Phone: **words, map, then table**.
4. Card: **link to the chef's page**.

Still open:
5. **Dark mode colours:** use the proposal in section 3, checked by screenshot before merge?

## 9. Assumptions (not confirmed by Jimmy)

- The token names stay the same, so the colour swap reaches every page in one change.
- The price line wording comes from the sketch. Jimmy saw it in the demo but did not comment on it separately.
- The link text "See Chef <name>" is Planner wording, not yet confirmed.
- Version 2 is released as a new tag only after Jimmy approves (release rule).
