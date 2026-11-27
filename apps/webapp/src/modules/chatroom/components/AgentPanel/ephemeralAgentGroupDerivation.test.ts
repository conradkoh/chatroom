import type { ChatroomAgentActivityVariant } from '@workspace/shared/domain/chatroom-agent-activity-status';
import { describe, expect, it } from 'vitest';

import {
  EPHEMERAL_GROUP_EMPTY_LABEL,
  EPHEMERAL_GROUP_LOADING_LABEL,
  deriveEphemeralAgentGroups,
  ephemeralGroupAriaLabel,
  ephemeralGroupTitle,
  getCountIndicatorClass,
  getCountTextClass,
} from './ephemeralAgentGroupDerivation';
import type { AgentStatus } from '../../hooks/useAgentStatuses';

/** Canonical duo ephemeral roles, in team order. */
const DUO_ROLES = [
  'product-manager',
  'architect',
  'researcher',
  'triage',
  'reviewer',
  'uiux-engineer',
  'game-asset-designer',
  'verifier',
] as const;

type StatusValue = 'starting' | 'waiting' | 'stopping' | 'offline' | 'ready' | 'working' | 'error';

const VARIANT_BY_STATUS: Record<StatusValue, ChatroomAgentActivityVariant> = {
  starting: 'transitioning',
  waiting: 'transitioning',
  stopping: 'transitioning',
  offline: 'offline',
  ready: 'ready',
  working: 'working',
  error: 'error',
};

const LABEL_BY_STATUS: Record<StatusValue, string> = {
  starting: 'STARTING',
  waiting: 'WAITING',
  stopping: 'STOPPING',
  offline: 'OFFLINE',
  ready: 'READY',
  working: 'WORKING',
  error: 'ERROR',
};

/** Builds an `AgentStatus` literal without depending on the status hook. */
function status(
  role: string,
  statusValue: StatusValue,
  online: boolean,
  hasAssignedTask = false
): AgentStatus {
  const statusVariant = VARIANT_BY_STATUS[statusValue];
  return {
    role,
    online,
    lastSeenAt: null,
    statusLabel: LABEL_BY_STATUS[statusValue],
    statusVariant,
    isWorking: statusVariant === 'working',
    hasAssignedTask,
  };
}

const NON_ASSIGNED_MEMBERS = [
  'product-manager',
  'researcher',
  'reviewer',
  'uiux-engineer',
  'game-asset-designer',
  'verifier',
] as const;

describe('deriveEphemeralAgentGroups', () => {
  it('moves assigned agents outside while keeping team order', () => {
    const statuses = [
      status('architect', 'working', true, true),
      status('triage', 'error', false, true),
    ];

    const groups = deriveEphemeralAgentGroups(DUO_ROLES, statuses, false);

    expect(groups.outsideRoles).toEqual(['architect', 'triage']);
    expect(groups.memberRoles).toEqual([...NON_ASSIGNED_MEMBERS]);
    expect(groups.counts).toEqual({ online: 1, offline: 6, errored: 1, total: 8 });
  });

  it.each(['starting', 'waiting', 'offline', 'error', 'working'] as const)(
    'moves an assigned %s agent outside',
    (statusValue) => {
      const online = statusValue !== 'offline' && statusValue !== 'error';
      const groups = deriveEphemeralAgentGroups(
        DUO_ROLES,
        [status('architect', statusValue, online, true)],
        false
      );

      expect(groups.outsideRoles).toEqual(['architect']);
    }
  );

  it('keeps working and errored agents without an assignment inside the group', () => {
    const statuses = [status('architect', 'working', true), status('triage', 'error', false)];

    const groups = deriveEphemeralAgentGroups(DUO_ROLES, statuses, false);

    expect(groups.outsideRoles).toEqual([]);
    expect(groups.memberRoles).toEqual([...DUO_ROLES]);
    expect(groups.counts).toEqual({ online: 1, offline: 6, errored: 1, total: 8 });
  });

  it('follows ephemeral role order, not status array order', () => {
    const statuses = [
      status('verifier', 'working', true, true),
      status('architect', 'working', true, true),
      status('product-manager', 'working', true, true),
    ];

    const groups = deriveEphemeralAgentGroups(DUO_ROLES, statuses, false);

    expect(groups.outsideRoles).toEqual(['product-manager', 'architect', 'verifier']);
  });

  it('counts lifecycle statuses once each, whether assigned or not', () => {
    const statuses = [
      status('product-manager', 'starting', true),
      status('researcher', 'waiting', true),
      status('reviewer', 'stopping', true),
      status('verifier', 'offline', false),
      status('architect', 'working', true, true),
      status('triage', 'error', false, true),
    ];

    const groups = deriveEphemeralAgentGroups(DUO_ROLES, statuses, false);

    expect(groups.counts).toEqual({ online: 4, offline: 3, errored: 1, total: 8 });
    expect(groups.outsideRoles).toEqual(['architect', 'triage']);
    expect(groups.memberRoles).toEqual([...NON_ASSIGNED_MEMBERS]);
  });

  it('keeps counts summing to the total', () => {
    const statuses = [
      status('product-manager', 'starting', true),
      status('researcher', 'waiting', true),
      status('reviewer', 'stopping', true),
      status('verifier', 'offline', false),
      status('architect', 'working', true),
      status('triage', 'error', false),
    ];

    const { counts } = deriveEphemeralAgentGroups(DUO_ROLES, statuses, false);

    expect(counts).not.toBeNull();
    expect(counts!.online + counts!.offline + counts!.errored).toBe(counts!.total);
  });

  it('treats every ephemeral role as a member while statuses load, even when assigned', () => {
    const groups = deriveEphemeralAgentGroups(
      DUO_ROLES,
      [status('architect', 'working', true, true)],
      true
    );

    expect(groups.outsideRoles).toEqual([]);
    expect(groups.memberRoles).toEqual([...DUO_ROLES]);
    expect(groups.counts).toBeNull();
  });

  it('returns empty groups for an empty ephemeral list', () => {
    const groups = deriveEphemeralAgentGroups([], [], false);

    expect(groups.outsideRoles).toEqual([]);
    expect(groups.memberRoles).toEqual([]);
    expect(groups.counts).toEqual({ online: 0, offline: 0, errored: 0, total: 0 });
  });

  it('counts agents with no status row as offline', () => {
    const { counts } = deriveEphemeralAgentGroups(DUO_ROLES, [], false);

    expect(counts).toEqual({ online: 0, offline: 8, errored: 0, total: 8 });
  });

  it('moves every role outside when all have an assigned task', () => {
    const statuses = DUO_ROLES.map((role) => status(role, 'working', true, true));

    const groups = deriveEphemeralAgentGroups(DUO_ROLES, statuses, false);

    expect(groups.outsideRoles).toEqual([...DUO_ROLES]);
    expect(groups.memberRoles).toEqual([]);
    expect(groups.counts).toEqual({ online: 8, offline: 0, errored: 0, total: 8 });
  });
});

describe('ephemeralGroupAriaLabel', () => {
  const counts = { online: 1, offline: 6, errored: 1, total: 8 };

  it('starts with the visible title and describes counts with the show action when collapsed', () => {
    expect(ephemeralGroupAriaLabel({ expanded: false, total: 8, counts })).toBe(
      'Ephemeral (8): 1 online, 6 offline, 1 errored. Show group.'
    );
  });

  it('describes the hide action when expanded', () => {
    expect(ephemeralGroupAriaLabel({ expanded: true, total: 8, counts })).toBe(
      'Ephemeral (8): 1 online, 6 offline, 1 errored. Hide group.'
    );
  });

  it('describes loading with the visible title when counts are unavailable', () => {
    expect(ephemeralGroupAriaLabel({ expanded: false, total: 8, counts: null })).toBe(
      'Ephemeral (8): statuses loading. Show group.'
    );
  });

  it('exposes the visible title and stable loading and empty labels', () => {
    expect(ephemeralGroupTitle(8)).toBe('Ephemeral (8)');
    expect(EPHEMERAL_GROUP_LOADING_LABEL).toBe('Loading statuses…');
    expect(EPHEMERAL_GROUP_EMPTY_LABEL).toBe('No agents in group');
  });
});

describe('count colour mapping', () => {
  it('uses semantic tokens for non-zero counts', () => {
    expect(getCountIndicatorClass('online', 1)).toBe('bg-chatroom-status-success');
    expect(getCountIndicatorClass('offline', 6)).toBe('bg-chatroom-text-muted');
    expect(getCountIndicatorClass('errored', 1)).toBe('bg-chatroom-status-error');
  });

  it('mutes zero counts so inactive dots do not imply activity', () => {
    expect(getCountIndicatorClass('online', 0)).toBe('bg-chatroom-text-muted/40');
    expect(getCountIndicatorClass('errored', 0)).toBe('bg-chatroom-text-muted/40');
  });

  it('only highlights errored text when the count is non-zero', () => {
    expect(getCountTextClass('errored', 1)).toBe('text-chatroom-status-error');
    expect(getCountTextClass('errored', 0)).toBe('text-chatroom-text-muted');
    expect(getCountTextClass('online', 3)).toBe('text-chatroom-text-muted');
  });
});
