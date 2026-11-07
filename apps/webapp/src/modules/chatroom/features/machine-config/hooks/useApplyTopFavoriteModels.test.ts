import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useApplyTopFavoriteModels,
  type ApplyTopFavoritesTarget,
} from './useApplyTopFavoriteModels';

const mocks = vi.hoisted(() => ({
  /** Key: `${machineId}|${teamRoleKey}`. `undefined` means the query is still loading. */
  favoritesByKey: {} as Record<string, { agentHarness: string; model: string }[] | undefined>,
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
  useSessionMutation: () => mocks.saveConfig,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    machineConfigFavorites: {
      getMachineConfigFavorites: 'machineConfigFavorites:getMachineConfigFavorites',
    },
    agents: { saveConfig: 'agents:saveConfig' },
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
    expect(mocks.saveConfig).not.toHaveBeenCalled();
  });

  it('applies each role top favourite with the workspace save arguments', async () => {
    mocks.favoritesByKey['m1|team_duo#role_planner'] = [
      { agentHarness: 'claude', model: 'opus' },
      { agentHarness: 'opencode', model: 'gpt' },
    ];
    mocks.favoritesByKey['m1|team_duo#role_builder'] = [];
    mocks.saveConfig.mockResolvedValue(null);

    const { result } = renderHook(() => useApplyTopFavoriteModels(duoTarget));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.topFavorites).toEqual([
      { role: 'planner', entry: { agentHarness: 'claude', model: 'opus' } },
    ]);

    let applied: unknown;
    await act(async () => {
      applied = await result.current.apply();
    });

    expect(mocks.saveConfig).toHaveBeenCalledTimes(1);
    expect(mocks.saveConfig).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      workspaceId: 'ws-1',
      role: 'planner',
      machineId: 'm1',
      agentHarness: 'claude',
      model: 'opus',
      workingDir: '/repo',
    });
    expect(applied).toEqual({
      applied: [{ role: 'planner', entry: { agentHarness: 'claude', model: 'opus' } }],
      failed: [],
    });
  });

  it('keeps applying other roles when one save rejects', async () => {
    mocks.favoritesByKey['m1|team_duo#role_planner'] = [{ agentHarness: 'claude', model: 'opus' }];
    mocks.favoritesByKey['m1|team_duo#role_builder'] = [{ agentHarness: 'opencode', model: 'gpt' }];
    mocks.saveConfig.mockImplementation((args: { role: string }) =>
      args.role === 'planner' ? Promise.reject(new Error('harness missing')) : Promise.resolve(null)
    );

    const { result } = renderHook(() => useApplyTopFavoriteModels(duoTarget));

    let applied: unknown;
    await act(async () => {
      applied = await result.current.apply();
    });

    expect(applied).toEqual({
      applied: [{ role: 'builder', entry: { agentHarness: 'opencode', model: 'gpt' } }],
      failed: [{ role: 'planner', message: 'harness missing' }],
    });
  });

  it('guards against a second apply while one is in flight', async () => {
    mocks.favoritesByKey['m1|team_duo#role_planner'] = [{ agentHarness: 'claude', model: 'opus' }];
    mocks.favoritesByKey['m1|team_duo#role_builder'] = [{ agentHarness: 'opencode', model: 'gpt' }];
    const resolvers: ((value: null) => void)[] = [];
    mocks.saveConfig.mockImplementation(
      () =>
        new Promise<null>((resolve) => {
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
    expect(mocks.saveConfig).toHaveBeenCalledTimes(2);
    expect(mocks.saveConfig.mock.calls.map(([args]) => args.role)).toEqual(['planner', 'builder']);

    expect(resolvers).toHaveLength(2);
    act(() => {
      for (const resolve of resolvers) resolve(null);
    });
    await waitFor(() => expect(result.current.isApplying).toBe(false));
    expect(first).not.toBeNull();
  });

  it('re-keys favourites when the team changes', () => {
    mocks.favoritesByKey['m1|team_duo#role_planner'] = [{ agentHarness: 'claude', model: 'opus' }];
    mocks.favoritesByKey['m1|team_duo#role_builder'] = [];
    mocks.favoritesByKey['m1|team_solo#role_solo'] = [{ agentHarness: 'claude', model: 'sonnet' }];

    const { result, rerender } = renderHook(
      ({ target }: { target: ApplyTopFavoritesTarget }) => useApplyTopFavoriteModels(target),
      { initialProps: { target: duoTarget } }
    );

    expect(result.current.topFavorites).toEqual([
      { role: 'planner', entry: { agentHarness: 'claude', model: 'opus' } },
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
      { role: 'solo', entry: { agentHarness: 'claude', model: 'sonnet' } },
    ]);
  });
});
