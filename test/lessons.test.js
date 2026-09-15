import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  loadSignals,
  saveSignals,
  recordFindings,
  recordVerify,
  findSignal,
} from '../src/core/signals.js';
import {
  loadLessons,
  saveLessons,
  addLesson,
  listLessons,
  penalizeLesson,
  pruneLessons,
  suggestLessons,
  LESSONS_DEFAULTS,
} from '../src/core/lessons.js';

// The layer's thesis: the agent phrases, the engine decides what IS a lesson —
// mandatory grounding, promotion by recurrence, pruning, quarantine.

const roots = [];
function specRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'onpspec-licoes-'));
  roots.push(root);
  const spec = path.join(root, '.spec');
  mkdirSync(path.join(spec, 'verification'), { recursive: true });
  return spec;
}
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function finding(code, feature, ref, extra = {}) {
  return { code, severity: 'error', message: `${ref} without proof`, feature, ...extra };
}

// ---------- grounding (the mechanical gate) ----------

test('a lesson with no recorded signal is rejected (LESSON_NO_GROUNDING)', () => {
  const spec = specRoot();
  const data = loadLessons(spec);
  const r = addLesson(data, loadSignals(spec), {
    text: 'Assert the persisted value of the status, not just the field\'s existence',
    signal: 'AC_NO_PROOF',
    feature: 'payments',
    source: 'AC-042',
  });
  assert.match(r.error, /LESSON_NO_GROUNDING/);
  assert.equal(data.lessons.length, 0);
});

test('a signal recorded by the audit grounds it and the lesson is born a candidate', () => {
  const spec = specRoot();
  recordFindings(spec, [finding('AC_NO_PROOF', 'payments', 'AC-042')]);
  const data = loadLessons(spec);
  const r = addLesson(data, loadSignals(spec), {
    text: 'Assert the persisted value of the status, not just the field\'s existence',
    signal: 'AC_NO_PROOF',
    feature: 'payments',
    source: 'AC-042',
  });
  assert.equal(r.event, 'created');
  assert.equal(r.lesson.status, 'candidate');
  assert.equal(r.lesson.id, 'L-001');
  assert.equal(r.lesson.recurrence, 1);
});

test('a source that does not match the recorded ref is rejected, with a hint of the valid refs', () => {
  const spec = specRoot();
  recordFindings(spec, [finding('AC_NO_PROOF', 'payments', 'AC-042')]);
  const r = addLesson(loadLessons(spec), loadSignals(spec), {
    text: 'Any rule',
    signal: 'AC_NO_PROOF',
    feature: 'payments',
    source: 'AC-999',
  });
  assert.match(r.error, /LESSON_NO_GROUNDING/);
  assert.match(r.error, /AC-042/);
});

test('a signal from another feature does not ground it', () => {
  const spec = specRoot();
  recordFindings(spec, [finding('AC_NO_PROOF', 'payments', 'AC-042')]);
  const r = addLesson(loadLessons(spec), loadSignals(spec), {
    text: 'Any rule',
    signal: 'AC_NO_PROOF',
    feature: 'billing',
    source: 'AC-042',
  });
  assert.match(r.error, /LESSON_NO_GROUNDING/);
});

test('a global signal (no feature, e.g. TEST_ORPHAN) grounds any feature', () => {
  const spec = specRoot();
  recordFindings(spec, [
    { code: 'TEST_ORPHAN', severity: 'error', message: 'orphan test @spec:AC-777', file: 'test/x.test.js' },
  ]);
  const r = addLesson(loadLessons(spec), loadSignals(spec), {
    text: 'When renaming an AC, update the tests\' @spec tags in the same commit',
    signal: 'TEST_ORPHAN',
    feature: 'payments',
    source: 'AC-777',
  });
  assert.equal(r.event, 'created');
});

test('the source can be the recorded file or contain the ref (partial match)', () => {
  const spec = specRoot();
  recordFindings(spec, [finding('AC_NO_PROOF', 'payments', 'AC-042')]);
  const r = addLesson(loadLessons(spec), loadSignals(spec), {
    text: 'Another rule',
    signal: 'AC_NO_PROOF',
    feature: 'payments',
    source: 'AC-042 (test/payments.test.js:12)',
  });
  assert.equal(r.event, 'created');
});

test('text that is too long is rejected — a lesson is ONE sentence', () => {
  const spec = specRoot();
  recordFindings(spec, [finding('AC_NO_PROOF', 'payments', 'AC-042')]);
  const r = addLesson(loadLessons(spec), loadSignals(spec), {
    text: 'x'.repeat(300),
    signal: 'AC_NO_PROOF',
    feature: 'payments',
    source: 'AC-042',
  });
  assert.match(r.error, /280/);
});

test('a flag with no value (boolean true) does not break: the field becomes absent', () => {
  const spec = specRoot();
  recordFindings(spec, [finding('AC_NO_PROOF', 'payments', 'AC-042')]);
  const data = loadLessons(spec);
  const signals = loadSignals(spec);

  const noText = addLesson(data, signals, {
    text: true, signal: 'AC_NO_PROOF', feature: 'payments', source: 'AC-042',
  });
  assert.match(noText.error, /--text/);

  const looseScope = addLesson(data, signals, {
    text: 'Valid rule', signal: 'AC_NO_PROOF', feature: 'payments', source: 'AC-042', scope: true,
  });
  assert.equal(looseScope.event, 'created');
  assert.equal(looseScope.lesson.scope, null);
});

// ---------- dedup and promotion ----------

test('the same lesson rephrased (case/accents/punctuation) in the same feature dedups without promoting', () => {
  const spec = specRoot();
  recordFindings(spec, [finding('AC_NO_PROOF', 'payments', 'AC-042')]);
  const data = loadLessons(spec);
  const signals = loadSignals(spec);
  const base = {
    signal: 'AC_NO_PROOF',
    feature: 'payments',
    source: 'AC-042',
  };
  addLesson(data, signals, { ...base, text: 'Assert the persisted value, not the field\'s existence' });
  const r = addLesson(data, signals, { ...base, text: 'ASSERT the persisted value — not the field\'s existence!!' });
  assert.equal(r.event, 'reinforced');
  assert.equal(data.lessons.length, 1);
  assert.equal(r.lesson.recurrence, 1);
  assert.equal(r.lesson.status, 'candidate');
});

test('recurrence in a 2nd distinct feature promotes a candidate to confirmed', () => {
  const spec = specRoot();
  recordFindings(spec, [
    finding('AC_NO_PROOF', 'payments', 'AC-042'),
    finding('AC_NO_PROOF', 'billing', 'AC-051'),
  ]);
  const data = loadLessons(spec);
  const signals = loadSignals(spec);
  const text = 'Assert the persisted value of the status, not just the field\'s existence';
  addLesson(data, signals, { text, signal: 'AC_NO_PROOF', feature: 'payments', source: 'AC-042' });
  const r = addLesson(data, signals, { text, signal: 'AC_NO_PROOF', feature: 'billing', source: 'AC-051' });
  assert.equal(r.event, 'promoted');
  assert.equal(r.lesson.status, 'confirmed');
  assert.deepEqual(r.lesson.features, ['payments', 'billing']);
});

test('the same text with a different signal is another lesson (the key includes the signal)', () => {
  const spec = specRoot();
  recordFindings(spec, [
    finding('AC_NO_PROOF', 'payments', 'AC-042'),
    finding('AC_NO_TEST', 'payments', 'AC-043'),
  ]);
  const data = loadLessons(spec);
  const signals = loadSignals(spec);
  const text = 'Identical phrasing rule';
  addLesson(data, signals, { text, signal: 'AC_NO_PROOF', feature: 'payments', source: 'AC-042' });
  addLesson(data, signals, { text, signal: 'AC_NO_TEST', feature: 'payments', source: 'AC-043' });
  assert.equal(data.lessons.length, 2);
});

// ---------- listing (the guide loaded in Specify) ----------

test('list: default only confirmed, ordered by recurrence, with a cap', () => {
  const data = { schema: 1, nextId: 4, lessons: [] };
  const t = new Date().toISOString();
  const lesson = (id, status, recurrence, scope = null) => ({
    id, text: `rule ${id}`, key: `S::rule ${id}`, signal: 'AC_NO_PROOF', scope,
    status, recurrence, features: ['a'], evidence: [], penalties: 0, createdAt: t, lastSeen: t,
  });
  data.lessons.push(lesson('L-001', 'candidate', 1));
  data.lessons.push(lesson('L-002', 'confirmed', 3));
  data.lessons.push(lesson('L-003', 'confirmed', 5));
  data.lessons.push(lesson('L-004', 'quarantine', 4));

  const defaultList = listLessons(data);
  assert.deepEqual(defaultList.map((l) => l.id), ['L-003', 'L-002']);

  assert.equal(listLessons(data, { limit: 1 }).length, 1);
  assert.equal(listLessons(data, { status: 'all' }).length, 4);
});

test('list: scope filter matches by hierarchical prefix and the query is normalized', () => {
  const t = new Date().toISOString();
  const data = {
    schema: 1,
    nextId: 3,
    lessons: [
      {
        id: 'L-001', text: 'Validate webhook idempotency before saving', key: 'a', signal: 'AC_NO_PROOF',
        scope: 'billing/boleto', status: 'confirmed', recurrence: 2, features: ['a', 'b'],
        evidence: [], penalties: 0, createdAt: t, lastSeen: t,
      },
      {
        id: 'L-002', text: 'Another rule', key: 'b', signal: 'AC_NO_PROOF',
        scope: 'pix', status: 'confirmed', recurrence: 2, features: ['a', 'b'],
        evidence: [], penalties: 0, createdAt: t, lastSeen: t,
      },
    ],
  };
  assert.deepEqual(listLessons(data, { scope: 'billing' }).map((l) => l.id), ['L-001']);
  assert.deepEqual(listLessons(data, { scope: 'billing/boleto' }).map((l) => l.id), ['L-001']);
  assert.equal(listLessons(data, { scope: 'bil' }).length, 0);
  assert.deepEqual(listLessons(data, { query: 'IDEMPOTENCY' }).map((l) => l.id), ['L-001']);
});

// ---------- penalization and quarantine ----------

test('2 penalties move a confirmed lesson to quarantine; re-recording is rejected', () => {
  const spec = specRoot();
  recordFindings(spec, [
    finding('AC_NO_PROOF', 'payments', 'AC-042'),
    finding('AC_NO_PROOF', 'billing', 'AC-051'),
  ]);
  const data = loadLessons(spec);
  const signals = loadSignals(spec);
  const text = 'Rule that did not work in practice';
  addLesson(data, signals, { text, signal: 'AC_NO_PROOF', feature: 'payments', source: 'AC-042' });
  addLesson(data, signals, { text, signal: 'AC_NO_PROOF', feature: 'billing', source: 'AC-051' });

  assert.equal(penalizeLesson(data, 'L-001').event, 'penalized');
  const r = penalizeLesson(data, 'L-001');
  assert.equal(r.event, 'quarantined');
  assert.equal(r.lesson.status, 'quarantine');
  assert.equal(listLessons(data).length, 0);

  const readd = addLesson(data, signals, { text, signal: 'AC_NO_PROOF', feature: 'payments', source: 'AC-042' });
  assert.match(readd.error, /quarantine/);
});

test('penalizing a candidate or a non-existent lesson is an error', () => {
  const t = new Date().toISOString();
  const data = {
    schema: 1, nextId: 2,
    lessons: [{
      id: 'L-001', text: 'x', key: 'k', signal: 'S', scope: null, status: 'candidate',
      recurrence: 1, features: ['a'], evidence: [], penalties: 0, createdAt: t, lastSeen: t,
    }],
  };
  assert.match(penalizeLesson(data, 'L-001').error, /candidate/);
  assert.match(penalizeLesson(data, 'L-999').error, /does not exist/);
});

// ---------- pruning ----------

test('pruning removes a stagnant candidate outside the window; confirmed and recent ones stay', () => {
  const old = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
  const recent = new Date().toISOString();
  const lesson = (id, status, lastSeen) => ({
    id, text: id, key: id, signal: 'S', scope: null, status, recurrence: status === 'confirmed' ? 2 : 1,
    features: ['a'], evidence: [], penalties: 0, createdAt: old, lastSeen,
  });
  const data = {
    schema: 1, nextId: 4,
    lessons: [lesson('L-001', 'candidate', old), lesson('L-002', 'candidate', recent), lesson('L-003', 'confirmed', old)],
  };
  const removed = pruneLessons(data, LESSONS_DEFAULTS);
  assert.deepEqual(removed, ['L-001']);
  assert.deepEqual(data.lessons.map((l) => l.id), ['L-002', 'L-003']);
});

// ---------- suggest (mechanical mining) ----------

test('suggest points at signals recurring across distinct features and counts existing lessons', () => {
  const spec = specRoot();
  recordFindings(spec, [
    finding('AC_NO_PROOF', 'payments', 'AC-042'),
    finding('AC_NO_PROOF', 'billing', 'AC-051'),
    finding('AC_NO_PROOF', 'subscriptions', 'AC-063'),
    finding('Q_OPEN', 'payments', 'Q-001'),
  ]);
  const data = loadLessons(spec);
  const signals = loadSignals(spec);

  let suggestions = suggestLessons(data, signals);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].signal, 'AC_NO_PROOF');
  assert.equal(suggestions[0].features.length, 3);
  assert.equal(suggestions[0].existingLessons, 0);

  addLesson(data, signals, {
    text: 'Run verify before marking a task done',
    signal: 'AC_NO_PROOF', feature: 'payments', source: 'AC-042',
  });
  suggestions = suggestLessons(data, signals);
  assert.equal(suggestions[0].existingLessons, 1);
});

// ---------- signal history ----------

test('recordVerify records VERIFY_FAILED/VERIFY_SKIPPED per AC and principle; pass generates no signal', () => {
  const spec = specRoot();
  const n = recordVerify(spec, {
    feature: 'payments',
    gitRev: 'abc1234',
    results: {
      'AC-001': { status: 'fail' },
      'AC-002': { status: 'skip' },
      'AC-003': { status: 'pass' },
    },
    principles: { 'P-001': { status: 'fail', testName: 'p' } },
  });
  assert.equal(n, 3);
  const signals = loadSignals(spec);
  const codes = Object.values(signals.signals).map((s) => `${s.code}:${s.ref}`).sort();
  assert.deepEqual(codes, ['VERIFY_FAILED:AC-001', 'VERIFY_FAILED:P-001', 'VERIFY_SKIPPED:AC-002']);
});

test('a repeated signal accumulates occurrences on the same key instead of duplicating', () => {
  const spec = specRoot();
  recordFindings(spec, [finding('AC_NO_TEST', 'payments', 'AC-042')]);
  recordFindings(spec, [finding('AC_NO_TEST', 'payments', 'AC-042')]);
  const signals = loadSignals(spec);
  const entries = Object.values(signals.signals);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].occurrences, 2);
});

test('compaction: outside the window it falls, and the cap keeps only the most recent', () => {
  const spec = specRoot();
  const data = { schema: 1, signals: {} };
  const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
  data.signals['OLD::f::AC-001'] = {
    code: 'OLD', feature: 'f', ref: 'AC-001', occurrences: 1, firstSeen: old, lastSeen: old, gitRev: null,
  };
  for (let i = 0; i < 10; i++) {
    const t = new Date(Date.now() - i * 1000).toISOString();
    data.signals[`S::f::AC-${100 + i}`] = {
      code: 'S', feature: 'f', ref: `AC-${100 + i}`, occurrences: 1, firstSeen: t, lastSeen: t, gitRev: null,
    };
  }
  saveSignals(spec, data, { windowDays: 90, maxSignals: 5 });
  const saved = loadSignals(spec);
  const refs = Object.values(saved.signals).map((s) => s.ref).sort();
  assert.deepEqual(refs, ['AC-100', 'AC-101', 'AC-102', 'AC-103', 'AC-104']);
});

test('findSignal requires a source and does not accept a short source in partial match', () => {
  const data = {
    schema: 1,
    signals: {
      'S::f::AC-042': { code: 'S', feature: 'f', ref: 'AC-042', occurrences: 1, firstSeen: 'x', lastSeen: 'x', gitRev: null },
    },
  };
  assert.equal(findSignal(data, { signal: 'S', feature: 'f', source: '' }), null);
  assert.equal(findSignal(data, { signal: 'S', feature: 'f', source: 'AC' }), null);
  assert.ok(findSignal(data, { signal: 'S', feature: 'f', source: 'AC-042' }));
});

// ---------- render ----------

test('saveLessons generates lessons.json + LESSONS.md with the three sections', () => {
  const spec = specRoot();
  recordFindings(spec, [finding('AC_NO_PROOF', 'payments', 'AC-042')]);
  const data = loadLessons(spec);
  addLesson(data, loadSignals(spec), {
    text: 'Assert the persisted value', signal: 'AC_NO_PROOF', feature: 'payments', source: 'AC-042', scope: 'billing',
  });
  saveLessons(spec, data);

  assert.ok(existsSync(path.join(spec, 'lessons.json')));
  const md = readFileSync(path.join(spec, 'LESSONS.md'), 'utf-8');
  assert.match(md, /## Confirmed/);
  assert.match(md, /## Candidates/);
  assert.match(md, /## Quarantine/);
  assert.match(md, /L-001 — Assert the persisted value/);
  assert.match(md, /scope: `billing`/);

  const reloaded = loadLessons(spec);
  assert.equal(reloaded.lessons.length, 1);
  assert.equal(reloaded.nextId, 2);
});

// ---------- real flow via CLI (init → audit → lessons) ----------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(__dirname, '..', 'bin', 'onp-spec.js');

function specFor(feature, us, ac) {
  return `# Spec: ${feature}

> feature: ${feature}
> status: in-implementation

## Stories

### ${us} — Story of ${feature}

As a user, I want ${feature}, so it works.

#### ${ac} — Criterion of ${feature}

- **Given** an initial state
- **When** the action happens
- **Then** the result is observable

## Assumptions

| ID | Assumption | Status | Resolution |
|---|---|---|---|

## Open questions

| ID | Question | Status | Answer |
|---|---|---|---|
`;
}

test('CLI end-to-end: audit records signals, add requires grounding, recurrence promotes', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'onpspec-licoes-e2e-'));
  roots.push(root);
  const cli = (...args) => {
    const proc = spawnSync('node', [BIN, ...args], { cwd: root, encoding: 'utf-8' });
    return { code: proc.status, out: `${proc.stdout}\n${proc.stderr}` };
  };

  assert.equal(cli('init').code, 0);
  for (const [feature, us, ac] of [
    ['payments', 'US-101', 'AC-101'],
    ['billing', 'US-201', 'AC-201'],
  ]) {
    mkdirSync(path.join(root, '.spec', 'features', feature), { recursive: true });
    writeFileSync(path.join(root, '.spec', 'features', feature, 'spec.md'), specFor(feature, us, ac));
  }

  const audit = cli('audit');
  assert.equal(audit.code, 1);
  assert.match(audit.out, /signal\(s\) recorded in the history/);
  assert.ok(existsSync(path.join(root, '.spec', 'verification', 'signals.json')));

  const noGrounding = cli(
    'lessons', 'add',
    '--signal', 'AC_NO_TEST', '--feature', 'payments', '--source', 'AC-999',
    '--text', 'Every AC is born with a test via scaffold before implementing'
  );
  assert.equal(noGrounding.code, 2);
  assert.match(noGrounding.out, /LESSON_NO_GROUNDING/);

  const text = 'Every AC is born with a test via scaffold before implementing';
  const add1 = cli('lessons', 'add', '--signal', 'AC_NO_TEST', '--feature', 'payments', '--source', 'AC-101', '--text', text, '--scope', 'billing');
  assert.equal(add1.code, 0, add1.out);
  assert.match(add1.out, /candidate/);

  const emptyList = cli('lessons', 'list');
  assert.match(emptyList.out, /no confirmed lesson/);

  const add2 = cli('lessons', 'add', '--signal', 'AC_NO_TEST', '--feature', 'billing', '--source', 'AC-201', '--text', text);
  assert.equal(add2.code, 0, add2.out);
  assert.match(add2.out, /PROMOTED/);

  const list = cli('lessons', 'list');
  assert.match(list.out, /L-001 \[confirmed\]/);
  assert.match(list.out, /2 feature\(s\)/);

  const suggest = cli('lessons', 'suggest');
  assert.equal(suggest.code, 0);
  assert.match(suggest.out, /AC_NO_TEST/);

  const status = cli('lessons', 'status');
  assert.match(status.out, /1 confirmed/);
  assert.match(status.out, /distinct failure point/);
});
