// Parser for tasks.md — T-xxx tasks with Refs (US/AC) and Files.
//
//   ## T-001 — Title [pending|in-progress|done]
//   - Refs: US-001, AC-001, AC-002
//   - Files: src/models/order.js, src/routes/order.js
//
// Status is normalized (lowercase, no accents): "[Done]" counts as done.
// An unknown token in [...] becomes TASK_STATUS_INVALID — it never silently
// degrades to "pending" (that would slip past the TASK_DONE_NO_PROOF gate).

import { DASH, splitLines, foldStatus } from '../util/text.js';

const RE_TASK_ANY = new RegExp(`^##\\s+(T-\\d{3,})\\s*${DASH}\\s*(.+?)\\s*$`);
const RE_STATUS_SUFFIX = /^(.*?)\s*\[([^\]]+)\]\s*$/;
const RE_REFS = /^\s*[-*]\s*Refs\s*:\s*(.+?)\s*$/i;
const RE_FILES = /^\s*[-*]\s*Files\s*:\s*(.+?)\s*$/i;
// optional fields used by the execution plan (onp-spec plan)
const RE_MODEL = /^\s*[-*]\s*Model\s*:\s*(.+?)\s*$/i;
const RE_EFFORT = /^\s*[-*]\s*Effort\s*:\s*(.+?)\s*$/i;

export const TASK_STATUSES = ['pending', 'in-progress', 'done'];

export function parseTasks(content, { file = 'tasks.md' } = {}) {
  const lines = splitLines(content);
  const result = { file, tasks: [], parseIssues: [] };
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    const task = line.match(RE_TASK_ANY);
    if (task) {
      let title = task[2];
      let status = null;
      const suffix = title.match(RE_STATUS_SUFFIX);
      if (suffix) {
        const folded = foldStatus(suffix[2].trim());
        if (TASK_STATUSES.includes(folded)) {
          title = suffix[1].trim();
          status = folded;
        } else {
          title = suffix[1].trim();
          status = 'pending';
          result.parseIssues.push({
            code: 'TASK_STATUS_INVALID',
            line: lineNo,
            message: `${task[1]}: status "[${suffix[2]}]" is not one of: ${TASK_STATUSES.join(', ')}`,
          });
        }
      } else {
        status = 'pending';
        result.parseIssues.push({
          code: 'TASK_NO_STATUS',
          line: lineNo,
          message: `${task[1]} without an explicit status — assuming [pending]`,
        });
      }
      current = { id: task[1], title, status, line: lineNo, refs: [], files: [], model: null, effort: null };
      result.tasks.push(current);
      continue;
    }

    if (!current) continue;

    const refs = line.match(RE_REFS);
    if (refs) {
      const ids = refs[1]
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const id of ids) {
        if (/^(US|AC)-\d{3,}$/.test(id)) {
          current.refs.push(id);
        } else {
          result.parseIssues.push({
            code: 'REF_MALFORMED',
            line: lineNo,
            message: `${current.id}: ref "${id}" is neither US-xxx nor AC-xxx`,
          });
        }
      }
      continue;
    }

    const files = line.match(RE_FILES);
    if (files) {
      // split ONLY on commas: paths with spaces are valid
      const paths = files[1]
        .split(',')
        .map((s) => s.trim().replace(/^`|`$/g, ''))
        .filter(Boolean);
      current.files.push(...paths);
      continue;
    }

    const model = line.match(RE_MODEL);
    if (model) {
      current.model = model[1].replace(/^`|`$/g, '');
      continue;
    }

    const effort = line.match(RE_EFFORT);
    if (effort) {
      current.effort = effort[1].replace(/^`|`$/g, '');
    }
  }

  return result;
}
