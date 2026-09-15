// E2E of what the user asked for: a lane fails, and it is possible to re-run
// ONLY that lane. Uses a `claude` stub that emits real stream-json (the same
// event types as the real CLI), so it also proves the stream reaches the
// ledger and that `onp-spec summary` would have something to narrate.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { readEvents, buildTree, readStream, paths } from '../src/core/ledger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(__dirname, '..', 'bin', 'onp-spec.js');

// on Windows, `bash` is usually the WSL wrapper: it does not understand a
// raw `C:\...` path (backslashes get eaten), so `node` on the plain PATH
// is invisible to it. Translate the directory of the running node binary to
// its `/mnt/<drive>/...` form so the generated script's `command -v node`
// finds it.
function bashPathEntry(winPath) {
  if (process.platform !== 'win32') return winPath;
  return winPath.replace(/^([A-Za-z]):\\/, (_, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');
}
const NODE_DIR = bashPathEntry(path.dirname(process.execPath));

let tmp;
let repo;
let stubDir;
const before_ = process.env.ONP_SPEC_HOME;

// stub: emits the SAME event types as `claude -p --output-format
// stream-json --verbose`, does real work (file + commit) and fails the
// tasks listed in the `fail-tasks` marker file next to it.
//
// NOTE: on Windows, `bash` (the WSL wrapper) does not forward arbitrary
// environment variables from the launching Windows process into the shell
// session (only PATH gets special, translated treatment) — so the "which
// task should fail" signal has to travel through a file, not an env var.
const STUB = `#!/usr/bin/env bash
PROMPT="\${2:-}"
TASK=$(printf '%s' "$PROMPT" | grep -o 'T-[0-9]\\{3\\}' | head -1)
[ -z "$TASK" ] && TASK="T-000"
# stagger tasks on purpose: the generated script merges each lane as soon as
# its own background job finishes, with no cross-lane coordination — if two
# lanes finish at the exact same instant they race for the same repo HEAD.
# Real model calls never land in the same millisecond; this stub reproduces
# that natural spacing so the test is deterministic.
case "$TASK" in T-001) sleep 0.2 ;; T-002) sleep 1 ;; esac
MODEL="?"
while [ $# -gt 0 ]; do case "$1" in --model) MODEL="\${2:-}";; esac; shift; done
printf '%s\\n' "{\\"type\\":\\"system\\",\\"subtype\\":\\"init\\",\\"session_id\\":\\"sess-$TASK\\",\\"model\\":\\"$MODEL\\"}"
printf '%s\\n' "{\\"type\\":\\"system\\",\\"subtype\\":\\"thinking_tokens\\",\\"estimated_tokens\\":73}"
printf '%s\\n' "{\\"type\\":\\"assistant\\",\\"message\\":{\\"content\\":[{\\"type\\":\\"tool_use\\",\\"name\\":\\"Read\\",\\"input\\":{\\"file_path\\":\\"spec.md\\"}}]}}"
printf '%s\\n' "{\\"type\\":\\"user\\",\\"message\\":{\\"content\\":[{\\"type\\":\\"tool_result\\",\\"content\\":\\"content\\"}]}}"
FAIL_FILE="$(dirname "\${BASH_SOURCE[0]}")/fail-tasks"
if [ -f "$FAIL_FILE" ] && grep -q "$TASK" "$FAIL_FILE"; then
  printf '%s\\n' "{\\"type\\":\\"user\\",\\"message\\":{\\"content\\":[{\\"type\\":\\"tool_result\\",\\"is_error\\":true,\\"content\\":\\"red test\\"}]}}"
  printf '%s\\n' "{\\"type\\":\\"result\\",\\"subtype\\":\\"error_during_execution\\",\\"is_error\\":true,\\"duration_ms\\":1200,\\"num_turns\\":2,\\"total_cost_usd\\":0.01}"
  exit 1
fi
printf 'done by %s\\n' "$TASK" > "file-$TASK.txt"
printf '%s\\n' "{\\"type\\":\\"assistant\\",\\"message\\":{\\"content\\":[{\\"type\\":\\"tool_use\\",\\"name\\":\\"Write\\",\\"input\\":{\\"file_path\\":\\"file-$TASK.txt\\",\\"content\\":\\"x\\"}}]}}"
git add -A >/dev/null 2>&1
git commit -q -m "$TASK: done by the stub" >/dev/null 2>&1
printf '%s\\n' "{\\"type\\":\\"result\\",\\"subtype\\":\\"success\\",\\"is_error\\":false,\\"duration_ms\\":3400,\\"num_turns\\":3,\\"total_cost_usd\\":0.05,\\"usage\\":{\\"output_tokens\\":120}}"
exit 0
`;

const SPEC = `# Spec: Payments

> feature: payments
> status: in-implementation

## Stories

### US-001 — Billing

As finance, I want to bill, so that we get paid.

#### AC-001 — Bill created

- **Given** an active student
- **When** the month rolls over
- **Then** the bill appears

## Assumptions

| ID | Assumption | Status | Resolution |
|---|---|---|---|

## Open questions

| ID | Question | Status | Answer |
|---|---|---|---|
`;

const TASKS = `# Tasks: Payments

> feature: payments

## T-001 — Model [pending]

- Refs: AC-001
- Files: src/a.js

## T-002 — Service [pending]

- Refs: AC-001
- Files: src/b.js
`;

function cli(args, extraEnv = {}) {
  return spawnSync('node', [BIN, ...args], {
    cwd: repo,
    encoding: 'utf-8',
    env: { ...process.env, ...extraEnv },
  });
}

// which task IDs the `claude` stub should fail on its next run (see the
// `fail-tasks` marker file read by STUB above).
function stubFail(...taskIds) {
  writeFileSync(path.join(stubDir, 'fail-tasks'), taskIds.join('\n'));
}

function runScript(args) {
  // invoke through a small wrapper script (not `bash -c '...' name args`):
  // this WSL bash.exe wrapper silently drops extra positional arguments
  // when invoked with `-c`, so the export has to live in a real file.
  //
  // the generated script reads `$ONP_SPEC_HOME` directly in bash (e.g. to
  // compute STREAMS_DIR) — since custom env vars set on the spawnSync
  // `env` option are NOT forwarded into a WSL bash session (only PATH gets
  // special, translated treatment; win32 child processes like `node.exe`
  // get the original env some other way), that variable has to be
  // `export`-ed from inside the bash script itself, using its
  // WSL-translated form. The wrapper's own path is passed in translated
  // form too, for the same reason a raw `C:\...` path can't be used as a
  // bash argv.
  return spawnSync('bash', [bashPathEntry(path.join(stubDir, 'run-wrapper.sh')), ...args], {
    cwd: repo,
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${stubDir}:${NODE_DIR}:${process.env.PATH}` },
  });
}

const run = () => buildTree(readEvents())[0].runs[0];
const commits = () =>
  parseInt(spawnSync('git', ['rev-list', '--count', 'HEAD'], { cwd: repo, encoding: 'utf-8' }).stdout.trim(), 10);

before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'onpspec-rerun-'));
  process.env.ONP_SPEC_HOME = path.join(tmp, 'home');
  stubDir = path.join(tmp, 'stub');
  mkdirSync(stubDir, { recursive: true });
  writeFileSync(path.join(stubDir, 'claude'), STUB);
  chmodSync(path.join(stubDir, 'claude'), 0o755);
  if (process.platform === 'win32') {
    // `command -v node` (a bash builtin) only matches a file literally
    // named `node`, and on Windows the real binary is `node.exe`. Give
    // bash a `node` it can find, which just execs the real `node.exe`
    // (already reachable on PATH via NODE_DIR).
    writeFileSync(path.join(stubDir, 'node'), '#!/usr/bin/env bash\nexec node.exe "$@"\n');
    chmodSync(path.join(stubDir, 'node'), 0o755);
  }
  // wrapper that exports ONP_SPEC_HOME (WSL-translated) before delegating
  // to the generated script — see the comment in runScript() above.
  writeFileSync(
    path.join(stubDir, 'run-wrapper.sh'),
    `#!/usr/bin/env bash\nexport ONP_SPEC_HOME='${bashPathEntry(path.join(tmp, 'home'))}'\nexec bash .spec/features/payments/run-tasks.sh "$@"\n`,
  );
  chmodSync(path.join(stubDir, 'run-wrapper.sh'), 0o755);

  repo = path.join(tmp, 'project');
  mkdirSync(repo, { recursive: true });
  for (const args of [
    ['init', '-q'],
    ['config', 'user.email', 't@t.dev'],
    ['config', 'user.name', 'T'],
    // avoid false "dirty tree" positives: the generated script runs
    // through bash (Linux git on Windows+WSL), which otherwise reports
    // spurious executable-bit / line-ending changes on files mounted
    // from NTFS versus what the Windows git that created them assumed
    ['config', 'core.fileMode', 'false'],
    ['config', 'core.autocrlf', 'false'],
  ]) {
    spawnSync('git', args, { cwd: repo });
  }
  cli(['init']);
  cli(['new', 'payments']);
  writeFileSync(path.join(repo, '.spec/features/payments/spec.md'), SPEC);
  writeFileSync(path.join(repo, '.spec/features/payments/tasks.md'), TASKS);
  spawnSync('git', ['add', '-A'], { cwd: repo });
  spawnSync('git', ['commit', '-qm', 'spec'], { cwd: repo });
});

after(() => {
  if (before_ === undefined) delete process.env.ONP_SPEC_HOME;
  else process.env.ONP_SPEC_HOME = before_;
  // clean up worktrees that may be left over from a failed lane
  spawnSync('git', ['worktree', 'prune'], { cwd: repo });
  rmSync(tmp, { recursive: true, force: true });
  rmSync(path.join(path.dirname(tmp), 'onp-worktrees'), { recursive: true, force: true });
});

test('plan records the run in the global ledger (with project and lanes)', () => {
  const r = cli(['plan', 'payments']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(paths().ledger.startsWith(path.join(tmp, 'home')), 'ledger isolated in the test tmp');
  const rn = run();
  assert.equal(rn.feature, 'payments');
  assert.equal(rn.lanes.length, 2, 'T-001 and T-002 have disjoint files → 2 parallel lanes');
  assert.equal(rn.total, 2);
  assert.equal(rn.end, null);
});

test('full run: lane-2 fails, lane-1 finishes and the stream gets recorded', () => {
  stubFail('T-002');
  const r = runScript([]);
  assert.equal(r.status, 1, 'exit 1 because there was a failure and the audit does not close');

  const rn = run();
  assert.equal(rn.lanes.find((f) => f.id === 'lane-1').state, 'merged');
  assert.equal(rn.lanes.find((f) => f.id === 'lane-2').state, 'failed');
  assert.equal(rn.lanes.find((f) => f.id === 'lane-1').tasks[0].state, 'done');
  assert.equal(rn.lanes.find((f) => f.id === 'lane-2').tasks[0].state, 'failed');
  assert.equal(rn.end, 1);
  assert.equal(rn.gate.audit, 1, 'the gate ran and failed (no tests written)');

  // tasks.md only marked the task that really passed
  const tasks = readFileSync(path.join(repo, '.spec/features/payments/tasks.md'), 'utf-8');
  assert.match(tasks, /## T-001 — Model \[done\]/);
  assert.match(tasks, /## T-002 — Service \[pending\]/);

  // model stream: shows what happened in each task
  const ok = readStream(rn.runId, 'lane-1--T-001');
  assert.equal(ok.exists, true);
  assert.equal(ok.summary.status, 'success');
  assert.deepEqual(ok.items.filter((i) => i.type === 'tool').map((i) => i.name), ['Read', 'Write']);

  const fail = readStream(rn.runId, 'lane-2--T-002');
  assert.equal(fail.summary.status, 'error');
  assert.ok(fail.items.some((i) => i.type === 'output' && i.error), 'the tool error shows up in the stream');

  // the exit trap recorded the final summary in the ledger (never silence)
  assert.ok(readEvents().some((e) => e.type === 'summary' && e.runId === rn.runId));
  // and `onp-spec summary` narrates the state from what is in the ledger
  const summary = cli(['summary', 'payments']);
  assert.equal(summary.status, 0, summary.stderr);
  assert.match(summary.stdout, /lane-2 failed — ask the agent/);
});

test('re-run ONLY the failed lane: new attempt, without touching the lane that already passed', () => {
  const commitsBefore = commits();
  const lane1File = path.join(repo, 'file-T-001.txt');
  const contentBefore = readFileSync(lane1File, 'utf-8');

  stubFail(); // no more failing tasks: this attempt passes
  const r = runScript(['--lane', 'lane-2']);
  assert.equal(r.status, 1, 'still exit 1: the audit fails for lack of tests — and that is honest');

  const rn = run();
  const f2 = rn.lanes.find((f) => f.id === 'lane-2');
  assert.equal(f2.state, 'merged');
  assert.equal(f2.attempt, 2, 'the re-run counts as attempt 2');
  assert.equal(f2.tasks[0].state, 'done');
  // the lane that was already ready was not re-run
  assert.equal(rn.lanes.find((f) => f.id === 'lane-1').attempt, 1);
  assert.equal(readFileSync(lane1File, 'utf-8'), contentBefore, 'lane-1 work intact');
  assert.equal(rn.lastScope, 'lane:lane-2');
  assert.equal(rn.done, 2);

  const tasks = readFileSync(path.join(repo, '.spec/features/payments/tasks.md'), 'utf-8');
  assert.match(tasks, /## T-002 — Service \[done\]/);
  assert.ok(commits() > commitsBefore, 're-running committed on top of what already existed');

  // the stream of the re-run task was replaced by the new attempt's
  assert.equal(readStream(rn.runId, 'lane-2--T-002').summary.status, 'success');
});

test('--no-gate does not invent a verdict: it records a pending state and tells you to run the gate', () => {
  const r = runScript(['--lane', 'lane-2', '--no-gate']);
  assert.equal(r.status, 0, 'the work finished fine');
  assert.match(r.stdout, /WITHOUT the gate/);
  assert.match(r.stdout, /NOT proof of anything/);
  assert.doesNotMatch(r.stdout, /audit exit 0/, 'never announce alignment without running the audit');
  const rn = run();
  assert.equal(rn.end, 1, 'with no verdict, the run does not become "done"');
  assert.equal(rn.gateStale, true, 'the panel warns that the gate is stale');
});

test('--gate runs only the gate and returns the fresh verdict', () => {
  const r = runScript(['--gate']);
  assert.match(r.stdout, /gate: verify \+ audit --ci/);
  const rn = run();
  assert.equal(rn.gateStale, false);
  assert.equal(rn.gate.audit, 1);
  assert.equal(rn.lastScope, 'gate');
});

test('a lane that does not exist fails loudly instead of running the wrong thing', () => {
  const r = runScript(['--lane', 'lane-99']);
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /unknown lane/);
});

test('an unknown argument is not silently ignored', () => {
  const r = runScript(['--wipe-everything']);
  assert.equal(r.status, 2);
  assert.match(r.stdout + r.stderr, /unknown argument/);
});

test('--list does not need a ready environment and shows the targets', () => {
  const r = runScript(['--list']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /lane-1\s+wave 1\s+T-001/);
  assert.match(r.stdout, /lane-2\s+wave 1\s+T-002/);
});

test('worktrees of merged lanes were removed at the end', () => {
  const list = spawnSync('git', ['worktree', 'list'], { cwd: repo, encoding: 'utf-8' }).stdout;
  assert.equal(list.trim().split('\n').length, 1, `worktree left over:\n${list}`);
  assert.ok(!existsSync(path.join(path.dirname(repo), 'onp-worktrees', 'project-payments-lane-2')));
});
