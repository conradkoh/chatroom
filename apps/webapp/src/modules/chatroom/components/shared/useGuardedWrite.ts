'use client';

import { useCallback, useRef, useState } from 'react';

export interface GuardedWrite {
  /** True while a write is in flight. */
  pending: boolean;
  /** Mapped message from the last failed write, or null. */
  error: string | null;
  /** Clear or replace the error (used by callers with a non-write error channel). */
  setError: (value: string | null) => void;
  /** Run one write; ignored while another is in flight. Resolves when it settles. */
  run: (fn: () => Promise<unknown>) => Promise<void>;
}

/**
 * One-at-a-time async write with a mapped inline error. The in-flight guard is
 * a ref so a second synchronous call cannot slip through before a re-render.
 */
export function useGuardedWrite(mapError: (error: unknown) => string): GuardedWrite {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setPending(true);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(mapError(e));
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [mapError]
  );

  return { pending, error, setError, run };
}
