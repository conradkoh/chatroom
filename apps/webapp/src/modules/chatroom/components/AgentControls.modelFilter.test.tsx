import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RemoteTabContent, useAgentControls } from './AgentControls';
import type { AgentConfig, MachineInfo, SendCommandFn } from '../types/machine';

vi.mock('../workspace/hooks/useChatroomWorkspaces', () => ({
  useChatroomWorkspaces: () => ({
    workspaces: [
      {
        machineId: 'a',
        workingDir: '/wa',
        id: 'a::/wa',
        hostname: '',
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
  useSessionQuery: () => undefined,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    machines: {
      getMachineModels: 'machines:getMachineModels',
      getMachineModelFilters: 'machines:getMachineModelFilters',
      upsertMachineModelFilters: 'machines:upsertMachineModelFilters',
      requestCapabilitiesRefresh: 'machines:requestCapabilitiesRefresh',
      getCapabilitiesRefreshBatch: 'machines:getCapabilitiesRefreshBatch',
    },
  },
}));

function mkMachine(id: string, hostname: string): MachineInfo {
  return {
    machineId: id,
    hostname,
    os: 'linux',
    availableHarnesses: ['cursor'],
    harnessVersions: {},
  };
}

function RunningModelFilterHarness({ runningAgentConfig }: { runningAgentConfig?: AgentConfig }) {
  const machines = [mkMachine('a', 'host-a')];
  const controls = useAgentControls({
    role: 'builder',
    chatroomId: 'jd7testchatroom0000000000000001' as Id<'chatroom_rooms'>,
    connectedMachines: machines,
    agentConfigs: runningAgentConfig ? [runningAgentConfig] : [],
    sendCommand: vi.fn().mockResolvedValue(undefined) as unknown as SendCommandFn,
    teamConfigHarness: 'cursor',
    teamConfigMachineId: 'a',
  });
  return (
    <RemoteTabContent
      controls={controls}
      connectedMachines={machines}
      isLoadingMachines={false}
      daemonStartCommand="chatroom daemon"
      chatroomId="jd7testchatroom0000000000000001"
      role="builder"
    />
  );
}

describe('ModelFilter visibility while agent is running', () => {
  it('renders the model filter trigger when an agent is running', async () => {
    render(
      <RunningModelFilterHarness
        runningAgentConfig={{
          machineId: 'a',
          hostname: 'host-a',
          role: 'builder',
          agentType: 'cursor',
          workingDir: '/workspace',
          model: 'openai/gpt-4o',
          spawnedAgentPid: 12345,
          availableHarnesses: ['cursor'],
          updatedAt: Date.now(),
        }}
      />
    );

    const filterBtn = await waitFor(() => screen.getByTitle('Filter models'));
    expect(filterBtn).toBeInTheDocument();
  });

  it('the filter button is clickable when agent is running', async () => {
    const user = userEvent.setup();
    render(
      <RunningModelFilterHarness
        runningAgentConfig={{
          machineId: 'a',
          hostname: 'host-a',
          role: 'builder',
          agentType: 'cursor',
          workingDir: '/workspace',
          model: 'openai/gpt-4o',
          spawnedAgentPid: 12345,
          availableHarnesses: ['cursor'],
          updatedAt: Date.now(),
        }}
      />
    );

    const filterBtn = await waitFor(() => screen.getByTitle('Filter models'));
    // Clicking should not throw — triggers the filter panel
    await expect(user.click(filterBtn)).resolves.not.toThrow();
  });
});
