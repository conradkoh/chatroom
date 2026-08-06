import { describe, expect, it, beforeEach } from 'vitest';

import {
  acquireChatroomSwitcherPartition,
  beginChatroomSwitcherPreload,
  commitChatroomSwitcherPreload,
  getChatroomSwitcherPartitionForTests,
  getChatroomSwitcherPartitionRefCountForTests,
  getChatroomSwitcherPreloadChatrooms,
  releaseChatroomSwitcherPartition,
  resetChatroomSwitcherPartitionRegistryForTests,
} from './chatroomSwitcherPartitionStore';

import type { ChatroomWithStatus } from '@/modules/chatroom/context/ChatroomListingContext';

const sampleChatrooms = [
  {
    _id: 'room-1',
    name: 'Alpha',
    teamName: 'Team A',
    chatStatus: 'active',
    isFavorite: false,
    hasUnread: false,
  },
] as ChatroomWithStatus[];

describe('chatroomSwitcherPartitionStore', () => {
  beforeEach(() => {
    resetChatroomSwitcherPartitionRegistryForTests();
  });

  it('acquire increments refCount and release deletes at zero', () => {
    acquireChatroomSwitcherPartition();
    expect(getChatroomSwitcherPartitionRefCountForTests()).toBe(1);

    acquireChatroomSwitcherPartition();
    expect(getChatroomSwitcherPartitionRefCountForTests()).toBe(2);

    releaseChatroomSwitcherPartition();
    expect(getChatroomSwitcherPartitionRefCountForTests()).toBe(1);
    expect(getChatroomSwitcherPartitionForTests()).toBeDefined();

    releaseChatroomSwitcherPartition();
    expect(getChatroomSwitcherPartitionForTests()).toBeUndefined();
  });

  it('generation guard discards stale commit', () => {
    const state$ = acquireChatroomSwitcherPartition();
    const gen1 = beginChatroomSwitcherPreload(state$);
    beginChatroomSwitcherPreload(state$);
    commitChatroomSwitcherPreload(state$, gen1, sampleChatrooms);

    expect(getChatroomSwitcherPreloadChatrooms(state$.partitionKey.get())).toEqual([]);
    expect(state$.status.get()).toBe('loading');
  });

  it('commit applies chatrooms when generation matches', () => {
    const state$ = acquireChatroomSwitcherPartition();
    const generation = beginChatroomSwitcherPreload(state$);
    commitChatroomSwitcherPreload(state$, generation, sampleChatrooms);

    expect(getChatroomSwitcherPreloadChatrooms(state$.partitionKey.get())).toEqual(sampleChatrooms);
    expect(state$.status.get()).toBe('ready');
  });

  it('singleton partition reuses same state$ across acquires', () => {
    const stateA$ = acquireChatroomSwitcherPartition();
    const stateB$ = acquireChatroomSwitcherPartition();

    expect(stateA$).toBe(stateB$);
    expect(stateA$.partitionKey.get()).toBe('global');

    const generation = beginChatroomSwitcherPreload(stateA$);
    commitChatroomSwitcherPreload(stateA$, generation, sampleChatrooms);

    expect(getChatroomSwitcherPreloadChatrooms('global')).toEqual(sampleChatrooms);
  });
});
