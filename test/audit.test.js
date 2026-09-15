import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig } from '../src/config.js';
import { loadProject } from '../src/core/project.js';
import { auditProject } from '../src/core/audit.js';

// Builds a real project on disk and runs the audit over it.

function makeProject(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'onpspec-audit-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function audit(root, opts = {}) {
  const config = loadConfig(root);
  const project = loadProject(config);
  return auditProject(project, opts);
}

const SPEC = `# Spec: Delivery

> feature: delivery
> status: in-implementation

## Stories

### US-001 — Student delivers homework

As a student, I want to submit it, so that it gets graded.

#### AC-001 — On-time delivery

- **Given** an authenticated student
- **When** they submit before the deadline
- **Then** it is recorded as "on time"

## Assumptions

| ID | Assumption | Status | Resolution |
|---|---|---|---|
| ASM-001 | No resubmission | confirmed | decided on 07/17 |

## Open questions

| ID | Question | Status | Answer |
|---|---|---|---|
`;

const roots = [];
function tracked(files) {
  const r = makeProject(files);
  roots.push(r);
  return r;
}
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

test('AC_NO_TEST: AC with no @spec tag in any test', () => {
  const root = tracked({ '.spec/features/delivery/spec.md': SPEC });
  const result = audit(root);
  assert.ok(result.findings.some((f) => f.code === 'AC_NO_TEST'));
  assert.equal(result.ok, false);
});

test('AC with an annotated test does not raise AC_NO_TEST, but raises AC_NO_PROOF (warning) without verify', () => {
  const root = tracked({
    '.spec/features/delivery/spec.md': SPEC,
    'test/delivery.test.js': `test('AC-001: on time @spec:AC-001', () => {});`,
  });
  const result = audit(root);
  assert.ok(!result.findings.some((f) => f.code === 'AC_NO_TEST'));
  const proof = result.findings.find((f) => f.code === 'AC_NO_PROOF');
  assert.ok(proof);
  assert.equal(proof.severity, 'warning');
});

test('--ci escalates AC_NO_PROOF to an error (anti premature victory)', () => {
  const root = tracked({
    '.spec/features/delivery/spec.md': SPEC,
    'test/delivery.test.js': `test('AC-001: on time @spec:AC-001', () => {});`,
  });
  const result = audit(root, { ci: true });
  const proof = result.findings.find((f) => f.code === 'AC_NO_PROOF');
  assert.equal(proof.severity, 'error');
  assert.equal(result.ok, false);
});

test('a recorded PASS from verify clears AC_NO_PROOF', () => {
  const root = tracked({
    '.spec/features/delivery/spec.md': SPEC,
    'test/delivery.test.js': `test('AC-001: on time @spec:AC-001', () => {});`,
    '.spec/verification/delivery.json': JSON.stringify({
      feature: 'delivery',
      timestamp: new Date(Date.now() + 60_000).toISOString(),
      results: { 'AC-001': { status: 'pass', testName: 'AC-001 @spec:AC-001' } },
    }),
  });
  const result = audit(root, { ci: true });
  assert.ok(!result.findings.some((f) => f.code === 'AC_NO_PROOF'), JSON.stringify(result.findings));
  assert.equal(result.ok, true);
});

test('TEST_ORPHAN: tag points to an AC that does not exist (drift)', () => {
  const root = tracked({
    '.spec/features/delivery/spec.md': SPEC,
    'test/delivery.test.js': `test('AC-001 ok @spec:AC-001', () => {});\ntest('ghost @spec:AC-999', () => {});`,
  });
  const result = audit(root);
  const orphan = result.findings.find((f) => f.code === 'TEST_ORPHAN');
  assert.ok(orphan);
  assert.match(orphan.message, /AC-999/);
});

test('ASM_OPEN: open assumption with an implemented feature is an error', () => {
  const spec = SPEC.replace('status: in-implementation', 'status: implemented').replace(
    '| ASM-001 | No resubmission | confirmed | decided on 07/17 |',
    '| ASM-001 | No resubmission | open | — |'
  );
  const root = tracked({
    '.spec/features/delivery/spec.md': spec,
    'test/delivery.test.js': `test('AC-001 @spec:AC-001', () => {});`,
  });
  const result = audit(root);
  const asm = result.findings.find((f) => f.code === 'ASM_OPEN');
  assert.ok(asm);
  assert.equal(asm.severity, 'error');
});

test('REF_BROKEN and TASK_DONE_NO_PROOF', () => {
  const root = tracked({
    '.spec/features/delivery/spec.md': SPEC,
    '.spec/features/delivery/tasks.md': `# Tasks\n\n## T-001 — Model [done]\n\n- Refs: AC-001, AC-777\n- Files: src/models/delivery.js\n`,
    'src/models/delivery.js': `export const x = 1;`,
    'test/delivery.test.js': `test('AC-001 @spec:AC-001', () => {});`,
  });
  const result = audit(root);
  assert.ok(result.findings.some((f) => f.code === 'REF_BROKEN' && /AC-777/.test(f.message)));
  assert.ok(result.findings.some((f) => f.code === 'TASK_DONE_NO_PROOF'));
});

test('FILE_ORPHAN: code that no task maps', () => {
  const root = tracked({
    '.spec/features/delivery/spec.md': SPEC,
    '.spec/features/delivery/tasks.md': `# Tasks\n\n## T-001 — Model [pending]\n\n- Refs: AC-001\n- Files: src/models/delivery.js\n`,
    'src/models/delivery.js': `export const x = 1;`,
    'src/models/intruder.js': `export const y = 2;`,
    'test/delivery.test.js': `test('AC-001 @spec:AC-001', () => {});`,
  });
  const result = audit(root);
  const orphan = result.findings.find((f) => f.code === 'FILE_ORPHAN');
  assert.ok(orphan);
  assert.match(orphan.message, /intruder\.js/);
});

test('ID_DUPLICATE across features', () => {
  const spec2 = SPEC.replace('feature: delivery', 'feature: other');
  const root = tracked({
    '.spec/features/delivery/spec.md': SPEC,
    '.spec/features/other/spec.md': spec2,
    'test/t.test.js': `test('AC-001 @spec:AC-001', () => {});`,
  });
  const result = audit(root);
  assert.ok(result.findings.some((f) => f.code === 'ID_DUPLICATE'));
});

test('PRINCIPLE_NO_CHECK: MUST with no check is an error', () => {
  const root = tracked({
    '.spec/constitution.md': `# Constitution — v1.0.0\n\n## P-001 [MUST] No check\n\nText.\n`,
    '.spec/features/delivery/spec.md': SPEC,
    'test/delivery.test.js': `test('AC-001 @spec:AC-001', () => {});`,
  });
  const result = audit(root);
  assert.ok(result.findings.some((f) => f.code === 'PRINCIPLE_NO_CHECK'));
});

test('PRINCIPLE_VIOLATED: forbidden pattern found with file:line', () => {
  const root = tracked({
    '.spec/constitution.md': `# Constitution — v1.0.0\n\n## P-004 [MUST] No personal data in logs\n\n- verification(forbidden): \`console\\.log\\(.*ssn\` in \`src/**/*.js\`\n`,
    '.spec/features/delivery/spec.md': SPEC,
    'src/leak.js': `console.log('student ssn', ssn);`,
    'test/delivery.test.js': `test('AC-001 @spec:AC-001', () => {});`,
  });
  const result = audit(root);
  const violation = result.findings.find((f) => f.code === 'PRINCIPLE_VIOLATED');
  assert.ok(violation);
  assert.equal(violation.file, 'src/leak.js');
  assert.equal(violation.line, 1);
});

test('PRINCIPLE_VIOLATED: required test tag missing', () => {
  const root = tracked({
    '.spec/constitution.md': `# Constitution — v1.0.0\n\n## P-001 [MUST] Grade protected\n\n- verification(test): @principle:P-001\n`,
    '.spec/features/delivery/spec.md': SPEC,
    'test/delivery.test.js': `test('AC-001 @spec:AC-001', () => {});`,
  });
  const result = audit(root);
  assert.ok(
    result.findings.some((f) => f.code === 'PRINCIPLE_VIOLATED' && /P-001/.test(f.message))
  );
});

test('aligned project: clean audit with exit 0', () => {
  const root = tracked({
    '.spec/constitution.md': `# Constitution — v1.0.0\n\n## P-001 [MUST] Executable proof\n\n- verification(test): @principle:P-001\n`,
    '.spec/features/delivery/spec.md': SPEC,
    '.spec/features/delivery/tasks.md': `# Tasks\n\n## T-001 — Model [done]\n\n- Refs: US-001\n- Files: src/delivery.js\n`,
    'src/delivery.js': `export const delivery = () => 'on time';`,
    'test/delivery.test.js': `test('AC-001: on time @spec:AC-001', () => {});\ntest('grade protected @principle:P-001', () => {});`,
    '.spec/verification/delivery.json': JSON.stringify({
      feature: 'delivery',
      timestamp: new Date(Date.now() + 60_000).toISOString(),
      results: { 'AC-001': { status: 'pass', testName: 'AC-001 @spec:AC-001' } },
      principles: { 'P-001': { status: 'pass' } },
    }),
  });
  const result = audit(root, { ci: true });
  assert.equal(result.stats.errors, 0, JSON.stringify(result.findings, null, 2));
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
});
