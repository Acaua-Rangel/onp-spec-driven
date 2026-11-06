// Loads the full project state: specs of all features, tasks, constitution,
// annotations in tests/code and verify results.

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import path from 'path';
import { parseSpec } from '../parsers/spec.js';
import { parseTasks } from '../parsers/tasks.js';
import { parseConstitution } from '../parsers/constitution.js';
import { walkFiles, scanAnnotations } from '../parsers/annotations.js';
import { globToRegExp, anyGlobMatch } from '../util/text.js';
import { timed } from '../util/timing.js';

export function loadProject(config) {
  const { rootDir, specDir } = config;
  const specRoot = path.join(rootDir, specDir);
  const project = {
    config,
    specRoot,
    features: [],
    constitution: null,
    annotations: { specTags: [], principleTags: [] },
    srcFiles: [],
    testFiles: [],
    verifications: {},
    errors: [],
  };

  if (!existsSync(specRoot)) {
    project.errors.push(
      `directory ${specDir}/ not found — run \`onp-spec init\` first`
    );
    return project;
  }

  // constitution
  const constitutionPath = path.join(specRoot, 'constitution.md');
  if (existsSync(constitutionPath)) {
    project.constitution = parseConstitution(readFileSync(constitutionPath, 'utf-8'), {
      file: path.join(specDir, 'constitution.md'),
    });
  }

  // features
  const featuresRoot = path.join(specRoot, 'features');
  if (existsSync(featuresRoot)) {
    const dirs = readdirSync(featuresRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    for (const name of dirs) {
      const featureDir = path.join(featuresRoot, name);
      const feature = { name, dir: featureDir, spec: null, tasks: null };
      const specPath = path.join(featureDir, 'spec.md');
      if (existsSync(specPath)) {
        feature.spec = parseSpec(readFileSync(specPath, 'utf-8'), {
          file: path.join(specDir, 'features', name, 'spec.md'),
        });
      }
      const tasksPath = path.join(featureDir, 'tasks.md');
      if (existsSync(tasksPath)) {
        feature.tasks = parseTasks(readFileSync(tasksPath, 'utf-8'), {
          file: path.join(specDir, 'features', name, 'tasks.md'),
        });
      }
      project.features.push(feature);
    }
  }

  // verifications (result of `onp-spec verify`)
  const verificationDir = path.join(specRoot, 'verification');
  if (existsSync(verificationDir)) {
    for (const entry of readdirSync(verificationDir)) {
      if (!entry.endsWith('.json')) continue;
      try {
        project.verifications[entry.replace(/\.json$/, '')] = JSON.parse(
          readFileSync(path.join(verificationDir, entry), 'utf-8')
        );
      } catch {
        project.errors.push(`verification/${entry} corrupted — run verify again`);
      }
    }
  }

  // test and source files: ONE walk, then classified (a test file is never
  // also a source file)
  const testRe = config.testGlobs.map(globToRegExp);
  const srcRe = config.srcGlobs.map(globToRegExp);
  const all = timed('walk files', () =>
    walkFiles(rootDir, {
      includeGlobs: [...config.testGlobs, ...config.srcGlobs],
      ignoreGlobs: config.ignoreGlobs,
    })
  );
  for (const rel of all) {
    if (anyGlobMatch(rel, testRe)) project.testFiles.push(rel);
    else if (anyGlobMatch(rel, srcRe)) project.srcFiles.push(rel);
  }
  project.annotations = timed(`scan annotations (${all.length} files)`, () =>
    scanAnnotations(rootDir, all)
  );

  return project;
}

// mtimes of every src/test file, stat'ed once per project. The audit asks for
// "the latest change" once per feature; without the cache that is
// features × files stat calls.
export function fileMtimes(project) {
  if (!project.mtimeCache) {
    const cache = new Map();
    for (const rel of new Set([...project.srcFiles, ...project.testFiles])) {
      try {
        cache.set(rel, statSync(path.join(project.config.rootDir, rel)).mtimeMs);
      } catch {
        // listed but missing — handled by another finding
      }
    }
    Object.defineProperty(project, 'mtimeCache', { value: cache, enumerable: false });
  }
  return project.mtimeCache;
}

export function latestProjectMtime(project, files) {
  const cache = fileMtimes(project);
  let latest = 0;
  for (const rel of files) {
    const m = cache.get(rel);
    if (m !== undefined && m > latest) latest = m;
  }
  return latest;
}
