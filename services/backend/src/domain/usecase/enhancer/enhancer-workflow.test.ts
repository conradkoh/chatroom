import { describe, expect, test } from 'vitest';
import {
  ENHANCER_DELEGATION_ROUND_WORKFLOW,
  ENHANCER_DISABLED_USER_WORKFLOW,
  ENHANCER_ENABLED_USER_WORKFLOW,
} from './enhancer-workflow';

describe('enhancer-workflow constants', () => {
  test('enabled user workflow embeds delegation round as loop body', () => {
    expect(ENHANCER_ENABLED_USER_WORKFLOW).toContain(ENHANCER_DELEGATION_ROUND_WORKFLOW);
    expect(ENHANCER_ENABLED_USER_WORKFLOW).toBe(
      `user → [loop ${ENHANCER_DELEGATION_ROUND_WORKFLOW}] → user`
    );
  });

  test('disabled user workflow omits enhancer', () => {
    expect(ENHANCER_DISABLED_USER_WORKFLOW).not.toContain('enhancer');
  });
});
