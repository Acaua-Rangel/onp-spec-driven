// Signal history — the engine's mechanical memory.
//
// Every audit finding and every verify fail/skip becomes a signal persisted
// in .spec/verification/signals.json. This history is what GROUNDS lessons:
// `lessons add` only accepts a lesson if the cited signal really happened in
// this project. Without a recorded signal, a lesson is opinion — rejected.
//
// The file is keyed by (code, feature, ref), not append-only: its size grows
// with the number of distinct FAILURE POINTS, not with the number of runs —
// which keeps it bounded even with hundreds of features.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';

export const SIGNALS_DEFAULTS = { windowDays: 90, maxSignals: 20000 };

const RE_REF = /(?:US|AC|ASM|Q|T|P)-\d{3,}/;

function now() {
  return new Date().toISOString();
}

function signalsPath(specRoot) {
  return path.join(specRoot, 'verification', 'signals.json');
}

export function loadSignals(specRoot) {
  const file = signalsPath(specRoot);
  if (!existsSync(file)) return { schema: 1, signals: {} };
  try {
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    if (!data.signals || typeof data.signals !== 'object') data.signals = {};
    return data;
  } catch {
    return { schema: 1, signals: {} };
  }
}

// Keeps the history bounded: drops signals outside the window and, if it still
// exceeds the cap, keeps the most recent ones.
function compact(data, opts) {
  const windowDays = opts.windowDays ?? SIGNALS_DEFAULTS.windowDays;
  const max = opts.maxSignals ?? SIGNALS_DEFAULTS.maxSignals;
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  let entries = Object.entries(data.signals).filter(
    ([, s]) => Date.parse(s.lastSeen) >= cutoff
  );
  if (entries.length > max) {
    entries.sort((a, b) => Date.parse(b[1].lastSeen) - Date.parse(a[1].lastSeen));
    entries = entries.slice(0, max);
  }
  data.signals = Object.fromEntries(entries);
}

export function saveSignals(specRoot, data, opts = {}) {
  compact(data, opts);
  const file = signalsPath(specRoot);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function record(data, { code, feature, ref, gitRev }) {
  const key = `${code}::${feature || '—'}::${ref || '—'}`;
  const existing = data.signals[key];
  if (existing) {
    existing.occurrences += 1;
    existing.lastSeen = now();
    if (gitRev) existing.gitRev = gitRev;
  } else {
    data.signals[key] = {
      code,
      feature: feature || '—',
      ref: ref || '—',
      occurrences: 1,
      firstSeen: now(),
      lastSeen: now(),
      gitRev: gitRev || null,
    };
  }
}

// A checkable ref for a finding: the canonical ID cited (explicit field or the
// first one in the message); otherwise the file it points to.
function refOfFinding(f) {
  if (f.principle) return f.principle;
  const m = (f.message || '').match(RE_REF);
  if (m) return m[0];
  return f.file || '—';
}

export function recordFindings(specRoot, findings, { gitRev = null, ...opts } = {}) {
  if (!findings.length || !existsSync(specRoot)) return 0;
  const data = loadSignals(specRoot);
  for (const f of findings) {
    record(data, { code: f.code, feature: f.feature, ref: refOfFinding(f), gitRev });
  }
  saveSignals(specRoot, data, opts);
  return findings.length;
}

export function recordVerify(specRoot, rec, opts = {}) {
  const events = [];
  for (const [acId, r] of Object.entries(rec.results || {})) {
    if (r.status === 'fail') events.push({ code: 'VERIFY_FAILED', ref: acId });
    else if (r.status === 'skip') events.push({ code: 'VERIFY_SKIPPED', ref: acId });
  }
  for (const [pId, r] of Object.entries(rec.principles || {})) {
    if (r.status !== 'pass') events.push({ code: 'VERIFY_FAILED', ref: pId });
  }
  if (!events.length || !existsSync(specRoot)) return 0;
  const data = loadSignals(specRoot);
  for (const e of events) {
    record(data, { ...e, feature: rec.feature, gitRev: rec.gitRev });
  }
  saveSignals(specRoot, data, opts);
  return events.length;
}

// The signal that grounds a lesson: same code, same feature (or a global
// signal, with no feature) and a source that matches the recorded ref.
export function findSignal(data, { signal, feature, source }) {
  if (!source) return null;
  const candidates = Object.values(data.signals).filter(
    (s) => s.code === signal && (s.feature === feature || s.feature === '—')
  );
  const exact = candidates.find((s) => s.ref === source);
  if (exact) return exact;
  if (source.length < 4) return null;
  return (
    candidates.find(
      (s) => s.ref !== '—' && (source.includes(s.ref) || s.ref.includes(source))
    ) || null
  );
}

export function availableRefs(data, { signal, feature }) {
  return [
    ...new Set(
      Object.values(data.signals)
        .filter((s) => s.code === signal && (s.feature === feature || s.feature === '—'))
        .map((s) => s.ref)
    ),
  ];
}
