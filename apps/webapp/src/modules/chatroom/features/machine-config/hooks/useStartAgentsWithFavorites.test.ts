import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useStartAgentsWithFavorites, type StartFlowPhase } from './useStartAgentsWithFavorites';

const mocks = vi.hoisted(() => ({
  /** Query fixtures. A key left out (or `undefined`) means the query is still loading. */
  data: {} as Record<string, any>,
  saveConfig: vi.fn(),
  /** Key count of every `useQueries` call, in order. */
  queryCalls: [] as number[],
  resolve: (query: string, args: Record<string, any>): unknown => {
    const d = mocks.data;
    switch (query) {
      case 'chatrooms:getTeamStructureForChatroom':
        return d.structure;
      case 'workspaces:listWorkspacesForChatroom':
        return d.workspaces;
      case 'agents:listStatus':
        return d.status;
      case 'agents:listLastSentLaunchRequests':
        return d.requests?.[args.workspaceId];
      case 'machines:getMachineCapabilities':
        return d.capabilities?.[args.machineId];
      case 'machineConfigFavorites:getMachineConfigFavorites':
        return d.favorites?.[`${args.machineId}|${args.teamRoleKey}`];
      default:
        return undefined;
    }
  },
}));

vi.mock('convex/react', () => ({
  useQueries: (queries: Record<string, { query: string; args: Record<string, any> }>) => {
    mocks.queryCalls.push(Object.keys(queries).length);
    return Object.fromEntries(
      Object.entries(queries).map(([key, { query, args }]) => [key, mocks.resolve(query, args)])
    );
  },
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1'],
  useSessionMutation: () => mocks.saveConfig,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatrooms: { getTeamStructureForChatroom: 'chatrooms:getTeamStructureForChatroom' },
    workspaces: { listWorkspacesForChatroom: 'workspaces:listWorkspacesForChatroom' },
    agents: {
      listStatus: 'agents:listStatus',
      listLastSentLaunchRequests: 'agents:listLastSentLaunchRequests',
      saveConfig: 'agents:saveConfig',
    },
    machines: { getMachineCapabilities: 'machines:getMachineCapabilities' },
    machineConfigFavorites: {
      getMachineConfigFavorites: 'machineConfigFavorites:getMachineConfigFavorites',
    },
  },
}));

/** One builder workspace on machine `m1`, whose launch request uses `claude`/`opus`. */
function fixture() {
  return {
    structure: { teamId: 'trio', roles: [{ role: 'builder' }, { role: 'user' }] },
    workspaces: [{ _id: 'ws-1', machineId: 'm1', workingDir: '/repo', hostname: 'laptop' }],
    status: [{ role: 'builder', isRunning: false }],
    capabilities: { m1: { availableHarnesses: ['claude', 'opencode'] } },
    favorites: {
      'm1|team_trio#role_builder': {
        favorites: [{ agentHarness: 'opencode', model: 'gpt' }],
      },
    },
    requests: {
      'ws-1': [{ role: 'builder', agentHarness: 'claude', model: 'opus', workingDir: '/repo' }],
    },
  };
}

/** Same fixture, but the launch request already uses the favourite. */
function matchingFixture() {
  const data = fixture();
  data.requests['ws-1'] = [
    { role: 'builder', agentHarness: 'opencode', model: 'gpt', workingDir: '/repo' },
  ];
  return data;
}

/** Two roles, so one save can fail while the other succeeds. */
function twoRoleFixture() {
  return {
    structure: {
      teamId: 'trio',
      roles: [{ role: 'builder' }, { role: 'reviewer' }, { role: 'user' }],
    },
    workspaces: [{ _id: 'ws-1', machineId: 'm1', workingDir: '/repo', hostname: 'laptop' }],
    status: [
      { role: 'builder', isRunning: false },
      { role: 'reviewer', isRunning: false },
    ],
    capabilities: { m1: { availableHarnesses: ['claude', 'opencode'] } },
    favorites: {
      'm1|team_trio#role_builder': {
        favorites: [{ agentHarness: 'opencode', model: 'gpt' }],
      },
      'm1|team_trio#role_reviewer': {
        favorites: [{ agentHarness: 'opencode', model: 'opus' }],
      },
    },
    requests: {
      'ws-1': [
        { role: 'builder', agentHarness: 'claude', model: 'opus', workingDir: '/repo' },
        { role: 'reviewer', agentHarness: 'claude', model: 'sonnet', workingDir: '/repo' },
      ],
    },
  };
}

type StartAction = (info: { appliedCount: number }) => Promise<void>;

function renderFlow(start: StartAction = vi.fn().mockResolvedValue(undefined)) {
  const phases: StartFlowPhase[] = [];
  const view = renderHook(() => {
    const flow = useStartAgentsWithFavorites({ chatroomId: 'room-1', start });
    phases.push(flow.phase);
    return flow;
  });
  return { ...view, phases, start };
}

describe('useStartAgentsWithFavorites', () => {
  beforeEach(() => {
    mocks.data = {};
    mocks.saveConfig.mockReset();
    mocks.saveConfig.mockResolvedValue(undefined);
    mocks.queryCalls = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs no queries while idle', () => {
    const { result, start } = renderFlow();

    expect(mocks.queryCalls.length).toBeGreaterThan(0);
    expect(mocks.queryCalls.every((count) => count === 0)).toBe(true);
    expect(result.current.phase).toBe('idle');
    expect(result.current.isBusy).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it('starts once without prompting when the launch request matches the favourite', async () => {
    mocks.data = matchingFixture();
    const { result, phases, start } = renderFlow();

    await act(async () => {
      result.current.requestStart();
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({ appliedCount: 0 });
    expect(phases).not.toContain('prompt');
    expect(result.current.phase).toBe('idle');
    expect(mocks.saveConfig).not.toHaveBeenCalled();
  });

  it('opens the prompt on a mismatch and does not start', async () => {
    mocks.data = fixture();
    const { result, start } = renderFlow();

    await act(async () => {
      result.current.requestStart();
    });

    expect(result.current.phase).toBe('prompt');
    expect(result.current.dialogProps.open).toBe(true);
    expect(result.current.dialogProps.mismatches).toHaveLength(1);
    expect(result.current.dialogProps.mismatches[0].current).toEqual({
      agentHarness: 'claude',
      model: 'opus',
    });
    expect(result.current.dialogProps.mismatches[0].favorite).toEqual({
      agentHarness: 'opencode',
      model: 'gpt',
    });
    expect(start).not.toHaveBeenCalled();
  });

  it('starts with the current configuration without saving', async () => {
    mocks.data = fixture();
    const { result, start } = renderFlow();
    await act(async () => {
      result.current.requestStart();
    });

    await act(async () => {
      result.current.dialogProps.onStartWithCurrent();
    });

    expect(start).toHaveBeenCalledWith({ appliedCount: 0 });
    expect(mocks.saveConfig).not.toHaveBeenCalled();
  });

  it('saves each mismatch, then starts with the applied count', async () => {
    mocks.data = fixture();
    const { result, start } = renderFlow();
    await act(async () => {
      result.current.requestStart();
    });

    await act(async () => {
      result.current.dialogProps.onUseFavourites();
    });

    await waitFor(() => expect(start).toHaveBeenCalledWith({ appliedCount: 1 }));
    expect(mocks.saveConfig).toHaveBeenCalledTimes(1);
    expect(mocks.saveConfig).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      workspaceId: 'ws-1',
      role: 'builder',
      machineId: 'm1',
      agentHarness: 'opencode',
      model: 'gpt',
      workingDir: '/repo',
    });
  });

  it('enters apply-error on a partial failure, and startAnyway starts with the applied count', async () => {
    mocks.data = twoRoleFixture();
    mocks.saveConfig.mockImplementation((args: { role: string }) =>
      args.role === 'reviewer'
        ? Promise.reject(new Error('harness missing'))
        : Promise.resolve(undefined)
    );
    const { result, start } = renderFlow();
    await act(async () => {
      result.current.requestStart();
    });

    await act(async () => {
      result.current.dialogProps.onUseFavourites();
    });

    expect(result.current.phase).toBe('apply-error');
    expect(start).not.toHaveBeenCalled();
    expect(result.current.dialogProps.failures).toEqual([
      { role: 'reviewer', workspaceLabel: 'laptop:/repo', message: 'harness missing' },
    ]);

    await act(async () => {
      result.current.dialogProps.onStartAnyway();
    });

    expect(start).toHaveBeenCalledWith({ appliedCount: 1 });
  });

  it('clears apply failures when a new flow starts', async () => {
    mocks.data = twoRoleFixture();
    mocks.saveConfig.mockImplementation((args: { role: string }) =>
      args.role === 'reviewer'
        ? Promise.reject(new Error('harness missing'))
        : Promise.resolve(undefined)
    );
    const { result } = renderFlow();
    await act(async () => {
      result.current.requestStart();
    });

    await act(async () => {
      result.current.dialogProps.onUseFavourites();
    });
    expect(result.current.phase).toBe('apply-error');

    await act(async () => {
      result.current.dialogProps.onCancel();
    });
    expect(result.current.phase).toBe('idle');

    await act(async () => {
      result.current.requestStart();
    });

    await waitFor(() => expect(result.current.phase).toBe('prompt'));
    expect(result.current.dialogProps.failures).toEqual([]);
  });

  it('returns to idle on cancel without saving or starting', async () => {
    mocks.data = fixture();
    const { result, start } = renderFlow();
    await act(async () => {
      result.current.requestStart();
    });

    await act(async () => {
      result.current.dialogProps.onCancel();
    });

    expect(result.current.phase).toBe('idle');
    expect(start).not.toHaveBeenCalled();
    expect(mocks.saveConfig).not.toHaveBeenCalled();
  });

  it('falls back to starting with a warning when a query errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.data = { ...fixture(), status: new Error('boom') };
    const { result, phases, start } = renderFlow();

    await act(async () => {
      result.current.requestStart();
    });

    expect(start).toHaveBeenCalledWith({ appliedCount: 0 });
    expect(phases).not.toContain('prompt');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('starts with the current configuration without prompting when a detail query errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.data = {
      ...fixture(),
      favorites: { 'm1|team_trio#role_builder': new Error('forbidden') },
    };
    const { result, phases, start } = renderFlow();

    await act(async () => {
      result.current.requestStart();
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({ appliedCount: 0 });
    expect(phases).not.toContain('prompt');
    expect(result.current.dialogProps.open).toBe(false);
    expect(mocks.saveConfig).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('falls back to starting without a prompt after the 4s timeout', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.data = { ...fixture(), requests: {} };
    const { result, phases, start } = renderFlow();

    await act(async () => {
      result.current.requestStart();
    });
    expect(start).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(3999);
    });
    expect(start).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({ appliedCount: 0 });
    expect(phases).not.toContain('prompt');
    warn.mockRestore();
  });

  it('clears the timer on unmount', async () => {
    vi.useFakeTimers();
    mocks.data = { ...fixture(), requests: {} };
    const { result, start, unmount } = renderFlow();

    await act(async () => {
      result.current.requestStart();
    });
    unmount();

    await act(async () => {
      vi.advanceTimersByTime(4000);
    });

    expect(start).not.toHaveBeenCalled();
  });

  it('ignores requestStart while a start is still in flight', async () => {
    mocks.data = matchingFixture();
    let releaseStart!: () => void;
    const start = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseStart = resolve;
        })
    );
    const { result } = renderFlow(start);

    await act(async () => {
      result.current.requestStart();
    });
    expect(result.current.phase).toBe('starting');
    expect(start).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.requestStart();
    });
    expect(result.current.phase).toBe('starting');
    expect(start).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseStart();
    });
    expect(result.current.phase).toBe('idle');
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('reports busy while checking', async () => {
    vi.useFakeTimers();
    mocks.data = { ...fixture(), requests: {} };
    const { result, unmount } = renderFlow();

    await act(async () => {
      result.current.requestStart();
    });

    expect(result.current.phase).toBe('checking');
    expect(result.current.isBusy).toBe(true);
    unmount();
  });

  it('never prompts for a running role', async () => {
    mocks.data = { ...fixture(), status: [{ role: 'builder', isRunning: true }] };
    const { result, phases, start } = renderFlow();

    await act(async () => {
      result.current.requestStart();
    });

    expect(start).toHaveBeenCalledWith({ appliedCount: 0 });
    expect(phases).not.toContain('prompt');
  });
});
