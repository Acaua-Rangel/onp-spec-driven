// Overall progress summary: the engine counts what it sees (deterministic),
// the AI writes on top (--save --text), and freshness decides which one
// counts — a stale AI summary claiming "running" would be a lie.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import { recordEvent, readEvents, buildTree, paths, streamPath } from '../src/core/ledger.js';
import {
  deterministicSummary,
  contextForAi,
  buildCurrentSummary,
  recordSummary,
  targetRun,
  lastAction,
  progressTable,
  AI_FRESHNESS_MS,
} from '../src/core/summary.js';

let home;
const before_ = process.env.ONP_SPEC_HOME;
before(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'onpspec-summary-'));
  process.env.ONP_SPEC_HOME = home;
});
after(() => {
  if (before_ === undefined) delete process.env.ONP_SPEC_HOME;
  else process.env.ONP_SPEC_HOME = before_;
  rmSync(home, { recursive: true, force: true });
});
beforeEach(() => {
  rmSync(paths().dir, { recursive: true, force: true });
});

function plan(runId = 'run-r') {
  recordEvent({
    type: 'plan',
    runId,
    project: 'repo-a',
    projectDir: '/tmp/repo-a',
    feature: 'payments',
    agent: 'claude',
    plan: {
      runId,
      workBranch: 'spec/payments',
      baseDir: '.spec/features/payments',
      waves: [['lane-1', 'lane-2']],
      lanes: [
        {
          id: 'lane-1',
          branch: 'spec/payments-lane-1',
          worktree: '../wt-1',
          tasks: [{ id: 'T-001', title: 'Billing model', model: 'claude-sonnet-5', effort: 'medium', files: ['a'] }],
        },
        {
          id: 'lane-2',
          branch: 'spec/payments-lane-2',
          worktree: '../wt-2',
          tasks: [{ id: 'T-002', title: 'Receipt', model: 'claude-opus-5', effort: 'high', files: ['b'] }],
        },
      ],
      sequential: [],
    },
  });
  return runId;
}

test('empty: the engine summary explains the next step instead of silence', () => {
  assert.match(deterministicSummary([]), /No run in the ledger/);
});

test('engine narrates: done tasks and a running task with the model\'s last action', () => {
  const runId = plan();
  recordEvent({ type: 'task', runId, lane: 'lane-1', task: 'T-001', state: 'running', stream: 'lane-1--T-001' });
  mkdirSync(path.dirname(streamPath(runId, 'lane-1--T-001')), { recursive: true });
  writeFileSync(
    streamPath(runId, 'lane-1--T-001'),
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"npm test"}}]}}\n'
  );

  const text = deterministicSummary(buildTree(readEvents()));
  assert.match(text, /"payments" \(repo-a\): 0 of 2/);
  assert.match(text, /Running now: T-001 \(Billing model\) in lane-1/);
  assert.match(text, /last action: Bash: npm test/);
});

test('engine does not announce victory without an audit: a pending gate is reported as pending', () => {
  const runId = plan();
  recordEvent({ type: 'task', runId, lane: 'lane-1', task: 'T-001', state: 'done' });
  recordEvent({ type: 'task', runId, lane: 'lane-2', task: 'T-002', state: 'done' });
  const text = deterministicSummary(buildTree(readEvents()));
  assert.match(text, /gate \(verify \+ audit\) still pending/);
  assert.doesNotMatch(text, /aligned/);
});

test('a failure asks for the agent; a conflict asks for resolution', () => {
  const runId = plan();
  recordEvent({ type: 'lane', runId, lane: 'lane-1', state: 'failed' });
  recordEvent({ type: 'lane', runId, lane: 'lane-2', state: 'conflict' });
  recordEvent({ type: 'end', runId, exit: 1, scope: 'all' });
  const text = deterministicSummary(buildTree(readEvents()));
  assert.match(text, /lane-1 failed — ask the agent/);
  assert.match(text, /lane-2 stopped in a merge CONFLICT/);
});

test('buildCurrentSummary: a fresh AI summary wins; a stale one loses to the engine', () => {
  const runId = plan();
  recordEvent({ type: 'task', runId, lane: 'lane-1', task: 'T-001', state: 'running' });
  recordEvent({ type: 'summary', runId, text: 'The model is fixing the PSP webhook.', source: 'ai' });

  const tree = buildTree(readEvents());
  const fresh = buildCurrentSummary(tree);
  assert.equal(fresh.source, 'ai');
  assert.match(fresh.text, /webhook/);

  const later = Date.now() + AI_FRESHNESS_MS + 1000;
  const stale = buildCurrentSummary(tree, { now: later });
  assert.equal(stale.source, 'engine', 'a stale AI summary cannot fake real time');
});

test('recordSummary normalizes whitespace, clips a huge text and requires a runId', () => {
  const runId = plan();
  const r = recordSummary({ runId, text: '  line 1\n\nline   2  ', source: 'ai' });
  assert.equal(r.text, 'line 1 line 2');
  const events = readEvents().filter((e) => e.type === 'summary');
  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'ai');

  const big = recordSummary({ runId, text: 'x'.repeat(5000) });
  assert.equal(big.text.length, 1200);
  assert.ok(recordSummary({ runId: null, text: 'x' }).error);
  assert.ok(recordSummary({ runId, text: '   ' }).error);
});

test('targetRun: prefers the one running; --run forces; empty returns null', () => {
  const a = plan('run-a');
  recordEvent({ type: 'end', runId: a, exit: 0, scope: 'all' });
  const b = plan('run-b');
  recordEvent({ type: 'task', runId: b, lane: 'lane-1', task: 'T-001', state: 'running' });

  const tree = buildTree(readEvents());
  assert.equal(targetRun(tree).runId, 'run-b', 'the running run is the natural target');
  assert.equal(targetRun(tree, { runId: 'run-a' }).runId, 'run-a');
  assert.equal(targetRun(tree, { runId: 'ghost' }), null);
  assert.equal(targetRun([]), null);
});

test('lastAction reads only the tail of the stream and tolerates a missing file', () => {
  const runId = plan();
  const key = 'lane-1--T-001';
  mkdirSync(path.dirname(streamPath(runId, key)), { recursive: true });
  const filler = Array.from({ length: 200 }, () =>
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok'.repeat(40) }] } })
  );
  filler.push(
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/x/y.js', old_string: 'a' } }] } })
  );
  writeFileSync(streamPath(runId, key), filler.join('\n'));
  assert.match(lastAction(runId, key), /^Edit: .*y\.js — a/);
  assert.equal(lastAction(runId, 'does--not-exist'), null);
});

test('lastAction understands the Cursor CLI tool_call (including started, still running)', () => {
  const runId = plan();
  const key = 'lane-1--T-002';
  mkdirSync(path.dirname(streamPath(runId, key)), { recursive: true });
  writeFileSync(
    streamPath(runId, key),
    [
      '{"type":"system","subtype":"init","session_id":"abc","model":"composer"}',
      '{"type":"tool_call","subtype":"started","call_id":"c1","tool_call":{"shellToolCall":{"args":{"command":"node --test"}}}}',
    ].join('\n')
  );
  assert.equal(lastAction(runId, key), 'Bash: node --test', 'started shows what is running NOW');

  writeFileSync(
    streamPath(runId, key),
    '{"type":"tool_call","subtype":"completed","call_id":"c2","tool_call":{"readToolCall":{"args":{"path":"/a/b/spec.md"},"result":{"success":{"content":"x"}}}}}\n'
  );
  assert.equal(lastAction(runId, key), 'Read: a/b/spec.md');
});

test('progressTable: one row per task, with where it runs, status and last action', () => {
  const runId = plan();
  recordEvent({ type: 'task', runId, lane: 'lane-1', task: 'T-001', state: 'running', stream: 'lane-1--T-001' });
  mkdirSync(path.dirname(streamPath(runId, 'lane-1--T-001')), { recursive: true });
  writeFileSync(
    streamPath(runId, 'lane-1--T-001'),
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"npm test | tee log"}}]}}\n'
  );

  const md = progressTable(buildTree(readEvents()));
  assert.match(md, /\*\*payments\*\* \(repo-a\) — 0 of 2 task\(s\) done/);
  assert.match(md, /RUNNING/);
  assert.match(md, /\| task \| title \| where \| status \| last action \|/);
  assert.match(md, /\| T-001 \| Billing model \| lane-1 \| ▶️ running \| Bash: npm test \\\| tee log \|/, 'cell pipe escaped');
  assert.match(md, /\| T-002 \| Receipt \| lane-2 \| ⏳ pending \| — \|/);
});

test('progressTable: done/failed show up; the footer brings the failed lane and the gate', () => {
  const runId = plan();
  recordEvent({ type: 'task', runId, lane: 'lane-1', task: 'T-001', state: 'done' });
  recordEvent({ type: 'task', runId, lane: 'lane-2', task: 'T-002', state: 'failed' });
  recordEvent({ type: 'lane', runId, lane: 'lane-2', state: 'failed' });
  recordEvent({ type: 'gate', runId, step: 'verify', exit: 0 });
  recordEvent({ type: 'gate', runId, step: 'audit', exit: 1 });
  recordEvent({ type: 'end', runId, exit: 1, scope: 'all' });

  const md = progressTable(buildTree(readEvents()));
  assert.match(md, /1 of 2 task\(s\) done/);
  assert.match(md, /\| T-001 .* ✅ done /);
  assert.match(md, /\| T-002 .* ❌ failed /);
  assert.match(md, /lane-2 failed \(re-run: --lane lane-2\)/);
  assert.match(md, /verify exit 0 · audit exit 1/);
  assert.doesNotMatch(md, /RUNNING/);
});

test('progressTable: empty explains the next step; nothing running shows the most recent', () => {
  assert.match(progressTable([]), /No run in the ledger/);
  const runId = plan();
  recordEvent({ type: 'end', runId, exit: 0, scope: 'all' });
  const md = progressTable(buildTree(readEvents()));
  assert.match(md, /\| T-001 \|/, 'the most recent run shows up even when stopped');
});

test('contextForAi lists the lanes and tasks of the run that is running', () => {
  const runId = plan();
  recordEvent({ type: 'lane', runId, lane: 'lane-1', state: 'running', attempt: 1 });
  recordEvent({ type: 'task', runId, lane: 'lane-1', task: 'T-001', state: 'running' });
  const ctx = contextForAi(buildTree(readEvents()));
  assert.match(ctx, /Mechanical state:/);
  assert.match(ctx, /payments\/lane-1: running/);
  assert.match(ctx, /T-001 \[running\] Billing model/);
});
