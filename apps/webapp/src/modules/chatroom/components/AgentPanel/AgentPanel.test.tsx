import { fireEvent, render, screen } from '@testing-library/react';
import { AgentRoleLifecycleTag } from '@workspace/shared/domain/agent-role';
import { getTeamStructure } from '@workspace/shared/domain/team-presets';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentConfig } from '../../types/machine';
import { AgentPanel } from '../AgentPanel';

const mockUseAgentStatuses = vi.fn();

vi.mock('../../hooks/useAgentStatuses', () => ({
  useAgentStatuses: (...args: unknown[]) => mockUseAgentStatuses(...args),
}));
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
const soloStructure = getTeamStructure({ teamId: 'solo', persistedRoles: ['solo'] });

const panelProps = {
  chatroomId: 'room1',
  machineId: null,
  lifecycle,
  statusReadModel: undefined,
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

beforeEach(() => {
  mockUseAgentStatuses.mockReturnValue({
    agents: duoStructure.roles.map(({ role }) => ({
      role,
      online: false,
      statusLabel: 'OFFLINE',
      statusVariant: 'offline',
      lastSeenAt: null,
      isWorking: false,
    })),
    isLoading: false,
  });
});

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

  it('renders permanent agents before ephemeral roles, including unconfigured triage', () => {
    render(<AgentPanel {...panelProps} teamStructure={duoStructure} />);

    expect(screen.getByText('Ephemeral (3)')).toBeInTheDocument();
    expect(screen.getByText('Agents (5)')).toBeInTheDocument();
    expect(screen.queryByText(/View More/)).not.toBeInTheDocument();
    const planner = screen.getByLabelText(/planner:/i);
    const builder = screen.getByLabelText(/builder:/i);
    const architect = screen.getByLabelText(/architect:/i);
    const triage = screen.getByLabelText(/triage:/i);
    const uiuxEngineer = screen.getByLabelText(/uiux-engineer:/i);
    expect(triage).toHaveTextContent(/OFFLINE/i);
    expect(screen.queryByText(/triage.*config/i)).not.toBeInTheDocument();
    expect(
      planner.compareDocumentPosition(builder) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      builder.compareDocumentPosition(architect) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      architect.compareDocumentPosition(triage) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      triage.compareDocumentPosition(uiuxEngineer) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('renders canonical Solo triage after its permanent role', () => {
    render(
      <AgentPanel
        {...panelProps}
        lifecycle={{
          ...lifecycle,
          teamId: 'solo',
          teamName: 'Solo',
          expectedRoles: soloStructure.roles.map(({ role }) => role),
        }}
        teamStructure={soloStructure}
      />
    );
    expect(screen.getByText('Agents (4)')).toBeInTheDocument();
    expect(screen.getByText('Ephemeral (3)')).toBeInTheDocument();
    const solo = screen.getByLabelText(/solo:/i);
    const triage = screen.getByLabelText(/triage:/i);
    expect(solo.compareDocumentPosition(triage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(triage).toHaveTextContent(/OFFLINE/i);
  });

  it('opens the agent settings callback from the triage row', () => {
    const onOpenAgents = vi.fn();
    render(<AgentPanel {...panelProps} teamStructure={duoStructure} onOpenAgents={onOpenAgents} />);
    fireEvent.click(screen.getByLabelText(/triage:/i));
    expect(onOpenAgents).toHaveBeenCalledOnce();
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
