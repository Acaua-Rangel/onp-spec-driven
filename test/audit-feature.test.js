// audit --feature <name>: audits a single feature without failing on other features' state.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'onp-spec.js');
const root = mkdtempSync(path.join(os.tmpdir(), 'onpspec-audit-feat-'));
after(() => rmSync(root, { recursive: true, force: true }));

function cli(...args) {
  const proc = spawnSync('node', [BIN, ...args], { cwd: root, encoding: 'utf-8' });
  return { code: proc.status, out: `${proc.stdout}\n${proc.stderr}` };
}

function parseJsonOut(out) {
  return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
}

const spec = (feature, us, ac) => `# Spec: ${feature}

> feature: ${feature}
> status: in-implementation

## Stories

### US-${us} — Story

As a user, I want ${feature}, so that it works.

#### AC-${ac} — Criterion

- **Given** a
- **When** b
- **Then** c

## Assumptions

| ID | Assumption | Status | Resolution |
|---|---|---|---|

## Open questions

| ID | Question | Status | Answer |
|---|---|---|---|
`;

test('audit --feature <name> isola a auditoria na feature alvo', () => {
  cli('init');
  mkdirSync(path.join(root, 'test'), { recursive: true });
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'alpha.js'), 'export const a = 1;\n');
  writeFileSync(path.join(root, 'src', 'orphan.js'), 'export const o = 1;\n');

  // alpha: spec + tasks + passing test + verified
  mkdirSync(path.join(root, '.spec', 'features', 'alpha'), { recursive: true });
  writeFileSync(path.join(root, '.spec', 'features', 'alpha', 'spec.md'), spec('alpha', '001', '001'));
  writeFileSync(
    path.join(root, '.spec', 'features', 'alpha', 'tasks.md'),
    `# Tasks: alpha\n\n## T-001 — implementar alpha [done]\n- Refs: AC-001\n- Files: src/alpha.js\n`
  );
  writeFileSync(
    path.join(root, 'test', 'alpha.test.js'),
    `import { test } from 'node:test';\ntest('alpha @spec:AC-001', () => {});\n`
  );

  // beta: spec without test (AC_NO_TEST) + task covering alpha? no, unverified
  mkdirSync(path.join(root, '.spec', 'features', 'beta'), { recursive: true });
  writeFileSync(path.join(root, '.spec', 'features', 'beta', 'spec.md'), spec('beta', '002', '002'));

  assert.equal(cli('verify', 'alpha').code, 0);

  // Global audit fails because of beta's AC_NO_TEST and src/orphan.js
  const globalRes = cli('audit', '--ci', '--json');
  assert.equal(globalRes.code, 1);
  const globalData = parseJsonOut(globalRes.out);
  assert.equal(globalData.stats.features, 2);
  assert.ok(globalData.findings.some((f) => f.feature === 'beta' && f.code === 'AC_NO_TEST'));
  assert.ok(globalData.findings.some((f) => f.code === 'FILE_ORPHAN'));

  // Targeted audit of alpha passes cleanly and counts only alpha
  const alphaRes = cli('audit', '--feature', 'alpha', '--ci', '--json');
  assert.equal(alphaRes.code, 0);
  const alphaData = parseJsonOut(alphaRes.out);
  assert.equal(alphaData.ok, true);
  assert.equal(alphaData.stats.features, 1);
  assert.equal(alphaData.stats.acs, 1);
  assert.equal(alphaData.stats.acsWithTest, 1);
  assert.equal(alphaData.stats.acsProven, 1);
  assert.equal(alphaData.findings.length, 0);

  // Targeted audit of beta reports beta's findings only
  const betaRes = cli('audit', '--feature', 'beta', '--ci', '--json');
  assert.equal(betaRes.code, 1);
  const betaData = parseJsonOut(betaRes.out);
  assert.equal(betaData.stats.features, 1);
  assert.equal(betaData.stats.acs, 1);
  assert.ok(betaData.findings.every((f) => f.feature === 'beta'));
  assert.ok(betaData.findings.some((f) => f.code === 'AC_NO_TEST'));
});

test('audit --feature inexistente ou sem argumento falha com exit 2', () => {
  const missing = cli('audit', '--feature', 'nao-existe');
  assert.equal(missing.code, 2);
  assert.match(missing.out, /not found/i);

  const noVal = cli('audit', '--feature');
  assert.equal(noVal.code, 2);
  assert.match(noVal.out, /usage:/i);
});
