import { spawn } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOutputStore, ensureTempDir } from './output-store.js';
import type { SpawnDeps } from './spawner.js';
import type { BackendOps } from '../../../../../infrastructure/deps/index.js';
import type { SessionId } from '../../types.js';

vi.mock('../../../../../api.js', () => ({
  api: {
    commands: {
      appendOutput: 'mock-appendOutput',
      updateRunTailV2: 'mock-updateRunTailV2',
      listRunsWithLogObservers: 'mock-listRunsWithLogObservers',
      clearPendingFullOutputSync: 'mock-clearPendingFullOutputSync',
      updateRunStatus: 'mock-updateRunStatus',
    },
  },
}));

vi.mock('@workspace/backend/src/output-encoding.js', () => ({
  encodeOutput: vi.fn((plain: string) => ({
    compression: 'gzip' as const,
    content: `gzip:${plain}`,
  })),
}));

vi.mock('./output-store.js', () => ({
  createOutputStore: vi.fn(),
  ensureTempDir: vi.fn().mockResolvedValue(undefined),
  TAIL_WINDOW_BYTES: 32 * 1024,
  MAX_TAIL_LINES_V2: 50,
}));

vi.mock('./log-observer-sync.js', () => ({
  isRunLogObserved: vi.fn(() => true),
  consumePendingFullSync: vi.fn(() => false),
}));

type MutationFn = (endpoint: any, args: any) => Promise<any>;

function createSpawnDeps(mutationImpl?: MutationFn): SpawnDeps {
  return {
    sessionId: 'test-session' as SessionId,
    machineId: 'test-machine',
    convexUrl: 'https://chatroom-cloud.duskfare.com',
    backend: {
      mutation: mutationImpl
        ? vi.fn().mockImplementation(mutationImpl as any)
        : vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue(undefined),
    } as BackendOps,
  };
}

function createMockStore(initialContent = '') {
  let inMemory = initialContent;
  let totalBytes = initialContent.length;
  return {
    append: vi.fn().mockImplementation(async (data: string) => {
      inMemory += data;
      totalBytes += data.length;
    }),
    getTail: vi.fn().mockImplementation(() => ({
      content: inMemory,
      totalBytes,
    })),
    getLastNLines: vi.fn().mockImplementation(async (n: number) => {
      const lines = inMemory.split('\n');
      const slice = lines.slice(-n);
      const content = slice.join('\n');
      return { content, totalBytes: content.length, lineCount: slice.length };
    }),
    getFullOutput: vi.fn().mockImplementation(async () => inMemory),
    destroy: vi.fn().mockResolvedValue(undefined),
    _setContent: (content: string) => {
      inMemory = content;
      totalBytes = content.length;
    },
  };
}

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

describe('spawnCommandProcess — new output flow', () => {
  let deps: SpawnDeps;
  let mockStore: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    deps = createSpawnDeps();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockStore = createMockStore();
    vi.mocked(createOutputStore).mockReturnValue(mockStore as any);
    vi.mocked(ensureTempDir).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function makeFakeChild() {
    const stdoutListeners: Record<string, ((...args: any[]) => void)[]> = {};
    const stderrListeners: Record<string, ((...args: any[]) => void)[]> = {};
    const exitListeners: ((...args: any[]) => void)[] = [];
    const errorListeners: ((...args: any[]) => void)[] = [];
    return {
      pid: 99999,
      on: (event: string, fn: (...args: any[]) => void) => {
        if (event === 'exit') exitListeners.push(fn);
        else if (event === 'error') errorListeners.push(fn);
      },
      stdout: {
        on: (event: string, fn: (...args: any[]) => void) => {
          (stdoutListeners[event] ??= []).push(fn);
        },
        emit: (event: string, ...args: any[]) => {
          stdoutListeners[event]?.forEach((fn: (...args: any[]) => void) => fn(...args));
        },
      } as any,
      stderr: {
        on: (event: string, fn: (...args: any[]) => void) => {
          (stderrListeners[event] ??= []).push(fn);
        },
        emit: (event: string, ...args: any[]) => {
          stderrListeners[event]?.forEach((fn: (...args: any[]) => void) => fn(...args));
        },
      } as any,
      _exit: (...args: any[]) => exitListeners.forEach((fn) => fn(...args)),
      _error: (...args: any[]) => errorListeners.forEach((fn) => fn(...args)),
    };
  }

  it('calls updateRunTailV2 on flush when observed, not appendOutput during run', async () => {
    vi.useFakeTimers();
    const fakeChild = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as any);

    const { spawnCommandProcess } = await import('./spawner.js');
    await spawnCommandProcess(
      deps,
      { workingDir: '/tmp', commandName: 'test', script: 'echo hi', runId: 'run-1' as any },
      'key-1'
    );

    fakeChild.stdout.emit('data', Buffer.from('hello output'));
    await vi.advanceTimersByTimeAsync(3_500);

    const tailCalls = vi
      .mocked(deps.backend.mutation as any)
      .mock.calls.filter((c: any) => c[0] === 'mock-updateRunTailV2');
    expect(tailCalls.length).toBeGreaterThanOrEqual(1);

    const appendCalls = vi
      .mocked(deps.backend.mutation as any)
      .mock.calls.filter((c: any) => c[0] === 'mock-appendOutput');
    expect(appendCalls).toHaveLength(0);
  });

  it('does not appendOutput on exit when full sync was not requested', async () => {
    vi.useFakeTimers();
    const fakeChild = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as any);

    const fullContent = 'a'.repeat(50 * 1024);
    mockStore._setContent(fullContent);

    const { isRunLogObserved, consumePendingFullSync } = await import('./log-observer-sync.js');
    vi.mocked(isRunLogObserved).mockReturnValue(true);
    vi.mocked(consumePendingFullSync).mockReturnValue(false);

    const { spawnCommandProcess } = await import('./spawner.js');
    await spawnCommandProcess(
      deps,
      { workingDir: '/tmp', commandName: 'test', script: 'echo hi', runId: 'run-2' as any },
      'key-2'
    );

    fakeChild._exit(0, null);

    await vi.runAllTimersAsync();

    const appendCalls = vi
      .mocked(deps.backend.mutation as any)
      .mock.calls.filter((c: any) => c[0] === 'mock-appendOutput');
    expect(appendCalls).toHaveLength(0);
    expect(mockStore.destroy).toHaveBeenCalled();
  });

  it('forces final tail flush on exit even when run is not observed', async () => {
    vi.useFakeTimers();
    const fakeChild = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as any);

    // Simulate a command nobody is currently watching.
    const { isRunLogObserved, consumePendingFullSync } = await import('./log-observer-sync.js');
    vi.mocked(isRunLogObserved).mockReturnValue(false);
    vi.mocked(consumePendingFullSync).mockReturnValue(false);

    const { spawnCommandProcess } = await import('./spawner.js');
    await spawnCommandProcess(
      deps,
      { workingDir: '/tmp', commandName: 'test', script: 'exit 1', runId: 'run-5' as any },
      'key-5'
    );

    // Produce some output, then the command exits (e.g. failed) while unobserved.
    fakeChild.stdout.emit('data', Buffer.from('last few lines'));
    fakeChild._exit(1, null);
    await vi.runAllTimersAsync();

    const tailCalls = vi
      .mocked(deps.backend.mutation as any)
      .mock.calls.filter((c: any) => c[0] === 'mock-updateRunTailV2');
    // Without the force fix this is 0 (gated by isRunLogObserved=false); with it, the
    // final flush still syncs the tail.
    expect(tailCalls.length).toBe(1);
  });

  it('flushes final chunks via appendOutput on exit when full sync was requested', async () => {
    vi.useFakeTimers();
    const fakeChild = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as any);

    const fullContent = 'hello final output';
    mockStore._setContent(fullContent);

    const { consumePendingFullSync } = await import('./log-observer-sync.js');
    vi.mocked(consumePendingFullSync).mockReturnValue(true);

    const { spawnCommandProcess } = await import('./spawner.js');
    await spawnCommandProcess(
      deps,
      { workingDir: '/tmp', commandName: 'test', script: 'echo hi', runId: 'run-3' as any },
      'key-3'
    );

    fakeChild._exit(0, null);
    await vi.runAllTimersAsync();

    const appendCalls = vi
      .mocked(deps.backend.mutation as any)
      .mock.calls.filter((c: any) => c[0] === 'mock-appendOutput');
    expect(appendCalls.length).toBe(1);
    const content = (appendCalls[0][1] as any).content;
    expect(content.compression).toBe('gzip');
    expect(content.content).toBe('gzip:hello final output');
  });

  it('updates run status after final flush', async () => {
    vi.useFakeTimers();
    const fakeChild = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as any);

    const { spawnCommandProcess } = await import('./spawner.js');
    await spawnCommandProcess(
      deps,
      { workingDir: '/tmp', commandName: 'test', script: 'echo hi', runId: 'run-4' as any },
      'key-4'
    );

    fakeChild._exit(0, null);
    await vi.runAllTimersAsync();

    const statusCalls = vi
      .mocked(deps.backend.mutation as any)
      .mock.calls.filter((c: any) => c[0] === 'mock-updateRunStatus');
    expect(statusCalls.length).toBe(1);
    expect((statusCalls[0][1] as any).status).toBe('completed');
  });
});
