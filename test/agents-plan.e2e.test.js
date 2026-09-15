// E2E of the multi-agent points: init --agents (claude | antigravity | invalid),
// plan generating the right artifacts per agent (sh with valid bash syntax,
// read-only html, sequential mode) and the task command.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(__dirname, '..', 'bin', 'onp-spec.js');

// on Windows, `bash` is usually the WSL wrapper: it does not understand a
// raw `C:\...` path (backslashes get eaten) → exit 127. Translate to the
// `/mnt/<drive>/...` form before passing an absolute path as bash argv.
function bashPathEntry(winPath) {
  if (process.platform !== 'win32') return winPath;
  return winPath.replace(/^([A-Za-z]):\\/, (_, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');
}
// on Windows/NTFS, chmodSync does not set a real POSIX exec bit — statSync
// never reports it back, regardless of the file's actual content. Skip that
// specific check there; bash's own `-n` syntax check still runs everywhere.
const canCheckExecBit = process.platform !== 'win32';

const root = mkdtempSync(path.join(os.tmpdir(), 'onpspec-agents-'));
// ledger in its own folder: the test NEVER writes to the user's ~/.onp-spec
const homeOnp = path.join(root, '.onp-home');
after(() => rmSync(root, { recursive: true, force: true }));

function cli(...args) {
  const proc = spawnSync('node', [BIN, ...args], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  return { code: proc.status, out: `${proc.stdout}\n${proc.stderr}` };
}

test('init --agents invalid fails loud (exit 2), nothing installed', () => {
  const { code, out } = cli('init', '--agents', 'copilot-invalid');
  assert.equal(code, 2, out);
  assert.match(out, /unknown --agents/);
  assert.ok(
    !existsSync(path.join(root, '.claude')) &&
      !existsSync(path.join(root, '.agents')) &&
      !existsSync(path.join(root, '.cursor'))
  );
});

test('init --agents claude installs the Claude skill at .claude/skills/', () => {
  const { code, out } = cli('init', '--agents', 'claude');
  assert.equal(code, 0, out);
  const skillMd = path.join(root, '.claude', 'skills', 'onp-spec-driven', 'SKILL.md');
  assert.ok(existsSync(skillMd));
  assert.match(readFileSync(skillMd, 'utf-8'), /agent: claude/);
  // memory file: CLAUDE.md is the native always-loaded convention
  const memory = path.join(root, 'CLAUDE.md');
  assert.ok(existsSync(memory), 'CLAUDE.md should be created');
  assert.match(readFileSync(memory, 'utf-8'), /spec-anchored development/i);
});

test('init --agents antigravity installs the Antigravity skill at .agents/skills/', () => {
  const { code, out } = cli('init', '--agents', 'antigravity');
  assert.equal(code, 0, out);
  const skillMd = path.join(root, '.agents', 'skills', 'onp-spec-driven', 'SKILL.md');
  assert.ok(existsSync(skillMd));
  const content = readFileSync(skillMd, 'utf-8');
  assert.match(content, /agent: antigravity/);
  assert.match(content, /Antigravity/);
});

test('a skill\'s embedded engine does NOT install the other agent\'s skill as if it were the right one', () => {
  // the claude skill's embedded engine (fallback ../../..) cannot serve the
  // claude skill when antigravity is requested — it has to warn and instruct
  const embedded = path.join(root, '.claude', 'skills', 'onp-spec-driven', 'scripts', 'onp-spec.mjs');
  rmSync(path.join(root, '.agents'), { recursive: true, force: true });
  const proc = spawnSync('node', [embedded, 'init', '--agents', 'antigravity'], {
    cwd: root,
    encoding: 'utf-8',
  });
  const out = `${proc.stdout}\n${proc.stderr}`;
  assert.equal(proc.status, 0, out);
  assert.match(out, /skill for Antigravity not found/);
  assert.ok(!existsSync(path.join(root, '.agents', 'skills', 'onp-spec-driven', 'SKILL.md')));
});

test('init --agents codex does NOT overwrite the Antigravity skill (they share .agents/skills)', () => {
  assert.equal(cli('init', '--agents', 'antigravity').code, 0);
  const { code, out } = cli('init', '--agents', 'codex');
  assert.equal(code, 2, out);
  assert.match(out, /already contains the skill of agent "antigravity"/);
  assert.match(out, /rm -rf/);
  // the Antigravity skill stayed intact
  const skillMd = path.join(root, '.agents', 'skills', 'onp-spec-driven', 'SKILL.md');
  assert.match(readFileSync(skillMd, 'utf-8'), /agent: antigravity/);
});

test('init --agents codex installs the Codex skill at .agents/skills/ (Codex\'s skills directory)', () => {
  rmSync(path.join(root, '.agents'), { recursive: true, force: true });
  const { code, out } = cli('init', '--agents', 'codex');
  assert.equal(code, 0, out);
  const skillMd = path.join(root, '.agents', 'skills', 'onp-spec-driven', 'SKILL.md');
  assert.ok(existsSync(skillMd));
  const content = readFileSync(skillMd, 'utf-8');
  assert.match(content, /agent: codex/);
  assert.match(content, /Codex/);
  // self-sufficient: the embedded engine came along
  assert.ok(existsSync(path.join(root, '.agents', 'skills', 'onp-spec-driven', 'scripts', 'onp-spec.mjs')));
  // and running it again keeps it, without complaining
  const again = cli('init', '--agents', 'codex');
  assert.equal(again.code, 0, again.out);
});

test('init --agents cursor installs the Cursor skill at .cursor/skills/ (Cursor\'s skills directory)', () => {
  const { code, out } = cli('init', '--agents', 'cursor');
  assert.equal(code, 0, out);
  const skillMd = path.join(root, '.cursor', 'skills', 'onp-spec-driven', 'SKILL.md');
  assert.ok(existsSync(skillMd));
  const content = readFileSync(skillMd, 'utf-8');
  assert.match(content, /agent: cursor/);
  assert.match(content, /Cursor/);
  // Cursor requires name to match the installed folder's name
  assert.match(content, /^name: onp-spec-driven$/m);
  // self-sufficient: the embedded engine came along
  assert.ok(existsSync(path.join(root, '.cursor', 'skills', 'onp-spec-driven', 'scripts', 'onp-spec.mjs')));
  // Cursor also reads .agents/skills (and .claude/.codex for compatibility):
  // with the codex skill installed there, init WARNS about the read conflict
  assert.match(out, /also has the skill of agent "codex"/);
  assert.match(out, /rm -rf \.agents\/skills\/onp-spec-driven/);
  // and running it again keeps it, no error (a warning is not a block — it's the user's choice)
  const again = cli('init', '--agents', 'cursor');
  assert.equal(again.code, 0, again.out);
  assert.match(readFileSync(path.join(root, '.agents', 'skills', 'onp-spec-driven', 'SKILL.md'), 'utf-8'), /agent: codex/);
});

test('init --agents copilot installs the GitHub Copilot skill at .github/skills/', () => {
  const { code, out } = cli('init', '--agents', 'copilot');
  assert.equal(code, 0, out);
  const skillMd = path.join(root, '.github', 'skills', 'onp-spec-driven', 'SKILL.md');
  assert.ok(existsSync(skillMd));
  const content = readFileSync(skillMd, 'utf-8');
  assert.match(content, /agent: copilot/);
  assert.match(content, /GitHub Copilot/);
  // self-sufficient: the embedded engine came along
  assert.ok(existsSync(path.join(root, '.github', 'skills', 'onp-spec-driven', 'scripts', 'onp-spec.mjs')));
  // memory file: the always-loaded reminder that this project is spec-anchored
  const memory = path.join(root, '.github', 'copilot-instructions.md');
  assert.ok(existsSync(memory), 'copilot-instructions.md should be created');
  assert.match(readFileSync(memory, 'utf-8'), /spec-anchored development/i);
  assert.match(readFileSync(memory, 'utf-8'), /audit --ci/);
  // and running it again keeps it, without complaining
  const again = cli('init', '--agents', 'copilot');
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /copilot-instructions\.md already exists/);
});

test('init --agents gemini installs the Gemini skill at .gemini/skills/ and writes GEMINI.md', () => {
  const { code, out } = cli('init', '--agents', 'gemini');
  assert.equal(code, 0, out);
  const skillMd = path.join(root, '.gemini', 'skills', 'onp-spec-driven', 'SKILL.md');
  assert.ok(existsSync(skillMd));
  const content = readFileSync(skillMd, 'utf-8');
  assert.match(content, /agent: gemini/);
  assert.match(content, /Gemini/);
  // self-sufficient: the embedded engine came along
  assert.ok(existsSync(path.join(root, '.gemini', 'skills', 'onp-spec-driven', 'scripts', 'onp-spec.mjs')));
  // memory file: GEMINI.md is the native always-loaded convention
  const memory = path.join(root, 'GEMINI.md');
  assert.ok(existsSync(memory), 'GEMINI.md should be created');
  assert.match(readFileSync(memory, 'utf-8'), /spec-anchored development/i);
  assert.match(readFileSync(memory, 'utf-8'), /audit --ci/);
  // and running it again keeps it, without complaining
  const again = cli('init', '--agents', 'gemini');
  assert.equal(again.code, 0, again.out);
});

const SPEC = `# Spec: Payments

> feature: payments
> status: in-implementation

## Stories

### US-001 — Monthly billing

As finance, I want automatic billing, so I get paid on time.

#### AC-001 — Billing created

- **Given** an active student
- **When** the month turns over
- **Then** the billing appears for the student

## Assumptions

| ID | Assumption | Status | Resolution |
|---|---|---|---|

## Open questions

| ID | Question | Status | Answer |
|---|---|---|---|
`;

const TASKS = `# Tasks: Payments

> feature: payments

## T-001 — Billing model [pending]

- Refs: US-001, AC-001
- Files: src/models/billing.js

## T-002 — Receipt sending [pending]

- Refs: AC-001
- Files: src/services/receipt.js
- Model: claude-opus-5
- Effort: high

## T-003 — Billing route [pending]

- Refs: AC-001
- Files: src/models/billing.js, src/routes/billing.js
`;

test('plan (claude): generates md + executable sh with valid bash + read-only html', () => {
  cli('new', 'payments');
  const dir = path.join(root, '.spec', 'features', 'payments');
  writeFileSync(path.join(dir, 'spec.md'), SPEC);
  writeFileSync(path.join(dir, 'tasks.md'), TASKS);

  const { code, out } = cli('plan', 'payments', '--agents', 'claude');
  assert.equal(code, 0, out);
  assert.match(out, /CAN RUN IN PARALLEL across 2 lane\(s\)/);
  assert.match(out, /where everything is/);
  // the choice is the user's: the output teaches the sequential route
  assert.match(out, /--sequential/);
  // follow-up is the summary — a server/panel no longer exists
  assert.match(out, /overall progress summary/i);
  assert.doesNotMatch(out, /panel/);

  const md = readFileSync(path.join(dir, 'plan-execution.md'), 'utf-8');
  assert.match(md, /lane-1/);
  assert.match(md, /T-001[\s\S]*T-003/); // same lane (shared file)

  const shPath = path.join(dir, 'run-tasks.sh');
  if (canCheckExecBit) assert.ok(statSync(shPath).mode & 0o100, 'script must be executable');
  const bashN = spawnSync('bash', ['-n', bashPathEntry(shPath)], { encoding: 'utf-8' });
  assert.equal(bashN.status, 0, `bash -n failed: ${bashN.stderr}`);
  const sh = readFileSync(shPath, 'utf-8');
  assert.match(sh, /run_task 'lane-2' 'T-002' '[\s\S]*?' 'claude-opus-5' high/); // T-002 overrides
  assert.match(sh, /--output-format stream-json/); // model stream for the panel
  assert.match(sh, /audit --ci/);

  // the dispatcher must accept a real re-run per lane
  const list = spawnSync('bash', [bashPathEntry(shPath), '--list'], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /lane-1\s+wave 1\s+T-001, T-003/);
  assert.match(list.stdout, /lane-2\s+wave 1\s+T-002/);
  assert.match(list.stdout, /re-run one lane/);

  const html = readFileSync(path.join(dir, 'plan-execution.html'), 'utf-8');
  assert.doesNotMatch(html, /<button/, 'execution is via the agent — html with no button');
  assert.match(html, /via agent/);

  const planJson = JSON.parse(readFileSync(path.join(dir, 'plan.json'), 'utf-8'));
  assert.equal(planJson.agent, 'claude');
  assert.equal(planJson.mode, 'parallel');
  assert.equal(planJson.lanes.length, 2);
});

test('plan --sequential (claude): one task after another, valid sh, no lanes', () => {
  const dir = path.join(root, '.spec', 'features', 'payments');
  const { code, out } = cli('plan', 'payments', '--agents', 'claude', '--sequential');
  assert.equal(code, 0, out);
  assert.match(out, /SEQUENTIAL — user choice/);
  assert.match(out, /one after another/);

  const planJson = JSON.parse(readFileSync(path.join(dir, 'plan.json'), 'utf-8'));
  assert.equal(planJson.mode, 'sequential');
  assert.deepEqual(planJson.lanes, []);
  assert.deepEqual(planJson.sequential.map((t) => t.id), ['T-001', 'T-002', 'T-003']);

  const shPath = path.join(dir, 'run-tasks.sh');
  const bashN = spawnSync('bash', ['-n', bashPathEntry(shPath)], { encoding: 'utf-8' });
  assert.equal(bashN.status, 0, `bash -n failed: ${bashN.stderr}`);
  const list = spawnSync('bash', [bashPathEntry(shPath), '--list'], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /seq\s+T-001/);
  assert.doesNotMatch(list.stdout, /lane-1/);

  // put the parallel plan back for the following tests
  assert.equal(cli('plan', 'payments', '--agents', 'claude').code, 0);
});

test('plan (antigravity): md with prompts per lane, no new sh/html and no claude -p', () => {
  const dir = path.join(root, '.spec', 'features', 'payments');
  rmSync(path.join(dir, 'run-tasks.sh'));
  rmSync(path.join(dir, 'plan-execution.html'));

  const { code, out } = cli('plan', 'payments', '--agents', 'antigravity');
  assert.equal(code, 0, out);
  assert.match(out, /open a new agent \(clean window\) per lane/);
  const md = readFileSync(path.join(dir, 'plan-execution.md'), 'utf-8');
  assert.match(md, /Prompt — lane-1/);
  assert.match(md, /Antigravity/);
  assert.doesNotMatch(md, /claude -p/);
  assert.ok(!existsSync(path.join(dir, 'run-tasks.sh')), 'antigravity does not generate the sh');
  assert.ok(!existsSync(path.join(dir, 'plan-execution.html')), 'antigravity does not generate the html');
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'plan.json'), 'utf-8')).agent, 'antigravity');
});

test('plan (copilot): md with prompts per lane, no new sh/html and no claude -p', () => {
  const dir = path.join(root, '.spec', 'features', 'payments');
  rmSync(path.join(dir, 'run-tasks.sh'), { force: true });
  rmSync(path.join(dir, 'plan-execution.html'), { force: true });

  const { code, out } = cli('plan', 'payments', '--agents', 'copilot');
  assert.equal(code, 0, out);
  assert.match(out, /open a new agent \(clean window\) per lane/);
  const md = readFileSync(path.join(dir, 'plan-execution.md'), 'utf-8');
  assert.match(md, /Prompt — lane-1/);
  assert.match(md, /GitHub Copilot/);
  assert.doesNotMatch(md, /claude -p/);
  assert.ok(!existsSync(path.join(dir, 'run-tasks.sh')), 'copilot does not generate the sh');
  assert.ok(!existsSync(path.join(dir, 'plan-execution.html')), 'copilot does not generate the html');
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'plan.json'), 'utf-8')).agent, 'copilot');
});

test('plan (gemini): md with prompts per lane, no new sh/html and no claude -p', () => {
  const dir = path.join(root, '.spec', 'features', 'payments');
  rmSync(path.join(dir, 'run-tasks.sh'), { force: true });
  rmSync(path.join(dir, 'plan-execution.html'), { force: true });

  const { code, out } = cli('plan', 'payments', '--agents', 'gemini');
  assert.equal(code, 0, out);
  assert.match(out, /open a new agent \(clean window\) per lane/);
  const md = readFileSync(path.join(dir, 'plan-execution.md'), 'utf-8');
  assert.match(md, /Prompt — lane-1/);
  assert.match(md, /Gemini/);
  assert.doesNotMatch(md, /claude -p/);
  assert.ok(!existsSync(path.join(dir, 'run-tasks.sh')), 'gemini does not generate the sh');
  assert.ok(!existsSync(path.join(dir, 'plan-execution.html')), 'gemini does not generate the html');
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'plan.json'), 'utf-8')).agent, 'gemini');

  // put the parallel plan back for the following tests
  assert.equal(cli('plan', 'payments', '--agents', 'claude').code, 0);
});


test('plan (codex): md + sh with codex exec (valid bash) + html — no claude -p', () => {
  const dir = path.join(root, '.spec', 'features', 'payments');
  const { code, out } = cli('plan', 'payments', '--agents', 'codex');
  assert.equal(code, 0, out);
  assert.match(out, /execution plan \(codex\)/);
  assert.match(out, /headless executor/);
  // T-002 asked for claude-opus-5 — in codex that becomes the default with a warning
  assert.match(out, /claude-opus-5/);

  const md = readFileSync(path.join(dir, 'plan-execution.md'), 'utf-8');
  assert.match(md, /Execution — Codex headless \(codex exec\)/);
  assert.doesNotMatch(md, /claude -p/);

  const shPath = path.join(dir, 'run-tasks.sh');
  if (canCheckExecBit) assert.ok(statSync(shPath).mode & 0o100, 'script must be executable');
  const bashN = spawnSync('bash', ['-n', bashPathEntry(shPath)], { encoding: 'utf-8' });
  assert.equal(bashN.status, 0, `bash -n failed: ${bashN.stderr}`);
  const sh = readFileSync(shPath, 'utf-8');
  assert.match(sh, /codex exec "\$3" --model "\$4" -c model_reasoning_effort="\$5"/);
  assert.match(sh, /STREAM_FLAGS=\(--json\)/);
  assert.match(sh, /--sandbox 'workspace-write'/);
  assert.match(sh, /run_task 'lane-2' 'T-002' '[\s\S]*?' 'gpt-5.6-terra' high/);
  assert.doesNotMatch(sh, /claude -p/);
  assert.match(sh, /audit --ci/);

  // dispatcher same as claude's: re-run per lane available
  const list = spawnSync('bash', [bashPathEntry(shPath), '--list'], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /lane-1\s+wave 1\s+T-001, T-003/);
  assert.match(list.stdout, /re-run one lane/);

  const html = readFileSync(path.join(dir, 'plan-execution.html'), 'utf-8');
  assert.doesNotMatch(html, /<button/);
  assert.match(html, /codex exec/);
  assert.match(html, /Ask the agent \(Codex\)/);
  assert.doesNotMatch(html, /claude -p/);

  const planJson = JSON.parse(readFileSync(path.join(dir, 'plan.json'), 'utf-8'));
  assert.equal(planJson.agent, 'codex');
  assert.equal(planJson.mode, 'parallel');
  assert.equal(planJson.lanes.length, 2);
});

test('plan (cursor): md + sh with the Cursor CLI (valid bash) + html — no claude -p nor codex exec', () => {
  const dir = path.join(root, '.spec', 'features', 'payments');
  const { code, out } = cli('plan', 'payments', '--agents', 'cursor');
  assert.equal(code, 0, out);
  assert.match(out, /execution plan \(cursor\)/);
  assert.match(out, /headless executor/);
  // the cost list the agent presents for confirmation
  assert.match(out, /models of this plan — CONFIRM with the user before executing/);
  assert.match(out, /--model composer/);
  // T-002 asked for claude-opus-5 — in cursor claude-* is a valid slug: it stays
  assert.match(out, /T-002 — claude-opus-5/);

  const md = readFileSync(path.join(dir, 'plan-execution.md'), 'utf-8');
  assert.match(md, /Execution — Cursor headless \(agent CLI\)/);
  assert.doesNotMatch(md, /claude -p/);
  assert.doesNotMatch(md, /codex exec/);

  const shPath = path.join(dir, 'run-tasks.sh');
  if (canCheckExecBit) assert.ok(statSync(shPath).mode & 0o100, 'script must be executable');
  const bashN = spawnSync('bash', ['-n', bashPathEntry(shPath)], { encoding: 'utf-8' });
  assert.equal(bashN.status, 0, `bash -n failed: ${bashN.stderr}`);
  const sh = readFileSync(shPath, 'utf-8');
  assert.match(sh, /CURSOR_BIN=\$\(command -v agent \|\| command -v cursor-agent\)/);
  assert.match(sh, /"\$CURSOR_BIN" -p "\$3" --model "\$4"/);
  assert.match(sh, /STREAM_FLAGS=\(--output-format stream-json\)/);
  assert.match(sh, /CURSOR_FLAGS=\(--force\)/);
  assert.match(sh, /run_task 'lane-2' 'T-002' '[\s\S]*?' 'claude-opus-5' high/);
  assert.doesNotMatch(sh, /claude -p/);
  assert.doesNotMatch(sh, /codex exec/);
  assert.doesNotMatch(sh, /--effort/, 'the Cursor CLI has no effort flag');
  assert.match(sh, /audit --ci/);

  // dispatcher same as claude's: re-run per lane available
  const list = spawnSync('bash', [bashPathEntry(shPath), '--list'], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /lane-1\s+wave 1\s+T-001, T-003/);
  assert.match(list.stdout, /re-run one lane/);

  const html = readFileSync(path.join(dir, 'plan-execution.html'), 'utf-8');
  assert.doesNotMatch(html, /<button/);
  assert.match(html, /agent -p/);
  assert.match(html, /Ask the agent \(Cursor\)/);
  assert.doesNotMatch(html, /claude -p/);

  const planJson = JSON.parse(readFileSync(path.join(dir, 'plan.json'), 'utf-8'));
  assert.equal(planJson.agent, 'cursor');
  assert.equal(planJson.mode, 'parallel');
  assert.equal(planJson.lanes.length, 2);

  // --effort in cursor: the plan warns that the CLI has no such flag (the
  // level goes in the model slug) — the value is recorded, but no one is fooled
  const withEffort = cli('plan', 'payments', '--agents', 'cursor', '--effort', 'baixo');
  assert.equal(withEffort.code, 0, withEffort.out);
  assert.match(withEffort.out, /the Cursor CLI has no effort flag/);
});

test('task updates the status in tasks.md (and validates the input)', () => {
  const { code, out } = cli('task', 'payments', 'T-002', 'done');
  assert.equal(code, 0, out);
  const tasks = readFileSync(path.join(root, '.spec', 'features', 'payments', 'tasks.md'), 'utf-8');
  assert.match(tasks, /## T-002 — Receipt sending \[done\]/);

  assert.equal(cli('task', 'payments', 'T-099', 'done').code, 2);
  assert.equal(cli('task', 'payments', 'T-001', 'half-done').code, 2);
});

test('task --model/--effort: the user adjusts the per-task cost without editing the file', () => {
  const tasksPath = path.join(root, '.spec', 'features', 'payments', 'tasks.md');
  // inserts the fields into a task that did not have them
  const r = cli('task', 'payments', 'T-001', '--model', 'gpt-5.6-luna', '--effort', 'baixo');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Model: gpt-5\.6-luna/);
  assert.match(r.out, /regenerate the plan/);
  const tasks = readFileSync(tasksPath, 'utf-8');
  const sectionT001 = tasks.slice(tasks.indexOf('## T-001'), tasks.indexOf('## T-002'));
  assert.match(sectionT001, /- Model: gpt-5\.6-luna/);
  assert.match(sectionT001, /- Effort: baixo/);

  // replaces a field that already existed (T-002 had Model: claude-opus-5)
  const r2 = cli('task', 'payments', 'T-002', '--model', 'gpt-5.6-terra');
  assert.equal(r2.code, 0, r2.out);
  const sectionT002 = readFileSync(tasksPath, 'utf-8').slice(
    readFileSync(tasksPath, 'utf-8').indexOf('## T-002'),
    readFileSync(tasksPath, 'utf-8').indexOf('## T-003')
  );
  assert.match(sectionT002, /- Model: gpt-5\.6-terra/);
  assert.doesNotMatch(sectionT002, /claude-opus-5/, 'the old field was replaced, not duplicated');

  // an invalid effort is rejected loudly
  const r3 = cli('task', 'payments', 'T-001', '--effort', 'turbo');
  assert.equal(r3.code, 2);
  assert.match(r3.out, /invalid effort/);

  // the regenerated plan uses the user's choice (and the parser read what we wrote)
  const p = cli('plan', 'payments', '--agents', 'codex');
  assert.equal(p.code, 0, p.out);
  assert.match(p.out, /T-001 — gpt-5\.6-luna · effort low/);
  const sh = readFileSync(path.join(root, '.spec', 'features', 'payments', 'run-tasks.sh'), 'utf-8');
  assert.match(sh, /run_task 'lane-1' 'T-001' '[\s\S]*?' 'gpt-5.6-luna' low/);
});

test('plan (codex) prints the cost list and --model/--effort lock everything', () => {
  // the list the agent presents to the user for confirmation
  const noLock = cli('plan', 'payments', '--agents', 'codex');
  assert.match(noLock.out, /CONFIRM with the user before executing/);
  assert.match(noLock.out, /spend less\?/);

  // the user locked it: everything luna/low, overriding whatever is in tasks.md
  const { code, out } = cli('plan', 'payments', '--agents', 'codex', '--model', 'gpt-5.6-luna', '--effort', 'baixo');
  assert.equal(code, 0, out);
  assert.match(out, /T-001 — gpt-5\.6-luna · effort low/);
  assert.match(out, /T-003 — gpt-5\.6-luna · effort low/);
  const planJson = JSON.parse(
    readFileSync(path.join(root, '.spec', 'features', 'payments', 'plan.json'), 'utf-8')
  );
  assert.equal(planJson.forcedModel, 'gpt-5.6-luna');
  assert.equal(planJson.forcedEffort, 'low');
  const md = readFileSync(path.join(root, '.spec', 'features', 'payments', 'plan-execution.md'), 'utf-8');
  assert.match(md, /cost locked by the user/);

  // a claude model in a codex plan is an error, not a silent swap
  const wrong = cli('plan', 'payments', '--agents', 'codex', '--model', 'claude-opus-5');
  assert.equal(wrong.code, 2);
  assert.match(wrong.out, /is a Claude model/);
});

test('upgrade: a plan from a previous version (no runId) is recorded in the ledger instead of vanishing', () => {
  const planPath = path.join(root, '.spec', 'features', 'payments', 'plan.json');
  // simulates the artifact from a version that had no ledger
  const old = JSON.parse(readFileSync(planPath, 'utf-8'));
  delete old.runId;
  writeFileSync(planPath, JSON.stringify(old, null, 2));


  // regenerating the plan records the run in the global ledger (source of the summary)
  const r = cli('plan', 'payments');
  assert.equal(r.code, 0, r.out);
  const fresh = JSON.parse(readFileSync(planPath, 'utf-8'));
  assert.ok(fresh.runId, 'regenerated plan gets a run identifier');

  // and the ledger now knows about this run
  const ledger = readFileSync(path.join(homeOnp, 'panel', 'ledger.jsonl'), 'utf-8');
  assert.ok(ledger.includes(fresh.runId), 'run recorded in the global ledger');
  assert.ok(ledger.includes('"type":"plan"'));
});

test('plan detects the agent from what is installed when there is no flag', () => {
  // this root has both .claude/skills AND .agents/skills (codex) → claude wins
  const { code, out } = cli('plan', 'payments');
  assert.equal(code, 0, out);
  assert.match(out, /execution plan \(claude\)/);
});

test("codex's embedded engine detects codex by its OWN marker (even with .claude in the project)", () => {
  const embedded = path.join(root, '.agents', 'skills', 'onp-spec-driven', 'scripts', 'onp-spec.mjs');
  const proc = spawnSync('node', [embedded, 'plan', 'payments'], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  assert.equal(proc.status, 0, `${proc.stdout}\n${proc.stderr}`);
  assert.match(proc.stdout, /execution plan \(codex\)/);
});

test('without .claude, detection uses the marker of the skill installed at .agents (codex)', () => {
  rmSync(path.join(root, '.claude'), { recursive: true, force: true });
  const { code, out } = cli('plan', 'payments');
  assert.equal(code, 0, out);
  assert.match(out, /execution plan \(codex\)/);
});

test("cursor's embedded engine detects cursor by its OWN marker (even with .agents in the project)", () => {
  const embedded = path.join(root, '.cursor', 'skills', 'onp-spec-driven', 'scripts', 'onp-spec.mjs');
  const proc = spawnSync('node', [embedded, 'plan', 'payments'], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  assert.equal(proc.status, 0, `${proc.stdout}\n${proc.stderr}`);
  assert.match(proc.stdout, /execution plan \(cursor\)/);
});

test('without .claude and without .agents, detection uses the marker of the skill installed at .cursor', () => {
  rmSync(path.join(root, '.agents'), { recursive: true, force: true });
  const { code, out } = cli('plan', 'payments');
  assert.equal(code, 0, out);
  assert.match(out, /execution plan \(cursor\)/);
});

test('an engine in a checkout under ~/.cursor/worktrees does NOT become cursor detection (only .cursor/skills counts)', () => {
  // Cursor's parallel agents check out repositories under
  // ~/.cursor/worktrees/<repo> — an engine running from there is NOT the
  // cursor skill, and detection has to respect what is installed in the project
  assert.equal(cli('init', '--agents', 'claude').code, 0);
  const fake = path.join(root, 'fake-home', '.cursor', 'worktrees', 'onp-spec-driven');
  mkdirSync(fake, { recursive: true });
  const REPO_ROOT = path.join(__dirname, '..');
  cpSync(path.join(REPO_ROOT, 'src'), path.join(fake, 'src'), { recursive: true });
  cpSync(path.join(REPO_ROOT, 'bin'), path.join(fake, 'bin'), { recursive: true });
  const proc = spawnSync('node', [path.join(fake, 'bin', 'onp-spec.js'), 'plan', 'payments'], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, ONP_SPEC_HOME: homeOnp },
  });
  assert.equal(proc.status, 0, `${proc.stdout}\n${proc.stderr}`);
  assert.match(proc.stdout, /execution plan \(claude\)/, "the project's skill (.claude) decides, not the engine's path");
});
