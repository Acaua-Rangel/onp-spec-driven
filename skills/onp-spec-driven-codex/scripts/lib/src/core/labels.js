// Human-readable labels for each audit finding code.
// The code (e.g. AC_NO_TEST) is the stable identifier — used in CI, in the
// signals history and in `lessons add --signal`. The label is the plain
// English name shown to the user first.

export const FINDING_LABELS = { 
  PROJECT_INVALID: 'invalid project',
  SPEC_MISSING: 'missing specification',
  SPEC_NO_US: 'specification without a user story',
  STATUS_INVALID: 'invalid specification status',
  FEATURE_MISMATCH: 'mismatched feature name',
  SECTION_MISSING: 'required section missing',
  US_NO_AC: 'story without an acceptance criterion',
  AC_INCOMPLETE: 'incomplete acceptance criterion',
  AC_OUTSIDE_US: 'acceptance criterion outside a story',
  AC_NO_TEST: 'acceptance criterion without a test',
  AC_NO_PROOF: 'acceptance criterion without proof',
  AC_NO_TASK: 'acceptance criterion without a task',
  ID_DUPLICATE: 'duplicate traceability ID',
  ID_SHORT: 'traceability ID too short',
  ASM_OPEN: 'open assumption',
  ASM_STATUS_INVALID: 'invalid assumption status',
  ASM_ID_INVALID: 'assumption without a valid ID',
  Q_OPEN: 'open question',
  Q_STATUS_INVALID: 'invalid question status',
  Q_ID_INVALID: 'question without a valid ID',
  TASK_DONE_NO_PROOF: 'task done without proof',
  TASK_STATUS_INVALID: 'invalid task status',
  TASK_NO_STATUS: 'task without a status',
  REF_BROKEN: 'broken reference',
  REF_MALFORMED: 'malformed reference',
  FILE_MISSING: 'file does not exist',
  FILE_ORPHAN: 'orphan code (no task)',
  TEST_ORPHAN: 'orphan test (points to a criterion that vanished)',
  PROOF_WEAK: 'weak proof',
  VERIFY_STALE: 'stale proof',
  CONSTITUTION_MISSING: 'missing constitution',
  PRINCIPLE_NO_CHECK: 'principle without a check',
  PRINCIPLE_VIOLATED: 'principle violated',
  GLOB_NO_FILES: 'check looks at no files',
  LEVEL_INVALID: 'invalid principle level',
  CHECK_MALFORMED: 'malformed check',
};

export function findingLabel(code) {
  return FINDING_LABELS[code] || code.toLowerCase().replace(/_/g, ' ');
}
