'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

import type { Workspace } from '../types/workspace';
import { useChatroomWorkspaces } from '../workspace/hooks/useChatroomWorkspaces';

export interface ChatroomWorkspaceContextValue {
  chatroomId: Id<'chatroom_rooms'>;
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  isLoading: boolean;
  setPrimaryWorkspace: (workspaceId: string) => Promise<void>;
}

const ChatroomWorkspaceContext = createContext<ChatroomWorkspaceContextValue | null>(null);

export function ChatroomWorkspaceProvider({
  chatroomId,
  children,
}: {
  chatroomId: Id<'chatroom_rooms'>;
  children: ReactNode;
}) {
  const { workspaces, isLoading: isLoadingWorkspaces } = useChatroomWorkspaces(chatroomId);
  const primaryResult = useSessionQuery(api.workspaces.getPrimaryWorkspaceForChatroom, {
    chatroomId,
  });
  const setPrimaryWorkspaceMutation = useSessionMutation(
    api.workspaces.setPrimaryWorkspaceForChatroom
  );

  const activeWorkspace = useMemo(() => {
    if (!primaryResult) return null;
    return workspaces.find((workspace) => workspace._registryId === primaryResult._id) ?? null;
  }, [primaryResult, workspaces]);

  const setPrimaryWorkspace = useCallback(
    async (workspaceId: string) => {
      await setPrimaryWorkspaceMutation({
        chatroomId,
        workspaceId: workspaceId as Id<'chatroom_workspaces'>,
      });
    },
    [chatroomId, setPrimaryWorkspaceMutation]
  );

  const value = useMemo<ChatroomWorkspaceContextValue>(
    () => ({
      chatroomId,
      workspaces,
      activeWorkspace,
      isLoading: isLoadingWorkspaces || primaryResult === undefined,
      setPrimaryWorkspace,
    }),
    [
      activeWorkspace,
      chatroomId,
      isLoadingWorkspaces,
      primaryResult,
      setPrimaryWorkspace,
      workspaces,
    ]
  );

  return (
    <ChatroomWorkspaceContext.Provider value={value}>{children}</ChatroomWorkspaceContext.Provider>
  );
}

export function useChatroomWorkspace(): ChatroomWorkspaceContextValue {
  const context = useContext(ChatroomWorkspaceContext);
  if (!context) {
    throw new Error('useChatroomWorkspace must be used within ChatroomWorkspaceProvider');
  }
  return context;
}
