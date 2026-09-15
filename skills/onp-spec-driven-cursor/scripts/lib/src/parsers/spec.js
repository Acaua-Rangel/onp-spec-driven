// Parser for spec.md — extracts user stories (US), acceptance criteria (AC),
// assumptions (ASM) and open questions (Q).
//
// The grammar is human markdown with mechanical anchors:
//   ### US-001 — Title
//   #### AC-001 — Title
//   - **Given** ... / - **When** ... / - **Then** ...
//   Tables under "## Assumptions" and "## Open questions".

import { DASH, splitLines, tableCells, isTableSeparator } from '../util/text.js';

const RE_META = /^>\s*(feature|status)\s*:\s*(.+?)\s*$/;
const RE_STORY = new RegExp(`^###\\s+(US-\\d{3,})\\s*${DASH}\\s*(.+?)\\s*$`);
const RE_AC = new RegExp(`^####\\s+(AC-\\d{3,})\\s*${DASH}\\s*(.+?)\\s*$`);
// accepts indentation (nested list), -/* marker and case-insensitive keyword
const RE_GWT = /^\s*[-*]\s*\*\*(Given|When|Then|And)\*\*\s*(.+?)\s*$/i;
const RE_SECTION = /^##\s+(.+?)\s*$/;
// 1-2 digit IDs in headings: near-IDs the grammar does not recognize
const RE_SHORT_ID = /^#{3,4}\s+((?:US|AC)-\d{1,2})\b/;

export const SPEC_STATUSES = ['draft', 'ready', 'in-implementation', 'implemented', 'audited'];
export const ASM_STATUSES = ['open', 'confirmed', 'invalidated'];
export const Q_STATUSES = ['open', 'answered'];

function normalizeSection(title) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function parseSpec(content, { file = 'spec.md' } = {}) {
  const lines = splitLines(content);
  const spec = {
    file,
    title: null,
    feature: null,
    status: null,
    stories: [],
    assumptions: [],
    questions: [],
    parseIssues: [],
    sections: { assumptions: false, questions: false },
  };

  let currentStory = null;
  let currentAc = null;
  let currentSection = null; // 'assumptions' | 'questions' | other
  let inTableHeader = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (spec.title === null) {
      const h1 = line.match(/^#\s+(.+?)\s*$/);
      if (h1) {
        spec.title = h1[1];
        continue;
      }
    }

    const meta = line.match(RE_META);
    if (meta) {
      if (meta[1] === 'feature') spec.feature = meta[2];
      if (meta[1] === 'status') spec.status = meta[2];
      continue;
    }

    const section = line.match(RE_SECTION);
    if (section) {
      const norm = normalizeSection(section[1]);
      if (norm.startsWith('assumption')) {
        currentSection = 'assumptions';
        spec.sections.assumptions = true;
      } else if (norm.startsWith('question') || norm.startsWith('open question')) {
        currentSection = 'questions';
        spec.sections.questions = true;
      } else currentSection = norm;
      currentStory = null;
      currentAc = null;
      inTableHeader = false;
      continue;
    }

    const shortId = line.match(RE_SHORT_ID);
    if (shortId) {
      spec.parseIssues.push({
        code: 'ID_SHORT',
        line: lineNo,
        message: `"${shortId[1]}" has fewer than 3 digits and is not recognized — use ${shortId[1].replace(/\d+$/, (d) => d.padStart(3, '0'))}`,
      });
    }

    const story = line.match(RE_STORY);
    if (story) {
      currentStory = {
        id: story[1],
        title: story[2],
        line: lineNo,
        description: [],
        acs: [],
      };
      spec.stories.push(currentStory);
      currentAc = null;
      continue;
    }

    const ac = line.match(RE_AC);
    if (ac) {
      currentAc = {
        id: ac[1],
        title: ac[2],
        line: lineNo,
        storyId: currentStory ? currentStory.id : null,
        given: [],
        when: [],
        then: [],
      };
      if (currentStory) {
        currentStory.acs.push(currentAc);
      } else {
        spec.parseIssues.push({
          code: 'AC_OUTSIDE_US',
          line: lineNo,
          message: `${ac[1]} defined outside a user story (US)`,
        });
      }
      continue;
    }

    const gwt = line.match(RE_GWT);
    if (gwt && currentAc) {
      const kind = gwt[1].toLowerCase();
      const text = gwt[2];
      if (kind === 'given') currentAc.given.push(text);
      else if (kind === 'when') currentAc.when.push(text);
      else if (kind === 'then') currentAc.then.push(text);
      else if (kind === 'and') {
        // "And" continues the last filled clause
        if (currentAc.then.length) currentAc.then.push(text);
        else if (currentAc.when.length) currentAc.when.push(text);
        else currentAc.given.push(text);
      }
      continue;
    }

    if (currentSection === 'assumptions' || currentSection === 'questions') {
      const cells = tableCells(line);
      if (cells === null) continue;
      if (isTableSeparator(cells)) continue;
      const first = cells[0] || '';
      if (currentSection === 'assumptions') {
        if (/^ASM-\d{3,}$/.test(first)) {
          spec.assumptions.push({
            id: first,
            text: cells[1] || '',
            status: (cells[2] || '').toLowerCase(),
            resolution: cells[3] || '',
            line: lineNo,
          });
        } else if (!inTableHeader && first.toLowerCase() !== 'id') {
          // first non-separator row without a valid ID: only flag if it looks like data
          if (first && first.toLowerCase() !== 'id') {
            spec.parseIssues.push({
              code: 'ASM_ID_INVALID',
              line: lineNo,
              message: `assumption row without a valid ASM-xxx ID: "${first}"`,
            });
          }
        }
        if (first.toLowerCase() === 'id') inTableHeader = true;
      } else {
        if (/^Q-\d{3,}$/.test(first)) {
          spec.questions.push({
            id: first,
            text: cells[1] || '',
            status: (cells[2] || '').toLowerCase(),
            answer: cells[3] || '',
            line: lineNo,
          });
        } else if (first && first.toLowerCase() !== 'id' && !inTableHeader) {
          spec.parseIssues.push({
            code: 'Q_ID_INVALID',
            line: lineNo,
            message: `question row without a valid Q-xxx ID: "${first}"`,
          });
        }
        if (first.toLowerCase() === 'id') inTableHeader = true;
      }
      continue;
    }

    if (currentStory && !currentAc && line.trim() && !line.startsWith('#')) {
      currentStory.description.push(line.trim());
    }
  }

  return spec;
}

// Flat list of all ACs in the spec.
export function allAcs(spec) {
  return spec.stories.flatMap((s) => s.acs);
}
