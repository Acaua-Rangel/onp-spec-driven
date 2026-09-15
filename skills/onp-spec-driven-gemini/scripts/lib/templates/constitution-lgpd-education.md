# Constitution — v1.0.0 (preset: LGPD + Education)

<!--
  Principles for educational products that store students' personal data —
  including minors (LGPD art. 14: the child's best interest; consent from at
  least one parent/guardian).

  Levels: [MUST] mandatory · [RECOMMENDED] strong · [MAY] allowed/explicit.
  Every [MUST] needs an executable check. Accepted formats:
    - verification(test): @principle:P-xxx
    - verification(forbidden): `regex` in `glob`
    - verification(required): `regex` in `glob`

  Adjust the globs/regex to your stack — these are REAL starting points, not
  decoration: the audit runs each one of them.
-->

## P-001 [MUST] A student's grade is never exposed to another student

Every endpoint/query that returns a grade, correction or feedback filters by
the authenticated student. Aggregated listings (class average) do not identify
individuals.

- verification(test): @principle:P-001

## P-002 [MUST] Grade access is logged (audit trail)

Every read of a grade/correction records who accessed it, what and when.
LGPD art. 37: recording of processing operations.

- verification(test): @principle:P-002

## P-003 [MUST] Minors' data only with an explicit legal basis

Registering a minor student requires recorded guardian consent (who, when,
how). No minor's data is used for marketing.

- verification(test): @principle:P-003

## P-004 [MUST] Personal data never appears in logs

CPF, email, phone and grade never go to console/log in plain text.

- verification(forbidden): `console\.(log|error|warn)\(.*(cpf|grade|email|phone)` in `src/**/*.js`

## P-005 [RECOMMENDED] Minimization: only collect what pedagogy requires

Each personal field collected has a pedagogical justification written in the
spec of the feature that collects it (LGPD art. 6, III — necessity).

## P-006 [RECOMMENDED] A pedagogical mistake is not punitive data

The student's history of mistakes/attempts serves to teach, not to rank them
publicly. Public rankings only with opt-in.

## P-007 [MAY] Deletion at the data subject's request

The data subject (or guardian) MAY request deletion of the data; the system
MAY keep the legal minimum (tax records) with a documented retention period.

## P-008 [MAY] Portability of the student's data

The student MAY export their history (tasks, grades, feedback) in a
machine-readable format.
