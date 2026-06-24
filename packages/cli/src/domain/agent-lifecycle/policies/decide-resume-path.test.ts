import { describe, expect, it } from 'vitest';

import {
  decideResumePathOnRestart,
  resumePathAfterTurnCompleted,
  shouldAutoRestartAfterProcessExit,
} from './decide-resume-path.js';

describe('decideResumePathOnRestart', () => {
  it('uses daemon_memory when wantResume and snapshot exist', () => {
    expect(
      decideResumePathOnRestart({
        supportsDaemonMemoryResume: true,
        wantResume: true,
        hasStoredSnapshot: true,
      })
    ).toBe('daemon_memory');
  });

  it('falls back to cold spawn without snapshot or wantResume', () => {
    expect(
      decideResumePathOnRestart({
        supportsDaemonMemoryResume: true,
        wantResume: true,
        hasStoredSnapshot: false,
      })
    ).toBe('cold');
    expect(
      decideResumePathOnRestart({
        supportsDaemonMemoryResume: true,
        wantResume: false,
        hasStoredSnapshot: true,
      })
    ).toBe('cold');
    expect(
      decideResumePathOnRestart({
        supportsDaemonMemoryResume: false,
        wantResume: true,
        hasStoredSnapshot: true,
      })
    ).toBe('cold');
  });
});

describe('shouldAutoRestartAfterProcessExit', () => {
  it('restarts on process outcomes', () => {
    expect(shouldAutoRestartAfterProcessExit('agent_process.crashed')).toBe(true);
    expect(shouldAutoRestartAfterProcessExit('agent_process.exited_clean')).toBe(true);
  });

  it('does not restart on intentional stops', () => {
    expect(shouldAutoRestartAfterProcessExit('user.stop')).toBe(false);
    expect(shouldAutoRestartAfterProcessExit('daemon.shutdown')).toBe(false);
    expect(shouldAutoRestartAfterProcessExit('daemon.respawn')).toBe(false);
    expect(shouldAutoRestartAfterProcessExit('platform.resume_storm')).toBe(false);
  });
});

describe('resumePathAfterTurnCompleted', () => {
  it('returns in_process only when resumable AND wantResume', () => {
    expect(resumePathAfterTurnCompleted(true, true)).toBe('in_process');
    expect(resumePathAfterTurnCompleted(true, false)).toBe('none');
    expect(resumePathAfterTurnCompleted(false, true)).toBe('none');
    expect(resumePathAfterTurnCompleted(false, false)).toBe('none');
  });
});
