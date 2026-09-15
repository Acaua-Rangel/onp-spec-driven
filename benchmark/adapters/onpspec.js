// onp-spec-driven adapter: materializes the scenario in .spec/ format, runs
// the REAL `onp-spec audit --ci` and returns the detected finding codes.

import { mkdirSync, writeFileSync, rmSync, cpSync } from 'fs';
import path from 'path';
import { loadConfig } from '../../src/config.js';
import { loadProject } from '../../src/core/project.js';
import { auditProject } from '../../src/core/audit.js';
import { runVerify } from '../../src/core/verify.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(__dirname, '..', '..', 'templates');

function renderSpec(f) {
  const lines = [`# Spec: ${f.title}`, '', `> feature: ${f.feature}`, `> status: ${f.status || 'in-implementation'}`, '', '## Context', '', f.purpose, '', '## Stories', ''];
  for (const s of f.stories) {
    lines.push(`### ${s.id} — ${s.title}`, '', `As a ${s.as}, I want ${s.want}, so that ${s.so}.`, '');
    for (const ac of s.acs) {
      lines.push(`#### ${ac.id} — ${ac.title}`, '');
      if (ac.given) lines.push(`- **Given** ${ac.given}`);
      if (ac.when) lines.push(`- **When** ${ac.when}`);
      if (ac.then) lines.push(`- **Then** ${ac.then}`);
      lines.push('');
    }
  }
  lines.push('## Assumptions', '', '| ID | Assumption | Status | Resolution |', '|---|---|---|---|');
  for (const a of f.assumptions) lines.push(`| ${a.id} | ${a.text} | ${a.status} | ${a.resolution} |`);
  lines.push('', '## Open questions', '', '| ID | Question | Status | Answer |', '|---|---|---|---|');
  for (const q of f.questions || []) lines.push(`| ${q.id} | ${q.text} | ${q.status} | ${q.answer || '—'} |`);
  lines.push('');
  return lines.join('\n');
}

function renderTasks(f) {
  const lines = [`# Tasks: ${f.title}`, '', `> feature: ${f.feature}`, ''];
  let t = 1;
  for (const s of f.stories) {
    for (const ac of s.acs) {
      const status = f.__taskDoneWithFailure?.includes(ac.id) ? 'done' : 'pending';
      const refs = [ac.id];
      if (f.__brokenRef && t === 1) refs.push(f.__brokenRef);
      lines.push(`## T-${String(t).padStart(3, '0')} — Implement ${ac.title} [${status}]`, '', `- Refs: ${refs.join(', ')}`, `- Files: src/${f.feature}.js`, '');
      t++;
    }
  }
  return lines.join('\n');
}

// Generates a test annotated per AC (except the ones the scenario wants
// without a test), and the privacy leak / orphan code when applicable.
function renderTestFile(f) {
  const semTeste = new Set(f.__noTest || []);
  const lines = [`import { test } from 'node:test';`, `import assert from 'node:assert/strict';`, ''];
  for (const s of f.stories) {
    for (const ac of s.acs) {
      if (semTeste.has(ac.id)) continue;
      // orphan test: title keeps the old ID even though the spec was renamed
      const tagId = f.__orphanTest && ac.id === f.__orphanTest.specId ? f.__orphanTest.testId : ac.id;
      const passa = !(f.__taskDoneWithFailure?.includes(ac.id));
      lines.push(`test('${ac.id}: ${ac.title} @spec:${tagId}', () => {`);
      lines.push(passa ? `  assert.ok(true);` : `  assert.fail('not implemented yet');`);
      lines.push(`});`, '');
    }
  }
  // principle tests: the base constitution requires @principle:P-001;
  // the LGPD preset also requires P-002 and P-003.
  const principles = f.constitution ? ['P-001', 'P-002', 'P-003'] : ['P-001'];
  for (const p of principles) {
    lines.push(`test('principle ${p} @principle:${p}', () => { assert.ok(true); });`, '');
  }
  return lines.join('\n');
}

export async function runOnpSpec(scenario, workDir) {
  const f = scenario.feature;
  const root = path.join(workDir, 'onpspec');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(path.join(root, '.spec', 'features', f.feature), { recursive: true });
  mkdirSync(path.join(root, '.spec', 'verification'), { recursive: true });
  mkdirSync(path.join(root, 'src'), { recursive: true });
  mkdirSync(path.join(root, 'test'), { recursive: true });

  // config
  writeFileSync(path.join(root, 'onpspec.config.json'), JSON.stringify({ testCommand: 'node --test', reporter: 'tap' }, null, 2));

  // constitution (LGPD preset for the grades feature)
  const presetFile = f.constitution ? 'constitution-lgpd-education.md' : 'constitution-base.md';
  cpSync(path.join(TEMPLATES, presetFile), path.join(root, '.spec', 'constitution.md'));

  // spec + tasks
  writeFileSync(path.join(root, '.spec', 'features', f.feature, 'spec.md'), renderSpec(f));
  writeFileSync(path.join(root, '.spec', 'features', f.feature, 'tasks.md'), renderTasks(f));

  // implementation code
  let src = `export function impl(){ return true; }\n`;
  if (f.__leak) src += `export function readGrade(grade){ ${f.__leak} return grade; }\n`;
  writeFileSync(path.join(root, 'src', `${f.feature}.js`), src);
  if (f.__orphanCode) {
    const p = path.join(root, f.__orphanCode);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, `export const secret = () => 'unmapped collection';\n`);
  }

  // tests
  writeFileSync(path.join(root, 'test', `${f.feature}.spec.test.js`), renderTestFile(f));

  // runs verify (records proof) — to distinguish AC_NO_PROOF from a real PASS,
  // and to detect TASK_DONE_NO_PROOF (task marked done with a failing test)
  const config = loadConfig(root);
  let project = loadProject(config);
  try {
    runVerify(project, f.feature);
  } catch {
    // no tests/verify — continue; the audit flags whatever is missing
  }

  // reload after verify and audit in CI mode
  project = loadProject(loadConfig(root));
  const audit = auditProject(project, { ci: true });
  const codes = [...new Set(audit.findings.filter((x) => x.severity === 'error').map((x) => x.code))];
  return { detectedCodes: codes, ok: audit.ok, allFindings: audit.findings };
}
