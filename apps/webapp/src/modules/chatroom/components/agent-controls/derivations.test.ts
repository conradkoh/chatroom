import { describe, expect, it } from 'vitest';

import {
  deriveAgentStatus,
  deriveModelSelectionReady,
  deriveRehomeLabels,
  deriveRunningAgentConfig,
  deriveSelectedModel,
  favoriteDefaultBlocked,
  isRehomeNeeded,
  restartModelFor,
  saveChoiceOf,
  saveScopeOf,
  startCommandOf,
  workspaceField,
  type AgentStatusInput,
} from './derivations';
import type { MachineConfigEntry } from '../../features/machine-config/types/machineConfig';
import type { AgentConfig, AgentHarness, MachineInfo } from '../../types/machine';

function mkMachine(
  id: string,
  hostname: string,
  availableHarnesses: AgentHarness[] = ['cursor']
): MachineInfo {
  return { machineId: id, hostname, os: 'linux', availableHarnesses, harnessVersions: {} };
}

function mkConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    machineId: 'a',
    hostname: 'host-a',
    role: 'builder',
    agentType: 'cursor',
    availableHarnesses: ['cursor'],
    workingDir: '/p',
    updatedAt: 1,
    ...overrides,
  };
}

describe('deriveRunningAgentConfig', () => {
  const connected = [mkMachine('a', 'host-a')];

  it('prefers a config with a spawned PID on a connected machine', () => {
    const pid = mkConfig({ spawnedAgentPid: 42 });
    expect(deriveRunningAgentConfig([mkConfig(), pid], connected, false)).toBe(pid);
  });

  it('ignores a PID-backed config on a machine that is not connected', () => {
    const offline = mkConfig({ machineId: 'z', spawnedAgentPid: 42 });
    expect(deriveRunningAgentConfig([offline], connected, false)).toBeUndefined();
  });

  it('falls back to the first connected config when the runtime reports it running', () => {
    const configA = mkConfig();
    expect(deriveRunningAgentConfig([configA], connected, true)).toBe(configA);
  });

  it('is undefined when nothing has a PID and the runtime is not running', () => {
    expect(deriveRunningAgentConfig([mkConfig()], connected, false)).toBeUndefined();
  });
});

describe('deriveRehomeLabels', () => {
  const connected = [mkMachine('a', 'host-a', ['cursor']), mkMachine('b', 'host-b', ['cursor'])];

  it('is null when there is no team binding', () => {
    expect(deriveRehomeLabels(undefined, 'b', connected)).toBeNull();
  });

  it('is null when no machine is selected', () => {
    expect(deriveRehomeLabels('a', null, connected)).toBeNull();
  });

  it('names the previous and next machines by display name', () => {
    expect(deriveRehomeLabels('a', 'b', connected)).toEqual({ previous: 'host-a', next: 'host-b' });
  });

  it('falls back to the machine id for a machine that is not connected', () => {
    expect(deriveRehomeLabels('gone', 'b', connected)).toEqual({
      previous: 'gone',
      next: 'host-b',
    });
  });
});

describe('favoriteDefaultBlocked', () => {
  it('is blocked by an explicit harness choice', () => {
    expect(favoriteDefaultBlocked(true, undefined, false)).toBe(true);
  });

  it('is blocked by a running agent', () => {
    expect(favoriteDefaultBlocked(false, mkConfig(), false)).toBe(true);
  });

  it('is blocked by a saved snapshot', () => {
    expect(favoriteDefaultBlocked(false, undefined, true)).toBe(true);
  });

  it('is not blocked when none of the three applies', () => {
    expect(favoriteDefaultBlocked(false, undefined, false)).toBe(false);
  });
});

describe('deriveModelSelectionReady', () => {
  const ready = {
    selectedMachineId: 'a' as string | null,
    selectedHarness: 'cursor' as AgentHarness | null,
    machineModelsLoading: false,
    machineModelFilterLoading: false,
  };

  it('is ready once the machine, harness and both model lists have loaded', () => {
    expect(deriveModelSelectionReady(ready)).toBe(true);
  });

  it('waits for a machine', () => {
    expect(deriveModelSelectionReady({ ...ready, selectedMachineId: null })).toBe(false);
  });

  it('waits for a harness', () => {
    expect(deriveModelSelectionReady({ ...ready, selectedHarness: null })).toBe(false);
  });

  it('waits while the machine models load', () => {
    expect(deriveModelSelectionReady({ ...ready, machineModelsLoading: true })).toBe(false);
  });

  it('waits while the model filter loads', () => {
    expect(deriveModelSelectionReady({ ...ready, machineModelFilterLoading: true })).toBe(false);
  });
});

describe('deriveSelectedModel', () => {
  const base = {
    modelSelectionReady: true,
    roleConfigs: [] as AgentConfig[],
    selectedMachineId: 'a',
    selectedHarness: 'cursor' as AgentHarness | null,
    availableModelsForHarness: ['m1', 'm2', 'm3'],
    visibleModels: ['m1', 'm2', 'm3'],
    userModelByHarness: {} as Partial<Record<AgentHarness, string>>,
    teamConfigModel: undefined as string | undefined,
    defaultFavorites: [] as MachineConfigEntry[],
  };

  it('is null while selection is not ready', () => {
    expect(deriveSelectedModel({ ...base, modelSelectionReady: false })).toBeNull();
  });

  it('is null without a harness', () => {
    expect(deriveSelectedModel({ ...base, selectedHarness: null })).toBeNull();
  });

  it('uses the explicit user choice for this harness when it is available', () => {
    expect(deriveSelectedModel({ ...base, userModelByHarness: { cursor: 'm3' } })).toBe('m3');
  });

  it('ignores a user choice that is no longer available', () => {
    expect(deriveSelectedModel({ ...base, userModelByHarness: { cursor: 'gone' } })).toBe('m1');
  });

  it('uses the machine config model for the same harness when it is visible', () => {
    expect(deriveSelectedModel({ ...base, roleConfigs: [mkConfig({ model: 'm2' })] })).toBe('m2');
  });

  it('ignores a machine config model saved under another harness', () => {
    const other = mkConfig({ agentType: 'opencode', model: 'm2' });
    expect(deriveSelectedModel({ ...base, roleConfigs: [other] })).toBe('m1');
  });

  it('uses the team config model when it is visible', () => {
    expect(deriveSelectedModel({ ...base, teamConfigModel: 'm3' })).toBe('m3');
  });

  it('uses the favourite preference for the harness when nothing above applies', () => {
    expect(
      deriveSelectedModel({ ...base, defaultFavorites: [{ agentHarness: 'cursor', model: 'm3' }] })
    ).toBe('m3');
  });

  it('prefers the machine config over the team config and the favourite', () => {
    expect(
      deriveSelectedModel({
        ...base,
        roleConfigs: [mkConfig({ model: 'm2' })],
        teamConfigModel: 'm3',
        defaultFavorites: [{ agentHarness: 'cursor', model: 'm1' }],
      })
    ).toBe('m2');
  });

  it('falls back to the first visible model when no source applies', () => {
    expect(deriveSelectedModel({ ...base, visibleModels: ['m2'] })).toBe('m2');
  });

  it('falls back to the first available model when none is visible', () => {
    expect(deriveSelectedModel({ ...base, visibleModels: [] })).toBe('m1');
  });
});

const baseStatus: AgentStatusInput = {
  selectedMachineId: 'a',
  selectedHarness: 'cursor',
  selectedModel: 'm1',
  hasModels: true,
  workingDir: '/p',
  workspaceId: 'ws-1',
  isStarting: false,
  isSaving: false,
  isStopSubmitting: false,
  isAgentRunning: false,
  success: null,
};

describe('deriveAgentStatus', () => {
  it('allows start and save when everything is set and nothing runs', () => {
    expect(deriveAgentStatus(baseStatus)).toEqual({
      isStopping: false,
      isBusy: false,
      canStart: true,
      canSave: true,
      canStop: false,
      canRestart: false,
    });
  });

  it('needs a model before start when the harness has models', () => {
    expect(deriveAgentStatus({ ...baseStatus, selectedModel: null }).canStart).toBe(false);
  });

  it('does not need a model when the harness has none', () => {
    expect(
      deriveAgentStatus({ ...baseStatus, selectedModel: null, hasModels: false }).canStart
    ).toBe(true);
  });

  it('needs a workspace before save, but not before start', () => {
    const status = deriveAgentStatus({ ...baseStatus, workspaceId: undefined });
    expect(status.canSave).toBe(false);
    expect(status.canStart).toBe(true);
  });

  it('blocks start and save with a blank working dir', () => {
    const status = deriveAgentStatus({ ...baseStatus, workingDir: '   ' });
    expect(status.canStart).toBe(false);
    expect(status.canSave).toBe(false);
  });

  it('blocks start and save while an agent runs, and allows stop and restart', () => {
    expect(deriveAgentStatus({ ...baseStatus, isAgentRunning: true })).toMatchObject({
      canStart: false,
      canSave: false,
      canStop: true,
      canRestart: true,
    });
  });

  it('is stopping while a stop is submitted, so stop and restart are off', () => {
    expect(
      deriveAgentStatus({ ...baseStatus, isAgentRunning: true, isStopSubmitting: true })
    ).toMatchObject({ isStopping: true, isBusy: true, canStop: false, canRestart: false });
  });

  it('is busy while starting, so restart is off', () => {
    expect(
      deriveAgentStatus({ ...baseStatus, isAgentRunning: true, isStarting: true })
    ).toMatchObject({ isBusy: true, canStart: false, canRestart: false });
  });

  it('is busy while saving, so save is off', () => {
    expect(deriveAgentStatus({ ...baseStatus, isSaving: true })).toMatchObject({
      isBusy: true,
      canSave: false,
    });
  });

  it('blocks start after a success, and stop once it has succeeded', () => {
    expect(
      deriveAgentStatus({ ...baseStatus, isAgentRunning: true, success: 'Started' })
    ).toMatchObject({ canStart: false, canStop: false });
  });
});

describe('startCommandOf', () => {
  const args = {
    machineId: 'a',
    chatroomId: 'room-1',
    workspaceId: undefined as string | undefined,
    role: 'builder',
    model: 'm1' as string | null,
    agentHarness: 'cursor' as AgentHarness,
    workingDir: '/p',
  };

  it('builds the start payload', () => {
    expect(startCommandOf(args)).toEqual({
      machineId: 'a',
      chatroomId: 'room-1',
      role: 'builder',
      model: 'm1',
      agentHarness: 'cursor',
      workingDir: '/p',
      allowNewMachine: undefined,
    });
  });

  it('includes the workspace id only when there is one', () => {
    expect(startCommandOf({ ...args, workspaceId: 'ws-1' })).toHaveProperty('workspaceId', 'ws-1');
    expect(startCommandOf(args)).not.toHaveProperty('workspaceId');
  });

  it('drops an empty model and a blank working dir', () => {
    const command = startCommandOf({ ...args, model: null, workingDir: '  ' });
    expect(command.model).toBeUndefined();
    expect(command.workingDir).toBeUndefined();
  });

  it('trims the working dir', () => {
    expect(startCommandOf({ ...args, workingDir: ' /p ' }).workingDir).toBe('/p');
  });

  it('passes allowNewMachine through', () => {
    expect(startCommandOf({ ...args, allowNewMachine: true }).allowNewMachine).toBe(true);
  });
});

describe('isRehomeNeeded', () => {
  it('is false without a team binding', () => {
    expect(isRehomeNeeded(undefined, 'b')).toBe(false);
    expect(isRehomeNeeded(null, 'b')).toBe(false);
  });

  it('is false when the selected machine is the bound one', () => {
    expect(isRehomeNeeded('a', 'a')).toBe(false);
  });

  it('is true when the selected machine differs from the binding', () => {
    expect(isRehomeNeeded('a', 'b')).toBe(true);
  });
});

describe('restartModelFor', () => {
  it('uses the running agent model', () => {
    expect(restartModelFor(mkConfig({ model: 'm2' }), 'm1')).toBe('m2');
  });

  it('falls back to the selected model when the running agent has none', () => {
    expect(restartModelFor(mkConfig(), 'm1')).toBe('m1');
  });

  it('is null when neither has a model', () => {
    expect(restartModelFor(mkConfig(), null)).toBeNull();
  });
});

describe('saveScopeOf', () => {
  it('is null when saving is not allowed', () => {
    expect(saveScopeOf(false, 'ws-1', 'a')).toBeNull();
  });

  it('is null without a workspace or a machine', () => {
    expect(saveScopeOf(true, undefined, 'a')).toBeNull();
    expect(saveScopeOf(true, 'ws-1', null)).toBeNull();
  });

  it('returns the workspace and machine when saving is allowed', () => {
    expect(saveScopeOf(true, 'ws-1', 'a')).toEqual({ workspaceId: 'ws-1', machineId: 'a' });
  });
});

describe('saveChoiceOf', () => {
  it('is null without a harness or a model', () => {
    expect(saveChoiceOf(null, 'm1')).toBeNull();
    expect(saveChoiceOf('cursor', null)).toBeNull();
  });

  it('returns the harness and model when both are chosen', () => {
    expect(saveChoiceOf('cursor', 'm1')).toEqual({ harness: 'cursor', model: 'm1' });
  });
});

describe('workspaceField', () => {
  it('is empty without a workspace id', () => {
    expect(workspaceField(undefined)).toEqual({});
  });

  it('carries the workspace id when there is one', () => {
    expect(workspaceField('ws-1')).toEqual({ workspaceId: 'ws-1' });
  });
});
