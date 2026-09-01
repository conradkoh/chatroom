import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RemoteTabContent, useAgentControls } from './AgentControls';
import type {
  AgentConfig,
  CodexMaxReasoningLevel,
  MachineInfo,
  SendCommandFn,
} from '../types/machine';

vi.mock('../workspace/hooks/useChatroomWorkspaces', () => ({
  useChatroomWorkspaces: () => ({
    workspaces: [],
    isLoading: false,
    removeWorkspace: vi.fn(),
  }),
}));

vi.mock('../hooks/useAgentStop', () => ({
  isActiveAgentStopState: () => false,
  useAgentStop: () => ({ requestAgentStop: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => vi.fn().mockResolvedValue(undefined),
  useSessionQuery: () => undefined,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    agentStops: {
      requestAgent: 'agentStops:requestAgent',
      requestChatroom: 'agentStops:requestChatroom',
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
    availableModels: {
      cursor: ['openai/gpt-4o'],
      'codex-sdk': ['openai/codex-model'],
    },
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

const chatroomId = 'jd7testchatroom0000000000000001' as Id<'chatroom_rooms'>;

function mkCodexMachine(): MachineInfo {
  return {
    machineId: 'machine-a',
    hostname: 'host-a',
    os: 'linux',
    availableHarnesses: ['codex-sdk'],
    harnessVersions: {},
  };
}

function mkCodexConfig(maxReasoningLevel?: CodexMaxReasoningLevel): AgentConfig {
  return {
    machineId: 'machine-a',
    hostname: 'host-a',
    role: 'builder',
    agentType: 'codex-sdk',
    model: 'openai/codex-model',
    workingDir: '/workspace',
    availableHarnesses: ['codex-sdk'],
    updatedAt: Date.now(),
    ...(maxReasoningLevel ? { maxReasoningLevel } : {}),
  };
}

function CodexControlsHarness({
  sendCommand,
  maxReasoningLevel,
}: {
  sendCommand: SendCommandFn;
  maxReasoningLevel?: CodexMaxReasoningLevel;
}) {
  const machines = [mkCodexMachine()];
  const controls = useAgentControls({
    role: 'builder',
    chatroomId,
    connectedMachines: machines,
    agentConfigs: [mkCodexConfig(maxReasoningLevel)],
    sendCommand,
    teamConfigHarness: 'codex-sdk',
    teamConfigMachineId: 'machine-a',
    teamConfigModel: 'openai/codex-model',
    teamConfigMaxReasoningLevel: maxReasoningLevel,
  });
  return (
    <RemoteTabContent
      controls={controls}
      connectedMachines={machines}
      isLoadingMachines={false}
      daemonStartCommand="chatroom daemon"
      chatroomId={chatroomId}
      role="builder"
    />
  );
}

function CursorControlsHarness({ sendCommand }: { sendCommand: SendCommandFn }) {
  const machines: MachineInfo[] = [
    {
      machineId: 'machine-a',
      hostname: 'host-a',
      os: 'linux',
      availableHarnesses: ['cursor'],
      harnessVersions: {},
    },
  ];
  const controls = useAgentControls({
    role: 'builder',
    chatroomId,
    connectedMachines: machines,
    agentConfigs: [
      {
        machineId: 'machine-a',
        hostname: 'host-a',
        role: 'builder',
        agentType: 'cursor',
        model: 'openai/gpt-4o',
        workingDir: '/workspace',
        availableHarnesses: ['cursor'],
        updatedAt: Date.now(),
      },
    ],
    sendCommand,
    teamConfigHarness: 'cursor',
    teamConfigMachineId: 'machine-a',
  });
  return (
    <RemoteTabContent
      controls={controls}
      connectedMachines={machines}
      isLoadingMachines={false}
      daemonStartCommand="chatroom daemon"
      chatroomId={chatroomId}
      role="builder"
    />
  );
}

describe('AgentControls max reasoning level', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsDesktop.mockReturnValue(true);
  });

  it('renders Not set for codex-sdk without persisted cap and sends selected cap on start', async () => {
    const sendCommand = vi.fn().mockResolvedValue(undefined) as unknown as SendCommandFn;
    render(<CodexControlsHarness sendCommand={sendCommand} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Max reasoning level')).toBeInTheDocument();
    });
    await act(async () => {});

    const selector = screen.getByLabelText('Max reasoning level') as HTMLSelectElement;
    expect(selector.value).toBe('');
    expect(screen.getByRole('option', { name: 'Not set' })).toBeInTheDocument();

    fireEvent.change(selector, { target: { value: 'high' } });
    expect(selector.value).toBe('high');

    fireEvent.click(screen.getByTitle('Start Agent'));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith({
        machineId: 'machine-a',
        type: 'start-agent',
        payload: {
          chatroomId,
          role: 'builder',
          agentHarness: 'codex-sdk',
          model: 'openai/codex-model',
          workingDir: '/workspace',
          maxReasoningLevel: 'high',
        },
      });
    });
  });

  it('initializes persisted medium and sends xhigh on start', async () => {
    const sendCommand = vi.fn().mockResolvedValue(undefined) as unknown as SendCommandFn;
    render(<CodexControlsHarness sendCommand={sendCommand} maxReasoningLevel="medium" />);

    await waitFor(() => {
      expect(screen.getByLabelText('Max reasoning level')).toBeInTheDocument();
    });
    await act(async () => {});

    const selector = screen.getByLabelText('Max reasoning level') as HTMLSelectElement;
    expect(selector.value).toBe('medium');

    fireEvent.change(selector, { target: { value: 'xhigh' } });
    fireEvent.click(screen.getByTitle('Start Agent'));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith({
        machineId: 'machine-a',
        type: 'start-agent',
        payload: {
          chatroomId,
          role: 'builder',
          agentHarness: 'codex-sdk',
          model: 'openai/codex-model',
          workingDir: '/workspace',
          maxReasoningLevel: 'xhigh',
        },
      });
    });
  });

  it('does not render max reasoning selector for non-codex harness', async () => {
    const sendCommand = vi.fn().mockResolvedValue(undefined) as unknown as SendCommandFn;
    render(<CursorControlsHarness sendCommand={sendCommand} />);

    await waitFor(() => {
      expect(screen.getByTitle('Select model')).toBeInTheDocument();
    });
    await act(async () => {});

    expect(screen.queryByLabelText('Max reasoning level')).not.toBeInTheDocument();
  });
});
