// Capability matrix for tools WITHOUT a mechanical defect validator.
//
// Fact verified in the source code (July 2026):
//  - spec-kit (github/spec-kit): the `specify` CLI does init/scaffold/workflows.
//    The only "validate" calls in the code validate init options, TOML and
//    project structure — there is no spec-defect check, no req→test
//    traceability, no coverage check. Tests are explicitly OPTIONAL in the
//    tasks template.
//    => mechanical detection of spec defects: NONE.
//
// That's why this tool enters the benchmark with mechanical detection = false
// for every defect class. It's not a guess: it's what the source code allows.

export const STATIC_TOOLS = {
  'spec-kit': {
    label: 'spec-kit (GitHub)',
    mechanicalValidator: false,
    detects: () => false,
    note: 'Scaffolding CLI; no spec-defect validator (tests are optional in the template)',
  },
};
