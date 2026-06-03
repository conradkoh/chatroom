import { describe, expect, it } from 'vitest';

import {
  shouldPreserveHarnessTeardown,
  shouldRetainHarnessSessionForReconnect,
} from './preserve-session.js';

describe('shouldRetainHarnessSessionForReconnect', () => {
  it('retains for user.stop and automated process outcomes', () => {
    expect(shouldRetainHarnessSessionForReconnect('user.stop')).toBe(true);
    expect(shouldRetainHarnessSessionForReconnect('agent_process.exited_clean')).toBe(true);
    expect(shouldRetainHarnessSessionForReconnect('agent_process.signal')).toBe(true);
    expect(shouldRetainHarnessSessionForReconnect('agent_process.crashed')).toBe(true);
  });

  it('clears for intentional platform/daemon stops', () => {
    expect(shouldRetainHarnessSessionForReconnect('platform.team_switch')).toBe(false);
    expect(shouldRetainHarnessSessionForReconnect('daemon.shutdown')).toBe(false);
    expect(shouldRetainHarnessSessionForReconnect('daemon.respawn')).toBe(false);
    expect(shouldRetainHarnessSessionForReconnect('platform.dedup')).toBe(false);
  });
});

describe('shouldPreserveHarnessTeardown', () => {
  it('requires session id and resumable harness', () => {
    expect(shouldPreserveHarnessTeardown('user.stop', true, true)).toBe(true);
    expect(shouldPreserveHarnessTeardown('user.stop', false, true)).toBe(false);
    expect(shouldPreserveHarnessTeardown('user.stop', true, false)).toBe(false);
    expect(shouldPreserveHarnessTeardown('daemon.shutdown', true, true)).toBe(false);
  });
});
