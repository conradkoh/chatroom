import { act, render, renderHook, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RemoteTabContent, useAgentControls } from './AgentControls';
import type { AgentConfig, MachineInfo, SendCommandFn } from '../types/machine';

vi.mock('../workspace/hooks/useChatroomWorkspaces', () => ({
  useChatroomWorkspaces: () => ({
    workspaces: [],
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
    availableModels: { cursor: ['openai/gpt-4o', 'anthropic/claude-sonnet-4'] },
    isLoading: false,
  }),
}));

const mockUseIsDesktop = vi.fn(() => true);
vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
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

function ModelPickerHarness({ ephemeral = false }: { ephemeral?: boolean }) {
  const machines = [mkMachine()];
  // Seeding config matching the machine so initialization picks machine-a + cursor
  const seedingConfig: AgentConfig = {
    machineId: 'machine-a',
    hostname: 'host-a',
    role: 'builder',
    agentType: 'cursor',
    workingDir: '/workspace',
    availableHarnesses: ['cursor'],
    updatedAt: Date.now(),
  };
  const controls = useAgentControls({
    role: 'builder',
    chatroomId: 'jd7testchatroom0000000000000001' as Id<'chatroom_rooms'>,
    workspaceId: 'workspace-1',
    isEphemeral: ephemeral,
    connectedMachines: machines,
    agentConfigs: [seedingConfig],
    sendCommand: vi.fn().mockResolvedValue(undefined) as unknown as SendCommandFn,
    teamConfigHarness: 'cursor',
    teamConfigMachineId: 'machine-a',
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

describe('AgentControls model picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders popover on desktop when model trigger clicked', async () => {
    mockUseIsDesktop.mockReturnValue(true);
    render(<ModelPickerHarness />);
    // Wait for initialization + isClient effects to settle
    await waitFor(() => {
      expect(screen.getByTitle('Select model')).toBeInTheDocument();
    });
    await act(async () => {});
    fireEvent.click(screen.getByTitle('Select model'));
    await waitFor(() => {
      expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull();
    });
    expect(document.querySelector('[data-slot="drawer-content"]')).toBeNull();
  });

  it.each([false, true])(
    'hydrates the offline %s role form from its last configuration',
    async (ephemeral) => {
      const { result, rerender } = renderHook(
        ({ configurationLoading }) =>
          useAgentControls({
            role: ephemeral ? 'architect' : 'builder',
            chatroomId: 'jd7testchatroom0000000000000001' as Id<'chatroom_rooms'>,
            workspaceId: 'workspace-1',
            isEphemeral: ephemeral,
            connectedMachines: [mkMachine()],
            agentConfigs: [
              {
                machineId: 'machine-a',
                hostname: 'host-a',
                role: ephemeral ? 'architect' : 'builder',
                agentType: 'cursor',
                workingDir: '/workspace',
                model: 'openai/gpt-4o',
                availableHarnesses: ['cursor'],
                updatedAt: 123,
              },
            ],
            sendCommand: vi.fn().mockResolvedValue(undefined) as unknown as SendCommandFn,
            configurationLoading,
          }),
        { initialProps: { configurationLoading: true } }
      );

      expect(result.current.selectedMachineId).toBeNull();
      rerender({ configurationLoading: false });

      await waitFor(() => {
        expect(result.current.selectedMachineId).toBe('machine-a');
        expect(result.current.selectedHarness).toBe('cursor');
        expect(result.current.workingDir).toBe('/workspace');
      });
    }
  );

  it('shows a save action for an offline ephemeral role', async () => {
    render(<ModelPickerHarness ephemeral />);

    expect(await screen.findByRole('button', { name: 'Save Configuration' })).toBeInTheDocument();
    expect(screen.queryByTitle('Start Agent')).not.toBeInTheDocument();
  });

  it('renders drawer on mobile when model trigger clicked', async () => {
    mockUseIsDesktop.mockReturnValue(false);
    render(<ModelPickerHarness />);
    await waitFor(() => {
      expect(screen.getByTitle('Select model')).toBeInTheDocument();
    });
    await act(async () => {});
    fireEvent.click(screen.getByTitle('Select model'));
    await waitFor(() => {
      expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull();
    });
  });
});
