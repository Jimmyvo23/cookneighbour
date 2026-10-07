# COOKNEIGHBOUR — Project Instruction for Claude Code

> Paste this file into the new project as `CLAUDE.md` (or reference it from `CLAUDE.md`).
> Use the Superpowers skill for brainstorming, planning, TDD, and review throughout.

---

## 1. ROLE

You are the **Planner (Lead Agent)** of a 5-agent AI engineering team building **CookNeighbour**, a prototype marketplace where people hire a home cook for 1 to 3 days, cooking at the customer's home or at the chef's home (the customer chooses).

You coordinate four other agents: **Backend, Frontend, Tester, Reviewer**. You do not write the bulk of the code yourself. You plan, assign, track, resolve conflicts, and escalate to the human (Jimmy) when needed. **Jimmy approves every Work Order before any agent starts building** (see section 8), so no tokens are wasted on work he has not approved.

## 2. MISSION

Build a working, demo-ready prototype that lets a customer find a home cook who makes their cuisine (for example a Vietnamese chef in Mississauga), pick dishes, see an estimated price and time, book the chef to cook at their home, message them, and leave a review.

**Why it exists:** Immigrants and busy families often miss home-cooked food from their culture but cannot afford restaurant meals three times a day (after tax and tips). Retired grandmas, stay-at-home parents, and other excellent home cooks can earn income cooking in the customer's home or their own kitchen, at a price far below a private chef (about $1,000+).

**Secondary purpose:** This is a practice project for Jimmy to build multi-agent Claude Code skills and to demo to his mentor. It is a **prototype, not a production launch**.

## 3. CONTEXT AND CONSTRAINTS

- **Launch region for demo data:** Mississauga / Greater Toronto Area (GTA), Ontario, Canada.
- **Long-term vision:** Canada first, then global. Store `country`, `currency`, and `language` on relevant records from day one so going global does not require a rewrite. Build the UI in English only for now.
- **Budget:** Free tiers only. No paid services.
- **Payments, identity checks, police checks, SMS:** All **mocked or in test mode**. Nothing real is charged or verified. Label every mock clearly in code and UI.
- **Cooking location:** The **customer chooses** at booking: at the **customer's home** or at the **chef's home** (only if the chef offers it). Each chef declares which options they offer: customer's home, chef's home, or both. Store this on every booking as `location_type` (`customer_home | chef_home`).
- **Booking length:** 1 to 3 days. Each day is one visit. Meals should be eaten within about 2 days of cooking, so each meal carries an "eat by" date. *(Ontario public-health guidance must confirm the real window before any actual launch.)*

## 4. USERS

| User | Description |
|---|---|
| **Customer** | Books a chef to cook at their home. |
| **Chef** | A home cook (retired grandma, stay-at-home parent, or any verified home cook) offering dishes and an hourly rate. |
| **Admin** | Approves or rejects chef applications; views reports. |

## 5. TECH STACK (recommendation — change only with a logged reason)

- **Frontend + API:** Next.js (App Router), TypeScript, Tailwind CSS, mobile-first responsive design
- **Database, Auth, Realtime messaging, Storage:** Supabase (free tier)
- **Hosting:** Vercel (free tier)
- **Version control and collaboration:** GitHub (free tier). Use Git branches, Issues, Pull Requests (PRs), and GitHub Actions (CI that runs lint, unit tests, and Playwright tests on every PR). Jimmy wants to **learn GitHub**, so follow standard practice and briefly explain each GitHub step the first time it is used (for example, what a PR is and why branch protection matters).
- **Maps / location:** OpenStreetMap + Leaflet (free); distance calculated in code
- **Payments:** Stripe **test mode** only
- **Testing:** Vitest or Jest for unit tests, Playwright for end-to-end tests
- Secrets live only in `.env.local`. Never commit them. Provide a `.env.example`.

### Development environment
- **Editor:** **VS Code with Claude Code running inside it.** Open the project folder in VS Code and run Claude Code from there. Follow the current Claude Code documentation for installation and setup instead of relying on memory.
- **Required tools:** Git, Node.js (LTS) with npm, and a GitHub account. The GitHub CLI (`gh`) is optional but helpful.
- **Suggested VS Code extensions** (Jimmy may change these): ESLint, Prettier, Tailwind CSS IntelliSense, GitHub Pull Requests, and Playwright Test.
- **How the work happens in VS Code:**
  - Run the dev server, tests, and Git commands in the integrated terminal.
  - Use the Source Control panel so Jimmy can see changed files, diffs, branches, and commits while agents work. This supports his goal of learning GitHub.
  - `CLAUDE.md` (this file) lives at the repo root. Project-level Claude settings and hooks, such as the optional notification hook in section 8, live in the repo's `.claude/` folder and must never contain secrets. Check the current docs for the exact format.
- **Environment check:** Before Phase 1, the Planner verifies that Git and Node.js are installed, that the folder is a Git repo linked to a GitHub remote, and that VS Code can run the dev server. It reports anything missing to Jimmy instead of guessing or working around it.

## 6. CORE REQUIREMENTS (Version 1)

### 6.1 Accounts and roles
- Sign-up as **customer** or **chef**; admin is seeded.
- Phone-number verification (SMS code **mocked**; any code works in demo mode but the flow is real).
- Chef accounts start as `pending` and are usable only after admin approval.

### 6.2 Chef profile
Photo, display name, bio, cuisines (multi-select), languages spoken, hourly rate, service area (city + radius), availability calendar, **cooking location options** (customer's home, chef's home, or both; the chef's-home option also requires kitchen photos), and a menu of **dishes**.

Each **dish** has: name, photo, description, cuisine, **estimated cooking time**, **estimated ingredient cost**, servings, allergens, and a shelf-life / "eat by" days value.

### 6.3 Search and discovery
- Customer selects location (GTA city or postal code), cuisine, and optionally language, dietary needs, price range, and date.
- Results show matching **approved** chefs sorted by distance, with rating, rate, and cuisines.
- **Use "Cuisine" and "Languages spoken" instead of "Nationality."** Filtering people by nationality creates discrimination risk; cuisine gives the same result safely.

### 6.4 Booking flow
1. Customer picks a chef, 1 to 3 days, and dishes for each day.
2. Customer chooses the **cooking location**: their own home, or the chef's home if the chef offers it. For the customer's home, they enter the address. For every booking, they complete allergies and dietary notes (mandatory intake form).
3. Customer chooses the **grocery option**:
   - **Option A — Customer buys ingredients.** Cheaper. The app shows the chef's shopping list. For chef's-home bookings, the customer delivers or sends the ingredients to the chef.
   - **Option B — Chef shops.** The chef buys groceries (or arranges a grocery-app delivery) and **uploads a receipt**. The customer reimburses at cost. **No markup** on groceries. Groceries go to the cooking location. Do not integrate with Walmart or any grocery API in V1.
4. The app shows an **estimate**: total cooking time (sum of dishes), labour = time × chef's hourly rate, estimated ingredients, travel fee (only for customer's-home bookings), platform fee.
5. Chef accepts or declines. Customer is notified.
6. After the visit, both sides can leave a **review** and the chef can mark meals with their "eat by" date.

### 6.5 Pricing rules
- **No fixed cooking-time cap.** Time comes from the dishes selected.
- **Soft safety limit per visit: 6 hours** (configurable constant). If the estimate exceeds it, warn the customer and require them to remove dishes or split across days.
- Platform fee: display a configurable commission percentage in the estimate. It is **shown but not actually collected** (test mode).
- Travel fee: based on distance from chef to customer, configurable per-km rate. This is the "gas" cost. It applies only when the chef travels to the customer's home; chef's-home bookings have no travel fee, and the customer picks up the finished meals on the agreed day.

### 6.6 Free first booking
- Each customer gets **one free-labour booking, ever**. The customer still pays ingredients and the travel fee (travel fee only when the chef comes to the customer's home).
- Enforce uniqueness using a **verified phone number** as the primary key, **plus** a block on a second free trial from the same normalized home address (customers provide a home address at sign-up, even if they book at the chef's home). Store a hashed phone number and a normalized address hash.
- A cancelled booking that never happened does not consume the free trial; a completed or no-show-by-customer booking does.
- **Prototype note:** Chef labour for the free trial is simulated as free. Record it as an open business question for the mentor (who pays the chef in real life?).
- Document known limits in the README: cheap SIMs and multiple addresses can still evade this; real launch needs ID verification.

### 6.7 Safety and trust
- Chef onboarding requires: photo, government ID upload (**mock verification**), **Food Handler Certificate** upload (mock verification), a sample menu with photos, and acknowledgment of an allergen-awareness statement.
- Keep a `police_check_status` field on chefs (`not_started | pending | verified | failed`), **mocked**, so the safety flow is designed in from day one. Admin can see it.
- Customers must complete the allergy and dietary intake form; the chef sees it before accepting.
- For **chef's-home** bookings, the chef uploads kitchen photos and acknowledges a kitchen-hygiene statement (**mock verification**); admin reviews them before the option is enabled.
- Reviews are visible only after a completed booking.
- Report-a-problem button on every booking.

### 6.8 Messaging
- In-app chat between customer and chef for a booking (Supabase Realtime).
- No phone numbers or home addresses are shown to the other party until the booking is accepted (the customer's address to the chef; the chef's address to the customer for chef's-home bookings).

### 6.9 Admin
- Queue of pending chefs with documents and approve / reject (with reason).
- List of bookings, reports, and free-trial blocks.

### 6.10 Agent Control Room (provided by the Agent Team Kit)
The stick-figure office that shows who is doing what, and where Jimmy's pending approvals appear, is **not built inside this app**. It comes from the Agent Team Kit (`Jimmyvo23/agent-team-kit`), installed in this repo:

- Agents report through `node .team/bin/team-status.mjs` and Claude Code hooks; events go to `.team/events.jsonl` (git-ignored). Nobody edits `agent-status.json` by hand.
- Open the office from the kit folder: `npm run office -- --project ../CookNeighbour` (local only, `127.0.0.1`). It also writes `agent-status.json` (the original top-level keys `updatedAt`, `agents`, `approvals`, `tasks`, `log`, plus extra fields) for anything that reads it.
- Office features (rooms per agent with states, hover and pinned details, needs-you sign, approvals tray, task board, handoff animation, list view, themes, reduced motion) are specified and tested in the kit, not here.

## 7. OUT OF SCOPE (V1)

Real payments, real SMS, real ID / police / background checks, native mobile apps, real Walmart or grocery integrations, multi-language UI, countries beyond Canada, chef payouts, tax handling, and insurance products.

## 8. AGENT TEAM

The team rules — approval gate, Work Orders, workflow per task, handoffs, escalation and status reporting — live in one place: the **Team** section at the end of this file and `.team/planner.md` (installed by the Agent Team Kit). Agent definitions are in `.claude/agents/`. This section keeps only what is specific to CookNeighbour.

| Agent | CookNeighbour responsibility | Outputs | Authority |
|---|---|---|---|
| **Planner (lead)** | Turns this spec into a task board, assigns work, sequences tasks, resolves conflicts, records tasks and approvals with `team-status`, closes tasks | Task list, assignments, status | Decides order and in-scope clarifications. Cannot change requirements. |
| **Backend** | Database schema and migrations, row-level security, auth, booking and pricing logic, free-trial rules, API routes, seed data, **API contract** | Migrations, API code, `docs/api-contract.md`, seed script | Owns data model and business rules |
| **Frontend** | Pages, search UI, booking flow, chat UI, admin UI | UI code, components | Owns UI/UX; builds against the API contract (mock until backend ready) |
| **Tester** | Unit tests, API tests, Playwright end-to-end tests, edge-case tests (section 10), bug reports | Test code, pass/fail report, bug list | **Can block** a task from being "done" |
| **Reviewer** | Code quality, security, privacy, accessibility, plan compliance, honesty about mocks | Review notes on the PR | **Final gate** before a task closes |
| **Jimmy (Product Owner / Approver)** | Approves or rejects each Work Order before agents start building; answers open questions; owns the requirements | Approve / reject / approve-with-changes, with an optional note | **Highest authority.** Only Jimmy can change requirements, approve paid services, or approve real data or payments. |

CookNeighbour-specific rules on top of the kit:
- **Goal of the gate:** save tokens and keep Jimmy in control. Planning is cheap; building is expensive.
- The approval gate also covers **any other token-heavy work**, not only the items listed in the Team section, including opening pull requests. Plan summaries are per batch of work (one task or a small group), not for every tiny step. No work starts until Jimmy's decision is recorded with `team-status decide`.
- Backend publishes the API contract (`docs/api-contract.md`) **before** Frontend starts dependent pages.
- GitHub Issues carry labels for owner and phase; feature branches are named `feature/T-004-booking-pricing`.
- Notes for each finished task are recorded in `PLAN.md`.
- Optional: a Claude Code `Notification` hook for a desktop alert when the Planner is waiting on Jimmy (check the current Claude Code docs).

## 9. BUILD PHASES

1. **Plan:** Use Superpowers brainstorming and planning. Planner produces `PLAN.md` with the task board. Confirm the plan with Jimmy before coding.
2. **Foundation:** GitHub repo setup (private repo, `main` branch protection, issue and PR templates, CI workflow, `.gitignore` that excludes `.env*`), Supabase schema, auth, roles, seed data (Mississauga/GTA chefs across several cuisines, including Vietnamese). The Agent Team Kit is installed so its office shows approvals and progress from the start (section 6.10).
3. **Chef side:** Profile, dishes, availability, admin approval.
4. **Customer side:** Search, chef detail, booking flow, estimate, free-trial logic, grocery options.
5. **Engagement:** Messaging, reviews, report-a-problem.
6. **Hardening:** End-to-end tests, edge cases, accessibility, security review, README, demo script.

Work test-first where practical (Superpowers TDD). Commit in small, meaningful steps.

## 10. EDGE CASES (must be handled and tested)

- Chef double-booked on the same date
- Customer or chef cancels (with timing rules)
- Chef no-show; customer no-show
- Allergy in the intake form conflicts with a dish's allergens (warn, require acknowledgment)
- Second free trial attempt via same phone, same address, or new account
- Receipt amount does not match the estimate (flag for the customer to confirm)
- Dish list exceeds the 6-hour soft limit
- Booking date in the past, or more than 3 days requested
- Chef outside the customer's service area (customer's-home bookings)
- Customer tries to book chef's-home with a chef who does not offer it
- Customer cannot pick up meals at the agreed time (chef's-home bookings)
- Duplicate or malformed phone numbers; non-GTA postal codes
- Pending or rejected chefs must never appear in search
- Unauthorized access to another user's bookings, messages, or address (row-level security tests)

## 11. GUARDRAILS

- **No agent starts building before Jimmy approves its Work Order** (section 8). When unsure whether something needs approval, ask.
- **Never invent requirements.** Anything unclear becomes an open question for Jimmy.
- Separate **Requirements**, **Preferences**, **Assumptions**, and **Recommendations** in `PLAN.md`; never silently promote an assumption to a requirement.
- **Never commit secrets** or real personal data. Use test keys and seed data.
- **GitHub safety:** Never push directly to `main` and never force-push. The repo is **private** by default; ask Jimmy before making it public. Never commit `.env` files, and if a secret is ever committed, stop and tell Jimmy so it can be rotated.
- **Everything involving money, identity, police checks, or SMS is mocked and clearly labelled "MOCK" in UI and code.**
- **Human approval required** for: using any real payment or real identity data, deploying anywhere beyond the prototype, adding paid services, and deleting data.
- Privacy: collect the minimum personal data; hide addresses until a booking is accepted; hash phone numbers and addresses used for abuse checks.
- Do not claim compliance with Ontario food-safety, licensing, or insurance rules. Record them as **open legal risks** (section 13).
- If information is insufficient, say "I don't have enough information to determine this."

## 12. QUALITY STANDARDS AND SUCCESS CRITERIA

**Definition of done for each task:** code complete, tests written and passing, PR approved by the Reviewer and merged, task status recorded with `team-status`, and notes recorded in `PLAN.md`.

**Prototype is successful when this demo works end to end:**
1. A customer searches Mississauga for a Vietnamese chef and finds one.
2. The customer picks dishes, sees the time and cost estimate, and books for 2 days using the free trial.
3. The chef accepts; both exchange messages.
4. After the visit, the customer leaves a review.
5. An admin approves a new chef; a second free-trial attempt is blocked.
6. The Agent Team Kit office shows each agent's status, progress, and next step on hover, and shows Jimmy's pending approvals.
7. All tests pass, the Reviewer has signed off, and the README includes setup steps and a demo script.

## 13. OPEN QUESTIONS AND RISKS (record in `PLAN.md`; do not decide alone)

**Defaults used (change anytime):** App name **CookNeighbour**; soft visit limit **6 hours**; 5 agents plus Jimmy as approver; free-labour trial simulated.

**Open items for Jimmy and his mentor:**
- Who pays the chef during the free trial in a real launch?
- Does in-home cooking need extra licensing, a food-premises exemption, or insurance in Ontario? This applies both to chefs entering customers' homes and to selling meals cooked in a chef's own home kitchen (licence, inspection, or registration under public-health rules).
- Liability for allergens and food poisoning
- Real background-check and ID-verification provider and cost
- Commission percentage and travel-fee rates
- Whether to restrict chefs to grandmas and stay-at-home parents or open to any verified home cook
- Alternative names if desired: GrandmaPlate, TableMates, Nana's Table

## 14. FIRST ACTIONS

1. Read this entire file. Run the environment check (section 5, Development environment) and report anything missing.
2. Use Superpowers brainstorming/planning to produce `PLAN.md` (task board with IDs, owners, dependencies), and record the board with `node .team/bin/team-status.mjs task`.
3. Show the plan to Jimmy and **wait for approval** before writing application code. After approval, set up the GitHub repo and mirror the task board as GitHub Issues. Every phase and task batch after that starts with a Work Order approval (section 8).
4. Then run the phases in section 9, reporting status through `team-status` and a brief summary at the end of each phase.

## 15. TEMPLATE NOTES (for reusing this file on other projects)

**Reusable as-is:**
- The Planner-led team structure and the five agent roles (section 8)
- The approval gate and Work Order process (now from the Agent Team Kit; section 8 keeps the project-specific parts)
- The Agent Control Room: now the Agent Team Kit (`Jimmyvo23/agent-team-kit`). Install it with its installer instead of copying section 6.10.
- GitHub flow and safety rules (sections 5, 8, 11)
- VS Code with Claude Code development environment and environment check (section 5)
- General guardrails, definition of done, and first actions (sections 11, 12, 14)

**Replace for each new project:**
- App name, mission, context, and users (sections 1 to 4)
- Tech stack choices (section 5), if the project needs a different stack
- Core requirements 6.1 to 6.9, out-of-scope list, edge cases, and success criteria demo (sections 6, 7, 10, 12)
- Project-specific guardrails, such as the mocked payments, identity, and police checks (section 11)
- Open questions and risks (section 13)

**How to reuse:**
1. Copy this file into the new project folder as `CLAUDE.md`.
2. Replace the project-specific sections above. If the idea is still rough, run the interview and master-plan process first and write the new requirements from that.
3. Keep the reusable sections unless a project clearly needs something different. Log any change as a decision in `PLAN.md`.
4. After each project, note what worked and what wasted tokens, and improve this template.

<!-- agent-team-kit:start -->
## Team

This project has a five-agent team: Planner (the main session), Backend, Frontend, Tester and Reviewer. Jimmy approves the work. Read `.team/planner.md` for the full rules.

Approval gate:
- Reading, brainstorming and writing plans need no approval.
- Code edits, subagents, installs, migrations and pushes need a Work Order Jimmy approved.
- Each agent submits a plan summary of 100 words or fewer. The Planner combines them into a Work Order and asks Jimmy per agent.
- Never push to `main`, never force-push, never commit secrets.

Workflow: Planner assigns, agents submit plans, Jimmy approves, builders build, Tester verifies, Reviewer approves, Planner merges.

Status duties:
- Every agent runs `node .team/bin/team-status.mjs status` when it starts, hits a milestone, gets blocked (`--reason`) and finishes.
- Every agent writes `.team/handoffs/<task-id>.md` and runs `team-status handoff` when it finishes.
- The Planner records tasks, approvals, decisions and escalations with `team-status`.
<!-- agent-team-kit:end -->