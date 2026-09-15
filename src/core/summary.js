// Overall progress summary — the text the agent posts in chat and the
// executor prints in the terminal every ~1 minute during a run.
//
// Two sources, always labeled:
//   'ai'     — written by a model (the headless executor calls `claude -p`,
//              `codex exec` or the Cursor CLI `agent -p`; in Antigravity the
//              agent itself writes it) and recorded with
//              `onp-spec summary <feature> --save --text "..."`
//   'engine' — deterministic, built from the ledger tree. It is the always
//              available fallback: zero dependencies, zero network, zero model.
//
// Freshness rule: an AI summary only counts if it is less than 2 minutes old;
// past that (or with no recorded summary), the engine's counts — a stale
// summary claiming "running" would be a lie.

import { openSync, closeSync, readSync, statSync, existsSync } from 'fs';
import {
  recordEvent,
  streamPath,
  toolSummary,
  codexItemSummary,
  cursorToolCallSummary,
} from './ledger.js';

export const AI_FRESHNESS_MS = 2 * 60 * 1000;

// ── last action of a task (cheap tail of the NDJSON stream) ────────────────

export function lastAction(runId, key, { maxBytes = 4096 } = {}) {
  const p = streamPath(runId, key);
  if (!existsSync(p)) return null;
  let text;
  let clipped = false;
  try {
    const st = statSync(p);
    const fd = openSync(p, 'r');
    const start = Math.max(0, st.size - maxBytes);
    const buf = Buffer.alloc(Math.min(maxBytes, st.size));
    readSync(fd, buf, 0, buf.length, start);
    closeSync(fd);
    text = buf.toString('utf-8');
    clipped = start > 0;
  } catch {
    return null;
  }
  const lines = text.split('\n').filter((l) => l.trim());
  if (clipped && lines.length) lines.shift(); // first line may be truncated
  for (let i = lines.length - 1; i >= 0; i--) {
    let e;
    try {
      e = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (e.type === 'assistant' && e.message) {
      for (const c of [...(e.message.content || [])].reverse()) {
        if (c.type === 'tool_use') return `${c.name}: ${toolSummary(c.name, c.input || {})}`;
        if (c.type === 'text' && String(c.text || '').trim()) {
          const t = String(c.text).trim().split('\n')[0];
          return t.length > 120 ? `${t.slice(0, 120)}…` : t;
        }
      }
    }
    // codex exec --json: item.started shows the command still running
    if ((e.type === 'item.completed' || e.type === 'item.started') && e.item) {
      const tool = codexItemSummary(e.item);
      if (tool) return tool.summary ? `${tool.name}: ${tool.summary}` : tool.name;
      if (e.item.type === 'agent_message' && String(e.item.text || '').trim()) {
        const t = String(e.item.text).trim().split('\n')[0];
        return t.length > 120 ? `${t.slice(0, 120)}…` : t;
      }
    }
    // Cursor CLI: tool_call started shows the tool still running
    if (e.type === 'tool_call' && e.tool_call) {
      const tool = cursorToolCallSummary(e.tool_call);
      if (tool) return tool.summary ? `${tool.name}: ${tool.summary}` : tool.name;
    }
  }
  return null;
}

// ── deterministic summary (the engine counts what it sees in the ledger) ───

function runSentences(run) {
  const sentences = [];
  const label = `"${run.feature}" (${run.project})`;
  sentences.push(`${label}: ${run.done} of ${run.total} task(s) done.`);

  const running = [];
  for (const fx of run.lanes) {
    for (const t of fx.tasks) {
      if (t.state === 'running') running.push({ lane: fx.id, t });
    }
  }
  for (const t of run.sequential) {
    if (t.state === 'running') running.push({ lane: 'seq', t });
  }
  for (const { lane, t } of running) {
    const action = t.stream ? lastAction(run.runId, t.stream) : null;
    sentences.push(
      `Running now: ${t.id} (${t.title}) in ${lane}${action ? ` — last action: ${action}` : ''}.`
    );
  }

  const failures = run.lanes.filter((f) => f.state === 'failed' || f.state === 'conflict');
  for (const fx of failures) {
    sentences.push(
      fx.state === 'conflict'
        ? `${fx.id} stopped in a merge CONFLICT — needs resolution by the agent or you.`
        : `${fx.id} failed — ask the agent to re-run it (--lane ${fx.id}).`
    );
  }

  if (!run.running) {
    if (run.end === 0 && run.gate.audit === 0 && !run.gateStale) {
      sentences.push('Done: specification and code aligned (audit exit 0).');
    } else if (run.end === 1) {
      sentences.push('Finished with issues — see the gate and the lanes above.');
    } else if (run.done === run.total && run.total > 0 && run.gate.audit == null) {
      sentences.push('Tasks ready, gate (verify + audit) still pending.');
    } else if (!running.length) {
      sentences.push('Idle right now — no task running.');
    }
  }
  return sentences;
}

export function deterministicSummary(projects) {
  const runs = projects.flatMap((p) => p.runs);
  if (!runs.length) {
    return 'No run in the ledger yet. Generate a plan with `onp-spec plan <feature>` and ask the agent to execute it.';
  }
  // relevance: everything running; if nothing runs, the most recent run
  const running = runs.filter((run) => run.running);
  const target = running.length ? running : [runs[0]];
  return target.flatMap(runSentences).join(' ');
}

// richer context for the narrator model (the executor's `claude -p`):
// the engine summary + the last actions per running task
export function contextForAi(projects) {
  const L = [`Mechanical state: ${deterministicSummary(projects)}`];
  for (const p of projects) {
    for (const run of p.runs) {
      if (!run.running) continue;
      for (const fx of run.lanes) {
        L.push(`- ${run.feature}/${fx.id}: ${fx.state}${fx.attempt > 1 ? ` (attempt ${fx.attempt})` : ''}`);
        for (const t of fx.tasks) {
          const action = t.stream ? lastAction(run.runId, t.stream) : null;
          L.push(`  - ${t.id} [${t.state}] ${t.title}${action ? ` · last action: ${action}` : ''}`);
        }
      }
      for (const t of run.sequential) L.push(`  - seq ${t.id} [${t.state}] ${t.title}`);
    }
  }
  return L.join('\n');
}

// ── progress table (markdown, ready for the chat) ──────────────────────────
//
// The agent posts THIS table in chat every ~1 minute while the run is going:
// one row per task, with where it runs (lane/seq), the state now and the last
// action seen in the stream. A cell is ONE line of text (pipes and breaks are
// sanitized so the table does not break).

const STATE_ICON = {
  pending: '⏳',
  running: '▶️',
  done: '✅',
  failed: '❌',
};

const cell = (s) =>
  String(s == null ? '' : s)
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim() || '—';

function runTable(run) {
  const L = [];
  const mode = run.lanes.length ? `${run.lanes.length} parallel lane(s)` : 'sequential';
  L.push(
    `**${run.feature}** (${run.project}) — ${run.done} of ${run.total} task(s) done · ${mode}` +
      (run.running ? ' · RUNNING' : '')
  );
  L.push('');
  L.push('| task | title | where | status | last action |');
  L.push('|---|---|---|---|---|');
  const row = (t, where) => {
    const icon = STATE_ICON[t.state] || '·';
    const action = t.state === 'running' && t.stream ? lastAction(run.runId, t.stream) : null;
    L.push(`| ${t.id} | ${cell(t.title)} | ${where} | ${icon} ${t.state} | ${cell(action)} |`);
  };
  for (const fx of run.lanes) for (const t of fx.tasks) row(t, fx.id);
  for (const t of run.sequential) row(t, 'seq');

  const footer = [];
  for (const fx of run.lanes) {
    if (fx.state === 'conflict') footer.push(`${fx.id} in merge CONFLICT`);
    else if (fx.state === 'failed') footer.push(`${fx.id} failed (re-run: --lane ${fx.id})`);
  }
  if (run.gate.verify != null) footer.push(`verify exit ${run.gate.verify}`);
  if (run.gate.audit != null) footer.push(`audit exit ${run.gate.audit}${run.gateStale ? ' (stale)' : ''}`);
  if (footer.length) {
    L.push('');
    L.push(footer.join(' · '));
  }
  return L.join('\n');
}

export function progressTable(projects) {
  const runs = projects.flatMap((p) => p.runs);
  if (!runs.length) {
    return 'No run in the ledger yet. Generate a plan with `onp-spec plan <feature>` and ask the agent to execute it.';
  }
  // same relevance as the summary: everything running; if nothing runs, the most recent
  const running = runs.filter((run) => run.running);
  const target = running.length ? running : [runs[0]];
  return target.map(runTable).join('\n\n');
}

// ── the summary that counts NOW (fresh AI > engine) ────────────────────────

export function buildCurrentSummary(projects, { now = Date.now() } = {}) {
  let latest = null;
  for (const p of projects) {
    for (const run of p.runs) {
      if (run.summary && (!latest || run.summary.ts > latest.ts)) latest = run.summary;
    }
  }
  if (latest && latest.source === 'ai' && now - new Date(latest.ts).getTime() < AI_FRESHNESS_MS) {
    return latest;
  }
  return { text: deterministicSummary(projects), source: 'engine', ts: new Date(now).toISOString() };
}

// ── recording (used by the executor and by the agents) ─────────────────────

const MAX_TEXT = 1200;

export function recordSummary({ runId, text, source = 'engine' }) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
  if (!runId || !clean) return { error: 'summary needs a runId and text' };
  recordEvent({ type: 'summary', runId, text: clean, source: source === 'ai' ? 'ai' : 'engine' });
  return { text: clean, source };
}

// target run for `--save` without --run: the most recent one running in scope
export function targetRun(projects, { runId = null } = {}) {
  const runs = projects.flatMap((p) => p.runs);
  if (runId) return runs.find((run) => run.runId === runId) || null;
  return runs.find((run) => run.running) || runs[0] || null;
}
