#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { appendEvent, validateEvent } from '../lib/events.mjs';
import { findProjectRoot, logPath } from '../lib/paths.mjs';

/**
 * Per-subcommand spec: usage line, flags, and the event builder.
 * @type {Record<string, { usage: string, required: string[], optional: string[], build: (v: Record<string, any>) => Record<string, any> }>}
 */
const COMMANDS = {
  status: {
    usage: 'status --agent <id> --status <status> [--task <id>] [--progress <0-100>] [--next <text>] [--reason <text>]',
    required: ['agent', 'status'],
    optional: ['task', 'progress', 'next', 'reason'],
    build: (v) => ({ type: 'status', agent: v.agent, status: v.status, task: v.task, progress: v.progress, nextStep: v.next, reason: v.reason }),
  },
  task: {
    usage: 'task --id <id> --title <text> --owner <agent> --state <todo|in_progress|in_review|done> [--notes <text>]',
    required: ['id', 'title', 'owner', 'state'],
    optional: ['notes'],
    build: (v) => ({ type: 'task', agent: 'planner', id: v.id, title: v.title, owner: v.owner, state: v.state, notes: v.notes }),
  },
  approval: {
    usage: 'approval --id <id> --summary <text> [--agents a,b]',
    required: ['id', 'summary'],
    optional: ['agents'],
    build: (v) => ({
      type: 'approval_requested', agent: 'planner', id: v.id, summary: v.summary,
      agents: v.agents === undefined ? undefined : String(v.agents).split(',').map((s) => s.trim()).filter(Boolean),
    }),
  },
  decide: {
    usage: 'decide --id <id> --state <approved|rejected|changes_requested> [--note <text>]',
    required: ['id', 'state'],
    optional: ['note'],
    build: (v) => ({ type: 'approval_decided', agent: 'planner', id: v.id, state: v.state, note: v.note }),
  },
  handoff: {
    usage: 'handoff --from <agent> --to <agent> --task <id> [--file <path>]',
    required: ['from', 'to', 'task'],
    optional: ['file'],
    build: (v) => ({ type: 'handoff', agent: v.from, from: v.from, to: v.to, task: v.task, file: v.file ?? `.team/handoffs/${v.task}.md` }),
  },
  escalate: {
    usage: 'escalate --task <id> --summary <text>',
    required: ['task', 'summary'],
    optional: [],
    build: (v) => ({ type: 'escalation', agent: 'planner', task: v.task, summary: v.summary }),
  },
};

/**
 * @param {string[]} argv arguments after the script name
 * @param {{ cwd: string, env: Record<string, string | undefined>, now?: Date, stderr?: (s: string) => void }} opts
 * @returns {number} exit code
 */
export function main(argv, opts) {
  const err = opts.stderr ?? ((s) => process.stderr.write(s));
  /** @param {string} msg */
  const fail = (msg) => { err(`${msg}\n`); return 2; };

  const [name, ...rest] = argv;
  const cmd = name === undefined ? undefined : Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  if (!cmd) {
    return fail(`Usage: team-status <${Object.keys(COMMANDS).join('|')}> [flags]${name ? ` (unknown subcommand: ${name})` : ''}`);
  }
  const usage = `Usage: team-status ${cmd.usage}`;

  /** @type {Record<string, any>} */
  let values;
  try {
    const options = Object.fromEntries([...cmd.required, ...cmd.optional].map((k) => [k, { type: /** @type {const} */ ('string') }]));
    ({ values } = parseArgs({ args: rest, options, strict: true, allowPositionals: false }));
  } catch (e) {
    return fail(`${/** @type {Error} */ (e).message}. ${usage}`);
  }
  for (const k of cmd.required) {
    if (values[k] === undefined) return fail(`Missing --${k}. ${usage}`);
  }
  if (values.progress !== undefined) {
    if (!/^\d+$/.test(values.progress)) return fail(`--progress must be an integer from 0 to 100. ${usage}`);
    values.progress = Number(values.progress);
  }

  const envRoot = opts.env.CLAUDE_PROJECT_DIR;
  const root = envRoot ? envRoot : findProjectRoot(opts.cwd);
  if (!root || !fs.existsSync(path.join(root, '.team'))) return fail('No .team folder found. Run the installer first.');

  const event = Object.fromEntries(
    Object.entries({ ...cmd.build(values), source: 'cli' }).filter(([, v]) => v !== undefined),
  );
  const v = validateEvent(event);
  if (!v.ok) return fail(`${v.error}. ${usage}`);
  try {
    appendEvent(logPath(root), event, opts.now);
  } catch (e) {
    return fail(`${/** @type {Error} */ (e).message}. ${usage}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2), { cwd: process.cwd(), env: process.env }));
}
