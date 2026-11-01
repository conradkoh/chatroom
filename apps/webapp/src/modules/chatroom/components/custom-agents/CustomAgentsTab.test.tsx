import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { AgentRoleLifecycleTag } from '@workspace/shared/domain/agent-role';
import {
  CUSTOM_AGENT_ISSUE_REASONS,
  CUSTOM_AGENT_LIMITS,
  mergeTeamStructureWithCustomAgents,
} from '@workspace/shared/domain/custom-agent';
import { getTeamStructure } from '@workspace/shared/domain/team-presets';
import { ConvexError } from 'convex/values';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CUSTOM_AGENT_DISPLACED_MESSAGE,
  CUSTOM_AGENT_ISSUE_COPY,
  CUSTOM_AGENT_OVER_LIMIT_MESSAGE,
  formatCustomAgentIssueDetail,
} from './customAgentCopy';
import { resolveCustomAgentsGate } from './customAgentsGate';
import { CustomAgentsTab } from './CustomAgentsTab';
import type { TeamRosterResult } from './customAgentsViewModel';

const mocks = vi.hoisted(() => ({
  roster: undefined as unknown,
  queryError: null as Error | null,
  setDisabled: vi.fn(),
  requestRefresh: vi.fn(),
  team: {
    teamId: 'duo' as string | undefined,
    teamName: 'Duo' as string | undefined,
    isLoading: false,
  },
  workspace: {
    activeWorkspace: {
      id: 'w1',
      machineId: 'machine-1',
      hostname: 'dev-host',
      workingDir: '/repo',
      agentRoles: [],
      fileTreeSyncEnabled: true,
    } as unknown,
    isLoading: false,
  },
  daemon: { isConnected: true, isLoading: false },
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => {
    if (mocks.queryError) throw mocks.queryError;
    return mocks.roster;
  },
  useSessionMutation: (mutation: unknown) => {
    const name = String(mutation).split('.').pop();
    return name === 'setDisabled' ? mocks.setDisabled : mocks.requestRefresh;
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    customAgents: {
      getTeamRoster: 'customAgents.getTeamRoster',
      setDisabled: 'customAgents.setDisabled',
      requestRefresh: 'customAgents.requestRefresh',
    },
  },
}));

vi.mock('../../hooks/useChatroomTeam', () => ({ useChatroomTeam: () => mocks.team }));
vi.mock('../../context/ChatroomWorkspaceContext', () => ({
  useChatroomWorkspace: () => ({
    chatroomId: 'chatroom-1',
    workspaces: [],
    activeWorkspace: mocks.workspace.activeWorkspace,
    isLoading: mocks.workspace.isLoading,
    setPrimaryWorkspace: vi.fn(),
    removeWorkspace: vi.fn(),
  }),
}));
vi.mock('@/hooks/useDaemonConnected', () => ({ useDaemonConnected: () => mocks.daemon }));

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    readOnly,
    disabled,
    ...rest
  }: {
    checked?: boolean;
    onCheckedChange?: (next: boolean) => void;
    readOnly?: boolean;
    disabled?: boolean;
    [key: string]: unknown;
  }) => (
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      disabled={disabled}
      readOnly={readOnly}
      onChange={() => {
        if (!readOnly) onCheckedChange?.(!checked);
      }}
      {...rest}
    />
  ),
}));

function builtin(role: string): TeamRosterResult['roster'][number] {
  return {
    role,
    lifecycle: AgentRoleLifecycleTag.Permanent,
    source: 'builtin',
    summary: `${role} summary`,
    disabled: false,
    disableable: false,
  };
}

function custom(
  role: string,
  options: { scope?: 'workspace' | 'machine'; disabled?: boolean } = {}
): TeamRosterResult['roster'][number] {
  return {
    role,
    lifecycle: AgentRoleLifecycleTag.Ephemeral,
    source: 'custom',
    summary: `${role} summary`,
    disabled: options.disabled ?? false,
    disableable: true,
    scope: options.scope ?? 'workspace',
  };
}

function source(
  scope: 'workspace' | 'machine',
  overrides: Partial<TeamRosterResult['sources'][number]> = {}
): TeamRosterResult['sources'][number] {
  return {
    scope,
    machineId: 'machine-1',
    ...(scope === 'workspace' ? { workingDir: '/repo' } : {}),
    agentCount: 1,
    issues: [],
    updatedAt: 100,
    ...overrides,
  };
}

function roster(overrides: Partial<TeamRosterResult> = {}): TeamRosterResult {
  return {
    roster: [builtin('planner'), custom('alpha')],
    sources: [source('workspace'), source('machine')],
    ...overrides,
  };
}

/**
 * The roster the backend would serve for these custom agents, built through the
 * real merge so the per-chatroom cap removes the agent it really removes.
 */
function mergedRoster(names: readonly string[], disabled: readonly string[]): TeamRosterResult {
  const merged = mergeTeamStructureWithCustomAgents({
    base: getTeamStructure({ teamId: 'duo' }),
    workspaceAgents: names.map((name) => ({
      name,
      description: `${name} summary`,
      scope: 'workspace' as const,
    })),
    machineAgents: [],
    disabledRoles: new Set(disabled),
  });
  return {
    roster: merged.roster,
    sources: [
      source('workspace', { issues: merged.issues, agentCount: names.length }),
      source('machine'),
    ],
  };
}

function renderTab(
  onOpenTab = vi.fn()
): ReturnType<typeof render> & { onOpenTab: typeof onOpenTab } {
  const result = render(
    (<CustomAgentsTab chatroomId="chatroom-1" onOpenTab={onOpenTab} />) as ReactNode
  );
  return Object.assign(result, { onOpenTab });
}

beforeEach(() => {
  mocks.roster = roster();
  mocks.queryError = null;
  mocks.setDisabled = vi.fn().mockResolvedValue({ queued: true });
  mocks.requestRefresh = vi.fn().mockResolvedValue({ queued: true });
  mocks.team = { teamId: 'duo', teamName: 'Duo', isLoading: false };
  mocks.workspace = {
    activeWorkspace: {
      id: 'w1',
      machineId: 'machine-1',
      hostname: 'dev-host',
      workingDir: '/repo',
      agentRoles: [],
      fileTreeSyncEnabled: true,
    },
    isLoading: false,
  };
  mocks.daemon = { isConnected: true, isLoading: false };
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('resolveCustomAgentsGate', () => {
  const base = {
    isLoading: false,
    roster: roster(),
    teamId: 'duo',
    hasWorkspace: true,
    rowCount: 1,
  };

  it('reports each branch', () => {
    expect(resolveCustomAgentsGate({ ...base, isLoading: true })).toBe('loading');
    expect(resolveCustomAgentsGate({ ...base, roster: undefined })).toBe('loading');
    expect(resolveCustomAgentsGate({ ...base, teamId: 'solo' })).toBe('unsupported');
    expect(resolveCustomAgentsGate({ ...base, hasWorkspace: false })).toBe('no-workspace');
    expect(resolveCustomAgentsGate({ ...base, rowCount: 0 })).toBe('empty');
    expect(resolveCustomAgentsGate(base)).toBe('loaded');
  });

  it('prefers loading over every other condition', () => {
    expect(
      resolveCustomAgentsGate({
        isLoading: true,
        roster: undefined,
        teamId: 'solo',
        hasWorkspace: false,
        rowCount: 0,
      })
    ).toBe('loading');
  });
});

describe('CustomAgentsTab states', () => {
  it('shows the loading skeleton while the roster is undefined', () => {
    mocks.roster = undefined;

    renderTab();

    expect(screen.getAllByTestId('custom-agent-row-skeleton')).toHaveLength(3);
    expect(screen.getByTestId('custom-agents-rescan')).toBeDisabled();
  });

  it('shows the empty state with both paths and the gitignore snippet', () => {
    mocks.roster = roster({ roster: [builtin('planner')], sources: [] });

    renderTab();

    expect(screen.getByTestId('custom-agents-empty')).toBeInTheDocument();
    expect(screen.getByText('No custom agents yet')).toBeInTheDocument();
    expect(screen.getByText('/repo/.chatroom/agents/<name>/AGENT.md')).toBeInTheDocument();
    expect(screen.getByText('~/.chatroom/agents/<name>/AGENT.md')).toBeInTheDocument();
    expect(screen.getByText(/!\.chatroom\/agents\//)).toBeInTheDocument();
    expect(screen.queryByText('Sources')).not.toBeInTheDocument();
  });

  it('shows the issue copy and sources when the empty tree has issues', () => {
    mocks.roster = roster({
      roster: [builtin('planner')],
      sources: [
        source('workspace', { issues: [{ path: 'alpha', reason: 'name-mismatch' }] }),
        source('machine'),
      ],
    });

    renderTab();

    expect(screen.getByText('No custom agents loaded')).toBeInTheDocument();
    expect(screen.getByText('Sources')).toBeInTheDocument();
    expect(screen.getByText('Name does not match the folder')).toBeInTheDocument();
  });

  it('shows the query error and recovers on retry', () => {
    mocks.queryError = new Error('query failed');
    renderTab();

    expect(screen.getByText('Could not load custom agents')).toBeInTheDocument();

    mocks.queryError = null;
    mocks.roster = roster();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    expect(screen.getByTestId('custom-agent-row-alpha')).toBeInTheDocument();
  });
});

describe('CustomAgentsTab loaded state', () => {
  it('renders custom rows sorted by name and excludes builtins', () => {
    mocks.roster = roster({
      roster: [builtin('planner'), custom('gamma'), custom('alpha', { scope: 'machine' })],
    });

    renderTab();

    const rows = screen.getAllByTestId(/^custom-agent-row-/);
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'custom-agent-row-alpha',
      'custom-agent-row-gamma',
    ]);
    expect(screen.queryByTestId('custom-agent-row-planner')).not.toBeInTheDocument();
  });

  it('renders the scope, overrides, and off chips where they apply', () => {
    mocks.roster = roster({
      roster: [
        custom('alpha', { scope: 'workspace' }),
        custom('beta', { scope: 'machine', disabled: true }),
      ],
      sources: [
        source('workspace'),
        source('machine', { issues: [{ path: 'alpha', reason: 'shadowed' }] }),
      ],
    });

    renderTab();

    const alpha = screen.getByTestId('custom-agent-row-alpha');
    expect(within(alpha).getByText('Workspace')).toBeInTheDocument();
    expect(within(alpha).getByText('Overrides machine')).toBeInTheDocument();
    expect(within(alpha).queryByText('Off')).not.toBeInTheDocument();
    const beta = screen.getByTestId('custom-agent-row-beta');
    expect(within(beta).getByText('Machine')).toBeInTheDocument();
    expect(within(beta).getByText('Off')).toBeInTheDocument();
    expect(within(beta).queryByText('Overrides machine')).not.toBeInTheDocument();
  });

  it('checks the switch when the agent is enabled', () => {
    renderTab();

    expect(screen.getByTestId('custom-agent-switch-alpha')).toBeChecked();
  });

  it('names the hostname in the machine-wide note', () => {
    renderTab();

    expect(
      screen.getByText(
        /Turning an agent off applies to every agent with that name on dev-host, in every chatroom/
      )
    ).toBeInTheDocument();
  });

  it('renders every issue reason with its title, path, and typed detail', () => {
    mocks.roster = roster({
      sources: [
        source('workspace', {
          issues: CUSTOM_AGENT_ISSUE_REASONS.map((reason) => ({
            path: `path-${reason}`,
            reason,
            detail: reason === 'too-large' ? 'systemPrompt' : undefined,
          })),
        }),
        source('machine'),
      ],
    });

    renderTab();

    expect(screen.getAllByTestId('custom-agent-issue')).toHaveLength(
      CUSTOM_AGENT_ISSUE_REASONS.length
    );
    for (const reason of CUSTOM_AGENT_ISSUE_REASONS) {
      const item = document.querySelector(`[data-reason="${reason}"]`) as HTMLElement;
      expect(within(item).getByText(CUSTOM_AGENT_ISSUE_COPY[reason].title)).toBeInTheDocument();
      expect(within(item).getByText(new RegExp(`path-${reason}`))).toBeInTheDocument();
    }
    expect(
      formatCustomAgentIssueDetail({ path: 'x', reason: 'too-large', detail: 'systemPrompt' })
    ).toBe('AGENT.md body');
  });

  it('reports a clean source and an unpushed machine source', () => {
    mocks.roster = roster({ sources: [source('workspace'), source('machine')] });
    mocks.roster = roster({ sources: [source('workspace')] });

    renderTab();

    expect(screen.getByText('No problems')).toBeInTheDocument();
    expect(screen.getByText('Nothing pushed yet')).toBeInTheDocument();
  });
});

describe('CustomAgentsTab toggle behaviour', () => {
  it('sends one request, shows pending text, and hides the Off chip until confirmed', () => {
    renderTab();
    const toggle = screen.getByTestId('custom-agent-switch-alpha');

    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(mocks.setDisabled).toHaveBeenCalledTimes(1);
    expect(mocks.setDisabled).toHaveBeenCalledWith({
      chatroomId: 'chatroom-1',
      name: 'alpha',
      disabled: true,
    });
    expect(screen.getByText('Turning off…')).toBeInTheDocument();
    expect(screen.queryByText('Off')).not.toBeInTheDocument();
  });

  it('clears pending when the roster confirms the change', () => {
    const { rerender } = renderTab();
    fireEvent.click(screen.getByTestId('custom-agent-switch-alpha'));

    mocks.roster = roster({ roster: [builtin('planner'), custom('alpha', { disabled: true })] });
    rerender((<CustomAgentsTab chatroomId="chatroom-1" onOpenTab={vi.fn()} />) as ReactNode);

    expect(screen.queryByText('Turning off…')).not.toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('surfaces the timeout copy and clears it when the roster catches up', () => {
    vi.useFakeTimers();
    const { rerender } = renderTab();
    fireEvent.click(screen.getByTestId('custom-agent-switch-alpha'));

    act(() => vi.advanceTimersByTime(10_000));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The machine did not respond');

    mocks.roster = roster({ roster: [builtin('planner'), custom('alpha', { disabled: true })] });
    rerender((<CustomAgentsTab chatroomId="chatroom-1" onOpenTab={vi.fn()} />) as ReactNode);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('maps a rejected mutation to the owner copy and clears pending', async () => {
    mocks.setDisabled = vi
      .fn()
      .mockRejectedValue(new ConvexError({ code: 'NOT_AUTHORIZED_MACHINE', message: 'no' }));
    renderTab();

    await act(async () => {
      fireEvent.click(screen.getByTestId('custom-agent-switch-alpha'));
      await Promise.resolve();
    });

    expect(
      screen.getByText('Only the owner of this machine can change its custom agents.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Turning off…')).not.toBeInTheDocument();
  });

  it('reports the displaced agent on its source issue after a capped enable', () => {
    // `agent-17` sorts before `agent-2` through `agent-9`, so the real merge keeps
    // it on and cuts `agent-9` instead. Hand-built rosters hid that swap.
    const names = [
      ...Array.from(
        { length: CUSTOM_AGENT_LIMITS.agentsPerChatroom },
        (_, index) => `agent-${index + 1}`
      ),
      'agent-17',
    ];
    mocks.roster = mergedRoster(names, ['agent-17']);
    const { rerender } = renderTab();

    fireEvent.click(screen.getByTestId('custom-agent-switch-agent-17'));

    mocks.roster = mergedRoster(names, []);
    rerender((<CustomAgentsTab chatroomId="chatroom-1" onOpenTab={vi.fn()} />) as ReactNode);

    expect(screen.queryByTestId('custom-agent-row-agent-9')).not.toBeInTheDocument();
    expect(screen.getByTestId('custom-agent-row-agent-17')).toBeInTheDocument();
    const alert = screen.getByTestId('custom-agent-over-limit-failure');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent(CUSTOM_AGENT_DISPLACED_MESSAGE);
  });

  it('shows the corrected copy when the cap cuts the toggled agent itself', () => {
    // `zeta` sorts after every `agent-*` name, so this enable is the one cut.
    const names = [
      ...Array.from(
        { length: CUSTOM_AGENT_LIMITS.agentsPerChatroom },
        (_, index) => `agent-${index + 1}`
      ),
      'zeta',
    ];
    mocks.roster = mergedRoster(names, ['zeta']);
    const { rerender } = renderTab();

    fireEvent.click(screen.getByTestId('custom-agent-switch-zeta'));

    mocks.roster = mergedRoster(names, []);
    rerender((<CustomAgentsTab chatroomId="chatroom-1" onOpenTab={vi.fn()} />) as ReactNode);

    expect(screen.queryByTestId('custom-agent-row-zeta')).not.toBeInTheDocument();
    expect(screen.getByTestId('custom-agent-over-limit-failure')).toHaveTextContent(
      CUSTOM_AGENT_OVER_LIMIT_MESSAGE
    );
  });
});

describe('CustomAgentsTab gates', () => {
  it('disables controls and shows the banner when the daemon is offline', () => {
    mocks.daemon = { isConnected: false, isLoading: false };

    renderTab();

    expect(screen.getByTestId('custom-agents-daemon-offline')).toBeInTheDocument();
    expect(screen.getByTestId('custom-agent-switch-alpha')).toBeDisabled();
    expect(screen.getByTestId('custom-agents-rescan')).toBeDisabled();
  });

  it('explains an unsupported team and links to the Team tab', () => {
    mocks.team = { teamId: 'solo', teamName: 'Solo', isLoading: false };
    const { onOpenTab } = renderTab();

    expect(screen.getByText(/work only with the Duo team/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Team tab' }));

    expect(onOpenTab).toHaveBeenCalledWith('team');
  });

  it('explains a missing primary workspace and links to Workspaces', () => {
    mocks.workspace = { activeWorkspace: null, isLoading: false };
    const { onOpenTab } = renderTab();

    expect(screen.getByText(/has none yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Workspaces tab' }));

    expect(onOpenTab).toHaveBeenCalledWith('workspaces');
  });
});

describe('CustomAgentsTab rescan', () => {
  it('reports Updated when the signature changes', async () => {
    const { rerender } = renderTab();

    await act(async () => {
      fireEvent.click(screen.getByTestId('custom-agents-rescan'));
      await Promise.resolve();
    });
    expect(mocks.requestRefresh).toHaveBeenCalledWith({ chatroomId: 'chatroom-1' });
    expect(screen.getByTestId('custom-agents-rescan')).toBeDisabled();
    expect(screen.getByText('Rescanning…')).toBeInTheDocument();

    mocks.roster = roster({
      sources: [source('workspace', { updatedAt: 500 }), source('machine')],
    });
    rerender((<CustomAgentsTab chatroomId="chatroom-1" onOpenTab={vi.fn()} />) as ReactNode);

    expect(screen.getByText('Updated')).toBeInTheDocument();
  });

  it('reports no changes after the bounded wait', async () => {
    vi.useFakeTimers();
    renderTab();

    await act(async () => {
      fireEvent.click(screen.getByTestId('custom-agents-rescan'));
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(screen.getByText('No changes found.')).toBeInTheDocument();
  });

  it('shows the mutation error hint when the request fails', async () => {
    mocks.requestRefresh = vi.fn().mockRejectedValue(new Error('offline'));
    renderTab();

    await act(async () => {
      fireEvent.click(screen.getByTestId('custom-agents-rescan'));
      await Promise.resolve();
    });

    expect(screen.getByText('offline')).toBeInTheDocument();
  });
});
