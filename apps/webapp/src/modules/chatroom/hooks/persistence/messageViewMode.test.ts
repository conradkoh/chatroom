import { describe, it, expect } from 'vitest';

import {
  ENHANCER_FILTER_ROLE,
  formatMessageViewRoleLabel,
  getMessageFilterRoles,
  isValidMessageViewMode,
  messageMatchesSenderRoleFilter,
  messageViewModeToSenderRole,
  roleToMessageViewMode,
} from './messageViewMode';

describe('messageViewMode helpers', () => {
  it('getMessageFilterRoles includes user, dedupes team roles, and adds enhancer for planner teams', () => {
    expect(getMessageFilterRoles(['planner', 'builder'])).toEqual([
      'user',
      'planner',
      'builder',
      'enhancer',
    ]);
    expect(getMessageFilterRoles(['user', 'planner', 'builder'])).toEqual([
      'user',
      'planner',
      'builder',
      'enhancer',
    ]);
  });

  it('getMessageFilterRoles includes enhancer when planner present', () => {
    expect(getMessageFilterRoles(['planner', 'builder'])).toContain(ENHANCER_FILTER_ROLE);
    expect(getMessageFilterRoles(['builder', 'planner'])).toContain(ENHANCER_FILTER_ROLE);
  });

  it('getMessageFilterRoles does not include enhancer without planner', () => {
    expect(getMessageFilterRoles(['builder'])).not.toContain(ENHANCER_FILTER_ROLE);
  });

  it('getMessageFilterRoles does not duplicate enhancer', () => {
    const roles = getMessageFilterRoles(['planner', 'builder', 'enhancer']);
    expect(roles.filter((r) => r === ENHANCER_FILTER_ROLE)).toHaveLength(1);
  });

  it('roleToMessageViewMode maps user to user-only for backward compat', () => {
    expect(roleToMessageViewMode('user')).toBe('user-only');
    expect(roleToMessageViewMode('planner')).toBe('role:planner');
    expect(roleToMessageViewMode('enhancer')).toBe('role:enhancer');
  });

  it('messageViewModeToSenderRole resolves filter roles', () => {
    expect(messageViewModeToSenderRole('all')).toBeNull();
    expect(messageViewModeToSenderRole('user-only')).toBe('user');
    expect(messageViewModeToSenderRole('role:builder')).toBe('builder');
    expect(messageViewModeToSenderRole('role:enhancer')).toBe('enhancer');
  });

  it('isValidMessageViewMode accepts legacy and role modes', () => {
    expect(isValidMessageViewMode('all')).toBe(true);
    expect(isValidMessageViewMode('user-only')).toBe(true);
    expect(isValidMessageViewMode('role:planner')).toBe(true);
    expect(isValidMessageViewMode('role:enhancer')).toBe(true);
    expect(isValidMessageViewMode('role:')).toBe(false);
    expect(isValidMessageViewMode('invalid')).toBe(false);
  });

  it('formatMessageViewRoleLabel capitalizes role names', () => {
    expect(formatMessageViewRoleLabel('planner')).toBe('Planner');
    expect(formatMessageViewRoleLabel('user')).toBe('User');
    expect(formatMessageViewRoleLabel('enhancer')).toBe('Enhancer');
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

    // --- Enhancer filter ---

    it('includes enhancer messages for enhancer filter', () => {
      expect(
        messageMatchesSenderRoleFilter({ senderRole: 'enhancer', type: 'message' }, 'enhancer')
      ).toBe(true);
    });

    it('includes enhancer handoffs for enhancer filter', () => {
      expect(
        messageMatchesSenderRoleFilter({ senderRole: 'enhancer', type: 'handoff' }, 'enhancer')
      ).toBe(true);
    });

    it('includes planner handoffs to enhancer for enhancer filter', () => {
      expect(
        messageMatchesSenderRoleFilter(
          { senderRole: 'planner', type: 'handoff', targetRole: 'enhancer' },
          'enhancer'
        )
      ).toBe(true);
    });

    it('excludes planner handoffs to builder from enhancer filter', () => {
      expect(
        messageMatchesSenderRoleFilter(
          { senderRole: 'planner', type: 'handoff', targetRole: 'builder' },
          'enhancer'
        )
      ).toBe(false);
    });

    it('excludes planner messages from enhancer filter', () => {
      expect(
        messageMatchesSenderRoleFilter({ senderRole: 'planner', type: 'message' }, 'enhancer')
      ).toBe(false);
    });

    // --- Parity fixtures (must match listMessagesBySenderRolePaginated) ---

    const FIXTURES: {
      message: { senderRole: string; type: string; targetRole?: string };
      filterRole: string;
      expected: boolean;
    }[] = [
      // User filter
      { message: { senderRole: 'user', type: 'message' }, filterRole: 'user', expected: true },
      {
        message: { senderRole: 'planner', type: 'handoff', targetRole: 'user' },
        filterRole: 'user',
        expected: true,
      },
      { message: { senderRole: 'planner', type: 'message' }, filterRole: 'user', expected: false },
      // Enhancer filter
      {
        message: { senderRole: 'enhancer', type: 'handoff' },
        filterRole: 'enhancer',
        expected: true,
      },
      {
        message: { senderRole: 'planner', type: 'handoff', targetRole: 'enhancer' },
        filterRole: 'enhancer',
        expected: true,
      },
      {
        message: { senderRole: 'planner', type: 'handoff', targetRole: 'builder' },
        filterRole: 'enhancer',
        expected: false,
      },
      // Builder filter
      {
        message: { senderRole: 'builder', type: 'handoff' },
        filterRole: 'builder',
        expected: true,
      },
      {
        message: { senderRole: 'planner', type: 'message' },
        filterRole: 'builder',
        expected: false,
      },
    ];

    it.each(FIXTURES)(
      'parity: filterRole=$filterRole expects=$expected',
      ({ message, filterRole, expected }) => {
        expect(messageMatchesSenderRoleFilter(message, filterRole)).toBe(expected);
      }
    );
  });
});
