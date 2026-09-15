// Guard rail: running `npm test` must not dirty the machine of whoever
// cloned the repository. The ledger is global by nature (~/.onp-spec), so
// every test that invokes the CLI must point ONP_SPEC_HOME to a temp folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { existsSync, statSync, readdirSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(__dirname, '..', 'bin', 'onp-spec.js');
const HOME_REAL = path.join(os.homedir(), '.onp-spec');

function snapshot(dir) {
  if (!existsSync(dir)) return null;
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else files.push(`${path.relative(dir, full)}:${statSync(full).size}`);
    }
  };
  walk(dir);
  return files.sort().join('|');
}

test('ONP_SPEC_HOME redirects the ledger and leaves the real home untouched', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'onpspec-iso-'));
  try {
    const before = snapshot(HOME_REAL);
    const r = spawnSync('node', [BIN, 'event', '--run', 'isolation-test', '--type', 'start'], {
      encoding: 'utf-8',
      env: { ...process.env, ONP_SPEC_HOME: tmp },
    });
    assert.equal(r.status, 0, r.stderr);
    const ledger = path.join(tmp, 'panel', 'ledger.jsonl');
    assert.ok(existsSync(ledger), 'ledger was written to ONP_SPEC_HOME');
    assert.match(readFileSync(ledger, 'utf-8'), /isolation-test/);
    assert.equal(snapshot(HOME_REAL), before, "the user's ~/.onp-spec was not touched");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('no test run leaked into the user ledger', () => {
  const ledger = path.join(HOME_REAL, 'panel', 'ledger.jsonl');
  if (!existsSync(ledger)) return; // clean machine: nothing to check
  const leaked = readFileSync(ledger, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return {};
      }
    })
    .filter(
      (e) =>
        // repo at the mkdtemp root: the prefix shows up in the project name;
        // repo in a subfolder (<tmp>/project, the reexec tests' case): the
        // prefix only shows up in the PATH — without checking projectDir, a
        // leak from the reexec tests would go unnoticed
        /^onpspec-(agents|reexec|iso|panel|ledger|ui|e2e)-/.test(e.project || '') ||
        /onpspec-(agents|reexec|iso|panel|ledger|ui|e2e)-/.test(e.projectDir || '')
    )
    .map((e) => e.runId);
  assert.deepEqual(
    leaked,
    [],
    `test runs found in the user ledger — some test forgot ONP_SPEC_HOME:\n${leaked.join('\n')}`
  );
});
