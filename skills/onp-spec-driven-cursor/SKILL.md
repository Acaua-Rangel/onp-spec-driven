---
name: onp-spec-driven
description: Native spec-anchored development for Cursor — the spec stays true because it's mechanically audited against the code. Use when planning features, implementing with verification, or auditing an implementation against the spec. Triggers "specify feature", "new feature", "implement", "audit spec", "verify", "execution plan", "run in parallel", "what has no test", "lessons learned". Specify → Design → Tasks → Plan → Execute → Audit → Learn flow, with story→acceptance-criterion→task→test traceability, an executable definition of done (every acceptance criterion becomes an annotated test), assumptions and open questions as first-class citizens, a verifiable constitution (LGPD/education preset), lessons learned with mechanical grounding, and an execution plan with OPTIONAL PARALLELISM: the agent presents the recommended plan and ALWAYS asks WHICH tasks the user wants to parallelize (lanes with git worktrees + headless Cursor CLI `agent -p` sessions via --parallelize, or one task after another via --sequential) and ALWAYS confirms the MODELS per task before executing — the tokens and the Cursor plan are the user's; `claude-*`/`gpt-*` models are billed per use and `composer` has included usage; they lock in the cost with --model in the plan or per task via `onp-spec task`. Warns that execution runs in the background and, during it, posts a progress table in the chat every 1 minute (what's running and what isn't) + an overall summary — with a full summary at the end. Integrates with Cursor's native features (agent task list, Plan Mode, Ask Mode, Agents Window, explicit invocation with /onp-spec-driven). Mechanical engine EMBEDDED in the skill (zero install — runs with the environment's node).
license: MIT
metadata:
  author: Vitor Manoel — O Novo Programador
  version: 3.6.0
  agent: cursor
---

# onp-spec-driven — the spec that stays true (Cursor)

Most SDD tools are **spec-first**: the spec generates code, the code
evolves, and the spec becomes a lie. This one is **spec-anchored**: the spec
is mechanically audited against the code, at all times. You don't trust that
the agent obeyed — **the machine proves it, via exit code**.

```
┌────────┐  ┌──────┐  ┌───────┐  ┌───────┐  ┌────────┐  ┌───────┐
│ SPECIFY│→ │DESIGN│→ │ TASKS │→ │ PLAN  │→ │EXECUTE │→ │ AUDIT │
└────────┘  └──────┘  └───────┘  └───────┘  └────────┘  └───────┘
   always     if needed  if large  2+ tasks    always    ALWAYS (gate)
```

## Vocabulary — always speak in plain language

**Write the artifacts in English.** The spec, tasks, tests and commit messages
always stay in English — the tracking codes, statuses and Given/When/Then
keywords are English, so writing them in another language breaks the
consistency the machine relies on. Keep TALKING to the user in their own
language; only the files are in English.

The files use short **tracking codes** (that's what links spec, tasks, and
tests together for the machine). But with the user you always speak **the
name in full** — the code goes in parentheses only when it's needed:

| Code | Name you use with the user |
|---|---|
| US-xxx | **user story** — who needs it, what they need, and why |
| AC-xxx | **acceptance criterion** — observable outcome a test checks |
| T-xxx | **task** — implementation step |
| ASM-xxx | **assumption** — a gap filled with a guess, still unconfirmed |
| Q-xxx | **open question** — a decision the product owner still needs to make |
| P-xxx | **principle** (from the constitution) — non-negotiable project constraint |
| DoD | **definition of done** — the set of acceptance criteria with proof |

Example: say "acceptance criterion AC-003 (late warning) still has no
test", never "AC-003 is missing an @spec tag". Never require the user to
know the acronyms to understand what you said.

## Interaction — use Cursor's harness in the user's favor

This skill runs natively inside Cursor (the user can invoke it explicitly
by typing `/onp-spec-driven` in the Agent chat, or you take it on when the
request matches the description). Use the native features to keep the flow
visible and interactive, without turning it into bureaucracy:

- **Explain what you did and where it is**: after EVERY action, say in
  plain language (1) what was done, (2) the path of every file created or
  changed, (3) what the next step is. The user should never need to ask
  "where's the file?" or "now what?".
- **Agent task list**: when starting a feature, create an item per phase
  ("Specify homework-delivery", "Write tests", "Implement", "Audit"...). On
  large features, one item per task (T-xxx) in the Execute phase. Keep the
  status updated at each step — that's how the user follows where you are
  without needing to ask.
- **Direct questions in chat**: when an open question or an assumption that
  needs confirmation comes up and the user is present, ask right away, with
  concrete, numbered options (include your recommendation) — and record the
  answer in the spec (status `answered`/`confirmed`). Don't stockpile
  questions silently or decide alone something that's the product owner's
  call.
- **Cursor modes — recommend them at the right moment**:
  - **Plan Mode** (Shift+Tab in chat; `--mode=plan` in the CLI): to design
    the implementation BEFORE touching the code — useful during the Design
    and Plan phases. Cursor's plan complements (never replaces) `onp-spec
    plan`'s mechanical artifacts.
  - **Ask Mode** (`--mode=ask`): to explore the code without changing
    anything — good for answering the user's questions about the spec
    without risk.
  - **Agents Window / native worktrees**: a MANUAL alternative to the
    headless executor — the user can open one agent per lane and paste in
    the prompts already embedded in `run-tasks.sh`. The final gate is the
    same.
- **Translate the engine's output**: after each command, summarize in 1–3
  plain-language sentences what the machine said and what the next step
  is. Paste the raw output too (that's the proof), but never hand it over
  alone.
- **Respect the advanced user**: if the user shows they know the flow
  (uses the codes, asks for direct commands), cut the tutorial-style
  explanations and get straight to the point. The translation shortens
  things; the rigor (verify + audit) never does.

## The embedded engine (zero install)

The mechanical engine lives INSIDE this skill, at `scripts/onp-spec.mjs` —
resolved **relative to this SKILL.md's directory** (Cursor reports the
skill's directory when loading it; never assume a fixed install path).
There's nothing to install: no npm, no npx, no global CLI.

All commands run **from the root of the user's project**:

```bash
node <this-skill-dir>/scripts/onp-spec.mjs <command>
```

Commands: `init [--preset base|lgpd-education]` · `new <feature>` ·
`plan <feature> [--agents cursor] [--parallelize T-xxx,T-yyy] [--sequential]` ·
`summary [feature] [--table] [--save --source ai --text "..."]` ·
`task <feature> <T-xxx> <status>` ·
`scaffold <feature> [--force]` · `verify <feature>` ·
`audit [--ci] [--json] [--md <file>]` · `status` · `assumptions` ·
`lessons <add|list|suggest|penalize|status>`.

Below, `onp-spec <command>` abbreviates this invocation.

**Graceful degradation** — if `node` doesn't exist in the environment:
perform the audit manually (reread the spec/tasks/tests, cross-checking
each problem in the catalog below) and label the result, in text, as
**`WEAK PROOF (manual audit)`**. Never present a manual audit as if it were
the mechanical gate.

## Execution contract — non-negotiable

1. **Every acceptance criterion becomes an annotated test** with
   `@spec:AC-xxx` in the title. Without an annotated test, the criterion
   doesn't exist for the machine.
2. **The test runner decides whether an acceptance criterion passed**,
   never you. `onp-spec verify` runs the tests and records the proof. You
   can't declare victory. **A skipped test (skip/todo) is not proof** —
   the engine refuses it and the audit flags it.
3. **The feature only closes when `onp-spec audit --ci` exits with code
   0.** Running the audit and **pasting the output** is the last step,
   always.
4. **Assumptions and open questions are mandatory.** Filled a gap without
   confirming it? That's an assumption. Missing information? That's an
   open question. The absent section is also a problem
   (`SECTION_MISSING`) — if there are none, write "None." and be
   suspicious.
5. **The constitution rules.** `[MUST]` principles are verified; violating
   them breaks the audit. Never fix the principle to "make it pass" — fix
   the code.
6. **Never weaken, skip, or delete a test to make it pass.** Cursor's
   terminal may ask for approval on commands — request whatever permission
   is missing, never work around the test. If the audit fails 3 times in
   a row on the same problem, STOP and present the findings to the user —
   don't iterate forever or work around the gate.

## Auto-sizing

| Scope | Specify | Design | Tasks | Plan | Execute |
|---|---|---|---|---|---|
| Small (≤3 files) | lean spec | skip | implicit | skip | implement + verify + audit |
| Medium (<10 tasks) | full spec | inline | inline | if 2+ tasks | implement + verify + audit |
| Large (multi-component) | spec + design | design.md | tasks.md | always | per lane + verify + audit |

**Always mandatory:** Specify and Audit.
**Safety valve:** even if Tasks is skipped, start Execute by listing the
atomic steps. If more than 5 steps show up or dependencies between them
appear, STOP and create `tasks.md` — the phase was skipped by mistake.

## Step by step in Cursor

### 1. Specify

- **Before writing, load the learned guide**: `onp-spec lessons list`
  (on a large project, filter: `--scope <domain>`). These are rules
  confirmed by real failures in previous features — apply them to the
  spec.
- **Before specifying AND before detailing the tasks, web-search the
  domain's best practice**: every feature with a weighty technical
  decision (security, cryptography, authentication, payments,
  concurrency, formats, accessibility...) requires discovering the state
  of the art BEFORE writing acceptance criteria and tasks. Do a web
  search and bring what you found into the spec (it becomes an observable
  acceptance criterion) and into the constitution (it becomes a `[MUST]`
  principle); record the source, and if it can't be confirmed on the
  spot, leave it as an assumption (ASM-xxx). E.g.: password hashing isn't
  "store the hash" — current practice is **Argon2id** with a **global
  pepper** + **per-user salt** and a cost calibrated against GPU/brute-force
  attacks.
- **When unsure HOW to implement, ask the user's preference — always**:
  when there's more than one reasonable path (library, approach, format,
  trade-off) and the research doesn't decide it on its own, STOP and ask
  with concrete options (pros/cons in one line). Never decide alone
  something that's the user's call; record the answer in the spec, and
  if you proceed without confirming, make it explicit as an assumption
  (ASM-xxx).
- `onp-spec new <feature>` creates `.spec/features/<feature>/spec.md` and
  `tasks.md` with continuous tracking codes (unique across the whole
  project).
- Write the **user stories (US-xxx)** and, for each one, the **acceptance
  criteria (AC-xxx)** in Given/When/Then. The criterion needs to be
  observable — something a test checks. "Should be fast" isn't a
  criterion; "responds in < 300ms" is.
- **Record assumptions (ASM-xxx) and open questions (Q-xxx)** with an
  honest status (`open`). User present? Ask right away, in chat, with
  concrete options — and record the answer.
- Run `onp-spec audit` and read the flagged problems (incomplete
  criterion, story without a criterion, missing section...) — they tell
  you what's missing.
- Writing details: [writing-specs.md](references/writing-specs.md).

### 2. Design (large features)

Create `design.md` with architecture and components (Cursor's Plan Mode
helps design before coding). Every non-obvious decision becomes either an
assumption (you assumed it) or an open question (needs the product
owner).

### 3. Tasks

- In `tasks.md`, break the work into **tasks (T-xxx)**. Each task has
  `Refs:` (the stories/criteria it addresses — codes are global, it can
  reference a criterion from another feature) and `Files:` (comma
  separated; spaces in paths are allowed). Optional per-task field:
  `Model:` (a Cursor model slug, e.g. `composer`, `claude-sonnet-5`,
  `gpt-5.6-terra`; want to control reasoning effort? use the slug with a
  suffix, e.g. `gpt-5.6-terra-high` — **the Cursor CLI has no effort
  flag**, so the `Effort:` field is only informational in this plan).
  Model is **your proposal** — the user makes the final call, during the
  Plan phase's cost confirmation; to adjust without editing the file:
  `onp-spec task <feature> <T-xxx> --model <m>`.
- Status in brackets: `[pending]`, `[in-progress]`, `[done]` (an unknown
  token is an error).
- **Closed tasks.md? Announce parallelism and ASK WHICH.** Run
  `onp-spec plan <feature>` and present the plan to the user, unprompted,
  as a RECOMMENDATION: *"X of these Y tasks can run IN PARALLEL, across
  N lanes — I recommend it this way."* Then ask in chat: **which tasks
  do they want to parallelize?** List the parallelizable tasks as
  options — the recommendation (all of them) marked "(recommended)";
  more than 4? group them by lane. Include the option "none — one after
  another". It's their choice — never execute without that answer, and
  never leave the parallelism as the engine's secret.

### 4. Execution plan (2+ pending tasks)

- **WHICH tasks to parallelize is the USER's choice — ask before
  executing** (the question from the Tasks phase; if you haven't asked
  yet, ask now). Chose all → use the plan as-is. Chose a subset →
  regenerate with `onp-spec plan <feature> --parallelize T-xxx,T-yyy` and
  run that one. Chose none → regenerate with `--sequential`. No answer,
  don't execute.
- **The MODEL for each task is the USER's choice — confirm BEFORE
  executing.** The tokens and the Cursor plan are theirs: `claude-*` and
  `gpt-*` models are billed per use; `composer` (the house model) has
  usage included in paid plans. `onp-spec plan` already prints the
  "models for this plan" list (one line per task) — present it and ask,
  with concrete options: **(a)** keep it as-is (the recommendation);
  **(b)** save on everything — regenerate with `onp-spec plan <feature>
  --model composer` (locks ALL tasks and overrides tasks.md and config);
  **(c)** adjust per task — `onp-spec task <feature> <T-xxx> --model <m>`
  and regenerate the plan; **(d)** whatever model THEY propose — use what
  the user asks for, without arguing. Without this confirmation, don't
  execute. Never swap in a pricier model without the user asking for it.
  Reasoning effort? In Cursor it's embedded in the slug (e.g.
  `gpt-5.6-terra-high`) — explain that if the user asks for "high
  effort".
- `onp-spec plan <feature>` (if detection gets it wrong, force it with
  `--agents cursor`) groups tasks with **disjoint files** into **parallel
  lanes** — 1 lane = 1 git worktree + 1 branch + 1 clean context window;
  with `--parallelize T-xxx,T-yyy`, only the CHOSEN tasks go into lanes
  (the rest run one after another, at the end, on the main tree); with
  `--sequential`, ALL tasks run one after another, in tasks.md order.
  Three artifacts in `.spec/features/<feature>/`:
  - `plan-execution.md` — lanes/order, branch/commit management, and the
    gate;
  - `run-tasks.sh` — headless executor: runs the Cursor CLI (`agent -p`,
    with a fallback to the legacy name `cursor-agent`) with `--model`
    already set per task, `--output-format stream-json` output (the
    stream goes to the ledger), and `--force` — without `--force`
    Cursor's print mode doesn't modify files; fine-grained control still
    belongs to the user via `permissions.deny` in `.cursor/cli.json`,
    which OVERRIDES `--force` (per lane in parallel, or one task at a
    time in sequential mode). The script merges whatever needs merging,
    marks the tasks, and closes with verify + audit;
  - `plan-execution.html` — a visual of the plan (read-only, no button).
- **Executor requirement**: the Cursor CLI installed
  (`curl https://cursor.com/install -fsS | bash`) and logged in (`agent
  login` or `CURSOR_API_KEY`). Without the CLI, offer the manual route:
  each lane's prompts are embedded in the script — the user can paste
  them into parallel agents in the Agents Window (Cursor's native
  worktrees) and close it out with the gate.
- **Present the plan to the user**: summarize the lanes (or the order, in
  sequential mode), say where the files are, and offer the routes —
  automatic (YOU run `bash .spec/features/<feature>/run-tasks.sh` in a
  background terminal) or manual (you implement it yourself, following
  the plan's branches and commits).
- **Before executing, WARN — always**: with parallelism and costs already
  confirmed, tell the user, in one sentence, that the changes will run in
  the **background**, that every 1 minute you'll post the **progress
  table** here, and that at the end they'll get the **full summary** of
  the run. Only then run the script.
- **Table + summary every 1 minute (mandatory while running)**: with the
  script running in the background, every ~1 min post in the chat the
  **progress table** (`onp-spec summary <feature> --table` — one line
  per task: what's running, what isn't, what finished/failed, and the
  last action) and the **summary** (`onp-spec summary <feature>` — the
  executor records an AI-written summary in the ledger every minute;
  fallback: the engine). The same text is printed in the script's
  terminal (`📣 summary`). Also mirror the tasks in the agent's task
  list. The user is never left not knowing what's going on.
- **Finished? Deliver the full summary**: the final table, what each
  task did (commits), what failed (if anything did), and the gate's
  output (verify + audit) pasted and translated into one sentence.
- **A lane failed? Don't rerun everything.** Read the log and the
  stream, understand the cause, and run `run-tasks.sh --lane <id>` (the
  worktree and branch from the previous attempt are cleaned up first);
  `--seq <T-xxx>` redoes a single task, `--gate` runs only the verdict,
  and `--list` shows the targets. Work that already passed stays intact.
- Changed tasks.md or the config (`parallel` in onpspec.config.json)?
  **Regenerate the plan** — never hand-edit the artifacts.

### 5. Execute

- Mirror the tasks in the agent's task list and keep updating the status
  — the user follows the progress in real time. In the mechanical
  tasks.md, use `onp-spec task <feature> <T-xxx> <status>`.
- `onp-spec scaffold <feature>` generates a **failing** test skeleton for
  every acceptance criterion without a test — and also for every
  constitution principle with `verification(test)` still untagged. The
  definition of done is born executable.
- Implement until the tests pass. **1 task = 1 atomic commit** (the
  message cites the task: `T-003 <feature>: ...`). Mark `[done]` only
  with PASS proof.
- At least one test per acceptance criterion; the test asserts the
  spec's outcome, not your code's shape.

### 6. Verify and Audit (the gate)

- `onp-spec verify <feature>` — runs the tests, records the proof per
  acceptance criterion in `.spec/verification/<feature>.json`. Only PASS
  counts (skip is not proof).
  It runs ONLY the test files tagged with that feature's `@spec:AC-xxx` (when
  the runner accepts file paths), so it stays fast in big repos. Several
  features? One command — `onp-spec verify <f1> <f2>` or `verify --all` —
  runs the tests once. Run it when the audit flags `AC_NO_PROOF` /
  `VERIFY_STALE` for that feature, not after every small edit.
- `onp-spec audit --ci` — the verdict. Exit 0 = aligned. Exit 1 = read
  each problem and resolve it. **Paste the final output in the
  conversation** and translate what it means in one sentence.
- Failed? Fix and re-audit — at most **3 iterations** on the same
  problem before stopping and escalating to the user with the problems
  ranked.
- Full flow with an example: [flow.md](references/flow.md).

### 7. Learn (closes the loop)

After the audit exits 0: the path to get here was recorded on its own in
the signal history (every audit problem and every verify failure/skip).

- `onp-spec lessons suggest` — the engine points out signals that
  recurred across distinct features and still have no lesson.
- Record **at most 3 lessons** with `onp-spec lessons add --signal <CODE>
  --feature <f> --source <AC-xxx> --text "general rule in one sentence"
  [--scope <domain>]`. The engine REFUSES a lesson without a real signal
  registered (`LESSON_NO_GROUNDING`) — if it refuses, the lesson doesn't
  exist; don't force it.
- **Clean path → no lesson.** That's correct, not an omission.
- A durable project rule that doesn't depend on a signal (folder
  convention, build command)? Its place is the repository's `AGENTS.md`
  or a short rule in `.cursor/rules/` — suggest it to the user; the
  engine's lessons are only for what has mechanical grounding.
- Wording, promotion, penalization and scale: [lessons.md](references/lessons.md).

## Catalog of problems that the audit flags

The audit prints each problem with the readable name up front and the
stable code in parentheses (the code is used for CI and for `lessons add
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
  WHICH tasks to parallelize is the user's choice, via a question in
  chat.
- **"Can we run this cheaper?"** → `onp-spec plan <feature> --model
  composer` (everything — usage included in paid Cursor plans) or
  `onp-spec task <feature> <T-xxx> --model <m>` (per task, and
  regenerate the plan) — models ALWAYS go through the user's confirmation
  before executing.
- **"What's happening right now?"** → `onp-spec summary <feature>
  --table` (the progress table) + `onp-spec summary <feature>` (the
  text); post both in the chat every ~1 min while running.
- **"Only one lane failed, how do I redo just that one?"** →
  `bash <baseDir>/run-tasks.sh --lane <id>`.
- **"Where do things stand?"** → `onp-spec status`.

## Context loading

Load references on demand (in the phase that needs them), never all at
once. Never load specs from two features at the same time. Constitution:
[constitution.md](references/constitution.md).

## Golden rule

If you're about to say "done", run `onp-spec audit --ci` and paste the
output. If it didn't exit 0, it's not done. Here, "done" is something the
machine verifies — not something you say.
