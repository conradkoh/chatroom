'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { usePersistedState } from '../usePersistedState';

const STORAGE_KEY = (chatroomId: string) => `chatroom:${chatroomId}:agentSidebarVisible`;

export function useAgentSidebarVisible(
  chatroomId: Id<'chatroom_rooms'>
): [boolean, (visible: boolean) => void] {
  return usePersistedState<boolean>(STORAGE_KEY(chatroomId as string), true);
}
