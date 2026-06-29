/**
 * Session augmentation — shared test helpers.
 *
 * Planner → builder handoffs carry a Session Augmentation section in the
 * delegation brief. The daemon parses `// data:agent.session_augmentation=…`
 * (or legacy `compress_context`) from the task body when injecting native tasks.
 *
 * Default: `new_session` → fresh session for unrelated work.
 */

import { expect } from 'vitest';

import { parseSessionAugmentation } from '../../src/domain/handoff/parse-session-augmentation';

export const COMPACTION_INJECTION_HEADER = 'Context was compacted';
export const NEW_SESSION_INJECTION_HEADER = 'Starting a new agent session';

/** Task body implies a fresh session (default when section omitted). */
export function expectNewSessionFromTaskContent(taskContent: string): void {
  expect(parseSessionAugmentation(taskContent)).toBe('new_session');
}

/** Task body implies continuing the builder's prior in-process context. */
export function expectContinueSessionFromTaskContent(taskContent: string): void {
  expect(parseSessionAugmentation(taskContent)).toBe('none');
}

/** Task body implies in-session context compaction. */
export function expectCompactAugmentation(taskContent: string): void {
  expect(parseSessionAugmentation(taskContent)).toBe('compact');
}

/** Native injection prompt includes compaction preamble (compact mode only). */
export function assertNativeInjectionCompactPreamble(injectionPrompt: string): void {
  expect(injectionPrompt).toContain(COMPACTION_INJECTION_HEADER);
  expect(injectionPrompt).toContain('get-system-prompt');
}

/** Native injection prompt includes new-session preamble (new_session mode). */
export function assertNativeInjectionNewSessionPreamble(injectionPrompt: string): void {
  expect(injectionPrompt).toContain(NEW_SESSION_INJECTION_HEADER);
  expect(injectionPrompt).toContain('get-system-prompt');
  expect(injectionPrompt).not.toContain(COMPACTION_INJECTION_HEADER);
}

/** Native injection prompt shape after daemon reads task content. */
export function assertNativeInjectionCompaction(
  injectionPrompt: string,
  mode: 'compact' | 'new_session' | 'none'
): void {
  if (mode === 'compact') {
    assertNativeInjectionCompactPreamble(injectionPrompt);
  } else if (mode === 'new_session') {
    assertNativeInjectionNewSessionPreamble(injectionPrompt);
  } else {
    expect(injectionPrompt).not.toContain(COMPACTION_INJECTION_HEADER);
    expect(injectionPrompt).not.toContain(NEW_SESSION_INJECTION_HEADER);
  }
}
