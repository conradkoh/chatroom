import { describe, expect, test } from 'vitest';

import {
  ENHANCER_DISABLED_USER_WORKFLOW,
  getEnhancerEnabledUserWorkflow,
  getEnhancerRequestFirstWorkflow,
} from './enhancer-workflow';

describe('enhancer-workflow constants', () => {
  test('enabled workflow runs enhancer once before planner and builder loops', () => {
    expect(getEnhancerRequestFirstWorkflow('planner')).toBe('user → enhancer → planner');
    expect(getEnhancerEnabledUserWorkflow('planner', true)).toBe(
      'user → enhancer → planner → [loop builder → planner] → user'
    );
  });

  test('solo uses the same request-first pass without a builder loop', () => {
    expect(getEnhancerEnabledUserWorkflow('solo', false)).toBe('user → enhancer → solo → user');
  });

  test('disabled user workflow omits enhancer', () => {
    expect(ENHANCER_DISABLED_USER_WORKFLOW).not.toContain('enhancer');
  });
});
