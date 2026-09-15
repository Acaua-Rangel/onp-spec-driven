// Execution plan — turns the pending tasks of tasks.md into LANES:
// tasks with disjoint `Files:` can run in PARALLEL (1 lane = 1 git worktree +
// 1 branch + 1 clean context window); tasks that share a file fall into the
// SAME lane (sequence within it); a task without `Files:` has an unknown
// footprint → it runs at the end, one at a time, on the main tree.
//
// PARALLELIZING IS THE USER'S CHOICE: the agent asks first — including WHICH
// tasks to parallelize. With `--parallelize T-001,T-003`, only the chosen ones
// compete for lanes; the rest run one after another, on the main tree, after
// the waves. With `--sequential`, the plan runs ALL tasks one after another
// (no worktrees) — same commit discipline and same gate.
//
// The plan CALCULATION is agent-agnostic. The ARTIFACTS vary:
//   claude      → plan-execution.md + run-tasks.sh (headless claude -p, with
//                 --model and --effort per task, and the overall progress
//                 summary every 1 min in the terminal) + plan-execution.html
//                 (visual, read-only)
//   codex       → same artifacts as claude, but the executor runs
//                 `codex exec` headless (--json, --sandbox, --model and
//                 model_reasoning_effort per task) — never depends on the
//                 Claude CLI
//   cursor      → same artifacts as claude, but the executor runs the Cursor
//                 CLI (`agent -p`, legacy `cursor-agent`) with
//                 --output-format stream-json and --force (without --force the
//                 print mode does not modify files); Cursor has no effort flag
//                 — effort is a suffix of the model slug
//   antigravity → plan-execution.md with worktree commands and a READY PROMPT
//                 per lane, for Antigravity's native parallel agents (never
//                 depends on any CLI)
//   copilot     → same as antigravity: plan-execution.md with worktree
//                 commands and a READY PROMPT per lane, for a new GitHub
//                 Copilot chat session per lane (never depends on any CLI)
//   gemini      → same as antigravity: plan-execution.md with worktree
//                 commands and a READY PROMPT per lane, for a new Gemini
//                 session per lane (never depends on any CLI)

import path from 'path';
import { foldStatus } from '../util/text.js';

export const AGENTS = ['claude', 'antigravity', 'codex', 'cursor', 'copilot', 'gemini'];

// agents whose plan generates run-tasks.sh + plan-execution.html (their own
// headless CLI); antigravity, copilot and gemini execute with native agent windows
export function usesShExecutor(agent) {
  return agent === 'claude' || agent === 'codex' || agent === 'cursor';
}

// display name for agents that have no headless CLI (native-agent prompts)
const NATIVE_AGENT_LABEL = { antigravity: 'Antigravity', copilot: 'GitHub Copilot', gemini: 'Gemini' };

// effort accepted in PT or EN → CLI level (`claude --effort <level>`)
export const EFFORT_CLI = {
  baixo: 'low',
  low: 'low',
  medio: 'medium',
  medium: 'medium',
  alto: 'high',
  high: 'high',
  xalto: 'xhigh',
  xhigh: 'xhigh',
  max: 'max',
  maximo: 'max',
};

export function normalizeEffort(raw) {
  if (!raw) return null;
  return EFFORT_CLI[foldStatus(String(raw)).replace(/[\s_-]/g, '')] || null;
}

// codex defaults when the config still carries a claude-* model (the config
// has claude defaults; a model from the other CLI would break codex exec)
const CODEX_MODEL = 'gpt-5.6-terra';
const CODEX_SUMMARY_MODEL = 'gpt-5.6-luna';
const isClaudeModel = (m) => /^claude-/.test(String(m || ''));

// in Cursor, claude-* models are VALID slugs (Cursor serves Claude, GPT,
// Gemini and its own models) — nothing is swapped. Only the per-minute summary
// model changes when it is still the default claude-haiku-4-5 (not a Cursor
// slug): composer takes over, an in-house model whose usage is included in the
// paid Cursor plans.
const CURSOR_SUMMARY_MODEL = 'composer';
const DEFAULT_SUMMARY_MODEL = 'claude-haiku-4-5';

// codex has no "max" level — the model_reasoning_effort ceiling is xhigh
export function effortForAgent(effortCli, agent) {
  if (agent === 'codex' && effortCli === 'max') return 'xhigh';
  return effortCli;
}

export function summaryModelForAgent(cfg, agent) {
  const m = cfg.summaryModel || DEFAULT_SUMMARY_MODEL;
  if (agent === 'codex' && isClaudeModel(m)) return CODEX_SUMMARY_MODEL;
  if (agent === 'cursor' && m === DEFAULT_SUMMARY_MODEL) return CURSOR_SUMMARY_MODEL;
  return m;
}

function intersects(setA, arrB) {
  return arrB.some((f) => setA.has(f));
}

function normFile(f) {
  return f.split('\\').join('/').replace(/^\.\//, '');
}

// ── calculation ────────────────────────────────────────────────────────────

export function buildPlan(project, featureName, opts = {}) {
  const agent = AGENTS.includes(opts.agent) ? opts.agent : 'claude';
  const feature = project.features.find((f) => f.name === featureName);
  if (!feature) return { error: `feature "${featureName}" not found in ${project.config.specDir}/features/` };
  if (!feature.tasks || !feature.tasks.tasks.length) {
    return { error: `feature "${featureName}" has no tasks in tasks.md — write the tasks (T-xxx) first` };
  }

  const cfg = project.config.parallel;
  const warnings = [];

  // explicit user choice for the WHOLE plan (--model/--effort): overrides
  // tasks.md and config — this is how someone on a tight license caps token
  // spend without editing any file
  let forcedEffort = null;
  if (opts.effort != null) {
    forcedEffort = normalizeEffort(opts.effort);
    if (!forcedEffort) {
      return { error: `--effort "${opts.effort}" unknown (accepted: low|medium|high|xhigh|max)` };
    }
  }
  const forcedModel = opts.model || null;
  if (forcedModel && agent === 'codex' && isClaudeModel(forcedModel)) {
    return {
      error: `--model "${forcedModel}" is a Claude model — this plan is for codex (use a Codex model, e.g. gpt-5.6-terra, gpt-5.6-luna)`,
    };
  }

  // acceptance criteria titles, to give human context in the prompts
  const acTitle = {};
  for (const f of project.features) {
    if (!f.spec) continue;
    for (const s of f.spec.stories) for (const ac of s.acs) acTitle[ac.id] = ac.title || '';
  }

  const done = [];
  const pending = [];
  for (const t of feature.tasks.tasks) {
    if (t.status === 'done') {
      done.push(t);
      continue;
    }
    if (t.status === 'in-progress') {
      warnings.push(`${t.id} is [in-progress] — it entered the plan; if there is local work already, commit before executing`);
    }
    const effortRaw = forcedEffort || t.effort || cfg.effort;
    const effortCli = normalizeEffort(effortRaw);
    if (!effortCli) {
      warnings.push(`${t.id}: effort "${effortRaw}" unknown — using "medium" (accepted: low|medium|high|xhigh|max)`);
    }
    let model = forcedModel || t.model || cfg.model;
    if (agent === 'codex' && isClaudeModel(model)) {
      if (t.model) warnings.push(`${t.id}: model "${model}" is Claude's — in codex it will run with "${CODEX_MODEL}"`);
      model = CODEX_MODEL;
    }
    pending.push({
      ...t,
      files: t.files.map(normFile),
      model,
      effortCli: effortForAgent(effortCli || 'medium', agent),
      acs: t.refs.filter((r) => r.startsWith('AC-')),
    });
  }

  if (!pending.length) {
    return { error: `all tasks of "${featureName}" are already [done] — nothing to plan` };
  }

  // sequential mode (user choice): no lanes and no worktrees — ALL tasks run
  // one after another, on the main tree, in tasks.md order; the commit
  // discipline and the gate stay the same
  if (opts.sequential) {
    pending.sort((a, b) => a.line - b.line);
    return finishPlan(project, featureName, {
      agent,
      opts,
      cfg,
      warnings,
      acTitle,
      done,
      mode: 'sequential',
      lanes: [],
      waves: [],
      sequential: pending,
      forcedModel,
      forcedEffort,
    });
  }

  // user selection (--parallelize T-001,T-003): only the chosen ones compete
  // for lanes; the rest run at the end, one at a time, on the main tree —
  // same commit discipline and same gate
  let selection = null;
  if (Array.isArray(opts.parallelize)) {
    selection = [...new Set(opts.parallelize)];
    if (!selection.length) {
      return { error: 'empty selection in --parallelize — to run everything one after another, use --sequential' };
    }
    const ids = new Set(pending.map((t) => t.id));
    const unknown = selection.filter((id) => !ids.has(id));
    if (unknown.length) {
      return {
        error: `--parallelize cites task(s) not pending in "${featureName}": ${unknown.join(', ')}`,
      };
    }
  }

  // group by file conflict: connected components become lanes
  const chosen = (t) => !selection || selection.includes(t.id);
  const withFiles = pending.filter((t) => t.files.length && chosen(t));
  const sequential = pending.filter((t) => !t.files.length || !chosen(t));
  for (const t of sequential) {
    if (!t.files.length) {
      t.seqReason = 'no `Files:` — unknown footprint';
      warnings.push(`${t.id} does not list Files: — unknown footprint, it will run alone at the end (no parallelism)`);
    } else {
      t.seqReason = 'outside the user selection';
    }
  }

  const lanes = [];
  for (const t of withFiles) {
    const owners = lanes.filter((fx) => intersects(fx.fileSet, t.files));
    if (!owners.length) {
      lanes.push({ tasks: [t], fileSet: new Set(t.files) });
    } else {
      // conflicts with 1+ lanes: merge them all into the first and add the task
      const target = owners[0];
      for (const other of owners.slice(1)) {
        target.tasks.push(...other.tasks);
        for (const f of other.fileSet) target.fileSet.add(f);
        lanes.splice(lanes.indexOf(other), 1);
      }
      target.tasks.push(t);
      for (const f of t.files) target.fileSet.add(f);
    }
  }
  // stable order: by the first task (tasks.md order)
  lanes.sort((a, b) => a.tasks[0].line - b.tasks[0].line);
  for (const fx of lanes) fx.tasks.sort((a, b) => a.line - b.line);

  const repoName = path.basename(project.config.rootDir);
  lanes.forEach((fx, i) => {
    fx.id = `lane-${i + 1}`;
    fx.branch = `spec/${featureName}-lane-${i + 1}`;
    fx.worktree = `../onp-worktrees/${repoName}-${featureName}-lane-${i + 1}`;
  });

  // waves: at most maxParallel lanes at the same time
  const max = Math.max(1, cfg.maxParallel | 0 || 3);
  const waves = [];
  for (let i = 0; i < lanes.length; i += max) waves.push(lanes.slice(i, i + max));

  return finishPlan(project, featureName, {
    agent,
    opts,
    cfg,
    warnings,
    acTitle,
    done,
    mode: 'parallel',
    lanes,
    waves,
    sequential,
    parallelize: selection,
    forcedModel,
    forcedEffort,
  });
}

// fields common to both modes (parallel and sequential)
function finishPlan(project, featureName, { agent, opts, cfg, warnings, acTitle, done, mode, lanes, waves, sequential, parallelize = null, forcedModel = null, forcedEffort = null }) {
  const repoName = path.basename(project.config.rootDir);
  // how to invoke the engine from the project root
  let engine = opts.enginePath || 'onp-spec';
  if (path.isAbsolute(engine)) {
    const rel = path.relative(project.config.rootDir, engine);
    if (!rel.startsWith('..')) engine = rel.split(path.sep).join('/');
  }

  return {
    agent,
    mode,
    feature: featureName,
    // identity of this run in the global ledger (changes with each plan generated)
    runId: opts.runId || `${repoName}-${featureName}-${Date.now().toString(36)}`,
    specDir: project.config.specDir,
    baseDir: `${project.config.specDir}/features/${featureName}`,
    workBranch: `spec/${featureName}`,
    repoName,
    testCommand: project.config.testCommand || null,
    cfg,
    engine,
    acTitle,
    lanes,
    waves,
    sequential,
    parallelize,
    forcedModel,
    forcedEffort,
    done,
    warnings,
    generatedAt: (opts.now || new Date()).toISOString().slice(0, 16).replace('T', ' '),
  };
}

// ── prompts ────────────────────────────────────────────────────────────────

function ruleLines(plan) {
  const test = plan.testCommand
    ? `Run the tests locally with \`${plan.testCommand}\` until they pass.`
    : 'Run the project tests locally until they pass.';
  return [
    'Non-negotiable rules:',
    '- Every referenced acceptance criterion becomes a test with @spec:AC-xxx in the title.',
    '- NEVER weaken, skip (skip/todo) or delete a test to make it pass — a skipped test is not proof and the audit flags it.',
    `- ${test}`,
    '- Do NOT edit tasks.md, do NOT run onp-spec verify/audit and do NOT touch other tasks — the orchestrator handles that.',
    '- At the end of EACH task: `git add` only what you touched and one commit of your own.',
  ];
}

function describeTask(plan, t) {
  const acs = t.acs.map((id) => (plan.acTitle[id] ? `${id} (${plan.acTitle[id]})` : id));
  const refs = acs.length ? acs.join(', ') : t.refs.join(', ') || '—';
  const files = t.files.length ? t.files.join(', ') : '(to be defined by the task)';
  return [
    `${t.id} — "${t.title}"`,
    `  criteria/refs: ${refs}`,
    `  allowed files (and their tests): ${files}`,
    `  commit message: "${t.id} ${plan.feature}: ${t.title}"`,
  ];
}

// prompt for ONE task (headless claude script and sequential tasks)
export function taskPrompt(plan, t) {
  return [
    `You execute ONE task of feature "${plan.feature}" (onp-spec flow, spec-anchored).`,
    `Read first: ${plan.baseDir}/spec.md, ${plan.baseDir}/tasks.md and .spec/constitution.md.`,
    '',
    'Your task (only it):',
    ...describeTask(plan, t),
    '',
    ...ruleLines(plan),
  ].join('\n');
}

// prompt for a whole LANE (one clean window runs the tasks in order)
export function lanePrompt(plan, fx, { worktree = true } = {}) {
  const where = worktree
    ? `Work ONLY inside the worktree ${fx.worktree} (branch ${fx.branch}) — already prepared.`
    : 'Work on the repository main tree.';
  return [
    `You execute the tasks of ${fx.id} of feature "${plan.feature}" (onp-spec flow, spec-anchored).`,
    where,
    `Read first: ${plan.baseDir}/spec.md, ${plan.baseDir}/tasks.md and .spec/constitution.md.`,
    '',
    `Execute IN THIS ORDER (1 task = 1 commit):`,
    ...fx.tasks.flatMap((t) => describeTask(plan, t)),
    '',
    ...ruleLines(plan),
    'When the last task is committed, STOP and report the result — merging is the orchestrator\'s job.',
  ].join('\n');
}

// ── artifact: plan.json (machine-readable — feeds the ledger/summary) ──

export function renderPlanJson(plan) {
  const task = (t) => ({
    id: t.id,
    title: t.title,
    model: t.model,
    effort: t.effortCli,
    files: t.files,
    refs: t.refs,
  });
  return `${JSON.stringify(
    {
      runId: plan.runId,
      feature: plan.feature,
      agent: plan.agent,
      mode: plan.mode,
      parallelize: plan.parallelize || null,
      forcedModel: plan.forcedModel || null,
      forcedEffort: plan.forcedEffort || null,
      generatedAt: plan.generatedAt,
      workBranch: plan.workBranch,
      baseDir: plan.baseDir,
      specDir: plan.specDir,
      repoName: plan.repoName,
      logsDir: `../onp-worktrees/${plan.repoName}-${plan.feature}-logs`,
      waves: plan.waves.map((wave) => wave.map((fx) => fx.id)),
      lanes: plan.lanes.map((fx) => ({
        id: fx.id,
        branch: fx.branch,
        worktree: fx.worktree,
        tasks: fx.tasks.map(task),
      })),
      sequential: plan.sequential.map(task),
      done: plan.done.map((t) => t.id),
      warnings: plan.warnings,
    },
    null,
    2
  )}\n`;
}

// ── artifact: plan-execution.md ────────────────────────────────────────────

function laneTable(plan, fx) {
  const lines = [
    '| task | title | model | effort | files |',
    '|---|---|---|---|---|',
  ];
  for (const t of fx.tasks) {
    lines.push(`| ${t.id} | ${t.title} | \`${t.model}\` | ${t.effortCli} | ${t.files.map((f) => `\`${f}\``).join(', ') || '—'} |`);
  }
  return lines;
}

// flags that reproduce this plan (for the "regenerate with" of the artifacts)
function regenerateFlags(plan) {
  let flags = '';
  if (plan.mode === 'sequential') flags += ' --sequential';
  else if (plan.parallelize) flags += ` --parallelize ${plan.parallelize.join(',')}`;
  if (plan.forcedModel) flags += ` --model ${plan.forcedModel}`;
  if (plan.forcedEffort) flags += ` --effort ${plan.forcedEffort}`;
  return flags;
}

export function renderPlanMd(plan) {
  const L = [];
  const parallel = plan.lanes.reduce((n, fx) => n + fx.tasks.length, 0);
  const sequential = plan.mode === 'sequential';
  L.push(`# Execution plan — ${plan.feature}`);
  L.push('');
  L.push(`> generated by \`onp-spec plan\` at ${plan.generatedAt} — do NOT edit by hand;`);
  L.push(`> changed tasks.md or the config? Regenerate: \`onp-spec plan ${plan.feature}${regenerateFlags(plan)}\``);
  L.push('');
  L.push('## Summary — what will happen');
  L.push('');
  if (sequential) {
    L.push(`- **SEQUENTIAL mode (user choice)**: ${plan.sequential.length} pending task(s), ONE AFTER ANOTHER, on the main tree${plan.done.length ? ` (${plan.done.length} already done: ${plan.done.map((t) => t.id).join(', ')})` : ''}`);
    L.push('- no worktrees and no parallelism — each task runs in a clean context window, in tasks.md order');
  } else {
    L.push(`- **${parallel + plan.sequential.length} pending task(s)**: ${parallel} in ${plan.lanes.length} parallel lane(s) + ${plan.sequential.length} sequential${plan.done.length ? ` (${plan.done.length} already done: ${plan.done.map((t) => t.id).join(', ')})` : ''}`);
    if (plan.parallelize) {
      L.push(`- **user selection**: parallelize only ${plan.parallelize.join(', ')} — the rest run one after another, at the end`);
    }
    L.push(`- **1 lane = 1 worktree + 1 branch + 1 clean context window** — lanes share no file with each other`);
    L.push(`- prefer another selection or one after another? Regenerate with \`onp-spec plan ${plan.feature} --parallelize T-xxx,T-yyy\` or \`--sequential\``);
  }
  if (plan.forcedModel || plan.forcedEffort) {
    const parts = [];
    if (plan.forcedModel) parts.push(`model \`${plan.forcedModel}\``);
    if (plan.forcedEffort) parts.push(`effort \`${plan.forcedEffort}\``);
    L.push(`- **cost locked by the user**: ${parts.join(' · ')} on ALL tasks (overrides tasks.md and config)`);
  }
  L.push(`- everything happens on the work branch \`${plan.workBranch}\`; taking it to main is your decision`);
  if (plan.warnings.length) {
    L.push('');
    L.push('### Warnings');
    L.push('');
    for (const a of plan.warnings) L.push(`- ⚠ ${a}`);
  }
  L.push('');
  if (!sequential) {
    L.push('## Lanes and waves');
    L.push('');
    plan.waves.forEach((wave, i) => {
      L.push(`### Wave ${i + 1} — ${wave.map((fx) => fx.id).join(' ∥ ')}`);
      L.push('');
      for (const fx of wave) {
        L.push(`#### ${fx.id} — branch \`${fx.branch}\` — worktree \`${fx.worktree}\``);
        L.push('');
        L.push(...laneTable(plan, fx));
        L.push('');
      }
    });
  }
  if (plan.sequential.length) {
    L.push(sequential ? '## Execution order (one task after another)' : '## Sequential tasks (after the waves, on the main tree)');
    L.push('');
    L.push(`| task | title | model | effort |${sequential ? '' : ' why sequential |'}`);
    L.push(`|---|---|---|---|${sequential ? '' : '---|'}`);
    for (const t of plan.sequential) {
      L.push(`| ${t.id} | ${t.title} | \`${t.model}\` | ${t.effortCli} |${sequential ? '' : ` ${t.seqReason || '—'} |`}`);
    }
    L.push('');
  }
  L.push('## Branch and commit management');
  L.push('');
  L.push(`1. work branch \`${plan.workBranch}\` created from the current point (if it does not exist yet)`);
  if (sequential) {
    L.push('2. the tasks run on it, in order — **1 task = 1 commit** (`T-xxx feature: title`), marked `[done]` only with work done');
    L.push(`3. final gate on the work branch: \`onp-spec verify ${plan.feature}\` + \`onp-spec audit --ci\` — **exit 0 or it is not ready**`);
  } else {
    L.push('2. each lane is born from it as its own branch and runs in its worktree — **1 task = 1 commit** (`T-xxx feature: title`)');
    L.push('3. wave finished → merge `--no-ff` of each lane back, in order; a conflict stops the lane and asks for human resolution');
    L.push('4. merged lane → worktree removed, branch deleted, task marked `[done]` in tasks.md');
    L.push(`5. final gate on the work branch: \`onp-spec verify ${plan.feature}\` + \`onp-spec audit --ci\` — **exit 0 or it is not ready**`);
  }
  L.push('');
  L.push('## How to execute');
  L.push('');
  if (usesShExecutor(plan.agent)) {
    const codex = plan.agent === 'codex';
    const cursor = plan.agent === 'cursor';
    const cliTask = codex ? '`codex exec`' : cursor ? '`agent -p` (Cursor CLI)' : '`claude -p`';
    const tuning = codex
      ? `\`--model\` and \`model_reasoning_effort\` already set per task and sandbox \`${plan.cfg.sandbox}\``
      : cursor
        ? '`--model` already set per task and `--force` (without it, Cursor print mode does not modify files)'
        : `\`--model\` and \`--effort\` already set per task and permissions \`${plan.cfg.permissionMode}\``;
    L.push(
      codex
        ? '### ▶ Execution — Codex headless (codex exec)'
        : cursor
          ? '### ▶ Execution — Cursor headless (agent CLI)'
          : '### ▶ Execution — Claude Code headless'
    );
    L.push('');
    L.push('```bash');
    L.push(`bash ${plan.baseDir}/run-tasks.sh`);
    L.push('```');
    L.push('');
    if (sequential) {
      L.push(`Each task runs ${cliTask} with a **clean context window**, on the main tree,`);
      L.push(`one after another, with ${tuning}.`);
      L.push('The exact prompts are embedded in the script.');
    } else {
      L.push(`Each lane runs ${cliTask} with a **clean context window**, in its worktree, with`);
      L.push(`${tuning}. The exact prompts are`);
      L.push('embedded in the script — want to run a lane by hand, just copy them from there.');
    }
    L.push(`Logs: \`../onp-worktrees/${plan.repoName}-${plan.feature}-logs/\`.`);
    if (codex) {
      L.push('');
      L.push('**Cost confirmation — before executing**: the models and efforts per');
      L.push('task are in the tables above; the agent CONFIRMS with the user whether they');
      L.push('are within their license/quota (a strong model + high effort burns tokens).');
      L.push(`To spend less: \`onp-spec plan ${plan.feature} --model gpt-5.6-luna --effort low\``);
      L.push(`(everything) or per task \`onp-spec task ${plan.feature} T-xxx --model <m> --effort <level>\` — and regenerate the plan.`);
    }
    if (cursor) {
      L.push('');
      L.push('**Cost confirmation — before executing**: the models per task are in');
      L.push('the tables above; the agent CONFIRMS with the user whether they are within');
      L.push('their Cursor plan (claude-*/gpt-* models are charged per use; `composer` has');
      L.push(`usage included in the paid plans). To spend less: \`onp-spec plan ${plan.feature} --model composer\``);
      L.push(`(everything) or per task \`onp-spec task ${plan.feature} T-xxx --model <m>\` — and regenerate the plan.`);
      L.push('');
      L.push('**Effort in Cursor**: the CLI has no effort flag — the level goes embedded');
      L.push('in the model slug (e.g. `gpt-5.6-terra-high`). The "effort" column above is');
      L.push('informational and does NOT become a flag; to control effort, choose the slug.');
    }
    L.push('');
    L.push('### 📣 Follow-up — table + summary in chat (every 1 min)');
    L.push('');
    L.push('The script runs in the **background**: the agent WARNS the user before starting');
    L.push('and, while it runs, posts in chat every ~1 minute the **progress table** (which');
    L.push('task is running, which is not, what finished/failed) together with the');
    L.push('**overall progress summary** (written by AI; without AI, the engine summarizes).');
    L.push('At the end, the user gets the full summary of the run. At any time:');
    L.push('');
    L.push('```bash');
    L.push(`onp-spec summary ${plan.feature} --table   # the progress table`);
    L.push(`onp-spec summary ${plan.feature}           # the summary in text`);
    L.push('```');
  } else if (sequential) {
    const nativeLabel = NATIVE_AGENT_LABEL[plan.agent] || plan.agent;
    L.push(`### ▶ Sequential in ${nativeLabel} (one task after another, no Claude CLI)`);
    L.push('');
    L.push('1. **Enter the work branch** (terminal, at the repository root):');
    L.push('');
    L.push('```bash');
    L.push(`git checkout -b ${plan.workBranch}   # or: git checkout ${plan.workBranch}`);
    L.push('```');
    L.push('');
    L.push('2. **Execute the tasks IN ORDER, one after another** (a clean window per task');
    L.push('   helps focus; the next only starts when the previous has committed):');
    L.push('');
    for (const t of plan.sequential) {
      L.push(`#### Prompt — ${t.id}`);
      L.push('');
      L.push('```');
      L.push(taskPrompt(plan, t));
      L.push('```');
      L.push('');
      L.push(`\`node ${plan.engine} task ${plan.feature} ${t.id} done\` after the commit.`);
      L.push('');
    }
    L.push('3. **Final gate** (exit 0 or it is not ready):');
    L.push('');
    L.push('```bash');
    L.push(`node ${plan.engine} verify ${plan.feature}`);
    L.push(`node ${plan.engine} audit --ci`);
    L.push('```');
    L.push('');
    L.push('4. **Follow-up (every ~1 min, while executing)**: warn BEFORE starting');
    L.push('   that the work runs in the background and that the full summary comes at the end.');
    L.push('   Mark each task in the ledger when it starts and finishes (that is what the table is made of):');
    L.push('');
    L.push('```bash');
    L.push(`node ${plan.engine} event --run ${plan.runId} --type task --task <T-xxx> --lane seq --state running   # when starting`);
    L.push(`node ${plan.engine} event --run ${plan.runId} --type task --task <T-xxx> --lane seq --state done      # after the commit`);
    L.push('```');
    L.push('');
    L.push('   And every ~1 min post the progress TABLE in chat + a short paragraph,');
    L.push('   recording the text in the ledger:');
    L.push('');
    L.push('```bash');
    L.push(`node ${plan.engine} summary ${plan.feature} --table   # the table — paste in chat`);
    L.push(`node ${plan.engine} summary ${plan.feature} --save --source ai --text "<2 to 4 sentences of what is going on>"`);
    L.push('```');
  } else {
    const nativeLabel = NATIVE_AGENT_LABEL[plan.agent] || plan.agent;
    L.push(`### ▶ Native parallel in ${nativeLabel} (clean windows, no Claude CLI)`);
    L.push('');
    L.push('1. **Prepare the work branch and the worktrees** (terminal, at the repository root):');
    L.push('');
    L.push('```bash');
    L.push(`git checkout -b ${plan.workBranch}   # or: git checkout ${plan.workBranch}`);
    for (const fx of plan.lanes) {
      L.push(`git worktree add ${fx.worktree} -b ${fx.branch}`);
    }
    L.push('```');
    L.push('');
    L.push('2. **Open a NEW agent per lane** (clean window) and paste the lane prompt:');
    L.push('');
    for (const fx of plan.lanes) {
      L.push(`#### Prompt — ${fx.id}`);
      L.push('');
      L.push('```');
      L.push(lanePrompt(plan, fx));
      L.push('```');
      L.push('');
    }
    L.push('3. **All finished? Merge in order and mark the tasks** (on the main tree):');
    L.push('');
    L.push('```bash');
    for (const fx of plan.lanes) {
      L.push(`git merge --no-ff ${fx.branch} -m "merge ${fx.id} (${plan.feature})"`);
      L.push(`git worktree remove ${fx.worktree} && git branch -d ${fx.branch}`);
      for (const t of fx.tasks) L.push(`node ${plan.engine} task ${plan.feature} ${t.id} done`);
    }
    L.push('```');
    if (plan.sequential.length) {
      L.push('');
      L.push('4. **Sequential tasks** — execute them yourself (same window or new), one by one:');
      L.push('');
      for (const t of plan.sequential) {
        L.push('```');
        L.push(taskPrompt(plan, t));
        L.push('```');
        L.push('');
        L.push(`\`node ${plan.engine} task ${plan.feature} ${t.id} done\` after the commit.`);
        L.push('');
      }
    }
    L.push('');
    L.push('5. **Final gate** (exit 0 or it is not ready):');
    L.push('');
    L.push('```bash');
    L.push(`node ${plan.engine} verify ${plan.feature}`);
    L.push(`node ${plan.engine} audit --ci`);
    L.push('```');
    L.push('');
    L.push('6. **Follow-up (every ~1 min, while the agents work)**: warn BEFORE');
    L.push('   dispatching the agents that the work runs in the background and that the');
    L.push('   full summary comes at the end. Mark each task in the ledger when an agent');
    L.push('   starts and finishes (that is what the table is made of):');
    L.push('');
    L.push('```bash');
    L.push(`node ${plan.engine} event --run ${plan.runId} --type task --task <T-xxx> --lane <lane-N> --state running`);
    L.push(`node ${plan.engine} event --run ${plan.runId} --type task --task <T-xxx> --lane <lane-N> --state done`);
    L.push('```');
    L.push('');
    L.push('   And every ~1 min post the progress TABLE in chat + a short paragraph,');
    L.push('   recording the text in the ledger:');
    L.push('');
    L.push('```bash');
    L.push(`node ${plan.engine} summary ${plan.feature} --table   # the table — paste in chat`);
    L.push(`node ${plan.engine} summary ${plan.feature} --save --source ai --text "<2 to 4 sentences of what is going on>"`);
    L.push('```');
  }
  L.push('');
  return `${L.join('\n')}\n`;
}
// ── artifact: run-tasks.sh (claude and codex) ──────────────────────────────
//
// The script is a DISPATCHER, not a linear script: each lane and each
// sequential task become functions, so only what failed can be re-run.
//
//   bash run-tasks.sh                  → everything (waves → sequential → gate)
//   bash run-tasks.sh --lane lane-2    → only that lane (+ merge + gate)
//   bash run-tasks.sh --seq T-004      → only that sequential task
//   bash run-tasks.sh --gate           → only verify + audit
//   bash run-tasks.sh --list           → what exists to run
//
// Each task runs the agent's headless CLI with JSONL output:
//   claude → `claude -p --output-format stream-json --verbose`
//   codex  → `codex exec --json` (sandbox + --add-dir for the worktrees'
//            shared .git)
// The raw JSONL goes to the task's stream in the global ledger (tools,
// reasoning, outputs, cost) — that's where the summary pulls the "last
// action" from.

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function allowedTools(plan) {
  if (plan.cfg.allowedTools) return plan.cfg.allowedTools;
  const base = ['Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)'];
  if (plan.testCommand) base.push(`Bash(${plan.testCommand.split(/\s+/)[0]}:*)`);
  return base.join(',');
}

// bash function name from the lane id (lane-1 → lane_1)
const fn = (id) => id.replace(/-/g, '_');

export function renderPlanSh(plan) {
  const L = [];
  const P = (...lines) => L.push(...lines);

  P('#!/usr/bin/env bash');
  P(`# run-tasks.sh — generated by \`onp-spec plan ${plan.feature}\` at ${plan.generatedAt}`);
  P('# do NOT edit by hand: changed tasks.md or the config, regenerate the plan.');
  P('#');
  P('# usage:');
  P('#   bash run-tasks.sh                  all (waves → sequential → gate)');
  P('#   bash run-tasks.sh --lane <id>      re-run ONE lane (+ merge + gate)');
  P('#   bash run-tasks.sh --seq <T-xxx>    re-run ONE sequential task');
  P('#   bash run-tasks.sh --gate           only the gate (verify + audit)');
  P('#   bash run-tasks.sh --list           show lanes, tasks and states');
  P('#   (add --no-gate to skip the gate at the end)');
  P('#');
  P(`# summary of what is going on, at any time: onp-spec summary ${plan.feature}`);
  P('set -u');
  P('set -o pipefail');
  P('');
  const codex = plan.agent === 'codex';
  const cursor = plan.agent === 'cursor';
  P(`RUN_ID=${shq(plan.runId)}`);
  P(`FEATURE=${shq(plan.feature)}`);
  P(`BASE_BRANCH=${shq(plan.workBranch)}`);
  P(`ENGINE=${shq(plan.engine)}`);
  if (codex) {
    P(`CODEX_FLAGS=(--sandbox ${shq(plan.cfg.sandbox || 'workspace-write')})`);
    P('STREAM_FLAGS=(--json)');
  } else if (cursor) {
    P('# --force: without it Cursor print mode only proposes changes (does not write).');
    P('# Fine control is the user\'s: permissions.deny in .cursor/cli.json OVERRIDES --force.');
    P('CURSOR_FLAGS=(--force)');
    P('STREAM_FLAGS=(--output-format stream-json)');
  } else {
    P(`CLAUDE_FLAGS=(--permission-mode ${plan.cfg.permissionMode} --allowedTools ${shq(allowedTools(plan))})`);
    P('STREAM_FLAGS=(--output-format stream-json --verbose)');
  }
  P('FAILURES=""');
  P('WITH_GATE=1');
  P(`SUMMARY_MODEL=${shq(summaryModelForAgent(plan.cfg, plan.agent))}`);
  P('SUMMARY_PID=""');
  P('');
  P(`green()  { printf '\\033[32m%s\\033[0m\\n' "$*"; }`);
  P(`red()    { printf '\\033[31m%s\\033[0m\\n' "$*"; }`);
  P(`yellow() { printf '\\033[33m%s\\033[0m\\n' "$*"; }`);
  P(`info()   { printf '· %s\\n' "$*"; }`);
  P('fail()   { red "✘ $*"; exit 1; }');
  P('');
  P('# events go to the GLOBAL ledger (~/.onp-spec/panel/ledger.jsonl):');
  P('# one file for all projects, it is what onp-spec summary reads');
  P('event() { node "$ENGINE" event --run "$RUN_ID" "$@" >/dev/null 2>&1 || true; }');
  P('');
  P('# ── environment (every mode passes through here) ─────────────────────');
  P('prepare_env() {');
  P('  command -v git >/dev/null 2>&1 || fail "git not found"');
  P('  command -v node >/dev/null 2>&1 || fail "node not found"');
  if (codex) {
    P('  command -v codex >/dev/null 2>&1 || fail "Codex CLI (codex) not found — install it or follow the manual mode in plan-execution.md"');
  } else if (cursor) {
    P('  # the current Cursor CLI binary is `agent`; `cursor-agent` is the legacy name');
    P('  CURSOR_BIN=$(command -v agent || command -v cursor-agent) || fail "Cursor CLI (agent) not found — install: curl https://cursor.com/install -fsS | bash"');
  } else {
    P('  command -v claude >/dev/null 2>&1 || fail "Claude Code CLI (claude) not found — install it or follow the manual mode in plan-execution.md"');
  }
  P('  TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null) || fail "outside a git repository"');
  P('  cd "$TOPLEVEL" || exit 1');
  P('  # artifacts just generated by `onp-spec plan` are expected dirt:');
  P('  # if they are the ONLY dirt, the script commits them; any other, it aborts');
  P('  if [ -n "$(git status --porcelain)" ]; then');
  P(`    if [ -z "$(git status --porcelain | grep -v -e 'plan-execution\\.' -e 'plan\\.json' -e 'run-tasks\\.sh')" ]; then`);
  P('      git add -A');
  P('      git commit -q -m "execution plan: $FEATURE (generated artifacts)"');
  P('      info "plan artifacts committed"');
  P('    else');
  P('      fail "tree dirty beyond the plan artifacts — commit or git stash first (the worktrees start from the last commit)"');
  P('    fi');
  P('  fi');
  P(`  git ls-files --error-unmatch -- ${shq(`${plan.baseDir}/spec.md`)} >/dev/null 2>&1 || fail "spec.md is not committed — the lane worktrees need it in git"`);
  P('  CURRENT=$(git rev-parse --abbrev-ref HEAD)');
  P('  [ "$CURRENT" != "HEAD" ] || fail "detached HEAD — switch to a branch"');
  P('  if [ "$CURRENT" != "$BASE_BRANCH" ]; then');
  P('    if git show-ref --verify --quiet "refs/heads/$BASE_BRANCH"; then');
  P('      git checkout -q "$BASE_BRANCH" || fail "could not switch to $BASE_BRANCH"');
  P('    else');
  P('      git checkout -q -b "$BASE_BRANCH" || fail "could not create $BASE_BRANCH"');
  P('    fi');
  P('    info "work branch: $BASE_BRANCH (from $CURRENT)"');
  P('  fi');
  P('  git worktree prune');
  P(`  LOG_DIR="$(dirname "$TOPLEVEL")/onp-worktrees/${plan.repoName}-${plan.feature}-logs"`);
  P(`  WT_BASE="$(dirname "$TOPLEVEL")/onp-worktrees/${plan.repoName}-${plan.feature}"`);
  P('  STREAMS_DIR="${ONP_SPEC_HOME:-$HOME/.onp-spec}/panel/streams/$RUN_ID"');
  P('  mkdir -p "$LOG_DIR" "$STREAMS_DIR"');
  P('}');
  P('');
  P('# clean worktree even after a failed attempt');
  P('prepare_worktree() { # $1=lane $2=branch $3=worktree');
  P('  git worktree prune');
  P('  if [ -e "$3" ]; then git worktree remove --force "$3" >/dev/null 2>&1; rm -rf "$3"; fi');
  P('  if git show-ref --verify --quiet "refs/heads/$2"; then git branch -D "$2" >/dev/null 2>&1; fi');
  P('  git worktree add "$3" -b "$2" >/dev/null 2>&1 || { red "✘ could not create the worktree of $1 at $3"; return 1; }');
  P('}');
  P('');
  P('attempt() { # $1=lane — counts re-runs (goes to the ledger)');
  P('  local file="$LOG_DIR/.attempt-$1"');
  P('  local n=1');
  P('  [ -f "$file" ] && n=$(( $(cat "$file") + 1 ))');
  P('  printf "%s" "$n" > "$file"');
  P('  printf "%s" "$n"');
  P('}');
  P('');
  P(`# one task = one headless ${codex ? 'codex exec' : cursor ? 'agent (Cursor)' : 'claude'} session with a clean context.`);
  P('# the session JSONL becomes the task stream in the ledger');
  P('run_task() { # $1=scope(lane|seq) $2=T-xxx $3=prompt $4=model $5=effort');
  P('  local key="$1--$2"');
  P('  local stream="$STREAMS_DIR/$key.jsonl"');
  P('  event --type task --task "$2" --lane "$1" --state running --stream "$key"');
  if (codex) {
    P('  info "$2 — codex exec ($4 · $5) · stream: $key"');
    P('  # --add-dir: the shared .git of the worktrees lives in the main repo —');
    P('  # without it the workspace-write sandbox would block the task commit');
    P('  if codex exec "$3" --model "$4" -c model_reasoning_effort="$5" "${STREAM_FLAGS[@]}" "${CODEX_FLAGS[@]}" --add-dir "$TOPLEVEL" > "$stream" 2>>"$LOG_DIR/$1.log"; then');
  } else if (cursor) {
    P('  info "$2 — agent -p ($4) · stream: $key"');
    P('  # $5 (effort) does not become a flag: the Cursor CLI has no reasoning effort —');
    P('  # the level goes embedded in the model slug (e.g. gpt-5.6-terra-high)');
    P('  if "$CURSOR_BIN" -p "$3" --model "$4" "${STREAM_FLAGS[@]}" "${CURSOR_FLAGS[@]}" > "$stream" 2>>"$LOG_DIR/$1.log"; then');
  } else {
    P('  info "$2 — claude -p ($4 · $5) · stream: $key"');
    P('  if claude -p "$3" --model "$4" --effort "$5" "${STREAM_FLAGS[@]}" "${CLAUDE_FLAGS[@]}" > "$stream" 2>>"$LOG_DIR/$1.log"; then');
  }
  P('    event --type task --task "$2" --lane "$1" --state done --stream "$key"');
  P('    node "$ENGINE" stream-summary "$RUN_ID" "$key" 2>/dev/null || true');
  P('    return 0');
  P('  fi');
  P('  event --type task --task "$2" --lane "$1" --state failed --stream "$key"');
  P('  node "$ENGINE" stream-summary "$RUN_ID" "$key" 2>/dev/null || true');
  P('  return 1');
  P('}');
  P('');
  P('merge_lane() { # $1=lane $2=branch $3=worktree $4=lane-exit');
  P('  if [ "$4" -ne 0 ]; then');
  P('    event --type lane --lane "$1" --state failed');
  P('    red "✘ $1 failed (log: $LOG_DIR/$1.log) — worktree kept for inspection: $3"');
  P(`    yellow "  re-run only it: bash ${plan.baseDir}/run-tasks.sh --lane $1"`);
  P('    FAILURES="$FAILURES $1"; return 1');
  P('  fi');
  P('  event --type lane --lane "$1" --state merging');
  P('  if git merge --no-ff "$2" -m "merge $1 ($FEATURE)"; then');
  P('    git worktree remove --force "$3" >/dev/null 2>&1');
  P('    git branch -d "$2" >/dev/null 2>&1');
  P('    event --type lane --lane "$1" --state merged');
  P('    green "✔ $1 merged into $BASE_BRANCH"');
  P('  else');
  P('    git merge --abort >/dev/null 2>&1');
  P('    event --type lane --lane "$1" --state conflict');
  P('    red "✘ conflict merging $1 — resolve by hand: git merge $2 (worktree kept: $3)"');
  P('    FAILURES="$FAILURES $1"; return 1');
  P('  fi');
  P('}');
  P('');
  P('mark_done() { # $@=T-xxx');
  P('  for t in "$@"; do node "$ENGINE" task "$FEATURE" "$t" done >/dev/null || true; done');
  P('}');
  P('');
  P('# ── overall progress summary: 1/min while the run is going ────────────');
  P(
    `# written by AI (${codex ? 'read-only codex exec' : cursor ? 'agent -p without --force, read-only' : 'claude -p, no tools'}) with engine fallback; goes`
  );
  P('# to the terminal and to the ledger — the agent relays the text in chat.');
  P('make_summary() {');
  P('  local ctx ai');
  P('  ctx=$(node "$ENGINE" summary "$FEATURE" --context 2>/dev/null) || ctx=""');
  P('  [ -n "$ctx" ] || return 0');
  P(
    `  ai=$(${codex ? 'codex exec' : cursor ? '"$CURSOR_BIN" -p' : 'claude -p'} "You narrate, for the product owner, an in-progress code task run. Mechanical state:`
  );
  P('');
  P('$ctx');
  P('');
  P(
    `Write the OVERALL PROGRESS SUMMARY: a single paragraph of 2 to 4 sentences, in plain English, saying what is happening now, what has finished, what failed and whether the user needs to act. No markdown, no lists." --model "$SUMMARY_MODEL"${codex ? ' --sandbox read-only --ephemeral' : ''} 2>/dev/null)`
  );
  P('  if [ -n "$ai" ]; then');
  P('    node "$ENGINE" summary "$FEATURE" --save --source ai --text "$ai" >/dev/null 2>&1 || true');
  P(`    printf '\\n📣 summary (AI): %s\\n' "$ai"`);
  P('  else');
  P('    node "$ENGINE" summary "$FEATURE" --save >/dev/null 2>&1 || true');
  P(`    printf '\\n📣 summary: %s\\n' "$(node "$ENGINE" summary "$FEATURE" 2>/dev/null)"`);
  P('  fi');
  P('}');
  P('');
  P('# kills the loop AND the child sleep — otherwise the sleep inherits stdout and');
  P('# whoever called the script via a pipe waits for EOF for up to 60s after exit');
  P('stop_summaries() {');
  P('  [ -n "$SUMMARY_PID" ] || return 0');
  P('  command -v pkill >/dev/null 2>&1 && pkill -P "$SUMMARY_PID" 2>/dev/null');
  P('  kill "$SUMMARY_PID" 2>/dev/null');
  P('  SUMMARY_PID=""');
  P('}');
  P('');
  P('start_summaries() {');
  P('  ( while :; do sleep 60; make_summary; done ) &');
  P('  SUMMARY_PID=$!');
  P('  # on exit: stop the loop and record a last summary (the final state, from the engine)');
  P(`  trap 'stop_summaries; node "$ENGINE" summary "$FEATURE" --save >/dev/null 2>&1 || true' EXIT`);
  P('}');

  // ── one function per lane ───────────────────────────────────────────────
  for (const fx of plan.lanes) {
    const ids = fx.tasks.map((t) => t.id).join(' ');
    P('');
    P(`# ── ${fx.id}: ${ids} ──`);
    P(`run_${fn(fx.id)}() {`);
    P(`  local WT="$WT_BASE-${fx.id}"`);
    P(`  prepare_worktree ${shq(fx.id)} ${shq(fx.branch)} "$WT" || return 1`);
    P(`  event --type lane --lane ${shq(fx.id)} --state running --attempt "$(attempt ${shq(fx.id)})"`);
    P(`  : > "$LOG_DIR/${fx.id}.log"`);
    P('  (');
    P('    cd "$WT" || exit 9');
    fx.tasks.forEach((t, i) => {
      const cont = i < fx.tasks.length - 1 ? ' &&' : '';
      P(`    run_task ${shq(fx.id)} ${shq(t.id)} ${shq(taskPrompt(plan, t))} ${shq(t.model)} ${t.effortCli}${cont}`);
    });
    P(`  ) >> "$LOG_DIR/${fx.id}.log" 2>&1`);
    P('  local st=$?');
    P(`  merge_lane ${shq(fx.id)} ${shq(fx.branch)} "$WT" "$st" || return 1`);
    P(`  mark_done ${ids}`);
    P('  return 0');
    P('}');
  }

  // ── one function per sequential task ─────────────────────────────────────
  for (const t of plan.sequential) {
    P('');
    P(`# ── sequential ${t.id} (${(t.seqReason || 'tasks.md order').replace(/`/g, '')}) ──`);
    P(`run_seq_${fn(t.id)}() {`);
    P(`  info ${shq(`sequential ${t.id} — ${t.title}`)}`);
    P(`  if run_task seq ${shq(t.id)} ${shq(taskPrompt(plan, t))} ${shq(t.model)} ${t.effortCli} >> "$LOG_DIR/seq.log" 2>&1; then`);
    P('    # safety commit if the agent forgot (traceability > perfection)');
    P('    if [ -n "$(git status --porcelain)" ]; then');
    P(`      git add -A && git commit -q -m ${shq(`${t.id} ${plan.feature}: ${t.title} (plan auto-commit)`)}`);
    P('    fi');
    P(`    mark_done ${t.id}`);
    P(`    green "✔ ${t.id} done"`);
    P('    return 0');
    P('  fi');
    P(`  red "✘ ${t.id} failed (log: $LOG_DIR/seq.log)"`);
    P(`  yellow "  re-run only it: bash ${plan.baseDir}/run-tasks.sh --seq ${t.id}"`);
    P(`  FAILURES="$FAILURES ${t.id}"`);
    P('  return 1');
    P('}');
  }

  // ── gate ────────────────────────────────────────────────────────────────
  P('');
  P('# ── gate: the machine decides ────────────────────────────────────────');
  P('run_gate() {');
  P('  echo');
  P('  info "gate: verify + audit --ci"');
  P('  event --type gate --step start');
  P('  node "$ENGINE" verify "$FEATURE"');
  P('  local v=$?');
  P('  event --type gate --step verify --exit "$v"');
  P('  node "$ENGINE" audit --ci');
  P('  AUDIT=$?');
  P('  event --type gate --step audit --exit "$AUDIT"');
  P('  # closes the bookkeeping: task status + verify proof in git');
  P(`  if [ -n "$(git status --porcelain -- ${shq(plan.specDir)})" ]; then`);
  P(`    git add -A -- ${shq(plan.specDir)}`);
  P('    git commit -q -m "$FEATURE: task status + verify proof (plan)"');
  P('    info "task status and verify proof committed"');
  P('  fi');
  P('  return "$AUDIT"');
  P('}');
  P('');
  P('finish() { # $1=scope');
  P('  echo');
  P('  if [ -n "$FAILURES" ]; then red "lanes/tasks with failures:$FAILURES"; fi');
  P('  # without the gate there is no verdict: NEVER announce alignment without the audit');
  P('  if [ "$WITH_GATE" -eq 0 ]; then');
  P('    event --type end --exit 1 --scope "$1"');
  P('    if [ -z "$FAILURES" ]; then');
  P('      yellow "○ work on \'$1\' finished WITHOUT the gate (--no-gate) — this is NOT proof of anything"');
  P(`      yellow "  for the verdict: bash ${plan.baseDir}/run-tasks.sh --gate"`);
  P('      exit 0');
  P('    fi');
  P('    red "and there are still failures — fix them and run the gate"');
  P('    exit 1');
  P('  fi');
  P('  run_gate');
  P('  local audit=$?');
  P('  if [ "$audit" -eq 0 ] && [ -z "$FAILURES" ]; then');
  P('    event --type end --exit 0 --scope "$1"');
  P('    green "✔ plan done — specification and code aligned (audit exit 0) on branch $BASE_BRANCH"');
  P('    info "next step: review and take it to main whenever you want (git merge $BASE_BRANCH)"');
  P('    exit 0');
  P('  fi');
  P('  event --type end --exit 1 --scope "$1"');
  P('  red "plan finished with issues — read the audit output above and the logs in $LOG_DIR"');
  P('  yellow "hint: re-run only what failed (--lane <id> / --seq <T-xxx>)"');
  P('  exit 1');
  P('}');

  // ── mode: all ─────────────────────────────────────────────────────────────
  P('');
  P('run_all() {');
  P('  event --type start --scope all');
  P('  start_summaries');
  P('  info "logs in: $LOG_DIR"');
  P('  info "overall progress summary: every 1 min here in the terminal (and via: onp-spec summary)"');
  plan.waves.forEach((wave, oi) => {
    P(`  # wave ${oi + 1}: ${wave.map((fx) => fx.id).join(' ∥ ')}`);
    P(`  info "wave ${oi + 1}: ${wave.map((fx) => fx.id).join(' ∥ ')} — clean windows in parallel"`);
    for (const fx of wave) {
      P(`  run_${fn(fx.id)} & PID_${fn(fx.id).toUpperCase()}=$!`);
    }
    for (const fx of wave) {
      P(`  wait "$PID_${fn(fx.id).toUpperCase()}" || true`);
    }
  });
  for (const t of plan.sequential) P(`  run_seq_${fn(t.id)} || true`);
  P('  finish all');
  P('}');

  // ── dispatcher ──────────────────────────────────────────────────────────
  P('');
  P('list_lanes() {');
  P(`  echo "run: $RUN_ID (feature $FEATURE, branch $BASE_BRANCH)"`);
  plan.waves.forEach((wave, oi) => {
    for (const fx of wave) {
      P(`  echo "  ${fx.id}  wave ${oi + 1}  ${fx.tasks.map((t) => t.id).join(', ')}"`);
    }
  });
  for (const t of plan.sequential) P(`  echo "  seq       ${t.id} (sequential)"`);
  P('  echo');
  P('  echo "re-run one lane:      --lane <id>"');
  P('  echo "re-run sequential:    --seq <T-xxx>"');
  P('  echo "gate only:            --gate"');
  P('}');
  P('');
  P('MODE="all"');
  P('TARGET=""');
  P('while [ $# -gt 0 ]; do');
  P('  case "$1" in');
  P('    --list) MODE="list" ;;');
  P('    --gate) MODE="gate" ;;');
  P('    --no-gate) WITH_GATE=0 ;;');
  P('    --lane) MODE="lane"; TARGET="${2:-}"; shift ;;');
  P('    --seq) MODE="seq"; TARGET="${2:-}"; shift ;;');
  P('    -h|--help) sed -n "2,14p" "$0"; exit 0 ;;');
  P('    *) red "unknown argument: $1"; sed -n "2,14p" "$0"; exit 2 ;;');
  P('  esac');
  P('  shift');
  P('done');
  P('');
  P('if [ "$MODE" = "list" ]; then list_lanes; exit 0; fi');
  P('');
  P('prepare_env');
  P('');
  P('case "$MODE" in');
  P('  all) run_all ;;');
  P('  gate) WITH_GATE=1; start_summaries; finish gate ;;');
  P('  lane)');
  P('    case "$TARGET" in');
  for (const fx of plan.lanes) {
    P(`      ${fx.id}) event --type start --scope "lane:${fx.id}"; start_summaries; run_${fn(fx.id)} || true; finish "lane:${fx.id}" ;;`);
  }
  P('      *) fail "unknown lane: \'$TARGET\' — see the available ones with --list" ;;');
  P('    esac ;;');
  P('  seq)');
  P('    case "$TARGET" in');
  for (const t of plan.sequential) {
    P(`      ${t.id}) event --type start --scope "seq:${t.id}"; start_summaries; run_seq_${fn(t.id)} || true; finish "seq:${t.id}" ;;`);
  }
  P(`      *) fail "unknown sequential task: '$TARGET' — see the available ones with --list" ;;`);
  P('    esac ;;');
  P('esac');

  return `${L.join('\n')}\n`;
}
// ── artifact: plan-execution.html (claude/codex/cursor) ────────────────────

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderPlanHtml(plan) {
  const cmd = `bash ${plan.baseDir}/run-tasks.sh`;
  const parallel = plan.lanes.reduce((n, fx) => n + fx.tasks.length, 0);
  const sequential = plan.mode === 'sequential';
  const codexHtml = plan.agent === 'codex';
  const cursorHtml = plan.agent === 'cursor';
  const agentLabel = codexHtml ? 'Codex' : cursorHtml ? 'Cursor' : 'Claude Code';
  const cliLabel = codexHtml
    ? '<code>codex exec</code>'
    : cursorHtml
      ? '<code>agent -p</code> (Cursor CLI)'
      : '<code>claude -p</code>';
  const card = (t) => `
        <div class="task">
          <span class="tid">${esc(t.id)}</span>
          <span class="ttitle">${esc(t.title)}</span>
          <span class="meta"><code>${esc(t.model)}</code> · effort <b>${esc(t.effortCli)}</b></span>
          <span class="files">${t.files.map((f) => `<code>${esc(f)}</code>`).join(' ') || `<em>${esc((t.seqReason || 'no files — sequential').replace(/`/g, ''))}</em>`}</span>
        </div>`;
  const laneHtml = (fx) => `
      <div class="lane">
        <h4>${esc(fx.id)} <small>branch <code>${esc(fx.branch)}</code> · worktree <code>${esc(fx.worktree)}</code></small></h4>
        ${fx.tasks.map(card).join('')}
      </div>`;
  const wavesHtml = plan.waves
    .map(
      (wave, i) => `
    <section class="wave">
      <h3>Wave ${i + 1} <small>${wave.map((fx) => esc(fx.id)).join(' ∥ ')} — in parallel, clean windows</small></h3>
      <div class="grid">${wave.map(laneHtml).join('')}</div>
    </section>`
    )
    .join('');
  const seqHtml = plan.sequential.length
    ? `
    <section class="wave">
      <h3>${sequential ? 'Execution order <small>one task after another, on the main tree</small>' : 'Sequential <small>after the waves, on the main tree</small>'}</h3>
      <div class="grid"><div class="lane">${plan.sequential.map(card).join('')}</div></div>
    </section>`
    : '';
  const warningsHtml = plan.warnings.length
    ? `<div class="warnings">${plan.warnings.map((a) => `<div>⚠ ${esc(a)}</div>`).join('')}</div>`
    : '';

  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Execution plan — ${esc(plan.feature)}</title>
<style>
  :root { --bg:#fafafa; --fg:#1a1a1a; --card:#fff; --border:#e2e2e2; --sub:#666;
          --acc:#0a7c42; --acc-fg:#fff; --warn:#8a6d00; --warn-bg:#fff8e1; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#141414; --fg:#eaeaea; --card:#1e1e1e; --border:#333; --sub:#9a9a9a;
            --acc:#17a35c; --warn:#e0c36a; --warn-bg:#2a2410; }
  }
  * { box-sizing:border-box }
  body { margin:0; padding:2rem 1rem; background:var(--bg); color:var(--fg);
         font:15px/1.55 system-ui,-apple-system,sans-serif }
  main { max-width:64rem; margin:0 auto }
  h1 { font-size:1.5rem; margin:0 0 .25rem } h3 { margin:1.5rem 0 .5rem }
  h4 { margin:0 0 .5rem } small { color:var(--sub); font-weight:400 }
  .sub { color:var(--sub); margin:0 0 1.25rem }
  code { font:.85em ui-monospace,monospace; background:var(--card);
         border:1px solid var(--border); border-radius:4px; padding:.05em .35em; overflow-wrap:anywhere }
  .summary { display:flex; gap:.75rem; flex-wrap:wrap; margin:0 0 1rem }
  .summary div { background:var(--card); border:1px solid var(--border); border-radius:8px;
                padding:.5rem .9rem } .summary b { font-size:1.2rem }
  .executor { background:var(--card); border:1px solid var(--border); border-radius:10px;
              padding:1rem; margin:0 0 .5rem }
  .executor h2 { margin:0 0 .5rem; font-size:1.05rem }
  .note { color:var(--sub); font-size:.85rem; margin:.5rem 0 0 }
  #cmd { display:inline-block; margin-top:.6rem }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(17rem,1fr)); gap:.75rem }
  .lane { background:var(--card); border:1px solid var(--border); border-radius:10px; padding: .9rem }
  .task { display:flex; flex-direction:column; gap:.15rem; padding:.6rem 0;
            border-top:1px dashed var(--border) }
  .task:first-of-type { border-top:0 }
  .tid { font:700 .85rem ui-monospace,monospace; color:var(--acc) }
  .meta,.files { font-size:.85rem; color:var(--sub) }
  .warnings { background:var(--warn-bg); color:var(--warn); border-radius:8px;
            padding:.6rem .9rem; margin:0 0 1rem; font-size:.9rem }
  ol li { margin:.25rem 0 }
</style>
<main>
  <h1>Execution plan — ${esc(plan.feature)}</h1>
  <p class="sub">generated by <code>onp-spec plan</code> at ${esc(plan.generatedAt)} · regenerate after changing tasks.md</p>
  <div class="summary">
    ${
      sequential
        ? `<div><b>${plan.sequential.length}</b> task(s), one after another</div>
    <div><b>sequential</b> mode (user choice)</div>`
        : `<div><b>${parallel}</b> task(s) in parallel</div>
    <div><b>${plan.lanes.length}</b> lane(s) · <b>${plan.waves.length}</b> wave(s)</div>
    <div><b>${plan.sequential.length}</b> sequential</div>${
      plan.parallelize ? `\n    <div>user selection: <b>${plan.parallelize.map(esc).join(', ')}</b></div>` : ''
    }`
    }
    <div>branch <code>${esc(plan.workBranch)}</code></div>
  </div>
  ${warningsHtml}
  <div class="executor">
    <h2>How to execute — via agent</h2>
    <p>Ask the agent (${agentLabel}) to execute the plan. It runs:</p>
    <div><code id="cmd">${esc(cmd)}</code></div>
    <p class="note">This file is view-only. ${
      sequential
        ? `Each task runs ${cliLabel} on the main tree, one after another, with a clean context and model/effort already set.`
        : `Each lane runs ${cliLabel} in its own worktree, with a clean context, model and effort already set.`
    }
    The final gate (verify + audit) runs on its own; the run stays in the background and, every
    1 minute, the agent posts in chat the <b>progress table</b>
    (<code>onp-spec summary ${esc(plan.feature)} --table</code>) and the
    <b>overall progress summary</b> (<code>onp-spec summary ${esc(plan.feature)}</code>).</p>
  </div>
  ${wavesHtml}
  ${seqHtml}
  <section class="wave">
    <h3>Branches and commits</h3>
    <ol>
      <li>everything starts from the work branch <code>${esc(plan.workBranch)}</code></li>
      ${
        sequential
          ? `<li>the tasks run on it, in order; 1 task = 1 commit <code>T-xxx ${esc(plan.feature)}: title</code></li>`
          : `<li>1 lane = 1 branch + 1 worktree; 1 task = 1 commit <code>T-xxx ${esc(plan.feature)}: title</code></li>
      <li>merge <code>--no-ff</code> per lane, in order; a conflict stops and asks for you</li>`
      }
      <li>final gate: <code>onp-spec verify ${esc(plan.feature)}</code> + <code>onp-spec audit --ci</code> — exit 0 or it is not ready</li>
    </ol>
  </section>
</main>
`;
}
