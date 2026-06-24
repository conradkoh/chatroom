/**
 * Session management (compress_context) — shared test helpers.
 *
 * Planner → builder handoffs carry a Session Management section in the
 * delegation brief. The daemon parses `// data:agent.compress_context=…` from
 * the task body (handoff message content) when injecting native tasks.
 *
 * Default: `new_session` → fresh context for unrelated work.
 */

import { expect } from 'vitest';

import { parseCompressContext } from '../../src/domain/handoff/parse-compress-context';

export const COMPACTION_INJECTION_HEADER = 'Context was compacted';

/** Task body implies a fresh session (default when section omitted). */
export function expectNewSessionFromTaskContent(taskContent: string): void {
  expect(parseCompressContext(taskContent)).toBe('new_session');
}

/** Task body implies continuing the builder's prior in-process context. */
export function expectContinueSessionFromTaskContent(taskContent: string): void {
  expect(parseCompressContext(taskContent)).toBe('none');
}

/** Native injection prompt shape after daemon reads task content. */
export function assertNativeInjectionCompaction(
  injectionPrompt: string,
  mode: 'new_session' | 'none'
): void {
  if (mode === 'new_session') {
    expect(injectionPrompt).toContain(COMPACTION_INJECTION_HEADER);
    expect(injectionPrompt).toContain('get-system-prompt');
  } else {
    expect(injectionPrompt).not.toContain(COMPACTION_INJECTION_HEADER);
  }
}
