// Engine speed-ups: pruned ignored dirs, batched constitution greps (with
// per-rule isolation of a pathological regex), single walk, --timings.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { walkFiles, scanAnnotations, grepPatterns, grepKey } from '../src/parsers/annotations.js';
import { loadProject, latestProjectMtime } from '../src/core/project.js';
import { loadConfig } from '../src/config.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'onp-spec.js');
const root = mkdtempSync(path.join(os.tmpdir(), 'onpspec-perf-'));
after(() => rmSync(root, { recursive: true, force: true }));

const put = (rel, content) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), content);
};
put('.spec/features/.keep', '');
put('src/a.js', "// @spec:AC-001\nconsole.log('cpf')\n");
put('src/b.js', 'const ok = 1;\n');
put('test/a.test.js', "test('x @spec:AC-001', () => {});\n");
put('node_modules/pkg/src/x.js', '// @spec:AC-999\n');
put('.venv/lib/src/y.py', '# @spec:AC-998\n');
put('src/big.js', `// @spec:AC-777\n${'x'.repeat(3 * 1024 * 1024)}`);

test('walkFiles poda diretórios ignorados (o bare name casa com "dir/**")', () => {
  const files = walkFiles(root, {
    includeGlobs: ['**/*.js', '**/*.py'],
    ignoreGlobs: loadConfig(root).ignoreGlobs,
  });
  assert.ok(files.includes('src/a.js'));
  assert.ok(!files.some((f) => f.startsWith('node_modules/') || f.startsWith('.venv/')));
});

test('scanAnnotations ignora arquivos > 2MB e acha tags nos demais', () => {
  const { specTags } = scanAnnotations(root, ['src/a.js', 'src/b.js', 'src/big.js', 'test/a.test.js']);
  assert.deepEqual(specTags.map((t) => `${t.file}:${t.acId}`).sort(), [
    'src/a.js:AC-001',
    'test/a.test.js:AC-001',
  ]);
});

test('loadProject separa testes e fontes numa única varredura', () => {
  const p = loadProject(loadConfig(root));
  assert.deepEqual(p.testFiles, ['test/a.test.js']);
  assert.ok(p.srcFiles.includes('src/a.js') && !p.srcFiles.includes('test/a.test.js'));
});

test('grepPatterns: várias regras em um lote; regex patológica isolada das demais', () => {
  const checks = [
    { pattern: 'console\\.log', glob: 'src/**/*.js' },
    { pattern: 'const ok', glob: 'src/**/*.js' },
    { pattern: '(a+)+$', glob: 'patho/**' },
    { pattern: '(', glob: 'src/**/*.js' },
  ];
  put('patho/p.js', `${'a'.repeat(64)}X`);
  const t0 = Date.now();
  const res = grepPatterns(root, checks, loadConfig(root).ignoreGlobs);
  assert.ok(Date.now() - t0 < 20000);
  assert.equal(res.get(grepKey(checks[0])).hits.length, 1);
  assert.equal(res.get(grepKey(checks[0])).hits[0].file, 'src/a.js');
  assert.equal(res.get(grepKey(checks[1])).hits[0].file, 'src/b.js');
  assert.match(res.get(grepKey(checks[2])).error, /exceeded/);
  assert.match(res.get(grepKey(checks[3])).error, /invalid regex/);
});

test('--timings imprime as fases no stderr e não engole argumentos', () => {
  const proc = spawnSync('node', [BIN, 'status', '--timings'], { cwd: root, encoding: 'utf-8' });
  assert.match(proc.stderr, /timings:/);
  assert.match(proc.stderr, /walk files/);
  assert.match(proc.stderr, /scan annotations/);
});

test('grepPatterns: lote sem regex patológica resolve tudo num só subprocesso', () => {
  const checks = [
    { pattern: 'console\\.log', glob: 'src/**/*.js' },
    { pattern: 'const ok', glob: 'src/**/*.js' },
    { pattern: 'nunca-existe', glob: 'src/**/*.js' },
    { pattern: 'x', glob: 'sem-arquivos/**' },
  ];
  const res = grepPatterns(root, checks, loadConfig(root).ignoreGlobs);
  assert.equal(res.get(grepKey(checks[0])).hits.length, 1);
  assert.equal(res.get(grepKey(checks[1])).hits.length, 1);
  assert.equal(res.get(grepKey(checks[2])).hits.length, 0);
  assert.deepEqual(res.get(grepKey(checks[3])).files, []);
});

test('latestProjectMtime ignora arquivo ausente e devolve o mais recente', () => {
  const project = { config: { rootDir: root }, srcFiles: ['src/a.js', 'src/sumiu.js'], testFiles: ['test/a.test.js'] };
  assert.ok(latestProjectMtime(project, ['src/a.js', 'src/sumiu.js']) > 0);
  assert.equal(latestProjectMtime(project, ['src/sumiu.js']), 0);
});
