// Lessons layer — the project learns from its own signals.
//
// The split that keeps this alive: the agent brings the JUDGEMENT (phrasing
// the general rule that would avoid recurrence); the engine owns everything
// MECHANICAL — grounding against the signal history, dedup by normalization,
// recurrence across distinct features, candidate→confirmed promotion,
// penalize→quarantine, pruning and rendering. Manual bookkeeping is exactly
// what rots a lessons file, so it does not exist here.
//
// Selectivity is mechanical, not opinion:
//   1. a lesson with no recorded signal in the history → rejected (LESSON_NO_GROUNDING);
//   2. only lessons corroborated in >= promotionThreshold distinct features
//      become confirmed — and only confirmed ones are loaded as guidance;
//   3. uncorroborated candidates within the window are pruned;
//   4. the listing has a fixed cap — context cost does not grow with the repo.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { findSignal, availableRefs, SIGNALS_DEFAULTS } from './signals.js';

export const LESSONS_DEFAULTS = {
  promotionThreshold: 2,
  quarantineThreshold: 2,
  windowDays: SIGNALS_DEFAULTS.windowDays,
  listLimit: 10,
  maxSignals: SIGNALS_DEFAULTS.maxSignals,
};

export const LESSON_STATUSES = ['candidate', 'confirmed', 'quarantine'];

const MAX_TEXT = 280;
const MAX_EVIDENCE = 5;

function now() {
  return new Date().toISOString();
}

function storePath(specRoot) {
  return path.join(specRoot, 'lessons.json');
}

function renderPath(specRoot) {
  return path.join(specRoot, 'LESSONS.md');
}

export function loadLessons(specRoot) {
  const file = storePath(specRoot);
  if (!existsSync(file)) return { schema: 1, nextId: 1, lessons: [] };
  try {
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    if (!Array.isArray(data.lessons)) data.lessons = [];
    if (!Number.isInteger(data.nextId)) data.nextId = data.lessons.length + 1;
    return data;
  } catch {
    throw new Error(`${file} corrupted — restore from git or delete it to start over`);
  }
}

export function saveLessons(specRoot, data) {
  mkdirSync(specRoot, { recursive: true });
  writeFileSync(storePath(specRoot), `${JSON.stringify(data, null, 2)}\n`);
  writeFileSync(renderPath(specRoot), renderLessons(data));
}

// Dedup key: lowercase, no accents, no punctuation, collapsed spaces.
// Exact-after-normalization, no semantics — that is why the phrasing must be
// canonical and terse (two lessons that say the same must READ the same).
function normalize(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pad3(n) {
  return String(n).padStart(3, '0');
}

// CLI flags without a value arrive as `true` — treat any non-string as absent
// instead of crashing.
function field(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function addLesson(data, signalsData, entry, cfg = LESSONS_DEFAULTS) {
  const text = field(entry.text);
  const signal = field(entry.signal);
  const feature = field(entry.feature);
  const source = field(entry.source);
  const scope = field(entry.scope) || null;

  if (!text) return { error: 'missing --text: the general rule, in one actionable sentence' };
  if (text.length > MAX_TEXT) {
    return {
      error: `text with ${text.length} characters — a lesson is ONE general, actionable sentence (max ${MAX_TEXT})`,
    };
  }
  if (!signal) return { error: 'missing --signal: the finding/failure code that motivated the lesson' };
  if (!feature) return { error: 'missing --feature: the feature where the signal happened' };
  if (!source) return { error: 'missing --source: the ID (AC-xxx, T-xxx, P-xxx...) or file of the signal' };

  const grounding = findSignal(signalsData, { signal, feature, source });
  if (!grounding) {
    const refs = availableRefs(signalsData, { signal, feature });
    const hint = refs.length
      ? `refs recorded for ${signal} in ${feature}: ${refs.slice(0, 8).join(', ')}${refs.length > 8 ? ` (+${refs.length - 8})` : ''}`
      : `no ${signal} signal recorded for ${feature} — the history is only written by audit/verify`;
    return {
      error: `LESSON_NO_GROUNDING: no signal matches (${signal}, ${feature}, ${source}). A lesson without a real signal is opinion — the engine rejects it. ${hint}`,
    };
  }

  const evidence = {
    source: grounding.ref,
    feature,
    when: now(),
    gitRev: grounding.gitRev || null,
  };

  const key = `${signal}::${normalize(text)}`;
  const existing = data.lessons.find((l) => l.key === key);

  if (existing) {
    if (existing.status === 'quarantine') {
      return {
        error: `${existing.id} is quarantined (it was applied and the failure recurred) — review with the user before reactivating`,
      };
    }
    if (!existing.features.includes(feature)) existing.features.push(feature);
    existing.recurrence = existing.features.length;
    existing.evidence = [...existing.evidence, evidence].slice(-MAX_EVIDENCE);
    existing.lastSeen = evidence.when;
    if (scope && !existing.scope) existing.scope = scope;
    if (existing.status === 'candidate' && existing.recurrence >= cfg.promotionThreshold) {
      existing.status = 'confirmed';
      return { lesson: existing, event: 'promoted' };
    }
    return { lesson: existing, event: 'reinforced' };
  }

  const lesson = {
    id: `L-${pad3(data.nextId)}`,
    text,
    key,
    signal,
    scope,
    status: 'candidate',
    recurrence: 1,
    features: [feature],
    evidence: [evidence],
    penalties: 0,
    createdAt: evidence.when,
    lastSeen: evidence.when,
  };
  data.nextId += 1;
  data.lessons.push(lesson);
  return { lesson, event: 'created' };
}

// Pruning: a candidate that did not corroborate within the window leaves the store.
export function pruneLessons(data, cfg = LESSONS_DEFAULTS) {
  const cutoff = Date.now() - cfg.windowDays * 24 * 60 * 60 * 1000;
  const removed = [];
  data.lessons = data.lessons.filter((l) => {
    const stagnant =
      l.status === 'candidate' &&
      l.recurrence < cfg.promotionThreshold &&
      Date.parse(l.lastSeen) < cutoff;
    if (stagnant) removed.push(l.id);
    return !stagnant;
  });
  return removed;
}

function scopeMatches(lessonScope, filter) {
  if (!filter) return true;
  if (!lessonScope) return false;
  return lessonScope === filter || lessonScope.startsWith(`${filter}/`);
}

export function listLessons(data, opts = {}) {
  const status = opts.status || 'confirmed';
  const limit = opts.limit ?? LESSONS_DEFAULTS.listLimit;
  const query = opts.query ? normalize(opts.query) : null;

  return data.lessons
    .filter((l) => status === 'all' || l.status === status)
    .filter((l) => scopeMatches(l.scope, opts.scope))
    .filter(
      (l) =>
        !query ||
        normalize(`${l.text} ${l.signal} ${l.scope || ''}`).includes(query)
    )
    .sort(
      (a, b) =>
        b.recurrence - a.recurrence || Date.parse(b.lastSeen) - Date.parse(a.lastSeen)
    )
    .slice(0, limit);
}

export function penalizeLesson(data, id, cfg = LESSONS_DEFAULTS) {
  const lesson = data.lessons.find((l) => l.id === id);
  if (!lesson) return { error: `lesson ${id} does not exist` };
  if (lesson.status !== 'confirmed') {
    return {
      error: `${id} is "${lesson.status}" — only confirmed lessons are applied as guidance, so only they can fail when applied`,
    };
  }
  lesson.penalties += 1;
  if (lesson.penalties >= cfg.quarantineThreshold) {
    lesson.status = 'quarantine';
    return { lesson, event: 'quarantined' };
  }
  return { lesson, event: 'penalized' };
}

// Mechanical mining: signals that recurred across distinct features and still
// have few (or no) associated lessons. The engine points at WHERE it is worth
// writing a lesson; the judgement of HOW to phrase it stays with the agent.
export function suggestLessons(data, signalsData, cfg = LESSONS_DEFAULTS, opts = {}) {
  const limit = opts.limit ?? 5;
  const byCode = new Map();
  for (const s of Object.values(signalsData.signals)) {
    let g = byCode.get(s.code);
    if (!g) {
      g = { code: s.code, features: new Set(), refs: new Set(), occurrences: 0 };
      byCode.set(s.code, g);
    }
    if (s.feature !== '—') g.features.add(s.feature);
    if (s.ref !== '—') g.refs.add(s.ref);
    g.occurrences += s.occurrences;
  }

  return [...byCode.values()]
    .filter((g) => g.features.size >= cfg.promotionThreshold)
    .map((g) => ({
      signal: g.code,
      features: [...g.features].sort(),
      refs: [...g.refs].slice(0, 8),
      occurrences: g.occurrences,
      existingLessons: data.lessons.filter(
        (l) => l.signal === g.code && l.status !== 'quarantine'
      ).length,
    }))
    .sort(
      (a, b) =>
        a.existingLessons - b.existingLessons ||
        b.features.length - a.features.length ||
        b.occurrences - a.occurrences
    )
    .slice(0, limit);
}

export function renderLessons(data) {
  const lines = [];
  lines.push('# LESSONS — maintained by the engine (`onp-spec lessons`)');
  lines.push('');
  lines.push('> Do not edit by hand: any engine write overwrites this file.');
  lines.push('> Canonical state in `.spec/lessons.json`; mutate only via `onp-spec lessons`.');
  lines.push('');

  const byStatus = { confirmed: [], candidate: [], quarantine: [] };
  for (const l of data.lessons) (byStatus[l.status] || byStatus.candidate).push(l);

  const block = (title, items, note) => {
    lines.push(`## ${title}`);
    lines.push('');
    lines.push(note);
    lines.push('');
    if (!items.length) {
      lines.push('_none_');
      lines.push('');
      return;
    }
    for (const l of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
      lines.push(`### ${l.id} — ${l.text}`);
      const scope = l.scope ? ` · scope: \`${l.scope}\`` : '';
      lines.push(
        `- signal: \`${l.signal}\` · recurrence: ${l.recurrence} feature(s)${scope} · penalties: ${l.penalties}`
      );
      lines.push(`- features: ${l.features.join(', ')}`);
      const ev = l.evidence[l.evidence.length - 1];
      if (ev) lines.push(`- last evidence: ${ev.source} (${ev.feature}, ${ev.when})`);
      lines.push('');
    }
  };

  block(
    'Confirmed — load them in Specify/Design',
    byStatus.confirmed,
    'Corroborated across multiple features. Apply as guidance.'
  );
  block(
    'Candidates — under observation, do NOT apply yet',
    byStatus.candidate,
    'Seen in a single feature. Recorded, not trusted.'
  );
  block(
    'Quarantine — applied and failed, ignore',
    byStatus.quarantine,
    'The failure recurred even with the lesson applied. Review is up to the user.'
  );

  return `${lines.join('\n').trimEnd()}\n`;
}
