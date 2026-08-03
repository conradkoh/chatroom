import { renderHook } from '@testing-library/react';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useHandoffGitRefresh, type HandoffGitRefreshWorkspace } from './useHandoffGitRefresh';

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: vi.fn(),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatrooms: {
      listUnreadStatus: 'listUnreadStatus',
    },
  },
}));

const mockUseSessionQuery = useSessionQuery as ReturnType<typeof vi.fn>;

const CHATROOM_ID = 'chatroom-1';
const COOLDOWN_MS = 5000;

function makeWorkspace(
  overrides: Partial<HandoffGitRefreshWorkspace> & { id?: string } = {}
): HandoffGitRefreshWorkspace {
  return {
    machineId: 'machineId' in overrides ? overrides.machineId! : 'machine-1',
    workingDir: overrides.workingDir ?? '/proj',
    removedAt: overrides.removedAt,
  };
}

function setUnreadHandoff(hasUnreadHandoff: boolean) {
  mockUseSessionQuery.mockReturnValue([{ chatroomId: CHATROOM_ID, hasUnreadHandoff }]);
}

describe('useHandoffGitRefresh', () => {
  const requestGitRefresh = vi.fn().mockResolvedValue(undefined);
  let now = 1_000_000;

  beforeEach(() => {
    vi.clearAllMocks();
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    setUnreadHandoff(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls requestGitRefresh for each active workspace on false→true transition', () => {
    const workspaces = [
      makeWorkspace({ machineId: 'm1', workingDir: '/a' }),
      makeWorkspace({ machineId: 'm2', workingDir: '/b' }),
      makeWorkspace({ machineId: 'm3', workingDir: '/c', removedAt: 1 }),
      makeWorkspace({ machineId: null, workingDir: '/d' }),
    ];

    const { rerender } = renderHook(
      ({ handoff }) => {
        mockUseSessionQuery.mockReturnValue([
          { chatroomId: CHATROOM_ID, hasUnreadHandoff: handoff },
        ]);
        useHandoffGitRefresh(CHATROOM_ID, workspaces, requestGitRefresh, COOLDOWN_MS);
      },
      { initialProps: { handoff: false } }
    );

    expect(requestGitRefresh).not.toHaveBeenCalled();

    rerender({ handoff: true });

    expect(requestGitRefresh).toHaveBeenCalledTimes(2);
    expect(requestGitRefresh).toHaveBeenCalledWith({
      machineId: 'm1',
      workingDir: '/a',
    });
    expect(requestGitRefresh).toHaveBeenCalledWith({
      machineId: 'm2',
      workingDir: '/b',
    });
  });

  it('does not refresh when hasUnreadHandoff stays false', () => {
    const workspaces = [makeWorkspace()];

    const { rerender } = renderHook(
      ({ handoff }) => {
        mockUseSessionQuery.mockReturnValue([
          { chatroomId: CHATROOM_ID, hasUnreadHandoff: handoff },
        ]);
        useHandoffGitRefresh(CHATROOM_ID, workspaces, requestGitRefresh, COOLDOWN_MS);
      },
      { initialProps: { handoff: false } }
    );

    rerender({ handoff: false });
    expect(requestGitRefresh).not.toHaveBeenCalled();
  });

  it('does not refresh again when hasUnreadHandoff stays true', () => {
    const workspaces = [makeWorkspace()];

    const { rerender } = renderHook(
      ({ handoff }) => {
        mockUseSessionQuery.mockReturnValue([
          { chatroomId: CHATROOM_ID, hasUnreadHandoff: handoff },
        ]);
        useHandoffGitRefresh(CHATROOM_ID, workspaces, requestGitRefresh, COOLDOWN_MS);
      },
      { initialProps: { handoff: true } }
    );

    expect(requestGitRefresh).toHaveBeenCalledTimes(1);

    rerender({ handoff: true });
    expect(requestGitRefresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes all active workspaces once on mount when hasUnreadHandoff is already true', () => {
    const workspaces = [
      makeWorkspace({ machineId: 'm1', workingDir: '/a' }),
      makeWorkspace({ machineId: 'm2', workingDir: '/b' }),
    ];

    setUnreadHandoff(true);
    renderHook(() => useHandoffGitRefresh(CHATROOM_ID, workspaces, requestGitRefresh, COOLDOWN_MS));

    expect(requestGitRefresh).toHaveBeenCalledTimes(2);
    expect(requestGitRefresh).toHaveBeenCalledWith({
      machineId: 'm1',
      workingDir: '/a',
    });
    expect(requestGitRefresh).toHaveBeenCalledWith({
      machineId: 'm2',
      workingDir: '/b',
    });
  });

  it('cooldown prevents back-to-back refresh', () => {
    const workspaces = [makeWorkspace()];

    const { rerender } = renderHook(
      ({ handoff }) => {
        mockUseSessionQuery.mockReturnValue([
          { chatroomId: CHATROOM_ID, hasUnreadHandoff: handoff },
        ]);
        useHandoffGitRefresh(CHATROOM_ID, workspaces, requestGitRefresh, COOLDOWN_MS);
      },
      { initialProps: { handoff: false } }
    );

    rerender({ handoff: true });
    expect(requestGitRefresh).toHaveBeenCalledTimes(1);

    now += 1000;
    rerender({ handoff: false });
    rerender({ handoff: true });
    expect(requestGitRefresh).toHaveBeenCalledTimes(1);

    now += COOLDOWN_MS;
    rerender({ handoff: false });
    rerender({ handoff: true });
    expect(requestGitRefresh).toHaveBeenCalledTimes(2);
  });
});
