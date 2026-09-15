// End-to-end test of the real flow:
// init → new → write spec → scaffold → verify (tests fail) →
// implement → verify (passes) → clean audit --ci.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(__dirname, '..', 'bin', 'onp-spec.js');

const root = mkdtempSync(path.join(os.tmpdir(), 'onpspec-e2e-'));
after(() => rmSync(root, { recursive: true, force: true }));

function cli(...args) {
  const proc = spawnSync('node', [BIN, ...args], { cwd: root, encoding: 'utf-8' });
  return { code: proc.status, out: `${proc.stdout}\n${proc.stderr}` };
}

const SPEC = `# Spec: Homework delivery

> feature: homework-delivery
> status: in-implementation

## Stories

### US-001 — Student delivers homework

As a student, I want to submit my homework, so that the teacher grades it.

#### AC-001 — On-time delivery

- **Given** a student with an open task
- **When** they submit before the deadline
- **Then** status is "on time"

## Assumptions

| ID | Assumption | Status | Resolution |
|---|---|---|---|
| ASM-001 | No resubmission | confirmed | ok |

## Open questions

| ID | Question | Status | Answer |
|---|---|---|---|
`;

test('init creates .spec, constitution preset and config', () => {
  const { code, out } = cli('init', '--preset', 'lgpd-education');
  assert.equal(code, 0, out);
  assert.ok(existsSync(path.join(root, '.spec', 'constitution.md')));
  assert.ok(existsSync(path.join(root, 'onpspec.config.json')));
  const constitution = readFileSync(path.join(root, '.spec', 'constitution.md'), 'utf-8');
  assert.match(constitution, /LGPD/);
  assert.match(constitution, /P-001 \[MUST\]/);
});

test('new creates a feature with templates', () => {
  const { code, out } = cli('new', 'homework-delivery');
  assert.equal(code, 0, out);
  assert.ok(existsSync(path.join(root, '.spec', 'features', 'homework-delivery', 'spec.md')));
});

test('audit flags AC_NO_TEST before the scaffold', () => {
  writeFileSync(path.join(root, '.spec', 'features', 'homework-delivery', 'spec.md'), SPEC);
  // remove the template's tasks so it doesn't pollute this step
  rmSync(path.join(root, '.spec', 'features', 'homework-delivery', 'tasks.md'));
  const { code, out } = cli('audit');
  assert.equal(code, 1);
  assert.match(out, /AC_NO_TEST/);
});

test('scaffold generates a test that fails with the @spec tag', () => {
  const { code, out } = cli('scaffold', 'homework-delivery');
  assert.equal(code, 0, out);
  const testFile = path.join(root, 'test', 'homework-delivery.spec.test.js');
  assert.ok(existsSync(testFile));
  const content = readFileSync(testFile, 'utf-8');
  assert.match(content, /@spec:AC-001/);
  assert.match(content, /Given: a student with an open task/);
});

test('verify with a failing test records fail and exits 1', () => {
  const { code, out } = cli('verify', 'homework-delivery');
  assert.equal(code, 1, out);
  const record = JSON.parse(
    readFileSync(path.join(root, '.spec', 'verification', 'homework-delivery.json'), 'utf-8')
  );
  assert.equal(record.results['AC-001'].status, 'fail');
});

test('after implementing, verify passes and audit --ci closes the loop', () => {
  // "implement": real passing test + tasks + constitution principle tests
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(
    path.join(root, 'src', 'delivery.js'),
    `export function deliveryStatus(submittedAt, deadline) {\n  return submittedAt <= deadline ? 'on time' : 'late';\n}\n`
  );
  writeFileSync(
    path.join(root, 'test', 'homework-delivery.spec.test.js'),
    `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliveryStatus } from '../src/delivery.js';

test('AC-001: on-time delivery @spec:AC-001', () => {
  assert.equal(deliveryStatus(1, 2), 'on time');
});
test('grade never exposed @principle:P-001', () => { assert.ok(true); });
test('grade access logged @principle:P-002', () => { assert.ok(true); });
test('minors have a legal basis @principle:P-003', () => { assert.ok(true); });
`
  );
  writeFileSync(
    path.join(root, '.spec', 'features', 'homework-delivery', 'tasks.md'),
    `# Tasks\n\n## T-001 — Status function [done]\n\n- Refs: US-001, AC-001\n- Files: src/delivery.js\n`
  );

  const verify = cli('verify', 'homework-delivery');
  assert.equal(verify.code, 0, verify.out);

  const audit = cli('audit', '--ci');
  assert.equal(audit.code, 0, audit.out);
  assert.match(audit.out, /clean audit/);
});

test('drift is caught: renaming an AC in the spec breaks the audit', () => {
  const drifted = SPEC.replace(/AC-001/g, 'AC-050');
  writeFileSync(path.join(root, '.spec', 'features', 'homework-delivery', 'spec.md'), drifted);
  const { code, out } = cli('audit', '--ci');
  assert.equal(code, 1);
  assert.match(out, /TEST_ORPHAN/); // test still points to AC-001, which no longer exists
  assert.match(out, /AC_NO_TEST/); // new AC-050 has no test
  // restore
  writeFileSync(path.join(root, '.spec', 'features', 'homework-delivery', 'spec.md'), SPEC);
});

test('status and assumptions run with no error', () => {
  assert.equal(cli('status').code, 0);
  assert.equal(cli('assumptions').code, 0);
});
