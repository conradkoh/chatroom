import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMachineConfigFavorites } from './useMachineConfigFavorites';

const mockUseSessionQuery = vi.fn((_query: unknown, _args: unknown) => ({ favorites: [] }));
const mockUseSessionMutation = vi.fn(() => vi.fn());

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (query: unknown, args: unknown) => mockUseSessionQuery(query, args),
  useSessionMutation: () => mockUseSessionMutation(),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    machineConfigFavorites: {
      getMachineConfigFavorites: 'machineConfigFavorites:getMachineConfigFavorites',
      setMachineConfigFavorites: 'machineConfigFavorites:setMachineConfigFavorites',
    },
  },
}));

describe('useMachineConfigFavorites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSessionQuery.mockReturnValue({ favorites: [] });
  });

  it('skips query when scope is undefined', () => {
    renderHook(() => useMachineConfigFavorites(undefined));

    expect(mockUseSessionQuery).toHaveBeenCalledWith(
      'machineConfigFavorites:getMachineConfigFavorites',
      'skip'
    );
  });

  it('skips query when teamId is empty', () => {
    renderHook(() =>
      useMachineConfigFavorites({
        machineId: 'm1',
        chatroomId: 'room1',
        teamId: '',
        role: 'planner',
      })
    );

    expect(mockUseSessionQuery).toHaveBeenCalledWith(
      'machineConfigFavorites:getMachineConfigFavorites',
      'skip'
    );
  });

  it('queries favorites when scope is complete', () => {
    renderHook(() =>
      useMachineConfigFavorites({
        machineId: 'machine-a',
        chatroomId: 'room1',
        teamId: 'duo',
        role: 'planner',
      })
    );

    expect(mockUseSessionQuery).toHaveBeenCalledWith(
      'machineConfigFavorites:getMachineConfigFavorites',
      {
        machineId: 'machine-a',
        teamRoleKey: 'chatroom_room1#team_duo#role_planner',
      }
    );
  });
});
