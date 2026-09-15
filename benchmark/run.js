// Benchmark harness — runs onp-spec-driven and OpenSpec live over the
// SAME real ONP-domain feature, with seeded defects, and measures how many
// defect classes each tool detects MECHANICALLY (what a CI catches without
// a human/LLM in the loop). spec-kit enters through the capability matrix
// (verified in the source code: it has no mechanical defect validator).
//
// usage: OPENSPEC_BIN=/path/to/openspec/bin/openspec.js node benchmark/run.js

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { SCENARIOS, DEFECT_CLASSES } from './scenarios.js';
import { runOnpSpec } from './adapters/onpspec.js';
import { runOpenSpec, OPENSPEC_BIN } from './adapters/openspec.js';
import { STATIC_TOOLS } from './adapters/capability.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Map: defect class → onp-spec finding codes that prove it.
const ONPSPEC_EXPECT = {
  CLEAN_BASELINE: null, // NO error expected
  REQ_NO_TEST: ['AC_NO_TEST'],
  ORPHAN_TEST: ['TEST_ORPHAN'],
  INCOMPLETE_REQ: ['AC_INCOMPLETE'],
  PREMATURE_DONE: ['TASK_DONE_NO_PROOF', 'AC_NO_PROOF'],
  SILENT_ASSUMPTION: ['ASM_OPEN'],
  PRIVACY_VIOLATED: ['PRINCIPLE_VIOLATED'],
  ORPHAN_CODE: ['FILE_ORPHAN'],
  BROKEN_REF: ['REF_BROKEN'],
  DUPLICATE_ID: ['ID_DUPLICATE'],
};

// OpenSpec only detects structural defects that fit its model.
// (measured LIVE; this map is just for sanity-checking the result.)

function onpspecDetected(scenario, result) {
  const expect = ONPSPEC_EXPECT[scenario.defectClass];
  if (expect === null) {
    // baseline: "correct" detection = raising no error at all
    return result.ok === true;
  }
  return expect.some((code) => result.detectedCodes.includes(code));
}

async function main() {
  const workDir = mkdtempSync(path.join(os.tmpdir(), 'onpspec-bench-'));
  const rows = [];
  const t0 = Date.now();

  for (const scenario of SCENARIOS) {
    const onp = await runOnpSpec(scenario, workDir);
    const onpDet = onpspecDetected(scenario, onp);

    const osRes = runOpenSpec(scenario, workDir);
    // for baseline, "correct detection" = validating clean (no false positive)
    let osDet;
    if (!osRes.available) osDet = null;
    else if (scenario.defectClass === 'CLEAN_BASELINE') osDet = osRes.detected === false;
    else osDet = osRes.detected;

    rows.push({
      scenario: scenario.id,
      defectClass: scenario.defectClass,
      onpspec: onpDet,
      openspec: osDet,
      speckit: scenario.defectClass === 'CLEAN_BASELINE' ? true : STATIC_TOOLS['spec-kit'].detects(),
      onpCodes: onp.detectedCodes,
      osOut: osRes.available ? osRes.out?.split('\n').slice(-3).join(' ') : osRes.note,
    });
  }

  rmSync(workDir, { recursive: true, force: true });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // ---------- aggregate ----------
  const tools = ['onpspec', 'openspec', 'speckit'];
  const labels = {
    onpspec: 'onp-spec-driven',
    openspec: 'OpenSpec',
    speckit: 'spec-kit',
  };
  // counts only DEFECT scenarios (excludes baseline) for the detection rate
  const defectRows = rows.filter((r) => r.defectClass !== 'CLEAN_BASELINE');
  const score = {};
  for (const t of tools) {
    const hits = defectRows.filter((r) => r[t] === true).length;
    score[t] = { hits, total: defectRows.length, pct: Math.round((100 * hits) / defectRows.length) };
  }
  const baseline = rows.find((r) => r.defectClass === 'CLEAN_BASELINE');

  // ---------- print ----------
  console.log(`\nonp-spec-driven benchmark — ${SCENARIOS.length} scenarios (${elapsed}s)\n`);
  console.log('Mechanical detection rate for real defects (higher = better):');
  for (const t of tools) {
    console.log(`  ${labels[t].padEnd(18)} ${String(score[t].pct).padStart(3)}%  (${score[t].hits}/${score[t].total})`);
  }
  console.log('\nBaseline (correct spec) — none should false-positive:');
  for (const t of tools) {
    const v = baseline[t];
    console.log(`  ${labels[t].padEnd(18)} ${v === true ? 'OK (clean)' : v === null ? 'n/a' : 'FALSE POSITIVE'}`);
  }

  // ---------- RESULTS.md ----------
  const md = renderResults({ rows, score, tools, labels, defectRows, baseline, elapsed });
  const outPath = path.join(__dirname, 'RESULTS.md');
  writeFileSync(outPath, md);
  console.log(`\nfull report: ${path.relative(process.cwd(), outPath)}`);

  // ---------- sanity check: onp-spec MUST catch everything ----------
  const misses = defectRows.filter((r) => r.onpspec !== true);
  if (misses.length) {
    console.error(`\n⚠ onp-spec-driven did not detect: ${misses.map((m) => m.defectClass).join(', ')}`);
    process.exitCode = 1;
  } else if (baseline.onpspec !== true) {
    console.error('\n⚠ onp-spec-driven false-positived on the baseline');
    process.exitCode = 1;
  } else {
    console.log('\n✔ onp-spec-driven: 100% detection and clean baseline');
  }
}

function mark(v) {
  if (v === true) return '✅';
  if (v === false) return '❌';
  return '—';
}

function renderResults({ rows, score, tools, labels, defectRows, baseline, elapsed }) {
  const l = [];
  l.push('# Benchmark results — onp-spec-driven vs. competitors', '');
  l.push(`> Generated by \`node benchmark/run.js\` · ${new Date().toISOString().slice(0, 10)} · ${elapsed}s`);
  l.push(`> OpenSpec: ${OPENSPEC_BIN ? 'run live' : 'not available in this environment (set OPENSPEC_BIN)'}`, '');

  l.push('## What is measured', '');
  l.push('Each scenario starts from a **real spec from the ONP domain** (class enrollment, student grades) and seeds **a defect that really plagues spec-driven projects**. It measures whether each tool detects the defect **mechanically** — what a CI pipeline catches on its own, without a human or LLM in the loop. That detection is what keeps the spec *true over time*.', '');

  l.push('## Scoreboard (mechanical detection rate)', '');
  l.push('| Tool | Detection | Hits |');
  l.push('|---|---|---|');
  for (const t of tools) {
    l.push(`| ${labels[t]} | **${score[t].pct}%** | ${score[t].hits}/${score[t].total} |`);
  }
  l.push('');

  l.push('## Matrix by defect class', '');
  l.push('| Scenario | Defect | onp-spec | OpenSpec | spec-kit |');
  l.push('|---|---|:--:|:--:|:--:|');
  for (const r of rows) {
    l.push(`| ${r.scenario} | ${r.defectClass} | ${mark(r.onpspec)} | ${mark(r.openspec)} | ${mark(r.speckit)} |`);
  }
  l.push('');
  l.push('Legend: ✅ detected (or, for the baseline, validated clean) · ❌ not detected · — not available.', '');

  l.push('## Defect class descriptions', '');
  for (const [k, v] of Object.entries(DEFECT_CLASSES)) l.push(`- **${k}** — ${v}`);
  l.push('');

  l.push('## Evidence (onp-spec findings per scenario)', '');
  l.push('| Scenario | Emitted error codes |');
  l.push('|---|---|');
  for (const r of rows) {
    l.push(`| ${r.scenario} | ${r.onpCodes.length ? r.onpCodes.join(', ') : '_(none — clean baseline)_'} |`);
  }
  l.push('');

  l.push('## Why the competitors fall behind', '');
  l.push('- **OpenSpec** has a real structural validator (it requires a normative SHALL sentence and at least one scenario per requirement), so it catches `REQ_INCOMPLETO`. But its model has no notion of **tests, proof, assumptions, privacy, or orphan code** — so there is no way to detect drift #1 (requirement without a test), premature "done", the silent assumption, or the privacy violation.');
  l.push('- **spec-kit** is scaffolding: it generates great templates and steers the agent, but runs no defect check at all — and in its template **tests are optional**. Mechanical detection: zero.');
  l.push('');
  l.push('onp-spec-driven is the only one that treats **test proof, assumptions, and principles as first-class data** and audits them mechanically — that\'s why it detects classes the others don\'t even represent.', '');

  return l.join('\n');
}

main();
