import { describe, expect, test } from 'vitest';

import { createChatroomScopeBarrier } from './stop-agent-scope-adapter.js';

describe('stop-agent-scope-adapter', () => {
  test('barrier tracks active chatrooms and releases', async () => {
    const barrier = createChatroomScopeBarrier();
    const release = await barrier.acquire('room');
    expect(typeof release).toBe('function');
    release();
  });
});
