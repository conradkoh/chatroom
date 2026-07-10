import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkspaceFsWatcher } from './workspace-fs-watcher.js';

const mocks = vi.hoisted(() => ({ close: vi.fn(async () => undefined) }));
let emitter: EventEmitter;

vi.mock('chokidar', () => ({
  watch: vi.fn(() => {
    emitter = new EventEmitter();
    Object.assign(emitter, { close: mocks.close });
    return emitter;
  }),
}));

describe('workspace-fs-watcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.close.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces and coalesces path events', async () => {
    const onEvents = vi.fn().mockResolvedValue(undefined);

    createWorkspaceFsWatcher({
      workingDir: '/workspace',
      onEvents,
      debounceMs: 400,
    });

    emitter.emit('add', '/workspace/package.json');
    emitter.emit('change', '/workspace/package.json');

    expect(onEvents).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);

    expect(onEvents).toHaveBeenCalledWith([{ kind: 'change', path: 'package.json' }]);
  });

  it('ignores events under excluded directories', async () => {
    const onEvents = vi.fn().mockResolvedValue(undefined);

    createWorkspaceFsWatcher({
      workingDir: '/workspace',
      onEvents,
      debounceMs: 400,
    });

    emitter.emit('change', '/workspace/.git/HEAD');
    await vi.advanceTimersByTimeAsync(400);

    expect(onEvents).not.toHaveBeenCalled();
  });

  it('supports caller-provided ignore rules', async () => {
    const onEvents = vi.fn().mockResolvedValue(undefined);
    createWorkspaceFsWatcher({
      workingDir: '/workspace',
      onEvents,
      shouldIgnore: (relativePath) => relativePath.startsWith('generated/'),
      debounceMs: 400,
    });

    emitter.emit('add', '/workspace/generated/output.ts');
    await vi.advanceTimersByTimeAsync(400);

    expect(onEvents).not.toHaveBeenCalled();
  });

  it('stops the chokidar watcher', async () => {
    const handle = createWorkspaceFsWatcher({
      workingDir: '/workspace',
      onEvents: vi.fn(),
    });

    await handle.stop();

    expect(mocks.close).toHaveBeenCalled();
  });

  it('reports watcher and callback errors', async () => {
    const error = new Error('watch failed');
    const onError = vi.fn();

    createWorkspaceFsWatcher({
      workingDir: '/workspace',
      onEvents: async () => {
        throw error;
      },
      onError,
      debounceMs: 10,
    });

    emitter.emit('error', error);
    emitter.emit('add', '/workspace/file.ts');
    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(error);
  });
});
