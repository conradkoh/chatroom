import { describe, expect, test } from 'vitest';

import { isAgentWorking } from './useAgentStatuses';

describe('isAgentWorking', () => {
  test('task.acknowledged is not working (TASK RECEIVED = green)', () => {
    expect(isAgentWorking('task.acknowledged', true)).toBe(false);
  });

  test('task.inProgress is working', () => {
    expect(isAgentWorking('task.inProgress', true)).toBe(true);
  });

  test('task.completed is working', () => {
    expect(isAgentWorking('task.completed', true)).toBe(true);
  });

  test('agent.waiting is not working', () => {
    expect(isAgentWorking('agent.waiting', true)).toBe(false);
  });

  test('offline agent is never working', () => {
    expect(isAgentWorking('task.inProgress', false)).toBe(false);
    expect(isAgentWorking('task.acknowledged', false)).toBe(false);
  });
});
