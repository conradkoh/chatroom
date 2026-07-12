import { describe, it, expect } from 'vitest';

import {
  formatMessageViewRoleLabel,
  getMessageFilterRoles,
  isValidMessageViewMode,
  messageViewModeToSenderRole,
  roleToMessageViewMode,
} from './messageViewMode';

describe('messageViewMode helpers', () => {
  it('getMessageFilterRoles includes user and dedupes team roles', () => {
    expect(getMessageFilterRoles(['planner', 'builder'])).toEqual(['user', 'planner', 'builder']);
    expect(getMessageFilterRoles(['user', 'planner', 'builder'])).toEqual([
      'user',
      'planner',
      'builder',
    ]);
  });

  it('roleToMessageViewMode maps user to user-only for backward compat', () => {
    expect(roleToMessageViewMode('user')).toBe('user-only');
    expect(roleToMessageViewMode('planner')).toBe('role:planner');
  });

  it('messageViewModeToSenderRole resolves filter roles', () => {
    expect(messageViewModeToSenderRole('all')).toBeNull();
    expect(messageViewModeToSenderRole('user-only')).toBe('user');
    expect(messageViewModeToSenderRole('role:builder')).toBe('builder');
  });

  it('isValidMessageViewMode accepts legacy and role modes', () => {
    expect(isValidMessageViewMode('all')).toBe(true);
    expect(isValidMessageViewMode('user-only')).toBe(true);
    expect(isValidMessageViewMode('role:planner')).toBe(true);
    expect(isValidMessageViewMode('role:')).toBe(false);
    expect(isValidMessageViewMode('invalid')).toBe(false);
  });

  it('formatMessageViewRoleLabel capitalizes role names', () => {
    expect(formatMessageViewRoleLabel('planner')).toBe('Planner');
    expect(formatMessageViewRoleLabel('user')).toBe('User');
  });
});
