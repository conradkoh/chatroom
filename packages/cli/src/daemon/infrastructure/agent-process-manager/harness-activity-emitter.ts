// fallow-ignore-next-line unused-export
export const HARNESS_ACTIVITY_KINDS = ['transport', 'progress', 'waiting', 'failure'] as const;

export type HarnessActivityKind = (typeof HARNESS_ACTIVITY_KINDS)[number];

export interface HarnessActivityEvent {
  readonly kind: HarnessActivityKind;
  /** Stable adapter/lifecycle source, e.g. cursor-sdk.message. */
  readonly source: string;
  /** Producer timestamp in milliseconds. */
  readonly at: number;
}

export interface HarnessActivitySignal extends HarnessActivityEvent {
  /** True only for the first progress signal after beginTurn(). */
  readonly isFirstForTurn: boolean;
}

export interface HarnessActivityEmitter {
  /** Reset first-progress tracking before a new agent turn. */
  beginTurn: () => void;
  /** Publish a semantic event synchronously to current subscribers. */
  emit: (event: HarnessActivityEvent) => void;
  /** Subscribe to all typed signals and return an unsubscribe function. */
  onActivity: (cb: (signal: HarnessActivitySignal) => void) => () => void;
}

export function createHarnessActivityEmitter(): HarnessActivityEmitter {
  let progressReportedForTurn = false;
  const listeners = new Set<(signal: HarnessActivitySignal) => void>();

  return {
    beginTurn: () => {
      progressReportedForTurn = false;
    },
    emit: (event) => {
      const isFirstForTurn = event.kind === 'progress' && !progressReportedForTurn;
      if (event.kind === 'progress') progressReportedForTurn = true;
      const signal: HarnessActivitySignal = { ...event, isFirstForTurn };
      for (const cb of listeners) cb(signal);
    },
    onActivity: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
