import { describe, it, expect } from 'vitest';

import { buildWorkspaceGroups } from './buildWorkspaceGroups';
import type { Workspace } from '../types/workspace';

// ─── Helpers ────────────────────────────────────────────────────────────

function ws(overrides: Partial<Workspace> & { id: string }): Workspace {
  return {
    machineId: 'machine-1',
    hostname: 'Machine A',
    workingDir: '/project',
    agentRoles: [],
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('buildWorkspaceGroups', () => {
  it('returns empty array when no workspaces and no agents', () => {
    const result = buildWorkspaceGroups([], []);
    expect(result).toEqual([]);
  });

  it('groups workspaces by hostname', () => {
    const workspaces: Workspace[] = [
      ws({ id: 'a::dir1', hostname: 'Machine A', workingDir: '/dir1', agentRoles: ['planner'] }),
      ws({ id: 'a::dir2', hostname: 'Machine A', workingDir: '/dir2', agentRoles: ['builder'] }),
      ws({ id: 'b::dir3', hostname: 'Machine B', machineId: 'machine-2', workingDir: '/dir3', agentRoles: ['reviewer'] }),
    ];

    const result = buildWorkspaceGroups(workspaces, [
      { role: 'planner' },
      { role: 'builder' },
      { role: 'reviewer' },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].hostname).toBe('Machine A');
    expect(result[0].workspaces).toHaveLength(2);
    expect(result[1].hostname).toBe('Machine B');
    expect(result[1].workspaces).toHaveLength(1);
  });

  it('creates __unassigned__ group for agents not in any workspace', () => {
    const workspaces: Workspace[] = [
      ws({ id: 'a::dir1', agentRoles: ['planner'] }),
    ];

    const result = buildWorkspaceGroups(workspaces, [
      { role: 'planner' },
      { role: 'builder' },
      { role: 'reviewer' },
    ]);

    expect(result).toHaveLength(2);

    const unassigned = result.find((g) => g.hostname === 'Unassigned');
    expect(unassigned).toBeDefined();
    expect(unassigned!.machineId).toBeNull();
    expect(unassigned!.workspaces).toHaveLength(1);
    expect(unassigned!.workspaces[0].id).toBe('__unassigned__');
    expect(unassigned!.workspaces[0].agentRoles).toEqual(['builder', 'reviewer']);
  });

  it('does not create __unassigned__ group when all agents are assigned', () => {
    const workspaces: Workspace[] = [
      ws({ id: 'a::dir1', agentRoles: ['planner', 'builder'] }),
    ];

    const result = buildWorkspaceGroups(workspaces, [
      { role: 'planner' },
      { role: 'builder' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].hostname).toBe('Machine A');
    expect(result.find((g) => g.hostname === 'Unassigned')).toBeUndefined();
  });

  it('creates only __unassigned__ group when no workspaces exist but agents do', () => {
    const result = buildWorkspaceGroups([], [
      { role: 'planner' },
      { role: 'builder' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].hostname).toBe('Unassigned');
    expect(result[0].workspaces[0].agentRoles).toEqual(['planner', 'builder']);
  });

  it('preserves machineId on groups', () => {
    const workspaces: Workspace[] = [
      ws({ id: 'x::dir', machineId: 'machine-x', hostname: 'X', agentRoles: ['planner'] }),
    ];

    const result = buildWorkspaceGroups(workspaces, [{ role: 'planner' }]);

    expect(result[0].machineId).toBe('machine-x');
  });

  it('handles multiple workspaces on same machine with different working dirs', () => {
    const workspaces: Workspace[] = [
      ws({ id: 'a::frontend', workingDir: '/app/frontend', agentRoles: ['planner'] }),
      ws({ id: 'a::backend', workingDir: '/app/backend', agentRoles: ['builder'] }),
    ];

    const result = buildWorkspaceGroups(workspaces, [
      { role: 'planner' },
      { role: 'builder' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].hostname).toBe('Machine A');
    expect(result[0].workspaces).toHaveLength(2);
    expect(result[0].workspaces[0].workingDir).toBe('/app/frontend');
    expect(result[0].workspaces[1].workingDir).toBe('/app/backend');
  });
});
