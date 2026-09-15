import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'fs';
import path from 'path';
import os from 'os';
import { performance } from 'perf_hooks';
import { loadConfig } from '../src/config.js';
import { loadProject } from '../src/core/project.js';
import { auditProject } from '../src/core/audit.js';
import { loadSignals, recordFindings } from '../src/core/signals.js';
import {
  loadLessons,
  saveLessons,
  addLesson,
  listLessons,
  suggestLessons,
  LESSONS_DEFAULTS,
} from '../src/core/lessons.js';

// Asaas-style scale: many domains, hundreds of features, thousands of
// signals. The layer's contract: FIXED context cost (listing with a cap),
// LIMITED files (keyed history + compaction), and fast operations even with
// a huge repo. Time budgets are deliberately generous — what is being proven
// is the order of magnitude, not the hardware.

const roots = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const pad = (n) => String(n).padStart(4, '0');

function bigSpec(feature, idx, acsPerFeature) {
  const us = `US-${pad(idx)}`;
  const acs = [];
  for (let k = 0; k < acsPerFeature; k++) {
    const ac = `AC-${pad(idx * 10 + k)}`;
    acs.push(`#### ${ac} — Criterion ${k} of ${feature}

- **Given** an initial state ${k}
- **When** action ${k} happens
- **Then** result ${k} is observable
`);
  }
  return `# Spec: ${feature}

> feature: ${feature}
> status: in-implementation

## Stories

### ${us} — Story of ${feature}

As a user, I want ${feature}, so that it works.

${acs.join('\n')}
## Assumptions

| ID | Assumption | Status | Resolution |
|---|---|---|---|

## Open questions

| ID | Question | Status | Answer |
|---|---|---|---|
`;
}

test('huge project on disk: 120 features × 6 ACs — real audit becomes grounded signals and lessons', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'onpspec-scale-'));
  roots.push(root);
  const specRoot = path.join(root, '.spec');
  mkdirSync(path.join(specRoot, 'verification'), { recursive: true });

  const domains = ['billing', 'pix', 'subscriptions', 'anticipation', 'account', 'card'];
  const FEATURES = 120;
  const ACS = 6;
  const features = [];
  for (let i = 1; i <= FEATURES; i++) {
    const feature = `${domains[i % domains.length]}-feature-${pad(i)}`;
    features.push(feature);
    const dir = path.join(specRoot, 'features', feature);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'spec.md'), bigSpec(feature, i, ACS));
  }

  const t0 = performance.now();
  const project = loadProject(loadConfig(root));
  const audit = auditProject(project);
  const tAudit = performance.now() - t0;

  const noTest = audit.findings.filter((f) => f.code === 'AC_NO_TEST');
  assert.equal(noTest.length, FEATURES * ACS);

  const t1 = performance.now();
  recordFindings(specRoot, audit.findings, LESSONS_DEFAULTS);
  const tSignals = performance.now() - t1;

  const signals = loadSignals(specRoot);
  assert.ok(Object.keys(signals.signals).length >= FEATURES * ACS);

  const data = loadLessons(specRoot);
  const text = 'Every AC is born with a test via scaffold before any implementation';
  const t2 = performance.now();
  let promoted = null;
  for (let i = 0; i < 40; i++) {
    const feature = features[i];
    const source = `AC-${pad((i + 1) * 10)}`;
    const r = addLesson(data, signals, {
      text,
      signal: 'AC_NO_TEST',
      feature,
      source,
      scope: feature.split('-')[0],
    });
    assert.ok(!r.error, r.error);
    if (r.event === 'promoted') promoted = r.lesson;
  }
  const tAdd = performance.now() - t2;

  assert.ok(promoted, 'recurrence across distinct features had to promote');
  assert.equal(promoted.status, 'confirmed');
  assert.equal(promoted.recurrence, 40);
  assert.equal(promoted.evidence.length, 5);

  const suggestions = suggestLessons(data, signals);
  assert.ok(suggestions.some((s) => s.signal === 'AC_NO_TEST' && s.features.length === FEATURES));

  saveLessons(specRoot, data);
  const reloaded = loadLessons(specRoot);
  assert.equal(reloaded.lessons.length, 1);

  assert.ok(tAudit < 15_000, `audit of ${FEATURES} features took ${tAudit}ms`);
  assert.ok(tSignals < 3_000, `recording ${audit.findings.length} findings took ${tSignals}ms`);
  assert.ok(tAdd < 3_000, `40 grounded adds took ${tAdd}ms`);
});

test('thousands of signals and hundreds of lessons: listing at fixed cost and limited files', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'onpspec-scale-vol-'));
  roots.push(root);
  const specRoot = path.join(root, '.spec');
  mkdirSync(path.join(specRoot, 'verification'), { recursive: true });

  const FEATURES = 500;
  const findings = [];
  for (let i = 1; i <= FEATURES; i++) {
    const feature = `feature-${pad(i)}`;
    for (const code of ['AC_NO_PROOF', 'VERIFY_STALE', 'Q_OPEN']) {
      findings.push({
        code,
        severity: 'warning',
        message: `AC-${pad(i)} pending`,
        feature,
      });
    }
  }

  const t0 = performance.now();
  for (let round = 0; round < 3; round++) recordFindings(specRoot, findings, LESSONS_DEFAULTS);
  const tRounds = performance.now() - t0;

  const signals = loadSignals(specRoot);
  const entries = Object.values(signals.signals);
  assert.equal(entries.length, FEATURES * 3, 'repeated rounds must not duplicate keys');
  assert.ok(entries.every((s) => s.occurrences === 3));

  const data = loadLessons(specRoot);
  const t1 = performance.now();
  for (let i = 1; i <= 300; i++) {
    const r = addLesson(data, signals, {
      text: `Rule number ${i} about acceptance proof before closing`,
      signal: 'AC_NO_PROOF',
      feature: `feature-${pad(i)}`,
      source: `AC-${pad(i)}`,
      scope: `domain-${i % 12}`,
    });
    assert.ok(!r.error, r.error);
  }
  const tAdds = performance.now() - t1;
  assert.equal(data.lessons.length, 300);

  const t2 = performance.now();
  const listed = listLessons(data, { status: 'all' });
  const tList = performance.now() - t2;
  assert.equal(listed.length, LESSONS_DEFAULTS.listLimit);

  saveLessons(specRoot, data);
  const lessonsSize = statSync(path.join(specRoot, 'lessons.json')).size;
  const signalsSize = statSync(path.join(specRoot, 'verification', 'signals.json')).size;
  assert.ok(lessonsSize < 512 * 1024, `lessons.json with ${lessonsSize} bytes`);
  assert.ok(signalsSize < 2 * 1024 * 1024, `signals.json with ${signalsSize} bytes`);

  assert.ok(tRounds < 6_000, `3 rounds × ${findings.length} findings took ${tRounds}ms`);
  assert.ok(tAdds < 5_000, `300 adds took ${tAdds}ms`);
  assert.ok(tList < 100, `list over 300 lessons took ${tList}ms`);
});

test('history cap holds the file even with tens of thousands of failure points', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'onpspec-scale-cap-'));
  roots.push(root);
  const specRoot = path.join(root, '.spec');
  mkdirSync(path.join(specRoot, 'verification'), { recursive: true });

  const findings = [];
  for (let i = 0; i < 8000; i++) {
    findings.push({
      code: 'FILE_ORPHAN',
      severity: 'warning',
      message: 'no task',
      file: `src/module-${i}.js`,
    });
  }
  recordFindings(specRoot, findings, { ...LESSONS_DEFAULTS, maxSignals: 5000 });

  const signals = loadSignals(specRoot);
  assert.equal(Object.keys(signals.signals).length, 5000);
});
