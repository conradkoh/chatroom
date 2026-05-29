import { describe, it, expect, vi } from 'vitest';

import { isProcessAlive } from './process.js';

describe('isProcessAlive', () => {
  it('returns true when kill(pid, 0) succeeds', () => {
    const kill = vi.fn();
    expect(isProcessAlive(kill, 5678)).toBe(true);
    expect(kill).toHaveBeenCalledWith(5678, 0);
  });

  it('returns false when kill(pid, 0) throws', () => {
    const kill = vi.fn(() => {
      throw new Error('ESRCH');
    });
    expect(isProcessAlive(kill, 5678)).toBe(false);
    expect(kill).toHaveBeenCalledWith(5678, 0);
  });
});
