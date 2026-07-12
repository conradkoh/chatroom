import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      getMachineModels: 'machines:getMachineModels',
      getMachineModelFilters: 'machines:getMachineModelFilters',
      upsertMachineModelFilters: 'machines:upsertMachineModelFilters',
      requestCapabilitiesRefresh: 'machines:requestCapabilitiesRefresh',
      getCapabilitiesRefreshBatch: 'machines:getCapabilitiesRefreshBatch',
    },
  },
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

function mkMachine(id: string, hostname: string): MachineInfo {
  return {
    machineId: id,
    hostname,
    os: 'linux',
    availableHarnesses: ['cursor'],
    harnessVersions: {},
  };
}

function RehomeHarness({
  sendCommand = vi.fn().mockResolvedValue(undefined) as unknown as SendCommandFn,
}: {
  sendCommand?: SendCommandFn;
}) {
  const machines = [mkMachine('a', 'host-a'), mkMachine('b', 'host-b')];
  // "Last used" config lives on machine 'b' (persisted teamAgentConfig), while the
  // team-config binding points at machine 'a' — so seeding picks 'b' and starting
  // triggers a re-home from 'a' → 'b'.
  const lastUsed: AgentConfig = {
    machineId: 'b',
    hostname: 'host-b',
    role: 'builder',
    agentType: 'cursor',
    workingDir: '/workspace',
    model: 'openai/gpt-4o',
    availableHarnesses: ['cursor'],
    updatedAt: Date.now(),
  };
  const controls = useAgentControls({
    role: 'builder',
    chatroomId: 'jd7testchatroom0000000000000001' as Id<'chatroom_rooms'>,
    connectedMachines: machines,
    agentConfigs: [lastUsed],
    sendCommand,
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

describe('AgentControls re-home', () => {
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
