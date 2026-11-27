import { act, render } from '@testing-library/react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ChatroomWorkspaceProvider,
  useChatroomWorkspace,
  type ChatroomWorkspaceContextValue,
} from './ChatroomWorkspaceContext';

const mockUseChatroomWorkspaces = vi.fn();
const mockSwitchWorkspaceMutation = vi.fn();
const mockSetPrimaryWorkspaceMutation = vi.fn();
const mockRemoveWorkspaceMutation = vi.fn();
/** Stands in for the `getPrimaryWorkspaceForChatroom` subscription result. */
const mockPrimaryResult: { current: { _id: string } | null } = { current: null };

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => mockPrimaryResult.current,
  useSessionMutation: (reference: string) => {
    if (reference === 'workspaces:switchWorkspace') return mockSwitchWorkspaceMutation;
    if (reference === 'workspaces:setPrimaryWorkspaceForChatroom') {
      return mockSetPrimaryWorkspaceMutation;
    }
    return mockRemoveWorkspaceMutation;
  },
}));

vi.mock('@/modules/chatroom/workspace/hooks/useChatroomWorkspaces', () => ({
  useChatroomWorkspaces: () => mockUseChatroomWorkspaces(),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaces: {
      switchWorkspace: 'workspaces:switchWorkspace',
      getPrimaryWorkspaceForChatroom: 'workspaces:getPrimaryWorkspaceForChatroom',
      setPrimaryWorkspaceForChatroom: 'workspaces:setPrimaryWorkspaceForChatroom',
      removeWorkspace: 'workspaces:removeWorkspace',
    },
  },
}));

const CHATROOM_ID = 'jd7testchatroom0000000000000001' as Id<'chatroom_rooms'>;

const WORKSPACE = {
  id: 'm1::/code/app',
  machineId: 'm1',
  hostname: 'laptop',
  machineAlias: undefined,
  workingDir: '/code/app',
  agentRoles: [],
  fileTreeSyncEnabled: true,
  _registryId: 'ws_1',
};

let context: ChatroomWorkspaceContextValue | null = null;

function Probe() {
  context = useChatroomWorkspace();
  return null;
}

function renderProvider() {
  return render(
    <ChatroomWorkspaceProvider chatroomId={CHATROOM_ID}>
      <Probe />
    </ChatroomWorkspaceProvider>
  );
}

describe('ChatroomWorkspaceContext.switchWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    context = null;
    mockPrimaryResult.current = { _id: 'ws_1' };
    mockUseChatroomWorkspaces.mockReturnValue({ workspaces: [WORKSPACE], isLoading: false });
    mockSwitchWorkspaceMutation.mockResolvedValue({ outcome: 'switched' });
  });

  it('sends the active workspace registry id as expectedWorkspaceId', async () => {
    renderProvider();

    await act(async () => {
      await context!.switchWorkspace('m2', '/srv/x');
    });

    expect(mockSwitchWorkspaceMutation).toHaveBeenCalledTimes(1);
    expect(mockSwitchWorkspaceMutation).toHaveBeenCalledWith({
      chatroomId: CHATROOM_ID,
      machineId: 'm2',
      workingDir: '/srv/x',
      expectedWorkspaceId: 'ws_1',
    });
  });

  it('sends null when the chatroom has no active workspace', async () => {
    mockPrimaryResult.current = null;
    renderProvider();

    await act(async () => {
      await context!.switchWorkspace('m2', '/srv/x');
    });

    expect(mockSwitchWorkspaceMutation).toHaveBeenCalledWith({
      chatroomId: CHATROOM_ID,
      machineId: 'm2',
      workingDir: '/srv/x',
      expectedWorkspaceId: null,
    });
  });

  it('propagates a mutation rejection unchanged', async () => {
    const err = new Error('boom');
    mockSwitchWorkspaceMutation.mockRejectedValue(err);
    renderProvider();

    await expect(context!.switchWorkspace('m2', '/srv/x')).rejects.toBe(err);
  });
});
