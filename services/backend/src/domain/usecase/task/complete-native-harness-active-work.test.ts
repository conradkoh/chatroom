import { describe, expect, test } from 'vitest';

import { isNativeHarness } from '../../entities/harness/types';

describe('shouldSkipHandoffPendingTask logic', () => {
  function shouldSkip(args: {
    harness: string | undefined;
    inFlightTaskId: string | undefined;
    pendingTaskId: string;
    inFlightStatus: string | undefined;
  }): boolean {
    if (!isNativeHarness(args.harness)) return false;
    if (!args.inFlightTaskId || args.pendingTaskId === args.inFlightTaskId) return false;
    return args.inFlightStatus === 'completed';
  }

  test('skips when in-flight task completed and pending is a different promoted task', () => {
    expect(
      shouldSkip({
        harness: 'cursor-sdk',
        inFlightTaskId: 'task_a',
        pendingTaskId: 'task_b',
        inFlightStatus: 'completed',
      })
    ).toBe(true);
  });

  test('does not skip when pending is the in-flight task', () => {
    expect(
      shouldSkip({
        harness: 'cursor-sdk',
        inFlightTaskId: 'task_a',
        pendingTaskId: 'task_a',
        inFlightStatus: 'completed',
      })
    ).toBe(false);
  });

  test('does not skip when in-flight task is still active', () => {
    expect(
      shouldSkip({
        harness: 'cursor-sdk',
        inFlightTaskId: 'task_a',
        pendingTaskId: 'task_b',
        inFlightStatus: 'in_progress',
      })
    ).toBe(false);
  });

  test('does not skip for non-native harness', () => {
    expect(
      shouldSkip({
        harness: 'opencode',
        inFlightTaskId: 'task_a',
        pendingTaskId: 'task_b',
        inFlightStatus: 'completed',
      })
    ).toBe(false);
  });
});
