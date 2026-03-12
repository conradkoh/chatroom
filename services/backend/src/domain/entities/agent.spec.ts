import { describe, expect, test } from 'vitest';
import { AGENT_START_REASONS } from './agent';

describe('agent entity', () => {
  test('AGENT_START_REASONS includes "platform.crash_recovery"', () => {
    expect(AGENT_START_REASONS).toContain('platform.crash_recovery');
  });
});
