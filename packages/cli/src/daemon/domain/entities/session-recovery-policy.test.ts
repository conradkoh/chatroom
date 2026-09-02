import { describe, expect, test } from 'vitest';

import {
  DEFAULT_CRASH_RECOVERY_POLICY,
  resolveSessionRecoveryPolicy,
} from './session-recovery-policy.js';

describe('resolveSessionRecoveryPolicy', () => {
  const noFailure = {
    hadSessionFailure: false,
    failureKind: 'none' as const,
    recoverable: true,
  };

  const sessionFailure = {
    hadSessionFailure: true,
    failureKind: 'run_error' as const,
    recoverable: true,
  };

  test('returns default policy when no session failure', () => {
    expect(resolveSessionRecoveryPolicy('opencode', noFailure)).toEqual(
      DEFAULT_CRASH_RECOVERY_POLICY
    );
    expect(resolveSessionRecoveryPolicy('cursor-sdk', noFailure)).toEqual(
      DEFAULT_CRASH_RECOVERY_POLICY
    );
  });

  test('returns cursor-sdk session failure policy when monitor reports failure', () => {
    const policy = resolveSessionRecoveryPolicy('cursor-sdk', sessionFailure);
    expect(policy.maxAttempts).toBe(6);
    expect(policy.intervalMs).toBe(10_000);
    expect(policy.resumeFirstAttempts).toBe(3);
    expect(policy.recoveryReason).toBe('platform.cursor_sdk_session_reopen');
  });

  test('returns default for non-cursor harness even with session failure classification', () => {
    expect(resolveSessionRecoveryPolicy('opencode-sdk', sessionFailure)).toEqual(
      DEFAULT_CRASH_RECOVERY_POLICY
    );
  });
});
