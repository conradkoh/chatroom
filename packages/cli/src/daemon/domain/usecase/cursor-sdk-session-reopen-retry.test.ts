import { describe, expect, test } from 'vitest';

import {
  CURSOR_SDK_SESSION_REOPEN_INTERVAL_MS,
  CURSOR_SDK_SESSION_REOPEN_MAX_ATTEMPTS,
  CURSOR_SDK_SESSION_REOPEN_REASON,
  CURSOR_SDK_SESSION_RESUME_FIRST_ATTEMPTS,
} from './cursor-sdk-session-reopen-retry.js';

describe('cursor-sdk-session-reopen-retry', () => {
  test('uses 6 attempts (3 resume + 3 cold) at 10s intervals', () => {
    expect(CURSOR_SDK_SESSION_REOPEN_MAX_ATTEMPTS).toBe(6);
    expect(CURSOR_SDK_SESSION_REOPEN_INTERVAL_MS).toBe(10_000);
    expect(CURSOR_SDK_SESSION_REOPEN_REASON).toBe('platform.cursor_sdk_session_reopen');
    expect(CURSOR_SDK_SESSION_RESUME_FIRST_ATTEMPTS).toBe(3);
  });
});
