import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useStartAllRemoteAgents } from './useStartAllRemoteAgents';

const mocks = vi.hoisted(() => ({
  /** Convex query fixtures. A key left out means that query is still loading (undefined). */
  data: {} as Record<string, any>,
  requestOperation: vi.fn(),
  saveConfig: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  /** Key count of every `useQueries` call, in order. The palette path must record only 0s. */
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
  useSessionMutation: (ref: string) =>
    ref === 'agents:requestChatroomAgentOperation' ? mocks.requestOperation : mocks.saveConfig,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatrooms: { getTeamStructureForChatroom: 'chatrooms:getTeamStructureForChatroom' },
    workspaces: { listWorkspacesForChatroom: 'workspaces:listWorkspacesForChatroom' },
    agents: {
      listStatus: 'agents:listStatus',
      listLastSentLaunchRequests: 'agents:listLastSentLaunchRequests',
      saveConfig: 'agents:saveConfig',
      requestChatroomAgentOperation: 'agents:requestChatroomAgentOperation',
    },
    machines: { getMachineCapabilities: 'machines:getMachineCapabilities' },
    machineConfigFavorites: {
      getMachineConfigFavorites: 'machineConfigFavorites:getMachineConfigFavorites',
    },
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mocks.toastSuccess(...args),
    error: (...args: unknown[]) => mocks.toastError(...args),
  },
}));

/** One builder on machine m1 that runs claude/opus; its top favourite is opencode/gpt → mismatch. */
function mismatchFixture() {
  return {
    structure: { teamId: 'trio', roles: [{ role: 'builder' }, { role: 'user' }] },
    workspaces: [{ _id: 'ws-1', machineId: 'm1', workingDir: '/repo', hostname: 'laptop' }],
    status: [{ role: 'builder', isRunning: false }],
    capabilities: { m1: { availableHarnesses: ['claude', 'opencode'] } },
    favorites: {
      'm1|team_trio#role_builder': { favorites: [{ agentHarness: 'opencode', model: 'gpt' }] },
    },
    requests: {
      'ws-1': [{ role: 'builder', agentHarness: 'claude', model: 'opus', workingDir: '/repo' }],
    },
  };
}

/** Same fixture, but the launch request already uses the top favourite → no mismatch. */
function matchingFixture() {
  const data = mismatchFixture();
  data.requests['ws-1'] = [
    { role: 'builder', agentHarness: 'opencode', model: 'gpt', workingDir: '/repo' },
  ];
  return data;
}

function renderStartAll() {
  return renderHook(() => useStartAllRemoteAgents({ chatroomId: 'room-1' }));
}

describe('useStartAllRemoteAgents', () => {
  beforeEach(() => {
    mocks.data = {};
    mocks.queryCalls = [];
    mocks.requestOperation.mockReset();
    mocks.requestOperation.mockResolvedValue({
      requested: [{ role: 'builder' }],
      skipped: [],
      failed: [],
    });
    mocks.saveConfig.mockReset();
    mocks.saveConfig.mockResolvedValue(undefined);
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
  });

  describe('command palette path', () => {
    it('starts unprompted even when a favourite mismatch exists, and never runs the check', async () => {
      mocks.data = mismatchFixture();
      const { result } = renderStartAll();

      await act(() => result.current.startAllFromPalette());

      expect(mocks.requestOperation).toHaveBeenCalledTimes(1);
      expect(mocks.requestOperation).toHaveBeenCalledWith({
        chatroomId: 'room-1',
        operation: 'start',
      });
      expect(mocks.saveConfig).not.toHaveBeenCalled();
      expect(result.current.dialogProps.open).toBe(false);
      expect(mocks.queryCalls.every((count) => count === 0)).toBe(true);
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Start requested for 1 agent(s)');
    });

    it('toasts a failed start and reports the error without a prompt', async () => {
      mocks.requestOperation.mockResolvedValue({
        requested: [],
        skipped: [],
        failed: [{ role: 'builder' }],
      });
      const { result } = renderStartAll();

      await act(() => result.current.startAllFromPalette());

      expect(mocks.toastError).toHaveBeenCalledWith('Failed to start 1 agent(s)');
    });

    it('toasts the error message when the start request throws', async () => {
      mocks.requestOperation.mockRejectedValue(new Error('backend down'));
      const { result } = renderStartAll();

      await act(() => result.current.startAllFromPalette());

      expect(mocks.toastError).toHaveBeenCalledWith('backend down');
      expect(result.current.isBusy).toBe(false);
    });
  });

  describe('agents sidebar path', () => {
    it('starts immediately with no dialog when every starting agent is on its favourite', async () => {
      mocks.data = matchingFixture();
      const { result } = renderStartAll();

      act(() => result.current.requestStartAllFromAgentsSidebar());

      await waitFor(() => expect(mocks.requestOperation).toHaveBeenCalledTimes(1));
      expect(result.current.dialogProps.open).toBe(false);
      expect(mocks.saveConfig).not.toHaveBeenCalled();
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Start requested for 1 agent(s)');
    });

    it('opens the dialog on a mismatch and starts nothing until the user chooses', async () => {
      mocks.data = mismatchFixture();
      const { result } = renderStartAll();

      act(() => result.current.requestStartAllFromAgentsSidebar());

      await waitFor(() => expect(result.current.dialogProps.open).toBe(true));
      expect(result.current.dialogProps.mismatches).toHaveLength(1);
      expect(mocks.requestOperation).not.toHaveBeenCalled();
      expect(mocks.saveConfig).not.toHaveBeenCalled();
    });

    it('Start with current starts without saving anything', async () => {
      mocks.data = mismatchFixture();
      const { result } = renderStartAll();
      act(() => result.current.requestStartAllFromAgentsSidebar());
      await waitFor(() => expect(result.current.dialogProps.open).toBe(true));

      act(() => result.current.dialogProps.onStartWithCurrent());

      await waitFor(() => expect(mocks.requestOperation).toHaveBeenCalledTimes(1));
      expect(mocks.saveConfig).not.toHaveBeenCalled();
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Start requested for 1 agent(s)');
    });

    it('Use favourites saves before starting and reports the applied count', async () => {
      mocks.data = mismatchFixture();
      const { result } = renderStartAll();
      act(() => result.current.requestStartAllFromAgentsSidebar());
      await waitFor(() => expect(result.current.dialogProps.open).toBe(true));

      act(() => result.current.dialogProps.onUseFavourites());

      await waitFor(() => expect(mocks.requestOperation).toHaveBeenCalledTimes(1));
      expect(mocks.saveConfig).toHaveBeenCalledTimes(1);
      expect(mocks.saveConfig.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.requestOperation.mock.invocationCallOrder[0]
      );
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        'Applied favourites to 1 agent(s). Start requested for 1 agent(s).'
      );
    });

    it('Cancel starts nothing and saves nothing', async () => {
      mocks.data = mismatchFixture();
      const { result } = renderStartAll();
      act(() => result.current.requestStartAllFromAgentsSidebar());
      await waitFor(() => expect(result.current.dialogProps.open).toBe(true));

      act(() => result.current.dialogProps.onCancel());

      await waitFor(() => expect(result.current.dialogProps.open).toBe(false));
      expect(result.current.isBusy).toBe(false);
      expect(mocks.requestOperation).not.toHaveBeenCalled();
      expect(mocks.saveConfig).not.toHaveBeenCalled();
    });
  });
});
