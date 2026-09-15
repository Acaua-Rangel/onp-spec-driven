// Execution plan: grouping into lanes (disjoint files → parallel,
// shared → same lane, no Files → sequential) and renderers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlan,
  normalizeEffort,
  effortForAgent,
  usesShExecutor,
  renderPlanMd,
  renderPlanSh,
  renderPlanHtml,
  renderPlanJson,
} from '../src/core/plan.js';
import { DEFAULT_CONFIG } from '../src/config.js';

function project({ tasks, specStories = [], rootDir = '/tmp/repo-x' } = {}) {
  return {
    config: { ...DEFAULT_CONFIG, rootDir, testCommand: 'node --test' },
    features: [
      {
        name: 'payments',
        spec: { stories: specStories },
        tasks: { tasks },
      },
    ],
  };
}

function t(id, { files = [], status = 'pending', refs = [], model = null, effort = null, line = 1 } = {}) {
  return { id, title: `Title ${id}`, status, line, refs, files, model, effort };
}

test('effort accepts PT and EN and normalizes to the CLI level', () => {
  assert.equal(normalizeEffort('alto'), 'high');
  assert.equal(normalizeEffort('Médio'), 'medium');
  assert.equal(normalizeEffort('xalto'), 'xhigh');
  assert.equal(normalizeEffort('MAX'), 'max');
  assert.equal(normalizeEffort('low'), 'low');
  assert.equal(normalizeEffort('turbo'), null);
});

test('disjoint files → parallel lanes; shared → same lane; no files → sequential', () => {
  const plan = buildPlan(
    project({
      tasks: [
        t('T-001', { files: ['src/a.js'], line: 1 }),
        t('T-002', { files: ['src/b.js'], line: 5 }),
        t('T-003', { files: ['src/a.js', 'src/c.js'], line: 9 }),
        t('T-004', { line: 13 }),
      ],
    }),
    'payments',
    { agent: 'claude', enginePath: '/tmp/repo-x/bin/onp-spec.js' }
  );
  assert.ok(!plan.error, plan.error);
  assert.equal(plan.lanes.length, 2);
  assert.deepEqual(plan.lanes[0].tasks.map((x) => x.id), ['T-001', 'T-003']);
  assert.deepEqual(plan.lanes[1].tasks.map((x) => x.id), ['T-002']);
  assert.deepEqual(plan.sequential.map((x) => x.id), ['T-004']);
  assert.equal(plan.lanes[0].branch, 'spec/payments-lane-1');
  assert.equal(plan.workBranch, 'spec/payments');
  // engine becomes a path relative to the root
  assert.equal(plan.engine, 'bin/onp-spec.js');
});

test('done tasks are left out; everything done is a friendly error', () => {
  const plan = buildPlan(
    project({
      tasks: [t('T-001', { files: ['src/a.js'], status: 'done' }), t('T-002', { files: ['src/b.js'] })],
    }),
    'payments',
    {}
  );
  assert.deepEqual(plan.done.map((x) => x.id), ['T-001']);
  assert.equal(plan.lanes.length, 1);

  const empty = buildPlan(
    project({ tasks: [t('T-001', { files: ['src/a.js'], status: 'done' })] }),
    'payments',
    {}
  );
  assert.match(empty.error, /already \[done\]/);
});

test('maxParallel splits the lanes into waves', () => {
  const proj = project({
    tasks: [
      t('T-001', { files: ['a'], line: 1 }),
      t('T-002', { files: ['b'], line: 2 }),
      t('T-003', { files: ['c'], line: 3 }),
      t('T-004', { files: ['d'], line: 4 }),
      t('T-005', { files: ['e'], line: 5 }),
    ],
  });
  proj.config.parallel = { ...proj.config.parallel, maxParallel: 2 };
  const plan = buildPlan(proj, 'payments', {});
  assert.equal(plan.lanes.length, 5);
  assert.deepEqual(plan.waves.map((o) => o.length), [2, 2, 1]);
});

test('model and effort per task win over the default; invalid effort produces a warning', () => {
  const plan = buildPlan(
    project({
      tasks: [
        t('T-001', { files: ['a'], model: 'claude-opus-5', effort: 'alto' }),
        t('T-002', { files: ['b'], effort: 'turbo' }),
      ],
    }),
    'payments',
    {}
  );
  const [f1, f2] = plan.lanes;
  assert.equal(f1.tasks[0].model, 'claude-opus-5');
  assert.equal(f1.tasks[0].effortCli, 'high');
  assert.equal(f2.tasks[0].model, 'claude-sonnet-5'); // config default
  assert.equal(f2.tasks[0].effortCli, 'medium'); // fallback
  assert.ok(plan.warnings.some((a) => a.includes('turbo')));
});

test('feature without tasks.md or non-existent is a friendly error', () => {
  const noTasks = { ...project({ tasks: [] }) };
  noTasks.features[0].tasks = null;
  assert.match(buildPlan(noTasks, 'payments', {}).error, /has no tasks/);
  assert.match(buildPlan(project({ tasks: [t('T-001')] }), 'another', {}).error, /not found/);
});

function defaultPlan(agent) {
  return buildPlan(
    project({
      tasks: [
        t('T-001', { files: ['src/a.js'], refs: ['AC-001'], line: 1 }),
        t('T-002', { files: ['src/b.js'], line: 5, effort: 'alto' }),
        t('T-003', { line: 9 }),
      ],
      specStories: [{ id: 'US-001', acs: [{ id: 'AC-001', title: 'Charge created' }] }],
    }),
    'payments',
    { agent, enginePath: '/tmp/repo-x/bin/onp-spec.js', now: new Date('2026-07-28T12:00:00Z') }
  );
}

test('md (claude): lanes, branch management, per-minute summary, no button', () => {
  const md = renderPlanMd(defaultPlan('claude'));
  assert.match(md, /## Lanes and waves/);
  assert.match(md, /spec\/payments-lane-1/);
  assert.match(md, /1 task = 1 commit/);
  assert.match(md, /run-tasks\.sh/);
  // the choice (what to parallelize, or one after another) is the user's
  assert.match(md, /onp-spec plan payments --parallelize T-xxx,T-yyy/);
  assert.match(md, /--sequential/);
  // follow-up is a chat/terminal summary — there is no panel/button anymore
  assert.match(md, /overall progress summary/i);
  assert.match(md, /onp-spec summary payments/);
  assert.doesNotMatch(md, /panel/i);
  assert.match(md, /audit --ci/);
});

test('--parallelize: only the chosen ones enter the lanes; the rest become sequential with a reason', () => {
  const plan = buildPlan(
    project({
      tasks: [
        t('T-001', { files: ['src/a.js'], line: 1 }),
        t('T-002', { files: ['src/b.js'], line: 5 }),
        t('T-003', { files: ['src/c.js'], line: 9 }),
        t('T-004', { line: 13 }),
      ],
    }),
    'payments',
    { agent: 'claude', parallelize: ['T-001', 'T-003'], enginePath: '/tmp/repo-x/bin/onp-spec.js' }
  );
  assert.ok(!plan.error, plan.error);
  assert.equal(plan.mode, 'parallel');
  assert.deepEqual(plan.lanes.map((fx) => fx.tasks.map((x) => x.id)), [['T-001'], ['T-003']]);
  assert.deepEqual(plan.sequential.map((x) => x.id), ['T-002', 'T-004'], 'outside the selection runs at the end, in order');
  assert.match(plan.sequential[0].seqReason, /outside the.*selection/);
  assert.match(plan.sequential[1].seqReason, /unknown footprint/);
  // being left out of the selection is a user decision, not a fallback — no warning
  assert.ok(!plan.warnings.some((a) => a.includes('T-002')));
  assert.deepEqual(plan.parallelize, ['T-001', 'T-003']);
});

test('--parallelize: chosen tasks that share a file fall into the SAME lane', () => {
  const plan = buildPlan(
    project({
      tasks: [
        t('T-001', { files: ['src/a.js'], line: 1 }),
        t('T-002', { files: ['src/a.js', 'src/c.js'], line: 5 }),
        t('T-003', { files: ['src/b.js'], line: 9 }),
      ],
    }),
    'payments',
    { parallelize: ['T-001', 'T-002'] }
  );
  assert.equal(plan.lanes.length, 1, 'a file conflict does not become parallelism even with a selection');
  assert.deepEqual(plan.lanes[0].tasks.map((x) => x.id), ['T-001', 'T-002']);
  assert.deepEqual(plan.sequential.map((x) => x.id), ['T-003']);
});

test('--parallelize: unknown task or empty selection is a friendly error', () => {
  const proj = () => project({ tasks: [t('T-001', { files: ['a'] }), t('T-002', { files: ['b'], status: 'done' })] });
  assert.match(
    buildPlan(proj(), 'payments', { parallelize: ['T-999'] }).error,
    /T-999/,
    'a non-existent id appears in the error'
  );
  assert.match(
    buildPlan(proj(), 'payments', { parallelize: ['T-002'] }).error,
    /not pending/,
    'a done task is not parallelizable'
  );
  assert.match(buildPlan(proj(), 'payments', { parallelize: [] }).error, /--sequential/);
});

test('--parallelize shows up in the artifacts: md (selection + regenerate), json and sh', () => {
  const plan = buildPlan(
    project({
      tasks: [t('T-001', { files: ['src/a.js'], line: 1 }), t('T-002', { files: ['src/b.js'], line: 5 })],
    }),
    'payments',
    { agent: 'claude', parallelize: ['T-001'], enginePath: '/tmp/repo-x/bin/onp-spec.js' }
  );
  const md = renderPlanMd(plan);
  assert.match(md, /user selection.*T-001/);
  assert.match(md, /Regenerate: `onp-spec plan payments --parallelize T-001`/);
  assert.match(md, /outside the.*selection/);
  const data = JSON.parse(renderPlanJson(plan));
  assert.deepEqual(data.parallelize, ['T-001']);
  const sh = renderPlanSh(plan);
  assert.match(sh, /sequential T-002 \(outside the.*selection\)/);
});

test('buildPlan --sequential: no lanes, everything one after another in tasks.md order', () => {
  const plan = buildPlan(
    project({
      tasks: [
        t('T-002', { files: ['src/b.js'], line: 5 }),
        t('T-001', { files: ['src/a.js'], line: 1 }),
        t('T-003', { line: 9 }),
      ],
    }),
    'payments',
    { agent: 'claude', sequential: true, enginePath: '/tmp/repo-x/bin/onp-spec.js' }
  );
  assert.equal(plan.mode, 'sequential');
  assert.equal(plan.lanes.length, 0);
  assert.equal(plan.waves.length, 0);
  assert.deepEqual(plan.sequential.map((x) => x.id), ['T-001', 'T-002', 'T-003'], 'tasks.md order');
  // no "unknown footprint" warning: sequential is a choice, not a fallback
  assert.ok(!plan.warnings.some((a) => a.includes('unknown footprint')));
});

test('md/sh/html in sequential mode: no worktrees, explicit order, same gate', () => {
  const proj = project({
    tasks: [t('T-001', { files: ['src/a.js'], line: 1 }), t('T-002', { files: ['src/b.js'], line: 5 })],
  });
  const plan = buildPlan(proj, 'payments', { agent: 'claude', sequential: true, enginePath: '/tmp/repo-x/bin/onp-spec.js' });

  const md = renderPlanMd(plan);
  assert.match(md, /SEQUENTIAL mode \(user choice\)/);
  assert.match(md, /## Execution order \(one task after another\)/);
  assert.doesNotMatch(md, /## Lanes and waves/);
  assert.match(md, /no worktrees and no parallelism/);
  assert.doesNotMatch(md, /git worktree|1 lane = 1 worktree/);
  assert.match(md, /audit --ci/);

  const sh = renderPlanSh(plan);
  assert.match(sh, /run_seq_T_001/);
  assert.match(sh, /run_seq_T_002/);
  assert.doesNotMatch(sh, /run_lane_/);
  assert.match(sh, /run_gate/);

  const html = renderPlanHtml(plan);
  assert.match(html, /sequential<\/b> mode \(user choice\)/);
  assert.match(html, /Execution order/);

  const data = JSON.parse(renderPlanJson(plan));
  assert.equal(data.mode, 'sequential');
  assert.deepEqual(data.lanes, []);
  assert.equal(data.sequential.length, 2);
});

test('md (antigravity, sequential): prompts in order, no worktrees, agent summary', () => {
  const proj = project({
    tasks: [t('T-001', { files: ['src/a.js'], line: 1 }), t('T-002', { files: ['src/b.js'], line: 5 })],
  });
  const plan = buildPlan(proj, 'payments', { agent: 'antigravity', sequential: true, enginePath: '/tmp/repo-x/bin/onp-spec.js' });
  const md = renderPlanMd(plan);
  assert.match(md, /Sequential in Antigravity/);
  assert.match(md, /Prompt — T-001/);
  assert.match(md, /Prompt — T-002/);
  assert.doesNotMatch(md, /git worktree add/);
  assert.match(md, /summary payments --save --source ai --text/);
  assert.doesNotMatch(md, /claude -p/);
});

test('md (antigravity): worktrees, prompt per lane, no claude CLI', () => {
  const md = renderPlanMd(defaultPlan('antigravity'));
  assert.match(md, /git worktree add \.\.\/onp-worktrees\/repo-x-payments-lane-1/);
  assert.match(md, /Prompt — lane-1/);
  assert.match(md, /NEVER weaken, skip \(skip\/todo\) or delete a test/);
  assert.match(md, /node bin\/onp-spec\.js task payments T-001 done/);
  assert.doesNotMatch(md, /claude -p/, "the Antigravity plan cannot depend on Claude's CLI");
});

test('md (copilot, sequential): prompts in order, no worktrees, agent summary', () => {
  const proj = project({
    tasks: [t('T-001', { files: ['src/a.js'], line: 1 }), t('T-002', { files: ['src/b.js'], line: 5 })],
  });
  const plan = buildPlan(proj, 'payments', { agent: 'copilot', sequential: true, enginePath: '/tmp/repo-x/bin/onp-spec.js' });
  const md = renderPlanMd(plan);
  assert.match(md, /Sequential in GitHub Copilot/);
  assert.match(md, /Prompt — T-001/);
  assert.match(md, /Prompt — T-002/);
  assert.doesNotMatch(md, /git worktree add/);
  assert.match(md, /summary payments --save --source ai --text/);
  assert.doesNotMatch(md, /claude -p/);
});

test('md (copilot): worktrees, prompt per lane, no claude CLI', () => {
  const md = renderPlanMd(defaultPlan('copilot'));
  assert.match(md, /Native parallel in GitHub Copilot/);
  assert.match(md, /git worktree add \.\.\/onp-worktrees\/repo-x-payments-lane-1/);
  assert.match(md, /Prompt — lane-1/);
  assert.match(md, /NEVER weaken, skip \(skip\/todo\) or delete a test/);
  assert.match(md, /node bin\/onp-spec\.js task payments T-001 done/);
  assert.doesNotMatch(md, /claude -p/, "the Copilot plan cannot depend on Claude's CLI");
});

test('md (gemini, sequential): prompts in order, no worktrees, agent summary', () => {
  const proj = project({
    tasks: [t('T-001', { files: ['src/a.js'], line: 1 }), t('T-002', { files: ['src/b.js'], line: 5 })],
  });
  const plan = buildPlan(proj, 'payments', { agent: 'gemini', sequential: true, enginePath: '/tmp/repo-x/bin/onp-spec.js' });
  const md = renderPlanMd(plan);
  assert.match(md, /Sequential in Gemini/);
  assert.match(md, /Prompt — T-001/);
  assert.match(md, /Prompt — T-002/);
  assert.doesNotMatch(md, /git worktree add/);
  assert.match(md, /summary payments --save --source ai --text/);
  assert.doesNotMatch(md, /claude -p/);
});

test('md (gemini): worktrees, prompt per lane, no claude CLI', () => {
  const md = renderPlanMd(defaultPlan('gemini'));
  assert.match(md, /Native parallel in Gemini/);
  assert.match(md, /git worktree add \.\.\/onp-worktrees\/repo-x-payments-lane-1/);
  assert.match(md, /Prompt — lane-1/);
  assert.match(md, /NEVER weaken, skip \(skip\/todo\) or delete a test/);
  assert.match(md, /node bin\/onp-spec\.js task payments T-001 done/);
  assert.doesNotMatch(md, /claude -p/, "the Gemini plan cannot depend on Claude's CLI");
});

// ── codex: same artifacts as claude, executor via codex exec ─────────────

test('effort for codex: max becomes xhigh (codex has no "max"); claude keeps it', () => {
  assert.equal(effortForAgent('max', 'codex'), 'xhigh');
  assert.equal(effortForAgent('max', 'claude'), 'max');
  assert.equal(effortForAgent('high', 'codex'), 'high');
  assert.equal(effortForAgent('max', 'cursor'), 'max', 'in cursor, effort is informational — passes through intact');
  assert.equal(usesShExecutor('codex'), true);
  assert.equal(usesShExecutor('claude'), true);
  assert.equal(usesShExecutor('cursor'), true);
  assert.equal(usesShExecutor('antigravity'), false);
  assert.equal(usesShExecutor('copilot'), false);
  assert.equal(usesShExecutor('gemini'), false);
});

test('codex: the config\'s claude-* model becomes gpt-5.6-terra; an explicit claude Model: warns', () => {
  const plan = buildPlan(
    project({
      tasks: [
        t('T-001', { files: ['a'], line: 1 }), // inherits the config default (claude-sonnet-5)
        t('T-002', { files: ['b'], line: 5, model: 'claude-opus-5', effort: 'max' }),
        t('T-003', { files: ['c'], line: 9, model: 'gpt-5.6-sol', effort: 'alto' }),
      ],
    }),
    'payments',
    { agent: 'codex', enginePath: '/tmp/repo-x/bin/onp-spec.js' }
  );
  assert.ok(!plan.error, plan.error);
  assert.equal(plan.agent, 'codex');
  const [f1, f2, f3] = plan.lanes;
  assert.equal(f1.tasks[0].model, 'gpt-5.6-terra', "the config's claude-* default does not work for codex");
  assert.equal(f2.tasks[0].model, 'gpt-5.6-terra', 'an explicit claude-* Model: is also swapped');
  assert.ok(plan.warnings.some((a) => a.includes('T-002') && a.includes('claude-opus-5')), 'an explicit swap warns');
  assert.equal(f2.tasks[0].effortCli, 'xhigh', 'max becomes xhigh in codex');
  assert.equal(f3.tasks[0].model, 'gpt-5.6-sol', "codex's own model passes through intact");
  assert.equal(f3.tasks[0].effortCli, 'high');
});

test('--model/--effort: the user locks the cost of the whole plan (wins over tasks.md and config)', () => {
  const plan = buildPlan(
    project({
      tasks: [
        t('T-001', { files: ['a'], line: 1, model: 'gpt-5.6-sol', effort: 'xalto' }), // per-task loses to the user's choice
        t('T-002', { files: ['b'], line: 5 }),
        t('T-003', { line: 9 }),
      ],
    }),
    'payments',
    { agent: 'codex', model: 'gpt-5.6-luna', effort: 'baixo', enginePath: '/tmp/repo-x/bin/onp-spec.js' }
  );
  assert.ok(!plan.error, plan.error);
  assert.equal(plan.forcedModel, 'gpt-5.6-luna');
  assert.equal(plan.forcedEffort, 'low');
  for (const task of [...plan.lanes.flatMap((fx) => fx.tasks), ...plan.sequential]) {
    assert.equal(task.model, 'gpt-5.6-luna', `${task.id} should use the locked model`);
    assert.equal(task.effortCli, 'low', `${task.id} should use the locked effort`);
  }
  // shows up in the artifacts: md (summary + regenerate), json and sh
  const md = renderPlanMd(plan);
  assert.match(md, /cost locked by the user.*gpt-5\.6-luna.*low/);
  assert.match(md, /Regenerate: `onp-spec plan payments --model gpt-5.6-luna --effort low`/);
  const data = JSON.parse(renderPlanJson(plan));
  assert.equal(data.forcedModel, 'gpt-5.6-luna');
  assert.equal(data.forcedEffort, 'low');
  const sh = renderPlanSh(plan);
  assert.match(sh, /run_task 'lane-1' 'T-001' '[\s\S]*?' 'gpt-5.6-luna' low/);
});

test('--model/--effort: invalid values are a friendly error, never silent execution', () => {
  const proj = () => project({ tasks: [t('T-001', { files: ['a'] })] });
  assert.match(
    buildPlan(proj(), 'payments', { agent: 'codex', effort: 'turbo' }).error,
    /--effort "turbo" unknown/
  );
  assert.match(
    buildPlan(proj(), 'payments', { agent: 'codex', model: 'claude-opus-5' }).error,
    /is a Claude model/,
    'forcing a claude model in a codex plan is an error, not a silent swap'
  );
  // in claude, --model claude-* is legitimate
  const claude = buildPlan(proj(), 'payments', { agent: 'claude', model: 'claude-opus-5' });
  assert.ok(!claude.error, claude.error);
  assert.equal(claude.lanes[0].tasks[0].model, 'claude-opus-5');
});

test('md (codex): codex exec section, sandbox, cost confirmation — no claude -p', () => {
  const md = renderPlanMd(defaultPlan('codex'));
  assert.match(md, /Execution — Codex headless \(codex exec\)/);
  assert.match(md, /run-tasks\.sh/);
  assert.match(md, /`codex exec`/);
  assert.match(md, /model_reasoning_effort/);
  assert.match(md, /sandbox `workspace-write`/);
  assert.match(md, /overall progress summary/i);
  assert.match(md, /onp-spec summary payments/);
  assert.match(md, /audit --ci/);
  assert.doesNotMatch(md, /claude -p/, "the codex plan cannot depend on Claude's CLI");
  // cost confirmation is part of the artifact — the agent does not execute without it
  assert.match(md, /Cost confirmation — before executing/);
  assert.match(md, /--model gpt-5\.6-luna --effort low/);
  assert.match(md, /onp-spec task payments T-xxx --model/);
  // in claude, none of this: behavior untouched
  assert.doesNotMatch(renderPlanMd(defaultPlan('claude')), /Cost confirmation/);
});

test('sh (codex): codex exec with --model and model_reasoning_effort per task, --json, sandbox and --add-dir', () => {
  const sh = renderPlanSh(defaultPlan('codex'));
  assert.match(sh, /^#!\/usr\/bin\/env bash/);
  assert.match(sh, /codex exec "\$3" --model "\$4" -c model_reasoning_effort="\$5" "\$\{STREAM_FLAGS\[@\]}" "\$\{CODEX_FLAGS\[@\]}" --add-dir "\$TOPLEVEL"/);
  assert.match(sh, /STREAM_FLAGS=\(--json\)/);
  assert.match(sh, /CODEX_FLAGS=\(--sandbox 'workspace-write'\)/);
  assert.match(sh, /command -v codex/);
  assert.doesNotMatch(sh, /command -v claude/, "the codex executor does not require Claude's CLI");
  assert.doesNotMatch(sh, /claude -p/, 'no claude invocation in the codex executor');
  // per-task prompts with model/effort resolved (config default → terra)
  assert.match(sh, /run_task 'lane-1' 'T-001' '[\s\S]*?' 'gpt-5.6-terra' medium/);
  assert.match(sh, /run_task 'lane-2' 'T-002' '[\s\S]*?' 'gpt-5.6-terra' high/);
  // per-minute summary: read-only codex exec, cheap model of the family
  assert.match(sh, /SUMMARY_MODEL='gpt-5.6-luna'/);
  assert.match(sh, /codex exec "You narrate[\s\S]*?--model "\$SUMMARY_MODEL" --sandbox read-only --ephemeral/);
  // infrastructure identical to claude's: worktrees, merge, ledger, gate, dispatcher
  assert.match(sh, /git worktree add "\$3" -b/);
  assert.match(sh, /merge_lane 'lane-1'/);
  assert.match(sh, /run_seq_T_003/);
  assert.match(sh, /event\(\) \{ node "\$ENGINE" event --run "\$RUN_ID"/);
  assert.match(sh, /--lane\) MODE="lane"; TARGET="\$\{2:-}"; shift ;;/);
  assert.match(sh, /--no-gate\) WITH_GATE=0/);
  assert.match(sh, /run_gate/);
  assert.match(sh, /audit --ci/);
  assert.match(sh, /📣 summary/);
});

test('sh (codex): --no-gate NEVER announces alignment (parity with claude)', () => {
  const sh = renderPlanSh(defaultPlan('codex'));
  const noGate = sh.slice(sh.indexOf('if [ "$WITH_GATE" -eq 0 ]'), sh.indexOf('run_gate\n  local audit'));
  assert.match(noGate, /this is NOT proof of anything/);
  assert.doesNotMatch(noGate, /audit exit 0/);
  assert.match(noGate, /event --type end --exit 1/);
});

test('html (codex): the visual cites codex exec, no button and no claude', () => {
  const plan = buildPlan(
    project({ tasks: [t('T-001', { files: ['src/a.js'] })] }),
    'payments',
    { agent: 'codex' }
  );
  const html = renderPlanHtml(plan);
  assert.doesNotMatch(html, /<button/);
  assert.match(html, /Ask the agent \(Codex\)/);
  assert.match(html, /codex exec/);
  assert.doesNotMatch(html, /claude -p/);
});

test('md/sh (codex, sequential): explicit order, no worktrees, same gate', () => {
  const proj = project({
    tasks: [t('T-001', { files: ['src/a.js'], line: 1 }), t('T-002', { files: ['src/b.js'], line: 5 })],
  });
  const plan = buildPlan(proj, 'payments', { agent: 'codex', sequential: true, enginePath: '/tmp/repo-x/bin/onp-spec.js' });
  const md = renderPlanMd(plan);
  assert.match(md, /SEQUENTIAL mode \(user choice\)/);
  assert.match(md, /Execution — Codex headless/);
  assert.doesNotMatch(md, /## Lanes and waves/);
  const sh = renderPlanSh(plan);
  assert.match(sh, /run_seq_T_001/);
  assert.doesNotMatch(sh, /run_lane_/);
  assert.match(sh, /codex exec "\$3"/);
  const data = JSON.parse(renderPlanJson(plan));
  assert.equal(data.agent, 'codex');
  assert.equal(data.mode, 'sequential');
});

// ── cursor: same artifacts as claude, executor via the Cursor CLI (agent) ─

test('cursor: claude-* models are VALID slugs — nothing is swapped, not even with a warning', () => {
  const plan = buildPlan(
    project({
      tasks: [
        t('T-001', { files: ['a'], line: 1 }), // inherits the config default (claude-sonnet-5)
        t('T-002', { files: ['b'], line: 5, model: 'claude-opus-5', effort: 'max' }),
        t('T-003', { files: ['c'], line: 9, model: 'composer', effort: 'alto' }),
      ],
    }),
    'payments',
    { agent: 'cursor', enginePath: '/tmp/repo-x/bin/onp-spec.js' }
  );
  assert.ok(!plan.error, plan.error);
  assert.equal(plan.agent, 'cursor');
  const [f1, f2, f3] = plan.lanes;
  assert.equal(f1.tasks[0].model, 'claude-sonnet-5', 'Cursor serves claude models — default passes through intact');
  assert.equal(f2.tasks[0].model, 'claude-opus-5', 'an explicit claude-* Model: is respected in cursor');
  assert.equal(f3.tasks[0].model, 'composer', "Cursor's own model passes through intact");
  assert.ok(!plan.warnings.some((a) => a.includes('claude-opus-5')), 'no swap warning — there was no swap');
  // --model claude-* is also legitimate in cursor (it would be an error in codex)
  const forced = buildPlan(
    project({ tasks: [t('T-001', { files: ['a'] })] }),
    'payments',
    { agent: 'cursor', model: 'claude-opus-5' }
  );
  assert.ok(!forced.error, forced.error);
  assert.equal(forced.lanes[0].tasks[0].model, 'claude-opus-5');
});

test('md (cursor): Cursor CLI section, --force, cost confirmation and effort-in-the-slug — no claude -p', () => {
  const md = renderPlanMd(defaultPlan('cursor'));
  assert.match(md, /Execution — Cursor headless \(agent CLI\)/);
  assert.match(md, /run-tasks\.sh/);
  assert.match(md, /`agent -p` \(Cursor CLI\)/);
  assert.match(md, /--force/);
  assert.match(md, /overall progress summary/i);
  assert.match(md, /onp-spec summary payments/);
  assert.match(md, /audit --ci/);
  assert.doesNotMatch(md, /claude -p/, "the cursor plan cannot depend on Claude's CLI");
  assert.doesNotMatch(md, /codex exec/, 'nor on the Codex CLI');
  // cost confirmation is part of the artifact — the agent does not execute without it
  assert.match(md, /Cost confirmation — before executing/);
  assert.match(md, /--model composer/);
  assert.match(md, /onp-spec task payments T-xxx --model/);
  // honesty: the Cursor CLI has no effort flag — the slug decides
  assert.match(md, /Effort in Cursor/);
  assert.match(md, /gpt-5\.6-terra-high/);
  assert.match(md, /does NOT become a flag/);
});

test('sh (cursor): agent -p with --model per task, stream-json, --force and cursor-agent fallback', () => {
  const sh = renderPlanSh(defaultPlan('cursor'));
  assert.match(sh, /^#!\/usr\/bin\/env bash/);
  // current binary `agent`, with a fallback to the legacy name `cursor-agent`
  assert.match(sh, /CURSOR_BIN=\$\(command -v agent \|\| command -v cursor-agent\)/);
  assert.match(sh, /curl https:\/\/cursor\.com\/install -fsS \| bash/);
  // per-task invocation: model yes, effort NO (there is no such flag in the CLI)
  assert.match(sh, /"\$CURSOR_BIN" -p "\$3" --model "\$4" "\$\{STREAM_FLAGS\[@\]}" "\$\{CURSOR_FLAGS\[@\]}"/);
  assert.match(sh, /STREAM_FLAGS=\(--output-format stream-json\)/);
  assert.match(sh, /CURSOR_FLAGS=\(--force\)/);
  assert.doesNotMatch(sh, /--effort/, 'the Cursor CLI has no effort flag');
  assert.doesNotMatch(sh, /model_reasoning_effort/, "nor codex's effort config");
  assert.doesNotMatch(sh, /command -v claude/, "the cursor executor does not require Claude's CLI");
  assert.doesNotMatch(sh, /claude -p/, 'no claude invocation in the cursor executor');
  assert.doesNotMatch(sh, /codex exec/, 'no codex invocation in the cursor executor');
  // per-task prompts with the resolved model (default claude-sonnet-5 is valid in Cursor)
  assert.match(sh, /run_task 'lane-1' 'T-001' '[\s\S]*?' 'claude-sonnet-5' medium/);
  assert.match(sh, /run_task 'lane-2' 'T-002' '[\s\S]*?' 'claude-sonnet-5' high/);
  // per-minute summary: agent -p WITHOUT --force (read-only), the house model
  assert.match(sh, /SUMMARY_MODEL='composer'/);
  assert.match(sh, /"\$CURSOR_BIN" -p "You narrate[\s\S]*?--model "\$SUMMARY_MODEL"/);
  const summaryIdx = sh.indexOf('"$CURSOR_BIN" -p "You narrate');
  const summaryEnd = sh.indexOf('2>/dev/null)', summaryIdx);
  assert.ok(!sh.slice(summaryIdx, summaryEnd).includes('--force'), 'the per-minute summary is read-only (no --force)');
  // infrastructure identical to claude's: worktrees, merge, ledger, gate, dispatcher
  assert.match(sh, /git worktree add "\$3" -b/);
  assert.match(sh, /merge_lane 'lane-1'/);
  assert.match(sh, /run_seq_T_003/);
  assert.match(sh, /event\(\) \{ node "\$ENGINE" event --run "\$RUN_ID"/);
  assert.match(sh, /--lane\) MODE="lane"; TARGET="\$\{2:-}"; shift ;;/);
  assert.match(sh, /--no-gate\) WITH_GATE=0/);
  assert.match(sh, /run_gate/);
  assert.match(sh, /audit --ci/);
  assert.match(sh, /📣 summary/);
});

test('sh (cursor): --no-gate NEVER announces alignment (parity with claude)', () => {
  const sh = renderPlanSh(defaultPlan('cursor'));
  const noGate = sh.slice(sh.indexOf('if [ "$WITH_GATE" -eq 0 ]'), sh.indexOf('run_gate\n  local audit'));
  assert.match(noGate, /this is NOT proof of anything/);
  assert.doesNotMatch(noGate, /audit exit 0/);
  assert.match(noGate, /event --type end --exit 1/);
});

test('html (cursor): the visual cites the Cursor CLI, no button and no claude', () => {
  const plan = buildPlan(
    project({ tasks: [t('T-001', { files: ['src/a.js'] })] }),
    'payments',
    { agent: 'cursor' }
  );
  const html = renderPlanHtml(plan);
  assert.doesNotMatch(html, /<button/);
  assert.match(html, /Ask the agent \(Cursor\)/);
  assert.match(html, /agent -p/);
  assert.doesNotMatch(html, /claude -p/);
  assert.doesNotMatch(html, /codex exec/);
});

test('md/sh (cursor, sequential): explicit order, no worktrees, same gate', () => {
  const proj = project({
    tasks: [t('T-001', { files: ['src/a.js'], line: 1 }), t('T-002', { files: ['src/b.js'], line: 5 })],
  });
  const plan = buildPlan(proj, 'payments', { agent: 'cursor', sequential: true, enginePath: '/tmp/repo-x/bin/onp-spec.js' });
  const md = renderPlanMd(plan);
  assert.match(md, /SEQUENTIAL mode \(user choice\)/);
  assert.match(md, /Execution — Cursor headless/);
  assert.doesNotMatch(md, /## Lanes and waves/);
  const sh = renderPlanSh(plan);
  assert.match(sh, /run_seq_T_001/);
  assert.doesNotMatch(sh, /run_lane_/);
  assert.match(sh, /"\$CURSOR_BIN" -p "\$3"/);
  const data = JSON.parse(renderPlanJson(plan));
  assert.equal(data.agent, 'cursor');
  assert.equal(data.mode, 'sequential');
});

test('sh: claude -p with model/effort per task, stream-json, worktrees and merge', () => {
  const sh = renderPlanSh(defaultPlan('claude'));
  assert.match(sh, /^#!\/usr\/bin\/env bash/);
  assert.match(sh, /claude -p "\$3" --model "\$4" --effort "\$5" "\$\{STREAM_FLAGS\[@\]}"/);
  assert.match(sh, /STREAM_FLAGS=\(--output-format stream-json --verbose\)/);
  // the prompt goes inline (multiline) between the task and the model/effort
  assert.match(sh, /run_task 'lane-1' 'T-001' '[\s\S]*?' 'claude-sonnet-5' medium/);
  assert.match(sh, /run_task 'lane-2' 'T-002' '[\s\S]*?' 'claude-sonnet-5' high/); // task's high effort
  assert.match(sh, /--permission-mode acceptEdits/);
  assert.match(sh, /Bash\(node:\*\)/); // allowedTools derived from testCommand
  assert.match(sh, /git worktree add "\$3" -b/);
  assert.match(sh, /merge_lane 'lane-1'/);
  assert.match(sh, /mark_done T-001/); // T-003 has no Files: → sequential
  assert.match(sh, /audit --ci/);
  assert.match(sh, /run_seq_T_003/); // a task with no files becomes its own function
  // events go to the global ledger (the live panel reads from them)
  assert.match(sh, /event\(\) \{ node "\$ENGINE" event --run "\$RUN_ID"/);
  assert.match(sh, /event --type lane --lane 'lane-1' --state running/);
  assert.match(sh, /event --type gate --step audit --exit "\$AUDIT"/);
  assert.match(sh, /RUN_ID='repo-x-payments/);
});

test('sh: the dispatcher allows rerunning ONE lane, ONE sequential task, or just the gate', () => {
  const sh = renderPlanSh(defaultPlan('claude'));
  // one function per lane and per sequential task = an isolatable target
  assert.match(sh, /run_lane_1\(\) \{/);
  assert.match(sh, /run_lane_2\(\) \{/);
  assert.match(sh, /run_seq_T_003\(\) \{/);
  // argument parsing
  assert.match(sh, /--lane\) MODE="lane"; TARGET="\$\{2:-}"; shift ;;/);
  assert.match(sh, /--seq\) MODE="seq"/);
  assert.match(sh, /--gate\) MODE="gate"/);
  assert.match(sh, /--list\) MODE="list"/);
  assert.match(sh, /--no-gate\) WITH_GATE=0/);
  // dispatch by target (with the periodic summary on), unknown lane rejected
  assert.match(sh, /lane-1\) event --type start --scope "lane:lane-1"; start_summaries; run_lane_1/);
  assert.match(sh, /fail "unknown lane/);
  assert.match(sh, /fail "unknown sequential task/);
  // a previous attempt's worktree is cleaned before recreating
  assert.match(sh, /git worktree remove --force "\$3"/);
  assert.match(sh, /git branch -D "\$2"/);
  assert.match(sh, /attempt\(\)/);
  // the rerun hint shows up when something fails
  assert.match(sh, /re-run only it: bash .*--lane \$1/);
});

test('sh: overall progress summary every minute (AI with engine fallback)', () => {
  const sh = renderPlanSh(defaultPlan('claude'));
  assert.match(sh, /make_summary\(\)/);
  assert.match(sh, /sleep 60; make_summary/);
  assert.match(sh, /summary "\$FEATURE" --context/);
  assert.match(sh, /--save --source ai --text "\$ai"/);
  assert.match(sh, /SUMMARY_MODEL='claude-haiku-4-5'/);
  // no AI available, the engine's own summary takes its place (never silence)
  assert.match(sh, /summary "\$FEATURE" --save >\/dev\/null/);
  // the text shows up in the terminal, for whoever is following along there
  assert.match(sh, /📣 summary/);
  // on exit: kills the loop AND the child sleep (no stuck pipe) and records the final one
  assert.match(sh, /pkill -P "\$SUMMARY_PID"/);
  assert.match(sh, /trap 'stop_summaries; node "\$ENGINE" summary "\$FEATURE" --save/);
});

test('sh: --no-gate NEVER announces alignment (there is no proof without an audit)', () => {
  const sh = renderPlanSh(defaultPlan('claude'));
  const noGate = sh.slice(sh.indexOf('if [ "$WITH_GATE" -eq 0 ]'), sh.indexOf('run_gate\n  local audit'));
  assert.match(noGate, /this is NOT proof of anything/);
  assert.doesNotMatch(noGate, /audit exit 0/, 'without running the audit, nothing about exit 0');
  assert.match(noGate, /event --type end --exit 1/, 'the ledger records that there was no verdict');
  // the alignment phrase only exists in the path that runs the gate
  const withGate = sh.slice(sh.indexOf('run_gate\n  local audit'));
  assert.match(withGate, /audit exit 0/);
});

test('plan.json: machine structure for the panel and other tools', async () => {
  const { renderPlanJson } = await import('../src/core/plan.js');
  const data = JSON.parse(renderPlanJson(defaultPlan('claude')));
  assert.equal(data.feature, 'payments');
  assert.deepEqual(data.waves, [['lane-1', 'lane-2']]);
  assert.equal(data.lanes[0].tasks[0].id, 'T-001');
  assert.equal(data.lanes[0].tasks[0].effort, 'medium');
  assert.equal(data.sequential[0].id, 'T-003');
  assert.match(data.logsDir, /onp-worktrees\/repo-x-payments-logs/);
});

test('html: visual with no button, visible command, theme and escaping of hostile content', () => {
  const proj = project({
    tasks: [t('T-001', { files: ['src/a.js'] })],
  });
  proj.features[0].tasks.tasks[0].title = 'Task <script>alert(1)</script> & "quotes"';
  const plan = buildPlan(proj, 'payments', { agent: 'claude' });
  const html = renderPlanHtml(plan);
  // execution is via the agent: the html has no button or clipboard
  assert.doesNotMatch(html, /<button/);
  assert.doesNotMatch(html, /navigator\.clipboard/);
  assert.match(html, /via agent/);
  assert.match(html, /bash \.spec\/features\/payments\/run-tasks\.sh/);
  assert.match(html, /overall progress summary/i);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'the title must come out escaped');
  assert.match(html, /&lt;script&gt;/);
});

test('sh: a title with single quotes does not break bash quoting', () => {
  const proj = project({ tasks: [t('T-001', { files: ['src/a.js'] })] });
  proj.features[0].tasks.tasks[0].title = `flow "d'water" & $HOME \`id\``;
  const sh = renderPlanSh(buildPlan(proj, 'payments', { agent: 'claude' }));
  // inside single quotes, the only sensitive sequence is the quote itself — escaped
  assert.match(sh, /d'\\''water/);
});
