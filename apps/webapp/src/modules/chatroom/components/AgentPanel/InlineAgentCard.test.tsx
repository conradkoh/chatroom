import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InlineAgentCard } from './InlineAgentCard';

vi.mock('../../workspace/hooks/useChatroomWorkspaces', () => ({
  useChatroomWorkspaces: () => ({ workspaces: [], isLoading: false, removeWorkspace: vi.fn() }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => vi.fn(),
  useSessionQuery: () => null,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: { machines: { getAgentRestartSummaryByRole: 'skip' } },
}));

vi.mock('../AgentControls', () => ({
  useAgentControls: () => ({
    selectedHarness: null,
    selectedModel: null,
    selectedMachineId: null,
    selectedWorkingDir: null,
    wantResume: false,
    isStarting: false,
    isStopping: false,
    handleStart: vi.fn(),
    handleStop: vi.fn(),
    setSelectedHarness: vi.fn(),
    setSelectedModel: vi.fn(),
    setSelectedMachineId: vi.fn(),
    setSelectedWorkingDir: vi.fn(),
    setWantResume: vi.fn(),
  }),
  RemoteTabContent: () => <div data-testid="remote-tab">Remote</div>,
  CustomTabContent: () => null,
}));

vi.mock('./AgentControlsSection', () => ({
  AgentControlsSection: () => <div data-testid="controls-section" />,
}));

const baseProps = {
  role: 'builder',
  allRoles: ['builder'],
  online: true,
  lastSeenAt: Date.now() - 120_000,
  latestEventType: 'agent.working',
  desiredState: 'running',
  prompt: '',
  chatroomId: 'jd7testchatroom0000000000000001',
  connectedMachines: [],
  isLoadingMachines: false,
  agentConfigs: [],
  sendCommand: vi.fn(),
  agentRoleView: {
    type: 'remote' as const,
    role: 'builder',
    state: 'running' as const,
    model: 'big-pickle',
    agentHarness: 'cursor-sdk' as const,
  },
  restartSummary: null,
};

describe('InlineAgentCard header layout', () => {
  it('renders status and last seen in header', () => {
    render(<InlineAgentCard {...baseProps} />);
    expect(screen.getByText('builder')).toBeTruthy();
    expect(screen.getByText(/ago/)).toBeTruthy();
  });

  it('does not render duplicate model line below controls', () => {
    render(<InlineAgentCard {...baseProps} />);
    expect(screen.queryByText('big-pickle')).toBeNull();
  });
});
