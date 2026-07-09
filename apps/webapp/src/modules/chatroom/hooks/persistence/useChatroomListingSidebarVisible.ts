'use client';

import { usePersistedState } from '../usePersistedState';

const STORAGE_KEY = 'chatroom:listingSidebarVisible';

export function useChatroomListingSidebarVisible(): [boolean, (visible: boolean) => void] {
  return usePersistedState<boolean>(STORAGE_KEY, true);
}
