// O motor vive UMA vez (src/ + templates/). Cada skill instalada recebe uma
// cópia gerada (scripts/): este teste garante que a geração espelha a fonte e
// que `init --agents` entrega uma skill executável. Para instalar à mão a
// partir de um clone: node tools/build-skill.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync, mkdirSync } from 'fs';
import { spawnSync } from 'child_process';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { ENTRY, buildSkillDir, SKILLS } from '../tools/build-skill.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'onpspec-skillsync-'));
after(() => rmSync(tmpRoot, { recursive: true, force: true }));

function walk(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.DS_Store') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full));
  }
  return out.sort();
}

test('o repositório não versiona cópias do motor dentro das skills', () => {
  const gitignore = readFileSync(path.join(ROOT, '.gitignore'), 'utf-8');
  assert.match(gitignore, /^skills\/\*\/scripts\/$/m);
  const tracked = spawnSync('git', ['ls-files', 'skills'], { cwd: ROOT, encoding: 'utf-8' }).stdout;
  assert.doesNotMatch(tracked, /\/scripts\//, 'skills/*/scripts/ não deve estar no git');
});

const built = path.join(tmpRoot, 'engine');
test('buildSkillDir gera lib/src e lib/templates espelhando a fonte, mais o entrypoint', () => {
  buildSkillDir(built);
  const srcFiles = walk(path.join(ROOT, 'src'));
  assert.deepEqual(walk(path.join(built, 'lib', 'src')), srcFiles);
  for (const rel of srcFiles) {
    assert.equal(
      readFileSync(path.join(built, 'lib', 'src', rel), 'utf-8'),
      readFileSync(path.join(ROOT, 'src', rel), 'utf-8'),
      `conteúdo diverge: ${rel}`
    );
  }
  const tplFiles = walk(path.join(ROOT, 'templates')).filter((f) => !f.startsWith('agents/'));
  assert.deepEqual(walk(path.join(built, 'lib', 'templates')), tplFiles);
  assert.equal(readFileSync(path.join(built, 'onp-spec.mjs'), 'utf-8'), ENTRY);
});

test('o motor gerado executa de verdade', () => {
  const proc = spawnSync('node', [path.join(built, 'onp-spec.mjs'), 'version'], { encoding: 'utf-8' });
  assert.equal(proc.status, 0, proc.stderr);
  assert.match(proc.stdout, /embedded/);
});

const DEST_BY_AGENT = {
  claude: '.claude', antigravity: '.agents', codex: '.agents',
  cursor: '.cursor', copilot: '.github', gemini: '.gemini',
};
for (const [agent, dir] of Object.entries(DEST_BY_AGENT)) {
  test(`init --agents ${agent} instala a skill com o motor gerado e executável`, () => {
    const proj = path.join(tmpRoot, `proj-${agent}`);
    mkdirSync(proj, { recursive: true });
    const init = spawnSync('node', [path.join(ROOT, 'bin', 'onp-spec.js'), 'init', '--agents', agent], {
      cwd: proj, encoding: 'utf-8',
    });
    assert.equal(init.status, 0, init.stdout + init.stderr);
    const skill = path.join(proj, dir, 'skills', 'onp-spec-driven');
    assert.ok(existsSync(path.join(skill, 'SKILL.md')));
    assert.ok(existsSync(path.join(skill, 'scripts', 'onp-spec.mjs')), 'scripts/ não foi gerado');
    const run = spawnSync('node', [path.join(skill, 'scripts', 'onp-spec.mjs'), 'status'], {
      cwd: proj, encoding: 'utf-8',
    });
    assert.equal(run.status, 0, run.stdout + run.stderr);
  });
}

// A SKILL.md de cada skill declara seu agente (o init usa o marcador para não
// instalar a skill errada) e todas mantêm a MESMA versão (política: bump junto).
test('SKILL.md: marcador agent correto e versões alinhadas', () => {
  const frontmatter = (skill) =>
    readFileSync(path.join(ROOT, 'skills', skill, 'SKILL.md'), 'utf-8').split('---')[1];
  const claude = frontmatter('onp-spec-driven');
  const ag = frontmatter('onp-spec-driven-antigravity');
  const codex = frontmatter('onp-spec-driven-codex');
  const cursor = frontmatter('onp-spec-driven-cursor');
  const copilot = frontmatter('onp-spec-driven-copilot');
  const gemini = frontmatter('onp-spec-driven-gemini');
  assert.match(claude, /^\s*agent:\s*claude\s*$/m);
  assert.match(ag, /^\s*agent:\s*antigravity\s*$/m);
  assert.match(codex, /^\s*agent:\s*codex\s*$/m);
  assert.match(cursor, /^\s*agent:\s*cursor\s*$/m);
  assert.match(copilot, /^\s*agent:\s*copilot\s*$/m);
  assert.match(gemini, /^\s*agent:\s*gemini\s*$/m);
  const versao = (fm) => fm.match(/^\s*version:\s*(\S+)/m)?.[1];
  assert.equal(versao(claude), versao(ag), 'versões das skills divergem — bump junto');
  assert.equal(versao(claude), versao(codex), 'versões das skills divergem — bump junto');
  assert.equal(versao(claude), versao(cursor), 'versões das skills divergem — bump junto');
  assert.equal(versao(claude), versao(copilot), 'versões das skills divergem — bump junto');
  assert.equal(versao(claude), versao(gemini), 'versões das skills divergem — bump junto');
});

// O Cursor exige que o `name:` do frontmatter seja IGUAL ao nome da pasta
// instalada (.cursor/skills/onp-spec-driven) — senão a skill não carrega.
test('SKILL.md (cursor): name compatível com a pasta de instalação', () => {
  const frontmatter = readFileSync(
    path.join(ROOT, 'skills', 'onp-spec-driven-cursor', 'SKILL.md'),
    'utf-8'
  ).split('---')[1];
  assert.match(frontmatter, /^\s*name:\s*onp-spec-driven\s*$/m);
  assert.match(frontmatter, /^\s*description:\s*\S/m, 'description é obrigatória para a ativação automática');
});


// As regras anti-fraude do contrato são sagradas: nenhuma skill pode perder
// "never weaken/skip/delete a test" nem a degradação graciosa (WEAK PROOF).
test('SKILL.md: contrato e degradação graciosa presentes nas quatro skills', () => {
  for (const skill of SKILLS) {
    const conteudo = readFileSync(path.join(ROOT, 'skills', skill, 'SKILL.md'), 'utf-8');
    assert.match(conteudo, /Never weaken, skip, or delete a test/, `${skill}: regra 6 do contrato sumiu`);
    assert.match(conteudo, /skip\/todo\) is not proof/, `${skill}: "skip is not proof" sumiu`);
    assert.match(conteudo, /WEAK PROOF \(manual audit\)/, `${skill}: degradação graciosa sumiu`);
    assert.match(conteudo, /audit --ci` exits with code\s+0/, `${skill}: gate do audit sumiu`);
  }
});

// No codex, custo é escolha do usuário: a skill NUNCA pode perder o gate de
// confirmação de modelos/esforços antes de executar (licença barata torra
// tokens com modelo forte + esforço alto).
test('SKILL.md (codex): gate de confirmação de modelos e esforços presente', () => {
  const conteudo = readFileSync(path.join(ROOT, 'skills', 'onp-spec-driven-codex', 'SKILL.md'), 'utf-8');
  assert.match(conteudo, /MODEL and EFFORT are the USER's choice — confirm BEFORE\s+executing/);
  assert.match(conteudo, /Without this confirmation,?\s+don't execute/);
  assert.match(conteudo, /Never increase the\s+model\/effort without the user asking for it/);
  assert.match(conteudo, /--model\s+gpt-5\.6-luna --effort low/);
  assert.match(conteudo, /onp-spec task <feature> <T-xxx> --model/);
});

// No cursor, idem: modelos claude-*/gpt-* são cobrados por uso no plano do
// usuário — o gate de confirmação de modelos é sagrado, e a skill precisa
// ser honesta sobre o esforço (não existe flag no CLI; vai no slug).
test('SKILL.md (cursor): gate de confirmação de modelos e honestidade do esforço', () => {
  const conteudo = readFileSync(path.join(ROOT, 'skills', 'onp-spec-driven-cursor', 'SKILL.md'), 'utf-8');
  assert.match(conteudo, /The MODEL for each task is the USER's choice — confirm BEFORE\s+executing/);
  assert.match(conteudo, /Without this confirmation, don't\s+execute/);
  assert.match(conteudo, /Never swap in a pricier model\s+without the user asking for it/);
  assert.match(conteudo, /--model composer/);
  assert.match(conteudo, /onp-spec task <feature> <T-xxx> --model/);
  // honestidade: o CLI do Cursor não tem flag de esforço — o slug decide
  assert.match(conteudo, /the Cursor CLI has no effort\s+flag/);
  assert.match(conteudo, /gpt-5\.6-terra-high/);
  // e o executor depende do --force (sem ele o modo print não escreve)
  assert.match(conteudo, /--force/);
  assert.match(conteudo, /\.cursor\/cli\.json/);
});
