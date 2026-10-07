# Agent Team Kit — Design Spec

- **Date:** 2026-10-05
- **Status:** Draft, awaiting Jimmy's review
- **Owner:** Jimmy (Product Owner / Approver)
- **Author:** Planner (brainstorming session)
- **Visual reference:** [2026-10-05-agent-team-kit-office-mockup.html](2026-10-05-agent-team-kit-office-mockup.html) (approved office design; the task-board options at the bottom were resolved as option A, "Lobby floor")

> This spec lives in the CookNeighbour repo until the `agent-team-kit` repo exists. It moves there as the Kit's first commit.

---

## 1. Purpose

Jimmy wants a **skilled, reusable team of Claude Code subagents** that works well together on any project, and a **stick-figure office dashboard** that shows at a glance what each agent is doing, its next step, its status, and what needs Jimmy's attention.

**CookNeighbour is the first project the team builds.** It is a separate sub-project with its own spec, plan, and build cycle, started after the Kit works.

### Success criteria

1. One command installs the team into any Git project; running it again updates cleanly; uninstall leaves the project as it was.
2. Jimmy talks only to the Planner (one Claude Code tab). The Planner runs the Work Order gate, starts subagents, and passes structured handoffs between them.
3. While agents work, the office shows each agent's real status, current task, progress, next step, and last action, updating within about 3 seconds.
4. Anything waiting on Jimmy (pending Work Orders, a stuck agent, an escalation) is visible without scanning the desks.
5. A "working" agent never looks busy after it has actually stopped, and silent agents are flagged as stale.
6. The Kit has its own tests and CI, all passing.
7. Ready for the mentor demo in about one month, together with a solid CookNeighbour V1.

---

## 2. Requirements, preferences, assumptions, recommendations

Kept separate as required by CLAUDE.md section 11.

### Requirements (stated by Jimmy)
- R1. A team of subagents that work well together, reusable across all future projects.
- R2. An office UI with stick figures showing each agent's current task, next step, and status.
- R3. Animation and colour in the office.
- R4. The Frontend agent uses the `artifact-design` and `frontend-design` skills.
- R5. Jimmy approves every Work Order before agents build (from CLAUDE.md section 8, unchanged).
- R6. Free tiers only; nothing paid (CLAUDE.md section 3).

### Preferences (chosen by Jimmy during brainstorming)
- P1. Office layout: grid of rooms plus a pinned details panel ("layout C"), restyled as the **sunny cutaway** building.
- P2. Default theme **Cozy day** (now expressed as the sunny cutaway palette); Night shift and Pastel available through a toggle.
- P3. Task board as the building's **lobby floor**.
- P4. Handoffs shown as a folder travelling through a **ceiling mail tube**.

### Assumptions (to confirm or correct)
- A1. Claude Code hook input identifies the subagent type when a subagent is started and stopped. *Verified by spike S-0 before anything depends on it.*
- A2. Hook input for tool calls made inside a subagent may or may not identify which subagent made them. *Also verified by S-0; a fallback is defined in section 6.5.*
- A3. Jimmy will upgrade to Node 20 or newer before the build starts (currently v18.16.0).
- A4. The default team (Planner, Backend, Frontend, Tester, Reviewer, plus Jimmy) fits most future projects.

### Recommendations (Planner's, adopted unless Jimmy objects)
- Rec1. The Planner drafts plan summaries in each agent's voice for routine batches (D-09).
- Rec2. Approve Work Orders in Claude Code; the dashboard shows them read-only for V1 (D-04).
- Rec3. Reviewer runs on a stronger model than the builders, because it is the final gate.

---

## 3. Decision log

| ID | Decision | Why |
|---|---|---|
| D-01 | The team and office are a **standalone, reusable Kit**; CookNeighbour is its first user. Replaces the in-app `/team` page in CookNeighbour CLAUDE.md section 6.10. | Jimmy will reuse the team on every project; avoids extracting it later. |
| D-02 | The Kit lives in its own GitHub repo, **`agent-team-kit`**, installed into projects by a setup script. | Clean reuse and independent versioning. |
| D-03 | The dashboard is **local only**, reading the project's files directly. Demoed by screen share. | Free, simple, fully live; status data never leaves the machine. |
| D-04 | **Approvals happen in Claude Code**; the dashboard shows them read-only. Dashboard approve buttons are a stretch goal. | Reliable from day one; no watcher or polling needed. |
| D-05 | Mentor demo in **about one month**: full Kit first, then CookNeighbour V1. | Jimmy's timeline. |
| D-06 | The team is defined in **`team.json`**; unknown subagents appear at a **visitor hot desk**. | Each project can change its team without editing the Kit; nothing is hidden. |
| D-07 | The Kit **requires Superpowers**; the installer checks for it. | Agents use Superpowers skills as their working methods; keeps the Kit small. |
| D-08 | **Hybrid status:** hooks record facts, agents add the story through `team-status`, the Planner owns the board, all written to an **append-only event log**. | Reliable facts plus rich detail; no write conflicts between parallel agents. |
| D-09 | The Planner drafts plan summaries for routine batches; it starts an agent for its summary only when real investigation is needed. | Each subagent start is a full cold start, which is expensive for 100 words. |
| D-10 | The Frontend agent uses **`artifact-design`** (design guidance only) and **`frontend-design`**. | Jimmy's request; better visual quality. |
| D-11 | Default theme is **Cozy day**; Night shift and Pastel through a toggle. | Jimmy's choice. |
| D-12 | Task board is the building's **lobby floor**; at most 3 tickets per column, then "and N more". | Keeps everything in one picture without the lobby outgrowing the building. |
| D-13 | Handoffs travel through a **ceiling mail tube**, played once per real handoff. | The paper plane read as random; the tube shows sender and receiver. |

---

## 4. Architecture

### 4.1 Key constraint
Claude Code subagents cannot start other subagents. **The Planner is therefore the main Claude Code session**, with its role loaded from instructions. Backend, Frontend, Tester and Reviewer are real subagents started by the Planner. Jimmy opens one Claude Code tab.

### 4.2 Kit repo layout

```
agent-team-kit/
├── agents/            backend.md, frontend.md, tester.md, reviewer.md
├── planner/           planner.md (role + gate rules), work-order-template.md
├── hooks/             Node scripts that append events to the log
├── cli/               team-status command
├── dashboard/         office web app (Vite + React + TypeScript + Tailwind) and its local server
├── templates/         default team.json, CLAUDE.md "Team" section, handoff template
├── install.mjs        installer / updater / uninstaller
└── test/              Vitest unit tests, Playwright dashboard tests, installer fixtures
```

### 4.3 What a project contains after install

```
.claude/agents/*.md        the 4 subagents
.claude/settings.json      Kit hook entries, merged with existing hooks
.team/team.json            team definition (committed)
.team/bin/                 team-status + hook scripts (committed)
.team/handoffs/            one handoff file per task (committed)
.team/events.jsonl         append-only event log (gitignored)
agent-status.json          snapshot in the CLAUDE.md schema (gitignored)
CLAUDE.md                  "Team" section between Kit markers
```

Scripts are copied into the project so it keeps working if the Kit folder moves.

### 4.4 Tech choices
- Hooks and CLI: plain Node, **no dependencies**, so they start fast and cannot break on install.
- Dashboard: Vite, React, TypeScript, Tailwind; served with a small Node server bound to `127.0.0.1`.
- Tests: Vitest and Playwright.
- Runtime: Node 20 or newer.

---

## 5. The agents and the workflow

### 5.1 Agent definitions

Each `agents/*.md` file has Claude Code subagent frontmatter (name, description, tool list, model) and a body with: role, boundaries, Superpowers skills to use, reporting duties (section 6.3), and the handoff duty (section 5.4).

| Agent | Tools allowed | Not allowed | Skills | Default model |
|---|---|---|---|---|
| Backend | Read, Edit, Write, Bash, search | UI files | test-driven-development, verification-before-completion | Sonnet 5.5 |
| Frontend | Read, Edit, Write, Bash, search | Database and migrations | test-driven-development, verification-before-completion, frontend-design, artifact-design (design guidance only) | Sonnet 5.5 |
| Tester | Read, Write (test files), Bash, search | Editing application code | verification-before-completion, systematic-debugging | Sonnet 5.5 |
| Reviewer | Read, Bash (read-only commands: diffs, tests, lint), search | Edit, Write | requesting-code-review / code-review | Opus 5.5 |
| Planner (main session) | All | — | brainstorming, writing-plans, subagent-driven-development | Jimmy's session model |

- Limits are enforced through each agent's **tool list** where Claude Code supports it, and stated in the instructions where it does not (for example "UI files only"). Folder-level limits are instructions, so the Reviewer checks for boundary violations.
- Models are set per project in the agent files.
- `artifact-design` was written for claude.ai pages. The Frontend agent's instructions say to use its design guidance (tokens, themes, typography, spacing, mobile layout) and ignore its publishing rules.

### 5.2 Workflow per task batch

1. **Plan:** the Planner prepares a plan summary of 100 words or fewer per agent (D-09).
2. **Gate:** the Planner combines them into a Work Order and asks Jimmy per agent (Approve / Reject / Approve with changes) through Claude Code's question prompt. Affected agents show "Waiting for approval"; the approval is logged.
3. **Build:** approved builders work on a feature branch and open a pull request.
4. **Test:** the Tester verifies. A failure returns to the builder with specific notes.
5. **Review:** the Reviewer approves or requests changes on the pull request.
6. **Close:** the Planner merges, closes the Issue, updates the board.

After 2 failed rounds on the same task, the Planner stops and escalates to Jimmy. A rejected plan is revised once; after a second rejection the Planner asks Jimmy what he wants instead.

### 5.3 Planner instructions
`planner/planner.md` contains the Planner role, the approval gate (CLAUDE.md section 8 rules), how to write a Work Order (`work-order-template.md`), when to start which agent, how to pass handoffs, and the Planner's own `team-status` duties. The installer adds a short "Team" section to the project's `CLAUDE.md` that points to these rules.

### 5.4 Handoffs
Every agent finishes a task by writing `.team/handoffs/<task-id>.md` from the template:
- What changed (files, branch, pull request)
- How to verify it
- Known gaps or risks
- What the next agent needs

The Planner passes this file to the next agent, so no agent re-derives context. Writing a handoff also emits a `handoff` event, which drives the mail-tube animation.

---

## 6. Status pipeline

### 6.1 Event log
One file per project: `.team/events.jsonl`. One JSON object per line. Writers only ever **append**; nobody edits or rewrites the file (except rotation, section 6.6).

Common fields: `time` (ISO-8601), `agent` (team member id or subagent type), `type`, `source` (`hook` or `cli`).

| `type` | Written by | Extra fields |
|---|---|---|
| `agent_start` | hook | `task` (if known) |
| `agent_stop` | hook | — |
| `tool_use` | hook | `action` (short text, for example "editing pricing.ts") |
| `status` | CLI (agents) | `status`, `task`, `progress` (0–100), `nextStep`, `reason` (when blocked) |
| `task` | CLI (Planner) | `id`, `title`, `owner`, `state` (`todo` / `in_progress` / `in_review` / `done`), `notes` |
| `approval_requested` | CLI (Planner) | `id`, `summary`, `agents` |
| `approval_decided` | CLI (Planner) | `id`, `state` (`approved` / `rejected` / `changes_requested`), `note` |
| `handoff` | CLI (agents) | `from`, `to`, `task`, `file` |
| `escalation` | CLI (Planner) | `task`, `summary` |

### 6.2 Hooks (facts)
Candidate hook events, confirmed by spike S-0: the Planner starting a subagent (agent tool, before and after), subagent stop, and tool use (Edit, Write, Bash) for `tool_use` lines. Each hook script reads the hook input, appends one event, and **always exits successfully and quietly**, even on error, so it can never block Claude.

### 6.3 `team-status` CLI (story)
```
node .team/bin/team-status.mjs status --agent backend --status working --task T-004 --progress 40 --next "Write free-trial tests"
node .team/bin/team-status.mjs status --agent reviewer --status blocked --reason "Checks failing"
node .team/bin/team-status.mjs task --id T-004 --title "Pricing function" --owner backend --state in_progress
node .team/bin/team-status.mjs approval --id WO-3 --summary "..." --agents backend,frontend
node .team/bin/team-status.mjs decide --id WO-3 --state approved --note "..."
node .team/bin/team-status.mjs handoff --from backend --to tester --task T-004
node .team/bin/team-status.mjs escalate --task T-004 --summary "Failed review twice"
```
Agent instructions require a `status` call at task start, at each milestone, when blocked, and at finish. Invalid arguments print a clear error and write nothing.

### 6.4 State reconstruction (dashboard server)
The server reads the log and folds events into current state: latest values per agent, the task board, approvals, and the last 20 events per agent. It writes `agent-status.json` in the CLAUDE.md schema and serves it at `GET /api/team`. The page polls every **3 seconds**.

`agent-status.json` keeps the CLAUDE.md schema unchanged and adds only optional fields (for example per agent `lastAction`, `stale`, `color`; top level `needsYou`). The full shape is the `TeamState` type in the implementation plan, Task 5.

**Rules:**
- **Facts beat stories:** after `agent_stop`, the agent shows `done` (or `idle` once its task is closed) even if its last report said 60%; the clipboard notes "stopped at 60%".
- **Stale guard:** an agent marked `working` with no event for `staleAfterMinutes` (default 5) is flagged "last update N min ago".
- **Jimmy's status** is derived: `awaiting_approval` when any approval is pending, otherwise `idle`.
- **Needs you** includes pending approvals, blocked agents, and escalations.
- **Bad lines** are skipped with a server warning; the dashboard keeps working.
- **Unknown agents** (not in `team.json`) appear at the visitor hot desk.

### 6.5 Fallback if hooks cannot identify the subagent (assumption A2)
`tool_use` events without an agent id are assigned to the most recently started subagent that has not stopped. If several are running in parallel, the line is shown as "team activity" instead of being guessed onto a desk.

### 6.6 Log rotation
When `events.jsonl` exceeds about 5 MB, the server moves older events to `.team/events-YYYY-MM-DD.jsonl`, keeping current state intact.

---

## 7. The office dashboard

Visual reference: the approved mockup file linked at the top.

### 7.1 Scene: the sunny cutaway
- A small building with its front wall removed, against a sky with slowly drifting clouds. The roof shows the project name from `team.json`.
- **One room per team member**, painted in that member's colour, laid out in a grid (3 columns on desktop, 2 on phones). Room order follows `team.json`; the approver (Jimmy) always gets the top-right corner office with an in-tray holding one sheet per pending approval.
- **Visitor hot desk** room appears only when an unknown agent is active.
- **Lobby floor** below the rooms holds the task board (section 7.4).
- **Clipboard** on the right pins the selected agent's details.

### 7.2 Room states (lights tell the state)
| State | Room | Figure | Door plaque |
|---|---|---|---|
| working | Lamp on, warm glow | Typing | Working |
| idle | Lights dimmed | Coffee steaming | On a break |
| blocked | Red light pulsing | Red "!" bubble | Stuck |
| awaiting_approval | Yellow light | Hand raised, yellow "?" nudging | Waiting for approval |
| done | Lights dimmed | Still | Finished (green) |

Motion is used for state only: calm states stay calm; only "stuck" and "waiting" draw the eye.

### 7.3 Needs-you sign
A sign hangs from the roof when anything needs Jimmy, for example "Jimmy, 2 things need you", with a one-line summary. Clicking it pins Jimmy's clipboard, which lists each pending Work Order summary, blocked agent, and escalation. No sign when nothing is waiting.

### 7.4 Lobby task board
Four columns (To do, In progress, In review, Done) with counts. Each ticket shows task id, title, owner, and progress if in progress, with a left edge in the owner's colour. At most 3 tickets per column, then "and N more"; clicking that opens the full list.

### 7.5 Handoff mail tube
A tube runs along the ceiling between rooms. On a `handoff` event, a folder travels from the sender's room to the receiver's, and the receiver's door plaque shows "New from <sender>" for a few seconds. Plays once per event.

### 7.6 Clipboard (details)
Name, role, status, current task, reason when stuck, progress bar (0–100%) in the agent's colour, next step, "updated N seconds ago", stale warning if any, and the last 20 events. Hovering a room shows a short preview; clicking (or Enter/Space when focused) pins it.

### 7.7 Themes and visual system
- Default palette: sky `#9fd3f0` / `#c9ecff`, building frame teal `#2f6f73`, indigo ink `#2e2a4f`, wood `#c98b4f`, paper `#fffdf7`, alert `#f25c54`, approval marigold `#ffc233`. Agent colours come from `team.json`.
- Typeface: Bricolage Grotesque (Google Fonts), with a system font fallback.
- Night shift and Pastel are alternative palettes through a toggle; the choice is remembered per browser (safe if storage is unavailable).

### 7.8 Accessibility and fallbacks
- Every room is keyboard-focusable with a visible focus ring and a descriptive label.
- `prefers-reduced-motion` turns all animation off.
- A plain-text list view of agents, tasks, and approvals is available from a toggle and is the default below a narrow width.
- If `team.json` is missing or invalid, the page explains what is wrong and how to fix it.
- If the server is unreachable, a "paused, reconnecting" overlay appears.

### 7.9 Running it
```
npm run office -- --project ../CookNeighbour
```
Run from the Kit folder; opens the browser at a localhost address.

---

## 8. team.json

```json
{
  "project": "CookNeighbour",
  "staleAfterMinutes": 5,
  "approver": { "id": "jimmy", "name": "Jimmy", "role": "Product owner. Approves every Work Order", "color": "#ffe08a" },
  "members": [
    { "id": "planner",  "name": "Planner",  "role": "Plans the work and hands it out", "color": "#b9a7ff" },
    { "id": "backend",  "name": "Backend",  "role": "Database, APIs and business rules", "color": "#9ee0bf" },
    { "id": "frontend", "name": "Frontend", "role": "Pages and screens", "color": "#ffc49a" },
    { "id": "tester",   "name": "Tester",   "role": "Writes tests and reports bugs", "color": "#a9d2ff" },
    { "id": "reviewer", "name": "Reviewer", "role": "Final check before anything ships", "color": "#ffb3c9" }
  ]
}
```
A member `id` matches its subagent name in `.claude/agents/`. Adding a member means adding an entry here and an agent file.

---

## 9. Installer

`node install.mjs --target <project>`:

1. **Checks:** Node 20+, target is a Git repo, Superpowers and frontend-design plugins installed. Stops with a clear message if anything is missing.
2. **Preview:** lists every file it will add or change and asks y/n. Nothing changes before "yes".
3. **Agents:** copies into `.claude/agents/`; if a project's copy was customised, shows the difference and asks before replacing.
4. **Hooks:** merges Kit entries into `.claude/settings.json` without removing existing hooks; writes `settings.json.bak` first.
5. **`.team/`:** creates `team.json` (only if missing), `bin/`, `handoffs/`.
6. **`.gitignore`:** adds `.team/events*.jsonl`, `agent-status.json`, `.superpowers/` if not already present.
7. **`CLAUDE.md`:** inserts or updates the "Team" section between `<!-- agent-team-kit:start -->` and `<!-- agent-team-kit:end -->`.

Re-running updates in place (idempotent). `--uninstall` removes only what the Kit added, using the markers and its own file list, and leaves `team.json` and handoffs unless asked.

---

## 10. Testing

| Area | Tests |
|---|---|
| State reconstruction | Vitest: ordering, facts beat stories, stale guard, derived Jimmy status, needs-you list, bad lines skipped, unknown agent to visitor desk, rotation keeps state |
| `team-status` CLI | Vitest: each subcommand, invalid arguments write nothing, exactly one line appended |
| Hook scripts | Vitest with sample hook input: correct event written; malformed input still exits successfully |
| Installer | Vitest against temporary Git repos: fresh install, re-install without duplicates, customised agent kept on "no", existing hooks preserved, uninstall leaves the repo clean |
| Dashboard | Playwright: rooms render from `team.json`, clicking and keyboard pin the clipboard, needs-you sign appears and disappears, lobby caps at 3 per column, reduced motion disables animation, list view, error states |
| End to end | Install into a sample repo, run one real subagent task through the Planner, confirm the office reflects start, progress, handoff, and stop |

Built test-first (Superpowers TDD). CI on GitHub Actions runs lint, Vitest and Playwright on every pull request.

---

## 11. Build order (input to the implementation plan)

1. **S-0 spike (throwaway):** record real hook input for subagent start, stop, and tool use inside a subagent. Resolves A1 and A2; the plan branches on the result.
2. Repo setup: `agent-team-kit` repo, branch protection, templates, CI.
3. Event log, state reconstruction, `team-status` CLI.
4. Hook scripts.
5. Agent definitions, Planner instructions, templates.
6. Installer.
7. Dashboard server and office UI.
8. End-to-end check on a sample repo, then install into CookNeighbour.

---

## 12. Out of scope (V1) and stretch goals

**Out of scope:** hosted or shared dashboard, approving from the dashboard, sound, multiple projects in one dashboard, a Claude Code plugin package, publishing to npm.

**Stretch goals:** Approve / Reject buttons on the dashboard (local only); a Claude Code `Notification` hook for desktop alerts when approval is needed.

---

## 13. Prerequisites for Jimmy

- Upgrade Node to the current LTS (v24 or newer) from nodejs.org (currently v18.16.0).
- Install the GitHub CLI from cli.github.com, needed for Issues and pull requests from the terminal. Homebrew is currently broken on this Mac (Intel Homebrew on Apple Silicon), so use the website installers.
- Create the `agent-team-kit` repo on GitHub as **private** (or let the Planner do it once `gh` is installed and the Work Order is approved).
- Superpowers and frontend-design plugins: already installed.

---

## 14. Effect on CookNeighbour

After this spec is approved, CookNeighbour's `CLAUDE.md` needs edits, submitted in a Work Order for Jimmy's approval:
- Section 6.10 (`/team` page): replace with a pointer to the Kit; the Agent Control Room is no longer built inside the app.
- Section 8 (agent team and gate): shorten to a pointer to the Kit's "Team" section, so the rules exist in one place.
- Section 12, success criterion 6: refer to the Kit's office instead of `/team`.

---

## 15. Open questions and risks

- **Hook data (A1, A2):** if hooks expose less than expected, "last action" accuracy drops (fallback in 6.5). Resolved by S-0.
- **Agent discipline:** agents may still skip `team-status` calls. Mitigated by the stale guard and by hooks providing the facts.
- **Token cost:** five agents on real tasks cost more than one session. Mitigated by D-09, handoffs, and Sonnet for builders. Worth watching during CookNeighbour.
- **Claude Code changes:** hook and subagent formats may change between versions. The installer and hooks should fail softly and the README should name the Claude Code version tested.
- **Font loading:** the dashboard loads one Google Font; it falls back to a system font offline.
