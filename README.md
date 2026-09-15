# onp-spec-driven

> **Attribution:** this repository is a project based on
> [onovoprogramador/onp-spec-driven](https://github.com/onovoprogramador/onp-spec-driven).

**The specification that stays true.** You describe the feature, the AI agent
specifies, plans, runs in parallel, and **proves** it did the work — with
mechanical auditing, not with a promise. If the spec and the code drift apart,
the machine flags it.

```
┌─────────┐  ┌────────┐  ┌───────┐  ┌──────┐  ┌─────────┐  ┌───────┐
│ SPECIFY │→ │ DESIGN │→ │ TASKS │→ │ PLAN │→ │ EXECUTE │→ │ AUDIT │
└─────────┘  └────────┘  └───────┘  └──────┘  └─────────┘  └───────┘
                                       ↑ parallelism      ↑ the mechanical gate
```

## Installation (2 minutes)

The skill is **self-sufficient**: the mechanical engine already ships embedded
inside it (zero dependencies — it only needs Node.js ≥ 18 in the environment,
which your agent already uses). Installing means placing a folder in the right
spot — and the command below does that for you. Pick your agent:

### Claude Code

At the **root of your project**, run:

```bash
npx https://github.com/Acaua-Rangel/onp-spec-driven.git init --agents claude
```

The command does two things:

1. creates the project's `.spec/` structure (constitution of principles +
   configuration file — both editable, with ready-made defaults);
2. installs the skill into `.claude/skills/onp-spec-driven/` — the skills
   directory that Claude Code reads in this project.

**To activate:** open a new conversation in Claude Code. The skill kicks in on
its own when your request matches it ("specify feature X", "audit against the
spec"...).

### Codex

At the **root of your project**, run:

```bash
npx https://github.com/Acaua-Rangel/onp-spec-driven.git init --agents codex
```

The command does two things:

1. creates the project's `.spec/` structure;
2. installs the skill into `.agents/skills/onp-spec-driven/` — the skills
   directory that Codex reads in the repository.

**To activate:** open a new conversation. The skill kicks in on its own when
your request matches it, or invoke it explicitly with `$onp-spec-driven`.

> **Your tokens, your choice:** before running any plan, the agent shows the
> **model and effort for each task** and asks whether they fit your license.
> You answer in the conversation: keep them, save on everything, tune a
> specific task, or propose whatever model you want — the agent adjusts the
> plan for you. Nothing runs without your confirmation.

### GitHub Copilot

At the **root of your project**, run:

```bash
npx https://github.com/Acaua-Rangel/onp-spec-driven.git init --agents copilot
```

The command does two things:

1. creates the project's `.spec/` structure;
2. installs the skill into `.github/skills/onp-spec-driven/` — the skills
   directory that GitHub Copilot reads in the repository.

**To activate:** open a new Copilot Chat conversation. The skill loads on
demand when your request matches it.

### Cursor

At the **root of your project**, run:

```bash
npx https://github.com/Acaua-Rangel/onp-spec-driven.git init --agents cursor
```

The command does two things:

1. creates the project's `.spec/` structure;
2. installs the skill into `.cursor/skills/onp-spec-driven/` — Cursor supports
   Agent Skills natively since 2.4, in the editor and in the CLI.

**To activate:** open a new conversation. The skill kicks in on its own when
your request matches it, or invoke it explicitly by typing `/onp-spec-driven`
in the Agent chat.

**For automatic parallel execution**, the executor uses the Cursor CLI in
headless mode. If you don't have it yet, install it and log in:

```bash
curl https://cursor.com/install -fsS | bash
agent login
```

Without the CLI, the plan still works on the manual route: the prompts for
each lane come ready for you to paste into the parallel agents in the Agents
Window.

> **Your tokens, your choice:** in Cursor, `claude-*`/`gpt-*` models are billed
> per usage and `composer` (the in-house model) has usage included in the paid
> plans. Before running any plan, the agent shows the **model for each task**
> and asks whether it fits your plan — you answer in the conversation (keep it,
> swap everything to `composer`, tune a task, or propose another model) and the
> agent adjusts for you. Nothing runs without your confirmation.

### Antigravity

At the **root of your project**, run:

```bash
npx https://github.com/Acaua-Rangel/onp-spec-driven.git init --agents antigravity
```

The command does two things:

1. creates the project's `.spec/` structure;
2. installs the skill into `.agents/skills/onp-spec-driven/` — the Antigravity
   workspace skills directory.

**To activate:** open a new conversation and you're set — parallel execution
uses Antigravity's native agents, without depending on any CLI.
### Gemini

At the **root of your project**, run:

```bash
npx https://github.com/Acaua-Rangel/onp-spec-driven.git init --agents gemini
```

The command does two things:

1. creates the project's `.spec/` structure;
2. installs the skill into `.gemini/skills/onp-spec-driven/` — the skills
   directory Gemini reads in the project.

**To activate:** open a new conversation and you're set — parallel execution
uses new Gemini sessions per lane, without depending on any CLI. Gemini also
reads the `GEMINI.md` created at the project root on every turn.

### The agent memory file (created automatically)

Beyond the skill, `init --agents <agent>` writes the agent's **native
memory/instructions file** at the project root — the always-loaded context
that reminds the agent, every conversation, that this project is
spec-anchored and how to drive the flow:

| Agent | Memory file |
|---|---|
| Claude Code | `CLAUDE.md` |
| Codex · Cursor · Antigravity | `AGENTS.md` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Gemini | `GEMINI.md` |

An existing file is **never overwritten** — if you already keep one, add the
spec-driven flow to it by hand.

Download the repository once and copy the skill folder for your agent into the
project. The destination folder is **always** named `onp-spec-driven`:

```bash
git clone --depth 1 https://github.com/Acaua-Rangel/onp-spec-driven.git /tmp/onp-spec

# Claude Code (in this project)
mkdir -p .claude/skills
cp -r /tmp/onp-spec/skills/onp-spec-driven .claude/skills/onp-spec-driven

# Codex (in this project)
mkdir -p .agents/skills
cp -r /tmp/onp-spec/skills/onp-spec-driven-codex .agents/skills/onp-spec-driven

# GitHub Copilot (in this project)
mkdir -p .github/skills
cp -r /tmp/onp-spec/skills/onp-spec-driven-copilot .github/skills/onp-spec-driven

# Cursor (in this project)
mkdir -p .cursor/skills
cp -r /tmp/onp-spec/skills/onp-spec-driven-cursor .cursor/skills/onp-spec-driven

# Antigravity (in this workspace)
mkdir -p .agents/skills
cp -r /tmp/onp-spec/skills/onp-spec-driven-antigravity .agents/skills/onp-spec-driven

# Gemini (in this project)
mkdir -p .gemini/skills
cp -r /tmp/onp-spec/skills/onp-spec-driven-gemini .gemini/skills/onp-spec-driven
```

### Global installation — the skill across all your projects

Prefer installing **just once**, for all projects? Copy the skill into your
agent's global directory (instead of the project directory). The rule is the
same: **the destination folder is named `onp-spec-driven`** — Cursor, for
example, requires the folder name to match the skill's internal name, and
copying it as `onp-spec-driven-cursor` would make it invalid.

```bash
git clone --depth 1 https://github.com/Acaua-Rangel/onp-spec-driven.git /tmp/onp-spec

# Claude Code (global)
mkdir -p ~/.claude/skills
cp -r /tmp/onp-spec/skills/onp-spec-driven ~/.claude/skills/onp-spec-driven

# Codex (global)
mkdir -p ~/.agents/skills
cp -r /tmp/onp-spec/skills/onp-spec-driven-codex ~/.agents/skills/onp-spec-driven

# GitHub Copilot (global)
mkdir -p ~/.copilot/skills
cp -r /tmp/onp-spec/skills/onp-spec-driven-copilot ~/.copilot/skills/onp-spec-driven

# Cursor (global)
mkdir -p ~/.cursor/skills
cp -r /tmp/onp-spec/skills/onp-spec-driven-cursor ~/.cursor/skills/onp-spec-driven

# Antigravity (global)
mkdir -p ~/.gemini/config/skills
cp -r /tmp/onp-spec/skills/onp-spec-driven-antigravity ~/.gemini/config/skills/onp-spec-driven

# Gemini (global)
mkdir -p ~/.gemini/skills
cp -r /tmp/onp-spec/skills/onp-spec-driven-gemini ~/.gemini/skills/onp-spec-driven
```

With the skill installed globally, the `.spec/` structure is still per project
— but you don't have to run anything: in the first conversation, just ask
*"initialize onp-spec here"* and the agent creates everything (the skill's
embedded engine handles it).

> **Important:** each agent has ITS OWN skill — Claude Code's runs the plan
> with parallel headless Claude sessions; Codex's, with headless `codex exec`
> sessions; Cursor's, with headless Cursor CLI sessions (`agent -p`);
> Antigravity's uses its own
> native parallel agents; GitHub Copilot's and Gemini's use their native agents.
> **Codex and
> Antigravity read the same directory** (`.agents/skills/`), so install there
> the skill for the agent you use in this project — `init` refuses to overwrite
> one agent's skill with another's.
> **Heads up with Cursor:** besides its own directory (`.cursor/skills/`),
> Cursor also reads `.agents/skills/` natively and `.claude/skills/` /
> `.codex/skills/` for compatibility — in a project that already has ANOTHER
> agent's skill installed, Cursor would see two skills with the same name and
> could load the wrong one. Use ONE agent's skill per project (`init --agents
> cursor` warns if it finds another variant installed).

## How to use it — you talk, the agent proves

You **don't need to learn a single command**. The `onp-spec …` commands that
appear across the repository are internal to the skill: the agent runs them for
you and pastes the proof into the conversation. Your job is to talk:

> *"Specify the student enrollment feature."*
>
> *"Great. Break it into tasks and generate the execution plan."*
>
> *"Go ahead and run it in parallel. Update me every minute."*
>
> *"Lane 2 failed — re-run just that one."*
>
> *"Audit what was done against the spec and show me the proof."*

What you get back, always in plain language:

- **Readable specification** in `.spec/features/<feature>/` — user stories and
  acceptance criteria written for humans (the technical detail goes in
  parentheses), plus the **assumptions** and **open questions** the agent is
  required to confess.
- **Execution plan with optional parallelism** — tasks that don't touch each
  other MAY run **in parallel**, each in its own clean window (git worktree +
  its own branch). But you decide: the agent presents the plan as a
  **recommendation** (*"X of these tasks can run in parallel"*) and **asks WHICH
  ones you want to parallelize** — all, just some (the chosen ones in parallel,
  the rest one after another at the end) or none (everything in order, on the
  main tree) — always with the same commit discipline and the same gate.
- **You always know what's going on** — before running, the agent warns that
  the changes will run **in the background**; while they run, every 1 minute it
  posts to the chat the **progress table** (which task is running, which isn't,
  what completed/failed) and the **overall progress summary**: a paragraph in
  plain language (written by AI, with an engine fallback). At the end, you get
  the full execution summary.
- **A lane failed? redo just that one** — ask *"re-run only lane 2"* and the
  agent repeats only that lane, from scratch and in a clean window, without
  touching what already passed.
- **Commit and branch management handled** — 1 task = 1 traceable commit,
  organized merges, clean tree at the end.
- **The proof** — at the end, the mechanical audit: every acceptance criterion
  has a test that passed, or the feature **is not done**. The verdict is an exit
  code, not a sentence from the agent.

## Why "spec-anchored" (and not spec-first)

Spec Kit, Kiro, OpenSpec — all of them are **spec-first**: the spec generates
the code, the code evolves, and the spec becomes well-formatted fiction. Here
it's **spec-anchored**: spec and code evolve together because a mechanical gate
forces the alignment, all the time. The difference shows up the day someone asks
"does this still work the way it's written?" — and the answer is a command, not
a meeting.

## What the skill guarantees

1. **End-to-end traceability** — every story, acceptance criterion and task has
   an ID; every criterion points to the test that proves it. "Which requirement
   has no test?" is a question the machine answers.
2. **"Done" is the machine's verdict** — the agent can't declare victory: the
   test runner decides, and **a skipped test doesn't count as proof**.
3. **Mandatory assumptions and questions** — whatever the agent assumed without
   confirming is recorded with a status; a feature doesn't close with an open
   assumption. You point at the screen: *"it assumed you can't resubmit — is
   that right?"*
4. **Project constitution** — non-negotiable rules (ready-made LGPD/education
   preset: "a student's grade is never exposed to another student", "personal
   data never in logs") with executable verification, traced down to file and
   line.
5. **Lessons with backing** — the project learns from feature to feature, but
   only a lesson anchored in a real recorded failure gets in; a loose opinion is
   rejected.
6. **Planned parallel execution** — tasks with disjoint files run at the same
   time, in clean context windows, with branches and commits organized by the
   plan — and the final gate closes everything.

## Does it really work?

Benchmark with real domain specs and defects that actually plague SDD projects,
measuring **mechanical detection** (what CI catches on its own):

| Tool | Defect detection | |
|---|---|---|
| **onp-spec-driven** | **100%** (9/9) | ✅ clean baseline |
| OpenSpec | 11% (1/9) | only incomplete requirement |
| spec-kit | 0% mechanical | scaffolding; optional tests |

Details and full matrix: [benchmark/RESULTS.md](benchmark/RESULTS.md).
Complete, runnable example: [examples/class-enrollment](examples/class-enrollment).

## For the curious

The engine the skill embeds also exists as a standalone CLI
(`npm i -g @onovoprogramador/onp-spec`) and runs in CI — the same audit that
blocks the agent blocks the pipeline. Architecture, full catalog of findings and
file formats: [ARCHITECTURE.md](ARCHITECTURE.md). The guide the agent follows
lives in the skill itself:
[skills/onp-spec-driven/SKILL.md](skills/onp-spec-driven/SKILL.md).

## Requirements

Node.js ≥ 18. No other dependencies — neither for you, nor for the agent.

## License

MIT © Vitor Manoel — O Novo Programador
