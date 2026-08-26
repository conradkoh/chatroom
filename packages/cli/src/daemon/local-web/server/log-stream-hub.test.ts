import { describe, expect, it } from 'vitest';
import { createLogStreamHub } from './log-stream-hub.js';
describe('createLogStreamHub', () => {
  it('publishes and unsubscribes', () => {
    const hub = createLogStreamHub();
    const received: string[] = [];
    const unsub = hub.subscribe((event) => received.push(event.message));
    hub.publish({ timestamp: 1, level: 'info', source: 'test', message: 'hello' });
    unsub();
    hub.publish({ timestamp: 2, level: 'info', source: 'test', message: 'ignored' });
    expect(received).toEqual(['hello']);
  });
});
