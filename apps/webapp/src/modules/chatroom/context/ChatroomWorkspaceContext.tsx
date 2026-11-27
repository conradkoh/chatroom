'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { FunctionReturnType } from 'convex/server';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

import type { Workspace } from '../types/workspace';
import { useChatroomWorkspaces } from '../workspace/hooks/useChatroomWorkspaces';

/** The switch use case's result, as the mutation returns it. */
export type SwitchWorkspaceResult = FunctionReturnType<typeof api.workspaces.switchWorkspace>;

export interface ChatroomWorkspaceContextValue {
  chatroomId: Id<'chatroom_rooms'>;
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  isLoading: boolean;
  setPrimaryWorkspace: (workspaceId: string) => Promise<void>;
  removeWorkspace: (workspaceId: string) => Promise<void>;
  /** Moves the chatroom to machineId + workingDir. expectedWorkspaceId is read from activeWorkspace at call time. Errors propagate unchanged. */
  switchWorkspace: (machineId: string, workingDir: string) => Promise<SwitchWorkspaceResult>;
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
  const removeWorkspaceMutation = useSessionMutation(api.workspaces.removeWorkspace);
  const switchWorkspaceMutation = useSessionMutation(api.workspaces.switchWorkspace);

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

  const removeWorkspace = useCallback(
    async (workspaceId: string) => {
      await removeWorkspaceMutation({
        workspaceId: workspaceId as Id<'chatroom_workspaces'>,
      });
    },
    [removeWorkspaceMutation]
  );

  const switchWorkspace = useCallback(
    (machineId: string, workingDir: string) =>
      switchWorkspaceMutation({
        chatroomId,
        machineId,
        workingDir,
        expectedWorkspaceId: (activeWorkspace?._registryId ??
          null) as Id<'chatroom_workspaces'> | null,
      }),
    [activeWorkspace, chatroomId, switchWorkspaceMutation]
  );

  const value = useMemo<ChatroomWorkspaceContextValue>(
    () => ({
      chatroomId,
      workspaces,
      activeWorkspace,
      isLoading: isLoadingWorkspaces || primaryResult === undefined,
      setPrimaryWorkspace,
      removeWorkspace,
      switchWorkspace,
    }),
    [
      activeWorkspace,
      chatroomId,
      isLoadingWorkspaces,
      primaryResult,
      removeWorkspace,
      setPrimaryWorkspace,
      switchWorkspace,
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
