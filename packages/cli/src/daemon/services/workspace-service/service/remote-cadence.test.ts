import { describe, expect, it } from 'vitest';

import {
  isRemoteResultCurrent,
  nextRemotePollDelayMs,
  type RemoteCadenceInput,
} from './remote-cadence.js';
import { DEFAULT_WORKSPACE_SYNC_POLICY } from '../domain/workspace-sync-policy.js';

const NOW = 10_000_000;
const POLICY = DEFAULT_WORKSPACE_SYNC_POLICY.remote;

/** Input that matches no rule above rule 4, so each test overrides only what it exercises. */
function input(overrides: Partial<RemoteCadenceInput> = {}): RemoteCadenceInput {
  return {
    now: NOW,
    lastTriggerAt: null,
    checksState: null,
    consecutiveFailures: 0,
    policy: POLICY,
    ...overrides,
  };
}

describe('nextRemotePollDelayMs', () => {
  describe('rule 4: idle', () => {
    it('returns idleIntervalMs when there is no trigger, no pending checks, and no failures', () => {
      expect(nextRemotePollDelayMs(input())).toBe(POLICY.idleIntervalMs);
    });

    it('treats a trigger exactly hotWindowMs ago as idle', () => {
      const lastTriggerAt = NOW - POLICY.hotWindowMs;
      expect(nextRemotePollDelayMs(input({ lastTriggerAt }))).toBe(POLICY.idleIntervalMs);
    });
  });

  describe('rule 3: hot window', () => {
    it('returns hotIntervalMs for a trigger just inside hotWindowMs', () => {
      const lastTriggerAt = NOW - POLICY.hotWindowMs + 1;
      expect(nextRemotePollDelayMs(input({ lastTriggerAt }))).toBe(POLICY.hotIntervalMs);
    });

    it('returns hotIntervalMs for a trigger at the current instant', () => {
      expect(nextRemotePollDelayMs(input({ lastTriggerAt: NOW }))).toBe(POLICY.hotIntervalMs);
    });
  });

  describe('rule 2: pending checks', () => {
    it('returns pendingChecksIntervalMs when checks are pending', () => {
      expect(nextRemotePollDelayMs(input({ checksState: 'pending' }))).toBe(
        POLICY.pendingChecksIntervalMs
      );
    });

    it('lets pending beat the hot window', () => {
      const result = nextRemotePollDelayMs(input({ checksState: 'pending', lastTriggerAt: NOW }));
      expect(result).toBe(POLICY.pendingChecksIntervalMs);
    });

    it('does not treat a non-pending checks state as pending', () => {
      expect(nextRemotePollDelayMs(input({ checksState: 'success' }))).toBe(POLICY.idleIntervalMs);
    });
  });

  describe('rule 1: failure backoff', () => {
    it('returns hotIntervalMs after the first failure', () => {
      expect(nextRemotePollDelayMs(input({ consecutiveFailures: 1 }))).toBe(POLICY.hotIntervalMs);
    });

    it('lets failures beat pending checks', () => {
      const result = nextRemotePollDelayMs(
        input({ consecutiveFailures: 1, checksState: 'pending' })
      );
      expect(result).toBe(POLICY.hotIntervalMs);
    });

    it('lets failures beat the hot window', () => {
      const result = nextRemotePollDelayMs(input({ consecutiveFailures: 2, lastTriggerAt: NOW }));
      expect(result).toBe(POLICY.hotIntervalMs * 2);
    });

    it('doubles the delay per consecutive failure', () => {
      const delays = [1, 2, 3, 4].map((consecutiveFailures) =>
        nextRemotePollDelayMs(input({ consecutiveFailures }))
      );
      expect(delays).toEqual([
        POLICY.hotIntervalMs,
        POLICY.hotIntervalMs * 2,
        POLICY.hotIntervalMs * 4,
        POLICY.hotIntervalMs * 8,
      ]);
    });

    it('reaches errorBackoffMaxMs at the 7th failure under the default policy and stays there', () => {
      const delays = [1, 2, 3, 4, 5, 6, 7].map((consecutiveFailures) =>
        nextRemotePollDelayMs(input({ consecutiveFailures }))
      );
      expect(delays).toEqual([15_000, 30_000, 60_000, 120_000, 240_000, 480_000, 600_000]);
      expect(nextRemotePollDelayMs(input({ consecutiveFailures: 20 }))).toBe(600_000);
    });

    it('caps the delay at errorBackoffMaxMs', () => {
      const policy = { ...POLICY, errorBackoffMaxMs: 100_000 };
      const delays = [1, 2, 3, 4, 5, 6].map((consecutiveFailures) =>
        nextRemotePollDelayMs(input({ consecutiveFailures, policy }))
      );
      expect(delays).toEqual([15_000, 30_000, 60_000, 100_000, 100_000, 100_000]);
    });
  });

  describe('stale guard (I4)', () => {
    const captured = { branch: 'main', oid: 'abc123' };

    it('is current when branch and oid are equal', () => {
      expect(isRemoteResultCurrent(captured, { branch: 'main', oid: 'abc123' })).toBe(true);
    });

    it('is not current when the branch differs', () => {
      expect(isRemoteResultCurrent(captured, { branch: 'feature', oid: 'abc123' })).toBe(false);
    });

    it('is not current when the oid differs', () => {
      expect(isRemoteResultCurrent(captured, { branch: 'main', oid: 'def456' })).toBe(false);
    });
  });
});
