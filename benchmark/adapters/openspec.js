// OpenSpec adapter: materializes the SAME feature in OpenSpec's format
// (specs/<id>/spec.md with Purpose/Requirements/Scenario and SHALL phrases) and
// runs the REAL `openspec validate --specs <id> --strict`, capturing the
// verdict.
//
// Where the defect class is inexpressible in OpenSpec's model (tests,
// assumptions, privacy, orphan code), the materialized spec validates "clean" —
// and that's exactly the point: the tool has no way to see the defect.

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// path to the OpenSpec binary: environment variable or the one vendored by
// benchmark/setup.sh in benchmark/.vendor/OpenSpec/bin/openspec.js.
const vendored = path.join(__dirname, '..', '.vendor', 'OpenSpec', 'bin', 'openspec.js');
export const OPENSPEC_BIN =
  process.env.OPENSPEC_BIN || (existsSync(vendored) ? vendored : null);

function renderOpenSpecSpec(f) {
  const lines = [`# ${f.feature} Specification`, '', '## Purpose', '', f.purpose, '', '## Requirements', ''];
  for (const s of f.stories) {
    for (const ac of s.acs) {
      lines.push(`### Requirement: ${ac.title}`, '');
      // normative SHALL sentence derived from the Then (or empty if incomplete)
      if (ac.then) {
        lines.push(`The system SHALL guarantee that, given ${ac.given}, when ${ac.when}, then ${ac.then}.`, '');
      } else {
        // incomplete requirement: no clear normative sentence
        lines.push(`The system handles ${ac.title.toLowerCase()}.`, '');
      }
      // scenario — omitted if the defect is "incomplete/no behavior"
      if (ac.then) {
        lines.push(`#### Scenario: ${ac.title}`, '');
        lines.push(`- **WHEN** ${ac.when}`);
        lines.push(`- **THEN** ${ac.then}`, '');
      }
    }
  }
  return lines.join('\n');
}

export function runOpenSpec(scenario, workDir) {
  if (!OPENSPEC_BIN || !existsSync(OPENSPEC_BIN)) {
    return { available: false, detected: false, note: 'OpenSpec binary not found' };
  }
  const f = scenario.feature;
  const root = path.join(workDir, 'openspec');
  rmSync(root, { recursive: true, force: true });
  const specDir = path.join(root, 'openspec', 'specs', f.feature);
  mkdirSync(specDir, { recursive: true });
  writeFileSync(path.join(specDir, 'spec.md'), renderOpenSpecSpec(f));

  const proc = spawnSync('node', [OPENSPEC_BIN, 'validate', '--specs', f.feature, '--strict'], {
    cwd: root,
    encoding: 'utf-8',
    env: { ...process.env, OPENSPEC_TELEMETRY: '0', NODE_TEST_CONTEXT: undefined, NODE_OPTIONS: undefined },
  });
  const out = `${proc.stdout || ''}\n${proc.stderr || ''}`;
  // OpenSpec prints "failed" when structural validation fails
  const failed = /\d+ failed/.test(out) && !/0 failed/.test(out);
  const invalid = /is not valid|✗/.test(out);
  const detected = failed || invalid;
  return { available: true, detected, exitCode: proc.status, out: out.trim() };
}
