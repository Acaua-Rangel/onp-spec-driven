// Generates the embedded engine (scripts/) inside each skills/<agent>/ folder
// of a working copy — needed only for a MANUAL install (`cp -r skills/<agent>`)
// from a git clone. The repository does not commit scripts/: the engine lives
// once, in src/. `onp-spec init --agents <agent>` and `npm pack` generate it
// automatically (see src/core/skill-engine.js).

import path from 'path';
import { fileURLToPath } from 'url';
import { buildSkillDir, ENTRY } from '../src/core/skill-engine.js';

export { buildSkillDir, ENTRY };

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SKILLS = ['onp-spec-driven', 'onp-spec-driven-antigravity', 'onp-spec-driven-codex', 'onp-spec-driven-cursor', 'onp-spec-driven-copilot', 'onp-spec-driven-gemini'];

export function buildSkill() {
  return SKILLS.map((skill) => buildSkillDir(path.join(ROOT, 'skills', skill, 'scripts')));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outs = buildSkill();
  for (const out of outs) {
    console.log(`✔ embedded engine generated in ${path.relative(ROOT, out)}/`);
  }
}
