import { describe, it, expect } from 'vitest';

import { resolveStopReason } from './stop-reason';

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
