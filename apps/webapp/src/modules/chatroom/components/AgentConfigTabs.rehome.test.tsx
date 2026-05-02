import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';


import { RemoteTabContent, useAgentControls, type AgentPreference } from './AgentConfigTabs';
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
      {
        machineId: 'b',
        workingDir: '/wb',
        id: 'b::/wb',
        hostname: '',
        machineAlias: undefined,
        agentRoles: [],
        _registryId: 'r2',
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
    availableModels: { cursor: ['openai/gpt-4o'] },
    daemonConnected: true,
    lastSeenAt: 0,
  };
}

function RehomeHarness({
  sendCommand = vi.fn().mockResolvedValue(undefined) as unknown as SendCommandFn,
}: {
  sendCommand?: SendCommandFn;
}) {
  const machines = [mkMachine('a', 'host-a'), mkMachine('b', 'host-b')];
  const pref: AgentPreference = {
    role: 'builder',
    machineId: 'b',
    agentHarness: 'cursor',
    workingDir: '/workspace',
    model: 'openai/gpt-4o',
  };
  const controls = useAgentControls({
    role: 'builder',
    chatroomId: 'jd7testchatroom0000000000000001' as Id<'chatroom_rooms'>,
    connectedMachines: machines,
    agentConfigs: [] as AgentConfig[],
    sendCommand,
    teamConfigHarness: 'cursor',
    teamConfigMachineId: 'a',
    agentPreference: pref,
  });
  return (
    <RemoteTabContent
      controls={controls}
      connectedMachines={machines}
      isLoadingMachines={false}
      daemonStartCommand="chatroom daemon"
      chatroomId="jd7testchatroom0000000000000001"
    />
  );
}

describe('AgentConfigTabs re-home', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows confirmation and forwards allowNewMachine on re-home start', async () => {
    const sendCommand = vi.fn().mockResolvedValue(undefined) as unknown as SendCommandFn;
    const user = userEvent.setup();
    render(<RehomeHarness sendCommand={sendCommand} />);

    const start = await waitFor(() => screen.getByTitle('Start Agent'));
    await waitFor(() => expect(start).not.toBeDisabled());
    await user.click(start);

    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(/Starting this agent will move the role from/i)
    ).toBeInTheDocument();
    expect(within(dialog).getByText('host-a')).toBeInTheDocument();
    expect(within(dialog).getByText('host-b')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(1));
    expect(sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        machineId: 'b',
        type: 'start-agent',
        payload: expect.objectContaining({
          allowNewMachine: true,
        }),
      })
    );
  });
});
