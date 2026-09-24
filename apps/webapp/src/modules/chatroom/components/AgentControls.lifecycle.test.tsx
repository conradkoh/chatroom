import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RemoteTabContent, useAgentControls } from './AgentControls';
import type { AgentConfig, MachineInfo, SendCommandFn } from '../types/machine';

const mockRequestStop = vi.fn().mockResolvedValue(undefined);

vi.mock('../workspace/hooks/useChatroomWorkspaces', () => ({
  useChatroomWorkspaces: () => ({
    workspaces: [],
    isLoading: false,
    removeWorkspace: vi.fn(),
  }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mockRequestStop,
  useSessionQuery: () => undefined,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    agents: {
      requestStop: 'agents:requestStop',
      requestStopAll: 'agents:requestStopAll',
      saveConfig: 'agents:saveConfig',
    },
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
    },
  },
}));

vi.mock('../../../hooks/useMachineModels', () => ({
  useMachineModels: () => ({
    availableModels: { cursor: ['openai/gpt-4o'] },
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => true,
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

function mkMachine(): MachineInfo {
  return {
    machineId: 'machine-a',
    hostname: 'host-a',
    os: 'linux',
    availableHarnesses: ['cursor'],
    harnessVersions: {},
  };
}

function LifecycleHarness({
  runtimeIsRunning,
  sendCommand = vi.fn().mockResolvedValue(undefined) as unknown as SendCommandFn,
}: {
  runtimeIsRunning: boolean;
  sendCommand?: SendCommandFn;
}) {
  const machines = [mkMachine()];
  const roleConfig: AgentConfig = {
    machineId: 'machine-a',
    hostname: 'host-a',
    role: 'architect',
    agentType: 'cursor',
    workingDir: '/workspace',
    model: 'openai/gpt-4o',
    availableHarnesses: ['cursor'],
    updatedAt: Date.now(),
  };
  const controls = useAgentControls({
    role: 'architect',
    chatroomId: 'jd7testchatroom0000000000000001' as Id<'chatroom_rooms'>,
    connectedMachines: machines,
    agentConfigs: [roleConfig],
    sendCommand,
    teamConfigHarness: 'cursor',
    teamConfigMachineId: 'machine-a',
    runtimeIsRunning,
  });
  return (
    <RemoteTabContent
      controls={controls}
      connectedMachines={machines}
      isLoadingMachines={false}
      daemonStartCommand="chatroom daemon"
      chatroomId="jd7testchatroom0000000000000001"
      role="architect"
    />
  );
}

describe('AgentControls lifecycle for ephemeral-tagged roles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes Start for a stopped configured role', async () => {
    const sendCommand = vi.fn().mockResolvedValue(undefined) as unknown as SendCommandFn;
    const user = userEvent.setup();
    render(<LifecycleHarness runtimeIsRunning={false} sendCommand={sendCommand} />);

    const start = await waitFor(() => screen.getByRole('button', { name: 'Start Agent' }));
    expect(start).not.toBeDisabled();
    await user.click(start);

    await waitFor(() =>
      expect(sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          machineId: 'machine-a',
          type: 'start-agent',
          payload: expect.objectContaining({ role: 'architect' }),
        })
      )
    );
  });

  it('exposes Stop and Restart for a running role', async () => {
    const sendCommand = vi.fn().mockResolvedValue(undefined) as unknown as SendCommandFn;
    const user = userEvent.setup();
    render(<LifecycleHarness runtimeIsRunning sendCommand={sendCommand} />);

    const stop = await waitFor(() => screen.getByRole('button', { name: 'Stop Agent' }));
    const restart = screen.getByRole('button', { name: 'Restart Agent' });
    expect(stop).not.toBeDisabled();
    expect(restart).not.toBeDisabled();

    await user.click(stop);
    await waitFor(() =>
      expect(mockRequestStop).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'architect',
          machineId: 'machine-a',
        })
      )
    );

    await user.click(restart);
    await waitFor(() =>
      expect(sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          machineId: 'machine-a',
          type: 'restart-agent',
          payload: expect.objectContaining({ role: 'architect' }),
        })
      )
    );
  });
});
