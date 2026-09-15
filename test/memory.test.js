// The agent memory/instructions file — the always-loaded reminder that this
// project is spec-anchored. Guards the file map per agent and the full-flow
// content the renderer produces.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEMORY_FILE_BY_AGENT, renderAgentMemory } from '../src/core/memory.js';
import { AGENTS } from '../src/core/plan.js';

test('every supported agent maps to its native memory file', () => {
  for (const agent of AGENTS) {
    assert.ok(MEMORY_FILE_BY_AGENT[agent], `agent ${agent} has no memory file mapping`);
  }
  assert.equal(MEMORY_FILE_BY_AGENT.claude, 'CLAUDE.md');
  assert.equal(MEMORY_FILE_BY_AGENT.gemini, 'GEMINI.md');
  assert.equal(MEMORY_FILE_BY_AGENT.copilot, '.github/copilot-instructions.md');
  // codex, cursor and antigravity share the AGENTS.md convention
  assert.equal(MEMORY_FILE_BY_AGENT.codex, 'AGENTS.md');
  assert.equal(MEMORY_FILE_BY_AGENT.cursor, 'AGENTS.md');
  assert.equal(MEMORY_FILE_BY_AGENT.antigravity, 'AGENTS.md');
});

test('renderAgentMemory brings the full flow, the contract and the golden rule', () => {
  const md = renderAgentMemory('gemini', {
    label: 'Gemini',
    enginePath: '.gemini/skills/onp-spec-driven/scripts/onp-spec.mjs',
  });
  // the engine invocation is copy-paste ready with the project-relative path
  assert.match(md, /node \.gemini\/skills\/onp-spec-driven\/scripts\/onp-spec\.mjs/);
  // the full flow is present
  assert.match(md, /SPECIFY → DESIGN → TASKS → PLAN → EXECUTE → VERIFY → AUDIT → LEARN/);
  // the anti-fraud rules of the contract are sacred
  assert.match(md, /Never weaken, skip or delete a test/);
  assert.match(md, /skipped[\s\S]*is not proof/i);
  assert.match(md, /WEAK PROOF \(manual audit\)/);
  // the golden rule (audit --ci is the gate)
  assert.match(md, /audit --ci/);
  assert.match(md, /If it didn't exit 0, it's not done/);
  // the agent label shows up
  assert.match(md, /Gemini/);
  // the artifacts must be authored in English, regardless of the chat language
  assert.match(md, /in English/);
});

test('renderAgentMemory works without an explicit label', () => {
  const md = renderAgentMemory('claude', {
    enginePath: '.claude/skills/onp-spec-driven/scripts/onp-spec.mjs',
  });
  assert.match(md, /spec-anchored development/i);
  assert.doesNotMatch(md, /This file targets \*\*undefined\*\*/);
});
