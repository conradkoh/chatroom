/**
 * status handler Unit Tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DaemonContext } from '../types.js';
import { handleStatus } from './status.js';

describe('handleStatus', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns JSON status with machine info', () => {
    const ctx = {
      config: {
        hostname: 'test-machine',
        os: 'darwin',
        availableHarnesses: ['opencode'],
      },
    } as unknown as DaemonContext;

    const result = handleStatus(ctx);

    expect(result.failed).toBe(false);
    const parsed = JSON.parse(result.result);
    expect(parsed.hostname).toBe('test-machine');
    expect(parsed.os).toBe('darwin');
    expect(parsed.availableHarnesses).toEqual(['opencode']);
  });

  it('handles null config gracefully', () => {
    const ctx = { config: null } as unknown as DaemonContext;

    const result = handleStatus(ctx);

    expect(result.failed).toBe(false);
    const parsed = JSON.parse(result.result);
    expect(parsed.hostname).toBeUndefined();
  });

  it('handles config with empty harnesses', () => {
    const ctx = {
      config: {
        hostname: 'test',
        os: 'linux',
        availableHarnesses: [],
      },
    } as unknown as DaemonContext;

    const result = handleStatus(ctx);

    const parsed = JSON.parse(result.result);
    expect(parsed.availableHarnesses).toEqual([]);
  });
});
