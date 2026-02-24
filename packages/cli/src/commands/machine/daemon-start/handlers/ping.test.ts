/**
 * ping handler Unit Tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handlePing } from './ping.js';

describe('handlePing', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns pong with failed=false', () => {
    const result = handlePing();

    expect(result.result).toBe('pong');
    expect(result.failed).toBe(false);
  });

  it('logs the response', () => {
    handlePing();

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('pong'));
  });
});
