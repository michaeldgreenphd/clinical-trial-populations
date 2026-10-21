import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { assertPythonInventory } from './repository_python_inventory.mjs';

const git = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
const write = (repo, name, text = '# fixture\n') => {
  const path = join(repo, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
function fixture(t) {
  const repo = mkdtempSync(join(tmpdir(), 'civicsample-inventory-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, '-c', 'init.templateDir=', 'init', '--quiet');
  write(repo, 'scripts/geo/advance_run.py');
  git(repo, 'add', 'scripts/geo/advance_run.py');
  git(repo, '-c', 'user.name=Inventory fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'Inventory fixture');
  return repo;
}

test('Python in an unrelated nested Git worktree does not enter the parent inventory', (t) => {
  const repo = fixture(t);
  const other = join(repo, '.claude/worktrees/another-task');
  git(repo, 'worktree', 'add', '--quiet', '--detach', other, 'HEAD');
  write(other, 'unrelated.py');
  assert.doesNotThrow(() => assertPythonInventory(repo));
});

test('untracked and ignored Python owned by the frontend still fails the inventory', (t) => {
  const repo = fixture(t);
  write(repo, '.gitignore', '.claude/\nignored.py\n');
  for (const name of ['unexpected.py', '.claude/project-owned.py', 'ignored.py']) {
    write(repo, name);
    assert.throws(() => assertPythonInventory(repo), (error) =>
      error.code === 'ERR_ASSERTION' && error.message.includes(name));
    rmSync(join(repo, name));
  }
});

test('parent-tracked Python cannot be concealed by a nested checkout boundary', (t) => {
  const repo = fixture(t);
  write(repo, 'owned/prohibited.py');
  git(repo, 'add', 'owned/prohibited.py');
  git(join(repo, 'owned'), '-c', 'init.templateDir=', 'init', '--quiet');
  assert.throws(() => assertPythonInventory(repo), /owned\/prohibited\.py/);
});

test('an invalid Git marker does not conceal project Python', (t) => {
  const repo = fixture(t);
  write(repo, 'owned/.git', 'not a Git checkout\n');
  write(repo, 'owned/prohibited.py');
  assert.throws(() => assertPythonInventory(repo), /owned\/prohibited\.py/);
});
