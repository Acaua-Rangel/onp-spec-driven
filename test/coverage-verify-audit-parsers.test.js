import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';

import {
  tokenizeCommand,
  resolvePathWithin,
  validateTestCommand,
  runVerify,
} from '../src/core/verify.js';
import { parseTasks } from '../src/parsers/tasks.js';
import { parseConstitution } from '../src/parsers/constitution.js';
import { auditProject } from '../src/core/audit.js';

test('src/core/verify.js: tokenizeCommand handles escapes and quotes', () => {
  const tokens = tokenizeCommand('cmd "hello \\"world\\"" \'single\' foo\\ bar');
  assert.deepEqual(tokens, ['cmd', 'hello "world"', 'single', 'foo bar']);

  assert.throws(() => tokenizeCommand('cmd "unclosed'), /unbalanced quote/);
});

test('src/core/verify.js: resolvePathWithin and validateTestCommand error paths', () => {
  const root = '/base/dir';
  assert.throws(() => resolvePathWithin(root, '', 'path'), /non-empty/);
  assert.throws(() => resolvePathWithin(root, 'foo\0bar', 'path'), /null byte/);
  assert.throws(() => resolvePathWithin(root, '/abs/path', 'path'), /stay within/);
  assert.throws(() => resolvePathWithin(root, '../outside', 'path'), /stay within/);

  assert.throws(() => validateTestCommand('node; rm -rf', root), /unsafe characters/);
  assert.throws(() => validateTestCommand('node | cat', root), /unsafe characters/);
  assert.throws(() => validateTestCommand('node $(calc)', root), /unsafe characters/);
});

test('src/core/verify.js: runVerify error paths and reporters', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'onpspec-cov-vrf-'));
  try {
    const dummyTestFile = path.join(tmp, 'run-tap.js');
    writeFileSync(dummyTestFile, 'console.log("ok 1 - unrelated test without tags");\n');

    const project = {
      specRoot: path.join(tmp, '.spec'),
      testFiles: ['test/a.test.js'],
      annotations: {
        specTags: [{ file: 'test/a.test.js', acId: 'AC-001' }],
        principleTags: [],
      },
      features: [
        {
          name: 'feat-1',
          spec: {
            file: '.spec/features/feat-1/spec.md',
            stories: [
              {
                id: 'US-001',
                acs: [{ id: 'AC-001', title: 'Criteria 1', given: [], when: [], then: [] }],
              },
            ],
          },
        },
        {
          name: 'feat-no-spec',
          spec: null,
        },
      ],
      config: {
        rootDir: tmp,
        specDir: '.spec',
        testCommand: 'node run-tap.js',
        reporter: 'tap',
      },
    };

    // 1. Missing feature
    assert.throws(() => runVerify(project, 'unknown-feat'), /not found/);

    // 2. Feature has no spec
    assert.throws(() => runVerify(project, 'feat-no-spec'), /has no spec\.md/);

    // 3. testCommand missing
    const pNoCmd = { ...project, config: { ...project.config, testCommand: null } };
    assert.throws(() => runVerify(pNoCmd, 'feat-1'), /set "testCommand"/);

    // 4. testCommand empty after parsing
    const pEmptyCmd = { ...project, config: { ...project.config, testCommand: '   ' } };
    assert.throws(() => runVerify(pEmptyCmd, 'feat-1'), /empty after parsing/);

    // 5. Unknown reporter
    const pUnknownRep = { ...project, config: { ...project.config, reporter: 'unknown-rep' } };
    assert.throws(() => runVerify(pUnknownRep, 'feat-1'), /unknown reporter/);

    // 6. JSON reporter: with reporterOutputFile
    const jsonOutFile = path.join(tmp, 'report.json');
    writeFileSync(jsonOutFile, JSON.stringify({ testResults: [] }));
    const pJsonFile = {
      ...project,
      config: {
        ...project.config,
        reporter: 'vitest-json',
        reporterOutputFile: 'report.json',
      },
    };
    const resJson = runVerify(pJsonFile, 'feat-1');
    assert.equal(resJson.record.exitCode, 0);

    // 7. JSON reporter: cannot find JSON in stdout or file
    const pJsonFail = {
      ...project,
      config: {
        ...project.config,
        testCommand: 'node run-tap.js',
        reporter: 'jest-json',
        reporterOutputFile: null,
      },
    };
    assert.throws(() => runVerify(pJsonFail, 'feat-1'), /could not find the JSON/);

    // 8. Exitcode reporter
    const pExitcode = {
      ...project,
      config: {
        ...project.config,
        reporter: 'exitcode',
      },
    };
    const resExit = runVerify(pExitcode, 'feat-1');
    assert.equal(resExit.record.results['AC-001'].status, 'pass');
    assert.equal(resExit.record.results['AC-001'].method, 'exitcode');

    // 9. UX hint when tests run but no tag matched
    const resHint = runVerify(project, 'feat-1');
    assert.ok(resHint.hint && resHint.hint.includes('@spec:AC-001'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('src/parsers/tasks.js: REF_MALFORMED for non-US/AC refs', () => {
  const md = `# Tasks\n\n## T-001 — Task one [pending]\n- Refs: FOO-123\n- Files: src/a.js\n`;
  const result = parseTasks(md);
  assert.equal(result.tasks.length, 1);
  assert.ok(result.parseIssues.some((i) => i.code === 'REF_MALFORMED'));
});

test('src/parsers/constitution.js: CHECK_MALFORMED for invalid check format', () => {
  const md = `# Constitution\n\n## P-001 [MUST] Rule\n- verification(required): invalid_without_regex\n`;
  const result = parseConstitution(md);
  assert.ok(result.parseIssues.some((i) => i.code === 'CHECK_MALFORMED'));
});

test('src/core/audit.js: auditProject covers all findings', () => {
  const project = {
    errors: ['Corrupted config'],
    config: { specDir: '.spec', rootDir: '/tmp' },
    testFiles: [],
    srcFiles: [],
    verifications: {},
    annotations: { specTags: [], principleTags: [] },
    features: [
      {
        name: 'feat-missing-spec',
        spec: null,
      },
      {
        name: 'feat-problems',
        spec: {
          file: '.spec/features/feat-problems/spec.md',
          status: 'invalid-status',
          feature: 'different-name',
          parseIssues: [
            { code: 'AC_OUTSIDE_US', line: 5, message: 'outside' },
            { code: 'SYNTAX_WARN', line: 6, message: 'warning' },
          ],
          sections: { assumptions: false, questions: false },
          stories: [
            {
              id: 'US-001',
              title: 'Story 1',
              line: 10,
              acs: [
                {
                  id: 'AC-001',
                  title: 'Incomplete AC',
                  line: 12,
                  given: [],
                  when: [],
                  then: [],
                },
              ],
            },
            {
              id: 'US-002',
              title: 'Empty Story',
              line: 15,
              acs: [],
            },
          ],
          assumptions: [
            { id: 'ASM-001', status: 'invalid-asm', text: 'txt', line: 20 },
            { id: 'ASM-002', status: 'open', text: 'txt2', line: 21 },
          ],
          questions: [
            { id: 'Q-001', status: 'invalid-q', text: 'txt', line: 25 },
            { id: 'Q-002', status: 'open', text: 'txt2', line: 26 },
          ],
        },
      },
      {
        name: 'feat-duplicate-id',
        spec: {
          file: '.spec/features/feat-duplicate-id/spec.md',
          status: 'ready',
          feature: 'feat-duplicate-id',
          parseIssues: [],
          sections: { assumptions: true, questions: true },
          stories: [
            {
              id: 'US-001', // duplicate with feat-problems
              title: 'Story dup',
              line: 10,
              acs: [
                {
                  id: 'AC-001', // duplicate
                  title: 'Crit dup',
                  line: 12,
                  given: ['a'],
                  when: ['b'],
                  then: ['c'],
                },
              ],
            },
          ],
          assumptions: [],
          questions: [],
        },
      },
      {
        name: 'feat-no-us',
        spec: {
          file: '.spec/features/feat-no-us/spec.md',
          status: 'draft',
          feature: 'feat-no-us',
          parseIssues: [],
          sections: { assumptions: true, questions: true },
          stories: [],
          assumptions: [],
          questions: [],
        },
      },
    ],
  };

  const audit = auditProject(project);
  assert.equal(audit.ok, false);
  const codes = audit.findings.map((f) => f.code);
  assert.ok(codes.includes('PROJECT_INVALID'));
  assert.ok(codes.includes('SPEC_MISSING'));
  assert.ok(codes.includes('STATUS_INVALID'));
  assert.ok(codes.includes('FEATURE_MISMATCH'));
  assert.ok(codes.includes('SECTION_MISSING'));
  assert.ok(codes.includes('AC_OUTSIDE_US'));
  assert.ok(codes.includes('SYNTAX_WARN'));
  assert.ok(codes.includes('AC_INCOMPLETE'));
  assert.ok(codes.includes('US_NO_AC'));
  assert.ok(codes.includes('ASM_STATUS_INVALID'));
  assert.ok(codes.includes('Q_STATUS_INVALID'));
  assert.ok(codes.includes('ID_DUPLICATE'));
  assert.ok(codes.includes('SPEC_NO_US'));
});
