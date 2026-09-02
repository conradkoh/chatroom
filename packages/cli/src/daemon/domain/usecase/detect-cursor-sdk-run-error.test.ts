import { describe, expect, test } from 'vitest';

import {
  formatCursorSdkRunErrorMessage,
  hasCursorSdkSessionReopenTrigger,
  isCursorSdkAuthErrorInLogs,
  isCursorSdkRunErrorInLogs,
} from './detect-cursor-sdk-run-error.js';

describe('cursor-sdk-run-error', () => {
  test('detects run-error log lines', () => {
    expect(
      isCursorSdkRunErrorInLogs([
        '[cursor-sdk:planner@c1 run-error] run abc failed: no error detail from SDK',
      ])
    ).toBe(true);
    expect(isCursorSdkRunErrorInLogs(['[cursor-sdk:planner@c1 text] hello'])).toBe(false);
  });

  test('formats latest run-error line', () => {
    expect(
      formatCursorSdkRunErrorMessage([
        '[cursor-sdk:planner@c1 text] ignored',
        '[cursor-sdk:planner@c1 run-error] run abc failed: timeout',
      ])
    ).toContain('timeout');
  });

  test('detects cursor-sdk auth errors from status ERROR and spawn-error', () => {
    expect(
      isCursorSdkAuthErrorInLogs([
        '[cursor-sdk:planner@882x8x status] ERROR: Authentication error If you are logged in, try logging out and back in.',
        '[cursor-sdk:planner@882x8x run-error] run run-0dd4d14b failed: no error detail from SDK',
      ])
    ).toBe(true);
    expect(
      isCursorSdkAuthErrorInLogs(['[cursor-sdk:builder@c1 spawn-error] [unauthenticated] Error'])
    ).toBe(true);
  });

  test('ignores auth errors without cursor-sdk log prefix', () => {
    expect(isCursorSdkAuthErrorInLogs(['HTTP 401 Unauthorized from provider'])).toBe(false);
  });

  test('hasCursorSdkSessionReopenTrigger for run-error and spawn-error auth', () => {
    expect(
      hasCursorSdkSessionReopenTrigger([
        '[cursor-sdk:builder@c1 run-error] run abc failed: no error detail from SDK',
      ])
    ).toBe(true);
    expect(
      hasCursorSdkSessionReopenTrigger([
        '[cursor-sdk:builder@c1 spawn-error] [unauthenticated] Error',
      ])
    ).toBe(true);
    expect(hasCursorSdkSessionReopenTrigger(['[cursor-sdk:planner@c1 text] hello'])).toBe(false);
  });
});
