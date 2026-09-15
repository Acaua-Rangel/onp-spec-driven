import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

import { run, cmdInit, engineCmd, resolveSkillDir } from '../src/cli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'onp-spec.js');

test('bin/onp-spec.js: top-level error handling on unhandled rejection', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'onpspec-cov-bin-'));
  try {
    writeFileSync(path.join(tmp, 'onpspec.config.json'), '{ broken config');
    const proc = spawnSync(process.execPath, [BIN, 'status'], {
      cwd: tmp,
      encoding: 'utf-8',
      env: { ...process.env, ONP_SPEC_HOME: tmp },
    });
    assert.equal(proc.status, 2);
    assert.match(proc.stderr, /error: invalid onpspec\.config\.json/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('src/cli.js: exercises all CLI commands, options and error paths', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'onpspec-cov-cli-'));
  const origCwd = process.cwd();
  try {
    process.chdir(tmp);
    process.env.ONP_SPEC_HOME = tmp;

    // 1. Help and Version
    assert.equal(await run(['help']), 0);
    assert.equal(await run(['--help']), 0);
    assert.equal(await run([]), 0);
    assert.equal(await run(['version']), 0);
    assert.equal(await run(['--version']), 0);
    assert.equal(await run(['unknown-command']), 2);

    // 2. Init
    assert.equal(await run(['init', '--preset', 'invalid-preset']), 2);
    assert.equal(await run(['init', '--agents', 'invalid-agent']), 2);
    assert.equal(await run(['init', '--preset', 'base', '--agents', 'claude']), 0);
    // run again to test "already exists — kept"
    assert.equal(await run(['init', '--preset', 'base', '--agents', 'claude']), 0);
    // test codex then antigravity to test shared .agents directory conflict
    assert.equal(await run(['init', '--agents', 'codex']), 0);
    assert.equal(await run(['init', '--agents', 'antigravity']), 2);
    // test cursor warning for existing other skills (.claude / .agents)
    assert.equal(await run(['init', '--agents', 'cursor']), 0);
    assert.equal(await run(['init', '--agents', 'copilot']), 0);
    assert.equal(await run(['init', '--agents', 'gemini']), 0);
    assert.equal(await run(['init', '--agents', 'all']), 2);
    // test cmdInit with dependency injection: skill not found and skill already installed
    assert.equal(await cmdInit(tmp, { agents: 'claude' }, { resolveSkill: () => null }), 0);
    assert.equal(
      await cmdInit(tmp, { agents: 'claude' }, { resolveSkill: () => path.join(tmp, '.claude/skills/onp-spec-driven') }),
      0
    );
    assert.equal(resolveSkillDir('nonexistent_agent'), null);
    assert.equal(engineCmd(tmp), 'node .claude/skills/onp-spec-driven/scripts/onp-spec.mjs');
    const emptySkillsDir = mkdtempSync(path.join(os.tmpdir(), 'onpspec-empty-skills-'));
    assert.equal(engineCmd(emptySkillsDir), 'onp-spec');
    rmSync(emptySkillsDir, { recursive: true, force: true });
    // suggest on clean project with no recurring signals (covers !suggestions.length)
    assert.equal(await run(['lessons', 'suggest']), 0);

    // 3. New
    assert.equal(await run(['new']), 2);
    assert.equal(await run(['new', 'INVALID_UPPERCASE']), 2);
    assert.equal(await run(['new', 'user-profile']), 0);
    // duplicate
    assert.equal(await run(['new', 'user-profile']), 2);
    // write spec story and AC to user-profile to test maxUs / maxAc calculation in next feature
    writeFileSync(
      path.join(tmp, '.spec/features/user-profile/spec.md'),
      '# user-profile\n## User Stories\n### US-001 - Title\n#### AC-001 - Given When Then\n- **Given** a\n- **When** b\n- **Then** c\n'
    );
    assert.equal(await run(['new', 'second-feat']), 0);

    // 4. Task
    assert.equal(await run(['task']), 2);
    assert.equal(await run(['task', 'user-profile', 'T-001', 'invalid-status']), 2);
    assert.equal(await run(['task', 'user-profile', 'T-001', 'done', '--effort', 'invalid-effort']), 2);
    assert.equal(await run(['task', 'feat-not-found', 'T-001', 'done']), 2);
    assert.equal(await run(['task', 'user-profile', 'T-999', 'done']), 2);
    // valid update with model and effort
    assert.equal(
      await run(['task', 'user-profile', 'T-001', 'in-progress', '--model', 'gpt-4o', '--effort', 'high']),
      0
    );
    // append another task to test ## boundary and existing field replacement
    const tasksFile = path.join(tmp, '.spec/features/user-profile/tasks.md');
    writeFileSync(
      tasksFile,
      readFileSync(tasksFile, 'utf-8') + '\n## T-002 - Task 2\n- Status: pending\n- Model: gpt-4o\n- Effort: low\n'
    );
    assert.equal(
      await run(['task', 'user-profile', 'T-001', 'done', '--model', 'claude-haiku-4-5', '--effort', 'low']),
      0
    );
    assert.equal(await run(['task', 'user-profile', 'T-002', 'pending']), 0);

    // 5. Plan
    assert.equal(await run(['plan']), 2);
    assert.equal(await run(['plan', 'nonexistent-feat']), 2);
    assert.equal(await run(['plan', 'user-profile', '--sequential', '--parallelize', 'T-002']), 2);
    assert.equal(await run(['plan', 'user-profile', '--agents', 'invalid-agent']), 2);
    assert.equal(await run(['plan', 'user-profile', '--model']), 2);
    assert.equal(await run(['plan', 'user-profile', '--effort']), 2);
    assert.equal(await run(['plan', 'user-profile', '--agents', 'codex', '--effort', 'low']), 0);
    assert.equal(await run(['plan', 'user-profile', '--agents', 'cursor', '--effort', 'high']), 0);
    assert.equal(await run(['plan', 'user-profile', '--agents', 'claude', '--sequential']), 0);
    assert.equal(await run(['plan', 'user-profile', '--agents', 'gemini']), 0);
    assert.equal(await run(['plan', 'user-profile', '--agents', 'claude', '--parallelize', 'T-002']), 0);
    assert.equal(await run(['plan', 'user-profile', '--tasks', 'T-002']), 0);

    // 6. Event & Stream summary
    assert.equal(await run(['event']), 2);
    const { readEvents, streamPath } = await import('../src/core/ledger.js');
    const lastPlan = readEvents().filter((e) => e.type === 'plan').pop();
    const runId = lastPlan.runId;
    assert.equal(
      await run(['event', '--run', runId, '--type', 'start', '--lane', 'lane-1', '--task', 'T-001', '--exit', '0', '--attempt', '1']),
      0
    );
    assert.equal(await run(['stream-summary']), 2);
    assert.equal(await run(['stream-summary', runId, 'lane-1--T-001']), 0);
    // stream-summary with actual tools and result
    const sFile = streamPath(runId, 'lane-1--T-001');
    mkdirSync(path.dirname(sFile), { recursive: true });
    writeFileSync(
      sFile,
      [
        JSON.stringify({ type: 'tool', name: 'bash' }),
        JSON.stringify({ type: 'tool', name: 'bash' }),
        JSON.stringify({ type: 'tool', name: 'read' }),
        JSON.stringify({ type: 'result', is_error: false, subtype: 'success', turns: 2, duration_ms: 2500, cost_usd: 0.015 }),
      ].join('\n')
    );
    assert.equal(await run(['stream-summary', runId, 'lane-1--T-001']), 0);

    // 7. Summary
    assert.equal(await run(['summary', '--context']), 0);
    assert.equal(await run(['summary', '--table']), 0);
    assert.equal(await run(['summary', '--global']), 0);
    assert.equal(await run(['summary', '--save', '--run', 'unknown-run']), 2);
    assert.equal(await run(['summary', '--save', '--run', runId, '--text', '   ']), 2);
    assert.equal(await run(['summary', '--save', '--run', runId, '--text', 'Working on feature', '--source', 'ai']), 0);
    assert.equal(await run(['summary', '--save', '--run', runId]), 0);
    assert.equal(await run(['summary']), 0);

    // 8. Audit
    await run(['audit', '--json']);
    await run(['audit', '--md']);
    await run(['audit', '--md', '.spec/CUSTOM_AUDIT.md']);
    await run(['audit', '--ci']);

    // 9. Verify
    assert.equal(await run(['verify']), 2);
    // configure testCommand to output TAP with pass, skip, fail, and principle
    writeFileSync(
      path.join(tmp, 'run-tests.js'),
      "console.log('TAP version 13\\nok 1 - @spec:AC-001 pass\\nnot ok 2 - @spec:AC-002 # SKIP skip test\\nnot ok 3 - @spec:AC-003 fail\\nok 4 - @principle:P-001 p1\\n1..4');\nprocess.exit(1);"
    );
    const cfgP = path.join(tmp, 'onpspec.config.json');
    const currCfg = JSON.parse(readFileSync(cfgP, 'utf-8'));
    currCfg.testCommand = 'node run-tests.js';
    writeFileSync(cfgP, JSON.stringify(currCfg));
    writeFileSync(
      path.join(tmp, '.spec/features/user-profile/spec.md'),
      '# user-profile\n## User Stories\n### US-001 - Title\n#### AC-001 - First\n- **Given** a\n- **When** b\n- **Then** c\n#### AC-002 - Second\n- **Given** a\n- **When** b\n- **Then** c\n#### AC-003 - Third\n- **Given** a\n- **When** b\n- **Then** c\n'
    );
    await run(['verify', 'user-profile']);

    // 10. Scaffold
    assert.equal(await run(['scaffold']), 2);
    assert.equal(await run(['scaffold', 'user-profile', '--force']), 0);
    // second time without --force prints result.message
    assert.equal(await run(['scaffold', 'user-profile']), 0);
    // scaffold on second-feat creates test skeleton (covers result.created branch)
    assert.equal(await run(['scaffold', 'second-feat']), 0);

    // 11. Status and Assumptions
    assert.equal(await run(['status']), 0);
    assert.equal(await run(['assumptions']), 0);
    // status with empty feature (NO SPEC)
    mkdirSync(path.join(tmp, '.spec/features/empty-feature'), { recursive: true });
    assert.equal(await run(['status']), 0);
    rmSync(path.join(tmp, '.spec/features/empty-feature'), { recursive: true });
    // status with project error
    const corruptFile = path.join(tmp, '.spec/verification/corrupted.json');
    writeFileSync(corruptFile, '{ broken json');
    assert.equal(await run(['status']), 2);
    rmSync(corruptFile);

    // 12. Lessons
    assert.equal(await run(['lessons']), 0);
    assert.equal(await run(['lessons', 'unknown-sub']), 2);
    assert.equal(await run(['lessons', 'add']), 2);
    assert.equal(await run(['lessons', 'list', '--status', 'all']), 0);
    assert.equal(await run(['lessons', 'suggest']), 0);
    assert.equal(await run(['lessons', 'penalize']), 2);
    assert.equal(await run(['lessons', 'penalize', '--id', 'L-999']), 2);
    assert.equal(await run(['lessons', 'suggest']), 0);
    assert.equal(
      await run([
        'lessons',
        'add',
        '--signal',
        'FILE_MISSING',
        '--feature',
        'user-profile',
        '--source',
        'T-001',
        '--text',
        'Always check file exists before mapping task',
        '--scope',
        'testing',
      ]),
      0
    );
    // add from second-feat to promote candidate to confirmed
    assert.equal(
      await run([
        'lessons',
        'add',
        '--signal',
        'FILE_MISSING',
        '--feature',
        'second-feat',
        '--source',
        'T-001',
        '--text',
        'Always check file exists before mapping task',
        '--scope',
        'testing',
      ]),
      0
    );
    assert.equal(await run(['lessons', 'list', '--status', 'all']), 0);
    assert.equal(await run(['lessons', 'penalize', '--id', 'L-001']), 0);
    assert.equal(await run(['lessons', 'status']), 0);

    // test lessons in directory without .spec
    const noSpec = mkdtempSync(path.join(os.tmpdir(), 'onpspec-no-spec-'));
    const prevCwd = process.cwd();
    try {
      process.chdir(noSpec);
      assert.equal(await run(['lessons']), 2);
    } finally {
      process.chdir(prevCwd);
      rmSync(noSpec, { recursive: true, force: true });
    }
  } finally {
    process.chdir(origCwd);
    delete process.env.ONP_SPEC_HOME;
    rmSync(tmp, { recursive: true, force: true });
  }
});
