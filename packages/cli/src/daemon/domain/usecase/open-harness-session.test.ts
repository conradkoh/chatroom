import { describe, it, expect } from 'vitest';

import { openSession } from './open-harness-session.js';
import type { OpenSessionDeps, OpenSessionInput } from './open-harness-session.js';

describe('openSession (deprecated)', () => {
  it('throws with deprecation message', async () => {
    const deps = {} as OpenSessionDeps;
    const input = {} as OpenSessionInput;

    await expect(openSession(deps, input)).rejects.toThrow('openSession is deprecated');
  });
});
