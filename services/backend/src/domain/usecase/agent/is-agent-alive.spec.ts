import { describe, expect, test } from 'vitest';

import { isAgentAlive } from './is-agent-alive';

describe('isAgentAlive', () => {
  test('returns false for null', () => {
    expect(isAgentAlive(null)).toBe(false);
  });

  test('returns false for undefined', () => {
    expect(isAgentAlive(undefined)).toBe(false);
  });

  test('returns true for PID 0 (valid process)', () => {
    expect(isAgentAlive(0)).toBe(true);
  });

  test('returns true for a positive PID', () => {
    expect(isAgentAlive(12345)).toBe(true);
  });
});
