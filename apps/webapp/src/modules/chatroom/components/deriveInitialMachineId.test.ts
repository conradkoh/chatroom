import { describe, expect, it } from 'vitest';

import { deriveInitialMachineId } from './AgentControls';
import type { AgentConfig, MachineInfo } from '../types/machine';
import type { Workspace } from '../types/workspace';

function mkMachine(id: string, hostname: string): MachineInfo {
  return {
    machineId: id,
    hostname,
    os: 'linux',
    availableHarnesses: ['cursor'],
    harnessVersions: {},
  };
}

function mkWorkspace(machineId: string, registeredAt: number): Workspace {
  return {
    machineId,
    workingDir: `/code/${machineId}`,
    id: `${machineId}::/code/${machineId}`,
    hostname: machineId,
    agentRoles: [],
    registeredAt,
    fileTreeSyncEnabled: true,
  };
}

describe('deriveInitialMachineId', () => {
  const mA = mkMachine('a', 'host-a');
  const mB = mkMachine('b', 'host-b');
  const connected = [mA, mB];

  it('returns null when there are no connected machines', () => {
    expect(deriveInitialMachineId([], [], undefined)).toBeNull();
  });

  it('prefers running agent machine', () => {
    const running: AgentConfig = {
      ...mA,
      role: 'builder',
      agentType: 'cursor',
      workingDir: '/p',
      updatedAt: 1,
      spawnedAgentPid: 42,
    };
    expect(deriveInitialMachineId(connected, [running], running)).toBe('a');
  });

  it('returns a machine that already has role config on it', () => {
    const cfg: AgentConfig = {
      ...mA,
      role: 'builder',
      agentType: 'cursor',
      workingDir: '/p',
      updatedAt: 1,
    };
    expect(deriveInitialMachineId(connected, [cfg], undefined)).toBe('a');
  });

  it('returns null when nothing matches (no arbitrary first-machine fallback)', () => {
    expect(deriveInitialMachineId(connected, [], undefined)).toBeNull();
  });

  it('uses the most recently registered connected workspace when configs are absent', () => {
    expect(
      deriveInitialMachineId(connected, [], undefined, undefined, [
        mkWorkspace('a', 100),
        mkWorkspace('b', 200),
      ])
    ).toBe('b');
  });

  it('prefers role config machine over workspace machine', () => {
    const cfg: AgentConfig = {
      ...mA,
      role: 'builder',
      agentType: 'cursor',
      workingDir: '/p',
      updatedAt: 1,
    };
    expect(
      deriveInitialMachineId(connected, [cfg], undefined, undefined, [mkWorkspace('b', 200)])
    ).toBe('a');
  });

  it('prefers connected team config machine over workspace machine', () => {
    expect(deriveInitialMachineId(connected, [], undefined, 'a', [mkWorkspace('b', 200)])).toBe(
      'a'
    );
  });

  it('returns null when workspace machines are not connected', () => {
    expect(
      deriveInitialMachineId([mA], [], undefined, undefined, [mkWorkspace('b', 200)])
    ).toBeNull();
  });
});
