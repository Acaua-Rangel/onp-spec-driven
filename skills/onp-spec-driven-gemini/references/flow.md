# Detailed flow — from zero to a clean audit

## Full example: "homework submission"

> `onp-spec <cmd>` abbreviates `node <this-skill-dir>/scripts/onp-spec.mjs
> <cmd>`, always from the ROOT of the project (embedded engine — nothing to
> install).

```bash
# 1. initialize the project (once)
onp-spec init --preset lgpd-education

# 2. new feature
onp-spec new homework-delivery
```

Edit `.spec/features/homework-delivery/spec.md`:

```markdown
# Spec: Homework delivery

> feature: homework-delivery
> status: in-implementation

## Stories

### US-001 — Student submits within the deadline

As a student, I want to submit my homework before the deadline, so that it
counts as on time.

#### AC-001 — Submission before the deadline is "on time"

- **Given** an authenticated student with an open assignment
- **When** they submit the file before the cutoff time
- **Then** the submission is recorded with status "on time"

#### AC-002 — Submission after the deadline is "late"

- **Given** an authenticated student with an open assignment
- **When** they submit after the cutoff time
- **Then** the submission is recorded with status "late"

## Assumptions

| ID | Assumption | Status | Resolution |
|---|---|---|---|
| ASM-001 | Work cannot be resubmitted after grading | open | — |

## Open questions

| ID | Question | Status | Answer |
|---|---|---|---|
| Q-001 | Which timezone defines the deadline? | open | — |
```

```bash
# 3. every acceptance criterion becomes an executable test (the definition of done)
onp-spec scaffold homework-delivery
# → creates test/homework-delivery.spec.test.js with FAILING tests
#   (includes skeletons for constitution principles with verification(test))
```

## Parallelizing: `onp-spec plan` (2+ pending tasks)

With the tasks written in `tasks.md` (with honest `Files:`), the engine
assembles the execution plan:

```bash
onp-spec plan homework-delivery
```

- Tasks with **disjoint files** become **parallel lanes**: 1 lane =
  1 git worktree + 1 branch (`spec/<feature>-lane-N`) + 1 clean context
  window. Tasks that share a file fall into the same lane, in sequence;
  a task without `Files:` runs alone at the end.
- Optional per-task fields in tasks.md: `- Model: claude-sonnet-5` and
  `- Effort: high` (low|medium|high|xhigh|max) — the plan uses them in the
  executors.
- Always outputs `plan-execution.md` (lanes, waves, branch/commit
  management, merge order and the final gate). In the **Claude Code**
  skill, it also outputs `run-tasks.sh` (headless claude in parallel, with
  `--model`/`--effort` per task) and `plan-execution.html` (visual, with a
  "Run all tasks in clean, parallel windows" button). In the
  **Gemini** skill (same as Antigravity), the plan brings a
  ready-made prompt per lane, for a new Gemini session per lane —
  no CLI dependency.
- Commit management belongs to the plan: **1 task = 1 commit**
  (`T-003 <feature>: <title>`), `--no-ff` merges back into the work branch
  `spec/<feature>`, and the final gate (verify + audit) runs after
  everything is merged.

Regenerate the plan whenever tasks.md or the `parallel` config changes — the
artifacts warn that they should not be hand-edited.

Now implement the logic and fill in the tests (or let the plan run it). Run:

```bash
# 4. the runner proves it (or not) — a SKIPPED test doesn't count as proof
onp-spec verify homework-delivery

# 5. the gate — paste the output; exit 0 or it's not done
onp-spec audit --ci
```

## The status table

Run `onp-spec status` at any time:

```
feature                        status             criteria  with-test  proven  assumptions?  questions?
────────────────────────────────────────────────────────────────────────────────────────────────────────
homework-delivery               in-implementation          2          2       1            1           1
```

Read as: 2 acceptance criteria, both with an annotated test, but only 1
proven so far; 1 assumption and 1 question still open. The feature
**cannot** move to `implemented` with assumption ASM-001 open — the audit
will block with "open assumption" (`ASM_OPEN`).

## CI integration

In your pipeline (GitHub Actions, GitLab CI):

In CI you can use the same embedded engine (committed alongside the skill)
or the npm package `@onovoprogramador/onp-spec` (CI mode):

```yaml
- run: node .gemini/skills/onp-spec-driven/scripts/onp-spec.mjs verify homework-delivery
- run: node .gemini/skills/onp-spec-driven/scripts/onp-spec.mjs audit --ci
```

## Why this kills vibecoding

The AI agent can't say "I implemented everything" and slip through: if an
acceptance criterion has no test, the audit flags it; if the test never
passed, the audit flags it; if the agent renamed a requirement and forgot
the test, the audit flags an orphan test (`TEST_ORPHAN`); if the agent
SKIPPED the test (skip/todo), verify rejects the proof and the audit flags
a criterion without proof (`AC_NO_PROOF`). The proof isn't the agent's word
— it's the exit code.
