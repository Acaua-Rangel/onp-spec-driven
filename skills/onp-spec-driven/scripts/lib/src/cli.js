// onp-spec CLI — command dispatch.

import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, chmodSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildPlan,
  renderPlanMd,
  renderPlanSh,
  renderPlanHtml,
  renderPlanJson,
  usesShExecutor,
  normalizeEffort,
  AGENTS,
} from './core/plan.js';
import { recordEvent, pruneLedger, readStream, readEvents, buildTree } from './core/ledger.js';
import {
  deterministicSummary,
  contextForAi,
  buildCurrentSummary,
  recordSummary,
  targetRun,
  progressTable,
} from './core/summary.js';
import { TASK_STATUSES } from './parsers/tasks.js';
import { DASH, foldStatus } from './util/text.js';
import { loadConfig, DEFAULT_CONFIG } from './config.js';
import { loadProject } from './core/project.js';
import { auditProject } from './core/audit.js';
import { renderTerminal, renderJson, renderMarkdown } from './core/report.js';
import { runVerifyBatch, gitRev } from './core/verify.js';
import { scaffoldTests } from './core/scaffold.js';
import { MEMORY_FILE_BY_AGENT, renderAgentMemory } from './core/memory.js';
import { allAcs } from './parsers/spec.js';
import { loadSignals, recordFindings, recordVerify } from './core/signals.js';
import {
  loadLessons,
  saveLessons,
  addLesson,
  listLessons,
  penalizeLesson,
  pruneLessons,
  suggestLessons,
  LESSONS_DEFAULTS,
} from './core/lessons.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

// Where the skill lives: repo layout (skills/onp-spec-driven) or embedded
// layout (this file at <skill>/scripts/lib/src → the skill is ../../..).
// The embedded fallback only counts if the SKILL.md found is FOR the requested
// agent (the `agent:` marker in the frontmatter) — otherwise we would install
// the wrong skill while announcing success.
function skillAgentMarker(dir) {
  try {
    const content = readFileSync(path.join(dir, 'SKILL.md'), 'utf-8');
    const frontmatter = content.split(/^---\s*$/m)[1] || '';
    const m = frontmatter.match(/^\s*agent:\s*(\S+)/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const SKILL_DIR_BY_AGENT = {
  claude: 'onp-spec-driven',
  antigravity: 'onp-spec-driven-antigravity',
  codex: 'onp-spec-driven-codex',
  cursor: 'onp-spec-driven-cursor',
  copilot: 'onp-spec-driven-copilot',
  gemini: 'onp-spec-driven-gemini',
};

// the skills directory each agent reads INSIDE the project (the installed skill
// folder is always named onp-spec-driven — in Cursor the frontmatter `name:`
// MUST match the folder name)
const SKILLS_DIR_PROJECT = {
  claude: '.claude',
  antigravity: '.agents',
  codex: '.agents',
  cursor: '.cursor',
  copilot: '.github',
  gemini: '.gemini',
};

export function resolveSkillDir(agent = 'claude') {
  const dirName = SKILL_DIR_BY_AGENT[agent] || 'onp-spec-driven';
  const candidates = [
    path.join(__dirname, '..', 'skills', dirName),
    path.join(__dirname, '..', '..', '..'),
  ];
  for (const dir of candidates) {
    if (!existsSync(path.join(dir, 'SKILL.md'))) continue;
    const marker = skillAgentMarker(dir);
    if (marker && marker !== agent) continue; // skill of another agent — no good
    return dir;
  }
  return null;
}

const HELP = `onp-spec — spec-anchored development (the specification that stays true)

usage: onp-spec <command> [options]

commands:
  init [--preset base|lgpd-education] [--agents claude|antigravity|codex|cursor|copilot|gemini]
                      creates .spec/, constitution and config in the current directory
                      (--agents also installs the skill for the chosen agent
                      and writes the agent's memory file: CLAUDE.md, AGENTS.md,
                      .cursorrules, etc.)
  new <feature-name>  creates .spec/features/<feature-name>/{spec.md,tasks.md}
  plan <feature> [--agents claude|antigravity|codex|cursor|copilot|gemini]
                 [--parallelize T-xxx,T-yyy] [--sequential]
                 [--model <model>] [--effort low|medium|high|xhigh|max]
                 [--tasks T-xxx,T-yyy]
                      generates the PARALLEL EXECUTION PLAN across worktrees +
                      execution artifacts for the chosen agent. Cost is
                      the USER's choice (the agent asks before executing).
                      · always: plan-execution.md (lanes/order, branches,
                        commits) + plan.json
                      · claude: run-tasks.sh (headless claude -p with
                        --model/--effort per task and a progress summary every
                      1 min in the terminal) + plan-execution.html (visual)
                      · codex: run-tasks.sh (headless codex exec with
                        --json, sandbox and --model/model_reasoning_effort per
                        task) + plan-execution.html (visual)
                      · cursor: run-tasks.sh (headless Cursor CLI:
                        agent -p with --model per task, stream-json and
                        --force; effort goes in the model slug) +
                        plan-execution.html (visual)
                      · antigravity/copilot/gemini: ready prompts for the native
                        agents (depend on no CLI)
                      Cost is the USER's choice: --model/--effort lock the
                      model and effort of ALL tasks (override tasks.md and
                      config) — the agent confirms models/efforts with the
                      user BEFORE executing
  summary [feature] [--table] [--global] [--run <runId>]
         [--save [--text "..."] [--source ai|engine]]
                      the OVERALL PROGRESS SUMMARY in text: what is running
                      now, what finished, what failed. It is the text the
                      agent posts in chat every ~1 min while a run is going.
                      --table prints the progress TABLE in markdown (one row
                      per task: where it runs, status and last action) — ready
                      to paste in chat with the text. --save records it in the
                      ledger (with --text, the AI/agent is writing; without,
                      the engine's counts).
  task <feature> <T-xxx> [status] [--model <model>] [--effort <level>]
                      updates the task in tasks.md: status (pending |
                      in-progress | done) and/or its cost (--model and
                      --effort set Model:/Effort: — regenerate the plan
                      afterwards)
  audit [--ci] [--json] [--md <file>]
                      audits specification ↔ tasks ↔ tests ↔ code ↔ constitution
                      exit 1 on error (use in CI)
  verify <feature...> | --all
                      runs the tests and records the proof of each acceptance
                      criterion (the test runner decides). Only the test files
                      tagged with the feature's @spec run when the runner
                      supports it (testFileArgs); several features / --all
                      share ONE test run
  scaffold <feature> [--force]
                      generates a (failing) test skeleton for each acceptance
                      criterion that still has no test
  status              overview: features, proven criteria, open assumptions
                      and questions
  assumptions         lists all assumptions and questions with their status
  lessons <add|list|suggest|penalize|status>
                      GROUNDED lessons learned: a lesson only enters if it is
                      anchored to a real signal from audit/verify; mechanical
                      promotion when it recurs across distinct features
                      (details: onp-spec lessons)
  help                this help

typical flow:
  onp-spec init --preset lgpd-education
  onp-spec new homework-delivery      # write stories, criteria, assumptions and questions
  onp-spec scaffold homework-delivery # each criterion becomes a failing test
  onp-spec plan homework-delivery     # tasks in parallel lanes + execution artifacts
  ... execute the plan (or implement by hand) until the tests pass ...
  onp-spec verify homework-delivery   # the test runner records the proof
  onp-spec audit --ci                 # 0 = specification and code aligned`;

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function template(name) {
  return readFileSync(path.join(TEMPLATES_DIR, name), 'utf-8');
}

function fill(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

export function cmdInit(rootDir, flags, { resolveSkill = resolveSkillDir } = {}) {
  const preset = flags.preset || 'base';
  const presetFile = `constitution-${preset}.md`;
  if (!existsSync(path.join(TEMPLATES_DIR, presetFile))) {
    console.error(`unknown preset: ${preset} (use: base, lgpd-education)`);
    return 2;
  }

  const specRoot = path.join(rootDir, '.spec');
  mkdirSync(path.join(specRoot, 'features'), { recursive: true });
  mkdirSync(path.join(specRoot, 'verification'), { recursive: true });

  const constitutionPath = path.join(specRoot, 'constitution.md');
  if (existsSync(constitutionPath)) {
    console.log('· .spec/constitution.md already exists — kept');
  } else {
    writeFileSync(constitutionPath, template(presetFile));
    console.log(`✔ .spec/constitution.md created (preset: ${preset})`);
  }

  const configPath = path.join(rootDir, 'onpspec.config.json');
  if (existsSync(configPath)) {
    console.log('· onpspec.config.json already exists — kept');
  } else {
    const cfg = {
      testCommand: 'node --test',
      reporter: 'tap',
      testGlobs: DEFAULT_CONFIG.testGlobs,
      srcGlobs: DEFAULT_CONFIG.srcGlobs,
    };
    writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`);
    console.log('✔ onpspec.config.json created (testCommand: "node --test" — adjust to your stack)');
  }

  const gitignorePath = path.join(specRoot, 'verification', '.gitkeep');
  if (!existsSync(gitignorePath)) writeFileSync(gitignorePath, '');

  if (flags.agents !== undefined) {
    const agent = flags.agents === true ? 'claude' : flags.agents;
    if (!AGENTS.includes(agent)) {
      console.error(`unknown --agents: "${flags.agents}" (use: ${AGENTS.join(', ')})`);
      return 2;
    }
    const label = { claude: 'Claude Code', antigravity: 'Antigravity', codex: 'Codex', cursor: 'Cursor', copilot: 'GitHub Copilot', gemini: 'Gemini' }[agent];
    // Each agent reads its skills directory in the project (.claude, .cursor,
    // .github). Codex and Antigravity read the SAME (.agents/skills
    // — the cross-agent standard Codex adopts). The `agent:` marker in the
    // frontmatter says which agent the installed skill belongs to.
    const destRel = path.join(SKILLS_DIR_PROJECT[agent], 'skills', 'onp-spec-driven');
    const dest = path.join(rootDir, destRel);
    const skillDir = resolveSkill(agent);
    const existingMarker = skillAgentMarker(dest);
    if (existingMarker && existingMarker !== agent) {
      const note =
        SKILLS_DIR_PROJECT[agent] === '.agents' ? ' — Codex and Antigravity share this directory.' : '.';
      console.error(
        `✘ ${destRel} already contains the skill of agent "${existingMarker}"${note}\n` +
          `  To switch agents, remove the folder first: rm -rf ${destRel}`
      );
      return 2;
    }
    if (!skillDir) {
      console.log(
        `· skill for ${label} not found next to this engine — install with: npx @onovoprogramador/onp-spec init --agents ${agent}`
      );
    } else if (path.resolve(dest) === path.resolve(skillDir)) {
      console.log(`· skill already installed at ${destRel} — kept`);
    } else {
      copyDirIfExists(skillDir, dest);
      console.log(`✔ skill installed at ${destRel} (${label})`);
    }
    // Cursor reads .cursor/skills AND .agents/skills natively (and .claude/
    // .codex for compatibility) — two variants in the same project = two
    // skills with the SAME name, and Cursor may load the wrong one
    if (agent === 'cursor') {
      for (const otherDir of ['.claude', '.agents']) {
        const otherMarker = skillAgentMarker(path.join(rootDir, otherDir, 'skills', 'onp-spec-driven'));
        if (otherMarker && otherMarker !== 'cursor') {
          console.log(
            `⚠ this project also has the skill of agent "${otherMarker}" at ${otherDir}/skills/onp-spec-driven — Cursor reads that directory too and may load the wrong skill.\n` +
              `  If this is a Cursor project, remove the other: rm -rf ${otherDir}/skills/onp-spec-driven`
          );
        }
      }
    }

    // memory/instructions file: the always-loaded reminder that this project
    // is spec-anchored (never overwrite an existing one — it may hold the
    // user's own project rules)
    const memoryRel = MEMORY_FILE_BY_AGENT[agent];
    if (memoryRel) {
      const memoryPath = path.join(rootDir, memoryRel);
      if (existsSync(memoryPath)) {
        console.log(`· ${memoryRel} already exists — kept (add the spec-driven flow to it if missing)`);
      } else {
        mkdirSync(path.dirname(memoryPath), { recursive: true });
        const enginePath = `${SKILLS_DIR_PROJECT[agent]}/skills/onp-spec-driven/scripts/onp-spec.mjs`;
        writeFileSync(memoryPath, renderAgentMemory(agent, { label, enginePath }));
        console.log(`✔ ${memoryRel} created (${label} reads it on every conversation)`);
      }
    }
  }

  console.log('\nnext step: ask your agent to specify the first feature — it runs the');
  console.log('engine for you. To run it yourself (onp-spec is NOT a global command):');
  console.log(`  ${engineCmd(rootDir)} new <feature-name>`);
  return 0;
}

function copyDirIfExists(src, dest) {
  if (!existsSync(src)) return;
  cpSync(src, dest, { recursive: true });
}

// The embedded engine is NOT a global `onp-spec` binary — it runs via
// `node <skill>/scripts/onp-spec.mjs`. Returns the runnable command for THIS
// project (the installed skill path) so the printed hints are copy-paste ready.
export function engineCmd(rootDir) {
  for (const dir of Object.values(SKILLS_DIR_PROJECT)) {
    const entry = path.join(rootDir, dir, 'skills', 'onp-spec-driven', 'scripts', 'onp-spec.mjs');
    if (existsSync(entry)) return `node ${path.relative(rootDir, entry).split(path.sep).join('/')}`;
  }
  const self = process.argv[1];
  if (self && self.endsWith('.mjs')) return `node ${path.relative(rootDir, self).split(path.sep).join('/')}`;
  return 'onp-spec';
}

function cmdNew(rootDir, name, flags) {
  if (!name) {
    console.error('usage: onp-spec new <feature-name> (kebab-case, e.g. homework-delivery)');
    return 2;
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    console.error(`invalid name: "${name}" — use kebab-case (lowercase letters, digits and hyphen)`);
    return 2;
  }
  const dir = path.join(rootDir, '.spec', 'features', name);
  if (existsSync(path.join(dir, 'spec.md'))) {
    console.error(`feature "${name}" already exists in .spec/features/${name}/`);
    return 2;
  }
  mkdirSync(dir, { recursive: true });

  // globally unique IDs: continue numbering from the largest existing ID
  const config = loadConfig(rootDir);
  const project = loadProject(config);
  let maxUs = 0;
  let maxAc = 0;
  for (const feature of project.features) {
    if (!feature.spec) continue;
    for (const s of feature.spec.stories) {
      maxUs = Math.max(maxUs, parseInt(s.id.slice(3), 10));
      for (const ac of s.acs) maxAc = Math.max(maxAc, parseInt(ac.id.slice(3), 10));
    }
  }
  const pad = (n) => String(n).padStart(3, '0');
  const title = name
    .split('-')
    .map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');

  let spec = template('spec.md');
  spec = fill(spec, { TITLE: title, FEATURE: name, STORY_TITLE: '[story title]' });
  spec = spec.replace('US-001', `US-${pad(maxUs + 1)}`).replace('AC-001', `AC-${pad(maxAc + 1)}`);
  writeFileSync(path.join(dir, 'spec.md'), spec);

  let tasks = template('tasks.md');
  tasks = fill(tasks, { TITLE: title, FEATURE: name });
  tasks = tasks
    .replace('US-001, AC-001', `US-${pad(maxUs + 1)}, AC-${pad(maxAc + 1)}`);
  writeFileSync(path.join(dir, 'tasks.md'), tasks);

  console.log(`✔ .spec/features/${name}/spec.md`);
  console.log(`✔ .spec/features/${name}/tasks.md`);
  const cmd = engineCmd(rootDir);
  console.log(`\nnext steps:`);
  console.log(`  1. write the user stories and the acceptance criteria (Given/When/Then)`);
  console.log(`     and FILL IN the Assumptions and Open questions sections`);
  console.log(`  2. ${cmd} scaffold ${name}   # each criterion becomes an executable test`);
  console.log(`  3. ${cmd} audit              # see what is missing`);
  console.log(`  4. ${cmd} plan ${name}       # with the tasks written: parallel execution plan`);
  return 0;
}

// Detects which agent to generate the plan artifacts for: an explicit flag
// wins; otherwise, the `agent:` marker of the embedded skill itself is the
// source of truth (Codex and Antigravity share .agents/, so the path alone is
// not enough); otherwise, the engine path; otherwise, whatever is installed in
// the project; default: claude.
function detectAgent(rootDir, flag) {
  if (flag !== undefined && flag !== true) {
    if (!AGENTS.includes(flag)) return { error: `unknown --agents: "${flag}" (use: ${AGENTS.join(', ')})` };
    return { agent: flag };
  }
  // embedded engine: this file lives at <skill>/scripts/lib/src
  const ownMarker = skillAgentMarker(path.join(__dirname, '..', '..', '..'));
  if (AGENTS.includes(ownMarker)) return { agent: ownMarker };
  const segments = __dirname.split(path.sep);
  if (segments.includes('.codex')) return { agent: 'codex' };
  // only .cursor/skills counts: ~/.cursor/worktrees/<repo> is a common checkout
  // of Cursor's parallel agents, not a skill installation
  const iCursor = segments.indexOf('.cursor');
  if (iCursor !== -1 && segments[iCursor + 1] === 'skills') return { agent: 'cursor' };
  if (segments.includes('.github')) return { agent: 'copilot' };
  if (segments.includes('.gemini')) return { agent: 'gemini' };
  if (segments.includes('.agents')) return { agent: 'antigravity' };
  if (segments.includes('.claude')) return { agent: 'claude' };
  const hasClaude = existsSync(path.join(rootDir, '.claude', 'skills', 'onp-spec-driven'));
  const projectMarker = skillAgentMarker(path.join(rootDir, '.agents', 'skills', 'onp-spec-driven'));
  if (AGENTS.includes(projectMarker) && !hasClaude) return { agent: projectMarker };
  const cursorMarker = skillAgentMarker(path.join(rootDir, '.cursor', 'skills', 'onp-spec-driven'));
  if (AGENTS.includes(cursorMarker) && !hasClaude) return { agent: cursorMarker };
  const copilotMarker = skillAgentMarker(path.join(rootDir, '.github', 'skills', 'onp-spec-driven'));
  if (AGENTS.includes(copilotMarker) && !hasClaude) return { agent: copilotMarker };
  const geminiMarker = skillAgentMarker(path.join(rootDir, '.gemini', 'skills', 'onp-spec-driven'));
  if (AGENTS.includes(geminiMarker) && !hasClaude) return { agent: geminiMarker };
  const hasAgents = existsSync(path.join(rootDir, '.agents', 'skills', 'onp-spec-driven'));
  if (hasAgents && !hasClaude) return { agent: 'antigravity' };
  return { agent: 'claude' };
}

function generatePlanArtifacts(project, featureName, agent, { sequential = false, parallelize, model, effort } = {}) {
  const plan = buildPlan(project, featureName, {
    agent,
    sequential,
    parallelize,
    model,
    effort,
    enginePath: process.argv[1],
  });
  if (plan.error) return plan;
  const dir = path.join(project.config.rootDir, plan.baseDir);
  writeFileSync(path.join(dir, 'plan-execution.md'), renderPlanMd(plan));
  const planJson = renderPlanJson(plan);
  writeFileSync(path.join(dir, 'plan.json'), planJson);
  const generated = [`${plan.baseDir}/plan-execution.md`, `${plan.baseDir}/plan.json`];
  if (usesShExecutor(plan.agent)) {
    const sh = path.join(dir, 'run-tasks.sh');
    writeFileSync(sh, renderPlanSh(plan));
    chmodSync(sh, 0o755);
    writeFileSync(path.join(dir, 'plan-execution.html'), renderPlanHtml(plan));
    generated.push(`${plan.baseDir}/run-tasks.sh`, `${plan.baseDir}/plan-execution.html`);
  }
  // records the run in the GLOBAL ledger: this is how `onp-spec summary` sees
  // this project alongside the others, even before any execution
  recordEvent({
    type: 'plan',
    runId: plan.runId,
    project: plan.repoName,
    projectDir: project.config.rootDir,
    feature: plan.feature,
    agent: plan.agent,
    plan: JSON.parse(planJson),
  });
  pruneLedger();
  plan.generated = generated;
  return plan;
}

// `onp-spec event` — used by run-tasks.sh to feed the global ledger.
// Internal: does not appear in the main help.
function cmdEvent(flags) {
  if (!flags.run || !flags.type) {
    console.error('internal usage: onp-spec event --run <runId> --type <plan|start|lane|task|gate|end> [...]');
    return 2;
  }
  const num = (v) => (v === undefined || v === true ? undefined : parseInt(v, 10));
  recordEvent({
    runId: flags.run,
    type: flags.type,
    lane: typeof flags.lane === 'string' ? flags.lane : undefined,
    task: typeof flags.task === 'string' ? flags.task : undefined,
    state: typeof flags.state === 'string' ? flags.state : undefined,
    step: typeof flags.step === 'string' ? flags.step : undefined,
    stream: typeof flags.stream === 'string' ? flags.stream : undefined,
    scope: typeof flags.scope === 'string' ? flags.scope : undefined,
    exit: num(flags.exit),
    attempt: num(flags.attempt),
  });
  return 0;
}

// `onp-spec stream-summary <runId> <key>` — one readable line in the terminal
// from the NDJSON stream (the full stream stays in the ledger for diagnostics)
function cmdStreamSummary(positional) {
  const [runId, key] = positional;
  if (!runId || !key) {
    console.error('internal usage: onp-spec stream-summary <runId> <key>');
    return 2;
  }
  const { items, summary, exists } = readStream(runId, key);
  if (!exists) {
    console.log(`  (no stream recorded for ${key})`);
    return 0;
  }
  const tools = items.filter((i) => i.type === 'tool');
  const count = {};
  for (const f of tools) count[f.name] = (count[f.name] || 0) + 1;
  const used = Object.entries(count)
    .map(([n, c]) => (c > 1 ? `${n}×${c}` : n))
    .join(', ');
  const parts = [];
  if (summary) {
    parts.push(summary.status);
    if (summary.turns != null) parts.push(`${summary.turns} turn(s)`);
    if (summary.durationMs != null) parts.push(`${(summary.durationMs / 1000).toFixed(1)}s`);
    if (summary.costUsd != null) parts.push(`US$ ${summary.costUsd.toFixed(4)}`);
  }
  console.log(`  ↳ ${key}: ${parts.join(' · ') || 'in progress'}${used ? ` · tools: ${used}` : ''}`);
  return 0;
}

function cmdPlan(project, positional, flags) {
  const featureName = positional[0];
  if (!featureName) {
    console.error('usage: onp-spec plan <feature> [--agents claude|antigravity|codex|cursor|copilot|gemini] [--parallelize T-xxx,T-yyy] [--sequential]');
    return 2;
  }
  const det = detectAgent(project.config.rootDir, flags.agents);
  if (det.error) {
    console.error(det.error);
    return 2;
  }
  if (flags.sequential && flags.parallelize) {
    console.error('error: use --parallelize OR --sequential — the two together make no sense');
    return 2;
  }
  if (det.agent === 'cursor' && typeof flags.effort === 'string') {
    console.log(
      '⚠ the Cursor CLI has no effort flag — the value is recorded in the plan, but the level goes in the model slug (e.g. gpt-5.6-terra-high)'
    );
  }
  if (flags.model === true) {
    console.error('error: --model needs a value (e.g. --model gpt-5.6-luna)');
    return 2;
  }
  if (flags.effort === true) {
    console.error('error: --effort needs a value (low|medium|high|xhigh|max)');
    return 2;
  }
  const parallelize =
    flags.parallelize === undefined
      ? undefined
      : flags.parallelize === true
        ? []
        : String(flags.parallelize)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
  const plan = generatePlanArtifacts(project, featureName, det.agent, {
    sequential: Boolean(flags.sequential),
    parallelize,
    model: typeof flags.model === 'string' ? flags.model : undefined,
    effort: typeof flags.effort === 'string' ? flags.effort : undefined,
  });
  if (plan.error) {
    console.error(`error: ${plan.error}`);
    return 2;
  }

  const parallel = plan.lanes.reduce((n, fx) => n + fx.tasks.length, 0);
  if (plan.mode === 'sequential') {
    console.log(
      `✔ execution plan (${det.agent}, SEQUENTIAL — user choice): ` +
        `${plan.sequential.length} task(s), one after another, on the main tree`
    );
  } else {
    console.log(
      `✔ execution plan (${det.agent}): ${parallel + plan.sequential.length} task(s) — ` +
        `${parallel} CAN RUN IN PARALLEL across ${plan.lanes.length} lane(s) · ${plan.sequential.length} sequential · ${plan.waves.length} wave(s)`
    );
    if (plan.parallelize) {
      console.log(`  (user selection: ${plan.parallelize.join(', ')} in parallel; the rest run one after another at the end)`);
    } else {
      console.log(
        '  (want the user to choose? regenerate with: onp-spec plan ' +
          featureName +
          ' --parallelize T-xxx,T-yyy — or --sequential for one after another)'
      );
    }
  }
  console.log('\nwhere everything is:');
  console.log(`  · plan (read first): ${plan.generated[0]}`);
  if (usesShExecutor(plan.agent)) {
    console.log(`  · headless executor: ${plan.baseDir}/run-tasks.sh`);
    console.log(`  · visual (read):     ${plan.baseDir}/plan-execution.html`);
  }
  for (const a of plan.warnings) console.log(`  ⚠ ${a}`);
  // cost is the user's: in codex and cursor, the agent presents the model (and
  // effort, when the CLI accepts it) per task and CONFIRMS before executing
  // (a cheap license burns tokens easily)
  if (det.agent === 'codex') {
    console.log('\nmodels and efforts of this plan — CONFIRM with the user before executing (the tokens are theirs):');
    const all = [...plan.lanes.flatMap((fx) => fx.tasks), ...plan.sequential];
    for (const t of all) console.log(`  · ${t.id} — ${t.model} · effort ${t.effortCli}`);
    console.log(
      `  want to spend less? everything: onp-spec plan ${featureName} --model gpt-5.6-luna --effort low` +
        `\n  per task: onp-spec task ${featureName} T-xxx --model <m> --effort <level> (and regenerate the plan)`
    );
  }
  if (det.agent === 'cursor') {
    console.log('\nmodels of this plan — CONFIRM with the user before executing (the tokens are theirs):');
    const all = [...plan.lanes.flatMap((fx) => fx.tasks), ...plan.sequential];
    for (const t of all) console.log(`  · ${t.id} — ${t.model}`);
    console.log(
      '  (effort in Cursor goes embedded in the model slug, e.g. gpt-5.6-terra-high — there is no flag)' +
        `\n  want to spend less? everything: onp-spec plan ${featureName} --model composer (usage included in the paid Cursor plans)` +
        `\n  per task: onp-spec task ${featureName} T-xxx --model <m> (and regenerate the plan)`
    );
  }
  console.log('\nnext step:');
  if (usesShExecutor(plan.agent)) {
    console.log(`  · execute: bash ${plan.baseDir}/run-tasks.sh`);
    console.log('    (while it runs, the overall progress summary comes out every 1 min — relay it to the user)');
  } else {
    console.log(`  · open a new agent (clean window) per lane and paste the matching prompt`);
    console.log(`    from plan-execution.md — then merge + verify + audit, as described there`);
  }
  return 0;
}

// `onp-spec summary` — the OVERALL PROGRESS SUMMARY. It is the text the agent
// posts in chat every ~1 minute while a run is going. Without flags, it prints
// (fresh AI from the ledger > deterministic engine); with --save, it records in
// the ledger (--text = written by the executor's AI/agent).
function cmdSummary(config, positional, flags) {
  const feature = positional[0] || null;
  const filter = flags.global ? {} : { projectDir: config.rootDir, feature };
  const projects = buildTree(readEvents(), filter);

  if (flags.context) {
    console.log(contextForAi(projects));
    return 0;
  }

  // the progress TABLE (markdown) — the agent pastes it in chat every ~1 min
  if (flags.table) {
    console.log(progressTable(projects));
    return 0;
  }

  if (flags.save) {
    const target = targetRun(projects, { runId: typeof flags.run === 'string' ? flags.run : null });
    if (!target) {
      console.error('no run in the ledger to save the summary — generate a plan first (onp-spec plan <feature>)');
      return 2;
    }
    const hasText = typeof flags.text === 'string';
    const text = hasText ? flags.text : deterministicSummary(projects);
    const source = hasText ? (flags.source === 'engine' ? 'engine' : 'ai') : 'engine';
    const r = recordSummary({ runId: target.runId, text, source });
    if (r.error) {
      console.error(`error: ${r.error}`);
      return 2;
    }
    console.log(`✔ summary saved (source: ${r.source}) for "${target.feature}"`);
    console.log(r.text);
    return 0;
  }

  console.log(buildCurrentSummary(projects).text);
  return 0;
}

// inserts or replaces a list field (- Model:/- Effort:) inside the task's
// section in tasks.md — in the SAME format the parser reads; this is how the
// user adjusts per-task cost without editing the file by hand
function setTaskField(lines, taskId, matcher, label, value) {
  const reTitle = new RegExp(`^##\\s+${taskId}\\s*${DASH}\\s*`);
  const start = lines.findIndex((l) => reTitle.test(l));
  if (start === -1) return false;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const reField = new RegExp(`^\\s*[-*]\\s*${matcher}\\s*:`, 'i');
  for (let i = start + 1; i < end; i++) {
    if (reField.test(lines[i])) {
      lines[i] = `- ${label}: ${value}`;
      return true;
    }
  }
  // field does not exist yet: goes after the last list line of the section
  let pos = start;
  for (let i = start + 1; i < end; i++) {
    if (/^\s*[-*]\s/.test(lines[i])) pos = i;
  }
  if (pos === start) lines.splice(start + 1, 0, '', `- ${label}: ${value}`);
  else lines.splice(pos + 1, 0, `- ${label}: ${value}`);
  return true;
}

function cmdTask(config, positional, flags = {}) {
  const [featureName, taskId, statusRaw] = positional;
  const model = typeof flags.model === 'string' ? flags.model : null;
  const effortRaw = typeof flags.effort === 'string' ? flags.effort : null;
  const USAGE =
    'usage: onp-spec task <feature> <T-xxx> [pending|in-progress|done] [--model <model>] [--effort low|medium|high|xhigh|max]';
  if (!featureName || !taskId || (!statusRaw && !model && !effortRaw) || flags.model === true || flags.effort === true) {
    console.error(USAGE);
    return 2;
  }
  let status = null;
  if (statusRaw) {
    status = foldStatus(statusRaw);
    if (!TASK_STATUSES.includes(status)) {
      console.error(`invalid status: "${statusRaw}" (use: ${TASK_STATUSES.join(', ')})`);
      return 2;
    }
  }
  if (effortRaw && !normalizeEffort(effortRaw)) {
    console.error(`invalid effort: "${effortRaw}" (use: low|medium|high|xhigh|max)`);
    return 2;
  }
  const tasksPath = path.join(config.rootDir, config.specDir, 'features', featureName, 'tasks.md');
  if (!existsSync(tasksPath)) {
    console.error(`could not find ${config.specDir}/features/${featureName}/tasks.md`);
    return 2;
  }
  let content = readFileSync(tasksPath, 'utf-8');
  const re = new RegExp(`^(##\\s+${taskId}\\s*${DASH}\\s*.*?)(\\s*\\[[^\\]]+\\])?\\s*$`, 'm');
  if (!re.test(content)) {
    console.error(`task ${taskId} not found in ${config.specDir}/features/${featureName}/tasks.md`);
    return 2;
  }
  const changes = [];
  if (status) {
    content = content.replace(re, `$1 [${status}]`);
    changes.push(`→ [${status}]`);
  }
  if (model || effortRaw) {
    const lines = content.split('\n');
    if (model) {
      setTaskField(lines, taskId, 'Model', 'Model', model);
      changes.push(`Model: ${model}`);
    }
    if (effortRaw) {
      setTaskField(lines, taskId, 'Effort', 'Effort', effortRaw);
      changes.push(`Effort: ${effortRaw}`);
    }
    content = lines.join('\n');
  }
  writeFileSync(tasksPath, content);
  console.log(`✔ ${taskId} ${changes.join(' · ')} in ${config.specDir}/features/${featureName}/tasks.md`);
  if (model || effortRaw) {
    console.log(`· model/effort changed — regenerate the plan: onp-spec plan ${featureName}`);
  }
  return 0;
}

function cmdStatus(project) {
  if (project.errors.length) {
    for (const e of project.errors) console.error(`error: ${e}`);
    return 2;
  }
  const testFileSet = new Set(project.testFiles);
  const provenTags = project.annotations.specTags.filter((t) => testFileSet.has(t.file));

  const cols = ['criteria', 'with-test', 'proven', 'assumptions?', 'questions?'];
  const header =
    'feature'.padEnd(30) + ' ' + 'status'.padEnd(18) + cols.map((c) => ` ${c}`).join('');
  console.log(header);
  console.log('─'.repeat(header.length));
  for (const feature of project.features) {
    const spec = feature.spec;
    if (!spec) {
      console.log(`${feature.name.padEnd(30)} NO SPEC`);
      continue;
    }
    const acs = allAcs(spec);
    const withTest = acs.filter((ac) => provenTags.some((t) => t.acId === ac.id)).length;
    const v = project.verifications[feature.name];
    const proven = acs.filter((ac) => v?.results?.[ac.id]?.status === 'pass').length;
    const asmOpen = spec.assumptions.filter((a) => a.status === 'open').length;
    const qOpen = spec.questions.filter((q) => q.status === 'open').length;
    const vals = [acs.length, withTest, proven, asmOpen, qOpen];
    console.log(
      `${feature.name.padEnd(30)} ${(spec.status || '—').padEnd(18)}` +
        vals.map((v, i) => ` ${String(v).padStart(cols[i].length)}`).join('')
    );
  }
  console.log(
    '\nlegend: criteria = acceptance criteria · with-test = have an annotated test (@spec:) ·' +
      '\n        proven = PASS in the last verify · assumptions?/questions? = still open'
  );
  return 0;
}

function cmdAssumptions(project) {
  let any = false;
  for (const feature of project.features) {
    if (!feature.spec) continue;
    const { assumptions, questions } = feature.spec;
    if (!assumptions.length && !questions.length) continue;
    any = true;
    console.log(`\n${feature.name}:`);
    for (const a of assumptions) {
      const mark = a.status === 'open' ? '⚠' : a.status === 'invalidated' ? '✘' : '✔';
      console.log(`  ${mark} ${a.id} [${a.status}] ${a.text}${a.resolution && a.resolution !== '—' ? ` → ${a.resolution}` : ''}`);
    }
    for (const q of questions) {
      const mark = q.status === 'open' ? '?' : '✔';
      console.log(`  ${mark} ${q.id} [${q.status}] ${q.text}${q.answer && q.answer !== '—' ? ` → ${q.answer}` : ''}`);
    }
  }
  if (!any) console.log('no assumption or question recorded — that is suspicious: almost every feature hides one.');
  return 0;
}

const HELP_LESSONS = `onp-spec lessons — lessons learned with mechanical grounding

The agent brings the judgement (phrasing the general rule); the engine
validates the grounding: a lesson only enters if it cites a REAL signal
recorded by audit/verify in .spec/verification/signals.json. Without a signal,
it is opinion — rejected.

subcommands:
  add --signal <CODE> --feature <feature> --source <AC-xxx|file>
      --text "general rule in one sentence" [--scope <domain>]
                     records a lesson (candidate); when it recurs in another
                     feature, the engine promotes it to confirmed
  list [--status confirmed|candidate|quarantine|all] [--scope <domain>]
       [--query <term>] [--limit N]
                     lessons to load in Specify/Design
                     (default: confirmed only, at most ${LESSONS_DEFAULTS.listLimit})
  suggest [--limit N]
                     mechanical mining: signals recurring across distinct
                     features that still have no lesson
  penalize --id L-xxx
                     the lesson was applied and the failure recurred; 2
                     penalties move it to quarantine
  status             counts per status + file paths`;

function lessonLine(l) {
  const scope = l.scope ? ` · scope ${l.scope}` : '';
  return `${l.id} [${l.status}] (${l.recurrence} feature(s) · ${l.signal}${scope}) ${l.text}`;
}

function cmdLessons(config, positional, flags) {
  const specRoot = path.join(config.rootDir, config.specDir);
  if (!existsSync(specRoot)) {
    console.error(`directory ${config.specDir}/ not found — run \`onp-spec init\` first`);
    return 2;
  }
  const sub = positional[0];
  const cfg = config.lessons;
  const data = loadLessons(specRoot);

  if (!sub || sub === 'help') {
    console.log(HELP_LESSONS);
    return 0;
  }

  if (sub === 'add') {
    const signals = loadSignals(specRoot);
    const result = addLesson(
      data,
      signals,
      {
        text: flags.text,
        signal: flags.signal,
        feature: flags.feature,
        source: flags.source,
        scope: flags.scope,
      },
      cfg
    );
    if (result.error) {
      console.error(`error: ${result.error}`);
      return 2;
    }
    const pruned = pruneLessons(data, cfg);
    saveLessons(specRoot, data);
    const { lesson, event } = result;
    const label = {
      created: `✔ ${lesson.id} recorded as candidate (1 feature) — becomes confirmed when it recurs in ${cfg.promotionThreshold - 1} other(s)`,
      reinforced: `✔ ${lesson.id} reinforced (${lesson.recurrence} feature(s): ${lesson.features.join(', ')})`,
      promoted: `★ ${lesson.id} PROMOTED to confirmed (${lesson.features.join(', ')}) — enters the Specify/Design guide`,
    }[event];
    console.log(label);
    if (pruned.length) console.log(`· pruned by stagnation: ${pruned.join(', ')}`);
    return 0;
  }

  if (sub === 'list') {
    const lessons = listLessons(data, {
      status: flags.status || 'confirmed',
      scope: typeof flags.scope === 'string' ? flags.scope : null,
      query: typeof flags.query === 'string' ? flags.query : null,
      limit: parseInt(flags.limit, 10) || cfg.listLimit,
    });
    if (!lessons.length) {
      console.log(
        flags.status && flags.status !== 'confirmed'
          ? 'no lesson with that filter'
          : 'no confirmed lesson yet — candidates become confirmed when they recur across distinct features (onp-spec lessons list --status all)'
      );
      return 0;
    }
    for (const l of lessons) console.log(lessonLine(l));
    return 0;
  }

  if (sub === 'suggest') {
    const signals = loadSignals(specRoot);
    const suggestions = suggestLessons(data, signals, cfg, {
      limit: parseInt(flags.limit, 10) || 5,
    });
    if (!suggestions.length) {
      console.log(
        `no signal recurring across ${cfg.promotionThreshold}+ distinct features — nothing worth a lesson for now (a clean path yields no lesson; that is correct)`
      );
      return 0;
    }
    console.log('recurring signals — the engine points at WHERE a lesson is worth it; the phrasing is yours:');
    for (const s of suggestions) {
      console.log(
        `  ${s.signal} — ${s.features.length} distinct feature(s) · ${s.occurrences} occurrence(s) · existing lessons: ${s.existingLessons}`
      );
      console.log(`    features: ${s.features.slice(0, 6).join(', ')}${s.features.length > 6 ? ` (+${s.features.length - 6})` : ''}`);
      console.log(`    refs: ${s.refs.join(', ')}`);
    }
    console.log('\nrecord with: onp-spec lessons add --signal <CODE> --feature <f> --source <ref> --text "..."');
    return 0;
  }

  if (sub === 'penalize') {
    if (typeof flags.id !== 'string') {
      console.error('usage: onp-spec lessons penalize --id L-xxx');
      return 2;
    }
    const result = penalizeLesson(data, flags.id, cfg);
    if (result.error) {
      console.error(`error: ${result.error}`);
      return 2;
    }
    saveLessons(specRoot, data);
    const { lesson, event } = result;
    console.log(
      event === 'quarantined'
        ? `✘ ${lesson.id} moved to QUARANTINE (${lesson.penalties} penalties) — leaves the guide; review is up to the user`
        : `⚠ ${lesson.id} penalized (${lesson.penalties}/${cfg.quarantineThreshold}) — ${cfg.quarantineThreshold - lesson.penalties} more moves it to quarantine`
    );
    return 0;
  }

  if (sub === 'status') {
    const count = { confirmed: 0, candidate: 0, quarantine: 0 };
    for (const l of data.lessons) count[l.status] = (count[l.status] || 0) + 1;
    const signals = loadSignals(specRoot);
    console.log(
      `lessons: ${count.confirmed} confirmed · ${count.candidate} candidate(s) · ${count.quarantine} quarantined`
    );
    console.log(`signals in the history: ${Object.keys(signals.signals).length} distinct failure point(s)`);
    console.log(`files: ${config.specDir}/lessons.json (canonical) · ${config.specDir}/LESSONS.md (readable)`);
    return 0;
  }

  console.error(`unknown subcommand: lessons ${sub}\n`);
  console.log(HELP_LESSONS);
  return 2;
}

export async function run(argv) {
  const [command, ...rest] = argv;
  const { flags, positional } = parseFlags(rest);
  const rootDir = process.cwd();

  if (!command || command === 'help' || command === '--help' || command === '-h' || flags.help) {
    console.log(HELP);
    return 0;
  }

  if (command === 'version' || command === '--version' || command === '-v' || flags.version) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
      console.log(pkg.version);
    } catch {
      // the skill-embedded engine does not carry package.json
      console.log('embedded (onp-spec-driven skill)');
    }
    return 0;
  }

  if (command === 'init') return cmdInit(rootDir, flags);
  if (command === 'new') return cmdNew(rootDir, positional[0], flags);

  const config = loadConfig(rootDir);

  // lessons do not need the project loaded — in large repos, listing the guide
  // at the start of Specify has to be cheap
  if (command === 'lessons') return cmdLessons(config, positional, flags);
  // task likewise: a targeted edit of status/model/effort in tasks.md
  if (command === 'task') return cmdTask(config, positional, flags);
  // internal commands of run-tasks.sh (feed/read the global ledger)
  if (command === 'event') return cmdEvent(flags);
  if (command === 'stream-summary') return cmdStreamSummary(positional);
  // overall progress summary: only needs the ledger, not the loaded project
  if (command === 'summary') return cmdSummary(config, positional, flags);

  const project = loadProject(config);

  if (command === 'plan') return cmdPlan(project, positional, flags);

  if (command === 'audit') {
    const audit = auditProject(project, { ci: Boolean(flags.ci) });
    if (flags.json) {
      console.log(renderJson(audit));
    } else {
      console.log(renderTerminal(audit));
    }
    if (flags.md) {
      const outPath = typeof flags.md === 'string' ? flags.md : '.spec/AUDIT.md';
      writeFileSync(path.join(rootDir, outPath), renderMarkdown(audit));
      console.log(`report saved to ${outPath}`);
    }
    const recorded = recordFindings(project.specRoot, audit.findings, {
      gitRev: gitRev(rootDir),
      ...config.lessons,
    });
    if (recorded) {
      console.log(
        `${recorded} signal(s) recorded in the history — after fixing: onp-spec lessons suggest`
      );
    }
    return audit.exitCode;
  }

  if (command === 'verify') {
    // parseFlags lets `--all f1` swallow f1 as the flag value — keep it as a name
    const names = [...positional];
    if (typeof flags.all === 'string') names.push(flags.all);
    if (flags.all) names.push(...project.features.filter((f) => f.spec).map((f) => f.name));
    if (names.length === 0) {
      console.error('usage: onp-spec verify <feature...> | --all');
      return 2;
    }
    const runs = runVerifyBatch(project, names);
    let exit = 0;
    for (const { record, hint } of runs) {
      const featureName = record.feature;
      const failSignals = recordVerify(project.specRoot, record, config.lessons);
      const total = Object.keys(record.results).length;
      const passed = Object.values(record.results).filter((r) => r.status === 'pass').length;
      const scope = record.scope === 'files' ? ` · ${record.testFiles.length} test file(s) run` : '';
      console.log(
        `verify ${featureName}: ${passed}/${total} acceptance criteria with PASS proof · ${record.testsParsed} test(s) read${scope} · exit ${record.exitCode}`
      );
      for (const [acId, r] of Object.entries(record.results)) {
        const mark = r.status === 'pass' ? '✔' : r.status === 'skip' ? '○ SKIP (not proof)' : '✘';
        console.log(`  ${mark} ${acId} ${r.testName ? `— ${r.testName}` : ''}`);
      }
      if (hint) console.log(`  hint: ${hint}`);
      const principles = Object.entries(record.principles || {});
      if (principles.length) {
        console.log('  principles:');
        for (const [pId, r] of principles) {
          console.log(`  ${r.status === 'pass' ? '✔' : '✘'} ${pId} — ${r.testName}`);
        }
      }
      if (failSignals) {
        console.log(`  ${failSignals} fail/skip signal(s) recorded in the history`);
      }
      console.log(`proof recorded in .spec/verification/${featureName}.json — run \`onp-spec audit\``);
      if (!(passed === total && total > 0)) exit = 1;
    }
    return exit;
  }

  if (command === 'scaffold') {
    const featureName = positional[0];
    if (!featureName) {
      console.error('usage: onp-spec scaffold <feature> [--force]');
      return 2;
    }
    const result = scaffoldTests(project, featureName, { force: Boolean(flags.force) });
    if (result.created) {
      console.log(`✔ ${result.created} created with ${result.pending} skeleton test(s) (all FAIL until you implement)`);
      console.log(`  criteria covered: ${result.acIds.join(', ')}`);
    } else {
      console.log(result.message);
    }
    return 0;
  }

  if (command === 'status') return cmdStatus(project);
  if (command === 'assumptions') return cmdAssumptions(project);

  console.error(`unknown command: ${command}\n`);
  console.log(HELP);
  return 2;
}
