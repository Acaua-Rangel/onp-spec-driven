// VERIFY_STALE only fires for the feature whose tests/code actually changed.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, utimesSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'onp-spec.js');
const root = mkdtempSync(path.join(os.tmpdir(), 'onpspec-stale-'));
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

const stale = () => {
  const { out } = cli('audit', '--json');
  const json = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1);
  return JSON.parse(json)
    .findings.filter((f) => f.code === 'VERIFY_STALE')
    .map((f) => f.feature);
};

test('mexer no teste de uma feature só deixa ESSA feature stale', () => {
  cli('init');
  mkdirSync(path.join(root, 'test'), { recursive: true });
  for (const [name, us, ac] of [['alpha', '001', '001'], ['beta', '002', '002']]) {
    mkdirSync(path.join(root, '.spec', 'features', name), { recursive: true });
    writeFileSync(path.join(root, '.spec', 'features', name, 'spec.md'), spec(name, us, ac));
    writeFileSync(
      path.join(root, 'test', `${name}.test.js`),
      `import { test } from 'node:test';\ntest('${name} @spec:AC-${ac}', () => {});\n`
    );
  }
  assert.equal(cli('verify', '--all').code, 0);
  assert.deepEqual(stale(), []);

  const future = new Date(Date.now() + 60_000);
  utimesSync(path.join(root, 'test', 'beta.test.js'), future, future);
  assert.deepEqual(stale(), ['beta']);
});
