import { describe, expect, it } from 'vitest';

import { createProcessSpawnPort } from './process-spawn.js';
import { spawnCommandProcess } from '../../entry/handlers/process/spawner.js';

describe('createProcessSpawnPort', () => {
  it('exposes spawnCommandProcess from the legacy spawner', () => {
    const port = createProcessSpawnPort();
    expect(port.spawnCommandProcess).toBe(spawnCommandProcess);
  });
});
