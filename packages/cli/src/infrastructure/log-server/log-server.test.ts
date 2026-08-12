import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createLogServer } from './log-server.js';
import { queryAfterId } from './log-store.js';

describe('log server', () => {
  it('flushes buffered writes', () => {
    const s = createLogServer(join(tmpdir(), `logs-${randomUUID()}.sqlite`));
    s.write({ timestamp: 1, level: 'info', source: 'harness:x', message: 'hello' });
    s.flush();
    expect(queryAfterId(s.db)).toHaveLength(1);
    s.close();
  });
});
