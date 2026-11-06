// Public programmatic API of onp-spec-driven.
// Use it when you want to embed the audit into your own script/CI instead of the CLI.

export { loadConfig, DEFAULT_CONFIG } from './config.js';
export { loadProject } from './core/project.js';
export { auditProject } from './core/audit.js';
export { runVerify, runVerifyBatch } from './core/verify.js';
export { scaffoldTests } from './core/scaffold.js';
export { renderTerminal, renderJson, renderMarkdown } from './core/report.js';
export {
  loadSignals,
  saveSignals,
  recordFindings,
  recordVerify,
  findSignal,
  SIGNALS_DEFAULTS,
} from './core/signals.js';
export {
  loadLessons,
  saveLessons,
  addLesson,
  listLessons,
  penalizeLesson,
  pruneLessons,
  suggestLessons,
  renderLessons,
  LESSONS_DEFAULTS,
} from './core/lessons.js';
export { parseSpec, allAcs } from './parsers/spec.js';
export { parseTasks } from './parsers/tasks.js';
export { parseConstitution } from './parsers/constitution.js';
export { run as runCli } from './cli.js';
