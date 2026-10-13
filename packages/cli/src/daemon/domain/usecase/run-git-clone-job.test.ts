import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
  createGitCloneJobRunner,
  runGitCloneJob,
  type GitCloneJobDeps,
  type GitCloneResultReport,
} from './run-git-clone-job.js';
import type {
  GitCloneOutcome,
  GitCloneProgress,
} from '../../../infrastructure/local-actions/git-clone.js';

/** Spec values for throttling and keepalive. */
const PROGRESS_MIN_INTERVAL_MS = 1500;
const KEEPALIVE_MS = 30_000;

const INPUT = {
  repoUrl: 'https://github.com/acme/my-repo.git',
  targetPath: '/Users/me/src/my-repo',
};
const SUCCESS: GitCloneOutcome = { ok: true, clonedPath: INPUT.targetPath };

/** Deterministic clock shared by the job's throttle logic. */
function clock() {
  let t = 0;
  return {
    now: () => t,
    set: (ms: number) => {
      t = ms;
    },
  };
}

/** A runClone stand-in that calls `body` with the job's onProgress, then resolves with `outcome`. */
function cloneThat(
  body: (onProgress: (p: GitCloneProgress) => void) => void,
  outcome: GitCloneOutcome = SUCCESS
) {
  return vi.fn(async (opts: { onProgress: (p: GitCloneProgress) => void }) => {
    body(opts.onProgress);
    return outcome;
  });
}

/** Stand-in for setInterval. Reports each created keepalive and returns an opaque handle. */
function fakeSetInterval(
  onCreate: (cb: () => void, ms: number) => void = () => {},
  handle: ReturnType<typeof setInterval> = {} as ReturnType<typeof setInterval>
): typeof setInterval {
  return ((cb: () => void, ms: number) => {
    onCreate(cb, ms);
    return handle;
  }) as unknown as typeof setInterval;
}

type DepOverrides = Partial<Omit<GitCloneJobDeps, 'reportProgress' | 'reportResult'>> & {
  reportProgress?: Mock<(p: GitCloneProgress) => Promise<unknown>>;
  reportResult?: Mock<(r: GitCloneResultReport) => Promise<unknown>>;
};

/** Builds job deps with mocked reporters. Interval and clock default to deterministic stand-ins. */
function makeDeps(overrides: DepOverrides = {}) {
  return {
    reportProgress:
      overrides.reportProgress ??
      vi.fn<(p: GitCloneProgress) => Promise<unknown>>(async () => ({ ok: true })),
    reportResult:
      overrides.reportResult ??
      vi.fn<(r: GitCloneResultReport) => Promise<unknown>>(async () => ({ ok: true })),
    runClone: overrides.runClone,
    now: overrides.now ?? clock().now,
    setIntervalFn: overrides.setIntervalFn ?? fakeSetInterval(),
  };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('runGitCloneJob progress', () => {
  it('sends the Starting report immediately, before the clone runs', async () => {
    const deps = makeDeps({
      now: clock().now,
      runClone: vi.fn(() => new Promise<GitCloneOutcome>(() => {})),
    });

    void runGitCloneJob(deps, INPUT);

    expect(deps.reportProgress).toHaveBeenCalledWith({ phase: 'Starting' });
  });

  it('throttles same-phase progress to one report per interval and forces phase changes and 100%', async () => {
    const c = clock();
    const deps = makeDeps({
      now: c.now,
      setIntervalFn: fakeSetInterval(),
      runClone: cloneThat((onProgress) => {
        c.set(0);
        onProgress({ phase: 'Receiving objects', percent: 10 }); // phase change → sent
        c.set(500);
        onProgress({ phase: 'Receiving objects', percent: 20 }); // within interval → dropped
        c.set(PROGRESS_MIN_INTERVAL_MS + 100);
        onProgress({ phase: 'Receiving objects', percent: 30 }); // interval elapsed → sent
        c.set(PROGRESS_MIN_INTERVAL_MS + 200);
        onProgress({ phase: 'Receiving objects', percent: 40 }); // dropped
        c.set(PROGRESS_MIN_INTERVAL_MS + 300);
        onProgress({ phase: 'Resolving deltas', percent: 5 }); // phase change → sent
        onProgress({ phase: 'Resolving deltas', percent: 100 }); // 100% always sent
      }),
    });

    await runGitCloneJob(deps, INPUT);

    expect(deps.reportProgress.mock.calls.map(([p]) => p)).toEqual([
      { phase: 'Starting' },
      { phase: 'Receiving objects', percent: 10 },
      { phase: 'Receiving objects', percent: 30 },
      { phase: 'Resolving deltas', percent: 5 },
      { phase: 'Resolving deltas', percent: 100 },
    ]);
  });

  it('re-sends the last progress on each keepalive tick, and clears the timer when done', async () => {
    let keepaliveTick: (() => void) | undefined;
    let createdCount = 0;
    let keepaliveMs = 0;
    const handle = {} as ReturnType<typeof setInterval>;
    const setIntervalFn = fakeSetInterval((cb, ms) => {
      createdCount += 1;
      keepaliveTick = cb;
      keepaliveMs = ms;
    }, handle);
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    let finishClone: ((o: GitCloneOutcome) => void) | undefined;
    const deps = makeDeps({
      setIntervalFn,
      runClone: vi.fn(
        (opts: { onProgress: (p: GitCloneProgress) => void }) =>
          new Promise<GitCloneOutcome>((resolve) => {
            opts.onProgress({ phase: 'Receiving objects', percent: 42 });
            finishClone = resolve;
          })
      ),
    });

    const job = runGitCloneJob(deps, INPUT);
    await vi.waitFor(() => expect(finishClone).toBeDefined());
    expect(deps.reportProgress).toHaveBeenCalledTimes(2); // Starting + Receiving objects

    expect(createdCount).toBe(1);
    expect(keepaliveMs).toBe(KEEPALIVE_MS);
    keepaliveTick?.();
    expect(deps.reportProgress).toHaveBeenLastCalledWith({
      phase: 'Receiving objects',
      percent: 42,
    });
    expect(deps.reportProgress).toHaveBeenCalledTimes(3);

    finishClone?.(SUCCESS);
    await job;
    expect(clearIntervalSpy).toHaveBeenCalledWith(handle);
  });

  it('swallows progress report failures and still reports the result', async () => {
    const deps = makeDeps({
      now: clock().now,
      setIntervalFn: fakeSetInterval(),
      reportProgress: vi.fn(async () => {
        throw new Error('backend unavailable');
      }),
      runClone: cloneThat(() => {}),
    });

    await expect(runGitCloneJob(deps, INPUT)).resolves.toBeUndefined();

    expect(deps.reportResult).toHaveBeenCalledWith({
      status: 'completed',
      clonedPath: INPUT.targetPath,
    });
  });
});

describe('runGitCloneJob result reporting', () => {
  it('reports completed with the cloned path on success', async () => {
    const deps = makeDeps({
      now: clock().now,
      setIntervalFn: fakeSetInterval(),
      runClone: cloneThat(() => {}),
    });

    await runGitCloneJob(deps, INPUT);

    expect(deps.reportResult).toHaveBeenCalledTimes(1);
    expect(deps.reportResult).toHaveBeenCalledWith({
      status: 'completed',
      clonedPath: INPUT.targetPath,
    });
  });

  it('reports failed with the error code and message from the outcome', async () => {
    const deps = makeDeps({
      now: clock().now,
      setIntervalFn: fakeSetInterval(),
      runClone: cloneThat(() => {}, {
        ok: false,
        errorCode: 'auth',
        errorMessage: 'Authentication failed',
      }),
    });

    await runGitCloneJob(deps, INPUT);

    expect(deps.reportResult).toHaveBeenCalledWith({
      status: 'failed',
      errorCode: 'auth',
      errorMessage: 'Authentication failed',
    });
  });

  it('reports unknown failure when the runner throws unexpectedly', async () => {
    const deps = makeDeps({
      now: clock().now,
      setIntervalFn: fakeSetInterval(),
      runClone: vi.fn(async () => {
        throw new Error('boom');
      }),
    });

    await runGitCloneJob(deps, INPUT);

    expect(deps.reportResult).toHaveBeenCalledWith({
      status: 'failed',
      errorCode: 'unknown',
      errorMessage: 'boom',
    });
  });

  it('retries the result report with backoff until it succeeds on the third attempt', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const deps = makeDeps({
      now: clock().now,
      setIntervalFn: fakeSetInterval(),
      runClone: cloneThat(() => {}),
      reportResult: vi
        .fn()
        .mockRejectedValueOnce(new Error('timeout 1'))
        .mockRejectedValueOnce(new Error('timeout 2'))
        .mockResolvedValueOnce({ ok: true }),
    });

    const job = runGitCloneJob(deps, INPUT);
    await vi.advanceTimersByTimeAsync(1_000 + 2_000);
    await job;

    expect(deps.reportResult).toHaveBeenCalledTimes(3);
    expect(deps.reportResult).toHaveBeenLastCalledWith({
      status: 'completed',
      clonedPath: INPUT.targetPath,
    });
  });

  it('gives up after the retry budget and still resolves', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const deps = makeDeps({
      now: clock().now,
      setIntervalFn: fakeSetInterval(),
      runClone: cloneThat(() => {}),
      reportResult: vi.fn(async () => {
        throw new Error('down');
      }),
    });

    const job = runGitCloneJob(deps, INPUT);
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000);
    await expect(job).resolves.toBeUndefined();

    // One initial attempt plus three retries.
    expect(deps.reportResult).toHaveBeenCalledTimes(4);
  });
});

describe('createGitCloneJobRunner', () => {
  const RUNNER_INPUT = { requestId: 'req-1', repoUrl: INPUT.repoUrl, targetPath: INPUT.targetPath };

  it('starts a job on a fresh target', () => {
    const runner = createGitCloneJobRunner();
    const deps = makeDeps({ runClone: vi.fn(() => new Promise<GitCloneOutcome>(() => {})) });

    expect(runner.start(deps, RUNNER_INPUT)).toBe('started');
    expect(deps.reportProgress).toHaveBeenCalledWith({ phase: 'Starting' });
  });

  it('returns duplicate for the same requestId while its clone is running', () => {
    const runner = createGitCloneJobRunner();
    const runClone = vi.fn(() => new Promise<GitCloneOutcome>(() => {}));

    expect(runner.start(makeDeps({ runClone }), RUNNER_INPUT)).toBe('started');
    expect(runner.start(makeDeps({ runClone }), RUNNER_INPUT)).toBe('duplicate');
    expect(runClone).toHaveBeenCalledTimes(1);
  });

  it('returns busy for a different requestId on the same target', () => {
    const runner = createGitCloneJobRunner();
    const runClone = vi.fn(() => new Promise<GitCloneOutcome>(() => {}));

    expect(runner.start(makeDeps({ runClone }), RUNNER_INPUT)).toBe('started');
    expect(runner.start(makeDeps({ runClone }), { ...RUNNER_INPUT, requestId: 'req-2' })).toBe(
      'busy'
    );
    expect(runClone).toHaveBeenCalledTimes(1);
  });

  it('frees the target once the job settles, so a later start succeeds', async () => {
    const runner = createGitCloneJobRunner();
    const first = makeDeps({ runClone: cloneThat(() => {}) });

    expect(runner.start(first, RUNNER_INPUT)).toBe('started');
    await vi.waitFor(() => expect(first.reportResult).toHaveBeenCalledTimes(1));
    // Let the runner's settle handler run after the result report resolves.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      runner.start(makeDeps({ runClone: cloneThat(() => {}) }), {
        ...RUNNER_INPUT,
        requestId: 'req-2',
      })
    ).toBe('started');
  });
});
