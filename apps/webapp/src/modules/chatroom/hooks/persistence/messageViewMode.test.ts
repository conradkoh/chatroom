import { describe, it, expect } from 'vitest';

import {
  formatMessageViewRoleLabel,
  getMessageFilterRoles,
  isValidMessageViewMode,
  messageMatchesSenderRoleFilter,
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

  describe('messageMatchesSenderRoleFilter', () => {
    it('includes user messages for user filter', () => {
      expect(messageMatchesSenderRoleFilter({ senderRole: 'user', type: 'message' }, 'user')).toBe(
        true
      );
    });

    it('includes handoffs to user for user filter', () => {
      expect(
        messageMatchesSenderRoleFilter(
          { senderRole: 'planner', type: 'handoff', targetRole: 'user' },
          'user'
        )
      ).toBe(true);
    });

    it('excludes user-originated handoffs (wrong direction)', () => {
      expect(messageMatchesSenderRoleFilter({ senderRole: 'user', type: 'handoff' }, 'user')).toBe(
        false
      );
    });

    it('includes builder messages for builder filter', () => {
      expect(
        messageMatchesSenderRoleFilter({ senderRole: 'builder', type: 'message' }, 'builder')
      ).toBe(true);
    });

    it('includes builder handoffs for builder filter', () => {
      expect(
        messageMatchesSenderRoleFilter({ senderRole: 'builder', type: 'handoff' }, 'builder')
      ).toBe(true);
    });

    it('excludes messages with wrong role', () => {
      expect(
        messageMatchesSenderRoleFilter({ senderRole: 'builder', type: 'message' }, 'user')
      ).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(messageMatchesSenderRoleFilter({ senderRole: 'User', type: 'message' }, 'user')).toBe(
        true
      );
      expect(messageMatchesSenderRoleFilter({ senderRole: 'user', type: 'message' }, 'User')).toBe(
        true
      );
    });
  });
});
