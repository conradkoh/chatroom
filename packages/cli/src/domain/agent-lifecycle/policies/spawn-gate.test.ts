import { describe, expect, it } from 'vitest';

import { shouldBypassConcurrentLimit } from './spawn-gate.js';

describe('shouldBypassConcurrentLimit', () => {
  it('returns true for user.* reasons', () => {
    expect(shouldBypassConcurrentLimit('user.manual_spawn')).toBe(true);
    expect(shouldBypassConcurrentLimit('user.debug_spawn')).toBe(true);
    expect(shouldBypassConcurrentLimit('user.test')).toBe(true);
  });

  it('returns true for platform.crash_recovery', () => {
    expect(shouldBypassConcurrentLimit('platform.crash_recovery')).toBe(true);
  });

  it('returns false for other reasons', () => {
    expect(shouldBypassConcurrentLimit('platform.team_switch')).toBe(false);
    expect(shouldBypassConcurrentLimit('daemon.respawn')).toBe(false);
    expect(shouldBypassConcurrentLimit('some.random.reason')).toBe(false);
  });
});
