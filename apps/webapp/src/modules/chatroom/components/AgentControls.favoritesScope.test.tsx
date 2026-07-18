import { render, waitFor } from '@testing-library/react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RemoteTabContent, useAgentControls } from './AgentControls';
import type { AgentConfig, MachineInfo, SendCommandFn } from '../types/machine';

const mockUseSessionQuery = vi.fn();

vi.mock('../workspace/hooks/useChatroomWorkspaces', () => ({
  useChatroomWorkspaces: () => ({
    workspaces: [
      {
        machineId: 'machine-a',
        workingDir: '/code',
        id: 'machine-a::/code',
        hostname: 'dev',
        machineAlias: undefined,
        agentRoles: [],
        _registryId: 'r1',
      },
    ],
    isLoading: false,
    removeWorkspace: vi.fn(),
  }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => vi.fn().mockResolvedValue(undefined),
  useSessionQuery: (query: unknown, args: unknown) => {
    mockUseSessionQuery(query, args);
    if (query === 'machineConfigFavorites:getMachineConfigFavorites' && args !== 'skip') {
      return { favorites: [] };
    }
    return undefined;
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    machineConfigFavorites: {
      getMachineConfigFavorites: 'machineConfigFavorites:getMachineConfigFavorites',
      setMachineConfigFavorites: 'machineConfigFavorites:setMachineConfigFavorites',
    },
    machines: {
      getMachineModels: 'machines:getMachineModels',
      getMachineModelFilters: 'machines:getMachineModelFilters',
      upsertMachineModelFilters: 'machines:upsertMachineModelFilters',
      requestCapabilitiesRefresh: 'machines:requestCapabilitiesRefresh',
      getCapabilitiesRefreshBatch: 'machines:getCapabilitiesRefreshBatch',
      setWantResume: 'machines:setWantResume',
    },
  },
}));

vi.mock('../../../hooks/useMachineModels', () => ({
  useMachineModels: () => ({
    availableModels: {
      'opencode-sdk': ['opencode/big-pickle'],
    },
    isLoading: false,
  }),
}));

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const CHATROOM_ID = 'n576raxak4gfqyr503d22dmf718a9p4w';

function mkMachine(id: string, hostname: string): MachineInfo {
  return {
    machineId: id,
    hostname,
    os: 'darwin',
    availableHarnesses: ['opencode-sdk'],
    harnessVersions: {},
  };
}

function FavoritesScopeHarness() {
  const machines = [mkMachine('machine-a', 'host-a')];
  const roleConfig: AgentConfig = {
    role: 'planner',
    machineId: 'machine-a',
    hostname: 'host-a',
    agentType: 'opencode-sdk',
    model: 'opencode/big-pickle',
    workingDir: '/code',
    availableHarnesses: ['opencode-sdk'],
    updatedAt: Date.now(),
  };
  const controls = useAgentControls({
    role: 'planner',
    chatroomId: CHATROOM_ID as Id<'chatroom_rooms'>,
    connectedMachines: machines,
    agentConfigs: [roleConfig],
    sendCommand: vi.fn().mockResolvedValue(undefined) as unknown as SendCommandFn,
    teamConfigHarness: 'opencode-sdk',
    teamConfigMachineId: 'machine-a',
    teamId: 'duo',
  });

  return (
    <RemoteTabContent
      controls={controls}
      connectedMachines={machines}
      isLoadingMachines={false}
      daemonStartCommand="chatroom daemon"
      chatroomId={CHATROOM_ID}
      role="planner"
    />
  );
}

describe('AgentControls favorites scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries machine config favorites with teamRoleKey for the active role', async () => {
    render(<FavoritesScopeHarness />);

    await waitFor(() => {
      expect(mockUseSessionQuery).toHaveBeenCalledWith(
        'machineConfigFavorites:getMachineConfigFavorites',
        {
          machineId: 'machine-a',
          teamRoleKey: 'team_duo#role_planner',
        }
      );
    });
  });
});
