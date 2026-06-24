import { describe, expect, test } from 'vitest';

import {
  roleSupportsAutoRestartOnNewContextSetting,
  AUTO_RESTART_ON_NEW_CONTEXT_ROLES,
} from './team-agent-settings';

describe('team-agent-settings', () => {
  test('builder role supports auto-restart-on-new-context setting', () => {
    expect(roleSupportsAutoRestartOnNewContextSetting('builder')).toBe(true);
    expect(roleSupportsAutoRestartOnNewContextSetting('Builder')).toBe(true);
  });

  test('other roles do not support the setting yet', () => {
    expect(roleSupportsAutoRestartOnNewContextSetting('planner')).toBe(false);
    expect(roleSupportsAutoRestartOnNewContextSetting('architect')).toBe(false);
    expect(roleSupportsAutoRestartOnNewContextSetting('solo')).toBe(false);
  });

  test('AUTO_RESTART_ON_NEW_CONTEXT_ROLES includes builder only', () => {
    expect([...AUTO_RESTART_ON_NEW_CONTEXT_ROLES]).toEqual(['builder']);
  });
});
