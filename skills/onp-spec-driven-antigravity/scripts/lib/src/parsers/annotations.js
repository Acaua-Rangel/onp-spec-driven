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

// files bigger than this are never hand-written tests/sources worth scanning
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

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
        // prune the whole subtree: `node_modules/**` matches 'node_modules/'
        // but not the bare directory name, and without this the walk would
        // enter every ignored directory and discard its files one by one
        if (anyGlobMatch(`${rel}/`, ignore)) continue;
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
      const abs = path.join(rootDir, rel);
      if (statSync(abs).size > MAX_SCAN_BYTES) continue; // generated/bundled blobs
      content = readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }
    // fast path: most files carry no tag — skip the line split for them
    if (!content.includes('@spec:') && !content.includes('@principle:')) continue;
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

// Searches for occurrences of regex patterns in files matching a glob.
// Used by the constitution checks (forbidden/required).
//
// Runs in a SUBPROCESS with a timeout: a pathological regex coming from the
// constitution (e.g. `(a+)+$`) would cause catastrophic backtracking and
// hang the gate forever — here it is killed and becomes a finding, not a DoS.
//
// All rules run in ONE subprocess that reads each file once. Only if that
// batch is killed (timeout) do the rules run one by one, to pinpoint which
// regex is the culprit.
const GREP_TIMEOUT_MS = 5000;

const GREP_WORKER = `
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const { rootDir, rules } = JSON.parse(input);
  const { readFileSync } = require('fs');
  const path = require('path');
  const out = {};
  const byFile = new Map();
  for (const rule of rules) {
    let re;
    try { re = new RegExp(rule.pattern); } catch (err) {
      out[rule.key] = { error: 'invalid regex: ' + rule.pattern + ' (' + err.message + ')', hits: [] };
      continue;
    }
    out[rule.key] = { error: null, hits: [] };
    for (const rel of rule.files) {
      if (!byFile.has(rel)) byFile.set(rel, []);
      byFile.get(rel).push({ key: rule.key, re });
    }
  }
  for (const [rel, fileRules] of byFile) {
    let content;
    try { content = readFileSync(path.join(rootDir, rel), 'utf-8'); } catch { continue; }
    const lines = content.split(/\\r?\\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const { key, re } of fileRules) {
        if (re.test(lines[i])) out[key].hits.push({ file: rel, line: i + 1, text: lines[i].trim() });
      }
    }
  }
  console.log(JSON.stringify(out));
});
`;

function runGrepWorker(rootDir, rules, timeout) {
  const proc = spawnSync(process.execPath, ['-e', GREP_WORKER], {
    input: JSON.stringify({ rootDir, rules }),
    encoding: 'utf-8',
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (proc.signal || proc.status === null) return { killed: true };
  try {
    return { out: JSON.parse(proc.stdout) };
  } catch {
    return { failed: true };
  }
}

const checkKey = (c) => `${c.pattern}\u0000${c.glob}`;

// checks: [{ pattern, glob }] -> Map(key -> { error, hits, files }).
// `grepKey(check)` gives the key to look results up.
export function grepPatterns(rootDir, checks, ignoreGlobs) {
  const results = new Map();
  const filesByGlob = new Map();
  const filesFor = (glob) => {
    if (!filesByGlob.has(glob)) {
      filesByGlob.set(glob, walkFiles(rootDir, { includeGlobs: [glob], ignoreGlobs }));
    }
    return filesByGlob.get(glob);
  };

  const runnable = [];
  for (const c of checks) {
    const key = checkKey(c);
    if (results.has(key)) continue;
    const files = filesFor(c.glob);
    // an invalid regex is ALWAYS flagged, even with an empty glob (compiling
    // is cheap and safe; only execution can be pathological)
    try {
      new RegExp(c.pattern);
    } catch (err) {
      results.set(key, { error: `invalid regex: ${c.pattern} (${err.message})`, hits: [], files });
      continue;
    }
    if (files.length === 0) {
      results.set(key, { error: null, hits: [], files });
      continue;
    }
    results.set(key, null); // placeholder: reserves the key
    runnable.push({ key, pattern: c.pattern, files });
  }
  if (runnable.length === 0) return results;

  // a lone rule gains nothing from batching (and a pathological one must be
  // killed after a single timeout, not two)
  const batch = runnable.length > 1 ? runGrepWorker(rootDir, runnable, GREP_TIMEOUT_MS) : {};
  if (batch.out) {
    for (const r of runnable) {
      const o = batch.out[r.key] || { error: null, hits: [] };
      results.set(r.key, { error: o.error, hits: o.hits, files: r.files });
    }
    return results;
  }

  // batch killed or unreadable: run rule by rule so the bad regex is isolated
  for (const r of runnable) {
    const one = runGrepWorker(rootDir, [r], GREP_TIMEOUT_MS);
    if (one.killed) {
      results.set(r.key, {
        error: `regex \`${r.pattern}\` exceeded ${GREP_TIMEOUT_MS / 1000}s (possible catastrophic backtracking) — simplify the pattern`,
        hits: [],
        files: r.files,
      });
    } else if (one.out) {
      const o = one.out[r.key];
      results.set(r.key, { error: o.error, hits: o.hits, files: r.files });
    } else {
      results.set(r.key, {
        error: `failed to run the regex verification \`${r.pattern}\``,
        hits: [],
        files: r.files,
      });
    }
  }
  return results;
}

export const grepKey = checkKey;

export function grepPattern(rootDir, pattern, glob, ignoreGlobs) {
  const check = { pattern, glob };
  return grepPatterns(rootDir, [check], ignoreGlobs).get(checkKey(check));
}
