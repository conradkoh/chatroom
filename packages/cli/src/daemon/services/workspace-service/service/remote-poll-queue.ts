// Reason: the WorkspaceService monitor (S4b) is the first production consumer; S5 wires it.
// fallow-ignore-file unused-file

export type RemotePollQueue = {
  /** Replaces any pending timer for `workingDir`; `run` starts after `delayMs`, and never sooner than `minGapMs` after that workspace's previous start. No-op after `stopAll`. */
  schedule(workingDir: string, delayMs: number): void;
  /** Clears the pending timer for `workingDir`. An in-flight run is not cancelled. */
  cancel(workingDir: string): void;
  /** Clears every timer and resolves when the in-flight run, if any, has settled. */
  stopAll(): Promise<void>;
};

export type RemotePollQueueOptions = {
  minGapMs: number;
  now: () => number;
  /** Must not be relied on to reject; a rejection is caught and does not stop the chain. */
  run: (workingDir: string) => Promise<void>;
  setTimer?: (fn: () => void, ms: number) => unknown; // default: setTimeout
  clearTimer?: (handle: unknown) => void; // default: clearTimeout
};

/**
 * Serial, per-workspace-throttled queue for remote polls.
 *
 * Constraints:
 * - One global promise chain: at most one `run` is in flight across all workspaces.
 * - Per workspace, consecutive run starts are at least `minGapMs` apart. The gap is checked
 *   when a timer fires, against the last start, so a queued run can never start inside the gap.
 * - A workspace has at most one run waiting on the chain. A timer that fires while that run is
 *   still waiting is dropped, because the waiting run reads fresh state when it starts.
 */
export function createRemotePollQueue(options: RemotePollQueueOptions): RemotePollQueue {
  const { minGapMs, now, run } = options;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  const timers = new Map<string, unknown>();
  const waiting = new Set<string>();
  const lastStartAt = new Map<string, number>();
  let chain: Promise<void> = Promise.resolve();
  let stopped = false;

  /** Milliseconds until `workingDir` may start again; zero or less when it may start now. */
  function gapRemaining(workingDir: string): number {
    const last = lastStartAt.get(workingDir);
    return last === undefined ? 0 : last + minGapMs - now();
  }

  function arm(workingDir: string, delayMs: number): void {
    timers.set(
      workingDir,
      setTimer(() => fire(workingDir), delayMs)
    );
  }

  function fire(workingDir: string): void {
    timers.delete(workingDir);
    const wait = gapRemaining(workingDir);
    if (wait > 0) {
      arm(workingDir, wait);
      return;
    }
    enqueue(workingDir);
  }

  function enqueue(workingDir: string): void {
    if (stopped || waiting.has(workingDir)) return;
    waiting.add(workingDir);
    chain = chain.then(() => start(workingDir));
  }

  async function start(workingDir: string): Promise<void> {
    waiting.delete(workingDir);
    if (stopped) return;
    lastStartAt.set(workingDir, now());
    try {
      await run(workingDir);
    } catch (error) {
      console.error(`[remote-poll-queue] run failed for ${workingDir}:`, error);
    }
  }

  function clearPending(workingDir: string): void {
    if (!timers.has(workingDir)) return;
    clearTimer(timers.get(workingDir));
    timers.delete(workingDir);
  }

  return {
    schedule(workingDir, delayMs) {
      if (stopped) return;
      clearPending(workingDir);
      arm(workingDir, delayMs);
    },
    cancel(workingDir) {
      clearPending(workingDir);
    },
    async stopAll() {
      stopped = true;
      for (const handle of timers.values()) clearTimer(handle);
      timers.clear();
      await chain;
    },
  };
}
