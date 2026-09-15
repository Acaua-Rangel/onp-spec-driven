# Example: class enrollment

Real, complete project, with the audit closing clean. Use it as a reference or
as a demo script.

## Run

```bash
cd examples/class-enrollment
npx onp-spec verify class-enrollment   # 3/3 ACs proven
npx onp-spec audit --ci                # exit 0 — spec and code aligned
npx onp-spec status                    # panel
```

## What this example shows

- **Full traceability**: US-001/US-002 → AC-001/002/003 → T-001/002/003 →
  tests annotated with `@spec:AC-xxx`.
- **Executable DoD**: every AC has a test; `verify` records the proof in
  `.spec/verification/class-enrollment.json`.
- **Resolved assumptions**: ASM-001 and ASM-002 are `confirmed` — that's why
  the feature could move to `implemented`. If they were `open`, the audit
  would block it.
- **LGPD constitution**: P-001/002/003 proven by test; P-004 (PII in logs)
  checked by grep. `src/enrollment.js` doesn't leak personal data.

## The video moment: prove the spec stays true

Rename a requirement in the spec and watch the audit flag the drift instantly:

```bash
# swap AC-003 for AC-030 in .spec/features/class-enrollment/spec.md
sed -i '' 's/AC-003/AC-030/g' .spec/features/class-enrollment/spec.md
npx onp-spec audit --ci
```

Output (exit 1):

```
ERROR AC_NO_TEST   AC-030 (...) has no test annotated with @spec:AC-030
ERROR TEST_ORPHAN  test annotated with @spec:AC-003, but that acceptance criterion does not exist in any specification (did the spec change and the test lag behind?)
```

The spec changed, the test was left behind, and the tool **didn't let it
pass**. That's the difference between spec-first (the spec becomes a lie) and
spec-anchored (the machine forces alignment). Revert with `git checkout` or by
undoing the sed.
