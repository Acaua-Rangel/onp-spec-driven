// Audit engine — answers mechanically:
//   "which requirement has NO test?"
//   "which test points to a non-existent requirement?"
//   "which code maps to no task?"
//   "which MUST principle has no check or is violated?"
//
// Each finding has a stable code (see ARCHITECTURE.md) for use in CI and docs.

import { existsSync } from 'fs';
import path from 'path';
import { allAcs, SPEC_STATUSES, ASM_STATUSES, Q_STATUSES } from '../parsers/spec.js';
import { grepPatterns, grepKey } from '../parsers/annotations.js';
import { latestProjectMtime } from './project.js';
import { targetTestFiles } from './verify.js';
import { timed } from '../util/timing.js';

// base severity; in --ci mode the codes in CI_ESCALATES become errors
const CI_ESCALATES = new Set(['AC_NO_PROOF', 'VERIFY_STALE', 'Q_OPEN', 'AC_NO_TASK', 'FILE_ORPHAN']);

function finding(code, severity, message, extra = {}) {
  return { code, severity, message, ...extra };
}

export function auditProject(project, { ci = false } = {}) {
  const findings = [];
  const { config } = project;

  for (const err of project.errors) {
    findings.push(finding('PROJECT_INVALID', 'error', err));
  }

  const testFileSet = new Set(project.testFiles);
  const testSpecTags = project.annotations.specTags.filter((t) => testFileSet.has(t.file));
  const testPrincipleTags = project.annotations.principleTags.filter((t) =>
    testFileSet.has(t.file)
  );

  // ---------- unicidade global de IDs ----------
  const seen = new Map(); // id -> {feature, file, line}
  for (const feature of project.features) {
    if (!feature.spec) continue;
    const register = (id, file, line) => {
      if (seen.has(id)) {
        const first = seen.get(id);
        findings.push(
          finding('ID_DUPLICATE', 'error', `${id} defined in ${first.file} and in ${file}`, {
            feature: feature.name,
            file,
            line,
          })
        );
      } else {
        seen.set(id, { feature: feature.name, file, line });
      }
    };
    for (const story of feature.spec.stories) {
      register(story.id, feature.spec.file, story.line);
      for (const ac of story.acs) register(ac.id, feature.spec.file, ac.line);
    }
    for (const asm of feature.spec.assumptions) register(asm.id, feature.spec.file, asm.line);
    for (const q of feature.spec.questions) register(q.id, feature.spec.file, q.line);
  }

  const knownAcIds = new Set();
  const acById = new Map();
  const knownUsIds = new Set();
  const storyById = new Map();
  for (const feature of project.features) {
    if (!feature.spec) continue;
    for (const story of feature.spec.stories) {
      knownUsIds.add(story.id);
      if (!storyById.has(story.id)) storyById.set(story.id, story);
    }
    for (const ac of allAcs(feature.spec)) {
      knownAcIds.add(ac.id);
      if (!acById.has(ac.id)) acById.set(ac.id, { ac, feature });
    }
  }

  // task coverage is GLOBAL: IDs are global, so a task from any feature
  // can cover an AC from another (cross-refs are valid)
  const globalCoveredAcs = new Set();
  for (const feature of project.features) {
    if (!feature.tasks) continue;
    for (const task of feature.tasks.tasks) {
      for (const ref of task.refs) {
        if (ref.startsWith('AC-') && knownAcIds.has(ref)) {
          globalCoveredAcs.add(ref);
        } else if (ref.startsWith('US-') && storyById.has(ref)) {
          for (const ac of storyById.get(ref).acs) globalCoveredAcs.add(ac.id);
        }
      }
    }
  }

  // ---------- specs ----------
  for (const feature of project.features) {
    const { name, spec, tasks } = feature;
    if (!spec) {
      findings.push(
        finding('SPEC_MISSING', 'error', `feature ${name} without spec.md`, { feature: name })
      );
      continue;
    }

    for (const issue of spec.parseIssues) {
      findings.push(
        finding(issue.code, issue.code === 'AC_OUTSIDE_US' ? 'error' : 'warning', issue.message, {
          feature: name,
          file: spec.file,
          line: issue.line,
        })
      );
    }

    if (spec.status && !SPEC_STATUSES.includes(spec.status)) {
      findings.push(
        finding(
          'STATUS_INVALID',
          'warning',
          `status "${spec.status}" is not one of: ${SPEC_STATUSES.join(', ')}`,
          { feature: name, file: spec.file }
        )
      );
    }

    if (spec.stories.length === 0) {
      findings.push(
        finding('SPEC_NO_US', 'error', `specification without any user story (US-xxx)`, {
          feature: name,
          file: spec.file,
        })
      );
    }

    if (spec.feature && spec.feature !== name) {
      findings.push(
        finding(
          'FEATURE_MISMATCH',
          'warning',
          `"> feature: ${spec.feature}" differs from the directory "${name}"`,
          { feature: name, file: spec.file }
        )
      );
    }

    // Assumptions and Questions are first-class citizens: the ABSENCE of the
    // section is also a finding (otherwise the differentiator silently becomes optional)
    const specMatured = ['ready', 'in-implementation', 'implemented', 'audited'].includes(
      spec.status
    );
    if (spec.sections && !spec.sections.assumptions) {
      findings.push(
        finding(
          'SECTION_MISSING',
          specMatured ? 'error' : 'warning',
          `specification without a "## Assumptions" section — record the assumptions or write "None." explicitly`,
          { feature: name, file: spec.file }
        )
      );
    }
    if (spec.sections && !spec.sections.questions) {
      findings.push(
        finding(
          'SECTION_MISSING',
          specMatured ? 'error' : 'warning',
          `specification without a "## Open questions" section — record the questions or write "None." explicitly`,
          { feature: name, file: spec.file }
        )
      );
    }

    for (const story of spec.stories) {
      if (story.acs.length === 0) {
        findings.push(
          finding('US_NO_AC', 'error', `${story.id} (${story.title}) without an acceptance criterion`, {
            feature: name,
            file: spec.file,
            line: story.line,
          })
        );
      }
      for (const ac of story.acs) {
        const missing = [];
        if (ac.given.length === 0) missing.push('Given');
        if (ac.when.length === 0) missing.push('When');
        if (ac.then.length === 0) missing.push('Then');
        if (missing.length) {
          findings.push(
            finding(
              'AC_INCOMPLETE',
              'error',
              `${ac.id} (${ac.title}) missing clause: ${missing.join(', ')}`,
              { feature: name, file: spec.file, line: ac.line }
            )
          );
        }
      }
    }

    // assumptions and questions
    const implemented = ['implemented', 'audited'].includes(spec.status);
    const inProgress = ['in-implementation', 'implemented', 'audited'].includes(spec.status);

    for (const asm of spec.assumptions) {
      if (asm.status && !ASM_STATUSES.includes(asm.status)) {
        findings.push(
          finding(
            'ASM_STATUS_INVALID',
            'warning',
            `${asm.id} with status "${asm.status}" (use: ${ASM_STATUSES.join(', ')})`,
            { feature: name, file: spec.file, line: asm.line }
          )
        );
      }
      if (implemented && asm.status === 'open') {
        findings.push(
          finding(
            'ASM_OPEN',
            'error',
            `${asm.id} is still open while the feature is "${spec.status}": "${asm.text}" — confirm or invalidate it before declaring done`,
            { feature: name, file: spec.file, line: asm.line }
          )
        );
      }
    }

    for (const q of spec.questions) {
      if (q.status && !Q_STATUSES.includes(q.status)) {
        findings.push(
          finding(
            'Q_STATUS_INVALID',
            'warning',
            `${q.id} with status "${q.status}" (use: ${Q_STATUSES.join(', ')})`,
            { feature: name, file: spec.file, line: q.line }
          )
        );
      }
      if (inProgress && q.status === 'open') {
        findings.push(
          finding(
            'Q_OPEN',
            'warning',
            `${q.id} open during implementation: "${q.text}"`,
            { feature: name, file: spec.file, line: q.line }
          )
        );
      }
    }

    // ---------- tasks ----------
    const specAcIds = new Set(allAcs(spec).map((a) => a.id));

    if (tasks) {
      for (const issue of tasks.parseIssues) {
        findings.push(
          finding(issue.code, issue.code === 'TASK_STATUS_INVALID' ? 'error' : 'warning', issue.message, {
            feature: name,
            file: tasks.file,
            line: issue.line,
          })
        );
      }

      for (const task of tasks.tasks) {
        for (const ref of task.refs) {
          // IDs are global: a ref is valid if it exists in ANY spec
          const ok = ref.startsWith('US-') ? knownUsIds.has(ref) : knownAcIds.has(ref);
          if (!ok) {
            findings.push(
              finding(
                'REF_BROKEN',
                'error',
                `task ${task.id} references ${ref}, which does not exist in any specification`,
                { feature: name, file: tasks.file, line: task.line }
              )
            );
          }
        }

        for (const relFile of task.files) {
          if (!existsSync(path.join(config.rootDir, relFile))) {
            findings.push(
              finding(
                'FILE_MISSING',
                task.status === 'done' ? 'error' : 'warning',
                `task ${task.id} maps ${relFile}, which does not exist${task.status === 'done' ? ' (task done!)' : ''}`,
                { feature: name, file: tasks.file, line: task.line }
              )
            );
          }
        }

        if (task.status === 'done') {
          const taskAcs = task.refs.filter((r) => r.startsWith('AC-') && knownAcIds.has(r));
          for (const acId of taskAcs) {
            // the proof lives in the feature that OWNS the AC (refs may be cross-feature)
            const owner = acById.get(acId);
            const verification = owner ? project.verifications[owner.feature.name] || null : null;
            const proof = verification?.results?.[acId];
            if (!proof || proof.status !== 'pass') {
              const why = proof?.status === 'skip' ? ' (the test was SKIPPED — skip is not proof)' : '';
              findings.push(
                finding(
                  'TASK_DONE_NO_PROOF',
                  'error',
                  `task ${task.id} is [done] but criterion ${acId} has no PASS proof from verify${why}`,
                  { feature: name, file: tasks.file, line: task.line }
                )
              );
            }
          }
        }
      }

      for (const ac of allAcs(spec)) {
        if (!globalCoveredAcs.has(ac.id)) {
          findings.push(
            finding('AC_NO_TASK', 'warning', `${ac.id} (${ac.title}) is not covered by any task`, {
              feature: name,
              file: tasks.file,
            })
          );
        }
      }
    }

    // ---------- traceability AC → test ----------
    for (const ac of allAcs(spec)) {
      const tags = testSpecTags.filter((t) => t.acId === ac.id);
      if (tags.length === 0) {
        findings.push(
          finding(
            'AC_NO_TEST',
            'error',
            `${ac.id} (${ac.title}) has no test annotated with @spec:${ac.id}`,
            { feature: name, file: spec.file, line: ac.line }
          )
        );
      } else {
        const verification = project.verifications[name] || null;
        const proof = verification?.results?.[ac.id];
        if (!proof) {
          findings.push(
            finding(
              'AC_NO_PROOF',
              'warning',
              `${ac.id} has a test (${tags[0].file}:${tags[0].line}) but was never proven — run \`onp-spec verify ${name}\``,
              { feature: name, file: tags[0].file, line: tags[0].line }
            )
          );
        } else if (proof.status !== 'pass') {
          const msg =
            proof.status === 'skip'
              ? `${ac.id}: the test was SKIPPED in the last verification (${proof.testName || tags[0].file}) — skip is not proof`
              : `${ac.id} FAILED in the last verification (${proof.testName || tags[0].file})`;
          findings.push(
            finding('AC_NO_PROOF', 'error', msg, {
              feature: name,
              file: tags[0].file,
              line: tags[0].line,
            })
          );
        } else if (proof.method === 'exitcode') {
          findings.push(
            finding(
              'PROOF_WEAK',
              'warning',
              `${ac.id} proven only by the global exit code (reporter "exitcode") — no per-test granularity; prefer tap/vitest-json/jest-json`,
              { feature: name, file: tags[0]?.file, line: tags[0]?.line }
            )
          );
        }
      }
    }

    // verify stale?
    const verification = project.verifications[name] || null;
    if (verification?.timestamp) {
      // Only what can change THIS feature's proof counts: its tagged test
      // files plus the source files its tasks claim. A feature whose tasks
      // claim no files cannot be attributed, so all source files count.
      const taskFiles = (feature.tasks?.tasks || []).flatMap((t) => t.files.map((f) => f.split('\\').join('/')));
      const relevant = [
        ...targetTestFiles(project, allAcs(spec).map((ac) => ac.id)),
        ...(taskFiles.length > 0 ? taskFiles : project.srcFiles),
      ];
      const codeMtime = latestProjectMtime(project, relevant);
      if (codeMtime > Date.parse(verification.timestamp)) {
        findings.push(
          finding(
            'VERIFY_STALE',
            'warning',
            `code/tests changed after the last verify of ${name} — run \`onp-spec verify ${name}\` again`,
            { feature: name }
          )
        );
      }
    }
  }

  // ---------- orphan tests (classic drift) ----------
  const seenOrphan = new Set();
  for (const tag of project.annotations.specTags) {
    if (!knownAcIds.has(tag.acId)) {
      const key = `${tag.acId}:${tag.file}`;
      if (seenOrphan.has(key)) continue;
      seenOrphan.add(key);
      findings.push(
        finding(
          'TEST_ORPHAN',
          'error',
          `test annotated with @spec:${tag.acId}, but that acceptance criterion does not exist in any specification (did the spec change and the test lag behind?)`,
          { file: tag.file, line: tag.line }
        )
      );
    }
  }

  // ---------- orphan code ----------
  const anyTasks = project.features.some((f) => f.tasks && f.tasks.tasks.length > 0);
  if (anyTasks) {
    const claimed = new Set();
    for (const feature of project.features) {
      if (!feature.tasks) continue;
      for (const task of feature.tasks.tasks) {
        for (const f of task.files) claimed.add(f.split('\\').join('/'));
      }
    }
    for (const src of project.srcFiles) {
      if (!claimed.has(src)) {
        findings.push(
          finding(
            'FILE_ORPHAN',
            'warning',
            `${src} is not mapped by any task — which requirement does this code serve?`,
            { file: src }
          )
        );
      }
    }
  }

  // ---------- constitution ----------
  if (!project.constitution) {
    findings.push(
      finding(
        'CONSTITUTION_MISSING',
        'warning',
        `no ${config.specDir}/constitution.md — run \`onp-spec init\` to create one (LGPD/education preset available)`
      )
    );
  } else {
    const constitution = project.constitution;
    // every forbidden/required rule is searched in ONE pass (one subprocess,
    // each file read once) instead of one walk + subprocess per rule
    const grepChecks = constitution.principles.flatMap((p) =>
      p.checks.filter((c) => c.kind === 'forbidden' || c.kind === 'required')
    );
    const grepResults = timed(`constitution checks (${grepChecks.length} rule(s))`, () =>
      grepPatterns(config.rootDir, grepChecks, config.ignoreGlobs)
    );
    for (const issue of constitution.parseIssues) {
      findings.push(
        finding(issue.code, 'error', issue.message, { file: constitution.file, line: issue.line })
      );
    }
    for (const p of constitution.principles) {
      if (p.level === 'MUST' && p.checks.length === 0) {
        findings.push(
          finding(
            'PRINCIPLE_NO_CHECK',
            'error',
            `${p.id} [MUST] "${p.title}" has no executable check`,
            { file: constitution.file, line: p.line }
          )
        );
      }
      for (const check of p.checks) {
        if (check.kind === 'gate') {
          // satisfied by the audit mechanism itself (AC_NO_TEST, AC_NO_PROOF,
          // TASK_DONE_NO_PROOF...) — nothing to check here
          continue;
        }
        if (check.kind === 'test') {
          const tags = testPrincipleTags.filter((t) => t.principleId === check.principleTag);
          if (tags.length === 0) {
            findings.push(
              finding(
                'PRINCIPLE_VIOLATED',
                p.level === 'MUST' ? 'error' : 'warning',
                `${p.id} requires test @principle:${check.principleTag} and no test has that tag`,
                { file: constitution.file, line: check.line }
              )
            );
          }
        } else if (check.kind === 'forbidden') {
          const { error, hits, files } = grepResults.get(grepKey(check));
          if (files.length === 0) {
            findings.push(
              finding(
                'GLOB_NO_FILES',
                'warning',
                `${p.id}: the glob \`${check.glob}\` matches no file — inert check (typo in the glob?)`,
                { file: constitution.file, line: check.line }
              )
            );
          }
          if (error) {
            findings.push(
              finding('CHECK_MALFORMED', 'error', `${p.id}: ${error}`, {
                file: constitution.file,
                line: check.line,
              })
            );
          }
          for (const hit of hits) {
            findings.push(
              finding(
                'PRINCIPLE_VIOLATED',
                p.level === 'MUST' ? 'error' : 'warning',
                `${p.id} "${p.title}": forbidden pattern \`${check.pattern}\` found`,
                { file: hit.file, line: hit.line, principle: p.id }
              )
            );
          }
        } else if (check.kind === 'required') {
          const { error, hits, files } = grepResults.get(grepKey(check));
          if (files.length === 0) {
            findings.push(
              finding(
                'GLOB_NO_FILES',
                'warning',
                `${p.id}: the glob \`${check.glob}\` matches no file — inert check (typo in the glob?)`,
                { file: constitution.file, line: check.line }
              )
            );
          }
          if (error) {
            findings.push(
              finding('CHECK_MALFORMED', 'error', `${p.id}: ${error}`, {
                file: constitution.file,
                line: check.line,
              })
            );
          } else if (files.length > 0 && hits.length === 0) {
            findings.push(
              finding(
                'PRINCIPLE_VIOLATED',
                p.level === 'MUST' ? 'error' : 'warning',
                `${p.id} "${p.title}": required pattern \`${check.pattern}\` not found in \`${check.glob}\``,
                { file: constitution.file, line: check.line, principle: p.id }
              )
            );
          }
        }
      }
    }
  }

  // ---------- resolve final severity ----------
  if (ci) {
    for (const f of findings) {
      if (CI_ESCALATES.has(f.code) && f.severity === 'warning') f.severity = 'error';
    }
  }

  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');

  const totalAcs = project.features.reduce(
    (n, f) => n + (f.spec ? allAcs(f.spec).length : 0),
    0
  );
  const acsWithTest = new Set(
    testSpecTags.filter((t) => knownAcIds.has(t.acId)).map((t) => t.acId)
  ).size;
  const acsProven = project.features.reduce((n, f) => {
    const v = project.verifications[f.name];
    if (!v?.results || !f.spec) return n;
    return (
      n + allAcs(f.spec).filter((ac) => v.results[ac.id]?.status === 'pass').length
    );
  }, 0);

  return {
    findings,
    ok: errors.length === 0,
    exitCode: errors.length === 0 ? 0 : 1,
    stats: {
      features: project.features.length,
      stories: project.features.reduce((n, f) => n + (f.spec?.stories.length || 0), 0),
      acs: totalAcs,
      acsWithTest,
      acsProven,
      assumptionsOpen: project.features.reduce(
        (n, f) => n + (f.spec?.assumptions.filter((a) => a.status === 'open').length || 0),
        0
      ),
      questionsOpen: project.features.reduce(
        (n, f) => n + (f.spec?.questions.filter((q) => q.status === 'open').length || 0),
        0
      ),
      principles: project.constitution?.principles.length || 0,
      errors: errors.length,
      warnings: warnings.length,
    },
  };
}
