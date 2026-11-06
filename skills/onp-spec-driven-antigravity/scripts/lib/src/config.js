// Project configuration — onpspec.config.json at the root (optional).
// Everything has a sensible default: `npx onp-spec audit` works with no config.

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { LESSONS_DEFAULTS } from './core/lessons.js';

export const DEFAULT_CONFIG = {
  specDir: '.spec',
  // where to look for @spec/@principle tags
  testGlobs: ['test/**', 'tests/**', 'src/**/*.test.*', 'src/**/*.spec.*', '__tests__/**'],
  // implementation files that must be mapped to some task
  srcGlobs: ['src/**'],
  ignoreGlobs: ['node_modules/**', '.git/**', 'dist/**', 'build/**', 'coverage/**', '.spec/**'],
  // command that runs the tests; used by `onp-spec verify`
  testCommand: null,
  // verify runs only the test files that carry the feature's @spec tags when
  // the runner accepts file paths (node --test, vitest, jest, mocha, pytest,
  // tap). "auto" = do it; false = always run the full suite. A `{files}`
  // token inside testCommand overrides this and marks where the paths go.
  testFileArgs: 'auto',
  // how to interpret the output: tap | vitest-json | jest-json | exitcode
  reporter: 'tap',
  // output file for json reporters (vitest-json/jest-json)
  reporterOutputFile: null,
  // lessons layer: promotion/quarantine thresholds, window and caps
  lessons: { ...LESSONS_DEFAULTS },
  // execution plan (onp-spec plan): parallelism and executor defaults
  parallel: {
    // maximum number of lanes running at the same time in a wave
    maxParallel: 3,
    // default model per task (tasks.md can override with `- Model:`;
    // claude-sonnet-5 is also a valid slug in Cursor — in codex it becomes
    // gpt-5.6-terra, which belongs to its family)
    model: 'claude-sonnet-5',
    // default effort: low|medium|high|xhigh|max
    effort: 'medium',
    // permission mode of headless claude; to run fully prompt-free the user
    // can switch to bypassPermissions (their explicit choice)
    permissionMode: 'acceptEdits',
    // override of the --allowedTools list (null = derived from testCommand + git)
    allowedTools: null,
    // sandbox of headless codex (`codex exec --sandbox`); to allow network
    // and paths outside the workspace the user can switch to
    // danger-full-access (their explicit choice)
    sandbox: 'workspace-write',
    // model that writes the "overall progress summary" every minute
    // (claude default; in codex the plan uses gpt-5.6-luna if this value
    // remains a claude-* model; in cursor it becomes composer while this
    // value is the default — claude-haiku-4-5 is not a Cursor slug)
    summaryModel: 'claude-haiku-4-5',
  },
};

export function loadConfig(rootDir) {
  const configPath = path.join(rootDir, 'onpspec.config.json');
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG, rootDir, configPath: null };
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (err) {
    throw new Error(`invalid onpspec.config.json: ${err.message}`);
  }
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    lessons: { ...DEFAULT_CONFIG.lessons, ...(raw.lessons || {}) },
    parallel: { ...DEFAULT_CONFIG.parallel, ...(raw.parallel || {}) },
    rootDir,
    configPath,
  };
}
