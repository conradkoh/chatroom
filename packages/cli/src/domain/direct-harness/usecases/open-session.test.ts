import { describe, it, expect } from 'vitest';

import { openSession } from './open-session.js';
import type { OpenSessionDeps, OpenSessionInput } from './open-session.js';

describe('openSession (deprecated)', () => {
  it('throws with deprecation message', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deps = {} as OpenSessionDeps;
    const input = {} as OpenSessionInput;

    await expect(openSession(deps, input)).rejects.toThrow('openSession is deprecated');
  });
});
