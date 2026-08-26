import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentPanel } from '../AgentPanel';

const mockUseAgentStatuses = vi.fn();

vi.mock('../../hooks/useAgentStatuses', () => ({
  useAgentStatuses: (...args: unknown[]) => mockUseAgentStatuses(...args),
}));
vi.mock('./RemoteAgentQuickActions', () => ({
  RemoteAgentQuickActions: () => <div data-testid="quick-actions" />,
}));
vi.mock('./TeamSelectorDropdown', () => ({
  TeamSelectorDropdown: () => <div data-testid="team-selector" />,
}));
vi.mock('./UnifiedAgentListModal', () => ({
  UnifiedAgentListModal: () => null,
}));

const lifecycle = {
  teamId: 'duo',
  teamName: 'Duo',
  expectedRoles: ['planner', 'enhancer', 'builder'],
  participants: [],
  hasHistory: false,
};

beforeEach(() => {
  mockUseAgentStatuses.mockReturnValue({
    agents: ['planner', 'enhancer', 'builder'].map((role) => ({
      role,
      online: false,
      statusLabel: 'OFFLINE',
      statusVariant: 'offline',
      lastSeenAt: null,
      isWorking: false,
      latestEventType: null,
    })),
    isLoading: false,
  });
});

describe('AgentPanel', () => {
  it('renders permanent agents before the ephemeral section', () => {
    render(
      <AgentPanel
        chatroomId="room1"
        teamRoles={['planner', 'enhancer', 'builder']}
        lifecycle={lifecycle}
        teamName="Duo"
        teamId="duo"
        defaultTeamId="duo"
        teams={[]}
        onTeamChange={vi.fn()}
      />
    );

    expect(screen.getByText('Ephemeral')).toBeInTheDocument();
    const planner = screen.getByLabelText(/planner:/i);
    const builder = screen.getByLabelText(/builder:/i);
    const enhancer = screen.getByLabelText(/enhancer:/i);
    expect(
      planner.compareDocumentPosition(builder) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      builder.compareDocumentPosition(enhancer) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('omits the ephemeral section when no ephemeral roles exist', () => {
    render(
      <AgentPanel
        chatroomId="room1"
        teamRoles={['planner', 'builder']}
        lifecycle={{ ...lifecycle, expectedRoles: ['planner', 'builder'] }}
      />
    );

    expect(screen.queryByText('Ephemeral')).not.toBeInTheDocument();
  });
});
