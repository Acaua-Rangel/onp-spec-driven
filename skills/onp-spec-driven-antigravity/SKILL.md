---
name: onp-spec-driven
description: Native spec-anchored development for Antigravity — the spec stays true because it's mechanically audited against the code. Specify → Design → Tasks → Plan → Execute → Audit → Learn flow, with story→acceptance-criterion→task→test traceability, an executable definition of done (every acceptance criterion becomes an annotated test), assumptions and open questions as first-class citizens, a verifiable constitution (LGPD/education preset), lessons learned with mechanical grounding, and an execution plan with OPTIONAL PARALLELISM: the agent presents the recommended plan and ALWAYS asks WHICH tasks the user wants to parallelize (lanes with git worktrees + Antigravity's native parallel agents via --parallelize, or one task after another via --sequential), warns that execution runs in the background and, during it, posts a progress table in the chat every 1 minute (what's running and what isn't) + an overall summary — with a full summary at the end. Integrates with Artifacts (task.md, implementation_plan.md, walkthrough.md) and Slash Commands (/goal, /grill-me, /schedule, /learn). Mechanical engine EMBEDDED in the skill (zero install — runs with the environment's node). Use when planning features, implementing with verification, or auditing an implementation against the spec. Triggers "specify feature", "new feature", "implement", "audit spec", "verify", "execution plan", "run in parallel", "what has no test", "lessons learned".
license: MIT
metadata:
  author: Vitor Manoel — O Novo Programador
  version: 3.6.0
  agent: antigravity
---

# onp-spec-driven — the spec that stays true (Antigravity)

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

## Interaction — use the full potential of Antigravity

This skill runs natively inside Antigravity. Use the native features
(Artifacts and Slash Commands) to keep the flow visible and interactive,
without turning it into bureaucracy:

- **Explain what you did and where it is**: after EVERY action, say in
  plain language (1) what was done, (2) the path of every file created or
  changed, (3) what the next step is. The user should never need to ask
  "where's the file?" or "now what?".
- **Task list (tasks Artifact)**: when starting execution, create and
  maintain Antigravity's task list Artifact (task.md) with one item per
  task (T-xxx), updating `[ ]`, `[/]`, `[x]` at each step — the user
  follows along visually. Let Antigravity resolve where the artifact
  lives; never assume a fixed internal path.
- **Design and decisions (`implementation_plan.md` Artifact)**: during the
  Design phase and the execution Plan, write the plan in that artifact
  with `request_feedback = true`. Map the open questions (Q-xxx) and
  assumptions (ASM-xxx) to force user review BEFORE execution. Let them
  know they can use `/grill-me` to answer in interview mode.
- **Validation and summary (`walkthrough.md` Artifact)**: once `verify`
  and `audit --ci` come back clean, update the walkthrough with the
  results, the recorded lessons, and the mechanical proof (the audit
  output).
- **Slash Commands** — recommend them at the right moment:
  - `/goal`: to close out an entire feature — iterate implementation +
    `verify` + `audit --ci` until exit 0. Persisting means actually
    implementing; the contract rules (below) still apply inside `/goal`.
  - `/grill-me`: interview session to clarify requirements and design
    (resolves Q-xxx and confirms ASM-xxx).
  - `/schedule`: monitor long test suites or background tasks.
  - `/learn`: after solving a hard, project-specific problem, suggest
    `/learn` so Antigravity retains the behavior — on top of the
    mechanical lessons from `onp-spec lessons`.
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
resolved **relative to this SKILL.md's directory** (never assume a fixed
install path). There's nothing to install: no npm, no npx, no global CLI.

All commands run **from the root of the user's project**:

```bash
node <this-skill-dir>/scripts/onp-spec.mjs <command>
```

Commands: `init [--preset base|lgpd-education]` · `new <feature>` ·
`plan <feature> [--agents antigravity] [--parallelize T-xxx,T-yyy] [--sequential]` ·
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
   always — the walkthrough.md summarizes it, but the raw output is the
   proof.
4. **Assumptions and open questions are mandatory.** Filled a gap without
   confirming it? That's an assumption. Missing information? That's an
   open question. The absent section is also a problem
   (`SECTION_MISSING`) — if there are none, write "None." and be
   suspicious.
5. **The constitution rules.** `[MUST]` principles are verified; violating
   them breaks the audit. Never fix the principle to "make it pass" — fix
   the code.
6. **Never weaken, skip, or delete a test to make it pass.** This ALSO
   applies inside `/goal`: "don't give up until exit 0" means iterating
   the IMPLEMENTATION, never loosening the gate. Outside `/goal`, if the
   audit fails 3 times in a row on the same problem, STOP and escalate to
   the user via `implementation_plan.md` with the findings ranked — don't
   iterate forever or work around the gate.

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

## Step by step in Antigravity

### 1. Specify

- **Before writing, load the learned guide**: `onp-spec lessons list`
  (on a large project, filter: `--scope <domain>`).
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
- Write the **user stories (US-xxx)** and **acceptance criteria (AC-xxx)**
  in Given/When/Then, in language the product owner understands.
- **Record assumptions (ASM-xxx) and open questions (Q-xxx)** with an
  honest status (`open`). User present? Suggest `/grill-me` and record
  the answers in the spec.
- Run `onp-spec audit` and read the flagged problems.
- Writing details: [writing-specs.md](references/writing-specs.md).

### 2. Design (large features)

Write the `implementation_plan.md` Artifact with architecture and
components, `request_feedback = true`. Every non-obvious decision becomes
an assumption (you assumed it) or an open question (needs the product
owner). Highlight both lists in the plan.

### 3. Tasks

- **Mechanical anchor first:** write the tasks in
  `.spec/features/<feature>/tasks.md` with `Refs:` (stories/criteria) and
  `Files:` (comma-separated) — that's what the audit and the plan read.
  Optional per-task fields: `Model:` and `Effort:`
  (low|medium|high|xhigh|max).
- **Visualization comes after:** mirror the tasks in Antigravity's task
  list Artifact for `[ ]`/`[/]`/`[x]` tracking.
- **Closed tasks.md? Announce parallelism and ASK WHICH.** Run
  `onp-spec plan <feature>` and present the plan to the user, unprompted,
  as a RECOMMENDATION: *"X of these Y tasks can run IN PARALLEL, across
  N lanes — I recommend it this way."* Then ask (in chat or via
  `implementation_plan.md` with `request_feedback = true`): **which
  tasks do they want to parallelize?** — all of them (the
  recommendation), a subset, or none (one after another). It's their
  choice — never execute without that answer, and never leave the
  parallelism as the engine's secret.

### 4. Execution plan (2+ pending tasks)

- **WHICH tasks to parallelize is the USER's choice — ask before
  executing** (in `implementation_plan.md` with `request_feedback =
  true`, or directly in chat; if you didn't ask during the Tasks phase,
  ask now). Chose all → use the plan as-is. Chose a subset → regenerate
  with `onp-spec plan <feature> --parallelize T-xxx,T-yyy` and follow
  that. Chose none → regenerate with `--sequential`. No answer, don't
  execute.
- `onp-spec plan <feature>` (if detection gets it wrong, force it with
  `--agents antigravity`). The engine groups tasks with **disjoint
  files** into **parallel lanes** — 1 lane = 1 git worktree + 1 branch +
  1 clean context window — and writes
  `.spec/features/<feature>/plan-execution.md` with: the worktree
  commands, **a ready-made prompt per lane**, the merge order, commit
  management, and the final gate. With `--parallelize`: only the CHOSEN
  tasks go into lanes (the rest run one after another, at the end). With
  `--sequential`: one prompt per task, in order, to run on the main tree
  — no worktrees.
- Mirror the summary (lanes or order, branches) in
  `implementation_plan.md` with `request_feedback = true` — the user
  approves BEFORE execution.
- **Parallel execution uses Antigravity's native agents**: a NEW agent
  per lane (clean window), each in its own worktree, with the plan's
  prompt. In sequential mode, you run the prompts yourself, in order.
  This skill NEVER depends on the Claude CLI — that's the sibling
  Claude Code skill.
- **Before executing, WARN — always**: tell the user, in one sentence,
  that the changes will run in the **background** (the agents work in
  their own windows), that every 1 minute you'll post the **progress
  table** in the chat, and that at the end they'll get the **full
  summary** of the run. Only then dispatch the agents.
- **Table + summary every 1 minute (mandatory while running)**: post the
  **progress table** in the chat (`onp-spec summary <feature> --table` —
  one line per task: what's running, what isn't, what finished/failed)
  and a short paragraph (2 to 4 sentences, plain language) of what's
  happening, recording it in the ledger:
  `onp-spec summary <feature> --save --source ai --text "..."`. No time
  to write it? `onp-spec summary <feature> --save` records the engine's
  summary. The user is never left not knowing what's going on.
- **Mark progress in the ledger** (that's what the table and summary are
  built from): when starting/finishing each task, run the `event`
  command that plan-execution.md provides ready-made (state
  `running`/`done`/`failed`) and, when done, `onp-spec task <feature>
  <T-xxx> done`.
- **Finished? Deliver the full summary**: the final table, what each
  task did (commits), what failed (if anything did), and the gate's
  output (verify + audit) pasted and translated into one sentence.
- Small feature or the user wants it simple? Run the lanes yourself, in
  sequence — the plan still holds as the branch/commit roadmap.

### 5. Execute

- Mark `[/]` and `[x]` in the tasks Artifact as the mechanical tasks.md
  gets updated with `onp-spec task <feature> <T-xxx> <status>`.
- `onp-spec scaffold <feature>` generates a **failing** test skeleton for
  every acceptance criterion without a test — the definition of done is
  born executable.
- Implement until the tests pass. **1 task = 1 atomic commit** (message:
  `T-003 <feature>: <title>`). Mark `[done]` only with proof.
- Finished a lane? Merge `--no-ff` into the work branch, in plan order; a
  conflict stops it and asks the user.

### 6. Verify and Audit (the gate)

- `onp-spec verify <feature>` — runs the tests and records the proof per
  criterion in `.spec/verification/<feature>.json`. Only PASS counts
  (skip is not proof). It runs ONLY the test files tagged with that
  feature's `@spec:AC-xxx` (when the runner accepts file paths), so it stays
  fast in big repos. Several features? One command — `verify <f1> <f2>` or
  `verify --all` — runs the tests once. Run it when the audit flags
  `AC_NO_PROOF` / `VERIFY_STALE` for that feature, not after every small edit.
- `onp-spec audit --ci` — the verdict. Exit 0 = aligned. **Paste the
  output in the conversation**, translate it in one sentence, and then
  update `walkthrough.md`.
- Failed? Fix and re-audit — inside `/goal`, keep going until it exits 0
  (iterating the implementation); outside it, at most 3 iterations on the
  same problem before escalating to the user.
- Full flow with an example: [flow.md](references/flow.md).

### 7. Learn (closes the loop)

After the audit exits 0: the path to get here was recorded on its own in
the signal history (every audit problem and every verify failure/skip).

- `onp-spec lessons suggest` — the engine points out signals that
  recurred across distinct features and still have no lesson.
- Record **at most 3 lessons** with `onp-spec lessons add --signal
  <CODE> --feature <f> --source <AC-xxx> --text "general rule in one
  sentence"`. The engine REFUSES a lesson without a real signal
  (`LESSON_NO_GROUNDING`) — don't force it.
- **Clean path → no lesson.** That's correct, not an omission.
- Close out the `walkthrough.md` Artifact with: what was delivered, where
  each file is, the audit output, and the recorded lessons.
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
(`AC_INCOMPLETE`), criterion without a task (`AC_NO_TASK`), open question
(`Q_OPEN`), principle without a check (`PRINCIPLE_NO_CHECK`), stale proof
(`VERIFY_STALE`), malformed check (`CHECK_MALFORMED`, includes a regex
that exceeds the time limit), file doesn't exist (`FILE_MISSING`),
invalid status (`STATUS_INVALID`), spec without a story (`SPEC_NO_US`),
criterion outside a story (`AC_OUTSIDE_US`).

## Questions the engine answers for you

- **"Which requirement has no test?"** → `onp-spec audit` → acceptance
  criterion without a test (`AC_NO_TEST`).
- **"Which test doesn't map to a requirement?"** → orphan test
  (`TEST_ORPHAN`).
- **"Which code doesn't satisfy any requirement?"** → orphan code
  (`FILE_ORPHAN`).
- **"What are we assuming?"** → `onp-spec assumptions`.
- **"What can be done in parallel?"** → `onp-spec plan <feature>` — and
  WHICH tasks to parallelize is the user's choice, via a question.
- **"What's happening right now?"** → `onp-spec summary <feature>
  --table` (the progress table) + `onp-spec summary <feature>` (the
  text) — and you're the one recording the summary every ~1 min
  (`--save --source ai --text "..."`) and posting the table and text in
  the chat.
- **"Where do things stand?"** → `onp-spec status`.

## Context loading

Load references on demand (in the phase that needs them), never all at
once. Never load specs from two features at the same time. Constitution:
[constitution.md](references/constitution.md).

## Golden rule

If you're about to say "done", run `onp-spec audit --ci` and paste the
output. If it didn't exit 0, it's not done. Here, "done" is something the
machine verifies — not something you say.
