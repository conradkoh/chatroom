import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../api.js', () => ({
  api: {
    commands: {
      appendOutput: 'mock-appendOutput',
    },
  },
}));

import type { DaemonContext } from '../../types.js';
import { MAX_BUFFER_SIZE } from './state.js';

type MutationFn = (endpoint: any, args: any) => Promise<any>;

function createCtx(mutationImpl?: MutationFn): DaemonContext {
  return {
    sessionId: 'test-session',
    machineId: 'test-machine',
    client: {} as any,
    config: null,
    deps: {
      backend: {
        mutation: mutationImpl
          ? vi.fn().mockImplementation(mutationImpl as any)
          : vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue(undefined),
      },
      processes: { kill: vi.fn() },
      fs: { stat: vi.fn() as any },
      machine: {
        clearAgentPid: vi.fn(),
        persistAgentPid: vi.fn(),
        listAgentEntries: vi.fn().mockResolvedValue([]),
        persistEventCursor: vi.fn(),
        loadEventCursor: vi.fn().mockResolvedValue(null),
      },
      clock: {
        now: vi.fn().mockReturnValue(Date.now()),
        delay: vi.fn().mockResolvedValue(undefined),
      },
      spawning: {
        shouldAllowSpawn: vi.fn().mockReturnValue({ allowed: true }),
        recordSpawn: vi.fn(),
        recordExit: vi.fn(),
        getConcurrentCount: vi.fn().mockReturnValue(0),
      },
      agentProcessManager: {
        ensureRunning: vi.fn(),
        stop: vi.fn(),
        handleExit: vi.fn(),
        recover: vi.fn(),
        getSlot: vi.fn(),
        listActive: vi.fn().mockReturnValue([]),
      } as any,
    },
    events: { emit: vi.fn() } as any,
    agentServices: new Map(),
    lastPushedGitState: new Map(),
    lastPushedModels: null,
    lastPushedHarnessFingerprint: null,
  };
}

function buildContent(size: number): string {
  return 'a'.repeat(size);
}

import { spawn } from 'node:child_process';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

describe('flushOutput slicing behavior', () => {
  let ctx: DaemonContext;

  beforeEach(() => {
    ctx = createCtx();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function makeFakeChild() {
    const stdoutListeners: Record<string, Array<(...args: any[]) => void>> = {};
    const stderrListeners: Record<string, Array<(...args: any[]) => void>> = {};
    return {
      pid: 99999,
      kill: vi.fn(),
      on: (event: string, fn: (...args: any[]) => void) => {},
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
    };
  }

  it('1. empty buffer — no mutation call', async () => {
    vi.useFakeTimers();
    const fakeChild = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as any);

    const { spawnCommandProcess } = await import('./spawner.js');
    spawnCommandProcess(
      ctx,
      {
        workingDir: '/tmp',
        commandName: 'test-empty',
        script: 'echo hi',
        runId: 'run-empty' as any,
      },
      'test-machine|/tmp|test-empty'
    );

    await vi.advanceTimersByTimeAsync(5_000);

    const appendCalls = vi
      .mocked(ctx.deps.backend.mutation as any)
      .mock.calls.filter((c: any) => c[0] === 'mock-appendOutput');
    expect(appendCalls).toHaveLength(0);
  });

  it('2. content exactly at MAX_BUFFER_SIZE — single slice', async () => {
    vi.useFakeTimers();
    const fakeChild = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as any);

    const { spawnCommandProcess } = await import('./spawner.js');
    spawnCommandProcess(
      ctx,
      {
        workingDir: '/tmp',
        commandName: 'test-exact',
        script: 'echo hi',
        runId: 'run-exact' as any,
      },
      'test-machine|/tmp|test-exact'
    );

    const exactContent = buildContent(MAX_BUFFER_SIZE);
    fakeChild.stdout.emit('data', Buffer.from(exactContent));

    await vi.advanceTimersByTimeAsync(5_000);

    const appendCalls = vi
      .mocked(ctx.deps.backend.mutation as any)
      .mock.calls.filter((c: any) => c[0] === 'mock-appendOutput');
    expect(appendCalls).toHaveLength(1);
    expect((appendCalls[0][1] as any).content.length).toBe(MAX_BUFFER_SIZE);
    expect((appendCalls[0][1] as any).chunkIndex).toBe(0);
  });

  it('3. 250KB content — 3 slices (100KB + 100KB + 50KB)', async () => {
    vi.useFakeTimers();
    const fakeChild = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as any);

    const { spawnCommandProcess } = await import('./spawner.js');
    spawnCommandProcess(
      ctx,
      {
        workingDir: '/tmp',
        commandName: 'test-250kb',
        script: 'echo hi',
        runId: 'run-250kb' as any,
      },
      'test-machine|/tmp|test-250kb'
    );

    const content250 = buildContent(250 * 1024);
    fakeChild.stdout.emit('data', Buffer.from(content250));

    await vi.advanceTimersByTimeAsync(5_000);

    const appendCalls = vi
      .mocked(ctx.deps.backend.mutation as any)
      .mock.calls.filter((c: any) => c[0] === 'mock-appendOutput');
    expect(appendCalls).toHaveLength(3);

    expect((appendCalls[0][1] as any).content.length).toBe(MAX_BUFFER_SIZE);
    expect((appendCalls[0][1] as any).chunkIndex).toBe(0);
    expect((appendCalls[1][1] as any).content.length).toBe(MAX_BUFFER_SIZE);
    expect((appendCalls[1][1] as any).chunkIndex).toBe(1);
    expect((appendCalls[2][1] as any).content.length).toBe(50 * 1024);
    expect((appendCalls[2][1] as any).chunkIndex).toBe(2);
  });

  it('4. multi-flush ordering — chunk indices grow monotonically across flushes', async () => {
    vi.useFakeTimers();
    const fakeChild = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as any);

    const { spawnCommandProcess } = await import('./spawner.js');
    spawnCommandProcess(
      ctx,
      {
        workingDir: '/tmp',
        commandName: 'test-multi',
        script: 'echo hi',
        runId: 'run-multi' as any,
      },
      'test-machine|/tmp|test-multi'
    );

    fakeChild.stdout.emit('data', Buffer.from('first-chunk'));
    await vi.advanceTimersByTimeAsync(3_500);

    fakeChild.stdout.emit('data', Buffer.from('second-chunk'));
    await vi.advanceTimersByTimeAsync(3_500);

    fakeChild.stdout.emit('data', Buffer.from('third-chunk'));
    await vi.advanceTimersByTimeAsync(3_500);

    const appendCalls = vi
      .mocked(ctx.deps.backend.mutation as any)
      .mock.calls.filter((c: any) => c[0] === 'mock-appendOutput');

    expect(appendCalls.length).toBeGreaterThanOrEqual(3);

    const indices: number[] = appendCalls.map((c: any) => (c[1] as any).chunkIndex);
    const sortedIndices = [...indices].sort((a: number, b: number) => a - b);
    expect(indices).toEqual(sortedIndices);
    expect(indices[0]).toBe(0);
    expect(indices[1]).toBe(1);
    expect(indices[2]).toBe(2);
  });

  it('5. partial failure — failed slices re-prepended, chunkIndex rewound, remaining slices NOT sent', async () => {
    vi.useFakeTimers();

    let mutationCallCount = 0;
    const failingCtx = createCtx(async (_endpoint: any, args: any) => {
      mutationCallCount++;
      if (args.chunkIndex === 1) {
        throw new Error('Simulated network failure on slice 1');
      }
    });

    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const fakeChild = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as any);

    const { spawnCommandProcess } = await import('./spawner.js');
    spawnCommandProcess(
      failingCtx,
      {
        workingDir: '/tmp',
        commandName: 'test-partial-fail',
        script: 'echo hi',
        runId: 'run-partial-fail' as any,
      },
      'test-machine|/tmp|test-partial-fail'
    );

    const content250 = buildContent(250 * 1024);
    fakeChild.stdout.emit('data', Buffer.from(content250));

    await vi.advanceTimersByTimeAsync(0);

    expect(mutationCallCount).toBe(2);

    const appendCalls = vi
      .mocked(failingCtx.deps.backend.mutation as any)
      .mock.calls.filter((c: any) => c[0] === 'mock-appendOutput');

    expect((appendCalls[0][1] as any).chunkIndex).toBe(0);
    expect((appendCalls[0][1] as any).content.length).toBe(MAX_BUFFER_SIZE);
    expect((appendCalls[1][1] as any).chunkIndex).toBe(1);
    expect((appendCalls[1][1] as any).content.length).toBe(MAX_BUFFER_SIZE);

    const slice2Attempts = appendCalls.filter(
      (c: any) => (c[1] as any).chunkIndex === 2
    );
    expect(slice2Attempts).toHaveLength(0);
  });

  it('6. retry contiguity — after partial failure + re-flush, chunk indices resume correctly', async () => {
    vi.useFakeTimers();

    let callCount = 0;
    const failingCtx = createCtx(async (_endpoint: any, args: any) => {
      callCount++;
      if (args.chunkIndex === 1 && callCount <= 2) {
        throw new Error('Simulated network failure on slice 1');
      }
    });

    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const fakeChild = makeFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as any);

    const { spawnCommandProcess } = await import('./spawner.js');
    spawnCommandProcess(
      failingCtx,
      {
        workingDir: '/tmp',
        commandName: 'test-retry',
        script: 'echo hi',
        runId: 'run-retry' as any,
      },
      'test-machine|/tmp|test-retry'
    );

    const content250 = buildContent(250 * 1024);
    fakeChild.stdout.emit('data', Buffer.from(content250));

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);

    const appendCalls = vi
      .mocked(failingCtx.deps.backend.mutation as any)
      .mock.calls.filter((c: any) => c[0] === 'mock-appendOutput');

    expect(appendCalls.length).toBe(4);

    expect((appendCalls[0][1] as any).chunkIndex).toBe(0);
    expect((appendCalls[1][1] as any).chunkIndex).toBe(1);
    expect((appendCalls[2][1] as any).chunkIndex).toBe(1);
    expect((appendCalls[3][1] as any).chunkIndex).toBe(2);

    const totalContent = appendCalls
      .slice(0, 1)
      .concat(appendCalls.slice(2))
      .reduce((sum: number, c: any) => sum + (c[1] as any).content.length, 0);
    expect(totalContent).toBe(250 * 1024);
  });
});
