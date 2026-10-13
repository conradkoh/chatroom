import { describe, expect, it } from 'vitest';

import {
  deriveInitialMachineId,
  deriveInitialWorkingDir,
  isReadyToInitialize,
  resolveInitialSelection,
  shouldDeferInitUntilWorkspacesLoad,
  type InitializationInputs,
} from './initialization';
import type { AgentConfig, AgentHarness, MachineInfo } from '../../types/machine';
import type { Workspace } from '../../types/workspace';

function mkMachine(
  id: string,
  hostname: string,
  availableHarnesses: AgentHarness[] = ['cursor']
): MachineInfo {
  return {
    machineId: id,
    hostname,
    os: 'linux',
    availableHarnesses,
    harnessVersions: {},
  };
}

function mkRegisteredWorkspace(machineId: string, registeredAt: number): Workspace {
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

function mkWorkspaceInDir(machineId: string, workingDir: string): Workspace {
  return {
    id: `${machineId}::${workingDir}`,
    machineId,
    hostname: 'host',
    workingDir,
    agentRoles: ['builder'],
    fileTreeSyncEnabled: true,
  };
}

function mkConfig(machineId: string, workingDir: string, updatedAt = 1): AgentConfig {
  return {
    machineId,
    hostname: 'host',
    role: 'builder',
    agentType: 'cursor',
    availableHarnesses: ['cursor'],
    workingDir,
    updatedAt,
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
        mkRegisteredWorkspace('a', 100),
        mkRegisteredWorkspace('b', 200),
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
      deriveInitialMachineId(connected, [cfg], undefined, undefined, [
        mkRegisteredWorkspace('b', 200),
      ])
    ).toBe('a');
  });

  it('prefers connected team config machine over workspace machine', () => {
    expect(
      deriveInitialMachineId(connected, [], undefined, 'a', [mkRegisteredWorkspace('b', 200)])
    ).toBe('a');
  });

  it('returns null when workspace machines are not connected', () => {
    expect(
      deriveInitialMachineId([mA], [], undefined, undefined, [mkRegisteredWorkspace('b', 200)])
    ).toBeNull();
  });
});

describe('deriveInitialWorkingDir', () => {
  describe('when machineId is set', () => {
    it('uses roleConfig.workingDir for the machine when present', () => {
      const result = deriveInitialWorkingDir(
        'm1',
        [mkConfig('m1', '/from-config')],
        [mkWorkspaceInDir('m1', '/from-workspace')]
      );
      expect(result).toBe('/from-config');
    });

    it('uses chatroomWorkspaces entry when config has no working dir', () => {
      const result = deriveInitialWorkingDir(
        'm1',
        [mkConfig('m1', '')],
        [mkWorkspaceInDir('m1', '/from-workspace')]
      );
      expect(result).toBe('/from-workspace');
    });
  });

  describe('fallbacks when machineId is not set', () => {
    it('uses latest roleConfig workingDir by updatedAt', () => {
      const result = deriveInitialWorkingDir(null, [
        mkConfig('m1', '/older', 1),
        mkConfig('m2', '/newer', 10),
      ]);
      expect(result).toBe('/newer');
    });

    it('returns empty string when no machine and no role configs', () => {
      const result = deriveInitialWorkingDir(null, []);
      expect(result).toBe('');
    });
  });
});

describe('shouldDeferInitUntilWorkspacesLoad', () => {
  it('defers when machine is selected and working dir may come from workspace registry', () => {
    expect(shouldDeferInitUntilWorkspacesLoad('m1', [])).toBe(true);
  });

  it('does not defer when role config already has working dir for the machine', () => {
    expect(shouldDeferInitUntilWorkspacesLoad('m1', [mkConfig('m1', '/from-config')])).toBe(false);
  });

  it('defers when no machine is known because workspace registry may restore it', () => {
    expect(shouldDeferInitUntilWorkspacesLoad(null, [mkConfig('m1', '/fallback')])).toBe(true);
  });

  it('defers when no machine and no role configs', () => {
    expect(shouldDeferInitUntilWorkspacesLoad(null, [])).toBe(true);
  });
});

describe('isReadyToInitialize', () => {
  const ready = {
    isInitialized: false,
    connectedCount: 1,
    workspaceId: undefined,
    configurationLoading: false,
  };

  it('is not ready once initialization has run', () => {
    expect(isReadyToInitialize({ ...ready, isInitialized: true })).toBe(false);
  });

  it('is not ready until a machine is connected', () => {
    expect(isReadyToInitialize({ ...ready, connectedCount: 0 })).toBe(false);
  });

  it('is ready when there is no selected workspace, whatever the config state', () => {
    expect(isReadyToInitialize({ ...ready, configurationLoading: true })).toBe(true);
  });

  it('waits for the selected workspace config to load', () => {
    expect(isReadyToInitialize({ ...ready, workspaceId: 'ws-1', configurationLoading: true })).toBe(
      false
    );
  });

  it('is ready once the selected workspace config has loaded', () => {
    expect(
      isReadyToInitialize({ ...ready, workspaceId: 'ws-1', configurationLoading: false })
    ).toBe(true);
  });
});

describe('resolveInitialSelection', () => {
  const mA = mkMachine('a', 'host-a');
  const mB = mkMachine('b', 'host-b');
  const inputs = (overrides: Partial<InitializationInputs> = {}): InitializationInputs => ({
    connectedMachines: [mA, mB],
    roleConfigs: [],
    runningAgentConfig: undefined,
    ...overrides,
  });

  it('waits, returning null, while workspaces load and may still supply the machine', () => {
    expect(
      resolveInitialSelection(inputs({ connectedMachines: [mA], chatroomWorkspacesLoading: true }))
    ).toBeNull();
  });

  it('resolves an empty selection once workspaces have loaded and nothing matches', () => {
    expect(
      resolveInitialSelection(inputs({ connectedMachines: [mA], chatroomWorkspacesLoading: false }))
    ).toEqual({ machineId: null, harness: null, workingDir: '', seededFromConfig: false });
  });

  it('does not wait while loading when the role config already names the machine and its dir', () => {
    const result = resolveInitialSelection(
      inputs({
        connectedMachines: [mA],
        roleConfigs: [mkConfig('a', '/p')],
        chatroomWorkspacesLoading: true,
      })
    );
    expect(result).toMatchObject({ machineId: 'a', workingDir: '/p' });
  });

  it('uses the locked machine and working dir over the derived ones', () => {
    const result = resolveInitialSelection(
      inputs({
        roleConfigs: [mkConfig('a', '/p')],
        lockedMachineId: 'b',
        lockedWorkingDir: '/locked',
      })
    );
    expect(result).toMatchObject({ machineId: 'b', workingDir: '/locked' });
  });

  it('takes the harness from the saved config when the machine has it installed', () => {
    const result = resolveInitialSelection(inputs({ roleConfigs: [mkConfig('a', '/p')] }));
    expect(result).toEqual({
      machineId: 'a',
      harness: 'cursor',
      workingDir: '/p',
      seededFromConfig: true,
    });
  });

  it('takes the harness from the team config when the saved config is not installed', () => {
    const machine = mkMachine('a', 'host-a', ['cursor', 'opencode']);
    const result = resolveInitialSelection(
      inputs({
        connectedMachines: [machine],
        roleConfigs: [{ ...mkConfig('a', '/p'), agentType: 'claude' }],
        teamConfigHarness: 'opencode',
      })
    );
    expect(result).toMatchObject({ machineId: 'a', harness: 'opencode', seededFromConfig: true });
  });

  it('falls back to the only installed harness, without marking it as seeded', () => {
    const result = resolveInitialSelection(inputs({ lockedMachineId: 'a' }));
    expect(result).toMatchObject({ machineId: 'a', harness: 'cursor', seededFromConfig: false });
  });

  it('leaves the harness open when several are installed and nothing chose one', () => {
    const machine = mkMachine('a', 'host-a', ['cursor', 'opencode']);
    const result = resolveInitialSelection(
      inputs({ connectedMachines: [machine], lockedMachineId: 'a' })
    );
    expect(result).toMatchObject({ machineId: 'a', harness: null, seededFromConfig: false });
  });

  it('takes the working dir and the machine from the workspace registry when no config names them', () => {
    const result = resolveInitialSelection(
      inputs({
        connectedMachines: [mA],
        initializationWorkspaces: [mkRegisteredWorkspace('a', 100)],
      })
    );
    expect(result).toMatchObject({ machineId: 'a', workingDir: '/code/a' });
  });
});
