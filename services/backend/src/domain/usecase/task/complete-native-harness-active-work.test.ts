import { describe, expect, test } from 'vitest';

import { isNativeHarness } from '../../entities/harness/types';

describe('shouldSkipNativeHandoffPendingCompletion logic', () => {
  function shouldSkip(lastStatus: string | undefined, harness: string | undefined): boolean {
    return lastStatus === 'task.completed' && isNativeHarness(harness);
  }

  test('skips when native harness awaits handoff after task.completed', () => {
    expect(shouldSkip('task.completed', 'cursor-sdk')).toBe(true);
  });

  test('does not skip for CLI harness', () => {
    expect(shouldSkip('task.completed', 'opencode')).toBe(false);
  });

  test('does not skip when agent is not awaiting handoff', () => {
    expect(shouldSkip('agent.waiting', 'cursor-sdk')).toBe(false);
  });
});
