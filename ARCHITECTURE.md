# Architecture — onp-spec-driven

> Internal design document. Updated as the project evolves.
> Build status: see PROGRESS.md

## Thesis

All existing SDD tools are **spec-first**: the spec generates the code and then
becomes a lie. onp-spec-driven is **spec-anchored**: the spec is auditable
against the code, mechanically, in CI.

| Competitor | What it does | What it does NOT do |
|---|---|---|
| spec-kit (GitHub) | Rich templates (prioritized user stories, given-when-then, FR-xxx), scaffolding CLI in Python | Tests are OPTIONAL in the template; no mechanical verification; the constitution is just a prompt |
| OpenSpec | Real structural validator (zod + md parser): SHALL/MUST present, scenarios exist, deltas well-formed | Never links requirement → test → code; doesn't detect drift |

## The 5 differentiators (product acceptance criteria)

1. **Spec-anchored with full traceability**: US-xxx → AC-xxx → T-xxx → annotated
   test. `onp-spec audit` answers mechanically: "which AC has no test?", "which
   test points to a nonexistent AC?", "which code file maps to no task?".
2. **Executable DoD**: every AC is born as Given/When/Then; `onp-spec scaffold`
   generates the test skeleton with the tag `@spec:AC-xxx` in the title;
   `onp-spec verify` runs the tests and cross-references the result with the ACs.
   The agent can't declare victory: `audit --ci` exits with a code ≠ 0 if any AC
   lacks a PASS proof.
3. **Assumptions and questions as first-class citizens**: mandatory sections
   `## Assumptions` (ASM-xxx) and `## Open questions` (Q-xxx) with a status. A
   feature can't reach `implemented` with an open ASM.
4. **Constitution with verifiable obligation levels**: P-xxx with
   [MUST]/[RECOMMENDED]/[MAY], each MUST with executable verification (test tag
   `@principle:P-xxx`, forbidden/required pattern via regex+glob). LGPD/education
   preset included (minors' data, grades, access auditing).
5. **Lessons learned with mechanical backing**: the AI phrases; the engine
   validates that the lesson cites a REAL signal from history (audit finding /
   verify failure) and owns dedup, promotion by recurrence across distinct
   features, quarantine by penalty, pruning and rendering.

## Stack

- Node.js >= 18, pure ESM, **zero dependencies**.
- The lib's own tests: native `node:test`.
- **The skill is the primary artifact**, self-sufficient, across variants with
  the SAME engine and the SAME version (`skills/onp-spec-driven/` for Claude
  Code, `skills/onp-spec-driven-codex/` for Codex,
  `skills/onp-spec-driven-cursor/` for Cursor,
  `skills/onp-spec-driven-antigravity/` for Antigravity,
  `skills/onp-spec-driven-copilot/` for GitHub Copilot,
  `skills/onp-spec-driven-gemini/` for Gemini; the `agent:` marker in the
  frontmatter prevents installing the wrong one):
  - `SKILL.md` + `references/` — the agent's contract: the
    Specify → Design → Tasks → Execute → **Audit** flow, a correction loop
    limited to 3 iterations, 1 task = 1 commit, gate with pasted output.
  - `scripts/` — **embedded mechanical engine**, NOT committed: the repo keeps
    a single copy of the engine (`src/`). It is generated into the installed
    skill by `onp-spec init --agents`, by `npm pack` (`prepack`), or by hand
    with `node tools/build-skill.mjs` (`test/skill-sync.test.js` checks the
    generation).
    Installing = copying the folder into `.claude/skills/` (Claude Code),
    `.cursor/skills/` (Cursor — native Agent Skills since Cursor 2.4; the
    frontmatter `name:` MUST equal the folder name),
    `.github/skills/` (GitHub Copilot), `.gemini/skills/` (Gemini) or
    `.agents/skills/` (Codex and Antigravity — they share the directory, hence
    the marker). No npm, no npx.
- The **npm CLI** (`bin/onp-spec.js` → `src/`) still exists as CI mode
  (`@onovoprogramador/onp-spec`); it consumes the SAME `src/`.
- Skill-first refactoring design: `docs/TDD-skill-harness.md`; the findings that
  motivated it: `docs/EXHAUSTIVE-TESTING-FINDINGS.md`.

## Artifact format (.spec/)

```
.spec/
├── constitution.md          # versioned P-xxx with executable verification
├── lessons.json             # lessons (canonical state, written only by the engine)
├── LESSONS.md               # rendered lessons (human/agent reading)
├── verification/            # verify results per feature (JSON, machine)
│   └── signals.json         # signal history (backing for lessons)
└── features/<name>/
    ├── spec.md              # US-xxx, AC-xxx (Given/When/Then), ASM-xxx, Q-xxx
    ├── tasks.md             # T-xxx with Refs: and Files:
    └── design.md            # optional (large features)
```

> Note: the grammar is fully English (keywords, statuses, finding codes) —
> the excerpts below use the actual tokens the parser requires.

### spec.md (minimal parseable grammar)

```markdown
# Spec: Homework submission
> feature: homework-submission
> status: draft | ready | in-implementation | implemented | audited

## Stories
### US-001 — Student submits homework
As a student, I want..., so that...

#### AC-001 — Submission within the deadline
- **Given** an authenticated student with an open assignment
- **When** they submit the file before the deadline
- **Then** the submission is recorded with status "on time"

## Assumptions
| ID | Assumption | Status | Resolution |
|---|---|---|---|
| ASM-001 | Assignment cannot be resubmitted | open | — |

## Open questions
| ID | Question | Status | Answer |
|---|---|---|---|
| Q-001 | Deadline time zone? | answered | America/Sao_Paulo |
```

ASM status: `open | confirmed | invalidated`. Q status: `open | answered`.

### tasks.md

```markdown
## T-001 — Submission model [done]
- Refs: US-001, AC-001, AC-002
- Files: src/models/submission.js
```

Task status: `pending | in-progress | done`.

### Test annotation (works in ANY framework)

The tag goes in the test TITLE (shows up in any reporter) and/or in a comment
in the file:

```js
test('AC-001: on-time submission @spec:AC-001', () => { ... })
// @principle:P-002 in principle tests
```

### constitution.md

```markdown
# Constitution — v1.0.0

## P-001 [MUST] A student's grade is never exposed to another student
Every endpoint that returns a grade filters by the authenticated student.
- verification(test): @principle:P-001
- verification(forbidden): `SELECT \* FROM grades` in `src/**/*.js`

## P-010 [MAY] Data deletion on the data subject's request
```

## Audit engine — catalog of findings

| Code | Finding | Severity |
|---|---|---|
| AC_NO_TEST | AC with no annotated test | ERROR |
| AC_NO_PROOF | Test exists but never passed in verify (failed, was SKIPPED — skip is not proof — or verify is stale) | ERROR in --ci, WARNING otherwise |
| TEST_ORPHAN | Test annotated with a nonexistent AC (drift!) | ERROR |
| REF_BROKEN | Task references a US/AC nonexistent in ANY spec (IDs/refs are global) | ERROR |
| US_NO_AC | Story with no acceptance criterion | ERROR |
| AC_INCOMPLETE | AC without complete Given/When/Then | ERROR |
| AC_NO_TASK | No task (from any feature) covers the AC | WARNING |
| FILE_ORPHAN | src file not mapped by any task (configurable globs) | WARNING |
| FILE_MISSING | Task maps a file that doesn't exist | ERROR if [done], WARNING otherwise |
| TASK_DONE_NO_PROOF | Task [done] with an AC lacking PASS | ERROR |
| TASK_NO_STATUS | Task without an explicit status (assumes pending) | WARNING |
| TASK_STATUS_INVALID | Task status outside pending/in-progress/done (accents/uppercase are normalized first) | ERROR |
| ASM_OPEN | Open assumption with the feature implemented/audited | ERROR |
| Q_OPEN | Open question during implementation | WARNING |
| SECTION_MISSING | Spec missing the Assumptions/Open questions section | ERROR with status ≥ ready, WARNING in draft |
| PRINCIPLE_NO_CHECK | P [MUST] without executable verification | ERROR |
| PRINCIPLE_VIOLATED | Forbidden pattern found / test tag absent | ERROR |
| LEVEL_INVALID | Principle level outside MUST/RECOMMENDED/MAY (treated as MUST, never ignored) | ERROR |
| GLOB_NO_FILES | Constitution verification with a glob that matches no file (inert) | WARNING |
| CHECK_MALFORMED | Invalid regex, wrong format, or regex that exceeded the time limit (5s, subprocess) | ERROR |
| FEATURE_MISMATCH | `> feature:` differs from the directory name | WARNING |
| PROOF_WEAK | Proof granted only by the global exit code (exitcode reporter) | WARNING |
| ID_DUPLICATE | Two elements with the same ID | ERROR |
| ID_SHORT | ID with fewer than 3 digits in a heading (not recognized by the grammar) | WARNING |
| VERIFY_STALE | Code changed after the last verify | WARNING |

Proof rules (verify): TAP directives `# SKIP`/`# TODO` and JSON statuses
`skipped`/`pending`/`todo` become a `skip` verdict — never proof. By tag:
`fail` dominates `pass`, which dominates `skip`. The `exitcode` reporter only
grants proof to an AC with an annotated test, and always with the PROOF_WEAK
warning.

## verify — test-result adapters

`onpspec.config.json` → `{ "testCommand": "...", "reporter": "tap" | "vitest-json" | "jest-json" | "exitcode" }`.
Verify runs the command, extracts the result PER TEST, matches titles with
`@spec:AC-xxx` and writes `.spec/verification/<feature>.json` with
{ac, status, test, timestamp, gitRev}. Audit consumes that.

Speed: for runners that accept file paths (`node --test`, vitest, jest,
mocha, pytest, tap) verify runs ONLY the test files carrying the feature's
`@spec` tags (`testFileArgs: "auto"`, default; `false` = full suite; a
`{files}` token in `testCommand` marks where the paths go). `verify f1 f2` /
`verify --all` share one test run. `--timings` (or `ONP_SPEC_TIMINGS=1`)
prints where the time went. `VERIFY_STALE` only looks at the feature's own
tagged tests and the files its tasks claim.

## Execution plan (src/core/plan.js)

`onp-spec plan <feature>` turns tasks.md into execution lanes: tasks with
**disjoint** `Files:` become PARALLEL lanes (connected components of the
file-conflict graph — 1 lane = 1 git worktree + 1 branch
`spec/<feature>-lane-N` + 1 clean context window); tasks that share a file
fall into the same lane in sequence; a task with no `Files:` runs alone at
the end on the main tree. `parallel.maxParallel` (config, default 3) splits the
lanes into waves. `Model:`/`Effort:` per task (or the defaults
`parallel.model`/`parallel.effort`) feed the executor.

The computation is agent-agnostic; the artifacts vary (`--agents`, with
auto-detection: 1st the `agent:` marker of the embedded skill itself, 2nd the
engine's path (`.codex`/`.cursor/skills`/`.agents`/`.claude` — a
checkout in `~/.cursor/worktrees/<repo>` does NOT count as cursor), 3rd the
skill installed in the project with precedence `.claude` → `.agents` → `.cursor`;
with more than one skill installed, that order wins — when in
doubt, use the flag):

- **always**: `plan-execution.md` — lanes/waves, branch and commit management
  (1 task = 1 commit `T-xxx <feature>: title`; `--no-ff` merge into the work
  branch `spec/<feature>`; final gate verify + audit).
- **claude**: `run-tasks.sh` (headless: `claude -p` per task with
  `--model`/`--effort` + `--output-format stream-json --verbose`,
  permission-mode `parallel.permissionMode` default acceptEdits + allowedTools
  derived from the testCommand; validates the environment and a clean tree;
  auto-commits the plan artifacts; merges, marks `[done]` via
  `onp-spec task`, closes the accounting in git and runs the gate) and
  `plan-execution.html` (visual, read-only).

  The script is a **dispatcher**, not a linear script: each lane and each
  sequential step is a function, so `--lane <id>` re-runs only the one that
  failed (cleaning the worktree and branch from the previous attempt before
  recreating them), `--seq <T-xxx>` redoes a sequential step, `--gate` runs only
  the verdict and `--list` shows the targets. Each attempt is counted and goes
  to the ledger. While it runs, a background loop prints to the terminal, every
  ~1 min, the **overall progress summary** (via `claude -p`, model
  `parallel.summaryModel` default haiku; deterministic fallback) and records it
  in the ledger — on exit, a trap (`pkill -P` on the loop, otherwise the orphan
  `sleep` holds the stdout of whoever called it via pipe) records the final
  summary.
- **codex**: SAME artifacts and SAME dispatcher as claude, swapping the CLI:
  each task runs `codex exec` with `--model` +
  `-c model_reasoning_effort=<level>` (the `max` level from tasks.md becomes
  `xhigh`, Codex's ceiling), output `--json` (JSONL → the task's stream in the
  ledger), sandbox `parallel.sandbox` (default `workspace-write`) and
  `--add-dir <repo>` — the worktrees' shared `.git` lives in the main repo and
  without this the sandbox would block the commit. The per-minute summary uses
  `codex exec --sandbox read-only --ephemeral` with a cheap model
  (`gpt-5.6-luna` when `parallel.summaryModel` is still a `claude-*`); the default
  per-task model becomes `gpt-5.6-terra` when `parallel.model` is a `claude-*`
  (an explicit `Model: claude-*` in tasks.md is swapped with a warning;
  `--model claude-*` in the flag is an ERROR). Never depends on the Claude CLI.

  **Cost is the user's choice**: codex's `plan` prints "the models and efforts
  of this plan" (one line per task) and the skill requires the agent to CONFIRM
  with the user before executing. `--model <m>`/`--effort <n>` on `plan` lock
  ALL tasks (they beat tasks.md and config; they go into
  `forcedModel`/`forcedEffort` in plan.json and in the "regenerate with");
  `onp-spec task <feature> <T-xxx> [status] [--model <m>] [--effort <n>]`
  writes `- Model:`/`- Effort:` into the task's section in tasks.md (replaces
  if present, inserts if not) for per-task tuning.
- **cursor**: SAME artifacts and SAME dispatcher as claude, swapping the CLI:
  each task runs the Cursor CLI (`agent -p`, with a fallback to the legacy name
  `cursor-agent`) with `--model` per task, output
  `--output-format stream-json` (NDJSON → the task's stream in the ledger) and
  `--force` — without `--force` Cursor's print mode doesn't modify files;
  fine-grained control is the user's via `permissions.deny` in
  `.cursor/cli.json`, which beats `--force`. **There is no effort flag in the
  Cursor CLI**: the level is embedded in the model slug (e.g.
  `gpt-5.6-terra-high`), so tasks.md's `Effort:` is informational in this plan
  (the artifact warns). `claude-*` models are VALID slugs in Cursor — nothing is
  swapped; only the per-minute summary model becomes `composer` (in-house model,
  usage included) while `parallel.summaryModel` is the default `claude-haiku-4-5`.
  The per-minute summary runs `agent -p` WITHOUT `--force` (read-only by
  construction). The plan prints "the models of this plan" and the skill
  requires the agent to CONFIRM with the user before executing (claude-*/gpt-*
  are billed per usage in the Cursor plan; the savings route is
  `--model composer`). Never depends on the Claude CLI nor on Codex.
- **antigravity**: the md gains worktree commands and a ready-made prompt per
  lane for Antigravity's native parallel agents — never depends on any CLI.

**Parallelizing is the user's choice — including WHICH tasks**: the agent
presents the plan as a recommendation and asks before executing.
`--parallelize T-001,T-003` restricts the lanes to the CHOSEN tasks (the rest go
to `sequential` with `seqReason` "outside the user's selection"; an unknown id
or an empty selection is a friendly error; the selection is emitted in
`parallelize` in plan.json and in the artifacts' "regenerate with").
`--sequential` generates the plan with ALL tasks in `sequential` (one after
another, on the main tree, without worktrees — `mode: "sequential"` in
plan.json), reusing the same executor, the same commit discipline and the same
gate.

`onp-spec task <feature> <T-xxx> <status>` is the mechanical status-update
utility used by the executor (and by humans).

The plan also comes out in `plan.json` (machine reading) and the script emits a
trail of events (lane running/merged/conflict, tasks, gate, end, summary) to the
global ledger — that's what feeds `onp-spec summary`.

## Global ledger (src/core/ledger.js)

Execution state does NOT live in the user's repository: it lives in a **single,
global file**, `~/.onp-spec/panel/ledger.jsonl` (root configurable via
`ONP_SPEC_HOME`, which also isolates the tests; the `panel/` segment in the
path is a historical leftover). Each line is an event (`plan`, `start`,
`lane`, `task`, `gate`, `end`, `summary`) stamped with `runId`, `project`,
`projectDir` and `feature` — so a single ledger covers as many projects as
exist, and `buildTree()` reconstructs project → execution → lane → task from
it. `pruneLedger()` keeps the 30 most recent executions and deletes the streams
of the old ones. A corrupted line is ignored, never breaking the read.

Honesty rule baked into the tree: **new work invalidates the previous verdict**
(`gateStale`), so an execution only shows "done" with a fresh audit at 0.
`--no-gate` records `end: 1` on purpose — without an audit there is no proof.

Each task's stream is the raw JSONL from the headless CLI — `claude -p
--output-format stream-json --verbose` (system/assistant/user/result events),
`codex exec --json` (thread.started/turn.*/item.* events — agent_message,
reasoning, command_execution, file_change, mcp_tool_call, web_search, todo_list
items), or the Cursor CLI `agent -p --output-format stream-json` (system/init,
assistant and result in the SAME shape as claude; tools as tool_call
started/completed events with the body in `tool_call.<name>ToolCall`, no usage
or thinking in print mode)
— in `~/.onp-spec/panel/streams/<runId>/<lane>--<T-xxx>.jsonl`.
`summarizeStream()` translates any of the three into the SAME timeline
(`start`, `tool`, `thinking`, `output`, `text`, `end`) with size
trimming and incremental reading via a line cursor. Honest note: in headless the
`thinking` block usually comes redacted (empty + signature); the
`system/thinking_tokens` count shows activity without inventing reasoning.

## Overall progress summary (src/core/summary.js)

`onp-spec summary [feature]` is the answer to "what's happening right now?" in
text — the agent posts this paragraph to the chat every ~1 min while an
execution is running; **there is no server or web UI**: the tracking is chat and
terminal, by product decision. `--table` (`progressTable()`) prints the
**progress table** in markdown — one line per task (where it runs, status
⏳/▶️/✅/❌ and the last stream action; cells sanitized of pipes and line breaks),
with a footer of failed lanes and gate — ready for the agent to paste into the
chat alongside the text; the execution runs in the background and the user gets
the full summary at the end.

Two sources, always labeled: `ai` (the claude/codex executor writes it via
`summary --save --source ai --text`; in Antigravity the agent itself writes
it) and `engine` (deterministic: `deterministicSummary()` narrates the ledger
tree — completed ones, the running task with its last stream action via
`lastAction()` (cheap NDJSON tail), failures/conflicts and gate). Freshness rule
in `buildCurrentSummary()`: an AI summary older than 2 min loses to the engine's —
a stale text claiming "running" would be a lie. `--context` prints the
mechanical state the narrator model consumes.

## Lessons layer (src/core/signals.js + src/core/lessons.js)

The agent brings the judgment (phrasing the general rule); the engine owns
everything mechanical. Two files, both written only by the engine:

- `.spec/verification/signals.json` — **signal history**: every `audit` finding
  and every `verify` failure/skip becomes an entry
  keyed by `(code, feature, ref)` with an occurrence count. Keyed, not
  append-only: it grows with distinct failure points, not with executions.
  Automatic compaction by window (`windowDays`, default 90) and ceiling
  (`maxSignals`, default 20000, keeping the most recent).
- `.spec/lessons.json` (+ rendered `LESSONS.md`) — the lessons.

Lifecycle of a lesson:

| Transition | Who decides | Rule |
|---|---|---|
| — → rejected | engine | `LESSON_NO_GROUNDING`: no `(signal, feature, source)` signal in history; text > 280 chars is also rejected |
| — → candidate | engine | valid backing; exact-after-normalization dedup (NFD without accents, lowercase, no punctuation) by `signal::text` |
| candidate → confirmed | engine | recurrence in `promotionThreshold` (default 2) DISTINCT features — only confirmed ones enter the guide |
| confirmed → quarantine | engine | `quarantineThreshold` (default 2) penalties via `lessons penalize` |
| candidate → pruned | engine | stagnant beyond `windowDays` without corroboration |

`lessons suggest` inverts the flow: it groups the history by signal code and
points to those that recurred in `promotionThreshold`+ distinct features with few
associated lessons — the engine says WHERE a lesson is worthwhile; the AI
phrases it.

Scale (validated in test/lessons-scale.test.js): listing with a fixed ceiling
(`listLimit`, default 10 — context cost doesn't grow with the repo),
hierarchical scope (`billing/invoice` matches filter `billing`), evidence
limited to 5 per lesson. Thresholds configurable in `onpspec.config.json` (key
`lessons`). The `lessons` command doesn't load the project — listing the guide is
cheap even with hundreds of features.

## Benchmark (benchmark/ folder)

Real specs from the ONP domain (class enrollment, homework submission, student
grades). For each tool (spec-kit, OpenSpec, onp-spec-driven), the harness:
1. Materializes the SAME real spec in the tool's format.
2. Seeds real defects (removes a test, requirement without coverage, silent
   assumption, privacy violation, ID drift).
3. Runs the tool's native validator and counts how many defects it detects
   mechanically.
4. Emits RESULTS.md with the detection rate + capability matrix + setup time.
