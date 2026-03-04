import { describe, it, expect } from 'vitest';
import { resolveStopReason } from './stop-reason';

describe('resolveStopReason', () => {
  describe('intentional stops', () => {
    it('returns intentional_stop when wasIntentional=true (regardless of exit code)', () => {
      expect(resolveStopReason(0, null, true)).toBe('intentional_stop');
      expect(resolveStopReason(1, null, true)).toBe('intentional_stop');
      expect(resolveStopReason(null, null, true)).toBe('intentional_stop');
    });

    it('returns intentional_stop when wasIntentional=true (regardless of signal)', () => {
      expect(resolveStopReason(0, 'SIGTERM', true)).toBe('intentional_stop');
      expect(resolveStopReason(1, 'SIGKILL', true)).toBe('intentional_stop');
      expect(resolveStopReason(null, 'SIGINT', true)).toBe('intentional_stop');
    });
  });

  describe('signal terminations', () => {
    it('returns process_terminated_with_signal for SIGTERM exit', () => {
      expect(resolveStopReason(null, 'SIGTERM', false)).toBe('process_terminated_with_signal');
    });

    it('returns process_terminated_with_signal for SIGKILL exit', () => {
      expect(resolveStopReason(null, 'SIGKILL', false)).toBe('process_terminated_with_signal');
    });

    it('returns process_terminated_with_signal for any signal', () => {
      expect(resolveStopReason(null, 'SIGINT', false)).toBe('process_terminated_with_signal');
      expect(resolveStopReason(null, 'SIGHUP', false)).toBe('process_terminated_with_signal');
    });
  });

  describe('clean exits', () => {
    it('returns process_exited_with_success for code 0 without intentional flag', () => {
      expect(resolveStopReason(0, null, false)).toBe('process_exited_with_success');
    });
  });

  describe('unexpected exits', () => {
    it('returns process_terminated_unexpectedly for non-zero exit code', () => {
      expect(resolveStopReason(1, null, false)).toBe('process_terminated_unexpectedly');
      expect(resolveStopReason(127, null, false)).toBe('process_terminated_unexpectedly');
      expect(resolveStopReason(255, null, false)).toBe('process_terminated_unexpectedly');
    });

    it('returns process_terminated_unexpectedly for null code with no signal (SIGKILL from daemon perspective)', () => {
      expect(resolveStopReason(null, null, false)).toBe('process_terminated_unexpectedly');
    });
  });
});
