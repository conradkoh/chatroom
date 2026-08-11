/**
 * Regression: session augmentation applies only to planner and builder roles.
 *
 * Current behavior: planner and builder always get new_session per task delivery.
 * Other roles (enhancer, reviewer, solo) always get none.
 */

import { describe, expect, test } from 'vitest';

import {
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

const PLANNER_DELEGATION_WITH_NONE = `## Goal
Follow-up fix
## Session Augmentation
// data:agent.session_augmentation=none`;

describe('regression: duo roles and builder always-new-session enforcement', () => {
  test('planner user-task ack resolves to new_session', () => {
    expect(resolveSessionAugmentationForRole(USER_TASK_ACK, 'planner')).toBe('new_session');
    expect(
      sessionAugmentationNewSessionStarted(
        resolveSessionAugmentationForRole(USER_TASK_ACK, 'planner')
      )
    ).toBe(true);
    expect(
      sessionAugmentationToWantResume(resolveSessionAugmentationForRole(USER_TASK_ACK, 'planner'))
    ).toBe(false);
  });

  test('planner handback resolves to new_session even with explicit tag', () => {
    expect(resolveSessionAugmentationForRole(BUILDER_HANDBACK_TO_PLANNER, 'planner')).toBe(
      'new_session'
    );
    expect(resolveSessionAugmentationForRole(PLANNER_DELEGATION_WITH_NONE, 'planner')).toBe(
      'new_session'
    );
  });

  test('builder delegation always resolves to new_session even with explicit none tag', () => {
    expect(resolveSessionAugmentationForRole(PLANNER_DELEGATION_WITH_NONE, 'builder')).toBe(
      'new_session'
    );
    expect(
      sessionAugmentationNewSessionStarted(
        resolveSessionAugmentationForRole(PLANNER_DELEGATION_WITH_NONE, 'builder')
      )
    ).toBe(true);
    expect(
      sessionAugmentationToWantResume(
        resolveSessionAugmentationForRole(PLANNER_DELEGATION_WITH_NONE, 'builder')
      )
    ).toBe(false);
  });

  test('builder delegation without section defaults to new_session', () => {
    expect(resolveSessionAugmentationForRole(PLANNER_DELEGATION_NO_SECTION, 'builder')).toBe(
      'new_session'
    );
  });

  test('other non-augmentable roles resolve to none', () => {
    for (const role of ['architect', 'enhancer', 'solo', 'reviewer']) {
      expect(resolveSessionAugmentationForRole(PLANNER_DELEGATION_NO_SECTION, role)).toBe('none');
    }
  });
});
