# Benchmark — onp-spec-driven vs. competitors

Measures each spec-driven development tool's **mechanical detection rate for
real defects**: starting from real specs from the ONP domain (class
enrollment, student grades), it seeds defects that actually plague SDD
projects and counts how many each tool detects **on its own, in a CI, with no
human or LLM in the loop**.

## How to run

```bash
# 1. prepare the competitor with a real validator (OpenSpec: clone + build)
bash benchmark/setup.sh

# 2. run the live comparison
node benchmark/run.js
```

Without the setup, the benchmark still runs: onp-spec-driven is evaluated
live and OpenSpec shows up as "not available" (—). To point to an OpenSpec
already built elsewhere: `OPENSPEC_BIN=/path/bin/openspec.js node benchmark/run.js`.

## What is measured (and what isn't)

- **Mechanical detection**: the tool emits a deterministic error for the
  defect, from a command that runs in CI. That's what keeps the spec true.
- We do **not** measure template quality, onboarding DX, or what an LLM agent
  *might* catch if it happened to comply — because that's not a guarantee,
  it's a hope.

## Tools

| Tool | How it enters | Why |
|---|---|---|
| onp-spec-driven | run live (`onp-spec audit --ci`) | it's ours |
| OpenSpec | run live (`openspec validate --strict`) | has a real mechanical validator |
| spec-kit | capability matrix | scaffolding-only CLI; no defect validator |

The classification of spec-kit as "no mechanical validator" is justified
and verifiable in the source code — see [adapters/capability.js](adapters/capability.js).

## Current result

See [RESULTS.md](RESULTS.md) (regenerated on every `node benchmark/run.js`).

Summary: **onp-spec-driven 100% (9/9)** with a clean baseline · OpenSpec 11%
(1/9, only the incomplete requirement) · spec-kit 0% mechanical.
