import { describe, expect, test, vi } from 'vitest';

import { cursorSdkSessionMonitor } from './cursor-sdk-session-monitor.js';

describe('cursorSdkSessionMonitor', () => {
  const baseCtx = {
    harness: 'cursor-sdk' as const,
    recentLogLines: [],
    wantResume: true,
  };

  test('clean logs → no session failure', () => {
    expect(cursorSdkSessionMonitor.classifyExitFailure(baseCtx)).toEqual({
      hadSessionFailure: false,
      failureKind: 'none',
      recoverable: true,
    });
  });

  test('run-error triggers hadSessionFailure with run_error kind', () => {
    expect(
      cursorSdkSessionMonitor.classifyExitFailure({
        ...baseCtx,
        recentLogLines: [
          '[cursor-sdk:planner@c1 run-error] run abc failed: no error detail from SDK',
        ],
      })
    ).toEqual({
      hadSessionFailure: true,
      failureKind: 'run_error',
      recoverable: true,
      requiresTaskReleaseBeforeRecovery: false,
    });
  });

  test('classifies Cursor status auth failure followed by run-error', () => {
    expect(
      cursorSdkSessionMonitor.classifyExitFailure({
        ...baseCtx,
        recentLogLines: [
          '[cursor-sdk:planner@7z81x2 status] RUNNING',
          '[cursor-sdk:planner@7z81x2 status] ERROR: Authentication error If you are logged in, try logging out and back in.',
          '[cursor-sdk:planner@7z81x2 run-error] run run-24d02306 failed: no error detail from SDK',
        ],
      })
    ).toEqual({
      hadSessionFailure: true,
      failureKind: 'auth_error',
      recoverable: true,
      requiresTaskReleaseBeforeRecovery: true,
    });
  });

  test('auth spawn-error triggers auth_error and requires task release', () => {
    expect(
      cursorSdkSessionMonitor.classifyExitFailure({
        ...baseCtx,
        recentLogLines: ['[cursor-sdk:builder@c1 spawn-error] [unauthenticated] Error'],
      })
    ).toEqual({
      hadSessionFailure: true,
      failureKind: 'auth_error',
      recoverable: true,
      requiresTaskReleaseBeforeRecovery: true,
    });
  });

  test('resolveWantResume: resume-first for attempts 1-3 on session failure', () => {
    const classification = {
      hadSessionFailure: true,
      failureKind: 'run_error' as const,
      recoverable: true,
    };
    expect(cursorSdkSessionMonitor.resolveWantResume!(1, classification, baseCtx)).toBe(true);
    expect(cursorSdkSessionMonitor.resolveWantResume!(3, classification, baseCtx)).toBe(true);
    expect(cursorSdkSessionMonitor.resolveWantResume!(4, classification, baseCtx)).toBe(false);
  });

  test('resolveWantResume: uses ctx.wantResume when no session failure', () => {
    const classification = {
      hadSessionFailure: false,
      failureKind: 'none' as const,
      recoverable: true,
    };
    expect(
      cursorSdkSessionMonitor.resolveWantResume!(1, classification, {
        ...baseCtx,
        wantResume: false,
      })
    ).toBe(false);
    expect(
      cursorSdkSessionMonitor.resolveWantResume!(1, classification, {
        ...baseCtx,
        wantResume: true,
      })
    ).toBe(true);
  });

  test('logs session failure message', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    cursorSdkSessionMonitor.classifyExitFailure({
      ...baseCtx,
      recentLogLines: ['[cursor-sdk:planner@c1 run-error] run abc failed: timeout'],
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[CursorSdkSessionMonitor] session failure detected:')
    );
    logSpy.mockRestore();
  });
});
