---
name: onp-spec-driven
description: Spec-anchored development — the specification stays true because it is mechanically audited against the code. Specify → Design → Tasks → Plan → Execute → Audit → Learn flow, with story→acceptance-criterion→task→test traceability, executable definition of done (every acceptance criterion becomes an annotated test), assumptions and open questions as first-class citizens, constitution of verifiable principles (LGPD/education preset), lessons learned with mechanical backing (the engine refuses a lesson without a real audit/verify signal; promotion by recurrence across features) and an execution plan with OPTIONAL PARALLELISM: the agent presents the recommended plan and ALWAYS asks WHICH tasks the user wants to parallelize (lanes with git worktrees + headless claude via --parallelize, or one task after another via --sequential), warns that the run happens in the background and, while it runs, posts a progress table in chat every 1 minute (what's running and what isn't) + overall summary — with a full summary at the end. Mechanical engine EMBEDDED in the skill (zero install — runs with the environment's node). Use when planning features, implementing with verification, or auditing an implementation against the spec. Triggers "specify feature", "new feature", "implement", "audit spec", "verify", "execution plan", "run in parallel", "what has no test", "lessons learned". Do NOT use for technical design docs (use technical-design-doc-creator) nor architecture decomposition analysis.
license: MIT
metadata:
  author: Vitor Manoel — O Novo Programador
  version: 3.6.0
  agent: claude
---

# onp-spec-driven — the specification that stays true

Most SDD tools are **spec-first**: the spec generates code, the code evolves,
and the spec becomes a lie. This one is **spec-anchored**: the spec is
mechanically audited against the code, at all times. You don't trust that the
agent obeyed — **the machine proves it, via exit code**.

```
┌─────────┐  ┌────────┐  ┌───────┐  ┌──────┐  ┌─────────┐  ┌───────┐
│ SPECIFY │→ │ DESIGN │→ │ TASKS │→ │ PLAN │→ │ EXECUTE │→ │ AUDIT │
└─────────┘  └────────┘  └───────┘  └──────┘  └─────────┘  └───────┘
   always     if needed    if big    2+ tasks    always     ALWAYS (gate)
```

## Vocabulary — always speak in plain language

**Write the artifacts in English.** The spec, tasks, tests and commit messages
always stay in English — the tracking codes, statuses and Given/When/Then
keywords are English, so writing them in another language breaks the
consistency the machine relies on. Keep TALKING to the user in their own
language; only the files are in English.

The files use short **tracking codes** (that's what links spec, tasks and
tests in the machine). But with the user you **always speak the name in
full** — the code goes in parentheses when you need it:

| Code | Name you use with the user |
|---|---|
| US-xxx | **user story** — who needs it, what they need and why |
| AC-xxx | **acceptance criterion** — observable outcome a test checks |
| T-xxx | **task** — implementation step |
| ASM-xxx | **assumption** — gap filled with a guess, still unconfirmed |
| Q-xxx | **open question** — decision the product owner still has to make |
| P-xxx | **principle** (from the constitution) — non-negotiable project constraint |
| DoD | **definition of done** — the set of acceptance criteria with proof |

Example: say "acceptance criterion AC-003 (late warning) still has no test",
never "AC-003 is missing its @spec tag". Never require the user to know the
acronyms to understand what you said.

## Interaction — use the harness in the user's favor

This skill runs inside Claude Code. Use the native features to keep the flow
visible and interactive, without turning it into bureaucracy:

- **Explain what you did and where it is**: after EVERY action, say in plain
  language (1) what was done, (2) the path of each file created or changed,
  (3) what the next step is. The user should never need to ask "where's the
  file?" or "now what?".
- **Native todo list (TodoWrite)**: when starting a feature, create one todo
  per phase ("Specify homework-submission", "Write tests", "Implement",
  "Audit"...). For big features, one todo per task (T-xxx) in the Execute
  phase. Keep the status updated at every step — that's how the user tracks
  where you are without having to ask.
- **Interactive questions (AskUserQuestion)**: when an open question or an
  assumption that needs confirmation comes up and the user is present, ask
  right away with concrete options — and record the answer in the spec
  (status `answered`/`confirmed`). Don't pile up questions in silence, nor
  decide alone what belongs to the product owner.
- **Translate the engine's output**: after every command, summarize in 1–3
  plain-language sentences what the machine said and what the next step is.
  Paste the raw output too (it's the proof), but never hand it over alone.
- **Respect the advanced user**: if the user shows they know the flow (uses
  the codes, asks for direct commands), cut the didactic explanations and go
  straight to the point. The translation gets shorter; the rigor (verify +
  audit) never does.

## The embedded engine (zero install)

The mechanical engine lives INSIDE this skill, at `scripts/onp-spec.mjs` —
resolved **relative to this SKILL.md's directory** (the harness tells you the
skill's base directory when loading it; never assume a fixed install path).
There's nothing to install: no npm, no npx, no global CLI.

All commands run **from the root of the user's project**:

```bash
node <this-skill-dir>/scripts/onp-spec.mjs <command>
```

Commands: `init [--preset base|lgpd-education]` · `new <feature>` ·
`plan <feature> [--agents claude] [--parallelize T-xxx,T-yyy] [--sequential]` ·
`summary [feature] [--table] [--save --text "..."]` ·
`task <feature> <T-xxx> <status>` ·
`scaffold <feature> [--force]` · `verify <feature>` ·
`audit [--ci] [--json] [--md <file>]` · `status` · `assumptions` ·
`lessons <add|list|suggest|penalize|status>`.

Below, `onp-spec <command>` abbreviates this invocation.

**Graceful degradation** — if `node` doesn't exist in the environment: run
the audit manually (reread spec/tasks/tests cross-checking each problem in
the catalog below) and label the result, in text, as
**`WEAK PROOF (manual audit)`**. Never present a manual audit as if it were
the mechanical gate.

## Execution contract — non-negotiable

1. **Every acceptance criterion becomes an annotated test** with
   `@spec:AC-xxx` in the title. Without an annotated test, the criterion
   doesn't exist for the machine.
2. **The test runner decides whether an acceptance criterion passed**, never
   you. `onp-spec verify` runs the tests and records the proof. You cannot
   declare victory. **A skipped test (skip/todo) is not proof** — the engine
   refuses it and the audit flags it.
3. **The feature only closes when `onp-spec audit --ci` exits with code 0.**
   Running the audit and **pasting the output** is always the last step.
4. **Assumptions and open questions are mandatory.** Filled a gap without
   confirming? That's an assumption. Missing information? That's an open
   question. A missing section is also a problem (`MISSING_SECTION`) — if
   there are none, write "None." and be suspicious.
5. **The constitution rules.** [MUST] principles are verified; violating
   them breaks the audit. Never fix the principle to "make it pass" — fix
   the code.
6. **Never weaken, skip, or delete a test to make it pass.** If the audit
   fails 3 times in a row on the same problem, STOP and present the findings
   to the user — don't iterate forever nor bypass the gate.

## Auto-sizing

| Scope | Specify | Design | Tasks | Plan | Execute |
|---|---|---|---|---|---|
| Small (≤3 files) | lean spec | skip | implicit | skip | implement + verify + audit |
| Medium (<10 tasks) | full spec | inline | inline | if 2+ tasks | implement + verify + audit |
| Large (multi-component) | spec + design | design.md | tasks.md | always | per lane + verify + audit |

**Always mandatory:** Specify and Audit.
**Safety valve:** even skipping Tasks, start Execute by listing the atomic
steps. If more than 5 steps show up, or dependencies between them, STOP and
create `tasks.md` — the phase was skipped by mistake.

## Step by step

### 1. Specify

- **Before writing, load the learned guide**: `onp-spec lessons list`
  (in a large project, filter: `--scope <domain>`). These are rules
  confirmed by real failures in previous features — apply them in the spec.
- **Before specifying AND before detailing the tasks, search the web for the
  domain's best practice**: any feature with a weighty technical decision
  (security, cryptography, authentication, payments, concurrency, formats,
  accessibility...) requires discovering the state of the art BEFORE writing
  acceptance criteria and tasks. Do a web search and bring what you found
  into the spec (it becomes an observable acceptance criterion) and into the
  constitution (it becomes a [MUST] principle); record the source, and if
  you can't confirm it on the spot, leave it as an assumption (ASM-xxx).
  E.g.: password hashing isn't "store the hash" — current practice is
  **Argon2id** with a **global pepper** + **per-user salt** and cost
  calibrated against GPU/brute-force attacks.
- **When unsure HOW to implement, ask the user's preference — always**: when
  there's more than one reasonable path (library, approach, format,
  trade-off) and the research alone doesn't decide it, STOP and ask with
  concrete options (pros/cons in one line each). Never decide alone what
  belongs to the user; record the answer in the spec, and if you proceed
  without confirming, leave it explicit as an assumption (ASM-xxx).
- `onp-spec new <feature>` creates `.spec/features/<feature>/spec.md` and
  `tasks.md` with continuous tracking codes (unique across the whole
  project).
- Write the **user stories (US-xxx)** and, for each one, the **acceptance
  criteria (AC-xxx)** in Given/When/Then. The criterion needs to be
  observable — something a test checks. "Should be fast" is not a criterion;
  "responds in < 300ms" is.
- **Record assumptions (ASM-xxx) and open questions (Q-xxx)** with an honest
  status (`open`). User present? Ask right away (AskUserQuestion) and record
  the answer.
- Run `onp-spec audit` and read the flagged problems (incomplete criterion,
  story without a criterion, missing section...) — they tell you what's
  missing.
- Writing details: [writing-specs.md](references/writing-specs.md).

### 2. Design (large features)

Create `design.md` with architecture and components. Every non-obvious
decision becomes either an assumption (you assumed it) or an open question
(needs the product owner).

### 3. Tasks

- In `tasks.md`, break it down into **tasks (T-xxx)**. Each task has `Refs:`
  (the stories/criteria it addresses — codes are global, it can reference a
  criterion from another feature) and `Files:` (comma-SEPARATED; spaces in
  paths are allowed). Optional per-task fields: `Model:` and `Effort:`
  (low|medium|high|xhigh|max) — the execution plan uses both.
- Status in brackets: `[pending]`, `[in-progress]`, `[done]` (unknown token
  is an error).
- **Closed tasks.md? Announce the parallelism and ASK WHICH.** Run
  `onp-spec plan <feature>` and present the plan to the user, without them
  asking, as a RECOMMENDATION: *"X of these Y tasks can run IN PARALLEL, in
  N lanes — I recommend this."* Then ask (AskUserQuestion, multiSelect):
  **which tasks do they want to parallelize?** The options are the
  parallelizable tasks — the recommendation (all) marked "(Recommended)";
  more than 4? group by lane. Include the "none — one after another" option.
  The choice is theirs — never execute without that answer, and never leave
  the parallelism as the engine's secret.

### 4. Execution plan (2+ pending tasks)

- **WHICH tasks to parallelize is the USER's choice — ask before
  executing** (the multiSelect question from the Tasks phase; if you
  haven't asked yet, ask now). Chose all → use the plan as is. Chose a
  subset → regenerate with `onp-spec plan <feature> --parallelize
  T-xxx,T-yyy` and run that. Chose none → regenerate with `--sequential`.
  No answer, don't execute.
- `onp-spec plan <feature>` groups tasks with **disjoint files** into
  **parallel lanes** — 1 lane = 1 git worktree + 1 branch + 1 clean context
  window; with `--parallelize T-xxx,T-yyy`, only the CHOSEN ones enter the
  lanes (the rest run one after another, at the end, on the main tree);
  with `--sequential`, ALL tasks run one after another, in tasks.md order.
  Three artifacts in `.spec/features/<feature>/`:
  - `plan-execution.md` — lanes/order, branch/commit management and gate;
  - `run-tasks.sh` — headless executor: runs `claude -p` with `--model`
    and `--effort` already set per task (per lane in parallel, or one task
    at a time in sequential mode), merges whatever there is to merge, marks
    the tasks and closes with verify + audit;
  - `plan-execution.html` — read-only visual of the plan (no button).
- **Present the plan to the user**: summarize the lanes (or the order, in
  sequential mode), say where the files are and offer the routes —
  automatic (YOU run `bash .spec/features/<feature>/run-tasks.sh` in the
  background, with run_in_background) or manual (you implement it yourself,
  following the plan's branches and commits).
- **Before executing, WARN — always**: tell the user, in one sentence, that
  the changes will run in the **background**, that every 1 minute you'll
  post the **progress table** here, and that at the end they get the **full
  summary** of the run. Only then run the script.
- **Table + summary every 1 minute (mandatory while running)**: with the
  script in the background, every ~1 min post in chat the **progress
  table** (`onp-spec summary <feature> --table` — one line per task: which
  is running, which isn't, what completed/failed and the last action) and
  the **summary** (`onp-spec summary <feature>` — the executor writes an
  AI-written summary every minute to the ledger; fallback: engine). The
  same text is printed in the script's terminal (`📣 summary`). Also mirror
  the tasks in the native list (TodoWrite). The user is never left not
  knowing what's going on.
- **Done? Deliver the full summary**: the final table, what each task did
  (commits), what failed (if anything failed) and the gate's output
  (verify + audit) pasted and translated into one sentence.
- **A lane failed? Don't re-run everything.** Read the log and the stream,
  understand the cause, and run `run-tasks.sh --lane <id>` (the previous
  attempt's worktree and branch are cleaned up first); `--seq <T-xxx>`
  redoes one task, `--gate` runs just the verdict, and `--list` shows the
  targets. Work that already passed stays intact.
- Did tasks.md or the config (`parallel` in onpspec.config.json) change?
  **Regenerate the plan** — never hand-edit the artifacts.

### 5. Execute

- Mirror the tasks in the native todo list and keep updating the status —
  the user tracks progress in real time. In the mechanical tasks.md, use
  `onp-spec task <feature> <T-xxx> <status>`.
- `onp-spec scaffold <feature>` generates a **failing** test skeleton for
  every acceptance criterion without a test — and also for every
  constitution principle with `verification(test)` still untagged. The
  definition of done is born executable.
- Implement until the tests pass. **1 task = 1 atomic commit** (the message
  cites the task: `T-003 <feature>: ...`). Mark `[done]` only with PASS
  proof.
- At least one test per acceptance criterion; the test asserts the spec's
  outcome, not your code's shape.

### 6. Verify and Audit (the gate)

- `onp-spec verify <feature>` — runs the tests, records the proof per
  acceptance criterion in `.spec/verification/<feature>.json`. Only PASS
  counts (skip is not proof).
  It runs ONLY the test files tagged with that feature's `@spec:AC-xxx` (when
  the runner accepts file paths), so it stays fast in big repos. Several
  features? One command — `onp-spec verify <f1> <f2>` or `verify --all` —
  runs the tests once. Run it when the audit flags `AC_NO_PROOF` /
  `VERIFY_STALE` for that feature, not after every small edit.
- `onp-spec audit --ci` — the verdict. Exit 0 = aligned. Exit 1 = read each
  problem and resolve it. **Paste the final output in the conversation**
  and translate what it means in one sentence.
- Failed? Fix and re-audit — **3 iterations** max; if it persists, stop and
  escalate to the user with the problems ranked.
- Full flow with an example: [flow.md](references/flow.md).

### 7. Learn (closes the loop)

After the audit exits 0: the path to get here was recorded on its own in the
signal history (every audit problem and every verify failure/skip).

- `onp-spec lessons suggest` — the engine points out signals that recurred
  across distinct features and still have no lesson.
- Record **at most 3 lessons** with `onp-spec lessons add --signal <CODE>
  --feature <f> --source <AC-xxx> --text "general rule in one sentence"
  [--scope <domain>]`. The engine REFUSES a lesson without a real signal
  registered (`LESSON_NO_GROUNDING`) — if it refuses, the lesson doesn't
  exist; don't force it.
- **Clean path → no lesson.** That's correct, not an omission.
- Wording, promotion, penalization and scale: [lessons.md](references/lessons.md).

## Catalog of problems the audit flags

The audit prints every problem with the readable name in front and the
stable code in parentheses (the code is for CI and for `lessons add
--signal`). When talking to the user, use the readable name.

| Problem (code) | What it means | What to do |
|---|---|---|
| acceptance criterion without a test (AC_NO_TEST) | requirement without proof | write the test with `@spec:AC-xxx` in the title |
| acceptance criterion without proof (AC_NO_PROOF) | test exists, never passed (or was SKIPPED) | run `verify`; skip is not proof |
| orphan test (TEST_ORPHAN) | test points to a criterion that vanished (drift!) | the spec changed — update the test |
| broken reference (REF_BROKEN) | task cites a nonexistent story/criterion | fix the reference |
| task done without proof (TASK_DONE_NO_PROOF) | task [done] without a proven criterion | verify or reopen the task |
| invalid task status (TASK_STATUS_INVALID) | unrecognized status | use pending/in-progress/done |
| open assumption (ASM_OPEN) | open assumption in a "ready" feature | confirm/invalidate with the user |
| missing required section (SECTION_MISSING) | spec without an Assumptions/Questions section | record them or write "None." |
| violated principle (PRINCIPLE_VIOLATED) | broke the constitution | fix the code, not the principle |
| verification looks at no files (GLOB_NO_FILES) | constitution glob matches nothing | fix the glob |
| invalid principle level (LEVEL_INVALID) | unrecognized level | use [MUST]/[RECOMMENDED]/[MAY] |
| orphan code (FILE_ORPHAN) | code no task maps to | map it in a task or question the code |
| divergent feature name (FEATURE_MISMATCH) | `> feature:` differs from the directory | align the two |
| weak proof (PROOF_WEAK) | proof only via global exit code | prefer the tap/vitest-json/jest-json reporter |
| short/duplicate tracking code (ID_SHORT / ID_DUPLICATE) | outside the grammar / repeated | use 3+ digits, unique codes |

Also: story without a criterion (`US_NO_AC`), incomplete criterion
(`AC_INCOMPLETE`), criterion without a task (`AC_NO_TASK`), open
question (`Q_OPEN`), principle without a check
(`PRINCIPLE_NO_CHECK`), stale proof (`VERIFY_STALE`), malformed
check (`CHECK_MALFORMED`, includes a regex that exceeds the
time limit), file doesn't exist (`FILE_MISSING`), invalid status
(`STATUS_INVALID`), spec without a story (`SPEC_NO_US`), criterion
outside a story (`AC_OUTSIDE_US`).

## Questions the engine answers for you

- **"Which requirement has no test?"** → `onp-spec audit` → acceptance
  criterion without a test (`AC_NO_TEST`).
- **"Which test doesn't map to a requirement?"** → orphan test
  (`TEST_ORPHAN`).
- **"Which code doesn't satisfy any requirement?"** → orphan code
  (`FILE_ORPHAN`).
- **"What are we assuming?"** → `onp-spec assumptions`.
- **"What can be done in parallel?"** → `onp-spec plan <feature>` — and
  WHICH tasks to parallelize is the user's choice, via a question
  (multiSelect).
- **"What's running right now?"** → `onp-spec summary <feature> --table`
  (the progress table) + `onp-spec summary <feature>` (the text); post both
  in chat every ~1 min while there's a run in progress.
- **"Only one lane failed, how do I redo just that one?"** →
  `bash <baseDir>/run-tasks.sh --lane <id>`.
- **"Where are we?"** → `onp-spec status`.

## Context loading

Load references on demand (in the phase that needs them), never all at once.
Never load specs from two features at the same time. Constitution:
[constitution.md](references/constitution.md).

## Golden rule

If you're about to say "done", run `onp-spec audit --ci` and paste the
output. If it didn't exit 0, it's not done. Here, "done" is something the
machine verifies — not a sentence of yours.
