import { describe, expect, it } from 'vitest';

import { dedupeWorkspacesById } from './useChatroomWorkspaces';
import type { Workspace } from '../../types/workspace';

function mkWorkspace(
  machineId: string,
  workingDir: string,
  overrides: Partial<Workspace> = {}
): Workspace {
  return {
    id: `${machineId}::${workingDir}`,
    machineId,
    hostname: 'host',
    workingDir,
    agentRoles: [],
    ...overrides,
  };
}

describe('dedupeWorkspacesById', () => {
  it('returns unique workspaces unchanged', () => {
    const workspaces = [mkWorkspace('m1', '/a'), mkWorkspace('m1', '/b'), mkWorkspace('m2', '/a')];
    expect(dedupeWorkspacesById(workspaces)).toEqual(workspaces);
  });

  it('collapses duplicate ids from trailing-slash registry rows', () => {
    const machineId = '352a8994-0b30-4558-835c-0a87b95c62ca';
    const workingDir = '/Users/conradkoh/Documents/Repos/baby-tracker';
    const workspaces = [
      mkWorkspace(machineId, workingDir, {
        agentRoles: ['builder'],
        registeredAt: 100,
        _registryId: 'reg-old',
      }),
      mkWorkspace(machineId, workingDir, {
        agentRoles: ['planner'],
        registeredAt: 200,
        _registryId: 'reg-new',
      }),
    ];

    expect(dedupeWorkspacesById(workspaces)).toEqual([
      mkWorkspace(machineId, workingDir, {
        agentRoles: ['builder', 'planner'],
        registeredAt: 200,
        _registryId: 'reg-new',
      }),
    ]);
  });

  it('keeps the more recently registered row as primary metadata', () => {
    const machineId = 'm1';
    const workingDir = '/proj';
    const workspaces = [
      mkWorkspace(machineId, workingDir, {
        hostname: 'new-host',
        registeredAt: 50,
        _registryId: 'older',
      }),
      mkWorkspace(machineId, workingDir, {
        hostname: 'old-host',
        registeredAt: 10,
        _registryId: 'newer',
      }),
    ];

    const [deduped] = dedupeWorkspacesById(workspaces);
    expect(deduped.hostname).toBe('new-host');
    expect(deduped._registryId).toBe('older');
  });

  it('yields unique ids suitable for React list keys', () => {
    const machineId = '352a8994-0b30-4558-835c-0a87b95c62ca';
    const workingDir = '/Users/conradkoh/Documents/Repos/baby-tracker';
    const deduped = dedupeWorkspacesById([
      mkWorkspace(machineId, workingDir),
      mkWorkspace(machineId, workingDir, { _registryId: 'second-row' }),
    ]);

    const ids = deduped.map((ws) => ws.id);
    expect(ids).toEqual([`${machineId}::${workingDir}`]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
