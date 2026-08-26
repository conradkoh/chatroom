import { describe, expect, it } from 'vitest';

import { createEventStreamHub } from './event-stream-hub.js';

describe('createEventStreamHub', () => {
  it('publishes and unsubscribes', () => {
    const hub = createEventStreamHub();
    const received: number[] = [];
    const unsub = hub.subscribe((event) => received.push(event.id));
    hub.publish({
      id: 1,
      timestamp: 1,
      type: 'test',
      payload: { type: 'test', timestamp: 1, chatroomId: 'room' },
    });
    unsub();
    hub.publish({
      id: 2,
      timestamp: 2,
      type: 'test',
      payload: { type: 'test', timestamp: 2, chatroomId: 'room' },
    });
    expect(received).toEqual([1]);
  });
});
