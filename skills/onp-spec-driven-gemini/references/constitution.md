# Constitution — principles the machine verifies

The constitution (`.spec/constitution.md`) encodes **non-negotiable**
constraints of the project. It's not style; it's law. And, unlike other
tools, here every `[MUST]` principle has an **executable check** — otherwise
the audit flags "principle without a check" (`PRINCIPLE_NO_CHECK`).

## Obligation levels

- `[MUST]` — mandatory. Needs a check. Violation = audit error.
- `[RECOMMENDED]` — strong. Check optional. Violation = warning.
- `[MAY]` — allowed/explicit. Documents a conscious choice.

## Four kinds of checks

```markdown
## P-001 [MUST] Every requirement has executable proof
- verification(gate): intrinsic to the audit
```
→ satisfied by the audit mechanism itself (criterion without a test,
criterion without proof, task done without proof). Only for "meta"
principles about the process — domain rules use the forms below.

```markdown
## P-001 [MUST] A student's grade is never exposed to another student
- verification(test): @principle:P-001
```
→ requires at least one test with `@principle:P-001` in the title that
passes in verify. You write the test that proves the principle.

```markdown
## P-004 [MUST] Personal data never in logs
- verification(forbidden): `console\.log\(.*ssn` in `src/**/*.js`
```
→ the audit greps the pattern across the glob's files. Any hit = violation,
with the exact file and line (traceability principle → file → line).

```markdown
## P-010 [MUST] Every grade route goes through checkOwnership()
- verification(required): `checkOwnership\(` in `src/routes/grades/**/*.js`
```
→ if files exist in the glob but none contains the pattern, it's a
violation.

## LGPD + education preset

`onp-spec init --preset lgpd-education` already ships with real principles
for products that store student data (including minors):

- **P-001** grade never exposed to another student (test)
- **P-002** grade access is logged — audit trail (test)
- **P-003** minors' data only with explicit legal basis (test)
- **P-004** personal data never in logs (forbidden, grep)
- **P-005** collection minimization (recommended)
- **P-006** pedagogical mistake is not punitive data (recommended)
- **P-007** deletion on the data subject's request (may)
- **P-008** portability of the student's data (may)

Adjust the globs/regex to your stack — they actually run in the audit, so
they need to point at your files. Engine guard-rails:

- glob that matches NO file → "verification looks at no files"
  (`GLOB_NO_FILES` — inert check, likely a typo);
- level outside [MUST]/[RECOMMENDED]/[MAY] → "invalid principle level"
  (`LEVEL_INVALID` — the principle is treated as MUST, never ignored);
- regexes run in a subprocess with a time limit (5s) — a pathological
  pattern (catastrophic backtracking) becomes "malformed check"
  (`CHECK_MALFORMED`), it doesn't hang the gate;
- the principle test skeleton (`verification(test)`) is born in
  `scaffold`, alongside the acceptance criteria tests.

## Traceability that gives a security edge

A banking microservices case study reported 73% fewer security defects when
principles were traced down to file and line. That's exactly what
`verification(forbidden)` and `verification(required)` do: every violation
comes out with `file:line`, not "review the code".
