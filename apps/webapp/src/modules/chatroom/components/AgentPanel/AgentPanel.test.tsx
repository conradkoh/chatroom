import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { AgentRoleLifecycleTag } from '@workspace/shared/domain/agent-role';
import { getTeamStructure } from '@workspace/shared/domain/team-presets';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentRoleStatusReadModel } from '../../hooks/useAgentPanelData';
import type { AgentConfig } from '../../types/machine';
import { AgentPanel } from '../AgentPanel';

vi.mock('./RemoteAgentQuickActions', () => ({
  RemoteAgentQuickActions: () => <div data-testid="quick-actions" />,
}));
vi.mock('../../features/machine-config/components/ApplyTopFavoriteModelsButton', () => ({
  ApplyTopFavoriteModelsButton: () => <div data-testid="apply-top-favorites" />,
  ApplyTopFavoritesFeedbackLine: () => null,
}));
vi.mock('./CommandQueuePanel', () => ({
  CommandQueuePanel: () => <div data-testid="command-queue-panel" />,
}));
vi.mock('./TeamSelectorDropdown', () => ({
  TeamSelectorDropdown: () => <div data-testid="team-selector" />,
}));

const lifecycle = {
  teamId: 'duo',
  teamName: 'Duo',
  expectedRoles: getTeamStructure({ teamId: 'duo' }).roles.map(({ role }) => role),
  participants: [],
  hasHistory: false,
};

const duoStructure = getTeamStructure({ teamId: 'duo' });
const previewOverflowStructure = {
  ...duoStructure,
  roles: [
    { role: 'planner', lifecycle: AgentRoleLifecycleTag.Permanent, optional: false },
    { role: 'builder', lifecycle: AgentRoleLifecycleTag.Permanent, optional: false },
    { role: 'analyst', lifecycle: AgentRoleLifecycleTag.Permanent, optional: false },
    { role: 'tester', lifecycle: AgentRoleLifecycleTag.Permanent, optional: false },
    { role: 'architect', lifecycle: AgentRoleLifecycleTag.Ephemeral, optional: true },
    { role: 'triage', lifecycle: AgentRoleLifecycleTag.Ephemeral, optional: true },
    { role: 'uiux-engineer', lifecycle: AgentRoleLifecycleTag.Ephemeral, optional: true },
  ],
};
const pinnedTeamFacts = [
  {
    teamId: 'duo',
    permanentRoles: ['planner', 'builder'],
    ephemeralRoles: [
      'product-manager',
      'architect',
      'researcher',
      'triage',
      'reviewer',
      'uiux-engineer',
      'game-asset-designer',
      'verifier',
    ],
  },
  {
    teamId: 'solo',
    permanentRoles: ['solo'],
    ephemeralRoles: ['product-manager', 'architect', 'triage', 'uiux-engineer', 'verifier'],
  },
] as const;

const panelProps = {
  chatroomId: 'room-1' as Id<'chatroom_rooms'>,
  machineId: null,
  lifecycle,
  statusReadModel: [],
  teamName: undefined,
  teamId: undefined,
  defaultTeamId: undefined,
  teams: undefined,
  onTeamChange: undefined,
  agentConfigs: [],
  onOpenAgent: vi.fn(),
  onOpenAgents: vi.fn(),
  hasRunningRemoteAgents: false,
  canStopRemoteAgents: false,
  onStartAllRemoteAgents: undefined,
  onStopAllRemoteAgents: undefined,
  onRestartAllRemoteAgents: undefined,
  isStoppingAgents: false,
  isStartingAllAgents: false,
};

type StatusValue = NonNullable<AgentRoleStatusReadModel['status']>;

/** Builds one projected role-status row for the status read model. */
function statusRow(role: string, status: StatusValue): AgentRoleStatusReadModel {
  return { role, roleKind: 'ephemeral', status, projectedAt: Date.now() };
}

const ephemeralToggle = () => screen.getByRole('button', { name: /^Ephemeral \(\d+\):/ });
const expandEphemeralGroup = () => fireEvent.click(ephemeralToggle());

describe('AgentPanel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

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

  it('groups the apply-top-favourites button with the quick actions in the team toolbar', () => {
    render(
      <AgentPanel
        {...panelProps}
        lifecycle={null}
        teamStructure={duoStructure}
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

    expect(
      within(screen.getByTestId('agent-team-actions')).getByTestId('quick-actions')
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('agent-team-actions')).getByTestId('apply-top-favorites')
    ).toBeInTheDocument();
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
      const ephemeralHeading = screen.getByText(`Ephemeral (${ephemeralRoles.length})`);
      expect(ephemeralHeading).toBeInTheDocument();
      expect(screen.queryByText(/View More/)).not.toBeInTheDocument();

      // Collapsed by default: no ephemeral member row is in the DOM.
      for (const role of ephemeralRoles) {
        expect(screen.queryByLabelText(new RegExp(`^${role}:`, 'i'))).toBeNull();
      }

      expandEphemeralGroup();

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

  it('opens the single-agent config callback from the triage row', () => {
    const onOpenAgent = vi.fn();
    const onOpenAgents = vi.fn();
    render(
      <AgentPanel
        {...panelProps}
        teamStructure={duoStructure}
        onOpenAgent={onOpenAgent}
        onOpenAgents={onOpenAgents}
      />
    );
    expandEphemeralGroup();
    const triage = screen.getByLabelText(/triage:/i);
    fireEvent.click(triage);
    fireEvent.keyDown(triage, { key: 'Enter' });
    fireEvent.keyDown(triage, { key: ' ' });
    expect(onOpenAgent).toHaveBeenCalledTimes(3);
    for (const call of onOpenAgent.mock.calls) {
      expect(call).toEqual(['triage']);
    }
    expect(onOpenAgents).not.toHaveBeenCalled();
  });

  it('opens the single-agent config callback from a permanent row', () => {
    const onOpenAgent = vi.fn();
    render(<AgentPanel {...panelProps} teamStructure={duoStructure} onOpenAgent={onOpenAgent} />);
    fireEvent.click(screen.getByTestId('agent-sidebar-row-planner'));
    expect(onOpenAgent).toHaveBeenCalledTimes(1);
    expect(onOpenAgent).toHaveBeenCalledWith('planner');
  });

  it('opens Settings agents from the View More action', () => {
    const onOpenAgents = vi.fn();
    render(
      <AgentPanel
        {...panelProps}
        teamStructure={previewOverflowStructure}
        onOpenAgents={onOpenAgents}
      />
    );
    fireEvent.click(screen.getByText('View More (1 more items)'));
    expect(onOpenAgents).toHaveBeenCalledTimes(1);
  });

  it('keeps declared rows visible while status data is loading', () => {
    render(<AgentPanel {...panelProps} teamStructure={duoStructure} statusReadModel={undefined} />);

    expect(screen.getByText('Agents (10)')).toBeInTheDocument();
    expect(screen.getByText('Ephemeral (8)')).toBeInTheDocument();
    expect(screen.getByText('Loading statuses…')).toBeInTheDocument();
    expandEphemeralGroup();
    const triage = screen.getByLabelText(/triage: Loading/i);
    expect(triage).toBeInTheDocument();
    expect(within(triage).getByLabelText('Status: Loading...')).toBeInTheDocument();
  });

  it('keeps declared rows visible with an error status', () => {
    const errorStatus: AgentRoleStatusReadModel[] = [statusRow('triage', 'error')];
    render(
      <AgentPanel {...panelProps} teamStructure={duoStructure} statusReadModel={errorStatus} />
    );

    expect(screen.getByText('Agents (10)')).toBeInTheDocument();
    // The errored agent renders above the collapsed group.
    expect(screen.getAllByLabelText(/triage:/i)).toHaveLength(1);
    expect(screen.getByLabelText(/triage:/i)).toHaveTextContent('OFFLINE (ERROR)');
    expect(screen.queryByLabelText(/architect:/i)).toBeNull();
    expect(screen.queryByLabelText(/uiux-engineer:/i)).toBeNull();

    expandEphemeralGroup();
    expect(screen.getByLabelText(/architect:/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/uiux-engineer:/i)).toBeInTheDocument();
  });

  it('shows the loading panel while the team structure is unresolved', () => {
    render(<AgentPanel {...panelProps} lifecycle={undefined} teamStructure={undefined} />);

    expect(screen.getByText('Agents (0)')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/triage:/i)).not.toBeInTheDocument();
  });

  it('keeps all ephemeral agents reachable when permanent agents exceed the preview limit', () => {
    render(<AgentPanel {...panelProps} teamStructure={previewOverflowStructure} />);

    expect(screen.getByText('Agents (7)')).toBeInTheDocument();
    expect(screen.getByText('Ephemeral (3)')).toBeInTheDocument();
    expect(screen.getByLabelText(/planner:/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/builder:/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/analyst:/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/tester:/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/architect:/i)).toBeNull();
    expect(screen.queryByLabelText(/triage:/i)).toBeNull();
    expect(screen.queryByLabelText(/uiux-engineer:/i)).toBeNull();
    expect(screen.getByText('View More (1 more items)')).toBeInTheDocument();

    expandEphemeralGroup();
    expect(screen.getByLabelText(/architect:/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/triage:/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/uiux-engineer:/i)).toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: /^Ephemeral \(\d+\):/ })).toBeNull();
  });

  it('renders one collapsed group row with zero online, all offline, and no member rows', () => {
    render(<AgentPanel {...panelProps} teamStructure={duoStructure} statusReadModel={[]} />);

    expect(screen.getByText('Ephemeral (8)')).toBeInTheDocument();
    expect(screen.getByText('0 online')).toBeInTheDocument();
    expect(screen.getByText('8 offline')).toBeInTheDocument();
    expect(screen.getByText('0 errored')).toBeInTheDocument();

    const toggle = ephemeralToggle();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).not.toHaveAttribute('aria-controls');
    expect(screen.queryByLabelText(/^product-manager:/i)).toBeNull();
  });

  it('moves working and errored ephemeral agents above the group', () => {
    render(
      <AgentPanel
        {...panelProps}
        teamStructure={duoStructure}
        statusReadModel={[statusRow('architect', 'working'), statusRow('triage', 'error')]}
      />
    );

    const architectRow = screen.getByTestId('agent-sidebar-row-architect');
    const triageRow = screen.getByTestId('agent-sidebar-row-triage');
    const toggle = ephemeralToggle();

    expect(
      architectRow.compareDocumentPosition(triageRow) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      triageRow.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    expect(screen.queryByLabelText(/^product-manager:/i)).toBeNull();
    expect(triageRow).toHaveTextContent('OFFLINE (ERROR)');
    expect(screen.getByText('1 online')).toBeInTheDocument();
    expect(screen.getByText('6 offline')).toBeInTheDocument();
    expect(screen.getByText('1 errored')).toBeInTheDocument();
  });

  it('returns an agent to the group when its status changes', () => {
    const { rerender } = render(
      <AgentPanel
        {...panelProps}
        teamStructure={duoStructure}
        statusReadModel={[statusRow('architect', 'working')]}
      />
    );

    // Working renders above the group, so the row is visible while collapsed.
    expect(screen.getByLabelText(/^architect:/i)).toBeInTheDocument();

    rerender(
      <AgentPanel
        {...panelProps}
        teamStructure={duoStructure}
        statusReadModel={[statusRow('architect', 'waiting')]}
      />
    );

    expect(screen.queryByLabelText(/^architect:/i)).toBeNull();
    expect(screen.getByText('1 online')).toBeInTheDocument();
    expect(screen.getByText('7 offline')).toBeInTheDocument();
    expect(screen.getByText('0 errored')).toBeInTheDocument();

    expandEphemeralGroup();
    expect(screen.getByLabelText(/^architect:/i)).toBeInTheDocument();
  });

  it('counts agents outside the group and sums to the ephemeral total', () => {
    render(
      <AgentPanel
        {...panelProps}
        teamStructure={duoStructure}
        statusReadModel={[
          statusRow('product-manager', 'starting'),
          statusRow('architect', 'working'),
          statusRow('researcher', 'waiting'),
          statusRow('triage', 'error'),
          statusRow('reviewer', 'stopping'),
          statusRow('verifier', 'offline'),
        ]}
      />
    );

    expect(screen.getByText('4 online')).toBeInTheDocument();
    expect(screen.getByText('3 offline')).toBeInTheDocument();
    expect(screen.getByText('1 errored')).toBeInTheDocument();
  });

  it('keeps the group row when every ephemeral agent is outside and shows the empty line when expanded', () => {
    const roles = pinnedTeamFacts[0].ephemeralRoles;
    render(
      <AgentPanel
        {...panelProps}
        teamStructure={duoStructure}
        statusReadModel={roles.map((role) => statusRow(role, 'working'))}
      />
    );

    expect(screen.getByText('Ephemeral (8)')).toBeInTheDocument();
    expect(screen.getByText('8 online')).toBeInTheDocument();
    expect(screen.getByText('0 offline')).toBeInTheDocument();
    expect(screen.getByText('0 errored')).toBeInTheDocument();

    expandEphemeralGroup();
    expect(screen.getByText('No agents in group')).toBeInTheDocument();
  });

  it('shows the loading line in the counts slot while statuses load', () => {
    render(<AgentPanel {...panelProps} teamStructure={duoStructure} statusReadModel={undefined} />);

    expect(screen.getByText('Loading statuses…')).toBeInTheDocument();
    expect(screen.queryByText('0 online')).toBeNull();
  });

  it('opens config for an outside agent without expanding the group', () => {
    const onOpenAgent = vi.fn();
    render(
      <AgentPanel
        {...panelProps}
        teamStructure={duoStructure}
        statusReadModel={[statusRow('architect', 'working')]}
        onOpenAgent={onOpenAgent}
      />
    );

    fireEvent.click(screen.getByTestId('agent-sidebar-row-architect'));

    expect(onOpenAgent).toHaveBeenCalledTimes(1);
    expect(onOpenAgent).toHaveBeenCalledWith('architect');
    expect(ephemeralToggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('persists expansion per chatroom', () => {
    const roomOneProps = {
      ...panelProps,
      chatroomId: 'room-1' as Id<'chatroom_rooms'>,
      teamStructure: duoStructure,
    };
    const first = render(<AgentPanel {...roomOneProps} />);

    fireEvent.click(ephemeralToggle());

    expect(localStorage.getItem('chatroom:room-1:ephemeralAgentsExpanded')).toBe('true');
    first.unmount();

    const second = render(<AgentPanel {...roomOneProps} />);
    expect(ephemeralToggle()).toHaveAttribute('aria-expanded', 'true');
    second.unmount();

    render(<AgentPanel {...roomOneProps} chatroomId={'room-2' as Id<'chatroom_rooms'>} />);
    expect(ephemeralToggle()).toHaveAttribute('aria-expanded', 'false');
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

    expect(screen.getByText('Gpt 5.6 Terra [high]')).toBeInTheDocument();
  });

  it('renders the dotted, title-cased model label in the sidebar for Claude haiku 5.5', () => {
    const haikuConfig: AgentConfig = {
      machineId: 'machine-1',
      hostname: 'test-host',
      role: 'planner',
      agentType: 'claude-sdk',
      workingDir: '/Users/alice/chatroom',
      model: 'anthropic/claude-haiku-5-5[effort=high]',
      availableHarnesses: ['claude-sdk'],
      updatedAt: Date.now(),
    };

    render(
      <AgentPanel {...panelProps} teamStructure={duoStructure} agentConfigs={[haikuConfig]} />
    );

    expect(screen.getByText('Claude Haiku 5.5 [high]')).toBeInTheDocument();
    expect(screen.queryByText('claude-haiku-5-5 [high]')).not.toBeInTheDocument();
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

    expect(screen.getByText('Gpt 5.6 Luna [low]')).toBeInTheDocument();
    expect(screen.queryByText('big-pickle')).not.toBeInTheDocument();
  });
});
