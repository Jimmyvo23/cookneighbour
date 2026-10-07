# Agent Team Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `agent-team-kit`, a reusable package that installs a five-role Claude Code team (Planner plus four subagents) into any Git project and shows the team's live state in a local stick-figure office dashboard.

**Architecture:** Hooks and a `team-status` CLI append events to `.team/events.jsonl` in the target project. A pure `buildState()` folds events into the CLAUDE.md `agent-status.json` schema. A local Node server serves that state at `/api/team` to a React office UI polling every 3 s. An idempotent installer copies agents, hooks, scripts and a marked CLAUDE.md section into the project.

**Tech Stack:** Node 20+ (plain ESM `.mjs` with `// @ts-check` and JSDoc for everything copied into projects, zero runtime dependencies), Vitest, Vite + React + TypeScript + Tailwind for the dashboard, Playwright, GitHub Actions.

**Spec:** [docs/superpowers/specs/2026-10-05-agent-team-kit-design.md](../specs/2026-10-05-agent-team-kit-design.md) (read it alongside this plan; the approved visual design is [the office mockup](../specs/2026-10-05-agent-team-kit-office-mockup.html))

## Global Constraints

- Every batch of tasks below starts only after Jimmy approves its Work Order (CookNeighbour CLAUDE.md section 8). Batches are listed in "Work Order batches" at the end.
- Node `>=20` (`"engines": { "node": ">=20" }`).
- Everything under `lib/`, `cli/`, `hooks/` is plain ESM `.mjs`, `// @ts-check`, **no npm dependencies** (Node built-ins only), because it is copied into projects.
- Agent statuses: `idle | working | blocked | awaiting_approval | done`. Approval states: `pending | approved | rejected | changes_requested`. Task states: `todo | in_progress | in_review | done`.
- Event types: `agent_start | agent_stop | tool_use | status | task | approval_requested | approval_decided | handoff | escalation | snapshot` (`snapshot` is written only by log rotation).
- `staleAfterMinutes` default `5`. Poll interval `3000` ms. Rotation threshold `5_000_000` bytes. Lobby shows at most `3` tickets per column. Clipboard shows last `20` events per agent.
- Dashboard server binds `127.0.0.1` only. Default port `4317`.
- Hook scripts print **nothing** to stdout or stderr and always exit `0`.
- Hook commands in `settings.json` reference `"$CLAUDE_PROJECT_DIR/.team/bin/hooks/record.mjs"` with the path in double quotes (Jimmy's paths contain spaces).
- State labels shown in the UI, exactly: working = `Working`, idle = `On a break`, blocked = `Stuck`, awaiting_approval = `Waiting for approval`, done = `Finished`.
- Default palette: sky `#9fd3f0` / `#c9ecff`, frame `#2f6f73`, ink `#2e2a4f`, wood `#c98b4f`, paper `#fffdf7`, alert `#f25c54`, approval `#ffc233`. Font: Bricolage Grotesque with system fallback. Default theme Cozy day; alternatives Night shift, Pastel.
- UI copy is plain sentence case; no all-caps labels, no `·`-joined meta strings, no `→` on buttons (frontend-design rules adopted in brainstorming).
- Never push to `main`, never force-push, never commit secrets. Every task is a feature branch plus a pull request.

## Review Focus

1. **Project paths with spaces** (Jimmy's is `/Users/kienvo/Desktop/Claude projects/...`): hooks, CLI and installer must work. Pinned in Tasks 8 and 11.
2. **Parallel agents appending at the same moment, or a half-written last line**: the reader ignores a trailing line without `\n` without warning, and interleaved complete lines all parse. Pinned in Task 3.
3. **Hook output leaking into Claude's context**: any stdout from a hook can be fed to the model. Hooks must stay silent even on malformed input. Pinned in Task 8.
4. **Existing `settings.json` that is invalid JSON or has its own hooks**: the installer refuses invalid JSON with a clear message and never drops existing hooks. Pinned in Tasks 10 and 11.
5. **Agent id casing mismatch** (`Backend` from a hook vs `backend` in `team.json`): ids are matched case-insensitively and trimmed, so no false visitor desks. Pinned in Task 5.

---

## File structure (agent-team-kit repo)

```
package.json                 scripts: test, test:e2e, lint, build, office
lib/events.mjs               event validation, append, read
lib/team.mjs                 load and validate team.json
lib/state.mjs                buildState(): events -> TeamState
lib/rotate.mjs               log rotation with snapshot
lib/paths.mjs                findProjectRoot(), logPath()
cli/team-status.mjs          CLI entry
hooks/record.mjs             single hook entry, mapHookInput()
agents/{backend,frontend,tester,reviewer}.md
planner/planner.md, planner/work-order-template.md
templates/team.json, templates/claude-team-section.md, templates/handoff-template.md
lib/install/checks.mjs       prerequisite checks
lib/install/text.mjs         marked sections, gitignore, hook merge (pure)
lib/install/plan.mjs         planInstall / planUninstall / applyChanges
install.mjs                  installer CLI
dashboard/server.mjs         createOfficeServer()
dashboard/src/...            React UI (Tasks 13–14)
scripts/office.mjs           npm run office launcher
test/                        *.test.mjs (Vitest), e2e/*.spec.ts (Playwright), fixtures/
docs/decisions/S-0-hook-input.md
```

---

### Task 1: Repo, tooling and CI  *(owner: Planner)*

**Files:**
- Create: `package.json`, `.gitignore`, `eslint.config.mjs`, `vitest.config.mjs`, `playwright.config.ts`, `README.md` (stub), `.github/workflows/ci.yml`, `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/task.md`, `docs/superpowers/specs/` (move the spec and mockup here from CookNeighbour)
- Test: `test/smoke.test.mjs`

**Interfaces:**
- Produces: `npm test` (Vitest), `npm run test:e2e` (Playwright), `npm run lint`; CI running all three on every pull request.

- [ ] **Step 1: Decision gate.** GitHub Free does not enforce branch protection on **private** repos. Ask Jimmy: (a) private repo, protection by rule only (agents never push to `main`), or (b) public repo with enforced protection. CLAUDE.md requires asking before going public. Record the answer in `README.md` "Repo decisions".
- [ ] **Step 2:** `gh repo create Jimmyvo23/agent-team-kit --private --clone` (or `--public` per Step 1). Explain to Jimmy in one paragraph what a remote repo and a clone are.
- [ ] **Step 3:** Create `package.json` (`"type": "module"`, engines `>=20`, devDependencies: vitest, eslint, typescript, vite, react, react-dom, @vitejs/plugin-react, tailwindcss, @playwright/test). `.gitignore` excludes `node_modules`, `dist`, `.env*`, `test-results`, `.superpowers/`.
- [ ] **Step 4: Write `test/smoke.test.mjs`**

```js
import { test, expect } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
test('package targets node 20+', () => { expect(pkg.engines.node).toBe('>=20'); });
```

- [ ] **Step 5:** Run `npm test`. Expected: 1 passed.
- [ ] **Step 6:** `ci.yml`: on `pull_request`, Node 20, `npm ci`, `npm run lint`, `npm test`, `npx playwright install --with-deps chromium`, `npm run test:e2e -- --pass-with-no-tests`.
- [ ] **Step 7:** If Step 1 chose public: `gh api` branch protection on `main` requiring the CI check and one review. Explain branch protection to Jimmy in one paragraph.
- [ ] **Step 8:** Commit on `feature/T-001-repo-setup`, push, open the first pull request, explain what a pull request is, wait for green CI, merge after Reviewer approval.

---

### Task 2: S-0 spike — what hooks really receive  *(owner: Backend; throwaway code)*

**Files:**
- Create: `docs/decisions/S-0-hook-input.md`, `test/fixtures/hooks/*.json` (sanitized real samples)
- Throwaway (not committed): a scratch repo with a logging hook

**Interfaces:**
- Produces: fixture files named `pre-agent.json`, `post-agent.json`, `subagent-stop.json`, `subagent-start.json` (if the event exists), `tool-in-subagent.json`, `tool-in-main.json`, `post-agent-background.json`; and the decision doc answering the questions below. Task 8 tests read these fixtures.

- [ ] **Step 1:** In a scratch Git repo, configure every candidate hook event (`PreToolUse` and `PostToolUse` matched on the agent tool, `SubagentStart` if Claude Code supports it, `SubagentStop`, `PostToolUse` on `Edit|Write|Bash`) to run `cat >> "$CLAUDE_PROJECT_DIR/hook-dump.jsonl"`. Check current Claude Code hook docs for event names first.
- [ ] **Step 2:** Define one tiny test subagent; from the main session start it once in the foreground and once in the background; have it edit a file and run `echo hi`.
- [ ] **Step 3:** Answer in the decision doc, each with the exact JSON field path:
  1. Which field gives the subagent type at start?
  2. Does `PostToolUse` on the agent tool fire at launch or at finish for **background** subagents?
  3. Does `SubagentStop` identify which subagent stopped?
  4. Does a tool call inside a subagent identify the subagent?
  5. What is the exact agent tool name (`Agent`, `Task`, other)?
- [ ] **Step 4:** Record the Claude Code version tested. Choose: the hook-to-event mapping for Task 8, and whether spec section 6.5's fallback is needed. Strip any personal paths from fixtures.
- [ ] **Step 5:** Commit doc and fixtures on `feature/T-002-hook-spike`; pull request.

---

### Task 3: Event log  *(owner: Backend)*

**Files:**
- Create: `lib/events.mjs`, `lib/paths.mjs`
- Test: `test/events.test.mjs`, `test/paths.test.mjs`

**Interfaces:**
- Produces:
  - `EVENT_TYPES: readonly string[]`, `AGENT_STATUSES`, `TASK_STATES`, `APPROVAL_STATES` (values from Global Constraints)
  - `validateEvent(e: object): { ok: true } | { ok: false, error: string }`
  - `appendEvent(logPath: string, event: object, now?: Date): void` — adds `time` (ISO) if missing, validates, throws `Error` on invalid, writes `JSON.stringify(e) + '\n'` with one `fs.appendFileSync` call (creating `.team/` if needed)
  - `readEvents(logPath: string): { events: object[], warnings: string[] }` — missing file → `{ events: [], warnings: [] }`
  - `findProjectRoot(startDir: string): string | null` — nearest ancestor containing `.team/`; `logPath(root: string): string` → `<root>/.team/events.jsonl`

- [ ] **Step 1: Write failing tests**

```js
test('validates required fields per type', () => {
  expect(validateEvent({ type: 'status', agent: 'backend', source: 'cli', status: 'working' }).ok).toBe(true);
  expect(validateEvent({ type: 'status', agent: 'backend', source: 'cli', status: 'sleeping' })).toEqual({ ok: false, error: expect.stringContaining('status') });
  expect(validateEvent({ type: 'status', agent: 'backend', source: 'cli', status: 'blocked' }).ok).toBe(false); // reason required
  expect(validateEvent({ type: 'status', agent: 'b', source: 'cli', status: 'working', progress: 101 }).ok).toBe(false);
  expect(validateEvent({ type: 'nope', agent: 'b', source: 'cli' }).ok).toBe(false);
});
test('append then read round-trips and adds time', () => {
  appendEvent(p, { type: 'agent_start', agent: 'backend', source: 'hook' }, new Date('2026-10-05T10:00:00Z'));
  expect(readEvents(p).events[0].time).toBe('2026-10-05T10:00:00.000Z');
});
test('malformed complete line is skipped with a warning', () => {
  fs.writeFileSync(p, '{"type":"agent_start","agent":"a","source":"hook","time":"t"}\nnot json\n');
  const r = readEvents(p); expect(r.events).toHaveLength(1); expect(r.warnings).toHaveLength(1);
});
test('trailing line without newline is ignored silently (write in progress)', () => {
  fs.writeFileSync(p, '{"type":"agent_start","agent":"a","source":"hook","time":"t"}\n{"type":"agent_st');
  const r = readEvents(p); expect(r.events).toHaveLength(1); expect(r.warnings).toHaveLength(0);
});
test('works in a directory with spaces', () => { /* p under tmp/"Claude projects"/.team */ });
test('findProjectRoot walks up to the folder containing .team', () => { /* root/.team + root/a/b → root */ });
```

Required fields per type: `agent_start`/`agent_stop` (agent); `tool_use` (agent, action); `status` (agent, status; `reason` if blocked; `progress` integer 0–100 if present); `task` (id, title, owner, state); `approval_requested` (id, summary); `approval_decided` (id, state ≠ pending); `handoff` (from, to, task); `escalation` (task, summary); `snapshot` (state). All need `type`, `source ∈ {hook, cli, server}`.

- [ ] **Step 2:** `npx vitest run test/events.test.mjs test/paths.test.mjs` — FAIL (module not found).
- [ ] **Step 3:** Implement both modules.
- [ ] **Step 4:** Re-run — PASS.
- [ ] **Step 5:** Commit on `feature/T-003-event-log`; pull request.

---

### Task 4: Team file  *(owner: Backend)*

**Files:**
- Create: `lib/team.mjs`, `templates/team.json` (exact content from spec section 8)
- Test: `test/team.test.mjs`

**Interfaces:**
- Produces: `loadTeam(path: string): { ok: true, team: Team } | { ok: false, error: string }` where `Team = { project, staleAfterMinutes, approver: Member, members: Member[] }`, `Member = { id, name, role, color }`; ids normalized with `trim().toLowerCase()`; `staleAfterMinutes` defaults to `5`.

- [ ] **Step 1: Write failing tests**

```js
test('loads the template', () => { const r = loadTeam('templates/team.json'); expect(r.ok && r.team.members.map(m => m.id)).toEqual(['planner','backend','frontend','tester','reviewer']); });
test('missing file', () => expect(loadTeam('/nope.json')).toEqual({ ok: false, error: expect.stringContaining('not found') }));
test('invalid JSON names the problem', () => expect(loadTeam(bad).error).toMatch(/not valid JSON/));
test('duplicate ids rejected', () => expect(loadTeam(dup).error).toMatch(/duplicate id "backend"/));
test('bad color rejected', () => expect(loadTeam(badColor).error).toMatch(/color/));
test('ids normalized', () => expect(loadTeam(mixedCase).team.members[0].id).toBe('backend'));
test('staleAfterMinutes defaults to 5', () => expect(loadTeam(noStale).team.staleAfterMinutes).toBe(5));
```

- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement (color must match `/^#[0-9a-f]{6}$/i`). **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit on `feature/T-004-team-file`; pull request.

---

### Task 5: State reconstruction  *(owner: Backend)*

**Files:**
- Create: `lib/state.mjs`
- Test: `test/state.test.mjs`

**Interfaces:**
- Consumes: event shapes (Task 3), `Team` (Task 4).
- Produces: `buildState(events: object[], team: Team, now: Date): TeamState`

```ts
TeamState = {
  updatedAt: string, project: string,
  agents: AgentState[],          // members in team.json order, then approver, then visitors
  approvals: { id, requestedBy, summary, state, requestedAt, decidedAt: string|null, note, agents: string[] }[],
  tasks: { id, title, owner, state, notes }[],
  log: { time, agent, event }[],               // last 100 overall, newest last
  agentLogs: Record<string, { time, event }[]>, // last 20 per agent
  needsYou: { kind: 'approval'|'blocked'|'escalation', id: string, summary: string }[],
  handoffs: { from, to, task, time }[]          // last 20
}
AgentState = { name, role, color, status, currentTask, progress, nextStep, reason, lastAction,
               updatedAt: string|null, stale: boolean, stoppedAtProgress: number|null,
               isApprover: boolean, isVisitor: boolean }
```

Folding rules (events processed in **file order**, not by `time`):
- `snapshot` → replace accumulated state with `event.state`.
- `agent_start` → `working`; `currentTask = event.task ?? currentTask`; clears `stoppedAtProgress`.
- `status` → sets every field present in the event.
- `tool_use` → `lastAction = event.action`; if status is `idle` or `done`, becomes `working`.
- `agent_stop` → `done`; `stoppedAtProgress = progress < 100 ? progress : null`.
- `task` → upsert by id; when state becomes `done` and the owner's status is `done`, owner becomes `idle`.
- `approval_requested` → pending approval; listed agents not `working` become `awaiting_approval`. `approval_decided` → updates it; listed agents still `awaiting_approval` become `idle`.
- `escalation` → stays in `needsYou` until a later `task` event for the same task id.
- Unknown agent ids → visitor (`isVisitor: true`, color `#d9d9e3`, role `Visitor`).
- Derived after folding: approver `status = awaiting_approval` if any approval pending else `idle`, `currentTask = "<n> decisions waiting"`; `stale = status === 'working' && now - updatedAt > staleAfterMinutes min`; `needsYou` = pending approvals, then blocked agents (summary = reason), then open escalations.
- Every event touching an agent sets its `updatedAt` and adds a human-readable line to `agentLogs` and `log` (e.g. `Started T-004`, `Editing pricing.ts`, `Stuck: Checks failing`).

- [ ] **Step 1: Write failing tests** (helper `ev(type, fields)` builds events with increasing `time`)

```js
test('initial state lists members idle, then approver', ...)          // statuses all 'idle', last agent isApprover
test('start → status → stop keeps facts over story', () => {
  const s = buildState([ev('agent_start',{agent:'backend',task:'T-004'}), ev('status',{agent:'backend',status:'working',progress:60}), ev('agent_stop',{agent:'backend'})], team, now);
  expect(agent(s,'backend')).toMatchObject({ status: 'done', stoppedAtProgress: 60, currentTask: 'T-004' });
});
test('tool_use sets lastAction and revives idle agent', ...)           // lastAction 'Editing pricing.ts', status 'working'
test('closing the task moves a done owner to idle', ...)
test('stale after 5 minutes of silence while working', ...)            // now = last +6 min → stale true; +4 min → false
test('approver awaiting while an approval is pending, idle after decision', ...)
test('approval puts listed non-working agents in awaiting_approval', ...)
test('needsYou order: approvals, blocked, escalations', ...)
test('escalation clears on next task event for that task', ...)
test('unknown agent becomes a visitor', ...)
test('agent ids match case-insensitively', () => expect(agent(buildState([ev('agent_start',{agent:' Backend '})],team,now),'backend').status).toBe('working'))
test('file order wins over timestamps', ...)                            // later line with earlier time still applies last
test('agentLogs capped at 20, log at 100, handoffs at 20', ...)
test('snapshot replaces prior state', ...)
```

- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement as a reducer over events plus a `derive()` pass. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit on `feature/T-005-state`; pull request.

---

### Task 6: Log rotation  *(owner: Backend)*

**Files:**
- Create: `lib/rotate.mjs`
- Test: `test/rotate.test.mjs`

**Interfaces:**
- Consumes: `readEvents`, `appendEvent`, `buildState`.
- Produces: `rotateIfNeeded(logPath: string, team: Team, now: Date, maxBytes = 5_000_000): { rotated: boolean, archivePath?: string }` — renames the log to `.team/events-YYYY-MM-DD.jsonl` (suffix `-2`, `-3` if taken) and starts a new log whose first line is `{ type: 'snapshot', source: 'server', state }` where `state` omits derived fields.

- [ ] **Step 1: Failing tests:** no rotation under the threshold; rotation over it (use `maxBytes = 200` in tests); `buildState(readEvents(new).events)` deep-equals the state before rotation (ignoring `updatedAt`); a second rotation the same day uses the `-2` suffix.
- [ ] **Step 2–4:** Run FAIL → implement → PASS.
- [ ] **Step 5:** Commit on `feature/T-006-rotation`; pull request.

---

### Task 7: `team-status` CLI  *(owner: Backend)*

**Files:**
- Create: `cli/team-status.mjs`
- Test: `test/cli.test.mjs`

**Interfaces:**
- Consumes: `appendEvent`, `findProjectRoot`, `logPath`.
- Produces: `main(argv: string[], opts: { cwd: string, env: object, now?: Date, stderr?: (s: string) => void }): number` (exit code). Root = `env.CLAUDE_PROJECT_DIR` if set, else `findProjectRoot(cwd)`. Subcommands (all events `source: 'cli'`):

| Subcommand | Flags | Event |
|---|---|---|
| `status` | `--agent --status [--task --progress --next --reason]` | `status` (`--next` → `nextStep`) |
| `task` | `--id --title --owner --state [--notes]` | `task`, agent `planner` |
| `approval` | `--id --summary [--agents a,b]` | `approval_requested`, agent `planner` |
| `decide` | `--id --state [--note]` | `approval_decided`, agent `planner` |
| `handoff` | `--from --to --task [--file]` | `handoff`, agent = from; file defaults to `.team/handoffs/<task>.md` |
| `escalate` | `--task --summary` | `escalation`, agent `planner` |

Exit `0` on success; exit `2` with a one-line usage message on stderr and **nothing written** for unknown subcommand, missing flag, invalid value, or no project root (`No .team folder found. Run the installer first.`). Use `node:util` `parseArgs`. The file is executable with `#!/usr/bin/env node`.

- [ ] **Step 1: Failing tests:** each subcommand writes exactly one line with the mapped fields; `--progress 40` stored as number `40`; `--status blocked` without `--reason` → exit 2, log unchanged; unknown subcommand → exit 2; root found through `CLAUDE_PROJECT_DIR` and through a nested `cwd`; works when the root path contains a space.
- [ ] **Step 2–4:** Run FAIL → implement → PASS.
- [ ] **Step 5:** Commit on `feature/T-007-cli`; pull request.

---

### Task 8: Hook recorder  *(owner: Backend)*

**Files:**
- Create: `hooks/record.mjs`, `templates/hooks.json` (the hook entries the installer merges)
- Test: `test/hooks.test.mjs` (uses Task 2 fixtures)

**Interfaces:**
- Consumes: `appendEvent`, `logPath`; fixtures and mapping decided in `docs/decisions/S-0-hook-input.md`.
- Produces:
  - `mapHookInput(kind: 'agent-start'|'agent-stop'|'tool', input: object): object | null` — pure; returns an event (`source: 'hook'`) or `null` to ignore.
  - CLI: `node record.mjs <kind>` reads stdin JSON, maps, appends to `logPath(env.CLAUDE_PROJECT_DIR)`; **any** error is swallowed; prints nothing; exits 0.
  - `templates/hooks.json`: the `hooks` object for `settings.json`, each command `node "$CLAUDE_PROJECT_DIR/.team/bin/hooks/record.mjs" <kind>`, event names and matchers per S-0.
- Action text for `tool_use`: Edit/Write → `Editing <basename>`; Bash → `Running <first two words of the command>` (never the full command, which may contain secrets).
- Agent id for `tool_use`: the subagent field found in S-0, lowercased; if S-0 found none, use the most recent unstopped `agent_start` from the log only when exactly one is open, otherwise agent `team` (spec 6.5).

- [ ] **Step 1: Failing tests**

```js
test('maps start fixture to agent_start with subagent id', () => expect(mapHookInput('agent-start', fx('pre-agent'))).toMatchObject({ type: 'agent_start', agent: 'tester-probe' }));
test('maps stop fixture to agent_stop', ...)
test('Edit inside subagent → Editing <file>', ...)
test('Bash action keeps only two words', () => expect(mapHookInput('tool', bash('npm test -- --token=abc')).action).toBe('Running npm test'));
test('unrelated tool returns null', ...)
test('script is silent and exits 0 on garbage stdin', () => {
  const r = spawnSync('node', ['hooks/record.mjs', 'tool'], { input: 'not json', env: { ...process.env, CLAUDE_PROJECT_DIR: tmpWithSpace } });
  expect([r.status, r.stdout.length, r.stderr.length]).toEqual([0, 0, 0]);
});
test('script is silent and exits 0 when .team is missing', ...)
test('script appends one event for a valid fixture in a path with spaces', ...)
```

- [ ] **Step 2–4:** Run FAIL → implement → PASS.
- [ ] **Step 5:** Commit on `feature/T-008-hooks`; pull request.

---

### Task 9: Agents, Planner instructions and templates  *(owner: Planner; Reviewer checks wording)*

**Files:**
- Create: `agents/backend.md`, `agents/frontend.md`, `agents/tester.md`, `agents/reviewer.md`, `planner/planner.md`, `planner/work-order-template.md`, `templates/claude-team-section.md`, `templates/handoff-template.md`
- Test: `test/agents.test.mjs`

**Interfaces:**
- Produces: agent files with Claude Code subagent frontmatter (`name`, `description`, `tools`, `model`) per spec 5.1; `claude-team-section.md` (short: points to `planner/planner.md` copied as `.team/planner.md`, lists the gate, the workflow, the `team-status` duties). Content per spec 5.1–5.4 and CLAUDE.md section 8.

Each agent body contains, in this order: Role; Boundaries; Skills to use (exact Superpowers skill names); Reporting (`team-status status` at start, each milestone, when blocked, at finish, with example commands); Handoff (write `.team/handoffs/<task>.md` from the template, then `team-status handoff`). Frontend adds: use `frontend-design` and `artifact-design`, the latter for design guidance only, ignoring its publishing rules.

- [ ] **Step 1: Failing tests**

```js
test('every team.json member except planner has an agent file whose name matches', ...)
test('reviewer has no Edit or Write tool', () => expect(front('reviewer').tools).not.toMatch(/\b(Edit|Write)\b/));
test('models: builders and tester sonnet, reviewer opus', ...)
test('every agent file mentions team-status and .team/handoffs', ...)
test('frontend names frontend-design and artifact-design', ...)
test('planner.md contains the 100-word summary rule, the 2-failed-rounds escalation and the per-agent approval', ...)
```

- [ ] **Step 2–4:** Run FAIL → write the files → PASS. Check tool and model field formats against current Claude Code subagent docs.
- [ ] **Step 5:** Commit on `feature/T-009-agents`; pull request.

---

### Task 10: Installer building blocks  *(owner: Backend)*

**Files:**
- Create: `lib/install/checks.mjs`, `lib/install/text.mjs`
- Test: `test/install-text.test.mjs`, `test/install-checks.test.mjs`

**Interfaces:**
- Produces:
  - `checkPrereqs({ targetDir, nodeVersion, homeDir }): string[]` — messages for: Node major < 20; target not a Git repo; Superpowers missing; frontend-design missing (plugin detected by a directory named `superpowers` / `frontend-design` under `<homeDir>/.claude/plugins/cache/*/`).
  - `upsertMarked(text: string, body: string, markers: { start: string, end: string }): string`; `removeMarked(text, markers): string`
  - `MD_MARKERS = { start: '<!-- agent-team-kit:start -->', end: '<!-- agent-team-kit:end -->' }`, `GITIGNORE_MARKERS = { start: '# agent-team-kit:start', end: '# agent-team-kit:end' }`
  - `mergeHooks(settings: object, kitHooks: object): object` and `removeKitHooks(settings: object): object` — a Kit entry is any hook whose command contains `.team/bin/hooks/record.mjs`.
  - `parseSettings(text: string | null): { ok: true, settings: object } | { ok: false, error: string }` (null → `{}`).

- [ ] **Step 1: Failing tests:** upsert appends when absent, replaces when present, is idempotent (`upsert(upsert(t)) === upsert(t)`); remove restores the original text; `mergeHooks` keeps a pre-existing user `PreToolUse` hook and adds Kit ones; merging twice adds nothing new; `removeKitHooks` leaves only the user's hook; `parseSettings('{ bad')` → `ok: false` with `settings.json is not valid JSON`; `checkPrereqs` returns one message per missing item and `[]` when all present (fake `homeDir` tree).
- [ ] **Step 2–4:** Run FAIL → implement → PASS.
- [ ] **Step 5:** Commit on `feature/T-010-install-blocks`; pull request.

---

### Task 11: Installer  *(owner: Backend; Tester adds the fixture repos)*

**Files:**
- Create: `lib/install/plan.mjs`, `install.mjs`
- Test: `test/install.test.mjs`

**Interfaces:**
- Consumes: Task 10 functions; files from Tasks 7–9.
- Produces:
  - `planInstall({ kitDir, targetDir }): Change[]` and `planUninstall({ targetDir }): Change[]`, `Change = { path, action: 'create'|'update'|'unchanged'|'conflict'|'delete', content?: string, reason?: string }`
  - `applyChanges(changes, { targetDir, resolveConflict: (c: Change) => boolean }): void`
  - Manifest `.team/kit-manifest.json`: `{ version, files: Record<path, sha256> }`. A copied file whose current hash differs from the manifest is `conflict` (customized); `resolveConflict` false keeps it.
  - CLI: `node install.mjs --target <dir> [--uninstall] [--yes]`; prints checks, then the change list, asks `Apply these changes? (y/n)` unless `--yes`; exit 1 on failed checks or invalid `settings.json`, with the message and nothing changed.

Install writes: `.claude/agents/*.md`; `.claude/settings.json` (merged; old copy to `.claude/settings.json.bak`); `.team/team.json` only if missing; `.team/bin/team-status.mjs`, `.team/bin/hooks/record.mjs` and the `lib/` modules they import (into `.team/bin/lib/`); `.team/planner.md`, `.team/work-order-template.md`, `.team/handoffs/` with the template; `.gitignore` marked block (`.team/events*.jsonl`, `agent-status.json`, `.superpowers/`); `CLAUDE.md` marked section. Uninstall removes manifest-listed files, Kit hooks, both marked blocks and the manifest; keeps `team.json` and handoffs.

- [ ] **Step 1: Failing tests** (each in a fresh temp Git repo whose path contains a space; checks stubbed to pass):

```js
test('fresh install creates expected files and CLAUDE.md section', ...)
test('second install reports every change as unchanged', ...)
test('customized agent is a conflict and is kept when resolveConflict returns false', ...)
test('existing user hook survives install and uninstall', ...)
test('invalid settings.json aborts with message and changes nothing', ...)   // compare directory snapshot before/after
test('installed team-status runs from the target and appends an event', ...) // spawn node .team/bin/team-status.mjs status ...
test('uninstall leaves the repo as before except team.json and handoffs', ...)
test('--yes skips the prompt; without it, answering n changes nothing', ...)
```

- [ ] **Step 2–4:** Run FAIL → implement → PASS.
- [ ] **Step 5:** Commit on `feature/T-011-installer`; pull request.

---

### Task 12: Dashboard server  *(owner: Backend)*

**Files:**
- Create: `dashboard/server.mjs`
- Test: `test/server.test.mjs`, fixtures `test/fixtures/projects/{busy,empty,bad-team}/.team/...`

**Interfaces:**
- Consumes: `loadTeam`, `readEvents`, `buildState`, `rotateIfNeeded`.
- Produces: `createOfficeServer({ projectDir, distDir, now = () => new Date() }): http.Server` (caller listens on `127.0.0.1`).
  - `GET /api/team` → `200` `TeamState` and writes `<projectDir>/agent-status.json`; invalid team → `500 { error, hint: 'Fix .team/team.json and this page will reload.' }`; read warnings go to the server console.
  - Other `GET` → static file from `distDir`, falling back to `index.html`; paths escaping `distDir` → `404`.
  - Calls `rotateIfNeeded` at most once per minute.

- [ ] **Step 1: Failing tests:** busy fixture → `200` with 5 members plus approver and expected statuses; `agent-status.json` written and contains CLAUDE.md keys `updatedAt, agents, approvals, tasks, log`; bad-team → `500` with `hint`; `GET /../package.json` → `404`; appending an event between two requests changes the response.
- [ ] **Step 2–4:** Run FAIL → implement → PASS.
- [ ] **Step 5:** Commit on `feature/T-012-server`; pull request.

---

### Task 13: Office UI — building, rooms, clipboard  *(owner: Frontend; uses frontend-design and artifact-design)*

**Files:**
- Create: `dashboard/index.html`, `dashboard/vite.config.ts`, `dashboard/src/main.tsx`, `App.tsx`, `api.ts` (`useTeamState()`), `theme.css` (tokens), `components/Building.tsx`, `Room.tsx`, `Figure.tsx`, `Clipboard.tsx`, `labels.ts`
- Test: `test/e2e/office.spec.ts`, `test/e2e/helpers.ts` (starts `createOfficeServer` on port 0 against a temp copy of a fixture project and builds `dist` once)

**Interfaces:**
- Consumes: `GET /api/team` → `TeamState` (Task 5 type, re-declared in `dashboard/src/types.ts`).
- Produces: `useTeamState(intervalMs = 3000): { state: TeamState | null, error: { error, hint } | null, offline: boolean }`; `STATE_LABELS` (Global Constraints); components used by Task 14.

Behaviour (match the mockup): roof shows `project`; one room per agent painted with its `color`; grid 3 columns, 2 below 760 px; approver in the top-right room with an in-tray holding one sheet per pending approval; room lights and figure motion per spec 7.2; hovering a room shows a short preview card (name, label, task, progress); each room is `role="button"` with `aria-label="<name>: <label>, <currentTask>"`, focusable, Enter/Space pins; clipboard (`<aside aria-label="Details">`) shows name, role, label, task, reason when stuck, progress bar, next step, `Updated N seconds ago`, `Last update N min ago` when stale, `Stopped at N%` when set, and the last 20 `agentLogs` entries.

- [ ] **Step 1: Failing Playwright tests**

```ts
test('renders one room per agent with the project on the roof', ...)        // 6 rooms for busy fixture, roof text 'CookNeighbour team'
test('room label uses the plain state wording', ...)                        // getByRole('button', { name: /Reviewer: Stuck/ })
test('hovering a room shows a preview card', ...)
test('clicking a room pins its clipboard', ...)                             // Details shows 'Write the free-trial tests'
test('keyboard: Tab to a room and press Enter pins it', ...)
test('updates within one poll after a new event is appended', ...)          // append status event, expect text within 4 s
test('stale agent shows last update warning', ...)
```

- [ ] **Step 2:** `npm run test:e2e` — FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit on `feature/T-013-office-ui`; pull request with a screenshot.

---

### Task 14: Office UI — needs-you, lobby, tube, themes, fallbacks  *(owner: Frontend; uses frontend-design and artifact-design)*

**Files:**
- Create: `dashboard/src/components/NeedsYouSign.tsx`, `Lobby.tsx`, `MailTube.tsx`, `ListView.tsx`, `ThemeToggle.tsx`, `StatusOverlay.tsx`; `dashboard/src/lobby.ts` (`capColumn`)
- Modify: `App.tsx`, `Building.tsx`, `theme.css`
- Test: `test/e2e/office-extras.spec.ts`, `test/lobby.test.mjs`

**Interfaces:**
- Consumes: Task 13 components and `useTeamState`.
- Produces: `capColumn<T>(items: T[], max = 3): { shown: T[], more: number }`.

Behaviour:
- Sign text `<approver name>, <n> things need you` (`1 thing needs you` when n = 1) plus a one-line summary of the first item; hidden when `needsYou` is empty; clicking pins the approver's clipboard, which lists every `needsYou` item.
- Lobby region `aria-label="Task board"`, columns To do / In progress / In review / Done with counts; ticket = id, title, owner, `NN%` when in progress, left edge in owner colour; `and N more` button expands the column.
- Mail tube animates a folder from sender room to receiver room only for handoffs newer than the first poll; receiver plaque reads `New from <sender>` for 4 s.
- Visitor hot desk room only when a visitor exists.
- Theme radio group `aria-label="Theme"`: Cozy day (default), Night shift, Pastel; stored in `localStorage` inside try/catch.
- List view toggle (`List view` / `Office view`); list view is default below 480 px.
- `prefers-reduced-motion: reduce` disables all animation.
- `StatusOverlay`: invalid team → heading `The team file has a problem`, the error, and the hint; offline → `Paused. Reconnecting…`.

- [ ] **Step 1: Failing tests:** `capColumn` unit tests (`[1..5]` → shown 3, more 2; `[]` → shown [], more 0); Playwright: sign shows `Jimmy, 2 things need you` on busy fixture and is absent on empty fixture; lobby shows 3 tickets plus `and 2 more` for a 5-task column; appending a handoff event shows `New from Backend` on the Tester room; visitor room appears after an unknown agent event; theme choice survives reload; with `reducedMotion: 'reduce'` no element has a running animation (`document.getAnimations().length === 0`); 360 px viewport opens in list view; bad-team fixture shows the problem heading; stopping the server shows `Paused. Reconnecting…`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit on `feature/T-014-office-extras`; pull request with screenshots of all three themes.

---

### Task 15: Launcher and README  *(owner: Backend; Reviewer checks README)*

**Files:**
- Create: `scripts/office.mjs`; Modify: `package.json` (`"office": "node scripts/office.mjs"`), `README.md`
- Test: `test/office-launcher.test.mjs`

**Interfaces:**
- Produces: `parseOfficeArgs(argv): { project: string, port: number } | { error: string }` (default port `4317`; `--project` required and must contain `.team/`); launcher builds `dist` if missing, starts the server on `127.0.0.1`, prints the URL, opens the browser (`open` on macOS, `xdg-open` on Linux, `start` on Windows).

- [ ] **Step 1: Failing tests:** missing `--project` → error message `Use --project <path to a project with a .team folder>`; project without `.team` → error; `--port 5000` parsed.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 3b: README sections:** what the Kit is; prerequisites (Node 20+, Git, Claude Code, Superpowers, frontend-design); install, update, uninstall; running the office; how the Planner workflow runs; `team-status` reference; known limits (hook data per S-0, agents may skip status calls, tested Claude Code version); repo decisions.
- [ ] **Step 5:** Commit on `feature/T-015-launcher-readme`; pull request.

---

### Task 16: End-to-end check and first install  *(owner: Tester, then Planner)*

**Files:**
- Create: `docs/e2e-checklist.md` (results recorded)

- [ ] **Step 1:** Create a throwaway Git repo in a path containing a space; run `node install.mjs --target <it>`; confirm the preview, answer y.
- [ ] **Step 2:** Run `npm run office -- --project <it>`; expect the office with all rooms `On a break`.
- [ ] **Step 3:** In Claude Code inside that repo, ask the Planner for a tiny task (e.g. add a `hello.txt` via Backend, verified by Tester). Expect, in order: Jimmy's room waiting for approval and the needs-you sign; after approval Backend `Working` with a last action; a handoff folder Backend → Tester; Tester `Working`; both `Finished`; the lobby ticket in Done.
- [ ] **Step 4:** Record pass/fail per expectation in the checklist with the Claude Code version. Any failure becomes a bug task back to its owner.
- [ ] **Step 5:** **Separate Work Order:** install into CookNeighbour and apply the CLAUDE.md edits in spec section 14 on a CookNeighbour feature branch; pull request.

---

## Work Order batches

| WO | Tasks | Why grouped |
|---|---|---|
| WO-1 | 1, 2 | Repo exists and the hook facts are known before code depends on them |
| WO-2 | 3, 4, 5, 6, 7, 8 | Core data path: log, team, state, rotation, CLI, hooks |
| WO-3 | 9, 10, 11 | Team content and installer |
| WO-4 | 12, 13, 14, 15 | Server, office UI, launcher |
| WO-5 | 16 | Real-world check, then CookNeighbour install |

Prerequisites for Jimmy before WO-1: Node LTS (v24+) from nodejs.org; GitHub CLI from cli.github.com, then `gh auth login`.
