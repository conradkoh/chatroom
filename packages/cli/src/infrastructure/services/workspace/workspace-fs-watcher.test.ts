import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkspaceFsWatcher } from './workspace-fs-watcher.js';

const watchListeners: ((eventType: string, filename: string) => void)[] = [];
const mockClose = vi.fn();

vi.mock('node:fs', () => ({
  watch: vi.fn((_path: string, optionsOrListener: unknown, maybeListener?: unknown) => {
    const listener =
      typeof optionsOrListener === 'function'
        ? (optionsOrListener as (eventType: string, filename: string) => void)
        : (maybeListener as (eventType: string, filename: string) => void);

    watchListeners.push(listener);
    return { close: mockClose };
  }),
}));

describe('workspace-fs-watcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    watchListeners.length = 0;
    mockClose.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces refresh callbacks and filters by active dirs', async () => {
    const onRefreshDirs = vi.fn().mockResolvedValue(undefined);

    createWorkspaceFsWatcher({
      workingDir: '/workspace',
      activeDirPaths: new Set(['', 'src']),
      onRefreshDirs,
      debounceMs: 400,
    });

    expect(watchListeners.length).toBeGreaterThan(0);
    const listener = watchListeners[0]!;
    listener('change', 'package.json');

    expect(onRefreshDirs).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);

    expect(onRefreshDirs).toHaveBeenCalledWith(['']);
  });

  it('ignores events under excluded directories', async () => {
    const onRefreshDirs = vi.fn().mockResolvedValue(undefined);

    createWorkspaceFsWatcher({
      workingDir: '/workspace',
      activeDirPaths: new Set(['', 'src']),
      onRefreshDirs,
      debounceMs: 400,
    });

    watchListeners[0]!('change', '.git/HEAD');
    await vi.advanceTimersByTimeAsync(400);

    expect(onRefreshDirs).not.toHaveBeenCalled();
  });

  it('stops watchers on stop()', () => {
    const handle = createWorkspaceFsWatcher({
      workingDir: '/workspace',
      activeDirPaths: new Set(['']),
      onRefreshDirs: vi.fn(),
    });

    handle.stop();

    expect(mockClose).toHaveBeenCalled();
  });
});
