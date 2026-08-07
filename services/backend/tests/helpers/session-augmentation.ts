/**
 * Session augmentation — shared test helpers.
 *
 * Builder always gets new_session on delegation. Planner / non-augmentable
 * roles get none (continue session).
 */

import { expect } from 'vitest';

import { resolveSessionAugmentationForRole } from '../../src/domain/handoff/parse-session-augmentation';

export const NEW_SESSION_INJECTION_HEADER = 'Starting a new agent session';

/** Task body implies a fresh session for builder delegation. */
export function expectNewSessionFromTaskContent(taskContent: string): void {
  expect(resolveSessionAugmentationForRole(taskContent, 'builder')).toBe('new_session');
}

/** Native injection prompt includes new-session preamble (new_session mode). */
export function assertNativeInjectionNewSessionPreamble(injectionPrompt: string): void {
  expect(injectionPrompt).toContain(NEW_SESSION_INJECTION_HEADER);
  expect(injectionPrompt).toContain('get-system-prompt');
}

/** Native injection prompt shape after daemon reads task content. */
export function assertNativeInjectionCompaction(
  injectionPrompt: string,
  mode: 'new_session' | 'none'
): void {
  if (mode === 'new_session') {
    assertNativeInjectionNewSessionPreamble(injectionPrompt);
  } else {
    expect(injectionPrompt).not.toContain(NEW_SESSION_INJECTION_HEADER);
  }
}
