// Agent memory/instructions file — the always-loaded context that tells the
// agent, on EVERY conversation, that this project uses spec-anchored
// development and how to drive the flow. Complements the on-demand skill: the
// skill carries the deep guidance, this file guarantees the agent knows it
// exists and must be used. `init --agents <agent>` writes it (create-if-absent
// — an existing file is never overwritten).

// The native memory-file convention of each agent (relative to the project root).
export const MEMORY_FILE_BY_AGENT = {
  claude: 'CLAUDE.md',
  antigravity: 'AGENTS.md',
  codex: 'AGENTS.md',
  cursor: 'AGENTS.md',
  copilot: '.github/copilot-instructions.md',
  gemini: 'GEMINI.md',
};

// Full-flow memory file: the agent reads this on every turn. `enginePath` is
// the project-relative path to the embedded engine (onp-spec.mjs) so the
// commands are copy-paste ready in the user's project.
export function renderAgentMemory(agent, { label, enginePath } = {}) {
  const onp = `node ${enginePath}`;
  return `# Spec-anchored development (onp-spec-driven)

This project uses **spec-anchored development**: the specification is
mechanically audited against the code, so it never silently drifts. You don't
trust that the work was done — **the machine proves it, via exit code**.
${label ? `\nThis file targets **${label}**.\n` : ''}
When the user asks to specify, plan, implement, verify or audit a feature,
follow the flow below. The deep guidance lives in the \`onp-spec-driven\`
skill (installed in this project) — load it on demand; this file is the
always-on reminder that it must be used.

## The engine (zero install)

The mechanical engine ships embedded in the skill. Run every command from the
**root of the project**:

\`\`\`bash
${onp} <command>
\`\`\`

(Below, \`onp-spec <command>\` abbreviates that invocation.) If \`node\` is not
available, degrade gracefully: audit by hand and label the result
**\`WEAK PROOF (manual audit)\`** — never present it as the mechanical gate.

## The flow

\`\`\`
SPECIFY → DESIGN → TASKS → PLAN → EXECUTE → VERIFY → AUDIT → LEARN
 always   if needed if large 2+ tasks always   gate    ALWAYS   loop
\`\`\`

1. **Specify** — \`onp-spec new <feature>\` scaffolds
   \`.spec/features/<feature>/spec.md\` and \`tasks.md\` with globally unique
   tracking codes. Write **user stories (US-xxx)** and **acceptance criteria
   (AC-xxx)** in Given/When/Then, in plain wording the product owner
   understands. **Write every artifact — spec, tasks, tests, commit messages —
   in English, even when the conversation is in another language.**
   Record **assumptions (ASM-xxx)** and **open questions (Q-xxx)** — the
   absent section is itself a problem; if there are none, write "None." and be
   suspicious. Before specifying a weighty technical decision (security,
   crypto, auth, payments, concurrency…), research the state of the art and
   fold it into the spec and the constitution.
2. **Design** (large features) — architecture and components; every non-obvious
   decision becomes an assumption or an open question.
3. **Tasks** — write \`tasks.md\` with \`Refs:\` (stories/criteria) and \`Files:\`
   (comma-separated) — that is what the audit and the plan read. \`Files:\`
   decides what runs in parallel (disjoint) vs. sequentially (shared).
4. **Plan** (2+ tasks) — \`onp-spec plan <feature>\`. The engine groups tasks
   with disjoint files into parallel lanes (1 lane = 1 git worktree + 1 branch
   + 1 clean window). **WHICH tasks to parallelize is the USER's choice** —
   present the recommendation and ASK before executing (\`--parallelize
   T-xxx,T-yyy\` for a subset, \`--sequential\` for one after another).
5. **Execute** — \`onp-spec scaffold <feature>\` generates a FAILING test for
   every acceptance criterion (the definition of done is born executable).
   Implement until the tests pass. **1 task = 1 atomic commit**
   (\`T-003 <feature>: <title>\`). Update status with
   \`onp-spec task <feature> <T-xxx> <status>\`.
6. **Verify** — \`onp-spec verify <feature>\` runs the tests and records the
   proof per criterion. **The test runner decides — a skipped test is not
   proof.**
7. **Audit** — \`onp-spec audit --ci\` is the verdict. Exit 0 = aligned. Paste
   the output. If it didn't exit 0, it is NOT done.
8. **Learn** — after a clean audit, \`onp-spec lessons suggest\` then record at
   most 3 grounded lessons (\`onp-spec lessons add\`). A clean path → no lesson.

## Execution contract (non-negotiable)

1. Every acceptance criterion becomes an annotated test (\`@spec:AC-xxx\` in the
   title). Without it, the criterion does not exist for the machine.
2. The test runner decides whether a criterion passed — never you. A skipped
   test (skip/todo) is not proof.
3. The feature only closes when \`onp-spec audit --ci\` exits 0. Running the
   audit and pasting the output is the last step, always.
4. Assumptions and open questions are mandatory. A feature does not become
   \`implemented\`/\`audited\` with an open assumption.
5. The constitution (\`.spec/constitution.md\`) rules. Fix the code to satisfy a
   \`[MUST]\` principle — never weaken the principle.
6. **Never weaken, skip or delete a test to make it pass.** "Don't give up
   until exit 0" means iterating the IMPLEMENTATION. If the audit fails 3 times
   in a row on the same problem, STOP and escalate to the user.

## Speak in plain language

The files use short tracking codes to link spec, tasks and tests for the
machine, but with the user always speak the full name (the code in parentheses
only when needed): user story (US), acceptance criterion (AC), task (T),
assumption (ASM), open question (Q), principle (P), definition of done (DoD).

**Write the files in English.** The spec, tasks, tests and commit messages stay
in English — the project's tracking codes, statuses and Given/When/Then
keywords are English, and mixing languages breaks that consistency. Keep
CHATTING with the user in their own language; only the artifacts are English.

## Golden rule

If you are about to say "done", run \`onp-spec audit --ci\` and paste the
output. If it didn't exit 0, it's not done. Here, "done" is something the
machine verifies — not something you say.
`;
}
