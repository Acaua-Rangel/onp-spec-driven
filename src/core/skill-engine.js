// Builds a skill's embedded engine (scripts/): copies src/ and templates/ next
// to the skill and writes the entrypoint. The repository keeps ONE copy of the
// engine (src/); each installed skill gets its own generated copy so that the
// skill stays self-contained (installing = one folder, no npm/npx needed).

import { cpSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// package root (or, inside an embedded engine, <skill>/scripts/lib)
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const ENTRY = `#!/usr/bin/env node
// Entrypoint of the onp-spec-driven skill's embedded engine.
// Usage (from the ROOT of the user's project):
//   node <skill-dir>/scripts/onp-spec.mjs <command> [options]
// Generated (tools/build-skill.mjs or \`onp-spec init --agents\`) — do not edit by hand; edit src/ and regenerate.
import { run } from './lib/src/cli.js';

run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(\`error: \${err.message}\`);
    process.exitCode = 2;
  }
);
`;

export function buildSkillDir(scriptsDir) {
  rmSync(scriptsDir, { recursive: true, force: true });
  mkdirSync(path.join(scriptsDir, 'lib'), { recursive: true });
  cpSync(path.join(ROOT, 'src'), path.join(scriptsDir, 'lib', 'src'), { recursive: true });
  cpSync(path.join(ROOT, 'templates'), path.join(scriptsDir, 'lib', 'templates'), {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}agents`),
  });
  writeFileSync(path.join(scriptsDir, 'onp-spec.mjs'), ENTRY);
  return scriptsDir;
}
