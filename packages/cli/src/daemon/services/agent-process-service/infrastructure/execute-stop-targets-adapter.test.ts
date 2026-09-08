import { describe, expect, test } from 'vitest';

import {
  createChatroomScopeBarrier,
  isChatroomStopScopeActive,
  resetChatroomScopeBarrierForTests,
} from './execute-stop-targets-adapter.js';

describe('execute-stop-targets-adapter', () => {
  test('barrier tracks active chatrooms and releases', async () => {
    resetChatroomScopeBarrierForTests();
    const barrier = createChatroomScopeBarrier();
    const release = await barrier.acquire('room');
    expect(typeof release).toBe('function');
    release();
  });
  test('barrier stays active until all scopes release', async () => {
    resetChatroomScopeBarrierForTests();
    const barrier = createChatroomScopeBarrier();
    const releaseA = await barrier.acquire('room');
    const releaseB = await barrier.acquire('room');
    expect(isChatroomStopScopeActive('room')).toBe(true);
    releaseA();
    expect(isChatroomStopScopeActive('room')).toBe(true);
    releaseB();
    expect(isChatroomStopScopeActive('room')).toBe(false);
  });
});
