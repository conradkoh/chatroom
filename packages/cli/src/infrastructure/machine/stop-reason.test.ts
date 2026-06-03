import { describe, it, expect } from 'vitest';

import { resolveStopReason, shouldRetainHarnessSessionForReconnect } from './stop-reason';

describe('resolveStopReason', () => {
  describe('signal terminations', () => {
    it('returns agent_process.signal for SIGTERM exit', () => {
      expect(resolveStopReason(null, 'SIGTERM')).toBe('agent_process.signal');
    });

    it('returns agent_process.signal for SIGKILL exit', () => {
      expect(resolveStopReason(null, 'SIGKILL')).toBe('agent_process.signal');
    });

    it('returns agent_process.signal for any signal', () => {
      expect(resolveStopReason(null, 'SIGINT')).toBe('agent_process.signal');
      expect(resolveStopReason(null, 'SIGHUP')).toBe('agent_process.signal');
    });
  });

  describe('clean exits', () => {
    it('returns agent_process.exited_clean for code 0', () => {
      expect(resolveStopReason(0, null)).toBe('agent_process.exited_clean');
    });
  });

  describe('unexpected exits', () => {
    it('returns agent_process.crashed for non-zero exit code', () => {
      expect(resolveStopReason(1, null)).toBe('agent_process.crashed');
      expect(resolveStopReason(127, null)).toBe('agent_process.crashed');
      expect(resolveStopReason(255, null)).toBe('agent_process.crashed');
    });

    it('returns agent_process.crashed for null code with no signal', () => {
      expect(resolveStopReason(null, null)).toBe('agent_process.crashed');
    });
  });
});

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
