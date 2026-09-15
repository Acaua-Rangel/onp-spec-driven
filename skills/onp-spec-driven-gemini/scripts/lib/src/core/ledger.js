// Global ledger — ONE file for every run, across all projects.
//
//   ~/.onp-spec/panel/ledger.jsonl        (override: ONP_SPEC_HOME)
//   ~/.onp-spec/panel/streams/<runId>/<key>.jsonl
//
// Each ledger line is a JSON event. It is the shared source of truth for what
// is running: `onp-spec summary` reads this single file and builds the tree
// project → run → lane → task, so it works even with different projects
// running at the same time (the user's repository stores no run state).
//
// Event types:
//   plan {runId, project, projectDir, feature, agent, plan}
//   lane {runId, lane, state: running|merging|merged|conflict|failed, attempt}
//   task {runId, task, lane, state: running|done|failed, stream}
//   gate {runId, step: verify|audit, exit}
//   end  {runId, exit, scope}
//   summary {runId, text, source: ai|engine} — the "overall progress summary"
//          that the executor writes every ~1 min and the agent relays in chat
//
// Each task stream is the raw JSONL from the agent's headless CLI —
// `claude -p --output-format stream-json` (system/assistant/user/result
// events), `codex exec --json` (thread.*/turn.*/item.* events), or the Cursor
// CLI `agent -p --output-format stream-json` (system/assistant/tool_call/
// result events; init, assistant and result have the SAME shape as claude —
// only the tools arrive as tool_call) — and the parser below turns any of them
// into a readable timeline.

import os from 'os';
import path from 'path';
import {
  appendFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  statSync,
} from 'fs';

export const LANE_STATES = ['waiting', 'running', 'merging', 'merged', 'conflict', 'failed'];
export const MAX_RUNS = 30; // pruning: older runs drop out (with their streams)

export function onpHome() {
  return process.env.ONP_SPEC_HOME || path.join(os.homedir(), '.onp-spec');
}

export function paths() {
  const dir = path.join(onpHome(), 'panel');
  return { dir, ledger: path.join(dir, 'ledger.jsonl'), streams: path.join(dir, 'streams') };
}

export function recordEvent(event) {
  const { dir, ledger } = paths();
  mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  appendFileSync(ledger, `${line}\n`);
  return line;
}

export function readEvents() {
  const { ledger } = paths();
  if (!existsSync(ledger)) return [];
  const out = [];
  for (const line of readFileSync(ledger, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // corrupted line (disk full, truncated concurrent write) — ignore
    }
  }
  return out;
}

export function streamPath(runId, key) {
  return path.join(paths().streams, runId, `${key}.jsonl`);
}

export function streamKey(laneOrSeq, task) {
  return `${laneOrSeq}--${task}`;
}

// ── consolidated tree (what the summary narrates) ───────────────────────────

export function buildTree(events, { projectDir = null, feature = null } = {}) {
  const runs = new Map();

  for (const e of events) {
    if (e.type === 'plan') {
      const p = e.plan || {};
      runs.set(e.runId, {
        runId: e.runId,
        project: e.project,
        projectDir: e.projectDir,
        feature: e.feature,
        agent: e.agent,
        createdAt: e.ts,
        updatedAt: e.ts,
        workBranch: p.workBranch,
        baseDir: p.baseDir,
        waves: p.waves || [],
        lanes: (p.lanes || []).map((fx) => ({
          id: fx.id,
          branch: fx.branch,
          worktree: fx.worktree,
          state: 'waiting',
          attempt: 0,
          tasks: (fx.tasks || []).map((t) => ({ ...t, state: 'pending', stream: null })),
        })),
        sequential: (p.sequential || []).map((t) => ({ ...t, state: 'pending', stream: null })),
        gate: { verify: null, audit: null },
        gateStale: false,
        end: null,
        lastScope: null,
        summary: null,
      });
      continue;
    }
    const run = runs.get(e.runId);
    if (!run) continue; // run event whose plan was pruned
    run.updatedAt = e.ts;

    if (e.type === 'lane') {
      const fx = run.lanes.find((f) => f.id === e.lane);
      if (fx) {
        fx.state = e.state;
        if (e.attempt) fx.attempt = e.attempt;
        // a new attempt reopens the lane's tasks
        if (e.state === 'running') {
          for (const t of fx.tasks) if (t.state !== 'done') t.state = 'pending';
        }
      }
    } else if (e.type === 'task') {
      const all = [...run.lanes.flatMap((f) => f.tasks), ...run.sequential];
      const t = all.find((x) => x.id === e.task);
      if (t) {
        t.state = e.state;
        if (e.stream) t.stream = e.stream;
      }
    } else if (e.type === 'gate') {
      if (e.step === 'start') run.gate = { verify: null, audit: null };
      if (e.step === 'verify' || e.step === 'audit') run.gate[e.step] = e.exit;
      // a new audit = a fresh verdict
      if (e.step === 'audit') run.gateStale = false;
    } else if (e.type === 'end') {
      run.end = e.exit;
      run.lastScope = e.scope || 'all';
    } else if (e.type === 'summary') {
      // keep only the most recent: it is the text `onp-spec summary` returns
      if (typeof e.text === 'string' && e.text.trim()) {
        run.summary = { text: e.text, source: e.source === 'ai' ? 'ai' : 'engine', ts: e.ts };
      }
    } else if (e.type === 'start') {
      run.end = null;
      run.lastScope = e.scope || 'all';
      // any new work invalidates the previous verdict until audit runs
      run.gateStale = run.gate.audit !== null;
      if (!e.scope || e.scope === 'all') {
        run.gate = { verify: null, audit: null };
        run.gateStale = false;
      }
    }
  }

  let list = [...runs.values()];
  if (projectDir) list = list.filter((run) => path.resolve(run.projectDir || '') === path.resolve(projectDir));
  if (feature) list = list.filter((run) => run.feature === feature);

  // a run is "running" if any lane/task is in progress
  for (const run of list) {
    const inProgress =
      run.lanes.some((f) => f.state === 'running' || f.state === 'merging') ||
      [...run.lanes.flatMap((f) => f.tasks), ...run.sequential].some((t) => t.state === 'running');
    run.running = inProgress && run.end === null;
    const tasks = [...run.lanes.flatMap((f) => f.tasks), ...run.sequential];
    run.total = tasks.length;
    run.done = tasks.filter((t) => t.state === 'done').length;
    run.failures = run.lanes.filter((f) => f.state === 'failed' || f.state === 'conflict').length;
  }

  // projects, most recent first
  const projects = new Map();
  for (const run of list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))) {
    const key = run.projectDir || run.project;
    if (!projects.has(key)) {
      projects.set(key, { project: run.project, projectDir: run.projectDir, runs: [] });
    }
    projects.get(key).runs.push(run);
  }
  return [...projects.values()];
}

// ── pruning: the ledger is single and append-only; it cannot grow forever ──

export function pruneLedger(maxRuns = MAX_RUNS) {
  const { ledger, streams } = paths();
  if (!existsSync(ledger)) return { removed: [] };
  const events = readEvents();
  const order = [];
  for (const e of events) if (e.type === 'plan' && !order.includes(e.runId)) order.push(e.runId);
  if (order.length <= maxRuns) return { removed: [] };

  const remove = new Set(order.slice(0, order.length - maxRuns));
  const kept = events.filter((e) => !remove.has(e.runId));
  writeFileSync(ledger, kept.map((e) => JSON.stringify(e)).join('\n') + (kept.length ? '\n' : ''));
  for (const runId of remove) rmSync(path.join(streams, runId), { recursive: true, force: true });
  return { removed: [...remove] };
}

// ── model stream parser (NDJSON from claude -p) ───────────────────────────

const CLIP = 400;
const clip = (s, n = CLIP) => {
  const t = String(s == null ? '' : s);
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// one-line summary per tool: what matters to see live
export function toolSummary(name, input = {}) {
  const rel = (p) => String(p || '').split('/').slice(-3).join('/');
  switch (name) {
    case 'Bash':
      return clip(input.command, 200);
    case 'Read':
      return rel(input.file_path);
    case 'Write':
      return `${rel(input.file_path)} (${String(input.content || '').split('\n').length} lines)`;
    case 'Edit':
      return `${rel(input.file_path)} — ${clip(String(input.old_string || '').split('\n')[0], 60)}`;
    case 'Glob':
    case 'Grep':
      return clip(input.pattern, 120);
    case 'TodoWrite':
      return `${(input.todos || []).length} item(s)`;
    case 'Task':
      return clip(input.description, 120);
    case 'WebFetch':
    case 'WebSearch':
      return clip(input.url || input.query, 120);
    default: {
      const keys = Object.keys(input);
      if (!keys.length) return '';
      return clip(`${keys[0]}: ${JSON.stringify(input[keys[0]])}`, 160);
    }
  }
}

// one-line summary per codex item (`codex exec --json`): returns
// {name, summary} for tool-like items, or null for those with their own
// handling (message, reasoning, end)
export function codexItemSummary(item = {}) {
  switch (item.type) {
    case 'command_execution':
      return { name: 'Bash', summary: clip(item.command, 200) };
    case 'file_change': {
      const changes = (item.changes || []).map((c) => `${c.kind || '?'} ${String(c.path || '').split('/').slice(-3).join('/')}`);
      return { name: 'Edit', summary: clip(changes.join(', '), 200) };
    }
    case 'mcp_tool_call':
      return { name: [item.server, item.tool].filter(Boolean).join('.') || 'MCP', summary: '' };
    case 'web_search':
      return { name: 'WebSearch', summary: clip(item.query, 120) };
    case 'todo_list':
      return { name: 'Plan', summary: `${(item.items || []).length} item(s)` };
    default:
      return null;
  }
}

// one-line summary per Cursor CLI tool_call (`agent -p
// --output-format stream-json`): the body comes in `tool_call.<name>ToolCall`
// with `args` and, on completed, `result` (a `success` key = it worked; any
// other = error). Returns {name, summary, error, hasResult, output} or null
// when the shape is not recognized.
const CURSOR_TOOL_NAMES = {
  shell: 'Bash',
  terminal: 'Bash',
  bash: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  delete: 'Delete',
  ls: 'Ls',
  glob: 'Glob',
  grep: 'Grep',
  search: 'Grep',
  fetch: 'WebFetch',
  webfetch: 'WebFetch',
  websearch: 'WebSearch',
  mcp: 'MCP',
  todo: 'Plan',
};

export function cursorToolCallSummary(toolCall = {}) {
  const key = Object.keys(toolCall).find((k) => k.endsWith('ToolCall'));
  if (!key) return null;
  const body = toolCall[key] || {};
  const args = body.args || {};
  const base = key.slice(0, -'ToolCall'.length);
  const name =
    CURSOR_TOOL_NAMES[base.toLowerCase()] || (base ? base[0].toUpperCase() + base.slice(1) : 'Tool');
  const rel = (p) => String(p || '').split('/').slice(-3).join('/');
  const str = (v) => (typeof v === 'string' && v ? v : null);
  // order: what matters to see live — command > pattern/query > path
  // (in a grep with pattern AND path, hiding the pattern would hide the search)
  let summary = '';
  const command = str(args.command);
  const search = str(args.pattern) ?? str(args.query) ?? str(args.url);
  const filePath = str(args.path) ?? str(args.file_path);
  if (command) summary = clip(command, 200);
  else if (search) summary = clip(search, 120);
  else if (filePath) summary = rel(filePath);
  else {
    const keys = Object.keys(args);
    if (keys.length) summary = clip(`${keys[0]}: ${JSON.stringify(args[keys[0]])}`, 160);
  }
  const result = body.result;
  const hasResult = result != null && typeof result === 'object';
  const error = hasResult && !('success' in result);
  // readable output when the result carries text (the shape varies per tool)
  let output = null;
  if (hasResult) {
    const owner = error ? Object.values(result)[0] : result.success;
    if (typeof owner === 'string') output = owner;
    else if (owner && typeof owner === 'object') {
      const text = owner.output ?? owner.stdout ?? owner.content ?? owner.message ?? null;
      if (typeof text === 'string') output = text;
      else if (error) output = clip(JSON.stringify(owner), 300);
    }
  }
  return { name, summary, error, hasResult, output };
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'string' ? c : c && c.type === 'text' ? c.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

// Turns the raw NDJSON into a timeline. `since` = lines already read
// (incremental read); also returns the total for the next request.
export function summarizeStream(text, { since = 0 } = {}) {
  const lines = String(text || '').split('\n').filter((l) => l.trim());
  const fresh = lines.slice(since);
  const items = [];
  let summary = null;
  let thinking = null;
  let codexTurns = 0;

  for (const line of fresh) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      items.push({ type: 'raw', text: clip(line, 300) });
      continue;
    }
    if (e.type === 'system' && e.subtype === 'init') {
      items.push({ type: 'start', model: e.model, session: String(e.session_id || '').slice(0, 8) });
    } else if (e.type === 'system' && e.subtype === 'thinking_tokens') {
      // aggregate: a single growing "thinking" item, instead of dozens of lines
      if (thinking) thinking.tokens = e.estimated_tokens;
      else {
        thinking = { type: 'thinking', tokens: e.estimated_tokens, text: '' };
        items.push(thinking);
      }
    } else if (e.type === 'assistant' && e.message) {
      for (const c of e.message.content || []) {
        if (c.type === 'tool_use') {
          thinking = null;
          items.push({
            type: 'tool',
            name: c.name,
            summary: toolSummary(c.name, c.input || {}),
            detail: clip(JSON.stringify(c.input || {}, null, 2), 1200),
          });
        } else if (c.type === 'thinking') {
          const t = String(c.thinking || '');
          if (t.trim()) {
            // text available (not always: in headless it usually comes redacted)
            if (thinking) thinking.text = clip(t, 1200);
            else items.push({ type: 'thinking', tokens: null, text: clip(t, 1200) });
          }
        } else if (c.type === 'text' && String(c.text || '').trim()) {
          thinking = null;
          items.push({ type: 'text', text: clip(c.text, 1200) });
        }
      }
    } else if (e.type === 'user' && e.message) {
      for (const c of e.message.content || []) {
        if (c.type === 'tool_result') {
          thinking = null;
          items.push({
            type: 'output',
            error: Boolean(c.is_error),
            text: clip(contentText(c.content), 600),
          });
        }
      }
    } else if (e.type === 'result') {
      thinking = null;
      summary = {
        status: e.is_error ? 'error' : e.subtype === 'success' ? 'success' : String(e.subtype || ''),
        durationMs: e.duration_ms ?? null,
        turns: e.num_turns ?? null,
        costUsd: e.total_cost_usd ?? null,
        outputTokens: e.usage?.output_tokens ?? null,
        inputTokens: e.usage?.input_tokens ?? null,
      };
      items.push({ type: 'end', ...summary, text: clip(e.result, 600) });
    } else if (e.type === 'tool_call' && e.subtype === 'completed' && e.tool_call) {
      // Cursor CLI: the tool arrives as tool_call (started/completed);
      // only completed enters the timeline — started would be a duplicate
      const tool = cursorToolCallSummary(e.tool_call);
      if (tool) {
        thinking = null;
        items.push({
          type: 'tool',
          name: tool.name,
          summary: tool.summary,
          detail: clip(JSON.stringify(e.tool_call, null, 2), 1200),
        });
        // like codex, call and result arrive together — the parser splits them
        // so the timeline looks like claude's (tool + output)
        if (tool.output != null || tool.error) {
          items.push({ type: 'output', error: tool.error, text: clip(tool.output ?? '', 600) });
        }
      }
    } else if (e.type === 'thread.started') {
      // codex exec --json: start of the session
      items.push({ type: 'start', model: e.model || null, session: String(e.thread_id || '').slice(0, 8) });
    } else if (e.type === 'item.completed' && e.item) {
      const item = e.item;
      if (item.type === 'reasoning') {
        const t = String(item.text || '');
        if (t.trim()) {
          if (thinking) thinking.text = clip(t, 1200);
          else {
            thinking = { type: 'thinking', tokens: null, text: clip(t, 1200) };
            items.push(thinking);
          }
        }
      } else if (item.type === 'agent_message') {
        thinking = null;
        if (String(item.text || '').trim()) items.push({ type: 'text', text: clip(item.text, 1200) });
      } else if (item.type === 'error') {
        thinking = null;
        items.push({ type: 'output', error: true, text: clip(item.message, 600) });
      } else {
        const tool = codexItemSummary(item);
        if (tool) {
          thinking = null;
          items.push({
            type: 'tool',
            name: tool.name,
            summary: tool.summary,
            detail: clip(JSON.stringify(item, null, 2), 1200),
          });
          // in codex, command and output arrive in the SAME item — the parser
          // splits them so the timeline looks like claude's (tool + output)
          if (item.type === 'command_execution' && item.aggregated_output != null) {
            items.push({
              type: 'output',
              error: item.exit_code != null && item.exit_code !== 0,
              text: clip(item.aggregated_output, 600),
            });
          }
        }
      }
    } else if (e.type === 'turn.completed' || e.type === 'turn.failed') {
      thinking = null;
      codexTurns += 1;
      summary = {
        status: e.type === 'turn.failed' ? 'error' : 'success',
        durationMs: null,
        turns: codexTurns,
        costUsd: null,
        outputTokens: e.usage?.output_tokens ?? null,
        inputTokens: e.usage?.input_tokens ?? null,
      };
      items.push({ type: 'end', ...summary, text: clip(e.error?.message || '', 600) });
    } else if (e.type === 'error') {
      thinking = null;
      // cursor/codex carry `message`
      const msg =
        e.message ??
        (e.error && (e.error.message || e.error.name)) ??
        (e.error ? JSON.stringify(e.error) : '');
      items.push({ type: 'output', error: true, text: clip(msg, 600) });
    }
  }

  return { items, total: lines.length, summary };
}

export function readStream(runId, key, { since = 0 } = {}) {
  const p = streamPath(runId, key);
  if (!existsSync(p)) return { items: [], total: 0, summary: null, exists: false };
  return { ...summarizeStream(readFileSync(p, 'utf-8'), { since }), exists: true };
}

// recorded streams of a run (diagnostics, even without an event)
export function runStreams(runId) {
  const dir = path.join(paths().streams, runId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ key: f.replace(/\.jsonl$/, ''), mtime: statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}
