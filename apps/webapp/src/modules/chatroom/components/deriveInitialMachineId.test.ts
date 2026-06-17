import { describe, expect, it } from 'vitest';

import { deriveInitialMachineId } from './AgentControls';
import type { AgentConfig, MachineInfo } from '../types/machine';

function mkMachine(id: string, hostname: string): MachineInfo {
  return {
    machineId: id,
    hostname,
    os: 'linux',
    availableHarnesses: ['cursor'],
    harnessVersions: {},
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
});
