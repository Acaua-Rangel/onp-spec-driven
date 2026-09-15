# Constitution — v1.1.0

<!--
  Non-negotiable project principles. They are not style: they are constraints.
  P-xxx = principle (traceability ID, like US/AC/T).
  Levels: [MUST] mandatory · [RECOMMENDED] strong · [MAY] allowed/explicit.
  Every [MUST] needs an executable check — otherwise the audit flags
  "principle without a check" (PRINCIPLE_NO_CHECK). Formats:
    - verification(gate): satisfied by the audit itself (only for "meta" principles)
    - verification(test): @principle:P-xxx
    - verification(forbidden): `regex` in `glob`
    - verification(required): `regex` in `glob`
-->

## P-001 [MUST] Every requirement has an executable proof

No feature is declared done without the audit in CI mode exiting clean (exit 0).
This principle is checked by the audit mechanism itself (AC_NO_TEST,
AC_NO_PROOF, TASK_DONE_NO_PROOF) — it needs no extra test from you.

- verification(gate): intrinsic to the audit

## P-002 [RECOMMENDED] Secrets never in code

Keys and passwords come from environment variables, never hard-coded.

- verification(forbidden): `(api[_-]?key|password|secret)\s*[:=]\s*['"][^'"]{8,}` in `src/**/*.js`
