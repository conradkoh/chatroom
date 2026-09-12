import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentControlDataProvider } from './AgentControlDataContext';
import { InlineAgentCard } from './InlineAgentCard';

vi.mock('../../workspace/hooks/useChatroomWorkspaces', () => ({
  useChatroomWorkspaces: () => ({ workspaces: [], isLoading: false, removeWorkspace: vi.fn() }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => vi.fn(),
  useSessionQuery: () => null,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    agentWorkspaces: {
      getAgentConfigForWorkspaceRole: 'skip',
      getAgentStatusForWorkspaceRole: 'skip',
    },
    machines: { getAgentRestartSummaryByRole: 'skip' },
  },
}));

vi.mock('../AgentControls', () => ({
  useAgentControls: () => ({
    selectedHarness: null,
    selectedModel: null,
    selectedMachineId: null,
    selectedWorkingDir: null,
    isStarting: false,
    isStopping: false,
    handleStart: vi.fn(),
    handleStop: vi.fn(),
    setSelectedHarness: vi.fn(),
    setSelectedModel: vi.fn(),
    setSelectedMachineId: vi.fn(),
    setSelectedWorkingDir: vi.fn(),
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
  statusLabel: 'WORKING',
  statusVariant: 'working' as const,
  prompt: '',
  chatroomId: 'jd7testchatroom0000000000000001',
  restartSummary: null,
};

function renderCard() {
  return render(
    <AgentControlDataProvider
      value={{
        machines: [],
        daemonConnectivity: new Map(),
        isLoadingMachines: false,
        agentConfigs: [],
        sendCommand: vi.fn(),
      }}
    >
      <InlineAgentCard {...baseProps} />
    </AgentControlDataProvider>
  );
}

describe('InlineAgentCard header layout', () => {
  it('renders status and last seen in header', () => {
    renderCard();
    expect(screen.getByText('builder')).toBeTruthy();
    expect(screen.getByText(/ago/)).toBeTruthy();
  });

  it('does not render duplicate model line below controls', () => {
    renderCard();
    expect(screen.queryByText('big-pickle')).toBeNull();
  });
});
