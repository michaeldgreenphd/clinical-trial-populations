import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';

const git = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
});

function isNestedCheckout(dir) {
  if (!existsSync(join(dir, '.git'))) return false;
  try {
    return realpathSync(git(dir, 'rev-parse', '--show-toplevel').trim()) === realpathSync(dir);
  } catch {
    // An invalid marker is not a checkout boundary and must not hide source.
    return false;
  }
}

export function assertPythonInventory(repo) {
  // Retain parent-owned paths even if a nested checkout covers their directory.
  const python = new Set(git(repo, 'ls-files', '-z', '--', '*.py').split('\0')
    .filter((path) => path && existsSync(join(repo, path))));
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!isNestedCheckout(path)) walk(path);
      } else if (entry.name.endsWith('.py')) {
        python.add(relative(repo, path));
      }
    }
  }
  // Walk untracked and ignored source too; ignoring .claude/ wholesale would
  // conceal project-owned Python alongside its unrelated worktree checkouts.
  walk(repo);
  const files = [...python].sort();
  assert.deepEqual(files, ['scripts/geo/advance_run.py'],
    'AGENTS.md says advance_run.py is the single exception to "no Python"; found: ' + files.join(', '));
}
