import { fireEvent, render, screen, within } from '@testing-library/react';
import { AgentRoleLifecycleTag } from '@workspace/shared/domain/agent-role';
import { getTeamStructure } from '@workspace/shared/domain/team-presets';
import { describe, expect, it, vi } from 'vitest';

import type { AgentRoleStatusReadModel } from '../../hooks/useAgentPanelData';
import type { AgentConfig } from '../../types/machine';
import { AgentPanel } from '../AgentPanel';

vi.mock('./RemoteAgentQuickActions', () => ({
  RemoteAgentQuickActions: () => <div data-testid="quick-actions" />,
}));
vi.mock('./CommandQueuePanel', () => ({
  CommandQueuePanel: () => <div data-testid="command-queue-panel" />,
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
  expectedRoles: getTeamStructure({ teamId: 'duo' }).roles.map(({ role }) => role),
  participants: [],
  hasHistory: false,
};

const duoStructure = getTeamStructure({ teamId: 'duo' });
const pinnedTeamFacts = [
  {
    teamId: 'duo',
    permanentRoles: ['planner', 'builder'],
    ephemeralRoles: ['architect', 'triage', 'uiux-engineer'],
  },
  {
    teamId: 'solo',
    permanentRoles: ['solo'],
    ephemeralRoles: ['architect', 'triage', 'uiux-engineer'],
  },
] as const;

const panelProps = {
  chatroomId: 'room1',
  machineId: null,
  lifecycle,
  statusReadModel: [],
  teamName: undefined,
  teamId: undefined,
  defaultTeamId: undefined,
  teams: undefined,
  onTeamChange: undefined,
  agentConfigs: [],
  onOpenAgents: undefined,
  hasRunningRemoteAgents: false,
  canStopRemoteAgents: false,
  onStartAllRemoteAgents: undefined,
  onStopAllRemoteAgents: undefined,
  onRestartAllRemoteAgents: undefined,
  isStoppingAgents: false,
  isStartingAllAgents: false,
};

describe('AgentPanel', () => {
  it('keeps the team selector available when no team is currently assigned', () => {
    render(
      <AgentPanel
        {...panelProps}
        lifecycle={null}
        teamStructure={null}
        defaultTeamId="duo"
        teams={[
          {
            id: 'duo',
            name: 'Duo',
            description: '',
            roles: ['planner', 'builder'],
            entryPoint: 'planner',
          },
        ]}
        onTeamChange={async () => {}}
      />
    );

    expect(screen.getByTestId('team-selector')).toBeInTheDocument();
    expect(screen.getByText('No team configured')).toBeInTheDocument();
  });

  it.each(pinnedTeamFacts)(
    'renders each canonical $teamId role once with offline state and grouped order',
    ({ teamId, permanentRoles, ephemeralRoles }) => {
      const structure = getTeamStructure({ teamId });
      const expectedOrder = [...permanentRoles, ...ephemeralRoles];
      const { container } = render(
        <AgentPanel
          {...panelProps}
          lifecycle={{
            ...lifecycle,
            teamId,
            teamName: teamId === 'duo' ? 'Duo' : 'Solo',
            expectedRoles: expectedOrder,
          }}
          teamStructure={structure}
        />
      );

      expect(structure.roles.map(({ role }) => role)).toEqual(
        getTeamStructure({ teamId }).roles.map(({ role }) => role)
      );
      expect(screen.getByText(`Agents (${expectedOrder.length})`)).toBeInTheDocument();
      expect(screen.getByText(`Ephemeral (${ephemeralRoles.length})`)).toBeInTheDocument();
      expect(screen.queryByText(/View More/)).not.toBeInTheDocument();

      const displayedRows = Array.from(
        container.querySelectorAll<HTMLElement>('[role="button"][aria-label]')
      );
      expect(displayedRows.map((row) => row.getAttribute('aria-label')?.split(':')[0])).toEqual(
        expectedOrder
      );
      for (const role of expectedOrder) {
        const row = screen.getAllByLabelText(new RegExp(`^${role}:`, 'i'));
        expect(row).toHaveLength(1);
        expect(row[0]).toHaveTextContent(/OFFLINE/i);
      }

      const ephemeralHeading = screen.getByText(`Ephemeral (${ephemeralRoles.length})`);
      const lastPermanentRow = screen.getByLabelText(new RegExp(`^${permanentRoles.at(-1)}:`, 'i'));
      const firstEphemeralRow = screen.getByLabelText(new RegExp(`^${ephemeralRoles[0]}:`, 'i'));
      expect(
        lastPermanentRow.compareDocumentPosition(ephemeralHeading) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        ephemeralHeading.compareDocumentPosition(firstEphemeralRow) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(screen.queryByLabelText(/enhancer:/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/triage.*config/i)).not.toBeInTheDocument();
    }
  );

  it('opens the agent settings callback from the triage row', () => {
    const onOpenAgents = vi.fn();
    render(<AgentPanel {...panelProps} teamStructure={duoStructure} onOpenAgents={onOpenAgents} />);
    const triage = screen.getByLabelText(/triage:/i);
    fireEvent.click(triage);
    fireEvent.keyDown(triage, { key: 'Enter' });
    fireEvent.keyDown(triage, { key: ' ' });
    expect(onOpenAgents).toHaveBeenCalledTimes(3);
  });

  it('keeps declared rows visible while status data is loading', () => {
    render(<AgentPanel {...panelProps} teamStructure={duoStructure} statusReadModel={undefined} />);

    expect(screen.getByText('Agents (5)')).toBeInTheDocument();
    expect(screen.getByText('Ephemeral (3)')).toBeInTheDocument();
    const triage = screen.getByLabelText(/triage: Loading/i);
    expect(triage).toBeInTheDocument();
    expect(within(triage).getByLabelText('Status: Loading...')).toBeInTheDocument();
  });

  it('keeps declared rows visible with an error status', () => {
    const errorStatus: AgentRoleStatusReadModel[] = [
      { role: 'triage', roleKind: 'ephemeral', status: 'error', projectedAt: Date.now() },
    ];
    render(
      <AgentPanel {...panelProps} teamStructure={duoStructure} statusReadModel={errorStatus} />
    );

    expect(screen.getByText('Agents (5)')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/triage:/i)).toHaveLength(1);
    expect(screen.getByLabelText(/triage:/i)).toHaveTextContent('OFFLINE (ERROR)');
    expect(screen.getByLabelText(/architect:/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/uiux-engineer:/i)).toBeInTheDocument();
  });

  it('shows the loading panel while the team structure is unresolved', () => {
    render(<AgentPanel {...panelProps} lifecycle={undefined} teamStructure={undefined} />);

    expect(screen.getByText('Agents (0)')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/triage:/i)).not.toBeInTheDocument();
  });

  it('keeps all ephemeral agents visible when permanent agents exceed the preview limit', () => {
    const expandedStructure = {
      ...duoStructure,
      roles: [
        { role: 'planner', lifecycle: AgentRoleLifecycleTag.Permanent, optional: false },
        { role: 'builder', lifecycle: AgentRoleLifecycleTag.Permanent, optional: false },
        { role: 'reviewer', lifecycle: AgentRoleLifecycleTag.Permanent, optional: false },
        { role: 'tester', lifecycle: AgentRoleLifecycleTag.Permanent, optional: false },
        { role: 'architect', lifecycle: AgentRoleLifecycleTag.Ephemeral, optional: true },
        { role: 'triage', lifecycle: AgentRoleLifecycleTag.Ephemeral, optional: true },
        { role: 'uiux-engineer', lifecycle: AgentRoleLifecycleTag.Ephemeral, optional: true },
      ],
    };

    render(<AgentPanel {...panelProps} teamStructure={expandedStructure} />);

    expect(screen.getByText('Agents (7)')).toBeInTheDocument();
    expect(screen.getByText('Ephemeral (3)')).toBeInTheDocument();
    expect(screen.getByLabelText(/planner:/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/builder:/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/reviewer:/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/tester:/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/architect:/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/triage:/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/uiux-engineer:/i)).toBeInTheDocument();
    expect(screen.getByText('View More (1 more items)')).toBeInTheDocument();
  });

  it('omits the ephemeral section when no ephemeral roles exist', () => {
    render(
      <AgentPanel
        {...panelProps}
        lifecycle={{ ...lifecycle, expectedRoles: ['planner', 'builder'] }}
        teamStructure={{
          ...duoStructure,
          roles: duoStructure.roles.filter(({ lifecycle }) => lifecycle === 'permanent'),
        }}
      />
    );

    expect(screen.queryByText(/Ephemeral/)).not.toBeInTheDocument();
  });

  it('renders normalized effort suffix from agent config model variant', () => {
    const plannerConfig: AgentConfig = {
      machineId: 'machine-1',
      hostname: 'test-host',
      role: 'planner',
      agentType: 'cursor-sdk',
      workingDir: '/Users/alice/chatroom',
      model: 'gpt-5.6-terra[reasoning=high]',
      availableHarnesses: ['cursor-sdk'],
      updatedAt: Date.now(),
    };

    render(
      <AgentPanel {...panelProps} teamStructure={duoStructure} agentConfigs={[plannerConfig]} />
    );

    expect(screen.getByText('gpt-5.6-terra [high]')).toBeInTheDocument();
  });

  it('shows the newest configuration snapshot for each role', () => {
    const baseConfig: AgentConfig = {
      machineId: 'machine-1',
      hostname: 'test-host',
      role: 'planner',
      agentType: 'cursor-sdk',
      workingDir: '/Users/alice/chatroom',
      model: 'opencode/big-pickle',
      availableHarnesses: ['cursor-sdk'],
      updatedAt: 100,
    };
    const newerConfig: AgentConfig = {
      ...baseConfig,
      model: 'openai/gpt-5.6-luna[reasoning=low]',
      updatedAt: 200,
    };

    render(
      <AgentPanel
        {...panelProps}
        teamStructure={duoStructure}
        agentConfigs={[newerConfig, baseConfig]}
      />
    );

    expect(screen.getByText('gpt-5.6-luna [low]')).toBeInTheDocument();
    expect(screen.queryByText('big-pickle')).not.toBeInTheDocument();
  });
});
