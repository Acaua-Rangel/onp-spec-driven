// Scanner for annotations in test and code files.
//
// Universal convention (works in any framework/language):
//   - tag in the test TITLE or in a comment: @spec:AC-001
//   - principle tag: @principle:P-001
//
// The scanner walks the files matching the configured globs and returns
// every occurrence with file + line.

import { readdirSync, readFileSync, statSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { globToRegExp, anyGlobMatch } from '../util/text.js';

const RE_SPEC_TAG = /@spec:(AC-\d{3,})/g;
const RE_PRINCIPLE_TAG = /@principle:(P-\d{3,})/g;

const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.cs', '.php', '.swift',
  '.md', '.txt', '.sql', '.sh', '.vue', '.svelte',
]);

// Static portion of a glob — everything before the first `*`/`?`, cut at the
// last `/`. 'src/**' -> 'src' | 'src/**/*.test.*' -> 'src' | '*.md' -> ''
// | '../other-repo/src/**' -> '../other-repo/src'. This is where the physical
// walk starts — it lets the walk leave rootDir when the glob uses `../`
// (globs do no I/O on their own: without this, no file outside rootDir would
// be visited, and `../` would never match anything).
function staticDirOf(glob) {
  const wildcardIdx = glob.search(/[*?]/);
  const prefix = wildcardIdx === -1 ? glob : glob.slice(0, wildcardIdx);
  const lastSlash = prefix.lastIndexOf('/');
  return lastSlash === -1 ? '' : prefix.slice(0, lastSlash);
}

export function walkFiles(rootDir, { includeGlobs, ignoreGlobs }) {
  const include = includeGlobs.map(globToRegExp);
  const ignore = ignoreGlobs.map(globToRegExp);
  const found = new Set();

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      // path.relative gives the `../` back when `full` falls outside rootDir
      // — this is how an external walk-root matches a `../` glob.
      const rel = path.relative(rootDir, full).split(path.sep).join('/');
      if (anyGlobMatch(rel, ignore)) continue;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        if (anyGlobMatch(rel, include)) found.add(rel);
      }
    }
  }

  const walkRoots = new Set(includeGlobs.map((g) => path.resolve(rootDir, staticDirOf(g))));
  for (const root of walkRoots) walk(root);

  return [...found].sort();
}

export function scanAnnotations(rootDir, files) {
  const specTags = []; // { acId, file, line, text }
  const principleTags = []; // { principleId, file, line, text }

  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    if (ext && !TEXT_EXTENSIONS.has(ext)) continue;
    let content;
    try {
      content = readFileSync(path.join(rootDir, rel), 'utf-8');
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const m of line.matchAll(RE_SPEC_TAG)) {
        specTags.push({ acId: m[1], file: rel, line: i + 1, text: line.trim() });
      }
      for (const m of line.matchAll(RE_PRINCIPLE_TAG)) {
        principleTags.push({ principleId: m[1], file: rel, line: i + 1, text: line.trim() });
      }
    }
  }

  return { specTags, principleTags };
}

// Searches for occurrences of a regex pattern in files matching a glob.
// Used by the constitution checks (forbidden/required).
//
// Runs in a SUBPROCESS with a timeout: a pathological regex coming from the
// constitution (e.g. `(a+)+$`) would cause catastrophic backtracking and
// hang the gate forever — here it is killed and becomes a finding, not a DoS.
const GREP_TIMEOUT_MS = 5000;

const GREP_WORKER = `
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const { rootDir, pattern, files } = JSON.parse(input);
  const { readFileSync } = require('fs');
  const path = require('path');
  let re;
  try { re = new RegExp(pattern); } catch (err) {
    console.log(JSON.stringify({ error: 'invalid regex: ' + pattern + ' (' + err.message + ')', hits: [] }));
    return;
  }
  const hits = [];
  for (const rel of files) {
    let content;
    try { content = readFileSync(path.join(rootDir, rel), 'utf-8'); } catch { continue; }
    const lines = content.split(/\\r?\\n/);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) hits.push({ file: rel, line: i + 1, text: lines[i].trim() });
    }
  }
  console.log(JSON.stringify({ error: null, hits }));
});
`;

export function grepPattern(rootDir, pattern, glob, ignoreGlobs) {
  const files = walkFiles(rootDir, { includeGlobs: [glob], ignoreGlobs });
  // an invalid regex is ALWAYS flagged, even with an empty glob (compiling is
  // cheap and safe; only execution can be pathological)
  try {
    new RegExp(pattern);
  } catch (err) {
    return { error: `invalid regex: ${pattern} (${err.message})`, hits: [], files };
  }
  if (files.length === 0) return { error: null, hits: [], files };

  const proc = spawnSync(process.execPath, ['-e', GREP_WORKER], {
    input: JSON.stringify({ rootDir, pattern, files }),
    encoding: 'utf-8',
    timeout: GREP_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });

  if (proc.signal || proc.status === null) {
    return {
      error: `regex \`${pattern}\` exceeded ${GREP_TIMEOUT_MS / 1000}s (possible catastrophic backtracking) — simplify the pattern`,
      hits: [],
      files,
    };
  }
  try {
    const out = JSON.parse(proc.stdout);
    return { error: out.error, hits: out.hits, files };
  } catch {
    return { error: `failed to run the regex verification \`${pattern}\``, hits: [], files };
  }
}
