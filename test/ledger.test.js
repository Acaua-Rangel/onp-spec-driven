// Global ledger: ONE file for every project. This proves the tree
// project → run → lane → task comes out correctly from the events, that
// pruning never lets the file grow forever, and that the parser turns
// claude's stream-json into the timeline the panel shows.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';
import {
  recordEvent,
  readEvents,
  buildTree,
  pruneLedger,
  paths,
  streamPath,
  streamKey,
  summarizeStream,
  toolSummary,
  codexItemSummary,
  cursorToolCallSummary,
  readStream,
  runStreams,
} from '../src/core/ledger.js';

let home;
const prevHome = process.env.ONP_SPEC_HOME;
before(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'onpspec-ledger-'));
  process.env.ONP_SPEC_HOME = home;
});
after(() => {
  if (prevHome === undefined) delete process.env.ONP_SPEC_HOME;
  else process.env.ONP_SPEC_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});
beforeEach(() => {
  rmSync(paths().dir, { recursive: true, force: true });
});

function planEvent(runId, { project = 'repo-a', feature = 'payments', agent = 'claude', dir = '/tmp/repo-a' } = {}) {
  return {
    type: 'plan',
    runId,
    project,
    projectDir: dir,
    feature,
    agent,
    plan: {
      runId,
      workBranch: `spec/${feature}`,
      baseDir: `.spec/features/${feature}`,
      waves: [['lane-1', 'lane-2']],
      lanes: [
        {
          id: 'lane-1',
          branch: `spec/${feature}-lane-1`,
          worktree: '../wt-1',
          tasks: [
            { id: 'T-001', title: 'Model', model: 'claude-sonnet-5', effort: 'medium', files: ['src/a.js'] },
            { id: 'T-003', title: 'Route', model: 'claude-sonnet-5', effort: 'medium', files: ['src/b.js'] },
          ],
        },
        {
          id: 'lane-2',
          branch: `spec/${feature}-lane-2`,
          worktree: '../wt-2',
          tasks: [{ id: 'T-002', title: 'Receipt', model: 'claude-opus-5', effort: 'high', files: ['src/c.js'] }],
        },
      ],
      sequential: [{ id: 'T-004', title: 'Doc', model: 'claude-sonnet-5', effort: 'medium', files: [] }],
    },
  };
}

test('writes and reads the ledger under ONP_SPEC_HOME (never the real user home)', () => {
  recordEvent({ type: 'plan', runId: 'x', project: 'p' });
  assert.ok(paths().ledger.startsWith(home), 'ledger must stay under ONP_SPEC_HOME');
  assert.ok(existsSync(paths().ledger));
  const events = readEvents();
  assert.equal(events.length, 1);
  assert.ok(events[0].ts, 'event gets a timestamp');
});

test('a corrupted line in the ledger does not break the read', () => {
  recordEvent({ type: 'plan', runId: 'x' });
  writeFileSync(paths().ledger, `${readFileSync(paths().ledger, 'utf-8')}{broken\n`);
  recordEvent({ type: 'end', runId: 'x', exit: 0 });
  assert.deepEqual(readEvents().map((e) => e.type), ['plan', 'end']);
});

test('tree: groups by project and reflects lanes, tasks and counts', () => {
  recordEvent(planEvent('run-1'));
  recordEvent({ type: 'lane', runId: 'run-1', lane: 'lane-1', state: 'running', attempt: 1 });
  recordEvent({ type: 'task', runId: 'run-1', lane: 'lane-1', task: 'T-001', state: 'running', stream: 'lane-1--T-001' });

  const [proj] = buildTree(readEvents());
  assert.equal(proj.project, 'repo-a');
  const run = proj.runs[0];
  assert.equal(run.running, true, 'running task = running run');
  assert.equal(run.total, 4);
  assert.equal(run.done, 0);
  assert.equal(run.lanes[0].state, 'running');
  assert.equal(run.lanes[0].tasks[0].state, 'running');
  assert.equal(run.lanes[0].tasks[0].stream, 'lane-1--T-001');
  assert.equal(run.sequential[0].id, 'T-004');
});

test('tree: lane failure, completion and failure count', () => {
  recordEvent(planEvent('run-2'));
  recordEvent({ type: 'task', runId: 'run-2', lane: 'lane-1', task: 'T-001', state: 'done' });
  recordEvent({ type: 'lane', runId: 'run-2', lane: 'lane-1', state: 'merged' });
  recordEvent({ type: 'task', runId: 'run-2', lane: 'lane-2', task: 'T-002', state: 'failed' });
  recordEvent({ type: 'lane', runId: 'run-2', lane: 'lane-2', state: 'failed' });
  recordEvent({ type: 'end', runId: 'run-2', exit: 1, scope: 'all' });

  const run = buildTree(readEvents())[0].runs[0];
  assert.equal(run.running, false);
  assert.equal(run.end, 1);
  assert.equal(run.failures, 1);
  assert.equal(run.done, 1);
  assert.equal(run.lanes[1].tasks[0].state, 'failed');
});

test('summary event: only the most recent stays; empty text is ignored', () => {
  recordEvent(planEvent('run-rs'));
  recordEvent({ type: 'summary', runId: 'run-rs', text: 'first', source: 'engine' });
  recordEvent({ type: 'summary', runId: 'run-rs', text: 'second', source: 'ai' });
  recordEvent({ type: 'summary', runId: 'run-rs', text: '   ', source: 'ai' });

  const run = buildTree(readEvents())[0].runs[0];
  assert.equal(run.summary.text, 'second');
  assert.equal(run.summary.source, 'ai');
  assert.ok(run.summary.ts);
});

test("rerunning a lane: a new attempt reopens only that lane's tasks", () => {
  recordEvent(planEvent('run-3'));
  // first round: lane-1 ok, lane-2 failed
  recordEvent({ type: 'task', runId: 'run-3', lane: 'lane-1', task: 'T-001', state: 'done' });
  recordEvent({ type: 'lane', runId: 'run-3', lane: 'lane-1', state: 'merged' });
  recordEvent({ type: 'task', runId: 'run-3', lane: 'lane-2', task: 'T-002', state: 'failed' });
  recordEvent({ type: 'lane', runId: 'run-3', lane: 'lane-2', state: 'failed' });
  recordEvent({ type: 'gate', runId: 'run-3', step: 'audit', exit: 1 });
  recordEvent({ type: 'end', runId: 'run-3', exit: 1, scope: 'all' });
  // rerun only lane-2
  recordEvent({ type: 'start', runId: 'run-3', scope: 'lane:lane-2' });
  recordEvent({ type: 'lane', runId: 'run-3', lane: 'lane-2', state: 'running', attempt: 2 });

  const run = buildTree(readEvents())[0].runs[0];
  assert.equal(run.lanes[0].state, 'merged', 'lane-1 is not affected by rerunning lane-2');
  assert.equal(run.lanes[0].tasks[0].state, 'done');
  assert.equal(run.lanes[1].attempt, 2);
  assert.equal(run.lanes[1].tasks[0].state, 'pending', 'the task that failed goes back to pending on the new attempt');
  assert.equal(run.running, true);
});

test('gate becomes STALE when there is new work after the audit', () => {
  recordEvent(planEvent('run-4'));
  recordEvent({ type: 'gate', runId: 'run-4', step: 'verify', exit: 0 });
  recordEvent({ type: 'gate', runId: 'run-4', step: 'audit', exit: 1 });
  let run = buildTree(readEvents())[0].runs[0];
  assert.equal(run.gateStale, false);
  assert.deepEqual(run.gate, { verify: 0, audit: 1 });

  recordEvent({ type: 'start', runId: 'run-4', scope: 'lane:lane-2' });
  run = buildTree(readEvents())[0].runs[0];
  assert.equal(run.gateStale, true, 'new work invalidates the previous verdict');

  recordEvent({ type: 'gate', runId: 'run-4', step: 'audit', exit: 0 });
  run = buildTree(readEvents())[0].runs[0];
  assert.equal(run.gateStale, false, 'a fresh audit gives back a fresh verdict');
  assert.equal(run.gate.audit, 0);
});

test('an "all" run resets the previous gate', () => {
  recordEvent(planEvent('run-5'));
  recordEvent({ type: 'gate', runId: 'run-5', step: 'audit', exit: 1 });
  recordEvent({ type: 'start', runId: 'run-5', scope: 'all' });
  const run = buildTree(readEvents())[0].runs[0];
  assert.deepEqual(run.gate, { verify: null, audit: null });
  assert.equal(run.gateStale, false);
});

test('different projects share the SAME ledger and can be filtered', () => {
  recordEvent(planEvent('run-a', { project: 'repo-a', dir: '/tmp/repo-a', feature: 'payments' }));
  recordEvent(planEvent('run-b', { project: 'shop', dir: '/tmp/shop', feature: 'checkout' }));
  recordEvent(planEvent('run-c', { project: 'shop', dir: '/tmp/shop', feature: 'inventory' }));

  const all = buildTree(readEvents());
  assert.equal(all.length, 2, 'two projects');
  const shop = all.find((p) => p.project === 'shop');
  assert.equal(shop.runs.length, 2);

  const onlyShop = buildTree(readEvents(), { projectDir: '/tmp/shop' });
  assert.equal(onlyShop.length, 1);
  const onlyCheckout = buildTree(readEvents(), { projectDir: '/tmp/shop', feature: 'checkout' });
  assert.equal(onlyCheckout[0].runs.length, 1);
  assert.equal(onlyCheckout[0].runs[0].feature, 'checkout');
});

test('a run event with no plan (pruned) is ignored without crashing', () => {
  recordEvent({ type: 'lane', runId: 'ghost', lane: 'lane-1', state: 'running' });
  assert.deepEqual(buildTree(readEvents()), []);
});

test('pruning keeps the N most recent runs and deletes the streams of the old ones', () => {
  for (let i = 1; i <= 5; i++) {
    recordEvent(planEvent(`run-${i}`));
    const dir = path.dirname(streamPath(`run-${i}`, 'x'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(streamPath(`run-${i}`, 'lane-1--T-001'), '{}\n');
  }
  const { removed } = pruneLedger(2);
  assert.deepEqual(removed, ['run-1', 'run-2', 'run-3']);
  const remaining = buildTree(readEvents())[0].runs.map((e) => e.runId).sort();
  assert.deepEqual(remaining, ['run-4', 'run-5']);
  assert.ok(!existsSync(streamPath('run-1', 'lane-1--T-001')), "the pruned run's stream is gone");
  assert.ok(existsSync(streamPath('run-5', 'lane-1--T-001')), "the kept run's stream stays");
});

test('pruning does nothing when within the limit', () => {
  recordEvent(planEvent('run-1'));
  assert.deepEqual(pruneLedger(30).removed, []);
});

// ── model stream parser ────────────────────────────────────────────

test('toolSummary describes each tool by what matters to see', () => {
  assert.equal(toolSummary('Bash', { command: 'npm test' }), 'npm test');
  assert.equal(toolSummary('Read', { file_path: '/a/b/c/d/spec.md' }), 'c/d/spec.md');
  assert.match(toolSummary('Write', { file_path: '/x/y.js', content: 'a\nb\n' }), /y\.js \(3 lines\)/);
  assert.match(toolSummary('Edit', { file_path: '/x/y.js', old_string: 'old line\nrest' }), /y\.js — old line/);
  assert.equal(toolSummary('Grep', { pattern: 'TODO' }), 'TODO');
  assert.equal(toolSummary('TodoWrite', { todos: [1, 2, 3] }), '3 item(s)');
  assert.match(toolSummary('NewTool', { target: 'x' }), /target: "x"/);
  assert.equal(toolSummary('NoInput', {}), '');
});

// REAL shapes captured from `claude -p --output-format stream-json --verbose`
const STREAM_REAL = [
  '{"type":"system","subtype":"init","session_id":"fd1b2f49-aaaa","model":"claude-sonnet-5","cwd":"/tmp/x"}',
  '{"type":"rate_limit_event","rate_limit_info":{}}',
  '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/tmp/x/a.txt"}}],"usage":{"output_tokens":41}}}',
  '{"type":"user","message":{"content":[{"type":"tool_result","content":"1\\tx=1\\n"}]}}',
  '{"type":"system","subtype":"thinking_tokens","estimated_tokens":50,"estimated_tokens_delta":50}',
  '{"type":"system","subtype":"thinking_tokens","estimated_tokens":86,"estimated_tokens_delta":36}',
  '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"","signature":"abc"}],"usage":{"output_tokens":2}}}',
  '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"/tmp/x/b.txt","content":"x=2\\n"}}],"usage":{"output_tokens":2}}}',
  '{"type":"user","message":{"content":[{"type":"tool_result","content":[{"type":"text","text":"File created"}]}]}}',
  '{"type":"assistant","message":{"content":[{"type":"text","text":"Created b.txt"}],"usage":{"output_tokens":2}}}',
  '{"type":"result","subtype":"success","is_error":false,"duration_ms":9835,"num_turns":3,"total_cost_usd":0.1018,"result":"done","usage":{"input_tokens":6258,"output_tokens":376}}',
].join('\n');

test('summarizeStream turns the real NDJSON into the panel timeline', () => {
  const { items, total, summary } = summarizeStream(STREAM_REAL);
  assert.equal(total, 11);
  const types = items.map((i) => i.type);
  assert.deepEqual(types, ['start', 'tool', 'output', 'thinking', 'tool', 'output', 'text', 'end']);

  assert.equal(items[0].model, 'claude-sonnet-5');
  assert.equal(items[0].session, 'fd1b2f49');
  assert.equal(items[1].name, 'Read');
  assert.match(items[1].summary, /a\.txt/);
  assert.match(items[1].detail, /file_path/);
  // two thinking_tokens events become ONE accumulating item (86, not 50+86)
  assert.equal(items[3].tokens, 86);
  assert.equal(items[3].text, '', 'thinking comes redacted from headless — empty text, never made up');
  assert.equal(items[5].text, 'File created', 'tool_result in an array of blocks is also read');
  assert.equal(items[6].text, 'Created b.txt');
  assert.deepEqual(summary, {
    status: 'success',
    durationMs: 9835,
    turns: 3,
    costUsd: 0.1018,
    outputTokens: 376,
    inputTokens: 6258,
  });
});

test('summarizeStream flags tool error and error result', () => {
  const { items, summary } = summarizeStream(
    [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"node --test"}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","is_error":true,"content":"1 test failed"}]}}',
      '{"type":"result","subtype":"error_during_execution","is_error":true,"duration_ms":4210,"num_turns":3,"total_cost_usd":0.04}',
    ].join('\n')
  );
  assert.equal(items[1].type, 'output');
  assert.equal(items[1].error, true);
  assert.equal(summary.status, 'error');
});

test('summarizeStream is incremental (the panel only asks for what is missing)', () => {
  const first = summarizeStream(STREAM_REAL, { since: 0 });
  const second = summarizeStream(STREAM_REAL, { since: first.total });
  assert.equal(second.items.length, 0, 'nothing new since the end');
  const partial = summarizeStream(STREAM_REAL, { since: 9 });
  assert.deepEqual(partial.items.map((i) => i.type), ['text', 'end']);
  assert.equal(partial.total, 11);
});

// shapes of `codex exec --json` per the official docs (JSON Lines:
// thread.started, turn.*, item.* — items agent_message, reasoning,
// command_execution, file_change, mcp_tool_call, web_search, todo_list)
const STREAM_CODEX = [
  '{"type":"thread.started","thread_id":"0199a213-81c0-7800-8aa1-bbab2a035a53"}',
  '{"type":"turn.started"}',
  '{"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"bash -lc ls","status":"in_progress"}}',
  '{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"bash -lc ls","aggregated_output":"src\\ntest\\n","exit_code":0,"status":"completed"}}',
  '{"type":"item.completed","item":{"id":"item_1","type":"reasoning","text":"Need to read the spec first."}}',
  '{"type":"item.completed","item":{"id":"item_2","type":"file_change","status":"completed","changes":[{"path":"/tmp/x/src/a.js","kind":"update"}]}}',
  '{"type":"item.completed","item":{"id":"item_3","type":"todo_list","items":[{"text":"read spec","completed":true},{"text":"implement","completed":false}]}}',
  '{"type":"item.completed","item":{"id":"item_4","type":"agent_message","text":"Task done and committed."}}',
  '{"type":"turn.completed","usage":{"input_tokens":24763,"cached_input_tokens":24448,"output_tokens":122}}',
].join('\n');

test('summarizeStream understands codex exec --json JSONL (parity with claude)', () => {
  const { items, total, summary } = summarizeStream(STREAM_CODEX);
  assert.equal(total, 9);
  const types = items.map((i) => i.type);
  assert.deepEqual(types, ['start', 'tool', 'output', 'thinking', 'tool', 'tool', 'text', 'end']);

  assert.equal(items[0].session, '0199a213');
  assert.equal(items[1].name, 'Bash');
  assert.match(items[1].summary, /bash -lc ls/);
  assert.equal(items[2].error, false, 'exit_code 0 is not an error');
  assert.match(items[2].text, /src/);
  assert.match(items[3].text, /read the spec/);
  assert.equal(items[4].name, 'Edit');
  assert.match(items[4].summary, /update .*src\/a\.js/);
  assert.equal(items[5].name, 'Plan');
  assert.equal(items[5].summary, '2 item(s)');
  assert.equal(items[6].text, 'Task done and committed.');
  assert.equal(summary.status, 'success');
  assert.equal(summary.turns, 1);
  assert.equal(summary.outputTokens, 122);
  assert.equal(summary.inputTokens, 24763);
});

test('summarizeStream (codex): exit != 0 command and turn.failed become errors', () => {
  const { items, summary } = summarizeStream(
    [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"item.completed","item":{"id":"i1","type":"command_execution","command":"node --test","aggregated_output":"1 test failed","exit_code":1,"status":"failed"}}',
      '{"type":"turn.failed","error":{"message":"task aborted"}}',
    ].join('\n')
  );
  const output = items.find((i) => i.type === 'output');
  assert.equal(output.error, true);
  assert.match(output.text, /failed/);
  assert.equal(summary.status, 'error');
  const end = items.find((i) => i.type === 'end');
  assert.match(end.text, /task aborted/);
});

// shapes of the Cursor CLI (`agent -p --output-format stream-json`) per the
// official docs (cursor.com/docs/cli/reference/output-format): NDJSON
// with system/init, user, assistant and result in the SAME shape as claude;
// tools arrive as tool_call started/completed events with the body in
// tool_call.<name>ToolCall (args and, on completed, result.success/error).
const STREAM_CURSOR = [
  '{"type":"system","subtype":"init","apiKeySource":"login","cwd":"/tmp/x","session_id":"9f2b1c4d-0000-0000-0000-000000000000","model":"Claude Sonnet 5","permissionMode":"default"}',
  '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Run task T-001"}]},"session_id":"9f2b1c4d"}',
  '{"type":"tool_call","subtype":"started","call_id":"c1","tool_call":{"readToolCall":{"args":{"path":"/tmp/x/.spec/features/payments/spec.md"}}},"session_id":"9f2b1c4d"}',
  '{"type":"tool_call","subtype":"completed","call_id":"c1","tool_call":{"readToolCall":{"args":{"path":"/tmp/x/.spec/features/payments/spec.md"},"result":{"success":{"content":"# Spec...","isEmpty":false,"totalLines":54,"totalChars":1254}}}},"session_id":"9f2b1c4d"}',
  '{"type":"tool_call","subtype":"started","call_id":"c2","tool_call":{"shellToolCall":{"args":{"command":"node --test"}}},"session_id":"9f2b1c4d"}',
  '{"type":"tool_call","subtype":"completed","call_id":"c2","tool_call":{"shellToolCall":{"args":{"command":"node --test"},"result":{"success":{"output":"tests 3 pass 3"}}}},"session_id":"9f2b1c4d"}',
  '{"type":"tool_call","subtype":"completed","call_id":"c3","tool_call":{"writeToolCall":{"args":{"path":"/tmp/x/src/a.js"},"result":{"success":{"linesCreated":12}}}},"session_id":"9f2b1c4d"}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Task done and committed."}]},"session_id":"9f2b1c4d"}',
  '{"type":"result","subtype":"success","duration_ms":45210,"duration_api_ms":44100,"is_error":false,"result":"Task done and committed.","session_id":"9f2b1c4d","request_id":"req-1"}',
].join('\n');

test('summarizeStream understands the Cursor CLI stream-json (parity with claude and codex)', () => {
  const { items, total, summary } = summarizeStream(STREAM_CURSOR);
  assert.equal(total, 9);
  const types = items.map((i) => i.type);
  // started does not enter (it would be a duplicate); completed becomes tool (+ output when there is text)
  assert.deepEqual(types, ['start', 'tool', 'output', 'tool', 'output', 'tool', 'text', 'end']);

  assert.equal(items[0].session, '9f2b1c4d');
  assert.equal(items[0].model, 'Claude Sonnet 5');
  assert.equal(items[1].name, 'Read');
  assert.match(items[1].summary, /features\/payments\/spec\.md/);
  assert.equal(items[2].error, false);
  assert.match(items[2].text, /# Spec/);
  assert.equal(items[3].name, 'Bash');
  assert.match(items[3].summary, /node --test/);
  assert.match(items[4].text, /tests 3 pass 3/);
  assert.equal(items[5].name, 'Write');
  assert.equal(items[6].text, 'Task done and committed.');
  assert.equal(summary.status, 'success');
  assert.equal(summary.durationMs, 45210);
  assert.equal(summary.costUsd, null, 'the Cursor stream carries no usage/cost — never make it up');
});

test('summarizeStream (cursor): tool_call error and result is_error become an error', () => {
  const { items, summary } = summarizeStream(
    [
      '{"type":"system","subtype":"init","session_id":"abc-def","model":"composer","permissionMode":"default"}',
      '{"type":"tool_call","subtype":"completed","call_id":"c1","tool_call":{"shellToolCall":{"args":{"command":"node --test"},"result":{"error":{"message":"1 test failed"}}}}}',
      '{"type":"result","subtype":"error","duration_ms":100,"is_error":true,"result":"the task failed","session_id":"abc-def"}',
    ].join('\n')
  );
  const output = items.find((i) => i.type === 'output');
  assert.equal(output.error, true);
  assert.match(output.text, /1 test failed/);
  assert.equal(summary.status, 'error');
  const end = items.find((i) => i.type === 'end');
  assert.match(end.text, /the task failed/);
});

test('cursorToolCallSummary summarizes Cursor tool_calls in one line', () => {
  const read = cursorToolCallSummary({ readToolCall: { args: { path: '/a/b/c/d.md' } } });
  assert.equal(read.name, 'Read');
  assert.equal(read.summary, 'b/c/d.md');
  assert.equal(read.hasResult, false, 'started has no result yet');

  const shell = cursorToolCallSummary({ shellToolCall: { args: { command: 'npm test' } } });
  assert.deepEqual([shell.name, shell.summary], ['Bash', 'npm test']);

  // grep with pattern AND path: what matters to see is the SEARCH, not the directory
  const grep = cursorToolCallSummary({ grepToolCall: { args: { pattern: 'AC-\\d+', path: '/tmp/x/src' } } });
  assert.deepEqual([grep.name, grep.summary], ['Grep', 'AC-\\d+']);

  // unknown tool does not crash: name derived from the body itself
  const other = cursorToolCallSummary({ deployToolCall: { args: { target: 'staging' } } });
  assert.equal(other.name, 'Deploy');
  assert.match(other.summary, /target/);

  // odd shape (no *ToolCall) is ignored, never explodes
  assert.equal(cursorToolCallSummary({ foo: {} }), null);
  assert.equal(cursorToolCallSummary(), null);
});

test('codexItemSummary summarizes codex tool items in one line', () => {
  assert.deepEqual(codexItemSummary({ type: 'command_execution', command: 'npm test' }), {
    name: 'Bash',
    summary: 'npm test',
  });
  assert.match(
    codexItemSummary({ type: 'file_change', changes: [{ path: '/a/b/c/d.js', kind: 'add' }] }).summary,
    /add b\/c\/d\.js/
  );
  assert.equal(codexItemSummary({ type: 'mcp_tool_call', server: 'db', tool: 'query' }).name, 'db.query');
  assert.equal(codexItemSummary({ type: 'web_search', query: 'node test runner' }).summary, 'node test runner');
  assert.equal(codexItemSummary({ type: 'agent_message', text: 'hi' }), null, 'a message is not a tool');
});

test('summarizeStream tolerates a non-JSON line (leaked stderr in the file)', () => {
  const { items } = summarizeStream('this is not json\n{"type":"result","subtype":"success"}');
  assert.equal(items[0].type, 'raw');
  assert.match(items[0].text, /not json/);
  assert.equal(items[1].type, 'end');
});

test('readStream/runStreams read from disk and do not explode without a file', () => {
  assert.deepEqual(readStream('does-not-exist', 'x'), { items: [], total: 0, summary: null, exists: false });
  assert.deepEqual(runStreams('does-not-exist'), []);

  const key = streamKey('lane-1', 'T-001');
  assert.equal(key, 'lane-1--T-001');
  mkdirSync(path.dirname(streamPath('run-x', key)), { recursive: true });
  writeFileSync(streamPath('run-x', key), STREAM_REAL);
  const s = readStream('run-x', key);
  assert.equal(s.exists, true);
  assert.equal(s.total, 11);
  assert.deepEqual(runStreams('run-x').map((x) => x.key), [key]);
});

test('giant texts are truncated (the panel cannot receive megabytes)', () => {
  const huge = 'x'.repeat(5000);
  const { items } = summarizeStream(
    `{"type":"assistant","message":{"content":[{"type":"text","text":"${huge}"}]}}`
  );
  assert.ok(items[0].text.length < 1300, `truncated, got ${items[0].text.length}`);
  assert.match(items[0].text, /…$/);
});
