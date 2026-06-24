import { describe, expect, test } from 'vitest';

import {
  formatCursorSdkRunErrorMessage,
  isCursorSdkRunErrorInLogs,
} from '../../../domain/agent-lifecycle/policies/cursor-sdk-run-error.js';

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
});
