import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
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

function ModelPickerHarness() {
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
      expect(document.querySelector('[data-slot="chatroom-popover-content"]')).not.toBeNull();
    });
    expect(document.querySelector('[data-slot="drawer-content"]')).toBeNull();
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
