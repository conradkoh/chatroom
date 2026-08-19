import { describe, expect, test } from 'vitest';

import {
  ENHANCER_DISABLED_USER_WORKFLOW,
  ENHANCER_ENABLED_USER_WORKFLOW,
  ENHANCER_REQUEST_FIRST_WORKFLOW,
} from './enhancer-workflow';

describe('enhancer-workflow constants', () => {
  test('enabled workflow runs enhancer once before planner and builder loops', () => {
    expect(ENHANCER_REQUEST_FIRST_WORKFLOW).toBe('user → enhancer → planner');
    expect(ENHANCER_ENABLED_USER_WORKFLOW).toBe(
      'user → enhancer → planner → [loop builder → planner] → user'
    );
  });

  test('disabled user workflow omits enhancer', () => {
    expect(ENHANCER_DISABLED_USER_WORKFLOW).not.toContain('enhancer');
  });
});
