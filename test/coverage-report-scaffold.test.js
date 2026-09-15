import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';

import { renderTerminal, renderJson, renderMarkdown } from '../src/core/report.js';
import { scaffoldTests } from '../src/core/scaffold.js';

test('src/core/report.js: renderTerminal, renderJson, and renderMarkdown with and without findings', () => {
  const auditWithFindings = {
    ok: false,
    stats: {
      features: 1,
      stories: 1,
      acs: 2,
      acsWithTest: 1,
      acsProven: 0,
      assumptionsOpen: 1,
      questionsOpen: 1,
      errors: 1,
      warnings: 1,
    },
    findings: [
      { code: 'AC_NO_TEST', severity: 'error', message: 'missing test', feature: 'feat1', file: 'src/a.js', line: 10 },
      { code: 'ID_SHORT', severity: 'warning', message: 'short id', feature: null, file: null, line: null },
    ],
  };

  const termOutput = renderTerminal(auditWithFindings);
  assert.match(termOutput, /AC_NO_TEST/);
  assert.match(termOutput, /1 user story/);
  assert.match(termOutput, /1 open assumption/);
  assert.match(termOutput, /1 open question/);

  const jsonStr = renderJson(auditWithFindings);
  const parsed = JSON.parse(jsonStr);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.findings.length, 2);

  const mdWithFindings = renderMarkdown(auditWithFindings, { title: 'Custom Report' });
  assert.match(mdWithFindings, /# Custom Report/);
  assert.match(mdWithFindings, /❌ FAIL/);
  assert.match(mdWithFindings, /\| error \|/);

  const auditClean = {
    ok: true,
    stats: {
      features: 2,
      stories: 3,
      acs: 5,
      acsWithTest: 5,
      acsProven: 5,
      assumptionsOpen: 0,
      questionsOpen: 0,
      errors: 0,
      warnings: 0,
    },
    findings: [],
  };
  const termClean = renderTerminal(auditClean);
  assert.match(termClean, /clean audit/);

  const mdClean = renderMarkdown(auditClean);
  assert.match(mdClean, /No problems found\. Specification and code aligned\./);
});

test('src/core/scaffold.js: scaffoldTests handles all frameworks, principles, and validation branches', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'onpspec-cov-scaff-'));
  try {
    const makeProject = (testCommand = 'node --test') => ({
      config: { rootDir: tmp, testCommand, specDir: '.spec' },
      features: [
        {
          name: 'feat-a',
          spec: {
            stories: [
              {
                id: 'US-001',
                title: 'Story 1',
                acs: [
                  {
                    id: 'AC-001',
                    title: 'Crit 1',
                    given: ['cond a'],
                    when: ['action b'],
                    then: ['result c'],
                  },
                ],
              },
            ],
          },
        },
      ],
      constitution: {
        principles: [
          {
            id: 'P-001',
            level: 'MUST',
            title: 'Principle 1',
            checks: [{ kind: 'test', principleTag: 'P-001' }],
          },
        ],
      },
      testFiles: [],
      annotations: { specTags: [], principleTags: [] },
    });

    // 1. Vitest
    const pVitest = makeProject('vitest run');
    const rVitest = scaffoldTests(pVitest, 'feat-a');
    assert.equal(rVitest.pending, 2);
    assert.ok(existsSync(path.join(tmp, rVitest.created)));

    // 2. Already exists without force -> error
    assert.throws(
      () => scaffoldTests(pVitest, 'feat-a', { force: false }),
      /already exists — use --force/
    );

    // 3. With force -> succeeds
    const rForce = scaffoldTests(pVitest, 'feat-a', { force: true });
    assert.equal(rForce.pending, 2);

    // 4. Jest
    const pJest = makeProject('jest');
    const rJest = scaffoldTests(pJest, 'feat-a', { force: true });
    assert.equal(rJest.pending, 2);

    // 5. Pytest
    const pPytest = makeProject('pytest');
    const rPytest = scaffoldTests(pPytest, 'feat-a', { force: true });
    assert.ok(rPytest.created.endsWith('.py'));

    // 6. Node (default)
    const pNode = makeProject('node --test');
    const rNode = scaffoldTests(pNode, 'feat-a', { force: true });
    assert.ok(rNode.created.endsWith('.js'));

    // 7. Feature not found or without spec
    assert.throws(
      () => scaffoldTests(pNode, 'nonexistent'),
      /feature "nonexistent" not found or without spec\.md/
    );

    // 8. All ACs and principles already tagged
    pNode.annotations.specTags = [{ file: 'test/feat-a.spec.test.js', acId: 'AC-001' }];
    pNode.annotations.principleTags = [{ file: 'test/feat-a.spec.test.js', principleId: 'P-001' }];
    pNode.testFiles = ['test/feat-a.spec.test.js'];
    const rAllDone = scaffoldTests(pNode, 'feat-a');
    assert.equal(rAllDone.created, null);
    assert.match(rAllDone.message, /already have an annotated test/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
