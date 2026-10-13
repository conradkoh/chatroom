import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLocalRecomputeScheduler } from './local-recompute-scheduler.js';
import type { LocalKind } from '../domain/workspace-state-unit.js';

const SETTLE_MS = 400;
const MAX_WAIT_MS = 5_000;

function makeScheduler() {
  const run = vi.fn<(kinds: ReadonlySet<LocalKind>) => void>();
  const scheduler = createLocalRecomputeScheduler({
    settleMs: SETTLE_MS,
    maxWaitMs: MAX_WAIT_MS,
    run,
    now: () => Date.now(),
  });
  return { run, scheduler };
}

describe('createLocalRecomputeScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs once with the union of a burst of requests', () => {
    const { run, scheduler } = makeScheduler();

    scheduler.request(['worktree']);
    scheduler.request(['upstream', 'worktree']);
    scheduler.request(['commands']);
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(SETTLE_MS);
    expect(run).toHaveBeenCalledTimes(1);
    expect([...run.mock.calls[0][0]].sort()).toEqual(['commands', 'upstream', 'worktree']);
  });

  it('restarts the settle timer on each request', () => {
    const { run, scheduler } = makeScheduler();

    scheduler.request(['worktree']);
    vi.advanceTimersByTime(SETTLE_MS - 1);
    scheduler.request(['worktree']);
    vi.advanceTimersByTime(SETTLE_MS - 1);
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('still runs during a continuous burst at maxWaitMs', () => {
    const { run, scheduler } = makeScheduler();

    // A request every 100ms keeps the settle timer from ever firing on its own.
    for (let elapsed = 0; elapsed < MAX_WAIT_MS; elapsed += 100) {
      scheduler.request(['worktree']);
      vi.advanceTimersByTime(100);
    }
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toEqual(new Set(['worktree']));
  });

  it('does not run before maxWaitMs during a continuous burst', () => {
    const { run, scheduler } = makeScheduler();

    for (let elapsed = 0; elapsed < MAX_WAIT_MS - 100; elapsed += 100) {
      scheduler.request(['worktree']);
      vi.advanceTimersByTime(100);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('starts a new burst window after a run', () => {
    const { run, scheduler } = makeScheduler();

    scheduler.request(['worktree']);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(run).toHaveBeenCalledTimes(1);

    scheduler.request(['head']);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toEqual(new Set(['head']));
  });

  it('requestNow runs immediately with the pending union and clears it', () => {
    const { run, scheduler } = makeScheduler();

    scheduler.request(['worktree']);
    scheduler.requestNow(['head']);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toEqual(new Set(['worktree', 'head']));

    vi.advanceTimersByTime(MAX_WAIT_MS);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('requestNow with no kinds and nothing pending does not run', () => {
    const { run, scheduler } = makeScheduler();

    scheduler.requestNow([]);
    expect(run).not.toHaveBeenCalled();
  });

  it('cancel drops pending kinds and the timer', () => {
    const { run, scheduler } = makeScheduler();

    scheduler.request(['worktree']);
    scheduler.cancel();
    vi.advanceTimersByTime(MAX_WAIT_MS);
    expect(run).not.toHaveBeenCalled();
  });

  it('cancel does not leak pending kinds into a later run', () => {
    const { run, scheduler } = makeScheduler();

    scheduler.request(['worktree']);
    scheduler.cancel();
    scheduler.request(['head']);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(run.mock.calls[0][0]).toEqual(new Set(['head']));
  });

  it('ignores empty requests and never starts a timer', () => {
    const { run, scheduler } = makeScheduler();

    scheduler.request([]);
    vi.advanceTimersByTime(MAX_WAIT_MS);
    expect(run).not.toHaveBeenCalled();
  });
});
