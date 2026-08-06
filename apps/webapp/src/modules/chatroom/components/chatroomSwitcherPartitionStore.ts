// fallow-ignore-file unused-file
import { observable, type Observable } from '@legendapp/state';

import { CHATROOM_SWITCHER_PARTITION_KEY } from './chatroomSwitcherPartitionKey';

import type { ChatroomWithStatus } from '@/modules/chatroom/context/ChatroomListingContext';

export type ChatroomSwitcherPartitionStatus = 'idle' | 'loading' | 'ready';

export type ChatroomSwitcherPartitionState = {
  partitionKey: string;
  status: ChatroomSwitcherPartitionStatus;
  /** Incremented on each preload start — guards against stale async writes. */
  generation: number;
};

/** Non-reactive cache — chatroom list must not live in Legend observables. */
const preloadChatroomsByPartitionKey = new Map<string, ChatroomWithStatus[]>();

let entry: { state$: Observable<ChatroomSwitcherPartitionState>; refCount: number } | null = null;

export function getChatroomSwitcherPreloadChatrooms(partitionKey: string): ChatroomWithStatus[] {
  return preloadChatroomsByPartitionKey.get(partitionKey) ?? [];
}

export function acquireChatroomSwitcherPartition(): Observable<ChatroomSwitcherPartitionState> {
  if (!entry) {
    entry = {
      state$: observable({
        partitionKey: CHATROOM_SWITCHER_PARTITION_KEY,
        status: 'idle',
        generation: 0,
      }),
      refCount: 0,
    };
  }
  entry.refCount += 1;
  return entry.state$;
}

export function releaseChatroomSwitcherPartition(): void {
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    entry = null;
    preloadChatroomsByPartitionKey.delete(CHATROOM_SWITCHER_PARTITION_KEY);
  }
}

/** Bump generation and return new value for preload guard. */
export function beginChatroomSwitcherPreload(
  state$: Observable<ChatroomSwitcherPartitionState>
): number {
  const partitionKey = state$.partitionKey.get();
  const next = state$.generation.get() + 1;
  state$.generation.set(next);
  state$.status.set('loading');
  preloadChatroomsByPartitionKey.set(partitionKey, []);
  return next;
}

export function commitChatroomSwitcherPreload(
  state$: Observable<ChatroomSwitcherPartitionState>,
  generation: number,
  chatrooms: ChatroomWithStatus[]
): void {
  if (state$.generation.get() !== generation) return;
  preloadChatroomsByPartitionKey.set(state$.partitionKey.get(), chatrooms);
  state$.status.set('ready');
}

// fallow-ignore-next-line unused-export
export function resetChatroomSwitcherPartitionRegistryForTests(): void {
  entry = null;
  preloadChatroomsByPartitionKey.clear();
}

// fallow-ignore-next-line unused-export
export function getChatroomSwitcherPartitionForTests():
  Observable<ChatroomSwitcherPartitionState> | undefined {
  return entry?.state$;
}

// fallow-ignore-next-line unused-export
export function getChatroomSwitcherPartitionRefCountForTests(): number {
  return entry?.refCount ?? 0;
}
