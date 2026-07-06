'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { isValidTwoPaneLayout } from '../twoPaneLayout';
import { usePersistedState } from '../usePersistedState';

const STORAGE_KEY = (chatroomId: string) => `chatroom:${chatroomId}:explorerSplitSizes`;
const DEFAULT_SIZES: [number, number] = [55, 45];

export function useExplorerSplitPanelSizes(
  chatroomId: Id<'chatroom_rooms'>
): [[number, number], (sizes: [number, number]) => void] {
  return usePersistedState<[number, number]>(STORAGE_KEY(chatroomId as string), DEFAULT_SIZES, {
    validate: isValidTwoPaneLayout,
  });
}
