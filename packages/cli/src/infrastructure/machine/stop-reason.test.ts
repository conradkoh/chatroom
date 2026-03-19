import { describe, it, expect } from 'vitest';

import { resolveStopReason } from './stop-reason';

describe('resolveStopReason', () => {
  describe('intentional stops', () => {
    it('returns user.stop when wasIntentional=true (regardless of exit code)', () => {
      expect(resolveStopReason(0, null, true)).toBe('user.stop');
      expect(resolveStopReason(1, null, true)).toBe('user.stop');
      expect(resolveStopReason(null, null, true)).toBe('user.stop');
    });

    it('returns user.stop when wasIntentional=true (regardless of signal)', () => {
      expect(resolveStopReason(0, 'SIGTERM', true)).toBe('user.stop');
      expect(resolveStopReason(1, 'SIGKILL', true)).toBe('user.stop');
      expect(resolveStopReason(null, 'SIGINT', true)).toBe('user.stop');
    });
  });

  describe('signal terminations', () => {
    it('returns agent_process.signal for SIGTERM exit', () => {
      expect(resolveStopReason(null, 'SIGTERM', false)).toBe('agent_process.signal');
    });

    it('returns agent_process.signal for SIGKILL exit', () => {
      expect(resolveStopReason(null, 'SIGKILL', false)).toBe('agent_process.signal');
    });

    it('returns agent_process.signal for any signal', () => {
      expect(resolveStopReason(null, 'SIGINT', false)).toBe('agent_process.signal');
      expect(resolveStopReason(null, 'SIGHUP', false)).toBe('agent_process.signal');
    });
  });

  describe('clean exits', () => {
    it('returns agent_process.exited_clean for code 0 without intentional flag', () => {
      expect(resolveStopReason(0, null, false)).toBe('agent_process.exited_clean');
    });
  });

  describe('unexpected exits', () => {
    it('returns agent_process.crashed for non-zero exit code', () => {
      expect(resolveStopReason(1, null, false)).toBe('agent_process.crashed');
      expect(resolveStopReason(127, null, false)).toBe('agent_process.crashed');
      expect(resolveStopReason(255, null, false)).toBe('agent_process.crashed');
    });

    it('returns agent_process.crashed for null code with no signal (SIGKILL from daemon perspective)', () => {
      expect(resolveStopReason(null, null, false)).toBe('agent_process.crashed');
    });
  });
});
