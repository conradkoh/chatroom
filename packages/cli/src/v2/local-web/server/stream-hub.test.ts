import { describe, expect, it } from 'vitest';

import { createStreamHub } from './stream-hub.js';

describe('createStreamHub', () => {
  it('delivers published events to subscribers', () => {
    const hub = createStreamHub();
    const received: { line: string }[] = [];

    const unsubscribe = hub.subscribe((event) => {
      received.push({ line: event.line });
    });

    hub.publish({
      type: 'harness.stream',
      harness: 'h1',
      stream: 'stdout',
      line: 'hello',
      timestamp: 1,
    });

    expect(received).toEqual([{ line: 'hello' }]);

    unsubscribe();
    hub.publish({
      type: 'harness.stream',
      harness: 'h1',
      stream: 'stdout',
      line: 'ignored',
      timestamp: 2,
    });

    expect(received).toHaveLength(1);
  });
});
