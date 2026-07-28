export const TOKEN_ACTIVITY_KINDS = ['busy', 'thinking', 'tool'] as const;
export type TokenActivityKind = (typeof TOKEN_ACTIVITY_KINDS)[number];

/**
 * Emitter for harness activity events used by token-activity wiring.
 * Subscribed by `wireThrottledTokenActivityOnOutput` when available.
 */
export interface HarnessActivityEmitter {
  onActivity: (cb: (kind: TokenActivityKind) => void) => void;
}

export function createHarnessActivityEmitter(): HarnessActivityEmitter & {
  emit: (kind: TokenActivityKind) => void;
  subscribe: (cb: (kind: TokenActivityKind) => void) => () => void;
} {
  const listeners = new Set<(kind: TokenActivityKind) => void>();

  return {
    onActivity: (cb) => {
      listeners.add(cb);
    },
    emit: (kind) => {
      for (const cb of listeners) cb(kind);
    },
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
