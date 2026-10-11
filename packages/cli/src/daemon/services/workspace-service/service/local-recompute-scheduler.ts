// Reason: the WorkspaceService (S4b-2) is the first production consumer; S5 wires it.
// fallow-ignore-file unused-file
import type { LocalKind } from '../domain/workspace-state-unit.js';

type TimerHandle = ReturnType<typeof setTimeout>;

export type LocalRecomputeScheduler = {
  /** Unions `kinds` into the pending set and restarts the trailing settle timer. */
  request(kinds: Iterable<LocalKind>): void;
  /** Unions `kinds` into the pending set and runs the whole pending set now, clearing it and the timer. */
  requestNow(kinds: Iterable<LocalKind>): void;
  /** Clears the pending set and the timer. Nothing runs after this until the next request. */
  cancel(): void;
};

export type LocalRecomputeSchedulerOptions = {
  /** Trailing settle time after the most recent request. */
  settleMs: number;
  /** Upper bound on how long a continuous burst can defer a run, measured from its first request. */
  maxWaitMs: number;
  /** Receives the pending set. Called outside any lock; the monitor serializes its own work. */
  run: (kinds: ReadonlySet<LocalKind>) => void;
  now: () => number;
  setTimer?: (fn: () => void, ms: number) => TimerHandle; // default: setTimeout
  clearTimer?: (handle: TimerHandle) => void; // default: clearTimeout
};

/**
 * Trailing-debounced scheduler for local recomputes.
 *
 * Constraints:
 * - Requests merge into one pending set, so a burst of kinds produces one run with their union.
 * - The run timer is `min(settleMs, burstStart + maxWaitMs - now)`. `burstStart` is the first
 *   request since the last run, so a continuous burst still runs at `maxWaitMs`.
 * - Empty requests are ignored and never start a timer.
 */
// Reason: the WorkspaceMonitor (next commit) is the first consumer; remove this annotation when it lands.
// fallow-ignore-next-line unused-export
export function createLocalRecomputeScheduler(
  options: LocalRecomputeSchedulerOptions
): LocalRecomputeScheduler {
  const { settleMs, maxWaitMs, run, now } = options;
  const setTimer: (fn: () => void, ms: number) => TimerHandle = options.setTimer ?? setTimeout;
  const clearTimer: (handle: TimerHandle) => void = options.clearTimer ?? clearTimeout;

  const pending = new Set<LocalKind>();
  let burstStart: number | null = null;
  let timer: TimerHandle | null = null;

  function clearPendingTimer(): void {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  }

  /** Takes the pending set, clears the burst, and hands the set to `run`. */
  function flush(): void {
    timer = null;
    const kinds = new Set(pending);
    pending.clear();
    burstStart = null;
    if (kinds.size > 0) run(kinds);
  }

  function merge(kinds: Iterable<LocalKind>): boolean {
    let added = false;
    for (const kind of kinds) {
      pending.add(kind);
      added = true;
    }
    return added;
  }

  return {
    request(kinds) {
      if (!merge(kinds)) return;
      burstStart ??= now();
      clearPendingTimer();
      const untilCap = burstStart + maxWaitMs - now();
      timer = setTimer(flush, Math.max(0, Math.min(settleMs, untilCap)));
    },
    requestNow(kinds) {
      merge(kinds);
      clearPendingTimer();
      flush();
    },
    cancel() {
      clearPendingTimer();
      pending.clear();
      burstStart = null;
    },
  };
}
