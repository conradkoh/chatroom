import { describe, expect, it } from 'vitest';

import { decideRestartAfterExit } from './restart-decision.js';
import type { RestartOutcome } from './restart-decision.js';

function getRestartNow(result: RestartOutcome): Extract<RestartOutcome, { _tag: 'RestartNow' }> {
  if (result._tag !== 'RestartNow') {
    throw new Error(`Expected RestartNow, got ${result._tag}`);
  }
  return result as Extract<RestartOutcome, { _tag: 'RestartNow' }>;
}

function getScheduleRetry(
  result: RestartOutcome
): Extract<RestartOutcome, { _tag: 'ScheduleRetry' }> {
  if (result._tag !== 'ScheduleRetry') {
    throw new Error(`Expected ScheduleRetry, got ${result._tag}`);
  }
  return result as Extract<RestartOutcome, { _tag: 'ScheduleRetry' }>;
}

function getNoRestart(result: RestartOutcome): Extract<RestartOutcome, { _tag: 'NoRestart' }> {
  if (result._tag !== 'NoRestart') {
    throw new Error(`Expected NoRestart, got ${result._tag}`);
  }
  return result as Extract<RestartOutcome, { _tag: 'NoRestart' }>;
}

describe('decideRestartAfterExit', () => {
  it('user.stop → NoRestart', () => {
    const result = decideRestartAfterExit({
      stopReason: 'user.stop',
      harness: 'opencode',
      workingDir: '/tmp/work',
      wantResume: true,
      isPermanentFailure: false,
    });
    expect(getNoRestart(result)._tag).toBe('NoRestart');
  });

  it('crash with harness+wd → RestartNow', () => {
    const result = decideRestartAfterExit({
      stopReason: 'agent_process.crashed',
      harness: 'opencode',
      workingDir: '/tmp/work',
      wantResume: true,
      isPermanentFailure: false,
    });
    const r = getRestartNow(result);
    expect(r._tag).toBe('RestartNow');
    expect(r.spawnReason).toBe('platform.crash_recovery');
    expect(r.wantResume).toBe(true);
  });

  it('permanent failure → NoRestart', () => {
    const result = decideRestartAfterExit({
      stopReason: 'agent_process.crashed',
      harness: 'opencode',
      workingDir: '/tmp/work',
      wantResume: true,
      isPermanentFailure: true,
      permanentFailureMessage: 'Max retries exceeded',
    });
    expect(getNoRestart(result)._tag).toBe('NoRestart');
  });

  it('backoffWaitMs=5000 → ScheduleRetry with waitMs 5000', () => {
    const result = decideRestartAfterExit({
      stopReason: 'agent_process.crashed',
      harness: 'opencode',
      workingDir: '/tmp/work',
      wantResume: true,
      isPermanentFailure: false,
      backoffWaitMs: 5000,
    });
    const r = getScheduleRetry(result);
    expect(r._tag).toBe('ScheduleRetry');
    expect(r.waitMs).toBe(5000);
    expect(r.spawnReason).toBe('platform.crash_recovery');
    expect(r.wantResume).toBe(true);
  });

  it('missing workingDir → NoRestart', () => {
    const result = decideRestartAfterExit({
      stopReason: 'agent_process.crashed',
      harness: 'opencode',
      workingDir: undefined,
      wantResume: true,
      isPermanentFailure: false,
    });
    expect(getNoRestart(result)._tag).toBe('NoRestart');
  });

  it('missing harness → NoRestart', () => {
    const result = decideRestartAfterExit({
      stopReason: 'agent_process.crashed',
      harness: undefined,
      workingDir: '/tmp/work',
      wantResume: true,
      isPermanentFailure: false,
    });
    expect(getNoRestart(result)._tag).toBe('NoRestart');
  });

  it('daemon.shutdown → NoRestart', () => {
    const result = decideRestartAfterExit({
      stopReason: 'daemon.shutdown',
      harness: 'opencode',
      workingDir: '/tmp/work',
      wantResume: true,
      isPermanentFailure: false,
    });
    expect(getNoRestart(result)._tag).toBe('NoRestart');
  });

  it('clean exit with no backoff → RestartNow', () => {
    const result = decideRestartAfterExit({
      stopReason: 'agent_process.exited_clean',
      harness: 'opencode',
      workingDir: '/tmp/work',
      wantResume: false,
      isPermanentFailure: false,
    });
    const r = getRestartNow(result);
    expect(r._tag).toBe('RestartNow');
    expect(r.wantResume).toBe(false);
  });
});
