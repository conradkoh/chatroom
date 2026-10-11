import { describe, expect, test } from 'vitest';

import { selectWakeableAgentRoles, type WakeStatusRow } from './select-wakeable-agent-roles';
import type { Id } from '../../../../convex/_generated/dataModel';

const PRIMARY = 'workspace-primary' as Id<'chatroom_workspaces'>;
const OTHER = 'workspace-other' as Id<'chatroom_workspaces'>;

function row(
  role: string,
  status: WakeStatusRow['status'],
  workspaceId?: Id<'chatroom_workspaces'>
): WakeStatusRow {
  return { role, status, ...(workspaceId ? { workspaceId } : {}) };
}

function select(roles: string[], statusRows: WakeStatusRow[]): string[] {
  return selectWakeableAgentRoles({ roles, workspaceId: PRIMARY, statusRows });
}

describe('selectWakeableAgentRoles', () => {
  test('role with no status row is eligible', () => {
    expect(select(['architect'], [])).toEqual(['architect']);
  });

  test('offline role is eligible', () => {
    expect(select(['architect'], [row('architect', 'offline', PRIMARY)])).toEqual(['architect']);
  });

  test('error role is eligible', () => {
    expect(select(['architect'], [row('architect', 'error', PRIMARY)])).toEqual(['architect']);
  });

  test.each(['starting', 'waiting', 'working', 'stopping'] as const)(
    'role with status %s is not eligible',
    (status) => {
      expect(select(['architect'], [row('architect', status, PRIMARY)])).toEqual([]);
    }
  );

  test('row for a different workspace is ignored', () => {
    expect(select(['architect'], [row('architect', 'working', OTHER)])).toEqual(['architect']);
  });

  test('legacy row without workspaceId decides when no scoped row exists', () => {
    expect(select(['architect'], [row('architect', 'waiting')])).toEqual([]);
  });

  test('scoped row wins over a legacy row', () => {
    expect(
      select(['architect'], [row('architect', 'waiting'), row('architect', 'offline', PRIMARY)])
    ).toEqual(['architect']);
  });

  test('role name matching is case-insensitive', () => {
    expect(select(['Architect'], [row('architect', 'working', PRIMARY)])).toEqual([]);
    expect(select(['architect'], [row('Architect', 'working', PRIMARY)])).toEqual([]);
  });

  test('returns roles in input order', () => {
    const roles = ['builder', 'planner', 'architect'];
    expect(select(roles, [row('planner', 'working', PRIMARY)])).toEqual(['builder', 'architect']);
  });
});
