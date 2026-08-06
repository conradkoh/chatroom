import { describe, expect, it, vi } from 'vitest';

import { resolvePersistenceDbPath } from './persistence-path.js';

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/test'),
}));

describe('resolvePersistenceDbPath', () => {
  it('returns path under ~/.chatroom/daemon/<machineId>/events.sqlite', () => {
    expect(resolvePersistenceDbPath('machine-abc')).toBe(
      '/home/test/.chatroom/daemon/machine-abc/events.sqlite'
    );
  });
});
