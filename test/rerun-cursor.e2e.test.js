// E2E of PARITY with claude and codex, now on Cursor: a lane fails, and it is
// possible to re-run ONLY it. Uses a stub of the Cursor CLI (`agent`) that
// emits the real stream-json from `agent -p --output-format stream-json`
// (same event types as the official docs: system/init, tool_call
// started/completed with the body in tool_call.<name>ToolCall, assistant,
// result), so it also proves the stream reaches the ledger and that
// `onp-spec summary` would have something to narrate.

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

function stubPath(fileName) {
  // allowlist -> literal mapping: no dynamic input ever reaches path building
  switch (fileName) {
    case 'run-wrapper.sh':
      return path.join(stubDir, 'run-wrapper.sh');
    case 'fail-tasks':
      return path.join(stubDir, 'fail-tasks');
    default:
      throw new Error(`invalid stub file: ${fileName}`);
  }
}

const NODE_DIR = bashPathEntry(path.dirname(process.execPath));

let tmp;
let repo;
let stubDir;
let nodeShimDir;
const before_ = process.env.ONP_SPEC_HOME;

// stub: emits the SAME event types as the Cursor CLI in headless mode
// (NDJSON), REQUIRES the executor's real flags (--output-format stream-json
// and --force — without --force Cursor's print mode does not write), does
// real work (file + commit) and fails the tasks listed in the `fail-tasks`
// marker file next to it.
//
// NOTE: on Windows, `bash` (the WSL wrapper) does not forward arbitrary
// environment variables from the launching Windows process into the shell
// session (only PATH gets special, translated treatment) — so the "which
// task should fail" signal has to travel through a file, not an env var.
const STUB = `#!/usr/bin/env bash
[ "\${1:-}" = "-p" ] || { echo "stub: expected -p (print mode)" >&2; exit 2; }
PROMPT="\${2:-}"
case "$*" in *"--output-format stream-json"*) ;; *) echo "stub: expected --output-format stream-json" >&2; exit 2 ;; esac
case "$*" in *"--force"*) ;; *) echo "stub: expected --force (without it print mode does not write)" >&2; exit 2 ;; esac
TASK=$(printf '%s' "$PROMPT" | grep -o 'T-[0-9]\\{3\\}' | head -1)
[ -z "$TASK" ] && TASK="T-000"
printf '%s\\n' "{\\"type\\":\\"system\\",\\"subtype\\":\\"init\\",\\"apiKeySource\\":\\"login\\",\\"cwd\\":\\"$PWD\\",\\"session_id\\":\\"session-$TASK\\",\\"model\\":\\"stub\\",\\"permissionMode\\":\\"default\\"}"
printf '%s\\n' "{\\"type\\":\\"tool_call\\",\\"subtype\\":\\"started\\",\\"call_id\\":\\"c1\\",\\"tool_call\\":{\\"readToolCall\\":{\\"args\\":{\\"path\\":\\"spec.md\\"}}}}"
printf '%s\\n' "{\\"type\\":\\"tool_call\\",\\"subtype\\":\\"completed\\",\\"call_id\\":\\"c1\\",\\"tool_call\\":{\\"readToolCall\\":{\\"args\\":{\\"path\\":\\"spec.md\\"},\\"result\\":{\\"success\\":{\\"content\\":\\"content\\",\\"totalLines\\":10}}}}}"
FAIL_FILE=\"$(dirname \"\${BASH_SOURCE[0]}\")/fail-tasks\"
if [ -f \"$FAIL_FILE\" ] && grep -q \"$TASK\" \"$FAIL_FILE\"; then
  printf '%s\\n' "{\\"type\\":\\"tool_call\\",\\"subtype\\":\\"completed\\",\\"call_id\\":\\"c2\\",\\"tool_call\\":{\\"shellToolCall\\":{\\"args\\":{\\"command\\":\\"node --test\\"},\\"result\\":{\\"error\\":{\\"message\\":\\"red test\\"}}}}}"
  printf '%s\\n' "{\\"type\\":\\"result\\",\\"subtype\\":\\"error\\",\\"duration_ms\\":10,\\"is_error\\":true,\\"result\\":\\"red test\\",\\"session_id\\":\\"session-$TASK\\"}"
  exit 1
fi
printf 'done by %s\\n' "$TASK" > "file-$TASK.txt"
printf '%s\\n' "{\\"type\\":\\"tool_call\\",\\"subtype\\":\\"completed\\",\\"call_id\\":\\"c3\\",\\"tool_call\\":{\\"writeToolCall\\":{\\"args\\":{\\"path\\":\\"file-$TASK.txt\\"},\\"result\\":{\\"success\\":{\\"linesCreated\\":1}}}}}"
git add -A >/dev/null 2>&1
git commit -q -m "$TASK: done by stub" >/dev/null 2>&1
printf '%s\\n' "{\\"type\\":\\"assistant\\",\\"message\\":{\\"role\\":\\"assistant\\",\\"content\\":[{\\"type\\":\\"text\\",\\"text\\":\\"done by $TASK\\"}]},\\"session_id\\":\\"session-$TASK\\"}"
printf '%s\\n' "{\\"type\\":\\"result\\",\\"subtype\\":\\"success\\",\\"duration_ms\\":42,\\"duration_api_ms\\":40,\\"is_error\\":false,\\"result\\":\\"done by $TASK\\",\\"session_id\\":\\"session-$TASK\\"}"
exit 0
`;

const SPEC = `# Spec: Payments

> feature: payments
> status: in-implementation

## User stories

### US-001 — Billing

As finance, I want to bill, so that I receive.

#### AC-001 — Billing created

- **Given** an active student
- **When** the month turns over
- **Then** the billing appears

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

function runScript(args, extraEnv = {}) {
  // invoke through a small wrapper script (not `bash -c '...' name args`):
  // this WSL bash.exe wrapper silently drops extra positional arguments when
  // invoked with `-c`, so the export has to live in a real file.
  //
  // the generated script reads `$ONP_SPEC_HOME` directly in bash (e.g. to
  // compute STREAMS_DIR) — since custom env vars set on the spawnSync `env`
  // option are NOT forwarded into a WSL bash session (only PATH gets special,
  // translated treatment), that variable has to be `export`-ed from inside
  // the bash script itself, using its WSL-translated form.
  return spawnSync('bash', [bashPathEntry(stubPath('run-wrapper.sh')), ...args], {
    cwd: repo,
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${stubDir}:${NODE_DIR}:${process.env.PATH}`, ...extraEnv },
  });
}

const run = () => buildTree(readEvents())[0].runs[0];
const commits = () =>
  parseInt(spawnSync('git', ['rev-list', '--count', 'HEAD'], { cwd: repo, encoding: 'utf-8' }).stdout.trim(), 10);

// which task IDs the `agent` stub should fail on its next run (see the
// `fail-tasks` marker file read by STUB above).
function stubFail(...taskIds) {
  writeFileSync(stubPath('fail-tasks'), taskIds.join('\n'));
}

before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'onpspec-reexec-cursor-'));
  process.env.ONP_SPEC_HOME = path.join(tmp, 'home');
  stubDir = path.join(tmp, 'stub');
  mkdirSync(stubDir, { recursive: true });
  // the executor looks for `agent` first (current name) — the stub answers for it
  writeFileSync(path.join(stubDir, 'agent'), STUB);
  chmodSync(path.join(stubDir, 'agent'), 0o755);
  if (process.platform === 'win32') {
    // `command -v node` (a bash builtin) only matches a file literally named
    // `node`, and on Windows the real binary is `node.exe`. Give bash a
    // `node` it can find, which just execs the real `node.exe` (already
    // reachable on PATH via NODE_DIR).
    writeFileSync(path.join(stubDir, 'node'), '#!/usr/bin/env bash\nexec node.exe "$@"\n');
    chmodSync(path.join(stubDir, 'node'), 0o755);
    // a separate dir with ONLY the node shim (no `agent`/`cursor-agent`), for
    // the negative tests below that need `node`/`git` on PATH but must NOT
    // expose the normal stub as a Cursor CLI.
    nodeShimDir = path.join(tmp, 'node-shim');
    mkdirSync(nodeShimDir, { recursive: true });
    writeFileSync(path.join(nodeShimDir, 'node'), '#!/usr/bin/env bash\nexec node.exe "$@"\n');
    chmodSync(path.join(nodeShimDir, 'node'), 0o755);
  }
  // wrapper that exports ONP_SPEC_HOME (WSL-translated) before delegating to
  // the generated script — see the comment in runScript() above.
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
    // avoid false "dirty tree" positives: the generated script runs through
    // bash (Linux git on Windows+WSL), which otherwise reports spurious
    // executable-bit / line-ending changes on files mounted from NTFS versus
    // what the Windows git that created them assumed
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
  spawnSync('git', ['worktree', 'prune'], { cwd: repo });
  rmSync(tmp, { recursive: true, force: true });
  rmSync(path.join(path.dirname(tmp), 'onp-worktrees'), { recursive: true, force: true });
});

test('plan --agents cursor records the run in the global ledger (with project and lanes)', () => {
  const r = cli(['plan', 'payments', '--agents', 'cursor']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(paths().ledger.startsWith(path.join(tmp, 'home')), "ledger isolated in the test's tmp");
  const rn = run();
  assert.equal(rn.feature, 'payments');
  assert.equal(rn.agent, 'cursor');
  assert.equal(rn.lanes.length, 2, 'T-001 and T-002 have disjoint files → 2 parallel lanes');
  assert.equal(rn.total, 2);
  assert.equal(rn.end, null);
});

test('full run via the Cursor CLI: lane-2 fails, lane-1 completes and the stream gets recorded', () => {
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

  // model stream (Cursor's stream-json): shows what happened
  const ok = readStream(rn.runId, 'lane-1--T-001');
  assert.equal(ok.exists, true);
  assert.equal(ok.summary.status, 'success');
  assert.deepEqual(
    ok.items.filter((i) => i.type === 'tool').map((i) => i.name),
    ['Read', 'Write'],
    "Cursor's tool_calls become tools in the timeline"
  );
  assert.ok(ok.items.some((i) => i.type === 'text' && /done by T-001/.test(i.text)));

  const failed = readStream(rn.runId, 'lane-2--T-002');
  assert.equal(failed.summary.status, 'error');
  assert.ok(
    failed.items.some((i) => i.type === 'output' && i.error),
    'the tool_call with an error result shows up as an error in the stream'
  );

  // the exit trap recorded the final summary in the ledger (never silence)
  assert.ok(readEvents().some((e) => e.type === 'summary' && e.runId === rn.runId));
  // and `onp-spec summary` narrates the state from what is in the ledger
  const summary = cli(['summary', 'payments']);
  assert.equal(summary.status, 0, summary.stderr);
  assert.match(summary.stdout, /lane-2 failed — ask the agent/);
});

test('re-run ONLY the lane that failed: new attempt, without touching the lane that already passed', () => {
  const commitsBefore = commits();
  const lane1File = path.join(repo, 'file-T-001.txt');
  const contentBefore = readFileSync(lane1File, 'utf-8');

  stubFail(); // no more failing tasks: this attempt passes
  const r = runScript(['--lane', 'lane-2']);
  assert.equal(r.status, 1, 'still exit 1: the audit fails for lack of tests — and that is honest');

  const rn = run();
  const f2 = rn.lanes.find((f) => f.id === 'lane-2');
  assert.equal(f2.state, 'merged');
  assert.equal(f2.attempt, 2, 're-run counts as attempt 2');
  assert.equal(f2.tasks[0].state, 'done');
  // the lane that was already ready was not re-run
  assert.equal(rn.lanes.find((f) => f.id === 'lane-1').attempt, 1);
  assert.equal(readFileSync(lane1File, 'utf-8'), contentBefore, "lane-1's work is intact");
  assert.equal(rn.lastScope, 'lane:lane-2');
  assert.equal(rn.done, 2);

  const tasks = readFileSync(path.join(repo, '.spec/features/payments/tasks.md'), 'utf-8');
  assert.match(tasks, /## T-002 — Service \[done\]/);
  assert.ok(commits() > commitsBefore, 're-running committed on top of what already existed');

  // the stream of the re-run task was replaced by the new attempt's
  assert.equal(readStream(rn.runId, 'lane-2--T-002').summary.status, 'success');
});

test('--no-gate does not invent a verdict: it records a pending state and tells the user to run the gate', () => {
  const r = runScript(['--lane', 'lane-2', '--no-gate']);
  assert.equal(r.status, 0, 'the work finished fine');
  assert.match(r.stdout, /WITHOUT the gate/);
  assert.match(r.stdout, /is NOT proof of anything/);
  assert.doesNotMatch(r.stdout, /audit exit 0/, 'never announce alignment without running the audit');
  const rn = run();
  assert.equal(rn.end, 1, 'without a verdict, the run does not stay "done"');
  assert.equal(rn.gateStale, true, 'the summary warns that the gate is stale');
});

test('--gate runs only the gate and returns a fresh verdict', () => {
  const r = runScript(['--gate']);
  assert.match(r.stdout, /gate: verify \+ audit --ci/);
  const rn = run();
  assert.equal(rn.gateStale, false);
  assert.equal(rn.gate.audit, 1);
  assert.equal(rn.lastScope, 'gate');
});

test('a nonexistent lane fails loud instead of running the wrong thing', () => {
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

test('without the Cursor CLI on PATH, prep fails LOUD with the install instruction', () => {
  // PATH without the stub (but with node, git and bash itself): neither
  // `agent` nor `cursor-agent` exist → clear message with the install command
  const pathWithoutStub = `${nodeShimDir || NODE_DIR}:${process.env.PATH}`;
  const noCli = spawnSync('bash', [bashPathEntry(path.join(repo, '.spec/features/payments/run-tasks.sh')), '--gate'], {
    cwd: repo,
    encoding: 'utf-8',
    env: { ...process.env, PATH: pathWithoutStub },
  });
  assert.equal(noCli.status, 1);
  assert.match(noCli.stdout + noCli.stderr, /Cursor CLI \(agent\) not found/);
  assert.match(noCli.stdout + noCli.stderr, /curl https:\/\/cursor\.com\/install/);
});

test('with ONLY the LEGACY cursor-agent binary on PATH, the fallback resolves and the script proceeds', () => {
  // old machine: cursor-agent exists, agent does not — CURSOR_BIN falls back
  // and prep passes (the requested lane deliberately does not exist: the
  // expected error is "unknown lane", NEVER "CLI not found")
  const legacyDir = path.join(tmp, 'stub-legacy');
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(path.join(legacyDir, 'cursor-agent'), STUB);
  chmodSync(path.join(legacyDir, 'cursor-agent'), 0o755);
  if (process.platform === 'win32') {
    // keep `node` in the SAME dir as `cursor-agent`: two raw (untranslated)
    // Windows paths joined by ':' confuse this machine's WSL PATH
    // auto-translator (it only reliably translates ONE such segment), so a
    // single combined dir avoids the ambiguity that broke `command -v node`.
    writeFileSync(path.join(legacyDir, 'node'), '#!/usr/bin/env bash\nexec node.exe "$@"\n');
    chmodSync(path.join(legacyDir, 'node'), 0o755);
  }
  const r = spawnSync('bash', [bashPathEntry(path.join(repo, '.spec/features/payments/run-tasks.sh')), '--lane', 'lane-99'], {
    cwd: repo,
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${legacyDir}:${process.env.PATH}` },
  });
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stdout + r.stderr, /Cursor CLI \(agent\) not found/);
  assert.match(r.stdout + r.stderr, /unknown lane/);
});

test('worktrees of merged lanes were removed at the end', () => {
  const list = spawnSync('git', ['worktree', 'list'], { cwd: repo, encoding: 'utf-8' }).stdout;
  assert.equal(list.trim().split('\n').length, 1, `leftover worktree:\n${list}`);
  assert.ok(!existsSync(path.join(path.dirname(repo), 'onp-worktrees', 'project-payments-lane-2')));
});
