import { describe, expect, test } from 'vitest';

import { roleSupportsSessionAugmentation, SESSION_AUGMENTATION_ROLES } from './team-agent-settings';

describe('team-agent-settings', () => {
  test('builder role supports session augmentation', () => {
    expect(roleSupportsSessionAugmentation('builder')).toBe(true);
    expect(roleSupportsSessionAugmentation('Builder')).toBe(true);
  });

  test('other roles do not support session augmentation', () => {
    expect(roleSupportsSessionAugmentation('planner')).toBe(false);
    expect(roleSupportsSessionAugmentation('architect')).toBe(false);
    expect(roleSupportsSessionAugmentation('solo')).toBe(false);
  });

  test('SESSION_AUGMENTATION_ROLES includes builder only', () => {
    expect([...SESSION_AUGMENTATION_ROLES]).toEqual(['builder']);
  });
});
