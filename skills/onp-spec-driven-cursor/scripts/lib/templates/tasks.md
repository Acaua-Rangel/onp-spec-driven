# Tasks: {{TITLE}}

> feature: {{FEATURE}}

<!--
  How to read this file (the format is checked by `onp-spec audit`):
  - T-xxx = task (traceability ID, unique across the whole project).
  - Every task references in `Refs:` at least one user story
    (US-xxx) or acceptance criterion (AC-xxx).
  - Every task lists the files it creates/changes in `Files:` — take care:
    it is what decides what `onp-spec plan` runs in PARALLEL (disjoint
    files) and what runs in sequence.
  - Optional per-task fields, used by the execution plan:
    `- Model: claude-sonnet-5` and `- Effort: high` (low|medium|high|xhigh|max).
  - A task can only become [done] when its acceptance criteria have a PASS
    proof recorded by `onp-spec verify`.
  Status: pending | in-progress | done
    (shortcut: `onp-spec task <feature> <T-xxx> <status>`)
-->

## T-001 — [task title] [pending]

- Refs: US-001, AC-001
- Files: src/example.js
- Notes: [decisions, dependencies on other tasks]
