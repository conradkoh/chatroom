import { describe, expect, test } from 'vitest';

import { isNativeHarnessSessionDiscardedOnExit } from './native-harness-session-exit.js';

describe('isNativeHarnessSessionDiscardedOnExit', () => {
  test('discards on cursor-sdk run-error logs', () => {
    expect(
      isNativeHarnessSessionDiscardedOnExit({
        harness: 'cursor-sdk',
        harnessSessionId: 'sess_1',
        stopReason: 'agent_process.crashed',
        recentLogLines: [
          '[cursor-sdk:planner@c1 run-error] run abc failed: no error detail from SDK',
        ],
        supportsDaemonMemoryResume: true,
      })
    ).toBe(true);
  });

  test('retains when daemon memory resume is enabled and stop reason allows reconnect', () => {
    expect(
      isNativeHarnessSessionDiscardedOnExit({
        harness: 'cursor-sdk',
        harnessSessionId: 'sess_1',
        stopReason: 'user.stop',
        recentLogLines: [],
        supportsDaemonMemoryResume: true,
      })
    ).toBe(false);
  });

  test('discards when harness does not support daemon memory resume', () => {
    expect(
      isNativeHarnessSessionDiscardedOnExit({
        harness: 'cursor-sdk',
        harnessSessionId: 'sess_1',
        stopReason: 'user.stop',
        recentLogLines: [],
        supportsDaemonMemoryResume: false,
      })
    ).toBe(true);
  });
});
