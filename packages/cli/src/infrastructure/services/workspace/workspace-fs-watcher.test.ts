import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkspaceFsWatcher, isTooManyOpenFilesError } from './workspace-fs-watcher.js';

const mocks = vi.hoisted(() => ({ close: vi.fn(async () => undefined) }));
let emitter: EventEmitter;
let watchOptions: Record<string, unknown> | undefined;

vi.mock('chokidar', () => ({
  watch: vi.fn((_root: string, options: Record<string, unknown>) => {
    watchOptions = options;
    emitter = new EventEmitter();
    Object.assign(emitter, { close: mocks.close });
    return emitter;
  }),
}));

describe('workspace-fs-watcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.close.mockClear();
    watchOptions = undefined;
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

  it('passes gitignore paths to chokidar ignored callback', () => {
    createWorkspaceFsWatcher({
      workingDir: '/workspace',
      onEvents: vi.fn(),
      shouldIgnore: (relativePath) => relativePath.startsWith('vendor/'),
    });

    const ignored = watchOptions?.ignored as (watchPath: string) => boolean;
    expect(ignored('/workspace/vendor/pkg/index.js')).toBe(true);
    expect(ignored('/workspace/src/index.ts')).toBe(false);
  });

  it('disables symlink following in chokidar options', () => {
    createWorkspaceFsWatcher({
      workingDir: '/workspace',
      onEvents: vi.fn(),
    });

    expect(watchOptions?.followSymlinks).toBe(false);
  });

  it('detects EMFILE watcher errors', () => {
    expect(isTooManyOpenFilesError(new Error('EMFILE: too many open files, watch'))).toBe(true);
    expect(isTooManyOpenFilesError(Object.assign(new Error('fail'), { code: 'EMFILE' }))).toBe(
      true
    );
    expect(isTooManyOpenFilesError(new Error('other'))).toBe(false);
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
