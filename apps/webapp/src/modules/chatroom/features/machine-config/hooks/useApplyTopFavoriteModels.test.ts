import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useApplyTopFavoriteModels,
  type ApplyTopFavoritesTarget,
} from './useApplyTopFavoriteModels';

const mocks = vi.hoisted(() => ({
  /** Key: `${machineId}|${teamRoleKey}`. `undefined` means the query is still loading. */
  favoritesByKey: {} as Record<string, { agentHarness: string; model: string }[] | undefined>,
  applyConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

vi.mock('convex/react', () => ({
  useQueries: (queries: Record<string, { args: { machineId: string; teamRoleKey: string } }>) =>
    Object.fromEntries(
      Object.entries(queries).map(([key, { args }]) => {
        const favorites = mocks.favoritesByKey[`${args.machineId}|${args.teamRoleKey}`];
        return [key, favorites === undefined ? undefined : { favorites }];
      })
    ),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1'],
  useSessionMutation: (ref: unknown) =>
    ref === 'agents:applyConfig' ? mocks.applyConfig : mocks.saveConfig,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    machineConfigFavorites: {
      getMachineConfigFavorites: 'machineConfigFavorites:getMachineConfigFavorites',
    },
    agents: { applyConfig: 'agents:applyConfig', saveConfig: 'agents:saveConfig' },
  },
}));

const duoTarget: ApplyTopFavoritesTarget = {
  chatroomId: 'room-1',
  workspaceId: 'ws-1',
  machineId: 'm1',
  workingDir: '/repo',
  teamId: 'duo',
  roles: ['planner', 'builder'],
};

describe('useApplyTopFavoriteModels', () => {
  beforeEach(() => {
    mocks.favoritesByKey = {};
    mocks.applyConfig.mockReset();
    mocks.saveConfig.mockReset();
  });

  it('does nothing without a target', async () => {
    const { result } = renderHook(() => useApplyTopFavoriteModels(null));

    expect(result.current.topFavorites).toEqual([]);
    expect(result.current.isLoading).toBe(false);

    let applied: unknown;
    await act(async () => {
      applied = await result.current.apply();
    });

    expect(applied).toBeNull();
    expect(mocks.applyConfig).not.toHaveBeenCalled();
    expect(mocks.saveConfig).not.toHaveBeenCalled();
  });

  it('applies each role top favourite with applyConfig and the workspace arguments', async () => {
    mocks.favoritesByKey['m1|team_duo#role_planner'] = [
      { agentHarness: 'claude-sdk', model: 'opus' },
      { agentHarness: 'opencode-sdk', model: 'gpt' },
    ];
    mocks.favoritesByKey['m1|team_duo#role_builder'] = [];
    mocks.applyConfig.mockResolvedValue({ outcome: 'restarted' });

    const { result } = renderHook(() => useApplyTopFavoriteModels(duoTarget));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.topFavorites).toEqual([
      { role: 'planner', entry: { agentHarness: 'claude-sdk', model: 'opus' } },
    ]);

    let applied: unknown;
    await act(async () => {
      applied = await result.current.apply();
    });

    expect(mocks.applyConfig).toHaveBeenCalledTimes(1);
    expect(mocks.applyConfig).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      workspaceId: 'ws-1',
      role: 'planner',
      agentHarness: 'claude-sdk',
      model: 'opus',
    });
    expect(mocks.saveConfig).not.toHaveBeenCalled();
    expect(applied).toEqual({
      applied: [
        {
          role: 'planner',
          entry: { agentHarness: 'claude-sdk', model: 'opus' },
          outcome: 'restarted',
        },
      ],
      failed: [],
    });
  });

  it('keeps applying other roles when one apply rejects', async () => {
    mocks.favoritesByKey['m1|team_duo#role_planner'] = [
      { agentHarness: 'claude-sdk', model: 'opus' },
    ];
    mocks.favoritesByKey['m1|team_duo#role_builder'] = [
      { agentHarness: 'opencode-sdk', model: 'gpt' },
    ];
    mocks.applyConfig.mockImplementation((args: { role: string }) =>
      args.role === 'planner'
        ? Promise.reject(new Error('harness missing'))
        : Promise.resolve({ outcome: 'saved' })
    );

    const { result } = renderHook(() => useApplyTopFavoriteModels(duoTarget));

    let applied: unknown;
    await act(async () => {
      applied = await result.current.apply();
    });

    expect(applied).toEqual({
      applied: [
        {
          role: 'builder',
          entry: { agentHarness: 'opencode-sdk', model: 'gpt' },
          outcome: 'saved',
        },
      ],
      failed: [{ role: 'planner', message: 'harness missing' }],
    });
  });

  it('guards against a second apply while one is in flight', async () => {
    mocks.favoritesByKey['m1|team_duo#role_planner'] = [
      { agentHarness: 'claude-sdk', model: 'opus' },
    ];
    mocks.favoritesByKey['m1|team_duo#role_builder'] = [
      { agentHarness: 'opencode-sdk', model: 'gpt' },
    ];
    const resolvers: ((value: { outcome: 'restarted' }) => void)[] = [];
    mocks.applyConfig.mockImplementation(
      () =>
        new Promise<{ outcome: 'restarted' }>((resolve) => {
          resolvers.push(resolve);
        })
    );

    const { result } = renderHook(() => useApplyTopFavoriteModels(duoTarget));

    let first: unknown;
    let second: unknown;
    act(() => {
      void result.current.apply().then((value) => {
        first = value;
      });
    });
    await act(async () => {
      second = await result.current.apply();
    });

    expect(second).toBeNull();
    expect(mocks.applyConfig).toHaveBeenCalledTimes(2);
    expect(mocks.applyConfig.mock.calls.map(([args]) => args.role)).toEqual(['planner', 'builder']);

    expect(resolvers).toHaveLength(2);
    act(() => {
      for (const resolve of resolvers) resolve({ outcome: 'restarted' });
    });
    await waitFor(() => expect(result.current.isApplying).toBe(false));
    expect(first).not.toBeNull();
  });

  it('re-keys favourites when the team changes', () => {
    mocks.favoritesByKey['m1|team_duo#role_planner'] = [
      { agentHarness: 'claude-sdk', model: 'opus' },
    ];
    mocks.favoritesByKey['m1|team_duo#role_builder'] = [];
    mocks.favoritesByKey['m1|team_solo#role_solo'] = [
      { agentHarness: 'claude-sdk', model: 'sonnet' },
    ];

    const { result, rerender } = renderHook(
      ({ target }: { target: ApplyTopFavoritesTarget }) => useApplyTopFavoriteModels(target),
      { initialProps: { target: duoTarget } }
    );

    expect(result.current.topFavorites).toEqual([
      { role: 'planner', entry: { agentHarness: 'claude-sdk', model: 'opus' } },
    ]);

    rerender({
      target: {
        chatroomId: 'room-1',
        workspaceId: 'ws-1',
        machineId: 'm1',
        workingDir: '/repo',
        teamId: 'solo',
        roles: ['solo'],
      },
    });

    expect(result.current.topFavorites).toEqual([
      { role: 'solo', entry: { agentHarness: 'claude-sdk', model: 'sonnet' } },
    ]);
  });
});
