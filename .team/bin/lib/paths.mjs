// @ts-check
import fs from 'node:fs';
import path from 'node:path';

/**
 * Find the nearest ancestor (or startDir itself) that contains a `.team/` directory.
 * @param {string} startDir
 * @returns {string | null}
 */
export function findProjectRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    try {
      if (fs.statSync(path.join(dir, '.team')).isDirectory()) return dir;
    } catch {
      // not here, keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * @param {string} root project root
 * @returns {string} `<root>/.team/events.jsonl`
 */
export function logPath(root) {
  return path.join(root, '.team', 'events.jsonl');
}
