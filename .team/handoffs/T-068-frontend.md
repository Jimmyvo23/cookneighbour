# Handoff: T-068 Impeccable design skill for Frontend

From: frontend  To: tester

## What changed
- Branch: `feature/T-068-impeccable`
- Pull request: see the PR for branch `feature/T-068-impeccable` ("Closes #106")
- Install command: `npx impeccable@4.5.2 install --providers=claude --scope=project --yes` (skill 4.5.2, engine v0.1.14). `install --help` has no separate hook-accept flag; `--yes` accepts detected defaults, which installed the hook. The command printed exit code 1 although it reported "Done"; all files were written.
- Files: `.claude/skills/impeccable/**` (SKILL.md, reference/, scripts/), 4 `.claude/agents/impeccable-*.md` (shipped by the installer), `.impeccable/config.json` (`{"telemetry": false}`), `PRODUCT.md`, `.gitignore` (official Impeccable block + `.claude/skills/impeccable/scripts/bin/` + `.claude/settings.local.json`), `.claude/agents/frontend.md` (Impeccable first, wins on conflicts), `eslint.config.mjs` (ignores `.claude/skills/**`; vendored scripts gave 94 warnings), `PLAN.md` (T-068 notes).
- LICENSE and NOTICE: the installer shipped none. I added the upstream `LICENSE` (Apache-2.0) and `NOTICE.md` into `.claude/skills/impeccable/` (downloaded from the official repo).
- Telemetry: off in the committed `.impeccable/config.json` (docs say this file is shared and tracked).
- Engine binary: the installer put a 16 MB darwin-arm64 binary in `.claude/skills/impeccable/scripts/bin/`; I gitignored it so it is not committed. Other machines/CI get it by the launcher downloading into `~/.impeccable/bin/<version>` on first use.
- Outside the repo: nothing in `~/.claude` changed. `~/.impeccable/` was created at install/first run with only `staleness-check.json` and `update-check.json`. No `~/.impeccable/bin/` was created, so no engine download happened (the sibling binary was used).
- Hook: written by the installer only to `.claude/settings.local.json` of this worktree (ignored in the repo now). Committed `.claude/settings.json` is unchanged.

## How to verify
- `git diff main -- .claude/settings.json` is empty; `git check-ignore -v .claude/settings.local.json` matches the repo `.gitignore`.
- `.claude/skills/impeccable/scripts/impeccable context` prints the PRODUCT.md notice before PRODUCT.md exists and resolves it after.
- `.claude/skills/impeccable/scripts/impeccable detect src/app src/components` exits 2 with one finding (overused font Arial in `src/app/globals.css` line 25); `detect src/app/search` is clean. Baseline only, not fixed.
- `npm run lint`: 0 errors, 0 warnings. `npm test`: 1625 passed, 3 expected fail.

## Known gaps or risks
- Subagent route: no Skill tool, so I read SKILL.md and ran the launcher and `detect`; both work.
- PRODUCT.md uses only CLAUDE.md sections 2 to 4, plus Platform "web" (from the section 5 stack, because the format needs a value). Positioning, brand voice, principles and accessibility are "Not decided yet".
- The hook is not active in the main folder until the Planner places it (below).

## What the next agent needs
Hook to place in main folder's `.claude/settings.local.json` after Jimmy confirms (I did not touch the main folder). It is the exact block the installer wrote:

```json
{
  "description": "Impeccable design detector: immediate-tier checks after Edit/Write on UI files, full-rule deep pass on Stop.",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "[ ! -f \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" ] || \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" hook",
            "timeout": 5,
            "statusMessage": "Preparing build session"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "[ ! -f \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" ] || \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" hook",
            "timeout": 5,
            "statusMessage": "Checking UI changes"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "[ ! -f \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" ] || \"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable\" hook",
            "timeout": 30,
            "statusMessage": "Design deep pass"
          }
        ]
      }
    ]
  }
}
```

Note it points at `.claude/skills/impeccable/scripts/impeccable`, which exists in the main folder only after this PR merges.

Open questions for Jimmy: Positioning, brand voice, product principles and accessibility standard for PRODUCT.md; whether to keep the 4 installer-shipped `impeccable-*` agents in `.claude/agents/`.
