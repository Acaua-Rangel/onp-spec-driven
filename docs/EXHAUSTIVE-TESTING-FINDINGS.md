# Findings — exhaustive testing of the onp-spec-driven skill (2026-07-17)

Base: repo `onp/onp-spec-driven` (CLI `bin/onp-spec.js` + skill `skills/onp-spec-driven/`).
Method: ~80 scenarios in isolated sandboxes (runner.mjs 63, runner2.mjs 14, manual probes).
Own suite: 41/41 PASS. Benchmark: 100% (9/9), clean baseline. Package published on npm.

> Historical note: this audit was run against the ORIGINAL Portuguese-grammar
> engine (statuses like `concluida`/`pendente`, finding codes like
> `AC_SEM_TESTE`, keywords like `verificação(...)`). The engine has since been
> fully translated to English (see `ARCHITECTURE.md`). Each finding below keeps
> its original PT literal (the exact string that triggered the bug) with the
> current English equivalent noted in brackets, so the historical record stays
> accurate.

## CRITICAL — gate bypass or false verdict

| # | Finding | Evidence |
|---|---|---|
| CR-1 | **A `skip`/`todo` test counts as PASS proof.** TAP emits `ok ... # SKIP`; `parseTap` doesn't read the directives → the agent skips the test and `audit --ci` exits 0. Breaks the thesis "the agent can't declare victory". | skip probe: `verify f: 1/1 PASS` with a `{skip:true}` test |
| CR-2 | **`[concluída]` (correct PT spelling, with accent!) silently becomes `pendente`.** RE_TASK only accepted `concluida` without the accent; with the accent it fell into the "no status" fallback → `TASK_CONCLUIDA_SEM_PROVA` (now `TASK_DONE_NO_PROOF`) never fired. Status parsing now folds accents/case for any token, so this class of bug is fixed. | C3 |
| CR-3 | **Large `audit --json` output gets truncated** (~8KB): `process.exit()` in the bin before stdout flushes → invalid JSON in CI/pipe. | G1: `len=8126`, JSON unterminated |
| CR-4 | **ReDoS in the constitution hangs the audit**: `verificação(proibido)` (now `verification(forbidden)`) with a pathological regex `(a+)+$` → 60s+ with no response (the gate becomes a DoS). Now bounded by `GREP_TIMEOUT_MS = 5000` (subprocess, `CHECK_MALFORMED`). | H3: 60003ms (killed by timeout) |
| CR-5 | **The base preset makes the gate unclosable on the happy path**: P-001 [MUST] requires a `@principle:P-001` test that no step of the flow creates → every `audit` exits 1; the user learns to ignore the gate. | E1b, I6 |

## HIGH — false positives/negatives

| # | Finding | Evidence |
|---|---|---|
| AL-1 | **NFD (macOS) breaks the parser**: a decomposed "Então" (now "Then") doesn't match `RE_GWT` → false `AC_INCOMPLETO` (now `AC_INCOMPLETE`) on a correct spec. | B6 |
| AL-2 | **A path with a space in `Arquivos:`** (now `Files:`) gets split by `[,\s]+` → false `ARQUIVO_INEXISTENTE` (now `FILE_MISSING`) and wrong mapping. | C4 |
| AL-3 | **Indented GWT (2 spaces)** → false `AC_INCOMPLETO` (now `AC_INCOMPLETE`, nested lists are common markdown). | B18 |
| AL-4 | **`verificação(obrigatório)` (now `verification(required)`) with a glob that matches 0 files passes silently** — a glob typo turns off the principle with no warning. | D4 |
| AL-5 | **Unknown level `[OBRIGATORIO]`** (now any level outside `MUST`/`RECOMMENDED`/`MAY`, code `LEVEL_INVALID`) → the principle is silently ignored (not parsed, not flagged). | D7 |
| AL-6 | **Missing Assumptions/Questions sections → no finding at all.** Differentiator #3 ("mandatory") is not mechanically enforced; there's only an error if the section exists with an open ASM. | I10 |
| AL-7 | **A `@spec:` tag in a comment/dead code silences `AC_SEM_TESTE`** (now `AC_NO_TEST`, the scanner matches any line); with the `exitcode` reporter, the bypass is complete (every AC becomes pass). | analysis + E5 |

## MEDIUM — semantics and UX

- MD-1 Cross-feature refs → `REF_QUEBRADA` (now `REF_BROKEN`) even when the AC exists globally (IDs are global, refs are local — inconsistent). [I5]
- MD-2 `> feature:` never compared against the directory name — silent drift. Now caught by `FEATURE_MISMATCH`.
- MD-3 Silent rigidity with no suggestion: lowercase `**dado**` (now `**given**`), `US-1` (2 digits), `[Concluida]` (now `[done]`) — no "did you mean". [B8, B17]
- MD-4 verify with no tag: the "0/0 ACs" message doesn't say `@spec:` was missing from the title. [I12]
- MD-5 vitest-json fallback looks for the first `{` in stdout — fragile with logs. [E9 — friendly but cryptic error]
- MD-6 The `exitcode` reporter grants PASS proof to ALL ACs (only guarded by `AC_SEM_TESTE`, now `AC_NO_TEST`). [E5]

## SKILL-LEVEL — unfit as a harness skill

- SK-1 SKILL.md drives everything through the `onp-spec` CLI (npx/global install). Without the CLI installed, the skill is dead letter; it fails in sandbox/offline. Decision: **must not depend on a CLI**.
- SK-2 No bounded correction loop: if the audit fails, the skill doesn't say how many iterations to try or when to escalate to the user.
- SK-3 No instructions for an atomic commit per task, no context-loading strategy (when to read references/), no auto-sizing "safety valve".
- SK-4 No instructions for what to do when the environment lacks `node`/a test runner (graceful degradation).
- SK-5 The skill installed via `init --agents claude` is a COPY — silent drift between the repo and projects.

## What works well (don't regress)

- Findings catalog with stable codes and file:line — excellent.
- US→AC→T→test traceability and the conservative rule (1 failure sinks the AC) [E6].
- Global ID continuity in `new` [I13]; cross-feature `ID_DUPLICADO` (now `ID_DUPLICATE`) [B9].
- `ASM_ABERTA` (now `ASM_OPEN`) blocking `implementada` (now `implemented`) [B15]; --ci escalation.
- Re-writable proof fail→pass [I8]; corrupted verification → clear error [I9]; `VERIFY_OBSOLETO` (now `VERIFY_STALE`) by mtime [E8].
- Friendly errors in the bin (central catch) [A9, E3, E11, F7]; optimal scale (600 ACs in 52ms) [G1]; 5MB specs OK [G3].
- Scaffold generates valid JS/PY even with hostile titles [F4, F6]; nested test in describe works [E7].
