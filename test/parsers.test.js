import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec, allAcs } from '../src/parsers/spec.js';
import { parseTasks } from '../src/parsers/tasks.js';
import { parseConstitution } from '../src/parsers/constitution.js';
import { globToRegExp } from '../src/util/text.js';

const SPEC_OK = `# Spec: Homework delivery

> feature: homework-delivery
> status: in-implementation

## Stories

### US-001 — Student delivers homework

As a student, I want to submit my homework, so that the teacher grades it.

#### AC-001 — On-time delivery

- **Given** an authenticated student with an open task
- **When** they submit the file before the deadline
- **Then** the delivery is recorded with status "on time"

#### AC-002 — Late delivery

- **Given** an authenticated student with an open task
- **When** they submit after the deadline
- **Then** the delivery is marked as "late"
- **And** the student sees a late warning

## Assumptions

| ID | Assumption | Status | Resolution |
|---|---|---|---|
| ASM-001 | Cannot resubmit after grading | open | — |

## Open questions

| ID | Question | Status | Answer |
|---|---|---|---|
| Q-001 | Deadline timezone? | answered | America/Sao_Paulo |
`;

test('parseSpec extracts feature, status, US, AC with Given/When/Then', () => {
  const spec = parseSpec(SPEC_OK);
  assert.equal(spec.feature, 'homework-delivery');
  assert.equal(spec.status, 'in-implementation');
  assert.equal(spec.stories.length, 1);
  assert.equal(spec.stories[0].id, 'US-001');
  const acs = allAcs(spec);
  assert.equal(acs.length, 2);
  assert.deepEqual(acs.map((a) => a.id), ['AC-001', 'AC-002']);
  assert.equal(acs[0].given.length, 1);
  assert.equal(acs[0].when.length, 1);
  assert.equal(acs[0].then.length, 1);
});

test('parseSpec: "And" clause continues the last clause (Then)', () => {
  const spec = parseSpec(SPEC_OK);
  const ac2 = allAcs(spec)[1];
  assert.equal(ac2.then.length, 2);
});

test('parseSpec extracts assumptions and questions with status', () => {
  const spec = parseSpec(SPEC_OK);
  assert.equal(spec.assumptions.length, 1);
  assert.deepEqual(spec.assumptions[0], {
    id: 'ASM-001',
    text: 'Cannot resubmit after grading',
    status: 'open',
    resolution: '—',
    line: spec.assumptions[0].line,
  });
  assert.equal(spec.questions.length, 1);
  assert.equal(spec.questions[0].status, 'answered');
  assert.equal(spec.questions[0].answer, 'America/Sao_Paulo');
});

test('parseSpec: section headers are case-insensitive', () => {
  const variant = SPEC_OK.replace('## Assumptions', '## ASSUMPTIONS').replace(
    '## Open questions',
    '## Open Questions'
  );
  const spec = parseSpec(variant);
  assert.equal(spec.assumptions.length, 1);
  assert.equal(spec.questions.length, 1);
});

test('parseSpec flags AC outside US', () => {
  const spec = parseSpec(`# Spec: X\n\n#### AC-001 — Loose\n\n- **Given** x\n- **When** y\n- **Then** z\n`);
  assert.equal(spec.parseIssues.length, 1);
  assert.equal(spec.parseIssues[0].code, 'AC_OUTSIDE_US');
});

test('parseTasks extracts id, status, refs and files', () => {
  const tasks = parseTasks(`# Tasks

## T-001 — Delivery model [done]

- Refs: US-001, AC-001
- Files: src/models/delivery.js, src/routes/delivery.js

## T-002 — Late warning [pending]

- Refs: AC-002
- Files: src/ui/warning.js
`);
  assert.equal(tasks.tasks.length, 2);
  assert.equal(tasks.tasks[0].status, 'done');
  assert.deepEqual(tasks.tasks[0].refs, ['US-001', 'AC-001']);
  assert.deepEqual(tasks.tasks[0].files, ['src/models/delivery.js', 'src/routes/delivery.js']);
  assert.equal(tasks.tasks[1].status, 'pending');
});

test('parseTasks: task without status becomes pending with a warning', () => {
  const tasks = parseTasks(`## T-001 — No status\n- Refs: AC-001\n`);
  assert.equal(tasks.tasks[0].status, 'pending');
  assert.equal(tasks.parseIssues[0].code, 'TASK_NO_STATUS');
});

test('parseConstitution extracts principles, levels and checks', () => {
  const c = parseConstitution(`# Constitution — v1.2.0

## P-001 [MUST] Grade never exposed to another student

Principle text.

- verification(test): @principle:P-001
- verification(forbidden): \`SELECT \\* FROM grades\` in \`src/**/*.js\`

## P-007 [MAY] Deletion on request
`);
  assert.equal(c.version, '1.2.0');
  assert.equal(c.principles.length, 2);
  assert.equal(c.principles[0].level, 'MUST');
  assert.equal(c.principles[0].checks.length, 2);
  assert.equal(c.principles[0].checks[0].kind, 'test');
  assert.equal(c.principles[0].checks[1].kind, 'forbidden');
  assert.equal(c.principles[0].checks[1].glob, 'src/**/*.js');
  assert.equal(c.principles[1].level, 'MAY');
});

test('globToRegExp: ** matches directories, * does not cross /', () => {
  assert.ok(globToRegExp('src/**').test('src/a/b/c.js'));
  assert.ok(globToRegExp('src/**/*.js').test('src/a/b/c.js'));
  assert.ok(globToRegExp('src/**/*.js').test('src/c.js'));
  assert.ok(!globToRegExp('src/*.js').test('src/a/c.js'));
  assert.ok(globToRegExp('test/**').test('test/x.test.js'));
  assert.ok(!globToRegExp('src/**').test('lib/x.js'));
});
