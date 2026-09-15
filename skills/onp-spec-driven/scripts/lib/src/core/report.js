// Rendering of audit results — terminal, JSON and markdown.
// The readable name comes first; the stable code (for CI/lessons) sits beside it.

import { findingLabel } from './labels.js';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  red: (s) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  dim: (s) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
};

export function renderTerminal(audit) {
  const lines = [];
  const { findings, stats, ok } = audit;

  for (const f of findings) {
    const tag = f.severity === 'error' ? c.red('ERROR') : c.yellow('WARN ');
    const loc = f.file ? c.dim(` ${f.file}${f.line ? `:${f.line}` : ''}`) : '';
    const feat = f.feature ? c.dim(`[${f.feature}] `) : '';
    lines.push(
      `${tag} ${c.bold(findingLabel(f.code))} ${c.dim(`(${f.code})`)} ${feat}${f.message}${loc}`
    );
  }

  if (findings.length) lines.push('');
  lines.push(
    `${c.bold('summary:')} ${stats.features} feature(s) · ${stats.stories} user stor${stats.stories === 1 ? 'y' : 'ies'} ` +
      `· ${stats.acs} acceptance criteria · ${stats.acsWithTest}/${stats.acs} with a test ` +
      `· ${stats.acsProven}/${stats.acs} proven` +
      (stats.assumptionsOpen ? ` · ${c.yellow(`${stats.assumptionsOpen} open assumption(s)`)}` : '') +
      (stats.questionsOpen ? ` · ${c.yellow(`${stats.questionsOpen} open question(s)`)}` : '')
  );
  lines.push(
    ok
      ? c.green(`✔ clean audit (${stats.warnings} warning(s))`)
      : c.red(`✘ ${stats.errors} error(s), ${stats.warnings} warning(s)`)
  );
  return lines.join('\n');
}

export function renderJson(audit) {
  return JSON.stringify({ ok: audit.ok, stats: audit.stats, findings: audit.findings }, null, 2);
}

export function renderMarkdown(audit, { title = 'Audit report' } = {}) {
  const { findings, stats, ok } = audit;
  const lines = [`# ${title}`, ''];
  lines.push(`- Result: ${ok ? '✅ PASS' : '❌ FAIL'}`);
  lines.push(`- Features: ${stats.features} · User stories: ${stats.stories} · Acceptance criteria: ${stats.acs}`);
  lines.push(`- Criteria with a test: ${stats.acsWithTest}/${stats.acs} · Criteria proven: ${stats.acsProven}/${stats.acs}`);
  lines.push(`- Open assumptions: ${stats.assumptionsOpen} · Open questions: ${stats.questionsOpen}`);
  lines.push('');
  if (findings.length) {
    lines.push('| Severity | Problem | Feature | Detail | Location |');
    lines.push('|---|---|---|---|---|');
    for (const f of findings) {
      const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '—';
      lines.push(
        `| ${f.severity} | ${findingLabel(f.code)} (\`${f.code}\`) | ${f.feature || '—'} | ${f.message.replace(/\|/g, '\\|')} | ${loc} |`
      );
    }
  } else {
    lines.push('No problems found. Specification and code aligned.');
  }
  lines.push('');
  return lines.join('\n');
}
