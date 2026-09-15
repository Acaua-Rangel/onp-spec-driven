# Writing auditable specifications

## An acceptance criterion needs to be observable

The audit engine doesn't understand prose — it understands tests. So every
acceptance criterion needs to describe something a test can check.

| Bad (not testable) | Good (observable) |
|---|---|
| The system should be fast | **Then** the response arrives in under 300ms |
| The password should be secure | **Then** passwords shorter than 8 characters are rejected |
| The student sees their grades | **Then** the response contains only the authenticated student's grades |

## And it needs to be friendly — the product owner will read it

The acceptance criterion is the contract with the person who does NOT code.
Write the title and the Then as an **outcome the user can see and check**,
not as an internal detail:

| Too technical | Friendly (and equally testable) |
|---|---|
| **Then** the endpoint returns 403 | **Then** the screen warns "you don't have access" (and the response is 403) |
| **Then** the job writes to Redis | **Then** the late warning appears within 1 minute |
| AC-004 — flag `is_late` true | AC-004 — Late submission is flagged to the teacher |

Practical rule: read the criterion out loud to an outsider — if they don't
understand what will happen, rewrite it. The technical detail can stay in
parentheses; the main sentence is for people.

## Given / When / Then — all three are mandatory

The audit flags "incomplete acceptance criterion" (`AC_INCOMPLETE`) if any
clause is missing. The parser tolerates indentation, a `-` or `*` marker, and
upper/lowercase in the keyword (and files saved as NFD on macOS) — but the
canonical format is `- **Given** ...`. Use `And` to continue the last clause:

```markdown
#### AC-003 — Late warning

- **Given** a student with an overdue task
- **When** they open the task
- **Then** they see a late warning
- **And** the submit button is disabled
```

## Assumptions vs. open questions

- **Assumption (ASM-xxx)**: you filled a gap with a reasonable guess and
  **moved on**. E.g.: "I assume the deadline is always end of day".
  Status: `open` → `confirmed` (the product owner validated it) or
  `invalidated`.
- **Open question (Q-xxx)**: you **stopped** because information is
  missing. E.g.: "which timezone?". Status: `open` → `answered`.

Hard rule: a feature doesn't become `implemented`/`audited` with an `open`
assumption. This forces the conversation "hey, I assumed X — is that right?"
before considering it done. If the user is in the conversation, ask right
away (AskUserQuestion) instead of letting the assumption age.

Even harder rule: the ABSENCE of the `## Assumptions` and
`## Open questions` sections is also a problem (`SECTION_MISSING` — error
with a mature spec). None at all? Write "None." explicitly — and be
suspicious: almost every feature hides an assumption.

## Tracking codes are global and unique

`US-xxx` (user story), `AC-xxx` (acceptance criterion), `ASM-xxx`
(assumption), `Q-xxx` (question), `T-xxx` (task) and `P-xxx` (principle) are
unique across the whole project. `onp-spec new` continues the numbering
automatically. If you duplicate one, the audit flags a duplicate code
(`ID_DUPLICATE`).

## The spec's status lifecycle

```
draft → ready → in-implementation → implemented → audited
```

- `draft`: writing.
- `ready`: spec reviewed, assumptions and questions handled, ready to
  implement.
- `in-implementation`: code in progress. Open questions become a warning.
- `implemented`: code ready. Open assumptions become an **error**.
- `audited`: `audit --ci` exited 0 with proof for every acceptance criterion.

## Tasks: field format

- `Refs:` — codes separated by comma/space. Codes are GLOBAL: a task can
  reference an acceptance criterion from another feature.
- `Files:` — paths separated by COMMA (spaces inside a path are valid):
  `Files: src/my module.js, src/other.js`. Take care here: this field
  decides what the execution plan runs IN PARALLEL (disjoint files) and
  what runs sequentially (shared file).
- `Model:` and `Effort:` (optional) — used by `onp-spec plan` for the
  task's executor: `- Model: claude-opus-5` · `- Effort: high`
  (low|medium|high|xhigh|max). Without them, the config defaults apply
  (`parallel.model`, `parallel.effort`).
- Status: `[pending]` / `[in-progress]` / `[done]` — a token outside the
  list is "invalid task status" (`TASK_STATUS_INVALID`, error), never
  silently ignored. To update without hand-editing:
  `onp-spec task <feature> <T-xxx> <status>`.
