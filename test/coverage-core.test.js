import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';

import { loadConfig } from '../src/config.js';
import { loadProject } from '../src/core/project.js';
import { buildPlan } from '../src/core/plan.js';
import { loadSignals } from '../src/core/signals.js';
import { loadLessons, suggestLessons } from '../src/core/lessons.js';
import { globToRegExp } from '../src/util/text.js';
import { lastAction, progressTable, deterministicSummary } from '../src/core/summary.js';
import { findingLabel } from '../src/core/labels.js';
import { streamPath, summarizeStream } from '../src/core/ledger.js';
import { grepPattern } from '../src/parsers/annotations.js';
import { auditProject } from '../src/core/audit.js';

test('src/config.js: loadConfig throws with invalid onpspec.config.json', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'onpspec-cov-cfg-'));
  try {
    writeFileSync(path.join(tmp, 'onpspec.config.json'), '{ invalid json');
    assert.throws(() => loadConfig(tmp), /invalid onpspec\.config\.json/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('src/core/project.js: loadProject handles missing specRoot', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'onpspec-cov-prj-'));
  try {
    const config = { specDir: '.spec', rootDir: tmp };
    const p = loadProject(config);
    assert.equal(p.errors.length, 1);
    assert.match(p.errors[0], /directory \.spec\/ not found/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('src/core/plan.js: buildPlan emits warning for in-progress tasks', () => {
  const project = {
    config: { specDir: '.spec', rootDir: '/tmp/test-plan', parallel: { maxParallel: 2, model: 'claude-sonnet-5', effort: 'medium' } },
    features: [
      {
        name: 'feat-x',
        spec: { stories: [{ acs: [{ id: 'AC-001', title: 'ac' }] }] },
        tasks: {
          tasks: [
            { id: 'T-001', title: 'Task 1', status: 'in-progress', refs: ['AC-001'], files: ['src/a.js'] },
          ],
        },
      },
    ],
  };
  const plan = buildPlan(project, 'feat-x');
  assert.ok(plan.warnings.some((w) => w.includes('[in-progress]')));
});

test('src/core/signals.js: loadSignals returns fallback schema on corrupt file', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'onpspec-cov-sig-'));
  try {
    const vDir = path.join(tmp, 'verification');
    mkdirSync(vDir, { recursive: true });
    writeFileSync(path.join(vDir, 'signals.json'), '{ broken');
    const s = loadSignals(tmp);
    assert.deepEqual(s, { schema: 1, signals: {} });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('src/core/lessons.js: loadLessons throws when file is corrupted', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'onpspec-cov-les-'));
  try {
    writeFileSync(path.join(tmp, 'lessons.json'), '{ not valid json');
    assert.throws(() => loadLessons(tmp), /corrupted/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('src/core/lessons.js: suggestLessons tie-breakers on features count and occurrences', () => {
  const data = { lessons: [] };
  const signals = {
    signals: {
      'FAIL_A::f1::r1': { code: 'FAIL_A', feature: 'f1', ref: 'r1', occurrences: 5 },
      'FAIL_A::f2::r2': { code: 'FAIL_A', feature: 'f2', ref: 'r2', occurrences: 3 },
      'FAIL_B::f1::r1': { code: 'FAIL_B', feature: 'f1', ref: 'r1', occurrences: 2 },
      'FAIL_B::f2::r2': { code: 'FAIL_B', feature: 'f2', ref: 'r2', occurrences: 2 },
      'FAIL_C::f1::r1': { code: 'FAIL_C', feature: 'f1', ref: 'r1', occurrences: 10 },
      'FAIL_C::f2::r2': { code: 'FAIL_C', feature: 'f2', ref: 'r2', occurrences: 10 },
    },
  };
  const cfg = { promotionThreshold: 2 };
  const suggestions = suggestLessons(data, signals, cfg, { limit: 10 });
  assert.ok(suggestions.length >= 3);
  // FAIL_C and FAIL_A have same features length (2), FAIL_C has 20 occurrences vs FAIL_A 8
  assert.equal(suggestions[0].signal, 'FAIL_C');
  assert.equal(suggestions[1].signal, 'FAIL_A');
});

test('src/util/text.js: globToRegExp handles question mark wildcard', () => {
  const re = globToRegExp('foo?bar');
  assert.ok(re.test('fooxbar'));
  assert.ok(!re.test('fooxybar'));
});

test('src/core/summary.js: lastAction handles truncated text, agent message > 120 chars and unknown lines', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'onpspec-cov-sum-'));
  try {
    process.env.ONP_SPEC_HOME = tmp;
    const streamFile = streamPath('r1', 'lane1--T-001');
    mkdirSync(path.dirname(streamFile), { recursive: true });
    const longText = 'A'.repeat(150);
    const content = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: longText }] } }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: longText } }),
      'not-json-at-end', // backwards loop hits this first, exercises catch { continue; }
    ].join('\n');
    writeFileSync(streamFile, content);

    const res = lastAction('r1', 'lane1--T-001');
    assert.ok(res.endsWith('…'));

    // stream with no matching events returns null (line 79)
    const streamNoMatch = streamPath('r1', 'lane1--none');
    writeFileSync(streamNoMatch, JSON.stringify({ type: 'unrelated_event' }));
    assert.equal(lastAction('r1', 'lane1--none'), null);

    // stream read error returns null (lines 44-45)
    mkdirSync(streamPath('r1', 'lane1--dir'), { recursive: true });
    assert.equal(lastAction('r1', 'lane1--dir'), null);
  } finally {
    delete process.env.ONP_SPEC_HOME;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('src/core/summary.js: deterministicSummary handles sequential running tasks and aligned audit', () => {
  const projects = [
    {
      runs: [
        {
          feature: 'feat-seq',
          project: 'proj-seq',
          done: 0,
          total: 1,
          lanes: [],
          sequential: [{ id: 'T-seq', title: 'Seq Task', state: 'running' }],
          running: true,
          gate: {},
        },
      ],
    },
  ];
  const textSeq = deterministicSummary(projects);
  assert.match(textSeq, /Running now: T-seq \(Seq Task\) in seq/);

  const doneProjects = [
    {
      runs: [
        {
          feature: 'feat-done',
          project: 'proj-done',
          done: 1,
          total: 1,
          lanes: [],
          sequential: [],
          running: false,
          end: 0,
          gate: { audit: 0 },
          gateStale: false,
        },
      ],
    },
  ];
  const doneText = deterministicSummary(doneProjects);
  assert.match(doneText, /Done: specification and code aligned \(audit exit 0\)/);

  const idleProjects = [
    {
      runs: [
        {
          feature: 'feat-idle',
          project: 'proj-idle',
          done: 0,
          total: 2,
          lanes: [],
          sequential: [],
          running: false,
          end: null,
          gate: {},
        },
      ],
    },
  ];
  const textIdle = deterministicSummary(idleProjects);
  assert.match(textIdle, /Idle right now — no task running\./);
});

test('src/core/summary.js: progressTable renders conflict, failed lanes, and stale gate', () => {
  const projects = [
    {
      name: 'proj1',
      runs: [
        {
          feature: 'feat1',
          project: 'proj1',
          done: 1,
          total: 2,
          lanes: [
            { id: 'lane-1', state: 'conflict', tasks: [{ id: 'T-1', title: 'Task 1', state: 'failed' }] },
            { id: 'lane-2', state: 'failed', tasks: [{ id: 'T-2', title: 'Task 2', state: 'running' }] },
          ],
          sequential: [{ id: 'T-3', title: 'Task 3', state: 'done' }],
          running: true,
          gate: { verify: 0, audit: 1 },
          gateStale: true,
        },
      ],
    },
  ];
  const table = progressTable(projects);
  assert.match(table, /lane-1 in merge CONFLICT/);
  assert.match(table, /lane-2 failed/);
  assert.match(table, /audit exit 1 \(stale\)/);
});

test('src/core/labels.js: findingLabel fallback for unknown finding code', () => {
  const label = findingLabel('UNKNOWN_CODE_ABC');
  assert.equal(label, 'unknown code abc');
});

test('src/core/ledger.js: toolSummary and contentText branches', () => {
  const stream = [
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Task', input: { description: 'desc' } },
          { type: 'tool_use', name: 'WebSearch', input: { query: 'my query' } },
          { type: 'tool_use', name: 'WebFetch', input: { url: 'https://example.com' } },
        ],
      },
    }),
    JSON.stringify({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', is_error: false, content: 42 }],
      },
    }),
  ].join('\n');
  const summary = summarizeStream(stream);
  assert.ok(summary.items.length >= 3);
});

test('src/parsers/annotations.js: grepPattern handles child process failure', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'onpspec-cov-ann-'));
  try {
    writeFileSync(path.join(tmp, 'file.txt'), 'hello world');
    const oldNodeOptions = process.env.NODE_OPTIONS;
    try {
      process.env.NODE_OPTIONS = '--invalid-flag-that-fails-node';
      const res = grepPattern(tmp, 'world', '*.txt', []);
      assert.ok(res.error && res.error.includes('failed to run the regex verification'));
    } finally {
      if (oldNodeOptions !== undefined) process.env.NODE_OPTIONS = oldNodeOptions;
      else delete process.env.NODE_OPTIONS;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('src/core/audit.js: constitution parse issues emit findings', () => {
  const project = {
    errors: [],
    config: { specDir: '.spec', rootDir: '/tmp' },
    features: [],
    testFiles: [],
    srcFiles: [],
    verifications: {},
    annotations: { specTags: [], principleTags: [] },
    constitution: {
      file: '.spec/constitution.md',
      principles: [],
      parseIssues: [{ code: 'CONST_PARSE_ERROR', message: 'malformed constitution', line: 4 }],
    },
  };
  const audit = auditProject(project);
  assert.ok(audit.findings.some((f) => f.code === 'CONST_PARSE_ERROR'));
});
