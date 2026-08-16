/**
 * Regression: session augmentation must not apply to non-builder roles.
 *
 * Current behavior: builder always gets new_session per delegation.
 * Non-builder roles (planner, enhancer, reviewer, solo) always get none.
 */

import { describe, expect, test } from 'vitest';

import {
  resolveSessionAugmentationForTask,
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
  test('planner user-task ack resolves to none (no new session)', () => {
    expect(
      resolveSessionAugmentationForTask(
        { content: USER_TASK_ACK, startInNewSession: undefined },
        'planner'
      )
    ).toBe('none');
    expect(
      sessionAugmentationNewSessionStarted(
        resolveSessionAugmentationForTask(
          { content: USER_TASK_ACK, startInNewSession: undefined },
          'planner'
        )
      )
    ).toBe(false);
    expect(
      sessionAugmentationToWantResume(
        resolveSessionAugmentationForTask(
          { content: USER_TASK_ACK, startInNewSession: undefined },
          'planner'
        )
      )
    ).toBe(true);
  });

  test('planner builder handback resolves to none even with explicit tag', () => {
    expect(
      resolveSessionAugmentationForTask(
        { content: BUILDER_HANDBACK_TO_PLANNER, startInNewSession: undefined },
        'planner'
      )
    ).toBe('none');
    expect(
      resolveSessionAugmentationForTask(
        { content: PLANNER_DELEGATION_WITH_NONE, startInNewSession: undefined },
        'planner'
      )
    ).toBe('none');
  });

  test('builder delegation always resolves to new_session even with explicit none tag', () => {
    expect(
      resolveSessionAugmentationForTask(
        { content: PLANNER_DELEGATION_WITH_NONE, startInNewSession: undefined },
        'builder'
      )
    ).toBe('new_session');
    expect(
      sessionAugmentationNewSessionStarted(
        resolveSessionAugmentationForTask(
          { content: PLANNER_DELEGATION_WITH_NONE, startInNewSession: undefined },
          'builder'
        )
      )
    ).toBe(true);
    expect(
      sessionAugmentationToWantResume(
        resolveSessionAugmentationForTask(
          { content: PLANNER_DELEGATION_WITH_NONE, startInNewSession: undefined },
          'builder'
        )
      )
    ).toBe(false);
  });

  test('builder delegation without section defaults to new_session', () => {
    expect(
      resolveSessionAugmentationForTask(
        { content: PLANNER_DELEGATION_NO_SECTION, startInNewSession: undefined },
        'builder'
      )
    ).toBe('new_session');
  });

  test('other non-augmentable roles resolve to none', () => {
    for (const role of ['architect', 'solo', 'reviewer']) {
      expect(
        resolveSessionAugmentationForTask(
          { content: PLANNER_DELEGATION_NO_SECTION, startInNewSession: undefined },
          role
        )
      ).toBe('none');
    }
  });
});
