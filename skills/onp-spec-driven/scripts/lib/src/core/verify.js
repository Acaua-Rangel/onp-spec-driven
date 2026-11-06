// verify — runs the project's test command, extracts the PER-TEST result
// and cross-references the feature's ACs via the @spec:AC-xxx tag in the test
// title. Writes .spec/verification/<feature>.json — the "proof" the audit consumes.
//
// The agent (or the dev) does not decide whether the AC passed. The test runner does.

import { execSync, spawnSync } from 'child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import path from 'path';
import { allAcs } from '../parsers/spec.js';
import { timed } from '../util/timing.js';

const RE_SPEC_TAG = /@spec:(AC-\d{3,})/g;
const RE_PRINCIPLE_TAG = /@principle:(P-\d{3,})/g;

// ---------- output parsers ----------

// TAP (node:test, tape, etc.): "ok 1 - title" / "not ok 2 - title".
// "# SKIP"/"# TODO" directives arrive as "ok" in TAP but are NOT proof:
// a skipped test cannot prove an AC (otherwise skip = bypassing the gate).
export function parseTap(output) {
  const tests = [];
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/^\s*(not )?ok\s+\d+\s*(?:-\s*)?(.*)$/);
    if (!m) continue;
    let title = m[2].trim();
    let skip = false;
    const directive = title.match(/^(.*?)\s+#\s*(SKIP|TODO)\b.*$/i);
    if (directive) {
      title = directive[1].trim();
      skip = true;
    }
    // ignore node:test suite summary lines (they duplicate subtests)
    if (/^tests \d+$/.test(title)) continue;
    tests.push({ title, pass: !m[1] && !skip, skip });
  }
  return tests;
}

// vitest --reporter=json / jest --json (same assertionResults shape).
// "skipped"/"pending"/"todo"/"disabled" are not proof.
export function parseJsonReport(jsonText) {
  const data = JSON.parse(jsonText);
  const tests = [];
  for (const suite of data.testResults || []) {
    for (const t of suite.assertionResults || []) {
      tests.push({
        title: [t.fullName, t.title].filter(Boolean).join(' '),
        pass: t.status === 'passed',
        skip: t.status !== 'passed' && t.status !== 'failed',
      });
    }
  }
  return tests;
}

export function extractTags(title) {
  const acs = [...title.matchAll(RE_SPEC_TAG)].map((m) => m[1]);
  const principles = [...title.matchAll(RE_PRINCIPLE_TAG)].map((m) => m[1]);
  return { acs, principles };
}

// Reduces the test list to one verdict per tag.
// Rule: fail dominates pass, pass dominates skip. An AC only proven by skipped
// tests stays "skip" — which NEVER counts as proof.
const STATUS_RANK = { fail: 3, pass: 2, skip: 1 };

export function resultsByTag(tests) {
  const acResults = {}; // AC-xxx -> {status, testName}
  const principleResults = {};

  const merge = (map, id, t) => {
    const status = t.skip ? 'skip' : t.pass ? 'pass' : 'fail';
    const prev = map[id];
    if (!prev || STATUS_RANK[status] > STATUS_RANK[prev.status]) {
      map[id] = { status, testName: t.title };
    }
  };

  for (const t of tests) {
    const { acs, principles } = extractTags(t.title);
    for (const acId of acs) merge(acResults, acId, t);
    for (const pId of principles) merge(principleResults, pId, t);
  }

  return { acResults, principleResults };
}

export function gitRev(rootDir) {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

// ---------- command parsing ----------

// Splits a command line into argv respecting single/double quotes and
// backslash escaping. Used so the test command is run WITHOUT a shell
// (spawnSync argv form) — dynamic config never reaches an OS shell.
export function tokenizeCommand(command) {
  const tokens = [];
  let current = '';
  let quote = null; // "'" | '"' | null
  let hasToken = false;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < command.length) {
        current += command[i + 1];
        i += 1;
      } else if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
    } else if (ch === '\\' && i + 1 < command.length) {
      current += command[i + 1];
      i += 1;
      hasToken = true;
    } else if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
    } else {
      current += ch;
      hasToken = true;
    }
  }
  if (quote) throw new Error(`unbalanced quote in testCommand: ${command}`);
  if (hasToken) tokens.push(current);
  return tokens;
}

export function resolvePathWithin(baseDir, input, label) {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) {
    throw new Error(`${label} must be a non-empty path without null bytes`);
  }
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, input);
  const relative = path.relative(base, resolved);
  if (path.isAbsolute(input) || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay within ${base}`);
  }
  return resolved;
}

export function validateTestCommand(command, rootDir) {
  if (/\0|[\r\n|&;<>`$(){}\[\]]/.test(command)) {
    throw new Error('testCommand contains unsafe characters');
  }
  if (command.includes('/') || command.includes('\\')) {
    return resolvePathWithin(rootDir, command, 'testCommand executable');
  }
  return command;
}

// ---------- targeted test runs ----------
//
// Running the WHOLE suite to prove a handful of ACs is what makes `verify`
// slow in big repos. The engine already knows which test files carry the
// feature's @spec tags, so for runners that accept file paths it appends only
// those files (`testFileArgs: "auto"`, the default). `{files}` in testCommand
// puts them exactly where the user wants; `testFileArgs: false` always runs
// the full suite.

const FILE_ARG_RUNNERS = new Set(['vitest', 'jest', 'mocha', 'pytest', 'py.test', 'tap']);
const RUNNER_LAUNCHERS = new Set(['npx', 'pnpx', 'bunx', 'pnpm', 'yarn', 'bun', 'npm']);
const MAX_TARGET_FILES = 200;
const FILES_PLACEHOLDER = '{files}';

const execName = (cmd) =>
  path.basename(cmd).replace(/\.(cmd|exe|js|mjs)$/i, '');

// Does this command line accept test file paths as trailing arguments?
// Only well-known runners — anything else (gradle, mvn, cargo, go, make, a
// custom script) keeps running the full suite, as before.
export function supportsFileArgs(argv) {
  if (argv.length === 0) return false;
  const [exe, ...rest] = argv;
  const name = execName(exe);
  if (name === 'node') return rest.includes('--test');
  if (/^python(\d+(\.\d+)*)?$/.test(name)) {
    const i = rest.indexOf('-m');
    return i !== -1 && FILE_ARG_RUNNERS.has(rest[i + 1]);
  }
  if (FILE_ARG_RUNNERS.has(name)) return true;
  if (RUNNER_LAUNCHERS.has(name)) {
    const positional = rest.filter((a) => !a.startsWith('-'));
    const first = ['exec', 'dlx', 'x'].includes(positional[0]) ? positional[1] : positional[0];
    return first !== undefined && FILE_ARG_RUNNERS.has(execName(first));
  }
  return false;
}

// Test files (inside project.testFiles) that carry a @spec tag of the given ACs.
export function targetTestFiles(project, acIds) {
  const ids = new Set(acIds);
  const testFileSet = new Set(project.testFiles);
  const files = new Set();
  for (const t of project.annotations.specTags) {
    if (ids.has(t.acId) && testFileSet.has(t.file)) files.add(t.file);
  }
  return [...files].sort();
}

// Decides the final argv. Returns { argv, files } where `files` is the list
// of targeted files (null = the full suite runs).
export function resolveTestArgv(argv, files, mode = 'auto') {
  const hasPlaceholder = argv.slice(1).includes(FILES_PLACEHOLDER);
  const usable =
    files.length > 0 && files.length <= MAX_TARGET_FILES && !files.some((f) => f.startsWith('-'));
  if (hasPlaceholder) {
    const out = [argv[0]];
    for (const a of argv.slice(1)) {
      if (a === FILES_PLACEHOLDER) {
        if (usable) out.push(...files);
      } else out.push(a);
    }
    return { argv: out, files: usable ? files : null };
  }
  if (mode !== false && mode !== 'false' && usable && supportsFileArgs(argv)) {
    return { argv: [...argv, ...files], files };
  }
  return { argv, files: null };
}

// ---------- execution ----------

function loadFeature(project, featureName) {
  const feature = project.features.find((f) => f.name === featureName);
  if (!feature) {
    throw new Error(
      `feature "${featureName}" not found in ${project.config.specDir}/features/`
    );
  }
  if (!feature.spec) {
    throw new Error(`feature "${featureName}" has no spec.md`);
  }
  return feature;
}

function readJsonReport(config, proc) {
  let jsonText = null;
  if (config.reporterOutputFile) {
    const p = resolvePathWithin(config.rootDir, config.reporterOutputFile, 'reporterOutputFile');
    if (existsSync(p)) jsonText = readFileSync(p, 'utf-8');
  }
  if (jsonText === null) {
    // try to find the JSON in stdout (jest --json writes to stdout)
    const start = (proc.stdout || '').indexOf('{');
    if (start >= 0) jsonText = (proc.stdout || '').slice(start);
  }
  if (jsonText === null) {
    throw new Error(
      `reporter ${config.reporter}: could not find the JSON — set "reporterOutputFile" or ensure the JSON is on stdout`
    );
  }
  return parseJsonReport(jsonText);
}

// Runs the test command ONCE and records the proof of every requested feature.
// Verifying N features costs one test run, not N.
export function runVerifyBatch(project, featureNames) {
  const { config } = project;
  const features = [...new Set(featureNames)].map((n) => loadFeature(project, n));
  if (features.length === 0) throw new Error('no feature to verify');
  if (!config.testCommand) {
    throw new Error(
      'set "testCommand" in onpspec.config.json (e.g. "node --test" or "npx vitest run --reporter=json --outputFile=.spec/verification/raw.json")'
    );
  }

  // Clean environment: if verify runs inside another test runner (CI, or the
  // lib's own tests), variables like NODE_TEST_CONTEXT/NODE_OPTIONS would make
  // the child `node --test` switch output protocol and not emit TAP.
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_OPTIONS;

  // Run without a shell: the configured command is tokenized into argv so no
  // dynamic input is ever interpreted by an OS shell (avoids command injection).
  const baseArgv = tokenizeCommand(config.testCommand);
  if (baseArgv.length === 0) {
    throw new Error('testCommand is empty after parsing');
  }
  const acIds = features.flatMap((f) => allAcs(f.spec).map((ac) => ac.id));
  const { argv, files: targetedFiles } = resolveTestArgv(
    baseArgv,
    targetTestFiles(project, acIds),
    config.testFileArgs
  );
  const [configuredCommand, ...args] = argv;
  const command = validateTestCommand(configuredCommand, config.rootDir);
  const proc = timed(
    `test run (${targetedFiles ? `${targetedFiles.length} file(s)` : 'full suite'})`,
    () =>
      spawnSync(command, args, {
        cwd: config.rootDir,
        shell: false,
        encoding: 'utf-8',
        maxBuffer: 64 * 1024 * 1024,
        env: childEnv,
      })
  );
  const output = `${proc.stdout || ''}\n${proc.stderr || ''}`;

  let tests = [];
  if (config.reporter === 'tap') {
    tests = parseTap(output);
  } else if (config.reporter === 'vitest-json' || config.reporter === 'jest-json') {
    tests = readJsonReport(config, proc);
  } else if (config.reporter === 'exitcode') {
    tests = []; // no per-test granularity
  } else {
    throw new Error(`unknown reporter: ${config.reporter}`);
  }

  const { acResults, principleResults } = resultsByTag(tests);

  // ACs with an annotated test (@spec tag in a test file) — the exitcode
  // reporter only grants proof to these; without it, exit 0 would prove even
  // an AC with no test at all.
  const testFileSet = new Set(project.testFiles);
  const annotatedAcs = new Set(
    project.annotations.specTags.filter((t) => testFileSet.has(t.file)).map((t) => t.acId)
  );

  const timestamp = new Date().toISOString();
  const rev = gitRev(config.rootDir);
  const outDir = path.join(project.specRoot, 'verification');
  mkdirSync(outDir, { recursive: true });

  const runs = features.map((feature) => {
    const results = {};
    const featureAcs = allAcs(feature.spec);
    for (const ac of featureAcs) {
      if (acResults[ac.id]) {
        results[ac.id] = { ...acResults[ac.id], method: config.reporter };
      } else if (config.reporter === 'exitcode' && annotatedAcs.has(ac.id)) {
        // no per-test: only the global exit code proves it (weak, but explicit)
        results[ac.id] = {
          status: proc.status === 0 ? 'pass' : 'fail',
          testName: null,
          method: 'exitcode',
        };
      }
      // no matching tag → no entry → audit flags AC_NO_PROOF
    }

    // UX hint: ran tests but no title carries a feature AC tag
    const anyTagMatched = featureAcs.some((ac) => acResults[ac.id]);
    const hint =
      tests.length > 0 && !anyTagMatched && config.reporter !== 'exitcode'
        ? `no test title contains @spec:${featureAcs[0]?.id || 'AC-xxx'} — the tag goes in the test TITLE`
        : null;

    const record = {
      feature: feature.name,
      timestamp,
      gitRev: rev,
      command: config.testCommand,
      reporter: config.reporter,
      exitCode: proc.status,
      scope: targetedFiles ? 'files' : 'suite',
      ...(targetedFiles ? { testFiles: targetedFiles } : {}),
      testsParsed: tests.length,
      results,
      principles: principleResults,
    };
    writeFileSync(
      path.join(outDir, `${feature.name}.json`),
      `${JSON.stringify(record, null, 2)}\n`
    );
    return { record, rawOutput: output, hint };
  });

  return runs;
}

export function runVerify(project, featureName) {
  return runVerifyBatch(project, [featureName])[0];
}
