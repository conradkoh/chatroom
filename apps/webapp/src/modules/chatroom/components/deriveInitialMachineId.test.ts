import { describe, expect, it } from 'vitest';

import type { AgentConfig, MachineInfo } from '../types/machine';
import { deriveInitialMachineId, type AgentPreference } from './AgentConfigTabs';

function mkMachine(id: string, hostname: string): MachineInfo {
  return {
    machineId: id,
    hostname,
    os: 'linux',
    availableHarnesses: ['cursor'],
    harnessVersions: {},
    availableModels: { cursor: [] },
    daemonConnected: true,
    lastSeenAt: 0,
  };
}

describe('deriveInitialMachineId', () => {
  const mA = mkMachine('a', 'host-a');
  const mB = mkMachine('b', 'host-b');
  const connected = [mA, mB];

  it('returns null when there are no connected machines', () => {
    expect(deriveInitialMachineId([], [], undefined, undefined)).toBeNull();
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
    expect(deriveInitialMachineId(connected, [running], running, undefined)).toBe('a');
  });

  it('prefers saved preference when present on a connected machine', () => {
    const pref: AgentPreference = {
      role: 'builder',
      machineId: 'b',
      agentHarness: 'cursor',
    };
    expect(deriveInitialMachineId(connected, [], undefined, pref)).toBe('b');
  });

  it('returns a machine that already has role config on it', () => {
    const cfg: AgentConfig = {
      ...mA,
      role: 'builder',
      agentType: 'cursor',
      workingDir: '/p',
      updatedAt: 1,
    };
    expect(deriveInitialMachineId(connected, [cfg], undefined, undefined)).toBe('a');
  });

  it('returns null when nothing matches (no arbitrary first-machine fallback)', () => {
    const pref: AgentPreference = {
      role: 'builder',
      machineId: 'offline',
      agentHarness: 'cursor',
    };
    expect(deriveInitialMachineId(connected, [], undefined, pref)).toBeNull();
  });
});
