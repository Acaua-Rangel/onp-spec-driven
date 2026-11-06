// verify only runs the test files tagged with the feature's ACs (and runs the
// suite once for several features).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { supportsFileArgs, resolveTestArgv } from '../src/core/verify.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'onp-spec.js');

test('supportsFileArgs: só runners que aceitam caminhos', () => {
  assert.equal(supportsFileArgs(['node', '--test']), true);
  assert.equal(supportsFileArgs(['node', 'script.js']), false);
  assert.equal(supportsFileArgs(['npx', 'vitest', 'run']), true);
  assert.equal(supportsFileArgs(['pnpm', 'exec', 'jest']), true);
  assert.equal(supportsFileArgs(['pytest', '-q']), true);
  assert.equal(supportsFileArgs(['python3', '-m', 'pytest']), true);
  assert.equal(supportsFileArgs(['./gradlew', 'test']), false);
  assert.equal(supportsFileArgs(['npm', 'test']), false);
  assert.equal(supportsFileArgs([]), false);
});

test('resolveTestArgv: anexa, usa {files}, respeita false e limites', () => {
  const files = ['test/a.test.js', 'test/b.test.js'];
  assert.deepEqual(resolveTestArgv(['node', '--test'], files).argv, ['node', '--test', ...files]);
  assert.deepEqual(resolveTestArgv(['pytest', '{files}', '-q'], files).argv, ['pytest', ...files, '-q']);
  assert.equal(resolveTestArgv(['node', '--test'], files, false).files, null);
  assert.deepEqual(resolveTestArgv(['./gradlew', 'test'], files).argv, ['./gradlew', 'test']);
  assert.deepEqual(resolveTestArgv(['node', '--test'], []).argv, ['node', '--test']);
  assert.deepEqual(resolveTestArgv(['pytest', '{files}'], []).argv, ['pytest']);
  assert.equal(resolveTestArgv(['node', '--test'], ['-x.js']).files, null);
  const many = Array.from({ length: 201 }, (_, i) => `t${i}.js`);
  assert.equal(resolveTestArgv(['node', '--test'], many).files, null);
});

const root = mkdtempSync(path.join(os.tmpdir(), 'onpspec-targeted-'));
after(() => rmSync(root, { recursive: true, force: true }));

function cli(...args) {
  const proc = spawnSync('node', [BIN, ...args], { cwd: root, encoding: 'utf-8' });
  return { code: proc.status, out: `${proc.stdout}\n${proc.stderr}` };
}

const spec = (feature, us, ac) => `# Spec: ${feature}

> feature: ${feature}
> status: in-implementation

## Stories

### US-${us} — Story

As a user, I want it, so that it works.

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

test('setup: duas features, cada uma com seu arquivo de teste (a segunda falha)', () => {
  assert.equal(cli('init').code, 0);
  for (const [name, us, ac] of [['alpha', '001', '001'], ['beta', '002', '002']]) {
    mkdirSync(path.join(root, '.spec', 'features', name), { recursive: true });
    writeFileSync(path.join(root, '.spec', 'features', name, 'spec.md'), spec(name, us, ac));
  }
  mkdirSync(path.join(root, 'test'), { recursive: true });
  writeFileSync(
    path.join(root, 'test', 'alpha.test.js'),
    `import { test } from 'node:test';\ntest('alpha ok @spec:AC-001', () => {});\n`
  );
  writeFileSync(
    path.join(root, 'test', 'beta.test.js'),
    `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('beta @spec:AC-002', () => assert.fail('boom'));\n`
  );
});

test('verify <feature> roda só o arquivo de teste da feature', () => {
  const { code, out } = cli('verify', 'alpha');
  assert.equal(code, 0, out);
  assert.match(out, /1 test file\(s\) run/);
  const rec = JSON.parse(readFileSync(path.join(root, '.spec/verification/alpha.json'), 'utf-8'));
  assert.equal(rec.scope, 'files');
  assert.deepEqual(rec.testFiles, ['test/alpha.test.js']);
  assert.equal(rec.results['AC-001'].status, 'pass');
});

test('testFileArgs=false roda a suíte inteira (a falha de outra feature aparece no exit code)', () => {
  const cfgPath = path.join(root, 'onpspec.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  writeFileSync(cfgPath, JSON.stringify({ ...cfg, testFileArgs: false }));
  cli('verify', 'alpha');
  const rec = JSON.parse(readFileSync(path.join(root, '.spec/verification/alpha.json'), 'utf-8'));
  assert.equal(rec.scope, 'suite');
  assert.notEqual(rec.exitCode, 0);
  writeFileSync(cfgPath, JSON.stringify(cfg));
});

test('verify --all roda uma vez e grava um registro por feature', () => {
  const { code, out } = cli('verify', '--all');
  assert.equal(code, 1, out); // beta falha
  const alpha = JSON.parse(readFileSync(path.join(root, '.spec/verification/alpha.json'), 'utf-8'));
  const beta = JSON.parse(readFileSync(path.join(root, '.spec/verification/beta.json'), 'utf-8'));
  assert.equal(alpha.timestamp, beta.timestamp);
  assert.equal(alpha.results['AC-001'].status, 'pass');
  assert.equal(beta.results['AC-002'].status, 'fail');
});
