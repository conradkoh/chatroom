/**
 * Regression: session augmentation must not apply to non-builder roles.
 *
 * Bug: parseSessionAugmentation defaults to new_session when the handoff body
 * lacks a Session Augmentation section. Planner tasks (user ack, builder handback)
 * never carry that section, so the daemon incorrectly treated them as new_session
 * and emitted agent.sessionAugmented with newSessionStarted=true on planner.
 *
 * Fix: resolveSessionAugmentationForRole gates augmentation to builder only.
 */

import { describe, expect, test } from 'vitest';

import {
  parseSessionAugmentation,
  resolveSessionAugmentationForRole,
  sessionAugmentationNewSessionStarted,
  sessionAugmentationToWantResume,
} from './parse-session-augmentation';

const USER_TASK_ACK = `## Goal
Review and acknowledge the user task below.

## Task
Ship feature A`;

const BUILDER_HANDBACK_TO_PLANNER = `## Summary
Implemented dark mode toggle.

## Changes Made
- Added theme switch component

## Testing
- Manual verification in browser`;

const PLANNER_DELEGATION_NO_SECTION = `## Goal
Add dark mode toggle

## Files to implement
- \`src/theme.ts\``;

const PLANNER_DELEGATION_NEW_SESSION = `## Goal
Add dark mode toggle
## Session Augmentation
// data:agent.session_augmentation=new_session`;

describe('regression: duo planner must not inherit builder augmentation defaults', () => {
  test('parseSessionAugmentation alone would mis-classify planner tasks as new_session', () => {
    expect(parseSessionAugmentation(USER_TASK_ACK)).toBe('new_session');
    expect(parseSessionAugmentation(BUILDER_HANDBACK_TO_PLANNER)).toBe('new_session');
    expect(sessionAugmentationNewSessionStarted(parseSessionAugmentation(USER_TASK_ACK))).toBe(
      true
    );
  });

  test('planner user-task ack resolves to none (no new session)', () => {
    expect(resolveSessionAugmentationForRole(USER_TASK_ACK, 'planner')).toBe('none');
    expect(
      sessionAugmentationNewSessionStarted(
        resolveSessionAugmentationForRole(USER_TASK_ACK, 'planner')
      )
    ).toBe(false);
    expect(
      sessionAugmentationToWantResume(resolveSessionAugmentationForRole(USER_TASK_ACK, 'planner'))
    ).toBe(true);
  });

  test('planner builder handback resolves to none even with explicit new_session tag in body', () => {
    expect(resolveSessionAugmentationForRole(BUILDER_HANDBACK_TO_PLANNER, 'planner')).toBe('none');
    expect(resolveSessionAugmentationForRole(PLANNER_DELEGATION_NEW_SESSION, 'planner')).toBe(
      'none'
    );
    expect(
      sessionAugmentationNewSessionStarted(
        resolveSessionAugmentationForRole(PLANNER_DELEGATION_NEW_SESSION, 'planner')
      )
    ).toBe(false);
  });

  test('builder delegation without section still defaults to new_session', () => {
    expect(resolveSessionAugmentationForRole(PLANNER_DELEGATION_NO_SECTION, 'builder')).toBe(
      'new_session'
    );
    expect(
      sessionAugmentationNewSessionStarted(
        resolveSessionAugmentationForRole(PLANNER_DELEGATION_NO_SECTION, 'builder')
      )
    ).toBe(true);
    expect(
      sessionAugmentationToWantResume(
        resolveSessionAugmentationForRole(PLANNER_DELEGATION_NO_SECTION, 'builder')
      )
    ).toBe(false);
  });

  test('builder explicit new_session tag is preserved', () => {
    expect(resolveSessionAugmentationForRole(PLANNER_DELEGATION_NEW_SESSION, 'builder')).toBe(
      'new_session'
    );
  });

  test('other non-augmentable roles resolve to none', () => {
    for (const role of ['architect', 'solo', 'reviewer']) {
      expect(resolveSessionAugmentationForRole(PLANNER_DELEGATION_NO_SECTION, role)).toBe('none');
    }
  });
});
